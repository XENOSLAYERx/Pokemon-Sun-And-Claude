import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, SpatialHash, Blackboard, vec3 } from '@alola/core';
import { getSpecies } from '@alola/data';
import {
  NodeStatus, action, condition, sequence, selector, parallel,
  invert, guard, timeout, repeat, wait,
} from '../src/bt/tree.ts';
import type { BtContext } from '../src/bt/tree.ts';
import { evaluateCurve, scoreGoal, selectGoal, emptyFacts } from '../src/utility/scorer.ts';
import type { Goal, UtilityFacts } from '../src/utility/scorer.ts';
import { GOAL_FLEE, GOAL_ATTACK, GOAL_SLEEP, GOAL_WANDER, ALL_GOALS } from '../src/utility/goals.ts';
import {
  createNeeds, needsConfigFor, updateNeeds, applyFear, applyAggression, feed, dominantNeed,
} from '../src/memory/needs.ts';
import { AgentMemory, dispositionFor } from '../src/memory/memory.ts';
import { perceive, canSee, visibilityFrom } from '../src/perception/senses.ts';
import type { PerceivableAgent } from '../src/perception/senses.ts';
import { flock, seek, arrive, combineSteering, containWithin } from '../src/flock/boids.ts';
import type { Boid } from '../src/flock/boids.ts';
import { profileFor, biasedGoalsFor, willFlee, isHostile } from '../src/profiles/profiles.ts';
import { PokemonBrain, BrainLod, lodForDistance } from '../src/ecosystem/brain.ts';
import type { BrainState, BrainWorldView } from '../src/ecosystem/brain.ts';

// ---------------------------------------------------------------- helpers

function makeCtx(agent: object = {}): BtContext<object> {
  return { agent, blackboard: new Blackboard(), dt: 1 / 60, now: 0 };
}

function makeAgent(overrides: Partial<PerceivableAgent> = {}): PerceivableAgent {
  return {
    id: 1, position: vec3(), speciesId: 'PIKACHU', packId: -1,
    playerId: null, noise: 0.3, inactive: false, level: 10,
    ...overrides,
  };
}

function makeBrain(speciesId: string, id = 1, position = vec3()): PokemonBrain {
  const state: BrainState = {
    id, speciesId,
    position,
    velocity: vec3(),
    yaw: 0,
    home: vec3(position.x, position.y, position.z),
    packId: -1,
    level: 15,
    health: 50,
    maxHealth: 50,
    lod: BrainLod.Full,
  };
  return new PokemonBrain(state, 1234);
}

function makeWorld(agents: PerceivableAgent[] = []): BrainWorldView {
  const grid = new SpatialHash<PerceivableAgent>(16);
  grid.rebuild(agents);
  return {
    hour: 12, daylight: 1, visibility: 1, now: 0, grid,
    groundAt: () => 0,
  };
}

// ------------------------------------------------------------ behaviour trees

describe('Behaviour tree runtime', () => {
  test('sequence fails fast and succeeds when all children succeed', () => {
    const ctx = makeCtx();
    let ran = 0;
    const ok = sequence<object>('ok', [
      action('a', () => { ran++; return NodeStatus.Success; }),
      action('b', () => { ran++; return NodeStatus.Success; }),
    ]);
    assert.equal(ok.tick(ctx), NodeStatus.Success);
    assert.equal(ran, 2);

    ran = 0;
    const bad = sequence<object>('bad', [
      action('a', () => { ran++; return NodeStatus.Failure; }),
      action('b', () => { ran++; return NodeStatus.Success; }),
    ]);
    assert.equal(bad.tick(ctx), NodeStatus.Failure);
    assert.equal(ran, 1, 'sequence must not run past a failure');
  });

  test('sequence resumes at the running child rather than restarting', () => {
    const ctx = makeCtx();
    let firstRuns = 0;
    let secondRuns = 0;
    let gate = NodeStatus.Running as NodeStatus;

    const tree = sequence<object>('resume', [
      action('first', () => { firstRuns++; return NodeStatus.Success; }),
      action('second', () => { secondRuns++; return gate; }),
    ]);

    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(firstRuns, 1, 'first child must not re-run while the second is running');
    assert.equal(secondRuns, 2);

    gate = NodeStatus.Success;
    assert.equal(tree.tick(ctx), NodeStatus.Success);
    assert.equal(firstRuns, 1);
  });

  test('selector takes the first success', () => {
    const ctx = makeCtx();
    const order: string[] = [];
    const tree = selector<object>('sel', [
      action('a', () => { order.push('a'); return NodeStatus.Failure; }),
      action('b', () => { order.push('b'); return NodeStatus.Success; }),
      action('c', () => { order.push('c'); return NodeStatus.Success; }),
    ]);
    assert.equal(tree.tick(ctx), NodeStatus.Success);
    assert.deepEqual(order, ['a', 'b']);
  });

  test('parallel succeeds at the threshold and fails when unreachable', () => {
    const ctx = makeCtx();
    const two = parallel<object>('p', [
      action('a', () => NodeStatus.Success),
      action('b', () => NodeStatus.Running),
    ], 1);
    assert.equal(two.tick(ctx), NodeStatus.Success);

    const impossible = parallel<object>('p2', [
      action('a', () => NodeStatus.Failure),
      action('b', () => NodeStatus.Failure),
    ], 1);
    assert.equal(impossible.tick(ctx), NodeStatus.Failure);
  });

  test('invert swaps success and failure but passes running through', () => {
    const ctx = makeCtx();
    assert.equal(invert<object>(action('a', () => NodeStatus.Success)).tick(ctx), NodeStatus.Failure);
    assert.equal(invert<object>(action('a', () => NodeStatus.Failure)).tick(ctx), NodeStatus.Success);
    assert.equal(invert<object>(action('a', () => NodeStatus.Running)).tick(ctx), NodeStatus.Running);
  });

  test('guard aborts its child when the predicate turns false', () => {
    const ctx = makeCtx();
    let allowed = true;
    let aborted = false;
    const child = {
      name: 'child',
      tick: () => NodeStatus.Running,
      abort: () => { aborted = true; },
    };
    const tree = guard<object>('g', () => allowed, child);
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    allowed = false;
    assert.equal(tree.tick(ctx), NodeStatus.Failure);
    assert.ok(aborted, 'guard must abort the running child');
  });

  test('timeout fails a child that runs too long — no infinite chases', () => {
    const ctx = makeCtx();
    const tree = timeout<object>(1.0, action('forever', () => NodeStatus.Running));
    ctx.now = 0;
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    ctx.now = 2.0;
    assert.equal(tree.tick(ctx), NodeStatus.Failure);
  });

  test('wait accumulates dt and then succeeds', () => {
    const agent = {};
    const ctx = makeCtx(agent);
    const tree = wait<object>('rest', 0.5);
    ctx.dt = 0.2;
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(tree.tick(ctx), NodeStatus.Success);
  });

  test('repeat runs a child the requested number of times', () => {
    const ctx = makeCtx();
    let runs = 0;
    const tree = repeat<object>(3, action('a', () => { runs++; return NodeStatus.Success; }));
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(tree.tick(ctx), NodeStatus.Running);
    assert.equal(tree.tick(ctx), NodeStatus.Success);
    assert.equal(runs, 3);
  });

  test('two agents running the same tree keep independent state', () => {
    const treeA = sequence<object>('shared', [
      action('a', () => NodeStatus.Success),
      action('b', () => NodeStatus.Running),
    ]);
    const agent1 = { name: 1 };
    const agent2 = { name: 2 };
    let aRuns = 0;
    const tree = sequence<object>('shared2', [
      action('a', () => { aRuns++; return NodeStatus.Success; }),
      action('b', () => NodeStatus.Running),
    ]);
    void treeA;

    tree.tick(makeCtx(agent1));
    tree.tick(makeCtx(agent2));
    // Both agents ran the first child exactly once.
    assert.equal(aRuns, 2);
    // Now each resumes at its own position, so neither re-runs child 'a'.
    tree.tick(makeCtx(agent1));
    tree.tick(makeCtx(agent2));
    assert.equal(aRuns, 2, 'per-agent state leaked between agents');
  });
});

// ------------------------------------------------------------------ utility

describe('Utility scoring', () => {
  test('response curves are bounded and correctly shaped', () => {
    for (let x = 0; x <= 1; x += 0.05) {
      for (const kind of ['linear', 'quadratic', 'inverse', 'inverse-quadratic', 'threshold', 'logistic', 'bell'] as const) {
        const v = evaluateCurve({ kind }, x);
        assert.ok(v >= 0 && v <= 1, `${kind}(${x}) = ${v} out of range`);
      }
    }
    // Quadratic rises slowly then sharply.
    assert.ok(evaluateCurve({ kind: 'quadratic' }, 0.5) < 0.5);
    // Inverse falls.
    assert.ok(evaluateCurve({ kind: 'inverse' }, 0.8) < evaluateCurve({ kind: 'inverse' }, 0.2));
    // Threshold is a hard gate.
    assert.equal(evaluateCurve({ kind: 'threshold', c: 0.5 }, 0.49), 0);
    assert.equal(evaluateCurve({ kind: 'threshold', c: 0.5 }, 0.51), 1);
    // Bell peaks at its centre.
    const peak = evaluateCurve({ kind: 'bell', c: 0.5 }, 0.5);
    assert.ok(peak > evaluateCurve({ kind: 'bell', c: 0.5 }, 0.1));
    assert.ok(peak > evaluateCurve({ kind: 'bell', c: 0.5 }, 0.9));
  });

  test('a zero consideration kills the goal — no standing still while starving', () => {
    const goal: Goal = {
      name: 'eat',
      considerations: [
        { name: 'hunger', input: (f) => f.hunger, curve: { kind: 'linear' } },
        { name: 'food-present', input: (f) => 1 - f.preyDistance, curve: { kind: 'threshold', c: 0.1 } },
      ],
    };
    const starving = { ...emptyFacts(), hunger: 1, preyDistance: 1 };
    assert.equal(scoreGoal(goal, starving).score, 0, 'no food means the goal must score zero');

    const fed = { ...emptyFacts(), hunger: 1, preyDistance: 0.2 };
    assert.ok(scoreGoal(goal, fed).score > 0);
  });

  test('complexity compensation lets goals of different sizes compete', () => {
    const simple: Goal = {
      name: 'simple',
      considerations: [{ name: 'a', input: () => 0.6, curve: { kind: 'linear' } }],
    };
    const complex: Goal = {
      name: 'complex',
      considerations: Array.from({ length: 5 }, (_, i) => ({
        name: `c${i}`, input: () => 0.6, curve: { kind: 'linear' as const },
      })),
    };
    const facts = emptyFacts();
    const simpleScore = scoreGoal(simple, facts).score;
    const complexScore = scoreGoal(complex, facts).score;
    // Without compensation, 0.6^5 = 0.078 would be hopeless against 0.6.
    assert.ok(complexScore > 0.25, `complex goal crushed by its own size: ${complexScore}`);
    assert.ok(simpleScore > complexScore, 'more conditions should still cost something');
  });

  test('a frightened Pokémon chooses flee over wander', () => {
    const facts: UtilityFacts = {
      ...emptyFacts(),
      fear: 0.9, threatDistance: 0.2, threatLevel: 0.8,
    };
    const chosen = selectGoal([GOAL_FLEE, GOAL_WANDER, GOAL_SLEEP], facts);
    assert.equal(chosen?.goal.name, 'flee');
  });

  test('a calm Pokémon does not flee', () => {
    const facts = emptyFacts();
    const chosen = selectGoal([GOAL_FLEE, GOAL_WANDER], facts);
    assert.equal(chosen?.goal.name, 'wander');
  });

  test('an exhausted, badly hurt Pokémon will not choose to attack', () => {
    const facts: UtilityFacts = {
      ...emptyFacts(),
      aggression: 0.95, threatDistance: 0.1,
      healthFraction: 0.05, fatigue: 0.98,
    };
    const attackScore = scoreGoal(GOAL_ATTACK, facts).score;
    assert.ok(attackScore < 0.25, `a dying, exhausted creature should not attack: ${attackScore}`);
  });

  test('commitment bonus prevents goal flicker', () => {
    // Two goals scoring almost identically.
    const a: Goal = { name: 'a', commitment: 0.2, considerations: [{ name: 'x', input: () => 0.5, curve: { kind: 'linear' } }] };
    const b: Goal = { name: 'b', considerations: [{ name: 'x', input: () => 0.505, curve: { kind: 'linear' } }] };
    const facts = emptyFacts();

    // With no current goal, the marginally higher scorer wins.
    assert.equal(selectGoal([a, b], facts, null)?.goal.name, 'b');
    // Already pursuing 'a', it holds — no twitching.
    assert.equal(selectGoal([a, b], facts, 'a')?.goal.name, 'a');
  });

  test('sleep is suppressed by fear no matter how tired', () => {
    const exhausted: UtilityFacts = {
      ...emptyFacts(), drowsiness: 1, isActiveHour: 0, fear: 0.9, threatDistance: 0.2,
    };
    const safe: UtilityFacts = { ...exhausted, fear: 0, threatDistance: 1 };
    assert.ok(
      scoreGoal(GOAL_SLEEP, safe).score > scoreGoal(GOAL_SLEEP, exhausted).score * 3,
      'a frightened creature must not fall asleep',
    );
  });
});

// -------------------------------------------------------------------- needs

describe('Needs and drives', () => {
  test('hunger rises over time and eating relieves it', () => {
    const rng = new Rng(1);
    const needs = createNeeds(() => rng.next());
    const config = needsConfigFor(getSpecies('PIKACHU'));
    const start = needs.hunger;
    for (let i = 0; i < 600; i++) {
      updateNeeds(needs, config, 1, {
        isActiveHour: true, isResting: false, isMoving: true, hasThreat: false, packNearby: false,
      });
    }
    assert.ok(needs.hunger > start, 'hunger should climb');
    feed(needs, 0.8);
    assert.ok(needs.hunger < 0.5, 'feeding should relieve hunger');
  });

  test('fatigue falls while resting', () => {
    const rng = new Rng(2);
    const needs = createNeeds(() => rng.next());
    const config = needsConfigFor(getSpecies('MUDSDALE'));
    needs.fatigue = 0.9;
    for (let i = 0; i < 300; i++) {
      updateNeeds(needs, config, 1, {
        isActiveHour: true, isResting: true, isMoving: false, hasThreat: false, packNearby: false,
      });
    }
    assert.ok(needs.fatigue < 0.2, `resting should restore stamina, got ${needs.fatigue}`);
  });

  test('fear decays when no threat is present but holds while one is', () => {
    const rng = new Rng(3);
    const needs = createNeeds(() => rng.next());
    const config = needsConfigFor(getSpecies('WINGULL'));
    applyFear(needs, 1);
    assert.equal(needs.fear, 1);

    for (let i = 0; i < 10; i++) {
      updateNeeds(needs, config, 1, {
        isActiveHour: true, isResting: false, isMoving: true, hasThreat: true, packNearby: true,
      });
    }
    assert.ok(needs.fear > 0.9, 'fear should hold while the threat remains');

    for (let i = 0; i < 200; i++) {
      updateNeeds(needs, config, 1, {
        isActiveHour: true, isResting: false, isMoving: true, hasThreat: false, packNearby: true,
      });
    }
    assert.ok(needs.fear < 0.1, 'fear should decay once the threat is gone');
  });

  test('fear immediately suppresses curiosity', () => {
    const rng = new Rng(4);
    const needs = createNeeds(() => rng.next());
    needs.curiosity = 0.9;
    applyFear(needs, 0.8);
    assert.ok(needs.curiosity < 0.45, 'a startled creature must stop investigating');
  });

  test('all needs stay within 0..1 under sustained pressure', () => {
    const rng = new Rng(5);
    const needs = createNeeds(() => rng.next());
    const config = needsConfigFor(getSpecies('SHARPEDO'));
    for (let i = 0; i < 5000; i++) {
      if (i % 50 === 0) applyFear(needs, 1);
      if (i % 37 === 0) applyAggression(needs, 1);
      updateNeeds(needs, config, 1, {
        isActiveHour: i % 2 === 0, isResting: i % 3 === 0, isMoving: true,
        hasThreat: i % 5 === 0, packNearby: i % 7 === 0,
      });
      for (const [k, v] of Object.entries(needs)) {
        assert.ok(v >= 0 && v <= 1, `${k} escaped bounds: ${v}`);
      }
    }
  });

  test('temperament shapes the baselines the brief calls for', () => {
    const apex = needsConfigFor(getSpecies('BEWEAR'));
    const timid = needsConfigFor(getSpecies('WINGULL'));
    const curious = needsConfigFor(getSpecies('PIKACHU'));

    assert.ok(curious.baseCuriosity > timid.baseCuriosity, 'Pikachu must be more curious than Wingull');
    assert.ok(apex.baseSociability > timid.baseSociability * 0.5, 'Bewear is protective, so social');
    assert.ok(timid.fearDecay < apex.fearDecay, 'a timid species stays frightened longer');
  });

  test('dominantNeed reports the strongest drive', () => {
    const rng = new Rng(6);
    const needs = createNeeds(() => rng.next());
    needs.fear = 0.99;
    assert.equal(dominantNeed(needs), 'fear');
  });
});

// ------------------------------------------------------------------- memory

describe('Memory and relationships', () => {
  test('feeding builds affinity, attacking destroys it', () => {
    const mem = new AgentMemory();
    for (let i = 0; i < 5; i++) {
      mem.remember({ subject: 'player1', kind: 'fed', at: i, intensity: 1, x: 0, z: 0 });
    }
    const friendly = mem.affinityToward('player1', 5);
    assert.ok(friendly > 0.4, `feeding should build affinity, got ${friendly}`);

    mem.remember({ subject: 'player1', kind: 'attacked', at: 6, intensity: 1, x: 0, z: 0 });
    const afterAttack = mem.affinityToward('player1', 6);
    assert.ok(afterAttack < friendly, 'attacking must cost affinity');
  });

  test('negative memories outweigh positive ones', () => {
    const good = new AgentMemory();
    good.remember({ subject: 'p', kind: 'fed', at: 0, intensity: 1, x: 0, z: 0 });
    const bad = new AgentMemory();
    bad.remember({ subject: 'p', kind: 'attacked', at: 0, intensity: 1, x: 0, z: 0 });
    assert.ok(
      Math.abs(bad.affinityToward('p', 0)) > Math.abs(good.affinityToward('p', 0)),
      'one attack should weigh more than one berry',
    );
  });

  test('strangers have no opinion, not a bad one', () => {
    const mem = new AgentMemory();
    assert.equal(mem.affinityToward('never-met', 100), 0);
    assert.equal(dispositionFor(0, 0), 'neutral');
  });

  test('familiarity gates how far affinity moves the disposition', () => {
    // Strong affinity from a stranger is not fully trusted.
    assert.notEqual(dispositionFor(0.9, 0), 'bonded');
    assert.equal(dispositionFor(0.9, 1), 'bonded');
  });

  test('memory capacity is bounded', () => {
    const mem = new AgentMemory({ capacity: 5, maxRelationships: 3 });
    for (let i = 0; i < 50; i++) {
      mem.remember({ subject: `subject${i}`, kind: 'startled', at: i, intensity: 0.5, x: 0, z: 0 });
    }
    assert.ok(mem.episodeCount <= 5, `episodes unbounded: ${mem.episodeCount}`);
    assert.ok(mem.relationshipCount <= 3, `relationships unbounded: ${mem.relationshipCount}`);
  });

  test('affinity decays with time since last contact', () => {
    const mem = new AgentMemory({ halfLife: 100 });
    mem.remember({ subject: 'p', kind: 'befriended', at: 0, intensity: 1, x: 0, z: 0 });
    const fresh = mem.affinityToward('p', 0);
    const stale = mem.affinityToward('p', 10000);
    assert.ok(stale < fresh * 0.5, 'affinity should fade');
  });

  test('strong negative memories mark the place, not just the subject', () => {
    const mem = new AgentMemory();
    mem.remember({ subject: 'p', kind: 'attacked', at: 0, intensity: 1, x: 100, z: 200 });
    assert.ok(mem.avoidanceAt(100, 200, 1) > 0, 'the location should be avoided');
    assert.equal(mem.avoidanceAt(5000, 5000, 1), 0, 'unrelated places should not be');
  });

  test('avoidance markers expire', () => {
    const mem = new AgentMemory({ halfLife: 10 });
    mem.remember({ subject: 'p', kind: 'hunted', at: 0, intensity: 1, x: 0, z: 0 });
    assert.ok(mem.avoidanceAt(0, 0, 1) > 0);
    assert.equal(mem.avoidanceAt(0, 0, 1000), 0, 'old fears should fade');
  });

  test('relationships survive save/restore', () => {
    const mem = new AgentMemory();
    mem.remember({ subject: 'player1', kind: 'befriended', at: 0, intensity: 1, x: 0, z: 0 });
    const saved = mem.save();
    const other = new AgentMemory();
    other.restore(saved);
    assert.equal(other.affinityToward('player1', 0), mem.affinityToward('player1', 0));
  });
});

// --------------------------------------------------------------- perception

describe('Perception', () => {
  test('sees what is in front and misses what is behind', () => {
    const species = getSpecies('GROWLITHE');
    const inFront = makeAgent({ id: 2, position: vec3(0, 0, -10), playerId: 'p1', noise: 0 });
    const behind = makeAgent({ id: 3, position: vec3(0, 0, 10), playerId: 'p2', noise: 0 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([inFront, behind]);

    // Facing -Z (yaw 0).
    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10,
      predators: [], prey: [],
    }, 1);

    const seenIds = result.percepts.filter((p) => p.seen).map((p) => p.agent.id);
    assert.ok(seenIds.includes(2), 'should see what is in front');
    assert.ok(!seenIds.includes(3), 'should not see what is directly behind');
  });

  test('hears what it cannot see, if the target is loud enough', () => {
    const species = getSpecies('GROWLITHE');
    const loudBehind = makeAgent({ id: 3, position: vec3(0, 0, 12), playerId: 'p2', noise: 1 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([loudBehind]);

    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10,
      predators: [], prey: [],
    }, 1);

    const percept = result.percepts.find((p) => p.agent.id === 3);
    assert.ok(percept, 'a loud target behind should be heard');
    assert.equal(percept!.seen, false, 'heard, not seen');
    assert.ok(percept!.clarity > 0 && percept!.clarity < 0.5, 'hearing is low clarity');
  });

  test('a silent target behind is not perceived at all — stealth works', () => {
    const species = getSpecies('GROWLITHE');
    const sneaking = makeAgent({ id: 3, position: vec3(0, 0, 25), playerId: 'p2', noise: 0 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([sneaking]);
    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10, predators: [], prey: [],
    }, 1);
    assert.equal(result.percepts.length, 0, 'a quiet approach from behind should go unnoticed');
  });

  test('classifies predators, prey, pack-mates and players', () => {
    const species = getSpecies('WISHIWASHI');
    const predator = makeAgent({ id: 2, position: vec3(0, 0, -6), speciesId: 'SHARPEDO', level: 30 });
    const packmate = makeAgent({ id: 3, position: vec3(2, 0, -3), speciesId: 'WISHIWASHI', packId: 7 });
    const player = makeAgent({ id: 4, position: vec3(-2, 0, -5), playerId: 'p1', level: 20 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([predator, packmate, player]);

    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: 7, level: 12,
      predators: ['SHARPEDO'], prey: [],
    }, 1);

    assert.equal(result.nearestThreat?.agent.id, 2, 'Sharpedo should register as the threat');
    assert.equal(result.nearestPackmate?.agent.id, 3);
    assert.equal(result.nearestPlayer?.agent.id, 4);
    assert.equal(result.packCount, 1);
  });

  test('a stronger Pokémon reads as dangerous even without being a designated predator', () => {
    const species = getSpecies('PIKACHU');
    const bewear = makeAgent({ id: 2, position: vec3(0, 0, -8), speciesId: 'BEWEAR', level: 45 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([bewear]);
    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10, predators: [], prey: [],
    }, 1);
    assert.ok((result.nearestThreat?.threat ?? 0) > 0, 'a much stronger creature should read as a threat');
  });

  test('a sleeping Pokémon cannot see and hears poorly', () => {
    const species = getSpecies('PIKACHU');
    const near = makeAgent({ id: 2, position: vec3(0, 0, -5), playerId: 'p1', noise: 0.2 });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([near]);

    const awake = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10, predators: [], prey: [],
    }, 1);
    const asleep = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10, predators: [], prey: [], asleep: true,
    }, 1);

    assert.ok(awake.percepts.some((p) => p.seen), 'awake should see');
    assert.ok(!asleep.percepts.some((p) => p.seen), 'asleep must not see');
  });

  test('inactive agents are ignored', () => {
    const species = getSpecies('PIKACHU');
    const fainted = makeAgent({ id: 2, position: vec3(0, 0, -5), inactive: true });
    const grid = new SpatialHash<PerceivableAgent>(16);
    grid.rebuild([fainted]);
    const result = perceive(grid, {
      species, position: vec3(), yaw: 0, packId: -1, level: 10, predators: [], prey: [],
    }, 1);
    assert.equal(result.percepts.length, 0);
  });

  test('visibility degrades with fog, and nocturnal species suffer less in the dark', () => {
    const clearDay = visibilityFrom(0.3, 1, false);
    const foggy = visibilityFrom(3.4, 1, false);
    assert.ok(foggy < clearDay * 0.6, 'fog must impair sight');

    const diurnalNight = visibilityFrom(0.3, 0, false);
    const nocturnalNight = visibilityFrom(0.3, 0, true);
    assert.ok(nocturnalNight > diurnalNight, 'nocturnal species see better at night');
  });

  test('canSee agrees with the FOV cone', () => {
    const species = getSpecies('GROWLITHE');
    assert.ok(canSee(vec3(), 0, species, vec3(0, 0, -10)), 'target ahead');
    assert.ok(!canSee(vec3(), 0, species, vec3(0, 0, 10)), 'target behind');
    assert.ok(!canSee(vec3(), 0, species, vec3(0, 0, -10000)), 'target out of range');
  });
});

// ------------------------------------------------------------------ steering

describe('Steering and flocking', () => {
  test('separation pushes crowded boids apart', () => {
    const self: Boid = { id: 1, position: vec3(0, 0, 0), velocity: vec3(), packId: 1 };
    const crowd: Boid[] = [
      { id: 2, position: vec3(0.5, 0, 0), velocity: vec3(), packId: 1 },
      { id: 3, position: vec3(0.6, 0, 0.1), velocity: vec3(), packId: 1 },
    ];
    const out = vec3();
    flock(self, crowd, {
      separation: 1, alignment: 0, cohesion: 0, separationRadius: 3, cohesionRadius: 10,
    }, out);
    assert.ok(out.x < 0, 'should be pushed away from the crowd on its right');
  });

  test('cohesion pulls a straggler toward the group', () => {
    const self: Boid = { id: 1, position: vec3(0, 0, 0), velocity: vec3(), packId: 1 };
    const group: Boid[] = [
      { id: 2, position: vec3(10, 0, 0), velocity: vec3(), packId: 1 },
      { id: 3, position: vec3(12, 0, 2), velocity: vec3(), packId: 1 },
    ];
    const out = vec3();
    flock(self, group, {
      separation: 0, alignment: 0, cohesion: 1, separationRadius: 1, cohesionRadius: 30,
    }, out);
    assert.ok(out.x > 0, 'should steer toward the group');
  });

  test('flocking considers at most seven neighbours', () => {
    const self: Boid = { id: 0, position: vec3(), velocity: vec3(), packId: 1 };
    const many: Boid[] = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1, position: vec3(Math.cos(i) * 5, 0, Math.sin(i) * 5), velocity: vec3(), packId: 1,
    }));
    const out = vec3();
    // Should complete instantly and produce a finite result regardless of size.
    flock(self, many, {
      separation: 1, alignment: 1, cohesion: 1, separationRadius: 3, cohesionRadius: 20,
    }, out);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z));
  });

  test('arrive decelerates into the target', () => {
    const far = arrive(vec3(0, 0, 0), vec3(100, 0, 0), 10, vec3());
    const near = arrive(vec3(0, 0, 0), vec3(2, 0, 0), 10, vec3());
    assert.ok(Math.hypot(far.x, far.z) > Math.hypot(near.x, near.z), 'should slow when close');
  });

  test('territory containment only engages near the boundary', () => {
    const inside = containWithin(vec3(5, 0, 0), vec3(), 100, vec3());
    assert.equal(Math.hypot(inside.x, inside.z), 0, 'no force well inside the territory');
    const edge = containWithin(vec3(95, 0, 0), vec3(), 100, vec3());
    assert.ok(edge.x < 0, 'should pull back toward home near the edge');
  });

  test('priority truncation lets a critical force dominate', () => {
    const critical = seek(vec3(), vec3(-1, 0, 0), vec3());
    const soft = seek(vec3(), vec3(1, 0, 0), vec3());
    const out = combineSteering([
      { force: critical, weight: 1 },
      { force: soft, weight: 1 },
    ], 1, vec3());
    // The first force consumes the whole budget, so the second cannot cancel it.
    assert.ok(out.x < -0.5, 'the higher-priority force should win outright');
  });
});

// ----------------------------------------------------------------- profiles

describe('Species profiles match the design brief', () => {
  test('Pikachu is curious, playful and social', () => {
    const p = profileFor('PIKACHU');
    assert.ok(p.goalBias.investigate > 1, 'should be biased toward investigating');
    assert.ok(p.goalBias.play > 1, 'should be biased toward playing');
    assert.ok(p.flockWeight > 0.5, 'should be social');
    assert.ok(p.goals.some((g) => g.name === 'greet'));
  });

  test('Bewear is protective and extremely committed', () => {
    const p = profileFor('BEWEAR');
    assert.ok(p.goalBias.protect >= 2, 'protection must dominate');
    assert.ok(p.cohesionRadius >= 50, 'must track its young across a wide area');
    assert.ok(p.pursuitRange > 100, 'must pursue far');
    assert.ok(p.fearSensitivity < 0.4, 'should be hard to frighten');
  });

  test('Sharpedo is an aggressive predator that never flees', () => {
    const p = profileFor('SHARPEDO');
    assert.ok(!willFlee('SHARPEDO'), 'Sharpedo must have no flee goal at all');
    assert.ok(isHostile('SHARPEDO'), 'should attack unprovoked');
    assert.ok(p.goalBias.hunt > 1.5);
    assert.ok(p.pursuitRange > 100);
  });

  test('Lapras is peaceful — neither flees nor attacks', () => {
    const p = profileFor('LAPRAS');
    assert.ok(!p.goals.some((g) => g.name === 'attack'), 'Lapras must not attack');
    assert.ok(!p.goals.some((g) => g.name === 'flee'), 'Lapras must not flee');
    assert.ok(!isHostile('LAPRAS'));
  });

  test('Wingull travels in flocks', () => {
    const p = profileFor('WINGULL');
    assert.equal(p.flockWeight, 1.0, 'maximum flocking');
    assert.ok(p.goalBias.regroup >= 2, 'strongly driven to rejoin the flock');
    assert.ok(p.decisionInterval <= 0.25, 'must react fast enough to move as one body');
  });

  test('Growlithe guards territory and disengages at the boundary', () => {
    const p = profileFor('GROWLITHE');
    assert.ok(p.goalBias['defend-territory'] > 1.5);
    assert.ok(p.goalBias['return-home'] > 1.5, 'must return to its post');
    const species = getSpecies('GROWLITHE');
    assert.ok(species.territoryRadius > 0, 'must actually have a territory');
    assert.ok(p.pursuitRange < species.territoryRadius * 1.5, 'must not chase forever');
  });

  test('every species resolves to a valid profile', () => {
    for (const id of ['PIKACHU', 'BEWEAR', 'SHARPEDO', 'LAPRAS', 'WINGULL', 'GROWLITHE',
                      'MAGIKARP', 'TAPU_KOKO', 'GUZZLORD', 'MIMIKYU', 'LURANTIS']) {
      const p = profileFor(id);
      assert.ok(p.goals.length > 0, `${id} has no goals`);
      assert.ok(p.decisionInterval > 0, `${id} has a zero decision interval`);
      assert.ok(p.notes.length > 10, `${id} lacks designer notes`);
      // Biased goals must all be real.
      for (const g of biasedGoalsFor(id)) {
        assert.ok(ALL_GOALS.some((a) => a.name === g.name), `${id} references unknown goal ${g.name}`);
        assert.ok((g.priority ?? 1) > 0);
      }
    }
  });
});

// -------------------------------------------------------------------- brain

describe('PokemonBrain integration', () => {
  test('a lone Pokémon in an empty world wanders without crashing', () => {
    const brain = makeBrain('PIKACHU');
    const world = makeWorld();
    for (let i = 0; i < 600; i++) {
      world.now = i / 60;
      brain.update(1 / 60, world);
    }
    assert.ok(Number.isFinite(brain.state.position.x), 'position must stay finite');
    assert.ok(brain.currentGoal !== null, 'a goal should always be selected');
  });

  test('a prey species flees from an approaching predator', () => {
    const brain = makeBrain('WINGULL', 1, vec3(0, 0, 0));
    const predator = makeAgent({
      id: 99, position: vec3(0, 0, -8), speciesId: 'SHARPEDO', level: 40, noise: 1,
    });
    const world = makeWorld([
      makeAgent({ id: 1, position: brain.state.position, speciesId: 'WINGULL' }),
      predator,
    ]);

    let fled = false;
    for (let i = 0; i < 400; i++) {
      world.now = i / 60;
      world.grid.rebuild([
        { ...makeAgent({ id: 1, speciesId: 'WINGULL' }), position: brain.state.position },
        predator,
      ]);
      brain.update(1 / 60, world);
      if (brain.currentGoal === 'flee') fled = true;
    }
    assert.ok(fled, 'a Wingull should flee a nearby Sharpedo');
    // And it should have actually moved away.
    assert.ok(brain.state.position.z > 0.5, 'should have moved away from the threat');
  });

  test('Sharpedo hunts rather than fleeing', () => {
    const brain = makeBrain('SHARPEDO', 1, vec3(0, 0, 0));
    brain.needs.hunger = 0.9;
    const prey = makeAgent({ id: 50, position: vec3(0, 0, -15), speciesId: 'WISHIWASHI', level: 12 });
    const world = makeWorld([
      makeAgent({ id: 1, speciesId: 'SHARPEDO', level: 30 }),
      prey,
    ]);

    let hunted = false;
    for (let i = 0; i < 300; i++) {
      world.now = i / 60;
      world.grid.rebuild([
        { ...makeAgent({ id: 1, speciesId: 'SHARPEDO', level: 30 }), position: brain.state.position },
        prey,
      ]);
      brain.update(1 / 60, world);
      if (brain.currentGoal === 'hunt') hunted = true;
      assert.notEqual(brain.currentGoal, 'flee', 'Sharpedo must never flee');
    }
    assert.ok(hunted, 'a hungry Sharpedo near prey should hunt');
  });

  test('a remembered friend does not trigger fear', () => {
    const brain = makeBrain('PIKACHU', 1, vec3(0, 0, 0));
    // Build a strong positive relationship first.
    for (let i = 0; i < 8; i++) {
      brain.memory.remember({ subject: 'player1', kind: 'befriended', at: 0, intensity: 1, x: 0, z: 0 });
      brain.memory.remember({ subject: 'player1', kind: 'fed', at: 0, intensity: 1, x: 0, z: 0 });
    }
    assert.equal(brain.dispositionToward('player1', 0), 'bonded');

    const player = makeAgent({ id: 42, position: vec3(0, 0, -6), playerId: 'player1', level: 50, noise: 0.5 });
    const world = makeWorld([makeAgent({ id: 1, speciesId: 'PIKACHU' }), player]);

    for (let i = 0; i < 120; i++) {
      world.now = i / 60;
      world.grid.rebuild([
        { ...makeAgent({ id: 1, speciesId: 'PIKACHU' }), position: brain.state.position },
        player,
      ]);
      brain.update(1 / 60, world);
    }
    assert.ok(brain.needs.fear < 0.35, `a bonded Pokémon should not be afraid, fear=${brain.needs.fear}`);
  });

  test('a territorial species becomes aggressive when its territory is entered', () => {
    const brain = makeBrain('GROWLITHE', 1, vec3(0, 0, 0));
    const baselineAggression = brain.needs.aggression;
    const intruder = makeAgent({ id: 42, position: vec3(0, 0, -10), playerId: 'p1', level: 25, noise: 0.8 });
    const world = makeWorld([makeAgent({ id: 1, speciesId: 'GROWLITHE' }), intruder]);

    for (let i = 0; i < 200; i++) {
      world.now = i / 60;
      world.grid.rebuild([
        { ...makeAgent({ id: 1, speciesId: 'GROWLITHE' }), position: brain.state.position },
        intruder,
      ]);
      brain.update(1 / 60, world);
    }
    assert.ok(brain.needs.aggression > baselineAggression, 'an intruder should raise aggression');
  });

  test('LOD tiers are assigned by distance', () => {
    assert.equal(lodForDistance(10), BrainLod.Full);
    assert.equal(lodForDistance(100), BrainLod.Reduced);
    assert.equal(lodForDistance(300), BrainLod.Coarse);
    assert.equal(lodForDistance(2000), BrainLod.Dormant);
  });

  test('a dormant brain consumes no simulation — distant Pokémon do not starve', () => {
    const brain = makeBrain('PIKACHU');
    brain.state.lod = BrainLod.Dormant;
    const hungerBefore = brain.needs.hunger;
    const posBefore = { ...brain.state.position };
    const world = makeWorld();
    for (let i = 0; i < 10000; i++) brain.update(1 / 60, world);
    assert.equal(brain.needs.hunger, hungerBefore, 'dormant agents must not accumulate needs');
    assert.deepEqual(brain.state.position, posBefore, 'dormant agents must not move');
  });

  test('a coarse brain drifts but stays near home', () => {
    const brain = makeBrain('PIKACHU', 1, vec3(100, 0, 100));
    brain.state.lod = BrainLod.Coarse;
    const world = makeWorld();
    for (let i = 0; i < 6000; i++) {
      world.now = i / 60;
      brain.update(1 / 60, world);
    }
    const dist = Math.hypot(
      brain.state.position.x - brain.state.home.x,
      brain.state.position.z - brain.state.home.z,
    );
    const territory = Math.max(20, getSpecies('PIKACHU').territoryRadius);
    assert.ok(dist < territory * 2.5, `coarse agent wandered too far: ${dist.toFixed(0)}m`);
    assert.ok(Number.isFinite(brain.state.position.x));
  });

  test('brains stay stable under many agents and long runtimes', () => {
    const brains: PokemonBrain[] = [];
    const rng = new Rng(77);
    const speciesPool = ['PIKACHU', 'WINGULL', 'GROWLITHE', 'SHARPEDO', 'LAPRAS', 'BEWEAR', 'STUFFUL'];
    for (let i = 0; i < 60; i++) {
      const sp = speciesPool[i % speciesPool.length];
      brains.push(makeBrain(sp, i + 1, vec3(rng.range(-50, 50), 0, rng.range(-50, 50))));
    }

    const world = makeWorld();
    for (let tick = 0; tick < 900; tick++) {
      world.now = tick / 60;
      world.grid.rebuild(
        brains.map((b) => ({
          id: b.state.id,
          position: b.state.position,
          speciesId: b.state.speciesId,
          packId: b.state.packId,
          playerId: null,
          noise: 0.4,
          inactive: false,
          level: b.state.level,
        })),
      );
      for (const b of brains) b.update(1 / 60, world);
    }

    for (const b of brains) {
      assert.ok(Number.isFinite(b.state.position.x), `${b.state.speciesId} position went NaN`);
      assert.ok(Number.isFinite(b.state.position.z));
      assert.ok(Number.isFinite(b.state.yaw), 'yaw went NaN');
      for (const [k, v] of Object.entries(b.needs)) {
        assert.ok(v >= 0 && v <= 1, `${b.state.speciesId}.${k} escaped bounds: ${v}`);
      }
    }
  });

  test('inspect() reports a usable snapshot for the debug overlay', () => {
    const brain = makeBrain('PIKACHU');
    const world = makeWorld();
    for (let i = 0; i < 60; i++) brain.update(1 / 60, world);
    const snap = brain.inspect();
    assert.equal(snap.species, 'PIKACHU');
    assert.ok(snap.goal !== undefined);
    assert.ok(snap.needs.hunger >= 0);
  });
});
