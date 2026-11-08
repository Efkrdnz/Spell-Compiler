import { useEffect, useRef } from 'react';
import { getEngine } from '../engine/engine';
import { useStore } from '../state/store';

/** Temporary shell; replaced by the full UI. */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lib = useStore((s) => s.library);
  useEffect(() => {
    const engine = getEngine();
    void engine;
  }, []);
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 240, padding: 12 }}>
        {lib.map((d) => (
          <div key={d.id}>{d.name}</div>
        ))}
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
