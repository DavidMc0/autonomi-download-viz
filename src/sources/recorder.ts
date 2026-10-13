// Raw traces as JSONL: record SDK events verbatim with their time, and read them back.

import type { ProgressEvent } from "@withautonomi/ant-browser-sdk";
import type { RawSdkEvent, Trace, TraceHeader, TraceRecord } from "../events/types";

export function rawFromProgress(ev: ProgressEvent): RawSdkEvent {
  const raw: RawSdkEvent = {
    operationId: ev.operationId,
    operation: ev.operation,
    phase: ev.phase,
    message: ev.message,
    status: ev.status,
  };
  if (ev.parentOperationId !== undefined) raw.parentOperationId = ev.parentOperationId;
  if (ev.completed !== undefined) raw.completed = ev.completed;
  if (ev.total !== undefined) raw.total = ev.total;
  if (ev.unit !== undefined) raw.unit = ev.unit;
  if ("error" in ev && ev.error !== undefined) raw.error = plainError(ev.error);
  return raw;
}

export function plainError(err: unknown): NonNullable<RawSdkEvent["error"]> {
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    return {
      ...(typeof e.name === "string" ? { name: e.name } : {}),
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      message: typeof e.message === "string" ? e.message : String(err),
    };
  }
  return { message: String(err) };
}

export class TraceRecorder {
  readonly records: TraceRecord[] = [];
  private t0 = performance.now();

  constructor(readonly header: TraceHeader) {}

  now(): number {
    return Math.round(performance.now() - this.t0);
  }

  sdk(ev: ProgressEvent): TraceRecord {
    const rec: TraceRecord = { t: this.now(), kind: "sdk", ev: rawFromProgress(ev) };
    this.records.push(rec);
    return rec;
  }

  note(message: string): TraceRecord {
    const rec: TraceRecord = { t: this.now(), kind: "note", message };
    this.records.push(rec);
    return rec;
  }

  trace(): Trace {
    return { header: this.header, records: this.records };
  }
}

export function serializeTrace(trace: Trace): string {
  return [trace.header, ...trace.records].map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export function parseTrace(text: string): Trace {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("Empty trace file");
  const header = JSON.parse(lines[0]) as TraceHeader;
  if (header.kind !== "header" || typeof header.address !== "string") throw new Error("Not a trace file: the first line must be a header");
  const records = lines.slice(1).map((l, i) => {
    const r = JSON.parse(l) as TraceRecord;
    if (typeof r.t !== "number") throw new Error(`Line ${i + 2}: missing t`);
    return r;
  });
  records.sort((a, b) => a.t - b.t);
  return { header, records };
}

export function downloadText(filename: string, text: string, type = "application/jsonl"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
