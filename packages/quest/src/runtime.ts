/**
 * Quest runtime.
 *
 * Drives quest definitions (which are directed graphs, not checklists) through
 * to completion, tracking objective progress, resolving branches and awarding
 * per-outcome rewards.
 *
 * Two decisions shape the design:
 *
 * - **Progress is event-driven, not polled.** The world emits "a Wingull was
 *   photographed"; the runtime asks every active quest whether it cares. With
 *   thousands of side quests, polling each one per frame is untenable, and an
 *   index from (objective kind, target) to interested quests makes the common
 *   case a single map lookup.
 *
 * - **Objectives unlock by dependency, not by order.** An objective becomes
 *   available when all of its `requires` are complete, so a quest can fan out
 *   into parallel tasks and converge again — which is what lets a rescue quest
 *   offer three genuinely different solutions.
 */
import { EventBus, defineEvent } from '@alola/core';
import {
  getQuest, tryGetQuest, FACTIONS,
  type QuestDefinition, type QuestObjective, type QuestReward, type FactionId,
} from '@alola/data';

export type QuestStatus = 'unavailable' | 'available' | 'active' | 'complete' | 'failed';

export interface ObjectiveProgress {
  readonly id: string;
  /** How many of the required count have been done. */
  count: number;
  complete: boolean;
  failed: boolean;
  /** Only set for 'choice' objectives once the player has decided. */
  chosenBranch: string | null;
  /** Simulation time this objective became available, for timers. */
  availableAt: number;
}

export interface QuestProgress {
  readonly questId: string;
  status: QuestStatus;
  objectives: Map<string, ObjectiveProgress>;
  /** Which reward outcome this playthrough earned. */
  outcome: string | null;
  startedAt: number;
  completedAt: number;
}

/** Events the quest system emits, for UI, audio and analytics. */
export const QuestStarted = defineEvent<{ questId: string; name: string }>('quest.started');
export const QuestObjectiveComplete = defineEvent<{
  questId: string; objectiveId: string; text: string;
}>('quest.objective-complete');
export const QuestObjectiveAvailable = defineEvent<{
  questId: string; objectiveId: string; text: string;
}>('quest.objective-available');
export const QuestComplete = defineEvent<{
  questId: string; name: string; outcome: string; reward: QuestReward;
}>('quest.complete');
export const QuestFailed = defineEvent<{ questId: string; reason: string }>('quest.failed');
export const ReputationChanged = defineEvent<{
  faction: FactionId; delta: number; total: number; tier: string;
}>('reputation.changed');

/** A world occurrence that may advance an objective. */
export interface QuestSignal {
  readonly kind: QuestObjective['kind'];
  /** NPC id, species id, item id, marker id — whatever the objective targets. */
  readonly target: string;
  readonly count?: number;
  /** For 'choice' signals: which branch the player picked. */
  readonly branch?: string;
}

export interface ReputationTier {
  readonly name: string;
  readonly min: number;
  /** Price multiplier at shops aligned with this faction. */
  readonly priceModifier: number;
  /** Does this tier unlock faction-specific content? */
  readonly unlocksContent: boolean;
}

/**
 * Reputation tiers.
 *
 * Deliberately asymmetric: falling out of favour is faster than earning it
 * back, and hostility has real consequences (shops refuse service) while high
 * standing gives access rather than raw power. Reputation that only ever
 * discounts potions is not worth tracking.
 */
export const REPUTATION_TIERS: readonly ReputationTier[] = [
  { name: 'hostile', min: -1000, priceModifier: 1.5, unlocksContent: false },
  { name: 'disliked', min: -50, priceModifier: 1.2, unlocksContent: false },
  { name: 'neutral', min: 0, priceModifier: 1.0, unlocksContent: false },
  { name: 'accepted', min: 50, priceModifier: 0.95, unlocksContent: false },
  { name: 'respected', min: 150, priceModifier: 0.9, unlocksContent: true },
  { name: 'honoured', min: 300, priceModifier: 0.85, unlocksContent: true },
  { name: 'kamaʻāina', min: 500, priceModifier: 0.8, unlocksContent: true },
];

export function tierFor(reputation: number): ReputationTier {
  let tier = REPUTATION_TIERS[0];
  for (const t of REPUTATION_TIERS) {
    if (reputation >= t.min) tier = t;
  }
  return tier;
}

export interface QuestJournalSnapshot {
  quests: Record<string, {
    status: QuestStatus;
    objectives: Record<string, { count: number; complete: boolean; failed: boolean; chosenBranch: string | null }>;
    outcome: string | null;
    startedAt: number;
    completedAt: number;
  }>;
  reputation: Record<string, number>;
  flags: string[];
}

export class QuestJournal {
  private progress = new Map<string, QuestProgress>();
  private reputation = new Map<FactionId, number>();
  private flags = new Set<string>();
  /** (kind:target) -> quest ids that have an active objective matching it. */
  private signalIndex = new Map<string, Set<string>>();
  private readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
    for (const faction of FACTIONS) this.reputation.set(faction, 0);
  }

  // ------------------------------------------------------------- flags

  setFlag(flag: string): void {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    // A new flag may make quests available.
    this.refreshAvailability();
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  allFlags(): ReadonlySet<string> {
    return this.flags;
  }

  // ------------------------------------------------------------ quests

  /** Is a quest's flag gate satisfied? */
  private requirementsMet(quest: QuestDefinition): boolean {
    for (const flag of quest.requiresFlags ?? []) {
      if (!this.flags.has(flag)) return false;
    }
    return true;
  }

  /** Re-evaluate which not-yet-started quests are now offerable. */
  private refreshAvailability(): void {
    for (const [questId, prog] of this.progress) {
      if (prog.status !== 'unavailable') continue;
      const quest = tryGetQuest(questId);
      if (quest && this.requirementsMet(quest)) prog.status = 'available';
    }
  }

  /** Make the journal aware of a quest without starting it. */
  offer(questId: string): void {
    if (this.progress.has(questId)) return;
    const quest = getQuest(questId);
    this.progress.set(questId, {
      questId,
      status: this.requirementsMet(quest) ? 'available' : 'unavailable',
      objectives: new Map(),
      outcome: null,
      startedAt: 0,
      completedAt: 0,
    });
  }

  start(questId: string, now: number): boolean {
    const quest = getQuest(questId);
    this.offer(questId);
    const prog = this.progress.get(questId)!;

    if (prog.status === 'active' || prog.status === 'complete') return false;
    if (!this.requirementsMet(quest)) return false;

    prog.status = 'active';
    prog.startedAt = now;

    for (const objective of quest.objectives) {
      prog.objectives.set(objective.id, {
        id: objective.id,
        count: 0,
        complete: false,
        failed: false,
        chosenBranch: null,
        availableAt: now,
      });
    }

    this.reindex(questId);
    this.bus.emit(QuestStarted, { questId, name: quest.name });

    // Announce the objectives that are immediately actionable.
    for (const objective of this.availableObjectives(questId)) {
      this.bus.emit(QuestObjectiveAvailable, {
        questId, objectiveId: objective.id, text: objective.text,
      });
    }
    return true;
  }

  /** Objectives whose dependencies are met and which are not yet complete. */
  availableObjectives(questId: string): QuestObjective[] {
    const quest = tryGetQuest(questId);
    const prog = this.progress.get(questId);
    if (!quest || !prog || prog.status !== 'active') return [];

    return quest.objectives.filter((objective) => {
      const state = prog.objectives.get(objective.id);
      if (!state || state.complete || state.failed) return false;
      for (const dep of objective.requires ?? []) {
        if (!prog.objectives.get(dep)?.complete) return false;
      }
      return true;
    });
  }

  /** Rebuild the signal index for one quest. */
  private reindex(questId: string): void {
    // Drop stale entries for this quest first.
    for (const set of this.signalIndex.values()) set.delete(questId);

    for (const objective of this.availableObjectives(questId)) {
      const key = `${objective.kind}:${objective.target}`;
      let set = this.signalIndex.get(key);
      if (!set) {
        set = new Set();
        this.signalIndex.set(key, set);
      }
      set.add(questId);
    }
  }

  /**
   * Feed a world occurrence into the journal.
   * Returns the number of objectives it advanced, so callers can decide
   * whether to show feedback.
   */
  signal(sig: QuestSignal, now: number): number {
    const key = `${sig.kind}:${sig.target}`;
    const interested = this.signalIndex.get(key);
    if (!interested || interested.size === 0) return 0;

    let advanced = 0;
    // Copy: completing a quest mutates the index during iteration.
    for (const questId of [...interested]) {
      advanced += this.advanceQuest(questId, sig, now);
    }
    return advanced;
  }

  private advanceQuest(questId: string, sig: QuestSignal, now: number): number {
    const quest = tryGetQuest(questId);
    const prog = this.progress.get(questId);
    if (!quest || !prog || prog.status !== 'active') return 0;

    let advanced = 0;

    for (const objective of this.availableObjectives(questId)) {
      if (objective.kind !== sig.kind || objective.target !== sig.target) continue;

      const state = prog.objectives.get(objective.id)!;

      if (objective.kind === 'choice') {
        if (!sig.branch) continue;
        const branch = objective.branches?.find((b) => b.id === sig.branch);
        if (!branch) continue;
        state.chosenBranch = branch.id;
        state.complete = true;
        prog.outcome = branch.leadsTo;
      } else {
        const required = objective.count ?? 1;
        state.count = Math.min(required, state.count + (sig.count ?? 1));
        state.complete = state.count >= required;
      }

      if (state.complete) {
        advanced++;
        this.bus.emit(QuestObjectiveComplete, {
          questId, objectiveId: objective.id, text: objective.text,
        });
      }
    }

    if (advanced > 0) {
      this.reindex(questId);
      // Newly-unlocked objectives are announced so the UI can update.
      for (const objective of this.availableObjectives(questId)) {
        const state = prog.objectives.get(objective.id)!;
        if (state.count === 0 && !state.complete) {
          this.bus.emit(QuestObjectiveAvailable, {
            questId, objectiveId: objective.id, text: objective.text,
          });
        }
      }
      this.checkCompletion(questId, now);
    }

    return advanced;
  }

  /**
   * Is the quest done?
   *
   * A quest completes when every *required* (non-optional) objective is
   * complete. Optional objectives are explicitly excluded so a bonus task
   * cannot block completion — the most common source of stuck quest logs.
   */
  private checkCompletion(questId: string, now: number): void {
    const quest = tryGetQuest(questId);
    const prog = this.progress.get(questId);
    if (!quest || !prog || prog.status !== 'active') return;

    for (const objective of quest.objectives) {
      if (objective.optional) continue;
      const state = prog.objectives.get(objective.id);
      if (!state?.complete) return;
    }

    this.complete(questId, now);
  }

  /** Force-complete a quest and pay out its rewards. */
  complete(questId: string, now: number): void {
    const quest = getQuest(questId);
    const prog = this.progress.get(questId);
    if (!prog || prog.status === 'complete') return;

    prog.status = 'complete';
    prog.completedAt = now;

    const outcome = prog.outcome ?? 'default';
    const reward = quest.rewards[outcome] ?? quest.rewards.default;

    if (reward) {
      for (const flag of reward.flags ?? []) this.flags.add(flag);
      for (const [faction, delta] of Object.entries(reward.reputation ?? {})) {
        this.adjustReputation(faction as FactionId, delta as number);
      }
    }

    // Clear this quest from the signal index.
    for (const set of this.signalIndex.values()) set.delete(questId);

    // Offer whatever this unlocks.
    for (const unlocked of quest.unlocks ?? []) {
      this.offer(unlocked);
    }
    this.refreshAvailability();

    this.bus.emit(QuestComplete, {
      questId,
      name: quest.name,
      outcome,
      reward: reward ?? {},
    });
  }

  fail(questId: string, reason: string): void {
    const prog = this.progress.get(questId);
    if (!prog || prog.status !== 'active') return;
    prog.status = 'failed';
    for (const set of this.signalIndex.values()) set.delete(questId);
    this.bus.emit(QuestFailed, { questId, reason });
  }

  /** Expire timed objectives. Called on the gameplay tick. */
  tick(now: number): void {
    for (const [questId, prog] of this.progress) {
      if (prog.status !== 'active') continue;
      const quest = tryGetQuest(questId);
      if (!quest) continue;

      for (const objective of quest.objectives) {
        if (objective.timeLimit === undefined) continue;
        const state = prog.objectives.get(objective.id);
        if (!state || state.complete || state.failed) continue;
        // Only count down once the objective is actually actionable.
        const isAvailable = (objective.requires ?? []).every(
          (dep) => prog.objectives.get(dep)?.complete,
        );
        if (!isAvailable) {
          state.availableAt = now;
          continue;
        }
        if (now - state.availableAt > objective.timeLimit) {
          state.failed = true;
          if (!objective.optional) this.fail(questId, `objective "${objective.id}" timed out`);
        }
      }
    }
  }

  // -------------------------------------------------------- reputation

  adjustReputation(faction: FactionId, delta: number): void {
    const current = this.reputation.get(faction) ?? 0;
    const next = Math.max(-1000, Math.min(1000, current + delta));
    this.reputation.set(faction, next);
    this.bus.emit(ReputationChanged, {
      faction, delta, total: next, tier: tierFor(next).name,
    });
  }

  getReputation(faction: FactionId): number {
    return this.reputation.get(faction) ?? 0;
  }

  getTier(faction: FactionId): ReputationTier {
    return tierFor(this.getReputation(faction));
  }

  /** Shop price multiplier for a faction-aligned vendor. */
  priceMultiplier(faction: FactionId): number {
    return this.getTier(faction).priceModifier;
  }

  /** Will this faction's NPCs deal with the player at all? */
  willTrade(faction: FactionId): boolean {
    return this.getTier(faction).name !== 'hostile';
  }

  // ------------------------------------------------------------ queries

  getProgress(questId: string): QuestProgress | undefined {
    return this.progress.get(questId);
  }

  statusOf(questId: string): QuestStatus {
    return this.progress.get(questId)?.status ?? 'unavailable';
  }

  activeQuests(): QuestDefinition[] {
    const out: QuestDefinition[] = [];
    for (const [id, prog] of this.progress) {
      if (prog.status !== 'active') continue;
      const q = tryGetQuest(id);
      if (q) out.push(q);
    }
    return out;
  }

  availableQuests(): QuestDefinition[] {
    const out: QuestDefinition[] = [];
    for (const [id, prog] of this.progress) {
      if (prog.status !== 'available') continue;
      const q = tryGetQuest(id);
      if (q) out.push(q);
    }
    return out;
  }

  completedCount(): number {
    let n = 0;
    for (const prog of this.progress.values()) if (prog.status === 'complete') n++;
    return n;
  }

  // ----------------------------------------------------------- persistence

  save(): QuestJournalSnapshot {
    const quests: QuestJournalSnapshot['quests'] = {};
    for (const [id, prog] of this.progress) {
      const objectives: Record<string, {
        count: number; complete: boolean; failed: boolean; chosenBranch: string | null;
      }> = {};
      for (const [objId, state] of prog.objectives) {
        objectives[objId] = {
          count: state.count,
          complete: state.complete,
          failed: state.failed,
          chosenBranch: state.chosenBranch,
        };
      }
      quests[id] = {
        status: prog.status,
        objectives,
        outcome: prog.outcome,
        startedAt: prog.startedAt,
        completedAt: prog.completedAt,
      };
    }

    return {
      quests,
      reputation: Object.fromEntries(this.reputation),
      flags: [...this.flags],
    };
  }

  restore(snapshot: QuestJournalSnapshot): void {
    this.progress.clear();
    this.signalIndex.clear();
    this.flags = new Set(snapshot.flags);

    for (const [faction, value] of Object.entries(snapshot.reputation)) {
      this.reputation.set(faction as FactionId, value);
    }

    for (const [id, saved] of Object.entries(snapshot.quests)) {
      // A quest removed from the content in a patch must not break the save.
      if (!tryGetQuest(id)) continue;
      const objectives = new Map<string, ObjectiveProgress>();
      for (const [objId, state] of Object.entries(saved.objectives)) {
        objectives.set(objId, {
          id: objId,
          count: state.count,
          complete: state.complete,
          failed: state.failed,
          chosenBranch: state.chosenBranch,
          availableAt: 0,
        });
      }
      this.progress.set(id, {
        questId: id,
        status: saved.status,
        objectives,
        outcome: saved.outcome,
        startedAt: saved.startedAt,
        completedAt: saved.completedAt,
      });
      if (saved.status === 'active') this.reindex(id);
    }
  }
}
