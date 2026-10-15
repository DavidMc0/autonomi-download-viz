// Robot DJ's sound: a tiny Web Audio synth (no samples, no libraries) that plays a track which builds
// with the download, at a fixed tempo. A 16th-note sequencer schedules a little ahead of the audio
// clock. New layers join only on a bar line, after a one-beat swell, one more per tenth of the file:
//
//   0-10%  pad (its filter opening)      50-60%  + arpeggio
//  10-20%  + kick                         60-70%  + 16th hats and an open hat
//  20-30%  + snare                        70-80%  + lead motif
//  30-40%  + off-beat hat                 80-90%  + chord stabs
//  40-50%  + bass                         90-100% + a snare roll that tightens toward the end
//
// Once the drums are in, the pad rests for the second half of every 8-bar phrase, so the harmony
// breathes. While the whole file is checked, the drums fall away into a breakdown (pad, arpeggio, a noise
// riser and an accelerating roll). On the drop every layer returns with a crash for 8 bars, then
// the layers leave one by one and the track ends on the home chord.
//
// The key, chord progression and lead motif are seeded by the address, so each file gets its own
// tune. Everything goes through the harness's volume node and stays silent until sound is turned on.

export type Section = "off" | "play" | "check" | "drop";

export interface BeatInput {
  bpm: number;
  section: Section;
  /** Chunks completed / total, 0..1. */
  progress: number;
  /** false: every layer from the first bar (the old fixed beat). */
  build: boolean;
}

/** Layers, in the order they join. */
export const LAYERS = ["pad", "kick", "snare", "hat", "bass", "arp", "hats", "lead", "stabs", "roll"] as const;

/** How many layers are playing at this progress (1..10). */
export function layersFor(progress: number): number {
  return Math.min(10, 1 + Math.floor(Math.max(0, progress) * 10));
}

// Chords as semitones above the key's root (natural minor).
const I = [0, 3, 7], IV = [5, 8, 12], V = [7, 10, 14], VI = [8, 12, 15], III = [3, 7, 10], VII = [10, 14, 17];
const PROGRESSIONS = [[I, VI, III, VII], [I, IV, VI, V], [I, VII, VI, VII], [VI, VII, I, I]];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1]; // 3 = the root an octave up
const DROP_BARS = 8;
const OUTRO_BARS = 4;
/** Bars from the drop until the last chord has rung out (the robot winds down then). */
export const SONG_BARS = DROP_BARS + OUTRO_BARS + 2;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Beat {
  private ctx: AudioContext;
  private bus: GainNode;
  private noise: AudioBuffer;
  private root: number;
  private prog: number[][];
  private motif: Int8Array; // per 8th over 2 bars: -1 rest, else chord-tone index (3+ = octave up)

  private next = 0; // audio time of the next 16th
  private step = 0; // 16ths since the section (re)started
  private layers = 0; // layers this bar
  private section: Section = "off";
  private checkAt = 0;
  private dropped = false;
  private dropReset = false;
  private ended = false;
  private riser: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private steps: { t: number; step: number; spb: number }[] = [];

  constructor(ctx: AudioContext, out: AudioNode, seed: Uint8Array) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(comp).connect(out);

    const len = Math.round(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345; // deterministic noise
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      d[i] = ((s >>> 8) / 8388608) - 1;
    }

    this.root = 40 + (seed[5] % 8); // E2..B2
    this.prog = PROGRESSIONS[seed[6] % PROGRESSIONS.length];
    this.motif = new Int8Array(16);
    for (let k = 0; k < 16; k++) {
      const b = seed[(k + 14) % seed.length] ^ (k * 37);
      this.motif[k] = k === 0 ? 0 : (b & 0xff) < 150 ? (b >> 3) % 5 : -1;
    }
  }

  /** Call every frame while the audio context runs. */
  tick(input: BeatInput): void {
    const now = this.ctx.currentTime;
    let section = input.section;
    if (section === "drop" && !this.dropped) section = "off"; // e.g. after a seek past the end
    if (input.bpm <= 0) section = "off";
    if (section !== this.section) this.enter(section, now);
    if (section === "off" || this.ended) return;
    if (this.dropReset) {
      this.dropReset = false;
      this.next = now + 0.02;
      this.step = 0;
    }
    const spb = 60 / input.bpm / 4;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + 0.2 && !this.ended) {
      this.schedule(this.next, this.step, spb, input);
      this.steps.push({ t: this.next, step: this.step, spb });
      if (this.steps.length > 16) this.steps.shift();
      this.next += spb;
      this.step++;
    }
  }

  /** The beat position the listener hears now (beats, fractional), or null when silent. */
  phase(): number | null {
    if (this.section === "off" || this.ended) return null;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || 0);
    let best: { t: number; step: number; spb: number } | null = null;
    for (const s of this.steps) if (s.t <= now && (!best || s.t > best.t)) best = s;
    return best ? best.step / 4 + (now - best.t) / (best.spb * 4) : null;
  }

  private enter(section: Section, now: number): void {
    if (this.section === "check") this.stopRiser(now);
    this.section = section;
    this.next = 0;
    this.step = 0;
    this.steps.length = 0;
    if (section === "check") {
      this.checkAt = now;
      this.startRiser(now);
    }
  }

  private schedule(t: number, step: number, spb: number, input: BeatInput): void {
    const bar = Math.floor(step / 16), s = step % 16;
    const chord = this.prog[bar % 4];
    let roll = 0;
    let full = false;
    const on = { pad: true, kick: false, snare: false, hat: false, bass: false, arp: false, hats: false, lead: false, stabs: false };

    if (this.section === "play") {
      const due = input.build ? layersFor(input.progress) : 9;
      if (s === 0 || this.layers === 0) this.layers = due;
      else if (s === 12 && due > this.layers) this.swell(t, spb * 4); // cue the layer joining next bar
      const n = this.layers;
      on.kick = n > 1; on.snare = n > 2; on.hat = n > 3; on.bass = n > 4; on.arp = n > 5; on.hats = n > 6; on.lead = n > 7; on.stabs = n > 8;
      if (n > 9) roll = Math.min(1, Math.max(0, (input.progress - 0.9) * 10));
      if (s === 0 && (n === 1 || bar % 8 < 4)) this.pad(t, chord, spb * 16, 500 + 3500 * Math.min(1, input.progress * 1.4), n > 1 ? 0.7 : 1);
    } else if (this.section === "check") {
      // Breakdown: no kick; the roll tightens over about 6 s.
      roll = Math.min(1, (t - this.checkAt) / 6);
      on.arp = true; on.bass = s === 0;
      if (s === 0) this.pad(t, chord, spb * 16, 1200 + 3000 * roll, 1);
    } else if (this.section === "drop") {
      if (bar === 0 && s === 0) this.boom(t);
      if (s === 0 && bar % 4 === 0 && bar < DROP_BARS) this.crash(t);
      const out = bar - DROP_BARS; // outro bars, then the end
      if (out >= OUTRO_BARS) {
        if (s === 0) this.pad(t, I, spb * 32, 2500, 1.2); // the home chord rings out
        this.ended = true;
        return;
      }
      full = out < 0;
      on.kick = out < 3; on.bass = out < 3; on.snare = out < 1; on.hat = out < 1; on.hats = out < 1;
      on.arp = out < 0; on.lead = out < 0; on.stabs = out < 0;
      if (s === 0) this.pad(t, chord, spb * 16, full ? 5000 : 3000 - out * 500, full ? 0.7 : 1);
    }

    const r = this.root;
    if (on.kick && s % 4 === 0) this.kick(t, s === 0 ? 1 : 0.85);
    if (on.snare && (s === 4 || s === 12)) this.snare(t, 0.9);
    if (on.hat && s % 4 === 2) this.hat(t, on.hats ? 0.12 : 0.25, on.hats);
    if (on.hats && s % 2 === 1) this.hat(t, 0.1 + (s % 4 === 3 ? 0.05 : 0), false);
    if (on.bass && (s % 4 === 2 || (this.section === "check" && s === 0))) this.bass(t, r + chord[0], spb * (this.section === "check" ? 14 : 1.6));
    if (on.arp) {
      const k = ARP[s % 8];
      this.pluck(t, r + 24 + (k === 3 ? chord[0] + 12 : chord[k]), spb * 0.9, 0.045, "square", 2600);
    }
    if (on.lead && s % 2 === 0) {
      const k = this.motif[(bar % 2) * 8 + s / 2];
      if (k >= 0) this.pluck(t, r + 24 + chord[k % 3] + (k >= 3 ? 12 : 0), spb * 1.8, 0.07, "sawtooth", 3200);
    }
    if (on.stabs && (s === 3 || s === 6 || s === 11)) for (const n of chord) this.pluck(t, r + 12 + n, spb * 0.8, 0.035, "square", 1800);
    if (roll > 0) {
      const every = roll < 0.34 ? 4 : roll < 0.67 ? 2 : 1;
      if (s % every === 0) this.snare(t, 0.25 + 0.6 * roll);
    }
  }

  // ---------------------------------------------------------------------------
  // Voices.

  private env(t: number, peak: number, decay: number, attack = 0.005): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.bus);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, detune = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private lowpass(t: number, cutoff: number, dest: AudioNode, q = 0.8): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  private pad(t: number, chord: number[], dur: number, cutoff: number, level: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * level, t + Math.min(0.3, dur * 0.2));
    g.gain.setValueAtTime(0.05 * level, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    g.connect(this.bus);
    const f = this.lowpass(t, cutoff, g);
    for (const n of chord) {
      const hz = mtof(this.root + 12 + n);
      this.osc("sawtooth", hz, t, dur * 1.05, f, -8);
      this.osc("sawtooth", hz, t, dur * 1.05, f, 8);
    }
  }

  private pluck(t: number, midi: number, dur: number, peak: number, type: OscillatorType, cutoff: number): void {
    this.osc(type, mtof(midi), t, dur, this.lowpass(t, cutoff, this.env(t, peak, dur)));
  }

  private bass(t: number, midi: number, dur: number): void {
    const f = this.lowpass(t, 420, this.env(t, 0.2, dur, 0.008), 2);
    this.osc("sawtooth", mtof(midi), t, dur, f, -5);
    this.osc("sawtooth", mtof(midi), t, dur, f, 5);
  }

  private kick(t: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(this.env(t, 0.55 * v, 0.28));
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number, v: number): void {
    this.noiseBurst(t, 0.16, "bandpass", 1900, 1500, 0.28 * v, 1.2);
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(this.env(t, 0.14 * v, 0.09));
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, v: number, open: boolean): void {
    this.noiseBurst(t, open ? 0.22 : 0.05, "highpass", 7000, 9000, (open ? 0.6 : 0.5) * v);
  }

  private crash(t: number): void {
    this.noiseBurst(t, 1.4, "highpass", 5000, 3000, 0.22);
  }

  private boom(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.8);
    o.connect(this.env(t, 0.8, 1.2));
    o.start(t);
    o.stop(t + 1.3);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q?: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q ?? (type === "bandpass" ? 4 : 0.7);
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f).connect(this.env(t, peak, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A short noise swell that lands on the next downbeat. */
  private swell(t: number, dur: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t, 0.3);
    src.stop(t + dur + 0.02);
  }

  private startRiser(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + 8);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 8);
    src.connect(f).connect(gain).connect(this.bus);
    src.start(t);
    this.riser = { src, gain };
  }

  private stopRiser(t: number): void {
    if (!this.riser) return;
    const { src, gain } = this.riser;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.stop(t + 0.1);
    this.riser = null;
  }

  // ---------------------------------------------------------------------------
  // One-shot effects.

  /** A record scratch: two quick band-passed sweeps. */
  scratch(): void {
    const t = this.ctx.currentTime + 0.01;
    this.noiseBurst(t, 0.12, "bandpass", 600, 2400, 0.35);
    this.noiseBurst(t + 0.13, 0.16, "bandpass", 2600, 500, 0.35);
  }

  /** The needle dragged across the record. */
  needle(): void {
    const t = this.ctx.currentTime + 0.01;
    this.noiseBurst(t, 0.45, "bandpass", 3200, 300, 0.45);
  }

  /** The drop: the bar count restarts here with a boom, a crash and every layer. */
  drop(): void {
    this.dropped = true;
    this.dropReset = true;
    this.ended = false;
  }

  /** A soft thunk when a disk lands. */
  thunk(): void {
    const t = this.ctx.currentTime + 0.01;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    o.connect(this.env(t, 0.12, 0.1));
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Stop anything still sounding (the skin is leaving). */
  dispose(): void {
    this.stopRiser(this.ctx.currentTime);
    this.bus.disconnect();
  }
}
