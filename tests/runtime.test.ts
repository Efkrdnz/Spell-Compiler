import { describe, expect, it } from 'vitest';
import { SpellBuilder } from '../src/data/builder';
import { errors, makeLab } from './helpers';

describe('runtime: recursion safety', () => {
  it('stops an unguarded self-calling subspell at the depth limit without hanging', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const s = new SpellBuilder('rec', 'Rec', 'arcane');
    const cast = s.node('onCast');
    const call = s.node('callSubspell', { sub: 'r' });
    s.flow(cast, 'then', call);
    const g = s.subspell('r', 'Again', []);
    const e = g.node('entry');
    const log = g.node('log', { msg: 'deeper' });
    const again = g.node('callSubspell', { sub: 'r' });
    g.flow(e, 'start', log);
    g.flow(log, 'then', again);
    const c = lab.compile(s.build());
    expect(errors(c)).toEqual([]);
    lab.cast(c, { x: 600, y: 450 });
    const logs = lab.rt.trace.filter((t) => t.kind === 'log');
    expect(logs.length).toBe(lab.rt.settings.maxDepth);
    expect(lab.rt.trace.some((t) => t.message.includes('Recursion limit'))).toBe(true);
    expect(lab.rt.totals.recursionHits).toBe(1);
  });

  it('runs a depth-guarded fractal subspell exactly (1 + 3 + 9 calls)', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const s = new SpellBuilder('frac', 'Fractal', 'arcane');
    const cast = s.node('onCast');
    const call = s.node('callSubspell', { sub: 'f' });
    s.flow(cast, 'then', call);
    const g = s.subspell('f', 'Branch', [{ id: 'size', name: 'Size', type: 'number' }]);
    const e = g.node('entry');
    const log = g.node('log', { msg: 'node' });
    const depth = g.node('depth');
    const cmp = g.node('compare', { op: '<', b: 3 });
    const br = g.node('branch');
    const rep = g.node('repeat', { count: 3 });
    const again = g.node('callSubspell', { sub: 'f' });
    g.flow(e, 'start', log);
    g.flow(log, 'then', br);
    g.data(depth, 'depth', cmp, 'a');
    g.data(cmp, 'r', br, 'cond');
    g.flow(br, 'true', rep);
    g.flow(rep, 'body', again);
    const c = lab.compile(s.build());
    expect(errors(c)).toEqual([]);
    lab.cast(c, { x: 600, y: 450 });
    expect(lab.rt.trace.filter((t) => t.kind === 'log').length).toBe(1 + 3 + 9);
    expect(lab.rt.totals.recursionHits).toBe(0);
  });

  it('bounds recursive event chains (projectile spawning projectiles on every hit)', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    lab.world.spawn('wall', { x: 400, y: 450 }, { hw: 10, hh: 300, hp: 1e9 });
    lab.world.spawn('wall', { x: 100, y: 450 }, { hw: 10, hh: 300, hp: 1e9, invMass: 0 });
    const s = new SpellBuilder('ping', 'Ping', 'force');
    const cast = s.node('onCast');
    const p = s.node('projectile', { speed: 900, life: 2 });
    const refl = s.node('reflect');
    s.flow(cast, 'then', p);
    s.flow(p, 'onHit', p); // re-enter the same node from its own event
    s.data(p, 'normal', refl, 'n');
    void refl;
    const c = lab.compile(s.build());
    expect(errors(c)).toEqual([]);
    lab.cast(c, { x: 600, y: 450 });
    lab.step(8);
    expect(lab.rt.totals.recursionHits).toBeGreaterThan(0);
    // the chain died out: nothing left flying
    expect(lab.world.list.filter((e) => e.kind === 'projectile').length).toBe(0);
  });
});

describe('runtime: execution budgets', () => {
  it('aborts a runaway synchronous loop with a clear error and keeps the arena alive', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const s = new SpellBuilder('loop', 'Loop', 'arcane');
    const cast = s.node('onCast');
    const r1 = s.node('repeat', { count: 256 });
    const r2 = s.node('repeat', { count: 256 });
    const l = s.node('log', { msg: 'x' });
    s.flow(cast, 'then', r1);
    s.flow(r1, 'body', r2);
    s.flow(r2, 'body', l);
    const c = lab.compile(s.build());
    const t0 = performance.now();
    lab.cast(c, { x: 600, y: 450 });
    expect(performance.now() - t0).toBeLessThan(1000);
    const err = lab.rt.trace.find((t) => t.kind === 'error');
    expect(err?.message).toMatch(/Execution budget exceeded/);
    expect(lab.rt.totals.budgetHits).toBe(1);
    // the next cast still works
    const s2 = new SpellBuilder('ok', 'Ok', 'arcane');
    s2.flow(s2.node('onCast'), 'then', s2.node('projectile'));
    expect(lab.cast(lab.compile(s2.build()), { x: 600, y: 450 }).ok).toBe(true);
  });

  it('caps While loops at their max passes', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const s = new SpellBuilder('w', 'W', 'arcane');
    const cast = s.node('onCast');
    const w = s.node('while', { max: 20 });
    const l = s.node('log', { msg: 'tick' });
    s.flow(cast, 'then', w);
    s.flow(w, 'body', l);
    lab.cast(lab.compile(s.build()), { x: 600, y: 450 });
    expect(lab.rt.trace.filter((t) => t.kind === 'log').length).toBe(20);
  });

  it('starves an infinite Delay loop through mana instead of running forever', () => {
    const lab = makeLab();
    const caster = lab.world.get(lab.casterId)!;
    caster.mana = { cur: 60, max: 60, regen: 0 };
    const s = new SpellBuilder('forever', 'Forever', 'force');
    const cast = s.node('onCast');
    const boom = s.node('explosion', { radius: 40, damage: 1, force: 0 });
    const wait = s.node('delay', { seconds: 0.1 });
    s.flow(cast, 'then', boom);
    s.flow(boom, 'then', wait);
    s.flow(wait, 'then', boom);
    const c = lab.compile(s.build());
    expect(c.ok).toBe(true);
    lab.cast(c, { x: 600, y: 450 });
    lab.step(5);
    const booms = lab.world.fx.filter((f) => f.type === 'explosion').length;
    expect(booms).toBeGreaterThan(5);
    expect(booms).toBeLessThan(20);
    expect(caster.mana.cur).toBeLessThan(4.5);
    expect(lab.rt.trace.some((t) => /Out of mana/.test(t.message))).toBe(true);
    expect(lab.rt.activeTimers).toBe(0);
  });

  it('defers (rather than drops) work beyond the per-tick budget', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    lab.rt.settings.tickBudget = 300;
    lab.rt.settings.trace = 'events'; // keep the trace ring from overflowing with exec entries
    const s = new SpellBuilder('swarm', 'Swarm', 'arcane');
    const cast = s.node('onCast');
    const rep = s.node('repeat', { count: 60 });
    const wait = s.node('delay', { seconds: 0.1 });
    const l = s.node('log', { msg: 'pop' });
    const rep2 = s.node('repeat', { count: 10 });
    const l2 = s.node('log', { msg: 'inner' });
    s.flow(cast, 'then', rep);
    s.flow(rep, 'body', wait);
    s.flow(wait, 'then', l);
    s.flow(l, 'then', rep2);
    s.flow(rep2, 'body', l2);
    lab.cast(lab.compile(s.build()), { x: 600, y: 450 });
    lab.step(0.12); // timers come due at 0.1s; one tick can only run ~25 of them
    const early = lab.rt.trace.filter((t) => t.message === 'pop').length;
    expect(early).toBeLessThan(60);
    expect(lab.rt.totals.deferredTicks).toBeGreaterThan(0);
    lab.step(1);
    expect(lab.rt.trace.filter((t) => t.message === 'pop').length).toBe(60);
    expect(lab.rt.trace.filter((t) => t.message === 'inner').length).toBe(600);
  });
});

describe('runtime: variables, channels, composition', () => {
  it('persistent variables remember across casts while cast variables reset', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    lab.rt.settings.ignoreCooldowns = true;
    const s = new SpellBuilder('ctr', 'Counter', 'arcane');
    s.variable('total', 'number', 0, 'persistent');
    s.variable('local', 'number', 0, 'cast');
    const cast = s.node('onCast');
    const a = s.node('addVar', { name: 'total', amount: 1 });
    const b = s.node('addVar', { name: 'local', amount: 1 });
    const g = s.node('getVar', { name: 'total' });
    const g2 = s.node('getVar', { name: 'local' });
    const l1 = s.node('log', { msg: 'total' });
    const l2 = s.node('log', { msg: 'local' });
    s.flow(cast, 'then', a);
    s.flow(a, 'then', b);
    s.flow(b, 'then', l1);
    s.flow(l1, 'then', l2);
    s.data(g, 'value', l1, 'value');
    s.data(g2, 'value', l2, 'value');
    const c = lab.compile(s.build());
    expect(errors(c)).toEqual([]);
    for (let i = 0; i < 3; i++) lab.cast(c, { x: 600, y: 450 });
    const logs = lab.rt.trace.filter((t) => t.kind === 'log').map((t) => t.message);
    expect(logs).toEqual(['total: 1', 'local: 1', 'total: 2', 'local: 1', 'total: 3', 'local: 1']);
  });

  it('fires While Channeling repeatedly and On Release with the hold time', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const s = new SpellBuilder('ch', 'Channel', 'arcane');
    const ch = s.node('onChannel', { interval: 0.1 });
    const rel = s.node('onRelease');
    const l = s.node('log', { msg: 'tick' });
    const l2 = s.node('log', { msg: 'held' });
    s.flow(ch, 'tick', l);
    s.flow(rel, 'then', l2);
    s.data(rel, 'held', l2, 'value');
    const c = lab.compile(s.build());
    const caster = lab.world.get(lab.casterId)!;
    const ctx = { casterId: caster.id, origin: caster.pos, target: { x: 800, y: 450 }, aim: { x: 1, y: 0 } };
    expect(lab.rt.press(c, ctx).ok).toBe(true);
    for (let i = 0; i < 60; i++) {
      lab.rt.updateChannel(1 / 60, ctx);
      lab.step(1 / 60);
    }
    lab.rt.release(ctx);
    const ticks = lab.rt.trace.filter((t) => t.message === 'tick').length;
    expect(ticks).toBeGreaterThanOrEqual(10);
    expect(ticks).toBeLessThanOrEqual(12);
    const held = lab.rt.trace.find((t) => t.message.startsWith('held'))!;
    expect(Number(held.message.split(': ')[1])).toBeCloseTo(1, 1);
  });

  it('lets one library spell cast another (spells triggering spells)', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const inner = new SpellBuilder('inner', 'Inner', 'fire');
    const ic = inner.node('onCast');
    const boom = inner.node('explosion', { radius: 50 });
    inner.flow(ic, 'then', boom);
    lab.compile(inner.build());
    const outer = new SpellBuilder('outer', 'Outer', 'arcane');
    const oc = outer.node('onCast');
    const rep = outer.node('radial', { count: 4 });
    const off = outer.node('offset', { d: 150 });
    const cs = outer.node('castSpell', { spell: 'inner' });
    outer.flow(oc, 'then', rep);
    outer.flow(rep, 'body', cs);
    outer.data(rep, 'direction', off, 'dir');
    outer.data(off, 'r', cs, 'target');
    const c = lab.compile(outer.build());
    expect(errors(c)).toEqual([]);
    lab.cast(c, { x: 600, y: 450 });
    expect(lab.world.fx.filter((f) => f.type === 'explosion').length).toBe(4);
    expect([...lab.rt.instances.values()].filter((i) => i.spellId === 'inner').length).toBe(4);
  });

  it('duplicated projectiles keep their event hooks and report themselves as the source', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    lab.world.spawn('wall', { x: 700, y: 450 }, { hw: 20, hh: 400, hp: 1e9 });
    const s = new SpellBuilder('dup', 'Dup', 'ice');
    const cast = s.node('onCast');
    const p = s.node('projectile', { element: 'ice', speed: 800 });
    const dup = s.node('duplicate', { count: 4, spread: 50 });
    const boom = s.node('explosion', { radius: 30, element: 'ice' });
    s.flow(cast, 'then', p);
    s.flow(p, 'then', dup);
    s.data(p, 'projectile', dup, 'e');
    s.flow(p, 'onExpire', boom);
    s.data(p, 'point', boom, 'center');
    const c = lab.compile(s.build());
    expect(errors(c)).toEqual([]);
    lab.cast(c, { x: 900, y: 450 });
    expect(lab.world.list.filter((e) => e.kind === 'projectile').length).toBe(5);
    lab.step(1.5);
    const booms = lab.world.fx.filter((f) => f.type === 'explosion') as { pos: { y: number } }[];
    expect(booms.length).toBe(5);
    // spread: impacts happen at different heights along the wall
    const ys = new Set(booms.map((b) => Math.round(b.pos.y / 10)));
    expect(ys.size).toBeGreaterThanOrEqual(4);
  });
});
