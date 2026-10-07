# Hole Island - Construction Site map (design, roster, open tasks)

Fourth map for Hole Island: a whole city that is one giant construction site. You start as a hole the size of a hard
hat and eat bricks, cones, cement bags and workers' toolboxes, then wheelbarrows and cement mixers, then mini diggers,
skips and containers, then excavators, dump trucks and half-built houses, and you finish on **mining haul trucks, a
bucket-wheel excavator, tower cranes and the skyscrapers they are building**.

> **Status: built as a test map** (`?map=construction`, dev server and `npm run build:test` only, see `release.ts`).
> How the built parts work is in [`DETAILS.md`](DETAILS.md) ("Map: Construction Site"); this file keeps the design,
> the roster and the open tasks. The game rules (size ladder, eat rule, scoring) are not changed by this map.
> Workflow: [`.claude/skills/hole-content/SKILL.md`](../../../.claude/skills/hole-content/SKILL.md).

Original art only, generic names: no machine brands or model names (say "haul truck", "tower crane", never a maker),
no company logos on hoardings or cabins.

## 1. Pitch and pillars

1. **Build-site ladder.** Every size step is something you would see on a real site: materials and hand tools (L1-2),
   small plant and site furniture (L3-5), trucks, diggers and houses going up (L6-9), and the heavy end (L10-15):
   cranes, mining machines, high-rises.
2. **Machines as ladders.** Like the plush sizes in the toy store and the giants on Animal Island, the same kind of
   machine comes back bigger: mini dumper (L3) -> site dumper (L4) -> dump truck (L7) -> articulated hauler (L8) -> haul
   truck (L10) -> titan haul truck (L13); mini excavator (L3) -> excavator (L8) -> big excavator (L8) -> mining shovel
   (L12) -> dragline (L14) -> bucket-wheel excavator (L15); self-erecting crane (L9) -> tower cranes (L12-15).
3. **The goal is always visible.** Tower cranes and high-rise shells stand 40-96 m tall in the north half: you see them
   from the start gate and teeter under them until the end.
4. **A living site.** Workers wander and run from a hole that can eat them; trucks drive the haul-road grid like the
   City Island cars; haul trucks shuttle between the shovel and the crusher in the mine.
5. **Pace and score stay comparable.** 21 000 points per seed, the shared three difficulties, own top 10 and own
   scoring version.

## 2. Decisions (defaults picked; change any of them by saying so)

| #   | Question         | Default                                                                                                                                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Id / name        | `construction` / "Construction Site", noun "site" (HUD: "SITE CLEARED!"), blurb "Bricks first, mining trucks and tower cranes last."                                                       |
| D2  | Shape            | a **fenced rectangle** (`MapData.bounds`, like the toy store) under an open sky: 540 x 420 m, hoarding on all four sides, low on the camera side with the site gate                        |
| D3  | Release          | **test map**: a hole `release.ts` (same idea as rally) lists it in `TEST_MAPS`, so it shows on the dev server and in `npm run build:test`, not in the release build, until you say ship it |
| D4  | Point total      | **21 000** (more than 2 x `cumulativeXp(15)` = 17 110 so Easy can clear it, lowered from 24 000 to ease the pace); tuned by the bot through floor size and clustering, not the XP curve    |
| D5  | Scale            | real 1:1 scale (a brick is 24 cm, a haul truck 15.6 m); **one fantasy piece**: the 25 m "titan" haul truck, a prototype twice the real size, the boss of the mine                          |
| D6  | Seeded           | yes: the menu seed stepper ("Site #7"), every seed holds exactly 21 000 points                                                                                                             |
| D7  | Movers           | workers `wander` (flee when eatable); road trucks `drive` the haul-road grid; mine haul trucks `patrol` cleared haul lanes. Cranes, plant and buildings are static                         |
| D8  | Item build style | box-built like City Island, recipes in **fractions** of the catalog size (`kit-toy.ts` `F()`), run with `Mesher.decoplanar` so coplanar box faces never z-fight                            |
| D9  | Swallow puffs    | new `rubble` palette (concrete grey, brick red, sand, hi-vis yellow)                                                                                                                       |
| D10 | Sounds           | materials / tools clack, plant / trucks / cranes / mining clank, heaps thud (`Sfx.gulp(tier, group)`)                                                                                      |

## 3. Site layout (`map/construction/layout.ts`)

World axes as everywhere: +X east, +Z south, the camera looks north. Floor x in [-270, 270], z in [-210, 210].

- **Haul roads** (12 m gravel, the only ground vehicles drive on): north-south at x = -180, -90, 0, 90, 180, east-west
  at z = -126, -42, 42, 126. The mine has no roads inside it. The x = 0 road runs from the **site gate** (south fence)
  to the north fence. Road crossings and arms form the `RoadNet` the trucks drive.
- **Plots** between the roads (6 columns x 5 rows, ~78-84 m), grouped into **9 districts**:

| District          | Plots (row r0 = north, column c0 = west) | Ground                  | Content                                                                                                                                                |
| ----------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Site Gate (start) | r4 c2-c3                                 | gravel                  | cabins, office cabins, portaloos, workers, cones, hard hats, toolboxes, signs; the start                                                               |
| Brickyard         | r4 c0-c1, r3 c0                          | red dust                | brick and block pallets, cement mixers, wheelbarrows, kerb stacks, bags, skips                                                                         |
| Road Works        | r4 c4-c5, r3 c5                          | fresh asphalt + gravel  | pavers, rollers, graders, barriers, temp lights, road plates, jersey barriers                                                                          |
| Housing Estate    | r3 c1-c2                                 | lawn + dirt plots       | house frames and shells, foundation slabs, scaffold towers, mini diggers, telehandlers, skips                                                          |
| Material Yard     | r3 c3-c4                                 | concrete                | pipe and lumber stacks, steel beams, containers, cable drums, forklifts, fuel tanks                                                                    |
| Foundations       | r2 c0-c2                                 | dark earth, pits        | foundation pits, rebar cages, formwork, piling rigs, pump and mixer trucks, trench boxes                                                               |
| Plant Depot       | r2 c3-c5                                 | concrete, parking lines | excavators, bulldozers, loaders, backhoes, graders, dump trucks parked in rows; a lowboy                                                               |
| High-Rise Row     | r0-r1 c0-c2                              | concrete                | apartment / office frames, high-rise shells, the skyscraper core and the tower topping, tower cranes, crawler and mobile cranes, batching plant, silos |
| Open-Pit Mine     | r0-r1 c3-c5 (one open area)              | orange earth, terraces  | haul trucks, mining shovel, dragline, bucket-wheel excavator, drill rigs, crusher, conveyors, spoil heaps, giant tyres                                 |

- **Start**: in the Site Gate west plot, ~30 m inside the gate, ringed by ~40 tier 1-3 items. Runs start at a random
  busy spot (`pickStart`, as on the other maps).
- **Hole bounds**: `bounds.inset` 0.15 like the toy store, so the hole may bulge over the hoarding and corner items stay
  reachable (test: every item reachable by a hole of its level).

## 4. Generator (`map/construction/generate.ts`, DOM-free, deterministic)

Order: plots and roads -> ground rects -> **showpieces** (fixed per district: high-rises with a tower crane each, the
skyscraper core and tower topping with the giant tower crane, the mine pit with the bucket-wheel excavator, dragline,
mining shovel, crusher and conveyor, haul lanes kept clear) -> **per-tier point budget** (`TIER_FRACTION`, like Animal
Island) shared by the types of each tier by weight -> placement of every copy in a district of the item's homes, small
items (tier <= 12) gathered around **work spots** (pallet piles, spills, crews) with empty ground between -> road
trucks (`drive`) on road arms -> workers get `wander` -> `ensureAllTypes` -> start scatter -> `balancePoints` (trim
small items away from the start, top up with 1-point bricks / blocks / bags until exactly 21 000).

Rules that must hold (tested): exact points per seed; every tier 1-25 and level 1-15 has >= 2 types placed; every type
up to tier 20 placed; only `drive` vehicles stand on a road; items inside the fence and reachable; busy start;
deterministic per seed.

## 5. Size ladder in site terms

| Hole level | Eats up to | Construction Site feel                                                                                      |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| 1          | 0.9 m      | bricks, blocks, hard hats, buckets, cones, toolboxes, bags, jerrycans, workers, drums, signs, tiny heaps    |
| 2          | 1.43 m     | shovels, rebar bundles, compactors, barricades, cement mixers, generators, pallets, portaloos, wheelbarrows |
| 3          | 2.64 m     | cable drums, mini dumpers, scaffold towers, light towers, jersey barriers, rebar cages, mini excavators     |
| 4          | 3.59 m     | forklifts, 10 ft containers, compact rollers, site dumpers, skips, fence panels                             |
| 5          | 4.88 m     | giant mining tyres, bowsers, steel beams, tandem rollers, cement silos, trench boxes                        |
| 6          | 6.64 m     | pickups, vans, telehandlers, 20 ft containers, site cabins, backhoes, bulldozers, pavers                    |
| 7          | 9.03 m     | wheel loaders, office cabins, foundation slabs, dump trucks, graders, piling rigs, house frames             |
| 8          | 12.3 m     | excavators, mixer trucks, drill rigs, house shells, haulers, pump trucks, big excavators, foundation pits   |
| 9          | 14.3 m     | truck cranes, mining dozers, self-erecting cranes, apartment frames                                         |
| 10         | 16.7 m     | **haul truck** (the mining truck), lowboy, rock crusher, apartment shell                                    |
| 11         | 19.5 m     | mobile crane with its boom up, batching plant, office frame                                                 |
| 12         | 22.7 m     | mining shovel, small tower crane, conveyor, high-rise shell                                                 |
| 13         | 26.5 m     | **titan haul truck**, crawler crane, tower crane, tall high-rise                                            |
| 14         | 30.9 m     | dragline, big tower crane, skyscraper core, spoil heap                                                      |
| 15         | 36 m       | **bucket-wheel excavator**, **giant tower crane**, tower topping, spoil mountain                            |

## 6. Roster (117 types, `items/catalog-construction.ts`)

Groups (new `ItemGroup`s) and triangle budgets (`tests/hole/construction-items.test.ts`): `material` 300, `tools` 300,
`crew` 140, `site` 600, `heaps` 300, `plant` 900, `trucks` 900, `structures` 1600, `cranes` 1200, `mining` 1600.
Size = max(w, d, h x 0.25); tier, level and points are derived. Vehicles run along X, workers and signs face +Z.

| T   | Id (w x d x h m)                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `brick` .24x.12x.08 · `concrete_block` .4x.2x.2 · `hard_hat` .3x.24x.16 · `paint_bucket` .3x.3x.36 · `road_cone` .4x.4x.72 · `toolbox` .5x.24x.26 · `cement_bag` .6x.4x.14 · `jerrycan` .36x.18x.46 · `worker` .5x.32x1.76 · `sledgehammer` .86x.22x.1 · `oil_drum` .6x.6x.88 · `hazard_sign` .62x.4x1.1 · `sandbag` .62x.36x.16 · `temp_light` .6x.6x3.2 · `heap_xs` .85 |
| 2   | `shovel` 1x.24x.1 · `rebar_bundle` 1.02x.3x.16 · `kerb_stack` .98x.62x.5 · `plate_compactor` .96x.52x1 · `barricade` 1.04x.5x1                                                                                                                                                                                                                                            |
| 3   | `cement_mixer` 1.2x.8x1.3 · `generator` 1.16x.7x.78 · `water_barrier` 1.2x.48x.82 · `ibc_tank` 1.2x1x1.16 · `brick_pallet` 1.18x1x.96 · `portaloo` 1.2x1.2x2.3                                                                                                                                                                                                            |
| 4   | `wheelbarrow` 1.4x.64x.66 · `block_pallet` 1.3x1.1x1 · `gas_cage` 1.3x.8x1.6 · `tarp_pallet` 1.36x1.1x1.1                                                                                                                                                                                                                                                                 |
| 5   | `cable_drum` 1.6x1x1.6 · `mini_dumper` 1.6x.9x1.3 · `scaffold_tower` 1.55x1.55x4.2 · `manhole_rings` 1.5x1.5x1.3                                                                                                                                                                                                                                                          |
| 6   | `walk_roller` 1.85x.85x1.15 · `excavator_bucket` 1.8x1.2x1.1 · `light_tower` 1.9x1.3x6.2 · `lumber_bundle` 1.9x1x.8 · `formwork_stack` 1.9x1.1x1                                                                                                                                                                                                                          |
| 7   | `jersey_barrier` 2.2x.6x.82 · `rebar_cage` 2.2x.8x.8 · `compressor` 2.1x1.3x1.3 · `heap_s` 2.1                                                                                                                                                                                                                                                                            |
| 8   | `mini_excavator` 2.6x1.2x2.4 · `skid_steer` 2.6x1.6x2 · `concrete_pipes` 2.5x2.2x1.2 · `scissor_lift` 2.5x1.2x2.3 · `pipe_stack` 2.6x1.6x1                                                                                                                                                                                                                                |
| 9   | `site_forklift` 3x1.3x2.2 · `road_plate` 3x1.6x.08 · `container_10` 3x2.44x2.6 · `compact_roller` 3x1.4x2.4                                                                                                                                                                                                                                                               |
| 10  | `site_dumper` 3.5x1.9x2.7 · `skip_bin` 3.4x1.8x1.4 · `fence_panel` 3.5x.7x2 · `sign_board` 3.3x.6x2.8                                                                                                                                                                                                                                                                     |
| 11  | `mining_tyre` 4x1.6x4 · `water_bowser` 4x1.8x2.2 · `steel_beams` 4.1x1.4x.9 · `heap_m` 3.9                                                                                                                                                                                                                                                                                |
| 12  | `tandem_roller` 4.6x1.8x3 · `cement_silo` 3.6x3.6x18 · `trench_box` 4.4x2.4x2.4 · `fuel_tank` 4.4x2x2.2                                                                                                                                                                                                                                                                   |
| 13  | `site_pickup` 5.3x2x1.9 · `site_van` 5x2x2.3 · `telehandler` 5.4x2.3x2.5 · `lumber_stack` 5.2x1.4x1.4                                                                                                                                                                                                                                                                     |
| 14  | `container_20` 6.06x2.44x2.6 · `site_cabin` 6x2.5x2.7 · `backhoe` 6.4x2.3x3.8 · `bulldozer` 6.2x3.4x3.4 · `asphalt_paver` 6.4x3.1x3.6                                                                                                                                                                                                                                     |
| 15  | `wheel_loader` 7.6x2.8x3.5 · `office_cabins` 7x3x5.8 · `foundation_slab` 7.4x7.4x.9 · `heap_l` 7.4                                                                                                                                                                                                                                                                        |
| 16  | `dump_truck` 8.6x2.6x3.4 · `motor_grader` 8.9x2.5x3.4 · `piling_rig` 8x4.2x30 · `house_frame` 8.8x7.4x6.5                                                                                                                                                                                                                                                                 |
| 17  | `excavator` 9.8x3.2x4.6 · `mixer_truck` 9.6x2.6x3.5 · `drill_rig` 9.4x3x9 · `house_shell` 10x8x7                                                                                                                                                                                                                                                                          |
| 18  | `articulated_hauler` 11x3.4x3.8 · `pump_truck` 12x2.6x4 · `big_excavator` 12x3.8x5.6 · `foundation_pit` 12x9x1.2 · `heap_xl` 11.5                                                                                                                                                                                                                                         |
| 19  | `truck_crane` 13.5x2.8x4 · `mining_dozer` 12.8x6x4.8 · `self_erecting_crane` 14x4x22 · `apartment_frame` 14x12x14                                                                                                                                                                                                                                                         |
| 20  | `haul_truck` 15.6x9.8x7.6 · `lowboy` 16.4x3x4.5 · `rock_crusher` 16x6x9 · `apartment_shell` 16x12x20                                                                                                                                                                                                                                                                      |
| 21  | `mobile_crane` 18x3x30 · `batching_plant` 18x10x20 · `office_frame` 18x18x24                                                                                                                                                                                                                                                                                              |
| 22  | `mining_shovel` 21x10x16 · `tower_crane_s` 21x4x38 · `conveyor` 22x3x9 · `highrise_shell` 20x20x44                                                                                                                                                                                                                                                                        |
| 23  | `titan_truck` 25x15x12 · `crawler_crane` 26x8x40 · `tower_crane` 26x5x48 · `highrise_tall` 24x24x60                                                                                                                                                                                                                                                                       |
| 24  | `dragline` 30x14x20 · `tower_crane_l` 30x6x56 · `skyscraper_core` 28x28x80 · `heap_xxl` 28                                                                                                                                                                                                                                                                                |
| 25  | `bucket_wheel` 35x14x22 · `giant_tower_crane` 34x6x64 · `tower_topping` 32x32x96 · `spoil_mountain` 34                                                                                                                                                                                                                                                                    |

Every tier has 3+ types (tier 21 is the thinnest with 3). Heaps (`heap_*`, `spoil_mountain`) come in three variants
(dirt, sand, gravel) and are the edible landscape and the filler of every size band, like the hills on Animal Island.

## 7. Rendering (render-only, derived from the map data)

- `render/construction-ground.ts`: dirt base with a 10 m checker, the district ground per plot, gravel haul roads with
  darker tyre tracks, the mine pit as stepped terrace bands, dark foundation pits, a skirt and the ground outside;
  everything uses the stencil-cut ground material.
- **Hoarding** (non-edible, item material so the building fade dithers it): plywood panels in alternating site colours
  with a white cap, tall on three sides, low on the camera side, gate posts and a header at x = 0.
- Mood: hazy warm sky (`skyTop` dome), sandy hemisphere ground colour, warm sun.

## 8. Open tasks

- [ ] Pace: with 21 000 points the good bot reaches level 10-13 on Hard (band 10-22), level 25 on Medium and clears Easy in ~230 s; retune `TIER_FRACTION` if feel on a device differs.
- [ ] Real-device check (draw calls and triangles at levels 1 / 8 / 15; the cranes and high-rises are the heaviest items).
- [ ] Ship decision: move `construction` from `TEST_MAPS` to `AVAILABLE_MAPS` (`release.ts`).
- [ ] Ideas for later: crane hooks that swing, a conveyor that moves rocks, night shift with site lights, blasting in the
      mine as a timed event.

## 9. Risks

- **Thin, tall items** (tower cranes, piling rigs) are mostly empty space: their occupancy circle is big. Keep them on
  showpiece spots so they do not block the random fill.
- **Haul trucks on 12 m roads** would hang over the verge: only road trucks up to the lowboy drive the grid; the mine
  trucks patrol cleared lanes inside the mine.
- **Clip test on rotated parts** (booms, jibs, conveyor belts): `decoplanar` only fixes axis-aligned boxes; keep rotated
  parts off each other's planes by hand.
