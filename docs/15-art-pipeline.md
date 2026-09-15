# Art Pipeline

**Document owner:** Technical Artist, with Environment and Character Art
**Status:** Specification. The prototype uses procedural placeholders.

---

## 1. Art direction in one line

**Stylised forms, physically-based lighting.**

Pokémon and characters are stylised — clean silhouettes, bold shapes, readable
at distance. The world they stand in is lit physically: real sun position, real
atmospheric scattering, real material response.

The combination is the point. Full photorealism makes Pokémon look like
taxidermy. Fully stylised lighting throws away the one thing a modern renderer
does effortlessly, and makes a 40km world look flat.

## 2. What the prototype actually uses

Stated plainly so the gap is legible:

- **Pokémon:** procedural capsules, sized from real height and weight, tinted by
  primary type. Enough to distinguish species and observe AI behaviour, which is
  what the prototype needed.
- **Terrain:** vertex-coloured standard material using biome ground colours. The
  full splat shader is written and tested for uniform completeness but needs
  texture arrays the asset pipeline would produce.
- **Foliage:** scatter positions are generated and budgeted; no meshes exist.

Everything below is the specification that replaces those.

## 3. Budgets

Derived from the target of 60fps at 1080p on a mid-range GPU, and 60fps at
1280×800 on Steam Deck.

### Triangles

| Asset | LOD0 | LOD1 | LOD2 | LOD3 |
|---|---|---|---|---|
| Player character | 35,000 | 18,000 | 8,000 | 3,000 |
| Pokémon (small) | 12,000 | 6,000 | 2,500 | 900 |
| Pokémon (large) | 40,000 | 20,000 | 8,000 | 3,000 |
| Totem | 80,000 | 40,000 | 16,000 | 6,000 |
| NPC | 15,000 | 7,000 | 3,000 | 1,200 |
| Building | 25,000 | 12,000 | 5,000 | 1,500 |
| Foliage (tree) | 3,000 | 1,200 | 400 | billboard |
| Foliage (grass) | 60 | 20 | billboard | — |

### Frame budget

| Category | Triangles | Draw calls |
|---|---|---|
| Terrain (chunks) | 900k | 250 |
| Far terrain | 242k | **5** |
| Foliage (instanced) | 1.2M | 40 |
| Pokémon | 400k | 80 |
| Characters and NPCs | 300k | 60 |
| Buildings and props | 500k | 120 |
| VFX | 200k | 30 |
| **Total** | **~3.7M** | **~585** |

The far-terrain row is the one to note: 242k triangles in 5 draw calls covers
every distant island in the archipelago. It replaced roughly 2,450 streamed
chunks, which is why it appears in the budget as a rounding error rather than as
the largest line.

### Texture memory

| Category | Budget |
|---|---|
| Pokémon (streamed set) | 900 MB |
| Environment | 1.2 GB |
| Characters | 300 MB |
| UI and VFX | 200 MB |
| **Total** | **2.6 GB** |

At ~2.4 MB per species (base colour, normal, ORM at 1024²), 1,000 species is
2.4 GB — which does not fit. Hence streaming: only species in the current region
plus the player's party are resident.

## 4. Character art

### Modular construction

The player character is assembled at runtime from parts, because the creator
exposes ~10^12 combinations and pre-authoring them is impossible.

```
skeleton (shared)
  ├─ head      ← face shape, features
  ├─ hair      ← style mesh + palette
  ├─ torso     ← build morph
  ├─ arms
  └─ legs
clothing attaches to slots, deforms with the same skeleton
```

**Six builds × five heights as blend-shape targets**, not six separate meshes.
Clothing is authored once against the base and deforms with the morph, so a
shirt does not need six variants.

**Skin tone, hair colour and clothing colour are palette lookups**, not
textures. Sixteen skin tones is a 16-entry palette, not sixteen texture sets.

### Pokémon

Shared rig families let animation sets be reused across species:

| Rig family | Example species | Bones |
|---|---|---|
| `quadruped_small` | Litten, Growlithe | 48 |
| `biped_small` | Pikachu, Mimikyu | 42 |
| `avian_small` | Rowlet, Wingull, Pikipek | 38 |
| `fish_small` | Magikarp, Wishiwashi | 22 |
| `draconic_large` | Charizard, Kommo-o | 72 |
| `ursine_large` | Bewear | 56 |
| `tapu` | All four guardians | 44 |

A new species on an existing rig family inherits the whole animation set and
needs only its unique moves. That is the difference between 1,000 species being
feasible and not.

Required sockets, enforced at import:

```
socket_ride        where a player sits (ride species only)
socket_mouth       cry VFX, item carrying
socket_tail_tip    trailing VFX
socket_vfx_*       move-specific attachment points
```

A missing socket fails the import rather than producing a Z-Move that emits
from the world origin.

## 5. Environment art

### Terrain materials

Eight splat layers, blended from vertex-baked biome weights. Each layer is base
colour, normal and ORM at 2048², tiling every 12m.

**Triplanar projection on steep slopes.** Planar UVs stretch badly past ~45°,
which is most of a volcano and all of a canyon wall. The shader blends three
axis-aligned projections weighted by the normal, but only where the slope
warrants it — three samples instead of one is worth paying only on cliffs.

### Modular kits

Environments are built from kits rather than bespoke geometry:

| Kit | Pieces | Used by |
|---|---|---|
| `kit_tropical_village` | 80 | Iki Town, Paniola |
| `kit_city_modern` | 140 | Hau'oli, Malie |
| `kit_ruins_ancient` | 60 | All four Tapu shrines |
| `kit_facility_aether` | 110 | Aether Paradise |
| `kit_cave_volcanic` | 45 | Wela, lava caves |
| `kit_cave_crystal` | 40 | Ten Carat Hill |

Kits share a 2m grid and a single material per kit, so a whole town is a handful
of draw calls rather than hundreds.

### Foliage

Scatter is deterministic from the world seed (implemented), so a bush is in the
same place every time you return. Density falls off with distance and the
**largest instances are kept** when a budget forces a cut — preserving a
forest's silhouette while dropping its undergrowth.

## 6. Lighting

| Time | Sun (K) | Sun intensity | Ambient | Character |
|---|---|---|---|---|
| Dawn | 2,200 | 1.2 | Cool | Long shadows, warm rim |
| Morning | 4,800 | 2.4 | Neutral | Clear, saturated |
| Midday | 6,200 | 3.2 | Bright | Short shadows, high contrast |
| Golden hour | 2,800 | 1.8 | Warm | The postcard shot |
| Blue hour | 8,000 | 0.4 | Deep blue | Saturated, low contrast |
| Night | 7,500 | 0.08 | Very low | Moonlight, bioluminescence |

Golden hour and blue hour are modelled as **separate named states**, not points
on a day/night ramp. Blending only on daylight collapses both into a grey
mid-tone, and they are the two states players photograph.

## 7. VFX

| Family | Technique |
|---|---|
| Move impacts | GPU particles + decals |
| Z-Move cinematics | Authored sequences, screen-space effects |
| Weather | GPU particles, camera-relative |
| Water interaction | Foam decals, ripple normal injection |
| Ultra Space distortion | Screen-space warp + chromatic aberration |

Z-Moves are the only place where bespoke authored VFX is justified at scale.
Fourteen Z-Moves × a hand-crafted sequence is affordable; 1,000 species ×
bespoke move effects is not, so ordinary moves compose from a shared library
keyed by the move's `animation` field.

## 8. Review gates

Nothing enters the build without passing:

1. **Silhouette at 10% size.** If a species is not identifiable as a black
   shape at LOD3 size, the silhouette is wrong.
2. **Budget compliance.** Automated; over-budget fails import.
3. **Rig and socket validation.** Automated.
4. **Lighting check.** Reviewed under all six lighting states, not just midday.
5. **Colour-blind check.** Deuteranopia and protanopia simulation, because type
   identification must not depend on hue.

Gate 5 connects back to the UI commitment that no information is conveyed by
colour alone — type icons carry shape as well as colour precisely so this gate
is passable.
