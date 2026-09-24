/**
 * Terrain meshing worker.
 *
 * Samples the terrain for every vertex of a chunk — the expensive part of
 * streaming — off the main thread. It builds its own generator from the world
 * seed: terrain is a pure function of (seed, x, z), so this instance produces
 * exactly what the main thread would have, which a test pins.
 *
 * Imports the Three-free half of the mesher directly, so this bundle does not
 * carry Three.js.
 */
import { TerrainGenerator, BiomeClassifier } from '@alola/world';
import { buildTerrainArrays, transferablesOf } from '@alola/render/pipeline/terrain-arrays.ts';

export type TerrainWorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'build'; id: number; key: number; cx: number; cz: number; lod: number };

export type TerrainWorkerResponse =
  | { type: 'built'; id: number; key: number; lod: number; ms: number; arrays: ReturnType<typeof buildTerrainArrays> }
  | { type: 'error'; id: number; message: string };

// The DOM lib types `self` as a Window; only the two members used are declared.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
  postMessage(message: TerrainWorkerResponse, transfer?: Transferable[]): void;
};

let terrain: TerrainGenerator | null = null;
let classifier: BiomeClassifier | null = null;

scope.onmessage = (event) => {
  const message = event.data;

  if (message.type === 'init') {
    terrain = new TerrainGenerator(message.seed);
    classifier = new BiomeClassifier();
    return;
  }

  if (!terrain || !classifier) {
    scope.postMessage({ type: 'error', id: message.id, message: 'worker used before init' });
    return;
  }

  try {
    const t0 = performance.now();
    const arrays = buildTerrainArrays(terrain, classifier, message.cx, message.cz, message.lod);
    const ms = performance.now() - t0;
    // Transfer, not copy: a LOD0 chunk is ~1.5 MB of vertex data.
    scope.postMessage({ type: 'built', id: message.id, key: message.key, lod: message.lod, ms, arrays }, transferablesOf(arrays));
  } catch (error) {
    scope.postMessage({ type: 'error', id: message.id, message: String(error) });
  }
};
