import { type CSSProperties } from 'react';
import { CATEGORY_INFO, type PortDef } from '../core/nodes/defs';
import { getDef } from '../core/nodes/registry';
import { ELEMENT_INFO, TYPE_INFO, V, type DataType, type Literal, type VarDecl } from '../core/types';
import { useStore } from '../state/store';
import { ElementPicker, ScrubNumber, Select, TextField, Toggle, VectorField } from './fields';
import { graphOf, nodePorts } from './graphOps';
import { profileOf, useExecs } from './heat';
import { updateNode } from './SpellNode';

const VAR_TYPES: VarDecl['type'][] = ['number', 'bool', 'vector', 'element', 'entity', 'entities'];

function defaultInitial(t: VarDecl['type']): Literal {
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
      return 0;
  }
}

function TypeChip({ t }: { t: string }) {
  const info = TYPE_INFO[t as DataType] ?? TYPE_INFO.any;
  return (
    <span className="se-typechip" style={{ '--c': info.color } as CSSProperties}>
      {info.glyph} {info.label}
    </span>
  );
}

function PortList({ title, ports, outputs }: { title: string; ports: PortDef[]; outputs: PortDef[] }) {
  if (!ports.length) return null;
  return (
    <div className="se-insp__sec">
      <div className="se-insp__h">{title}</div>
      {ports.map((p) => (
        <div key={p.id} className="se-insp__port">
          <div className="se-insp__portrow">
            <span className="se-insp__pname">
              {p.event && '⚡ '}
              {p.async && '⏱ '}
              {p.label || (p.type === 'exec' ? 'Flow in' : p.id)}
            </span>
            <TypeChip t={p.type} />
          </div>
          {(p.doc || p.scope || p.auto) && (
            <div className="se-insp__pdoc">
              {p.doc}
              {p.auto && p.auto !== 'none' && <span> Unconnected: uses the {p.auto === 'target' ? 'cursor point' : p.auto === 'aim' ? 'aim direction' : 'caster'}.</span>}
              {p.scope && (
                <span className="se-insp__scope">
                  {' '}
                  Only valid downstream of {p.scope.map((s) => `“${outputs.find((o) => o.id === s)?.label ?? s}”`).join(' / ')}.
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NodePanel({ nodeId }: { nodeId: string }) {
  const doc = useStore((s) => s.active());
  const graphId = useStore((s) => s.graphId);
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const execs = useExecs(nodeId);
  const graph = graphOf(doc, graphId);
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const def = getDef(n.type);
  if (!def) return <div className="se-insp__empty">Unknown node type “{n.type}”.</div>;
  const { inputs, outputs } = nodePorts(doc, graph, n);
  const cat = CATEGORY_INFO[def.category];
  const prof = profileOf(doc.id, graphId, nodeId);
  const diags = compiled?.diagnostics.filter((d) => d.graphId === graphId && d.nodeId === nodeId) ?? [];
  return (
    <div className="se-insp__body">
      <div className="se-insp__title" style={{ '--cat': def.element ? ELEMENT_INFO[def.element].color : cat.color } as CSSProperties}>
        <span className="se-insp__icon">{def.icon}</span>
        <div>
          <div className="se-insp__name">{def.title}</div>
          <div className="se-insp__cat">
            {cat.label}
            {def.pure ? ' · pure' : ''}
            {def.trigger ? ' · trigger' : ''}
          </div>
        </div>
      </div>
      <p className="se-insp__desc">{def.description}</p>
      {diags.length > 0 && (
        <div className="se-insp__sec">
          {diags.map((d, i) => (
            <div key={i} className={`se-diag se-diag--${d.severity}`}>
              {d.message}
            </div>
          ))}
        </div>
      )}
      <div className="se-insp__stats">
        <div>
          <b>{def.cost}</b>
          <span>complexity</span>
        </div>
        <div>
          <b>{execs}</b>
          <span>executions</span>
        </div>
        <div>
          <b>{prof && prof.execs ? (prof.timeMs / prof.execs).toFixed(3) : '—'}</b>
          <span>avg ms</span>
        </div>
        <div>
          <b>{prof ? prof.mana.toFixed(1) : '0'}</b>
          <span>mana spent</span>
        </div>
      </div>
      {def.manaHint && <div className="se-insp__hint">◆ Mana: {def.manaHint}</div>}
      <div className="se-insp__sec">
        <div className="se-insp__h">Note</div>
        <TextField
          value={n.note ?? ''}
          placeholder="Add a note shown on the node…"
          multiline
          onChange={(v) =>
            updateNode(graphId, nodeId, (nn) => {
              if (v.trim()) nn.note = v;
              else delete nn.note;
            })
          }
        />
      </div>
      <PortList title="Inputs" ports={inputs} outputs={outputs} />
      <PortList title="Outputs" ports={outputs} outputs={outputs} />
      <div className="se-insp__id">id {n.id}</div>
    </div>
  );
}

function VarInitial({ v, onChange }: { v: VarDecl; onChange: (x: Literal) => void }) {
  switch (v.type) {
    case 'number':
      return <ScrubNumber value={Number(v.initial) || 0} onChange={onChange} width={70} />;
    case 'bool':
      return <Toggle value={v.initial === true} onChange={onChange} />;
    case 'vector':
      return <VectorField value={V.isVec(v.initial) ? v.initial : { x: 0, y: 0 }} onChange={onChange} />;
    case 'element':
      return <ElementPicker value={String(v.initial)} onChange={onChange} />;
    default:
      return <span className="se-auto se-auto--none">starts empty</span>;
  }
}

function Variables() {
  const doc = useStore((s) => s.active());
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const upd = (name: string, fn: (v: VarDecl) => void, coalesce?: string) =>
    mutate((d) => {
      const v = d.variables.find((x) => x.name === name);
      if (v) fn(v);
    }, { coalesce });
  const rename = (oldName: string, raw: string) => {
    const name = raw.trim().replace(/\s+/g, '_');
    if (!name || name === oldName) return;
    if (doc.variables.some((v) => v.name === name)) {
      toast(`A variable named “${name}” already exists.`, 'error');
      return;
    }
    mutate((d) => {
      const v = d.variables.find((x) => x.name === oldName);
      if (!v) return;
      v.name = name;
      for (const g of [d.main, ...d.subspells]) for (const n of g.nodes) if ((n.type === 'getVar' || n.type === 'setVar' || n.type === 'addVar') && n.values.name === oldName) n.values.name = name;
    });
  };
  return (
    <div className="se-insp__sec">
      <div className="se-insp__h">
        Variables
        <button
          className="se-chipbtn"
          onClick={() =>
            mutate((d) => {
              let i = d.variables.length + 1;
              while (d.variables.some((v) => v.name === `var${i}`)) i++;
              d.variables.push({ name: `var${i}`, type: 'number', scope: 'cast', initial: 0 });
            })
          }
        >
          + add
        </button>
      </div>
      {!doc.variables.length && <div className="se-insp__muted">Variables carry state between flows. Cast variables reset each cast; persistent ones remember across casts.</div>}
      {doc.variables.map((v) => (
        <div key={v.name} className="se-var" style={{ '--c': TYPE_INFO[v.type].color } as CSSProperties}>
          <div className="se-var__row">
            <span className="se-var__dot" />
            <TextField className="se-var__name" value={v.name} onChange={(x) => rename(v.name, x)} />
            <button
              className="se-iconbtn se-iconbtn--sm"
              title="Delete variable"
              onClick={() =>
                mutate((d) => {
                  d.variables = d.variables.filter((x) => x.name !== v.name);
                })
              }
            >
              ×
            </button>
          </div>
          <div className="se-var__row">
            <Select
              value={v.type}
              width={96}
              options={VAR_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label }))}
              onChange={(t) =>
                upd(v.name, (vv) => {
                  vv.type = t as VarDecl['type'];
                  vv.initial = defaultInitial(vv.type);
                })
              }
            />
            <Select
              value={v.scope}
              width={110}
              options={[
                { value: 'cast', label: 'Per cast' },
                { value: 'persistent', label: 'Persistent ∞' },
              ]}
              onChange={(s) => upd(v.name, (vv) => (vv.scope = s as VarDecl['scope']))}
            />
          </div>
          <div className="se-var__row se-var__init">
            <span className="se-insp__muted">initial</span>
            <VarInitial v={v} onChange={(x) => upd(v.name, (vv) => (vv.initial = x), `var:${v.name}`)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SpellPanel() {
  const doc = useStore((s) => s.active());
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const mutate = useStore((s) => s.mutate);
  const requestFocus = useStore((s) => s.requestFocus);
  const diags = compiled?.diagnostics ?? [];
  const errs = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.filter((d) => d.severity === 'warning').length;
  const graphName = (gid: string) => (gid === 'main' ? 'Main' : (doc.subspells.find((s) => s.id === gid)?.name ?? gid));
  return (
    <div className="se-insp__body">
      <div className="se-insp__sec">
        <div className="se-insp__h">Spell</div>
        <TextField className="se-insp__spellname" value={doc.name} onChange={(v) => v.trim() && mutate((d) => (d.name = v.trim().slice(0, 80)))} />
        <ElementPicker size="lg" value={doc.element} onChange={(el) => mutate((d) => (d.element = el))} />
        <TextField value={doc.description} multiline placeholder="What does this spell do?" onChange={(v) => mutate((d) => (d.description = v))} />
        <div className="se-insp__field">
          <span>Tags</span>
          <TextField
            value={doc.tags.join(', ')}
            placeholder="comma, separated"
            onChange={(v) =>
              mutate(
                (d) =>
                  (d.tags = v
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 12)),
              )
            }
          />
        </div>
        <div className="se-insp__field">
          <span>Extra cooldown (s)</span>
          <ScrubNumber value={doc.extraCooldown ?? 0} min={0} max={30} step={0.1} width={80} onChange={(v) => mutate((d) => (d.extraCooldown = v), { coalesce: 'extraCooldown' })} />
        </div>
      </div>
      {compiled && (
        <div className="se-insp__sec">
          <div className="se-insp__h">
            Compiler
            <span className={`se-status ${compiled.ok ? 'is-ok' : 'is-bad'}`}>{compiled.ok ? '✓ compiled' : `✖ ${errs} error${errs === 1 ? '' : 's'}`}</span>
          </div>
          <div className="se-insp__stats">
            <div>
              <b>{compiled.complexity}</b>
              <span>complexity</span>
            </div>
            <div>
              <b>{compiled.upfront}</b>
              <span>upfront mana</span>
            </div>
            <div>
              <b>{compiled.cooldown}s</b>
              <span>cooldown</span>
            </div>
            <div>
              <b>≈{compiled.estimate}</b>
              <span>effect mana</span>
            </div>
            <div>
              <b>{compiled.nodeCount}</b>
              <span>nodes</span>
            </div>
            <div>
              <b>{compiled.edgeCount}</b>
              <span>wires</span>
            </div>
          </div>
          {diags.length > 0 && (
            <div className="se-insp__diags">
              {warns > 0 && <div className="se-insp__muted">{warns} warning(s)</div>}
              {diags.map((d, i) => (
                <button key={i} className={`se-diag se-diag--${d.severity} ${d.nodeId ? 'is-link' : ''}`} onClick={() => d.nodeId && requestFocus(d.graphId, d.nodeId)}>
                  {d.graphId !== 'main' && <b>{graphName(d.graphId)}: </b>}
                  {d.message}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <Variables />
    </div>
  );
}

export function Inspector({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const selection = useStore((s) => s.selection);
  if (collapsed)
    return (
      <div className="se-insp se-insp--collapsed">
        <button className="se-iconbtn" onClick={onToggle} title="Show inspector">
          ⓘ
        </button>
        <div className="se-pal__vlabel">INSPECTOR</div>
      </div>
    );
  return (
    <div className="se-insp">
      <div className="se-insp__top">
        <span className="se-insp__toptitle">{selection.length === 1 ? 'Node' : selection.length > 1 ? `${selection.length} selected` : 'Spell & variables'}</span>
        <button className="se-iconbtn" onClick={onToggle} title="Hide inspector">
          ›
        </button>
      </div>
      <div className="se-insp__scroll">{selection.length === 1 ? <NodePanel nodeId={selection[0]} /> : <SpellPanel />}</div>
    </div>
  );
}
