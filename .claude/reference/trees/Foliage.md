# Foliage

## Description

Foliage is drawn as lit leaf-cluster sprites placed on the skeleton's leaf points, so leaves sit where the branches put them, and a crown reads as one lush, softly shaded volume at a fraction of the cost of modelled leaves. The sprites thin out continuously with distance instead of switching level, so foliage never cross-fades.

## Sprites

- Each leaf point gets one sprite, a quad that faces the camera's position, not the view plane, so sprites do not swing when the camera turns.
- The sprite's image is a whole cluster of leaves or needles, picked by the tree's seed from a species atlas of 4 to 8 cluster images, so a crown of a few hundred sprites looks like thousands of leaves.
- Each sprite is turned about its view axis by an angle from the seed, and neighbouring sprites by the golden angle, about 137.5 degrees, from each other, so the images do not visibly repeat.
- Sprite size comes from the cluster size at its leaf point. Conifer atlases hold needle sprays and broadleaf atlases hold leaf bunches.
- The atlas has three textures: albedo with alpha, a tangent-space normal map and a thickness map.

## Simplification

- Each sprite has a rank, from its prune priority and its seed. Within the full-detail distance every sprite draws at full size.
- Once the tree is outside the full-detail distance and below the thinning threshold ([Lod.selection](./Lod.md#selection)), as its projected height falls toward the impostor threshold, the lowest-ranked sprites shrink smoothly to nothing while the remaining sprites grow, so the area the crown covers on screen stays the same. Sprites are never added or removed at once and never dithered.
- By the impostor threshold a crown has 25% of its sprites, each scaled to keep the crown's coverage.

## Shading

- Sprites are shaded through the game's normal lit path for opaque geometry: the same sun, sky ambient, fog and shadow maps as the terrain. They are never drawn unlit, emissive, with a constant colour or with a zero or missing normal.
- The normal is the normal of the crown's fitted ellipsoid at the sprite's position, bent by the atlas normal map, so the crown shades as one soft volume with leafy detail and the individual sprites do not show.
- Light through leaves is a wrap-lighting term weighted by the thickness map, so a crown against a low sun glows at its edges.
- Sprites receive shadows, including the crown's own shadow, so the inside and the side away from the sun are darker.
- Ambient occlusion is baked per sprite from how deep it sits inside the crown.
- Each tree gets a hue and value variation from its seed, within its species palette.

## Alpha

- Atlas textures use coverage-preserving mipmaps. Each mip level's alpha is scaled so the share of texels passing the alpha test matches the full-size texture, so crowns do not thin out or fade away with distance.
- The alpha-test threshold is one fixed value shared by every pass, the shadow pass included.
- Where the renderer has MSAA, foliage uses alpha-to-coverage, so sprite edges do not shimmer.

## Wind

- Sway is hierarchical: the trunk bends, each branch sways about its parent with an amplitude that grows with branch order, and each sprite moves with the branch it hangs from and flutters by a small turn about its view axis.
- Each vertex carries its branch order, its phase and its distance along its branch, baked from the skeleton, and the motion is computed on the GPU from those and a global wind direction and strength.
- Every pass that draws a sprite, the depth pass, the lit pass and the shadow pass, computes its position with the same function from the same inputs, so their depths match exactly.
- The impostor sways as a whole with the trunk motion, so it matches the geometry at the transition.
