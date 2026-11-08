import type { Element, Vec } from '../core/types';
import type { EntityKind } from './entity';

/**
 * One-shot visual events emitted by the simulation. The renderer consumes
 * (and clears) them each frame; the sim never depends on them.
 */
export type FxEvent =
  | { type: 'cast'; pos: Vec; element: Element; seed: number; power: number }
  | { type: 'explosion'; pos: Vec; radius: number; element: Element }
  | { type: 'hit'; pos: Vec; element: Element; dir: Vec; amount: number }
  | { type: 'number'; pos: Vec; amount: number; kind: 'damage' | 'heal' | 'shield' | 'crit'; element: Element }
  | { type: 'bolt'; points: Vec[]; element: Element; width: number }
  | { type: 'teleport'; from: Vec; to: Vec; element: Element }
  | { type: 'shatter'; pos: Vec; radius: number }
  | { type: 'ignite'; pos: Vec }
  | { type: 'freeze'; pos: Vec; radius: number }
  | { type: 'death'; pos: Vec; kind: EntityKind; element: Element; radius: number }
  | { type: 'debris'; pos: Vec; kind: EntityKind; radius: number }
  | { type: 'shockwave'; pos: Vec; radius: number; element: Element }
  | { type: 'heal'; pos: Vec; radius: number }
  | { type: 'shieldHit'; pos: Vec; radius: number }
  | { type: 'fizzle'; pos: Vec; reason: string }
  | { type: 'spawn'; pos: Vec; element: Element; radius: number }
  | { type: 'transmute'; pos: Vec; radius: number; element: Element }
  | { type: 'steam'; pos: Vec }
  | { type: 'text'; pos: Vec; text: string; color: string };
