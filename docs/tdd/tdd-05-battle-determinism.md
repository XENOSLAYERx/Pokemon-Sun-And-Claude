# TDD-05 — Battle Engine Determinism

**Author:** Combat Designer + Lead Gameplay Programmer
**Status:** Implemented in `packages/battle/src/engine/engine.ts`,
`packages/battle/src/engine/state.ts`, `packages/battle/src/calc/damage.ts`.

---

## Requirement

The battle engine is the one system in the game where being *approximately*
right is worse than useless. Three consumers demand exactness:

1. **Online play.** Battles are lockstep: only inputs cross the wire. If two
   clients disagree by one damage point, the battle desynchronises and the
   match is lost for both players.
2. **Replays and spectating.** A battle is stored as `(seed, action list)`.
   Playing it back must reproduce it exactly, forever.
3. **Player trust.** Anyone who has played the mainline games knows what a
   Waterfall from a Level 55 Sharpedo into a Bewear does. If our number differs,
   the game feels wrong in a way players will not be able to articulate but will
   absolutely notice.

## Design: a pure function over `(state, actions, seed)`

```ts
export class BattleEngine {
  readonly state: BattleState;
  private readonly rng: Rng;        // seeded once, never reseeded
  private events: BattleEvent[] = [];

  executeTurn(actions: readonly BattleAction[]): BattleEvent[]
}
```

The engine touches nothing outside itself: no clock, no `Math.random`, no
renderer, no audio, no DOM. Everything it wants the rest of the game to know
comes out as a typed `BattleEvent[]`:

```ts
export type BattleEvent =
  | { type: 'turn-start'; turn: number }
  | { type: 'move-used'; ... }
  | { type: 'damage'; ... }
  | { type: 'faint'; ... }
  | { type: 'z-move'; ... }
  | ...
```

The renderer, the audio director, the battle log and the netcode all read the
*same* event stream. There is exactly one source of truth about what happened,
so the log can never disagree with the animation.

## Turn structure

```
1. Collect actions for every active Pokémon
2. Resolve switches and items      (always before moves)
3. Sort move actions by priority, then effective Speed
4. Execute each move, re-checking the user can still act
5. End-of-turn residuals: weather, status, item healing, field timers
6. Faint checks and battle-end checks
```

Step 4's re-check is the subtle one. A Pokémon that was alive when the turn was
ordered may have fainted before its move resolves; the engine must skip it
rather than let a fainted Pokémon attack. This is precisely the bug class the
ECS's generational handles guard against in the overworld, appearing again in a
different form — worth stating twice because it costs a match when it slips.

`maxTurns` defaults to 300 and forces a draw past it, so a stall team cannot
hang the server.

## Truncation order is the specification

The mainline damage formula is *not* one multiplication chain. It applies
integer truncation at specific points, and moving a truncation changes results
by one point often enough to matter:

```ts
const levelTerm = Math.floor((2 * attacker.level) / 5) + 2;
let base = Math.floor(Math.floor((levelTerm * power * attack) / Math.max(1, defense)) / 50) + 2;

base = Math.floor(base * spreadMod);       // doubles/spread
base = Math.floor(base * weatherMod);
base = Math.floor(base * terrainMod);
base = Math.floor(base * critMod);
base = Math.floor(base * randomMod);       // 85..100 / 100
base = Math.floor(base * stab);
base = Math.floor(base * typeEffectiveness);
base = Math.floor(base * burnMod);
// …then move-specific and item modifiers, each truncated in turn
```

Each `Math.floor` is load-bearing. The implementation deliberately reads as a
sequence of statements rather than one expression, because the expression form
invites a "simplification" that silently reorders the truncations.

Stat computation follows the same discipline:

```ts
Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * natureMod)
```

Nature is applied *after* the +5 and truncated once — not folded into the inner
term.

## The RNG

A single `Rng` seeded from `EngineOptions.seed`, advanced only by the engine's
own rolls, in a fixed order per turn: accuracy, then critical, then damage
roll, then secondary effects. Because the order is fixed and the stream is
never shared with anything outside the battle, the same seed and the same
actions reproduce the same battle on any machine, in any JS engine, at any
frame rate.

Overworld systems use `rng.fork(label)` to get their own streams (see
`TDD-01`), so a Pikachu deciding to nap in the background cannot shift a
battle's damage roll.

## Type effectiveness

A flat `Float32Array` of 18×18 multipliers indexed as `attack * 18 + defend`.
Not a nested object map: the flat array is a single cache line fetch and, more
importantly, cannot accumulate floating-point drift from repeated object
lookups being combined in a different order.

## Formats

`BattleFormat = 'single' | 'double' | 'multi' | 'royale' | 'totem' | 'raid'`.
The engine is format-agnostic — a format is a side/slot layout plus a target
resolution rule, not a separate code path. `spreadMod` in the damage chain and
`opponentsOf()` in the state module are the only places format is consulted.

## Totem battles

`registerTotem()` attaches phase definitions to a Pokémon **and sets
`isTotem = true`**. That flag is what the turn loop checks before running
`applyTotemPhases()`. During development the flag was set only by the spawner
and not by `registerTotem`, so registered Totems ran no phases at all and
fought as ordinary Pokémon — a silent failure with no error, found only by a
test asserting phase transitions fire.

Phases fire on HP thresholds and can change weather/terrain, summon allies,
raise stats and swap movesets mid-fight, which is what makes a Totem read as a
boss rather than a large Pokémon.

## Z-Moves

`packages/battle/src/zmove/cinematic.ts` turns a Z-Move into a beat list —
pose, camera, VFX, environmental reaction, impact — with the damage resolved by
the same deterministic path as any other move. The cinematic is *derived from*
the result, never the other way round: presentation cannot alter the outcome.

## Verification

63 assertions in `packages/battle/test/battle.test.ts`, including:

- Identical `(seed, actions)` produces byte-identical event streams.
- Different seeds diverge.
- Damage matches hand-computed mainline values for known matchups.
- STAB, criticals, weather, terrain and burn each move damage in the right
  direction by the right proportion.
- Type immunity yields exactly zero (Electric into Ground-type Mudbray).
- Quad-effective and quarter-resisted matchups return 4 and 0.25 (asserted
  against the type chart itself in `packages/data/test/data.test.ts`).
- Priority beats Speed; Speed breaks ties; Trick Room inverts.
- Fixed-damage moves ignore the damage chain entirely: Nature's Madness removes
  exactly half the target's current HP at attacker levels 5, 50 and 100, and
  reports effectiveness 1. This is the branch that was briefly unreachable and
  made the move deal 1 damage instead of halving HP.
- Totem phases fire at their thresholds and apply their effects.
- A battle that cannot end is declared a draw at `maxTurns`.

## Not done

- **Ability coverage is partial.** The abilities that change damage or turn
  order are implemented; many situational abilities are not.
- **No full move-effect coverage.** 50 moves are modelled in detail; the long
  tail of mainline effects (multi-turn charge/recharge interactions, some
  two-turn semi-invulnerability edge cases) is not.
- **No battle-state serialisation.** Replays are `(seed, actions)`, which is
  smaller and cannot desync, but means a battle cannot be resumed from the
  middle without replaying it.
