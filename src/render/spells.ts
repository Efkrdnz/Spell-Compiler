import { ELEMENT_INFO, type Element } from '../core/types';
import type { Entity } from '../sim/entity';
import { miniArcs } from './entities';
import type { DrawEnv } from './env';
import { PT } from './particles';
import { coreSprite, flameSprite, glowSprite, rgba } from './sprites';
import { drawGlyph } from './sigils';

const TAU = Math.PI * 2;
const TRAIL = 14;

interface Trail {
  x: Float32Array;
  y: Float32Array;
  n: number;
  head: number;
  seen: number;
}

/** Per-projectile position history for tapered trails. */
export class Trails {
  private map = new Map<number, Trail>();
  private frame = 0;

  push(e: Entity): Trail {
    let tr = this.map.get(e.id);
    if (!tr) {
      tr = { x: new Float32Array(TRAIL), y: new Float32Array(TRAIL), n: 0, head: 0, seen: 0 };
      this.map.set(e.id, tr);
    }
    tr.seen = this.frame;
    const last = (tr.head - 1 + TRAIL) % TRAIL;
    if (tr.n === 0 || Math.hypot(tr.x[last] - e.pos.x, tr.y[last] - e.pos.y) > 3) {
      // teleport/orbit discontinuity: restart the trail
      if (tr.n && Math.hypot(tr.x[last] - e.pos.x, tr.y[last] - e.pos.y) > 160) tr.n = 0;
      tr.x[tr.head] = e.pos.x;
      tr.y[tr.head] = e.pos.y;
      tr.head = (tr.head + 1) % TRAIL;
      tr.n = Math.min(TRAIL, tr.n + 1);
    }
    return tr;
  }

  endFrame(): void {
    this.frame++;
    if (this.frame % 30 === 0) for (const [id, tr] of this.map) if (this.frame - tr.seen > 2) this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Filled tapering ribbon along the trail (one path fill per projectile). */
function ribbon(g: CanvasRenderingContext2D, tr: Trail, hx: number, hy: number, width: number, maxPts: number, maxLen: number): void {
  const n = Math.min(tr.n, maxPts);
  if (n < 2) return;
  // collect points newest → oldest, starting at the live head position, capped by length
  const px: number[] = [hx];
  const py: number[] = [hy];
  let len = 0;
  for (let k = 1; k < n; k++) {
    const i = (tr.head - k + TRAIL * 2) % TRAIL;
    const lx = px[px.length - 1];
    const ly = py[py.length - 1];
    const d = Math.hypot(tr.x[i] - lx, tr.y[i] - ly);
    if (len + d > maxLen) {
      const f = (maxLen - len) / (d || 1);
      px.push(lx + (tr.x[i] - lx) * f);
      py.push(ly + (tr.y[i] - ly) * f);
      break;
    }
    len += d;
    px.push(tr.x[i]);
    py.push(tr.y[i]);
  }
  if (px.length < 2) return;
  const m = px.length;
  g.beginPath();
  for (let k = 0; k < m; k++) {
    const a = k === 0 ? 0 : k - 1;
    const b = k === m - 1 ? m - 1 : k + 1;
    let dx = px[b] - px[a];
    let dy = py[b] - py[a];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = width * (1 - k / m);
    const x = px[k] - dy * w;
    const y = py[k] + dx * w;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  for (let k = m - 1; k >= 0; k--) {
    const a = k === 0 ? 0 : k - 1;
    const b = k === m - 1 ? m - 1 : k + 1;
    let dx = px[b] - px[a];
    let dy = py[b] - py[a];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = width * (1 - k / m);
    g.lineTo(px[k] + dy * w, py[k] - dx * w);
  }
  g.closePath();
  g.fill();
}

export function drawProjectile(env: DrawEnv, e: Entity, trails: Trails, heavy: boolean): void {
  const E = env.e;
  const P = env.P;
  const el = ELEMENT_INFO[e.element];
  const r = e.r;
  const tr = trails.push(e);
  const x = e.pos.x;
  const y = e.pos.y;
  const ang = Math.atan2(e.vel.y, e.vel.x);
  const t = env.t;
  const hostile = e.team !== 0;
  const col = hostile ? '#ff4d6d' : el.color;
  const glow = hostile ? '#ffb3c1' : el.glow;
  const maxPts = heavy ? 6 : TRAIL;
  const speed = Math.hypot(e.vel.x, e.vel.y);
  const maxLen = Math.min(170, r * 5 + speed * 0.09) * (heavy ? 0.6 : 1);
  // trail
  E.fillStyle = rgba(col, heavy ? 0.45 : 0.32);
  ribbon(E, tr, x, y, r * (e.element === 'ice' ? 0.7 : 1.15), maxPts, maxLen);
  if (!heavy) {
    E.fillStyle = rgba(glow, 0.55);
    ribbon(E, tr, x, y, r * 0.42, maxPts, maxLen * 0.7);
  }
  const em = env.budget * (heavy ? 0.35 : 1);
  switch (hostile ? 'arcane' : (e.element as Element)) {
    case 'fire': {
      const fl = 1 + 0.18 * Math.sin(t * 40 + e.id);
      E.drawImage(glowSprite('#ff6a1a'), x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
      E.drawImage(coreSprite('#ff8a2a'), x - r * 1.4 * fl, y - r * 1.4 * fl, r * 2.8 * fl, r * 2.8 * fl);
      if (Math.random() < env.dt * 50 * em) P.spawn(PT.Ember, x, y, -e.vel.x * 0.1 + (Math.random() - 0.5) * 50, -e.vel.y * 0.1 + (Math.random() - 0.5) * 50, 0.6, r * 0.35, P.c('#ffb347'), 0, 2, 40);
      if (Math.random() < env.dt * 12 * em) P.spawn(PT.Smoke, x, y, (Math.random() - 0.5) * 15, (Math.random() - 0.5) * 15, 1, r * 0.8, P.c('#2c2226'), r * 2.2, 1, 12);
      env.light.add(x, y, 90 + r * 5, '#ff7a2f', 0.9);
      break;
    }
    case 'ice': {
      E.drawImage(glowSprite('#6fe3ff'), x - r * 3, y - r * 3, r * 6, r * 6);
      E.save();
      E.translate(x, y);
      E.rotate(ang);
      E.fillStyle = '#e8fbff';
      E.beginPath();
      E.moveTo(r * 2.4, 0);
      E.lineTo(0, r * 0.75);
      E.lineTo(-r * 1.4, 0);
      E.lineTo(0, -r * 0.75);
      E.closePath();
      E.fill();
      E.fillStyle = 'rgba(111,227,255,0.8)';
      E.beginPath();
      E.moveTo(r * 2.4, 0);
      E.lineTo(0, r * 0.75);
      E.lineTo(0, 0);
      E.closePath();
      E.fill();
      E.restore();
      if (Math.random() < env.dt * 25 * em) P.spawn(PT.Flake, x, y, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.7, r * 0.55, P.c('#cff6ff'), 0, 3);
      env.light.add(x, y, 70 + r * 4, '#6fe3ff', 0.7);
      break;
    }
    case 'lightning': {
      const j = 1 + 0.35 * Math.random();
      E.drawImage(glowSprite('#9fa8ff'), x - r * 3.5, y - r * 3.5, r * 7, r * 7);
      E.drawImage(coreSprite('#c8ceff'), x - r * 1.3 * j, y - r * 1.3 * j, r * 2.6 * j, r * 2.6 * j);
      if (!heavy || Math.random() < 0.3) miniArcs(env, x, y, r * 2.2, '#eef0ff', 2);
      env.light.add(x, y, 90 + r * 4, '#a8b0ff', 0.6 + Math.random() * 0.5);
      if (Math.random() < env.dt * 20 * em) P.spawn(PT.Spark, x, y, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 0.18, 1.2, P.c('#dfe3ff'), 0, 6);
      break;
    }
    case 'void': {
      E.drawImage(glowSprite('#8a4dff'), x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
      // dark core (drawn in the lit layer so it reads as absence of light)
      env.g.fillStyle = '#05000c';
      env.g.beginPath();
      env.g.arc(x, y, r * 0.85, 0, TAU);
      env.g.fill();
      E.strokeStyle = '#d9b8ff';
      E.lineWidth = 1.5;
      E.beginPath();
      E.arc(x, y, r * 0.95, 0, TAU);
      E.stroke();
      if (Math.random() < env.dt * 30 * em) {
        const a = Math.random() * TAU;
        const d = r * 4;
        P.spawn(PT.Mote, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * d * 3 + e.vel.x, -Math.sin(a) * d * 3 + e.vel.y, 0.3, 1.6, P.c('#b98cff'), 0, 0);
      }
      env.light.add(x, y, 80 + r * 4, '#7a3dff', 0.55);
      break;
    }
    case 'life': {
      E.drawImage(glowSprite('#7dff9c'), x - r * 3, y - r * 3, r * 6, r * 6);
      E.drawImage(coreSprite('#c8ff9c'), x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
      if (Math.random() < env.dt * 25 * em) P.spawn(PT.Mote, x, y, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40 - 20, 0.8, 2.2, P.c(Math.random() < 0.5 ? '#f3ffc4' : '#7dff9c'), 0, 1, 20);
      env.light.add(x, y, 80 + r * 4, '#9dff9c', 0.6);
      break;
    }
    case 'force': {
      const p = (t * 4 + e.id * 0.37) % 1;
      E.drawImage(coreSprite('#dfe8ff'), x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
      E.strokeStyle = rgba('#e8eefc', 1 - p);
      E.lineWidth = 1.5;
      E.beginPath();
      E.arc(x, y, r * (1 + p * 1.8), 0, TAU);
      E.stroke();
      env.light.add(x, y, 70 + r * 4, '#dfe8ff', 0.5);
      break;
    }
    default: {
      // arcane (and hostile bolts)
      E.drawImage(glowSprite(col), x - r * 3, y - r * 3, r * 6, r * 6);
      E.drawImage(coreSprite(col), x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
      if (!heavy) {
        for (let k = 0; k < 3; k++) {
          const a = t * 6 + (k * TAU) / 3 + e.id;
          E.drawImage(coreSprite(glow), x + Math.cos(a) * r * 1.7 - 2, y + Math.sin(a) * r * 1.7 - 2, 4, 4);
        }
      }
      if (Math.random() < env.dt * 6 * em) P.spawn(PT.Glyph, x, y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0.6, r * 0.9, P.c(col), 0, 2);
      env.light.add(x, y, 80 + r * 4, col, 0.6);
    }
  }
}

/** Beam: layered glow strokes with noise flicker, sparks at the impact point. */
export function drawBeam(env: DrawEnv, e: Entity): void {
  const b = e.beam!;
  const el = ELEMENT_INFO[e.element];
  const E = env.e;
  const x0 = e.pos.x;
  const y0 = e.pos.y;
  const x1 = b.end.x;
  const y1 = b.end.y;
  const fade = Math.min(1, b.life / 0.12) * Math.min(1, (b.maxLife - b.life) / 0.05 + 0.3);
  const flick = 0.85 + 0.15 * Math.sin(env.t * 60 + e.id);
  const w = b.width * flick;
  E.lineCap = 'round';
  E.globalAlpha = fade;
  if (e.element === 'lightning') {
    // jagged beam, re-jittered every frame
    for (const [lw, c] of [
      [w * 1.6, rgba(el.color, 0.35)],
      [w * 0.5, el.glow],
    ] as const) {
      E.strokeStyle = c;
      E.lineWidth = lw;
      E.beginPath();
      E.moveTo(x0, y0);
      const segs = Math.max(4, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 30));
      const nx = -(y1 - y0);
      const ny = x1 - x0;
      const nl = Math.hypot(nx, ny) || 1;
      for (let k = 1; k < segs; k++) {
        const tt = k / segs;
        const o = (Math.random() - 0.5) * w * 2.2;
        E.lineTo(x0 + (x1 - x0) * tt + (nx / nl) * o, y0 + (y1 - y0) * tt + (ny / nl) * o);
      }
      E.lineTo(x1, y1);
      E.stroke();
    }
  } else {
    E.strokeStyle = rgba(el.color, 0.18);
    E.lineWidth = w * 3;
    line(E, x0, y0, x1, y1);
    E.strokeStyle = rgba(el.color, 0.55);
    E.lineWidth = w * 1.4;
    line(E, x0, y0, x1, y1);
    E.strokeStyle = el.glow;
    E.lineWidth = Math.max(1.5, w * 0.45);
    line(E, x0, y0, x1, y1);
    E.strokeStyle = 'rgba(255,255,255,0.9)';
    E.lineWidth = Math.max(1, w * 0.18);
    line(E, x0, y0, x1, y1);
  }
  E.drawImage(coreSprite(el.color), x1 - w * 2, y1 - w * 2, w * 4, w * 4);
  E.drawImage(coreSprite(el.color), x0 - w * 1.2, y0 - w * 1.2, w * 2.4, w * 2.4);
  E.globalAlpha = 1;
  const P = env.P;
  const em = env.budget;
  if (Math.random() < env.dt * 40 * em) {
    const a = Math.random() * TAU;
    P.spawn(PT.Spark, x1, y1, Math.cos(a) * 260, Math.sin(a) * 260, 0.25, 1.5, P.c(el.glow), 0, 5);
  }
  const len = Math.hypot(x1 - x0, y1 - y0);
  // along-beam motes by element
  if (Math.random() < env.dt * 30 * em) {
    const tt = Math.random();
    const px = x0 + (x1 - x0) * tt;
    const py = y0 + (y1 - y0) * tt;
    if (e.element === 'fire') P.spawn(PT.Ember, px, py, (Math.random() - 0.5) * 40, -30, 0.5, 2.5, P.c('#ffb347'), 0, 1, 50);
    else if (e.element === 'ice') P.spawn(PT.Flake, px, py, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.6, 3, P.c('#cff6ff'), 0, 2);
    else P.spawn(PT.Mote, px, py, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.4, 2, P.c(el.glow), 0, 2);
  }
  const nl = Math.max(1, Math.min(6, Math.round(len / 150)));
  for (let k = 0; k <= nl; k++) env.light.add(x0 + ((x1 - x0) * k) / nl, y0 + ((y1 - y0) * k) / nl, 60 + w * 3, el.color, 0.6 * fade);
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** Ground layer of a field (drawn under entities, lit). */
export function drawFieldGround(env: DrawEnv, e: Entity): void {
  const f = e.field!;
  const el = ELEMENT_INFO[e.element];
  const R = f.radius * e.scale;
  const fade = fieldFade(e);
  const g = env.g;
  g.globalAlpha = fade * (f.kind === 'zone' ? 0.55 : 0.3);
  g.drawImage(glowSprite(el.dark), e.pos.x - R * 1.1, e.pos.y - R * 1.1, R * 2.2, R * 2.2);
  g.globalAlpha = 1;
}

export function fieldFade(e: Entity): number {
  const f = e.field!;
  return Math.min(1, f.life / 0.35) * Math.min(1, (f.maxLife - f.life) / 0.2);
}

/** Emissive layer of a field: per-kind visual language. */
export function drawField(env: DrawEnv, e: Entity): void {
  const f = e.field!;
  const el = ELEMENT_INFO[e.element];
  const E = env.e;
  const P = env.P;
  const x = e.pos.x;
  const y = e.pos.y;
  const R = f.radius * e.scale;
  const t = env.t;
  const fade = fieldFade(e);
  const em = env.budget;
  E.save();
  E.globalAlpha = fade;
  // boundary ring
  E.strokeStyle = rgba(el.color, 0.4);
  E.lineWidth = 1.2;
  E.setLineDash([3, 9]);
  E.beginPath();
  E.arc(x, y, R, t * 0.3, t * 0.3 + TAU);
  E.stroke();
  E.setLineDash([]);
  switch (f.kind) {
    case 'gravity': {
      // accretion spiral arms
      for (let arm = 0; arm < 3; arm++) {
        E.strokeStyle = rgba(el.glow, 0.5);
        E.lineWidth = 1.6;
        E.beginPath();
        for (let k = 0; k <= 30; k++) {
          const tt = k / 30;
          const a = arm * (TAU / 3) + t * 2.2 + tt * 4.2;
          const rr = R * 0.18 + R * 0.55 * (1 - tt);
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr * 0.9;
          if (k) E.lineTo(px, py);
          else E.moveTo(px, py);
        }
        E.stroke();
      }
      // accretion ring (the core itself stays dark: see drawHorizons)
      E.strokeStyle = rgba(el.color, 0.55);
      E.lineWidth = R * 0.08;
      E.beginPath();
      E.arc(x, y, R * 0.22, 0, TAU);
      E.stroke();
      if (Math.random() < env.dt * 70 * em) {
        const a = Math.random() * TAU;
        const d = R * (0.6 + Math.random() * 0.4);
        const sp = d / 0.7;
        P.spawn(PT.Mote, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * sp - Math.sin(a) * sp * 0.6, -Math.sin(a) * sp + Math.cos(a) * sp * 0.6, 0.65, 1.8, P.c(el.glow), 0, 0);
      }
      env.light.add(x, y, R * 1.3, el.color, 0.55 * fade);
      break;
    }
    case 'attract': {
      for (let k = 0; k < 3; k++) {
        const p = 1 - ((t * 0.8 + k / 3) % 1);
        E.strokeStyle = rgba(el.glow, 0.5 * (1 - p) + 0.1);
        E.lineWidth = 1.5;
        E.beginPath();
        E.arc(x, y, R * p, 0, TAU);
        E.stroke();
      }
      env.light.add(x, y, R, el.color, 0.4 * fade);
      break;
    }
    case 'repel': {
      for (let k = 0; k < 4; k++) {
        const p = (t * 1.1 + k / 4) % 1;
        E.strokeStyle = rgba(el.glow, 0.6 * (1 - p));
        E.lineWidth = 2.5 * (1 - p) + 0.5;
        E.beginPath();
        E.arc(x, y, R * p, 0, TAU);
        E.stroke();
      }
      E.drawImage(coreSprite(el.color), x - 10, y - 10, 20, 20);
      env.light.add(x, y, R, el.color, 0.45 * fade);
      break;
    }
    case 'vortex': {
      for (let k = 0; k < 7; k++) {
        const a0 = t * 4 + (k * TAU) / 7;
        const rr = R * (0.3 + (k % 3) * 0.22);
        E.strokeStyle = rgba(el.glow, 0.45);
        E.lineWidth = 2;
        E.beginPath();
        E.arc(x, y, rr, a0, a0 + 1.3);
        E.stroke();
      }
      if (Math.random() < env.dt * 30 * em) {
        const a = Math.random() * TAU;
        const d = R * Math.random();
        P.spawn(PT.Smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.sin(a) * 160, Math.cos(a) * 160, 0.8, 6, P.c('#8a90a8'), 10, 1.5);
      }
      env.light.add(x, y, R, el.color, 0.3 * fade);
      break;
    }
    case 'stasis': {
      const sc = '#8fd0ff';
      E.strokeStyle = rgba(sc, 0.55);
      E.lineWidth = 1.5;
      E.beginPath();
      E.arc(x, y, R * 0.92, 0, TAU);
      E.stroke();
      E.beginPath();
      E.arc(x, y, R * 0.7, 0, TAU);
      E.stroke();
      E.save();
      E.translate(x, y);
      E.rotate(t * 0.35);
      E.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        E.moveTo(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
        E.lineTo(Math.cos(a) * R * (k % 3 === 0 ? 0.88 : 0.8), Math.sin(a) * R * (k % 3 === 0 ? 0.88 : 0.8));
      }
      E.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        drawGlyph(E, 300 + k, Math.cos(a) * R * 0.81, Math.sin(a) * R * 0.81, 9, rgba(sc, 0.8));
      }
      E.restore();
      // clock hands
      E.strokeStyle = rgba('#e4fbff', 0.8);
      E.lineWidth = 2;
      line(E, x, y, x + Math.cos(t * 0.6) * R * 0.5, y + Math.sin(t * 0.6) * R * 0.5);
      E.lineWidth = 1.2;
      line(E, x, y, x + Math.cos(t * 0.05) * R * 0.62, y + Math.sin(t * 0.05) * R * 0.62);
      E.fillStyle = rgba(sc, 0.06);
      E.beginPath();
      E.arc(x, y, R, 0, TAU);
      E.fill();
      env.light.add(x, y, R, sc, 0.35 * fade);
      break;
    }
    case 'zone': {
      zone(env, e, R, fade);
      break;
    }
  }
  E.restore();
}

function zone(env: DrawEnv, e: Entity, R: number, fade: number): void {
  const E = env.e;
  const P = env.P;
  const el = ELEMENT_INFO[e.element];
  const x = e.pos.x;
  const y = e.pos.y;
  const em = env.budget;
  const spawnIn = (rate: number) => Math.random() < env.dt * rate * em * Math.min(3, R / 80);
  const rp = () => {
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * R * 0.95;
    return [x + Math.cos(a) * d, y + Math.sin(a) * d];
  };
  E.globalAlpha = fade * 0.35;
  E.drawImage(glowSprite(el.color), x - R, y - R, R * 2, R * 2);
  E.globalAlpha = fade;
  switch (e.element) {
    case 'fire': {
      const fs = flameSprite('#ff6a1a');
      const n = Math.min(26, Math.round(R / 7));
      for (let k = 0; k < n; k++) {
        const a = k * 2.399 + e.id;
        const d = R * Math.sqrt((k + 0.5) / n) * 0.9;
        const fl = 0.7 + 0.3 * Math.sin(env.t * 13 + k * 1.7);
        const w = 16 * fl;
        E.drawImage(fs, x + Math.cos(a) * d - w / 2, y + Math.sin(a) * d - w * 1.4, w, w * 1.5);
      }
      if (spawnIn(30)) {
        const [px, py] = rp();
        P.spawn(PT.Ember, px, py, (Math.random() - 0.5) * 30, -50, 0.9, 2.2, P.c('#ffb347'), 0, 1, 60);
      }
      env.light.add(x, y, R * 1.6, '#ff7a2f', 0.85 * fade);
      break;
    }
    case 'ice': {
      if (spawnIn(40)) {
        const [px, py] = rp();
        P.spawn(PT.Flake, px, py - 30, 20, 50, 0.9, 3.5, P.c('#e4fbff'), 0, 0.5);
      }
      // frost crystals growing in from the rim
      E.strokeStyle = rgba('#dff8ff', 0.55);
      E.lineWidth = 1.3;
      E.beginPath();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + e.id;
        const r0 = R * 0.92;
        const len = R * (0.18 + 0.08 * Math.sin(env.t * 2 + k));
        const bx = x + Math.cos(a) * r0;
        const by = y + Math.sin(a) * r0;
        const ix = x + Math.cos(a) * (r0 - len);
        const iy = y + Math.sin(a) * (r0 - len);
        E.moveTo(bx, by);
        E.lineTo(ix, iy);
        for (const sd of [-1, 1]) {
          const mx = x + Math.cos(a) * (r0 - len * 0.5);
          const my = y + Math.sin(a) * (r0 - len * 0.5);
          E.moveTo(mx, my);
          E.lineTo(mx + Math.cos(a + Math.PI + sd * 0.6) * len * 0.4, my + Math.sin(a + Math.PI + sd * 0.6) * len * 0.4);
        }
      }
      E.stroke();
      E.globalAlpha = fade * 0.25;
      E.drawImage(glowSprite('#e4fbff'), x - R * 0.5, y - R * 0.5, R, R);
      E.globalAlpha = fade;
      env.light.add(x, y, R * 1.4, '#6fe3ff', 0.5 * fade);
      break;
    }
    case 'life': {
      if (spawnIn(30)) {
        const [px, py] = rp();
        P.spawn(PT.Mote, px, py, 0, -30, 1.2, 2.6, P.c(Math.random() < 0.5 ? '#f3ffc4' : '#7dff9c'), 0, 0.3);
      }
      E.strokeStyle = rgba('#b8ffc8', 0.5);
      E.lineWidth = 1.5;
      E.beginPath();
      E.arc(x, y, R * (0.5 + 0.1 * Math.sin(env.t * 3)), 0, TAU);
      E.stroke();
      env.light.add(x, y, R * 1.4, '#9dff9c', 0.55 * fade);
      break;
    }
    case 'lightning': {
      if (Math.random() < env.dt * 12) {
        const [px, py] = rp();
        miniArcs(env, px, py, 30, '#eef0ff', 2);
      }
      env.light.add(x, y, R * 1.3, '#a8b0ff', (0.3 + Math.random() * 0.4) * fade);
      break;
    }
    default: {
      if (spawnIn(10)) {
        const [px, py] = rp();
        P.spawn(PT.Glyph, px, py, 0, -15, 1.2, 6, P.c(el.glow), 0, 0.5);
      }
      env.light.add(x, y, R * 1.2, el.color, 0.4 * fade);
    }
  }
  E.globalAlpha = 1;
}

/**
 * Event horizons are drawn AFTER the additive layer so the singularity stays
 * black instead of being washed out by its own accretion glow.
 */
export function drawHorizons(g: CanvasRenderingContext2D, fields: Entity[], t: number): void {
  for (const f of fields) {
    const fd = f.field!;
    if (fd.kind !== 'gravity') continue;
    const fade = fieldFade(f);
    const R = fd.radius * f.scale;
    const el = ELEMENT_INFO[f.element];
    const hr = R * 0.13 * (1 + 0.04 * Math.sin(t * 9));
    g.globalAlpha = fade;
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(f.pos.x, f.pos.y, hr, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = el.glow;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(f.pos.x, f.pos.y, hr + 1, 0, TAU);
    g.stroke();
    g.strokeStyle = rgba(el.color, 0.6);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(f.pos.x, f.pos.y, hr + 3.5, t * 3, t * 3 + 4);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  }
  g.globalAlpha = 1;
}
