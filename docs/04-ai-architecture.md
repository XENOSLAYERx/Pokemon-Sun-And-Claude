# AI Architecture

**Document owner:** Senior AI Engineer
**Status:** Implemented. 66 tests in `packages/ai/test/ai.test.ts`.

---

## 1. The problem

Pillar 1 of the creative vision says the world must not wait for the player.
That translates into a concrete engineering requirement:

> Tens of thousands of Pokémon must each pursue their own goals, react to each
> other and to the player, and remember what happened — within roughly 2ms of
> frame budget.

The measured result: **0.33µs per agent per tick** (0.068ms for 208 agents in
the headless harness). That leaves room for an order of magnitude more agents
than we will ever have in range.

## 2. The central decision: utility picks, trees execute

This is the architecture's load-bearing choice.

**A pure behaviour tree** requires every priority decision to be expressed as
node ordering. That works until a creature must weigh hunger against fear
against curiosity against territorial aggression, at which point the tree
becomes an unmaintainable thicket of guard conditions and the ordering encodes
priorities nobody can read.

**A pure utility system** is excellent at "which goal?" and poor at "then what?"
— multi-step sequences like *find cover → path to it → hide → peek* are
awkward to express as scores.

So we use each for what it is good at:

```
        world state
             │
             ▼
   ┌─────────────────────┐
   │   Utility scorer    │   "Which goal?"      ← every decision tick
   │  14 goals scored    │
   └──────────┬──────────┘
              │ winning goal
              ▼
   ┌─────────────────────┐
   │   Behaviour tree    │   "How do I do it?"  ← resumable across ticks
   └──────────┬──────────┘
              │ steering intent
              ▼
   ┌─────────────────────┐
   │  Steering / boids   │   "Where does my body go?"
   └─────────────────────┘
```

## 3. The pipeline

```
 Perception ──► Needs ──► Facts vector ──► Utility ──► Goal ──► Steering
      │           ▲                                      │
      │           │                                      │
      └──► Memory ┘                                      ▼
           (affinity, fear of places)              Behaviour tree
```

### 3.1 Perception (`perception/senses.ts`)

Answers "what does this Pokémon currently know about?" using the spatial hash,
so cost is O(neighbours) rather than O(world).

Two properties matter:

**Perception is imperfect, and that is the design.** Sight is cone-limited by
the species' `fovHalfAngle` and degrades with distance and angle. Hearing is
omnidirectional but scales with how much noise the target makes. A player who
approaches quietly from behind a Growlithe is genuinely unnoticed — stealth is
a real mechanic, not a stat check.

```ts
// Sight: in range AND within the field of view.
if (distance <= sightRange) {
  const angle = Math.acos(dirX * facingX + dirZ * facingZ);
  if (angle <= species.fovHalfAngle) {
    seen = true;
    clarity = clamp01(rangeFactor * angleFactor);
  }
}

// Hearing: omnidirectional, but scaled by the target's noise.
if (!seen && distance <= hearingRange) {
  const audible = hearingRange * (0.25 + other.noise * 0.75);
  if (distance <= audible) clarity = clamp01((1 - distance / audible) * 0.45);
}
```

**Unseen threats are more frightening, not less.** A threat that is heard but
not seen has its threat level multiplied by 1.25. Rustling in the undergrowth
should be worse than a visible predator, because it is.

### 3.2 Needs (`memory/needs.ts`)

Seven continuous drives: hunger, fatigue, fear, aggression, curiosity,
sociability, drowsiness. All 0–1, all decaying toward species-specific resting
values.

The decay rates are what give a species its character, and they are derived
from one designer-facing field — `temperament`:

| Temperament | Fear decay | Base aggression | Base curiosity |
|---|---|---|---|
| timid | 0.018 (slow) | 0.02 | 0.08 |
| curious | 0.045 | 0.08 | **0.72** |
| territorial | 0.045 | **0.42** | 0.18 |
| apex | **0.20** (fast) | **0.80** | 0.15 |

A timid species stays frightened long after the threat leaves. An apex predator
shrugs it off almost immediately. That single asymmetry produces most of the
felt difference between a Wingull and a Bewear.

One detail worth calling out:

```ts
export function applyFear(needs: Needs, intensity: number): void {
  needs.fear = clamp01(Math.max(needs.fear, intensity));
  // Fear suppresses curiosity IMMEDIATELY. Without this, a startled Pikachu
  // keeps walking toward the thing that startled it, which reads as broken.
  needs.curiosity = clamp01(needs.curiosity * (1 - intensity * 0.7));
}
```

### 3.3 Memory (`memory/memory.ts`)

Each individual keeps a bounded ring of episodes and a small map of
relationships. Bounded is essential: with tens of thousands of agents we cannot
afford unbounded history, and what survives should be exactly what matters —
strong impressions and repeated contact.

Design choices that make relationships feel right:

- **Negative outweighs positive.** `attacked` is −0.5; `fed` is +0.22. One
  attack costs more than two berries. This matches how animals actually learn
  and stops a player undoing hostility cheaply.
- **Strangers have no opinion, not a bad one.** `affinityToward` returns 0 for
  an unknown subject.
- **Familiarity gates affinity.** A strong opinion from someone met once is not
  trusted: disposition uses `affinity × (0.35 + familiarity × 0.65)`.
- **Bad places are remembered, not just bad actors.** An intense negative
  episode writes an avoidance marker at its location, which steering treats as
  repulsive. A Pokémon attacked in a clearing starts giving that clearing a
  wide berth.

### 3.4 Utility scoring (`utility/scorer.ts`)

Each goal is scored from considerations. Three details make it work:

**Response curves, not raw values.** Each consideration passes through a named
curve — `logistic`, `bell`, `threshold`, `inverse-quadratic`. "Fear matters a
little until it matters enormously" is a curve, not a constant.

**Multiplicative, not additive.** Scores multiply, so a goal whose precondition
is absent scores zero rather than limping along on its other terms. This is what
prevents the classic bug where a starving creature with no food nearby picks
"eat" and stands still.

**Per-consideration complexity compensation.** Plain multiplication punishes
goals for being well specified: five considerations at 0.6 multiply to 0.078, so
a nuanced goal could never beat a lazy two-consideration one. The fix (from Dave
Mark's utility work) lifts each term toward 1 in proportion to the goal's size
*before* multiplying:

```ts
const modificationFactor = 1 - 1 / n;
for (const c of goal.considerations) {
  const value = evaluateCurve(c.curve, c.input(facts));
  if (value <= 0) return { score: 0 };          // zero still kills the goal
  const makeUp = (1 - value) * modificationFactor;
  product *= value + makeUp * value;
}
```

We shipped this applied once at the end instead of per-consideration, and a
test caught it: a five-consideration goal scored 0.135 where it should score
0.31, which made every carefully-specified goal unselectable.

**Commitment bonus.** The active goal receives a bonus (default 0.12), so two
goals scoring 0.51 and 0.50 do not alternate every tick. Goal-flicker is the
single most common way emergent AI reads as broken.

### 3.5 The goal library (`utility/goals.ts`)

Fourteen shared goals: `flee`, `attack`, `defend-territory`, `protect`, `hunt`,
`forage`, `sleep`, `rest`, `investigate`, `greet`, `regroup`, `return-home`,
`wander`, `play`.

Shared is the point. Every species draws from the same set, which keeps
behaviour coherent across the dex instead of each species being a special case.
A profile then biases priorities.

### 3.6 Species profiles (`profiles/profiles.ts`)

The brief names six species with specific behaviour. Each maps to concrete
profile values:

| Species | Brief says | Implementation |
|---|---|---|
| **Pikachu** | curious, playful, social | `investigate ×1.6`, `play ×1.5`, `greet ×1.4`, flock 0.75, 0.25s decisions |
| **Bewear** | extremely strong, protective | `protect ×2.2`, cohesion **60m**, pursuit **160m**, fear sensitivity 0.25 |
| **Sharpedo** | aggressive predator | **no `flee` goal at all**, `hunt ×1.8`, pursuit 140m |
| **Lapras** | peaceful | **neither `flee` nor `attack`**, `greet ×1.5` |
| **Wingull** | travel in flocks | flock weight **1.0**, `regroup ×2.0`, 0.2s decisions |
| **Growlithe** | guard territories | `defend-territory ×1.9`, `return-home ×1.6`, pursuit < territory radius |

Note what "aggressive predator" and "peaceful" mean mechanically: Sharpedo's
profile omits `flee` from its goal list entirely, so no combination of fear and
damage can make it retreat. Lapras omits both `flee` and `attack`, so it simply
continues on its way regardless. These are not tuned probabilities — they are
structural.

Bewear's 60m cohesion radius is what produces the encounter the brief implies:
a Stufful flees *toward* its Bewear (its own profile biases `regroup` to 1.6),
and the Bewear, aware across a whole clearing, crosses the route to intercept.

### 3.7 Steering (`flock/boids.ts`)

Reynolds separation/alignment/cohesion plus seek, flee, arrive, pursue, evade,
wander, obstacle avoidance and territory containment.

Two details:

**Neighbour cap of 7.** Reynolds observed a boid only needs ~7 neighbours for
the flock to look right. Capping turns a dense 40-member Wingull colony from
O(n²) into O(n).

**Priority truncation, not weighted sum.** Forces are applied in order until
the accumulated magnitude saturates:

```ts
for (const { force, weight } of forces) {
  if (remaining <= 0) break;
  const applied = Math.min(V3.length(force) * weight, remaining);
  V3.addScaled(out, V3.normalize(force), applied, out);
  remaining -= applied;
}
```

A weighted sum lets a soft force (drift toward the flock) average away a
critical one (do not walk off the cliff). Truncation lets the critical force
genuinely dominate.

**Wander is a moving point on a projected circle**, not a per-tick random
direction. Re-randomising each tick produces jitter no amount of smoothing
fixes; the circle produces the lazy meander real animals have.

### 3.8 Behaviour trees (`bt/tree.ts`)

Resumable: a node returning `Running` is resumed next tick from the same
position, so a chase spans seconds without re-walking the tree.

Per-agent state is held in `WeakMap`s keyed by the agent, so one tree
definition is shared by every agent of a species with no cross-talk — verified
by a test that runs two agents through one tree and asserts their positions
stay independent.

`timeout` and `guard` decorators exist specifically so a stuck pursuit always
terminates. An AI that can deadlock will.

## 4. Simulation LOD

| Tier | Range | Perception | Decisions | Steering | Needs |
|---|---|---|---|---|---|
| Full | <60m | every tick | every 0.2–0.7s | full | yes |
| Reduced | 60–180m | ⅓ rate | ⅓ rate | full | yes |
| Coarse | 180–500m | none | none | drift toward home, 2s | yes |
| Dormant | >500m | none | none | none | **no** |

Dormant agents advance nothing, including needs. Advancing hunger while the
player spends twenty minutes on another island would have every distant Pokémon
starving on their return.

Per-agent tick offsets stagger decisions. Without the stagger, LOD produces the
same total work as a periodic spike instead of a flat cost — measured as a
26.5ms peak that became 3.1ms once staggering and per-frame streaming were in
place.

## 5. The ecosystem layer

Above individual AI, a coarse Lotka–Volterra model per (island, biome) region
(`world/src/ecology/population.ts`), ticking every few in-game minutes.

Order within a tick is deliberate: **harvest pressure → predation → growth →
migration.** Applying growth before predation would let a heavily-hunted prey
species paper over the loss within the same tick and mask the player's impact
entirely.

The loop closes: population level feeds back as a spawn weight multiplier, so
hunting a route bare genuinely thins it out, and migration from neighbouring
regions refills it over time rather than a respawn timer.

## 6. Testing emergent behaviour

Emergence is hard to test, so we test the mechanisms and the invariants:

- **Mechanisms:** curves are bounded and correctly shaped; a zero consideration
  kills a goal; commitment prevents flicker; a frightened creature will not
  sleep; fear suppresses curiosity.
- **Profiles against the brief:** Sharpedo has no flee goal; Lapras has
  neither flee nor attack; Wingull's flock weight is 1.0; Growlithe's pursuit
  range is less than its territory radius.
- **Integration:** a Wingull near a Sharpedo flees *and moves away*; a hungry
  Sharpedo near prey hunts and never flees; a bonded Pokémon is not afraid of
  a high-level player.
- **Stability:** 60 agents × 900 ticks, asserting no NaN and every need in
  range. Plus the headless harness over 6 in-game hours.

What we cannot unit-test is whether the result is *interesting*. That is what
the behaviour distribution readout in the headless simulation is for, and
ultimately what playtesting is for.
