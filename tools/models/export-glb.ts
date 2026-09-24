/**
 * Export built-in models as glTF binaries (.glb).
 *
 *   npm run models:export -- PIKACHU [LAPRAS ...]
 *   npm run models:export -- --all
 *   npm run models:export -- --player
 *   npm run models:export -- PIKACHU --out some/folder
 *
 * The point is a round trip: export a model, open it in Blender, change what
 * you like, and drop it into apps/client/public/models/ to replace the
 * built-in one (see the README there).
 *
 * Each model is split into one part per bone — body, head, each leg, tail,
 * wings — with the part's origin at the point it rotates about. In Blender
 * that means the head turns at the neck and a leg swings at the hip without
 * any setup. Vertex colours carry the palette.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SPECIES_LIST, tryGetSpecies } from '../../packages/data/src/index.ts';
import {
  buildCreature, buildPlayerModel, BONE_COUNT, type RigSpec,
} from '../../packages/render/src/creatures/index.ts';
import { defaultAppearance, defaultOutfit } from '../../packages/ui/src/index.ts';

// GLTFExporter reads its own Blobs back through FileReader, which Node lacks.
// This is the whole of what it uses.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader ??= NodeFileReader;

const BONE_NAMES = [
  'body', 'head', 'leg_front_left', 'leg_front_right', 'leg_back_left', 'leg_back_right',
  'tail', 'wing_left', 'wing_right', 'arm_left', 'arm_right', 'ears',
];

/** Split a merged model into one mesh per bone, each pivoted at its joint. */
function splitByBone(source: BufferGeometry, rig: RigSpec, name: string, height: number): Group {
  const position = source.getAttribute('position').array;
  const normal = source.getAttribute('normal').array;
  const color = source.getAttribute('color').array;
  const bone = source.getAttribute('aBone').array;
  const index = source.getIndex()!.array;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, name: `${name}_material` });

  const root = new Group();
  root.name = name;
  for (let b = 0; b < BONE_COUNT; b++) {
    const remap = new Map<number, number>();
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    // Ears are parented to the head in the shader; exported as their own part.
    const pivot = b === 0 ? [0, 0, 0] : rig.bones[b].pivot;
    for (let t = 0; t < index.length; t += 3) {
      if (bone[index[t]] !== b) continue;
      for (let k = 0; k < 3; k++) {
        const v = index[t + k];
        let mapped = remap.get(v);
        if (mapped === undefined) {
          mapped = pos.length / 3;
          remap.set(v, mapped);
          pos.push(position[v * 3] - pivot[0], position[v * 3 + 1] - pivot[1], position[v * 3 + 2] - pivot[2]);
          nrm.push(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
          col.push(color[v * 3], color[v * 3 + 1], color[v * 3 + 2]);
        }
        idx.push(mapped);
      }
    }
    if (idx.length === 0) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geometry.setIndex(idx);
    const mesh = new Mesh(geometry, material);
    mesh.name = BONE_NAMES[b];
    mesh.position.set(pivot[0], pivot[1], pivot[2]);
    root.add(mesh);
  }
  // Real-world size, so the file opens at a sensible scale. The game rescales
  // on load either way.
  root.scale.setScalar(height);
  return root;
}

function exportGlb(object: Group): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(object, (result) => resolve(result as ArrayBuffer), reject, { binary: true });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : join('exports', 'models');
  const wanted = args.filter((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));

  const jobs: { file: string; object: Group }[] = [];
  if (args.includes('--player')) {
    const look = { appearance: defaultAppearance(), outfit: defaultOutfit() };
    const { builder, rig } = buildPlayerModel(look);
    jobs.push({ file: 'player.glb', object: splitByBone(builder.build(), rig, 'player', 1.65) });
  }
  const ids = args.includes('--all') ? SPECIES_LIST.map((s) => s.id) : wanted.map((w) => w.toUpperCase());
  for (const id of ids) {
    const species = tryGetSpecies(id);
    if (!species) {
      console.error(`  ✗ unknown species "${id}" — ids are like PIKACHU, ROWLET, RATTATA_ALOLA`);
      process.exitCode = 1;
      continue;
    }
    const asset = buildCreature(id, 'high');
    jobs.push({ file: `${id.toLowerCase()}.glb`, object: splitByBone(asset.geometry, asset.rig, id.toLowerCase(), species.height) });
  }

  if (jobs.length === 0) {
    console.log('usage: npm run models:export -- PIKACHU [ROWLET ...] | --all | --player [--out folder]');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  for (const job of jobs) {
    const buffer = await exportGlb(job.object);
    const path = join(outDir, job.file);
    writeFileSync(path, Buffer.from(buffer));
    console.log(`  ✓ ${path}  (${(buffer.byteLength / 1024).toFixed(0)} KB, ${job.object.children.length} parts)`);
  }
}

await main();
