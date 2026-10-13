import { describe, expect, it } from "vitest";
import { buildTimeline, Deriver } from "../src/events/derive";
import { Enricher } from "../src/events/enrich";
import { permutation, prng, seedFromAddress } from "../src/events/seed";
import { initialState, progressText, reduce } from "../src/events/state";
import type { VizEvent } from "../src/events/types";
import { generateTrace, DEFAULT_SYNTHETIC, presetTrace, SYNTHETIC_PRESETS } from "../src/sources/synthetic";

const ADDR = "711c7e20006ff3e0ac6c1f3063286a0c1a3e4c409642e8c526173fa60bb7078a";

describe("seed", () => {
  it("decodes a hex address into 32 bytes", () => {
    const s = seedFromAddress(ADDR);
    expect(s).toHaveLength(32);
    expect(s[0]).toBe(0x71);
    expect(s[31]).toBe(0x8a);
  });
  it("is deterministic and differs between addresses", () => {
    const a = prng(seedFromAddress(ADDR));
    const b = prng(seedFromAddress(ADDR));
    const c = prng(seedFromAddress(ADDR.replace(/^7/, "8")));
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("permutes", () => {
    const p = permutation(50, prng(seedFromAddress(ADDR)));
    expect([...p].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe("derive", () => {
  it("emits rate on a 250 ms grid and one stall per gap", () => {
    const d = new Deriver();
    const out: VizEvent[] = [];
    const push = (e: VizEvent) => { out.push(...d.tickTo(e.t)); d.observe(e); out.push(e); };
    push({ t: 0, type: "file.meta", size: 4_000_000 });
    push({ t: 1000, type: "chunk.done", completed: 0, total: 4 });
    push({ t: 1500, type: "chunk.done", completed: 1, total: 4 });
    push({ t: 2000, type: "chunk.done", completed: 2, total: 4 });
    out.push(...d.tickTo(9000));
    push({ t: 9100, type: "chunk.done", completed: 3, total: 4 });
    const rates = out.filter((e) => e.type === "rate");
    expect(rates[0].t).toBe(1250); // first grid tick after 0/N
    expect(rates.every((e) => e.t % 250 === 0)).toBe(true);
    const stalls = out.filter((e) => e.type === "chunk.stall");
    expect(stalls).toEqual([{ t: 7000, type: "chunk.stall", sinceMs: 2000 }]);
    const at2000 = rates.find((e) => e.t === 2000)!;
    expect(at2000.type === "rate" && at2000.bytesPerSec).toBe(1_000_000); // 1 chunk in the 1 s since 0/N, × 1 MB per chunk
  });

  it("stops deriving after the last chunk", () => {
    const tl = buildTimeline(presetTrace("synthetic-small"));
    const lastChunk = tl.filter((e) => e.type === "chunk.done").pop()!;
    expect(tl.filter((e) => e.type === "rate" && e.t > lastChunk.t)).toEqual([]);
  });
});

describe("enricher", () => {
  it("adds exactly one received per real completion, deterministically", () => {
    const run = () => {
      const en = new Enricher(ADDR);
      const out: VizEvent[] = [];
      en.observe({ t: 0, type: "file.meta", size: 1_000_000 });
      for (let k = 0; k <= 20; k++) out.push(...en.observe({ t: k * 100, type: "chunk.done", completed: k, total: 20 }));
      return out;
    };
    const a = run();
    expect(a.filter((e) => e.type === "chunk.received")).toHaveLength(20);
    expect(a.filter((e) => e.type === "chunk.written").map((e) => (e as { index: number }).index)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(a.every((e) => "tier" in e && e.tier === "C")).toBe(true);
    expect(run()).toEqual(a);
  });

  it("stays passive when the source supplies detail", () => {
    const tl = buildTimeline(presetTrace("flaky"), true);
    const plain = buildTimeline(presetTrace("flaky"), false);
    expect(tl).toEqual(plain);
  });
});

describe("synthetic presets", () => {
  const expected: Record<string, string> = {
    "synthetic-small": "session.done", "synthetic-large": "session.done", flaky: "session.done", nested: "session.done",
    "fail-connect": "session.failed", "fail-mid": "session.failed", cancel: "session.cancelled", huge: "session.done",
  };
  for (const id of Object.keys(SYNTHETIC_PRESETS)) {
    it(`${id} ends with ${expected[id]}`, () => {
      const tl = buildTimeline(presetTrace(id));
      expect(tl.filter((e) => e.type.startsWith("session.") && e.type !== "session.start").map((e) => e.type)).toEqual([expected[id]]);
      expect(tl.filter((e) => e.type === "log")).toEqual([]);
    });
  }
  it("flaky has failures, a reseed and two stalls", () => {
    const types = buildTimeline(presetTrace("flaky")).map((e) => e.type);
    expect(types.filter((t) => t === "lookup.fail")).toHaveLength(3);
    expect(types).toContain("lookup.reseed");
    expect(types.filter((t) => t === "chunk.stall")).toHaveLength(2);
  });
  it("nested resolves after the DataMap is verified", () => {
    const types = buildTimeline(presetTrace("nested")).map((e) => e.type);
    expect(types.indexOf("datamap.nested")).toBeGreaterThan(types.indexOf("datamap.verified"));
  });
  it("huge has 3,000 chunks", () => {
    const done = buildTimeline(presetTrace("huge")).filter((e) => e.type === "chunk.done");
    expect(done).toHaveLength(3001);
  });
  it("is deterministic", () => {
    expect(generateTrace(DEFAULT_SYNTHETIC)).toEqual(generateTrace(DEFAULT_SYNTHETIC));
  });
  it("fail-mid stops half-way and the progress text says so", () => {
    const s = initialState();
    for (const e of buildTimeline(presetTrace("fail-mid"))) reduce(s, e);
    expect(s.completed).toBe(30);
    expect(progressText(s)).toMatch(/^Download failed/);
  });
});
