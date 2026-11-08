import { useEffect, useRef, useState } from 'react';
import { ELEMENT_INFO } from '../core/types';
import { HOTBAR_SIZE, getEngine } from '../engine/engine';
import { ArcaneRenderer } from '../render/renderer';
import { sigilDataUrl } from '../render/sigils';
import { PRESETS, SPAWNABLES } from '../sim/presets';
import type { AIBehavior } from '../sim/entity';
import { useStore } from '../state/store';
import { useEngineTick, useInterval } from './hooks';

export function ArenaView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getEngine();
  useEffect(() => {
    const c = canvasRef.current!;
    engine.attach(c, new ArcaneRenderer());
    return () => engine.detach();
  }, [engine]);
  return (
    <div className="arena">
      <ArenaToolbar />
      <div className="arena-stage">
        <canvas ref={canvasRef} className="arena-canvas" tabIndex={0} data-testid="arena-canvas" />
        <HUD />
        <Hotbar />
        <FlashMessage />
      </div>
    </div>
  );
}

function FlashMessage() {
  useEngineTick(10);
  useInterval(250);
  const m = getEngine().message;
  if (!m || performance.now() - m.t > 1600) return null;
  return (
    <div className="arena-flash" key={m.t}>
      {m.text}
    </div>
  );
}

function HUD() {
  useInterval(100);
  const engine = getEngine();
  const c = engine.world.caster;
  const mana = c?.mana;
  const rt = engine.rt;
  return (
    <div className="hud">
      <div className="hud-bars">
        <div className="bar bar-hp" title="Health">
          <span style={{ width: `${c ? (c.hp / c.maxHp) * 100 : 0}%` }} />
          <label>
            {engine.world.settings.godMode ? '∞ ' : ''}HP {c ? Math.ceil(c.hp) : 0}
          </label>
        </div>
        <div className="bar bar-mana" title="Mana — spells pay upfront for their complexity, then for every effect they actually create">
          <span style={{ width: `${mana ? (mana.cur / mana.max) * 100 : 0}%` }} />
          <label>
            {rt.settings.infiniteMana ? '∞ mana' : `Mana ${mana ? Math.floor(mana.cur) : 0} / ${mana?.max ?? 0}`}
          </label>
        </div>
      </div>
      <div className="hud-meta">
        <span title="Live entities">◉ {engine.world.list.length}</span>
        <span title="Pending timers (Delay / Every)">⏱ {rt.activeTimers}</span>
        <span title="Queued events">⚡ {rt.queuedEvents}</span>
        {rt.channeling && <span className="hud-channel">≋ channeling {(engine.world.time - rt.channeling.start).toFixed(1)}s</span>}
        {engine.paused && <span className="hud-paused">❚❚ paused</span>}
      </div>
    </div>
  );
}

function Hotbar() {
  useInterval(80);
  const engine = getEngine();
  const hotbar = useStore((s) => s.hotbar);
  const library = useStore((s) => s.library);
  const compiled = useStore((s) => s.compiled);
  const setHotbar = useStore((s) => s.setHotbar);
  const [, force] = useState(0);
  return (
    <div className="hotbar" data-testid="hotbar">
      {Array.from({ length: HOTBAR_SIZE }, (_, i) => {
        const id = hotbar[i];
        const doc = id ? library.find((d) => d.id === id) : undefined;
        const c = id ? compiled[id] : undefined;
        const cd = c ? engine.rt.cooldownLeft(c.doc.id) : 0;
        const frac = c && c.cooldown > 0 ? Math.min(1, cd / c.cooldown) : 0;
        const active = engine.activeSlot === i;
        const alt = engine.altSlot === i;
        const el = doc ? ELEMENT_INFO[doc.element] : null;
        return (
          <button
            key={i}
            className={`slot${active ? ' active' : ''}${alt ? ' alt' : ''}${c && !c.ok ? ' broken' : ''}`}
            style={el ? ({ '--slot': el.color } as React.CSSProperties) : undefined}
            onClick={() => {
              engine.activeSlot = i;
              force((x) => x + 1);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              engine.altSlot = i;
              force((x) => x + 1);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-spell-id')) e.preventDefault();
            }}
            onDrop={(e) => {
              const sid = e.dataTransfer.getData('application/x-spell-id');
              if (sid && i > 0) setHotbar(i, sid);
            }}
            title={
              doc
                ? `${doc.name}${i === 0 ? ' (the spell you are editing)' : ''}\n${c?.ok ? `Upfront ${c.upfront} mana · cooldown ${c.cooldown}s` : 'Has compile errors'}\nLeft-click arena: active slot · Right-click arena: alt slot (right-click here to bind)`
                : i === 0
                  ? 'Live slot: follows the spell open in the editor'
                  : 'Empty — drag a spell here from the Library'
            }
          >
            <span className="slot-key">{i + 1}</span>
            {doc && c ? <img src={sigilDataUrl(c.signature, doc.element, 64)} alt="" draggable={false} /> : <span className="slot-empty">＋</span>}
            {frac > 0 && <span className="slot-cd" style={{ height: `${frac * 100}%` }} />}
            {doc && <span className="slot-name">{i === 0 ? '✎ ' : ''}{doc.name}</span>}
            {alt && <span className="slot-alt" title="Bound to right mouse button">R</span>}
            {c && !c.ok && <span className="slot-err">!</span>}
          </button>
        );
      })}
    </div>
  );
}

function ArenaToolbar() {
  useEngineTick(4);
  const engine = getEngine();
  const [, force] = useState(0);
  const [settings, setSettings] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const rerender = () => force((x) => x + 1);
  const rt = engine.rt;
  const cfg = engine.arenaConfig;
  return (
    <div className="arena-toolbar">
      <select className="sel" value={engine.presetId} onChange={(e) => engine.loadPreset(e.target.value)} title="Experiment preset" data-testid="preset-select">
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="tbtn" onClick={() => engine.resetArena()} title="Rebuild the arena">
        ⟲ Reset
      </button>
      <span className="tsep" />
      <div className="seg" role="group" aria-label="Tool">
        <button className={engine.tool === 'cast' ? 'on' : ''} onClick={() => ((engine.tool = 'cast'), rerender())} title="Cast spells (left / right mouse)">
          ✶ Cast
        </button>
        <button className={engine.tool === 'grab' ? 'on' : ''} onClick={() => ((engine.tool = 'grab'), rerender())} title="Grab and throw physical objects">
          ✋ Grab
        </button>
        <div className="seg-pop">
          <button className={engine.tool.startsWith('spawn:') ? 'on' : ''} onClick={() => setSpawnOpen((v) => !v)} title="Place props, foes and terrain">
            ⊕ {engine.tool.startsWith('spawn:') ? SPAWNABLES.find((s) => `spawn:${s.kind}` === engine.tool)?.label : 'Spawn'} ▾
          </button>
          {spawnOpen && (
            <div className="popover spawn-pop" onMouseLeave={() => setSpawnOpen(false)}>
              {SPAWNABLES.map((s) => (
                <button
                  key={s.kind}
                  className={engine.tool === `spawn:${s.kind}` ? 'on' : ''}
                  onClick={() => {
                    engine.tool = `spawn:${s.kind}`;
                    setSpawnOpen(false);
                    rerender();
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="tsep" />
      <button className="tbtn" onClick={() => ((engine.paused = !engine.paused), rerender())} title="Pause / resume (Space when the arena is focused)" data-testid="pause">
        {engine.paused ? '▶' : '❚❚'}
      </button>
      <div className="seg" role="group" aria-label="Time scale">
        {[0.25, 0.5, 1, 2].map((t) => (
          <button key={t} className={engine.timeScale === t ? 'on' : ''} onClick={() => ((engine.timeScale = t), rerender())} title={`Time ×${t}`}>
            {t === 0.25 ? '¼' : t === 0.5 ? '½' : t}×
          </button>
        ))}
      </div>
      <span className="tflex" />
      <div className="seg-pop">
        <button className={`tbtn${settings ? ' on' : ''}`} onClick={() => setSettings((v) => !v)} title="Arena & runtime settings" data-testid="arena-settings">
          ⚙ Lab
        </button>
        {settings && (
          <div className="popover settings-pop">
            <h4>Sandbox</h4>
            <Toggle label="God mode (you can't be hurt)" v={engine.world.settings.godMode} set={(v) => ((engine.world.settings.godMode = v), rerender())} />
            <Toggle label="Infinite mana" v={rt.settings.infiniteMana} set={(v) => ((rt.settings.infiniteMana = v), rerender())} testid="infinite-mana" />
            <Toggle label="Ignore cooldowns" v={rt.settings.ignoreCooldowns} set={(v) => ((rt.settings.ignoreCooldowns = v), rerender())} />
            <Toggle label="Respawn targets" v={engine.world.settings.respawn} set={(v) => ((engine.world.settings.respawn = v), (cfg.respawn = v), rerender())} />
            <Toggle label="Friendly fire on yourself" v={engine.world.settings.friendlyFire} set={(v) => ((engine.world.settings.friendlyFire = v), rerender())} />
            <h4>Foes (applies on reset)</h4>
            <label className="row">
              Count <input type="range" min={1} max={16} value={cfg.enemyCount} onChange={(e) => ((cfg.enemyCount = Number(e.target.value)), rerender())} />
              <b>{cfg.enemyCount}</b>
            </label>
            <label className="row">
              Health <input type="range" min={0.25} max={4} step={0.25} value={cfg.enemyHp} onChange={(e) => ((cfg.enemyHp = Number(e.target.value)), rerender())} />
              <b>×{cfg.enemyHp}</b>
            </label>
            <label className="row">
              Behaviour
              <select className="sel" value={cfg.behavior} onChange={(e) => ((cfg.behavior = e.target.value as AIBehavior | 'mixed'), rerender())}>
                {['mixed', 'chase', 'strafe', 'ranged', 'idle', 'flee'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="row">
              Enemy damage <input type="range" min={0} max={3} step={0.25} value={engine.world.settings.enemyDamage} onChange={(e) => ((engine.world.settings.enemyDamage = Number(e.target.value)), rerender())} />
              <b>×{engine.world.settings.enemyDamage}</b>
            </label>
            <button className="btn primary" onClick={() => engine.resetArena()}>
              Apply & reset arena
            </button>
            <h4>Runtime limits</h4>
            <label className="row">
              Recursion depth <input type="range" min={2} max={32} value={rt.settings.maxDepth} onChange={(e) => ((rt.settings.maxDepth = Number(e.target.value)), rerender())} />
              <b>{rt.settings.maxDepth}</b>
            </label>
            <label className="row">
              Steps / burst <input type="range" min={500} max={20000} step={500} value={rt.settings.runBudget} onChange={(e) => ((rt.settings.runBudget = Number(e.target.value)), rerender())} />
              <b>{rt.settings.runBudget}</b>
            </label>
            <label className="row">
              Steps / tick <input type="range" min={2000} max={80000} step={1000} value={rt.settings.tickBudget} onChange={(e) => ((rt.settings.tickBudget = Number(e.target.value)), rerender())} />
              <b>{rt.settings.tickBudget}</b>
            </label>
            <p className="hint">WASD moves · 1–6 pick a slot · wheel cycles · Space pauses · hold to channel</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, v, set, testid }: { label: string; v: boolean; set: (v: boolean) => void; testid?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} data-testid={testid} />
      <span className="tg" />
      {label}
    </label>
  );
}
