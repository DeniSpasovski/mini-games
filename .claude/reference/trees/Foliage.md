# Foliage

## Description

Foliage is drawn as lit leaf-cluster sprites placed on the skeleton's leaf points, so leaves sit where the branches put them, and a crown reads as one lush, softly shaded volume at a fraction of the cost of modelled leaves. The sprites thin out continuously with distance instead of switching level, so foliage never cross-fades.

## Sprites

- A leafy spray is two leaf cards crossed along its heading (the twig's direction, splayed round it by the golden angle and drooping), fixed in the tree like its branches (trees/sprite-attr.ts). Its painted stem starts on the leaf point (`SPRAY_BASE` in trees/leaftex.ts), so it stays on its wood from every side; a camera-facing quad would turn with the view and leave the stem in the air. Card 1 lies near the horizontal (a seeded roll), card 2 at right angles to it.
- The pine's round needle bursts are billboards with a seeded turn, facing the camera's position (not the view plane, so they do not swing as the camera turns) and lifted 0.3 of their size towards the viewer (`TREE_SPRITE_LIFT`, not in the shadow pass) so the twig shows through their gaps.
- The sprite's image is a whole cluster of leaves or needles, picked by the tree's seed from the atlas of the species' leaf style, 4 to 8 cluster images, so a crown of a few hundred sprites looks like thousands of leaves.
- Sprite size comes from the cluster size at its leaf point; leaf styles (ovate, serrate, lobed, palmate, round, narrow, small, pine, juniper) give species their own leaf shape.
- A broadleaf image is a leafy branch along x from its stem's base at the left (`SPRAY_BASE`), so a crown reads as leafy branches with sky and limbs showing through, not as clumps.
- Photo styles: lobed (oak pack), palmate (maple), small (birch), ovate and round (bush), serrate (lilac, its panicles cut out) and pine are cut from the leaf cluster textures of the CC BY LOLIPOP packs (`scripts/trees/bake-leaves.py`): each image one spray turned so its stem runs along x (mirrored copies fill the eight), the pine's a burst of needle twig ends with their bare feet cut off. Their outlines and mean are baked (trees/leaf-photos.data.ts), so meshing never waits for pixels; the images decode in the tree worker (trees/leafphoto.ts), and without it on the page. The drawn atlas of the same style (trees/leaftex.ts `spriteAtlas`) stays the synchronous path (node tests, vineyards) and the fallback when a photo does not decode.
- Narrow (willow, broom) and juniper (cypress fronds) stay drawn: stem and twigs thin and near the leaves' shade (`STEM_VALUE`), a cypress frond drawn larger because it covers a thin strip, half the images curling each way so a column does not lean.
- The atlas has three maps in two textures: albedo with alpha, and a tangent-space normal map (a photo style's from its pack's normal map, turned with the image) with the thickness map in its alpha (stacked, shaded leaves and wood thick) at half the albedo's size (a pine atlas is 1024 x 512, the others 2048 x 1024, so leaves of a few centimetres keep their shape up close).

## Simplification

- Each sprite has a rank, from its prune priority and its seed. Within the full-detail distance a crown draws the highest-ranked 35% of its sprites, each grown so the crown covers the same area as with all of them; sprites are the biggest part of the trees' cost, and half of them is hard to tell from all of them.
- Once the tree is outside the full-detail distance and below the thinning threshold ([Lod.selection](./Lod.md#selection)), as its projected height falls toward the impostor threshold, the lowest-ranked sprites shrink smoothly to nothing while the remaining sprites grow, so the area the crown covers on screen stays the same. Sprites are never added or removed at once and never dithered.
- Past the full-detail distance the share eases over 60 m to the far share, 20% of the sprites, then on to 15% by the impostor threshold, each sprite scaled to keep the crown's coverage. The change is gradual on purpose: a crown that fills in over a few metres, or that is much sparser than the impostor it fades into, reads as popping. Far crowns are bound by draw calls and vertices, not pixels, so they draw few, large sprites; both shares can be tuned live in the perf panel.

## Colour

- A species' palette is the mean albedo of its leaf clusters (linear), taken from measured leaves (spectral databases and the PROSPECT leaf model), never tuned by eye against a dark render. The atlas shades its texels around that mean (`SpriteAtlas.mean`), so a palette colour is what a cluster averages to. A photo image's own mean leaf colour is made grey (its leaf-to-leaf hue kept within a narrow band), so the measured palette, not the photo, sets the colour; seasons come from the palette ramp, not from the pack's season textures.
- Summer leaves are olive, not emerald: luminance about 0.08-0.11, red / green 0.55-0.75, blue / green 0.25-0.4. Dark conifers and scrub sit lower (0.06-0.08), spring flush higher (0.13-0.16), autumn yellows and coppers highest (0.17-0.26). The leaf shader is matte, so the palettes keep the grey gloss of the leaf surface the measurements include.

## Shading

- Sprites are shaded through the game's normal lit path for opaque geometry: the same sun, sky ambient, fog and shadow maps as the terrain, with diffuse lighting only. They are never drawn unlit, emissive, with a constant colour or with a zero or missing normal.
- The normal is the crown's fitted ellipsoid normal plus, more strongly, the normal of the sprite's clump (the leaves of one second-order limb, or of its parent limb when it has few), bent by the atlas normal map: a crown shades as lit domes with darker gaps between them, as real crowns do, not as one smooth ball. Between 30 and 90 m the clump normal turns into the ellipsoid's and the atlas bend weakens (a few-pixel clump reads as a blotch), and the impostor is baked that way, so a far crown is one softly lit mass.
- Light through leaves (a leaf passes about as much light as it reflects, yellower), weighted by the thickness map: a wrap term on the side away from the sun, a forward lobe so a crown against the sun glows, and in the crown's own shadow the sunlight that comes through the leaves above.
- A sunlit leaf's waxy top glints (a small specular lobe on the bent normal, tinted by the leaf so it reads as light green, not grey): with the clump normals it makes the lit side of a crown read lighter than its shaded side.
- Seen from below, a broad leaf shows its paler, greyer underside (about 1.5 times); needles and scale leaves do not.
- Sprites receive shadows, including the crown's own: the crown's own shade is light through it, `exp(-k x` the metres of crown the sun crosses to reach the sprite`)` (`CROWN_EXTINCTION` in trees/materials.ts), and the shadow maps are read just outside the crown, so they add only other casters ([Lod.shadows](./Lod.md#shadows)). Near the camera that light is rolled per sprite (a seed against it, so the mean holds): a sprite is in a sun fleck or in the shade of the leaves above it, and a shaded one sees half the sky too, so a near crown reads as lit and dark cards (`DAPPLE_*` in trees/materials.ts). It eases into the smooth mean by 70 m, like the clump normals, so the impostor still matches.
- Darken only what is occluded, once: ambient occlusion is baked per sprite from its depth in the crown and in its clump, on the ambient only (a crown's heart stays green); the sky's light leans up and a little fill light is always there. A summer crown reads at about half its leaf albedo, never near black.
- Each tree gets a hue and value variation from its seed, within its species palette, wider in autumn and spring. The hue turn is held inside leaf hues (orange-red to blue-green, `treeHue` in trees/materials.ts): an autumn crown never goes magenta.
- Within a crown, sun leaves are lighter and a touch warmer than shade leaves (`foliage.colorSpread.exposure`), and each limb's clump stands a little apart from its neighbours in value, warmth and ramp stage (`colorSpread.clump`; `leafColor` in trees/mesh.ts), so a crown reads as clumps, not one even colour. Both are tunable live in the asset debugger's Tree tuning section.
- A broadleaf palette is a ramp ([Species.seasons](./Species.md#seasons)): in summer from the darker, bluer shade leaf to the lighter, yellower sun leaf. Each variant stands at its own stage on it and a crown's outer, upper leaves sit further along, blended between ramp colours.

## Alpha

- Atlas textures use coverage-preserving mipmaps. Each mip level's alpha is scaled so the share of texels passing the alpha test matches the full-size texture, so crowns do not thin out or fade away with distance.
- The alpha-test threshold is one fixed value shared by every pass, the shadow pass included.
- Where the renderer has MSAA, foliage uses alpha-to-coverage, so sprite edges do not shimmer.

## Wind

- Sway is hierarchical: the trunk bends, each branch sways about its parent with an amplitude that grows with branch order, and each sprite moves with the branch it hangs from and shimmers by a small, quick turn about its view axis (clusters do not wave).
- Each vertex carries its branch order, its phase and its distance along its branch, baked from the skeleton, and the motion is computed on the GPU from those and a global wind direction and strength.
- Every pass that draws a sprite, the depth pass, the lit pass and the shadow pass, computes its position with the same function from the same inputs, so their depths match exactly (the shadow pass leaves out a billboard's lift towards the viewer).
- The impostor sways as a whole with the trunk motion, so it matches the geometry at the transition.
- Sway fades out with distance, gone by 110 m, the same on every level and pass.
