/** @alola/ui — HUD, menus and the character creator, as testable state. */
export {
  APPEARANCE_OPTIONS, CLOTHING,
  defaultAppearance, defaultOutfit, optionsForSlot, unlockedOptions,
  combinationCount, sanitiseAppearance, randomAppearance,
} from './creator/character.ts';
export type {
  OptionSet, ClothingSlot, ClothingOption, CharacterAppearance, CharacterOutfit,
} from './creator/character.ts';

export { Hud, HUD_LAYOUTS } from './hud/state.ts';
export type {
  HudElement, HudState, HudOptions, PartyMemberHud,
  Notification, NotificationKind, ContextPrompt, ObjectiveHud,
} from './hud/state.ts';

export { MenuGrid, MenuStack } from './menus/navigation.ts';
export type { MenuItem, NavDirection, MenuOptions } from './menus/navigation.ts';
