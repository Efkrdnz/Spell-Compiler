import { DEG, ELEMENTS, V, clamp } from '../types';
import { P, type NodeDef } from './defs';

const bin = (type: string, title: string, icon: string, f: (a: number, b: number) => number, a = 0, b = 1, keywords: string[] = []): NodeDef => ({
  type,
  title,
  category: 'math',
  icon,
  pure: true,
  cost: 0.1,
  keywords,
  description: `${title} two numbers.`,
  inputs: [P.num('a', 'A', a), P.num('b', 'B', b)],
  outputs: [P.out('r', 'Result', 'number')],
  eval: (c) => {
    const r = f(c.num('a'), c.num('b'));
    c.out('r', Number.isFinite(r) ? r : 0);
  },
});

export const MATH_NODES: NodeDef[] = [
  {
    type: 'number',
    title: 'Number',
    category: 'math',
    icon: '#',
    pure: true,
    cost: 0,
    keywords: ['constant', 'value'],
    description: 'A constant number.',
    params: [{ id: 'value', label: 'Value', kind: 'number', default: 1, step: 0.1 }],
    inputs: [],
    outputs: [P.out('value', 'Value', 'number')],
    eval: (c) => c.out('value', c.param<number>('value')),
  },
  bin('add', 'Add', '+', (a, b) => a + b, 0, 1, ['plus', 'sum']),
  bin('subtract', 'Subtract', '−', (a, b) => a - b, 0, 1, ['minus']),
  bin('multiply', 'Multiply', '×', (a, b) => a * b, 1, 2, ['times', 'scale']),
  bin('divide', 'Divide', '÷', (a, b) => (b === 0 ? 0 : a / b), 1, 2),
  {
    type: 'mathOp',
    title: 'Math',
    category: 'math',
    icon: 'ƒ',
    pure: true,
    cost: 0.1,
    keywords: ['min', 'max', 'pow', 'mod', 'power'],
    description: 'Binary math: min, max, power, modulo, hypot.',
    params: [
      {
        id: 'op',
        label: 'Op',
        kind: 'enum',
        default: 'max',
        options: ['min', 'max', 'pow', 'mod', 'hypot'].map((v) => ({ value: v, label: v })),
      },
    ],
    inputs: [P.num('a', 'A', 0), P.num('b', 'B', 1)],
    outputs: [P.out('r', 'Result', 'number')],
    eval: (c) => {
      const a = c.num('a');
      const b = c.num('b');
      let r = 0;
      switch (c.param('op')) {
        case 'min':
          r = Math.min(a, b);
          break;
        case 'max':
          r = Math.max(a, b);
          break;
        case 'pow':
          r = Math.pow(a, b);
          break;
        case 'mod':
          r = b === 0 ? 0 : ((a % b) + b) % b;
          break;
        case 'hypot':
          r = Math.hypot(a, b);
          break;
      }
      c.out('r', Number.isFinite(r) ? r : 0);
    },
  },
  {
    type: 'mathFn',
    title: 'Function',
    category: 'math',
    icon: '√',
    pure: true,
    cost: 0.1,
    keywords: ['abs', 'sqrt', 'sin', 'cos', 'floor', 'round', 'negate'],
    description: 'Unary math: abs, floor, ceil, round, sqrt, sin, cos (degrees), negate, sign.',
    params: [
      {
        id: 'fn',
        label: 'Fn',
        kind: 'enum',
        default: 'abs',
        options: ['abs', 'floor', 'ceil', 'round', 'sqrt', 'sin', 'cos', 'negate', 'sign'].map((v) => ({ value: v, label: v })),
      },
    ],
    inputs: [P.num('x', 'X', 0)],
    outputs: [P.out('r', 'Result', 'number')],
    eval: (c) => {
      const x = c.num('x');
      const fns: Record<string, (x: number) => number> = {
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        sqrt: (v) => Math.sqrt(Math.max(0, v)),
        sin: (v) => Math.sin(v * DEG),
        cos: (v) => Math.cos(v * DEG),
        negate: (v) => -v,
        sign: Math.sign,
      };
      const r = (fns[String(c.param('fn'))] ?? Math.abs)(x);
      c.out('r', Number.isFinite(r) ? r : 0);
    },
  },
  {
    type: 'clamp',
    title: 'Clamp',
    category: 'math',
    icon: '⊏',
    pure: true,
    cost: 0.1,
    description: 'Keeps a number between Min and Max.',
    inputs: [P.num('x', 'X', 0), P.num('lo', 'Min', 0), P.num('hi', 'Max', 1)],
    outputs: [P.out('r', 'Result', 'number')],
    eval: (c) => c.out('r', clamp(c.num('x'), c.num('lo'), c.num('hi'))),
  },
  {
    type: 'lerp',
    title: 'Lerp',
    category: 'math',
    icon: '⟿',
    pure: true,
    cost: 0.1,
    keywords: ['mix', 'interpolate'],
    description: 'Blends from A to B by T (0–1).',
    inputs: [P.num('a', 'A', 0), P.num('b', 'B', 1), P.num('t', 'T', 0.5)],
    outputs: [P.out('r', 'Result', 'number')],
    eval: (c) => c.out('r', c.num('a') + (c.num('b') - c.num('a')) * c.num('t')),
  },
  {
    type: 'random',
    title: 'Random',
    category: 'math',
    icon: '⚄',
    pure: true,
    cost: 0.1,
    description: 'A random number between Min and Max (fresh each evaluation).',
    inputs: [P.num('lo', 'Min', 0), P.num('hi', 'Max', 1)],
    outputs: [P.out('r', 'Value', 'number')],
    eval: (c) => c.out('r', c.num('lo') + c.random() * (c.num('hi') - c.num('lo'))),
  },
  {
    type: 'time',
    title: 'Time',
    category: 'math',
    icon: '◷',
    pure: true,
    cost: 0.1,
    description: 'Seconds since this cast began, and the arena clock.',
    inputs: [],
    outputs: [P.out('since', 'Since cast', 'number'), P.out('world', 'Arena time', 'number')],
    eval: (c) => {
      c.out('since', c.time - c.inst.start);
      c.out('world', c.time);
    },
  },

  // ── Logic ─────────────────────────────────────────────────────────────────
  {
    type: 'compare',
    title: 'Compare',
    category: 'logic',
    icon: '≶',
    pure: true,
    cost: 0.1,
    keywords: ['greater', 'less', 'equal'],
    description: 'Compares two numbers.',
    params: [{ id: 'op', label: 'Op', kind: 'enum', default: '>', options: ['>', '<', '>=', '<=', '==', '!='].map((v) => ({ value: v, label: v })) }],
    inputs: [P.num('a', 'A', 0), P.num('b', 'B', 0)],
    outputs: [P.out('r', 'Result', 'bool')],
    eval: (c) => {
      const a = c.num('a');
      const b = c.num('b');
      const op = c.param('op');
      const r = op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : op === '==' ? Math.abs(a - b) < 1e-9 : Math.abs(a - b) >= 1e-9;
      c.out('r', r);
    },
  },
  {
    type: 'and',
    title: 'And',
    category: 'logic',
    icon: '∧',
    pure: true,
    cost: 0.1,
    description: 'True when both are true.',
    inputs: [P.bool('a', 'A', true), P.bool('b', 'B', true)],
    outputs: [P.out('r', 'Result', 'bool')],
    eval: (c) => c.out('r', c.bool('a') && c.bool('b')),
  },
  {
    type: 'or',
    title: 'Or',
    category: 'logic',
    icon: '∨',
    pure: true,
    cost: 0.1,
    description: 'True when either is true.',
    inputs: [P.bool('a', 'A', false), P.bool('b', 'B', false)],
    outputs: [P.out('r', 'Result', 'bool')],
    eval: (c) => c.out('r', c.bool('a') || c.bool('b')),
  },
  {
    type: 'not',
    title: 'Not',
    category: 'logic',
    icon: '¬',
    pure: true,
    cost: 0.1,
    description: 'Inverts a bool.',
    inputs: [P.bool('a', 'A', false)],
    outputs: [P.out('r', 'Result', 'bool')],
    eval: (c) => c.out('r', !c.bool('a')),
  },
  {
    type: 'select',
    title: 'Select',
    category: 'logic',
    icon: '⇄',
    pure: true,
    cost: 0.1,
    keywords: ['if', 'ternary', 'choose'],
    description: 'Picks A when the condition is true, otherwise B. Works with any type.',
    inputs: [P.bool('cond', 'Condition', true), P.any('a', 'If true'), P.any('b', 'If false')],
    outputs: [P.any('r', 'Result')],
    eval: (c) => c.out('r', c.bool('cond') ? c.in('a') : c.in('b')),
  },
  {
    type: 'element',
    title: 'Element',
    category: 'logic',
    icon: '✦',
    pure: true,
    cost: 0,
    description: 'A constant element.',
    params: [{ id: 'value', label: 'Element', kind: 'element', default: 'fire' }],
    inputs: [],
    outputs: [P.out('value', 'Element', 'element')],
    eval: (c) => c.out('value', String(c.param('value'))),
  },
  {
    type: 'randomElement',
    title: 'Random Element',
    category: 'logic',
    icon: '✵',
    pure: true,
    cost: 0.1,
    description: 'A random element (excluding life).',
    inputs: [],
    outputs: [P.out('value', 'Element', 'element')],
    eval: (c) => {
      const pool = ELEMENTS.filter((e) => e !== 'life');
      c.out('value', pool[Math.floor(c.random() * pool.length)]);
    },
  },

  // ── Vectors ───────────────────────────────────────────────────────────────
  {
    type: 'vector',
    title: 'Make Vector',
    category: 'vector',
    icon: '↗',
    pure: true,
    cost: 0.1,
    description: 'Builds a vector from X and Y.',
    inputs: [P.num('x', 'X', 0), P.num('y', 'Y', 0)],
    outputs: [P.out('v', 'Vector', 'vector')],
    eval: (c) => c.out('v', { x: c.num('x'), y: c.num('y') }),
  },
  {
    type: 'splitVector',
    title: 'Split Vector',
    category: 'vector',
    icon: '⤡',
    pure: true,
    cost: 0.1,
    description: 'Gets the X, Y, length and angle (degrees) of a vector.',
    inputs: [P.vec('v', 'Vector')],
    outputs: [P.out('x', 'X', 'number'), P.out('y', 'Y', 'number'), P.out('len', 'Length', 'number'), P.out('angle', 'Angle °', 'number')],
    eval: (c) => {
      const v = c.vec('v');
      c.out('x', v.x);
      c.out('y', v.y);
      c.out('len', V.len(v));
      c.out('angle', Math.atan2(v.y, v.x) / DEG);
    },
  },
  {
    type: 'vecAdd',
    title: 'Add Vectors',
    category: 'vector',
    icon: '⊕',
    pure: true,
    cost: 0.1,
    description: 'Adds two vectors (A + B), e.g. a point plus an offset.',
    inputs: [P.vec('a', 'A'), P.vec('b', 'B')],
    outputs: [P.out('r', 'Result', 'vector')],
    eval: (c) => c.out('r', V.add(c.vec('a'), c.vec('b'))),
  },
  {
    type: 'vecSub',
    title: 'Subtract Vectors',
    category: 'vector',
    icon: '⊖',
    pure: true,
    cost: 0.1,
    description: 'Subtracts vectors (A − B): the offset that leads from B to A.',
    inputs: [P.vec('a', 'A'), P.vec('b', 'B')],
    outputs: [P.out('r', 'Result', 'vector')],
    eval: (c) => c.out('r', V.sub(c.vec('a'), c.vec('b'))),
  },
  {
    type: 'vecScale',
    title: 'Scale Vector',
    category: 'vector',
    icon: '⊗',
    pure: true,
    cost: 0.1,
    description: 'Multiplies a vector by a number.',
    inputs: [P.vec('v', 'Vector', 'aim'), P.num('s', 'Scale', 100)],
    outputs: [P.out('r', 'Result', 'vector')],
    eval: (c) => c.out('r', V.scale(c.vec('v'), c.num('s'))),
  },
  {
    type: 'normalize',
    title: 'Normalize',
    category: 'vector',
    icon: '⇢',
    pure: true,
    cost: 0.1,
    description: 'Same direction, length 1.',
    inputs: [P.vec('v', 'Vector', 'aim')],
    outputs: [P.out('r', 'Direction', 'vector')],
    eval: (c) => c.out('r', V.norm(c.vec('v'))),
  },
  {
    type: 'direction',
    title: 'Direction To',
    category: 'vector',
    icon: '➶',
    pure: true,
    cost: 0.1,
    description: 'Unit direction from one point to another, plus the distance.',
    inputs: [P.vec('from', 'From', 'casterPos'), P.vec('to', 'To', 'target')],
    outputs: [P.out('dir', 'Direction', 'vector'), P.out('dist', 'Distance', 'number')],
    eval: (c) => {
      const a = c.vec('from');
      const b = c.vec('to');
      c.out('dir', V.norm(V.sub(b, a)));
      c.out('dist', V.dist(a, b));
    },
  },
  {
    type: 'rotate',
    title: 'Rotate',
    category: 'vector',
    icon: '⟳',
    pure: true,
    cost: 0.1,
    description: 'Rotates a vector by degrees (clockwise on screen).',
    inputs: [P.vec('v', 'Vector', 'aim'), P.num('deg', 'Degrees', 90)],
    outputs: [P.out('r', 'Result', 'vector')],
    eval: (c) => c.out('r', V.rot(c.vec('v'), c.num('deg') * DEG)),
  },
  {
    type: 'fromAngle',
    title: 'From Angle',
    category: 'vector',
    icon: '∠',
    pure: true,
    cost: 0.1,
    description: 'A direction vector from an angle in degrees (0 = right, 90 = down).',
    inputs: [P.num('deg', 'Degrees', 0), P.num('len', 'Length', 1)],
    outputs: [P.out('r', 'Vector', 'vector')],
    eval: (c) => c.out('r', V.fromAngle(c.num('deg') * DEG, c.num('len'))),
  },
  {
    type: 'offset',
    title: 'Offset Point',
    category: 'vector',
    icon: '⇥',
    pure: true,
    cost: 0.1,
    keywords: ['move', 'ahead'],
    description: 'Moves a point Distance units along Direction.',
    inputs: [P.vec('p', 'Point', 'casterPos'), P.vec('dir', 'Direction', 'aim'), P.num('d', 'Distance', 80)],
    outputs: [P.out('r', 'Point', 'vector')],
    eval: (c) => c.out('r', V.add(c.vec('p'), V.scale(V.norm(c.vec('dir')), c.num('d')))),
  },
  {
    type: 'randomPoint',
    title: 'Random Point',
    category: 'vector',
    icon: '⁘',
    pure: true,
    cost: 0.1,
    description: 'A random point within Radius of Center, and a random unit direction.',
    inputs: [P.vec('c', 'Center', 'target'), P.num('r', 'Radius', 100)],
    outputs: [P.out('p', 'Point', 'vector'), P.out('dir', 'Random dir', 'vector')],
    eval: (c) => {
      const a = c.random() * Math.PI * 2;
      const r = Math.sqrt(c.random()) * c.num('r');
      c.out('p', V.add(c.vec('c'), V.fromAngle(a, r)));
      c.out('dir', V.fromAngle(c.random() * Math.PI * 2));
    },
  },
  {
    type: 'mixPoints',
    title: 'Mix Points',
    category: 'vector',
    icon: '⋯',
    pure: true,
    cost: 0.1,
    description: 'Blends between two points by T (0 = A, 1 = B).',
    inputs: [P.vec('a', 'A', 'casterPos'), P.vec('b', 'B', 'target'), P.num('t', 'T', 0.5)],
    outputs: [P.out('r', 'Point', 'vector')],
    eval: (c) => c.out('r', V.lerp(c.vec('a'), c.vec('b'), c.num('t'))),
  },
  {
    type: 'reflect',
    title: 'Reflect',
    category: 'vector',
    icon: '⦣',
    pure: true,
    cost: 0.1,
    description: 'Reflects a direction off a surface normal (bounces).',
    inputs: [P.vec('v', 'Direction', 'aim'), P.vec('n', 'Normal', undefined, { x: 0, y: -1 })],
    outputs: [P.out('r', 'Reflected', 'vector')],
    eval: (c) => {
      const v = c.vec('v');
      const n = V.norm(c.vec('n'));
      c.out('r', V.sub(v, V.scale(n, 2 * V.dot(v, n))));
    },
  },
];
