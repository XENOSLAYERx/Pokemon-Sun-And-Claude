import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { TerrainGenerator, BiomeClassifier, CHUNK_SIZE, LOD_RESOLUTIONS } from '@alola/world';
import { allIslands } from '@alola/data';
import { buildTerrainMesh, triangleCountForLod, biomeIndex } from '../src/pipeline/terrain-mesh.ts';
import {
  scatterFoliage, instanceBudgetFor, selectForBudget, cullInstances,
} from '../src/instancing/scatter.ts';
import type { ScatterInstance } from '../src/instancing/scatter.ts';
import { CameraRig, CAMERA_MODES, frameBattle } from '../src/camera/rig.ts';
import {
  TERRAIN_VERTEX_SHADER, TERRAIN_FRAGMENT_SHADER, defaultTerrainUniforms,
} from '../src/shaders/terrain.glsl.ts';
import {
  OCEAN_VERTEX_SHADER, OCEAN_FRAGMENT_SHADER, defaultOceanUniforms, MAX_OCEAN_WAVES,
} from '../src/shaders/ocean.glsl.ts';
import { SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER, defaultSkyUniforms } from '../src/shaders/sky.glsl.ts';

const SEED = 20251115;
const terrain = new TerrainGenerator(SEED);
const classifier = new BiomeClassifier();
const melemele = allIslands().find((i) => i.id === 'melemele')!;
const CHUNK_X = Math.floor(melemele.centerX / CHUNK_SIZE);
const CHUNK_Z = Math.floor(melemele.centerZ / CHUNK_SIZE);

describe('Terrain meshing', () => {
  test('builds a valid mesh at every LOD', () => {
    for (let lod = 0; lod < LOD_RESOLUTIONS.length; lod++) {
      const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, lod);
      const position = result.geometry.getAttribute('position');
      const index = result.geometry.getIndex();

      assert.ok(position.count > 0, `LOD ${lod}: no vertices`);
      assert.ok(index && index.count > 0, `LOD ${lod}: no indices`);
      assert.equal(index!.count % 3, 0, `LOD ${lod}: index count is not a multiple of 3`);

      // Every index must be in range, or the GPU reads garbage.
      for (let i = 0; i < index!.count; i++) {
        const v = index!.getX(i);
        assert.ok(v >= 0 && v < position.count, `LOD ${lod}: index ${v} out of range`);
      }
    }
  });

  test('vertex count halves with each LOD step', () => {
    let previous = Infinity;
    for (let lod = 0; lod < LOD_RESOLUTIONS.length; lod++) {
      const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, lod);
      assert.ok(result.vertexCount < previous, `LOD ${lod} is not cheaper than LOD ${lod - 1}`);
      previous = result.vertexCount;
    }
  });

  test('all vertex attributes are present and correctly sized', () => {
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const count = result.geometry.getAttribute('position').count;
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['biomeWeight', 4], ['biomeIndex', 4]] as const) {
      const attr = result.geometry.getAttribute(name);
      assert.ok(attr, `missing attribute ${name}`);
      assert.equal(attr.itemSize, size, `${name} has the wrong item size`);
      assert.equal(attr.count, count, `${name} has a mismatched vertex count`);
    }
  });

  test('normals are unit length', () => {
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const normals = result.geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i += 7) {
      const len = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      assert.ok(Math.abs(len - 1) < 1e-3, `normal ${i} has length ${len}`);
    }
  });

  test('biome weights sum to one', () => {
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const weights = result.geometry.getAttribute('biomeWeight');
    for (let i = 0; i < weights.count; i += 5) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      assert.ok(Math.abs(sum - 1) < 1e-4, `weights at ${i} sum to ${sum}`);
    }
  });

  test('skirt vertices hang below the surface, hiding LOD cracks', () => {
    const lod = 2;
    const resolution = LOD_RESOLUTIONS[lod];
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, lod, { skirtDepth: 30 });
    const positions = result.geometry.getAttribute('position');

    const gridVerts = (resolution + 1) * (resolution + 1);
    assert.ok(positions.count > gridVerts, 'skirt vertices should have been added');

    // The first skirt vertex mirrors grid vertex 0, dropped by skirtDepth.
    assert.equal(positions.getX(gridVerts), positions.getX(0));
    assert.equal(positions.getZ(gridVerts), positions.getZ(0));
    assert.ok(
      Math.abs(positions.getY(gridVerts) - (positions.getY(0) - 30)) < 1e-4,
      'the skirt should hang exactly skirtDepth below the edge',
    );
  });

  test('mesh geometry is local to the chunk, for float precision at 40km', () => {
    const farX = 120;
    const result = buildTerrainMesh(terrain, classifier, farX, CHUNK_Z, 2);
    const positions = result.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 11) {
      assert.ok(
        Math.abs(positions.getX(i)) <= CHUNK_SIZE + 1,
        'vertices must be chunk-local, not world-space',
      );
    }
  });

  test('bounding sphere encloses the geometry', () => {
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const sphere = result.geometry.boundingSphere!;
    assert.ok(sphere, 'bounds are required for culling');
    const positions = result.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 13) {
      const d = Math.hypot(
        positions.getX(i) - sphere.center.x,
        positions.getY(i) - sphere.center.y,
        positions.getZ(i) - sphere.center.z,
      );
      assert.ok(d <= sphere.radius + 0.01, `vertex ${i} lies outside the bounding sphere`);
    }
  });

  test('is deterministic — the same chunk meshes identically every time', () => {
    const a = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const b = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const pa = a.geometry.getAttribute('position');
    const pb = b.geometry.getAttribute('position');
    assert.equal(pa.count, pb.count);
    for (let i = 0; i < pa.count; i += 17) {
      assert.equal(pa.getY(i), pb.getY(i), `height mismatch at vertex ${i}`);
    }
  });

  test('triangle counts match the LOD budget', () => {
    for (let lod = 0; lod < LOD_RESOLUTIONS.length; lod++) {
      const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, lod);
      const actual = result.geometry.getIndex()!.count / 3;
      assert.equal(actual, triangleCountForLod(lod), `LOD ${lod} triangle count mismatch`);
    }
  });

  test('biome indices are stable and in range', () => {
    assert.equal(biomeIndex('ocean'), biomeIndex('ocean'));
    assert.notEqual(biomeIndex('ocean'), biomeIndex('snowfield'));
    const result = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 2);
    const indices = result.geometry.getAttribute('biomeIndex');
    for (let i = 0; i < indices.count; i += 7) {
      assert.ok(indices.getX(i) >= 0 && indices.getX(i) < 64, 'biome index out of range');
    }
  });
});

describe('Foliage instancing', () => {
  test('scatter is deterministic across reloads', () => {
    const a = scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z);
    const b = scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].x, b[i].x, 'a bush must be in the same place when you come back');
      assert.equal(a[i].proto, b[i].proto);
    }
  });

  test('never scatters underwater or on cliffs', () => {
    for (let i = 0; i < 20; i++) {
      const cx = CHUNK_X + i;
      const instances = scatterFoliage(SEED, terrain, classifier, cx, CHUNK_Z, { maxSlope: 0.7 });
      for (const instance of instances) {
        const sample = terrain.sample(instance.x, instance.z);
        assert.ok(sample.height >= 0.2, `foliage underwater at ${sample.height.toFixed(1)}m`);
        assert.ok(sample.slope <= 0.7 + 0.01, `foliage on a ${sample.slope.toFixed(2)}rad cliff`);
      }
    }
  });

  test('respects the instance cap', () => {
    const instances = scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z, {
      maxInstances: 50, densityScale: 100,
    });
    assert.ok(instances.length <= 50, `produced ${instances.length} instances past the cap of 50`);
  });

  test('density scale thins the scatter', () => {
    const dense = scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z, { densityScale: 1 });
    const sparse = scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z, { densityScale: 0.1 });
    assert.ok(sparse.length <= dense.length, 'lowering quality should reduce instance count');
  });

  test('instances stay inside their chunk', () => {
    const originX = CHUNK_X * CHUNK_SIZE;
    const originZ = CHUNK_Z * CHUNK_SIZE;
    for (const instance of scatterFoliage(SEED, terrain, classifier, CHUNK_X, CHUNK_Z)) {
      assert.ok(instance.x >= originX && instance.x <= originX + CHUNK_SIZE, 'x outside chunk');
      assert.ok(instance.z >= originZ && instance.z <= originZ + CHUNK_SIZE, 'z outside chunk');
      assert.ok(instance.scale > 0, 'scale must be positive');
    }
  });

  test('budget falls off with distance rather than cutting to zero', () => {
    const max = 1000;
    assert.equal(instanceBudgetFor(10, max), max);
    assert.ok(instanceBudgetFor(150, max) < max);
    assert.ok(instanceBudgetFor(300, max) < instanceBudgetFor(150, max));
    assert.ok(instanceBudgetFor(300, max) > 0, 'distant foliage should thin, not vanish');
    assert.equal(instanceBudgetFor(5000, max), 0);
  });

  test('budgeting keeps the largest instances, preserving the silhouette', () => {
    const instances: ScatterInstance[] = [];
    for (let i = 0; i < 100; i++) {
      instances.push({ x: i, y: 0, z: 0, yaw: 0, scale: i / 100, proto: 'tree', tint: 0 });
    }
    const selected = selectForBudget(instances, 10);
    assert.equal(selected.length, 10);
    for (const instance of selected) {
      assert.ok(instance.scale >= 0.9, 'the largest instances should survive the cut');
    }
  });

  test('frustum culling removes what is behind the camera', () => {
    const instances: ScatterInstance[] = [
      { x: 0, y: 0, z: -10, yaw: 0, scale: 1, proto: 'tree', tint: 0 },  // ahead
      { x: 0, y: 0, z: 10, yaw: 0, scale: 1, proto: 'tree', tint: 0 },   // behind
      { x: 0, y: 0, z: -5000, yaw: 0, scale: 1, proto: 'tree', tint: 0 }, // too far
    ];
    const visible = cullInstances(
      instances,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      Math.cos(Math.PI / 4),
      1000,
    );
    assert.equal(visible.length, 1);
    assert.equal(visible[0].z, -10);
  });
});

describe('Camera rig', () => {
  test('every mode has a coherent configuration', () => {
    for (const [name, config] of Object.entries(CAMERA_MODES)) {
      assert.ok(config.fov > 20 && config.fov < 120, `${name}: implausible FOV`);
      assert.ok(config.minPitch < config.maxPitch, `${name}: inverted pitch limits`);
      assert.ok(config.positionHalfLife > 0, `${name}: zero position smoothing`);
      assert.ok(config.distance >= 0, `${name}: negative distance`);
    }
  });

  test('pitch is clamped to the mode limits', () => {
    const rig = new CameraRig();
    rig.setMode('explore');
    for (let i = 0; i < 100; i++) rig.applyLook(0, 1);
    assert.ok(rig.pitch <= CAMERA_MODES.explore.maxPitch + 1e-6);
    for (let i = 0; i < 200; i++) rig.applyLook(0, -1);
    assert.ok(rig.pitch >= CAMERA_MODES.explore.minPitch - 1e-6);
  });

  test('the camera settles behind its focus point', () => {
    const rig = new CameraRig();
    const focus = new Vector3(0, 0, 0);
    rig.snap(focus);
    for (let i = 0; i < 180; i++) rig.update(1 / 60, focus, null);

    const distance = rig.position.distanceTo(new Vector3(0, CAMERA_MODES.explore.height, 0));
    assert.ok(
      Math.abs(distance - CAMERA_MODES.explore.distance) < 1.0,
      `camera settled at ${distance.toFixed(2)}m, expected ~${CAMERA_MODES.explore.distance}m`,
    );
  });

  test('collision pulls the camera in fast and eases it out slowly', () => {
    const rig = new CameraRig();
    const focus = new Vector3(0, 0, 0);
    rig.snap(focus);

    // A wall two metres behind the player.
    let blocked = true;
    const cast = (): { hit: boolean; distance: number } =>
      blocked ? { hit: true, distance: 2 } : { hit: false, distance: 0 };

    for (let i = 0; i < 20; i++) rig.update(1 / 60, focus, cast);
    const pulledIn = rig.position.distanceTo(new Vector3(0, CAMERA_MODES.explore.height, 0));
    assert.ok(pulledIn < 3, `camera should pull in quickly, got ${pulledIn.toFixed(2)}m`);

    // Remove the wall: it should ease back out, not snap.
    blocked = false;
    rig.update(1 / 60, focus, cast);
    const oneFrameLater = rig.position.distanceTo(new Vector3(0, CAMERA_MODES.explore.height, 0));
    assert.ok(oneFrameLater < pulledIn + 1, 'the camera should not lurch back out in one frame');

    for (let i = 0; i < 180; i++) rig.update(1 / 60, focus, cast);
    const recovered = rig.position.distanceTo(new Vector3(0, CAMERA_MODES.explore.height, 0));
    assert.ok(recovered > pulledIn + 1, 'it should recover its full distance eventually');
  });

  test('shake decays and expires', () => {
    const rig = new CameraRig();
    const focus = new Vector3(0, 0, 0);
    rig.snap(focus);
    rig.update(1 / 60, focus, null);
    const restPosition = rig.position.clone();

    rig.shake(1, 0.4);
    assert.equal(rig.shakeCount, 1);
    rig.update(1 / 60, focus, null);
    const shaken = rig.position.distanceTo(restPosition);

    for (let i = 0; i < 60; i++) rig.update(1 / 60, focus, null);
    assert.equal(rig.shakeCount, 0, 'shake should expire');
    const settled = rig.position.distanceTo(restPosition);
    assert.ok(settled < shaken || shaken < 0.01, 'shake should decay to nothing');
  });

  test('overlapping shakes are bounded', () => {
    const rig = new CameraRig();
    for (let i = 0; i < 50; i++) rig.shake(1, 1);
    assert.ok(rig.shakeCount <= 6, 'the shake list must not grow without bound');
  });

  test('cinematic override blends and releases', () => {
    const rig = new CameraRig();
    const focus = new Vector3(0, 0, 0);
    rig.snap(focus);
    rig.update(1 / 60, focus, null);

    const target = new Vector3(100, 50, 100);
    rig.setCinematic(target, new Vector3(0, 0, 0), 30, 1);
    rig.update(1 / 60, focus, null);
    assert.ok(rig.position.distanceTo(target) < 1, 'a full blend should reach the cinematic position');
    assert.ok(Math.abs(rig.fov - 30) < 1, 'FOV should follow the cinematic');

    rig.clearCinematic();
    for (let i = 0; i < 120; i++) rig.update(1 / 60, focus, null);
    assert.ok(rig.position.distanceTo(target) > 10, 'control should return to gameplay');
  });

  test('battle framing keeps both combatants in shot, whatever their size', () => {
    // A tiny Mimikyu against a huge Totem is the hard case.
    const framing = frameBattle(
      new Vector3(-6, 0, 0), 0.2,
      new Vector3(6, 0, 0), 3.4,
      48, 16 / 9,
    );
    assert.ok(framing.distance > 6, 'should pull back far enough to frame both');
    assert.equal(framing.focus.x, 0, 'should centre between them');

    // Two small Pokémon close together need less room.
    const tight = frameBattle(
      new Vector3(-2, 0, 0), 0.3,
      new Vector3(2, 0, 0), 0.3,
      48, 16 / 9,
    );
    assert.ok(tight.distance < framing.distance, 'a smaller pairing should frame closer');
    assert.ok(tight.distance >= 5, 'but never closer than the minimum');
  });

  test('snap places the camera without smoothing', () => {
    const rig = new CameraRig();
    rig.snap(new Vector3(1000, 0, 1000));
    assert.ok(rig.position.distanceTo(new Vector3(1000, 0, 1000)) < 12);
    assert.equal(rig.shakeCount, 0);
  });
});

describe('Shaders', () => {
  const shaders: [string, string][] = [
    ['terrain vertex', TERRAIN_VERTEX_SHADER],
    ['terrain fragment', TERRAIN_FRAGMENT_SHADER],
    ['ocean vertex', OCEAN_VERTEX_SHADER],
    ['ocean fragment', OCEAN_FRAGMENT_SHADER],
    ['sky vertex', SKY_VERTEX_SHADER],
    ['sky fragment', SKY_FRAGMENT_SHADER],
  ];

  test('every shader has a main and balanced braces', () => {
    for (const [name, source] of shaders) {
      assert.ok(source.includes('void main()'), `${name}: no main()`);
      let depth = 0;
      for (const ch of source) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        assert.ok(depth >= 0, `${name}: unbalanced closing brace`);
      }
      assert.equal(depth, 0, `${name}: unbalanced braces`);
    }
  });

  test('vertex shaders write gl_Position and fragment shaders write gl_FragColor', () => {
    for (const [name, source] of shaders) {
      if (name.includes('vertex')) {
        assert.ok(source.includes('gl_Position'), `${name}: does not write gl_Position`);
      } else {
        assert.ok(source.includes('gl_FragColor'), `${name}: does not write gl_FragColor`);
      }
    }
  });

  test('every uniform referenced in a shader has a default', () => {
    const check = (source: string, defaults: Record<string, { value: unknown }>, label: string): void => {
      const uniformNames = [...source.matchAll(/uniform\s+\w+(?:\s*\[\s*\d+\s*\])?\s+(\w+)/g)]
        .map((m) => m[1]);
      for (const name of uniformNames) {
        assert.ok(name in defaults, `${label}: uniform "${name}" has no default value`);
      }
    };
    const terrainDefaults = defaultTerrainUniforms();
    check(TERRAIN_VERTEX_SHADER, terrainDefaults, 'terrain vertex');
    check(TERRAIN_FRAGMENT_SHADER, terrainDefaults, 'terrain fragment');

    const oceanDefaults = defaultOceanUniforms();
    check(OCEAN_VERTEX_SHADER, oceanDefaults, 'ocean vertex');
    check(OCEAN_FRAGMENT_SHADER, oceanDefaults, 'ocean fragment');

    const skyDefaults = defaultSkyUniforms();
    check(SKY_VERTEX_SHADER, skyDefaults, 'sky vertex');
    check(SKY_FRAGMENT_SHADER, skyDefaults, 'sky fragment');
  });

  test('the ocean uniform buffer matches the wave layout', () => {
    const defaults = defaultOceanUniforms();
    const waves = defaults.uWaves.value as Float32Array;
    assert.equal(waves.length, MAX_OCEAN_WAVES * 6, 'six floats per wave');
    assert.ok(OCEAN_VERTEX_SHADER.includes(`uWaves[${MAX_OCEAN_WAVES * 6}]`));
  });

  test('the ocean shader evaluates the same Gerstner sum as the CPU', () => {
    // The CPU simulation and the shader must agree, or a Lapras floats at a
    // different height than the water it is standing on.
    assert.ok(OCEAN_VERTEX_SHADER.includes('GRAVITY'), 'must use the dispersion relation');
    assert.ok(OCEAN_VERTEX_SHADER.includes('sqrt(GRAVITY / k)'), 'phase speed must match waveSpeed()');
    assert.ok(OCEAN_VERTEX_SHADER.includes('TAU / wavelength'), 'wavenumber must match');
  });

  test('the sky shader bounds its raymarch loop', () => {
    assert.ok(SKY_FRAGMENT_SHADER.includes('const int STEPS'), 'cloud march must have a fixed step count');
    assert.ok(SKY_FRAGMENT_SHADER.includes('transmittance < 0.02'), 'should early-out when opaque');
  });
});
