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

// ── Fireball ─────────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_fireball', 'Fireball', 'fire', 'A classic: a fire bolt that explodes when it ends, igniting grass, oil and anything flammable.', ['starter', 'fire']);
  const cast = s.node('onCast');
  const bolt = s.node('projectile', { element: 'fire', damage: 18, size: 11, speed: 640 });
  const boom = s.node('explosion', { element: 'fire', radius: 95, damage: 30, force: 420 });
  s.flow(cast, 'then', bolt);
  s.flow(bolt, 'onExpire', boom);
  s.data(bolt, 'point', boom, 'center');
  add('Projectile → explode on expiry', 'elements', s);
}

// ── Gravity Splitter: the headline composition ──────────────────────────────
{
  const s = new SpellBuilder(
    'ex_splitter',
    'Gravity Splitter',
    'void',
    'On impact the orb shatters into five shards. Each shard opens a gravity well that drags in everything nearby, then detonates three seconds later.',
    ['composition', 'void'],
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

// ── Chain Lightning ──────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_chain', 'Chain Lightning', 'lightning', 'Arcs between up to seven foes. Wet targets take double damage, metal extends the reach.', ['starter', 'lightning']);
  const cast = s.node('onCast');
  const near = s.node('nearest', { filter: 'hostile', range: 520 });
  const chain = s.node('chain', { jumps: 7, range: 210, damage: 22 });
  s.flow(cast, 'then', chain);
  s.data(near, 'e', chain, 'first');
  add('Nearest foe → chain hops', 'elements', s);
}

// ── Frost Lance ──────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_frost', 'Frost Lance', 'ice', 'Three piercing ice shards in a tight fan. Anything they pierce is frozen solid — hit it again with force to shatter it.', ['ice']);
  const cast = s.node('onCast');
  const fan = s.node('radial', { count: 3, spread: 22 });
  const shard = s.node('projectile', { element: 'ice', speed: 980, size: 5, damage: 14, pierce: 2, life: 1.4 });
  const fr = s.node('freeze', { duration: 1.8 });
  s.flow(cast, 'then', fan);
  s.flow(fan, 'body', shard);
  s.data(fan, 'direction', shard, 'dir');
  s.flow(shard, 'onHit', fr);
  s.data(shard, 'hitEntity', fr, 'targets');
  add('Fan of piercing shards → freeze on hit', 'elements', s);
}

// ── Meteor Storm ─────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_meteor', 'Meteor Storm', 'fire', 'Ten meteors rain down around the cursor over 1.5 seconds, each one cratering on arrival.', ['fire', 'timing']);
  const cast = s.node('onCast');
  const every = s.node('every', { interval: 0.15, times: 10 });
  const pt = s.node('randomPoint', { r: 150 });
  const sky = s.node('vector', { x: -260, y: -420 });
  const from = s.node('vecAdd');
  const dir = s.node('direction');
  const life = s.node('divide', { b: 1000 });
  const met = s.node('projectile', { element: 'fire', speed: 1000, size: 13, damage: 8 });
  const boom = s.node('explosion', { element: 'fire', radius: 80, damage: 26, force: 380 });
  s.flow(cast, 'then', every);
  s.data(pt, 'p', from, 'a');
  s.data(sky, 'v', from, 'b');
  s.data(from, 'r', dir, 'from');
  s.data(pt, 'p', dir, 'to');
  s.data(dir, 'dist', life, 'a');
  s.flow(every, 'tick', met);
  s.data(from, 'r', met, 'origin');
  s.data(dir, 'dir', met, 'dir');
  s.data(life, 'r', met, 'life');
  s.flow(met, 'onExpire', boom);
  s.data(met, 'point', boom, 'center');
  add('Every 0.15s ×10 → meteor from the sky → crater', 'horde', s);
}

// ── Black Hole ───────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_blackhole', 'Black Hole', 'void', 'Tears open a singularity that swallows props, foes and even projectiles, then collapses in a violent outward blast.', ['void', 'force']);
  const cast = s.node('onCast');
  const hole = s.node('field', { kind: 'gravity', element: 'void', radius: 230, strength: 1900, duration: 4, dps: 10 });
  const blast = s.node('explosion', { element: 'void', radius: 190, damage: 40, force: 1500 });
  s.flow(cast, 'then', hole);
  s.flow(hole, 'onExpire', blast);
  s.data(hole, 'point', blast, 'center');
  add('Gravity well → collapse blast', 'physics', s);
}

// ── Prism Beam (channel) ─────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_prism', 'Prism Beam', 'arcane', 'Hold to channel a searing arcane beam. Each target it touches has a 35% chance to refract a spark to a neighbour.', ['channel', 'arcane']);
  const ch = s.node('onChannel', { interval: 0.12 });
  const beam = s.node('beam', { element: 'arcane', duration: 0.14, dps: 95, length: 820, width: 11 });
  const chance = s.node('chance', { p: 0.35 });
  const arc = s.node('chain', { jumps: 2, range: 170, damage: 7, element: 'arcane' });
  s.flow(ch, 'tick', beam);
  s.flow(beam, 'onHit', chance);
  s.flow(chance, 'yes', arc);
  s.data(beam, 'point', arc, 'start');
  s.data(beam, 'hitEntity', arc, 'first');
  add('While channeling → beam → chance to refract', 'training', s);
}

// ── Charge Shot (release) ────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_charge', 'Charge Shot', 'force', 'Hold to charge, release to fire. Damage, size and blast radius all scale with how long you held.', ['release', 'math']);
  const rel = s.node('onRelease');
  const dmgMul = s.node('multiply', { b: 45 });
  const dmg = s.node('add', { b: 10 });
  const sizeMul = s.node('multiply', { b: 10 });
  const size = s.node('clamp', { lo: 6, hi: 30 });
  const radMul = s.node('multiply', { b: 90 });
  const rad = s.node('clamp', { lo: 40, hi: 240 });
  const shot = s.node('projectile', { element: 'force', speed: 900, life: 1.6 });
  const boom = s.node('explosion', { element: 'force', damage: 20, force: 900 });
  s.flow(rel, 'then', shot);
  s.data(rel, 'held', dmgMul, 'a');
  s.data(dmgMul, 'r', dmg, 'a');
  s.data(dmg, 'r', shot, 'damage');
  s.data(rel, 'held', sizeMul, 'a');
  s.data(sizeMul, 'r', size, 'x');
  s.data(size, 'r', shot, 'size');
  s.flow(shot, 'onExpire', boom);
  s.data(shot, 'point', boom, 'center');
  s.data(rel, 'held', radMul, 'a');
  s.data(radMul, 'r', rad, 'x');
  s.data(rad, 'r', boom, 'radius');
  add('On Release: held time → damage, size, radius', 'physics', s);
}

// ── Blink Strike ─────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_blink', 'Blink Strike', 'force', 'Teleport to the cursor and arrive with a concussive shockwave followed by a frost nova.', ['teleport']);
  const cast = s.node('onCast');
  const tp = s.node('teleport');
  const shock = s.node('explosion', { element: 'force', radius: 110, damage: 14, force: 950 });
  const nova = s.node('explosion', { element: 'ice', radius: 150, damage: 10, force: 0 });
  s.flow(cast, 'then', tp);
  s.flow(tp, 'then', shock);
  s.data(tp, 'arrived', shock, 'center');
  s.flow(shock, 'then', nova);
  s.data(tp, 'arrived', nova, 'center');
  add('Teleport → shockwave → frost nova', 'horde', s);
}

// ── Tesla Turret ─────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_tesla', 'Tesla Turret', 'lightning', 'Summons a turret whose attack is programmed here: each attack chains lightning from the turret through three foes.', ['summon', 'lightning']);
  const cast = s.node('onCast');
  const tur = s.node('summon', { kind: 'turret', element: 'lightning', duration: 12, damage: 0, rate: 0.7, range: 380 });
  const info = s.node('entityInfo');
  const arc = s.node('chain', { jumps: 3, range: 190, damage: 14 });
  s.flow(cast, 'then', tur);
  s.flow(tur, 'onAttack', arc);
  s.data(tur, 'summon', info, 'e');
  s.data(info, 'pos', arc, 'start');
  s.data(tur, 'target', arc, 'first');
  add('Summon → program its attack with Chain', 'horde', s);
}

// ── Flame Halo (orbit) ───────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_halo', 'Flame Halo', 'fire', 'Six fireballs orbit you for six seconds, burning whatever they touch — then fly outward when the orbit ends.', ['orbit', 'fire']);
  const cast = s.node('onCast');
  const rep = s.node('repeat', { count: 6 });
  const ang = s.node('multiply', { b: 60 });
  const dir = s.node('fromAngle');
  const pos = s.node('offset', { d: 72 });
  const fire = s.node('projectile', { element: 'fire', speed: 0, size: 9, damage: 14, life: 7, pierce: 20 });
  const orb = s.node('orbit', { radius: 72, speed: 230, duration: 6 });
  s.flow(cast, 'then', rep);
  s.data(rep, 'index', ang, 'a');
  s.data(ang, 'r', dir, 'deg');
  s.data(dir, 'r', pos, 'dir');
  s.flow(rep, 'body', fire);
  s.data(pos, 'r', fire, 'origin');
  s.data(dir, 'r', fire, 'dir');
  s.flow(fire, 'then', orb);
  s.data(fire, 'projectile', orb, 'targets');
  add('Repeat ×6 → projectile → orbit caster', 'horde', s);
}

// ── Homing Swarm ─────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_swarm', 'Seeker Swarm', 'arcane', 'Eight arcane darts fan out and then hunt down the nearest foes.', ['homing', 'arcane']);
  const cast = s.node('onCast');
  const fan = s.node('radial', { count: 8, spread: 140 });
  const dart = s.node('projectile', { element: 'arcane', speed: 430, damage: 9, size: 6, life: 3.5 });
  const hm = s.node('homing', { turn: 5 });
  s.flow(cast, 'then', fan);
  s.flow(fan, 'body', dart);
  s.data(fan, 'direction', dart, 'dir');
  s.flow(dart, 'then', hm);
  s.data(dart, 'projectile', hm, 'proj');
  add('Fan ×8 → homing darts', 'gauntlet', s);
}

// ── Fractal Nova (recursive subspell) ────────────────────────────────────────
{
  const s = new SpellBuilder(
    'ex_fractal',
    'Fractal Nova',
    'arcane',
    'A recursive subspell: each nova spawns four smaller novas around itself a moment later, three generations deep (21 blasts).',
    ['recursion', 'subspell'],
  );
  const cast = s.node('onCast');
  const call = s.node('callSubspell', { sub: 'nova', p_radius: 75 });
  s.flow(cast, 'then', call);
  const g = s.subspell('nova', 'Nova', [
    { id: 'center', name: 'Center', type: 'vector' },
    { id: 'radius', name: 'Radius', type: 'number' },
  ]);
  const e = g.node('entry');
  const boom = g.node('explosion', { element: 'arcane', damage: 16, force: 260 });
  const depth = g.node('depth');
  const cmp = g.node('compare', { op: '<', b: 3 });
  const br = g.node('branch');
  const ring = g.node('radial', { count: 4, spread: 360 });
  const wait = g.node('delay', { seconds: 0.18 });
  const scaleR = g.node('multiply', { b: 1.3 });
  const nextC = g.node('offset');
  const nextR = g.node('multiply', { b: 0.62 });
  const again = g.node('callSubspell', { sub: 'nova' });
  g.flow(e, 'start', boom);
  g.data(e, 'p_center', boom, 'center');
  g.data(e, 'p_radius', boom, 'radius');
  g.flow(boom, 'then', br);
  g.data(depth, 'depth', cmp, 'a');
  g.data(cmp, 'r', br, 'cond');
  g.flow(br, 'true', ring);
  g.flow(ring, 'body', wait);
  g.flow(wait, 'then', again);
  g.data(e, 'p_radius', scaleR, 'a');
  g.data(e, 'p_center', nextC, 'p');
  g.data(ring, 'direction', nextC, 'dir');
  g.data(scaleR, 'r', nextC, 'd');
  g.data(nextC, 'r', again, 'p_center');
  g.data(e, 'p_radius', nextR, 'a');
  g.data(nextR, 'r', again, 'p_radius');
  add('Recursive subspell with a depth guard', 'chain', s);
}

// ── Wool Bomb (transmutation) ────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_sheep', 'Wool Bomb', 'arcane', 'Polymorphs every foe near the cursor into a sheep. Three seconds later, the flock catches fire.', ['transmute']);
  const cast = s.node('onCast');
  const find = s.node('findInRadius', { filter: 'enemies', radius: 170 });
  const poly = s.node('transmute', { into: 'sheep', duration: 7 });
  const wait = s.node('delay', { seconds: 3 });
  const burn = s.node('ignite', { duration: 4, dps: 14 });
  s.flow(cast, 'then', poly);
  s.data(find, 'list', poly, 'targets');
  s.flow(poly, 'then', wait);
  s.flow(wait, 'then', burn);
  s.data(poly, 'results', burn, 'targets');
  add('Find enemies → sheep → ignite later', 'horde', s);
}

// ── Volatile Touch (material transmutation) ──────────────────────────────────
{
  const s = new SpellBuilder('ex_volatile', 'Volatile Touch', 'fire', 'Whatever the bolt hits is transmuted into an explosive barrel, which detonates a heartbeat later.', ['transmute', 'fire']);
  const cast = s.node('onCast');
  const bolt = s.node('projectile', { element: 'arcane', damage: 2, speed: 760, size: 7 });
  const tx = s.node('transmute', { into: 'barrel' });
  const wait = s.node('delay', { seconds: 0.5 });
  const lit = s.node('damage', { amount: 60, element: 'fire' });
  s.flow(cast, 'then', bolt);
  s.flow(bolt, 'onHit', tx);
  s.data(bolt, 'hitEntity', tx, 'targets');
  s.flow(tx, 'then', wait);
  s.flow(wait, 'then', lit);
  s.data(tx, 'results', lit, 'targets');
  add('Projectile → transmute target into barrel → detonate', 'physics', s);
}

// ── Healing Grove ────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_grove', 'Healing Grove', 'life', 'Plants a sanctuary that heals allies and sears foes, regrows grass, grants you regeneration and calls a life wisp.', ['life', 'summon']);
  const cast = s.node('onCast');
  const seq = s.node('sequence');
  const zone = s.node('field', { kind: 'zone', element: 'life', radius: 130, strength: 0, duration: 6, dps: 22 });
  const grass = s.node('paint', { mat: 'grass', radius: 110 });
  const heal = s.node('heal', { amount: 20, regen: 8, regenTime: 5 });
  const wisp = s.node('summon', { kind: 'wisp', element: 'life', damage: 6, rate: 0.6, duration: 10 });
  s.flow(cast, 'then', seq);
  s.flow(seq, 'a', zone);
  s.flow(seq, 'b', grass);
  s.flow(seq, 'c', heal);
  s.flow(seq, 'd', wisp);
  add('Sequence: zone + terrain + regen + wisp', 'horde', s);
}

// ── Oil & Spark (environment) ────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_oil', 'Oil & Spark', 'fire', 'Spills a pool of oil at the cursor, then flicks a spark across it. The oil does the rest.', ['environment', 'fire']);
  const cast = s.node('onCast');
  const oil = s.node('paint', { mat: 'oil', radius: 140 });
  const wait = s.node('delay', { seconds: 0.35 });
  const spark = s.node('projectile', { element: 'fire', speed: 700, size: 6, damage: 8 });
  const pop = s.node('explosion', { element: 'fire', radius: 60, damage: 12, force: 200 });
  s.flow(cast, 'then', oil);
  s.flow(oil, 'then', wait);
  s.flow(wait, 'then', spark);
  s.flow(spark, 'onExpire', pop);
  s.data(spark, 'point', pop, 'center');
  add('Paint oil → delay → fire projectile ignites it', 'training', s);
}

// ── Storm Cell ───────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_storm', 'Storm Cell', 'lightning', 'Floods the ground, then hangs a thundercloud over it that strikes the nearest foe every 0.35s — electrifying the whole puddle.', ['environment', 'lightning']);
  const cast = s.node('onCast');
  const water = s.node('paint', { mat: 'water', radius: 120 });
  const cloud = s.node('field', { kind: 'zone', element: 'lightning', radius: 140, strength: 0, duration: 5, dps: 0, tick: 0.35 });
  const near = s.node('nearest', { filter: 'hostile', range: 170 });
  const strike = s.node('shock', { damage: 12 });
  s.flow(cast, 'then', water);
  s.flow(water, 'then', cloud);
  s.flow(cloud, 'onTick', strike);
  s.data(cloud, 'point', near, 'p');
  s.data(near, 'e', strike, 'targets');
  add('Paint water → zone ticks → shock nearest', 'horde', s);
}

// ── Aegis ────────────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_aegis', 'Aegis', 'force', 'Raises a curved wall of force in front of you and wraps you in a shield.', ['defense']);
  const cast = s.node('onCast');
  const at = s.node('offset', { d: 80 });
  const wall = s.node('barrier', { width: 180, duration: 6, hp: 120 });
  const ward = s.node('shield', { amount: 80, duration: 6 });
  s.flow(cast, 'then', wall);
  s.data(at, 'r', wall, 'center');
  s.flow(wall, 'then', ward);
  add('Barrier wall + shield', 'horde', s);
}

// ── Kinetic Cannon ───────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_cannon', 'Kinetic Cannon', 'force', 'Conjures a boulder in front of you and hurls it. Pure physics: impacts crush crates and bowl over foes.', ['conjure', 'physics']);
  const cast = s.node('onCast');
  const at = s.node('offset', { d: 64 });
  const rock = s.node('conjure', { kind: 'boulder', life: 8 });
  const fling = s.node('push', { mode: 'set', strength: 1300 });
  s.flow(cast, 'then', rock);
  s.data(at, 'r', rock, 'pos');
  s.flow(rock, 'then', fling);
  s.data(rock, 'e', fling, 'targets');
  add('Conjure boulder → set velocity', 'physics', s);
}

// ── Cyclone ──────────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_cyclone', 'Cyclone', 'force', 'A slow-moving tornado: a vortex field rides on a lumbering projectile, then bursts outward when it dies.', ['force', 'composition']);
  const cast = s.node('onCast');
  const core = s.node('projectile', { element: 'force', speed: 150, size: 14, damage: 4, life: 4.5, pierce: 50 });
  const vort = s.node('field', { kind: 'vortex', element: 'force', radius: 130, strength: 720, duration: 4.5, projectiles: false });
  const burst = s.node('radialForce', { radius: 220, strength: 1200 });
  s.flow(cast, 'then', core);
  s.flow(core, 'then', vort);
  s.data(core, 'projectile', vort, 'center');
  s.data(core, 'projectile', vort, 'follow');
  s.flow(core, 'onExpire', burst);
  s.data(core, 'point', burst, 'center');
  add('Field attached to a projectile', 'physics', s);
}

// ── Ricochet ─────────────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_ricochet', 'Ricochet Arcana', 'arcane', 'Bounces six times. A cast variable counts impacts, and every blast grows bigger than the last.', ['variables', 'bounce']);
  s.variable('hits', 'number', 0, 'cast');
  const cast = s.node('onCast');
  const orb = s.node('projectile', { element: 'arcane', speed: 760, damage: 12, size: 8, bounces: 6, life: 5 });
  const count = s.node('addVar', { name: 'hits', amount: 1 });
  const grow = s.node('multiply', { b: 14 });
  const rad = s.node('add', { b: 36 });
  const pop = s.node('explosion', { element: 'arcane', damage: 9, force: 320 });
  s.flow(cast, 'then', orb);
  s.flow(orb, 'onHit', count);
  s.flow(count, 'then', pop);
  s.data(count, 'value', grow, 'a');
  s.data(grow, 'r', rad, 'a');
  s.data(rad, 'r', pop, 'radius');
  s.data(orb, 'point', pop, 'center');
  add('Bounces + cast variable → growing blasts', 'gauntlet', s);
}

// ── Escalation (persistent variable) ─────────────────────────────────────────
{
  const s = new SpellBuilder('ex_escalate', 'Escalation', 'lightning', 'Remembers between casts: each cast is stronger than the last, resetting after the fifth.', ['variables', 'persistent']);
  s.variable('stacks', 'number', 0, 'persistent');
  const cast = s.node('onCast');
  const inc = s.node('addVar', { name: 'stacks', amount: 1 });
  const mod = s.node('mathOp', { op: 'mod', b: 5 });
  const dm = s.node('multiply', { b: 12 });
  const dmg = s.node('add', { b: 10 });
  const sz = s.node('multiply', { b: 3 });
  const size = s.node('add', { b: 6 });
  const bolt = s.node('projectile', { element: 'lightning', speed: 900 });
  const log = s.node('log', { msg: 'Escalation stack' });
  s.flow(cast, 'then', inc);
  s.flow(inc, 'then', bolt);
  s.flow(bolt, 'then', log);
  s.data(inc, 'value', mod, 'a');
  s.data(mod, 'r', dm, 'a');
  s.data(dm, 'r', dmg, 'a');
  s.data(dmg, 'r', bolt, 'damage');
  s.data(mod, 'r', sz, 'a');
  s.data(sz, 'r', size, 'a');
  s.data(size, 'r', bolt, 'size');
  s.data(mod, 'r', log, 'value');
  add('Persistent variable scales each cast', 'training', s);
}

// ── Seeker Lances (for each) ─────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_lances', 'Seeker Lances', 'lightning', 'Locks onto up to five foes near the cursor and spears each one with its own beam.', ['loops', 'beam']);
  const cast = s.node('onCast');
  const find = s.node('findInRadius', { filter: 'hostile', radius: 280, max: 5 });
  const each = s.node('forEach');
  const dir = s.node('direction');
  const len = s.node('add', { b: 30 });
  const lance = s.node('beam', { element: 'lightning', duration: 0.35, dps: 70, width: 8, follow: false, pierce: true });
  s.flow(cast, 'then', each);
  s.data(find, 'list', each, 'list');
  s.flow(each, 'body', lance);
  s.data(each, 'item', dir, 'to');
  s.data(dir, 'dir', lance, 'dir');
  s.data(dir, 'dist', len, 'a');
  s.data(len, 'r', lance, 'length');
  add('Find → for each → beam to target', 'gauntlet', s);
}

// ── Mirror Shards (duplicate) ────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_mirror', 'Mirror Shards', 'ice', 'A single shard that splits into five mirror images mid-flight — each copy keeps the shard\'s own On Hit frost burst.', ['duplicate', 'ice']);
  const cast = s.node('onCast');
  const shard = s.node('projectile', { element: 'ice', speed: 620, size: 7, damage: 10, life: 1.5 });
  const wait = s.node('delay', { seconds: 0.25 });
  const dup = s.node('duplicate', { count: 4, spread: 60 });
  const frost = s.node('explosion', { element: 'ice', radius: 55, damage: 10, force: 120 });
  s.flow(cast, 'then', shard);
  s.flow(shard, 'then', wait);
  s.flow(wait, 'then', dup);
  s.data(shard, 'projectile', dup, 'e');
  s.flow(shard, 'onHit', frost);
  s.data(shard, 'point', frost, 'center');
  add('Projectile → delay → duplicate (hooks copied)', 'elements', s);
}

// ── Magnet & Hammer ──────────────────────────────────────────────────────────
{
  const s = new SpellBuilder('ex_magnet', 'Magnet & Hammer', 'force', 'An attraction field gathers everything into a clump, then a hammer blow scatters it.', ['force', 'timing']);
  const cast = s.node('onCast');
  const mag = s.node('field', { kind: 'attract', element: 'force', radius: 230, strength: 1400, duration: 1.5 });
  const wait = s.node('delay', { seconds: 1.4 });
  const hammer = s.node('explosion', { element: 'force', radius: 140, damage: 30, force: 1300 });
  s.flow(cast, 'then', mag);
  s.flow(mag, 'then', wait);
  s.flow(wait, 'then', hammer);
  add('Attract → delay → explosion', 'physics', s);
}

// ── Grand Ritual (spells casting spells) ─────────────────────────────────────
{
  const s = new SpellBuilder('ex_ritual', 'Grand Ritual', 'arcane', 'Casts your Fireball spell at three points around the cursor, then finishes with Chain Lightning. Spells triggering spells.', ['composition', 'cast spell']);
  const cast = s.node('onCast');
  const ring = s.node('radial', { count: 3, spread: 360 });
  const pt = s.node('offset', { d: 150 });
  const fb = s.node('castSpell', { spell: 'ex_fireball' });
  const cl = s.node('castSpell', { spell: 'ex_chain' });
  s.flow(cast, 'then', ring);
  s.flow(ring, 'body', fb);
  s.data(cast, 'target', pt, 'p');
  s.data(ring, 'direction', pt, 'dir');
  s.data(pt, 'r', fb, 'target');
  s.flow(ring, 'done', cl);
  add('Cast Spell ×3 → Cast Spell', 'horde', s);
}

export const EXAMPLES: Example[] = examples;

export function exampleById(id: string): Example | undefined {
  return examples.find((e) => e.id === id);
}
