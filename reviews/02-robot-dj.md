# Step 2 review: Robot DJ (Playful 1)

## What was built

- **An original robot DJ** (`characters/robot.ts`), drawn procedurally. It has a rounded "radio" body with a speaker-grille chest whose LEDs pulse on the beat, a screen head with LED expressions (boot, focus, happy, bored, worried, wow, sad, wink), headphones, an antenna bulb, and two-bone IK arms that reach for the decks, the crate, its wrist or the tower.
- **The story:**
  - **Connecting:** the robot boots (its visor flickers on) and plugs cables into the "SEED" speakers. The connected peer lights its speaker.
  - **Finding the file:** it digs through a record crate (time-driven).
  - **Map verified:** it holds up a ticked setlist.
  - **Chunks:** each disk spins on a deck and flies onto a tower inside the dashed blueprint (which appears at `chunk 0/N`), with a small crowd bounce. The tempo follows the rate.
  - **Stalls:** a record scratch, then the robot checks its watch and taps its foot.
  - **Checking:** the robot scans the finished tower with a beam. Then the beat drops: coloured lights, confetti, the crowd's hands go up, and the hash appears on the tower.
  - **Save:** "SAVING…", then "SAVED" with a bow.
- **Endings:** *failed* throws the tonearm across the record, the robot shrugs and the tower greys out. *Cancelled* has the robot pack up (the deck lids close), wave, and power down its visor. *Connection failed* is a shrug with no tower.
- **Real (Tier A):** every phase and its timing, seed count and peer, chunks and total (disks), rate (tempo), stalls, verification, hash, save, failure and cancel. **Illustrative:** the crate search (0.1.2 sends no lookup rounds), the crowd, and which deck each disk spins on. Real `lookup.round` and `lookup.fail` events, if they ever arrive, fling sleeves past or toss a dud over the robot's shoulder (seen in the synthetic `flaky` trace).
- **Card mode** is zoomed onto the robot and the tower, with a row of bobbing heads.

## How to view it

- **Preview:** https://davidmc0.github.io/autonomi-download-viz/#robot-dj
- Worth a look: `/#robot-dj?trace=medium-64mb&size=full` (stalls and the drop), `?trace=flaky&size=full&theme=dark`, `?trace=fail-mid`, `?trace=cancel`. Turn on **Sound** in the View panel for the beat. For the save ending, use the Synthetic tab with "save step" ticked.

## Captures (`reviews/media/`)

Card size, light theme, headless Edge, about 30 s each.

| Trace | Trace length | Speed | Video | Final frame |
| --- | --- | --- | --- | --- |
| quick (3 chunks, real) | 19.0 s | 0.63× | `robot-dj-quick.webm` | `robot-dj-quick.png` |
| large (155 chunks, real) | 301.6 s | 10.05× | `robot-dj-large.webm` | `robot-dj-large.png` |
| flaky (synthetic) | 39.0 s | 1.3× | `robot-dj-flaky.webm` | `robot-dj-flaky.png` |

## Performance

| | Robot DJ |
| --- | --- |
| Skin main-thread time per frame, `large` at 1× (card) | **0.35 ms mean, 0.50 ms p95** (budget: 4 ms) |
| FPS, median / 5th percentile | 179 / 179 (headless Edge on an RTX 3070 laptop, uncapped; not a mid-range figure) |
| JS this skin adds (gzipped, lazy-loaded) | **9.9 kB** (no libraries) |

The smoke test passes for all 9 traces on all three skins (56 checks), and a run with sound on raised no errors. Particles and arms use fixed pools with no per-frame allocation.

## Tweakables

| Parameter | Current |
| --- | --- |
| robot colours | seeded by address (or retro, sleek, chrome) |
| tower style | stacked disks (or vinyl) |
| chunks per disk | auto: at most 60 disks, so 155 chunks are 3 per disk (or always 1) |
| crowd size | 14 |
| confetti | 160 |
| tempo min / max | 92 / 128 bpm |
| music (with sound on) | on |

## Open questions for David

1. **Libraries.** The brief names PixiJS v8 and Tone.js, which would add roughly 200 kB gzipped. I built it with **plain Canvas 2D and Web Audio** instead (9.9 kB in all), following the OGL lesson. **A:** keep Canvas 2D. **B:** switch to PixiJS (GPU sprites; only worth it for thousands of particles). *I suggest A:* it already runs at about 0.35 ms per frame.
2. **Robot personality.** **A:** cute (now: round shapes, big LED eyes). **B:** retro (cream and rust, chunky dials; the "retro" colour preset is a start). **C:** sleek (thin, glossy, minimal face). *I suggest A*, with the seeded colours.
3. **Disks at high totals.** **A:** at most 60 disks, grouping chunks (now: 155 chunks are 3 per disk, and a ring on the deck shows each disk filling). **B:** the brief's idea: 10 chunks per disk above 200 chunks. **C:** always one disk per chunk (very thin disks on big files). *I suggest A:* the tower always looks like a stack of disks, and the count stays honest.
4. **Music by default.** When you turn sound on, should the beat play? **A:** yes (now), with a "music" tweak to turn it off. **B:** effects only (scratch, needle, drop) unless music is switched on. *I suggest A:* sound is already off until you choose it.
5. **The finding stage.** The robot digs through the crate the whole time (2-13 s in real downloads). **A:** keep it. **B:** add the occasional dud toss for variety (still illustrative). *I suggest A:* B suggests failures that didn't happen.

## Known gaps

- **I couldn't listen to the sound.** The synth was exercised headlessly without errors; please judge the kick, hat, scratch and drop by ear.
- **The cable plugging is suggested,** not literal: the left arm reaches toward the speakers while the cables appear one by one.
- The hash is shown as `✓ <8 hex>` on the tower in full size only (it's too small to read in card mode).
- There is no Rive version. The robot is a standalone module driven by one `RobotPose`, so a designer could replace it with a Rive state machine later. *A designer pass would help this skin most*, especially the face and hands.
- The FPS figures aren't from a mid-range laptop or phone. Please check the HUD on yours.
