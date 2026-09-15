import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '@alola/core';
import { allQuests } from '@alola/data';
import {
  QuestJournal, tierFor, REPUTATION_TIERS,
  QuestComplete, QuestObjectiveComplete, ReputationChanged,
} from '../src/runtime.ts';

function makeJournal(): { journal: QuestJournal; bus: EventBus } {
  const bus = new EventBus();
  return { journal: new QuestJournal(bus), bus };
}

describe('Quest journal', () => {
  test('a quest gated behind a flag stays unavailable until it is set', () => {
    const { journal } = makeJournal();
    journal.offer('main-02-first-trial'); // requires story_act1
    assert.equal(journal.statusOf('main-02-first-trial'), 'unavailable');
    assert.equal(journal.start('main-02-first-trial', 0), false);

    journal.setFlag('story_act1');
    assert.equal(journal.statusOf('main-02-first-trial'), 'available');
    assert.equal(journal.start('main-02-first-trial', 0), true);
  });

  test('objectives unlock only when their dependencies complete', () => {
    const { journal } = makeJournal();
    journal.start('main-01-arrival', 0);

    let available = journal.availableObjectives('main-01-arrival').map((o) => o.id);
    assert.deepEqual(available, ['meet-hala'], 'only the root objective should be actionable');

    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    available = journal.availableObjectives('main-01-arrival').map((o) => o.id);
    assert.deepEqual(available, ['climb-trail'], 'the next step should unlock');
  });

  test('a counted objective needs its full count', () => {
    const { journal } = makeJournal();
    journal.start('main-01-arrival', 0);
    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    journal.signal({ kind: 'reach', target: 'marker:mahalo_upper' }, 2);

    // rescue-cosmog needs 3 Spearow.
    journal.signal({ kind: 'defeat', target: 'SPEAROW' }, 3);
    assert.ok(
      journal.availableObjectives('main-01-arrival').some((o) => o.id === 'rescue-cosmog'),
      'should still be in progress after one of three',
    );

    journal.signal({ kind: 'defeat', target: 'SPEAROW', count: 2 }, 4);
    assert.ok(
      !journal.availableObjectives('main-01-arrival').some((o) => o.id === 'rescue-cosmog'),
      'should complete once the count is met',
    );
  });

  test('signals for irrelevant targets do nothing', () => {
    const { journal } = makeJournal();
    journal.start('main-01-arrival', 0);
    assert.equal(journal.signal({ kind: 'catch', target: 'PIKACHU' }, 1), 0);
  });

  test('completing every required objective completes the quest and pays out', () => {
    const { journal, bus } = makeJournal();
    const completed: { questId: string; outcome: string }[] = [];
    bus.on(QuestComplete, (e) => { completed.push({ questId: e.questId, outcome: e.outcome }); });

    journal.start('main-01-arrival', 0);
    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    journal.signal({ kind: 'reach', target: 'marker:mahalo_upper' }, 2);
    journal.signal({ kind: 'defeat', target: 'SPEAROW', count: 3 }, 3);
    journal.signal({ kind: 'survive', target: 'event:bridge_collapse' }, 4);

    assert.equal(completed.length, 1, 'the quest should have completed exactly once');
    assert.equal(completed[0].outcome, 'default');
    assert.equal(journal.statusOf('main-01-arrival'), 'complete');
    // Reward flags should be set.
    assert.ok(journal.hasFlag('story_act1'));
    assert.ok(journal.hasFlag('met_lillie'));
  });

  test('completion unlocks the quests it declares', () => {
    const { journal } = makeJournal();
    journal.start('main-01-arrival', 0);
    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    journal.signal({ kind: 'reach', target: 'marker:mahalo_upper' }, 2);
    journal.signal({ kind: 'defeat', target: 'SPEAROW', count: 3 }, 3);
    journal.signal({ kind: 'survive', target: 'event:bridge_collapse' }, 4);

    // main-01 unlocks main-02 and side-01; main-02 also needs story_act1,
    // which main-01's reward set.
    assert.equal(journal.statusOf('main-02-first-trial'), 'available');
    assert.equal(journal.statusOf('side-01-lost-stufful'), 'available');
  });

  test('branching quests award the branch-specific outcome', () => {
    const run = (branch: string): { outcome: string; reward: Record<string, unknown> } => {
      const { journal, bus } = makeJournal();
      const results: { outcome: string; reward: Record<string, unknown> }[] = [];
      bus.on(QuestComplete, (e) => {
        results.push({ outcome: e.outcome, reward: e.reward as unknown as Record<string, unknown> });
      });

      journal.start('side-01-lost-stufful', 0);
      journal.signal({ kind: 'talk', target: 'npc:worried_child' }, 1);
      journal.signal({ kind: 'investigate', target: 'marker:stufful_trail_1' }, 2);
      journal.signal({ kind: 'reach', target: 'marker:stufful_found' }, 3);
      journal.signal({ kind: 'choice', target: 'event:bewear_standoff', branch }, 4);
      return results[0];
    };

    const fought = run('fight');
    const distracted = run('distract');
    const retreated = run('retreat');

    assert.equal(fought.outcome, 'outcome-fight');
    assert.equal(distracted.outcome, 'outcome-distract');
    assert.equal(retreated.outcome, 'outcome-retreat');
    // The clever solution should pay better than brute force.
    assert.ok(
      (distracted.reward.money as number) > (fought.reward.money as number),
      'the clever branch should be the best-rewarded',
    );
  });

  test('branch choice changes reputation in opposite directions', () => {
    const repAfter = (branch: string): number => {
      const { journal } = makeJournal();
      journal.start('side-01-lost-stufful', 0);
      journal.signal({ kind: 'talk', target: 'npc:worried_child' }, 1);
      journal.signal({ kind: 'investigate', target: 'marker:stufful_trail_1' }, 2);
      journal.signal({ kind: 'reach', target: 'marker:stufful_found' }, 3);
      journal.signal({ kind: 'choice', target: 'event:bewear_standoff', branch }, 4);
      return journal.getReputation('wildlife');
    };

    assert.ok(repAfter('fight') < 0, 'fighting the Bewear should anger the wildlife faction');
    assert.ok(repAfter('retreat') > 0, 'backing off should please it');
  });

  test('optional objectives never block completion', () => {
    const { journal } = makeJournal();
    journal.start('research-01-wingull-census', 0);
    journal.signal({ kind: 'talk', target: 'npc:researcher_kai' }, 1);
    // Three required photo objectives share the same kind and target, so one
    // signal batch advances all of them.
    journal.signal({ kind: 'photograph', target: 'WINGULL', count: 8 }, 2);

    // The shiny objective is optional and deliberately not done.
    assert.equal(journal.statusOf('research-01-wingull-census'), 'complete');
  });

  test('a timed objective fails when it expires, and fails the quest', () => {
    const { journal } = makeJournal();
    journal.setFlag('story_act3');
    journal.start('ub-01-first-contact', 0);
    journal.signal({ kind: 'talk', target: 'npc:looker' }, 1);
    journal.signal({ kind: 'investigate', target: 'marker:ultra_site_north' }, 2);

    // The escort objective has a 180s limit and is now available.
    journal.tick(3);
    assert.equal(journal.statusOf('ub-01-first-contact'), 'active');

    journal.tick(3 + 200);
    assert.equal(journal.statusOf('ub-01-first-contact'), 'failed');
  });

  test('a timer only starts once its objective is actually reachable', () => {
    const { journal } = makeJournal();
    journal.setFlag('story_act3');
    journal.start('ub-01-first-contact', 0);

    // Let a long time pass without unlocking the escort objective.
    for (let t = 0; t < 1000; t += 10) journal.tick(t);
    assert.equal(journal.statusOf('ub-01-first-contact'), 'active', 'a locked objective must not time out');
  });

  test('events fire for objective completion', () => {
    const { journal, bus } = makeJournal();
    const completed: string[] = [];
    bus.on(QuestObjectiveComplete, (e) => completed.push(e.objectiveId));

    journal.start('main-01-arrival', 0);
    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    assert.deepEqual(completed, ['meet-hala']);
  });

  test('every shipped quest is completable via its own objective graph', () => {
    // A quest whose objectives cannot all be satisfied is a soft-lock waiting
    // to happen, so drive each one to completion mechanically.
    for (const quest of allQuests()) {
      const { journal } = makeJournal();
      for (const flag of quest.requiresFlags ?? []) journal.setFlag(flag);
      assert.ok(journal.start(quest.id, 0), `${quest.id}: could not be started`);

      let guard = 0;
      while (journal.statusOf(quest.id) === 'active') {
        if (++guard > 64) {
          assert.fail(`${quest.id}: could not be completed in 64 steps`);
        }
        const available = journal.availableObjectives(quest.id);
        if (available.length === 0) break;

        for (const objective of available) {
          if (objective.optional) continue;
          journal.signal(
            {
              kind: objective.kind,
              target: objective.target,
              count: objective.count ?? 1,
              branch: objective.branches?.[0]?.id,
            },
            guard,
          );
        }
      }
      assert.equal(journal.statusOf(quest.id), 'complete', `${quest.id}: did not complete`);
    }
  });
});

describe('Reputation', () => {
  test('tiers are ordered and resolve correctly', () => {
    for (let i = 1; i < REPUTATION_TIERS.length; i++) {
      assert.ok(REPUTATION_TIERS[i].min > REPUTATION_TIERS[i - 1].min, 'tiers must ascend');
    }
    assert.equal(tierFor(-500).name, 'hostile');
    assert.equal(tierFor(0).name, 'neutral');
    assert.equal(tierFor(200).name, 'respected');
    assert.equal(tierFor(9999).name, REPUTATION_TIERS[REPUTATION_TIERS.length - 1].name);
  });

  test('higher standing lowers prices, hostility raises them', () => {
    const { journal } = makeJournal();
    assert.equal(journal.priceMultiplier('melemele'), 1.0);

    journal.adjustReputation('melemele', 350);
    assert.ok(journal.priceMultiplier('melemele') < 1.0);

    journal.adjustReputation('akala', -200);
    assert.ok(journal.priceMultiplier('akala') > 1.0);
    assert.equal(journal.willTrade('akala'), false, 'a hostile faction should refuse service');
  });

  test('reputation is clamped and emits change events', () => {
    const { journal, bus } = makeJournal();
    const changes: number[] = [];
    bus.on(ReputationChanged, (e) => changes.push(e.total));

    journal.adjustReputation('kahuna', 5000);
    assert.equal(journal.getReputation('kahuna'), 1000, 'should clamp at the maximum');
    journal.adjustReputation('kahuna', -99999);
    assert.equal(journal.getReputation('kahuna'), -1000, 'should clamp at the minimum');
    assert.equal(changes.length, 2);
  });
});

describe('Quest persistence', () => {
  test('save/restore preserves progress, flags and reputation', () => {
    const { journal } = makeJournal();
    journal.start('main-01-arrival', 0);
    journal.signal({ kind: 'talk', target: 'npc:hala' }, 1);
    journal.signal({ kind: 'reach', target: 'marker:mahalo_upper' }, 2);
    journal.adjustReputation('melemele', 120);
    journal.setFlag('custom_flag');

    const snapshot = journal.save();

    const { journal: restored } = makeJournal();
    restored.restore(snapshot);

    assert.equal(restored.statusOf('main-01-arrival'), 'active');
    assert.equal(restored.getReputation('melemele'), 120);
    assert.ok(restored.hasFlag('custom_flag'));

    // And it must still be playable from where it left off.
    const available = restored.availableObjectives('main-01-arrival').map((o) => o.id);
    assert.deepEqual(available, ['rescue-cosmog']);
    restored.signal({ kind: 'defeat', target: 'SPEAROW', count: 3 }, 3);
    restored.signal({ kind: 'survive', target: 'event:bridge_collapse' }, 4);
    assert.equal(restored.statusOf('main-01-arrival'), 'complete');
  });

  test('a save referencing a removed quest loads without crashing', () => {
    const { journal } = makeJournal();
    const snapshot = journal.save();
    snapshot.quests['quest-deleted-in-a-patch'] = {
      status: 'active',
      objectives: { gone: { count: 0, complete: false, failed: false, chosenBranch: null } },
      outcome: null,
      startedAt: 0,
      completedAt: 0,
    };

    const { journal: restored } = makeJournal();
    restored.restore(snapshot); // Must not throw.
    assert.equal(restored.statusOf('quest-deleted-in-a-patch'), 'unavailable');
  });
});
