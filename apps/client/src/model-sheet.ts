/**
 * Model sheet: every species, side by side, animated.
 *
 * A development page (served at /models.html) and the fastest way to judge
 * the creature art as a set — proportions, palettes and silhouettes read very
 * differently next to each other than one at a time in the world.
 *
 *   ?species=PIKACHU,ROWLET   only these
 *   ?detail=low               the distant LOD
 *   ?walk=0|1|2               gait (default cycles)
 *   ?outline=0                without ink lines
 *   ?turn=0                   stop the turntable
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, type InstancedBufferAttribute, CircleGeometry, MeshBasicMaterial,
  Color, Vector3, Quaternion, PCFSoftShadowMap,
} from 'three';
import { SPECIES_LIST, getSpecies } from '@alola/data';
import {
  buildCreature, createCreatureMaterials, creatureGlobals, strideFor, instancedCopy, buildPlayerModel,
  type Detail, type RigSpec,
} from '@alola/render';
import { randomAppearance, defaultOutfit, CLOTHING } from '@alola/ui';
import { Rng } from '@alola/core';

const params = new URLSearchParams(location.search);
const detail = (params.get('detail') === 'low' ? 'low' : 'high') as Detail;
const only = params.get('species')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const fixedGait = params.has('walk') ? Number(params.get('walk')) : null;
const showOutline = params.get('outline') !== '0';
const turn = params.get('turn') !== '0';

const species = SPECIES_LIST.filter((s) => !only || only.includes(s.id));

/**
 * `?players=N` shows N randomly rolled characters instead of Pokémon, to
 * check that the creator's range actually reads as different people.
 */
const playerCount = Number(params.get('players') ?? 0);

interface Entry {
  id: string;
  name: string;
  geometry: import('three').BufferGeometry;
  rig: RigSpec;
  stride: number;
  bespoke: boolean;
  triangles: number;
}

function entries(): Entry[] {
  if (playerCount > 0) {
    const out: Entry[] = [];
    for (let i = 0; i < playerCount; i++) {
      const rng = new Rng(9000 + i * 17);
      const r = (): number => rng.next();
      const appearance = randomAppearance(r);
      const outfit = defaultOutfit();
      for (const slot of ['hat', 'eyewear', 'top', 'outerwear', 'bottom', 'socks', 'shoes', 'bag', 'accessory'] as const) {
        const options = CLOTHING.filter((c) => c.slot === slot);
        const choice = options[Math.floor(r() * options.length)];
        (outfit as unknown as Record<string, string | number>)[slot] = choice.id;
        (outfit as unknown as Record<string, string | number>)[`${slot}Color`] = Math.floor(r() * 20);
      }
      const { builder, rig } = buildPlayerModel({ appearance, outfit });
      const geometry = builder.build();
      out.push({ id: `P${i}`, name: `${outfit.top} · ${outfit.hat}`, geometry, rig, stride: rig.strideRate, bespoke: true, triangles: (geometry.getIndex()?.count ?? 0) / 3 });
    }
    return out;
  }
  return species.map((sp) => {
    const asset = buildCreature(sp.id, detail);
    return { id: sp.id, name: sp.name, geometry: asset.geometry, rig: asset.rig, stride: strideFor(sp.id, asset.rig), bespoke: asset.bespoke, triangles: asset.triangleCount };
  });
}

const canvas = document.getElementById('sheet') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = new Color(0x2a3d58);
const hemi = new HemisphereLight(0xcfe3ff, 0x5a5040, 1.1);
scene.add(hemi);
const sun = new DirectionalLight(0xfff1dc, 2.3);
sun.position.set(3, 6, 4);
scene.add(sun);

interface Cell {
  id: string;
  mesh: InstancedMesh;
  outline: InstancedMesh | null;
  anim: InstancedBufferAttribute;
  origin: Vector3;
  size: number;
  stride: number;
  cycle: number;
  label: HTMLDivElement;
}

const cells: Cell[] = [];
const labels = document.getElementById('labels')!;
let triangles = 0;
let generic = 0;

entries().forEach((sp, i) => {
  const materials = createCreatureMaterials(sp.rig);
  const origin = new Vector3(i * 12, sp.rig.flies ? sp.rig.hoverHeight : 0, 0);

  const { geometry, anim } = instancedCopy(sp.geometry, 1);
  anim.setXYZW(0, 0, 0, i * 1.7, 0);
  const make = (material: typeof materials.body | typeof materials.outline): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new Matrix4().compose(origin, new Quaternion(), new Vector3(1, 1, 1)));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };

  // The copy above shares the cached model's buffers but owns its animation
  // attribute — writing aAnim onto the cached geometry would leak into every
  // other user of it. Body and outline share the copy, so they stay in step.
  const mesh = make(materials.body);
  mesh.castShadow = true;
  mesh.customDepthMaterial = materials.depth;
  const outline = showOutline ? make(materials.outline) : null;

  const ground = new Mesh(new CircleGeometry(0.55, 32), new MeshBasicMaterial({ color: 0x1d2b40 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(origin.x, 0.001, origin.z);
  scene.add(ground);

  sp.geometry.computeBoundingBox();
  const box = sp.geometry.boundingBox!;
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);

  const label = document.createElement('div');
  label.className = sp.bespoke ? 'label' : 'label generic';
  label.innerHTML = `${sp.name}<small>${sp.bespoke ? '' : 'generic · '}${sp.triangles.toLocaleString()} tris</small>`;
  labels.appendChild(label);

  triangles += sp.triangles;
  if (!sp.bespoke) generic++;
  cells.push({ id: sp.id, mesh, outline, anim, origin, size, stride: sp.stride, cycle: 0, label });
});

const bar = document.getElementById('bar')!;
bar.innerHTML = `${cells.length} ${playerCount ? 'characters' : 'species'} · ${cells.length - generic} bespoke · ${generic} generic · ` +
  `${detail} detail · ${Math.round(triangles / Math.max(1, cells.length)).toLocaleString()} tris avg` +
  `<a href="?detail=${detail === 'high' ? 'low' : 'high'}">${detail === 'high' ? 'low' : 'high'} LOD</a>` +
  `<a href="?walk=1">walk</a><a href="?walk=0">idle</a><a href="?">cycle</a><a href="?players=12">characters</a>`;

const camera = new PerspectiveCamera(32, 1, 0.05, 100);

function layout(): { cols: number; rows: number; w: number; h: number } {
  const count = cells.length;
  const aspect = window.innerWidth / window.innerHeight;
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect * 0.9)));
  const rows = Math.ceil(count / cols);
  return { cols, rows, w: window.innerWidth / cols, h: window.innerHeight / rows };
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  creatureGlobals.uTime.value = t;

  // Cycle idle -> walk -> run so every animation gets looked at.
  const gait = fixedGait ?? [0, 1, 2][Math.floor(t / 4) % 3];

  const { cols, w, h } = layout();
  cells.forEach((cell, i) => {
    cell.cycle += dt * cell.stride * Math.PI * 2 * (gait === 0 ? 0 : gait === 1 ? 1 : 1.7);
    cell.anim.setXYZW(0, cell.cycle, gait, i * 1.7, 0);
    cell.anim.needsUpdate = true;

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * w;
    const y = window.innerHeight - (row + 1) * h;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);

    const angle = turn ? t * 0.5 + i : 0.6;
    const distance = cell.size * 2.6 + 0.4;
    camera.aspect = w / h;
    camera.position.set(
      cell.origin.x + Math.sin(angle) * distance,
      cell.size * 0.75,
      cell.origin.z + Math.cos(angle) * distance,
    );
    camera.lookAt(cell.origin.x, cell.origin.y + cell.size * 0.42, cell.origin.z);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    cell.label.style.left = `${x}px`;
    cell.label.style.top = `${window.innerHeight - y - 30}px`;
    cell.label.style.width = `${w}px`;
  });
}
requestAnimationFrame(frame);

Object.assign(window as unknown as Record<string, unknown>, { sheet: { cells, getSpecies } });
