// Robot DJ's sound: a tiny Web Audio synth (no samples, no libraries). A kick on every beat and a hat
// on the off-beat, scheduled a little ahead of the audio clock; plus one-shot effects. Everything goes
// through the harness's volume gain node and stays silent until the user turns sound on.

export class Beat {
  private ctx: AudioContext;
  private out: AudioNode;
  private noise: AudioBuffer;
  private next = 0; // audio time of the next beat
  private n = 0;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
    const len = Math.round(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345; // deterministic noise
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      d[i] = ((s >>> 8) / 8388608) - 1;
    }
  }

  /** Call every frame. bpm 0 = silent. */
  tick(bpm: number): void {
    const now = this.ctx.currentTime;
    if (bpm <= 0) {
      this.next = 0;
      return;
    }
    const spb = 60 / bpm;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + 0.2) {
      this.kick(this.next, this.n % 4 === 0 ? 1 : 0.8);
      this.hat(this.next + spb / 2, 0.25);
      this.next += spb;
      this.n++;
    }
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.out);
    return g;
  }

  private kick(t: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(this.env(t, 0.55 * v, 0.28));
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === "bandpass" ? 4 : 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f).connect(this.env(t, peak, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private hat(t: number, v: number): void {
    this.noiseBurst(t, 0.05, "highpass", 7000, 9000, 0.12 * v);
  }

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

  /** The drop: a short riser into a boom and a crash. */
  drop(): void {
    const t = this.ctx.currentTime + 0.01;
    this.noiseBurst(t, 0.6, "highpass", 400, 6000, 0.18);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t + 0.6);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.4);
    o.connect(this.env(t + 0.6, 0.8, 1.2));
    o.start(t + 0.6);
    o.stop(t + 1.9);
    this.noiseBurst(t + 0.6, 1.4, "highpass", 5000, 3000, 0.25);
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
}
