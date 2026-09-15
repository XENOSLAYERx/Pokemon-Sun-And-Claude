# 21 — The Game Layer

**Author:** Game Director + Lead Gameplay Programmer
**Status:** Implemented in `packages/game/` (headless rules) and
`apps/client/src/game/` (presentation).

---

## The gap this fills

Before this layer existed, every individual system worked and nothing was a
game. The battle engine could resolve a fight, but nothing decided *whose*
Pokémon was in it. The spawner could place a Pikachu on a hillside, but walking
into it did nothing. The save schema could describe a party that no code ever
produced.

The game layer is the owner of "whose Pokémon is this, and what happens
afterwards".

It splits the same way everything else in this project does:

| | |
|---|---|
| `packages/game` | Rules. Headless, deterministic, 74 tests. Runs in `node --test`. |
| `apps/client/src/game` | Presentation. DOM overlays, 3D staging, input. |

The rules layer knows nothing about Three.js or the DOM. The presentation layer
makes no gameplay decisions — every number it displays comes from the rules,
and every battle message it prints comes from the engine's event stream.

## Movesets are derived, not authored

The species table carries no learnset, and this is deliberate.

Hand-authoring level-up tables for 53 species against a 50-move pool is a few
thousand rows of data that encodes very little design intent, and it rots the
moment a move is retuned or removed. So a moveset falls out of what the species
already *is*:

```ts
export function movesetFor(speciesId: string, level: number): string[]
```

1. The strongest **legal STAB** in each of the species' types, where "legal" is
   a power cap by level.
2. The best **coverage** move of any other type, so no matchup is hopeless.
3. A **status move** if the species suits one and the level justifies it.
4. Fill remaining slots with the next-best coverage.

A move whose category does not match the user's better attacking stat is
discounted, so a physical attacker does not fill a slot with a special move the
AI will then pick.

```ts
export function powerCapForLevel(level: number): number {
  if (level <= 6) return 45;
  if (level <= 12) return 60;
  // …
}
```

Two properties the rest of the game depends on:

- **Deterministic.** The same species at the same level always produces the same
  moveset. A wild Pikachu met twice has the same moves, and a save storing only
  `(species, level)` reconstructs one exactly.
- **Level-appropriate.** A level 5 Rowlet cannot open with Brave Bird. This is
  asserted for every species at every level band.

Ties break on the species hash rather than array order, so two species with
identical stats do not end up as clones.

## Two representations of a Pokémon, on purpose

| | |
|---|---|
| `PartyPokemon` | The persistent form. IVs, experience, friendship, met data. |
| `BattlePokemon` | The transient one. Stages, volatiles, a slot, PP this fight. |

They are different types because stages, volatiles and slots must never reach a
save file. `toBattlePokemon` projects in, `applyBattleResult` writes back.

A party member arrives in a fight carrying its condition — a battle does not
heal you on the way in — and leaves carrying what happened to it.

## Encounters

There are no random encounters. A battle starts one of two ways:

**The player engages.** `engageableTarget` returns the nearest Pokémon within
9m, excluding anything that is asleep, resting or already fleeing. Proximity
alone is not enough: letting the player pull a fight out of a sleeping Pokémon
would make the overworld AI decorative.

**Something engages the player.** `ambusher` looks for an aggressive, apex,
territorial or **protective** species whose AI is actually hunting or attacking
within 14m.

That last temperament is the interesting one. Bewear's temperament is
`protective`, not `aggressive` — which, under the obvious version of this rule,
meant the brief's "extremely strong, protective" Bewear would never have fought
anybody. A protective species defends itself, and like an apex predator it
cannot be outrun once it has decided to.

```ts
export function canFleeFrom(offer: EncounterOffer): boolean {
  if (offer.reason !== 'ambushed') return true;
  const temperament = getSpecies(offer.candidate.speciesId).temperament;
  return temperament !== 'apex' && temperament !== 'protective';
}
```

You can always run from a fight you started. You cannot always run from one
that started itself.

## The battle session

`BattleSession` ties an encounter to the engine and owns the parts the engine
deliberately does not:

- **Party projection** and the write-back afterwards.
- **The opponent's AI**, at `wild` difficulty by default — wild Pokémon play
  badly, on purpose.
- **Balls and running.** Neither is a battle mechanic and both end the
  encounter. Modelling them as engine actions would put capture rates inside
  the thing that has to stay a pure function of `(state, actions, seed)`.
- **The log.** Engine events translated into lines a person can read.

Overworld weather carries into the fight, so a battle in a thunderstorm is a
battle in a thunderstorm. The arena is generated from the ground the player is
standing on, by the terrain probe that reads the same generator the renderer
draws from.

Experience is shared party-wide on one growth curve. The mainline's six curves
exist to pace a linear campaign; in an open world where the player picks their
own route they mostly produce confusion about why one team member is lagging.

Because movesets are derived, a level-up can make a stronger move legal — so
`awardExp` relearns, replacing the weakest move it knows rather than opening a
modal mid-fight.

## Capture

```ts
catchProbability(maxHp, currentHp, catchRate, ballMultiplier, statusMultiplier)
```

The game layer adds what belongs to it rather than to the maths: situational
ball multipliers (a Dusk Ball in daylight is a wasted Dusk Ball), status
multipliers, and the shake animation.

**The shake count derives from the same probability as the outcome**, rather
than being rolled separately:

```ts
const perShake = Math.pow(Math.max(probability, 1e-9), 0.25);
```

Three shakes then a break-out is honest. Three shakes then a catch, after the
game already decided otherwise, is theatre — and players notice.

## The starter's level is not a constant

The first end-to-end playthrough of this game ended in a blackout on the
opening encounter: a level 5 Litten against a level 8 Grubbin.

That was not bad luck. The player starts on a coastline whose spawn table runs
level 3 to 14 with a **median of 8**, and the starter was hardcoded to 5. So
the starter is derived too:

```ts
export function starterLevelFor(nearbyLevels: readonly number[]): number {
  const sorted = [...nearbyLevels].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return clamp(median + 2, 5, 20);
}
```

Slightly above the local median: the first few fights are winnable without
being free, and the top of the local range stays a genuine threat. A regression
test plays out twelve opening fights across twelve seeds and requires at least
nine wins.

## Presentation

**`battle-stage.ts`** places both combatants on the generated arena, oriented
along the axis the player approached from, and frames them with the shared
`frameBattle` helper. Separation scales with the combatants rather than the
arena — a fixed 9m gap reads fine for a Totem and leaves two 0.4m Pokémon as
specks, because the framing then fits the *gap* rather than the fighters. The
camera aims slightly below them so they sit clear of the action dock, and eases
across from wherever exploring left it rather than cutting.

**`battle-ui.ts`** is keyboard-first with the mouse as an equal alternative. The
player sees exact HP for their own Pokémon and a percentage for the opponent's —
knowing the wild Pokémon's precise HP would make the decision to throw a ball
mechanical rather than a judgement call.

The **Z-Move pose** is a short directional sequence inside a timing window. The
display counts matched inputs with the same forgiving rule `evaluatePose` uses,
so what the player sees cannot disagree with what they score. A fumbled pose
still delivers 85% power: a once-per-battle resource lost to a missed input
feels terrible.

A hard timeout backs up the `requestAnimationFrame` loop, because rAF is
throttled in a background tab and a battle must never be left sitting in the
pose screen forever.

## Saving

`SaveManager` already owned the write protocol — temp key, verify, promote,
keep a backup. The client supplies a `LocalStorageAdapter` and one rule:

**A throw is not "no save exists".** localStorage throws in a private window and
when the quota is full, and a save system that treats that as an empty slot
silently deletes people's games. The adapter rejects, and the menu says so.

Autosave runs every two minutes **in the overworld only**. A save written
mid-battle restores into a world with no battle in it and a party whose HP came
from halfway through one.

## What the frame loop does

```
clock.advance(...)   fixed 60Hz simulation
  environment          always — the sun moves and the sea runs during a battle
  actors               overworld only — the player and the AI freeze
updateEncounters()   once per FRAME, not per tick
updateStreaming()    once per frame; no new spawns during a battle
render()             the stage owns the camera while a battle is staged
updateHud()
updateAutosave()
```

Encounter checks run per frame rather than per tick for the same reason
streaming does: the clock runs up to four catch-up steps in a frame, and a
per-tick check starts the same battle twice.

## Verification

74 tests in `packages/game/test/game.test.ts`, covering movesets for every
species at every level band, experience and level-up, the battle round trip,
bag semantics, capture probability ordering, encounter and flee rules, the full
profile save round trip, and complete battles played to a conclusion — including
that the same seed and inputs reproduce a battle exactly.

Driven end to end in a real browser (Playwright + SwiftShader), **zero page
errors**: boot, new game, party HUD, engage prompt, a battle fought to a win,
a capture, the pause menu, a save, and a reload that restores the run.

## Not done

- **No trainer battles.** The session handles one wild opponent. Trainer teams,
  multi battles and Totem encounters are supported by the engine below and have
  no entry point above.
- **No quest integration.** `QuestJournal` is created and persisted with the
  profile, but nothing in the world advances an objective yet.
- **Evolution is not implemented.** Pokémon level up and relearn; they do not
  evolve.
- **No shops, no healing stations.** "Rest" in the menu is a placeholder for a
  Pokémon Centre.
- **No art.** Every Pokémon is a capsule coloured by its primary type.
