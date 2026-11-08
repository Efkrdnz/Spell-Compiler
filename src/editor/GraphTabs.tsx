import { useState } from 'react';
import { TYPE_INFO, uid, type DataType, type SpellDoc } from '../core/types';
import { useStore } from '../state/store';
import { Select, TextField } from './fields';

const PARAM_TYPES: DataType[] = ['number', 'bool', 'vector', 'entity', 'entities', 'element'];

/** Remove edges that touched a subspell parameter pin (on Entry outputs and Call Subspell inputs). */
function pruneParamEdges(doc: SpellDoc, subId: string, paramId: string): void {
  const port = `p_${paramId}`;
  const sub = doc.subspells.find((s) => s.id === subId);
  if (sub) {
    const entries = new Set(sub.nodes.filter((n) => n.type === 'entry').map((n) => n.id));
    sub.edges = sub.edges.filter((e) => !(entries.has(e.from) && e.fromPort === port));
  }
  for (const g of [doc.main, ...doc.subspells]) {
    const callers = new Set(g.nodes.filter((n) => n.type === 'callSubspell' && n.values.sub === subId).map((n) => n.id));
    g.edges = g.edges.filter((e) => !(callers.has(e.to) && e.toPort === port));
    for (const n of g.nodes) if (callers.has(n.id)) delete n.values[port];
  }
}

function ParamsBar({ subId }: { subId: string }) {
  const doc = useStore((s) => s.active());
  const mutate = useStore((s) => s.mutate);
  const sub = doc.subspells.find((s) => s.id === subId);
  if (!sub) return null;
  const params = sub.params ?? [];
  return (
    <div className="se-params">
      <span className="se-params__label">Parameters</span>
      {params.map((p) => (
        <div key={p.id} className="se-params__item" style={{ ['--c' as string]: TYPE_INFO[p.type].color }}>
          <span className="se-params__dot" />
          <TextField
            className="se-params__name"
            value={p.name}
            onChange={(v) =>
              mutate((d) => {
                const pp = d.subspells.find((s) => s.id === subId)?.params?.find((x) => x.id === p.id);
                if (pp) pp.name = v.trim() || pp.name;
              })
            }
          />
          <Select
            value={p.type}
            width={86}
            options={PARAM_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label }))}
            onChange={(v) =>
              mutate((d) => {
                const pp = d.subspells.find((s) => s.id === subId)?.params?.find((x) => x.id === p.id);
                if (pp && pp.type !== v) {
                  pp.type = v as DataType;
                  pruneParamEdges(d, subId, p.id);
                }
              })
            }
          />
          <button
            className="se-iconbtn se-iconbtn--sm"
            title="Remove parameter"
            onClick={() =>
              mutate((d) => {
                const s = d.subspells.find((x) => x.id === subId);
                if (!s) return;
                s.params = (s.params ?? []).filter((x) => x.id !== p.id);
                pruneParamEdges(d, subId, p.id);
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="se-chipbtn"
        onClick={() =>
          mutate((d) => {
            const s = d.subspells.find((x) => x.id === subId);
            if (!s) return;
            s.params = [...(s.params ?? []), { id: uid('p').slice(-8), name: `arg${(s.params?.length ?? 0) + 1}`, type: 'number' }];
          })
        }
      >
        + parameter
      </button>
    </div>
  );
}

export function GraphTabs() {
  const doc = useStore((s) => s.active());
  const graphId = useStore((s) => s.graphId);
  const setGraph = useStore((s) => s.setGraph);
  const addSubspell = useStore((s) => s.addSubspell);
  const removeSubspell = useStore((s) => s.removeSubspell);
  const mutate = useStore((s) => s.mutate);
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const errCount = (gid: string) => compiled?.diagnostics.filter((d) => d.graphId === gid && d.severity === 'error').length ?? 0;
  const tabs = [{ id: 'main', name: 'Main', sub: false }, ...doc.subspells.map((s) => ({ id: s.id, name: s.name, sub: true }))];
  return (
    <div className="se-tabs-wrap">
      <div className="se-tabs">
        {tabs.map((t) => {
          const errs = errCount(t.id);
          return (
            <div
              key={t.id}
              className={`se-tab ${graphId === t.id ? 'is-active' : ''} ${t.sub ? 'se-tab--sub' : ''}`}
              onClick={() => setGraph(t.id)}
              onDoubleClick={() => t.sub && setRenaming(t.id)}
              title={t.sub ? 'Subspell · double-click to rename' : 'The spell’s main graph'}
            >
              <span className="se-tab__glyph">{t.sub ? '⟳' : '✶'}</span>
              {renaming === t.id ? (
                <input
                  className="se-tab__rename"
                  autoFocus
                  defaultValue={t.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) mutate((d) => {
                      const s = d.subspells.find((x) => x.id === t.id);
                      if (s) s.name = v;
                    });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="se-tab__name">{t.name}</span>
              )}
              {errs > 0 && <span className="se-tab__err">{errs}</span>}
              {t.sub && graphId === t.id && (
                <button
                  className="se-tab__x"
                  title="Delete subspell"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete subspell “${t.name}”? Calls to it will report errors.`)) removeSubspell(t.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button className="se-tab se-tab--add" onClick={() => addSubspell('Subspell')} title="Add a reusable subspell">
          + Subspell
        </button>
      </div>
      {graphId !== 'main' && <ParamsBar subId={graphId} />}
    </div>
  );
}
