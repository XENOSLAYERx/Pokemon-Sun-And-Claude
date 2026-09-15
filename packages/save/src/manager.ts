/**
 * Save manager.
 *
 * Handles checksums, migration, slot management and the autosave policy, and
 * is deliberately storage-agnostic: it takes a `SaveStorage` so the same code
 * serves localStorage in the browser, the filesystem on desktop, and a cloud
 * bucket — and so it can be tested without any of them.
 *
 * The write path is the part that matters. A save interrupted mid-write (the
 * Steam Deck sleeping, a browser tab closing, a power cut) must never destroy
 * the previous save. We therefore always write to a temp key, verify it reads
 * back, and only then swap it into place.
 */
import { hashString } from '@alola/core';
import { CURRENT_SAVE_VERSION, type SaveFile, type RawSave } from './schema.ts';
import { migrate, canMigrate } from './migrations.ts';

export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/** In-memory storage. Used by tests and as the fallback when nothing else works. */
export class MemoryStorage implements SaveStorage {
  private data = new Map<string, string>();

  read(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  write(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.data.keys()]);
  }

  /** Test hook: corrupt a stored value to exercise the recovery path. */
  corrupt(key: string, replacement = '{"version":4,"garbage":true}'): void {
    this.data.set(key, replacement);
  }

  get size(): number {
    return this.data.size;
  }
}

export interface SaveSlotInfo {
  readonly slot: number;
  readonly playerName: string;
  readonly playtimeSeconds: number;
  readonly savedAt: number;
  readonly island: string;
  readonly badgeCount: number;
  readonly partyPreview: { species: string; level: number; shiny: boolean }[];
  readonly version: number;
  /** True when this save needs migrating to load. */
  readonly needsMigration: boolean;
  /** True when the file failed its checksum. */
  readonly corrupt: boolean;
}

export interface LoadResult {
  readonly save: SaveFile;
  /** Migrations applied on load, for the "save updated" notice. */
  readonly migrationsApplied: readonly string[];
  /** True when the save was recovered from a backup. */
  readonly recoveredFromBackup: boolean;
}

export class SaveManager {
  private readonly storage: SaveStorage;
  private readonly build: string;

  /** Seconds between autosaves. */
  autosaveInterval = 180;
  private sinceAutosave = 0;

  constructor(storage: SaveStorage, build = '0.1.0') {
    this.storage = storage;
    this.build = build;
  }

  private slotKey(slot: number): string {
    return `alola.save.${slot}`;
  }

  private backupKey(slot: number): string {
    return `alola.save.${slot}.backup`;
  }

  private tempKey(slot: number): string {
    return `alola.save.${slot}.tmp`;
  }

  /**
   * Checksum over the save's content.
   *
   * This detects truncation and accidental corruption, which is what it is
   * for. It is explicitly *not* anti-tamper: a determined player can edit a
   * local save and recompute the hash, and that is fine — single-player saves
   * are theirs. Competitive integrity is enforced server-side instead.
   */
  private computeChecksum(save: Omit<SaveFile, 'checksum'>): string {
    return hashString(JSON.stringify(save)).toString(16);
  }

  /** Serialise and write a save, without ever destroying the previous one. */
  async save(slot: number, data: Omit<SaveFile, 'version' | 'savedAt' | 'gameBuild' | 'checksum'>): Promise<void> {
    const body: Omit<SaveFile, 'checksum'> = {
      ...data,
      version: CURRENT_SAVE_VERSION,
      savedAt: Date.now(),
      gameBuild: this.build,
    };

    const complete: SaveFile = { ...body, checksum: this.computeChecksum(body) };
    const serialised = JSON.stringify(complete);

    // 1. Write to a temp key.
    await this.storage.write(this.tempKey(slot), serialised);

    // 2. Verify it reads back intact. If the write was truncated, we find out
    //    now — while the previous save is still the one on disk.
    const verify = await this.storage.read(this.tempKey(slot));
    if (verify !== serialised) {
      await this.storage.delete(this.tempKey(slot));
      throw new Error(`Save verification failed for slot ${slot}; the previous save is untouched.`);
    }

    // 3. Demote the current save to backup, then promote the temp file.
    const existing = await this.storage.read(this.slotKey(slot));
    if (existing !== null) {
      await this.storage.write(this.backupKey(slot), existing);
    }
    await this.storage.write(this.slotKey(slot), serialised);
    await this.storage.delete(this.tempKey(slot));

    this.sinceAutosave = 0;
  }

  /**
   * Load a slot, migrating and verifying as needed.
   * Falls back to the backup when the primary is unreadable.
   */
  async load(slot: number): Promise<LoadResult> {
    const primary = await this.tryLoad(this.slotKey(slot));
    if (primary) return { ...primary, recoveredFromBackup: false };

    const backup = await this.tryLoad(this.backupKey(slot));
    if (backup) return { ...backup, recoveredFromBackup: true };

    throw new Error(`Save slot ${slot} is empty or unreadable, and no usable backup exists.`);
  }

  private async tryLoad(key: string): Promise<{ save: SaveFile; migrationsApplied: string[] } | null> {
    const raw = await this.storage.read(key);
    if (raw === null) return null;

    let parsed: RawSave;
    try {
      parsed = JSON.parse(raw) as RawSave;
    } catch {
      return null;
    }

    if (typeof parsed.version !== 'number') return null;
    if (!canMigrate(parsed.version, CURRENT_SAVE_VERSION)) return null;

    let migrationsApplied: string[] = [];
    if (parsed.version !== CURRENT_SAVE_VERSION) {
      try {
        const result = migrate(parsed, CURRENT_SAVE_VERSION);
        parsed = result.save;
        migrationsApplied = result.applied;
      } catch {
        return null;
      }
    } else {
      // Only verify the checksum on an unmigrated save: migration legitimately
      // changes the content, so the stored hash no longer applies.
      const save = parsed as unknown as SaveFile;
      const { checksum, ...body } = save;
      if (checksum !== this.computeChecksum(body)) return null;
    }

    return { save: parsed as unknown as SaveFile, migrationsApplied };
  }

  /** Read slot headers for the load menu, without deserialising everything. */
  async listSlots(): Promise<SaveSlotInfo[]> {
    const keys = await this.storage.list();
    const out: SaveSlotInfo[] = [];

    for (const key of keys) {
      const match = /^alola\.save\.(\d+)$/.exec(key);
      if (!match) continue;
      const slot = Number(match[1]);

      const raw = await this.storage.read(key);
      if (raw === null) continue;

      let parsed: RawSave;
      try {
        parsed = JSON.parse(raw) as RawSave;
      } catch {
        out.push(emptySlotInfo(slot, true));
        continue;
      }

      const version = typeof parsed.version === 'number' ? parsed.version : 0;
      const loaded = await this.tryLoad(key);

      if (!loaded) {
        out.push(emptySlotInfo(slot, true, version));
        continue;
      }

      const save = loaded.save;
      out.push({
        slot,
        playerName: save.player?.name ?? 'Unknown',
        playtimeSeconds: save.player?.playtimeSeconds ?? 0,
        savedAt: save.savedAt ?? 0,
        island: save.player?.island ?? 'melemele',
        badgeCount: save.progress?.grandTrialsCompleted?.length ?? 0,
        partyPreview: (save.party ?? []).slice(0, 6).map((p) => ({
          species: p.species,
          level: p.level,
          shiny: p.shiny,
        })),
        version,
        needsMigration: version !== CURRENT_SAVE_VERSION,
        corrupt: false,
      });
    }

    return out.sort((a, b) => a.slot - b.slot);
  }

  async deleteSlot(slot: number): Promise<void> {
    await this.storage.delete(this.slotKey(slot));
    await this.storage.delete(this.backupKey(slot));
    await this.storage.delete(this.tempKey(slot));
  }

  /**
   * Advance the autosave timer.
   * Returns true when an autosave is due. The caller decides whether it is a
   * safe moment — autosaving mid-battle or mid-cutscene produces saves that
   * load into a broken state.
   */
  tickAutosave(dt: number): boolean {
    this.sinceAutosave += dt;
    return this.sinceAutosave >= this.autosaveInterval;
  }

  get timeSinceAutosave(): number {
    return this.sinceAutosave;
  }

  /** Export a save as a portable string, for cloud sync or transfer. */
  async exportSlot(slot: number): Promise<string> {
    const raw = await this.storage.read(this.slotKey(slot));
    if (raw === null) throw new Error(`Slot ${slot} is empty.`);
    return raw;
  }

  /** Import a save string into a slot, validating it first. */
  async importSlot(slot: number, data: string): Promise<LoadResult> {
    let parsed: RawSave;
    try {
      parsed = JSON.parse(data) as RawSave;
    } catch {
      throw new Error('Imported data is not valid save data.');
    }
    if (typeof parsed.version !== 'number') {
      throw new Error('Imported data has no save version.');
    }
    if (!canMigrate(parsed.version, CURRENT_SAVE_VERSION)) {
      throw new Error(
        `Imported save is version ${parsed.version}, which this build (save version ` +
          `${CURRENT_SAVE_VERSION}) cannot read.`,
      );
    }

    await this.storage.write(this.slotKey(slot), data);
    return this.load(slot);
  }
}

function emptySlotInfo(slot: number, corrupt: boolean, version = 0): SaveSlotInfo {
  return {
    slot,
    playerName: corrupt ? 'Corrupt save' : 'Empty',
    playtimeSeconds: 0,
    savedAt: 0,
    island: 'melemele',
    badgeCount: 0,
    partyPreview: [],
    version,
    needsMigration: false,
    corrupt,
  };
}
