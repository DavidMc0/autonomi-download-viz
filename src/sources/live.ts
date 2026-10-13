// A real download from the network, recorded as it happens.
// Each run connects afresh (closing the previous client first), so every live run tells the whole
// story from "connecting". There is never more than one client on the page.

import { AutonomiClient, type ProgressEvent } from "@withautonomi/ant-browser-sdk";
import type { TraceRecord } from "../events/types";
import { plainError, TraceRecorder } from "./recorder";
import { SDK_VERSION } from "./version";


let client: AutonomiClient | null = null;

export type LiveMode = "download" | "save" | "stream";

export interface LiveOptions {
  address: string;
  name?: string;
  size?: number;
  /**
   * "download": in-memory download() (default). "save": downloadAndSave(), with a save picker.
   * "stream": openFile() then read its stream to the end and discard it (bounded memory).
   */
  mode: LiveMode;
  onRecord: (rec: TraceRecord) => void;
}

export class LiveSource {
  readonly recorder: TraceRecorder;
  private abort = new AbortController();

  constructor(private readonly opts: LiveOptions) {
    this.recorder = new TraceRecorder({
      kind: "header", format: 1, address: opts.address.trim(), sdk: SDK_VERSION, source: "live",
      recordedAt: new Date().toISOString(), userAgent: navigator.userAgent,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.size !== undefined ? { size: opts.size } : {}),
    });
  }

  async run(): Promise<void> {
    const { recorder, opts } = this;
    const listener = (ev: ProgressEvent) => opts.onRecord(recorder.sdk(ev));
    try {
      client?.close();
      client = null;
      client = await AutonomiClient.connect({ onProgress: listener, signal: this.abort.signal });
      const address = opts.address.trim();
      const signal = this.abort.signal;
      if (opts.mode === "save") await client.downloadAndSave(address, { signal });
      else if (opts.mode === "download") await client.download(address, { signal });
      else {
        const reader = await client.openFile(address, { signal });
        try {
          const stream = reader.stream({ signal }).getReader();
          let bytes = 0;
          for (;;) {
            const { done, value } = await stream.read();
            if (done) break;
            bytes += value.byteLength;
          }
          opts.onRecord(recorder.note(`stream finished: ${bytes} bytes`));
        } finally {
          reader.close();
        }
      }
    } catch (err) {
      // The SDK has already reported the failure as a terminal event; keep the detail anyway.
      const e = plainError(err);
      opts.onRecord(recorder.note(`run ended: ${e.code ?? e.name ?? "error"}: ${e.message}`));
    }
  }

  cancel(): void {
    this.abort.abort();
  }
}

export function closeLiveClient(): void {
  client?.close();
  client = null;
}
