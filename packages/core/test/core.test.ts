import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashCombine, rngForCell } from '../src/util/rng.ts';
import { SimplexNoise, fbm2D, ridged2D } from '../src/util/noise.ts';
import { World, defineComponent } from '../src/ecs/world.ts';
import { Scheduler, Phase } from '../src/ecs/scheduler.ts';
import { EventBus, defineEvent } from '../src/events/bus.ts';
import { SpatialHash } from '../src/spatial/hash.ts';
import { FixedClock } from '../src/time/clock.ts';
import { RingBuffer } from '../src/util/pool.ts';
import * as V3 from '../src/math/vec3.ts';
import { angleDelta, rotateTowards } from '../src/math/scalar.ts';

describe('Rng determinism', () => {
  test('same seed produces the same sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      assert.equal(a.next(), b.next());
    }
  });

  test('different seeds diverge immediately', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    assert.notEqual(a.next(), b.next());
  });

  test('int() is uniform and in range', () => {
    const rng = new Rng('uniformity');
    const buckets = new Array(6).fill(0);
    const N = 120_000;
    for (let i = 0; i < N; i++) {
      const v = rng.int(1, 6);
      assert.ok(v >= 1 && v <= 6, `out of range: ${v}`);
      buckets[v - 1]++;
    }
    const expected = N / 6;
    for (const count of buckets) {
      // Within 4% of expected — far tighter than chance would allow if biased.
      assert.ok(Math.abs(count - expected) < expected * 0.04, `bucket skew: ${buckets.join(',')}`);
    }
  });

  test('save/restore rewinds the stream exactly', () => {
    const rng = new Rng('save-test');
    for (let i = 0; i < 50; i++) rng.next();
    const snapshot = rng.save();
    const expected = [rng.next(), rng.next(), rng.next()];
    rng.restore(snapshot);
    assert.deepEqual([rng.next(), rng.next(), rng.next()], expected);
  });

  test('fork produces independent but deterministic streams', () => {
    const parent1 = new Rng('world');
    const parent2 = new Rng('world');
    const a = parent1.fork('pokemon:42');
    const b = parent2.fork('pokemon:42');
    const c = parent2.fork('pokemon:43');
    assert.equal(a.next(), b.next());
    assert.notEqual(b.next(), c.next());
  });

  test('odds() honours exact shiny rates', () => {
    const rng = new Rng('shiny');
    let hits = 0;
    const N = 500_000;
    for (let i = 0; i < N; i++) if (rng.odds(1, 4096)) hits++;
    const rate = hits / N;
    // Expected 1/4096 ≈ 0.000244. Allow generous tolerance for sample noise.
    assert.ok(rate > 0.00015 && rate < 0.00035, `shiny rate out of band: ${rate}`);
  });

  test('weightedIndex returns -1 when all weights are zero', () => {
    const rng = new Rng(7);
    assert.equal(rng.weightedIndex([0, 0, 0]), -1);
  });

  test('weightedIndex respects weights', () => {
    const rng = new Rng('weights');
    const counts = [0, 0, 0];
    for (let i = 0; i < 60_000; i++) counts[rng.weightedIndex([1, 3, 6])]++;
    assert.ok(counts[2] > counts[1] && counts[1] > counts[0]);
  });

  test('rngForCell is stable across reloads and distinct per cell', () => {
    const first = rngForCell(9001, 12, -3, 'spawn').next();
    const again = rngForCell(9001, 12, -3, 'spawn').next();
    const neighbour = rngForCell(9001, 13, -3, 'spawn').next();
    assert.equal(first, again, 'chunk must regenerate identically');
    assert.notEqual(first, neighbour, 'neighbouring chunks must not correlate');
  });

  test('hashCombine is order sensitive', () => {
    assert.notEqual(hashCombine(1, 2), hashCombine(2, 1));
  });
});

describe('Noise', () => {
  test('simplex is deterministic per seed and bounded', () => {
    const n1 = new SimplexNoise(42);
    const n2 = new SimplexNoise(42);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137;
      const y = i * 0.271;
      const v = n1.noise2D(x, y);
      assert.equal(v, n2.noise2D(x, y));
      assert.ok(v >= -1.001 && v <= 1.001, `noise out of range: ${v}`);
    }
  });

  test('3D simplex stays bounded', () => {
    const n = new SimplexNoise(7);
    for (let i = 0; i < 200; i++) {
      const v = n.noise3D(i * 0.11, i * 0.23, i * 0.37);
      assert.ok(v >= -1.001 && v <= 1.001, `noise3D out of range: ${v}`);
    }
  });

  test('fbm stays within [-1, 1] and actually varies', () => {
    const n = new SimplexNoise(3);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const v = fbm2D(n, i * 0.05, i * 0.03, { octaves: 5 });
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    assert.ok(min >= -1.001 && max <= 1.001);
    assert.ok(max - min > 0.3, 'fbm should produce meaningful variation');
  });

  test('ridged noise is non-negative — required for height offsets', () => {
    const n = new SimplexNoise(11);
    for (let i = 0; i < 300; i++) {
      const v = ridged2D(n, i * 0.07, i * 0.09);
      assert.ok(v >= 0 && v <= 1.001, `ridged out of range: ${v}`);
    }
  });
});

describe('ECS', () => {
  const Pos = defineComponent<{ x: number }>('TestPos', () => ({ x: 0 }));
  const Tag = defineComponent<{ v: boolean }>('TestTag', () => ({ v: true }));
  const Other = defineComponent<{ n: number }>('TestOther', () => ({ n: 0 }));

  test('entity lifecycle and generational safety', () => {
    const w = new World(256);
    const e = w.create();
    assert.ok(w.isAlive(e));
    w.add(e, Pos, { x: 5 });
    assert.equal(w.get(e, Pos)?.x, 5);

    w.destroy(e);
    assert.ok(!w.isAlive(e));

    // Recycled slot must NOT validate the stale handle.
    const e2 = w.create();
    assert.ok(w.isAlive(e2));
    assert.ok(!w.isAlive(e), 'stale handle must not alias a recycled entity');
    assert.equal(w.get(e, Pos), undefined);
  });

  test('queries match all/none constraints', () => {
    const w = new World(256);
    const a = w.create();
    w.add(a, Pos, { x: 1 });
    w.add(a, Tag);
    const b = w.create();
    w.add(b, Pos, { x: 2 });
    const c = w.create();
    w.add(c, Tag);

    assert.equal(w.query({ all: [Pos] }).count, 2);
    assert.equal(w.query({ all: [Pos, Tag] }).count, 1);
    assert.equal(w.query({ all: [Pos], none: [Tag] }).count, 1);
    assert.equal(w.query({ any: [Pos, Tag] }).count, 3);
  });

  test('query cache invalidates on structural change', () => {
    const w = new World(256);
    const q = w.query({ all: [Pos] });
    assert.equal(q.count, 0);
    const e = w.create();
    w.add(e, Pos);
    assert.equal(q.count, 1, 'cache must invalidate when a component is added');
    w.remove(e, Pos);
    assert.equal(q.count, 0, 'cache must invalidate when a component is removed');
  });

  test('structural changes during iteration are deferred, not lost', () => {
    const w = new World(256);
    for (let i = 0; i < 5; i++) {
      const e = w.create();
      w.add(e, Pos, { x: i });
    }
    let visited = 0;
    w.each({ all: [Pos] }, (e) => {
      visited++;
      // Spawn during iteration — must not be visited this pass, must exist after.
      const spawned = w.create();
      w.add(spawned, Other, { n: 1 });
      w.destroy(e);
    });
    assert.equal(visited, 5);
    assert.equal(w.query({ all: [Pos] }).count, 0, 'all originals destroyed');
    assert.equal(w.query({ all: [Other] }).count, 5, 'all spawns applied');
  });

  test('getOrThrow names the missing component', () => {
    const w = new World(16);
    const e = w.create();
    assert.throws(() => w.getOrThrow(e, Pos), /TestPos/);
  });

  test('capacity exhaustion raises a clear error', () => {
    const w = new World(4);
    for (let i = 0; i < 4; i++) w.create();
    assert.throws(() => w.create(), /capacity/i);
  });
});

describe('Scheduler', () => {
  test('phases run in declared order', () => {
    const w = new World(16);
    const s = new Scheduler();
    s.profiling = false;
    const order: string[] = [];
    s.add({ name: 'late', phase: Phase.Cleanup, update: () => order.push('late') });
    s.add({ name: 'early', phase: Phase.Input, update: () => order.push('early') });
    s.add({ name: 'mid', phase: Phase.Movement, update: () => order.push('mid') });
    s.tick({ world: w, dt: 1 / 60, elapsed: 0, tick: 1, alpha: 0 });
    assert.deepEqual(order, ['early', 'mid', 'late']);
  });

  test('after-dependencies sort within a phase', () => {
    const w = new World(16);
    const s = new Scheduler();
    s.profiling = false;
    const order: string[] = [];
    s.add({ name: 'b', phase: Phase.Gameplay, after: ['a'], update: () => order.push('b') });
    s.add({ name: 'a', phase: Phase.Gameplay, update: () => order.push('a') });
    s.add({ name: 'c', phase: Phase.Gameplay, after: ['b'], update: () => order.push('c') });
    s.tick({ world: w, dt: 1 / 60, elapsed: 0, tick: 1, alpha: 0 });
    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  test('cyclic dependencies are reported, not hung', () => {
    const w = new World(16);
    const s = new Scheduler();
    s.add({ name: 'x', phase: Phase.Gameplay, after: ['y'], update: () => {} });
    s.add({ name: 'y', phase: Phase.Gameplay, after: ['x'], update: () => {} });
    assert.throws(() => s.tick({ world: w, dt: 0, elapsed: 0, tick: 1, alpha: 0 }), /Cyclic/);
  });

  test('interval systems run only on matching ticks', () => {
    const w = new World(16);
    const s = new Scheduler();
    s.profiling = false;
    let runs = 0;
    s.add({ name: 'slow', phase: Phase.Gameplay, interval: 10, update: () => runs++ });
    for (let t = 1; t <= 100; t++) {
      s.tick({ world: w, dt: 1 / 60, elapsed: t / 60, tick: t, alpha: 0 });
    }
    assert.equal(runs, 10);
  });
});

describe('EventBus', () => {
  const Ping = defineEvent<{ n: number }>('Ping');

  test('emit is synchronous and ordered by priority', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(Ping, () => seen.push('low'), 0);
    bus.on(Ping, () => seen.push('high'), 10);
    bus.emit(Ping, { n: 1 });
    assert.deepEqual(seen, ['high', 'low']);
  });

  test('once handlers fire exactly once', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once(Ping, () => count++);
    bus.emit(Ping, { n: 1 });
    bus.emit(Ping, { n: 2 });
    assert.equal(count, 1);
  });

  test('a handler can unsubscribe during dispatch', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on(Ping, () => {
      count++;
      off();
    });
    bus.emit(Ping, { n: 1 });
    bus.emit(Ping, { n: 2 });
    assert.equal(count, 1);
  });

  test('queued events drain, including cascades', () => {
    const bus = new EventBus();
    const Second = defineEvent<{ v: number }>('Second');
    const seen: string[] = [];
    bus.on(Ping, () => {
      seen.push('ping');
      bus.queue(Second, { v: 1 });
    });
    bus.on(Second, () => seen.push('second'));
    bus.queue(Ping, { n: 1 });
    assert.deepEqual(seen, []);
    bus.drain();
    assert.deepEqual(seen, ['ping', 'second']);
  });

  test('runaway event loops are caught', () => {
    const bus = new EventBus();
    bus.on(Ping, () => bus.queue(Ping, { n: 0 }));
    bus.queue(Ping, { n: 0 });
    assert.throws(() => bus.drain(4), /feedback loop/);
  });
});

describe('SpatialHash', () => {
  test('radius query finds exactly the in-range items', () => {
    const grid = new SpatialHash<{ id: number; position: { x: number; y: number; z: number } }>(10);
    for (let i = 0; i < 100; i++) {
      grid.insert({ id: i, position: { x: i, y: 0, z: 0 } });
    }
    const found = grid.queryRadius({ x: 50, y: 0, z: 0 }, 5);
    const ids = found.map((f) => f.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55]);
  });

  test('matches brute force on random data', () => {
    const rng = new Rng('spatial');
    const items = Array.from({ length: 600 }, (_, id) => ({
      id,
      position: { x: rng.range(-200, 200), y: 0, z: rng.range(-200, 200) },
    }));
    const grid = new SpatialHash<(typeof items)[number]>(16);
    grid.rebuild(items);

    const center = { x: 10, y: 0, z: -25 };
    const radius = 40;
    const brute = items
      .filter((i) => (i.position.x - center.x) ** 2 + (i.position.z - center.z) ** 2 <= radius * radius)
      .map((i) => i.id)
      .sort((a, b) => a - b);
    const hashed = grid.queryRadius(center, radius).map((i) => i.id).sort((a, b) => a - b);
    assert.deepEqual(hashed, brute);
  });

  test('queryNearest caps results and returns the closest', () => {
    const grid = new SpatialHash<{ id: number; position: { x: number; y: number; z: number } }>(8);
    for (let i = 0; i < 50; i++) grid.insert({ id: i, position: { x: i, y: 0, z: 0 } });
    const near = grid.queryNearest({ x: 25, y: 0, z: 0 }, 20, 3);
    assert.equal(near.length, 3);
    assert.deepEqual(near.map((n) => n.id).sort((a, b) => a - b), [24, 25, 26]);
  });

  test('handles negative coordinates', () => {
    const grid = new SpatialHash<{ id: number; position: { x: number; y: number; z: number } }>(10);
    grid.insert({ id: 1, position: { x: -105, y: 0, z: -205 } });
    assert.equal(grid.queryRadius({ x: -105, y: 0, z: -205 }, 2).length, 1);
    assert.equal(grid.queryRadius({ x: 105, y: 0, z: 205 }, 2).length, 0);
  });
});

describe('FixedClock', () => {
  test('produces a stable number of ticks per second', () => {
    const clock = new FixedClock({ tickRate: 60 });
    let ticks = 0;
    clock.advance(0, () => {});
    // Simulate 1 second in 16.6ms frames.
    for (let i = 1; i <= 60; i++) clock.advance(i / 60, () => ticks++);
    assert.ok(ticks >= 59 && ticks <= 61, `expected ~60 ticks, got ${ticks}`);
  });

  test('does not spiral after a long stall', () => {
    const clock = new FixedClock({ tickRate: 60, maxStepsPerFrame: 5 });
    let ticks = 0;
    clock.advance(0, () => {});
    clock.advance(10, () => ticks++); // 10-second hitch
    assert.ok(ticks <= 5, `stall must be clamped, ran ${ticks} steps`);
    assert.ok(clock.droppedSteps > 0, 'dropped steps should be reported');
  });

  test('timeScale zero pauses the simulation', () => {
    const clock = new FixedClock({ tickRate: 60 });
    clock.advance(0, () => {});
    clock.timeScale = 0;
    let ticks = 0;
    for (let i = 1; i <= 60; i++) clock.advance(i / 60, () => ticks++);
    assert.equal(ticks, 0);
  });
});

describe('Math helpers', () => {
  test('angleDelta takes the short way around', () => {
    assert.ok(Math.abs(angleDelta(0.1, Math.PI * 2 - 0.1) - -0.2) < 1e-6);
  });

  test('rotateTowards never overshoots', () => {
    const result = rotateTowards(0, 0.05, 1.0);
    assert.equal(result, 0.05);
  });

  test('vec3 damp is framerate independent', () => {
    const target = { x: 10, y: 0, z: 0 };
    // One 1-second step vs sixty 1/60-second steps should land near the same place.
    const a = V3.damp({ x: 0, y: 0, z: 0 }, target, 0.25, 1.0);
    let b = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60; i++) b = V3.damp(b, target, 0.25, 1 / 60);
    assert.ok(Math.abs(a.x - b.x) < 0.01, `framerate dependence: ${a.x} vs ${b.x}`);
  });

  test('cross product handles aliased output', () => {
    const a = { x: 1, y: 0, z: 0 };
    const b = { x: 0, y: 1, z: 0 };
    V3.cross(a, b, a);
    assert.deepEqual(a, { x: 0, y: 0, z: 1 });
  });

  test('normalize of a zero vector is safe', () => {
    assert.deepEqual(V3.normalize({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  });
});

describe('RingBuffer', () => {
  test('overwrites oldest when full and indexes from newest', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    assert.equal(rb.push(4), 1, 'should evict the oldest');
    assert.deepEqual(rb.toArray(), [4, 3, 2]);
    assert.equal(rb.get(0), 4);
    assert.equal(rb.get(2), 2);
    assert.equal(rb.get(3), undefined);
  });
});
