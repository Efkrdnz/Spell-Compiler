# Spell Compiler

**Play it in your browser: https://efkrdnz.github.io/Spell-Compiler/**

A browser magic sandbox where you **invent spells by programming them** as typed
node graphs. Graphs are compiled (validated, type-checked, scope-analysed,
costed) and run by an event-driven interpreter that drives a 2D physics arena
with elemental reactions, destructible props and configurable foes.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit + integration tests (vitest)
npm run e2e          # boots the app in Chromium and casts spells with the mouse
npm run build        # type-check + production build
```

## Using it

* **Left pane: the spell editor.** Drag nodes from the palette (or press
  Space / double-click for quick-add), wire pins together, edit values
  inline. White pins are flow; coloured pins are typed data. The compiler
  runs on every edit — errors appear on nodes and in the Problems tab.
* **Right pane: the arena.** Hotbar slot 1 always holds the spell you're
  editing, so you can edit and cast with no extra steps. Left-click casts the
  active slot, right-click casts the alt slot (R), hold to channel. WASD moves.
  Use **Grab** to throw props and **Spawn** to place foes, props and terrain.
* **Dock:** *Problems* (compiler diagnostics, click to jump), *Trace* (every
  node step, event and fizzle — nodes glow in the editor as they run),
  *Profiler* (executions, self time and mana per node), *Stats* (damage per
  element, mana flow, arena load).
* **Grimoire:** your spells, 24 editable examples, blueprints (insertable
  fragments) and experiment presets. Everything autosaves in the browser;
  *Import / Export* handles JSON files, whole-library exports and share links.

## The spell language

| Concept | Details |
|---|---|
| Types | `number`, `bool`, `vector`, `entity`, `entities`, `element`, `any`. Implicit coercions: entity→vector (position), entity↔entities, number↔bool. Everything else is a compile error. |
| Triggers | On Cast (press), While Channeling (repeats while held), On Release (with hold time), Subspell Entry. |
| Events | Effect nodes expose event pins (On Hit, On Expire, On Tick, On Enter, On Attack…) fired later by the simulation. Event-scoped values (Hit Entity, Point…) are only valid downstream of their event — checked at compile time. |
| Control | Branch, Sequence, Repeat, Radial Burst, For Each, While, Delay, Every, Once, Chance. |
| State | Cast-scoped and persistent (remember across casts) variables. |
| Composition | Subspells with typed parameters (recursion allowed, depth-limited), Cast Spell (spells triggering other library spells), Duplicate (clones keep their event hooks). |
| Magic | Projectile, Homing, Empower, Beam, Explosion, Force Field (gravity, attract, repel, vortex, stasis, elemental zone), Shockwave, Apply Force, Orbit, Teleport, Swap, Duplicate, Transmute, Resize, Dispel, Damage, Ignite, Freeze, Shock, Drench, Heal, Ward, Barrier, Chain, Shape Terrain, Summon (turret, wisp, golem — with programmable attacks), Conjure Matter. |
| Targeting | Find In Radius, Nearest, Raycast, Filter, Sort & Take, List Info, Combine Lists, Entity Info, Has Status, Caster, Terrain At. |

### Runtime safety & economy

* **Mana:** casting pays an upfront cost from compiled complexity; every effect
  then pays for what it actually creates (damage, radius, duration, count…),
  plus a tiny per-step cost. If the caster can't pay, that flow fizzles with a
  trace entry — so infinite timer loops starve themselves.
* **Budgets:** a synchronous burst may run `runBudget` node steps (runaway loops
  abort with a clear error); per-tick work above `tickBudget` is *deferred*, not
  dropped; each cast has a lifetime step budget and lifetime limit.
* **Recursion:** subspell calls, Cast Spell and event generations deepen a
  frame's depth; past `maxDepth` the chain stops gracefully.
* **Cooldowns** derive from complexity (plus optional extra cooldown).
* All limits are adjustable in the arena's **⚙ Lab** popover.

### Element reactions

Fire ignites grass/oil (spreading), thaws frozen targets, is halved on wet
targets. Ice freezes water into walkable ice, chills and freezes, extinguishes
burning. Lightning doubles on wet targets, extends through metal, and
electrifies whole connected pools of water. Force/arcane/void hits shatter
frozen targets for bonus damage. Explosive barrels chain-react. Life heals
allies and regrows scorched ground.

## Architecture

```
src/core     framework-free language: types, node library, compiler, interpreter, costs, serialisation
src/sim      simulation: world/entities, physics (spatial hash, circle/AABB), terrain grid, AI, presets, spell primitives
src/render   Canvas2D renderer: terrain cache, entities, particles, lighting buffer, bloom, distortion, sigils
src/engine   fixed-timestep loop, input → casts, stats sampling (no React)
src/editor   React Flow node editor
src/ui       app shell, arena HUD, dock panels, grimoire, import/export
src/data     examples, blueprints, spell-building DSL
tests        vitest suites; scripts/e2e.cjs drives the real app
```

The simulation never depends on the renderer: it emits a stream of visual
events (`src/sim/fx.ts`) that the renderer consumes. The interpreter only
touches the world through `src/sim/magic.ts` primitives and world queries.
See `PLAN.md` for the design notes.
