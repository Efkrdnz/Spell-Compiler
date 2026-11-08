import { compileSpell, type CompiledSpell } from '../src/core/compiler';
import { SpellRuntime, type CastContext } from '../src/core/interpreter';
import { V, rng, type SpellDoc, type Vec } from '../src/core/types';
import { World } from '../src/sim/world';

export const DT = 1 / 60;

export interface Lab {
  world: World;
  rt: SpellRuntime;
  casterId: number;
  library: Map<string, CompiledSpell>;
  compile(doc: SpellDoc): CompiledSpell;
  cast(spell: CompiledSpell, target: Vec): ReturnType<SpellRuntime['press']>;
  step(seconds: number): void;
}

/** A deterministic world with a caster on the left and nothing else. */
export function makeLab(seed = 7): Lab {
  const world = new World();
  world.random = rng(seed);
  const library = new Map<string, CompiledSpell>();
  const rt = new SpellRuntime(world, (id) => library.get(id));
  rt.random = rng(seed + 1);
  rt.settings.trace = 'all';
  const caster = world.spawn('caster', { x: 200, y: 450 });
  const lab: Lab = {
    world,
    rt,
    casterId: caster.id,
    library,
    compile(doc) {
      const c = compileSpell(doc, { spellExists: (id) => library.has(id) });
      library.set(doc.id, c);
      return c;
    },
    cast(spell, target) {
      const c = world.get(caster.id)!;
      const ctx: CastContext = { casterId: caster.id, origin: V.copy(c.pos), target, aim: V.norm(V.sub(target, c.pos)) };
      const r = rt.press(spell, ctx);
      rt.release(ctx);
      return r;
    },
    step(seconds) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        world.step(DT);
        rt.tick();
      }
    },
  };
  return lab;
}

export function errors(c: CompiledSpell) {
  return c.diagnostics.filter((d) => d.severity === 'error');
}
