import { cooldownFor, upfrontCost } from './costs';
import { getDef } from './nodes/registry';
import { isDataType, portsOf, type AutoSource, type GraphEnv, type NodeDef, type PortDef } from './nodes/defs';
import {
  TYPE_INFO,
  V,
  coercionFor,
  hashString,
  type Coercion,
  type DataType,
  type Diagnostic,
  type Literal,
  type SpellDoc,
  type SpellGraph,
  type SpellNode,
  type SubspellParam,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Compiled representation
// ─────────────────────────────────────────────────────────────────────────────

export type DataSource =
  | { kind: 'slot'; slot: number; coerce: Coercion; type: DataType }
  | { kind: 'pure'; node: number; port: string; coerce: Coercion; type: DataType }
  | { kind: 'literal'; value: Literal; type: DataType }
  | { kind: 'auto'; auto: AutoSource; type: DataType }
  | { kind: 'none'; type: DataType };

export interface CNode {
  idx: number;
  id: string;
  type: string;
  title: string;
  def: NodeDef;
  node: SpellNode;
  inputs: PortDef[];
  outputs: PortDef[];
  pure: boolean;
  sources: Record<string, DataSource>;
  /** exec output port -> target node indices, ordered top-to-bottom */
  execOut: Record<string, number[]>;
  /** impure data outputs -> frame slot */
  slots: Record<string, number>;
  /** per event port: which slots to fill from the event payload */
  eventBinds: Record<string, { slot: number; key: string }[]>;
  /** unscoped outputs that track the entity that raised an event (e.g. the projectile) */
  selfSlots: { slot: number; key: string }[];
  params: Record<string, Literal>;
  outTypes: Record<string, DataType>;
}

export interface CompiledGraph {
  id: string;
  name: string;
  nodes: CNode[];
  byId: Map<string, number>;
  slotCount: number;
  triggers: { cast: number[]; channel: number[]; release: number[]; entry: number[] };
  params: SubspellParam[];
  complexity: number;
}

export interface CompiledSpell {
  doc: SpellDoc;
  ok: boolean;
  diagnostics: Diagnostic[];
  main: CompiledGraph;
  subs: Map<string, CompiledGraph>;
  complexity: number;
  upfront: number;
  cooldown: number;
  /** rough dynamic mana estimate for one pass over each effect node */
  estimate: number;
  nodeCount: number;
  edgeCount: number;
  hasCast: boolean;
  hasChannel: boolean;
  hasRelease: boolean;
  channelInterval: number;
  signature: number;
  recursive: boolean;
}

export interface CompileOptions {
  /** resolves other library spells for Cast Spell validation */
  spellExists?: (id: string) => boolean;
  spellName?: (id: string) => string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

const fmtPort = (p: PortDef) => `“${p.label || p.id}”`;

function defaultForType(t: DataType): Literal | null {
  switch (t) {
    case 'number':
      return 0;
    case 'bool':
      return false;
    case 'vector':
      return { x: 0, y: 0 };
    case 'element':
      return 'arcane';
    default:
      return null;
  }
}

function literalMatches(t: DataType, v: Literal): boolean {
  switch (t) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'vector':
      return V.isVec(v);
    case 'element':
      return typeof v === 'string';
    case 'any':
      return true;
    default:
      return false;
  }
}

export function compileSpell(doc: SpellDoc, opts: CompileOptions = {}): CompiledSpell {
  const diags: Diagnostic[] = [];
  const subs = new Map<string, CompiledGraph>();
  const env = (graph: SpellGraph): GraphEnv => ({ doc, graph, spellName: opts.spellName });

  // variable declarations
  const seenVars = new Set<string>();
  for (const v of doc.variables) {
    if (!v.name.trim()) diags.push({ severity: 'error', code: 'var-name', message: 'A variable has an empty name.', graphId: doc.main.id });
    else if (seenVars.has(v.name)) diags.push({ severity: 'error', code: 'var-dup', message: `Variable “${v.name}” is declared twice.`, graphId: doc.main.id });
    seenVars.add(v.name);
  }

  const main = compileGraph(doc.main, false, env(doc.main), doc, opts, diags);
  const subIds = new Set<string>();
  for (const s of doc.subspells) {
    if (subIds.has(s.id)) diags.push({ severity: 'error', code: 'sub-dup', message: `Two subspells share the id ${s.id}.`, graphId: s.id });
    subIds.add(s.id);
    subs.set(s.id, compileGraph(s, true, env(s), doc, opts, diags));
  }

  // subspell call graph: detect recursion (allowed, but flagged)
  const calls = new Map<string, Set<string>>();
  for (const [id, g] of [[doc.main.id, main] as const, ...subs]) {
    const set = new Set<string>();
    for (const n of g.nodes) if (n.type === 'callSubspell') set.add(String(n.params.sub));
    calls.set(id, set);
  }
  let recursive = false;
  for (const s of doc.subspells) {
    // DFS from s looking for s
    const stack = [...(calls.get(s.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const x = stack.pop()!;
      if (x === s.id) {
        recursive = true;
        diags.push({
          severity: 'info',
          code: 'recursive',
          message: `Subspell “${s.name}” is recursive. That's allowed — recursion stops at the depth limit or when the budget runs out. Use Recursion Depth to end it gracefully.`,
          graphId: s.id,
        });
        break;
      }
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(calls.get(x) ?? []));
    }
  }
  for (const n of main.nodes) if (n.type === 'castSpell' && n.params.spell === doc.id) recursive = true;

  const hasCast = main.triggers.cast.length > 0;
  const hasChannel = main.triggers.channel.length > 0;
  const hasRelease = main.triggers.release.length > 0;
  if (!hasCast && !hasChannel && !hasRelease)
    diags.push({ severity: 'error', code: 'no-trigger', message: 'The spell has no trigger. Add an On Cast, While Channeling or On Release node to start it.', graphId: doc.main.id });

  const complexity = Math.round((main.complexity + [...subs.values()].reduce((a, g) => a + g.complexity, 0)) * 10) / 10;
  let estimate = 0;
  for (const g of [main, ...subs.values()])
    for (const n of g.nodes) {
      if (n.def.estimate) estimate += n.def.estimate((p) => (n.sources[p]?.kind === 'literal' ? (n.sources[p] as { value: Literal }).value : n.params[p]));
    }
  const channelNode = hasChannel ? main.nodes[main.triggers.channel[0]] : undefined;
  const sigSrc = JSON.stringify([doc.main.nodes.map((n) => n.type).sort(), doc.subspells.length, doc.element]);
  return {
    doc,
    ok: !diags.some((d) => d.severity === 'error'),
    diagnostics: diags,
    main,
    subs,
    complexity,
    upfront: upfrontCost(complexity),
    cooldown: cooldownFor(complexity, doc.extraCooldown ?? 0),
    estimate: Math.round(estimate * 10) / 10,
    nodeCount: doc.main.nodes.length + doc.subspells.reduce((a, s) => a + s.nodes.length, 0),
    edgeCount: doc.main.edges.length + doc.subspells.reduce((a, s) => a + s.edges.length, 0),
    hasCast,
    hasChannel,
    hasRelease,
    channelInterval: channelNode ? Math.max(0.05, Number(channelNode.params.interval) || 0.15) : 0.15,
    signature: hashString(sigSrc + doc.name),
    recursive,
  };
}

function compileGraph(graph: SpellGraph, isSub: boolean, env: GraphEnv, doc: SpellDoc, opts: CompileOptions, diags: Diagnostic[]): CompiledGraph {
  const gid = graph.id;
  const err = (code: string, message: string, nodeId?: string, extra: Partial<Diagnostic> = {}) => diags.push({ severity: 'error', code, message, graphId: gid, nodeId, ...extra });
  const warn = (code: string, message: string, nodeId?: string, extra: Partial<Diagnostic> = {}) => diags.push({ severity: 'warning', code, message, graphId: gid, nodeId, ...extra });

  const nodes: CNode[] = [];
  const byId = new Map<string, number>();
  let complexity = 0;
  for (const n of graph.nodes) {
    if (byId.has(n.id)) {
      err('node-dup', `Duplicate node id ${n.id}.`, n.id);
      continue;
    }
    const def = getDef(n.type);
    if (!def) {
      err('unknown-node', `Unknown node type “${n.type}”. It may come from a newer version.`, n.id);
      continue;
    }
    if (def.only === 'main' && isSub) err('wrong-graph', `${def.title} can only be used in the main spell graph, not inside a subspell.`, n.id);
    if (def.only === 'subspell' && !isSub) err('wrong-graph', `${def.title} only belongs inside a subspell.`, n.id);
    const { inputs, outputs } = portsOf(def, n, env);
    const params: Record<string, Literal> = {};
    for (const p of def.params ?? []) params[p.id] = n.values[p.id] ?? p.default;
    const outTypes: Record<string, DataType> = {};
    for (const o of outputs) if (isDataType(o.type)) outTypes[o.id] = o.type;
    complexity += def.cost;
    byId.set(n.id, nodes.length);
    nodes.push({
      idx: nodes.length,
      id: n.id,
      type: n.type,
      title: def.title,
      def,
      node: n,
      inputs,
      outputs,
      pure: !!def.pure,
      sources: {},
      execOut: {},
      slots: {},
      eventBinds: {},
      selfSlots: [],
      params,
      outTypes,
    });
  }

  // ── edges ─────────────────────────────────────────────────────────────────
  interface DataEdge {
    from: number;
    fromPort: PortDef;
    to: number;
    toPort: PortDef;
    edgeId: string;
  }
  const dataEdges: DataEdge[] = [];
  const execEdges: { from: number; port: PortDef; to: number }[] = [];
  const inputTaken = new Map<string, string>();
  for (const e of graph.edges) {
    const fi = byId.get(e.from);
    const ti = byId.get(e.to);
    if (fi === undefined || ti === undefined) {
      warn('dangling-edge', 'A connection points at a node that no longer exists; it was ignored.', undefined, { edgeId: e.id });
      continue;
    }
    const a = nodes[fi];
    const b = nodes[ti];
    const op = a.outputs.find((p) => p.id === e.fromPort);
    const ip = b.inputs.find((p) => p.id === e.toPort);
    if (!op || !ip) {
      warn('dangling-port', `A connection on ${!op ? a.title : b.title} uses a pin that doesn't exist anymore (${!op ? e.fromPort : e.toPort}); it was ignored.`, !op ? a.id : b.id, { edgeId: e.id });
      continue;
    }
    if ((op.type === 'exec') !== (ip.type === 'exec')) {
      err('flow-data-mix', `Can't connect ${op.type === 'exec' ? 'a flow pin' : 'a data pin'} (${a.title}.${op.label}) to ${ip.type === 'exec' ? 'a flow pin' : 'a data pin'} (${b.title}.${ip.label}).`, b.id, { edgeId: e.id });
      continue;
    }
    if (op.type === 'exec') {
      execEdges.push({ from: fi, port: op, to: ti });
      continue;
    }
    const key = `${ti}:${ip.id}`;
    if (inputTaken.has(key)) {
      err('multi-source', `Input ${fmtPort(ip)} on ${b.title} has more than one connection. Data inputs take exactly one source.`, b.id, { edgeId: e.id, port: ip.id });
      continue;
    }
    inputTaken.set(key, e.id);
    dataEdges.push({ from: fi, fromPort: op, to: ti, toPort: ip, edgeId: e.id });
  }

  // ── resolve generic 'any' pins (iterate for chains of generic nodes) ─────
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const n of nodes) {
      const anyIns = n.inputs.filter((p) => p.type === 'any').map((p) => p.id);
      const anyOuts = n.outputs.filter((p) => p.type === 'any').map((p) => p.id);
      if (!anyIns.length || !anyOuts.length) continue;
      let t: DataType | undefined;
      for (const de of dataEdges) {
        if (de.to !== n.idx || !anyIns.includes(de.toPort.id)) continue;
        const st = nodes[de.from].outTypes[de.fromPort.id];
        if (st && st !== 'any') {
          t = st;
          break;
        }
      }
      if (t) for (const o of anyOuts) if (n.outTypes[o] !== t) ((n.outTypes[o] = t), (changed = true));
    }
    if (!changed) break;
  }

  // ── type check data edges ────────────────────────────────────────────────
  const goodData: DataEdge[] = [];
  for (const de of dataEdges) {
    const st = nodes[de.from].outTypes[de.fromPort.id] ?? (de.fromPort.type as DataType);
    const tt = de.toPort.type as DataType;
    const c = coercionFor(st, tt);
    if (c === null) {
      err(
        'type-mismatch',
        `Type mismatch: ${nodes[de.from].title}.${de.fromPort.label} is ${TYPE_INFO[st].label}, but ${nodes[de.to].title}.${de.toPort.label} expects ${TYPE_INFO[tt].label}.`,
        nodes[de.to].id,
        { edgeId: de.edgeId, port: de.toPort.id },
      );
      continue;
    }
    goodData.push(de);
  }

  // ── slots for impure outputs ─────────────────────────────────────────────
  let slotCount = 0;
  for (const n of nodes) {
    if (n.pure) continue;
    for (const o of n.outputs) {
      if (o.type === 'exec') continue;
      const slot = slotCount++;
      n.slots[o.id] = slot;
      if (o.eventKey) {
        if (o.scope) for (const s of o.scope) (n.eventBinds[s] ??= []).push({ slot, key: o.eventKey });
        else n.selfSlots.push({ slot, key: o.eventKey });
      }
    }
  }

  // ── data sources ─────────────────────────────────────────────────────────
  const edgeInto = new Map<string, DataEdge>();
  for (const de of goodData) edgeInto.set(`${de.to}:${de.toPort.id}`, de);
  for (const n of nodes) {
    for (const ip of n.inputs) {
      if (ip.type === 'exec') continue;
      const t = ip.type as DataType;
      const de = edgeInto.get(`${n.idx}:${ip.id}`);
      if (de) {
        const src = nodes[de.from];
        const st = src.outTypes[de.fromPort.id] ?? (de.fromPort.type as DataType);
        const coerce = coercionFor(st, t) ?? 'none';
        n.sources[ip.id] = src.pure ? { kind: 'pure', node: src.idx, port: de.fromPort.id, coerce, type: t } : { kind: 'slot', slot: src.slots[de.fromPort.id], coerce, type: t };
        continue;
      }
      const lit = n.node.values[ip.id];
      if (lit !== undefined && !ip.auto) {
        if (literalMatches(t, lit)) n.sources[ip.id] = { kind: 'literal', value: lit, type: t };
        else {
          warn('bad-literal', `Value for ${fmtPort(ip)} on ${n.title} isn't a valid ${TYPE_INFO[t].label}; using the default.`, n.id, { port: ip.id });
          const d = ip.default ?? defaultForType(t);
          n.sources[ip.id] = d === null ? { kind: 'none', type: t } : { kind: 'literal', value: d, type: t };
        }
      } else if (ip.auto && ip.auto !== 'none') n.sources[ip.id] = { kind: 'auto', auto: ip.auto, type: t };
      else if (ip.default !== undefined) n.sources[ip.id] = { kind: 'literal', value: ip.default, type: t };
      else {
        const d = defaultForType(t);
        n.sources[ip.id] = d === null ? { kind: 'none', type: t } : { kind: 'literal', value: d, type: t };
      }
    }
  }

  // ── pure data cycles ─────────────────────────────────────────────────────
  {
    const state = new Uint8Array(nodes.length);
    const pureDeps = (i: number) =>
      Object.values(nodes[i].sources)
        .filter((s): s is Extract<DataSource, { kind: 'pure' }> => s.kind === 'pure')
        .map((s) => s.node);
    const visit = (i: number, path: number[]): boolean => {
      if (state[i] === 1) {
        const cyc = path.slice(path.indexOf(i)).map((k) => nodes[k].title);
        err('data-cycle', `Data loop: ${cyc.join(' → ')} → ${nodes[i].title}. A value can't depend on itself — use a Variable to carry state.`, nodes[i].id);
        return true;
      }
      if (state[i] === 2) return false;
      state[i] = 1;
      for (const d of pureDeps(i)) if (visit(d, [...path, i])) break;
      state[i] = 2;
      return false;
    };
    for (const n of nodes) if (n.pure && state[n.idx] === 0) visit(n.idx, []);
  }

  // ── exec edges ───────────────────────────────────────────────────────────
  for (const ee of execEdges) {
    const b = nodes[ee.to];
    if (!b.inputs.some((p) => p.type === 'exec')) {
      err('no-exec-in', `${b.title} has no flow input.`, b.id);
      continue;
    }
    (nodes[ee.from].execOut[ee.port.id] ??= []).push(ee.to);
  }
  for (const n of nodes) for (const k of Object.keys(n.execOut)) n.execOut[k].sort((a, b) => nodes[a].node.y - nodes[b].node.y || nodes[a].node.x - nodes[b].node.x);

  // synchronous cycles (no Delay / event between)
  {
    const syncNext = (i: number): number[] => {
      const out: number[] = [];
      for (const op of nodes[i].outputs) {
        if (op.type !== 'exec' || op.event || op.async) continue;
        out.push(...(nodes[i].execOut[op.id] ?? []));
      }
      return out;
    };
    const state = new Uint8Array(nodes.length);
    const reported = new Set<number>();
    const visit = (i: number, path: number[]) => {
      state[i] = 1;
      for (const j of syncNext(i)) {
        if (state[j] === 1) {
          if (!reported.has(j)) {
            reported.add(j);
            const cyc = [...path.slice(path.indexOf(j)), i].map((k) => nodes[k].title);
            err('sync-cycle', `Infinite loop: flow goes ${cyc.join(' → ')} → ${nodes[j].title} with no Delay or event in between. Insert a Delay (or use an event pin) to make it a timed loop.`, nodes[j].id);
          }
        } else if (state[j] === 0) visit(j, [...path, i]);
      }
      state[i] = 2;
    };
    for (const n of nodes) if (state[n.idx] === 0) visit(n.idx, []);
  }

  // triggers
  const triggers = { cast: [] as number[], channel: [] as number[], release: [] as number[], entry: [] as number[] };
  for (const n of nodes) if (n.def.trigger) triggers[n.def.trigger].push(n.idx);
  if (isSub) {
    if (triggers.entry.length === 0) err('no-entry', `Subspell “${graph.name}” has no Subspell Entry node, so it can never start.`);
    if (triggers.entry.length > 1) warn('multi-entry', `Subspell “${graph.name}” has several Entry nodes; all of them run on each call.`);
  }

  // reachability from triggers over all exec edges
  const forward = (starts: number[]): Set<number> => {
    const seen = new Set<number>();
    const stack = [...starts];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      for (const k of Object.keys(nodes[i].execOut)) stack.push(...nodes[i].execOut[k]);
    }
    return seen;
  };
  const allTriggers = [...triggers.cast, ...triggers.channel, ...triggers.release, ...triggers.entry];
  const reachable = forward(allTriggers);
  for (const n of nodes) {
    if (n.pure || n.def.trigger) continue;
    if (!reachable.has(n.idx)) warn('unreachable', `${n.title} is not connected to any trigger, so it never runs.`, n.id);
  }

  // ── scope analysis: event/loop values may only be used downstream ────────
  {
    // slot -> {node, port}
    const slotOwner: { node: number; port: PortDef }[] = [];
    for (const n of nodes) for (const o of n.outputs) if (n.slots[o.id] !== undefined) slotOwner[n.slots[o.id]] = { node: n.idx, port: o };
    // slots each node depends on through pure chains
    const memo = new Map<number, Set<number>>();
    const deps = (i: number, stack = new Set<number>()): Set<number> => {
      const m = memo.get(i);
      if (m) return m;
      const out = new Set<number>();
      if (stack.has(i)) return out; // cycle already reported
      stack.add(i);
      for (const s of Object.values(nodes[i].sources)) {
        if (s.kind === 'slot') out.add(s.slot);
        else if (s.kind === 'pure') for (const x of deps(s.node, stack)) out.add(x);
      }
      stack.delete(i);
      memo.set(i, out);
      return out;
    };
    const regionCache = new Map<number, Set<number>>();
    const region = (slot: number): Set<number> => {
      const c = regionCache.get(slot);
      if (c) return c;
      const { node, port } = slotOwner[slot];
      const n = nodes[node];
      const execPorts = n.outputs.filter((p) => p.type === 'exec' && (!port.scope || port.scope.includes(p.id)));
      const starts: number[] = [];
      for (const ep of execPorts) starts.push(...(n.execOut[ep.id] ?? []));
      const r = forward(starts);
      regionCache.set(slot, r);
      return r;
    };
    // plain (unscoped) outputs persist in the frame, so siblings reached later
    // from the same trigger (e.g. Sequence 1st → Projectile, 2nd → Homing) may read them
    const triggerRegions = allTriggers.map((t) => forward([t]));
    const sameFlow = (a: number, b: number) => triggerRegions.some((r) => r.has(a) && r.has(b));
    for (const n of nodes) {
      if (n.pure) continue;
      for (const slot of deps(n.idx)) {
        const own = slotOwner[slot];
        if (!own) continue;
        if (!own.port.scope && !nodes[own.node].def.trigger && sameFlow(own.node, n.idx)) continue;
        if (!region(slot).has(n.idx)) {
          const src = nodes[own.node];
          const where = own.port.scope ? own.port.scope.map((s) => fmtPort(src.outputs.find((p) => p.id === s)!)).join(' or ') : 'its flow outputs';
          err('out-of-scope', `${n.title} reads ${fmtPort(own.port)} from ${src.title}, but that value only exists in flows that continue from ${where} of ${src.title}.`, n.id);
        }
      }
    }
  }

  // ── parameter references ─────────────────────────────────────────────────
  for (const n of nodes) {
    if (n.type === 'getVar' || n.type === 'setVar' || n.type === 'addVar') {
      const name = String(n.params.name ?? '');
      const v = doc.variables.find((x) => x.name === name);
      if (!name) err('var-missing', `${n.title} has no variable selected.`, n.id);
      else if (!v) err('var-unknown', `${n.title} refers to variable “${name}”, which is not declared.`, n.id);
      else if (n.type === 'addVar' && v.type !== 'number') err('var-type', `Add to Variable needs a Number variable, but “${name}” is ${TYPE_INFO[v.type].label}.`, n.id);
    }
    if (n.type === 'callSubspell') {
      const id = String(n.params.sub ?? '');
      if (!id) err('sub-missing', 'Call Subspell has no subspell selected.', n.id);
      else if (!doc.subspells.some((s) => s.id === id)) err('sub-unknown', 'Call Subspell refers to a subspell that does not exist.', n.id);
    }
    if (n.type === 'castSpell') {
      const id = String(n.params.spell ?? '');
      if (!id) err('spell-missing', 'Cast Spell has no spell selected.', n.id);
      else if (id === doc.id) warn('spell-self', 'Cast Spell casts this same spell: a recursive chain. It is depth-limited, but costs mana every generation.', n.id);
      else if (opts.spellExists && !opts.spellExists(id)) err('spell-unknown', 'Cast Spell refers to a spell that is not in your library.', n.id);
    }
    if (n.type === 'onChannel' && !isSub) {
      const iv = Number(n.params.interval);
      if (!(iv >= 0.05)) warn('channel-interval', 'Channel interval below 0.05s is clamped.', n.id);
    }
  }

  return { id: gid, name: graph.name, nodes, byId, slotCount, triggers, params: graph.params ?? [], complexity };
}
