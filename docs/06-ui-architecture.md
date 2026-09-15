# UI Architecture

**Document owner:** UX Designer
**Status:** State model implemented in `packages/ui`; rendering is per-platform.

---

## 1. Principle: UI logic is state, not widgets

Everything in `packages/ui` is pure data and pure functions. There is no DOM,
no canvas, no framework.

This is not architectural purity for its own sake. HUD bugs overwhelmingly live
in *logic* — notification queueing, contextual prompt priority, menu focus
after a list rebuild — and none of that needs a browser to verify. 32 tests
cover it, and they run in 40ms.

The renderer is then free to be platform-specific: DOM on web, an immediate-mode
overlay on console, without duplicating a single decision.

## 2. Contextual prompts: resolved, not last-writer-wins

Several prompts are usually valid at once — "talk to NPC", "pick up item",
"mount ride". The naive implementation lets whichever system ran last win,
which makes the prompt flicker as the player turns.

Instead, every candidate is offered and resolved deterministically:

```ts
hud.offerPrompt({ button: 'a', label: 'Pick up', priority: 1, distance: 1 });
hud.offerPrompt({ button: 'x', label: 'Mount',   priority: 5, distance: 8 });
hud.offerPrompt({ button: 'b', label: 'Talk',    priority: 5, distance: 3 });
// → resolves to "Talk": highest priority, then nearest.
```

Prompts also do not persist. Not offering one this frame clears it, so walking
away removes the prompt with no explicit teardown call anywhere.

## 3. Notifications

- **Bounded queue, newest kept.** Overflow drops the *oldest*, because the
  newest event is the one the player just caused.
- **Fade in and out** computed from remaining time, so the renderer needs no
  animation state of its own.
- **Dismissable**, and dismissing an unknown id is a no-op rather than a throw.

## 4. HUD layouts

Visibility is a per-context set, not a pile of booleans:

```ts
explore:  ['party','minimap','objective','prompt','notifications','clock','weather','compass'],
ride:     ['party','minimap','prompt','notifications','clock','weather','ride','compass'],
battle:   ['notifications'],
cutscene: [],
photo:    ['crosshair'],
```

Changing layout also clears the current prompt, because a prompt from another
context is stale the instant we switch.

## 5. Menu navigation

A grid focus model that works identically for gamepad, keyboard and touch.

The reason to model this rather than lean on DOM focus order: a party screen, a
box grid and a bag list all need directional navigation that wraps sensibly,
skips disabled entries, and handles **ragged** layouts. Getting that right by
hand per screen is how inconsistent menus happen.

```ts
// Weight the primary axis heavily so a distant item directly in line beats a
// near item far off-axis.
const score = primary * 10 + secondary * 3;
```

A strict same-row/same-column rule strands the cursor on any layout that is not
a perfect rectangle — which is most real screens.

### The focus-preservation bug

`setItems` keeps focus on the same item id when a list is rebuilt, so a bag
that just lost an item does not throw the player back to the top.

The first implementation read the previous focus **after** swapping the array,
which resolved the old index against the *new* list and silently moved the
cursor. Caught by a test; the fix is to capture the id first.

## 6. Character creator

The brief asks for "thousands of cosmetic combinations". `combinationCount()`
returns the number so the claim is verifiable rather than asserted — both the
appearance and outfit spaces exceed one million independently.

Two design decisions:

**Build is a spectrum, not a gender toggle.** The player picks a build (6) and a
height (5) and a full set of features independently. This yields a much larger
and more inclusive space than branching on two presets, and it costs less
content than two parallel wardrobes.

**Appearance is small integers, never a mesh blob.**

```ts
{ bodyType: 1, skinTone: 4, hairStyle: 7, hairColor: 2, ... }
```

A character is a few dozen bytes in a save file and in a network packet. That
is what makes it viable to show every other player's custom character in a
shared world — a blob-based representation would not be.

`sanitiseAppearance()` clamps every index rather than throwing, so a save from
an older build with a since-removed hairstyle loads with a valid substitute
instead of failing.

## 7. Accessibility

Committed from the start, because retrofitting is expensive:

| Area | Commitment |
|---|---|
| Text | Scalable 100–200%, minimum 24px at 1080p |
| Colour | No information by colour alone; type icons carry shape |
| Contrast | WCAG AA against every HUD background |
| Input | Full remapping; no required simultaneous inputs |
| Z-Move poses | Single-button alternative at full power |
| Motion | Camera shake and motion blur independently disableable |
| Audio | Separate music/SFX/cry/voice sliders; subtitles for all speech |
| Timing | Every timed objective has an accessibility-mode extension |

The Z-Move commitment matters: the pose is a flourish, and the scoring is
already designed so a miss costs only 15% power. A player who cannot perform
the sequence must have a path to the same outcome.

## 8. Screens

```
Title ─► Save select ─► (new) Character creator ─► World
                              │
         ┌────────────────────┼──────────────────────┐
         │                    │                      │
      Main menu           Battle UI              Photo mode
         ├─ Party           ├─ Move select         ├─ Framing
         ├─ Bag             ├─ Target select       ├─ Filters
         ├─ Pokédex         ├─ Z-Move + pose       └─ Share
         ├─ Map             ├─ Switch
         ├─ Journal         └─ Bag / Run
         ├─ Trainer card
         ├─ Ride pager
         └─ Options
```

`MenuStack` gives Back a single obvious meaning everywhere, and `clear()`
closes everything when a battle or cutscene interrupts.

## 9. Not built

- Rendering. `packages/ui` is state; the client renders a subset as DOM.
- Dialogue and text layout.
- Box storage UI (the grid model supports it; the screen is not written).
- Localisation. All strings are currently inline English.
