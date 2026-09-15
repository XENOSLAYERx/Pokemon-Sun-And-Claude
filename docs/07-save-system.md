# Save System

**Document owner:** Lead Gameplay Programmer
**Status:** Implemented in `packages/save`. 18 tests.

---

## 1. The stake

A player's save is 80 hours of their life. Every decision below is made from
that premise.

## 2. Four rules

### Rule 1 — Version everything

Every save records the schema version it was written with. Migrations run in
sequence to bring old saves forward. A player who stops for a year and comes
back must not lose anything.

```ts
export const CURRENT_SAVE_VERSION = 4;
```

Migrations are contiguous (`1→2→3→4`), each step is a pure function, and the
chain is verified by test to reach the current version from version 1.

### Rule 2 — Reference content by stable id, never by index

```json
{ "species": "PIKACHU", "moves": [{ "id": "thunderbolt", "pp": 15 }] }
```

Not dex slot 25, not move index 84. Reordering the dex in a patch must never
turn someone's Pikachu into a Raichu. Tested by asserting the serialised form
contains the string ids.

### Rule 3 — Store the seed, not the world

The world is regenerated from `(worldSeed, position)`. We save only what the
player **changed**: their characters, their Pokémon, their progress, and a
small map of world modifications (opened doors, moved boulders).

A complete save is a few kilobytes instead of a few hundred megabytes.

### Rule 4 — Tolerate unknown content

A save referencing a species or quest removed in a patch loads with that entry
dropped, not a crash. Tested explicitly with a quest id that does not exist.

## 3. The write path

This is the part that matters most. A save interrupted mid-write — a sleeping
Steam Deck, a closing browser tab, a power cut — must **never** destroy the
previous save.

```ts
// 1. Write to a temp key.
await this.storage.write(this.tempKey(slot), serialised);

// 2. Verify by read-back. A truncated write is discovered NOW, while the
//    previous save is still intact on disk.
const verify = await this.storage.read(this.tempKey(slot));
if (verify !== serialised) {
  await this.storage.delete(this.tempKey(slot));
  throw new Error(`Save verification failed; the previous save is untouched.`);
}

// 3. Demote current to backup, promote temp.
const existing = await this.storage.read(this.slotKey(slot));
if (existing !== null) await this.storage.write(this.backupKey(slot), existing);
await this.storage.write(this.slotKey(slot), serialised);
await this.storage.delete(this.tempKey(slot));
```

Tested by injecting a storage layer that silently truncates writes, and
asserting the original save survives intact.

## 4. The read path

1. Parse the primary. If it fails, try the backup.
2. Check the version is migratable. A save from a *newer* build is refused
   rather than mangled.
3. Migrate if needed.
4. Verify the checksum — **only on an unmigrated save**, because migration
   legitimately changes the content and the stored hash no longer applies.

## 5. On checksums and tampering

The checksum detects **truncation and corruption**. That is what it is for.

It is explicitly *not* anti-tamper. A determined player can edit a local save
and recompute the hash, and that is fine — single-player saves belong to the
player. Competitive integrity is enforced server-side, where the authoritative
database is the source of truth for anything that affects other people.

Pretending otherwise would mean shipping obfuscation that inconveniences honest
players and delays cheaters by an afternoon.

## 6. Storage abstraction

```ts
export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}
```

Four methods. `localStorage` on web, filesystem on desktop, cloud bucket for
sync, and `MemoryStorage` for tests — which is why the write-interruption test
above is possible at all.

## 7. Migrations in practice

| Step | Change |
|---|---|
| 1→2 | Added Pokémon scale and met-data; **moved key items out of the sellable bag** |
| 2→3 | Moved ecology into the world block; weather became structured |
| 3→4 | Pokédex entries became per-form; added Battle Points |

Migrations must never throw on unexpected data. A corrupt field is defaulted,
not fatal — the alternative is telling a player their save is gone:

```ts
if (typeof p.scale !== 'number') p.scale = 1;
if (typeof p.metLevel !== 'number') p.metLevel = (p.level as number) ?? 1;
```

Tested against a version-1 save with almost nothing in it.

## 8. Autosave policy

`tickAutosave(dt)` returns true when one is due (default 180s). **The caller
decides whether it is a safe moment.** Autosaving mid-battle or mid-cutscene
produces saves that load into a broken state.

Safe points: overworld with no battle, no cutscene, no menu, grounded, not
mid-transition.

## 9. Slot management

Three slots plus autosave. The load menu shows trainer name, playtime, island,
badge count and a party preview, and marks a slot `needsMigration` or `corrupt`
so a player is never surprised.

Export and import move a save as a portable string, which is also the cloud
sync primitive.

## 10. Cloud sync

Not implemented. The design:

- Last-writer-wins by `savedAt`, with a conflict prompt showing both sides'
  playtime and location rather than silently choosing.
- Upload on autosave and on quit; download on launch.
- Conflicts are resolved by the player, never automatically. Losing progress to
  an automatic merge is worse than a moment of friction.
