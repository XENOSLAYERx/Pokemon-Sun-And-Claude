# TDD-01 — Determinism

**Author:** Lead Gameplay Programmer
**Status:** Implemented and enforced by test.

---

## Problem

Four systems require reproducibility, and they require different things:

| System | Requirement |
|---|---|
| Netcode | Client and server must roll identical battle outcomes |
| Replays | A battle must replay from a seed plus an input log |
| World identity | A chunk must regenerate identically after unload |
| Shiny hunting | Players must trust that a reset genuinely re-rolls |

`Math.random()` satisfies none of them.

## Design

### Seekable streams

A 32-bit xorshift core with a strong output finaliser. State is a single
integer, so a stream's entire position snapshots into a save file or a netcode
packet as one number.

```ts
nextUint32(): number {
  let x = this.state;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;  x >>>= 0;
  this.state = x;
  return hash32(x);    // finaliser: raw xorshift has weak low bits
}
```

### Stream forking — the critical mechanism

```ts
fork(label: string | number): Rng {
  const tag = typeof label === 'string' ? hashString(label) : label | 0;
  return new Rng(hashCombine(this.state, tag));
}
```

Without forking, every subsystem shares one sequence, and adding a single new
random call to the *weather* system shifts what the *spawner* rolls for the rest
of the game. With it, systems evolve independently.

This is why shiny rolls get their own stream derived from the individual's
personality value rather than drawing from the chunk stream:

```ts
const shinyRng = new Rng(hashCombine(personality, 0x5417, cx, cz));
```

### Stateless positional RNG

```ts
export function rngForCell(worldSeed, cx, cz, salt): Rng {
  return new Rng(hashCombine(worldSeed, cx, cz, hashString(salt)));
}
```

"What spawns at chunk (12, −3)?" is answered by a pure function. A chunk unloads
and reloads identically, and two players streaming the same chunk agree without
communicating.

Neighbouring chunks must not correlate, which is why the seed goes through a
MurmurHash3-family finaliser rather than a simple combination — sequential
inputs must avalanche.

### Uniform integers by rejection

```ts
int(min: number, max: number): number {
  const span = max - min + 1;
  const limit = Math.floor(0x100000000 / span) * span;
  let r = this.nextUint32();
  while (r >= limit) r = this.nextUint32();
  return min + (r % span);
}
```

`% span` alone biases toward low values. For damage rolls a 1/256 bias is
detectable by the community, so rejection sampling is worth the occasional extra
draw.

`odds(num, den)` exists so 1/4096 shiny odds are exact integer arithmetic rather
than a float comparison that accumulates error.

## Verification

- Same seed, 1,000 draws, identical sequences.
- 120,000 d6 rolls, every bucket within 4% of expected.
- 500,000 shiny rolls at 1/4096, rate in [0.00015, 0.00035].
- Save/restore rewinds exactly.
- Sibling forks with the same label agree; different labels diverge.
- `rngForCell` stable across calls, distinct for neighbouring cells.
- Terrain: 400 samples identical across two generators with the same seed.
- Battle: 30 turns of full event logs identical for the same seed, different
  for a different seed.
- Spawner: a chunk's population identical across calls — species, personality,
  position and shiny flag.

## Consequences

**Positive.** Replays cost a few hundred bytes. Lockstep battles make state
injection impossible. The world needs no persistence.

**Negative.** Every random draw must go through an `Rng` instance. A stray
`Math.random()` desyncs everything downstream and is easy to write by accident.

**Mitigation.** A lint rule banning `Math.random` outside `packages/core` is the
correct enforcement and is not yet written. Currently it is convention plus
review.
