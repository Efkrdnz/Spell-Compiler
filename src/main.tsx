import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './ui/theme.css';
import { getEngine } from './engine/engine';
import { useStore } from './state/store';
import { App } from './ui/App';

// Console / automation hook: inspect the engine and store from devtools or e2e tests.
(window as unknown as { __sc: unknown }).__sc = { engine: getEngine(), store: useStore };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
