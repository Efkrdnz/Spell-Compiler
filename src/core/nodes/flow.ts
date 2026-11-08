import { COSTS } from '../costs';
import type { DataType, Value } from '../types';
import { P, type NodeDef, type PortDef } from './defs';

const castOutputs = (exec: PortDef, extra: PortDef[] = []): PortDef[] => [
  exec,
  P.out('caster', 'Caster', 'entity'),
  P.out('origin', 'Origin', 'vector', { doc: 'Where the spell is cast from (the caster).' }),
  P.out('target', 'Target Point', 'vector', { doc: 'The cursor position in the arena.' }),
  P.out('aim', 'Aim', 'vector', { doc: 'Unit direction from the caster to the cursor.' }),
  ...extra,
];

export const FLOW_NODES: NodeDef[] = [
  // ── Triggers ──────────────────────────────────────────────────────────────
  {
    type: 'onCast',
    title: 'On Cast',
    category: 'trigger',
    icon: '✶',
    trigger: 'cast',
    only: 'main',
    cost: 0,
    description: 'Fires once when you press the mouse button with this spell selected.',
    inputs: [],
    outputs: castOutputs(P.then('then', 'Cast')),
  },
  {
    type: 'onChannel',
    title: 'While Channeling',
    category: 'trigger',
    icon: '≋',
    trigger: 'channel',
    only: 'main',
    cost: 1,
    description: 'Fires repeatedly while the mouse button is held. Each tick pays its own effects.',
    params: [{ id: 'interval', label: 'Interval (s)', kind: 'number', default: 0.15, min: 0.05, max: 2, step: 0.05 }],
    inputs: [],
    outputs: castOutputs(P.then('tick', 'Tick'), [P.out('elapsed', 'Held (s)', 'number'), P.out('count', 'Tick #', 'number')]),
  },
  {
    type: 'onRelease',
    title: 'On Release',
    category: 'trigger',
    icon: '⇡',
    trigger: 'release',
    only: 'main',
    cost: 0,
    description: 'Fires when the mouse button is released. "Held" tells you how long it was charged.',
    inputs: [],
    outputs: castOutputs(P.then('then', 'Release'), [P.out('held', 'Held (s)', 'number')]),
  },
  {
    type: 'entry',
    title: 'Subspell Entry',
    category: 'trigger',
    icon: '⟴',
    trigger: 'entry',
    only: 'subspell',
    cost: 0,
    description: 'Where a subspell starts. Its parameters become outputs here. Add parameters in the Subspells panel.',
    inputs: [],
    outputs: (_n, env) => [
      P.then('start', 'Start'),
      ...(env.graph.params ?? []).map((p) => P.out(`p_${p.id}`, p.name, p.type)),
      P.out('caster', 'Caster', 'entity'),
      P.out('depth', 'Depth', 'number', { doc: 'How many subspell calls / event generations deep this flow is.' }),
    ],
  },

  // ── Flow control ──────────────────────────────────────────────────────────
  {
    type: 'branch',
    title: 'Branch',
    category: 'flow',
    icon: '⑂',
    cost: 0.5,
    description: 'If the condition is true, continue through True, otherwise False.',
    inputs: [P.exec(), P.bool('cond', 'Condition', true)],
    outputs: [P.then('true', 'True'), P.then('false', 'False')],
    exec: (c) => c.fire(c.bool('cond') ? 'true' : 'false'),
  },
  {
    type: 'sequence',
    title: 'Sequence',
    category: 'flow',
    icon: '☰',
    cost: 0.3,
    description: 'Runs each output in order, top to bottom.',
    inputs: [P.exec()],
    outputs: [P.then('a', '1st'), P.then('b', '2nd'), P.then('c', '3rd'), P.then('d', '4th')],
    exec: (c) => {
      c.fire('a');
      c.fire('b');
      c.fire('c');
      c.fire('d');
    },
  },
  {
    type: 'repeat',
    title: 'Repeat',
    category: 'flow',
    icon: '↻',
    cost: 1,
    description: 'Runs Body N times synchronously (max 256), then Done. Index counts from 0; T goes 0→1.',
    inputs: [P.exec(), P.num('count', 'Times', 3, { min: 0, max: 256, step: 1 })],
    outputs: [
      P.then('body', 'Body'),
      P.out('index', 'Index', 'number', { scope: ['body'] }),
      P.out('t', 'T (0–1)', 'number', { scope: ['body'] }),
      P.then('done', 'Done'),
    ],
    exec: (c) => {
      const n = Math.max(0, Math.min(256, Math.floor(c.num('count'))));
      for (let i = 0; i < n && c.budgetOk(); i++) {
        c.set('index', i);
        c.set('t', n > 1 ? i / (n - 1) : 0);
        c.fire('body');
      }
      c.fire('done');
    },
  },
  {
    type: 'radial',
    title: 'Radial Burst',
    category: 'flow',
    icon: '✺',
    cost: 1,
    keywords: ['split', 'fan', 'spread', 'pattern', 'shotgun', 'nova'],
    description: 'Runs Body once per direction in a fan around Direction. 360° spread = full nova.',
    inputs: [P.exec(), P.num('count', 'Count', 5, { min: 1, max: 64, step: 1 }), P.vec('dir', 'Direction', 'aim'), P.num('spread', 'Spread °', 360, { min: 0, max: 360 })],
    outputs: [
      P.then('body', 'Each'),
      P.out('direction', 'Direction', 'vector', { scope: ['body'] }),
      P.out('index', 'Index', 'number', { scope: ['body'] }),
      P.then('done', 'Done'),
    ],
    exec: (c) => {
      const n = Math.max(1, Math.min(64, Math.floor(c.num('count'))));
      const d = c.vec('dir');
      const spread = Math.max(0, Math.min(360, c.num('spread'))) * (Math.PI / 180);
      const base = Math.atan2(d.y, d.x);
      const full = spread >= Math.PI * 2 - 1e-3;
      for (let i = 0; i < n && c.budgetOk(); i++) {
        const t = full ? i / n : n === 1 ? 0.5 : i / (n - 1);
        const a = full ? base + t * Math.PI * 2 : base - spread / 2 + t * spread;
        c.set('direction', { x: Math.cos(a), y: Math.sin(a) });
        c.set('index', i);
        c.fire('body');
      }
      c.fire('done');
    },
  },
  {
    type: 'forEach',
    title: 'For Each',
    category: 'flow',
    icon: '⁂',
    cost: 1,
    description: 'Runs Body for every entity in the list (max 256).',
    inputs: [P.exec(), P.ents('list', 'List')],
    outputs: [
      P.then('body', 'Body'),
      P.out('item', 'Item', 'entity', { scope: ['body'] }),
      P.out('index', 'Index', 'number', { scope: ['body'] }),
      P.out('count', 'Count', 'number'),
      P.then('done', 'Done'),
    ],
    exec: (c) => {
      const list = c.ents('list').slice(0, 256);
      c.set('count', list.length);
      for (let i = 0; i < list.length && c.budgetOk(); i++) {
        c.set('item', list[i]);
        c.set('index', i);
        c.fire('body');
      }
      c.fire('done');
    },
  },
  {
    type: 'while',
    title: 'While',
    category: 'flow',
    icon: '⟲',
    cost: 1.5,
    description: 'Runs Body while the condition holds (re-evaluated each pass), up to Max passes.',
    params: [{ id: 'max', label: 'Max passes', kind: 'number', default: 32, min: 1, max: 256, step: 1 }],
    inputs: [P.exec(), P.bool('cond', 'Condition', true)],
    outputs: [P.then('body', 'Body'), P.out('index', 'Index', 'number', { scope: ['body'] }), P.then('done', 'Done')],
    exec: (c) => {
      const max = Math.max(1, Math.min(256, c.param<number>('max')));
      let i = 0;
      while (i < max && c.budgetOk() && c.bool('cond')) {
        c.set('index', i++);
        c.fire('body');
      }
      c.fire('done');
    },
  },
  {
    type: 'delay',
    title: 'Delay',
    category: 'flow',
    icon: '⏱',
    cost: 0.5,
    keywords: ['wait', 'timer', 'later'],
    description: 'Waits, then continues. All values available here stay available after the delay.',
    inputs: [P.exec(), P.num('seconds', 'Seconds', 1, { min: 0, max: 30, step: 0.1 })],
    outputs: [{ ...P.then('then', 'After'), async: true }],
    exec: (c) => {
      c.later('then', Math.max(0, Math.min(30, c.num('seconds'))));
    },
  },
  {
    type: 'every',
    title: 'Every',
    category: 'flow',
    icon: '⧗',
    cost: 1,
    keywords: ['timer', 'interval', 'repeat', 'pulse'],
    description: 'Fires Tick every Interval seconds, Times times, then Done.',
    inputs: [P.exec(), P.num('interval', 'Interval', 0.5, { min: 0.05, max: 10, step: 0.05 }), P.num('times', 'Times', 5, { min: 1, max: 200, step: 1 })],
    outputs: [
      { ...P.then('tick', 'Tick'), async: true },
      P.out('index', 'Index', 'number', { scope: ['tick'] }),
      { ...P.then('done', 'Done'), async: true },
    ],
    exec: (c) => {
      const iv = Math.max(0.05, Math.min(10, c.num('interval')));
      const n = Math.max(1, Math.min(200, Math.floor(c.num('times'))));
      for (let i = 0; i < n; i++) if (!c.later('tick', iv * (i + 1), { index: i })) break;
      c.later('done', iv * n + 0.001);
    },
  },
  {
    type: 'once',
    title: 'Once Per Cast',
    category: 'flow',
    icon: '①',
    cost: 0.3,
    description: 'Lets execution through only the first time it is reached in this cast.',
    inputs: [P.exec()],
    outputs: [P.then('then', 'First time'), P.then('again', 'Later times')],
    exec: (c) => {
      const key = c.nodeId;
      if (c.inst.once.has(key)) c.fire('again');
      else {
        c.inst.once.add(key);
        c.fire('then');
      }
    },
  },
  {
    type: 'chance',
    title: 'Chance',
    category: 'flow',
    icon: '⚂',
    cost: 0.3,
    keywords: ['random', 'probability'],
    description: 'Randomly continues through Yes with the given probability (0–1), otherwise No.',
    inputs: [P.exec(), P.num('p', 'Probability', 0.5, { min: 0, max: 1, step: 0.05 })],
    outputs: [P.then('yes', 'Yes'), P.then('no', 'No')],
    exec: (c) => c.fire(c.random() < c.num('p') ? 'yes' : 'no'),
  },

  // ── Variables ─────────────────────────────────────────────────────────────
  {
    type: 'getVar',
    title: 'Get Variable',
    category: 'variable',
    icon: '𝑥',
    pure: true,
    cost: 0.2,
    description: 'Reads a spell variable. Cast variables reset each cast; persistent ones remember across casts.',
    params: [{ id: 'name', label: 'Variable', kind: 'variable', default: '' }],
    inputs: [],
    outputs: (n, env) => {
      const v = env.doc.variables.find((v) => v.name === n.values.name);
      return [P.out('value', v ? v.name : 'Value', (v?.type ?? 'any') as DataType)];
    },
    eval: (c) => c.out('value', c.getVar(String(c.param('name')))),
  },
  {
    type: 'setVar',
    title: 'Set Variable',
    category: 'variable',
    icon: '≔',
    cost: 0.3,
    description: 'Stores a value in a spell variable.',
    params: [{ id: 'name', label: 'Variable', kind: 'variable', default: '' }],
    inputs: (n, env) => {
      const v = env.doc.variables.find((v) => v.name === n.values.name);
      const t = (v?.type ?? 'any') as DataType;
      const port: PortDef = { id: 'value', label: 'Value', type: t };
      if (t === 'number') port.default = 0;
      if (t === 'bool') port.default = false;
      if (t === 'element') port.default = 'arcane';
      if (t === 'vector') port.default = { x: 0, y: 0 };
      return [P.exec(), port];
    },
    outputs: [P.then()],
    exec: (c) => {
      c.setVar(String(c.param('name')), c.in('value'));
      c.fire('then');
    },
  },
  {
    type: 'addVar',
    title: 'Add to Variable',
    category: 'variable',
    icon: '+=',
    cost: 0.3,
    description: 'Adds to a number variable (use negative amounts to subtract). Outputs the new value.',
    params: [{ id: 'name', label: 'Variable', kind: 'variable', default: '' }],
    inputs: [P.exec(), P.num('amount', 'Amount', 1)],
    outputs: [P.then(), P.out('value', 'New value', 'number')],
    exec: (c) => {
      const name = String(c.param('name'));
      const cur = c.getVar(name);
      const v = (typeof cur === 'number' ? cur : 0) + c.num('amount');
      c.setVar(name, v);
      c.set('value', v);
      c.fire('then');
    },
  },

  // ── Subspells & composition ───────────────────────────────────────────────
  {
    type: 'callSubspell',
    title: 'Call Subspell',
    category: 'subspell',
    icon: '⟳',
    cost: 1,
    keywords: ['function', 'recursion', 'reuse'],
    description: 'Runs a subspell with arguments. Subspells may call themselves: recursion is capped by depth and budget.',
    manaHint: '0.5 per call',
    params: [{ id: 'sub', label: 'Subspell', kind: 'subspell', default: '' }],
    inputs: (n, env) => {
      const g = env.doc.subspells.find((s) => s.id === n.values.sub);
      return [
        P.exec(),
        ...(g?.params ?? []).map((p): PortDef => {
          const port: PortDef = { id: `p_${p.id}`, label: p.name, type: p.type };
          if (p.type === 'number') port.default = 0;
          if (p.type === 'bool') port.default = false;
          if (p.type === 'element') port.default = 'arcane';
          if (p.type === 'vector') port.auto = 'target';
          if (p.type === 'entity' || p.type === 'entities') port.auto = 'none';
          return port;
        }),
      ];
    },
    outputs: [P.then('then', 'After')],
    exec: (c) => {
      const id = String(c.param('sub'));
      if (c.charge(COSTS.subspell, 'subspell')) {
        // the interpreter reads this node's p_<paramId> inputs as the arguments
        c.callSubspell(id, {});
      }
      c.fire('then');
    },
  },
  {
    type: 'castSpell',
    title: 'Cast Spell',
    category: 'subspell',
    icon: '✧',
    cost: 2,
    keywords: ['trigger', 'library', 'combo'],
    description: "Casts another spell from your library from Origin toward Target, paying that spell's costs.",
    manaHint: '2 + the other spell',
    params: [{ id: 'spell', label: 'Spell', kind: 'spell', default: '' }],
    inputs: [P.exec(), P.vec('origin', 'Origin', 'casterPos'), P.vec('target', 'Target', 'target')],
    outputs: [P.then()],
    exec: (c) => {
      if (c.charge(COSTS.castSpell, 'cast spell')) c.castSpell(String(c.param('spell')), c.vec('origin'), c.vec('target'));
      c.fire('then');
    },
  },
  {
    type: 'depth',
    title: 'Recursion Depth',
    category: 'subspell',
    icon: '⇣',
    pure: true,
    cost: 0.1,
    description: 'How deep the current flow is (subspell calls + event generations). Use it to stop recursion.',
    inputs: [],
    outputs: [P.out('depth', 'Depth', 'number')],
    eval: (c) => c.out('depth', c.depth),
  },

  // ── Debug ─────────────────────────────────────────────────────────────────
  {
    type: 'log',
    title: 'Log',
    category: 'debug',
    icon: '✎',
    cost: 0.1,
    description: 'Writes a message (and an optional value) to the execution trace.',
    params: [{ id: 'msg', label: 'Message', kind: 'string', default: 'Hello from the spell' }],
    inputs: [P.exec(), P.any('value', 'Value')],
    outputs: [P.then()],
    exec: (c) => {
      const v = c.in('value');
      c.log(`${c.param('msg')}${v === null || v === undefined ? '' : ': ' + formatValue(v)}`);
      c.fire('then');
    },
  },
];

export function formatValue(v: Value): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.length} entities]`;
  return `(${v.x.toFixed(0)}, ${v.y.toFixed(0)})`;
}
