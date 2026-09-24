import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { TerrainGenerator, BiomeClassifier, CHUNK_SIZE, LOD_RESOLUTIONS } from '@alola/world';
import { allIslands } from '@alola/data';
import { buildTerrainMesh, triangleCountForLod, biomeIndex, geometryFromArrays } from '../src/pipeline/terrain-mesh.ts';
import { buildTerrainArrays, transferablesOf } from '../src/pipeline/terrain-arrays.ts';
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
import { SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER, defaultSkyUniforms, lightStepsFor } from '../src/shaders/sky.glsl.ts';
import {
  QUALITY_PRESETS, QUALITY_ORDER, AdaptiveQuality, detectQuality, isSoftwareRenderer,
} from '../src/pipeline/quality.ts';

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
    assert.ok(SKY_FRAGMENT_SHADER.includes('const int MAX_CLOUD_STEPS'), 'the march needs a compile-time ceiling');
    assert.ok(SKY_FRAGMENT_SHADER.includes('i >= uCloudSteps'), 'and must stop at the preset budget');
    assert.ok(SKY_FRAGMENT_SHADER.includes('transmittance < 0.02'), 'should early-out when opaque');
  });

  test('the cloud budget comes from the preset, not a constant', () => {
    // It used to be `const int STEPS = 24` while the preset's cloudSteps went
    // into a uniform nothing read — every preset paid for 24 steps.
    assert.ok(SKY_FRAGMENT_SHADER.includes('uniform int uCloudSteps'));
    assert.ok(!/const int STEPS\s*=/.test(SKY_FRAGMENT_SHADER), 'no hardcoded step count may remain');
    const potato = QUALITY_PRESETS.potato.cloudSteps;
    assert.equal(potato, 0);
    assert.ok(SKY_FRAGMENT_SHADER.includes('uCloudSteps > 0'), 'a zero budget must skip the march entirely');
  });

  test('light samples scale down with the cloud budget', () => {
    assert.equal(lightStepsFor(0), 0);
    assert.equal(lightStepsFor(8), 1);
    assert.equal(lightStepsFor(16), 2);
    assert.equal(lightStepsFor(40), 3);
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      assert.ok(
        lightStepsFor(QUALITY_PRESETS[QUALITY_ORDER[i]].cloudSteps) >= lightStepsFor(QUALITY_PRESETS[QUALITY_ORDER[i - 1]].cloudSteps),
      );
    }
  });
});

// ---------------------------------------------------------------- quality

describe('Graphics quality presets', () => {
  test('every level in the order has a preset that names itself', () => {
    assert.equal(QUALITY_ORDER.length, 5);
    for (const level of QUALITY_ORDER) {
      const preset = QUALITY_PRESETS[level];
      assert.ok(preset, `missing preset for ${level}`);
      assert.equal(preset.name, level, 'a preset must know its own level');
      assert.ok(preset.label.length > 0);
    }
  });

  test('cost rises monotonically across the order', () => {
    // If a "higher" preset is cheaper in any dimension, stepping down under
    // load can make the game slower, which is the opposite of the point.
    const rising = [
      'pixelRatio', 'renderScale', 'shadowMapSize', 'drawDistanceScale',
      'chunkBuildsPerFrame', 'foliageDensity', 'maxVisiblePokemon',
      'cloudSteps', 'oceanTessellation', 'oceanWaves',
    ] as const;

    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      const lower = QUALITY_PRESETS[QUALITY_ORDER[i - 1]];
      const higher = QUALITY_PRESETS[QUALITY_ORDER[i]];
      for (const key of rising) {
        assert.ok(
          higher[key] >= lower[key],
          `${QUALITY_ORDER[i]}.${key} (${higher[key]}) must not be below ${QUALITY_ORDER[i - 1]}.${key} (${lower[key]})`,
        );
      }
    }
  });

  test('every preset keeps a playable world, whatever it drops', () => {
    for (const level of QUALITY_ORDER) {
      const p = QUALITY_PRESETS[level];
      assert.ok(p.renderScale > 0 && p.renderScale <= 1);
      assert.ok(p.chunkBuildsPerFrame >= 1, 'a preset that builds no chunks never loads the world');
      assert.ok(p.drawDistanceScale > 0);
      // Simulation is ~0.33us per agent — cutting Pokémon below this buys
      // nothing and costs the thing the world is for.
      assert.ok(p.maxVisiblePokemon >= 40, `${level} renders too few Pokémon to feel alive`);
      assert.ok(p.oceanWaves >= 3, 'fewer than three Gerstner waves stops reading as ocean');
    }
  });

  test('software renderers are recognised, hardware ones are not', () => {
    for (const s of [
      'Google SwiftShader',
      'Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)',
      'softpipe',
      'Microsoft Basic Render Driver',
    ]) {
      assert.ok(isSoftwareRenderer(s), `${s} should be detected as software`);
    }
    for (const s of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)',
      'Apple M2 Pro',
      'AMD Radeon RX 6700 XT',
    ]) {
      assert.ok(!isSoftwareRenderer(s), `${s} should be treated as hardware`);
    }
  });

  test('detection falls back to potato without a GPU, and finds the Deck', () => {
    assert.equal(detectQuality({ rendererString: 'Google SwiftShader' }), 'potato');
    assert.equal(
      detectQuality({ rendererString: 'AMD Custom GPU 0405', hardwareConcurrency: 8, deviceMemoryGb: 16, screenWidth: 1280 }),
      'medium',
      'the Steam Deck reports 8 cores and a 1280-wide screen',
    );
    assert.equal(
      detectQuality({ rendererString: 'NVIDIA GeForce RTX 4090', hardwareConcurrency: 16, deviceMemoryGb: 32, screenWidth: 3840 }),
      'high',
      'ultra is opt-in: CPU cores and screen width say nothing about the GPU',
    );
    assert.equal(
      detectQuality({ rendererString: 'Intel(R) Iris(R) Xe Graphics', hardwareConcurrency: 16, deviceMemoryGb: 16, screenWidth: 2560 }),
      'high',
      'the case the cap exists for: many cores, big screen, integrated GPU',
    );
    assert.equal(
      detectQuality({ rendererString: 'Mali-G57', hardwareConcurrency: 2, deviceMemoryGb: 3, screenWidth: 1080 }),
      'low',
    );
  });

  test('adaptive quality drops fast and recovers slowly', () => {
    const changes: string[] = [];
    const adaptive = new AdaptiveQuality('high', 60);
    adaptive.onChange = (p) => changes.push(p.name);

    // A steady 20fps: below target, but it must take about a second to react.
    for (let i = 0; i < 60; i++) adaptive.update(50);
    assert.equal(adaptive.current, 'high', 'must not drop on a brief hitch');
    adaptive.update(50);
    assert.equal(adaptive.current, 'medium');

    // Comfortable headroom takes much longer to earn a step back up.
    for (let i = 0; i < 300; i++) adaptive.update(6);
    assert.equal(adaptive.current, 'medium', 'must not raise on a short quiet stretch');
    adaptive.update(6);
    assert.equal(adaptive.current, 'high');

    assert.deepEqual(changes, ['medium', 'high']);
  });

  test('a frame near target neither raises nor lowers', () => {
    const adaptive = new AdaptiveQuality('medium', 60);
    for (let i = 0; i < 1000; i++) adaptive.update(17);
    assert.equal(adaptive.current, 'medium');
  });

  test('the order has ends, and adaptation stops at them', () => {
    const lowest = new AdaptiveQuality('potato', 60);
    for (let i = 0; i < 500; i++) lowest.update(500);
    assert.equal(lowest.current, 'potato');

    const highest = new AdaptiveQuality('ultra', 60);
    for (let i = 0; i < 2000; i++) highest.update(1);
    assert.equal(highest.current, 'ultra');
  });

  test('an explicit player choice stops adaptation', () => {
    const adaptive = new AdaptiveQuality('high', 60);
    adaptive.lock('low');
    assert.equal(adaptive.current, 'low');
    for (let i = 0; i < 2000; i++) adaptive.update(1);
    assert.equal(adaptive.current, 'low', 'a settings screen must not override the player');

    adaptive.unlock();
    for (let i = 0; i < 301; i++) adaptive.update(6);
    assert.equal(adaptive.current, 'medium', 'adaptation resumes once unlocked');
  });
});

// ------------------------------------------------------- worker meshing path

describe('Worker meshing path', () => {
  test('a separate generator instance produces byte-identical arrays', () => {
    // The worker builds its own TerrainGenerator from the seed. That is only
    // safe because terrain is a pure function of (seed, x, z) — this pins it.
    const workerTerrain = new TerrainGenerator(SEED);
    const workerClassifier = new BiomeClassifier();
    for (const lod of [0, 2]) {
      const a = buildTerrainArrays(terrain, classifier, CHUNK_X, CHUNK_Z, lod);
      const b = buildTerrainArrays(workerTerrain, workerClassifier, CHUNK_X, CHUNK_Z, lod);
      assert.deepEqual(a.positions, b.positions);
      assert.deepEqual(a.normals, b.normals);
      assert.deepEqual(a.biomeIndices, b.biomeIndices);
      assert.deepEqual(a.indices, b.indices);
    }
  });

  test('geometry from arrays matches the synchronous build', () => {
    const sync = buildTerrainMesh(terrain, classifier, CHUNK_X, CHUNK_Z, 1);
    const viaArrays = geometryFromArrays(buildTerrainArrays(terrain, classifier, CHUNK_X, CHUNK_Z, 1));
    assert.deepEqual(
      viaArrays.geometry.getAttribute('position').array,
      sync.geometry.getAttribute('position').array,
    );
    assert.equal(viaArrays.vertexCount, sync.vertexCount);
    assert.equal(viaArrays.geometry.boundingSphere?.radius, sync.geometry.boundingSphere?.radius);
  });

  test('wrapping worker arrays in a geometry does not copy them', () => {
    const arrays = buildTerrainArrays(terrain, classifier, CHUNK_X, CHUNK_Z, 2);
    const { geometry } = geometryFromArrays(arrays);
    assert.equal(geometry.getAttribute('position').array, arrays.positions,
      'the attribute must adopt the transferred array, not duplicate it');
    assert.equal(geometry.getAttribute('color').array, arrays.colors);
    assert.equal(geometry.getIndex()?.array, arrays.indices);
  });

  test('every buffer is listed as transferable, and none is shared', () => {
    const arrays = buildTerrainArrays(terrain, classifier, CHUNK_X, CHUNK_Z, 3);
    const buffers = transferablesOf(arrays);
    assert.equal(buffers.length, 7);
    assert.equal(new Set(buffers).size, 7, 'transferring the same buffer twice throws in postMessage');
  });

  test('the first biome listed really is the dominant one', () => {
    const arrays = buildTerrainArrays(terrain, classifier, CHUNK_X, CHUNK_Z, 2);
    const counts = new Map<number, number>();
    const gridVerts = (LOD_RESOLUTIONS[2] + 1) ** 2;
    for (let v = 0; v < gridVerts; v++) {
      const id = arrays.biomeIndices[v * 4];
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(biomeIndex(arrays.biomes[0]), dominant,
      'the chunk material is chosen from biomes[0], so it must be the majority biome');
  });
});

// ------------------------------------------------------------------ creatures

import { SPECIES_LIST as ALL_SPECIES } from '@alola/data';
import {
  buildCreature, hasBespokeModel, CREATURE_MODELS, strideFor,
  ModelBuilder, hex, emptyRig, packRig, BONE_COUNT, Bone, Motion,
} from '../src/creatures/index.ts';

describe('Creature models', () => {
  test('every species in the dex has a bespoke model', () => {
    const missing = ALL_SPECIES.filter((s) => !hasBespokeModel(s.id)).map((s) => s.id);
    assert.deepEqual(missing, [], 'a species without a model falls back to a generic blob');
    for (const id of Object.keys(CREATURE_MODELS)) {
      assert.ok(ALL_SPECIES.some((s) => s.id === id), `model for ${id} matches no species`);
    }
  });

  test('every model builds at both detail levels with valid bones', () => {
    for (const species of ALL_SPECIES) {
      for (const detail of ['high', 'low'] as const) {
        const asset = buildCreature(species.id, detail);
        const bones = asset.geometry.getAttribute('aBone').array;
        assert.ok(asset.vertexCount > 0, `${species.id} ${detail} is empty`);
        for (let i = 0; i < bones.length; i++) {
          assert.ok(bones[i] >= 0 && bones[i] < BONE_COUNT, `${species.id} uses bone ${bones[i]}`);
        }
      }
    }
  });

  test('the far LOD is always cheaper, and both stay inside a crowd budget', () => {
    for (const species of ALL_SPECIES) {
      const high = buildCreature(species.id, 'high').triangleCount;
      const low = buildCreature(species.id, 'low').triangleCount;
      assert.ok(low < high, `${species.id}: low ${low} is not below high ${high}`);
      // A hillside of twenty is drawn twice (body + outline): the budget is
      // what keeps that affordable on integrated graphics.
      assert.ok(high <= 4500, `${species.id} high LOD is ${high} triangles`);
      assert.ok(low <= 1200, `${species.id} low LOD is ${low} triangles`);
    }
  });

  test('parts are wound outward, so the outline hull sits behind them', () => {
    // Regression: the first version wound every ellipsoid and limb inside
    // out. The body drew its interior and the back-face outline covered the
    // whole creature in black.
    const b = new ModelBuilder('high');
    b.ellipsoid([0, 1, 0], [0.4, 0.3, 0.5], hex(0xffffff), Bone.Root, [0.3, 0.2, 0.1]);
    b.limb([0, 0, 0], [0.2, 0.8, 0.3], 0.1, 0.05, hex(0xffffff), Bone.Root, { flatten: 0.5, roll: 0.4 });
    b.shape([[0, 0], [0.3, 0.1], [0.1, 0.4]], 0.05, { at: [0, 0, 0], rotation: [0.2, 0.5, 0] }, hex(0xffffff), Bone.Root);
    const g = b.build();
    const pos = g.getAttribute('position').array;
    const nrm = g.getAttribute('normal').array;
    const idx = g.getIndex()!.array;
    let wrong = 0;
    let total = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, c, d] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const e1 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const e2 = [pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]];
      const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(face[0], face[1], face[2]);
      if (area < 1e-9) continue; // pole triangles collapse to a point
      const vn = [nrm[a] + nrm[c] + nrm[d], nrm[a + 1] + nrm[c + 1] + nrm[d + 1], nrm[a + 2] + nrm[c + 2] + nrm[d + 2]];
      total++;
      if (face[0] * vn[0] + face[1] * vn[1] + face[2] * vn[2] <= 0) wrong++;
    }
    assert.ok(total > 100);
    assert.equal(wrong, 0, `${wrong} of ${total} triangles face inward`);
  });

  test('normals are unit length', () => {
    const asset = buildCreature('PIKACHU', 'high');
    const n = asset.geometry.getAttribute('normal').array;
    for (let i = 0; i < n.length; i += 3) {
      assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-4);
    }
  });

  test('every model stands on the ground', () => {
    for (const species of ALL_SPECIES) {
      const box = buildCreature(species.id, 'high').geometry.boundingBox!;
      assert.ok(Math.abs(box.min.y) < 1e-3, `${species.id} lowest point is at ${box.min.y}`);
    }
  });

  test('bone pivots follow the model when it is seated on the ground', () => {
    // Grounding translates the geometry; a pivot left behind would make
    // every leg rotate about a point in mid-air.
    for (const species of ALL_SPECIES) {
      const asset = buildCreature(species.id, 'high');
      const box = asset.geometry.boundingBox!;
      for (const bone of asset.rig.bones) {
        if (bone.motion === Motion.None) continue;
        assert.ok(bone.pivot[1] >= box.min.y - 0.05 && bone.pivot[1] <= box.max.y + 0.05,
          `${species.id} has a pivot at y=${bone.pivot[1]} outside [${box.min.y}, ${box.max.y}]`);
      }
    }
  });

  test('building is deterministic', () => {
    const run = (): Float32Array => {
      const b = new ModelBuilder('high');
      const rig = emptyRig();
      CREATURE_MODELS.LAPRAS(b, rig);
      return b.build().getAttribute('position').array as Float32Array;
    };
    assert.deepEqual(run(), run());
  });

  test('the rig packs into the shader layout', () => {
    const packed = packRig(buildCreature('CHARIZARD', 'high').rig);
    assert.equal(packed.pivots.length, BONE_COUNT * 3);
    assert.equal(packed.params.length, BONE_COUNT * 4);
    for (let i = 0; i < BONE_COUNT; i++) {
      const len = Math.hypot(packed.axes[i * 3], packed.axes[i * 3 + 1], packed.axes[i * 3 + 2]);
      assert.ok(Math.abs(len - 1) < 1e-5, 'axes must be normalised on upload');
    }
  });

  test('fliers hover and walkers do not', () => {
    assert.ok(buildCreature('LUNALA', 'high').rig.hoverHeight > 0);
    assert.ok(buildCreature('WINGULL', 'high').rig.hoverHeight > 0);
    assert.equal(buildCreature('BEWEAR', 'high').rig.hoverHeight, 0);
  });

  test('small creatures step faster than large ones', () => {
    const pikachu = strideFor('PIKACHU', buildCreature('PIKACHU', 'high').rig);
    const mudsdale = strideFor('MUDSDALE', buildCreature('MUDSDALE', 'high').rig);
    assert.ok(pikachu > mudsdale * 1.5);
  });

  test('palette colours are converted to linear', () => {
    assert.deepEqual(hex(0xffffff), [1, 1, 1]);
    assert.deepEqual(hex(0x000000), [0, 0, 0]);
    // sRGB mid-grey is ~0.216 linear. Skipping the conversion washes every
    // creature out toward pastel.
    assert.ok(Math.abs(hex(0x808080)[0] - 0.2158) < 0.001);
  });
});

// ---------------------------------------------------------------- crowd

import { Scene, PerspectiveCamera, Vector3 as V3c, Matrix4 as M4c, InstancedMesh as IMc } from 'three';
import { CreatureCrowd, instancedCopy, type CrowdMember } from '../src/creatures/index.ts';

describe('Creature crowd', () => {
  const makeCamera = (): PerspectiveCamera => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.3, 5000);
    camera.position.set(0, 3, 0);
    camera.lookAt(0, 3, -10); // facing -Z
    camera.updateMatrixWorld();
    return camera;
  };

  type Spec = { id: number; species: string; x: number; z: number; speed?: number };
  const reader = (list: Spec[]) => (i: number, out: CrowdMember): boolean => {
    const s = list[i];
    out.id = s.id; out.speciesId = s.species; out.x = s.x; out.y = 0; out.z = s.z;
    out.yaw = 0; out.scale = 1; out.speed = s.speed ?? 0; out.elevated = false;
    return true;
  };

  test('one draw per species per detail level, however many are on screen', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false });
    const list: Spec[] = Array.from({ length: 30 }, (_, i) => ({ id: i, species: 'PIKIPEK', x: (i % 6) - 3, z: -10 - i }));
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.drawn, 30);
    assert.ok(crowd.stats.drawCalls <= 2, `${crowd.stats.drawCalls} draws for one species`);
  });

  test('near creatures get the detailed mesh, far ones the cheap one', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false, nearDistance: 40 });
    const list: Spec[] = [
      { id: 1, species: 'ROWLET', x: 0, z: -10 },
      { id: 2, species: 'ROWLET', x: 0, z: -200 },
    ];
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.near, 1);
    assert.equal(crowd.stats.far, 1);
  });

  test('what is behind the camera is not drawn', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false });
    const list: Spec[] = [
      { id: 1, species: 'LITTEN', x: 0, z: -20 },
      { id: 2, species: 'LITTEN', x: 0, z: 40 },
    ];
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.drawn, 1);
    assert.equal(crowd.stats.culled, 1);
  });

  test('the visible cap keeps the nearest', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false, maxVisible: 5, nearDistance: 1000 });
    const list: Spec[] = Array.from({ length: 20 }, (_, i) => ({ id: i, species: 'YUNGOOS', x: 0, z: -5 - i * 10 }));
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.drawn, 5);
  });

  test('the Pokemon being battled is hidden from the crowd', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false });
    const list: Spec[] = [{ id: 7, species: 'GRUBBIN', x: 0, z: -10 }, { id: 8, species: 'GRUBBIN', x: 1, z: -10 }];
    crowd.hidden.add(7);
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.drawn, 1);
  });

  test('batches grow past their initial capacity', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false, maxVisible: 500, nearDistance: 5000 });
    const list: Spec[] = Array.from({ length: 100 }, (_, i) => ({ id: i, species: 'WINGULL', x: (i % 10) - 5, z: -10 - i }));
    crowd.update(list.length, reader(list), makeCamera(), 1 / 60);
    assert.equal(crowd.stats.drawn, 100);
  });

  test('a creature faces the way the simulation says it is heading', () => {
    // The sim's yaw 0 faces -Z; the models face +Z. The capsules this replaced
    // were symmetric, so nothing ever checked.
    const scene = new Scene();
    const crowd = new CreatureCrowd(scene, { outlines: false });
    const list: Spec[] = [{ id: 1, species: 'PIKACHU', x: 0, z: -10 }];
    crowd.update(1, reader(list), makeCamera(), 1 / 60);
    const mesh = scene.children.find((c) => c instanceof IMc && c.count > 0) as IMc;
    const m = new M4c();
    mesh.getMatrixAt(0, m);
    const forward = new V3c(0, 0, 1).transformDirection(m);
    assert.ok(forward.z < -0.99, `model forward is ${forward.toArray()}, expected -Z`);
  });

  test('instanced copies share geometry buffers but not animation', () => {
    const source = buildCreature('POPPLIO', 'high').geometry;
    const a = instancedCopy(source, 4);
    const b = instancedCopy(source, 4);
    assert.equal(a.geometry.getAttribute('position'), source.getAttribute('position'), 'positions upload once');
    assert.notEqual(a.anim, b.anim, 'each user owns its own animation buffer');
    assert.equal(source.getAttribute('aAnim'), undefined, 'the cached model is never written to');
  });

  test('a walking creature advances its cycle; a standing one does not', () => {
    const crowd = new CreatureCrowd(new Scene(), { outlines: false });
    const moving: Spec[] = [{ id: 1, species: 'GROWLITHE', x: 0, z: -10, speed: 4 }];
    const still: Spec[] = [{ id: 2, species: 'GROWLITHE', x: 1, z: -10, speed: 0 }];
    const camera = makeCamera();
    for (let f = 0; f < 60; f++) {
      crowd.update(1, reader(moving), camera, 1 / 60);
      crowd.update(1, reader(still), camera, 1 / 60);
    }
    const anim = (crowd as unknown as { anim: Map<number, { cycle: number; gait: number }> }).anim;
    assert.ok(anim.get(1)!.gait > 0.5, 'a moving creature should be walking');
    assert.ok(anim.get(2)!.gait < 0.05, 'a still one should be at rest');
  });
});


// ---------------------------------------------------------------- player

import { buildPlayerModel, humanoidHeight, SKIN_TONES, HAIR_COLORS, type HumanoidLook } from '../src/creatures/index.ts';
import { CLOTHING, defaultAppearance, defaultOutfit } from '@alola/ui';

describe('Player model', () => {
  const lookWith = (patch: Partial<HumanoidLook['outfit']> = {}, appearance: Partial<HumanoidLook['appearance']> = {}): HumanoidLook => ({
    appearance: { ...defaultAppearance(), ...appearance },
    outfit: { ...defaultOutfit(), ...patch },
  });

  const colorsOf = (look: HumanoidLook): Set<string> => {
    const c = buildPlayerModel(look).builder.build().getAttribute('color').array;
    const out = new Set<string>();
    for (let i = 0; i < c.length; i += 3) out.add(`${c[i].toFixed(3)},${c[i + 1].toFixed(3)},${c[i + 2].toFixed(3)}`);
    return out;
  };

  test('every clothing item in the creator builds, on the ground, within budget', () => {
    for (const item of CLOTHING) {
      const { builder } = buildPlayerModel(lookWith({ [item.slot]: item.id }));
      const g = builder.build();
      g.computeBoundingBox();
      assert.ok(g.boundingBox!.min.y > -0.01 && g.boundingBox!.min.y < 0.02, `${item.id}: feet at ${g.boundingBox!.min.y}`);
      assert.ok((g.getIndex()!.count / 3) < 8000, `${item.id} costs ${g.getIndex()!.count / 3} triangles`);
    }
  });

  test('the creator choices actually change the model', () => {
    // Before this model existed, the creator's choices were saved and never seen.
    const base = colorsOf(lookWith());
    const skin = colorsOf(lookWith({}, { skinTone: 12 }));
    const hair = colorsOf(lookWith({}, { hairColor: 13 }));
    const top = colorsOf(lookWith({ topColor: 9 }));
    assert.notDeepEqual([...skin], [...base], 'skin tone must change the model');
    assert.notDeepEqual([...hair], [...base], 'hair colour must change the model');
    assert.notDeepEqual([...top], [...base], 'top colour must change the model');
  });

  test('every hairstyle and body type builds', () => {
    for (let style = 0; style < 32; style++) {
      assert.doesNotThrow(() => buildPlayerModel(lookWith({}, { hairStyle: style })).builder.build());
    }
    for (let body = 0; body < 6; body++) {
      assert.doesNotThrow(() => buildPlayerModel(lookWith({}, { bodyType: body })).builder.build());
    }
  });

  test('palettes cover every index the creator can produce', () => {
    assert.equal(SKIN_TONES.length, 16, 'the creator offers 16 skin tones');
    assert.equal(HAIR_COLORS.length, 20, 'and 20 hair palettes');
  });

  test('height follows the creator slider', () => {
    assert.ok(humanoidHeight(4) > humanoidHeight(0));
    assert.ok(humanoidHeight(0) >= 1.4 && humanoidHeight(4) <= 1.9);
  });

  test('the player walks: legs and arms swing on the walk cycle', () => {
    const { rig } = buildPlayerModel(lookWith());
    assert.equal(rig.bones[Bone.LegBackLeft].motion, Motion.Walk);
    assert.equal(rig.bones[Bone.ArmLeft].motion, Motion.Walk);
    assert.notEqual(rig.bones[Bone.LegBackLeft].phase, rig.bones[Bone.LegBackRight].phase, 'legs alternate');
  });
});
