# Weather Architecture

**Document owner:** Technical Artist + Senior AI Engineer
**Status:** Implemented in `packages/world/src/weather/system.ts`.

---

## 1. The design goal

Weather that a player **plans around**.

That means it must persist long enough to be worth planning around, change
often enough to notice, and — most importantly — be *visible from elsewhere*.
Seeing a storm over Ula'ula from Melemele's shore and deciding to sail toward
it is one of the cheapest ways to make a world feel large and self-directed.

## 2. Per-island, not global

Weather is simulated independently per island. This is the single decision that
makes the goal above achievable: a global weather state cannot produce "it is
raining over there".

```ts
melemele: { clear: 5, cloudy: 3, rain: 2, thunderstorm: 1, 'harsh-sunlight': 1.5, fog: 0.4 }
akala:    { clear: 3, cloudy: 3, rain: 3.5, 'heavy-rain': 1.6, thunderstorm: 2, 'harsh-sunlight': 2 }
ulaula:   { clear: 3.5, cloudy: 2.5, sandstorm: 2.5, snow: 2, hail: 1.2, thunderstorm: 1.2 }
poni:     { clear: 2, cloudy: 3.5, rain: 2.5, fog: 3, thunderstorm: 1.5 }
```

These affinity tables are the designer-facing knob that gives each island its
felt climate. Akala is humid and stormy; Ula'ula is dry with a real snowline;
Poni is fogbound and unsettled.

Verified by test: across 3,000 ticks, Melemele and Ula'ula differ on more than
100 samples. They are supposed to.

## 3. Markov chain, not fluid simulation

A fluid simulation would be more physically faithful and far less useful. A
Markov chain over weather states is:

- **Legible to designers.** The affinity table is the whole model.
- **Cheap.** A weighted roll every 30 in-game seconds.
- **Controllable.** Story events force states directly.

### Persistence bias

```ts
if (id === from) w *= 2.2;
```

Weather is more than twice as likely to continue as to change. This is what
stops the sky flickering between states, and it is the difference between
weather you can plan around and weather that is noise.

### Diurnal bias

```ts
if (id === 'fog')          w *= hour >= 4 && hour <= 8  ? 3.5 : 0.35;
if (id === 'thunderstorm') w *= hour >= 13 && hour <= 20 ? 1.9 : 0.6;
if (id === 'harsh-sunlight') w *= hour >= 10 && hour <= 16 ? 2.2 : 0.15;
```

Fog forms around dawn. Storms build in the afternoon. Harsh sun is a midday
phenomenon. Cheap, and it makes the day feel like it has a shape.

### Forbidden transitions

```ts
sandstorm:        ['snow', 'hail', 'heavy-rain'],
'harsh-sunlight': ['snow', 'hail', 'heavy-rain', 'thunderstorm'],
```

You do not go straight from a sandstorm to a blizzard. Tested across 6,000
ticks.

## 4. Blended transitions

Every state has a profile, and transitions cross-fade over 45 seconds:

```ts
w.precipitation = lerp(a.precipitation, b.precipitation, t);
w.windSpeed     = lerp(a.windSpeed,     b.windSpeed,     t);
w.cloudCover    = lerp(a.cloudCover,    b.cloudCover,    t);
w.fogDensity    = lerp(a.fogDensity,    b.fogDensity,    t);
w.lightScale    = lerp(a.lightScale,    b.lightScale,    t);
w.lightningRate = lerp(a.lightningRate, b.lightningRate, t);
```

The sky, the audio mix, the particle systems and the spawn tables all read
these blended values, so they cross-fade together instead of popping
independently.

`weatherIdFor()` returns the *incoming* state past the halfway point of a
blend, because that is what the player perceives and therefore what spawning
should use.

## 5. What weather drives

| Consumer | Reads | Effect |
|---|---|---|
| Sky shader | `cloudCover`, `precipitation` | Cloud raymarch coverage and density |
| Ocean | `windSpeed`, `windDirection` | Wave spectrum — a storm raises the sea |
| Spawning | weather id | Gated entries and weight bonuses |
| Perception | `fogDensity` | Reduces AI and player sight range |
| Battle | `battleWeather` | Rain boosts Water, sandstorm chips non-immune |
| Audio | `precipitation`, `windSpeed` | Rain and wind layers, mix tension |
| Lighting | `lightScale` | Directional light intensity |
| Terrain shader | derived wetness | Darkens albedo, raises specular |

The ocean coupling is the most visible: forcing a thunderstorm in the client
takes the significant wave height from 0.66m to 5.58m, and the ride Pokémon
floating on it pitches accordingly, because the CPU buoyancy query and the GPU
vertex shader evaluate the same Gerstner sum.

## 6. Story override

```ts
weather.force('ulaula', 'aurora', true);
```

Forced weather persists across re-evaluations until `release()`. This is how
the Ultra Beast arc announces itself: the aurora is never in any island's
affinity table, so it **only ever appears when the story causes it**. When a
player sees the aurora, it means something.

## 7. Weather and the world clock

Weather advances on **in-game** seconds, not wall-clock seconds. Resting at a
Pokémon Center through the night genuinely changes the weather, because eight
in-game hours passed.

## 8. Persistence

Saved as `{ current, remaining }` per island — a handful of bytes. On load, the
blend state is reset rather than restored: resuming mid-cross-fade is not worth
the complexity, and snapping to the current state is invisible.

## 9. Profiles

| Weather | Precip | Wind m/s | Cloud | Fog | Light | Battle effect |
|---|---|---|---|---|---|---|
| clear | 0 | 3 | 0.12 | 0.3 | 1.00 | — |
| cloudy | 0 | 6 | 0.70 | 0.6 | 0.72 | — |
| rain | 0.55 | 9 | 0.92 | 1.1 | 0.50 | rain |
| heavy-rain | 1.00 | 15 | 1.00 | 1.8 | 0.34 | heavy-rain |
| thunderstorm | 0.85 | 18 | 1.00 | 1.5 | 0.30 | rain |
| sandstorm | 0 | 22 | 0.50 | 2.6 | 0.45 | sandstorm |
| hail | 0.70 | 12 | 0.95 | 1.3 | 0.48 | hail |
| snow | 0.60 | 7 | 0.90 | 1.6 | 0.60 | hail |
| fog | 0 | 1.5 | 0.60 | 3.4 | 0.55 | fog |
| harsh-sunlight | 0 | 2 | 0.02 | 0.18 | 1.35 | harsh-sunlight |
| aurora | 0 | 4 | 0.20 | 0.9 | 0.35 | — |

Durations range from 4 minutes (thunderstorm) to 40 minutes (clear) of in-game
time, rolled uniformly within each profile's band.

## 10. Not built

- **Weather fronts.** Weather is per-island and uniform within an island. A
  front moving across a landmass would be better and needs a spatial field.
- **Microclimates.** Wela Volcano should be hot regardless of island weather;
  currently only the terrain's temperature model reflects that, not the weather
  system.
- **Lightning strikes.** `lightningRate` is computed and unused by the client.
- **Seasons.** The solar model has a declination term for them; no seasonal
  content is authored.
