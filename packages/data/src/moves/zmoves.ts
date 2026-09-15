/**
 * Z-Moves.
 *
 * A Z-Move is three things at once and the data model has to serve all three:
 *   1. A battle effect (power, type, or a status upgrade).
 *   2. A camera/VFX cinematic with authored beats.
 *   3. A player performance — the pose input the player physically makes.
 *
 * The `beats` timeline is the contract between design and engineering: the
 * combat designer authors timings here, and the presentation layer plays them
 * without knowing which Z-Move it is. Environmental reactions are declared
 * rather than scripted so they work in any arena the battle spawns in.
 */
import type { PokemonType } from '../types.ts';

/** What the camera and effects do at a given moment in the cinematic. */
export interface ZMoveBeat {
  /** Seconds from the start of the cinematic. */
  readonly at: number;
  readonly camera:
    | 'pose-closeup'      // Tight on the trainer performing the pose.
    | 'orbit-slow'        // Slow orbit around the Pokémon as it charges.
    | 'low-hero'          // Low angle, Pokémon towering.
    | 'sky-wide'          // Pulls to the sky for the energy descent.
    | 'impact-shake'      // Hard cut to the impact with screen shake.
    | 'aftermath-drift';  // Slow drift over the settling dust.
  /** VFX graph to trigger. */
  readonly vfx?: string;
  /** Sound cue. */
  readonly sfx?: string;
  /** Screen shake amplitude, 0–1. */
  readonly shake?: number;
  /** Time dilation: 0.2 = dramatic slow motion. */
  readonly timeScale?: number;
}

/**
 * Environmental reactions. The arena system resolves these against whatever
 * terrain the battle actually generated, so a Gigavolt Havoc on a beach
 * vitrifies sand while the same move in a cave fuses the walls.
 */
export interface ZEnvironmentReaction {
  /** Which surface responds. */
  readonly surface: 'ground' | 'water' | 'foliage' | 'rock' | 'sand' | 'snow' | 'any';
  /** What happens to it. */
  readonly effect: 'scorch' | 'crater' | 'freeze' | 'flatten' | 'vitrify' | 'flood' | 'shatter' | 'bloom';
  /** Radius in metres from the impact point. */
  readonly radius: number;
  /** Seconds before the world heals the damage. -1 persists until the battle ends. */
  readonly duration: number;
}

export interface ZMoveDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  /** Z-Crystal required. */
  readonly crystal: string;
  /** Base power. Null for status Z-Moves, which grant a boost instead. */
  readonly power: number | null;
  readonly category: 'physical' | 'special' | 'status';
  /** For status Z-Moves: what the user gains. */
  readonly statusEffect?: string;
  /** Only usable by this species (and only with this base move). */
  readonly exclusiveTo?: { readonly species: string; readonly baseMove: string };
  /** The pose the player performs. Maps to a motion-capture clip and an input sequence. */
  readonly pose: {
    readonly name: string;
    /** Input sequence for gamepad/keyboard performance. */
    readonly inputs: readonly ('up' | 'down' | 'left' | 'right' | 'cross' | 'circle')[];
    /** Seconds allowed to complete the pose. Missing it weakens the move. */
    readonly window: number;
  };
  readonly beats: readonly ZMoveBeat[];
  readonly environment: readonly ZEnvironmentReaction[];
  readonly description: string;
}

export const ZMOVE_LIST: readonly ZMoveDefinition[] = [
  {
    id: 'gigavolt-havoc', name: 'Gigavolt Havoc', type: 'electric',
    crystal: 'electrium-z', power: 180, category: 'special',
    pose: { name: 'Thunderclap', inputs: ['up', 'right', 'down', 'cross'], window: 2.4 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start', timeScale: 1 },
      { at: 1.2, camera: 'orbit-slow', vfx: 'z/electric_gather', sfx: 'z/electric_hum' },
      { at: 2.4, camera: 'sky-wide', vfx: 'z/storm_cell', sfx: 'z/thunder_build', timeScale: 0.6 },
      { at: 3.4, camera: 'low-hero', vfx: 'z/electric_aura', shake: 0.3 },
      { at: 4.0, camera: 'impact-shake', vfx: 'z/gigavolt_beam', sfx: 'z/thunder_strike', shake: 1.0, timeScale: 0.25 },
      { at: 5.2, camera: 'aftermath-drift', vfx: 'z/arc_residue', timeScale: 1 },
    ],
    environment: [
      { surface: 'sand', effect: 'vitrify', radius: 9, duration: -1 },
      { surface: 'ground', effect: 'scorch', radius: 12, duration: -1 },
      { surface: 'water', effect: 'shatter', radius: 16, duration: 6 },
      { surface: 'foliage', effect: 'scorch', radius: 14, duration: -1 },
    ],
    description: 'A colossal electric charge dropped from a storm cell the user summons.',
  },
  {
    id: 'inferno-overdrive', name: 'Inferno Overdrive', type: 'fire',
    crystal: 'firium-z', power: 180, category: 'special',
    pose: { name: 'Blazing Cross', inputs: ['down', 'down', 'up', 'cross'], window: 2.4 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.2, camera: 'orbit-slow', vfx: 'z/fire_gather', sfx: 'z/fire_roar' },
      { at: 2.6, camera: 'low-hero', vfx: 'z/fire_aura', shake: 0.4 },
      { at: 3.6, camera: 'impact-shake', vfx: 'z/inferno_sphere', sfx: 'z/explosion_deep', shake: 1.0, timeScale: 0.3 },
      { at: 5.0, camera: 'aftermath-drift', vfx: 'z/ember_rain', timeScale: 1 },
    ],
    environment: [
      { surface: 'foliage', effect: 'scorch', radius: 18, duration: -1 },
      { surface: 'ground', effect: 'crater', radius: 10, duration: -1 },
      { surface: 'water', effect: 'flood', radius: 12, duration: 8 },
      { surface: 'snow', effect: 'flatten', radius: 20, duration: -1 },
    ],
    description: 'A sphere of compressed flame that detonates on contact.',
  },
  {
    id: 'hydro-vortex', name: 'Hydro Vortex', type: 'water',
    crystal: 'waterium-z', power: 180, category: 'special',
    pose: { name: 'Tidal Sweep', inputs: ['left', 'right', 'circle'], window: 2.2 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.2, camera: 'orbit-slow', vfx: 'z/water_gather', sfx: 'z/water_swell' },
      { at: 2.8, camera: 'sky-wide', vfx: 'z/whirlpool_form', sfx: 'z/vortex', timeScale: 0.7 },
      { at: 3.8, camera: 'impact-shake', vfx: 'z/vortex_crush', sfx: 'z/water_impact', shake: 0.9, timeScale: 0.3 },
      { at: 5.0, camera: 'aftermath-drift', vfx: 'z/spray_settle' },
    ],
    environment: [
      { surface: 'ground', effect: 'flood', radius: 16, duration: 20 },
      { surface: 'sand', effect: 'crater', radius: 12, duration: -1 },
      { surface: 'foliage', effect: 'flatten', radius: 14, duration: 30 },
    ],
    description: 'A vortex that swallows the target and crushes it inward.',
  },
  {
    id: 'bloom-doom', name: 'Bloom Doom', type: 'grass',
    crystal: 'grassium-z', power: 180, category: 'special',
    pose: { name: 'Blossom Open', inputs: ['down', 'left', 'up', 'circle'], window: 2.4 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.3, camera: 'orbit-slow', vfx: 'z/petal_gather', sfx: 'z/bloom_chime' },
      { at: 2.8, camera: 'low-hero', vfx: 'z/flower_grow', shake: 0.2 },
      { at: 3.8, camera: 'impact-shake', vfx: 'z/bloom_burst', sfx: 'z/bloom_impact', shake: 0.8, timeScale: 0.35 },
      { at: 5.2, camera: 'aftermath-drift', vfx: 'z/petal_fall' },
    ],
    environment: [
      { surface: 'ground', effect: 'bloom', radius: 22, duration: 120 },
      { surface: 'rock', effect: 'bloom', radius: 10, duration: 60 },
    ],
    description: 'Concentrated plant energy that erupts as a vast flower.',
  },
  {
    id: 'tectonic-rage', name: 'Tectonic Rage', type: 'ground',
    crystal: 'groundium-z', power: 180, category: 'physical',
    pose: { name: 'Earth Split', inputs: ['up', 'down', 'cross'], window: 2.0 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.2, camera: 'low-hero', vfx: 'z/ground_crack', sfx: 'z/rumble', shake: 0.4 },
      { at: 2.6, camera: 'orbit-slow', vfx: 'z/rock_rise', shake: 0.6 },
      { at: 3.6, camera: 'impact-shake', vfx: 'z/chasm_open', sfx: 'z/quake_impact', shake: 1.0, timeScale: 0.25 },
      { at: 5.0, camera: 'aftermath-drift', vfx: 'z/dust_settle' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 20, duration: -1 },
      { surface: 'rock', effect: 'shatter', radius: 16, duration: -1 },
      { surface: 'any', effect: 'flatten', radius: 24, duration: -1 },
    ],
    description: 'The user drives the target into a chasm it tears open itself.',
  },
  {
    id: 'never-ending-nightmare', name: 'Never-Ending Nightmare', type: 'ghost',
    crystal: 'ghostium-z', power: 180, category: 'physical',
    pose: { name: 'Grasping Dark', inputs: ['left', 'down', 'right', 'circle'], window: 2.6 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.4, camera: 'orbit-slow', vfx: 'z/shadow_gather', sfx: 'z/whisper' },
      { at: 3.0, camera: 'low-hero', vfx: 'z/hands_rise', shake: 0.3, timeScale: 0.8 },
      { at: 4.0, camera: 'impact-shake', vfx: 'z/shadow_drag', sfx: 'z/scream', shake: 0.7, timeScale: 0.3 },
      { at: 5.4, camera: 'aftermath-drift', vfx: 'z/shadow_dissipate' },
    ],
    environment: [
      { surface: 'any', effect: 'flatten', radius: 12, duration: 20 },
    ],
    description: 'Spectral hands drag the target into a place it cannot wake from.',
  },
  {
    id: 'all-out-pummeling', name: 'All-Out Pummeling', type: 'fighting',
    crystal: 'fightinium-z', power: 180, category: 'physical',
    pose: { name: 'Fist Barrage', inputs: ['cross', 'cross', 'circle'], window: 1.8 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.0, camera: 'orbit-slow', vfx: 'z/aura_fists', sfx: 'z/impact_build' },
      { at: 2.2, camera: 'impact-shake', vfx: 'z/pummel_volley', sfx: 'z/rapid_hits', shake: 0.8, timeScale: 0.5 },
      { at: 3.8, camera: 'impact-shake', vfx: 'z/final_blow', sfx: 'z/impact_heavy', shake: 1.0, timeScale: 0.2 },
      { at: 5.0, camera: 'aftermath-drift' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 8, duration: -1 },
      { surface: 'rock', effect: 'shatter', radius: 10, duration: -1 },
    ],
    description: 'A barrage of aura-charged strikes ending in one decisive blow.',
  },
  {
    id: 'subzero-slammer', name: 'Subzero Slammer', type: 'ice',
    crystal: 'icium-z', power: 180, category: 'special',
    pose: { name: 'Frozen Crown', inputs: ['up', 'left', 'down', 'right'], window: 2.6 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.3, camera: 'orbit-slow', vfx: 'z/frost_gather', sfx: 'z/ice_crackle' },
      { at: 2.8, camera: 'sky-wide', vfx: 'z/glacier_form', timeScale: 0.6 },
      { at: 3.8, camera: 'impact-shake', vfx: 'z/glacier_drop', sfx: 'z/ice_shatter', shake: 1.0, timeScale: 0.25 },
      { at: 5.2, camera: 'aftermath-drift', vfx: 'z/frost_mist' },
    ],
    environment: [
      { surface: 'water', effect: 'freeze', radius: 24, duration: 45 },
      { surface: 'ground', effect: 'freeze', radius: 16, duration: 30 },
      { surface: 'foliage', effect: 'freeze', radius: 18, duration: 30 },
    ],
    description: 'A pillar of ice driven down through the target.',
  },

  {
    id: 'breakneck-blitz', name: 'Breakneck Blitz', type: 'normal',
    crystal: 'normalium-z', power: 180, category: 'physical',
    pose: { name: 'Full Charge', inputs: ['down', 'right', 'cross'], window: 2.0 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.1, camera: 'orbit-slow', vfx: 'z/speed_lines', sfx: 'z/rush_build' },
      { at: 2.4, camera: 'low-hero', vfx: 'z/sprint_charge', shake: 0.3 },
      { at: 3.2, camera: 'impact-shake', vfx: 'z/blitz_impact', sfx: 'z/impact_heavy', shake: 0.9, timeScale: 0.3 },
      { at: 4.4, camera: 'aftermath-drift', vfx: 'z/dust_trail' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 9, duration: -1 },
      { surface: 'foliage', effect: 'flatten', radius: 16, duration: 60 },
    ],
    description: 'The user builds every scrap of momentum it has and does not stop.',
  },
  {
    id: 'devastating-drake', name: 'Devastating Drake', type: 'dragon',
    crystal: 'dragonium-z', power: 180, category: 'special',
    pose: { name: 'Drake Rise', inputs: ['left', 'up', 'right', 'cross'], window: 2.6 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/charge_start' },
      { at: 1.4, camera: 'orbit-slow', vfx: 'z/dragon_aura', sfx: 'z/dragon_growl' },
      { at: 2.9, camera: 'sky-wide', vfx: 'z/drake_form', timeScale: 0.6 },
      { at: 4.0, camera: 'impact-shake', vfx: 'z/drake_dive', sfx: 'z/dragon_roar', shake: 1.0, timeScale: 0.25 },
      { at: 5.4, camera: 'aftermath-drift', vfx: 'z/aura_dissipate' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 14, duration: -1 },
      { surface: 'rock', effect: 'shatter', radius: 18, duration: -1 },
      { surface: 'any', effect: 'flatten', radius: 22, duration: 90 },
    ],
    description: 'Draconic energy takes shape above the user and comes down as a single strike.',
  },

  // ------------------------------------------------- Species-exclusive
  {
    id: 'catastropika', name: 'Catastropika', type: 'electric',
    crystal: 'pikanium-z', power: 210, category: 'physical',
    exclusiveTo: { species: 'PIKACHU', baseMove: 'volt-tackle' },
    pose: { name: 'Pika Leap', inputs: ['down', 'up', 'cross'], window: 2.0 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/pika_cheer' },
      { at: 1.0, camera: 'orbit-slow', vfx: 'z/pika_charge', sfx: 'cry/pikachu_charged' },
      { at: 2.2, camera: 'sky-wide', vfx: 'z/pika_leap', timeScale: 0.5 },
      { at: 3.0, camera: 'impact-shake', vfx: 'z/pika_impact', sfx: 'z/thunder_strike', shake: 1.0, timeScale: 0.2 },
      { at: 4.4, camera: 'aftermath-drift', vfx: 'z/arc_residue' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 7, duration: -1 },
      { surface: 'sand', effect: 'vitrify', radius: 6, duration: -1 },
    ],
    description: 'Pikachu wraps itself in every volt it has and becomes the projectile.',
  },
  {
    id: 'searing-sunraze-smash', name: 'Searing Sunraze Smash', type: 'steel',
    crystal: 'solganium-z', power: 200, category: 'physical',
    exclusiveTo: { species: 'SOLGALEO', baseMove: 'sunsteel-strike' },
    pose: { name: 'Sunrise', inputs: ['down', 'right', 'up', 'cross'], window: 2.8 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/solar_hum' },
      { at: 1.5, camera: 'low-hero', vfx: 'z/sun_corona', sfx: 'cry/solgaleo_roar', shake: 0.5 },
      { at: 3.0, camera: 'sky-wide', vfx: 'z/sun_form', timeScale: 0.5 },
      { at: 4.2, camera: 'impact-shake', vfx: 'z/sunraze_charge', sfx: 'z/solar_impact', shake: 1.0, timeScale: 0.2 },
      { at: 5.8, camera: 'aftermath-drift', vfx: 'z/light_bloom' },
    ],
    environment: [
      { surface: 'any', effect: 'scorch', radius: 30, duration: -1 },
      { surface: 'ground', effect: 'crater', radius: 18, duration: -1 },
    ],
    description: 'Solgaleo becomes a small sun and runs the target down.',
  },
  {
    id: 'menacing-moonraze-maelstrom', name: 'Menacing Moonraze Maelstrom', type: 'ghost',
    crystal: 'lunalium-z', power: 200, category: 'special',
    exclusiveTo: { species: 'LUNALA', baseMove: 'moongeist-beam' },
    pose: { name: 'Moonrise', inputs: ['up', 'left', 'down', 'circle'], window: 2.8 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/lunar_hum' },
      { at: 1.5, camera: 'sky-wide', vfx: 'z/moon_rise', sfx: 'cry/lunala_call', timeScale: 0.7 },
      { at: 3.2, camera: 'orbit-slow', vfx: 'z/moon_gather', shake: 0.3 },
      { at: 4.4, camera: 'impact-shake', vfx: 'z/moonraze_beam', sfx: 'z/lunar_impact', shake: 0.9, timeScale: 0.2 },
      { at: 6.0, camera: 'aftermath-drift', vfx: 'z/star_drift' },
    ],
    environment: [
      { surface: 'any', effect: 'flatten', radius: 26, duration: 60 },
    ],
    description: 'Lunala draws down the moon itself and lets it fall.',
  },
  {
    id: 'guardian-of-alola', name: 'Guardian of Alola', type: 'fairy',
    crystal: 'tapunium-z', power: null, category: 'special',
    exclusiveTo: { species: 'TAPU_KOKO', baseMove: 'nature-s-madness' },
    statusEffect: 'reduces the target to 25% of its current HP',
    pose: { name: 'Island Salute', inputs: ['left', 'up', 'right', 'circle'], window: 2.6 },
    beats: [
      { at: 0.0, camera: 'pose-closeup', sfx: 'z/tapu_chant' },
      { at: 1.6, camera: 'sky-wide', vfx: 'z/island_spirit', sfx: 'z/drums', timeScale: 0.8 },
      { at: 3.4, camera: 'low-hero', vfx: 'z/guardian_form', shake: 0.6 },
      { at: 4.6, camera: 'impact-shake', vfx: 'z/guardian_stomp', sfx: 'z/impact_ritual', shake: 1.0, timeScale: 0.25 },
      { at: 6.0, camera: 'aftermath-drift', vfx: 'z/spirit_dissipate' },
    ],
    environment: [
      { surface: 'ground', effect: 'crater', radius: 22, duration: -1 },
      { surface: 'foliage', effect: 'flatten', radius: 28, duration: 90 },
    ],
    description: 'The island itself takes shape and brings its weight down on the target.',
  },
];

const byId = new Map(ZMOVE_LIST.map((z) => [z.id, z]));
const byCrystal = new Map(ZMOVE_LIST.map((z) => [z.crystal, z]));

export function getZMove(id: string): ZMoveDefinition {
  const z = byId.get(id);
  if (!z) throw new Error(`Unknown Z-Move "${id}".`);
  return z;
}

export function zMoveForCrystal(crystal: string): ZMoveDefinition | undefined {
  return byCrystal.get(crystal);
}

/** Total cinematic length — the battle engine holds input for this long. */
export function zMoveDuration(z: ZMoveDefinition): number {
  let last = 0;
  for (const b of z.beats) if (b.at > last) last = b.at;
  return last + 1.5; // Tail time after the final beat.
}

export function allZMoves(): readonly ZMoveDefinition[] {
  return ZMOVE_LIST;
}
