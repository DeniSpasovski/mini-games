# Drawing

## Description

Trees are opaque geometry and are ordered by the depth buffer alone. What is in front is decided per pixel by the depth test, never by the order in which trees, sprites or instances are submitted, so trees never draw over things in front of them or vanish behind things behind them.

## Passes

- Every tree level, the branch levels, the foliage sprites and the impostor, draws in the game's opaque pass with the terrain, before any transparent pass such as dust, spray, smoke, water, glass, particles or the HUD. Trees are never put in a transparent or sorted queue, so transparent effects always draw over them by their own rules.
- Sprites, instances and batches are never sorted by distance and need not be. The picture is the same whatever order they are submitted in, including whatever order GPU culling compacts them into ([Performance.mitigations](./Performance.md#mitigations)).
- Order inside the opaque pass: the depth-only pass for the foliage sprites first, then the lit pass of every tree level.

## Depth

- Tree passes use the game's camera projection, near and far planes, depth range and depth convention, including reversed depth if the game uses it, and the depth test that convention calls for. No tree pass turns depth testing off, writes depth with a different comparison, or uses its own projection.
- Every tree level writes depth. The alpha test discards a pixel before it writes depth, in the depth-only pass and the shadow pass too, so the holes between leaves never hide what is behind them.
- The lit pass for sprites tests less-or-equal against the prepass depth, with a small offset toward the camera, never equal: every pass computes their positions with the same function ([Foliage.wind](./Foliage.md#wind)) and the vertex position output is marked invariant, but drivers still differ in the last bit, and a missed pixel would show the background. Devices where the prepass does not pay (tile GPUs: phones, tablets), or where it fails the load check, draw sprites once, alpha-tested, with the normal depth test.
- A sprite quad is centred on its cluster, so sprites in front of the trunk hide it and sprites behind are hidden by it.
- The impostor writes a per-pixel depth from its baked depth map, so it meets the terrain and neighbouring trees where the tree would, not as a flat card; past 120 m a static impostor writes none ([Performance.mitigations](./Performance.md#mitigations)). Its quad sits at the front of the tree's bounding sphere and the written depth only ever moves away from the camera, so conservative depth keeps early depth testing on.
- Both levels in a fade ([Lod.transition](./Lod.md#transition)) write their own depth through the dither, so neither draws over the other.
- The trunk's base is sunk below the terrain by the base radius, so the tree never shares a surface with the ground and never z-fights with it.
- Where a branch segment overlaps into the next one to close the gap on the outside of a bend, the overlap narrows inside the next segment, so two segments never share a surface and never z-fight.

## Culling

Occlusion culling is two-phase. Trees hidden by the previous frame's depth are tested again against this frame's depth after the first draw, and drawn if visible, so a tree coming out from behind a hill or a closer tree never appears a frame late or flickers.

## Debug

The [Lod.debugView](./Lod.md#debug-view) toggle can also show tree depth, and mark pixels where a sprite's lit pass failed the equal-depth test against its own depth pass.
