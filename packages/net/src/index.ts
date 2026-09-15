/** @alola/net — server-authoritative netcode with client prediction. */
export {
  PROTOCOL_VERSION, DeltaField, EntityFlag, InputAction,
} from './protocol/messages.ts';
export type {
  ClientMessage, ServerMessage, EntityDelta, InputCommand,
} from './protocol/messages.ts';
export { InterestManager, DEFAULT_BANDS } from './server/interest.ts';
export type { NetEntity, InterestBand, ClientInterest, InterestResult } from './server/interest.ts';
export {
  ClientPrediction, EntityInterpolator, LatencyTracker,
} from './client/prediction.ts';
export type {
  PredictedState, MovementSimulator, PredictionOptions, RemoteSnapshot,
} from './client/prediction.ts';
