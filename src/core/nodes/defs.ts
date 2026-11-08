import type { DataType, Element, EntityId, Literal, PinType, SpellDoc, SpellGraph, SpellNode, Value, Vec } from '../types';
import type { Entity, EventHooks, Hook } from '../../sim/entity';
import type { World } from '../../sim/world';

/**
 * Auto-sources: an unconnected input with `auto` set draws its value from the
 * cast context instead of an inline literal. This lets `On Cast -> Projectile`
 * work with zero wiring (fires from the caster toward the cursor).
 */
export type AutoSource = 'caster' | 'casterPos' | 'aim' | 'target' | 'origin' | 'none';

export interface PortDef {
  id: string;
  label: string;
  type: PinType;
  /** inline literal default for unconnected data inputs */
  default?: Literal;
  auto?: AutoSource;
  min?: number;
  max?: number;
  step?: number;
  doc?: string;
  /** exec outputs only: fires later from the simulation (an event), not synchronously */
  event?: boolean;
  /** exec outputs only: async continuation (Delay/Every) – breaks synchronous cycles */
  async?: boolean;
  /** data outputs only: valid only in flows downstream of these exec outputs */
  scope?: string[];
  /** data outputs only: filled from this key of the event payload when an event fires */
  eventKey?: string;
}

export type ParamKind = 'enum' | 'number' | 'string' | 'bool' | 'element' | 'variable' | 'subspell' | 'spell';

export interface ParamDef {
  id: string;
  label: string;
  kind: ParamKind;
  default: Literal;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  doc?: string;
}

export type Category =
  | 'trigger'
  | 'flow'
  | 'math'
  | 'logic'
  | 'vector'
  | 'query'
  | 'projectile'
  | 'area'
  | 'force'
  | 'element'
  | 'transform'
  | 'summon'
  | 'variable'
  | 'subspell'
  | 'debug';

export const CATEGORY_INFO: Record<Category, { label: string; color: string; order: number }> = {
  trigger: { label: 'Triggers', color: '#ffcf5c', order: 0 },
  flow: { label: 'Flow & Time', color: '#b8b5d6', order: 1 },
  projectile: { label: 'Projectiles', color: '#ff8a4c', order: 2 },
  area: { label: 'Beams & Areas', color: '#ff5fa2', order: 3 },
  force: { label: 'Force & Gravity', color: '#a78bff', order: 4 },
  element: { label: 'Elements', color: '#5fd4ff', order: 5 },
  transform: { label: 'Transmutation', color: '#e58cff', order: 6 },
  summon: { label: 'Summoning', color: '#7dffb2', order: 7 },
  query: { label: 'Targeting', color: '#7dffb2', order: 8 },
  math: { label: 'Math', color: '#7cc7ff', order: 9 },
  logic: { label: 'Logic', color: '#ff6b8b', order: 10 },
  vector: { label: 'Vectors', color: '#ffd166', order: 11 },
  variable: { label: 'Variables', color: '#ffa94d', order: 12 },
  subspell: { label: 'Subspells', color: '#ffe08a', order: 13 },
  debug: { label: 'Debug', color: '#9aa0b8', order: 14 },
};

/** What dynamic port functions may look at. */
export interface GraphEnv {
  doc: SpellDoc;
  graph: SpellGraph;
  /** other library spells, for Cast Spell */
  spellName?: (id: string) => string | undefined;
}

export interface SpellInstanceLike {
  id: number;
  spellId: string;
  casterId: EntityId;
  start: number;
  manaSpent: number;
  vars: Map<string, Value>;
  once: Set<string>;
}

export interface EvalCtx {
  readonly world: World;
  readonly inst: SpellInstanceLike;
  readonly depth: number;
  readonly time: number;
  in(port: string): Value;
  num(port: string): number;
  bool(port: string): boolean;
  vec(port: string): Vec;
  ent(port: string): EntityId;
  ents(port: string): EntityId[];
  elem(port: string): Element;
  param<T extends Literal = Literal>(id: string): T;
  out(port: string, v: Value): void;
  getVar(name: string): Value;
  random(): number;
}

export interface ExecCtx extends EvalCtx {
  readonly casterId: EntityId;
  readonly nodeId: string;
  /** bind an output value for downstream nodes */
  set(port: string, v: Value): void;
  /** execute an exec output synchronously, now */
  fire(port: string): void;
  /** is anything wired to this exec output? */
  connected(port: string): boolean;
  /** continuation for an event output (attach to entity hooks) */
  hook(port: string): Hook | undefined;
  /** wire connected event ports onto an entity's hooks */
  attach(e: Entity, map: Partial<Record<keyof EventHooks, string>>): void;
  /** schedule an exec output to run after `seconds` */
  later(port: string, seconds: number, binds?: Record<string, Value>): boolean;
  /** pay mana; false means the caster could not afford it and the node fizzles */
  charge(amount: number, what?: string): boolean;
  fizzle(reason: string): void;
  log(msg: string): void;
  setVar(name: string, v: Value): void;
  callSubspell(graphId: string, args: Record<string, Value>): void;
  castSpell(spellId: string, origin: Vec, target: Vec): void;
  /** loop guard: false once the per-run budget is exhausted */
  budgetOk(): boolean;
}

export interface NodeDef {
  type: string;
  title: string;
  category: Category;
  description: string;
  icon: string;
  element?: Element;
  params?: ParamDef[];
  inputs: PortDef[] | ((n: SpellNode, env: GraphEnv) => PortDef[]);
  outputs: PortDef[] | ((n: SpellNode, env: GraphEnv) => PortDef[]);
  /** pure nodes have no exec pins and are evaluated lazily */
  pure?: boolean;
  trigger?: 'cast' | 'channel' | 'release' | 'entry';
  /** static complexity units: drive upfront mana cost and cooldown */
  cost: number;
  /** short human description of dynamic mana cost */
  manaHint?: string;
  /** estimate of dynamic mana from literal values (for editor display) */
  estimate?: (v: (port: string) => Literal | undefined) => number;
  eval?: (c: EvalCtx) => void;
  exec?: (c: ExecCtx) => void;
  /** only allowed inside subspell graphs / main graph */
  only?: 'main' | 'subspell';
  /** search keywords */
  keywords?: string[];
}

export function portsOf(def: NodeDef, n: SpellNode, env: GraphEnv): { inputs: PortDef[]; outputs: PortDef[] } {
  const inputs = typeof def.inputs === 'function' ? def.inputs(n, env) : def.inputs;
  const outputs = typeof def.outputs === 'function' ? def.outputs(n, env) : def.outputs;
  return { inputs, outputs };
}

export function paramValue(def: NodeDef, n: SpellNode, id: string): Literal {
  const v = n.values[id];
  if (v !== undefined) return v;
  const p = def.params?.find((p) => p.id === id);
  return p ? p.default : 0;
}

export function isDataType(t: PinType): t is DataType {
  return t !== 'exec';
}

// ── Port builders (keep definitions terse and uniform) ─────────────────────

export const P = {
  exec: (id = 'in', label = ''): PortDef => ({ id, label, type: 'exec' }),
  then: (id = 'then', label = 'Then'): PortDef => ({ id, label, type: 'exec' }),
  event: (id: string, label: string, doc?: string): PortDef => ({ id, label, type: 'exec', event: true, doc }),
  num: (id: string, label: string, def = 0, extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'number', default: def, ...extra }),
  bool: (id: string, label: string, def = false, extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'bool', default: def, ...extra }),
  vec: (id: string, label: string, auto?: AutoSource, def: Vec = { x: 0, y: 0 }, extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'vector', auto, default: def, ...extra }),
  ent: (id: string, label: string, auto: AutoSource = 'none', extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'entity', auto, ...extra }),
  ents: (id: string, label: string, auto: AutoSource = 'none', extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'entities', auto, ...extra }),
  elem: (id: string, label: string, def: Element = 'arcane', extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'element', default: def, ...extra }),
  any: (id: string, label: string, extra: Partial<PortDef> = {}): PortDef => ({ id, label, type: 'any', ...extra }),
  out: (id: string, label: string, type: PinType, extra: Partial<PortDef> = {}): PortDef => ({ id, label, type, ...extra }),
};

export const FILTER_OPTIONS = [
  { value: 'hostile', label: 'Hostile' },
  { value: 'enemies', label: 'Enemies' },
  { value: 'allies', label: 'Allies' },
  { value: 'living', label: 'Living' },
  { value: 'props', label: 'Props' },
  { value: 'projectiles', label: 'Projectiles' },
  { value: 'any', label: 'Anything' },
];
