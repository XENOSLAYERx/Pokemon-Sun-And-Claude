/**
 * Project Alola — client entry point.
 *
 * Wires the headless simulation packages to a Three.js renderer. The split is
 * strict: nothing in this file makes a gameplay decision. It reads simulation
 * state and draws it, and it feeds input back in. That is what allows the same
 * simulation to run on the server and in tests.
 *
 * Boot order matters and is sequenced so the player sees progress rather than
 * a frozen tab: far terrain first (so there is a world), then the streamer
 * (so the ground under their feet exists), then wildlife.
 */
import {
  Scene, WebGLRenderer, PerspectiveCamera, DirectionalLight, HemisphereLight,
  Mesh, ShaderMaterial, MeshStandardMaterial, BoxGeometry, SphereGeometry,
  Color, Vector3, Fog, PlaneGeometry, DoubleSide, BackSide, InstancedMesh,
  Object3D, Matrix4, ConeGeometry, CapsuleGeometry,
} from 'three';
import {
  FixedClock, SpatialHash, vec3, clamp, rotateTowards, type Vec3,
} from '@alola/core';
import {
  TerrainGenerator, BiomeClassifier, ChunkStreamer, TimeOfDay, WeatherSystem,
  OceanSimulation, Spawner, ambientColorFor, worldToChunk, chunkCenter,
  CHUNK_SIZE, STREAMING_RADIUS, FAR_TERRAIN_RADIUS, WEATHER_PROFILES,
  type ChunkRecord,
} from '@alola/world';
import { allIslands, getSpecies, getBiome, islandAt, type WeatherId } from '@alola/data';
import {
  PokemonBrain, BrainLod, lodForDistance, visibilityFrom,
  type BrainState, type BrainWorldView, type PerceivableAgent,
} from '@alola/ai';
import {
  buildTerrainMesh, buildAllFarTerrain, shouldDrawFarTerrain,
  TERRAIN_VERTEX_SHADER, TERRAIN_FRAGMENT_SHADER, defaultTerrainUniforms,
  OCEAN_VERTEX_SHADER, OCEAN_FRAGMENT_SHADER, defaultOceanUniforms, MAX_OCEAN_WAVES,
  SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER, defaultSkyUniforms,
  CameraRig, AdaptiveQuality, detectQuality, readRendererString,
  QUALITY_PRESETS, type QualityPreset,
} from '@alola/render';
import { AudioDirector } from '@alola/audio';
import { SaveManager, MemoryStorage, type SaveFile } from '@alola/save';
import {
  GameProfile, BattleSession, engageableTarget, ambusher, maxHpOf, isFainted, starterLevelFor,
  type EncounterCandidate, type EncounterOffer,
} from '@alola/game';
import type { TerrainProbe } from '@alola/battle';
import { LocalStorageAdapter } from './game/storage.ts';
import { BattleUi } from './game/battle-ui.ts';
import { BattleStage } from './game/battle-stage.ts';
import { MenuUi } from './game/menu-ui.ts';
import { askNewGame } from './game/new-game-ui.ts';
import { Toast, injectGameStyles, el, hpColor } from './game/ui-kit.ts';

const WORLD_SEED = 20251115;
const MAX_VISIBLE_POKEMON = 220;

// ------------------------------------------------------------------ boot UI

const bootEl = document.getElementById('boot')!;
const bootBar = document.getElementById('boot-bar') as HTMLDivElement;
const bootStep = document.getElementById('boot-step') as HTMLDivElement;

function reportBoot(pct: number, step: string): Promise<void> {
  bootBar.style.width = `${pct}%`;
  bootStep.textContent = step;
  // Yield so the browser paints between stages rather than freezing.
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// ----------------------------------------------------------------- renderer

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
/**
 * Quality detection.
 *
 * Done before anything is sized or allocated, because the preset decides the
 * pixel ratio, shadow map size and ocean tessellation. Detection reads the
 * WebGL renderer string: a software rasteriser (SwiftShader in CI, llvmpipe on
 * a VM) has a frame budget roughly a hundred times smaller than a GPU, and
 * starting such a machine on 'high' produces something that looks broken
 * rather than merely slow.
 */
const rendererString = readRendererString(renderer.getContext());
const adaptive = new AdaptiveQuality(
  detectQuality({
    rendererString,
    deviceMemoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screenWidth: window.screen?.width,
  }),
  60,
);
let quality: QualityPreset = adaptive.preset;

function applyQuality(preset: QualityPreset): void {
  quality = preset;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
  renderer.setSize(
    Math.floor(window.innerWidth * preset.renderScale),
    Math.floor(window.innerHeight * preset.renderScale),
    false,
  );
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.shadowMap.enabled = preset.shadows;
  if (preset.shadows) {
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null as never;
  }
  sun.castShadow = preset.shadows;
  skyUniforms.uCloudSteps = { value: preset.cloudSteps };
  const qualityEl = document.getElementById('v-quality');
  if (qualityEl) qualityEl.textContent = `${preset.label} (${rendererString.slice(0, 28)})`;
}

renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new Scene();
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, FAR_TERRAIN_RADIUS * 1.5);
scene.fog = new Fog(0xb8cfe8, 600, 9000);

const sun = new DirectionalLight(0xfff0dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
scene.add(sun);
scene.add(sun.target);

const hemi = new HemisphereLight(0x9fc4ff, 0x4a4436, 0.9);
scene.add(hemi);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(
    Math.floor(window.innerWidth * quality.renderScale),
    Math.floor(window.innerHeight * quality.renderScale),
    false,
  );
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
});

// --------------------------------------------------------------- simulation

const terrain = new TerrainGenerator(WORLD_SEED);
const classifier = new BiomeClassifier();
const timeOfDay = new TimeOfDay({ secondsPerDay: 24 * 60, startHour: 8 });
const weather = new WeatherSystem(WORLD_SEED);
const ocean = new OceanSimulation({ windSpeed: 8 });
const spawner = new Spawner(WORLD_SEED, terrain, classifier);
const streamer = new ChunkStreamer({ buildsPerTick: 2, unloadsPerTick: 3 });
// Rebuilt when the quality preset changes.
let visiblePokemonCap = MAX_VISIBLE_POKEMON;
const audio = new AudioDirector();
const rig = new CameraRig();

// ---------------------------------------------------------------- the game
//
// The client owns presentation; @alola/game owns the rules. `mode` is the only
// piece of genuinely client-side game state, because what the player can press
// depends on which overlay has the screen.

type Mode = 'overworld' | 'battle' | 'menu';
let mode: Mode = 'overworld';

const saveStorageAvailable = LocalStorageAdapter.available();
const saves = new SaveManager(
  // Falls back to memory in a private window: the game still runs, it just
  // cannot persist, and the menu says so rather than failing silently.
  saveStorageAvailable ? new LocalStorageAdapter() : new MemoryStorage(),
  '0.1.0',
);
const SAVE_SLOT = 0;

injectGameStyles();
const toast = new Toast();

// Assigned in boot(), before the first frame runs.
let profile!: GameProfile;
let session: BattleSession | null = null;
/** Overworld id of the Pokémon currently being fought, so it can be removed. */
let battleAgentId = -1;
/** Seconds before the player can be pulled into another fight. */
let encounterCooldown = 0;
let autosaveAccum = 0;

// The preset can only be applied once the lights and shader uniforms exist.
adaptive.onChange = (preset) => {
  applyQuality(preset);
  visiblePokemonCap = preset.maxVisiblePokemon;
};

const perceptionGrid = new SpatialHash<PerceivableAgent>(16);
const brains: PokemonBrain[] = [];
let nextAgentId = 1;

// Player state. The client simulates it directly in single-player; in
// multiplayer this is driven through @alola/net's prediction instead.
const melemele = allIslands().find((i) => i.id === 'melemele')!;

/**
 * Opening spawn.
 *
 * A coastal cliff on Melemele's eastern shore, chosen by sweeping the island
 * for standable ground that scores well on elevation, visible ocean and nearby
 * relief. The first thing a player sees establishes what kind of world this is,
 * and the original spawn — the middle of a deliberately-levelled town square —
 * showed them a flat beige plane.
 */
const player = {
  position: vec3(-8505, 0, -5545),
  velocity: vec3(),
  yaw: 0,
  riding: false,
  speed: 0,
};
player.position.y = terrain.sampleHeight(player.position.x, player.position.z) + 1;
void melemele;

/**
 * The terrain probe the battle system uses to find flat ground.
 *
 * It reads the same generator the renderer draws from, so the arena a battle
 * generates is genuinely the ground under the player's feet rather than an
 * approximation of it.
 */
const battleProbe: TerrainProbe = {
  heightAt: (x, z) => terrain.sampleHeight(x, z),
  slopeAt: (x, z) => terrain.sample(x, z).slope,
  biomeAt: (x, z) => classifier.classify(terrain.sample(x, z)).biome.id,
};

/** Snapshot the parts of the world a save has to remember. */
function worldSnapshot(): SaveFile['world'] {
  const weatherState: Record<string, { current: string; remaining: number }> = {};
  for (const island of allIslands()) {
    const state = weather.get(island.id);
    weatherState[island.id] = { current: state.current, remaining: state.remaining };
  }
  return {
    worldSeed: WORLD_SEED,
    timeOfDay: timeOfDay.hour * 3600,
    weather: weatherState,
    ecology: {},
    modifications: {},
    discovered: [],
  };
}

async function saveGame(): Promise<string> {
  if (!saveStorageAvailable) {
    return 'This browser will not let the page store data, so saving is unavailable.';
  }
  profile.position = { ...player.position };
  profile.yaw = player.yaw;
  profile.island = islandAt(player.position.x, player.position.z)?.id ?? 'melemele';
  await saves.save(SAVE_SLOT, profile.toSaveFile(worldSnapshot()));
  return `Saved. ${profile.name} · ₽${profile.money.toLocaleString()} · dex ${profile.dexCaught}`;
}

// ------------------------------------------------------------------ shaders

const skyUniforms = defaultSkyUniforms();
const skyMesh = new Mesh(
  new SphereGeometry(1, 32, 16),
  new ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: skyUniforms as never,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
  }),
);
skyMesh.renderOrder = -1000;
skyMesh.frustumCulled = false;
skyMesh.scale.setScalar(FAR_TERRAIN_RADIUS);
scene.add(skyMesh);

const oceanUniforms = defaultOceanUniforms();
const oceanMesh = new Mesh(
  new PlaneGeometry(FAR_TERRAIN_RADIUS * 2, FAR_TERRAIN_RADIUS * 2, 128, 128),
  new ShaderMaterial({
    vertexShader: OCEAN_VERTEX_SHADER,
    fragmentShader: OCEAN_FRAGMENT_SHADER,
    uniforms: oceanUniforms as never,
    transparent: true,
    side: DoubleSide,
  }),
);
oceanMesh.rotation.x = -Math.PI / 2;
oceanMesh.frustumCulled = false;
scene.add(oceanMesh);

/**
 * Terrain material.
 *
 * The full shader expects texture arrays that a real content pipeline bakes.
 * Without them, the prototype uses a vertex-coloured standard material driven
 * by biome ground colours — which is enough to read the world's shape, biome
 * boundaries and lighting correctly, and swaps out for the real material with
 * no other change.
 */
function makeTerrainMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: false,
    roughness: 0.94,
    metalness: 0.0,
    color: 0x6d8a4a,
    flatShading: false,
  });
}

// ----------------------------------------------------------------- chunks

interface ChunkPayload {
  mesh: Mesh;
  lod: number;
}

const chunkMaterialCache = new Map<string, MeshStandardMaterial>();

function materialForBiome(biomeId: string): MeshStandardMaterial {
  let material = chunkMaterialCache.get(biomeId);
  if (!material) {
    const biome = getBiome(biomeId as never);
    material = makeTerrainMaterial();
    material.color = new Color(biome.groundColor[0], biome.groundColor[1], biome.groundColor[2]);
    chunkMaterialCache.set(biomeId, material);
  }
  return material;
}

function buildChunk(record: ChunkRecord): ChunkPayload {
  const result = buildTerrainMesh(terrain, classifier, record.cx, record.cz, record.lod);
  // Use the dominant biome's colour for the whole chunk in the prototype.
  const dominant = result.biomes[0] ?? 'grassland';
  const mesh = new Mesh(result.geometry, materialForBiome(dominant));
  mesh.position.set(record.cx * CHUNK_SIZE, 0, record.cz * CHUNK_SIZE);
  mesh.receiveShadow = true;
  mesh.castShadow = record.lod <= 1;
  scene.add(mesh);
  return { mesh, lod: record.lod };
}

function disposeChunk(record: ChunkRecord): void {
  const payload = record.payload as ChunkPayload | null;
  if (!payload) return;
  scene.remove(payload.mesh);
  payload.mesh.geometry.dispose();
}

// -------------------------------------------------------------- Pokémon viz

/**
 * Placeholder Pokémon rendering.
 *
 * Production uses skinned meshes per species from the art pipeline. Here each
 * species gets a procedurally-shaped capsule sized from its real height and
 * weight, tinted by primary type. That is deliberately more than a debug cube:
 * it makes species visually distinguishable, so AI behaviour can actually be
 * observed and tuned before any art exists.
 */
const TYPE_COLORS: Record<string, number> = {
  normal: 0xa8a878, fire: 0xf08030, water: 0x6890f0, electric: 0xf8d030,
  grass: 0x78c850, ice: 0x98d8d8, fighting: 0xc03028, poison: 0xa040a0,
  ground: 0xe0c068, flying: 0xa890f0, psychic: 0xf85888, bug: 0xa8b820,
  rock: 0xb8a038, ghost: 0x705898, dragon: 0x7038f8, dark: 0x705848,
  steel: 0xb8b8d0, fairy: 0xee99ac,
};

interface PokemonVisual {
  mesh: Mesh;
  brain: PokemonBrain;
}

const pokemonVisuals = new Map<number, PokemonVisual>();
const speciesGeometryCache = new Map<string, CapsuleGeometry>();
const speciesMaterialCache = new Map<string, MeshStandardMaterial>();

function visualFor(brain: PokemonBrain): PokemonVisual {
  const species = getSpecies(brain.state.speciesId);
  const key = species.id;

  let geometry = speciesGeometryCache.get(key);
  if (!geometry) {
    const height = clamp(species.height, 0.25, 6);
    const radius = clamp(Math.cbrt(species.weight) * 0.055, 0.12, height * 0.42);
    geometry = new CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 4, 8);
    speciesGeometryCache.set(key, geometry);
  }

  let material = speciesMaterialCache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({
      color: TYPE_COLORS[species.types[0]] ?? 0xcccccc,
      roughness: 0.7,
      metalness: 0.05,
    });
    speciesMaterialCache.set(key, material);
  }

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.position.set(brain.state.position.x, brain.state.position.y + species.height / 2, brain.state.position.z);
  scene.add(mesh);
  return { mesh, brain };
}

function spawnWildlife(): void {
  if (brains.length >= visiblePokemonCap) return;
  const { cx, cz } = worldToChunk(player.position.x, player.position.z);
  const currentWeather = (islandId: string | null): WeatherId =>
    weather.weatherIdFor(islandId ?? 'melemele') as WeatherId;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (brains.length >= visiblePokemonCap) return;
      const population = spawner.populateChunk(
        cx + dx, cz + dz, timeOfDay.hour, currentWeather, new Set<string>(),
      );
      for (const p of population) {
        if (brains.length >= visiblePokemonCap) return;
        // Skip if something is already very close — avoids stacking on reload.
        const tooClose = brains.some(
          (b) => Math.hypot(b.state.position.x - p.position.x, b.state.position.z - p.position.z) < 2,
        );
        if (tooClose) continue;

        const state: BrainState = {
          id: nextAgentId++,
          speciesId: p.speciesId,
          position: vec3(p.position.x, p.position.y, p.position.z),
          velocity: vec3(),
          yaw: p.yaw,
          home: vec3(p.position.x, p.position.y, p.position.z),
          packId: p.packId,
          level: p.level,
          health: 100,
          maxHealth: 100,
          lod: BrainLod.Full,
        };
        const brain = new PokemonBrain(state, WORLD_SEED ^ state.id);
        brains.push(brain);
        pokemonVisuals.set(state.id, visualFor(brain));
      }
    }
  }
}

function despawnDistant(): void {
  for (let i = brains.length - 1; i >= 0; i--) {
    const brain = brains[i];
    const distance = Math.hypot(
      brain.state.position.x - player.position.x,
      brain.state.position.z - player.position.z,
    );
    if (distance > 700) {
      const visual = pokemonVisuals.get(brain.state.id);
      if (visual) {
        scene.remove(visual.mesh);
        pokemonVisuals.delete(brain.state.id);
      }
      brains.splice(i, 1);
    }
  }
}

// -------------------------------------------------------- encounters

const stage = new BattleStage(scene);

/** Overworld brains, in the shape the encounter rules expect. */
function encounterCandidates(): EncounterCandidate[] {
  const out: EncounterCandidate[] = [];
  for (const brain of brains) {
    out.push({
      id: brain.state.id,
      speciesId: brain.state.speciesId,
      level: brain.state.level,
      position: brain.state.position,
      goal: brain.currentGoal,
    });
  }
  return out;
}

/** The Pokémon the player could engage right now, recomputed for the prompt. */
let pendingOffer: EncounterOffer | null = null;

function startBattle(offer: EncounterOffer): void {
  if (mode !== 'overworld') return;

  if (!profile.hasUsablePokemon) {
    toast.show('Your team is in no condition to battle.');
    return;
  }

  mode = 'battle';
  battleAgentId = offer.candidate.id;
  // The overworld must not keep acting on keys held when the fight began.
  keys.clear();

  const island = islandAt(player.position.x, player.position.z);
  const islandWeather = weather.get(island?.id ?? 'melemele');

  session = new BattleSession({
    profile,
    offer,
    probe: battleProbe,
    weather: islandWeather.current,
    hour: timeOfDay.hour,
    island: island?.id ?? null,
    // The encounter seed is derived from the agent and the tick, so the same
    // encounter is reproducible — which is what makes a battle replayable.
    seed: (WORLD_SEED ^ (offer.candidate.id * 2654435761) ^ Math.floor(simTime * 60)) | 0,
  });

  stage.begin(session, player.position);
  playerMesh.visible = false;
  // Hide the overworld model of whatever we are fighting; the stage draws it.
  const visual = pokemonVisuals.get(offer.candidate.id);
  if (visual) visual.mesh.visible = false;

  syncHudVisibility();
  battleUi.open(session);
}

function endBattle(finished: BattleSession, outcome: string): void {
  stage.end();
  playerMesh.visible = true;
  session = null;
  mode = 'overworld';
  keys.clear();
  syncHudVisibility();

  const removeAgent = (): void => {
    const index = brains.findIndex((b) => b.state.id === battleAgentId);
    if (index >= 0) {
      const visual = pokemonVisuals.get(battleAgentId);
      if (visual) {
        scene.remove(visual.mesh);
        pokemonVisuals.delete(battleAgentId);
      }
      brains.splice(index, 1);
    }
  };

  switch (outcome) {
    case 'caught': {
      removeAgent();
      const name = getSpecies(finished.wild.species).name;
      toast.show(`${name} was added to your team.`);
      break;
    }
    case 'won': {
      // A defeated wild Pokémon leaves rather than lying there fainted.
      removeAgent();
      toast.show('The wild Pokémon fled.');
      break;
    }
    case 'lost': {
      const lost = profile.blackOut();
      toast.show(`You blacked out and lost ₽${lost.toLocaleString()}. Your team was treated.`);
      // Push the player away from whatever knocked them out, so they do not
      // wake up inside its aggro radius and immediately lose again.
      const away = Math.atan2(player.position.x - finished.arena.x, player.position.z - finished.arena.z);
      player.position.x += Math.sin(away) * 45;
      player.position.z += Math.cos(away) * 45;
      player.position.y = terrain.sampleHeight(player.position.x, player.position.z);
      encounterCooldown = 6;
      break;
    }
    default: {
      // Fled, or ended some other way. Give the player a moment before the
      // same Pokémon can drag them back in.
      const visual = pokemonVisuals.get(battleAgentId);
      if (visual) visual.mesh.visible = true;
      encounterCooldown = 4;
      break;
    }
  }

  battleAgentId = -1;
}

const battleUi = new BattleUi({
  onFinished: (finished, outcome) => endBattle(finished, outcome),
  onCue: (cue) => { void cue; },
});

const menuUi = new MenuUi({
  onSave: () => saveGame(),
  onClose: () => { mode = 'overworld'; keys.clear(); syncHudVisibility(); },
  onHeal: () => toast.show('Your team is rested.'),
});

/**
 * Encounter checks, once per frame rather than per simulation tick.
 *
 * A tick-rate check would fire up to four times in one frame during catch-up,
 * which is how you end up starting the same battle twice.
 */
function updateEncounters(frameDt: number): void {
  if (mode !== 'overworld') {
    pendingOffer = null;
    return;
  }

  encounterCooldown = Math.max(0, encounterCooldown - frameDt);
  const candidates = encounterCandidates();
  pendingOffer = engageableTarget(player.position, candidates);

  if (encounterCooldown > 0 || !profile.hasUsablePokemon) return;

  // Something that hunts has decided to engage. The player does not get a
  // choice about this one — that is the whole point of meeting a predator.
  const ambush = ambusher(player.position, candidates);
  if (ambush) startBattle(ambush);
}

// ------------------------------------------------------------------- input

const keys = new Set<string>();
let dragging = false;
let flyCam = false;

window.addEventListener('keydown', (e) => {
  // The battle and menu overlays listen in the capture phase and stop the
  // event, so reaching here means the overworld has the keyboard.
  if (e.code === 'KeyE' && mode === 'overworld') {
    e.preventDefault();
    if (pendingOffer) startBattle(pendingOffer);
    return;
  }
  if ((e.code === 'Tab' || e.code === 'Escape') && mode === 'overworld') {
    e.preventDefault();
    mode = 'menu';
    keys.clear();
    syncHudVisibility();
    menuUi.open(profile);
    return;
  }

  keys.add(e.code);
  if (e.code === 'KeyT') timeOfDay.advanceToHour((timeOfDay.hour + 1) % 24);
  if (e.code === 'KeyF') flyCam = !flyCam;
  if (e.code === 'KeyQ') {
    // Cycle quality manually, which also locks off adaptive scaling.
    const order = Object.keys(QUALITY_PRESETS) as (keyof typeof QUALITY_PRESETS)[];
    const next = order[(order.indexOf(quality.name) + 1) % order.length];
    adaptive.lock(next);
  }
  if (e.code === 'Space') player.riding = !player.riding;
  if (e.code === 'KeyR') {
    const options: WeatherId[] = ['clear', 'cloudy', 'rain', 'thunderstorm', 'fog', 'harsh-sunlight'];
    const island = islandAt(player.position.x, player.position.z);
    const current = weather.weatherIdFor(island?.id ?? 'melemele');
    const next = options[(options.indexOf(current as WeatherId) + 1) % options.length];
    weather.force(island?.id ?? 'melemele', next, true);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', () => { dragging = true; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  rig.applyLook(-e.movementX * 0.004, -e.movementY * 0.003);
});

// ------------------------------------------------------------ player update

function updatePlayer(dt: number): void {
  let inputX = 0;
  let inputZ = 0;
  if (keys.has('KeyW')) inputZ -= 1;
  if (keys.has('KeyS')) inputZ += 1;
  if (keys.has('KeyA')) inputX -= 1;
  if (keys.has('KeyD')) inputX += 1;

  const magnitude = Math.hypot(inputX, inputZ);
  const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const baseSpeed = player.riding ? 16 : sprinting ? 9 : 4.5;

  if (magnitude > 0.01) {
    inputX /= magnitude;
    inputZ /= magnitude;
    // Movement is camera-relative, which is what players expect from a
    // third-person game and what makes analogue input feel right.
    const cos = Math.cos(rig.yaw);
    const sin = Math.sin(rig.yaw);
    const worldX = inputX * cos + inputZ * sin;
    const worldZ = -inputX * sin + inputZ * cos;

    player.velocity.x = worldX * baseSpeed;
    player.velocity.z = worldZ * baseSpeed;
    player.yaw = rotateTowards(player.yaw, Math.atan2(worldX, -worldZ), 10 * dt);
    player.speed = baseSpeed;
  } else {
    player.velocity.x *= Math.max(0, 1 - dt * 10);
    player.velocity.z *= Math.max(0, 1 - dt * 10);
    player.speed = 0;
  }

  player.position.x += player.velocity.x * dt;
  player.position.z += player.velocity.z * dt;

  const ground = terrain.sampleHeight(player.position.x, player.position.z);
  const waterHeight = ocean.heightAt(player.position.x, player.position.z);
  // Float on the water when the ground is below it.
  player.position.y = ground < 0 ? Math.max(waterHeight, ground) : ground;
}

// -------------------------------------------------------------- boot & loop

const playerMesh = new Mesh(
  new CapsuleGeometry(0.28, 1.1, 4, 8),
  new MeshStandardMaterial({ color: 0xffd08a, roughness: 0.6 }),
);
playerMesh.castShadow = true;
scene.add(playerMesh);

const clock = new FixedClock({ tickRate: 60, maxStepsPerFrame: 4 });
const dom = {
  island: document.getElementById('v-island')!,
  biome: document.getElementById('v-biome')!,
  time: document.getElementById('v-time')!,
  weather: document.getElementById('v-weather')!,
  sea: document.getElementById('v-sea')!,
  fps: document.getElementById('v-fps')!,
  frame: document.getElementById('v-frame')!,
  draws: document.getElementById('v-draws')!,
  tris: document.getElementById('v-tris')!,
  chunks: document.getElementById('v-chunks')!,
  mons: document.getElementById('v-mons')!,
  nearby: document.getElementById('v-nearby')!,
};

/**
 * Party strip and the context prompt.
 *
 * Built in code rather than in index.html because both are driven entirely by
 * profile state, and a placeholder in the markup would just be a second place
 * for the party size to be wrong.
 */
const partyPanel = el('div', 'panel');
partyPanel.id = 'panel-party';
partyPanel.append(el('h1', undefined, 'Team'));
const partyList = el('div');
partyPanel.appendChild(partyList);
document.getElementById('panel-controls')?.parentElement?.insertBefore(
  partyPanel,
  document.getElementById('panel-controls'),
);

const promptNode = el('div', 'prompt');
document.body.appendChild(promptNode);

const hudRoot = document.getElementById('hud');

/** The exploring HUD hides itself whenever an overlay has the screen. */
function syncHudVisibility(): void {
  hudRoot?.classList.toggle('dimmed', mode !== 'overworld');
}

function renderPartyPanel(): void {
  partyList.replaceChildren();
  if (profile.party.length === 0) {
    partyList.appendChild(el('div', 'label', 'no Pokémon'));
    return;
  }
  for (const mon of profile.party) {
    const max = maxHpOf(mon);
    const fraction = max > 0 ? Math.max(0, mon.currentHp) / max : 0;
    const row = el('div', 'mon-row');
    const name = el('span', 'mon-name',
      `${mon.nickname ?? getSpecies(mon.species).name}${mon.shiny ? ' ✦' : ''}`);
    name.style.minWidth = '104px';
    const lv = el('span', 'label', `L${mon.level}`);
    const bar = el('div', 'mon-bar');
    const fill = el('div');
    fill.style.width = `${fraction * 100}%`;
    fill.style.background = isFainted(mon) ? '#4a5568' : hpColor(fraction);
    bar.appendChild(fill);
    row.append(name, lv, bar);
    partyList.appendChild(row);
  }
}

function renderPrompt(): void {
  if (mode !== 'overworld' || !pendingOffer) {
    promptNode.classList.remove('show');
    return;
  }
  const species = getSpecies(pendingOffer.candidate.speciesId);
  promptNode.replaceChildren();
  const kbd = el('kbd', undefined, 'E');
  promptNode.append(kbd, document.createTextNode(
    `  battle the wild ${species.name} (Lv ${pendingOffer.candidate.level})`,
  ));
  promptNode.classList.add('show');
}

let simTime = 0;
let fpsAccum = 0;
let fpsFrames = 0;
let displayFps = 0;
let hudAccum = 0;

function simulate(dt: number): void {
  simTime += dt;

  // Environment. The in-game clock advances faster than real time.
  const inGameDelta = dt * 60;
  timeOfDay.update(inGameDelta);
  weather.update(inGameDelta, timeOfDay.hour);
  ocean.update(dt);

  const island = islandAt(player.position.x, player.position.z);
  const islandId = island?.id ?? 'melemele';
  const islandWeather = weather.get(islandId);
  ocean.setWind(islandWeather.windDirection, islandWeather.windSpeed);

  profile.playtimeSeconds += dt;

  // A battle freezes the world's actors but not its environment: the sun still
  // moves and the sea still runs, so a fight at dusk finishes at dusk — and the
  // audio director below still gets told what is happening.
  const actorsRun = mode === 'overworld';

  if (actorsRun) {
    updatePlayer(dt);

    perceptionGrid.rebuild([
      {
        id: 0,
        position: player.position,
        speciesId: 'PLAYER',
        packId: -1,
        playerId: 'local',
        noise: player.speed > 6 ? 1 : player.speed > 0 ? 0.5 : 0.1,
        inactive: false,
        level: 30,
      },
      ...brains.map((b) => ({
        id: b.state.id,
        position: b.state.position,
        speciesId: b.state.speciesId,
        packId: b.state.packId,
        playerId: null,
        noise: 0.4,
        inactive: false,
        level: b.state.level,
      })),
    ]);

    const visibility = visibilityFrom(islandWeather.fogDensity, timeOfDay.state.daylight, false);
    const worldView: BrainWorldView = {
      hour: timeOfDay.hour,
      daylight: timeOfDay.state.daylight,
      visibility,
      now: simTime,
      grid: perceptionGrid,
      groundAt: (x, z) => terrain.sampleHeight(x, z),
    };

    for (const brain of brains) {
      const distance = Math.hypot(
        brain.state.position.x - player.position.x,
        brain.state.position.z - player.position.z,
      );
      brain.state.lod = lodForDistance(distance);
      brain.update(dt, worldView);
    }
  }

  // Audio direction (mix state only; playback is wired separately).
  const sample = terrain.sample(player.position.x, player.position.z);
  const biome = classifier.classify(sample).biome;
  audio.evaluate({
    biome: biome.id,
    island: islandId,
    hour: timeOfDay.hour,
    daylight: timeOfDay.state.daylight,
    weather: islandWeather.current,
    precipitation: islandWeather.precipitation,
    windSpeed: islandWeather.windSpeed,
    enclosed: false,
    inBattle: mode === 'battle',
    isBossBattle: false,
    threatDistance: pendingOffer?.distance ?? Infinity,
    healthFraction: partyHealthFraction(),
    riding: player.riding,
    onWater: sample.height < 0,
    inCutscene: false,
    ultraEvent: false,
  });
  audio.update(dt);
}

/**
 * Streaming and population, run once per rendered frame.
 *
 * Deliberately NOT inside the fixed-step simulation. The clock runs up to four
 * simulation steps per frame to catch up, so calling this from `simulate`
 * spent the per-tick chunk budget four times over — up to eight synchronous
 * chunk builds in a single frame. Budgets that exist to protect frame time
 * have to be enforced per frame.
 */
let sinceSpawnCheck = 0;

function updateStreaming(frameDt: number): void {
  streamer.setObservers([{ x: player.position.x, z: player.position.z }]);
  streamer.update(simTime, buildChunk, disposeChunk);

  sinceSpawnCheck += frameDt;
  if (sinceSpawnCheck >= 1.5 && mode === 'overworld') {
    sinceSpawnCheck = 0;
    spawnWildlife();
    despawnDistant();
  }
}

function render(alpha: number, frameDt: number): void {
  const island = islandAt(player.position.x, player.position.z);
  const islandId = island?.id ?? 'melemele';
  const islandWeather = weather.get(islandId);
  const celestial = timeOfDay.state;

  // Camera. During a battle the stage decides where it goes, easing across
  // from wherever exploring left it rather than cutting.
  const staged = stage.active ? stage.cameraFor(camera, frameDt) : null;
  if (staged) {
    const weight = Math.min(1, frameDt * 4 + stage.transition * 0.08);
    camera.position.lerp(staged.position, weight);
    camera.lookAt(staged.lookAt);
    camera.fov = 52;
    camera.updateProjectionMatrix();
    // Keep the rig tracking the player so leaving the battle does not snap.
    rig.snap(new Vector3(player.position.x, player.position.y, player.position.z));
  } else {
    rig.setMode(player.riding ? 'ride' : flyCam ? 'fly' : 'explore');
    rig.update(frameDt, new Vector3(player.position.x, player.position.y, player.position.z), null);
    camera.position.copy(rig.position);
    camera.lookAt(rig.target);
    camera.fov = rig.fov;
    camera.updateProjectionMatrix();
  }

  // Sky follows the camera so it is always centred on the viewer.
  skyMesh.position.copy(camera.position);

  // Lighting from the celestial model.
  const ambient = ambientColorFor(celestial);
  const sunDir = new Vector3(celestial.sunDirX, celestial.sunDirY, celestial.sunDirZ);
  sun.position.copy(camera.position).addScaledVector(sunDir, -220);
  sun.target.position.copy(camera.position);
  sun.target.updateMatrixWorld();
  sun.intensity = Math.max(0.05, celestial.daylight * 2.4 * islandWeather.lightScale);
  sun.color.setRGB(
    1,
    0.92 + celestial.goldenHour * 0.04,
    0.82 - celestial.goldenHour * 0.3,
  );
  hemi.intensity = 0.35 + celestial.daylight * 0.75;
  hemi.color.setRGB(ambient[0], ambient[1], ambient[2]);

  // Fog follows weather and daylight.
  const fogColor = new Color(ambient[0], ambient[1], ambient[2]).lerp(new Color(0xb8cfe8), 0.55);
  (scene.fog as Fog).color = fogColor;
  (scene.fog as Fog).near = 400 / Math.max(0.4, islandWeather.fogDensity);
  (scene.fog as Fog).far = 9000 / Math.max(0.5, islandWeather.fogDensity);
  renderer.setClearColor(fogColor);

  // Sky uniforms.
  skyUniforms.uSunDirection.value = [celestial.sunDirX, celestial.sunDirY, celestial.sunDirZ];
  skyUniforms.uSunIntensity.value = Math.max(0.05, celestial.daylight);
  skyUniforms.uCloudCoverage.value = islandWeather.cloudCover;
  skyUniforms.uCloudDensity.value = 0.6 + islandWeather.precipitation;
  skyUniforms.uStarIntensity.value = Math.max(0, 1 - celestial.daylight * 2.2);
  skyUniforms.uAuroraIntensity.value = islandWeather.current === 'aurora' ? 1 : 0;
  skyUniforms.uTime.value = simTime;
  skyUniforms.uZenithColor.value = [ambient[0] * 0.5, ambient[1] * 0.75, ambient[2]];
  skyUniforms.uHorizonColor.value = [fogColor.r, fogColor.g, fogColor.b];

  // Ocean uniforms — the same wave set the CPU simulation is using.
  const waves = oceanUniforms.uWaves.value as Float32Array;
  waves.set(ocean.toUniformArray().subarray(0, MAX_OCEAN_WAVES * 6));
  oceanUniforms.uWaveCount.value = Math.min(ocean.waves.length, MAX_OCEAN_WAVES);
  oceanUniforms.uTime.value = ocean.elapsed;
  oceanUniforms.uSunDirection.value = [celestial.sunDirX, celestial.sunDirY, celestial.sunDirZ];
  oceanUniforms.uSkyColor.value = [fogColor.r, fogColor.g, fogColor.b];
  oceanUniforms.uFogColor.value = [fogColor.r, fogColor.g, fogColor.b];
  oceanMesh.position.set(camera.position.x, 0, camera.position.z);

  // Player and Pokémon transforms.
  playerMesh.position.set(player.position.x, player.position.y + 0.83, player.position.z);
  playerMesh.rotation.y = player.yaw;

  for (const [id, visual] of pokemonVisuals) {
    const brain = visual.brain;
    if (!brain) continue;
    const species = getSpecies(brain.state.speciesId);
    visual.mesh.position.set(
      brain.state.position.x,
      brain.state.position.y + species.height / 2,
      brain.state.position.z,
    );
    visual.mesh.rotation.y = brain.state.yaw;
    // Dormant agents are not worth drawing.
    visual.mesh.visible = brain.state.lod !== BrainLod.Dormant;
    void id;
    void alpha;
  }

  renderer.render(scene, camera);
}

function updateHud(dt: number): void {
  hudAccum += dt;
  if (hudAccum < 0.25) return;
  hudAccum = 0;

  const island = islandAt(player.position.x, player.position.z);
  const islandId = island?.id ?? null;
  const islandWeather = weather.get(islandId ?? 'melemele');
  const sample = terrain.sample(player.position.x, player.position.z);
  const biome = classifier.classify(sample).biome;
  const hour = timeOfDay.hour;

  dom.island.textContent = island ? island.name : 'open ocean';
  dom.biome.textContent = biome.name;
  dom.time.textContent =
    `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}` +
    `  d${timeOfDay.day}  (${timeOfDay.state.period})`;
  dom.weather.textContent = WEATHER_PROFILES[islandWeather.current].name;
  dom.sea.textContent = `${ocean.significantWaveHeight.toFixed(2)} m`;

  dom.fps.textContent = displayFps.toFixed(0);
  dom.frame.textContent = `${clock.frameTimeMs.toFixed(1)} ms`;
  dom.draws.textContent = String(renderer.info.render.calls);
  dom.tris.textContent = renderer.info.render.triangles.toLocaleString();
  dom.chunks.textContent = `${streamer.stats.loaded} (q${streamer.stats.queueDepth})`;
  dom.mons.textContent = String(brains.length);

  renderPartyPanel();
  renderPrompt();

  // Nearby Pokémon with what they are actually doing — the fastest way to
  // tell whether the AI is behaving, without attaching a debugger.
  const nearby = brains
    .map((b) => ({
      brain: b,
      d: Math.hypot(b.state.position.x - player.position.x, b.state.position.z - player.position.z),
    }))
    .filter((e) => e.d < 80)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);

  dom.nearby.innerHTML = nearby.length === 0
    ? 'nothing within 80m'
    : nearby
        .map((e) => {
          const species = getSpecies(e.brain.state.speciesId);
          const goal = e.brain.currentGoal ?? 'idle';
          return `${species.name} <span style="color:#6d89ad">lv${e.brain.state.level}</span> — ${goal} <span style="color:#6d89ad">${e.d.toFixed(0)}m</span>`;
        })
        .join('<br>');
}

let lastFrameTime = performance.now();

function frame(): void {
  requestAnimationFrame(frame);

  const now = performance.now();
  const frameDt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  fpsAccum += frameDt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    displayFps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  adaptive.update(frameDt * 1000);

  clock.advance(now / 1000, (dt) => simulate(dt));
  updateEncounters(frameDt);
  // Streaming keeps running through a battle so the world behind it stays
  // loaded, but nothing new spawns into a fight.
  updateStreaming(frameDt);
  render(clock.alpha, frameDt);
  updateHud(frameDt);
  updateAutosave(frameDt);
}

/**
 * Autosave.
 *
 * Only in the overworld. A save written mid-battle would restore into a world
 * with no battle in it and a party whose HP came from halfway through one.
 */
function updateAutosave(frameDt: number): void {
  if (mode !== 'overworld' || !saveStorageAvailable) return;
  autosaveAccum += frameDt;
  if (autosaveAccum < 120) return;
  autosaveAccum = 0;
  void saveGame().then(() => toast.show('Autosaved.', 1.6)).catch((error: unknown) => {
    toast.show(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`, 4);
  });
}

function partyHealthFraction(): number {
  let current = 0;
  let max = 0;
  for (const mon of profile.party) {
    current += Math.max(0, mon.currentHp);
    max += maxHpOf(mon);
  }
  return max > 0 ? current / max : 1;
}

/** Levels of everything that can spawn around the player right now. */
function localSpawnLevels(): number[] {
  const { cx, cz } = worldToChunk(player.position.x, player.position.z);
  const islandId = islandAt(player.position.x, player.position.z)?.id ?? 'melemele';
  const currentWeather = (): WeatherId => weather.weatherIdFor(islandId) as WeatherId;
  const levels: number[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const p of spawner.populateChunk(cx + dx, cz + dz, timeOfDay.hour, currentWeather, new Set<string>())) {
        levels.push(p.level);
      }
    }
  }
  return levels;
}

/**
 * Load the existing save, or start a new game.
 *
 * A save that cannot be read is reported rather than silently discarded: the
 * one thing worse than losing a save is being told nothing happened.
 */
async function loadOrCreateProfile(): Promise<void> {
  if (saveStorageAvailable) {
    try {
      const result = await saves.load(SAVE_SLOT);
      profile = GameProfile.fromSaveFile(result.save);
      player.position.x = profile.position.x;
      player.position.z = profile.position.z;
      player.position.y = terrain.sampleHeight(profile.position.x, profile.position.z);
      player.yaw = profile.yaw;
      // The world clock is part of the save, so a night-time save resumes at night.
      timeOfDay.advanceToHour(Math.max(0, Math.min(23.99, result.save.world.timeOfDay / 3600)));
      for (const [islandId, entry] of Object.entries(result.save.world.weather ?? {})) {
        weather.force(islandId, entry.current as WeatherId, true);
      }
      if (result.recoveredFromBackup) {
        toast.show('Your save was damaged; the backup was restored.', 5);
      } else if (result.migrationsApplied.length > 0) {
        toast.show(`Save updated (${result.migrationsApplied.join(', ')}).`, 4);
      }
      return;
    } catch {
      // No save, or an unreadable one. Fall through to a new game.
    }
  }

  const choice = await askNewGame(WORLD_SEED);
  // Size the starter to whatever actually lives here, rather than to a
  // constant that happens to be wrong for this coastline.
  profile = GameProfile.newGame({
    worldSeed: WORLD_SEED,
    playerName: choice.name,
    spawn: { ...player.position },
    starter: choice.starter,
    starterLevel: starterLevelFor(localSpawnLevels()),
  });
  profile.appearance = choice.appearance;
  profile.yaw = player.yaw;
  if (!saveStorageAvailable) {
    toast.show('This browser blocks site storage, so progress will not be saved.', 6);
  }
}

async function boot(): Promise<void> {
  await reportBoot(5, `detecting hardware (${rendererString.slice(0, 40)})`);
  applyQuality(adaptive.preset);
  visiblePokemonCap = adaptive.preset.maxVisiblePokemon;

  await reportBoot(10, 'generating terrain');
  // Touch the generator so its noise tables are warm before the first frame.
  terrain.sample(player.position.x, player.position.z);

  await reportBoot(30, 'building distant islands');
  const farMeshes = buildAllFarTerrain(terrain, classifier);
  for (const far of farMeshes) {
    const island = allIslands().find((i) => i.id === far.islandId)!;
    const mesh = new Mesh(far.geometry, makeTerrainMaterial());
    mesh.position.set(far.originX, 0, far.originZ);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.userData.islandId = far.islandId;
    scene.add(mesh);
    // Hidden when the player is standing on this island's streamed chunks.
    mesh.onBeforeRender = (): void => {
      mesh.visible = shouldDrawFarTerrain(camera.position.x, camera.position.z, island);
    };
  }

  await reportBoot(60, 'streaming ground');
  streamer.setObservers([{ x: player.position.x, z: player.position.z }]);
  for (let i = 0; i < 40; i++) {
    streamer.update(i * 0.016, buildChunk, disposeChunk);
  }

  await reportBoot(85, 'populating Alola');
  spawnWildlife();

  await reportBoot(94, 'reading your save');
  // Hide the boot screen first: a new game needs the player to answer, and
  // asking them a question behind a loading curtain is not a question.
  bootEl.classList.add('done');
  await loadOrCreateProfile();
  renderPartyPanel();

  await reportBoot(100, 'ready');
  // Open looking out to sea, pitched down slightly so the shoreline and the
  // water are both in frame.
  rig.yaw = -2.0943;
  // A shallow pitch keeps the horizon low in frame, so the sea and the
  // distant islands are the subject rather than the grass underfoot.
  rig.pitch = 0.22;
  rig.snap(new Vector3(player.position.x, player.position.y, player.position.z));

  lastFrameTime = performance.now();
  frame();
}

void boot();

// Expose a handle for console debugging — genuinely useful during tuning.
Object.assign(window as unknown as Record<string, unknown>, {
  alola: {
    terrain, weather, timeOfDay, ocean, streamer, brains, player, scene, audio,
    get profile() { return profile; },
    get session() { return session; },
    get mode() { return mode; },
    saveGame,
  },
});
