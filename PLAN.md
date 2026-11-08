# SPELL COMPILER — Implementation Plan

A browser magic sandbox. Players **program** spells as typed node graphs, the
graph is **compiled** (validated, type-checked, scope-analysed, costed) and then
**interpreted** by an event-driven runtime that drives a 2D physics arena.

## Architecture (strict layering)

```
src/
  core/            pure, framework-free, unit-tested
    types.ts         value & port types, coercion rules, spell document model
    nodes/           node definitions (ports, params, docs, cost, exec/eval fns)
    compiler.ts      graph -> CompiledSpell (validation, typing, scopes, costs)
    interpreter.ts   frames, continuations, events, budgets, recursion, mana
    serialize.ts     JSON schema validation, import/export, share codes
  sim/             simulation (no DOM)
    world.ts         entity store, terrain grid, step loop, events, statuses
    physics.ts       broadphase hash grid, circle/AABB collision & response
    elements.ts      element reactions (fire+oil, ice+water, lightning+wet...)
    ai.ts            enemy/dummy/target/summon behaviours
    presets.ts       arena experiment presets
    fx.ts            visual event stream emitted by sim (consumed by renderer)
  render/          Canvas2D renderer (reads world + fx stream; never mutates sim)
    renderer.ts      layers: floor, terrain, entities, particles, lights, bloom, distortion
    particles.ts     pooled SoA particle system
    sigils.ts        procedural rune glyphs & spell sigils
  engine/          glue: fixed-timestep loop, casting input, stats, profiler
  editor/          React Flow node editor (custom nodes, palette, history, clipboard)
  ui/              app shell, library, stats, trace, profiler, problems panels
  data/            example spells, blueprints
tests/             vitest: compiler, interpreter, chains, recursion, mana, physics, io
scripts/e2e.mjs    Playwright: boots the app, casts spells with the mouse, asserts
```

## Spell language

* **Pins**: `exec` (control flow) and typed data: `number`, `bool`, `vector`,
  `entity`, `entities`, `element`, `any`. Implicit coercions:
  `entity -> vector` (position), `entity -> entities` (singleton),
  `number -> bool` (≠0), `bool -> number`. Everything else is a type error.
* **Unconnected inputs** use inline literals edited inside the node.
* **Triggers**: `On Cast`, `While Channeling`; subspell `Entry` nodes.
* **Event outputs** on effect nodes (`On Hit`, `On Expire`, `On Tick`,
  `On Enter`, `Each Hop`) are exec pins fired *later* by the simulation. They
  carry event-scoped data outputs (hit position, hit entity…).
* **Control**: Branch, Sequence, Repeat, For Each, While (bounded), Delay,
  Every (timer), Gate/Once, Random Branch, Stop.
* **Variables**: per-cast (`cast`) and per-caster persistent (`persistent`).
* **Subspells**: reusable graphs with typed parameters; may call themselves
  (recursion) and other subspells; library spells can trigger other library spells.

## Compiler

Validates: unknown nodes, dangling edges, type mismatches (with coercions),
multiple sources for a data input, data cycles, synchronous exec cycles (cycles
with no async node), event-scoped values used outside their flow, missing
trigger, unknown subspells/variables, recursion without an async/depth guard
(warning). Produces index tables (exec fan-out ordered by node Y, data sources),
static complexity & base mana cost, cooldown.

## Runtime

* Continuations `{graph, node, port, bindings, depth}` in a work queue.
* Budgets: per-run step cap (runaway sync loops fizzle with a clear error),
  per-tick global cap (excess work is *deferred*, not dropped), recursion depth
  cap, entity caps, instance lifetime cap.
* Mana: up-front cost = compiled complexity; dynamic costs charged when effects
  actually spawn (scaled by damage/radius/duration/count) plus a tiny per-step
  cost, so infinite timers starve themselves. Out of mana -> effect fizzles.
* Cooldown derived from complexity (overridable upward).
* Trace + profiler: per node exec counts, time, mana; trace ring buffer.

## Magic components

Projectile, Beam, Explosion, Field (gravity, attract, repel, vortex, stasis,
elemental zone), Apply Force, Teleport/Swap/Blink, Duplicate, Transmute
(polymorph/scale/element), Ignite/Freeze/Shock/Heal/Shield, Summon (turret,
wisp, golem, prop), Chain, Homing, Orbit, Delay/Every, Terrain paint
(oil/water/ice/grass), environmental reactions on a terrain grid.

## Arena

Destructible crates/walls, explosive barrels (chain reactions), metal blocks
(conduct), boulders, moving targets, dummies, enemies (chase/strafe/ranged),
hazards (lava, water, oil, grass, spikes). Configurable presets + spawn tools.

## Visual language

fire = embers/smoke/orange flicker · ice = cyan shards/frost hexes · lightning =
jagged branching bolts/violet-white flicker · arcane = magenta runes/rings ·
void/gravity = dark core, inward spirals, lensing · life = green-gold motes ·
force = pale shock rings · shield = gold hex bubbles. Additive glow sprites,
light buffer, bloom, shockwave & lens distortion, trails, screen shake, sigils.

## Verification

Vitest suites for every layer; Playwright e2e casting in the real app with
screenshots; manual review of screenshots for visual quality.
