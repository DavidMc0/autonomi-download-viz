// The few vector operations the flock steering needs (mutating, no allocation).

export class V3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { return this.set(v.x, v.y, v.z); }
  add(v: V3): this { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: V3): this { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  multiplyScalar(s: number): this { return this.set(this.x * s, this.y * s, this.z * s); }
  addScaledVector(v: V3, s: number): this { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  distanceTo(v: V3): number { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
