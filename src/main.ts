// Gallery shell: skin list, stage, sources, transport, toggles, tweak panel, HUD, event log and
// the one shared requestAnimationFrame loop.

import "./style.css";
import { Pipeline, TICK_MS } from "./events/derive";
import { seedFromAddress } from "./events/seed";
import { initialState, progressText, reduce } from "./events/state";
import type { Trace, VizEvent } from "./events/types";
import { defaultParams, type Skin, type SkinContext } from "./skins/types";
import { buildTimeline } from "./events/derive";
import type { LiveMode, LiveSource } from "./sources/live";
import { downloadText, parseTrace, serializeTrace } from "./sources/recorder";
import { Player, SPEEDS } from "./sources/replay";
import { DEFAULT_SYNTHETIC, generateTrace, syntheticAddress, type SyntheticParams } from "./sources/synthetic";
import { SDK_VERSION } from "./sources/version";
import { CanvasRecorder } from "./ui/capture";
import { findTrace, SAMPLES, skinLoader, SKINS, TRACES } from "./ui/catalog";
import { Hud } from "./ui/hud";
import { ScrubBar } from "./ui/scrub";
import { TweakPanel } from "./ui/tweaks";
import { Pane } from "tweakpane";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State

interface Timelines {
  plain: VizEvent[];
  enriched: VizEvent[];
}

const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null): void {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

const route = parseHash();
const app = {
  skinId: route.skin ?? "baseline",
  skin: null as Skin | null,
  mountGen: 0,
  size: (route.params.get("size") === "full" ? "full" : "card") as "card" | "full",
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  theme: currentTheme(),
  audio: null as AudioContext | null,
  gain: null as GainNode | null,
  trace: null as Trace | null,
  traceId: route.params.get("trace") ?? "quick",
  timelines: { plain: [], enriched: [] } as Timelines,
  live: null as LiveSource | null,
  liveTimer: 0,
  session: initialState(),
  lastDescribe: 0,
  lastDescribed: "",
};

const player = new Player((e) => {
  reduce(app.session, e);
  app.skin?.onEvent(e);
});
const hud = new Hud($("hud"));
const recorder = new CanvasRecorder();
const tweaks = new TweakPanel($("tweak-pane"), (params) => {
  store.set(`viz.params.${app.skinId}`, JSON.stringify(params));
  app.skin?.setParams(params);
});
const scrub = new ScrubBar($<HTMLCanvasElement>("scrub"), (f) => seek(f * player.duration));

if (route.params.get("capture") === "1") document.body.classList.add("capture");
if (route.params.get("hud") === "0") ($<HTMLInputElement>("hud-toggle")).checked = false;
const initialSpeed = Number(route.params.get("speed") ?? 1) || 1;
player.speed = initialSpeed;

// ---------------------------------------------------------------------------
// Skins

function paramsFor(skin: Skin): Record<string, unknown> {
  const saved = store.get(`viz.params.${skin.id}`);
  let parsed: Record<string, unknown> = {};
  try { parsed = saved ? JSON.parse(saved) : {}; } catch { /* ignore */ }
  return { ...defaultParams(skin.tweakables), ...parsed };
}

function renderSkinList(): void {
  const list = $("skin-list");
  list.replaceChildren();
  for (const theme of ["informative", "artistic", "playful"] as const) {
    const h = document.createElement("h2");
    h.textContent = theme;
    const ul = document.createElement("ul");
    for (const s of SKINS.filter((s) => s.theme === theme)) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const available = Boolean(skinLoader(s.id));
      b.disabled = !available;
      b.setAttribute("aria-current", String(s.id === app.skinId));
      b.innerHTML = `<span>${s.step}. ${s.title}</span>`;
      const badge = document.createElement("span");
      badge.className = `badge ${s.status.replace(" ", "-")}`;
      badge.textContent = s.status;
      b.append(badge);
      b.addEventListener("click", () => selectSkin(s.id));
      li.append(b);
      ul.append(li);
    }
    list.append(h, ul);
  }
}

async function selectSkin(id: string): Promise<void> {
  app.skinId = id;
  renderSkinList();
  updateHash();
  await remount(player.clock);
}

/** Mount a fresh skin instance and re-feed events up to `t` (this is also how seeking works). */
async function remount(t: number): Promise<void> {
  const gen = ++app.mountGen;
  const load = skinLoader(app.skinId) ?? skinLoader("baseline")!;
  const factory = (await load()).default;
  if (gen !== app.mountGen) return;
  app.skin?.destroy();
  const stage = $("stage");
  stage.replaceChildren();
  const skin = factory();
  const params = paramsFor(skin);
  const ctx: SkinContext = {
    container: stage,
    size: app.size,
    seed: seedFromAddress(app.trace?.header.address ?? ""),
    reducedMotion: app.reducedMotion,
    theme: app.theme,
    audio: app.audio,
    audioOut: app.gain,
    params,
  };
  await skin.mount(ctx);
  if (gen !== app.mountGen) { skin.destroy(); return; }
  app.skin = skin;
  resizeSkin();
  tweaks.show(skin.tweakables, params);
  $("skin-name").textContent = `· ${skin.title}`;
  $("skin-libs").textContent = `Libraries: ${skin.libs.join(", ") || "none"}`;
  updateIllustrative();
  app.session = initialState();
  const wasPlaying = player.playing;
  const clock = player.clock;
  player.events = skin.wantsEnriched ? app.timelines.enriched : app.timelines.plain;
  player.seek(t);
  if (player.live) player.clock = clock;
  player.playing = wasPlaying;
}

function resizeSkin(): void {
  const el = $("stage");
  const r = el.getBoundingClientRect();
  if (app.skin && r.width > 0) app.skin.resize(Math.round(r.width), Math.round(r.height), Math.min(2, window.devicePixelRatio || 1));
}
new ResizeObserver(resizeSkin).observe($("stage"));

function updateIllustrative(): void {
  const el = $("illustrative");
  const note = app.skin?.illustrativeNote;
  el.hidden = !note || !($<HTMLInputElement>("illus")).checked;
  el.textContent = note ? `Illustrative: ${note}` : "";
}

// ---------------------------------------------------------------------------
// Sources

function useTrace(trace: Trace, id: string, autoplay = true): Promise<void> {
  stopLive();
  app.trace = trace;
  app.traceId = id;
  app.timelines = { plain: buildTimeline(trace, false), enriched: buildTimeline(trace, true) };
  player.load(app.timelines.plain);
  player.playing = autoplay;
  const h = trace.header;
  $("trace-info").textContent =
    `${h.source === "live" ? "Recorded" : "Synthetic"} · ${h.address.slice(0, 16)}… · ${(player.duration / 1000).toFixed(1)} s · ` +
    `${app.timelines.plain.filter((e) => e.type !== "rate").length} events${h.recordedAt ? ` · ${h.recordedAt.slice(0, 16).replace("T", " ")}` : ""}` +
    (h.note ? ` · ${h.note}` : "");
  updateHash();
  return remount(0);
}

async function loadTraceById(id: string, autoplay = true): Promise<void> {
  const entry = findTrace(id) ?? TRACES[0];
  ($<HTMLSelectElement>("trace-select")).value = entry.id;
  await useTrace(await entry.load(), entry.id, autoplay);
}

function stopLive(): void {
  app.live?.cancel();
  app.live = null;
  clearInterval(app.liveTimer);
  player.live = false;
  ($<HTMLButtonElement>("live-start")).disabled = false;
  ($<HTMLButtonElement>("live-cancel")).disabled = true;
}

async function startLive(): Promise<void> {
  stopLive();
  const address = ($<HTMLInputElement>("live-address")).value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(address)) {
    $("progress-text").textContent = "Enter a 64-character hex address.";
    return;
  }
  const sample = SAMPLES.find((s) => s.address === address.toLowerCase());
  const pipelines: Pipeline[] = [];
  const timelines: Timelines = { plain: [], enriched: [] };
  // The SDK (and its WASM) loads only when live mode is used.
  const { LiveSource } = await import("./sources/live");
  const live = new LiveSource({
    address,
    name: sample?.name,
    size: sample?.size,
    mode: ($<HTMLSelectElement>("live-mode")).value as LiveMode,
    onRecord: (rec) => {
      timelines.plain.push(...pipelines[0].advanceTo(rec.t), ...pipelines[0].push(rec));
      timelines.enriched.push(...pipelines[1].advanceTo(rec.t), ...pipelines[1].push(rec));
    },
  });
  pipelines.push(new Pipeline(live.recorder.header, false), new Pipeline(live.recorder.header, true));
  timelines.plain.push(...pipelines[0].start());
  timelines.enriched.push(...pipelines[1].start());
  app.live = live;
  app.trace = live.recorder.trace();
  app.traceId = "live";
  app.timelines = timelines;
  player.load(timelines.plain, true);
  player.playing = true;
  ($<HTMLButtonElement>("live-start")).disabled = true;
  ($<HTMLButtonElement>("live-cancel")).disabled = false;
  $("trace-info").textContent = "";
  await remount(0);
  app.liveTimer = window.setInterval(() => {
    const t = live.recorder.now();
    timelines.plain.push(...pipelines[0].advanceTo(t));
    timelines.enriched.push(...pipelines[1].advanceTo(t));
  }, TICK_MS);
  await live.run();
  if (app.live !== live) return;
  clearInterval(app.liveTimer);
  app.live = null;
  player.live = false;
  player.clock = player.duration;
  ($<HTMLButtonElement>("live-start")).disabled = false;
  ($<HTMLButtonElement>("live-cancel")).disabled = true;
  $("trace-info").textContent = "Live run finished. Use the transport to replay it, or Download trace to keep it.";
}

// ---------------------------------------------------------------------------
// Transport

function seek(t: number): void {
  if (player.live) return;
  void remount(t);
}

function setPlaying(on: boolean): void {
  if (on && player.ended) {
    void remount(0).then(() => (player.playing = true));
    return;
  }
  player.playing = on;
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1);
}

// ---------------------------------------------------------------------------
// Loop

let last = performance.now();
let skip = false;
let pendingDt = 0;

function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = now - last;
  last = now;
  if (player.live && app.live) {
    player.clock = app.live.recorder.now();
    player.update(0);
  } else {
    player.update(Math.min(dt, 250));
  }
  pendingDt += Math.min(dt, 250);
  let cost = 0;
  skip = hud.halfRate ? !skip : false;
  if (app.skin && !skip) {
    const t0 = performance.now();
    app.skin.frame(pendingDt, now);
    cost = performance.now() - t0;
    pendingDt = 0;
  }
  hud.tick(dt, cost, app.skin?.stats?.(), now);

  const text = progressText(app.session);
  const pt = $("progress-text");
  if (pt.textContent !== text) pt.textContent = text;
  if (now - app.lastDescribe > 5000 && app.skin) {
    app.lastDescribe = now;
    const d = app.skin.describe();
    if (d !== app.lastDescribed) $("aria-live").textContent = app.lastDescribed = d;
  }
  scrub.draw(player.events, player.clock, player.live ? Math.max(player.clock, player.duration) : player.duration);
  $("time").textContent = `${formatTime(player.clock)} / ${formatTime(player.live ? player.clock : player.duration)} s${player.live ? " · live" : ""}`;
  const playLabel = player.playing ? "⏸" : "▶";
  if ($("play").textContent !== playLabel) {
    $("play").textContent = playLabel;
    $("play").setAttribute("aria-label", player.playing ? "Pause" : "Play");
  }
  if (logOpen && now - lastLog > 250) renderLog(now);
}

// ---------------------------------------------------------------------------
// Event log

let logOpen = false;
let lastLog = 0;
let lastLogKey = "";

function renderLog(now: number): void {
  lastLog = now;
  const all = ($<HTMLInputElement>("log-rate")).checked;
  const key = `${player.clock}:${player.events.length}:${all}`;
  if (key === lastLogKey) return;
  lastLogKey = key;
  const t = player.clock;
  const raw = (app.trace?.records ?? []).filter((r) => r.t <= t).slice(-300);
  $("log-raw").textContent = raw
    .map((r) => {
      const time = formatTime(r.t).padStart(7);
      if (r.kind === "sdk") return `${time}  ${r.ev.operation.padEnd(9)} ${r.ev.status === "running" ? "" : `[${r.ev.status}] `}${r.ev.message}`;
      if (r.kind === "note") return `${time}  note      ${r.message}`;
      return all ? `${time}  detail    ${r.ev.type}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const parsed: string[] = [];
  for (let i = player.events.length - 1; i >= 0 && parsed.length < 300; i--) {
    const e = player.events[i];
    if (e.t > t) continue;
    if (!all && (e.type === "rate" || "tier" in e)) continue;
    const { t: et, type, ...rest } = e;
    parsed.push(`${formatTime(et).padStart(7)}  ${type.padEnd(17)} ${JSON.stringify(rest)}`);
  }
  $("log-parsed").textContent = parsed.reverse().join("\n");
  for (const id of ["log-raw", "log-parsed"]) $(id).scrollTop = $(id).scrollHeight;
}

// ---------------------------------------------------------------------------
// Theme, routing

function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseHash(): { skin?: string; params: URLSearchParams } {
  const [skin, query] = location.hash.replace(/^#\/?/, "").split("?");
  return { skin: skin || undefined, params: new URLSearchParams(query ?? "") };
}

function updateHash(): void {
  if (document.body.classList.contains("capture")) return;
  const q = new URLSearchParams();
  if (app.traceId !== "live") q.set("trace", app.traceId);
  if (player.speed !== 1) q.set("speed", String(player.speed));
  if (app.size === "full") q.set("size", "full");
  history.replaceState(null, "", `#${app.skinId}${q.size ? `?${q}` : ""}`);
}

// ---------------------------------------------------------------------------
// Wire up controls

function wire(): void {
  $("sdk-version").textContent = SDK_VERSION;

  $("play").addEventListener("click", () => setPlaying(!player.playing));
  $("restart").addEventListener("click", () => {
    if (!player.live) void remount(0).then(() => (player.playing = true));
  });
  $("step").addEventListener("click", () => {
    const t = player.nextEventTime();
    player.playing = false;
    if (t !== undefined) {
      player.clock = t;
      player.update(0);
    }
  });
  const speed = $<HTMLSelectElement>("speed");
  const speeds: number[] = [...SPEEDS];
  if (!speeds.includes(initialSpeed)) speeds.push(initialSpeed);
  for (const s of speeds.sort((a, b) => a - b)) speed.add(new Option(`${s}×`, String(s), false, s === initialSpeed));
  speed.addEventListener("change", () => {
    player.speed = Number(speed.value);
    updateHash();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!player.playing); }
    if (e.key === "ArrowRight") $("step").click();
  });

  // Tabs.
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) t.setAttribute("aria-selected", String(t === tab));
      for (const body of document.querySelectorAll<HTMLElement>("[data-tab-body]")) body.hidden = body.dataset.tabBody !== tab.dataset.tab;
    });
  }

  // Replay.
  const traceSelect = $<HTMLSelectElement>("trace-select");
  const groups = { real: document.createElement("optgroup"), synthetic: document.createElement("optgroup") };
  groups.real.label = "Recorded";
  groups.synthetic.label = "Synthetic";
  for (const t of TRACES) groups[t.kind].append(new Option(t.label, t.id));
  traceSelect.append(groups.real, groups.synthetic);
  traceSelect.addEventListener("change", () => void loadTraceById(traceSelect.value));
  $<HTMLInputElement>("trace-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await useTrace(parseTrace(await file.text()), "file");
      $("trace-info").textContent = `${file.name} · ${$("trace-info").textContent}`;
    } catch (err) {
      $("trace-info").textContent = `Couldn't read that trace: ${(err as Error).message}`;
    }
  });

  // Synthetic.
  const synth = {
    chunks: 40, latencyMs: DEFAULT_SYNTHETIC.latencyMs, jitter: DEFAULT_SYNTHETIC.jitter, concurrency: DEFAULT_SYNTHETIC.concurrency,
    retryRate: 0.03, lookupRounds: 0, lookupFailures: 0, reseed: false, nested: false, stalls: 0, outcome: "success", save: false,
    sizeMB: 160,
  };
  const pane = new Pane({ container: $("synthetic-pane") });
  pane.addBinding(synth, "chunks", { min: 1, max: 3000, step: 1 });
  pane.addBinding(synth, "sizeMB", { label: "size MB", min: 0.001, max: 1000 });
  pane.addBinding(synth, "latencyMs", { label: "latency ms", min: 100, max: 8000, step: 50 });
  pane.addBinding(synth, "jitter", { min: 0, max: 1.5 });
  pane.addBinding(synth, "concurrency", { min: 1, max: 32, step: 1 });
  pane.addBinding(synth, "retryRate", { label: "retry rate (C)", min: 0, max: 0.5 });
  pane.addBinding(synth, "lookupRounds", { label: "lookup rounds", min: 0, max: 20, step: 1 });
  pane.addBinding(synth, "lookupFailures", { label: "failed queries", min: 0, max: 10, step: 1 });
  pane.addBinding(synth, "reseed");
  pane.addBinding(synth, "nested", { label: "nested DataMap" });
  pane.addBinding(synth, "stalls", { min: 0, max: 5, step: 1 });
  pane.addBinding(synth, "outcome", { options: { success: "success", "connect fails": "fail-connect", "fails mid-way": "fail-mid", cancelled: "cancel" } });
  pane.addBinding(synth, "save", { label: "save step" });
  $("synthetic-run").addEventListener("click", () => {
    const params: SyntheticParams = {
      ...DEFAULT_SYNTHETIC,
      address: syntheticAddress(JSON.stringify(synth)),
      chunks: synth.chunks, size: Math.round(synth.sizeMB * 1e6), latencyMs: synth.latencyMs, jitter: synth.jitter,
      concurrency: synth.concurrency, retryRate: synth.retryRate, lookupRounds: synth.lookupRounds,
      lookupFailures: synth.lookupFailures, reseed: synth.reseed, nested: synth.nested,
      stalls: Array.from({ length: synth.stalls }, (_, i) => ({ at: (i + 1) / (synth.stalls + 1), ms: 5000 })),
      outcome: synth.outcome as SyntheticParams["outcome"], save: synth.save,
    };
    void useTrace(generateTrace(params, "custom synthetic"), "custom");
  });

  // Live.
  const sampleSelect = $<HTMLSelectElement>("live-sample");
  const addressInput = $<HTMLInputElement>("live-address");
  for (const s of SAMPLES) sampleSelect.add(new Option(`${s.name} (${(s.size / 1e6).toFixed(s.size < 1e6 ? 3 : 0)} MB)`, s.address));
  sampleSelect.add(new Option("Other address…", ""));
  addressInput.value = route.params.get("address") ?? SAMPLES[0].address;
  sampleSelect.value = SAMPLES.some((s) => s.address === addressInput.value) ? addressInput.value : "";
  sampleSelect.addEventListener("change", () => {
    if (sampleSelect.value) addressInput.value = sampleSelect.value;
    else addressInput.focus();
  });
  $("live-start").addEventListener("click", () => void startLive());
  $("live-cancel").addEventListener("click", () => app.live?.cancel());

  // View.
  const sizeButtons = { card: $("size-card"), full: $("size-full") };
  const setSize = (size: "card" | "full") => {
    app.size = size;
    $("stage-wrap").className = `stage-wrap ${size}`;
    sizeButtons.card.setAttribute("aria-pressed", String(size === "card"));
    sizeButtons.full.setAttribute("aria-pressed", String(size === "full"));
    updateHash();
    void remount(player.clock);
  };
  sizeButtons.card.addEventListener("click", () => setSize("card"));
  sizeButtons.full.addEventListener("click", () => setSize("full"));
  $("stage-wrap").className = `stage-wrap ${app.size}`;
  sizeButtons.card.setAttribute("aria-pressed", String(app.size === "card"));
  sizeButtons.full.setAttribute("aria-pressed", String(app.size === "full"));
  $("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void $("stage-wrap").requestFullscreen?.();
  });

  $("theme").addEventListener("click", () => {
    app.theme = app.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = app.theme;
    store.set("viz.theme", app.theme);
    void remount(player.clock);
  });
  if (route.params.get("theme") === "dark" || route.params.get("theme") === "light") {
    app.theme = route.params.get("theme") as "light" | "dark";
    document.documentElement.dataset.theme = app.theme;
  }

  const reduced = $<HTMLInputElement>("reduced");
  reduced.checked = app.reducedMotion;
  reduced.addEventListener("change", () => {
    app.reducedMotion = reduced.checked;
    void remount(player.clock);
  });
  $("illus").addEventListener("change", updateIllustrative);
  const hudToggle = $<HTMLInputElement>("hud-toggle");
  $("hud").hidden = !hudToggle.checked;
  hudToggle.addEventListener("change", () => ($("hud").hidden = !hudToggle.checked));

  const volume = $<HTMLInputElement>("volume");
  $<HTMLInputElement>("sound").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (on && !app.audio) {
      app.audio = new AudioContext();
      app.gain = app.audio.createGain();
      app.gain.gain.value = Number(volume.value);
      app.gain.connect(app.audio.destination);
    }
    if (app.audio) void (on ? app.audio.resume() : app.audio.suspend());
    void remount(player.clock);
  });
  volume.addEventListener("input", () => app.gain && (app.gain.gain.value = Number(volume.value)));

  // Settings JSON.
  $("copy-settings").addEventListener("click", async () => {
    const json = JSON.stringify({ skin: app.skinId, params: tweaks.current() }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      flash("copy-settings", "Copied");
    } catch {
      prompt("Copy these settings:", json);
    }
  });
  $("paste-settings").addEventListener("click", async () => {
    let text: string | null = null;
    try { text = await navigator.clipboard.readText(); } catch { /* fall back to a prompt */ }
    if (!text || !text.trim().startsWith("{")) text = prompt("Paste settings JSON:");
    if (!text) return;
    try {
      const obj = JSON.parse(text) as { skin?: string; params?: Record<string, unknown> };
      const params = obj.params ?? (obj as Record<string, unknown>);
      if (obj.skin && obj.skin !== app.skinId) await selectSkin(obj.skin);
      store.set(`viz.params.${app.skinId}`, JSON.stringify({ ...tweaks.current(), ...params }));
      await remount(player.clock);
      flash("paste-settings", "Applied");
    } catch (err) {
      alert(`That isn't valid settings JSON: ${(err as Error).message}`);
    }
  });
  $("reset-settings").addEventListener("click", () => {
    store.set(`viz.params.${app.skinId}`, null);
    void remount(player.clock);
  });

  // Capture.
  $("record").addEventListener("click", async () => {
    if (recorder.recording) {
      await recorder.stop(`${app.skinId}-${app.traceId}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.webm`);
      $("record").textContent = "● Record WebM";
      return;
    }
    const err = recorder.start($("stage"));
    if (err) alert(err);
    else $("record").textContent = "■ Stop recording";
  });
  $("download-trace").addEventListener("click", () => {
    if (!app.trace) return;
    const name = app.traceId === "live" ? `live-${app.trace.header.address.slice(0, 8)}-${Date.now()}` : app.traceId;
    downloadText(`${name}.jsonl`, serializeTrace(app.trace));
  });

  // Event log.
  const toggleLog = (open: boolean) => {
    logOpen = open;
    $("log").hidden = !open;
    $("log-toggle").setAttribute("aria-expanded", String(open));
    lastLogKey = "";
  };
  $("log-toggle").addEventListener("click", () => toggleLog(!logOpen));
  $("log-close").addEventListener("click", () => toggleLog(false));
  $("log-rate").addEventListener("change", () => (lastLogKey = ""));
  if (route.params.get("log") === "1") toggleLog(true);

  window.addEventListener("hashchange", () => {
    const r = parseHash();
    if (r.skin && r.skin !== app.skinId) void selectSkin(r.skin);
  });
}

function flash(id: string, text: string): void {
  const el = $(id);
  const old = el.textContent;
  el.textContent = text;
  setTimeout(() => (el.textContent = old), 1200);
}

// ---------------------------------------------------------------------------

declare global {
  interface Window { __viz?: { player: Player; state: () => typeof app.session; trace: () => Trace; ready: boolean } }
}

wire();
renderSkinList();
window.__viz = { player, state: () => app.session, trace: () => app.trace!, ready: false };
if (route.params.get("source") === "live") {
  document.querySelector<HTMLButtonElement>('[data-tab="live"]')?.click();
  void startLive();
} else {
  await loadTraceById(app.traceId, route.params.get("autoplay") !== "0");
}
window.__viz.ready = true;
requestAnimationFrame(loop);
