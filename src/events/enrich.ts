// Tier C detail from Tier A events, generated deterministically from the file address.
// Real data stays in charge: if 37 of 120 chunks are done, exactly 37 chunk.received events have
// been emitted; only *which* 37, and which node "sent" them, is illustrative.

import { hashString, permutation, prng, seedFromAddress } from "./seed";
import type { VizEvent } from "./types";

const WINDOW = 8; // illustrative concurrency
const MIN_POOL = 12;
const RETRY_CHANCE = 0.03;

export class Enricher {
  private seed: Uint8Array;
  private rand: () => number;
  private order: number[] | null = null;
  private received: boolean[] = [];
  private count = 0;
  private written = 0;
  private requested = 0;
  private peers: string[] = [];
  private known = new Set<string>();
  private assigned = new Map<number, string>();
  private size?: number;
  /** The source supplies its own detail (synthetic, or a future Tier B build): stay out of the way. */
  private passive = false;

  constructor(address: string) {
    this.seed = seedFromAddress(address);
    this.rand = prng(this.seed, 0xc0ffee);
  }

  observe(e: VizEvent): VizEvent[] {
    if (e.type.startsWith("chunk.") && "tier" in e) this.passive = true;
    if (e.type === "node.state") this.passive = true;
    if (this.passive) return [];
    switch (e.type) {
      case "connect.peer":
      case "lookup.round":
        this.addPeer(e.peerId);
        return [];
      case "file.meta":
        this.size = e.size;
        return [];
      case "chunk.done":
        return this.chunkDone(e.t, e.completed, e.total);
      default:
        return [];
    }
  }

  private addPeer(id: string): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.peers.push(id);
  }

  private pool(): string[] {
    // Pad with stable made-up node names so scenes always have a few sources.
    for (let i = this.peers.length; i < MIN_POOL; i++) {
      this.addPeer(`illustrative-${(hashString(`${i}`) ^ (this.seed[i % 32] << 8)).toString(16).padStart(8, "0")}`);
    }
    return this.peers;
  }

  private request(t: number, out: VizEvent[]): void {
    const order = this.order!;
    if (this.requested >= order.length) return;
    const index = order[this.requested++];
    const peers = this.pool();
    const peerId = peers[Math.floor(this.rand() * peers.length)];
    this.assigned.set(index, peerId);
    out.push({ t, type: "chunk.request", index, peerId, tier: "C" });
    out.push({ t, type: "node.state", peerId, state: "sending", tier: "C" });
  }

  private chunkDone(t: number, completed: number, total: number): VizEvent[] {
    const out: VizEvent[] = [];
    if (!this.order) {
      this.order = permutation(total, prng(this.seed, total));
      this.received = new Array(total).fill(false);
      for (let i = 0; i < Math.min(WINDOW, total); i++) this.request(t, out);
    }
    const order = this.order;
    // Normally one chunk per event, but tolerate skipped counts.
    while (this.count < Math.min(completed, total)) {
      const index = order[this.count];
      const peerId = this.assigned.get(index);
      if (this.rand() < RETRY_CHANCE) out.push({ t, type: "chunk.retry", index, attempt: 2, tier: "C" });
      this.received[index] = true;
      this.count++;
      const bytes = this.size !== undefined ? Math.round(this.size / total) : 0;
      out.push({ t, type: "chunk.received", index, bytes, peerId, tier: "C" });
      this.request(t, out);
      while (this.written < total && this.received[this.written]) {
        out.push({ t, type: "chunk.written", index: this.written, tier: "C" });
        this.written++;
      }
    }
    return out;
  }
}
