/**
 * Species definition schema.
 *
 * This is the single source of truth that drives battle stats, overworld AI,
 * animation rigs, spawn eligibility and audio. Keeping them in one record
 * rather than parallel tables is deliberate: a designer adding a Pokémon
 * should not have to remember to touch six files, and the content validator
 * can check the whole thing at once.
 */
import type { PokemonType } from '../types.ts';

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export type EggGroup =
  | 'monster' | 'water1' | 'water2' | 'water3' | 'bug' | 'flying' | 'field'
  | 'fairy' | 'grass' | 'humanlike' | 'mineral' | 'amorphous' | 'ditto'
  | 'dragon' | 'undiscovered';

/**
 * How a species moves through the world. Drives navmesh queries, spawn
 * placement and which ride interactions are legal.
 */
export type MovementClass =
  | 'walker'      // Standard ground traversal.
  | 'runner'      // Fast ground, flees readily.
  | 'hopper'      // Discrete hops; poor at slopes.
  | 'flyer'       // Free 3D movement, ignores terrain.
  | 'hoverer'     // Stays near ground but ignores slope.
  | 'swimmer'     // Water only.
  | 'amphibious'  // Land and water.
  | 'burrower'    // Submerges into sand/soil; ambushes.
  | 'climber'     // Traverses cliff faces.
  | 'floater';    // Drifts, wind-affected.

/** Broad behavioural archetype. The AI profile registry keys off this. */
export type TemperamentClass =
  | 'timid'       // Flees on sight. Most early-route prey.
  | 'skittish'    // Wary; flees when approached too fast.
  | 'curious'     // Approaches the player. Pikachu, Rowlet.
  | 'playful'     // Seeks interaction, chases thrown items.
  | 'docile'      // Ignores the player entirely. Lapras, Miltank.
  | 'territorial' // Attacks when its territory is entered. Growlithe.
  | 'aggressive'  // Attacks on sight. Sharpedo, Salandit.
  | 'apex'        // Attacks and pursues relentlessly. Bewear, Guzzlord.
  | 'protective'  // Peaceful until young/pack are threatened.
  | 'nocturnal';  // Passive by day, active and bold at night.

export interface SpeciesDefinition {
  /** Stable uppercase identifier. Never renamed — save files reference it. */
  readonly id: string;
  /** National Pokédex number. */
  readonly dex: number;
  /** Alola regional dex number, or 0 if not in the regional dex. */
  readonly alolaDex: number;
  readonly name: string;
  readonly types: readonly [PokemonType] | readonly [PokemonType, PokemonType];
  readonly baseStats: BaseStats;
  readonly abilities: readonly string[];
  readonly hiddenAbility?: string;

  /** Metres. Drives collider size, camera framing and ride eligibility. */
  readonly height: number;
  /** Kilograms. Feeds weight-based moves and terrain deformation. */
  readonly weight: number;

  readonly catchRate: number;
  readonly baseExp: number;
  readonly growthRate: 'fast' | 'medium-fast' | 'medium-slow' | 'slow' | 'erratic' | 'fluctuating';
  readonly eggGroups: readonly EggGroup[];
  /** Probability of being male, or null for genderless. */
  readonly genderRatio: number | null;

  // ----- Overworld simulation -----
  readonly movement: MovementClass;
  readonly temperament: TemperamentClass;
  /** Base overworld movement speed in m/s. */
  readonly moveSpeed: number;
  /** How far it can notice things, in metres. */
  readonly sightRange: number;
  /** Hearing radius, in metres. Usually exceeds sight in dense foliage. */
  readonly hearingRange: number;
  /** Field-of-view half-angle in radians. Prey species have very wide FOV. */
  readonly fovHalfAngle: number;
  /** Radius of its home territory in metres; 0 = nomadic. */
  readonly territoryRadius: number;
  /** Preferred group size when spawning. 1 = solitary. */
  readonly packSize: readonly [number, number];
  /** Species it hunts, by id. Drives the predator-prey ecosystem. */
  readonly preysOn: readonly string[];
  /** Hours (0–23) it is awake. Empty = always awake. */
  readonly activeHours: readonly number[];
  /** Can a player ride it, and in what role? */
  readonly rideRole?: 'land' | 'water' | 'air' | 'terrain' | 'search' | 'demolition';

  // ----- Presentation -----
  /** Animation rig family — shared skeletons let us reuse animation sets. */
  readonly rig: string;
  /** Cry asset id. */
  readonly cry: string;
  /** Scale multiplier applied to the shared rig. */
  readonly modelScale: number;

  readonly flavorText: string;
}

/** Runtime-computed convenience data, derived once at registry build time. */
export interface SpeciesRuntime extends SpeciesDefinition {
  readonly statTotal: number;
  /** Cached so the AI does not recompute it per perception tick. */
  readonly sightRangeSq: number;
  readonly hearingRangeSq: number;
  readonly isNocturnal: boolean;
}

export function makeRuntime(def: SpeciesDefinition): SpeciesRuntime {
  const s = def.baseStats;
  return {
    ...def,
    statTotal: s.hp + s.atk + s.def + s.spa + s.spd + s.spe,
    sightRangeSq: def.sightRange * def.sightRange,
    hearingRangeSq: def.hearingRange * def.hearingRange,
    isNocturnal: def.temperament === 'nocturnal',
  };
}
