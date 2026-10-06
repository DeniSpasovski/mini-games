# Hole Island - Animal Island map (design, roster, open tasks)

Third map for Hole Island: an island full of animals. You start as a hole the size of a dinner plate and swallow ants,
ladybugs and snails, then rabbits, foxes and sheep, then zebras, crocodiles and elephants. You end on the **extremely
giant** animals that a secret laboratory has bred: a 16 m rabbit, a 30 m crocodile in the river, a 34 m elephant. The
island has small hills you can eat and rivers you cross. In a hidden corner, behind the jungle, the **secret zoo and the
laboratory** where the giants are made.

> **Status: built and playable** (menu map picker, `?map=animal`). The moving-items engine, the 190-type catalog with
> builders, the generator (biomes, rivers, hills, farm, the secret zoo + laboratory, 37 giants) and the ground all work
> and are tested; how it works now is in [`DETAILS.md`](DETAILS.md) ("Moving items", "Map: Animal Island"). This file
> keeps the design, the roster (section 6) and the **open** tasks (section 7). The game rules (size ladder, eat rule,
> scoring) are in the DETAILS.md and are not changed by this map. Workflow:
> [`.claude/skills/hole-content/SKILL.md`](../../../.claude/skills/hole-content/SKILL.md).

Status marks: `[ ]` todo · `[~]` in progress · `[x]` done (done items move into the DETAILS.md and are deleted here).

> Working title: **Animal Island**. Original art only, generic names. No trademarks, film or brand references in ids,
> names or UI (no "Jurassic", no "Kong", no real zoo or lab names or logos). Say "giant ape", "growth lab", "secret zoo".

## 1. Pitch and pillars

1. **The same animal, three sizes.** Like the plush ladder in the toy store: you eat a normal rabbit at level 1, a
   lab-grown big rabbit at level 4 and a giant rabbit at level 10. The giant versions are the goal you see from the
   start (a 64 m giraffe sticks out over the trees), and you teeter under them until you are big enough.
2. **A living island, a bit rounder.** Animals walk, hop, swim and march in ant columns, and are built from low-poly
   balls and eggs as well as boxes (section 6.3), so they read softer than the City Island props. Movement makes the map feel alive, but it must
   never make the game unfair on touch: anything the hole can eat moves slower than the hole.
3. **Small first, giant last.** Levels 1-3 are bugs, critters, flowers, mushrooms and anthills (tiers 1-8). Farm, forest
   and savanna animals carry the middle (tiers 5-14). Lab-grown big animals, hills and lab buildings are the late middle
   (tiers 11-19). The last 6 levels are the **37 giants**, the biggest hills and the laboratory (tiers 20-25).
4. **The landscape is edible.** Hills are static items: from a molehill (tier 1) to the great hill (tier 25). Rivers are water
   the hole crosses freely (like the City Island canal); what floats or swims in them is edible.
5. **A secret to find.** The zoo and the lab sit in a jungle corner behind an electric fence and watchtowers. Most giants
   live there in cages; a few escaped and roam the island.
6. **Pace and score stay comparable.** 21 000 points per seed, same three difficulties, own top 10
   and own scoring version.

## 2. Decisions

Confirmed with the user on 2026-10-04 (D2, D4, D7, D8, D14 answered by the user; the rest are the recommended defaults,
not objected to).

| #   | Question                                | Recommended default                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Map id / name                           | `animal` / "Animal Island", noun "island", menu blurb "Ants first, giant elephants last. Find the secret zoo."                                                                                                                                                                                                                                                                                                                            |
| D2  | Point total                             | **21 000** (user; first 20 000, raised so level 25 is reachable). Fewer items than the other maps (City 30 000, toy 25 000) keeps the moving instances down. More than 2 x `cumulativeXp(15)` = 17 110, so Easy can clear it, and more than the 20 155 XP to level 25 (section 5.7)                                                                                                                                                       |
| D3  | Island shape                            | round island like City Island (coast table + headlands / inlets), radius **210 m** (user asked for a smaller map, "7 x 7"; at 168 m the whole island clears in ~100 s and Hard reaches level 25, so 210 m is the smallest size that keeps the difficulty bands; tuned by the bot: density = pace). Seeded: the menu seed stepper works like City Island                                                                                   |
| D4  | Scale of the bugs                       | **User: yes.** Bugs are drawn **~10x life size** (ant 15 cm, beetle 30 cm) so they read at the level 1 camera (10 m), the same trick as the toy store's 5x. Lore: "the lab's growth serum leaked into the soil"                                                                                                                                                                                                                           |
| D5  | How many giants                         | **37 instances of 16 giant types** (tiers 20-25, ~1 065 points = ~5 % of the map, like the toy store's 5 % for tiers 20-25). 14 in the zoo paddock, 23 roaming their biome. Section 5.6                                                                                                                                                                                                                                                   |
| D6  | Animal orientation                      | animals face **+X** (like vehicles), so heading = yaw. Pivot at the ground centre                                                                                                                                                                                                                                                                                                                                                         |
| D7  | Do edible animals flee from the hole?   | **User: yes, gently - but insects never flee** (group `bugs`: ants, beetles, ladybugs, snails ... stay on their path, so the first minute is easy). Behind a flag: other animals flee only when the hole can eat them and is within 1.5 D, at most **50 % of the hole speed**, for at most 2 s, then they calm down. Too-big animals ignore the hole, stop walking and teeter when it is under them. Bot pace is measured with fleeing on |
| D8  | Can things stand ON hills?              | **User: no.** Hills are just other static items. Their decoration (trees, rocks, flowers, a burrow) is part of the hill mesh, nothing stands on them, animals walk around them. No cargo / parent-child items                                                                                                                                                                                                                             |
| D9  | Leg animation                           | v1: whole-body motion in the instance matrix (bob, waddle roll, hop arc, insect jitter). v1.1: a vertex-shader leg swing driven by a per-vertex limb mask + per-instance phase (AI-15). No skinned meshes                                                                                                                                                                                                                                 |
| D10 | Do far-away animals move?               | **Only "awake" animals move**: within an awake radius of the hole that grows with the camera distance, and big enough to be seen from there (section 4.4). Asleep animals stand still (they look like they are grazing). Deterministic: depends only on the hole, never on the camera                                                                                                                                                     |
| D11 | Is movement in the sim (deterministic)? | **Yes.** Mover state lives in `sim/` (DOM-free, seeded per item), stepped at the fixed sim rate, so the bot, the balance page and the tests see the same animals as the player                                                                                                                                                                                                                                                            |
| D12 | Swallow puffs                           | new `MapDef.puffs: 'fur'` palette (brown / white / grey tufts + a few leaves); feathers for birds is P2                                                                                                                                                                                                                                                                                                                                   |
| D13 | Difficulty times                        | the shared 480 / 240 / 120 s. Revisit only if real play shows the island is much slower than City Island (moving targets)                                                                                                                                                                                                                                                                                                                 |
| D14 | Shapes                                  | **User: use balls and egg shapes** to make the animals less blocky. New low-poly `ball()` / egg / dome primitive in the Mesher, flat shaded (faceted, so it still matches the blocky art); bodies, heads, eyes, shells, wool, some tree crowns, boulders and the hills use it, legs / horns / buildings stay boxes. Section 6.3; built (AI-29, see DETAILS.md "Round parts")                                                              |

## 3. The size ladder in animal-island terms

Tier maxima (m): T1 0.90 · T2 1.05 · T3 1.22 · T4 1.43 · T5 1.67 · T6 1.94 · T7 2.27 · T8 2.64 · T9 3.08 · T10 3.59 ·
T11 4.19 · T12 4.88 · T13 5.69 · T14 6.64 · T15 7.74 · T16 9.03 · T17 10.5 · T18 12.3 · T19 14.3 · T20 16.7 · T21 19.5 ·
T22 22.7 · T23 26.5 · T24 30.9 · T25 36.

| Hole level | Eats up to | Animal island feel                                                                                                                                                             |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1          | 0.9 m      | ants, ladybugs, beetles, snails, butterflies, mice, frogs, chicks, hens, ducks, rabbits, squirrels, crabs, monkeys, foxes, flowers, mushrooms, molehills, anthills, scientists |
| 2          | 1.43 m     | tortoises, lambs, goats, sheep, pigs, wolves, kangaroos, ostriches, deer, alpacas, pandas, hay bales, bushes, boulders, logs, lab crates                                       |
| 3          | 2.64 m     | termite mounds, gorillas, bears, tigers, seals, zebras, lions, cows, horses, camels, elephant calves, trees, palms, fences, growth vats, big frogs and big ants from the lab   |
| 4          | 3.59 m     | giraffes, moose, bison, rhinos, the escaped big rabbit, research jeeps, acacias, watchtowers                                                                                   |
| 5          | 4.88 m     | crocodiles, hippos, big beetles, oaks, giant-cage bars, knolls, giant carrots, beaver dams                                                                                     |
| 6          | 6.64 m     | elephants, big tortoises, big gorillas, small hills, jungle trees, growth chambers, containers                                                                                 |
| 7          | 9.03 m     | hills (7-9 m), baobabs, transport trucks, the helicopter, big elephants, log bridges, rock arches                                                                              |
| 8          | 12.3 m     | hills (10-12 m), lab dome, lab block, aviary, barn, redwoods                                                                                                                   |
| 9          | 14.3 m     | 14 m hills, lab hangar, the big crocodile in the river                                                                                                                         |
| 10         | 16.7 m     | **giants start**: giant rabbit, giant frog, giant mouse, giant giraffe; 16 m hills, lab tower                                                                                  |
| 11         | 19.5 m     | giant ant, giant beetle, giant snail, giant chicken, lab wing                                                                                                                  |
| 12         | 22.7 m     | giant bear, giant lion, biodome                                                                                                                                                |
| 13         | 26.5 m     | giant tortoise, giant hippo, giant rhino                                                                                                                                       |
| 14         | 30.9 m     | giant crocodile, giant ape, growth reactor                                                                                                                                     |
| 15         | 36 m       | **giant elephant** (final boss), the laboratory HQ, the great hill                                                                                                             |

## 4. The new mechanic: moving animals - can we handle many objects moving?

**Short answer: yes, a few thousand, with four rules.** The engine was built for static items (`sim/world.ts` says
"items never move on the ground"), but nothing in it is hard to change, and the expensive part is the GPU, not the CPU.

### 4.1 What the engine does today

- `World` keeps every item in struct-of-arrays form (`x`, `z`, `rot`, ...) and a **static** 8 m spatial hash that is
  built once (`query()` is how the hole finds items near it).
- `ItemInstances` draws every item through a few `BatchedMesh`es (one per material style + shadow flag), culled per
  **64 m map cell** (32 m with movers) and per item at the frustum edge, so the camera and the shadow only draw what
  they see (DETAILS.md "Performance"). Matrices are written once; afterwards only `world.active` items (teetering /
  tipping / falling) and moved movers are rewritten. (This section was written for the older one-`InstancedMesh`-per-
  type-and-cell renderer; the rules below still hold.)
- One sim tick costs 0.03-0.11 ms; triangles per frame are 70k (level 1) to 164k (level 15) on City Island.

### 4.2 Measured cost of moving items (node, dev PC, throw-away benchmark)

A struct-of-arrays wander step (seek a target inside a leash circle, wait, pick a new target), dynamic re-bucketing in
the 8 m hash, plus composing a yaw + bob matrix per mover:

| Movers | Sim step per tick | Matrix compose per frame | Hash re-buckets per tick | GPU upload per frame |
| ------ | ----------------- | ------------------------ | ------------------------ | -------------------- |
| 1 000  | 0.03 ms           | 0.05 ms                  | 4                        | 62 KB                |
| 2 500  | 0.10 ms           | 0.12 ms                  | 9                        | 156 KB               |
| 5 000  | 0.21 ms           | 0.26 ms                  | 18                       | 312 KB               |
| 10 000 | 0.51 ms           | 0.55 ms                  | 35                       | 625 KB               |

A phone is roughly 4-6x slower than the dev PC: 2 500 movers ~1-1.5 ms of a 16.7 ms frame. **CPU is fine.** The real
costs are:

1. **Triangles.** 2 500 animals x 300 triangles = 750k triangles if they were all drawn, plus the shadow pass. That is
   why culling must keep working while things move (rule 1) and why animals get tight triangle budgets (section 6.5).
2. **Culling breaks if movers leave their cell.** A mesh's bounding sphere is computed once; an animal that walks out of
   it would pop out of view.
3. **Matrix uploads** of a whole `InstancedMesh` buffer every frame for every mesh that has a mover in it.

### 4.3 The four rules

1. **Leashed home ranges.** Every mover has a home point and a leash radius (bugs 2-6 m, critters 6-15 m, herds 20-40 m,
   giants 40-70 m, swimmers: a stretch of river). It never leaves it. Movers are grouped by type + variant + **home**
   cell, and that mesh's bounding sphere gets `cell + leash + size` instead of `+14 m`. Culling keeps working.
2. **Separate meshes for movers.** Static items keep today's write-once meshes. Mover meshes are rewritten every frame
   (only the awake ones, see 3), so the per-frame upload never touches the 6 000 static items.
3. **Awake set.** Only movers within `awakeRadius(D) = 1.6 x cameraDistance(D)` of the hole **and** big enough to be
   seen from there (`size / distance > ~1/150`) move; the rest stand still. At level 1 that is ~20 m and a few dozen
   animals; at level 15 ~215 m, but by then the tiny ones are eaten or too small to matter. Target: **<= 600 awake**.
   Uses only the hole position and diameter, so it is deterministic (no camera in `sim/`).
4. **Matrix-only animation.** Walking is done with the instance matrix (yaw, bob, roll, hop arc, jitter), later a
   vertex-shader leg swing (D9). Never skinned meshes, never a clone per animal (repo rule).

Budgets: **~2 500 movers per map**, <= 600 awake, mover sim + compose <= 1.5 ms on a phone. `tests/hole/movers.test.ts` times a
2 500-mover tick in node as a guard (headroom over the budget).

### 4.4 Behaviours (`motion` column of the roster)

| Motion    | Who                                    | What it does                                                                                                                                                     |
| --------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-`       | static                                 | does not move (trees, hills, buildings, owls)                                                                                                                    |
| `wander`  | most animals                           | pick a walkable target inside the leash, walk there at `speed`, idle 1-5 s (graze / look around), repeat                                                         |
| `herd`    | sheep, goats, deer, zebras, elephants  | the herd shares a moving centre (its own wander), members keep an offset + a little separation; calves / lambs / ducklings follow their parent                   |
| `hop`     | rabbits, frogs, kangaroos, grasshopper | wander in jumps: a parabola in `y` + forward burst, then a pause                                                                                                 |
| `crawl`   | snails, tortoises, caterpillars        | wander at a tiny speed (snail_giant: the slowest thing on the island)                                                                                            |
| `skitter` | beetles, mice, crabs, ladybugs         | short fast dashes with jitter; crabs move along their local Z (sideways)                                                                                         |
| `trail`   | ants                                   | follow a closed loop path from an anthill to a food item and back, spaced in a column; ant_big has its own column near the lab                                   |
| `flutter` | butterflies, bees, dragonflies         | wander with a `y` bob 0.3-1 m above the ground; bees circle a beehive                                                                                            |
| `swim`    | ducks, otters, crocodiles, hippos      | move along a river polyline (arc length `s`, side offset), turn at the ends of their stretch; hippos / crocs sit lower (half under water)                        |
| `patrol`  | scientists, keepers, jeeps, trucks     | loop along a fixed path in the compound (lab doors, pens, the loop road)                                                                                         |
| `roam`    | giants                                 | slow wander with a big leash, long idles; turn in place before walking (big things should feel heavy). P2: footstep thumps + camera shake when close to the hole |

Shared rules: speed of an animal <= **0.5 x the full speed of the first hole level that can eat it** (so a level-4 hole
always catches a rhino); walkers never step into water, off the island, into a hill footprint or a building (a 2 m
**walkable grid** baked by the generator, checked when a target is picked and along the straight line to it); swimmers
never leave water. A mover that commits to falling freezes where it is and falls as today (`fallPose` from its current
position). A too-big animal with the hole under it **stops** and teeters, and walks on when the hole leaves.

### 4.5 Code changes (shared engine)

- `sim/world.ts`: dynamic hash (bucket index per item, swap-remove, re-bucket only when an item crosses a cell); `prevX`
  / `prevZ` / `prevRot` for render interpolation; mover arrays (home, leash, target, speed, wait, behaviour, herd /
  path id) or a separate `Movers` struct indexed by item.
- `sim/movers.ts` (new, DOM-free): behaviours above, per-item `Rng` from `world.seed`, awake set, flee (D7), walkable
  grid lookup. Called from `Sim.step` before `commitItems`.
- `sim/sim.ts`: commit uses the current position (it already reads `world.x / z`); teeter stops the mover.
- `sim/bot.ts`: lead moving targets (aim at `x + vx * t`), re-target when the target leaves the chase radius.
- `map/types.ts`: `Placement.move?` (home / leash / path / herd id, written by the generator), `MapData.rivers?`,
  `ponds?`, `biomes?` (grid), `walkable?` (bitset), `paths?` (ant trails, patrol loops).
- `render/item-instances.ts`: mover meshes grouped by home cell with leash-sized bounds, rewritten per frame from the
  interpolated pose; bob / roll / hop from the behaviour state; static meshes unchanged.
- `render/materials.ts` (v1.1): leg-swing patch (per-vertex limb mask attribute from the Mesher, per-instance phase
  attribute), the same way the `paint` / `glow` patch works.

## 5. Special map logic

### 5.1 Island layout (biomes)

A round island (coast table like City Island, radius 210 m). The biomes are **seeded angular sectors warped by noise**
(like the district rings): the topology is fixed, the shapes differ per seed, and the whole layout is rotated by the seed.

| Biome         | Where (default rotation)         | Share | Ground                       | Content                                                                                    |
| ------------- | -------------------------------- | ----- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Meadow + farm | south (the start)                | 15 %  | bright green, flower specks  | bugs, ant trails, rabbits, hens, mice, molehills; a small farmstead (barn, cows, pigs)     |
| Forest        | west                             | 15 %  | dark green                   | trees, redwoods, stumps, logs, deer, foxes, wolves, bears, squirrels, mushrooms            |
| Savanna       | east                             | 15 %  | ochre / dry grass            | acacias, baobabs, termite mounds, waterhole, zebras, giraffes, lions, elephants, rhinos    |
| Wetland       | south-west, where the river ends | 10 %  | olive mud + ponds            | reeds, lily pads, frogs, flamingos, ducks, beavers, crocodiles, hippos                     |
| Highlands     | the middle                       | 12 %  | olive with rock patches      | **hill clusters** (most hills), boulders, rock arches, goats, sheep, alpacas; river source |
| Beach         | the coast ring (16 m sand band)  | 8 %   | sand                         | crabs, seals, penguins, seagulls, shells, starfish, palms, rocks                           |
| Jungle        | north-east, around the compound  | 8 %   | deep green                   | jungle trees, palms, bamboo, monkeys, parrots, tigers, gorillas, pandas                    |
| Secret zoo    | north-east, inside the fence     | 10 %  | packed earth, concrete paths | pens + giant cages, keepers, feeding stations, 14 giants (section 5.4)                     |
| Laboratory    | north-east, next to the zoo      | 7 %   | concrete, helipad            | lab buildings, vats, chambers, scientists, jeeps, trucks, serum barrels (section 5.4)      |

The start: a clear spot in the meadow near the river, ringed by > 15 tier 1-3 items within 25 m (ant trails, flowers,
ladybugs, mushrooms). `pickStart` works as on the other maps (rejects spots on water).

### 5.2 Rivers and water

- **One main river** (10-14 m wide) from a spring pond on the great hill in the highlands, meandering south-west through
  the meadow into the wetland delta and the sea; **1-2 streams** (5-7 m) join it from the forest / savanna side; one
  **waterhole** in the savanna and 2-4 **ponds** in the wetland and meadow. Generated as noisy polylines (seeded), never
  through the compound.
- **The hole crosses water freely** (like the City Island canal): the hole is only clamped to the coast; water is
  drawn with the stencil-cut ground material so the hole opens through it.
- Zone `water` (distance to a river polyline < half width, or inside a pond): only `River` / `ponds` items may stand
  there (lily pads, beaver dams, log bridges, swimmers). Zone `bank` (a 3 m strip on each side): reeds, cattails, logs,
  ducks, frogs.
- Render: river ribbons + banks (mud / sand strip) + pond discs as stencil-cut ground, the ripple texture of
  `render/water.ts` scrolled along the river direction (flow), foam where the river meets the sea.
- Crossings: `log_bridge` items (edible, 8.8 m) on the streams; the main river has none (the hole does not need bridges,
  walking animals stay on their side).

### 5.3 Hills (edible landscape)

- Hills are **catalog items** (group `hills`), not terrain: **flattened low-poly domes** (the D14 dome primitive, squashed to
  ~0.3 x the footprint; some variants with one terrace step or a rock band, grass top, darker earth foot) drawn with the
  item material, so they cast shadows, teeter, tip and fall
  like any item and need **no change to the hole / ground code** (the ground under a hill is plain grass).
- Ladder: `molehill` 0.6 m (T1) · `anthill` 0.8 m · `dirt_mound` 1.4 m · `termite_mound` 1.6 m · `hillock` 2.5 m ·
  `knoll` 4 m · `hill_5` .. `hill_30` (5.5-30 m, tiers 13-24) · `hill_great` 35 m (T25, 1 copy, the river spring on top).
  Low and wide (height ~0.3 x footprint), so footprint decides the size.
- Variants per hill: bare, 1-3 trees on top, rock outcrop, flower top, burrow (rabbit hole). Decoration is part of the
  hill mesh (D8: nothing stands on a hill), inside its triangle budget.
- Placement: clusters in the highlands (Poisson-disc with overlap allowed up to 15 % so they read as rolling hills),
  scattered single hills in the meadow / savanna, a ring of small hills around the waterhole. Never on water or in the
  compound. **At most 50 terrain hills** (`hillock` .. `hill_30` plus the great hill, per-type caps in `CAP`); the tiny mounds (molehill, anthill, dirt and termite mounds) are small items and stay plentiful.
- Movers treat hill footprints as blocked (walkable grid). When a hill is eaten the grid is **not** updated in v1
  (animals keep their routes; simple and deterministic).

### 5.4 The secret zoo and the laboratory

A fenced compound (~140 x 100 m, rotated to face the coast) in the north-east, hidden in the jungle. Generated from a
small hand-made layout (like the toy store floor plans) placed by the seed:

- **Perimeter**: `lab_fence` panels (electric, glowing top wire) with a gate on the jungle side, `watchtower`s on the
  corners, `camera_pole`s, `warning_sign`s; a jungle belt (jungle trees, bamboo) around it so it is hidden from the
  meadow.
- **Laboratory** (south half): `lab_hq` (T25, 1 copy) in the middle, `lab_wing`, `lab_block`, `lab_hangar`, `lab_dome`,
  `biodome`, `lab_tower`, `growth_reactor` aiming its ring at the giant pen, rows of `growth_vat`s and `growth_chamber`s
  (glowing tanks with an animal inside: the "where giants are made" story at a glance), `serum_barrel` stacks,
  `lab_crate`s, `container`s, a helipad (render-only decal) with the `helicopter`, a jetty (render-only, like the City
  pier) on the coast.
- **Secret zoo** (north half): pens built from `zoo_fence` rows for the lab-stage-1 animals (`rabbit_big`,
  `frog_big`, `tortoise_big`, `gorilla_big`, `panda_big`, `elephant_big`, `tiger_big`) and **giant pens** built from
  `cage_bars` rows (9 m tall bars) for the giants, with `feeding_station`s, `giant_carrot`s, `hay_bale`s, `keeper_hut`s, an `aviary`, a hippo pool
  (pond) and a croc channel.
- **Life**: `scientist`s patrol between lab doors, `zookeeper`s between pens, `research_jeep`s and the
  `transport_truck` drive the loop road (render-only road decal, patrol path).
- Zoo giants are leashed to their pen (leash = pen radius). P2 (AI-63): when every `cage_bars` piece of a pen is eaten,
  its giant's leash grows and it "escapes".

### 5.5 Generator order (`map/animal/generate.ts`)

coast -> biome map (sectors + noise) -> rivers, streams, ponds, waterhole -> compound layout (fixed rects, fences,
buildings, pens) -> hill clusters -> walkable grid + zone map (`water`, `bank`, biome zones, `zoo`, `lab`, `beach`) ->
big static anchors per biome (baobabs, redwoods, rock arches, the barn) -> giants (section 5.6) -> herds and packs
(home + leash) -> trees and bushes -> small animals and bugs (ant trails from anthills) -> flora fill -> `ensureAllTypes`
-> start point -> `balancePoints` (trim small items / top up with `grass_tuft`, `clover`, `pebble`, `flower`) to exactly
21 000. Every placement goes through one guard (`tryPut`: zone row, footprint, occupancy, inside the island) like City
Island's `SPAWN` table. Movers also get their `move` spec (home, leash, path, herd id) here, so the sim needs no
generation logic.

### 5.6 The giants (37 instances, 16 types)

14 live in the zoo paddock (the north strip of the compound, behind cage bars), 23 roam their biome (`GIANTS` in
`map/animal/generate.ts`). Counts are fixed for every seed.

| Tier | Pts | Type              | Zoo | Wild | Where the wild ones roam                |
| ---- | --- | ----------------- | --- | ---- | --------------------------------------- |
| 20   | 20  | `rabbit_giant`    | 1   | 2    | meadow                                  |
| 20   | 20  | `frog_giant`      | 1   | 2    | wetland                                 |
| 20   | 20  | `mouse_giant`     | 2   | 0    | -                                       |
| 20   | 20  | `giraffe_giant`   | 1   | 2    | savanna (64 m tall, seen from anywhere) |
| 21   | 25  | `ant_giant`       | 1   | 2    | jungle, meadow                          |
| 21   | 25  | `beetle_giant`    | 1   | 1    | forest                                  |
| 21   | 25  | `snail_giant`     | 1   | 1    | wetland                                 |
| 21   | 25  | `chicken_giant`   | 1   | 1    | farm, meadow                            |
| 22   | 30  | `bear_giant`      | 1   | 2    | forest                                  |
| 22   | 30  | `lion_giant`      | 0   | 2    | savanna                                 |
| 23   | 35  | `tortoise_giant`  | 0   | 2    | meadow, highlands                       |
| 23   | 35  | `hippo_giant`     | 1   | 1    | wetland                                 |
| 23   | 35  | `rhino_giant`     | 0   | 2    | savanna                                 |
| 24   | 40  | `crocodile_giant` | 0   | 2    | swims the rivers                        |
| 24   | 40  | `gorilla_giant`   | 2   | 0    | -                                       |
| 25   | 50  | `elephant_giant`  | 1   | 1    | savanna                                 |
|      |     | **total**         | 14  | 23   | **37 giants, 1 065 points**             |

Why 37: tiers 20-25 need >= 2 types each and enough instances to fill levels 10-15 without the late game being only
hills and buildings; ~5 % of the points matches the toy store. 20 would leave levels 13-15 with one or two targets; 50
would crowd the zoo and the wild biomes. Tune within 30-45 with the bot.

### 5.7 Points and pacing

21 000 points, about 4 900 items (1 880 of them tier 1), of which about 2 500 move (ants are the bulk). Pace targets are the same as the other
maps (good bot: Hard 120 s level >= 10, Medium 240 s level >= 15, Easy 480 s clears > 95 %), measured **with movement
and fleeing on**; `tests/hole/animal-map.test.ts` keeps the bands on three seeds (Hard level 10-20, Medium >= 15, Easy
cleared in 110-400 s). Measured (good bot, seeds 1-3, with the busy start): Hard level 16-17 (12-16 with a sparse start), Medium level 25, Easy cleared at 156-186 s.
What decided the pace (the XP curve was not touched): the **island radius** (210 m; the point split between tiers hardly
matters once the island is small), the per-tier share of the points (`TIER_FRACTION`, tiers 1-10 hold ~55 %, tier 1 7.5 %),
**hotspots** (80 % of the small and mid items gather around ~50 spots, `HOT_SHARE`), the 50-hill cap, and the flee knobs
(`FLEE` in `sim/movers.ts`; with the first guess, 1.7 x speed, the bot only reached level 5 in 100 s because it does not
lead moving targets). Radius sweep (seed 1, Hard level / Easy clear time): 168 m L25 / 98 s, 190 m L20 / 143 s, 210 m
L14 / 153 s, 240 m L8-12 / ~200 s.

**Reachability.** An item must be far enough from the coast for the biggest hole to eat it (the hole centre stops
0.5 D inside the coast): `tryPut` keeps `3 + 0.15 x size` m from the shore, and walkers keep off the shoreline strip of
the walk grid. Without it ~120 items near the coast could not be eaten and the island could not be cleared.

**Why 21 000 and not 20 000.** Levels 16-25 only grow the hole and are fed by the points on the map: the cumulative XP
to level 25 is 20 155. At 20 000 a full clear would end at level 24; at 21 000 level 25 needs ~96 % of the island, so it
is the reward for a near-clear (Easy), like on the other maps.

## 6. Asset list

### 6.1 Family ladders (the hero set)

The same rig at each size, like the plush families. Lab-grown sizes wear a **glowing green collar / ear tag** (a `glow`
part) so "made in the lab" reads at a glance; giants also get a lab number patch (a plain block, no text).

| Family    | Normal                                 | Big (lab stage 1)          | Giant                        |
| --------- | -------------------------------------- | -------------------------- | ---------------------------- |
| ant       | `ant` 0.15 m (T1)                      | `ant_big` 2.2 m (T7)       | `ant_giant` 18 m (T21)       |
| rabbit    | `rabbit` 0.45 m (T1)                   | `rabbit_big` 3.5 m (T10)   | `rabbit_giant` 16 m (T20)    |
| frog      | `frog` 0.25 m (T1)                     | `frog_big` 2.2 m (T7)      | `frog_giant` 15 m (T20)      |
| beetle    | `beetle` 0.3 m (T1)                    | `beetle_big` 4 m (T11)     | `beetle_giant` 19 m (T21)    |
| mouse     | `mouse`, `lab_mouse` 0.2 m (T1)        | -                          | `mouse_giant` 16 m (T20)     |
| snail     | `snail` 0.22 m (T1)                    | -                          | `snail_giant` 18 m (T21)     |
| chicken   | `chick`, `hen`, `rooster` (T1)         | -                          | `chicken_giant` 18 m (T21)   |
| tortoise  | `tortoise` 1 m (T2)                    | `tortoise_big` 6 m (T14)   | `tortoise_giant` 26 m (T23)  |
| gorilla   | `gorilla` 1.6 m (T5)                   | `gorilla_big` 5 m (T13)    | `gorilla_giant` 28 m (T24)   |
| panda     | `panda` 1.4 m (T4)                     | `panda_big` 3.5 m (T10)    | -                            |
| tiger     | `tiger` 1.9 m (T6)                     | `tiger_big` 4.8 m (T12)    | -                            |
| bear      | `bear` 1.9 m (T6)                      | -                          | `bear_giant` 22 m (T22)      |
| lion      | `lion` 2.2 m (T7)                      | -                          | `lion_giant` 22 m (T22)      |
| giraffe   | `giraffe_calf` (T5), `giraffe` (T9)    | -                          | `giraffe_giant` 64 m (T20)   |
| rhino     | `rhino` 3.5 m (T10)                    | -                          | `rhino_giant` 25 m (T23)     |
| hippo     | `hippo` 4.5 m (T12)                    | -                          | `hippo_giant` 25 m (T23)     |
| crocodile | `crocodile` 4.5 m (T12)                | `crocodile_big` 13 m (T19) | `crocodile_giant` 30 m (T24) |
| elephant  | `elephant_calf` (T8), `elephant` (T14) | `elephant_big` 8.8 m (T16) | `elephant_giant` 34 m (T25)  |

### 6.2 Edible catalog (192 types)

Dimensions are the proposal (animals: w = length along +X). Tier, points and level were derived with the rules of
`sim/progression.ts` by a throw-away script; **re-derive them with the real catalog code and the tests before trusting
them** (several items sit right under a tier edge: 1.2, 1.4, 8.8 m - builders must not grow past it). Priority: **P0** =
first playable (104 types, every tier 1-25 and level 1-15 has >= 2 P0 types) · **P1** = full v1 (81) · **P2** = polish
(5). Moves = behaviour (section 4.4). Zone = where the generator places it. `paint` = tinted per instance.

Coverage (all 190): tier 1 has 58 types, the thinnest tiers are 18 and 19 (3 types) and 25 (3); level 9 has 3 types,
level 15 has 3. P0 alone: tiers 9, 12, 14, 16-19, 23-25 and levels 9, 13-15 have exactly 2 - **protect those when
cutting items**. 97 of the 192 types move.

| Tier | Pts | Lvl | id                | Pri | Group    | Zone                      | w×d×h (m)      | size  | Moves   | Notes                                                                            |
| ---- | --- | --- | ----------------- | --- | -------- | ------------------------- | -------------- | ----- | ------- | -------------------------------------------------------------------------------- |
| 1    | 1   | L1  | `ant`             | P0  | bugs     | Meadow, Forest            | 0.15×0.06×0.05 | 0.15  | trail   | marches in columns between anthills and food                                     |
| 1    | 1   | L1  | `bee`             | P1  | bugs     | Meadow, Farm              | 0.15×0.12×0.1  | 0.15  | flutter | circles its beehive                                                              |
| 1    | 1   | L1  | `chick`           | P0  | critters | Farm                      | 0.18×0.12×0.15 | 0.18  | wander  | follows a hen                                                                    |
| 1    | 1   | L1  | `ladybug`         | P0  | bugs     | Meadow                    | 0.18×0.14×0.08 | 0.18  | skitter | paint: red / yellow / orange shell, black dots                                   |
| 1    | 1   | L1  | `dandelion`       | P1  | flora    | Meadow                    | 0.2×0.2×0.4    | 0.2   | -       | white puff head                                                                  |
| 1    | 1   | L1  | `duckling`        | P1  | critters | River, Wetland            | 0.2×0.12×0.18  | 0.2   | swim    | in a line behind a duck                                                          |
| 1    | 1   | L1  | `lab_mouse`       | P1  | critters | Lab                       | 0.2×0.08×0.1   | 0.2   | skitter | white, glowing ear tag                                                           |
| 1    | 1   | L1  | `mouse`           | P0  | critters | Meadow, Farm              | 0.2×0.08×0.1   | 0.2   | skitter | paint grey / brown; ladder: mouse -> mouse_giant                                 |
| 1    | 1   | L1  | `mushroom`        | P0  | flora    | Forest                    | 0.2×0.2×0.25   | 0.2   | -       | paint red / brown cap                                                            |
| 1    | 1   | L1  | `seashell`        | P1  | rocks    | Beach                     | 0.2×0.2×0.1    | 0.2   | -       | paint                                                                            |
| 1    | 1   | L1  | `snail`           | P0  | bugs     | Meadow, Wetland           | 0.22×0.1×0.15  | 0.22  | crawl   | swirl shell (stacked boxes); ladder: snail -> snail_giant                        |
| 1    | 1   | L1  | `ant_soldier`     | P1  | bugs     | Meadow, Forest            | 0.25×0.1×0.08  | 0.25  | trail   | big head and jaws, guards the anthill                                            |
| 1    | 1   | L1  | `flower`          | P0  | flora    | Meadow, everywhere        | 0.25×0.25×0.4  | 0.25  | -       | paint petals                                                                     |
| 1    | 1   | L1  | `frog`            | P0  | critters | Wetland, River            | 0.25×0.2×0.15  | 0.25  | hop     | paint; ladder: frog -> frog_big -> frog_giant                                    |
| 1    | 1   | L1  | `beetle`          | P0  | bugs     | Forest                    | 0.3×0.18×0.12  | 0.3   | skitter | paint: green / blue / bronze shell; ladder: beetle -> beetle_big -> beetle_giant |
| 1    | 1   | L1  | `butterfly`       | P1  | bugs     | Meadow                    | 0.3×0.25×0.1   | 0.3   | flutter | paint wings; flutters 0.3-1 m above the ground (y bob)                           |
| 1    | 1   | L1  | `caterpillar`     | P1  | bugs     | Meadow, Forest            | 0.3×0.06×0.06  | 0.3   | crawl   | 5 segments, paint                                                                |
| 1    | 1   | L1  | `clover`          | P1  | flora    | Meadow                    | 0.3×0.3×0.1    | 0.3   | -       | 1-point filler                                                                   |
| 1    | 1   | L1  | `hedgehog`        | P0  | critters | Forest, Meadow            | 0.3×0.2×0.18   | 0.3   | wander  | spikes as a stepped dome                                                         |
| 1    | 1   | L1  | `meerkat`         | P1  | critters | Savanna                   | 0.3×0.12×0.4   | 0.3   | wander  | stands up when idle (pose variant)                                               |
| 1    | 1   | L1  | `owl`             | P2  | critters | Forest                    | 0.3×0.3×0.5    | 0.3   | -       | sits on a stump                                                                  |
| 1    | 1   | L1  | `pebble`          | P0  | rocks    | everywhere                | 0.3×0.25×0.15  | 0.3   | -       | 1-point filler                                                                   |
| 1    | 1   | L1  | `spider`          | P2  | bugs     | Forest, Jungle            | 0.3×0.3×0.1    | 0.3   | skitter | cartoon, 8 legs, big eyes (not scary)                                            |
| 1    | 1   | L1  | `starfish`        | P1  | rocks    | Beach                     | 0.3×0.3×0.05   | 0.3   | -       | paint                                                                            |
| 1    | 1   | L1  | `crab`            | P0  | critters | Beach                     | 0.35×0.25×0.12 | 0.35  | skitter | walks sideways                                                                   |
| 1    | 1   | L1  | `dragonfly`       | P2  | bugs     | Wetland, River            | 0.35×0.3×0.06  | 0.35  | flutter | hovers over the water                                                            |
| 1    | 1   | L1  | `grasshopper`     | P0  | bugs     | Meadow, Savanna           | 0.35×0.1×0.15  | 0.35  | hop     | long back legs                                                                   |
| 1    | 1   | L1  | `cattail`         | P1  | flora    | Wetland                   | 0.4×0.4×1.6    | 0.4   | -       | brown heads                                                                      |
| 1    | 1   | L1  | `egg_nest`        | P1  | flora    | Meadow, Forest            | 0.4×0.4×0.2    | 0.4   | -       | 3 eggs in twigs                                                                  |
| 1    | 1   | L1  | `feed_bucket`     | P1  | zoo      | Zoo                       | 0.4×0.4×0.4    | 0.4   | -       |                                                                                  |
| 1    | 1   | L1  | `parrot`          | P1  | critters | Jungle                    | 0.4×0.2×0.4    | 0.4   | wander  | paint red / blue / green                                                         |
| 1    | 1   | L1  | `duck`            | P0  | critters | River, Wetland            | 0.45×0.25×0.4  | 0.45  | swim    | swims along the river                                                            |
| 1    | 1   | L1  | `hen`             | P0  | critters | Farm                      | 0.45×0.25×0.45 | 0.45  | wander  | pecks (head bob); ladder: hen -> chicken_giant                                   |
| 1    | 1   | L1  | `rabbit`          | P0  | critters | Meadow                    | 0.45×0.25×0.4  | 0.45  | hop     | ladder: rabbit -> rabbit_big -> rabbit_giant                                     |
| 1    | 1   | L1  | `seagull`         | P1  | critters | Beach                     | 0.45×0.3×0.35  | 0.45  | wander  |                                                                                  |
| 1    | 1   | L1  | `squirrel`        | P0  | critters | Forest                    | 0.45×0.15×0.3  | 0.45  | skitter | big curled tail                                                                  |
| 1    | 1   | L1  | `flamingo`        | P1  | critters | Wetland                   | 0.5×0.3×1.3    | 0.5   | herd    | pink, flocks in shallow water                                                    |
| 1    | 1   | L1  | `grass_tuft`      | P0  | flora    | everywhere                | 0.5×0.5×0.3    | 0.5   | -       | 1-point filler for balancePoints                                                 |
| 1    | 1   | L1  | `lily_pad`        | P0  | flora    | River, ponds              | 0.5×0.5×0.03   | 0.5   | -       | stands ON the water; paint (some with a pink flower)                             |
| 1    | 1   | L1  | `penguin`         | P1  | critters | Beach                     | 0.5×0.4×0.7    | 0.5   | wander  | waddle (roll sway)                                                               |
| 1    | 1   | L1  | `reeds`           | P0  | flora    | Wetland, river bank       | 0.5×0.5×1.4    | 0.5   | -       |                                                                                  |
| 1    | 1   | L1  | `rooster`         | P1  | critters | Farm                      | 0.5×0.25×0.6   | 0.5   | wander  | red comb, tail                                                                   |
| 1    | 1   | L1  | `scientist`       | P0  | staff    | Lab, Zoo                  | 0.5×0.35×1.75  | 0.5   | patrol  | white coat, clipboard; walks between lab doors                                   |
| 1    | 1   | L1  | `zookeeper`       | P0  | staff    | Zoo                       | 0.5×0.35×1.75  | 0.5   | patrol  | khaki overalls, bucket                                                           |
| 1    | 1   | L1  | `beehive`         | P1  | farm     | Meadow, Farm              | 0.6×0.6×1      | 0.6   | -       | box hive on legs, bees circle it                                                 |
| 1    | 1   | L1  | `fern`            | P0  | flora    | Forest, Jungle            | 0.6×0.6×0.5    | 0.6   | -       |                                                                                  |
| 1    | 1   | L1  | `heron`           | P2  | critters | Wetland, River            | 0.6×0.3×1      | 0.6   | wander  | grey, long legs                                                                  |
| 1    | 1   | L1  | `molehill`        | P0  | hills    | Meadow                    | 0.6×0.6×0.25   | 0.6   | -       | hill ladder, rung 1                                                              |
| 1    | 1   | L1  | `monkey`          | P0  | critters | Jungle                    | 0.6×0.3×0.6    | 0.6   | wander  | long tail, paint brown / gold                                                    |
| 1    | 1   | L1  | `serum_barrel`    | P0  | lab      | Lab                       | 0.6×0.6×0.9    | 0.6   | -       | glowing green band (glow)                                                        |
| 1    | 1   | L1  | `warning_sign`    | P0  | lab      | Zoo, Lab                  | 0.6×0.1×1.5    | 0.6   | -       | generic hazard triangle with a paw print (no real logos)                         |
| 1    | 1   | L1  | `raccoon`         | P1  | critters | Forest                    | 0.7×0.3×0.4    | 0.7   | wander  | striped tail, mask                                                               |
| 1    | 1   | L1  | `camera_pole`     | P1  | lab      | Lab perimeter             | 0.3×0.3×3      | 0.75  | -       | security camera, red glow dot                                                    |
| 1    | 1   | L1  | `anthill`         | P0  | hills    | Meadow, Forest            | 0.8×0.8×0.6    | 0.8   | -       | ant trails start here                                                            |
| 1    | 1   | L1  | `otter`           | P1  | critters | River                     | 0.8×0.2×0.3    | 0.8   | swim    |                                                                                  |
| 1    | 1   | L1  | `beaver`          | P1  | critters | River, Wetland            | 0.85×0.3×0.35  | 0.85  | wander  | flat tail, near the beaver dam                                                   |
| 1    | 1   | L1  | `fox`             | P0  | critters | Forest, Meadow            | 0.85×0.25×0.45 | 0.85  | wander  | orange, white tail tip                                                           |
| 1    | 1   | L1  | `lab_cart`        | P1  | lab      | Lab                       | 0.85×0.5×1     | 0.85  | -       | trolley with glowing sample tubes                                                |
| 2    | 2   | L2  | `boulder_small`   | P0  | rocks    | Highlands, Beach          | 1×0.9×0.7      | 1     | -       |                                                                                  |
| 2    | 2   | L2  | `bush_small`      | P0  | flora    | everywhere                | 1×1×0.8        | 1     | -       |                                                                                  |
| 2    | 2   | L2  | `feeding_trough`  | P0  | zoo      | Zoo, Farm                 | 1×0.5×0.5      | 1     | -       |                                                                                  |
| 2    | 2   | L2  | `hay_bale`        | P0  | farm     | Farm, Zoo                 | 1×1×1          | 1     | -       |                                                                                  |
| 2    | 2   | L2  | `lab_crate`       | P0  | lab      | Lab                       | 1×1×1          | 1     | -       | crate with a paw-print mark (no text)                                            |
| 2    | 2   | L2  | `lamb`            | P1  | animals  | Highlands, Farm           | 1×0.4×0.8      | 1     | herd    | follows a sheep                                                                  |
| 2    | 2   | L2  | `tortoise`        | P0  | animals  | Meadow, Savanna           | 1×0.7×0.5      | 1     | crawl   | ladder: tortoise -> tortoise_big -> tortoise_giant                               |
| 2    | 2   | L2  | `tree_stump`      | P0  | flora    | Forest                    | 1×1×0.6        | 1     | -       | rings on top                                                                     |
| 3    | 3   | L2  | `goat`            | P0  | animals  | Highlands                 | 1.15×0.4×0.95  | 1.15  | herd    | horns; grazes between the hills                                                  |
| 3    | 3   | L2  | `boar`            | P1  | animals  | Forest                    | 1.2×0.5×0.8    | 1.2   | wander  | tusks                                                                            |
| 3    | 3   | L2  | `flower_patch`    | P0  | flora    | Meadow                    | 1.2×1.2×0.3    | 1.2   | -       | mixed flowers                                                                    |
| 3    | 3   | L2  | `kangaroo`        | P1  | animals  | Savanna                   | 1.2×0.5×1.6    | 1.2   | hop     |                                                                                  |
| 3    | 3   | L2  | `ostrich`         | P1  | animals  | Savanna                   | 1.2×0.6×2.5    | 1.2   | herd    |                                                                                  |
| 3    | 3   | L2  | `pig`             | P0  | animals  | Farm                      | 1.2×0.6×0.8    | 1.2   | wander  | pink                                                                             |
| 3    | 3   | L2  | `sheep`           | P0  | animals  | Highlands, Meadow         | 1.2×0.6×1      | 1.2   | herd    | woolly stepped body, paint white / cream / black                                 |
| 3    | 3   | L2  | `wolf`            | P1  | animals  | Forest                    | 1.2×0.35×0.8   | 1.2   | herd    | pack of 3-5                                                                      |
| 4    | 4   | L2  | `warthog`         | P2  | animals  | Savanna                   | 1.3×0.5×0.8    | 1.3   | wander  |                                                                                  |
| 4    | 4   | L2  | `alpaca`          | P1  | animals  | Highlands                 | 1.4×0.5×1.7    | 1.4   | herd    | paint white / brown / grey                                                       |
| 4    | 4   | L2  | `antelope`        | P1  | animals  | Savanna                   | 1.4×0.4×1.3    | 1.4   | herd    |                                                                                  |
| 4    | 4   | L2  | `boulder`         | P0  | rocks    | Highlands, Beach, Savanna | 1.4×1.2×1      | 1.4   | -       |                                                                                  |
| 4    | 4   | L2  | `bush_large`      | P0  | flora    | everywhere                | 1.4×1.4×1.2    | 1.4   | -       |                                                                                  |
| 4    | 4   | L2  | `deer`            | P0  | animals  | Forest                    | 1.4×0.45×1.4   | 1.4   | herd    | antlers on variant 1                                                             |
| 4    | 4   | L2  | `dirt_mound`      | P0  | hills    | Meadow, Savanna           | 1.4×1.4×0.5    | 1.4   | -       | hill ladder                                                                      |
| 4    | 4   | L2  | `lab_desk`        | P1  | lab      | Lab                       | 1.4×0.7×1      | 1.4   | -       | computer desk, glowing screen                                                    |
| 4    | 4   | L2  | `log`             | P0  | flora    | Forest, river bank        | 1.4×0.4×0.4    | 1.4   | -       |                                                                                  |
| 4    | 4   | L2  | `panda`           | P1  | animals  | Jungle, Zoo               | 1.4×0.8×1      | 1.4   | wander  | near the bamboo; ladder: panda -> panda_big                                      |
| 5    | 5   | L3  | `giraffe_calf`    | P1  | animals  | Savanna                   | 1.6×0.5×3      | 1.6   | herd    | follows a giraffe                                                                |
| 5    | 5   | L3  | `gorilla`         | P0  | animals  | Jungle, Zoo               | 1.6×1×1.5      | 1.6   | wander  | knuckle walk; ladder: gorilla -> gorilla_big -> gorilla_giant                    |
| 5    | 5   | L3  | `growth_vat`      | P0  | lab      | Lab                       | 1.6×1.6×3.2    | 1.6   | -       | glass tank, green glow, a small animal inside (the lab signature)                |
| 5    | 5   | L3  | `leopard`         | P1  | animals  | Jungle                    | 1.6×0.4×0.8    | 1.6   | wander  | spots                                                                            |
| 5    | 5   | L3  | `termite_mound`   | P0  | hills    | Savanna                   | 1.6×1.6×3.2    | 1.6   | -       | tall stepped spire                                                               |
| 5    | 5   | L3  | `tree_small`      | P0  | flora    | everywhere                | 1.6×1.6×3.5    | 1.6   | -       |                                                                                  |
| 6    | 6   | L3  | `jungle_plant`    | P0  | flora    | Jungle                    | 1.8×1.8×1.6    | 1.8   | -       | big leaves                                                                       |
| 6    | 6   | L3  | `palm_tree`       | P0  | flora    | Beach, Jungle             | 1.8×1.8×7      | 1.8   | -       |                                                                                  |
| 6    | 6   | L3  | `seal`            | P1  | animals  | Beach                     | 1.8×0.6×0.6    | 1.8   | wander  | flops (slow, bob)                                                                |
| 6    | 6   | L3  | `bear`            | P0  | animals  | Forest                    | 1.9×0.9×1.3    | 1.9   | wander  | ladder: bear -> bear_giant                                                       |
| 6    | 6   | L3  | `boulder_big`     | P1  | rocks    | Highlands                 | 1.9×1.6×1.4    | 1.9   | -       |                                                                                  |
| 6    | 6   | L3  | `tiger`           | P0  | animals  | Jungle                    | 1.9×0.6×1      | 1.9   | wander  | stripes; ladder: tiger -> tiger_big                                              |
| 7    | 7   | L3  | `berry_bush`      | P1  | flora    | Forest                    | 2×2×1.3        | 2     | -       | paint berries                                                                    |
| 7    | 7   | L3  | `fence_wood`      | P0  | zoo      | Farm, Zoo                 | 2.1×0.1×1.2    | 2.1   | -       | rows                                                                             |
| 7    | 7   | L3  | `hedge`           | P1  | flora    | Zoo, Lab                  | 2.1×0.8×1.2    | 2.1   | -       |                                                                                  |
| 7    | 7   | L3  | `ant_big`         | P1  | animals  | Lab, Meadow               | 2.2×0.9×0.8    | 2.2   | trail   | lab stage 1, an escaped column near the lab                                      |
| 7    | 7   | L3  | `frog_big`        | P1  | animals  | Zoo, Lab                  | 2.2×1.8×1.4    | 2.2   | hop     | lab stage 1, glowing collar                                                      |
| 7    | 7   | L3  | `lab_fence`       | P0  | lab      | Lab                       | 2.2×0.15×3     | 2.2   | -       | electric panel, glowing top wire                                                 |
| 7    | 7   | L3  | `lion`            | P0  | animals  | Savanna                   | 2.2×0.7×1.2    | 2.2   | wander  | mane on variant 1; ladder: lion -> lion_giant                                    |
| 7    | 7   | L3  | `zebra`           | P0  | animals  | Savanna                   | 2.2×0.6×1.4    | 2.2   | herd    | stripes                                                                          |
| 7    | 7   | L3  | `zoo_fence`       | P0  | zoo      | Zoo                       | 2.2×0.1×2.5    | 2.2   | -       | mesh panel, rows around the pens                                                 |
| 8    | 8   | L3  | `cow`             | P0  | animals  | Farm, Meadow              | 2.4×0.8×1.5    | 2.4   | herd    | patches (variants)                                                               |
| 8    | 8   | L3  | `elephant_calf`   | P0  | animals  | Savanna                   | 2.4×1.2×1.8    | 2.4   | herd    | follows the herd                                                                 |
| 8    | 8   | L3  | `horse`           | P1  | animals  | Farm, Meadow              | 2.4×0.7×1.7    | 2.4   | herd    | paint                                                                            |
| 8    | 8   | L3  | `hillock`         | P0  | hills    | Meadow, Highlands         | 2.5×2.5×0.8    | 2.5   | -       |                                                                                  |
| 8    | 8   | L3  | `camel`           | P1  | animals  | Savanna                   | 2.6×0.8×2.2    | 2.6   | wander  |                                                                                  |
| 8    | 8   | L3  | `tree`            | P0  | flora    | everywhere                | 2.6×2.6×6      | 2.6   | -       |                                                                                  |
| 9    | 9   | L4  | `acacia`          | P0  | flora    | Savanna                   | 3×3×5          | 3     | -       | flat crown                                                                       |
| 9    | 9   | L4  | `bison`           | P1  | animals  | Meadow, Savanna           | 3×1.2×1.9      | 3     | herd    |                                                                                  |
| 9    | 9   | L4  | `boulder_pile`    | P1  | rocks    | Highlands                 | 3×2.6×1.6      | 3     | -       |                                                                                  |
| 9    | 9   | L4  | `giraffe`         | P0  | animals  | Savanna                   | 3×1.2×5.5      | 3     | herd    | tall, reads from far; ladder: giraffe_calf -> giraffe -> giraffe_giant           |
| 9    | 9   | L4  | `moose`           | P1  | animals  | Forest                    | 3×1×2.2        | 3     | wander  |                                                                                  |
| 9    | 9   | L4  | `watchtower`      | P1  | lab      | Lab perimeter             | 3×3×12         | 3     | -       | searchlight (glow)                                                               |
| 10   | 10  | L4  | `feeding_station` | P1  | zoo      | Zoo                       | 3.2×3.2×2.5    | 3.2   | -       |                                                                                  |
| 10   | 10  | L4  | `fallen_log`      | P1  | flora    | Forest, river bank        | 3.4×0.8×0.8    | 3.4   | -       |                                                                                  |
| 10   | 10  | L4  | `keeper_hut`      | P1  | zoo      | Zoo                       | 3.5×3×3        | 3.5   | -       |                                                                                  |
| 10   | 10  | L4  | `rabbit_big`      | P0  | animals  | Zoo, Meadow               | 3.5×1.8×3      | 3.5   | hop     | lab stage 1; one escaped near the start (first teeter target)                    |
| 10   | 10  | L4  | `panda_big`       | P1  | animals  | Zoo, Jungle               | 3.5×2×2.5      | 3.5   | wander  | lab stage 1, zoo pen + escaped near the bamboo                                   |
| 10   | 10  | L4  | `research_jeep`   | P0  | labveh   | Lab, Zoo                  | 3.5×1.8×1.8    | 3.5   | patrol  | drives the compound loop road                                                    |
| 10   | 10  | L4  | `rhino`           | P0  | animals  | Savanna                   | 3.5×1.5×1.8    | 3.5   | wander  | ladder: rhino -> rhino_giant                                                     |
| 11   | 11  | L5  | `beetle_big`      | P1  | animals  | Lab, Forest               | 4×2.6×1.8      | 4     | skitter | lab stage 1                                                                      |
| 11   | 11  | L5  | `cage_bars`       | P0  | zoo      | Zoo                       | 4×0.5×9        | 4     | -       | giant-cage bar section, rows around the giant pens                               |
| 11   | 11  | L5  | `knoll`           | P0  | hills    | Meadow, Highlands         | 4×4×1.2        | 4     | -       |                                                                                  |
| 11   | 11  | L5  | `lab_generator`   | P1  | lab      | Lab                       | 4×2×2.5        | 4     | -       | glow                                                                             |
| 11   | 11  | L5  | `oak`             | P0  | flora    | Forest, Meadow            | 4×4×8          | 4     | -       |                                                                                  |
| 11   | 11  | L5  | `satellite_dish`  | P1  | lab      | Lab                       | 4×4×5          | 4     | -       |                                                                                  |
| 12   | 12  | L5  | `bamboo_grove`    | P1  | flora    | Jungle, Zoo               | 4.5×4.5×7      | 4.5   | -       |                                                                                  |
| 12   | 12  | L5  | `crocodile`       | P0  | animals  | River, Wetland            | 4.5×1×0.7      | 4.5   | swim    | ladder: crocodile -> crocodile_big -> crocodile_giant                            |
| 12   | 12  | L5  | `hippo`           | P0  | animals  | River, Wetland            | 4.5×1.8×1.8    | 4.5   | swim    | half submerged while swimming; ladder: hippo -> hippo_giant                      |
| 12   | 12  | L5  | `giant_carrot`    | P1  | zoo      | Zoo                       | 4.6×1.2×1.2    | 4.6   | -       | food for the giant rabbits                                                       |
| 12   | 12  | L5  | `beaver_dam`      | P1  | flora    | River                     | 4.8×2×1.5      | 4.8   | -       | across a stream                                                                  |
| 12   | 12  | L5  | `tiger_big`       | P1  | animals  | Zoo, Jungle               | 4.8×1.5×2.5    | 4.8   | wander  | lab stage 1, zoo pen + escaped into the jungle                                   |
| 13   | 13  | L6  | `gorilla_big`     | P1  | animals  | Zoo                       | 5×3×5          | 5     | wander  | lab stage 1                                                                      |
| 13   | 13  | L6  | `hill_5`          | P0  | hills    | Highlands, everywhere     | 5.5×5.5×1.8    | 5.5   | -       | soft dome                                                                        |
| 13   | 13  | L6  | `jungle_tree`     | P0  | flora    | Jungle                    | 5.5×5.5×12     | 5.5   | -       | buttress roots, tall                                                             |
| 13   | 13  | L6  | `tree_big`        | P0  | flora    | Forest, Meadow            | 5.5×5.5×10     | 5.5   | -       |                                                                                  |
| 13   | 13  | L6  | `zoo_shed`        | P1  | zoo      | Zoo                       | 5.5×5×4        | 5.5   | -       |                                                                                  |
| 14   | 14  | L6  | `boulder_huge`    | P1  | rocks    | Highlands                 | 6×5×4          | 6     | -       |                                                                                  |
| 14   | 14  | L6  | `growth_chamber`  | P0  | lab      | Lab                       | 6×6×8          | 6     | -       | big glowing tank with a bear inside                                              |
| 14   | 14  | L6  | `tortoise_big`    | P1  | animals  | Zoo, Meadow               | 6×4.5×3        | 6     | crawl   | lab stage 1                                                                      |
| 14   | 14  | L6  | `container`       | P1  | lab      | Lab                       | 6.1×2.4×2.6    | 6.1   | -       | shipping container, paint                                                        |
| 14   | 14  | L6  | `elephant`        | P0  | animals  | Savanna                   | 6.4×2.2×3.4    | 6.4   | herd    | ladder: elephant_calf -> elephant -> elephant_big -> elephant_giant              |
| 15   | 15  | L7  | `baobab`          | P0  | flora    | Savanna                   | 7×7×12         | 7     | -       |                                                                                  |
| 15   | 15  | L7  | `hill_7`          | P0  | hills    | Highlands, everywhere     | 7×7×2.4        | 7     | -       |                                                                                  |
| 15   | 15  | L7  | `greenhouse`      | P1  | lab      | Lab                       | 7.5×5×4        | 7.5   | -       | glass style                                                                      |
| 15   | 15  | L7  | `transport_truck` | P0  | labveh   | Lab, Zoo                  | 7.5×2.5×3.5    | 7.5   | patrol  | flatbed with a cage (big animal inside, part of the mesh)                        |
| 16   | 16  | L7  | `helicopter`      | P1  | labveh   | Lab                       | 8.5×2.5×3      | 8.5   | -       | on the helipad                                                                   |
| 16   | 16  | L7  | `hill_9`          | P0  | hills    | Highlands, everywhere     | 8.5×8.5×2.8    | 8.5   | -       |                                                                                  |
| 16   | 16  | L7  | `elephant_big`    | P1  | animals  | Zoo                       | 8.8×3.5×5      | 8.8   | wander  | lab stage 1                                                                      |
| 16   | 16  | L7  | `log_bridge`      | P0  | flora    | River                     | 8.8×2.5×1.2    | 8.8   | -       | plank bridge over the streams                                                    |
| 16   | 16  | L7  | `rock_arch`       | P1  | rocks    | Highlands, Beach          | 8.8×3×6        | 8.8   | -       |                                                                                  |
| 17   | 17  | L8  | `aviary`          | P1  | zoo      | Zoo                       | 10×10×9        | 10    | -       | net dome with birds (part of the mesh)                                           |
| 17   | 17  | L8  | `barn`            | P1  | farm     | Farm                      | 10×8×7         | 10    | -       |                                                                                  |
| 17   | 17  | L8  | `hill_10`         | P0  | hills    | Highlands                 | 10×10×3.2      | 10    | -       |                                                                                  |
| 17   | 17  | L8  | `lab_dome`        | P0  | lab      | Lab                       | 10×10×6        | 10    | -       |                                                                                  |
| 18   | 18  | L8  | `redwood`         | P1  | flora    | Forest                    | 6×6×45         | 11.25 | -       | very tall tree, height decides the tier                                          |
| 18   | 18  | L8  | `hill_12`         | P0  | hills    | Highlands                 | 12×11×3.8      | 12    | -       |                                                                                  |
| 18   | 18  | L8  | `lab_block`       | P0  | lab      | Lab                       | 12×9×8         | 12    | -       | punched windows                                                                  |
| 19   | 19  | L9  | `crocodile_big`   | P1  | animals  | River                     | 13×3×2         | 13    | swim    | lab stage 1, escaped into the river                                              |
| 19   | 19  | L9  | `hill_14`         | P0  | hills    | Highlands                 | 14×13×4.4      | 14    | -       |                                                                                  |
| 19   | 19  | L9  | `lab_hangar`      | P0  | lab      | Lab                       | 14×12×8        | 14    | -       | big door half open, a giant crate inside                                         |
| 20   | 20  | L10 | `frog_giant`      | P0  | giants   | Zoo, Wetland              | 15×13×9        | 15    | roam    | GIANT, sits in the big pond                                                      |
| 20   | 20  | L10 | `lab_tower`       | P1  | lab      | Lab                       | 14×14×60       | 15    | -       | antenna mast, height decides the tier                                            |
| 20   | 20  | L10 | `giraffe_giant`   | P0  | giants   | Zoo, Savanna              | 15×6×64        | 16    | roam    | GIANT, the tallest thing on the island (visible from the start)                  |
| 20   | 20  | L10 | `hill_16`         | P0  | hills    | Highlands                 | 16×15×5        | 16    | -       |                                                                                  |
| 20   | 20  | L10 | `mouse_giant`     | P1  | giants   | Lab, Zoo                  | 16×6×7         | 16    | roam    | GIANT, white lab mouse                                                           |
| 20   | 20  | L10 | `rabbit_giant`    | P0  | giants   | Zoo, Meadow               | 16×8×14        | 16    | roam    | GIANT                                                                            |
| 21   | 25  | L11 | `ant_giant`       | P0  | giants   | Lab, Meadow               | 18×8×6         | 18    | roam    | GIANT                                                                            |
| 21   | 25  | L11 | `chicken_giant`   | P1  | giants   | Zoo, Farm                 | 18×10×18       | 18    | roam    | GIANT                                                                            |
| 21   | 25  | L11 | `snail_giant`     | P1  | giants   | Zoo, Wetland              | 18×8×12        | 18    | roam    | GIANT, slowest mover on the island                                               |
| 21   | 25  | L11 | `beetle_giant`    | P1  | giants   | Zoo, Forest               | 19×12×8        | 19    | roam    | GIANT                                                                            |
| 21   | 25  | L11 | `hill_19`         | P0  | hills    | Highlands                 | 19×17×6        | 19    | -       |                                                                                  |
| 21   | 25  | L11 | `lab_wing`        | P0  | lab      | Lab                       | 19×14×10       | 19    | -       |                                                                                  |
| 22   | 30  | L12 | `bear_giant`      | P0  | giants   | Zoo, Forest               | 22×11×15       | 22    | roam    | GIANT                                                                            |
| 22   | 30  | L12 | `biodome`         | P0  | lab      | Lab                       | 22×22×14       | 22    | -       | glass dome with jungle inside                                                    |
| 22   | 30  | L12 | `hill_22`         | P0  | hills    | Highlands                 | 22×20×7        | 22    | -       |                                                                                  |
| 22   | 30  | L12 | `lion_giant`      | P1  | giants   | Zoo, Savanna              | 22×7×12        | 22    | roam    | GIANT                                                                            |
| 23   | 35  | L13 | `hippo_giant`     | P1  | giants   | Zoo, River                | 25×10×10       | 25    | roam    | GIANT                                                                            |
| 23   | 35  | L13 | `rhino_giant`     | P1  | giants   | Zoo, Savanna              | 25×10×12       | 25    | roam    | GIANT                                                                            |
| 23   | 35  | L13 | `hill_26`         | P0  | hills    | Highlands                 | 26×24×8        | 26    | -       |                                                                                  |
| 23   | 35  | L13 | `tortoise_giant`  | P0  | giants   | Zoo, Meadow               | 26×20×13       | 26    | roam    | GIANT, trees on its shell (part of the mesh)                                     |
| 24   | 40  | L14 | `gorilla_giant`   | P0  | giants   | Zoo, Jungle               | 28×20×36       | 28    | roam    | GIANT (generic giant ape, no film references)                                    |
| 24   | 40  | L14 | `crocodile_giant` | P0  | giants   | River, Zoo                | 30×7×5         | 30    | swim    | GIANT, swims the main river                                                      |
| 24   | 40  | L14 | `growth_reactor`  | P1  | lab      | Lab                       | 30×30×30       | 30    | -       | ring machine aiming a growth ray at a pen (glow)                                 |
| 24   | 40  | L14 | `hill_30`         | P1  | hills    | Highlands                 | 30×27×9        | 30    | -       |                                                                                  |
| 25   | 50  | L15 | `elephant_giant`  | P0  | giants   | Zoo, Savanna              | 34×14×22       | 34    | roam    | GIANT, the final boss of the island                                              |
| 25   | 50  | L15 | `lab_hq`          | P0  | lab      | Lab                       | 34×30×22       | 34    | -       | the secret laboratory, 1 copy                                                    |
| 25   | 50  | L15 | `hill_great`      | P1  | hills    | Highlands                 | 35×32×10       | 35    | -       | highest hill, river source on top, 1 copy                                        |

### 6.3 Rigs (`items/build-animals.ts`)

One parametric rig per body plan, like `build-plush.ts`: a family = proportions (body / head / leg / tail parts as
fractions of w x d x h), palette, pattern (stripes, spots, patches as vertex-colour boxes 1-3 cm proud), extras (horns,
mane, trunk, shell, antlers, comb). Sizes are fractions of the catalog size, so the built size equals the catalog size.

| Rig         | Families                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quadruped` | fox, raccoon, wolf, deer, goat, sheep, lamb, pig, boar, cow, horse, zebra, camel, lion, tiger, leopard, bear, panda, rhino, hippo, elephant, giraffe, moose, bison, antelope, alpaca, warthog, mouse, hedgehog, squirrel, beaver, otter, meerkat |
| `hopper`    | rabbit, frog, kangaroo, grasshopper                                                                                                                                                                                                              |
| `bird`      | chick, hen, rooster, duck, duckling, seagull, penguin, parrot, flamingo, ostrich, heron, owl                                                                                                                                                     |
| `insect`    | ant (+ soldier), beetle, ladybug, bee, butterfly, dragonfly, spider (8 legs)                                                                                                                                                                     |
| `reptile`   | crocodile, tortoise (shell), seal / sea mammal low body                                                                                                                                                                                          |
| `ape`       | gorilla, monkey                                                                                                                                                                                                                                  |
| `slug`      | snail, caterpillar                                                                                                                                                                                                                               |
| `crab`      | crab (sideways)                                                                                                                                                                                                                                  |

**Round shapes (D14).** The Mesher has one new primitive (built), `ball(x, y, z, rx, ry, rz, opts)`: a low-poly UV ellipsoid,
flat shaded (faceted), vertex colour + `paint` / `glow` like `box()`, through `xf()` transforms. Options: `seg` (around)
and `rings`, `taper` (the top half narrower = an **egg**), `half` (a **dome** with no bottom face, for things on the
ground), `jitter` (seeded vertex noise for boulders). Triangles = 2 x seg x (rings - 1): 6 x 4 = 36, 8 x 5 = 64,
10 x 6 = 100, 12 x 8 = 168; a dome is half. Detail by size with one helper (bugs 6 x 3-4, critters 6-8 x 4, animals 8 x 5,
giants 10-12 x 6-8), so small things stay cheap.

| Shape                 | Used for                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| egg                   | bodies (most animals, birds, insect abdomens), heads, beaks / snouts on small animals, ears (flattened), the eggs in the nest   |
| ball                  | eyes, noses, paws / hooves of small animals, tail puffs (rabbit, sheep), wool (a cluster of 5-9 balls), insect heads and thorax |
| dome                  | tortoise / snail / ladybug / beetle shells, mushroom caps, hills, anthills / molehills, lab domes, biodome, growth vat tops     |
| jittered ball         | boulders, rocks, pebbles, bush and some tree crowns (oak, acacia flattened, jungle tree)                                        |
| box / cylinder (stay) | legs, horns, antlers, tails of big animals, necks (giraffe: a tapered box), every building, fence, vehicle and crate            |

Every leg / wing part is marked as a **limb** in the Mesher (front-left, front-right, back-left, back-right, wing) for the
v1.1 leg-swing shader (D9). Giants use the same rig with a higher detail level (more segments in tails, toes, ears).

### 6.4 Non-edible assets (render-only, derived from the map data)

| Asset                    | Notes                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Island ground            | one merged mesh, stencil-cut: **per-biome grass tint** (vertex colours from the biome grid, blended at the borders), sand band, coast skirt |
| Rivers / streams / ponds | ribbon + disc meshes, stencil-cut, flowing ripple texture, mud / sand banks, foam at the mouth                                              |
| Waterfall                | P2: a short drop where the spring leaves the great hill (animated texture strip)                                                            |
| Compound ground          | concrete pads, packed-earth pens, loop road + helipad decal (stencil-cut, like City Island rects)                                           |
| Jetty                    | plank pier at the compound coast (reuse the City pier builder)                                                                              |
| Coast rocks              | reuse the City Island rock ring                                                                                                             |
| Sky / mood               | warmer tropical sky (`skyTop`), sun slightly lower and warmer than City Island                                                              |
| Puffs                    | `fur` palette (D12)                                                                                                                         |

### 6.5 Geometry budgets (to enforce in `tests/hole/animal-items.test.ts`)

bugs 120 · critters 300 · animals 500 (700 for elephant / giraffe / rhino / hippo / lab-stage-1) · giants 1 600 · flora
300 · rocks 150 · hills 300 (incl. baked decoration) · zoo 500 · farm 600 · lab 900 (lab_hq / growth_reactor 1 400) ·
staff 80 · labveh 600. The balls and eggs (D14) cost more than boxes, so the animal budgets are higher than City Island's
props; to keep the frame cheap, the renderer hides tiny types (size < 1 m) in map cells far from the camera (AI-13).

## 7. Open tasks

Conventions for every task: follow the DETAILS.md rules (determinism through `src/shared/rng.ts`; DOM-free `sim/` and
`map/`; never clone geometry or materials per instance; vertex colours + `paint` / `glow`; no clipping). Definition of
done = `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run test` green; the relevant viewer checked with a
screenshot (the preview pane is slow and throttles `requestAnimationFrame`: drive the game with `__hole.advance(seconds)`,
open it with `mute=1`); docs updated in the same change. Changing animal item sizes, the point total or map content
needs a bump of `MAP_SCORING_VERSIONS.animal`.

**What is done** (all documented in the DETAILS.md): AI-00 decisions, AI-10 .. AI-14 (dynamic spatial hash, mover
behaviours, awake set, flee, leash-free mover culling, map data for movers), AI-20 / AI-21 / AI-22 (registry, fur puffs,
group sounds), AI-29 / AI-30 .. AI-39 (round primitive, every builder: animals, bugs, giants, hills, flora, zoo, lab, the
round City greenery), AI-40 .. AI-46 (coast, biomes, rivers, compound, hills, zone rules, fill plan, walk grid), AI-50 /
AI-51 / AI-52 (ground, rivers and ponds, mood), AI-60 (item viewer, map viewer and balance page know the map), AI-61
(pace bands, `animal-map` tests).

### Product and polish

- [ ] **"ISLAND CLEARED!" banner colour** for this map; the menu card and the README shots are done.
- [ ] **AI-01 Real-device pass**: since the item batching the map draws in 23-26 calls with 24k / 108k / 321k
      triangles at level 1 / 8 / 15 (dev PC, shadows on; was 165 / 578 / 1 739 calls). Measure `__hole.benchmark(240)`
      on an iPad and a phone (high / low). If too slow, in this order: raise `TINY_K` / `SHADOW_TINY_K` in
      `render/item-instances.ts`, cheaper animal rigs (`roundDetail` in `items/kit.ts`).
- [ ] **Bot leads moving targets** (`sim/bot.ts`): the greedy bot aims at where an animal is, so fleeing animals cost it a
      lot (Hard 100 s: level 5 with 1.7 x flee speed, level 10+ with the shipped knobs). Leading would make the bot a
      fairer stand-in for a player.
- [ ] **Item art pass** in `item-viewer.html?map=animal&mode=lineup&gamecam=1`: the rigs are first versions (giraffe
      legs, the long-necked birds, the lab vats, the aviary / biodome domes are opaque), give each family a look.

### Mechanics left out of v1

- [ ] **AI-15 Leg-swing shader**: a vertex-shader leg swing (per-vertex limb mask from the Mesher + a per-instance phase)
      so walkers move their legs; today animals only bob / hop as a whole.
- [ ] **Herd followers**: calves, lambs and ducklings should follow their parent (today a herd shares a home and leash
      only); ducks swim in the rivers, ducklings do not trail them.
- [ ] **Map viewer overlays**: biome colours, leash circles and mover paths in `map-viewer.html?map=animal`.
- [ ] **Ground polish**: flowing ripples along the rivers and foam at the mouths, coast rocks and a jetty at the
      compound, a visible loop road, helipad marking (the compound is flat rects + biome colours today).
- [ ] **AI-63 (P2) Escapes**: eating every `cage_bars` piece of the paddock widens the leash of the giants inside.
- [ ] **AI-64 (P2) Giant feel**: footstep thumps, a small camera shake and dust puffs when a giant walks near the hole;
      a roar when one is eaten. Feathers for the bird puffs.

## 8. Risks and things to watch

- **Moving targets on touch.** Fleeing animals can feel unfair with a finger. Keep flee behind a flag, cap the speed
  (D7) and test on a device before tuning anything else.
- **Pace.** Movement and fleeing slow the bot down; leashes keep animals from running into empty ground. Re-run the
  bands after every behaviour change.
- **Triangles.** Draw calls no longer grow with types x cells (items are batched), but triangles still do: measure with
  `__hole.game.renderer.info.render` after every asset phase.
- **Determinism.** Everything that moves must be stepped in the sim at the fixed rate; never animate gameplay positions
  in the renderer. The bot runs at 30 steps/s, the game at 60 Hz: behaviours must be dt-stable.
- **Thin tiers.** Tiers 18, 19, 25 and level 9 have only 3 types (2 at P0); the first cut there breaks the coverage
  tests.
- **Trademarks.** Generic names only (giant ape, growth lab); no film-style logos on the lab or the fences.
