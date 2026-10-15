// Synthetic traces: raw SDK-shaped records (the same message strings the real SDK sends, so they
// go through the same parser) plus Tier C per-chunk detail. Deterministic for given parameters.

import { hashString, prng, seedFromAddress } from "../events/seed";
import type { RawSdkEvent, Trace, TraceRecord, VizEventBody } from "../events/types";
import { SDK_VERSION } from "./version";

export interface SyntheticParams {
  address: string;
  name?: string;
  size: number;
  chunks: number;
  connectMs: number;
  /** Time spent finding and fetching the DataMap. Real 0.1.2 runs report nothing during it. */
  datamapMs: number;
  /** Lookup rounds reported while finding the DataMap (0 matches what real runs show today). */
  lookupRounds: number;
  lookupFailures: number;
  invalidAnswers: number;
  reseed: boolean;
  nested: boolean;
  /** Time to resolve the nested records (about 11 s in a real 64 MB run). */
  nestedMs: number;
  concurrency: number;
  latencyMs: number;
  /** 0..1: spread of per-chunk latency (log-normal). */
  jitter: number;
  /** Chance a chunk needs a second request (Tier C detail only). */
  retryRate: number;
  stalls: { at: number; ms: number }[];
  outcome: "success" | "fail-connect" | "fail-mid" | "cancel";
  save: boolean;
}

export const DEFAULT_SYNTHETIC: SyntheticParams = {
  address: syntheticAddress("synthetic"),
  size: 40_000_000,
  chunks: 12,
  connectMs: 3000,
  datamapMs: 4500,
  lookupRounds: 0,
  lookupFailures: 0,
  invalidAnswers: 0,
  reseed: false,
  nested: false,
  nestedMs: 10_000,
  concurrency: 6,
  latencyMs: 1600,
  jitter: 0.5,
  retryRate: 0.02,
  stalls: [],
  outcome: "success",
  save: false,
};

export const SYNTHETIC_PRESETS: Record<string, { label: string; params: Partial<SyntheticParams> }> = {
  "synthetic-small": { label: "Small file (synthetic)", params: { address: syntheticAddress("small"), size: 140_000, chunks: 3, latencyMs: 1200 } },
  "synthetic-large": {
    label: "Large file, 210 chunks (synthetic stand-in)",
    params: { address: syntheticAddress("large"), size: 850_000_000, chunks: 210, concurrency: 8, latencyMs: 2400, nested: true },
  },
  flaky: {
    label: "Flaky: failed queries, reseed, two stalls",
    params: {
      address: syntheticAddress("flaky"), size: 160_000_000, chunks: 40, lookupRounds: 6, lookupFailures: 3, invalidAnswers: 1,
      reseed: true, retryRate: 0.1, jitter: 0.8, stalls: [{ at: 0.3, ms: 7000 }, { at: 0.7, ms: 9000 }],
    },
  },
  nested: { label: "Nested DataMap (synthetic)", params: { address: syntheticAddress("nested"), size: 600_000_000, chunks: 150, nested: true, concurrency: 8 } },
  "fail-connect": { label: "Connection fails (UDP blocked)", params: { address: syntheticAddress("fail-connect"), outcome: "fail-connect" } },
  "fail-mid": { label: "Fails half-way through", params: { address: syntheticAddress("fail-mid"), size: 240_000_000, chunks: 60, outcome: "fail-mid" } },
  cancel: { label: "Cancelled by the user", params: { address: syntheticAddress("cancel"), size: 240_000_000, chunks: 60, outcome: "cancel" } },
  huge: {
    label: "Huge: 3,000 chunks (stress test)",
    params: { address: syntheticAddress("huge"), size: 999_000_000, chunks: 3000, concurrency: 32, latencyMs: 900, jitter: 0.4 },
  },
};

/** A stable, fake 64-hex address for a preset. */
export function syntheticAddress(label: string): string {
  const r = prng(seedFromAddress(label), hashString(label));
  let hex = "";
  for (let i = 0; i < 32; i++) hex += Math.floor(r() * 256).toString(16).padStart(2, "0");
  return hex;
}

/** A random 64-hex address that shares exactly `bits` leading bits with `target`. */
function closerTo(target: string, bits: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < 32; i++) {
    const t = parseInt(target.slice(i * 2, i * 2 + 2), 16);
    const keep = Math.max(0, Math.min(8, bits - i * 8)); // leading bits of this byte copied from the target
    let b = Math.floor(rand() * 256);
    if (keep > 0) b = (t & (0xff << (8 - keep)) & 0xff) | (b & (0xff >> keep));
    if (keep < 8 && bits >= i * 8 && bits < i * 8 + 8) b ^= ((t ^ ~b) & (0x80 >> keep)); // the next bit differs
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export function presetTrace(id: string): Trace {
  const preset = SYNTHETIC_PRESETS[id];
  if (!preset) throw new Error(`Unknown synthetic preset ${id}`);
  return generateTrace({ ...DEFAULT_SYNTHETIC, ...preset.params }, preset.label);
}

export function generateTrace(p: SyntheticParams, note?: string): Trace {
  const rand = prng(seedFromAddress(p.address), hashString(JSON.stringify(p)));
  const hex = () => {
    let s = "";
    for (let i = 0; i < 32; i++) s += Math.floor(rand() * 256).toString(16).padStart(2, "0");
    return s;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const records: TraceRecord[] = [];
  const opPrefix = hex().slice(0, 10);
  const sdk = (t: number, op: number, operation: string, phase: string, message: string, extra: Partial<RawSdkEvent> = {}) =>
    records.push({ t: Math.round(t), kind: "sdk", ev: { operationId: `${opPrefix}-${op}`, operation, phase, message, status: "running", ...extra } });
  const detail = (t: number, ev: VizEventBody) => records.push({ t: Math.round(t), kind: "detail", ev });

  // Connect.
  sdk(5, 1, "connect", "initializing", "Initializing the Autonomi browser core");
  sdk(15, 1, "connect", "connecting", "Authenticating 7 bootstrap nodes");
  if (p.outcome === "fail-connect") {
    const error = { name: "AutonomiError", code: "CONNECTION_FAILED", message: "Could not connect to Autonomi" };
    sdk(15 + Math.max(p.connectMs, 10_000), 1, "connect", "connecting", "Authenticating 7 bootstrap nodes", { status: "failed", error });
    return finish(p, records, note);
  }
  const seedPeer = hex();
  let t = 15 + p.connectMs;
  sdk(t, 1, "connect", "complete", `Connected to authenticated peer ${seedPeer}`);
  sdk(t, 1, "connect", "complete", `Connected to authenticated peer ${seedPeer}`, { status: "succeeded" });

  // Find the DataMap.
  const op = 2;
  const operation = p.save ? "download-and-save" : "download";
  const name = `public-file-${p.address.slice(0, 16)}.bin`;
  t += 3;
  sdk(t, op, operation, "downloading", `Fetching public DataMap ${p.address}`);
  sdk(t, op, operation, "downloading", `Fetching ${p.address}`);
  const peers: string[] = [seedPeer];
  const steps = p.lookupRounds + p.lookupFailures + p.invalidAnswers + (p.reseed ? 1 : 0);
  const step = p.datamapMs / (steps + 1);
  const kinds: string[] = [
    ...Array(p.lookupRounds).fill("round"), ...Array(p.lookupFailures).fill("fail"), ...Array(p.invalidAnswers).fill("invalid"),
  ];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  if (p.reseed) kinds.splice(Math.floor(kinds.length / 2), 0, "reseed");
  let iteration = 0;
  for (const kind of kinds) {
    t += step * (0.6 + 0.8 * rand());
    const peer = kind === "round" ? closerTo(p.address, 1 + iteration * 2 + Math.floor(rand() * 2), rand) : hex();
    if (kind === "round") {
      peers.push(peer);
      sdk(t, op, operation, "downloading", `Iteration ${++iteration}: ${peer} returned ${4 + Math.floor(rand() * 13)} nodes`);
    } else if (kind === "fail") sdk(t, op, operation, "downloading", `Query ${peer} failed: lookup query error: timed out`);
    else if (kind === "invalid") sdk(t, op, operation, "downloading", `Ignoring invalid candidate from ${peer}: candidate is not closer to the target`);
    else sdk(t, op, operation, "downloading", "Retrying lookup through configured seeds");
  }
  t = Math.max(t + step, 18 + p.connectMs + p.datamapMs);
  sdk(t, op, operation, "downloading", `Verified public DataMap (${300 + Math.floor(rand() * 40)} bytes)`);
  // As in real runs: nested records are resolved after the top-level DataMap is verified.
  if (p.nested) {
    for (let i = 0; i < 3; i++) {
      const record = hex();
      sdk(t + 1, op, operation, "downloading", `Resolving nested DataMap record ${record}`);
      sdk(t + 1, op, operation, "downloading", `Fetching ${record}`);
    }
    t += p.nestedMs;
  }
  t += 3;
  sdk(t + 1, op, operation, "downloading", `Downloaded chunk 0/${p.chunks}`);

  // Chunks: `concurrency` lanes take indices in order; completions arrive out of order.
  while (peers.length < 16) peers.push(hex());
  type ChunkEv = { t: number; kind: "request" | "retry" | "received"; index: number; peerId: string };
  const evs: ChunkEv[] = [];
  const lanes: number[] = new Array(Math.max(1, p.concurrency)).fill(t);
  const perChunk = Math.round(p.size / p.chunks);
  for (let index = 0; index < p.chunks; index++) {
    const lane = lanes.indexOf(Math.min(...lanes));
    const peerId = peers[Math.floor(rand() * peers.length)];
    evs.push({ t: lanes[lane], kind: "request", index, peerId });
    let end = lanes[lane] + p.latencyMs * Math.exp(p.jitter * gauss() - (p.jitter * p.jitter) / 2);
    if (rand() < p.retryRate) {
      evs.push({ t: end, kind: "retry", index, peerId });
      end += p.latencyMs * (0.5 + rand());
    }
    evs.push({ t: end, kind: "received", index, peerId });
    lanes[lane] = end;
  }
  evs.sort((a, b) => a.t - b.t);

  // Stalls: shift everything after the stall point.
  const completions = evs.filter((e) => e.kind === "received");
  for (const stall of [...p.stalls].sort((a, b) => b.at - a.at)) {
    const pivot = completions[Math.min(completions.length - 1, Math.floor(stall.at * completions.length))].t;
    for (const e of evs) if (e.t > pivot) e.t += stall.ms;
  }

  // Emit in time order, with the real count messages and in-order writes.
  const cutAt = p.outcome === "fail-mid" ? Math.floor(p.chunks * 0.5) : p.outcome === "cancel" ? Math.floor(p.chunks * 0.4) : Infinity;
  const got: boolean[] = new Array(p.chunks).fill(false);
  let done = 0;
  let written = 0;
  for (const e of evs) {
    const { index, peerId } = e;
    if (e.kind === "request") {
      detail(e.t, { type: "chunk.request", index, peerId, tier: "C" });
      detail(e.t, { type: "node.state", peerId, state: "sending", tier: "C" });
      continue;
    }
    if (e.kind === "retry") {
      detail(e.t, { type: "chunk.retry", index, attempt: 2, tier: "C" });
      continue;
    }
    detail(e.t, { type: "chunk.received", index, bytes: perChunk, peerId, tier: "C" });
    got[index] = true;
    sdk(e.t, op, operation, "downloading", `Downloaded chunk ${++done}/${p.chunks}`);
    while (written < p.chunks && got[written]) detail(e.t, { type: "chunk.written", index: written++, tier: "C" });
    t = e.t;
    if (done >= cutAt) break;
  }

  if (p.outcome === "fail-mid") {
    const error = { name: "AutonomiError", code: "DOWNLOAD_FAILED", message: "Could not fetch a chunk from the network" };
    sdk(t + 8000, op, operation, "downloading", `Downloaded chunk ${done}/${p.chunks}`, { status: "failed", error });
    return finish(p, records, note);
  }
  if (p.outcome === "cancel") {
    sdk(t + 2500, op, operation, "downloading", `Downloaded chunk ${done}/${p.chunks}`, {
      status: "cancelled", error: { name: "AbortError", message: "The operation was aborted." },
    });
    return finish(p, records, note);
  }

  t += 8 + p.size / 400_000_000; // whole-file hash
  sdk(t, op, operation, "downloading", `Verified complete ${name} as ${hex()}`);
  if (p.save) {
    sdk(t + 1, op + 1, "save", "saving", "Choosing a download destination", { parentOperationId: `${opPrefix}-${op}` });
    sdk(t + 1800, op + 1, "save", "saving", `Saving ${name}`, { parentOperationId: `${opPrefix}-${op}` });
    t += 1800 + p.size / 300_000_000;
    sdk(t, op + 1, "save", "complete", `Saved ${name}`, { parentOperationId: `${opPrefix}-${op}` });
    sdk(t, op + 1, "save", "complete", `Saved ${name}`, { parentOperationId: `${opPrefix}-${op}`, status: "succeeded" });
  } else {
    sdk(t + 2, op, operation, "complete", `Downloaded ${name}`, { completed: p.size, total: p.size, unit: "bytes" });
  }
  const lastMsg = p.save ? `Saved ${name}` : `Downloaded ${name}`;
  sdk(t + 3, op, operation, "complete", lastMsg, { status: "succeeded", ...(p.save ? {} : { completed: p.size, total: p.size, unit: "bytes" }) });
  return finish(p, records, note);
}

function finish(p: SyntheticParams, records: TraceRecord[], note?: string): Trace {
  records.sort((a, b) => a.t - b.t);
  return {
    header: {
      kind: "header", format: 1, address: p.address, sdk: SDK_VERSION, source: "synthetic",
      size: p.size, ...(p.name ? { name: p.name } : {}), ...(note ? { note } : {}),
    },
    records,
  };
}
