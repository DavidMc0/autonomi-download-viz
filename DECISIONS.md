# Decisions

The current plan is whatever this file says. Newest first.

## 2026-10-14 · Step 2, Robot DJ (build choices, awaiting review)

- **Canvas 2D and Web Audio, not PixiJS and Tone.js.** After the OGL port, bundle size matters: the skin adds 9.9 kB gzipped with no libraries (PixiJS and Tone.js would add roughly 200 kB). Asked as review question 1.
- **Disks are grouped** so the tower never has more than 60 (155 chunks are 3 per disk). A ring on the deck shows each disk filling. Asked as review question 3.
- **The drop waits for the last disk to land,** like Murmuration's finale.

## 2026-10-14 · Murmuration approved and ported to OGL (David)

- **Murmuration approved.** It was ported from three.js to **OGL 1.0.11**: the skin now adds 28.9 kB gzipped instead of 144 kB. The bloom re-implements three's `UnrealBloomPass` and `OutputPass` exactly, so the look is unchanged.
- **Finale timing fix:** the flare and hash portrait now wait for the last thread to land (with escorts it could land after `file.verified`). "Save image" appears once the portrait has settled.
- **Step 2 (Robot DJ) started** on David's go-ahead.

## 2026-10-14 · Step 1 follow-up (David)

- **Squad size stays at 1/12** of the flock, and **the wait stays**: a thread launches only when its squad reaches the star.
- **Illustrative note moved off the visualisation (all skins).** It covered part of the view, so it now sits below the stage, under the progress text, in small muted type. It is still shown by default, and the gallery toggle still hides it. Review captures (stage only) no longer include it.

## 2026-10-14 · Step 1 review outcome (David)

- **Escort squads (new):** after the file is found, part of the flock flies out to each thread's star, rides in with the thread, then rejoins the main flock. Each of 8 squads owns 1/12 of the birds. A thread launches when its squad arrives, so each row lands about 0.7-1.6 s after its real `chunk.done`. Counts and totals stay real; the extra delay is purely visual. With no free squad (fast downloads, seeks, reduced motion), threads fly on their own as before. There is a tweak-panel switch for this.
- **Palette:** keep it seeded by address.
- **Ring:** keep the tilted 3D ring.
- **Save image:** added. A "Save image" button appears in full mode once the file is verified, and downloads the finished tapestry as a 1200 × 1003 PNG (`<name>-tapestry.png`).
- **Library:** port to OGL **after** the look is approved with the escort change.
- **Thread origins:** from stars all around the ring (now the default; "near the file" stays in the tweak panel).
- **Light theme:** keep the dusk-blue sky.

## 2026-10-14 · Step 1, Murmuration (build choices, awaiting review)

- **Step 0 approved** ("next"). Baseline is marked approved in `skins.json`.
- **three.js r186.1, not OGL, for the first version.** It's quicker to iterate the look with `UnrealBloomPass`. A matching OGL bundle measured about 16 kB gzipped against three.js's about 135 kB, so a port is offered in the review (question 4).
- **The flock is GPU-procedural, not boids.** Each particle trails a CPU-steered centre path (a 64-sample history texture, about 1.3 s long) and folds through a shared wave field, with moving density bands. The cost is the same at 2k or 20k particles, with no per-agent CPU work.
- **One WebGL context is shared across remounts.** Seeking remounts the skin, so the renderer (and its compiled shaders) is kept, and disposed 4 s after the skin is left.
- **Shared fixes made while building:** the scrub bar no longer throws in capture mode (it was 0×0), the smoke test loads each case from a blank page (a racing reload could test the previous trace), and `describe()` no longer says "0 lookup rounds so far".

## 2026-10-14 · Step 0 follow-up (David)

- **Stall threshold raised from 3 s to 5 s.** Real large downloads had 28-40 gaps of 3 s or more in 5 minutes, but only 10-11 of 5 s or more. Shorter pauses show only as a falling rate. The synthetic `flaky` stalls were lengthened to 7 s and 9 s to match.
- **"Checking" moment (rule for all skins):** whole-file verification takes about 10 s on a 650 MB file and sends no events, so every skin shows a clear, ongoing "checking" beat between the last chunk and `file.verified`. Baseline already shows "Verifying" with the full bar.

## 2026-10-13 · Step 0 review outcome (David)

- **Silent "finding the file" stage (rule for all skins):** lookup rounds aren't reported in SDK 0.1.2, so every skin animates a calm "searching" idle between `connect.done` and `datamap.verified`, driven only by elapsed time. Playful skins may also show illustrative (Tier C) lookup hops, with the illustrative note. Skins still react to real `lookup.*` events if a future SDK sends them. An Appendix A issue asking Autonomi for structured lookup and chunk progress is to be drafted.
- **Blueprint moment (rule for all skins):** the moment the file's shape is known (the loom, tower outline, tessellation, playfield, "N slices" ticket) is `chunk.done` with `completed: 0`, because that is when the total is first known. `datamap.verified` gets its own smaller "map verified" beat.
- **Speed display:** show MB/s only when the size is known (trace header or the page's `s` parameter); otherwise show chunks/s. No estimates from typical chunk sizes.
- **Brief stays out of the repo** (the repo is public) until David has checked it for anything private. Ask again at the end of the next session.
- **`large` trace:** `devuan_chimaera_4.0.0_amd64_cd4.iso` (David's upload, about 633 MB). It was recorded without a size and the header size was then set from the SDK's exact final byte count, which is what a page that knows the size would supply.

## 2026-10-13 · Step 0 (harness)

- **Repo and hosting (David):** a new repo, `autonomi-download-viz`, separate from Autonomirror until integration. Previews use GitHub Pages, like Autonomirror: one URL, updated on each push to `main`, so there are no per-push preview URLs.
- **`large` trace (David):** David will supply the address of a 300-900 MB file. Until then, `large` deep links fall back to the synthetic stand-in (`synthetic-large`, 210 chunks), and review captures use the real 64 MB trace in its place.
- **SDK pinned exactly at 0.1.2** (ant-client `9858af5`). The version is recorded in every trace header.
- **Live mode reconnects for every run** (it closes the previous client first). That way each live run shows the whole story from "connecting", and there is still only one client on the page.
- **Live mode uses `download()` (in memory) by default.** `openFile().stream()` was tested: it reports the size and chunk count up front ("Ready to stream"), but then sends **no chunk progress at all**. "Download and save" is offered as an option.
- **Chunk fetching starts at "Downloaded chunk 0/N", not at "Verified public DataMap".** In real runs a nested DataMap is resolved after the top-level one is verified (about 11 s for the 64 MB file), and only then does the core report `0/N`. The parser keeps `chunk.done` with `completed: 0` as the moment the total becomes known; rate and stall derivation start there.
- **`chunk.stall.sinceMs` is the trace time of the last progress**, i.e. when the stall began.
- **Derived events run on a fixed 250 ms grid of trace time**, so a live run and a replay of its recording produce identical timelines (checked by `npm run smoke -- --live`).
- **Names:** the core names public files `public-file-<address>.bin`. A name from the trace header (sample list, or later the download page's `n` parameter) takes priority.
- **Unknown messages** become `log` events. The parser only reads `running` events, because each operation's terminal event repeats its last message.
- **Synthetic traces** are made of the same raw message strings as the SDK and go through the same parser. Their per-chunk detail is flagged Tier C. The enricher stays passive when a source supplies its own detail.
- **Added to the skin interface:** `audioOut` (a gain node carrying the volume control), an optional `illustrativeNote` (shown by the harness), and an optional `stats()` for the perf HUD.
