# Hole Island - Toy Store map (design, roster, open tasks)

Second map for Hole Island: a giant toy store. You start as a hole the size of a brick bin, swallow loose bricks and
mini figures, then plushies, dolls, RC cars and inflatable rafts, then ride-on cars and big robots, and end on a Ferris
wheel, a brick castle and a store-sized teddy bear.

> **Status: built and playable** (menu map picker, `?map=toy`). The engine is multi-map, all 210 item types have builders
> and pass the size / paint / budget / clip tests, every seed generates an exact 13 000-point store, the bot paces
> them. How it works now is documented in [`DETAILS.md`](DETAILS.md) ("Map: Toy Emporium"); this file keeps the design, the
> asset roster (section 4) and the **open** tasks (section 6). The rules of the game (size ladder, eat rule, scoring) are
> in the DETAILS.md and are not changed by this map.

Status marks: `[ ]` todo · `[~]` in progress · `[x]` done (done items are deleted from section 6 after the DETAILS.md covers
them).

> Working title: **Toy Emporium**. Use generic names and original art only. Do **not** use trademarks in ids, names or
> UI (no Lego, Barbie, Transformers, Hot Wheels, Build-A-Bear, the Toys R Us giraffe...). Say "brick", "fashion doll",
> "robo-truck", "mascot".

## 1. Pitch and pillars

1. **Same ladder, new feeling.** Every toy department contains its own mini-ladder (bricks -> brick car -> brick tower;
   panda XS -> panda XXL), so wherever the player is, there is something to eat and something "too big yet" to teeter at.
2. **The plush family is the hero.** The same animal shows up again at 6 sizes (panda, brown bear, gray rabbit), so the
   player eats the small panda, later the big panda, later the giant panda: growth you can see.
3. **Small first, huge last.** Levels 1-3 are bricks, mini figures, keychains and balls (tiers 1-4). Plush, dolls and
   RC cars carry the middle (tiers 5-12). Rafts, ride-on cars, robots and carousels are the late game (tiers 10-19).
   The last levels are atrium landmarks (tiers 20-25).
4. **Open-roof dollhouse.** The camera looks down into an open store (no ceiling). Colour-coded floor zones tell the
   departments apart at a glance, and each zone has one signature prop that is readable from far away.
5. **Pace and score stay comparable.** 13 000 points total (City Island has 30 000), the same three difficulties, the same
   top 10 per difficulty - kept in a separate list per map.

## 2. Decisions to settle first (recommended defaults)

The agent that picks up the first task should confirm these with the user, or take the default and write the answer
here.

| #   | Question                | Recommended default                                                                                                                                                                                                                                                                                               |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scale of the world      | **Toy scale ~5x**: a brick is 16 cm, a "small" panda 1.1 m, a ride-on car 3.2 m, a robot 14 m. Hole sizes and camera stay exactly as in City Island. A brick (0.16 m) reads like the soda can (0.12 m).                                                                                                           |
| D2  | "rafts" in the brief    | Read as **inflatable pool rafts and floats** (raft, family raft, swan, flamingo, unicorn, whale). If the user meant shelf **racks**, those exist too (`shelf_run`, `aisle_shelf_double`).                                                                                                                         |
| D3  | Items on shelves        | **Baked into the shelf mesh.** The sim is 2D (every item stands on the floor), so a gondola shelf is one edible item with its stock painted on. No parent / child items in v1 (carrying items with a table would be a sim change).                                                                                |
| D4  | Boundary                | **Rectangle** (store floor), not an island. Add a `Bounds` abstraction (TS-01). No interior solid walls: everything inside the hall is edible or flat floor decoration, because the hole is never blocked.                                                                                                        |
| D5  | Floor size              | **Decided: 180 x 120 m** (the floor plan is drawn at 240 x 160 m and built x0.75, `FLOOR_SCALE` in `map/toy/layouts.ts`). At 240 x 160 m the bot reached level 15 in 5 s per level (5x City Island's density); 300 x 200 -> L15 at 30 s; 456 x 304 -> 60 s; 600 x 400 -> 90 s (target 120-160 s like City Island). |
| D6  | Points per map          | **13 000** (fewer than City Island's 30 000; below ~21 000 layout C loses a cardboard-box type), filled exactly by `balancePoints` using the toy filler items (`brick_pile`, `packing_peanuts`, `confetti_pile`, `puzzle_piece`, `bouncy_ball`, `brick_2x2`).                                                     |
| D7  | Eat rule, tiers, points | **Unchanged.** The toy catalog is derived from dimensions like every item; never hand-pick points. Tall-but-thin items (giraffe plush, rocket, robots) are cheap on purpose: size is `max(w, d, h x 0.25)`.                                                                                                       |
| D8  | Scoring version         | **Done:** per map (`MAP_SCORING_VERSIONS` in `game/scores.ts`), so adding this map does not wipe City Island scores.                                                                                                                                                                                              |
| D9  | Plush rig               | **One parametric plush builder** (head ratio, ears, snout, tail, arm pose, palette) driving every family and size, not 40 hand-written builders.                                                                                                                                                                  |
| D10 | Mascot / landmark       | **Big Ted**: a giant brown-bear plush sitting on a stack of colour blocks, the signature landmark (tier 25, one copy). `mascot_standee` is its small cut-out.                                                                                                                                                     |

## 3. The size ladder in toy-store terms

Tier maxima (m), from the DETAILS.md: T1 0.90 · T2 1.05 · T3 1.22 · T4 1.43 · T5 1.67 · T6 1.94 · T7 2.27 · T8 2.64 ·
T9 3.08 · T10 3.59 · T11 4.19 · T12 4.88 · T13 5.69 · T14 6.64 · T15 7.74 · T16 9.03 · T17 10.5 · T18 12.3 · T19 14.3 ·
T20 16.7 · T21 19.5 · T22 22.7 · T23 26.5 · T24 30.9 · T25 36.

| Hole level | Eats up to | Toy store feel                                                                                                 |
| ---------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1          | 0.9 m      | loose bricks, mini figures, balls, keychain plush, ducks, dice, puzzle pieces, cardboard boxes                 |
| 2          | 1.43 m     | tricycles, small plush (panda S, bear S, rabbit S), brick bins, claw machine, toy trucks                       |
| 3          | 2.64 m     | dollhouses, RC cars, medium plush (panda M, rabbit M, bear M), swan / flamingo floats, gondola shelves, robots |
| 4          | 3.59 m     | train loops, ride-on cars, inflatable rafts, trampolines, big robots, ball-pit-sized displays                  |
| 5          | 4.88 m     | big plush (panda L, rabbit L), ball pit, ride-on jeep, go-kart, family raft, large dollhouse                   |
| 6          | 6.64 m     | giant robot, ride-on fire engine, whale float, bounce house, plush throne, toy castle, bear L                  |
| 7          | 9.03 m     | shelf runs, delivery truck, kiddie train, mech walker, jumbo plush (panda XL, rabbit XL)                       |
| 8          | 12.3 m     | big carousel, brick tower, play castle, shipping container, bear XL                                            |
| 9          | 14.3 m     | colossus robot, railway table, semi trailer, elephant XL                                                       |
| 10         | 16.7 m     | panda XXL (the front-window giant), brick skyscraper                                                           |
| 11         | 19.5 m     | rabbit XXL, T-rex statue                                                                                       |
| 12-13      | 22.7-26.5  | giant Ferris wheel, brick castle, bear XXL, giant rocket, whale XXL                                            |
| 14         | 30.9 m     | model railway, titan robot, long-neck statue                                                                   |
| 15         | 36 m       | Big Ted, robot overlord, railway world                                                                         |

## 4. Asset list

### 4.1 Edible catalog (210 types)

Dimensions are the proposal; tier, points and level were computed with the rules of `sim/progression.ts` (tier = first
tier whose max >= size, points = that tier's points, level = first level that can eat it) by a throw-away script.
**Re-derive them with the real catalog code and the `items` test before trusting them.** Priority: **P0** = needed for
a playable first version (67 types) · **P1** = full v1 · **P2** = polish. Dept = where the generator places it first
(`everywhere` = scattered by the filler rules). `paint` = tinted per instance.

Coverage (checked): every size tier 1-25 has at least 2 types (tier 1 has 50, tiers 17, 20, 21 and 23 have exactly 2,
tier 25 has 3) and every hole level 1-15 has at least 2 types (levels 10, 11 and 13 have exactly 2). **Protect those
thin tiers when cutting items.**

| Tier | Pts | Lvl | id                         | Pri | Dept            | w×d×h (m)      | size | Notes                                       |
| ---- | --- | --- | -------------------------- | --- | --------------- | -------------- | ---- | ------------------------------------------- |
| 1    | 1   | L1  | `minifigure`               | P0  | Figure Falls    | 0.12×0.1×0.3   | 0.12 | 6 outfits (paint)                           |
| 1    | 1   | L1  | `brick_2x2`                | P0  | Brick Alley     | 0.16×0.16×0.1  | 0.16 | 8 colours (paint)                           |
| 1    | 1   | L1  | `bouncy_ball`              | P0  | everywhere      | 0.2×0.2×0.2    | 0.2  | paint                                       |
| 1    | 1   | L1  | `spinning_top`             | P1  | Game Room       | 0.2×0.2×0.25   | 0.2  |                                             |
| 1    | 1   | L1  | `action_figure`            | P0  | Figure Falls    | 0.25×0.15×0.6  | 0.25 |                                             |
| 1    | 1   | L1  | `blind_bag`                | P1  | Checkout        | 0.25×0.04×0.35 | 0.25 | foil packet, paint                          |
| 1    | 1   | L1  | `alphabet_block`           | P0  | Brick Alley     | 0.25×0.25×0.25 | 0.25 |                                             |
| 1    | 1   | L1  | `animal_figure`            | P1  | Figure Falls    | 0.3×0.15×0.25  | 0.3  | cow / pig / sheep variants                  |
| 1    | 1   | L1  | `rubber_duck`              | P0  | Splash Zone     | 0.3×0.2×0.25   | 0.3  |                                             |
| 1    | 1   | L1  | `puzzle_piece`             | P0  | Game Room       | 0.3×0.3×0.03   | 0.3  | flat, 4 colours                             |
| 1    | 1   | L1  | `plush_keychain`           | P0  | Checkout        | 0.3×0.2×0.4    | 0.3  | clip + ring                                 |
| 1    | 1   | L1  | `doll_fashion`             | P1  | Doll House Lane | 0.3×0.15×0.9   | 0.3  | paint                                       |
| 1    | 1   | L1  | `brick_2x4`                | P0  | Brick Alley     | 0.32×0.16×0.1  | 0.32 | 8 colours (paint)                           |
| 1    | 1   | L1  | `brick_plate`              | P0  | Brick Alley     | 0.32×0.32×0.04 | 0.32 | paint                                       |
| 1    | 1   | L1  | `figure_blister_pack`      | P1  | Figure Falls    | 0.35×0.1×0.55  | 0.35 |                                             |
| 1    | 1   | L1  | `toy_car_mini`             | P0  | Vroom Row       | 0.35×0.15×0.12 | 0.35 | paint                                       |
| 1    | 1   | L1  | `wind_up_robot`            | P0  | Robot Factory   | 0.35×0.2×0.5   | 0.35 | key on back                                 |
| 1    | 1   | L1  | `dino_figure`              | P0  | Figure Falls    | 0.4×0.15×0.3   | 0.4  |                                             |
| 1    | 1   | L1  | `candy_jar`                | P1  | Checkout        | 0.4×0.4×0.6    | 0.4  |                                             |
| 1    | 1   | L1  | `jack_in_box`              | P1  | Game Room       | 0.4×0.4×0.6    | 0.4  |                                             |
| 1    | 1   | L1  | `sand_bucket`              | P1  | Splash Zone     | 0.4×0.4×0.35   | 0.4  |                                             |
| 1    | 1   | L1  | `soccer_ball`              | P1  | Splash Zone     | 0.45×0.45×0.45 | 0.45 |                                             |
| 1    | 1   | L1  | `brick_pile`               | P0  | Brick Alley     | 0.5×0.5×0.2    | 0.5  | filler, tops up the budget like grass tufts |
| 1    | 1   | L1  | `packing_peanuts`          | P0  | Stockroom       | 0.5×0.5×0.25   | 0.5  | filler                                      |
| 1    | 1   | L1  | `gumball_machine`          | P1  | Checkout        | 0.5×0.5×0.95   | 0.5  |                                             |
| 1    | 1   | L1  | `toy_basket`               | P0  | everywhere      | 0.5×0.35×0.3   | 0.5  | with toys                                   |
| 1    | 1   | L1  | `baby_doll`                | P1  | Doll House Lane | 0.5×0.35×0.5   | 0.5  |                                             |
| 1    | 1   | L1  | `puzzle_box`               | P0  | Game Room       | 0.5×0.4×0.08   | 0.5  | box art colour blocks                       |
| 1    | 1   | L1  | `brick_tub`                | P0  | Brick Alley     | 0.55×0.55×0.5  | 0.55 | lid, studs on top                           |
| 1    | 1   | L1  | `confetti_pile`            | P1  | everywhere      | 0.6×0.6×0.05   | 0.6  | filler, flat                                |
| 1    | 1   | L1  | `balloon_bunch`            | P1  | Checkout        | 0.6×0.6×1      | 0.6  | weighted ribbon, paint                      |
| 1    | 1   | L1  | `price_standee`            | P1  | everywhere      | 0.6×0.3×1.5    | 0.6  |                                             |
| 1    | 1   | L1  | `plush_penguin_s`          | P1  | Plush Meadow    | 0.6×0.5×0.8    | 0.6  |                                             |
| 1    | 1   | L1  | `board_game_box`           | P0  | Game Room       | 0.6×0.4×0.1    | 0.6  | 4 colours                                   |
| 1    | 1   | L1  | `cardboard_box`            | P0  | Stockroom       | 0.6×0.5×0.5    | 0.6  |                                             |
| 1    | 1   | L1  | `hand_truck`               | P1  | Stockroom       | 0.6×0.6×1.3    | 0.6  |                                             |
| 1    | 1   | L1  | `plush_panda_xs`           | P0  | Plush Meadow    | 0.7×0.6×0.9    | 0.7  | REQUIRED family                             |
| 1    | 1   | L1  | `board_game_stack`         | P1  | Game Room       | 0.7×0.5×0.9    | 0.7  |                                             |
| 1    | 1   | L1  | `brick_set_box`            | P1  | Brick Alley     | 0.8×0.6×0.2    | 0.8  | box art = colour blocks                     |
| 1    | 1   | L1  | `spinner_rack`             | P1  | Checkout        | 0.8×0.8×1.8    | 0.8  | keychains / stickers                        |
| 1    | 1   | L1  | `plush_brown_bear_xs`      | P0  | Plush Meadow    | 0.8×0.7×1      | 0.8  | REQUIRED family                             |
| 1    | 1   | L1  | `plush_gray_rabbit_xs`     | P0  | Plush Meadow    | 0.8×0.6×1.4    | 0.8  | REQUIRED family                             |
| 1    | 1   | L1  | `plush_kitten_s`           | P1  | Plush Meadow    | 0.8×0.5×0.8    | 0.8  |                                             |
| 1    | 1   | L1  | `robot_toy`                | P0  | Robot Factory   | 0.8×0.6×1.3    | 0.8  | paint                                       |
| 1    | 1   | L1  | `water_gun`                | P1  | Splash Zone     | 0.8×0.2×0.4    | 0.8  |                                             |
| 1    | 1   | L1  | `skateboard`               | P1  | Splash Zone     | 0.8×0.2×0.15   | 0.8  |                                             |
| 1    | 1   | L1  | `plush_dino_s`             | P1  | Plush Meadow    | 0.9×0.6×0.9    | 0.9  |                                             |
| 1    | 1   | L1  | `plush_giraffe_s`          | P1  | Plush Meadow    | 0.9×0.5×2.8    | 0.9  |                                             |
| 1    | 1   | L1  | `plush_puppy_s`            | P1  | Plush Meadow    | 0.9×0.5×0.7    | 0.9  |                                             |
| 1    | 1   | L1  | `beach_ball`               | P0  | Splash Zone     | 0.9×0.9×0.9    | 0.9  | paint                                       |
| 2    | 2   | L2  | `figure_display_case`      | P1  | Figure Falls    | 1×0.5×1.2      | 1    | glass front, 3 shelves                      |
| 2    | 2   | L2  | `plush_unicorn_s`          | P1  | Plush Meadow    | 1×0.5×1.2      | 1    |                                             |
| 2    | 2   | L2  | `plush_pile`               | P0  | Plush Meadow    | 1×1×0.8        | 1    | loose heap of minis, filler                 |
| 2    | 2   | L2  | `toy_truck`                | P0  | Vroom Row       | 1×0.5×0.5      | 1    | paint                                       |
| 2    | 2   | L2  | `drone`                    | P1  | Robot Factory   | 1×1×0.3        | 1    |                                             |
| 2    | 2   | L2  | `arcade_cabinet`           | P1  | Game Room       | 1×1×2          | 1    |                                             |
| 2    | 2   | L2  | `tricycle`                 | P1  | Splash Zone     | 1×0.5×0.7      | 1    |                                             |
| 2    | 2   | L2  | `kick_scooter`             | P1  | Splash Zone     | 1×0.4×1        | 1    |                                             |
| 2    | 2   | L2  | `shopping_cart_toys`       | P0  | everywhere      | 1×0.6×1        | 1    | full of toys                                |
| 3    | 3   | L2  | `plush_panda_s`            | P0  | Plush Meadow    | 1.1×1×1.4      | 1.1  | REQUIRED family                             |
| 3    | 3   | L2  | `doll_stroller`            | P1  | Doll House Lane | 1.1×0.6×1      | 1.1  |                                             |
| 3    | 3   | L2  | `brick_set_box_big`        | P1  | Brick Alley     | 1.2×0.9×0.25   | 1.2  |                                             |
| 3    | 3   | L2  | `brick_car_small`          | P1  | Brick Alley     | 1.2×0.6×0.5    | 1.2  |                                             |
| 3    | 3   | L2  | `mascot_standee`           | P1  | Atrium          | 1.2×0.4×3      | 1.2  | card cut-out of the store mascot            |
| 3    | 3   | L2  | `plush_elephant_s`         | P1  | Plush Meadow    | 1.2×0.8×1      | 1.2  |                                             |
| 3    | 3   | L2  | `plush_octopus_s`          | P1  | Plush Meadow    | 1.2×1.2×1      | 1.2  |                                             |
| 3    | 3   | L2  | `giant_dice`               | P1  | Game Room       | 1.2×1.2×1.2    | 1.2  |                                             |
| 3    | 3   | L2  | `chess_table`              | P2  | Game Room       | 1.2×1.2×1      | 1.2  |                                             |
| 3    | 3   | L2  | `swim_ring`                | P0  | Splash Zone     | 1.2×1.2×0.3    | 1.2  | paint                                       |
| 3    | 3   | L2  | `ball_bin`                 | P1  | Splash Zone     | 1.2×1.2×1      | 1.2  |                                             |
| 3    | 3   | L2  | `box_stack`                | P0  | Stockroom       | 1.2×1.2×2      | 1.2  |                                             |
| 3    | 3   | L2  | `pallet_boxes`             | P0  | Stockroom       | 1.2×1×1.6      | 1.2  |                                             |
| 3    | 3   | L2  | `end_cap_display`          | P1  | everywhere      | 1.2×0.5×1.8    | 1.2  |                                             |
| 4    | 4   | L2  | `brick_bin`                | P0  | Brick Alley     | 1.3×0.9×0.8    | 1.3  | pick-a-brick wall bin, heaped with bricks   |
| 4    | 4   | L2  | `plush_gray_rabbit_s`      | P0  | Plush Meadow    | 1.3×0.9×2.3    | 1.3  | REQUIRED family                             |
| 4    | 4   | L2  | `toy_fire_truck`           | P1  | Vroom Row       | 1.3×0.5×0.6    | 1.3  |                                             |
| 4    | 4   | L2  | `claw_machine`             | P0  | Game Room       | 1.3×1.3×2.5    | 1.3  | plush prizes baked in                       |
| 4    | 4   | L2  | `plush_brown_bear_s`       | P0  | Plush Meadow    | 1.4×1.2×1.7    | 1.4  | REQUIRED family                             |
| 4    | 4   | L2  | `plush_bin`                | P0  | Plush Meadow    | 1.4×1.4×1      | 1.4  |                                             |
| 4    | 4   | L2  | `tea_party_table`          | P1  | Doll House Lane | 1.4×1.4×0.8    | 1.4  |                                             |
| 4    | 4   | L2  | `robot_action`             | P0  | Robot Factory   | 1.4×1×2.2      | 1.4  |                                             |
| 5    | 5   | L3  | `plush_lion_s`             | P1  | Plush Meadow    | 1.5×1×1.5      | 1.5  |                                             |
| 5    | 5   | L3  | `dollhouse_small`          | P0  | Doll House Lane | 1.5×1.2×1.6    | 1.5  | open back, tiny furniture                   |
| 5    | 5   | L3  | `pinball_machine`          | P1  | Game Room       | 1.5×0.7×1.9    | 1.5  |                                             |
| 5    | 5   | L3  | `foosball_table`           | P1  | Game Room       | 1.5×0.8×1      | 1.5  |                                             |
| 5    | 5   | L3  | `bike_kids`                | P1  | Splash Zone     | 1.5×0.5×0.9    | 1.5  | paint                                       |
| 5    | 5   | L3  | `brick_baseplate_big`      | P1  | Brick Alley     | 1.6×1.6×0.1    | 1.6  | floor build mat with a half-built model     |
| 5    | 5   | L3  | `figure_shelf`             | P0  | Figure Falls    | 1.6×0.5×1.6    | 1.6  | stock baked in                              |
| 5    | 5   | L3  | `dino_figure_big`          | P1  | Figure Falls    | 1.6×0.6×1      | 1.6  |                                             |
| 5    | 5   | L3  | `plush_penguin_m`          | P1  | Plush Meadow    | 1.6×1.3×2      | 1.6  |                                             |
| 5    | 5   | L3  | `toy_kitchen`              | P1  | Doll House Lane | 1.6×0.7×1.8    | 1.6  |                                             |
| 5    | 5   | L3  | `train_engine`             | P1  | Vroom Row       | 1.6×0.5×0.8    | 1.6  | engine + 2 wagons                           |
| 5    | 5   | L3  | `pool_float_duck`          | P0  | Splash Zone     | 1.6×1.6×1.3    | 1.6  |                                             |
| 5    | 5   | L3  | `display_table`            | P0  | everywhere      | 1.6×1.2×0.8    | 1.6  |                                             |
| 6    | 6   | L3  | `plush_kitten_m`           | P1  | Plush Meadow    | 1.7×1×1.7      | 1.7  |                                             |
| 6    | 6   | L3  | `rc_car`                   | P0  | Vroom Row       | 1.7×0.9×0.6    | 1.7  | paint                                       |
| 6    | 6   | L3  | `plush_giraffe_m`          | P1  | Plush Meadow    | 1.8×1×5.5      | 1.8  |                                             |
| 6    | 6   | L3  | `rc_helicopter`            | P2  | Robot Factory   | 1.8×0.5×0.6    | 1.8  |                                             |
| 7    | 7   | L3  | `brick_house_small`        | P1  | Brick Alley     | 2×1.8×1.8      | 2    |                                             |
| 7    | 7   | L3  | `plush_panda_m`            | P0  | Plush Meadow    | 2×1.8×2.5      | 2    | REQUIRED family                             |
| 7    | 7   | L3  | `plush_dino_m`             | P1  | Plush Meadow    | 2×1.3×2        | 2    |                                             |
| 7    | 7   | L3  | `plush_puppy_m`            | P1  | Plush Meadow    | 2×1×1.6        | 2    |                                             |
| 7    | 7   | L3  | `rc_monster_truck`         | P1  | Vroom Row       | 2×1.4×1        | 2    |                                             |
| 7    | 7   | L3  | `robot_dog`                | P1  | Robot Factory   | 2×0.9×1.4      | 2    |                                             |
| 7    | 7   | L3  | `floor_puzzle_mat`         | P2  | Game Room       | 2×1.5×0.05     | 2    | flat                                        |
| 7    | 7   | L3  | `pool_float_swan`          | P1  | Splash Zone     | 2×1.4×1.8      | 2    |                                             |
| 7    | 7   | L3  | `shipping_crate`           | P1  | Stockroom       | 2×2×2          | 2    |                                             |
| 7    | 7   | L3  | `plush_unicorn_m`          | P1  | Plush Meadow    | 2.2×1.1×2.6    | 2.2  |                                             |
| 7    | 7   | L3  | `pool_float_flamingo`      | P0  | Splash Zone     | 2.2×1.8×1.8    | 2.2  |                                             |
| 7    | 7   | L3  | `pool_float_donut`         | P1  | Splash Zone     | 2.2×2.2×0.7    | 2.2  | paint                                       |
| 8    | 8   | L3  | `figure_gondola`           | P0  | Figure Falls    | 2.4×0.7×2      | 2.4  | carded figures both sides                   |
| 8    | 8   | L3  | `plush_gray_rabbit_m`      | P0  | Plush Meadow    | 2.4×1.6×4.2    | 2.4  | REQUIRED family                             |
| 8    | 8   | L3  | `plush_wall_shelf`         | P0  | Plush Meadow    | 2.4×0.8×2      | 2.4  | stock baked in                              |
| 8    | 8   | L3  | `toy_plane`                | P1  | Vroom Row       | 2.4×2.4×0.8    | 2.4  |                                             |
| 8    | 8   | L3  | `robot_big`                | P0  | Robot Factory   | 2.4×1.8×4      | 2.4  | paint                                       |
| 8    | 8   | L3  | `air_hockey_table`         | P1  | Game Room       | 2.4×1.3×0.9    | 2.4  |                                             |
| 8    | 8   | L3  | `game_shelf`               | P1  | Game Room       | 2.4×0.6×2      | 2.4  |                                             |
| 8    | 8   | L3  | `pool_float_unicorn`       | P1  | Splash Zone     | 2.4×1.8×2      | 2.4  |                                             |
| 8    | 8   | L3  | `paddling_pool`            | P1  | Splash Zone     | 2.4×2.4×0.5    | 2.4  |                                             |
| 8    | 8   | L3  | `kids_goal`                | P2  | Splash Zone     | 2.4×1.2×1.6    | 2.4  |                                             |
| 8    | 8   | L3  | `gondola_shelf`            | P0  | everywhere      | 2.4×0.7×2      | 2.4  | stock variant per department                |
| 8    | 8   | L3  | `checkout_counter`         | P1  | Checkout        | 2.4×0.9×1      | 2.4  |                                             |
| 8    | 8   | L3  | `box_pyramid`              | P1  | Stockroom       | 2.4×2.4×2      | 2.4  |                                             |
| 8    | 8   | L3  | `play_tent`                | P1  | Doll House Lane | 2.5×2.5×2.2    | 2.5  | paint                                       |
| 8    | 8   | L3  | `forklift`                 | P1  | Stockroom       | 2.5×1.2×2.2    | 2.5  |                                             |
| 8    | 8   | L3  | `plush_brown_bear_m`       | P0  | Plush Meadow    | 2.6×2.3×3.2    | 2.6  | REQUIRED family                             |
| 9    | 9   | L4  | `plush_whale_s`            | P1  | Plush Meadow    | 2.8×1.2×1.6    | 2.8  |                                             |
| 9    | 9   | L4  | `brick_dragon`             | P2  | Brick Alley     | 3×1.5×2.5      | 3    |                                             |
| 9    | 9   | L4  | `dino_diorama`             | P2  | Figure Falls    | 3×2×1.2        | 3    |                                             |
| 9    | 9   | L4  | `plush_elephant_m`         | P1  | Plush Meadow    | 3×2×2.5        | 3    |                                             |
| 9    | 9   | L4  | `plush_octopus_m`          | P1  | Plush Meadow    | 3×3×2.4        | 3    |                                             |
| 9    | 9   | L4  | `train_set_loop`           | P1  | Vroom Row       | 3×3×0.5        | 3    |                                             |
| 10   | 10  | L4  | `plush_lion_m`             | P1  | Plush Meadow    | 3.2×2.2×3.2    | 3.2  |                                             |
| 10   | 10  | L4  | `ride_on_car`              | P0  | Vroom Row       | 3.2×1.6×1.8    | 3.2  | paint                                       |
| 10   | 10  | L4  | `inflatable_raft`          | P0  | Splash Zone     | 3.2×1.9×0.6    | 3.2  | paint, oars                                 |
| 10   | 10  | L4  | `figure_pyramid`           | P1  | Figure Falls    | 3.4×3.4×2.4    | 3.4  | tiered promo display                        |
| 10   | 10  | L4  | `plush_penguin_l`          | P1  | Plush Meadow    | 3.4×2.8×4.2    | 3.4  |                                             |
| 10   | 10  | L4  | `robo_truck`               | P1  | Robot Factory   | 3.4×1.8×3      | 3.4  | half truck, half robot                      |
| 10   | 10  | L4  | `inflatable_kayak`         | P2  | Splash Zone     | 3.4×0.9×0.5    | 3.4  |                                             |
| 10   | 10  | L4  | `trampoline`               | P1  | Splash Zone     | 3.4×3.4×0.9    | 3.4  |                                             |
| 10   | 10  | L4  | `backyard_slide`           | P2  | Splash Zone     | 3.4×1×2.2      | 3.4  |                                             |
| 10   | 10  | L4  | `plush_giraffe_l`          | P1  | Plush Meadow    | 3.5×2×11       | 3.5  |                                             |
| 10   | 10  | L4  | `plush_pyramid`            | P1  | Plush Meadow    | 3.5×3.5×3      | 3.5  | stacked mixed plush                         |
| 10   | 10  | L4  | `race_track_set`           | P1  | Vroom Row       | 3.5×2.5×2      | 3.5  | loop-the-loop                               |
| 11   | 11  | L5  | `plush_panda_l`            | P0  | Plush Meadow    | 4×3.6×5        | 4    | REQUIRED family                             |
| 11   | 11  | L5  | `plush_puppy_l`            | P1  | Plush Meadow    | 4×2×3.2        | 4    |                                             |
| 11   | 11  | L5  | `ball_pit`                 | P1  | Game Room       | 4×4×1          | 4    | balls baked in                              |
| 11   | 11  | L5  | `ride_on_jeep`             | P1  | Vroom Row       | 4.1×1.9×2      | 4.1  | paint                                       |
| 12   | 12  | L5  | `brick_car_big`            | P1  | Brick Alley     | 4.4×2×1.6      | 4.4  | display model                               |
| 12   | 12  | L5  | `plush_unicorn_l`          | P1  | Plush Meadow    | 4.4×2.2×5.2    | 4.4  |                                             |
| 12   | 12  | L5  | `dollhouse_large`          | P1  | Doll House Lane | 4.5×3.5×4.5    | 4.5  |                                             |
| 12   | 12  | L5  | `storefront_kiosk`         | P2  | Checkout        | 4.5×3.5×3      | 4.5  |                                             |
| 12   | 12  | L5  | `plush_gray_rabbit_l`      | P0  | Plush Meadow    | 4.6×3.2×8      | 4.6  | REQUIRED family                             |
| 12   | 12  | L5  | `go_kart`                  | P1  | Vroom Row       | 4.6×2.2×1.6    | 4.6  | paint                                       |
| 12   | 12  | L5  | `raft_family`              | P0  | Splash Zone     | 4.8×2.4×0.9    | 4.8  | paint                                       |
| 13   | 13  | L6  | `plush_dino_l`             | P1  | Plush Meadow    | 5×3×4.5        | 5    |                                             |
| 13   | 13  | L6  | `toy_castle`               | P1  | Doll House Lane | 5×5×5          | 5    |                                             |
| 13   | 13  | L6  | `rocket_display`           | P1  | Robot Factory   | 5×5×14         | 5    |                                             |
| 13   | 13  | L6  | `plush_brown_bear_l`       | P0  | Plush Meadow    | 5.2×4.6×6.4    | 5.2  | REQUIRED family                             |
| 13   | 13  | L6  | `ride_on_fire_engine`      | P1  | Vroom Row       | 5.2×2.2×3      | 5.2  |                                             |
| 13   | 13  | L6  | `playhouse_cottage`        | P1  | Splash Zone     | 5.5×4.5×4      | 5.5  |                                             |
| 13   | 13  | L6  | `robot_giant`              | P0  | Robot Factory   | 5.5×4×9        | 5.5  |                                             |
| 14   | 14  | L6  | `plush_throne`             | P2  | Plush Meadow    | 6×6×6          | 6    | giant armchair with plush audience          |
| 14   | 14  | L6  | `pool_float_whale`         | P1  | Splash Zone     | 6×3×2.5        | 6    |                                             |
| 14   | 14  | L6  | `inflatable_pool_big`      | P2  | Splash Zone     | 6×6×1.2        | 6    |                                             |
| 14   | 14  | L6  | `plush_elephant_l`         | P1  | Plush Meadow    | 6.5×4.4×5.5    | 6.5  |                                             |
| 14   | 14  | L6  | `ride_on_helicopter`       | P2  | Vroom Row       | 6.5×2×3        | 6.5  |                                             |
| 14   | 14  | L6  | `carousel_mini`            | P1  | Atrium          | 6.5×6.5×5      | 6.5  |                                             |
| 14   | 14  | L6  | `bounce_house`             | P1  | Splash Zone     | 6.5×6.5×5      | 6.5  | paint                                       |
| 15   | 15  | L7  | `plush_whale_m`            | P1  | Plush Meadow    | 7×3×4          | 7    |                                             |
| 15   | 15  | L7  | `shelf_run`                | P1  | everywhere      | 7×0.8×2.2      | 7    | 3 gondolas joined                           |
| 15   | 15  | L7  | `delivery_truck_box`       | P0  | Stockroom       | 7×2.6×3.6      | 7    |                                             |
| 16   | 16  | L7  | `plush_panda_xl`           | P0  | Plush Meadow    | 8×7.2×10       | 8    | REQUIRED family                             |
| 16   | 16  | L7  | `kiddie_train_ride`        | P2  | Vroom Row       | 8×2.2×3.5      | 8    |                                             |
| 16   | 16  | L7  | `ferris_wheel_mini`        | P2  | Atrium          | 8×3×10         | 8    |                                             |
| 16   | 16  | L7  | `giant_board_game`         | P2  | Game Room       | 8×8×0.1        | 8    | floor game, flat                            |
| 16   | 16  | L7  | `plush_unicorn_xl`         | P1  | Plush Meadow    | 8.5×4.2×10     | 8.5  |                                             |
| 16   | 16  | L7  | `spaceship_display`        | P2  | Robot Factory   | 8.5×6×4        | 8.5  |                                             |
| 16   | 16  | L7  | `plush_gray_rabbit_xl`     | P0  | Plush Meadow    | 9×6×15.5       | 9    | REQUIRED family                             |
| 16   | 16  | L7  | `dollhouse_mansion`        | P2  | Doll House Lane | 9×6.5×8        | 9    |                                             |
| 16   | 16  | L7  | `rocket_big`               | P1  | Robot Factory   | 9×9×28         | 9    |                                             |
| 16   | 16  | L7  | `robot_mech_walker`        | P1  | Robot Factory   | 9×7×14         | 9    |                                             |
| 17   | 17  | L8  | `aisle_shelf_double`       | P2  | everywhere      | 9.6×1.6×2.4    | 9.6  |                                             |
| 17   | 17  | L8  | `plush_dino_xl`            | P1  | Plush Meadow    | 10×6×9         | 10   |                                             |
| 18   | 18  | L8  | `plush_brown_bear_xl`      | P0  | Plush Meadow    | 11×9.6×13.5    | 11   | REQUIRED family                             |
| 18   | 18  | L8  | `play_castle_big`          | P1  | Doll House Lane | 11×11×9        | 11   |                                             |
| 18   | 18  | L8  | `brick_tower_display`      | P1  | Atrium          | 12×12×30       | 12   | studded corner tower                        |
| 18   | 18  | L8  | `carousel_big`             | P1  | Atrium          | 12×12×8        | 12   | animated spin = iteration                   |
| 18   | 18  | L8  | `shipping_container`       | P1  | Stockroom       | 12×2.4×2.6     | 12   |                                             |
| 19   | 19  | L9  | `plush_elephant_xl`        | P1  | Plush Meadow    | 13×9×11        | 13   |                                             |
| 19   | 19  | L9  | `railway_table`            | P1  | Vroom Row       | 14×9×3         | 14   |                                             |
| 19   | 19  | L9  | `robot_colossus`           | P0  | Atrium          | 14×10×30       | 14   |                                             |
| 19   | 19  | L9  | `giant_inflatable_slide`   | P2  | Splash Zone     | 14×5×8         | 14   |                                             |
| 19   | 19  | L9  | `semi_trailer`             | P1  | Stockroom       | 14×2.6×4       | 14   |                                             |
| 20   | 20  | L10 | `plush_panda_xxl`          | P0  | Plush Meadow    | 15×13.5×19     | 15   | REQUIRED family                             |
| 20   | 20  | L10 | `brick_skyscraper_display` | P2  | Atrium          | 16×16×40       | 16   |                                             |
| 21   | 25  | L11 | `plush_gray_rabbit_xxl`    | P0  | Plush Meadow    | 17×11×30       | 17   | REQUIRED family                             |
| 21   | 25  | L11 | `dino_statue_trex`         | P2  | Atrium          | 18×6×10        | 18   |                                             |
| 22   | 30  | L12 | `ferris_wheel_giant`       | P1  | Atrium          | 20×6×24        | 20   |                                             |
| 22   | 30  | L12 | `giant_gift_box`           | P2  | Atrium          | 20×20×20       | 20   |                                             |
| 22   | 30  | L12 | `brick_castle_display`     | P1  | Atrium          | 22×22×14       | 22   | banners, drawbridge                         |
| 22   | 30  | L12 | `plush_brown_bear_xxl`     | P0  | Plush Meadow    | 22×19×27       | 22   | REQUIRED family                             |
| 23   | 35  | L13 | `plush_whale_xxl`          | P2  | Atrium          | 24×10×13       | 24   | hangs over the aisle                        |
| 23   | 35  | L13 | `rocket_giant`             | P2  | Atrium          | 24×24×70       | 24   | fins + gantry                               |
| 24   | 40  | L14 | `model_railway`            | P2  | Vroom Row       | 28×18×6        | 28   | tunnels, station, little town               |
| 24   | 40  | L14 | `robot_titan`              | P1  | Atrium          | 28×20×55       | 28   |                                             |
| 24   | 40  | L14 | `dino_statue_brachio`      | P2  | Atrium          | 30×5×20        | 30   |                                             |
| 25   | 50  | L15 | `robot_overlord`           | P1  | Atrium          | 34×26×66       | 34   | tier 25 centrepiece                         |
| 25   | 50  | L15 | `railway_world`            | P2  | Vroom Row       | 34×22×7        | 34   | whole town on a table                       |
| 25   | 50  | L15 | `landmark_big_ted`         | P0  | Atrium          | 34×30×40       | 34   | the signature landmark, 1 copy              |

### 4.2 Plush families (the hero set)

One builder, many animals (D9). Sizes are the longest footprint side in metres (`size`), tier in brackets. The three
required families come first and have **all six sizes** (P0); the rest are P1. Giraffe is deliberately tall and thin
(cheap for its height), whale and octopus are wide and low.

| Family (colour)                   | XS       | S        | M         | L         | XL        | XXL      |
| --------------------------------- | -------- | -------- | --------- | --------- | --------- | -------- |
| **Panda** (black / white) - REQ   | 0.7 (T1) | 1.1 (T3) | 2.0 (T7)  | 4.0 (T11) | 8.0 (T16) | 15 (T20) |
| **Brown bear** (tan snout) - REQ  | 0.8 (T1) | 1.4 (T4) | 2.6 (T8)  | 5.2 (T13) | 11 (T18)  | 22 (T22) |
| **Gray rabbit** (long ears) - REQ | 0.8 (T1) | 1.3 (T4) | 2.4 (T8)  | 4.6 (T12) | 9.0 (T16) | 17 (T21) |
| Elephant (blue-grey)              |          | 1.2 (T3) | 3.0 (T9)  | 6.5 (T14) | 13 (T19)  |          |
| Unicorn (white, rainbow mane)     |          | 1.0 (T2) | 2.2 (T7)  | 4.4 (T12) | 8.5 (T16) |          |
| T-rex (green)                     |          | 0.9 (T1) | 2.0 (T7)  | 5.0 (T13) | 10 (T17)  |          |
| Penguin                           |          | 0.6 (T1) | 1.6 (T5)  | 3.4 (T10) |           |          |
| Giraffe (tall, thin)              |          | 0.9 (T1) | 1.8 (T6)  | 3.5 (T10) |           |          |
| Puppy (golden)                    |          | 0.9 (T1) | 2.0 (T7)  | 4.0 (T11) |           |          |
| Kitten (orange)                   |          | 0.8 (T1) | 1.7 (T6)  |           |           |          |
| Lion                              |          | 1.5 (T5) | 3.2 (T10) |           |           |          |
| Octopus (purple)                  |          | 1.2 (T3) | 3.0 (T9)  |           |           |          |
| Whale (blue)                      |          | 2.8 (T9) | 7.0 (T15) |           |           | 24 (T23) |

Plus plush fixtures: `plush_keychain` (T1), `plush_pile` (T2, filler), `plush_bin` (T4), `plush_wall_shelf` (T8),
`plush_pyramid` (T10), `plush_throne` (T14), and the landmark `landmark_big_ted` (T25, a brown-bear XXXL on colour blocks).

Plush look (blocky, like the rest of the game): rounded-looking body from 2-3 stacked tapered boxes, big head, small
muzzle box, ear boxes, stubby arms and legs, 2 eye boxes and a nose box **proud of the face by 1-3 cm** (the clip test
fails flush faces). Panda = white body, black ears / eye patches / arms / legs. Gray rabbit = grey body, pale inner ears,
pink nose, cotton tail, ears 1.8x the head height. Brown bear = brown body, tan muzzle and belly patch. Size classes
vary the proportions a bit (XS has the biggest head: cuter). Optional bow / scarf colour per instance via `paint`.

### 4.3 Non-edible assets (map furniture)

| Asset              | Status | Notes                                                                                                                                                     |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store floor        | todo   | rectangle slab (stencil-cut like the island ground), big pastel checker tiles (10 m), skirt below so the hole walls have something to cut through         |
| Zone mats          | todo   | one flat `GroundRect` per department in its colour (see layouts), slightly different height per layer like the city lots                                  |
| Aisle markings     | todo   | floor tape lines, arrows, painted footprints that lead from the entrance to each department, big painted department names (readable from the game camera) |
| Perimeter walls    | todo   | non-edible, 3 sides tall with banners / shelves painted on, the **south (camera-side) wall low** or drawn with the existing dither fade (`FADE_FRAGMENT`) |
| Entrance           | todo   | glass double door gap in the south wall, door mat, checkout lanes drawn as floor decals                                                                   |
| Void outside       | todo   | pavement / parking lot grey beyond the walls (no water here); the hole cannot leave the floor                                                             |
| Sky / fog / lights | todo   | warm, bright "indoor" palette: sun key light + hemisphere, fog colour matches the void; no tone mapping (flat colours stay flat)                          |
| Decals             | todo   | "SALE" stickers, price tags, wet-floor sign decals (flat, 1-3 cm above the floor)                                                                         |

Everything that is not in the table above and sits on the floor must be an **edible catalog item** (D4).

### 4.4 Geometry budgets (enforced by `tests/hole/toy-items.test.ts`)

| Group   | Max triangles | Group    | Max triangles |
| ------- | ------------- | -------- | ------------- |
| bricks  | 500           | toyveh   | 900           |
| figures | 450           | robots   | 900           |
| toys    | 250           | games    | 450           |
| plush   | 700           | outdoor  | 600           |
| dolls   | 450           | store    | 1000          |
|         |               | landmark | 1400          |

Each item is built once and every placement is an instance of it in a `BatchedMesh` (repo rule). Plush sizes are **separate
catalog ids** (different proportions), not a runtime scale of one geometry. Measured (shadows on, layout A, after the
item batching): 22k / 55k / 171k triangles and 28 / 30 / 36 draw calls at level 1 / 8 / 15 (DETAILS.md "Performance").

## 5. Floor plan

All use world axes +X east, +Z south, the camera looks north-up from the south, so **the entrance is on the south
(bottom of the screen) wall**. Coordinates are metres from the floor centre. Zone shares are a target for the points
(each map totals 13 000); if a zone is too dense, grow the zone before cutting items.

### Grand Hall (drawn 240 x 160 m, built 600 x 400 m)

One floor plan. The stockroom (north, the outdoor dock) and the atrium (middle) are fixed; the **eight departments and the
checkout are dealt onto their nine slots at random per seed** (`shuffledLayout` in `map/toy/layouts.ts`). The checkout, the
entrance door and the start take one of the three south-wall slots (left corner, centre, right corner). A department keeps
its mat, shelves, showpieces and points, shifted to its new slot (mirrored across the aisle), so every seed totals 13 000 points.
The table and route below are the seed-less drawing.

Departments around a big atrium. The start (S) sits between the two small-item corners, so level 1-3 can go either way.
Intended route: Brick Alley -> Doll House Lane -> Plush Meadow -> Robot Factory -> Stockroom -> Game Room -> Vroom Row ->
Splash Zone -> Figure Falls, then the Atrium for the last levels (the player can of course go anywhere).

```
 x:-120         -60                              +60         +120
 z:-80 +--------------------------------------------------------+
       |            STOCKROOM / LOADING DOCK                     |
       |  pallets · box stacks · forklifts · trucks · containers |
 z:-55 +-----------+--------------------------------+-----------+
       | ROBOT     |                                | GAME      |
       | FACTORY   |                                | ROOM      |
 z:-25 +-----------+                                +-----------+
       | PLUSH     |           A T R I U M          | VROOM     |
       | MEADOW    |  carousel · Ferris wheel       | ROW       |
       |           |  Big Ted · robot overlord      +-----------+  z:+5
       |           |  brick castle · T-rex · gift   | SPLASH    |
 z:+20 +-----------+                                | ZONE      |
       | DOLL      |                                |           |
       | HOUSE     |                                |           |
 z:+50 +-----------+--------------------------------+-----------+
       | BRICK     |   CHECKOUT + ENTRANCE (south)  | FIGURE    |
       | ALLEY     |   S = start at (-52, 64)       | FALLS     |
 z:+80 +-----------+--------------------------------+-----------+
```

| Zone                     | Rect (x0..x1, z0..z1) | Mat colour     | Signature props (visible from far)                                                  | Tier range | Points share |
| ------------------------ | --------------------- | -------------- | ----------------------------------------------------------------------------------- | ---------- | ------------ |
| Stockroom / Loading dock | -120..120, -80..-55   | concrete       | semi trailer, shipping containers, delivery trucks                                  | 1-19       | 4 %          |
| Robot Factory            | -120..-60, -55..-25   | teal / steel   | rocket_big, spaceship, mech walker                                                  | 1-24       | 11 %         |
| Game Room                | 60..120, -55..-25     | purple         | ball pit, arcade rows, foosball / air hockey                                        | 1-16       | 6 %          |
| Plush Meadow             | -120..-60, -25..20    | pink           | plush throne, panda / bear / rabbit XL lined up, plush pyramids                     | 1-22       | 20 %         |
| Vroom Row                | 60..120, -25..5       | red race mat   | race track loop, kiddie train, ride-on cars, model railway                          | 1-25       | 9 %          |
| Splash Zone              | 60..120, 5..50        | sky blue       | rafts, pool floats (flamingo / swan / whale), bounce house                          | 1-19       | 9 %          |
| Doll House Lane          | -120..-60, 20..50     | lilac          | dollhouse mansion, play castle, tea parties                                         | 1-18       | 7 %          |
| Brick Alley              | -120..-60, 50..80     | yellow         | brick bins, brick car, brick house, big baseplate                                   | 1-12       | 12 %         |
| Figure Falls             | 60..120, 50..80       | green          | figure pyramid, dino diorama, collector cases                                       | 1-10       | 9 %          |
| Checkout + entrance      | -60..60, 50..80       | cream          | gumball machines, balloon bunches, keychain racks, mascot standees                  | 1-8        | 5 %          |
| Atrium                   | -60..60, -55..50      | confetti floor | Big Ted (0, -10), robot overlord, Ferris wheel, brick castle, rocket_giant, statues | 12-25      | 8 %          |

### Test map (60 x 40 m)

`map/toy/minimal.ts` for tests and viewers (like `map/minimal.ts`): one of every size tier in a row, a panda XS->XXL
line-up, a clear start. Not playable content.

**Pacing rule for every seed:** along the intended route, within 40 m of the player there must always be at least
**3x the XP-to-next** of the current level available as items the hole can eat now (XP to next: L1 8 · L2 44 · L3 112 ·
L4 170 · L5 240 · L6 322 · L7 416 · L8 504 · L9 589 · L10 680 · L11 925 · L12 1200 · L13 1505 · L14 1840), plus 1-2 things
that are "too big yet" and teeter. The first 20 s must never starve the player (the start has dozens of tier 1-2 items).

## 6. Open tasks

Conventions for every task: follow the DETAILS.md rules (determinism through `src/shared/rng.ts`; DOM-free `sim/` and
`map/`; never clone geometry or materials per instance; vertex colours + `paint`; no clipping). Definition of done =
`npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run test` green; the relevant viewer checked with a screenshot
(the dev preview pane is slow and throttles `requestAnimationFrame`, so drive the game with `__hole.advance(seconds)`);
README updated in the same change. Workflow: `.claude/skills/hole-content/SKILL.md`. Changing toy item sizes, the point
total or map content needs a bump of `MAP_SCORING_VERSIONS.toy`.

**What is done** (all documented in the DETAILS.md): TS-00 decisions, TS-01 bounds (`MapData.bounds`), TS-02 map registry,
TS-03 per-map catalog, TS-04 per-map scoring version, TS-10 toy kit, TS-11 .. TS-22 all builders (210 types incl. the
panda / brown bear / gray rabbit ladders and 10 more plush families, rafts and floats, robots, rides, landmarks),
TS-23 item viewer (`map=toy`, `family=`), TS-30 .. TS-36 generator, random department slots, reachability test, TS-40 .. TS-42
floor / walls / mood, TS-50 / TS-51 map picker and per-map results, TS-52 sounds, TS-60 / TS-61 / TS-62 tests, balance
and map viewer, TS-63 / TS-64 docs and the `hole-content` skill, TS-65 toy score version 1, TS-66 materials / FX (emissive `glow` parts, per-map swallow puffs), results chart colours + per-map cleared banner, map card pictures, wayfinding (floor
names, chevron trails, wall banners, stockroom carton racks, entrance header sign), the spread-out atrium with Ferris
wheel / carousel pairs (toy score version 3), the menu floor-plan picker.

### Art and look

- [ ] **Item art pass** in `item-viewer.html?map=toy&mode=lineup&gamecam=1`: shelves are terraced now (every row shows from
      the top camera), the nine P2 placeholders have real shapes, the plush octopus / whale got a bow / scarf. Left: look at
      kitten, lion and penguin plush on a device, and the weakest silhouettes (`rc_helicopter`, `ride_on_helicopter`).

### Product

- [ ] **Per-map difficulty times** if real play shows the store is easier / harder than the island (today both use
      Easy 480 / Medium 240 / Hard 120 s; the good bot clears the store in ~195 s vs City Island ~155 s, so ~20 % longer).
      Pace target: level 15 at 120-160 s (now ~110-120 s).
- [ ] **Real-device pass** on iPad / phone for the toy store: 600 x 400 m floor, 9 600 items, camera framing at level 15
      near the walls, adaptive resolution (see TASKS.md real-device pass).

### Phase G - After the first playable (nice to have)

- [ ] Carousel spins, Ferris wheel turns, claw machine arm moves, wind-up robots wiggle (animated static items; keep the
      hot path allocation-free).
- [ ] Walking shoppers / kids as tier-1 people; rolling shopping carts; balloons that float up from checkout.
- [ ] Carry-on items: things sitting on a table fall with it (needs parent / child items in `sim/world.ts`).
- [ ] Night mode ("lights out" store) with glowing arcade screens and robot eyes.
- [ ] Seasonal aisle (holiday decorations) as an alternative zone preset for one department.
- [ ] Hole skins unlocked by clearing the store (confetti rim, rainbow rim).

## 7. Risks and things to watch

- **Density = pace.** Points per m2 decide how fast the bot levels (see D5). Any change to item counts, the floor scale or
  the clustering (`CLUSTER_AREA`, `CLUSTER_SIGMA` in `map/toy/generate.ts`) changes the pace: re-run the bot
  (`balance.html?map=toy`, `tests/hole/toy-map.test.ts` bands).
- **Draw calls.** More types x variants x map cells; re-measure after adding items (`__hole.game.renderer.info.render`).
- **Thin tiers.** Tiers 17, 20, 21 and 23 and levels 10, 11, 13 have only 2 types; the first item cut there breaks the
  "at least 2 per tier / level" tests.
- **Items at the wall.** The toy hole centre may go to `0.15 x D` from the wall (`bounds.inset`); `toy-map.test.ts`
  checks every item stays reachable. Do not raise the inset without re-running it.
- **Coplanar faces.** `Mesher.decoplanar` only fixes axis-aligned boxes; cylinders, tapered boxes and rotated boxes
  must be separated by hand (the clip test names the file:line).
- **Silhouettes at distance.** Plush and robots must read from the game camera, not just in the viewer: always check
  with `gamecam=1` at the item's first hole level.
- **Trademarks.** Generic names only (see the note at the top).
- **Parallel sessions.** Other agents edit this tree: `grep` before adding shared helpers (`kit.ts`, `catalog.ts`,
  `generate.ts`), and re-read a file right before editing it.
