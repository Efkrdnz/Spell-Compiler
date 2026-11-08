/**
 * Mana economy. Every effect pays for what it actually simulates; the shape of
 * these curves is what keeps a 5-way split of gravity bombs expensive but legal.
 */
export const COSTS = {
  /** each impure node execution */
  step: 0.015,
  /** upfront cost = base + complexity × perComplexity */
  base: 2,
  perComplexity: 0.45,
  projectile: (dmg: number, size: number, life: number, pierce: number, bounces: number, homing: number) =>
    2 + dmg * 0.11 + size * 0.08 + life * 0.35 + pierce * 1.5 + bounces * 0.8 + (homing > 0 ? 1.5 + homing * 0.25 : 0),
  beam: (dps: number, duration: number, length: number, width: number) => 3 + dps * duration * 0.09 + length * 0.004 + width * 0.05,
  explosion: (radius: number, dmg: number, force: number) => 3 + radius * 0.028 + dmg * 0.1 + Math.abs(force) * 0.0025,
  field: (radius: number, strength: number, duration: number, dps: number) =>
    3 + radius * 0.012 * Math.max(1, duration * 0.7) + Math.abs(strength) * 0.0016 * duration + dps * duration * 0.08,
  force: (radius: number, strength: number) => 1 + radius * 0.008 + Math.abs(strength) * 0.0018,
  push: (count: number, strength: number) => 0.4 + count * Math.abs(strength) * 0.0008,
  teleport: (dist: number) => 3 + dist * 0.008,
  duplicate: (count: number, kindCost: number) => count * (1.2 + kindCost),
  transmute: (count: number, duration: number) => count * (4 + duration * 0.3),
  chain: (jumps: number, dmg: number) => 2 + jumps * (1 + dmg * 0.05),
  status: (count: number, magnitude: number) => 0.5 + count * (0.6 + magnitude * 0.06),
  heal: (amount: number) => 1 + amount * 0.12,
  shield: (amount: number, duration: number) => 1.5 + amount * 0.08 + duration * 0.3,
  barrier: (width: number, duration: number, hp: number) => 3 + width * 0.03 + duration * 0.4 + hp * 0.02,
  summon: (duration: number, damage: number, rate: number) => 8 + duration * 0.6 + (damage / Math.max(0.1, rate)) * 0.25,
  conjure: (life: number) => 4 + (life > 0 ? life * 0.1 : 6),
  terrain: (radius: number) => 1 + radius * 0.03,
  orbit: (duration: number) => 1 + duration * 0.2,
  castSpell: 2,
  subspell: 0.5,
};

/** Seconds of cooldown derived from static complexity. */
export function cooldownFor(complexity: number, extra = 0): number {
  return Math.round((0.18 + complexity * 0.011 + Math.max(0, extra)) * 100) / 100;
}

export function upfrontCost(complexity: number): number {
  return Math.round((COSTS.base + complexity * COSTS.perComplexity) * 10) / 10;
}
