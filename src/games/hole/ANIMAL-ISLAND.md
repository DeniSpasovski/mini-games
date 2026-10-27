# Hole Island - Animal Island map (design, roster, open tasks)

Third map for Hole Island: an island full of animals. You start as a hole the size of a dinner plate and swallow ants,
ladybugs and snails, then rabbits, foxes and sheep, then zebras, crocodiles and elephants. You end on the **extremely
giant** animals that a secret laboratory has bred: a 16 m rabbit, a 30 m crocodile in the river, a 34 m elephant. The
island has small hills you can eat and rivers you cross. In a hidden corner, behind the jungle, the **secret zoo and the
laboratory** where the giants are made.

> **Status: built and playable** (menu map picker, `?map=animal`). The moving-items engine, the 192-type catalog with
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

Settled with the user; change any of them by saying so.

| #   | Question                                | Decision                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Map id / name                           | `animal` / "Animal Island", noun "island", menu blurb "Ants first, giant elephants last. Find the secret zoo."                                                                                                                                                                                                                                |
| D2  | Point total                             | **21 000**: fewer items than City Island (30 000) keeps the moving instances down; more than 2 x `cumulativeXp(15)` = 17 110, so Easy can clear it, and more than the 20 155 XP to level 25, so level 25 is the reward for a near-clear                                                                                                       |
| D3  | Island shape                            | round island like City Island (coast table + headlands / inlets), radius **210 m**: the smallest island that keeps the difficulty bands (density = pace, tuned with the bot). Seeded like City Island                                                                                                                                         |
| D4  | Scale of the bugs                       | **User: yes.** Bugs are drawn **~10x life size** (ant 15 cm, beetle 30 cm) so they read at the level 1 camera (10 m), the same trick as the toy store's 5x. Lore: "the lab's growth serum leaked into the soil"                                                                                                                               |
| D5  | How many giants                         | **37 instances of 16 giant types** (tiers 20-25, ~1 065 points = ~5 % of the map, like the toy store's 5 % for tiers 20-25). 14 in the zoo paddock, 23 roaming their biome. Section 5.6                                                                                                                                                       |
| D6  | Animal orientation                      | animals face **+X** (like vehicles), so heading = yaw. Pivot at the ground centre                                                                                                                                                                                                                                                             |
| D7  | Do edible animals flee from the hole?   | **Yes, gently - but bugs and giants never flee** (so the first minute is easy). Only when the hole can eat them, never faster than the speed cap, for a short time (`FLEE` in `sim/movers.ts`). Too-big animals stop and teeter when the hole is under them. Bot pace is measured with fleeing on                                             |
| D8  | Can things stand ON hills?              | **User: no.** Hills are just other static items. Their decoration (trees, rocks, flowers, a burrow) is part of the hill mesh, nothing stands on them, animals walk around them. No cargo / parent-child items                                                                                                                                 |
| D9  | Leg animation                           | whole-body motion in the instance matrix (bob, hop arc, lift). Later: a vertex-shader leg swing (AI-15). No skinned meshes                                                                                                                                                                                                                    |
| D10 | Do far-away animals move?               | **Only "awake" animals move**: within an awake radius of the hole that grows with the camera distance, and big enough to be seen from there (DETAILS.md "Moving items"). Asleep animals stand still (they look like they are grazing). Deterministic: depends only on the hole, never on the camera                                           |
| D11 | Is movement in the sim (deterministic)? | **Yes.** Mover state lives in `sim/` (DOM-free, seeded per item), stepped at the fixed sim rate, so the bot, the balance page and the tests see the same animals as the player                                                                                                                                                                |
| D12 | Swallow puffs                           | new `MapDef.puffs: 'fur'` palette (brown / white / grey tufts + a few leaves); feathers for birds is P2                                                                                                                                                                                                                                       |
| D13 | Difficulty times                        | the shared 480 / 240 / 120 s. Revisit only if real play shows the island is much slower than City Island (moving targets)                                                                                                                                                                                                                     |
| D14 | Shapes                                  | **User: use balls and egg shapes** to make the animals less blocky. New low-poly `ball()` / egg / dome primitive in the Mesher, flat shaded (faceted, so it still matches the blocky art); bodies, heads, eyes, shells, wool, some tree crowns, boulders and the hills use it, legs / horns / buildings stay boxes (DETAILS.md "Round parts") |

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

## 4. Moving animals

How movers work (behaviours, walk grid, awake set, flee, speed cap, rendering) is in [`DETAILS.md`](DETAILS.md) ("Moving
items"). The map's rules on top of it:

- **Budget**: about 2 500 movers per map (ants are the bulk), only a few hundred awake; `tests/hole/movers.test.ts` times
  a 2 500-mover tick in node as a guard. The CPU cost is small; triangles are the real cost, hence tight rigs.
- **Leashes** keep every mover near its home (bugs a few metres, herds tens, giants the most), so culling cells stay valid
  and animals never run into empty ground.
- **Who moves how** is the `Moves` column of the roster (section 6.2): herds share a home and leash, ants `trail` from
  anthills, staff and lab vehicles `patrol` the compound, giants `roam`, swimmers stay on water cells.
- A too-big animal with the hole under it stops and teeters; a mover that commits to falling freezes and falls.

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
- Render: river ribbons with mud banks and pond discs as stencil-cut ground (`render/animal-ground.ts`); flowing ripples
  and foam at the mouths are an open task.
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

A fenced compound on the sector between jungle and savanna, built from a hand-made layout (`buildCompound` in
`map/animal/generate.ts`, positions scaled by `COMP_K`, item sizes not), mirrored so the giant paddock is on the far side
and the electric lab fence faces the island:

- **Perimeter**: `lab_fence` panels (glowing top wire), `watchtower`s, `camera_pole`s, `warning_sign`s, a jungle belt.
- **Secret zoo**: pens from `zoo_fence` rows for the lab-stage-1 animals (`rabbit_big`, `frog_big`, `tortoise_big`,
  `gorilla_big`, `panda_big`, `elephant_big`, `tiger_big`), sheds, an `aviary`, a hippo pool, and the **paddock** behind
  `cage_bars` (9 m bars) with 14 giants, `feeding_station`s and `giant_carrot`s.
- **Laboratory**: `lab_hq` (T25, 1 copy), `lab_wing`, `lab_block`, `lab_hangar`, `lab_dome`, `biodome`, `lab_tower`,
  `growth_reactor`, rows of `growth_vat`s and `growth_chamber`s (glowing tanks with an animal inside), `serum_barrel`s,
  `lab_crate`s, `container`s and the `helicopter`.
- **Life**: `scientist`s and `zookeeper`s patrol, `research_jeep`s and the `transport_truck` drive a loop.
- Zoo giants are leashed to the paddock. P2 (AI-63): eating every `cage_bars` piece lets them escape.

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

21 000 points, about 4 900 items, about half of them movers. Pace targets are the same as the other maps (good bot: Hard
120 s level >= 10, Medium reaches level 15, Easy clears the island), measured **with movement and fleeing on**;
`tests/hole/animal-map.test.ts` keeps the bands. What sets the pace (the XP curve is not touched): the island radius, the
per-tier share of the points (`TIER_FRACTION`), hotspots (`HOT_SHARE`), the 50-hill cap and the flee knobs (`FLEE`). The
bot leads moving targets (`Bot.intercept`).

**Reachability.** The hole centre stops 0.5 D inside the coast, so `tryPut` keeps items `3 + 0.15 x size` m from the
shore and walkers keep off the shoreline strip of the walk grid; otherwise items near the coast could not be eaten.

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

`items/catalog-animal.ts` is the source; tier, points and level are derived from the size (animals: w = length along
+X). Several items sit right under a tier edge (1.2, 1.4, 8.8 m): builders must not grow past it. Priority: **P0** = the
core set (104 types, every tier 1-25 and level 1-15 has >= 2 P0 types) · **P1** (83) · **P2** = polish (5). Moves =
behaviour (DETAILS.md "Moving items"). Zone = where the generator places it. `paint` = tinted per instance.

Coverage (all 192): tier 1 has 58 types, the thinnest tiers are 18 and 19 (3 types) and 25 (3); level 9 has 3 types,
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

**Round shapes (D14)** use the Mesher's `ball()` (DETAILS.md "Round parts"), with detail by size so small things stay
cheap:

| Shape                 | Used for                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| egg                   | bodies (most animals, birds, insect abdomens), heads, beaks / snouts on small animals, ears (flattened), the eggs in the nest   |
| ball                  | eyes, noses, paws / hooves of small animals, tail puffs (rabbit, sheep), wool (a cluster of 5-9 balls), insect heads and thorax |
| dome                  | tortoise / snail / ladybug / beetle shells, mushroom caps, hills, anthills / molehills, lab domes, biodome, growth vat tops     |
| jittered ball         | boulders, rocks, pebbles, bush and some tree crowns (oak, acacia flattened, jungle tree)                                        |
| box / cylinder (stay) | legs, horns, antlers, tails of big animals, necks (giraffe: a tapered box), every building, fence, vehicle and crate            |

### 6.4 Non-edible assets (render-only, derived from the map data)

`render/animal-ground.ts`: a base fan coloured per coast segment, 10 m biome cells (two greens per biome), the sand ring,
the compound's flat rects, river ribbons with mud banks (one mitered ribbon per river) and ponds, the sea. Mood: a warmer
tropical sky (`skyTop`). Puffs: the `fur` palette (D12). A jetty, coast rocks, a waterfall and a visible loop road are open
tasks.

### 6.5 Geometry budgets

Per group in `tests/hole/animal-items.test.ts`. Balls and eggs cost more than boxes, so the animal budgets are higher than
City Island's props; the renderer's level of detail (`TINY_K`) hides tiny items far from the camera.

## 7. Open tasks

Workflow and definition of done: the `hole-content` skill. Changing animal item sizes, the point total or map content
bumps `MAP_SCORING_VERSIONS.animal`.

### Product and polish

- [ ] **AI-01 Real-device pass**: measure `__hole.benchmark(240)` on an iPad and a phone (high / low). If too slow, in this order: raise `TINY_K` / `SHADOW_TINY_K` in
      `render/item-instances.ts`, cheaper animal rigs (`roundDetail` in `items/kit.ts`).
- [ ] **Item art pass** in `item-viewer.html?map=animal&mode=lineup&gamecam=1`: giraffe, the long-necked birds, the
      aviary (open rib dome), the biodome / lab dome / greenhouse (glass, see `DETAILS.md` "Glass") and hooves (deer, horse,
      moose, zebra, antelope, giraffe: `hoof: true`) are done. Left: give each remaining family a look.

### Mechanics left out of v1

- [ ] **AI-15 Leg-swing shader**: a vertex-shader leg swing (per-vertex limb mask from the Mesher + a per-instance phase)
      so walkers move their legs; today animals only bob / hop as a whole.
- [ ] **Herd followers**: calves, lambs and ducklings should follow their parent (today a herd shares a home and leash
      only); ducks swim in the rivers, ducklings do not trail them.
- [ ] **Ground polish**: flowing ripples along the rivers and foam at the mouths, coast rocks and a jetty at the
      compound, a visible loop road, helipad marking (the compound is flat rects + biome colours today).
- [ ] **AI-63 (P2) Escapes**: eating every `cage_bars` piece of the paddock widens the leash of the giants inside.
- [ ] **AI-64 (P2) Giant feel** (eat roar, thump and camera shake done: `Sfx.roar`, `CameraRig.shake`): footstep thumps,
      shake and dust puffs when a giant walks near the hole. Feathers for the bird puffs.

## 8. Risks and things to watch

- **Moving targets on touch.** Fleeing animals can feel unfair with a finger. Keep the speed cap (D7) and test on a
  device before tuning anything else.
- **Pace.** Movement and fleeing slow the bot down; leashes keep animals from running into empty ground. Re-run the
  bands after every behaviour change.
- **Triangles.** Draw calls no longer grow with types x cells (items are batched), but triangles still do: measure with
  `__hole.game.renderer.info.render` after every asset phase.
- **Determinism.** Everything that moves must be stepped in the sim at the fixed rate; never animate gameplay positions
  in the renderer. The bot runs at 30 steps/s, the game at 60 Hz: behaviours must be dt-stable.
- **Thin tiers.** Tiers 18, 19, 25 and level 9 have only 3 types (2 at P0); the first cut there breaks the coverage
  tests.
- **Trademarks.** Generic names only (giant ape, growth lab); no film-style logos on the lab or the fences.
