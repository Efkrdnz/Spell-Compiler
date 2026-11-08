import { ELEMENT_INFO } from '../core/types';
import type { FrameInfo, RendererLike, View } from '../engine/engine';
import type { Entity } from '../sim/entity';
import type { World } from '../sim/world';
import { Effects } from './effects';
import { drawBody, drawFlash, drawHpBar, drawShadow, drawStatus } from './entities';
import type { DrawEnv } from './env';
import { Lighting } from './lighting';
import { Particles } from './particles';
import { Trails, drawBeam, drawField, drawFieldGround, drawHorizons, drawProjectile } from './spells';
import { ctx2d, makeCanvas, rgba, shadowSprite, type Canvas } from './sprites';
import { FloorLayer, TerrainLayer } from './terrain';

const TAU = Math.PI * 2;

const MAT_PREVIEW: Record<string, string> = {
  water: '#1b5f9c',
  oil: '#2a1a3a',
  grass: '#2f7a3a',
  lava: '#e0520f',
  floor: '#8a84a8',
};

const LABELS: Record<string, string> = {
  caster: 'You',
  dummy: 'Training Dummy',
  enemy: 'Enemy',
  target: 'Moving Target',
  crate: 'Crate',
  barrel: 'Explosive Barrel',
  metal: 'Metal Block',
  wall: 'Wall',
  pillar: 'Pillar',
  boulder: 'Boulder',
  summon: 'Summon',
  barrier: 'Barrier',
  sheep: 'Sheep',
  iceblock: 'Ice Block',
};

export interface RenderStats {
  frameMs: number;
  particles: number;
  lights: number;
  quality: number;
}

/**
 * The arena renderer. Pure consumer of the World + FX stream:
 *   floor → terrain → field grounds → shadows → bodies → smoke/debris →
 *   [light buffer multiply] → lens & ripple distortion → emissive layer
 *   (additive) + bloom → overlays (numbers, HP bars, reticle) → vignette.
 */
export class ArcaneRenderer implements RendererLike {
  private canvas: Canvas | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private emissive: Canvas = makeCanvas(1, 1);
  private eg = ctx2d(this.emissive);
  private bloom: Canvas = makeCanvas(1, 1);
  private bg = ctx2d(this.bloom);
  private bloom2: Canvas = makeCanvas(1, 1);
  private bg2 = ctx2d(this.bloom2);
  private scratch: Canvas = makeCanvas(1, 1);
  private sg = ctx2d(this.scratch);
  private vignette: Canvas = makeCanvas(1, 1);
  /** floor + terrain composited once per terrain change (saves a full-screen pass per frame) */
  private ground: Canvas = makeCanvas(1, 1);
  private groundKey = '';
  private floor = new FloorLayer();
  private terrain = new TerrainLayer();
  private light = new Lighting();
  readonly particles = new Particles(8000);
  private fx = new Effects(this.particles);
  private trails = new Trails();
  /** 2 = full, 1 = reduced, 0 = minimal (auto-adjusted from frame time) */
  quality = 2;
  autoQuality = true;
  /** draw the subtle PAUSED overlay */
  showPaused = true;
  private slowFrames = 0;
  private fastFrames = 0;
  stats: RenderStats = { frameMs: 0, particles: 0, lights: 0, quality: 2 };
  /** per-stage timings (ms, smoothed) when `profile` is on */
  profile = false;
  stages: Record<string, number> = {};
  private mark(name: string, t: number): number {
    const now = performance.now();
    if (this.profile) this.stages[name] = (this.stages[name] ?? 0) * 0.9 + (now - t) * 0.1;
    return now;
  }
  private proj: Entity[] = [];
  private beams: Entity[] = [];
  private fields: Entity[] = [];
  private bodies: Entity[] = [];

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
  }

  resize(_view: View): void {
    const c = this.canvas;
    if (!c) return;
    const W = c.width;
    const H = c.height;
    this.emissive.width = W;
    this.emissive.height = H;
    this.eg = ctx2d(this.emissive);
    this.bloom.width = Math.max(1, Math.round(W / 4));
    this.bloom.height = Math.max(1, Math.round(H / 4));
    this.bg = ctx2d(this.bloom);
    this.bloom2.width = Math.max(1, Math.round(W / 10));
    this.bloom2.height = Math.max(1, Math.round(H / 10));
    this.bg2 = ctx2d(this.bloom2);
    this.scratch.width = W;
    this.scratch.height = H;
    this.sg = ctx2d(this.scratch);
    this.light.resize(W, H);
    this.buildVignette(W, H);
  }

  private buildVignette(W: number, H: number): void {
    const v = this.vignette;
    v.width = Math.max(1, Math.round(W / 2));
    v.height = Math.max(1, Math.round(H / 2));
    const g = ctx2d(v);
    const gr = g.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.35, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) * 0.55);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(2,0,8,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, 0, v.width, v.height);
  }

  dispose(): void {
    this.particles.clear();
    this.fx.clear();
    this.trails.clear();
    this.canvas = null;
    this.g = null;
  }

  /** Forget transient visuals (e.g. after an arena reset). */
  reset(): void {
    this.particles.clear();
    this.fx.clear();
    this.trails.clear();
  }

  render(world: World, frame: FrameInfo): void {
    const g = this.g;
    const c = this.canvas;
    if (!g || !c) return;
    const t0 = performance.now();
    const W = c.width;
    const H = c.height;
    if (this.emissive.width !== W || this.emissive.height !== H) this.resize(frame.view);
    const view = frame.view;
    const dpr = view.dpr;
    const S = view.scale * dpr;
    const shake = world.shake * S * 0.9;
    const ox = view.ox * dpr + (shake > 0.05 ? (Math.random() - 0.5) * shake : 0);
    const oy = view.oy * dpr + (shake > 0.05 ? (Math.random() - 0.5) * shake : 0);
    const dt = frame.paused ? 0 : Math.min(0.05, frame.dt);
    const time = performance.now() / 1000;

    // classify entities (no allocation: reuse arrays)
    const proj = this.proj;
    const beams = this.beams;
    const fields = this.fields;
    const bodies = this.bodies;
    proj.length = beams.length = fields.length = bodies.length = 0;
    let caster: Entity | undefined;
    for (const e of world.list) {
      if (!e.alive) continue;
      if (e.kind === 'projectile') proj.push(e);
      else if (e.kind === 'beam') beams.push(e);
      else if (e.kind === 'field') fields.push(e);
      else {
        bodies.push(e);
        if (e.kind === 'caster') caster = e;
      }
    }
    // emission budget from load and quality
    const P = this.particles;
    const qMul = this.quality === 2 ? 1 : this.quality === 1 ? 0.6 : 0.35;
    P.budget = Math.max(0.15, Math.min(1, 1 - (P.n - 2500) / 5000)) * (proj.length > 250 ? 0.4 : proj.length > 120 ? 0.7 : 1) * qMul;

    this.fx.beginFrame();
    for (const f of world.fx) this.fx.handle(f);
    P.update(dt);
    this.fx.update(dt);
    this.light.res = this.quality === 2 ? 0.4 : this.quality === 1 ? 0.3 : 0.22;
    this.light.resize(W, H);
    this.light.begin();

    // ── base: letterbox + floor + terrain ───────────────────────────────────
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#06050b';
    g.fillRect(0, 0, W, H);
    g.setTransform(S, 0, 0, S, ox, oy);
    // letterbox glow continuing the floor (only when there is a letterbox)
    if (view.ox > 2 || view.oy > 2) {
      g.globalAlpha = 0.5;
      g.drawImage(shadowSprite(), -400, -300, world.width + 800, world.height + 600);
      g.globalAlpha = 1;
    }
    const gres = Math.min(2.5, S);
    this.floor.ensure(world.width, world.height, gres);
    this.terrain.sync(world.terrain, Math.min(2, Math.max(0.5, S)));
    const key = `${gres.toFixed(3)}|${world.terrain.version}`;
    if (key !== this.groundKey) {
      this.groundKey = key;
      const gc = this.ground;
      if (gc.width !== this.floor.canvas.width || gc.height !== this.floor.canvas.height) {
        gc.width = this.floor.canvas.width;
        gc.height = this.floor.canvas.height;
      }
      const gg = ctx2d(gc);
      gg.globalCompositeOperation = 'copy';
      gg.drawImage(this.floor.canvas, 0, 0);
      gg.globalCompositeOperation = 'source-over';
      gg.drawImage(this.terrain.canvas, 0, 0, gc.width, gc.height);
    }
    g.drawImage(this.ground, 0, 0, world.width, world.height);

    let tm = this.mark('base', t0);
    // emissive layer
    const E = this.eg;
    E.setTransform(1, 0, 0, 1, 0, 0);
    E.globalCompositeOperation = 'source-over';
    E.clearRect(0, 0, W, H);
    E.setTransform(S, 0, 0, S, ox, oy);
    E.globalCompositeOperation = 'lighter';

    const env: DrawEnv = {
      g,
      e: E,
      light: this.light,
      P,
      t: time,
      dt,
      S,
      ox,
      oy,
      caster,
      cursor: frame.cursor,
      activeElement: frame.activeElement,
      budget: P.budget,
      hoverId: frame.hover?.id ?? 0,
    };

    // ── lit scene ───────────────────────────────────────────────────────────
    // animated ground (water caustics, lava, burning cells) sits under bodies
    g.globalCompositeOperation = 'lighter';
    this.terrain.animate(world.terrain, g, time, dt, this.light, P, P.budget);
    g.globalCompositeOperation = 'source-over';
    for (const f of fields) drawFieldGround(env, f);
    for (const e of bodies) if (e.solid && e.kind !== 'pillar' && e.kind !== 'wall' && e.kind !== 'barrier') drawShadow(env, e);
    for (const e of bodies) {
      drawBody(env, e);
      drawStatus(env, e);
      drawFlash(env, e);
    }
    P.drawNormal(g, S, ox, oy);
    tm = this.mark('bodies', tm);

    // ── emissive content (also queues lights) ───────────────────────────────
    for (const f of fields) drawField(env, f);
    const heavy = proj.length > 140;
    for (const p of proj) drawProjectile(env, p, this.trails, heavy);
    for (const b of beams) drawBeam(env, b);
    this.fx.drawEmissive(E, this.light, time);
    this.fx.coreGlow(E);
    tm = this.mark('spells', tm);
    P.drawAdditive(E, S, ox, oy);
    tm = this.mark('particles', tm);

    // ── lighting ────────────────────────────────────────────────────────────
    this.light.composite(g, S, ox, oy, W, H);
    tm = this.mark('lighting', tm);

    // ── distortion: gravity lensing + shockwave ripples ─────────────────────
    const lenses = fields.filter((f) => f.field!.kind === 'gravity');
    // q2: lenses + ripples, q1: lenses only, q0: none
    const ripples = this.quality === 2 && this.fx.ripples.length > 0;
    if (this.quality > 0 && (lenses.length || ripples)) this.distort(g, lenses, ripples, S, ox, oy, W, H);

    tm = this.mark('distort', tm);
    // ── composite emissive + bloom ──────────────────────────────────────────
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(this.emissive, 0, 0);
    if (this.quality > 0) {
      // filter-free bloom: progressive downsample, bilinear upscale ≈ gaussian glow
      const B = this.bg;
      const B2 = this.bg2;
      B.globalCompositeOperation = 'copy';
      B.imageSmoothingQuality = 'low';
      B.drawImage(this.emissive, 0, 0, this.bloom.width, this.bloom.height);
      B2.globalCompositeOperation = 'copy';
      B2.drawImage(this.bloom, 0, 0, this.bloom2.width, this.bloom2.height);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.55;
      g.drawImage(this.bloom, 0, 0, W, H);
      g.globalAlpha = this.quality === 2 ? 0.9 : 0.7;
      g.drawImage(this.bloom2, 0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
    tm = this.mark('composite', tm);

    // ── overlays (unlit) ────────────────────────────────────────────────────
    g.setTransform(S, 0, 0, S, ox, oy);
    if (fields.length) drawHorizons(g, fields, time);
    for (const e of bodies) drawHpBar(env, e, e.id === env.hoverId);
    this.drawHover(g, frame);
    this.fx.drawOverlay(g);
    this.drawCursor(g, frame, caster, time);

    // vignette
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.vignette, 0, 0, W, H);
    if (frame.paused && this.showPaused) {
      g.fillStyle = 'rgba(8,6,20,0.28)';
      g.fillRect(0, 0, W, H);
      g.font = `600 ${Math.round(13 * dpr)}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(236,232,255,0.8)';
      g.fillText('❚❚  PAUSED', W / 2, 26 * dpr);
    }
    this.trails.endFrame();
    this.mark('overlay', tm);

    // adaptive quality
    const ms = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.92 + ms * 0.08;
    this.stats.particles = P.n;
    this.stats.lights = this.light.count;
    this.stats.quality = this.quality;
    if (this.autoQuality) {
      if (ms > 24) this.slowFrames++;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (ms < 9) this.fastFrames++;
      else this.fastFrames = 0;
      if (this.slowFrames > 40 && this.quality > 0) {
        this.quality--;
        this.slowFrames = 0;
      } else if (this.fastFrames > 240 && this.quality < 2) {
        this.quality++;
        this.fastFrames = 0;
      }
    }
  }

  private distort(g: CanvasRenderingContext2D, lenses: Entity[], doRipples: boolean, S: number, ox: number, oy: number, W: number, H: number): void {
    const sc = this.sg;
    const src = this.canvas!;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    // (the main canvas is opaque, so plain source-over fully replaces the box;
    //  'copy' would clear the entire scratch canvas on every call)
    sc.globalCompositeOperation = 'source-over';
    /** copy only the device-pixel box we are about to warp */
    const grab = (cx: number, cy: number, half: number): boolean => {
      const x0 = Math.max(0, Math.floor(cx - half));
      const y0 = Math.max(0, Math.floor(cy - half));
      const x1 = Math.min(W, Math.ceil(cx + half));
      const y1 = Math.min(H, Math.ceil(cy + half));
      if (x1 - x0 < 2 || y1 - y0 < 2) return false;
      sc.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      return true;
    };
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    for (const f of lenses) {
      const fd = f.field!;
      const fade = Math.min(1, fd.life / 0.35) * Math.min(1, (fd.maxLife - fd.life) / 0.2);
      const cx = f.pos.x * S + ox;
      const cy = f.pos.y * S + oy;
      const R = fd.radius * f.scale * S * 0.62;
      if (R < 4 || !grab(cx, cy, R * 2.3)) continue;
      // two nested pinch lenses: a wider area squeezed into a smaller disc
      for (const [rr, k] of [
        [R, 1.5],
        [R * 0.55, 2.2],
      ] as const) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, rr, 0, TAU);
        g.clip();
        g.globalAlpha = fade;
        const sr = rr * k;
        g.drawImage(this.scratch, cx - sr, cy - sr, sr * 2, sr * 2, cx - rr, cy - rr, rr * 2, rr * 2);
        g.restore();
      }
      // event horizon
      g.globalAlpha = fade;
      const hr = R * 0.42;
      g.drawImage(shadowSprite(), cx - hr * 1.8, cy - hr * 1.8, hr * 3.6, hr * 3.6);
      g.fillStyle = '#000000';
      g.beginPath();
      g.arc(cx, cy, hr * 0.55, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    for (const r of doRipples ? this.fx.ripples : []) {
      const p = r.t / r.max;
      const e = 1 - Math.pow(1 - p, 2.4);
      const cx = r.x * S + ox;
      const cy = r.y * S + oy;
      const rad = r.r * S * e;
      const w = Math.max(6, 22 * S * (1 - p * 0.5));
      const outer = rad + w;
      if (rad < 2 || !grab(cx, cy, outer + 2)) continue;
      g.save();
      g.beginPath();
      g.arc(cx, cy, outer, 0, TAU);
      g.arc(cx, cy, Math.max(0, rad - w), 0, TAU, true);
      g.clip();
      const k = 1 + 0.08 * r.strength * (1 - p);
      const sr = outer / k;
      g.globalAlpha = 1 - p * 0.6;
      g.drawImage(this.scratch, cx - sr, cy - sr, sr * 2, sr * 2, cx - outer, cy - outer, outer * 2, outer * 2);
      g.restore();
    }
    sc.globalCompositeOperation = 'source-over';
    g.restore();
    g.globalAlpha = 1;
  }

  private drawHover(g: CanvasRenderingContext2D, frame: FrameInfo): void {
    const h = frame.hover;
    if (!h || !h.alive) return;
    const r = (h.shape === 'box' ? Math.max(h.hw, h.hh) * 1.2 : h.r) + 6;
    g.save();
    g.strokeStyle = 'rgba(236,232,255,0.55)';
    g.lineWidth = 1.2;
    g.setLineDash([4, 4]);
    g.lineDashOffset = -performance.now() / 60;
    g.beginPath();
    g.arc(h.pos.x, h.pos.y, r, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    const name = h.label ?? (h.kind === 'summon' && h.summon ? `${cap(h.summon.kind)} (${ELEMENT_INFO[h.element].label})` : (LABELS[h.kind] ?? h.kind));
    const st: string[] = [];
    const s = h.status;
    if (s.burning > 0) st.push('burning');
    if (s.frozen > 0) st.push('frozen');
    else if (s.chilled > 0) st.push('chilled');
    if (s.wet > 0) st.push('wet');
    if (s.shocked > 0) st.push('shocked');
    if (s.shield > 0) st.push(`shield ${Math.round(s.shield)}`);
    if (s.polymorph > 0) st.push('polymorphed');
    const hp = (h.destructible || h.kind === 'caster') && h.maxHp < 1e8 ? `${Math.max(0, Math.round(h.hp))}/${Math.round(h.maxHp)}` : 'indestructible';
    const line2 = st.length ? `${hp} · ${st.join(', ')}` : hp;
    g.font = '600 11px Inter, system-ui, sans-serif';
    const w = Math.max(g.measureText(name).width, (g.font = '10px Inter, system-ui, sans-serif', g.measureText(line2).width)) + 14;
    const x = h.pos.x - w / 2;
    const y = h.pos.y - r - 44;
    g.fillStyle = 'rgba(14,11,26,0.88)';
    g.strokeStyle = 'rgba(183,140,255,0.4)';
    g.lineWidth = 1;
    roundRect(g, x, y, w, 30, 6);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ece8ff';
    g.font = '600 11px Inter, system-ui, sans-serif';
    g.fillText(name, h.pos.x, y + 10);
    g.fillStyle = '#a79fcc';
    g.font = '10px Inter, system-ui, sans-serif';
    g.fillText(line2, h.pos.x, y + 22);
    g.restore();
  }

  private drawCursor(g: CanvasRenderingContext2D, frame: FrameInfo, caster: Entity | undefined, time: number): void {
    const c = frame.cursor;
    if (!c) return;
    const el = ELEMENT_INFO[frame.activeElement];
    g.save();
    if (frame.tool.startsWith('spawn:')) {
      const kind = frame.tool.slice(6);
      if (kind.startsWith('paint:')) {
        const m = kind.slice(6);
        g.fillStyle = rgba(MAT_PREVIEW[m] ?? '#8a84a8', 0.35);
        g.strokeStyle = rgba(MAT_PREVIEW[m] ?? '#8a84a8', 0.9);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(c.x, c.y, 40, 0, TAU);
        g.fill();
        g.stroke();
      } else {
        g.strokeStyle = 'rgba(236,232,255,0.7)';
        g.setLineDash([3, 3]);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(c.x, c.y, 18, 0, TAU);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(236,232,255,0.85)';
        g.font = '600 10px Inter, system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(`+ ${kind.replace('enemy:', '')}`, c.x, c.y - 26);
      }
      g.restore();
      return;
    }
    if (frame.tool === 'grab') {
      if (frame.dragging) {
        g.strokeStyle = 'rgba(255,210,122,0.8)';
        g.lineWidth = 1.5;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(c.x, c.y);
        g.lineTo(frame.dragging.pos.x, frame.dragging.pos.y);
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.arc(frame.dragging.pos.x, frame.dragging.pos.y, frame.dragging.r + 5, 0, TAU);
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,210,122,0.9)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(c.x, c.y, 9, 0, TAU);
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.45;
        g.moveTo(c.x + Math.cos(a) * 9, c.y + Math.sin(a) * 9);
        g.lineTo(c.x + Math.cos(a) * 15, c.y + Math.sin(a) * 15);
      }
      g.stroke();
      g.restore();
      return;
    }
    // aim line
    if (caster) {
      const dx = c.x - caster.pos.x;
      const dy = c.y - caster.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 30) {
        const ux = dx / d;
        const uy = dy / d;
        const grad = g.createLinearGradient(caster.pos.x, caster.pos.y, c.x, c.y);
        grad.addColorStop(0, rgba(el.color, 0));
        grad.addColorStop(0.3, rgba(el.color, 0.35));
        grad.addColorStop(1, rgba(el.color, 0.05));
        g.strokeStyle = grad;
        g.lineWidth = 1.5;
        g.setLineDash([2, 7]);
        g.lineDashOffset = -time * 30;
        g.beginPath();
        g.moveTo(caster.pos.x + ux * 26, caster.pos.y + uy * 26);
        g.lineTo(c.x - ux * 16, c.y - uy * 16);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // reticle
    const ready = frame.cooldown <= 0.001;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rgba(el.glow, ready ? 0.9 : 0.35);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c.x, c.y, 11, 0, TAU);
    g.stroke();
    g.save();
    g.translate(c.x, c.y);
    g.rotate(time * 1.2);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4;
      g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
      g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
    }
    g.stroke();
    g.restore();
    if (!ready) {
      g.strokeStyle = rgba(el.color, 0.95);
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(c.x, c.y, 15, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - frame.cooldown));
      g.stroke();
    }
    g.fillStyle = rgba(el.glow, 0.9);
    g.beginPath();
    g.arc(c.x, c.y, 1.6, 0, TAU);
    g.fill();
    if (frame.channeling) {
      const p = (time * 2) % 1;
      g.strokeStyle = rgba(el.color, 1 - p);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(c.x, c.y, 11 + p * 18, 0, TAU);
      g.stroke();
      if (caster) {
        g.strokeStyle = rgba(el.glow, 0.5 + 0.3 * Math.sin(time * 20));
        g.beginPath();
        g.arc(caster.pos.x, caster.pos.y, caster.r + 11 + Math.sin(time * 8) * 2, 0, TAU);
        g.stroke();
      }
    }
    g.restore();
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
