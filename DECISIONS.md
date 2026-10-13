# Decisions

The current plan is whatever this file says. Newest first.

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
