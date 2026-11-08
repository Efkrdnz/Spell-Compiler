import { ELEMENT_INFO } from '../core/types';
import type { Entity } from '../sim/entity';
import type { DrawEnv } from './env';
import { PT } from './particles';
import { coreSprite, flameSprite, glowSprite, hexBubble, rgba, shadowSprite } from './sprites';
import { drawGlyph } from './sigils';

const TAU = Math.PI * 2;

function hashId(id: number, k: number): number {
  let h = (id * 374761393 + k * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function drawShadow(env: DrawEnv, e: Entity): void {
  const g = env.g;
  if (e.kind === 'wisp' as never) return;
  const w = e.shape === 'box' ? e.hw * 1.25 : e.r * 1.25;
  const h = e.shape === 'box' ? e.hh * 1.25 : e.r * 1.25;
  g.drawImage(shadowSprite(), e.pos.x - w + 3, e.pos.y - h + 5, w * 2, h * 2);
}

function facingOf(env: DrawEnv, e: Entity): number {
  const sp = Math.hypot(e.vel.x, e.vel.y);
  if (sp > 20) return Math.atan2(e.vel.y, e.vel.x);
  const c = env.caster;
  if (c && c !== e) return Math.atan2(c.pos.y - e.pos.y, c.pos.x - e.pos.x);
  return e.angle;
}

// ── bodies ─────────────────────────────────────────────────────────────────

function caster(env: DrawEnv, e: Entity): void {
  const { g, t } = env;
  const el = ELEMENT_INFO[env.activeElement];
  const face = env.cursor ? Math.atan2(env.cursor.y - e.pos.y, env.cursor.x - e.pos.x) : e.angle;
  const r = e.r;
  g.save();
  g.translate(e.pos.x, e.pos.y);
  // mana aura
  const mana = e.mana ? e.mana.cur / e.mana.max : 1;
  env.e.save();
  env.e.translate(e.pos.x, e.pos.y);
  env.e.rotate(t * 0.8);
  env.e.strokeStyle = rgba(el.color, 0.25 + 0.35 * mana);
  env.e.lineWidth = 1.5;
  env.e.setLineDash([4, 6]);
  env.e.beginPath();
  env.e.arc(0, 0, r + 7, 0, TAU * mana);
  env.e.stroke();
  env.e.setLineDash([]);
  env.e.restore();
  // robe
  g.fillStyle = '#24123f';
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#ffd27a';
  g.lineWidth = 1.6;
  g.stroke();
  g.rotate(face);
  // staff
  g.strokeStyle = '#6b4a2a';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-r * 0.2, r * 0.55);
  g.lineTo(r * 1.5, r * 0.55);
  g.stroke();
  // hat (top-down: brim + spiral cone)
  g.fillStyle = '#3e2378';
  g.beginPath();
  g.arc(-r * 0.08, 0, r * 0.78, 0, TAU);
  g.fill();
  g.strokeStyle = '#7d55d6';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let k = 0; k < 28; k++) {
    const a = k * 0.55;
    const rr = r * 0.7 * (1 - k / 28);
    const x = -r * 0.08 + Math.cos(a) * rr + (k / 28) * r * 0.35;
    const y = Math.sin(a) * rr;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#ffd27a';
  g.beginPath();
  g.arc(r * 0.28, 0, 1.8, 0, TAU);
  g.fill();
  g.restore();
  // staff orb (emissive)
  const ox = e.pos.x + Math.cos(face) * r * 1.5 - Math.sin(face) * r * 0.55;
  const oy = e.pos.y + Math.sin(face) * r * 1.5 + Math.cos(face) * r * 0.55;
  const pulse = 1 + 0.15 * Math.sin(t * 6);
  env.e.drawImage(coreSprite(el.color), ox - 9 * pulse, oy - 9 * pulse, 18 * pulse, 18 * pulse);
  env.light.add(ox, oy, 90, el.color, 0.7);
  env.light.add(e.pos.x, e.pos.y, 190, '#d8d0ff', 0.55);
}

function enemy(env: DrawEnv, e: Entity): void {
  const { g, t } = env;
  const el = ELEMENT_INFO[e.element];
  const face = facingOf(env, e);
  const r = e.r;
  const beh = e.ai?.behavior;
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(face);
  // spiky carapace
  const spikes = beh === 'strafe' ? 6 : 10;
  g.beginPath();
  for (let k = 0; k <= spikes * 2; k++) {
    const a = (k / (spikes * 2)) * TAU + Math.sin(t * 3 + e.id) * 0.05;
    const rr = k % 2 ? r * 0.78 : r * (beh === 'strafe' ? 1.25 : 1.08);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#2a1734';
  g.fill();
  g.strokeStyle = rgba(el.color, 0.95);
  g.lineWidth = 1.6;
  g.stroke();
  g.fillStyle = rgba(el.color, 0.35);
  g.beginPath();
  g.arc(0, 0, r * 0.62, 0, TAU);
  g.fill();
  if (beh === 'chase') {
    // mandibles
    g.fillStyle = '#3a2440';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(r * 0.7, s * r * 0.35);
      g.lineTo(r * 1.45, s * r * 0.15);
      g.lineTo(r * 0.8, s * r * 0.65);
      g.fill();
    }
  }
  g.restore();
  // glowing eyes (emissive)
  const eyeCol = e.element === 'fire' ? '#ffb347' : '#ff4d6d';
  for (const s of [-1, 1]) {
    const ex = e.pos.x + Math.cos(face) * r * 0.45 - Math.sin(face) * s * r * 0.28;
    const ey = e.pos.y + Math.sin(face) * r * 0.45 + Math.cos(face) * s * r * 0.28;
    env.e.drawImage(coreSprite(eyeCol), ex - 5, ey - 5, 10, 10);
  }
  env.e.globalAlpha = 0.35;
  env.e.drawImage(glowSprite(el.color), e.pos.x - r * 2, e.pos.y - r * 2, r * 4, r * 4);
  env.e.globalAlpha = 1;
  if (beh === 'ranged') {
    const a = t * 3 + e.id;
    const ox = e.pos.x + Math.cos(a) * (r + 8);
    const oy = e.pos.y + Math.sin(a) * (r + 8);
    env.e.drawImage(coreSprite(el.color), ox - 6, oy - 6, 12, 12);
  }
  env.light.add(e.pos.x, e.pos.y, 60, el.color, 0.35);
}

function dummy(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const r = e.r;
  const wob = Math.max(-0.5, Math.min(0.5, e.vel.x * 0.002));
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(wob);
  // cross-beam arms
  g.fillStyle = '#5a3d22';
  g.fillRect(-r * 1.5, -3, r * 3, 6);
  g.fillStyle = '#7a5530';
  g.fillRect(-r * 1.5, -3, r * 3, 2);
  // straw body
  g.fillStyle = '#b8954f';
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#8a6a33';
  g.lineWidth = 1;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + 0.3;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
    g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    g.stroke();
  }
  // painted target
  g.fillStyle = '#c0392b';
  g.beginPath();
  g.arc(0, 0, r * 0.55, 0, TAU);
  g.fill();
  g.fillStyle = '#efe3c8';
  g.beginPath();
  g.arc(0, 0, r * 0.35, 0, TAU);
  g.fill();
  g.fillStyle = '#c0392b';
  g.beginPath();
  g.arc(0, 0, r * 0.16, 0, TAU);
  g.fill();
  g.strokeStyle = '#4a3418';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.stroke();
  g.restore();
}

function target(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const r = e.r;
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(env.t * 1.5 + e.id);
  const cols = ['#f5f0e6', '#e0313b', '#f5f0e6', '#e0313b'];
  for (let k = 0; k < 4; k++) {
    g.fillStyle = cols[k];
    g.beginPath();
    g.arc(0, 0, r * (1 - k * 0.24), 0, TAU);
    g.fill();
  }
  g.fillStyle = '#ffd27a';
  g.beginPath();
  g.arc(0, 0, r * 0.14, 0, TAU);
  g.fill();
  g.strokeStyle = '#2a1a1a';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-r, 0);
  g.lineTo(r, 0);
  g.stroke();
  g.restore();
  env.e.globalAlpha = 0.5;
  env.e.strokeStyle = '#ff6b6b';
  env.e.lineWidth = 1.2;
  env.e.beginPath();
  env.e.arc(e.pos.x, e.pos.y, r + 3 + Math.sin(env.t * 4) * 1.5, 0, TAU);
  env.e.stroke();
  env.e.globalAlpha = 1;
}

function crate(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const { hw, hh } = e;
  const x = e.pos.x - hw;
  const y = e.pos.y - hh;
  g.fillStyle = '#3a2412';
  g.fillRect(x - 1, y - 1, hw * 2 + 2, hh * 2 + 2);
  g.fillStyle = '#86592f';
  g.fillRect(x + 1.5, y + 1.5, hw * 2 - 3, hh * 2 - 3);
  // planks
  g.strokeStyle = 'rgba(58,36,18,0.7)';
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k < 4; k++) {
    g.moveTo(x + 2, y + (hh * 2 * k) / 4);
    g.lineTo(x + hw * 2 - 2, y + (hh * 2 * k) / 4);
  }
  g.stroke();
  g.strokeStyle = '#5c3a1c';
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(x + 3, y + 3);
  g.lineTo(x + hw * 2 - 3, y + hh * 2 - 3);
  g.stroke();
  g.strokeStyle = '#a3713d';
  g.lineWidth = 1;
  g.strokeRect(x + 2.5, y + 2.5, hw * 2 - 5, hh * 2 - 5);
  g.fillStyle = '#c9c0b0';
  for (const [px, py] of [
    [x + 4, y + 4],
    [x + hw * 2 - 4, y + 4],
    [x + 4, y + hh * 2 - 4],
    [x + hw * 2 - 4, y + hh * 2 - 4],
  ])
    g.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
  damageCracks(g, e);
}

function damageCracks(g: CanvasRenderingContext2D, e: Entity): void {
  const f = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  if (f > 0.7) return;
  const n = f < 0.35 ? 5 : 3;
  g.strokeStyle = 'rgba(10,6,4,0.75)';
  g.lineWidth = 1.1;
  g.beginPath();
  for (let k = 0; k < n; k++) {
    let cx = e.pos.x + (hashId(e.id, k) - 0.5) * e.hw;
    let cy = e.pos.y + (hashId(e.id, k + 9) - 0.5) * e.hh;
    g.moveTo(cx, cy);
    for (let s = 0; s < 3; s++) {
      cx += (hashId(e.id, k * 7 + s) - 0.5) * e.hw * 0.7;
      cy += (hashId(e.id, k * 5 + s + 3) - 0.5) * e.hh * 0.7;
      g.lineTo(cx, cy);
    }
  }
  g.stroke();
}

function barrel(env: DrawEnv, e: Entity): void {
  const { g, t } = env;
  const r = e.r;
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(e.angle);
  g.fillStyle = '#5c0f12';
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.fillStyle = '#a3201f';
  g.beginPath();
  g.arc(0, 0, r * 0.84, 0, TAU);
  g.fill();
  g.strokeStyle = '#3b3b46';
  g.lineWidth = 2.2;
  g.beginPath();
  g.arc(0, 0, r * 0.92, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, r * 0.55, 0, TAU);
  g.stroke();
  // hazard triangle
  g.fillStyle = '#ffcc33';
  g.beginPath();
  g.moveTo(0, -r * 0.42);
  g.lineTo(r * 0.38, r * 0.28);
  g.lineTo(-r * 0.38, r * 0.28);
  g.closePath();
  g.fill();
  g.fillStyle = '#1a0a0a';
  g.fillRect(-1, -r * 0.2, 2, r * 0.26);
  g.fillRect(-1, r * 0.12, 2, 2);
  g.restore();
  const hot = e.status.burning > 0 || e.fuse !== undefined;
  if (hot) {
    const p = 0.5 + 0.5 * Math.sin(t * 20);
    env.e.globalAlpha = 0.3 + p * 0.3;
    env.e.drawImage(glowSprite('#ff3d10'), e.pos.x - r * 1.8, e.pos.y - r * 1.8, r * 3.6, r * 3.6);
    env.e.globalAlpha = 1;
    env.light.add(e.pos.x, e.pos.y, 90, '#ff5a1a', 0.5 + p * 0.5);
  }
}

function metal(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const { hw, hh } = e;
  const x = e.pos.x - hw;
  const y = e.pos.y - hh;
  const gr = g.createLinearGradient(x, y, x + hw * 2, y + hh * 2);
  gr.addColorStop(0, '#9aa4b8');
  gr.addColorStop(0.5, '#5d6576');
  gr.addColorStop(1, '#3a404c');
  g.fillStyle = '#20242c';
  g.fillRect(x - 1, y - 1, hw * 2 + 2, hh * 2 + 2);
  g.fillStyle = gr;
  g.fillRect(x + 1, y + 1, hw * 2 - 2, hh * 2 - 2);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 3; k < hh * 2; k += 3) {
    g.moveTo(x + 2, y + k);
    g.lineTo(x + hw * 2 - 2, y + k);
  }
  g.stroke();
  g.fillStyle = '#c8d0e0';
  for (const [px, py] of [
    [x + 4, y + 4],
    [x + hw * 2 - 4, y + 4],
    [x + 4, y + hh * 2 - 4],
    [x + hw * 2 - 4, y + hh * 2 - 4],
  ]) {
    g.beginPath();
    g.arc(px, py, 1.4, 0, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.moveTo(x + 1.5, y + hh * 2 - 2);
  g.lineTo(x + 1.5, y + 1.5);
  g.lineTo(x + hw * 2 - 2, y + 1.5);
  g.stroke();
}

function wall(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const { hw, hh } = e;
  const x = e.pos.x - hw;
  const y = e.pos.y - hh;
  g.fillStyle = '#1c1926';
  g.fillRect(x - 1.5, y - 1.5, hw * 2 + 3, hh * 2 + 3);
  g.fillStyle = '#3d3850';
  g.fillRect(x, y, hw * 2, hh * 2);
  // bricks
  const bh = 10;
  const bw = 20;
  g.fillStyle = '#4a445f';
  let row = 0;
  for (let by = y; by < y + hh * 2 - 1; by += bh, row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let bx = x - off; bx < x + hw * 2; bx += bw) {
      const x0 = Math.max(x, bx + 1);
      const x1 = Math.min(x + hw * 2, bx + bw - 1);
      if (x1 - x0 < 1) continue;
      const shade = hashId(e.id, row * 31 + Math.round(bx)) * 0.12;
      g.fillStyle = `rgba(${74 + shade * 200},${68 + shade * 180},${95 + shade * 200},1)`;
      g.fillRect(x0, by + 1, x1 - x0, Math.min(bh - 2, y + hh * 2 - by - 1));
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(x, y, hw * 2, 2);
  if (!e.destructible) {
    env.e.globalAlpha = 0.18;
    env.e.strokeStyle = '#b78cff';
    env.e.lineWidth = 1;
    env.e.strokeRect(x + 2, y + 2, hw * 2 - 4, hh * 2 - 4);
    env.e.globalAlpha = 1;
  }
  damageCracks(g, e);
}

function pillar(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const r = e.r;
  const gr = g.createRadialGradient(e.pos.x - r * 0.3, e.pos.y - r * 0.3, r * 0.1, e.pos.x, e.pos.y, r);
  gr.addColorStop(0, '#5a5470');
  gr.addColorStop(1, '#25212f');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(e.pos.x, e.pos.y, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#15121c';
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(e.pos.x, e.pos.y, r * 0.7, 0, TAU);
  g.stroke();
  const p = 0.4 + 0.25 * Math.sin(env.t * 1.5 + e.id);
  env.e.globalAlpha = p;
  drawGlyph(env.e, e.id * 13, e.pos.x, e.pos.y, r * 0.8, '#9f7bff');
  env.e.globalAlpha = 1;
  env.light.add(e.pos.x, e.pos.y, 50, '#8b6cff', 0.25);
}

function boulder(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const r = e.r;
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(e.angle);
  g.beginPath();
  const n = 11;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * TAU;
    const rr = r * (0.85 + hashId(e.id, k % n) * 0.2);
    if (k) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  gr.addColorStop(0, '#8a7d70');
  gr.addColorStop(1, '#3d3530');
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = '#211c18';
  g.lineWidth = 1.5;
  g.stroke();
  g.strokeStyle = 'rgba(25,20,16,0.6)';
  g.beginPath();
  g.moveTo(-r * 0.4, -r * 0.1);
  g.lineTo(r * 0.1, r * 0.15);
  g.lineTo(r * 0.3, r * 0.5);
  g.moveTo(r * 0.1, r * 0.15);
  g.lineTo(r * 0.5, -r * 0.2);
  g.stroke();
  g.restore();
}

function summon(env: DrawEnv, e: Entity): void {
  const { g, t } = env;
  const el = ELEMENT_INFO[e.element];
  const s = e.summon!;
  const r = e.r;
  const fade = Math.min(1, s.life / 0.6);
  if (s.kind === 'wisp') {
    const pulse = 1 + 0.2 * Math.sin(t * 8 + e.id);
    env.e.globalAlpha = fade;
    env.e.drawImage(glowSprite(el.color), e.pos.x - r * 3, e.pos.y - r * 3, r * 6, r * 6);
    env.e.drawImage(coreSprite(el.color), e.pos.x - r * pulse, e.pos.y - r * pulse, r * 2 * pulse, r * 2 * pulse);
    env.e.globalAlpha = 1;
    if (Math.random() < env.dt * 30 * env.budget) env.P.spawn(PT.Mote, e.pos.x, e.pos.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0.6, 2.5, env.P.c(el.glow), 0, 2);
    env.light.add(e.pos.x, e.pos.y, 80, el.color, 0.6 * fade);
    return;
  }
  if (s.kind === 'turret') {
    const R = r * 1.25;
    g.save();
    g.translate(e.pos.x, e.pos.y);
    g.globalAlpha = fade;
    // armoured hex base
    const base = g.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
    base.addColorStop(0, '#5a5470');
    base.addColorStop(1, '#221d33');
    g.fillStyle = base;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6;
      if (k) g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      else g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#141020';
    g.lineWidth = 2;
    g.stroke();
    // rotating gun head
    g.rotate(e.angle);
    g.fillStyle = '#6b6488';
    g.fillRect(0, -3.5, R * 1.35, 7);
    g.fillStyle = '#3a3450';
    g.fillRect(R * 0.6, -3.5, 3, 7);
    g.fillStyle = '#48405f';
    g.beginPath();
    g.arc(0, 0, R * 0.55, 0, TAU);
    g.fill();
    g.restore();
    const E = env.e;
    E.globalAlpha = fade;
    // element rune ring + muzzle + core
    E.save();
    E.translate(e.pos.x, e.pos.y);
    E.rotate(t * 1.2);
    E.strokeStyle = rgba(el.color, 0.85);
    E.lineWidth = 1.6;
    E.setLineDash([5, 4]);
    E.beginPath();
    E.arc(0, 0, R * 0.8, 0, TAU);
    E.stroke();
    E.setLineDash([]);
    E.restore();
    const p = 0.8 + 0.2 * Math.sin(t * 5);
    E.drawImage(coreSprite(el.color), e.pos.x - 8 * p, e.pos.y - 8 * p, 16 * p, 16 * p);
    const mx = e.pos.x + Math.cos(e.angle) * R * 1.35;
    const my = e.pos.y + Math.sin(e.angle) * R * 1.35;
    E.drawImage(glowSprite(el.color), mx - 6, my - 6, 12, 12);
    // remaining life ring
    E.strokeStyle = rgba(el.glow, 0.5);
    E.lineWidth = 1.5;
    E.beginPath();
    E.arc(e.pos.x, e.pos.y, R + 5, -Math.PI / 2, -Math.PI / 2 + TAU * (s.life / s.maxLife));
    E.stroke();
    E.globalAlpha = 1;
    env.light.add(e.pos.x, e.pos.y, 90, el.color, 0.6 * fade);
    if (e.element === 'lightning' && Math.random() < env.dt * 6) miniArcs(env, e.pos.x, e.pos.y, r * 1.1, el.glow, 1);
    return;
  }
  // golem: hulking rock body with glowing elemental veins
  const face = facingOf(env, e);
  g.save();
  g.translate(e.pos.x, e.pos.y);
  g.rotate(face);
  g.globalAlpha = fade;
  g.fillStyle = '#4e4658';
  for (const sd of [-1, 1]) {
    g.beginPath();
    g.arc(r * 0.55, sd * r * 0.95, r * 0.42, 0, TAU);
    g.fill();
  }
  g.beginPath();
  for (let k = 0; k <= 9; k++) {
    const a = (k / 9) * TAU;
    const rr = r * (0.92 + hashId(e.id, k % 9) * 0.16);
    if (k) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  const body = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  body.addColorStop(0, '#8a8094');
  body.addColorStop(1, '#3a3344');
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = '#1a1520';
  g.lineWidth = 2;
  g.stroke();
  g.restore();
  const E = env.e;
  E.save();
  E.translate(e.pos.x, e.pos.y);
  E.rotate(face);
  E.globalAlpha = fade * (0.75 + 0.25 * Math.sin(t * 4 + e.id));
  E.strokeStyle = el.color;
  E.lineWidth = 2;
  E.lineCap = 'round';
  E.beginPath();
  E.moveTo(-r * 0.6, -r * 0.3);
  E.lineTo(-r * 0.1, 0);
  E.lineTo(-r * 0.45, r * 0.5);
  E.moveTo(-r * 0.1, 0);
  E.lineTo(r * 0.2, -r * 0.45);
  E.stroke();
  for (const sd of [-1, 1]) E.drawImage(coreSprite(el.color), r * 0.45 - 5, sd * r * 0.28 - 5, 10, 10);
  E.restore();
  E.globalAlpha = 1;
  env.light.add(e.pos.x, e.pos.y, 80, el.color, 0.45 * fade);
}

function barrier(env: DrawEnv, e: Entity): void {
  const el = ELEMENT_INFO[e.element];
  const fade = e.life !== undefined ? Math.min(1, e.life / 0.5) : 1;
  const hpf = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const flick = hpf < 0.4 ? 0.6 + 0.4 * Math.sin(env.t * 30 + e.id) : 1;
  const r = Math.max(e.hw, e.hh) * 1.15;
  const E = env.e;
  E.save();
  E.translate(e.pos.x, e.pos.y);
  E.globalAlpha = fade * flick;
  E.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    if (k) E.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else E.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  E.closePath();
  E.fillStyle = rgba(el.color, 0.22);
  E.fill();
  E.strokeStyle = rgba(el.glow, 0.9);
  E.lineWidth = 1.5;
  E.stroke();
  E.restore();
  env.light.add(e.pos.x, e.pos.y, 40, el.color, 0.25 * fade);
}

function sheep(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const r = e.r;
  const face = facingOf(env, e);
  const bob = Math.sin(env.t * 10 + e.id) * (Math.hypot(e.vel.x, e.vel.y) > 10 ? 1.2 : 0.2);
  g.save();
  g.translate(e.pos.x, e.pos.y + bob);
  g.rotate(face);
  g.fillStyle = '#d9d2c4';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    g.beginPath();
    g.arc(Math.cos(a) * r * 0.55 - r * 0.1, Math.sin(a) * r * 0.55, r * 0.45, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#f6f1e7';
  g.beginPath();
  g.arc(-r * 0.1, 0, r * 0.62, 0, TAU);
  g.fill();
  // head
  g.fillStyle = '#2b2522';
  g.beginPath();
  g.ellipse(r * 0.75, 0, r * 0.38, r * 0.3, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#3a312d';
  g.beginPath();
  g.ellipse(r * 0.6, -r * 0.36, r * 0.18, r * 0.09, -0.6, 0, TAU);
  g.ellipse(r * 0.6, r * 0.36, r * 0.18, r * 0.09, 0.6, 0, TAU);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(r * 0.88, -r * 0.12, 1.3, 0, TAU);
  g.arc(r * 0.88, r * 0.12, 1.3, 0, TAU);
  g.fill();
  g.restore();
  if (e.status.polymorph > 0 && Math.random() < env.dt * 3 * env.budget) env.P.spawn(PT.Glyph, e.pos.x + (Math.random() - 0.5) * 20, e.pos.y - 10, 0, -20, 0.8, 5, env.P.c('#e58cff'), 0, 1);
}

function iceblock(env: DrawEnv, e: Entity): void {
  const g = env.g;
  const { hw, hh } = e;
  const x = e.pos.x - hw;
  const y = e.pos.y - hh;
  g.fillStyle = 'rgba(120,200,240,0.55)';
  g.fillRect(x, y, hw * 2, hh * 2);
  g.strokeStyle = 'rgba(230,250,255,0.9)';
  g.lineWidth = 1.5;
  g.strokeRect(x + 0.75, y + 0.75, hw * 2 - 1.5, hh * 2 - 1.5);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.moveTo(x + 2, y + 2);
  g.lineTo(x + hw * 1.2, y + 2);
  g.lineTo(x + 2, y + hh * 1.2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x + hw * 0.5, y + hh * 1.6);
  g.lineTo(x + hw * 1.2, y + hh * 0.9);
  g.lineTo(x + hw * 1.6, y + hh * 1.3);
  g.stroke();
  env.e.globalAlpha = 0.25;
  env.e.drawImage(glowSprite('#9fe7ff'), e.pos.x - hw * 1.8, e.pos.y - hh * 1.8, hw * 3.6, hh * 3.6);
  env.e.globalAlpha = 1;
}

export function drawBody(env: DrawEnv, e: Entity): void {
  switch (e.kind) {
    case 'caster':
      return caster(env, e);
    case 'enemy':
      return enemy(env, e);
    case 'dummy':
      return dummy(env, e);
    case 'target':
      return target(env, e);
    case 'crate':
      return crate(env, e);
    case 'barrel':
      return barrel(env, e);
    case 'metal':
      return metal(env, e);
    case 'wall':
      return wall(env, e);
    case 'pillar':
      return pillar(env, e);
    case 'boulder':
      return boulder(env, e);
    case 'summon':
      return summon(env, e);
    case 'barrier':
      return barrier(env, e);
    case 'sheep':
      return sheep(env, e);
    case 'iceblock':
      return iceblock(env, e);
    default:
      return;
  }
}

/** per-entity flash state: hits retrigger at most every 0.3s so DoT doesn't strobe */
const flashState = new Map<number, { t: number; last: number }>();
let flashSweep = 0;

export function drawFlash(env: DrawEnv, e: Entity): void {
  if (e.kind === 'barrier') return;
  let st = flashState.get(e.id);
  // burning ticks set flash every step; only real hits should flash
  if (e.flash > 0.9 && e.status.burning <= 0) {
    if (!st) flashState.set(e.id, (st = { t: 0.12, last: env.t }));
    else if (env.t - st.last > 0.3) {
      st.t = 0.12;
      st.last = env.t;
    }
  }
  if (++flashSweep > 600) {
    flashSweep = 0;
    for (const [id, v] of flashState) if (env.t - v.last > 2) flashState.delete(id);
  }
  if (!st || st.t <= 0) return;
  st.t -= env.dt;
  const E = env.e;
  const k = Math.max(0, st.t / 0.12);
  // bright rim + faint fill reads as an impact without whiting out the sprite
  E.globalAlpha = k * 0.14;
  E.fillStyle = '#fff4e8';
  E.strokeStyle = '#ffffff';
  E.lineWidth = 2;
  if (e.shape === 'box') {
    E.fillRect(e.pos.x - e.hw, e.pos.y - e.hh, e.hw * 2, e.hh * 2);
    E.globalAlpha = k * 0.7;
    E.strokeRect(e.pos.x - e.hw, e.pos.y - e.hh, e.hw * 2, e.hh * 2);
  } else {
    E.beginPath();
    E.arc(e.pos.x, e.pos.y, e.r, 0, TAU);
    E.fill();
    E.globalAlpha = k * 0.7;
    E.stroke();
  }
  E.globalAlpha = 1;
}

function miniArcs(env: DrawEnv, x: number, y: number, r: number, color: string, n: number): void {
  const E = env.e;
  E.strokeStyle = color;
  E.lineWidth = 1.2;
  E.beginPath();
  for (let k = 0; k < n; k++) {
    let a = Math.random() * TAU;
    let px = x + Math.cos(a) * r * 0.6;
    let py = y + Math.sin(a) * r * 0.6;
    E.moveTo(px, py);
    for (let s = 0; s < 3; s++) {
      a += (Math.random() - 0.5) * 1.6;
      px += Math.cos(a) * r * 0.35;
      py += Math.sin(a) * r * 0.35;
      E.lineTo(px, py);
    }
  }
  E.stroke();
}

export { miniArcs };

/** Status overlays: fire, frost, wet, shock, shield, regen, stun. */
export function drawStatus(env: DrawEnv, e: Entity): void {
  const s = e.status;
  const { t, P } = env;
  const E = env.e;
  const x = e.pos.x;
  const y = e.pos.y;
  const r = e.shape === 'box' ? Math.max(e.hw, e.hh) : e.r;
  if (s.burning > 0) {
    const fs = flameSprite('#ff6a1a');
    for (let k = 0; k < 3; k++) {
      const fl = 0.75 + 0.25 * Math.sin(t * 15 + k * 2.1 + e.id);
      const ox = (k - 1) * r * 0.55;
      const w = r * 0.9 * fl;
      E.globalAlpha = 0.9;
      E.drawImage(fs, x + ox - w / 2, y - w * 1.55 + r * 0.25, w, w * 1.5);
    }
    E.globalAlpha = 1;
    env.light.add(x, y, 80 + r * 2, '#ff7a2f', 0.75);
    if (Math.random() < env.dt * 14 * env.budget) P.spawn(PT.Ember, x + (Math.random() - 0.5) * r * 1.4, y - r * 0.5, (Math.random() - 0.5) * 30, -50, 0.8, 2, P.c('#ffb347'), 0, 1, 70);
    if (Math.random() < env.dt * 4 * env.budget) P.spawn(PT.Smoke, x, y - r, (Math.random() - 0.5) * 10, -30, 1.4, r * 0.5, P.c('#2a2228'), 16, 0.4, 10);
  }
  if (s.frozen > 0) {
    const g = env.g;
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(170,230,255,0.5)';
    g.strokeStyle = 'rgba(240,252,255,0.95)';
    g.lineWidth = 1.2;
    g.beginPath();
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const rr = r * (k % 2 ? 1.05 : 1.35) * (0.95 + hashId(e.id, k % n) * 0.15);
      if (k) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    E.globalAlpha = 0.3;
    E.drawImage(glowSprite('#9fe7ff'), x - r * 2, y - r * 2, r * 4, r * 4);
    E.globalAlpha = 1;
    env.light.add(x, y, 60, '#8fe3ff', 0.3);
  } else if (s.chilled > 0) {
    E.globalAlpha = 0.35;
    E.strokeStyle = '#9fe7ff';
    E.lineWidth = 1.5;
    E.beginPath();
    E.arc(x, y, r + 2, 0, TAU);
    E.stroke();
    E.globalAlpha = 1;
    if (Math.random() < env.dt * 5 * env.budget) P.spawn(PT.Flake, x + (Math.random() - 0.5) * r * 2, y + (Math.random() - 0.5) * r * 2, 0, 6, 0.9, 3, P.c('#cff6ff'), 0, 1);
  }
  if (s.wet > 0 && s.frozen <= 0) {
    E.globalAlpha = 0.28;
    E.strokeStyle = '#5ab8ff';
    E.lineWidth = 2;
    E.beginPath();
    E.arc(x, y, r * 0.85, Math.PI * 0.15, Math.PI * 0.85);
    E.stroke();
    E.globalAlpha = 1;
    if (Math.random() < env.dt * 4 * env.budget) P.spawn(PT.Mote, x + (Math.random() - 0.5) * r * 1.4, y + r * 0.4, 0, 45, 0.5, 1.6, P.c('#6ac4ff'), 0, 0);
  }
  if (s.shocked > 0) {
    miniArcs(env, x, y, r * 1.4, '#e8ebff', 2);
    env.light.add(x, y, 50, '#9fa8ff', 0.5);
  }
  if (s.stun > 0 && s.shocked <= 0) {
    for (let k = 0; k < 3; k++) {
      const a = t * 5 + (k * TAU) / 3;
      E.drawImage(coreSprite('#ffe08a'), x + Math.cos(a) * r * 0.8 - 3, y - r - 4 + Math.sin(a) * 3 - 3, 6, 6);
    }
  }
  if (s.shield > 0) {
    const R = r + 9 + Math.sin(t * 3) * 1;
    const fade = Math.min(1, s.shieldTime / 0.5);
    E.save();
    E.translate(x, y);
    E.rotate(t * 0.4);
    E.globalAlpha = 0.85 * fade;
    E.drawImage(hexBubble('#ffd27a'), -R, -R, R * 2, R * 2);
    E.restore();
    E.globalAlpha = 1;
    env.light.add(x, y, R * 2.2, '#ffd27a', 0.35 * fade);
  }
  if (s.regenTime > 0 && Math.random() < env.dt * 8 * env.budget) P.spawn(PT.Mote, x + (Math.random() - 0.5) * r * 1.6, y + r * 0.3, 0, -35, 0.9, 2.4, P.c('#9dffb0'), 0, 0.5);
}

export function drawHpBar(env: DrawEnv, e: Entity, force: boolean): void {
  if (!e.destructible || e.maxHp >= 1e8 || e.maxHp <= 0) return;
  const f = Math.max(0, Math.min(1, e.hp / e.maxHp));
  if (!force && f >= 0.999 && e.status.shield <= 0) return;
  if (e.kind === 'barrier' && !force) return;
  const g = env.g;
  const w = Math.max(26, (e.shape === 'box' ? e.hw : e.r) * 2.2);
  const top = e.shape === 'box' ? e.hh : e.r;
  const x = e.pos.x - w / 2;
  const y = e.pos.y - top - (e.kind === 'dummy' ? 12 : 9);
  g.fillStyle = 'rgba(5,3,10,0.75)';
  g.fillRect(x - 1, y - 1, w + 2, 5);
  const col = f > 0.6 ? '#5dffa8' : f > 0.3 ? '#ffd166' : '#ff5c7a';
  g.fillStyle = col;
  g.fillRect(x, y, w * f, 3);
  if (e.status.shield > 0) {
    g.fillStyle = '#ffd27a';
    g.fillRect(x, y - 2.5, Math.min(w, (e.status.shield / e.maxHp) * w), 1.6);
  }
}
