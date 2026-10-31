# Species

## Description

A species is a data definition that the tree code reads, so adding or tuning a kind of tree changes no code. Every tree type the rally game placed before maps to a species that resembles it.

## Fields

- name, unique.
- axiom and rules ([Grammar.rules](./Grammar.md#rules)).
- iterations and a segment cap.
- branching angle, length scale, radius at the base and radius decay.
- tropism vector and strength.
- bark: its measured albedo, a scanned tile with its normal map (or a procedural one, birch's white papery bark among them) and its tiling along the branch length, the young shoots' colour it turns from as a branch thickens, and an optional darker foot (birch); `shade`, how much sky a closed stand's canopy takes from its trunks and crown underside (broadleaf, optional; every tree's own crown already shades the wood under it, the sides less than the tops); the shoots' tip radius (pipe model, [Grammar.turtle](./Grammar.md#turtle)).
- foliage kind, conifer needles or broadleaf, with its cluster sprite atlas (a leaf style), sprite size and a colour palette ([Foliage](./Foliage.md#foliage)).
- a variant count.
- LOD settings that override the defaults ([Lod](./Lod.md#lod)).
- a scale range for instances.

## Types

- The maps place trees by the tree type ids of the old catalog, and each type grows as a species built to match the map data's description of it. A pine looks like a pine, a poplar like a poplar.
- pine_tree is a pine, a Scots or spruce style conifer: one straight leader, whorls of drooping limbs, a layered cone of needle sprays.
- plantation_pine is a plantation pine: the pine's cone grown cheaper for dense stands, four limbs to a whorl and about half the sprites, each larger.
- black_pine is a black pine, an Austrian black pine: a long straight trunk bare but for dead stubs, under a flat umbrella of dark needle clumps.
- juniper is a juniper, a dark narrow cone of short upswept needled limbs, 2 to 3.5 m, drive-through.
- oak_tree is an oak, a broad irregular field tree with a forking trunk and a rounded crown.
- beech_tree is a mountain beech: a tall straight smooth pale-grey trunk under a dense rounded crown.
- walnut_tree is a walnut, a big yard tree: a thick short trunk under a dense, dark, round crown wider than it is tall.
- fruit_tree is a fruit tree, an apple or plum: a short trunk and a low, wide, round crown about half an oak's height.
- pale_tree is a plane, a plane or ash with a long grey-white trunk and an open yellow-green crown.
- birch_tree is a birch: a slender white trunk to the top, short climbing limbs with drooping twigs, a light airy crown.
- young_tree is a sapling, a slender elm or ash, its crown taller than wide and starting to yellow.
- poplar_tree is a poplar, a Lombardy poplar: tall and columnar, short upswept limbs close to the trunk, the tallest tree.
- willow_tree is a willow, a weeping willow: a short thick trunk, limbs arching out and long pale curtains of hanging shoots that stop above the ground.
- bush is a bush, a low leafy roadside shrub.
- scrub_bush is scrub, Mediterranean hill scrub: dark olive, low and wide.
- hazelnut_tree is a hazel, a plantation hazelnut: a multi-stemmed upright bush with a fresh green crown, 3 to 4 m.
- thicket_shrub is a thicket, hawthorn and blackthorn brush: white blossom in spring, red and brown in autumn.
- hornbeam_tree is a hornbeam / oak coppice: two or three slender smooth grey stems from one stool under a narrow crown of small bright-green leaves.
- broom_shrub is flowering broom: upright green switches covered in yellow, 1 to 2 m.
- cypress_tree is a Mediterranean cypress: a tall dark narrow column of short limbs close to the stem, 8 to 12 m (Vodno's church yards and suburb).
- hedge_cypress is a hedge cypress (leyland / arborvitae): a fuller, greener column on a broad base, 6 to 9 m, planted in rows along lot fences and field edges of Ajvatovci's start row.
- locust_tree is a black locust (acacia), a street and garden tree: a tall open crown of light feathery leaves on a dark furrowed trunk.
- bramble_shrub is bramble and wild rose: a low arching tangle of green canes, 0.8 to 1.4 m, for forest edges and verges.
- Bushes, scrub, hazels, thickets, brambles and junipers are drive-through. The other trees collide on their trunk, the poplar on its trunk alone.
- Conifers wear needle sprays and the other species leaf bunches. Leaf colours are measured albedo ([Foliage.colour](./Foliage.md#colour)); bark too: smooth grey beech about 0.18 luminance, white birch about 0.45, furrowed oak, locust and pine about 0.09, black pine about 0.06.
- The common forest species, pine, oak, bush and scrub, have six variants; the rest have four, to keep the draw calls of a map with many species in budget.

## Seasons

- A stage has a season, spring, summer or autumn. A species' palette is its summer look; a table gives the species that change their own spring and autumn palettes, from measured leaves: a bright yellow-green flush in spring, blossom on the fruit tree and thicket, yellow (birch, hornbeam, walnut, locust), copper (beech), dull yellow-brown (oak) and red (scrub, thicket, bramble) in autumn. Conifers hardly change, the juniper and cypresses never do.
- A broadleaf's spring and autumn palettes are ramps from the least to the most turned leaf, from measured leaves: beech green, yellow-green, gold, orange, copper, brown; the yellow-turners (hornbeam, birch, walnut, hazel, locust); oaks to dull ochre and russet; cherry and maple to orange-red; Cotinus, hawthorn and bramble to scarlet and crimson; a lime flush (beech, hornbeam, birch) or a bronze one (oak, walnut) in spring. Trees turn about a week apart, so each variant has its own stage (autumn wider than spring, centred near peak colour), and a crown turns from its top and outside in (birch, poplar and willow from the inside).
- A season changes the leaves only: their colours and, on a broadleaf, their cover. Autumn crowns have shed about a quarter of their leaves; spring ones are a fifth short and their leaves a fifth smaller, so the branches show through more. Its variants grow from the summer seeds, so a tree is the same tree all year, the same leaf points go bare every time, and the season is part of the species hash, so each has its own cached variants.

## Checks

- A test checks every type's proportions and colours against its description: a columnar poplar, cypress, hedge cypress and juniper, a pine taller than wide, a walnut and a willow wider than tall, a black pine crown in its top third, pale birch and plane bark, needles on the conifers, autumn reds on the thicket, a cypress darker than the beech, low bushes, a fruit tree under an oak and a poplar over it.

## Identity

A species definition has a content hash; any change to it invalidates anything cached from the old one. It does not change the variant seeds ([Placement.variants](./Placement.md#variants)).
