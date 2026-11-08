import { useSyncExternalStore } from 'react';
import { getEngine } from '../engine/engine';

/**
 * Low-rate (≈12 Hz) poll of the interpreter's execution heat and profile.
 * Components subscribe per node id and only re-render when their quantised
 * value changes, so tracing never re-renders the whole graph at 60 fps.
 */

const HOT_WINDOW = 0.6;
let prefix = '';
let heat = new Map<string, number>();
let execs = new Map<string, number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let refs = 0;

function poll(): void {
  const engine = getEngine();
  const now = engine.world.time;
  const nextHeat = new Map<string, number>();
  for (const [k, t] of engine.rt.heat) {
    if (!k.startsWith(prefix)) continue;
    const age = now - t;
    if (age < HOT_WINDOW && age >= -0.01) nextHeat.set(k.slice(prefix.length), Math.round((1 - age / HOT_WINDOW) * 5) / 5);
  }
  const nextExecs = new Map<string, number>();
  for (const [k, p] of engine.rt.profile) if (k.startsWith(prefix)) nextExecs.set(k.slice(prefix.length), p.execs);
  let changed = nextHeat.size !== heat.size || nextExecs.size !== execs.size;
  if (!changed) for (const [k, v] of nextHeat) if (heat.get(k) !== v) changed = true;
  if (!changed) for (const [k, v] of nextExecs) if (execs.get(k) !== v) changed = true;
  if (changed) {
    heat = nextHeat;
    execs = nextExecs;
    for (const l of listeners) l();
  }
}

export function setHeatScope(spellId: string, graphId: string): void {
  const p = `${spellId}|${graphId}|`;
  if (p !== prefix) {
    prefix = p;
    poll();
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (refs++ === 0) timer = setInterval(poll, 80);
  return () => {
    listeners.delete(l);
    if (--refs === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useHeat(nodeId: string): number {
  return useSyncExternalStore(subscribe, () => heat.get(nodeId) ?? 0);
}

export function useExecs(nodeId: string): number {
  return useSyncExternalStore(subscribe, () => execs.get(nodeId) ?? 0);
}

export function profileOf(spellId: string, graphId: string, nodeId: string) {
  return getEngine().rt.profile.get(`${spellId}|${graphId}|${nodeId}`);
}
