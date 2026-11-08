import { V, type EntityId } from '../types';
import { MAT_NAMES, matFromName } from '../../sim/terrain';
import type { TargetFilter } from '../../sim/world';
import { FILTER_OPTIONS, P, type NodeDef } from './defs';

const filterParam = (def: string = 'hostile') => ({ id: 'filter', label: 'Filter', kind: 'enum' as const, default: def, options: FILTER_OPTIONS });

export const QUERY_NODES: NodeDef[] = [
  {
    type: 'findInRadius',
    title: 'Find In Radius',
    category: 'query',
    icon: '◎',
    pure: true,
    cost: 0.6,
    keywords: ['area', 'targets', 'select', 'nearby'],
    description: 'All matching entities within Radius of Center, nearest first (capped at Max).',
    params: [filterParam()],
    inputs: [P.vec('center', 'Center', 'target'), P.num('radius', 'Radius', 200, { min: 0 }), P.num('max', 'Max', 16, { min: 1, max: 256, step: 1 })],
    outputs: [P.out('list', 'Entities', 'entities'), P.out('count', 'Count', 'number'), P.out('any', 'Any found', 'bool')],
    eval: (c) => {
      const list = c.world.inRadius(c.vec('center'), Math.max(0, c.num('radius')), c.param('filter') as TargetFilter, c.inst.casterId);
      const ids = list.slice(0, Math.max(1, Math.min(256, Math.floor(c.num('max'))))).map((e) => e.id);
      c.out('list', ids);
      c.out('count', ids.length);
      c.out('any', ids.length > 0);
    },
  },
  {
    type: 'nearest',
    title: 'Nearest',
    category: 'query',
    icon: '⌖',
    pure: true,
    cost: 0.4,
    keywords: ['closest', 'target', 'lock'],
    description: 'The closest matching entity to a point, within Range.',
    params: [filterParam()],
    inputs: [P.vec('p', 'Point', 'target'), P.num('range', 'Range', 600, { min: 0 }), P.ent('exclude', 'Exclude')],
    outputs: [P.out('e', 'Entity', 'entity'), P.out('found', 'Found', 'bool'), P.out('pos', 'Position', 'vector'), P.out('dist', 'Distance', 'number')],
    eval: (c) => {
      const p = c.vec('p');
      const ex = c.ent('exclude');
      const e = c.world.nearest(p, Math.max(0, c.num('range')), c.param('filter') as TargetFilter, ex ? new Set([ex]) : undefined, c.inst.casterId);
      c.out('e', e ? e.id : 0);
      c.out('found', !!e);
      c.out('pos', e ? V.copy(e.pos) : p);
      c.out('dist', e ? V.dist(e.pos, p) : 0);
    },
  },
  {
    type: 'raycast',
    title: 'Raycast',
    category: 'query',
    icon: '⟶',
    pure: true,
    cost: 0.5,
    keywords: ['line', 'sight', 'trace'],
    description: 'Traces a line and reports the first solid thing it hits.',
    inputs: [P.vec('o', 'Origin', 'casterPos'), P.vec('dir', 'Direction', 'aim'), P.num('len', 'Length', 800, { min: 1 })],
    outputs: [P.out('hit', 'Hit', 'bool'), P.out('point', 'Point', 'vector'), P.out('e', 'Entity', 'entity'), P.out('normal', 'Normal', 'vector'), P.out('dist', 'Distance', 'number')],
    eval: (c) => {
      const caster = c.inst.casterId;
      const r = c.world.raycast(c.vec('o'), c.vec('dir'), Math.max(1, c.num('len')), (e) => e.solid && e.id !== caster);
      c.out('hit', r.hit);
      c.out('point', r.pos);
      c.out('e', r.entity ? r.entity.id : 0);
      c.out('normal', r.normal);
      c.out('dist', r.dist);
    },
  },
  {
    type: 'filter',
    title: 'Filter Entities',
    category: 'query',
    icon: '⫶',
    pure: true,
    cost: 0.3,
    description: 'Keeps only entities that match the filter (and are alive).',
    params: [filterParam('enemies')],
    inputs: [P.ents('list', 'List')],
    outputs: [P.out('list', 'Entities', 'entities'), P.out('count', 'Count', 'number')],
    eval: (c) => {
      const f = c.param('filter') as TargetFilter;
      const out = c.ents('list').filter((id) => {
        const e = c.world.get(id);
        return !!e && c.world.matches(e, f, c.inst.casterId);
      });
      c.out('list', out);
      c.out('count', out.length);
    },
  },
  {
    type: 'sortEntities',
    title: 'Sort & Take',
    category: 'query',
    icon: '⇅',
    pure: true,
    cost: 0.3,
    keywords: ['weakest', 'strongest', 'closest', 'farthest'],
    description: 'Sorts entities by distance to a point or by health, then keeps the first N.',
    params: [
      {
        id: 'key',
        label: 'Order',
        kind: 'enum',
        default: 'nearest',
        options: [
          { value: 'nearest', label: 'Nearest first' },
          { value: 'farthest', label: 'Farthest first' },
          { value: 'weakest', label: 'Lowest health' },
          { value: 'strongest', label: 'Highest health' },
          { value: 'random', label: 'Shuffle' },
        ],
      },
    ],
    inputs: [P.ents('list', 'List'), P.vec('p', 'Point', 'target'), P.num('n', 'Take', 3, { min: 1, max: 256, step: 1 })],
    outputs: [P.out('list', 'Entities', 'entities'), P.out('first', 'First', 'entity')],
    eval: (c) => {
      const p = c.vec('p');
      const ents = c.ents('list').map((id) => c.world.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
      const key = c.param('key');
      if (key === 'random') {
        for (let i = ents.length - 1; i > 0; i--) {
          const j = Math.floor(c.random() * (i + 1));
          [ents[i], ents[j]] = [ents[j], ents[i]];
        }
      } else
        ents.sort((a, b) =>
          key === 'nearest' ? V.dist2(a.pos, p) - V.dist2(b.pos, p) : key === 'farthest' ? V.dist2(b.pos, p) - V.dist2(a.pos, p) : key === 'weakest' ? a.hp - b.hp : b.hp - a.hp,
        );
      const ids = ents.slice(0, Math.max(1, Math.floor(c.num('n')))).map((e) => e.id);
      c.out('list', ids);
      c.out('first', ids[0] ?? 0);
    },
  },
  {
    type: 'listOps',
    title: 'List Info',
    category: 'query',
    icon: '[ ]',
    pure: true,
    cost: 0.2,
    description: 'Count, first, last, an indexed item, a random item and the centroid of a list.',
    inputs: [P.ents('list', 'List'), P.num('i', 'Index', 0, { step: 1 })],
    outputs: [
      P.out('count', 'Count', 'number'),
      P.out('first', 'First', 'entity'),
      P.out('last', 'Last', 'entity'),
      P.out('at', 'At index', 'entity'),
      P.out('rand', 'Random', 'entity'),
      P.out('center', 'Centroid', 'vector'),
    ],
    eval: (c) => {
      const l = c.ents('list').filter((id) => !!c.world.get(id));
      const i = Math.floor(c.num('i'));
      c.out('count', l.length);
      c.out('first', l[0] ?? 0);
      c.out('last', l[l.length - 1] ?? 0);
      c.out('at', l.length ? l[((i % l.length) + l.length) % l.length] : 0);
      c.out('rand', l.length ? l[Math.floor(c.random() * l.length)] : 0);
      let x = 0;
      let y = 0;
      for (const id of l) {
        const e = c.world.get(id)!;
        x += e.pos.x;
        y += e.pos.y;
      }
      c.out('center', l.length ? { x: x / l.length, y: y / l.length } : { x: 0, y: 0 });
    },
  },
  {
    type: 'combineLists',
    title: 'Combine Lists',
    category: 'query',
    icon: '∪',
    pure: true,
    cost: 0.2,
    description: 'Union of two lists (duplicates removed), or the entities in A not in B.',
    params: [
      {
        id: 'op',
        label: 'Op',
        kind: 'enum',
        default: 'union',
        options: [
          { value: 'union', label: 'A ∪ B' },
          { value: 'minus', label: 'A − B' },
          { value: 'both', label: 'A ∩ B' },
        ],
      },
    ],
    inputs: [P.ents('a', 'A'), P.ents('b', 'B')],
    outputs: [P.out('list', 'Entities', 'entities')],
    eval: (c) => {
      const a = c.ents('a');
      const b = new Set(c.ents('b'));
      const op = c.param('op');
      let out: EntityId[];
      if (op === 'union') out = [...new Set([...a, ...b])];
      else if (op === 'minus') out = a.filter((x) => !b.has(x));
      else out = a.filter((x) => b.has(x));
      c.out('list', out);
    },
  },
  {
    type: 'entityInfo',
    title: 'Entity Info',
    category: 'query',
    icon: 'ⓘ',
    pure: true,
    cost: 0.2,
    description: 'Everything about an entity: position, velocity, health, size and allegiance.',
    inputs: [P.ent('e', 'Entity', 'caster')],
    outputs: [
      P.out('pos', 'Position', 'vector'),
      P.out('vel', 'Velocity', 'vector'),
      P.out('hp', 'Health', 'number'),
      P.out('hpPct', 'Health %', 'number'),
      P.out('alive', 'Alive', 'bool'),
      P.out('radius', 'Radius', 'number'),
      P.out('enemy', 'Is enemy', 'bool'),
      P.out('element', 'Element', 'element'),
    ],
    eval: (c) => {
      const id = c.ent('e');
      const e = c.world.get(id);
      c.out('pos', e ? V.copy(e.pos) : c.world.posOf(id));
      c.out('vel', e ? V.copy(e.vel) : { x: 0, y: 0 });
      c.out('hp', e ? e.hp : 0);
      c.out('hpPct', e && e.maxHp > 0 ? (e.hp / e.maxHp) * 100 : 0);
      c.out('alive', !!e);
      c.out('radius', e ? e.r : 0);
      c.out('enemy', !!e && e.team === 1);
      c.out('element', e ? e.element : 'arcane');
    },
  },
  {
    type: 'hasStatus',
    title: 'Has Status',
    category: 'query',
    icon: '◈',
    pure: true,
    cost: 0.2,
    description: 'Is the entity burning, frozen, chilled, wet, shocked or shielded?',
    params: [
      {
        id: 'status',
        label: 'Status',
        kind: 'enum',
        default: 'burning',
        options: ['burning', 'frozen', 'chilled', 'wet', 'shocked', 'shielded', 'polymorphed'].map((v) => ({ value: v, label: v })),
      },
    ],
    inputs: [P.ent('e', 'Entity')],
    outputs: [P.out('r', 'Result', 'bool')],
    eval: (c) => {
      const e = c.world.get(c.ent('e'));
      if (!e) return c.out('r', false);
      const s = e.status;
      const map: Record<string, boolean> = {
        burning: s.burning > 0,
        frozen: s.frozen > 0,
        chilled: s.chilled > 0,
        wet: s.wet > 0,
        shocked: s.shocked > 0,
        shielded: s.shield > 0,
        polymorphed: s.polymorph > 0,
      };
      c.out('r', map[String(c.param('status'))] ?? false);
    },
  },
  {
    type: 'casterInfo',
    title: 'Caster',
    category: 'query',
    icon: '♆',
    pure: true,
    cost: 0.1,
    keywords: ['self', 'me', 'player', 'mana'],
    description: 'The wizard casting this spell, their position and remaining mana.',
    inputs: [],
    outputs: [P.out('e', 'Caster', 'entity'), P.out('pos', 'Position', 'vector'), P.out('mana', 'Mana', 'number'), P.out('hp', 'Health', 'number')],
    eval: (c) => {
      const e = c.world.get(c.inst.casterId);
      c.out('e', c.inst.casterId);
      c.out('pos', e ? V.copy(e.pos) : { x: 0, y: 0 });
      c.out('mana', e?.mana?.cur ?? 0);
      c.out('hp', e?.hp ?? 0);
    },
  },
  {
    type: 'terrainAt',
    title: 'Terrain At',
    category: 'query',
    icon: '▦',
    pure: true,
    cost: 0.2,
    keywords: ['ground', 'water', 'oil', 'environment'],
    description: 'Checks the ground material at a point.',
    params: [{ id: 'mat', label: 'Material', kind: 'enum', default: 'water', options: MAT_NAMES.map((m) => ({ value: m, label: m })) }],
    inputs: [P.vec('p', 'Point', 'target')],
    outputs: [P.out('r', 'Is material', 'bool')],
    eval: (c) => c.out('r', c.world.terrain.at(c.vec('p')) === matFromName(String(c.param('mat')))),
  },
];
