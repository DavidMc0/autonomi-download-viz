// A plain summary of the session so far, folded from VizEvents. Shared by the harness's progress
// text, the Baseline skin and any skin's describe().

import type { VizEvent } from "./types";

export type Phase = "idle" | "connecting" | "finding" | "downloading" | "verifying" | "saving" | "done" | "failed" | "cancelled";

export interface SessionState {
  phase: Phase;
  address: string;
  name?: string;
  size?: number;
  seeds: number;
  peers: number;
  rounds: number;
  failures: number;
  invalid: number;
  reseeds: number;
  nested: boolean;
  datamapBytes?: number;
  completed: number;
  total?: number;
  chunksPerSec: number;
  bytesPerSec?: number;
  stalled: boolean;
  stallCount: number;
  hash?: string;
  error?: { code?: string; message: string };
  t: number;
}

export function initialState(): SessionState {
  return {
    phase: "idle", address: "", seeds: 0, peers: 0, rounds: 0, failures: 0, invalid: 0, reseeds: 0,
    nested: false, completed: 0, chunksPerSec: 0, stalled: false, stallCount: 0, t: 0,
  };
}

/** Mutates and returns `s` (no allocation per event). */
export function reduce(s: SessionState, e: VizEvent): SessionState {
  s.t = e.t;
  switch (e.type) {
    case "session.start":
      Object.assign(s, initialState(), { address: e.address, name: e.name, size: e.size, phase: "connecting", t: e.t });
      break;
    case "connect.start": s.seeds = e.seeds; s.phase = "connecting"; break;
    case "connect.peer": s.peers++; break;
    case "connect.done": if (s.phase === "connecting") s.phase = "finding"; break;
    case "lookup.round": s.rounds++; if (s.phase === "connecting") s.phase = "finding"; break;
    case "lookup.fail": s.failures++; break;
    case "lookup.invalid": s.invalid++; break;
    case "lookup.reseed": s.reseeds++; break;
    case "datamap.fetch": if (s.phase === "connecting") s.phase = "finding"; break;
    case "datamap.nested": s.nested = true; break;
    // A nested DataMap is resolved after this, so chunk fetching starts later, at "chunk 0/N".
    case "datamap.verified": s.datamapBytes = e.bytes; if (s.phase === "connecting") s.phase = "finding"; break;
    case "file.meta":
      s.size = e.size;
      s.name ??= e.name;
      if (e.chunks) s.total = e.chunks;
      break;
    case "chunk.done":
      s.completed = e.completed;
      s.total = e.total;
      s.stalled = false;
      s.phase = e.completed >= e.total ? "verifying" : "downloading";
      break;
    case "chunk.stall": s.stalled = true; s.stallCount++; break;
    case "rate": s.chunksPerSec = e.chunksPerSec; s.bytesPerSec = e.bytesPerSec; break;
    // The core names public files generically (public-file-<address>.bin); keep a name from the header.
    case "file.verified": s.hash = e.hash; s.name ??= e.name; s.phase = "verifying"; break;
    case "save.picking": case "save.writing": s.phase = "saving"; break;
    case "save.done": break;
    case "session.done": s.phase = "done"; s.stalled = false; break;
    case "session.failed": s.phase = "failed"; s.error = { code: e.code, message: e.message }; break;
    case "session.cancelled": s.phase = "cancelled"; break;
  }
  return s;
}

/** Decimal (SI) units, as on the download page. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function percent(s: SessionState): number | undefined {
  return s.total ? Math.floor((100 * s.completed) / s.total) : undefined;
}

/** The plain progress line shown under every skin, as the download page would show it. */
export function progressText(s: SessionState): string {
  switch (s.phase) {
    case "idle": return "Ready.";
    case "connecting": return s.seeds ? `Connecting to the network (${s.seeds} seed nodes)…` : "Connecting to the network…";
    case "finding":
      if (s.datamapBytes !== undefined) return s.nested ? "Reading the file's map (nested)…" : "Reading the file's map…";
      return s.rounds ? `Finding the file · ${s.rounds} lookup round${s.rounds === 1 ? "" : "s"}` : "Finding the file…";
    case "downloading": {
      if (!s.total) return "Downloading…";
      const rate = s.stalled ? " · waiting for the network" : s.bytesPerSec !== undefined ? ` · ${formatBytes(s.bytesPerSec)}/s` : ` · ${s.chunksPerSec.toFixed(1)} chunks/s`;
      return `Fetched ${s.completed} of ${s.total} chunks${rate}`;
    }
    case "verifying": return "Verifying the whole file…";
    case "saving": return "Saving…";
    case "done": return `Done${s.size !== undefined ? ` · ${formatBytes(s.size)}` : ""} · verified`;
    case "failed": return `Download failed: ${s.error?.message ?? "unknown error"}`;
    case "cancelled": return "Download cancelled.";
  }
}

/** A short sentence for screen readers. */
export function describeState(s: SessionState): string {
  switch (s.phase) {
    case "connecting": return s.peers ? `Connected to ${s.peers} node${s.peers === 1 ? "" : "s"}.` : "Connecting to the network.";
    case "finding": return `Connected. Finding the file, ${s.rounds} lookup rounds so far.`;
    case "downloading": return s.total ? `${percent(s)} percent downloaded.${s.stalled ? " Waiting for the network." : ""}` : "Downloading.";
    default: return progressText(s);
  }
}
