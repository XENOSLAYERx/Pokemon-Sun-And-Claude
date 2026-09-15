# Quest Architecture

**Document owner:** Game Director
**Status:** Implemented in `packages/quest`. 18 tests.

---

## 1. Quests are graphs, not checklists

An objective becomes available when all of its dependencies complete. A quest
can therefore fan out into parallel tasks and converge again.

```
       meet-hala
           │
      climb-trail
           │
     rescue-cosmog
           │
        bridge
```

versus a branching side quest:

```
        ask
         │
       track
         │
       find
         │
      decide ──┬─► fight     → outcome-fight
               ├─► retreat   → outcome-retreat
               └─► distract  → outcome-distract
```

This is what lets one rescue offer three genuinely different solutions with
three different reputation consequences, rather than a single correct path with
flavour text.

## 2. Event-driven, not polled

With thousands of side quests, asking each one every frame whether it cares is
untenable. Instead an index maps `(objective kind, target)` to interested
quests:

```ts
signal({ kind: 'photograph', target: 'WINGULL', count: 8 }, now);
// → one map lookup → only the quests with an active matching objective
```

The index is rebuilt for a quest whenever its available objectives change,
which is rare relative to how often signals fire.

## 3. Optional objectives never block completion

```ts
for (const objective of quest.objectives) {
  if (objective.optional) continue;      // ← the important line
  if (!prog.objectives.get(objective.id)?.complete) return;
}
this.complete(questId, now);
```

This is the single most common source of permanently stuck quest logs in
shipped games: a bonus task that nobody realises is gating the reward. Excluding
optionals from the completion check is one line, and it is tested.

## 4. Timers only run when the objective is reachable

```ts
const isAvailable = (objective.requires ?? []).every(
  (dep) => prog.objectives.get(dep)?.complete,
);
if (!isAvailable) { state.availableAt = now; continue; }
```

A timed escort objective must not expire while it is still locked behind an
earlier step. Tested by letting 1,000 seconds pass with the objective locked
and asserting the quest is still active.

## 5. Reputation

Ten factions: four islands, plus kahunas, captains, researchers, Aether,
wildlife and Skull.

```
hostile  disliked  neutral  accepted  respected  honoured  kamaʻāina
 -1000      -50        0        50        150       300        500
  ×1.5      ×1.2     ×1.0      ×0.95     ×0.9      ×0.85      ×0.8
```

Deliberately asymmetric: falling out of favour is faster than earning it back,
hostility has real consequences (vendors refuse service), and high standing
gives **access** rather than raw power.

Reputation that only ever discounts potions is not worth tracking. The tiers
that matter gate content.

The `wildlife` faction is the most interesting one. Fighting a Bewear to
retrieve a child's Stufful costs 15 wildlife reputation; backing away gains 20;
distracting it with a berry gains 15 *and* pays the best reward. The quest
rewards cleverness over force without ever saying so.

## 6. Procedural quests

Authored quests are one source; the same schema also drives generated ones.

The ecosystem model produces the hooks:

```ts
ecology.depletedIn(regionId)       // → research quest: "numbers are down"
ecology.overpopulatedIn(regionId)  // → cull bounty
```

Because generated quests use the same `QuestDefinition` shape, the runtime does
not know or care which kind it is driving.

Template families: rescue, research, treasure hunt, mystery investigation,
legendary clue, Ultra Beast sighting, delivery, escort, photography.

## 7. Trials are quests with extra structure

A trial is a staged mini-dungeon ending in a Totem fight. Stages are data:

```ts
stages: [
  { id: 'enter',    kind: 'cinematic', objective: 'Meet Ilima at the cavern mouth.' },
  { id: 'find-dens', kind: 'gather',   objective: 'Search three Pokémon dens.',
    params: { target: 'den', count: 3 } },
  { id: 'ambush',   kind: 'battle',    objective: 'Survive the den ambushes.' },
  { id: 'totem',    kind: 'boss',      objective: 'Defeat the Totem Gumshoos.' },
]
```

The trial runner drives objectives, gates, camera moves and music transitions
from this table alone, so a new trial is authored rather than programmed.

The validator enforces that every trial ends in a `boss` stage and that its
Totem's phases descend monotonically from full HP.

## 8. Story flags

A single global string set. Quests gate on them; spawn entries gate on them;
clothing unlocks gate on them.

The validator checks **flag reachability**: a quest gated behind a flag that no
quest reward sets is dead content. This caught a real one — `story_act3` gated
the entire Ultra Beast arc, and nothing set it, so that questline was
unreachable. A `main-05-aether-summit` quest now produces it.

## 9. Persistence

```ts
{ quests: { [id]: { status, objectives, outcome, startedAt, completedAt } },
  reputation: { [faction]: number },
  flags: string[] }
```

Restore skips quests that no longer exist in the content, so a save survives a
patch that removes one. Tested.

## 10. Soft-lock prevention

The test suite drives **every shipped quest** to completion mechanically:

```ts
for (const quest of allQuests()) {
  for (const flag of quest.requiresFlags ?? []) journal.setFlag(flag);
  journal.start(quest.id, 0);
  while (journal.statusOf(quest.id) === 'active') {
    for (const objective of journal.availableObjectives(quest.id)) {
      if (objective.optional) continue;
      journal.signal({ kind: objective.kind, target: objective.target, ... });
    }
  }
  assert.equal(journal.statusOf(quest.id), 'complete');
}
```

A quest whose objectives cannot all be satisfied is a soft-lock waiting to
happen. This test makes that a build failure rather than a support ticket.
