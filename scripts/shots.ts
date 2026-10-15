// Stills of one skin at a chosen point in a trace, with tweak values, for checking a look quickly.
//   node scripts/shots.ts <skin-id> --trace medium-64mb --at 0.5 --params '{"style":"retro"}' --out shot
// --at is the fraction of chunks completed (0..1), or "end". Writes <out>-0..3.png, --gap ms apart
// (120), after --wait ms (700, or 2500 at the end).
// Needs the dev server (npm run dev).

import { chromium } from "playwright-core";
import { browserLaunchOptions } from "./browser.ts";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const base = flag("base", "http://localhost:5173");
const trace = flag("trace", "medium-64mb");
const at = flag("at", "0.5");
const params = flag("params", "{}");
const size = flag("size", "full");
const theme = flag("theme", "light");
const out = flag("out", "reviews/media/shot");
const wait = flag("wait", "");
const gap = Number(flag("gap", "120"));
const skin = args[0];
if (!skin) {
  console.error("usage: node scripts/shots.ts <skin-id> [--trace id] [--at 0.5|end] [--params json] [--out stem]");
  process.exit(2);
}

const browser = await chromium.launch(browserLaunchOptions());
const viewport = size === "full" ? { width: 960, height: 572 } : { width: 360, height: 252 };
const context = await browser.newContext({ viewport, colorScheme: theme as "light" | "dark" });
await context.addInitScript(([id, p]) => localStorage.setItem(`viz.params.${id}`, p), [skin, params]);
const page = await context.newPage();
await page.goto(`${base}/#${skin}?trace=${trace}&speed=16&capture=1&size=${size}&theme=${theme}&autoplay=0`);
await page.waitForFunction(() => window.__viz?.ready);
await page.evaluate(() => (window.__viz!.player.playing = true));
if (at === "end") await page.waitForFunction(() => window.__viz!.player.ended, null, { timeout: 120000, polling: 50 });
else await page.waitForFunction((f) => { const s = window.__viz!.state(); return s.total ? s.completed / s.total >= f : false; }, Number(at), { timeout: 120000, polling: 20 });
await page.evaluate(() => (window.__viz!.player.playing = false));
await page.waitForTimeout(wait ? Number(wait) : at === "end" ? 2500 : 700);
for (let i = 0; i < 4; i++) {
  await page.locator("#stage").screenshot({ path: `${out}-${i}.png` });
  await page.waitForTimeout(gap);
}
await browser.close();
