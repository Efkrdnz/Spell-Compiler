import { useEffect, useReducer, useRef } from 'react';
import type { Element } from '../core/types';
import { getEngine } from '../engine/engine';

/** Re-render when the engine notifies, throttled to `hz`. */
export function useEngineTick(hz = 4): number {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  const last = useRef(0);
  useEffect(() => {
    const engine = getEngine();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsub = engine.subscribe(() => {
      const now = performance.now();
      const gap = 1000 / hz;
      if (now - last.current >= gap) {
        last.current = now;
        bump();
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          last.current = performance.now();
          bump();
        }, gap - (now - last.current));
      }
    });
    return () => {
      unsub();
      if (pending) clearTimeout(pending);
    };
  }, [hz]);
  return n;
}

/** Re-render on an animation-frame-ish interval (for HUD bits like cooldown sweeps). */
export function useInterval(ms: number): number {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(bump, ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

/**
 * Chart colors for elements: same hue identity as ELEMENT_INFO but stepped into
 * the dark-mode lightness band and ordered so adjacent series separate under
 * colour-vision deficiency (validated with the dataviz palette checker).
 */
export const CHART_ORDER: Element[] = ['fire', 'lightning', 'life', 'arcane', 'ice', 'void', 'force'];
export const CHART_COLOR: Record<Element, string> = {
  fire: '#dd6f23',
  lightning: '#355bbd',
  life: '#47ab4f',
  arcane: '#b53989',
  ice: '#1ba8b5',
  void: '#723eb5',
  force: '#9d8519',
};

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(digits);
}
