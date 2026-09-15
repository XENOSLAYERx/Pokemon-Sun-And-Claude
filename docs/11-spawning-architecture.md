# Pokémon Spawning Architecture

**Document owner:** Senior AI Engineer + Game Director
**Status:** Implemented in `packages/world/src/ecology/`.

---

## 1. Requirements

From the brief: all Pokémon visible in the overworld, no random encounters,
weather-dependent spawning, time-dependent spawning, rare alphas, shinies
visible in the world, pack behaviour, and migration.

The hard part is not any one of those. It is that they must all **compose** —
weather × time × biome × island × altitude × story progress — without becoming
a combinatorial thicket of special cases.

## 2. Two properties that define the design

### 2.1 Deterministic per chunk

A chunk's population is a pure function of `(worldSeed, chunkCoords,
conditions)`. Walk away, come back, and the same Yungoos is in the same
clearing — because we **re-derive** it, not because we stored it.

```ts
const rng = rngForCell(worldSeed, cx, cz, `spawn:${hourBucket}`);
```

This is what makes a 40km world's wildlife free to persist. Storing every wild
Pokémon's position would be hundreds of megabytes; deriving them is a function
call.

### 2.2 Conditions are captured at spawn, not re-checked

A Pokémon that spawned in rain does **not** vanish when the rain stops. It
lives out its life; it is simply not re-rolled.

Nothing breaks immersion faster than wildlife popping out of existence because
a cloud moved.

## 3. Declarative spawn entries

Every spawn rule is a data row. Conditions are all optional and all AND-ed:

```ts
{
  species: 'PIKACHU',
  weight: 14,
  levelRange: [10, 18],
  biomes: ['tropical-forest', 'meadow'],
  weather: ['thunderstorm'],
  weatherBonus: 3,          // ×3 weight when the weather matches
  alphaChance: 0.06,
}
```

Scoring is one pure function:

```ts
export function scoreSpawnEntry(entry: SpawnEntry, cond: SpawnConditions): number {
  if (!entry.biomes.includes(cond.biome)) return 0;
  if (entry.islands?.length && !entry.islands.includes(cond.island)) return 0;
  if (entry.hours?.length && !entry.hours.includes(Math.floor(cond.hour) % 24)) return 0;
  if (entry.altitude && outOfBand(cond.altitude, entry.altitude)) return 0;
  if (entry.requiresFlag && !cond.flags.has(entry.requiresFlag)) return 0;

  let weight = entry.weight;
  if (entry.weather?.length) {
    if (!entry.weather.includes(cond.weather)) return 0;
    weight *= entry.weatherBonus ?? 1;
  }
  return weight;
}
```

Keeping this pure means the spawner, the "what can I find here?" UI (Scanner
Lens), and the content validator all agree **by construction** rather than by
three implementations happening to match.

### Why a weather bonus rather than just permission

`weatherBonus` multiplies weight when the condition is met. Without it, a
storm-gated entry is merely *allowed* during a storm and competes on equal
terms. With a ×3 bonus, a thunderstorm genuinely feels like the right time to
hunt Pikachu — the rare condition is rewarding, not just permissive.

## 4. Placement

The spawner picks candidate points, classifies the biome there, scores
eligible entries, rolls one, and then **validates placement against movement
class**:

```ts
switch (movement) {
  case 'swimmer':    return underwater || aquatic;
  case 'amphibious': return true;
  case 'flyer':
  case 'floater':    return true;   // placed above whatever is below
  case 'burrower':   return !underwater && slope < 0.6;
  default:           return !underwater && slope < 0.95;
}
```

Without this, a Magikarp appears on a cliff face. The content validator
independently enforces that no swimmer is even *listed* in a non-aquatic biome,
so the runtime check is a second line of defence rather than the only one.

## 5. Packs

Pack species spawn as groups sharing a `packId`, scattered 3–14m around a
leader. The AI's flocking and `regroup` goal then keep them together.

`packSize` is per species: Wingull `[6, 16]`, Wishiwashi `[12, 40]`, Bewear
`[1, 1]`. A lone Wingull would be as wrong as a herd of Bewear.

## 6. Individual variation

Every individual derives from a single **personality value** — one 32-bit
integer — plus its species. That is deliberate: it means an individual is fully
described by two fields for netcode and save purposes.

| Property | Derivation |
|---|---|
| Level | Uniform in the entry's `levelRange` |
| Alpha | `entry.alphaChance`, adds +3–8 levels |
| Shiny | **Isolated RNG stream** (see below) |
| Size | Gaussian σ=0.045, or ×1.25–1.55 if alpha |
| Gender | Species `genderRatio` |

### Shiny rolls get their own stream

```ts
const shinyRng = new Rng(hashCombine(personality, 0x5417, cx, cz));
const shiny = shinyRng.odds(1, odds);
```

This is not incidental. If shiny rolls drew from the shared chunk stream, then
adding a single new random call anywhere in spawning would shift every shiny
outcome in the game. Shiny hunters would notice within hours, and would be
right to be angry. An isolated stream means spawning logic can evolve freely.

`odds(1, 4096)` uses exact integer rejection sampling rather than a float
comparison, so the rate is exactly 1/4096 with no accumulated bias.

## 7. Alphas

Oversized, higher level, and — because `temperament` drives AI — behaviourally
distinct. An alpha Bewear is not merely a bigger Bewear; its size scale feeds
the AI profile and the battle system's Totem-adjacent scaling.

Alpha chance is per-entry, so designers can make alphas common in dangerous
places (Guzzlord 40%, Kommo-o 25%) and rare on starter routes (Rowlet 4%).

## 8. Time-of-day bucketing

The population re-rolls on a **3-hour bucket**, not continuously:

```ts
const hourBucket = Math.floor(hour / 3);
const rng = rngForCell(worldSeed, cx, cz, `spawn:${hourBucket}`);
```

Continuous re-rolling would churn the population every simulated second.
Bucketing makes dawn and dusk feel like *transitions* rather than noise, and
keeps a chunk stable for a meaningful stretch of play.

## 9. The ecosystem feedback loop

The spawn table says what *can* appear. The ecosystem model
(`ecology/population.ts`) modulates how much.

A coarse Lotka–Volterra system per (island, biome) region, ticking every few
in-game minutes:

```
harvest pressure → predation → growth → migration
```

The order is deliberate. Applying growth before predation would let a
heavily-hunted prey species recover within the same tick and mask the player's
impact entirely.

```ts
export function spawnMultiplier(regionId: string, speciesId: string): number {
  const pop = this.populations.get(regionId)?.get(speciesId);
  return lerp(0.15, 1.8, clamp01(pop.level / 2) ** 0.8);
}
```

Hunt a route bare and it thins out. Stop, and migration from neighbouring
regions refills it — not a respawn timer, but neighbours flowing down the
population gradient. Verified in tests: a region stripped by 30 rounds of
harvesting recovers measurably over 150 idle ticks when a neighbour is present.

This also generates content: `depletedIn()` and `overpopulatedIn()` drive
research quests and cull bounties respectively.

## 10. Story gating

`requiresFlag` keeps content sealed until the story opens it. Ultra Beasts are
gated behind `ultra_access`; a test asserts they never leak into the overworld
without it, across every island.

Wormhole leakage — Ultra Beasts appearing in the overworld during an aurora —
is expressed as ordinary spawn entries with `weather: ['aurora']` and
`requiresFlag: 'ub_mission_start'`. No special-case code.

## 11. Density and budget

| Setting | Value |
|---|---|
| Target per chunk | 7 |
| Hard cap per chunk | 24 |
| Placement attempts | 6× target before giving up |

The attempt cap matters: in a biome where most candidate points fail placement
validation (a cliff face, a lake edge), an uncapped loop would spin.

## 12. Content-hole detection

The validator flags any walkable biome with no unconditional spawns in each
3-hour window. This caught two real holes:

- **Towns and cities had only nocturnal entries.** A player standing in Iki
  Town at 8am saw an empty world. The server self-test found this
  independently, reporting zero wildlife.
- **Ruins had only nocturnal entries.** Visiting a Tapu shrine by day found
  nothing at all.

Genuinely-empty biomes are declared rather than suppressed:

```ts
const INTENTIONALLY_GATED = {
  facility: 'Pokémon here are contained, not wild',
  'ultra-space': 'gated behind ultra_access until the story opens it',
};
```

An exemption someone can disagree with in review, rather than a warning people
learn to scroll past.

## 13. Server-side differences

The server spawns from a **3×3 chunk neighbourhood** around each player, not
just their own chunk. Standing in a town or on a dock otherwise means an empty
world when that single chunk's biome has nothing eligible at the current hour.

It also caps wildlife at `players × 50` and retires agents beyond 800m, so
simulation cost scales with player count rather than with world size.
