import type { Vec } from '../core/types';
import type { Entity } from './entity';

/** Uniform spatial hash used for broadphase collision and radius queries. */
export class SpatialHash {
  private cells = new Map<number, Entity[]>();
  constructor(readonly size = 64) {}

  clear(): void {
    this.cells.clear();
  }

  private key(cx: number, cy: number): number {
    return (cx + 512) * 4096 + (cy + 512);
  }

  insert(e: Entity): void {
    const s = this.size;
    const hw = e.shape === 'box' ? e.hw : e.r;
    const hh = e.shape === 'box' ? e.hh : e.r;
    const x0 = Math.floor((e.pos.x - hw) / s);
    const x1 = Math.floor((e.pos.x + hw) / s);
    const y0 = Math.floor((e.pos.y - hh) / s);
    const y1 = Math.floor((e.pos.y + hh) / s);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = this.key(x, y);
        let bucket = this.cells.get(k);
        if (!bucket) this.cells.set(k, (bucket = []));
        bucket.push(e);
      }
  }

  /** Candidates whose cells overlap the circle. May contain duplicates' removed. */
  query(p: Vec, r: number, out: Entity[] = []): Entity[] {
    const s = this.size;
    const x0 = Math.floor((p.x - r) / s);
    const x1 = Math.floor((p.x + r) / s);
    const y0 = Math.floor((p.y - r) / s);
    const y1 = Math.floor((p.y + r) / s);
    out.length = 0;
    const seen = new Set<number>();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const b = this.cells.get(this.key(x, y));
        if (!b) continue;
        for (const e of b) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            out.push(e);
          }
        }
      }
    return out;
  }
}

export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

/** Narrow-phase test. Normal points from a to b. */
export function collide(a: Entity, b: Entity): Contact | null {
  if (a.shape === 'circle' && b.shape === 'circle') return circleCircle(a.pos, a.r, b.pos, b.r);
  if (a.shape === 'circle' && b.shape === 'box') return circleBox(a.pos, a.r, b);
  if (a.shape === 'box' && b.shape === 'circle') {
    const c = circleBox(b.pos, b.r, a);
    if (!c) return null;
    return { nx: -c.nx, ny: -c.ny, depth: c.depth };
  }
  return boxBox(a, b);
}

export function circleCircle(pa: Vec, ra: number, pb: Vec, rb: number): Contact | null {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const rr = ra + rb;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { nx: 1, ny: 0, depth: rr };
  return { nx: dx / d, ny: dy / d, depth: rr - d };
}

/** Circle (centre p, radius r) vs axis-aligned box b. Normal points circle -> box. */
export function circleBox(p: Vec, r: number, b: Entity): Contact | null {
  const minX = b.pos.x - b.hw;
  const maxX = b.pos.x + b.hw;
  const minY = b.pos.y - b.hh;
  const maxY = b.pos.y + b.hh;
  const cx = Math.max(minX, Math.min(p.x, maxX));
  const cy = Math.max(minY, Math.min(p.y, maxY));
  const dx = cx - p.x;
  const dy = cy - p.y;
  const d2 = dx * dx + dy * dy;
  const inside = p.x > minX && p.x < maxX && p.y > minY && p.y < maxY;
  if (!inside) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2) || 1e-6;
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // centre inside the box: push out along the shallowest axis
  const left = p.x - minX;
  const right = maxX - p.x;
  const top = p.y - minY;
  const bottom = maxY - p.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: 1, ny: 0, depth: left + r };
  if (m === right) return { nx: -1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: 1, depth: top + r };
  return { nx: 0, ny: -1, depth: bottom + r };
}

export function boxBox(a: Entity, b: Entity): Contact | null {
  const dx = b.pos.x - a.pos.x;
  const px = a.hw + b.hw - Math.abs(dx);
  if (px <= 0) return null;
  const dy = b.pos.y - a.pos.y;
  const py = a.hh + b.hh - Math.abs(dy);
  if (py <= 0) return null;
  if (px < py) return { nx: Math.sign(dx) || 1, ny: 0, depth: px };
  return { nx: 0, ny: Math.sign(dy) || 1, depth: py };
}

/**
 * Resolve a contact between two bodies: positional correction weighted by
 * inverse mass, then a restitution impulse along the normal plus a little
 * tangential friction. Returns the closing speed (for impact damage).
 */
export function resolve(a: Entity, b: Entity, c: Contact): number {
  const im = a.invMass + b.invMass;
  if (im <= 0) return 0;
  const slop = 0.2;
  const corr = Math.max(c.depth - slop, 0) / im * 0.85;
  a.pos.x -= c.nx * corr * a.invMass;
  a.pos.y -= c.ny * corr * a.invMass;
  b.pos.x += c.nx * corr * b.invMass;
  b.pos.y += c.ny * corr * b.invMass;
  const rvx = b.vel.x - a.vel.x;
  const rvy = b.vel.y - a.vel.y;
  const vn = rvx * c.nx + rvy * c.ny;
  if (vn > 0) return 0;
  const e = Math.min(a.restitution, b.restitution);
  const j = (-(1 + e) * vn) / im;
  a.vel.x -= j * c.nx * a.invMass;
  a.vel.y -= j * c.ny * a.invMass;
  b.vel.x += j * c.nx * b.invMass;
  b.vel.y += j * c.ny * b.invMass;
  // friction
  const tx = -c.ny;
  const ty = c.nx;
  const vt = rvx * tx + rvy * ty;
  const jt = (-vt / im) * 0.15;
  a.vel.x -= jt * tx * a.invMass;
  a.vel.y -= jt * ty * a.invMass;
  b.vel.x += jt * tx * b.invMass;
  b.vel.y += jt * ty * b.invMass;
  return -vn;
}

/** Ray vs circle; returns distance along ray or -1. dir must be normalised. */
export function rayCircle(o: Vec, d: Vec, p: Vec, r: number): number {
  const ox = o.x - p.x;
  const oy = o.y - p.y;
  const b = ox * d.x + oy * d.y;
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Ray vs AABB (slab method); returns distance and hit normal, or null. */
export function rayBox(o: Vec, d: Vec, b: Entity): { t: number; nx: number; ny: number } | null {
  const minX = b.pos.x - b.hw;
  const maxX = b.pos.x + b.hw;
  const minY = b.pos.y - b.hh;
  const maxY = b.pos.y + b.hh;
  if (o.x > minX && o.x < maxX && o.y > minY && o.y < maxY) return { t: 0, nx: -d.x, ny: -d.y };
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < minX || o.x > maxX) return null;
  } else {
    let t1 = (minX - o.x) / d.x;
    let t2 = (maxX - o.x) / d.x;
    let n = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < minY || o.y > maxY) return null;
  } else {
    let t1 = (minY - o.y) / d.y;
    let t2 = (maxY - o.y) / d.y;
    let n = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0 || tmin < 0) return null;
  return { t: tmin, nx, ny };
}

/** Distance from point p to the segment ab. */
export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
