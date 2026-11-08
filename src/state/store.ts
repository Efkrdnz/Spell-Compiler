import { create } from 'zustand';
import type { CompiledSpell } from '../core/compiler';
import { cloneDoc, decodeShare } from '../core/serialize';
import { SPELL_FORMAT, uid, type SpellDoc, type SpellGraph } from '../core/types';
import { EXAMPLES, exampleById } from '../data/examples';
import { getEngine } from '../engine/engine';

export type Layout = 'split' | 'editor' | 'arena';
export type DockTab = 'problems' | 'trace' | 'profiler' | 'stats';
export type LibraryTab = 'mine' | 'examples' | 'blueprints' | 'presets';

export interface UIState {
  layout: Layout;
  dock: DockTab;
  dockOpen: boolean;
  libraryOpen: boolean;
  libraryTab: LibraryTab;
  split: number; // fraction of width for the editor
  inspectorOpen: boolean;
  ioOpen: boolean;
  helpOpen: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface History {
  past: SpellDoc[];
  future: SpellDoc[];
}

export interface MutateOpts {
  /** consecutive mutations with the same key within 800ms merge into one undo step */
  coalesce?: string;
  /** skip history entirely (e.g. selection-only changes) */
  noHistory?: boolean;
}

export interface StoreState {
  library: SpellDoc[];
  activeId: string;
  graphId: string;
  compiled: Record<string, CompiledSpell>;
  history: Record<string, History>;
  selection: string[];
  ui: UIState;
  toasts: Toast[];
  hotbar: (string | null)[];
  revision: number;

  active(): SpellDoc;
  activeGraph(): SpellGraph;
  setActive(id: string): void;
  setGraph(id: string): void;
  mutate(fn: (doc: SpellDoc) => void, opts?: MutateOpts): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  createSpell(name?: string): string;
  duplicateSpell(id: string): string;
  deleteSpell(id: string): void;
  importDocs(docs: SpellDoc[]): string[];
  addExample(id: string): string;
  resetExample(id: string): void;
  addSubspell(name?: string): string;
  removeSubspell(id: string): void;
  setSelection(ids: string[]): void;
  setUI(p: Partial<UIState>): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setHotbar(slot: number, id: string | null): void;
}

const LS_KEY = 'spell-compiler/library/v1';
const LS_UI = 'spell-compiler/ui/v1';
const LS_HOTBAR = 'spell-compiler/hotbar/v1';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

function loadLibrary(): SpellDoc[] {
  const raw = safeGet(LS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw) as SpellDoc[];
      if (Array.isArray(arr) && arr.length && arr.every((d) => d && d.format === SPELL_FORMAT && d.main)) return arr;
    } catch {
      /* fall through to examples */
    }
  }
  return EXAMPLES.map((e) => ({ ...cloneDoc(e.doc), created: Date.now(), updated: Date.now() }));
}

const DEFAULT_UI: UIState = {
  layout: 'split',
  dock: 'problems',
  dockOpen: true,
  libraryOpen: false,
  libraryTab: 'mine',
  split: 0.5,
  inspectorOpen: true,
  ioOpen: false,
  helpOpen: false,
};

function loadUI(): UIState {
  try {
    const raw = safeGet(LS_UI);
    if (raw) return { ...DEFAULT_UI, ...JSON.parse(raw), libraryOpen: false, ioOpen: false, helpOpen: false };
  } catch {
    /* ignore */
  }
  return DEFAULT_UI;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(lib: SpellDoc[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => safeSet(LS_KEY, JSON.stringify(lib)), 300);
}

let lastCoalesce: { key: string; t: number; id: string } | null = null;
let toastId = 1;

export function blankSpell(name = 'New Spell'): SpellDoc {
  const now = Date.now();
  return {
    format: SPELL_FORMAT,
    id: uid('spell'),
    name,
    description: '',
    tags: [],
    element: 'arcane',
    author: 'You',
    main: {
      id: 'main',
      name: 'Main',
      nodes: [
        { id: uid('n'), type: 'onCast', x: 0, y: 80, values: {} },
        { id: uid('n'), type: 'projectile', x: 320, y: 40, values: {} },
      ],
      edges: [],
    },
    subspells: [],
    variables: [],
    created: now,
    updated: now,
  };
}

export const useStore = create<StoreState>((set, get) => {
  const engine = getEngine();
  const library = loadLibrary();
  // starter wiring for the blank-spell template
  for (const d of library) if (d.main.edges.length === 0 && d.main.nodes.length === 2 && d.main.nodes[0].type === 'onCast') d.main.edges.push({ id: uid('e'), from: d.main.nodes[0].id, fromPort: 'then', to: d.main.nodes[1].id, toPort: 'in' });
  engine.setLibrary(library);
  const compiled: Record<string, CompiledSpell> = {};
  for (const [id, c] of engine.compiled) compiled[id] = c;

  // hotbar: restore or fill with the first spells
  let hotbar: (string | null)[] = new Array(engine.hotbar.length).fill(null);
  try {
    const raw = safeGet(LS_HOTBAR);
    if (raw) hotbar = (JSON.parse(raw) as (string | null)[]).map((h) => (h && library.some((d) => d.id === h) ? h : null)).slice(0, engine.hotbar.length);
  } catch {
    /* ignore */
  }
  while (hotbar.length < engine.hotbar.length) hotbar.push(null);
  if (hotbar.every((h) => !h)) library.slice(0, engine.hotbar.length).forEach((d, i) => (hotbar[i] = d.id));
  hotbar.forEach((h, i) => engine.setHotbar(i, h));

  // shared spell via URL hash
  let activeId = library[0]?.id ?? '';
  try {
    const m = location.hash.match(/spell=([^&]+)/);
    if (m) {
      const { doc } = decodeShare(m[1]);
      const existing = library.findIndex((d) => d.id === doc.id);
      if (existing >= 0) doc.id = uid('spell');
      doc.name = doc.name.endsWith('(shared)') ? doc.name : `${doc.name} (shared)`;
      library.unshift(doc);
      engine.upsertSpell(doc);
      compiled[doc.id] = engine.compiled.get(doc.id)!;
      activeId = doc.id;
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch {
    /* bad share code: ignore, toast later */
  }

  const recompile = (doc: SpellDoc) => {
    const c = engine.upsertSpell(doc);
    const next = { ...get().compiled, [doc.id]: c };
    // dependants may have been recompiled too
    for (const [id, cc] of engine.compiled) if (next[id] !== cc) next[id] = cc;
    return next;
  };

  return {
    library,
    activeId,
    graphId: 'main',
    compiled,
    history: {},
    selection: [],
    ui: loadUI(),
    toasts: [],
    hotbar,
    revision: 0,

    active() {
      const s = get();
      return s.library.find((d) => d.id === s.activeId) ?? s.library[0];
    },
    activeGraph() {
      const s = get();
      const doc = s.active();
      if (!doc) return { id: 'main', name: 'Main', nodes: [], edges: [] };
      return s.graphId === 'main' ? doc.main : (doc.subspells.find((g) => g.id === s.graphId) ?? doc.main);
    },
    setActive(id) {
      if (!get().library.some((d) => d.id === id)) return;
      set({ activeId: id, graphId: 'main', selection: [] });
    },
    setGraph(id) {
      set({ graphId: id, selection: [] });
    },
    mutate(fn, opts = {}) {
      const s = get();
      const cur = s.active();
      if (!cur) return;
      const next = cloneDoc(cur);
      fn(next);
      next.updated = Date.now();
      const lib = s.library.map((d) => (d.id === cur.id ? next : d));
      let history = s.history;
      if (!opts.noHistory) {
        const h = s.history[cur.id] ?? { past: [], future: [] };
        const now = performance.now();
        const merge = opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && lastCoalesce.id === cur.id && now - lastCoalesce.t < 800;
        const past = merge ? h.past : [...h.past, cur].slice(-120);
        history = { ...s.history, [cur.id]: { past, future: [] } };
        lastCoalesce = opts.coalesce ? { key: opts.coalesce, t: now, id: cur.id } : null;
      }
      set({ library: lib, history, compiled: recompile(next), revision: s.revision + 1 });
      scheduleSave(lib);
    },
    undo() {
      const s = get();
      const cur = s.active();
      const h = s.history[cur.id];
      if (!h || !h.past.length) return;
      const prev = h.past[h.past.length - 1];
      const lib = s.library.map((d) => (d.id === cur.id ? prev : d));
      lastCoalesce = null;
      const graphOk = s.graphId === 'main' || prev.subspells.some((g) => g.id === s.graphId);
      set({
        library: lib,
        history: { ...s.history, [cur.id]: { past: h.past.slice(0, -1), future: [cur, ...h.future] } },
        compiled: recompile(prev),
        revision: s.revision + 1,
        graphId: graphOk ? s.graphId : 'main',
      });
      scheduleSave(lib);
    },
    redo() {
      const s = get();
      const cur = s.active();
      const h = s.history[cur.id];
      if (!h || !h.future.length) return;
      const nxt = h.future[0];
      const lib = s.library.map((d) => (d.id === cur.id ? nxt : d));
      lastCoalesce = null;
      const graphOk = s.graphId === 'main' || nxt.subspells.some((g) => g.id === s.graphId);
      set({
        library: lib,
        history: { ...s.history, [cur.id]: { past: [...h.past, cur], future: h.future.slice(1) } },
        compiled: recompile(nxt),
        revision: s.revision + 1,
        graphId: graphOk ? s.graphId : 'main',
      });
      scheduleSave(lib);
    },
    canUndo() {
      const s = get();
      return (s.history[s.activeId]?.past.length ?? 0) > 0;
    },
    canRedo() {
      const s = get();
      return (s.history[s.activeId]?.future.length ?? 0) > 0;
    },
    createSpell(name) {
      const doc = blankSpell(name);
      doc.main.edges.push({ id: uid('e'), from: doc.main.nodes[0].id, fromPort: 'then', to: doc.main.nodes[1].id, toPort: 'in' });
      const lib = [doc, ...get().library];
      set({ library: lib, activeId: doc.id, graphId: 'main', compiled: recompile(doc), selection: [] });
      scheduleSave(lib);
      return doc.id;
    },
    duplicateSpell(id) {
      const src = get().library.find((d) => d.id === id);
      if (!src) return '';
      const doc = cloneDoc(src);
      doc.id = uid('spell');
      doc.name = `${src.name} copy`;
      doc.created = doc.updated = Date.now();
      doc.tags = doc.tags.filter((t) => t !== 'example');
      const lib = [doc, ...get().library];
      set({ library: lib, activeId: doc.id, graphId: 'main', compiled: recompile(doc) });
      scheduleSave(lib);
      return doc.id;
    },
    deleteSpell(id) {
      const s = get();
      if (s.library.length <= 1) {
        s.toast('Keep at least one spell in the library.', 'error');
        return;
      }
      const lib = s.library.filter((d) => d.id !== id);
      engine.removeSpell(id);
      const compiled = { ...s.compiled };
      delete compiled[id];
      const hotbar = s.hotbar.map((h) => (h === id ? null : h));
      set({ library: lib, compiled, activeId: s.activeId === id ? lib[0].id : s.activeId, graphId: 'main', hotbar });
      safeSet(LS_HOTBAR, JSON.stringify(hotbar));
      scheduleSave(lib);
    },
    importDocs(docs) {
      const s = get();
      const ids: string[] = [];
      let lib = [...s.library];
      let compiled = s.compiled;
      for (const d of docs) {
        const doc = cloneDoc(d);
        if (lib.some((x) => x.id === doc.id)) doc.id = uid('spell');
        lib = [doc, ...lib];
        ids.push(doc.id);
      }
      engine.setLibrary(lib);
      compiled = {};
      for (const [id, c] of engine.compiled) compiled[id] = c;
      set({ library: lib, compiled, activeId: ids[0] ?? s.activeId, graphId: 'main' });
      scheduleSave(lib);
      return ids;
    },
    addExample(id) {
      const ex = exampleById(id);
      if (!ex) return '';
      const [nid] = get().importDocs([ex.doc]);
      return nid;
    },
    resetExample(id) {
      const s = get();
      const cur = s.library.find((d) => d.id === id);
      const ex = exampleById(id);
      if (!cur || !ex) return;
      get().mutate((d) => {
        const fresh = cloneDoc(ex.doc);
        Object.assign(d, fresh, { id: cur.id });
      });
    },
    addSubspell(name = 'Subspell') {
      const id = uid('sub');
      get().mutate((d) => {
        d.subspells.push({
          id,
          name: `${name} ${d.subspells.length + 1}`,
          params: [],
          nodes: [{ id: uid('n'), type: 'entry', x: 0, y: 60, values: {} }],
          edges: [],
        });
      });
      set({ graphId: id });
      return id;
    },
    removeSubspell(id) {
      get().mutate((d) => {
        d.subspells = d.subspells.filter((g) => g.id !== id);
      });
      if (get().graphId === id) set({ graphId: 'main' });
    },
    setSelection(ids) {
      set({ selection: ids });
    },
    setUI(p) {
      const ui = { ...get().ui, ...p };
      set({ ui });
      safeSet(LS_UI, JSON.stringify(ui));
    },
    toast(text, kind = 'info') {
      const id = toastId++;
      set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setHotbar(slot, id) {
      const hotbar = [...get().hotbar];
      hotbar[slot] = id;
      engine.setHotbar(slot, id);
      set({ hotbar });
      safeSet(LS_HOTBAR, JSON.stringify(hotbar));
    },
  };
});
