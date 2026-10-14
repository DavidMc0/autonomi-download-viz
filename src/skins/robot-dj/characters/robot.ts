// The DJ robot: an original procedural character drawn with Canvas 2D. A rounded "radio" torso with
// a speaker-grille chest, a screen head whose visor shows LED expressions, headphones, an antenna
// bulb, and two-bone IK arms that reach for whatever the scene needs (decks, crate, wrist, tower).
//
// The body and the arms are drawn separately so the DJ table can sit between them. A designer could
// replace this module with a Rive state machine driven by the same RobotPose.

export type Expression = "off" | "boot" | "neutral" | "happy" | "focus" | "bored" | "worried" | "wow" | "sad" | "wink";

export interface Pt { x: number; y: number }

export interface RobotPose {
  /** Feet centre, world units. */
  x: number;
  y: number;
  /** Vertical bob of the body (px, + is down). */
  bob: number;
  /** Torso tilt about the hips (radians, + leans forward / bows). */
  lean: number;
  headTilt: number;
  /** 0..1: shoulders up. */
  shrug: number;
  handL: Pt;
  handR: Pt;
  /** 0..1: right toe lifted. */
  footTap: number;
  expression: Expression;
  /** 0..1 visor brightness (boot flicker, power down). */
  visor: number;
  /** 0..1 eyes closed. */
  blink: number;
  /** 0..1 antenna bulb. */
  antenna: number;
  /** 0..1 chest LEDs (the beat). */
  chest: number;
}

export interface RobotPalette {
  body: string;
  bodyShade: string;
  accent: string;
  joint: string;
  visorBg: string;
  glow: string;
  outline: string;
}

export const SCHEMES: Record<string, RobotPalette> = {
  retro: { body: "#efe3c8", bodyShade: "#d8c7a3", accent: "#d9662b", joint: "#7a6a58", visorBg: "#1b1410", glow: "#ffb547", outline: "#3b2f25" },
  sleek: { body: "#f3f6f9", bodyShade: "#d4dde6", accent: "#1fb5d6", joint: "#5b6b7a", visorBg: "#0b1622", glow: "#5ff0ff", outline: "#24313e" },
  chrome: { body: "#c3cad3", bodyShade: "#9aa3ae", accent: "#e0459b", joint: "#4b525c", visorBg: "#101018", glow: "#b6ff5c", outline: "#262a31" },
};

/** A seeded scheme: body tint and accent from the address. */
export function seededScheme(seed: Uint8Array): RobotPalette {
  const h = Math.round((seed[11] / 256) * 360);
  const a = (h + 150 + (seed[12] % 60)) % 360;
  return {
    body: `hsl(${h} 30% 86%)`, bodyShade: `hsl(${h} 24% 72%)`, accent: `hsl(${a} 75% 52%)`, joint: `hsl(${h} 15% 38%)`,
    visorBg: `hsl(${h} 30% 8%)`, glow: `hsl(${(a + 40) % 360} 100% 66%)`, outline: `hsl(${h} 25% 18%)`,
  };
}

// Body geometry (relative to the feet, y up is negative).
const HIP_Y = -64;
const TORSO_TOP = -160;
const HEAD_BOTTOM = -168;
const HEAD_TOP = -240;
const SHOULDER_X = 50;
const SHOULDER_Y = -146;
export const ARM_UPPER = 48;
export const ARM_LOWER = 46;

export interface Rig {
  shoulderL: Pt;
  shoulderR: Pt;
  elbowL: Pt;
  elbowR: Pt;
  handL: Pt;
  handR: Pt;
  head: Pt; // visor centre
}

function rotInto(out: Pt, x: number, y: number, o: Pt, a: number): Pt {
  const c = Math.cos(a), s = Math.sin(a), dx = x - o.x, dy = y - o.y;
  out.x = o.x + dx * c - dy * s;
  out.y = o.y + dx * s + dy * c;
  return out;
}

/** Two-bone IK into `elbow` and `hand`: the elbow that bends downward (the natural one for a DJ). */
export function ik(s: Pt, t: Pt, l1: number, l2: number, elbow: Pt, hand: Pt): void {
  let dx = t.x - s.x, dy = t.y - s.y;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.5, min = Math.abs(l1 - l2) + 1;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  if (d < min) { const k = min / Math.max(d, 1e-3); dx *= k; dy *= k; d = min; }
  const a = Math.atan2(dy, dx);
  const b = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const y1 = s.y + Math.sin(a + b) * l1, y2 = s.y + Math.sin(a - b) * l1;
  const ang = y1 > y2 ? a + b : a - b;
  elbow.x = s.x + Math.cos(ang) * l1;
  elbow.y = s.y + Math.sin(ang) * l1;
  hand.x = s.x + dx;
  hand.y = s.y + dy;
}

export function newRig(): Rig {
  const p = () => ({ x: 0, y: 0 });
  return { shoulderL: p(), shoulderR: p(), elbowL: p(), elbowR: p(), handL: p(), handR: p(), head: p() };
}

const hip: Pt = { x: 0, y: 0 };
/** Solve the arms for a pose, into `r` (no allocation). */
export function rig(p: RobotPose, r: Rig): Rig {
  hip.x = p.x;
  hip.y = p.y + HIP_Y + p.bob;
  const sy = p.y + SHOULDER_Y + p.bob - p.shrug * 10;
  rotInto(r.shoulderL, p.x - SHOULDER_X, sy, hip, p.lean);
  rotInto(r.shoulderR, p.x + SHOULDER_X, sy, hip, p.lean);
  ik(r.shoulderL, p.handL, ARM_UPPER, ARM_LOWER, r.elbowL, r.handL);
  ik(r.shoulderR, p.handR, ARM_UPPER, ARM_LOWER, r.elbowR, r.handR);
  rotInto(r.head, p.x, p.y + (HEAD_BOTTOM + HEAD_TOP) / 2 + p.bob, hip, p.lean);
  return r;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Legs, torso, head, headphones. Drawn behind the DJ table. */
export function drawBody(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number): void {
  const hipY = p.y + HIP_Y + p.bob;
  g.lineJoin = "round";
  g.lineCap = "round";

  // Legs and boots.
  g.strokeStyle = c.joint;
  g.lineWidth = 12;
  for (let side = -1; side <= 1; side += 2) {
    const lift = side > 0 ? p.footTap * 9 : 0;
    g.beginPath();
    g.moveTo(p.x + side * 18, hipY);
    g.lineTo(p.x + side * 20, p.y - 10 - lift * 0.5);
    g.stroke();
    g.save();
    g.translate(p.x + side * 22, p.y - 5);
    g.rotate(side > 0 ? -p.footTap * 0.35 : 0);
    g.fillStyle = c.accent;
    rr(g, -14, -6 - lift * 0.3, 30, 11, 5);
    g.fill();
    g.restore();
  }

  g.save();
  g.translate(p.x, hipY);
  g.rotate(p.lean);
  g.translate(-p.x, -hipY);
  const by = p.bob;

  // Torso: a rounded radio with a speaker grille.
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, p.x - 48, p.y + TORSO_TOP + by, 96, HIP_Y - TORSO_TOP + 8, 22);
  g.fill();
  g.stroke();
  g.fillStyle = c.bodyShade;
  rr(g, p.x - 40, p.y + HIP_Y + by - 14, 80, 12, 6);
  g.fill();
  // Grille.
  const gx = p.x, gy = p.y - 112 + by;
  g.fillStyle = c.visorBg;
  g.beginPath();
  g.arc(gx, gy, 23, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = c.joint;
  g.lineWidth = 2;
  for (let r = 6; r <= 20; r += 7) {
    g.beginPath();
    g.arc(gx, gy, r * (1 + p.chest * 0.06), 0, Math.PI * 2);
    g.stroke();
  }
  // Chest LEDs: the beat.
  for (let i = 0; i < 5; i++) {
    const on = p.chest * 5 > i;
    g.fillStyle = on ? c.glow : c.joint;
    g.globalAlpha = on ? 1 : 0.5;
    g.beginPath();
    g.arc(p.x - 24 + i * 12, p.y - 143 + by, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Neck and head.
  g.fillStyle = c.joint;
  g.fillRect(p.x - 10, p.y + HEAD_BOTTOM + by, 20, 10);
  const hx = p.x, hy = p.y + (HEAD_BOTTOM + HEAD_TOP) / 2 + by;
  g.save();
  g.translate(hx, hy);
  g.rotate(p.headTilt);
  // Antenna.
  g.strokeStyle = c.joint;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(14, -36);
  g.lineTo(20, -60);
  g.stroke();
  g.fillStyle = c.accent;
  g.globalAlpha = 0.35 + 0.65 * p.antenna;
  g.beginPath();
  g.arc(20, -63, 6, 0, Math.PI * 2);
  g.fill();
  if (p.antenna > 0.3) {
    g.globalAlpha = (p.antenna - 0.3) * 0.5;
    g.beginPath();
    g.arc(20, -63, 12, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // Head shell.
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, -46, -36, 92, 72, 18);
  g.fill();
  g.stroke();
  // Visor.
  g.fillStyle = c.visorBg;
  rr(g, -36, -24, 72, 44, 12);
  g.fill();
  drawFace(g, p, c, t);
  // Headphones.
  g.strokeStyle = c.outline;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, -8, 52, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  g.fillStyle = c.accent;
  for (let side = -1; side <= 1; side += 2) {
    rr(g, side * 52 - 8, -16, 16, 32, 7);
    g.fill();
  }
  g.restore();
  g.restore();
}

/** LED face on the visor (origin at the head centre). */
function drawFace(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number): void {
  if (p.visor <= 0.01 || p.expression === "off") return;
  g.save();
  g.beginPath();
  g.roundRect(-36, -24, 72, 44, 12);
  g.clip();
  g.globalAlpha = p.visor;
  g.fillStyle = c.glow;
  g.strokeStyle = c.glow;
  g.lineWidth = 4;
  g.lineCap = "round";
  g.shadowColor = c.glow;
  g.shadowBlur = 8;
  const ey = -4, ex = 14;
  const open = 1 - p.blink;
  switch (p.expression) {
    case "boot": {
      const y = -24 + ((t * 60) % 44);
      g.fillRect(-36, y, 72, 3);
      break;
    }
    case "neutral":
      for (let s = -1; s <= 1; s += 2) { rr(g, s * ex - 4, ey - 7 * open, 8, Math.max(2, 14 * open), 4); g.fill(); }
      line(g, -6, 12, 6, 12);
      break;
    case "happy":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey + 4, 7, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      g.beginPath(); g.arc(0, 8, 8, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      break;
    case "focus":
      for (let s = -1; s <= 1; s += 2) line(g, s * ex - 6, ey, s * ex + 6, ey);
      line(g, -4, 12, 4, 12);
      break;
    case "bored":
      for (let s = -1; s <= 1; s += 2) { rr(g, s * ex - 6, ey, 12, 5, 2); g.fill(); }
      line(g, -7, 13, 7, 11);
      break;
    case "worried":
      for (let s = -1; s <= 1; s += 2) { line(g, s * ex - 6, ey - 6 - s * 2, s * ex + 6, ey - 6 + s * 2); rr(g, s * ex - 3, ey, 6, 8, 3); g.fill(); }
      g.beginPath(); g.arc(0, 16, 6, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      break;
    case "wow":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey, 6, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.arc(0, 12, 4, 0, Math.PI * 2); g.stroke();
      break;
    case "sad":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey - 2, 7, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
      g.beginPath(); g.arc(0, 18, 7, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      break;
    case "wink":
      g.beginPath(); g.arc(-ex, ey + 4, 7, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      rr(g, ex - 4, ey - 7, 8, 14, 4); g.fill();
      g.beginPath(); g.arc(0, 8, 8, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      break;
  }
  g.restore();
}

function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

/** Arms (upper, lower, mitts). Drawn in front of the DJ table. */
export function drawArms(g: CanvasRenderingContext2D, r: Rig, c: RobotPalette): void {
  g.lineCap = "round";
  for (let side = 0; side < 2; side++) {
    const s = side ? r.shoulderR : r.shoulderL, e = side ? r.elbowR : r.elbowL, h = side ? r.handR : r.handL;
    g.strokeStyle = c.outline;
    g.lineWidth = 15;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(e.x, e.y);
    g.lineTo(h.x, h.y);
    g.stroke();
    g.strokeStyle = c.bodyShade;
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = c.joint;
    g.beginPath();
    g.arc(s.x, s.y, 7, 0, Math.PI * 2);
    g.moveTo(e.x + 7, e.y);
    g.arc(e.x, e.y, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.accent;
    g.strokeStyle = c.outline;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(h.x, h.y, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
