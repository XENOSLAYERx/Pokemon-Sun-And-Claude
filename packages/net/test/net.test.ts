import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { vec3, type Vec3 } from '@alola/core';
import { PROTOCOL_VERSION, DeltaField, EntityFlag, type InputCommand } from '../src/protocol/messages.ts';
import { InterestManager, DEFAULT_BANDS, type NetEntity } from '../src/server/interest.ts';
import {
  ClientPrediction, EntityInterpolator, LatencyTracker,
  type PredictedState, type RemoteSnapshot,
} from '../src/client/prediction.ts';

/** A deterministic movement model shared by "client" and "server" in tests. */
function simulate(state: PredictedState, input: InputCommand): void {
  const speed = (input.actions & 1) !== 0 ? 8 : 4;
  state.position.x += input.moveX * speed * input.dt;
  state.position.z += input.moveZ * speed * input.dt;
  state.yaw = input.yaw;
}

function makeEntity(id: number, x: number, z: number, isPlayer = false): NetEntity {
  return { id, position: vec3(x, 0, z), isPlayer, version: 1 };
}

describe('Protocol', () => {
  test('field and flag bitmasks are distinct powers of two', () => {
    const check = (obj: Record<string, number>, label: string): void => {
      const seen = new Set<number>();
      for (const [key, value] of Object.entries(obj)) {
        assert.ok(value > 0, `${label}.${key} must be positive`);
        assert.equal(value & (value - 1), 0, `${label}.${key} must be a power of two`);
        assert.ok(!seen.has(value), `${label}.${key} collides with another flag`);
        seen.add(value);
      }
    };
    check(DeltaField as unknown as Record<string, number>, 'DeltaField');
    check(EntityFlag as unknown as Record<string, number>, 'EntityFlag');
  });

  test('protocol version is set', () => {
    assert.ok(PROTOCOL_VERSION >= 1);
  });
});

describe('Interest management', () => {
  test('sends nearby entities and withholds distant ones', () => {
    const manager = new InterestManager();
    const entities = [
      makeEntity(1, 10, 0),      // near
      makeEntity(2, 100, 0),     // mid
      makeEntity(3, 5000, 0),    // far beyond every band
    ];
    manager.rebuild(entities);
    manager.addClient('p1', vec3(0, 0, 0));

    const result = manager.gather('p1', 1);
    const ids = result.updates.map((e) => e.id);
    assert.ok(ids.includes(1), 'the nearby entity must be sent');
    assert.ok(!ids.includes(3), 'an entity 5km away must not be sent');
  });

  test('distant entities update less often than near ones', () => {
    const manager = new InterestManager();
    const near = makeEntity(1, 10, 0);
    const far = makeEntity(2, 300, 0);
    manager.addClient('p1', vec3(0, 0, 0));

    let nearSends = 0;
    let farSends = 0;
    for (let tick = 1; tick <= 40; tick++) {
      // Bump versions so nothing is skipped as unchanged.
      near.version = tick;
      far.version = tick;
      manager.rebuild([near, far]);
      const result = manager.gather('p1', tick);
      for (const e of result.updates) {
        if (e.id === 1) nearSends++;
        if (e.id === 2) farSends++;
      }
    }
    assert.ok(nearSends > farSends * 2, `near ${nearSends} should far exceed far ${farSends}`);
    assert.ok(farSends > 0, 'distant entities should still update occasionally');
  });

  test('unchanged entities are not resent', () => {
    const manager = new InterestManager();
    const entity = makeEntity(1, 10, 0);
    manager.addClient('p1', vec3(0, 0, 0));
    manager.rebuild([entity]);

    assert.equal(manager.gather('p1', 1).updates.length, 1, 'first send');
    assert.equal(manager.gather('p1', 2).updates.length, 0, 'unchanged: skip');

    entity.version = 2;
    assert.equal(manager.gather('p1', 3).updates.length, 1, 'changed: resend');
  });

  test('players bypass the update interval and the budget', () => {
    const manager = new InterestManager();
    // Far more Pokémon than the near band's budget, plus a player.
    const entities: NetEntity[] = [];
    for (let i = 0; i < 120; i++) entities.push(makeEntity(i + 10, i * 0.4, 0));
    const player = makeEntity(1, 55, 0, true);
    entities.push(player);

    manager.addClient('p1', vec3(0, 0, 0));
    manager.rebuild(entities);

    for (let tick = 1; tick <= 5; tick++) {
      const result = manager.gather('p1', tick);
      assert.ok(
        result.updates.some((e) => e.id === 1),
        `the other player must be sent every tick (tick ${tick})`,
      );
    }
  });

  test('band budgets cap the snapshot size', () => {
    const manager = new InterestManager();
    const entities: NetEntity[] = [];
    for (let i = 0; i < 500; i++) entities.push(makeEntity(i + 1, (i % 50) * 1.1, Math.floor(i / 50) * 1.1));
    manager.rebuild(entities);
    manager.addClient('p1', vec3(0, 0, 0));

    const total = DEFAULT_BANDS.reduce((sum, b) => sum + b.budget, 0);
    const result = manager.gather('p1', 1);
    assert.ok(
      result.updates.length <= total,
      `snapshot of ${result.updates.length} exceeds the total budget of ${total}`,
    );
  });

  test('entities that leave interest are explicitly removed, not left as ghosts', () => {
    const manager = new InterestManager();
    const entity = makeEntity(1, 10, 0);
    manager.addClient('p1', vec3(0, 0, 0));
    manager.rebuild([entity]);
    manager.gather('p1', 1);

    // Walk far away.
    manager.updateClientPosition('p1', vec3(50000, 0, 50000));
    manager.rebuild([entity]);
    const result = manager.gather('p1', 2);
    assert.ok(result.removals.includes(1), 'the client must be told the entity is gone');

    // And it must not be removed twice.
    const again = manager.gather('p1', 3);
    assert.ok(!again.removals.includes(1));
  });

  test('each entity belongs to exactly one band', () => {
    const manager = new InterestManager();
    const entities = [makeEntity(1, 10, 0), makeEntity(2, 100, 0), makeEntity(3, 300, 0)];
    manager.rebuild(entities);
    manager.addClient('p1', vec3(0, 0, 0));

    const result = manager.gather('p1', 1);
    const ids = result.updates.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'no entity should appear twice in one snapshot');
  });

  test('removing a client cleans up its state', () => {
    const manager = new InterestManager();
    manager.addClient('p1', vec3());
    assert.equal(manager.clientCount, 1);
    manager.removeClient('p1');
    assert.equal(manager.clientCount, 0);
    assert.deepEqual(manager.gather('p1', 1), { updates: [], removals: [] });
  });
});

describe('Client prediction', () => {
  test('input is applied immediately, with no round trip', () => {
    const prediction = new ClientPrediction(simulate);
    prediction.applyInput(0.1, 1, 0, 0, 0);
    prediction.update(0.1);
    assert.ok(prediction.position.x > 0, 'the player should have moved at once');
    assert.equal(prediction.pendingCount, 1, 'the input should be pending acknowledgement');
  });

  test('an agreeing server produces no correction', () => {
    const prediction = new ClientPrediction(simulate);
    const server: PredictedState = { position: vec3(), velocity: vec3(), yaw: 0 };

    for (let i = 0; i < 10; i++) {
      const cmd = prediction.applyInput(0.1, 1, 0, 0, 0);
      simulate(server, cmd);
    }
    prediction.reconcile(server, 10);
    assert.ok(prediction.lastCorrectionDistance < 0.001, 'agreement should need no correction');
    assert.equal(prediction.pendingCount, 0, 'acknowledged inputs should be dropped');
  });

  test('unacknowledged inputs are replayed on top of server state', () => {
    const prediction = new ClientPrediction(simulate);
    const server: PredictedState = { position: vec3(), velocity: vec3(), yaw: 0 };

    // Server has processed the first five inputs only.
    const commands: InputCommand[] = [];
    for (let i = 0; i < 10; i++) commands.push(prediction.applyInput(0.1, 1, 0, 0, 0));
    for (let i = 0; i < 5; i++) simulate(server, commands[i]);

    prediction.reconcile(server, commands[4].seq);
    prediction.update(0.016);

    // The client should still reflect all ten inputs: five from the server's
    // state plus five replayed.
    const expected = 10 * 1 * 4 * 0.1;
    assert.ok(
      Math.abs(prediction.position.x - expected) < 0.2,
      `expected ~${expected}, got ${prediction.position.x}`,
    );
    assert.equal(prediction.pendingCount, 5);
  });

  test('a small correction is smoothed rather than snapped', () => {
    const prediction = new ClientPrediction(simulate, { snapThreshold: 5, smoothingTime: 0.2 });
    for (let i = 0; i < 5; i++) prediction.applyInput(0.1, 1, 0, 0, 0);
    prediction.update(0.016);
    const before = prediction.position.x;

    // Server disagrees by a small amount.
    const server: PredictedState = { position: vec3(before - 1, 0, 0), velocity: vec3(), yaw: 0 };
    prediction.reconcile(server, 5);
    prediction.update(0.016);

    assert.equal(prediction.snaps, 0, 'a small error must not snap');
    assert.ok(
      Math.abs(prediction.position.x - before) < 0.5,
      'the visible position should barely move on the first frame',
    );

    // It should converge over the smoothing window.
    for (let i = 0; i < 30; i++) prediction.update(0.016);
    assert.ok(Math.abs(prediction.position.x - (before - 1)) < 0.05, 'should converge to the server state');
  });

  test('a large divergence snaps, and is reported', () => {
    const prediction = new ClientPrediction(simulate, { snapThreshold: 2 });
    for (let i = 0; i < 5; i++) prediction.applyInput(0.1, 1, 0, 0, 0);
    prediction.update(0.016);

    const server: PredictedState = { position: vec3(500, 0, 500), velocity: vec3(), yaw: 0 };
    prediction.reconcile(server, 5);
    prediction.update(0.016);

    assert.equal(prediction.snaps, 1, 'a genuine divergence should snap');
    assert.ok(Math.abs(prediction.position.x - 500) < 1, 'and land on the authoritative position');
  });

  test('the pending buffer is bounded on a bad connection', () => {
    const prediction = new ClientPrediction(simulate, { maxPending: 30 });
    for (let i = 0; i < 500; i++) prediction.applyInput(0.016, 1, 0, 0, 0);
    assert.ok(prediction.pendingCount <= 30, `pending buffer grew to ${prediction.pendingCount}`);
  });

  test('teleport clears prediction state', () => {
    const prediction = new ClientPrediction(simulate);
    for (let i = 0; i < 5; i++) prediction.applyInput(0.1, 1, 0, 0, 0);
    prediction.teleport(vec3(1000, 0, 1000), 2);
    prediction.update(0.016);
    assert.equal(prediction.pendingCount, 0);
    assert.equal(prediction.position.x, 1000);
  });
});

describe('Entity interpolation', () => {
  function snap(tick: number, time: number, x: number, yaw = 0): RemoteSnapshot {
    return { tick, time, position: vec3(x, 0, 0), yaw, velocity: vec3(10, 0, 0) };
  }

  test('interpolates between bracketing snapshots', () => {
    const interp = new EntityInterpolator(0.1);
    interp.push(snap(1, 1.0, 0));
    interp.push(snap(2, 2.0, 10));

    const out = { position: vec3(), yaw: 0 };
    // Render time 1.6 with 0.1 delay samples at 1.5 — exactly halfway.
    assert.ok(interp.sample(1.6, out));
    assert.ok(Math.abs(out.position.x - 5) < 0.001, `expected 5, got ${out.position.x}`);
    assert.equal(interp.extrapolating, false);
  });

  test('holds the oldest snapshot before the buffer starts', () => {
    const interp = new EntityInterpolator(0.1);
    interp.push(snap(1, 5.0, 42));
    const out = { position: vec3(), yaw: 0 };
    assert.ok(interp.sample(1.0, out));
    assert.equal(out.position.x, 42);
  });

  test('extrapolates past the newest snapshot, but only briefly', () => {
    const interp = new EntityInterpolator(0.1);
    interp.push(snap(1, 1.0, 0));

    const out = { position: vec3(), yaw: 0 };
    interp.sample(1.3, out);
    assert.ok(out.position.x > 0, 'should extrapolate forward');
    assert.ok(interp.extrapolating);

    // A long gap must not fling the entity across the map.
    const far = { position: vec3(), yaw: 0 };
    interp.sample(60, far);
    assert.ok(far.position.x <= 10 * 0.25 + 0.001, `extrapolation unbounded: ${far.position.x}`);
  });

  test('out-of-order packets are inserted in time order', () => {
    const interp = new EntityInterpolator(0.1);
    interp.push(snap(3, 3.0, 30));
    interp.push(snap(1, 1.0, 10));  // Late arrival.
    interp.push(snap(2, 2.0, 20));

    const out = { position: vec3(), yaw: 0 };
    interp.sample(1.6, out); // Samples at 1.5, between the 1.0 and 2.0 snapshots.
    assert.ok(Math.abs(out.position.x - 15) < 0.001, `expected 15, got ${out.position.x}`);
  });

  test('yaw interpolation takes the short way around the circle', () => {
    const interp = new EntityInterpolator(0);
    interp.push(snap(1, 1.0, 0, 0.1));
    interp.push(snap(2, 2.0, 0, Math.PI * 2 - 0.1));

    const out = { position: vec3(), yaw: 0 };
    interp.sample(1.5, out);
    // The short path passes through 0, not through PI.
    const normalised = ((out.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    assert.ok(
      normalised < 0.2 || normalised > Math.PI * 2 - 0.2,
      `yaw took the long way: ${normalised}`,
    );
  });

  test('sampling an empty buffer fails cleanly', () => {
    const interp = new EntityInterpolator(0.1);
    assert.equal(interp.sample(1, { position: vec3(), yaw: 0 }), false);
  });

  test('pruning keeps enough history to interpolate', () => {
    const interp = new EntityInterpolator(0.1);
    for (let i = 0; i < 50; i++) interp.push(snap(i, i * 0.1, i));
    interp.prune(5.0);
    assert.ok(interp.bufferLength >= 2, 'must retain a usable interpolation window');
    const out = { position: vec3(), yaw: 0 };
    assert.ok(interp.sample(4.9, out), 'should still be able to sample');
  });

  test('the buffer is capacity bounded', () => {
    const interp = new EntityInterpolator(0.1, 8);
    for (let i = 0; i < 100; i++) interp.push(snap(i, i * 0.1, i));
    assert.ok(interp.bufferLength <= 8);
  });
});

describe('Latency tracking', () => {
  test('uses the median, so one stall does not skew the estimate', () => {
    const tracker = new LatencyTracker();
    for (let i = 0; i < 20; i++) tracker.record(50);
    tracker.record(5000); // One catastrophic outlier.
    assert.ok(tracker.median < 60, `median skewed by an outlier: ${tracker.median}`);
  });

  test('jitter reflects spread, and the recommended delay follows it', () => {
    const steady = new LatencyTracker();
    for (let i = 0; i < 20; i++) steady.record(40);

    const jittery = new LatencyTracker();
    for (let i = 0; i < 20; i++) jittery.record(i % 2 === 0 ? 20 : 200);

    assert.ok(jittery.jitter > steady.jitter, 'a jittery connection should report more jitter');
    assert.ok(
      jittery.recommendedDelay() > steady.recommendedDelay(),
      'a jittery connection needs a longer interpolation buffer',
    );
  });

  test('the recommended delay stays inside sane bounds', () => {
    const tracker = new LatencyTracker();
    tracker.record(0);
    assert.ok(tracker.recommendedDelay() >= 0.05);
    for (let i = 0; i < 20; i++) tracker.record(100000);
    assert.ok(tracker.recommendedDelay() <= 0.3, 'never buffer more than 300ms');
  });

  test('an empty tracker reports zero rather than NaN', () => {
    const tracker = new LatencyTracker();
    assert.equal(tracker.median, 0);
    assert.equal(tracker.jitter, 0);
  });
});
