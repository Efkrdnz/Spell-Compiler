import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { TYPE_INFO, type PinType } from '../core/types';
import { useHeat } from './heat';

export interface SpellEdgeData extends Record<string, unknown> {
  type: PinType;
  event: boolean;
  bad: boolean;
  badMsg?: string;
}

export type SpellFlowEdge = Edge<SpellEdgeData, 'spell'>;

function SpellEdgeImpl({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<SpellFlowEdge>) {
  const heat = useHeat(source);
  const t = data?.type ?? 'any';
  const exec = t === 'exec';
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const color = data?.bad ? '#ff5c7a' : exec ? (data?.event ? '#ffd27a' : '#efeaff') : TYPE_INFO[t].color;
  const hot = exec && heat > 0;
  const cls = ['se-edge', exec ? 'se-edge--exec' : 'se-edge--data', data?.event ? 'se-edge--event' : '', data?.bad ? 'se-edge--bad' : '', selected ? 'is-selected' : '', hot ? 'is-hot' : ''].filter(Boolean).join(' ');
  return (
    <g className={cls} style={{ '--c': color, '--heat': heat } as CSSProperties}>
      <path d={path} className="se-edge__halo" fill="none" />
      <BaseEdge id={id} path={path} interactionWidth={18} />
      {hot && <path d={path} className="se-edge__flow" fill="none" />}
      {data?.bad && <title>{data.badMsg}</title>}
    </g>
  );
}

export const SpellEdgeView = memo(SpellEdgeImpl);
