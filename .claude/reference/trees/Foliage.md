# Foliage

## Description

Foliage is drawn as lit leaf-cluster sprites placed on the skeleton's leaf points, so leaves sit where the branches put them, and a crown reads as one lush, softly shaded volume at a fraction of the cost of modelled leaves. The sprites thin out continuously with distance instead of switching level, so foliage never cross-fades.

## Sprites

- Each leaf point gets one sprite, a quad that faces the camera's position, not the view plane, so sprites do not swing when the camera turns.
- The sprite's image is a whole cluster of leaves or needles, picked by the tree's seed from the atlas of the species' leaf style, 4 to 8 cluster images, so a crown of a few hundred sprites looks like thousands of leaves.
- A broadleaf sprite is a spray that lies along its twig: its image's x axis follows the sprite's heading (the twig's direction, splayed round it by the golden angle and drooping), projected on the view plane, so a crown shows leafy sprays along its branches from any side. A spray seen end on takes a seeded angle and shortens. A needle burst is round and keeps a seeded turn.
- Sprite size comes from the cluster size at its leaf point. Conifer atlases hold needle sprays and broadleaf atlases hold leaf bunches. A broadleaf image is a leafy branch lying along x, its base on a short stem at the left, with a side branch forking off most of them: twigs alternating along the stem (longest in the middle, swept towards the tip), small leaves on short stalks alternating along each twig and three at its end, so the stem and twigs show between the leaves, each leaf about 4 to 6 % of the image wide and darker towards the stem; a sprite turns to follow its twig, so a crown reads as leafy branches with sky and limbs showing through, not as clumps. A cypress or juniper image is a drooping frond: a stem with alternate branchlets of scale leaves that shorten towards the tip, drawn larger because it covers a thin strip. The pine's needle bursts stay round; leaf styles (ovate, serrate, lobed, round, narrow, small, pine, juniper) give species their own leaf shape.
- The atlas has three maps in two textures: albedo with alpha, and a tangent-space normal map with the thickness map in its alpha at half the albedo's size (a pine atlas is 1024 x 512, the others 2048 x 1024, so leaves of a few centimetres keep their shape up close).

## Simplification

- Each sprite has a rank, from its prune priority and its seed. Within the full-detail distance a crown draws the highest-ranked 35% of its sprites, each grown so the crown covers the same area as with all of them; sprites are the biggest part of the trees' cost, and half of them is hard to tell from all of them.
- Once the tree is outside the full-detail distance and below the thinning threshold ([Lod.selection](./Lod.md#selection)), as its projected height falls toward the impostor threshold, the lowest-ranked sprites shrink smoothly to nothing while the remaining sprites grow, so the area the crown covers on screen stays the same. Sprites are never added or removed at once and never dithered.
- Past the full-detail distance the share eases over 60 m to the far share, 20% of the sprites, then on to 15% by the impostor threshold, each sprite scaled to keep the crown's coverage. The change is gradual on purpose: a crown that fills in over a few metres, or that is much sparser than the impostor it fades into, reads as popping. Far crowns are bound by draw calls and vertices, not pixels, so they draw few, large sprites; both shares can be tuned live in the perf panel.

## Shading

- Sprites are shaded through the game's normal lit path for opaque geometry: the same sun, sky ambient, fog and shadow maps as the terrain, with diffuse lighting only, since a leaf cluster shows next to no specular. They are never drawn unlit, emissive, with a constant colour or with a zero or missing normal.
- The normal is the normal of the crown's fitted ellipsoid at the sprite's position, bent by the atlas normal map, so the crown shades as one soft volume with leafy detail and the individual sprites do not show.
- Light through leaves is a wrap-lighting term weighted by the thickness map, so a crown against a low sun glows at its edges.
- Sprites receive shadows, including the crown's own shadow, so the inside and the side away from the sun are darker ([Lod.shadows](./Lod.md#shadows)).
- Ambient occlusion is baked per sprite from how deep it sits inside the crown, mild: a crown's heart is shaded but stays green. The sky's light leans up and a little fill light is always there, and the sun's diffuse is wrapped past the terminator, so a crown shades softly instead of going black.
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
- Sway fades out with distance, gone by 110 m, the same on every level and pass.
