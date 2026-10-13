// Dev-only page for scripts/record.ts: download ?address=… live and expose the raw trace.

import { LiveSource, type LiveMode } from "./sources/live";
import { serializeTrace } from "./sources/recorder";

declare global {
  interface Window { __traceDone?: boolean; __traceText?: string }
}

const q = new URLSearchParams(location.search);
const log = document.getElementById("log")!;
const live = new LiveSource({
  address: q.get("address") ?? "",
  name: q.get("name") ?? undefined,
  size: q.has("size") ? Number(q.get("size")) : undefined,
  mode: (q.get("mode") as LiveMode | null) ?? "download",
  onRecord: (rec) => {
    log.textContent += `${rec.t}\t${JSON.stringify(rec.kind === "sdk" ? rec.ev : rec)}\n`;
  },
});
const timeout = Number(q.get("timeoutMs") ?? 0);
if (timeout) setTimeout(() => live.cancel(), timeout);
await live.run();
window.__traceText = serializeTrace(live.recorder.trace());
window.__traceDone = true;
