import type { CompiledSpell } from '../core/compiler';
import { portsOf, type GraphEnv, type PortDef } from '../core/nodes/defs';
import { getDef } from '../core/nodes/registry';
import { TYPE_INFO, coercionFor, uid, type DataType, type Literal, type PinType, type SpellDoc, type SpellEdge, type SpellGraph, type SpellNode, type Vec } from '../core/types';
import { useStore } from '../state/store';

export function graphOf(doc: SpellDoc, graphId: string): SpellGraph {
  return graphId === 'main' ? doc.main : (doc.subspells.find((g) => g.id === graphId) ?? doc.main);
}

export function envFor(doc: SpellDoc, graph: SpellGraph): GraphEnv {
  const lib = useStore.getState().library;
  return { doc, graph, spellName: (id) => lib.find((d) => d.id === id)?.name };
}

export function nodePorts(doc: SpellDoc, graph: SpellGraph, node: SpellNode): { inputs: PortDef[]; outputs: PortDef[] } {
  const def = getDef(node.type);
  if (!def) return { inputs: [], outputs: [] };
  return portsOf(def, node, envFor(doc, graph));
}

/** Output type after generic ('any') resolution by the compiler, when available. */
export function resolvedOutType(compiled: CompiledSpell | undefined, graphId: string, nodeId: string, port: PortDef): PinType {
  if (port.type === 'exec') return 'exec';
  const g = compiled ? (graphId === 'main' ? compiled.main : compiled.subs.get(graphId)) : undefined;
  const idx = g?.byId.get(nodeId);
  if (g && idx !== undefined) return g.nodes[idx].outTypes[port.id] ?? port.type;
  return port.type;
}

export interface ConnCheck {
  ok: boolean;
  reason?: string;
  fromPort?: PortDef;
  toPort?: PortDef;
}

/** Validate a connection given RF handle semantics (source = output, target = input). */
export function checkConnection(
  doc: SpellDoc,
  graph: SpellGraph,
  compiled: CompiledSpell | undefined,
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined,
): ConnCheck {
  const a = graph.nodes.find((n) => n.id === source);
  const b = graph.nodes.find((n) => n.id === target);
  if (!a || !b || !sourceHandle || !targetHandle) return { ok: false, reason: 'Unknown pin.' };
  const op = nodePorts(doc, graph, a).outputs.find((p) => p.id === sourceHandle);
  const ip = nodePorts(doc, graph, b).inputs.find((p) => p.id === targetHandle);
  if (!op || !ip) return { ok: false, reason: 'Unknown pin.' };
  if ((op.type === 'exec') !== (ip.type === 'exec'))
    return { ok: false, reason: op.type === 'exec' ? `A flow pin can only connect to a flow input — “${ip.label}” is ${TYPE_INFO[ip.type].label} data.` : `“${op.label}” is ${TYPE_INFO[op.type].label} data; it can't drive a flow input.`, fromPort: op, toPort: ip };
  if (op.type !== 'exec') {
    if (a.id === b.id) return { ok: false, reason: "A node can't feed its own inputs.", fromPort: op, toPort: ip };
    const st = resolvedOutType(compiled, graph.id, a.id, op) as DataType;
    const c = coercionFor(st, ip.type as DataType);
    if (c === null) return { ok: false, reason: `${TYPE_INFO[st].label} can't connect to ${TYPE_INFO[ip.type].label} (“${op.label}” → “${ip.label}”).`, fromPort: op, toPort: ip };
  }
  return { ok: true, fromPort: op, toPort: ip };
}

export function connectInDoc(graph: SpellGraph, source: string, sourceHandle: string, target: string, targetHandle: string, isData: boolean): void {
  if (isData) graph.edges = graph.edges.filter((e) => !(e.to === target && e.toPort === targetHandle));
  if (graph.edges.some((e) => e.from === source && e.fromPort === sourceHandle && e.to === target && e.toPort === targetHandle)) return;
  graph.edges.push({ id: uid('e'), from: source, fromPort: sourceHandle, to: target, toPort: targetHandle });
}

export function makeNode(type: string, values: Record<string, Literal> = {}, pos: Vec = { x: 0, y: 0 }): SpellNode {
  return { id: uid('n'), type, x: Math.round(pos.x), y: Math.round(pos.y), values: { ...values } };
}

/** Find the first port on a fresh node compatible with a dragged pin. */
export function compatiblePort(
  doc: SpellDoc,
  graph: SpellGraph,
  node: SpellNode,
  dragType: PinType,
  dragFromOutput: boolean,
): PortDef | undefined {
  const { inputs, outputs } = nodePorts(doc, graph, node);
  const list = dragFromOutput ? inputs : outputs;
  for (const p of list) {
    if ((p.type === 'exec') !== (dragType === 'exec')) continue;
    if (p.type === 'exec') return p;
    const c = dragFromOutput ? coercionFor(dragType as DataType, p.type as DataType) : coercionFor(p.type as DataType, dragType as DataType);
    if (c !== null) return p;
  }
  return undefined;
}

// ── clipboard ───────────────────────────────────────────────────────────────

export interface ClipPayload {
  kind: 'spell-compiler/nodes';
  nodes: SpellNode[];
  edges: SpellEdge[];
}

let internalClip: ClipPayload | null = null;

export function copySelection(graph: SpellGraph, ids: string[]): ClipPayload | null {
  const set = new Set(ids);
  const nodes = graph.nodes.filter((n) => set.has(n.id));
  if (!nodes.length) return null;
  const edges = graph.edges.filter((e) => set.has(e.from) && set.has(e.to));
  const p: ClipPayload = { kind: 'spell-compiler/nodes', nodes: structuredClone(nodes), edges: structuredClone(edges) };
  internalClip = p;
  return p;
}

export function getInternalClip(): ClipPayload | null {
  return internalClip;
}

export function parseClip(text: string): ClipPayload | null {
  try {
    const o = JSON.parse(text);
    if (o && o.kind === 'spell-compiler/nodes' && Array.isArray(o.nodes) && Array.isArray(o.edges)) return o as ClipPayload;
  } catch {
    /* not ours */
  }
  return null;
}

/** Insert clip into graph at position; returns new node ids. */
export function pasteInto(graph: SpellGraph, clip: ClipPayload, at: Vec | null): string[] {
  const valid = clip.nodes.filter((n) => n && typeof n.type === 'string' && getDef(n.type));
  if (!valid.length) return [];
  const minX = Math.min(...valid.map((n) => n.x));
  const minY = Math.min(...valid.map((n) => n.y));
  const dx = at ? at.x - minX : 40;
  const dy = at ? at.y - minY : 40;
  const map = new Map<string, string>();
  const ids: string[] = [];
  for (const n of valid) {
    const id = uid('n');
    map.set(n.id, id);
    ids.push(id);
    graph.nodes.push({ id, type: n.type, x: Math.round(n.x + dx), y: Math.round(n.y + dy), values: { ...(n.values ?? {}) }, note: n.note });
  }
  for (const e of clip.edges) {
    const f = map.get(e.from);
    const t = map.get(e.to);
    if (f && t) graph.edges.push({ id: uid('e'), from: f, fromPort: e.fromPort, to: t, toPort: e.toPort });
  }
  return ids;
}

export function removeNodes(graph: SpellGraph, ids: Set<string>, edgeIds: Set<string> = new Set()): void {
  graph.nodes = graph.nodes.filter((n) => !ids.has(n.id));
  graph.edges = graph.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to) && !edgeIds.has(e.id));
}

export const AUTO_LABEL: Record<string, string> = {
  caster: 'caster',
  casterPos: 'caster',
  aim: 'aim',
  target: 'cursor',
  origin: 'origin',
};
