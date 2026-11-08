import type { CNode, CompiledGraph, CompiledSpell, DataSource } from './compiler';
import { COSTS } from './costs';
import type { ExecCtx, SpellInstanceLike } from './nodes/defs';
import { V, type Coercion, type DataType, type Element, type EntityId, type Literal, type NodeProfile, type TraceEntry, type TraceKind, type Value, type Vec } from './types';
import type { Entity, EventHooks, Hook } from '../sim/entity';
import type { World } from '../sim/world';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime model
// ─────────────────────────────────────────────────────────────────────────────

export interface CastContext {
  casterId: EntityId;
  origin: Vec;
  target: Vec;
  aim: Vec;
}

export interface Instance extends SpellInstanceLike {
  spell: CompiledSpell;
  parent: number;
  steps: number;
  fizzles: number;
  effects: number;
  lastActive: number;
  dead: boolean;
  deathReason?: string;
  upfront: number;
}

interface Frame {
  inst: Instance;
  spell: CompiledSpell;
  g: CompiledGraph;
  slots: Value[];
  depth: number;
  ctx: CastContext;
}

interface Continuation extends Hook {
  frame: Frame;
  node: number;
  port: string;
}

interface Timer {
  at: number;
  seq: number;
  frame: Frame;
  node: number;
  port: string;
  binds?: Record<string, Value>;
}

interface Run {
  inst: Instance;
  steps: number;
  limit: number;
  aborted: boolean;
}

class Abort extends Error {}

export interface RuntimeSettings {
  /** max subspell-call / event-generation depth */
  maxDepth: number;
  /** node executions allowed in one synchronous run */
  runBudget: number;
  /** node executions per simulation tick across all spells; extra work is deferred */
  tickBudget: number;
  /** node executions over the lifetime of one cast */
  instanceBudget: number;
  /** seconds a cast may stay alive (timers, events) */
  instanceLifetime: number;
  maxTimers: number;
  infiniteMana: boolean;
  ignoreCooldowns: boolean;
  trace: 'off' | 'events' | 'all';
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  maxDepth: 16,
  runBudget: 4000,
  tickBudget: 20000,
  instanceBudget: 250000,
  instanceLifetime: 120,
  maxTimers: 4000,
  infiniteMana: false,
  ignoreCooldowns: false,
  trace: 'all',
};

export interface CastResult {
  ok: boolean;
  reason?: string;
  instance?: number;
}

interface ChannelSession {
  spell: CompiledSpell;
  inst: Instance;
  start: number;
  acc: number;
  count: number;
}

const TRACE_CAP = 800;

function defaultOf(t: DataType): Value {
  switch (t) {
    case 'number':
      return 0;
    case 'bool':
      return false;
    case 'vector':
      return { x: 0, y: 0 };
    case 'entity':
      return 0;
    case 'entities':
      return [];
    case 'element':
      return 'arcane';
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class SpellRuntime {
  settings: RuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  readonly instances = new Map<number, Instance>();
  private nextInst = 1;
  private timers: Timer[] = [];
  private timerSeq = 0;
  private eventQueue: { cont: Continuation; values: Record<string, Value> }[] = [];
  readonly persistent = new Map<string, Map<string, Value>>();
  readonly cooldowns = new Map<string, number>();
  private channel: ChannelSession | null = null;

  trace: TraceEntry[] = [];
  private traceSeq = 0;
  private tickExecTraces = 0;
  readonly profile = new Map<string, NodeProfile>();
  /** key -> world time of last execution (editor glow) */
  readonly heat = new Map<string, number>();
  private tickSteps = 0;
  private deferredThisTick = false;
  totals = { casts: 0, steps: 0, fizzles: 0, mana: 0, deferredTicks: 0, peakTimers: 0, recursionHits: 0, budgetHits: 0 };
  /** mana spent per second, sampled by the engine */
  manaSpentTick = 0;
  random: () => number = Math.random;

  constructor(
    public world: World,
    public resolveSpell: (id: string) => CompiledSpell | undefined = () => undefined,
  ) {}

  // ── public API ────────────────────────────────────────────────────────────

  get activeTimers(): number {
    return this.timers.length;
  }

  get queuedEvents(): number {
    return this.eventQueue.length;
  }

  get channeling(): ChannelSession | null {
    return this.channel;
  }

  cooldownLeft(spellId: string): number {
    if (this.settings.ignoreCooldowns) return 0;
    return Math.max(0, (this.cooldowns.get(spellId) ?? 0) - this.world.time);
  }

  /** Mouse down. */
  press(spell: CompiledSpell, ctx: CastContext): CastResult {
    if (this.channel) this.release(ctx);
    const doc = spell.doc;
    if (!spell.ok) {
      const first = spell.diagnostics.find((d) => d.severity === 'error');
      this.log('fizzle', 0, doc.id, spell.main.id, undefined, 0, `Can't cast “${doc.name}”: ${first?.message ?? 'compile errors'}`);
      this.world.emit({ type: 'fizzle', pos: this.world.posOf(ctx.casterId), reason: 'Spell has errors' });
      return { ok: false, reason: 'Spell has compile errors' };
    }
    const cd = this.cooldownLeft(doc.id);
    if (cd > 0) return { ok: false, reason: `Cooling down (${cd.toFixed(1)}s)` };
    const caster = this.world.get(ctx.casterId);
    if (!caster) return { ok: false, reason: 'No caster' };
    if (!this.settings.infiniteMana && (caster.mana?.cur ?? 0) < spell.upfront) {
      this.world.emit({ type: 'fizzle', pos: V.copy(caster.pos), reason: 'Not enough mana' });
      this.log('fizzle', 0, doc.id, spell.main.id, undefined, 0, `Not enough mana for “${doc.name}” (needs ${spell.upfront})`);
      return { ok: false, reason: `Not enough mana (needs ${spell.upfront})` };
    }
    const inst = this.newInstance(spell, ctx.casterId, 0);
    this.payUpfront(inst, caster, spell.upfront);
    this.totals.casts++;
    this.world.emit({ type: 'cast', pos: V.copy(caster.pos), element: doc.element, seed: spell.signature, power: Math.min(3, 0.6 + spell.complexity / 25) });
    this.log('cast', inst.id, doc.id, spell.main.id, undefined, 0, `Cast “${doc.name}” (upfront ${spell.upfront} mana, complexity ${spell.complexity})`);
    for (const t of spell.main.triggers.cast) this.runTrigger(inst, spell, spell.main, t, ctx, {});
    if (spell.hasChannel || spell.hasRelease) {
      this.channel = { spell, inst, start: this.world.time, acc: spell.channelInterval, count: 0 };
      if (spell.hasChannel) this.updateChannel(0, ctx);
    } else this.startCooldown(spell);
    return { ok: true, instance: inst.id };
  }

  /** Called every tick while the button is held. */
  updateChannel(dt: number, ctx: CastContext): void {
    const ch = this.channel;
    if (!ch || !ch.spell.hasChannel) return;
    ch.acc += dt;
    const iv = ch.spell.channelInterval;
    let guard = 0;
    while (ch.acc >= iv && guard++ < 8) {
      ch.acc -= iv;
      for (const t of ch.spell.main.triggers.channel)
        this.runTrigger(ch.inst, ch.spell, ch.spell.main, t, ctx, { elapsed: this.world.time - ch.start, count: ch.count });
      ch.count++;
    }
  }

  /** Mouse up. */
  release(ctx: CastContext): void {
    const ch = this.channel;
    if (!ch) return;
    this.channel = null;
    const held = this.world.time - ch.start;
    for (const t of ch.spell.main.triggers.release) this.runTrigger(ch.inst, ch.spell, ch.spell.main, t, ctx, { held });
    this.startCooldown(ch.spell);
  }

  /** One simulation tick: due timers, then events raised by the world. */
  tick(): void {
    this.tickSteps = 0;
    this.tickExecTraces = 0;
    this.deferredThisTick = false;
    const now = this.world.time;
    // timers
    while (this.timers.length && this.timers[0].at <= now) {
      if (this.tickSteps >= this.settings.tickBudget) {
        this.noteDefer();
        break;
      }
      const t = this.timers.shift()!;
      if (t.frame.inst.dead) continue;
      const frame: Frame = { ...t.frame, slots: t.frame.slots.slice() };
      const n = frame.g.nodes[t.node];
      if (t.binds) for (const [port, v] of Object.entries(t.binds)) if (n.slots[port] !== undefined) frame.slots[n.slots[port]] = v;
      this.runRoot(frame, n.execOut[t.port] ?? []);
    }
    // events
    if (this.world.fired.length) {
      for (const f of this.world.fired) this.eventQueue.push({ cont: f.hook as Continuation, values: f.values });
      this.world.fired.length = 0;
    }
    let processed = 0;
    while (processed < this.eventQueue.length) {
      if (this.tickSteps >= this.settings.tickBudget) {
        this.noteDefer();
        break;
      }
      const { cont, values } = this.eventQueue[processed++];
      this.dispatchEvent(cont, values);
    }
    if (processed) this.eventQueue.splice(0, processed);
    if (this.eventQueue.length > 20000) {
      // pathological flood: drop the oldest work so the arena stays responsive
      const dropped = this.eventQueue.length - 20000;
      this.eventQueue.splice(0, dropped);
      this.log('error', 0, '', '', undefined, 0, `Event flood: dropped ${dropped} queued events`);
    }
    // instance housekeeping
    for (const inst of this.instances.values()) {
      if (!inst.dead && now - inst.start > this.settings.instanceLifetime) this.killInstance(inst, `lifetime limit (${this.settings.instanceLifetime}s) reached`);
    }
    if (this.instances.size > 300) {
      const old = [...this.instances.values()].filter((i) => i.dead || now - i.lastActive > 30).slice(0, this.instances.size - 300);
      for (const i of old) this.instances.delete(i.id);
    }
    this.totals.steps += this.tickSteps;
  }

  reset(): void {
    this.instances.clear();
    this.timers = [];
    this.eventQueue = [];
    this.channel = null;
    this.cooldowns.clear();
    this.world.fired.length = 0;
  }

  clearDiagnostics(): void {
    this.trace = [];
    this.profile.clear();
    this.heat.clear();
    this.totals = { casts: 0, steps: 0, fizzles: 0, mana: 0, deferredTicks: 0, peakTimers: 0, recursionHits: 0, budgetHits: 0 };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private startCooldown(spell: CompiledSpell): void {
    this.cooldowns.set(spell.doc.id, this.world.time + spell.cooldown);
  }

  private newInstance(spell: CompiledSpell, casterId: EntityId, parent: number): Instance {
    const inst: Instance = {
      id: this.nextInst++,
      spellId: spell.doc.id,
      spell,
      casterId,
      start: this.world.time,
      manaSpent: 0,
      vars: new Map(),
      once: new Set(),
      parent,
      steps: 0,
      fizzles: 0,
      effects: 0,
      lastActive: this.world.time,
      dead: false,
      upfront: 0,
    };
    for (const v of spell.doc.variables) if (v.scope === 'cast') inst.vars.set(v.name, v.initial as Value);
    this.instances.set(inst.id, inst);
    return inst;
  }

  private payUpfront(inst: Instance, caster: Entity, amount: number): void {
    inst.manaSpent += amount;
    inst.upfront += amount;
    this.totals.mana += amount;
    this.manaSpentTick += amount;
    if (!this.settings.infiniteMana && caster.mana) caster.mana.cur = Math.max(0, caster.mana.cur - amount);
  }

  private killInstance(inst: Instance, reason: string): void {
    inst.dead = true;
    inst.deathReason = reason;
    this.log('fizzle', inst.id, inst.spellId, inst.spell.main.id, undefined, 0, `Cast ended: ${reason}`);
  }

  private noteDefer(): void {
    if (this.deferredThisTick) return;
    this.deferredThisTick = true;
    this.totals.deferredTicks++;
    this.log('defer', 0, '', '', undefined, 0, `Tick budget (${this.settings.tickBudget} steps) used — remaining work deferred to the next tick`);
  }

  private runTrigger(inst: Instance, spell: CompiledSpell, g: CompiledGraph, nodeIdx: number, ctx: CastContext, extra: Record<string, Value>): void {
    const frame: Frame = { inst, spell, g, slots: new Array(g.slotCount).fill(null), depth: 0, ctx };
    const n = g.nodes[nodeIdx];
    const vals: Record<string, Value> = { caster: ctx.casterId, origin: V.copy(ctx.origin), target: V.copy(ctx.target), aim: V.copy(ctx.aim), ...extra };
    for (const [port, slot] of Object.entries(n.slots)) if (port in vals) frame.slots[slot] = vals[port];
    this.touch(spell, g, n);
    const execPort = n.outputs.find((p) => p.type === 'exec')!;
    this.runRoot(frame, n.execOut[execPort.id] ?? []);
  }

  private dispatchEvent(cont: Continuation, values: Record<string, Value>): void {
    const base = cont.frame;
    if (base.inst.dead) return;
    const frame: Frame = { ...base, slots: base.slots.slice(), depth: base.depth + 1 };
    const n = frame.g.nodes[cont.node];
    for (const b of n.eventBinds[cont.port] ?? []) if (b.key in values) frame.slots[b.slot] = values[b.key];
    for (const s of n.selfSlots) if (s.key in values) frame.slots[s.slot] = values[s.key];
    this.log('event', frame.inst.id, frame.inst.spellId, frame.g.id, n.id, frame.depth, `${n.title} ▸ ${n.outputs.find((p) => p.id === cont.port)?.label ?? cont.port}`);
    if (frame.depth > this.settings.maxDepth) {
      this.totals.recursionHits++;
      this.fizzleAt(frame, n, `Recursion limit (${this.settings.maxDepth}) reached — event chain stopped`);
      return;
    }
    this.runRoot(frame, n.execOut[cont.port] ?? []);
  }

  private runRoot(frame: Frame, targets: number[]): void {
    if (!targets.length) return;
    const inst = frame.inst;
    if (inst.dead) return;
    inst.lastActive = this.world.time;
    const run: Run = { inst, steps: 0, limit: this.settings.runBudget, aborted: false };
    try {
      for (const t of targets) this.execNode(frame, t, run);
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
    }
  }

  private touch(spell: CompiledSpell, g: CompiledGraph, n: CNode): string {
    const key = `${spell.doc.id}|${g.id}|${n.id}`;
    this.heat.set(key, this.world.time);
    return key;
  }

  private childTime = 0;

  execNode(frame: Frame, idx: number, run: Run): void {
    if (run.aborted) throw new Abort();
    const n = frame.g.nodes[idx];
    const inst = frame.inst;
    run.steps++;
    inst.steps++;
    this.tickSteps++;
    if (run.steps > run.limit) this.budgetExceeded(frame, n, run);
    if (inst.steps > this.settings.instanceBudget) {
      run.aborted = true;
      this.killInstance(inst, `lifetime step budget (${this.settings.instanceBudget}) exhausted`);
      throw new Abort();
    }
    const key = this.touch(frame.spell, frame.g, n);
    if (this.settings.trace === 'all' && this.tickExecTraces < 150) {
      this.tickExecTraces++;
      this.log('exec', inst.id, inst.spellId, frame.g.id, n.id, frame.depth, n.title);
    }
    let prof = this.profile.get(key);
    if (!prof) this.profile.set(key, (prof = { graphId: frame.g.id, nodeId: n.id, execs: 0, timeMs: 0, mana: 0, lastT: 0 }));
    prof.execs++;
    prof.lastT = this.world.time;
    const ctx = new Ctx(this, frame, n, run, prof);
    if (!ctx.charge(COSTS.step, '')) {
      run.aborted = true;
      const caster = this.world.get(inst.casterId);
      if (caster) this.world.emit({ type: 'fizzle', pos: V.copy(caster.pos), reason: 'Out of mana' });
      this.fizzleAt(frame, n, `Out of mana — the spell sputters out at ${n.title}`);
      throw new Abort();
    }
    const t0 = performance.now();
    const outerChild = this.childTime;
    this.childTime = 0;
    try {
      n.def.exec?.(ctx);
    } catch (e) {
      if (e instanceof Abort) {
        this.closeTiming(prof, t0, outerChild);
        throw e;
      }
      this.fizzleAt(frame, n, `${n.title} failed: ${(e as Error).message}`, 'error');
    }
    this.closeTiming(prof, t0, outerChild);
  }

  budgetExceeded(frame: Frame, n: CNode, run: Run): never {
    run.aborted = true;
    this.totals.budgetHits++;
    this.fizzleAt(frame, n, `Execution budget exceeded (${run.limit} steps in one burst) at ${n.title}. Loops this big need a Delay or Every between passes.`, 'error');
    throw new Abort();
  }

  private closeTiming(prof: NodeProfile, t0: number, outerChild: number): void {
    const total = performance.now() - t0;
    prof.timeMs += Math.max(0, total - this.childTime);
    this.childTime = outerChild + total;
  }

  fizzleAt(frame: Frame, n: CNode | undefined, reason: string, kind: TraceKind = 'fizzle'): void {
    frame.inst.fizzles++;
    this.totals.fizzles++;
    this.log(kind, frame.inst.id, frame.inst.spellId, frame.g.id, n?.id, frame.depth, reason);
    const caster = this.world.get(frame.ctx.casterId);
    if (caster && kind === 'error') this.world.emit({ type: 'fizzle', pos: V.copy(caster.pos), reason });
  }

  log(kind: TraceKind, instance: number, spellId: string, graphId: string, nodeId: string | undefined, depth: number, message: string): void {
    if (this.settings.trace === 'off' && kind !== 'error') return;
    this.trace.push({ seq: this.traceSeq++, t: this.world.time, kind, instance, spellId, graphId, nodeId, depth, message });
    if (this.trace.length > TRACE_CAP) this.trace.splice(0, this.trace.length - TRACE_CAP);
  }

  // ── services for Ctx ──────────────────────────────────────────────────────

  evalSource(frame: Frame, src: DataSource, memo: Map<number, Record<string, Value>>, run: Run): Value {
    let v: Value;
    switch (src.kind) {
      case 'slot':
        v = frame.slots[src.slot];
        if (v === null || v === undefined) return defaultOf(src.type);
        return coerce(this.world, v, src.coerce);
      case 'pure': {
        const outs = this.evalPure(frame, src.node, memo, run);
        v = outs[src.port];
        if (v === null || v === undefined) return defaultOf(src.type);
        return coerce(this.world, v, src.coerce);
      }
      case 'literal':
        return typeof src.value === 'object' ? { ...(src.value as Vec) } : (src.value as Value);
      case 'auto':
        return this.autoValue(frame, src.auto, src.type);
      case 'none':
        return defaultOf(src.type);
    }
  }

  private autoValue(frame: Frame, auto: string, type: DataType): Value {
    const ctx = frame.ctx;
    let v: Value;
    switch (auto) {
      case 'caster':
        v = ctx.casterId;
        if (type === 'entities') return ctx.casterId ? [ctx.casterId] : [];
        if (type === 'vector') return this.world.posOf(ctx.casterId);
        return v;
      case 'casterPos':
        return this.world.posOf(ctx.casterId);
      case 'aim':
        return V.copy(ctx.aim);
      case 'target':
        return V.copy(ctx.target);
      case 'origin':
        return V.copy(ctx.origin);
      default:
        return defaultOf(type);
    }
  }

  evalPure(frame: Frame, idx: number, memo: Map<number, Record<string, Value>>, run: Run): Record<string, Value> {
    const cached = memo.get(idx);
    if (cached) return cached;
    const n = frame.g.nodes[idx];
    const outs: Record<string, Value> = {};
    memo.set(idx, outs); // guards (already-reported) cycles
    run.steps += 0.25;
    const ctx = new Ctx(this, frame, n, run, null, memo, outs);
    try {
      n.def.eval?.(ctx);
    } catch (e) {
      this.fizzleAt(frame, n, `${n.title} failed: ${(e as Error).message}`, 'error');
    }
    return outs;
  }

  charge(frame: Frame, amount: number, prof: NodeProfile | null, what: string, run?: Run): boolean {
    if (amount <= 0) return true;
    const inst = frame.inst;
    if (!this.settings.infiniteMana) {
      const caster = this.world.get(inst.casterId);
      const pool = caster?.mana;
      if (!pool || pool.cur < amount) {
        if (what) {
          this.world.emit({ type: 'fizzle', pos: caster ? V.copy(caster.pos) : this.world.posOf(inst.casterId), reason: 'Out of mana' });
          this.fizzleAt(frame, prof ? frame.g.nodes[frame.g.byId.get(prof.nodeId)!] : undefined, `Out of mana: ${what} needed ${amount.toFixed(1)} — the flow stops here`);
          if (run) {
            run.aborted = true;
            throw new Abort();
          }
        }
        return false;
      }
      pool.cur -= amount;
    }
    inst.manaSpent += amount;
    this.totals.mana += amount;
    this.manaSpentTick += amount;
    if (prof) prof.mana += amount;
    if (what) inst.effects++;
    return true;
  }

  getVar(frame: Frame, name: string): Value {
    const decl = frame.spell.doc.variables.find((v) => v.name === name);
    if (!decl) return null;
    if (decl.scope === 'persistent') {
      let m = this.persistent.get(frame.spell.doc.id);
      if (!m) this.persistent.set(frame.spell.doc.id, (m = new Map()));
      if (!m.has(name)) m.set(name, decl.initial as Value);
      return m.get(name)!;
    }
    if (!frame.inst.vars.has(name)) frame.inst.vars.set(name, decl.initial as Value);
    return frame.inst.vars.get(name)!;
  }

  setVar(frame: Frame, name: string, v: Value): void {
    const decl = frame.spell.doc.variables.find((x) => x.name === name);
    if (!decl) return;
    const val = Array.isArray(v) ? v.slice() : V.isVec(v) ? V.copy(v) : v;
    if (decl.scope === 'persistent') {
      let m = this.persistent.get(frame.spell.doc.id);
      if (!m) this.persistent.set(frame.spell.doc.id, (m = new Map()));
      m.set(name, val);
    } else frame.inst.vars.set(name, val);
  }

  makeHook(frame: Frame, node: number, port: string): Continuation {
    return { __hook: true, frame: { ...frame, slots: frame.slots.slice() }, node, port };
  }

  schedule(frame: Frame, node: number, port: string, seconds: number, binds?: Record<string, Value>): boolean {
    if (this.timers.length >= this.settings.maxTimers) {
      this.fizzleAt(frame, frame.g.nodes[node], `Timer limit (${this.settings.maxTimers}) reached — delayed flow dropped`);
      return false;
    }
    const t: Timer = { at: this.world.time + Math.max(0, seconds), seq: this.timerSeq++, frame: { ...frame, slots: frame.slots.slice() }, node, port, binds };
    // sorted insert (by time, then sequence)
    let lo = 0;
    let hi = this.timers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.timers[mid];
      if (m.at < t.at || (m.at === t.at && m.seq < t.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.timers.splice(lo, 0, t);
    this.totals.peakTimers = Math.max(this.totals.peakTimers, this.timers.length);
    return true;
  }

  callSubspell(frame: Frame, caller: CNode, graphId: string, args: Record<string, Value>, run: Run): void {
    const g = frame.spell.subs.get(graphId);
    if (!g) {
      this.fizzleAt(frame, caller, 'Subspell not found');
      return;
    }
    if (frame.depth + 1 > this.settings.maxDepth) {
      this.totals.recursionHits++;
      this.fizzleAt(frame, caller, `Recursion limit (${this.settings.maxDepth}) reached calling “${g.name}”`);
      return;
    }
    const sub: Frame = { inst: frame.inst, spell: frame.spell, g, slots: new Array(g.slotCount).fill(null), depth: frame.depth + 1, ctx: frame.ctx };
    for (const ei of g.triggers.entry) {
      const entry = g.nodes[ei];
      for (const p of g.params) {
        const slot = entry.slots[`p_${p.id}`];
        if (slot !== undefined) sub.slots[slot] = args[p.id] ?? defaultOf(p.type);
      }
      if (entry.slots.caster !== undefined) sub.slots[entry.slots.caster] = frame.ctx.casterId;
      if (entry.slots.depth !== undefined) sub.slots[entry.slots.depth] = sub.depth;
      this.touch(frame.spell, g, entry);
      for (const t of entry.execOut.start ?? []) this.execNode(sub, t, run);
    }
  }

  castSpell(frame: Frame, caller: CNode, spellId: string, origin: Vec, target: Vec, run: Run): void {
    const spell = this.resolveSpell(spellId);
    if (!spell) {
      this.fizzleAt(frame, caller, 'Cast Spell: spell not found in library');
      return;
    }
    if (!spell.ok) {
      this.fizzleAt(frame, caller, `Cast Spell: “${spell.doc.name}” has compile errors`);
      return;
    }
    if (frame.depth + 1 > this.settings.maxDepth) {
      this.totals.recursionHits++;
      this.fizzleAt(frame, caller, `Recursion limit (${this.settings.maxDepth}) reached casting “${spell.doc.name}”`);
      return;
    }
    if (!this.charge(frame, spell.upfront, null, `cast ${spell.doc.name}`, run)) return;
    const inst = this.newInstance(spell, frame.ctx.casterId, frame.inst.id);
    inst.upfront = spell.upfront;
    const ctx: CastContext = { casterId: frame.ctx.casterId, origin: V.copy(origin), target: V.copy(target), aim: V.norm(V.sub(target, origin)) };
    this.world.emit({ type: 'cast', pos: V.copy(origin), element: spell.doc.element, seed: spell.signature, power: 0.7 });
    this.log('cast', inst.id, spell.doc.id, spell.main.id, undefined, frame.depth + 1, `↳ “${frame.spell.doc.name}” casts “${spell.doc.name}”`);
    const triggers = spell.main.triggers.cast.length ? spell.main.triggers.cast : spell.main.triggers.channel.length ? spell.main.triggers.channel : spell.main.triggers.release;
    for (const ti of triggers) {
      const g = spell.main;
      const sub: Frame = { inst, spell, g, slots: new Array(g.slotCount).fill(null), depth: frame.depth + 1, ctx };
      const n = g.nodes[ti];
      const vals: Record<string, Value> = { caster: ctx.casterId, origin: V.copy(origin), target: V.copy(target), aim: V.copy(ctx.aim), elapsed: 0, count: 0, held: 0 };
      for (const [port, slot] of Object.entries(n.slots)) if (port in vals) sub.slots[slot] = vals[port];
      this.touch(spell, g, n);
      const execPort = n.outputs.find((p) => p.type === 'exec')!;
      for (const t of n.execOut[execPort.id] ?? []) this.execNode(sub, t, run);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function coerce(world: World, v: Value, c: Coercion): Value {
  switch (c) {
    case 'none':
      return v;
    case 'entityToVector':
      return world.posOf(v as EntityId);
    case 'entityToEntities':
      return v ? [v as EntityId] : [];
    case 'entitiesToEntity':
      return (v as EntityId[])[0] ?? 0;
    case 'entitiesToVector': {
      const l = (v as EntityId[]).map((id) => world.get(id)).filter((e) => !!e) as Entity[];
      if (!l.length) return { x: 0, y: 0 };
      return { x: l.reduce((a, e) => a + e.pos.x, 0) / l.length, y: l.reduce((a, e) => a + e.pos.y, 0) / l.length };
    }
    case 'numberToBool':
      return (v as number) !== 0;
    case 'boolToNumber':
      return v ? 1 : 0;
  }
}

/** The context object handed to node implementations. */
class Ctx implements ExecCtx {
  readonly world: World;
  readonly inst: Instance;
  readonly depth: number;
  readonly casterId: EntityId;
  readonly nodeId: string;
  private memo: Map<number, Record<string, Value>>;

  constructor(
    private rt: SpellRuntime,
    private frame: Frame,
    private n: CNode,
    private run: Run,
    private prof: NodeProfile | null,
    memo?: Map<number, Record<string, Value>>,
    private outs?: Record<string, Value>,
  ) {
    this.world = rt.world;
    this.inst = frame.inst;
    this.depth = frame.depth;
    this.casterId = frame.ctx.casterId;
    this.nodeId = n.id;
    this.memo = memo ?? new Map();
  }

  get time(): number {
    return this.world.time;
  }

  in(port: string): Value {
    const src = this.n.sources[port];
    if (!src) return null;
    return this.rt.evalSource(this.frame, src, this.memo, this.run);
  }
  num(port: string): number {
    const v = this.in(port);
    return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
  }
  bool(port: string): boolean {
    const v = this.in(port);
    return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : !!v;
  }
  vec(port: string): Vec {
    const v = this.in(port);
    return V.isVec(v) ? v : typeof v === 'number' && v > 0 ? this.world.posOf(v) : { x: 0, y: 0 };
  }
  ent(port: string): EntityId {
    const v = this.in(port);
    return typeof v === 'number' ? v : Array.isArray(v) ? (v[0] ?? 0) : 0;
  }
  ents(port: string): EntityId[] {
    const v = this.in(port);
    return Array.isArray(v) ? v : typeof v === 'number' && v > 0 ? [v] : [];
  }
  elem(port: string): Element {
    const v = this.in(port);
    return (typeof v === 'string' ? v : 'arcane') as Element;
  }
  param<T extends Literal = Literal>(id: string): T {
    return this.n.params[id] as T;
  }
  out(port: string, v: Value): void {
    if (this.outs) this.outs[port] = v;
  }
  getVar(name: string): Value {
    return this.rt.getVar(this.frame, name);
  }
  random(): number {
    return this.rt.random();
  }

  // exec-only
  set(port: string, v: Value): void {
    const s = this.n.slots[port];
    if (s !== undefined) this.frame.slots[s] = v;
    // fresh values invalidate memoised pure results that may depend on them
    this.memo = new Map();
  }
  fire(port: string): void {
    const targets = this.n.execOut[port];
    if (!targets) return;
    for (const t of targets) this.rt.execNode(this.frame, t, this.run);
    this.memo = new Map();
  }
  connected(port: string): boolean {
    return (this.n.execOut[port]?.length ?? 0) > 0;
  }
  hook(port: string): Hook | undefined {
    if (!this.connected(port)) return undefined;
    return this.rt.makeHook(this.frame, this.n.idx, port);
  }
  attach(e: Entity, map: Partial<Record<keyof EventHooks, string>>): void {
    for (const [k, port] of Object.entries(map) as [keyof EventHooks, string][]) {
      const h = this.hook(port);
      if (h) e.hooks[k] = h;
    }
  }
  later(port: string, seconds: number, binds?: Record<string, Value>): boolean {
    if (!this.connected(port)) return true;
    return this.rt.schedule(this.frame, this.n.idx, port, seconds, binds);
  }
  charge(amount: number, what = ''): boolean {
    return this.rt.charge(this.frame, amount, this.prof, what, this.run);
  }
  fizzle(reason: string): void {
    this.rt.fizzleAt(this.frame, this.n, reason);
  }
  log(msg: string): void {
    this.rt.log('log', this.inst.id, this.inst.spellId, this.frame.g.id, this.n.id, this.depth, msg);
  }
  setVar(name: string, v: Value): void {
    this.rt.setVar(this.frame, name, v);
    this.memo = new Map();
  }
  callSubspell(graphId: string, args: Record<string, Value>): void {
    const g = this.frame.spell.subs.get(graphId);
    const a: Record<string, Value> = { ...args };
    if (g) for (const p of g.params) if (!(p.id in a)) a[p.id] = this.in(`p_${p.id}`);
    this.rt.callSubspell(this.frame, this.n, graphId, a, this.run);
  }
  castSpell(spellId: string, origin: Vec, target: Vec): void {
    this.rt.castSpell(this.frame, this.n, spellId, origin, target, this.run);
  }
  budgetOk(): boolean {
    if (this.run.aborted) throw new Abort();
    if (this.run.steps >= this.run.limit) this.rt.budgetExceeded(this.frame, this.n, this.run);
    return true;
  }
}
