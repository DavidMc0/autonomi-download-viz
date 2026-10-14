// Murmuration (Artistic 1): a flock of light finds the file. Faint stars sit on a slowly turning
// ring, the network's address space. The flock gathers at the seeds, searches its way to the file's
// point on the ring, then each chunk flies into a loom as a thread of light and weaves one row of a
// tapestry. After verification the tapestry settles into a portrait of the file's hash.
//
// Real (Tier A): every phase and its timing, the chunk count and total, the rate, stalls, the hash,
// the connected peer's place on the ring and the file's place on the ring (both from the first 16
// bits of their addresses). Illustrative: the other stars, the flock's path while searching (SDK
// 0.1.2 sends no lookup rounds) and which star each thread comes from.

import {
  Color, Group, OrthographicCamera, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
  type DataTexture, type Mesh, type Points, type ShaderMaterial,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { prng, seedFromAddress } from "../../events/seed";
import { describeState, initialState, reduce } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";
import { makeLook, portraitCells, ringAngle, type Look } from "./look";
import {
  BRIGHT, HIST, HIST_STEP_MS, LOOM_H, LOOM_W, LOOM_Y, RING_R, SQUADS, THREAD_PTS, THREADS,
  makeBright, makeFlock, makeSky, makeHistory, makeLoom, makePortraitTexture, makeRing, makeRowsTexture, makeThreads,
} from "./scene";

const tweakables: TweakDef[] = [
  { key: "particles", label: "particles", kind: "select", options: { "auto (by size and device)": "auto", "2,000": "2000", "5,000": "5000", "10,000": "10000", "20,000": "20000" }, default: "auto" },
  { key: "cohesion", label: "flock cohesion", kind: "number", min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: "speed", label: "flock speed", kind: "number", min: 0.2, max: 3, step: 0.05, default: 1 },
  { key: "bloom", label: "bloom strength", kind: "number", min: 0, max: 2.5, step: 0.05, default: 0.7 },
  { key: "palette", label: "palette", kind: "select", options: { "seeded by address": "seeded", night: "night", dawn: "dawn", aurora: "aurora", ember: "ember" }, default: "seeded" },
  { key: "weave", label: "weave pattern", kind: "select", options: { "seeded by address": "seeded", twill: "twill", diamond: "diamond", stripes: "stripes" }, default: "seeded" },
  { key: "escorts", label: "escort squads", kind: "boolean", default: true },
  { key: "drift", label: "camera drift", kind: "number", min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: "origins", label: "thread origins", kind: "select", options: { "across the ring": "ring", "near the file": "near" }, default: "ring" },
];

// Bright-star slots.
const SEEDS = 0, SEED_MAX = 16, TARGET = 16, FLICKER = 17, FLICKER_N = 24, ORIGIN = 41, ORIGIN_N = BRIGHT - 41;

type Mode = "idle" | "arrive" | "peer" | "search" | "atFile" | "download" | "stall" | "checking" | "done" | "failed" | "cancelled";

// One WebGL context for every Murmuration instance. Seeking remounts the skin, so this keeps scrubbing
// cheap (compiled shaders are cached by the renderer) and never piles up contexts.
let shared: { renderer: WebGLRenderer; timer?: ReturnType<typeof setTimeout> } | null = null;

function acquireRenderer(): WebGLRenderer {
  if (shared) {
    clearTimeout(shared.timer);
    return shared.renderer;
  }
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  shared = { renderer };
  return renderer;
}

function releaseRenderer(): void {
  if (!shared) return;
  const s = shared;
  s.renderer.domElement.remove();
  s.timer = setTimeout(() => {
    s.renderer.dispose();
    s.renderer.forceContextLoss();
    if (shared === s) shared = null;
  }, 4000);
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export default function create(): Skin {
  let ctx!: SkinContext;
  let params = defaultParams(tweakables);
  const state = initialState();

  let renderer: WebGLRenderer | null = null;
  let fallback: HTMLElement | null = null;
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1.6, 0.5, 200);
  const ringGroup = new Group();
  let composer!: EffectComposer;
  let bloom!: UnrealBloomPass;
  let ring!: Points, bright!: Points, flock!: Points, threads!: Points, loom!: Mesh;
  let hist!: DataTexture, rowsTex!: DataTexture, portraitTex!: DataTexture;
  let look!: Look;
  let flockCount = 0;
  let w = 0, px = 1;
  const lookAt = new Vector3(0, 2.3, 0);
  const PITCH = 0.36;
  let camDist = 24;

  // Clock (seconds of wall time since mount) and the seek/burst guard.
  let clock = 0;
  let snapping = true; // until the first frame: events re-fed by a seek land instantly
  let burst = 0; // chunk events since the last frame
  const stamp = () => (snapping ? -1e3 : clock);

  // Seeded layout.
  let seedWord = 0;
  let targetAng = 0;
  let side = 1; // the flock enters and leaves on this side
  let ringRot = 0;
  const seedAng = new Float32Array(SEED_MAX);
  const seedAngTo = new Float32Array(SEED_MAX);
  let seedCount = 0;
  let peerSlot = -1;

  // Bright stars, in ring-local coordinates.
  const bLocal = new Float32Array(BRIGHT * 3);
  const bBase = new Float32Array(BRIGHT);
  const bCur = new Float32Array(BRIGHT);
  const bPulse = new Float32Array(BRIGHT);
  const bSize = new Float32Array(BRIGHT);
  let flickerNext = 0, originNext = 0;

  // Flock steering (world coordinates).
  const pos = new Vector3(), vel = new Vector3(), goal = new Vector3(), tmp = new Vector3();
  const p0 = new Vector3(), p1 = new Vector3(), p2 = new Vector3();
  let spread = 1.6, alpha = 0, scatter = 0, scatterPulse = 0, wave = 0.6;
  let orbit = 0, histAcc = 0;
  let mode: Mode = "idle";
  let modeSince = 0;
  let approachFrac = 0; // from real lookup rounds, if a future SDK sends them

  // Threads and rows.
  const thActive = new Uint8Array(THREADS);
  const thStart = new Float32Array(THREADS);
  const thDur = new Float32Array(THREADS);
  const thSlot = new Int16Array(THREADS);
  const thRow = new Int32Array(THREADS);
  const thSide = new Uint8Array(THREADS);
  const thBright = new Float32Array(THREADS);
  const thEnd = new Float32Array(THREADS * 3);
  const thLaunched = new Uint8Array(THREADS);

  // Escort squads: part of the flock flies out to a thread's star, rides in with it, then rejoins.
  const sqBusy = new Uint8Array(SQUADS);
  const sqT0 = new Float32Array(SQUADS); // dispatched
  const sqOut = new Float32Array(SQUADS); // outbound flight
  const sqFly = new Float32Array(SQUADS); // with the thread
  const sqRet = new Float32Array(SQUADS); // back to the flock
  const sqOrigin = new Int16Array(SQUADS); // bright-star slot
  const sqStart = new Float32Array(SQUADS * 3);
  const sqEnd = new Float32Array(SQUADS * 3);
  const sqPos = new Float32Array(SQUADS * 3);
  const sqW = new Float32Array(SQUADS);
  let saveBtn: HTMLButtonElement | null = null;
  let saveShown = false;
  let total = 0, woven = 0, landed = 0;
  let maxRate = 0, rateBright = 0.7;

  // Moments.
  let loomAt = Infinity, mapAt = Infinity, verifiedAt = Infinity, endAt = Infinity, checkingAt = Infinity;
  let shimmer = 0, scan = 0, grey = 0, dim = 1, warpFade = 1, ringAlpha = 0.6;

  // ---------------------------------------------------------------------------

  function worldOf(lx: number, ly: number, lz: number, out: Vector3): Vector3 {
    const c = Math.cos(ringRot), s = Math.sin(ringRot);
    return out.set(lx * c + lz * s, ly, -lx * s + lz * c);
  }
  function setLocal(slot: number, ang: number, r: number, y: number): void {
    bLocal[slot * 3] = Math.cos(ang) * r;
    bLocal[slot * 3 + 1] = y;
    bLocal[slot * 3 + 2] = Math.sin(ang) * r;
  }
  function slotWorld(slot: number, out: Vector3): Vector3 {
    return worldOf(bLocal[slot * 3], bLocal[slot * 3 + 1], bLocal[slot * 3 + 2], out);
  }

  function autoCount(): number {
    const p = String(params.particles);
    if (p !== "auto") return Number(p);
    const coarse = matchMedia("(pointer: coarse)").matches;
    return Math.round((ctx.size === "full" ? 9000 : 3500) * (coarse ? 0.5 : 1));
  }

  function buildFlock(): void {
    const n = autoCount();
    if (flock && n === flockCount) return;
    if (flock) {
      scene.remove(flock);
      flock.geometry.dispose();
      (flock.material as ShaderMaterial).dispose();
    }
    flockCount = n;
    flock = makeFlock(n, prng(ctx.seed, 3), hist);
    flock.renderOrder = 3;
    (flock.material as ShaderMaterial).uniforms.uPx.value = px;
    (flock.material as ShaderMaterial).uniforms.uSize.value = ctx.size === "full" ? 1 : 1.25;
    applyLook();
    scene.add(flock);
  }

  function applyLook(): void {
    look = makeLook(ctx.seed, String(params.palette), String(params.weave));
    if (flock) {
      const u = (flock.material as ShaderMaterial).uniforms;
      u.uColorA.value.copy(look.flockA);
      u.uColorB.value.copy(look.flockB);
    }
    if (loom) {
      const u = (loom.material as ShaderMaterial).uniforms;
      look.weft.forEach((c, i) => u[`uC${i}`].value.copy(c));
      u.uWarpC.value.copy(look.warp);
      u.uPattern.value = look.pattern;
      u.uDetail.value = look.detail;
    }
    if (threads) (threads.material as ShaderMaterial).uniforms.uColor.value.copy(look.warp).lerp(look.weft[1], 0.3);
    const col = bright.geometry.getAttribute("aColor").array as Float32Array;
    for (let i = 0; i < BRIGHT; i++) {
      const c = i === TARGET ? look.weft[2] : i >= ORIGIN ? look.warp : look.flockA;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      if (i < SEED_MAX && i === peerSlot) { col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.7; }
    }
    bright.geometry.getAttribute("aColor").needsUpdate = true;
  }

  function ensureLoom(n: number): void {
    if (total === n) return;
    total = Math.max(1, n);
    rowsTex.dispose();
    rowsTex = makeRowsTexture(total);
    const u = (loom.material as ShaderMaterial).uniforms;
    u.uRows.value = rowsTex;
    u.uRowsH.value = rowsTex.image.height;
    u.uTotal.value = total;
    woven = Math.min(woven, total);
    if (loomAt === Infinity) loomAt = stamp();
  }

  function landRow(row: number, sideOf: number, b: number, instant: boolean): void {
    const d = rowsTex.image.data as Float32Array;
    d[row * 4] = instant ? -1e3 : clock;
    d[row * 4 + 1] = b;
    d[row * 4 + 2] = sideOf;
    d[row * 4 + 3] = 1;
    rowsTex.needsUpdate = true;
    landed++;
  }

  function spawnThread(row: number): void {
    const sideOf = hash01(seedWord, row * 2 + 1) < 0.5 ? 0 : 1;
    const instant = snapping || burst > 8 || ctx.reducedMotion;
    let slot = -1;
    if (!instant) for (let i = 0; i < THREADS; i++) if (!thActive[i]) { slot = i; break; }
    // The star the thread leaves from (illustrative).
    const o = ORIGIN + (originNext++ % ORIGIN_N);
    const r1 = hash01(seedWord, row * 2), r2 = hash01(seedWord ^ 0x5bd1e995, row);
    const ang = params.origins === "ring" ? r1 * Math.PI * 2 : targetAng + (r1 - 0.5) * 0.9;
    setLocal(o, ang, RING_R + (r2 - 0.5) * 1.2, (r2 - 0.5) * 0.4);
    bBase[o] = 0;
    bPulse[o] = 0;
    if (slot < 0) {
      landRow(row, sideOf, rateBright, snapping || burst > 8);
      return;
    }
    const pace = Math.max(0.6, Math.min(2, Number(params.speed)));
    thActive[slot] = 1;
    thLaunched[slot] = 0;
    thStart[slot] = clock;
    thDur[slot] = 1.0 / pace;
    thSlot[slot] = o;
    thRow[slot] = row;
    thSide[slot] = sideOf;
    thBright[slot] = rateBright;
    thEnd[slot * 3] = sideOf ? LOOM_W / 2 : -LOOM_W / 2;
    thEnd[slot * 3 + 1] = LOOM_Y + ((row + 0.5) / total) * LOOM_H;
    thEnd[slot * 3 + 2] = 0.05;

    // Send a free squad to the star first; the thread launches when it arrives.
    let sq = -1;
    if (params.escorts && (mode === "download" || mode === "stall" || mode === "atFile")) {
      for (let i = 0; i < SQUADS; i++) if (!sqBusy[i]) { sq = i; break; }
    }
    if (sq >= 0) {
      slotWorld(o, p2);
      const out = Math.min(1.6, Math.max(0.7, p2.distanceTo(pos) / 13)) / pace;
      sqBusy[sq] = 1;
      sqT0[sq] = clock;
      sqOut[sq] = out;
      sqFly[sq] = thDur[slot];
      sqRet[sq] = 1.5 / pace;
      sqOrigin[sq] = o;
      sqStart[sq * 3] = pos.x; sqStart[sq * 3 + 1] = pos.y; sqStart[sq * 3 + 2] = pos.z;
      sqEnd[sq * 3] = thEnd[slot * 3]; sqEnd[sq * 3 + 1] = thEnd[slot * 3 + 1]; sqEnd[sq * 3 + 2] = thEnd[slot * 3 + 2];
      thStart[slot] = clock + out;
    }
  }

  function bezier(a: Vector3, c: Vector3, b: Vector3, u: number, out: Vector3): Vector3 {
    const q = 1 - u;
    return out.set(
      q * q * a.x + 2 * q * u * c.x + u * u * b.x,
      q * q * a.y + 2 * q * u * c.y + u * u * b.y,
      q * q * a.z + 2 * q * u * c.z + u * u * b.z,
    );
  }

  /** Where each escort squad is now, and how far its birds have left the main flock (weight 0..1). */
  const sa0 = new Vector3(), sa1 = new Vector3(), sa2 = new Vector3(), sOut = new Vector3();
  function updateSquads(): void {
    for (let s = 0; s < SQUADS; s++) {
      let w = 0;
      sOut.copy(pos);
      if (sqBusy[s]) {
        const launch = sqT0[s] + sqOut[s];
        const land = launch + sqFly[s];
        sa2.set(sqEnd[s * 3], sqEnd[s * 3 + 1], sqEnd[s * 3 + 2]);
        if (clock < launch) {
          // Out to the star, peeling off the flock.
          const el = clock - sqT0[s];
          sa0.set(sqStart[s * 3], sqStart[s * 3 + 1], sqStart[s * 3 + 2]);
          slotWorld(sqOrigin[s], sa2);
          sa1.copy(sa0).add(sa2).multiplyScalar(0.5);
          sa1.y += 2.2;
          bezier(sa0, sa1, sa2, ease(el / sqOut[s]), sOut);
          w = Math.min(1, el / 0.35);
        } else if (clock < land) {
          // Riding in with the thread, just behind its head (same curve as the thread).
          slotWorld(sqOrigin[s], sa0);
          sa1.copy(sa0).add(sa2).multiplyScalar(0.5);
          sa1.y += 3.6;
          sa1.z += 2.4;
          bezier(sa0, sa1, sa2, Math.max(0, ease((clock - launch) / sqFly[s]) - 0.035), sOut);
          w = 1;
        } else {
          // Back to the flock, blending in as it arrives.
          const r = (clock - land) / sqRet[s];
          if (r >= 1 || ended()) {
            sqBusy[s] = 0;
          } else {
            sa1.copy(sa2).add(pos).multiplyScalar(0.5);
            sa1.y += 1.8;
            sa1.z += 1.2;
            bezier(sa2, sa1, pos, ease(r), sOut);
            w = 1 - ease((r - 0.55) / 0.45);
          }
        }
      }
      sqPos[s * 3] = sOut.x; sqPos[s * 3 + 1] = sOut.y; sqPos[s * 3 + 2] = sOut.z;
      sqW[s] = w;
    }
  }

  function ended(): boolean {
    return mode === "failed" || mode === "cancelled";
  }

  // ---------------------------------------------------------------------------
  // Per-frame pieces.

  function steer(dt: number): void {
    const speed = Number(params.speed);
    const el = clock - modeSince;
    let targetSpread = 1.5, targetAlpha = 1, orbitR = 0, orbitW = 0.6, rise = 0.6, k = 2.2;
    wave = 0.6;
    switch (mode) {
      case "idle":
        tmp.set(side * RING_R * 2.4, 3, 6);
        goal.copy(tmp);
        targetAlpha = 0;
        break;
      case "arrive": {
        // Touring the seeds while the client authenticates (time-driven).
        const n = Math.max(1, seedCount);
        slotWorld(SEEDS + (Math.floor(el / 1.3) % n), goal);
        targetSpread = 1.9;
        rise = 0.9;
        k = 1.6;
        break;
      }
      case "peer":
        slotWorld(peerSlot >= 0 ? peerSlot : SEEDS, goal);
        targetSpread = 0.9;
        orbitR = 0.5;
        break;
      case "search": {
        // A calm, time-driven search: sweeping arcs between the peer and the file's point that
        // never quite arrive. Real lookup rounds, if sent, pull it closer.
        const from = peerSlot >= 0 ? seedAng[peerSlot] : seedAng[0];
        let delta = targetAng - from;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const frac = approachFrac + (1 - approachFrac) * (0.4 + 0.32 * Math.sin(el * 0.42 - 1.2)) * 0.95;
        const a = from + delta * frac;
        const r = RING_R * (0.86 + 0.08 * Math.sin(el * 0.73));
        worldOf(Math.cos(a) * r, 0, Math.sin(a) * r, goal);
        rise = 1.2 + 0.7 * Math.sin(el * 0.51);
        targetSpread = 1.6;
        k = 1.4;
        break;
      }
      case "atFile":
        slotWorld(TARGET, goal);
        orbitR = 0.7;
        orbitW = 0.9;
        targetSpread = 1.1;
        break;
      case "download":
        slotWorld(TARGET, goal);
        goal.multiplyScalar(0.9);
        orbitR = 1.1;
        orbitW = 0.7;
        targetSpread = 1.3;
        rise = 1.1;
        break;
      case "stall":
        slotWorld(TARGET, goal);
        goal.multiplyScalar(0.9);
        orbitR = 2.0;
        orbitW = 0.22;
        targetSpread = 1.8;
        rise = 1.4;
        wave = 0.3;
        break;
      case "checking":
        goal.set(0, LOOM_Y + LOOM_H * 0.5, 0);
        orbitR = LOOM_W * 0.72;
        orbitW = 0.75;
        targetSpread = 1.1;
        rise = 0;
        break;
      case "done":
        goal.set(0, LOOM_Y + LOOM_H * 0.55, 0);
        orbitR = LOOM_W * 0.95;
        orbitW = 0.12;
        targetSpread = 2.3;
        targetAlpha = 0.45;
        rise = 0;
        wave = 0.35;
        break;
      case "failed":
        targetAlpha = 0;
        orbitW = 0.1;
        goal.copy(pos);
        break;
      case "cancelled":
        goal.set(side * RING_R * 2.6, 4, 5);
        targetAlpha = el < 1 ? 1 : 0;
        targetSpread = 2;
        k = 0.9;
        break;
    }
    if (ctx.reducedMotion) { wave = 0; orbitW *= 0.3; }
    orbit += orbitW * speed * dt;
    goal.x += Math.cos(orbit) * orbitR;
    goal.z += Math.sin(orbit) * orbitR;
    goal.y += rise;

    const cohesion = Number(params.cohesion) || 1;
    targetSpread /= cohesion;
    if (snapping) {
      pos.copy(goal);
      vel.set(0, 0, 0);
      spread = targetSpread;
      alpha = targetAlpha;
      scatter = mode === "failed" ? 1 : 0;
    } else {
      const kk = k * speed * (ctx.reducedMotion ? 0.5 : 1);
      // Critically damped spring towards the goal.
      tmp.copy(goal).sub(pos).multiplyScalar(kk * kk * dt);
      vel.add(tmp).multiplyScalar(Math.exp(-2 * kk * dt));
      pos.addScaledVector(vel, dt);
      spread = approach(spread, targetSpread, 1.5, dt);
      alpha = approach(alpha, targetAlpha, mode === "failed" ? 0.8 : 1.6, dt);
      scatter = approach(scatter, mode === "failed" ? 1 : 0, 0.7, dt);
    }
    scatterPulse *= Math.exp(-dt * 1.8);

    // History: one sample every HIST_STEP_MS.
    histAcc += dt * 1000;
    const d = hist.image.data as Float32Array;
    let pushes = snapping ? HIST : 0;
    while (histAcc >= HIST_STEP_MS && pushes < 8) { histAcc -= HIST_STEP_MS; pushes++; }
    if (histAcc > HIST_STEP_MS) histAcc = 0;
    updateSquads();
    for (let p = 0; p < pushes; p++) {
      for (let r = 0; r <= SQUADS; r++) {
        const b = r * HIST * 4;
        d.copyWithin(b + 4, b, b + (HIST - 1) * 4);
        if (r === 0) {
          d[b] = pos.x; d[b + 1] = pos.y; d[b + 2] = pos.z; d[b + 3] = spread;
        } else {
          const s = r - 1;
          d[b] = sqPos[s * 3]; d[b + 1] = sqPos[s * 3 + 1]; d[b + 2] = sqPos[s * 3 + 2]; d[b + 3] = sqW[s];
        }
      }
    }
    if (pushes) hist.needsUpdate = true;

    const u = (flock.material as ShaderMaterial).uniforms;
    u.uTime.value += dt * speed * (ctx.reducedMotion ? 0.25 : 1);
    u.uAlpha.value = alpha * Math.sqrt(3500 / flockCount) * 0.2;
    u.uScatter.value = Math.max(scatter, scatterPulse * 0.35);
    u.uWave.value = approach(u.uWave.value, wave, 1, dt);
    u.uGrey.value = grey;
  }

  function updateStars(dt: number): void {
    // Seed stars slide when the real peer's position becomes known.
    for (let i = 0; i < seedCount; i++) {
      if (seedAng[i] !== seedAngTo[i]) {
        let dlt = seedAngTo[i] - seedAng[i];
        dlt = Math.atan2(Math.sin(dlt), Math.cos(dlt));
        seedAng[i] = Math.abs(dlt) < 0.002 || snapping ? seedAngTo[i] : seedAng[i] + dlt * (1 - Math.exp(-dt * 3));
        setLocal(SEEDS + i, seedAng[i], RING_R, 0.15);
      }
    }
    const pa = bright.geometry.getAttribute("position").array as Float32Array;
    const ba = bright.geometry.getAttribute("aBright").array as Float32Array;
    const sa = bright.geometry.getAttribute("aSize").array as Float32Array;
    const pulseDecay = Math.exp(-dt * (ctx.reducedMotion ? 1.2 : 2.6));
    for (let i = 0; i < BRIGHT; i++) {
      if (snapping) { bCur[i] = bBase[i]; bPulse[i] = 0; }
      bCur[i] = approach(bCur[i], bBase[i], 2.5, dt);
      bPulse[i] *= pulseDecay;
      const v = bCur[i] + bPulse[i] * (ctx.reducedMotion ? 0.5 : 1);
      ba[i] = v * (1 - grey * 0.6);
      sa[i] = bSize[i] * (1 + bPulse[i] * 0.8);
      pa[i * 3] = bLocal[i * 3]; pa[i * 3 + 1] = bLocal[i * 3 + 1]; pa[i * 3 + 2] = bLocal[i * 3 + 2];
    }
    bright.geometry.getAttribute("position").needsUpdate = true;
    bright.geometry.getAttribute("aBright").needsUpdate = true;
    bright.geometry.getAttribute("aSize").needsUpdate = true;
  }

  function updateThreads(): void {
    const pa = threads.geometry.getAttribute("position").array as Float32Array;
    const aa = threads.geometry.getAttribute("aA").array as Float32Array;
    const za = threads.geometry.getAttribute("aSize").array as Float32Array;
    const ending = ended();
    for (let i = 0; i < THREADS; i++) {
      const base = i * THREAD_PTS;
      if (!thActive[i]) {
        aa.fill(0, base, base + THREAD_PTS);
        continue;
      }
      const p = (clock - thStart[i]) / thDur[i];
      if (p >= 0 && !thLaunched[i]) {
        thLaunched[i] = 1;
        bPulse[thSlot[i]] = 0.9;
      }
      if (p >= 1 && thRow[i] >= 0) {
        landRow(thRow[i], thSide[i], thBright[i], false);
        thRow[i] = -1;
      }
      if (p >= 1.5) {
        thActive[i] = 0;
        aa.fill(0, base, base + THREAD_PTS);
        continue;
      }
      slotWorld(thSlot[i], p0);
      p2.set(thEnd[i * 3], thEnd[i * 3 + 1], thEnd[i * 3 + 2]);
      p1.copy(p0).add(p2).multiplyScalar(0.5);
      p1.y += 3.6;
      p1.z += 2.4;
      const head = ease(p);
      const fade = (p > 1 ? Math.max(0, 1 - (p - 1) * 2) : 1) * (ending ? Math.max(0, 1 - (clock - endAt) * 1.5) : 1);
      for (let j = 0; j < THREAD_PTS; j++) {
        const u = Math.min(1, Math.max(0, head - j * 0.011 - (p > 1 ? (p - 1) * 0.9 : 0)));
        const q = 1 - u;
        const k = base + j;
        pa[k * 3] = q * q * p0.x + 2 * q * u * p1.x + u * u * p2.x;
        pa[k * 3 + 1] = q * q * p0.y + 2 * q * u * p1.y + u * u * p2.y;
        pa[k * 3 + 2] = q * q * p0.z + 2 * q * u * p1.z + u * u * p2.z;
        const tail = 1 - j / THREAD_PTS;
        aa[k] = head - j * 0.011 <= 0 ? 0 : tail * tail * (0.35 + 0.75 * thBright[i]) * fade;
        za[k] = 1.1 + 2.6 * tail * tail;
      }
    }
    threads.geometry.getAttribute("position").needsUpdate = true;
    threads.geometry.getAttribute("aA").needsUpdate = true;
    threads.geometry.getAttribute("aSize").needsUpdate = true;
  }

  function placeCamera(): void {
    const drift = ctx.reducedMotion ? 0 : Number(params.drift);
    const yaw = drift * 0.32 * Math.sin(clock * 0.06);
    const pitch = (ctx.size === "card" ? PITCH - 0.08 : PITCH) + drift * 0.06 * Math.sin(clock * 0.045 + 1);
    camera.position.set(
      lookAt.x + Math.sin(yaw) * Math.cos(pitch) * camDist,
      lookAt.y + Math.sin(pitch) * camDist,
      lookAt.z + Math.cos(yaw) * Math.cos(pitch) * camDist,
    );
    camera.lookAt(lookAt);
  }

  /** Choose the look-at height and the nearest distance at which the whole ring and the loom fit. */
  function fitCamera(): void {
    const saved = clock;
    clock = 0;
    let bestD = 80, bestY = 2.3;
    const xMax = ctx.size === "card" ? 1.2 : 0.95; // card mode crops the ring's sides for bigger shapes
    for (let ly = 0.6; ly <= 3.2; ly += 0.2) {
      lookAt.y = ly;
      for (camDist = 12; camDist < bestD; camDist += 0.25) {
        placeCamera();
        camera.updateMatrixWorld();
        let fits = true;
        for (let i = 0; i < 48 && fits; i++) {
          const a = (i / 48) * Math.PI * 2;
          tmp.set(Math.cos(a) * RING_R * 1.06, 0, Math.sin(a) * RING_R * 1.06).project(camera);
          fits = Math.abs(tmp.x) < xMax && Math.abs(tmp.y) < 0.9;
        }
        if (fits) tmp.set(LOOM_W / 2, LOOM_Y + LOOM_H + (ctx.size === "card" ? 0.5 : 1.2), 0).project(camera);
        if (fits && tmp.y < 0.9) {
          bestD = camDist;
          bestY = ly;
          break;
        }
      }
    }
    lookAt.y = bestY;
    camDist = bestD;
    clock = saved;
  }

  /** Render the finished tapestry alone, straight on, and download it as a PNG. */
  function saveImage(): void {
    if (!renderer) return;
    const m = 0.45;
    const W = 1200, H = Math.round((W * (LOOM_H + 2 * m)) / (LOOM_W + 2 * m));
    const rt = new WebGLRenderTarget(W, H);
    rt.texture.colorSpace = SRGBColorSpace;
    const cy = LOOM_Y + LOOM_H / 2;
    const cam = new OrthographicCamera(-(LOOM_W / 2 + m), LOOM_W / 2 + m, LOOM_H / 2 + m, -(LOOM_H / 2 + m), 0.1, 50);
    cam.position.set(0, cy, 10);
    cam.lookAt(0, cy, 0);
    const still = new Scene();
    still.background = new Color(ctx.theme === "dark" ? "#0d1229" : "#1c2b52");
    const u = (loom.material as ShaderMaterial).uniforms;
    const keep = [u.uFlare.value, u.uScan.value, u.uShimmer.value, u.uGlow.value];
    u.uFlare.value = u.uScan.value = u.uShimmer.value = 0;
    u.uGlow.value = 1.6; // stands in for the bloom the live view adds
    still.add(loom);
    renderer.setRenderTarget(rt);
    renderer.render(still, cam);
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    renderer.setRenderTarget(null);
    scene.add(loom);
    [u.uFlare.value, u.uScan.value, u.uShimmer.value, u.uGlow.value] = keep;
    rt.dispose();

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d")!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // WebGL rows are bottom-up
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    g.putImageData(img, 0, 0);
    const base = (state.name ?? "").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || state.address.slice(0, 12) || "file";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}-tapestry.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  function setMode(m: Mode): void {
    if (mode === m) return;
    mode = m;
    modeSince = clock;
  }

  function deriveMode(): void {
    switch (state.phase) {
      case "idle": setMode("idle"); break;
      case "connecting": setMode(state.peers > 0 ? "peer" : "arrive"); break;
      case "finding": setMode(mapAt < Infinity ? "atFile" : state.peers > 0 || state.seeds > 0 ? "search" : "arrive"); break;
      case "downloading": setMode(state.stalled ? "stall" : "download"); break;
      case "verifying":
      case "saving":
        if (verifiedAt < Infinity) setMode("done");
        else setMode(landed >= total && total > 0 ? "checking" : "download");
        break;
      case "done": setMode("done"); break;
      case "failed": setMode("failed"); break;
      case "cancelled": setMode("cancelled"); break;
    }
    if (mode === "checking" && checkingAt === Infinity) checkingAt = clock;
  }

  // ---------------------------------------------------------------------------

  return {
    id: "murmuration",
    title: "Murmuration",
    theme: "artistic",
    wantsEnriched: false,
    libs: ["three.js r186 (WebGL2)", "UnrealBloomPass"],
    illustrativeNote: "the flock's path and the star positions",
    tweakables,

    mount(c) {
      ctx = c;
      params = { ...params, ...c.params };
      try {
        renderer = acquireRenderer();
      } catch {
        fallback = document.createElement("p");
        fallback.textContent = "This skin needs WebGL, which isn't available here.";
        fallback.style.cssText = "margin:0;padding:24px;font:500 16px system-ui;color:#c9cbd3;background:#0b0d14;height:100%;box-sizing:border-box";
        c.container.appendChild(fallback);
        return;
      }
      c.container.appendChild(renderer.domElement);
      renderer.setClearColor(0x000000, 1);
      // A night sky in both themes (additive light needs a dark ground); the light theme gets a dusk blue.
      scene.add(c.theme === "dark" ? makeSky("#04060e", "#0d1229") : makeSky("#1c2b52", "#3b5288"));

      const rand = prng(c.seed, 1);
      seedWord = (c.seed[0] | (c.seed[1] << 8) | (c.seed[2] << 16) | (c.seed[3] << 24)) >>> 0;
      side = c.seed[10] & 1 ? 1 : -1;
      ringRot = rand() * Math.PI * 2;

      ring = makeRing(c.size === "full" ? 1400 : 900, rand);
      bright = makeBright();
      ringGroup.add(ring, bright);
      scene.add(ringGroup);

      hist = makeHistory();
      rowsTex = makeRowsTexture(1);
      portraitTex = makePortraitTexture(new Uint8Array(8 * 16));
      loom = makeLoom(rowsTex, portraitTex);
      loom.renderOrder = 1;
      scene.add(loom);
      threads = makeThreads();
      threads.renderOrder = 4;
      scene.add(threads);

      // Seeded star slots: 16 seed positions, the file's point and its neighbours.
      for (let i = 0; i < SEED_MAX; i++) {
        seedAng[i] = seedAngTo[i] = rand() * Math.PI * 2;
        setLocal(SEEDS + i, seedAng[i], RING_R, 0.15);
        bSize[SEEDS + i] = 4.4;
      }
      // The file's place in the address space: the first 16 bits of its address.
      targetAng = (((c.seed[0] << 8) | c.seed[1]) / 65536) * Math.PI * 2;
      setLocal(TARGET, targetAng, RING_R, 0.1);
      bSize[TARGET] = 4.2;
      for (let i = 0; i < FLICKER_N; i++) bSize[FLICKER + i] = 2;
      for (let i = 0; i < ORIGIN_N; i++) bSize[ORIGIN + i] = 3;

      buildFlock();
      applyLook();

      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new Vector2(256, 256), Number(params.bloom), 0.5, 0.3);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      pos.set(side * RING_R * 2.4, 3, 6);

      if (c.size === "full") {
        saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "Save image";
        saveBtn.title = "Download the finished tapestry as a PNG";
        saveBtn.style.cssText =
          "position:absolute;top:12px;right:12px;display:none;padding:6px 14px;border-radius:8px;border:1px solid #ffffff55;" +
          "background:#0009;color:#fff;font:500 13px system-ui,sans-serif;cursor:pointer";
        saveBtn.addEventListener("click", saveImage);
        c.container.appendChild(saveBtn);
      }
    },

    onEvent(e: VizEvent) {
      reduce(state, e);
      if (!renderer) return;
      switch (e.type) {
        case "session.start":
          bBase[TARGET] = 0.35;
          break;
        case "connect.start":
          seedCount = Math.max(1, Math.min(SEED_MAX, e.seeds));
          for (let i = 0; i < seedCount; i++) {
            bBase[SEEDS + i] = 1.0;
            bPulse[SEEDS + i] = 0.6;
          }
          if (!snapping) pos.set(side * RING_R * 2.4, 3, 6);
          break;
        case "connect.peer": {
          const a = ringAngle(e.peerId, seedAng[0]);
          if (peerSlot < 0) {
            let best = 0, bestD = 9;
            for (let i = 0; i < Math.max(1, seedCount); i++) {
              const d = Math.abs(Math.atan2(Math.sin(seedAng[i] - a), Math.cos(seedAng[i] - a)));
              if (d < bestD) { bestD = d; best = i; }
            }
            peerSlot = SEEDS + best;
            seedAngTo[best] = a;
            if (seedCount === 0) seedCount = 1;
            bBase[peerSlot] = 1.2;
            bPulse[peerSlot] = 1.4;
            bSize[peerSlot] = 4;
            applyLook();
          }
          break;
        }
        case "lookup.round": {
          approachFrac += (1 - approachFrac) * 0.3;
          const n = Math.min(6, e.returned);
          for (let i = 0; i < n; i++) {
            const s = FLICKER + (flickerNext++ % FLICKER_N);
            const r = hash01(seedWord + e.iteration, i);
            setLocal(s, targetAng + (r - 0.5) * 2.4 * (1 - approachFrac), RING_R + (hash01(i, e.iteration) - 0.5), 0);
            bBase[s] = 0.3;
            bPulse[s] = 0.9;
          }
          break;
        }
        case "lookup.fail": {
          const s = FLICKER + ((flickerNext + FLICKER_N - 1) % FLICKER_N);
          bBase[s] = 0.06;
          if (!snapping) scatterPulse = 1;
          break;
        }
        case "datamap.verified":
          mapAt = stamp();
          bBase[TARGET] = 1.1;
          bPulse[TARGET] = 1.6;
          break;
        case "datamap.nested":
          bPulse[TARGET] = Math.max(bPulse[TARGET], 0.7);
          break;
        case "file.meta":
          break;
        case "chunk.done":
          ensureLoom(e.total);
          for (let r = woven; r < Math.min(e.completed, total); r++) {
            burst++;
            spawnThread(r);
          }
          woven = Math.max(woven, Math.min(e.completed, total));
          break;
        case "rate":
          if (e.chunksPerSec > maxRate) maxRate = e.chunksPerSec;
          rateBright = maxRate > 0 ? Math.min(1, 0.25 + 0.75 * (e.chunksPerSec / maxRate)) : 0.7;
          break;
        case "file.verified": {
          if (loomAt === Infinity || total === 0) {
            // openFile() streams send no chunk progress: weave the whole piece at once.
            ensureLoom(state.total ?? 1);
            for (let r = woven; r < total; r++) landRow(r, r & 1, 0.8, snapping);
            woven = total;
          }
          verifiedAt = stamp();
          const hb = seedFromAddress(e.hash);
          (portraitTex.image.data as Uint8Array).set(portraitCells(hb));
          portraitTex.needsUpdate = true;
          break;
        }
        case "session.failed":
        case "connect.failed":
        case "session.cancelled":
          if (endAt === Infinity) endAt = stamp();
          break;
      }
    },

    frame(dtMs) {
      if (!renderer || !w) return;
      const dt = Math.min(dtMs, 100) / 1000;
      clock += dt;
      deriveMode();
      if (!ctx.reducedMotion) ringRot += dt * 0.012;
      ringGroup.rotation.y = ringRot;

      // Ongoing looks.
      shimmer = approach(shimmer, mode === "stall" ? 1 : 0, 2, dt);
      scan = approach(scan, mode === "checking" ? 1 : 0, 2.5, dt);
      grey = approach(grey, mode === "failed" ? 1 : 0, snapping ? 1e3 : 1.2, dt);
      dim = approach(dim, mode === "cancelled" ? 0.55 : 1, snapping ? 1e3 : 1, dt);
      warpFade = approach(warpFade, mode === "cancelled" ? 0 : mode === "failed" ? 0.4 : mode === "done" ? 0.25 : 1, snapping ? 1e3 : 1, dt);
      ringAlpha = approach(ringAlpha, mode === "failed" ? 0.35 : mode === "idle" ? 0.6 : 1, snapping ? 1e3 : 1, dt);
      if (mode === "failed" && seedCount) for (let i = 0; i < seedCount; i++) bBase[SEEDS + i] = Math.min(bBase[SEEDS + i], 0.2);

      steer(dt);
      updateStars(dt);
      updateThreads();

      const lu = (loom.material as ShaderMaterial).uniforms;
      lu.uTime.value = clock;
      lu.uAppear.value = ease((clock - loomAt) / 1.6);
      lu.uShimmer.value = shimmer;
      lu.uScan.value = scan * (ctx.reducedMotion ? 0.5 : 1);
      lu.uScanPos.value = 0.5 - 0.5 * Math.cos((clock - (checkingAt === Infinity ? clock : checkingAt)) * (ctx.reducedMotion ? 0.6 : 1.5));
      const sinceV = clock - verifiedAt;
      lu.uFlare.value = sinceV < 0 ? 0 : ctx.reducedMotion ? 0.25 * Math.sin(Math.min(1, sinceV / 2.4) * Math.PI) : Math.min(1, sinceV / 0.15) * Math.exp(-sinceV * 1.6);
      lu.uHashMix.value = ease((sinceV - 0.25) / 1.6);
      lu.uGrey.value = grey;
      lu.uDim.value = dim;
      lu.uWarpFade.value = warpFade;
      lu.uReveal.value = ctx.reducedMotion ? 1.2 : 0.45;
      (ring.material as ShaderMaterial).uniforms.uTime.value = clock;
      (ring.material as ShaderMaterial).uniforms.uAlpha.value = ringAlpha;
      (threads.material as ShaderMaterial).uniforms.uGrey.value = grey;

      const show = verifiedAt < Infinity && mode === "done";
      if (saveBtn && show !== saveShown) {
        saveShown = show;
        saveBtn.style.display = show ? "block" : "none";
      }

      placeCamera();
      composer.render(dt);
      snapping = false;
      burst = 0;
    },

    resize(nw, nh, dpr) {
      w = nw;
      if (!renderer) return;
      renderer.setPixelRatio(dpr);
      renderer.setSize(nw, nh, false);
      composer.setPixelRatio(dpr);
      composer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      fitCamera();
      px = dpr * Math.min(1.6, Math.max(0.6, nh / 420));
      for (const m of [ring, bright, flock, threads]) (m.material as ShaderMaterial).uniforms.uPx.value = px;
    },

    setParams(p) {
      params = { ...params, ...p };
      if (!renderer) return;
      buildFlock();
      applyLook();
      bloom.strength = Number(params.bloom);
    },

    describe() {
      return describeState(state);
    },

    destroy() {
      if (fallback) fallback.remove();
      saveBtn?.remove();
      if (!renderer) return;
      scene.traverse((o) => {
        const m = o as Partial<Mesh>;
        m.geometry?.dispose();
        (m.material as ShaderMaterial | undefined)?.dispose();
      });
      hist.dispose();
      rowsTex.dispose();
      portraitTex.dispose();
      bloom.dispose();
      composer.dispose();
      renderer = null;
      releaseRenderer();
    },

    stats() {
      let threadsInFlight = 0;
      for (let i = 0; i < THREADS; i++) threadsInFlight += thActive[i];
      return { particles: flockCount, threads: threadsInFlight, rows: landed };
    },
  };
}
