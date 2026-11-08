import { getDef } from './nodes/registry';
import { portsOf, type GraphEnv } from './nodes/defs';
import type { SpellGraph } from './types';

export const NODE_WIDTH = 236;

/** Rough rendered height of a node, matching the editor's node component. */
export function estimateNodeHeight(graph: SpellGraph, nodeId: string, env: GraphEnv): number {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) return 80;
  const def = getDef(n.type);
  if (!def) return 80;
  const { inputs, outputs } = portsOf(def, n, env);
  const params = def.params?.length ?? 0;
  return 46 + params * 30 + (inputs.length + outputs.length) * 23 + 8;
}

/**
 * Layered layout: columns by longest path over exec + data edges (back edges
 * from event loops are ignored), rows ordered by predecessor barycentre.
 */
export function autoLayout(graph: SpellGraph, env: GraphEnv, opts: { colGap?: number; rowGap?: number; x0?: number; y0?: number } = {}): void {
  const colGap = opts.colGap ?? 300;
  const rowGap = opts.rowGap ?? 28;
  const ids = graph.nodes.map((n) => n.id);
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  const pred = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of graph.edges) {
    if (!succ.has(e.from) || !succ.has(e.to) || e.from === e.to) continue;
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }
  // remove back edges via DFS
  const state = new Map<string, number>();
  const back = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of succ.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.get(v)) visit(v);
    }
    state.set(u, 2);
  };
  const roots = ids.filter((i) => getDef(graph.nodes.find((n) => n.id === i)!.type)?.trigger);
  for (const r of roots) if (!state.get(r)) visit(r);
  for (const i of ids) if (!state.get(i)) visit(i);
  const col = new Map<string, number>();
  const order: string[] = [];
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  for (const u of ids) for (const v of succ.get(u)!) if (!back.has(`${u}>${v}`)) indeg.set(v, indeg.get(v)! + 1);
  const q = ids.filter((i) => indeg.get(i) === 0);
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const v of succ.get(u)!) {
      if (back.has(`${u}>${v}`)) continue;
      col.set(v, Math.max(col.get(v) ?? 0, (col.get(u) ?? 0) + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  // pull pure source nodes right next to their first consumer
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const id of [...order].reverse()) {
    const def = getDef(byId.get(id)!.type);
    if (!def?.pure) continue;
    const consumers = succ.get(id)!.filter((v) => !back.has(`${id}>${v}`));
    if (consumers.length) col.set(id, Math.max(0, Math.min(...consumers.map((c) => col.get(c) ?? 0)) - 1));
  }
  const columns = new Map<number, string[]>();
  for (const id of order) {
    const c = col.get(id) ?? 0;
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c)!.push(id);
  }
  const yOf = new Map<string, number>();
  const keys = [...columns.keys()].sort((a, b) => a - b);
  for (const c of keys) {
    const list = columns.get(c)!;
    const bary = (id: string) => {
      const ps = pred.get(id)!.filter((p) => yOf.has(p));
      if (!ps.length) return Infinity;
      return ps.reduce((a, p) => a + yOf.get(p)!, 0) / ps.length;
    };
    list.sort((a, b) => bary(a) - bary(b));
    let y = opts.y0 ?? 0;
    for (const id of list) {
      const n = byId.get(id)!;
      n.x = (opts.x0 ?? 0) + c * colGap;
      n.y = y;
      yOf.set(id, y);
      y += estimateNodeHeight(graph, id, env) + rowGap;
    }
  }
}
