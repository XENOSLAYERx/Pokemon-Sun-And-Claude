# TDD-06 — Netcode

**Author:** Senior Network Engineer
**Status:** Implemented in `packages/net/` (protocol, interest management,
client prediction, interpolation) and `apps/server/src/world-server.ts`.

---

## Requirement

Alola is a shared world. Players see each other roaming the same islands, the
same wild Pokémon, the same weather. On top of that sit battles, trades and
co-op raids. The constraints:

- **Movement must feel local.** Any input latency on the player's own character
  is unacceptable, at any ping.
- **Other players must not jitter.** Rubber-banding reads as "the game is
  broken" far more strongly than being 100ms behind reads as "laggy".
- **Battles must not desync**, ever.
- **Bandwidth must fit a phone.** A player on cellular is a normal player.
- **The server is the authority.** A client that says "I am at the summit with
  a shiny Solgaleo" is not to be believed.

## Design: server-authoritative with client prediction

```
client                                     server (20Hz)
  │ simulate own movement immediately        │
  │ send {seq, dt, move, yaw, actions} ─────►│ simulate authoritatively
  │                                          │ gather interest set
  │◄──────── snapshot {tick, ackSeq, deltas} │
  │ rewind to authoritative state            │
  │ replay every input after ackSeq          │
  │ blend residual error over smoothingTime  │
```

The client never waits for the server to move. It applies its own input through
`MovementSimulator` — the *same function* the server runs — and records the
input in a pending list. When a snapshot arrives with `ackSeq`, the client
resets to the server's state and re-applies every unacknowledged input.

If prediction and authority agree, replay lands on the same position and
nothing visible happens. When they disagree:

```ts
snapThreshold   // beyond this, snap — the prediction is hopeless
smoothingTime   // below it, blend the error out over this many seconds
maxPending      // bound on retained unacknowledged inputs
```

Small corrections are blended into the *visual* position while the predicted
position is already correct, so the player sees a nudge instead of a teleport.
Large corrections snap, because smoothing a 30-metre error looks worse than
admitting it.

Sharing one `MovementSimulator` between client and server is what keeps the
correction rate near zero. Two implementations of "how fast does a Sharpedo
accelerate" will diverge; there is only one.

## Remote entities: interpolation, not prediction

Other players and wild Pokémon are rendered with `EntityInterpolator`, which
holds a small buffer of snapshots and renders slightly in the past. Predicting
other people's movement produces confident, wrong motion that must then be
corrected — visible as rubber-banding. Rendering 100ms behind produces motion
that is always smooth and always slightly stale. Stale is cheaper.

## Interest management: distance bands with budgets

```ts
export const DEFAULT_BANDS: readonly InterestBand[] = [
  { maxDistance:  60, interval:  1, budget: 40 },
  { maxDistance: 160, interval:  3, budget: 30 },
  { maxDistance: 400, interval: 10, budget: 20 },
  { maxDistance: 900, interval: 30, budget: 10 },
];
```

At a 20Hz tick: everything within 60m updates every tick; the 900m band updates
every 1.5s. Distant wildlife is therefore *present and roughly correct* when the
camera pans across a valley, without costing per-tick bandwidth.

Entities are gathered per band, filtered by their update interval, filtered
again by `version` so unchanged entities are skipped entirely, then truncated to
the band budget with the closest kept.

**Players bypass the budget.** During development they did not: the gather loop
used `break` when the budget was exhausted, so a player standing behind forty
Wingull was never replicated to their friend. The fix is `continue` plus an
explicit player exemption — a two-character bug with a "my friend is invisible"
symptom.

The spatial index is a `SpatialHash` rebuilt once per server tick, so a gather
is a handful of cell lookups rather than a scan over every entity in Alola.

## Delta encoding

```ts
export interface EntityDelta {
  id: number;
  fields: number;      // bitmask of DeltaField
  // …only the named fields follow
}
```

The server sends only fields that changed since the client's acknowledged
baseline, and `version` filtering means an entity that did not move is not sent
at all — which is most of the saving at distance, because Dormant-tier agents
do not move.

**Measured, from `--selftest`:** 4 clients, 200 wildlife, 400 ticks at 20Hz —
**28.5 entities per snapshot, 51.6 KB/s per client**. That figure is *every*
message the server emits, serialised as **uncompressed JSON**, which is the
honest number for what exists today.

The design target is well under that: a binary codec over the same `fields`
bitmask replaces per-field JSON keys and float text with packed bytes, and is
where the sub-10 KB/s budget for a mobile connection comes from. **That codec is
not written.** It belongs with the transport layer, which is also not written
(see *Not done*). Quoting the target as though it were measured would be the
kind of number that gets a milestone signed off and then missed.

`PROTOCOL_VERSION` exists as an explicit constant precisely because this
encoding will change: a mismatched client is rejected at `hello` rather than
left to misparse a bitmask.

## Battles are lockstep, not replicated

A battle does not stream state. Both clients run the identical deterministic
engine from `TDD-05` with a server-issued seed, and only **actions** cross the
wire:

```
server → battle-start {battleId, seed, format, participants}
client → battle-action {battleId, turn, action}
server → battle-turn   {battleId, turn, actions[]}
```

A battle is therefore a few hundred bytes rather than a state stream, and
**cheating by state injection is impossible** — there is no state to inject.
The server validates that an action is legal for that trainer on that turn;
everything else follows from determinism.

This is also why the determinism work in `TDD-01` and `TDD-05` is not academic.
Lockstep is only safe on top of an engine that genuinely cannot diverge.

## Server-side simulation

`apps/server/src/world-server.ts` runs the same world simulation as the client
— terrain, weather, time of day, spawning, AI — from the same seed, headless.
No Three.js, no DOM. This is enforced by the presentation boundary described in
`docs/01-architecture.md`: no package below `@alola/render` may import a
rendering dependency, so the server physically cannot pull one in.

A `--selftest` mode boots the world, ticks it, and asserts wildlife actually
spawned. It caught a real bug: the server sampled spawn tables for a town chunk
at 08:00, the town had only nocturnal entries, and the world came up with zero
Pokémon in it. The fix was both a wider sample (3×3 chunks) and daytime
town/city/ruins spawn entries — the selftest was the only thing that would have
noticed, because "quiet town" and "broken spawner" look identical.

## Verification

`packages/net/test/net.test.ts`:

- Prediction with no correction leaves the visual position untouched.
- A small correction blends out over `smoothingTime`; a large one snaps.
- Replay after `ackSeq` reproduces the predicted position exactly.
- Pending inputs are bounded by `maxPending`.
- Interpolation never overshoots and never runs ahead of the buffer.
- Interest bands include near entities every tick and far entities on interval.
- Unchanged entities are skipped by version.
- **A player past the budget is still replicated** (the `break`/`continue` bug).
- Entities leaving interest produce removals exactly once.
- Latency tracking converges on a stable RTT estimate.

## Not done

- **No transport, and no binary codec.** The protocol, interest management and
  prediction are complete and tested; the WebSocket/WebTransport layer that
  carries them is not written, and neither is the packed encoder that turns the
  measured 51.6 KB/s of JSON into the sub-10 KB/s design target. Messages are
  typed and serialisable, so this is plumbing — but it is plumbing that does
  not exist.
- **No lag compensation for battles** — not needed, since battles are lockstep
  and turn-based.
- **No anti-cheat beyond authority.** Movement is validated for plausibility;
  there is no statistical cheat detection.
- **No matchmaking, no persistence of shared world state across restarts.**
