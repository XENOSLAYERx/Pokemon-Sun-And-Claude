# Animation Pipeline

**Document owner:** Technical Artist
**Status:** Specification. The prototype animates transforms only.

---

## 1. The scale problem

A thousand species × a full animation set is not authorable one species at a
time. The pipeline exists to make it tractable.

The answer is **shared rig families with per-species overrides**. A species on
`quadruped_small` inherits idle, walk, run, turn, sleep, eat, alert, flee,
attack and faint from the family, and authors only what makes it distinct.

| Rig family | Shared clips | Typical per-species overrides |
|---|---|---|
| `quadruped_small` | 42 | 6–10 |
| `biped_small` | 38 | 8–14 |
| `avian_small` | 34 | 5–8 |
| `draconic_large` | 56 | 12–20 |
| `tapu` | 30 | 20+ (each guardian is distinct) |

Roughly 85% of a species' animation comes free. That ratio is what makes the
roster feasible.

## 2. Locomotion

### Blend spaces, not clip switching

Speed and turn rate drive a 2D blend space:

```
        turn rate
            ▲
   turn-L   │   turn-R
            │
  ──────────┼──────────►  speed
   idle  walk  run  sprint
```

A Pokémon accelerating from idle to a run passes smoothly through the space
rather than snapping between clips.

### Foot IK and slope adaptation

Alola is steep. Without foot IK, a Mudsdale on a 30° slope floats or sinks.

- Two-bone IK per limb, targets raycast against the terrain heightfield.
- Hip height adjusts to the lowest contacting foot.
- Body pitch aligns partially to the slope normal — partially, because full
  alignment looks like the creature is glued to the ground.

Terrain height is a pure analytic function, so IK raycasts are a function call
rather than a physics query. That is a direct payoff from the streaming
architecture.

### Root motion policy

**Root motion for authored sequences, in-place for gameplay locomotion.**

Cutscenes, Z-Moves and Totem phase transitions use root motion, because their
exact displacement is authored. Ordinary locomotion is in-place and driven by
the steering system, because AI-driven movement cannot have its displacement
decided by an animator.

Mixing the two is the most common source of sliding feet, so the boundary is
explicit: if the AI decides where it goes, it is in-place.

## 3. Procedural layers

Layered on top of the blend space, in order:

| Layer | Purpose |
|---|---|
| Look-at | Head and eyes track the player or a threat |
| Breathing | Amplitude scales with fatigue |
| Tail and ear secondary motion | Spring-damper, driven by body velocity |
| Foot IK | Terrain adaptation |
| Impact reaction | Additive flinch on damage |
| Emotion overlay | Posture from the AI's dominant need |

The **emotion overlay** is the one that matters most for Pillar 1. The AI
already computes a dominant need; the animation system reads it:

| Dominant need | Posture |
|---|---|
| fear | Crouched, ears back, weight on hind legs |
| aggression | Forward lean, head low, hackles |
| curiosity | Head up and tilted, tail high |
| fatigue | Lowered head, slower blink rate |
| drowsiness | Heavy blinks, occasional stumble |

A player should be able to tell a frightened Growlithe from an angry one at
twenty metres without a UI element. That is the whole point of simulating needs
rather than states.

## 4. Battle animation

Every move has an authored sequence with named phases:

```
anticipation → charge → execute → impact → recovery
```

The **impact** phase is the synchronisation point: damage numbers, hit VFX,
camera shake and the hit reaction on the target all fire from that single
marker, so they cannot drift apart.

Camera work is driven from the same timeline, which is why the battle event
stream and the animation timeline share a clock.

## 5. Z-Move cinematics

Fully authored, with the beat timeline in the content layer
(`packages/data/src/moves/zmoves.ts`) as the contract between design and
engineering.

```
0.0s  pose-closeup       trainer performs the pose
1.2s  orbit-slow         energy gathers
2.4s  sky-wide           storm cell forms          timeScale 0.6
3.4s  low-hero           aura, shake 0.3
4.0s  impact-shake       the strike, shake 1.0     timeScale 0.25
5.2s  aftermath-drift    residue settles
```

The trainer's pose is motion-captured. The Pokémon's charge and execute are
keyframed. The environmental reaction is procedural, resolved against the
arena's actual surface.

`buildCinematic()` rewrites camera beats the arena cannot support — a
`sky-wide` shot inside a cave becomes `low-hero`.

## 6. Facial animation

Two tiers, because uniform quality is unaffordable:

**Tier 1 — story characters** (~20): full FACS blend shapes, phoneme-driven
lip sync, per-scene authored performance.

**Tier 2 — everyone else**: eight emotion blend shapes, procedural blinks,
jaw driven by audio amplitude.

Most Pokémon have no facial rig at all; expression comes from ear, tail and
body posture, which is also how the source material reads.

## 7. Compression

| Track | Method | Error tolerance |
|---|---|---|
| Rotation | Quantised quaternion, 16-bit/channel | 0.1° |
| Translation | Curve fit, removed where static | 0.1mm |
| Scale | Usually constant; dropped entirely | — |

Roughly 85% reduction versus raw keyframes. At thousands of clips this is the
difference between animation fitting in memory and not.

## 8. Authoring workflow

```
Maya / Blender
    ├─ animate against the rig-family skeleton
    ├─ export FBX per clip
    └─ importer:
         ├─ validates skeleton matches the family
         ├─ extracts root motion where flagged
         ├─ detects and marks loop points
         ├─ compresses
         └─ writes the clip manifest
```

Skeleton validation at import is the gate that keeps rig families useful. A clip
authored against a drifted skeleton would deform subtly wrong on every species
in the family, and the failure is hard to spot by eye and easy to catch
automatically.

## 9. What the prototype does

Rigid-bone animation in the vertex shader. Each model is built with up to
twelve bones (root, head, four legs, tail, wings, arms, ear), and each vertex
records which bone it belongs to. Each bone has a pivot, an axis and one of four
motions — walk, sway, flap or none — and the shader rotates it from a
per-instance walk cycle, gait and idle phase
(`packages/render/src/creatures/material.ts`). There are no clips and no
skinning: a herd of forty walking Pokémon is one draw call and zero CPU
animation work. Shadows use a matching depth material so they animate too.

Gait comes from the simulation: the crowd compares a Pokémon's speed with its
species' walking pace and eases between idle, walk and run, and the stride rate
scales with body size. Battle adds lunge, flinch and faint on top, driven by the
turn results. Fliers hover and flap; swimmers sway.

The separation this document asks for holds: the AI writes `position`, `yaw`
and a goal, and animation consumes exactly those. Nothing in `packages/ai`
changed when the models arrived.

A `.glb` dropped in to replace a model can bring real skeletal clips: anything
named *idle*, *walk* or *run* is blended by the same gait.
