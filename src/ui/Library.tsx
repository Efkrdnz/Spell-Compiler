import { useMemo, useState } from 'react';
import { ELEMENT_INFO, uid, type SpellDoc } from '../core/types';
import { BLUEPRINTS, type Blueprint } from '../data/blueprints';
import { EXAMPLES } from '../data/examples';
import { getEngine } from '../engine/engine';
import { sigilDataUrl } from '../render/sigils';
import { PRESETS } from '../sim/presets';
import { useStore, type LibraryTab } from '../state/store';
import { compileSpell } from '../core/compiler';

const TABS: { id: LibraryTab; label: string; hint: string }[] = [
  { id: 'mine', label: 'My Spells', hint: 'Everything you have made. Saved automatically in this browser.' },
  { id: 'examples', label: 'Examples', hint: 'Editable showcase spells — add a copy and take it apart.' },
  { id: 'blueprints', label: 'Blueprints', hint: 'Reusable fragments you can drop into the spell you are editing.' },
  { id: 'presets', label: 'Experiments', hint: 'Arena setups designed to show off different kinds of magic.' },
];

export function LibraryModal() {
  const ui = useStore((s) => s.ui);
  const setUI = useStore((s) => s.setUI);
  if (!ui.libraryOpen) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUI({ libraryOpen: false })}>
      <div className="modal library" role="dialog" aria-label="Spell library" data-testid="library">
        <header>
          <h2>Grimoire</h2>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={ui.libraryTab === t.id ? 'on' : ''} onClick={() => setUI({ libraryTab: t.id })}>
                {t.label}
              </button>
            ))}
          </nav>
          <button className="x" onClick={() => setUI({ libraryOpen: false })} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="modal-hint">{TABS.find((t) => t.id === ui.libraryTab)?.hint}</p>
        <div className="modal-body">
          {ui.libraryTab === 'mine' && <MySpells />}
          {ui.libraryTab === 'examples' && <Examples />}
          {ui.libraryTab === 'blueprints' && <Blueprints />}
          {ui.libraryTab === 'presets' && <Presets />}
        </div>
      </div>
    </div>
  );
}

function SpellCard({ doc, children, onOpen }: { doc: SpellDoc; children?: React.ReactNode; onOpen?: () => void }) {
  const compiled = useStore((s) => s.compiled[doc.id]);
  const c = compiled ?? compileSpell(doc);
  const el = ELEMENT_INFO[doc.element];
  return (
    <div
      className="card spell-card"
      style={{ '--el': el.color, '--el-dark': el.dark } as React.CSSProperties}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-spell-id', doc.id)}
    >
      <button className="card-main" onClick={onOpen} title={onOpen ? 'Open in the editor' : undefined}>
        <img className="sigil" src={sigilDataUrl(c.signature, doc.element, 96)} alt="" />
        <div className="card-text">
          <h3>
            {doc.name}
            {!c.ok && <span className="badge err">errors</span>}
          </h3>
          <p>{doc.description || <i className="dim">No description</i>}</p>
          <div className="chips">
            <span className="chip el">
              {el.glyph} {el.label}
            </span>
            <span className="chip">◇ {c.complexity}</span>
            <span className="chip">✦ {c.upfront} mana</span>
            <span className="chip">⏱ {c.cooldown}s</span>
            {c.hasChannel && <span className="chip">channel</span>}
            {c.recursive && <span className="chip">recursive</span>}
            {doc.subspells.length > 0 && <span className="chip">{doc.subspells.length} subspell{doc.subspells.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
      </button>
      {children && <div className="card-actions">{children}</div>}
    </div>
  );
}

function MySpells() {
  const library = useStore((s) => s.library);
  const activeId = useStore((s) => s.activeId);
  const st = useStore.getState;
  const [q, setQ] = useState('');
  const list = library.filter((d) => !q || `${d.name} ${d.description} ${d.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const open = (id: string) => {
    st().setActive(id);
    st().setUI({ libraryOpen: false });
  };
  return (
    <>
      <div className="lib-tools">
        <input className="search" placeholder="Search your spells…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="btn primary"
          onClick={() => {
            st().createSpell();
            st().setUI({ libraryOpen: false });
          }}
          data-testid="new-spell"
        >
          ＋ New spell
        </button>
        <span className="dim">Drag a card onto a hotbar slot to bind it.</span>
      </div>
      <div className="grid">
        {list.map((d) => (
          <SpellCard key={d.id} doc={d} onOpen={() => open(d.id)}>
            {d.id === activeId && <span className="chip on">editing</span>}
            <HotbarPicker id={d.id} />
            <button className="tbtn" onClick={() => st().duplicateSpell(d.id)}>
              Duplicate
            </button>
            {EXAMPLES.some((e) => e.id === d.id) && (
              <button className="tbtn" onClick={() => confirm(`Reset “${d.name}” to the original example?`) && st().resetExample(d.id)}>
                Reset
              </button>
            )}
            <button className="tbtn danger" onClick={() => confirm(`Delete “${d.name}”? This can't be undone.`) && st().deleteSpell(d.id)}>
              Delete
            </button>
          </SpellCard>
        ))}
      </div>
    </>
  );
}

function HotbarPicker({ id }: { id: string }) {
  const hotbar = useStore((s) => s.hotbar);
  const setHotbar = useStore((s) => s.setHotbar);
  const slot = hotbar.findIndex((h, i) => i > 0 && h === id);
  return (
    <select
      className="sel"
      value={slot > 0 ? String(slot) : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (slot > 0) setHotbar(slot, null);
        if (v) setHotbar(Number(v), id);
      }}
      title="Bind to a hotbar slot"
    >
      <option value="">Hotbar…</option>
      {[1, 2, 3, 4, 5].map((i) => (
        <option key={i} value={String(i)}>
          Slot {i + 1}
        </option>
      ))}
    </select>
  );
}

function Examples() {
  const st = useStore.getState;
  return (
    <div className="grid">
      {EXAMPLES.map((ex) => (
        <SpellCard key={ex.id} doc={ex.doc}>
          <span className="dim small">{ex.summary}</span>
          <span className="tflex" />
          <button
            className="tbtn"
            onClick={() => {
              const id = st().addExample(ex.id);
              st().setActive(id);
              st().setUI({ libraryOpen: false });
              st().toast(`Added a copy of “${ex.doc.name}”`, 'success');
            }}
          >
            Add copy
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const existing = st().library.find((d) => d.id === ex.id);
              const id = existing ? existing.id : st().addExample(ex.id);
              st().setActive(id);
              getEngine().loadPreset(ex.preset);
              st().setUI({ libraryOpen: false });
              st().toast(`“${ex.doc.name}” is in your live slot — click the arena to cast`, 'success');
            }}
          >
            Try it
          </button>
        </SpellCard>
      ))}
    </div>
  );
}

function insertBlueprint(bp: Blueprint) {
  const st = useStore.getState();
  const graphId = st.graphId;
  st.mutate((doc) => {
    const g = graphId === 'main' ? doc.main : doc.subspells.find((x) => x.id === graphId);
    if (!g) return;
    const maxX = g.nodes.reduce((a, n) => Math.max(a, n.x), -300);
    const minY = g.nodes.reduce((a, n) => Math.min(a, n.y), 0);
    const map = new Map<string, string>();
    for (const n of bp.graph.nodes) {
      const id = uid('n');
      map.set(n.id, id);
      g.nodes.push({ ...structuredClone(n), id, x: n.x + maxX + 340, y: n.y + minY });
    }
    for (const e of bp.graph.edges) g.edges.push({ ...e, id: uid('e'), from: map.get(e.from)!, to: map.get(e.to)! });
  });
  useStore.setState({ selection: [] });
  st.setUI({ libraryOpen: false });
  st.toast(`Inserted “${bp.name}” — wire it into your flow`, 'success');
}

function Blueprints() {
  const doc = useStore((s) => s.active());
  const graphId = useStore((s) => s.graphId);
  const target = graphId === 'main' ? 'Main' : (doc.subspells.find((g) => g.id === graphId)?.name ?? 'graph');
  return (
    <>
      <p className="dim">
        Inserting into <b>{doc.name}</b> › <b>{target}</b>. Fragments arrive to the right of your nodes, ready to wire.
      </p>
      <div className="grid">
        {BLUEPRINTS.map((bp) => (
          <div key={bp.id} className="card bp-card">
            <div className="card-text">
              <h3>{bp.name}</h3>
              <p>{bp.description}</p>
              <div className="chips">
                {bp.graph.nodes.map((n) => (
                  <span key={n.id} className="chip">
                    {n.type}
                  </span>
                ))}
              </div>
            </div>
            <div className="card-actions">
              <span className="tflex" />
              <button className="btn primary" onClick={() => insertBlueprint(bp)}>
                Insert
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Presets() {
  const engine = getEngine();
  const st = useStore.getState;
  const featured = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ex of EXAMPLES) m.set(ex.preset, [...(m.get(ex.preset) ?? []), ex.doc.name]);
    return m;
  }, []);
  return (
    <div className="grid">
      {PRESETS.map((p) => (
        <div key={p.id} className={`card preset-card${engine.presetId === p.id ? ' current' : ''}`}>
          <div className="card-text">
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            {featured.get(p.id) && <p className="dim small">Great for: {featured.get(p.id)!.join(', ')}</p>}
          </div>
          <div className="card-actions">
            <span className="tflex" />
            <button
              className="btn primary"
              onClick={() => {
                engine.loadPreset(p.id);
                st().setUI({ libraryOpen: false });
              }}
            >
              Load arena
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
