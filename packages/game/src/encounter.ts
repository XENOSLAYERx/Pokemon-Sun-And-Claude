/**
 * Encounters.
 *
 * There are no random encounters. A battle starts because the player chose to
 * engage something they can see, or because something that hunts them decided
 * to engage first. Both paths come through here.
 */
import { getSpecies } from '@alola/data';

/** The minimum a wild Pokémon's overworld state must expose to be engaged. */
export interface EncounterCandidate {
  readonly id: number;
  readonly speciesId: string;
  readonly level: number;
  readonly position: { x: number; y: number; z: number };
  /** What the AI is currently doing. Drives whether it can be approached. */
  readonly goal: string | null;
  readonly fainted?: boolean;
}

/** How close the player must be to engage on foot. */
export const ENGAGE_RANGE = 9;

/** Aggressive species engage on their own from further out. */
export const AGGRO_RANGE = 14;

export type EncounterReason = 'player-engaged' | 'ambushed';

export interface EncounterOffer {
  readonly candidate: EncounterCandidate;
  readonly distance: number;
  readonly reason: EncounterReason;
}

function distanceTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * The nearest Pokémon the player could engage right now, or null.
 *
 * Sleeping and fleeing Pokémon are excluded deliberately. Letting the player
 * pull a battle out of something that is asleep or already running removes the
 * point of the overworld behaviour — the AI state should decide whether an
 * approach is possible, not just proximity.
 */
export function engageableTarget(
  playerPosition: { x: number; z: number },
  candidates: readonly EncounterCandidate[],
): EncounterOffer | null {
  let best: EncounterOffer | null = null;

  for (const candidate of candidates) {
    if (candidate.fainted) continue;
    if (candidate.goal === 'flee' || candidate.goal === 'sleep' || candidate.goal === 'rest') continue;

    const distance = distanceTo(playerPosition, candidate.position);
    if (distance > ENGAGE_RANGE) continue;
    if (best === null || distance < best.distance) {
      best = { candidate, distance, reason: 'player-engaged' };
    }
  }

  return best;
}

/**
 * Has anything decided to attack the player?
 *
 * Only species whose temperament actually justifies it: an apex predator or an
 * aggressive one, and only when its AI is genuinely pursuing or attacking. A
 * Bewear that has noticed the player and is closing is an ambush; a Bewear
 * wandering past at the same distance is not.
 */
export function ambusher(
  playerPosition: { x: number; z: number },
  candidates: readonly EncounterCandidate[],
): EncounterOffer | null {
  let best: EncounterOffer | null = null;

  for (const candidate of candidates) {
    if (candidate.fainted) continue;
    if (candidate.goal !== 'attack' && candidate.goal !== 'pursue' && candidate.goal !== 'hunt') continue;

    // `protective` belongs here alongside the obvious ones: Bewear is peaceful
    // until it decides you are a threat, and at that point it is the most
    // dangerous thing on Melemele.
    const temperament = getSpecies(candidate.speciesId).temperament;
    if (
      temperament !== 'aggressive' && temperament !== 'apex' &&
      temperament !== 'territorial' && temperament !== 'protective'
    ) continue;

    const distance = distanceTo(playerPosition, candidate.position);
    if (distance > AGGRO_RANGE) continue;
    if (best === null || distance < best.distance) {
      best = { candidate, distance, reason: 'ambushed' };
    }
  }

  return best;
}

/**
 * Can the player run from this?
 *
 * Fleeing a wild battle is normally free. It is not free from an apex
 * predator that started the fight — that is the entire point of meeting one.
 */
export function canFleeFrom(offer: EncounterOffer): boolean {
  if (offer.reason !== 'ambushed') return true;
  const temperament = getSpecies(offer.candidate.speciesId).temperament;
  // An apex predator and a provoked Bewear are the two things you do not
  // outrun. Everything else, including an aggressive Sharpedo, you can.
  return temperament !== 'apex' && temperament !== 'protective';
}
