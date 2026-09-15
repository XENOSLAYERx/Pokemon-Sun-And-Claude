/**
 * Memory and relationships.
 *
 * A Pokémon that reacts identically to a stranger and to the trainer who has
 * fed it twenty times is not alive. This system gives each individual a small,
 * bounded memory of episodes and a running relationship score per subject.
 *
 * Bounded is the operative word: with tens of thousands of simulated agents we
 * cannot afford unbounded per-agent history. Each agent keeps a fixed-size ring
 * of episodic memories and a small map of relationships, both of which decay.
 * What survives is exactly what should: strong impressions and repeated
 * contact.
 */
import { clamp, clamp01, RingBuffer } from '@alola/core';

export type MemoryKind =
  | 'fed'          // Received a berry or a curry.
  | 'befriended'   // Petted, played with, praised.
  | 'attacked'     // Was attacked by the subject.
  | 'fled-from'    // Fled the subject.
  | 'defeated'     // Was defeated by the subject in battle.
  | 'defeated-by-ally'
  | 'saw-capture'  // Watched the subject catch another Pokémon.
  | 'startled'     // Was startled by the subject's sudden approach.
  | 'hunted'       // The subject hunted it.
  | 'helped';      // The subject drove off a predator.

export interface MemoryEpisode {
  /** Who or what this memory is about. Player id, entity id or species id. */
  readonly subject: string;
  readonly kind: MemoryKind;
  /** Simulation time the memory formed. */
  readonly at: number;
  /** How strongly it landed, 0–1. Scales both impact and persistence. */
  readonly intensity: number;
  /** Where it happened — used for place-avoidance ("something bad happened here"). */
  readonly x: number;
  readonly z: number;
}

/**
 * Valence of each memory kind: how it shifts the relationship score.
 * Negative experiences are weighted more heavily than positive ones, which
 * matches how animals actually learn and, practically, means a player cannot
 * undo attacking a Pokémon with one berry.
 */
const MEMORY_VALENCE: Readonly<Record<MemoryKind, number>> = {
  fed: 0.22,
  befriended: 0.3,
  helped: 0.35,
  'saw-capture': -0.12,
  startled: -0.15,
  'fled-from': -0.08,
  attacked: -0.5,
  hunted: -0.6,
  defeated: -0.35,
  'defeated-by-ally': -0.2,
};

export interface Relationship {
  /** -1 (hostile) to +1 (bonded). */
  affinity: number;
  /** How well-known the subject is, 0–1. Gates whether affinity is trusted. */
  familiarity: number;
  /** Simulation time of the most recent interaction. */
  lastSeen: number;
  /** Total interactions, for the "this one remembers you" UI. */
  encounters: number;
}

export interface MemoryOptions {
  /** Episodic memories retained per agent. */
  readonly capacity?: number;
  /** Seconds before a memory's influence has halved. */
  readonly halfLife?: number;
  /** Max distinct subjects tracked. */
  readonly maxRelationships?: number;
}

export class AgentMemory {
  private readonly episodes: RingBuffer<MemoryEpisode>;
  private readonly relationships = new Map<string, Relationship>();
  private readonly halfLife: number;
  private readonly maxRelationships: number;

  /** Locations associated with strongly negative memories — places to avoid. */
  private avoidance: { x: number; z: number; weight: number; until: number }[] = [];

  constructor(opts: MemoryOptions = {}) {
    this.episodes = new RingBuffer<MemoryEpisode>(opts.capacity ?? 12);
    this.halfLife = opts.halfLife ?? 900;
    this.maxRelationships = opts.maxRelationships ?? 8;
  }

  /** Record an episode and update the relationship it implies. */
  remember(episode: MemoryEpisode): void {
    this.episodes.push(episode);

    let rel = this.relationships.get(episode.subject);
    if (!rel) {
      if (this.relationships.size >= this.maxRelationships) {
        this.forgetLeastRelevant(episode.at);
      }
      rel = { affinity: 0, familiarity: 0, lastSeen: episode.at, encounters: 0 };
      this.relationships.set(episode.subject, rel);
    }

    const valence = MEMORY_VALENCE[episode.kind] ?? 0;
    rel.affinity = clamp(rel.affinity + valence * episode.intensity, -1, 1);
    // Familiarity saturates: the 20th meeting teaches less than the 2nd.
    rel.familiarity = clamp01(rel.familiarity + (1 - rel.familiarity) * 0.18);
    rel.lastSeen = episode.at;
    rel.encounters++;

    // Strongly negative episodes mark the place as well as the subject.
    if (valence < -0.3 && episode.intensity > 0.5) {
      this.avoidance.push({
        x: episode.x,
        z: episode.z,
        weight: -valence * episode.intensity,
        until: episode.at + this.halfLife,
      });
      if (this.avoidance.length > 6) this.avoidance.shift();
    }
  }

  /** Drop the relationship that is stalest and weakest. */
  private forgetLeastRelevant(now: number): void {
    let worstKey: string | null = null;
    let worstScore = Infinity;
    for (const [key, rel] of this.relationships) {
      // Relevance = strength of feeling, decayed by time since last contact.
      const age = now - rel.lastSeen;
      const score = Math.abs(rel.affinity) * Math.pow(0.5, age / this.halfLife);
      if (score < worstScore) {
        worstScore = score;
        worstKey = key;
      }
    }
    if (worstKey !== null) this.relationships.delete(worstKey);
  }

  /**
   * Current affinity toward a subject, decayed by time.
   * Returns 0 for strangers — which is correct: no opinion, not a bad one.
   */
  affinityToward(subject: string, now: number): number {
    const rel = this.relationships.get(subject);
    if (!rel) return 0;
    const age = now - rel.lastSeen;
    const decay = Math.pow(0.5, age / (this.halfLife * 4));
    return rel.affinity * decay;
  }

  familiarityWith(subject: string, now: number): number {
    const rel = this.relationships.get(subject);
    if (!rel) return 0;
    const age = now - rel.lastSeen;
    return rel.familiarity * Math.pow(0.5, age / (this.halfLife * 6));
  }

  getRelationship(subject: string): Relationship | undefined {
    return this.relationships.get(subject);
  }

  /** Has this agent experienced a specific kind of event from a subject? */
  hasMemoryOf(subject: string, kind: MemoryKind): boolean {
    for (const ep of this.episodes) {
      if (ep.subject === subject && ep.kind === kind) return true;
    }
    return false;
  }

  /** Most recent episode, for the debug overlay and for dialogue hooks. */
  mostRecent(): MemoryEpisode | undefined {
    return this.episodes.get(0);
  }

  /**
   * Avoidance weight at a location: how much this agent wants to stay away.
   * Steering adds this as a repulsive force, which is how a Pokémon that was
   * attacked at a clearing starts giving that clearing a wide berth.
   */
  avoidanceAt(x: number, z: number, now: number, radius = 30): number {
    let total = 0;
    for (const a of this.avoidance) {
      if (now > a.until) continue;
      const d = Math.hypot(x - a.x, z - a.z);
      if (d > radius) continue;
      total += a.weight * (1 - d / radius);
    }
    return clamp01(total);
  }

  /** Drop expired avoidance markers. Called on the slow AI tick. */
  prune(now: number): void {
    if (this.avoidance.length === 0) return;
    this.avoidance = this.avoidance.filter((a) => now <= a.until);
  }

  get relationshipCount(): number {
    return this.relationships.size;
  }

  get episodeCount(): number {
    return this.episodes.size;
  }

  /** Compact save form. Only relationships persist; episodes are ephemeral. */
  save(): Record<string, Relationship> {
    return Object.fromEntries(this.relationships);
  }

  restore(data: Record<string, Relationship>): void {
    this.relationships.clear();
    for (const [k, v] of Object.entries(data)) this.relationships.set(k, v);
  }
}

/**
 * How a Pokémon regards a subject, derived from affinity and familiarity.
 * This is what the AI and the UI actually branch on.
 */
export type Disposition = 'bonded' | 'friendly' | 'neutral' | 'wary' | 'hostile';

export function dispositionFor(affinity: number, familiarity: number): Disposition {
  // A strong opinion from a stranger is not trusted — familiarity gates how
  // far the affinity can move the disposition.
  const weighted = affinity * (0.35 + familiarity * 0.65);
  if (weighted > 0.55) return 'bonded';
  if (weighted > 0.18) return 'friendly';
  if (weighted < -0.5) return 'hostile';
  if (weighted < -0.15) return 'wary';
  return 'neutral';
}
