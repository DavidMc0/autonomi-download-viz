// Review captures: replay the quick, large and flaky traces for one skin in headless Chromium/Edge,
// record each as a 20-40 s WebM (Playwright screen recording, so DOM/SVG skins work too), write a
// PNG of the finished state, and print perf numbers.
//   node scripts/capture.ts <skin-id> [--size card|full] [--traces quick,large,flaky] [--theme light|dark]
// Needs the dev server (npm run dev) or a preview build on --base.

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { browserLaunchOptions } from "./browser.ts";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const base = flag("base", "http://localhost:5173");
const size = flag("size", "card");
const theme = flag("theme", "light");
const traces = flag("traces", "quick,large,flaky").split(",");
const target = Number(flag("seconds", "30")) * 1000;
const skin = args[0];
if (!skin) {
  console.error("usage: node scripts/capture.ts <skin-id> [--size card|full] [--traces a,b,c]");
  process.exit(2);
}

const out = "reviews/media";
const tmp = `${out}/${skin}.tmp`;
mkdirSync(tmp, { recursive: true });
const viewport = size === "full" ? { width: 960, height: 572 } : { width: 360, height: 252 };
const browser = await chromium.launch(browserLaunchOptions());
const results: Record<string, unknown>[] = [];

for (const trace of traces) {
  // Measure the trace first, so the clip lasts about `target` ms.
  const probe = await browser.newPage();
  await probe.goto(`${base}/#${skin}?trace=${trace}&autoplay=0&capture=1&size=${size}`);
  await probe.waitForFunction(() => window.__viz?.ready);
  const duration = await probe.evaluate(() => window.__viz!.player.duration);
  await probe.close();
  const speed = Math.max(0.25, Math.round((duration / target) * 100) / 100);

  const context = await browser.newContext({ viewport, recordVideo: { dir: tmp, size: viewport }, colorScheme: theme as "light" | "dark" });
  const page = await context.newPage();
  await page.goto(`${base}/#${skin}?trace=${trace}&speed=${speed}&capture=1&size=${size}&theme=${theme}&autoplay=0`);
  await page.waitForFunction(() => window.__viz?.ready);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__perf!.reset();
    window.__viz!.player.playing = true;
  });
  await page.waitForFunction(() => window.__viz!.player.ended, null, { timeout: target * 3, polling: 200 });
  const perf = await page.evaluate(() => window.__perf!.snapshot());
  await page.waitForTimeout(2500); // let the ending settle
  const stem = `${String(skin)}-${trace}${size === "full" ? "-full" : ""}`;
  await page.locator("body").screenshot({ path: `${out}/${stem}.png` });
  const video = page.video()!;
  await context.close();
  renameSync(await video.path(), `${out}/${stem}.webm`);
  results.push({ trace, speed, durationS: +(duration / 1000).toFixed(1), clipS: +(duration / speed / 1000).toFixed(1), ...perf });
  console.log(`${stem}: ${(duration / 1000).toFixed(1)} s trace at ${speed}× · fps median ${perf.fpsMedian.toFixed(0)}, p5 ${perf.fpsP5.toFixed(0)} · skin ${perf.skinMsMean.toFixed(2)} ms/frame (p95 ${perf.skinMsP95.toFixed(2)})`);
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
writeFileSync(`${out}/${skin}${size === "full" ? "-full" : ""}-perf.json`, JSON.stringify(results, null, 2) + "\n");
