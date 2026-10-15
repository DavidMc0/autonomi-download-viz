// Hash garden (Artistic 2): the file grows as a plant. Its species and form come from the address,
// its roots reach for the seed nodes, every chunk grows one leaf (or petal), and the verified hash
// colours and opens its flower. The finished plant can be saved as a portrait.
//
// Real (Tier A): every phase and its timing; the seed count and which seed answered (roots reach for
// the seeds at their real addresses along the soil); lookup rounds and failed queries if the source
// reports them (root hairs, withered ones); the chunk count and total (leaves or petals); the rate
// (growth speed); stalls (a breeze, a waiting bud); the hash (the flower's colours and petal count);
// failure and cancel. Illustrative: the shoot's search for light while the file is found (SDK 0.1.2
// sends no lookup rounds), and where each leaf grows.

import { prng } from "../../events/seed";
import { describeState, initialState, reduce } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { BUNDLED_SEEDS, frac } from "../../events/xor";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";
import { at, makeBloom, makePlant, SAMPLES, type Bloom, type Plant } from "./plant";

const tweakables: TweakDef[] = [
  { key: "species", label: "species", kind: "select", options: { "seeded by address": "seeded", daisy: "daisy", "branching shrub": "shrub", lily: "lily" }, default: "seeded" },
  { key: "growth", label: "chunks grow", kind: "select", options: { petals: "petals", leaves: "leaves" }, default: "petals" },
  { key: "palette", label: "palette", kind: "select", options: { "seeded by address": "seeded", spring: "spring", autumn: "autumn", ink: "ink" }, default: "seeded" },
  { key: "paper", label: "paper texture", kind: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
  { key: "frame", label: "portrait frame", kind: "select", options: { mat: "mat", "thin line": "line", none: "none" }, default: "mat" },
  { key: "caption", label: "portrait caption (name and short hash)", kind: "boolean", default: true },
];

const W = 960, H = 540, SOIL = 440, BASE_X = 480;
const MAX_SLOTS = 60;
const VIEW = { full: { x: 0, y: 0, w: 960, h: 540 } };
const CARD_ASPECT = 360 / 220;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface Hair { x0: number; y0: number; x1: number; y1: number; at: number; failed: boolean }

export default function create(): Skin {
  let ctx!: SkinContext;
  let params = defaultParams(tweakables);
  const state = initialState();
  let canvas!: HTMLCanvasElement;
  let g!: CanvasRenderingContext2D;
  let w = 0, h = 0, dpr = 1;
  let saveBtn: HTMLButtonElement | null = null;

  let clock = 0;
  let snapping = true;
  const stamp = () => (snapping ? -1e3 : clock);

  let plant!: Plant;
  let perSlot = 1, slotsN = 0, total = 0;
  const leafAt = new Float32Array(MAX_SLOTS).fill(Infinity);
  let grown = 0; // slots started
  let stemG = 0; // drawn fraction of the stem
  let leafDur = 0.8;
  let bloom!: Bloom;
  let hashBloom: Bloom | null = null;

  let connectAt = Infinity, findAt = Infinity, mapAt = Infinity, totalAt = Infinity, verifiedAt = Infinity, endAt = Infinity;
  let seeds = 0, peerIdx = -1;
  const seedPts: { x: number; y: number }[] = [];
  const hairs: Hair[] = [];
  // Card framing, fitted to this plant (including its flower head) so nothing is cut off.
  const card = { x: 0, y: 0, w: 0, h: 0, rootsY: 0 };
  let camY = 0;
  /** The plant's top edge: the highest stem or branch tip, less the flower head's reach. */
  let plantTop = 0;
  let sway = 0;
  let paper: CanvasPattern | null = null;
  let paperTile: HTMLCanvasElement | null = null;
  let C = theme(false);

  function theme(dark: boolean) {
    return dark
      ? { paper: "#1c1e26", ink: "#e9e3d3", muted: "#9a96a3", soil: "#2b2420", soil2: "#3a2f27", sky: "#252838", sun: "rgba(220,225,255,", grain: 255, blueprint: "rgba(200,200,230,0.28)" }
      : { paper: "#f3ede0", ink: "#3a3128", muted: "#8a7f70", soil: "#9c7b5c", soil2: "#7d5f45", sky: "#eef0ea", sun: "rgba(255,206,120,", grain: 0, blueprint: "rgba(90,80,120,0.28)" };
  }

  function paletteShift(hue: number): number {
    switch (String(params.palette)) {
      case "spring": return 105 + (hue - 88) * 0.5;
      case "autumn": return 30 + (hue - 88) * 0.4;
      default: return hue;
    }
  }
  const ink = () => String(params.palette) === "ink";

  // ---------------------------------------------------------------------------
  // Setup.

  function headReach(): number {
    // The largest head (60 petals, 3 rings), so the framing never jumps when the total arrives.
    if (params.growth === "petals") return (34 + 2 * 16) * 1.05 + 10;
    return 62;
  }

  function frameCard(): void {
    let x0 = BASE_X, x1 = BASE_X, top = SOIL;
    for (const c of plant.curves) {
      for (let i = 0; i <= SAMPLES; i++) {
        x0 = Math.min(x0, c.xs[i]); x1 = Math.max(x1, c.xs[i]); top = Math.min(top, c.ys[i]);
      }
    }
    const reach = headReach();
    plantTop = top - reach;
    const hv = Math.max(300, SOIL + 24 - (plantTop - 8));
    const wv = Math.max(hv * CARD_ASPECT, x1 - x0 + 140);
    const hh = wv / CARD_ASPECT;
    card.w = wv;
    card.h = hh;
    card.x = (x0 + x1) / 2 - wv / 2;
    card.y = SOIL + 24 - hh;
    card.rootsY = SOIL - hh * 0.3;
    if (!camY) camY = card.rootsY;
  }

  function build(): void {
    const petals = params.growth === "petals";
    plant = makePlant(ctx.seed, petals ? 4 : slotsN, String(params.species), SOIL, BASE_X);
    frameCard();
    leafCache.length = 0;
    bloom = makeBloom(plant.species, state.address || "00", plant.leafHue);
    if (state.hash) hashBloom = makeBloom(plant.species, state.hash, plant.leafHue);
  }

  function setTotal(n: number): void {
    if (n === total) return;
    total = n;
    perSlot = Math.max(1, Math.ceil(total / MAX_SLOTS));
    slotsN = Math.max(1, Math.ceil(total / perSlot));
    build();
  }

  function makePaper(): void {
    const S = 192;
    paperTile = document.createElement("canvas");
    paperTile.width = paperTile.height = S;
    const pg = paperTile.getContext("2d")!;
    const img = pg.createImageData(S, S);
    const r = prng(new Uint8Array(32).fill(7), 11);
    const v = C.grain;
    for (let i = 0; i < S * S; i++) {
      const n = r();
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = Math.floor(n * n * 34);
    }
    pg.putImageData(img, 0, 0);
    // Fibres.
    pg.strokeStyle = v ? "rgba(255,255,255,0.05)" : "rgba(60,40,20,0.06)";
    pg.lineWidth = 0.6;
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 6 + r() * 20;
      pg.beginPath();
      pg.moveTo(x, y);
      pg.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      pg.stroke();
    }
    paper = g.createPattern(paperTile, "repeat");
  }

  function placeSeeds(n: number): void {
    seedPts.length = 0;
    const r = prng(ctx.seed, 0x5eed);
    for (let i = 0; i < n; i++) {
      // Along the soil by the seed's real address; depth is decoration.
      const f = i < BUNDLED_SEEDS.length ? frac(BUNDLED_SEEDS[i]) : r();
      seedPts.push({ x: 150 + f * 660, y: SOIL + 34 + r() * 52 });
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing pieces.

  const pt = { x: 0, y: 0, a: 0 };

  function drawBackground(): void {
    g.fillStyle = C.paper;
    g.fillRect(-200, -200, W + 400, H + 600);
    // Light (the file's address sets where it shines from).
    const sx = 140 + frac(state.address || "80") * 680, sy = 70;
    const lit = verifiedAt < Infinity ? 1 : mapAt < Infinity ? 0.75 : findAt < Infinity ? 0.45 : 0.25;
    for (let i = 4; i >= 1; i--) {
      g.fillStyle = `${C.sun}${(0.07 * lit).toFixed(3)})`;
      g.beginPath();
      g.arc(sx, sy, 26 * i, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = `${C.sun}${(0.55 * lit).toFixed(3)})`;
    g.beginPath();
    g.arc(sx, sy, 18, 0, Math.PI * 2);
    g.fill();
    // Soil, with a ragged edge.
    g.fillStyle = C.soil;
    g.beginPath();
    g.moveTo(-200, SOIL + 4);
    for (let x = -200; x <= W + 200; x += 24) g.lineTo(x, SOIL + Math.sin(x * 0.07) * 2 + Math.sin(x * 0.23) * 1.5);
    g.lineTo(W + 200, H + 400);
    g.lineTo(-200, H + 400);
    g.closePath();
    g.fill();
    g.fillStyle = C.soil2;
    g.globalAlpha = 0.45;
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.3) % (W + 200) - 100, y = SOIL + 10 + ((i * 53.7) % 220);
      g.beginPath();
      g.ellipse(x, y, 2 + (i % 4), 1.2 + (i % 3) * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawRoots(): void {
    if (connectAt === Infinity) return;
    const sx = BASE_X, sy = SOIL + 10;
    for (let i = 0; i < seedPts.length; i++) {
      const p = seedPts[i];
      const k = ctx.reducedMotion ? ease((clock - connectAt) / 1.5) : ease((clock - connectAt - i * 0.15) / 1.3);
      const connected = i === peerIdx;
      // Pebble: the seed node.
      g.fillStyle = connected ? "hsl(42 70% 58%)" : C.soil2;
      g.globalAlpha = connected ? 1 : 0.9;
      g.beginPath();
      g.ellipse(p.x, p.y, 7, 5, 0.3, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (k <= 0) continue;
      g.strokeStyle = connected ? "hsl(40 55% 72%)" : "rgba(240,225,200,0.55)";
      g.lineWidth = connected ? 2.6 : 1.2;
      const mx = (sx + p.x) / 2 + Math.sin(i * 2.1) * 30, my = Math.max(sy, p.y) + 18;
      g.beginPath();
      g.moveTo(sx, sy);
      const n = 16, end = Math.max(1, Math.floor(n * k));
      for (let j = 1; j <= end; j++) {
        const t = j / n, u = 1 - t;
        g.lineTo(u * u * sx + 2 * u * t * mx + t * t * p.x, u * u * sy + 2 * u * t * my + t * t * p.y);
      }
      g.stroke();
    }
    // Root hairs: real lookup rounds (withered when the query failed).
    for (const r of hairs) {
      const k = ease((clock - r.at) / 0.6);
      if (k <= 0) continue;
      g.strokeStyle = r.failed ? "rgba(120,80,50,0.7)" : "rgba(245,235,215,0.75)";
      g.lineWidth = 1;
      g.setLineDash(r.failed ? [2, 3] : []);
      g.beginPath();
      g.moveTo(r.x0, r.y0);
      g.lineTo(r.x0 + (r.x1 - r.x0) * k, r.y0 + (r.y1 - r.y0) * k);
      g.stroke();
    }
    g.setLineDash([]);
    // The seed, and the shoot feeling its way up toward the light while the file is found.
    g.fillStyle = "hsl(32 45% 38%)";
    g.beginPath();
    g.ellipse(sx, sy + 4, 9, 6, -0.4, 0, Math.PI * 2);
    g.fill();
    if (findAt < Infinity && mapAt === Infinity && endAt === Infinity) {
      const k = 0.2 + 0.7 * (1 - Math.exp(-(clock - findAt) / 3));
      g.strokeStyle = `hsl(${paletteShift(plant.leafHue)} 40% 55%)`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + 6, sy - 4 * k, sx + 2, sy - 9 * k);
      g.stroke();
      // A tap root searching downward (illustrative: the lookup isn't reported).
      g.strokeStyle = "rgba(240,225,200,0.5)";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(sx, sy + 6);
      g.quadraticCurveTo(sx - 8, sy + 30 * k, sx + 4 + Math.sin(clock) * 3, sy + 60 * k);
      g.stroke();
    }
  }

  function drawCurve(ci: number, upto: number): void {
    const c = plant.curves[ci];
    const n = Math.floor(upto * SAMPLES);
    if (n < 1 && upto <= 0) return;
    for (let i = 0; i < Math.max(1, n); i++) {
      const t = i / SAMPLES;
      g.lineWidth = Math.max(1.4, c.width * (1 - t * 0.65));
      g.beginPath();
      g.moveTo(c.xs[i], c.ys[i]);
      const j = Math.min(SAMPLES, i + 1);
      const f = i + 1 > upto * SAMPLES ? upto * SAMPLES - i : 1;
      g.lineTo(c.xs[i] + (c.xs[j] - c.xs[i]) * f, c.ys[i] + (c.ys[j] - c.ys[i]) * f);
      g.stroke();
    }
  }

  /** How far along curve `ci` has grown, given the stem's growth. */
  function curveGrowth(ci: number): number {
    if (ci === 0) return stemG;
    const from = plant.curves[ci].from;
    return Math.max(0, Math.min(1, (stemG - from) / Math.max(0.05, 1 - from) * 1.4));
  }

  function leafPath(len: number, wid: number, strap: boolean): void {
    g.beginPath();
    g.moveTo(0, 0);
    if (strap) {
      g.quadraticCurveTo(len * 0.5, -wid, len, -wid * 0.2);
      g.quadraticCurveTo(len * 0.5, wid * 0.3, 0, 0);
    } else {
      g.quadraticCurveTo(len * 0.4, -wid, len, 0);
      g.quadraticCurveTo(len * 0.4, wid, 0, 0);
    }
  }

  const leafCache: [string, string, string][] = [];
  function leafColours(s: Plant["slots"][number], dorm: number): [string, string, string] {
    const hue = ink() ? 0 : paletteShift(s.hue);
    const sat = ink() ? 0 : 42 * (1 - dorm * 0.7);
    const l = ink() ? 30 + (s.light - 34) : s.light + dorm * 8;
    const hd = (hue - dorm * 50 + 360) % 360;
    return [`hsl(${hd} ${sat}% ${l}%)`, `hsl(${hd} ${sat + 8}% ${l + 14}%)`, `hsl(${hue} ${sat}% ${Math.max(12, l - 14)}%)`];
  }

  function drawLeaves(dorm: number, fold: number): void {
    const n = params.growth === "petals" ? plant.slots.length : Math.min(grown, plant.slots.length);
    for (let i = 0; i < n; i++) {
      const s = plant.slots[i];
      const k = params.growth === "petals" ? ease((stemG - s.h) * 6) : ease((clock - leafAt[i]) / leafDur);
      if (k <= 0) continue;
      at(plant.curves[s.curve], s.t, pt);
      const droop = dorm * 0.7 + fold * 0.5;
      const dir = s.strap ? -Math.PI / 2 + s.angle * (1 + droop) : pt.a + s.angle * (1 - fold * 0.6) + s.side * droop * 0.6;
      g.save();
      g.translate(pt.x, pt.y);
      g.rotate(dir);
      const len = s.len * k, wid = s.wid * Math.min(1, k * 1.3) * (1 - fold * 0.5);
      // Cached colours, except while fading to dormant.
      const col = dorm > 0 ? leafColours(s, dorm) : (leafCache[i] ??= leafColours(s, 0));
      g.fillStyle = col[0];
      leafPath(len, wid, s.strap);
      g.fill();
      g.globalAlpha = 0.5;
      g.fillStyle = col[1];
      g.translate(len * 0.06, -wid * 0.12);
      leafPath(len * 0.82, wid * 0.62, s.strap);
      g.fill();
      g.globalAlpha = 0.55;
      g.strokeStyle = col[2];
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.45, s.strap ? -wid * 0.4 : -wid * 0.1, len * 0.88, s.strap ? -wid * 0.2 : 0);
      g.stroke();
      g.globalAlpha = 1;
      g.restore();
    }
  }

  function drawBlueprint(): void {
    if (totalAt === Infinity || verifiedAt < Infinity || endAt < Infinity) return;
    const fade = Math.min(1, (clock - totalAt) / 0.8) * 0.9;
    g.globalAlpha = fade;
    g.strokeStyle = C.blueprint;
    g.lineWidth = 1;
    g.setLineDash([3, 4]);
    for (let ci = 0; ci < plant.curves.length; ci++) {
      const c = plant.curves[ci];
      g.beginPath();
      g.moveTo(c.xs[0], c.ys[0]);
      for (let i = 1; i <= SAMPLES; i++) g.lineTo(c.xs[i], c.ys[i]);
      g.stroke();
    }
    if (params.growth !== "petals") {
      for (let i = grown; i < plant.slots.length; i++) {
        const s = plant.slots[i];
        at(plant.curves[s.curve], s.t, pt);
        g.save();
        g.translate(pt.x, pt.y);
        g.rotate(s.strap ? -Math.PI / 2 + s.angle : pt.a + s.angle);
        leafPath(s.len, s.wid, s.strap);
        g.stroke();
        g.restore();
      }
    } else {
      // The flower head's petal outlines.
      const tip = plant.curves[0];
      headPetals(tip.xs[SAMPLES], tip.ys[SAMPLES], slotsN, 1, true);
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  /** A flower head made of `n` petals in rings (petals mode). With `outline` only strokes are drawn. */
  function headPetals(x: number, y: number, n: number, open: number, outline: boolean, shown = n, dorm = 0): void {
    const b = hashBloom ?? bloom;
    const rings = Math.max(1, Math.ceil(n / 20));
    let idx = 0;
    for (let ring = rings - 1; ring >= 0; ring--) {
      const inRing = Math.min(20, n - ring * 20);
      const rad = (34 + ring * 16) * (0.6 + 0.4 * open);
      for (let j = 0; j < inRing; j++) {
        const i = ring * 20 + j;
        if (!outline && i >= shown) { idx++; continue; }
        const a = (j / inRing) * Math.PI * 2 + ring * 0.3;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.beginPath();
        g.ellipse(rad * 0.55, 0, rad * 0.5, 5 + 6 / rings, 0, 0, Math.PI * 2);
        if (outline) g.stroke();
        else {
          const hue = ink() ? 0 : hashBloom ? b.hue : paletteShift(plant.leafHue) + 40;
          g.fillStyle = `hsl(${hue + ring * 12} ${ink() ? 0 : (hashBloom ? 68 : 30) * (1 - dorm * 0.7)}% ${62 + ring * 6}%)`;
          g.fill();
        }
        g.restore();
        idx++;
      }
    }
  }

  function drawFlower(dorm: number, fold: number): void {
    const open = verifiedAt < Infinity ? ease((clock - verifiedAt) / (ctx.reducedMotion ? 3 : 2)) * (1 - dorm) : 0;
    const progress = total ? Math.min(1, state.completed / total) : 0;
    const checking = state.phase === "verifying" && verifiedAt === Infinity;
    for (const ci of plant.tips) {
      if (curveGrowth(ci) < 0.98 && !(ci === 0 && stemG > 0.3)) continue;
      const c = plant.curves[ci];
      const gr = curveGrowth(ci);
      at(c, Math.min(gr, 1), pt);
      const x = pt.x, y = pt.y;
      const main = ci === 0;
      if (params.growth === "petals" && main) {
        // Petals mode: one petal per chunk group on the head.
        const shown = Math.min(slotsN, Math.floor(state.completed / perSlot) + (state.completed >= total && total ? 1 : 0));
        headPetals(x, y, slotsN, Math.max(0.3, open), false, shown, dorm);
        g.fillStyle = hashBloom && !ink() ? `hsl(${hashBloom.hue2} 70% 45%)` : "hsl(45 40% 45%)";
        g.beginPath();
        g.arc(x, y, 14, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      const size = (main ? 1 : 0.55) * (plant.species === "daisy" ? 1 : 0.9);
      if (open <= 0.02) {
        // Bud: swells with progress; glows gently while the whole file is checked.
        const bs = (8 + 10 * progress) * size;
        const shake = state.stalled && !ctx.reducedMotion ? Math.sin(clock * 9) * 0.08 : 0;
        if (checking && !ctx.reducedMotion) {
          g.fillStyle = `${C.sun}${(0.18 + 0.12 * Math.sin(clock * 3)).toFixed(3)})`;
          g.beginPath();
          g.arc(x, y - bs * 0.6, bs * 2.2, 0, Math.PI * 2);
          g.fill();
        }
        g.save();
        g.translate(x, y);
        g.rotate(pt.a + Math.PI / 2 + shake + fold * 0.5);
        g.fillStyle = ink() ? "#666" : `hsl(${(paletteShift(plant.leafHue) + 20) % 360} 35% ${40 - dorm * 5}%)`;
        g.beginPath();
        g.ellipse(0, -bs * 0.7, bs * 0.55, bs, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = ink() ? "#999" : `hsl(${bloom.hue} 45% 62%)`;
        g.globalAlpha = 0.6 * progress;
        g.beginPath();
        g.ellipse(0, -bs * 1.2, bs * 0.25, bs * 0.45, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.restore();
        continue;
      }
      const b = hashBloom ?? bloom;
      const n = b.petals;
      const R = (plant.species === "daisy" ? 40 : plant.species === "lily" ? 46 : 22) * size * b.length * open;
      const pw = plant.species === "daisy" ? 5.5 : plant.species === "lily" ? 15 : 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.round;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillStyle = ink() ? (i % 2 ? "#bbb" : "#ccc") : `hsl(${b.hue} ${70 - dorm * 50}% ${i % 2 ? 72 : 76}%)`;
        g.beginPath();
        if (plant.species === "lily") {
          g.moveTo(0, 0);
          g.quadraticCurveTo(R * 0.5, -pw * size, R, 0);
          g.quadraticCurveTo(R * 0.5, pw * size, 0, 0);
        } else g.ellipse(R * 0.55, 0, R * 0.5, pw * size * (0.6 + 0.4 * open), 0, 0, Math.PI * 2);
        g.fill();
        if (!ink()) {
          g.strokeStyle = `hsl(${b.hue2} 60% 50%)`;
          g.globalAlpha = 0.35;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(R * 0.12, 0);
          g.lineTo(R * 0.7, 0);
          g.stroke();
          g.globalAlpha = 1;
        }
        g.restore();
      }
      g.fillStyle = ink() ? "#444" : plant.species === "daisy" ? "hsl(44 85% 52%)" : `hsl(${b.hue2} 70% 42%)`;
      g.beginPath();
      g.arc(x, y, (plant.species === "daisy" ? 11 : 6) * size * (0.5 + 0.5 * open), 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawPlant(): void {
    if (!plant || (stemG <= 0 && mapAt === Infinity)) return;
    const dorm = state.phase === "failed" ? ease((clock - endAt) / 1.5) : 0;
    const fold = state.phase === "cancelled" ? ease((clock - endAt) / 1.5) : 0;
    g.save();
    // Sway: shear about the base, stronger in a stall's breeze.
    g.transform(1, 0, -sway, 1, sway * SOIL, 0);
    g.strokeStyle = ink() ? "#2a2a2a" : dorm > 0 ? `hsl(30 ${30 - dorm * 15}% ${30 + dorm * 8}%)` : plant.stemColour;
    g.lineCap = "round";
    for (let ci = 0; ci < plant.curves.length; ci++) drawCurve(ci, curveGrowth(ci));
    drawLeaves(dorm, fold);
    drawFlower(dorm, fold);
    g.restore();
    // Dormant, not dead: a small new shoot at the base.
    if (dorm > 0) {
      const k = ease((clock - endAt - 1.5) / 1.2);
      if (k > 0) {
        g.strokeStyle = `hsl(${paletteShift(plant.leafHue)} 50% 42%)`;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(BASE_X + 26, SOIL);
        g.quadraticCurveTo(BASE_X + 30, SOIL - 12 * k, BASE_X + 26, SOIL - 22 * k);
        g.stroke();
        g.fillStyle = `hsl(${paletteShift(plant.leafHue)} 50% 48%)`;
        g.save();
        g.translate(BASE_X + 26, SOIL - 20 * k);
        g.rotate(-0.6);
        leafPath(14 * k, 6 * k, false);
        g.fill();
        g.restore();
      }
    }
  }

  function drawLabel(): void {
    if (ctx.size !== "full" || !state.address) return;
    g.fillStyle = C.muted;
    g.font = 'italic 13px Georgia, "Times New Roman", serif';
    g.textAlign = "left";
    const kind = plant.species === "shrub" ? "branching shrub" : plant.species;
    const parts = [`No. ${state.address.slice(0, 4)}·${state.address.slice(4, 8)}`, kind];
    if (total) parts.push(`${slotsN} ${params.growth === "petals" ? "petals" : "leaves"}${perSlot > 1 ? ` (${perSlot} chunks each)` : " (one per chunk)"}`);
    g.fillText(parts.join(" · "), 28, 34);
    let note = "";
    if (state.phase === "failed") note = "dormant · try again";
    else if (state.phase === "cancelled") note = "cancelled · resting";
    else if (state.stalled) note = "waiting for the network…";
    else if (state.phase === "verifying" && verifiedAt === Infinity) note = "checking the whole file…";
    else if (verifiedAt < Infinity && state.hash) note = `in bloom · ${state.hash.slice(0, 8)}`;
    if (note) {
      g.fillText(note, 28, 54);
      g.textAlign = "left";
    }
  }

  function drawPaper(): void {
    const k = Number(params.paper);
    if (!paper || k <= 0) return;
    g.globalAlpha = k;
    g.fillStyle = paper;
    g.fillRect(-200, -200, W + 400, H + 600);
    g.globalAlpha = 1;
  }

  function drawScene(): void {
    drawBackground();
    drawRoots();
    drawBlueprint();
    drawPlant();
    drawPaper();
  }

  // ---------------------------------------------------------------------------
  // Portrait.

  function savePortrait(): void {
    const PW = 1000, PH = params.caption ? 1380 : 1250;
    const out = document.createElement("canvas");
    out.width = PW;
    out.height = PH;
    const keep = g;
    g = out.getContext("2d")!;
    const frame = String(params.frame);
    const mat = frame === "mat" ? 70 : frame === "line" ? 30 : 0;
    g.fillStyle = frame === "mat" ? (ctx.theme === "dark" ? "#2a2c35" : "#fbf8f1") : C.paper;
    g.fillRect(0, 0, PW, PH);
    // The plant, cropped to a 4:5 window around it.
    const ch = Math.max(550, SOIL + 120 - (plantTop - 16));
    const crop = { x: BASE_X - (ch * 0.8) / 2, y: SOIL + 120 - ch, w: ch * 0.8, h: ch };
    const iw = PW - mat * 2, ih = (iw * 5) / 4;
    g.save();
    g.beginPath();
    g.rect(mat, mat, iw, ih);
    g.clip();
    const s = iw / crop.w;
    g.setTransform(s, 0, 0, s, mat - crop.x * s, mat - crop.y * s);
    const sw = sway;
    sway = 0;
    drawScene();
    sway = sw;
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (frame !== "none") {
      g.strokeStyle = ctx.theme === "dark" ? "#77737f" : "#5a5045";
      g.lineWidth = frame === "mat" ? 2 : 3;
      g.strokeRect(mat, mat, iw, ih);
    }
    if (params.caption) {
      g.fillStyle = ctx.theme === "dark" && frame !== "mat" ? "#e9e3d3" : ctx.theme === "dark" ? "#e9e3d3" : "#3a3128";
      g.textAlign = "center";
      g.font = 'italic 34px Georgia, "Times New Roman", serif';
      g.fillText(state.name ?? `${state.address.slice(0, 12)}…`, PW / 2, mat + ih + 62);
      g.font = '18px ui-monospace, Consolas, monospace';
      g.fillText(`verified · ${state.hash?.slice(0, 16) ?? ""}…`, PW / 2, mat + ih + 96);
      g.font = 'italic 15px Georgia, "Times New Roman", serif';
      g.fillText("grown from an Autonomi download", PW / 2, mat + ih + 124);
    }
    g = keep;
    const base = (state.name ?? "").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || state.address.slice(0, 12) || "file";
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}-garden.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  // ---------------------------------------------------------------------------

  return {
    id: "hash-garden",
    title: "Hash garden",
    theme: "artistic",
    wantsEnriched: false,
    libs: ["Canvas 2D"],
    illustrativeNote: "the shoot's search for light, and where each leaf grows",
    tweakables,

    mount(c: SkinContext) {
      ctx = c;
      params = { ...params, ...c.params };
      C = theme(c.theme === "dark");
      if (getComputedStyle(c.container).position === "static") c.container.style.position = "relative";
      canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%";
      c.container.appendChild(canvas);
      g = canvas.getContext("2d")!;
      makePaper();
      build();
      if (c.size === "full") {
        saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "Save portrait";
        saveBtn.title = "Download the grown plant as a PNG";
        saveBtn.style.cssText =
          "position:absolute;top:12px;right:12px;display:none;padding:6px 14px;border-radius:8px;border:1px solid #0003;" +
          "background:#fffd;color:#3a3128;font:500 13px system-ui,sans-serif;cursor:pointer";
        saveBtn.addEventListener("click", savePortrait);
        c.container.appendChild(saveBtn);
      }
    },

    onEvent(e: VizEvent) {
      reduce(state, e);
      switch (e.type) {
        case "session.start":
          build();
          break;
        case "connect.start":
          seeds = Math.min(12, e.seeds);
          placeSeeds(seeds);
          connectAt = stamp();
          break;
        case "connect.peer": {
          const i = BUNDLED_SEEDS.indexOf(e.peerId);
          peerIdx = i >= 0 && i < seeds ? i : 0;
          break;
        }
        case "connect.done":
          if (findAt === Infinity) findAt = stamp();
          break;
        case "lookup.round":
        case "lookup.fail":
          if (hairs.length < 48) {
            const r = prng(ctx.seed, hairs.length + 77);
            const x0 = BASE_X + (r() - 0.5) * 30, y0 = SOIL + 14 + r() * 20;
            const a = Math.PI / 2 + (r() - 0.5) * 2.2;
            const l = 30 + r() * 50;
            hairs.push({ x0, y0, x1: x0 + Math.cos(a) * l, y1: y0 + Math.sin(a) * l, at: stamp(), failed: e.type === "lookup.fail" });
          }
          if (findAt === Infinity) findAt = stamp();
          break;
        case "datamap.verified":
          if (mapAt === Infinity) mapAt = stamp();
          break;
        case "chunk.done":
          setTotal(e.total);
          if (totalAt === Infinity) totalAt = stamp();
          if (mapAt === Infinity) mapAt = stamp();
          if (params.growth !== "petals") {
            const target = e.completed >= e.total ? slotsN : Math.floor(e.completed / perSlot);
            while (grown < target) leafAt[grown++] = snapping ? -1e3 : clock + (grown % 3) * 0.05;
          }
          break;
        case "file.verified":
          if (!total) { setTotal(state.total ?? 12); totalAt = stamp(); grown = params.growth === "petals" ? 0 : slotsN; leafAt.fill(stamp(), 0, slotsN); }
          hashBloom = makeBloom(plant.species, e.hash, plant.leafHue);
          verifiedAt = stamp();
          break;
        case "session.failed":
        case "connect.failed":
        case "session.cancelled":
          if (endAt === Infinity) endAt = stamp();
          break;
      }
    },

    frame(dtMs) {
      if (!w) return;
      const dt = Math.min(dtMs, 100) / 1000;
      clock += dt;
      // Growth follows the rate: leaves unfurl faster when chunks come quickly.
      leafDur = Math.max(0.3, Math.min(1.2, 1.4 / (1 + state.chunksPerSec * 0.6)));
      let target = 0;
      if (mapAt < Infinity) target = 0.08;
      if (total) {
        const done = state.completed / total;
        const last = grown > 0 && params.growth !== "petals" ? plant.slots[Math.min(grown, plant.slots.length) - 1].h : 0;
        target = Math.max(target, 0.12 + done * 0.8, last + 0.07);
        if (state.completed >= total) target = 1;
      }
      if (verifiedAt < Infinity) target = 1;
      stemG = snapping ? target : approach(stemG, Math.min(1, target), 2.2, dt);
      const breeze = state.stalled && endAt === Infinity ? 0.035 : state.phase === "failed" || state.phase === "cancelled" ? 0 : 0.008;
      sway = ctx.reducedMotion ? 0 : breeze * Math.sin(clock * 1.1) + breeze * 0.4 * Math.sin(clock * 2.7);

      const vw = ctx.size === "full" ? VIEW.full : card;
      if (ctx.size === "card") {
        const goal = mapAt < Infinity || endAt < Infinity ? card.y : card.rootsY;
        camY = snapping || ctx.reducedMotion ? goal : approach(camY, goal, 1.6, dt);
      }
      const vy = ctx.size === "card" ? camY : vw.y;
      const s = Math.min(w / vw.w, h / vw.h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.paper;
      g.fillRect(0, 0, w, h);
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * ((w - vw.w * s) / 2 - vw.x * s), dpr * ((h - vw.h * s) / 2 - vy * s));
      drawScene();
      drawLabel();

      if (saveBtn) {
        const show = verifiedAt < Infinity && clock - verifiedAt > 2.2 && state.phase !== "failed" && state.phase !== "cancelled";
        saveBtn.style.display = show ? "block" : "none";
      }
      snapping = false;
    },

    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      canvas.width = Math.round(nw * ndpr);
      canvas.height = Math.round(nh * ndpr);
    },

    setParams(p) {
      const prev = { ...params };
      params = { ...params, ...p };
      if (prev.palette !== params.palette) leafCache.length = 0;
      if (prev.species !== params.species || prev.growth !== params.growth) {
        build();
        if (params.growth !== "petals") {
          grown = total ? (state.completed >= total ? slotsN : Math.floor(state.completed / perSlot)) : 0;
          leafAt.fill(-1e3, 0, grown);
        }
      }
    },

    describe() {
      return describeState(state);
    },

    destroy() {
      canvas?.remove();
      saveBtn?.remove();
    },

    stats() {
      return { leaves: Math.min(grown, slotsN), slots: slotsN, perSlot };
    },
  };
}
