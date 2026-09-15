# Economy Architecture

**Document owner:** Game Director
**Status:** Item and reward data implemented; sinks and faucets specified.

---

## 1. What the economy is for

Not realism. An in-game economy exists to make choices meaningful. If money is
never scarce, buying is not a decision; if it is always scarce, play becomes
chores.

The target is: **a player who engages normally can afford what they need and
must choose among what they want.**

## 2. Currencies

| Currency | Earned by | Spends on | Cap |
|---|---|---|---|
| Poké Dollars (₽) | Battles, quests, selling | Consumables, clothing, services | 9,999,999 |
| Battle Points (BP) | Battle facilities, ranked | Competitive items, rare moves | 9,999 |
| Reputation | Quests, behaviour | Access and discounts, never purchasable | ±1000 |

Three currencies with **non-overlapping sinks**. BP cannot buy potions and ₽
cannot buy BP items, so neither trivialises the other. Reputation is not a
currency the player spends at all — it is a state that changes prices and opens
doors, which is what makes it feel like standing rather than points.

## 3. Faucets

| Source | Scale | Notes |
|---|---|---|
| Trainer battles | 200–8,000₽ | Scales with level and difficulty tier |
| Wild defeats | 0₽ | Deliberate — see below |
| Quest rewards | 400–60,000₽ | Main-story quests dominate |
| Selling treasure | 1,400–15,000₽ | Pearls, nuggets, comet shards |
| Selling surplus | 50% of buy price | |
| Stoutland searching | Variable | Ride ability, finds buried items |
| Battle facilities | BP | The only meaningful BP source |

**Wild Pokémon give no money.** This is a design decision with consequences:
grinding wild encounters is not an income strategy, which pushes players toward
trainers, quests and exploration. It also means the ecosystem is never something
to farm — hunting a route bare costs you (via the population model) and gains
you nothing.

## 4. Sinks

| Sink | Scale | Function |
|---|---|---|
| Poké Balls | 200–1,200₽ | The primary early-game sink |
| Healing items | 200–2,500₽ | Scales with the player's carelessness |
| Clothing | 400–4,500₽ | The main mid-game discretionary sink |
| Salon and styling | 500–3,000₽ | Cosmetic |
| Restaurants | 500–5,000₽ | Buffs plus a social space |
| Ferry and charter | 100–1,000₽ | Small, thematic |
| Player housing | 50,000₽+ | The primary late-game sink |
| Guild contributions | Variable | Group sink |

The late-game problem in every RPG economy is that money loses meaning once
consumables are trivially affordable. Housing exists specifically to absorb it:
a large, purely optional, endlessly extensible sink that converts surplus into
expression rather than power.

## 5. Reputation and pricing

```ts
priceMultiplier(faction): number   // 0.8 at kamaʻāina, 1.5 at hostile
willTrade(faction): boolean        // false at hostile
```

A hostile faction refusing service is the part that matters. A discount is a
nudge; a closed door is a consequence. It makes the branching side quests
(fight the Bewear or outsmart it) have economic weight without ever being
framed as a money decision.

## 6. Item pricing principles

1. **Sell price is half buy price**, except treasures, which exist to be sold.
2. **Key items cost nothing and cannot be sold.** Enforced by the validator.
3. **Nothing sells for more than it costs.** The validator flags any such item
   as an infinite-money exploit.
4. **Z-Crystals are never purchasable.** They are trial rewards; buying them
   would sever the connection between the island challenge and its reward.

## 7. Trading and the player economy

Player-to-player trading is Pokémon-for-Pokémon only. There is no currency
trade, no auction house, no marketplace.

That is deliberate and worth defending: a currency market turns a trading
system into a pricing system, and pricing systems attract bots, farming and
real-money trading. Keeping trade to creature-for-creature preserves it as a
social act rather than a transaction.

Every trade writes an immutable log entry, and every Pokémon keeps its origin
forever. Both exist for fraud detection rather than for the player, but the
second is also a genuine feature: a traded Pokémon's history is legible.

## 8. Anti-exploit measures

| Exploit | Mitigation |
|---|---|
| Buy-sell loops | No item sells above its purchase price (validated) |
| Duplication via trade | Trades are a single database transaction with row locks |
| Quest reward farming | Non-repeatable quests are flagged and enforced |
| Wild-encounter grinding | Wild defeats give no money at all |
| Item duplication on save scum | Server is authoritative for online play |
| Ecosystem farming | Population model reduces spawns of over-hunted species |

## 9. No monetisation

No real-money purchases of any kind. No battle pass, no cosmetic store, no
currency packs.

Stated in the vision document as a pillar and repeated here because economies
are where monetisation pressure first appears: the moment a currency exists,
someone proposes selling it. Every sink above is designed assuming that never
happens, and several of them (housing especially) would be immediately corrupted
by it.

## 10. Balance targets

| Stage | Expected balance | Time to afford |
|---|---|---|
| First trial | 1,000–3,000₽ | Basic balls and potions comfortably |
| Second island | 8,000–15,000₽ | One clothing item is a real choice |
| Fourth trial | 30,000–60,000₽ | Comfortable; clothing is routine |
| Post-game | 200,000₽+ | Housing becomes the meaningful purchase |

These are targets to test against, not predictions. The metric that matters is
the ratio of players who ever hit zero: too low and money is meaningless, too
high and the game feels stingy. Target band is 15–30% hitting zero at least
once before the second island, near zero afterwards.
