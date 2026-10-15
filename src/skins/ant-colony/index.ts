// Ant colony (Playful 2): scouts lay pheromone trails to find the file, workers march in from nests
// round the edge carrying crumbs (chunks) to build a cake (the file), an inspector checks it, and
// the colony celebrates. Rain sends everyone home if the download fails.
//
// Real (Tier A): every phase and its timing; the seed count and which seed answered (the seed nests
// sit round the edge by their real addresses); lookup rounds and failed queries when reported (new
// nests at the answering node's real address, closed nests); the chunk count and total (cake
// pieces); the rate (how many workers are on the way); stalls; verification and the hash (the cherry);
// failure and cancel. Illustrative: the scouts' search while the file is found (SDK 0.1.2 sends no
// lookup rounds), which nest each crumb comes from, and dropped crumbs (Tier C retries).

import { prng } from "../../events/seed";
import { describeState, initialState, reduce } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { BUNDLED_SEEDS, frac, sharedBits } from "../../events/xor";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";
import { Carry, drawAnt, type AntLook } from "./characters/ant";

const tweakables: TweakDef[] = [
  { key: "ants", label: "ant count cap", kind: "number", min: 40, max: 400, step: 10, default: 220 },
  { key: "trails", label: "trail visibility", kind: "number", min: 0, max: 1.5, step: 0.05, default: 0.8 },
  { key: "cake", label: "cake style", kind: "select", options: { "layer cake": "cake", "file icon": "file" }, default: "cake" },
  { key: "nests", label: "nest art", kind: "select", options: { "earth mounds": "mound", "acorn houses": "acorn" }, default: "mound" },
];

const MAX_ANTS = 400;
const MAX_PIECES = 60;

type Role = "off" | "scout" | "courier" | "worker" | "inspector" | "home" | "mapper";
type Step = "out" | "back" | "wait" | "place" | "circle" | "stand";

interface Ant {
  role: Role;
  step: Step;
  x: number; y: number; a: number;
  tx: number; ty: number;
  speed: number;
  phase: number;
  carry: Carry;
  nest: number;
  piece: number;
  timer: number;
  tdx: number; tdy: number; // last trail deposit
  seed: number;
}

interface Nest { x: number; y: number; id: string; kind: "seed" | "node"; open: boolean; closed: boolean; at: number; bits: number }


const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function hash01(a: number, b: number): number {
  let x = Math.imul(a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export default function create(): Skin {
  let ctx!: SkinContext;
  let params = defaultParams(tweakables);
  const state = initialState();
  let canvas!: HTMLCanvasElement;
  let g!: CanvasRenderingContext2D;
  let trail!: HTMLCanvasElement;
  let tg!: CanvasRenderingContext2D;
  let w = 0, h = 0, dpr = 1;

  let clock = 0;
  let snapping = true;
  const stamp = () => (snapping ? -1e3 : clock);
  let seedWord = 0;

  // Layout (logical units per size).
  let L = layout("full");
  function layout(size: "card" | "full") {
    return size === "card"
      ? { W: 360, H: 220, cx: 180, cy: 116, rx: 158, ry: 88, hillX: 138, hillY: 122, hillR: 20, cakeX: 222, cakeY: 150, cakeW: 84, cakeH: 70, s: 0.85, nestR: 11 }
      : { W: 960, H: 540, cx: 480, cy: 286, rx: 410, ry: 222, hillX: 392, hillY: 310, hillR: 44, cakeX: 572, cakeY: 352, cakeW: 170, cakeH: 140, s: 1.15, nestR: 20 };
  }

  const ants: Ant[] = Array.from({ length: MAX_ANTS }, () => ({
    role: "off" as Role, step: "out" as Step, x: 0, y: 0, a: 0, tx: 0, ty: 0, speed: 0, phase: 0,
    carry: Carry.None as Carry, nest: 0, piece: -1, timer: 0, tdx: 0, tdy: 0, seed: 0,
  }));
  let spawned = 0;
  const nests: Nest[] = [];
  const nestById = new Map<string, number>();
  let peerNest = -1;
  let target = "";

  // Cake.
  let total = 0, perPiece = 1, pieceN = 0;
  const pieces: { x: number; y: number; w: number; h: number; fill: number; at: number; row: number }[] = [];
  let placedChunks = 0;
  let hillOpen = 0;

  let connectAt = Infinity, findAt = Infinity, mapAt = Infinity, totalAt = Infinity, verifiedAt = Infinity, endAt = Infinity;
  let cardPinned = false;
  let trailScout = "", trailWorker = "";
  const crumbColours: string[] = [];
  const dropped: { x: number; y: number; until: number; colour: string }[] = [];
  let C = colours(false);
  let look: AntLook = { body: "#2a1b14", shine: "rgba(255,255,255,0.35)", leg: "#2a1b14" };
  let cakeHue = 340;

  function colours(dark: boolean) {
    return dark
      ? { ground: "#2a2f22", ground2: "#323927", trail: "rgba(190,230,120,", hill: "#5a4632", hill2: "#3e3022", hole: "#120d09", plate: "#c9ccd6", outline: "rgba(220,220,240,0.35)", text: "#e9e6da", cloud: "#59607a", rain: "rgba(170,190,255,0.6)" }
      : { ground: "#d9c99d", ground2: "#cfbd8c", trail: "rgba(120,80,30,", hill: "#a7764a", hill2: "#8a5f3a", hole: "#2a1a0e", plate: "#ffffff", outline: "rgba(90,60,40,0.4)", text: "#3b2a1c", cloud: "#8d95a8", rain: "rgba(90,120,200,0.55)" };
  }

  // ---------------------------------------------------------------------------
  // Nests.

  function nestPos(f: number, inset: number): { x: number; y: number } {
    const a = -Math.PI / 2 + f * Math.PI * 2;
    return { x: L.cx + Math.cos(a) * L.rx * inset, y: L.cy + Math.sin(a) * L.ry * inset };
  }

  function addNest(id: string, kind: "seed" | "node"): number {
    const known = nestById.get(id);
    if (known !== undefined) return known;
    const bits = target ? sharedBits(id, target) : 0;
    // Node nests sit at their real angle, spread inward so a busy lookup doesn't pile them up.
    if (kind === "node" && nests.length >= 7 + 24) return -1; // enough nests drawn; later rounds still count
    const inset = kind === "seed" ? 1 : 0.55 + hash01(parseInt(id.slice(8, 16), 16) | 0, 41) * 0.4;
    const p = nestPos(frac(id), inset);
    nests.push({ x: p.x, y: p.y, id, kind, open: false, closed: false, at: stamp(), bits });
    nestById.set(id, nests.length - 1);
    return nests.length - 1;
  }

  /** The open nest nearest the file's direction (where scouts head). */
  function nestTowardFile(): number {
    let best = -1, bd = Infinity;
    const p = nestPos(frac(target || "80"), 1);
    for (let i = 0; i < nests.length; i++) {
      if (nests[i].closed) continue;
      const d = (nests[i].x - p.x) ** 2 + (nests[i].y - p.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Ants.

  function spawn(role: Role, x: number, y: number, tx: number, ty: number, carry: Carry = Carry.None): Ant | null {
    const cap = Math.min(MAX_ANTS, Number(params.ants));
    let live = 0, scouts = 0;
    let free: Ant | null = null;
    for (const a of ants) {
      if (a.role !== "off") live++;
      else if (!free) free = a;
      if (a.role === "scout") scouts++;
    }
    if (!free || (live >= cap && role === "worker") || (role === "scout" && scouts >= 14)) return null;
    const n = spawned++;
    Object.assign(free, {
      role, step: "out" as Step, x, y, tx, ty, a: Math.atan2(ty - y, tx - x), speed: role === "scout" ? 70 : 52,
      phase: hash01(seedWord, n) * 6, carry, nest: -1, piece: -1, timer: 0, tdx: x, tdy: y, seed: n,
    });
    return free;
  }

  function hillMouth(): { x: number; y: number } {
    return { x: L.hillX + L.hillR * 0.55, y: L.hillY + L.hillR * 0.1 };
  }

  function waitSpot(a: Ant): { x: number; y: number } {
    // Workers queue in a loose ring just outside the plate.
    const t = hash01(a.seed, 3) * Math.PI * 2;
    return { x: L.cakeX + Math.cos(t) * L.cakeW * 0.62, y: L.cakeY + 14 * L.s + Math.abs(Math.sin(t)) * 18 * L.s };
  }

  function sendScouts(): void {
    const m = hillMouth();
    for (let i = 0; i < nests.length; i++) {
      if (nests[i].kind !== "seed") continue;
      const a = spawn("scout", m.x, m.y, nests[i].x, nests[i].y);
      if (a) { a.nest = i; a.speed = 90; }
    }
  }

  function workerFor(piece: number): void {
    // Pick the waiting worker nearest the cake, else one pops out of the hill with a crumb.
    let best: Ant | null = null, bd = Infinity;
    for (const a of ants) {
      if (a.role !== "worker" || a.step !== "wait") continue;
      const d = (a.x - L.cakeX) ** 2 + (a.y - L.cakeY) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) {
      const m = hillMouth();
      best = spawn("worker", m.x, m.y, m.x, m.y, Carry.Crumb);
      if (!best) { finishPiece(piece); return; }
    }
    best.step = "place";
    best.piece = piece;
    const p = pieces[piece];
    best.tx = p.x + p.w / 2;
    best.ty = p.y + p.h / 2;
    best.speed = 120;
  }

  function finishPiece(piece: number): void {
    const p = pieces[piece];
    if (!p) return;
    p.fill = Math.min(perPiece, p.fill + 1);
    p.at = stamp();
  }

  function stepAnts(dt: number): void {
    const stalled = state.stalled;
    for (const a of ants) {
      if (a.role === "off") continue;
      if (a.timer > 0) {
        // Picking a dropped crumb back up.
        if (clock < a.timer) { a.phase += dt * 2; continue; }
        a.timer = 0;
        if (a.role === "worker") a.carry = Carry.Crumb;
      }
      const dx = a.tx - a.x, dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      const standing = a.step === "wait" || a.step === "stand";
      if (d > 2 && !(standing && d < 6)) {
        // Steer toward the target with a little wander.
        const want = Math.atan2(dy, dx) + Math.sin(clock * 3 + a.seed) * 0.35;
        let da = want - a.a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a.a += Math.max(-6 * dt, Math.min(6 * dt, da));
        const v = Math.min(d / dt, a.speed * L.s);
        a.x += Math.cos(a.a) * v * dt;
        a.y += Math.sin(a.a) * v * dt;
        a.phase += v * dt * 0.55;
        // Pheromone.
        if ((a.x - a.tdx) ** 2 + (a.y - a.tdy) ** 2 > 36 * L.s && (a.role === "scout" || a.carry === Carry.Crumb)) {
          tg.fillStyle = a.role === "scout" ? trailScout : trailWorker;
          tg.beginPath();
          tg.arc(a.x, a.y, 1.3 * L.s, 0, Math.PI * 2);
          tg.fill();
          a.tdx = a.x; a.tdy = a.y;
        }
        continue;
      }
      arrive(a, stalled);
    }
  }

  function arrive(a: Ant, stalled: boolean): void {
    const m = hillMouth();
    switch (a.role) {
      case "scout": {
        if (a.step === "out") {
          const n = nests[a.nest];
          if (n?.closed) {
            // Bumped into a closed nest: turn round.
            a.step = "back"; a.tx = m.x; a.ty = m.y; a.a += Math.PI;
          } else if (state.phase === "finding" && n && mapAt === Infinity) {
            // Search on toward the file (illustrative unless real rounds open new nests).
            const k = nestTowardFile();
            const tn = nests[k] ?? n;
            a.nest = k;
            a.tx = tn.x + (hash01(a.seed, clock | 0) - 0.5) * 30;
            a.ty = tn.y + (hash01(a.seed, (clock | 0) + 9) - 0.5) * 20;
            a.step = "back";
          } else { a.step = "back"; a.tx = m.x; a.ty = m.y; }
        } else if (a.step === "back") {
          if (Math.hypot(a.x - m.x, a.y - m.y) < 8) {
            if ((state.phase === "finding" || state.phase === "connecting") && !state.rounds) {
              const k = nestTowardFile();
              if (k >= 0) { a.step = "out"; a.nest = k; a.tx = nests[k].x; a.ty = nests[k].y; }
            } else a.role = "off";
          } else { a.tx = m.x; a.ty = m.y; }
        }
        break;
      }
      case "courier":
        if (a.step === "out") { a.step = "back"; a.tx = L.cakeX - L.cakeW * 0.75; a.ty = L.cakeY + 6; }
        else { cardPinned = true; a.carry = Carry.None; a.role = "home"; a.tx = m.x; a.ty = m.y; }
        break;
      case "worker":
        if (a.step === "out") {
          a.step = "wait";
          const s = waitSpot(a);
          a.tx = s.x; a.ty = s.y;
        } else if (a.step === "wait") {
          if (stalled) {
            // Mill about.
            const s = waitSpot(a);
            a.tx = s.x + (hash01(a.seed, clock * 2 | 0) - 0.5) * 50 * L.s;
            a.ty = s.y + (hash01(a.seed + 1, clock * 2 | 0) - 0.5) * 24 * L.s;
          }
        } else if (a.step === "place") {
          finishPiece(a.piece);
          a.carry = Carry.None;
          a.step = "back";
          const n = nests[a.nest];
          a.tx = n ? n.x : m.x; a.ty = n ? n.y : m.y;
          a.speed = 60;
        } else if (a.step === "back") a.role = "off";
        break;
      case "inspector":
        if (verifiedAt < Infinity) { a.step = "stand"; a.tx = L.cakeX; a.ty = L.cakeY - L.cakeH - 6 * L.s; a.a = Math.PI / 2; }
        else {
          a.step = "circle";
          const t = clock * 0.9;
          a.tx = L.cakeX + Math.cos(t) * L.cakeW * 0.6;
          a.ty = L.cakeY + Math.sin(t) * 12 * L.s;
        }
        break;
      case "mapper":
        a.step = "stand";
        break;
      case "home":
        a.role = "off";
        break;
      default:
        a.role = "off";
    }
  }

  function manageWorkers(dt: number): void {
    if (state.phase !== "downloading" || !total || endAt < Infinity) return;
    // Keep enough laden workers on the way for the current rate (about 4 s of chunks).
    let coming = 0;
    for (const a of ants) if (a.role === "worker" && a.carry === Carry.Crumb && a.step !== "place") coming++;
    const want = Math.max(2, Math.min(24, Math.ceil(state.chunksPerSec * 4) + 1));
    const left = total - state.completed;
    if (coming < Math.min(want, left) && hash01(seedWord, clock * 10 | 0) < dt * 6) {
      const open = nests.filter((n) => !n.closed);
      if (!open.length) return;
      const k = nests.indexOf(open[Math.floor(hash01(seedWord + spawned, 5) * open.length)]);
      const n = nests[k];
      const s = { x: L.cakeX, y: L.cakeY };
      const a = spawn("worker", n.x, n.y, s.x, s.y, Carry.Crumb);
      if (a) a.nest = k;
    }
  }

  // ---------------------------------------------------------------------------
  // Cake.

  function layoutCake(): void {
    pieces.length = 0;
    if (!pieceN) return;
    // Three tiers (or one document page) of fixed size: the pieces shrink to fit, so the cake's
    // height never depends on the file's size.
    const fileStyle = params.cake === "file";
    const tiers = fileStyle ? [0.72] : [1, 0.72, 0.46];
    const tierH = (L.cakeH - 4) / tiers.length;
    let bh = 18 * L.s;
    for (; bh > 4; bh -= 0.5) {
      let cap = 0;
      for (const k of tiers) cap += Math.floor(tierH / bh) * Math.max(1, Math.floor((L.cakeW * k) / (bh * 1.4)));
      if (cap >= pieceN) break;
    }
    let placed = 0, row = 0, y = L.cakeY - bh;
    for (let t = 0; t < tiers.length && placed < pieceN; t++) {
      const width = L.cakeW * tiers[t];
      const per = Math.max(1, Math.floor(width / (bh * 1.4)));
      const rows = Math.floor(tierH / bh);
      for (let r = 0; r < rows && placed < pieceN; r++) {
        const n = Math.min(per, pieceN - placed);
        const bw = width / per;
        for (let i = 0; i < n; i++) pieces.push({ x: L.cakeX - width / 2 + i * bw, y, w: bw - 1.2, h: bh - 1.2, fill: 0, at: -1e3, row: t });
        placed += n;
        row++;
        y -= bh;
      }
    }
  }

  function setTotal(n: number): void {
    if (n === total) return;
    total = n;
    perPiece = Math.max(1, Math.ceil(n / MAX_PIECES));
    pieceN = Math.max(1, Math.ceil(n / perPiece));
    layoutCake();
  }

  function pieceColour(p: { row: number }, i: number): string {
    const tier = p.row % 3;
    return tier === 0 ? `hsl(${cakeHue} 60% ${74 - (i % 2) * 4}%)` : tier === 1 ? `hsl(35 55% ${70 - (i % 2) * 4}%)` : `hsl(${(cakeHue + 40) % 360} 45% ${64 - (i % 2) * 4}%)`;
  }

  function drawCake(): void {
    if (!pieces.length) return;
    const top = pieces[pieces.length - 1].y;
    const failed = state.phase === "failed";
    // Plate.
    g.fillStyle = C.plate;
    g.beginPath();
    g.ellipse(L.cakeX, L.cakeY + 3 * L.s, L.cakeW * 0.62, 10 * L.s, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C.outline;
    g.lineWidth = 1;
    g.stroke();
    // Blueprint outline: every piece to come.
    if (totalAt < Infinity && verifiedAt === Infinity) {
      g.setLineDash([3, 3]);
      g.strokeStyle = C.outline;
      for (const p of pieces) if (p.fill === 0) g.strokeRect(p.x, p.y, p.w, p.h);
      g.setLineDash([]);
    }
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.fill <= 0) continue;
      const k = p.fill / perPiece;
      const pop = ctx.reducedMotion ? 0 : Math.max(0, 1 - (clock - p.at) / 0.25) * 2;
      g.fillStyle = failed ? "#9a958c" : pieceColour(p, i);
      g.beginPath();
      g.roundRect(p.x - pop, p.y + p.h * (1 - k) - pop, p.w + pop * 2, p.h * k + pop, 2);
      g.fill();
      if (k >= 1) {
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.fillRect(p.x + 1, p.y + 1, p.w - 2, Math.max(1.5, p.h * 0.18));
      }
    }
    if (params.cake === "file" && pieces.length) {
      // The folded corner of a document.
      const right = Math.max(...pieces.map((p) => p.x + p.w));
      const f = Math.min(18 * L.s, L.cakeW * 0.2);
      g.fillStyle = C.ground;
      g.beginPath();
      g.moveTo(right - f, top - 0.5); g.lineTo(right + 1, top - 0.5); g.lineTo(right + 1, top + f);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.beginPath();
      g.moveTo(right - f, top); g.lineTo(right - f, top + f); g.lineTo(right, top + f);
      g.fill();
    }
    // The cherry on top, coloured by the hash, and the inspector's tick.
    if (verifiedAt < Infinity && state.hash) {
      const k = ease((clock - verifiedAt) / 0.5);
      const hue = Math.round((parseInt(state.hash.slice(0, 2), 16) / 255) * 360);
      g.fillStyle = `hsl(${hue} 75% 48%)`;
      g.beginPath();
      g.arc(L.cakeX, top - 5 * L.s * k, 5 * L.s * k, 0, Math.PI * 2);
      g.fill();
      const tk = ease((clock - verifiedAt - 0.4) / 0.4);
      if (tk > 0) {
        g.strokeStyle = "#2e9e5b";
        g.lineWidth = 4 * L.s;
        g.lineCap = "round";
        g.beginPath();
        const tx = L.cakeX + L.cakeW * 0.42, ty = top - 18 * L.s;
        g.moveTo(tx - 8 * L.s, ty);
        g.lineTo(tx - 8 * L.s + 6 * L.s * Math.min(1, tk * 2), ty + 6 * L.s * Math.min(1, tk * 2));
        if (tk > 0.5) g.lineTo(tx - 2 * L.s + 12 * L.s * (tk - 0.5) * 2, ty + 6 * L.s - 14 * L.s * (tk - 0.5) * 2);
        g.stroke();
      }
    }
    if (cardPinned && ctx.size === "full") {
      // The recipe card (the DataMap), pinned by the plate.
      const x = L.cakeX - L.cakeW * 0.82, y = L.cakeY - 26;
      g.fillStyle = "#fffdf4";
      g.save();
      g.translate(x, y);
      g.rotate(-0.12);
      g.fillRect(-16, -12, 32, 24);
      g.strokeStyle = "#c0392b";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) { g.moveTo(-11, -5 + i * 6); g.lineTo(11 - i * 4, -5 + i * 6); }
      g.stroke();
      g.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Scene.

  function drawGround(): void {
    g.fillStyle = C.ground;
    g.fillRect(-20, -20, L.W + 40, L.H + 40);
    g.fillStyle = C.ground2;
    for (let i = 0; i < 140; i++) {
      const x = hash01(i, 1) * L.W, y = hash01(i, 2) * L.H;
      g.beginPath();
      g.ellipse(x, y, (1 + hash01(i, 3) * 2.5) * L.s, (0.8 + hash01(i, 4) * 1.5) * L.s, hash01(i, 5) * 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawNest(n: Nest): void {
    const k = ctx.reducedMotion ? 1 : ease((clock - n.at) / 0.4);
    if (k <= 0) return;
    const r = L.nestR * (n.kind === "seed" ? 1 : 0.62) * k;
    if (params.nests === "acorn") {
      g.fillStyle = n.closed ? "#8a7f70" : "#b9884d";
      g.beginPath();
      g.ellipse(n.x, n.y + r * 0.15, r * 0.85, r, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#6b4a2b";
      g.beginPath();
      g.ellipse(n.x, n.y - r * 0.55, r, r * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = n.closed ? "#5a5550" : C.hole;
      g.beginPath();
      g.roundRect(n.x - r * 0.25, n.y, r * 0.5, r * 0.65, [r * 0.25, r * 0.25, 0, 0]);
      g.fill();
    } else {
      g.fillStyle = C.hill2;
      g.beginPath();
      g.ellipse(n.x, n.y, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.hill;
      g.beginPath();
      g.ellipse(n.x, n.y - r * 0.12, r, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = n.closed ? "#8f877b" : C.hole;
      g.beginPath();
      g.ellipse(n.x, n.y - r * 0.18, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (n.closed) {
      g.strokeStyle = "#c0392b";
      g.lineWidth = 2 * L.s;
      g.beginPath();
      g.moveTo(n.x - r * 0.3, n.y - r * 0.4); g.lineTo(n.x + r * 0.3, n.y + r * 0.05);
      g.moveTo(n.x + r * 0.3, n.y - r * 0.4); g.lineTo(n.x - r * 0.3, n.y + r * 0.05);
      g.stroke();
    }
    const i = nests.indexOf(n);
    if (i === peerNest) {
      // The seed that answered flies a little flag.
      g.strokeStyle = C.text;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(n.x + r * 0.6, n.y - r * 0.4);
      g.lineTo(n.x + r * 0.6, n.y - r * 1.8);
      g.stroke();
      g.fillStyle = "#e67e22";
      g.beginPath();
      g.moveTo(n.x + r * 0.6, n.y - r * 1.8);
      g.lineTo(n.x + r * 1.5, n.y - r * 1.5);
      g.lineTo(n.x + r * 0.6, n.y - r * 1.2);
      g.fill();
    }
  }

  function drawHill(): void {
    const R = L.hillR;
    g.fillStyle = C.hill2;
    g.beginPath();
    g.ellipse(L.hillX, L.hillY + R * 0.1, R * 1.25, R * 0.95, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.hill;
    g.beginPath();
    g.ellipse(L.hillX, L.hillY - R * 0.05, R, R * 0.75, 0, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 12; i++) {
      g.fillStyle = C.hill2;
      g.beginPath();
      g.arc(L.hillX + (hash01(i, 21) - 0.5) * R * 1.6, L.hillY + (hash01(i, 22) - 0.5) * R * 1.1, (1 + hash01(i, 23) * 1.6) * L.s, 0, Math.PI * 2);
      g.fill();
    }
    const m = hillMouth();
    g.fillStyle = C.hole;
    g.beginPath();
    g.ellipse(m.x, m.y, R * 0.28 * hillOpen + 0.5, R * 0.2 * hillOpen + 0.5, 0, 0, Math.PI * 2);
    g.fill();
    if (ctx.size === "full") {
      g.fillStyle = C.text;
      g.font = "600 11px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("your browser", L.hillX, L.hillY + R * 1.35);
    }
  }

  function drawRain(): void {
    if (state.phase !== "failed") return;
    const k = ease((clock - endAt) / 0.8);
    const cx = L.cakeX - L.cakeW * 0.2, cy = L.cy - L.ry * 0.75;
    g.globalAlpha = k;
    g.fillStyle = C.cloud;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(cx - 60 * L.s + i * 30 * L.s, cy + (i % 2 ? -8 : 4) * L.s, (24 + (i % 2) * 8) * L.s, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = C.rain;
    g.lineWidth = 1.4 * L.s;
    g.beginPath();
    for (let i = 0; i < 40; i++) {
      const x = cx - 90 * L.s + hash01(i, 31) * 180 * L.s;
      const y = cy + 20 * L.s + ((clock * 260 * L.s + hash01(i, 32) * 400) % (220 * L.s));
      g.moveTo(x, y);
      g.lineTo(x - 2 * L.s, y + 9 * L.s);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  function drawDropped(): void {
    for (let i = dropped.length - 1; i >= 0; i--) {
      const d = dropped[i];
      if (clock > d.until) { dropped.splice(i, 1); continue; }
      g.fillStyle = d.colour;
      g.beginPath();
      g.roundRect(d.x - 2 * L.s, d.y - 2 * L.s, 4 * L.s, 4 * L.s, 1);
      g.fill();
    }
  }

  function drawAnts(): void {
    const dancing = verifiedAt < Infinity && endAt === Infinity && clock - verifiedAt > 0.9;
    for (const a of ants) {
      if (a.role === "off") continue;
      let ang = a.a, y = a.y;
      const moving = !(a.step === "wait" || a.step === "stand") || (state.stalled && a.role === "worker");
      if (dancing && !ctx.reducedMotion && (a.role === "worker" || a.role === "inspector" || a.step === "wait")) {
        ang += Math.sin(clock * 8 + a.seed) * 0.8;
        y -= Math.abs(Math.sin(clock * 6 + a.seed)) * 3 * L.s;
      }
      const crumb = crumbColours[a.seed % 6];
      drawAnt(g, a.x, y, ang, L.s, a.phase, moving || dancing ? 1 : 0.15, look, a.carry, crumb, a.role === "inspector");
    }
  }

  // ---------------------------------------------------------------------------

  return {
    id: "ant-colony",
    title: "Ant colony",
    theme: "playful",
    wantsEnriched: true,
    libs: ["Canvas 2D"],
    illustrativeNote: "the scouts' search, which nest each crumb comes from, and dropped crumbs",
    tweakables,

    mount(c: SkinContext) {
      ctx = c;
      params = { ...params, ...c.params };
      L = layout(c.size);
      C = colours(c.theme === "dark");
      trailScout = `${C.trail}0.32)`;
      trailWorker = `${C.trail}0.16)`;
      look = c.theme === "dark" ? { body: "#120c09", shine: "rgba(255,255,255,0.4)", leg: "#120c09" } : look;
      seedWord = (c.seed[0] | (c.seed[1] << 8) | (c.seed[2] << 16) | (c.seed[3] << 24)) >>> 0;
      cakeHue = Math.round((c.seed[6] / 255) * 360);
      for (let i = 0; i < 6; i++) crumbColours.push(pieceColour({ row: i % 3 }, i));
      canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%";
      c.container.appendChild(canvas);
      g = canvas.getContext("2d")!;
      trail = document.createElement("canvas");
      trail.width = L.W;
      trail.height = L.H;
      tg = trail.getContext("2d")!;
    },

    onEvent(e: VizEvent) {
      reduce(state, e);
      switch (e.type) {
        case "session.start":
          target = e.address;
          break;
        case "connect.start":
          for (const id of BUNDLED_SEEDS.slice(0, Math.min(e.seeds, BUNDLED_SEEDS.length))) addNest(id, "seed");
          if (e.seeds > BUNDLED_SEEDS.length) {
            const r = prng(ctx.seed, 77);
            for (let i = BUNDLED_SEEDS.length; i < Math.min(e.seeds, 12); i++) addNest(Math.floor(r() * 2 ** 32).toString(16).padStart(8, "0") + "0".repeat(56), "seed");
          }
          connectAt = stamp();
          if (!snapping) sendScouts();
          break;
        case "connect.peer": {
          const k = addNest(e.peerId, "seed");
          nests[k].open = true;
          peerNest = k;
          break;
        }
        case "connect.done":
          if (findAt === Infinity) findAt = stamp();
          break;
        case "lookup.round": {
          // A real node answered: a new nest at its address; a scout runs the trail to it.
          const k = addNest(e.peerId, "node");
          if (k < 0) break;
          nests[k].open = true;
          if (!snapping) {
            const m = hillMouth();
            const a = spawn("scout", m.x, m.y, nests[k].x, nests[k].y);
            if (a) { a.nest = k; a.speed = 110; }
          }
          break;
        }
        case "lookup.fail": {
          const k = addNest(e.peerId, "node");
          if (k < 0 || nests[k].kind === "seed") break;
          nests[k].closed = true;
          if (!snapping) {
            const m = hillMouth();
            const a = spawn("scout", m.x, m.y, nests[k].x, nests[k].y);
            if (a) { a.nest = k; a.speed = 110; }
          }
          break;
        }
        case "datamap.verified":
          if (mapAt === Infinity) {
            mapAt = stamp();
            const k = nestTowardFile();
            if (snapping || k < 0) cardPinned = true;
            else {
              const a = spawn("courier", nests[k].x, nests[k].y, L.hillX, L.hillY - L.hillR, Carry.Card);
              if (a) a.speed = 110;
              else cardPinned = true;
            }
          }
          break;
        case "chunk.done": {
          setTotal(e.total);
          if (totalAt === Infinity) totalAt = stamp();
          if (mapAt === Infinity) { mapAt = stamp(); cardPinned = true; }
          const n = e.completed - placedChunks;
          for (let i = 0; i < n; i++) {
            const piece = Math.min(pieceN - 1, Math.floor(placedChunks / perPiece));
            placedChunks++;
            if (snapping || n > 6) finishPiece(piece);
            else workerFor(piece);
          }
          break;
        }
        case "chunk.retry": {
          // Tier C: a worker on the way drops its crumb, pauses, and picks it up again.
          if (snapping) break;
          for (const a of ants) {
            if (a.role === "worker" && a.carry === Carry.Crumb && a.step === "out") {
              a.carry = Carry.None;
              a.timer = clock + 0.7;
              dropped.push({ x: a.x + Math.cos(a.a) * 9 * L.s, y: a.y + Math.sin(a.a) * 9 * L.s, until: a.timer, colour: pieceColour({ row: a.seed % 3 }, a.seed) });
              break;
            }
          }
          break;
        }
        case "chunk.stall":
          if (!snapping) {
            const m = hillMouth();
            const a = spawn("mapper", m.x, m.y, m.x + 28 * L.s, m.y + 16 * L.s, Carry.Map);
            if (a) a.speed = 40;
          }
          break;
        case "file.verified":
          if (!total) { setTotal(state.total ?? 12); for (let i = 0; i < pieceN; i++) { pieces[i].fill = perPiece; } }
          verifiedAt = stamp();
          break;
        case "session.failed":
        case "connect.failed":
        case "session.cancelled":
          if (endAt === Infinity) {
            endAt = stamp();
            const m = hillMouth();
            for (const a of ants) if (a.role !== "off") { a.role = "home"; a.step = "out"; a.tx = m.x; a.ty = m.y; a.speed = 95; }
          }
          break;
      }
    },

    frame(dtMs) {
      if (!w) return;
      const dt = Math.min(dtMs, 100) / 1000;
      clock += dt;
      hillOpen = connectAt < Infinity && endAt === Infinity ? Math.min(1, hillOpen + dt * 2) : Math.max(0, hillOpen - dt * (endAt < Infinity ? 0.8 : 2));
      if (snapping) hillOpen = connectAt < Infinity && endAt === Infinity ? 1 : 0;

      // Searching (silent finding stage): keep a few scouts going toward the file.
      if (state.phase === "finding" && mapAt === Infinity && endAt === Infinity && !snapping) {
        let scouts = 0;
        for (const a of ants) if (a.role === "scout") scouts++;
        if (scouts < 4 && hash01(seedWord, clock * 5 | 0) < dt * 2) {
          const k = nestTowardFile();
          const m = hillMouth();
          if (k >= 0) { const a = spawn("scout", m.x, m.y, nests[k].x, nests[k].y); if (a) a.nest = k; }
        }
      }
      // The inspector checks the cake while the whole file is verified.
      if ((state.phase === "verifying" || verifiedAt < Infinity) && endAt === Infinity && !ants.some((a) => a.role === "inspector")) {
        const m = hillMouth();
        const a = spawn("inspector", m.x, m.y, L.cakeX, L.cakeY + 10 * L.s);
        if (a) { a.speed = 70; if (snapping) { a.x = L.cakeX; a.y = L.cakeY - L.cakeH; } }
      }
      // The map-reader goes home once the stall is over.
      if (!state.stalled) for (const a of ants) if (a.role === "mapper") { const m = hillMouth(); a.role = "home"; a.tx = m.x; a.ty = m.y; }
      manageWorkers(dt);
      stepAnts(dt);

      // Trails fade.
      tg.globalCompositeOperation = "destination-out";
      tg.fillStyle = `rgba(0,0,0,${Math.min(1, dt * (state.phase === "downloading" ? 0.12 : 0.22))})`;
      tg.fillRect(0, 0, L.W, L.H);
      tg.globalCompositeOperation = "source-over";

      const s = Math.min(w / L.W, h / L.H);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.ground;
      g.fillRect(0, 0, w, h);
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w - L.W * s) / 2, dpr * (h - L.H * s) / 2);
      drawGround();
      g.globalAlpha = Math.min(1, Number(params.trails));
      g.drawImage(trail, 0, 0);
      g.globalAlpha = 1;
      for (const n of nests) drawNest(n);
      drawHill();
      drawCake();
      drawDropped();
      drawAnts();
      drawRain();
      snapping = false;
    },

    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      canvas.width = Math.round(nw * ndpr);
      canvas.height = Math.round(nh * ndpr);
    },

    setParams(p) {
      const prev = params.cake;
      params = { ...params, ...p };
      if (params.cake !== prev && pieceN) {
        const fills = pieces.map((q) => q.fill);
        layoutCake();
        fills.forEach((f, i) => { if (pieces[i]) pieces[i].fill = f; });
      }
    },

    describe() {
      return describeState(state);
    },

    destroy() {
      canvas?.remove();
    },

    stats() {
      let live = 0;
      for (const a of ants) if (a.role !== "off") live++;
      return { ants: live, nests: nests.length, pieces: pieceN, perPiece };
    },
  };
}
