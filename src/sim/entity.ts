import type { Element, EntityId, Vec } from '../core/types';

export type EntityKind =
  | 'caster'
  | 'dummy'
  | 'enemy'
  | 'target'
  | 'crate'
  | 'barrel'
  | 'metal'
  | 'wall'
  | 'pillar'
  | 'boulder'
  | 'projectile'
  | 'field'
  | 'beam'
  | 'summon'
  | 'barrier'
  | 'sheep'
  | 'iceblock';

export type Team = 0 | 1 | 2; // 0 = player side, 1 = hostile, 2 = neutral

export type Shape = 'circle' | 'box';

export type FieldKind = 'gravity' | 'attract' | 'repel' | 'vortex' | 'stasis' | 'zone';

export type SummonKind = 'turret' | 'wisp' | 'golem';

export type AIBehavior = 'idle' | 'chase' | 'strafe' | 'ranged' | 'patrol' | 'flee';

/**
 * Opaque handle to an interpreter continuation. The simulation never looks
 * inside; it just hands it back with event values when the event fires.
 */
export type Hook = { readonly __hook: true } & object;

export interface EventHooks {
  hit?: Hook;
  expire?: Hook;
  tick?: Hook;
  enter?: Hook;
  attack?: Hook;
  death?: Hook;
}

export interface Status {
  burning: number; // seconds remaining
  burnDps: number;
  frozen: number;
  chilled: number;
  shocked: number;
  wet: number;
  shield: number; // absorb amount
  shieldTime: number;
  polymorph: number;
  stun: number;
  regen: number; // heal per second
  regenTime: number;
}

export function emptyStatus(): Status {
  return {
    burning: 0,
    burnDps: 0,
    frozen: 0,
    chilled: 0,
    shocked: 0,
    wet: 0,
    shield: 0,
    shieldTime: 0,
    polymorph: 0,
    stun: 0,
    regen: 0,
    regenTime: 0,
  };
}

export interface ProjectileData {
  damage: number;
  speed: number;
  life: number;
  maxLife: number;
  pierce: number;
  bounces: number;
  gravity: number;
  drag: number;
  knockback: number;
  homingTarget: EntityId;
  homingStrength: number;
  /** entities already hit (for pierce) */
  hitSet: Set<EntityId>;
  /** owner is immune until this age */
  ownerGrace: number;
  tickInterval: number;
  tickAcc: number;
}

export interface FieldData {
  kind: FieldKind;
  radius: number;
  strength: number;
  life: number;
  maxLife: number;
  dps: number;
  affectsProjectiles: boolean;
  /** entities currently inside (for enter events) */
  inside: Set<EntityId>;
  tickInterval: number;
  tickAcc: number;
  followId: EntityId;
}

export interface BeamData {
  dir: Vec;
  length: number;
  width: number;
  life: number;
  maxLife: number;
  dps: number;
  end: Vec;
  followCaster: boolean;
  pierce: boolean;
  hitOnce: Set<EntityId>;
}

export interface OrbitData {
  anchor: EntityId;
  center: Vec;
  radius: number;
  angle: number;
  angVel: number;
  life: number;
}

export interface AIData {
  behavior: AIBehavior;
  speed: number;
  home: Vec;
  path: Vec[];
  pathIdx: number;
  attackCd: number;
  attackRate: number;
  attackDamage: number;
  targetId: EntityId;
  wanderT: number;
  wanderDir: Vec;
}

export interface SummonData {
  kind: SummonKind;
  life: number;
  maxLife: number;
  attackCd: number;
  attackRate: number;
  range: number;
  damage: number;
}

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  team: Team;
  label?: string;
  pos: Vec;
  vel: Vec;
  /** facing / rotation for rendering */
  angle: number;
  spin: number;
  shape: Shape;
  r: number; // circle radius, or bounding radius for boxes
  hw: number;
  hh: number;
  /** 0 = immovable */
  invMass: number;
  restitution: number;
  damping: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** collides with other bodies */
  solid: boolean;
  destructible: boolean;
  flammable: boolean;
  conductive: boolean;
  /** can be targeted / damaged by spells */
  hittable: boolean;
  element: Element;
  status: Status;
  resist: Partial<Record<Element, number>>;
  age: number;
  /** time since last damage, for hit flashes */
  flash: number;
  /** spell instance that created this entity (for attribution) */
  instance: number;
  ownerId: EntityId;
  scale: number;
  hooks: EventHooks;
  proj?: ProjectileData;
  field?: FieldData;
  beam?: BeamData;
  orbit?: OrbitData;
  ai?: AIData;
  summon?: SummonData;
  /** when polymorphed, the original kind restores after the timer */
  polyFrom?: { kind: EntityKind; r: number; ai?: AIData };
  /** explosive barrels: delayed detonation fuse */
  fuse?: number;
  /** generic lifetime for transient bodies (summoned props, ice blocks) */
  life?: number;
  /** casters only: mana pool */
  mana?: { cur: number; max: number; regen: number };
  /** accumulates small damage ticks into readable floating numbers */
  numAcc: number;
  numT: number;
  /** respawn point for training targets */
  respawn?: { pos: Vec; delay: number; t: number };
}
