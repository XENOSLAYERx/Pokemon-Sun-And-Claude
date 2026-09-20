# Pokémon models

Drop a `.glb` here named exactly after the species id from
`packages/data/src/species/dex.ts` (e.g. `ROWLET.glb`, `LITTEN.glb`) and the
battle stage picks it up automatically — no code changes needed. Filenames
are case-sensitive.

Any species without a matching file here keeps its capsule placeholder; a
malformed or missing file just fails the fetch silently and falls back the
same way, so it's safe to drop models in one at a time.

Sizing and orientation are handled by `battle-stage.ts`: the model is
uniformly scaled to the species' battle height and re-centred, so the
source model's own scale and vertical origin don't matter. Only the model's
proportions and facing direction do — it should face +Z.
