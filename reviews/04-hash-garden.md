# Step 4 review: Hash garden (Artistic 2)

## What was built

- **The file grows as a plant on painted paper.** The address picks the species (daisy, branching shrub or lily), the stem's lean and curve, the leaf greens and where the light shines from. The same address always grows the same plant.
- **The story:**
  - **Connecting:** a seed sits in the soil. Its roots reach for the seed nodes, shown as pebbles placed along the soil by each seed's real address, and the root to the seed that answered turns gold.
  - **Finding the file:** the shoot feels its way up and a tap root searches downward (time-driven). Real lookup rounds, if any arrive, add root hairs, and a failed query is a withered hair.
  - **Map verified:** the sprout breaks the surface.
  - **Chunks:** at `chunk 0/N` a dashed pencil outline of the whole plant appears, with every leaf to come. Each chunk then grows one leaf, from the bottom up, and the stem follows. Leaves unfurl faster when chunks come faster.
  - **Stalls:** a breeze sways the plant and the bud trembles.
  - **Checking:** the bud glows gently.
  - **Verified:** the hash sets the flower's colours and petal count (daisies get 13, 21 or 34 petals), and the flower opens.
- **"Save portrait"** (full size) downloads a 1000 × 1380 PNG: the plant in a mat frame, with the file name, a short hash and "grown from an Autonomi download". Sample: `hash-garden-portrait.png`.
- **Endings:** *failed* leaves the plant dormant, not dead: sepia and drooping, with a small green "try again" shoot at the base. *Cancelled* folds the leaves and rests the plant.
- **Real (Tier A):** every phase and its timing; the seed count and which seed answered (with seed positions from the bundled seed addresses); lookup rounds and failures if reported; the chunk count and total (leaves, at most 60, so 155 chunks are 3 per leaf); the rate (growth speed); stalls; the hash (the flower); failure and cancel. **Illustrative:** the shoot's search for light, and where on the plant each leaf grows.

## How to view it

- **Preview:** https://davidmc0.github.io/autonomi-download-viz/#hash-garden
- **Worth a look:**
  - `?trace=medium-64mb&size=full` (stalls, then the bloom and "Save portrait");
  - `?trace=large&size=full&speed=8` (52 leaves);
  - `?trace=fail-mid&size=full` (dormant);
  - `?trace=quick&size=full&theme=dark` (a night garden with a moon).
- **Try the tweaks:** species, "chunks grow: petals" (one petal per chunk on a big flower head), palette (spring, autumn, ink) and portrait frame.

## Captures (`reviews/media/`)

| Trace | Size | Speed | Video | Final frame |
| --- | --- | --- | --- | --- |
| quick (real, 3 chunks) | card | 0.63× | `hash-garden-quick.webm` | `hash-garden-quick.png` |
| large (real, 155 chunks) | card | 10.05× | `hash-garden-large.webm` | `hash-garden-large.png` |
| flaky (synthetic) | card | 1.21× | `hash-garden-flaky.webm` | `hash-garden-flaky.png` |
| medium-64mb (real) | full | 1.48× | `hash-garden-medium-64mb-full.webm` | `hash-garden-medium-64mb-full.png` |
| fail-mid (synthetic) | full | 0.8× | `hash-garden-fail-mid-full.webm` | `hash-garden-fail-mid-full.png` |

There are also two stills. `hash-garden-variants.png` shows a 52-leaf daisy, a lily, petals mode and a dormant shrub. `hash-garden-portrait.png` is a saved portrait.

## Performance

| | Hash garden |
| --- | --- |
| Skin main-thread time per frame | **0.17-0.43 ms** (p95 0.70). The budget is 4 ms. |
| FPS, median / 5th percentile | 179 / 175 (headless Edge on an RTX 3070 laptop, uncapped; not a mid-range figure) |
| JS this skin adds (gzipped, lazy-loaded) | **7.4 kB** (no libraries) |

Leaf colours are cached, the paper texture is generated once as a tile, and there are no per-frame gradients. The smoke test passes for every trace on all five skins, and unit tests pass 57/57.

## Tweakables

| Parameter | Current |
| --- | --- |
| species | seeded by address (or daisy, branching shrub, lily) |
| chunks grow | leaves (or petals) |
| palette | seeded by address (or spring, autumn, ink) |
| paper texture | 0.6 |
| portrait frame | mat (or thin line, none) |
| portrait caption (name and short hash) | on |

## Shared change

- **The address helpers moved** to `src/events/xor.ts` (from the Address-space skin), so the garden can place the seed nodes by their real addresses too. Nothing visible changed.

## Open questions for David

1. **Botanical or abstract.** **A:** botanical (now): recognisable plants, painted leaves, a soil cross-section. **B:** more abstract: a looser, ink-and-wash plant with less literal soil. *I suggest A* for the gallery. "ink" is a halfway step you can try now.
2. **Portrait caption.** **A:** the file name, a short hash and "grown from an Autonomi download" (now). **B:** the short hash only (keeps file names private when shared). **C:** no caption. *I suggest A, with B a tweak away.* It's already a switch, so tell me the default.
3. **Many chunks.** **A:** leaves (at most 60, so chunks are grouped on big files), now. **B:** petals by default: a big flower head that fills petal by petal, which reads well in card size. *I suggest A:* the growing plant is the idea, and petals mode stays a tweak.
4. **Card framing.** The card shows the whole plant (about half scale) and pans down to the roots while connecting. **A:** keep it. **B:** crop tighter on the growing tip, which is larger but hides the roots and the base. *I suggest A.*

## Known gaps

- **On very big files the daisy gets tall and narrow** (about 50 leaves on one stem). The shrub and lily spread more. A species that branches more as the leaf count grows would help.
- **Seed pebbles show along the soil by address,** but their depth is decoration.
- **The portrait is drawn from the same scene** at 2.3× scale, so the paper grain is coarser there than on screen.
- The FPS figures aren't from a mid-range laptop or phone.
