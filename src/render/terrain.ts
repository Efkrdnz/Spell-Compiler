import type { Terrain } from '../sim/terrain';
import { drawSigil, drawGlyph } from './sigils';
import { ctx2d, flameSprite, glowSprite, makeCanvas, type Canvas } from './sprites';
import type { Lighting } from './lighting';
import { PT, type Particles } from './particles';

// material ids (mirror of sim/terrain Mat)
const WATER = 1,
  ICE = 2,
  OIL = 3,
  LAVA = 4,
  GRASS = 5,
  FIRE = 6,
  SCORCHED = 7,
  SPIKES = 8;

/** draw order: lower materials first so brighter/wetter ones overlap them */
const ORDER = [SCORCHED, GRASS, OIL, WATER, ICE, LAVA, FIRE, SPIKES];

interface MatStyle {
  rim: string;
  body: string;
  inner: string;
}
const STYLE: Record<number, MatStyle> = {
  [WATER]: { rim: '#0a2340', body: '#123f6e', inner: '#1b5f9c' },
  [ICE]: { rim: '#4a8fb4', body: '#9fdcf6', inner: '#dcf7ff' },
  [OIL]: { rim: '#040306', body: '#0f0a17', inner: '#171024' },
  [LAVA]: { rim: '#2c0600', body: '#8a1e06', inner: '#e0520f' },
  [GRASS]: { rim: '#102d16', body: '#1a4c24', inner: '#23652f' },
  [FIRE]: { rim: '#2a0c04', body: '#5c1906', inner: '#a8360b' },
  [SCORCHED]: { rim: '#0a0808', body: '#16110f', inner: '#1d1714' },
  [SPIKES]: { rim: '#121219', body: '#22222c', inner: '#2c2c38' },
};

function hash(i: number, k = 0): number {
  let h = (i * 2654435761 + k * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Dark arcane stone floor, cached per resolution. */
export class FloorLayer {
  canvas: Canvas = makeCanvas(1, 1);
  private key = '';

  ensure(worldW: number, worldH: number, res: number): void {
    const key = `${worldW}x${worldH}@${res.toFixed(3)}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas;
    c.width = Math.ceil(worldW * res);
    c.height = Math.ceil(worldH * res);
    const g = ctx2d(c);
    g.setTransform(res, 0, 0, res, 0, 0);
    g.fillStyle = '#0d0b16';
    g.fillRect(0, 0, worldW, worldH);
    // flagstones
    const T = 80;
    for (let y = 0; y < worldH; y += T) {
      for (let x = 0; x < worldW; x += T) {
        const i = (x / T) * 131 + (y / T) * 7;
        const l = hash(i, 1);
        const off = (y / T) % 2 ? T / 2 : 0;
        const tx = x - off;
        g.fillStyle = `rgb(${18 + l * 9},${16 + l * 8},${28 + l * 12})`;
        g.fillRect(tx + 1.5, y + 1.5, T - 3, T - 3);
        if (off) {
          g.fillRect(tx + T + 1.5, y + 1.5, T - 3, T - 3);
        }
        // bevel highlight
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(tx + 1.5, y + 1.5, T - 3, 2);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(tx + 1.5, y + T - 3.5, T - 3, 2);
        // cracks
        if (hash(i, 2) < 0.35) {
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.lineWidth = 1;
          g.beginPath();
          let cx = tx + hash(i, 3) * T;
          let cy = y + hash(i, 4) * T;
          g.moveTo(cx, cy);
          for (let k = 0; k < 4; k++) {
            cx += (hash(i, 5 + k) - 0.5) * 30;
            cy += (hash(i, 9 + k) - 0.5) * 30;
            g.lineTo(cx, cy);
          }
          g.stroke();
        }
      }
    }
    // speckle grain
    for (let k = 0; k < 2600; k++) {
      const x = hash(k, 20) * worldW;
      const y = hash(k, 21) * worldH;
      g.fillStyle = hash(k, 22) < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.18)';
      g.fillRect(x, y, 1.5, 1.5);
    }
    // faint arcane lines etched into the floor
    g.globalAlpha = 0.075;
    drawSigil(g, 0x5eed, worldW / 2, worldH / 2, 360, '#8b6cff', 0);
    g.globalAlpha = 0.05;
    drawSigil(g, 0xc0de, worldW / 2, worldH / 2, 200, '#66e0ff', 1.3);
    g.globalAlpha = 0.06;
    for (const [x, y, s] of [
      [130, 120, 1],
      [worldW - 130, 120, 2],
      [130, worldH - 120, 3],
      [worldW - 130, worldH - 120, 4],
    ])
      drawSigil(g, 0xab00 + s, x, y, 90, '#b78cff', s);
    g.globalAlpha = 0.05;
    for (let k = 0; k < 40; k++) drawGlyph(g, k * 37, hash(k, 30) * worldW, hash(k, 31) * worldH, 14 + hash(k, 32) * 10, '#cbb8ff');
    g.globalAlpha = 1;
    // arena edge: carved border
    g.strokeStyle = 'rgba(183,140,255,0.18)';
    g.lineWidth = 3;
    g.strokeRect(4, 4, worldW - 8, worldH - 8);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 6;
    g.strokeRect(-2, -2, worldW + 4, worldH + 4);
    // inner vignette
    const vg = g.createRadialGradient(worldW / 2, worldH / 2, worldH * 0.35, worldW / 2, worldH / 2, worldW * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, worldW, worldH);
  }
}

/**
 * The material grid rendered as soft organic blobs into a cached canvas.
 * Only cells that changed (diffed against our own copy) are redrawn.
 */
export class TerrainLayer {
  canvas: Canvas = makeCanvas(1, 1);
  private g = ctx2d(this.canvas);
  private res = 0;
  private version = -1;
  private mats: Uint8Array = new Uint8Array(0);
  water: number[] = [];
  lava: number[] = [];
  fire: number[] = [];
  ice: number[] = [];

  sync(T: Terrain, res: number): void {
    const resChanged = Math.abs(res - this.res) > 1e-3 || this.mats.length !== T.mat.length;
    if (!resChanged && T.version === this.version) return;
    if (resChanged) {
      this.res = res;
      this.canvas.width = Math.ceil(T.width * res);
      this.canvas.height = Math.ceil(T.height * res);
      this.g = ctx2d(this.canvas);
      this.mats = new Uint8Array(T.mat);
      this.version = T.version;
      this.full(T);
      this.rebuildLists(T);
      return;
    }
    this.version = T.version;
    const changed: number[] = [];
    for (let i = 0; i < T.mat.length; i++) if (T.mat[i] !== this.mats[i]) changed.push(i);
    this.mats.set(T.mat);
    if (!changed.length) return;
    if (changed.length > 350) this.full(T);
    else for (const i of changed) this.region(T, i);
    this.rebuildLists(T);
  }

  private rebuildLists(T: Terrain): void {
    this.water = [];
    this.lava = [];
    this.fire = [];
    this.ice = [];
    for (let i = 0; i < T.mat.length; i++) {
      const m = T.mat[i];
      if (m === WATER) this.water.push(i);
      else if (m === LAVA) this.lava.push(i);
      else if (m === FIRE) this.fire.push(i);
      else if (m === ICE) this.ice.push(i);
    }
  }

  private full(T: Terrain): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    const all: number[] = [];
    for (let i = 0; i < T.mat.length; i++) if (T.mat[i]) all.push(i);
    this.paint(T, all);
  }

  /** layered fill: every material's rim, then bodies, then cores — one path per (material, layer) */
  private paint(T: Terrain, cells: number[]): void {
    const g = this.g;
    for (const m of ORDER) {
      const st = STYLE[m];
      const mine = cells.filter((i) => T.mat[i] === m);
      if (!mine.length) continue;
      for (const [k, col] of [
        [0.74, st.rim],
        [0.6, st.body],
        [0.42, st.inner],
      ] as const) {
        g.fillStyle = col;
        g.beginPath();
        for (const i of mine) this.blobShape(T, i, m, k);
        g.fill();
      }
    }
    for (const i of cells) this.detail(T, i, T.mat[i]);
  }

  private region(T: Terrain, i: number): void {
    const g = this.g;
    const cs = T.cell;
    const c0 = i % T.cols;
    const r0 = (i / T.cols) | 0;
    g.save();
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.beginPath();
    g.rect((c0 - 1) * cs, (r0 - 1) * cs, cs * 3, cs * 3);
    g.clip();
    g.clearRect((c0 - 1) * cs, (r0 - 1) * cs, cs * 3, cs * 3);
    const cells: number[] = [];
    for (let r = r0 - 2; r <= r0 + 2; r++)
      for (let c = c0 - 2; c <= c0 + 2; c++) if (r >= 0 && c >= 0 && r < T.rows && c < T.cols) cells.push(r * T.cols + c);
    this.paint(
      T,
      cells.filter((k) => T.mat[k]),
    );
    g.restore();
  }

  private same(T: Terrain, c: number, r: number, m: number): boolean {
    if (c < 0 || r < 0 || c >= T.cols || r >= T.rows) return false;
    return T.mat[r * T.cols + c] === m;
  }

  /** organic blob: circles at centres, bridged to same-material neighbours */
  private blobShape(T: Terrain, i: number, m: number, k: number): void {
    const g = this.g;
    const cs = T.cell;
    const c = i % T.cols;
    const r = (i / T.cols) | 0;
    const cx = (c + 0.5) * cs;
    const cy = (r + 0.5) * cs;
    const R = cs * k;
    g.moveTo(cx + R, cy);
    g.arc(cx, cy, R, 0, Math.PI * 2);
    const right = this.same(T, c + 1, r, m);
    const down = this.same(T, c, r + 1, m);
    if (right) g.rect(cx, cy - R, cs, R * 2);
    if (down) g.rect(cx - R, cy, R * 2, cs);
    if (right && down && this.same(T, c + 1, r + 1, m)) g.rect(cx, cy, cs, cs);
  }

  private detail(T: Terrain, i: number, m: number): void {
    const g = this.g;
    const cs = T.cell;
    const cx = ((i % T.cols) + 0.5) * cs;
    const cy = (((i / T.cols) | 0) + 0.5) * cs;
    const h1 = hash(i, 1);
    const h2 = hash(i, 2);
    switch (m) {
      case GRASS: {
        g.lineCap = 'round';
        g.lineWidth = 1.2;
        for (let k = 0; k < 4; k++) {
          const x = cx + (hash(i, 10 + k) - 0.5) * cs;
          const y = cy + (hash(i, 20 + k) - 0.5) * cs;
          g.strokeStyle = hash(i, 30 + k) < 0.5 ? '#3f8f46' : '#5fbf5a';
          g.beginPath();
          g.moveTo(x, y + 3);
          g.lineTo(x - 2 + hash(i, 40 + k) * 4, y - 4);
          g.moveTo(x + 1, y + 3);
          g.lineTo(x + 3, y - 2);
          g.stroke();
        }
        if (h1 < 0.08) {
          g.fillStyle = h2 < 0.5 ? '#e8c6ff' : '#ffe08a';
          g.beginPath();
          g.arc(cx, cy, 1.6, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case ICE: {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 0.8;
        g.beginPath();
        const a = h1 * Math.PI;
        g.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8);
        g.lineTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
        if (h2 < 0.5) {
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a + 1) * 6, cy + Math.sin(a + 1) * 6);
        }
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(cx - 5 + h2 * 4, cy - 6, 3, 1.2);
        break;
      }
      case OIL: {
        if (h1 < 0.22) {
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 22);
          gr.addColorStop(0, h2 < 0.5 ? 'rgba(110,60,170,0.16)' : 'rgba(40,140,140,0.14)');
          gr.addColorStop(0.5, h2 < 0.5 ? 'rgba(40,120,150,0.07)' : 'rgba(150,70,130,0.07)');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(cx - 22, cy - 22, 44, 44);
        }
        break;
      }
      case LAVA: {
        g.strokeStyle = '#ffb347';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(cx - 9, cy + (h1 - 0.5) * 8);
        g.quadraticCurveTo(cx, cy + (h2 - 0.5) * 14, cx + 9, cy + (hash(i, 3) - 0.5) * 8);
        g.stroke();
        break;
      }
      case SCORCHED: {
        g.fillStyle = 'rgba(70,55,45,0.5)';
        for (let k = 0; k < 3; k++) g.fillRect(cx + (hash(i, 50 + k) - 0.5) * 16, cy + (hash(i, 60 + k) - 0.5) * 16, 2, 2);
        break;
      }
      case SPIKES: {
        g.fillStyle = '#9a9ab0';
        for (let k = 0; k < 3; k++) {
          const x = cx + (k - 1) * 6;
          const y = cy + (hash(i, 70 + k) - 0.5) * 6;
          g.beginPath();
          g.moveTo(x - 2.5, y + 3);
          g.lineTo(x, y - 4);
          g.lineTo(x + 2.5, y + 3);
          g.fill();
        }
        break;
      }
      case FIRE: {
        g.fillStyle = 'rgba(255,140,40,0.35)';
        g.beginPath();
        g.arc(cx + (h1 - 0.5) * 6, cy + (h2 - 0.5) * 6, 4, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }
  }

  /** Per-frame animated overlays (emissive pass) + their lights and particles. */
  animate(T: Terrain, g: CanvasRenderingContext2D, t: number, dt: number, light: Lighting, P: Particles, budget: number): void {
    const cs = T.cell;
    const cols = T.cols;
    // water caustics
    if (this.water.length) {
      g.globalAlpha = 1;
      g.strokeStyle = '#8fd8ff';
      g.lineCap = 'round';
      g.lineWidth = 1.2;
      g.beginPath();
      let drawn = 0;
      for (const i of this.water) {
        const h = hash(i, 7);
        const ph = Math.sin(t * 1.6 + h * 40) * Math.sin(t * 0.7 + h * 17);
        if (ph < 0.55) continue;
        const cx = ((i % cols) + 0.5) * cs + (h - 0.5) * 8;
        const cy = (((i / cols) | 0) + 0.5) * cs + (hash(i, 8) - 0.5) * 8;
        const L = 3 + (ph - 0.55) * 14;
        g.moveTo(cx - L, cy);
        g.quadraticCurveTo(cx, cy - 2, cx + L, cy);
        if (++drawn > 400) break;
      }
      g.globalAlpha = 0.35;
      g.stroke();
      g.globalAlpha = 1;
    }
    // ice glints
    for (let k = 0; k < this.ice.length; k += 3) {
      const i = this.ice[k];
      const h = hash(i, 9);
      const ph = Math.sin(t * 2.2 + h * 50);
      if (ph < 0.93) continue;
      const cx = ((i % cols) + 0.5) * cs;
      const cy = (((i / cols) | 0) + 0.5) * cs;
      g.globalAlpha = (ph - 0.93) * 14;
      g.drawImage(glowSprite('#e4fbff'), cx - 6, cy - 6, 12, 12);
    }
    g.globalAlpha = 1;
    // lava: pulsing glow, lights, embers
    if (this.lava.length) {
      const gs = glowSprite('#ff6a1a');
      const step = Math.max(1, Math.floor(this.lava.length / 30));
      for (let k = 0; k < this.lava.length; k++) {
        const i = this.lava[k];
        const cx = ((i % cols) + 0.5) * cs;
        const cy = (((i / cols) | 0) + 0.5) * cs;
        const p = 0.5 + 0.5 * Math.sin(t * 1.8 + hash(i, 11) * 12);
        g.globalAlpha = 0.18 + p * 0.22;
        g.drawImage(gs, cx - 18, cy - 18, 36, 36);
        if (k % step === 0) light.add(cx, cy, 70 + step * 6, '#ff5a1a', 0.55);
        if (Math.random() < dt * 0.6 * budget) P.spawn(PT.Ember, cx, cy, (Math.random() - 0.5) * 20, -20, 1.2, 2.2, P.c('#ff8a3a'), 0, 1, 30);
      }
      g.globalAlpha = 1;
    }
    // burning ground: flames
    if (this.fire.length) {
      const fs = flameSprite('#ff6a1a');
      const fs2 = flameSprite('#ff3d10', '#ffd27a');
      const step = Math.max(1, Math.floor(this.fire.length / 40));
      // big burning fields: keep total emission roughly constant
      const emit = budget * Math.min(1, 90 / this.fire.length);
      for (let k = 0; k < this.fire.length; k++) {
        const i = this.fire[k];
        const cx = ((i % cols) + 0.5) * cs;
        const cy = (((i / cols) | 0) + 0.5) * cs;
        const h = hash(i, 12);
        const timer = T.timer[i];
        const life = Math.min(1, timer / 1.2);
        const f1 = 0.7 + 0.3 * Math.sin(t * 14 + h * 30);
        const f2 = 0.7 + 0.3 * Math.sin(t * 11 + h * 70);
        const jx = (h - 0.5) * 14;
        const jy = (hash(i, 13) - 0.5) * 12;
        g.globalAlpha = 0.8 * life;
        const w = (9 + h * 9) * f1;
        g.drawImage(fs, cx + jx - w / 2, cy + jy - w * 1.5 + 6, w, w * 1.5);
        if (h > 0.45) {
          g.globalAlpha = 0.65 * life;
          const w2 = (7 + hash(i, 14) * 7) * f2;
          g.drawImage(fs2, cx - jx * 0.6 - w2 / 2, cy - jy - w2 * 1.5 + 8, w2, w2 * 1.5);
        }
        if (k % step === 0) light.add(cx, cy, 80 + step * 4, '#ff7a2f', 0.8 * life);
        if (Math.random() < dt * 1.4 * emit) P.spawn(PT.Ember, cx + (h - 0.5) * 12, cy - 4, (Math.random() - 0.5) * 30, -40, 0.9, 2, P.c('#ffb347'), 0, 1, 60);
        if (Math.random() < dt * 0.35 * emit) P.spawn(PT.Smoke, cx, cy - 10, (Math.random() - 0.5) * 10, -25, 1.6, 8, P.c('#2a2228'), 14, 0.5, 8);
      }
      g.globalAlpha = 1;
    }
  }
}
