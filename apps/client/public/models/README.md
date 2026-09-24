# Drop-in models

Every Pokémon and the player have a built-in model. Put a `.glb` file in this
folder and list it in `manifest.json` to replace one:

```json
{
  "player": "trainer.glb",
  "species": {
    "PIKACHU": "pikachu.glb",
    "LAPRAS": "lapras.glb"
  }
}
```

Species keys are the ids in `packages/data/src/species/dex.ts` — `PIKACHU`,
`ROWLET`, `RATTATA_ALOLA` and so on.

**Orientation and size don't matter much.** A model is centred and scaled on
load so its largest dimension becomes one unit, then sized to the species'
real height. glTF's default convention (+Y up, facing +Z) is what the game
uses, so a Blender export with default settings faces the right way.

**Animations are optional.** Clips whose names contain `idle`, `walk` or `run`
are blended by how fast the Pokémon is moving. A model with no clips is shown
static and still moves around correctly.

**Cost.** Custom models are drawn one object each, so they're used for the
nearest dozen of each species (within 60m); further out, the built-in model's
instanced low-detail version takes over. Keep them reasonably light — a few
thousand triangles — and the game stays smooth.

**Starting from the built-in models.** To edit one rather than start from
scratch, export it, open it in Blender, and drop it back in:

```bash
npm run models:export -- PIKACHU          # -> exports/models/pikachu.glb
npm run models:export -- --all            # every species
npm run models:export -- --player         # the default character
```

Only use models you have the right to use.
