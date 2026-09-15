# World Design Bible — Alola

**Document owner:** Creative Director + Environment Art
**Status:** Island layouts implemented in `packages/data/src/world/islands.ts`.

---

## 1. Scale

World space is metres, origin at the archipelago's centre.

| Island | Centre | Radius | Diameter | Base | Peak | Order | Levels |
|---|---|---|---|---|---|---|---|
| Melemele | (−11000, −7000) | 3,000m | 6 km | 24m | 520m | 1 | 2–18 |
| Akala | (−2000, −2000) | 4,200m | 8.4 km | 30m | 1,180m | 2 | 16–32 |
| Ula'ula | (10000, −4000) | 5,500m | 11 km | 26m | 2,050m | 3 | 30–48 |
| Poni | (3000, 9000) | 4,600m | 9.2 km | 280m | 940m | 4 | 45–70 |
| Aether | (−8000, 4000) | 900m | 1.8 km | 4m | 32m | 5 | 28–65 |

The original Melemele reads as roughly 1.5km across. Ours is 6km — the
"significantly larger" requirement made concrete, and the number every other
budget derives from.

### Ocean gaps

Verified by the content validator, which errors on overlap:

| Route | Open ocean | On a Sharpedo (~7.5 m/s) |
|---|---|---|
| Melemele ↔ Akala | 3,096m | ~7 min |
| Akala ↔ Ula'ula | 2,466m | ~5.5 min |
| Akala ↔ Poni | 3,283m | ~7.5 min |
| Ula'ula ↔ Poni | 4,665m | ~10 min |
| Akala ↔ Aether | 3,385m | ~7.5 min |

Far enough that a crossing is a journey; close enough that the destination is
on the horizon the whole way. That second property is what makes the ocean feel
navigable rather than empty.

## 2. Melemele — the starter island

*Tropical forest, surf beaches, a dormant cone at its heart.*

**Design job:** teach the world without a tutorial. Every system the player will
use for forty hours appears here at low stakes.

| Feature | Local | Height | Notes |
|---|---|---|---|
| Central cone | (400, −300) | 520m | Dormant; the island's visual anchor |
| Coastal ridge | (−900,600)→(700,1100) | 180m | Divides the two towns |
| Iki Town | (−1400, −900) | 6m | Village, pop. 180 |
| Hau'oli City | (900, 1500) | 10m | City, pop. 5,400 |
| Verdant Cavern | (1500, −1200) | −40m | Trial 1 |
| Ruins of Conflict | (−200, −1700) | 140m plateau | Tapu Koko |
| Kala'e Bay | (−2100, 1400) | Beach | Hidden, cliff-enclosed |

**Opening vista.** The player spawns on the eastern coastal cliff at
(−8540, −5580) — grass sloping to a beach, open water, and Akala and Ula'ula on
the horizon with Mount Lanakila's snowline visible.

This was chosen by sweeping the island for standable ground scoring well on
elevation, visible ocean and nearby relief. The original spawn was Iki Town's
square, which sits on a deliberately-levelled terrain feature, so the opening
view was an unbroken beige plane. The first frame a player sees establishes
what kind of world this is.

**Wildlife identity.** Pikipek and Yungoos by day; Rattata and Meowth by night.
Wingull everywhere near water. A Pikachu is uncommon and worth noticing —
thunderstorms triple its spawn weight, which is the game's first lesson that
weather is worth reading.

## 3. Akala — the volcanic island

*Jungle on its western flank, an active caldera at its centre.*

**Design job:** demonstrate that biomes are not decoration. Akala has the
sharpest internal contrast in the archipelago — you can walk from closed jungle
canopy to a lava field in twenty minutes.

| Feature | Local | Height | Notes |
|---|---|---|---|
| Wela Volcano | (1100, −800) | 1,180m | Active; caldera basin at −180m |
| Western ridge | (−1800,900)→(200,1900) | 340m | |
| Lush Jungle plateau | (−2100, −1400) | 210m | Dense jungle, closed canopy |
| Heahea City | (−2600, 1600) | 8m | Resort, pop. 3,200 |
| Paniola Town | (400, 1700) | — | Ranch town, pop. 640 |
| Konikoni City | (1800, 2100) | 12m | Market city, pop. 2,100 |
| Brooklet Hill | (−600, 2400) | Lake basin | Trial 2 |
| Ruins of Life | (2400, −2000) | 380m plateau | Tapu Lele |

Three trials on one island (Brooklet Hill, Lush Jungle, Wela Volcano) makes
Akala the densest content island, and the level band 16–32 is the game's widest.

**Bewear country.** The Lush Jungle plateau is where Bewear and Stufful both
spawn. The encounter the AI produces — a Stufful fleeing *toward* its Bewear,
which crosses the clearing to intercept — is the island's signature moment.

## 4. Ula'ula — the largest island

*A real city, a desert, and Alola's only snowline.*

**Design job:** scale. Ula'ula is 11km across and holds the widest range of
environments, which is what makes it the island where players stop navigating
by landmark and start navigating by map.

| Feature | Local | Height | Notes |
|---|---|---|---|
| Mount Lanakila | (1600, −2600) | 2,050m | Highest point in Alola; snow above 1,100m |
| Haina Desert | (−2200, 900) | 45m dunes | Maze; markers lie, standing stones do not |
| Central ridge | (−400,−1200)→(1400,600) | 420m | |
| Malie City | (2600, 1900) | 10m | Largest settlement, pop. 7,800 |
| Tapu Village | (−400, −2400) | — | Village, pop. 120 |
| Po Town | (−3400, −1600) | 14m | Pop. 90, no services |
| Hokulani Observatory | (−1400, −2800) | 640m plateau | Trial 5 |
| Power Plant | (3400, −900) | −60m basin | Xurkitree drain the grid here |
| Ruins of Abundance | (−2900, 2300) | 180m | Tapu Bulu |
| Ultra Wormhole Site 01 | (500, −3600) | — | First confirmed wormhole |

**The snowline is real.** The terrain's temperature model uses an exaggerated
lapse rate (0.016 °C/m against a real ~0.0065) specifically so that Lanakila's
summit reads as a snowline rather than a merely cold peak. At the true rate the
summit sits near 11°C and looks like grass. Altitude has to be legible as a
climate band the player can see from the ground.

## 5. Poni — the frontier

*Barely settled, deeply carved, dangerous from the shoreline inward.*

**Design job:** remove the guard rails. No captain, no markers, one village.

| Feature | Local | Height | Notes |
|---|---|---|---|
| Vast Poni Canyon | (−1200,−1600)→(1600,1800) | −240m carve | The island's spine |
| Western ridge | (−2200,−600)→(−600,2200) | 780m | |
| Eastern cone | (1900, −1900) | 940m | Altar of the Sunne |
| Ruins of Hope | (2400, 2200) | 420m plateau | Tapu Fini; permanent fog |
| Seafolk Village | (−2800, 1900) | 8m | Pop. 210; the only settlement |
| Poni Meadow | (0, 2900) | Wetland basin | Blooms in Tapu Fini's mist |
| Resolution Cave | (−1600, −2600) | 560m highland | Guzzlord |

**Poni is a plateau, not an island with a canyon.** Its base height is 280m —
an order of magnitude above the other islands — because a 240m canyon carved
into a 34m landmass floods.

That was a real bug: the canyon cut the interior to −286m and the island filled
with sea. The fix was both raising the plateau and adding a generator-level land
floor, so no authored feature can flood an interior unless it explicitly
declares a water biome.

## 6. Aether Paradise

*White plastic and glass, and the only place in Alola with a basement.*

| Level | Contents |
|---|---|
| Surface | Docks, reception, the tour |
| Conservation Area | Artificial biodome; rescued Pokémon that may not leave |
| B1 | Research, offices |
| B2 | Secret labs; where Type: Null came from |
| B3 | Ultra Beast containment; two cells are empty |

**Design job:** tonal whiplash. Everything above the waterline is bright, calm
and benevolent. Everything below it is not. The architecture should make the
player uneasy before the story tells them to be.

No wild Pokémon spawn here by design — everything is contained or under study —
which the content validator knows about as a declared exemption rather than
flagging as a content hole.

## 7. Biome distribution

28 biomes; each island uses a characteristic subset.

| Biome | Melemele | Akala | Ula'ula | Poni | Aether |
|---|---|---|---|---|---|
| beach | ●●● | ●● | ● | ● | — |
| tropical-forest | ●●● | ●● | ● | ● | — |
| dense-jungle | ● | ●●● | — | ● | — |
| grassland | ●● | ●● | ●● | ● | — |
| volcanic-slope | ● | ●●● | — | ● | — |
| lava-field / cave | — | ●●● | — | — | — |
| desert | — | — | ●●● | — | — |
| canyon | — | — | ● | ●●● | — |
| alpine / snowfield | — | — | ●●● | — | — |
| highland | — | ● | ●● | ●●● | — |
| wetland | ● | ● | — | ●● | — |
| ruins | ● | ● | ● | ● | — |
| facility | — | — | ● | — | ●●● |
| city / town | ●● | ●●● | ●●● | ● | ● |

## 8. Landmark discipline

Every island has exactly one silhouette landmark visible from anywhere on it:

| Island | Landmark |
|---|---|
| Melemele | The central cone |
| Akala | Wela Volcano's plume |
| Ula'ula | Mount Lanakila's snowcap |
| Poni | The canyon's shadow line |
| Aether | The white platform on the horizon |

This is a navigation system, not decoration. A player who can always see one
landmark can always orient without a map, which is what makes it possible to
ship an open world where the map is not the primary interface.

## 9. Traversal

| Method | Speed | Unlocks |
|---|---|---|
| Walking | 4.5 m/s | Start |
| Sprinting | 9 m/s | Start |
| Tauros | 16 m/s, breaks obstacles | Grand trial 1 |
| Lapras | 8 m/s over water | Akala crossing |
| Sharpedo | 12 m/s over water, breaks rocks | Akala |
| Mudsdale | 6 m/s, any terrain | Poni approach |
| Stoutland | Search for buried items | Ula'ula |
| Charizard | 22 m/s flight, fast travel | Aether summit |

Charizard arriving last is deliberate: flight collapses a world's scale, so it
should only arrive once the player has earned a mental map of the place by
crossing it the slow way.

## 10. Density targets

| Space | Points of interest per km² |
|---|---|
| Starter routes | 6–8 |
| Mid-game routes | 4–6 |
| Frontier (Poni) | 2–3 |
| Open ocean | 0.5 |

Poni's deliberate sparseness is the point: emptiness is what makes a frontier
read as a frontier. The ocean's near-emptiness is what makes an island on the
horizon worth sailing toward.
