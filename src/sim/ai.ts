import { V, type Vec } from '../core/types';
import type { AIBehavior, AIData, Entity } from './entity';
import { jaggedPath, spawnProjectile } from './magic';
import type { World } from './world';

export function makeAI(behavior: AIBehavior, home: Vec, speed = 90, extra: Partial<AIData> = {}): AIData {
  return {
    behavior,
    speed,
    home: V.copy(home),
    path: [],
    pathIdx: 0,
    attackCd: 1 + Math.random(),
    attackRate: behavior === 'ranged' ? 2.2 : 0.9,
    attackDamage: behavior === 'ranged' ? 8 : 10,
    targetId: 0,
    wanderT: 0,
    wanderDir: V.fromAngle(Math.random() * Math.PI * 2),
    ...extra,
  };
}

function steer(e: Entity, desired: Vec, dt: number, accel = 8): void {
  const k = Math.min(1, accel * dt);
  e.vel.x += (desired.x - e.vel.x) * k;
  e.vel.y += (desired.y - e.vel.y) * k;
}

export function updateAI(w: World, e: Entity, dt: number, caster: Entity | undefined): void {
  const ai = e.ai!;
  let speed = ai.speed;
  if (e.status.chilled > 0) speed *= 0.45;
  ai.attackCd -= dt;
  const toC = caster ? V.sub(caster.pos, e.pos) : { x: 0, y: 0 };
  const dC = V.len(toC);
  const dirC = dC > 1e-3 ? V.scale(toC, 1 / dC) : { x: 0, y: 0 };
  switch (ai.behavior) {
    case 'idle':
      break;
    case 'chase': {
      if (!caster) break;
      steer(e, V.scale(dirC, speed), dt);
      const reach = e.r + caster.r + 6;
      if (dC < reach && ai.attackCd <= 0) {
        ai.attackCd = ai.attackRate;
        w.damage(caster, ai.attackDamage * w.settings.enemyDamage, 'force');
        caster.vel.x += dirC.x * 260;
        caster.vel.y += dirC.y * 260;
        w.emit({ type: 'hit', pos: V.lerp(e.pos, caster.pos, 0.5), element: 'force', dir: dirC, amount: ai.attackDamage });
      }
      break;
    }
    case 'strafe': {
      if (!caster) break;
      const want = 230;
      const radial = V.scale(dirC, (dC - want) * 1.4);
      const tangent = V.scale(V.perp(dirC), speed);
      steer(e, V.add(radial, tangent), dt, 4);
      if (ai.attackCd <= 0 && dC < 420) {
        ai.attackCd = ai.attackRate * 1.6;
        hostileShot(w, e, caster.pos);
      }
      break;
    }
    case 'ranged': {
      if (!caster) break;
      const want = 330;
      const radial = V.scale(dirC, (dC - want) * 1.2);
      steer(e, V.add(radial, V.scale(V.perp(dirC), speed * 0.3 * Math.sin(w.time + e.id))), dt, 3);
      if (ai.attackCd <= 0 && dC < 620) {
        ai.attackCd = ai.attackRate;
        hostileShot(w, e, caster.pos);
      }
      break;
    }
    case 'patrol': {
      if (ai.path.length < 2) break;
      const target = ai.path[ai.pathIdx % ai.path.length];
      const to = V.sub(target, e.pos);
      const d = V.len(to);
      if (d < 12) ai.pathIdx = (ai.pathIdx + 1) % ai.path.length;
      steer(e, V.scale(V.norm(to), speed), dt, 5);
      break;
    }
    case 'flee': {
      ai.wanderT -= dt;
      if (ai.wanderT <= 0) {
        ai.wanderT = 0.8 + w.random() * 1.5;
        ai.wanderDir = V.fromAngle(w.random() * Math.PI * 2);
      }
      let dir = ai.wanderDir;
      if (caster && dC < 200) dir = V.norm(V.add(V.scale(dirC, -1), V.scale(dir, 0.4)));
      steer(e, V.scale(dir, speed), dt, 3);
      break;
    }
  }
}

function hostileShot(w: World, e: Entity, at: Vec): void {
  const dir = V.norm(V.sub(at, e.pos));
  spawnProjectile(w, {
    pos: V.add(e.pos, V.scale(dir, e.r + 6)),
    dir,
    speed: 300,
    size: 6,
    damage: e.ai!.attackDamage * w.settings.enemyDamage,
    element: e.element === 'force' ? 'arcane' : e.element,
    life: 3,
    ownerId: e.id,
    instance: 0,
    team: 1,
  });
}

export function updateSummon(w: World, e: Entity, dt: number): void {
  const s = e.summon!;
  s.life -= dt;
  if (s.life <= 0) {
    w.emit({ type: 'death', pos: V.copy(e.pos), kind: e.kind, element: e.element, radius: e.r });
    w.fire(e.hooks.expire, { pos: V.copy(e.pos), self: e.id });
    e.alive = false;
    return;
  }
  if (e.status.frozen > 0 || e.status.stun > 0) return;
  s.attackCd -= dt;
  const target = w.nearest(e.pos, s.range, 'enemies');
  if (s.kind === 'golem') {
    const tgt = target ?? w.nearest(e.pos, 2000, 'enemies');
    if (tgt) {
      const dir = V.norm(V.sub(tgt.pos, e.pos));
      steer(e, V.scale(dir, 120), dt, 5);
      if (V.dist(tgt.pos, e.pos) < e.r + tgt.r + 8 && s.attackCd <= 0) {
        s.attackCd = s.attackRate;
        if (e.hooks.attack) w.fire(e.hooks.attack, { pos: V.copy(tgt.pos), target: tgt.id, self: e.id });
        else {
          w.damage(tgt, s.damage, e.element, e.instance);
          tgt.vel.x += dir.x * 420 * Math.min(tgt.invMass, 1.5);
          tgt.vel.y += dir.y * 420 * Math.min(tgt.invMass, 1.5);
          w.emit({ type: 'shockwave', pos: V.copy(tgt.pos), radius: 40, element: e.element });
        }
      }
    }
    return;
  }
  if (target && s.attackCd <= 0) {
    s.attackCd = s.attackRate;
    e.angle = V.angle(V.sub(target.pos, e.pos));
    if (e.hooks.attack) {
      w.fire(e.hooks.attack, { pos: V.copy(target.pos), target: target.id, self: e.id });
    } else if (e.element === 'lightning') {
      w.emit({ type: 'bolt', points: jaggedPath(w, e.pos, target.pos), element: 'lightning', width: 2 });
      w.damage(target, s.damage, 'lightning', e.instance);
    } else {
      const dir = V.norm(V.sub(target.pos, e.pos));
      spawnProjectile(w, {
        pos: V.add(e.pos, V.scale(dir, e.r + 4)),
        dir,
        speed: 620,
        size: 5,
        damage: s.damage,
        element: e.element,
        life: 1.5,
        ownerId: e.id,
        instance: e.instance,
      });
    }
  }
}
