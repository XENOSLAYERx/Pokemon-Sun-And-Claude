# Production Roadmap

**Document owner:** Game Director
**Horizon:** 42 months from vertical slice to launch.

---

## 1. Where we are

**Milestone 0 is complete.** The technical foundation exists and is verified:
twelve packages, 553 passing tests, a browser-verified client, a self-tested
authoritative server, and a content pipeline reporting zero errors.

Everything below is forward-looking and therefore an estimate. The numbers in
Milestone 0's column are measured; every other number is a projection and should
be read as one.

## 2. Phases

```
 M0  Foundation         ████ complete
 M1  Vertical slice     ░░░░░░░░░  6 months
 M2  First playable     ░░░░░░░░░░░░  8 months
 M3  Content production ░░░░░░░░░░░░░░░░░░  14 months
 M4  Alpha              ░░░░░░  5 months
 M5  Beta               ░░░░░  4 months
 M6  Launch             ░░░░  3 months
 M7  Live               ongoing
```

## 3. Milestone 0 — Foundation *(complete)*

**Goal:** prove the architecture before committing content budget to it.

| Deliverable | Status |
|---|---|
| Deterministic simulation core | ✅ 42 tests |
| Content layer with validation | ✅ 42 tests, 0 errors |
| Terrain, streaming, weather, ocean, ecology | ✅ 60 tests |
| Pokémon AI: perception, needs, memory, utility, flocking | ✅ 66 tests |
| Battle engine, Z-Moves, Totems, arena, AI | ✅ 62 tests |
| Quest graph, save migrations, netcode | ✅ 65 tests |
| Audio director, render pipeline, UI state | ✅ 83 tests |
| Runnable client, server, content pipeline, headless sim | ✅ verified |

**What it proved.** The headless simulation runs 6 in-game hours with 208 agents
at 0.068ms/tick with zero NaN. The server holds 0.81ms against a 50ms budget.
The client boots, streams and simulates in a browser with zero page errors.

**What it found.** Streaming to the horizon wasted 80% of chunk budget;
per-tick budgets were spent 4× per frame; terrain sampling did five redundant
island tests; a LOD table mismatch silently disabled streaming; towns and ruins
were empty by day; a questline was gated behind an unreachable flag.

Finding those now, before content production, is the entire point of M0.

## 4. Milestone 1 — Vertical slice *(6 months)*

**Goal:** one route, one town, one trial, at shipping quality. If it is not fun
here, more content will not fix it.

| Workstream | Deliverable |
|---|---|
| Art | Final-quality Melemele Route 1, Iki Town, 12 Pokémon |
| Animation | Two rig families complete; foot IK; emotion overlay |
| Gameplay | Overworld catching, party, ride Tauros |
| Combat | Battle wired into the world, seamless transition |
| Trials | Verdant Cavern end to end with the Totem fight |
| Audio | One island theme with all six stems; 12 cries |
| UX | HUD, party, bag, Pokédex rendered |
| Tech | Chunk generation on a Worker; terrain shader wired |

**Exit criteria**

1. 60fps at 1080p on the reference GPU, 60fps at 1280×800 on Steam Deck.
2. Twenty external playtesters complete the trial.
3. At least half of them describe a Pokémon behaviour we did not script.
4. No loading screen anywhere in the slice.

Criterion 3 is the one that decides whether the AI investment was correct.
Failing it means re-scoping the pillar, not adding more content.

## 5. Milestone 2 — First playable *(8 months)*

**Goal:** all of Melemele, plus the systems that make an island a place.

- Melemele complete: both towns, all routes, both trials, Tapu Koko
- 60 Pokémon
- NPC daily schedules
- Quest system with 40 authored quests
- Character creator shipped
- Save/load with cloud sync
- Ecosystem visibly affected by play over a session

**Exit criteria:** eight hours of continuous play with no hard blockers; the
ecosystem measurably responds to player behaviour in telemetry.

## 6. Milestone 3 — Content production *(14 months)*

The long stretch. Content scales; systems mostly do not change.

| Quarter | Focus |
|---|---|
| Q1 | Akala complete, three trials, 120 Pokémon |
| Q2 | Ula'ula complete, two trials, 200 Pokémon |
| Q3 | Poni, Aether Paradise, main story complete |
| Q4 | Ultra Space, post-game, 300+ Pokémon, online |

**The risk this milestone carries** is that systems work gets pulled in as
content authors hit limitations. The mitigation is that M1 and M2 exist to
surface those limitations first; a system change in M3 costs three times what
the same change costs in M1.

## 7. Milestone 4 — Alpha *(5 months)*

Feature complete. No new systems, no new content.

- Full playthrough possible start to post-game
- All 300+ Pokémon with final art and animation
- Online: trading, ranked, raids, guilds
- Localisation pass 1 (8 languages)
- Performance pass against all target platforms
- Accessibility audit against the commitments in `06-ui-architecture.md`

## 8. Milestone 5 — Beta *(4 months)*

Content complete and locked. Bugs only.

- External beta, 10,000 players
- Server load testing at 10× projected peak
- Certification submissions
- Balance from live telemetry

## 9. Milestone 6 — Launch *(3 months)*

Gold master, day-one patch, launch window support.

## 10. Live operations

| Cadence | Content |
|---|---|
| Weekly | Ranked rotation, world events |
| Monthly | New quests, cosmetics, raid bosses |
| Quarterly | A competitive season, a new Ultra Space region |
| Annually | A major content expansion |

## 11. Team shape

| Discipline | M1 | M2 | M3 | M4 | M5 |
|---|---|---|---|---|---|
| Engineering | 12 | 16 | 22 | 22 | 16 |
| Art | 8 | 18 | 40 | 30 | 12 |
| Animation | 4 | 8 | 16 | 12 | 5 |
| Design | 6 | 10 | 18 | 16 | 10 |
| Audio | 2 | 4 | 8 | 6 | 3 |
| QA | 2 | 6 | 14 | 26 | 30 |
| Production | 3 | 4 | 6 | 6 | 5 |
| **Total** | **37** | **66** | **124** | **118** | **81** |

QA scaling from 14 to 26 at alpha is deliberate. Alpha is where an open world
either gets tested properly or ships with a reputation it keeps for years.

## 12. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pokémon art volume overruns | High | High | Shared rig families; palette-swap shinies; strict budgets |
| AI feels random rather than alive | Medium | Critical | M1 exit criterion 3 gates further investment |
| Streaming hitches on a low-end drive | Medium | High | Worker offload in M1; measure on the slowest target |
| Content authoring bottlenecks on engineering | High | Medium | Everything data-driven; validator catches errors early |
| Netcode desync in ranked | Medium | High | Lockstep battles; server re-simulates every ranked match |
| Scope growth from "just one more system" | **Very high** | High | M3 is content-only; system changes need Director sign-off |

The last row is the one that actually kills projects of this size. The
architecture is deliberately data-driven so that "more content" and "more
systems" are separable decisions, and the roadmap is structured so the second
one becomes progressively harder to make.

## 13. What would change this plan

Stated explicitly, so it is a plan rather than a wish:

- **M1 exit criterion 3 fails.** The AI pillar is the project's biggest bet. If
  playtesters do not notice emergent behaviour, we cut the ecosystem simulation
  to a simpler spawn system and reinvest in authored content.
- **Steam Deck cannot hold 60fps at medium.** We drop the target to 40fps
  locked rather than shipping an unstable 60.
- **Pokémon art throughput misses by more than 20%.** We cut the roster rather
  than the polish. 300 species that feel alive beats 600 that do not.
