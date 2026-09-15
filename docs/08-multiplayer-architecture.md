# Multiplayer Architecture

**Document owner:** Senior Network Engineer
**Status:** Simulation and protocol implemented in `packages/net` and
`apps/server`. Transport layer not written.

---

## 1. Constraints

1. **Single-player is complete without it.** Every online system is additive.
   The full story and the full Pokédex are reachable offline.
2. **The server is authoritative.** Anything affecting another player is
   decided server-side.
3. **Input latency must be zero.** A player's own movement can never wait for a
   round trip.
4. **Bandwidth must survive a mobile connection.** Target under 10 KB/s per
   client for overworld play.

Constraints 2 and 3 are in direct tension. Resolving that is most of this
document.

## 2. Server-authoritative with client prediction

```
Client                                    Server
──────                                    ──────
apply input locally      ─── input ───►   simulate authoritatively
(zero latency)            seq: 1042
    │                                          │
    │                     ◄── snapshot ───     │
    │                     ackSeq: 1039         │
    ▼
snap to server state
replay inputs 1040–1042
smooth the residual error
```

Three parts, each necessary:

**Predict.** Apply input immediately, keep it in a pending buffer.

**Reconcile.** On a snapshot, snap to the authoritative state and replay every
input the server had not yet processed.

**Smooth.** Never teleport on a small correction. Carry the difference as an
error and blend it out:

```ts
if (correction > this.snapThreshold) {
  // A large divergence means something genuinely different happened —
  // a collision we missed, a teleport. Show it honestly.
  this.snaps++;
  V3.copy(this.visual.position, this.predicted.position);
} else {
  // Small correction: blend it out so the visible position never jumps.
  V3.sub(this.visual.position, this.predicted.position, this.error);
  this.errorRemaining = this.smoothingTime;
}
```

The threshold split is the important part. Blending *everything* hides genuine
divergence and makes desync invisible until it is severe. Snapping everything
makes ordinary jitter feel like rubber-banding.

The server runs the **same integration function** the client predicts with,
which is what keeps corrections to sub-centimetre in the normal case. That is
only possible because the simulation packages are headless and shared.

## 3. Remote entities: interpolation, not prediction

Other players and wild Pokémon are rendered ~100ms **in the past** and
interpolated between the two snapshots bracketing that time.

That is a deliberate trade: 100ms of added latency in exchange for motion that
is always smooth, because both endpoints are known. For anything the local
player does not directly control, that is the right side of the trade.

Extrapolation past the newest snapshot is **bounded to 250ms**. Extrapolating
far past a lost packet produces a visible lurch that is worse than briefly
standing still.

Out-of-order packets are inserted in time order rather than discarded — a late
packet still improves the window it lands in.

## 4. Interest management

Alola holds tens of thousands of simulated entities. Sending all of them to
every client is impossible.

The policy is **distance-banded update rates**, not a hard cut-off:

| Band | Distance | Interval | Budget |
|---|---|---|---|
| 0 | < 60m | every tick | 40 |
| 1 | 60–160m | every 3 ticks | 30 |
| 2 | 160–400m | every 10 ticks | 20 |
| 3 | 400–900m | every 30 ticks | 10 |

A Pokémon 300m away still moves — at 2Hz instead of 20Hz, which is
indistinguishable at that distance and costs a tenth as much.

Two rules on top:

**Players bypass the interval and the budget.** A player who rubber-bands is far
more noticeable than a Wingull that does.

**Unchanged entities are not resent.** Each entity carries a version; dormant
wildlife does not move, so its version does not change and it is skipped
entirely. That is most of the bandwidth saving at distance.

### A bug worth recording

The budget loop originally used `break`:

```ts
if (!entity.isPlayer && taken >= budget) break;    // WRONG
```

The list is sorted by distance, so breaking once the budget was spent also
skipped every **player** behind that point. A player standing behind forty
Pokémon would simply never replicate — the single most noticeable possible
failure. `continue` is correct.

## 5. Delta encoding

Only changed fields are sent, selected by a bitmask:

```ts
interface EntityDelta {
  id: number;
  mask: number;      // DeltaField.Position | Yaw | Velocity | Species | ...
  x?: number; y?: number; z?: number;
  yaw?: number; vx?: number; vz?: number;
  species?: number; anim?: number; hp?: number; flags?: number;
}
```

Positions quantise to centimetres. Delta encoding plus `version` filtering —
an entity that did not move is not sent at all — is what makes the budget
reachable; on paper, at 20Hz with 60 visible entities, a packed binary encoding
of these deltas lands under 6 KB/s against roughly 40 KB/s for full state.
That encoding does not exist yet, so treat it as the design target, not a
result.

Measured in the server self-test: **51.6 KB/s per client with 4 clients and 200
wildlife, uncompressed JSON.** A binary encoding and per-message compression —
both planned, neither written — should bring that comfortably under target.
Stating the uncompressed JSON figure rather than a projected one is deliberate;
it is what we can actually measure today.

## 6. Battles are lockstep

Battles do **not** replicate state. Both clients run the same deterministic
engine from the same seed, so only inputs cross the wire.

Consequences:

- A battle is a few hundred bytes rather than a state stream.
- **Cheating by state injection is impossible.** A client can only send an
  action; the server validates it against the same rules.
- Replays store as `(seed, teams, input log)` — roughly a 1000× saving over
  per-turn snapshots.

This is only possible because the battle engine is deterministic, which is why
the damage formula's truncation order is treated as non-negotiable.

## 7. Anti-cheat

Layered, with the expensive layers reserved for what matters.

**Input validation.** Out-of-order and replayed inputs are rejected outright —
accepting them is the simplest speed hack there is. `dt` is clamped to 100ms so
a client cannot claim a one-second frame and teleport.

```ts
if (message.seq <= player.lastAckSeq) return null;
const dt = Math.min(Math.max(message.dt, 0), 0.1);
```

Verified by the self-test, which replays an old input every 50 ticks and asserts
the position does not change.

**Movement sanity.** The server integrates movement itself; a client's claimed
position is never trusted, only its input.

**Provenance.** Every Pokémon carries `original_trainer_id`, `met_location`,
`met_level` and `world_seed`, never rewritten including on trade. An impossible
combination — a level-5 met location on a species that cannot appear there — is
detectable after the fact.

**Battle validation.** Lockstep means the server simulates every ranked battle
itself. A mismatch is a desync or a cheat; either way the battle is void.

## 8. Shards and instancing

| Space | Model | Capacity |
|---|---|---|
| Overworld | Shard per region, ~64 players | Soft; interest management scales |
| Towns | Instanced, ~20 players | Keeps social density readable |
| Battles | Session per battle | 2–4 players |
| Raids | Instanced | 4 players |
| Ultra Space | Personal instance | 1 player |

Ultra Space is deliberately single-player: its reality-distortion effects are
camera and world manipulation that cannot be reconciled between observers.

## 9. Protocol versioning

```ts
export const PROTOCOL_VERSION = 3;
```

Checked on connect; a mismatch is rejected with an explanatory message rather
than failing obscurely later. Tested.

## 10. Measured server performance

From `apps/server --selftest`, 20Hz, 4 clients, 200 wildlife:

| Metric | Value | Budget |
|---|---|---|
| Mean tick | **0.81 ms** | 50 ms |
| Peak tick | 31.9 ms (first tick, cold) | 50 ms |
| Entities/snapshot | 28.5 | — |
| Bandwidth/client | 51.6 KB/s | 10 KB/s target |
| Replayed inputs rejected | 7/7 | all |

The mean tick at 1.6% of budget suggests headroom for well over 64 players per
shard; bandwidth is the binding constraint, and it is the one with the clearest
path to improvement.

## 11. Not built

- **Transport.** `WorldServer` exposes `handle()`/`drain()`; a WebSocket layer
  is not written. Deliberate: it keeps the netcode testable without sockets.
- **Binary encoding.** Currently JSON.
- **Matchmaking, guilds, trading flows.** Schema exists; logic does not.
- **Rollback.** Prediction handles the overworld; lockstep handles battles.
  Neither needs rollback, but PvP overworld interaction would.
