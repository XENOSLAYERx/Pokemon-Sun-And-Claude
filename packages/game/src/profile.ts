/**
 * The game profile — everything a save file holds, as live objects.
 *
 * This is the single owner of player state. The client renders it and feeds
 * input into it; it never keeps a second copy. That rule is what makes saving
 * a matter of serialising one object rather than hunting down state scattered
 * across a renderer.
 */
import { Rng, EventBus } from '@alola/core';
import { getSpecies, tryGetSpecies, allIslands } from '@alola/data';
import { QuestJournal } from '@alola/quest';
import { CURRENT_SAVE_VERSION, type SaveFile, type SavedPlayer } from '@alola/save';
import {
  defaultAppearance, defaultOutfit, type CharacterAppearance, type CharacterOutfit,
} from '@alola/ui';
import { Bag } from './bag.ts';
import {
  createPokemon, fromSaved, toSaved, healFully, isFainted, maxHpOf, reserveUid, resetUidCounter,
  type PartyPokemon,
} from './party.ts';

export const MAX_PARTY = 6;

export interface DexEntry {
  seen: boolean;
  caught: boolean;
}

export interface GameProfileOptions {
  readonly worldSeed: number;
  readonly playerName?: string;
  readonly spawn?: { x: number; y: number; z: number };
}

export class GameProfile {
  readonly worldSeed: number;

  name: string;
  readonly id: string;
  appearance: CharacterAppearance = defaultAppearance();
  outfit: CharacterOutfit = defaultOutfit();

  money = 3000;
  battlePoints = 0;
  playtimeSeconds = 0;

  position: { x: number; y: number; z: number };
  yaw = 0;
  island = 'melemele';
  currentRide: string | null = null;
  registeredRides: string[] = [];

  readonly party: PartyPokemon[] = [];
  readonly boxes: { box: number; slot: number; mon: PartyPokemon }[] = [];
  readonly bag = new Bag();

  readonly flags = new Set<string>();
  readonly trialsCompleted = new Set<string>();
  readonly grandTrialsCompleted = new Set<string>();
  readonly zCrystals = new Set<string>();
  readonly pokedex = new Map<string, DexEntry>();
  readonly shinyChains = new Map<string, number>();
  readonly discovered = new Set<string>();

  readonly quests: QuestJournal;
  readonly bus = new EventBus();

  constructor(opts: GameProfileOptions) {
    this.worldSeed = opts.worldSeed;
    this.name = opts.playerName ?? 'Trainer';
    this.id = `player-${(opts.worldSeed >>> 0).toString(16)}`;
    this.position = opts.spawn ? { ...opts.spawn } : { x: 0, y: 0, z: 0 };
    this.quests = new QuestJournal(this.bus);
  }

  // ------------------------------------------------------------ new game

  /**
   * Stock a fresh save.
   *
   * The starter is a real party member created through the same path as a
   * capture, so there is exactly one way a Pokémon comes into existence.
   */
  static newGame(opts: GameProfileOptions & { starter: string }): GameProfile {
    const profile = new GameProfile(opts);
    const rng = new Rng(opts.worldSeed).fork('new-game');

    const starter = createPokemon({
      species: opts.starter,
      level: 5,
      rng,
      metLocation: 'Iki Town',
    });
    starter.friendship = 100;
    profile.party.push(starter);
    profile.recordCaught(starter.species);

    profile.bag.add('poke-ball', 10);
    profile.bag.add('potion', 5);
    profile.bag.add('ride-pager');
    profile.bag.add('rotom-dex');

    profile.flags.add('game-started');
    profile.quests.setFlag('game-started');
    return profile;
  }

  // -------------------------------------------------------------- party

  get activePokemon(): PartyPokemon | null {
    return this.party.find((p) => !isFainted(p)) ?? null;
  }

  get hasUsablePokemon(): boolean {
    return this.party.some((p) => !isFainted(p));
  }

  /** Add a Pokémon to the party, or to the first free box slot when full. */
  addPokemon(mon: PartyPokemon): 'party' | 'box' {
    if (this.party.length < MAX_PARTY) {
      this.party.push(mon);
      return 'party';
    }
    const used = new Set(this.boxes.map((b) => b.box * 30 + b.slot));
    let index = 0;
    while (used.has(index)) index++;
    this.boxes.push({ box: Math.floor(index / 30), slot: index % 30, mon });
    return 'box';
  }

  healParty(): void {
    for (const mon of this.party) healFully(mon);
  }

  /** Swap two party slots. Used by the party screen. */
  swapParty(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= this.party.length || b >= this.party.length || a === b) return;
    const tmp = this.party[a];
    this.party[a] = this.party[b];
    this.party[b] = tmp;
  }

  // ------------------------------------------------------------- pokedex

  recordSeen(speciesId: string): boolean {
    const entry = this.pokedex.get(speciesId);
    if (entry) {
      if (entry.seen) return false;
      entry.seen = true;
      return true;
    }
    this.pokedex.set(speciesId, { seen: true, caught: false });
    return true;
  }

  recordCaught(speciesId: string): void {
    const entry = this.pokedex.get(speciesId);
    if (entry) {
      entry.seen = true;
      entry.caught = true;
    } else {
      this.pokedex.set(speciesId, { seen: true, caught: true });
    }
  }

  get dexSeen(): number {
    let n = 0;
    for (const e of this.pokedex.values()) if (e.seen) n++;
    return n;
  }

  get dexCaught(): number {
    let n = 0;
    for (const e of this.pokedex.values()) if (e.caught) n++;
    return n;
  }

  // --------------------------------------------------------------- flags

  setFlag(flag: string): void {
    this.flags.add(flag);
    this.quests.setFlag(flag);
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  /** Blackout: the player is carried back, loses money, party is healed. */
  blackOut(): number {
    const lost = Math.floor(this.money * 0.25);
    this.money -= lost;
    this.healParty();
    return lost;
  }

  // --------------------------------------------------------- persistence

  toSaveFile(world: SaveFile['world']): Omit<SaveFile, 'version' | 'savedAt' | 'gameBuild' | 'checksum'> {
    return {
      player: this.toSavedPlayer(),
      party: this.party.map(toSaved),
      boxes: this.boxes.map((b) => ({ box: b.box, slot: b.slot, pokemon: toSaved(b.mon) })),
      inventory: this.bag.toSaved(),
      progress: {
        flags: [...this.flags],
        trialsCompleted: [...this.trialsCompleted],
        grandTrialsCompleted: [...this.grandTrialsCompleted],
        zCrystals: [...this.zCrystals],
        pokedex: Object.fromEntries(
          [...this.pokedex.entries()].map(([id, e]) => [id, { seen: e.seen, caught: e.caught, forms: [0] }]),
        ),
        chains: Object.fromEntries(this.shinyChains),
      },
      world: { ...world, discovered: [...this.discovered] },
      quests: this.quests.save(),
    };
  }

  private toSavedPlayer(): SavedPlayer {
    return {
      id: this.id,
      name: this.name,
      // The creator's model is richer than the save schema's; the extra
      // sliders ride along in `features` rather than being dropped, so a save
      // round-trip does not quietly flatten someone's character.
      appearance: {
        bodyType: this.appearance.bodyType,
        skinTone: this.appearance.skinTone,
        hairStyle: this.appearance.hairStyle,
        hairColor: this.appearance.hairColor,
        eyeShape: this.appearance.eyeShape,
        eyeColor: this.appearance.eyeColor,
        faceShape: this.appearance.faceShape,
        features: [
          this.appearance.height, this.appearance.eyebrows, this.appearance.nose,
          this.appearance.mouth, this.appearance.facialHair, this.appearance.facialHairColor,
          this.appearance.freckles, this.appearance.makeup, this.appearance.makeupColor,
          this.appearance.marks,
        ],
      },
      outfit: {
        hat: this.outfit.hat,
        top: this.outfit.top,
        bottom: this.outfit.bottom,
        shoes: this.outfit.shoes,
        bag: this.outfit.bag,
        accessory: this.outfit.accessory,
        colors: {
          hat: this.outfit.hatColor, top: this.outfit.topColor,
          bottom: this.outfit.bottomColor, shoes: this.outfit.shoesColor,
          bag: this.outfit.bagColor, accessory: this.outfit.accessoryColor,
          eyewear: this.outfit.eyewearColor, outerwear: this.outfit.outerwearColor,
          socks: this.outfit.socksColor,
        },
      },
      money: this.money,
      battlePoints: this.battlePoints,
      position: { ...this.position },
      yaw: this.yaw,
      island: this.island,
      playtimeSeconds: Math.floor(this.playtimeSeconds),
      registeredRides: [...this.registeredRides],
      currentRide: this.currentRide,
    };
  }

  /** Rebuild a profile from a loaded save. Unknown content is dropped, not fatal. */
  static fromSaveFile(save: SaveFile): GameProfile {
    resetUidCounter(1);
    const profile = new GameProfile({
      worldSeed: save.world.worldSeed,
      playerName: save.player.name,
      spawn: save.player.position,
    });

    profile.yaw = save.player.yaw ?? 0;
    profile.island = save.player.island ?? 'melemele';
    profile.money = save.player.money ?? 0;
    profile.battlePoints = save.player.battlePoints ?? 0;
    profile.playtimeSeconds = save.player.playtimeSeconds ?? 0;
    profile.registeredRides = [...(save.player.registeredRides ?? [])];
    profile.currentRide = save.player.currentRide ?? null;

    const appearance = save.player.appearance;
    if (appearance) {
      const features = appearance.features ?? [];
      profile.appearance = {
        ...defaultAppearance(),
        bodyType: appearance.bodyType, skinTone: appearance.skinTone,
        hairStyle: appearance.hairStyle, hairColor: appearance.hairColor,
        eyeShape: appearance.eyeShape, eyeColor: appearance.eyeColor,
        faceShape: appearance.faceShape,
        height: features[0] ?? 2, eyebrows: features[1] ?? 0, nose: features[2] ?? 0,
        mouth: features[3] ?? 0, facialHair: features[4] ?? 0, facialHairColor: features[5] ?? 0,
        freckles: features[6] ?? 0, makeup: features[7] ?? 0, makeupColor: features[8] ?? 0,
        marks: features[9] ?? 0,
      };
    }

    const outfit = save.player.outfit;
    if (outfit) {
      const colors = outfit.colors ?? {};
      profile.outfit = {
        ...defaultOutfit(),
        hat: outfit.hat ?? 'none-hat', top: outfit.top, bottom: outfit.bottom,
        shoes: outfit.shoes, bag: outfit.bag, accessory: outfit.accessory ?? 'none-accessory',
        hatColor: colors.hat ?? 0, topColor: colors.top ?? 0, bottomColor: colors.bottom ?? 0,
        shoesColor: colors.shoes ?? 0, bagColor: colors.bag ?? 0,
        accessoryColor: colors.accessory ?? 0, eyewearColor: colors.eyewear ?? 0,
        outerwearColor: colors.outerwear ?? 0, socksColor: colors.socks ?? 0,
      };
    }

    for (const saved of save.party ?? []) {
      if (!tryGetSpecies(saved.species)) continue;
      profile.party.push(fromSaved(saved));
    }
    for (const entry of save.boxes ?? []) {
      if (!tryGetSpecies(entry.pokemon.species)) continue;
      profile.boxes.push({ box: entry.box, slot: entry.slot, mon: fromSaved(entry.pokemon) });
    }

    const restoredBag = Bag.fromSaved(save.inventory ?? { items: {}, keyItems: [] });
    for (const entry of restoredBag.entries()) profile.bag.add(entry.item.id, entry.count);
    for (const id of restoredBag.keyItemIds()) profile.bag.add(id);

    const progress = save.progress;
    if (progress) {
      for (const f of progress.flags ?? []) profile.flags.add(f);
      for (const t of progress.trialsCompleted ?? []) profile.trialsCompleted.add(t);
      for (const t of progress.grandTrialsCompleted ?? []) profile.grandTrialsCompleted.add(t);
      for (const z of progress.zCrystals ?? []) profile.zCrystals.add(z);
      for (const [id, entry] of Object.entries(progress.pokedex ?? {})) {
        if (!tryGetSpecies(id)) continue;
        profile.pokedex.set(id, { seen: entry.seen, caught: entry.caught });
      }
      for (const [id, n] of Object.entries(progress.chains ?? {})) profile.shinyChains.set(id, n);
    }

    for (const d of save.world?.discovered ?? []) profile.discovered.add(d);
    if (save.quests) profile.quests.restore(save.quests);
    // Flags live in two places by design — the profile owns them, the journal
    // reacts to them — so re-push after restoring both.
    for (const f of profile.flags) profile.quests.setFlag(f);

    return profile;
  }
}

/** The island a world position sits on, for the save header and the HUD. */
export function islandNameFor(id: string): string {
  return allIslands().find((i) => i.id === id)?.name ?? 'Alola';
}

export { CURRENT_SAVE_VERSION, getSpecies, maxHpOf, isFainted, reserveUid };
