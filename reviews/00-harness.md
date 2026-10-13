# Step 0 review: harness + Baseline

## What was built

- The gallery harness has three sources: **Live** (a real SDK download), **Replay** (recorded traces or a loaded file) and **Synthetic** (sliders). It also has the transport (play/pause, 0.25-20×, restart, step to next event, a scrub bar with event markers), a tweak panel with settings copy/paste, a perf HUD, a raw-versus-parsed event log, WebM recording, deep links, theme, reduced motion, sound with volume, and an illustrative-note toggle.
- The event pipeline runs: raw SDK events → `parse.ts` (all regexes) → derived `rate`/`chunk.stall` → optional Tier C enricher. Live runs and replays share it, and **a live run's timeline is identical to a replay of its recording** (checked automatically).
- **Baseline** is a plain Canvas 2D skin: phase label, progress bar, chunk counter and a scrolling event list. It runs on **real Tier A data only**, with nothing illustrative. Its accent colour is seeded by the address.
- Bundled traces: 5 real recordings (quick ×2, Three tones, Three tones via `openFile`, 64 MB nested) and 8 synthetic presets (`synthetic-small`, `synthetic-large`, `flaky`, `nested`, `fail-connect`, `fail-mid`, `cancel`, `huge`).

## How to view it

- **Preview URL:** not live yet (see Open question 1). Locally: `npm run dev`, then http://localhost:5173/#baseline?trace=quick
- Gallery links: `/#baseline?trace=medium-64mb`, `/#baseline?trace=flaky&size=full`, `/#baseline?trace=huge&speed=20`

## Captures (`reviews/media/`)

Each clip lasts about 30 s; the speed is chosen so the whole trace fits. Card size, light theme, recorded in headless Edge.

| Trace | Real/synthetic | Trace length | Speed | Video | Final frame |
| --- | --- | --- | --- | --- | --- |
| quick (lucky.jpg, 139 kB, 3 chunks) | real | 19.0 s | 0.63× | `baseline-quick.webm` | `baseline-quick.png` |
| **large → 64 MB stand-in** (17 chunks, nested) | real | 44.3 s | 1.48× | `baseline-medium-64mb.webm` | `baseline-medium-64mb.png` |
| flaky | synthetic | 32.0 s | 1.07× | `baseline-flaky.webm` | `baseline-flaky.png` |

## Performance

| | Baseline |
| --- | --- |
| Skin main-thread time per frame | **0.08-0.09 ms mean, 0.20 ms p95** (budget: 4 ms) |
| FPS, median / 5th percentile | 179 / 175 in headless Edge, which is **not** frame-capped, so this isn't a laptop figure. Please check the HUD on your laptop and phone. |
| JS this skin adds (gzipped) | **1.9 kB** |
| Gallery first load (gzipped) | 48.7 kB JS (mostly Tweakpane) + 2.2 kB CSS. The SDK (20 kB) and its 2.1 MB WASM load only when Live mode is used. |

There's no real `large` trace yet, so the FPS check over `large` at 1× still has to be run. Baseline was also run on `huge` (3,000 chunks) and every preset at 20× without problems.

## Tweakables (Baseline)

| Parameter | Current |
| --- | --- |
| event list | on |
| list lines (full size) | 12 |
| accent | seeded by address |
| bar smoothing | 0.25 |

## What the real SDK actually reports (0.1.2, 6 live runs)

**Seen, and in section 2:** `Authenticating 7 bootstrap nodes`, `Connected to authenticated peer <64-hex>`, `Fetching public DataMap <addr>`, `Fetching <addr>`, `Verified public DataMap (n bytes)`, `Resolving nested DataMap record <addr>` (64 MB file: 3 nested records), `Ready to stream …` (`openFile` only), `Downloaded chunk k/N`, `Verified complete <name> as <hash>`.

**Seen, but not in section 2:**
- `Initializing the Autonomi browser core` (connect, first event).
- **`Downloaded chunk 0/N`**: sent straight after the (nested) DataMap is resolved. This is the first moment the chunk total is known.
- `Downloaded <name>` with `completed`/`total` in **bytes**: the SDK's last report. With `download()`, this is the **only** source of the file size.
- `Opened <name>` (`openFile`).
- Each operation's terminal event repeats its last message. The parser ignores it, so the final chunk isn't counted twice.

**In section 2, but never seen:** `Iteration …`, `Query … failed`, `Ignoring invalid candidate …` and `Retrying lookup through configured seeds`. These strings are in the WASM, and the parser and tests cover them, but the DataMap fetch was **silent** in every run (2.4-13 s with no messages).

Other facts from the runs:
- Connecting took 2.3-3.0 s. The first authenticated peer was the same seed (`a1f073e0…`) every time. Peer IDs are 64-hex, which helps Step 3's real XOR placement.
- Chunks are about 4 MB (64 MB = 17 chunks). A 300-900 MB file will therefore be **about 75-225 chunks**, not "hundreds".
- The 64 MB run averaged 2.3 MB/s and had **two real stalls** of 8.1 s and 5.2 s.
- File names: the core reports `public-file-<address16>.bin`. A real name only comes from the page (a header or URL parameter).

### Sample event log (real, 64 MB, `traces/medium-64mb-1.jsonl`)

```
   t (s)  raw SDK message                                     → parsed event
   0.03  connect   Initializing the Autonomi browser core     → (none)
   0.03  connect   Authenticating 7 bootstrap nodes           → connect.start {seeds: 7}
   2.36  connect   Connected to authenticated peer a1f073e0…  → connect.peer
   2.36  connect   [succeeded]                                → connect.done
   2.36  download  Fetching public DataMap f6eeba94…          → datamap.fetch
   4.72  download  Verified public DataMap (327 bytes)        → datamap.verified {bytes: 327}
   4.72  download  Resolving nested DataMap record 2d521756…  → datamap.nested   (×3, each with a Fetching)
  15.39  download  Downloaded chunk 0/17                      → chunk.done {0, 17}   ← total known, rate starts
  16.02  download  Downloaded chunk 1/17                      → chunk.done {1, 17}
  19.25                                                       → chunk.stall {sinceMs: 16022}  (derived, first 250 ms tick after 3 s)
  24.10  download  Downloaded chunk 2/17                      → chunk.done {2, 17}
  …
  43.33  download  Downloaded chunk 17/17                     → chunk.done {17, 17}
  44.27  download  Verified complete public-file-f6eeba94….bin as ead68c28… → file.verified
  44.32  download  [succeeded]                                → session.done
```

## Acceptance checklist (5.7)

- [x] A live download of a sample address runs in the gallery with Baseline progressing (checked headlessly on mainnet).
- [~] `quick` is recorded twice and replays identically at any speed; scrubbing works (smoke test: scrub to the middle, then to the end, gives the same state as a straight run). **`large` is waiting for your address.**
- [x] Parser tests cover every message in section 2, plus unknown messages (become `log`, never throw): 52 unit tests.
- [x] The synthetic source produces all the presets in 4.3.
- [x] Tweak panel, settings copy/paste, perf HUD and capture (in-page WebM button + `npm run capture`) all work.
- [ ] Preview deploy: the workflow is ready, but it needs the GitHub repo (question 1).
- [x] This review package is written.

## Open questions for David

1. **Preview deploy.** `gh` isn't installed here, so I can't create the repo. **Please create an empty public repo `DavidMc0/autonomi-download-viz`** and set Pages → Source to "GitHub Actions". I'll push, and the gallery will be at `https://davidmc0.github.io/autonomi-download-viz/`.
2. **The `large` address.** Please send a 300-900 MB file's address (plus its name and size if you have them). I'll record it twice and redo the captures. Note: at about 4 MB per chunk it will be about 75-225 chunks.
3. **The silent "finding the file" stage.** Lookup rounds aren't reported in 0.1.2, so 2-13 s pass with no events between connecting and the DataMap. Options:
   - **A:** skins animate a calm "searching" idle driven only by elapsed time (honest).
   - **B:** skins show Tier C lookup hops, marked "illustrative".
   - **C:** also file the Appendix A issue asking Autonomi for structured lookup and chunk progress.

   *I suggest A + C, with B allowed only in playful skins, with the note.* This affects Murmuration, Address-space map, Ant colony and the others that map `lookup.round`.
4. **When the "blueprint" appears.** Several mappings key the loom, tower outline or tessellation off `datamap.verified` "with total panes", but the total only arrives with `chunk 0/N` (up to 11 s later for nested files). Options:
   - **A:** move the blueprint moment to `chunk.done {completed: 0}`, and show a "map verified" beat at `datamap.verified`.
   - **B:** keep it at `datamap.verified` with an unknown-size placeholder.

   *I suggest A,* applied as a shared rule for all skins.
5. **Bytes/s when the size is unknown.** With `download()`, the size arrives only at the end, unless the page knows it. Samples and the download page's `s` parameter do supply it. For bare addresses:
   - **A:** show chunks/s only.
   - **B:** estimate "about N MB/s" from about 4 MB per chunk.
   - **C:** call `openFile()` first to get the size, which costs an extra DataMap fetch (2-13 s).

   *I suggest A,* with the size used whenever the page provides it.
6. **Brief in the repo.** Shall I add the build brief to the repo as `BRIEF.md`, so future sessions work from the same text? *I suggest yes.* If you drop the file in the folder I'll commit it.

## Known gaps

- No preview URL yet (question 1), and no real `large` trace (question 2).
- The FPS figures are from headless Edge, not a mid-range laptop or Android phone.
- The in-page "Record WebM" button only works for canvas skins. DOM/SVG skins use `npm run capture` (Playwright video), as the brief allows.
- Live "Download and save" mode was not exercised headlessly, because it needs a save picker. The synthetic `save` option covers the save events in replays.
- There's no `nested` real trace under that name. The real 64 MB trace *is* nested, and the synthetic `nested` preset copies its ordering.
