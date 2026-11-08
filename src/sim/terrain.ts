import type { Vec } from '../core/types';

export const enum Mat {
  Floor = 0,
  Water = 1,
  Ice = 2,
  Oil = 3,
  Lava = 4,
  Grass = 5,
  Fire = 6,
  Scorched = 7,
  Spikes = 8,
}

export const MAT_NAMES = ['floor', 'water', 'ice', 'oil', 'lava', 'grass', 'fire', 'scorched', 'spikes'] as const;
export type MatName = (typeof MAT_NAMES)[number];

export function matFromName(n: string): Mat {
  const i = MAT_NAMES.indexOf(n as MatName);
  return (i < 0 ? 0 : i) as Mat;
}

/**
 * Coarse material grid covering the arena floor. Fire spreads through grass and
 * oil, water freezes, ice melts, lava ignites. `version` bumps whenever cells
 * change so the renderer can cache its terrain layer.
 */
export class Terrain {
  readonly cols: number;
  readonly rows: number;
  readonly mat: Uint8Array;
  /** per-cell timer (fire burn time, ice melt time) */
  readonly timer: Float32Array;
  version = 0;
  private dirtyCells: number[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cell = 20,
  ) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.mat = new Uint8Array(this.cols * this.rows);
    this.timer = new Float32Array(this.cols * this.rows);
  }

  idx(x: number, y: number): number {
    const c = Math.floor(x / this.cell);
    const r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  at(p: Vec): Mat {
    const i = this.idx(p.x, p.y);
    return i < 0 ? Mat.Floor : (this.mat[i] as Mat);
  }

  set(i: number, m: Mat, timer = 0): void {
    if (i < 0) return;
    if (this.mat[i] !== m) {
      this.mat[i] = m;
      this.version++;
      this.dirtyCells.push(i);
    }
    this.timer[i] = timer;
  }

  center(i: number): Vec {
    const c = i % this.cols;
    const r = (i / this.cols) | 0;
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell };
  }

  /** Visit every cell whose centre is within radius of p. */
  forCircle(p: Vec, radius: number, fn: (i: number, d: number) => void): void {
    const c0 = Math.max(0, Math.floor((p.x - radius) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((p.x + radius) / this.cell));
    const r0 = Math.max(0, Math.floor((p.y - radius) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((p.y + radius) / this.cell));
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * this.cell - p.x;
        const cy = (r + 0.5) * this.cell - p.y;
        const d2 = cx * cx + cy * cy;
        if (d2 <= r2) fn(r * this.cols + c, Math.sqrt(d2));
      }
    }
  }

  paintRect(x0: number, y0: number, x1: number, y1: number, m: Mat): void {
    for (let y = y0; y < y1; y += this.cell) {
      for (let x = x0; x < x1; x += this.cell) this.set(this.idx(x + 1, y + 1), m);
    }
  }

  paintCircle(p: Vec, radius: number, m: Mat): void {
    this.forCircle(p, radius, (i) => this.set(i, m));
  }

  clear(): void {
    this.mat.fill(0);
    this.timer.fill(0);
    this.version++;
  }

  takeDirty(): number[] {
    const d = this.dirtyCells;
    this.dirtyCells = [];
    return d;
  }

  snapshot(): string {
    // RLE encode for presets / sharing
    let out = '';
    let prev = this.mat[0];
    let run = 0;
    for (let i = 0; i < this.mat.length; i++) {
      if (this.mat[i] === prev && run < 35) run++;
      else {
        out += prev.toString(36) + run.toString(36);
        prev = this.mat[i];
        run = 1;
      }
    }
    out += prev.toString(36) + run.toString(36);
    return out;
  }
}
