/**
 * Content bake.
 *
 * Converts the authored TypeScript content layer into the compact runtime
 * format the shipping game loads, and produces the derived tables that would
 * otherwise be recomputed at startup.
 *
 * Why bake at all, when the data is already TypeScript? Three reasons:
 *
 * 1. **Load time.** Parsing and validating the authored form costs time on
 *    every boot. The baked form is a flat binary-friendly JSON the client can
 *    consume directly.
 * 2. **Derived tables.** The predator index, biome-to-spawn index, and per-island
 *    region lists are all derivable but expensive. Computing them once at bake
 *    time is free; computing them at boot is not.
 * 3. **Ship what validates.** Baking runs after validation, so a build can
 *    never ship content that failed the checks.
 *
 * Run: npm run bake:content
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allSpecies, allMoves, allZMoves, allBiomes, allIslands, allItems,
  allTrials, allQuests, SPAWN_TABLE, predatorsFor, entriesForBiome, BiomeIds,
} from '@alola/data';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../../content/baked');

interface BakeManifest {
  bakedAt: string;
  contentVersion: number;
  files: { path: string; bytes: number; entries: number }[];
  derived: { name: string; entries: number }[];
  totalBytes: number;
}

async function writeJson(name: string, data: unknown): Promise<{ bytes: number; entries: number }> {
  const path = resolve(OUT_DIR, name);
  const json = JSON.stringify(data);
  await writeFile(path, json, 'utf8');
  const entries = Array.isArray(data)
    ? data.length
    : typeof data === 'object' && data !== null
      ? Object.keys(data).length
      : 0;
  return { bytes: Buffer.byteLength(json), entries };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  console.log('');
  console.log('  Project Alola — content bake');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log('');

  const start = performance.now();
  await mkdir(OUT_DIR, { recursive: true });

  const manifest: BakeManifest = {
    bakedAt: new Date().toISOString(),
    contentVersion: 1,
    files: [],
    derived: [],
    totalBytes: 0,
  };

  const record = async (name: string, data: unknown): Promise<void> => {
    const result = await writeJson(name, data);
    manifest.files.push({ path: name, ...result });
    manifest.totalBytes += result.bytes;
    console.log(
      `    ${name.padEnd(22)} ${String(result.entries).padStart(5)} entries  ${formatBytes(result.bytes).padStart(10)}`,
    );
  };

  console.log('  Primary tables');
  await record('species.json', allSpecies());
  await record('moves.json', allMoves());
  await record('zmoves.json', allZMoves());
  await record('biomes.json', allBiomes());
  await record('islands.json', allIslands());
  await record('items.json', allItems());
  await record('trials.json', allTrials());
  await record('quests.json', allQuests());
  await record('spawns.json', SPAWN_TABLE);

  console.log('');
  console.log('  Derived indices');

  // Predator index: prey species -> the species that hunt it. The ecosystem
  // and the AI's fear system both need this on every spawn.
  const predatorIndex: Record<string, string[]> = {};
  for (const species of allSpecies()) {
    const predators = predatorsFor(species.id);
    if (predators.length > 0) predatorIndex[species.id] = [...predators];
  }
  await record('index-predators.json', predatorIndex);
  manifest.derived.push({ name: 'predators', entries: Object.keys(predatorIndex).length });

  // Biome -> spawn entry index, so the spawner never scans the whole table.
  const biomeSpawnIndex: Record<string, number[]> = {};
  for (const biome of BiomeIds) {
    const indices: number[] = [];
    SPAWN_TABLE.forEach((entry, i) => {
      if (entry.biomes.includes(biome)) indices.push(i);
    });
    if (indices.length > 0) biomeSpawnIndex[biome] = indices;
  }
  await record('index-biome-spawns.json', biomeSpawnIndex);
  manifest.derived.push({ name: 'biome-spawns', entries: Object.keys(biomeSpawnIndex).length });

  // Species -> which biomes it can be found in. Powers the Pokédex habitat page.
  const habitatIndex: Record<string, string[]> = {};
  for (const entry of SPAWN_TABLE) {
    const existing = new Set(habitatIndex[entry.species] ?? []);
    for (const biome of entry.biomes) existing.add(biome);
    habitatIndex[entry.species] = [...existing];
  }
  await record('index-habitats.json', habitatIndex);
  manifest.derived.push({ name: 'habitats', entries: Object.keys(habitatIndex).length });

  // Per-island ecology regions, so the server does not rebuild them at boot.
  const regionIndex: Record<string, string[]> = {};
  for (const island of allIslands()) {
    const regions: string[] = [];
    for (const biome of BiomeIds) {
      if (entriesForBiome(biome).length === 0) continue;
      regions.push(`${island.id}:${biome}`);
    }
    regionIndex[island.id] = regions;
  }
  await record('index-regions.json', regionIndex);
  manifest.derived.push({ name: 'regions', entries: Object.keys(regionIndex).length });

  // Quest dependency graph, flattened for the journal UI.
  const questGraph: Record<string, { unlocks: string[]; requires: string[] }> = {};
  for (const quest of allQuests()) {
    questGraph[quest.id] = {
      unlocks: [...(quest.unlocks ?? [])],
      requires: [...(quest.requiresFlags ?? [])],
    };
  }
  await record('index-quest-graph.json', questGraph);
  manifest.derived.push({ name: 'quest-graph', entries: Object.keys(questGraph).length });

  await writeJson('manifest.json', manifest);

  const elapsed = performance.now() - start;
  console.log('');
  console.log(`  ✓ Baked ${manifest.files.length} files, ${formatBytes(manifest.totalBytes)} total, in ${elapsed.toFixed(0)}ms`);
  console.log(`    → ${OUT_DIR}`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error('Bake failed:', error);
  process.exitCode = 1;
});
