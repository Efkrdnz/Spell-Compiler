import { flakeSprite, glowSprite, smokeSprite, type Canvas } from './sprites';
import { glyphSprite } from './sigils';

/** Particle kinds. Additive kinds go in the emissive pass. */
export const enum PT {
  Spark = 0, // stretched streak along velocity (additive)
  Ember = 1, // glowing dot that rises and flickers (additive)
  Smoke = 2, // soft grey puff that grows (normal blend)
  Shard = 3, // spinning thin sliver (normal, lit)
  Mote = 4, // soft glow dot (additive)
  Ring = 5, // expanding stroke ring (additive)
  Glyph = 6, // floating rune (additive)
  Flake = 7, // frost flake (additive)
  Debris = 8, // chunky rotating rect (normal, lit)
}

/**
 * Pooled struct-of-arrays particle system. ~8000 particles, zero allocation
 * per frame. Colours are interned to indices so sprites can be cached.
 */
export class Particles {
  readonly cap: number;
  n = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly size: Float32Array;
  readonly grow: Float32Array;
  readonly rot: Float32Array;
  readonly vr: Float32Array;
  readonly drag: Float32Array;
  readonly lift: Float32Array;
  readonly type: Uint8Array;
  readonly color: Uint16Array;
  readonly seed: Uint16Array;
  private colors: string[] = [];
  private colorIdx = new Map<string, number>();
  private glow: Canvas[] = [];
  private smoke: Canvas[] = [];
  private flake: Canvas[] = [];
  /** global emission scale; lowered under heavy load */
  budget = 1;

  constructor(cap = 8000) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.life = f();
    this.max = f();
    this.size = f();
    this.grow = f();
    this.rot = f();
    this.vr = f();
    this.drag = f();
    this.lift = f();
    this.type = new Uint8Array(cap);
    this.color = new Uint16Array(cap);
    this.seed = new Uint16Array(cap);
  }

  c(color: string): number {
    let i = this.colorIdx.get(color);
    if (i === undefined) {
      i = this.colors.length;
      this.colors.push(color);
      this.colorIdx.set(color, i);
    }
    return i;
  }

  colorOf(i: number): string {
    return this.colors[i];
  }

  /** returns false when the pool is full */
  spawn(type: PT, x: number, y: number, vx: number, vy: number, life: number, size: number, color: number, grow = 0, drag = 0, lift = 0): boolean {
    if (this.n >= this.cap) return false;
    const i = this.n++;
    this.type[i] = type;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.lift[i] = lift;
    this.rot[i] = Math.random() * 6.283;
    this.vr[i] = (Math.random() - 0.5) * 12;
    this.color[i] = color;
    this.seed[i] = (Math.random() * 65535) | 0;
    return true;
  }

  /** radial burst helper */
  burst(type: PT, x: number, y: number, count: number, speed: number, life: number, size: number, color: number, opts: { grow?: number; drag?: number; lift?: number; spread?: number; jitter?: number } = {}): void {
    const n = Math.round(count * this.budget);
    const jitter = opts.jitter ?? 0.6;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283;
      const s = speed * (1 - jitter + Math.random() * jitter);
      const sp = opts.spread ?? 0;
      this.spawn(
        type,
        x + (Math.random() - 0.5) * sp,
        y + (Math.random() - 0.5) * sp,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.7),
        color,
        opts.grow ?? 0,
        opts.drag ?? 2,
        opts.lift ?? 0,
      );
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k - this.lift[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      i++;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.type[i] = this.type[j];
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.max[i] = this.max[j];
    this.size[i] = this.size[j];
    this.grow[i] = this.grow[j];
    this.rot[i] = this.rot[j];
    this.vr[i] = this.vr[j];
    this.drag[i] = this.drag[j];
    this.lift[i] = this.lift[j];
    this.color[i] = this.color[j];
    this.seed[i] = this.seed[j];
  }

  clear(): void {
    this.n = 0;
  }

  private sprites(i: number, kind: 'glow' | 'smoke' | 'flake'): Canvas {
    const ci = this.color[i];
    const arr = kind === 'glow' ? this.glow : kind === 'smoke' ? this.smoke : this.flake;
    let s = arr[ci];
    if (!s) s = arr[ci] = kind === 'glow' ? glowSprite(this.colors[ci]) : kind === 'smoke' ? smokeSprite(this.colors[ci]) : flakeSprite(this.colors[ci]);
    return s;
  }

  /**
   * Normal-blend pass (smoke, debris, shards). `S`,`ox`,`oy` are the world→device
   * transform so we can set per-particle rotation matrices without save/restore.
   */
  drawNormal(g: CanvasRenderingContext2D, S: number, ox: number, oy: number): void {
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      if (t !== PT.Smoke && t !== PT.Shard && t !== PT.Debris) continue;
      const f = this.life[i] / this.max[i];
      const x = this.x[i];
      const y = this.y[i];
      const s = this.size[i];
      if (t === PT.Smoke) {
        g.globalAlpha = Math.min(1, f * 1.6) * 0.85;
        g.drawImage(this.sprites(i, 'smoke'), x - s, y - s, s * 2, s * 2);
      } else {
        const c = Math.cos(this.rot[i]) * S;
        const sn = Math.sin(this.rot[i]) * S;
        g.setTransform(c, sn, -sn, c, x * S + ox, y * S + oy);
        g.globalAlpha = Math.min(1, f * 3);
        g.fillStyle = this.colors[this.color[i]];
        if (t === PT.Shard) g.fillRect(-s, -s * 0.18, s * 2, s * 0.36);
        else g.fillRect(-s * 0.6, -s * 0.45, s * 1.2, s * 0.9);
      }
    }
    g.setTransform(S, 0, 0, S, ox, oy);
    g.globalAlpha = 1;
  }

  /** Additive pass (sparks, embers, motes, rings, glyphs, flakes). */
  drawAdditive(g: CanvasRenderingContext2D, S: number, ox: number, oy: number): void {
    let lastStroke = -1;
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      if (t === PT.Smoke || t === PT.Shard || t === PT.Debris) continue;
      const f = this.life[i] / this.max[i];
      const x = this.x[i];
      const y = this.y[i];
      const s = this.size[i];
      switch (t) {
        case PT.Spark: {
          if (lastStroke !== this.color[i]) {
            g.strokeStyle = this.colors[this.color[i]];
            lastStroke = this.color[i];
          }
          g.globalAlpha = f;
          g.lineWidth = s * (0.4 + f * 0.6);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - this.vx[i] * 0.035, y - this.vy[i] * 0.035);
          g.stroke();
          break;
        }
        case PT.Ember: {
          const fl = 0.65 + 0.35 * Math.sin(this.seed[i] + this.life[i] * 30);
          g.globalAlpha = Math.min(1, f * 2) * fl;
          const r = s * (0.5 + f * 0.5) * 2.2;
          g.drawImage(this.sprites(i, 'glow'), x - r, y - r, r * 2, r * 2);
          break;
        }
        case PT.Mote: {
          g.globalAlpha = Math.sin(Math.PI * f) * 0.9;
          const r = s * 2;
          g.drawImage(this.sprites(i, 'glow'), x - r, y - r, r * 2, r * 2);
          break;
        }
        case PT.Ring: {
          if (lastStroke !== this.color[i]) {
            g.strokeStyle = this.colors[this.color[i]];
            lastStroke = this.color[i];
          }
          g.globalAlpha = f * 0.8;
          g.lineWidth = 1 + 2 * f;
          g.beginPath();
          g.arc(x, y, Math.max(0.1, s), 0, 6.2832);
          g.stroke();
          break;
        }
        case PT.Glyph: {
          g.globalAlpha = Math.sin(Math.PI * f);
          const r = s;
          g.drawImage(glyphSprite(this.seed[i], this.colors[this.color[i]]), x - r, y - r, r * 2, r * 2);
          break;
        }
        case PT.Flake: {
          g.globalAlpha = Math.min(1, f * 2);
          const c = Math.cos(this.rot[i]) * S;
          const sn = Math.sin(this.rot[i]) * S;
          g.setTransform(c, sn, -sn, c, x * S + ox, y * S + oy);
          g.drawImage(this.sprites(i, 'flake'), -s, -s, s * 2, s * 2);
          g.setTransform(S, 0, 0, S, ox, oy);
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }
}
