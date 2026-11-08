import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as RDragEvent } from 'react';
import type { CompiledSpell } from '../core/compiler';
import { CATEGORY_INFO } from '../core/nodes/defs';
import { autoLayout, NODE_WIDTH } from '../core/layout';
import { getDef, palette, type PaletteEntry } from '../core/nodes/registry';
import type { Diagnostic, PinType, SpellDoc, SpellGraph, Vec } from '../core/types';
import { useStore } from '../state/store';
import { GraphTabs } from './GraphTabs';
import {
  checkConnection,
  compatiblePort,
  connectInDoc,
  copySelection,
  envFor,
  getInternalClip,
  graphOf,
  makeNode,
  nodePorts,
  parseClip,
  pasteInto,
  removeNodes,
  resolvedOutType,
  type ClipPayload,
} from './graphOps';
import { setHeatScope } from './heat';
import { Inspector } from './Inspector';
import { DND_MIME, Palette, QuickAdd } from './Palette';
import { SpellEdgeView, type SpellFlowEdge } from './SpellEdge';
import { SpellNodeView, type SpellFlowNode } from './SpellNode';

const nodeTypes = { spell: SpellNodeView };
const edgeTypes = { spell: SpellEdgeView };

function lsBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}
function lsSetBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function buildNodes(doc: SpellDoc, graph: SpellGraph, compiled: CompiledSpell | undefined, graphId: string): SpellFlowNode[] {
  const cin = new Map<string, string[]>();
  const cout = new Map<string, string[]>();
  for (const e of graph.edges) {
    (cin.get(e.to) ?? cin.set(e.to, []).get(e.to)!).push(e.toPort);
    (cout.get(e.from) ?? cout.set(e.from, []).get(e.from)!).push(e.fromPort);
  }
  const diags = new Map<string, Diagnostic[]>();
  for (const d of compiled?.diagnostics ?? []) if (d.graphId === graphId && d.nodeId) (diags.get(d.nodeId) ?? diags.set(d.nodeId, []).get(d.nodeId)!).push(d);
  const cg = compiled ? (graphId === 'main' ? compiled.main : compiled.subs.get(graphId)) : undefined;
  return graph.nodes.map((n) => {
    const def = getDef(n.type);
    const { inputs, outputs } = nodePorts(doc, graph, n);
    const ci = cg?.byId.get(n.id);
    const outTypes: Record<string, PinType> = {};
    for (const o of outputs) outTypes[o.id] = ci !== undefined ? (cg!.nodes[ci].outTypes[o.id] ?? o.type) : o.type;
    return {
      id: n.id,
      type: 'spell' as const,
      position: { x: n.x, y: n.y },
      data: { node: n, def, graphId, inputs, outputs, outTypes, connectedIn: cin.get(n.id) ?? [], connectedOut: cout.get(n.id) ?? [], diags: diags.get(n.id) ?? [] },
    };
  });
}

function buildEdges(doc: SpellDoc, graph: SpellGraph, compiled: CompiledSpell | undefined, graphId: string): SpellFlowEdge[] {
  const bad = new Map<string, string>();
  for (const d of compiled?.diagnostics ?? []) if (d.graphId === graphId && d.edgeId) bad.set(d.edgeId, d.message);
  const portCache = new Map<string, ReturnType<typeof nodePorts>>();
  const ports = (id: string) => {
    let p = portCache.get(id);
    if (!p) {
      const n = graph.nodes.find((x) => x.id === id);
      p = n ? nodePorts(doc, graph, n) : { inputs: [], outputs: [] };
      portCache.set(id, p);
    }
    return p;
  };
  const out: SpellFlowEdge[] = [];
  for (const e of graph.edges) {
    const op = ports(e.from).outputs.find((p) => p.id === e.fromPort);
    const ip = ports(e.to).inputs.find((p) => p.id === e.toPort);
    if (!op || !ip) continue; // dangling: reported by the compiler, not drawable
    const t = resolvedOutType(compiled, graphId, e.from, op);
    out.push({
      id: e.id,
      source: e.from,
      sourceHandle: e.fromPort,
      target: e.to,
      targetHandle: e.toPort,
      type: 'spell',
      data: { type: t, event: !!op.event || !!op.async, bad: bad.has(e.id), badMsg: bad.get(e.id) },
      zIndex: t === 'exec' ? 1 : 0,
    });
  }
  return out;
}

function ZoomReadout() {
  const { zoom } = useViewport();
  return <span className="se-tool__zoom">{Math.round(zoom * 100)}%</span>;
}

interface Pending {
  nodeId: string;
  handleId: string;
  fromOutput: boolean;
  pinType: PinType;
}

function EditorInner() {
  const doc = useStore((s) => s.active());
  const graphId = useStore((s) => s.graphId);
  const compiled = useStore((s) => s.compiled[s.activeId]);
  const focus = useStore((s) => s.focus);
  const canUndo = useStore((s) => (s.history[s.activeId]?.past.length ?? 0) > 0);
  const canRedo = useStore((s) => (s.history[s.activeId]?.future.length ?? 0) > 0);
  const graph = graphOf(doc, graphId);
  const rf = useReactFlow<SpellFlowNode, SpellFlowEdge>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const [palOpen, setPalOpen] = useState(() => lsBool('se/palette', true));
  const [inspOpen, setInspOpen] = useState(() => lsBool('se/inspector', true));
  const [snap, setSnap] = useState(() => lsBool('se/snap', false));
  // In a narrow pane (e.g. split view) the inspector starts collapsed so the canvas keeps room.
  const [paneWidth, setPaneWidth] = useState(1400);
  const [inspNarrowOpen, setInspNarrowOpen] = useState(false);
  const narrow = paneWidth < 1080;
  const inspVisible = narrow ? inspNarrowOpen : inspOpen;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPaneWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [quick, setQuick] = useState<{ x: number; y: number; flow: Vec; pending?: Pending } | null>(null);
  const [nodes, setNodes] = useState<SpellFlowNode[]>([]);
  const [edges, setEdges] = useState<SpellFlowEdge[]>([]);
  const lastPaste = useRef(0);

  useEffect(() => setHeatScope(doc.id, graphId), [doc.id, graphId]);

  const derivedNodes = useMemo(() => buildNodes(doc, graph, compiled, graphId), [doc, graph, compiled, graphId]);
  const derivedEdges = useMemo(() => buildEdges(doc, graph, compiled, graphId), [doc, graph, compiled, graphId]);

  useEffect(() => {
    setNodes((prev) => {
      const pm = new Map(prev.map((p) => [p.id, p]));
      return derivedNodes.map((d) => {
        const p = pm.get(d.id);
        if (!p) return d;
        return { ...d, measured: p.measured, selected: p.selected, dragging: p.dragging, position: p.dragging ? p.position : d.position };
      });
    });
  }, [derivedNodes]);
  useEffect(() => {
    setEdges((prev) => {
      const pm = new Map(prev.map((p) => [p.id, p]));
      return derivedEdges.map((d) => ({ ...d, selected: pm.get(d.id)?.selected }));
    });
  }, [derivedEdges]);

  // ── focus requests from outside (problems / trace panels) ─────────────
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focus || focus.seq === handledFocus.current || focus.graphId !== graphId) return;
    const n = nodes.find((x) => x.id === focus.nodeId);
    if (!n) return;
    handledFocus.current = focus.seq;
    setNodes((nds) => nds.map((x) => ({ ...x, selected: x.id === focus.nodeId })));
    const w = n.measured?.width ?? NODE_WIDTH;
    const h = n.measured?.height ?? 120;
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 450 });
  }, [focus, nodes, graphId, rf]);

  // ── helpers ────────────────────────────────────────────────────────────
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);

  const flowAtMouse = useCallback((): Vec => {
    const m = mouse.current;
    if (m) return rf.screenToFlowPosition(m);
    const r = canvasRef.current?.getBoundingClientRect();
    return r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
  }, [rf]);

  const selectOnly = useCallback((ids: string[]) => {
    const set = new Set(ids);
    // nodes arrive from the store on the next render; mark them once they exist
    requestAnimationFrame(() => setNodes((nds) => nds.map((n) => ({ ...n, selected: set.has(n.id) }))));
    useStore.getState().setSelection(ids);
  }, []);

  const addEntry = useCallback(
    (key: string, at: Vec, pending?: Pending) => {
      const entry = palette().find((e) => e.key === key);
      if (!entry) return;
      const def = getDef(entry.type);
      if (def?.only === 'main' && graphId !== 'main') {
        toast(`${def.title} only works in the main graph.`, 'error');
        return;
      }
      if (def?.only === 'subspell' && graphId === 'main') {
        toast(`${def.title} only belongs inside a subspell.`, 'error');
        return;
      }
      const node = makeNode(entry.type, entry.values ?? {}, { x: at.x - (pending && !pending.fromOutput ? NODE_WIDTH : 0), y: at.y - 20 });
      mutate((d) => {
        const g = graphOf(d, graphId);
        g.nodes.push(node);
        if (pending) {
          const port = compatiblePort(d, g, node, pending.pinType, pending.fromOutput);
          if (port) {
            if (pending.fromOutput) connectInDoc(g, pending.nodeId, pending.handleId, node.id, port.id, port.type !== 'exec');
            else connectInDoc(g, node.id, port.id, pending.nodeId, pending.handleId, port.type !== 'exec');
          }
        }
      });
      selectOnly([node.id]);
    },
    [graphId, mutate, toast, selectOnly],
  );

  const selectedIds = useCallback(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  const deleteSelection = useCallback(() => {
    const ids = new Set(selectedIds());
    const eids = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (!ids.size && !eids.size) return;
    mutate((d) => removeNodes(graphOf(d, graphId), ids, eids));
    useStore.getState().setSelection([]);
    // the focused node element is gone: keep keyboard focus inside the editor
    wrapRef.current?.focus({ preventScroll: true });
  }, [selectedIds, edges, mutate, graphId]);

  const doCopy = useCallback(
    (cut = false): ClipPayload | null => {
      const ids = selectedIds();
      const clip = copySelection(graph, ids);
      if (!clip) return null;
      try {
        void navigator.clipboard?.writeText(JSON.stringify(clip)).catch(() => undefined);
      } catch {
        /* clipboard not permitted */
      }
      if (cut) deleteSelection();
      toast(`${cut ? 'Cut' : 'Copied'} ${clip.nodes.length} node${clip.nodes.length === 1 ? '' : 's'}`, 'info');
      return clip;
    },
    [selectedIds, graph, deleteSelection, toast],
  );

  const doPaste = useCallback(
    (clip: ClipPayload | null, at: Vec | null) => {
      if (!clip) return;
      let ids: string[] = [];
      mutate((d) => {
        const g = graphOf(d, graphId);
        const filtered = { ...clip, nodes: clip.nodes.filter((n) => {
          const def = getDef(n.type);
          return def && !(def.only === 'main' && graphId !== 'main') && !(def.only === 'subspell' && graphId === 'main');
        }) };
        ids = pasteInto(g, filtered, at);
      });
      if (ids.length) selectOnly(ids);
      lastPaste.current = performance.now();
    },
    [mutate, graphId, selectOnly],
  );

  const duplicate = useCallback(() => {
    const clip = copySelection(graph, selectedIds());
    if (!clip) return;
    let ids: string[] = [];
    mutate((d) => (ids = pasteInto(graphOf(d, graphId), clip, null)));
    selectOnly(ids);
  }, [graph, selectedIds, mutate, graphId, selectOnly]);

  const arrange = useCallback(() => {
    mutate((d) => {
      const g = graphOf(d, graphId);
      autoLayout(g, envFor(d, g));
    });
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 60);
  }, [mutate, graphId, rf]);

  const openQuick = useCallback((clientX: number, clientY: number, pending?: Pending) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(Math.max(8, clientX - r.left), r.width - 300);
    const y = Math.min(Math.max(8, clientY - r.top), Math.max(8, r.height - 380));
    setQuick({ x, y, flow: rf.screenToFlowPosition({ x: clientX, y: clientY }), pending });
  }, [rf]);

  // ── clipboard events (permission-free path) ────────────────────────────
  useEffect(() => {
    const inside = () => !!wrapRef.current && wrapRef.current.contains(document.activeElement) && !isTypingTarget(document.activeElement);
    const onCopy = (e: ClipboardEvent) => {
      if (!inside()) return;
      const clip = copySelection(graph, nodes.filter((n) => n.selected).map((n) => n.id));
      if (clip && e.clipboardData) {
        e.clipboardData.setData('text/plain', JSON.stringify(clip));
        e.preventDefault();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!inside()) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const clip = parseClip(text) ?? getInternalClip();
      if (clip) {
        e.preventDefault();
        doPaste(clip, flowAtMouse());
      }
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [graph, nodes, doPaste, flowAtMouse]);

  // ── keyboard ────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const st = useStore.getState();
    if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      st.undo();
    } else if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) {
      e.preventDefault();
      st.redo();
    } else if (mod && k === 'c') {
      doCopy(false);
    } else if (mod && k === 'x') {
      e.preventDefault();
      doCopy(true);
    } else if (mod && k === 'v') {
      // the native paste event normally handles this; fall back to the internal clipboard
      const t = performance.now();
      setTimeout(() => {
        if (lastPaste.current < t) doPaste(getInternalClip(), flowAtMouse());
      }, 60);
    } else if (mod && k === 'd') {
      e.preventDefault();
      duplicate();
    } else if (mod && k === 'a') {
      e.preventDefault();
      setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
      st.setSelection(nodes.map((n) => n.id));
    } else if (k === 'delete' || k === 'backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (k === 'f' && !mod) {
      const sel = nodes.filter((n) => n.selected);
      rf.fitView({ nodes: sel.length ? sel : undefined, padding: 0.25, duration: 350, maxZoom: 1.4 });
    } else if (k === 'a' && e.shiftKey && !mod) {
      e.preventDefault();
      arrange();
    } else if ((k === ' ' || k === 'tab') && !mod) {
      e.preventDefault();
      const m = mouse.current;
      const r = canvasRef.current?.getBoundingClientRect();
      if (m) openQuick(m.x, m.y);
      else if (r) openQuick(r.left + r.width / 2, r.top + r.height / 3);
    } else if (k === 'escape') {
      setQuick(null);
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
      st.setSelection([]);
    }
  };

  // ── React Flow handlers ────────────────────────────────────────────────
  const onNodesChange = useCallback((changes: NodeChange<SpellFlowNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<SpellFlowEdge>[]) => {
    setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds));
  }, []);
  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    const ids = sel.map((n) => n.id);
    const cur = useStore.getState().selection;
    if (ids.length !== cur.length || ids.some((id, i) => cur[i] !== id)) useStore.getState().setSelection(ids);
  }, []);
  const onNodeDragStop = useCallback(
    (_e: unknown, _n: SpellFlowNode, dragged: SpellFlowNode[]) => {
      const pos = new Map(dragged.map((n) => [n.id, n.position]));
      const g = graphOf(useStore.getState().active(), graphId);
      const moved = g.nodes.some((n) => {
        const p = pos.get(n.id);
        return p && (Math.round(p.x) !== n.x || Math.round(p.y) !== n.y);
      });
      if (!moved) return;
      mutate((d) => {
        for (const n of graphOf(d, graphId).nodes) {
          const p = pos.get(n.id);
          if (p) {
            n.x = Math.round(p.x);
            n.y = Math.round(p.y);
          }
        }
      });
    },
    [mutate, graphId],
  );

  const isValidConnection: IsValidConnection<SpellFlowEdge> = useCallback(
    (c) => {
      const s = useStore.getState();
      const d = s.active();
      return checkConnection(d, graphOf(d, s.graphId), s.compiled[s.activeId], c.source, c.sourceHandle, c.target, c.targetHandle).ok;
    },
    [],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const s = useStore.getState();
      const d = s.active();
      const chk = checkConnection(d, graphOf(d, graphId), s.compiled[s.activeId], c.source, c.sourceHandle, c.target, c.targetHandle);
      if (!chk.ok) {
        toast(chk.reason ?? 'Invalid connection', 'error');
        return;
      }
      mutate((dd) => connectInDoc(graphOf(dd, graphId), c.source, c.sourceHandle!, c.target, c.targetHandle!, chk.toPort!.type !== 'exec'));
    },
    [graphId, mutate, toast],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid) return;
      const from = state.fromHandle;
      if (!from || !from.id) return;
      const s = useStore.getState();
      const d = s.active();
      const g = graphOf(d, graphId);
      const fromOutput = from.type === 'source';
      if (state.toHandle && state.toHandle.id) {
        const to = state.toHandle;
        if (to.nodeId === from.nodeId && to.id === from.id) return;
        const chk = fromOutput
          ? checkConnection(d, g, s.compiled[s.activeId], from.nodeId, from.id, to.nodeId, to.id)
          : checkConnection(d, g, s.compiled[s.activeId], to.nodeId, to.id, from.nodeId, from.id);
        if ((from.type === to.type)) toast(fromOutput ? 'Outputs connect to inputs — drag onto an input pin (left side).' : 'Inputs connect to outputs — drag onto an output pin (right side).', 'error');
        else if (!chk.ok) toast(chk.reason ?? 'Those pins are not compatible.', 'error');
        return;
      }
      // dropped on empty canvas → quick-add filtered to compatible nodes, then auto-wire
      const target = (event as MouseEvent).target as HTMLElement | null;
      if (!target?.closest('.react-flow__pane') && !target?.classList.contains('react-flow__pane')) return;
      const n = g.nodes.find((x) => x.id === from.nodeId);
      if (!n) return;
      const ports = nodePorts(d, g, n);
      const port = (fromOutput ? ports.outputs : ports.inputs).find((p) => p.id === from.id);
      if (!port) return;
      const pinType = fromOutput ? resolvedOutType(s.compiled[s.activeId], graphId, n.id, port) : port.type;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
      openQuick(pt.clientX, pt.clientY, { nodeId: n.id, handleId: port.id, fromOutput, pinType });
    },
    [graphId, toast, openQuick],
  );

  const quickFilter = useMemo(() => {
    const pending = quick?.pending;
    const inSub = graphId !== 'main';
    return (e: PaletteEntry) => {
      const def = getDef(e.type);
      if (!def) return false;
      if (def.only === 'main' && inSub) return false;
      if (def.only === 'subspell' && !inSub) return false;
      if (!pending) return true;
      const d = useStore.getState().active();
      const g = graphOf(d, graphId);
      return !!compatiblePort(d, g, makeNode(e.type, e.values ?? {}), pending.pinType, pending.fromOutput);
    };
  }, [quick?.pending, graphId]);

  const onDrop = (e: RDragEvent) => {
    const key = e.dataTransfer.getData(DND_MIME);
    if (!key) return;
    e.preventDefault();
    addEntry(key, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const addAtCenter = (key: string) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const jitter = (nodes.length % 5) * 18;
    addEntry(key, { x: c.x - NODE_WIDTH / 2 + jitter, y: c.y - 60 + jitter });
  };

  const nodesReady = useNodesInitialized();
  const fitOnGraphChange = useRef('');
  useEffect(() => {
    // also refit when the layout mode flips (narrow ↔ wide) or the inspector opens/closes
    const key = `${doc.id}|${graphId}|${narrow}|${inspVisible}|${palOpen}`;
    if (fitOnGraphChange.current === key || !nodesReady || !nodes.length) return;
    if (!nodes.some((n) => graph.nodes[0] && n.id === graph.nodes[0].id)) return;
    fitOnGraphChange.current = key;
    setTimeout(() => rf.fitView({ padding: 0.14, maxZoom: 1.05, duration: 0 }), 40);
  }, [doc.id, graphId, nodes, nodesReady, rf, graph, narrow, inspVisible, palOpen]);

  const empty = graph.nodes.length === 0;

  return (
    <div
      className="se-root"
      ref={wrapRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={(e) => (mouse.current = { x: e.clientX, y: e.clientY })}
    >
      <Palette
        collapsed={!palOpen}
        onToggle={() => {
          lsSetBool('se/palette', !palOpen);
          setPalOpen(!palOpen);
        }}
        onAdd={addAtCenter}
      />
      <div className="se-center">
        <GraphTabs />
        <div
          className="se-canvas"
          ref={canvasRef}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DND_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={onDrop}
          onDoubleClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.classList.contains('react-flow__pane')) openQuick(e.clientX, e.clientY);
          }}
        >
          <ReactFlow<SpellFlowNode, SpellFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onEdgeDoubleClick={(_e, edge) => mutate((d) => removeNodes(graphOf(d, graphId), new Set(), new Set([edge.id])))}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={2}
            snapToGrid={snap}
            snapGrid={[16, 16]}
            connectionRadius={26}
            colorMode="dark"
            connectionLineStyle={{ stroke: '#cfc4ff', strokeWidth: 2.2, strokeDasharray: '6 4' }}
            defaultEdgeOptions={{ type: 'spell' }}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
          >
            <Background id="dots" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgba(183,140,255,0.22)" />
            <Background id="grid" variant={BackgroundVariant.Lines} gap={176} lineWidth={1} color="rgba(120,100,220,0.06)" />
            <MiniMap
              pannable
              zoomable
              className="se-minimap"
              style={{ width: narrow ? 120 : 170, height: narrow ? 80 : 110 }}
              nodeColor={(n) => {
                const def = getDef((n as SpellFlowNode).data?.node?.type ?? '');
                return def ? CATEGORY_INFO[def.category].color : '#555';
              }}
              nodeStrokeWidth={0}
              nodeBorderRadius={6}
              maskColor="rgba(7,6,13,0.72)"
            />
            <Controls showInteractive={false} className="se-controls" />
          </ReactFlow>
          <div className="se-toolbar">
            <button className="se-tool" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Undo (Ctrl+Z)">
              ↶
            </button>
            <button className="se-tool" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Redo (Ctrl+Shift+Z)">
              ↷
            </button>
            <span className="se-tool__sep" />
            <button className="se-tool" onClick={arrange} title="Auto-arrange (Shift+A)">
              ⊞
            </button>
            <button className="se-tool" onClick={() => rf.fitView({ padding: 0.18, duration: 350, maxZoom: 1.2 })} title="Frame all (F)">
              ⛶
            </button>
            <button
              className={`se-tool ${snap ? 'is-on' : ''}`}
              onClick={() => {
                lsSetBool('se/snap', !snap);
                setSnap(!snap);
              }}
              title="Snap to grid"
            >
              ⌗
            </button>
            <span className="se-tool__sep" />
            <ZoomReadout />
          </div>
          {empty && (
            <div className="se-empty">
              <div className="se-empty__sigil">✶</div>
              <div className="se-empty__title">An empty grimoire page</div>
              <div className="se-empty__text">
                Drag nodes from the palette, or press <kbd>Space</kbd> to search. Start with a{' '}
                <b>{graphId === 'main' ? 'On Cast' : 'Subspell Entry'}</b> trigger.
              </div>
            </div>
          )}
          {quick && (
            <QuickAdd
              x={quick.x}
              y={quick.y}
              title={quick.pending ? `Connect to ${quick.pending.fromOutput ? 'output' : 'input'} · ${quick.pending.pinType}` : 'Add node'}
              filter={quickFilter}
              onClose={() => setQuick(null)}
              onPick={(key) => {
                addEntry(key, quick.flow, quick.pending);
                setQuick(null);
                wrapRef.current?.focus();
              }}
            />
          )}
          <div className="se-legend" style={{ '--x': 0 } as CSSProperties}>
            <span><i className="se-legend__exec" /> flow</span>
            <span><i className="se-legend__event" /> event</span>
            <span><i style={{ background: '#7cc7ff' }} /> number</span>
            <span><i style={{ background: '#ffd166' }} /> vector</span>
            <span><i style={{ background: '#7dffb2' }} /> entity</span>
            <span><i style={{ background: '#ff9cf0' }} /> element</span>
            <span><i style={{ background: '#ff6b8b' }} /> bool</span>
          </div>
        </div>
      </div>
      <Inspector
        collapsed={!inspVisible}
        onToggle={() => {
          if (narrow) setInspNarrowOpen(!inspNarrowOpen);
          else {
            lsSetBool('se/inspector', !inspOpen);
            setInspOpen(!inspOpen);
          }
        }}
      />
    </div>
  );
}

export function SpellEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
