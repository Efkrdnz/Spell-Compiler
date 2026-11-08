/**
 * Cached pre-rendered sprites. Nothing in the hot render path creates
 * gradients per object per frame — everything is a drawImage of one of these.
 */

export type Canvas = HTMLCanvasElement;

export function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: Canvas): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

/** "#rrggbb" -> [r,g,b] */
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const glowCache = new Map<string, Canvas>();

/** Soft radial glow: colour at centre fading to transparent. 64px. */
export function glowSprite(color: string): Canvas {
  let c = glowCache.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(color, 1));
  gr.addColorStop(0.25, rgba(color, 0.55));
  gr.addColorStop(0.6, rgba(color, 0.14));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

const coreCache = new Map<string, Canvas>();

/** Hot core: white centre, coloured halo. */
export function coreSprite(color: string): Canvas {
  let c = coreCache.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.3, rgba(color, 0.85));
  gr.addColorStop(0.55, rgba(color, 0.25));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  coreCache.set(color, c);
  return c;
}

const lightCache = new Map<string, Canvas>();

/** Light falloff sprite for the light buffer (smooth quadratic falloff). */
export function lightSprite(color: string): Canvas {
  let c = lightCache.get(color);
  if (c) return c;
  c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    gr.addColorStop(t, rgba(color, Math.pow(1 - t, 2.2)));
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  lightCache.set(color, c);
  return c;
}

let shadow: Canvas | null = null;
export function shadowSprite(): Canvas {
  if (shadow) return shadow;
  shadow = makeCanvas(64, 64);
  const g = ctx2d(shadow);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return shadow;
}

const smokeCache = new Map<string, Canvas>();
export function smokeSprite(color: string): Canvas {
  let c = smokeCache.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  // lumpy smoke: several offset soft blobs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = 32 + Math.cos(a) * 8;
    const y = 32 + Math.sin(a) * 8;
    const gr = g.createRadialGradient(x, y, 0, x, y, 20);
    gr.addColorStop(0, rgba(color, 0.35));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  smokeCache.set(color, c);
  return c;
}

const flakeCache = new Map<string, Canvas>();
/** Six-armed frost flake. */
export function flakeSprite(color: string): Canvas {
  let c = flakeCache.get(color);
  if (c) return c;
  c = makeCanvas(32, 32);
  const g = ctx2d(c);
  g.translate(16, 16);
  g.strokeStyle = rgba(color, 1);
  g.lineCap = 'round';
  g.lineWidth = 1.6;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, 12);
    g.moveTo(0, 7);
    g.lineTo(3.5, 10);
    g.moveTo(0, 7);
    g.lineTo(-3.5, 10);
    g.stroke();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 8);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(-8, -8, 16, 16);
  flakeCache.set(color, c);
  return c;
}

const flameCache = new Map<string, Canvas>();
/** Teardrop flame tongue, pointing up. 32x48. */
export function flameSprite(color: string, hot = '#fff3b0'): Canvas {
  const key = color + hot;
  let c = flameCache.get(key);
  if (c) return c;
  c = makeCanvas(32, 48);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(16, 34, 1, 16, 30, 22);
  gr.addColorStop(0, rgba(hot, 1));
  gr.addColorStop(0.35, rgba(color, 0.9));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(16, 2);
  g.bezierCurveTo(22, 16, 30, 26, 28, 36);
  g.bezierCurveTo(26, 46, 6, 46, 4, 36);
  g.bezierCurveTo(2, 26, 10, 16, 16, 2);
  g.fill();
  flameCache.set(key, c);
  return c;
}

const hexCache = new Map<string, Canvas>();
/** Hex-grid shield bubble texture. */
export function hexBubble(color: string): Canvas {
  let c = hexCache.get(color);
  if (c) return c;
  const S = 128;
  c = makeCanvas(S, S);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  gr.addColorStop(0, rgba(color, 0.02));
  gr.addColorStop(0.85, rgba(color, 0.22));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = rgba(color, 0.45);
  g.lineWidth = 1.2;
  const hs = 11;
  for (let row = -1; row < S / (hs * 1.5) + 1; row++) {
    for (let col = -1; col < S / (hs * 1.732) + 1; col++) {
      const cx = col * hs * 1.732 + (row % 2 ? hs * 0.866 : 0);
      const cy = row * hs * 1.5;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const x = cx + Math.cos(a) * hs;
        const y = cy + Math.sin(a) * hs;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
  }
  g.restore();
  g.strokeStyle = rgba(color, 0.9);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  g.stroke();
  hexCache.set(color, c);
  return c;
}
