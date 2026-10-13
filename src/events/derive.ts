// Derived events (rate, stall) and the pipeline that turns raw trace records into a timeline.
// Derived events are produced on a fixed 250 ms grid of trace time, so a live run and a replay
// of its recording produce identical timelines.

import { Enricher } from "./enrich";
import { Parser } from "./parse";
import type { Trace, TraceHeader, TraceRecord, VizEvent, VizEventBody } from "./types";

export const TICK_MS = 250;
export const RATE_WINDOW_MS = 2000;
export const STALL_MS = 3000;

export class Deriver {
  private nextTick = TICK_MS;
  private downloading = false;
  private downloadStart = 0;
  private lastProgress = 0;
  private stalled = false;
  private chunkTimes: number[] = [];
  private size?: number;
  private total?: number;

  observe(e: VizEvent): void {
    switch (e.type) {
      case "file.meta":
        this.size = e.size;
        if (e.chunks) this.total = e.chunks;
        break;
      case "chunk.done":
        this.begin(e.t);
        this.total = e.total;
        if (e.completed === 0) break; // the 0/N announcement: total known, nothing fetched yet
        this.chunkTimes.push(e.t);
        this.lastProgress = e.t;
        this.stalled = false;
        if (e.completed >= e.total) this.downloading = false;
        break;
      case "file.verified":
      case "session.done":
      case "session.failed":
      case "session.cancelled":
        this.downloading = false;
        break;
    }
  }

  /** Chunk fetching starts at the core's "Downloaded chunk 0/N", which follows any nested DataMap. */
  private begin(t: number): void {
    if (this.downloading || this.chunkTimes.length > 0) return;
    this.downloading = true;
    this.downloadStart = t;
    this.lastProgress = t;
  }

  /** Derived events for every grid tick up to and including `t`. */
  tickTo(t: number): VizEvent[] {
    const out: VizEvent[] = [];
    while (this.nextTick <= t) {
      const b = this.nextTick;
      this.nextTick += TICK_MS;
      if (!this.downloading) continue;
      const window = Math.min(RATE_WINDOW_MS, Math.max(TICK_MS, b - this.downloadStart));
      let n = 0;
      for (let i = this.chunkTimes.length - 1; i >= 0 && this.chunkTimes[i] > b - window; i--) n++;
      const chunksPerSec = (n * 1000) / window;
      const bytesPerSec =
        this.size !== undefined && this.total ? (chunksPerSec * this.size) / this.total : undefined;
      out.push({ t: b, type: "rate", chunksPerSec, ...(bytesPerSec === undefined ? {} : { bytesPerSec }) });
      if (!this.stalled && b - this.lastProgress >= STALL_MS) {
        this.stalled = true;
        out.push({ t: b, type: "chunk.stall", sinceMs: this.lastProgress });
      }
    }
    return out;
  }
}

/** Parser + deriver (+ optional enricher). Used incrementally by live runs and in bulk by replays. */
export class Pipeline {
  private parser: Parser;
  private deriver = new Deriver();
  private enricher?: Enricher;

  constructor(header: TraceHeader, enrich = false) {
    this.parser = new Parser(header);
    if (enrich) this.enricher = new Enricher(header.address);
  }

  start(): VizEvent[] {
    return this.emit(0, this.parser.start());
  }

  push(rec: TraceRecord): VizEvent[] {
    return this.emit(rec.t, this.parser.push(rec));
  }

  advanceTo(t: number): VizEvent[] {
    return this.deriver.tickTo(t);
  }

  private emit(t: number, bodies: VizEventBody[]): VizEvent[] {
    const out: VizEvent[] = [];
    for (const body of bodies) {
      const e = { ...body, t } as VizEvent;
      this.deriver.observe(e);
      out.push(e);
      if (this.enricher) for (const d of this.enricher.observe(e)) out.push(d);
    }
    return out;
  }
}

/** A whole trace → its timeline, sorted by t. */
export function buildTimeline(trace: Trace, enrich = false): VizEvent[] {
  const p = new Pipeline(trace.header, enrich);
  const out = p.start();
  for (const rec of trace.records) {
    out.push(...p.advanceTo(rec.t));
    out.push(...p.push(rec));
  }
  return out;
}
