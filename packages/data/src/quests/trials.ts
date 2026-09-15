/**
 * Island trials.
 *
 * A trial is a mini-dungeon, not a gym: a sequence of authored stages that mix
 * exploration, a puzzle, environmental hazards and a Totem boss. The stage list
 * is data so the trial runner is generic — it drives objectives, gates, camera
 * moves and music transitions from this table alone.
 */

export type TrialStageKind =
  | 'traverse'    // Reach a location.
  | 'puzzle'      // Solve an interaction puzzle.
  | 'gather'      // Collect N of something.
  | 'survive'     // Endure a hazard for N seconds.
  | 'battle'      // Fight a scripted encounter.
  | 'boss'        // The Totem fight.
  | 'cinematic';  // Story beat.

export interface TrialStage {
  readonly id: string;
  readonly kind: TrialStageKind;
  readonly objective: string;
  /** Stage-specific parameters, validated per kind by the content validator. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  /** Music stem to cross-fade into. */
  readonly music?: string;
}

/** A Totem boss encounter. Multi-phase, with aura stat boosts and SOS allies. */
export interface TotemDefinition {
  readonly species: string;
  readonly level: number;
  /** Size multiplier. Totems are visibly, intimidatingly large. */
  readonly scale: number;
  /** Stat stages granted by the totem aura at battle start. */
  readonly auraBoosts: Readonly<Record<string, number>>;
  readonly ability: string;
  readonly heldItem?: string;
  readonly moves: readonly string[];
  /** Allies it calls, in call order. */
  readonly sosAllies: readonly { readonly species: string; readonly level: number; readonly atHpPercent: number }[];
  /** Phase transitions keyed on remaining HP fraction. */
  readonly phases: readonly {
    readonly atHpPercent: number;
    readonly name: string;
    readonly description: string;
    /** Arena change triggered on entering the phase. */
    readonly arenaEvent?: string;
    /** Additional boosts applied on entering. */
    readonly boosts?: Readonly<Record<string, number>>;
  }[];
}

export interface TrialDefinition {
  readonly id: string;
  readonly name: string;
  readonly island: string;
  readonly poi: string;
  readonly captain: string;
  readonly order: number;
  readonly recommendedLevel: number;
  readonly stages: readonly TrialStage[];
  readonly totem: TotemDefinition;
  /** Z-Crystal awarded on completion. */
  readonly reward: string;
  readonly description: string;
}

export const TRIALS: readonly TrialDefinition[] = [
  {
    id: 'verdant-cavern', name: 'Trial of Verdant Cavern',
    island: 'melemele', poi: 'verdant-cavern', captain: 'Ilima', order: 1, recommendedLevel: 12,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Ilima at the cavern mouth.', params: { cutscene: 'trial_ilima_intro' }, music: 'bgm/trial_intro' },
      { id: 'find-dens', kind: 'gather', objective: 'Search three Pokémon dens.', params: { target: 'den', count: 3, hint: 'Disturbed earth marks an occupied burrow.' }, music: 'bgm/trial_explore' },
      { id: 'ambush', kind: 'battle', objective: 'Survive the den ambushes.', params: { encounters: 3, species: 'RATTATA_ALOLA' } },
      { id: 'deep-chamber', kind: 'traverse', objective: 'Descend to the deepest chamber.', params: { marker: 'verdant_deep' } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Gumshoos.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'GUMSHOOS', level: 14, scale: 1.9,
      auraBoosts: { def: 1 }, ability: 'stakeout',
      heldItem: 'sitrus-berry',
      moves: ['tackle', 'crunch', 'scratch', 'quick-attack'],
      sosAllies: [
        { species: 'YUNGOOS', level: 12, atHpPercent: 0.66 },
        { species: 'RATTATA_ALOLA', level: 12, atHpPercent: 0.33 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Stakeout', description: 'It watches, unblinking, and punishes every switch.' },
        { atHpPercent: 0.5, name: 'Flush Out', description: 'It calls the colony and the burrows open all at once.', arenaEvent: 'collapse_pillars', boosts: { atk: 1 } },
      ],
    },
    reward: 'normalium-z',
    description: 'A burrow network under Melemele’s eastern hill. The Totem has been eating very well.',
  },
  {
    id: 'brooklet-hill', name: 'Trial of Brooklet Hill',
    island: 'akala', poi: 'brooklet-hill', captain: 'Lana', order: 2, recommendedLevel: 22,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Lana at the lower pools.', params: { cutscene: 'trial_lana_intro' }, music: 'bgm/trial_intro' },
      { id: 'ride-lapras', kind: 'traverse', objective: 'Ride upstream against the current.', params: { ride: 'LAPRAS', marker: 'brooklet_upper' }, music: 'bgm/trial_explore' },
      { id: 'splash-puzzle', kind: 'puzzle', objective: 'Read the splashes to find what is hiding.', params: { puzzle: 'splash_sequence', attempts: 3 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Wishiwashi.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'WISHIWASHI', level: 24, scale: 3.4,
      auraBoosts: { def: 2 }, ability: 'schooling',
      heldItem: 'sitrus-berry',
      moves: ['aqua-jet', 'surf', 'protect', 'tackle'],
      sosAllies: [
        { species: 'MAGIKARP', level: 20, atHpPercent: 0.7 },
        { species: 'FINNEON', level: 22, atHpPercent: 0.4 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Solo', description: 'One small fish, absurdly overconfident.' },
        { atHpPercent: 0.8, name: 'School Form', description: 'The pool erupts. Thousands converge into one shape.', arenaEvent: 'water_rise', boosts: { atk: 2, spa: 2 } },
        { atHpPercent: 0.3, name: 'Breaking', description: 'The school frays at the edges and fights harder for it.', arenaEvent: 'whirlpool', boosts: { spe: 2 } },
      ],
    },
    reward: 'waterium-z',
    description: 'Terraced pools up a wooded hillside. Something under the surface is much larger than it looks.',
  },
  {
    id: 'lush-jungle', name: 'Trial of Lush Jungle',
    island: 'akala', poi: 'lush-jungle', captain: 'Mallow', order: 3, recommendedLevel: 24,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Mallow at the trailhead.', params: { cutscene: 'trial_mallow_intro' }, music: 'bgm/trial_intro' },
      { id: 'gather', kind: 'gather', objective: 'Gather four ingredients from the canopy.', params: { target: 'ingredient', count: 4 }, music: 'bgm/trial_explore' },
      { id: 'hazards', kind: 'survive', objective: 'Cross the pollen field.', params: { hazard: 'pollen', seconds: 45, damagePerSecond: 2 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Lurantis.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'LURANTIS', level: 26, scale: 2.1,
      auraBoosts: { spd: 1 }, ability: 'leaf-guard',
      heldItem: 'lum-berry',
      moves: ['solar-blade', 'razor-leaf', 'x-scissor', 'sunny-day'],
      sosAllies: [
        { species: 'CATERPIE', level: 22, atHpPercent: 0.75 },
        { species: 'GRUBBIN', level: 24, atHpPercent: 0.45 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Mimicry', description: 'It is indistinguishable from the flowers until it moves.' },
        { atHpPercent: 0.6, name: 'Harsh Light', description: 'It tears the canopy open and the sun comes through hard.', arenaEvent: 'canopy_open', boosts: { spa: 1 } },
        { atHpPercent: 0.25, name: 'Blade Dance', description: 'Every strike is a Solar Blade now, and none of them charge.', boosts: { atk: 2, spe: 1 } },
      ],
    },
    reward: 'grassium-z',
    description: 'Closed canopy, no sightlines, and a predator that has spent its life learning to look like scenery.',
  },
  {
    id: 'wela-volcano', name: 'Trial of Wela Volcano',
    island: 'akala', poi: 'wela-volcano', captain: 'Kiawe', order: 4, recommendedLevel: 26,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Kiawe on the caldera rim.', params: { cutscene: 'trial_kiawe_intro' }, music: 'bgm/trial_intro' },
      { id: 'dance', kind: 'puzzle', objective: 'Recall the dance. Spot the differences.', params: { puzzle: 'dance_recall', rounds: 3, tolerance: 1 }, music: 'bgm/trial_dance' },
      { id: 'lava-cross', kind: 'survive', objective: 'Cross the active flow.', params: { hazard: 'heat', seconds: 60, damagePerSecond: 4 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Marowak.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'MAROWAK_ALOLA', level: 28, scale: 2.0,
      auraBoosts: { def: 1, spd: 1 }, ability: 'cursed-body',
      heldItem: 'sitrus-berry',
      moves: ['flamethrower', 'shadow-claw', 'stone-edge', 'ember'],
      sosAllies: [
        { species: 'SALANDIT', level: 26, atHpPercent: 0.7 },
        { species: 'SALANDIT', level: 27, atHpPercent: 0.35 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Vigil', description: 'It dances for the dead and does not look up.' },
        { atHpPercent: 0.55, name: 'Pyre', description: 'The caldera answers. Fire columns rise on the beat.', arenaEvent: 'lava_geysers', boosts: { spa: 1, spe: 1 } },
        { atHpPercent: 0.2, name: 'Last Rite', description: 'The bone burns white and it stops defending entirely.', boosts: { atk: 2 } },
      ],
    },
    reward: 'firium-z',
    description: 'A trial held on the rim of a live volcano, which the captain considers unremarkable.',
  },
  {
    id: 'hokulani', name: 'Trial of Hokulani Observatory',
    island: 'ulaula', poi: 'hokulani-observatory', captain: 'Sophocles', order: 5, recommendedLevel: 36,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Sophocles at the lift.', params: { cutscene: 'trial_sophocles_intro' }, music: 'bgm/trial_intro' },
      { id: 'power', kind: 'puzzle', objective: 'Restore power to the dome.', params: { puzzle: 'circuit_route', nodes: 7 }, music: 'bgm/trial_tech' },
      { id: 'blackout', kind: 'survive', objective: 'Hold the generator through the surge.', params: { hazard: 'shock', seconds: 40, damagePerSecond: 3 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Vikavolt.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'VIKAVOLT', level: 38, scale: 1.8,
      auraBoosts: { spa: 1, spe: 1 }, ability: 'levitate',
      heldItem: 'life-orb',
      moves: ['thunderbolt', 'air-slash', 'x-scissor', 'flash-cannon'],
      sosAllies: [
        { species: 'GRUBBIN', level: 34, atHpPercent: 0.7 },
        { species: 'GEODUDE_ALOLA', level: 36, atHpPercent: 0.4 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Hover', description: 'It holds station above the dome, out of reach.' },
        { atHpPercent: 0.6, name: 'Overcharge', description: 'It drains the observatory and the lights go out in stages.', arenaEvent: 'lights_out', boosts: { spa: 2 } },
        { atHpPercent: 0.25, name: 'Railgun', description: 'It stops flying and starts aiming.', arenaEvent: 'sparks', boosts: { spe: 2 } },
      ],
    },
    reward: 'electrium-z',
    description: 'An observatory at 2000 metres, losing power, with something enormous in the dome.',
  },
  {
    id: 'thrifty-megamart', name: 'Trial of the Abandoned Megamart',
    island: 'ulaula', poi: 'thrifty-megamart', captain: 'Acerola', order: 6, recommendedLevel: 40,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Meet Acerola in the car park.', params: { cutscene: 'trial_acerola_intro' }, music: 'bgm/trial_intro' },
      { id: 'photograph', kind: 'gather', objective: 'Photograph three disturbances.', params: { target: 'apparition', count: 3 }, music: 'bgm/trial_haunt' },
      { id: 'dark-aisles', kind: 'traverse', objective: 'Reach the stockroom in the dark.', params: { marker: 'megamart_stockroom', lightRadius: 6 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Mimikyu.', params: {}, music: 'bgm/totem_battle' },
    ],
    totem: {
      species: 'MIMIKYU', level: 42, scale: 1.7,
      auraBoosts: { spe: 1 }, ability: 'disguise',
      heldItem: 'focus-sash',
      moves: ['shadow-claw', 'play-rough', 'protect', 'quick-attack'],
      sosAllies: [
        { species: 'GRIMER_ALOLA', level: 38, atHpPercent: 0.7 },
        { species: 'RATICATE_ALOLA', level: 40, atHpPercent: 0.4 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Disguise', description: 'The rag absorbs the first blow, whatever it was.' },
        { atHpPercent: 0.7, name: 'Busted', description: 'The disguise tears. Something underneath moves wrong.', arenaEvent: 'lights_flicker', boosts: { atk: 1 } },
        { atHpPercent: 0.3, name: 'Alone', description: 'It stops performing. The aisles go completely silent.', arenaEvent: 'silence', boosts: { spe: 2, atk: 1 } },
      ],
    },
    reward: 'ghostium-z',
    description: 'A supermarket closed for eleven years, with the fluorescents still coming on at dusk.',
  },
  {
    id: 'vast-poni-canyon', name: 'Trial of Vast Poni Canyon',
    island: 'poni', poi: 'vast-poni-canyon', captain: '', order: 7, recommendedLevel: 52,
    stages: [
      { id: 'enter', kind: 'cinematic', objective: 'Enter the canyon alone.', params: { cutscene: 'trial_poni_intro' }, music: 'bgm/trial_lonely' },
      { id: 'descend', kind: 'traverse', objective: 'Descend to the canyon floor.', params: { marker: 'poni_floor', fallDamage: true }, music: 'bgm/trial_explore' },
      { id: 'climb', kind: 'traverse', objective: 'Climb the far wall.', params: { marker: 'poni_summit', ride: 'MUDSDALE' } },
      { id: 'rockfall', kind: 'survive', objective: 'Survive the rockfall.', params: { hazard: 'rockfall', seconds: 50, damagePerSecond: 5 } },
      { id: 'totem', kind: 'boss', objective: 'Defeat the Totem Kommo-o.', params: {}, music: 'bgm/totem_final' },
    ],
    totem: {
      species: 'KOMMO_O', level: 54, scale: 2.2,
      auraBoosts: { def: 1, spd: 1, atk: 1 }, ability: 'bulletproof',
      heldItem: 'life-orb',
      moves: ['clanging-scales', 'close-combat', 'dragon-claw', 'protect'],
      sosAllies: [
        { species: 'GEODUDE_ALOLA', level: 50, atHpPercent: 0.75 },
        { species: 'MUDSDALE', level: 52, atHpPercent: 0.45 },
      ],
      phases: [
        { atHpPercent: 1.0, name: 'Challenge', description: 'It rattles its scales and waits to see whether you turn around.' },
        { atHpPercent: 0.65, name: 'Clanging', description: 'The sound comes off both walls at once and does not stop.', arenaEvent: 'rockfall', boosts: { spa: 1 } },
        { atHpPercent: 0.35, name: 'Scale Shed', description: 'It sheds armour for speed and commits to the exchange.', arenaEvent: 'dust_cloud', boosts: { spe: 2, atk: 1 } },
        { atHpPercent: 0.1, name: 'Last Stand', description: 'No more posturing. It fights like it intends to die there.', boosts: { atk: 2, spe: 1 } },
      ],
    },
    reward: 'dragonium-z',
    description: 'No captain, no markers, no one to call. The canyon is the trial and the Totem is only the end of it.',
  },
];

const byId = new Map(TRIALS.map((t) => [t.id, t]));

export function getTrial(id: string): TrialDefinition {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown trial "${id}".`);
  return t;
}

export function trialsForIsland(islandId: string): readonly TrialDefinition[] {
  return TRIALS.filter((t) => t.island === islandId).sort((a, b) => a.order - b.order);
}

export function allTrials(): readonly TrialDefinition[] {
  return TRIALS;
}
