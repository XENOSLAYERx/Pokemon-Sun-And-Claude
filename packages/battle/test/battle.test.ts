import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@alola/core';
import { getMove, getTrial, getZMove } from '@alola/data';
import {
  createField, activePokemon, opponentsOf, sideHasFighters,
  type BattleState, type BattlePokemon, type BattleAction, type BattleArena, type BattleEvent,
} from '../src/engine/state.ts';
import { BattleEngine, makeBattlePokemon } from '../src/engine/engine.ts';
import {
  calculateDamage, accuracyCheck, effectiveStat, effectiveSpeed,
  stageMultiplier, sortByTurnOrder, computeStat, catchProbability, critChance,
} from '../src/calc/damage.ts';
import {
  registerTotem, clearTotemRegistry, applyTotemAura, totemEncounterFor, totemHpMultiplier,
} from '../src/totem/totem.ts';
import { BattleAi } from '../src/ai/trainer-ai.ts';
import { generateArena, surfaceForBiome, cameraRigFor, resolveEnvironmentReactions, musicFor } from '../src/arena/arena.ts';
import type { TerrainProbe } from '../src/arena/arena.ts';
import { evaluatePose, buildCinematic, beatAt, shakeAt, timeScaleAt } from '../src/zmove/cinematic.ts';

// ---------------------------------------------------------------- helpers

const TEST_ARENA: BattleArena = {
  biome: 'grassland', surface: 'foliage', x: 0, z: 0, y: 10, radius: 14,
  weather: null, hour: 12, island: 'melemele', enclosed: false,
};

function makeState(opts: {
  playerTeam: { species: string; level: number; moves: string[]; ability?: string; item?: string | null }[];
  foeTeam: { species: string; level: number; moves: string[]; ability?: string; item?: string | null }[];
  format?: 'single' | 'double';
  zCrystal?: string | null;
  arena?: BattleArena;
}): BattleState {
  const format = opts.format ?? 'single';
  const slots = format === 'double' ? 2 : 1;
  const pokemon = new Map<number, BattlePokemon>();
  let nextId = 1;

  const build = (
    team: typeof opts.playerTeam,
    side: number,
  ): number[] => {
    const ids: number[] = [];
    team.forEach((entry, i) => {
      const p = makeBattlePokemon({
        id: nextId++,
        speciesId: entry.species,
        level: entry.level,
        moves: entry.moves,
        ability: entry.ability,
        item: entry.item ?? null,
        side,
        slot: i < slots ? i : -1,
      });
      pokemon.set(p.id, p);
      ids.push(p.id);
    });
    return ids;
  };

  const playerIds = build(opts.playerTeam, 0);
  const foeIds = build(opts.foeTeam, 1);

  return {
    format,
    slotsPerSide: slots,
    sides: [
      {
        index: 0, trainerName: 'Player', isPlayer: true,
        active: playerIds.slice(0, slots),
        party: playerIds, conditions: new Map(),
        zUsed: false, zCrystal: opts.zCrystal ?? null,
      },
      {
        index: 1, trainerName: 'Foe', isPlayer: false,
        active: foeIds.slice(0, slots),
        party: foeIds, conditions: new Map(),
        zUsed: false, zCrystal: null,
      },
    ],
    pokemon,
    field: createField(),
    turn: 0,
    winner: null,
    ended: false,
    arena: opts.arena ?? TEST_ARENA,
  };
}

function simpleBattle(seed = 1): { engine: BattleEngine; state: BattleState } {
  const state = makeState({
    playerTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunderbolt', 'quick-attack', 'thunder-wave', 'protect'] }],
    foeTeam: [{ species: 'WINGULL', level: 50, moves: ['air-slash', 'surf', 'quick-attack', 'protect'] }],
  });
  return { engine: new BattleEngine(state, { seed }), state };
}

function findEvent<T extends BattleEvent['type']>(events: BattleEvent[], type: T): Extract<BattleEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<BattleEvent, { type: T }> | undefined;
}

// ------------------------------------------------------------ damage maths

describe('Damage calculation', () => {
  test('stage multipliers follow the canonical table', () => {
    assert.equal(stageMultiplier(0), 1);
    assert.equal(stageMultiplier(1), 1.5);
    assert.equal(stageMultiplier(2), 2);
    assert.equal(stageMultiplier(6), 4);
    assert.equal(stageMultiplier(-1), 2 / 3);
    assert.equal(stageMultiplier(-6), 0.25);
    // Clamped beyond the legal range.
    assert.equal(stageMultiplier(99), 4);
    assert.equal(stageMultiplier(-99), 0.25);
  });

  test('stat computation matches the series formula', () => {
    // Level 100, base 100, 31 IV, 0 EV, neutral nature => 236 for a non-HP stat.
    assert.equal(computeStat(100, 31, 0, 100, 1, false), 236);
    // HP with the same inputs => 341.
    assert.equal(computeStat(100, 31, 0, 100, 1, true), 341);
    // Shedinja's base-1 HP special case.
    assert.equal(computeStat(1, 31, 0, 100, 1, true), 1);
  });

  test('super effective damage exceeds neutral, which exceeds resisted', () => {
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunderbolt'], side: 0, slot: 0,
    });
    const weakTo = makeBattlePokemon({
      id: 2, speciesId: 'WINGULL', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const resists = makeBattlePokemon({
      id: 3, speciesId: 'GEODUDE_ALOLA', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const rng = new Rng(1);
    const move = getMove('thunderbolt');

    const superEff = calculateDamage({
      attacker, defender: weakTo, move, weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const resisted = calculateDamage({
      attacker, defender: resists, move, weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);

    assert.equal(superEff.effectiveness, 4, 'Electric is 2x vs Water and 2x vs Flying');
    assert.equal(resisted.effectiveness, 0.5, 'Alolan Geodude is Rock/Electric: 1x vs Rock * 0.5x vs Electric');
    assert.ok(superEff.damage > resisted.damage);
  });

  test('immunity deals no damage and is reported', () => {
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunderbolt'], side: 0, slot: 0,
    });
    // Alolan Geodude is Rock/Electric — Electric does not hit Ground, but
    // Geodude-Alola is not Ground. Use a real immunity: Normal vs Ghost.
    const ghost = makeBattlePokemon({
      id: 2, speciesId: 'MIMIKYU', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const result = calculateDamage({
      attacker, defender: ghost, move: getMove('tackle'),
      weather: null, terrain: null, targetCount: 1, critical: false, noRandom: true,
    }, new Rng(1));
    assert.equal(result.damage, 0);
    assert.equal(result.effectiveness, 0);
    assert.ok(result.immune);
  });

  test('STAB increases damage', () => {
    const rng = new Rng(5);
    // Wingull, not Mudbray: a Ground type is immune to Electric, which would
    // short-circuit the calculation before STAB is ever applied.
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'WINGULL', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    // Pikachu is Electric, so Thunderbolt gets STAB.
    const pikachu = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunderbolt'], side: 0, slot: 0,
    });
    const withStab = calculateDamage({
      attacker: pikachu, defender, move: getMove('thunderbolt'),
      weather: null, terrain: null, targetCount: 1, critical: false, noRandom: true,
    }, rng);
    assert.equal(withStab.breakdown.stab, 1.5);
  });

  test('weather modifies damage in both directions', () => {
    const rng = new Rng(7);
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'POPPLIO', level: 50, moves: ['surf'], side: 0, slot: 0,
    });
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'MUDBRAY', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const base = calculateDamage({
      attacker, defender, move: getMove('surf'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const inRain = calculateDamage({
      attacker, defender, move: getMove('surf'), weather: 'rain', terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const inSun = calculateDamage({
      attacker, defender, move: getMove('surf'), weather: 'harsh-sunlight', terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);

    assert.ok(inRain.damage > base.damage, 'rain should boost Water moves');
    assert.ok(inSun.damage < base.damage, 'sun should weaken Water moves');
  });

  test('critical hits ignore the defender’s positive defence stages', () => {
    const rng = new Rng(11);
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunderbolt'], side: 0, slot: 0,
    });
    // Wingull, not a Ground type: Electric cannot touch Ground at all, which
    // would make both the crit and non-crit results zero.
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'WINGULL', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    defender.stages.spd = 4; // Heavily boosted special defence.

    const normal = calculateDamage({
      attacker, defender, move: getMove('thunderbolt'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const crit = calculateDamage({
      attacker, defender, move: getMove('thunderbolt'), weather: null, terrain: null,
      targetCount: 1, critical: true, noRandom: true,
    }, rng);

    // A crit should be far more than 1.5x here, because it also discards the
    // +4 defence boost.
    assert.ok(crit.damage > normal.damage * 2, `crit ${crit.damage} vs normal ${normal.damage}`);
  });

  test('burn halves physical damage but not special', () => {
    const rng = new Rng(13);
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'MUDBRAY', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const healthy = makeBattlePokemon({
      id: 1, speciesId: 'LITTEN', level: 50, moves: ['tackle'], side: 0, slot: 0,
    });
    const burned = makeBattlePokemon({
      id: 3, speciesId: 'LITTEN', level: 50, moves: ['tackle'], side: 0, slot: 0,
    });
    burned.status = 'burn';

    const physHealthy = calculateDamage({
      attacker: healthy, defender, move: getMove('tackle'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const physBurned = calculateDamage({
      attacker: burned, defender, move: getMove('tackle'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    assert.ok(physBurned.damage < physHealthy.damage, 'burn must reduce physical damage');

    const specHealthy = calculateDamage({
      attacker: healthy, defender, move: getMove('flamethrower'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const specBurned = calculateDamage({
      attacker: burned, defender, move: getMove('flamethrower'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    assert.equal(specBurned.damage, specHealthy.damage, 'burn must not reduce special damage');
  });

  test('spread moves deal less to each target', () => {
    const rng = new Rng(17);
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'POPPLIO', level: 50, moves: ['surf'], side: 0, slot: 0,
    });
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'MUDBRAY', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const single = calculateDamage({
      attacker, defender, move: getMove('surf'), weather: null, terrain: null,
      targetCount: 1, critical: false, noRandom: true,
    }, rng);
    const spread = calculateDamage({
      attacker, defender, move: getMove('surf'), weather: null, terrain: null,
      targetCount: 2, critical: false, noRandom: true,
    }, rng);
    assert.ok(spread.damage < single.damage);
  });

  test('damage is always at least 1 for a connecting move', () => {
    const rng = new Rng(19);
    const weak = makeBattlePokemon({
      id: 1, speciesId: 'MAGIKARP', level: 1, moves: ['tackle'], side: 0, slot: 0,
    });
    const tanky = makeBattlePokemon({
      id: 2, speciesId: 'GEODUDE_ALOLA', level: 100, moves: ['tackle'], side: 1, slot: 0,
    });
    tanky.stages.def = 6;
    const result = calculateDamage({
      attacker: weak, defender: tanky, move: getMove('tackle'),
      weather: null, terrain: null, targetCount: 1, critical: false, noRandom: true,
    }, rng);
    assert.ok(result.damage >= 1);
  });

  test('the random roll stays within 85-100%', () => {
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunderbolt'], side: 0, slot: 0,
    });
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'WINGULL', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const rng = new Rng(23);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const r = calculateDamage({
        attacker, defender, move: getMove('thunderbolt'), weather: null, terrain: null,
        targetCount: 1, critical: false,
      }, rng);
      min = Math.min(min, r.damage);
      max = Math.max(max, r.damage);
      assert.ok(r.breakdown.randomMod >= 0.85 && r.breakdown.randomMod <= 1.0);
    }
    assert.ok(max > min, 'the roll should actually vary');
    assert.ok(min / max >= 0.8, `spread too wide: ${min}..${max}`);
  });

  test('critical-hit rates match the stage table', () => {
    assert.equal(critChance(0), 1 / 24);
    assert.equal(critChance(1), 1 / 8);
    assert.equal(critChance(2), 1 / 2);
    assert.equal(critChance(3), 1);
  });

  test('accuracy checks respect never-miss moves and stages', () => {
    const attacker = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['thunder-wave', 'swords-dance'], side: 0, slot: 0,
    });
    const defender = makeBattlePokemon({
      id: 2, speciesId: 'WINGULL', level: 50, moves: ['tackle'], side: 1, slot: 0,
    });
    const rng = new Rng(29);
    // Swords Dance has null accuracy — it can never miss.
    for (let i = 0; i < 100; i++) {
      assert.ok(accuracyCheck(getMove('swords-dance'), attacker, defender, null, rng));
    }
    // Thunder never misses in rain.
    for (let i = 0; i < 100; i++) {
      assert.ok(accuracyCheck(getMove('thunder'), attacker, defender, 'rain', rng));
    }
    // Evasion boosts reduce hit rate.
    defender.stages.evasion = 6;
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (accuracyCheck(getMove('thunderbolt'), attacker, defender, null, rng)) hits++;
    }
    assert.ok(hits < 500, `max evasion should dodge often, hit ${hits}/1000`);
  });

  test('turn order respects priority, then speed, then Trick Room', () => {
    const entries = [
      { pokemonId: 1, priority: 0, speed: 200, tiebreak: 1 },
      { pokemonId: 2, priority: 1, speed: 50, tiebreak: 2 },
      { pokemonId: 3, priority: 0, speed: 100, tiebreak: 3 },
    ];
    const normal = sortByTurnOrder(entries, false).map((e) => e.pokemonId);
    assert.deepEqual(normal, [2, 1, 3], 'priority first, then speed');

    const trickRoom = sortByTurnOrder(entries, true).map((e) => e.pokemonId);
    assert.deepEqual(trickRoom, [2, 3, 1], 'Trick Room inverts speed but not priority');
  });

  test('effective speed accounts for paralysis and weather abilities', () => {
    const base = makeBattlePokemon({
      id: 1, speciesId: 'PIKACHU', level: 50, moves: ['tackle'], side: 0, slot: 0,
    });
    const normal = effectiveSpeed(base, null, false);

    const para = makeBattlePokemon({
      id: 2, speciesId: 'PIKACHU', level: 50, moves: ['tackle'], side: 0, slot: 0,
    });
    para.status = 'paralysis';
    assert.ok(effectiveSpeed(para, null, false) < normal, 'paralysis must halve speed');

    const swimmer = makeBattlePokemon({
      id: 3, speciesId: 'MAGIKARP', level: 50, moves: ['tackle'], ability: 'swift-swim', side: 0, slot: 0,
    });
    assert.ok(
      effectiveSpeed(swimmer, 'rain', false) > effectiveSpeed(swimmer, null, false),
      'Swift Swim should double speed in rain',
    );
    assert.ok(effectiveSpeed(base, null, true) > normal, 'Tailwind should double speed');
  });

  test('catch probability rises as HP falls', () => {
    const full = catchProbability(100, 100, 45, 1, 1);
    const weak = catchProbability(100, 5, 45, 1, 1);
    assert.ok(weak > full, 'a weakened target should be easier to catch');
    const master = catchProbability(100, 100, 45, 255, 1);
    assert.equal(master, 1, 'a Master Ball should never fail');
  });
});

// ------------------------------------------------------------ battle engine

describe('Battle engine', () => {
  test('is fully deterministic for a given seed', () => {
    const run = (): string => {
      const { engine, state } = simpleBattle(4242);
      const log: string[] = [];
      for (let turn = 0; turn < 30 && !state.ended; turn++) {
        const actions: BattleAction[] = [];
        for (const p of activePokemon(state, 0)) {
          actions.push({ kind: 'move', pokemonId: p.id, moveId: 'thunderbolt', targetId: state.sides[1].active[0] });
        }
        for (const p of activePokemon(state, 1)) {
          actions.push({ kind: 'move', pokemonId: p.id, moveId: 'air-slash', targetId: state.sides[0].active[0] });
        }
        for (const e of engine.executeTurn(actions)) {
          log.push(JSON.stringify(e));
        }
      }
      return log.join('|');
    };
    assert.equal(run(), run(), 'identical seeds must produce identical battles');
  });

  test('different seeds produce different battles', () => {
    const run = (seed: number): string => {
      // A bulky foe so the battle runs many turns and the rolls accumulate;
      // a one-shot KO caps damage at the target's HP for every seed alike.
      const state = makeState({
        playerTeam: [{ species: 'PIKACHU', level: 40, moves: ['thunderbolt'] }],
        foeTeam: [{ species: 'LAPRAS', level: 70, moves: ['protect'] }],
      });
      const engine = new BattleEngine(state, { seed });
      const log: string[] = [];
      for (let turn = 0; turn < 12 && !state.ended; turn++) {
        const events = engine.executeTurn([
          { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunderbolt', targetId: state.sides[1].active[0] },
          { kind: 'pass', pokemonId: state.sides[1].active[0] },
        ]);
        for (const e of events) if (e.type === 'damage') log.push(String(e.amount));
      }
      return log.join(',');
    };
    assert.notEqual(run(1), run(999), 'different seeds should produce different damage rolls');
  });

  test('a battle ends when one side has no fighters left', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 80, moves: ['thunderbolt'] }],
      foeTeam: [{ species: 'MAGIKARP', level: 5, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 3 });

    let ended = false;
    for (let turn = 0; turn < 20 && !state.ended; turn++) {
      const events = engine.executeTurn([
        { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunderbolt', targetId: state.sides[1].active[0] },
        { kind: 'move', pokemonId: state.sides[1].active[0], moveId: 'tackle', targetId: state.sides[0].active[0] },
      ]);
      if (findEvent(events, 'battle-end')) ended = true;
    }
    assert.ok(ended, 'the battle should have ended');
    assert.equal(state.winner, 0, 'the stronger side should win');
    assert.ok(!sideHasFighters(state, 1));
  });

  test('HP never goes negative and faint fires exactly once', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 100, moves: ['thunderbolt'] }],
      foeTeam: [{ species: 'MAGIKARP', level: 2, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 8 });
    const events = engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunderbolt', targetId: state.sides[1].active[0] },
      { kind: 'move', pokemonId: state.sides[1].active[0], moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    const target = state.pokemon.get(state.sides[1].active[0])!;
    assert.equal(target.hp, 0, 'HP must clamp to zero');
    assert.ok(target.fainted);
    const faints = events.filter((e) => e.type === 'faint' && e.pokemonId === target.id);
    assert.equal(faints.length, 1, 'faint must fire exactly once');
  });

  test('status conditions apply, respect immunities and deal residual damage', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunder-wave', 'toxic'] }],
      foeTeam: [{ species: 'MUDBRAY', level: 50, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 21 });
    const foeId = state.sides[1].active[0];
    const foe = state.pokemon.get(foeId)!;

    // Ground types are immune to Thunder Wave's paralysis? No — but Electric
    // types are. Use Toxic and check the residual instead.
    engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'toxic', targetId: foeId },
      { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    assert.equal(foe.status, 'badly-poison');

    const hpAfterPoison = foe.hp;
    engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunder-wave', targetId: foeId },
      { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    assert.ok(foe.hp < hpAfterPoison, 'Toxic must deal escalating residual damage');
  });

  test('Electric types cannot be paralysed', () => {
    const state = makeState({
      playerTeam: [{ species: 'WINGULL', level: 50, moves: ['tackle'] }],
      foeTeam: [{ species: 'PIKACHU', level: 50, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 5 });
    const pikachu = state.pokemon.get(state.sides[1].active[0])!;
    assert.equal(engine.applyStatus(pikachu, 'paralysis'), false);
    assert.equal(pikachu.status, 'none');
  });

  test('Fire types cannot be burned and Ice types cannot be frozen', () => {
    const state = makeState({
      playerTeam: [{ species: 'LITTEN', level: 50, moves: ['tackle'] }],
      foeTeam: [{ species: 'VULPIX_ALOLA', level: 50, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 5 });
    assert.equal(engine.applyStatus(state.pokemon.get(state.sides[0].active[0])!, 'burn'), false);
    assert.equal(engine.applyStatus(state.pokemon.get(state.sides[1].active[0])!, 'freeze'), false);
  });

  test('stat stages apply, clamp at +-6 and reset on switch', () => {
    const state = makeState({
      playerTeam: [
        { species: 'LITTEN', level: 50, moves: ['swords-dance'] },
        { species: 'PIKACHU', level: 50, moves: ['tackle'] },
      ],
      foeTeam: [{ species: 'MUDBRAY', level: 50, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 33 });
    const litten = state.pokemon.get(state.sides[0].active[0])!;
    const foeId = state.sides[1].active[0];

    for (let i = 0; i < 5; i++) {
      engine.executeTurn([
        { kind: 'move', pokemonId: litten.id, moveId: 'swords-dance', targetId: litten.id },
        { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: litten.id },
      ]);
    }
    assert.equal(litten.stages.atk, 6, 'Attack should cap at +6');

    // Switching out must reset the boosts.
    engine.executeTurn([
      { kind: 'switch', pokemonId: litten.id, incomingId: state.sides[0].party[1] },
      { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    assert.equal(litten.stages.atk, 0, 'stat stages must reset on switch-out');
  });

  test('Protect blocks damage for one turn only', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 50, moves: ['protect', 'quick-attack'] }],
      foeTeam: [{ species: 'MUDBRAY', level: 50, moves: ['high-horsepower'] }],
    });
    const engine = new BattleEngine(state, { seed: 41 });
    const pikachu = state.pokemon.get(state.sides[0].active[0])!;
    const foeId = state.sides[1].active[0];

    const hpBefore = pikachu.hp;
    engine.executeTurn([
      { kind: 'move', pokemonId: pikachu.id, moveId: 'protect', targetId: pikachu.id },
      { kind: 'move', pokemonId: foeId, moveId: 'high-horsepower', targetId: pikachu.id },
    ]);
    assert.equal(pikachu.hp, hpBefore, 'Protect should block all damage');

    engine.executeTurn([
      { kind: 'move', pokemonId: pikachu.id, moveId: 'quick-attack', targetId: foeId },
      { kind: 'move', pokemonId: foeId, moveId: 'high-horsepower', targetId: pikachu.id },
    ]);
    assert.ok(pikachu.hp < hpBefore, 'Protect must expire after one turn');
  });

  test('drain moves heal the user and recoil hurts it', () => {
    const state = makeState({
      playerTeam: [{ species: 'ROWLET', level: 50, moves: ['giga-drain', 'brave-bird'] }],
      foeTeam: [{ species: 'MUDBRAY', level: 60, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 55 });
    const user = state.pokemon.get(state.sides[0].active[0])!;
    const foeId = state.sides[1].active[0];

    user.hp = Math.floor(user.maxHp / 2);
    const before = user.hp;
    const events = engine.executeTurn([
      { kind: 'move', pokemonId: user.id, moveId: 'giga-drain', targetId: foeId },
      { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: user.id },
    ]);
    assert.ok(findEvent(events, 'heal'), 'Giga Drain should emit a heal');
    void before;

    // Recoil.
    const hpBeforeRecoil = user.hp;
    engine.executeTurn([
      { kind: 'move', pokemonId: user.id, moveId: 'brave-bird', targetId: foeId },
      { kind: 'move', pokemonId: foeId, moveId: 'tackle', targetId: user.id },
    ]);
    assert.ok(user.hp < hpBeforeRecoil, 'Brave Bird recoil should hurt the user');
  });

  test('multi-hit moves land between 2 and 5 times', () => {
    const state = makeState({
      playerTeam: [{ species: 'ROWLET', level: 60, moves: ['bullet-seed'] }],
      foeTeam: [{ species: 'MUDBRAY', level: 60, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 61 });
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const foe = state.pokemon.get(state.sides[1].active[0])!;
      foe.hp = foe.maxHp;
      const events = engine.executeTurn([
        { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'bullet-seed', targetId: foe.id },
        { kind: 'move', pokemonId: foe.id, moveId: 'tackle', targetId: state.sides[0].active[0] },
      ]);
      const hits = events.filter((e) => e.type === 'damage' && e.targetId === foe.id).length;
      if (hits > 0) seen.add(hits);
      if (state.ended) break;
    }
    for (const n of seen) {
      assert.ok(n >= 2 && n <= 5, `multi-hit produced ${n} hits`);
    }
    assert.ok(seen.size > 1, 'hit count should vary');
  });

  test('a fixed-damage move halves current HP and ignores the damage formula', () => {
    // Nature's Madness has `power: null`, which routes it around the whole
    // damage chain. The branch that does this was briefly unreachable during
    // development, and the move quietly dealt 1 damage instead of halving HP.
    let hits = 0;

    for (const attackerLevel of [5, 50, 100]) {
      const state = makeState({
        playerTeam: [{ species: 'ROWLET', level: attackerLevel, moves: ['nature-s-madness'] }],
        foeTeam: [{ species: 'LAPRAS', level: 70, moves: ['protect'] }],
      });
      const userId = state.sides[0].active[0];
      const foe = state.pokemon.get(state.sides[1].active[0])!;

      // Accuracy is 90, so sweep seeds and assert on every connecting hit.
      for (let seed = 1; seed <= 20; seed++) {
        const engine = new BattleEngine(state, { seed });
        foe.hp = foe.maxHp;
        foe.fainted = false;
        state.ended = false;
        state.winner = null;

        const before = foe.hp;
        const events = engine.executeTurn([
          { kind: 'move', pokemonId: userId, moveId: 'nature-s-madness', targetId: foe.id },
        ]);
        const dmg = findEvent(events, 'damage');
        if (!dmg) continue;

        hits++;
        assert.equal(
          before - foe.hp,
          Math.floor(before / 2),
          `attacker level ${attackerLevel} should always remove exactly half the target's HP`,
        );
        assert.equal(dmg.effectiveness, 1, 'fixed damage is never type-modified');
      }
    }

    assert.ok(hits > 0, 'Nature\'s Madness should connect at least once across the seed sweep');
  });

  test('weather is set by moves and expires on schedule', () => {
    const state = makeState({
      // A bulky foe at a much higher level, so the battle cannot end before
      // the weather runs its five turns.
      playerTeam: [{ species: 'POPPLIO', level: 50, moves: ['rain-dance', 'protect'] }],
      foeTeam: [{ species: 'LAPRAS', level: 50, moves: ['protect'] }],
    });
    const engine = new BattleEngine(state, { seed: 71 });
    const events = engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'rain-dance', targetId: state.sides[0].active[0] },
      { kind: 'move', pokemonId: state.sides[1].active[0], moveId: 'protect', targetId: state.sides[1].active[0] },
    ]);
    assert.ok(findEvent(events, 'weather-start'), 'Rain Dance should start rain');
    assert.equal(state.field.weather, 'rain');

    // Run it out.
    for (let i = 0; i < 6; i++) {
      engine.executeTurn([
        { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'protect', targetId: state.sides[0].active[0] },
        { kind: 'move', pokemonId: state.sides[1].active[0], moveId: 'protect', targetId: state.sides[1].active[0] },
      ]);
    }
    assert.ok(!state.ended, 'the battle should still be running');
    assert.equal(state.field.weather, null, 'weather should expire after five turns');
  });

  test('a move aimed at a fainted target redirects rather than being wasted', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunderbolt'] }],
      foeTeam: [
        { species: 'MAGIKARP', level: 5, moves: ['tackle'] },
        { species: 'WINGULL', level: 30, moves: ['tackle'] },
      ],
      format: 'double',
    });
    const engine = new BattleEngine(state, { seed: 83 });
    // Faint the first target manually, then aim at it.
    const deadId = state.sides[1].active[0];
    const dead = state.pokemon.get(deadId)!;
    dead.hp = 0;
    dead.fainted = true;

    const events = engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunderbolt', targetId: deadId },
    ]);
    const used = findEvent(events, 'move-used');
    assert.ok(used, 'the move should still be used');
    assert.ok(!used!.targetIds.includes(deadId), 'it should not target the fainted Pokémon');
  });

  test('a long battle terminates at the turn limit rather than hanging', () => {
    const state = makeState({
      playerTeam: [{ species: 'LAPRAS', level: 50, moves: ['protect'] }],
      foeTeam: [{ species: 'LAPRAS', level: 50, moves: ['protect'] }],
    });
    const engine = new BattleEngine(state, { seed: 97, maxTurns: 25 });
    for (let i = 0; i < 100 && !state.ended; i++) {
      engine.executeTurn([
        { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'protect', targetId: state.sides[0].active[0] },
        { kind: 'move', pokemonId: state.sides[1].active[0], moveId: 'protect', targetId: state.sides[1].active[0] },
      ]);
    }
    assert.ok(state.ended, 'the battle must terminate');
    assert.equal(state.winner, null, 'a stalemate should be a draw');
  });

  test('Intimidate lowers the opponent’s Attack on switch-in', () => {
    const state = makeState({
      playerTeam: [
        { species: 'PIKACHU', level: 50, moves: ['tackle'] },
        { species: 'LITTEN', level: 50, moves: ['tackle'], ability: 'intimidate' },
      ],
      foeTeam: [{ species: 'MUDBRAY', level: 50, moves: ['tackle'] }],
    });
    const engine = new BattleEngine(state, { seed: 101 });
    const foe = state.pokemon.get(state.sides[1].active[0])!;
    assert.equal(foe.stages.atk, 0);

    engine.executeTurn([
      { kind: 'switch', pokemonId: state.sides[0].active[0], incomingId: state.sides[0].party[1] },
      { kind: 'move', pokemonId: foe.id, moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    assert.equal(foe.stages.atk, -1, 'Intimidate should drop Attack by one stage');
  });

  test('Focus Sash survives a lethal hit from full HP, once', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 100, moves: ['thunderbolt'] }],
      foeTeam: [{ species: 'MAGIKARP', level: 5, moves: ['tackle'], item: 'focus-sash' }],
    });
    const engine = new BattleEngine(state, { seed: 103 });
    const foe = state.pokemon.get(state.sides[1].active[0])!;

    engine.executeTurn([
      { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'thunderbolt', targetId: foe.id },
      { kind: 'move', pokemonId: foe.id, moveId: 'tackle', targetId: state.sides[0].active[0] },
    ]);
    assert.equal(foe.hp, 1, 'Focus Sash should leave exactly 1 HP');
    assert.equal(foe.item, null, 'the Sash should be consumed');
  });

  test("Nature's Madness halves the target's current HP", () => {
    const state = makeState({
      playerTeam: [{ species: 'TAPU_KOKO', level: 60, moves: ['nature-s-madness'] }],
      foeTeam: [{ species: 'LAPRAS', level: 60, moves: ['protect'] }],
    });
    const engine = new BattleEngine(state, { seed: 107 });
    const foe = state.pokemon.get(state.sides[1].active[0])!;
    const before = foe.hp;

    // Repeat until the move lands (it has 90% accuracy).
    for (let i = 0; i < 10 && foe.hp === before; i++) {
      engine.executeTurn([
        { kind: 'move', pokemonId: state.sides[0].active[0], moveId: 'nature-s-madness', targetId: foe.id },
        { kind: 'pass', pokemonId: foe.id },
      ]);
    }
    assert.ok(foe.hp < before, 'the move should have landed');
    assert.ok(foe.hp <= Math.ceil(before / 2), `should halve HP: ${before} -> ${foe.hp}`);
  });
});

// ------------------------------------------------------------------- Totem

describe('Totem encounters', () => {
  test('every trial has a runnable Totem encounter', () => {
    for (const trial of ['verdant-cavern', 'brooklet-hill', 'vast-poni-canyon']) {
      const encounter = totemEncounterFor(trial);
      assert.ok(encounter.totem.species);
      assert.ok(encounter.totem.phases.length >= 2);
      assert.ok(encounter.recommendedLevel > 0);
    }
  });

  test('the aura raises stats at battle start and is announced', () => {
    clearTotemRegistry();
    const trial = getTrial('verdant-cavern');
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 20, moves: ['thunderbolt'] }],
      foeTeam: [{ species: trial.totem.species, level: trial.totem.level, moves: [...trial.totem.moves] }],
    });
    const engine = new BattleEngine(state, { seed: 5 });
    const totem = state.pokemon.get(state.sides[1].active[0])!;
    registerTotem(totem, trial.totem);

    applyTotemAura(engine, totem);
    const events = engine.drainEvents();
    assert.ok(events.some((e) => e.type === 'totem-aura'), 'the aura should be announced');
    assert.ok(totem.stages.def > 0, 'the aura should raise Defense');
    clearTotemRegistry();
  });

  test('phases trigger in order as HP falls, and never replay', () => {
    clearTotemRegistry();
    const trial = getTrial('brooklet-hill');
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 80, moves: ['thunderbolt'] }],
      foeTeam: [{ species: trial.totem.species, level: trial.totem.level, moves: [...trial.totem.moves] }],
    });
    const engine = new BattleEngine(state, { seed: 9 });
    const totem = state.pokemon.get(state.sides[1].active[0])!;
    registerTotem(totem, trial.totem);

    const phasesSeen: number[] = [];
    // Chip it down in small increments so every threshold is crossed.
    const step = Math.max(1, Math.floor(totem.maxHp / 40));
    while (!totem.fainted) {
      engine.dealDamage(totem, step, 1, false);
      for (const e of engine.drainEvents()) {
        if (e.type === 'totem-phase') phasesSeen.push(e.phase);
      }
    }

    assert.ok(phasesSeen.length >= 2, `expected multiple phases, saw ${phasesSeen.length}`);
    // Strictly ascending: a phase must never repeat or regress.
    for (let i = 1; i < phasesSeen.length; i++) {
      assert.ok(phasesSeen[i] > phasesSeen[i - 1], `phase order broken: ${phasesSeen.join(',')}`);
    }
    clearTotemRegistry();
  });

  test('a single overkill hit does not replay every phase', () => {
    clearTotemRegistry();
    const trial = getTrial('vast-poni-canyon');
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 100, moves: ['thunderbolt'] }],
      foeTeam: [{ species: trial.totem.species, level: trial.totem.level, moves: [...trial.totem.moves] }],
    });
    const engine = new BattleEngine(state, { seed: 11 });
    const totem = state.pokemon.get(state.sides[1].active[0])!;
    registerTotem(totem, trial.totem);

    // One enormous hit that crosses three thresholds at once.
    engine.dealDamage(totem, Math.floor(totem.maxHp * 0.92), 1, false);
    const phases = engine.drainEvents().filter((e) => e.type === 'totem-phase');
    assert.equal(phases.length, 1, 'only the deepest phase should trigger, not all of them');
    clearTotemRegistry();
  });

  test('SOS allies are called once each, at their thresholds', () => {
    clearTotemRegistry();
    const trial = getTrial('verdant-cavern');
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 60, moves: ['thunderbolt'] }],
      foeTeam: [{ species: trial.totem.species, level: trial.totem.level, moves: [...trial.totem.moves] }],
    });
    const engine = new BattleEngine(state, { seed: 13 });
    const totem = state.pokemon.get(state.sides[1].active[0])!;
    registerTotem(totem, trial.totem);

    const calls: string[] = [];
    const step = Math.max(1, Math.floor(totem.maxHp / 50));
    while (!totem.fainted) {
      engine.dealDamage(totem, step, 1, false);
      for (const e of engine.drainEvents()) {
        if (e.type === 'sos-call') calls.push(e.species);
      }
    }
    assert.equal(calls.length, trial.totem.sosAllies.length, `expected ${trial.totem.sosAllies.length} SOS calls, got ${calls.length}`);
    assert.equal(new Set(calls).size, calls.length, 'each ally should be called only once');
    clearTotemRegistry();
  });

  test('Totem HP scaling tracks visual size', () => {
    assert.equal(totemHpMultiplier(1), 1);
    assert.ok(totemHpMultiplier(2) > 2, 'a double-size Totem should be more than twice as durable');
    assert.ok(totemHpMultiplier(3.4) > totemHpMultiplier(1.9));
  });
});

// ---------------------------------------------------------------- battle AI

describe('Battle AI', () => {
  test('a competent AI picks a super-effective move', () => {
    const state = makeState({
      playerTeam: [{ species: 'WINGULL', level: 50, moves: ['tackle'] }],
      // Pikachu has both a neutral and a super-effective option against Wingull.
      foeTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunderbolt', 'quick-attack'] }],
    });
    const ai = new BattleAi('champion', 1);
    const pikachu = state.pokemon.get(state.sides[1].active[0])!;
    const action = ai.chooseAction(state, pikachu);
    assert.equal(action.kind, 'move');
    assert.equal((action as { moveId: string }).moveId, 'thunderbolt', 'should pick the 2x move');
  });

  test('a wild Pokémon plays much less optimally than a champion', () => {
    const state = makeState({
      playerTeam: [{ species: 'WINGULL', level: 50, moves: ['tackle'] }],
      foeTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunderbolt', 'quick-attack'] }],
    });
    const pikachu = state.pokemon.get(state.sides[1].active[0])!;

    const countBest = (difficulty: 'wild' | 'champion'): number => {
      let best = 0;
      for (let i = 0; i < 400; i++) {
        const ai = new BattleAi(difficulty, i);
        const action = ai.chooseAction(state, pikachu);
        if (action.kind === 'move' && action.moveId === 'thunderbolt') best++;
      }
      return best;
    };

    const wild = countBest('wild');
    const champion = countBest('champion');
    assert.ok(champion > wild, `champion (${champion}) should outplay wild (${wild})`);
    assert.ok(champion > 350, 'a champion should almost always find the best move');
  });

  test('the AI does not use a move the target is immune to', () => {
    const state = makeState({
      playerTeam: [{ species: 'MIMIKYU', level: 50, moves: ['shadow-claw'] }],
      // Normal moves cannot touch a Ghost; the AI must pick the other option.
      foeTeam: [{ species: 'YUNGOOS', level: 50, moves: ['tackle', 'crunch'] }],
    });
    const ai = new BattleAi('champion', 7);
    const yungoos = state.pokemon.get(state.sides[1].active[0])!;
    const action = ai.chooseAction(state, yungoos);
    assert.equal((action as { moveId: string }).moveId, 'crunch', 'must avoid the immune move');
  });

  test('the AI does not waste a status move on an already-statused target', () => {
    const state = makeState({
      // Wingull, not Mudbray: Thunderbolt must be a live option for the
      // comparison to mean anything.
      playerTeam: [{ species: 'WINGULL', level: 50, moves: ['tackle'] }],
      foeTeam: [{ species: 'PIKACHU', level: 50, moves: ['thunder-wave', 'thunderbolt'] }],
    });
    const target = state.pokemon.get(state.sides[0].active[0])!;
    target.status = 'paralysis';

    const ai = new BattleAi('champion', 3);
    const pikachu = state.pokemon.get(state.sides[1].active[0])!;
    const action = ai.chooseAction(state, pikachu);
    assert.notEqual((action as { moveId: string }).moveId, 'thunder-wave');
  });

  test('a smart AI switches out of a hopeless matchup', () => {
    const state = makeState({
      playerTeam: [{ species: 'MUDBRAY', level: 60, moves: ['high-horsepower'] }],
      foeTeam: [
        // Alolan Geodude is Rock/Electric: 4x weak to Ground.
        { species: 'GEODUDE_ALOLA', level: 40, moves: ['tackle'] },
        { species: 'ROWLET', level: 50, moves: ['razor-leaf'] },
      ],
    });
    const geodude = state.pokemon.get(state.sides[1].active[0])!;
    geodude.hp = Math.floor(geodude.maxHp * 0.3);

    const ai = new BattleAi('kahuna', 5);
    const options = ai.scoreActions(state, geodude);
    const switchOption = options.find((o) => o.action.kind === 'switch');
    assert.ok(switchOption, 'the AI should at least consider switching');
  });

  test('a novice AI never switches', () => {
    const state = makeState({
      playerTeam: [{ species: 'MUDBRAY', level: 60, moves: ['high-horsepower'] }],
      foeTeam: [
        { species: 'GEODUDE_ALOLA', level: 40, moves: ['tackle'] },
        { species: 'ROWLET', level: 50, moves: ['razor-leaf'] },
      ],
    });
    const geodude = state.pokemon.get(state.sides[1].active[0])!;
    geodude.hp = 1;
    const ai = new BattleAi('novice', 5);
    const options = ai.scoreActions(state, geodude);
    assert.ok(!options.some((o) => o.action.kind === 'switch'), 'a novice should not switch');
  });

  test('a full AI-vs-AI battle terminates and produces a winner', () => {
    const state = makeState({
      playerTeam: [
        { species: 'PIKACHU', level: 50, moves: ['thunderbolt', 'quick-attack', 'thunder-wave', 'protect'] },
        { species: 'LITTEN', level: 50, moves: ['flamethrower', 'crunch', 'swords-dance', 'ember'] },
      ],
      foeTeam: [
        { species: 'MUDBRAY', level: 50, moves: ['high-horsepower', 'body-slam', 'protect', 'tackle'] },
        { species: 'WINGULL', level: 50, moves: ['air-slash', 'surf', 'quick-attack', 'protect'] },
      ],
    });
    const engine = new BattleEngine(state, { seed: 2024 });
    const aiA = new BattleAi('ace', 1);
    const aiB = new BattleAi('ace', 2);

    let turns = 0;
    while (!state.ended && turns < 200) {
      turns++;
      const actions = [
        ...aiA.chooseActionsForSide(state, 0),
        ...aiB.chooseActionsForSide(state, 1),
      ];
      engine.executeTurn(actions);

      // Replace fainted actives from the bench.
      for (const side of state.sides) {
        for (let slot = 0; slot < side.active.length; slot++) {
          const active = state.pokemon.get(side.active[slot]);
          if (active && active.fainted) {
            const replacement = side.party.find((id) => {
              const p = state.pokemon.get(id);
              return p && !p.fainted && !side.active.includes(id);
            });
            if (replacement !== undefined) {
              side.active[slot] = replacement;
              const p = state.pokemon.get(replacement)!;
              p.side = side.index;
              p.slot = slot;
            }
          }
        }
      }
    }

    assert.ok(state.ended, `battle did not terminate in ${turns} turns`);
    assert.ok(turns < 200, 'should not hit the safety limit');
  });
});

// ------------------------------------------------------------------- arena

describe('Arena generation', () => {
  const flatProbe: TerrainProbe = {
    heightAt: () => 10,
    slopeAt: () => 0,
    biomeAt: () => 'grassland',
  };

  // A slope that flattens out to the east.
  const slopedProbe: TerrainProbe = {
    heightAt: (x) => (x < 5 ? 10 - x * 2 : 0),
    slopeAt: (x) => (x < 5 ? 1.1 : 0.02),
    biomeAt: () => 'coastal-cliff',
  };

  test('generates a usable arena on flat ground', () => {
    const arena = generateArena(flatProbe, { x: 100, z: 200, weather: null, hour: 12, island: 'melemele' });
    assert.equal(arena.biome, 'grassland');
    assert.equal(arena.surface, 'foliage');
    assert.ok(arena.radius > 0);
    assert.equal(arena.y, 10);
  });

  test('nudges the arena toward flatter ground', () => {
    const arena = generateArena(slopedProbe, { x: 0, z: 0, weather: null, hour: 12, island: 'melemele' });
    assert.ok(arena.x > 0, `should move toward the flat side, got x=${arena.x}`);
  });

  test('surface mapping covers the biome set', () => {
    assert.equal(surfaceForBiome('beach'), 'sand');
    assert.equal(surfaceForBiome('deep-ocean'), 'water');
    assert.equal(surfaceForBiome('snowfield'), 'snow');
    assert.equal(surfaceForBiome('lava-field'), 'lava');
    assert.equal(surfaceForBiome('facility'), 'metal');
    assert.equal(surfaceForBiome('cave'), 'rock');
  });

  test('camera rig adapts to the space', () => {
    assert.equal(cameraRigFor(TEST_ARENA), 'open-field');
    assert.equal(cameraRigFor({ ...TEST_ARENA, enclosed: true }), 'enclosed');
    assert.equal(cameraRigFor({ ...TEST_ARENA, enclosed: true, radius: 6 }), 'confined');
    assert.equal(cameraRigFor({ ...TEST_ARENA, surface: 'water' }), 'aquatic');
    assert.equal(cameraRigFor({ ...TEST_ARENA, biome: 'canyon' }), 'cliff');
  });

  test('environment reactions resolve against the actual surface', () => {
    const reactions = [
      { surface: 'sand', effect: 'vitrify', radius: 9, duration: -1 },
      { surface: 'water', effect: 'shatter', radius: 16, duration: 6 },
      { surface: 'any', effect: 'flatten', radius: 24, duration: -1 },
    ];
    const onSand = resolveEnvironmentReactions({ ...TEST_ARENA, surface: 'sand' }, reactions);
    assert.ok(onSand.some((r) => r.effect === 'vitrify'), 'sand reaction should play on sand');
    assert.ok(!onSand.some((r) => r.effect === 'shatter'), 'water reaction should not play on sand');
    assert.ok(onSand.some((r) => r.effect === 'flatten'), '"any" reactions always play');

    const onMetal = resolveEnvironmentReactions({ ...TEST_ARENA, surface: 'metal' }, reactions);
    assert.equal(onMetal.length, 1, 'only the "any" reaction survives on metal');
  });

  test('reaction radii are clamped to the arena', () => {
    const small = { ...TEST_ARENA, radius: 6 };
    const resolved = resolveEnvironmentReactions(small, [
      { surface: 'any', effect: 'crater', radius: 50, duration: -1 },
    ]);
    assert.ok(resolved[0].radius <= small.radius * 2.2, 'reaction should fit the arena');
  });

  test('music selection reflects context', () => {
    assert.equal(musicFor(TEST_ARENA, true, false), 'bgm/totem_battle');
    assert.ok(musicFor(TEST_ARENA, false, true).includes('trainer'));
    assert.ok(musicFor({ ...TEST_ARENA, biome: 'canyon' }, false, false).includes('dangerous'));
  });
});

// -------------------------------------------------------------- Z-Move

describe('Z-Move cinematics', () => {
  test('a perfect pose scores perfect and boosts power', () => {
    const z = getZMove('gigavolt-havoc');
    const inputs = z.pose.inputs.map((input, i) => ({
      input,
      at: ((i + 1) * z.pose.window) / (z.pose.inputs.length + 1),
    }));
    const result = evaluatePose(z, inputs);
    assert.equal(result.correct, z.pose.inputs.length);
    assert.ok(result.powerMultiplier >= 1, 'a clean pose should not lose power');
    assert.ok(result.rating === 'perfect' || result.rating === 'great');
  });

  test('a missed pose still delivers most of the power', () => {
    const z = getZMove('gigavolt-havoc');
    const result = evaluatePose(z, []);
    assert.equal(result.rating, 'missed');
    assert.ok(result.powerMultiplier >= 0.8, 'a Z-Move must never feel wasted');
  });

  test('a wrong input is forgiven rather than resetting the sequence', () => {
    const z = getZMove('gigavolt-havoc');
    const expected = z.pose.inputs;
    const inputs = [
      { input: 'circle', at: 0.1 },             // Wrong: should be ignored.
      ...expected.map((input, i) => ({ input, at: 0.3 + i * 0.3 })),
    ];
    const result = evaluatePose(z, inputs);
    assert.equal(result.correct, expected.length, 'a slip should not void the sequence');
  });

  test('inputs after the window closes do not count', () => {
    const z = getZMove('gigavolt-havoc');
    const late = z.pose.inputs.map((input, i) => ({ input, at: z.pose.window + 1 + i }));
    const result = evaluatePose(z, late);
    assert.equal(result.correct, 0);
  });

  test('a cinematic is built with ordered beats and a real duration', () => {
    const cinematic = buildCinematic('inferno-overdrive', TEST_ARENA);
    assert.ok(cinematic.beats.length >= 3);
    assert.ok(cinematic.totalDuration > 3);
    for (let i = 1; i < cinematic.beats.length; i++) {
      assert.ok(cinematic.beats[i].at > cinematic.beats[i - 1].at);
      assert.ok(cinematic.beats[i - 1].duration > 0, 'every beat needs a duration');
    }
  });

  test('sky cameras are rewritten inside a cave', () => {
    const cave: BattleArena = { ...TEST_ARENA, biome: 'cave', surface: 'rock', enclosed: true };
    const cinematic = buildCinematic('gigavolt-havoc', cave);
    assert.ok(
      !cinematic.beats.some((b) => b.resolvedCamera === 'sky-wide'),
      'a sky shot inside a cave points at a ceiling',
    );
  });

  test('beat lookup and shake/time-scale sampling behave over the timeline', () => {
    const cinematic = buildCinematic('tectonic-rage', TEST_ARENA);
    assert.equal(beatAt(cinematic, -1), null, 'nothing before the first beat');
    assert.ok(beatAt(cinematic, cinematic.totalDuration) !== null);

    // Shake decays after an impulse.
    const impact = cinematic.beats.find((b) => (b.shake ?? 0) > 0.5);
    assert.ok(impact, 'a Z-Move should have an impact beat');
    const atImpact = shakeAt(cinematic, impact!.at);
    const afterImpact = shakeAt(cinematic, impact!.at + 0.35);
    assert.ok(atImpact > afterImpact, 'shake should decay');

    for (let t = 0; t <= cinematic.totalDuration; t += 0.1) {
      const scale = timeScaleAt(cinematic, t);
      assert.ok(scale > 0 && scale <= 2, `bad time scale ${scale} at ${t}`);
    }
  });

  test('Z-Moves are limited to once per battle per side', () => {
    const state = makeState({
      playerTeam: [{ species: 'PIKACHU', level: 60, moves: ['thunderbolt'] }],
      foeTeam: [{ species: 'LAPRAS', level: 60, moves: ['protect'] }],
      zCrystal: 'electrium-z',
    });
    const engine = new BattleEngine(state, { seed: 31 });
    const userId = state.sides[0].active[0];
    const foeId = state.sides[1].active[0];

    const first = engine.executeTurn([
      { kind: 'move', pokemonId: userId, moveId: 'thunderbolt', targetId: foeId, zMove: true },
      { kind: 'pass', pokemonId: foeId },
    ]);
    assert.ok(findEvent(first, 'z-power'), 'the first Z-Move should fire');
    assert.ok(state.sides[0].zUsed);

    const second = engine.executeTurn([
      { kind: 'move', pokemonId: userId, moveId: 'thunderbolt', targetId: foeId, zMove: true },
      { kind: 'pass', pokemonId: foeId },
    ]);
    assert.ok(!findEvent(second, 'z-power'), 'a second Z-Move must be refused');
    const failure = second.find((e) => e.type === 'move-failed' && e.reason === 'z-power-unavailable');
    assert.ok(failure, 'the refusal should be reported');
  });

  test('a Z-Move hits far harder than its base move', () => {
    const run = (useZ: boolean): number => {
      const state = makeState({
        playerTeam: [{ species: 'PIKACHU', level: 60, moves: ['thunderbolt'] }],
        foeTeam: [{ species: 'LAPRAS', level: 90, moves: ['protect'] }],
        zCrystal: 'electrium-z',
      });
      const engine = new BattleEngine(state, { seed: 37 });
      const events = engine.executeTurn([
        {
          kind: 'move', pokemonId: state.sides[0].active[0],
          moveId: 'thunderbolt', targetId: state.sides[1].active[0], zMove: useZ,
        },
        { kind: 'pass', pokemonId: state.sides[1].active[0] },
      ]);
      let total = 0;
      for (const e of events) if (e.type === 'damage') total += e.amount;
      return total;
    };
    const normal = run(false);
    const zMove = run(true);
    assert.ok(zMove > normal * 1.5, `Z-Move (${zMove}) should dwarf the base move (${normal})`);
  });
});
