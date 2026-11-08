/** Dev-only harness: mounts the editor full-window for visual / interaction testing (editor-lab.html). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../ui/theme.css';
import './editor.css';
import { getEngine } from '../engine/engine';
import { useStore } from '../state/store';
import { SpellEditor } from './SpellEditor';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 100 }}>
      {toasts.map((t) => (
        <div key={t.id} className="lab-toast" data-kind={t.kind} style={{ padding: '8px 14px', borderRadius: 8, background: t.kind === 'error' ? '#5a1626' : '#221c3a', border: '1px solid rgba(255,255,255,.15)' }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

const w = window as unknown as Record<string, unknown>;
w.__engine = getEngine();
w.__store = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
      <SpellEditor />
    </div>
    <Toasts />
  </StrictMode>,
);
