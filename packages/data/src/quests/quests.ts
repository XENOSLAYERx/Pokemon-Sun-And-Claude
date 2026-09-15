/**
 * Quest definitions.
 *
 * Quests are directed graphs of objectives, not linear checklists, so a quest
 * can branch on player choice and converge again. Every quest declares its
 * reputation consequences up front — that is what makes the NPC reputation
 * system auditable instead of a pile of scattered `rep += 5` calls.
 *
 * This file holds authored story and side quests. Procedural quests (bounties,
 * research requests, treasure hunts) are generated at runtime from templates
 * in `quest-templates.ts` against the same schema, so the quest runner does not
 * care which kind it is driving.
 */

export type QuestObjectiveKind =
  | 'talk' | 'reach' | 'catch' | 'defeat' | 'collect' | 'photograph'
  | 'deliver' | 'survive' | 'escort' | 'investigate' | 'choice';

export interface QuestObjective {
  readonly id: string;
  readonly kind: QuestObjectiveKind;
  readonly text: string;
  /** Target: an NPC id, species id, item id, marker id, depending on kind. */
  readonly target: string;
  readonly count?: number;
  /** Objectives that must complete before this one unlocks. Empty = start. */
  readonly requires?: readonly string[];
  /** For 'choice': the branches offered. */
  readonly branches?: readonly { readonly id: string; readonly text: string; readonly leadsTo: string }[];
  /** Optional objectives don't gate completion but may improve rewards. */
  readonly optional?: boolean;
  /** Real-time seconds before this objective fails, if any. */
  readonly timeLimit?: number;
}

export interface QuestReward {
  readonly money?: number;
  readonly items?: readonly { readonly id: string; readonly count: number }[];
  readonly exp?: number;
  /** Reputation deltas by faction. */
  readonly reputation?: Readonly<Record<string, number>>;
  /** Story flags set on completion. */
  readonly flags?: readonly string[];
  /** Pokémon gifted. */
  readonly pokemon?: readonly { readonly species: string; readonly level: number }[];
}

export type QuestCategory =
  | 'main' | 'trial' | 'side' | 'rescue' | 'research'
  | 'treasure' | 'mystery' | 'legendary' | 'ultra-beast' | 'daily';

export interface QuestDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: QuestCategory;
  readonly island: string;
  readonly giver: string;
  readonly recommendedLevel: number;
  readonly summary: string;
  readonly objectives: readonly QuestObjective[];
  /** Rewards keyed by outcome id; 'default' is the standard completion. */
  readonly rewards: Readonly<Record<string, QuestReward>>;
  /** Story flags required before the quest appears. */
  readonly requiresFlags?: readonly string[];
  /** Quests unlocked by completing this one. */
  readonly unlocks?: readonly string[];
  readonly repeatable: boolean;
}

export const QUESTS: readonly QuestDefinition[] = [
  {
    id: 'main-01-arrival', name: 'The Plank Bridge',
    category: 'main', island: 'melemele', giver: 'hala', recommendedLevel: 5,
    summary: 'A girl is running along the Mahalo Trail, and something is chasing what she carries.',
    objectives: [
      { id: 'meet-hala', kind: 'talk', text: 'Speak to Kahuna Hala in Iki Town.', target: 'npc:hala' },
      { id: 'climb-trail', kind: 'reach', text: 'Follow the Mahalo Trail upward.', target: 'marker:mahalo_upper', requires: ['meet-hala'] },
      { id: 'rescue-cosmog', kind: 'defeat', text: 'Drive off the Spearow flock.', target: 'SPEAROW', count: 3, requires: ['climb-trail'] },
      { id: 'bridge', kind: 'survive', text: 'Hold on as the bridge gives way.', target: 'event:bridge_collapse', requires: ['rescue-cosmog'] },
    ],
    rewards: {
      default: {
        money: 1000,
        items: [{ id: 'poke-ball', count: 10 }],
        flags: ['met_lillie', 'tapu_koko_seen', 'story_act1'],
        reputation: { melemele: 15, kahuna: 10 },
      },
    },
    unlocks: ['main-02-first-trial', 'side-01-lost-stufful'],
    repeatable: false,
  },
  {
    id: 'main-02-first-trial', name: 'Island Challenge',
    category: 'main', island: 'melemele', giver: 'hala', recommendedLevel: 10,
    summary: 'Hala will not name you a challenger until Ilima says you are ready.',
    objectives: [
      { id: 'find-ilima', kind: 'talk', text: 'Find Captain Ilima in Hau’oli City.', target: 'npc:ilima' },
      { id: 'prove', kind: 'defeat', text: 'Win Ilima’s assessment battle.', target: 'trainer:ilima_test', requires: ['find-ilima'] },
      { id: 'trial', kind: 'investigate', text: 'Complete the Verdant Cavern trial.', target: 'trial:verdant-cavern', requires: ['prove'] },
    ],
    rewards: {
      default: {
        money: 2500,
        items: [{ id: 'z-ring', count: 1 }, { id: 'normalium-z', count: 1 }],
        flags: ['trial_1_done', 'has_z_ring'],
        reputation: { melemele: 20, kahuna: 15, captains: 10 },
      },
    },
    requiresFlags: ['story_act1'],
    unlocks: ['main-03-grand-trial'],
    repeatable: false,
  },
  {
    id: 'main-03-grand-trial', name: 'Grand Trial: Hala',
    category: 'main', island: 'melemele', giver: 'hala', recommendedLevel: 15,
    summary: 'One trial does not make a challenger. The kahuna decides that, and he decides it in the ring.',
    objectives: [
      { id: 'return', kind: 'talk', text: 'Return to Hala in Iki Town.', target: 'npc:hala' },
      { id: 'festival', kind: 'reach', text: 'Take your place at the festival grounds.', target: 'marker:iki_arena', requires: ['return'] },
      { id: 'grand-trial', kind: 'defeat', text: 'Defeat Kahuna Hala.', target: 'trainer:hala_grand', requires: ['festival'] },
      { id: 'flawless', kind: 'defeat', text: 'Win without losing a Pokémon.', target: 'trainer:hala_grand:flawless', optional: true, requires: ['festival'] },
    ],
    rewards: {
      default: {
        money: 6000,
        items: [{ id: 'fightinium-z', count: 1 }, { id: 'great-ball', count: 10 }],
        flags: ['grand_trial_1', 'story_act2', 'ride_tauros'],
        reputation: { melemele: 30, kahuna: 30 },
      },
    },
    requiresFlags: ['trial_1_done'],
    unlocks: ['main-04-akala-crossing'],
    repeatable: false,
  },
  {
    id: 'main-04-akala-crossing', name: 'The Crossing to Akala',
    category: 'main', island: 'akala', giver: 'npc:ferry_captain', recommendedLevel: 18,
    summary: 'Akala is a day\u2019s sail east. The ferry leaves at dawn, and something follows it out of the harbour.',
    objectives: [
      { id: 'board', kind: 'talk', text: 'Board the ferry at Hau\u2019oli docks.', target: 'npc:ferry_captain' },
      { id: 'crossing', kind: 'survive', text: 'A Sharpedo pack shadows the hull. See the crossing through.', target: 'event:ferry_sharpedo', requires: ['board'] },
      { id: 'arrive', kind: 'reach', text: 'Make landfall at Heahea City.', target: 'marker:heahea_dock', requires: ['crossing'] },
    ],
    rewards: {
      default: {
        money: 2000,
        items: [{ id: 'super-potion', count: 5 }],
        flags: ['akala_unlocked', 'ride_lapras'],
        reputation: { akala: 10 },
      },
    },
    requiresFlags: ['grand_trial_1'],
    repeatable: false,
  },
  {
    id: 'side-01-lost-stufful', name: 'Something in the Trees',
    category: 'rescue', island: 'melemele', giver: 'npc:worried_child', recommendedLevel: 8,
    summary: 'A child has lost her Stufful in the forest. Her mother is more worried about what is looking for it.',
    objectives: [
      { id: 'ask', kind: 'talk', text: 'Ask the child what happened.', target: 'npc:worried_child' },
      { id: 'track', kind: 'investigate', text: 'Follow the trail of torn leaves.', target: 'marker:stufful_trail_1' },
      { id: 'find', kind: 'reach', text: 'Find the Stufful.', target: 'marker:stufful_found', requires: ['track'] },
      {
        id: 'decide', kind: 'choice', text: 'A Bewear is standing over it. Decide what to do.',
        target: 'event:bewear_standoff', requires: ['find'],
        branches: [
          { id: 'fight', text: 'Battle the Bewear.', leadsTo: 'outcome-fight' },
          { id: 'retreat', text: 'Back away slowly and let it take the Stufful home.', leadsTo: 'outcome-retreat' },
          { id: 'distract', text: 'Use a Berry to draw it away.', leadsTo: 'outcome-distract' },
        ],
      },
    ],
    rewards: {
      'outcome-fight': {
        money: 1200, exp: 800,
        items: [{ id: 'super-potion', count: 3 }],
        reputation: { melemele: 5, wildlife: -15 },
        flags: ['bewear_fought'],
      },
      'outcome-retreat': {
        money: 400,
        reputation: { melemele: -5, wildlife: 20 },
        flags: ['bewear_respected'],
      },
      'outcome-distract': {
        money: 1500,
        items: [{ id: 'sitrus-berry', count: 5 }],
        reputation: { melemele: 15, wildlife: 15 },
        flags: ['bewear_outsmarted', 'clever_solution'],
      },
    },
    repeatable: false,
  },
  {
    id: 'research-01-wingull-census', name: 'Wingull Census',
    category: 'research', island: 'melemele', giver: 'npc:researcher_kai', recommendedLevel: 10,
    summary: 'A researcher needs flock sizes counted at three nesting sites before the colonies move on.',
    objectives: [
      { id: 'brief', kind: 'talk', text: 'Take the census brief.', target: 'npc:researcher_kai' },
      { id: 'site-1', kind: 'photograph', text: 'Photograph the Kala’e Bay colony.', target: 'WINGULL', count: 8, requires: ['brief'] },
      { id: 'site-2', kind: 'photograph', text: 'Photograph the cliff stacks.', target: 'WINGULL', count: 8, requires: ['brief'] },
      { id: 'site-3', kind: 'photograph', text: 'Photograph the harbour flock.', target: 'WINGULL', count: 8, requires: ['brief'] },
      { id: 'rare', kind: 'photograph', text: 'Photograph a shiny Wingull, if one exists.', target: 'WINGULL:shiny', count: 1, optional: true, requires: ['brief'] },
    ],
    rewards: {
      default: {
        money: 3000,
        items: [{ id: 'scanner-lens', count: 1 }],
        reputation: { researchers: 25, wildlife: 10 },
        flags: ['census_done'],
      },
    },
    repeatable: false,
  },
  {
    id: 'ub-01-first-contact', name: 'Something Came Through',
    category: 'ultra-beast', island: 'ulaula', giver: 'npc:looker', recommendedLevel: 55,
    summary: 'The aurora over Ula’ula is not an aurora. Something is already on this side.',
    objectives: [
      { id: 'briefing', kind: 'talk', text: 'Meet the agent at Malie Garden.', target: 'npc:looker' },
      { id: 'investigate', kind: 'investigate', text: 'Investigate the distortion site.', target: 'marker:ultra_site_north', requires: ['briefing'] },
      { id: 'panic', kind: 'escort', text: 'Get the civilians clear.', target: 'npc:evac_group', requires: ['investigate'], timeLimit: 180 },
      { id: 'confront', kind: 'defeat', text: 'Confront the Nihilego.', target: 'NIHILEGO', count: 1, requires: ['panic'] },
      { id: 'capture', kind: 'catch', text: 'Capture it rather than driving it off.', target: 'NIHILEGO', count: 1, optional: true, requires: ['confront'] },
    ],
    rewards: {
      default: {
        money: 12000,
        items: [{ id: 'beast-ball', count: 5 }],
        reputation: { aether: 20, researchers: 20 },
        flags: ['ub_mission_start', 'ultra_access'],
      },
    },
    requiresFlags: ['story_act3'],
    unlocks: ['ub-02-beast-hunt'],
    repeatable: false,
  },
  {
    id: 'ub-02-beast-hunt', name: 'Faller',
    category: 'ultra-beast', island: 'ulaula', giver: 'npc:looker', recommendedLevel: 60,
    summary: 'Four more signatures, four islands, and a man who has been through a wormhole and come back wrong.',
    objectives: [
      { id: 'debrief', kind: 'talk', text: 'Debrief with the agent.', target: 'npc:looker' },
      { id: 'hunt-buzzwole', kind: 'defeat', text: 'Track the signature on Melemele.', target: 'BUZZWOLE', count: 1, requires: ['debrief'] },
      { id: 'hunt-pheromosa', kind: 'defeat', text: 'Track the signature on Akala.', target: 'PHEROMOSA', count: 1, requires: ['debrief'] },
      { id: 'hunt-xurkitree', kind: 'defeat', text: 'Track the signature at the power plant.', target: 'XURKITREE', count: 1, requires: ['debrief'] },
      { id: 'hunt-guzzlord', kind: 'defeat', text: 'Track the signature in Resolution Cave.', target: 'GUZZLORD', count: 1, requires: ['debrief'] },
      {
        id: 'disposition', kind: 'choice', text: 'Decide what happens to what you caught.',
        target: 'event:ub_disposition',
        requires: ['hunt-buzzwole', 'hunt-pheromosa', 'hunt-xurkitree', 'hunt-guzzlord'],
        branches: [
          { id: 'return', text: 'Send them home through the wormholes.', leadsTo: 'outcome-return' },
          { id: 'aether', text: 'Hand them to Aether for study.', leadsTo: 'outcome-aether' },
          { id: 'keep', text: 'Keep them.', leadsTo: 'outcome-keep' },
        ],
      },
    ],
    rewards: {
      'outcome-return': {
        money: 40000,
        items: [{ id: 'comet-shard', count: 2 }],
        reputation: { researchers: 30, wildlife: 40, aether: -10 },
        flags: ['ub_returned', 'ultra_space_open'],
      },
      'outcome-aether': {
        money: 60000,
        items: [{ id: 'beast-ball', count: 10 }],
        reputation: { aether: 40, researchers: 20, wildlife: -25 },
        flags: ['ub_to_aether', 'ultra_space_open'],
      },
      'outcome-keep': {
        money: 20000,
        reputation: { aether: -20, researchers: -10 },
        flags: ['ub_kept', 'ultra_space_open'],
      },
    },
    requiresFlags: ['ub_mission_start'],
    repeatable: false,
  },
  {
    id: 'legend-01-tapu-koko', name: 'The Guardian’s Interest',
    category: 'legendary', island: 'melemele', giver: 'hala', recommendedLevel: 45,
    summary: 'Tapu Koko has been watching you since the bridge. Hala says it is time you answered.',
    objectives: [
      { id: 'ask-hala', kind: 'talk', text: 'Ask Hala about the Ruins of Conflict.', target: 'npc:hala' },
      { id: 'lightning-1', kind: 'investigate', text: 'Solve the first lightning shrine.', target: 'puzzle:koko_1', requires: ['ask-hala'] },
      { id: 'lightning-2', kind: 'investigate', text: 'Solve the second lightning shrine.', target: 'puzzle:koko_2', requires: ['lightning-1'] },
      { id: 'lightning-3', kind: 'investigate', text: 'Solve the third lightning shrine.', target: 'puzzle:koko_3', requires: ['lightning-2'] },
      { id: 'face', kind: 'defeat', text: 'Face Tapu Koko in its arena.', target: 'TAPU_KOKO', count: 1, requires: ['lightning-3'] },
    ],
    rewards: {
      default: {
        money: 0,
        items: [{ id: 'tapunium-z', count: 1 }],
        reputation: { melemele: 40, kahuna: 25 },
        flags: ['tapu_koko_faced'],
      },
    },
    requiresFlags: ['trial_1_done'],
    repeatable: false,
  },
  {
    id: 'treasure-01-sunken-hold', name: 'The Sunken Hold',
    category: 'treasure', island: 'akala', giver: 'npc:diver_moana', recommendedLevel: 30,
    summary: 'A freighter went down off Konikoni forty years ago. The manifest has just resurfaced.',
    objectives: [
      { id: 'buy-map', kind: 'talk', text: 'Buy the manifest from the diver.', target: 'npc:diver_moana' },
      { id: 'dive', kind: 'reach', text: 'Dive to the wreck.', target: 'marker:wreck_konikoni', requires: ['buy-map'] },
      { id: 'sharpedo', kind: 'survive', text: 'The wreck is a Sharpedo den. Survive the pass.', target: 'hazard:sharpedo_pack', requires: ['dive'] },
      { id: 'loot', kind: 'collect', text: 'Recover the cargo.', target: 'item:big-pearl', count: 3, requires: ['sharpedo'] },
    ],
    rewards: {
      default: {
        money: 8000,
        items: [{ id: 'big-pearl', count: 3 }, { id: 'nugget', count: 1 }],
        reputation: { akala: 10 },
      },
    },
    repeatable: false,
  },
];

const byId = new Map(QUESTS.map((q) => [q.id, q]));

export function getQuest(id: string): QuestDefinition {
  const q = byId.get(id);
  if (!q) throw new Error(`Unknown quest "${id}".`);
  return q;
}

export function tryGetQuest(id: string): QuestDefinition | undefined {
  return byId.get(id);
}

export function questsForIsland(islandId: string): readonly QuestDefinition[] {
  return QUESTS.filter((q) => q.island === islandId);
}

export function questsOfCategory(c: QuestCategory): readonly QuestDefinition[] {
  return QUESTS.filter((q) => q.category === c);
}

export function allQuests(): readonly QuestDefinition[] {
  return QUESTS;
}

/** Factions the reputation system tracks. */
export const FACTIONS = [
  'melemele', 'akala', 'ulaula', 'poni',
  'kahuna', 'captains', 'researchers', 'aether', 'wildlife', 'skull',
] as const;

export type FactionId = (typeof FACTIONS)[number];
