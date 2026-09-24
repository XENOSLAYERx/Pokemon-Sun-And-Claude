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
