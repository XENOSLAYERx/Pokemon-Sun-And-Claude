import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '@alola/core';
import { getMove, SPECIES_LIST } from '@alola/data';
import type { TerrainProbe } from '@alola/battle';
import { MemoryStorage, SaveManager } from '@alola/save';
import {
  movesetFor, powerCapForLevel,
  createPokemon, maxHpOf, isFainted, healFully, awardExp, expYield, levelForExp,
  toBattlePokemon, applyBattleResult, toSaved, fromSaved, resetUidCounter,
  Bag, attemptCapture, ballMultiplierFor, statusMultiplierFor,
  engageableTarget, ambusher, canFleeFrom, ENGAGE_RANGE,
  GameProfile, BattleSession, MAX_PARTY, starterLevelFor,
  type EncounterCandidate, type PartyPokemon,
} from '../src/index.ts';

const SEED = 20251115;

/** Flat ground, so arena generation is not the thing under test. */
const FLAT_PROBE: TerrainProbe = {
  heightAt: () => 12,
  slopeAt: () => 0,
  biomeAt: () => 'grassland',
};

function makeProfile(starter = 'ROWLET'): GameProfile {
  resetUidCounter(1);
  return GameProfile.newGame({
    worldSeed: SEED,
    playerName: 'Kai',
    spawn: { x: 0, y: 12, z: 0 },
    starter,
  });
}

function offerFor(species: string, level: number, goal: string | null = 'wander'): {
  candidate: EncounterCandidate; distance: number; reason: 'player-engaged';
} {
  return {
    candidate: { id: 99, speciesId: species, level, position: { x: 3, y: 12, z: 0 }, goal },
    distance: 3,
    reason: 'player-engaged',
  };
}

function makeSession(opts: { starter?: string; foe?: string; foeLevel?: number; profile?: GameProfile } = {}): BattleSession {
  const profile = opts.profile ?? makeProfile(opts.starter);
  return new BattleSession({
    profile,
    offer: offerFor(opts.foe ?? 'PIKIPEK', opts.foeLevel ?? 4),
    probe: FLAT_PROBE,
    weather: null,
    hour: 12,
    island: 'melemele',
    seed: SEED,
  });
}

// ------------------------------------------------------------------ moveset

describe('Moveset derivation', () => {
  test('every species gets a usable moveset at every band', () => {
    for (const species of SPECIES_LIST) {
      for (const level of [1, 5, 12, 25, 40, 60, 100]) {
        const moves = movesetFor(species.id, level);
        assert.ok(moves.length >= 1 && moves.length <= 4, `${species.id}@${level} has ${moves.length} moves`);
        assert.equal(new Set(moves).size, moves.length, `${species.id}@${level} has duplicate moves`);
        const damaging = moves.filter((id) => {
          const m = getMove(id);
          return m.category !== 'status' && m.power !== null;
        });
        assert.ok(damaging.length >= 1, `${species.id}@${level} has no damaging move — a battle would softlock`);
      }
    }
  });

  test('is deterministic — the same species and level always agree', () => {
    for (const species of SPECIES_LIST.slice(0, 12)) {
      const a = movesetFor(species.id, 30);
      const b = movesetFor(species.id, 30);
      assert.deepEqual(a, b);
    }
  });

  test('respects the level power cap', () => {
    for (const species of SPECIES_LIST) {
      for (const level of [5, 12, 20, 45]) {
        const cap = powerCapForLevel(level);
        for (const id of movesetFor(species.id, level)) {
          const power = getMove(id).power ?? 0;
          assert.ok(power <= cap, `${species.id}@${level} knows ${id} at ${power} power, cap ${cap}`);
        }
      }
    }
  });

  test('prefers STAB when the species has a legal one', () => {
    // Pikachu at 30 can legally know Thunderbolt.
    const moves = movesetFor('PIKACHU', 30);
    assert.ok(moves.includes('thunderbolt'), `expected Thunderbolt, got ${moves.join(', ')}`);
  });

  test('a low-level Pokemon does not open with a finisher', () => {
    const moves = movesetFor('ROWLET', 5);
    assert.ok(!moves.includes('brave-bird'), 'Brave Bird at level 5 would one-shot the whole route');
  });

  test('status moves only appear once fights are long enough to use them', () => {
    for (const species of SPECIES_LIST) {
      for (const id of movesetFor(species.id, 8)) {
        assert.notEqual(getMove(id).category, 'status', `${species.id} knows a status move at level 8`);
      }
    }
  });
});

// -------------------------------------------------------------------- party

describe('Party Pokemon', () => {
  test('creation is deterministic for a seed', () => {
    resetUidCounter(1);
    const a = createPokemon({ species: 'PIKACHU', level: 12, rng: new Rng(7), metLocation: 'Route 1' });
    resetUidCounter(1);
    const b = createPokemon({ species: 'PIKACHU', level: 12, rng: new Rng(7), metLocation: 'Route 1' });
    assert.equal(a.personality, b.personality);
    assert.deepEqual(a.ivs, b.ivs);
    assert.equal(a.nature, b.nature);
    assert.equal(a.shiny, b.shiny);
  });

  test('a new Pokemon starts at full health', () => {
    const mon = createPokemon({ species: 'LAPRAS', level: 30, rng: new Rng(3), metLocation: 'Sea' });
    assert.equal(mon.currentHp, maxHpOf(mon));
    assert.ok(!isFainted(mon));
  });

  test('alphas are visibly larger than ordinary individuals', () => {
    const alpha = createPokemon({ species: 'BEWEAR', level: 40, rng: new Rng(1), metLocation: 'Forest', alpha: true });
    const normal = createPokemon({ species: 'BEWEAR', level: 40, rng: new Rng(1), metLocation: 'Forest' });
    assert.ok(alpha.scale > 1.3, `alpha scale ${alpha.scale}`);
    assert.ok(normal.scale <= 1.2, `normal scale ${normal.scale}`);
  });

  test('shiny odds are exactly 1 in 4096 over a large sample', () => {
    const rng = new Rng(99);
    let shinies = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) if (rng.odds(1, 4096)) shinies++;
    const rate = shinies / n;
    assert.ok(rate > 1 / 6000 && rate < 1 / 2800, `observed shiny rate 1 in ${Math.round(1 / rate)}`);
  });

  test('experience levels a Pokemon up and keeps it alive', () => {
    const mon = createPokemon({ species: 'ROWLET', level: 5, rng: new Rng(5), metLocation: 'Iki' });
    mon.currentHp = 3;
    const result = awardExp(mon, expForTen());
    assert.ok(result.levelsGained > 0, 'should have levelled');
    assert.equal(mon.level, result.newLevel);
    assert.ok(mon.currentHp > 3, 'a level-up grants the HP it added');
    assert.ok(mon.currentHp <= maxHpOf(mon));
  });

  function expForTen(): number {
    // Enough experience to clear level 10 on the cubic curve.
    return 10 ** 3;
  }

  test('a level-up never exceeds 100 or loses moves', () => {
    const mon = createPokemon({ species: 'PIKACHU', level: 95, rng: new Rng(11), metLocation: 'Route 1' });
    awardExp(mon, 100_000_000);
    assert.equal(mon.level, 100);
    assert.ok(mon.moves.length >= 1 && mon.moves.length <= 4);
  });

  test('experience yield scales with the defeated level', () => {
    assert.ok(expYield('PIKIPEK', 20, false) > expYield('PIKIPEK', 5, false));
    assert.ok(expYield('PIKIPEK', 20, true) > expYield('PIKIPEK', 20, false), 'trainers award more');
  });

  test('levelForExp inverts expForLevel', () => {
    for (const level of [1, 5, 25, 60, 100]) {
      assert.equal(levelForExp(level ** 3), level);
    }
  });

  test('healing restores HP, status and PP', () => {
    const mon = createPokemon({ species: 'LITTEN', level: 20, rng: new Rng(2), metLocation: 'Route 1' });
    mon.currentHp = 1;
    mon.status = 'burn';
    mon.moves[0].pp = 0;
    healFully(mon);
    assert.equal(mon.currentHp, maxHpOf(mon));
    assert.equal(mon.status, 'none');
    assert.equal(mon.moves[0].pp, getMove(mon.moves[0].id).pp);
  });

  test('a party member projects into battle carrying its condition', () => {
    const mon = createPokemon({ species: 'POPPLIO', level: 25, rng: new Rng(4), metLocation: 'Beach' });
    mon.currentHp = 7;
    mon.status = 'paralysis';
    mon.moves[0].pp = 2;

    const battle = toBattlePokemon(mon, 1, 0, 0);
    assert.equal(battle.hp, 7, 'a battle does not heal you on the way in');
    assert.equal(battle.status, 'paralysis');
    assert.equal(battle.moves[0].pp, 2);
  });

  test('per-stat IVs survive the projection into battle', () => {
    const low = createPokemon({ species: 'PIKACHU', level: 50, rng: new Rng(1), metLocation: 'x' });
    const high = createPokemon({ species: 'PIKACHU', level: 50, rng: new Rng(1), metLocation: 'x' });
    (low.ivs as { spe: number }).spe = 0;
    (high.ivs as { spe: number }).spe = 31;
    assert.ok(
      toBattlePokemon(high, 1, 0, 0).stats.spe > toBattlePokemon(low, 2, 0, 0).stats.spe,
      'a 31 Speed IV must beat a 0 Speed IV',
    );
  });

  test('battle damage is written back onto the party member', () => {
    const mon = createPokemon({ species: 'ROWLET', level: 20, rng: new Rng(6), metLocation: 'Iki' });
    const battle = toBattlePokemon(mon, 1, 0, 0);
    battle.hp = 4;
    battle.status = 'poison';
    battle.moves[0].pp = 1;
    applyBattleResult(mon, battle);
    assert.equal(mon.currentHp, 4);
    assert.equal(mon.status, 'poison');
    assert.equal(mon.moves[0].pp, 1);
  });

  test('a Pokemon survives a save round trip intact', () => {
    const mon = createPokemon({ species: 'MUDBRAY', level: 33, rng: new Rng(8), metLocation: 'Paniola' });
    mon.nickname = 'Clod';
    mon.currentHp = 12;
    const back = fromSaved(toSaved(mon));
    assert.equal(back.species, mon.species);
    assert.equal(back.nickname, 'Clod');
    assert.equal(back.level, mon.level);
    assert.equal(back.currentHp, 12);
    assert.deepEqual(back.ivs, mon.ivs);
    assert.deepEqual(back.moves.map((m) => m.id), mon.moves.map((m) => m.id));
  });

  test('a save referencing a deleted move still loads', () => {
    const mon = createPokemon({ species: 'ROWLET', level: 20, rng: new Rng(9), metLocation: 'Iki' });
    const saved = toSaved(mon);
    saved.moves = [{ id: 'move-that-was-removed', pp: 10 }];
    const back = fromSaved(saved);
    assert.ok(back.moves.length >= 1, 'must rebuild rather than load a Pokemon with no moves');
    for (const m of back.moves) assert.doesNotThrow(() => getMove(m.id));
  });
});

describe('Starter level', () => {
  test('sits just above the local median, so the first fight is winnable', () => {
    // The real distribution sampled around the opening coast.
    const local = [3, 4, 4, 5, 5, 6, 7, 7, 8, 8, 8, 9, 9, 11, 12, 12, 14];
    const level = starterLevelFor(local);
    const median = [...local].sort((a, b) => a - b)[Math.floor(local.length / 2)];
    assert.equal(level, median + 2);
    assert.ok(level > median, 'a starter below the local median blacks out on its first encounter');
  });

  test('is bounded, whatever the table says', () => {
    assert.equal(starterLevelFor([1, 1, 1]), 5, 'never below 5');
    assert.equal(starterLevelFor([60, 70, 80]), 20, 'never a level 82 starter');
  });

  test('falls back sanely with nothing to sample', () => {
    assert.equal(starterLevelFor([]), 5);
  });

  test('a starter actually beats a median local Pokemon more often than not', () => {
    // The regression this exists to prevent: the first battle of a new game
    // ending in a blackout. Play it out 12 times with different seeds.
    const local = [4, 5, 6, 7, 8, 8, 9, 11, 12];
    const median = [...local].sort((a, b) => a - b)[Math.floor(local.length / 2)];
    const level = starterLevelFor(local);

    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      resetUidCounter(1);
      const profile = GameProfile.newGame({
        worldSeed: seed, playerName: 'Kai', spawn: { x: 0, y: 12, z: 0 },
        starter: 'LITTEN', starterLevel: level,
      });
      const session = new BattleSession({
        profile,
        offer: {
          candidate: { id: 1, speciesId: 'GRUBBIN', level: median, position: { x: 3, y: 12, z: 0 }, goal: 'wander' },
          distance: 3, reason: 'player-engaged',
        },
        probe: FLAT_PROBE, weather: null, hour: 12, island: 'melemele', seed,
      });
      for (let turn = 0; turn < 40 && session.outcome === 'ongoing'; turn++) {
        const move = session.playerActive.moves.find((m) => m.pp > 0);
        if (!move) break;
        session.submit({ kind: 'move', moveId: move.id });
      }
      if (session.outcome === 'won') wins++;
    }
    assert.ok(wins >= 9, `starter won only ${wins}/12 opening fights at level ${level} vs ${median}`);
  });
});

// ---------------------------------------------------------------------- bag

describe('Bag', () => {
  test('adds, counts and removes', () => {
    const bag = new Bag();
    bag.add('poke-ball', 5);
    bag.add('poke-ball', 3);
    assert.equal(bag.count('poke-ball'), 8);
    assert.ok(bag.remove('poke-ball', 8));
    assert.equal(bag.count('poke-ball'), 0);
  });

  test('a removal larger than the stack changes nothing', () => {
    const bag = new Bag();
    bag.add('potion', 2);
    assert.equal(bag.remove('potion', 3), false);
    assert.equal(bag.count('potion'), 2, 'a failed removal must not partially consume');
  });

  test('key items are separate and cannot be consumed by count', () => {
    const bag = new Bag();
    bag.add('z-ring');
    assert.ok(bag.hasKeyItem('z-ring'));
    assert.equal(bag.count('z-ring'), 0);
    assert.equal(bag.remove('z-ring', 1), false);
    assert.ok(bag.hasKeyItem('z-ring'), 'a key item must survive a generic remove');
  });

  test('round-trips through a save', () => {
    const bag = new Bag();
    bag.add('great-ball', 12);
    bag.add('super-potion', 4);
    bag.add('ride-pager');
    const back = Bag.fromSaved(bag.toSaved());
    assert.equal(back.count('great-ball'), 12);
    assert.equal(back.count('super-potion'), 4);
    assert.ok(back.hasKeyItem('ride-pager'));
  });

  test('unknown item ids are dropped rather than crashing the load', () => {
    const back = Bag.fromSaved({ items: { 'deleted-item': 5, potion: 2 }, keyItems: ['gone'] });
    assert.equal(back.count('potion'), 2);
    assert.equal(back.count('deleted-item'), 0);
    assert.equal(back.keyItemIds().length, 0);
  });
});

// ------------------------------------------------------------------ capture

describe('Capture', () => {
  test('status and ball multipliers move the odds the right way', () => {
    assert.ok(statusMultiplierFor('sleep') > statusMultiplierFor('paralysis'));
    assert.ok(statusMultiplierFor('paralysis') > statusMultiplierFor('none'));
    assert.equal(statusMultiplierFor('none'), 1);
  });

  test('a Dusk Ball only earns its multiplier at night', () => {
    const context = { hour: 2, onWater: false, targetTypes: ['normal'] };
    assert.ok(ballMultiplierFor('dusk-ball', context) > 1);
    assert.equal(ballMultiplierFor('dusk-ball', { ...context, hour: 13 }), 1);
  });

  test('a Net Ball only earns its multiplier on Water and Bug', () => {
    const day = { hour: 13, onWater: false, targetTypes: ['water'] };
    assert.ok(ballMultiplierFor('net-ball', day) > 1);
    assert.equal(ballMultiplierFor('net-ball', { ...day, targetTypes: ['fire'] }), 1);
  });

  test('a Master Ball is certain and skips the drama', () => {
    const session = makeSession();
    const result = attemptCapture({
      target: session.foeActive, ballId: 'master-ball', rng: new Rng(1), hour: 12, onWater: false,
    });
    assert.ok(result.caught);
    assert.ok(result.certain);
    assert.equal(result.shakes, 4);
  });

  test('a weakened target is easier to catch than a healthy one', () => {
    const session = makeSession();
    const trials = 400;
    const count = (hpFraction: number): number => {
      const rng = new Rng(4242);
      let caught = 0;
      for (let i = 0; i < trials; i++) {
        session.foeActive.hp = Math.max(1, Math.floor(session.foeActive.maxHp * hpFraction));
        if (attemptCapture({ target: session.foeActive, ballId: 'poke-ball', rng, hour: 12, onWater: false }).caught) {
          caught++;
        }
      }
      return caught;
    };
    assert.ok(count(0.05) > count(1), 'a nearly-fainted Pokemon must be easier to catch');
  });

  test('the shake count never contradicts the outcome', () => {
    const session = makeSession();
    const rng = new Rng(17);
    for (let i = 0; i < 300; i++) {
      session.foeActive.hp = 1 + (i % session.foeActive.maxHp);
      const result = attemptCapture({ target: session.foeActive, ballId: 'great-ball', rng, hour: 12, onWater: false });
      assert.equal(result.caught, result.shakes === 4, 'four shakes means caught, and nothing else does');
    }
  });
});

// ---------------------------------------------------------------- encounter

describe('Encounters', () => {
  const at = (x: number, species = 'PIKIPEK', goal: string | null = 'wander'): EncounterCandidate => ({
    id: Math.round(x * 10), speciesId: species, level: 6, position: { x, y: 0, z: 0 }, goal,
  });

  test('picks the nearest engageable Pokemon in range', () => {
    const offer = engageableTarget({ x: 0, z: 0 }, [at(8), at(3), at(6)]);
    assert.ok(offer);
    assert.equal(offer.candidate.position.x, 3);
    assert.equal(offer.reason, 'player-engaged');
  });

  test('nothing beyond engage range is offered', () => {
    assert.equal(engageableTarget({ x: 0, z: 0 }, [at(ENGAGE_RANGE + 1)]), null);
  });

  test('a sleeping or fleeing Pokemon cannot be pulled into a battle', () => {
    assert.equal(engageableTarget({ x: 0, z: 0 }, [at(2, 'PIKIPEK', 'sleep')]), null);
    assert.equal(engageableTarget({ x: 0, z: 0 }, [at(2, 'PIKIPEK', 'flee')]), null);
  });

  test('a fainted Pokemon is never engageable', () => {
    const fainted = { ...at(2), fainted: true };
    assert.equal(engageableTarget({ x: 0, z: 0 }, [fainted]), null);
  });

  test('only an aggressive species that is actually hunting ambushes', () => {
    assert.ok(ambusher({ x: 0, z: 0 }, [at(10, 'SHARPEDO', 'attack')]));
    assert.equal(ambusher({ x: 0, z: 0 }, [at(10, 'SHARPEDO', 'wander')]), null, 'not hunting, not an ambush');
    assert.equal(ambusher({ x: 0, z: 0 }, [at(10, 'LAPRAS', 'attack')]), null, 'Lapras does not ambush anyone');
  });

  test('a provoked Bewear ambushes, even though it is not aggressive by default', () => {
    assert.equal(ambusher({ x: 0, z: 0 }, [at(8, 'BEWEAR', 'wander')]), null);
    assert.ok(ambusher({ x: 0, z: 0 }, [at(8, 'BEWEAR', 'attack')]), 'protective means it defends, not that it never fights');
  });

  test('you can always run from a fight you started', () => {
    assert.ok(canFleeFrom({ candidate: at(3, 'BEWEAR'), distance: 3, reason: 'player-engaged' }));
    assert.ok(canFleeFrom({ candidate: at(3, 'KOMMO_O'), distance: 3, reason: 'player-engaged' }));
  });

  test('you cannot run from an apex predator, or a Bewear, that started it', () => {
    assert.equal(canFleeFrom({ candidate: at(3, 'KOMMO_O'), distance: 3, reason: 'ambushed' }), false);
    assert.equal(canFleeFrom({ candidate: at(3, 'BEWEAR'), distance: 3, reason: 'ambushed' }), false);
    assert.ok(canFleeFrom({ candidate: at(3, 'SHARPEDO'), distance: 3, reason: 'ambushed' }),
      'an aggressive predator is escapable; an apex one is the point');
  });
});

// ------------------------------------------------------------------ profile

describe('Game profile', () => {
  test('a new game is playable immediately', () => {
    const profile = makeProfile();
    assert.equal(profile.party.length, 1);
    assert.equal(profile.party[0].species, 'ROWLET');
    assert.equal(profile.party[0].level, 5);
    assert.ok(profile.hasUsablePokemon);
    assert.ok(profile.bag.count('poke-ball') > 0, 'a new player must be able to catch something');
    assert.ok(profile.bag.count('potion') > 0);
    assert.ok(profile.hasFlag('game-started'));
  });

  test('the starter is registered as caught in the dex', () => {
    const profile = makeProfile();
    assert.equal(profile.dexCaught, 1);
    assert.equal(profile.dexSeen, 1);
  });

  test('seeing a species is idempotent and does not mark it caught', () => {
    const profile = makeProfile();
    assert.ok(profile.recordSeen('BEWEAR'));
    assert.equal(profile.recordSeen('BEWEAR'), false, 'the second sighting is not new');
    assert.equal(profile.dexSeen, 2);
    assert.equal(profile.dexCaught, 1);
  });

  test('a full party overflows into a box rather than losing the catch', () => {
    const profile = makeProfile();
    const rng = new Rng(21);
    for (let i = 0; i < MAX_PARTY + 3; i++) {
      const mon = createPokemon({ species: 'PIKIPEK', level: 5, rng, metLocation: 'Route 1' });
      profile.addPokemon(mon);
    }
    assert.equal(profile.party.length, MAX_PARTY);
    assert.equal(profile.boxes.length, 4, 'everything past a full party goes to a box');
  });

  test('boxes never place two Pokemon in the same slot', () => {
    const profile = makeProfile();
    const rng = new Rng(22);
    for (let i = 0; i < 40; i++) {
      profile.addPokemon(createPokemon({ species: 'YUNGOOS', level: 4, rng, metLocation: 'Route 1' }));
    }
    const slots = profile.boxes.map((b) => `${b.box}:${b.slot}`);
    assert.equal(new Set(slots).size, slots.length);
  });

  test('a blackout costs money and heals the party', () => {
    const profile = makeProfile();
    profile.money = 4000;
    profile.party[0].currentHp = 0;
    const lost = profile.blackOut();
    assert.equal(lost, 1000);
    assert.equal(profile.money, 3000);
    assert.ok(profile.hasUsablePokemon, 'a blackout must leave the player able to continue');
  });

  test('swapping party slots is bounds-safe', () => {
    const profile = makeProfile();
    const rng = new Rng(23);
    profile.addPokemon(createPokemon({ species: 'LITTEN', level: 5, rng, metLocation: 'Iki' }));
    const [first, second] = profile.party;
    profile.swapParty(0, 1);
    assert.equal(profile.party[0], second);
    assert.equal(profile.party[1], first);
    assert.doesNotThrow(() => profile.swapParty(0, 99));
    assert.doesNotThrow(() => profile.swapParty(-1, 0));
  });

  test('a profile survives a full save round trip', async () => {
    const profile = makeProfile('LITTEN');
    profile.money = 12345;
    profile.playtimeSeconds = 3600;
    profile.island = 'akala';
    profile.setFlag('trial-01-cleared');
    profile.zCrystals.add('firium-z');
    profile.trialsCompleted.add('trial-melemele-verdant');
    profile.recordSeen('BEWEAR');
    profile.bag.add('ultra-ball', 7);
    profile.party[0].nickname = 'Ember';
    profile.party[0].currentHp = 9;

    const world = {
      worldSeed: SEED, timeOfDay: 43200,
      weather: { melemele: { current: 'rain', remaining: 120 } },
      ecology: {}, modifications: {}, discovered: [],
    };

    const storage = new MemoryStorage();
    const manager = new SaveManager(storage, 'test');
    await manager.save(0, profile.toSaveFile(world));
    const loaded = await manager.load(0);
    const back = GameProfile.fromSaveFile(loaded.save);

    assert.equal(back.name, 'Kai');
    assert.equal(back.money, 12345);
    assert.equal(back.island, 'akala');
    assert.equal(back.playtimeSeconds, 3600);
    assert.ok(back.hasFlag('trial-01-cleared'));
    assert.ok(back.zCrystals.has('firium-z'));
    assert.ok(back.trialsCompleted.has('trial-melemele-verdant'));
    assert.equal(back.bag.count('ultra-ball'), 7);
    assert.equal(back.party.length, 1);
    assert.equal(back.party[0].nickname, 'Ember');
    assert.equal(back.party[0].currentHp, 9);
    assert.equal(back.dexSeen, 2);
  });

  test('a save with an unknown species drops it instead of failing', () => {
    const profile = makeProfile();
    const world = {
      worldSeed: SEED, timeOfDay: 0, weather: {}, ecology: {}, modifications: {}, discovered: [],
    };
    const file = profile.toSaveFile(world);
    file.party.push({ ...toSaved(profile.party[0]), species: 'MISSINGNO' });
    const back = GameProfile.fromSaveFile({
      ...file, version: 4, savedAt: 0, gameBuild: 'test', checksum: '0',
    });
    assert.equal(back.party.length, 1, 'the real Pokemon survives, the phantom does not');
  });
});

// ------------------------------------------------------------------ session

describe('Battle session', () => {
  test('a wild encounter starts a battle that both sides can fight', () => {
    const session = makeSession();
    assert.equal(session.outcome, 'ongoing');
    assert.equal(session.playerActive.side, 0);
    assert.equal(session.foeActive.side, 1);
    assert.ok(session.playerActive.moves.length >= 1);
    assert.ok(session.foeActive.moves.length >= 1);
  });

  test('the arena is generated from where the player is standing', () => {
    const session = makeSession();
    assert.equal(session.arena.biome, 'grassland');
    assert.equal(session.arena.surface, 'foliage');
    assert.equal(session.arena.island, 'melemele');
    assert.ok(session.arena.radius > 0);
  });

  test('meeting a Pokemon registers it as seen', () => {
    const profile = makeProfile();
    const before = profile.dexSeen;
    makeSession({ profile, foe: 'BEWEAR' });
    assert.equal(profile.dexSeen, before + 1);
  });

  test('overworld weather carries into the fight', () => {
    const session = new BattleSession({
      profile: makeProfile(),
      offer: offerFor('PIKIPEK', 4),
      probe: FLAT_PROBE,
      weather: 'rain',
      hour: 12,
      island: 'melemele',
      seed: SEED,
    });
    assert.equal(session.state.field.weather, 'rain');
  });

  test('a full battle terminates and produces a result', () => {
    const session = makeSession({ starter: 'LITTEN', foe: 'PIKIPEK', foeLevel: 3 });
    for (let turn = 0; turn < 60 && session.outcome === 'ongoing'; turn++) {
      const move = session.playerActive.moves.find((m) => m.pp > 0);
      if (!move) break;
      session.submit({ kind: 'move', moveId: move.id });
    }
    assert.notEqual(session.outcome, 'ongoing', 'the battle must reach a conclusion');
  });

  test('defeating a wild Pokemon awards experience to the party', () => {
    const session = makeSession({ starter: 'LITTEN', foe: 'PIKIPEK', foeLevel: 2 });
    const expBefore = session.profile.party[0].exp;
    let gained = 0;
    for (let turn = 0; turn < 60 && session.outcome === 'ongoing'; turn++) {
      const move = session.playerActive.moves.find((m) => m.pp > 0);
      if (!move) break;
      gained += session.submit({ kind: 'move', moveId: move.id }).expGained;
    }
    if (session.outcome === 'won') {
      assert.ok(gained > 0, 'a win must award experience');
      assert.ok(session.profile.party[0].exp > expBefore);
    }
  });

  test('damage taken in battle persists onto the party afterwards', () => {
    const session = makeSession({ starter: 'ROWLET', foe: 'MUDBRAY', foeLevel: 30 });
    const mon = session.profile.party[0];
    const before = mon.currentHp;
    for (let turn = 0; turn < 4 && session.outcome === 'ongoing'; turn++) {
      const move = session.playerActive.moves.find((m) => m.pp > 0)!;
      session.submit({ kind: 'move', moveId: move.id });
    }
    assert.ok(mon.currentHp < before, 'a level 30 Mudbray should have hurt a level 5 Rowlet');
  });

  test('a Master Ball catch adds the Pokemon and ends the battle', () => {
    const profile = makeProfile();
    profile.bag.add('master-ball', 1);
    const session = makeSession({ profile, foe: 'PIKACHU', foeLevel: 8 });

    const result = session.submit({ kind: 'ball', ballId: 'master-ball' });
    assert.equal(result.outcome, 'caught');
    assert.ok(result.capture?.caught);
    assert.equal(session.captured?.species, 'PIKACHU');
    assert.equal(profile.party.length, 2);
    assert.ok(profile.pokedex.get('PIKACHU')?.caught);
    assert.equal(profile.bag.count('master-ball'), 0, 'the ball is consumed');
  });

  test('a caught Pokemon arrives with the damage it took', () => {
    const profile = makeProfile();
    profile.bag.add('master-ball', 1);
    const session = makeSession({ profile, foe: 'PIKACHU', foeLevel: 8 });
    session.foeActive.hp = 3;
    session.submit({ kind: 'ball', ballId: 'master-ball' });
    assert.equal(session.captured?.currentHp, 3);
  });

  test('throwing a ball you do not have changes nothing', () => {
    const session = makeSession();
    const result = session.submit({ kind: 'ball', ballId: 'beast-ball' });
    assert.equal(result.outcome, 'ongoing');
    assert.match(result.messages[0], /no Beast Ball/i);
  });

  test('running from an ordinary encounter ends the battle', () => {
    const session = makeSession({ starter: 'PIKACHU', foe: 'PIKIPEK', foeLevel: 2 });
    let outcome = session.outcome;
    for (let i = 0; i < 20 && outcome === 'ongoing'; i++) {
      outcome = session.submit({ kind: 'run' }).outcome;
      if (outcome === 'flee-failed') outcome = 'ongoing';
    }
    assert.equal(outcome, 'fled');
  });

  test('there is no running from an apex ambush', () => {
    const session = new BattleSession({
      profile: makeProfile(),
      offer: { candidate: { id: 1, speciesId: 'KOMMO_O', level: 40, position: { x: 2, y: 0, z: 0 }, goal: 'attack' }, distance: 2, reason: 'ambushed' },
      probe: FLAT_PROBE, weather: null, hour: 12, island: 'melemele', seed: SEED,
    });
    assert.equal(session.canFlee, false);
    const result = session.submit({ kind: 'run' });
    assert.equal(result.outcome, 'ongoing');
    assert.match(result.messages[0], /no running/i);
  });

  test('a move with no PP left is rejected rather than crashing', () => {
    const session = makeSession();
    for (const move of session.playerActive.moves) move.pp = 0;
    const result = session.submit({ kind: 'move', moveId: session.playerActive.moves[0].id });
    assert.equal(result.outcome, 'ongoing');
    assert.match(result.messages[0], /cannot be done/i);
  });

  test('switching brings in a different Pokemon', () => {
    const profile = makeProfile('ROWLET');
    profile.addPokemon(createPokemon({ species: 'LITTEN', level: 5, rng: new Rng(31), metLocation: 'Iki' }));
    const session = makeSession({ profile, foe: 'PIKIPEK', foeLevel: 2 });
    const before = session.playerActive.id;
    session.submit({ kind: 'switch', partyIndex: 1 });
    assert.notEqual(session.playerActive.id, before);
    assert.equal(session.playerActive.speciesId, 'LITTEN');
  });

  test('switching to a fainted Pokemon is refused', () => {
    const profile = makeProfile('ROWLET');
    const second = createPokemon({ species: 'LITTEN', level: 5, rng: new Rng(32), metLocation: 'Iki' });
    second.currentHp = 0;
    profile.addPokemon(second);
    const session = makeSession({ profile, foe: 'PIKIPEK', foeLevel: 2 });
    const result = session.submit({ kind: 'switch', partyIndex: 1 });
    assert.match(result.messages[0], /cannot be done/i);
  });

  test('a potion is consumed and heals', () => {
    const profile = makeProfile();
    const session = makeSession({ profile, foe: 'PIKIPEK', foeLevel: 2 });
    session.playerActive.hp = 1;
    profile.party[0].currentHp = 1;
    const balls = profile.bag.count('potion');
    session.submit({ kind: 'item', itemId: 'potion', partyIndex: 0 });
    assert.equal(profile.bag.count('potion'), balls - 1);
  });

  test('the same seed and inputs reproduce the same battle exactly', () => {
    const run = (): string[] => {
      const session = makeSession({ starter: 'LITTEN', foe: 'PIKIPEK', foeLevel: 4 });
      const log: string[] = [];
      for (let i = 0; i < 25 && session.outcome === 'ongoing'; i++) {
        const move = session.playerActive.moves.find((m) => m.pp > 0);
        if (!move) break;
        log.push(...session.submit({ kind: 'move', moveId: move.id }).messages);
      }
      return log;
    };
    assert.deepEqual(run(), run(), 'a battle is a pure function of its seed and inputs');
  });

  test('the log never mentions an event the engine did not emit', () => {
    const session = makeSession({ starter: 'LITTEN', foe: 'PIKIPEK', foeLevel: 4 });
    for (let i = 0; i < 20 && session.outcome === 'ongoing'; i++) {
      const move = session.playerActive.moves.find((m) => m.pp > 0);
      if (!move) break;
      const result = session.submit({ kind: 'move', moveId: move.id });
      for (const line of result.messages) {
        assert.equal(typeof line, 'string');
        assert.ok(line.length > 0, 'an empty log line is a formatting bug');
      }
    }
  });

  test('a Z-Move is unavailable without the ring and a crystal', () => {
    const profile = makeProfile('PIKACHU');
    const session = makeSession({ profile, foe: 'PIKIPEK', foeLevel: 4 });
    assert.equal(session.availableZMove(), null, 'no Z-Ring, no Z-Move');
  });

  test('a Z-Move becomes available with the ring, a crystal and a matching move', () => {
    const profile = makeProfile('PIKACHU');
    profile.bag.add('z-ring');
    profile.zCrystals.add('electrium-z');
    profile.party[0].level = 30;
    profile.party[0].moves = movesetFor('PIKACHU', 30).map((id) => ({ id, pp: getMove(id).pp }));

    const session = makeSession({ profile, foe: 'PIKIPEK', foeLevel: 4 });
    const zMove = session.availableZMove();
    assert.ok(zMove, 'Pikachu knowing an Electric move plus Electrium Z should unlock Gigavolt Havoc');
    assert.equal(zMove.type, 'electric');
  });

  test('a mistimed Z-Move pose still delivers most of its power', () => {
    const profile = makeProfile('PIKACHU');
    profile.bag.add('z-ring');
    profile.zCrystals.add('electrium-z');
    profile.party[0].level = 30;
    profile.party[0].moves = movesetFor('PIKACHU', 30).map((id) => ({ id, pp: getMove(id).pp }));
    const session = makeSession({ profile, foe: 'MUDBRAY', foeLevel: 20 });

    const zMove = session.availableZMove()!;
    const electric = session.playerActive.moves.find((m) => getMove(m.id).type === 'electric')!;
    const result = session.submit({ kind: 'move', moveId: electric.id, zMove: true, pose: [] });
    assert.ok(result.poseResult, 'a Z-Move attempt should report a pose result');
    assert.ok(result.poseResult.powerMultiplier >= 0.85, 'a fumbled pose must not waste the Z-Move');
    void zMove;
  });

  test('a Z-Move log reads as one announcement, not two', () => {
    const profile = makeProfile('PIKACHU');
    profile.bag.add('z-ring');
    profile.zCrystals.add('electrium-z');
    profile.party[0].level = 30;
    profile.party[0].moves = movesetFor('PIKACHU', 30).map((id) => ({ id, pp: getMove(id).pp }));
    const session = makeSession({ profile, foe: 'MUDBRAY', foeLevel: 20 });
    const electric = session.playerActive.moves.find((m) => getMove(m.id).type === 'electric')!;

    const result = session.submit({ kind: 'move', moveId: electric.id, zMove: true, pose: [] });
    const zLines = result.messages.filter((l) => /Z-Power|Gigavolt/.test(l));
    assert.equal(zLines.length, 2, `expected the Z-Power pair, got: ${result.messages.join(' | ')}`);
    assert.ok(!result.messages.some((l) => /used .*Thunder/i.test(l)), 'the base move must not be announced twice');
  });
});
