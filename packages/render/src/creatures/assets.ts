/**
 * Creature assets: the species -> model registry, and the geometry cache.
 *
 * `buildCreature(species, detail)` returns merged geometry plus the rig the
 * shader animates. Geometry is built once per species per detail level and
 * shared by every instance of that species on screen.
 */
import type { BufferGeometry } from 'three';
import { tryGetSpecies } from '@alola/data';
import { ModelBuilder, hex, type Detail, type RGB } from './geometry.ts';
import { emptyRig, type RigSpec } from './rig.ts';
import { genericCreature, type CreatureModel } from './kit.ts';
import * as early from './species/early.ts';
import * as route from './species/route.ts';
import * as sea from './species/sea.ts';
import * as legends from './species/legends.ts';

/** Every species with a bespoke model. Anything missing gets the generic one. */
export const CREATURE_MODELS: Readonly<Record<string, CreatureModel>> = {
  ...early,
  ...route,
  ...sea,
  ...legends,
};

const TYPE_TINT: Record<string, number> = {
  normal: 0xb8b08a, fire: 0xee8a3c, water: 0x5a93e0, electric: 0xf2cf3a,
  grass: 0x6fbf55, ice: 0x9ad8d8, fighting: 0xc0443a, poison: 0xa45ab0,
  ground: 0xd9b765, flying: 0xa99af0, psychic: 0xf06a98, bug: 0xa8b83a,
  rock: 0xb8a24a, ghost: 0x6f5a9e, dragon: 0x7050e8, dark: 0x5e4c42,
  steel: 0xb8b8cc, fairy: 0xeea2b8,
};

export interface CreatureAsset {
  readonly geometry: BufferGeometry;
  readonly rig: RigSpec;
  /** Did this come from a bespoke model, or the generic fallback? */
  readonly bespoke: boolean;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

const cache = new Map<string, CreatureAsset>();

export function hasBespokeModel(speciesId: string): boolean {
  return speciesId in CREATURE_MODELS;
}

export function buildCreature(speciesId: string, detail: Detail): CreatureAsset {
  const key = `${speciesId}:${detail}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const builder = new ModelBuilder(detail);
  const rig = emptyRig();
  let model = CREATURE_MODELS[speciesId];
  const bespoke = model !== undefined;
  if (!model) {
    const species = tryGetSpecies(speciesId);
    const primary: RGB = hex(TYPE_TINT[species?.types[0] ?? 'normal'] ?? 0xb8b08a);
    const secondary: RGB = hex(TYPE_TINT[species?.types[1] ?? species?.types[0] ?? 'normal'] ?? 0xb8b08a);
    model = genericCreature(primary, secondary);
  }
  model(builder, rig);
  rig.groundOffset = -builder.bottom;
  // Fliers hover. A third of their own size clears the grass without
  // reading as flying away.
  if (rig.flies && rig.hoverHeight === 0) rig.hoverHeight = 0.3;

  const geometry = builder.build();
  // Seat the model exactly on the ground whatever its lowest part is.
  if (Math.abs(rig.groundOffset) > 1e-4) geometry.translate(0, rig.groundOffset, 0);
  for (const bone of rig.bones) {
    bone.pivot = [bone.pivot[0], bone.pivot[1] + rig.groundOffset, bone.pivot[2]];
  }

  const asset: CreatureAsset = {
    geometry,
    rig,
    bespoke,
    vertexCount: builder.vertexCount,
    triangleCount: (geometry.getIndex()?.count ?? 0) / 3,
  };
  cache.set(key, asset);
  return asset;
}

/** Stride cadence for a species: small creatures step quickly. */
export function strideFor(speciesId: string, rig: RigSpec): number {
  const height = tryGetSpecies(speciesId)?.height ?? 1;
  return rig.strideRate / Math.sqrt(Math.max(0.2, height));
}

