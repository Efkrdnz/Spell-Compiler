import type { SpellDoc } from '../core/types';
import { SpellBuilder } from './builder';

export interface Example {
  id: string;
  doc: SpellDoc;
  /** one-line pitch shown in the library */
  summary: string;
  /** which arena preset shows it off best */
  preset: string;
}

const examples: Example[] = [];
const add = (summary: string, preset: string, b: SpellBuilder) => {
  const doc = b.build();
  doc.tags = [...new Set([...doc.tags, 'example'])];
  examples.push({ id: doc.id, doc, summary, preset });
};

// ── 1. Fireball ──────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_fireball', 'Fireball', 'fire', 'A classic: a fire bolt that explodes on impact, igniting grass, oil and anything flammable.', ['starter']);
  const cast = s.node('onCast');
  const bolt = s.node('projectile', { element: 'fire', damage: 18, size: 11, speed: 640 });
  const boom = s.node('explosion', { element: 'fire', radius: 95, damage: 30, force: 420 });
  s.flow(cast, 'then', bolt);
  s.flow(bolt, 'onExpire', boom);
  s.data(bolt, 'point', boom, 'center');
  add('Projectile → explode on expiry', 'elements', s);
}

// ── 2. Gravity Splitter: the headline composition ───────────────────────────
{
  const s = new SpellBuilder(
    'ex_splitter',
    'Gravity Splitter',
    'void',
    'On impact the orb shatters into five shards. Each shard opens a gravity well that drags in everything nearby, then detonates three seconds later.',
    ['composition'],
  );
  const cast = s.node('onCast');
  const shot = s.node('projectile', { element: 'void', damage: 12, speed: 720, size: 10 });
  const burst = s.node('radial', { count: 5, spread: 360 });
  const shard = s.node('projectile', { element: 'arcane', damage: 6, speed: 300, life: 0.45, size: 6 });
  const well = s.node('field', { kind: 'gravity', element: 'void', radius: 150, strength: 1300, duration: 3.1 });
  const wait = s.node('delay', { seconds: 3 });
  const boom = s.node('explosion', { element: 'void', radius: 120, damage: 34, force: 650 });
  s.flow(cast, 'then', shot);
  s.flow(shot, 'onHit', burst);
  s.data(shot, 'normal', burst, 'dir');
  s.flow(burst, 'body', shard);
  s.data(shot, 'point', shard, 'origin');
  s.data(burst, 'direction', shard, 'dir');
  s.flow(shard, 'onExpire', well);
  s.data(shard, 'point', well, 'center');
  s.flow(well, 'then', wait);
  s.flow(wait, 'then', boom);
  s.data(shard, 'point', boom, 'center');
  add('Split ×5 → gravity wells → detonate after 3s', 'physics', s);
}

// ── 3. Chain Lightning ───────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_chain', 'Chain Lightning', 'lightning', 'A bolt that arcs between up to seven foes. Wet targets take double, metal extends the reach.', ['starter']);
  const cast = s.node('onCast');
  const near = s.node('nearest', { filter: 'hostile', range: 520 });
  const chain = s.node('chain', { jumps: 7, range: 210, damage: 22 });
  s.flow(cast, 'then', chain);
  s.data(near, 'e', chain, 'first');
  add('Nearest foe → chain hops', 'elements', s);
}

export const EXAMPLES: Example[] = examples;

export function exampleById(id: string): Example | undefined {
  return examples.find((e) => e.id === id);
}
