# Combat Architecture

**Document owner:** Combat Designer + Lead Gameplay Programmer
**Status:** Implemented. 62 tests in `packages/battle/test/battle.test.ts`.

---

## 1. Requirements

From the brief: seamless transition, no loading screens, dynamic camera, arenas
generated from the current location, single/double/multi/royale/online/ranked
formats, and animation quality rivalling modern RPGs.

Underneath those is one engineering requirement that shapes everything:

> The same battle must produce the same result on the client (for prediction)
> and on the server (for authority), and must be storable as a seed plus an
> input log rather than a state dump.

## 2. The engine is a pure function

```
(state, actions, seed) ──► BattleEngine ──► (state', events[])
```

Nothing in `packages/battle` touches rendering, audio or the DOM. The engine
emits a typed event stream:

```ts
type BattleEvent =
  | { type: 'move-used'; userId; moveId; targetIds; isZMove }
  | { type: 'damage'; targetId; amount; effectiveness; critical; remaining }
  | { type: 'totem-phase'; pokemonId; phase; name; description }
  | { type: 'z-power'; userId; zMoveId; poseHit }
  | { type: 'arena-event'; event; radius }
  /* ...28 event types */
```

The renderer, the audio director, the battle log and the netcode all consume
the same stream. They cannot disagree about what happened, because there is
only one account of it.

## 3. Damage calculation

`packages/battle/src/calc/damage.ts` implements the mainline formula with its
integer truncation points preserved **in order**:

```ts
const levelTerm = Math.floor((2 * attacker.level) / 5) + 2;
let base = Math.floor(Math.floor((levelTerm * power * attack) / defense) / 50) + 2;

base = Math.floor(base * spreadMod);      // 0.75 when hitting multiple targets
base = Math.floor(base * weatherMod);     // rain/sun × 1.5 or × 0.5
base = Math.floor(base * terrainMod);     // × 1.3 for matching terrain
base = Math.floor(base * critMod);        // × 1.5
base = Math.floor(base * randomMod);      // 85–100%, uniform over 16 integers
base = Math.floor(base * stab);           // × 1.5, or × 2 with Adaptability
base = Math.floor(base * typeEffectiveness);
base = Math.floor(base * burnMod);        // × 0.5 physical, unless Guts
```

**Why the order is not negotiable.** Each `Math.floor` discards a fraction.
Reordering two multiplications changes the result by 1–2 HP. That is enough for
the competitive community to notice, and — more seriously — enough to desync a
client's prediction from the server's authority mid-battle.

The comment in the source says "do not simplify" for exactly this reason.

### Details that are easy to get wrong

- **Immunity short-circuits.** Type effectiveness is checked first and returns
  `immune: true` with 0 damage, so callers emit the correct message instead of
  silently dealing nothing.
- **Crits ignore unfavourable stages only.** A critical hit discards the
  attacker's *negative* offensive stages and the defender's *positive*
  defensive ones. It cannot be made worse by debuffs, but it does not discard
  the attacker's own buffs.
- **Trick Room inverts Speed but not priority.** Wrong in a surprising number
  of implementations.
- **Multi-hit uses the canonical 2–5 distribution** (35/35/15/15), not a
  uniform roll.

A bug the type checker caught here: the fixed-damage branch was unreachable,
so Nature's Madness dealt 1 damage instead of halving the target's HP.

## 4. Turn structure

```
1. Collect actions for every active Pokémon
2. Resolve switches and items        ← always before moves
3. Sort moves: priority → speed → deterministic tiebreak
4. Execute each move
     ├─ canAct()  flinch, sleep, freeze, paralysis, confusion
     ├─ PP, Z-Move conversion, target selection
     ├─ Protect, accuracy
     ├─ Damage (× hits), drain, recoil
     └─ Secondary effects
5. End of turn
     ├─ Weather damage and timers
     ├─ Status residuals (Toxic ramps n/16)
     ├─ Item healing
     ├─ Clear single-turn volatiles
     └─ Side and field timers
6. Check faints, check battle end
```

The tiebreak is drawn from the battle's own RNG rather than `Math.random`, so
replays reproduce turn order exactly.

## 5. Arena generation

Battles have no scenes to load. An arena is a description of the ground the
player is already standing on, captured at encounter time.

```ts
export function generateArena(probe: TerrainProbe, request: ArenaRequest): BattleArena
```

It searches outward in rings for the flattest nearby ground, scoring each
candidate on average slope, maximum slope and height variance.

**Why this matters more than it sounds:** staging a cinematic Z-Move on a
40-degree slope puts the camera underground and the Pokémon sliding. Nudging
the arena four metres to level ground is invisible to the player and fixes
both. The arena also shrinks on difficult terrain rather than clipping through
it, and grows on water where there is more open space.

The arena records its **surface** (`ground`/`water`/`sand`/`snow`/`rock`/
`foliage`/`metal`/`lava`), which is what resolves Z-Move environmental
reactions — see below.

**Camera rig** is chosen from the arena's shape, not the battle type, so the
same trainer battle looks different on a beach and in a cave:

| Rig | When | Character |
|---|---|---|
| `open-field` | Default | Wide orbit, high angles available |
| `enclosed` | Cave, indoors | Tight orbit, no sky shots |
| `aquatic` | Water surface | Surface-level, waves in frame |
| `cliff` | Coastal cliff, canyon | Uses the drop |
| `confined` | Radius < 9m | Mostly close-ups |

## 6. Z-Moves

A Z-Move is three things at once, and the data model serves all three: a battle
effect, an authored cinematic, and a player performance.

### The cinematic

Authored as a beat timeline in `packages/data/src/moves/zmoves.ts`:

```ts
beats: [
  { at: 0.0, camera: 'pose-closeup',    sfx: 'z/charge_start' },
  { at: 1.2, camera: 'orbit-slow',      vfx: 'z/electric_gather' },
  { at: 2.4, camera: 'sky-wide',        vfx: 'z/storm_cell', timeScale: 0.6 },
  { at: 3.4, camera: 'low-hero',        vfx: 'z/electric_aura', shake: 0.3 },
  { at: 4.0, camera: 'impact-shake',    vfx: 'z/gigavolt_beam', shake: 1.0, timeScale: 0.25 },
  { at: 5.2, camera: 'aftermath-drift', vfx: 'z/arc_residue' },
]
```

This is the contract between design and engineering: the combat designer
authors timings here; the presentation layer plays them without knowing which
Z-Move it is.

`buildCinematic()` resolves the timeline against the actual arena. A
`sky-wide` beat inside a cave becomes `low-hero`, because pointing the camera
at a two-metre ceiling is worse than not moving it at all.

### Environmental reactions

Declared per surface, resolved against the real arena:

```ts
environment: [
  { surface: 'sand',    effect: 'vitrify', radius: 9,  duration: -1 },
  { surface: 'ground',  effect: 'scorch',  radius: 12, duration: -1 },
  { surface: 'water',   effect: 'shatter', radius: 16, duration: 6 },
  { surface: 'foliage', effect: 'scorch',  radius: 14, duration: -1 },
]
```

Gigavolt Havoc vitrifies beach sand into glass, and does nothing at all to
Aether Paradise's metal floor. Declaring reactions rather than scripting them
is what makes this work in *any* arena the world generates.

### The pose

The player physically performs the pose. Design constraints, in priority order:

1. **A miss must never feel like a punishment.** A completely missed pose still
   delivers 85% power. The flourish rewards engagement; it does not tax failing
   to engage.
2. **A slip must not void the sequence.** A wrong input is ignored rather than
   resetting progress.
3. **The window must be generous.** 1.5–2.8 seconds, validated by the content
   validator, which errors on anything tighter.

| Rating | Requirement | Power |
|---|---|---|
| Perfect | Full sequence, even rhythm | ×1.10 |
| Great | Full sequence | ×1.00 |
| Good | ≥ half the sequence | ×0.95 |
| Missed | Less than half | ×0.85 |

One Z-Move per side per battle, enforced by the engine and tested.

## 7. Totem encounters

The brief asks for "giant cinematic boss fights", not a scaled-up wild Pokémon.
Three mechanics deliver that, all data-driven from the trial definitions.

**The aura.** A Totem enters with stat stages already raised, announced as a
visible event. The fight starts from a losing position, which reframes it as
something to overcome.

**Phases.** Crossing an HP threshold triggers a named phase with its own boosts
and an arena event:

```ts
phases: [
  { atHpPercent: 1.0,  name: 'Solo',        description: 'One small fish, absurdly overconfident.' },
  { atHpPercent: 0.8,  name: 'School Form', description: 'The pool erupts...',
    arenaEvent: 'water_rise', boosts: { atk: 2, spa: 2 } },
  { atHpPercent: 0.3,  name: 'Breaking',    description: 'The school frays at the edges...',
    arenaEvent: 'whirlpool', boosts: { spe: 2 } },
]
```

Phases are checked on every damage application, so a single large hit enters
only the **deepest** phase reached rather than queueing three cutscenes. That
is tested explicitly.

**SOS allies.** Called once each at their thresholds, turning a single battle
into a sustained encounter that pressures resources rather than HP.

A design note on `registerTotem`: it sets the engine's `isTotem` flag itself.
We previously had two sources of truth, which left a registered Totem with a
phase table that never ran.

## 8. Battle AI

Difficulty is expressed as **what the opponent knows and does**, not as a stat
bonus. A Youngster genuinely does not think about type matchups; a Kahuna does,
and will switch. That reads as a skill difference rather than as cheating.

| Difficulty | Optimality | Type matchups | Switches | Status | Items |
|---|---|---|---|---|---|
| wild | 0.35 | no | no | no | no |
| novice | 0.50 | no | no | no | no |
| trainer | 0.70 | yes | no | yes | yes |
| ace | 0.85 | yes | yes | yes | yes |
| captain | 0.90 | yes | yes | yes | yes |
| kahuna | 0.95 | yes | yes | yes | yes |
| champion | 1.00 | yes | yes | yes | yes |

One-ply lookahead with good heuristics, deliberately not a deep search. A full
minimax over Pokémon battles is both expensive and produces an opponent that
feels inhuman. With probability `optimality` the AI takes its best action;
otherwise it samples weighted from the top three — producing a *plausible*
mistake rather than a random one, which is what makes a loss feel fair.

Damage estimates suppress the random roll (`noRandom: true`) so the AI reasons
about the expected case rather than getting lucky in its own head.

Switching requires a substantial improvement (threat delta > 0.35) before it
will spend a turn, because switching for marginal gain reads as indecisive.

**Wild Pokémon can flee.** A Wingull that loses interest and leaves is more
believable than one that fights to the death — and it connects the battle
system back to the overworld AI's temperament model.

## 9. Formats

| Format | Slots/side | Notes |
|---|---|---|
| single | 1 | |
| double | 2 | Spread moves lose 25% per target |
| multi | 2 | Two trainers per side, one Pokémon each |
| royale | 1 | Four independent sides |
| totem | 1 vs 1+SOS | Phases and aura active |
| raid | 1 vs 4 | Boss with a shield mechanic |

Sides are a list, not a pair, so royale required no engine change.

## 10. Netcode

Battles are **lockstep**, not state-replicated. Both clients run the same
deterministic engine from the same seed, so only inputs cross the wire.

A battle is therefore a few hundred bytes rather than a state stream, and
cheating by state injection is impossible — a client can only send an action,
and the server validates it against the same rules.

This is also why `battle_record` in the database stores `(seed, teams, input
log)`: a replay is re-simulated, not played back, which is roughly a 1000×
storage saving.
