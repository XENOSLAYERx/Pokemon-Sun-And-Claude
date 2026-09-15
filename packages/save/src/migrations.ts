/**
 * Save migrations.
 *
 * Each migration takes a save at version N and returns it at N+1. They run in
 * sequence, so a version-1 save loads in a version-4 build by passing through
 * every step. Migrations must be pure and must never throw on unexpected data:
 * a corrupt field should be defaulted, not fatal, because the alternative is
 * telling a player their 80-hour save is gone.
 *
 * These are illustrative of the real ones a project accumulates, and they are
 * the shape every future migration should follow.
 */
import type { RawSave } from './schema.ts';

export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  migrate(save: RawSave): RawSave;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    description: 'Add Pokémon scale variation and met-data; split key items from the bag.',
    migrate(save) {
      const party = Array.isArray(save.party) ? save.party : [];
      for (const p of party as Record<string, unknown>[]) {
        if (typeof p.scale !== 'number') p.scale = 1;
        if (typeof p.metLocation !== 'string') p.metLocation = 'unknown';
        if (typeof p.metLevel !== 'number') p.metLevel = (p.level as number) ?? 1;
        if (typeof p.metDate !== 'number') p.metDate = 0;
      }

      // Key items used to live in the main bag; move them out so they can
      // never be sold or tossed.
      const inventory = (save.inventory ?? {}) as Record<string, unknown>;
      const items = (inventory.items ?? {}) as Record<string, number>;
      const keyItems: string[] = Array.isArray(inventory.keyItems)
        ? (inventory.keyItems as string[])
        : [];
      for (const known of ['ride-pager', 'z-ring', 'rotom-dex', 'scanner-lens']) {
        if (items[known]) {
          delete items[known];
          if (!keyItems.includes(known)) keyItems.push(known);
        }
      }
      inventory.items = items;
      inventory.keyItems = keyItems;
      save.inventory = inventory;

      return save;
    },
  },
  {
    from: 2,
    to: 3,
    description: 'Move the ecosystem model into the world block; add discovered locations.',
    migrate(save) {
      const world = (save.world ?? {}) as Record<string, unknown>;
      if (world.ecology === undefined) world.ecology = {};
      if (!Array.isArray(world.discovered)) world.discovered = [];
      if (world.modifications === undefined) world.modifications = {};
      // Version 2 stored weather as a bare string per island.
      const weather = world.weather as Record<string, unknown> | undefined;
      if (weather) {
        for (const [island, value] of Object.entries(weather)) {
          if (typeof value === 'string') {
            weather[island] = { current: value, remaining: 600 };
          }
        }
      }
      save.world = world;
      return save;
    },
  },
  {
    from: 3,
    to: 4,
    description: 'Add per-form Pokédex tracking and shiny chains; add Battle Points.',
    migrate(save) {
      const progress = (save.progress ?? {}) as Record<string, unknown>;
      const dex = (progress.pokedex ?? {}) as Record<string, unknown>;

      for (const [species, entry] of Object.entries(dex)) {
        // Version 3 stored a bare boolean for "caught".
        if (typeof entry === 'boolean') {
          dex[species] = { seen: true, caught: entry, forms: [0] };
        } else if (entry && typeof entry === 'object') {
          const e = entry as Record<string, unknown>;
          if (!Array.isArray(e.forms)) e.forms = [0];
        }
      }
      progress.pokedex = dex;
      if (progress.chains === undefined) progress.chains = {};
      save.progress = progress;

      const player = (save.player ?? {}) as Record<string, unknown>;
      if (typeof player.battlePoints !== 'number') player.battlePoints = 0;
      if (!Array.isArray(player.registeredRides)) player.registeredRides = [];
      if (player.currentRide === undefined) player.currentRide = null;
      save.player = player;

      return save;
    },
  },
];

/** Run every migration needed to bring `save` to `targetVersion`. */
export function migrate(save: RawSave, targetVersion: number): { save: RawSave; applied: string[] } {
  const applied: string[] = [];
  let current = { ...save };
  let version = typeof current.version === 'number' ? current.version : 1;

  let guard = 0;
  while (version < targetVersion) {
    if (++guard > 64) {
      throw new Error(`Migration loop detected at version ${version}.`);
    }
    const migration = MIGRATIONS.find((m) => m.from === version);
    if (!migration) {
      throw new Error(
        `No migration path from save version ${version} to ${targetVersion}. ` +
          `This save was written by a newer build.`,
      );
    }
    current = migration.migrate(current);
    version = migration.to;
    current.version = version;
    applied.push(`${migration.from}→${migration.to}: ${migration.description}`);
  }

  return { save: current, applied };
}

/** Can this build load a save at the given version? */
export function canMigrate(version: number, targetVersion: number): boolean {
  if (version === targetVersion) return true;
  if (version > targetVersion) return false; // Written by a newer build.
  let v = version;
  while (v < targetVersion) {
    const m = MIGRATIONS.find((x) => x.from === v);
    if (!m) return false;
    v = m.to;
  }
  return true;
}
