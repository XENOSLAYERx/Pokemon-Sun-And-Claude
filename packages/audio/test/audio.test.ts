import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioDirector, MUSIC_STEMS, attenuation, cryVariant, cryPitch } from '../src/director.ts';
import type { AudioContext } from '../src/director.ts';

function ctx(overrides: Partial<AudioContext> = {}): AudioContext {
  return {
    biome: 'grassland', island: 'melemele', hour: 12, daylight: 1,
    weather: 'clear', precipitation: 0, windSpeed: 3,
    enclosed: false, inBattle: false, isBossBattle: false,
    threatDistance: Infinity, healthFraction: 1,
    riding: false, onWater: false, inCutscene: false, ultraEvent: false,
    ...overrides,
  };
}

function settle(director: AudioDirector, seconds = 6): void {
  for (let i = 0; i < seconds * 60; i++) director.update(1 / 60);
}

describe('Audio director', () => {
  test('stem gains stay in range under every context', () => {
    const director = new AudioDirector();
    const contexts = [
      ctx(),
      ctx({ inBattle: true, healthFraction: 0.1 }),
      ctx({ isBossBattle: true, inBattle: true }),
      ctx({ inCutscene: true }),
      ctx({ daylight: 0, hour: 2 }),
      ctx({ precipitation: 1, windSpeed: 25 }),
      ctx({ biome: 'ultra-space', ultraEvent: true }),
      ctx({ biome: 'lava-field', enclosed: true }),
    ];
    for (const c of contexts) {
      director.evaluate(c);
      settle(director, 3);
      for (const stem of MUSIC_STEMS) {
        const gain = director.mix.music.stems[stem];
        assert.ok(gain >= 0 && gain <= 1, `${stem} = ${gain} out of range`);
      }
    }
  });

  test('battle music intensifies as the player loses', () => {
    const healthy = new AudioDirector();
    healthy.evaluate(ctx({ inBattle: true, healthFraction: 1 }));
    settle(healthy);

    const losing = new AudioDirector();
    losing.evaluate(ctx({ inBattle: true, healthFraction: 0.1 }));
    settle(losing);

    assert.ok(
      losing.mix.music.stems.tension > healthy.mix.music.stems.tension + 0.3,
      'tension should rise sharply as HP falls',
    );
  });

  test('a boss battle adds the danger stem', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ inBattle: true, isBossBattle: true }));
    settle(director);
    assert.ok(director.mix.music.stems.danger > 0.8);
    assert.equal(director.mix.music.theme, 'bgm/totem_battle');
  });

  test('tension rises before a battle starts, as a threat approaches', () => {
    const far = new AudioDirector();
    far.evaluate(ctx({ threatDistance: 60 }));
    settle(far);

    const near = new AudioDirector();
    near.evaluate(ctx({ threatDistance: 8 }));
    settle(near);

    assert.ok(
      near.mix.music.stems.tension > far.mix.music.stems.tension,
      'the player should hear a predator before they see it',
    );
  });

  test('night thins the arrangement without changing track', () => {
    const day = new AudioDirector();
    day.evaluate(ctx({ daylight: 1, hour: 12 }));
    settle(day);

    const night = new AudioDirector();
    night.evaluate(ctx({ daylight: 0, hour: 1 }));
    settle(night);

    assert.equal(day.mix.music.theme, night.mix.music.theme, 'the theme should not change');
    assert.ok(night.mix.music.stems.melody < day.mix.music.stems.melody);
    assert.ok(night.mix.music.stems.percussion < day.mix.music.stems.percussion);
  });

  test('ambience crossfades between day and night layers', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ daylight: 0, hour: 2 }));
    settle(director);
    const night = director.mix.ambience.find((l) => l.id === 'amb/night_insects');
    assert.ok(night && night.gain > 0.3, 'night insects should be audible');

    director.evaluate(ctx({ daylight: 1, hour: 12 }));
    settle(director, 10);
    const stillNight = director.mix.ambience.find((l) => l.id === 'amb/night_insects');
    assert.ok(!stillNight || stillNight.gain < 0.05, 'insects should fade out by day');
    const birds = director.mix.ambience.find((l) => l.id === 'amb/day_birds');
    assert.ok(birds && birds.gain > 0.3, 'birdsong should fade in');
  });

  test('rain adds a layer proportional to intensity', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ precipitation: 0.9, weather: 'heavy-rain' }));
    settle(director);
    const rain = director.mix.ambience.find((l) => l.id === 'amb/rain_layer');
    assert.ok(rain && rain.gain > 0.5);
  });

  test('enclosed spaces raise reverb and the theme follows', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ biome: 'cave', enclosed: true }));
    settle(director);
    assert.ok(director.mix.reverb > 0.5, 'a cave should be reverberant');
    assert.equal(director.mix.music.theme, 'bgm/cave');
  });

  test('deep water muffles the mix', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ biome: 'deep-ocean', onWater: true }));
    settle(director);
    assert.ok(director.mix.lowpass < 2000, 'underwater should be low-passed');
  });

  test('ducking attenuates stems and recovers', () => {
    const director = new AudioDirector();
    director.evaluate(ctx());
    settle(director);
    const before = director.stemGain('base');

    director.duck(1);
    const ducked = director.stemGain('base');
    assert.ok(ducked < before * 0.6, 'dialogue should duck the music');

    settle(director, 3);
    assert.ok(director.stemGain('base') > ducked, 'ducking should recover');
  });

  test('silent ambience layers are retired', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ precipitation: 1 }));
    settle(director);
    assert.ok(director.mix.ambience.some((l) => l.id === 'amb/rain_layer'));

    director.evaluate(ctx({ precipitation: 0 }));
    settle(director, 20);
    assert.ok(
      !director.mix.ambience.some((l) => l.id === 'amb/rain_layer'),
      'a faded-out layer should be removed, not kept forever',
    );
  });

  test('beat tracking is exact when synced to the audio clock', () => {
    const director = new AudioDirector();
    director.mix.music.bpm = 120; // Two beats per second.

    // The audio clock is authoritative and never drifts.
    director.syncPosition(0);
    assert.equal(director.currentBeat(), 0);
    director.syncPosition(2);
    assert.equal(director.currentBeat(), 4, 'two seconds at 120bpm is four beats');
    director.syncPosition(10);
    assert.equal(director.currentBeat(), 20);

    const toNext = director.timeToNextBeat();
    assert.ok(toNext > 0 && toNext <= 0.5);
  });

  test('the dt fallback advances, though it accumulates float drift', () => {
    const director = new AudioDirector();
    director.mix.music.bpm = 120;
    settle(director, 2);
    // Summing 1/60 a hundred and twenty times lands just short of 2.0, which
    // is exactly why the audio clock is authoritative in the real client.
    assert.ok(Math.abs(director.mix.music.position - 2) < 0.01);
    assert.ok(director.currentBeat() >= 3);
  });

  test('an Ultra Beast event overrides everything', () => {
    const director = new AudioDirector();
    director.evaluate(ctx({ ultraEvent: true, inBattle: true, isBossBattle: true }));
    settle(director);
    assert.equal(director.mix.music.theme, 'bgm/ultra_event');
    assert.ok(director.mix.ambience.some((l) => l.id === 'amb/reality_distortion'));
  });
});

describe('Positional audio', () => {
  test('attenuation falls off with distance and clamps at both ends', () => {
    assert.equal(attenuation(0), 1);
    assert.equal(attenuation(0.5), 1);
    assert.ok(attenuation(10) < attenuation(2));
    assert.equal(attenuation(500, 1, 1, 200), 0);
    for (const d of [0, 1, 5, 25, 100, 199]) {
      const a = attenuation(d);
      assert.ok(a >= 0 && a <= 1, `attenuation(${d}) = ${a}`);
    }
  });

  test('cry variants spread across the available set', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(cryVariant('cry/wingull', i, 3));
    assert.equal(seen.size, 3, 'a flock should not sound like one voice');
  });

  test('bigger Pokémon get lower-pitched cries', () => {
    assert.ok(cryPitch(1.5) < cryPitch(1.0), 'a Totem should sound deeper');
    assert.ok(cryPitch(0.85) > cryPitch(1.0), 'a runt should sound higher');
    assert.equal(cryPitch(1), 1);
  });
});
