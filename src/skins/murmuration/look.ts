// Murmuration's seeded look: palette, weave pattern and the hash "portrait".

import { Color } from "three";

export const PRESETS: Record<string, [string, string, string, string, string]> = {
  // weft colours ×4, then the warp/flock colour
  night: ["#3d5bd9", "#8fb3ff", "#e8c26a", "#1d2b6b", "#cfe0ff"],
  dawn: ["#e2627c", "#f6b26b", "#8f5bd6", "#5a2246", "#ffd9c2"],
  aurora: ["#2fd39a", "#3aa7d8", "#9a6cf0", "#0f4f4a", "#c8fff0"],
  ember: ["#e8572a", "#f2b33d", "#b8325a", "#4a1a12", "#ffe0b8"],
};

export interface Look {
  /** Four weft colours and one warp/flock colour, linear RGB. */
  weft: Color[];
  warp: Color;
  /** Flock colours. */
  flockA: Color;
  flockB: Color;
  /** 0 twill, 1 diamond, 2 stripes. */
  pattern: number;
  /** Pattern detail, 0..1. */
  detail: [number, number, number, number];
}

export function makeLook(seed: Uint8Array, palette: string, weave: string): Look {
  let weft: Color[];
  let warp: Color;
  if (palette in PRESETS) {
    const p = PRESETS[palette];
    weft = p.slice(0, 4).map((c) => new Color(c));
    warp = new Color(p[4]);
  } else {
    // Seeded: a base hue and one of three harmonies.
    const h0 = seed[2] / 256;
    const scheme = seed[3] % 3;
    const offs = scheme === 0 ? [0, 0.08, -0.08, 0.5] : scheme === 1 ? [0, 0.42, 0.58, 0.04] : [0, 0.333, 0.667, 0.5];
    const sat = 0.55 + (seed[4] / 255) * 0.3;
    weft = offs.map((o, i) => new Color().setHSL((h0 + o + 1) % 1, i === 3 ? sat * 0.7 : sat, i === 3 ? 0.22 : 0.5 + (i % 2) * 0.12));
    warp = new Color().setHSL((h0 + 0.02) % 1, 0.45, 0.82);
  }
  const flockA = warp.clone();
  const flockB = weft[1].clone().lerp(new Color(1, 1, 1), 0.35);
  const pattern = weave === "twill" ? 0 : weave === "diamond" ? 1 : weave === "stripes" ? 2 : seed[5] % 3;
  return { weft, warp, flockA, flockB, pattern, detail: [seed[6] / 255, seed[7] / 255, seed[8] / 255, seed[9] / 255] };
}

/** 8 × 16 cells (mirrored to 16 × 16 in the shader), 2 bits each: all 256 bits of a 32-byte hash. */
export function portraitCells(hash: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 * 16);
  for (let i = 0; i < out.length; i++) out[i] = ((hash[i >> 2] >> ((i & 3) * 2)) & 3) * 85;
  return out;
}

/** Ring angle (radians) of a 64-hex address or peer ID: its first 16 bits, i.e. its place in the address space. */
export function ringAngle(hex: string, fallback: number): number {
  const m = /^[0-9a-f]{4}/i.exec(hex.trim());
  return m ? (parseInt(m[0], 16) / 65536) * Math.PI * 2 : fallback;
}
