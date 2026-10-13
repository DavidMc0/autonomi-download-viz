// Record a real download trace in headless Edge/Chromium.
//   node scripts/record.ts <name> <address> [--size N] [--file-name X] [--base http://localhost:5173]
// Writes traces/<name>.jsonl. Needs the dev server running (npm run dev).

import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { browserLaunchOptions } from "./browser.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const base = flag("base") ?? "http://localhost:5173";
const size = flag("size");
const fileName = flag("file-name");
const mode = flag("mode");
const timeoutMs = Number(flag("timeout") ?? 15 * 60_000);
const [name, address] = args;
if (!name || !address) {
  console.error("usage: node scripts/record.ts <name> <address> [--size N] [--file-name X]");
  process.exit(2);
}

const browser = await chromium.launch(browserLaunchOptions());
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const q = new URLSearchParams({ address, timeoutMs: String(timeoutMs) });
if (size) q.set("size", size);
if (fileName) q.set("name", fileName);
if (mode) q.set("mode", mode);
const started = Date.now();
await page.goto(`${base}/record.html?${q}`);
await page.waitForFunction(() => window.__traceDone === true, null, { timeout: timeoutMs + 60_000, polling: 1000 });
const text = await page.evaluate(() => window.__traceText!);
await browser.close();
const out = `traces/${name}.jsonl`;
writeFileSync(out, text);
const lines = text.trim().split("\n");
console.log(`${out}: ${lines.length - 1} records in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(lines.slice(-2).join("\n"));
