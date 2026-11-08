import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { CATEGORY_INFO, type NodeDef, type ParamDef, type PortDef } from '../core/nodes/defs';
import { ELEMENT_INFO, TYPE_INFO, V, type Diagnostic, type Literal, type PinType, type SpellDoc, type SpellNode as SNode, type Vec } from '../core/types';
import { useStore } from '../state/store';
import { ElementPicker, ScrubNumber, Select, TextField, Toggle, VectorField } from './fields';
import { AUTO_LABEL, graphOf, nodePorts } from './graphOps';
import { useExecs, useHeat } from './heat';

export interface SpellNodeData extends Record<string, unknown> {
  node: SNode;
  def: NodeDef | undefined;
  graphId: string;
  inputs: PortDef[];
  outputs: PortDef[];
  outTypes: Record<string, PinType>;
  connectedIn: string[];
  connectedOut: string[];
  diags: Diagnostic[];
}

export type SpellFlowNode = Node<SpellNodeData, 'spell'>;

/** Mutate one node through the store (undoable); prunes edges on pins that disappeared. */
export function updateNode(graphId: string, nodeId: string, fn: (n: SNode, doc: SpellDoc) => void, coalesce?: string, prunePorts = false): void {
  useStore.getState().mutate(
    (doc) => {
      const g = graphOf(doc, graphId);
      const n = g.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      fn(n, doc);
      if (prunePorts) {
        const { inputs, outputs } = nodePorts(doc, g, n);
        const ins = new Set(inputs.map((p) => p.id));
        const outs = new Set(outputs.map((p) => p.id));
        g.edges = g.edges.filter((e) => !((e.to === n.id && !ins.has(e.toPort)) || (e.from === n.id && !outs.has(e.fromPort))));
      }
    },
    { coalesce },
  );
}

function literalFor(p: PortDef, n: SNode): Literal | undefined {
  return n.values[p.id] ?? p.default;
}

function InputEditor({ p, n, graphId }: { p: PortDef; n: SNode; graphId: string }) {
  const set = (v: Literal) =>
    updateNode(graphId, n.id, (nn) => {
      nn.values[p.id] = v;
    }, `lit:${n.id}:${p.id}`);
  if (p.auto && p.auto !== 'none') return <span className="se-auto" title="Unconnected: uses the cast context">⟨{AUTO_LABEL[p.auto] ?? p.auto}⟩</span>;
  const v = literalFor(p, n);
  switch (p.type) {
    case 'number':
      return <ScrubNumber value={typeof v === 'number' ? v : 0} min={p.min} max={p.max} step={p.step} onChange={set} />;
    case 'bool':
      return <Toggle value={v === true} onChange={set} />;
    case 'element':
      return <ElementPicker value={typeof v === 'string' ? v : 'arcane'} onChange={set} />;
    case 'vector':
      return <VectorField value={V.isVec(v) ? v : { x: 0, y: 0 }} onChange={(vv: Vec) => set(vv)} />;
    case 'entity':
    case 'entities':
      return <span className="se-auto se-auto--none">none</span>;
    default:
      return <span className="se-auto se-auto--none">—</span>;
  }
}

function ParamEditor({ p, n, graphId }: { p: ParamDef; n: SNode; graphId: string }) {
  const doc = useStore((s) => s.active());
  const library = useStore((s) => s.library);
  const v = n.values[p.id] ?? p.default;
  const set = (val: Literal, prune = false) =>
    updateNode(graphId, n.id, (nn) => {
      nn.values[p.id] = val;
    }, `param:${n.id}:${p.id}`, prune);
  let control: ReactNode;
  switch (p.kind) {
    case 'enum':
      control = <Select value={String(v)} options={p.options ?? []} onChange={(x) => set(x)} />;
      break;
    case 'number':
      control = <ScrubNumber value={Number(v) || 0} min={p.min} max={p.max} step={p.step} width={78} onChange={set} />;
      break;
    case 'bool':
      control = <Toggle value={v === true} onChange={set} />;
      break;
    case 'element':
      control = <ElementPicker value={String(v)} onChange={set} />;
      break;
    case 'string':
      control = <TextField value={String(v)} onChange={(x) => set(x)} live />;
      break;
    case 'variable':
      control = (
        <Select
          value={String(v)}
          placeholder={doc.variables.length ? 'Choose variable…' : 'No variables yet'}
          options={doc.variables.map((x) => ({ value: x.name, label: `${x.name} · ${TYPE_INFO[x.type].label}${x.scope === 'persistent' ? ' ∞' : ''}` }))}
          onChange={(x) => set(x, true)}
        />
      );
      break;
    case 'subspell':
      control = (
        <Select
          value={String(v)}
          placeholder={doc.subspells.length ? 'Choose subspell…' : 'No subspells yet'}
          options={doc.subspells.map((g) => ({ value: g.id, label: g.name }))}
          onChange={(x) => set(x, true)}
        />
      );
      break;
    case 'spell':
      control = <Select value={String(v)} placeholder="Choose spell…" options={library.map((d) => ({ value: d.id, label: d.id === doc.id ? `${d.name} (this spell)` : d.name }))} onChange={(x) => set(x)} />;
      break;
  }
  return (
    <div className={`se-param se-param--${p.kind}`} title={p.doc}>
      <span className="se-param__label">{p.label}</span>
      <div className="se-param__ctl">{control}</div>
    </div>
  );
}

function PinHandle({ p, side, connected, color }: { p: PortDef; side: 'in' | 'out'; connected: boolean; color: string }) {
  const isExec = p.type === 'exec';
  return (
    <Handle
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      id={p.id}
      className={`se-h ${isExec ? 'se-h--exec' : 'se-h--data'} ${p.event ? 'se-h--event' : ''} ${connected ? 'is-connected' : ''}`}
      style={{ '--c': color } as CSSProperties}
    />
  );
}

function scopeCaption(p: PortDef, outputs: PortDef[]): string | null {
  if (!p.scope || p.scope.length < 2) return null;
  return p.scope.map((s) => (outputs.find((o) => o.id === s)?.label ?? s).replace(/^On /, '').toLowerCase()).join(' · ');
}

/** Order outputs so scoped data values sit directly under the last exec pin that defines them. */
function orderOutputs(outputs: PortDef[]): { p: PortDef; indent: boolean }[] {
  const scoped = outputs.filter((p) => p.type !== 'exec' && p.scope && p.scope.length);
  const placeAfter = new Map<string, PortDef[]>();
  for (const p of scoped) {
    let last = p.scope![0];
    for (const o of outputs) if (o.type === 'exec' && p.scope!.includes(o.id)) last = o.id;
    if (!placeAfter.has(last)) placeAfter.set(last, []);
    placeAfter.get(last)!.push(p);
  }
  const out: { p: PortDef; indent: boolean }[] = [];
  for (const o of outputs) {
    if (o.type !== 'exec' && o.scope && o.scope.length) continue;
    out.push({ p: o, indent: false });
    if (o.type === 'exec') for (const s of placeAfter.get(o.id) ?? []) out.push({ p: s, indent: true });
  }
  // scoped values whose scope pin isn't present (shouldn't happen) go last
  for (const p of scoped) if (!out.some((x) => x.p === p)) out.push({ p, indent: true });
  return out;
}

function estimateMana(def: NodeDef, n: SNode, inputs: PortDef[]): number | null {
  if (!def.estimate) return null;
  try {
    const v = def.estimate((port) => {
      if (n.values[port] !== undefined) return n.values[port];
      const ip = inputs.find((p) => p.id === port);
      if (ip?.default !== undefined) return ip.default;
      return def.params?.find((p) => p.id === port)?.default;
    });
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function SpellNodeImpl({ id, data, selected }: NodeProps<SpellFlowNode>) {
  const { node: n, def, inputs, outputs, connectedIn, connectedOut, diags, graphId, outTypes } = data;
  const heat = useHeat(id);
  const execs = useExecs(id);
  const updateInternals = useUpdateNodeInternals();
  const portSig = inputs.map((p) => p.id + p.type).join(',') + '|' + outputs.map((p) => p.id + p.type).join(',');
  useEffect(() => {
    updateInternals(id);
  }, [id, portSig, updateInternals]);

  const ordered = useMemo(() => orderOutputs(outputs), [outputs]);
  if (!def) {
    return (
      <div className="se-node is-error se-node--unknown">
        <div className="se-node__head">
          <span className="se-node__icon">?</span>
          <span className="se-node__title">Unknown: {n.type}</span>
        </div>
        <div className="se-node__body se-node__msg">This node type doesn't exist in this version.</div>
      </div>
    );
  }
  const cat = CATEGORY_INFO[def.category];
  const tint = def.element ? ELEMENT_INFO[def.element].color : cat.color;
  const errs = diags.filter((d) => d.severity === 'error');
  const warns = diags.filter((d) => d.severity === 'warning');
  const infos = diags.filter((d) => d.severity === 'info');
  const cin = new Set(connectedIn);
  const cout = new Set(connectedOut);
  const mana = estimateMana(def, n, inputs);
  const diagPort = new Map<string, Diagnostic>();
  for (const d of diags) if (d.port) diagPort.set(d.port, d);
  const cls = ['se-node', `se-cat--${def.category}`, errs.length ? 'is-error' : warns.length ? 'is-warning' : '', selected ? 'is-selected' : '', heat > 0 ? 'is-hot' : '', def.trigger ? 'is-trigger' : '', def.pure ? 'is-pure' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} style={{ '--cat': tint, '--heat': heat } as CSSProperties}>
      <div className="se-node__glow" />
      <div className="se-node__head">
        <span className="se-node__icon">{def.icon}</span>
        <span className="se-node__title">{def.title}</span>
        {def.pure && <span className="se-node__tag" title="Pure: evaluated on demand, no flow pins">ƒ</span>}
        {(errs.length > 0 || warns.length > 0 || infos.length > 0) && (
          <span className={`se-badge ${errs.length ? 'se-badge--error' : warns.length ? 'se-badge--warn' : 'se-badge--info'}`} title={diags.map((d) => `${d.severity.toUpperCase()}: ${d.message}`).join('\n\n')}>
            {errs.length ? `✖ ${errs.length}` : warns.length ? `▲ ${warns.length}` : 'ℹ'}
          </span>
        )}
      </div>
      {n.note && <div className="se-node__note">{n.note}</div>}
      <div className="se-node__body">
        {inputs.map((p) => {
          const color = TYPE_INFO[p.type].color;
          const connected = cin.has(p.id);
          const bad = diagPort.get(p.id);
          return (
            <div key={`i-${p.id}`} className={`se-row se-row--in ${p.type === 'exec' ? 'se-row--exec' : ''} ${bad ? 'is-bad' : ''}`} title={bad?.message ?? p.doc ?? TYPE_INFO[p.type].doc}>
              <PinHandle p={p} side="in" connected={connected} color={color} />
              <span className="se-row__label" style={{ color: p.type === 'exec' ? undefined : color }}>
                {p.type === 'exec' ? '' : p.label}
              </span>
              {p.type !== 'exec' && !connected && (
                <div className="se-row__edit">
                  <InputEditor p={p} n={n} graphId={graphId} />
                </div>
              )}
            </div>
          );
        })}
        {def.params?.map((p) => <ParamEditor key={`p-${p.id}`} p={p} n={n} graphId={graphId} />)}
        {ordered.map(({ p, indent }) => {
          const t = outTypes[p.id] ?? p.type;
          const color = TYPE_INFO[t].color;
          const cap = scopeCaption(p, outputs);
          return (
            <div
              key={`o-${p.id}`}
              className={`se-row se-row--out ${p.type === 'exec' ? 'se-row--exec' : ''} ${p.event ? 'se-row--event' : ''} ${p.async ? 'se-row--async' : ''} ${indent ? 'se-row--scoped' : ''}`}
              title={p.doc ?? (p.scope ? `Only available in flows from: ${p.scope.join(', ')}` : TYPE_INFO[t].doc)}
            >
              {cap && <span className="se-row__scope">{cap}</span>}
              <span className="se-row__label" style={{ color: p.type === 'exec' ? undefined : color }}>
                {p.event && <span className="se-row__bolt">⚡</span>}
                {p.async && <span className="se-row__bolt">⏱</span>}
                {p.label}
              </span>
              <PinHandle p={p} side="out" connected={cout.has(p.id)} color={p.type === 'exec' ? (p.event ? '#ffd27a' : '#f4f1ff') : color} />
            </div>
          );
        })}
      </div>
      {!def.pure && (mana !== null || def.manaHint || execs > 0 || def.cost > 0) && (
        <div className="se-node__foot">
          {mana !== null ? (
            <span className="se-foot__mana" title={def.manaHint ?? 'Estimated mana per execution'}>
              ◆ {mana.toFixed(1)}
            </span>
          ) : def.manaHint ? (
            <span className="se-foot__mana se-foot__mana--hint" title={def.manaHint}>
              ◆ {def.manaHint}
            </span>
          ) : (
            <span className="se-foot__cx" title="Complexity units (upfront mana & cooldown)">
              ⌬ {def.cost}
            </span>
          )}
          {execs > 0 && (
            <span className="se-foot__execs" title="Executions (profiler)">
              ▶ {execs}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const SpellNodeView = memo(SpellNodeImpl);
