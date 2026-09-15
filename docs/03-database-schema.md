# Database Schema

**Document owner:** Senior Network Engineer
**Scope:** Server-side persistence for online features. Single-player saves are
covered separately in `07-save-system.md`.

---

## 1. What is and is not in a database

A guiding decision, because it shapes everything below:

> **The world is not in the database. The world is a seed.**

Terrain, biome placement, wild Pokémon populations and weather are all pure
functions of `(worldSeed, position, time)`. Storing them would mean persisting
hundreds of megabytes per shard to reproduce something a function reproduces
for free.

What *is* persisted is what players changed: their characters, their Pokémon,
their progress, their social graph, and the handful of world modifications that
must outlive a session.

## 2. Storage tiers

| Tier | Technology | Holds | Why |
|---|---|---|---|
| Authoritative | PostgreSQL 16 | Accounts, Pokémon, progress, trades, guilds | Needs transactions and referential integrity |
| Session | Redis 7 | Presence, matchmaking, shard routing, rate limits | Ephemeral, needs sub-ms reads |
| Analytics | ClickHouse | Telemetry events | Append-only, columnar, never read transactionally |
| Blob | S3-compatible | Photos, replays, save exports | Large, immutable, cheap |

The tier split matters most for **trades**, which must be atomic across two
accounts. That is a transaction, which is why the authoritative tier is a
relational database and not a document store.

## 3. Core schema

```sql
-- ─────────────────────────────────────────────────────────── accounts

CREATE TABLE account (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT UNIQUE NOT NULL,   -- platform identity, never an email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ,
  region          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','deleted')),
  -- Soft delete: regulatory erasure sets this and a job hard-deletes later.
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE trainer (
  id              BIGSERIAL PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  world_seed      BIGINT NOT NULL,        -- fixed at creation, never changes
  -- Appearance is a small integer vector, not a blob. See 06-ui-architecture.
  appearance      JSONB NOT NULL,
  outfit          JSONB NOT NULL,
  money           INTEGER NOT NULL DEFAULT 3000 CHECK (money >= 0),
  battle_points   INTEGER NOT NULL DEFAULT 0 CHECK (battle_points >= 0),
  playtime_sec    INTEGER NOT NULL DEFAULT 0,
  current_island  TEXT NOT NULL DEFAULT 'melemele',
  position        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id)                     -- one trainer per account for now
);

CREATE INDEX trainer_display_name_idx ON trainer (lower(display_name));

-- ─────────────────────────────────────────────────────────── Pokémon

CREATE TABLE pokemon (
  id              BIGSERIAL PRIMARY KEY,
  -- Owner is nullable: a traded-away Pokémon keeps its row and its history.
  trainer_id      BIGINT REFERENCES trainer(id) ON DELETE SET NULL,
  species_id      TEXT NOT NULL,          -- stable id, e.g. 'PIKACHU'
  form            SMALLINT NOT NULL DEFAULT 0,
  nickname        TEXT,
  level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 100),
  exp             INTEGER NOT NULL DEFAULT 0,

  -- The personality value is the seed every cosmetic and IV roll derives from.
  -- Storing it means we never have to store what it derives.
  personality     BIGINT NOT NULL,
  shiny           BOOLEAN NOT NULL DEFAULT false,
  alpha           BOOLEAN NOT NULL DEFAULT false,
  gender          TEXT NOT NULL CHECK (gender IN ('male','female','genderless')),
  nature          TEXT NOT NULL,
  ability         TEXT NOT NULL,
  held_item       TEXT,
  scale           REAL NOT NULL DEFAULT 1.0 CHECK (scale BETWEEN 0.5 AND 2.5),

  ivs             JSONB NOT NULL,
  evs             JSONB NOT NULL,
  moves           JSONB NOT NULL,         -- [{id, pp}]
  current_hp      SMALLINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'none',
  friendship      SMALLINT NOT NULL DEFAULT 70,

  -- Provenance. Never rewritten, including on trade — this is what makes a
  -- traded Pokémon's history legible and what anti-cheat audits against.
  original_trainer_id BIGINT REFERENCES trainer(id) ON DELETE SET NULL,
  met_location    TEXT NOT NULL,
  met_level       SMALLINT NOT NULL,
  met_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  world_seed      BIGINT NOT NULL,        -- which world it was caught in

  -- Storage location. box = NULL means it is in the active party.
  box             SMALLINT,
  slot            SMALLINT NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pokemon_trainer_idx  ON pokemon (trainer_id, box, slot);
CREATE INDEX pokemon_species_idx  ON pokemon (species_id);
-- Partial index: shiny lookups are frequent (leaderboards, showcases) and
-- shinies are ~0.02% of rows, so indexing only them is nearly free.
CREATE INDEX pokemon_shiny_idx    ON pokemon (trainer_id) WHERE shiny;

-- One party slot per trainer per position, enforced rather than assumed.
CREATE UNIQUE INDEX pokemon_party_slot_idx
  ON pokemon (trainer_id, slot) WHERE box IS NULL;

-- ─────────────────────────────────────────────────────────── progress

CREATE TABLE trainer_progress (
  trainer_id      BIGINT PRIMARY KEY REFERENCES trainer(id) ON DELETE CASCADE,
  flags           TEXT[] NOT NULL DEFAULT '{}',
  trials_done     TEXT[] NOT NULL DEFAULT '{}',
  grand_trials    TEXT[] NOT NULL DEFAULT '{}',
  z_crystals      TEXT[] NOT NULL DEFAULT '{}',
  discovered      TEXT[] NOT NULL DEFAULT '{}',
  registered_rides TEXT[] NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pokédex as rows, not a JSONB blob: we query "who has seen Mimikyu" for
-- research quests and community stats, which a blob cannot index.
CREATE TABLE pokedex_entry (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  species_id      TEXT NOT NULL,
  seen            BOOLEAN NOT NULL DEFAULT false,
  caught          BOOLEAN NOT NULL DEFAULT false,
  forms_seen      SMALLINT[] NOT NULL DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ,
  first_caught_at TIMESTAMPTZ,
  PRIMARY KEY (trainer_id, species_id)
);

CREATE INDEX pokedex_species_idx ON pokedex_entry (species_id) WHERE caught;

CREATE TABLE trainer_reputation (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  faction         TEXT NOT NULL,
  value           INTEGER NOT NULL DEFAULT 0 CHECK (value BETWEEN -1000 AND 1000),
  PRIMARY KEY (trainer_id, faction)
);

CREATE TABLE quest_state (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  quest_id        TEXT NOT NULL,
  status          TEXT NOT NULL
                    CHECK (status IN ('available','active','complete','failed')),
  objectives      JSONB NOT NULL DEFAULT '{}',
  outcome         TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  PRIMARY KEY (trainer_id, quest_id)
);

-- ─────────────────────────────────────────────────────────── inventory

CREATE TABLE inventory_item (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (trainer_id, item_id)
);

-- ─────────────────────────────────────────────────────── world changes

-- Only the modifications that must outlive a session. Everything else is
-- regenerated from the seed.
CREATE TABLE world_modification (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,          -- e.g. 'boulder:mahalo_1'
  value           INTEGER NOT NULL,
  PRIMARY KEY (trainer_id, key)
);

-- ─────────────────────────────────────────────────────────── social

CREATE TABLE guild (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,
  island_theme    TEXT NOT NULL,
  founded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_limit    SMALLINT NOT NULL DEFAULT 50
);

CREATE TABLE guild_member (
  guild_id        BIGINT NOT NULL REFERENCES guild(id) ON DELETE CASCADE,
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('leader','officer','member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, trainer_id)
);

-- A trainer belongs to at most one guild.
CREATE UNIQUE INDEX guild_member_unique_idx ON guild_member (trainer_id);

CREATE TABLE friendship (
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  friend_id       BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trainer_id, friend_id),
  CHECK (trainer_id <> friend_id)
);
```

## 4. Trades — the one genuinely hard transaction

A trade moves ownership of two Pokémon between two accounts. It must be atomic:
there is no acceptable state in which one side has both or neither.

```sql
CREATE TABLE trade (
  id              BIGSERIAL PRIMARY KEY,
  initiator_id    BIGINT NOT NULL REFERENCES trainer(id),
  recipient_id    BIGINT NOT NULL REFERENCES trainer(id),
  initiator_pokemon BIGINT NOT NULL REFERENCES pokemon(id),
  recipient_pokemon BIGINT REFERENCES pokemon(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','cancelled','completed','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  CHECK (initiator_id <> recipient_id)
);

-- Immutable audit log. Written inside the same transaction as the swap, so a
-- completed trade always has a record and a record always has a trade.
CREATE TABLE trade_log (
  id              BIGSERIAL PRIMARY KEY,
  trade_id        BIGINT NOT NULL REFERENCES trade(id),
  pokemon_id      BIGINT NOT NULL,
  from_trainer    BIGINT,
  to_trainer      BIGINT,
  species_id      TEXT NOT NULL,
  level           SMALLINT NOT NULL,
  shiny           BOOLEAN NOT NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The execution, with the locking order that prevents deadlock:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;

-- Lock both Pokémon rows in a deterministic order (ascending id). Two
-- simultaneous trades involving the same pair would otherwise deadlock.
SELECT id, trainer_id FROM pokemon
 WHERE id IN ($1, $2)
 ORDER BY id
   FOR UPDATE;

-- Verify ownership has not changed since the offer was made.
-- (Application checks the returned trainer_ids match the trade row.)

UPDATE pokemon SET trainer_id = $recipient, box = NULL, slot = $slotA,
                   updated_at = now()
 WHERE id = $1;
UPDATE pokemon SET trainer_id = $initiator, box = NULL, slot = $slotB,
                   updated_at = now()
 WHERE id = $2;

INSERT INTO trade_log (...) VALUES (...), (...);
UPDATE trade SET status = 'completed', completed_at = now() WHERE id = $trade;

COMMIT;
```

Note that `original_trainer_id` and `met_*` are deliberately **not** touched.
A traded Pokémon carries its origin forever; that is both a design promise to
players and the foundation of cheat detection.

## 5. Competitive and events

```sql
CREATE TABLE ranked_season (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  format          TEXT NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL
);

CREATE TABLE ranked_standing (
  season_id       INTEGER NOT NULL REFERENCES ranked_season(id),
  trainer_id      BIGINT NOT NULL REFERENCES trainer(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL DEFAULT 1500,
  -- Glicko-2 deviation: a new player's 1500 means far less than a veteran's.
  deviation       REAL NOT NULL DEFAULT 350,
  volatility      REAL NOT NULL DEFAULT 0.06,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, trainer_id)
);

CREATE INDEX ranked_leaderboard_idx
  ON ranked_standing (season_id, rating DESC);

-- A battle is stored as a seed plus an input log, not a state dump. A
-- five-minute battle is a few hundred bytes.
CREATE TABLE battle_record (
  id              BIGSERIAL PRIMARY KEY,
  season_id       INTEGER REFERENCES ranked_season(id),
  format          TEXT NOT NULL,
  seed            BIGINT NOT NULL,
  participants    BIGINT[] NOT NULL,
  teams           JSONB NOT NULL,
  input_log       JSONB NOT NULL,
  winner          SMALLINT,
  turns           SMALLINT NOT NULL,
  played_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Storing replays as `(seed, teams, input log)` is only possible because the
battle engine is deterministic. It is a ~1000× storage saving over per-turn
state snapshots, and it means a replay can be re-simulated at any fidelity.

## 6. Redis keyspace

```
presence:{trainerId}          HASH   shard, island, position, ttl 60s
shard:{shardId}:players       SET    trainer ids on this shard
matchmaking:{format}:{bracket} ZSET  rating → trainerId
trade:pending:{trainerId}     LIST   inbound offers
ratelimit:{trainerId}:{action} STRING counter with TTL
event:active                  HASH   live world events and their end times
```

Everything in Redis is reconstructible. Losing it drops players to a
reconnect, never to data loss.

## 7. Migration policy

1. **Additive first.** New columns are nullable or defaulted. A deploy must be
   rollback-safe, which means the previous build has to tolerate the new schema.
2. **Two-phase renames.** Add the new column, dual-write, backfill, switch
   reads, drop the old one in a later release. Never in one step.
3. **No blocking migrations on `pokemon`.** It is the largest table by orders
   of magnitude; anything that rewrites it runs as a batched background job.
4. **Every migration has a down.** Untested rollbacks are not rollbacks.

## 8. Retention and privacy

| Data | Retention | Notes |
|---|---|---|
| Account, trainer, Pokémon | Until deletion requested | Soft delete, then 30-day hard delete |
| Trade log | 2 years | Anti-fraud; anonymised after |
| Battle records | 1 year (ranked), 30 days (casual) | |
| Telemetry | 13 months | Aggregated beyond that |
| Chat | 30 days | Moderation only |
| Photos | Until deleted by owner | |

`external_id` is a platform identifier, never an email address. The
authoritative database stores no contact information at all; that lives with
the platform account system, which reduces the blast radius of a breach to
game state.
