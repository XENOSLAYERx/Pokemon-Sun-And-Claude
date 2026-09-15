/**
 * Perception.
 *
 * Answers "what does this Pokémon currently know about?" using sight, hearing
 * and a threat assessment. Runs on the spatial hash so it is O(neighbours),
 * not O(world).
 *
 * Two design points worth stating:
 *
 * 1. **Perception is imperfect and that is the point.** Sight is cone-limited
 *    and occluded by distance; hearing is omnidirectional but coarse. A player
 *    can therefore approach from behind, and stealth becomes a real mechanic
 *    rather than a stat check.
 *
 * 2. **Perception runs at a lower rate than movement.** Re-evaluating every
 *    agent's senses at 60Hz is wasteful — animals do not re-assess the world
 *    sixty times a second either. Agents perceive on a stagger, which also
 *    spreads the cost evenly across frames instead of spiking.
 */
import { V3, clamp01, type Vec3, type SpatialHash } from '@alola/core';
import type { SpeciesRuntime } from '@alola/data';

export type PerceivedKind = 'player' | 'pokemon' | 'threat' | 'prey' | 'packmate' | 'item';

export interface PerceivableAgent {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  readonly speciesId: string;
  /** Pack identifier, or -1. */
  readonly packId: number;
  /** Player id when this is a player, otherwise null. */
  readonly playerId: string | null;
  /** Loudness of what it is currently doing, 0–1. Running is loud; crouching is not. */
  readonly noise: number;
  /** Is it currently fainted/inactive? */
  readonly inactive: boolean;
  readonly level: number;
}

export interface Percept {
  readonly agent: PerceivableAgent;
  readonly kind: PerceivedKind;
  /** Distance in metres. */
  readonly distance: number;
  /** How clearly it is perceived, 0–1. Feeds confidence-weighted decisions. */
  readonly clarity: number;
  /** Was it seen (vs merely heard)? Determines whether the agent knows *what* it is. */
  readonly seen: boolean;
  /** Threat level this agent poses to the perceiver, 0–1. */
  readonly threat: number;
}

export interface PerceptionResult {
  readonly percepts: Percept[];
  /** Highest-threat percept, or null. */
  readonly nearestThreat: Percept | null;
  /** Closest valid prey, or null. */
  readonly nearestPrey: Percept | null;
  /** Closest pack-mate, or null. */
  readonly nearestPackmate: Percept | null;
  /** Closest player, or null. */
  readonly nearestPlayer: Percept | null;
  /** Count of pack-mates within cohesion range. */
  readonly packCount: number;
}

const EMPTY_RESULT: PerceptionResult = {
  percepts: [],
  nearestThreat: null,
  nearestPrey: null,
  nearestPackmate: null,
  nearestPlayer: null,
  packCount: 0,
};

export interface PerceiveOptions {
  /** Species of the perceiving agent. */
  readonly species: SpeciesRuntime;
  /** Perceiver's position. */
  readonly position: Readonly<Vec3>;
  /** Perceiver's facing, radians. */
  readonly yaw: number;
  /** Perceiver's pack id, or -1. */
  readonly packId: number;
  /** Perceiver's level — used for threat scaling. */
  readonly level: number;
  /** Species ids this agent treats as predators. */
  readonly predators: readonly string[];
  /** Species ids this agent hunts. */
  readonly prey: readonly string[];
  /** Ambient conditions that degrade the senses. */
  readonly visibilityScale?: number;
  /** Is the perceiver asleep? Sight is disabled; hearing is halved. */
  readonly asleep?: boolean;
}

/** Reusable scratch array so perception does not allocate per agent per tick. */
const scratch: PerceivableAgent[] = [];

export function perceive(
  grid: SpatialHash<PerceivableAgent>,
  opts: PerceiveOptions,
  selfId: number,
): PerceptionResult {
  const { species, position, yaw, packId, level } = opts;
  const visibility = opts.visibilityScale ?? 1;
  const asleep = opts.asleep ?? false;

  const sightRange = asleep ? 0 : species.sightRange * visibility;
  const hearingRange = species.hearingRange * (asleep ? 0.5 : 1);
  const maxRange = Math.max(sightRange, hearingRange);
  if (maxRange <= 0) return EMPTY_RESULT;

  scratch.length = 0;
  grid.queryRadius(position, maxRange, scratch);
  if (scratch.length === 0) return EMPTY_RESULT;

  const predatorSet = new Set(opts.predators);
  const preySet = new Set(opts.prey);

  // Facing vector for the FOV test.
  const facingX = Math.sin(yaw);
  const facingZ = -Math.cos(yaw);

  const percepts: Percept[] = [];
  let nearestThreat: Percept | null = null;
  let nearestPrey: Percept | null = null;
  let nearestPackmate: Percept | null = null;
  let nearestPlayer: Percept | null = null;
  let packCount = 0;

  for (let i = 0; i < scratch.length; i++) {
    const other = scratch[i];
    if (other.id === selfId || other.inactive) continue;

    const dx = other.position.x - position.x;
    const dz = other.position.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-4) continue;

    // --- Sight: within range AND within the field of view.
    let seen = false;
    let clarity = 0;
    if (distance <= sightRange) {
      const dirX = dx / distance;
      const dirZ = dz / distance;
      const dot = dirX * facingX + dirZ * facingZ;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle <= species.fovHalfAngle) {
        seen = true;
        // Clarity falls off with distance and toward the edge of vision.
        const rangeFactor = 1 - distance / sightRange;
        const angleFactor = 1 - (angle / species.fovHalfAngle) * 0.45;
        clarity = clamp01(rangeFactor * angleFactor);
      }
    }

    // --- Hearing: omnidirectional, scaled by how much noise the target makes.
    if (!seen && distance <= hearingRange) {
      const audible = hearingRange * (0.25 + other.noise * 0.75);
      if (distance <= audible) {
        // Heard but not seen: low clarity, and the agent does not reliably
        // know what it is — which is what makes rustling grass tense.
        clarity = clamp01((1 - distance / audible) * 0.45);
      }
    }

    if (clarity <= 0.01) continue;

    // --- Classify.
    let kind: PerceivedKind = 'pokemon';
    let threat = 0;

    if (other.playerId !== null) {
      kind = 'player';
      // The player is a threat proportional to how outmatched the agent is.
      threat = clamp01(0.3 + (other.level - level) / 40);
    } else if (predatorSet.has(other.speciesId)) {
      kind = 'threat';
      threat = clamp01(0.6 + (other.level - level) / 30);
    } else if (preySet.has(other.speciesId)) {
      kind = 'prey';
    } else if (packId >= 0 && other.packId === packId) {
      kind = 'packmate';
      packCount++;
    } else if (other.level > level + 12) {
      // Anything substantially stronger reads as dangerous even if it is not a
      // designated predator — which is why a wild Bewear clears a route.
      threat = clamp01((other.level - level) / 45);
    }

    // Unseen things are more frightening, not less: threat is inflated when
    // the agent can hear but not see the source.
    if (!seen && threat > 0) threat = clamp01(threat * 1.25);

    const percept: Percept = { agent: other, kind, distance, clarity, seen, threat };
    percepts.push(percept);

    if (threat > 0 && (nearestThreat === null || threat > nearestThreat.threat)) {
      nearestThreat = percept;
    }
    if (kind === 'prey' && (nearestPrey === null || distance < nearestPrey.distance)) {
      nearestPrey = percept;
    }
    if (kind === 'packmate' && (nearestPackmate === null || distance < nearestPackmate.distance)) {
      nearestPackmate = percept;
    }
    if (kind === 'player' && (nearestPlayer === null || distance < nearestPlayer.distance)) {
      nearestPlayer = percept;
    }
  }

  return { percepts, nearestThreat, nearestPrey, nearestPackmate, nearestPlayer, packCount };
}

/**
 * Can `observer` see `target`? A direct query used by stealth, trial puzzles
 * and the "has the trainer spotted you" check.
 */
export function canSee(
  observerPos: Readonly<Vec3>,
  observerYaw: number,
  species: SpeciesRuntime,
  targetPos: Readonly<Vec3>,
  visibilityScale = 1,
): boolean {
  const distSq = V3.distanceFlatSq(observerPos, targetPos);
  const range = species.sightRange * visibilityScale;
  if (distSq > range * range) return false;

  const dist = Math.sqrt(distSq);
  if (dist < 1e-4) return true;

  const dirX = (targetPos.x - observerPos.x) / dist;
  const dirZ = (targetPos.z - observerPos.z) / dist;
  const facingX = Math.sin(observerYaw);
  const facingZ = -Math.cos(observerYaw);
  const dot = dirX * facingX + dirZ * facingZ;
  return Math.acos(Math.max(-1, Math.min(1, dot))) <= species.fovHalfAngle;
}

/** Visibility multiplier from weather and time of day. */
export function visibilityFrom(fogDensity: number, daylight: number, isNocturnal: boolean): number {
  // Fog is the dominant term; darkness matters much less to a nocturnal species.
  const fogPenalty = 1 / (1 + fogDensity * 0.55);
  const darkness = 1 - daylight;
  const darkPenalty = isNocturnal ? 1 - darkness * 0.1 : 1 - darkness * 0.55;
  return clamp01(fogPenalty * darkPenalty);
}
