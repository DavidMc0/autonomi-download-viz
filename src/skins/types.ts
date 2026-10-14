// The skin contract (brief section 5.2). One harness, many skins.
//
// Shared rules agreed at the Step 0 review (see DECISIONS.md):
// - Between connect.done and datamap.verified, SDK 0.1.2 sends nothing (no lookup rounds). Animate a
//   calm "searching" idle driven by elapsed time. Playful skins may add illustrative hops, with
//   `illustrativeNote` set. Still react to real lookup.* events if they ever arrive.
// - The "blueprint" moment (the file's shape appears) is chunk.done with completed === 0: the first
//   time the total is known. datamap.verified gets a smaller "map verified" beat of its own.
// - Show bytes/s only when the size is known (file.meta / session.start); otherwise chunks/s.
// - Whole-file verification takes about 10 s on a 650 MB file and sends no events between the last
//   chunk.done (completed === total) and file.verified. Show a clear, ongoing "checking" moment
//   there, so the finish never looks frozen.
// - chunk.stall fires after 5 s without progress (STALL_MS); shorter pauses show only as a falling rate.

import type { VizEvent } from "../events/types";

export type SkinTheme = "artistic" | "playful" | "informative";

export type TweakDef =
  | { key: string; label?: string; kind: "number"; min: number; max: number; step?: number; default: number }
  | { key: string; label?: string; kind: "boolean"; default: boolean }
  | { key: string; label?: string; kind: "select"; options: Record<string, string>; default: string }
  | { key: string; label?: string; kind: "color"; default: string };

export interface SkinContext {
  /** Mount here; the skin owns its canvas or SVG. */
  container: HTMLElement;
  size: "card" | "full";
  /** 32 bytes from the file address. */
  seed: Uint8Array;
  reducedMotion: boolean;
  theme: "light" | "dark";
  /** Null until the user enables sound. */
  audio: AudioContext | null;
  /** Connect sound here (not to audio.destination): it carries the volume control. */
  audioOut: AudioNode | null;
  /** Current tweak-panel values. */
  params: Record<string, unknown>;
}

export interface Skin {
  id: string;
  title: string;
  theme: SkinTheme;
  /** Subscribe to Tier C detail (chunk.request/received/written, node.state)? */
  wantsEnriched: boolean;
  /** Shown in the gallery. */
  libs: string[];
  /** Shown below the stage after "Illustrative:" when the note is on, e.g. "node positions". Omit if nothing is. */
  illustrativeNote?: string;
  mount(ctx: SkinContext): void | Promise<void>;
  /** Cheap: update state only, never draw here. */
  onEvent(e: VizEvent): void;
  /** Called from the harness's single rAF loop. */
  frame(dtMs: number, nowMs: number): void;
  resize(w: number, h: number, dpr: number): void;
  setParams(p: Record<string, unknown>): void;
  /** Live text for screen readers; the harness reads it at most every 5 s. */
  describe(): string;
  /** Release GPU, audio, listeners. */
  destroy(): void;
  /** Drives the tweak panel. */
  tweakables: TweakDef[];
  /** Optional counters for the perf HUD (e.g. { particles: 4200 }). */
  stats?(): Record<string, number>;
}

/** Each skin folder's index.ts default-exports one of these. */
export type SkinFactory = () => Skin;

export function defaultParams(defs: TweakDef[]): Record<string, unknown> {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}
