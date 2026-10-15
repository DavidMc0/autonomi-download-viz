// Address-space map (Informative 1): how the browser finds a file. Every node and every file has a
// 32-byte address on one ring; "distance" is XOR, so a node is closer to the file the more leading
// bits their addresses share. The map shows the file's address, the seeds the browser starts from,
// each lookup round homing in, the DataMap records, then the chunk progress and the verified hash.
//
// Real (Tier A): the file's address; the seed nodes' addresses (bundled in the SDK) and which one
// answered; every lookup round (the peer's real address, nodes returned, failures, invalid answers,
// reseeds) when the source reports them; the DataMap record addresses; chunk count, rate, stalls,
// verification, hash, failure and cancel.
// Illustrative: a download's own lookup is not reported by SDK 0.1.2, so when no rounds arrive the
// map draws a typical one (dashed, hollow) and a typical close group, and says so in the legend.

import { describeState, initialState, reduce } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";
import { addressNear, BUNDLED_SEEDS, frac, shareOfSpace, sharedBits } from "./xor";

const tweakables: TweakDef[] = [
  { key: "layout", label: "layout", kind: "select", options: { ring: "ring", line: "line" }, default: "ring" },
  { key: "captions", label: "explain captions", kind: "select", options: { off: "off", short: "short", detailed: "detailed" }, default: "short" },
  { key: "labels", label: "labels", kind: "select", options: { none: "none", "key nodes": "key", all: "all" }, default: "key" },
  { key: "chart", label: "closer-each-round chart", kind: "boolean", default: true },
  { key: "illustrative", label: "draw a typical lookup when none is reported", kind: "boolean", default: true },
];

type Kind = "seed" | "node" | "record";
type NodeState = "idle" | "authenticating" | "connected" | "answered" | "failed" | "invalid";

interface MapNode {
  id: string;
  f: number;
  bits: number;
  kind: Kind;
  real: boolean;
  state: NodeState;
  round: number;
  returned: number;
  reason: string;
  at: number; // skin clock when it appeared
  t: number; // trace ms (chart x)
  close: boolean;
}

interface Hop { node: MapNode; at: number }

interface Planned { at: number; t: number; id: string; bits: number; round: number; close: boolean }

const VIEW = { full: { w: 960, h: 540 }, card: { w: 360, h: 220 } };
const MAX_HOPS = 48;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const short = (id: string) => `${id.slice(0, 6)}…`;
const bitsLabel = (b: number) => `${b} bit${b === 1 ? "" : "s"}`;

export default function create(): Skin {
  let ctx!: SkinContext;
  let params = defaultParams(tweakables);
  const state = initialState();
  let canvas!: HTMLCanvasElement;
  let g!: CanvasRenderingContext2D;
  let tip!: HTMLDivElement;
  let w = 0, h = 0, dpr = 1;
  let scale = 1, offX = 0, offY = 0;
  let hue = 200;
  let seedWord = 0;

  let clock = 0;
  let snapping = true;
  const stamp = () => (snapping ? -1e3 : clock);

  let target = "";
  let targetF = 0;
  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const hops: Hop[] = [];
  let connectedId = "";
  let best = -1; // shared bits of the closest real node queried so far
  let bestIllus = -1;
  let lookup: "none" | "real" | "illus" = "none";
  let lookupT0 = -1, lookupT1 = -1;
  let roundNo = 0, lastReturned = 0;
  let planned: Planned[] = [];
  let reseedAt = -1e3, verifiedAt = Infinity, mapAt = -1e3, endAt = Infinity;
  let datamapBytes = 0;
  let closeShown = false;
  let hover: MapNode | null = null;

  // Colours.
  let C = colours(false);
  function colours(dark: boolean) {
    const acc = dark ? `hsl(${hue} 75% 64%)` : `hsl(${hue} 70% 42%)`;
    return dark
      ? { bg: "#0f1320", panel: "#161b2b", ring: "#34405c", grid: "#232b40", text: "#e6ebf5", muted: "#8e9ab3", node: "#8fb0ff", illus: "#8a90a8", seed: "#c8d2e6", fail: "#ff7070", invalid: "#f0a24a", ok: "#4fd18b", record: "#c49bff", accent: acc, accentSoft: `hsla(${hue} 75% 64% / 0.18)` }
      : { bg: "#f7f8fb", panel: "#ffffff", ring: "#c4cbda", grid: "#e4e8f0", text: "#1b2232", muted: "#667089", node: "#3d66cc", illus: "#8a8fa3", seed: "#2c3446", fail: "#d23f3f", invalid: "#d97a1e", ok: "#228a52", record: "#7c4fd0", accent: acc, accentSoft: `hsla(${hue} 70% 42% / 0.14)` };
  }

  // ---------------------------------------------------------------------------
  // Model.

  function addNode(id: string, kind: Kind, real: boolean, t: number): MapNode {
    let n = byId.get(id);
    if (n) return n;
    n = {
      id, f: frac(id), bits: target ? sharedBits(id, target) : 0, kind, real, state: "idle",
      round: 0, returned: 0, reason: "", at: stamp(), t, close: false,
    };
    nodes.push(n);
    byId.set(id, n);
    return n;
  }

  function hop(n: MapNode): void {
    if (snapping) return;
    if (hops.length >= MAX_HOPS) hops.shift();
    hops.push({ node: n, at: clock });
  }

  /** A typical lookup for this address, drawn when the source reports none (seeded, so replays match). */
  function planIllustrative(t: number): void {
    if (!params.illustrative || lookup !== "none" || !target) return;
    lookup = "illus";
    lookupT0 = t;
    let k = 0;
    const rand = () => hash01(seedWord, 1000 + k++);
    const rounds = 3 + Math.floor(rand() * 2);
    const start = stamp() + 0.8;
    for (let r = 0; r < rounds; r++) {
      const per = 3;
      for (let i = 0; i < per; i++) {
        const bits = 1 + r * 2 + Math.floor(rand() * 3);
        planned.push({ at: start + r * 0.9 + i * 0.12, t: t + 800 + r * 900 + i * 120, id: addressNear(target, bits, rand), bits, round: r + 1, close: false });
      }
    }
    for (let i = 0; i < 5; i++) {
      const bits = 7 + Math.floor(rand() * 4);
      planned.push({ at: start + rounds * 0.9 + i * 0.1, t: t + 800 + rounds * 900 + i * 100, id: addressNear(target, bits, rand), bits, round: rounds + 1, close: true });
    }
  }

  function revealPlanned(force: boolean): void {
    if (!planned.length) return;
    let i = 0;
    for (; i < planned.length; i++) {
      const p = planned[i];
      if (!force && p.at > clock) break;
      const n = addNode(p.id, "node", false, p.t);
      n.state = "answered";
      n.round = p.round;
      n.close = p.close && closeShown;
      if (p.close) n.reason = "close"; // marks the typical close group
      if (n.bits > bestIllus) bestIllus = n.bits;
      if (!force) hop(n);
    }
    planned = planned.slice(i);
  }

  function markCloseGroup(): void {
    closeShown = true;
    if (lookup === "real") {
      const answered = nodes.filter((n) => n.real && n.kind === "node" && n.state === "answered").sort((a, b) => b.bits - a.bits);
      for (const n of answered.slice(0, 5)) n.close = true;
    } else {
      revealPlanned(true);
      for (const n of nodes) if (!n.real && n.reason === "close") n.close = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Geometry.

  const P = { x: 0, y: 0 };
  function layout() {
    const card = ctx.size === "card";
    if (card) return { cx: 104, cy: 110, R: 84, lx0: 16, lx1: 196, ly: 96, youX: 106, youY: 190 };
    return { cx: 292, cy: 244, R: 168, lx0: 40, lx1: 548, ly: 200, youX: 294, youY: 360 };
  }
  function pos(f: number, off: number): typeof P {
    const L = layout();
    if (params.layout === "line") {
      P.x = L.lx0 + f * (L.lx1 - L.lx0);
      P.y = L.ly - off;
    } else {
      const a = -Math.PI / 2 + f * Math.PI * 2;
      P.x = L.cx + Math.cos(a) * (L.R + off);
      P.y = L.cy + Math.sin(a) * (L.R + off);
    }
    return P;
  }
  function you(): { x: number; y: number } {
    const L = layout();
    return params.layout === "line" ? { x: L.youX, y: L.youY } : { x: L.cx, y: L.cy };
  }

  // ---------------------------------------------------------------------------
  // Drawing.

  function text(s: string, x: number, y: number, size: number, colour: string, weight = 400, align: CanvasTextAlign = "left"): void {
    g.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillStyle = colour;
    g.textAlign = align;
    g.fillText(s, x, y);
  }

  function drawAxis(card: boolean): void {
    const L = layout();
    g.strokeStyle = C.ring;
    g.lineWidth = card ? 2 : 2.5;
    g.beginPath();
    if (params.layout === "line") {
      g.moveTo(L.lx0, L.ly);
      g.lineTo(L.lx1, L.ly);
    } else g.arc(L.cx, L.cy, L.R, 0, Math.PI * 2);
    g.stroke();
    // Hex ticks: the first digit of the address.
    for (let i = 0; i < 64; i++) {
      const major = i % 4 === 0;
      if (card && !major) continue;
      const a = pos(i / 64, 0);
      const ax = a.x, ay = a.y;
      const b = pos(i / 64, major ? -8 : -4);
      g.strokeStyle = C.ring;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(b.x, b.y);
      g.stroke();
      if (major && !card) {
        const l = pos(i / 64, params.layout === "line" ? -22 : -20);
        text((i / 4).toString(16), l.x, l.y + 4, 11, C.muted, 500, "center");
      }
    }
    if (!card) {
      if (params.layout === "line") text("Address line: 00… on the left to ff… on the right", 24, 30, 11, C.muted);
      else text("Address ring: 00… at the top, clockwise to ff…", 24, 30, 11, C.muted);
    }
  }

  /** The aligned slice of addresses sharing `bits` leading bits with the file. */
  function drawNeighbourhood(bits: number, card: boolean): void {
    if (bits < 1 || !target) return;
    const span = Math.pow(2, -bits);
    const f0 = Math.floor(targetF / span) * span;
    const minVis = params.layout === "line" ? 0.004 : 0.006;
    const mid = f0 + span / 2;
    const half = Math.max(span, minVis) / 2;
    const L = layout();
    g.strokeStyle = C.accentSoft;
    g.lineWidth = card ? 14 : 22;
    g.lineCap = "butt";
    g.beginPath();
    if (params.layout === "line") {
      g.moveTo(L.lx0 + (mid - half) * (L.lx1 - L.lx0), L.ly);
      g.lineTo(L.lx0 + (mid + half) * (L.lx1 - L.lx0), L.ly);
    } else g.arc(L.cx, L.cy, L.R, -Math.PI / 2 + (mid - half) * Math.PI * 2, -Math.PI / 2 + (mid + half) * Math.PI * 2);
    g.stroke();
    g.lineCap = "round";
  }

  function drawProgress(card: boolean): void {
    const total = state.total ?? 0;
    if (!total || (state.phase !== "downloading" && state.phase !== "verifying" && state.phase !== "saving" && state.phase !== "done" && state.phase !== "failed" && state.phase !== "cancelled")) return;
    const k = Math.min(1, state.completed / total);
    const L = layout();
    const off = card ? 12 : 30;
    const col = state.phase === "failed" ? C.fail : state.phase === "cancelled" ? C.illus : state.phase === "done" ? C.ok : C.accent;
    g.lineWidth = card ? 5 : 6;
    g.strokeStyle = C.grid;
    g.beginPath();
    if (params.layout === "line") { g.moveTo(L.lx0, L.ly + off); g.lineTo(L.lx1, L.ly + off); }
    else g.arc(L.cx, L.cy, L.R + off, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = col;
    g.globalAlpha = state.stalled ? 0.45 + 0.35 * Math.sin(clock * 4) : 1;
    g.beginPath();
    if (params.layout === "line") { g.moveTo(L.lx0, L.ly + off); g.lineTo(L.lx0 + k * (L.lx1 - L.lx0), L.ly + off); }
    else g.arc(L.cx, L.cy, L.R + off, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    // Checking: a light sweeps round the finished arc until file.verified.
    if (state.phase === "verifying" && verifiedAt === Infinity && k >= 1) {
      const s = (clock * (ctx.reducedMotion ? 0.15 : 0.5)) % 1;
      g.strokeStyle = C.panel;
      g.lineWidth = card ? 3 : 4;
      g.beginPath();
      if (params.layout === "line") {
        const x = L.lx0 + s * (L.lx1 - L.lx0);
        g.moveTo(x - 20, L.ly + off);
        g.lineTo(x + 20, L.ly + off);
      } else g.arc(L.cx, L.cy, L.R + off, -Math.PI / 2 + s * Math.PI * 2, -Math.PI / 2 + s * Math.PI * 2 + 0.35);
      g.stroke();
    }
  }

  function drawHops(): void {
    const y = you();
    // Faint lines to every real node the browser queried.
    g.lineWidth = 1;
    for (const n of nodes) {
      if (n.kind !== "node" && !(n.kind === "seed" && n.state === "connected")) continue;
      if (n.state === "idle") continue;
      const p = pos(n.f, 0);
      g.strokeStyle = n.real ? C.node : C.illus;
      g.globalAlpha = n.real ? 0.13 : 0.18;
      g.setLineDash(n.real ? [] : [3, 4]);
      g.beginPath();
      g.moveTo(y.x, y.y);
      g.lineTo(p.x, p.y);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    // Recent hops: a bright line that fades, with a pulse travelling out.
    for (const hp of hops) {
      const age = clock - hp.at;
      if (age > 2.2 || age < 0) continue;
      const n = hp.node;
      const p = pos(n.f, 0);
      const col = n.state === "failed" ? C.fail : n.state === "invalid" ? C.invalid : n.real ? C.node : C.illus;
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.globalAlpha = Math.max(0, 1 - age / 2.2) * 0.9;
      g.setLineDash(n.real ? [] : [5, 5]);
      g.beginPath();
      g.moveTo(y.x, y.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      g.setLineDash([]);
      if (!ctx.reducedMotion && age < 0.4) {
        const k = ease(age / 0.4);
        g.globalAlpha = 1;
        g.fillStyle = col;
        g.beginPath();
        g.arc(y.x + (p.x - y.x) * k, y.y + (p.y - y.y) * k, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function drawNodes(card: boolean): void {
    // In the line layout, nodes bunch up along one axis, so only "all" labels them.
    const labels = card ? "none" : params.layout === "line" && params.labels === "key" ? "none" : String(params.labels);
    const ended = state.phase === "failed" || state.phase === "cancelled";
    for (const n of nodes) {
      const grow = ctx.reducedMotion ? 1 : ease((clock - n.at) / 0.3);
      if (grow <= 0) continue;
      const p = pos(n.f, 0);
      const x = p.x, y = p.y;
      let r = (card ? 3.2 : 4.5) * grow;
      g.globalAlpha = ended && n.kind !== "record" ? 0.55 : 1;
      if (n.close) {
        g.fillStyle = C.accentSoft;
        g.beginPath();
        g.arc(x, y, r + (card ? 5 : 8), 0, Math.PI * 2);
        g.fill();
      }
      if (n.kind === "record") {
        g.fillStyle = C.record;
        g.beginPath();
        g.moveTo(x, y - r - 2);
        g.lineTo(x + r + 2, y);
        g.lineTo(x, y + r + 2);
        g.lineTo(x - r - 2, y);
        g.closePath();
        g.fill();
      } else if (n.kind === "seed") {
        const pulsing = n.state === "authenticating" && !ctx.reducedMotion;
        if (pulsing) r *= 1 + 0.2 * Math.sin(clock * 6 + n.f * 20);
        g.strokeStyle = C.seed;
        g.fillStyle = n.state === "connected" ? C.seed : C.bg;
        g.lineWidth = 1.8;
        g.beginPath();
        g.rect(x - r, y - r, r * 2, r * 2);
        g.fill();
        g.stroke();
      } else {
        const col = n.state === "failed" ? C.fail : n.state === "invalid" ? C.invalid : n.real ? C.node : C.illus;
        g.strokeStyle = col;
        g.lineWidth = 1.6;
        if (!n.real) {
          g.setLineDash([2, 2]);
          g.fillStyle = C.bg;
        } else g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        if (n.state === "failed") {
          g.stroke();
          g.beginPath();
          g.moveTo(x - r * 0.7, y - r * 0.7); g.lineTo(x + r * 0.7, y + r * 0.7);
          g.moveTo(x + r * 0.7, y - r * 0.7); g.lineTo(x - r * 0.7, y + r * 0.7);
          g.stroke();
        } else {
          g.fill();
          g.stroke();
        }
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      const key = n.id === connectedId || (n.kind === "node" && n.real && n.bits === best && best > 0) || n.kind === "record";
      if (labels === "all" || (labels === "key" && key)) {
        const l = pos(n.f, params.layout === "line" ? 14 : 16);
        const lbl = n.kind === "record" ? "DataMap" : n.id === connectedId ? `seed ${short(n.id)}` : `${short(n.id)} · ${n.bits} bits`;
        text(lbl, l.x, l.y + 3, 10, n.kind === "record" ? C.record : C.muted, 500, l.x < you().x - 4 ? "right" : "left");
      }
    }
  }

  function drawTarget(card: boolean): void {
    if (!target) return;
    const done = verifiedAt < Infinity;
    const failed = state.phase === "failed";
    const col = failed ? C.fail : done ? C.ok : C.accent;
    const L = layout();
    const p = pos(targetF, 0);
    const x = p.x, y = p.y;
    const o = pos(targetF, params.layout === "line" ? 18 : 18);
    const ox = o.x, oy = o.y;
    // Pointer from outside the ring.
    const a = Math.atan2(y - oy, x - ox);
    const s = card ? 7 : 9;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * 4, y - Math.sin(a) * 4);
    g.lineTo(ox + Math.cos(a + Math.PI / 2) * s, oy + Math.sin(a + Math.PI / 2) * s);
    g.lineTo(ox - Math.cos(a + Math.PI / 2) * s, oy - Math.sin(a + Math.PI / 2) * s);
    g.closePath();
    g.fill();
    // A searching pulse while the file is being found.
    if (state.phase === "finding" && !ctx.reducedMotion) {
      const k = (clock * 0.8) % 1;
      g.strokeStyle = col;
      g.globalAlpha = 1 - k;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 6 + k * (card ? 14 : 22), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = col;
    g.strokeStyle = C.bg;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, card ? 5 : 6.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (done && !ctx.reducedMotion && clock - verifiedAt < 1.2) {
      const k = (clock - verifiedAt) / 1.2;
      g.strokeStyle = C.ok;
      g.globalAlpha = 1 - k;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 6 + k * 40, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (!card) {
      const l = pos(targetF, params.layout === "line" ? 34 : 36);
      const right = l.x >= (params.layout === "line" ? L.lx0 : L.cx) - 4;
      text(`file ${target.slice(0, 8)}…`, l.x, l.y + 4, 12, col, 700, params.layout === "line" ? "center" : right ? "left" : "right");
    }
  }

  function drawYou(card: boolean): void {
    const y = you();
    g.fillStyle = C.text;
    g.beginPath();
    g.roundRect(y.x - (card ? 7 : 10), y.y - (card ? 5 : 7), card ? 14 : 20, card ? 10 : 13, 2);
    g.fill();
    g.fillRect(y.x - (card ? 9 : 13), y.y + (card ? 5 : 6), card ? 18 : 26, 2.5);
    if (!card) text("you (browser)", y.x, y.y + 24, 11, C.muted, 500, "center");
  }

  // Panel (full size).
  function panel(): void {
    const x0 = 596, x1 = 936;
    g.fillStyle = C.panel;
    g.beginPath();
    g.roundRect(x0 - 14, 18, x1 - x0 + 28, 504, 10);
    g.fill();
    const [title, sub] = status();
    text(title, x0, 50, 19, C.text, 700);
    let y = 74;
    for (const line of wrap(sub, 46)) { text(line, x0, y, 13, C.muted); y += 17; }
    y = Math.max(y + 8, 112);
    for (const [k, v] of facts()) {
      text(k, x0, y, 12, C.muted);
      text(v, x0 + 120, y, 12.5, C.text, 600);
      y += 19;
    }
    if (params.chart) y = chart(x0, Math.max(y + 10, 196), x1, 130) + 8;
    const cap = caption();
    if (cap) {
      y = Math.max(y, 352);
      for (const line of wrap(cap, 54)) { text(line, x0, y, 12, C.text); y += 16; }
    }
    legend(x0, 470);
  }

  function status(): [string, string] {
    const s = state;
    if (reseedAt > clock - 3 && s.phase === "finding") return ["Retrying through seeds", "The lookup stalled, so the browser asks the seed nodes again."];
    switch (s.phase) {
      case "idle": return ["Ready", ""];
      case "connecting": return ["Connecting", s.seeds ? `Authenticating ${s.seeds} seed nodes built into the SDK.` : "Starting the browser core."];
      case "finding":
        if (lookup === "real") return [`Finding the file · round ${roundNo}`, lastReturned ? `The last node answered with ${lastReturned} nodes closer to the file.` : "Asking the nodes it knows for ones closer to the file."];
        if (mapAt > 0) return ["DataMap found", "Fetching the rest of the file's map."];
        return ["Finding the file", lookup === "illus" ? "The download's own lookup isn't reported, so a typical one is drawn (dashed)." : "Looking up the nodes that hold the file's map."];
      case "downloading": return [s.stalled ? "Waiting for the network" : "Downloading", s.total ? `${s.completed} of ${s.total} chunks${s.chunksPerSec ? ` · ${s.chunksPerSec.toFixed(1)} chunks/s` : ""}` : "Getting the chunk list."];
      case "verifying": return verifiedAt < Infinity ? ["Verified", `Hash ${s.hash?.slice(0, 16)}…`] : ["Checking the whole file", "Every chunk is in. Checking the file against its hash."];
      case "saving": return ["Saving", `Verified · hash ${s.hash?.slice(0, 16)}…`];
      case "done": return ["Done · verified", `Hash ${s.hash?.slice(0, 16) ?? ""}…`];
      case "failed": return ["Download failed", s.error?.message ?? ""];
      case "cancelled": return ["Cancelled", "The download was stopped."];
    }
  }

  function facts(): [string, string][] {
    const out: [string, string][] = [];
    if (target) out.push(["File address", `${target.slice(0, 16)}…`]);
    if (connectedId) out.push(["Seed answered", `${short(connectedId)} · ${bitsLabel(sharedBits(connectedId, target))} shared`]);
    if (lookup === "real") {
      out.push(["Rounds", `${roundNo} · ${state.failures} failed${state.invalid ? ` · ${state.invalid} invalid` : ""}`]);
      if (best >= 0) out.push(["Closest so far", `${bitsLabel(best)} · ${shareOfSpace(best)}`]);
    } else if (lookup === "illus" && bestIllus >= 0) out.push(["Lookup", "not reported (typical one drawn)"]);
    if (datamapBytes) out.push(["DataMap", `verified · ${datamapBytes} bytes${state.nested ? " · nested" : ""}`]);
    return out.slice(0, 5);
  }

  function caption(): string {
    const v = String(params.captions);
    if (v === "off") return "";
    const d = v === "detailed";
    switch (state.phase) {
      case "connecting":
        return d ? "Your browser starts from seed nodes whose addresses ship with the SDK. It checks each one's identity before trusting it, then uses the first that answers." : "Your browser starts from seed nodes built into the SDK.";
      case "finding":
        return d
          ? "Every node and file has a 256-bit address on this ring. Distance is XOR: two addresses are closer the more leading bits they share. Each node answers with nodes it knows that are closer to the file, so every round halves the slice of the ring left to search (the shaded arc)."
          : "Distance is XOR: the more leading bits a node shares with the file's address, the closer it is. Each round finds closer nodes.";
      case "downloading":
        return d
          ? "The nodes closest to an address (its close group) store the data for it. The DataMap lists the file's chunks; each chunk has its own address and close group, so chunks come from all round the ring. Their addresses aren't reported, so only the count is shown."
          : "The file's chunks live at their own addresses all round the ring; the arc shows how many have arrived.";
      case "verifying": case "saving": case "done":
        return d ? "Each chunk is checked against its address as it arrives, and the whole file is then checked against its hash, so a node can't hand back the wrong data." : "Every chunk is checked on arrival, then the whole file against its hash.";
      default: return "";
    }
  }

  /** The "closer each round" chart: shared bits (y) against time (x). Returns its bottom y. */
  function chart(x0: number, y0: number, x1: number, ch: number): number {
    const pts = nodes.filter((n) => n.kind === "node" && n.state !== "idle");
    const seed = connectedId ? byId.get(connectedId) : undefined;
    text("Closer each round", x0, y0, 12.5, C.text, 700);
    text("shared leading bits ↑", x1, y0, 11, C.muted, 400, "right");
    const top = y0 + 10, bot = top + ch, left = x0 + 22, right = x1;
    let ymax = 12;
    for (const n of pts) ymax = Math.max(ymax, n.bits + 2);
    if (ymax % 2) ymax++;
    let t0 = lookupT0 >= 0 ? lookupT0 : seed ? seed.t : 0;
    let t1 = Math.max(t0 + 4000, lookupT1 >= 0 ? lookupT1 : state.t);
    for (const n of pts) t1 = Math.max(t1, n.t);
    if (seed) t0 = Math.min(t0, seed.t);
    const X = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (right - left);
    const Y = (b: number) => bot - (b / ymax) * (bot - top);
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    for (let b = 0; b <= ymax; b += ymax > 16 ? 4 : 2) {
      g.beginPath();
      g.moveTo(left, Y(b));
      g.lineTo(right, Y(b));
      g.stroke();
      text(String(b), left - 6, Y(b) + 4, 10, C.muted, 400, "right");
    }
    // Best-so-far step line (real first, then illustrative).
    for (const real of [true, false]) {
      let b = -1;
      g.strokeStyle = real ? C.node : C.illus;
      g.lineWidth = 2;
      g.setLineDash(real ? [] : [4, 4]);
      g.beginPath();
      let started = false;
      const sorted = pts.filter((n) => n.real === real && n.state === "answered").sort((a, c) => a.t - c.t);
      for (const n of sorted) {
        if (n.bits <= b) continue;
        if (!started) { g.moveTo(X(n.t), Y(n.bits)); started = true; } else { g.lineTo(X(n.t), Y(b)); g.lineTo(X(n.t), Y(n.bits)); }
        b = n.bits;
      }
      if (started) g.lineTo(X(real ? (lookupT1 >= 0 ? lookupT1 : t1) : sorted[sorted.length - 1].t), Y(b));
      g.stroke();
    }
    g.setLineDash([]);
    for (const n of pts) {
      const x = X(n.t), y = Y(n.bits);
      const col = n.state === "failed" ? C.fail : n.state === "invalid" ? C.invalid : n.real ? C.node : C.illus;
      g.strokeStyle = col;
      g.fillStyle = n.real ? col : C.panel;
      g.lineWidth = 1.4;
      if (n.state === "failed") {
        g.beginPath();
        g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    if (seed) {
      g.fillStyle = C.seed;
      g.fillRect(X(seed.t) - 3, Y(seed.bits) - 3, 6, 6);
    }
    const secs = (t1 - t0) / 1000;
    text("0 s", left, bot + 14, 10, C.muted);
    text(`${secs.toFixed(secs < 10 ? 1 : 0)} s`, right, bot + 14, 10, C.muted, 400, "right");
    return bot + 22;
  }

  function legend(x0: number, y0: number): void {
    const items: [string, (x: number, y: number) => void][] = [
      ["the file", (x, y) => { g.fillStyle = C.accent; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }],
      ["seed node", (x, y) => { g.strokeStyle = C.seed; g.lineWidth = 1.6; g.strokeRect(x - 4, y - 4, 8, 8); }],
      ["node (real)", (x, y) => { g.fillStyle = C.node; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }],
      ["illustrative", (x, y) => { g.strokeStyle = C.illus; g.lineWidth = 1.5; g.setLineDash([2, 2]); g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }],
      ["failed query", (x, y) => { g.strokeStyle = C.fail; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - 3.5, y - 3.5); g.lineTo(x + 3.5, y + 3.5); g.moveTo(x + 3.5, y - 3.5); g.lineTo(x - 3.5, y + 3.5); g.stroke(); }],
      ["DataMap record", (x, y) => { g.fillStyle = C.record; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.fill(); }],
    ];
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, y0 - 16);
    g.lineTo(936, y0 - 16);
    g.stroke();
    items.forEach(([label, icon], i) => {
      const x = x0 + (i % 3) * 116, y = y0 + Math.floor(i / 3) * 20;
      icon(x + 5, y - 4);
      text(label, x + 15, y, 11.5, C.muted);
    });
    text("Solid = reported by the network · dashed = illustrative", x0, y0 + 44, 11, C.muted);
  }

  function wrap(s: string, n: number): string[] {
    const out: string[] = [];
    let line = "";
    for (const word of s.split(" ")) {
      if ((line + " " + word).trim().length > n) { out.push(line.trim()); line = word; } else line += " " + word;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  }

  /**
   * The zoom strip: the aligned slice of the ring around the file that shares the first `W` bits
   * with it, stretched across the bottom. Nested shades mark each further shared bit, so a node
   * that lands in a deeper shade is closer by XOR. Positions in the strip are exact.
   */
  function lens(): void {
    if (!target) return;
    const reach = lookup === "real" ? best : bestIllus;
    const W = Math.max(2, Math.min(Math.max(reach, 6), 14) - 5);
    const span = Math.pow(2, -W);
    const f0 = Math.floor(targetF / span) * span;
    const x0 = 40, x1 = 548, y0 = 470, sh = 34;
    const X = (f: number) => x0 + ((f - f0) / span) * (x1 - x0);
    g.fillStyle = C.panel;
    g.fillRect(x0, y0, x1 - x0, sh);
    // Nested slices: each one shares one more leading bit with the file.
    for (let b = W + 1; b <= W + 8; b++) {
      const s = Math.pow(2, -b);
      const fs = Math.floor(targetF / s) * s;
      const xa = X(fs), xb = Math.max(X(fs + s), xa + 1);
      g.fillStyle = C.accentSoft;
      g.fillRect(xa, y0, xb - xa, sh);
    }
    g.strokeStyle = C.ring;
    g.lineWidth = 1;
    g.strokeRect(x0, y0, x1 - x0, sh);
    for (const n of nodes) {
      if (n.kind === "record" || n.f < f0 || n.f >= f0 + span) continue;
      const x = X(n.f), y = y0 + sh / 2;
      const col = n.state === "failed" ? C.fail : n.state === "invalid" ? C.invalid : n.real ? (n.kind === "seed" ? C.seed : C.node) : C.illus;
      g.strokeStyle = col;
      g.fillStyle = n.real && n.state !== "failed" ? col : C.panel;
      g.lineWidth = 1.4;
      g.setLineDash(n.real ? [] : [2, 2]);
      g.beginPath();
      g.arc(x, y + (n.state === "failed" ? 8 : n.close ? -8 : 0), 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.setLineDash([]);
    }
    const tx = X(targetF);
    const col = state.phase === "failed" ? C.fail : verifiedAt < Infinity ? C.ok : C.accent;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(tx, y0 + 6); g.lineTo(tx - 6, y0 - 4); g.lineTo(tx + 6, y0 - 4);
    g.closePath();
    g.fill();
    g.fillRect(tx - 1, y0, 2, sh);
    text(`Zoom: the ${shareOfSpace(W)} slice of the ring around the file (×${Math.pow(2, W).toLocaleString("en-GB")}). Darker = more bits shared.`, x0, y0 + sh + 16, 11, C.muted);
  }

  // Card: the ring plus one big readout.
  function cardPanel(): void {
    const x = 214;
    const s = state;
    let a = "", b = "", c = "";
    switch (s.phase) {
      case "idle": a = "Ready"; break;
      case "connecting": a = "Connecting"; b = s.seeds ? `${s.seeds} seeds` : ""; break;
      case "finding":
        a = "Finding";
        if (lookup === "real") { b = `round ${roundNo}`; c = best >= 0 ? `${best} bits closer` : ""; }
        else { b = "the file"; c = mapAt > 0 ? "map found" : ""; }
        break;
      case "downloading": a = s.stalled ? "Waiting" : "Downloading"; b = s.total ? `${Math.floor((100 * s.completed) / s.total)}%` : "…"; c = s.total ? `${s.completed}/${s.total} chunks` : ""; break;
      case "verifying": a = verifiedAt < Infinity ? "Verified" : "Checking"; b = "100%"; c = verifiedAt < Infinity ? `✓ ${s.hash?.slice(0, 8)}` : "whole file"; break;
      case "saving": a = "Saving"; b = "100%"; c = `✓ ${s.hash?.slice(0, 8)}`; break;
      case "done": a = "Verified"; b = "✓"; c = s.hash?.slice(0, 8) ?? ""; break;
      case "failed": a = "Failed"; b = "✕"; break;
      case "cancelled": a = "Cancelled"; b = "–"; break;
    }
    text(a, x, 78, 16, C.text, 700);
    text(b, x, 116, 30, s.phase === "failed" ? C.fail : s.phase === "done" || verifiedAt < Infinity ? C.ok : C.accent, 800);
    text(c, x, 142, 13, C.muted, 500);
  }

  // ---------------------------------------------------------------------------
  // Tooltip.

  function onMove(ev: PointerEvent): void {
    if (ctx.size === "card") return;
    const r = canvas.getBoundingClientRect();
    const lx = (ev.clientX - r.left - offX) / scale, ly = (ev.clientY - r.top - offY) / scale;
    let bestD = 81;
    hover = null;
    for (const n of nodes) {
      const p = pos(n.f, 0);
      const d = (p.x - lx) ** 2 + (p.y - ly) ** 2;
      if (d < bestD) { bestD = d; hover = n; }
    }
    if (!hover) { tip.hidden = true; return; }
    const n = hover;
    const lines = [
      `${n.kind === "record" ? "DataMap record" : n.kind === "seed" ? "Seed node" : "Node"} ${n.id.slice(0, 16)}…`,
      n.kind === "record" ? "a piece of the file's map" : `shares ${n.bits} leading bits with the file (${shareOfSpace(n.bits)})`,
    ];
    if (!n.real) lines.push("illustrative: not a reported node");
    if (n.state === "answered" && n.real) lines.push(`round ${n.round} · returned ${n.returned} nodes`);
    if (n.state === "connected") lines.push("authenticated: the browser's way in");
    if (n.state === "failed") lines.push(`query failed: ${n.reason}`);
    if (n.state === "invalid") lines.push("gave an invalid candidate (ignored)");
    if (n.close) lines.push(n.real ? "among the closest nodes queried" : "a typical close-group member");
    tip.textContent = lines.join("\n");
    tip.hidden = false;
    tip.style.left = `${ev.clientX - r.left + 12}px`;
    tip.style.top = `${ev.clientY - r.top + 12}px`;
  }

  // ---------------------------------------------------------------------------

  return {
    id: "address-space",
    title: "Address-space map",
    theme: "informative",
    wantsEnriched: false,
    libs: ["Canvas 2D"],
    illustrativeNote: "the dashed lookup and close group, when the download doesn't report its own",
    tweakables,

    mount(c: SkinContext) {
      ctx = c;
      params = { ...params, ...c.params };
      seedWord = (c.seed[0] | (c.seed[1] << 8) | (c.seed[2] << 16) | (c.seed[3] << 24)) >>> 0;
      hue = Math.round((c.seed[9] / 256) * 360);
      C = colours(c.theme === "dark");
      if (getComputedStyle(c.container).position === "static") c.container.style.position = "relative";
      canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%";
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", () => { tip.hidden = true; hover = null; });
      tip = document.createElement("div");
      tip.hidden = true;
      tip.style.cssText = `position:absolute;pointer-events:none;white-space:pre;font:12px/1.4 system-ui,sans-serif;padding:6px 8px;border-radius:6px;background:${C.text};color:${C.bg};max-width:320px;z-index:2`;
      c.container.append(canvas, tip);
      g = canvas.getContext("2d")!;
    },

    onEvent(e: VizEvent) {
      reduce(state, e);
      switch (e.type) {
        case "session.start":
          target = e.address;
          targetF = frac(target);
          break;
        case "connect.start":
          // The bundled seeds, at their real addresses.
          for (const id of BUNDLED_SEEDS.slice(0, Math.max(e.seeds, 0))) addNode(id, "seed", true, e.t).state = "authenticating";
          break;
        case "connect.peer": {
          const n = addNode(e.peerId, "seed", true, e.t);
          n.state = "connected";
          connectedId = e.peerId;
          for (const s of nodes) if (s.kind === "seed" && s.state === "authenticating") s.state = "idle";
          hop(n);
          break;
        }
        case "connect.done":
          planIllustrative(e.t);
          break;
        case "lookup.start":
        case "lookup.round":
        case "lookup.fail":
        case "lookup.invalid":
          if (lookup !== "real") {
            // Real rounds replace any typical one already drawn.
            if (lookup === "illus") {
              for (let i = nodes.length - 1; i >= 0; i--) if (!nodes[i].real) { byId.delete(nodes[i].id); nodes.splice(i, 1); }
              planned = [];
              bestIllus = -1;
            }
            lookup = "real";
            lookupT0 = e.t;
          }
          if (e.type === "lookup.round") {
            const n = addNode(e.peerId, byId.get(e.peerId)?.kind ?? "node", true, e.t);
            if (n.kind === "node") { n.state = "answered"; n.t = e.t; }
            n.round = e.iteration;
            n.returned = e.returned;
            roundNo = Math.max(roundNo, e.iteration);
            lastReturned = e.returned;
            if (n.bits > best) best = n.bits;
            hop(n);
          } else if (e.type === "lookup.fail" || e.type === "lookup.invalid") {
            const n = addNode(e.peerId, "node", true, e.t);
            n.state = e.type === "lookup.fail" ? "failed" : "invalid";
            n.t = e.t;
            n.reason = e.type === "lookup.fail" ? e.reason : "invalid candidate";
            hop(n);
          }
          break;
        case "lookup.reseed":
          reseedAt = stamp();
          if (lookup !== "real") { lookup = "real"; lookupT0 = e.t; }
          break;
        case "lookup.done":
          lookupT1 = e.t;
          if (lookup === "real") markCloseGroup();
          break;
        case "datamap.fetch":
        case "datamap.nested":
          if (e.address !== target && /^[0-9a-f]{64}$/i.test(e.address)) addNode(e.address.toLowerCase(), "record", true, e.t);
          break;
        case "datamap.verified":
          datamapBytes = e.bytes;
          mapAt = stamp();
          if (!closeShown) markCloseGroup();
          if (lookupT1 < 0) lookupT1 = e.t;
          break;
        case "chunk.done":
          if (!closeShown) markCloseGroup();
          break;
        case "file.verified": verifiedAt = stamp(); break;
        case "session.failed":
        case "connect.failed":
        case "session.cancelled":
          if (endAt === Infinity) endAt = stamp();
          planned = [];
          break;
      }
    },

    frame(dtMs) {
      if (!w) return;
      clock += Math.min(dtMs, 100) / 1000;
      if (state.phase === "finding" || planned.length) revealPlanned(false);
      const card = ctx.size === "card";
      const vw = VIEW[ctx.size];
      scale = Math.min(w / vw.w, h / vw.h);
      offX = (w - vw.w * scale) / 2;
      offY = (h - vw.h * scale) / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, w, h);
      g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      g.lineCap = "round";
      g.lineJoin = "round";

      drawNeighbourhood(lookup === "real" ? best : bestIllus, card);
      drawAxis(card);
      drawProgress(card);
      drawHops();
      drawNodes(card);
      drawTarget(card);
      drawYou(card);
      if (card) cardPanel();
      else {
        lens();
        panel();
      }
      if (state.phase === "failed" || state.phase === "cancelled") {
        const k = ease((clock - endAt) / 0.8);
        g.globalAlpha = k;
        const L = layout();
        const msg = state.phase === "failed" ? "Failed" : "Cancelled";
        if (!card) text(msg, L.cx, params.layout === "line" ? L.ly - 60 : L.cy - 30, 22, state.phase === "failed" ? C.fail : C.muted, 800, "center");
        g.globalAlpha = 1;
      }
      snapping = false;
    },

    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      canvas.width = Math.round(nw * ndpr);
      canvas.height = Math.round(nh * ndpr);
    },

    setParams(p) {
      const hadIllus = params.illustrative;
      params = { ...params, ...p };
      if (hadIllus && !params.illustrative && lookup === "illus") {
        for (let i = nodes.length - 1; i >= 0; i--) if (!nodes[i].real) { byId.delete(nodes[i].id); nodes.splice(i, 1); }
        planned = [];
        bestIllus = -1;
        lookup = "none";
      }
    },

    describe() {
      const base = describeState(state);
      if (state.phase === "finding" && lookup === "real" && best >= 0) return `${base} Closest node so far shares ${best} leading bits with the file.`;
      return base;
    },

    destroy() {
      canvas?.remove();
      tip?.remove();
    },

    stats() {
      return { nodes: nodes.length, real: nodes.filter((n) => n.real).length, best };
    },
  };
}
