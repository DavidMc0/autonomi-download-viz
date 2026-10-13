// Plays a timeline of VizEvents against a virtual clock. Seeking is done by the harness: it mounts
// a fresh skin and calls seek(), which re-feeds every event up to the target, so skins need no
// rewind logic. In live mode the timeline grows while it plays and the clock follows real time.

import type { VizEvent } from "../events/types";

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 20] as const;

export class Player {
  events: VizEvent[] = [];
  clock = 0;
  speed = 1;
  playing = false;
  live = false;
  /** Index of the next event to dispatch. */
  private cursor = 0;

  constructor(private dispatch: (e: VizEvent) => void) {}

  load(events: VizEvent[], live = false): void {
    this.events = events;
    this.live = live;
    this.cursor = 0;
    this.clock = 0;
  }

  get duration(): number {
    return this.events.length ? this.events[this.events.length - 1].t : 0;
  }

  get ended(): boolean {
    return !this.live && this.cursor >= this.events.length && this.clock >= this.duration;
  }

  /** Advance by a wall-clock delta and dispatch everything now due. */
  update(dtMs: number): void {
    if (this.playing) {
      this.clock += dtMs * (this.live ? 1 : this.speed);
      if (!this.live && this.clock >= this.duration) {
        this.clock = this.duration;
        this.playing = false;
      }
    }
    this.flush();
  }

  /** Jump to `t` from the start (the caller has already reset the skin). */
  seek(t: number): void {
    this.cursor = 0;
    this.clock = Math.max(0, Math.min(t, this.duration));
    this.flush();
  }

  /** The time of the next event that isn't a derived rate tick, or undefined. */
  nextEventTime(): number | undefined {
    for (let i = this.cursor; i < this.events.length; i++) {
      if (this.events[i].type !== "rate") return this.events[i].t;
    }
    return undefined;
  }

  private flush(): void {
    const { events } = this;
    while (this.cursor < events.length && events[this.cursor].t <= this.clock) this.dispatch(events[this.cursor++]);
  }
}
