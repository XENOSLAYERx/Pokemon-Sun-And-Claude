import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PokemonTypes, effectiveness, effectivenessAgainst, weaknessesOf, resistancesOf,
} from '../src/types.ts';
import { allSpecies, getSpecies, tryGetSpecies, predatorsFor, rideSpecies, isActiveAtHour } from '../src/species/registry.ts';
import { allMoves, getMove, tryGetMove } from '../src/moves/registry.ts';
import { allZMoves, zMoveDuration, zMoveForCrystal } from '../src/moves/zmoves.ts';
import { allBiomes, getBiome, BiomeIds } from '../src/world/biomes.ts';
import { allIslands, islandAt, nearestIsland, worldBounds } from '../src/world/islands.ts';
import { SPAWN_TABLE, scoreSpawnEntry, eligibleSpawns } from '../src/tables/spawns.ts';
import type { SpawnConditions } from '../src/tables/spawns.ts';
import { allItems, tryGetItem } from '../src/items/items.ts';
import { allTrials } from '../src/quests/trials.ts';
import { allQuests, FACTIONS } from '../src/quests/quests.ts';

describe('Type chart', () => {
  test('is complete and symmetric in shape', () => {
    for (const a of PokemonTypes) {
      for (const d of PokemonTypes) {
        const e = effectiveness(a, d);
        assert.ok([0, 0.5, 1, 2].includes(e), `${a}->${d} = ${e} is not a legal multiplier`);
      }
    }
  });

  test('known matchups are correct', () => {
    assert.equal(effectiveness('water', 'fire'), 2);
    assert.equal(effectiveness('fire', 'water'), 0.5);
    assert.equal(effectiveness('electric', 'ground'), 0);
    assert.equal(effectiveness('normal', 'ghost'), 0);
    assert.equal(effectiveness('ghost', 'normal'), 0);
    assert.equal(effectiveness('dragon', 'fairy'), 0);
    assert.equal(effectiveness('fighting', 'dark'), 2);
    assert.equal(effectiveness('psychic', 'dark'), 0);
  });

  test('dual types multiply, and immunity dominates', () => {
    // Rock/Ground vs Water = 2 * 2 = 4
    assert.equal(effectivenessAgainst('water', ['rock', 'ground']), 4);
    // Alolan Sandshrew (Ice/Steel) vs Fighting = 2 * 2 = 4
    assert.equal(effectivenessAgainst('fighting', ['ice', 'steel']), 4);
    // Flying/Ground would be immune to Electric via Ground even though Flying is weak.
    assert.equal(effectivenessAgainst('electric', ['flying', 'ground']), 0);
    // Steel/Fairy vs Dragon = 0.5 * 0 = 0
    assert.equal(effectivenessAgainst('dragon', ['steel', 'fairy']), 0);
  });

  test('weakness/resistance helpers agree with the chart', () => {
    const weak = weaknessesOf(['fire']);
    assert.ok(weak.includes('water') && weak.includes('ground') && weak.includes('rock'));
    const resist = resistancesOf(['fire']);
    assert.ok(resist.includes('fire') && resist.includes('grass') && resist.includes('steel'));
  });
});

describe('Species registry integrity', () => {
  const species = allSpecies();

  test('registry is populated', () => {
    assert.ok(species.length >= 40, `expected a substantial dex, got ${species.length}`);
  });

  test('every species has legal stats and metadata', () => {
    for (const s of species) {
      assert.ok(s.id.length > 0, 'species id must be non-empty');
      assert.equal(s.id, s.id.toUpperCase(), `${s.id}: ids must be uppercase`);
      assert.ok(s.types.length >= 1 && s.types.length <= 2, `${s.id}: must have 1-2 types`);
      for (const t of s.types) {
        assert.ok(PokemonTypes.includes(t), `${s.id}: unknown type "${t}"`);
      }
      if (s.types.length === 2) {
        assert.notEqual(s.types[0], s.types[1], `${s.id}: duplicate type`);
      }
      for (const [k, v] of Object.entries(s.baseStats)) {
        assert.ok(v >= 1 && v <= 255, `${s.id}: base ${k}=${v} out of range`);
      }
      assert.ok(s.height > 0, `${s.id}: height must be positive`);
      assert.ok(s.weight > 0, `${s.id}: weight must be positive`);
      assert.ok(s.catchRate >= 0 && s.catchRate <= 255, `${s.id}: bad catch rate`);
      assert.ok(s.genderRatio === null || (s.genderRatio >= 0 && s.genderRatio <= 1), `${s.id}: bad gender ratio`);
      assert.ok(s.abilities.length >= 1, `${s.id}: needs at least one ability`);
      assert.ok(s.statTotal > 0);
    }
  });

  test('overworld simulation fields are coherent', () => {
    for (const s of species) {
      assert.ok(s.moveSpeed > 0, `${s.id}: moveSpeed must be positive`);
      assert.ok(s.sightRange > 0, `${s.id}: sightRange must be positive`);
      assert.ok(s.hearingRange > 0, `${s.id}: hearingRange must be positive`);
      assert.ok(s.fovHalfAngle > 0 && s.fovHalfAngle <= Math.PI, `${s.id}: fov out of range`);
      assert.ok(s.territoryRadius >= 0, `${s.id}: negative territory`);
      const [lo, hi] = s.packSize;
      assert.ok(lo >= 1 && hi >= lo, `${s.id}: bad pack size [${lo}, ${hi}]`);
      for (const h of s.activeHours) {
        assert.ok(h >= 0 && h <= 23, `${s.id}: active hour ${h} out of range`);
      }
      // Cached squares must match.
      assert.equal(s.sightRangeSq, s.sightRange * s.sightRange, `${s.id}: stale sightRangeSq`);
    }
  });

  test('predator-prey references resolve', () => {
    for (const s of species) {
      for (const prey of s.preysOn) {
        assert.ok(tryGetSpecies(prey), `${s.id} preys on unknown species "${prey}"`);
        assert.notEqual(prey, s.id, `${s.id} cannot prey on itself`);
      }
    }
  });

  test('reverse predator index is consistent with preysOn', () => {
    for (const s of species) {
      for (const prey of s.preysOn) {
        assert.ok(predatorsFor(prey).includes(s.id), `predatorsFor(${prey}) missing ${s.id}`);
      }
    }
  });

  test('ride Pokémon declare a role and can actually move that way', () => {
    const rides = rideSpecies();
    assert.ok(rides.length >= 5, 'need a full ride roster');
    for (const r of rides) {
      assert.ok(r.rideRole, `${r.id}: missing rideRole`);
      if (r.rideRole === 'water') {
        assert.ok(r.movement === 'swimmer' || r.movement === 'amphibious', `${r.id}: water ride must swim`);
      }
      if (r.rideRole === 'air') {
        assert.ok(r.movement === 'flyer', `${r.id}: air ride must fly`);
      }
    }
  });

  test('isActiveAtHour matches the declared schedule', () => {
    const pikachu = getSpecies('PIKACHU');
    assert.ok(isActiveAtHour(pikachu, 12), 'Pikachu is diurnal');
    assert.ok(!isActiveAtHour(pikachu, 2), 'Pikachu sleeps at 2am');
    const bewear = getSpecies('BEWEAR');
    assert.ok(isActiveAtHour(bewear, 3), 'Bewear has no schedule, always active');
  });

  test('unknown species raises a helpful error', () => {
    assert.throws(() => getSpecies('NOTAPOKEMON'), /Unknown species/);
  });
});

describe('Move registry integrity', () => {
  const moves = allMoves();

  test('every move is well formed', () => {
    for (const m of moves) {
      assert.ok(PokemonTypes.includes(m.type), `${m.id}: unknown type`);
      assert.ok(m.pp > 0 && m.pp <= 64, `${m.id}: bad PP`);
      assert.ok(m.priority >= -7 && m.priority <= 5, `${m.id}: bad priority`);
      if (m.category === 'status') {
        assert.equal(m.power, null, `${m.id}: status moves must have null power`);
      } else {
        // Nature's Madness is a damaging move with no fixed power — allowed.
        if (m.power !== null) {
          assert.ok(m.power > 0 && m.power <= 250, `${m.id}: power ${m.power} out of range`);
        }
      }
      if (m.accuracy !== null) {
        assert.ok(m.accuracy > 0 && m.accuracy <= 100, `${m.id}: bad accuracy`);
      }
      if (m.secondary) {
        assert.ok(m.secondary.chance > 0 && m.secondary.chance <= 100, `${m.id}: bad secondary chance`);
      }
      if (m.multiHit) {
        const [lo, hi] = m.multiHit;
        assert.ok(lo >= 2 && hi >= lo, `${m.id}: bad multiHit range`);
      }
      if (m.drain !== undefined) assert.ok(m.drain > 0 && m.drain <= 1, `${m.id}: bad drain`);
      if (m.recoil !== undefined) assert.ok(m.recoil > 0 && m.recoil <= 1, `${m.id}: bad recoil`);
      assert.ok(m.animation.length > 0, `${m.id}: missing animation key`);
    }
  });

  test('ids are unique and kebab-case', () => {
    const seen = new Set<string>();
    for (const m of moves) {
      assert.ok(!seen.has(m.id), `duplicate move id "${m.id}"`);
      seen.add(m.id);
      assert.match(m.id, /^[a-z0-9-]+$/, `${m.id}: ids must be kebab-case`);
    }
  });
});

describe('Z-Move integrity', () => {
  test('beats are ordered and reference valid cameras', () => {
    for (const z of allZMoves()) {
      let last = -1;
      for (const b of z.beats) {
        assert.ok(b.at > last, `${z.id}: beats must be strictly increasing (${b.at} after ${last})`);
        last = b.at;
        if (b.shake !== undefined) assert.ok(b.shake >= 0 && b.shake <= 1, `${z.id}: shake out of range`);
        if (b.timeScale !== undefined) assert.ok(b.timeScale > 0 && b.timeScale <= 2, `${z.id}: bad timeScale`);
      }
      assert.ok(z.beats.length >= 3, `${z.id}: a Z-Move needs a real cinematic`);
      assert.ok(zMoveDuration(z) > 3, `${z.id}: cinematic too short to land`);
    }
  });

  test('every Z-Move has a pose with a usable input window', () => {
    for (const z of allZMoves()) {
      assert.ok(z.pose.inputs.length >= 2, `${z.id}: pose needs a real input sequence`);
      assert.ok(z.pose.window >= 1.5, `${z.id}: pose window too tight to be fair`);
    }
  });

  test('exclusive Z-Moves reference real species and moves', () => {
    for (const z of allZMoves()) {
      if (!z.exclusiveTo) continue;
      assert.ok(tryGetSpecies(z.exclusiveTo.species), `${z.id}: unknown species "${z.exclusiveTo.species}"`);
      // The base move may be species-signature and defined elsewhere; only check
      // the ones we shipped in the move table.
      const base = tryGetMove(z.exclusiveTo.baseMove);
      if (base) {
        assert.ok(base.id === z.exclusiveTo.baseMove);
      }
    }
  });

  test('crystals map back to their Z-Move', () => {
    for (const z of allZMoves()) {
      assert.equal(zMoveForCrystal(z.crystal)?.id, z.id);
    }
  });

  test('environment reactions have sane radii', () => {
    for (const z of allZMoves()) {
      assert.ok(z.environment.length > 0, `${z.id}: Z-Moves must affect the world`);
      for (const e of z.environment) {
        assert.ok(e.radius > 0 && e.radius <= 50, `${z.id}: reaction radius ${e.radius} unreasonable`);
        assert.ok(e.duration === -1 || e.duration > 0, `${z.id}: bad duration`);
      }
    }
  });
});

describe('World data integrity', () => {
  test('every biome id in the union has a definition', () => {
    for (const id of BiomeIds) {
      const b = getBiome(id);
      assert.equal(b.id, id);
    }
  });

  test('biome bands are ordered and colours are normalised', () => {
    for (const b of allBiomes()) {
      assert.ok(b.heightRange[0] < b.heightRange[1], `${b.id}: inverted height range`);
      assert.ok(b.moistureRange[0] <= b.moistureRange[1], `${b.id}: inverted moisture range`);
      assert.ok(b.tempRange[0] < b.tempRange[1], `${b.id}: inverted temp range`);
      for (const c of b.groundColor) {
        assert.ok(c >= 0 && c <= 1, `${b.id}: ground colour must be 0-1`);
      }
      assert.ok(b.danger >= 0 && b.danger <= 5, `${b.id}: danger out of range`);
      assert.ok(b.foliageDensity >= 0, `${b.id}: negative foliage density`);
      // Foliage density implies at least one prototype.
      if (b.foliageDensity > 0) {
        assert.ok(b.foliage.length > 0, `${b.id}: density > 0 but no foliage prototypes`);
      }
    }
  });

  test('all five islands exist with the required progression order', () => {
    const islands = allIslands();
    assert.equal(islands.length, 5);
    const orders = islands.map((i) => i.order).sort((a, b) => a - b);
    assert.deepEqual(orders, [1, 2, 3, 4, 5]);
    const ids = new Set(islands.map((i) => i.id));
    for (const required of ['melemele', 'akala', 'ulaula', 'poni', 'aether']) {
      assert.ok(ids.has(required), `missing island "${required}"`);
    }
  });

  test('islands do not overlap', () => {
    const islands = allIslands();
    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const a = islands[i];
        const b = islands[j];
        const d = Math.hypot(a.centerX - b.centerX, a.centerZ - b.centerZ);
        assert.ok(
          d > a.radius + b.radius,
          `${a.id} and ${b.id} overlap: distance ${d.toFixed(0)}m < ${a.radius + b.radius}m`,
        );
      }
    }
  });

  test('islands are significantly larger than the originals', () => {
    for (const i of allIslands()) {
      if (i.id === 'aether') continue; // A platform, not a landmass.
      assert.ok(i.radius >= 2500, `${i.id}: radius ${i.radius}m is too small for an open world`);
    }
  });

  test('island guardians and features resolve', () => {
    for (const i of allIslands()) {
      if (i.guardian) {
        assert.ok(tryGetSpecies(i.guardian), `${i.id}: unknown guardian "${i.guardian}"`);
      }
      assert.ok(i.features.length > 0, `${i.id}: no terrain features`);
      for (const f of i.features) {
        assert.ok(Math.hypot(f.x, f.z) <= i.radius * 1.2, `${i.id}: feature outside island bounds`);
        if (f.kind === 'ridge' || f.kind === 'canyon') {
          assert.ok(f.x2 !== undefined && f.z2 !== undefined, `${i.id}: ${f.kind} needs an end point`);
        }
        if (f.biome) {
          assert.ok(BiomeIds.includes(f.biome), `${i.id}: feature has unknown biome "${f.biome}"`);
        }
      }
      for (const s of i.settlements) {
        assert.ok(Math.hypot(s.x, s.z) <= i.radius, `${i.id}: settlement "${s.id}" outside island`);
        assert.ok(s.population > 0, `${s.id}: population must be positive`);
      }
      for (const p of i.pois) {
        assert.ok(p.level > 0, `${p.id}: level must be positive`);
        assert.ok(p.description.length > 20, `${p.id}: needs a real description`);
      }
      assert.ok(i.levelRange[0] < i.levelRange[1], `${i.id}: inverted level range`);
    }
  });

  test('islandAt and nearestIsland are consistent', () => {
    for (const i of allIslands()) {
      const found = islandAt(i.centerX, i.centerZ);
      assert.equal(found?.id, i.id, `islandAt failed at the centre of ${i.id}`);
      const near = nearestIsland(i.centerX, i.centerZ);
      assert.equal(near.island.id, i.id);
      assert.ok(near.distance < 0, 'inside an island, shoreline distance should be negative');
    }
    // A point far out to sea belongs to no island.
    assert.equal(islandAt(100000, 100000), null);
  });

  test('world bounds enclose every island', () => {
    const b = worldBounds();
    for (const i of allIslands()) {
      assert.ok(i.centerX - i.radius >= b.minX && i.centerX + i.radius <= b.maxX, `${i.id} outside X bounds`);
      assert.ok(i.centerZ - i.radius >= b.minZ && i.centerZ + i.radius <= b.maxZ, `${i.id} outside Z bounds`);
    }
  });
});

describe('Spawn table integrity', () => {
  test('every entry references real species, biomes and islands', () => {
    const islandIds = new Set(allIslands().map((i) => i.id));
    for (const e of SPAWN_TABLE) {
      assert.ok(tryGetSpecies(e.species), `spawn entry references unknown species "${e.species}"`);
      assert.ok(e.biomes.length > 0, `${e.species}: entry must list at least one biome`);
      for (const b of e.biomes) {
        assert.ok(BiomeIds.includes(b), `${e.species}: unknown biome "${b}"`);
      }
      for (const i of e.islands ?? []) {
        assert.ok(islandIds.has(i), `${e.species}: unknown island "${i}"`);
      }
      const [lo, hi] = e.levelRange;
      assert.ok(lo >= 1 && hi >= lo && hi <= 100, `${e.species}: bad level range [${lo}, ${hi}]`);
      assert.ok(e.weight > 0, `${e.species}: weight must be positive`);
      for (const h of e.hours ?? []) {
        assert.ok(h >= 0 && h <= 23, `${e.species}: hour ${h} out of range`);
      }
      if (e.alphaChance !== undefined) {
        assert.ok(e.alphaChance > 0 && e.alphaChance <= 1, `${e.species}: bad alpha chance`);
      }
    }
  });

  test('aquatic species only spawn in water biomes', () => {
    const waterBiomes = new Set(allBiomes().filter((b) => b.aquatic).map((b) => b.id));
    for (const e of SPAWN_TABLE) {
      const s = getSpecies(e.species);
      if (s.movement !== 'swimmer') continue;
      for (const b of e.biomes) {
        assert.ok(waterBiomes.has(b), `${e.species} is a swimmer but spawns in non-aquatic biome "${b}"`);
      }
    }
  });

  test('scoring rejects mismatched conditions', () => {
    const base: SpawnConditions = {
      biome: 'tropical-forest', island: 'melemele', hour: 12,
      weather: 'clear', altitude: 40, flags: new Set(),
    };
    const pikachuDay = SPAWN_TABLE.find((e) => e.species === 'PIKACHU' && !e.weather)!;
    assert.ok(scoreSpawnEntry(pikachuDay, base) > 0, 'Pikachu should spawn in daytime forest');
    assert.equal(scoreSpawnEntry(pikachuDay, { ...base, hour: 2 }), 0, 'not at 2am');
    assert.equal(scoreSpawnEntry(pikachuDay, { ...base, biome: 'snowfield' }), 0, 'not in a snowfield');
  });

  test('weather bonus actually increases the effective weight', () => {
    const stormPikachu = SPAWN_TABLE.find(
      (e) => e.species === 'PIKACHU' && e.weather?.includes('thunderstorm'),
    )!;
    const cond: SpawnConditions = {
      biome: 'tropical-forest', island: 'melemele', hour: 12,
      weather: 'thunderstorm', altitude: 40, flags: new Set(),
    };
    const scored = scoreSpawnEntry(stormPikachu, cond);
    assert.ok(scored > stormPikachu.weight, 'weather bonus should raise the weight');
    assert.equal(scoreSpawnEntry(stormPikachu, { ...cond, weather: 'clear' }), 0);
  });

  test('flag-gated spawns stay hidden until the flag is set', () => {
    const cond: SpawnConditions = {
      biome: 'ultra-space', island: null, hour: 12,
      weather: 'clear', altitude: 0, flags: new Set(),
    };
    assert.equal(eligibleSpawns(cond).length, 0, 'Ultra Beasts must be gated');
    const unlocked = eligibleSpawns({ ...cond, flags: new Set(['ultra_access']) });
    assert.ok(unlocked.length >= 4, 'unlocking should reveal the Ultra Beast table');
  });

  test('every walkable land biome has at least one possible spawn', () => {
    // A biome the player can stand in with nothing to find is a content hole.
    const exempt = new Set(['facility', 'town', 'city', 'lava-field', 'beach', 'deep-ocean']);
    for (const b of allBiomes()) {
      if (!b.walkable || exempt.has(b.id)) continue;
      const any = SPAWN_TABLE.some((e) => e.biomes.includes(b.id));
      assert.ok(any, `biome "${b.id}" is walkable but has no spawn entries`);
    }
  });
});

describe('Items, trials and quests', () => {
  test('item pricing is coherent', () => {
    for (const i of allItems()) {
      assert.ok(i.price >= 0 && i.sellPrice >= 0, `${i.id}: negative price`);
      assert.ok(i.stackLimit > 0, `${i.id}: bad stack limit`);
      if (i.isKey) {
        assert.equal(i.price, 0, `${i.id}: key items must not be purchasable`);
      }
      if (i.category === 'pokeball') {
        assert.ok(i.catchMultiplier !== undefined && i.catchMultiplier > 0, `${i.id}: ball needs a catch multiplier`);
      }
    }
  });

  test('Z-Crystal items map to real Z-Moves', () => {
    for (const i of allItems()) {
      if (i.category !== 'z-crystal') continue;
      assert.ok(i.zMove, `${i.id}: crystal must name a Z-Move`);
      assert.ok(zMoveForCrystal(i.id), `${i.id}: no Z-Move bound to this crystal`);
    }
  });

  test('trials reference real islands, POIs, species and moves', () => {
    const islands = new Map(allIslands().map((i) => [i.id, i]));
    for (const t of allTrials()) {
      const island = islands.get(t.island);
      assert.ok(island, `${t.id}: unknown island "${t.island}"`);
      assert.ok(island!.pois.some((p) => p.id === t.poi), `${t.id}: POI "${t.poi}" not on ${t.island}`);
      assert.ok(tryGetSpecies(t.totem.species), `${t.id}: unknown Totem species`);
      assert.ok(t.totem.scale > 1, `${t.id}: a Totem must be visibly oversized`);
      for (const m of t.totem.moves) {
        assert.ok(tryGetMove(m), `${t.id}: Totem has unknown move "${m}"`);
      }
      if (t.totem.heldItem) {
        assert.ok(tryGetItem(t.totem.heldItem), `${t.id}: unknown held item "${t.totem.heldItem}"`);
      }
      for (const ally of t.totem.sosAllies) {
        assert.ok(tryGetSpecies(ally.species), `${t.id}: unknown SOS ally "${ally.species}"`);
        assert.ok(ally.atHpPercent > 0 && ally.atHpPercent < 1, `${t.id}: bad SOS threshold`);
      }
      assert.ok(t.stages.length >= 3, `${t.id}: a trial needs real structure`);
      assert.ok(t.stages.some((s) => s.kind === 'boss'), `${t.id}: every trial ends in a Totem fight`);
    }
  });

  test('Totem phases descend monotonically and start at full HP', () => {
    for (const t of allTrials()) {
      const phases = t.totem.phases;
      assert.ok(phases.length >= 2, `${t.id}: a Totem needs multiple phases`);
      assert.equal(phases[0].atHpPercent, 1.0, `${t.id}: first phase must start at full HP`);
      for (let i = 1; i < phases.length; i++) {
        assert.ok(
          phases[i].atHpPercent < phases[i - 1].atHpPercent,
          `${t.id}: phase thresholds must descend`,
        );
      }
    }
  });

  test('trial rewards are real items', () => {
    for (const t of allTrials()) {
      assert.ok(tryGetItem(t.reward), `${t.id}: reward "${t.reward}" is not a defined item`);
    }
  });

  test('quest objective graphs are acyclic and fully reachable', () => {
    for (const q of allQuests()) {
      const ids = new Set(q.objectives.map((o) => o.id));
      for (const o of q.objectives) {
        for (const r of o.requires ?? []) {
          assert.ok(ids.has(r), `${q.id}/${o.id}: requires unknown objective "${r}"`);
          assert.notEqual(r, o.id, `${q.id}/${o.id}: self-dependency`);
        }
        for (const b of o.branches ?? []) {
          assert.ok(b.leadsTo.length > 0, `${q.id}/${o.id}: branch missing outcome`);
        }
      }
      // Every objective must be reachable from a root (one with no requires).
      const roots = q.objectives.filter((o) => !o.requires || o.requires.length === 0);
      assert.ok(roots.length > 0, `${q.id}: no starting objective`);

      const reachable = new Set(roots.map((r) => r.id));
      let changed = true;
      while (changed) {
        changed = false;
        for (const o of q.objectives) {
          if (reachable.has(o.id)) continue;
          if ((o.requires ?? []).every((r) => reachable.has(r))) {
            reachable.add(o.id);
            changed = true;
          }
        }
      }
      for (const o of q.objectives) {
        assert.ok(reachable.has(o.id), `${q.id}/${o.id}: unreachable (cyclic or orphaned dependency)`);
      }
    }
  });

  test('quest rewards reference real items and known factions', () => {
    const factions = new Set<string>(FACTIONS);
    for (const q of allQuests()) {
      assert.ok(Object.keys(q.rewards).length > 0, `${q.id}: no rewards defined`);
      for (const [outcome, r] of Object.entries(q.rewards)) {
        for (const it of r.items ?? []) {
          assert.ok(tryGetItem(it.id), `${q.id}/${outcome}: unknown item "${it.id}"`);
          assert.ok(it.count > 0, `${q.id}/${outcome}: bad item count`);
        }
        for (const f of Object.keys(r.reputation ?? {})) {
          assert.ok(factions.has(f), `${q.id}/${outcome}: unknown faction "${f}"`);
        }
        for (const p of r.pokemon ?? []) {
          assert.ok(tryGetSpecies(p.species), `${q.id}/${outcome}: unknown gift species "${p.species}"`);
        }
      }
    }
  });

  test('branching quests define a reward for every branch outcome', () => {
    for (const q of allQuests()) {
      for (const o of q.objectives) {
        for (const b of o.branches ?? []) {
          assert.ok(
            q.rewards[b.leadsTo] !== undefined,
            `${q.id}: branch "${b.id}" leads to "${b.leadsTo}" which has no reward entry`,
          );
        }
      }
    }
  });

  test('quest unlock chains resolve', () => {
    const ids = new Set(allQuests().map((q) => q.id));
    for (const q of allQuests()) {
      for (const u of q.unlocks ?? []) {
        assert.ok(ids.has(u), `${q.id}: unlocks unknown quest "${u}"`);
      }
    }
  });
});
