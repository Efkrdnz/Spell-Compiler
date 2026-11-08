// ─────────────────────────────────────────────────────────────────────────────
// Core value & document model for the spell language. Framework-free.
// ─────────────────────────────────────────────────────────────────────────────

export type DataType = 'number' | 'bool' | 'vector' | 'entity' | 'entities' | 'element' | 'any';
export type PinType = 'exec' | DataType;

export interface Vec {
  x: number;
  y: number;
}

export const ELEMENTS = ['arcane', 'fire', 'ice', 'lightning', 'void', 'life', 'force'] as const;
export type Element = (typeof ELEMENTS)[number];

/** Entity references are numeric ids into the world. 0 = "no entity". */
export type EntityId = number;

/**
 * Runtime values are untagged; the compiler knows every pin's static type and
 * inserts coercions where needed, so the interpreter never type-switches.
 */
export type Value = number | boolean | Vec | EntityId[] | Element | string | null;

/** Literal values stored on nodes (inline pin values and parameters). */
export type Literal = number | boolean | string | Vec;

// ── Type compatibility ───────────────────────────────────────────────────────

export type Coercion = 'none' | 'entityToVector' | 'entityToEntities' | 'numberToBool' | 'boolToNumber' | 'entitiesToEntity' | 'entitiesToVector';

/**
 * Returns the coercion needed to feed a value of type `from` into a pin of type
 * `to`, or `null` if the connection is a type error.
 */
export function coercionFor(from: DataType, to: DataType): Coercion | null {
  if (from === to) return 'none';
  if (to === 'any' || from === 'any') return 'none';
  if (from === 'entity' && to === 'vector') return 'entityToVector';
  if (from === 'entity' && to === 'entities') return 'entityToEntities';
  if (from === 'entities' && to === 'entity') return 'entitiesToEntity';
  if (from === 'entities' && to === 'vector') return 'entitiesToVector';
  if (from === 'number' && to === 'bool') return 'numberToBool';
  if (from === 'bool' && to === 'number') return 'boolToNumber';
  return null;
}

export const TYPE_INFO: Record<PinType, { label: string; color: string; glyph: string; doc: string }> = {
  exec: { label: 'Flow', color: '#f4f1ff', glyph: '▶', doc: 'Execution flow. Fires nodes in order; event pins fire later.' },
  number: { label: 'Number', color: '#7cc7ff', glyph: '#', doc: 'A real number.' },
  bool: { label: 'Bool', color: '#ff6b8b', glyph: '?', doc: 'True or false. Numbers coerce (0 = false).' },
  vector: { label: 'Vector', color: '#ffd166', glyph: '↗', doc: 'A 2D point or direction. Entities coerce to their position.' },
  entity: { label: 'Entity', color: '#7dffb2', glyph: '◉', doc: 'A reference to something in the arena. May be dead or empty.' },
  entities: { label: 'Entities', color: '#3ee09a', glyph: '⁂', doc: 'A list of entities. A single entity coerces to a list.' },
  element: { label: 'Element', color: '#ff9cf0', glyph: '✦', doc: 'A magic element: arcane, fire, ice, lightning, void, life, force.' },
  any: { label: 'Any', color: '#c9c3e6', glyph: '∗', doc: 'Takes the type of whatever is connected.' },
};

// ── Spell documents (serialisable) ───────────────────────────────────────────

export interface SpellNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Inline literal values for unconnected data inputs, and node parameters. */
  values: Record<string, Literal>;
  /** Optional user comment shown on the node. */
  note?: string;
}

export interface SpellEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface SubspellParam {
  id: string;
  name: string;
  type: DataType;
}

export interface SpellGraph {
  id: string;
  name: string;
  nodes: SpellNode[];
  edges: SpellEdge[];
  /** Parameters for subspell graphs (ignored for the main graph). */
  params?: SubspellParam[];
}

export type VarScope = 'cast' | 'persistent';

export interface VarDecl {
  name: string;
  type: Exclude<DataType, 'any'>;
  scope: VarScope;
  initial: Literal;
}

export const SPELL_FORMAT = 'spell-compiler/1';

export interface SpellDoc {
  format: typeof SPELL_FORMAT;
  id: string;
  name: string;
  description: string;
  author?: string;
  tags: string[];
  /** Primary element, used for UI tinting and sigils. */
  element: Element;
  main: SpellGraph;
  subspells: SpellGraph[];
  variables: VarDecl[];
  /** Optional additional cooldown in seconds (added to the computed one). */
  extraCooldown?: number;
  created: number;
  updated: number;
}

// ── Diagnostics, tracing, profiling ──────────────────────────────────────────

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  graphId: string;
  nodeId?: string;
  edgeId?: string;
  port?: string;
}

export type TraceKind = 'cast' | 'exec' | 'event' | 'fizzle' | 'error' | 'log' | 'mana' | 'defer';

export interface TraceEntry {
  seq: number;
  t: number;
  kind: TraceKind;
  instance: number;
  spellId: string;
  graphId: string;
  nodeId?: string;
  depth: number;
  message: string;
}

export interface NodeProfile {
  graphId: string;
  nodeId: string;
  execs: number;
  timeMs: number;
  mana: number;
  lastT: number;
}

// ── Small vector helpers (used everywhere) ───────────────────────────────────

export const V = {
  make: (x = 0, y = 0): Vec => ({ x, y }),
  add: (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s }),
  len: (a: Vec): number => Math.hypot(a.x, a.y),
  dist: (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y),
  dist2: (a: Vec, b: Vec): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2,
  norm: (a: Vec): Vec => {
    const l = Math.hypot(a.x, a.y);
    return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
  },
  dot: (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y,
  cross: (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x,
  rot: (a: Vec, rad: number): Vec => {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
  },
  fromAngle: (rad: number, len = 1): Vec => ({ x: Math.cos(rad) * len, y: Math.sin(rad) * len }),
  angle: (a: Vec): number => Math.atan2(a.y, a.x),
  lerp: (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  perp: (a: Vec): Vec => ({ x: -a.y, y: a.x }),
  copy: (a: Vec): Vec => ({ x: a.x, y: a.y }),
  isVec: (v: unknown): v is Vec =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Vec).x === 'number' && typeof (v as Vec).y === 'number',
};

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

let idCounter = 0;
export function uid(prefix = 'n'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${idCounter.toString(36)}`;
}

/** Deterministic string hash (FNV-1a) used for sigils and seeding. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ELEMENT_INFO: Record<Element, { label: string; color: string; glow: string; dark: string; glyph: string }> = {
  arcane: { label: 'Arcane', color: '#c77dff', glow: '#e9c6ff', dark: '#3a1060', glyph: '✧' },
  fire: { label: 'Fire', color: '#ff7a2f', glow: '#ffd27a', dark: '#5a1600', glyph: '🜂' },
  ice: { label: 'Ice', color: '#6fe3ff', glow: '#e4fbff', dark: '#0b3a52', glyph: '❄' },
  lightning: { label: 'Lightning', color: '#9fa8ff', glow: '#f2f0ff', dark: '#1a1f6b', glyph: 'ϟ' },
  void: { label: 'Void', color: '#8a4dff', glow: '#d9b8ff', dark: '#12002a', glyph: '◎' },
  life: { label: 'Life', color: '#7dff9c', glow: '#f3ffc4', dark: '#0b4020', glyph: '✚' },
  force: { label: 'Force', color: '#e8eefc', glow: '#ffffff', dark: '#2c3550', glyph: '◈' },
};
