// The plant's form, generated from the file's address: species, stem and branch curves, and one slot
// for every leaf (or petal) the download will grow. The same address always grows the same plant.

import { prng } from "../../events/seed";

export type Species = "daisy" | "shrub" | "lily";
export const SPECIES: Species[] = ["daisy", "shrub", "lily"];

export interface Curve {
  /** Sampled points, base first. */
  xs: Float32Array;
  ys: Float32Array;
  /** Where on the main stem it starts (0 for the stem itself). */
  from: number;
  width: number;
}

export interface Slot {
  curve: number; // index into Plant.curves
  t: number; // 0..1 along the curve
  side: number; // -1 or 1
  angle: number; // radians from the curve's direction
  len: number;
  wid: number;
  strap: boolean; // a long basal leaf (lily)
  hue: number;
  light: number;
  /** Height above the soil, as a fraction of the plant (growth order). */
  h: number;
}

export interface Plant {
  species: Species;
  baseX: number;
  soilY: number;
  height: number;
  curves: Curve[];
  slots: Slot[];
  /** Where flowers go: [curve index] (the tip of each). */
  tips: number[];
  leafHue: number;
  stemColour: string;
}

export const SAMPLES = 32;

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function makeCurve(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, from: number, width: number): Curve {
  const xs = new Float32Array(SAMPLES + 1), ys = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    xs[i] = cubic(x0, x1, x2, x3, t);
    ys[i] = cubic(y0, y1, y2, y3, t);
  }
  return { xs, ys, from, width };
}

/** A point and direction along a curve, into `out`. */
export function at(c: Curve, t: number, out: { x: number; y: number; a: number }): void {
  const f = Math.max(0, Math.min(1, t)) * SAMPLES;
  const i = Math.min(SAMPLES - 1, Math.floor(f)), k = f - i;
  out.x = c.xs[i] + (c.xs[i + 1] - c.xs[i]) * k;
  out.y = c.ys[i] + (c.ys[i + 1] - c.ys[i]) * k;
  out.a = Math.atan2(c.ys[i + 1] - c.ys[i], c.xs[i + 1] - c.xs[i]);
}

export function makePlant(seed: Uint8Array, slots: number, speciesPick: string, soilY: number, baseX: number): Plant {
  const r = prng(seed, 0x9a4d);
  const species: Species = SPECIES.includes(speciesPick as Species) ? (speciesPick as Species) : SPECIES[seed[4] % 3];
  const height = species === "lily" ? 320 + r() * 30 : species === "shrub" ? 290 + r() * 40 : 320 + r() * 40;
  const lean = (r() - 0.5) * 0.5;
  const bend = (r() - 0.5) * 60;
  const topX = baseX + lean * height * 0.3;
  const topY = soilY - height;
  const curves: Curve[] = [
    makeCurve(baseX, soilY, baseX + bend * 0.4, soilY - height * 0.35, topX - bend, soilY - height * 0.7, topX, topY, 0, species === "shrub" ? 11 : 8),
  ];
  const tips = [0];
  const leafHue = 88 + (seed[7] / 255) * 55;

  if (species === "shrub") {
    const n = 2 + (seed[8] % 3);
    for (let b = 0; b < n; b++) {
      const from = 0.3 + (b / n) * 0.5 + r() * 0.06;
      const p = { x: 0, y: 0, a: 0 };
      at(curves[0], from, p);
      const side = b % 2 ? 1 : -1;
      const ang = -Math.PI / 2 + side * (0.55 + r() * 0.45);
      const len = height * (0.38 - b * 0.04 + r() * 0.08);
      const ex = p.x + Math.cos(ang) * len, ey = p.y + Math.sin(ang) * len;
      curves.push(makeCurve(p.x, p.y, p.x + Math.cos(ang) * len * 0.4, p.y + Math.sin(ang) * len * 0.3, ex - side * len * 0.1, ey + len * 0.1, ex, ey - len * 0.05, from, 6));
      tips.push(curves.length - 1);
    }
  }

  // Leaf slots.
  const out: Slot[] = [];
  const base = { x: 0, y: 0, a: 0 };
  const size = Math.max(0.62, Math.min(1.25, 1.7 / Math.sqrt(Math.max(1, slots) / 6)));
  const spread = slots > 24 ? 0.25 : 0; // many leaves stand further out, so the plant reads as full
  for (let i = 0; i < slots; i++) {
    let curve = 0, t = 0, strap = false;
    const side = i % 2 ? 1 : -1;
    if (species === "lily" && i < Math.min(8, Math.ceil(slots * 0.35))) {
      strap = true;
      t = 0.005 + r() * 0.02;
    } else if (species === "shrub" && curves.length > 1 && r() < 0.6) {
      curve = 1 + Math.floor(r() * (curves.length - 1));
      t = 0.2 + r() * 0.75;
    } else {
      t = 0.08 + ((i + r() * 0.6) / Math.max(1, slots)) * 0.78;
    }
    at(curves[curve], t, base);
    const hl = (soilY - base.y) / height;
    out.push({
      curve, t, side, strap,
      angle: strap ? side * (0.25 + r() * 0.5) : side * (0.7 + spread + r() * 0.5),
      len: (strap ? 120 + r() * 60 : (36 + r() * 16) * (1.15 - hl * 0.5)) * (strap ? 1 : size),
      wid: (strap ? 12 + r() * 5 : (13 + r() * 6) * (1.15 - hl * 0.5)) * (strap ? 1 : size),
      hue: leafHue + (r() - 0.5) * 16,
      light: 34 + r() * 14,
      h: hl,
    });
  }
  out.sort((a, b) => a.h - b.h);
  return { species, baseX, soilY, height, curves, slots: out, tips, leafHue, stemColour: `hsl(${leafHue - 12} 34% 30%)` };
}

/** The flower's look from the hash (or the address before the hash is known). */
export interface Bloom {
  petals: number;
  hue: number;
  hue2: number;
  length: number;
  round: number;
}

export function makeBloom(species: Species, hex: string, leafHue: number): Bloom {
  const b = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  const fib = [13, 21, 34];
  // Petals always stand out from the leaves: somewhere in the 200 degrees opposite their green.
  const hue = (leafHue + 80 + (b(1) / 255) * 200) % 360;
  return {
    petals: species === "daisy" ? fib[b(0) % 3] : species === "lily" ? 6 : 5,
    hue,
    hue2: (hue + 30 + (b(2) / 255) * 60) % 360,
    length: 0.85 + (b(3) / 255) * 0.35,
    round: b(4) / 255,
  };
}
