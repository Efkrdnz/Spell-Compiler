import { useEffect, useRef, useState } from 'react';
import { ELEMENT_INFO } from '../core/types';
import { SpellEditor } from '../editor/SpellEditor';
import '../editor/editor.css';
import { getEngine } from '../engine/engine';
import { sigilDataUrl } from '../render/sigils';
import { useStore, type Layout } from '../state/store';
import { ArenaView } from './ArenaView';
import { Dock } from './Dock';
import { ImportExportModal, copyText, shareUrl } from './ImportExport';
import { LibraryModal } from './Library';
import './ui.css';

export function App() {
  const ui = useStore((s) => s.ui);
  const activeId = useStore((s) => s.activeId);
  const setHotbar = useStore((s) => s.setHotbar);
  // slot 1 is the live slot: it always holds the spell open in the editor
  useEffect(() => {
    if (activeId) setHotbar(0, activeId);
  }, [activeId, setHotbar]);
  useGlobalKeys();
  return (
    <div className={`app layout-${ui.layout}`}>
      <TopBar />
      <main className="workspace">
        <Split />
      </main>
      <LibraryModal />
      <ImportExportModal />
      <Help />
      <Toasts />
    </div>
  );
}

function Split() {
  const ui = useStore((s) => s.ui);
  const setUI = useStore((s) => s.setUI);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const r = ref.current!.getBoundingClientRect();
      setUI({ split: Math.min(0.78, Math.max(0.22, (e.clientX - r.left) / r.width)) });
    };
    const up = () => setDrag(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, setUI]);
  const showEditor = ui.layout !== 'arena';
  const showArena = ui.layout !== 'editor';
  const left = ui.layout === 'split' ? `${ui.split * 100}%` : '100%';
  return (
    <div className={`split${drag ? ' dragging' : ''}`} ref={ref}>
      {showEditor && (
        <section className="pane pane-editor" style={{ width: showArena ? left : '100%' }}>
          <div className="editor-host">
            <SpellEditor />
          </div>
          <Dock />
        </section>
      )}
      {showEditor && showArena && <div className="splitter" onPointerDown={() => setDrag(true)} title="Drag to resize" />}
      {showArena && (
        <section className="pane pane-arena">
          <ArenaView />
          {!showEditor && <Dock />}
        </section>
      )}
    </div>
  );
}

function TopBar() {
  const doc = useStore((s) => s.active());
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const library = useStore((s) => s.library);
  const ui = useStore((s) => s.ui);
  const st = useStore.getState;
  const canUndo = useStore((s) => (s.history[s.activeId]?.past.length ?? 0) > 0);
  const canRedo = useStore((s) => (s.history[s.activeId]?.future.length ?? 0) > 0);
  const errs = compiled?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warns = compiled?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
  const el = ELEMENT_INFO[doc.element];
  return (
    <header className="topbar">
      <div className="brand" title="Spell Compiler">
        <img src={sigilDataUrl(7340033, 'arcane', 64)} alt="" />
        <span>
          SPELL <b>COMPILER</b>
        </span>
      </div>
      <div className="spell-switch" style={{ '--el': el.color } as React.CSSProperties}>
        <span className="el-dot">{el.glyph}</span>
        <input
          className="spell-name"
          value={doc.name}
          onChange={(e) => st().mutate((d) => void (d.name = e.target.value), { coalesce: 'rename' })}
          aria-label="Spell name"
          data-testid="spell-name"
        />
        <select className="sel" value={doc.id} onChange={(e) => st().setActive(e.target.value)} title="Switch spell" data-testid="spell-select">
          {library.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className={`compile-badge ${errs ? 'bad' : warns ? 'warn' : 'ok'}`}
        onClick={() => st().setUI({ dock: 'problems', dockOpen: true, layout: ui.layout === 'arena' ? 'split' : ui.layout })}
        data-testid="compile-badge"
        title="Compiler status — click for details"
      >
        {errs ? `✕ ${errs} error${errs > 1 ? 's' : ''}` : warns ? `▲ ${warns} warning${warns > 1 ? 's' : ''}` : '✓ Compiled'}
      </button>
      {compiled && (
        <div className="metrics" title="Complexity drives the upfront mana cost and the cooldown. Effects pay extra for what they actually create.">
          <span>
            <i>complexity</i>
            {compiled.complexity}
          </span>
          <span>
            <i>upfront</i>
            {compiled.upfront}
            <small> mana</small>
          </span>
          <span>
            <i>effects ≈</i>
            {compiled.estimate}
          </span>
          <span>
            <i>cooldown</i>
            {compiled.cooldown}s
          </span>
        </div>
      )}
      <span className="tflex" />
      <div className="seg">
        <button onClick={() => st().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={() => st().redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
      </div>
      <div className="seg" role="group" aria-label="Layout">
        {(['editor', 'split', 'arena'] as Layout[]).map((l) => (
          <button key={l} className={ui.layout === l ? 'on' : ''} onClick={() => st().setUI({ layout: l })} title={`${l} layout`}>
            {l === 'editor' ? '◧ Editor' : l === 'split' ? '◫ Split' : '◨ Arena'}
          </button>
        ))}
      </div>
      <button className="btn" onClick={() => st().setUI({ libraryOpen: true, libraryTab: 'mine' })} data-testid="open-library">
        ❖ Grimoire
      </button>
      <button className="btn" onClick={() => st().setUI({ ioOpen: true })} data-testid="open-io">
        ⇅ Import / Export
      </button>
      <button className="btn" onClick={async () => st().toast((await copyText(shareUrl())) ? 'Share link copied to clipboard' : 'Clipboard blocked — use Import / Export', 'success')} title="Copy a link containing this spell">
        ⤴ Share
      </button>
      <button className="btn icon" onClick={() => st().setUI({ helpOpen: true })} title="How it works">
        ?
      </button>
    </header>
  );
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        useStore.getState().toast('Saved — your grimoire autosaves in this browser', 'success');
      }
      if (e.key === 'Escape') useStore.getState().setUI({ libraryOpen: false, ioOpen: false, helpOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

function Help() {
  const open = useStore((s) => s.ui.helpOpen);
  const setUI = useStore((s) => s.setUI);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUI({ helpOpen: false })}>
      <div className="modal help" role="dialog" aria-label="Help">
        <header>
          <h2>How spells work</h2>
          <button className="x" onClick={() => setUI({ helpOpen: false })} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="help-cols">
          <section>
            <h4>The language</h4>
            <ul>
              <li>
                <b>White pins</b> are flow: they say <i>when</i> things happen. <b>Coloured pins</b> carry typed data — numbers, vectors, entities, elements.
              </li>
              <li>
                Every spell starts at a <b>trigger</b>: On Cast (press), While Channeling (hold) or On Release.
              </li>
              <li>
                Effect nodes have <b>event pins</b> (⚡ On Hit, On Expire, On Tick…) that fire <i>later</i>, when the arena says so. Values like “Hit Entity” only exist downstream of their event — the compiler checks this.
              </li>
              <li>Unwired inputs use the value typed into the node, or an automatic source like ⟨aim⟩ or ⟨caster⟩.</li>
              <li>Subspells are reusable graphs with parameters. They can call themselves; recursion stops at the depth limit. Cast Spell triggers another spell from your grimoire.</li>
            </ul>
            <h4>The economy</h4>
            <ul>
              <li>Casting pays an upfront cost from the spell's complexity, then each effect pays for what it actually creates (bigger, longer, more = more mana).</li>
              <li>Runaway work is contained: a burst may run {getEngine().rt.settings.runBudget} steps, extra work per tick is deferred, and infinite timers starve themselves of mana.</li>
            </ul>
          </section>
          <section>
            <h4>Controls</h4>
            <table className="keys">
              <tbody>
                {[
                  ['Left / right click', 'Cast the active slot / the alt slot (R)'],
                  ['Hold', 'Channel (While Channeling), release for On Release'],
                  ['WASD', 'Move your wizard'],
                  ['1–6, wheel', 'Choose hotbar slot (slot 1 follows the editor)'],
                  ['Space', 'Pause (arena focused)'],
                  ['Space / double-click', 'Quick-add node (editor)'],
                  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
                  ['Ctrl+C / V / D', 'Copy / paste / duplicate nodes'],
                  ['Delete', 'Remove selection'],
                  ['Shift+A · F', 'Auto-arrange · frame'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Investigate</h4>
            <ul>
              <li>
                <b>Trace</b> shows every node step, event and fizzle — nodes glow in the editor as they run.
              </li>
              <li>
                <b>Profiler</b> attributes executions, CPU time and mana to each node.
              </li>
              <li>
                <b>Stats</b> charts damage per element, mana flow and arena load.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
