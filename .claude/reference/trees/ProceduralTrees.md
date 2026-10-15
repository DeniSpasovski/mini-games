# Procedural Trees

## Description

Every tree in the rally game is generated procedurally from a parametric, stochastic, bracketed L-system. The hand-made tree assets the game used before are replaced and no longer loaded or placed anywhere. One generated branch skeleton per tree variant is the single source for every level of detail, for its foliage, its wind animation and its collision, so all of them agree with each other.

## Pipeline

- The species definition and a seed are expanded by the grammar into a symbol string ([Grammar](./Grammar.md#grammar)).
- A turtle interprets the string into a branch skeleton and leaf attachment points.
- The skeleton is meshed into every LOD, foliage sprites are placed on its leaf points, and the impostor is baked from the full-detail tree ([Lod](./Lod.md#lod), [Foliage](./Foliage.md#foliage)).
- Trees are placed along the stage and drawn as instances of a small pool of variants per species ([Placement](./Placement.md#placement)).
- They draw as opaque geometry, ordered by the depth buffer alone ([Drawing](./Drawing.md#drawing)).
- What all of this costs at load and per frame is measured in the game ([Performance](./Performance.md#performance)).

## Species

Tree kinds are data, not code; see [Species](./Species.md#species).

## Integration

- The tree system is built inside the game's existing codebase, in its language, on its renderer, and reads its stage data, collision, camera and graphics quality settings. It adds no second engine or renderer.
- The tree system is one module with stages for grammar, skeleton, meshing, impostor baking, placement and drawing, in that order. Each stage only reads the output of the stages before it.
- Grammar derivation and skeleton building are pure functions of the species and the seed, with no engine dependency, so they can be unit tested on their own.
- The old tree assets and the code that loaded and placed them are removed, not left behind a switch.

## Goals

- LOD changes are not visible as pops: the silhouette, crown volume, colour and lighting of a tree stay continuous while it changes level.
- Foliage reads as clustered leaves on real branches, lit from both sides and moving in the wind, not as flat cards stuck on a trunk.
- The same stage always grows the same trees, on every machine and in every replay.
