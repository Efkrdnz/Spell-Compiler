import { ELEMENT_INFO, type Element, type Vec } from '../core/types';
import type { EntityKind } from '../sim/entity';
import type { FxEvent } from '../sim/fx';
import type { Lighting } from './lighting';
import { PT, type Particles } from './particles';
import { coreSprite, glowSprite, rgba } from './sprites';
import { drawSigil } from './sigils';

const TAU = Math.PI * 2;

interface Bolt {
  pts: Vec[];
  color: string;
  glow: string;
  width: number;
  t: number;
  max: number;
  branches: number;
}
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  t: number;
  max: number;
  color: string;
  width: number;
}
interface Flash {
  x: number;
  y: number;
  r: number;
  color: string;
  t: number;
  max: number;
  intensity: number;
}
interface FloatText {
  x: number;
  y: number;
  vy: number;
  t: number;
  max: number;
  text: string;
  color: string;
  size: number;
}
interface Sigil {
  x: number;
  y: number;
  seed: number;
  color: string;
  t: number;
  max: number;
  r: number;
}
export interface Ripple {
  x: number;
  y: number;
  r: number;
  t: number;
  max: number;
  strength: number;
}
interface Streak {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  max: number;
  color: string;
}
interface Mark {
  x: number;
  y: number;
  t: number;
  max: number;
}

const DEBRIS: Partial<Record<EntityKind, { colors: string[]; smoke?: string; spark?: string }>> = {
  crate: { colors: ['#86592f', '#5c3a1c', '#a3713d'], smoke: '#3a2c22' },
  barrel: { colors: ['#a3201f', '#3b3b46', '#5c0f12'] },
  metal: { colors: ['#8a94a8', '#5d6576', '#c8d0e0'], spark: '#fff3c4' },
  wall: { colors: ['#4a445f', '#3d3850', '#5b5470'], smoke: '#3a3548' },
  boulder: { colors: ['#6d6258', '#4a4038', '#8a7d70'], smoke: '#4a4038' },
  iceblock: { colors: ['#bfefff', '#8fd8f0', '#ffffff'] },
  barrier: { colors: ['#e8eefc'] },
};

/** One-shot visual effects driven by the sim's FX event stream. */
export class Effects {
  bolts: Bolt[] = [];
  rings: Ring[] = [];
  flashes: Flash[] = [];
  numbers: FloatText[] = [];
  sigils: Sigil[] = [];
  ripples: Ripple[] = [];
  streaks: Streak[] = [];
  marks: Mark[] = [];

  /** heavy events handled this frame (bursts shrink when many land at once) */
  private frameLoad = 0;

  constructor(private P: Particles) {}

  /** call once per frame before handling events */
  beginFrame(): void {
    this.frameLoad = 0;
  }

  clear(): void {
    this.bolts = [];
    this.rings = [];
    this.flashes = [];
    this.numbers = [];
    this.sigils = [];
    this.ripples = [];
    this.streaks = [];
    this.marks = [];
  }

  private ring(x: number, y: number, r0: number, r1: number, max: number, color: string, width: number): void {
    if (this.rings.length < 220) this.rings.push({ x, y, r0, r1, t: 0, max, color, width });
  }
  private flash(x: number, y: number, r: number, color: string, max: number, intensity: number): void {
    if (this.flashes.length < 120) this.flashes.push({ x, y, r, color, t: 0, max, intensity });
  }
  private ripple(x: number, y: number, r: number, max: number, strength: number): void {
    if (this.ripples.length < 12) this.ripples.push({ x, y, r, t: 0, max, strength });
  }
  private text(x: number, y: number, text: string, color: string, size: number, max = 0.9, vy = -40): void {
    if (this.numbers.length > 90) this.numbers.shift();
    this.numbers.push({ x, y, vy, t: 0, max, text, color, size });
  }

  handle(f: FxEvent): void {
    const P = this.P;
    switch (f.type) {
      case 'cast': {
        const el = ELEMENT_INFO[f.element];
        this.sigils.push({ x: f.pos.x, y: f.pos.y, seed: f.seed, color: el.color, t: 0, max: 0.85, r: 30 + 16 * f.power });
        this.ring(f.pos.x, f.pos.y, 10, 50 + 20 * f.power, 0.4, el.glow, 2);
        this.flash(f.pos.x, f.pos.y, 120, el.color, 0.3, 0.7);
        P.burst(PT.Mote, f.pos.x, f.pos.y, 10, 90, 0.5, 2.2, P.c(el.glow), { drag: 3 });
        break;
      }
      case 'explosion':
        this.explosion(f.pos, f.radius, f.element);
        break;
      case 'hit': {
        const el = ELEMENT_INFO[f.element];
        const n = Math.min(10, 3 + Math.round(f.amount / 8));
        for (let k = 0; k < n * P.budget; k++) {
          const a = Math.atan2(f.dir.y, f.dir.x) + (Math.random() - 0.5) * 2.2;
          const s = 120 + Math.random() * 220;
          P.spawn(PT.Spark, f.pos.x, f.pos.y, Math.cos(a) * s, Math.sin(a) * s, 0.22, 1.6, P.c(el.glow), 0, 5);
        }
        this.flash(f.pos.x, f.pos.y, 50, el.color, 0.12, 0.6);
        if (f.element === 'fire') P.burst(PT.Ember, f.pos.x, f.pos.y, 4, 60, 0.5, 2, P.c('#ffb347'), { lift: 40 });
        if (f.element === 'ice') P.burst(PT.Flake, f.pos.x, f.pos.y, 4, 70, 0.5, 3, P.c('#cff6ff'));
        break;
      }
      case 'number': {
        const color = f.kind === 'heal' ? '#7dffa0' : f.kind === 'shield' ? '#ffd27a' : f.kind === 'crit' ? '#ffffff' : ELEMENT_INFO[f.element].glow;
        // tiny damage-over-time ticks: show them, but never let them flood the screen
        const small = f.kind === 'damage' && f.amount <= 5;
        if (small && this.numbers.length > 24) break;
        if (f.kind === 'damage' && this.numbers.length > 45) break;
        const size = f.kind === 'crit' ? 20 : small ? 10.5 : 13 + Math.min(5, f.amount / 15);
        this.text(f.pos.x, f.pos.y, (f.kind === 'heal' ? '+' : '') + f.amount, color, size, f.kind === 'crit' ? 1.1 : 0.85);
        break;
      }
      case 'bolt': {
        const el = ELEMENT_INFO[f.element];
        if (this.bolts.length < 80 && f.points.length >= 2)
          this.bolts.push({ pts: f.points.map((p) => ({ x: p.x, y: p.y })), color: el.color, glow: el.glow, width: f.width, t: 0, max: 0.3 + Math.random() * 0.1, branches: f.width >= 2 ? 2 : 0 });
        const end = f.points[f.points.length - 1];
        P.burst(PT.Spark, end.x, end.y, 6, 220, 0.2, 1.4, P.c(el.glow), { drag: 5 });
        this.flash(end.x, end.y, 70, el.color, 0.15, 0.8);
        break;
      }
      case 'teleport': {
        const el = ELEMENT_INFO[f.element];
        const c = P.c(el.glow);
        for (let k = 0; k < 24 * P.budget; k++) {
          const a = Math.random() * TAU;
          const d = 30 + Math.random() * 20;
          P.spawn(PT.Mote, f.from.x + Math.cos(a) * d, f.from.y + Math.sin(a) * d, -Math.cos(a) * d * 4, -Math.sin(a) * d * 4, 0.25, 2, c, 0, 0);
        }
        P.burst(PT.Spark, f.to.x, f.to.y, 26, 300, 0.35, 1.8, c, { drag: 4 });
        P.burst(PT.Glyph, f.to.x, f.to.y, 6, 60, 0.7, 6, P.c(el.color), { drag: 2 });
        this.ring(f.to.x, f.to.y, 5, 70, 0.4, el.glow, 3);
        this.ring(f.from.x, f.from.y, 50, 4, 0.25, el.color, 2);
        this.streaks.push({ ax: f.from.x, ay: f.from.y, bx: f.to.x, by: f.to.y, t: 0, max: 0.3, color: el.glow });
        this.flash(f.to.x, f.to.y, 140, el.color, 0.3, 1);
        this.ripple(f.to.x, f.to.y, 60, 0.35, 0.6);
        break;
      }
      case 'shatter': {
        P.burst(PT.Shard, f.pos.x, f.pos.y, 18, 260, 0.7, f.radius * 0.25 + 3, P.c('#d8f7ff'), { drag: 3 });
        P.burst(PT.Flake, f.pos.x, f.pos.y, 10, 120, 0.8, 3.5, P.c('#e4fbff'), { drag: 2 });
        this.ring(f.pos.x, f.pos.y, 4, f.radius * 2.2, 0.3, '#e4fbff', 2);
        this.flash(f.pos.x, f.pos.y, 90, '#9fe7ff', 0.2, 0.9);
        break;
      }
      case 'ignite': {
        this.flash(f.pos.x, f.pos.y, 90, '#ff7a2f', 0.25, 1);
        P.burst(PT.Ember, f.pos.x, f.pos.y, 12, 80, 0.7, 2.4, P.c('#ffb347'), { lift: 60 });
        break;
      }
      case 'freeze': {
        this.ring(f.pos.x, f.pos.y, f.radius * 2, f.radius, 0.35, '#9fe7ff', 2);
        P.burst(PT.Flake, f.pos.x, f.pos.y, 10, 60, 0.9, 3.5, P.c('#e4fbff'), { spread: f.radius });
        P.burst(PT.Shard, f.pos.x, f.pos.y, 6, 40, 0.5, 4, P.c('#cff6ff'));
        break;
      }
      case 'death': {
        const el = ELEMENT_INFO[f.element];
        const living = f.kind === 'enemy' || f.kind === 'dummy' || f.kind === 'target' || f.kind === 'sheep' || f.kind === 'summon';
        if (living) {
          P.burst(PT.Mote, f.pos.x, f.pos.y, 22, 140, 0.8, 2.6, P.c(el.glow), { drag: 3, lift: 20 });
          P.burst(PT.Glyph, f.pos.x, f.pos.y, 5, 40, 1.1, 6, P.c(el.color), { drag: 1, lift: 30 });
          P.burst(PT.Smoke, f.pos.x, f.pos.y, 6, 40, 1, f.radius * 0.7, P.c('#2a2232'), { grow: 18, drag: 2 });
          this.ring(f.pos.x, f.pos.y, f.radius, f.radius * 3.5, 0.45, el.color, 2.5);
          this.flash(f.pos.x, f.pos.y, 110, el.color, 0.3, 0.9);
        }
        break;
      }
      case 'debris': {
        const d = DEBRIS[f.kind];
        if (!d) break;
        const n = Math.round(10 + f.radius * 0.5);
        for (let k = 0; k < n * P.budget; k++) {
          const a = Math.random() * TAU;
          const s = 80 + Math.random() * 260;
          const c = P.c(d.colors[k % d.colors.length]);
          P.spawn(k % 3 === 0 ? PT.Shard : PT.Debris, f.pos.x, f.pos.y, Math.cos(a) * s, Math.sin(a) * s, 0.9 + Math.random() * 0.8, 2 + Math.random() * f.radius * 0.18, c, 0, 3.2);
        }
        if (d.smoke) P.burst(PT.Smoke, f.pos.x, f.pos.y, 6, 50, 1.1, f.radius * 0.7, P.c(d.smoke), { grow: 20, drag: 2 });
        if (d.spark) P.burst(PT.Spark, f.pos.x, f.pos.y, 16, 300, 0.3, 1.5, P.c(d.spark), { drag: 4 });
        break;
      }
      case 'shockwave': {
        const el = ELEMENT_INFO[f.element];
        this.ring(f.pos.x, f.pos.y, 6, f.radius, 0.35, el.glow, 4);
        this.ring(f.pos.x, f.pos.y, 4, f.radius * 0.7, 0.28, el.color, 2);
        this.ripple(f.pos.x, f.pos.y, f.radius, 0.4, 1);
        P.burst(PT.Smoke, f.pos.x, f.pos.y, 8, f.radius * 1.5, 0.6, 9, P.c('#5a5470'), { grow: 14, drag: 4, spread: 10 });
        break;
      }
      case 'heal': {
        P.burst(PT.Mote, f.pos.x, f.pos.y, 16, 50, 1, 2.6, P.c('#9dffb0'), { lift: 40, spread: f.radius });
        P.burst(PT.Mote, f.pos.x, f.pos.y, 6, 30, 1, 2.6, P.c('#f3ffc4'), { lift: 50, spread: f.radius });
        this.ring(f.pos.x, f.pos.y, f.radius * 1.6, f.radius * 0.4, 0.5, '#7dff9c', 2);
        this.flash(f.pos.x, f.pos.y, 90, '#7dff9c', 0.35, 0.7);
        break;
      }
      case 'shieldHit': {
        this.ring(f.pos.x, f.pos.y, f.radius, f.radius + 10, 0.25, '#ffd27a', 3);
        P.burst(PT.Spark, f.pos.x, f.pos.y, 6, 160, 0.2, 1.4, P.c('#ffe08a'), { spread: f.radius });
        this.flash(f.pos.x, f.pos.y, 70, '#ffd27a', 0.15, 0.6);
        break;
      }
      case 'fizzle': {
        P.burst(PT.Smoke, f.pos.x, f.pos.y - 20, 5, 30, 0.8, 7, P.c('#6b6680'), { grow: 10, lift: 20 });
        this.marks.push({ x: f.pos.x, y: f.pos.y - 26, t: 0, max: 0.8 });
        if (f.reason && this.numbers.length < 90) this.text(f.pos.x, f.pos.y - 40, f.reason, '#b9b4cc', 11, 1.2, -18);
        break;
      }
      case 'spawn': {
        const el = ELEMENT_INFO[f.element];
        this.ring(f.pos.x, f.pos.y, f.radius * 1.4, 4, 0.35, el.glow, 2);
        const c = P.c(el.glow);
        for (let k = 0; k < 14 * P.budget; k++) {
          const a = Math.random() * TAU;
          const d = f.radius * (0.8 + Math.random() * 0.6);
          P.spawn(PT.Mote, f.pos.x + Math.cos(a) * d, f.pos.y + Math.sin(a) * d, -Math.cos(a) * d * 2.6, -Math.sin(a) * d * 2.6, 0.38, 2, c, 0, 0);
        }
        this.flash(f.pos.x, f.pos.y, 80, el.color, 0.3, 0.6);
        break;
      }
      case 'transmute': {
        const el = ELEMENT_INFO[f.element];
        P.burst(PT.Glyph, f.pos.x, f.pos.y, 8, 70, 0.9, 7, P.c('#e58cff'), { drag: 2 });
        P.burst(PT.Mote, f.pos.x, f.pos.y, 20, 120, 0.6, 2.2, P.c(el.glow), { drag: 3 });
        this.ring(f.pos.x, f.pos.y, 4, f.radius * 1.5, 0.4, '#e58cff', 2.5);
        P.burst(PT.Smoke, f.pos.x, f.pos.y, 6, 40, 0.8, 9, P.c('#c9c3e6'), { grow: 18, drag: 2 });
        this.flash(f.pos.x, f.pos.y, 100, '#e58cff', 0.3, 0.9);
        break;
      }
      case 'steam': {
        P.burst(PT.Smoke, f.pos.x, f.pos.y, 4, 25, 1.3, 7, P.c('#c8d4e0'), { grow: 16, lift: 30, drag: 1 });
        break;
      }
      case 'text':
        this.text(f.pos.x, f.pos.y, f.text, f.color, 14, 1.3, -26);
        break;
    }
  }

  private explosion(p: Vec, radius: number, element: Element): void {
    const P = this.P;
    const el = ELEMENT_INFO[element];
    this.frameLoad++;
    // simultaneous blasts (chain reactions) share one particle budget
    const crowd = 1 / Math.sqrt(this.frameLoad + this.rings.length / 12);
    const k = Math.max(0.5, Math.min(2.2, radius / 100)) * Math.min(1, crowd * 1.4);
    this.flash(p.x, p.y, radius * 2.6, el.color, 0.35, 1.8 * Math.min(1, crowd * 1.6));
    this.ring(p.x, p.y, radius * 0.2, radius * 1.15, 0.4, el.glow, 5 * Math.min(1, crowd * 1.5));
    if (this.rings.length < 40) this.ring(p.x, p.y, radius * 0.1, radius * 0.8, 0.3, '#ffffff', 2);
    this.ripple(p.x, p.y, radius * 1.2, 0.45, 1.2);
    switch (element) {
      case 'fire':
        P.burst(PT.Ember, p.x, p.y, 40 * k, radius * 3, 0.9, 3, P.c('#ffb347'), { drag: 3, lift: 50 });
        P.burst(PT.Spark, p.x, p.y, 26 * k, radius * 5, 0.35, 2, P.c('#ffe0a0'), { drag: 4 });
        P.burst(PT.Smoke, p.x, p.y, 14 * k, radius * 1.4, 1.6, radius * 0.3, P.c('#241c20'), { grow: radius * 0.45, drag: 2.5, lift: 12, spread: radius * 0.4 });
        P.burst(PT.Mote, p.x, p.y, 12 * k, radius * 1.5, 0.5, 6, P.c('#ff6a1a'), { drag: 3 });
        break;
      case 'ice':
        P.burst(PT.Shard, p.x, p.y, 30 * k, radius * 3.2, 0.8, 5, P.c('#d8f7ff'), { drag: 3 });
        P.burst(PT.Flake, p.x, p.y, 26 * k, radius * 2, 1.1, 4, P.c('#e4fbff'), { drag: 2.5 });
        P.burst(PT.Smoke, p.x, p.y, 10 * k, radius * 1.2, 1.4, radius * 0.3, P.c('#9fc8dc'), { grow: radius * 0.3, drag: 2.5, spread: radius * 0.4 });
        break;
      case 'lightning': {
        P.burst(PT.Spark, p.x, p.y, 50 * k, radius * 5, 0.35, 1.8, P.c('#e8ebff'), { drag: 4 });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU + Math.random() * 0.5;
          const pts: Vec[] = [{ x: p.x, y: p.y }];
          const L = radius * (0.8 + Math.random() * 0.5);
          for (let s = 1; s <= 5; s++) pts.push({ x: p.x + Math.cos(a) * (L * s) / 5 + (Math.random() - 0.5) * 20, y: p.y + Math.sin(a) * (L * s) / 5 + (Math.random() - 0.5) * 20 });
          this.bolts.push({ pts, color: el.color, glow: el.glow, width: 2, t: 0, max: 0.25, branches: 1 });
        }
        break;
      }
      case 'void': {
        const c = P.c('#c9a2ff');
        for (let i = 0; i < 36 * k * P.budget; i++) {
          const a = Math.random() * TAU;
          const d = radius * (0.9 + Math.random() * 0.4);
          P.spawn(PT.Mote, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, -Math.cos(a) * d * 3.5, -Math.sin(a) * d * 3.5, 0.28, 2.4, c, 0, 0);
        }
        P.burst(PT.Mote, p.x, p.y, 30 * k, radius * 4, 0.6, 3, P.c('#8a4dff'), { drag: 4 });
        P.burst(PT.Smoke, p.x, p.y, 10 * k, radius, 1.2, radius * 0.3, P.c('#1a0b30'), { grow: radius * 0.4, drag: 3, spread: radius * 0.3 });
        break;
      }
      case 'life':
        P.burst(PT.Mote, p.x, p.y, 40 * k, radius * 2.5, 1, 3, P.c('#9dffb0'), { drag: 3, lift: 25 });
        P.burst(PT.Mote, p.x, p.y, 20 * k, radius * 2, 1, 3, P.c('#f3ffc4'), { drag: 3, lift: 25 });
        break;
      case 'force':
        P.burst(PT.Smoke, p.x, p.y, 16 * k, radius * 2, 0.9, radius * 0.22, P.c('#6b6680'), { grow: radius * 0.3, drag: 4, spread: radius * 0.3 });
        P.burst(PT.Spark, p.x, p.y, 30 * k, radius * 5, 0.3, 1.6, P.c('#ffffff'), { drag: 4 });
        this.ring(p.x, p.y, radius * 0.3, radius * 1.4, 0.55, '#e8eefc', 3);
        break;
      default:
        P.burst(PT.Glyph, p.x, p.y, 12 * k, radius * 1.6, 0.9, 7, P.c(el.color), { drag: 2.5 });
        P.burst(PT.Mote, p.x, p.y, 34 * k, radius * 3, 0.7, 3, P.c(el.glow), { drag: 3 });
        P.burst(PT.Spark, p.x, p.y, 20 * k, radius * 4, 0.3, 1.6, P.c('#f3d8ff'), { drag: 4 });
    }
  }

  update(dt: number): void {
    const age = <T extends { t: number; max: number }>(arr: T[]): T[] => {
      for (const a of arr) a.t += dt;
      return arr.filter((a) => a.t < a.max);
    };
    this.bolts = age(this.bolts);
    this.rings = age(this.rings);
    this.flashes = age(this.flashes);
    this.sigils = age(this.sigils);
    this.ripples = age(this.ripples);
    this.streaks = age(this.streaks);
    this.marks = age(this.marks);
    for (const n of this.numbers) {
      n.t += dt;
      n.y += n.vy * dt;
      n.vy *= Math.exp(-2.5 * dt);
    }
    this.numbers = this.numbers.filter((n) => n.t < n.max);
  }

  /** emissive layer: bolts, rings, flashes, sigils, streaks; also registers lights */
  drawEmissive(E: CanvasRenderingContext2D, light: Lighting, time: number): void {
    // exposure: many overlapping additive flashes would saturate to white
    const expo = Math.min(1, 5 / Math.max(1, this.flashes.length));
    const ringExpo = Math.min(1, 10 / Math.max(1, this.rings.length));
    for (const f of this.flashes) {
      const k = 1 - f.t / f.max;
      const i = f.intensity * k * k;
      light.add(f.x, f.y, f.r, f.color, i * Math.max(0.35, expo));
      E.globalAlpha = Math.min(1, i * 0.6) * expo;
      const r = f.r * 0.35 * (0.6 + 0.4 * k);
      E.drawImage(glowSprite(f.color), f.x - r, f.y - r, r * 2, r * 2);
    }
    E.globalAlpha = 1;
    for (const r of this.rings) {
      const p = r.t / r.max;
      const e = 1 - Math.pow(1 - p, 3);
      E.globalAlpha = (1 - p) * 0.9 * Math.max(0.3, ringExpo);
      E.strokeStyle = r.color;
      E.lineWidth = r.width * (1 - p * 0.6);
      E.beginPath();
      E.arc(r.x, r.y, Math.max(0.5, r.r0 + (r.r1 - r.r0) * e), 0, TAU);
      E.stroke();
    }
    E.globalAlpha = 1;
    E.lineCap = 'round';
    E.lineJoin = 'round';
    for (const b of this.bolts) {
      const k = 1 - b.t / b.max;
      const flick = Math.random() < 0.15 ? 0.3 : 1;
      const pts = jitter(b.pts, 6);
      E.globalAlpha = k * flick;
      E.strokeStyle = rgba(b.color, 0.35);
      E.lineWidth = b.width * 4;
      poly(E, pts);
      E.strokeStyle = b.glow;
      E.lineWidth = b.width * 1.4;
      poly(E, pts);
      E.strokeStyle = '#ffffff';
      E.lineWidth = Math.max(0.8, b.width * 0.5);
      poly(E, pts);
      // branches
      for (let i = 0; i < b.branches; i++) {
        const j = 1 + Math.floor(Math.random() * (pts.length - 2));
        if (j >= pts.length - 1 || j < 1) continue;
        const a = pts[j];
        const dir = Math.atan2(pts[j + 1].y - a.y, pts[j + 1].x - a.x) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6);
        const L = 20 + Math.random() * 40;
        const br = [a, { x: a.x + Math.cos(dir) * L * 0.5 + (Math.random() - 0.5) * 8, y: a.y + Math.sin(dir) * L * 0.5 + (Math.random() - 0.5) * 8 }, { x: a.x + Math.cos(dir) * L, y: a.y + Math.sin(dir) * L }];
        E.strokeStyle = b.glow;
        E.lineWidth = b.width * 0.7;
        poly(E, br);
      }
      const mid = pts[(pts.length / 2) | 0];
      light.add(mid.x, mid.y, 140, b.color, 0.9 * k * flick);
      light.add(pts[pts.length - 1].x, pts[pts.length - 1].y, 90, b.color, 0.8 * k);
    }
    E.globalAlpha = 1;
    for (const s of this.streaks) {
      const k = 1 - s.t / s.max;
      E.globalAlpha = k;
      E.strokeStyle = s.color;
      E.lineWidth = 6 * k;
      E.beginPath();
      E.moveTo(s.ax, s.ay);
      E.lineTo(s.bx, s.by);
      E.stroke();
      E.strokeStyle = '#ffffff';
      E.lineWidth = 2 * k;
      E.stroke();
    }
    E.globalAlpha = 1;
    for (const s of this.sigils) {
      const p = s.t / s.max;
      const grow = 0.55 + 0.45 * (1 - Math.pow(1 - p, 3));
      const a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      drawSigil(E, s.seed, s.x, s.y, s.r * grow, s.color, time * 2 + p * 2, a * 0.95);
      light.add(s.x, s.y, s.r * 3, s.color, a * 0.6);
    }
    E.globalAlpha = 1;
  }

  /** unlit overlay: floating numbers, reaction text, fizzle marks */
  drawOverlay(g: CanvasRenderingContext2D): void {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const n of this.numbers) {
      const p = n.t / n.max;
      const pop = 1 + 0.7 * Math.exp(-n.t * 14);
      const a = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      g.globalAlpha = a;
      const size = n.size * pop;
      g.font = `800 ${size.toFixed(1)}px Inter, system-ui, sans-serif`;
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(8,4,16,0.85)';
      g.strokeText(n.text, n.x, n.y);
      g.fillStyle = n.color;
      g.fillText(n.text, n.x, n.y);
    }
    for (const m of this.marks) {
      const a = 1 - m.t / m.max;
      g.globalAlpha = a;
      g.strokeStyle = '#d0cbe6';
      g.lineWidth = 2;
      const s = 5;
      g.beginPath();
      g.moveTo(m.x - s, m.y - s);
      g.lineTo(m.x + s, m.y + s);
      g.moveTo(m.x + s, m.y - s);
      g.lineTo(m.x - s, m.y + s);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** sprites for bright explosion cores (used to seed bloom) */
  coreGlow(E: CanvasRenderingContext2D): void {
    for (const f of this.flashes) {
      const k = 1 - f.t / f.max;
      if (k < 0.5 || f.r < 150) continue;
      const r = f.r * 0.18 * k;
      E.globalAlpha = k;
      E.drawImage(coreSprite(f.color), f.x - r, f.y - r, r * 2, r * 2);
    }
    E.globalAlpha = 1;
  }
}

function jitter(pts: Vec[], amt: number): Vec[] {
  const out: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // subdivide long segments for a crackly look
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const sub = Math.min(4, Math.max(1, Math.floor(d / 22)));
    for (let s = 1; s <= sub; s++) {
      const t = s / sub;
      const last = i === pts.length - 1 && s === sub;
      out.push(last ? b : { x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * amt * 2, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * amt * 2 });
    }
  }
  return out;
}

function poly(g: CanvasRenderingContext2D, pts: Vec[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke();
}
