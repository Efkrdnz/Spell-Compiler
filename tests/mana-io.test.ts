import { describe, expect, it } from 'vitest';
import { compileSpell } from '../src/core/compiler';
import { ImportError, decodeShare, encodeShare, exportLibrary, exportSpell, importAny, importSpell } from '../src/core/serialize';
import { SpellBuilder } from '../src/data/builder';
import { EXAMPLES } from '../src/data/examples';
import { BLUEPRINTS } from '../src/data/blueprints';
import { makeLab } from './helpers';

function boomSpell(radius: number, damage: number) {
  const s = new SpellBuilder(`boom${radius}`, 'Boom', 'fire');
  const c = s.node('onCast');
  const b = s.node('explosion', { radius, damage });
  s.flow(c, 'then', b);
  return s.build();
}

describe('mana economy', () => {
  it('charges upfront + dynamic costs that scale with the actual effect', () => {
    const lab = makeLab();
    lab.rt.settings.ignoreCooldowns = true;
    const caster = lab.world.get(lab.casterId)!;
    const spend = (radius: number, damage: number) => {
      caster.mana = { cur: 1000, max: 1000, regen: 0 };
      const c = lab.compile(boomSpell(radius, damage));
      lab.cast(c, { x: 700, y: 450 });
      return 1000 - caster.mana.cur;
    };
    const small = spend(40, 10);
    const big = spend(300, 120);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small * 2.5);
  });

  it('fizzles effects the caster cannot afford and reports it', () => {
    const lab = makeLab();
    const caster = lab.world.get(lab.casterId)!;
    const c = lab.compile(boomSpell(400, 300));
    caster.mana = { cur: c.upfront + 2, max: 500, regen: 0 };
    const r = lab.cast(c, { x: 700, y: 450 });
    expect(r.ok).toBe(true); // the cast itself starts…
    expect(lab.world.fx.some((f) => f.type === 'explosion')).toBe(false); // …but the blast fizzles
    expect(lab.rt.trace.some((t) => t.kind === 'fizzle' && /Out of mana/.test(t.message))).toBe(true);
  });

  it('refuses casts without the upfront mana', () => {
    const lab = makeLab();
    const caster = lab.world.get(lab.casterId)!;
    caster.mana = { cur: 0.5, max: 500, regen: 0 };
    const r = lab.cast(lab.compile(boomSpell(50, 10)), { x: 700, y: 450 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Not enough mana/);
  });

  it('enforces cooldowns derived from complexity', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const c = lab.compile(boomSpell(50, 10));
    expect(lab.cast(c, { x: 700, y: 450 }).ok).toBe(true);
    const again = lab.cast(c, { x: 700, y: 450 });
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/Cooling down/);
    lab.step(c.cooldown + 0.05);
    expect(lab.cast(c, { x: 700, y: 450 }).ok).toBe(true);
  });

  it('never charges with infinite mana enabled', () => {
    const lab = makeLab();
    lab.rt.settings.infiniteMana = true;
    const caster = lab.world.get(lab.casterId)!;
    caster.mana = { cur: 1, max: 1, regen: 0 };
    expect(lab.cast(lab.compile(boomSpell(300, 200)), { x: 700, y: 450 }).ok).toBe(true);
    expect(caster.mana.cur).toBe(1);
    expect(lab.world.fx.some((f) => f.type === 'explosion')).toBe(true);
  });
});

describe('save / load / share', () => {
  it('round-trips every example through JSON export/import unchanged', () => {
    for (const ex of EXAMPLES) {
      const { doc, warnings } = importSpell(exportSpell(ex.doc));
      expect(warnings).toEqual([]);
      expect(doc).toEqual(ex.doc);
    }
  });

  it('round-trips through compressed share codes', () => {
    const ex = EXAMPLES[1].doc;
    const code = encodeShare(ex);
    expect(code.length).toBeLessThan(JSON.stringify(ex).length);
    expect(decodeShare(code).doc).toEqual(ex);
  });

  it('round-trips a whole library', () => {
    const { docs } = importAny(exportLibrary(EXAMPLES.map((e) => e.doc)));
    expect(docs.length).toBe(EXAMPLES.length);
  });

  it('gives clear errors for bad input', () => {
    expect(() => importSpell('{nope')).toThrow(ImportError);
    expect(() => importSpell('{nope')).toThrow(/valid JSON/);
    expect(() => importSpell('{"name":"x"}')).toThrow(/format/);
    expect(() => importSpell('{"format":"spell-compiler/1","name":"x"}')).toThrow(/main/);
    expect(() => decodeShare('garbage!!')).toThrow(ImportError);
  });

  it('repairs soft problems with warnings', () => {
    const doc = structuredClone(EXAMPLES[0].doc);
    (doc.main.edges as unknown[]).push({ from: 'ghost', to: doc.main.nodes[0].id, fromPort: 'x', toPort: 'y' });
    (doc.main.nodes[0].values as Record<string, unknown>).bad = { evil: true };
    const { doc: out, warnings } = importSpell(JSON.stringify(doc));
    expect(warnings.length).toBe(2);
    expect(out.main.edges.length).toBe(EXAMPLES[0].doc.main.edges.length);
  });
});

describe('content', () => {
  it('every example compiles cleanly', () => {
    const ids = new Set(EXAMPLES.map((e) => e.id));
    for (const ex of EXAMPLES) {
      const c = compileSpell(ex.doc, { spellExists: (id) => ids.has(id) });
      expect(c.diagnostics.filter((d) => d.severity !== 'info'), ex.doc.name).toEqual([]);
    }
  });

  it('every example can actually be cast in the training arena', () => {
    for (const ex of EXAMPLES) {
      const lab = makeLab(3);
      lab.rt.settings.infiniteMana = true;
      for (const other of EXAMPLES) lab.compile(other.doc);
      const c = lab.library.get(ex.id)!;
      lab.world.spawn('dummy', { x: 700, y: 450 });
      lab.world.spawn('enemy', { x: 760, y: 380 });
      const r = lab.cast(c, { x: 700, y: 450 });
      expect(r.ok, ex.doc.name).toBe(true);
      lab.step(3);
      expect(lab.rt.trace.filter((t) => t.kind === 'error'), ex.doc.name).toEqual([]);
    }
  });

  it('every blueprint is a valid graph fragment', () => {
    for (const bp of BLUEPRINTS) {
      expect(bp.graph.nodes.length).toBeGreaterThan(0);
      const ids = new Set(bp.graph.nodes.map((n: { id: string }) => n.id));
      for (const e of bp.graph.edges as { from: string; to: string }[]) {
        expect(ids.has(e.from)).toBe(true);
        expect(ids.has(e.to)).toBe(true);
      }
    }
  });
});
