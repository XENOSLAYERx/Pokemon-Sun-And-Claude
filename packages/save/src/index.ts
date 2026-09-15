/** @alola/save — versioned, migration-safe persistence. */
export { CURRENT_SAVE_VERSION } from './schema.ts';
export type {
  SaveFile, SavedPokemon, SavedPlayer, SavedProgress, SavedWorld, SavedInventory, RawSave,
} from './schema.ts';
export { MIGRATIONS, migrate, canMigrate } from './migrations.ts';
export type { Migration } from './migrations.ts';
export { SaveManager, MemoryStorage } from './manager.ts';
export type { SaveStorage, SaveSlotInfo, LoadResult } from './manager.ts';
