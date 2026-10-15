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
  handL: Pt3;
  handR: Pt3;
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

export type RobotStyle = "cute" | "retro" | "sleek";

/** A point with depth (+z is toward the viewer). The arms are solved in 3D and drawn flat. */
export interface Pt3 extends Pt { z: number }

// Body geometry (relative to the feet, y up is negative).
const HIP_Y = -64;
const TORSO_TOP = -160;
const HEAD_BOTTOM = -168;
const HEAD_TOP = -240;
const SHOULDER_Y = -146;
const SHOULDER_X: Record<RobotStyle, number> = { cute: 50, retro: 56, sleek: 42 };
export const ARM_UPPER = 48;
export const ARM_LOWER = 46;

export interface Rig {
  shoulderL: Pt3;
  shoulderR: Pt3;
  elbowL: Pt3;
  elbowR: Pt3;
  handL: Pt3;
  handR: Pt3;
  head: Pt; // visor centre
}

function rotInto(out: Pt, x: number, y: number, o: Pt, a: number): Pt {
  const c = Math.cos(a), s = Math.sin(a), dx = x - o.x, dy = y - o.y;
  out.x = o.x + dx * c - dy * s;
  out.y = o.y + dx * s + dy * c;
  return out;
}

/**
 * Two-bone IK in 3D into `elbow` and `hand`. The elbow bends toward a pole that points down, out to
 * `side` (-1 left, +1 right) and a little back, so it never flips inward as the shoulders bob. Hands
 * reaching forward (z > 0) foreshorten the arm instead of folding it into a chicken wing.
 */
export function ik(s: Pt3, t: Pt3, l1: number, l2: number, side: number, elbow: Pt3, hand: Pt3): void {
  let dx = t.x - s.x, dy = t.y - s.y, dz = t.z - s.z;
  let d = Math.hypot(dx, dy, dz);
  const max = l1 + l2 - 0.5, min = Math.abs(l1 - l2) + 1;
  if (d > max) { const k = max / d; dx *= k; dy *= k; dz *= k; d = max; }
  if (d < min) { const k = min / Math.max(d, 1e-3); dx *= k; dy *= k; dz *= k; d = min; }
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const a = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Pole, minus its component along the reach.
  let px = side, py = 0.55, pz = -0.3;
  const dot = px * ux + py * uy + pz * uz;
  px -= dot * ux; py -= dot * uy; pz -= dot * uz;
  const pl = Math.hypot(px, py, pz) || 1;
  elbow.x = s.x + ux * a + (px / pl) * hgt;
  elbow.y = s.y + uy * a + (py / pl) * hgt;
  elbow.z = s.z + uz * a + (pz / pl) * hgt;
  hand.x = s.x + dx;
  hand.y = s.y + dy;
  hand.z = s.z + dz;
}

export function newRig(): Rig {
  const p = () => ({ x: 0, y: 0, z: 0 });
  return { shoulderL: p(), shoulderR: p(), elbowL: p(), elbowR: p(), handL: p(), handR: p(), head: { x: 0, y: 0 } };
}

const hip: Pt = { x: 0, y: 0 };
/** Solve the arms for a pose, into `r` (no allocation). */
export function rig(p: RobotPose, r: Rig, style: RobotStyle = "cute"): Rig {
  hip.x = p.x;
  hip.y = p.y + HIP_Y + p.bob;
  const sy = p.y + SHOULDER_Y + p.bob - p.shrug * 10, sx = SHOULDER_X[style];
  rotInto(r.shoulderL, p.x - sx, sy, hip, p.lean);
  rotInto(r.shoulderR, p.x + sx, sy, hip, p.lean);
  ik(r.shoulderL, p.handL, ARM_UPPER, ARM_LOWER, -1, r.elbowL, r.handL);
  ik(r.shoulderR, p.handR, ARM_UPPER, ARM_LOWER, 1, r.elbowR, r.handR);
  rotInto(r.head, p.x, p.y + (HEAD_BOTTOM + HEAD_TOP) / 2 + p.bob, hip, p.lean);
  return r;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** The visor (face screen) per style, relative to the head centre. */
const VISOR: Record<RobotStyle, { x: number; y: number; w: number; h: number; r: number }> = {
  cute: { x: -36, y: -24, w: 72, h: 44, r: 12 },
  retro: { x: -42, y: -24, w: 66, h: 48, r: 10 },
  sleek: { x: -38, y: -14, w: 76, h: 28, r: 14 },
};

/** Legs, torso, head, headphones. Drawn behind the DJ table. */
export function drawBody(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number, style: RobotStyle = "cute"): void {
  const hipY = p.y + HIP_Y + p.bob;
  g.lineJoin = "round";
  g.lineCap = "round";

  // Legs and feet.
  g.strokeStyle = c.joint;
  g.lineWidth = style === "retro" ? 16 : style === "sleek" ? 8 : 12;
  const legX = style === "sleek" ? 14 : 18;
  for (let side = -1; side <= 1; side += 2) {
    const lift = side > 0 ? p.footTap * 9 : 0;
    g.beginPath();
    g.moveTo(p.x + side * legX, hipY);
    g.lineTo(p.x + side * (legX + 2), p.y - 10 - lift * 0.5);
    g.stroke();
    g.save();
    g.translate(p.x + side * (legX + 4), p.y - 5);
    g.rotate(side > 0 ? -p.footTap * 0.35 : 0);
    g.fillStyle = c.accent;
    if (style === "retro") rr(g, -17, -10 - lift * 0.3, 36, 15, 2);
    else if (style === "sleek") { g.beginPath(); g.ellipse(2, -2 - lift * 0.3, 15, 6, 0, 0, Math.PI * 2); }
    else rr(g, -14, -6 - lift * 0.3, 30, 11, 5);
    g.fill();
    g.restore();
  }

  g.save();
  g.translate(p.x, hipY);
  g.rotate(p.lean);
  g.translate(-p.x, -hipY);
  const by = p.bob;

  if (style === "retro") retroTorso(g, p, c, by);
  else if (style === "sleek") sleekTorso(g, p, c, by);
  else cuteTorso(g, p, c, by);

  // Neck and head.
  g.fillStyle = c.joint;
  if (style === "retro") {
    // A concertina neck.
    for (let i = 0; i < 3; i++) g.fillRect(p.x - 12 + (i & 1) * 2, p.y + HEAD_BOTTOM + by + i * 3.5, 24 - (i & 1) * 4, 3);
  } else g.fillRect(p.x - (style === "sleek" ? 6 : 10), p.y + HEAD_BOTTOM + by, style === "sleek" ? 12 : 20, 10);
  const hx = p.x, hy = p.y + (HEAD_BOTTOM + HEAD_TOP) / 2 + by;
  g.save();
  g.translate(hx, hy);
  g.rotate(p.headTilt);
  if (style === "retro") retroHead(g, p, c, t);
  else if (style === "sleek") sleekHead(g, p, c, t);
  else cuteHead(g, p, c, t);
  g.restore();
  g.restore();
}

function cuteTorso(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, by: number): void {
  // A rounded radio with a speaker grille.
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, p.x - 48, p.y + TORSO_TOP + by, 96, HIP_Y - TORSO_TOP + 8, 22);
  g.fill();
  g.stroke();
  g.fillStyle = c.bodyShade;
  rr(g, p.x - 40, p.y + HIP_Y + by - 14, 80, 12, 6);
  g.fill();
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
}

function retroTorso(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, by: number): void {
  // A boxy cabinet with rivets, two dials and a VU meter that swings with the beat.
  const x0 = p.x - 54, y0 = p.y + TORSO_TOP + by, w = 108, h = HIP_Y - TORSO_TOP + 10;
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, x0, y0, w, h, 6);
  g.fill();
  g.stroke();
  g.fillStyle = c.bodyShade;
  g.fillRect(x0 + 3, y0 + h - 16, w - 6, 13);
  g.fillStyle = c.outline;
  for (const [rx, ry] of [[6, 6], [w - 6, 6], [6, h - 22], [w - 6, h - 22]]) {
    g.beginPath();
    g.arc(x0 + rx, y0 + ry, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  // VU meter.
  const mx = p.x, my = y0 + 40;
  g.fillStyle = "#f6ecd0";
  rr(g, mx - 30, my - 24, 60, 30, 4);
  g.fill();
  g.strokeStyle = c.outline;
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = c.accent;
  g.beginPath();
  g.arc(mx, my + 4, 22, Math.PI * 1.2, Math.PI * 1.8);
  g.stroke();
  const ang = Math.PI * (1.25 + 0.5 * Math.min(1, p.chest));
  g.strokeStyle = c.outline;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(mx, my + 4);
  g.lineTo(mx + Math.cos(ang) * 22, my + 4 + Math.sin(ang) * 22);
  g.stroke();
  // Dials, with an amber lamp between them.
  for (let i = -1; i <= 1; i += 2) {
    const dx = p.x + i * 26, dy = y0 + 66;
    g.fillStyle = c.joint;
    g.beginPath();
    g.arc(dx, dy, 9, 0, Math.PI * 2);
    g.fill();
    const a = (i < 0 ? -0.6 : 0.9) + p.chest * 0.4 * i - Math.PI / 2;
    g.strokeStyle = c.body;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(dx, dy);
    g.lineTo(dx + Math.cos(a) * 7, dy + Math.sin(a) * 7);
    g.stroke();
  }
  g.fillStyle = c.glow;
  g.globalAlpha = 0.4 + 0.6 * p.chest;
  g.beginPath();
  g.arc(p.x, y0 + 66, 4, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

function sleekTorso(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, by: number): void {
  // A tapered glossy shell with a vertical light strip.
  const top = p.y + TORSO_TOP + by, bot = p.y + HIP_Y + by + 6;
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(p.x - 44, top + 14);
  g.quadraticCurveTo(p.x - 44, top, p.x - 28, top);
  g.lineTo(p.x + 28, top);
  g.quadraticCurveTo(p.x + 44, top, p.x + 44, top + 14);
  g.quadraticCurveTo(p.x + 36, bot - 10, p.x + 22, bot);
  g.lineTo(p.x - 22, bot);
  g.quadraticCurveTo(p.x - 36, bot - 10, p.x - 44, top + 14);
  g.closePath();
  g.fill();
  g.stroke();
  // Gloss.
  g.strokeStyle = "#ffffff";
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(p.x - 32, top + 12);
  g.quadraticCurveTo(p.x - 30, top + 40, p.x - 24, top + 60);
  g.stroke();
  g.globalAlpha = 1;
  // Light strip: the beat, filling from the bottom.
  g.fillStyle = c.visorBg;
  rr(g, p.x - 4, top + 18, 8, 58, 4);
  g.fill();
  for (let i = 0; i < 5; i++) {
    const on = p.chest * 5 > 4 - i;
    g.fillStyle = on ? c.glow : c.joint;
    g.globalAlpha = on ? 1 : 0.35;
    rr(g, p.x - 2, top + 22 + i * 11, 4, 7, 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function cuteHead(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number): void {
  antenna(g, p, c, 14, -36, 20, -60, 6);
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, -46, -36, 92, 72, 18);
  g.fill();
  g.stroke();
  visor(g, p, c, t, "cute");
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
}

function retroHead(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number): void {
  // A little TV set: rabbit ears, a CRT face and two knobs.
  antenna(g, p, c, -10, -38, -30, -66, 4);
  antenna(g, p, c, 10, -38, 30, -66, 4);
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  rr(g, -50, -38, 100, 76, 8);
  g.fill();
  g.stroke();
  g.fillStyle = c.bodyShade;
  rr(g, -46, -30, 74, 60, 12);
  g.fill();
  visor(g, p, c, t, "retro");
  g.fillStyle = c.joint;
  g.beginPath();
  g.arc(39, -16, 5, 0, Math.PI * 2);
  g.arc(39, 0, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = c.outline;
  for (let i = 0; i < 3; i++) g.fillRect(34, 11 + i * 5, 10, 2);
  // Chunky box headphones.
  g.strokeStyle = c.outline;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(-56, -6);
  g.lineTo(-56, -44);
  g.lineTo(56, -44);
  g.lineTo(56, -6);
  g.stroke();
  g.fillStyle = c.accent;
  for (let side = -1; side <= 1; side += 2) {
    rr(g, side * 56 - 10, -20, 20, 30, 3);
    g.fill();
  }
}

function sleekHead(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number): void {
  // A glossy egg with a visor band, and a light fin on top for the antenna.
  g.fillStyle = c.accent;
  g.globalAlpha = 0.35 + 0.65 * p.antenna;
  rr(g, -14, -44, 28, 6, 3);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = c.body;
  g.strokeStyle = c.outline;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, 46, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  visor(g, p, c, t, "sleek");
  g.strokeStyle = "#ffffff";
  g.globalAlpha = 0.6;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 38, Math.PI * 1.15, Math.PI * 1.4);
  g.stroke();
  g.globalAlpha = 1;
  // Slim earpieces on a thin band.
  g.strokeStyle = c.outline;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, -4, 50, Math.PI * 1.12, Math.PI * 1.88);
  g.stroke();
  g.fillStyle = c.accent;
  for (let side = -1; side <= 1; side += 2) {
    g.beginPath();
    g.ellipse(side * 47, -2, 6, 14, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function antenna(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, x0: number, y0: number, x1: number, y1: number, rad: number): void {
  g.strokeStyle = c.joint;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.fillStyle = c.accent;
  g.globalAlpha = 0.35 + 0.65 * p.antenna;
  g.beginPath();
  g.arc(x1, y1 - rad / 2, rad, 0, Math.PI * 2);
  g.fill();
  if (p.antenna > 0.3) {
    g.globalAlpha = (p.antenna - 0.3) * 0.5;
    g.beginPath();
    g.arc(x1, y1 - rad / 2, rad * 2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function visor(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number, style: RobotStyle): void {
  const v = VISOR[style];
  g.fillStyle = c.visorBg;
  rr(g, v.x, v.y, v.w, v.h, v.r);
  g.fill();
  drawFace(g, p, c, t, style);
  if (style === "retro") {
    // Scanlines and a glint on the curved glass.
    g.save();
    rr(g, v.x, v.y, v.w, v.h, v.r);
    g.clip();
    g.fillStyle = "#000";
    g.globalAlpha = 0.25;
    for (let y = v.y; y < v.y + v.h; y += 3) g.fillRect(v.x, y, v.w, 1);
    g.globalAlpha = 0.12;
    g.fillStyle = "#fff";
    g.beginPath();
    g.ellipse(v.x + 16, v.y + 10, 18, 7, -0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** LED face on the visor (origin at the head centre). */
function drawFace(g: CanvasRenderingContext2D, p: RobotPose, c: RobotPalette, t: number, style: RobotStyle): void {
  if (p.visor <= 0.01 || p.expression === "off") return;
  const v = VISOR[style];
  g.save();
  g.beginPath();
  g.roundRect(v.x, v.y, v.w, v.h, v.r);
  g.clip();
  g.globalAlpha = p.visor;
  g.fillStyle = c.glow;
  g.strokeStyle = c.glow;
  g.lineWidth = style === "retro" ? 5 : style === "sleek" ? 3 : 4;
  g.lineCap = style === "retro" ? "square" : "round";
  g.shadowColor = c.glow;
  g.shadowBlur = style === "sleek" ? 10 : 8;
  if (p.expression === "boot") {
    g.fillRect(v.x, v.y + ((t * 60) % v.h), v.w, 3);
    g.restore();
    return;
  }
  // Retro's screen sits left of its knobs. Sleek's band is short, so its face is squashed and shows
  // a mouth only for big feelings.
  if (style === "retro") g.translate(v.x + v.w / 2, 0);
  if (style === "sleek") { g.translate(0, 3); g.scale(1.1, 0.62); }
  const mouth = style !== "sleek" || p.expression === "happy" || p.expression === "sad" || p.expression === "wink" || p.expression === "wow";
  const ey = -4, ex = 14;
  const open = 1 - p.blink;
  const er = style === "retro" ? 1 : 4;
  switch (p.expression) {
    case "neutral":
      for (let s = -1; s <= 1; s += 2) { rr(g, s * ex - 4, ey - 7 * open, 8, Math.max(2, 14 * open), er); g.fill(); }
      if (mouth) line(g, -6, 12, 6, 12);
      break;
    case "happy":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey + 4, 7, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      if (mouth) { g.beginPath(); g.arc(0, 8, 8, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
      break;
    case "focus":
      for (let s = -1; s <= 1; s += 2) line(g, s * ex - 6, ey, s * ex + 6, ey);
      if (mouth) line(g, -4, 12, 4, 12);
      break;
    case "bored":
      for (let s = -1; s <= 1; s += 2) { rr(g, s * ex - 6, ey, 12, 5, 2); g.fill(); }
      if (mouth) line(g, -7, 13, 7, 11);
      break;
    case "worried":
      for (let s = -1; s <= 1; s += 2) { line(g, s * ex - 6, ey - 6 - s * 2, s * ex + 6, ey - 6 + s * 2); rr(g, s * ex - 3, ey, 6, 8, 3); g.fill(); }
      if (mouth) { g.beginPath(); g.arc(0, 16, 6, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      break;
    case "wow":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey, 6, 0, Math.PI * 2); g.stroke(); }
      if (mouth) { g.beginPath(); g.arc(0, 12, 4, 0, Math.PI * 2); g.stroke(); }
      break;
    case "sad":
      for (let s = -1; s <= 1; s += 2) { g.beginPath(); g.arc(s * ex, ey - 2, 7, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
      if (mouth) { g.beginPath(); g.arc(0, 18, 7, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      break;
    case "wink":
      g.beginPath(); g.arc(-ex, ey + 4, 7, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      rr(g, ex - 4, ey - 7, 8, 14, er); g.fill();
      if (mouth) { g.beginPath(); g.arc(0, 8, 8, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
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

/** Arms (upper, lower, hands). Drawn in front of the DJ table. Hands nearer the viewer draw larger. */
export function drawArms(g: CanvasRenderingContext2D, r: Rig, c: RobotPalette, style: RobotStyle = "cute"): void {
  g.lineCap = "round";
  const outer = style === "sleek" ? 10 : style === "retro" ? 17 : 15;
  const inner = style === "sleek" ? 6 : style === "retro" ? 12 : 10;
  for (let side = 0; side < 2; side++) {
    const s = side ? r.shoulderR : r.shoulderL, e = side ? r.elbowR : r.elbowL, h = side ? r.handR : r.handL;
    g.strokeStyle = c.outline;
    g.lineWidth = outer;
    g.beginPath();
    g.moveTo(s.x, s.y);
    g.lineTo(e.x, e.y);
    g.lineTo(h.x, h.y);
    g.stroke();
    g.strokeStyle = c.bodyShade;
    g.lineWidth = inner;
    g.stroke();
    if (style === "retro") {
      // Ribbed hose arms.
      g.strokeStyle = c.joint;
      g.lineWidth = 1.5;
      for (let seg = 0; seg < 2; seg++) {
        const a = seg ? e : s, b = seg ? h : e;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, n = Math.floor(len / 7);
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        for (let i = 1; i < n; i++) {
          const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
          g.beginPath();
          g.moveTo(x - nx * 5, y - ny * 5);
          g.lineTo(x + nx * 5, y + ny * 5);
          g.stroke();
        }
      }
    }
    g.fillStyle = c.joint;
    const jr = style === "sleek" ? 4.5 : 7;
    g.beginPath();
    g.arc(s.x, s.y, jr, 0, Math.PI * 2);
    g.moveTo(e.x + jr, e.y);
    g.arc(e.x, e.y, jr, 0, Math.PI * 2);
    g.fill();
    const hr = (style === "sleek" ? 7 : 9) * (1 + Math.max(-0.2, Math.min(0.25, h.z / 240)));
    g.fillStyle = c.accent;
    g.strokeStyle = c.outline;
    g.lineWidth = style === "sleek" ? 1.5 : 2.5;
    if (style === "retro") rr(g, h.x - hr, h.y - hr, hr * 2, hr * 2, 3);
    else { g.beginPath(); g.arc(h.x, h.y, hr, 0, Math.PI * 2); }
    g.fill();
    g.stroke();
  }
}
