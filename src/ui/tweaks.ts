// The tweak panel for the current skin (Tweakpane), plus settings JSON copy/paste.

import { Pane } from "tweakpane";
import type { TweakDef } from "../skins/types";

export class TweakPanel {
  private pane: Pane | null = null;
  private values: Record<string, unknown> = {};

  constructor(private container: HTMLElement, private onChange: (params: Record<string, unknown>) => void) {}

  show(defs: TweakDef[], values: Record<string, unknown>): void {
    this.pane?.dispose();
    this.values = { ...values };
    const pane = new Pane({ container: this.container });
    this.pane = pane;
    if (defs.length === 0) {
      this.container.dataset.empty = "true";
      return;
    }
    for (const d of defs) {
      const label = d.label ?? d.key;
      if (d.kind === "number") pane.addBinding(this.values, d.key, { label, min: d.min, max: d.max, step: d.step });
      else if (d.kind === "select") pane.addBinding(this.values, d.key, { label, options: d.options });
      else if (d.kind === "color") pane.addBinding(this.values, d.key, { label, view: "color" });
      else pane.addBinding(this.values, d.key, { label });
    }
    pane.on("change", () => this.onChange({ ...this.values }));
  }

  current(): Record<string, unknown> {
    return { ...this.values };
  }
}
