# Step 3 review: Address-space map (Informative 1)

## What was built

- **A map of how the browser finds a file.** Every node and file has a 32-byte address on one ring (00… at the top, clockwise to ff…). It shows:
  - the file's address (▼);
  - the 7 seed nodes the SDK ships with (□), with the one that answered filled in;
  - each lookup round as a line from "you (browser)" to the node it asked;
  - the DataMap records (◆);
  - a progress arc for the chunks, then the verified hash.
- **Placement is real.** I checked the brief's question on mainnet: peer IDs *are* addresses in the same space. A `findClosest` for the 64 MB file returned 20 nodes sharing 5-11 leading bits with its address, where random IDs would share about 1. A control target behaved the same way. So nodes sit at their true addresses, and "closer" is real XOR distance.
- **"Closer each round" chart and zoom strip.** The panel plots each queried node's shared leading bits over time, with a best-so-far line, and failed queries as ✕. Under the ring, a zoom strip stretches the slice of the ring around the file. Nested shades mark each further shared bit, so you can see each round landing in a smaller slice. The panel also shows the status, key facts, explain captions and a legend.
- **Real (Tier A):**
  - the file address;
  - the bundled seed addresses (taken from the SDK 0.1.2 WASM) and the peer that answered;
  - every lookup round, failure, invalid answer and reseed, when the source reports them;
  - the DataMap record addresses (`Fetching…` and `Resolving nested…`);
  - chunk count, rate, stalls, verification, hash, failure and cancel.
- **Illustrative:** SDK 0.1.2 doesn't report a download's own lookup. When no rounds arrive, the map draws a typical one (dashed, hollow, seeded by address), plus a typical close group. The legend, the panel ("Lookup: not reported (typical one drawn)") and the illustrative note all say so. Real rounds, if any arrive, replace it.

## How to view it

- **Preview:** https://davidmc0.github.io/autonomi-download-viz/#address-space
- **Real lookup:** `/#address-space?trace=lookup-64mb&size=full&speed=4`. This new real trace has a closest-node lookup first: 15 rounds and 44 failed queries over 80 s, with the closest node sharing 11 bits. Then the download runs.
- **Typical (download only):** `?trace=medium-64mb&size=full` shows the dashed typical lookup, the 3 real DataMap records and the progress arc.
- **Other views:** `?trace=flaky&size=full` (synthetic: rounds, failures, an invalid answer, a reseed); `?trace=fail-mid`; `?trace=cancel`. Hover a node in full size for its address, shared bits, round and failure reason.

## Captures (`reviews/media/`)

| Trace | Size | Speed | Video | Final frame |
| --- | --- | --- | --- | --- |
| quick (real, 3 chunks) | card | 0.63× | `address-space-quick.webm` | `address-space-quick.png` |
| large (real, 155 chunks) | card | 10.05× | `address-space-large.webm` | `address-space-large.png` |
| flaky (synthetic) | card | 1.21× | `address-space-flaky.webm` | `address-space-flaky.png` |
| lookup-64mb (real lookup, then download) | full | 4.01× | `address-space-lookup-64mb-full.webm` | `address-space-lookup-64mb-full.png` |
| quick | full | 0.63× | `address-space-quick-full.webm` | `address-space-quick-full.png` |

## Performance

| | Address-space map |
| --- | --- |
| Skin main-thread time per frame | **0.14-0.17 ms** in card size, **0.57-0.66 ms** in full size (p95 0.90). The budget is 4 ms. |
| FPS, median / 5th percentile | 179 / 175 (headless Edge on an RTX 3070 laptop, uncapped; not a mid-range figure) |
| JS this skin adds (gzipped, lazy-loaded) | **9.3 kB** (no libraries) |

The smoke test passes for every trace on all four skins, including the new `lookup-64mb`. Unit tests pass 57/57.

## Tweakables

| Parameter | Current |
| --- | --- |
| layout | ring (or line) |
| explain captions | short (or off, detailed) |
| labels | key nodes (or none, all) |
| closer-each-round chart | on |
| draw a typical lookup when none is reported | on |

## Shared changes (affect the harness, not other skins' looks)

- **New events `lookup.start` and `lookup.done`**, from "Finding nodes closest to …" and "Closest-node lookup complete" (previously ignored). A lookup's completion no longer ends the session.
- **New live mode, "Find the closest nodes first, then download".** It runs `client.findClosest(address)`, which *does* report its rounds, then `download()`. It's opt-in, because it adds about a minute and some network load. The trace header says it was a separate lookup.
- **New real trace, `lookup-64mb-1`,** recorded in that mode.
- **Synthetic lookups now converge:** each answering peer shares more leading bits with the file than the last, as on the real network. Before, the peers were random. Only the peer IDs changed: every timing in the synthetic traces is the same as before.

## Open questions for David

1. **Real lookups.** A download's own lookup takes 1-13 s and isn't reported. A `findClosest` beforehand shows real rounds but takes about 80 s, so its timing isn't the download's. **A:** keep the opt-in lookup mode for demos, and show the dashed typical lookup in normal use. **B:** drop the lookup mode and use only the typical one. **C:** A, plus ask Autonomi (Appendix A, later) to report the download's own rounds. *I suggest A* (C when you want to revisit the SDK request).
2. **Captions.** **A:** short by default (now). **B:** detailed by default (more about XOR, close groups and halving the search). **C:** off by default. *I suggest A*, since detailed is one click away.
3. **Chart axis.** **A:** time (now): it shows the 5 s grace-period gaps and the long tail. **B:** query order: evenly spaced and tidier, but the waiting is hidden. *I suggest A.*
4. **Libraries.** The brief suggests d3 and SVG. I used plain Canvas 2D with hover hit-testing: 9.3 kB, under 1 ms per frame. **A:** keep Canvas. **B:** d3 and SVG (easier DOM tooltips and accessibility; about 30 kB more). *I suggest A.*
5. **Typical lookup on downloads.** **A:** keep the dashed typical rounds and close group (now). **B:** show only a "searching" pulse at the file, with no invented nodes. *I suggest A:* it explains the idea, and it's clearly marked. B is the strictest reading of "honest".

## Known gaps

- **Chunk addresses aren't reported,** so chunks show only as the progress arc. Each one really lives at its own address all round the ring, and the detailed caption says so.
- **The nodes a round returns aren't reported,** only how many, so the panel shows the count rather than drawing candidate positions.
- **There are no per-node "sending" states** (Tier B). They would need Autonomi to report which node served each chunk.
- **Tooltips need a mouse.** They don't work on touch, and card size has none.
- **Synthetic traces use made-up seed IDs,** so the connected seed there isn't one of the 7 bundled ones.
- The FPS figures aren't from a mid-range laptop or phone.

### Resolved (2026-10-15)

All five suggestions were accepted as built: the opt-in lookup mode plus the dashed typical lookup, short captions, a time axis, Canvas 2D, and the typical lookup and close group kept. Nothing changed.
