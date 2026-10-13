// Baseline: deliberately plain. Phase label, progress bar, chunk counter and a scrolling event
// list. It proves the pipeline end to end and is the comparison point for every other skin.

import { describeState, formatBytes, initialState, percent, reduce, type SessionState } from "../../events/state";
import type { VizEvent } from "../../events/types";
import { defaultParams, type Skin, type SkinContext, type TweakDef } from "../types";

const PHASE_LABEL: Record<SessionState["phase"], string> = {
  idle: "Ready", connecting: "Connecting", finding: "Finding the file", downloading: "Downloading",
  verifying: "Verifying", saving: "Saving", done: "Done", failed: "Failed", cancelled: "Cancelled",
};

const tweakables: TweakDef[] = [
  { key: "eventList", label: "event list", kind: "boolean", default: true },
  { key: "lines", label: "list lines (full)", kind: "number", min: 3, max: 30, step: 1, default: 12 },
  { key: "accent", label: "accent", kind: "select", options: { "seeded by address": "seeded", "fixed blue": "fixed" }, default: "seeded" },
  { key: "smoothing", label: "bar smoothing", kind: "number", min: 0, max: 1, step: 0.05, default: 0.25 },
];

function summarise(e: VizEvent): string | null {
  const s = (n: number) => (n / 1000).toFixed(1).padStart(6) + "s  ";
  switch (e.type) {
    case "rate": return null;
    case "session.start": return `${s(e.t)}start ${e.address.slice(0, 12)}…`;
    case "connect.start": return `${s(e.t)}authenticating ${e.seeds} seeds`;
    case "connect.peer": return `${s(e.t)}connected ${e.peerId.slice(0, 10)}…`;
    case "lookup.round": return `${s(e.t)}round ${e.iteration}: ${e.returned} nodes`;
    case "lookup.fail": return `${s(e.t)}query failed ${e.peerId.slice(0, 8)}…`;
    case "datamap.verified": return `${s(e.t)}DataMap verified (${e.bytes} B)`;
    case "chunk.done": return `${s(e.t)}chunk ${e.completed}/${e.total}`;
    case "chunk.stall": return `${s(e.t)}stalled`;
    case "file.verified": return `${s(e.t)}verified ${e.hash.slice(0, 12)}…`;
    case "session.failed": return `${s(e.t)}FAILED: ${e.message}`;
    case "file.meta": return `${s(e.t)}file ${formatBytes(e.size)}${e.chunks ? `, ${e.chunks} chunks` : ""}`;
    case "log": return `${s(e.t)}· ${e.message.slice(0, 60)}`;
    default:
      if ("tier" in e) return null; // detail is too busy for a list
      return `${s(e.t)}${e.type}`;
  }
}

export default function create(): Skin {
  let ctx!: SkinContext;
  let canvas: HTMLCanvasElement;
  let g: CanvasRenderingContext2D;
  let w = 0, h = 0, dpr = 1;
  let params = defaultParams(tweakables);
  const state = initialState();
  const lines: string[] = [];
  let shown = 0; // smoothed progress 0..1
  let accentHue = 210;

  return {
    id: "baseline",
    title: "Baseline",
    theme: "informative",
    wantsEnriched: false,
    libs: ["Canvas 2D"],
    tweakables,

    mount(c) {
      ctx = c;
      params = { ...params, ...c.params };
      accentHue = Math.round((c.seed[0] / 256) * 360);
      canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block;width:100%;height:100%";
      c.container.appendChild(canvas);
      g = canvas.getContext("2d")!;
    },

    onEvent(e) {
      reduce(state, e);
      const line = summarise(e);
      if (line) {
        lines.push(line);
        if (lines.length > 40) lines.shift();
      }
    },

    frame(dtMs) {
      if (!w) return;
      const dark = ctx.theme === "dark";
      const fg = dark ? "#e8eaf0" : "#16181d";
      const muted = dark ? "#8b90a0" : "#5b6070";
      const track = dark ? "#2a2e38" : "#e3e5ea";
      const hue = params.accent === "fixed" ? 215 : accentHue;
      const accent =
        state.phase === "failed" ? "#d64545" : state.phase === "cancelled" ? muted : state.phase === "done" ? "#2e9e5b" : `hsl(${hue} 70% ${dark ? 62 : 48}%)`;
      const target = state.total ? state.completed / state.total : 0;
      const k = ctx.reducedMotion ? 1 : 1 - Math.pow(1 - Math.min(0.99, Number(params.smoothing) || 0.0001), dtMs / 16.7);
      shown += (target - shown) * (Number(params.smoothing) === 0 ? 1 : k);

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = dark ? "#14161c" : "#ffffff";
      g.fillRect(0, 0, w, h);

      const card = ctx.size === "card";
      const pad = card ? 18 : 32;
      const big = card ? 22 : 34;
      g.fillStyle = fg;
      g.font = `600 ${big}px system-ui, sans-serif`;
      g.textBaseline = "top";
      g.fillText(PHASE_LABEL[state.phase] + (state.stalled ? " (waiting)" : ""), pad, pad);

      const barY = pad + big + (card ? 14 : 22);
      const barH = card ? 14 : 20;
      g.fillStyle = track;
      roundRect(g, pad, barY, w - pad * 2, barH, barH / 2);
      g.fill();
      if (shown > 0.001 || state.phase === "done") {
        g.fillStyle = accent;
        roundRect(g, pad, barY, Math.max(barH, (w - pad * 2) * (state.phase === "done" ? 1 : shown)), barH, barH / 2);
        g.fill();
      }

      g.font = `500 ${card ? 15 : 18}px system-ui, sans-serif`;
      g.fillStyle = muted;
      const pc = percent(state);
      const counter = state.total ? `${state.completed} / ${state.total} chunks${pc !== undefined ? ` · ${pc}%` : ""}` : state.phase === "connecting" ? `${state.seeds || "…"} seed nodes` : "";
      g.fillText(counter, pad, barY + barH + 10);

      if (params.eventList) {
        const listY = barY + barH + (card ? 38 : 50);
        const lh = card ? 15 : 18;
        const max = Math.max(0, Math.min(card ? 4 : Number(params.lines), Math.floor((h - listY - pad / 2) / lh)));
        g.font = `${card ? 12 : 13}px ui-monospace, Consolas, monospace`;
        for (let i = 0; i < max && i < lines.length; i++) {
          const line = lines[lines.length - 1 - i];
          g.globalAlpha = 1 - i / (max + 1);
          g.fillStyle = muted;
          g.fillText(line, pad, listY + i * lh, w - pad * 2);
        }
        g.globalAlpha = 1;
      }
    },

    resize(nw, nh, ndpr) {
      w = nw; h = nh; dpr = ndpr;
      canvas.width = Math.round(nw * ndpr);
      canvas.height = Math.round(nh * ndpr);
    },

    setParams(p) {
      params = { ...params, ...p };
    },

    describe() {
      return describeState(state);
    },

    destroy() {
      canvas?.remove();
    },

    stats() {
      return { lines: lines.length };
    },
  };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
