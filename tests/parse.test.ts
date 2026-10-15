import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/events/derive";
import { Parser } from "../src/events/parse";
import type { RawSdkEvent, TraceHeader, VizEventBody } from "../src/events/types";
import { parseTrace } from "../src/sources/recorder";

const ADDR = "52af8a181c6171f8e12896ca734cdf60839c3b324dfbeadf857226dfc7cb453b";
const PEER = "a1f073e0ffc1a1890e8d072015fa2437a1090997b47c0412c0bfabe7c7e16199";
const header: TraceHeader = { kind: "header", format: 1, address: ADDR, sdk: "0.1.2", source: "live" };

function ev(message: string, extra: Partial<RawSdkEvent> = {}): RawSdkEvent {
  return { operationId: "x-2", operation: "download", phase: "downloading", message, status: "running", ...extra };
}

function parse(message: string, extra: Partial<RawSdkEvent> = {}, parser = new Parser(header)): VizEventBody[] {
  return parser.push({ t: 1, kind: "sdk", ev: ev(message, extra) });
}

describe("every message in brief section 2", () => {
  const cases: [string, VizEventBody | null, Partial<RawSdkEvent>?][] = [
    ["Authenticating 7 bootstrap nodes", { type: "connect.start", seeds: 7 }, { operation: "connect", phase: "connecting" }],
    ["Authenticating 1 bootstrap node", { type: "connect.start", seeds: 1 }, { operation: "connect" }],
    [`Connected to authenticated peer ${PEER}`, { type: "connect.peer", peerId: PEER }, { operation: "connect", phase: "complete" }],
    [`Iteration 3: ${PEER} returned 12 nodes`, { type: "lookup.round", iteration: 3, peerId: PEER, returned: 12 }],
    [`Iteration 1: ${PEER} returned 1 node`, { type: "lookup.round", iteration: 1, peerId: PEER, returned: 1 }],
    [`Finding nodes closest to ${PEER}`, { type: "lookup.start", target: PEER }],
    ["Closest-node lookup complete", { type: "lookup.done" }],
    [`Query ${PEER} failed: lookup query error: timed out`, { type: "lookup.fail", peerId: PEER, reason: "lookup query error: timed out" }],
    [`Ignoring invalid candidate from ${PEER}: Failed to deserialize candidate node`, { type: "lookup.invalid", peerId: PEER }],
    ["Retrying lookup through configured seeds", { type: "lookup.reseed" }],
    [`Fetching public DataMap ${ADDR}`, { type: "datamap.fetch", address: ADDR }],
    [`Fetching ${ADDR}`, { type: "datamap.fetch", address: ADDR }],
    [`Resolving nested DataMap record ${PEER}`, { type: "datamap.nested", address: PEER }],
    ["Verified public DataMap (327 bytes)", { type: "datamap.verified", bytes: 327 }],
    ["Ready to stream lucky (2).jpg (321035 bytes, 3 chunks)", { type: "file.meta", name: "lucky (2).jpg", size: 321035, chunks: 3 }, { operation: "open-file" }],
    ["Downloaded chunk 2/17", { type: "chunk.done", completed: 2, total: 17 }],
    [`Verified complete public-file-52af8a181c6171f8.bin as ${PEER}`, { type: "file.verified", name: "public-file-52af8a181c6171f8.bin", hash: PEER }],
    ["Choosing a download destination", { type: "save.picking" }, { operation: "download-and-save", phase: "saving" }],
    ["Saving lucky.jpg", { type: "save.writing" }, { operation: "save" }],
    ["Saved lucky.jpg", { type: "save.done" }, { operation: "download-and-save", phase: "complete" }],
  ];
  for (const [message, expected, extra] of cases) {
    it(message.slice(0, 50), () => {
      expect(parse(message, extra)).toEqual(expected ? [expected] : []);
    });
  }

  it("reads the size from the SDK's end-of-download report", () => {
    expect(parse("Downloaded public-file-x.bin", { phase: "complete", completed: 574, total: 574, unit: "bytes" })).toEqual([
      { type: "file.meta", name: "public-file-x.bin", size: 574 },
    ]);
  });

  it("passes unknown messages through as log events and never throws", () => {
    expect(parse("Something new in SDK 0.2")).toEqual([{ type: "log", message: "Something new in SDK 0.2" }]);
    expect(parse("")).toEqual([{ type: "log", message: "" }]);
    expect(() => parse(undefined as unknown as string)).not.toThrow();
  });

  it("stays quiet for known housekeeping messages", () => {
    expect(parse("Initializing the Autonomi browser core", { operation: "connect" })).toEqual([]);
    expect(parse("Opened public-file-x.bin", { operation: "open-file" })).toEqual([]);
  });
});

describe("parser state", () => {
  it("announces the total with 0/N and keeps counts monotonic", () => {
    const p = new Parser(header);
    expect(parse("Downloaded chunk 0/3", {}, p)).toEqual([{ type: "chunk.done", completed: 0, total: 3 }]);
    expect(parse("Downloaded chunk 1/3", {}, p)).toHaveLength(1);
    expect(parse("Downloaded chunk 1/3", {}, p)).toEqual([]);
  });

  it("doesn't re-parse the terminal event's repeated message", () => {
    const p = new Parser(header);
    parse("Downloaded chunk 3/3", {}, p);
    const out = p.push({ t: 2, kind: "sdk", ev: ev("Downloaded chunk 3/3", { status: "succeeded" }) });
    expect(out).toEqual([{ type: "session.done" }]);
  });

  it("emits exactly one terminal session event", () => {
    const p = new Parser(header);
    p.push({ t: 1, kind: "sdk", ev: ev("x", { status: "failed", error: { code: "DOWNLOAD_FAILED", message: "nope" } }) });
    expect(p.push({ t: 2, kind: "sdk", ev: ev("x", { status: "succeeded" }) })).toEqual([]);
  });

  it("maps connect failure, child failures and cancellation", () => {
    const p1 = new Parser(header);
    expect(
      p1.push({ t: 1, kind: "sdk", ev: ev("Authenticating 7 bootstrap nodes", { operation: "connect", status: "failed", error: { code: "CONNECTION_FAILED", message: "Could not connect to Autonomi" } }) }),
    ).toEqual([
      { type: "connect.failed", code: "CONNECTION_FAILED", message: "Could not connect to Autonomi" },
      { type: "session.failed", code: "CONNECTION_FAILED", message: "Could not connect to Autonomi" },
    ]);
    const p2 = new Parser(header);
    expect(p2.push({ t: 1, kind: "sdk", ev: ev("Saving x", { operation: "save", parentOperationId: "x-2", status: "failed", error: { message: "disk full" } }) })).toEqual([
      { type: "log", message: "save failed: disk full" },
    ]);
    expect(p2.push({ t: 2, kind: "sdk", ev: ev("x", { status: "failed", error: { name: "AbortError", message: "aborted" } }) })).toEqual([{ type: "session.cancelled" }]);
  });

  it("starts with session.start, and file.meta when the header knows the size", () => {
    expect(new Parser({ ...header, size: 10, name: "a.txt" }).start()).toEqual([
      { type: "session.start", address: ADDR, name: "a.txt", size: 10 },
      { type: "file.meta", size: 10, name: "a.txt" },
    ]);
  });
});

describe("recorded real traces", () => {
  const files = readdirSync("traces").filter((f) => f.endsWith(".jsonl"));
  it("has some", () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    it(`${file} parses into a complete, ordered story`, () => {
      const trace = parseTrace(readFileSync(`traces/${file}`, "utf8"));
      const tl = buildTimeline(trace);
      const types = tl.map((e) => e.type);
      expect(types[0]).toBe("session.start");
      for (let i = 1; i < tl.length; i++) expect(tl[i].t).toBeGreaterThanOrEqual(tl[i - 1].t);
      const terminal = types.filter((t) => t.startsWith("session.") && t !== "session.start");
      expect(terminal).toHaveLength(1);
      expect(types.filter((t) => t === "log")).toEqual([]); // every message in our traces is understood
      if (terminal[0] === "session.done" && !file.includes("stream")) {
        const chunks = tl.filter((e) => e.type === "chunk.done");
        const last = chunks[chunks.length - 1];
        expect(last.type === "chunk.done" && last.completed === last.total).toBe(true);
        expect(types).toContain("file.verified");
      }
    });
  }
});
