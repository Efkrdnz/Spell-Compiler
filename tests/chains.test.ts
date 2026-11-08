import { describe, expect, it } from 'vitest';
import { SpellBuilder } from '../src/data/builder';
import { errors, makeLab } from './helpers';

/** The headline composition: split into five on impact, each spawns a gravity well that detonates after three seconds. */
function splitterSpell() {
  const s = new SpellBuilder('splitter', 'Gravity Splitter', 'void');
  const cast = s.node('onCast');
  const shot = s.node('projectile', { element: 'void', damage: 10, speed: 700 });
  const burst = s.node('radial', { count: 5, spread: 360 });
  const child = s.node('projectile', { element: 'arcane', damage: 5, speed: 260, life: 0.5, size: 6 });
  const well = s.node('field', { kind: 'gravity', radius: 160, strength: 1200, duration: 3.2 });
  const wait = s.node('delay', { seconds: 3 });
  const boom = s.node('explosion', { element: 'void', radius: 120, damage: 30, force: 600 });
  s.flow(cast, 'then', shot);
  s.flow(shot, 'onHit', burst);
  s.data(shot, 'point', burst, 'dir'); // overwritten below: direction comes from the surface normal
  s.graph.edges.pop();
  s.data(shot, 'normal', burst, 'dir');
  s.flow(burst, 'body', child);
  s.data(shot, 'point', child, 'origin');
  s.data(burst, 'direction', child, 'dir');
  s.flow(child, 'onExpire', well);
  s.data(child, 'point', well, 'center');
  s.flow(well, 'then', wait);
  s.flow(wait, 'then', boom);
  s.data(child, 'point', boom, 'center');
  return s.build();
}

describe('complex chains', () => {
  it('compiles the split → gravity well → delayed detonation chain without errors', () => {
    const lab = makeLab();
    const c = lab.compile(splitterSpell());
    expect(errors(c)).toEqual([]);
    expect(c.complexity).toBeGreaterThan(5);
  });

  it('runs the chain: 5 children, 5 wells, 5 detonations ~3s later', () => {
    const lab = makeLab();
    lab.world.spawn('wall', { x: 700, y: 450 }, { hw: 20, hh: 200, hp: 1e6 });
    const crate = lab.world.spawn('crate', { x: 560, y: 560 });
    const c = lab.compile(splitterSpell());
    const res = lab.cast(c, { x: 900, y: 450 });
    expect(res.ok).toBe(true);
    lab.step(1.2); // shot travels ~480px to the wall (~0.65s), children fly ≤0.5s
    const wells = lab.world.list.filter((e) => e.kind === 'field');
    expect(wells.length).toBe(5);
    const crateStart = { ...crate.pos };
    lab.step(1.2);
    // the crate gets dragged toward the wells
    const moved = Math.hypot(crate.pos.x - crateStart.x, crate.pos.y - crateStart.y);
    expect(moved).toBeGreaterThan(5);
    const fxBefore = lab.world.fx.filter((f) => f.type === 'explosion').length;
    expect(fxBefore).toBe(0);
    lab.step(1.6);
    const booms = lab.world.fx.filter((f) => f.type === 'explosion').length;
    expect(booms).toBe(5);
    // mana: upfront + 1 big shot + 5 children + 5 wells + 5 explosions
    const inst = lab.rt.instances.get(res.instance!)!;
    expect(inst.manaSpent).toBeGreaterThan(60);
    expect(inst.fizzles).toBe(0);
  });
});
