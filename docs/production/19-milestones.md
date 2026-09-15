# Milestones and Gates

**Document owner:** Game Director
**Companion to:** `18-roadmap.md`

---

## How a gate works

A milestone is not complete when the work is done. It is complete when the
**exit criteria** are met and signed off by the named owner. Criteria are
written before the milestone starts, and are not renegotiated during it.

If a criterion cannot be met, the correct responses are: cut scope, extend the
milestone, or change the criterion **with a written rationale**. Quietly
shipping a missed criterion is how a project loses the ability to plan.

---

## M0 — Foundation ✅ complete

**Owner:** Lead Gameplay Programmer

| # | Criterion | Result |
|---|---|---|
| 1 | Simulation runs headless with no rendering dependency | ✅ 504 tests, no browser |
| 2 | Terrain is deterministic and streamable | ✅ verified across generators |
| 3 | AI produces distinct behaviours at scale | ✅ 208 agents, 8 goal types observed |
| 4 | Battle engine is deterministic | ✅ identical event logs per seed |
| 5 | Content validates with zero errors | ✅ 0 errors, 0 warnings |
| 6 | Client runs in a browser | ✅ zero page errors |
| 7 | Server holds tick budget | ✅ 0.81ms of 50ms |

**Measured baselines** — the numbers future milestones regress against:

| Metric | Value |
|---|---|
| AI cost | 0.068ms/tick for 208 agents (0.33µs each) |
| Server tick | 0.81ms mean, 31.9ms peak (cold start) |
| Loaded chunks | 621 within 3.6km |
| Far terrain | 5 draw calls, 242k triangles |
| `terrain.sample` | 6.15µs |
| Content bake | 135 KB in 26ms |
| Client bundle | 158 KB game + 522 KB Three.js |
| Test suite | 504 tests, ~1.7s |

---

## M1 — Vertical slice

**Owner:** Game Director
**Gate date:** Month 6

| # | Criterion | Measurement |
|---|---|---|
| 1 | 60fps @ 1080p on reference GPU | 95th percentile frame time ≤ 16.6ms over 30 min |
| 2 | 60fps @ 1280×800 on Steam Deck | Same, on hardware |
| 3 | 20 external testers complete the trial | Session recordings |
| 4 | ≥ 50% describe unscripted Pokémon behaviour | Post-session interview |
| 5 | No loading screen in the slice | Observation |
| 6 | Streaming causes no frame spike > 33ms | Telemetry |
| 7 | Chunk generation runs off the main thread | Code review |

**Criterion 4 is the project's hinge.** It is the only criterion that, if
failed, changes the shape of the whole game rather than the schedule.

---

## M2 — First playable

**Owner:** Game Director
**Gate date:** Month 14

| # | Criterion |
|---|---|
| 1 | Melemele complete: 2 towns, all routes, 2 trials, Tapu Koko |
| 2 | 60 Pokémon with final art, animation and AI profiles |
| 3 | 8 hours continuous play with no hard blocker |
| 4 | NPC schedules observable across a full day cycle |
| 5 | Ecosystem response measurable in telemetry over one session |
| 6 | Save/load survives every migration from v1 |
| 7 | Character creator ships with the full option set |

Criterion 5 is measured concretely: a tester who clears a route of one species
should see its spawn weight drop and its neighbours' rise, visible in telemetry
within a single session.

---

## M3 — Content production

**Owner:** Producer
**Gate date:** Month 28 — reviewed quarterly

| Quarter | Gate |
|---|---|
| Q1 | Akala complete, 3 trials, 120 Pokémon |
| Q2 | Ula'ula complete, 2 trials, 200 Pokémon |
| Q3 | Poni + Aether complete, main story playable end to end |
| Q4 | Ultra Space, post-game, 300+ Pokémon, online functional |

**Standing rule for M3:** no new systems. A system change requires written
Director sign-off naming what content it unblocks and what it costs.

---

## M4 — Alpha

**Owner:** Producer
**Gate date:** Month 33

| # | Criterion |
|---|---|
| 1 | Feature complete — nothing unimplemented remains |
| 2 | Full playthrough start to post-game |
| 3 | All species with final art, animation and cries |
| 4 | Online: trading, ranked, raids, guilds functional |
| 5 | 8 languages at 100% |
| 6 | All platforms hold their frame target |
| 7 | Accessibility audit passed against every stated commitment |
| 8 | Crash-free session rate ≥ 99% |

---

## M5 — Beta

**Owner:** QA Lead
**Gate date:** Month 37

| # | Criterion |
|---|---|
| 1 | Content locked |
| 2 | 10,000-player external beta completed |
| 3 | Server load tested at 10× projected peak |
| 4 | Zero open severity-1 or severity-2 bugs |
| 5 | Certification submitted on all platforms |
| 6 | Crash-free session rate ≥ 99.5% |
| 7 | Ranked desync rate < 0.1% of matches |

Criterion 7 is the one lockstep battles exist to make achievable, and the one
that would justify reworking netcode if missed.

---

## M6 — Launch

**Owner:** Producer
**Gate date:** Month 40

| # | Criterion |
|---|---|
| 1 | Gold master certified on all platforms |
| 2 | Day-one patch built and certified |
| 3 | Server capacity provisioned at 3× projected peak |
| 4 | Support and moderation staffed |
| 5 | Rollback plan rehearsed |

---

## Standing quality bars

Enforced continuously, not at gates. A build violating any of these does not
merge.

| Bar | Threshold |
|---|---|
| Frame time | 95th percentile ≤ target |
| Hitches | No frame > 100ms in normal play |
| Memory | Under platform budget with 20% headroom |
| Load to playable | < 15s from launch |
| Save | < 500ms, never blocking a frame |
| Content validation | Zero errors |
| Test suite | 100% passing |
| Type checking | Zero errors, strict mode |

## Telemetry that drives decisions

| Metric | Decision it informs |
|---|---|
| Frame time percentiles per region | Where to optimise |
| Streaming hitch frequency | Chunk budget tuning |
| Deaths per route | Difficulty curve |
| Trial attempt counts | Totem balance |
| Species encounter rates | Spawn table balance |
| Quest abandonment | Which quests are unclear |
| Session length by island | Where the game loses people |
| Ecosystem population drift | Whether the model is stable over months |

The last one is unusual and worth keeping: a Lotka–Volterra system that is
stable over a test run can still drift over a thousand hours of real play, and
the only way to know is to watch it.
