import { describe, expect, it } from 'vitest';
import { compileSpell } from '../src/core/compiler';
import { portsOf, type PortDef } from '../src/core/nodes/defs';
import { NODE_DEFS, palette } from '../src/core/nodes/registry';
import { SpellBuilder } from '../src/data/builder';

describe('node registry integrity', () => {
  const doc = new SpellBuilder('x', 'X', 'arcane').build();
  const env = { doc, graph: doc.main };

  it('has unique node types and enough breadth', () => {
    const types = NODE_DEFS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types.length).toBeGreaterThanOrEqual(75);
  });

  for (const def of NODE_DEFS) {
    it(`${def.type} is well-formed`, () => {
      const n = { id: 'n', type: def.type, x: 0, y: 0, values: {} };
      const { inputs, outputs } = portsOf(def, n, env);
      const ids = (ps: PortDef[]) => ps.map((p) => p.id);
      expect(new Set(ids(inputs)).size).toBe(inputs.length);
      expect(new Set(ids(outputs)).size).toBe(outputs.length);
      expect(def.description.length).toBeGreaterThan(10);
      if (def.pure) {
        expect(def.eval, 'pure nodes evaluate').toBeTypeOf('function');
        expect([...inputs, ...outputs].some((p) => p.type === 'exec')).toBe(false);
      } else if (!def.trigger) {
        expect(def.exec, 'impure nodes execute').toBeTypeOf('function');
        expect(inputs.filter((p) => p.type === 'exec').length).toBe(1);
      }
      const execOuts = new Set(outputs.filter((p) => p.type === 'exec').map((p) => p.id));
      for (const o of outputs) {
        for (const s of o.scope ?? []) expect(execOuts.has(s), `${o.id} scope ${s}`).toBe(true);
        // event-scoped values must say where their value comes from
        const eventScoped = (o.scope ?? []).some((s) => outputs.find((p) => p.id === s)?.event);
        if (eventScoped) expect(o.eventKey, `${o.id} needs an eventKey`).toBeTruthy();
      }
      for (const p of def.params ?? []) expect(p.default).not.toBeUndefined();
      for (const p of inputs) if (p.type === 'number') expect(typeof p.default).toBe('number');
    });
  }

  it('every node compiles alone inside a minimal spell (wired from On Cast when it has a flow input)', () => {
    for (const def of NODE_DEFS) {
      if (def.only === 'subspell' || def.trigger) continue;
      const s = new SpellBuilder('solo', 'Solo', 'arcane');
      const cast = s.node('onCast');
      const id = s.node(def.type);
      if (!def.pure) s.flow(cast, 'then', id);
      const c = compileSpell(s.build());
      const errs = c.diagnostics.filter((d) => d.severity === 'error' && !/no variable selected|no subspell selected|no spell selected/.test(d.message));
      expect(errs, def.type).toEqual([]);
    }
  });

  it('palette exposes every node plus presets', () => {
    const p = palette();
    for (const d of NODE_DEFS) expect(p.some((e) => e.type === d.type && !e.values)).toBe(true);
    expect(p.filter((e) => e.values).length).toBeGreaterThan(10);
  });
});
