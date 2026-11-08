import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ELEMENTS, ELEMENT_INFO, type Element, type Vec } from '../core/types';

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function clampTo(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/** Number field: drag horizontally to scrub, click to type. */
export function ScrubNumber({
  value,
  onChange,
  min,
  max,
  step,
  width = 64,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fmt(value));
  const drag = useRef<{ x: number; v: number; moved: boolean; id: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const st = step ?? (Math.abs(value) >= 50 ? 5 : Math.abs(value) >= 5 ? 1 : 0.05);

  useEffect(() => {
    if (!editing) setText(fmt(value));
  }, [value, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onChange(clampTo(v, min, max));
    setEditing(false);
  };

  if (editing)
    return (
      <input
        ref={inputRef}
        className="se-num se-num--edit nodrag nowheel"
        style={{ width }}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );

  const pct = min !== undefined && max !== undefined && max > min ? (clampTo(value, min, max) - min) / (max - min) : null;
  return (
    <div
      className="se-num nodrag nowheel"
      style={{ width, '--pct': pct === null ? 0 : pct } as CSSProperties}
      title={title ?? 'Drag to scrub · click to type · Shift = fine'}
      data-has-range={pct !== null}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        const mult = e.shiftKey ? 0.1 : 1;
        let v = d.v + Math.round(dx / 4) * st * mult;
        if (st >= 1 && !e.shiftKey) v = Math.round(v / st) * st;
        else v = Math.round(v * 1000) / 1000;
        onChange(clampTo(v, min, max));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (d && !d.moved) setEditing(true);
      }}
    >
      <span className="se-num__chev">‹</span>
      <span className="se-num__val">{fmt(value)}</span>
      <span className="se-num__chev">›</span>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`se-toggle nodrag ${value ? 'is-on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!value);
      }}
      title={value ? 'true' : 'false'}
    >
      <span className="se-toggle__knob" />
    </button>
  );
}

export function ElementPicker({ value, onChange, size = 'sm' }: { value: string; onChange: (v: Element) => void; size?: 'sm' | 'lg' }) {
  return (
    <div className={`se-elems se-elems--${size} nodrag`}>
      {ELEMENTS.map((el) => {
        const info = ELEMENT_INFO[el];
        const on = el === value;
        return (
          <button
            key={el}
            type="button"
            className={`se-elem ${on ? 'is-on' : ''}`}
            style={{ '--el': info.color, '--el-glow': info.glow } as CSSProperties}
            title={info.label}
            onClick={(e) => {
              e.stopPropagation();
              onChange(el);
            }}
          >
            <span className="se-elem__glyph">{info.glyph}</span>
            {size === 'lg' && <span className="se-elem__label">{info.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function VectorField({ value, onChange }: { value: Vec; onChange: (v: Vec) => void }) {
  return (
    <div className="se-vec nodrag">
      <span className="se-vec__ax">x</span>
      <ScrubNumber value={value.x} step={5} width={46} onChange={(x) => onChange({ x, y: value.y })} />
      <span className="se-vec__ax">y</span>
      <ScrubNumber value={value.y} step={5} width={46} onChange={(y) => onChange({ x: value.x, y })} />
    </div>
  );
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  width,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  const missing = value !== '' && !options.some((o) => o.value === value);
  return (
    <div className="se-select nodrag nowheel" style={{ width }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className={value === '' || missing ? 'is-empty' : ''}
      >
        {(value === '' || missing) && <option value={value}>{missing ? `⚠ ${value}` : (placeholder ?? 'Choose…')}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="se-select__chev">▾</span>
    </div>
  );
}

/** Text input that commits on blur/Enter and doesn't leak keystrokes to the graph. */
export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  live,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** commit on every keystroke (caller should coalesce) */
  live?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const common = {
    className: `se-text nodrag nowheel ${className}`,
    value: text,
    placeholder,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (text !== value) onChange(text);
    },
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      if (live) onChange(e.target.value);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !multiline) (e.target as HTMLElement).blur();
      if (e.key === 'Escape') {
        setText(value);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? <textarea {...common} rows={3} /> : <input {...common} />;
}
