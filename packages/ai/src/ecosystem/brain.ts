/**
 * The agent brain — where perception, needs, memory, utility and steering meet.
 *
 * One `PokemonBrain` per simulated wild Pokémon. The update is split by
 * simulation LOD so that ten thousand agents can exist while only the few
 * hundred near the player pay full cost:
 *
 *   Full     — perceive, decide, steer, every tick.
 *   Reduced  — perceive and decide on a stagger; steering simplified.
 *   Coarse   — no perception; drift toward a goal position on a slow tick.
 *   Dormant  — nothing. Position is extrapolated only when it re-enters range.
 *
 * The staggering is as important as the LOD itself: without it, every agent
 * at a given LOD re-decides on the same tick and the frame spikes. Each agent
 * carries a tick offset derived from its id, spreading the work evenly.
 */
import {
  V3, vec3, Rng, clamp01, invLerp, rotateTowards, type Vec3, type SpatialHash,
} from '@alola/core';
import { getSpecies, predatorsFor, type SpeciesRuntime } from '@alola/data';
import { perceive, type PerceivableAgent, type PerceptionResult } from '../perception/senses.ts';
import {
  createNeeds, needsConfigFor, updateNeeds, applyFear, applyAggression,
  type Needs, type NeedsConfig,
} from '../memory/needs.ts';
import { AgentMemory, dispositionFor, type Disposition } from '../memory/memory.ts';
import { selectGoal, emptyFacts, type UtilityFacts, type ScoredGoal } from '../utility/scorer.ts';
import { biasedGoalsFor, profileFor, type AiProfile } from '../profiles/profiles.ts';
import {
  flock, seek, flee as fleeFrom, arrive, pursue, evade, wander, containWithin,
  combineSteering, type Boid, type WanderState,
} from '../flock/boids.ts';

export const BrainLod = {
  Full: 0,
  Reduced: 1,
  Coarse: 2,
  Dormant: 3,
} as const;
export type BrainLod = (typeof BrainLod)[keyof typeof BrainLod];

export interface BrainWorldView {
  /** Current in-game hour, 0–24. */
  hour: number;
  /** 0–1 daylight. */
  daylight: number;
  /** Visibility multiplier from weather. */
  visibility: number;
  /** Simulation time in seconds. */
  now: number;
  /** Spatial index of everything perceivable. */
  grid: SpatialHash<PerceivableAgent>;
  /** Ground height query, for keeping land agents on the terrain. */
  groundAt: (x: number, z: number) => number;
}

export interface BrainState {
  readonly id: number;
  readonly speciesId: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  /** Where this agent considers home. Territory is centred here. */
  home: Vec3;
  packId: number;
  level: number;
  health: number;
  maxHealth: number;
  lod: BrainLod;
}

const _steer = vec3();
const _force = vec3();
const _flockForce = vec3();
const _containForce = vec3();
const _desired = vec3();

export class PokemonBrain {
  readonly state: BrainState;
  readonly species: SpeciesRuntime;
  readonly profile: AiProfile;
  readonly needs: Needs;
  readonly memory: AgentMemory;

  private readonly needsConfig: NeedsConfig;
  private readonly goals: ReturnType<typeof biasedGoalsFor>;
  private readonly predators: readonly string[];
  private readonly rng: Rng;
  private readonly wanderState: WanderState;
  /** Stagger offset so agents do not all decide on the same tick. */
  private readonly tickOffset: number;

  /** Currently selected goal. */
  currentGoal: string | null = null;
  lastScore = 0;
  /** Seconds since the last full decision. */
  private sinceDecision = 0;
  /** Cached perception, refreshed on the decision cadence. */
  private lastPerception: PerceptionResult | null = null;
  /** Current movement target, if the active goal has one. */
  private target: Vec3 | null = null;
  /** Entity the agent is pursuing or fleeing. */
  private focusId = -1;
  /** Is the agent asleep? */
  asleep = false;
  /** Debug: the full scored list, populated only when inspection is on. */
  debugScores: ScoredGoal[] = [];

  constructor(state: BrainState, seed: number) {
    this.state = state;
    this.species = getSpecies(state.speciesId);
    this.profile = profileFor(state.speciesId);
    this.needsConfig = needsConfigFor(this.species);
    this.goals = biasedGoalsFor(state.speciesId);
    this.predators = predatorsFor(state.speciesId);
    this.rng = new Rng(seed ^ state.id);
    this.needs = createNeeds(() => this.rng.next());
    this.memory = new AgentMemory();
    this.wanderState = { angle: this.rng.yaw() };
    this.tickOffset = this.rng.next() * this.profile.decisionInterval;
    this.sinceDecision = this.tickOffset;
  }

  /** Main entry point, called by the AI system each simulation tick. */
  update(dt: number, world: BrainWorldView): void {
    switch (this.state.lod) {
      case BrainLod.Full:
        this.updateFull(dt, world);
        break;
      case BrainLod.Reduced:
        this.updateReduced(dt, world);
        break;
      case BrainLod.Coarse:
        this.updateCoarse(dt, world);
        break;
      case BrainLod.Dormant:
        // Nothing. Needs do not even advance — a dormant agent is conceptually
        // paused, and advancing its hunger for the twenty minutes the player
        // was on another island would have every distant Pokémon starving.
        break;
    }
  }

  private updateFull(dt: number, world: BrainWorldView): void {
    this.sinceDecision += dt;

    if (this.sinceDecision >= this.profile.decisionInterval) {
      this.sinceDecision = 0;
      this.lastPerception = this.doPerceive(world);
      this.react(this.lastPerception, world);
      this.decide(world);
    }

    this.advanceNeeds(dt, world);
    this.steer(dt, world);
  }

  private updateReduced(dt: number, world: BrainWorldView): void {
    this.sinceDecision += dt;
    // Perceive and decide at a third of the rate.
    if (this.sinceDecision >= this.profile.decisionInterval * 3) {
      this.sinceDecision = 0;
      this.lastPerception = this.doPerceive(world);
      this.react(this.lastPerception, world);
      this.decide(world);
    }
    this.advanceNeeds(dt, world);
    this.steer(dt, world);
  }

  /**
   * Coarse: no perception at all. The agent drifts toward its home area on a
   * slow schedule. This is what keeps distant wildlife roughly where it should
   * be so that arriving in a region does not reveal every Pokémon frozen at
   * the position it held when the player left.
   */
  private updateCoarse(dt: number, world: BrainWorldView): void {
    this.sinceDecision += dt;
    if (this.sinceDecision < 2) return;
    const step = this.sinceDecision;
    this.sinceDecision = 0;

    this.advanceNeeds(step, world);

    // Meander around home at a fraction of walking speed.
    const homeDist = V3.distanceFlat(this.state.position, this.state.home);
    const territory = Math.max(20, this.species.territoryRadius);

    if (homeDist > territory) {
      seek(this.state.position, this.state.home, _desired);
    } else {
      this.wanderState.angle += (this.rng.next() * 2 - 1) * 0.8;
      V3.set(_desired, Math.cos(this.wanderState.angle), 0, Math.sin(this.wanderState.angle));
    }

    const speed = this.species.moveSpeed * 0.35;
    this.state.position.x += _desired.x * speed * step;
    this.state.position.z += _desired.z * speed * step;
    this.state.position.y = this.groundFor(world, this.state.position.x, this.state.position.z);
    this.state.yaw = V3.yawOf(_desired);
  }

  private doPerceive(world: BrainWorldView): PerceptionResult {
    return perceive(
      world.grid,
      {
        species: this.species,
        position: this.state.position,
        yaw: this.state.yaw,
        packId: this.state.packId,
        level: this.state.level,
        predators: this.predators,
        prey: this.species.preysOn,
        visibilityScale: world.visibility,
        asleep: this.asleep,
      },
      this.state.id,
    );
  }

  /** Convert perception into emotional response and memory. */
  private react(perception: PerceptionResult, world: BrainWorldView): void {
    const threat = perception.nearestThreat;

    if (threat) {
      // Fear scales with threat level, proximity and the species' sensitivity.
      const proximity = 1 - clamp01(threat.distance / this.species.sightRange);
      const intensity = clamp01(threat.threat * proximity * this.profile.fearSensitivity);

      // A remembered friend is not frightening, however strong they are.
      const subject = threat.agent.playerId ?? `sp:${threat.agent.speciesId}`;
      const affinity = this.memory.affinityToward(subject, world.now);
      const familiarity = this.memory.familiarityWith(subject, world.now);
      const disposition = dispositionFor(affinity, familiarity);

      if (disposition === 'bonded' || disposition === 'friendly') {
        // Trusted: no fear, and the sight is mildly reassuring.
        this.needs.fear = clamp01(this.needs.fear * 0.5);
      } else {
        applyFear(this.needs, intensity);
        if (disposition === 'hostile') {
          applyAggression(this.needs, clamp01(intensity * 0.8));
        }
      }

      // Territorial species get angry rather than scared inside their range.
      if (this.species.territoryRadius > 0) {
        const homeDist = V3.distanceFlat(this.state.position, this.state.home);
        if (homeDist < this.species.territoryRadius) {
          applyAggression(this.needs, clamp01((1 - homeDist / this.species.territoryRadius) * 0.7));
        }
      }

      this.asleep = false;
    }

    // Protective species react to threats against pack-mates, not just to
    // themselves — this is the Bewear/Stufful relationship.
    if (this.species.temperament === 'protective' && perception.nearestPackmate) {
      for (const p of perception.percepts) {
        if (p.threat > 0.3 && perception.nearestPackmate.distance < this.profile.cohesionRadius) {
          applyAggression(this.needs, clamp01(p.threat));
          this.asleep = false;
          break;
        }
      }
    }
  }

  private advanceNeeds(dt: number, world: BrainWorldView): void {
    const hour = world.hour;
    const isActiveHour =
      this.species.activeHours.length === 0 ||
      this.species.activeHours.includes(Math.floor(hour) % 24);

    const isMoving = V3.lengthSq(this.state.velocity) > 0.25;
    const isResting = this.currentGoal === 'rest' || this.currentGoal === 'sleep';

    updateNeeds(this.needs, this.needsConfig, dt, {
      isActiveHour,
      isResting,
      isMoving,
      hasThreat: this.lastPerception?.nearestThreat != null,
      packNearby: (this.lastPerception?.packCount ?? 0) > 0,
    });

    this.asleep = this.currentGoal === 'sleep';
  }

  /** Build the facts vector and pick a goal. */
  private decide(world: BrainWorldView): void {
    const facts = this.buildFacts(world);
    const chosen = selectGoal(this.goals, facts, this.currentGoal);

    if (chosen === null) {
      this.currentGoal = 'wander';
      this.lastScore = 0;
      return;
    }

    if (chosen.goal.name !== this.currentGoal) {
      this.currentGoal = chosen.goal.name;
      this.target = null;
      this.focusId = -1;
    }
    this.lastScore = chosen.score;

    this.resolveTarget(world);
  }

  private buildFacts(world: BrainWorldView): UtilityFacts {
    const facts = emptyFacts();
    const p = this.lastPerception;
    const sight = this.species.sightRange;

    facts.hunger = this.needs.hunger;
    facts.fatigue = this.needs.fatigue;
    facts.fear = this.needs.fear;
    facts.aggression = this.needs.aggression;
    facts.curiosity = this.needs.curiosity;
    facts.sociability = this.needs.sociability;
    facts.drowsiness = this.needs.drowsiness;

    if (p) {
      facts.threatDistance = p.nearestThreat ? clamp01(p.nearestThreat.distance / sight) : 1;
      facts.threatLevel = p.nearestThreat?.threat ?? 0;
      facts.preyDistance = p.nearestPrey ? clamp01(p.nearestPrey.distance / sight) : 1;
      facts.packmateDistance = p.nearestPackmate
        ? clamp01(p.nearestPackmate.distance / Math.max(1, this.profile.cohesionRadius))
        : 1;
      facts.playerDistance = p.nearestPlayer ? clamp01(p.nearestPlayer.distance / sight) : 1;
      facts.packCount = clamp01(p.packCount / 8);

      if (p.nearestPlayer?.agent.playerId) {
        const pid = p.nearestPlayer.agent.playerId;
        // Remap -1..1 affinity to 0..1 so curves can work with it directly.
        facts.playerAffinity = clamp01((this.memory.affinityToward(pid, world.now) + 1) / 2);
        facts.playerFamiliarity = this.memory.familiarityWith(pid, world.now);
      }
    }

    facts.healthFraction = this.state.maxHealth > 0 ? clamp01(this.state.health / this.state.maxHealth) : 1;

    const territory = this.species.territoryRadius;
    const homeDist = V3.distanceFlat(this.state.position, this.state.home);
    facts.inTerritory = territory > 0 ? clamp01(1 - homeDist / territory) : 0;
    facts.distanceFromHome = territory > 0 ? clamp01(homeDist / territory) : clamp01(homeDist / 200);

    facts.isActiveHour =
      this.species.activeHours.length === 0 ||
      this.species.activeHours.includes(Math.floor(world.hour) % 24)
        ? 1
        : 0;

    facts.hasTarget = this.target !== null ? 1 : 0;
    return facts;
  }

  /** Translate the chosen goal into a concrete movement target. */
  private resolveTarget(world: BrainWorldView): void {
    const p = this.lastPerception;

    switch (this.currentGoal) {
      case 'flee':
        this.focusId = p?.nearestThreat?.agent.id ?? -1;
        this.target = null;
        break;

      case 'attack':
      case 'defend-territory':
        this.focusId = (p?.nearestThreat ?? p?.nearestPlayer)?.agent.id ?? -1;
        this.target = null;
        break;

      case 'protect':
        this.focusId = p?.nearestThreat?.agent.id ?? -1;
        this.target = p?.nearestPackmate ? V3.clone(p.nearestPackmate.agent.position) : null;
        break;

      case 'hunt':
        this.focusId = p?.nearestPrey?.agent.id ?? -1;
        this.target = p?.nearestPrey ? V3.clone(p.nearestPrey.agent.position) : null;
        break;

      case 'greet':
      case 'investigate':
        this.focusId = p?.nearestPlayer?.agent.id ?? -1;
        this.target = p?.nearestPlayer ? V3.clone(p.nearestPlayer.agent.position) : null;
        break;

      case 'regroup':
        this.target = p?.nearestPackmate ? V3.clone(p.nearestPackmate.agent.position) : null;
        break;

      case 'return-home':
        this.target = V3.clone(this.state.home);
        break;

      case 'forage':
      case 'rest':
      case 'sleep':
        // Stay put; pick a nearby spot once.
        if (this.target === null) {
          const angle = this.rng.yaw();
          const r = this.rng.range(3, 12);
          this.target = vec3(
            this.state.position.x + Math.cos(angle) * r,
            0,
            this.state.position.z + Math.sin(angle) * r,
          );
          this.target.y = this.groundFor(world, this.target.x, this.target.z);
        }
        break;

      default:
        this.target = null;
        this.focusId = -1;
    }
  }

  /** Accumulate steering forces and integrate motion. */
  private steer(dt: number, world: BrainWorldView): void {
    const p = this.lastPerception;
    const forces: { force: Readonly<Vec3>; weight: number }[] = [];

    const speedScale = this.goalSpeedScale();
    const isFleeing = this.currentGoal === 'flee';
    const isChasing = this.currentGoal === 'hunt' || this.currentGoal === 'attack';

    // 1. Goal-directed force — highest priority.
    if (isFleeing && p?.nearestThreat) {
      const t = p.nearestThreat.agent;
      evade(this.state.position, t.position, vec3(), this.currentSpeed(), _force);
      forces.push({ force: V3.clone(_force), weight: 2.2 });
    } else if (isChasing && this.focusId >= 0 && this.target) {
      pursue(this.state.position, this.target, vec3(), this.currentSpeed(), _force);
      forces.push({ force: V3.clone(_force), weight: 1.8 });
    } else if (this.target) {
      arrive(this.state.position, this.target, 6, _force);
      forces.push({ force: V3.clone(_force), weight: 1.4 });
    } else if (this.currentGoal === 'wander' || this.currentGoal === 'play') {
      const forward = vec3(Math.sin(this.state.yaw), 0, -Math.cos(this.state.yaw));
      wander(forward, this.wanderState, 0.45, 2.5, 5, () => this.rng.next(), _force);
      forces.push({ force: V3.clone(_force), weight: 0.6 });
    }

    // 2. Flocking, for species that flock.
    if (this.profile.flockWeight > 0 && p && p.packCount > 0) {
      const neighbours: Boid[] = [];
      for (const percept of p.percepts) {
        if (percept.kind !== 'packmate') continue;
        neighbours.push({
          id: percept.agent.id,
          position: percept.agent.position,
          velocity: vec3(),
          packId: percept.agent.packId,
        });
      }
      if (neighbours.length > 0) {
        flock(
          {
            id: this.state.id,
            position: this.state.position,
            velocity: this.state.velocity,
            packId: this.state.packId,
          },
          neighbours,
          {
            separation: 1.4,
            alignment: 0.8,
            cohesion: 1.0,
            separationRadius: this.profile.separationRadius,
            cohesionRadius: this.profile.cohesionRadius,
          },
          _flockForce,
        );
        forces.push({ force: V3.clone(_flockForce), weight: this.profile.flockWeight });
      }
    }

    // 3. Territory containment — never for a fleeing agent, which must be
    //    allowed to run past its own boundary to survive.
    if (!isFleeing && this.species.territoryRadius > 0) {
      containWithin(this.state.position, this.state.home, this.species.territoryRadius, _containForce);
      forces.push({ force: V3.clone(_containForce), weight: 1.1 });
    }

    // 4. Avoid remembered bad places.
    const avoidance = this.memory.avoidanceAt(this.state.position.x, this.state.position.z, world.now);
    if (avoidance > 0.05 && p?.nearestThreat) {
      fleeFrom(this.state.position, p.nearestThreat.agent.position, _force);
      forces.push({ force: V3.clone(_force), weight: avoidance });
    }

    combineSteering(forces, 1, _steer);

    const steerLen = V3.length(_steer);
    if (steerLen < 1e-4) {
      // Decelerate to a stop.
      V3.scale(this.state.velocity, Math.max(0, 1 - dt * 4), this.state.velocity);
    } else {
      const desiredYaw = V3.yawOf(_steer);
      this.state.yaw = rotateTowards(this.state.yaw, desiredYaw, this.turnRate() * dt);

      const speed = this.species.moveSpeed * speedScale;
      const fwd = vec3(Math.sin(this.state.yaw), 0, -Math.cos(this.state.yaw));
      V3.scale(fwd, speed, _desired);
      // Accelerate toward the desired velocity rather than snapping to it.
      V3.lerp(this.state.velocity, _desired, Math.min(1, dt * 6), this.state.velocity);
    }

    V3.addScaled(this.state.position, this.state.velocity, dt, this.state.position);
    this.state.position.y = this.groundFor(world, this.state.position.x, this.state.position.z);
  }

  /** Ground height, adjusted for how this species occupies space. */
  private groundFor(world: BrainWorldView, x: number, z: number): number {
    const ground = world.groundAt(x, z);
    switch (this.species.movement) {
      case 'flyer':
        return ground + 14;
      case 'floater':
        return ground + 3;
      case 'swimmer':
        return Math.min(ground + 1, 0);
      default:
        return ground;
    }
  }

  /** Movement speed multiplier for the active goal. */
  private goalSpeedScale(): number {
    switch (this.currentGoal) {
      case 'flee':
        return 1.85;      // Sprint.
      case 'attack':
      case 'hunt':
        return 1.6;
      case 'protect':
      case 'defend-territory':
        return 1.4;
      case 'regroup':
      case 'return-home':
        return 1.1;
      case 'play':
        return 1.2;
      case 'investigate':
      case 'greet':
        return 0.75;      // Approach cautiously.
      case 'forage':
        return 0.4;
      case 'rest':
      case 'sleep':
        return 0.15;
      default:
        return 0.55;      // Idle amble.
    }
  }

  private turnRate(): number {
    // Fleeing and fighting sharpen turning; resting dulls it.
    const base = 3.2;
    if (this.currentGoal === 'flee') return base * 1.6;
    if (this.currentGoal === 'hunt' || this.currentGoal === 'attack') return base * 1.3;
    if (this.currentGoal === 'rest' || this.currentGoal === 'sleep') return base * 0.4;
    return base;
  }

  private currentSpeed(): number {
    return V3.length(this.state.velocity);
  }

  /** The disposition toward a subject — what dialogue and capture logic read. */
  dispositionToward(subject: string, now: number): Disposition {
    return dispositionFor(
      this.memory.affinityToward(subject, now),
      this.memory.familiarityWith(subject, now),
    );
  }

  /** Diagnostic snapshot for the AI inspector overlay. */
  inspect(): {
    species: string;
    goal: string | null;
    score: number;
    needs: Needs;
    lod: BrainLod;
    perceived: number;
    asleep: boolean;
  } {
    return {
      species: this.state.speciesId,
      goal: this.currentGoal,
      score: this.lastScore,
      needs: { ...this.needs },
      lod: this.state.lod,
      perceived: this.lastPerception?.percepts.length ?? 0,
      asleep: this.asleep,
    };
  }
}

/** LOD from distance to the nearest observer. */
export function lodForDistance(distance: number): BrainLod {
  if (distance < 60) return BrainLod.Full;
  if (distance < 180) return BrainLod.Reduced;
  if (distance < 500) return BrainLod.Coarse;
  return BrainLod.Dormant;
}

/** Normalised distance helper shared with the spawner. */
export function normalisedDistance(distance: number, range: number): number {
  return clamp01(invLerp(0, range, distance));
}
