/**
 * Optional GLTF/GLB replacement models for battle Pokémon.
 *
 * `battle-stage.ts` always builds a capsule placeholder first so a battle
 * never waits on a network fetch to start. This loads a real model in the
 * background from `MODEL_BASE_PATH/<speciesId>.glb` and hands it back to be
 * swapped in — or resolves to `null` (a missing file, a bad export) so the
 * capsule just stays.
 *
 * Loaded scenes are cached by species and cloned per battle: geometries and
 * materials stay shared across clones, so `battle-stage.ts` must never
 * dispose them — only the capsule and ring meshes it creates itself own
 * their resources.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Group } from 'three';

export const MODEL_BASE_PATH = '/models/pokemon';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Group | null>>();

function fetchModel(speciesId: string): Promise<Group | null> {
  return loader.loadAsync(`${MODEL_BASE_PATH}/${speciesId}.glb`)
    .then((gltf) => gltf.scene)
    .catch(() => null);
}

export function loadPokemonModel(speciesId: string): Promise<Group | null> {
  let pending = cache.get(speciesId);
  if (!pending) {
    pending = fetchModel(speciesId);
    cache.set(speciesId, pending);
  }
  return pending.then((scene) => (scene ? (scene.clone(true) as Group) : null));
}
