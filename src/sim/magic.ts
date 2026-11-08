import { V, clamp, type Element, type EntityId, type Vec } from '../core/types';
import type { Entity, EntityKind, FieldKind, SummonKind, Team } from './entity';
import { Mat, matFromName } from './terrain';
import type { World } from './world';

/**
 * Spell primitives. These are the only way spells change the world; each one
 * returns what it created so the interpreter can wire event hooks onto it.
 * All of them respect world entity caps and return null when saturated.
 */

export interface ProjectileOpts {
  pos: Vec;
  dir: Vec;
  speed: number;
  size: number;
  damage: number;
  element: Element;
  life: number;
  pierce?: number;
  bounces?: number;
  homing?: number;
  homingTarget?: EntityId;
  knockback?: number;
  drag?: number;
  gravity?: number;
  ownerId: EntityId;
  instance: number;
  team?: Team;
  tickInterval?: number;
}

export function spawnProjectile(w: World, o: ProjectileOpts): Entity | null {
  if (!w.canSpawnSpellEntity()) return null;
  const size = clamp(o.size, 2, 60);
  const dir = V.norm(o.dir);
  const speed = clamp(o.speed, 0, 3000);
  const e = w.spawn('projectile', w.clampToArena(o.pos, size), {
    r: size,
    team: o.team ?? 0,
    element: o.element,
    vel: V.scale(dir, speed),
    angle: V.angle(dir),
    ownerId: o.ownerId,
    instance: o.instance,
    proj: {
      damage: Math.max(0, o.damage),
      speed,
      life: clamp(o.life, 0.05, 30),
      maxLife: clamp(o.life, 0.05, 30),
      pierce: Math.max(0, Math.floor(o.pierce ?? 0)),
      bounces: Math.max(0, Math.floor(o.bounces ?? 0)),
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 0,
      knockback: o.knockback ?? 0,
      homingTarget: o.homingTarget ?? 0,
      homingStrength: Math.max(0, o.homing ?? 0),
      hitSet: new Set(),
      ownerGrace: 0.25,
      tickInterval: o.tickInterval ?? 0,
      tickAcc: 0,
    },
  });
  return e;
}

export interface BeamOpts {
  pos: Vec;
  dir: Vec;
  length: number;
  width: number;
  duration: number;
  dps: number;
  element: Element;
  pierce: boolean;
  follow: boolean;
  ownerId: EntityId;
  instance: number;
}

export function castBeam(w: World, o: BeamOpts): Entity | null {
  if (!w.canSpawnSpellEntity()) return null;
  const dir = V.norm(o.dir);
  const length = clamp(o.length, 10, 2400);
  return w.spawn('beam', o.pos, {
    element: o.element,
    ownerId: o.ownerId,
    instance: o.instance,
    beam: {
      dir,
      length,
      width: clamp(o.width, 2, 120),
      life: clamp(o.duration, 0.05, 20),
      maxLife: clamp(o.duration, 0.05, 20),
      dps: Math.max(0, o.dps),
      end: V.add(o.pos, V.scale(dir, length)),
      followCaster: o.follow,
      pierce: o.pierce,
      hitOnce: new Set(),
    },
  });
}

export interface FieldOpts {
  pos: Vec;
  kind: FieldKind;
  radius: number;
  strength: number;
  duration: number;
  dps: number;
  element: Element;
  affectsProjectiles: boolean;
  follow: EntityId;
  ownerId: EntityId;
  instance: number;
  tickInterval?: number;
}

export function createField(w: World, o: FieldOpts): Entity | null {
  if (!w.canSpawnSpellEntity()) return null;
  const radius = clamp(o.radius, 8, 900);
  return w.spawn('field', w.clampToArena(o.pos, 0), {
    r: radius,
    element: o.element,
    ownerId: o.ownerId,
    instance: o.instance,
    field: {
      kind: o.kind,
      radius,
      strength: o.strength,
      life: clamp(o.duration, 0.05, 60),
      maxLife: clamp(o.duration, 0.05, 60),
      dps: Math.max(0, o.dps),
      affectsProjectiles: o.affectsProjectiles,
      inside: new Set(),
      tickInterval: o.tickInterval ?? 0,
      tickAcc: 0,
      followId: o.follow,
    },
  });
}

export function radialImpulse(w: World, p: Vec, radius: number, strength: number, filter: (e: Entity) => boolean = () => true): Entity[] {
  const hit: Entity[] = [];
  for (const e of w.list) {
    if (!e.alive || (e.invMass <= 0 && e.kind !== 'projectile') || e.kind === 'beam' || e.kind === 'field' || !filter(e)) continue;
    const d = V.dist(e.pos, p);
    if (d > radius + e.r) continue;
    const dir = d > 1e-3 ? V.scale(V.sub(e.pos, p), 1 / d) : V.fromAngle(w.random() * 6.283);
    const f = strength * (1 - 0.6 * clamp(d / (radius + e.r), 0, 1)) * (e.kind === 'projectile' ? 1 : Math.min(e.invMass, 1.5));
    e.vel.x += dir.x * f;
    e.vel.y += dir.y * f;
    hit.push(e);
  }
  w.emit({ type: 'shockwave', pos: V.copy(p), radius, element: strength < 0 ? 'void' : 'force' });
  return hit;
}

export function impulse(e: Entity, dir: Vec, strength: number): void {
  if (e.invMass <= 0 && e.kind !== 'projectile') return;
  const d = V.norm(dir);
  const m = e.kind === 'projectile' ? 1 : Math.min(e.invMass, 1.5);
  e.vel.x += d.x * strength * m;
  e.vel.y += d.y * strength * m;
}

export function teleport(w: World, e: Entity, to: Vec, element: Element = 'arcane'): Vec {
  const from = V.copy(e.pos);
  let dest = w.clampToArena(to, e.r + 2);
  // nudge out of static geometry
  for (let k = 0; k < 8; k++) {
    let blocked = false;
    for (const o of w.list) {
      if (!o.alive || o === e || !o.solid || o.invMass > 0) continue;
      const dx = dest.x - o.pos.x;
      const dy = dest.y - o.pos.y;
      if (o.shape === 'circle') {
        const d = Math.hypot(dx, dy);
        if (d < o.r + e.r) {
          dest = V.add(o.pos, V.scale(V.norm({ x: dx, y: dy }), o.r + e.r + 2));
          blocked = true;
        }
      } else if (Math.abs(dx) < o.hw + e.r && Math.abs(dy) < o.hh + e.r) {
        const px = o.hw + e.r - Math.abs(dx);
        const py = o.hh + e.r - Math.abs(dy);
        if (px < py) dest.x += Math.sign(dx || 1) * (px + 2);
        else dest.y += Math.sign(dy || 1) * (py + 2);
        blocked = true;
      }
    }
    if (!blocked) break;
  }
  e.pos = w.clampToArena(dest, e.r + 2);
  if (e.orbit) e.orbit = undefined;
  w.emit({ type: 'teleport', from, to: V.copy(e.pos), element });
  return e.pos;
}

export function duplicate(w: World, e: Entity, count: number, spreadDeg: number, instance: number): Entity[] {
  const out: Entity[] = [];
  const n = clamp(Math.floor(count), 0, 32);
  if (e.kind === 'caster') return out;
  for (let i = 0; i < n; i++) {
    if (!w.canSpawnSpellEntity() && (e.kind === 'projectile' || e.kind === 'field' || e.kind === 'beam')) break;
    if (w.entities.size >= 1400) break;
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = (t - 0.5) * spreadDeg * (Math.PI / 180) || (i + 1) * 0.35;
    const { id: _id, ...rest } = e;
    const clone = w.spawn(e.kind, V.copy(e.pos), {
      ...rest,
      pos: V.copy(e.pos),
      vel: V.rot(e.vel, ang),
      status: { ...e.status },
      hooks: { ...e.hooks },
      resist: { ...e.resist },
      instance: instance || e.instance,
      proj: e.proj ? { ...e.proj, hitSet: new Set(e.proj.hitSet) } : undefined,
      field: e.field ? { ...e.field, inside: new Set() } : undefined,
      beam: e.beam ? { ...e.beam, dir: V.rot(e.beam.dir, ang), hitOnce: new Set() } : undefined,
      ai: e.ai ? { ...e.ai, home: V.copy(e.ai.home), wanderDir: V.copy(e.ai.wanderDir) } : undefined,
      summon: e.summon ? { ...e.summon } : undefined,
      orbit: e.orbit ? { ...e.orbit, angle: e.orbit.angle + ((i + 1) / (n + 1)) * Math.PI * 2 } : undefined,
      respawn: undefined,
    });
    if (e.kind !== 'projectile' && e.kind !== 'beam') {
      const off = V.fromAngle((i / n) * Math.PI * 2 + w.random(), e.r * 2.4 + 6);
      clone.pos = w.clampToArena(V.add(e.pos, off), clone.r);
      if (clone.field) clone.pos = V.add(e.pos, V.fromAngle((i / n) * Math.PI * 2, e.r * 0.8));
    }
    w.emit({ type: 'spawn', pos: V.copy(clone.pos), element: e.element, radius: Math.min(40, e.r * 2) });
    out.push(clone);
  }
  return out;
}

export type TransmuteInto = 'sheep' | 'crate' | 'barrel' | 'iceblock' | 'boulder' | 'element';

/** Returns the transmuted entity (a new one for material changes), or null if immune. */
export function transmute(w: World, e: Entity, into: TransmuteInto, duration: number, element: Element): Entity | null {
  if (!e.alive || e.kind === 'caster' || e.kind === 'pillar') return null;
  if (into === 'element' || e.kind === 'projectile' || e.kind === 'field' || e.kind === 'beam' || e.kind === 'summon') {
    e.element = element;
    w.emit({ type: 'transmute', pos: V.copy(e.pos), radius: Math.max(14, e.r * 1.6), element });
    return e;
  }
  const living = w.isLiving(e);
  if (living && into === 'sheep') {
    if (!e.polyFrom) e.polyFrom = { kind: e.kind, r: e.r, ai: e.ai };
    e.kind = 'sheep';
    e.r = 13;
    e.flammable = true;
    e.status.polymorph = clamp(duration, 0.5, 60);
    e.ai = {
      behavior: 'flee',
      speed: 70,
      home: V.copy(e.pos),
      path: [],
      pathIdx: 0,
      attackCd: 1,
      attackRate: 99,
      attackDamage: 0,
      targetId: 0,
      wanderT: 0,
      wanderDir: V.fromAngle(w.random() * 6.28),
    };
    w.emit({ type: 'transmute', pos: V.copy(e.pos), radius: 30, element: 'arcane' });
    return e;
  }
  // permanent material transmutation
  const kind: EntityKind = into === 'sheep' ? 'sheep' : into;
  const pos = V.copy(e.pos);
  const vel = V.copy(e.vel);
  const hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const respawn = e.respawn;
  w.kill(e, 'arcane');
  w.fx.pop(); // replace the death burst with a transmute flash
  if (w.fx.length && w.fx[w.fx.length - 1].type === 'debris') w.fx.pop();
  w.stats.kills = Math.max(0, w.stats.kills - (living ? 1 : 0));
  const n = w.spawn(kind, pos, { vel, instance: e.instance, respawn });
  n.hp = Math.max(1, n.maxHp * hpFrac);
  if (kind === 'iceblock') n.life = clamp(duration, 1, 60);
  w.emit({ type: 'transmute', pos, radius: 34, element });
  return n;
}

export interface Hop {
  entity: Entity;
  from: Vec;
  to: Vec;
}

/** Arc between nearby targets. Conductive props extend reach; wet targets take double. */
export function chain(w: World, start: Vec, first: Entity | undefined, jumps: number, range: number, damage: number, element: Element, instance: number, ownerId: EntityId): Hop[] {
  const hops: Hop[] = [];
  const visited = new Set<EntityId>([ownerId]);
  let cur = start;
  let next = first && first.alive && first.hittable ? first : w.nearest(start, range, 'hostile', visited);
  const n = clamp(Math.floor(jumps), 1, 40);
  for (let i = 0; i < n && next; i++) {
    visited.add(next.id);
    const to = V.copy(next.pos);
    w.emit({ type: 'bolt', points: jaggedPath(w, cur, to), element, width: element === 'lightning' ? 2.5 : 3 });
    w.damage(next, damage, element, instance);
    hops.push({ entity: next, from: cur, to });
    const reach = next.conductive ? range * 1.6 : next.status.wet > 0 ? range * 1.3 : range;
    cur = to;
    next = w.nearest(cur, reach, 'hostile', visited);
  }
  return hops;
}

export function jaggedPath(w: World, a: Vec, b: Vec): Vec[] {
  const pts: Vec[] = [a];
  const d = V.dist(a, b);
  const segs = clamp(Math.floor(d / 18), 2, 24);
  const perp = V.perp(V.norm(V.sub(b, a)));
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (w.random() - 0.5) * Math.min(40, d * 0.18) * Math.sin(t * Math.PI);
    pts.push(V.add(V.lerp(a, b, t), V.scale(perp, off)));
  }
  pts.push(b);
  return pts;
}

export interface SummonOpts {
  kind: SummonKind;
  pos: Vec;
  element: Element;
  duration: number;
  damage: number;
  attackRate: number;
  range: number;
  ownerId: EntityId;
  instance: number;
}

export function summon(w: World, o: SummonOpts): Entity | null {
  if (!w.canSpawnSpellEntity()) return null;
  const isTurret = o.kind === 'turret';
  const e = w.spawn('summon', w.clampToArena(o.pos, 14), {
    element: o.element,
    ownerId: o.ownerId,
    instance: o.instance,
    r: o.kind === 'golem' ? 18 : o.kind === 'wisp' ? 9 : 14,
    invMass: isTurret ? 0 : o.kind === 'wisp' ? 0 : 0.4,
    hp: o.kind === 'golem' ? 200 : 80,
    solid: o.kind !== 'wisp',
    summon: {
      kind: o.kind,
      life: clamp(o.duration, 0.5, 60),
      maxLife: clamp(o.duration, 0.5, 60),
      attackCd: 0.3,
      attackRate: clamp(o.attackRate, 0.05, 10),
      range: clamp(o.range, 40, 1200),
      damage: Math.max(0, o.damage),
    },
  });
  if (o.kind === 'wisp') {
    const owner = w.get(o.ownerId);
    e.orbit = { anchor: o.ownerId, center: owner ? V.copy(owner.pos) : V.copy(o.pos), radius: 46, angle: w.random() * 6.28, angVel: 2.6, life: 1e9 };
  }
  w.emit({ type: 'spawn', pos: V.copy(e.pos), element: o.element, radius: 40 });
  return e;
}

/** A curved wall of barrier segments perpendicular to `facing`. */
export function barrier(w: World, center: Vec, facing: Vec, width: number, duration: number, hp: number, instance: number, element: Element): Entity[] {
  const out: Entity[] = [];
  const n = clamp(Math.round(width / 22), 1, 24);
  const f = V.norm(facing);
  const side = V.perp(f);
  for (let i = 0; i < n; i++) {
    if (!w.canSpawnSpellEntity()) break;
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const curve = -t * t * width * 0.35;
    const p = V.add(V.add(center, V.scale(side, t * width)), V.scale(f, curve));
    const b = w.spawn('barrier', w.clampToArena(p, 12), { hw: 11, hh: 11, hp, instance, element, life: clamp(duration, 0.5, 60), team: 0 });
    out.push(b);
  }
  w.emit({ type: 'spawn', pos: V.copy(center), element, radius: width * 0.5 });
  return out;
}

export function shield(w: World, e: Entity, amount: number, duration: number): void {
  e.status.shield = Math.max(e.status.shield, amount);
  e.status.shieldTime = Math.max(e.status.shieldTime, duration);
  w.emit({ type: 'shieldHit', pos: V.copy(e.pos), radius: e.r + 10 });
}

export function paintTerrain(w: World, p: Vec, radius: number, material: string): number {
  const m = matFromName(material);
  let n = 0;
  w.terrain.forCircle(p, clamp(radius, 5, 400), (i) => {
    w.terrain.set(i, m, m === Mat.Fire ? 3 + w.random() * 3 : m === Mat.Ice ? 16 : 0);
    n++;
  });
  return n;
}

/** Spawn a physical prop (conjured matter). */
export function conjure(w: World, kind: EntityKind, p: Vec, instance: number, life: number): Entity | null {
  if (w.entities.size >= 1400) return null;
  const e = w.spawn(kind, w.clampToArena(p, 20), { instance });
  if (life > 0) e.life = life;
  w.emit({ type: 'spawn', pos: V.copy(p), element: kind === 'iceblock' ? 'ice' : 'force', radius: e.r * 2 });
  return e;
}
