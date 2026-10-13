// Set a recorded trace's header size from the SDK's exact final byte count ("Downloaded <name>"),
// i.e. the size a download page that knows the file would have supplied up front.
//   node scripts/set-size.ts traces/large-1.jsonl

import { readFileSync, writeFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const final = lines.find((r) => r.kind === "sdk" && r.ev.unit === "bytes" && r.ev.total !== undefined);
  if (!final) throw new Error(`${file}: no final byte count`);
  lines[0] = { ...lines[0], size: final.ev.total, note: "size set from the final byte count" };
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  console.log(`${file}: size ${final.ev.total}`);
}
