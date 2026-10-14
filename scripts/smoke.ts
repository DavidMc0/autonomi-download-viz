// Smoke test: the gallery loads, every bundled trace plays to its ending on every built skin,
// scrubbing and replay give identical state, and the console stays clean.
//   node scripts/smoke.ts [--base http://localhost:5173] [--shots dir]

import { chromium, type Page } from "playwright-core";
import { browserLaunchOptions } from "./browser.ts";

const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = flag("base", "http://localhost:5173")!;
const shots = flag("shots");
const skins = (flag("skins", "baseline") ?? "baseline").split(",");
const traces = (flag("traces", "quick,large,medium-64mb,flaky,nested,fail-connect,fail-mid,cancel,huge") ?? "").split(",");

const browser = await chromium.launch(browserLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const expectEnd: Record<string, string> = {
  "fail-connect": "failed", "fail-mid": "failed", cancel: "cancelled",
};

async function state(p: Page) {
  return p.evaluate(() => {
    const s = window.__viz!.state();
    return { phase: s.phase, completed: s.completed, total: s.total, text: document.getElementById("progress-text")!.textContent };
  });
}

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

for (const skin of skins) {
  for (const trace of traces) {
    await page.goto("about:blank"); // a hash-only navigation (or a racing reload) can keep the previous page
    await page.goto(`${base}/#${skin}?trace=${trace}&speed=20`);
    await page.waitForFunction(() => window.__viz?.ready, null, { timeout: 30_000 });
    await page.waitForFunction(() => window.__viz!.player.ended, null, { timeout: 120_000, polling: 250 });
    const end = await state(page);
    const want = expectEnd[trace] ?? "done";
    check(end.phase === want, `${skin} × ${trace}: ends ${end.phase} (${end.text})`);
    if (shots) await page.locator("#stage-wrap").screenshot({ path: `${shots}/${skin}-${trace}.png` });

    // Scrub to the middle and back to the end: the state must match a straight run.
    const box = (await page.locator("#scrub").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const mid = await state(page);
    await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    await page.waitForFunction(() => window.__viz!.player.ended, null, { timeout: 30_000 });
    await page.waitForTimeout(150);
    const again = await state(page);
    check(JSON.stringify(again) === JSON.stringify(end), `${skin} × ${trace}: scrub mid (${mid.phase} ${mid.completed}/${mid.total}) then end matches`);
  }
}

// Full size, dark theme, reduced motion.
await page.goto(`${base}/#baseline?trace=flaky&speed=20&size=full&theme=dark`);
await page.reload();
await page.waitForFunction(() => window.__viz!.player.ended, null, { timeout: 60_000, polling: 250 });
if (shots) await page.locator("#stage-wrap").screenshot({ path: `${shots}/baseline-flaky-full-dark.png` });
if (shots) await page.screenshot({ path: `${shots}/gallery.png` });
check((await state(page)).phase === "done", "full size, dark theme");

// Live: a real download in the gallery, then its recording must rebuild the identical timeline.
if (args.includes("--live")) {
  await page.goto(`${base}/#baseline?source=live&address=52af8a181c6171f8e12896ca734cdf60839c3b324dfbeadf857226dfc7cb453b`);
  await page.reload();
  await page.waitForFunction(() => window.__viz?.player && !window.__viz.player.live && window.__viz.player.events.length > 3, null, { timeout: 300_000, polling: 500 });
  const live = await state(page);
  check(live.phase === "done", `live download in the gallery ends ${live.phase} (${live.text})`);
  const same = await page.evaluate(async () => {
    // Dev-server module paths, resolved in the page, not by tsc.
    const mods = ["/src/events/derive.ts", "/src/sources/recorder.ts"];
    const { buildTimeline } = await import(/* @vite-ignore */ mods[0]);
    const { parseTrace, serializeTrace } = await import(/* @vite-ignore */ mods[1]);
    const v = window.__viz!;
    const trace = parseTrace(serializeTrace(v.trace()));
    return JSON.stringify(buildTimeline(trace)) === JSON.stringify(v.player.events);
  });
  check(same, "live timeline equals the replayed recording");
}

check(errors.length === 0, `console clean${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
await browser.close();
process.exit(failed ? 1 : 0);
