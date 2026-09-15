# Project Alola — Creative Vision

**Document owner:** Creative Director
**Status:** Living document
**Last revised:** Milestone 0

---

## 1. The one-sentence pitch

*Alola is a place you live in, not a place you pass through.*

Everything below is downstream of that sentence. When a decision is contested,
the question is always: does this make the world feel more inhabited, or does
it make the game more convenient?

## 2. What we are actually making

A single-player-first open world, built from the Alola archipelago at roughly
four times its original scale, in which every Pokémon is a visible creature
with a life of its own rather than an encounter roll waiting to happen.

The reference points the brief names — Sun & Moon, Legends Arceus, Scarlet &
Violet, Breath of the Wild, Xenoblade, Monster Hunter — are not a shopping
list of features to copy. They are a triangulation of one specific feeling:

| Source | What we are taking | What we are *not* taking |
|---|---|---|
| Sun & Moon | Trials over gyms, island identity, tone | Linear route-to-route pacing |
| Legends Arceus | Overworld catching, observable behaviour | Its sparse, functional world dressing |
| Scarlet & Violet | Free island order, ride traversal | Its performance compromises |
| Breath of the Wild | Reward for looking at the horizon | Weapon durability, survival systems |
| Xenoblade | Vertical vistas, a world with a skyline | Its combat model |
| Monster Hunter | Ecosystems where creatures interact | Grind-gated progression |

## 3. The three pillars

### Pillar 1 — A world that does not wait for you

The single most important technical and creative commitment in this project:
**Pokémon behave whether or not you are looking at them.**

A Sharpedo hunts a Wishiwashi school because it is hungry, not because the
player walked into a trigger volume. A Growlithe barks a warning at its
territory boundary and disengages when you leave, because it has a territory
and a boundary. A Bewear crosses a route to reach a threatened Stufful because
it has a cohesion radius of sixty metres and a protection drive.

None of those are scripted. They fall out of the needs model, the perception
system and the utility scorer interacting. (See `docs/04-ai-architecture.md`.)

**The test:** stand still for two minutes on any route. If nothing happens
that you did not cause, the pillar has failed.

### Pillar 2 — Seamless by construction, not by trickery

No loading screens between areas. No hidden corridors that stall you while a
zone loads. No "fast travel only" island transitions.

This is an architectural commitment, not an optimisation target. The terrain
is a pure function of position, so any chunk can be generated on any thread in
any order and discarded for free. Battles generate their arena from the ground
you are standing on rather than loading a battle scene. Ocean travel between
islands is real traversal over real water with real weather.

**The test:** sail from Melemele to Akala without the frame rate changing and
without a single loading indicator.

### Pillar 3 — Spectacle that respects the player

Z-Moves, Totem fights and legendary encounters are the peaks the whole game is
shaped around. They should be overwhelming.

But spectacle must never punish. A fumbled Z-Move pose still delivers 85% of
its power — the flourish is a reward for engagement, never a tax on failing to
engage. A Totem's phases are telegraphed so escalation reads as drama rather
than as the game changing the rules.

**The test:** a player who misses every input prompt should still find the
Z-Move exhilarating.

## 4. Tone

Alola is warm, but it is not safe.

The islands are beautiful and the people are welcoming, and there is a
Guzzlord at the bottom of Resolution Cave that has eaten a mountain. Both
things are true. The tonal target is a real tropical place: genuinely
hospitable, genuinely dangerous at the edges, with a culture that has organised
itself around both facts.

Concretely, this means:

- **Towns feel lived in, not staffed.** NPCs have schedules and go home.
- **Wildness is graded, not gated.** Poni is dangerous from the shoreline
  inward. Nothing stops you sailing there at level 10; the Kommo-o will.
- **The trials are religious, not athletic.** They are an island tradition with
  meaning attached, not an obstacle course with a badge at the end.
- **Ultra Beasts are wrong, not strong.** The horror is that they do not obey
  local physics, not that they have high stats.

## 5. The player fantasy

> *You arrived on these islands a few weeks ago. You have walked most of one of
> them. You know which beach the Wingull nest on, you know the Growlithe that
> guards the ridge path and you know how far you can push it before it means
> the warning, and you have a Pikachu that follows you because you have fed it
> twenty times and it remembers.*

Note what is absent from that fantasy: nothing about being the strongest, and
nothing about completion. Power and completion are systems we support well.
They are not the fantasy.

## 6. What we are explicitly not doing

Stated up front so they do not creep back in:

- **No open-world checklist map.** Icons are earned by observation, not
  granted by climbing a tower.
- **No survival systems.** No hunger, no temperature damage, no equipment
  durability. The Pokémon have needs; the player does not.
- **No forced multiplayer.** Every online system is additive. The complete
  story and the full Pokédex are reachable offline.
- **No timed exclusivity.** Live events add; they never gate.
- **No monetised progression.** Cosmetics only, if anything.

## 7. Success criteria

We will consider the creative vision met if, at launch:

1. Players share stories about Pokémon behaviour we did not script.
2. Screenshots people post are of the world at least as often as of combat.
3. The most-replayed moments are trials and legendary encounters.
4. Players can describe the personality of a species without reading the dex.
5. Nobody asks where the loading screens went, because they never noticed.

Criterion 1 is the one that matters most. Every other criterion can be bought
with production budget. That one can only be earned with systems design.
