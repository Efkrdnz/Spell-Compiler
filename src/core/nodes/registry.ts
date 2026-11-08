import type { Literal } from '../types';
import { CATEGORY_INFO, type Category, type NodeDef } from './defs';
import { EFFECT_NODES } from './effects';
import { FLOW_NODES } from './flow';
import { MATH_NODES } from './math';
import { QUERY_NODES } from './query';

export const NODE_DEFS: NodeDef[] = [...FLOW_NODES, ...EFFECT_NODES, ...QUERY_NODES, ...MATH_NODES];

const BY_TYPE = new Map<string, NodeDef>(NODE_DEFS.map((d) => [d.type, d]));

export function getDef(type: string): NodeDef | undefined {
  return BY_TYPE.get(type);
}

/** A palette entry: a node type, optionally with preset values (e.g. Gravity Well = Force Field{kind:gravity}). */
export interface PaletteEntry {
  key: string;
  type: string;
  title: string;
  category: Category;
  description: string;
  icon: string;
  values?: Record<string, Literal>;
  keywords: string[];
}

const PRESETS: Omit<PaletteEntry, 'category' | 'icon' | 'keywords'>[] = [
  { key: 'fireball', type: 'projectile', title: 'Fire Bolt', description: 'A projectile preset: fire, medium speed.', values: { element: 'fire', damage: 24, size: 10, speed: 620 } },
  { key: 'iceShard', type: 'projectile', title: 'Ice Shard', description: 'Fast, small, piercing ice.', values: { element: 'ice', damage: 14, size: 5, speed: 950, pierce: 2 } },
  { key: 'bouncer', type: 'projectile', title: 'Ricochet Orb', description: 'Bounces off walls five times.', values: { element: 'force', damage: 16, bounces: 5, life: 4 } },
  { key: 'gravityWell', type: 'field', title: 'Gravity Well', description: 'Pulls everything (and projectiles) inward.', values: { kind: 'gravity', element: 'void', radius: 170, strength: 1100, duration: 3 } },
  { key: 'repulsor', type: 'field', title: 'Repulsor Field', description: 'Pushes everything away from its center.', values: { kind: 'repel', element: 'force', radius: 150, strength: 1400, duration: 2 } },
  { key: 'vortex', type: 'field', title: 'Vortex', description: 'A whirlwind that spins things around.', values: { kind: 'vortex', element: 'force', radius: 160, strength: 500, duration: 3 } },
  { key: 'stasis', type: 'field', title: 'Stasis Bubble', description: 'Slows everything inside to a crawl.', values: { kind: 'stasis', element: 'arcane', radius: 140, strength: 400, duration: 4 } },
  { key: 'fireZone', type: 'field', title: 'Firestorm Zone', description: 'Burning ground that damages over time.', values: { kind: 'zone', element: 'fire', radius: 120, strength: 0, duration: 4, dps: 25 } },
  { key: 'healZone', type: 'field', title: 'Sanctuary', description: 'Heals allies inside, sears foes.', values: { kind: 'zone', element: 'life', radius: 130, strength: 0, duration: 5, dps: 20 } },
  { key: 'frostZone', type: 'field', title: 'Blizzard', description: 'Chills and freezes, turns water to ice.', values: { kind: 'zone', element: 'ice', radius: 150, strength: 0, duration: 4, dps: 12 } },
  { key: 'iceExplosion', type: 'explosion', title: 'Frost Nova', description: 'Ice blast that freezes water and chills foes.', values: { element: 'ice', radius: 140, damage: 20, force: 200 } },
  { key: 'thunderclap', type: 'explosion', title: 'Thunderclap', description: 'Lightning blast; electrifies water.', values: { element: 'lightning', radius: 110, damage: 30, force: 300 } },
  { key: 'implosion', type: 'radialForce', title: 'Implosion', description: 'Pulls everything toward a point instantly.', values: { strength: -900, radius: 220 } },
  { key: 'flamethrower', type: 'beam', title: 'Flame Jet', description: 'Short, wide fire beam.', values: { element: 'fire', length: 260, width: 34, dps: 70, duration: 0.25 } },
  { key: 'lightningTurret', type: 'summon', title: 'Tesla Turret', description: 'A turret that zaps nearby foes.', values: { kind: 'turret', element: 'lightning', damage: 12, rate: 0.6 } },
  { key: 'wisp', type: 'summon', title: 'Wisp Familiar', description: 'Orbits you and shoots at foes.', values: { kind: 'wisp', element: 'arcane', damage: 8, rate: 0.5 } },
];

let paletteCache: PaletteEntry[] | null = null;

export function palette(): PaletteEntry[] {
  if (paletteCache) return paletteCache;
  const entries: PaletteEntry[] = NODE_DEFS.map((d) => ({ key: d.type, type: d.type, title: d.title, category: d.category, description: d.description, icon: d.icon, keywords: d.keywords ?? [] }));
  for (const p of PRESETS) {
    const d = BY_TYPE.get(p.type)!;
    entries.push({ ...p, category: d.category, icon: d.icon, keywords: [...(d.keywords ?? []), d.title.toLowerCase(), 'preset'] });
  }
  entries.sort((a, b) => CATEGORY_INFO[a.category].order - CATEGORY_INFO[b.category].order);
  paletteCache = entries;
  return entries;
}
