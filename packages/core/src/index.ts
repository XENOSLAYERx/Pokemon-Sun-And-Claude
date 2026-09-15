/**
 * @alola/core — deterministic, dependency-free simulation foundation.
 *
 * Nothing in this package may import a rendering, DOM or Node API. That rule is
 * what lets the entire simulation run inside a Web Worker, on a headless
 * server, and inside the test runner without a browser.
 */

// Math
export * as V3 from './math/vec3.ts';
export type { Vec3 } from './math/vec3.ts';
export { vec3, V3_ZERO, V3_UP, V3_FORWARD, V3_RIGHT } from './math/vec3.ts';
export * as Scalar from './math/scalar.ts';
export {
  clamp,
  clamp01,
  lerp,
  invLerp,
  remap,
  smoothstep,
  smootherstep,
  mod,
  angleDelta,
  rotateTowards,
  moveTowards,
  damp,
  DEG2RAD,
  RAD2DEG,
  TAU,
} from './math/scalar.ts';

// Randomness & noise
export { Rng, hash32, hashCombine, hashString, noiseAt, rngForCell } from './util/rng.ts';
export type { RngState } from './util/rng.ts';
export {
  SimplexNoise,
  fbm2D,
  fbm3D,
  ridged2D,
  billow2D,
  warpedFbm2D,
  worley2D,
} from './util/noise.ts';
export type { FbmOptions } from './util/noise.ts';

// ECS
export {
  World,
  defineComponent,
  getComponentByName,
  entityIndex,
  entityGeneration,
  NULL_ENTITY,
} from './ecs/world.ts';
export type { Entity, ComponentType, QueryDescriptor } from './ecs/world.ts';
export { Scheduler, Phase, PHASE_ORDER, PHASE_NAMES } from './ecs/scheduler.ts';
export type { SystemDefinition, SystemContext, SystemTiming } from './ecs/scheduler.ts';
export * from './ecs/components.ts';

// Events
export { EventBus, defineEvent } from './events/bus.ts';
export type { EventType, EventHandler, Unsubscribe } from './events/bus.ts';

// Time
export { FixedClock, Interval, Timer } from './time/clock.ts';
export type { ClockOptions } from './time/clock.ts';

// Spatial
export { SpatialHash } from './spatial/hash.ts';
export type { SpatialItem } from './spatial/hash.ts';

// State & utility
export { StateMachine } from './fsm/state-machine.ts';
export type { StateDefinition, TransitionDefinition } from './fsm/state-machine.ts';
export { Blackboard, defineKey } from './util/blackboard.ts';
export type { BlackboardKey } from './util/blackboard.ts';
export { Pool, RingBuffer } from './util/pool.ts';
