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

## Follow-up (2026-10-15): David's answers applied

**What changed**
- **Elbows fixed.** The arms are now solved in 3D: the decks sit in front of the robot, so the arms reach toward the viewer and foreshorten. The elbows always bend down and outward. Before, the 2D solver picked "the lower elbow", which pointed inward into the body and could flip as the robot bobbed. Every pose was re-checked (decks, crate, watch, scanner, drop, shrug, wave), and hands nearer the viewer now draw slightly larger.
- **Robot styles.** A new "robot style" tweak switches between **cute** (the default, unchanged), **retro** (a TV-set head with rabbit-ear antennae, scanlines and knobs, a riveted cabinet body with a VU meter and dials, ribbed hose arms, square hands, cream and rust) and **sleek** (a glossy egg head with a thin visor band and a light fin, a tapered shell with a vertical light strip, slim limbs, and a mouth only for big feelings). "robot colours" now defaults to **match style**: cute stays seeded by address, and retro and sleek use their own palettes. Any palette can still be picked with any style. Side by side: `robot-dj-styles.png`.
- **Disks:** grouping stays, and the group size grows with the file (at most 60 disks), as agreed.
- **The finding stage** stays as crate-digging, with no duds.
- **The music now builds with the download.** At each bar line, the track adds one layer for every tenth of the chunks that are in:

  | Chunks in | Layer that joins |
  | --- | --- |
  | 0-10% | pad chords (the filter opens as chunks arrive) |
  | 10% | kick |
  | 20% | snare on 2 and 4 |
  | 30% | off-beat hat |
  | 40% | bass |
  | 50% | arpeggio |
  | 60% | 16th hats and an open hat |
  | 70% | lead motif |
  | 80% | chord stabs |
  | 90% | a snare roll that tightens toward 100% |

  - **Checking** (the ~10 s whole-file verification) is a **breakdown**: the drums drop out, the pad and arpeggio carry on, and a noise riser and an accelerating snare roll build tension.
  - **The drop** brings every layer back at once with a boom and a crash, for 8 bars. Then the layers leave one by one over 4 bars, and the track ends on the home chord. The robot keeps dancing after that.
  - **Stalls** still cut the music with a scratch. It resumes from the top of a bar.
  - **Seeded by address:** the key (E to B), one of four minor-key chord progressions, and a 2-bar lead motif, so each file has its own tune. I kept this light so that Step 7 (The file's song) still has its own territory.
  - The tempo still follows the rate (92-128 bpm), and the sound plays only when sound is on.
- **The mixer on the DJ table** now shows one light per playing layer, so the build can be seen with the sound off too.
- **The robot dances to what you hear:** with sound on, the bob, the chest lights and the crowd follow the audio clock rather than a separate timer.
- **Tweaks:** "music builds with download" can be turned off to play the full mix from the first chunk.
- **Tooling:** `scripts/shots.ts` takes stills at a chosen point in a trace with tweak values (`node scripts/shots.ts robot-dj --at 0.5 --params '{"style":"retro"}'`).

**Checks:** a headless run with sound on (`medium-64mb` at 3×) added layers 1 → 10 as the chunks arrived, ran the drop and the outro (6 → 3 → 2 → 1 → silence), and raised no console errors. The smoke test passes 56/56. The skin is now **13.4 kB** gzipped (it was 9.9 kB) and takes **0.32-0.46 ms** per frame (p95 0.70) in the new captures, which replace the old ones.

**Still unheard by me:** the mix balance and the sound of each layer. Try `/#robot-dj?trace=medium-64mb&size=full` with **Sound** on. That run takes about 5 minutes at 1×, so each layer lasts about 30 s. `?trace=large&speed=4` gives a faster build.

**Open questions**
1. **Build pace.** One layer every 10% is linear. **A:** keep it. **B:** front-load it (kick by 5%, snare by 10% and so on), so short files reach the groove sooner. *I suggest A*, unless the first 10% feels too long on big files.
2. **After the outro.** The track ends about 22 s after the drop, but the robot keeps dancing silently. **A:** keep that. **B:** the robot winds down (takes off its headphones and waves) when the music ends. *I suggest B*, as a cleaner ending.
3. **Style.** After seeing them, keep **cute** as the default with the toggle? Or should one of the others replace it?
