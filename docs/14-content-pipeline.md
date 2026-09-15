# Content Pipeline

**Document owner:** Technical Artist
**Status:** Validation and bake implemented in `tools/content/`.

---

## 1. Shape of the pipeline

```
   Authored                Validate              Bake              Runtime
   ────────                ────────              ────              ───────
 TypeScript data  ──►  referential +  ──►  flat JSON +   ──►  client / server
 (designer-edited)     design rules       derived indices
        │                    │
        │                    └─► CI gate: errors block the build
        │
 DCC assets       ──►  import + LOD  ──►  glTF + KTX2   ──►  streamed
 (Blender, Maya)       + compression       + bundles
```

Two halves: **data content** (species, moves, quests) and **asset content**
(models, textures, audio). The data half is implemented in this repository; the
asset half is specified here.

## 2. Why content is authored as TypeScript

An unusual choice, made deliberately over JSON or a database.

| | TypeScript | JSON | Editor + DB |
|---|---|---|---|
| Type safety while authoring | **Yes** | No | Partial |
| Refactor a field across all entries | **Yes** | No | Manual migration |
| Comments explaining a decision | **Yes** | No | Sometimes |
| Non-programmer editable | Mostly | Yes | **Yes** |
| Diff review | **Excellent** | Good | Poor |

A designer adding a Pokémon writes a struct with full autocomplete, immediate
red squiggles on a typo, and a diff that a reviewer can read. That is worth more
than editor convenience at this team size. A visual editor that writes these
files is the right future step; it is not a replacement for them.

The `schema.ts` / data-file split exists so a designer editing `dex.ts` never
has to read type machinery.

## 3. Validation

`tools/content/validate.ts` reports **every** problem rather than throwing on
the first, and distinguishes two severities:

- **Error** — will break at runtime. Blocks the build.
- **Warning** — a design smell a human should look at. Does not block.

Current state: **0 errors, 0 warnings** across 53 species, 50 moves, 14
Z-Moves, 28 biomes, 5 islands, 45 items, 7 trials, 11 quests and 78 spawn
entries, in 5ms.

### What it checks

**Referential integrity.** Every cross-reference resolves: a quest reward's
items exist, a Totem's moves exist, an island's guardian is a real species, a
Z-Crystal maps back to a Z-Move.

**Physical plausibility.** A water ride must be a swimmer. A swimmer must not be
listed in a non-aquatic biome. Island landmasses must not overlap — the terrain
generator assumes at most one contributes to any point.

**Design rules.** A Z-Move pose window under 1.5s is an error, because the
design says a miss must never feel like a punishment. A Totem's phases must
descend monotonically from full HP.

**Graph properties.** Quest objectives must be reachable from a root; a cycle or
an orphan is an error. Flags a quest requires must be produced by some quest's
reward, or the content is dead.

**Coverage.** A walkable biome with no unconditional spawns in each 3-hour
window is a hole.

### Bugs it has caught

Genuine ones, from this repository's history:

- Akala and Ula'ula landmasses overlapping by 840m
- Two trial reward Z-Crystals that were never defined as items
- Two quests referenced by `unlocks` that did not exist
- A swimmer placed in a walkable marsh
- Towns, cities and ruins completely empty of Pokémon during daylight
- `story_act3` gating the entire Ultra Beast arc with nothing setting it

Each of those would have shipped as a bug report.

### Declared exemptions

Intentionally-empty biomes are declared rather than suppressed:

```ts
const INTENTIONALLY_GATED = {
  facility: 'Pokémon here are contained, not wild',
  'ultra-space': 'gated behind ultra_access until the story opens it',
};
```

An exemption a reviewer can disagree with, not a warning people learn to ignore.

## 4. Bake

`tools/content/bake.ts` converts authored content to the runtime format and
computes derived tables.

Three reasons to bake at all, given the data is already TypeScript:

1. **Load time.** Parsing and validating the authored form costs time on every
   boot.
2. **Derived tables.** The predator index, biome-to-spawn index, habitat index
   and region lists are derivable but expensive. Computing them once at bake is
   free; at boot it is not.
3. **Ship what validates.** Bake runs after validation, so a build can never
   ship content that failed.

Current output: **14 files, 135 KB, in 26ms.**

```
species.json              53 entries     39.0 KB
moves.json                50 entries     14.1 KB
zmoves.json               14 entries     11.9 KB
biomes.json               28 entries      9.9 KB
islands.json               5 entries     11.0 KB
items.json                45 entries     10.4 KB
trials.json                7 entries     11.0 KB
quests.json               11 entries     12.3 KB
spawns.json               78 entries      9.1 KB
index-predators.json       7 entries       231 B
index-biome-spawns.json   28 entries       774 B
index-habitats.json       45 entries      2.1 KB
index-regions.json         5 entries      2.5 KB
index-quest-graph.json    11 entries       801 B
```

Baked content is **never committed**. If it cannot be regenerated from source
by running the pipeline, the build is not reproducible.

## 5. Asset pipeline (specified)

### Models

```
Blender / Maya  ──►  glTF 2.0 export
                        │
                        ├─► LOD generation (0/1/2/3 at 100/50/25/10%)
                        ├─► Collision hull extraction
                        ├─► Socket extraction (ride points, VFX attach)
                        └─► Draco compression
                        │
                     .glb bundle
```

**Naming is a contract**, because the pipeline reads it:

```
pm_0025_pikachu_00.blend       species 0025, form 00
pm_0025_pikachu_00_lod1.glb
pm_0025_pikachu_00_shiny.ktx2
env_melemele_palm_tall_a.glb
```

A Pokémon rig must expose sockets named `socket_ride`, `socket_mouth`,
`socket_tail_tip`, `socket_vfx_*`. Missing sockets fail import rather than
producing a Z-Move that emits from the origin.

### Textures

| Map | Format | Notes |
|---|---|---|
| Base colour | KTX2 / BC7 | sRGB |
| Normal | KTX2 / BC5 | Two-channel, Z reconstructed |
| ORM | KTX2 / BC7 | Occlusion, roughness, metallic packed |
| Shiny | KTX2 / BC7 | Palette swap only, never a second texture set |

Shinies being a palette swap rather than a texture set is a memory decision:
1,000+ species × a second full texture set is prohibitive, and the visual
difference is colour anyway.

### Audio

| Type | Format | Notes |
|---|---|---|
| Cries | Ogg Vorbis, mono, 22kHz | 3 pitch variants per species |
| Music stems | Ogg Vorbis, stereo, 44.1kHz | Separate per stem, sample-aligned |
| Ambience | Ogg Vorbis, stereo | Seamless loops, verified by the importer |
| SFX | Ogg Vorbis, mono | 3D-positioned |

Music stems **must be sample-aligned**. The audio director cross-fades between
them assuming a shared playhead; a one-frame offset is audible as phasing.

## 6. CI

```yaml
on: [push, pull_request]
jobs:
  validate:
    - npm ci
    - npm run typecheck                    # tsc --noEmit, strict
    - npm run validate:content             # 0 errors required
    - npm run test                         # 430 tests
    - npm run bake:content                 # must succeed
    - npm run sim -- --hours 2 --agents 200  # must report stable
```

The headless simulation in CI is unusual and valuable: it catches systemic
regressions — a NaN in the ecosystem, an AI deadlock, streaming that stopped
working — that no unit test would.

It is how the LOD table mismatch was caught. Nothing threw; streaming silently
built zero chunks.

## 7. Iteration times

| Change | Feedback |
|---|---|
| Content data | Hot reload (Vite aliases point at sources) |
| Simulation code | Hot reload |
| Shader | Hot reload |
| Model or texture | Re-import, ~10s |
| Full content bake | 26ms |
| Full test suite | ~12s |

The Vite config aliasing package **sources** rather than built output is what
makes the first three instant. Tuning emergent AI behaviour is only tractable
when the loop is seconds.
