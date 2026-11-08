import { compileSpell, type CompiledSpell } from '../core/compiler';
import { SpellRuntime, type CastContext } from '../core/interpreter';
import { ELEMENTS, V, type Element, type SpellDoc, type Vec } from '../core/types';
import type { Entity } from '../sim/entity';
import { DEFAULT_ARENA_CONFIG, buildPreset, spawnAt, type ArenaConfig } from '../sim/presets';
import { World } from '../sim/world';

export const STEP = 1 / 60;

/** World → screen transform (letterboxed fit). */
export interface View {
  scale: number;
  ox: number;
  oy: number;
  width: number; // css pixels
  height: number;
  dpr: number;
}

export interface FrameInfo {
  dt: number;
  time: number;
  view: View;
  cursor: Vec | null;
  activeElement: Element;
  channeling: boolean;
  /** 0..1 cooldown remaining fraction for the active spell */
  cooldown: number;
  hover: Entity | undefined;
  tool: string;
  dragging: Entity | undefined;
  paused: boolean;
}

/** What the engine needs from a renderer. Implemented in src/render. */
export interface RendererLike {
  attach(canvas: HTMLCanvasElement): void;
  resize(view: View): void;
  render(world: World, frame: FrameInfo): void;
  dispose(): void;
}

export interface StatSample {
  t: number;
  dps: Record<Element, number>;
  total: number;
  heal: number;
  mana: number;
  manaSpent: number;
  entities: number;
  spellEntities: number;
  steps: number;
  timers: number;
  frameMs: number;
}

export const HOTBAR_SIZE = 6;

type Listener = () => void;

export class Engine {
  world = new World();
  rt: SpellRuntime;
  compiled = new Map<string, CompiledSpell>();
  private docs = new Map<string, SpellDoc>();
  renderer: RendererLike | null = null;
  canvas: HTMLCanvasElement | null = null;
  view: View = { scale: 1, ox: 0, oy: 0, width: 1600, height: 900, dpr: 1 };

  paused = false;
  timeScale = 1;
  presetId = 'training';
  arenaConfig: ArenaConfig = { ...DEFAULT_ARENA_CONFIG };
  hotbar: (string | null)[] = new Array(HOTBAR_SIZE).fill(null);
  activeSlot = 0;
  /** spell bound to the right mouse button */
  altSlot = 1;
  tool = 'cast';

  cursor: Vec | null = null;
  private keys = new Set<string>();
  private castButton: number | null = null;
  private castSpellId: string | null = null;
  private dragging: Entity | undefined;
  private dragOffset: Vec = { x: 0, y: 0 };
  private dragPrev: Vec = { x: 0, y: 0 };
  private acc = 0;
  private last = 0;
  private raf = 0;
  private frameMs = 0;
  private listeners = new Set<Listener>();
  private statAcc = 0;
  private lastDamage: Record<Element, number> = Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as Record<Element, number>;
  private lastHeal = 0;
  private stepsAcc = 0;
  private manaAcc = 0;
  stats: StatSample[] = [];
  message: { text: string; t: number } | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    this.rt = new SpellRuntime(this.world, (id) => this.compiled.get(id));
    buildPreset(this.world, this.presetId, this.arenaConfig);
  }

  // ── subscriptions (UI polls at a low rate via notify) ────────────────────
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private notify(): void {
    for (const l of this.listeners) l();
  }

  // ── spells ───────────────────────────────────────────────────────────────
  setLibrary(docs: SpellDoc[]): void {
    this.docs = new Map(docs.map((d) => [d.id, d]));
    this.compiled.clear();
    for (const d of docs) this.compiled.set(d.id, this.compileOne(d));
    // second pass so Cast Spell references resolve regardless of order
    for (const d of docs) this.compiled.set(d.id, this.compileOne(d));
    for (let i = 0; i < this.hotbar.length; i++) if (this.hotbar[i] && !this.docs.has(this.hotbar[i]!)) this.hotbar[i] = null;
  }

  upsertSpell(doc: SpellDoc): CompiledSpell {
    this.docs.set(doc.id, doc);
    const c = this.compileOne(doc);
    this.compiled.set(doc.id, c);
    // dependants that cast this spell may change validity
    for (const [id, other] of this.compiled) if (id !== doc.id && other.main.nodes.some((n) => n.type === 'castSpell' && n.params.spell === doc.id)) this.compiled.set(id, this.compileOne(other.doc));
    return c;
  }

  removeSpell(id: string): void {
    this.docs.delete(id);
    this.compiled.delete(id);
    this.hotbar = this.hotbar.map((h) => (h === id ? null : h));
  }

  private compileOne(doc: SpellDoc): CompiledSpell {
    return compileSpell(doc, { spellExists: (id) => this.docs.has(id), spellName: (id) => this.docs.get(id)?.name });
  }

  setHotbar(slot: number, spellId: string | null): void {
    if (slot < 0 || slot >= this.hotbar.length) return;
    this.hotbar[slot] = spellId;
    this.notify();
  }

  activeSpell(): CompiledSpell | undefined {
    const id = this.hotbar[this.activeSlot];
    return id ? this.compiled.get(id) : undefined;
  }

  // ── arena ────────────────────────────────────────────────────────────────
  loadPreset(id: string, cfg?: Partial<ArenaConfig>): void {
    this.presetId = id;
    if (cfg) this.arenaConfig = { ...this.arenaConfig, ...cfg };
    this.rt.reset();
    buildPreset(this.world, id, this.arenaConfig);
    this.lastDamage = Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as Record<Element, number>;
    this.lastHeal = 0;
    this.stats = [];
    this.notify();
  }

  resetArena(): void {
    this.loadPreset(this.presetId);
  }

  // ── attach / loop ────────────────────────────────────────────────────────
  attach(canvas: HTMLCanvasElement, renderer: RendererLike): void {
    this.detach();
    this.canvas = canvas;
    this.renderer = renderer;
    renderer.attach(canvas);
    this.measure();
    this.resizeObs = new ResizeObserver(() => this.measure());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onContext);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('pointermove', this.onMove);
      c.removeEventListener('pointerleave', this.onLeave);
      c.removeEventListener('contextmenu', this.onContext);
      c.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
  }

  private measure(): void {
    const c = this.canvas;
    if (!c) return;
    const host = c.parentElement ?? c;
    const w = Math.max(50, host.clientWidth);
    const h = Math.max(50, host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = Math.min(w / this.world.width, h / this.world.height);
    this.view = { scale, ox: (w - this.world.width * scale) / 2, oy: (h - this.world.height * scale) / 2, width: w, height: h, dpr };
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    this.renderer?.resize(this.view);
  }

  screenToWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale };
  }

  /** advance the simulation by fixed steps; exposed for tests and headless runs */
  simulate(seconds: number): void {
    let n = Math.round(seconds / STEP);
    while (n-- > 0) this.stepOnce();
  }

  private stepOnce(): void {
    this.moveCaster();
    if (this.castButton !== null && this.castSpellId) this.rt.updateChannel(STEP, this.castCtx());
    this.updateDrag();
    this.world.step(STEP);
    this.rt.tick();
    this.sampleStats(STEP);
  }

  private frame(now: number): void {
    const t0 = performance.now();
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.stepOnce();
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 6) this.acc = 0;
    } else dt = 0;
    const spell = this.activeSpell();
    const cdLeft = spell ? this.rt.cooldownLeft(spell.doc.id) : 0;
    this.renderer?.render(this.world, {
      dt,
      time: this.world.time,
      view: this.view,
      cursor: this.cursor,
      activeElement: spell?.doc.element ?? 'arcane',
      channeling: !!this.rt.channeling,
      cooldown: spell && spell.cooldown > 0 ? cdLeft / spell.cooldown : 0,
      hover: this.hoverEntity(),
      tool: this.tool,
      dragging: this.dragging,
      paused: this.paused,
    });
    this.world.fx.length = 0;
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private sampleStats(dt: number): void {
    this.statAcc += dt;
    this.stepsAcc += this.rt.totals.steps;
    if (this.statAcc < 0.25) return;
    const s = this.world.stats;
    const dps = {} as Record<Element, number>;
    let total = 0;
    for (const e of ELEMENTS) {
      dps[e] = (s.damage[e] - this.lastDamage[e]) / this.statAcc;
      total += dps[e];
      this.lastDamage[e] = s.damage[e];
    }
    const heal = (s.healing - this.lastHeal) / this.statAcc;
    this.lastHeal = s.healing;
    const spent = this.rt.manaSpentTick / this.statAcc;
    this.rt.manaSpentTick = 0;
    const steps = (this.rt.totals.steps - this.manaAcc) / this.statAcc;
    this.manaAcc = this.rt.totals.steps;
    this.stats.push({
      t: this.world.time,
      dps,
      total,
      heal,
      mana: this.world.caster?.mana?.cur ?? 0,
      manaSpent: spent,
      entities: this.world.list.length,
      spellEntities: this.world.spellEntityCount,
      steps,
      timers: this.rt.activeTimers,
      frameMs: this.frameMs,
    });
    if (this.stats.length > 240) this.stats.splice(0, this.stats.length - 240);
    this.statAcc = 0;
    this.stepsAcc = 0;
    this.notify();
  }

  // ── input ────────────────────────────────────────────────────────────────
  private castCtx(): CastContext {
    const c = this.world.caster;
    const origin = c ? V.copy(c.pos) : { x: 0, y: 0 };
    const target = this.cursor ? V.copy(this.cursor) : V.add(origin, { x: 200, y: 0 });
    return { casterId: c?.id ?? 0, origin, target, aim: V.norm(V.sub(target, origin)) };
  }

  /** Cast a spell programmatically (used by UI buttons and tests). */
  castAt(spellId: string, target: Vec, holdSeconds = 0): { ok: boolean; reason?: string } {
    const spell = this.compiled.get(spellId);
    if (!spell) return { ok: false, reason: 'Unknown spell' };
    this.cursor = V.copy(target);
    const res = this.rt.press(spell, this.castCtx());
    if (!res.ok) this.flash(res.reason ?? 'Fizzled');
    if (holdSeconds > 0 && res.ok) {
      this.castButton = 0;
      this.castSpellId = spellId;
      this.simulate(holdSeconds);
      this.castButton = null;
      this.castSpellId = null;
    }
    this.rt.release(this.castCtx());
    return res;
  }

  flash(text: string): void {
    this.message = { text, t: performance.now() };
    this.notify();
  }

  private pointerPos(e: PointerEvent | WheelEvent): Vec {
    const r = this.canvas!.getBoundingClientRect();
    return this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private hoverEntity(): Entity | undefined {
    if (!this.cursor) return undefined;
    let best: Entity | undefined;
    let bd = 900;
    for (const e of this.world.list) {
      if (!e.alive || e.kind === 'projectile' || e.kind === 'beam' || e.kind === 'field') continue;
      const d = V.dist2(e.pos, this.cursor) - e.r * e.r;
      if (d < bd) ((bd = d), (best = e));
    }
    return best;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.canvas) return;
    this.canvas.focus();
    this.cursor = this.pointerPos(e);
    if (this.tool === 'grab' && e.button === 0) {
      const h = this.hoverEntity();
      if (h && h.invMass > 0) {
        this.dragging = h;
        this.dragOffset = V.sub(h.pos, this.cursor);
        this.dragPrev = V.copy(this.cursor);
      }
      return;
    }
    if (this.tool.startsWith('spawn:') && e.button === 0) {
      spawnAt(this.world, this.tool.slice(6), this.cursor, this.arenaConfig);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const slot = e.button === 0 ? this.activeSlot : this.altSlot;
    const id = this.hotbar[slot];
    if (!id) {
      this.flash(e.button === 0 ? 'No spell in the active slot' : 'No spell bound to right-click');
      return;
    }
    const spell = this.compiled.get(id);
    if (!spell) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const res = this.rt.press(spell, this.castCtx());
    if (!res.ok) this.flash(res.reason ?? 'Fizzled');
    else {
      this.castButton = e.button;
      this.castSpellId = id;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.dragging) {
      this.dragging = undefined;
      return;
    }
    if (this.castButton !== null && e.button === this.castButton) {
      this.rt.release(this.castCtx());
      this.castButton = null;
      this.castSpellId = null;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.canvas) return;
    this.cursor = this.pointerPos(e);
  };

  private onLeave = () => {
    if (this.castButton === null && !this.dragging) this.cursor = null;
  };

  private onContext = (e: Event) => e.preventDefault();

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    this.activeSlot = (this.activeSlot + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.notify();
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest?.('.react-flow');
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e) && !(document.activeElement === this.canvas)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
    if (k >= '1' && k <= String(HOTBAR_SIZE)) {
      this.activeSlot = Number(k) - 1;
      this.notify();
    }
    if (k === ' ' && document.activeElement === this.canvas) {
      e.preventDefault();
      this.paused = !this.paused;
      this.notify();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => {
    this.keys.clear();
    if (this.castButton !== null) {
      this.rt.release(this.castCtx());
      this.castButton = null;
    }
  };

  private moveCaster(): void {
    const c = this.world.caster;
    if (!c || c.status.frozen > 0 || c.status.stun > 0) return;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (!dx && !dy) return;
    const d = V.norm({ x: dx, y: dy });
    const speed = c.status.chilled > 0 ? 130 : 260;
    const k = Math.min(1, 14 * STEP);
    c.vel.x += (d.x * speed - c.vel.x) * k;
    c.vel.y += (d.y * speed - c.vel.y) * k;
  }

  private updateDrag(): void {
    const d = this.dragging;
    if (!d || !this.cursor) return;
    if (!d.alive) {
      this.dragging = undefined;
      return;
    }
    const target = V.add(this.cursor, this.dragOffset);
    const v = V.scale(V.sub(this.cursor, this.dragPrev), 1 / STEP);
    d.vel = V.add(V.scale(V.sub(target, d.pos), 18), V.scale(v, 0.3));
    this.dragPrev = V.copy(this.cursor);
  }
}

let singleton: Engine | null = null;
export function getEngine(): Engine {
  if (!singleton) singleton = new Engine();
  return singleton;
}
