import { ELEMENT_INFO, rng, type Element } from '../core/types';
import { ctx2d, makeCanvas, type Canvas } from './sprites';

/**
 * Procedural rune glyphs and spell sigils. Every spell has a signature hash;
 * the same hash always produces the same sigil, so a spell is recognisable
 * at a glance in the library and when it is cast.
 */

// 3x3 lattice the glyph strokes are drawn on (-1..1)
const LATTICE: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** A single procedural rune: 2–4 seeded strokes/arcs on a lattice. */
export function drawGlyph(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, size: number, color: string): void {
  const r = rng(seed * 2654435761 + 17);
  const h = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, size * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  // spine: every glyph gets a vertical or diagonal backbone so they read as script
  const spine = Math.floor(r() * 3);
  if (spine === 0) {
    ctx.moveTo(0, -h);
    ctx.lineTo(0, h);
  } else if (spine === 1) {
    ctx.moveTo(-h * 0.7, -h);
    ctx.lineTo(h * 0.7, h);
  } else {
    ctx.moveTo(-h * 0.6, h);
    ctx.lineTo(0, -h);
    ctx.lineTo(h * 0.6, h);
  }
  const strokes = 1 + Math.floor(r() * 3);
  for (let i = 0; i < strokes; i++) {
    const a = LATTICE[Math.floor(r() * 9)];
    const b = LATTICE[Math.floor(r() * 9)];
    if (a === b) continue;
    const kind = r();
    if (kind < 0.55) {
      ctx.moveTo(a[0] * h * 0.75, a[1] * h);
      ctx.lineTo(b[0] * h * 0.75, b[1] * h);
    } else if (kind < 0.85) {
      const cx = ((a[0] + b[0]) / 2) * h * 0.75;
      const cy = ((a[1] + b[1]) / 2) * h;
      const rr = h * (0.3 + r() * 0.3);
      const s = r() * Math.PI * 2;
      ctx.moveTo(cx + Math.cos(s) * rr, cy + Math.sin(s) * rr);
      ctx.arc(cx, cy, rr, s, s + Math.PI * (0.8 + r()));
    } else {
      ctx.moveTo(a[0] * h * 0.75 + h * 0.12, a[1] * h);
      ctx.arc(a[0] * h * 0.75, a[1] * h, h * 0.12, 0, Math.PI * 2);
    }
  }
  ctx.stroke();
  ctx.restore();
}

interface SigilShape {
  rings: number;
  poly: number;
  step: number;
  glyphs: number;
  inner: number;
  spin: number;
  ticks: number;
  seedGlyph: number;
  dots: boolean;
}

const shapeCache = new Map<number, SigilShape>();
function shapeOf(seed: number): SigilShape {
  let s = shapeCache.get(seed);
  if (s) return s;
  const r = rng(seed);
  const poly = 3 + Math.floor(r() * 7); // 3..9
  let step = 1 + Math.floor(r() * Math.max(1, Math.floor((poly - 1) / 2)));
  if (gcd(poly, step) !== 1) step = 1;
  s = {
    rings: 2 + Math.floor(r() * 2),
    poly,
    step,
    glyphs: 6 + Math.floor(r() * 7),
    inner: 3 + Math.floor(r() * 4),
    spin: (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.35),
    ticks: [24, 36, 48, 60][Math.floor(r() * 4)],
    seedGlyph: Math.floor(r() * 1e6),
    dots: r() < 0.6,
  };
  shapeCache.set(seed, s);
  return s;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** A full procedural magic circle, animated by t. */
export function drawSigil(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, r: number, color: string, t: number, alpha = 1): void {
  if (r <= 1 || alpha <= 0.005) return;
  const s = shapeOf(seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  const lw = Math.max(0.8, r * 0.02);
  // outer double ring
  ctx.lineWidth = lw * 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  // tick marks between the rings, rotating
  ctx.save();
  ctx.rotate(t * s.spin * 0.5);
  ctx.beginPath();
  for (let i = 0; i < s.ticks; i++) {
    const a = (i / s.ticks) * Math.PI * 2;
    const long = i % 4 === 0;
    const r0 = r * (long ? 0.86 : 0.9);
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
  }
  ctx.stroke();
  ctx.restore();
  // ring of glyphs (rotating the other way)
  ctx.save();
  ctx.rotate(-t * s.spin);
  const gs = r * 0.13;
  for (let i = 0; i < s.glyphs; i++) {
    const a = (i / s.glyphs) * Math.PI * 2;
    const gx = Math.cos(a) * r * 0.7;
    const gy = Math.sin(a) * r * 0.7;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(a + Math.PI / 2);
    drawGlyph(ctx, seed + i * 7919, 0, 0, gs, color);
    ctx.restore();
  }
  ctx.restore();
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
  ctx.stroke();
  // star polygon {poly/step}
  ctx.save();
  ctx.rotate(t * s.spin * 1.3);
  ctx.lineWidth = lw * 1.1;
  ctx.beginPath();
  const pr = r * 0.56;
  for (let i = 0; i <= s.poly; i++) {
    const k = (i * s.step) % s.poly;
    const a = (k / s.poly) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * pr;
    const py = Math.sin(a) * pr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.stroke();
  if (s.dots) {
    for (let i = 0; i < s.poly; i++) {
      const a = (i / s.poly) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * pr, Math.sin(a) * pr, lw * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  // inner polygon + core glyph
  ctx.save();
  ctx.rotate(-t * s.spin * 2);
  ctx.beginPath();
  const ir = r * 0.26;
  for (let i = 0; i <= s.inner; i++) {
    const a = (i / s.inner) * Math.PI * 2;
    if (i) ctx.lineTo(Math.cos(a) * ir, Math.sin(a) * ir);
    else ctx.moveTo(Math.cos(a) * ir, Math.sin(a) * ir);
  }
  ctx.stroke();
  ctx.restore();
  drawGlyph(ctx, s.seedGlyph, 0, 0, r * 0.22, color);
  ctx.restore();
}

const urlCache = new Map<string, string>();

/** Render a spell's sigil (glowing, on transparent) to a data URL for UI cards. */
export function sigilDataUrl(seed: number, element: Element, size = 96): string {
  const key = `${seed}|${element}|${size}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const info = ELEMENT_INFO[element] ?? ELEMENT_INFO.arcane;
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const r = size * 0.42;
  // soft backdrop glow
  const bg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  bg.addColorStop(0, hexA(info.dark, 0.9));
  bg.addColorStop(0.7, hexA(info.dark, 0.35));
  bg.addColorStop(1, hexA(info.dark, 0));
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  // glow pass
  try {
    g.filter = `blur(${Math.max(1, size / 40)}px)`;
  } catch {
    /* no filter support */
  }
  g.globalAlpha = 0.9;
  drawSigil(g, seed, size / 2, size / 2, r, info.color, 0.6);
  g.filter = 'none';
  g.globalAlpha = 1;
  drawSigil(g, seed, size / 2, size / 2, r, info.glow, 0.6);
  const url = c.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const glyphSpriteCache = new Map<string, Canvas>();
/** Pre-rendered glowing glyph sprite (for rune particles). */
export function glyphSprite(seed: number, color: string): Canvas {
  const key = `${seed % 24}|${color}`;
  let c = glyphSpriteCache.get(key);
  if (c) return c;
  c = makeCanvas(32, 32);
  const g = ctx2d(c);
  try {
    g.filter = 'blur(1.5px)';
  } catch {
    /* ignore */
  }
  drawGlyph(g, seed % 24, 16, 16, 18, color);
  g.filter = 'none';
  drawGlyph(g, seed % 24, 16, 16, 18, '#ffffff');
  glyphSpriteCache.set(key, c);
  return c;
}
