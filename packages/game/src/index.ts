/**
 * @alola/game — the rules of play.
 *
 * Everything between the simulation packages and the client: what the player
 * owns, how an encounter becomes a battle, how a capture resolves, how a save
 * round-trips. Headless and fully testable, like everything below the
 * presentation boundary — the client renders this, it does not own it.
 */
export { movesetFor, powerCapForLevel, totalPp } from './moveset.ts';

export {
  createPokemon, maxHpOf, isFainted, healFully, healBy, awardExp, expYield, starterLevelFor,
  expForLevel, levelForExp, toBattlePokemon, applyBattleResult, toSaved, fromSaved,
  reserveUid, resetUidCounter,
} from './party.ts';
export type { PartyPokemon, LevelUpResult } from './party.ts';

export { Bag } from './bag.ts';

export {
  attemptCapture, ballMultiplierFor, statusMultiplierFor,
} from './capture.ts';
export type { CaptureAttempt } from './capture.ts';

export {
  engageableTarget, ambusher, canFleeFrom, ENGAGE_RANGE, AGGRO_RANGE,
} from './encounter.ts';
export type { EncounterCandidate, EncounterOffer, EncounterReason } from './encounter.ts';

export { GameProfile, islandNameFor, MAX_PARTY } from './profile.ts';
export type { GameProfileOptions, DexEntry } from './profile.ts';

export { BattleSession } from './session.ts';
export type {
  BattleSessionOptions, BattleOutcome, TurnResult, PlayerChoice,
} from './session.ts';
