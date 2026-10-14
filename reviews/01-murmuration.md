# Step 1 review: Murmuration (Artistic 1)

## What was built

- A slowly turning **ring of faint stars** (the address space) is seen at an angle. A **flock of light** (3,500 particles in card mode, 9,000 in full) gathers at the seed stars, searches its way to the **file's point on the ring**, and circles there while **chunks fly into a loom as threads of light**. Each chunk weaves one row band of a seeded tapestry. A **scan sweeps the tapestry** while the whole file is checked. Then it **flares and settles into a portrait of the file's hash** (a mirrored 16 × 16 motif made from all 256 bits).
- **Real (Tier A):** every phase and its timing, the chunk count and total, the rate (thread and row brightness), stalls, the hash, and **two real positions on the ring**: the connected peer and the file are placed by the first 16 bits of their addresses.
- **Illustrative:** the other seed stars and the ring's stars, the flock's path while searching (SDK 0.1.2 sends no lookup rounds, so this is the shared time-driven "searching" idle), and which star each thread leaves from. The illustrative note says so.
- **Endings:** *failed* turns the tapestry grey and scatters the flock. *Cancelled* leaves the unfinished piece, dimmed, and the flock flies away the way it came. *Connection failed* disperses the flock before any loom appears.
- Built with **three.js r186** (WebGL2) and `UnrealBloomPass`. The flock is GPU-procedural: particles trail a CPU-steered path and fold through a shared wave field with moving density bands.

## How to view it

- **Preview:** https://davidmc0.github.io/autonomi-download-viz/#murmuration (live after this push)
- Locally: `npm run dev`, then http://localhost:5173/#murmuration?trace=quick
- Worth a look: `/#murmuration?trace=large&speed=4&size=full`, `/#murmuration?trace=flaky&size=full&theme=dark` (lookup flickers, failed queries, two stalls), `?trace=fail-mid`, `?trace=cancel`, `?trace=fail-connect`

## Captures (`reviews/media/`)

Card size, light theme, headless Edge. Each clip lasts about 30 s.

| Trace | Trace length | Speed | Video | Final frame |
| --- | --- | --- | --- | --- |
| quick (lucky.jpg, 3 chunks, real) | 19.0 s | 0.63× | `murmuration-quick.webm` | `murmuration-quick.png` |
| large (devuan ISO, 155 chunks, real) | 301.6 s | 10.05× | `murmuration-large.webm` | `murmuration-large.png` |
| flaky (synthetic) | 39.0 s | 1.3× | `murmuration-flaky.webm` | `murmuration-flaky.png` |

The three final frames show three different palettes and three different hash portraits, because each address seeds its own look.

## Performance

| | Murmuration | Baseline |
| --- | --- | --- |
| Skin main-thread time per frame, `large` at 1× (card) | **0.37 ms mean, 0.50 ms p95** (budget: 4 ms) | 0.09 / 0.20 ms |
| Same, full size (9,000 particles) | **0.38 ms mean, 0.50 ms p95** | |
| FPS, median / 5th percentile | 179 / 179 (uncapped headless, see below) | 179 / 175 |
| JS this skin adds (gzipped, lazy-loaded) | **144 kB** (three.js about 135 kB, skin about 9 kB) | 1.9 kB |

- **These FPS figures are not a mid-range laptop.** Headless Edge here renders on the real GPU (an RTX 3070 laptop) and isn't frame-capped. The main-thread figure is the reliable one: about a tenth of the 4 ms budget. GPU cost (bloom plus additive particles) still needs your laptop and phone: please open the HUD (`hud=1`) on both.
- The skin allocates nothing per frame. Seeking reuses one WebGL context and its compiled shaders, so scrubbing stays quick, and the context is released 4 s after you leave the skin.
- **OffscreenCanvas in a worker was not tried:** the main-thread cost is already under 0.5 ms, so a worker would add complexity without much gain.
- The smoke test passes on all 9 traces for both skins (ending, scrub then end, console clean). Reduced motion was checked: rows fade in without flying threads, nothing flashes, and the camera holds still.

## Tweakables

| Parameter | Current |
| --- | --- |
| particles | auto (3,500 card, 9,000 full, halved on touch devices); 2k / 5k / 10k / 20k |
| flock cohesion | 1.0 |
| flock speed | 1.0 |
| bloom strength | 0.7 |
| palette | seeded by address (or night, dawn, aurora, ember) |
| weave pattern | seeded by address (or twill, diamond, stripes) |
| camera drift | 0.35 |
| thread origins | near the file (or across the ring; see question 5) |

## Open questions for David

1. **Palette direction.** **A:** seeded by address (now; every file looks different). **B:** one fixed palette, e.g. "night" (blue, silver and gold), so the brand stays consistent. **C:** seeded, but only within night-sky hues. *I suggest A:* the seeded look is the point of an artistic skin, and the presets stay in the tweak panel.
2. **How literal the ring is.** **A:** a tilted 3D ring with the peer and file at their real positions (now). **B:** a flat circle seen face-on, more like a diagram of the address space. **C:** no ring, just a sky of stars. *I suggest A:* it reads as "a place in a network" without being a diagram, and Step 3 (Address-space map) is the literal one.
3. **Download the finished tapestry as an image?** **A:** yes, a "Save image" button in full mode after verification (a PNG of the finished tapestry). **B:** no. *I suggest A:* each file's portrait is unique, and it's a nice thing to keep.
4. **three.js or OGL.** three.js adds **144 kB** gzipped. The same features in OGL measured about **16 kB**, plus a hand-written two-pass bloom, so about 27 kB in all. **A:** keep three.js. **B:** port to OGL once the look is approved. *I suggest B* if Murmuration might ship on the download page, where 144 kB is a lot for a progress animation. A is fine if it stays in the gallery.
5. **Where the threads come from.** **A:** from stars near the file's point (the brief, now). **B:** from stars all around the ring. *I suggest B:* a file's chunks really are stored all over the network, and threads arriving from every direction look richer. It's a one-setting change.
6. **Light theme.** Additive light needs a dark ground, so the light theme now uses a dusk-blue sky, not white. **A:** keep dusk blue. **B:** the same night sky in both themes. **C:** a true light version (dark flock on a pale sky, no bloom). *I suggest A.*

## Known gaps

- **No sound.** The brief doesn't give this skin any, so none was added.
- **"The download wins" check not run.** Comparing a live chunk rate with and without the skin needs repeated live runs, and network variance is far above 5 %. It's worth doing once on your laptop with the HUD.
- **The card bloom is `UnrealBloomPass` at card resolution,** not a cheaper custom blur. Its GPU cost is unmeasured on mid-range hardware (see Performance).
- **Lookup visuals are exercised only by the synthetic `flaky` trace.** These are the flickering new stars on `lookup.round` and the part-scatter on `lookup.fail`. Real 0.1.2 downloads never send these events.
- `openFile()` streams (`tones-stream`) send no chunk progress, so the loom appears and fills all at once at verification.
- The captures are card size and light theme only. Full size and dark theme were checked as stills during the build.

## Shared changes (affect every skin)

- The scrub bar no longer throws on every frame in capture mode, where it is hidden and 0 × 0. This was the source of console errors in captures.
- The smoke test now loads each case from a blank page. Before, a racing reload could run a test against the previous trace and still report "ok".
- The screen-reader text no longer says "Finding the file, 0 lookup rounds so far" (rounds never arrive in 0.1.2). It now says "Connected. Finding the file."
- Baseline is marked **approved** in the gallery list.

---

## Follow-up (2026-10-14): David's answers applied

**What changed**
- **Escort squads.** Once the file is found, each shooting star now starts with part of the flock (one of 8 squads, each 1/12 of the birds) peeling off and streaming out to the star's place on the ring. When the squad arrives, the star launches and the squad rides in with it, just behind its head, to the loom. Then the squad loops back and blends into the main flock. Each squad has its own row in the flock's path texture, so this adds no per-particle CPU work. Skin time is unchanged: 0.42-0.44 ms per frame in the captures.
- **Timing:** a thread now launches when its squad reaches the star, so each row lands about 0.7-1.6 s after the real `chunk.done` (longer for stars across the ring). Counts and totals are still real.
- **When there's no squad:** if all 8 squads are out (fast downloads or high replay speeds), after a seek, or with reduced motion, threads fly unescorted as before. "escort squads" in the tweak panel turns the feature off.
- **Threads come from all around the ring** (the default now).
- **Save image:** in full mode, a "Save image" button appears once the file is verified. It renders the tapestry on its own, straight on, and downloads it as `<name>-tapestry.png` (1200 × 1003). It was tested in both themes; the export is brightened slightly to stand in for the on-screen bloom.
- Palette, ring and dusk-blue sky are unchanged, as agreed. The **OGL port waits** until you approve this look.
- New captures replace the old ones (`murmuration-quick/large/flaky.webm` and `.png`). The smoke test passes 38/38.

**To look at:** `/#murmuration?trace=medium-64mb&size=full` shows single escorts clearly (chunks arrive every 1-5 s). `?trace=large&speed=4` shows several at once.

**Open questions**
1. **Squad size.** Each squad is 1/12 of the flock now. **A:** keep it. **B:** bigger (1/8), more dramatic, but the main flock thins out when several squads are out. **C:** smaller (1/16), subtler. *I suggest A.*
2. **Row delay.** Rows land 0.7-1.6 s after the real chunk. **A:** keep it, since the escort is the point. **B:** start the thread at once and let the squad chase it from the flock (no delay, but the squad never reaches the star first). *I suggest A:* the delay is short and steady, and the progress text stays exact.

### Resolved (2026-10-14)

- Squads stay at 1/12 of the flock, and the thread waits for its squad.
- The illustrative note is no longer drawn over the visualisation, for all skins. It now sits below the stage, under the progress text, as "Illustrative: the flock's path and the star positions". The captures were re-recorded without it.
