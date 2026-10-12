# Placement

## Description

Trees are placed where the game's existing stage data places trees today. Each placed tree takes a species and a seed, and is drawn as an instance of a shared variant.

## Variants

- Each species pre-generates a pool of variants, 8 by default, each from its own seed, with every LOD and its impostor.
- A placed tree picks its variant from a hash of the stage id and its placement index, and its rotation about the vertical and its scale, within the species range, from the same hash. A stage therefore grows the same forest every time.
- Variants are drawn with instancing, one batch per variant and level.

## Caching

- Generated variants are cached on disk keyed by the species hash, the variant seed and the generator version, and are regenerated whenever any of them changes.
- The game's build generates every variant and impostor of every shipped species and ships the cache, so a player's stage load only reads it. Generation at load only happens for a species or generator changed since the build, as in development or a mod.

## Collision

- A tree's collision is a capsule per trunk and first-order limb segment above a species radius threshold, taken from the skeleton.
- Collision does not depend on which level is drawn.
