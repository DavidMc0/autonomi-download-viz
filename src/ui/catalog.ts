// What the gallery can show: skins (from skins.json, lazy-loaded), traces (recorded files and
// synthetic presets) and sample addresses for live mode.

import manifest from "../../skins.json";
import type { Trace } from "../events/types";
import type { SkinFactory, SkinTheme } from "../skins/types";
import { parseTrace } from "../sources/recorder";
import { presetTrace, SYNTHETIC_PRESETS } from "../sources/synthetic";

export interface SkinEntry {
  id: string;
  step: number;
  title: string;
  theme: SkinTheme;
  status: "planned" | "in review" | "approved";
}

export const SKINS = manifest as SkinEntry[];

const loaders = import.meta.glob<{ default: SkinFactory }>("../skins/*/index.ts");

export function skinLoader(id: string): (() => Promise<{ default: SkinFactory }>) | undefined {
  return loaders[`../skins/${id}/index.ts`];
}

export interface TraceEntry {
  id: string;
  label: string;
  kind: "real" | "synthetic";
  load(): Promise<Trace>;
}

const files = import.meta.glob<string>("/traces/*.jsonl", { query: "?url", import: "default", eager: true });

const REAL_LABELS: Record<string, string> = {
  quick: "quick: lucky.jpg, 139 kB",
  tones: "Three tones.mp3, 321 kB",
  "tones-stream": "Three tones.mp3 via openFile (no chunk progress)",
  "medium-64mb": "64 MB of random bytes (nested DataMap, 17 chunks)",
  large: "large",
};

function realLabel(id: string): string {
  const m = /^(.*)-(\d+)$/.exec(id);
  const base = m ? m[1] : id;
  return `${REAL_LABELS[base] ?? base}${m ? ` · run ${m[2]}` : ""} (real)`;
}

export const TRACES: TraceEntry[] = [
  ...Object.entries(files)
    .map(([path, url]) => {
      const id = path.replace(/^.*\/(.*)\.jsonl$/, "$1");
      return { id, label: realLabel(id), kind: "real" as const, load: async () => parseTrace(await (await fetch(url)).text()) };
    })
    .sort((a, b) => a.id.localeCompare(b.id)),
  ...Object.entries(SYNTHETIC_PRESETS).map(([id, p]) => ({
    id, label: `${p.label}`, kind: "synthetic" as const, load: async () => presetTrace(id),
  })),
];

/** Deep-link names from the brief (quick, large) map onto the first recorded run, else a synthetic stand-in. */
export function findTrace(name: string): TraceEntry | undefined {
  const exact = TRACES.find((t) => t.id === name);
  if (exact) return exact;
  return TRACES.find((t) => t.id === `${name}-1`) ?? TRACES.find((t) => t.id === `synthetic-${name}`);
}

/** From https://try.autonomi.com/featured.json (2026-10-13). */
export const SAMPLES = [
  { name: "lucky.jpg", size: 138_931, address: "711c7e20006ff3e0ac6c1f3063286a0c1a3e4c409642e8c526173fa60bb7078a" },
  { name: "Welcome.md", size: 574, address: "52af8a181c6171f8e12896ca734cdf60839c3b324dfbeadf857226dfc7cb453b" },
  { name: "Three tones.mp3", size: 321_035, address: "2e36c503096c296a9bb17258fc29dda5d9f5ba9706964000ec0760f9adbc7082" },
  { name: "SelfEncryptingData.pdf", size: 183_550, address: "08e07281787c501a99967501c48454057ae92c4ae5b5315e1f1d36654b410183" },
  { name: "Data That Encrypts Itself (with LEGO).mp4", size: 54_903_201, address: "41852ea4bc68193565974e39552ce3ac1b32edddc7e9695910eaff1fbc34645c" },
  { name: "64 MB of random bytes.bin", size: 67_108_864, address: "f6eeba94008f493a8518186b0647df6d39dbde75f41d5b79549e9a4e63a1ab43" },
];
