// Address-space helpers. File addresses, DataMap records and node peer IDs are all 32-byte values in
// one space (checked on mainnet 2026-10-15: the nodes findClosest returns for a file share 5-11
// leading bits with its address, where random IDs would share about 1). Distance is XOR, so "closer"
// means "shares more leading bits".

/** Position on the ring, 0..1, from the first 32 bits. */
export function frac(hex: string): number {
  return parseInt(hex.slice(0, 8), 16) / 4294967296;
}

/** How many leading bits two 64-hex addresses share (0..256). */
export function sharedBits(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < 64; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    if (Number.isNaN(x)) return n;
    if (x === 0) { n += 8; continue; }
    return n + Math.clz32(x) - 24;
  }
  return n;
}

/** A 64-hex address sharing exactly `bits` leading bits with `target`, the rest from `rand`. */
export function addressNear(target: string, bits: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    const t = parseInt(target.slice(i * 2, i * 2 + 2), 16);
    const keep = Math.max(0, Math.min(8, bits - i * 8));
    let b = Math.floor(rand() * 256);
    if (keep > 0) b = (t & (0xff << (8 - keep)) & 0xff) | (b & (0xff >> keep));
    if (keep < 8 && bits >= i * 8 && bits < i * 8 + 8) b ^= (t ^ ~b) & (0x80 >> keep);
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/** "1 in 2,048" for 11 shared bits. */
export function shareOfSpace(bits: number): string {
  if (bits <= 0) return "anywhere in the address space";
  if (bits > 40) return `1 in 2^${bits}`;
  return `1 in ${Math.pow(2, bits).toLocaleString("en-GB")}`;
}

/**
 * The seed nodes bundled in @withautonomi/ant-browser-sdk 0.1.2 (the WebRTC Direct multiaddrs in its
 * WASM core end in these peer IDs). The browser authenticates them first.
 */
export const BUNDLED_SEEDS = [
  "2ed6785d3aab00fc4ef048884c63b2a85fb587441413a94a7eb8f8e8b65bd582",
  "3926125b8454101fd39739a09320ca0174be90d3423c1287926172bea69a0f5a",
  "57a89f84e1652d22fd6b791c29d83f187fbed3ba8e08e265fe3031b3a6f725da",
  "825916f9447f45d93554d3be742f9a76f7dede9190368dbdb15d34ff7211e9e1",
  "a1f073e0ffc1a1890e8d072015fa2437a1090997b47c0412c0bfabe7c7e16199",
  "bb72725f8f4383eb475ac9cb681505d9147e8b2c5a4c0197d4efdb328c54601f",
  "dac90975f872f6401519f7b14bfd860792c9052964ffdbd40d190f35469e4ad1",
];
