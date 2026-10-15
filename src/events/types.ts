// Normalised visualisation events (brief section 4.1) and the raw trace format.

type Tier = "B" | "C";

export type VizEventBody =
  | { type: "session.start"; address: string; name?: string; size?: number }
  | { type: "connect.start"; seeds: number }
  | { type: "connect.peer"; peerId: string }
  | { type: "connect.done" }
  | { type: "connect.failed"; code?: string; message: string }
  /** A closest-node lookup began (reported by findClosest; a download's own lookup is silent in 0.1.2). */
  | { type: "lookup.start"; target: string }
  | { type: "lookup.round"; iteration: number; peerId: string; returned: number }
  | { type: "lookup.fail"; peerId: string; reason: string }
  | { type: "lookup.invalid"; peerId: string }
  | { type: "lookup.reseed" }
  | { type: "lookup.done" }
  | { type: "datamap.fetch"; address: string }
  | { type: "datamap.nested"; address: string }
  | { type: "datamap.verified"; bytes: number }
  | { type: "file.meta"; size: number; chunks?: number; name?: string }
  | { type: "chunk.done"; completed: number; total: number }
  | { type: "chunk.stall"; sinceMs: number } // derived
  | { type: "rate"; chunksPerSec: number; bytesPerSec?: number } // derived, 4 Hz
  | { type: "file.verified"; hash: string; name?: string }
  | { type: "save.picking" }
  | { type: "save.writing" }
  | { type: "save.done" }
  | { type: "session.done" }
  | { type: "session.failed"; code?: string; message: string }
  | { type: "session.cancelled" }
  /** A message the parser doesn't recognise. Passed through, never thrown. */
  | { type: "log"; message: string }
  // Tier B / C detail. Skins may use these when present but must not depend on them.
  | { type: "chunk.request"; index: number; peerId?: string; tier: Tier }
  | { type: "chunk.received"; index: number; bytes: number; peerId?: string; tier: Tier }
  | { type: "chunk.retry"; index: number; attempt: number; tier: Tier }
  | { type: "chunk.written"; index: number; tier: Tier }
  | {
      type: "node.state";
      peerId: string;
      state: "seen" | "connecting" | "connected" | "sending" | "failed";
      tier: Tier;
    };

/** Every event carries `t`: ms since the session started. */
export type VizEvent = VizEventBody & { t: number };
export type VizEventType = VizEvent["type"];
export type EventOf<K extends VizEventType> = Extract<VizEvent, { type: K }>;

export const TERMINAL_TYPES: ReadonlySet<VizEventType> = new Set(["session.done", "session.failed", "session.cancelled"]);

// ---------------------------------------------------------------------------
// Raw traces: JSONL, one record per line. The first line is the header.
// Raw SDK events are kept verbatim so recordings can be re-parsed after parser fixes.

export interface TraceHeader {
  kind: "header";
  format: 1;
  address: string;
  name?: string;
  size?: number;
  sdk: string;
  source: "live" | "synthetic";
  recordedAt?: string;
  userAgent?: string;
  note?: string;
}

/** A ProgressEvent as recorded: the `error` object is reduced to plain fields. */
export interface RawSdkEvent {
  operationId: string;
  parentOperationId?: string;
  operation: string;
  phase: string;
  message: string;
  completed?: number;
  total?: number;
  unit?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  error?: { name?: string; code?: string; message: string };
}

export type TraceRecord =
  | { t: number; kind: "sdk"; ev: RawSdkEvent }
  /** Tier B/C detail that a source knows directly (the synthetic source). */
  | { t: number; kind: "detail"; ev: VizEventBody }
  /** Something the page itself did, outside onProgress (e.g. an error thrown before any event). */
  | { t: number; kind: "note"; message: string };

export interface Trace {
  header: TraceHeader;
  records: TraceRecord[];
}
