// Perf HUD: FPS, frame time, skin time per frame, JS heap, skin counters. It also decides when to
// drop the skin to 30 FPS, and exposes window.__perf for scripts/capture.ts.

const N = 600;

export interface PerfSnapshot {
  frames: number;
  fpsMedian: number;
  fpsP5: number;
  skinMsMean: number;
  skinMsP95: number;
  halfRate: boolean;
}

declare global {
  interface Window { __perf?: { snapshot(): PerfSnapshot; reset(): void } }
}

export class Hud {
  private intervals = new Float32Array(N);
  private costs = new Float32Array(N);
  private n = 0;
  private i = 0;
  private lastText = 0;
  private emaInterval = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  halfRate = false;

  constructor(private el: HTMLElement) {
    window.__perf = { snapshot: () => this.snapshot(), reset: () => this.reset() };
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
  }

  /** Record one rAF tick. `cost` is the skin's frame() time in ms (0 on a skipped frame). */
  tick(interval: number, cost: number, skinStats: Record<string, number> | undefined, now: number): void {
    // Ignore huge gaps (hidden tab, breakpoint) for both stats and adaptation.
    if (interval > 250) return;
    this.intervals[this.i] = interval;
    this.costs[this.i] = cost;
    this.i = (this.i + 1) % N;
    this.n = Math.min(N, this.n + 1);

    // Drop to 30 FPS when frames take over 20 ms for about a second; retry after 5 s of headroom.
    this.emaInterval += (interval - this.emaInterval) * 0.05;
    if (!this.halfRate) {
      this.slowFor = this.emaInterval > 20 ? this.slowFor + interval : 0;
      if (this.slowFor > 1000) { this.halfRate = true; this.fastFor = 0; }
    } else {
      this.fastFor = this.emaInterval < 17.5 ? this.fastFor + interval : 0;
      if (this.fastFor > 5000) { this.halfRate = false; this.slowFor = 0; }
    }

    if (this.el.hidden || now - this.lastText < 500) return;
    this.lastText = now;
    const s = this.snapshot();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `fps ${s.fpsMedian.toFixed(0).padStart(3)}  p5 ${s.fpsP5.toFixed(0).padStart(3)}${this.halfRate ? "  (30fps mode)" : ""}`,
      `skin ${s.skinMsMean.toFixed(2)} ms  p95 ${s.skinMsP95.toFixed(2)}`,
    ];
    if (mem) lines.push(`heap ${(mem.usedJSHeapSize / 1e6).toFixed(1)} MB`);
    if (skinStats) for (const [k, v] of Object.entries(skinStats)) lines.push(`${k} ${v}`);
    this.el.textContent = lines.join("\n");
  }

  snapshot(): PerfSnapshot {
    const n = this.n;
    if (!n) return { frames: 0, fpsMedian: 0, fpsP5: 0, skinMsMean: 0, skinMsP95: 0, halfRate: this.halfRate };
    const iv = Array.from(this.intervals.subarray(0, n)).sort((a, b) => a - b);
    const cs = Array.from(this.costs.subarray(0, n)).sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    return {
      frames: n,
      fpsMedian: 1000 / q(iv, 0.5),
      fpsP5: 1000 / q(iv, 0.95), // the slowest 5 % of frames
      skinMsMean: cs.reduce((a, b) => a + b, 0) / n,
      skinMsP95: q(cs, 0.95),
      halfRate: this.halfRate,
    };
  }
}
