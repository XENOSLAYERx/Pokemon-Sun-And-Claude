/** Item registry — the backbone of the economy and inventory systems. */

export type ItemCategory =
  | 'pokeball' | 'medicine' | 'berry' | 'battle' | 'held'
  | 'z-crystal' | 'key' | 'treasure' | 'ingredient' | 'cosmetic';

export interface ItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  /** Shop price in Poké Dollars. 0 = not sold. */
  readonly price: number;
  /** Resale value. Conventionally half of price, but overridden for treasures. */
  readonly sellPrice: number;
  readonly description: string;
  /** Can it be used outside battle? */
  readonly usableInField: boolean;
  /** Can it be used in battle? */
  readonly usableInBattle: boolean;
  /** Key items cannot be sold, tossed or traded. */
  readonly isKey: boolean;
  /** Maximum carried. */
  readonly stackLimit: number;
  /** Catch-rate multiplier for Poké Balls. */
  readonly catchMultiplier?: number;
  /** HP restored by medicine; -1 means "full". */
  readonly healAmount?: number;
  /** Status conditions cured. */
  readonly cures?: readonly string[];
  /** Z-Crystal binding. */
  readonly zMove?: string;
}

export const ITEMS: readonly ItemDefinition[] = [
  // ------------------------------------------------------------- Poké Balls
  { id: 'poke-ball', name: 'Poké Ball', category: 'pokeball', price: 200, sellPrice: 100, catchMultiplier: 1, description: 'A device for catching wild Pokémon.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'great-ball', name: 'Great Ball', category: 'pokeball', price: 600, sellPrice: 300, catchMultiplier: 1.5, description: 'A good, high-performance Ball.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'ultra-ball', name: 'Ultra Ball', category: 'pokeball', price: 1200, sellPrice: 600, catchMultiplier: 2, description: 'An ultra-performance Ball.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'dusk-ball', name: 'Dusk Ball', category: 'pokeball', price: 1000, sellPrice: 500, catchMultiplier: 3, description: 'Works well in caves and at night.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'net-ball', name: 'Net Ball', category: 'pokeball', price: 1000, sellPrice: 500, catchMultiplier: 3.5, description: 'Effective against Water- and Bug-types.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'beast-ball', name: 'Beast Ball', category: 'pokeball', price: 0, sellPrice: 10, catchMultiplier: 5, description: 'Designed for Ultra Beasts. Almost useless on anything else.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 999 },
  { id: 'master-ball', name: 'Master Ball', category: 'pokeball', price: 0, sellPrice: 0, catchMultiplier: 255, description: 'Catches any Pokémon without fail.', usableInField: false, usableInBattle: true, isKey: false, stackLimit: 1 },

  // -------------------------------------------------------------- Medicine
  { id: 'potion', name: 'Potion', category: 'medicine', price: 200, sellPrice: 100, healAmount: 20, description: 'Restores 20 HP.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'super-potion', name: 'Super Potion', category: 'medicine', price: 700, sellPrice: 350, healAmount: 60, description: 'Restores 60 HP.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'hyper-potion', name: 'Hyper Potion', category: 'medicine', price: 1500, sellPrice: 750, healAmount: 120, description: 'Restores 120 HP.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'max-potion', name: 'Max Potion', category: 'medicine', price: 2500, sellPrice: 1250, healAmount: -1, description: 'Fully restores HP.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'revive', name: 'Revive', category: 'medicine', price: 2000, sellPrice: 1000, healAmount: -1, description: 'Revives a fainted Pokémon to half HP.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'full-heal', name: 'Full Heal', category: 'medicine', price: 400, sellPrice: 200, cures: ['burn', 'freeze', 'paralysis', 'poison', 'badly-poison', 'sleep'], description: 'Cures any status condition.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'antidote', name: 'Antidote', category: 'medicine', price: 100, sellPrice: 50, cures: ['poison', 'badly-poison'], description: 'Cures poisoning.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'awakening', name: 'Awakening', category: 'medicine', price: 100, sellPrice: 50, cures: ['sleep'], description: 'Wakes a sleeping Pokémon.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },

  // ----------------------------------------------------------- Z-Crystals
  { id: 'electrium-z', name: 'Electrium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'gigavolt-havoc', description: 'Upgrades an Electric-type move into Gigavolt Havoc.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'firium-z', name: 'Firium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'inferno-overdrive', description: 'Upgrades a Fire-type move into Inferno Overdrive.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'waterium-z', name: 'Waterium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'hydro-vortex', description: 'Upgrades a Water-type move into Hydro Vortex.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'grassium-z', name: 'Grassium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'bloom-doom', description: 'Upgrades a Grass-type move into Bloom Doom.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'groundium-z', name: 'Groundium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'tectonic-rage', description: 'Upgrades a Ground-type move into Tectonic Rage.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'ghostium-z', name: 'Ghostium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'never-ending-nightmare', description: 'Upgrades a Ghost-type move into Never-Ending Nightmare.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'fightinium-z', name: 'Fightinium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'all-out-pummeling', description: 'Upgrades a Fighting-type move into All-Out Pummeling.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'icium-z', name: 'Icium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'subzero-slammer', description: 'Upgrades an Ice-type move into Subzero Slammer.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'pikanium-z', name: 'Pikanium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'catastropika', description: 'Lets Pikachu turn Volt Tackle into Catastropika.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'tapunium-z', name: 'Tapunium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'guardian-of-alola', description: 'Lets a Tapu turn Nature’s Madness into Guardian of Alola.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'solganium-z', name: 'Solganium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'searing-sunraze-smash', description: 'Lets Solgaleo turn Sunsteel Strike into Searing Sunraze Smash.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'lunalium-z', name: 'Lunalium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'menacing-moonraze-maelstrom', description: 'Lets Lunala turn Moongeist Beam into Menacing Moonraze Maelstrom.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },

  { id: 'normalium-z', name: 'Normalium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'breakneck-blitz', description: 'Upgrades a Normal-type move into Breakneck Blitz.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'dragonium-z', name: 'Dragonium Z', category: 'z-crystal', price: 0, sellPrice: 0, zMove: 'devastating-drake', description: 'Upgrades a Dragon-type move into Devastating Drake.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },

  // -------------------------------------------------------------- Held
  { id: 'leftovers', name: 'Leftovers', category: 'held', price: 0, sellPrice: 2000, description: 'Restores a little HP each turn.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'choice-band', name: 'Choice Band', category: 'held', price: 0, sellPrice: 2000, description: 'Raises Attack but locks the holder into one move.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'focus-sash', name: 'Focus Sash', category: 'held', price: 0, sellPrice: 1000, description: 'Survives one otherwise fatal hit at full HP.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'life-orb', name: 'Life Orb', category: 'held', price: 0, sellPrice: 2000, description: 'Boosts move power at the cost of the holder’s HP.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },

  // -------------------------------------------------------------- Berries
  { id: 'oran-berry', name: 'Oran Berry', category: 'berry', price: 0, sellPrice: 20, healAmount: 10, description: 'Restores 10 HP when held and low.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'sitrus-berry', name: 'Sitrus Berry', category: 'berry', price: 0, sellPrice: 50, healAmount: 25, description: 'Restores a quarter of max HP when held and low.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },
  { id: 'lum-berry', name: 'Lum Berry', category: 'berry', price: 0, sellPrice: 50, cures: ['burn', 'freeze', 'paralysis', 'poison', 'badly-poison', 'sleep'], description: 'Cures any status condition when held.', usableInField: true, usableInBattle: true, isKey: false, stackLimit: 99 },

  // ---------------------------------------------------------- Key items
  { id: 'ride-pager', name: 'Ride Pager', category: 'key', price: 0, sellPrice: 0, description: 'Summons a registered Ride Pokémon anywhere in Alola.', usableInField: true, usableInBattle: false, isKey: true, stackLimit: 1 },
  { id: 'z-ring', name: 'Z-Ring', category: 'key', price: 0, sellPrice: 0, description: 'Channels a Z-Crystal’s power into a Pokémon’s move.', usableInField: false, usableInBattle: true, isKey: true, stackLimit: 1 },
  { id: 'rotom-dex', name: 'Rotom Dex', category: 'key', price: 0, sellPrice: 0, description: 'A Pokédex possessed by a Rotom. It has opinions.', usableInField: true, usableInBattle: false, isKey: true, stackLimit: 1 },
  { id: 'scanner-lens', name: 'Scanner Lens', category: 'key', price: 0, sellPrice: 0, description: 'Reveals nearby Pokémon habitats, rare spawns and hidden treasure.', usableInField: true, usableInBattle: false, isKey: true, stackLimit: 1 },

  // --------------------------------------------------------- Treasures
  { id: 'pearl', name: 'Pearl', category: 'treasure', price: 0, sellPrice: 1400, description: 'A pretty pearl. Sells well in Konikoni City.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'big-pearl', name: 'Big Pearl', category: 'treasure', price: 0, sellPrice: 7500, description: 'A large, lustrous pearl. Sells very well.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'nugget', name: 'Nugget', category: 'treasure', price: 0, sellPrice: 5000, description: 'A nugget of pure gold.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'star-piece', name: 'Star Piece', category: 'treasure', price: 0, sellPrice: 4900, description: 'A shard of a beautiful red gem.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
  { id: 'comet-shard', name: 'Comet Shard', category: 'treasure', price: 0, sellPrice: 15000, description: 'A shard that fell from space. Found only in deep Ultra Space.', usableInField: false, usableInBattle: false, isKey: false, stackLimit: 99 },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDefinition {
  const i = byId.get(id);
  if (!i) throw new Error(`Unknown item "${id}".`);
  return i;
}

export function tryGetItem(id: string): ItemDefinition | undefined {
  return byId.get(id);
}

export function itemsOfCategory(c: ItemCategory): readonly ItemDefinition[] {
  return ITEMS.filter((i) => i.category === c);
}

export function allItems(): readonly ItemDefinition[] {
  return ITEMS;
}
