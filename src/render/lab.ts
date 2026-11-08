/**
 * VFX test bench (open /lab.html). Boots an engine + renderer, loads an arena
 * preset and auto-casts spells so every element, field, beam, summon, status
 * and terrain reaction shows up. Query params:
 *   ?preset=elements   arena preset id
 *   ?spell=ex_fireball only cast this spell (repeatedly)
 *   ?auto=0            no auto casting (click to cast the selected spell)
 *   ?stress=400        keep ~N bouncing projectiles alive for perf testing
 *   ?interval=1.6      seconds between auto casts
 */
import { V, ELEMENTS, type SpellDoc, type Vec } from '../core/types';
import type { CastContext } from '../core/interpreter';
import { SpellBuilder } from '../data/builder';
import { EXAMPLES } from '../data/examples';
import { Engine } from '../engine/engine';
import { spawnProjectile } from '../sim/magic';
import { ArcaneRenderer } from './renderer';
import { sigilDataUrl } from './sigils';

const q = new URLSearchParams(location.search);
const engine = new Engine();
const renderer = new ArcaneRenderer();
renderer.profile = q.get('profile') === '1';
if (q.get('q')) {
  renderer.autoQuality = false;
  renderer.quality = Number(q.get('q'));
}
engine.rt.settings.infiniteMana = true;
engine.rt.settings.ignoreCooldowns = true;
engine.world.settings.godMode = true;

// ── extra coverage spells (fields, zones, beams, summons, statuses) ─────────
function single(id: string, name: string, el: SpellDoc['element'], type: string, values: Record<string, number | string | boolean>): SpellDoc {
  const s = new SpellBuilder(id, name, el);
  const cast = s.node('onCast');
  const n = s.node(type, values);
  s.flow(cast, 'then', n);
  return s.build();
}
function onHitStatus(id: string, name: string, el: SpellDoc['element'], status: string, values: Record<string, number> = {}): SpellDoc {
  const s = new SpellBuilder(id, name, el);
  const cast = s.node('onCast');
  const find = s.node('findInRadius', { radius: 170, filter: 'hostile' });
  const st = s.node(status, values);
  s.flow(cast, 'then', st);
  s.data(find, 'list', st, 'targets');
  return s.build();
}
const extras: SpellDoc[] = [
  single('lab_stasis', 'Stasis', 'arcane', 'field', { kind: 'stasis', radius: 150, strength: 400, duration: 3 }),
  single('lab_vortex', 'Vortex', 'force', 'field', { kind: 'vortex', element: 'force', radius: 160, strength: 520, duration: 3 }),
  single('lab_repel', 'Repulsor', 'force', 'field', { kind: 'repel', element: 'force', radius: 150, strength: 1400, duration: 2 }),
  single('lab_attract', 'Attractor', 'arcane', 'field', { kind: 'attract', element: 'arcane', radius: 170, strength: 900, duration: 2.5 }),
  single('lab_firezone', 'Firestorm', 'fire', 'field', { kind: 'zone', element: 'fire', radius: 120, strength: 0, duration: 3.5, dps: 25 }),
  single('lab_icezone', 'Blizzard', 'ice', 'field', { kind: 'zone', element: 'ice', radius: 140, strength: 0, duration: 3.5, dps: 12 }),
  single('lab_lifezone', 'Sanctuary', 'life', 'field', { kind: 'zone', element: 'life', radius: 130, strength: 0, duration: 3.5, dps: 20 }),
  single('lab_stormzone', 'Storm Zone', 'lightning', 'field', { kind: 'zone', element: 'lightning', radius: 130, strength: 0, duration: 3.5, dps: 20 }),
  single('lab_firebeam', 'Fire Beam', 'fire', 'beam', { element: 'fire', duration: 1.4, dps: 60, width: 18 }),
  single('lab_icebeam', 'Ice Beam', 'ice', 'beam', { element: 'ice', duration: 1.4, dps: 50, width: 12 }),
  single('lab_zapbeam', 'Lightning Beam', 'lightning', 'beam', { element: 'lightning', duration: 1.4, dps: 60, width: 8 }),
  single('lab_turret', 'Fire Turret', 'fire', 'summon', { kind: 'turret', element: 'fire', duration: 6, damage: 8, rate: 0.35 }),
  single('lab_golem', 'Golem', 'force', 'summon', { kind: 'golem', element: 'force', duration: 8, damage: 15, rate: 0.8 }),
  single('lab_wisp', 'Life Wisp', 'life', 'summon', { kind: 'wisp', element: 'life', duration: 8, damage: 6, rate: 0.4 }),
  single('lab_barrier', 'Barrier', 'force', 'barrier', { width: 200, duration: 4 }),
  single('lab_conjure', 'Conjure Ice', 'ice', 'conjure', { kind: 'iceblock', life: 5 }),
  onHitStatus('lab_ignite', 'Ignite Area', 'fire', 'ignite', { duration: 3, dps: 6 }),
  onHitStatus('lab_freeze', 'Freeze Area', 'ice', 'freeze', { duration: 2.5 }),
  onHitStatus('lab_shock', 'Shock Area', 'lightning', 'shock', { damage: 15 }),
  onHitStatus('lab_drench', 'Drench Area', 'ice', 'soak', { duration: 4 }),
  onHitStatus('lab_shield', 'Ward Area', 'force', 'shield', { amount: 80, duration: 4 }),
];
// one projectile per element
for (const el of ELEMENTS) {
  const s = new SpellBuilder(`lab_bolt_${el}`, `${el} bolt`, el);
  const cast = s.node('onCast');
  const fan = s.node('radial', { count: 3, spread: 30 });
  const p = s.node('projectile', { element: el, speed: 420, size: 9, damage: 12, life: 2.5, bounces: 2 });
  s.flow(cast, 'then', fan);
  s.flow(fan, 'body', p);
  s.data(fan, 'direction', p, 'dir');
  extras.push(s.build());
}

const docs = [...EXAMPLES.map((e) => e.doc), ...extras];
engine.setLibrary(docs);
const presetFor = new Map(EXAMPLES.map((e) => [e.id, e.preset]));

let preset = q.get('preset') ?? 'training';
engine.loadPreset(preset);
const canvas = document.getElementById('c') as HTMLCanvasElement;
engine.attach(canvas, renderer);

const only = q.get('spell');
const auto = q.get('auto') !== '0';
const interval = Number(q.get('interval') ?? 1.6);
const stress = Number(q.get('stress') ?? 0);
let order = only ? docs.filter((d) => d.id === only) : docs;
if (!order.length) order = docs;
let idx = 0;
let current = order[0];
engine.setHotbar(0, current.id);

function pickTarget(): Vec {
  const w = engine.world;
  const c = w.caster;
  const foes = w.list.filter((e) => e.alive && (e.kind === 'dummy' || e.kind === 'enemy' || e.kind === 'target'));
  if (foes.length) {
    const f = foes[Math.floor(Math.random() * foes.length)];
    return { x: f.pos.x + (Math.random() - 0.5) * 30, y: f.pos.y + (Math.random() - 0.5) * 30 };
  }
  return c ? V.add(c.pos, { x: 500, y: (Math.random() - 0.5) * 300 }) : { x: 900, y: 450 };
}

function ctxFor(target: Vec): CastContext {
  const c = engine.world.caster!;
  return { casterId: c.id, origin: V.copy(c.pos), target, aim: V.norm(V.sub(target, c.pos)) };
}

let channel: { until: number; target: Vec } | null = null;

function cast(id: string, target?: Vec): void {
  const spell = engine.compiled.get(id);
  if (!spell) return;
  const tgt = target ?? pickTarget();
  engine.cursor = tgt;
  if (spell.hasChannel || spell.hasRelease) {
    engine.rt.press(spell, ctxFor(tgt));
    channel = { until: performance.now() + 1400, target: tgt };
  } else engine.castAt(id, tgt);
}

function next(): void {
  current = order[idx++ % order.length];
  engine.setHotbar(0, current.id);
  const want = q.get('preset') ? preset : (presetFor.get(current.id) ?? preset);
  if (!only && want !== engine.presetId) {
    renderer.reset();
    engine.loadPreset(want);
  }
  cast(current.id);
}

// toolbar
const bar = document.getElementById('bar')!;
for (const p of ['training', 'horde', 'physics', 'elements', 'chain', 'gauntlet', 'empty']) {
  const b = document.createElement('button');
  b.textContent = p;
  b.onclick = () => {
    preset = p;
    renderer.reset();
    engine.loadPreset(p);
  };
  bar.appendChild(b);
}
for (const d of docs) {
  const b = document.createElement('button');
  b.textContent = d.name;
  b.onclick = () => {
    current = d;
    engine.setHotbar(0, d.id);
    cast(d.id);
  };
  bar.appendChild(b);
}

const hud = document.getElementById('hud')!;
let frames = 0;
let fps = 0;
let lastFps = performance.now();
let lastCast = performance.now() - interval * 1000 + 400;
let lastT = performance.now();
const spellEls = ELEMENTS;
function tick(now: number): void {
  requestAnimationFrame(tick);
  frames++;
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (now - lastFps > 500) {
    fps = (frames * 1000) / (now - lastFps);
    frames = 0;
    lastFps = now;
  }
  if (channel) {
    engine.cursor = channel.target;
    engine.rt.updateChannel(dt, ctxFor(channel.target));
    if (now > channel.until) {
      engine.rt.release(ctxFor(channel.target));
      channel = null;
    }
  }
  if (auto && now - lastCast > interval * 1000 && !channel) {
    lastCast = now;
    next();
  }
  if (stress > 0) {
    const w = engine.world;
    let n = 0;
    for (const e of w.list) if (e.kind === 'projectile') n++;
    for (let k = 0; k < 12 && n < stress; k++, n++) {
      const a = Math.random() * Math.PI * 2;
      spawnProjectile(w, {
        pos: { x: 800 + Math.cos(a) * 50, y: 450 + Math.sin(a) * 50 },
        dir: { x: Math.cos(a), y: Math.sin(a) },
        speed: 350,
        size: 6,
        damage: 1,
        element: spellEls[Math.floor(Math.random() * spellEls.length)],
        life: 6,
        bounces: 20,
        ownerId: w.casterId,
        instance: 0,
      });
    }
  }
  const s = renderer.stats;
  hud.textContent =
    `FPS ${fps.toFixed(0)}   render ${s.frameMs.toFixed(1)}ms   q${s.quality}\n` +
    `entities ${engine.world.list.length}   projectiles ${engine.world.list.filter((e) => e.kind === 'projectile').length}\n` +
    `particles ${s.particles}   lights ${s.lights}\n` +
    `spell: ${current.name}   preset: ${engine.presetId}` +
    (renderer.profile ? '\n' + Object.entries(renderer.stages).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ') : '');
}
requestAnimationFrame(tick);

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  engine.cursor = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
});

declare global {
  interface Window {
    __lab: unknown;
  }
}
window.__lab = {
  engine,
  renderer,
  cast,
  next,
  docs: docs.map((d) => d.id),
  preset: (p: string) => {
    renderer.reset();
    engine.loadPreset(p);
  },
};

// ?sigils=1 → gallery of library-card sigils (one per spell)
if (q.get('sigils') === '1') {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:60px 20px 20px;display:flex;flex-wrap:wrap;gap:14px;align-content:flex-start;background:rgba(8,6,16,0.92);padding:20px;border-radius:12px;overflow:auto';
  for (const d of docs) {
    const c = engine.compiled.get(d.id);
    const card = document.createElement('div');
    card.style.cssText = 'width:110px;text-align:center;font-size:11px;color:#a79fcc';
    const img = document.createElement('img');
    img.src = sigilDataUrl(c?.signature ?? 1, d.element, 96);
    img.width = 96;
    img.height = 96;
    card.appendChild(img);
    card.appendChild(document.createTextNode(d.name));
    wrap.appendChild(card);
  }
  document.body.appendChild(wrap);
}
