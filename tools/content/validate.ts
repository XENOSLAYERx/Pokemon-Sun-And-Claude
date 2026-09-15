/**
 * Content validator.
 *
 * Runs the full referential-integrity and design-rule pass over the content
 * layer and reports every problem, rather than throwing on the first one. This
 * runs in CI on every content change and locally before a designer commits.
 *
 * The distinction between errors and warnings matters: an error is something
 * that will break at runtime (a quest referencing a species that does not
 * exist), while a warning is a design smell that a human should look at (a
 * biome the player can reach with nothing to find in it). Errors block the
 * build; warnings do not.
 *
 * Run: npm run validate:content
 */
import {
  allSpecies, allMoves, allZMoves, allBiomes, allIslands, allItems,
  allTrials, allQuests, tryGetSpecies, tryGetMove, tryGetItem, tryGetQuest,
  zMoveForCrystal, SPAWN_TABLE, BiomeIds, PokemonTypes, FACTIONS,
  predatorsFor, type BiomeId,
} from '@alola/data';

interface Problem {
  readonly severity: 'error' | 'warning';
  readonly area: string;
  readonly subject: string;
  readonly message: string;
}

const problems: Problem[] = [];

function error(area: string, subject: string, message: string): void {
  problems.push({ severity: 'error', area, subject, message });
}

function warn(area: string, subject: string, message: string): void {
  problems.push({ severity: 'warning', area, subject, message });
}

// ----------------------------------------------------------------- species

function validateSpecies(): void {
  const seenDex = new Map<number, string[]>();

  for (const species of allSpecies()) {
    if (species.id !== species.id.toUpperCase()) {
      error('species', species.id, 'ids must be uppercase');
    }
    if (species.types.length === 2 && species.types[0] === species.types[1]) {
      error('species', species.id, 'duplicate type');
    }
    for (const type of species.types) {
      if (!PokemonTypes.includes(type)) {
        error('species', species.id, `unknown type "${type}"`);
      }
    }

    const stats = Object.entries(species.baseStats);
    for (const [key, value] of stats) {
      if (value < 1 || value > 255) error('species', species.id, `base ${key}=${value} out of range`);
    }

    if (species.height <= 0) error('species', species.id, 'height must be positive');
    if (species.weight <= 0) error('species', species.id, 'weight must be positive');
    if (species.abilities.length === 0) error('species', species.id, 'no abilities');
    if (species.flavorText.length < 20) warn('species', species.id, 'flavour text is very short');

    // Overworld simulation fields.
    if (species.moveSpeed <= 0) error('species', species.id, 'moveSpeed must be positive');
    if (species.sightRange <= 0) error('species', species.id, 'sightRange must be positive');
    if (species.fovHalfAngle <= 0 || species.fovHalfAngle > Math.PI) {
      error('species', species.id, `fovHalfAngle ${species.fovHalfAngle} out of range`);
    }
    const [packMin, packMax] = species.packSize;
    if (packMin < 1 || packMax < packMin) {
      error('species', species.id, `bad pack size [${packMin}, ${packMax}]`);
    }
    for (const hour of species.activeHours) {
      if (hour < 0 || hour > 23) error('species', species.id, `active hour ${hour} out of range`);
    }

    // Predator-prey graph.
    for (const prey of species.preysOn) {
      if (!tryGetSpecies(prey)) {
        error('species', species.id, `preys on unknown species "${prey}"`);
      } else if (prey === species.id) {
        error('species', species.id, 'cannot prey on itself');
      } else if (!predatorsFor(prey).includes(species.id)) {
        error('species', species.id, `reverse predator index is missing it for "${prey}"`);
      }
    }

    // Ride roles must be physically possible.
    if (species.rideRole === 'water' && species.movement !== 'swimmer' && species.movement !== 'amphibious') {
      error('species', species.id, 'water ride must be a swimmer or amphibious');
    }
    if (species.rideRole === 'air' && species.movement !== 'flyer') {
      error('species', species.id, 'air ride must be a flyer');
    }

    const list = seenDex.get(species.dex) ?? [];
    list.push(species.id);
    seenDex.set(species.dex, list);
  }

  // Regional forms legitimately share a dex number; anything else is suspect.
  for (const [dex, ids] of seenDex) {
    if (ids.length > 1 && !ids.some((id) => id.includes('_'))) {
      warn('species', String(dex), `dex number shared by ${ids.join(', ')} with no regional form`);
    }
  }
}

// ------------------------------------------------------------------- moves

function validateMoves(): void {
  for (const move of allMoves()) {
    if (!/^[a-z0-9-]+$/.test(move.id)) error('move', move.id, 'ids must be kebab-case');
    if (move.pp <= 0 || move.pp > 64) error('move', move.id, `bad PP ${move.pp}`);
    if (move.priority < -7 || move.priority > 5) error('move', move.id, `bad priority ${move.priority}`);

    if (move.category === 'status' && move.power !== null) {
      error('move', move.id, 'status moves must have null power');
    }
    if (move.power !== null && (move.power <= 0 || move.power > 250)) {
      error('move', move.id, `power ${move.power} out of range`);
    }
    if (move.accuracy !== null && (move.accuracy <= 0 || move.accuracy > 100)) {
      error('move', move.id, `accuracy ${move.accuracy} out of range`);
    }
    if (move.secondary && (move.secondary.chance <= 0 || move.secondary.chance > 100)) {
      error('move', move.id, `secondary chance ${move.secondary.chance} out of range`);
    }
    if (move.multiHit) {
      const [lo, hi] = move.multiHit;
      if (lo < 2 || hi < lo) error('move', move.id, `bad multiHit [${lo}, ${hi}]`);
    }
    if (move.drain !== undefined && (move.drain <= 0 || move.drain > 1)) {
      error('move', move.id, `drain ${move.drain} out of range`);
    }
    if (move.recoil !== undefined && (move.recoil <= 0 || move.recoil > 1)) {
      error('move', move.id, `recoil ${move.recoil} out of range`);
    }
    if (move.animation.length === 0) error('move', move.id, 'missing animation key');
    if (move.description.length < 10) warn('move', move.id, 'description is very short');
  }
}

function validateZMoves(): void {
  for (const z of allZMoves()) {
    if (z.beats.length < 3) error('z-move', z.id, 'needs at least three cinematic beats');
    let last = -1;
    for (const beat of z.beats) {
      if (beat.at <= last) error('z-move', z.id, `beats must strictly increase (${beat.at} after ${last})`);
      last = beat.at;
      if (beat.shake !== undefined && (beat.shake < 0 || beat.shake > 1)) {
        error('z-move', z.id, `shake ${beat.shake} out of range`);
      }
      if (beat.timeScale !== undefined && (beat.timeScale <= 0 || beat.timeScale > 2)) {
        error('z-move', z.id, `timeScale ${beat.timeScale} out of range`);
      }
    }

    if (z.pose.inputs.length < 2) error('z-move', z.id, 'pose needs a real input sequence');
    if (z.pose.window < 1.5) error('z-move', z.id, `pose window ${z.pose.window}s is too tight to be fair`);

    if (z.environment.length === 0) warn('z-move', z.id, 'has no environmental reaction');
    for (const reaction of z.environment) {
      if (reaction.radius <= 0 || reaction.radius > 50) {
        error('z-move', z.id, `reaction radius ${reaction.radius} is implausible`);
      }
      if (reaction.duration !== -1 && reaction.duration <= 0) {
        error('z-move', z.id, `bad reaction duration ${reaction.duration}`);
      }
    }

    if (z.exclusiveTo && !tryGetSpecies(z.exclusiveTo.species)) {
      error('z-move', z.id, `exclusive to unknown species "${z.exclusiveTo.species}"`);
    }
    if (zMoveForCrystal(z.crystal)?.id !== z.id) {
      error('z-move', z.id, `crystal "${z.crystal}" does not map back to this Z-Move`);
    }
  }
}

// ------------------------------------------------------------------- world

function validateWorld(): void {
  for (const id of BiomeIds) {
    const biome = allBiomes().find((b) => b.id === id);
    if (!biome) {
      error('biome', id, 'declared in BiomeIds but has no definition');
      continue;
    }
    if (biome.heightRange[0] >= biome.heightRange[1]) {
      error('biome', id, 'inverted height range');
    }
    if (biome.tempRange[0] >= biome.tempRange[1]) error('biome', id, 'inverted temperature range');
    for (const channel of biome.groundColor) {
      if (channel < 0 || channel > 1) error('biome', id, 'ground colour must be 0-1');
    }
    if (biome.foliageDensity > 0 && biome.foliage.length === 0) {
      error('biome', id, 'has foliage density but no prototypes');
    }
    if (biome.danger < 0 || biome.danger > 5) error('biome', id, `danger ${biome.danger} out of range`);
  }

  const islands = allIslands();
  for (let i = 0; i < islands.length; i++) {
    const island = islands[i];
    if (island.levelRange[0] >= island.levelRange[1]) {
      error('island', island.id, 'inverted level range');
    }
    if (island.guardian && !tryGetSpecies(island.guardian)) {
      error('island', island.id, `unknown guardian "${island.guardian}"`);
    }
    if (island.features.length === 0) error('island', island.id, 'no terrain features');

    for (const feature of island.features) {
      if (Math.hypot(feature.x, feature.z) > island.radius * 1.2) {
        error('island', island.id, `feature at (${feature.x}, ${feature.z}) lies outside the island`);
      }
      if ((feature.kind === 'ridge' || feature.kind === 'canyon') &&
          (feature.x2 === undefined || feature.z2 === undefined)) {
        error('island', island.id, `${feature.kind} feature needs an end point`);
      }
      if (feature.biome && !BiomeIds.includes(feature.biome)) {
        error('island', island.id, `feature has unknown biome "${feature.biome}"`);
      }
    }

    for (const settlement of island.settlements) {
      if (Math.hypot(settlement.x, settlement.z) > island.radius) {
        error('island', island.id, `settlement "${settlement.id}" lies outside the island`);
      }
      if (settlement.population <= 0) error('island', settlement.id, 'population must be positive');
    }

    for (const poi of island.pois) {
      if (poi.level <= 0) error('island', poi.id, 'POI level must be positive');
      if (poi.description.length < 20) warn('island', poi.id, 'POI description is very short');
    }

    // Overlap is a hard error: the terrain generator assumes at most one
    // island contributes to any point and takes the first hit.
    for (let j = i + 1; j < islands.length; j++) {
      const other = islands[j];
      const distance = Math.hypot(island.centerX - other.centerX, island.centerZ - other.centerZ);
      if (distance <= island.radius + other.radius) {
        error('island', `${island.id}/${other.id}`,
          `landmasses overlap: ${distance.toFixed(0)}m apart, radii sum to ${island.radius + other.radius}m`);
      }
    }
  }

  const orders = islands.map((i) => i.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      error('island', 'progression', `island order must be 1..n with no gaps, got ${orders.join(',')}`);
      break;
    }
  }
}

// ---------------------------------------------------------------- spawning

function validateSpawns(): void {
  const islandIds = new Set(allIslands().map((i) => i.id));
  const aquaticBiomes = new Set(allBiomes().filter((b) => b.aquatic).map((b) => b.id));

  for (const entry of SPAWN_TABLE) {
    const species = tryGetSpecies(entry.species);
    if (!species) {
      error('spawn', entry.species, 'references an unknown species');
      continue;
    }
    if (entry.biomes.length === 0) error('spawn', entry.species, 'lists no biomes');
    for (const biome of entry.biomes) {
      if (!BiomeIds.includes(biome)) error('spawn', entry.species, `unknown biome "${biome}"`);
    }
    for (const island of entry.islands ?? []) {
      if (!islandIds.has(island)) error('spawn', entry.species, `unknown island "${island}"`);
    }

    const [lo, hi] = entry.levelRange;
    if (lo < 1 || hi < lo || hi > 100) error('spawn', entry.species, `bad level range [${lo}, ${hi}]`);
    if (entry.weight <= 0) error('spawn', entry.species, 'weight must be positive');
    if (entry.alphaChance !== undefined && (entry.alphaChance <= 0 || entry.alphaChance > 1)) {
      error('spawn', entry.species, `alpha chance ${entry.alphaChance} out of range`);
    }

    // Placement legality.
    if (species.movement === 'swimmer') {
      for (const biome of entry.biomes) {
        if (!aquaticBiomes.has(biome)) {
          error('spawn', entry.species, `is a swimmer but spawns in non-aquatic biome "${biome}"`);
        }
      }
    }
  }

  /**
   * Biomes that are intentionally empty of unconditional spawns.
   *
   * Declared rather than suppressed silently, so the exemption is a design
   * statement a reviewer can disagree with — not a warning someone learned to
   * scroll past. Anything not on this list that comes up empty is a content
   * hole and should be fixed.
   */
  const INTENTIONALLY_GATED: Readonly<Record<string, string>> = {
    // Every Pokémon at Aether Paradise is in containment or under study.
    // The only wild spawns are Grimer that got into the waste system at night.
    facility: 'Pokémon here are contained, not wild',
    // Ultra Space is entirely gated behind the ultra_access story flag.
    'ultra-space': 'gated behind ultra_access until the story opens it',
  };

  // Coverage: a biome the player can stand in with nothing to find is a hole.
  for (const biome of allBiomes()) {
    if (!biome.walkable) continue;
    if (INTENTIONALLY_GATED[biome.id]) continue;
    const entries = SPAWN_TABLE.filter((e) => e.biomes.includes(biome.id));
    if (entries.length === 0) {
      warn('spawn', biome.id, 'walkable biome has no possible spawns at all');
      continue;
    }
    // Check every three-hour window has something available, so no biome is
    // silently empty at a particular time of day.
    for (const hour of [2, 8, 14, 20]) {
      const available = entries.filter(
        (e) => !e.hours || e.hours.length === 0 || e.hours.includes(hour),
      );
      // Flag only unconditional entries: a weather-gated table is fine to be
      // empty in clear conditions.
      const unconditional = available.filter((e) => !e.weather && !e.requiresFlag);
      if (unconditional.length === 0) {
        warn('spawn', biome.id, `nothing spawns unconditionally at ${hour}:00`);
      }
    }
  }
}

// ---------------------------------------------------------- items & quests

function validateItems(): void {
  const seen = new Set<string>();
  for (const item of allItems()) {
    if (seen.has(item.id)) error('item', item.id, 'duplicate id');
    seen.add(item.id);

    if (item.price < 0 || item.sellPrice < 0) error('item', item.id, 'negative price');
    if (item.stackLimit <= 0) error('item', item.id, 'stack limit must be positive');
    if (item.isKey && item.price !== 0) error('item', item.id, 'key items must not be purchasable');
    if (item.category === 'pokeball' && (item.catchMultiplier ?? 0) <= 0) {
      error('item', item.id, 'Poké Ball needs a catch multiplier');
    }
    if (item.category === 'z-crystal') {
      if (!item.zMove) error('item', item.id, 'Z-Crystal must name a Z-Move');
      else if (!zMoveForCrystal(item.id)) {
        error('item', item.id, `no Z-Move is bound to crystal "${item.id}"`);
      }
    }
    if (item.sellPrice > item.price && item.price > 0) {
      warn('item', item.id, 'sells for more than it costs — infinite money exploit');
    }
  }
}

function validateTrials(): void {
  const islands = new Map(allIslands().map((i) => [i.id, i]));

  for (const trial of allTrials()) {
    const island = islands.get(trial.island);
    if (!island) {
      error('trial', trial.id, `unknown island "${trial.island}"`);
      continue;
    }
    if (!island.pois.some((p) => p.id === trial.poi)) {
      error('trial', trial.id, `POI "${trial.poi}" is not on ${trial.island}`);
    }
    if (!tryGetItem(trial.reward)) {
      error('trial', trial.id, `reward "${trial.reward}" is not a defined item`);
    }
    if (trial.stages.length < 3) warn('trial', trial.id, 'has fewer than three stages');
    if (!trial.stages.some((s) => s.kind === 'boss')) {
      error('trial', trial.id, 'has no Totem boss stage');
    }

    const totem = trial.totem;
    if (!tryGetSpecies(totem.species)) {
      error('trial', trial.id, `unknown Totem species "${totem.species}"`);
    }
    if (totem.scale <= 1) error('trial', trial.id, 'a Totem must be visibly oversized');
    for (const move of totem.moves) {
      if (!tryGetMove(move)) error('trial', trial.id, `Totem has unknown move "${move}"`);
    }
    if (totem.heldItem && !tryGetItem(totem.heldItem)) {
      error('trial', trial.id, `Totem holds unknown item "${totem.heldItem}"`);
    }
    for (const ally of totem.sosAllies) {
      if (!tryGetSpecies(ally.species)) {
        error('trial', trial.id, `unknown SOS ally "${ally.species}"`);
      }
      if (ally.atHpPercent <= 0 || ally.atHpPercent >= 1) {
        error('trial', trial.id, `SOS threshold ${ally.atHpPercent} must be between 0 and 1`);
      }
    }

    if (totem.phases.length < 2) error('trial', trial.id, 'a Totem needs multiple phases');
    if (totem.phases[0]?.atHpPercent !== 1) {
      error('trial', trial.id, 'the first Totem phase must start at full HP');
    }
    for (let i = 1; i < totem.phases.length; i++) {
      if (totem.phases[i].atHpPercent >= totem.phases[i - 1].atHpPercent) {
        error('trial', trial.id, 'Totem phase thresholds must descend');
      }
    }
  }
}

function validateQuests(): void {
  const questIds = new Set(allQuests().map((q) => q.id));
  const factions = new Set<string>(FACTIONS);

  for (const quest of allQuests()) {
    const objectiveIds = new Set(quest.objectives.map((o) => o.id));

    for (const objective of quest.objectives) {
      for (const required of objective.requires ?? []) {
        if (!objectiveIds.has(required)) {
          error('quest', quest.id, `objective "${objective.id}" requires unknown "${required}"`);
        }
        if (required === objective.id) {
          error('quest', quest.id, `objective "${objective.id}" depends on itself`);
        }
      }
      for (const branch of objective.branches ?? []) {
        if (!quest.rewards[branch.leadsTo]) {
          error('quest', quest.id, `branch "${branch.id}" leads to "${branch.leadsTo}" with no reward`);
        }
      }
      if (objective.count !== undefined && objective.count <= 0) {
        error('quest', quest.id, `objective "${objective.id}" has a non-positive count`);
      }
    }

    // Reachability: every objective must be satisfiable from a root.
    const roots = quest.objectives.filter((o) => !o.requires || o.requires.length === 0);
    if (roots.length === 0) error('quest', quest.id, 'has no starting objective');

    const reachable = new Set(roots.map((r) => r.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const objective of quest.objectives) {
        if (reachable.has(objective.id)) continue;
        if ((objective.requires ?? []).every((r) => reachable.has(r))) {
          reachable.add(objective.id);
          changed = true;
        }
      }
    }
    for (const objective of quest.objectives) {
      if (!reachable.has(objective.id)) {
        error('quest', quest.id, `objective "${objective.id}" is unreachable (cycle or orphan)`);
      }
    }

    if (Object.keys(quest.rewards).length === 0) error('quest', quest.id, 'has no rewards');
    for (const [outcome, reward] of Object.entries(quest.rewards)) {
      for (const item of reward.items ?? []) {
        if (!tryGetItem(item.id)) {
          error('quest', quest.id, `reward "${outcome}" grants unknown item "${item.id}"`);
        }
        if (item.count <= 0) error('quest', quest.id, `reward "${outcome}" has a non-positive count`);
      }
      for (const faction of Object.keys(reward.reputation ?? {})) {
        if (!factions.has(faction)) {
          error('quest', quest.id, `reward "${outcome}" references unknown faction "${faction}"`);
        }
      }
      for (const gift of reward.pokemon ?? []) {
        if (!tryGetSpecies(gift.species)) {
          error('quest', quest.id, `reward "${outcome}" gifts unknown species "${gift.species}"`);
        }
      }
    }

    for (const unlocked of quest.unlocks ?? []) {
      if (!questIds.has(unlocked)) {
        error('quest', quest.id, `unlocks unknown quest "${unlocked}"`);
      }
    }
  }

  // Flag reachability: a quest gated behind a flag nothing sets is dead content.
  const producedFlags = new Set<string>();
  for (const quest of allQuests()) {
    for (const reward of Object.values(quest.rewards)) {
      for (const flag of reward.flags ?? []) producedFlags.add(flag);
    }
  }
  for (const quest of allQuests()) {
    for (const flag of quest.requiresFlags ?? []) {
      if (!producedFlags.has(flag)) {
        warn('quest', quest.id, `requires flag "${flag}" that no quest reward sets`);
      }
    }
  }
}

// -------------------------------------------------------------------- main

function main(): void {
  console.log('');
  console.log('  Project Alola — content validation');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log('');

  const start = performance.now();

  validateSpecies();
  validateMoves();
  validateZMoves();
  validateWorld();
  validateSpawns();
  validateItems();
  validateTrials();
  validateQuests();

  const elapsed = performance.now() - start;

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  const counts = {
    species: allSpecies().length,
    moves: allMoves().length,
    zMoves: allZMoves().length,
    biomes: allBiomes().length,
    islands: allIslands().length,
    items: allItems().length,
    trials: allTrials().length,
    quests: allQuests().length,
    spawnEntries: SPAWN_TABLE.length,
  };

  console.log('  Content inventory');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`    ${key.padEnd(14)} ${String(value).padStart(5)}`);
  }
  console.log('');

  if (errors.length > 0) {
    console.log(`  ✗ ${errors.length} ERROR${errors.length === 1 ? '' : 'S'}`);
    for (const p of errors) {
      console.log(`      [${p.area}] ${p.subject}: ${p.message}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    for (const p of warnings.slice(0, 30)) {
      console.log(`      [${p.area}] ${p.subject}: ${p.message}`);
    }
    if (warnings.length > 30) console.log(`      ... and ${warnings.length - 30} more`);
    console.log('');
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('  ✓ All content valid. No errors, no warnings.');
  } else if (errors.length === 0) {
    console.log(`  ✓ No errors. ${warnings.length} warning(s) for review.`);
  }

  console.log(`\n  validated in ${elapsed.toFixed(0)}ms\n`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main();
