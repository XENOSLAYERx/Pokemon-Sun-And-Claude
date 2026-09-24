# Folder Structure

**Document owner:** Lead Gameplay Programmer

---

## 1. Top level

```
project-alola/
├── packages/           Simulation and presentation libraries
├── apps/               Executables (client, server)
├── tools/              Content pipeline and development harnesses
├── docs/               This documentation
├── content/            Authored and baked content (baked is gitignored)
├── package.json        npm workspaces root
├── tsconfig.base.json  Shared compiler options (erasableSyntaxOnly)
└── tsconfig.json       Path aliases for the whole monorepo
```

## 2. Why a monorepo with workspaces

The alternative — one application directory with folders inside it — was
rejected for a specific reason: **folders do not enforce dependency direction,
but packages do.**

`@alola/world` cannot accidentally import Three.js, because Three.js is not in
its `package.json`. That guarantee is what makes the headless server and the
553 browser-free tests possible, and it degrades the moment the boundary is
only a convention.

## 3. Packages

```
packages/
├── core/                    Zero dependencies. Nothing may import DOM or Node.
│   ├── src/
│   │   ├── math/            vec3.ts · scalar.ts
│   │   ├── util/            rng.ts · noise.ts · pool.ts · blackboard.ts
│   │   ├── ecs/             world.ts · scheduler.ts · components.ts
│   │   ├── events/          bus.ts
│   │   ├── time/            clock.ts
│   │   ├── spatial/         hash.ts
│   │   └── fsm/             state-machine.ts
│   └── test/core.test.ts
│
├── data/                    Pure content. No state, no side effects.
│   ├── src/
│   │   ├── types.ts         Type chart as a flat Float32Array
│   │   ├── species/         schema.ts · dex.ts · registry.ts
│   │   ├── moves/           schema.ts · moves.ts · registry.ts · zmoves.ts
│   │   ├── world/           biomes.ts · islands.ts
│   │   ├── tables/          spawns.ts
│   │   ├── items/           items.ts
│   │   └── quests/          trials.ts · quests.ts
│   └── test/data.test.ts    Doubles as the referential-integrity validator
│
├── world/                   Terrain, streaming, climate, ecology
│   ├── src/
│   │   ├── terrain/         generator.ts
│   │   ├── biome/           classifier.ts
│   │   ├── streaming/       chunks.ts
│   │   ├── timeofday/       cycle.ts
│   │   ├── weather/         system.ts
│   │   ├── ocean/           gerstner.ts
│   │   └── ecology/         spawner.ts · population.ts
│   └── test/world.test.ts
│
├── ai/                      Pokémon behaviour
│   ├── src/
│   │   ├── perception/      senses.ts
│   │   ├── memory/          needs.ts · memory.ts
│   │   ├── utility/         scorer.ts · goals.ts
│   │   ├── bt/              tree.ts
│   │   ├── flock/           boids.ts
│   │   ├── profiles/        profiles.ts
│   │   └── ecosystem/       brain.ts
│   └── test/ai.test.ts
│
├── battle/                  Deterministic turn engine
│   ├── src/
│   │   ├── engine/          state.ts · engine.ts
│   │   ├── calc/            damage.ts
│   │   ├── totem/           totem.ts
│   │   ├── zmove/           cinematic.ts
│   │   ├── arena/           arena.ts
│   │   └── ai/              trainer-ai.ts
│   └── test/battle.test.ts
│
├── quest/    src/runtime.ts          Quest graph + reputation
├── save/     src/{schema,migrations,manager}.ts
├── net/      src/{protocol,server,client}/
├── audio/    src/director.ts         Mix state, no playback
├── render/   src/{pipeline,shaders,instancing,camera}/   ← Three.js lives here
└── ui/       src/{creator,hud,menus}/
```

### Naming conventions

- **Directories:** lowercase, singular for a concept (`terrain/`), plural for a
  collection of peers (`shaders/`).
- **Files:** kebab-case. One primary export concept per file.
- **`index.ts` is a barrel only.** It re-exports; it never contains logic. This
  keeps the public surface of a package reviewable in one screen.
- **`schema.ts` vs data file.** Where content is authored, the type definitions
  live in `schema.ts` and the data in a sibling. A designer editing `dex.ts`
  never has to read type machinery.

## 4. Apps

```
apps/
├── client/
│   ├── index.html          Shell, boot screen, HUD markup
│   ├── vite.config.ts      Aliases point at package *sources*, not builds
│   └── src/main.ts         Wiring only — makes no gameplay decisions
└── server/
    ├── src/world-server.ts Authoritative simulation, transport-agnostic
    └── src/main.ts         Entry point + --selftest harness
```

The Vite config aliasing package sources rather than built output is
deliberate: a change to the AI is live on the next hot reload, with no build
step in between. Tuning emergent behaviour is only tractable when the
iteration loop is seconds.

## 5. Tools

```
tools/
├── content/
│   ├── validate.ts     Referential integrity + design rules. CI gate.
│   └── bake.ts         Authored → runtime format, with derived indices.
└── gen/
    └── headless-sim.ts Boots the whole simulation with no renderer.
```

`headless-sim.ts` earns its place: it answers questions that otherwise need a
build and hours of play. It is how we learned that streaming to the visible
horizon put 80% of loaded chunks in the outermost ring.

## 6. Content

```
content/
├── authored/       Source assets (art, audio) — not in this repository
└── baked/          Pipeline output. Gitignored; reproducible from source.
```

Baked content is never committed. If it cannot be regenerated from authored
sources by running the pipeline, it is not reproducible, and a build that is
not reproducible is not shippable.

## 7. Compiler configuration

`tsconfig.base.json` sets `erasableSyntaxOnly: true`. This forbids TypeScript
enums and constructor parameter properties.

That is a real constraint with a real payoff: every source file runs directly
under `node --experimental-strip-types` with no build step. The 553-test suite
and the headless simulation execute against source, not against a compiled
artefact that could differ from it.

The cost is writing `const Phase = { Input: 0, ... } as const` plus a type
alias instead of `enum Phase`. The const-object form is also tree-shakeable and
has no surprising runtime object, so it is arguably the better form anyway.

## 8. Where new code goes

| You are adding | It goes in |
|---|---|
| A new Pokémon | `packages/data/src/species/dex.ts` |
| A new move | `packages/data/src/moves/moves.ts` |
| A behaviour any species could use | `packages/ai/src/utility/goals.ts` |
| A behaviour tweak for one species | `packages/ai/src/profiles/profiles.ts` |
| A new biome | `packages/data/src/world/biomes.ts` + a spawn entry |
| A terrain feature type | `packages/world/src/terrain/generator.ts` |
| A battle mechanic | `packages/battle/src/engine/engine.ts` |
| A shader | `packages/render/src/shaders/` |
| Anything touching the DOM | `apps/client` or `packages/{render,ui}` only |

If a change needs to touch both `packages/world` and `packages/render` to work,
that is a signal the boundary is in the wrong place — raise it in review rather
than threading a dependency through.
