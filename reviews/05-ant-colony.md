# Step 5 review: Ant colony (Playful 2)

## What was built

- **A top-down cartoon colony on sandy ground.** Your browser is the ant hill in the middle. Nests round the edge are the network's nodes, and a cake on a plate is the file.
- **The story:**
  - **Connecting:** the hill opens and scouts head for the 7 seed nests. These sit round the edge by each seed's real address. The seed that answered flies an orange flag.
  - **Finding the file:** scouts keep running trails toward the nest nearest the file's direction, laying pheromone that fades over time (time-driven). Real lookup rounds, when reported, add a new nest at the answering node's real angle and send a scout down the trail. A failed query is a closed nest (✕) that the scout bumps into and turns away from.
  - **Map verified:** a scout brings the recipe card (the DataMap) and pins it by the plate.
  - **Chunks:** at `chunk 0/N` a dashed outline of every cake piece appears. Workers march in from nests all round the edge carrying crumbs, and queue by the plate. On each real `chunk.done` the nearest one hops up and adds its crumb, so the count stays exact. If none is waiting, one pops out of the hill. The rate sets how many workers are on the way.
  - **Stalls:** the queue mills about, and an ant comes out of the hill to study a tiny map.
  - **Retries (Tier C):** a worker drops its crumb, pauses, and picks it up again.
  - **Checking:** an inspector ant in a blue cap walks round the cake.
  - **Verified:** a cherry coloured by the hash goes on top, a green tick appears, and the colony does a victory wiggle.
- **Endings:** *failed* brings a rain cloud, everyone retreats into the hill, and the cake greys. *Cancelled* has everyone walk home and the hill close.
- **Real (Tier A):** every phase and its timing; the seed count and seed positions (the bundled seed addresses) and which seed answered; lookup rounds and failures when reported (nest angles are real addresses); the chunk count and total (cake pieces, at most 60, so 155 chunks are 3 per piece); the rate; stalls; the hash (the cherry); failure and cancel. **Illustrative:** the scouts' search while the file is found, which nest each crumb comes from, how far in a node's nest sits, and dropped crumbs.

## How to view it

- **Preview:** https://davidmc0.github.io/autonomi-download-viz/#ant-colony
- **Worth a look:**
  - `?trace=medium-64mb&size=full` (stalls, the map-reader, the inspector);
  - `?trace=lookup-64mb&size=full&speed=4` (real lookup: a cluster of node nests toward the file, failed ones closed);
  - `?trace=fail-mid&size=full` (rain);
  - `?trace=large&size=full&speed=8`.
- **Try the tweaks:** "cake style: file icon" and "nest art: acorn houses".

## Captures (`reviews/media/`)

| Trace | Size | Speed | Video | Final frame |
| --- | --- | --- | --- | --- |
| quick (real) | card | 0.63× | `ant-colony-quick.webm` | `ant-colony-quick.png` |
| large (real, 155 chunks) | card | 10.05× | `ant-colony-large.webm` | `ant-colony-large.png` |
| flaky (synthetic) | card | 1.21× | `ant-colony-flaky.webm` | `ant-colony-flaky.png` |
| lookup-64mb (real lookup) | full | 4.01× | `ant-colony-lookup-64mb-full.webm` | `ant-colony-lookup-64mb-full.png` |
| medium-64mb (real) | full | 1.48× | `ant-colony-medium-64mb-full.webm` | `ant-colony-medium-64mb-full.png` |
| fail-mid (synthetic) | full | 0.8× | `ant-colony-fail-mid-full.webm` | `ant-colony-fail-mid-full.png` |

There are also three stills. `ant-colony-real-lookup.png` shows the real lookup. `ant-colony-rain-file-acorn.png` shows failure with the file icon and acorn houses. `ant-colony-cards.png` shows four card states.

## Performance

| | Ant colony |
| --- | --- |
| Skin main-thread time per frame | **0.37-0.62 ms** (p95 up to 1.0 ms in the rain ending). The budget is 4 ms. |
| FPS, median / 5th percentile | 179 / 164-179 (headless Edge on an RTX 3070 laptop, uncapped; not a mid-range figure) |
| JS this skin adds (gzipped, lazy-loaded) | **6.9 kB** (no libraries) |
| Ants | pooled (400 slots, 220 cap by default). Scouts are capped at 14, and drawn node nests at 24. |

The smoke test passes for every trace, and unit tests pass 57/57. A 1× perf run of `large` wasn't captured: at 1× the 300 s trace outlasts the capture script's timeout. The numbers above come from the faster captures, which are busier per frame.

## Tweakables

| Parameter | Current |
| --- | --- |
| ant count cap | 220 |
| trail visibility | 0.8 |
| cake style | layer cake (or file icon) |
| nest art | earth mounds (or acorn houses) |

## Open questions for David

1. **Libraries.** The brief names PixiJS. As agreed for Robot DJ, I used Canvas 2D: 6.9 kB, under 1 ms per frame with a couple of hundred ants. **A:** keep it. **B:** PixiJS, only worth it for thousands of ants. *I suggest A.*
2. **Ant style.** **A:** cartoon top-down (now): three body segments, tripod-gait legs, wiggling antennae. **B:** pixel-art ants (chunky and retro, but we already have a pixel skin coming in Step 14). **C:** more realistic (thinner, longer legs, less cute). *I suggest A.*
3. **Cake or file icon.** **A:** a three-tier layer cake (now), with the file icon as a tweak. **B:** the file icon by default (a document filling with bricks), which says "file" more literally. *I suggest A:* "the ants are baking your file" is the joke.
4. **Lookup nests.** A busy real lookup can report about 90 nodes. I draw at most 24 node nests, at their real angles, scattered inward. **A:** keep that. **B:** show all, smaller. **C:** show only the nodes that answered (no closed nests). *I suggest A.*

## Known gaps

- **The seed nests' angles are real,** but node nests are scattered inward for space, not by XOR distance. Address-space is the skin for exact geometry.
- **A dropped crumb (Tier C retry) is picked up by the same ant,** not a second one, which keeps the pooling simple.
- **The cake pieces get small on big files** (60 pieces fit in fixed tiers). In card size they read as a striped cake rather than separate crumbs.
- **There's no sound** (none was asked for). A crunchy march or a party horn could come later.
- The FPS figures aren't from a mid-range laptop or phone.

## Follow-up (2026-10-15): David's answers applied

- **Canvas 2D, the cartoon ants and the layer cake all stay.**
- **Lookup nests: only nodes that answered get one** (up to 24). A failed query no longer draws a closed nest. A scout runs toward that node's real direction, gets no reply, and turns back halfway, so the miss still shows. The lookup capture and `ant-colony-real-lookup.png` were re-recorded. The smoke test passes.
