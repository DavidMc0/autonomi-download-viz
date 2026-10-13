# Autonomi download visualisations

A gallery of animated "skins" for an Autonomi download. All skins are driven by one event stream, which comes from a real download, a recorded trace or a synthetic one. The winning skins will later be added to the [Download Button](https://github.com/DavidMc0/autonomirror) page.

The plan and its current state are in [DECISIONS.md](DECISIONS.md). Review notes for each step are in [reviews/](reviews/).

## Run it

```sh
npm install
npm run dev          # gallery at http://localhost:5173
npm test             # vitest: parser, derive, enricher, synthetic presets
npm run smoke        # Playwright smoke test against the dev server (add -- --live for a real download)
npm run capture -- baseline --traces quick,large,flaky   # review WebMs + PNG + perf JSON in reviews/media/
npm run record -- quick-3 <address> --size <bytes> --file-name <name>   # record a real trace to traces/
```

The Playwright scripts launch the installed Edge or Chrome (or `$BROWSER_PATH`). On Windows, run them from PowerShell, not Git Bash. Video capture needs Playwright's ffmpeg: `npx playwright-core install ffmpeg`.

## Deep links

`/#<skin-id>?trace=large&speed=2&size=full`. Other parameters: `theme=light|dark`, `autoplay=0`, `log=1`, `hud=0`, `capture=1` (stage only), and `source=live&address=<hex>`.

## How it fits together

```
SDK ProgressEvent ─▶ TraceRecorder (raw JSONL) ─▶ Parser ─▶ Deriver (rate, stall) ─▶ [Enricher: Tier C] ─▶ Player ─▶ skin.onEvent
                                         ▲
               SyntheticSource ──────────┘ (same raw message strings, plus Tier C detail)
```

- `src/events/`: the event types, the parser (every SDK message regex lives in `parse.ts`), derived events, the enricher, the seed/PRNG, and a shared state reducer with the plain progress text.
- `src/sources/`: live (SDK), recorder (JSONL), replay player, synthetic generator.
- `src/skins/<id>/index.ts`: one folder per skin, default-exporting a factory. Skins are lazy-loaded, and the list comes from `skins.json`.
- `src/ui/`: scrub bar, tweak panel, perf HUD, capture, catalog.
- `traces/`: real recordings (raw SDK events, re-parsed on load). Synthetic presets are generated in code.

## Licence

MIT OR Apache-2.0, matching the Autonomi SDK. See [THIRD-PARTY.md](THIRD-PARTY.md) for dependencies.
