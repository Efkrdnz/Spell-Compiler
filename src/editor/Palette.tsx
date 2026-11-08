import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CATEGORY_INFO, type Category } from '../core/nodes/defs';
import { getDef, palette, type PaletteEntry } from '../core/nodes/registry';
import { ELEMENT_INFO } from '../core/types';

export const DND_MIME = 'application/x-spell-node';

export function scoreEntry(e: PaletteEntry, q: string): number {
  if (!q) return 1;
  const t = e.title.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 60;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 40;
  if (t.includes(q)) return 30;
  if (e.keywords.some((k) => k.startsWith(q))) return 20;
  if (e.keywords.some((k) => k.includes(q))) return 12;
  if (CATEGORY_INFO[e.category].label.toLowerCase().includes(q)) return 8;
  if (e.description.toLowerCase().includes(q)) return 4;
  return 0;
}

export function searchPalette(q: string, filter?: (e: PaletteEntry) => boolean): PaletteEntry[] {
  const query = q.trim().toLowerCase();
  const all = palette().filter((e) => !filter || filter(e));
  if (!query) return all;
  return all
    .map((e) => ({ e, s: scoreEntry(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

function entryColor(e: PaletteEntry): string {
  const def = getDef(e.type);
  const el = (e.values?.element as string) ?? def?.element;
  if (el && el in ELEMENT_INFO) return ELEMENT_INFO[el as keyof typeof ELEMENT_INFO].color;
  return CATEGORY_INFO[e.category].color;
}

export function EntryRow({ e, active, onPick, draggable = true }: { e: PaletteEntry; active?: boolean; onPick: () => void; draggable?: boolean }) {
  return (
    <div
      className={`se-pal__item ${active ? 'is-active' : ''} ${e.values ? 'is-preset' : ''}`}
      style={{ '--cat': entryColor(e) } as CSSProperties}
      draggable={draggable}
      onDragStart={(ev) => {
        ev.dataTransfer.setData(DND_MIME, e.key);
        ev.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onPick}
      title={e.description}
    >
      <span className="se-pal__icon">{e.icon}</span>
      <span className="se-pal__name">{e.title}</span>
      {e.values && <span className="se-pal__preset">preset</span>}
    </div>
  );
}

export function Palette({ onAdd, collapsed, onToggle }: { onAdd: (key: string) => void; collapsed: boolean; onToggle: () => void }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<Category>>(new Set());
  const results = useMemo(() => searchPalette(q), [q]);
  const groups = useMemo(() => {
    const m = new Map<Category, PaletteEntry[]>();
    for (const e of results) {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category)!.push(e);
    }
    return [...m.entries()].sort((a, b) => CATEGORY_INFO[a[0]].order - CATEGORY_INFO[b[0]].order);
  }, [results]);
  const hover = useRef<PaletteEntry | null>(null);
  const [tip, setTip] = useState<PaletteEntry | null>(null);

  if (collapsed)
    return (
      <div className="se-pal se-pal--collapsed">
        <button className="se-iconbtn" onClick={onToggle} title="Show node palette">
          ☰
        </button>
        <div className="se-pal__vlabel">NODES</div>
      </div>
    );
  return (
    <div className="se-pal">
      <div className="se-pal__top">
        <div className="se-pal__search">
          <span className="se-pal__glass">⌕</span>
          <input
            value={q}
            placeholder="Search nodes…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && results[0]) onAdd(results[0].key);
              if (e.key === 'Escape') setQ('');
            }}
          />
        </div>
        <button className="se-iconbtn" onClick={onToggle} title="Hide palette">
          ‹
        </button>
      </div>
      <div className="se-pal__list" onMouseLeave={() => setTip(null)}>
        {groups.map(([cat, entries]) => {
          const isClosed = closed.has(cat) && !q;
          return (
            <div key={cat} className="se-pal__group" style={{ '--cat': CATEGORY_INFO[cat].color } as CSSProperties}>
              <button
                className="se-pal__ghead"
                onClick={() => {
                  const n = new Set(closed);
                  if (n.has(cat)) n.delete(cat);
                  else n.add(cat);
                  setClosed(n);
                }}
              >
                <span className="se-pal__gdot" />
                {CATEGORY_INFO[cat].label}
                <span className="se-pal__gcount">{entries.length}</span>
                <span className="se-pal__gchev">{isClosed ? '▸' : '▾'}</span>
              </button>
              {!isClosed &&
                entries.map((e) => (
                  <div
                    key={e.key}
                    onMouseEnter={() => {
                      hover.current = e;
                      setTip(e);
                    }}
                  >
                    <EntryRow e={e} onPick={() => onAdd(e.key)} />
                  </div>
                ))}
            </div>
          );
        })}
        {!groups.length && <div className="se-pal__empty">No nodes match “{q}”.</div>}
      </div>
      <div className="se-pal__tip">{tip ? tip.description : 'Drag a node onto the canvas, or click to add it at the centre.'}</div>
    </div>
  );
}

/** Floating searchable add-menu (Space / double-click / drop a wire on empty canvas). */
export function QuickAdd({
  x,
  y,
  title,
  filter,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  title?: string;
  filter?: (e: PaletteEntry) => boolean;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const results = useMemo(() => searchPalette(q, filter).slice(0, 60), [q, filter]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.se-quick')) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);
  const sel = results[idx];
  return (
    <div className="se-quick" style={{ left: x, top: y }} onKeyDown={(e) => e.stopPropagation()}>
      {title && <div className="se-quick__title">{title}</div>}
      <div className="se-pal__search">
        <span className="se-pal__glass">⌕</span>
        <input
          autoFocus
          value={q}
          placeholder="Type to search…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              if (sel) onPick(sel.key);
            } else if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <div className="se-quick__list" ref={listRef}>
        {results.map((e, i) => (
          <div key={e.key} onMouseEnter={() => setIdx(i)}>
            <EntryRow e={e} active={i === idx} draggable={false} onPick={() => onPick(e.key)} />
          </div>
        ))}
        {!results.length && <div className="se-pal__empty">Nothing compatible matches.</div>}
      </div>
      {sel && (
        <div className="se-quick__desc">
          <b>{CATEGORY_INFO[sel.category].label}</b> · {sel.description}
        </div>
      )}
    </div>
  );
}
