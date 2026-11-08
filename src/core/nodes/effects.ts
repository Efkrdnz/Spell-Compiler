import { COSTS } from '../costs';
import { V, clamp, type Element, type EntityId, type Vec } from '../types';
import type { FieldKind, SummonKind } from '../../sim/entity';
import {
  barrier,
  castBeam,
  chain,
  conjure,
  createField,
  duplicate,
  impulse,
  paintTerrain,
  radialImpulse,
  shield,
  spawnProjectile,
  summon,
  teleport,
  transmute,
  type TransmuteInto,
} from '../../sim/magic';
import { MAT_NAMES } from '../../sim/terrain';
import { P, type ExecCtx, type NodeDef, type PortDef } from './defs';

/** Push a spawn point out of the caster's body so spells don't start inside you. */
function clearOfCaster(c: ExecCtx, p: Vec, dir: Vec, size: number): Vec {
  const caster = c.world.get(c.casterId);
  if (!caster) return p;
  if (V.dist(p, caster.pos) < caster.r + size) return V.add(caster.pos, V.scale(V.norm(dir), caster.r + size + 2));
  return p;
}

const livingEnts = (c: ExecCtx, port: string) => c.ents(port).map((id) => c.world.get(id)).filter((e): e is NonNullable<typeof e> => !!e);

const pointOut = (scope: string[]): PortDef => P.out('point', 'Point', 'vector', { scope, eventKey: 'pos' });

export const EFFECT_NODES: NodeDef[] = [
  // ── Projectiles ───────────────────────────────────────────────────────────
  {
    type: 'projectile',
    title: 'Projectile',
    category: 'projectile',
    icon: '➹',
    cost: 2,
    keywords: ['bolt', 'missile', 'fireball', 'shoot'],
    description: 'Launches a projectile. On Hit fires for every impact; On Expire when it ends for any reason.',
    manaHint: '2 + dmg×0.11 + size×0.08 + life×0.35 + pierce/bounce',
    estimate: (v) => COSTS.projectile(Number(v('damage') ?? 20), Number(v('size') ?? 8), Number(v('life') ?? 2), Number(v('pierce') ?? 0), Number(v('bounces') ?? 0), 0),
    params: [{ id: 'tick', label: 'Tick every (s)', kind: 'number', default: 0.25, min: 0.05, max: 5, step: 0.05 }],
    inputs: [
      P.exec(),
      P.vec('origin', 'Origin', 'casterPos'),
      P.vec('dir', 'Direction', 'aim'),
      P.elem('element', 'Element', 'arcane'),
      P.num('speed', 'Speed', 650, { min: 0, max: 3000, step: 10 }),
      P.num('size', 'Size', 8, { min: 2, max: 60 }),
      P.num('damage', 'Damage', 20, { min: 0 }),
      P.num('life', 'Lifetime', 2, { min: 0.05, max: 30, step: 0.1 }),
      P.num('pierce', 'Pierce', 0, { min: 0, max: 20, step: 1 }),
      P.num('bounces', 'Bounces', 0, { min: 0, max: 20, step: 1 }),
    ],
    outputs: [
      P.then(),
      P.out('projectile', 'Projectile', 'entity', { eventKey: 'self' }),
      P.event('onHit', 'On Hit', 'Fires every time the projectile strikes something.'),
      P.event('onExpire', 'On Expire', 'Fires when the projectile ends: impact, timeout or destruction.'),
      P.event('onTick', 'On Tick', 'Fires periodically while in flight.'),
      pointOut(['onHit', 'onExpire', 'onTick']),
      P.out('hitEntity', 'Hit Entity', 'entity', { scope: ['onHit'], eventKey: 'target' }),
      P.out('normal', 'Surface Normal', 'vector', { scope: ['onHit'], eventKey: 'normal' }),
    ],
    exec: (c) => {
      const dmg = Math.max(0, c.num('damage'));
      const size = clamp(c.num('size'), 2, 60);
      const life = clamp(c.num('life'), 0.05, 30);
      const pierce = clamp(Math.floor(c.num('pierce')), 0, 20);
      const bounces = clamp(Math.floor(c.num('bounces')), 0, 20);
      if (c.charge(COSTS.projectile(dmg, size, life, pierce, bounces, 0), 'projectile')) {
        const dir = c.vec('dir');
        const e = spawnProjectile(c.world, {
          pos: clearOfCaster(c, c.vec('origin'), dir, size),
          dir,
          speed: c.num('speed'),
          size,
          damage: dmg,
          element: c.elem('element'),
          life,
          pierce,
          bounces,
          ownerId: c.casterId,
          instance: c.inst.id,
          tickInterval: c.connected('onTick') ? c.param<number>('tick') : 0,
          knockback: c.elem('element') === 'force' ? 380 : 90,
        });
        if (!e) c.fizzle('Entity cap reached — projectile not created');
        else {
          c.set('projectile', e.id);
          c.attach(e, { hit: 'onHit', expire: 'onExpire', tick: 'onTick' });
        }
      }
      c.fire('then');
    },
  },
  {
    type: 'homing',
    title: 'Homing',
    category: 'projectile',
    icon: '⌁',
    cost: 1,
    keywords: ['seek', 'track', 'guided'],
    description: 'Makes projectiles steer toward a target (or auto-acquire the nearest foe). Turn rate in radians/s.',
    manaHint: '1.5 + turn×0.25 per projectile',
    inputs: [P.exec(), P.ents('proj', 'Projectiles'), P.ent('target', 'Target', 'none'), P.num('turn', 'Turn rate', 5, { min: 0, max: 40, step: 0.5 })],
    outputs: [P.then()],
    exec: (c) => {
      const turn = clamp(c.num('turn'), 0, 40);
      const tgt = c.ent('target');
      for (const e of livingEnts(c, 'proj')) {
        if (!e.proj) continue;
        if (!c.charge(1.5 + turn * 0.25, 'homing')) break;
        e.proj.homingStrength = turn;
        e.proj.homingTarget = tgt;
      }
      c.fire('then');
    },
  },
  {
    type: 'modifyProjectile',
    title: 'Empower Projectile',
    category: 'projectile',
    icon: '⇮',
    cost: 1,
    keywords: ['speed', 'damage', 'size', 'scale', 'modifier', 'accelerate'],
    description: 'Multiplies the speed, damage and size of projectiles in flight; adds pierce and bounces.',
    manaHint: 'scales with the increase',
    inputs: [
      P.exec(),
      P.ents('proj', 'Projectiles'),
      P.num('speed', 'Speed ×', 1, { step: 0.1 }),
      P.num('damage', 'Damage ×', 1.5, { step: 0.1 }),
      P.num('size', 'Size ×', 1, { step: 0.1 }),
      P.num('pierce', '+ Pierce', 0, { step: 1 }),
      P.num('bounces', '+ Bounces', 0, { step: 1 }),
    ],
    outputs: [P.then()],
    exec: (c) => {
      const sm = clamp(c.num('speed'), 0, 10);
      const dm = clamp(c.num('damage'), 0, 20);
      const zm = clamp(c.num('size'), 0.1, 10);
      for (const e of livingEnts(c, 'proj')) {
        if (!e.proj) continue;
        const cost = 0.5 + Math.max(0, dm - 1) * e.proj.damage * 0.1 + Math.max(0, zm - 1) * e.r * 0.1 + Math.max(0, sm - 1) * 0.5 + Math.max(0, c.num('pierce')) * 1.5 + Math.max(0, c.num('bounces')) * 0.8;
        if (!c.charge(cost, 'empower')) break;
        e.vel = V.scale(e.vel, sm);
        e.proj.speed *= sm;
        e.proj.damage *= dm;
        e.r = clamp(e.r * zm, 2, 80);
        e.proj.pierce = clamp(e.proj.pierce + Math.floor(c.num('pierce')), 0, 40);
        e.proj.bounces = clamp(e.proj.bounces + Math.floor(c.num('bounces')), 0, 40);
      }
      c.fire('then');
    },
  },

  // ── Beams & areas ─────────────────────────────────────────────────────────
  {
    type: 'beam',
    title: 'Beam',
    category: 'area',
    icon: '═',
    cost: 2,
    keywords: ['laser', 'ray', 'channel'],
    description: 'A continuous beam that damages everything along it. Stops at walls unless Pierce.',
    manaHint: '3 + dps×duration×0.09 + length×0.004',
    estimate: (v) => COSTS.beam(Number(v('dps') ?? 80), Number(v('duration') ?? 0.6), Number(v('length') ?? 700), Number(v('width') ?? 14)),
    inputs: [
      P.exec(),
      P.vec('origin', 'Origin', 'casterPos'),
      P.vec('dir', 'Direction', 'aim'),
      P.elem('element', 'Element', 'arcane'),
      P.num('length', 'Length', 700, { min: 10 }),
      P.num('width', 'Width', 14, { min: 2, max: 120 }),
      P.num('duration', 'Duration', 0.6, { min: 0.05, max: 20, step: 0.05 }),
      P.num('dps', 'Damage/s', 80, { min: 0 }),
      P.bool('pierce', 'Pierce', false),
      P.bool('follow', 'Follow caster', true),
    ],
    outputs: [
      P.then(),
      P.out('beam', 'Beam', 'entity', { eventKey: 'self' }),
      P.event('onHit', 'On Hit', 'Fires once per entity touched by the beam.'),
      P.event('onEnd', 'On End', 'Fires when the beam ends, at its end point.'),
      pointOut(['onHit', 'onEnd']),
      P.out('hitEntity', 'Hit Entity', 'entity', { scope: ['onHit'], eventKey: 'target' }),
    ],
    exec: (c) => {
      const dps = Math.max(0, c.num('dps'));
      const dur = clamp(c.num('duration'), 0.05, 20);
      const len = clamp(c.num('length'), 10, 2400);
      const w = clamp(c.num('width'), 2, 120);
      if (c.charge(COSTS.beam(dps, dur, len, w), 'beam')) {
        const dir = c.vec('dir');
        const caster = c.world.get(c.casterId);
        const origin = clearOfCaster(c, c.vec('origin'), dir, 4);
        const follow = c.bool('follow') && !!caster && V.dist(origin, caster.pos) <= caster.r + 8;
        const e = castBeam(c.world, { pos: origin, dir, length: len, width: w, duration: dur, dps, element: c.elem('element'), pierce: c.bool('pierce'), follow, ownerId: c.casterId, instance: c.inst.id });
        if (!e) c.fizzle('Entity cap reached — beam not created');
        else {
          c.set('beam', e.id);
          c.attach(e, { hit: 'onHit', expire: 'onEnd' });
        }
      }
      c.fire('then');
    },
  },
  {
    type: 'explosion',
    title: 'Explosion',
    category: 'area',
    icon: '✹',
    cost: 2,
    keywords: ['detonate', 'blast', 'nova', 'boom'],
    description: 'Instant blast: damages and knocks back everything in the radius. Ignites, freezes or electrifies terrain by element.',
    manaHint: '3 + radius×0.028 + dmg×0.1 + force×0.0025',
    estimate: (v) => COSTS.explosion(Number(v('radius') ?? 100), Number(v('damage') ?? 40), Number(v('force') ?? 500)),
    inputs: [
      P.exec(),
      P.vec('center', 'Center', 'target'),
      P.elem('element', 'Element', 'fire'),
      P.num('radius', 'Radius', 100, { min: 5, max: 600 }),
      P.num('damage', 'Damage', 40, { min: 0 }),
      P.num('force', 'Force', 500),
    ],
    outputs: [P.then(), P.out('hits', 'Hit', 'entities'), P.out('count', 'Hit count', 'number')],
    exec: (c) => {
      const r = clamp(c.num('radius'), 5, 600);
      const dmg = Math.max(0, c.num('damage'));
      const f = clamp(c.num('force'), -4000, 4000);
      if (c.charge(COSTS.explosion(r, dmg, f), 'explosion')) {
        const hits = c.world.explode(c.vec('center'), r, dmg, c.elem('element'), f, c.inst.id);
        c.set('hits', hits.map((e) => e.id));
        c.set('count', hits.length);
      } else {
        c.set('hits', []);
        c.set('count', 0);
      }
      c.fire('then');
    },
  },
  {
    type: 'field',
    title: 'Force Field',
    category: 'force',
    icon: '◉',
    cost: 2.5,
    keywords: ['gravity', 'well', 'black hole', 'vortex', 'repel', 'attract', 'stasis', 'zone', 'aura', 'area'],
    description: 'A lasting field. Gravity/Attract pull, Repel pushes, Vortex swirls, Stasis slows time, Zone just applies damage/healing.',
    manaHint: '3 + radius×duration + strength×duration + dps×duration',
    estimate: (v) => COSTS.field(Number(v('radius') ?? 140), Number(v('strength') ?? 900), Number(v('duration') ?? 3), Number(v('dps') ?? 0)),
    params: [
      {
        id: 'kind',
        label: 'Kind',
        kind: 'enum',
        default: 'gravity',
        options: [
          { value: 'gravity', label: 'Gravity well' },
          { value: 'attract', label: 'Attract' },
          { value: 'repel', label: 'Repel' },
          { value: 'vortex', label: 'Vortex' },
          { value: 'stasis', label: 'Stasis' },
          { value: 'zone', label: 'Elemental zone' },
        ],
      },
      { id: 'tick', label: 'Tick every (s)', kind: 'number', default: 0.5, min: 0.05, max: 10, step: 0.05 },
    ],
    inputs: [
      P.exec(),
      P.vec('center', 'Center', 'target'),
      P.elem('element', 'Element', 'void'),
      P.num('radius', 'Radius', 140, { min: 8, max: 900 }),
      P.num('strength', 'Strength', 900),
      P.num('duration', 'Duration', 3, { min: 0.05, max: 60, step: 0.1 }),
      P.num('dps', 'Damage/s', 0, { min: 0 }),
      P.bool('projectiles', 'Bends projectiles', true),
      P.ent('follow', 'Attach to', 'none'),
    ],
    outputs: [
      P.then(),
      P.out('field', 'Field', 'entity', { eventKey: 'self' }),
      P.event('onEnter', 'On Enter', 'Fires when something enters the field.'),
      P.event('onTick', 'On Tick', 'Fires every Tick seconds while the field lives.'),
      P.event('onExpire', 'On Expire', 'Fires when the field collapses.'),
      pointOut(['onEnter', 'onTick', 'onExpire']),
      P.out('entered', 'Entered', 'entity', { scope: ['onEnter'], eventKey: 'target' }),
    ],
    exec: (c) => {
      const r = clamp(c.num('radius'), 8, 900);
      const s = clamp(c.num('strength'), -20000, 20000);
      const d = clamp(c.num('duration'), 0.05, 60);
      const dps = Math.max(0, c.num('dps'));
      if (c.charge(COSTS.field(r, s, d, dps), 'field')) {
        const e = createField(c.world, {
          pos: c.vec('center'),
          kind: String(c.param('kind')) as FieldKind,
          radius: r,
          strength: s,
          duration: d,
          dps,
          element: c.elem('element'),
          affectsProjectiles: c.bool('projectiles'),
          follow: c.ent('follow'),
          ownerId: c.casterId,
          instance: c.inst.id,
          tickInterval: c.connected('onTick') ? clamp(c.param<number>('tick'), 0.05, 10) : 0,
        });
        if (!e) c.fizzle('Entity cap reached — field not created');
        else {
          c.set('field', e.id);
          c.attach(e, { enter: 'onEnter', tick: 'onTick', expire: 'onExpire' });
        }
      }
      c.fire('then');
    },
  },
  {
    type: 'radialForce',
    title: 'Shockwave',
    category: 'force',
    icon: '◌',
    cost: 1.5,
    keywords: ['push', 'pull', 'knockback', 'impulse', 'repulse', 'implode'],
    description: 'An instant radial impulse. Positive pushes away, negative pulls in.',
    manaHint: '1 + radius×0.008 + |strength|×0.0018',
    estimate: (v) => COSTS.force(Number(v('radius') ?? 160), Number(v('strength') ?? 700)),
    inputs: [P.exec(), P.vec('center', 'Center', 'target'), P.num('radius', 'Radius', 160, { min: 5 }), P.num('strength', 'Strength', 700), P.bool('projectiles', 'Affect projectiles', true)],
    outputs: [P.then(), P.out('hits', 'Affected', 'entities')],
    exec: (c) => {
      const r = clamp(c.num('radius'), 5, 900);
      const s = clamp(c.num('strength'), -5000, 5000);
      const caster = c.casterId;
      const proj = c.bool('projectiles');
      if (c.charge(COSTS.force(r, s), 'shockwave')) {
        const hits = radialImpulse(c.world, c.vec('center'), r, s, (e) => e.id !== caster && (proj || e.kind !== 'projectile'));
        c.set('hits', hits.map((e) => e.id));
      } else c.set('hits', []);
      c.fire('then');
    },
  },
  {
    type: 'push',
    title: 'Apply Force',
    category: 'force',
    icon: '⇉',
    cost: 1,
    keywords: ['launch', 'throw', 'knockback', 'velocity'],
    description: 'Gives entities an impulse in a direction (or sets their velocity outright).',
    params: [
      {
        id: 'mode',
        label: 'Mode',
        kind: 'enum',
        default: 'add',
        options: [
          { value: 'add', label: 'Add impulse' },
          { value: 'set', label: 'Set velocity' },
        ],
      },
    ],
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.vec('dir', 'Direction', 'aim'), P.num('strength', 'Strength', 600)],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const s = clamp(c.num('strength'), -5000, 5000);
      if (c.charge(COSTS.push(ents.length, s), 'force')) {
        const d = V.norm(c.vec('dir'));
        for (const e of ents) {
          if (c.param('mode') === 'set') {
            if (e.invMass > 0 || e.kind === 'projectile') e.vel = V.scale(d, s);
          } else impulse(e, d, s);
        }
      }
      c.fire('then');
    },
  },
  {
    type: 'orbit',
    title: 'Orbit',
    category: 'force',
    icon: '☉',
    cost: 1.5,
    keywords: ['circle', 'spin', 'satellite', 'around'],
    description: 'Makes entities circle an anchor (entity or point). They are released tangentially when it ends.',
    manaHint: '1 + duration×0.2 per entity',
    inputs: [
      P.exec(),
      P.ents('targets', 'Orbiters'),
      P.ent('anchor', 'Anchor', 'caster'),
      P.vec('point', 'Or point', 'target'),
      P.num('radius', 'Radius', 70, { min: 5 }),
      P.num('speed', 'Speed °/s', 240),
      P.num('duration', 'Duration', 4, { min: 0.1, max: 60 }),
    ],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const anchorId = c.ent('anchor');
      const anchor = c.world.get(anchorId);
      const center = anchor ? V.copy(anchor.pos) : c.vec('point');
      const dur = clamp(c.num('duration'), 0.1, 60);
      const r = clamp(c.num('radius'), 5, 800);
      const n = ents.length;
      ents.forEach((e, i) => {
        if (e.kind === 'caster' || e.invMass <= 0 && e.kind !== 'projectile') return;
        if (!c.charge(COSTS.orbit(dur), 'orbit')) return;
        const base = Math.atan2(e.pos.y - center.y, e.pos.x - center.x);
        const ang = n > 1 && V.dist(e.pos, center) < 4 ? (i / n) * Math.PI * 2 : base;
        e.orbit = { anchor: anchor ? anchorId : 0, center, radius: r, angle: ang, angVel: (c.num('speed') * Math.PI) / 180, life: dur };
        if (e.proj) e.proj.life = Math.max(e.proj.life, dur + 0.5);
      });
      c.fire('then');
    },
  },

  // ── Space ─────────────────────────────────────────────────────────────────
  {
    type: 'teleport',
    title: 'Teleport',
    category: 'transform',
    icon: '⟿',
    cost: 2,
    keywords: ['blink', 'warp', 'move'],
    description: 'Instantly moves an entity (default: you) to a destination.',
    manaHint: '3 + distance×0.008',
    inputs: [P.exec(), P.ent('who', 'Entity', 'caster'), P.vec('to', 'Destination', 'target')],
    outputs: [P.then(), P.out('from', 'Departed from', 'vector'), P.out('arrived', 'Arrived at', 'vector')],
    exec: (c) => {
      const e = c.world.get(c.ent('who'));
      const to = c.vec('to');
      if (e && c.charge(COSTS.teleport(V.dist(e.pos, to)), 'teleport')) {
        c.set('from', V.copy(e.pos));
        c.set('arrived', V.copy(teleport(c.world, e, to, 'arcane')));
      } else {
        c.set('from', to);
        c.set('arrived', to);
      }
      c.fire('then');
    },
  },
  {
    type: 'swap',
    title: 'Swap Places',
    category: 'transform',
    icon: '⇆',
    cost: 2,
    description: 'Two entities trade positions.',
    inputs: [P.exec(), P.ent('a', 'A', 'caster'), P.ent('b', 'B')],
    outputs: [P.then()],
    exec: (c) => {
      const a = c.world.get(c.ent('a'));
      const b = c.world.get(c.ent('b'));
      if (a && b && a !== b && c.charge(COSTS.teleport(V.dist(a.pos, b.pos)), 'swap')) {
        const pa = V.copy(a.pos);
        const pb = V.copy(b.pos);
        teleport(c.world, a, pb, 'void');
        teleport(c.world, b, pa, 'void');
      }
      c.fire('then');
    },
  },
  {
    type: 'duplicate',
    title: 'Duplicate',
    category: 'transform',
    icon: '❐',
    cost: 2,
    keywords: ['clone', 'split', 'copy', 'multiply'],
    description: 'Clones an entity N times — projectiles fan out by Spread and keep their event hooks.',
    manaHint: 'per copy: 1.2 + the original effect',
    inputs: [P.exec(), P.ent('e', 'Entity'), P.num('count', 'Copies', 2, { min: 1, max: 32, step: 1 }), P.num('spread', 'Spread °', 40)],
    outputs: [P.then(), P.out('copies', 'Copies', 'entities')],
    exec: (c) => {
      const e = c.world.get(c.ent('e'));
      const n = clamp(Math.floor(c.num('count')), 0, 32);
      let out: EntityId[] = [];
      if (e) {
        const kindCost = e.proj ? COSTS.projectile(e.proj.damage, e.r, e.proj.life, e.proj.pierce, e.proj.bounces, e.proj.homingStrength) : e.field ? 6 : e.summon ? 8 : 3;
        if (c.charge(COSTS.duplicate(n, kindCost), 'duplicate')) out = duplicate(c.world, e, n, c.num('spread'), c.inst.id).map((x) => x.id);
      }
      c.set('copies', out);
      c.fire('then');
    },
  },
  {
    type: 'transmute',
    title: 'Transmute',
    category: 'transform',
    icon: '⚗',
    cost: 2.5,
    keywords: ['polymorph', 'sheep', 'transform', 'change', 'convert'],
    description: 'Turns foes into sheep (temporarily), matter into crates/barrels/ice/boulders, or re-elements spells.',
    manaHint: '4 + duration×0.3 per target',
    params: [
      {
        id: 'into',
        label: 'Into',
        kind: 'enum',
        default: 'sheep',
        options: [
          { value: 'sheep', label: 'Sheep (living)' },
          { value: 'barrel', label: 'Explosive barrel' },
          { value: 'iceblock', label: 'Ice block' },
          { value: 'crate', label: 'Crate' },
          { value: 'boulder', label: 'Boulder' },
          { value: 'element', label: 'Change element' },
        ],
      },
    ],
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('duration', 'Duration', 5, { min: 0.5, max: 60 }), P.elem('element', 'Element', 'arcane')],
    outputs: [P.then(), P.out('results', 'Results', 'entities', { doc: 'The transmuted entities (material changes create new ones).' }), P.out('changed', 'Changed', 'number')],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const dur = clamp(c.num('duration'), 0.5, 60);
      const out: EntityId[] = [];
      for (const e of ents) {
        if (!c.charge(COSTS.transmute(1, dur), 'transmute')) break;
        const r = transmute(c.world, e, String(c.param('into')) as TransmuteInto, dur, c.elem('element'));
        if (r) out.push(r.id);
      }
      c.set('results', out);
      c.set('changed', out.length);
      c.fire('then');
    },
  },
  {
    type: 'scale',
    title: 'Resize',
    category: 'transform',
    icon: '⤢',
    cost: 1.5,
    keywords: ['grow', 'shrink', 'enlarge', 'giant'],
    description: 'Scales entities (size, mass and, for projectiles, damage).',
    manaHint: '2 + growth per target',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('factor', 'Factor', 1.6, { min: 0.1, max: 6, step: 0.1 })],
    outputs: [P.then()],
    exec: (c) => {
      const f = clamp(c.num('factor'), 0.1, 6);
      for (const e of livingEnts(c, 'targets')) {
        if (e.kind === 'caster' || e.kind === 'pillar' || e.kind === 'beam') continue;
        if (!c.charge(2 + Math.abs(f - 1) * e.r * 0.15, 'resize')) break;
        e.r = clamp(e.r * f, 2, 160);
        e.hw = clamp(e.hw * f, 2, 200);
        e.hh = clamp(e.hh * f, 2, 200);
        if (e.shape === 'box') e.r = Math.hypot(e.hw, e.hh);
        e.scale *= f;
        if (e.invMass > 0) e.invMass /= f * f;
        if (e.field) e.field.radius = clamp(e.field.radius, 8, 900);
        c.world.emit({ type: 'transmute', pos: V.copy(e.pos), radius: e.r * 1.4, element: 'arcane' });
      }
      c.fire('then');
    },
  },
  {
    type: 'destroy',
    title: 'Dispel',
    category: 'transform',
    icon: '⊘',
    cost: 1,
    keywords: ['destroy', 'end', 'remove', 'kill', 'cancel'],
    description: 'Ends spell entities early (their On Expire fires). Living things and props take 9999 arcane damage.',
    inputs: [P.exec(), P.ents('targets', 'Targets')],
    outputs: [P.then()],
    exec: (c) => {
      for (const e of livingEnts(c, 'targets')) {
        if (e.kind === 'caster') continue;
        if (e.proj) c.world.endProjectile(e);
        else if (e.field) e.field.life = 0;
        else if (e.beam) e.beam.life = 0;
        else if (e.summon) e.summon.life = 0;
        else if (c.charge(6, 'dispel')) c.world.damage(e, 9999, 'arcane', c.inst.id);
      }
      c.fire('then');
    },
  },

  // ── Elements ──────────────────────────────────────────────────────────────
  {
    type: 'damage',
    title: 'Damage',
    category: 'element',
    icon: '⚔',
    cost: 1,
    keywords: ['hurt', 'smite', 'strike'],
    description: 'Deals elemental damage directly (element reactions apply).',
    manaHint: '0.5 + per target (0.6 + dmg×0.06)',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('amount', 'Amount', 25, { min: 0 }), P.elem('element', 'Element', 'arcane')],
    outputs: [P.then(), P.out('dealt', 'Dealt', 'number')],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const amt = Math.max(0, c.num('amount'));
      let total = 0;
      if (c.charge(COSTS.status(ents.length, amt), 'damage'))
        for (const e of ents) {
          total += c.world.damage(e, amt, c.elem('element'), c.inst.id);
          c.world.emit({ type: 'hit', pos: V.copy(e.pos), element: c.elem('element'), dir: { x: 0, y: -1 }, amount: amt });
        }
      c.set('dealt', total);
      c.fire('then');
    },
  },
  {
    type: 'ignite',
    title: 'Ignite',
    category: 'element',
    icon: '🜂',
    element: 'fire',
    cost: 1,
    keywords: ['burn', 'fire'],
    description: 'Sets targets ablaze. Burning spreads to flammable neighbours and grass. Water puts it out.',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('duration', 'Duration', 4, { min: 0.1 }), P.num('dps', 'Burn/s', 10, { min: 0 })],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const dps = Math.max(0, c.num('dps'));
      const d = clamp(c.num('duration'), 0.1, 30);
      if (c.charge(COSTS.status(ents.length, dps * d * 0.2), 'ignite')) for (const e of ents) c.world.ignite(e, d, dps);
      c.fire('then');
    },
  },
  {
    type: 'freeze',
    title: 'Freeze',
    category: 'element',
    icon: '❄',
    element: 'ice',
    cost: 1,
    keywords: ['ice', 'frost', 'stun', 'chill'],
    description: 'Encases targets in ice: immobile, and shattered by force/arcane/void hits for bonus damage.',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('duration', 'Duration', 2.5, { min: 0.1 })],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const d = clamp(c.num('duration'), 0.1, 20);
      if (c.charge(COSTS.status(ents.length, d * 2), 'freeze'))
        for (const e of ents) {
          c.world.freezeEntity(e, d);
          c.world.elementOnTerrain(e.pos, e.r + 20, 'ice');
        }
      c.fire('then');
    },
  },
  {
    type: 'shock',
    title: 'Shock',
    category: 'element',
    icon: 'ϟ',
    element: 'lightning',
    cost: 1,
    keywords: ['electric', 'zap', 'stun'],
    description: 'Strikes targets with lightning from above: damage + brief stun. Double damage when wet.',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('damage', 'Damage', 20, { min: 0 })],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const dmg = Math.max(0, c.num('damage'));
      if (c.charge(COSTS.status(ents.length, dmg), 'shock'))
        for (const e of ents) {
          const top = { x: e.pos.x + (c.random() - 0.5) * 60, y: e.pos.y - 260 };
          c.world.emit({ type: 'bolt', points: [top, V.lerp(top, e.pos, 0.5), V.copy(e.pos)].map((p, i) => (i === 1 ? V.add(p, { x: (c.random() - 0.5) * 40, y: 0 }) : p)), element: 'lightning', width: 3 });
          c.world.damage(e, dmg, 'lightning', c.inst.id);
          c.world.elementOnTerrain(e.pos, 20, 'lightning');
        }
      c.fire('then');
    },
  },
  {
    type: 'soak',
    title: 'Drench',
    category: 'element',
    icon: '💧',
    element: 'ice',
    cost: 0.5,
    keywords: ['wet', 'water', 'rain'],
    description: 'Makes targets wet: extinguishes fire, halves fire damage, doubles lightning damage.',
    inputs: [P.exec(), P.ents('targets', 'Targets'), P.num('duration', 'Duration', 5, { min: 0.1 })],
    outputs: [P.then()],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      if (c.charge(COSTS.status(ents.length, 1), 'drench'))
        for (const e of ents) {
          e.status.wet = Math.max(e.status.wet, clamp(c.num('duration'), 0.1, 30));
          if (e.status.burning > 0) {
            e.status.burning = 0;
            c.world.emit({ type: 'steam', pos: V.copy(e.pos) });
          }
        }
      c.fire('then');
    },
  },
  {
    type: 'heal',
    title: 'Heal',
    category: 'element',
    icon: '✚',
    element: 'life',
    cost: 1,
    keywords: ['restore', 'cure', 'regen', 'life'],
    description: 'Restores health instantly, plus optional regeneration over time. Cleanses burning and frost.',
    manaHint: '1 + amount×0.12',
    inputs: [P.exec(), P.ents('targets', 'Targets', 'caster'), P.num('amount', 'Amount', 30, { min: 0 }), P.num('regen', 'Regen/s', 0, { min: 0 }), P.num('regenTime', 'Regen time', 3, { min: 0 })],
    outputs: [P.then(), P.out('healed', 'Healed', 'number')],
    exec: (c) => {
      const ents = livingEnts(c, 'targets');
      const amt = Math.max(0, c.num('amount'));
      const regen = Math.max(0, c.num('regen'));
      const rt = clamp(c.num('regenTime'), 0, 30);
      let h = 0;
      if (c.charge(COSTS.heal(amt * ents.length + regen * rt * ents.length), 'heal'))
        for (const e of ents) {
          h += c.world.heal(e, amt, c.inst.id);
          if (regen > 0) {
            e.status.regen = regen;
            e.status.regenTime = rt;
          }
          c.world.emit({ type: 'heal', pos: V.copy(e.pos), radius: e.r * 2 });
        }
      c.set('healed', h);
      c.fire('then');
    },
  },
  {
    type: 'shield',
    title: 'Ward',
    category: 'element',
    icon: '⛨',
    element: 'force',
    cost: 1,
    keywords: ['shield', 'protect', 'absorb', 'armor'],
    description: 'Wraps targets in a shield that absorbs damage for a while.',
    manaHint: '1.5 + amount×0.08 + duration×0.3',
    inputs: [P.exec(), P.ents('targets', 'Targets', 'caster'), P.num('amount', 'Absorb', 60, { min: 0 }), P.num('duration', 'Duration', 6, { min: 0.1 })],
    outputs: [P.then()],
    exec: (c) => {
      const amt = Math.max(0, c.num('amount'));
      const d = clamp(c.num('duration'), 0.1, 60);
      for (const e of livingEnts(c, 'targets')) {
        if (!c.charge(COSTS.shield(amt, d), 'ward')) break;
        shield(c.world, e, amt, d);
      }
      c.fire('then');
    },
  },
  {
    type: 'barrier',
    title: 'Barrier Wall',
    category: 'element',
    icon: '▥',
    element: 'force',
    cost: 2,
    keywords: ['wall', 'block', 'cover', 'shield'],
    description: 'Raises a curved wall of force segments that blocks enemies and hostile projectiles.',
    manaHint: '3 + width×0.03 + duration×0.4 + hp×0.02',
    estimate: (v) => COSTS.barrier(Number(v('width') ?? 160), Number(v('duration') ?? 5), Number(v('hp') ?? 120)),
    inputs: [P.exec(), P.vec('center', 'Center', 'target'), P.vec('facing', 'Facing', 'aim'), P.num('width', 'Width', 160, { min: 10, max: 600 }), P.num('duration', 'Duration', 5, { min: 0.5 }), P.num('hp', 'Segment HP', 120, { min: 1 }), P.elem('element', 'Element', 'force')],
    outputs: [P.then(), P.out('segments', 'Segments', 'entities')],
    exec: (c) => {
      const w = clamp(c.num('width'), 10, 600);
      const d = clamp(c.num('duration'), 0.5, 60);
      const hp = Math.max(1, c.num('hp'));
      if (c.charge(COSTS.barrier(w, d, hp), 'barrier')) c.set('segments', barrier(c.world, c.vec('center'), c.vec('facing'), w, d, hp, c.inst.id, c.elem('element')).map((e) => e.id));
      else c.set('segments', []);
      c.fire('then');
    },
  },
  {
    type: 'chain',
    title: 'Chain',
    category: 'element',
    icon: '⚡',
    element: 'lightning',
    cost: 2,
    keywords: ['arc', 'bounce', 'jump', 'lightning'],
    description: 'Arcs from a start point between nearby foes. Conductive metal and wet targets extend the reach. Each Hop runs per jump.',
    manaHint: '2 + jumps×(1 + dmg×0.05)',
    estimate: (v) => COSTS.chain(Number(v('jumps') ?? 5), Number(v('damage') ?? 25)),
    inputs: [P.exec(), P.vec('start', 'Start', 'casterPos'), P.ent('first', 'First target', 'none'), P.num('jumps', 'Jumps', 5, { min: 1, max: 40, step: 1 }), P.num('range', 'Range', 200, { min: 10 }), P.num('damage', 'Damage', 25, { min: 0 }), P.elem('element', 'Element', 'lightning')],
    outputs: [
      P.then('hop', 'Each Hop'),
      P.out('hopEntity', 'Hop target', 'entity', { scope: ['hop'] }),
      P.out('hopPoint', 'Hop point', 'vector', { scope: ['hop'] }),
      P.out('hopIndex', 'Hop #', 'number', { scope: ['hop'] }),
      P.then('done', 'Done'),
      P.out('hits', 'All hit', 'entities'),
    ],
    exec: (c) => {
      const jumps = clamp(Math.floor(c.num('jumps')), 1, 40);
      const dmg = Math.max(0, c.num('damage'));
      let hops: ReturnType<typeof chain> = [];
      if (c.charge(COSTS.chain(jumps, dmg), 'chain')) {
        const start = c.vec('start');
        const first = c.world.get(c.ent('first'));
        hops = chain(c.world, start, first, jumps, clamp(c.num('range'), 10, 1200), dmg, c.elem('element'), c.inst.id, c.casterId);
      }
      c.set('hits', hops.map((h) => h.entity.id));
      hops.forEach((h, i) => {
        if (!c.budgetOk()) return;
        c.set('hopEntity', h.entity.id);
        c.set('hopPoint', h.to);
        c.set('hopIndex', i);
        c.fire('hop');
      });
      c.fire('done');
    },
  },
  {
    type: 'paint',
    title: 'Shape Terrain',
    category: 'element',
    icon: '▩',
    cost: 1,
    keywords: ['ground', 'oil', 'water', 'lava', 'grass', 'environment', 'terrain'],
    description: 'Paints ground material: water to freeze/electrify, oil and grass to burn, lava, spikes…',
    manaHint: '1 + radius×0.03',
    params: [{ id: 'mat', label: 'Material', kind: 'enum', default: 'oil', options: MAT_NAMES.map((m) => ({ value: m, label: m })) }],
    inputs: [P.exec(), P.vec('center', 'Center', 'target'), P.num('radius', 'Radius', 70, { min: 5, max: 400 })],
    outputs: [P.then()],
    exec: (c) => {
      const r = clamp(c.num('radius'), 5, 400);
      if (c.charge(COSTS.terrain(r), 'terrain')) paintTerrain(c.world, c.vec('center'), r, String(c.param('mat')));
      c.fire('then');
    },
  },

  // ── Summoning ─────────────────────────────────────────────────────────────
  {
    type: 'summon',
    title: 'Summon',
    category: 'summon',
    icon: '♜',
    cost: 3,
    keywords: ['minion', 'turret', 'wisp', 'golem', 'familiar', 'pet'],
    description: 'Summons an ally. Turrets hold position, wisps orbit you, golems hunt. Wire On Attack to program its attack.',
    manaHint: '8 + duration×0.6 + dps×0.25',
    estimate: (v) => COSTS.summon(Number(v('duration') ?? 10), Number(v('damage') ?? 10), Number(v('rate') ?? 0.8)),
    params: [
      {
        id: 'kind',
        label: 'Kind',
        kind: 'enum',
        default: 'turret',
        options: [
          { value: 'turret', label: 'Turret' },
          { value: 'wisp', label: 'Wisp (orbits you)' },
          { value: 'golem', label: 'Golem (melee)' },
        ],
      },
    ],
    inputs: [
      P.exec(),
      P.vec('pos', 'Position', 'target'),
      P.elem('element', 'Element', 'arcane'),
      P.num('duration', 'Duration', 10, { min: 0.5, max: 60 }),
      P.num('damage', 'Damage', 10, { min: 0 }),
      P.num('rate', 'Attack every', 0.8, { min: 0.05, max: 10, step: 0.05 }),
      P.num('range', 'Range', 380, { min: 40 }),
    ],
    outputs: [
      P.then(),
      P.out('summon', 'Summon', 'entity', { eventKey: 'self' }),
      P.event('onAttack', 'On Attack', 'Replaces the default attack. Fires each attack with the chosen target.'),
      P.event('onExpire', 'On Expire', 'Fires when the summon fades.'),
      pointOut(['onAttack', 'onExpire']),
      P.out('target', 'Attack target', 'entity', { scope: ['onAttack'], eventKey: 'target' }),
    ],
    exec: (c) => {
      const d = clamp(c.num('duration'), 0.5, 60);
      const dmg = Math.max(0, c.num('damage'));
      const rate = clamp(c.num('rate'), 0.05, 10);
      if (c.charge(COSTS.summon(d, dmg, rate), 'summon')) {
        const e = summon(c.world, { kind: String(c.param('kind')) as SummonKind, pos: c.vec('pos'), element: c.elem('element') as Element, duration: d, damage: dmg, attackRate: rate, range: c.num('range'), ownerId: c.casterId, instance: c.inst.id });
        if (!e) c.fizzle('Entity cap reached — summon failed');
        else {
          c.set('summon', e.id);
          c.attach(e, { attack: 'onAttack', expire: 'onExpire' });
        }
      }
      c.fire('then');
    },
  },
  {
    type: 'conjure',
    title: 'Conjure Matter',
    category: 'summon',
    icon: '▣',
    cost: 2,
    keywords: ['crate', 'boulder', 'barrel', 'rock', 'create', 'prop'],
    description: 'Materialises a physical object: crate, explosive barrel, boulder, ice block or metal block.',
    manaHint: '4 + lifetime×0.1 (permanent = 10)',
    params: [
      {
        id: 'kind',
        label: 'Kind',
        kind: 'enum',
        default: 'boulder',
        options: ['boulder', 'crate', 'barrel', 'iceblock', 'metal'].map((v) => ({ value: v, label: v })),
      },
    ],
    inputs: [P.exec(), P.vec('pos', 'Position', 'target'), P.num('life', 'Lifetime (0 = ∞)', 0, { min: 0 }), P.vec('vel', 'Velocity', undefined, { x: 0, y: 0 })],
    outputs: [P.then(), P.out('e', 'Object', 'entity')],
    exec: (c) => {
      const life = Math.max(0, c.num('life'));
      if (c.charge(COSTS.conjure(life), 'conjure')) {
        const e = conjure(c.world, String(c.param('kind')) as 'boulder', c.vec('pos'), c.inst.id, life);
        if (e) {
          e.vel = c.vec('vel');
          c.set('e', e.id);
        } else c.fizzle('Entity cap reached — nothing conjured');
      }
      c.fire('then');
    },
  },
];
