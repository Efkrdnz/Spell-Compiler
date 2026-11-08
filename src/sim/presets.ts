import { V, type Vec } from '../core/types';
import { makeAI } from './ai';
import type { AIBehavior, Entity, EntityKind } from './entity';
import { Mat } from './terrain';
import type { World } from './world';

export interface ArenaConfig {
  enemyCount: number;
  enemyHp: number; // multiplier
  behavior: AIBehavior | 'mixed';
  respawn: boolean;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = { enemyCount: 6, enemyHp: 1, behavior: 'mixed', respawn: true };

export interface ArenaPreset {
  id: string;
  name: string;
  description: string;
  build: (w: World, cfg: ArenaConfig) => void;
}

const CASTER_POS: Vec = { x: 190, y: 450 };

function caster(w: World): Entity {
  return w.spawn('caster', CASTER_POS, { label: 'You' });
}

function dummy(w: World, p: Vec, hp = 400): Entity {
  const e = w.spawn('dummy', p, { hp: hp, respawn: { pos: V.copy(p), delay: 2.5, t: 0 } });
  return e;
}

function enemy(w: World, p: Vec, behavior: AIBehavior, cfg: ArenaConfig, element: Entity['element'] = 'arcane'): Entity {
  const hp = 90 * cfg.enemyHp;
  const e = w.spawn('enemy', p, {
    hp,
    element,
    ai: makeAI(behavior, p, behavior === 'ranged' ? 70 : behavior === 'strafe' ? 120 : 85),
    respawn: cfg.respawn ? { pos: V.copy(p), delay: 4, t: 0 } : undefined,
  });
  if (behavior === 'ranged') e.r = 14;
  // elemental foes resist their own element and are weak to its opposite
  const RESIST: Partial<Record<Entity['element'], Partial<Record<Entity['element'], number>>>> = {
    fire: { fire: 0.25, ice: 1.6 },
    ice: { ice: 0.25, fire: 1.6 },
    lightning: { lightning: 0.25, force: 1.4 },
    void: { void: 0.25, life: 1.8 },
  };
  e.resist = { ...(RESIST[element] ?? {}) };
  return e;
}

function pickBehavior(cfg: ArenaConfig, i: number): AIBehavior {
  if (cfg.behavior !== 'mixed') return cfg.behavior;
  const cycle: AIBehavior[] = ['chase', 'chase', 'ranged', 'strafe'];
  return cycle[i % cycle.length];
}

function prop(w: World, kind: EntityKind, p: Vec, over: Partial<Entity> = {}): Entity {
  return w.spawn(kind, p, over);
}

function wall(w: World, x: number, y: number, hw: number, hh: number, destructible = true): Entity {
  return w.spawn('wall', { x, y }, { hw, hh, hp: destructible ? 60 * Math.max(1, (hw * hh) / 400) : 1e9, destructible });
}

function patrolTarget(w: World, path: Vec[], speed: number, cfg: ArenaConfig): Entity {
  return w.spawn('target', path[0], {
    hp: 60 * cfg.enemyHp,
    ai: makeAI('patrol', path[0], speed, { path }),
    respawn: { pos: V.copy(path[0]), delay: 2, t: 0 },
  });
}

export const PRESETS: ArenaPreset[] = [
  {
    id: 'training',
    name: 'Training Grounds',
    description: 'Sturdy dummies, a moving target lane, crates and a pond. The default lab.',
    build(w, cfg) {
      caster(w);
      const ys = [250, 360, 470, 580, 690];
      ys.forEach((y, i) => dummy(w, { x: 900 + Math.abs(i - 2) * 60, y }));
      patrolTarget(w, [{ x: 1350, y: 140 }, { x: 1350, y: 760 }], 140, cfg);
      patrolTarget(w, [{ x: 1480, y: 760 }, { x: 1480, y: 140 }], 110, cfg);
      for (let i = 0; i < 6; i++) prop(w, 'crate', { x: 600 + (i % 2) * 36, y: 180 + Math.floor(i / 2) * 36 });
      prop(w, 'barrel', { x: 640, y: 720 });
      prop(w, 'barrel', { x: 672, y: 742 });
      prop(w, 'metal', { x: 600, y: 470 });
      prop(w, 'boulder', { x: 520, y: 640 });
      w.terrain.paintCircle({ x: 1120, y: 470 }, 90, Mat.Water);
      w.terrain.paintRect(400, 80, 760, 140, Mat.Grass);
      w.spawn('pillar', { x: 760, y: 470 });
    },
  },
  {
    id: 'horde',
    name: 'Horde',
    description: 'Enemies close in from every side. Chasers, strafers and casters. Test crowd control.',
    build(w, cfg) {
      caster(w).pos = { x: 800, y: 450 };
      const n = Math.max(1, cfg.enemyCount * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = { x: 800 + Math.cos(a) * 640, y: 450 + Math.sin(a) * 380 };
        enemy(w, w.clampToArena(p, 30), pickBehavior(cfg, i), cfg, i % 5 === 0 ? 'fire' : i % 7 === 3 ? 'ice' : 'arcane');
      }
      w.spawn('pillar', { x: 560, y: 300 });
      w.spawn('pillar', { x: 1040, y: 600 });
      prop(w, 'barrel', { x: 1040, y: 300 });
      prop(w, 'barrel', { x: 560, y: 600 });
    },
  },
  {
    id: 'physics',
    name: 'Physics Playground',
    description: 'Crate towers, boulders, heavy metal blocks and walls. Push, pull and pulverise.',
    build(w) {
      caster(w);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) prop(w, 'crate', { x: 700 + c * 34, y: 290 + r * 34 });
      for (let i = 0; i < 5; i++) prop(w, 'boulder', { x: 1050 + (i % 2) * 70, y: 200 + i * 120 });
      for (let i = 0; i < 4; i++) prop(w, 'metal', { x: 520, y: 220 + i * 150 });
      wall(w, 1300, 450, 20, 180);
      wall(w, 900, 120, 120, 16);
      wall(w, 900, 780, 120, 16);
      for (let i = 0; i < 3; i++) dummy(w, { x: 1450, y: 300 + i * 150 }, 300);
      for (let i = 0; i < 4; i++) prop(w, 'barrel', { x: 1200 + i * 30, y: 820 });
    },
  },
  {
    id: 'elements',
    name: 'Elemental Garden',
    description: 'Water to freeze or electrify, grass and oil to ignite, a lava channel. Reactions everywhere.',
    build(w, cfg) {
      caster(w);
      const T = w.terrain;
      T.paintCircle({ x: 760, y: 250 }, 150, Mat.Water);
      T.paintRect(1080, 80, 1560, 380, Mat.Grass);
      T.paintRect(1080, 520, 1560, 840, Mat.Oil);
      T.paintRect(560, 600, 980, 660, Mat.Lava);
      T.paintRect(380, 760, 720, 860, Mat.Grass);
      // dummies standing in water: lightning heaven
      dummy(w, { x: 720, y: 220 }, 300);
      dummy(w, { x: 820, y: 290 }, 300);
      for (let i = 0; i < 6; i++) prop(w, 'crate', { x: 1180 + (i % 3) * 120, y: 160 + Math.floor(i / 3) * 120 });
      for (let i = 0; i < 4; i++) prop(w, 'barrel', { x: 1200 + i * 90, y: 640 + (i % 2) * 70 });
      for (let i = 0; i < Math.min(8, cfg.enemyCount); i++) enemy(w, { x: 1250 + (i % 4) * 70, y: 450 + Math.floor(i / 4) * 40 }, 'idle', cfg);
      prop(w, 'metal', { x: 600, y: 400 });
      prop(w, 'metal', { x: 640, y: 400 });
    },
  },
  {
    id: 'chain',
    name: 'Chain Reaction',
    description: 'A field of explosive barrels around unlucky dummies. One spark is enough.',
    build(w) {
      caster(w);
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 9; c++) {
          const p = { x: 760 + c * 68 + (r % 2) * 34, y: 160 + r * 96 };
          if ((r + c) % 4 === 0) dummy(w, p, 250);
          else prop(w, (r * c) % 5 === 1 ? 'crate' : 'barrel', p);
        }
      w.terrain.paintRect(720, 120, 1440, 820, Mat.Oil);
    },
  },
  {
    id: 'gauntlet',
    name: 'Shooting Gallery',
    description: 'Fast patrolling targets behind cover, with spike strips. Test homing, bouncing, piercing and knockback spells.',
    build(w, cfg) {
      caster(w);
      for (let i = 0; i < 4; i++) wall(w, 700, 150 + i * 200, 14, 50);
      w.spawn('pillar', { x: 1000, y: 300 });
      w.spawn('pillar', { x: 1000, y: 600 });
      patrolTarget(w, [{ x: 900, y: 120 }, { x: 1500, y: 120 }], 220, cfg);
      patrolTarget(w, [{ x: 1500, y: 780 }, { x: 900, y: 780 }], 200, cfg);
      patrolTarget(w, [{ x: 1200, y: 200 }, { x: 1450, y: 450 }, { x: 1200, y: 700 }, { x: 950, y: 450 }], 180, cfg);
      patrolTarget(w, [{ x: 1300, y: 450 }, { x: 1300, y: 120 }], 160, cfg);
      for (let i = 0; i < 3; i++) dummy(w, { x: 1520, y: 300 + i * 150 }, 300);
      // spike strips: shove foes onto them
      w.terrain.paintRect(820, 400, 1180, 500, Mat.Spikes);
      w.terrain.paintRect(1240, 40, 1560, 80, Mat.Spikes);
    },
  },
  {
    id: 'empty',
    name: 'Empty Void',
    description: 'Nothing but you and the floor. Use the spawn tools to build your own experiment.',
    build(w) {
      caster(w).pos = { x: 800, y: 450 };
    },
  },
];

export function buildPreset(w: World, id: string, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): void {
  const keepMana = w.caster?.mana;
  w.clear();
  w.settings.respawn = cfg.respawn;
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  p.build(w, cfg);
  const c = w.caster;
  if (c && keepMana) c.mana = { ...keepMana, cur: keepMana.max };
}

/** Spawnable things for the arena's spawn tool. */
export const SPAWNABLES: { kind: string; label: string }[] = [
  { kind: 'dummy', label: 'Dummy' },
  { kind: 'enemy:chase', label: 'Chaser' },
  { kind: 'enemy:ranged', label: 'Caster foe' },
  { kind: 'target', label: 'Target' },
  { kind: 'crate', label: 'Crate' },
  { kind: 'barrel', label: 'Barrel' },
  { kind: 'metal', label: 'Metal' },
  { kind: 'boulder', label: 'Boulder' },
  { kind: 'wall', label: 'Wall' },
  { kind: 'paint:water', label: 'Water' },
  { kind: 'paint:oil', label: 'Oil' },
  { kind: 'paint:grass', label: 'Grass' },
  { kind: 'paint:lava', label: 'Lava' },
  { kind: 'paint:spikes', label: 'Spikes' },
  { kind: 'paint:floor', label: 'Erase' },
];

export function spawnAt(w: World, kind: string, p: Vec, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): Entity | null {
  if (kind.startsWith('paint:')) {
    const m = kind.slice(6);
    const map: Record<string, Mat> = { water: Mat.Water, oil: Mat.Oil, grass: Mat.Grass, lava: Mat.Lava, spikes: Mat.Spikes, floor: Mat.Floor };
    w.terrain.paintCircle(p, 40, map[m] ?? Mat.Floor);
    return null;
  }
  if (kind.startsWith('enemy:')) return enemy(w, p, kind.slice(6) as AIBehavior, cfg);
  if (kind === 'dummy') return dummy(w, p);
  if (kind === 'target') return patrolTarget(w, [p, { x: p.x, y: p.y + 200 }], 120, cfg);
  if (kind === 'wall') return wall(w, p.x, p.y, 14, 50);
  return w.spawn(kind as EntityKind, p);
}
