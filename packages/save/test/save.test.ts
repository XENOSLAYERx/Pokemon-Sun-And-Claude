import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SAVE_VERSION, type SaveFile, type SavedPokemon } from '../src/schema.ts';
import { MIGRATIONS, migrate, canMigrate } from '../src/migrations.ts';
import { SaveManager, MemoryStorage } from '../src/manager.ts';

function makePokemon(overrides: Partial<SavedPokemon> = {}): SavedPokemon {
  return {
    species: 'PIKACHU', form: 0, nickname: null, level: 25, exp: 15000,
    personality: 123456789, shiny: false, alpha: false, gender: 'female',
    nature: 'jolly', ability: 'static', item: null,
    moves: [{ id: 'thunderbolt', pp: 15 }, { id: 'quick-attack', pp: 30 }],
    ivs: { hp: 31, atk: 20, def: 15, spa: 31, spd: 25, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    currentHp: 70, status: 'none', friendship: 120,
    metLocation: 'Route 1', metLevel: 5, metDate: 1700000000000,
    originalTrainer: 'player-1', scale: 1.02,
    ...overrides,
  };
}

function makeSave(): Omit<SaveFile, 'version' | 'savedAt' | 'gameBuild' | 'checksum'> {
  return {
    player: {
      id: 'player-1', name: 'Kai',
      appearance: {
        bodyType: 1, skinTone: 4, hairStyle: 7, hairColor: 2,
        eyeShape: 3, eyeColor: 5, faceShape: 2, features: [1, 0, 3],
      },
      outfit: {
        hat: 'straw-hat', top: 'floral-shirt', bottom: 'shorts',
        shoes: 'sandals', bag: 'satchel', accessory: null,
        colors: { top: 3, bottom: 1 },
      },
      money: 24500, battlePoints: 120,
      position: { x: -10800, y: 32, z: -6900 }, yaw: 1.2,
      island: 'melemele', playtimeSeconds: 42000,
      registeredRides: ['TAUROS', 'LAPRAS'], currentRide: null,
    },
    party: [makePokemon(), makePokemon({ species: 'LITTEN', shiny: true, level: 30 })],
    boxes: [{ box: 0, slot: 0, pokemon: makePokemon({ species: 'WINGULL' }) }],
    inventory: {
      items: { 'poke-ball': 20, 'super-potion': 7, 'sitrus-berry': 3 },
      keyItems: ['ride-pager', 'z-ring', 'rotom-dex'],
    },
    progress: {
      flags: ['story_act1', 'trial_1_done'],
      trialsCompleted: ['verdant-cavern'],
      grandTrialsCompleted: ['hala'],
      zCrystals: ['normalium-z', 'electrium-z'],
      pokedex: {
        PIKACHU: { seen: true, caught: true, forms: [0] },
        WINGULL: { seen: true, caught: true, forms: [0] },
        BEWEAR: { seen: true, caught: false, forms: [0] },
      },
      chains: { PIKACHU: 14 },
    },
    world: {
      worldSeed: 20251115, timeOfDay: 43200,
      weather: { melemele: { current: 'clear', remaining: 900 } },
      ecology: { 'melemele:grassland': { PIKACHU: 0.9, YUNGOOS: 1.1 } },
      modifications: { 'boulder:mahalo_1': 1 },
      discovered: ['iki-town', 'hauoli-city'],
    },
    quests: { quests: {}, reputation: { melemele: 35 }, flags: ['story_act1'] },
  };
}

describe('Save round-trip', () => {
  test('saves and loads identically', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    const data = makeSave();

    await manager.save(0, data);
    const loaded = await manager.load(0);

    assert.equal(loaded.save.version, CURRENT_SAVE_VERSION);
    assert.equal(loaded.save.player.name, 'Kai');
    assert.equal(loaded.save.party.length, 2);
    assert.equal(loaded.save.party[1].shiny, true);
    assert.equal(loaded.save.world.worldSeed, 20251115);
    assert.equal(loaded.migrationsApplied.length, 0);
    assert.equal(loaded.recoveredFromBackup, false);
  });

  test('content is referenced by stable id, never by index', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());
    const raw = await manager.exportSlot(0);

    // Species and items must appear as strings, so reordering the dex cannot
    // turn someone's Pikachu into a different Pokémon.
    assert.ok(raw.includes('"species":"PIKACHU"'));
    assert.ok(raw.includes('"poke-ball"'));
    assert.ok(raw.includes('"thunderbolt"'));
  });

  test('a corrupt save falls back to the backup', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);

    const first = makeSave();
    await manager.save(0, first);

    // Second save promotes the first to backup.
    const second = makeSave();
    second.player.name = 'Second';
    await manager.save(0, second);

    // Now corrupt the primary.
    storage.corrupt('alola.save.0', 'not json at all {{{');

    const loaded = await manager.load(0);
    assert.ok(loaded.recoveredFromBackup, 'should have recovered from the backup');
    assert.equal(loaded.save.player.name, 'Kai', 'the backup holds the previous save');
  });

  test('a tampered checksum is rejected', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());

    const raw = await storage.read('alola.save.0');
    const parsed = JSON.parse(raw!) as SaveFile;
    parsed.player.money = 999999999; // Edit without recomputing the checksum.
    await storage.write('alola.save.0', JSON.stringify(parsed));

    await assert.rejects(() => manager.load(0), /unreadable|empty/i);
  });

  test('an interrupted write never destroys the existing save', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());

    // Simulate a storage layer that silently truncates writes.
    const original = storage.write.bind(storage);
    let failNext = true;
    storage.write = async (key: string, value: string): Promise<void> => {
      if (failNext && key.endsWith('.tmp')) {
        failNext = false;
        return original(key, value.slice(0, 40)); // Truncated.
      }
      return original(key, value);
    };

    const next = makeSave();
    next.player.name = 'Should not land';
    await assert.rejects(() => manager.save(0, next), /verification failed/i);

    // The original save must be intact.
    const loaded = await manager.load(0);
    assert.equal(loaded.save.player.name, 'Kai');
  });

  test('slot listing summarises without full deserialisation errors', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());
    const second = makeSave();
    second.player.name = 'Pua';
    second.player.playtimeSeconds = 100;
    await manager.save(2, second);

    const slots = await manager.listSlots();
    assert.equal(slots.length, 2);
    assert.equal(slots[0].slot, 0);
    assert.equal(slots[0].playerName, 'Kai');
    assert.equal(slots[0].partyPreview.length, 2);
    assert.equal(slots[1].playerName, 'Pua');
  });

  test('deleting a slot removes its backup too', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());
    await manager.save(0, makeSave());
    await manager.deleteSlot(0);
    assert.equal((await manager.listSlots()).length, 0);
    assert.equal(await storage.read('alola.save.0.backup'), null);
  });

  test('export and import move a save between slots', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save(0, makeSave());

    const exported = await manager.exportSlot(0);
    const imported = await manager.importSlot(3, exported);
    assert.equal(imported.save.player.name, 'Kai');
  });

  test('importing garbage is rejected with a clear message', async () => {
    const manager = new SaveManager(new MemoryStorage());
    await assert.rejects(() => manager.importSlot(0, 'nonsense'), /not valid save data/i);
    await assert.rejects(() => manager.importSlot(0, '{"foo":1}'), /no save version/i);
  });

  test('a save from a newer build is refused rather than mangled', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await assert.rejects(
      () => manager.importSlot(0, JSON.stringify({ version: CURRENT_SAVE_VERSION + 5 })),
      /cannot read/i,
    );
  });

  test('the autosave timer fires on schedule', () => {
    const manager = new SaveManager(new MemoryStorage());
    manager.autosaveInterval = 10;
    assert.equal(manager.tickAutosave(5), false);
    assert.equal(manager.tickAutosave(5), true);
  });
});

describe('Save migrations', () => {
  test('the migration chain is contiguous and reaches the current version', () => {
    const sorted = [...MIGRATIONS].sort((a, b) => a.from - b.from);
    for (let i = 0; i < sorted.length; i++) {
      assert.equal(sorted[i].to, sorted[i].from + 1, 'migrations must step by one');
      if (i > 0) {
        assert.equal(sorted[i].from, sorted[i - 1].to, 'the chain must not have gaps');
      }
      assert.ok(sorted[i].description.length > 10, 'every migration needs a description');
    }
    assert.equal(
      sorted[sorted.length - 1].to,
      CURRENT_SAVE_VERSION,
      'the chain must reach the current version',
    );
    assert.ok(canMigrate(1, CURRENT_SAVE_VERSION), 'the oldest save must still load');
  });

  test('a version-1 save migrates all the way forward', () => {
    const v1 = {
      version: 1,
      player: { name: 'Old', money: 500 },
      party: [{ species: 'PIKACHU', level: 12 }],
      inventory: { items: { 'poke-ball': 5, 'ride-pager': 1, 'z-ring': 1 } },
      progress: { pokedex: { PIKACHU: true, WINGULL: false } },
      world: { worldSeed: 42, weather: { melemele: 'rain' } },
    };

    const { save, applied } = migrate(v1, CURRENT_SAVE_VERSION);
    assert.equal(save.version, CURRENT_SAVE_VERSION);
    assert.equal(applied.length, CURRENT_SAVE_VERSION - 1);

    // v1→v2: key items moved out of the bag, scale/met data added.
    const inventory = save.inventory as { items: Record<string, number>; keyItems: string[] };
    assert.ok(!inventory.items['ride-pager'], 'key items must leave the sellable bag');
    assert.ok(inventory.keyItems.includes('ride-pager'));
    assert.ok(inventory.keyItems.includes('z-ring'));
    assert.equal(inventory.items['poke-ball'], 5, 'ordinary items must survive');

    const party = save.party as Record<string, unknown>[];
    assert.equal(party[0].scale, 1);
    assert.equal(party[0].metLevel, 12, 'met level should default to the current level');

    // v2→v3: world block gains ecology/discovered; weather becomes structured.
    const world = save.world as Record<string, unknown>;
    assert.deepEqual(world.ecology, {});
    assert.deepEqual(world.discovered, []);
    const weather = world.weather as Record<string, { current: string; remaining: number }>;
    assert.equal(weather.melemele.current, 'rain');
    assert.ok(weather.melemele.remaining > 0);

    // v3→v4: Pokédex entries become structured; Battle Points added.
    const dex = (save.progress as Record<string, unknown>).pokedex as Record<string, {
      seen: boolean; caught: boolean; forms: number[];
    }>;
    assert.equal(dex.PIKACHU.caught, true);
    assert.equal(dex.WINGULL.caught, false);
    assert.deepEqual(dex.PIKACHU.forms, [0]);
    assert.equal((save.player as Record<string, unknown>).battlePoints, 0);
  });

  test('migration is idempotent at the current version', () => {
    const current = { version: CURRENT_SAVE_VERSION, player: { name: 'X' } };
    const { save, applied } = migrate(current, CURRENT_SAVE_VERSION);
    assert.equal(applied.length, 0);
    assert.deepEqual(save, current);
  });

  test('migrations tolerate missing and malformed fields', () => {
    // A save with almost nothing in it must still come out the other side.
    const sparse = { version: 1 };
    const { save } = migrate(sparse, CURRENT_SAVE_VERSION);
    assert.equal(save.version, CURRENT_SAVE_VERSION);
    assert.ok(save.inventory, 'a missing inventory should be created');
    assert.ok(save.world, 'a missing world block should be created');
  });

  test('an old save loads through the manager and reports what changed', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await storage.write('alola.save.0', JSON.stringify({
      version: 1,
      player: { name: 'Veteran', playtimeSeconds: 900000 },
      party: [{ species: 'BEWEAR', level: 55 }],
      inventory: { items: { 'ultra-ball': 12 } },
      progress: { pokedex: {}, grandTrialsCompleted: [] },
      world: { worldSeed: 7 },
      quests: { quests: {}, reputation: {}, flags: [] },
      boxes: [],
    }));

    const loaded = await manager.load(0);
    assert.equal(loaded.save.version, CURRENT_SAVE_VERSION);
    assert.equal(loaded.save.player.name, 'Veteran');
    assert.ok(loaded.migrationsApplied.length > 0, 'the player should be told their save was updated');
    assert.ok(loaded.migrationsApplied[0].includes('1'), 'migrations should be described');
  });

  test('canMigrate refuses a version from the future', () => {
    assert.equal(canMigrate(CURRENT_SAVE_VERSION + 1, CURRENT_SAVE_VERSION), false);
    assert.equal(canMigrate(CURRENT_SAVE_VERSION, CURRENT_SAVE_VERSION), true);
  });

  test('a missing migration step is reported, not silently skipped', () => {
    assert.throws(() => migrate({ version: 99 }, CURRENT_SAVE_VERSION + 100), /No migration path/);
  });
});
