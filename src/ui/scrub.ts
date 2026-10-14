// The scrub bar: a time axis with coloured event markers. Click or drag to seek.

import type { VizEvent } from "../events/types";

const COLOURS: Partial<Record<VizEvent["type"], string>> = {
  "connect.start": "#4a7dff", "connect.peer": "#4a7dff", "connect.done": "#4a7dff", "connect.failed": "#d64545",
  "lookup.round": "#9b6bff", "lookup.fail": "#d68a45", "lookup.invalid": "#d68a45", "lookup.reseed": "#d68a45",
  "datamap.fetch": "#1ea7a0", "datamap.nested": "#1ea7a0", "datamap.verified": "#1ea7a0",
  "chunk.stall": "#e0a100", "file.verified": "#2e9e5b", "session.done": "#2e9e5b",
  "session.failed": "#d64545", "session.cancelled": "#888888", "save.done": "#2e9e5b",
};

export class ScrubBar {
  private g: CanvasRenderingContext2D;
  private markers = document.createElement("canvas");
  private markerKey = "";
  private dragging = false;

  constructor(private canvas: HTMLCanvasElement, private onSeek: (fraction: number) => void) {
    this.g = canvas.getContext("2d")!;
    const seek = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.onSeek(Math.max(0, Math.min(1, (ev.clientX - r.left - 4) / (r.width - 8))));
    };
    canvas.addEventListener("pointerdown", (ev) => {
      this.dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      seek(ev);
    });
    canvas.addEventListener("pointermove", (ev) => this.dragging && seek(ev));
    canvas.addEventListener("pointerup", () => (this.dragging = false));
  }

  /** Redraw the cached marker layer only when the events or size change. */
  private drawMarkers(events: VizEvent[], duration: number, w: number, h: number, dpr: number): void {
    const key = `${events.length}:${duration}:${w}:${h}:${dpr}`;
    if (key === this.markerKey) return;
    this.markerKey = key;
    const m = this.markers;
    m.width = w * dpr;
    m.height = h * dpr;
    const g = m.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!duration) return;
    const x = (t: number) => 4 + (t / duration) * (w - 8);
    // Chunks: a light density strip along the bottom.
    g.fillStyle = "#8888";
    for (const e of events) if (e.type === "chunk.done" && e.completed > 0) g.fillRect(x(e.t), h - 9, 1, 6);
    for (const e of events) {
      const c = COLOURS[e.type];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(Math.round(x(e.t)) - 1, 4, 2, h - 15);
    }
  }

  draw(events: VizEvent[], clock: number, duration: number): void {
    const { canvas, g } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // hidden (capture mode)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.drawMarkers(events, duration, w, h, dpr);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(this.markers, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = duration ? 4 + (clock / duration) * (w - 8) : 4;
    g.fillStyle = "#3e6ff233";
    g.fillRect(0, 0, px, h);
    g.fillStyle = "#3e6ff2";
    g.fillRect(px - 1, 0, 2, h);
  }
}
