import { useMemo, useRef, useState } from 'react';
import { getDef } from '../core/nodes/registry';
import { ELEMENT_INFO, type Element, type TraceKind } from '../core/types';
import { getEngine, type StatSample } from '../engine/engine';
import { useStore, type DockTab } from '../state/store';
import { CHART_COLOR, CHART_ORDER, fmt, useEngineTick, useInterval } from './hooks';

const TABS: { id: DockTab; label: string }[] = [
  { id: 'problems', label: 'Problems' },
  { id: 'trace', label: 'Trace' },
  { id: 'profiler', label: 'Profiler' },
  { id: 'stats', label: 'Stats' },
];

export function Dock() {
  const ui = useStore((s) => s.ui);
  const setUI = useStore((s) => s.setUI);
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const errs = compiled?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warns = compiled?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
  return (
    <div className={`dock${ui.dockOpen ? '' : ' closed'}${ui.dock === 'stats' || ui.dock === 'profiler' ? ' tall' : ''}`}>
      <div className="dock-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={ui.dock === t.id && ui.dockOpen ? 'on' : ''} onClick={() => setUI({ dock: t.id, dockOpen: true })} data-testid={`dock-${t.id}`}>
            {t.label}
            {t.id === 'problems' && (errs > 0 || warns > 0) && (
              <span className={`badge ${errs ? 'err' : 'warn'}`}>{errs || warns}</span>
            )}
          </button>
        ))}
        <span className="tflex" />
        <button className="dock-toggle" onClick={() => setUI({ dockOpen: !ui.dockOpen })} title={ui.dockOpen ? 'Collapse' : 'Expand'}>
          {ui.dockOpen ? '▾' : '▴'}
        </button>
      </div>
      {ui.dockOpen && (
        <div className="dock-body">
          {ui.dock === 'problems' && <Problems />}
          {ui.dock === 'trace' && <Trace />}
          {ui.dock === 'profiler' && <Profiler />}
          {ui.dock === 'stats' && <Stats />}
        </div>
      )}
    </div>
  );
}

// ── Problems ────────────────────────────────────────────────────────────────

function Problems() {
  const doc = useStore((s) => s.active());
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const focus = useStore((s) => s.requestFocus);
  if (!compiled) return null;
  const graphName = (id: string) => (id === 'main' ? 'Main' : (doc.subspells.find((g) => g.id === id)?.name ?? id));
  const list = [...compiled.diagnostics].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : b.severity === 'error' ? 1 : a.severity === 'warning' ? -1 : 1));
  return (
    <div className="problems" data-testid="problems">
      <div className={`compile-line ${compiled.ok ? 'ok' : 'bad'}`}>
        {compiled.ok ? '✓ Compiled' : '✕ Does not compile'} · {compiled.nodeCount} nodes · {compiled.edgeCount} wires · complexity {compiled.complexity} · upfront {compiled.upfront} mana · cooldown {compiled.cooldown}s · effects ≈ {compiled.estimate} mana per pass
        {compiled.recursive && ' · recursive'}
      </div>
      {list.length === 0 && <div className="empty">No problems. The spell is ready to cast — click the arena.</div>}
      {list.map((d, i) => (
        <button key={i} className={`diag ${d.severity}`} onClick={() => d.nodeId && focus(d.graphId, d.nodeId)} disabled={!d.nodeId}>
          <span className="diag-icon">{d.severity === 'error' ? '✕' : d.severity === 'warning' ? '▲' : 'ℹ'}</span>
          <span className="diag-msg">{d.message}</span>
          <span className="diag-where">
            {graphName(d.graphId)}
            {d.nodeId ? ' · node' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Trace ───────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<TraceKind, string> = { cast: 'CAST', exec: 'exec', event: 'EVENT', fizzle: 'FIZZLE', error: 'ERROR', log: 'LOG', mana: 'MANA', defer: 'DEFER' };

function Trace() {
  useEngineTick(5);
  const engine = getEngine();
  const activeId = useStore((s) => s.activeId);
  const [onlyThis, setOnlyThis] = useState(true);
  const [showExec, setShowExec] = useState(true);
  const [frozen, setFrozen] = useState<typeof engine.rt.trace | null>(null);
  const [, force] = useState(0);
  const trace = frozen ?? engine.rt.trace;
  const rows = useMemo(
    () =>
      trace
        .filter((t) => (!onlyThis || !t.spellId || t.spellId === activeId) && (showExec || t.kind !== 'exec'))
        .slice(-300)
        .reverse(),
    [trace, trace.length, onlyThis, showExec, activeId, frozen],
  );
  const level = engine.rt.settings.trace;
  return (
    <div className="trace">
      <div className="panel-tools">
        <label className="chk">
          <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> This spell only
        </label>
        <label className="chk">
          <input type="checkbox" checked={showExec} onChange={(e) => setShowExec(e.target.checked)} /> Node steps
        </label>
        <select
          className="sel"
          value={level}
          onChange={(e) => {
            engine.rt.settings.trace = e.target.value as typeof level;
            force((x) => x + 1);
          }}
          title="How much the runtime records"
        >
          <option value="all">Record everything</option>
          <option value="events">Events only</option>
          <option value="off">Errors only</option>
        </select>
        <button className="tbtn" onClick={() => setFrozen(frozen ? null : [...engine.rt.trace])}>
          {frozen ? '▶ Live' : '❚❚ Freeze'}
        </button>
        <button
          className="tbtn"
          onClick={() => {
            engine.rt.trace = [];
            setFrozen(null);
          }}
        >
          Clear
        </button>
        <span className="tflex" />
        <span className="dim">{engine.rt.trace.length} entries · click a row to jump to its node</span>
      </div>
      <div className="trace-rows" data-testid="trace-rows">
        {rows.length === 0 && <div className="empty">Cast a spell to see its execution here: every node that runs, every event the arena raises, every fizzle and why.</div>}
        {rows.map((t) => (
          <button
            key={t.seq}
            className={`trow k-${t.kind}`}
            onClick={() => {
              if (!t.nodeId) return;
              const st = useStore.getState();
              if (t.spellId !== activeId) {
                if (!st.library.some((d) => d.id === t.spellId)) return;
                st.setActive(t.spellId);
              }
              st.requestFocus(t.graphId, t.nodeId);
            }}
          >
            <span className="t-time">{t.t.toFixed(2)}s</span>
            <span className="t-kind">{KIND_LABEL[t.kind]}</span>
            <span className="t-inst">#{t.instance}</span>
            <span className="t-msg" style={{ paddingLeft: Math.min(t.depth, 12) * 10 }}>
              {t.depth > 0 && <span className="t-depth">{'↳'.repeat(1)}d{t.depth} </span>}
              {t.message}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Profiler ────────────────────────────────────────────────────────────────

function Profiler() {
  useEngineTick(3);
  const engine = getEngine();
  const doc = useStore((s) => s.active());
  const focus = useStore((s) => s.requestFocus);
  const [sort, setSort] = useState<'mana' | 'time' | 'execs'>('mana');
  const rows = [...engine.rt.profile.entries()]
    .filter(([k]) => k.startsWith(`${doc.id}|`))
    .map(([, p]) => {
      const g = p.graphId === 'main' ? doc.main : doc.subspells.find((s) => s.id === p.graphId);
      const n = g?.nodes.find((x) => x.id === p.nodeId);
      return { ...p, title: n ? (getDef(n.type)?.title ?? n.type) : '(deleted node)', graph: g?.name ?? p.graphId, exists: !!n };
    })
    .sort((a, b) => (sort === 'mana' ? b.mana - a.mana : sort === 'time' ? b.timeMs - a.timeMs : b.execs - a.execs));
  const max = Math.max(1e-9, ...rows.map((r) => (sort === 'mana' ? r.mana : sort === 'time' ? r.timeMs : r.execs)));
  const t = engine.rt.totals;
  const insts = [...engine.rt.instances.values()].filter((i) => i.spellId === doc.id);
  const spent = insts.reduce((a, i) => a + i.manaSpent, 0);
  const dmg = insts.reduce((a, i) => a + (engine.world.stats.byInstance.get(i.id)?.damage ?? 0), 0);
  return (
    <div className="profiler" data-testid="profiler">
      <div className="kpis">
        <Kpi label="Casts" v={fmt(insts.length)} />
        <Kpi label="Mana spent" v={fmt(spent)} />
        <Kpi label="Damage dealt" v={fmt(dmg)} />
        <Kpi label="Damage / mana" v={spent > 0 ? (dmg / spent).toFixed(2) : '–'} />
        <Kpi label="Node steps (all)" v={fmt(t.steps)} />
        <Kpi label="Fizzles" v={fmt(t.fizzles)} />
        <Kpi label="Budget aborts" v={fmt(t.budgetHits)} tone={t.budgetHits ? 'warn' : undefined} />
        <Kpi label="Recursion stops" v={fmt(t.recursionHits)} tone={t.recursionHits ? 'warn' : undefined} />
        <Kpi label="Deferred ticks" v={fmt(t.deferredTicks)} />
        <Kpi label="Peak timers" v={fmt(t.peakTimers)} />
      </div>
      <div className="panel-tools">
        <span className="dim">Sort by</span>
        <div className="seg">
          {(['mana', 'time', 'execs'] as const).map((k) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
              {k}
            </button>
          ))}
        </div>
        <span className="tflex" />
        <button className="tbtn" onClick={() => engine.rt.clearDiagnostics()}>
          Reset profile
        </button>
      </div>
      <table className="ptable">
        <thead>
          <tr>
            <th>Node</th>
            <th>Graph</th>
            <th className="num">Execs</th>
            <th className="num">Self ms</th>
            <th className="num">µs / exec</th>
            <th className="num">Mana</th>
            <th className="bar-col" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                Cast this spell to profile it. Each node reports how often it ran, its own CPU time, and the mana it spent.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const v = sort === 'mana' ? r.mana : sort === 'time' ? r.timeMs : r.execs;
            return (
              <tr key={`${r.graphId}|${r.nodeId}`} onClick={() => r.exists && focus(r.graphId, r.nodeId)} className={r.exists ? '' : 'gone'}>
                <td>{r.title}</td>
                <td className="dim">{r.graph}</td>
                <td className="num">{fmt(r.execs)}</td>
                <td className="num">{r.timeMs.toFixed(2)}</td>
                <td className="num">{r.execs ? ((r.timeMs * 1000) / r.execs).toFixed(1) : '–'}</td>
                <td className="num">{r.mana.toFixed(1)}</td>
                <td className="bar-col">
                  <span className="pbar" style={{ width: `${(v / max) * 100}%` }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, v, tone }: { label: string; v: string; tone?: 'warn' }) {
  return (
    <div className={`kpi${tone ? ' ' + tone : ''}`}>
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────

function Stats() {
  useEngineTick(4);
  const engine = getEngine();
  const s = engine.world.stats;
  const samples = engine.stats;
  const total = CHART_ORDER.reduce((a, e) => a + s.damage[e], 0);
  const last = samples[samples.length - 1];
  const peak = samples.reduce((a, x) => Math.max(a, x.total), 0);
  return (
    <div className="stats" data-testid="stats">
      <div className="kpis">
        <Kpi label="Total damage" v={fmt(total)} />
        <Kpi label="DPS now" v={fmt(last?.total ?? 0)} />
        <Kpi label="Peak DPS" v={fmt(peak)} />
        <Kpi label="Healing" v={fmt(s.healing)} />
        <Kpi label="Absorbed" v={fmt(s.absorbed)} />
        <Kpi label="Kills" v={fmt(s.kills)} />
        <Kpi label="Props destroyed" v={fmt(s.destroyed)} />
        <Kpi label="Reactions" v={fmt(s.reactions)} />
        <Kpi label="Peak entities" v={fmt(s.peakEntities)} />
        <Kpi label="Frame ms" v={(last?.frameMs ?? 0).toFixed(1)} />
      </div>
      <div className="charts">
        <div className="chart-card">
          <h5>Damage per second by element · last {Math.round((samples.length * 0.25) / 1)}s</h5>
          <StackedArea samples={samples} />
          <div className="legend">
            {CHART_ORDER.map((e) => (
              <span key={e}>
                <i style={{ background: CHART_COLOR[e] }} />
                {ELEMENT_INFO[e].label}
              </span>
            ))}
          </div>
        </div>
        <div className="chart-card">
          <h5>Mana</h5>
          <LineChart samples={samples} value={(x) => x.mana} max={engine.world.caster?.mana?.max ?? 300} color="#7f8cff" unit="" />
          <h5>Mana spent per second</h5>
          <LineChart samples={samples} value={(x) => x.manaSpent} color="#b07cff" unit="/s" />
        </div>
        <div className="chart-card narrow">
          <h5>Damage by element (totals)</h5>
          <table className="etable">
            <tbody>
              {CHART_ORDER.map((e) => (
                <tr key={e}>
                  <td>
                    <i style={{ background: CHART_COLOR[e] }} />
                    {ELEMENT_INFO[e].label}
                  </td>
                  <td className="bar-col">
                    <span className="pbar" style={{ width: `${total > 0 ? (s.damage[e] / total) * 100 : 0}%`, background: CHART_COLOR[e] }} />
                  </td>
                  <td className="num">{fmt(s.damage[e])}</td>
                  <td className="num dim">{total > 0 ? `${Math.round((s.damage[e] / total) * 100)}%` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="tbtn" onClick={() => engine.world.resetStats()}>
            Reset stats
          </button>
        </div>
      </div>
    </div>
  );
}

const CW = 520;
const CH = 120;

function useHover() {
  const [hx, setHx] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setHx(((e.clientX - r.left) / r.width) * CW);
  };
  return { ref, hx, onMove, onLeave: () => setHx(null) };
}

function StackedArea({ samples }: { samples: StatSample[] }) {
  useInterval(500);
  const h = useHover();
  const n = samples.length;
  const max = Math.max(10, ...samples.map((s) => s.total));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * CW);
  const y = (v: number) => CH - 4 - (v / max) * (CH - 14);
  const layers: { e: Element; d: string }[] = [];
  const base = new Array(n).fill(0);
  for (const e of CHART_ORDER) {
    const top = samples.map((s, i) => base[i] + Math.max(0, s.dps[e]));
    if (top.every((v, i) => v === base[i])) continue;
    let d = `M ${x(0)} ${y(top[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${x(i)} ${y(top[i])}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${x(i)} ${y(base[i])}`;
    layers.push({ e, d: d + ' Z' });
    for (let i = 0; i < n; i++) base[i] = top[i];
  }
  const hi = h.hx !== null && n > 1 ? Math.max(0, Math.min(n - 1, Math.round((h.hx / CW) * (n - 1)))) : null;
  const hs = hi !== null ? samples[hi] : null;
  return (
    <div className="chart-wrap">
      <svg ref={h.ref} viewBox={`0 0 ${CW} ${CH}`} className="chart" onPointerMove={h.onMove} onPointerLeave={h.onLeave} preserveAspectRatio="none" role="img" aria-label="Damage per second stacked by element">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={CW} y1={y(max * f)} y2={y(max * f)} className="grid" />
        ))}
        {layers.map((l) => (
          <path key={l.e} d={l.d} fill={CHART_COLOR[l.e]} fillOpacity={0.85} stroke="var(--panel-solid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {n < 2 && (
          <text x={CW / 2} y={CH / 2} className="chart-empty" textAnchor="middle">
            waiting for samples…
          </text>
        )}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={0} y2={CH} className="crosshair" />}
      </svg>
      <span className="axis-max">{fmt(max)}</span>
      {hs && (
        <div className="tooltip" style={{ left: `${(x(hi!) / CW) * 100}%` }}>
          <b>{hs.t.toFixed(1)}s · {fmt(hs.total)} dps</b>
          {CHART_ORDER.filter((e) => hs.dps[e] > 0.5).map((e) => (
            <span key={e}>
              <i style={{ background: CHART_COLOR[e] }} />
              {ELEMENT_INFO[e].label} {fmt(hs.dps[e])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LineChart({ samples, value, max: maxIn, color, unit }: { samples: StatSample[]; value: (s: StatSample) => number; max?: number; color: string; unit: string }) {
  const h = useHover();
  const n = samples.length;
  const vals = samples.map(value);
  const max = maxIn ?? Math.max(5, ...vals);
  const H = 60;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * CW);
  const y = (v: number) => H - 3 - (Math.min(v, max) / max) * (H - 8);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  const hi = h.hx !== null && n > 1 ? Math.max(0, Math.min(n - 1, Math.round((h.hx / CW) * (n - 1)))) : null;
  return (
    <div className="chart-wrap">
      <svg ref={h.ref} viewBox={`0 0 ${CW} ${H}`} className="chart small" onPointerMove={h.onMove} onPointerLeave={h.onLeave} preserveAspectRatio="none">
        <line x1={0} x2={CW} y1={y(max / 2)} y2={y(max / 2)} className="grid" />
        {n > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={0} y2={H} className="crosshair" />}
      </svg>
      <span className="axis-max">{fmt(max)}</span>
      {hi !== null && (
        <div className="tooltip" style={{ left: `${(x(hi) / CW) * 100}%` }}>
          <b>
            {samples[hi].t.toFixed(1)}s · {fmt(vals[hi], 1)}
            {unit}
          </b>
        </div>
      )}
    </div>
  );
}
