// Address → 32-byte seed, and a small seeded PRNG so every skin looks the same on replay.

/** 32 bytes from a 64-hex-char address. Anything else is hashed (FNV-1a, spread) into 32 bytes. */
export function seedFromAddress(address: string): Uint8Array {
  const hex = address.trim().toLowerCase().replace(/^0x/, "");
  const out = new Uint8Array(32);
  if (/^[0-9a-f]{64}$/.test(hex)) {
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < hex.length; j++) h = Math.imul(h ^ hex.charCodeAt(j) ^ i, 0x01000193);
    out[i] = (h >>> 24) & 0xff;
  }
  return out;
}

/** sfc32: fast, small, good enough for visuals. Returns floats in [0, 1). */
export function prng(seed: Uint8Array, stream = 0): () => number {
  const word = (i: number) =>
    (seed[i % 32] | (seed[(i + 1) % 32] << 8) | (seed[(i + 2) % 32] << 16) | (seed[(i + 3) % 32] << 24)) >>> 0;
  let a = word(0) ^ stream;
  let b = word(4) ^ Math.imul(stream, 0x9e3779b9);
  let c = word(8);
  let d = word(12) | 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** A deterministic shuffle of 0..n-1. */
export function permutation(n: number, rand: () => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** 32-bit hash of a string (FNV-1a), for turning a peer ID into a stable number. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
