import { describe, expect, it } from 'vitest';
import { V } from '../src/core/types';
import { circleBox, circleCircle, rayBox, rayCircle } from '../src/sim/physics';
import { spawnProjectile, createField } from '../src/sim/magic';
import { Mat } from '../src/sim/terrain';
import { World } from '../src/sim/world';
import { buildPreset, PRESETS } from '../src/sim/presets';

const DT = 1 / 60;
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s / DT); i++) w.step(DT);
};

describe('collision primitives', () => {
  it('circle-circle and circle-box contacts have correct normals and depths', () => {
    const cc = circleCircle({ x: 0, y: 0 }, 10, { x: 15, y: 0 }, 10)!;
    expect(cc.nx).toBeCloseTo(1);
    expect(cc.depth).toBeCloseTo(5);
    expect(circleCircle({ x: 0, y: 0 }, 10, { x: 25, y: 0 }, 10)).toBeNull();
    const w = new World();
    const box = w.spawn('wall', { x: 100, y: 100 }, { hw: 20, hh: 20 });
    const c = circleBox({ x: 70, y: 100 }, 12, box)!;
    expect(c.nx).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(2);
    const inside = circleBox({ x: 95, y: 100 }, 5, box)!; // centre inside: pushed out the short way
    expect(inside.nx).toBe(1);
  });

  it('ray casts hit circles and boxes at the right distance', () => {
    expect(rayCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 50, y: 0 }, 10)).toBeCloseTo(40);
    const w = new World();
    const box = w.spawn('wall', { x: 100, y: 0 }, { hw: 10, hh: 10 });
    const h = rayBox({ x: 0, y: 0 }, { x: 1, y: 0 }, box)!;
    expect(h.t).toBeCloseTo(90);
    expect(h.nx).toBe(-1);
  });
});

describe('bodies & projectiles', () => {
  it('dynamic bodies separate and do not tunnel through walls', () => {
    const w = new World();
    w.spawn('wall', { x: 400, y: 300 }, { hw: 10, hh: 200 });
    const crate = w.spawn('crate', { x: 300, y: 300 });
    crate.vel = { x: 2000, y: 0 };
    crate.damping = 0;
    run(w, 0.5);
    expect(crate.pos.x).toBeLessThan(400);
  });

  it('a projectile hits a wall, reports the surface normal, and bounces', () => {
    const w = new World();
    w.spawn('wall', { x: 500, y: 300 }, { hw: 10, hh: 200, hp: 1e9 });
    const p = spawnProjectile(w, { pos: { x: 300, y: 300 }, dir: { x: 1, y: 0 }, speed: 800, size: 6, damage: 5, element: 'force', life: 3, bounces: 1, ownerId: 0, instance: 1 })!;
    const hook = { __hook: true } as const;
    p.hooks.hit = hook;
    run(w, 0.4);
    const hit = w.fired.find((f) => f.hook === hook)!;
    expect(hit).toBeTruthy();
    expect((hit.values.normal as { x: number }).x).toBeCloseTo(-1);
    expect(p.vel.x).toBeLessThan(0); // bounced back
  });

  it('piercing projectiles pass through enemies but not through walls', () => {
    const w = new World();
    const a = w.spawn('enemy', { x: 400, y: 300 });
    const b = w.spawn('enemy', { x: 480, y: 300 });
    w.spawn('wall', { x: 600, y: 300 }, { hw: 10, hh: 100, hp: 1e9 });
    const p = spawnProjectile(w, { pos: { x: 300, y: 300 }, dir: { x: 1, y: 0 }, speed: 900, size: 6, damage: 10, element: 'arcane', life: 3, pierce: 3, ownerId: 0, instance: 1 })!;
    run(w, 0.6);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(p.alive).toBe(false);
    expect(w.entities.has(p.id)).toBe(false);
  });

  it('gravity fields bend projectile paths', () => {
    const w = new World();
    createField(w, { pos: { x: 500, y: 250 }, kind: 'gravity', radius: 300, strength: 2500, duration: 5, dps: 0, element: 'void', affectsProjectiles: true, follow: 0, ownerId: 0, instance: 1 });
    const p = spawnProjectile(w, { pos: { x: 200, y: 400 }, dir: { x: 1, y: 0 }, speed: 400, size: 5, damage: 0, element: 'arcane', life: 3, ownerId: 0, instance: 2 })!;
    run(w, 0.5);
    expect(p.pos.y).toBeLessThan(390); // pulled upward toward the well
  });
});

describe('element & environment interactions', () => {
  it('explosive barrels chain-react', () => {
    const w = new World();
    const barrels = [0, 1, 2, 3].map((i) => w.spawn('barrel', { x: 300 + i * 70, y: 300 }));
    w.damage(barrels[0], 100, 'force');
    run(w, 0.5);
    expect(barrels.every((b) => !b.alive)).toBe(true);
    expect(w.fx.filter((f) => f.type === 'explosion').length).toBe(4);
  });

  it('fire ignites grass that spreads, ice freezes water, lightning electrifies water', () => {
    const w = new World();
    w.terrain.paintRect(200, 200, 600, 260, Mat.Grass);
    w.explode({ x: 210, y: 230 }, 40, 0, 'fire', 0);
    run(w, 4);
    let fireOrAsh = 0;
    for (let i = 0; i < w.terrain.mat.length; i++) if (w.terrain.mat[i] === Mat.Fire || w.terrain.mat[i] === Mat.Scorched) fireOrAsh++;
    expect(fireOrAsh).toBeGreaterThan(20); // spread well beyond the 40px blast

    w.terrain.paintCircle({ x: 800, y: 600 }, 80, Mat.Water);
    w.explode({ x: 800, y: 600 }, 60, 0, 'ice', 0);
    expect(w.terrain.at({ x: 800, y: 600 })).toBe(Mat.Ice);

    w.terrain.paintCircle({ x: 1200, y: 400 }, 100, Mat.Water);
    const wader = w.spawn('dummy', { x: 1260, y: 420 }, { hp: 500 });
    run(w, 0.2); // gets wet standing in the pond
    expect(wader.status.wet).toBeGreaterThan(0);
    const before = wader.hp;
    w.explode({ x: 1140, y: 380 }, 20, 0, 'lightning', 0); // strike the far side of the pool
    expect(wader.hp).toBeLessThan(before);
  });

  it('frozen targets shatter for bonus damage; wet targets take double lightning', () => {
    const w = new World();
    const a = w.spawn('dummy', { x: 300, y: 300 }, { hp: 1000 });
    const b = w.spawn('dummy', { x: 600, y: 300 }, { hp: 1000 });
    w.freezeEntity(a, 3);
    w.damage(a, 100, 'force');
    w.damage(b, 100, 'force');
    expect(1000 - a.hp).toBeCloseTo(160);
    expect(a.status.frozen).toBe(0);
    const c = w.spawn('dummy', { x: 900, y: 300 }, { hp: 1000 });
    c.status.wet = 2;
    w.damage(c, 50, 'lightning');
    expect(1000 - c.hp).toBeCloseTo(100);
  });

  it('shields absorb damage before health', () => {
    const w = new World();
    const e = w.spawn('enemy', { x: 300, y: 300 }, { hp: 100 });
    e.status.shield = 30;
    e.status.shieldTime = 5;
    w.damage(e, 50, 'arcane');
    expect(e.hp).toBeCloseTo(80);
    expect(e.status.shield).toBe(0);
  });

  it('every arena preset builds and simulates without errors', () => {
    for (const p of PRESETS) {
      const w = new World();
      buildPreset(w, p.id);
      expect(w.caster).toBeTruthy();
      run(w, 1);
      expect(w.list.every((e) => Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y))).toBe(true);
    }
  });

  it('enemies chase the caster', () => {
    const w = new World();
    buildPreset(w, 'horde', { enemyCount: 3, enemyHp: 1, behavior: 'chase', respawn: false });
    const c = w.caster!;
    const d0 = Math.min(...w.list.filter((e) => e.kind === 'enemy').map((e) => V.dist(e.pos, c.pos)));
    run(w, 3);
    const d1 = Math.min(...w.list.filter((e) => e.kind === 'enemy').map((e) => V.dist(e.pos, c.pos)));
    expect(d1).toBeLessThan(d0 - 100);
  });
});
