// A cartoon ant, seen from above: head, thorax and abdomen, six legs walking in a tripod gait, two
// antennae, and whatever it carries in its mandibles. Original procedural design; a designer could
// replace it with a Rive state machine driven by the same fields.

export interface AntLook {
  body: string;
  shine: string;
  leg: string;
}

export const Carry = { None: 0, Crumb: 1, Card: 2, Map: 3 } as const;
export type Carry = (typeof Carry)[keyof typeof Carry];

/**
 * Draw one ant at (x, y) facing `a` (radians), `s` px long / 14. `phase` drives the legs; `walk`
 * is 0 standing, 1 walking. `crumb` is the colour of a carried crumb.
 */
export function drawAnt(
  g: CanvasRenderingContext2D, x: number, y: number, a: number, s: number, phase: number, walk: number,
  look: AntLook, carry: Carry, crumb: string, hat = false,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.scale(s, s);
  // Legs: three per side from the thorax, alternating tripods.
  g.strokeStyle = look.leg;
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    for (let side = -1; side <= 1; side += 2) {
      const tri = (i + (side > 0 ? 1 : 0)) % 2;
      const swing = Math.sin(phase + tri * Math.PI) * 0.45 * walk;
      const base = (i - 1) * 0.75 + swing;
      const bx = 0.6 - i * 0.6;
      const kx = bx + Math.sin(base) * 2.4, ky = side * (2.2 + Math.cos(base) * 0.6);
      g.moveTo(bx, side * 0.8);
      g.lineTo(kx, ky);
      g.lineTo(kx + Math.sin(base) * 1.8 - 0.6, ky + side * 1.8);
    }
  }
  // Antennae.
  const wig = Math.sin(phase * 0.7) * 0.25;
  g.moveTo(4.6, -0.6);
  g.quadraticCurveTo(6.2, -1.8 + wig, 7.4, -2.6 + wig);
  g.moveTo(4.6, 0.6);
  g.quadraticCurveTo(6.2, 1.8 - wig, 7.4, 2.6 - wig);
  g.stroke();
  // Body.
  g.fillStyle = look.body;
  g.beginPath();
  g.ellipse(-3.6, 0, 3.1, 2.3, 0, 0, Math.PI * 2); // abdomen
  g.ellipse(0.4, 0, 1.6, 1.1, 0, 0, Math.PI * 2); // thorax
  g.ellipse(3.6, 0, 1.6, 1.5, 0, 0, Math.PI * 2); // head
  g.fill();
  g.fillStyle = look.shine;
  g.beginPath();
  g.ellipse(-4.1, -0.8, 1.2, 0.6, -0.3, 0, Math.PI * 2);
  g.fill();
  if (hat) {
    // The inspector's cap.
    g.fillStyle = "#2f5fa8";
    g.beginPath();
    g.ellipse(3.4, 0, 1.9, 1.9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(4.6, -1, 1.2, 2);
  }
  if (carry === Carry.Crumb) {
    g.fillStyle = crumb;
    g.beginPath();
    g.roundRect(5.4, -1.8, 3.6, 3.6, 1);
    g.fill();
  } else if (carry === Carry.Card || carry === Carry.Map) {
    g.fillStyle = "#fffdf4";
    g.fillRect(5.2, -2.6, 4.2, 5.2);
    g.strokeStyle = carry === Carry.Card ? "#c0392b" : "#2e86c1";
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(6, -1.4); g.lineTo(8.8, -1.4);
    g.moveTo(6, 0); g.lineTo(8.8, 0);
    g.moveTo(6, 1.4); g.lineTo(8, 1.4);
    g.stroke();
  }
  g.restore();
}
