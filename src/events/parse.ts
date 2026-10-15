// SDK ProgressEvent → VizEvent. Every message regex lives in this file: the strings are not a
// stable API, so an SDK update that changes one should only need a change here.
// Verified against @withautonomi/ant-browser-sdk 0.1.2 (ant-client 9858af5).

import type { RawSdkEvent, TraceHeader, TraceRecord, VizEventBody } from "./types";

type Rule = [RegExp, (m: RegExpExecArray, ev: RawSdkEvent) => VizEventBody | null];

const HEX = "[0-9a-fA-F]{16,}";

/** Messages that are expected but carry nothing a skin needs. */
const QUIET = [
  /^Initializing the Autonomi browser core$/,
  /^Opened /,
  /^Opening an Autonomi /,
  /^(download|download-and-save|connect|save|open-file|lookup|media) started$/,
];

/**
 * The per-instance parser. It is stateful only to keep chunk counts monotonic and to make sure
 * exactly one terminal session event is produced.
 */
export class Parser {
  /** -1 until the first count: the core reports "Downloaded chunk 0/N" as soon as the DataMap is verified. */
  private lastCompleted = -1;
  private metaSent = false;
  private ended = false;

  constructor(private readonly header: TraceHeader) {}

  start(): VizEventBody[] {
    const { address, name, size } = this.header;
    const out: VizEventBody[] = [{ type: "session.start", address, name, size }];
    if (size !== undefined) {
      this.metaSent = true;
      out.push({ type: "file.meta", size, name });
    }
    return out;
  }

  push(rec: TraceRecord): VizEventBody[] {
    if (this.ended) return rec.kind === "sdk" && rec.ev.status === "running" ? [{ type: "log", message: rec.ev.message }] : [];
    switch (rec.kind) {
      case "detail":
        return [rec.ev];
      case "note":
        return [{ type: "log", message: rec.message }];
      case "sdk":
        return rec.ev.status === "running" ? this.running(rec.ev) : this.terminal(rec.ev);
    }
  }

  private rules: Rule[] = [
    [/^Authenticating (\d+) bootstrap nodes?$/, (m) => ({ type: "connect.start", seeds: +m[1] })],
    [/^Connected to authenticated peer (\S+)$/, (m) => ({ type: "connect.peer", peerId: m[1] })],
    [new RegExp(`^Finding nodes closest to (${HEX})$`), (m) => ({ type: "lookup.start", target: m[1] })],
    [/^Closest-node lookup complete$/, () => ({ type: "lookup.done" })],
    [
      /^Iteration (\d+): (\S+) returned (\d+) nodes?\.?$/,
      (m) => ({ type: "lookup.round", iteration: +m[1], peerId: m[2], returned: +m[3] }),
    ],
    [/^Query (\S+) failed: ([\s\S]*)$/, (m) => ({ type: "lookup.fail", peerId: m[1], reason: m[2] })],
    [/^Ignoring invalid candidate from (\S+?):/, (m) => ({ type: "lookup.invalid", peerId: m[1] })],
    [/^Retrying lookup through configured seeds/, () => ({ type: "lookup.reseed" })],
    [new RegExp(`^Fetching public DataMap (${HEX})$`), (m) => ({ type: "datamap.fetch", address: m[1] })],
    [new RegExp(`^Fetching (${HEX})$`), (m) => ({ type: "datamap.fetch", address: m[1] })],
    [new RegExp(`^Resolving nested DataMap record (${HEX})`), (m) => ({ type: "datamap.nested", address: m[1] })],
    [/^Verified public DataMap \((\d+) bytes?\)$/, (m) => ({ type: "datamap.verified", bytes: +m[1] })],
    [
      /^Ready to stream (.*) \((\d+) bytes?, (\d+) chunks?\)$/,
      (m) => this.meta({ type: "file.meta", name: m[1], size: +m[2], chunks: +m[3] }, true),
    ],
    [/^Downloaded chunk (\d+)\/(\d+)$/, (m) => this.chunk(+m[1], +m[2])],
    [/^Verified complete (.*) as (\S+)$/, (m) => ({ type: "file.verified", name: m[1], hash: m[2] })],
    [/^Choosing a download destination$/, () => ({ type: "save.picking" })],
    [/^Saving /, () => ({ type: "save.writing" })],
    [/^Saved /, () => ({ type: "save.done" })],
    // The SDK's own end-of-download report carries the exact byte size.
    [
      /^Downloaded (.+)$/,
      (m, ev) =>
        ev.unit === "bytes" && ev.total !== undefined
          ? this.meta({ type: "file.meta", name: m[1], size: ev.total }, false)
          : null,
    ],
  ];

  private running(ev: RawSdkEvent): VizEventBody[] {
    const message = ev.message ?? "";
    for (const [re, make] of this.rules) {
      const m = re.exec(message);
      if (m) {
        const out = make(m, ev);
        return out ? [out] : [];
      }
    }
    if (QUIET.some((re) => re.test(message))) return [];
    return [{ type: "log", message }];
  }

  private terminal(ev: RawSdkEvent): VizEventBody[] {
    const failure = { code: ev.error?.code, message: ev.error?.message ?? ev.message };
    if (ev.operation === "connect") {
      if (ev.status === "succeeded") return [{ type: "connect.done" }];
      if (ev.status === "failed") return this.end([{ type: "connect.failed", ...failure }, { type: "session.failed", ...failure }]);
      return this.end([{ type: "session.cancelled" }]);
    }
    // Child operations (e.g. the save inside download-and-save) don't end the session, and nor does
    // a findClosest lookup run ahead of the download (the "lookup" live mode).
    if (ev.parentOperationId !== undefined || ev.operation === "lookup") {
      return ev.status === "failed" ? [{ type: "log", message: `${ev.operation} failed: ${failure.message}` }] : [];
    }
    if (ev.status === "succeeded") return this.end([{ type: "session.done" }]);
    if (ev.status === "cancelled" || ev.error?.name === "AbortError") return this.end([{ type: "session.cancelled" }]);
    return this.end([{ type: "session.failed", ...failure }]);
  }

  private end(events: VizEventBody[]): VizEventBody[] {
    this.ended = true;
    return events;
  }

  private chunk(completed: number, total: number): VizEventBody | null {
    if (completed <= this.lastCompleted) return null;
    this.lastCompleted = completed;
    return { type: "chunk.done", completed, total };
  }

  /** Emit file.meta once, unless a later message knows more (the chunk count). */
  private meta(e: VizEventBody & { type: "file.meta" }, authoritative: boolean): VizEventBody | null {
    if (this.metaSent && !authoritative) return null;
    this.metaSent = true;
    return e;
  }
}
