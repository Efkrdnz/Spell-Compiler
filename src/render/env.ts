import type { Element, Vec } from '../core/types';
import type { Entity } from '../sim/entity';
import type { Lighting } from './lighting';
import type { Particles } from './particles';

/** Everything a draw module needs for one frame. */
export interface DrawEnv {
  /** main (lit) context, world transform applied */
  g: CanvasRenderingContext2D;
  /** emissive context (additive, unlit), world transform applied */
  e: CanvasRenderingContext2D;
  light: Lighting;
  P: Particles;
  t: number;
  dt: number;
  /** world → device transform */
  S: number;
  ox: number;
  oy: number;
  caster: Entity | undefined;
  cursor: Vec | null;
  activeElement: Element;
  /** 0..1 emission budget; drops under heavy load */
  budget: number;
  hoverId: number;
}
