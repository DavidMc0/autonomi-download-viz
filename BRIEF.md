# Autonomi download visualisations: build brief

Build a gallery of 15 animated visualisations of an Autonomi download: connecting to nodes, finding the file, fetching chunks, verifying and saving. Each visualisation is a swappable "skin" driven by the same event stream. Skins can be fed by a real download or by a replayed recording, and each can later be dropped into the Download Button page.

Hand this file to Claude Code as the build brief. It goes with the working Download Button demo (`Autonomi_Download_Button_Demo_SPEC.md`).

Written 2026-10-13 against `@withautonomi/ant-browser-sdk` 0.1.2 and ant-client `main`.

---

## 0. How this build runs: one skin at a time, with review stops

**This is an iterative build. Do not build ahead.**

1. Build **Step 0 (the harness)**, then stop for review.
2. Build the skins **one at a time**, in the order in section 7. After each skin:
   - stop and produce a **review package** (section 0.1);
   - wait for David's feedback;
   - apply the agreed tweaks;
   - record the outcome in `DECISIONS.md`.
3. Start the next skin only when David says so (for example "next", "approved" or "move on").
4. If feedback on one skin changes something shared (the event model, the controls, the colour system), update the harness and **every skin already built**, then say so in the next review.
5. David may reorder, merge or drop concepts at any checkpoint. The current plan is whatever `DECISIONS.md` says, not this file.

### 0.1 Review package (after every step)

Write `reviews/NN-<skin>.md` containing:

- **What was built:** 3-5 lines, including which data is real and which is illustrative (section 3).
- **How to view it:** the preview URL (section 5.6) and the gallery link (`/#<skin-id>`).
- **Captures:** a 20-40 second WebM recorded from the harness (section 5.4) for each of the `quick`, `large` and `flaky` traces, plus one PNG still of the finished state, all saved in `reviews/media/`.
- **Performance:** FPS (median and 5th percentile) on a mid-range laptop over the `large` trace at 1×, the JS bundle size this skin adds (gzipped), and its main-thread time per frame.
- **Tweakables:** the parameters exposed in the tweak panel (section 5.3), with current values.
- **Open questions for David:** 3-6 specific choices, each with options and a recommendation (for example "Palette: A night sky / B dawn / C brand orange; I suggest A").
- **Known gaps:** anything not working or not yet faithful to the brief.

Then stop and wait.

### 0.2 Feedback loop

- David replies in chat, and may paste a **settings JSON** exported from the tweak panel. Treat pasted settings as the new defaults for that skin.
- Log each decision in `DECISIONS.md` (date, skin, decision, reason), newest first.
- After applying feedback, produce a short follow-up review (what changed, new captures if the look changed), then wait again unless David has already said to carry on.

---

## 1. Goals

- **Delight first, honesty always.** Visuals should be impressive or funny, but must never claim something false about the network. Real data drives the timing; illustrative detail is labelled as such (section 3.3).
- **One event model, many skins.** All skins consume the same normalised events (section 4), so any skin can run on a live download or any recorded trace.
- **Never slow the download.** The animation must not starve the download's WASM or WebRTC work (section 6).
- **Embeddable later.** Each skin must render well in two sizes: a **card** (about 360 × 220 CSS px, the download page's progress area) and **full screen**. Card mode is the priority.

**Out of scope:** uploads, payments, changes to the Download Button demo itself (integration is section 9, after the gallery is approved), and any server.

---

## 2. What a download actually reports (verified 2026-10-13)

The SDK's `onProgress` listener receives `ProgressEvent` objects:

```ts
{ operationId, parentOperationId?, operation, phase, message, completed?, total?, unit?, status }
// operation: "connect" | "lookup" | "download" | "download-and-save" | "save" | "open-file" | ...
// phase:     "connecting" | "downloading" | "opening" | "saving" | "complete" | ...
// status:    "running" | "succeeded" | "failed" | "cancelled"  (exactly one terminal event)
```

During a download, the Rust core sends **plain-text messages**. The SDK forwards them as `message` with `phase: "downloading"`, **without** filling in `completed`/`total`. These are the useful messages:

| Stage | Message text (from ant-client `wasm_transport.rs` / SDK `client.ts`) | What it gives us |
| --- | --- | --- |
| Connect | `Authenticating N bootstrap node(s)` | Seed count (7 bundled on mainnet) |
| Connect | `Connected to authenticated peer <peerId>` | First authenticated peer |
| Lookup | `Iteration <i>: <peerId> returned <k> nodes` | Each lookup round: who answered and how many closer nodes they offered |
| Lookup | `Query <peerId> failed: <error>` | A peer that didn't answer |
| Lookup | `Ignoring invalid candidate from <peerId>: <error>` | A bad answer that was rejected |
| Lookup | `Retrying lookup through configured seeds` | A lookup fell back to the seeds |
| DataMap | `Fetching public DataMap <address>` / `Fetching <address>` | Start of the file-key fetch |
| DataMap | `Resolving nested DataMap record <address>` | A two-level DataMap (bigger files) |
| DataMap | `Verified public DataMap (<n> bytes)` | The file key was found and checked |
| Open | `Ready to stream <name> (<size> bytes, <n> chunks)` | Size and chunk count (`openFile` path) |
| Chunks | `Downloaded chunk <completed>/<total>` | A count of finished chunks, in completion order (**not** a chunk index) |
| Verify | `Verified complete <name> as <hash>` | Whole-file BLAKE3 hash, verified |
| Save | `Choosing a download destination`, `Saving <name>`, `Saved <name>` | Save picker and write |

**Not available in production builds:**

- which node served each chunk;
- per-chunk timing, size, index, retries, decryption or write order;
- XOR positions of the nodes used for chunk fetches.

Lookup messages appear while the DataMap is being found, not for each data chunk. The core has a richer per-operation trace (`setBrowserTrace`: operation, target, peer, elapsed ms), but it is **compiled only into test builds** ("No callbacks or peer/address logging are included in production bindings"). It is not in the published SDK.

**Message strings are not a stable API.** Keep all parsing in one module (`src/events/parse.ts`), test it against recorded traces, and pin the SDK version exactly. If an SDK update changes a string, only the parser changes.

---

## 3. Data tiers and honesty rules

### 3.1 Tier A: live, real

Available from the published SDK today:

- phases;
- seed count and first peer;
- lookup rounds (peer IDs, nodes returned, failures);
- DataMap verified, nested DataMap;
- total chunks and file size (from `openFile().size` before the download, or the "Ready to stream" message);
- chunk completion count over time, which gives chunks/s and approximate bytes/s (size ÷ total × completed);
- stalls (derived: no chunk progress for 3 s while downloading);
- the final hash;
- save events;
- errors and cancellation.

The file **address** is known before anything starts, so it can **seed** each skin's deterministic look (palette, layout, melody) from the first frame. The final hash arrives only at the end and can be used for a finale or "portrait".

### 3.2 Tier B: detailed, real but not public

Per-chunk and per-node detail, available only if Autonomi exposes it: either a test build with `setBrowserTrace`, or a future structured progress event (Appendix A). The harness should accept Tier B events if they appear, but **no skin may require them**.

### 3.3 Tier C: illustrative

Detail the skin invents to make a scene work, such as which "node" a chunk flies from, tile order, or a retry shown on one specific chunk. Rules:

- Generate it **deterministically** from the file address and the real event timing, so replays look identical.
- Keep the real data in charge of timing and totals. If 37 of 120 chunks are done, the scene shows 37 of 120; only *which* 37 is illustrative.
- In live mode, mark illustrative layers with a small toggleable "illustrative" note, worded for each skin (for example "node positions are illustrative").
- Informative skins must keep the real and illustrative layers visually distinct (for example solid versus dashed lines), and say which is which in a legend.

---

## 4. Event model

### 4.1 Normalised events (`src/events/types.ts`)

Every event has `t` (ms since session start) and `type`. Optional fields marked `B` are Tier B and fields marked `C` are synthetic only.

```ts
type VizEvent =
  | { type: "session.start"; address: string; name?: string; size?: number }
  | { type: "connect.start"; seeds: number }
  | { type: "connect.peer"; peerId: string }
  | { type: "connect.done" }
  | { type: "connect.failed"; code?: string; message: string }
  | { type: "lookup.round"; iteration: number; peerId: string; returned: number }
  | { type: "lookup.fail"; peerId: string; reason: string }
  | { type: "lookup.invalid"; peerId: string }
  | { type: "lookup.reseed" }
  | { type: "datamap.fetch"; address: string }
  | { type: "datamap.nested"; address: string }
  | { type: "datamap.verified"; bytes: number }
  | { type: "file.meta"; size: number; chunks?: number; name?: string }
  | { type: "chunk.done"; completed: number; total: number }
  | { type: "chunk.stall"; sinceMs: number }                // derived
  | { type: "rate"; chunksPerSec: number; bytesPerSec?: number } // derived, about 4 Hz
  | { type: "file.verified"; hash: string }
  | { type: "save.picking" } | { type: "save.writing" } | { type: "save.done" }
  | { type: "session.done" }
  | { type: "session.failed"; code?: string; message: string }
  | { type: "session.cancelled" }
  // Tier B / C detail. Skins may use these when present but must not depend on them.
  | { type: "chunk.request"; index: number; peerId?: string; tier: "B" | "C" }
  | { type: "chunk.received"; index: number; bytes: number; peerId?: string; tier: "B" | "C" }
  | { type: "chunk.retry"; index: number; attempt: number; tier: "B" | "C" }
  | { type: "chunk.written"; index: number; tier: "B" | "C" }
  | { type: "node.state"; peerId: string; state: "seen" | "connecting" | "connected" | "sending" | "failed"; tier: "B" | "C" };
```

### 4.2 Event sources

- **`LiveSource`** connects with the SDK and downloads a given address. It wraps `onProgress`, parses messages into `VizEvent`s and adds derived events. Use `download()` (in memory, no save picker) by default, so a live run doesn't keep asking where to save; offer an optional "save it" toggle that uses `downloadAndSave()`. Keep one shared client per page.
- **`TraceRecorder`** saves the raw SDK events, each with its `t`, to JSONL, so recordings can be re-parsed after parser fixes. It has a "Download trace" button.
- **`ReplaySource`** plays a raw trace through the same parser at 0.25×-20× speed, with pause, step and scrub (seeking re-feeds events from the start into a fresh skin instance, so skins need no "rewind" logic).
- **`SyntheticSource`** generates a trace from parameters: chunk count, mean and jitter of latency, failure rate, stall moments, nested DataMap on or off, error at the end. It also emits **Tier C** chunk/node detail flagged `tier: "C"`, so skins can be built and tested with rich detail.
- **`Enricher`** takes Tier A events and adds Tier C detail deterministically (seeded by the address). Skins that want per-chunk or per-node scenes subscribe to the enriched stream.

### 4.3 Bundled traces (`traces/`)

Record real ones in Step 0 and keep synthetic presets:

| Name | Source | Purpose |
| --- | --- | --- |
| `quick` | real | Small file (under 5 MB): the whole story in a few seconds |
| `large` | real | 300-900 MB: hundreds of chunks, sustained throughput |
| `flaky` | synthetic | Failed queries, a reseed, two stalls, then success |
| `nested` | real or synthetic | Two-level DataMap |
| `fail-connect` | synthetic | Connection fails (UDP blocked) |
| `fail-mid` | synthetic | Fails half-way through the chunks |
| `cancel` | synthetic | User cancels during the download |
| `huge` | synthetic | 3,000 chunks, to stress-test rendering |

Use sample addresses from try.autonomi.com plus files David has uploaded. Record each real trace at least twice, so variation between runs is visible.

---

## 5. The harness (Step 0)

### 5.1 Stack

- **Vite + TypeScript, no UI framework**, matching the Download Button demo.
- `@withautonomi/ant-browser-sdk` pinned **exactly** to the version recorded in `DECISIONS.md` (start at `0.1.2`).
- Per-skin libraries are listed in each step. Install them only when that skin is built, pin exact versions, and lazy-load each skin with dynamic `import()` so the gallery's first load stays small.
- Tweak panel: **Tweakpane** (or lil-gui).
- Tests: **vitest** for the parser, enricher and synthetic source; **Playwright** (the container's pre-installed Chromium) for smoke tests and automated captures.

### 5.2 Skin interface (`src/skins/types.ts`)

```ts
export interface SkinContext {
  container: HTMLElement;          // mount here; skin owns its canvas or SVG
  size: "card" | "full";
  seed: Uint8Array;                // 32 bytes from the file address
  reducedMotion: boolean;
  theme: "light" | "dark";
  audio: AudioContext | null;      // null until the user enables sound
  params: Record<string, unknown>; // current tweak-panel values
}

export interface Skin {
  id: string; title: string; theme: "artistic" | "playful" | "informative";
  wantsEnriched: boolean;          // subscribe to Tier C detail?
  libs: string[];                  // shown in the gallery
  mount(ctx: SkinContext): void | Promise<void>;
  onEvent(e: VizEvent): void;      // cheap: update state only, never draw here
  frame(dtMs: number, nowMs: number): void; // called from one shared rAF loop
  resize(w: number, h: number, dpr: number): void;
  setParams(p: Record<string, unknown>): void;
  describe(): string;              // live text for screen readers (section 6)
  destroy(): void;                 // release GPU, audio, listeners
  tweakables: TweakDef[];          // drives the tweak panel
}
```

### 5.3 Gallery page

- A skin list grouped by theme, with build status (planned, in review, approved) read from a `skins.json` manifest.
- A stage showing the selected skin in **card** size (default) or **full** size, with a toggle.
- A **source picker**: Live (address input, with a pre-filled sample), Replay (trace picker plus "Load trace file"), or Synthetic (parameter sliders).
- **Transport:** play/pause, speed (0.25×, 0.5×, 1×, 2×, 5×, 20×), restart, a scrub bar with event markers, and "step to next event".
- **Toggles:** theme, reduced motion, sound (off until clicked), "show illustrative note", and an **event log** drawer showing the parsed events and raw messages side by side.
- **Tweak panel** for the current skin's `tweakables`, with **Copy settings JSON** and **Paste settings JSON** buttons.
- **Perf HUD:** FPS, frame time, JS heap (where available), active particles or sprites.
- **Plain progress text** under the stage at all times (for example "Fetched 142 of 310 chunks · 4.1 MB/s"), as the download page would show.
- Deep links: `/#<skin-id>?trace=large&speed=2&size=full`.

### 5.4 Capture

- A **Record** button captures the stage's canvas with `captureStream()` + `MediaRecorder` to WebM, for review packages. For SVG or DOM skins, render to a canvas for capture, or use the Playwright screen recording in `scripts/capture.ts`.
- `npm run capture -- <skin-id>` replays `quick`, `large` and `flaky` at a fixed speed in headless Chromium and writes WebMs and a final-frame PNG to `reviews/media/`.

### 5.5 Placeholder skin

Build a deliberately plain **"Baseline"** skin in Step 0: phase label, progress bar, a chunk counter and a scrolling event list. It proves the pipeline end to end and is the comparison point for every other skin.

### 5.6 Preview deploys

Deploy the gallery to a static HTTPS host with a URL per push (Cloudflare Pages or GitHub Pages; ask David which in the Step 0 review), so he can review on his laptop and phone. Live mode needs HTTPS, WebAssembly and WebRTC.

### 5.7 Step 0 acceptance

- [ ] A live download of a sample address runs in the gallery and shows the Baseline skin progressing.
- [ ] `quick` and `large` real traces are recorded and replay identically at any speed; scrubbing works.
- [ ] Parser unit tests cover every message in section 2, including unknown messages (passed through as `log` events, never thrown).
- [ ] The synthetic source produces all presets in section 4.3.
- [ ] The tweak panel, settings copy/paste, the perf HUD and capture all work.
- [ ] Preview deploy is live.
- [ ] Review package `reviews/00-harness.md` is written, with sample event logs from a real run, and lists any messages seen that are not in section 2.

**Stop for review.**

---

## 6. Rules for every skin

**Performance budget**

- 60 FPS target, 30 FPS floor on a mid-range laptop; 30 FPS on a mid-range Android phone in card mode.
- At most **4 ms of main-thread time per frame** for the skin; no allocation in `frame()` hot paths (reuse pools).
- Lazy-loaded skin code at most 250 KB gzipped (excluding shared libraries), assets at most 1 MB per skin, unless a review agrees otherwise.
- Use one shared `requestAnimationFrame` loop. Pause rendering when the tab is hidden, and drop to 30 FPS automatically when frame time exceeds 20 ms.
- Where a skin is canvas or WebGL heavy, try `OffscreenCanvas` in a worker; report in the review whether it helped.
- **The download wins.** If the perf HUD shows the download's chunk rate falls by more than 5 % with a skin running (compare a live run against Baseline), the skin must reduce its work.

**Accessibility**

- Respect `prefers-reduced-motion` and the gallery toggle: a calm variant (slow fades, no camera moves, no flashing) for every skin.
- No flashes faster than 3 per second over large areas.
- `describe()` feeds an `aria-live="polite"` region, updated no more than every 5 seconds ("Connected to 3 nodes. 40 percent downloaded.").
- Plain progress text always stays visible next to or under the skin.
- Sound is always off until the user turns it on, and has a volume control.

**Look and content**

- The whole story in every skin: connecting, finding the file, chunks, verifying, done, failure and cancel. Every skin needs designed **failure** and **cancel** endings, not just success.
- **Seeded:** the same address always gives the same look; different addresses look different.
- **Card mode** must read clearly at 360 × 220: one focal action, large shapes, no tiny text.
- **Credit:** a small "Powered by Autonomi" link in full mode (autonomi.com).
- **Originality:** all characters, sprites and sounds are original. Don't imitate a known character, mascot, game or brand (including the falling-block game in skin 14: no names, logos or trade dress from existing games). Fonts and any third-party code must have licences that allow commercial use; list them in `THIRD-PARTY.md`.
- **Wording** follows the product rules: "free" describes only the download; no "forever" or "can't be taken down".

**Characters (playful skins)**

Build characters procedurally in code (vector shapes in PixiJS, or SVG), with simple bone- or tween-driven animation, so Claude Code can produce and adjust them. Keep a `characters/` module per skin, so a designer could later replace them with Rive (`@rive-app/canvas`) state machines driven by the same events. Mention in the review if a skin would benefit from that.

---

## 7. Build sequence

Each step is: build it, then **stop for review** (section 0). Order:

| Step | Skin | Theme |
| --- | --- | --- |
| 0 | Harness + Baseline | |
| 1 | Murmuration | Artistic 1 |
| 2 | Robot DJ | Playful 1 |
| 3 | Address-space map | Informative 1 |
| 4 | Hash garden | Artistic 2 |
| 5 | Ant colony | Playful 2 |
| 6 | Chunk waterfall | Informative 2 |
| 7 | The file's song | Artistic 3 |
| 8 | Pizza delivery | Playful 3 |
| 9 | Byte-flow diagram | Informative 3 |
| 10 | Stained glass | Artistic 4 |
| 11 | If it fits, I sits | Playful 4 |
| 12 | Verification ledger | Informative 4 |
| 13 | Ink in water | Artistic 5 |
| 14 | Falling blocks | Playful 5 |
| 15 | Network health and privacy | Informative 5 |

Each skin's "mapping" table says which event drives which visual. Treat these mappings as starting points: David's feedback overrides them.

---

### Step 1: Murmuration (Artistic 1)

**Idea:** a flock of light finds the file. Nodes are faint stars around a slowly turning ring, the network's address space. The flock gathers at the seeds, sweeps through lookup rounds toward the file's position on the ring, then chunks stream out as glowing threads that weave into a tapestry: the file.

**Tech:** three.js (or OGL for a smaller bundle; compare both in the review). GPU particles (2-20k, scaled by device), additive blending, bloom (`UnrealBloomPass`, or a cheaper custom two-pass blur in card mode). Steering is computed in a vertex shader or with a small CPU boids model at most 2k agents; pick whichever meets the budget.

| Event | Visual |
| --- | --- |
| `session.start` | Dark sky; a ring of faint stars. Target point on the ring set from the address's first bytes. Palette chosen from the seed. |
| `connect.start` | 7 brighter seed stars glow; the flock spawns from the viewer's edge |
| `connect.peer` | Flock tightens around that seed; a soft pulse |
| `lookup.round` | Flock leaps a step closer to the target; `returned` new stars flicker in nearer the target (positions illustrative unless real XOR positions are available, see Step 3) |
| `lookup.fail` | One star dims; part of the flock scatters and rejoins |
| `datamap.verified` | Target star blooms; a faint loom of `total` warp threads appears |
| `chunk.done` | One thread of light flies from a nearby star into the loom, weaving one row. Thread brightness follows the rate. |
| `chunk.stall` | Flock circles slowly, waiting; the loom shimmers |
| `file.verified` | Finished tapestry flares, then settles into a still image seeded by the hash |
| `session.failed` | Flock disperses; the threads fade to grey |

**Tweakables:** particle count, flock cohesion and speed, bloom strength, palette (seeded or a fixed preset), weave pattern, camera drift.

**Review questions to ask:** palette direction; how literal the ring should be; whether the finished tapestry should be downloadable as an image.

---

### Step 2: Robot DJ (Playful 1)

**Idea:** an original robot DJ stacks disks (chunks) into a tower that becomes the file, scratching when things go wrong, with a crowd that cheers and a beat drop at the finish. This extends the Discord example (credits to riddim!); the robot must be an original design.

**Tech:** PixiJS v8, with the procedural robot in `characters/robot.ts` (head, visor face expressions, arms with two-bone IK to the decks), particle confetti, and an optional Tone.js beat (off until sound is enabled).

| Event | Visual |
| --- | --- |
| `session.start` | Empty stage, robot booting (visor flickers on). Tower outline sized to `total` once known. |
| `connect.start` / `connect.peer` | Robot plugs in cables to speakers labelled "seed"; each peer lights a speaker |
| `lookup.round` | Robot flips through a crate of records, "searching"; record sleeves fly past (one per node returned) |
| `lookup.fail` | Robot tosses a dud record over its shoulder |
| `datamap.verified` | Robot holds up the "setlist" (the DataMap): the tower blueprint appears |
| `chunk.done` | A disk spins on the deck, then is stacked onto the tower; small crowd bounce. Tempo follows the rate. |
| `chunk.stall` | Record scratch, robot taps its foot, looks at its wrist |
| `file.verified` | Robot checks the tower with a scanner beam (the hash), then the beat drops: lights and confetti |
| `save.done` | Robot bows; "Saved" sign |
| `session.failed` / `session.cancelled` | Needle scratch and a shrug / robot packs up the decks |

**Card mode:** robot and tower only; the crowd becomes a row of bobbing heads.

**Tweakables:** robot colour scheme, tower style (stacked disks or vinyl), crowd size, confetti amount, tempo range.

**Review questions to ask:** robot personality (cute, retro, sleek); whether the disks should map to visible chunk counts at high totals (group 10 chunks per disk above 200?); music on or off by default when sound is enabled.

---

### Step 3: Address-space map (Informative 1)

**Idea:** an accurate, readable view of how the browser finds a file, in the spirit of try.autonomi.com's node view. The address space is a ring; the file's address is marked; lookup rounds draw hops that converge on it.

**Tech:** d3 (scales, transitions) on SVG for card mode; Canvas 2D for full mode when there are many nodes.

**Placement:** first check whether peer IDs in the messages are 32-byte hex encodings of node addresses. If they are, place nodes by their real address (angle = first bytes of the address) and show their real XOR distance to the target. If not, place them illustratively and say so in the legend. Report which in the review.

| Event | Visual |
| --- | --- |
| `session.start` | Ring with a target marker at the file's address; legend |
| `connect.start` / `connect.peer` | Seed nodes appear; the connected peer turns solid |
| `lookup.round` | Hop line from the browser to `peerId`; `returned` candidate ticks appear; a side panel shows "Round i · k nodes returned · closest distance so far" |
| `lookup.fail` / `lookup.invalid` | Node turns red with the reason in a tooltip |
| `lookup.reseed` | Banner "Retrying through seeds" |
| `datamap.verified` | Close group highlighted around the target; "DataMap verified (n bytes)" |
| `chunk.done` | Progress arc around the ring; chunk count and rate. With Tier B, per-node "sending" states. |
| `file.verified` | Hash displayed; target turns green |

**Explain mode:** a toggle adds short captions explaining XOR distance, close groups and why each round gets closer.

**Tweakables:** label density, ring versus line layout, caption verbosity.

**Review questions to ask:** how technical the captions should be; whether to add a "distance over rounds" mini chart.

---

### Step 4: Hash garden (Artistic 2)

**Idea:** the file grows as a generative plant or flower. Its form comes from the address (and is finalised by the hash), so every file grows its own, and it ends as a portrait you can save.

**Tech:** Canvas 2D or WebGL; L-system or space-colonisation growth; a soft paper texture shader; bloom-free, painterly.

| Event | Visual |
| --- | --- |
| `session.start` | Seed in soil; species chosen from the address |
| `connect.*` | Roots reach toward seed points (one per authenticated seed) |
| `lookup.round` | Root tip extends toward a light source (the target); a failed query is a root that withers |
| `datamap.verified` | Sprout breaks the surface; the plant's full shape is now determined (`total` leaves or petals) |
| `chunk.done` | One leaf or petal grows; growth speed follows the rate |
| `chunk.stall` | Plant sways in a breeze; a bud waits |
| `file.verified` | Flower opens fully; colour finalised from the hash; "Save portrait" (PNG) in full mode |
| `session.failed` | Plant goes dormant (not dead), with a "try again" sprout |

**Tweakables:** species families, growth style, palette, paper texture, portrait frame.

**Review questions to ask:** botanical versus abstract; whether the portrait includes the file name and a short hash.

---

### Step 5: Ant colony (Playful 2)

**Idea:** on-brand (ANT, ant-node): scout ants lay pheromone trails to find the file, worker ants march from different nests carrying crumbs (chunks) to build a cake (the file), and the colony celebrates.

**Tech:** PixiJS; ants as tiny procedural sprites with leg-cycle animation; pheromone trails on a fading render texture; up to about 500 ants with pooling.

| Event | Visual |
| --- | --- |
| `connect.*` | Ant hill (the browser) opens; scouts head toward 7 nests at the edges (seeds) |
| `lookup.round` | Scouts follow and strengthen a trail toward the nest nearest the target; new nests appear (nodes returned) |
| `lookup.fail` | A scout bumps into a closed nest and turns around |
| `datamap.verified` | Scouts return with the recipe card; a cake outline appears |
| `chunk.done` | A worker arrives with a crumb and adds it to the cake (nest of origin illustrative) |
| `chunk.stall` | Workers mill about; one ant checks a tiny map |
| `chunk.retry` (Tier C) | A worker drops a crumb; another ant picks it up |
| `file.verified` | Inspector ant taps the cake with an antenna: a tick; victory dance |
| `session.failed` | Rain cloud; ants retreat into the hill |

**Tweakables:** ant count cap, trail visibility, cake style, nest art.

**Review questions to ask:** ant style (realistic, cartoon, pixel); whether the cake should become a recognisable file icon.

---

### Step 6: Chunk waterfall (Informative 2)

**Idea:** the browser developer tools' network tab, for chunks. One row per chunk, with timing bars, concurrency lanes and stalls, so technical viewers can see the download behaving.

**Tech:** Canvas 2D (virtualised rows for 3,000+ chunks); d3 scales for the time axis.

**Honesty:** in Tier A, only completion times are real; request start times and per-chunk phases are not. Show real completion ticks as solid marks on the time axis, and draw request→complete bars only when Tier B or C data is present. Tier C bars are hatched and labelled "illustrative timing". The header always shows real data: chunks done/total, rate, stalls, elapsed time.

| Event | Visual |
| --- | --- |
| connect / lookup / DataMap | Top "setup" rows: connect, each lookup round, DataMap fetch, with durations (real) |
| `chunk.done` | A tick at time t on the completion lane; the rows fill in |
| `rate` | A throughput sparkline above the waterfall |
| `chunk.stall` | Shaded band across the waterfall with its duration |
| Tier B/C detail | Per-chunk request→received→written bars, lanes by node, retries as broken bars |
| `file.verified` / `save.*` | Final rows: verify and save |

**Tweakables:** row height, grouping (by node or by order), time zoom, the illustrative layer on or off.

**Review questions to ask:** whether this is worth asking Autonomi for Tier B data (Appendix A); target audience (developers or curious users).

---

### Step 7: The file's song (Artistic 3)

**Idea:** an audio-reactive visualiser where the download composes music. The address chooses the key, scale and instrument palette; connections play notes, chunks are beats, the rate sets the tempo; visuals use feedback shaders in the spirit of classic music visualisers. Without sound, the visuals still work on their own.

**Tech:** Tone.js (or raw Web Audio with a small synth), a WebGL fragment-shader feedback loop (two ping-pong framebuffers), an `AnalyserNode` driving the shader uniforms.

| Event | Sound | Visual |
| --- | --- | --- |
| `session.start` | Drone in the seeded key | Slow feedback swirl |
| `connect.peer` | Bell note per peer | Ring burst |
| `lookup.round` | Rising arpeggio step | Zoom tunnel step |
| `lookup.fail` | Muted, detuned note | Brief colour inversion (soft) |
| `datamap.verified` | Chord change; beat starts | Kaleidoscope symmetry locks in |
| `chunk.done` | Percussion hit; melody note from the seed | Pulse, quantised to the beat |
| `rate` | Tempo (clamped 80-140 BPM) | Swirl speed |
| `chunk.stall` | Beat drops out; pad holds | Feedback slows |
| `file.verified` | Resolving cadence | Bloom and settle; title card with the file name |

**Rules:** quantise chunk hits to the beat grid (buffer events, never delay the download); limit polyphony; keep loudness under control (limiter on the master).

**Tweakables:** genre preset (ambient, synthwave, lo-fi, chiptune), shader preset, symmetry, volume.

**Review questions to ask:** genre direction; whether to offer "download the song" (a recording) at the end.

---

### Step 8: Pizza delivery (Playful 3)

**Idea:** scooters from different "kitchens" (nodes) race in with slices; the pie fills in order; a chef checks each slice; a late scooter apologises.

**Tech:** PixiJS; a top-down mini town; scooters on curved paths; procedural chef character.

| Event | Visual |
| --- | --- |
| `connect.*` | Order placed at the counter; phone rings at 7 kitchens |
| `lookup.round` | Map zooms toward the right part of town; kitchens open their shutters (nodes returned) |
| `lookup.fail` | A kitchen's sign flips to "Closed" |
| `datamap.verified` | Order ticket printed: "1 file, `total` slices" |
| `chunk.done` | A scooter arrives, slice goes in the pie; the chef does a chef's-kiss check |
| `chunk.stall` | "Sorry, traffic!" speech bubble; scooter honks |
| `file.verified` | Chef boxes the pie, stamps it "verified" |
| `save.done` | Box handed over: "Enjoy!" |
| `session.failed` | Pie on the floor; the chef shrugs |

**Card mode:** pie and chef close-up, scooters zipping in from the edges.

**Tweakables:** pizza style, number of visible scooters, slices per chunk at high totals.

**Review questions to ask:** cartoon style; whether the chef talks (speech bubbles) or stays silent.

---

### Step 9: Byte-flow diagram (Informative 3)

**Idea:** a live Sankey-style flow: bytes travel from nodes, through verify and decrypt, to the file on disk. Width shows throughput.

**Tech:** d3 + d3-sankey for layout; Canvas 2D for the moving particles along the links.

**Honesty:** in Tier A there is a single real flow (network → verify → file) with real total throughput; per-node splits are Tier B or C and must be labelled. The stage nodes (verify, decrypt, reassemble, save) are real stages of the process.

| Event | Visual |
| --- | --- |
| connect / lookup | Source nodes appear on the left (seeds, then nodes found) |
| `datamap.verified` | Pipeline appears: Fetch → Verify (BLAKE3) → Decrypt → Reassemble → Save |
| `chunk.done` / `rate` | Particles flow; link width = current bytes/s; totals at each stage |
| `chunk.stall` | Flow thins to a trickle; stall timer |
| `file.verified` | Whole-file check gate turns green |
| `save.*` | Final "Saved to disk" sink fills |

**Tweakables:** particle density, units (MB/s or Mbit/s), stage captions.

**Review questions to ask:** whether to merge this with the waterfall (Step 6) as two tabs.

---

### Step 10: Stained glass (Artistic 4)

**Idea:** the file is a stained-glass window, one pane per chunk. Panes appear unset and glowing, lock in when complete, and light pours through as the window fills; the finished window catches the sun.

**Tech:** Voronoi or lead-line tessellation (d3-delaunay) seeded by the address; WebGL for light rays and caustics, or Canvas 2D with gradient fills in card mode.

**Honesty:** completion order of individual panes is illustrative (Tier C); the count is real. Use Tier B/C `chunk.written` when present to show "fetched in parallel, written in order"; otherwise light pours through in completion order.

| Event | Visual |
| --- | --- |
| `session.start` | Empty lead tracery; design seeded by the address |
| connect / lookup | A candle is lit and carried toward the window (the search) |
| `datamap.verified` | Tracery completes with exactly `total` panes |
| `chunk.done` | A pane fills with coloured glass and clicks into place |
| `chunk.stall` | Clouds pass; light dims |
| `file.verified` | Sunbeam through the whole window; caustics on the floor |

**Tweakables:** tessellation style (Gothic, Art Nouveau, geometric), palette, light angle.

**Review questions to ask:** style direction; whether the window design should depict anything (abstract only by default).

---

### Step 11: If it fits, I sits (Playful 4)

**Idea:** cats push boxes (chunks) into a tower. One cat knocks a box off the edge, stares at you, then sheepishly puts it back. At the end the whole tower of cats loafs.

**Tech:** PixiJS; procedural cats with a few poses (walk, push, sit, loaf, stare); simple 2D box physics (a small custom solver or planck.js) limited to the visible boxes.

| Event | Visual |
| --- | --- |
| `connect.*` | Cats peek out of boxes at the edges of the screen (seeds) |
| `lookup.round` | A cat sniffs its way toward the tower site; new cats appear (nodes returned) |
| `lookup.fail` | A cat ignores you and washes itself |
| `datamap.verified` | Blueprint of the tower; cats line up |
| `chunk.done` | A cat pushes a box into place |
| `chunk.stall` / `chunk.retry` | The knock-off gag (no more than once per 20 seconds) |
| `file.verified` | All cats sit on top; "if it fits, it ships" sign |
| `session.failed` | Cats knock the whole tower over, unbothered |

**Tweakables:** cat breeds and colours, gag frequency, boxes per chunk at high totals.

**Review questions to ask:** meme wording on the signs; how often the gag should appear.

---

### Step 12: Verification ledger (Informative 4)

**Idea:** teaches content addressing and self-encryption: a ledger of chunk cards (address hash, hash check tick, decrypted, written), next to a tree showing DataMap → (nested DataMap) → chunks, ending with the whole-file hash comparison.

**Tech:** DOM + CSS (virtualised list) with SVG for the tree; no canvas needed.

**Honesty:** the DataMap, nested DataMap, chunk count, final hash and file address are real. Per-chunk addresses are not reported in Tier A: show placeholder cards ("chunk 37 · address hidden in this build") unless Tier B data exists, or derive nothing. Do **not** invent chunk hashes and present them as real.

| Event | Visual |
| --- | --- |
| `session.start` | "You asked for address `ab12…`. That address is the hash of the DataMap." |
| `datamap.fetch` / `datamap.verified` | Card: "DataMap fetched from the network, hashed, and the hash matches the address ✓" |
| `datamap.nested` | Tree grows a level: "This file's map was big enough to need a map of its own" |
| `chunk.done` | A chunk card ticks: received ✓ verified ✓ |
| `file.verified` | Final comparison: computed BLAKE3 = expected ✓, with both hashes |

**Explain mode:** a step-through for learners ("next" moves one event at a time, with replay traces).

**Tweakables:** verbosity, card density, the explain step-through on or off.

**Review questions to ask:** whether to include a "what if a node lies?" demonstration (a synthetic corrupted chunk that fails the check and is refetched, clearly labelled as a simulation).

---

### Step 13: Ink in water (Artistic 5)

**Idea:** each chunk is a drop of coloured ink in a fluid simulation. The swirls build into a rich marbled pattern; at the finish they settle into a calm, hash-seeded composition.

**Tech:** WebGL2 stable-fluids simulation (write a compact one, or adapt Pavel Dobryakov's WebGL-Fluid-Simulation, MIT licence, credited in `THIRD-PARTY.md`). Lower simulation resolution in card mode and on phones.

| Event | Visual |
| --- | --- |
| connect | Seven gentle currents start from the edges |
| `lookup.round` | A current curls toward the centre |
| `datamap.verified` | Water stills; the palette is chosen |
| `chunk.done` | An ink drop splashes in; colour from the seed; drop size follows the rate |
| `chunk.stall` | Slow drift |
| `file.verified` | Swirls settle into a marbled final image; "Save image" in full mode |

**Tweakables:** viscosity, dissipation, splat size, palette, simulation resolution.

**Review questions to ask:** calm versus energetic; whether this pairs well with the song (Step 7) as one combined skin.

---

### Step 14: Falling blocks (Playful 5)

**Idea:** a generic falling-block puzzle where chunks fall and lock into rows; each full row clears with a flash and an 8-bit blip. The score is MB/s; "LEVEL CLEAR" is the verified file. It must be an **original game look**: no names, logos, tetromino set or trade dress from existing games. Use rectangular chunk bricks of varied widths instead.

**Tech:** Canvas 2D at a low internal resolution (pixel-art scaling), a small chiptune sound kit (Web Audio, generated), CRT-scanline post effect (optional, off in reduced motion).

| Event | Visual |
| --- | --- |
| connect | "INSERT COIN" → "PLAYER 1 READY" |
| `lookup.round` | "SEARCHING…" level-select animation, one blip per round |
| `datamap.verified` | Playfield sized to `total` chunks; "LEVEL 1" |
| `chunk.done` | A brick falls and locks; full rows clear and score points |
| `rate` | Score readout shows MB/s; speed lines when fast |
| `chunk.stall` | "PAUSE?" blinking |
| `file.verified` | "LEVEL CLEAR" with the hash as a high-score entry |
| `session.failed` | "GAME OVER · CONTINUE?" (continue = retry) |

**Tweakables:** palette (several retro palettes), CRT effect, sound kit, bricks per chunk.

**Review questions to ask:** pixel scale; whether the "high score" should show download time.

---

### Step 15: Network health and privacy (Informative 5)

**Idea:** a dashboard of the session's connection health plus a clear explanation of privacy: what each node can and can't see.

**Tech:** DOM + CSS grid with small d3 charts (sparklines, bars).

| Panel | Data (tier) |
| --- | --- |
| Peers | Seeds authenticated, lookup peers answered, failures, invalid answers, reseeds (A) |
| Timing | Time to connect, to find the DataMap, to first chunk, total; time spent stalled (A) |
| Throughput | Chunks/s and bytes/s sparkline (A); per-node throughput (B only) |
| Integrity | DataMap verified, whole-file BLAKE3 verified (A) |
| Privacy | "What a node sees" toggle: your IP address and which chunk address you asked for (the chunk itself is encrypted); never the file name, the decrypted contents, or the DataMap of a private file. For public files, note that the DataMap is public on the network. (static explanation, checked against the current reference doc) |
| Bad-node demo | A labelled simulation where a corrupt chunk fails its check and is refetched (C) |

**Tweakables:** panel selection, compact or detailed layout.

**Review questions to ask:** whether this becomes a "details" drawer on the real download page; how much of the privacy text to show by default.

---

## 8. Repository layout

```
autonomi-download-viz/
├─ package.json
├─ vite.config.ts
├─ index.html                 # gallery
├─ skins.json                 # id, title, theme, status
├─ DECISIONS.md               # newest first
├─ THIRD-PARTY.md             # licences for libraries, fonts, adapted code
├─ src/
│  ├─ main.ts                 # gallery shell, controls, shared rAF loop
│  ├─ events/
│  │  ├─ types.ts
│  │  ├─ parse.ts             # SDK message → VizEvent (all regexes live here)
│  │  ├─ derive.ts            # rate, stall, bytes estimate
│  │  ├─ enrich.ts            # Tier C detail from Tier A + seed
│  │  └─ seed.ts              # address → 32-byte seed, seeded PRNG
│  ├─ sources/
│  │  ├─ live.ts  replay.ts  synthetic.ts  recorder.ts
│  ├─ ui/                     # transport, tweak panel, perf HUD, event log, capture
│  └─ skins/
│     ├─ types.ts
│     ├─ baseline/
│     ├─ murmuration/
│     ├─ robot-dj/
│     └─ …                    # one folder per skin: index.ts, characters/, shaders/
├─ traces/                    # *.jsonl (raw SDK events) + synthetic presets
├─ scripts/capture.ts         # Playwright: replay + record WebM/PNG
├─ reviews/                   # NN-<skin>.md + media/
└─ tests/                     # vitest: parser, derive, enrich, synthetic; Playwright smoke
```

---

## 9. After the gallery: integration (not part of this build)

Once David has picked the winners:

- Package each chosen skin as a standalone module with the same interface, loaded lazily by the Download Button's download page (and the optional in-place `button.js`), with the Baseline as the fallback.
- Choose by URL parameter or publisher setting (for example `&viz=robot-dj`), with a viewer toggle to switch to plain progress.
- Re-check performance on the real page with the WASM download running, and on Android.
- When the large-download SDK release (`pipeTo` with `onProgress`) lands, add its byte-level progress to the parser.

---

## Appendix A: asking Autonomi for richer progress (optional)

Several skins would be more truthful with structured, per-chunk progress. If David wants, draft an issue for `WithAutonomi/ant-browser-sdk` proposing an opt-in event such as:

```ts
{ phase: "downloading", unit: "records", completed, total,
  detail?: { kind: "chunk", index, bytes, attempt, peer?: string, state: "requested" | "received" | "verified" | "written" } }
```

The case for it: try.autonomi.com and third-party download pages could show live network activity; the current messages are free text and not a stable API; and the core already has the information (the test-only `setBrowserTrace` diagnostics). Note the privacy trade-off: exposing peer IDs to page scripts is a choice Autonomi may want to keep opt-in.

## Appendix B: verified sources

- ant-browser-sdk `main` at `1d572a2`: `src/types.ts` (`ProgressEvent`, `ProgressPhase`), `src/client.ts` (connect, download and save messages), `src/internal/progress.ts` (core messages forwarded with the current phase).
- ant-client `main`: `ant-core/src/browser/wasm_transport.rs` (lookup, DataMap, chunk and verify messages; `ProgressReporter`), `wasm_transport/diagnostics.rs` (`setBrowserTrace`, test builds only).
