import { ELEMENTS, V, clamp, type Element, type EntityId, type Value, type Vec } from '../core/types';
import { emptyStatus, type Entity, type EntityKind, type Hook, type Team } from './entity';
import type { FxEvent } from './fx';
import { SpatialHash, collide, rayBox, rayCircle, resolve } from './physics';
import { Mat, Terrain } from './terrain';
import { updateAI, updateSummon } from './ai';

export const ARENA_W = 1600;
export const ARENA_H = 900;
export const MAX_ENTITIES = 1400;
export const MAX_SPELL_ENTITIES = 900;

export type TargetFilter = 'any' | 'enemies' | 'allies' | 'living' | 'props' | 'projectiles' | 'hostile' | 'notSelf';

const LIVING: ReadonlySet<EntityKind> = new Set(['caster', 'dummy', 'enemy', 'target', 'sheep', 'summon']);
const PROPS: ReadonlySet<EntityKind> = new Set(['crate', 'barrel', 'metal', 'wall', 'boulder', 'iceblock', 'barrier']);
const SPELL_KINDS: ReadonlySet<EntityKind> = new Set(['projectile', 'field', 'beam', 'summon', 'barrier']);

export interface FiredHook {
  hook: Hook;
  values: Record<string, Value>;
}

export interface WorldStats {
  damage: Record<Element, number>;
  healing: number;
  absorbed: number;
  kills: number;
  destroyed: number;
  spawned: number;
  peakEntities: number;
  reactions: number;
  byInstance: Map<number, { damage: number; healing: number; kills: number; hits: number }>;
}

export interface WorldSettings {
  godMode: boolean;
  respawn: boolean;
  enemyDamage: number;
  friendlyFire: boolean;
}

function emptyStats(): WorldStats {
  const damage = {} as Record<Element, number>;
  for (const e of ELEMENTS) damage[e] = 0;
  return { damage, healing: 0, absorbed: 0, kills: 0, destroyed: 0, spawned: 0, peakEntities: 0, reactions: 0, byInstance: new Map() };
}

type Template = Partial<Entity> & { kind: EntityKind };

/** Default physical/gameplay properties for each entity kind. */
export const TEMPLATES: Record<EntityKind, Omit<Template, 'kind'>> = {
  caster: { team: 0, shape: 'circle', r: 16, invMass: 0.5, hp: 250, damping: 9, solid: true, hittable: true, element: 'arcane' },
  dummy: { team: 1, shape: 'circle', r: 18, invMass: 0.15, hp: 400, damping: 5, solid: true, hittable: true, destructible: true, flammable: true, element: 'force' },
  enemy: { team: 1, shape: 'circle', r: 15, invMass: 1, hp: 90, damping: 6, solid: true, hittable: true, destructible: true, element: 'arcane' },
  target: { team: 1, shape: 'circle', r: 14, invMass: 0.8, hp: 60, damping: 6, solid: true, hittable: true, destructible: true, element: 'force' },
  crate: { team: 2, shape: 'box', hw: 16, hh: 16, invMass: 0.6, hp: 45, damping: 4, solid: true, hittable: true, destructible: true, flammable: true, element: 'force' },
  barrel: { team: 2, shape: 'circle', r: 14, invMass: 0.7, hp: 25, damping: 3.5, solid: true, hittable: true, destructible: true, flammable: true, element: 'fire' },
  metal: { team: 2, shape: 'box', hw: 18, hh: 18, invMass: 0.12, hp: 600, damping: 6, solid: true, hittable: true, destructible: true, conductive: true, element: 'lightning' },
  wall: { team: 2, shape: 'box', hw: 20, hh: 60, invMass: 0, hp: 320, damping: 0, solid: true, hittable: true, destructible: true, element: 'force' },
  pillar: { team: 2, shape: 'circle', r: 24, invMass: 0, hp: 1e9, damping: 0, solid: true, hittable: false, destructible: false, element: 'force' },
  boulder: { team: 2, shape: 'circle', r: 26, invMass: 0.08, hp: 350, damping: 2.5, solid: true, hittable: true, destructible: true, element: 'force' },
  projectile: { team: 0, shape: 'circle', r: 6, invMass: 0, hp: 1, damping: 0, solid: false, hittable: false, element: 'arcane' },
  field: { team: 0, shape: 'circle', r: 80, invMass: 0, hp: 1, damping: 0, solid: false, hittable: false, element: 'void' },
  beam: { team: 0, shape: 'circle', r: 4, invMass: 0, hp: 1, damping: 0, solid: false, hittable: false, element: 'arcane' },
  summon: { team: 0, shape: 'circle', r: 12, invMass: 0.6, hp: 80, damping: 7, solid: true, hittable: true, destructible: true, element: 'arcane' },
  barrier: { team: 0, shape: 'box', hw: 10, hh: 10, invMass: 0, hp: 140, damping: 0, solid: true, hittable: true, destructible: true, element: 'force' },
  sheep: { team: 1, shape: 'circle', r: 13, invMass: 1.2, hp: 30, damping: 6, solid: true, hittable: true, destructible: true, flammable: true, element: 'life' },
  iceblock: { team: 2, shape: 'box', hw: 18, hh: 18, invMass: 0.2, hp: 70, damping: 3, solid: true, hittable: true, destructible: true, element: 'ice' },
};

export class World {
  readonly width = ARENA_W;
  readonly height = ARENA_H;
  readonly entities = new Map<EntityId, Entity>();
  list: Entity[] = [];
  readonly terrain = new Terrain(ARENA_W, ARENA_H, 20);
  readonly hash = new SpatialHash(64);
  fx: FxEvent[] = [];
  fired: FiredHook[] = [];
  time = 0;
  stats: WorldStats = emptyStats();
  settings: WorldSettings = { godMode: true, respawn: true, enemyDamage: 1, friendlyFire: false };
  casterId: EntityId = 0;
  private nextId = 1;
  private terrainAcc = 0;
  private pendingRespawn: { template: Entity; t: number }[] = [];
  /** camera shake impulse the renderer reads and decays */
  shake = 0;
  private scratch: Entity[] = [];
  private ghosts = new Map<EntityId, Vec>();
  /** deterministic-ish RNG for the sim (swappable in tests) */
  random: () => number = Math.random;

  // ── Entity lifecycle ──────────────────────────────────────────────────────

  get spellEntityCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive && SPELL_KINDS.has(e.kind)) n++;
    return n;
  }

  canSpawnSpellEntity(): boolean {
    return this.entities.size < MAX_ENTITIES && this.spellEntityCount < MAX_SPELL_ENTITIES;
  }

  spawn(kind: EntityKind, pos: Vec, over: Partial<Entity> = {}): Entity {
    const t = TEMPLATES[kind];
    const r = over.r ?? t.r ?? (t.shape === 'box' ? Math.max(t.hw ?? 10, t.hh ?? 10) : 10);
    const e: Entity = {
      id: this.nextId++,
      kind,
      team: (t.team ?? 2) as Team,
      pos: { x: pos.x, y: pos.y },
      vel: { x: 0, y: 0 },
      angle: 0,
      spin: 0,
      shape: t.shape ?? 'circle',
      r,
      hw: t.hw ?? r,
      hh: t.hh ?? r,
      invMass: t.invMass ?? 1,
      restitution: 0.3,
      damping: t.damping ?? 4,
      hp: t.hp ?? 50,
      maxHp: t.hp ?? 50,
      alive: true,
      solid: t.solid ?? true,
      destructible: t.destructible ?? false,
      flammable: t.flammable ?? false,
      conductive: t.conductive ?? false,
      hittable: t.hittable ?? true,
      element: t.element ?? 'arcane',
      status: emptyStatus(),
      resist: {},
      age: 0,
      flash: 0,
      instance: 0,
      ownerId: 0,
      scale: 1,
      hooks: {},
      numAcc: 0,
      numT: 0,
      ...over,
    };
    if (over.hp !== undefined && over.maxHp === undefined) e.maxHp = over.hp;
    if (e.shape === 'box') e.r = Math.hypot(e.hw, e.hh);
    this.entities.set(e.id, e);
    this.list.push(e);
    this.stats.spawned++;
    if (kind === 'caster' && !this.casterId) {
      this.casterId = e.id;
      e.mana = e.mana ?? { cur: 300, max: 300, regen: 34 };
    }
    return e;
  }

  get(id: EntityId): Entity | undefined {
    if (!id) return undefined;
    const e = this.entities.get(id);
    return e && e.alive ? e : undefined;
  }

  /** includes dead entities that haven't been swept yet */
  getAny(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  /** position of an entity, or where it was last seen if it has died recently */
  posOf(id: EntityId): Vec {
    const e = this.entities.get(id);
    if (e) return { x: e.pos.x, y: e.pos.y };
    const g = this.ghosts.get(id);
    return g ? { x: g.x, y: g.y } : { x: 0, y: 0 };
  }

  get caster(): Entity | undefined {
    return this.get(this.casterId);
  }

  remove(e: Entity): void {
    e.alive = false;
  }

  clear(): void {
    this.entities.clear();
    this.list = [];
    this.terrain.clear();
    this.fx = [];
    this.fired = [];
    this.pendingRespawn = [];
    this.ghosts.clear();
    this.casterId = 0;
    this.stats = emptyStats();
  }

  resetStats(): void {
    this.stats = emptyStats();
  }

  emit(f: FxEvent): void {
    if (this.fx.length < 4000) this.fx.push(f);
  }

  fire(hook: Hook | undefined, values: Record<string, Value>): void {
    if (hook && this.fired.length < 5000) this.fired.push({ hook, values });
  }

  instStats(instance: number) {
    let s = this.stats.byInstance.get(instance);
    if (!s) this.stats.byInstance.set(instance, (s = { damage: 0, healing: 0, kills: 0, hits: 0 }));
    return s;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  isLiving(e: Entity): boolean {
    return LIVING.has(e.kind);
  }

  isProp(e: Entity): boolean {
    return PROPS.has(e.kind);
  }

  matches(e: Entity, filter: TargetFilter, selfId: EntityId = 0): boolean {
    if (!e.alive) return false;
    switch (filter) {
      case 'any':
        return e.kind !== 'beam';
      case 'notSelf':
        return e.id !== selfId && e.kind !== 'beam' && e.id !== this.casterId;
      case 'enemies':
        return e.team === 1 && LIVING.has(e.kind);
      case 'allies':
        return e.team === 0 && LIVING.has(e.kind);
      case 'living':
        return LIVING.has(e.kind);
      case 'props':
        return PROPS.has(e.kind);
      case 'projectiles':
        return e.kind === 'projectile';
      case 'hostile':
        return e.team !== 0 && e.hittable;
    }
  }

  inRadius(p: Vec, radius: number, filter: TargetFilter, selfId: EntityId = 0): Entity[] {
    const out: Entity[] = [];
    for (const e of this.list) {
      if (!this.matches(e, filter, selfId) || e.id === selfId) continue;
      const rr = radius + (e.kind === 'projectile' || e.kind === 'field' ? 0 : e.r * 0.8);
      if (V.dist2(e.pos, p) <= rr * rr) out.push(e);
    }
    out.sort((a, b) => V.dist2(a.pos, p) - V.dist2(b.pos, p));
    return out;
  }

  nearest(p: Vec, maxRange: number, filter: TargetFilter, exclude?: Set<EntityId>, selfId: EntityId = 0): Entity | undefined {
    let best: Entity | undefined;
    let bd = maxRange * maxRange;
    for (const e of this.list) {
      if (e.id === selfId || !this.matches(e, filter, selfId) || exclude?.has(e.id)) continue;
      const d = V.dist2(e.pos, p);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Ray cast against solid bodies and the arena bounds.
   * `stopAt` decides whether an entity blocks the ray.
   */
  raycast(
    o: Vec,
    dir: Vec,
    maxLen: number,
    stopAt: (e: Entity) => boolean = (e) => e.solid,
  ): { hit: boolean; pos: Vec; entity: Entity | undefined; normal: Vec; dist: number } {
    const d = V.norm(dir);
    let best = maxLen;
    let bestE: Entity | undefined;
    let normal: Vec = { x: -d.x, y: -d.y };
    // arena bounds
    const bounds = this.boundsHit(o, d);
    if (bounds && bounds.t < best) {
      best = bounds.t;
      normal = { x: bounds.nx, y: bounds.ny };
    }
    for (const e of this.list) {
      if (!e.alive || !stopAt(e)) continue;
      if (e.shape === 'circle') {
        const t = rayCircle(o, d, e.pos, e.r);
        if (t >= 0 && t < best) {
          best = t;
          bestE = e;
          const hp = V.add(o, V.scale(d, t));
          normal = V.norm(V.sub(hp, e.pos));
        }
      } else {
        const h = rayBox(o, d, e);
        if (h && h.t < best) {
          best = h.t;
          bestE = e;
          normal = { x: h.nx, y: h.ny };
        }
      }
    }
    const hit = best < maxLen;
    return { hit, pos: V.add(o, V.scale(d, best)), entity: bestE, normal, dist: best };
  }

  private boundsHit(o: Vec, d: Vec): { t: number; nx: number; ny: number } | null {
    let t = Infinity;
    let nx = 0;
    let ny = 0;
    if (d.x > 1e-9) {
      const tt = (this.width - o.x) / d.x;
      if (tt < t) ((t = tt), (nx = -1), (ny = 0));
    } else if (d.x < -1e-9) {
      const tt = -o.x / d.x;
      if (tt < t) ((t = tt), (nx = 1), (ny = 0));
    }
    if (d.y > 1e-9) {
      const tt = (this.height - o.y) / d.y;
      if (tt < t) ((t = tt), (nx = 0), (ny = -1));
    } else if (d.y < -1e-9) {
      const tt = -o.y / d.y;
      if (tt < t) ((t = tt), (nx = 0), (ny = 1));
    }
    return t === Infinity ? null : { t: Math.max(0, t), nx, ny };
  }

  clampToArena(p: Vec, margin = 8): Vec {
    return { x: clamp(p.x, margin, this.width - margin), y: clamp(p.y, margin, this.height - margin) };
  }

  // ── Damage & healing ──────────────────────────────────────────────────────

  /**
   * Apply elemental damage with resistances, shields and element reactions.
   * Returns the damage actually dealt to health.
   */
  damage(target: Entity, amount: number, element: Element, instance = 0, opts: { quiet?: boolean; dir?: Vec } = {}): number {
    if (!target.alive || !target.hittable || amount <= 0 || !Number.isFinite(amount)) return 0;
    if (element === 'life' && target.team === 0) return this.heal(target, amount, instance);
    if (target.kind === 'caster' && this.settings.godMode) {
      target.flash = 1;
      return 0;
    }
    let mult = target.resist[element] ?? 1;
    const s = target.status;
    if (element === 'lightning') {
      if (s.wet > 0) {
        mult *= 2;
        this.reaction(target.pos, 'Conducted!', '#bfc6ff');
      }
      if (target.conductive) mult *= 1.5;
      s.shocked = Math.max(s.shocked, 0.5);
      s.stun = Math.max(s.stun, 0.35);
    } else if (element === 'fire') {
      if (s.frozen > 0) {
        s.frozen = 0;
        s.wet = 3;
        this.emit({ type: 'steam', pos: V.copy(target.pos) });
        this.reaction(target.pos, 'Thawed', '#ffb38a');
      } else if (s.wet > 0) {
        mult *= 0.5;
        s.wet = Math.max(0, s.wet - 1);
        this.emit({ type: 'steam', pos: V.copy(target.pos) });
      } else if (target.flammable || this.isLiving(target)) {
        this.ignite(target, 2.5, Math.max(4, amount * 0.18));
      }
    } else if (element === 'ice') {
      if (s.burning > 0) {
        s.burning = 0;
        this.emit({ type: 'steam', pos: V.copy(target.pos) });
      }
      if (s.chilled > 0 && amount >= 12 && this.isLiving(target)) this.freezeEntity(target, 1.6);
      s.chilled = Math.max(s.chilled, 2.5);
    } else if (s.frozen > 0 && (element === 'force' || element === 'arcane' || element === 'void')) {
      mult *= 1.6;
      s.frozen = 0;
      this.emit({ type: 'shatter', pos: V.copy(target.pos), radius: target.r * 1.5 });
      this.reaction(target.pos, 'Shatter!', '#d8f7ff');
    }
    let dmg = amount * mult;
    if (s.shield > 0) {
      const absorbed = Math.min(s.shield, dmg);
      s.shield -= absorbed;
      dmg -= absorbed;
      this.stats.absorbed += absorbed;
      this.emit({ type: 'shieldHit', pos: V.copy(target.pos), radius: target.r + 8 });
      if (dmg <= 0) return 0;
    }
    if (!target.destructible) {
      target.flash = 1;
      return 0;
    }
    target.hp -= dmg;
    target.flash = 1;
    this.stats.damage[element] += dmg;
    if (instance) {
      const st = this.instStats(instance);
      st.damage += dmg;
      st.hits++;
    }
    target.numAcc += dmg;
    if (!opts.quiet || target.numAcc > 25) this.flushNumber(target, element);
    if (target.hp <= 0) this.kill(target, element, instance);
    return dmg;
  }

  private flushNumber(e: Entity, element: Element): void {
    if (e.numAcc < 0.5) return;
    this.emit({
      type: 'number',
      pos: { x: e.pos.x + (this.random() - 0.5) * 10, y: e.pos.y - e.r - 6 },
      amount: Math.round(e.numAcc),
      kind: e.numAcc > 60 ? 'crit' : 'damage',
      element,
    });
    e.numAcc = 0;
    e.numT = 0;
  }

  heal(target: Entity, amount: number, instance = 0): number {
    if (!target.alive || amount <= 0 || !this.isLiving(target)) return 0;
    const h = Math.min(amount, target.maxHp - target.hp);
    target.hp += h;
    if (h > 0) {
      this.stats.healing += h;
      if (instance) this.instStats(instance).healing += h;
      this.emit({ type: 'number', pos: { x: target.pos.x, y: target.pos.y - target.r - 6 }, amount: Math.round(h), kind: 'heal', element: 'life' });
    }
    if (target.status.burning > 0) target.status.burning = 0;
    if (target.status.frozen > 0) target.status.frozen = 0;
    return h;
  }

  kill(e: Entity, element: Element = 'force', instance = 0): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    if (e.numAcc > 0) this.flushNumber(e, element);
    const isLiving = this.isLiving(e);
    if (isLiving && e.kind !== 'caster') {
      this.stats.kills++;
      if (instance) this.instStats(instance).kills++;
    } else if (this.isProp(e)) this.stats.destroyed++;
    this.emit({ type: 'death', pos: V.copy(e.pos), kind: e.kind, element: e.status.frozen > 0 ? 'ice' : element, radius: e.r });
    if (this.isProp(e)) this.emit({ type: 'debris', pos: V.copy(e.pos), kind: e.kind, radius: e.r });
    this.fire(e.hooks.death, { pos: V.copy(e.pos), self: e.id });
    if (e.kind === 'barrel') {
      // explosive barrels detonate: chain reactions!
      this.explode(e.pos, 115, 55, 'fire', 520, 0, e.id);
      this.terrain.forCircle(e.pos, 60, (i) => {
        const m = this.terrain.mat[i];
        if (m === Mat.Grass || m === Mat.Oil || m === Mat.Floor) this.terrain.set(i, Mat.Fire, 3 + this.random() * 2);
      });
    }
    if (e.respawn && this.settings.respawn) {
      const tpl: Entity = { ...e, pos: V.copy(e.respawn.pos), vel: V.make(), hp: e.maxHp, alive: true, status: emptyStatus(), hooks: {} };
      this.pendingRespawn.push({ template: tpl, t: e.respawn.delay });
    }
  }

  ignite(e: Entity, duration: number, dps: number): void {
    if (!e.alive || e.status.wet > 0.5 || e.kind === 'iceblock') return;
    if (e.status.burning <= 0) this.emit({ type: 'ignite', pos: V.copy(e.pos) });
    e.status.burning = Math.max(e.status.burning, duration);
    e.status.burnDps = Math.max(e.status.burnDps, dps);
  }

  freezeEntity(e: Entity, duration: number): void {
    if (!e.alive) return;
    if (e.status.burning > 0) {
      e.status.burning = 0;
      this.emit({ type: 'steam', pos: V.copy(e.pos) });
      return;
    }
    if (e.status.frozen <= 0) this.emit({ type: 'freeze', pos: V.copy(e.pos), radius: e.r * 1.4 });
    e.status.frozen = Math.max(e.status.frozen, duration);
    e.vel.x *= 0.1;
    e.vel.y *= 0.1;
  }

  reaction(p: Vec, text: string, color: string): void {
    this.stats.reactions++;
    this.emit({ type: 'text', pos: { x: p.x, y: p.y - 28 }, text, color });
  }

  // ── Area effects used by spells and by the environment ───────────────────

  explode(p: Vec, radius: number, dmg: number, element: Element, force: number, instance = 0, sourceId: EntityId = 0): Entity[] {
    const hit: Entity[] = [];
    this.emit({ type: 'explosion', pos: V.copy(p), radius, element });
    this.shake = Math.min(18, this.shake + radius / 14);
    for (const e of this.list) {
      if (!e.alive || e.id === sourceId || e.kind === 'beam' || e.kind === 'field') continue;
      if (e.kind === 'caster' && !this.settings.friendlyFire) continue;
      const d = V.dist(e.pos, p);
      const reach = radius + e.r * 0.7;
      if (d > reach) continue;
      const falloff = 1 - 0.55 * clamp(d / reach, 0, 1);
      if (e.kind !== 'projectile') {
        hit.push(e);
        if (!(e.team === 0 && element === 'life' && !this.isLiving(e))) this.damage(e, dmg * falloff, element, instance);
      }
      if (force && e.invMass > 0) {
        const dir = d > 1e-3 ? V.scale(V.sub(e.pos, p), 1 / d) : V.fromAngle(this.random() * Math.PI * 2);
        const imp = (force * falloff) * Math.min(e.invMass, 1.5);
        e.vel.x += dir.x * imp;
        e.vel.y += dir.y * imp;
        e.spin += (this.random() - 0.5) * 8;
      }
    }
    this.elementOnTerrain(p, radius * 0.75, element, 'burst');
    return hit;
  }

  /** Elemental influence on the terrain grid. */
  elementOnTerrain(p: Vec, radius: number, element: Element, mode: 'burst' | 'touch' = 'touch'): void {
    const T = this.terrain;
    if (element === 'fire') {
      T.forCircle(p, radius, (i) => {
        const m = T.mat[i];
        if (m === Mat.Grass) T.set(i, Mat.Fire, 2.5 + this.random() * 2.5);
        else if (m === Mat.Oil) {
          T.set(i, Mat.Fire, 5 + this.random() * 3);
        } else if (m === Mat.Ice) {
          T.set(i, Mat.Water);
          if (this.random() < 0.15) this.emit({ type: 'steam', pos: T.center(i) });
        } else if (m === Mat.Water && mode === 'burst' && this.random() < 0.2) this.emit({ type: 'steam', pos: T.center(i) });
      });
    } else if (element === 'ice') {
      T.forCircle(p, radius, (i) => {
        const m = T.mat[i];
        if (m === Mat.Water) T.set(i, Mat.Ice, 14 + this.random() * 6);
        else if (m === Mat.Fire) T.set(i, Mat.Scorched);
        else if (m === Mat.Lava && mode === 'burst') T.set(i, Mat.Scorched);
      });
    } else if (element === 'lightning') {
      const i0 = T.idx(p.x, p.y);
      if (i0 >= 0 && T.mat[i0] === Mat.Water) this.electrifyWater(i0, 18);
      else {
        // look for water near the strike
        let found = -1;
        T.forCircle(p, radius, (i) => {
          if (found < 0 && T.mat[i] === Mat.Water) found = i;
        });
        if (found >= 0) this.electrifyWater(found, 18);
      }
    } else if (element === 'life') {
      T.forCircle(p, radius, (i) => {
        const m = T.mat[i];
        if (m === Mat.Scorched || (m === Mat.Floor && mode === 'burst' && this.random() < 0.5)) T.set(i, Mat.Grass);
      });
    }
  }

  private electrifyWater(start: number, dmg: number): void {
    const T = this.terrain;
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length && seen.size < 500) {
      const i = queue.shift()!;
      const c = i % T.cols;
      const r = (i / T.cols) | 0;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= T.cols || nr >= T.rows) continue;
        const ni = nr * T.cols + nc;
        if (!seen.has(ni) && T.mat[ni] === Mat.Water) {
          seen.add(ni);
          queue.push(ni);
        }
      }
    }
    const cells = [...seen];
    // visual arcs across the pool
    for (let k = 0; k < Math.min(6, cells.length / 6); k++) {
      const a = T.center(cells[(this.random() * cells.length) | 0]);
      const b = T.center(cells[(this.random() * cells.length) | 0]);
      this.emit({ type: 'bolt', points: [a, b], element: 'lightning', width: 1.5 });
    }
    let hits = 0;
    for (const e of this.list) {
      if (!e.alive || !e.hittable) continue;
      const i = T.idx(e.pos.x, e.pos.y);
      if (seen.has(i)) {
        e.status.wet = Math.max(e.status.wet, 2);
        this.damage(e, dmg, 'lightning');
        hits++;
      }
    }
    if (hits) this.reaction(T.center(start), 'Electrified water!', '#aab4ff');
  }

  // ── Simulation step ───────────────────────────────────────────────────────

  step(dt: number): void {
    this.time += dt;
    const caster = this.caster;
    for (const e of this.list) {
      if (!e.alive) continue;
      e.age += dt;
      e.flash = Math.max(0, e.flash - dt * 5);
      if (e.numAcc > 0) {
        e.numT += dt;
        if (e.numT > 0.35) this.flushNumber(e, e.status.burning > 0 ? 'fire' : 'arcane');
      }
      if (e.mana) e.mana.cur = Math.min(e.mana.max, e.mana.cur + e.mana.regen * dt);
      this.updateStatus(e, dt);
      if (e.ai && e.status.frozen <= 0 && e.status.stun <= 0) updateAI(this, e, dt, caster);
      if (e.summon) updateSummon(this, e, dt);
      if (e.orbit) this.updateOrbit(e, dt);
      if (e.life !== undefined) {
        e.life -= dt;
        if (e.life <= 0) {
          if (e.kind === 'iceblock' || e.kind === 'barrier') this.emit({ type: 'shatter', pos: V.copy(e.pos), radius: e.r });
          this.fire(e.hooks.expire, { pos: V.copy(e.pos), self: e.id });
          e.alive = false;
        }
      }
      if (e.fuse !== undefined) {
        e.fuse -= dt;
        if (e.fuse <= 0) {
          e.fuse = undefined;
          this.kill(e, 'fire');
        }
      }
    }
    for (const e of this.list) if (e.alive && e.field) this.updateField(e, dt);
    this.integrate(dt);
    this.collideBodies();
    for (const e of this.list) if (e.alive && e.proj) this.updateProjectile(e, dt);
    for (const e of this.list) if (e.alive && e.beam) this.updateBeam(e, dt);
    this.terrainAcc += dt;
    if (this.terrainAcc >= 0.1) {
      this.updateTerrain(this.terrainAcc);
      this.terrainAcc = 0;
    }
    // respawns
    for (let i = this.pendingRespawn.length - 1; i >= 0; i--) {
      const r = this.pendingRespawn[i];
      r.t -= dt;
      if (r.t <= 0) {
        this.pendingRespawn.splice(i, 1);
        const { id: _id, ...rest } = r.template;
        const e = this.spawn(rest.kind, rest.pos, { ...rest, alive: true });
        this.emit({ type: 'spawn', pos: V.copy(e.pos), element: 'arcane', radius: e.r * 2 });
      }
    }
    // sweep dead
    if (this.list.some((e) => !e.alive)) {
      this.list = this.list.filter((e) => {
        if (!e.alive) {
          this.entities.delete(e.id);
          this.ghosts.set(e.id, e.pos);
          if (this.ghosts.size > 3000) this.ghosts.delete(this.ghosts.keys().next().value!);
          return false;
        }
        return true;
      });
    }
    this.stats.peakEntities = Math.max(this.stats.peakEntities, this.list.length);
    this.shake *= Math.exp(-dt * 7);
  }

  private updateStatus(e: Entity, dt: number): void {
    const s = e.status;
    if (s.burning > 0) {
      s.burning -= dt;
      this.damage(e, s.burnDps * dt, 'fire', e.instance, { quiet: true });
      // spread fire to adjacent flammables and grass
      if (this.random() < dt * 2) {
        this.elementOnTerrain(e.pos, e.r + 6, 'fire');
        for (const o of this.list) {
          if (o !== e && o.alive && o.flammable && o.status.burning <= 0 && V.dist(o.pos, e.pos) < e.r + o.r + 14) this.ignite(o, 3, s.burnDps);
        }
      }
      if (s.burning <= 0) s.burnDps = 0;
    }
    if (s.frozen > 0) {
      s.frozen -= dt;
      e.vel.x *= 0.5;
      e.vel.y *= 0.5;
    }
    if (s.chilled > 0) s.chilled -= dt;
    if (s.shocked > 0) s.shocked -= dt;
    if (s.stun > 0) s.stun -= dt;
    if (s.wet > 0) s.wet -= dt;
    if (s.shieldTime > 0) {
      s.shieldTime -= dt;
      if (s.shieldTime <= 0) s.shield = 0;
    }
    if (s.regenTime > 0) {
      s.regenTime -= dt;
      if (e.hp < e.maxHp) {
        const h = Math.min(s.regen * dt, e.maxHp - e.hp);
        e.hp += h;
        this.stats.healing += h;
      }
    }
    if (s.polymorph > 0) {
      s.polymorph -= dt;
      if (s.polymorph <= 0 && e.polyFrom) {
        e.kind = e.polyFrom.kind;
        e.r = e.polyFrom.r;
        e.ai = e.polyFrom.ai;
        e.polyFrom = undefined;
        e.flammable = TEMPLATES[e.kind].flammable ?? false;
        this.emit({ type: 'transmute', pos: V.copy(e.pos), radius: e.r * 2, element: 'arcane' });
      }
    }
  }

  private updateOrbit(e: Entity, dt: number): void {
    const o = e.orbit!;
    const anchor = this.get(o.anchor);
    if (o.anchor && !anchor) {
      e.orbit = undefined;
      return;
    }
    if (anchor) o.center = V.copy(anchor.pos);
    o.angle += o.angVel * dt;
    o.life -= dt;
    const target = V.add(o.center, V.fromAngle(o.angle, o.radius));
    // drive velocity so collisions & trails stay coherent
    e.vel = V.scale(V.sub(target, e.pos), 1 / Math.max(dt, 1e-4));
    if (o.life <= 0) {
      // release tangentially
      e.vel = V.scale(V.fromAngle(o.angle + Math.sign(o.angVel) * Math.PI / 2), Math.abs(o.angVel) * o.radius);
      if (e.proj) e.proj.speed = V.len(e.vel);
      e.orbit = undefined;
    }
  }

  private integrate(dt: number): void {
    const T = this.terrain;
    for (const e of this.list) {
      if (!e.alive || e.proj || e.beam || e.field) continue;
      // orbiters are driven kinematically, even immovable ones like wisps
      if (e.orbit) {
        e.pos.x += e.vel.x * dt;
        e.pos.y += e.vel.y * dt;
        continue;
      }
      if (e.invMass <= 0) continue;
      const m = T.at(e.pos);
      let damp = e.damping;
      if (m === Mat.Ice || m === Mat.Oil) damp *= 0.18;
      else if (m === Mat.Water) damp *= 1.8;
      if (e.status.frozen > 0) damp = Math.max(damp, 3) * 0.3;
      const k = Math.exp(-damp * dt);
      e.vel.x *= k;
      e.vel.y *= k;
      const sp = Math.hypot(e.vel.x, e.vel.y);
      if (sp > 2400) {
        e.vel.x *= 2400 / sp;
        e.vel.y *= 2400 / sp;
      }
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.angle += e.spin * dt;
      e.spin *= Math.exp(-3 * dt);
      // dummies spring back to their post
      if (e.kind === 'dummy' && e.respawn) {
        e.vel.x += (e.respawn.pos.x - e.pos.x) * 6 * dt;
        e.vel.y += (e.respawn.pos.y - e.pos.y) * 6 * dt;
      }
      // arena bounds
      const hw = e.shape === 'box' ? e.hw : e.r;
      const hh = e.shape === 'box' ? e.hh : e.r;
      if (e.pos.x < hw) ((e.pos.x = hw), (e.vel.x = Math.abs(e.vel.x) * 0.4));
      if (e.pos.x > this.width - hw) ((e.pos.x = this.width - hw), (e.vel.x = -Math.abs(e.vel.x) * 0.4));
      if (e.pos.y < hh) ((e.pos.y = hh), (e.vel.y = Math.abs(e.vel.y) * 0.4));
      if (e.pos.y > this.height - hh) ((e.pos.y = this.height - hh), (e.vel.y = -Math.abs(e.vel.y) * 0.4));
    }
  }

  private collideBodies(): void {
    const H = this.hash;
    H.clear();
    for (const e of this.list) if (e.alive && e.solid) H.insert(e);
    const cand = this.scratch;
    for (const a of this.list) {
      if (!a.alive || !a.solid || a.invMass <= 0) continue;
      H.query(a.pos, a.r + 2, cand);
      for (const b of cand) {
        if (b === a || !b.alive) continue;
        if (b.invMass > 0 && b.id < a.id) continue; // each dynamic pair once
        const c = collide(a, b);
        if (!c) continue;
        const impact = resolve(a, b, c);
        if (impact > 420) {
          // heavy impacts hurt (boulders, thrown crates, slammed enemies)
          const dmg = (impact - 420) * 0.05;
          if (a.kind !== 'caster') this.damage(a, dmg * (b.invMass > 0 ? 1 / Math.max(b.invMass, 0.1) * 0.2 : 1), 'force', 0, { quiet: true });
          if (b.kind !== 'caster') this.damage(b, dmg * (1 / Math.max(a.invMass, 0.1)) * 0.2, 'force', 0, { quiet: true });
          if (impact > 700) this.emit({ type: 'hit', pos: V.add(a.pos, V.scale({ x: c.nx, y: c.ny }, a.r)), element: 'force', dir: { x: c.nx, y: c.ny }, amount: dmg });
        }
        // contact spreads fire and frost
        if (a.status.burning > 0 && b.flammable) this.ignite(b, 2, a.status.burnDps);
        if (b.status.burning > 0 && a.flammable) this.ignite(a, 2, b.status.burnDps);
      }
    }
  }

  private projectileBlocks(p: Entity, e: Entity): boolean {
    if (!e.alive || e === p || e.id === p.ownerId && p.age < p.proj!.ownerGrace) return false;
    if (e.kind === 'projectile' || e.kind === 'field' || e.kind === 'beam') return false;
    if (!e.solid && !e.hittable) return false;
    if (e.team === p.team && (this.isLiving(e) || e.kind === 'barrier')) return false;
    if (e.id === p.ownerId) return false;
    return true;
  }

  private updateProjectile(p: Entity, dt: number): void {
    const pr = p.proj!;
    pr.life -= dt;
    if (pr.life <= 0) {
      this.endProjectile(p);
      return;
    }
    // homing
    if (pr.homingStrength > 0) {
      let tgt = this.get(pr.homingTarget);
      if (!tgt) {
        tgt = this.nearest(p.pos, 520, p.team === 0 ? 'hostile' : 'allies', pr.hitSet, p.ownerId);
        if (tgt && !this.isLiving(tgt) && tgt.kind !== 'crate' && tgt.kind !== 'barrel') {
          // prefer living targets, accept props only if nothing alive is near
          const alive = this.nearest(p.pos, 520, p.team === 0 ? 'enemies' : 'allies', pr.hitSet, p.ownerId);
          if (alive) tgt = alive;
        }
        if (tgt) pr.homingTarget = tgt.id;
      }
      if (tgt) {
        const desired = V.norm(V.sub(tgt.pos, p.pos));
        const cur = V.norm(p.vel);
        const ang = Math.atan2(V.cross(cur, desired), V.dot(cur, desired));
        const turn = clamp(ang, -pr.homingStrength * dt, pr.homingStrength * dt);
        p.vel = V.scale(V.rot(cur, turn), V.len(p.vel));
      }
    }
    if (pr.drag) {
      const k = Math.exp(-pr.drag * dt);
      p.vel.x *= k;
      p.vel.y *= k;
    }
    if (pr.gravity) p.vel.y += pr.gravity * dt;
    if (pr.tickInterval > 0 && p.hooks.tick) {
      pr.tickAcc += dt;
      while (pr.tickAcc >= pr.tickInterval) {
        pr.tickAcc -= pr.tickInterval;
        this.fire(p.hooks.tick, { pos: V.copy(p.pos), self: p.id });
      }
    }
    p.angle = Math.atan2(p.vel.y, p.vel.x);
    // swept movement in substeps
    const sp = Math.hypot(p.vel.x, p.vel.y);
    const n = Math.max(1, Math.min(12, Math.ceil((sp * dt) / Math.max(p.r, 4))));
    const sdt = dt / n;
    for (let k = 0; k < n && p.alive; k++) {
      p.pos.x += p.vel.x * sdt;
      p.pos.y += p.vel.y * sdt;
      // bounds
      let bn: Vec | null = null;
      if (p.pos.x < p.r) ((bn = { x: 1, y: 0 }), (p.pos.x = p.r));
      else if (p.pos.x > this.width - p.r) ((bn = { x: -1, y: 0 }), (p.pos.x = this.width - p.r));
      if (p.pos.y < p.r) ((bn = { x: 0, y: 1 }), (p.pos.y = p.r));
      else if (p.pos.y > this.height - p.r) ((bn = { x: 0, y: -1 }), (p.pos.y = this.height - p.r));
      if (bn) {
        this.projectileImpact(p, undefined, bn);
        continue;
      }
      const cand = this.hash.query(p.pos, p.r + 30, this.scratch);
      for (const e of cand) {
        if (!this.projectileBlocks(p, e) || pr.hitSet.has(e.id)) continue;
        const c = collide(p, e);
        if (!c) continue;
        this.projectileImpact(p, e, { x: -c.nx, y: -c.ny }, c.depth);
        if (!p.alive) break;
      }
    }
    // elemental trail on terrain
    if (p.alive && (p.element === 'fire' || p.element === 'ice') && this.random() < dt * 20) this.elementOnTerrain(p.pos, p.r + 4, p.element);
  }

  /** normal points away from the surface hit */
  private projectileImpact(p: Entity, e: Entity | undefined, normal: Vec, depth = 0): void {
    const pr = p.proj!;
    const hitPos = V.copy(p.pos);
    if (e) {
      pr.hitSet.add(e.id);
      if (e.hittable) {
        const dmg = pr.damage * p.scale;
        this.damage(e, dmg, p.element, p.instance, { dir: V.norm(p.vel) });
      }
      if (pr.knockback && e.invMass > 0) {
        const d = V.norm(p.vel);
        e.vel.x += d.x * pr.knockback * Math.min(e.invMass, 1.5);
        e.vel.y += d.y * pr.knockback * Math.min(e.invMass, 1.5);
      }
    }
    this.emit({ type: 'hit', pos: hitPos, element: p.element, dir: normal, amount: pr.damage });
    this.fire(p.hooks.hit, { pos: hitPos, target: e ? e.id : 0, normal: V.copy(normal), self: p.id });
    if (!p.alive) return;
    const isStatic = !e || e.invMass <= 0;
    if (e && pr.pierce > 0 && !isStatic) {
      pr.pierce--;
      return;
    }
    if (pr.bounces > 0) {
      pr.bounces--;
      const vn = V.dot(p.vel, normal);
      if (vn < 0) p.vel = V.sub(p.vel, V.scale(normal, 2 * vn));
      p.pos = V.add(p.pos, V.scale(normal, depth + 1));
      // pushed clear of the surface, so the same target may be hit again later
      pr.hitSet.clear();
      return;
    }
    this.endProjectile(p);
  }

  endProjectile(p: Entity): void {
    if (!p.alive) return;
    p.alive = false;
    this.fire(p.hooks.expire, { pos: V.copy(p.pos), self: p.id });
  }

  private updateBeam(b: Entity, dt: number): void {
    const bm = b.beam!;
    bm.life -= dt;
    if (bm.followCaster) {
      const owner = this.get(b.ownerId);
      if (owner) b.pos = V.add(owner.pos, V.scale(bm.dir, owner.r + 4));
    }
    const ray = this.raycast(b.pos, bm.dir, bm.length, (e) => e.solid && e.team !== b.team && (!bm.pierce || e.invMass <= 0));
    bm.end = ray.pos;
    const len = ray.dist;
    for (const e of this.list) {
      if (!e.alive || !e.hittable || e.team === b.team) continue;
      // distance from entity to segment
      const rel = V.sub(e.pos, b.pos);
      const along = V.dot(rel, bm.dir);
      if (along < -e.r || along > len + e.r) continue;
      const perp = Math.abs(V.cross(bm.dir, rel));
      if (perp > bm.width * 0.5 + e.r) continue;
      if (!bm.pierce && ray.entity && e !== ray.entity && along > ray.dist) continue;
      this.damage(e, bm.dps * dt, b.element, b.instance, { quiet: true });
      if (b.element === 'force' && e.invMass > 0) {
        e.vel.x += bm.dir.x * 900 * dt;
        e.vel.y += bm.dir.y * 900 * dt;
      }
      if (!bm.hitOnce.has(e.id)) {
        bm.hitOnce.add(e.id);
        this.fire(b.hooks.hit, { pos: V.copy(e.pos), target: e.id, normal: V.scale(bm.dir, -1), self: b.id });
      }
    }
    if (this.random() < dt * 12) this.elementOnTerrain(bm.end, 14, b.element);
    if (bm.life <= 0) {
      b.alive = false;
      this.fire(b.hooks.expire, { pos: V.copy(bm.end), self: b.id });
    }
  }

  private updateField(f: Entity, dt: number): void {
    const fd = f.field!;
    fd.life -= dt;
    if (fd.followId) {
      const t = this.get(fd.followId);
      if (t) f.pos = V.copy(t.pos);
    }
    const R = fd.radius * f.scale;
    const fade = clamp(fd.life / 0.25, 0, 1) * clamp((fd.maxLife - fd.life) / 0.15, 0, 1);
    const nowInside = new Set<EntityId>();
    for (const e of this.list) {
      if (!e.alive || e === f || e.kind === 'field' || e.kind === 'beam') continue;
      if (e.kind === 'projectile' && (!fd.affectsProjectiles || e.instance === f.instance && e.age < 0.05)) continue;
      const dx = f.pos.x - e.pos.x;
      const dy = f.pos.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > R + e.r * 0.5) continue;
      if (e.hittable) nowInside.add(e.id);
      const nd = d > 1e-3 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
      const movable = e.invMass > 0 || e.kind === 'projectile';
      const im = e.kind === 'projectile' ? 1 : Math.min(e.invMass, 1.6);
      const falloff = 1 - d / (R + 1);
      const s = fd.strength * fade;
      // the caster is unaffected by their own pulling/pushing fields unless they opt in
      const exempt = e.id === f.ownerId && e.kind === 'caster';
      if (movable && !exempt && e.status.frozen <= 0) {
        switch (fd.kind) {
          case 'gravity': {
            const a = s * (0.35 + 0.9 * falloff * falloff) * (e.kind === 'projectile' ? 1.6 : 1);
            e.vel.x += nd.x * a * dt;
            e.vel.y += nd.y * a * dt;
            // slight swirl so things spiral in
            e.vel.x += -nd.y * a * 0.25 * dt;
            e.vel.y += nd.x * a * 0.25 * dt;
            if (e.kind !== 'projectile') {
              const k = Math.exp(-1.5 * falloff * dt);
              e.vel.x *= k;
              e.vel.y *= k;
            }
            break;
          }
          case 'attract':
            e.vel.x += nd.x * s * im * falloff * dt;
            e.vel.y += nd.y * s * im * falloff * dt;
            break;
          case 'repel':
            e.vel.x -= nd.x * s * im * (0.3 + falloff) * dt;
            e.vel.y -= nd.y * s * im * (0.3 + falloff) * dt;
            break;
          case 'vortex':
            e.vel.x += (-nd.y * s + nd.x * s * 0.35) * im * dt;
            e.vel.y += (nd.x * s + nd.y * s * 0.35) * im * dt;
            break;
          case 'stasis': {
            const k = Math.exp(-s * 0.02 * dt);
            e.vel.x *= k;
            e.vel.y *= k;
            if (e.proj) e.proj.life += dt * 0.6 * (1 - k);
            break;
          }
          case 'zone':
            break;
        }
      }
      if (fd.dps > 0 && e.hittable && e.kind !== 'projectile') {
        const friendly = e.team === f.team && f.element !== 'life';
        if (!friendly || this.settings.friendlyFire) {
          if (f.element === 'life') {
            if (e.team === f.team) this.heal(e, fd.dps * dt, f.instance);
            else this.damage(e, fd.dps * dt * 0.5, 'life', f.instance, { quiet: true });
          } else this.damage(e, fd.dps * dt * fade, f.element, f.instance, { quiet: true });
          if (f.element === 'ice' && e.status.chilled > 1.6 && this.isLiving(e) && this.random() < dt * 0.6) this.freezeEntity(e, 1.2);
          if (f.element === 'ice') e.status.chilled = Math.max(e.status.chilled, 1);
          if (f.element === 'fire') this.ignite(e, 1.5, fd.dps * 0.3);
        }
      }
    }
    for (const id of nowInside) {
      if (!fd.inside.has(id)) this.fire(f.hooks.enter, { pos: V.copy(this.entities.get(id)!.pos), target: id, self: f.id });
    }
    fd.inside = nowInside;
    if (fd.tickInterval > 0) {
      fd.tickAcc += dt;
      while (fd.tickAcc >= fd.tickInterval) {
        fd.tickAcc -= fd.tickInterval;
        this.fire(f.hooks.tick, { pos: V.copy(f.pos), self: f.id });
        if (fd.kind === 'zone' || fd.dps > 0) this.elementOnTerrain(f.pos, R * 0.8, f.element);
      }
    }
    if (fd.life <= 0) {
      f.alive = false;
      this.fire(f.hooks.expire, { pos: V.copy(f.pos), self: f.id });
    }
  }

  private updateTerrain(dt: number): void {
    const T = this.terrain;
    const n = T.mat.length;
    const cols = T.cols;
    for (let i = 0; i < n; i++) {
      const m = T.mat[i];
      if (m === Mat.Fire) {
        T.timer[i] -= dt;
        if (T.timer[i] <= 0) {
          T.set(i, Mat.Scorched);
          continue;
        }
        // spread
        const c = i % cols;
        const nb = [i - 1, i + 1, i - cols, i + cols];
        for (const j of nb) {
          if (j < 0 || j >= n) continue;
          if ((j === i - 1 && c === 0) || (j === i + 1 && c === cols - 1)) continue;
          const mj = T.mat[j];
          if (mj === Mat.Oil && this.random() < dt * 9) T.set(j, Mat.Fire, 4 + this.random() * 3);
          else if (mj === Mat.Grass && this.random() < dt * 1.6) T.set(j, Mat.Fire, 2 + this.random() * 2.5);
          else if (mj === Mat.Ice && this.random() < dt * 0.5) T.set(j, Mat.Water);
        }
      } else if (m === Mat.Ice) {
        if (T.timer[i] > 0) {
          T.timer[i] -= dt;
          if (T.timer[i] <= 0) T.set(i, Mat.Water);
        }
      }
    }
    // entities interacting with the ground
    for (const e of this.list) {
      if (!e.alive || e.kind === 'projectile' || e.kind === 'beam' || e.kind === 'field' || e.invMass <= 0 && e.kind !== 'dummy') continue;
      const m = T.at(e.pos);
      if (m === Mat.Fire) this.ignite(e, 2, 8);
      else if (m === Mat.Lava) {
        this.damage(e, 30 * dt, 'fire', 0, { quiet: true });
        this.ignite(e, 3, 10);
      } else if (m === Mat.Water) {
        e.status.wet = Math.max(e.status.wet, 2.5);
        if (e.status.burning > 0) {
          e.status.burning = 0;
          this.emit({ type: 'steam', pos: V.copy(e.pos) });
        }
      } else if (m === Mat.Spikes) this.damage(e, 18 * dt, 'force', 0, { quiet: true });
    }
  }
}

