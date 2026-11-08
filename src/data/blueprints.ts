import { autoLayout } from '../core/layout';
import { SPELL_FORMAT, type SpellDoc, type SpellGraph } from '../core/types';
import { GraphBuilder } from './builder';

/** Reusable graph fragments that can be inserted into any spell. */
export interface Blueprint {
  id: string;
  name: string;
  description: string;
  graph: SpellGraph;
}

const out: Blueprint[] = [];
function bp(id: string, name: string, description: string, build: (g: GraphBuilder) => void) {
  const graph: SpellGraph = { id: `bp_${id}`, name, nodes: [], edges: [] };
  build(new GraphBuilder(graph));
  const doc: SpellDoc = { format: SPELL_FORMAT, id: 'bp', name, description, tags: [], element: 'arcane', main: graph, subspells: [], variables: [], created: 0, updated: 0 };
  autoLayout(graph, { doc, graph });
  out.push({ id, name, description, graph });
}

bp('split', 'Split on Hit', 'A projectile that bursts into N child projectiles fanned around the surface normal.', (g) => {
  const p = g.node('projectile');
  const r = g.node('radial', { count: 5, spread: 180 });
  const c = g.node('projectile', { speed: 450, life: 0.6, size: 5, damage: 8 });
  g.flow(p, 'onHit', r);
  g.data(p, 'normal', r, 'dir');
  g.flow(r, 'body', c);
  g.data(p, 'point', c, 'origin');
  g.data(r, 'direction', c, 'dir');
});

bp('delayed', 'Delayed Detonation', 'Wait, then explode where an event happened.', (g) => {
  const p = g.node('projectile');
  const d = g.node('delay', { seconds: 1.5 });
  const x = g.node('explosion');
  g.flow(p, 'onExpire', d);
  g.flow(d, 'then', x);
  g.data(p, 'point', x, 'center');
});

bp('salvo', 'Homing Salvo', 'A fan of projectiles that each lock on to the nearest foe.', (g) => {
  const r = g.node('radial', { count: 6, spread: 90 });
  const p = g.node('projectile', { speed: 420 });
  const h = g.node('homing');
  g.flow(r, 'body', p);
  g.data(r, 'direction', p, 'dir');
  g.flow(p, 'then', h);
  g.data(p, 'projectile', h, 'proj');
});

bp('chainhit', 'Chain on Hit', 'Arc lightning onward from whatever a projectile strikes.', (g) => {
  const p = g.node('projectile', { element: 'lightning' });
  const c = g.node('chain', { jumps: 3 });
  g.flow(p, 'onHit', c);
  g.data(p, 'point', c, 'start');
  g.data(p, 'hitEntity', c, 'first');
});

bp('pulse', 'Area Pulse', 'Every half second, damage everything hostile near a point.', (g) => {
  const e = g.node('every', { interval: 0.5, times: 6 });
  const f = g.node('findInRadius', { radius: 150 });
  const d = g.node('damage', { amount: 10 });
  g.flow(e, 'tick', d);
  g.data(f, 'list', d, 'targets');
});

bp('guard', 'Recursion Guard', 'Only continue while the recursion depth is below a limit. Put it at the top of recursive subspells.', (g) => {
  const d = g.node('depth');
  const c = g.node('compare', { op: '<', b: 4 });
  const b = g.node('branch');
  g.data(d, 'depth', c, 'a');
  g.data(c, 'r', b, 'cond');
});

bp('ring', 'Orbit Ring', 'Spawn N projectiles in a ring around you and make them orbit.', (g) => {
  const r = g.node('repeat', { count: 5 });
  const m = g.node('multiply', { b: 72 });
  const a = g.node('fromAngle');
  const o = g.node('offset', { d: 70 });
  const p = g.node('projectile', { speed: 0, life: 6, pierce: 10 });
  const orb = g.node('orbit', { radius: 70 });
  g.data(r, 'index', m, 'a');
  g.data(m, 'r', a, 'deg');
  g.data(a, 'r', o, 'dir');
  g.flow(r, 'body', p);
  g.data(o, 'r', p, 'origin');
  g.flow(p, 'then', orb);
  g.data(p, 'projectile', orb, 'targets');
});

bp('charge', 'Charge Scaling', 'Turn hold time (On Release) into a clamped multiplier.', (g) => {
  const r = g.node('onRelease');
  const m = g.node('multiply', { b: 2 });
  const c = g.node('clamp', { lo: 0.5, hi: 4 });
  g.data(r, 'held', m, 'a');
  g.data(m, 'r', c, 'x');
});

bp('wellbomb', 'Gravity Bomb', 'A gravity well that detonates when it collapses.', (g) => {
  const f = g.node('field', { kind: 'gravity' });
  const x = g.node('explosion', { element: 'void' });
  g.flow(f, 'onExpire', x);
  g.data(f, 'point', x, 'center');
});

bp('reaction', 'Wet & Zap', 'Drench targets, then shock them for double lightning damage.', (g) => {
  const f = g.node('findInRadius', { radius: 160 });
  const s = g.node('soak');
  const z = g.node('shock', { damage: 20 });
  g.data(f, 'list', s, 'targets');
  g.flow(s, 'then', z);
  g.data(f, 'list', z, 'targets');
});

export const BLUEPRINTS: Blueprint[] = out;
