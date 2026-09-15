/**
 * Species registry — indexed lookups over the dex.
 *
 * Built once at module load. Every index exists because some hot path needs it:
 * the spawner filters by movement class, the ecosystem needs the reverse
 * predator index, and the Pokédex UI sorts by regional number.
 */
import { SPECIES_LIST } from './dex.ts';
import { makeRuntime, type SpeciesDefinition, type SpeciesRuntime, type MovementClass, type TemperamentClass } from './schema.ts';
import type { PokemonType } from '../types.ts';

const byId = new Map<string, SpeciesRuntime>();
const byDex = new Map<number, SpeciesRuntime>();
const byType = new Map<PokemonType, SpeciesRuntime[]>();
const byMovement = new Map<MovementClass, SpeciesRuntime[]>();
const byTemperament = new Map<TemperamentClass, SpeciesRuntime[]>();
/** speciesId -> ids of species that hunt it. The reverse of `preysOn`. */
const predatorsOf = new Map<string, string[]>();

for (const def of SPECIES_LIST) {
  const runtime = makeRuntime(def);
  if (byId.has(runtime.id)) {
    throw new Error(`Duplicate species id "${runtime.id}" in the dex.`);
  }
  byId.set(runtime.id, runtime);
  // National-dex collisions are expected (regional forms share a number);
  // first registration wins as the canonical entry for that number.
  if (!byDex.has(runtime.dex)) byDex.set(runtime.dex, runtime);

  for (const t of runtime.types) {
    const list = byType.get(t) ?? [];
    list.push(runtime);
    byType.set(t, list);
  }

  const mv = byMovement.get(runtime.movement) ?? [];
  mv.push(runtime);
  byMovement.set(runtime.movement, mv);

  const tp = byTemperament.get(runtime.temperament) ?? [];
  tp.push(runtime);
  byTemperament.set(runtime.temperament, tp);

  for (const prey of runtime.preysOn) {
    const list = predatorsOf.get(prey) ?? [];
    list.push(runtime.id);
    predatorsOf.set(prey, list);
  }
}

export function getSpecies(id: string): SpeciesRuntime {
  const s = byId.get(id);
  if (!s) {
    throw new Error(`Unknown species "${id}". Did you mean one of: ${nearestIds(id).join(', ')}?`);
  }
  return s;
}

export function tryGetSpecies(id: string): SpeciesRuntime | undefined {
  return byId.get(id);
}

export function hasSpecies(id: string): boolean {
  return byId.has(id);
}

export function getSpeciesByDex(dex: number): SpeciesRuntime | undefined {
  return byDex.get(dex);
}

export function allSpecies(): readonly SpeciesRuntime[] {
  return [...byId.values()];
}

export function speciesOfType(type: PokemonType): readonly SpeciesRuntime[] {
  return byType.get(type) ?? [];
}

export function speciesWithMovement(movement: MovementClass): readonly SpeciesRuntime[] {
  return byMovement.get(movement) ?? [];
}

export function speciesWithTemperament(t: TemperamentClass): readonly SpeciesRuntime[] {
  return byTemperament.get(t) ?? [];
}

/** Which species hunt this one? Drives flee-target selection and fear memory. */
export function predatorsFor(speciesId: string): readonly string[] {
  return predatorsOf.get(speciesId) ?? [];
}

/** Species that can be ridden, grouped by the role they fill. */
export function rideSpecies(): readonly SpeciesRuntime[] {
  return allSpecies().filter((s) => s.rideRole !== undefined);
}

/** Is this species awake at the given hour? */
export function isActiveAtHour(species: SpeciesDefinition, hour: number): boolean {
  if (species.activeHours.length === 0) return true;
  return species.activeHours.includes(Math.floor(hour) % 24);
}

/** Levenshtein-lite suggestion for the error message above. */
function nearestIds(query: string, limit = 3): string[] {
  const q = query.toUpperCase();
  return [...byId.keys()]
    .map((id) => ({ id, score: sharedPrefix(id, q) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.id);
}

function sharedPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export const SPECIES_COUNT = byId.size;
