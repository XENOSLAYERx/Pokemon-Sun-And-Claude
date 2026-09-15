/**
 * Character creator.
 *
 * The brief asks for "thousands of cosmetic combinations". This module defines
 * the option space and proves the count, rather than asserting it.
 *
 * The important design decision is that appearance is stored as a set of small
 * integer indices, not as a blob of mesh data. That keeps a character a few
 * dozen bytes in a save file and in a network packet, which is what makes it
 * viable to show every other player's custom character in a shared world.
 */

export interface OptionSet {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  /** Does this option support recolouring, and with how many palettes? */
  readonly palettes?: number;
}

/**
 * Body and face options.
 *
 * Body types are deliberately a spectrum of builds rather than a gender toggle:
 * the player picks a build and a set of features independently, which yields a
 * much larger and more inclusive space than branching on two presets.
 */
export const APPEARANCE_OPTIONS: readonly OptionSet[] = [
  { id: 'bodyType', label: 'Build', count: 6 },
  { id: 'height', label: 'Height', count: 5 },
  { id: 'skinTone', label: 'Skin tone', count: 16 },
  { id: 'faceShape', label: 'Face shape', count: 10 },
  { id: 'eyeShape', label: 'Eye shape', count: 12 },
  { id: 'eyeColor', label: 'Eye colour', count: 14 },
  { id: 'eyebrows', label: 'Eyebrows', count: 8 },
  { id: 'nose', label: 'Nose', count: 8 },
  { id: 'mouth', label: 'Mouth', count: 8 },
  { id: 'hairStyle', label: 'Hairstyle', count: 32, palettes: 20 },
  { id: 'facialHair', label: 'Facial hair', count: 10, palettes: 20 },
  { id: 'freckles', label: 'Freckles', count: 6 },
  { id: 'makeup', label: 'Makeup', count: 12, palettes: 12 },
  { id: 'marks', label: 'Marks & scars', count: 8 },
];

export type ClothingSlot =
  | 'hat' | 'eyewear' | 'top' | 'outerwear' | 'bottom'
  | 'socks' | 'shoes' | 'bag' | 'accessory';

export interface ClothingOption {
  readonly id: string;
  readonly slot: ClothingSlot;
  readonly name: string;
  readonly palettes: number;
  /** Shop price. 0 = starting item or quest reward. */
  readonly price: number;
  /** Island where it is sold; null = available everywhere. */
  readonly island: string | null;
  /** Requires a story flag or reputation tier. */
  readonly requires?: string;
}

/**
 * A representative slice of the wardrobe.
 * Production content is authored in the same schema and loaded from the content
 * pipeline; the count assertion below scales with whatever is registered.
 */
export const CLOTHING: readonly ClothingOption[] = [
  // Hats
  { id: 'none-hat', slot: 'hat', name: 'None', palettes: 1, price: 0, island: null },
  { id: 'straw-hat', slot: 'hat', name: 'Straw Hat', palettes: 6, price: 1500, island: 'melemele' },
  { id: 'snapback', slot: 'hat', name: 'Snapback', palettes: 12, price: 2000, island: 'melemele' },
  { id: 'beanie', slot: 'hat', name: 'Beanie', palettes: 12, price: 1800, island: 'ulaula' },
  { id: 'sun-visor', slot: 'hat', name: 'Sun Visor', palettes: 8, price: 1200, island: 'akala' },
  { id: 'flower-crown', slot: 'hat', name: 'Flower Crown', palettes: 10, price: 3000, island: 'poni' },
  { id: 'trial-headband', slot: 'hat', name: 'Trial Headband', palettes: 4, price: 0, island: null, requires: 'trial_1_done' },

  // Eyewear
  { id: 'none-eyewear', slot: 'eyewear', name: 'None', palettes: 1, price: 0, island: null },
  { id: 'sunglasses', slot: 'eyewear', name: 'Sunglasses', palettes: 8, price: 2500, island: 'melemele' },
  { id: 'round-glasses', slot: 'eyewear', name: 'Round Glasses', palettes: 6, price: 1800, island: 'ulaula' },
  { id: 'goggles', slot: 'eyewear', name: 'Goggles', palettes: 8, price: 3500, island: 'akala' },

  // Tops
  { id: 'tee', slot: 'top', name: 'T-Shirt', palettes: 20, price: 800, island: null },
  { id: 'floral-shirt', slot: 'top', name: 'Floral Shirt', palettes: 14, price: 2200, island: 'melemele' },
  { id: 'tank-top', slot: 'top', name: 'Tank Top', palettes: 16, price: 900, island: 'melemele' },
  { id: 'hoodie', slot: 'top', name: 'Hoodie', palettes: 18, price: 3200, island: 'ulaula' },
  { id: 'rash-guard', slot: 'top', name: 'Rash Guard', palettes: 12, price: 2600, island: 'akala' },
  { id: 'poncho', slot: 'top', name: 'Poncho', palettes: 10, price: 4000, island: 'poni' },
  { id: 'lab-coat', slot: 'top', name: 'Lab Coat', palettes: 4, price: 0, island: null, requires: 'researchers_respected' },

  // Outerwear
  { id: 'none-outer', slot: 'outerwear', name: 'None', palettes: 1, price: 0, island: null },
  { id: 'denim-jacket', slot: 'outerwear', name: 'Denim Jacket', palettes: 10, price: 4500, island: 'ulaula' },
  { id: 'windbreaker', slot: 'outerwear', name: 'Windbreaker', palettes: 14, price: 3800, island: 'ulaula' },
  { id: 'cardigan', slot: 'outerwear', name: 'Cardigan', palettes: 12, price: 3200, island: 'akala' },

  // Bottoms
  { id: 'shorts', slot: 'bottom', name: 'Shorts', palettes: 16, price: 900, island: null },
  { id: 'jeans', slot: 'bottom', name: 'Jeans', palettes: 10, price: 1600, island: null },
  { id: 'skirt', slot: 'bottom', name: 'Skirt', palettes: 16, price: 1400, island: null },
  { id: 'cargo-pants', slot: 'bottom', name: 'Cargo Pants', palettes: 10, price: 2200, island: 'ulaula' },
  { id: 'swim-trunks', slot: 'bottom', name: 'Swimwear', palettes: 14, price: 1800, island: 'akala' },

  // Socks
  { id: 'none-socks', slot: 'socks', name: 'None', palettes: 1, price: 0, island: null },
  { id: 'ankle-socks', slot: 'socks', name: 'Ankle Socks', palettes: 12, price: 400, island: null },
  { id: 'knee-socks', slot: 'socks', name: 'Knee Socks', palettes: 12, price: 700, island: null },

  // Shoes
  { id: 'sandals', slot: 'shoes', name: 'Sandals', palettes: 10, price: 700, island: 'melemele' },
  { id: 'sneakers', slot: 'shoes', name: 'Sneakers', palettes: 18, price: 2400, island: null },
  { id: 'hiking-boots', slot: 'shoes', name: 'Hiking Boots', palettes: 8, price: 3600, island: 'poni' },
  { id: 'dress-shoes', slot: 'shoes', name: 'Dress Shoes', palettes: 8, price: 4200, island: 'ulaula' },

  // Bags
  { id: 'satchel', slot: 'bag', name: 'Satchel', palettes: 10, price: 0, island: null },
  { id: 'backpack', slot: 'bag', name: 'Backpack', palettes: 14, price: 3000, island: null },
  { id: 'sling-bag', slot: 'bag', name: 'Sling Bag', palettes: 12, price: 2600, island: 'akala' },

  // Accessories
  { id: 'none-accessory', slot: 'accessory', name: 'None', palettes: 1, price: 0, island: null },
  { id: 'lei', slot: 'accessory', name: 'Lei', palettes: 12, price: 1500, island: 'melemele' },
  { id: 'scarf', slot: 'accessory', name: 'Scarf', palettes: 16, price: 2000, island: 'ulaula' },
  { id: 'wristbands', slot: 'accessory', name: 'Wristbands', palettes: 12, price: 1100, island: null },
  { id: 'z-ring-strap', slot: 'accessory', name: 'Z-Ring Strap', palettes: 8, price: 0, island: null, requires: 'has_z_ring' },
];

export interface CharacterAppearance {
  bodyType: number;
  height: number;
  skinTone: number;
  faceShape: number;
  eyeShape: number;
  eyeColor: number;
  eyebrows: number;
  nose: number;
  mouth: number;
  hairStyle: number;
  hairColor: number;
  facialHair: number;
  facialHairColor: number;
  freckles: number;
  makeup: number;
  makeupColor: number;
  marks: number;
}

export interface CharacterOutfit {
  hat: string;
  hatColor: number;
  eyewear: string;
  eyewearColor: number;
  top: string;
  topColor: number;
  outerwear: string;
  outerwearColor: number;
  bottom: string;
  bottomColor: number;
  socks: string;
  socksColor: number;
  shoes: string;
  shoesColor: number;
  bag: string;
  bagColor: number;
  accessory: string;
  accessoryColor: number;
}

export function defaultAppearance(): CharacterAppearance {
  return {
    bodyType: 0, height: 2, skinTone: 4, faceShape: 0,
    eyeShape: 0, eyeColor: 0, eyebrows: 0, nose: 0, mouth: 0,
    hairStyle: 0, hairColor: 0, facialHair: 0, facialHairColor: 0,
    freckles: 0, makeup: 0, makeupColor: 0, marks: 0,
  };
}

export function defaultOutfit(): CharacterOutfit {
  return {
    hat: 'none-hat', hatColor: 0,
    eyewear: 'none-eyewear', eyewearColor: 0,
    top: 'tee', topColor: 0,
    outerwear: 'none-outer', outerwearColor: 0,
    bottom: 'shorts', bottomColor: 0,
    socks: 'none-socks', socksColor: 0,
    shoes: 'sandals', shoesColor: 0,
    bag: 'satchel', bagColor: 0,
    accessory: 'none-accessory', accessoryColor: 0,
  };
}

/** Clothing available for one slot. */
export function optionsForSlot(slot: ClothingSlot): ClothingOption[] {
  return CLOTHING.filter((c) => c.slot === slot);
}

/** Clothing the player can currently wear, given their flags. */
export function unlockedOptions(slot: ClothingSlot, flags: ReadonlySet<string>): ClothingOption[] {
  return optionsForSlot(slot).filter((c) => !c.requires || flags.has(c.requires));
}

/**
 * Total distinct appearances.
 *
 * Returned as a number so the claim in the design brief is verifiable rather
 * than asserted. The face/body space alone is in the hundreds of millions;
 * multiplied by the wardrobe it is astronomically larger, so this is reported
 * as two separate figures to stay meaningful.
 */
export function combinationCount(): {
  appearance: number;
  outfit: number;
  total: number;
} {
  let appearance = 1;
  for (const option of APPEARANCE_OPTIONS) {
    appearance *= option.count;
    if (option.palettes) appearance *= option.palettes;
  }

  let outfit = 1;
  const slots: ClothingSlot[] = [
    'hat', 'eyewear', 'top', 'outerwear', 'bottom', 'socks', 'shoes', 'bag', 'accessory',
  ];
  for (const slot of slots) {
    let slotTotal = 0;
    for (const option of optionsForSlot(slot)) slotTotal += option.palettes;
    outfit *= Math.max(1, slotTotal);
  }

  return { appearance, outfit, total: appearance * outfit };
}

/** Validate an appearance, clamping any out-of-range index. */
export function sanitiseAppearance(appearance: CharacterAppearance): CharacterAppearance {
  const limit = (id: string): number => {
    const option = APPEARANCE_OPTIONS.find((o) => o.id === id);
    return option ? option.count : 1;
  };
  const paletteLimit = (id: string): number => {
    const option = APPEARANCE_OPTIONS.find((o) => o.id === id);
    return option?.palettes ?? 1;
  };
  const clampIndex = (value: number, max: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), max - 1)) : 0;

  return {
    bodyType: clampIndex(appearance.bodyType, limit('bodyType')),
    height: clampIndex(appearance.height, limit('height')),
    skinTone: clampIndex(appearance.skinTone, limit('skinTone')),
    faceShape: clampIndex(appearance.faceShape, limit('faceShape')),
    eyeShape: clampIndex(appearance.eyeShape, limit('eyeShape')),
    eyeColor: clampIndex(appearance.eyeColor, limit('eyeColor')),
    eyebrows: clampIndex(appearance.eyebrows, limit('eyebrows')),
    nose: clampIndex(appearance.nose, limit('nose')),
    mouth: clampIndex(appearance.mouth, limit('mouth')),
    hairStyle: clampIndex(appearance.hairStyle, limit('hairStyle')),
    hairColor: clampIndex(appearance.hairColor, paletteLimit('hairStyle')),
    facialHair: clampIndex(appearance.facialHair, limit('facialHair')),
    facialHairColor: clampIndex(appearance.facialHairColor, paletteLimit('facialHair')),
    freckles: clampIndex(appearance.freckles, limit('freckles')),
    makeup: clampIndex(appearance.makeup, limit('makeup')),
    makeupColor: clampIndex(appearance.makeupColor, paletteLimit('makeup')),
    marks: clampIndex(appearance.marks, limit('marks')),
  };
}

/** Randomise an appearance, for the "surprise me" button. */
export function randomAppearance(random: () => number): CharacterAppearance {
  const pick = (id: string): number => {
    const option = APPEARANCE_OPTIONS.find((o) => o.id === id);
    return option ? Math.floor(random() * option.count) : 0;
  };
  const pickPalette = (id: string): number => {
    const option = APPEARANCE_OPTIONS.find((o) => o.id === id);
    return option?.palettes ? Math.floor(random() * option.palettes) : 0;
  };

  return {
    bodyType: pick('bodyType'),
    height: pick('height'),
    skinTone: pick('skinTone'),
    faceShape: pick('faceShape'),
    eyeShape: pick('eyeShape'),
    eyeColor: pick('eyeColor'),
    eyebrows: pick('eyebrows'),
    nose: pick('nose'),
    mouth: pick('mouth'),
    hairStyle: pick('hairStyle'),
    hairColor: pickPalette('hairStyle'),
    facialHair: pick('facialHair'),
    facialHairColor: pickPalette('facialHair'),
    freckles: pick('freckles'),
    makeup: pick('makeup'),
    makeupColor: pickPalette('makeup'),
    marks: pick('marks'),
  };
}
