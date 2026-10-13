// Which browser the Playwright scripts launch: $BROWSER_PATH, else installed Edge, else Chrome.

import { existsSync } from "node:fs";
import type { LaunchOptions } from "playwright-core";

const CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

export function browserLaunchOptions(extra: LaunchOptions = {}): LaunchOptions {
  const executablePath = process.env.BROWSER_PATH ?? CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No Chromium-based browser found; set BROWSER_PATH");
  return { executablePath, headless: true, ...extra };
}
