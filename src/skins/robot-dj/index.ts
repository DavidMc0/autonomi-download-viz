// Robot DJ (Playful 1): an original robot DJ spins each chunk as a disk on its decks, then stacks it
// onto a tower that becomes the file. It scratches and checks its watch when the network stalls,
// scans the finished tower while the file is verified, and drops the beat at the end. When the
// track has played out, it takes its headphones off and waves while the crowd drifts away.
//
// Real (Tier A): every phase and its timing, the seed count and connected peer, the chunk count and
// total (disks, and the music's layers), the rate (the robot's mood), stalls, verification and the
// hash, save, failure and cancel.
// Illustrative: the record-crate search while the file is being found (SDK 0.1.2 sends no lookup
// rounds), the crowd, and which deck each disk spins on.

import { describeState, initialState, reduce } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";
import { Beat, layersFor, SONG_BARS, type Section } from "./audio";
import { drawArms, drawBody, drawPhones, newRig, PHONES_LIFT, rig, SCHEMES, seededScheme, type Expression, type RobotPalette, type RobotPose, type RobotStyle } from "./characters/robot";

const tweakables: TweakDef[] = [
  { key: "style", label: "robot style", kind: "select", options: { cute: "cute", retro: "retro", sleek: "sleek" }, default: "sleek" },
  { key: "scheme", label: "robot colours", kind: "select", options: { "match style": "match", "seeded by address": "seeded", retro: "retro", sleek: "sleek", chrome: "chrome" }, default: "match" },
  { key: "tower", label: "tower style", kind: "select", options: { "stacked disks": "disks", vinyl: "vinyl" }, default: "disks" },
  { key: "group", label: "chunks per disk", kind: "select", options: { "auto (at most 60 disks)": "auto", "always 1": "1" }, default: "auto" },
  { key: "crowd", label: "crowd size", kind: "number", min: 0, max: 30, step: 1, default: 14 },
  { key: "confetti", label: "confetti", kind: "number", min: 0, max: 400, step: 10, default: 160 },
  { key: "tempo", label: "tempo (bpm)", kind: "number", min: 90, max: 140, step: 1, default: 122 },
  { key: "music", label: "music (with sound on)", kind: "boolean", default: true },
  { key: "build", label: "music builds with download", kind: "boolean", default: true },
];

// World layout (logical units; the view scales to fit).
const FLOOR = 470;
const ROBOT_X = 360;
const TABLE = { x0: 222, x1: 498, y: 362 };
const DECK_L = { x: 292, y: 352 };
const DECK_R = { x: 428, y: 352 };
const CRATE = { x: 512, y: 428, w: 70, h: 42 };
const TOWER = { x: 735, base: FLOOR, maxH: 318, rx: 64, ry: 12 };
const MAX_DISKS = 60;
const SPEAKERS = [
  { x: 28, y: 424 }, { x: 28, y: 378 }, { x: 28, y: 332 }, { x: 28, y: 286 },
  { x: 92, y: 424 }, { x: 92, y: 378 }, { x: 92, y: 332 },
  { x: 156, y: 424 }, { x: 156, y: 378 }, { x: 156, y: 332 },
];
const VIEW = { full: { x: 0, y: 0, w: 960, h: 540 }, card: { x: 205, y: 120, w: 625, h: 382 } };

type Mode = "idle" | "boot" | "plug" | "search" | "setlist" | "play" | "stall" | "check" | "drop" | "winddown" | "failed" | "cancelled";

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Flight { active: boolean; disk: number; t0: number; dur: number; x0: number; y0: number }
interface Particle { x: number; y: number; vx: number; vy: number; r: number; vr: number; c: number; life: number }

export default function create(): Skin {
  let ctx!: SkinContext;
  let params = defaultParams(tweakables);
  const state = initialState();
  let canvas!: HTMLCanvasElement;
  let g!: CanvasRenderingContext2D;
  let w = 0, h = 0, dpr = 1;
  let pal!: RobotPalette;
  let style: RobotStyle = "cute";
  let beat: Beat | null = null;

  let clock = 0;
  let snapping = true;
  let burst = 0;
  const stamp = () => (snapping ? -1e3 : clock);
  let seedWord = 0;
  let hue0 = 0;

  // Story moments (skin clock).
  let startAt = Infinity, connectAt = Infinity, peerAt = Infinity, mapAt = Infinity, nestedAt = -1e3;
  let stallAt = -1e3, checkAt = Infinity, dropAt = Infinity, endAt = Infinity, saveAt = Infinity, savedAt = Infinity;
  let mode: Mode = "idle";
  let modeAt = 0;
  let seeds = 0, peersLit = 0;
  let hashReady = false;

  // Disks.
  let total = 0, perDisk = 1, disks = 0;
  let completed = 0; // chunks done
  let launched = 0; // disks sent to the tower
  let landed = 0;
  const flights: Flight[] = Array.from({ length: 10 }, () => ({ active: false, disk: 0, t0: 0, dur: 0, x0: 0, y0: 0 }));
  const landBounce = new Float32Array(MAX_DISKS + 1);
  let deckSpin = 0;
  let deckSince = -1e3; // when the disk now on the deck appeared
  let lastLaunchDeck = 0; // 0 left, 1 right
  let launchKick = -1e3;
  let rate = 0, maxRate = 0;

  // Music.
  let bpm = 0, phase = 0;
  let visLayers = 0, lastBar = -1; // mixer lights, changed on bar lines like the music
  let windAt = Infinity; // the track has played out
  let beatPulse = 0;

  // Robot.
  const pose: RobotPose = {
    x: ROBOT_X, y: FLOOR, bob: 0, lean: 0, headTilt: 0, shrug: 0,
    handL: { x: DECK_L.x, y: DECK_L.y - 8, z: 80 }, handR: { x: DECK_R.x, y: DECK_R.y - 8, z: 80 },
    footTap: 0, expression: "off", visor: 0, blink: 0, antenna: 0, chest: 0, phones: 0,
  };
  const r = newRig();
  // Hand goals; z is depth toward the viewer (the decks are in front of the robot).
  const goalL = { x: DECK_L.x, y: DECK_L.y - 8, z: 80 }, goalR = { x: DECK_R.x, y: DECK_R.y - 8, z: 80 };
  let leanGoal = 0, shrugGoal = 0, tiltGoal = 0;

  // Particles.
  const confetti: Particle[] = Array.from({ length: 400 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, c: 0, life: 0 }));
  const sleeves: Particle[] = Array.from({ length: 24 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, c: 0, life: 0 }));
  let sleeveNext = 0;
  const crowdKick = new Float32Array(30);

  // Colours by theme.
  let C = themeColours(false);

  function themeColours(dark: boolean) {
    return dark
      ? { skyTop: "#100c22", skyBot: "#24183f", floor: "#1b1532", floorLine: "#2e2552", table: "#2a2440", tableTop: "#3a3358", text: "#e9e4ff", muted: "#9d93c4", deck: "#15121f", crowd: "#0a0814", crate: "#6b4a2e", speaker: "#1d1a2c", blueprint: "#8f84c8" }
      : { skyTop: "#f1ecff", skyBot: "#dcd2f6", floor: "#cbbfe8", floorLine: "#b9acdd", table: "#4a4266", tableTop: "#5d5480", text: "#2a2346", muted: "#6b6290", deck: "#1f1b2c", crowd: "#3b335c", crate: "#9a6a40", speaker: "#2b2640", blueprint: "#7a6fb4" };
  }

  const diskColour = (i: number) => `hsl(${(hue0 + i * 137.5) % 360} 68% ${String(params.tower) === "vinyl" ? 58 : 60}%)`;

  // ---------------------------------------------------------------------------
  // Disks and flights.

  function towerThick(): number {
    return disks ? Math.min(22, TOWER.maxH / disks) : 22;
  }

  function setTotal(n: number): void {
    if (n === total) return;
    total = n;
    perDisk = params.group === "1" ? 1 : Math.max(1, Math.ceil(total / MAX_DISKS));
    disks = Math.max(1, Math.ceil(total / perDisk));
  }

  function onChunks(c: number): void {
    completed = c;
    const full = c >= total ? disks : Math.floor(c / perDisk);
    while (launched < full) launch();
    if (c < total && c % perDisk !== 0) deckSince = Math.min(deckSince, clock);
  }

  function launch(): void {
    const disk = launched++;
    lastLaunchDeck = disk & 1;
    const instant = snapping || burst > 12;
    let f: Flight | undefined;
    if (!instant) f = flights.find((x) => !x.active);
    if (!f) {
      land(disk, true);
      return;
    }
    const deck = lastLaunchDeck ? DECK_R : DECK_L;
    f.active = true;
    f.disk = disk;
    f.t0 = clock + (perDisk === 1 ? 0.3 : 0.15); // spin on the deck first
    f.dur = ctx.reducedMotion ? 0.9 : 0.6;
    f.x0 = deck.x;
    f.y0 = deck.y - 6;
    deckSince = clock;
    launchKick = f.t0;
  }

  function land(disk: number, instant: boolean): void {
    landed = Math.max(landed, disk + 1);
    if (!instant) {
      landBounce[Math.min(disk, MAX_DISKS)] = 1;
      for (let i = 0; i < crowdKick.length; i++) if (hash01(seedWord + disk, i) < 0.4) crowdKick[i] = Math.max(crowdKick[i], 0.6);
      beat?.thunk();
    }
  }

  // ---------------------------------------------------------------------------
  // Particles.

  function burstConfetti(n: number): void {
    const vw = VIEW[ctx.size];
    let made = 0;
    for (const p of confetti) {
      if (made >= n) break;
      if (p.life > 0) continue;
      const k = made / Math.max(1, n);
      p.x = vw.x + vw.w * (0.1 + 0.8 * hash01(seedWord, made * 3));
      p.y = vw.y - 10 - hash01(seedWord, made * 3 + 1) * 120;
      p.vx = (hash01(seedWord, made * 3 + 2) - 0.5) * 120;
      p.vy = 40 + k * 60;
      p.r = hash01(made, 7) * 6.28;
      p.vr = (hash01(made, 9) - 0.5) * 12;
      p.c = made % 5;
      p.life = ctx.reducedMotion ? 5 : 3.5 + hash01(made, 11) * 1.5;
      made++;
    }
  }

  function throwSleeve(x: number, y: number, vx: number, vy: number): void {
    const p = sleeves[sleeveNext++ % sleeves.length];
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.r = 0; p.vr = (hash01(sleeveNext, 1) - 0.5) * 10;
    p.c = sleeveNext % 5;
    p.life = 1.6;
  }

  // ---------------------------------------------------------------------------
  // Mode and pose.

  function setMode(m: Mode): void {
    if (m === mode) return;
    mode = m;
    modeAt = clock;
  }

  function deriveMode(): void {
    switch (state.phase) {
      case "idle": setMode(startAt < Infinity ? "boot" : "idle"); break;
      case "connecting": setMode(connectAt < Infinity ? "plug" : "boot"); break;
      case "finding": setMode(mapAt < Infinity && clock - mapAt < 2.2 ? "setlist" : "search"); break;
      case "downloading": setMode(state.stalled ? "stall" : "play"); break;
      case "verifying": case "saving": case "done":
        if (dropAt < Infinity) {
          // The track runs SONG_BARS from the drop; a save in progress holds the party a little.
          windAt = dropAt + (SONG_BARS * 240) / tempo();
          if (saveAt < Infinity) windAt = savedAt < Infinity ? Math.max(windAt, savedAt + 2) : Infinity;
          setMode(clock >= windAt ? "winddown" : "drop");
        }
        else setMode(landed >= disks && disks > 0 ? "check" : "play");
        break;
      case "failed": setMode("failed"); break;
      case "cancelled": setMode("cancelled"); break;
    }
    if (mode === "check" && checkAt === Infinity) checkAt = clock;
  }

  function poseFor(dt: number): void {
    const el = clock - modeAt;
    const b = beatPulse;
    let expr: Expression = "neutral";
    leanGoal = 0; shrugGoal = 0; tiltGoal = 0;
    let tap = 0;
    // Default: hands on the decks.
    goalL.x = DECK_L.x + 6; goalL.y = DECK_L.y - 10; goalL.z = 80;
    goalR.x = DECK_R.x - 6; goalR.y = DECK_R.y - 10; goalR.z = 80;
    pose.visor = approach(pose.visor, 1, 3, dt);

    switch (mode) {
      case "idle":
        expr = "off";
        pose.visor = 0;
        break;
      case "boot": {
        const t = clock - startAt;
        pose.visor = t < 1.2 ? (Math.sin(t * 37) > 0.2 ? 0.8 : 0.15) : 1;
        expr = t < 1.2 ? "neutral" : "boot";
        goalL.x = ROBOT_X - 40; goalL.y = 380; goalR.x = ROBOT_X + 40; goalR.y = 380;
        goalL.z = goalR.z = 20;
        break;
      }
      case "plug": {
        // Reaching out to plug cables into the seed speakers (time-driven, one by one).
        expr = peerAt < Infinity && clock - peerAt < 1.2 ? "happy" : "focus";
        const k = Math.sin(el * 5) * 0.5 + 0.5;
        goalL.x = TABLE.x0 - 10 - k * 20; goalL.y = 330 + k * 18; goalL.z = 10;
        tiltGoal = -0.12;
        break;
      }
      case "search": {
        // Digging in the crate: pull a sleeve up, look at it, drop it back.
        expr = "focus";
        const cyc = el % 1.8;
        const up = cyc > 0.7 && cyc < 1.3 ? ease((cyc - 0.7) / 0.2) * (1 - ease((cyc - 1.1) / 0.2)) : 0;
        goalR.x = CRATE.x + 26 + Math.sin(el * 3) * 10;
        goalR.y = CRATE.y + 4 - up * 46;
        goalR.z = 20;
        tiltGoal = 0.18;
        leanGoal = 0.05;
        break;
      }
      case "setlist":
        expr = clock - mapAt < 0.8 ? "wow" : "happy";
        goalL.x = ROBOT_X - 70; goalL.y = 268; goalL.z = 30;
        tiltGoal = -0.08;
        break;
      case "play": {
        expr = rate > 0 && rate >= maxRate * 0.8 ? "happy" : "neutral";
        // Lift the hand on the deck whose disk is launching.
        const lift = Math.max(0, 1 - Math.abs(clock - launchKick) / 0.25);
        if (lastLaunchDeck) goalR.y -= lift * 34; else goalL.y -= lift * 34;
        break;
      }
      case "stall": {
        const t = clock - stallAt;
        if (t < 0.7) {
          // Scratch: the right hand rocks the platter.
          expr = "wow";
          goalR.x = DECK_R.x + Math.sin(t * 40) * 14;
        } else {
          expr = "bored";
          goalL.x = ROBOT_X - 30; goalL.y = FLOOR - 196; goalL.z = 45; // wrist up to the visor
          tiltGoal = -0.15;
          tap = Math.max(0, Math.sin(clock * 12));
        }
        break;
      }
      case "check": {
        expr = "focus";
        goalR.x = ROBOT_X + 96; goalR.y = 300; goalR.z = 20; // the scanner, pointing at the tower
        tiltGoal = 0.12;
        break;
      }
      case "drop": {
        const t = clock - dropAt;
        expr = t < 1 ? "wow" : saveAt < Infinity && savedAt === Infinity ? "focus" : "happy";
        if (savedAt < Infinity && clock - savedAt < 1.6) {
          leanGoal = 0.55 * Math.sin(Math.min(1, (clock - savedAt) / 1.6) * Math.PI); // a bow
          expr = "wink";
        } else if (t < 3) {
          goalL.x = ROBOT_X - 70; goalL.y = FLOOR - 270 + b * 10;
          goalR.x = ROBOT_X + 70; goalR.y = FLOOR - 270 + b * 10;
          goalL.z = goalR.z = 0;
        } else {
          goalL.y -= b * 12;
          goalR.y -= (1 - b) * 12;
        }
        break;
      }
      case "winddown": {
        // Stop, lift the headphones off, hang them round the neck, wave.
        const t = clock - windAt;
        const headY = FLOOR - 204;
        expr = "happy";
        pose.phones = 0;
        if (t >= 1 && t < 2.6) {
          const k = t < 1.8 ? 0 : ease((t - 1.8) / 0.8);
          pose.phones = Math.min(0.999, k);
          goalL.x = ROBOT_X - 54; goalR.x = ROBOT_X + 54;
          goalL.y = goalR.y = headY - k * PHONES_LIFT;
          goalL.z = goalR.z = 0;
        } else if (t >= 2.6 && t < 3.4) {
          pose.phones = 1;
          goalL.x = ROBOT_X - 34; goalR.x = ROBOT_X + 34;
          goalL.y = goalR.y = FLOOR - 150;
          goalL.z = goalR.z = 30;
        } else if (t >= 3.4) {
          pose.phones = 2;
          expr = t < 5.2 ? "wink" : "happy";
          goalR.x = ROBOT_X + 70; goalR.y = FLOOR - 250 + (t < 7 ? Math.sin(clock * 9) * 12 : 30); goalR.z = 0;
          goalL.x = ROBOT_X - 64; goalL.y = TABLE.y - 12; goalL.z = 50;
        }
        break;
      }
      case "failed":
        expr = el < 0.6 ? "wow" : "sad";
        shrugGoal = el < 0.6 ? 0 : 1;
        goalL.x = ROBOT_X - 92; goalL.y = FLOOR - 150;
        goalR.x = ROBOT_X + 92; goalR.y = FLOOR - 150;
        goalL.z = goalR.z = 0;
        break;
      case "cancelled": {
        expr = el < 2.4 ? "neutral" : "wink";
        if (el < 2.4) {
          // Packing up: hands sweep the decks.
          const k = (el * 1.5) % 1;
          goalL.x = DECK_L.x + k * 40; goalR.x = DECK_R.x - k * 40;
        } else {
          goalR.x = ROBOT_X + 70; goalR.y = FLOOR - 250 + Math.sin(clock * 9) * 12; goalR.z = 0; // a wave
          goalL.x = ROBOT_X - 40; goalL.y = 380; goalL.z = 20;
        }
        break;
      }
    }
    pose.expression = expr;
    const k = snapping ? 1e3 : 10;
    pose.handL.x = approach(pose.handL.x, goalL.x, k, dt);
    pose.handL.y = approach(pose.handL.y, goalL.y, k, dt);
    pose.handR.x = approach(pose.handR.x, goalR.x, k, dt);
    pose.handR.y = approach(pose.handR.y, goalR.y, k, dt);
    pose.handL.z = approach(pose.handL.z, goalL.z, k, dt);
    pose.handR.z = approach(pose.handR.z, goalR.z, k, dt);
    pose.lean = approach(pose.lean, leanGoal, snapping ? 1e3 : 6, dt);
    pose.shrug = approach(pose.shrug, shrugGoal, snapping ? 1e3 : 8, dt);
    pose.headTilt = approach(pose.headTilt, tiltGoal + (bpm > 0 ? Math.sin(phase * Math.PI) * 0.04 : 0), snapping ? 1e3 : 6, dt);
    pose.footTap = tap;
    const dancing = bpm > 0 && (mode === "play" || mode === "drop" || mode === "check");
    pose.bob = dancing ? b * (ctx.reducedMotion ? 2 : 5) + (mode === "drop" && clock - dropAt < 3 && !ctx.reducedMotion ? -Math.abs(Math.sin(phase * Math.PI)) * 14 : 0) : 0;
    if (mode !== "winddown") pose.phones = 0;
    pose.chest = bpm > 0 ? b : mode === "failed" || mode === "cancelled" ? 0 : 0.2;
    pose.antenna = mode === "idle" ? 0 : peerAt < Infinity && clock - peerAt < 1 ? 1 : 0.4 + 0.6 * b;
    pose.blink = (clock % 3.7) < 0.12 ? 1 : 0;
    if (mode === "cancelled" && el > 4) pose.visor = Math.max(0, 1 - (el - 4));
  }

  // ---------------------------------------------------------------------------
  // Drawing.

  function drawBackground(vw: { x: number; y: number; w: number; h: number }, lightsOn: number): void {
    const grad = g.createLinearGradient(0, vw.y, 0, FLOOR);
    grad.addColorStop(0, C.skyTop);
    grad.addColorStop(1, C.skyBot);
    g.fillStyle = grad;
    g.fillRect(vw.x - 2, vw.y - 2, vw.w + 4, FLOOR - vw.y + 2);
    g.fillStyle = C.floor;
    g.fillRect(vw.x - 2, FLOOR, vw.w + 4, vw.y + vw.h - FLOOR + 2);
    g.strokeStyle = C.floorLine;
    g.lineWidth = 2;
    for (let x = -400; x < 1400; x += 80) {
      g.beginPath();
      g.moveTo(480 + (x - 480) * 0.55, FLOOR);
      g.lineTo(x, FLOOR + 90);
      g.stroke();
    }
    // Truss and lamps; beams when the music plays.
    g.fillStyle = C.table;
    g.fillRect(40, 28, 880, 10);
    const lamps = 4;
    for (let i = 0; i < lamps; i++) {
      const lx = 170 + i * 205, ly = 44;
      const hueL = (hue0 + i * 70 + (mode === "drop" ? clock * 40 : 0)) % 360;
      if (lightsOn > 0.01) {
        const sway = (ctx.reducedMotion ? 0.2 : 1) * Math.sin(clock * 0.7 + i * 1.7) * 0.35;
        const tx = lx + Math.sin(sway) * 520, ty = FLOOR;
        const beam = g.createLinearGradient(lx, ly, tx, ty);
        beam.addColorStop(0, `hsla(${hueL} 90% 65% / ${0.45 * lightsOn})`);
        beam.addColorStop(1, `hsla(${hueL} 90% 65% / 0)`);
        g.fillStyle = beam;
        g.beginPath();
        g.moveTo(lx - 6, ly);
        g.lineTo(tx - 70, ty);
        g.lineTo(tx + 70, ty);
        g.lineTo(lx + 6, ly);
        g.fill();
      }
      g.fillStyle = C.speaker;
      g.beginPath();
      g.roundRect(lx - 14, ly - 8, 28, 20, 5);
      g.fill();
      g.fillStyle = lightsOn > 0.01 ? `hsl(${hueL} 90% 70%)` : C.muted;
      g.beginPath();
      g.arc(lx, ly + 10, 6, 0, Math.PI);
      g.fill();
    }
  }

  function progress(): number {
    return total > 0 ? Math.min(1, completed / total) : 0;
  }

  function mixerChannels(): number {
    if (mode === "play") return visLayers;
    if (mode === "check") return 3;
    if (mode === "drop") {
      // 8 full bars at the top tempo, then the outro takes layers away (as the music does).
      const bar = ((clock - dropAt) * tempo()) / 240 - 8;
      return bar < 0 ? 10 : [6, 3, 2, 1][Math.floor(bar)] ?? 0;
    }
    return 0;
  }

  function tempo(): number {
    return Math.max(60, Number(params.tempo) || 122);
  }

  function section(): Section {
    return mode === "play" ? "play" : mode === "check" ? "check" : mode === "drop" ? "drop" : "off";
  }

  function makeBeat(): void {
    beat?.dispose();
    beat = ctx.audio && ctx.audioOut && params.music ? new Beat(ctx.audio, ctx.audioOut, ctx.seed) : null;
  }

  function applyStyle(): void {
    style = (["cute", "retro", "sleek"].includes(String(params.style)) ? String(params.style) : "cute") as RobotStyle;
    const scheme = String(params.scheme) === "match" ? (style === "cute" ? "seeded" : style) : String(params.scheme);
    pal = scheme in SCHEMES ? SCHEMES[scheme] : seededScheme(ctx.seed);
  }

  function drawSpeakers(card: boolean): void {
    const n = Math.min(seeds, SPEAKERS.length);
    for (let i = 0; i < SPEAKERS.length; i++) {
      const s = SPEAKERS[i];
      if (i >= Math.max(n, 7)) continue;
      const plugged = connectAt < Infinity && clock - connectAt > 0.25 + i * 0.3 && mode !== "idle" && mode !== "boot";
      const lit = i < peersLit && mode !== "failed" && mode !== "cancelled";
      // Cable from the mixer.
      if (plugged && i < n) {
        g.strokeStyle = C.speaker;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(TABLE.x0 + 30, TABLE.y + 6);
        g.quadraticCurveTo((TABLE.x0 + s.x) / 2, FLOOR + 6, s.x + 50, s.y + 30);
        g.stroke();
      }
      g.fillStyle = C.speaker;
      g.beginPath();
      g.roundRect(s.x, s.y, 58, 44, 6);
      g.fill();
      const pump = lit && bpm > 0 ? beatPulse * 2.5 : 0;
      g.fillStyle = lit ? pal.glow : C.deck;
      g.globalAlpha = lit ? 0.9 : 1;
      g.beginPath();
      g.arc(s.x + 29, s.y + 22, 13 + pump, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = plugged && i < n ? pal.accent : C.muted;
      g.beginPath();
      g.arc(s.x + 50, s.y + 8, 3, 0, Math.PI * 2);
      g.fill();
      if (!card) {
        g.fillStyle = C.muted;
        g.font = "600 9px system-ui, sans-serif";
        g.fillText("SEED", s.x + 4, s.y + 11);
      }
    }
  }

  function drawCrate(): void {
    g.fillStyle = C.crate;
    g.beginPath();
    g.roundRect(CRATE.x, CRATE.y, CRATE.w, CRATE.h, 4);
    g.fill();
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `hsl(${(hue0 + i * 61) % 360} 45% 50%)`;
      g.fillRect(CRATE.x + 6 + i * 10, CRATE.y - 14 + (i % 3) * 3, 8, 18);
    }
    g.fillStyle = C.crate;
    g.fillRect(CRATE.x, CRATE.y + 8, CRATE.w, 5);
  }

  function drawTable(): void {
    g.fillStyle = C.table;
    g.fillRect(TABLE.x0 + 12, TABLE.y + 10, 12, FLOOR - TABLE.y - 10);
    g.fillRect(TABLE.x1 - 24, TABLE.y + 10, 12, FLOOR - TABLE.y - 10);
    g.fillStyle = C.tableTop;
    g.beginPath();
    g.roundRect(TABLE.x0, TABLE.y - 4, TABLE.x1 - TABLE.x0, 18, 4);
    g.fill();
    // Mixer: one channel light per music layer playing (they join as the file comes in).
    g.fillStyle = C.deck;
    g.beginPath();
    g.roundRect(ROBOT_X - 30, TABLE.y - 17, 60, 15, 3);
    g.fill();
    const n = mixerChannels();
    for (let i = 0; i < 10; i++) {
      const lit = i < n;
      g.fillStyle = lit ? pal.glow : C.muted;
      g.globalAlpha = lit ? 0.55 + 0.45 * beatPulse : 0.6;
      g.fillRect(ROBOT_X - 26 + i * 5.4, TABLE.y - 13 + (lit ? 0 : 3), 3.4, lit ? 8 : 4);
    }
    g.globalAlpha = 1;
  }

  function drawDeck(d: { x: number; y: number }, i: number, lid: number): void {
    g.fillStyle = C.deck;
    g.beginPath();
    g.roundRect(d.x - 50, d.y - 12, 100, 16, 4);
    g.fill();
    g.fillStyle = "#2b2838";
    g.beginPath();
    g.ellipse(d.x, d.y - 6, 40, 10, 0, 0, Math.PI * 2);
    g.fill();
    // A disk on the deck: the one filling with chunks, or one about to launch.
    const onDeck = deckDisk(i);
    if (onDeck >= 0) {
      const scratchy = mode === "stall" && clock - stallAt < 0.7 && i === 1 ? Math.sin((clock - stallAt) * 40) * 1.5 : 0;
      const ang = deckSpin * (i ? -1 : 1) + scratchy;
      g.fillStyle = String(params.tower) === "vinyl" ? "#141218" : diskColour(onDeck);
      g.beginPath();
      g.ellipse(d.x, d.y - 9, 34, 8.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = String(params.tower) === "vinyl" ? diskColour(onDeck) : "#fff8";
      g.beginPath();
      g.ellipse(d.x, d.y - 9, 10, 2.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#fff9";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(d.x, d.y - 9);
      g.lineTo(d.x + Math.cos(ang) * 30, d.y - 9 + Math.sin(ang) * 7.5);
      g.stroke();
      // Fill ring: how many of this disk's chunks are in.
      if (perDisk > 1) {
        const inDisk = completed - onDeck * perDisk;
        const f = Math.max(0, Math.min(1, inDisk / perDisk));
        g.strokeStyle = pal.glow;
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(d.x, d.y - 9, 37, 9.5, 0, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
        g.stroke();
      }
    }
    // Tonearm (thrown across when the download fails).
    const thrown = mode === "failed" && i === 1 ? ease((clock - endAt) / 0.3) : 0;
    g.strokeStyle = "#cfcbe0";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(d.x + 44, d.y - 14);
    g.lineTo(d.x + 22 - thrown * 50, d.y - 9 - thrown * 2);
    g.stroke();
    if (lid > 0) {
      g.fillStyle = C.tableTop;
      g.globalAlpha = lid;
      g.beginPath();
      g.roundRect(d.x - 50, d.y - 24, 100, 20 * lid, 5);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  /** The disk index currently on deck `i`, or -1. */
  function deckDisk(i: number): number {
    if (mode === "cancelled" || mode === "failed" || disks === 0) return -1;
    // A launching disk sits on its deck until its flight starts.
    for (const f of flights) if (f.active && clock < f.t0 && (f.disk & 1) === i) return f.disk;
    // The disk filling with chunks.
    const filling = launched;
    if (filling < disks && completed > launched * perDisk && (filling & 1) === i) return filling;
    if (mode === "play" && filling < disks && perDisk > 1 && (filling & 1) === i) return filling;
    return -1;
  }

  function drawTower(card: boolean, greyed: number): void {
    if (disks === 0) return;
    const th = towerThick();
    const x = TOWER.x, base = TOWER.base, rx = TOWER.rx, ry = Math.min(TOWER.ry, Math.max(5, th * 0.8));
    const fullH = disks * th;
    // Blueprint outline.
    g.strokeStyle = C.blueprint;
    g.lineWidth = 2;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(x - rx, base);
    g.lineTo(x - rx, base - fullH);
    g.moveTo(x + rx, base);
    g.lineTo(x + rx, base - fullH);
    g.stroke();
    g.beginPath();
    g.ellipse(x, base - fullH, rx, ry, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // Plinth.
    g.fillStyle = C.table;
    g.beginPath();
    g.ellipse(x, base + 2, rx + 10, ry + 3, 0, 0, Math.PI * 2);
    g.fill();
    const vinyl = String(params.tower) === "vinyl";
    for (let i = 0; i < landed; i++) {
      const bounce = landBounce[Math.min(i, MAX_DISKS)] * 6;
      const y = base - (i + 1) * th - bounce;
      const col = vinyl ? "#18161f" : diskColour(i);
      g.fillStyle = col;
      g.fillRect(x - rx, y + ry * 0.0, rx * 2, th);
      g.beginPath();
      g.ellipse(x, y + th, rx, ry, 0, 0, Math.PI);
      g.fill();
      if (vinyl) {
        g.fillStyle = diskColour(i);
        g.fillRect(x - 14, y + 1, 28, Math.max(1, th - 2));
      } else if (th > 6) {
        g.fillStyle = "#0002";
        g.fillRect(x - rx, y + th - 2, rx * 2, 2);
      }
    }
    if (landed > 0) {
      const top = base - landed * th - landBounce[Math.min(landed - 1, MAX_DISKS)] * 6;
      g.fillStyle = vinyl ? "#26232f" : diskColour(landed - 1);
      g.beginPath();
      g.ellipse(x, top, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = vinyl ? diskColour(landed - 1) : "#fff6";
      g.beginPath();
      g.ellipse(x, top, rx * 0.3, ry * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (greyed > 0) {
      g.fillStyle = C.floor;
      g.globalAlpha = greyed * 0.6;
      g.fillRect(x - rx - 2, base - fullH - ry - 2, rx * 2 + 4, fullH + ry * 2 + 4);
      g.globalAlpha = 1;
    }
    // Hash label after the drop (full size only).
    if (!card && dropAt < Infinity && state.hash) {
      g.fillStyle = C.text;
      g.font = "600 13px ui-monospace, Consolas, monospace";
      g.textAlign = "center";
      g.fillText(`✓ ${state.hash.slice(0, 8)}`, x, base - fullH - ry - 12);
      g.textAlign = "left";
    }
  }

  function drawFlights(): void {
    const th = towerThick();
    for (const f of flights) {
      if (!f.active || clock < f.t0) continue;
      const p = ease((clock - f.t0) / f.dur);
      const x1 = TOWER.x, y1 = TOWER.base - (f.disk + 1) * th;
      const x = f.x0 + (x1 - f.x0) * p;
      const y = f.y0 + (y1 - f.y0) * p - Math.sin(p * Math.PI) * (ctx.reducedMotion ? 40 : 130);
      const vinyl = String(params.tower) === "vinyl";
      g.save();
      g.translate(x, y);
      g.rotate(ctx.reducedMotion ? 0 : Math.sin(p * Math.PI) * 0.6);
      g.fillStyle = vinyl ? "#18161f" : diskColour(f.disk);
      g.beginPath();
      g.ellipse(0, 0, 34 + p * (TOWER.rx - 34), 9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = vinyl ? diskColour(f.disk) : "#fff8";
      g.beginPath();
      g.ellipse(0, 0, 10, 3, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  function drawScanner(): void {
    if (mode !== "check") return;
    const th = towerThick();
    const fullH = disks * th;
    const s = 0.5 - 0.5 * Math.cos((clock - checkAt) * (ctx.reducedMotion ? 0.8 : 2.2));
    const y = TOWER.base - s * fullH;
    const hx = r.handR.x, hy = r.handR.y;
    g.fillStyle = pal.glow;
    g.globalAlpha = 0.28;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(TOWER.x - TOWER.rx, y - 10);
    g.lineTo(TOWER.x - TOWER.rx, y + 10);
    g.fill();
    g.globalAlpha = 0.9;
    g.fillRect(TOWER.x - TOWER.rx, y - 1.5, TOWER.rx * 2, 3);
    g.globalAlpha = 1;
    // The scanner in the hand.
    g.fillStyle = C.deck;
    g.beginPath();
    g.roundRect(hx - 6, hy - 12, 22, 12, 3);
    g.fill();
  }

  function drawProps(card: boolean): void {
    // The setlist (the DataMap), held up when it is verified.
    if (mode === "setlist" || (clock - nestedAt < 0.8 && mode === "search")) {
      const x = r.handL.x - 20, y = r.handL.y - 54;
      g.fillStyle = "#fffdf5";
      g.strokeStyle = C.deck;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(x, y, 40, 50, 3);
      g.fill();
      g.stroke();
      g.strokeStyle = "#9aa";
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(x + 6, y + 10 + i * 9);
        g.lineTo(x + 30, y + 10 + i * 9);
        g.stroke();
      }
      g.strokeStyle = "#2e9e5b";
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(x + 22, y + 38);
      g.lineTo(x + 27, y + 44);
      g.lineTo(x + 37, y + 30);
      g.stroke();
    }
    // A sleeve in the hand while searching.
    if (mode === "search") {
      const cyc = (clock - modeAt) % 1.8;
      if (cyc > 0.75 && cyc < 1.25) {
        g.fillStyle = `hsl(${(hue0 + Math.floor((clock - modeAt) / 1.8) * 61) % 360} 45% 52%)`;
        g.fillRect(r.handR.x - 12, r.handR.y - 30, 24, 24);
      }
    }
    // Headphones in the hands, on their way down to the neck.
    if (mode === "winddown" && pose.phones === 1) {
      const sc = 1 - 0.3 * ease((clock - windAt - 2.6) / 0.8);
      drawPhones(g, (r.handL.x + r.handR.x) / 2, (r.handL.y + r.handR.y) / 2 - 28 * sc, pal, style, sc);
    }
    // Watch on the wrist while stalled.
    if (mode === "stall" && clock - stallAt > 0.7) {
      g.fillStyle = pal.glow;
      g.beginPath();
      g.arc(r.handL.x + 8, r.handL.y + 4, 4, 0, Math.PI * 2);
      g.fill();
    }
    // Signs.
    let sign = "";
    if ((mode === "drop" || mode === "winddown") && saveAt < Infinity) sign = savedAt < Infinity ? "SAVED" : "SAVING…";
    if (sign) {
      g.font = `800 ${card ? 30 : 22}px system-ui, sans-serif`;
      const tw = g.measureText(sign).width;
      const sx = ROBOT_X - tw / 2 - 12, sy = 150;
      g.fillStyle = C.deck;
      g.beginPath();
      g.roundRect(sx, sy, tw + 24, card ? 42 : 34, 8);
      g.fill();
      g.fillStyle = pal.glow;
      g.fillText(sign, sx + 12, sy + (card ? 31 : 25));
    }
  }

  function drawCrowd(card: boolean, vw: { x: number; y: number; w: number; h: number }): void {
    const n = Math.min(30, Math.round(Number(params.crowd) * (card ? 0.6 : 1)));
    if (n <= 0) return;
    const y0 = vw.y + vw.h - (card ? 6 : 30);
    const drop = mode === "drop" && clock - dropAt < 3.5 && !ctx.reducedMotion;
    const sad = mode === "failed" || mode === "cancelled";
    const leaving = mode === "winddown" ? clock - windAt - 1 : -1;
    for (let i = 0; i < n; i++) {
      const x = vw.x + ((i + 0.5) / n) * vw.w + (hash01(seedWord, i) - 0.5) * (vw.w / n) * 0.6;
      const size = (card ? 34 : 22) * (0.85 + hash01(seedWord, i + 50) * 0.3);
      const off = hash01(seedWord, i + 99);
      let dy = 0, dx = 0;
      if (leaving > 0) {
        // Each person heads for the nearer side, one after another, and fades out.
        const lt = leaving - hash01(seedWord, i + 200) * 3;
        if (lt > 0) {
          const alpha = 1 - lt / 3;
          if (alpha <= 0) continue;
          dx = (x < vw.x + vw.w / 2 ? -1 : 1) * lt * (60 + hash01(seedWord, i + 300) * 50);
          dy -= Math.abs(Math.sin(lt * 9)) * 3;
          g.globalAlpha = alpha;
        }
      }
      if (bpm > 0) dy -= Math.max(0, Math.sin((phase + off * 0.5) * Math.PI * 2)) * (ctx.reducedMotion ? 1.5 : 4);
      dy -= crowdKick[i] * 10;
      if (drop) dy -= Math.abs(Math.sin((clock - dropAt) * 6 + off * 6)) * 18;
      if (sad) dy += 6;
      const cx = x + dx, cy = y0 + dy;
      g.fillStyle = `hsl(${(hue0 + i * 47) % 360} ${ctx.theme === "dark" ? "22% 26%" : "24% 42%"})`;
      g.beginPath();
      g.arc(cx, cy, size * 0.55, 0, Math.PI * 2);
      g.fill();
      if (!card) {
        g.beginPath();
        g.roundRect(cx - size * 0.9, cy + size * 0.45, size * 1.8, size * 1.4, size * 0.5);
        g.fill();
        if (drop || (bpm > 0 && crowdKick[i] > 0.3)) {
          g.strokeStyle = g.fillStyle;
          g.lineWidth = 6;
          g.lineCap = "round";
          for (let s = -1; s <= 1; s += 2) {
            g.beginPath();
            g.moveTo(cx + s * size * 0.7, cy + size * 0.6);
            g.lineTo(cx + s * size * 0.95, cy - size * 0.9);
            g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
    }
  }

  function drawParticles(dt: number): void {
    const colours = [pal.accent, pal.glow, "#ff5c8a", "#ffd23f", "#6bd4ff"];
    const grav = ctx.reducedMotion ? 60 : 160;
    for (const p of confetti) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += grav * dt;
      p.vx *= Math.exp(-dt * 0.8);
      p.vy = Math.min(p.vy, ctx.reducedMotion ? 60 : 220);
      p.x += p.vx * dt + Math.sin(clock * 3 + p.r) * 20 * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = colours[p.c];
      g.globalAlpha = Math.min(1, p.life);
      g.fillRect(-4, -2.5, 8, 5 * Math.abs(Math.cos(p.r * 2)) + 1);
      g.restore();
    }
    g.globalAlpha = 1;
    for (const p of sleeves) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += 300 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.globalAlpha = Math.min(1, p.life * 2);
      g.fillStyle = `hsl(${(hue0 + p.c * 61) % 360} 45% 52%)`;
      g.fillRect(-12, -12, 24, 24);
      g.fillStyle = "#0006";
      g.beginPath();
      g.arc(0, 0, 6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------

  return {
    id: "robot-dj",
    title: "Robot DJ",
    theme: "playful",
    wantsEnriched: false,
    libs: ["Canvas 2D", "Web Audio"],
    illustrativeNote: "the record-crate search, the crowd and which deck each disk spins on",
    tweakables,

    mount(c: SkinContext) {
      ctx = c;
      params = { ...params, ...c.params };
      canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%";
      c.container.appendChild(canvas);
      g = canvas.getContext("2d")!;
      C = themeColours(c.theme === "dark");
      seedWord = (c.seed[0] | (c.seed[1] << 8) | (c.seed[2] << 16) | (c.seed[3] << 24)) >>> 0;
      hue0 = Math.round((c.seed[13] / 256) * 360);
      applyStyle();
      makeBeat();
    },

    onEvent(e: VizEvent) {
      reduce(state, e);
      switch (e.type) {
        case "session.start": startAt = stamp(); break;
        case "connect.start": connectAt = stamp(); seeds = e.seeds; break;
        case "connect.peer": peerAt = stamp(); peersLit++; break;
        case "lookup.round": {
          // Real lookup rounds (not sent by SDK 0.1.2): one sleeve flies past per node returned.
          const n = Math.min(6, e.returned);
          for (let i = 0; i < n && !snapping; i++) throwSleeve(CRATE.x + 30, CRATE.y - 10, -60 + i * 40, -260 - i * 20);
          break;
        }
        case "lookup.fail":
          if (!snapping) throwSleeve(ROBOT_X + 20, FLOOR - 230, -160, -220); // a dud over the shoulder
          break;
        case "datamap.verified": mapAt = stamp(); break;
        case "datamap.nested": nestedAt = stamp(); break;
        case "chunk.done":
          setTotal(e.total);
          burst++;
          onChunks(e.completed);
          break;
        case "rate":
          rate = e.chunksPerSec;
          if (rate > maxRate) maxRate = rate;
          break;
        case "chunk.stall":
          stallAt = stamp();
          if (!snapping) beat?.scratch();
          break;
        case "file.verified":
          if (disks === 0) {
            // openFile() streams send no chunk progress: stack the whole tower at once.
            setTotal(state.total ?? 1);
            onChunks(total);
          }
          hashReady = true;
          if (snapping) dropAt = -1e3;
          break;
        case "save.writing": saveAt = stamp(); break;
        case "save.done": savedAt = stamp(); break;
        case "session.failed":
        case "connect.failed":
          if (endAt === Infinity) {
            endAt = stamp();
            if (!snapping) beat?.needle();
          }
          break;
        case "session.cancelled":
          if (endAt === Infinity) endAt = stamp();
          break;
      }
    },

    frame(dtMs) {
      if (!w) return;
      const dt = Math.min(dtMs, 100) / 1000;
      clock += dt;

      // Flights land.
      for (const f of flights) {
        if (f.active && clock >= f.t0 + f.dur) {
          f.active = false;
          land(f.disk, false);
        }
      }
      // The drop waits for the last disk.
      if (hashReady && dropAt === Infinity && landed >= disks) {
        dropAt = clock;
        if (!snapping) {
          beat?.drop();
          burstConfetti(Math.round(Number(params.confetti)));
        }
      }
      deriveMode();

      // A fixed tempo while the music plays; silence while stalled, finding, or once it has ended.
      const playing = mode === "play" || mode === "check" || mode === "drop";
      bpm = playing ? tempo() : approach(bpm, 0, 6, dt);
      if (!playing && bpm < 20) bpm = 0;
      const audible = beat && ctx.audio?.state === "running";
      if (audible) beat!.tick({ bpm, section: section(), progress: progress(), build: Boolean(params.build) });
      // Follow the beat the listener hears when there is one; otherwise keep time from the tempo.
      const heard = audible ? beat!.phase() : null;
      phase = heard ?? phase + (dt * bpm) / 60;
      beatPulse = bpm > 0 ? Math.exp(-(phase % 1) * 5) : 0;
      // Mixer lights take on new layers at bar lines, as the music does.
      const barNow = Math.floor(phase / 4);
      if (mode === "play" && (barNow !== lastBar || visLayers === 0)) visLayers = params.build ? layersFor(progress()) : 9;
      lastBar = barNow;
      deckSpin += dt * (bpm > 0 ? (bpm / 60) * 2.2 : mode === "search" || mode === "setlist" ? 0.6 : 0);
      for (let i = 0; i < landBounce.length; i++) landBounce[i] *= Math.exp(-dt * 9);
      for (let i = 0; i < crowdKick.length; i++) crowdKick[i] *= Math.exp(-dt * 5);

      poseFor(dt);
      rig(pose, r, style);

      // Draw.
      const card = ctx.size === "card";
      const vw = VIEW[ctx.size];
      const s = Math.min(w / vw.w, h / vw.h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.skyTop;
      g.fillRect(0, 0, w, h);
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ((w - vw.w * s) / 2 - vw.x * s), dpr * ((h - vw.h * s) / 2 - vw.y * s));

      const lightsOn = mode === "drop" ? 1 : mode === "winddown" ? Math.max(0.12, 1 - (clock - windAt) / 3) : mode === "play" || mode === "check" ? 0.45 : mode === "stall" ? 0.15 : 0;
      drawBackground(vw, lightsOn * (ctx.reducedMotion ? 0.6 : 1));
      drawSpeakers(card);
      drawCrate();
      drawBody(g, pose, pal, clock, style);
      drawTable();
      const lid = mode === "cancelled" ? ease((clock - modeAt - 1.2) / 1) : 0;
      drawDeck(DECK_L, 0, lid);
      drawDeck(DECK_R, 1, lid);
      drawArms(g, r, pal, style);
      drawProps(card);
      const greyed = mode === "failed" ? ease((clock - endAt) / 1.2) : mode === "cancelled" ? 0.5 * ease((clock - endAt) / 1.5) : 0;
      drawTower(card, greyed);
      drawFlights();
      drawScanner();
      drawParticles(dt);
      drawCrowd(card, vw);

      snapping = false;
      burst = 0;
    },

    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      canvas.width = Math.round(nw * ndpr);
      canvas.height = Math.round(nh * ndpr);
    },

    setParams(p) {
      const prevGroup = params.group;
      params = { ...params, ...p };
      applyStyle();
      if (params.group !== prevGroup && total) {
        const t = total;
        total = 0;
        launched = 0;
        landed = 0;
        setTotal(t);
        const save = snapping;
        snapping = true;
        onChunks(completed);
        snapping = save;
      }
      if (!params.music) { beat?.dispose(); beat = null; }
      else if (!beat) makeBeat();
    },

    describe() {
      return describeState(state);
    },

    destroy() {
      beat?.dispose();
      beat = null;
      canvas?.remove();
    },

    stats() {
      let conf = 0;
      for (const p of confetti) if (p.life > 0) conf++;
      return { disks: landed, perDisk, bpm: Math.round(bpm), layers: mixerChannels(), confetti: conf };
    },
  };
}
