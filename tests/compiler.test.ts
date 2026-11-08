import { describe, expect, it } from 'vitest';
import { compileSpell } from '../src/core/compiler';
import { SpellBuilder } from '../src/data/builder';

const codes = (doc: ReturnType<SpellBuilder['build']>) => compileSpell(doc).diagnostics.map((d) => `${d.severity}:${d.code}`);

describe('compiler: type validation', () => {
  it('rejects a Number wired into an Entity input with a clear message', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const num = s.node('number', { value: 3 });
    const tp = s.node('teleport');
    s.flow(cast, 'then', tp);
    s.data(num, 'value', tp, 'who');
    const c = compileSpell(s.build());
    const d = c.diagnostics.find((x) => x.code === 'type-mismatch')!;
    expect(c.ok).toBe(false);
    expect(d.message).toMatch(/Number.*expects Entity/);
    expect(d.nodeId).toBe(tp);
  });

  it('accepts implicit coercions: entity→vector, entity→entities, number→bool', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const near = s.node('nearest');
    const boom = s.node('explosion');
    const ign = s.node('ignite');
    const br = s.node('branch');
    const n = s.node('number', { value: 1 });
    s.flow(cast, 'then', br);
    s.data(n, 'value', br, 'cond');
    s.flow(br, 'true', boom);
    s.data(near, 'e', boom, 'center');
    s.flow(boom, 'then', ign);
    s.data(near, 'e', ign, 'targets');
    expect(compileSpell(s.build()).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('rejects flow pins wired to data pins', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const boom = s.node('explosion');
    s.flow(cast, 'then', boom, 'radius');
    expect(codes(s.build())).toContain('error:flow-data-mix');
  });

  it('rejects two sources into one data input', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const a = s.node('number', { value: 1 });
    const b = s.node('number', { value: 2 });
    const boom = s.node('explosion');
    s.flow(cast, 'then', boom);
    s.data(a, 'value', boom, 'radius');
    s.data(b, 'value', boom, 'radius');
    expect(codes(s.build())).toContain('error:multi-source');
  });

  it('resolves generic Select output type from its inputs', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const a = s.node('number', { value: 1 });
    const b = s.node('number', { value: 2 });
    const sel = s.node('select');
    const tp = s.node('teleport');
    s.flow(cast, 'then', tp);
    s.data(a, 'value', sel, 'a');
    s.data(b, 'value', sel, 'b');
    s.data(sel, 'r', tp, 'who'); // number → entity: must fail now that Select is typed Number
    expect(codes(s.build())).toContain('error:type-mismatch');
  });
});

describe('compiler: structure', () => {
  it('requires a trigger', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    s.node('explosion');
    expect(codes(s.build())).toEqual(expect.arrayContaining(['error:no-trigger', 'warning:unreachable']));
  });

  it('reports unknown node types', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    s.node('onCast');
    s.node('summonDragonOfDoom');
    expect(codes(s.build())).toContain('error:unknown-node');
  });

  it('detects synchronous infinite loops but allows loops through Delay or events', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const boom = s.node('explosion');
    s.flow(cast, 'then', boom);
    s.flow(boom, 'then', boom);
    const bad = compileSpell(s.build());
    expect(bad.diagnostics.find((d) => d.code === 'sync-cycle')?.message).toMatch(/Infinite loop.*Delay/);

    const ok = new SpellBuilder('t', 'T', 'arcane');
    const c2 = ok.node('onCast');
    const b2 = ok.node('explosion');
    const d2 = ok.node('delay', { seconds: 0.5 });
    ok.flow(c2, 'then', b2);
    ok.flow(b2, 'then', d2);
    ok.flow(d2, 'then', b2);
    expect(compileSpell(ok.build()).diagnostics.some((d) => d.code === 'sync-cycle')).toBe(false);

    const ev = new SpellBuilder('t', 'T', 'arcane');
    const c3 = ev.node('onCast');
    const p3 = ev.node('projectile', { bounces: 2 });
    ev.flow(c3, 'then', p3);
    ev.flow(p3, 'onHit', p3); // every impact spawns another projectile: async recursion
    expect(compileSpell(ev.build()).diagnostics.some((d) => d.code === 'sync-cycle')).toBe(false);
  });

  it('detects data cycles', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    s.node('onCast');
    const a = s.node('add');
    const b = s.node('add');
    s.data(a, 'r', b, 'a');
    s.data(b, 'r', a, 'a');
    expect(codes(s.build())).toContain('error:data-cycle');
  });
});

describe('compiler: scope analysis', () => {
  it('rejects event values used outside their event flow', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const p = s.node('projectile');
    const boom = s.node('explosion');
    s.flow(cast, 'then', p);
    s.flow(p, 'then', boom); // "then" runs immediately — there is no hit yet
    s.data(p, 'point', boom, 'center');
    const d = compileSpell(s.build()).diagnostics.find((x) => x.code === 'out-of-scope');
    expect(d?.message).toMatch(/only exists in flows that continue from “On Hit” or “On Expire” or “On Tick”/);
  });

  it('accepts event values downstream of the event, including across Delay', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const p = s.node('projectile');
    const wait = s.node('delay');
    const boom = s.node('explosion');
    s.flow(cast, 'then', p);
    s.flow(p, 'onHit', wait);
    s.flow(wait, 'then', boom);
    s.data(p, 'point', boom, 'center');
    expect(compileSpell(s.build()).ok).toBe(true);
  });

  it('rejects loop values used after the loop', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const rep = s.node('repeat');
    const boom = s.node('explosion');
    const mul = s.node('multiply');
    s.flow(cast, 'then', rep);
    s.flow(rep, 'done', boom);
    s.data(rep, 'index', mul, 'a');
    s.data(mul, 'r', boom, 'radius'); // through a pure chain
    expect(codes(s.build())).toContain('error:out-of-scope');
  });

  it('lets sibling flows read plain outputs (Sequence 1st spawns, 2nd modifies)', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const seq = s.node('sequence');
    const p = s.node('projectile');
    const h = s.node('homing');
    s.flow(cast, 'then', seq);
    s.flow(seq, 'a', p);
    s.flow(seq, 'b', h);
    s.data(p, 'projectile', h, 'proj');
    expect(compileSpell(s.build()).ok).toBe(true);
  });
});

describe('compiler: references and costs', () => {
  it('validates variables and subspells', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    s.variable('charges', 'vector', { x: 0, y: 0 });
    const cast = s.node('onCast');
    const add = s.node('addVar', { name: 'charges' });
    const get = s.node('getVar', { name: 'nope' });
    const call = s.node('callSubspell', { sub: 'missing' });
    s.flow(cast, 'then', add);
    s.flow(add, 'then', call);
    void get;
    const sub = s.subspell('emptySub', 'Empty', []);
    sub.node('explosion');
    const cs = codes(s.build());
    expect(cs).toEqual(expect.arrayContaining(['error:var-type', 'error:var-unknown', 'error:sub-unknown', 'error:no-entry']));
  });

  it('flags recursive subspells as info, not error', () => {
    const s = new SpellBuilder('t', 'T', 'arcane');
    const cast = s.node('onCast');
    const call = s.node('callSubspell', { sub: 'rec' });
    s.flow(cast, 'then', call);
    const g = s.subspell('rec', 'Recurse', []);
    const e = g.node('entry');
    const again = g.node('callSubspell', { sub: 'rec' });
    g.flow(e, 'start', again);
    const c = compileSpell(s.build());
    expect(c.ok).toBe(true);
    expect(c.recursive).toBe(true);
    expect(c.diagnostics.some((d) => d.code === 'recursive' && d.severity === 'info')).toBe(true);
  });

  it('scales upfront mana and cooldown with complexity', () => {
    const small = new SpellBuilder('a', 'A', 'arcane');
    small.flow(small.node('onCast'), 'then', small.node('projectile'));
    const big = new SpellBuilder('b', 'B', 'arcane');
    let prev = big.node('onCast');
    for (let i = 0; i < 10; i++) {
      const n = big.node(i % 2 ? 'explosion' : 'field');
      big.flow(prev, 'then', n);
      prev = n;
    }
    const a = compileSpell(small.build());
    const b = compileSpell(big.build());
    expect(b.complexity).toBeGreaterThan(a.complexity * 4);
    expect(b.upfront).toBeGreaterThan(a.upfront);
    expect(b.cooldown).toBeGreaterThan(a.cooldown);
    expect(b.estimate).toBeGreaterThan(a.estimate);
  });
});
