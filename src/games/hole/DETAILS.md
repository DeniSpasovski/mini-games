# Hole Island (working title) - details

> Overview and screenshots: [README.md](README.md). This file holds rules, maps, debug tools and architecture. Map design
> and rosters: [`TOY-STORE.md`](TOY-STORE.md), [`ANIMAL-ISLAND.md`](ANIMAL-ISLAND.md),
> [`CONSTRUCTION-SITE.md`](CONSTRUCTION-SITE.md). UI look: [`STYLEGUIDE.md`](STYLEGUIDE.md).

> **Status: playable, four released maps** (City Island, Toy Emporium, Animal Island, Construction Site; `release.ts`).
> Not done yet: real-device tuning on iPad / phone, enemy holes.

## Pillars

1. **Fits in your hand.** iPad and phones first: one finger steers, every menu works by touch. Keyboard, mouse and
   gamepad work too (the gamepad drives the menus as well).
2. **Blocky but polished.** Box-built models, a small palette, soft sun shadows and good motion (falling, tipping, a
   pulse on level-up).
3. **Readable growth.** You can always see what you can eat next; the camera pulls back as the hole grows, so steering
   feels the same at every level.
4. **Short loop.** Pick a map and a time, play, see your score, play again. No accounts or online features.

## Pages & URLs

| Page        | URL                                                              | Notes                                                                            |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Play        | `/games/hole/`                                                   | menu -> map -> time -> countdown -> play -> results                              |
| Play (dev)  | `/games/hole/?difficulty=hard&level=12&seed=1&color=pink`        | any `difficulty` skips the menu; other params: "Dev params"                      |
| Item viewer | `/games/hole/item-viewer.html?item=bench&mode=compare&slow=0.25` | every edible item **and** the hole ("Debug tools"); `map=`, `family=plush_panda` |
| Map viewer  | `/games/hole/map-viewer.html?seed=1&overlay=1&tier=0&level=8`    | regenerate a map, districts, content budget, click to inspect, "Play from here"  |
| Balance     | `/games/hole/balance.html?difficulty=all&runs=8&skill=good`      | headless bot runs, level / score vs time charts, level table; `map=` any map     |

All tool-page values are kept in the URL (`src/shared/url-state.ts`). Press `H` to hide the left panel and `F3` for stats.

### Dev params (play page)

`map=city|toy|animal|construction` · `difficulty=easy|medium|hard` (skip the menu) · `time=<seconds>` · `level=<start level>` ·
`seed=<map seed>` · `color=<ocean|lime|pink|orange|violet|cyan|red|gold>` · `x=&z=` (start position) · `bot=1` (autopilot) ·
`debug=1` (debug HUD) · `quality=low|high` · `mute=1`. Runs with `time`, `level` or `bot` are **not** saved to the top 10.

Testing from an iPad / phone: `npm run dev -- --host`, then open `http://<your-LAN-ip>:3000/games/hole/`. The domain lock
allows private-network addresses in the dev server only (`isDevLanHost` in `src/site.config.ts`).

## Game flow

- **Welcome**: Play, Hole colour, Top scores, Options, How to play, About and the game version (`game.json`) over an
  orbiting aerial view where a bot-driven hole is already eating.
- **Hole colour**: 8 preset swatches, picked on the real 3D demo hole; saved.
- **Pick a map** (2x2 picker, remembered in `hole.settings`). Each map has its own top 10 and scoring version.
- **Pick your time**: above the time buttons sits the seed stepper (`‹ Island #7 ›`, `🎲 Random`, seeds 1-999, saved as
  `settings.seed`; entering from the map picker rolls a random seed). Every seed holds the same points, so one top 10 per
  map and time covers all seeds. `?seed=` wins over the saved choice. The three times are shared by every map:

  | Difficulty | Time  | Notes                                                        |
  | ---------- | ----- | ------------------------------------------------------------ |
  | Easy       | 480 s | enough time to eat the whole map and collect the clear bonus |
  | Medium     | 240 s | a good run reaches the top level around 2/3 of the way       |
  | Hard       | 120 s | fast scoring; the highest levels are a stretch goal          |

- **Countdown** 3-2-1 while the camera flies from the aerial view down to the hole.
- **Pause**: big top-right button, `Esc` / `P`, or the page going to the background (`visibilitychange` / `pagehide`).
  Resume, Restart, Options, Main menu.
- **Time up**: the hole freezes, falling items finish, then **Results**. Eating everything early ends the run with the
  clear bonus.
- **Results**: score, level, items eaten, % eaten, items per size tier, and the top 10 with your run highlighted (a run
  outside it shows under a gap). Play again / Main menu.
- **Persistence** (localStorage via `game/storage.ts`, every access in try/catch with an in-memory fallback):
  - `hole.settings`: colour, volume, quality, last difficulty, last map, seed
  - `hole.scores.<map>.easy|medium|hard`: top 10 `{ score, level, eaten, pct, color, date, ver }`, by score, ties to the
    higher level, then the earlier date. No player names (one device = one player).

## Controls

| Input        | Action                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touch (main) | **Floating joystick**: touch anywhere to set the origin, drag to steer. Drag length up to `maxDragPx` (70 CSS px) sets speed, 6 px dead zone; dragging further pulls the origin along, so reversing is instant. Lifting the finger stops quickly. |
| Mouse        | Same as touch (click and drag)                                                                                                                                                                                                                    |
| Keyboard     | `WASD` / arrows steer at full speed · `Esc` / `P` pause                                                                                                                                                                                           |
| Gamepad      | Left stick steers (analogue, `PAD_DEAD_ZONE` in `game/stick.ts`) · d-pad full speed · Start pause. Menus: d-pad / stick focus, A select, B back, right stick scrolls, left / right step sliders (`shared/pad-nav.ts`, `Menu.padNav`)              |
| Debug (play) | `F2` debug HUD (needed for the keys below) · `F8` bot · `+` / `-` level · `T` freeze timer · `F4` eat rings · `F9` save portal thumbnail (dev server)                                                                                             |
| Dev touch    | **3-finger tap** toggles the debug HUD                                                                                                                                                                                                            |

The joystick works in screen space and is turned into a world direction with the camera yaw (`stickToWorld`; the camera
is fixed north-up), so "drag up" always means "away from the camera".

Mobile web setup: the play page sets `user-scalable=no, viewport-fit=cover` (`rsbuild.config.ts`; tool pages keep pinch
zoom); `game/ios.ts` blocks gestures, double-tap and the context menu; the HUD uses `env(safe-area-inset-*)`; targets are
at least 44 px; WebAudio resumes on the first touch; `apple-mobile-web-app-capable` for "Add to Home Screen".

## Core rules

All of this lives in DOM-free `sim/` code, so tests and the balance bot run it in node. `sim/progression.ts` is the single
source of the numbers below; the balance page shows the live table.

### Hole levels and size tiers

- **Size tiers 1–25** describe how big an item is and set its **points**. A tier-`t` item is at most
  `0.9 · 40^((t-1)/24)` m (0.9 m at tier 1, 36 m at tier 25).
- **Hole levels 1–15** (`ITEM_LEVELS`) each unlock one size tier: **1, 4, 8, 10, 12, 14** (big jumps, a fast early game),
  then 16, 18, 19, 20 and every tier 21–25.
- **Hole levels 16–25** (`GROWTH_LEVELS`) unlock nothing: the hole only grows **x1.075 per level** (`holeDiameter`), so
  late sweeps are wider and faster. XP to leave level 15 is `TUNING.growthXpFirst` (800), +`growthXpStep` (80) per
  level; reaching level 25 needs most of a map.
- The hole is always **wider than what it can swallow**: `D = maxEdible / SIZE_RULES.fit` (0.75). **XP to next level** =
  `points(level's tier) × items(level)`, with `items` rising linearly from `TUNING.itemsFirst` (8) to `itemsLast` (46).

| Lvl | Size tier | Diameter m | Eats size ≤ m | Points of that tier | Items to fill | XP to next | Cumulative XP | Camera dist m | Full speed m/s |
| --- | --------- | ---------- | ------------- | ------------------- | ------------- | ---------- | ------------- | ------------- | -------------- |
| 1   | 1         | 1.20       | 0.90          | 1                   | 8             | 8          | 0             | 10            | 7.2            |
| 2   | 4         | 1.90       | 1.43          | 4                   | 11            | 44         | 8             | 12            | 7.9            |
| 3   | 8         | 3.52       | 2.64          | 8                   | 14            | 112        | 52            | 16            | 9.5            |
| 4   | 10        | 4.79       | 3.59          | 10                  | 17            | 170        | 164           | 20            | 10.8           |
| 5   | 12        | 6.51       | 4.88          | 12                  | 20            | 240        | 334           | 24            | 12.5           |
| 6   | 14        | 8.85       | 6.64          | 14                  | 23            | 322        | 574           | 31            | 14.9           |
| 7   | 16        | 12.04      | 9.03          | 16                  | 26            | 416        | 896           | 39            | 18.0           |
| 8   | 18        | 16.37      | 12.28         | 18                  | 28            | 504        | 1312          | 51            | 22.4           |
| 9   | 19        | 19.09      | 14.31         | 19                  | 31            | 589        | 1816          | 58            | 25.1           |
| 10  | 20        | 22.26      | 16.69         | 20                  | 34            | 680        | 2405          | 66            | 28.3           |
| 11  | 21        | 25.96      | 19.47         | **25**              | 37            | 925        | 3085          | 76            | 32.0           |
| 12  | 22        | 30.27      | 22.70         | **30**              | 40            | 1200       | 4010          | 88            | 36.3           |
| 13  | 23        | 35.30      | 26.47         | **35**              | 43            | 1505       | 5210          | 101           | 41.3           |
| 14  | 24        | 41.16      | 30.87         | **40**              | 46            | 1840       | 6715          | 117           | 47.2           |
| 15  | 25        | 48.00      | 36.00         | **50**              | -             | 800        | 8555          | 135           | 54.0           |
| 16  | -         | 51.60      | all           | -                   | -             | 880        | 9355          | 145           | 57.6           |
| 17  | -         | 55.47      | all           | -                   | -             | 960        | 10235         | 155           | 61.5           |
| 18  | -         | 59.63      | all           | -                   | -             | 1040       | 11195         | 166           | 65.6           |
| 19  | -         | 64.10      | all           | -                   | -             | 1120       | 12235         | 178           | 70.1           |
| 20  | -         | 68.91      | all           | -                   | -             | 1200       | 13355         | 191           | 74.9           |
| 21  | -         | 74.08      | all           | -                   | -             | 1280       | 14555         | 205           | 80.1           |
| 22  | -         | 79.63      | all           | -                   | -             | 1360       | 15835         | 219           | 85.6           |
| 23  | -         | 85.61      | all           | -                   | -             | 1440       | 17195         | 235           | 91.6           |
| 24  | -         | 92.03      | all           | -                   | -             | 1520       | 18635         | 252           | 98.0           |
| 25  | -         | 98.93      | all           | -                   | -             | max        | 20155         | 271           | 104.9          |

Camera distance `7 + 3.2 · D/REF_SCALE` (times the portrait factor) and full-stick speed `6 + 1.2 · D/REF_SCALE` m/s,
with `REF_SCALE = 0.9 / fit` = 1.2 (`cameraDistance`, `moveSpeed`). The Toy Emporium caps the hole at level 15
(`MapDef.maxLevel`).

### Size and the eat rule

- Each item has one gameplay **size** in metres: `size = max(width, depth, height × 0.25)` (`SIZE_RULES.heightFactor`).
  Footprint matters most; height counts a little, so a lamp post isn't eaten as early as a soda can.
- An item **can be eaten** when `size ≤ D × 0.75`. Its **tier** is the first size tier that fits it, its **first hole
  level** the first level that eats it. The catalog stores only dimensions; size, tier, level and points are derived
  (`sizeOverride` / `pointsOverride` for special cases), so a new item never needs hand-picked points.
- An item **commits to falling** once its ground pivot is within `D/2 − 0.15·size` of the hole centre and it can be eaten.
- **Too big**: the hole slides under it (never blocked) and the item **teeters** (up to about 6° with a spring wobble).
- The hole **can't leave the map**: its centre is clamped to the coast inset by `0.5 · D` (walled maps: `bounds.inset`,
  0.15 · D, so it may bulge over the wall), and the outward velocity is dropped so it slides along the edge.

### Falling (scripted, no physics engine)

`sim/fall.ts`: a deterministic per-item state machine `idle → tipping → falling → gone`.

- **tipping** (0.16–0.36 s): leans towards the hole (40° for small items, 10° for items that nearly fill the hole, never
  more than `atan(0.4·D / height)` so tall tops don't swing out) while sliding half-way in.
- **falling**: slides to the centre and sinks (ease-in) over `0.55 + 0.22·√height` s (max 3 s), with a seeded yaw spin
  for small items. Tall buildings sink instead of tumbling.
- **gone**: the instance is hidden.
- **Points and XP are awarded on commit**, so feedback is instant and items still falling at time-up count.
- Items vanish into the hole because the hole is cut out of the ground with a stencil ("How the hole is drawn").

### Scoring and growth

- **Points per item** = points of its size tier: 1–20 for tiers 1–20, then **25, 30, 35, 40, 50** for tiers 21–25. Points
  never depend on the hole level.
- **XP = points.** A level-up animates the diameter to the new size (time constant 0.18 s), so items at the rim fall in.
  Level 25 is the cap; after that XP only adds score.
- **Clear bonus** (every item eaten before time runs out): **+10 points per remaining second**; the run ends at once.
- **Leftover rings**: once fewer than `LEFTOVER_POINTS` (100) are left, every remaining item gets a pulsing ground ring
  and tiny items are drawn regardless of size (`render/leftover-rings.ts`).
- **% eaten** (results and HUD) = points eaten ÷ the map's point total (`MapDef.points`).

#### High scores and the scoring version

The version is **per map** (`MAP_SCORING_VERSIONS` in `game/scores.ts`), saved as `hole.scores.version` (city) and
`hole.scores.version.<map>`. When a saved version differs from the code, that map's entries are kept and tagged with the
version they were set on (`migrateScores`, `ScoreEntry.ver`). The scores screen lists current entries first, then a
divider and the older ones, dimmed; the menu "best" counts the current version only.

**Whenever scoring logic changes, bump the version of the map it affects** (and add a line to the history comment):
item points or sizes, the map's point total or content (its generator), the clear bonus, the difficulty times, or how a
run is scored (`sim/sim.ts`). Shared rules (`sim/`, tier table, clear bonus, times) bump every map. Rebalancing the XP
curve, speed or camera needs no bump.

### Moving items

A placement with a `move` spec (`MoveSpec` in `map/types.ts`: kind, home, leash, speed, optional path end and start delay,
`flee`) becomes a **mover**. `sim/world.ts` keeps mover state in struct-of-arrays and a **dynamic spatial hash**
(`relocate(i)` re-buckets only when an item crosses an 8 m cell). `sim/movers.ts` steps them from `Sim.step` before
`commitItems`: DOM-free, one seeded Rng and a fixed order, so the bot, the tests and the game agree.

- **Behaviours** (`MoveKind`): `wander` (random spot inside the leash, idle 1-4.5 s), `hop` (arcs), `crawl` (very slow),
  `skitter` (short fast dashes), `flutter` (0.3-0.9 m up, bobbing), `swim` (water cells only), `trail` (ants: home <->
  a second point, staggered by `delay`), `patrol` (the same with long idles), `roam` (giants: slow, gentle turns, long
  idles), `drive` and `stroll` (below). Herds are `wander` movers that share a home and leash.
- **Ground rules** (Animal Island): `MapData.walk`, a 2 m `WalkGrid` (0 blocked, 1 land, 2 water). Walkers need land,
  swimmers water, flutterers anything but sea; the target and the straight line to it must be clear.
- **Awake set**: only movers within 1.6 × the camera distance of the hole **and** big enough to be seen from there
  (`size × 150` m) move. Depends on the hole only, never on the camera, so it is deterministic.
- **Speed cap**: no mover is faster than 0.5 × the full speed of the hole level that first eats it.
- **Flee** (`FLEE` in `sim/movers.ts`): an animal the hole can eat walks away from it. Bugs and giants never flee
  (`flee: false`). A too-big mover stops and teeters; a committed mover freezes and falls like any item.
- **Rendering** (`render/item-instances.ts`): movers get their own culling cells on a 32 m grid (`CELL_MOVERS`); only
  movers that moved are rewritten (`world.moving`); `world.lift` raises hops, flutters and a small walking bounce.
- **The bot leads moving targets** (`Bot.intercept`: aims at `p + v * t`, lead capped at 1.5 s).
- **City Island and Construction Site** drive vehicles on a road graph (`MapData.roads`, `RoadNet`; `sim/roads.ts`):
  - `drive`: right-hand lane (`LANE`); before a crossing pick an exit (straight 4 : turn 1.5, dead ends turn round), brake
    for a vehicle in front, and creep on after 3 s held up so a stand-off clears. Cars **never sleep** (a frozen car
    would let the queue behind it merge into it) and never flee. Curb-parked cars have no `move`.
  - `stroll` (City people): walk the block's sidewalk ring corner to corner (`RING_CORNERS`), sometimes turning back;
    park / beach pedestrians `wander`, plaza and lot ones stand. `map/city-movers.ts` assigns them after generation with
    its own Rng, so the layout and the points never change. People face +Z (`Movers.face`), animals and vehicles +X.
- Not done: leg animation and herd followers ([`ANIMAL-ISLAND.md`](ANIMAL-ISLAND.md) "Open tasks").

### Movement

- Full-stick speed `6 + 1.2 · D/1.2` m/s (`TUNING.speedBase`, `speedPerMetre`).
- Short acceleration (0.12 s) and deceleration (0.08 s), no inertia slide. The sim runs at a fixed 60 Hz; the hole is
  interpolated for rendering.

### Balance

Tuned with the headless bot (`sim/bot.ts`, "Balance" page). Targets for the good bot on every map: Hard reaches level
10+, Medium reaches level 15 well before the end, Easy clears the map with time to spare. The bands live in
`tests/hole/sim.test.ts` and each map's `*-map.test.ts`. Humans on touch are slower than the bot; tune with real players.

## Camera

- Perspective, FOV 50°, critically-damped follow (0.09 s), north-up from the south (`render/camera-rig.ts`).
- **Distance** `cameraDistance(D)`, eased (0.35 s) on level-up. **Pitch** 52° at level 1 to 64° at level 15 (70° at 25),
  steeper so tall items don't hide the hole.
- **Portrait**: distance × `max(1, (1.4 / aspect)^0.6)`, so the visible world width doesn't collapse.
- The hole rim is also drawn last with depth test off, so the hole never hides behind a building; nearer surfaces fade
  ("Building fade").
- The shadow camera follows the focus with a texel-snapped box that grows with the camera distance.

## Map: City Island

`map=city`, generated by `map/generate.ts` from a seed (`src/shared/rng.ts` / `noise.ts`). World axes: +X east, +Z south.

| Part         | How it is built                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island shape | radius 255 m ± noise; a **harbour bay** at a seeded angle with a headland each side; 3-5 seeded headlands and inlets (own RNG); 16 m sand band                                                        |
| Road grid    | **10 × 10 tiles** (`tiles`), 50 m pitch: 40 m blocks (3 m sidewalk + 34 m lot) and 10 m roads. A block is built when all four corners are on the island                                               |
| Core         | the central 2×2 blocks: the `landmark_tower` and three downtown towers                                                                                                                                |
| Downtown     | blocks within a noise-warped 80 m ring: one skyscraper each, meters / bollards / pedestrians, taxis, a tram                                                                                           |
| Commercial   | within 135 m (warped), plus a seeded **avenue** of commercial blocks out to 195 m: apartment blocks, shops, offices, school, gas station, or one big building (garage, tower, hotel)                  |
| Residential  | four lots per block: houses / townhouses, fences with a gate gap, hedges, driveway car, mailbox, shed, trees                                                                                          |
| Parks        | 5 blocks (the first near the centre): fountain plaza, playground or woods                                                                                                                             |
| Canal        | one seeded road line is **water instead of asphalt** out to the coast; its crossings are bridges. Zone `water`: only rowboats. The hole crosses it freely (the water is stencil-cut like the ground)  |
| Streets      | lamp posts, hydrants, trash cans, bus stops, billboards, a traffic light or street sign on every crossing corner, curb-parked cars, one **driving** vehicle per road segment, **walking** pedestrians |
| Beach        | chairs, umbrellas, palms, huts, lifeguard towers, rowboats, stands                                                                                                                                    |
| Harbour      | quay (+ render-only pier), crates, boats, delivery trucks, water towers, lighthouse on the opposite headland                                                                                          |
| Edge blocks  | blocks that don't fit become lawn with trees, bushes, grass and flowers                                                                                                                               |

**Exact point total: `tiles² × pointsPerTile` = 10 × 10 × 300 = 30 000** for every seed (`targetPoints`). The generator
lays the island out, then `balancePoints` trims small scatter items if it came out too rich, or first runs an **enrich
pass** (`ENRICH`: bushes, trees, planters, benches ... until `ENRICH_LEFT` of the target is missing, so the map is not
padded with thousands of grass tufts) and tops up with small items until the total is exact. The start area is never
trimmed.

**Content budget** (`tests/hole/map.test.ts`, shown in the map viewer): exact points; every size tier 1–25 and hole level
1–15 has ≥ 2 item types placed; every type up to tier 20 is placed (`ensureAllTypes`); total ≥ 2 × the XP to level 15, so
Easy can clear it; a busy start.

### Map generation rules (City Island)

1. **Every item has spawn zones.** `map/spawn.ts` (`makeZoneMap`) splits the ground into `road` (asphalt, crossings,
   zebras), `sidewalk` (the 3 m ring round a block), `lot`, `park`, `beach` (sand band, quay) and `lawn` (the rest). The
   `SPAWN` table has **one row per City item** with the zones its centre may be in (a test fails on a missing or stale row).
2. **Only vehicles touch the road.** Items whose row lists `road` may stand on asphalt; every other item keeps its whole
   rotated footprint off it (`footprintHalf` / `ZoneMap.touchesRoad`). Bus and tram are `road` only; the curb lane is the
   road at 21 m from the block centre.
3. **One guard decides.** `tryPut` (`map/generate.ts`) rejects a placement that breaks its row (`spawnViolation`), leaves
   the island or overlaps something (`Occupancy`). Fixed layouts that call `put` directly must be positioned so they pass.
4. **Random placers sample a zone of the item**: `spotFor(c, id)` picks one of its zones, `spotIn(c, zone)` a point in it.
   `ensureAllTypes`, the enrich pass and the top-up all use them.
5. **Order** (`generateCity`): coast → blocks and districts → roads → zone map → ground rects → lots → sidewalk furniture,
   pedestrians, curb cars → traffic → beach → harbour → edge nature → litter → `ensureAllTypes` → start →
   `balancePoints`.
6. **Adding an item**: add its `SPAWN` row with its catalog row and place it through `tryPut` / `spotFor`
   (`tests/hole/spawn.test.ts` checks every placement on 5 seeds).

**Random start (every map).** `map/start.ts` `pickStart(map, rnd)` samples spots inside the playfield (not on water, no
item the level 1 hole can't eat under it, enough tier 1-3 items close by; best of 300 tries, falls back to `map.start`).
`?x=&z=` forces a start; the menu demo, the bot, the balance page and the tests keep `map.start`.

## Map: Toy Emporium

`map=toy`: one closed rectangular floor (`MapData.bounds`) at about 5× real scale (a brick is 16 cm, a robot 14 m), so the
hole sizes and the camera match City Island. Generated by `map/toy/generate.ts`; `map/toy/layouts.ts` holds the "Grand
Hall" plan (drawn 240 × 160 m, built `FLOOR_X` × `FLOOR_Z` = 220 × 160 m) and deals the eight departments, checkout and
door onto the floor slots per seed (`shuffledLayout`). Design and roster: [`TOY-STORE.md`](TOY-STORE.md).

| Part       | How it is built                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Floor      | pastel 10 m checker, one coloured mat per department with a tape border, door mat and guide line; textured per zone (`render/toy-floor.ts`: carpet, polka dots, brick studs, waves, tiles ...) |
| Walls      | non-edible, item material so the building fade dithers them: tall on three sides (stockroom carton racks, window band, bunting), low on the camera side with the entrance and its sign         |
| Wayfinding | render-only (`render/toy-signs.ts`): department names painted on the floor, chevron trails from the door, name banners on the side walls                                                       |
| Zones      | Stockroom, Robot Factory, Game Room, Plush Meadow, Vroom Row, Splash Zone, Doll House Lane, Brick Alley, Figure Falls, Checkout, Atrium; each fills its `share` of the points                  |
| Fill       | per zone: showpieces, one of every big item, shelf rows, then type quotas (points^`beta`) placed in clusters with empty floor between; whale / penguin plush stock the Splash Zone             |
| Atrium     | Big Ted at the end of the central aisle, robots and the railway behind, two Ferris wheels and two carousels either side of the aisle                                                           |
| Very big   | a type of tier ≥ `VERY_BIG_TIER` is placed at most `MAX_VERY_BIG_COPIES` times and each seed keeps about `VERY_BIG_KEEP` of them (at least 2 per tier)                                         |

**Exactly 9 000 points per seed** (`balancePoints`: trims small items away from the start or tops up with 1-point fillers);
9 000 just covers the XP to level 15, which is this map's cap. Catalog: `items/catalog-toy.ts` with builders
`build-plush.ts` (one parametric rig, 13 families; panda, brown bear and gray rabbit in six sizes), `build-toys.ts`,
`build-toyveh.ts`, `build-landmarks.ts`, recipes in fractions of w × d × h (`kit-toy.ts`). Toy builders run with
`Mesher.decoplanar`: a box face in the plane of an earlier box face is pulled in 5.8 mm so nothing z-fights.

## Map: Animal Island

`map=animal`: a round island of animals, from ants and ladybugs to **37 giant animals** (16 types, tiers 20-25) bred by a
secret laboratory. Hills are edible items; rivers and ponds are water the hole crosses freely. Generated by
`map/animal/generate.ts`. Design, roster and open tasks: [`ANIMAL-ISLAND.md`](ANIMAL-ISLAND.md).

| Part     | How it is built                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island   | radius 210 m ± coast noise and headlands / inlets, 14 m sand band                                                                                                                                                               |
| Biomes   | seeded angular sectors warped by noise: meadow (+ farm), wetland, forest, jungle, the compound, savanna; a highlands disc in the middle and a beach ring (`map/animal/biomes.ts`, a 2 m grid holds land / water / biome)        |
| Rivers   | a main river from the highlands to the wetland coast, a stream joining it, wetland ponds, a savanna waterhole, a hippo pool; water cells are code 2 of the walk grid                                                            |
| Hills    | `hill_great` (1 copy) near the middle and hill clusters of flattened domes from `molehill` to `hill_30` (at most 50 terrain hills, `CAP`); static, nothing stands on them                                                       |
| Compound | the sector between jungle and savanna: zoo pens and the giant **paddock** (cage bars, 14 giants) on the far side, the laboratory (HQ, hangar, domes, tower, reactor, vats, helicopter, staff, jeeps) behind an electric fence   |
| Farm     | barn, hay bales, beehives and a fence ring in the meadow (pigs, hens, chicks)                                                                                                                                                   |
| Fill     | a per-tier point budget (`TIER_FRACTION`) shared by the types of each tier (`planCounts`), biggest first; most small items gather round hotspots (`HOT_SHARE`); herds, ant trails, patrols; then `ensureTypes`, `balancePoints` |
| Start    | the meadow spot with the most tier 1-3 items close by plus a ring of tiny things (`startPoint`); random starts need many tier 1 items close by because a level 1 hole eats tier 1 only                                          |

**Exactly 21 000 points per seed** (enough for level 25 near a full clear). Items keep `3 + 0.15 × size` m from the coast
so the biggest hole can reach them. Catalog: `items/catalog-animal.ts` (183 own types + the 9 City greenery items in
`SHARED_CITY_IDS`), builders `build-animals.ts` (rigs: quadruped, hopper, bird, insect, reptile, ape, slug, crab; `*_big`
/ `*_giant` / `lab_*` reuse the rig with a glowing collar), `build-nature.ts`, `build-zoo.ts`. They run in
`Mesher.fitted(w, d, h, ...)`: designed by proportion and scaled so the built size equals the catalog size. Very small
animals have fewer details (parts under ~4 mm cannot be clip-free).

## Map: Construction Site

`map=construction`: a fenced 540 × 420 m building site, from bricks and cones to haul trucks, tower cranes and high-rises.
Design, roster and open tasks: [`CONSTRUCTION-SITE.md`](CONSTRUCTION-SITE.md).

| Part      | How it is built                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan      | `map/construction/layout.ts`: 12 m gravel haul roads, 6 × 5 plots in 9 districts (`District` in `items/catalog-construction.ts`); the open-pit mine is one road-free area            |
| Generator | `map/construction/generate.ts`: showpieces, per-tier point budget (`TIER_FRACTION`), small items round work spots, `ensureAllTypes`, start scatter, `balancePoints` (exactly 21 000) |
| Movers    | workers `wander`; vans, pickups, dump and mixer trucks `drive` the road graph; haul trucks and forklifts `patrol` a reserved straight path                                           |
| Ground    | `render/construction-ground.ts`: dirt base + checker, district rects, roads, mine terraces, skirt, hoarding (item material, low on the gate side), district names on the floor       |
| Start     | the Site Gate plot                                                                                                                                                                   |

Catalog: `items/catalog-construction.ts`, builders `build-site.ts` (materials, tools, crew, site furniture, heaps) and
`build-machines.ts` (plant, trucks, cranes, mining, buildings), helpers in `kit-site.ts`; `Mesher.decoplanar`. Machines run
along X (front +X), workers face +Z.

### Per-map sounds and puffs

`MapDef.puffs` picks the swallow-puff palette (`render/puffs.ts`, `PUFF_PALETTES`): dust (city), confetti (toy; plush
always burst into white stuffing), fur and leaves (animal), rubble (construction). `Sfx.gulp(tier, group)` picks the
sound by item group: squeak (plush, bugs, critters), clack (bricks, toys, materials, tools), honk (toy vehicles, robots),
boing (inflatables), grunt (animals), thud (hills, rocks, heaps), clank (zoo, lab, machines).

## Art style

- **Blocky.** Everything is built in code from boxes, a few low-sided cylinders and cones, and faceted balls / eggs /
  domes ("Round parts"). No bevels, flat shading, chunky proportions.
- **Vertex colours** carry all colour (`items/kit.ts`, palette `PAL`). Parts marked `paint` take a per-instance colour
  through a shader patch (`render/materials.ts`); their vertex colour is white.
- **Window tiles**: buildings use one of three 16×16 pixel-art window textures (`punched`, `ribbon`, `glass`, nearest
  filter, 1 tile per 3 m × 3.2 m). No other item textures.
- **Glow**: a part with `{ glow: true }` writes paint attribute 2; the material adds its vertex colour on top of the
  lighting (`vGlow`), for screens, lamps and robot eyes. Attribute 1 = "takes the instance colour".
- **Glass**: a part with `{ glass: true }` writes paint attribute 3; the material drops every other screen pixel
  (`GLASS_FRAGMENT`, so batches stay opaque), and `findBuried` ignores it as an occluder. Parts inside a glass shell must
  not rest on solid discs (use `caps: false` rings).
- **Ambient occlusion feel**: vertex colours darken over the bottom 20 % (max 4 m) of every item.
- **Lighting**: warm sun with one 2048 shadow map, hemisphere light, light fog; outdoor maps add a gradient sky dome
  (`mood.skyTop`). `low` quality turns shadows off, caps the pixel ratio at 1.5 and drops antialiasing. No tone mapping.
- **Triangle budgets** per item group are enforced by `tests/hole/items.test.ts` and the `toy-` / `animal-` /
  `construction-items` tests. Each item is built once and every placement is an instance in a `BatchedMesh`.
- **No clipping** (`tests/hole/clip.test.ts` and the per-map clip tests, checker `debug/clip-check.ts`): no two faces
  that point the same way may share a plane (within 4 mm) and overlap (z-fighting), and no box / cylinder may be
  completely hidden inside the model. The failure names the builder `file:line` (`Mesher.trace`). When building: decals
  and panels sit 1-3 cm proud, parts meeting at a corner differ by a few mm, wheels stick out (`WHEEL_OUT`), glass bands
  use `glassBand()`.

## Assets

### City Island catalog

`size` = `max(w, d, h·0.25)`; `Tier` = size tier; `Pts` = its points. The viewers show the live values and the first hole
level. Changing a size can change the tier and points: bump `MAP_SCORING_VERSIONS.city`.

| Tier | Pts | id                   | Group       | w × d × h (m) | size | District(s)                 | Notes                                          |
| ---- | --- | -------------------- | ----------- | ------------- | ---- | --------------------------- | ---------------------------------------------- |
| 1    | 1   | `soda_can`           | litter      | 0.12×0.12×0.2 | 0.12 | everywhere                  | 3 colour variants                              |
| 1    | 1   | `litter_paper`       | litter      | 0.3×0.3×0.05  | 0.30 | streets, parks              | crumpled box, white/beige                      |
| 1    | 1   | `trash_bag`          | litter      | 0.6×0.5×0.6   | 0.60 | streets, by dumpsters       | black/green, knot on top                       |
| 1    | 1   | `trash_can`          | street      | 0.6×0.6×1.0   | 0.60 | sidewalks, parks            | lid, 2 variants                                |
| 1    | 1   | `flower`             | nature      | 0.25×0.25×0.4 | 0.25 | parks, residential          | 5 petal colours (instanceColor)                |
| 1    | 1   | `grass_tuft`         | nature      | 0.5×0.5×0.3   | 0.50 | parks, verges, beach edge   | 3 crossed blades                               |
| 1    | 1   | `traffic_cone`       | street      | 0.4×0.4×0.7   | 0.40 | streets, roadworks          | stepped cone, white stripe                     |
| 1    | 1   | `fire_hydrant`       | street      | 0.45×0.45×0.8 | 0.45 | sidewalks                   | red/yellow                                     |
| 1    | 1   | `pedestrian`         | people      | 0.5×0.35×1.75 | 0.50 | sidewalks, plazas, beach    | 6 colour combos; strolls the sidewalk ring     |
| 1    | 1   | `parking_meter`      | street      | 0.3×0.3×1.3   | 0.33 | downtown curbs              |                                                |
| 1    | 1   | `bollard`            | street      | 0.3×0.3×0.9   | 0.30 | plazas                      |                                                |
| 1    | 1   | `street_sign`        | street      | 0.6×0.1×2.5   | 0.63 | crossings                   | stop / parking / one-way plates (palette)      |
| 1    | 1   | `newspaper_box`      | street      | 0.6×0.5×1.1   | 0.60 | downtown                    |                                                |
| 2    | 2   | `mailbox`            | street      | 0.95×0.5×1.2  | 0.95 | residential                 | post box + house mailbox variants              |
| 2    | 2   | `bush_small`         | nature      | 1.0×1.0×0.8   | 1.00 | residential, parks          | two faceted balls                              |
| 2    | 2   | `planter`            | street      | 1.0×1.0×0.7   | 1.00 | plazas, shopfronts          | box with flowers on top                        |
| 2    | 2   | `shopping_cart`      | street      | 1.0×0.6×1.0   | 1.00 | parking lots                |                                                |
| 2    | 2   | `wooden_crate`       | harbour     | 1.0×1.0×1.0   | 1.00 | harbour, shops              |                                                |
| 3    | 3   | `lamp_post`          | street      | 0.35×0.35×4.5 | 1.13 | every sidewalk              |                                                |
| 3    | 3   | `phone_booth`        | street      | 1.1×1.1×2.4   | 1.10 | downtown                    |                                                |
| 3    | 3   | `vending_machine`    | street      | 1.1×0.8×1.9   | 1.10 | shopfronts, beach           |                                                |
| 3    | 3   | `flower_bed`         | nature      | 1.2×1.2×0.4   | 1.20 | parks                       | soil box + flower balls                        |
| 4    | 4   | `statue`             | park        | 1.3×1.3×3.0   | 1.30 | plaza, parks                | plinth + blocky figure                         |
| 4    | 4   | `recycling_bins`     | street      | 1.4×0.7×1.2   | 1.40 | residential                 | 3 coloured bins                                |
| 4    | 4   | `bush_large`         | nature      | 1.4×1.4×1.2   | 1.40 | residential, parks          |                                                |
| 5    | 5   | `traffic_light`      | street      | 1.5×0.4×4.5   | 1.50 | crossings                   | short arm                                      |
| 5    | 5   | `tree_small`         | nature      | 1.6×1.6×3.5   | 1.60 | streets, residential        | egg crown / 3 balls / small pine (3 variants)  |
| 5    | 5   | `beach_chair`        | beach       | 1.6×0.6×0.8   | 1.60 | beach                       | striped (instanceColor)                        |
| 6    | 6   | `bench`              | park        | 1.8×0.6×0.9   | 1.80 | parks, sidewalks, beach     | wood slats + metal legs                        |
| 6    | 6   | `picnic_table`       | park        | 1.8×1.6×0.8   | 1.80 | parks                       |                                                |
| 6    | 6   | `scooter`            | vehicle     | 1.8×0.7×1.1   | 1.80 | streets                     | moped                                          |
| 6    | 6   | `palm_tree`          | nature      | 1.8×1.8×7.0   | 1.80 | beach                       | segmented trunk, cross leaves, coconut balls   |
| 6    | 6   | `beach_umbrella`     | beach       | 1.9×1.9×2.3   | 1.90 | beach                       | 4 colours                                      |
| 7    | 7   | `fence_section`      | residential | 2.1×0.1×1.2   | 2.10 | residential                 | picket; placed in rows along lots              |
| 7    | 7   | `hedge`              | nature      | 2.1×0.8×1.2   | 2.10 | residential, parks          | rows                                           |
| 7    | 7   | `dumpster`           | street      | 2.1×1.2×1.3   | 2.10 | alleys, commercial          | green/blue                                     |
| 7    | 7   | `hotdog_stand`       | street      | 2.2×1.2×2.3   | 2.20 | plazas, beach               | cart + umbrella                                |
| 8    | 8   | `lifeguard_tower`    | beach       | 2.5×2.5×4.0   | 2.50 | beach                       | stilts + hut                                   |
| 8    | 8   | `bus_stop`           | street      | 2.6×1.4×2.5   | 2.60 | main roads                  | shelter + bench                                |
| 8    | 8   | `tree`               | nature      | 2.6×2.6×6.0   | 2.60 | parks, residential          | stacked balls / cloud of 4 / pine (3 variants) |
| 9    | 9   | `fountain`           | park        | 3.0×3.0×1.8   | 3.00 | plaza, parks                |                                                |
| 9    | 9   | `playground_slide`   | park        | 3.0×1.0×2.2   | 3.00 | parks                       |                                                |
| 9    | 9   | `swing_set`          | park        | 3.0×2.0×2.2   | 3.00 | parks                       |                                                |
| 10   | 10  | `car_compact`        | vehicle     | 3.5×1.7×1.5   | 3.50 | everywhere (parked)         | 6 paint colours                                |
| 10   | 10  | `rowboat`            | harbour     | 3.5×1.4×0.8   | 3.50 | beach, harbour, canal       | sits on sand                                   |
| 11   | 11  | `garden_shed`        | residential | 4.0×3.0×2.8   | 4.00 | residential                 |                                                |
| 11   | 11  | `billboard`          | commercial  | 4.0×0.6×6.0   | 4.00 | main roads                  | pixel ad panels (atlas)                        |
| 12   | 12  | `car_sedan`          | vehicle     | 4.2×1.8×1.5   | 4.20 | everywhere (parked)         | 6 paint colours                                |
| 12   | 12  | `taxi`               | vehicle     | 4.2×1.8×1.6   | 4.20 | downtown                    | yellow, roof sign                              |
| 12   | 12  | `police_car`         | vehicle     | 4.8×1.9×1.7   | 4.80 | downtown                    | light bar                                      |
| 12   | 12  | `kiosk_shop`         | commercial  | 4.5×4.5×3.2   | 4.50 | plazas, beach               | awning                                         |
| 13   | 13  | `van`                | vehicle     | 5.5×2.0×2.3   | 5.50 | commercial                  |                                                |
| 13   | 13  | `pickup`             | vehicle     | 5.4×2.0×1.9   | 5.40 | residential                 |                                                |
| 13   | 13  | `beach_hut`          | beach       | 5.5×5.0×4.0   | 5.50 | beach                       | stilts, striped walls                          |
| 13   | 13  | `tree_big`           | nature      | 5.5×5.5×10    | 5.50 | parks                       | oak-style crown of 4 balls / big pine (2 var.) |
| 14   | 14  | `water_tower`        | harbour     | 6×6×14        | 6.00 | harbour, commercial         | legs + tank                                    |
| 14   | 14  | `lighthouse`         | harbour     | 6×6×20        | 6.00 | headland                    | red/white bands                                |
| 14   | 14  | `delivery_truck`     | vehicle     | 6.5×2.4×3.4   | 6.50 | commercial, harbour         |                                                |
| 15   | 15  | `food_truck`         | vehicle     | 7.5×2.4×3.2   | 7.50 | plazas, beach               |                                                |
| 15   | 15  | `speedboat`          | harbour     | 7.5×2.5×2.0   | 7.50 | harbour slipway             | on trailer                                     |
| 16   | 16  | `house_small`        | residential | 8.0×7.0×6.0   | 8.00 | residential                 | hip or gable roof (2 variants), 4 wall colours |
| 16   | 16  | `fire_truck`         | vehicle     | 8.5×2.5×3.2   | 8.50 | fire station lot            | ladder                                         |
| 17   | 17  | `bus`                | vehicle     | 10×2.5×3.2    | 10.0 | main roads, depot           |                                                |
| 17   | 17  | `house`              | residential | 9.5×9.0×8.0   | 9.50 | residential                 | 2 floors, garage, hip or gable roof (2 var.)   |
| 17   | 17  | `corner_shop`        | commercial  | 10×8×5        | 10.0 | commercial                  | awning, sign                                   |
| 18   | 18  | `townhouse_row`      | residential | 12×8×9        | 12.0 | residential/commercial edge | 3 colourful units                              |
| 18   | 18  | `tram`               | vehicle     | 12×2.6×3.4    | 12.0 | downtown                    | drives the road graph                          |
| 18   | 18  | `gas_station`        | commercial  | 12×9×5        | 12.0 | ring road                   | canopy + pumps (one asset)                     |
| 19   | 19  | `apartment_block`    | building    | 14×12×15      | 14.0 | commercial ring             | 5 floors, window atlas                         |
| 19   | 19  | `shop_row`           | building    | 14×10×8       | 14.0 | commercial ring             | 2 floors, 3 shopfronts                         |
| 20   | 20  | `office_lowrise`     | building    | 16×16×22      | 16.0 | downtown edge               | 6 floors                                       |
| 20   | 20  | `school`             | building    | 16×12×9       | 16.0 | residential                 | clock, yard                                    |
| 21   | 25  | `parking_garage`     | building    | 19×18×12      | 19.0 | commercial                  | open decks, cars inside are part of the mesh   |
| 21   | 25  | `apartment_tower`    | building    | 18×18×40      | 18.0 | downtown edge               |                                                |
| 22   | 30  | `hotel`              | skyscraper  | 22×18×50      | 22.0 | downtown, beachfront        | rooftop sign                                   |
| 22   | 30  | `skyscraper_slim`    | skyscraper  | 20×20×80      | 20.0 | downtown                    |                                                |
| 23   | 35  | `skyscraper_glass`   | skyscraper  | 26×24×90      | 26.0 | downtown                    | blue glass atlas                               |
| 23   | 35  | `skyscraper_stepped` | skyscraper  | 24×24×100     | 25.0 | downtown                    | art-deco setbacks                              |
| 24   | 40  | `skyscraper_tall`    | skyscraper  | 28×28×120     | 30.0 | downtown                    |                                                |
| 24   | 40  | `skyscraper_twin`    | skyscraper  | 30×22×110     | 30.0 | downtown                    | two towers + sky bridge                        |
| 25   | 50  | `skyscraper_needle`  | skyscraper  | 22×22×128     | 32.0 | downtown centre             | spire; height decides the tier                 |
| 25   | 50  | `skyscraper_mega`    | skyscraper  | 32×32×140     | 35.0 | downtown centre             |                                                |
| 25   | 50  | `landmark_tower`     | skyscraper  | 34×30×135     | 34.0 | downtown centre             | the island's signature building, 1 copy        |

Builders share the `Mesher` in `items/kit.ts`: `box()` (taper, window UVs, paint flag), `cyl()` (cylinder / cone, any
axis), `gable()`, `hip()`, `ball()` and `xf()` for local transforms. Each item merges into one non-indexed geometry with
its pivot at the ground centre. Vehicles run along X and face +X; people and facades face +Z.

**Round parts.** `ball(cx, cy, cz, rx, ry, rz, color, opts)` is a faceted ellipsoid: `seg` / `rings` (default by size from
`roundDetail`; triangles = 2 × seg × (rings − 1)), `taper` (egg), `half` (dome on its base, `bottom` closes it), `jitter` +
`seed` (seeded radius noise), `paint` / `glow` like `box()`. Odd ring counts have no equator row, so builders use `blob()`
(`build-small.ts`, takes a bounding box like `box()`), which widens the radii to keep the catalog size.

### Non-edible assets

All of the City dressing is **render-only**: `render/city-decor.ts` derives it from the map data with its own seeded RNG,
so it never changes placements or points. Curbs and decals are stencil-cut ground, built as 96 m chunks so the camera
only draws the cells it sees.

| Asset            | Notes                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island ground    | one merged mesh: grass + 10 m checker, sand band, coast skirt, stencil-cut material (`render/ground.ts`; other maps: `render/map-ground.ts` picks the builder) |
| Roads            | asphalt, yellow dashes, zebra crossings at both ends of every road arm                                                                                         |
| Curbs            | an 11 cm raised kerb on the road side of every sidewalk                                                                                                        |
| Roundabouts      | grass island + plaza ring + dashed lane ring on the four-arm crossings nearest the centre                                                                      |
| Road decals      | stop lines, lane arrows before crossings (right-hand traffic), manholes, parking-bay ticks around curb-parked cars                                             |
| Sidewalks / lots | flat rects: sidewalk, plaza / concrete / lawn / park lots, park paths, play sand, harbour quay                                                                 |
| Coast            | low-poly rocks (one instanced mesh) along the coast except at the harbour, and a plank pier off the quay                                                       |
| Water            | flat plane below the skirt, two drifting ripple layers and a breathing foam ring (`render/water.ts`, `userData.animate(seconds)` every frame)                  |
| Sky              | outdoor maps: gradient dome (`Environment.dome`, horizon = fog colour, re-centred on the camera). The toy store has none                                       |

### The hole

| Part              | Notes                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stencil mask disc | writes stencil = 1 at ground level, no colour or depth (`render/hole-mesh.ts`, `createMaskMaterial`)                                                                                         |
| Interior walls    | open cylinder (BackSide), depth `1.5 + 0.8·D`: a thin soil lip, then the hole colour fading to black; a black bottom disc                                                                    |
| Rim ring          | flat ring in the chosen colour just above the ground (width capped in metres, so big holes keep a slim rim) plus an always-on-top overlay; breathes and glows, kicks on every item swallowed |
| Level-up          | two rings expand and fade, the glow flashes, a pale disc fades out over the hole (`flash`)                                                                                                   |
| Swallow puff      | 6-12 cubes where an item falls in, sized by the item (`render/puffs.ts`, one pooled InstancedMesh, ring buffer)                                                                              |
| Building fade     | surfaces nearer the camera than the hole and within 1.8× its screen radius dither out (`FADE_FRAGMENT`, uniforms from `render/hole-fade.ts`). Off in the menu                                |
| Score pop-up      | DOM "+N" at the projected item position, coloured by tier                                                                                                                                    |
| Colour presets    | Ocean `#2f80ff` · Lime `#7ed321` · Pink `#ff3d9a` · Orange `#ff8a00` · Violet `#8b5cf6` · Cyan `#19d3da` · Red `#ff3b30` · Gold `#ffc800`                                                    |

**How the hole is drawn (stencil):** (1) the mask disc writes stencil 1 inside the hole circle. (2) **Every ground
material** draws only where stencil ≠ 1 (`applyHoleCut` in `render/materials.ts`), cutting a real opening; that includes
the sea and the toy store's void plane, which would otherwise show through and make the hole look like a pond. (3) The
walls and bottom show through the opening. (4) Items draw normally; below y = 0 the ground hides them everywhere except
over the opening, so they seem to drop into the hole. The renderer is created with `stencil: true`.

### UI

DOM + CSS only (`game/hud.ts`, `game/menu.ts`, `game/hole.css`, tokens and fonts in `game/ui-tokens.css`, icons in
`game/icons.ts`); look and components in [STYLEGUIDE.md](STYLEGUIDE.md). Screens: welcome, map picker, time picker,
colour, top 10, options, how to play, about (creator and credits, text from `shared/about.ts`), pause, results. HUD: timer, score, completion plate, level badge with
progress ring and "eats up to", pause button, joystick ring, countdown, "+N" pop-ups, "LEVEL N" and cleared banners. The
results headline and cleared banner use the map accent (`data-map` on the root, `--hg-map`); the menu map tiles show
`screenshots/menu-<map>.jpg` (640 × 360).

### Audio

`game/audio.ts` (`Sfx`): a WebAudio oscillator synth layered with CC0 impact samples (`assets/sounds/*.ogg`, imported
as URLs, about 200 KB). Fetched + decoded right after the first gesture (`unlock()`); a sample that is missing or fails
leaves its voice on the synth alone. `?mute=1` never creates the context, so no file is requested.

- `gulp(tier, group)`: item group -> voice (`GROUP_VOICE` -> `VOICES`: squeak, clack, honk, grunt, thud, clank, tool,
  heavy, boing, plain). A random sample per voice, `playbackRate` falls 6 % per tier (+-6 % random), the synth voice stays
  underneath at `synth` x gain (0 for pure impacts). 35 ms merge as before.
- `roar()`: three slowed impacts + the synth growl. `levelUp()`: bell sample up a major arpeggio + quiet synth chime.
  `horn()`, `beep()`, `click()`, `tick()` are synth only (no licence-clean horn found).
- Samples: Kenney "Impact Sounds" (CC0), 20 unmodified OGG files from the CC0 GitHub repo
  [Boyquotes/kenney-impact-sounds-for-godot](https://github.com/Boyquotes/kenney-impact-sounds-for-godot) (licence: CC0-1.0).
  No attribution needed; listed in `THIRD-PARTY.md`.
- Hygiene: at most 24 sample voices at once, playback rate floored at 0.4, nodes disconnect on `ended`, the context suspends
  while the tab is hidden, a failed sample load is retried on the next `unlock()`. Test: `tests/hole/audio.test.ts`.

## Debug tools

Every tool page uses `src/shared/debug-panel.ts` (left menu), `url-state.ts` and `stats-overlay.ts` (F3). The item and map
viewers share `debug/viewer-shell.ts`: renderer, lights and the stencil-cut ground are the **same** as in the game.

### Item viewer – `item-viewer.html` (items and the hole)

- `map=toy|animal|construction` switches the catalog; `family=plush_panda` limits the lineup to ids containing the text.
- **List:** `Hole` at the top, then every catalog item grouped by level, with a filter box.
- **Modes** (`mode=`): `single` (the item next to a hole of its first level, running the real sim), `compare` (a
  level-(L−1) hole that teeters and a level-L hole that eats), `lineup` (every item or one `tier=` in a row by size, with
  labels and a pedestrian for scale), `hole` (only the hole with scale references).
- **Actions:** Drop, Slide across (teeter test), Level-up at the rim, Reset, Stress test N×N (read the F3 box), Copy item JSON.
- **Overlays:** bounds box, size ring (yellow) and fit ring (green, `D × SIZE_RULES.fit`), wireframe, 1 m grid, **game
  camera preview** in an iPad landscape / portrait or phone frame (`gamecam=1&frame=phone-portrait`).
- **Size rules preview** (not saved): sliders for `SIZE_RULES.fit` / `heightFactor` and a size / points override; they call
  `rederiveCatalog()` and count the items that land on another hole level. URL `fit`, `hf`, `size`, `pts`; "Copy size
  rules" gives the numbers for `SIZE_RULES_DEFAULT` or a catalog row.

### Map viewer – `map-viewer.html`

- `map=` any map; the island sliders (seed, radius, coast noise, parks, litter, district radii) are City Island only.
- Overlays: districts / departments, "show only tier N", road network, trail / patrol / stroll paths; on Animal Island
  biomes, walk grid, leash circles and paths (`biomes`, `walkgrid`, `leash`, `paths`).
- Click an item to inspect it; click the ground to move the red marker (drawn at the hole size of the chosen level).
- **Content budget box:** item count, total points against the map's target, thin tiers, items and points per tier,
  movers per behaviour, start position.
- **Game camera** at the marker for level L; **Play from the red marker** opens `./?seed=&x=&z=&level=&difficulty=medium`.

### Balance – `balance.html`

- Runs the headless sim (same `sim/` code) with the bot over N seeds per difficulty; skill `casual` / `good` / `perfect`.
- Output: level p10 / median / p90, score, items, % eaten, cleared count, level and score over time, the live level table,
  "Copy results as JSON".
- The **Tuning** panel edits every `TUNING` knob live, mirrors them in the URL as `t_<name>`, and "Copy tuning" gives the
  object to paste back into `progression.ts`.

### In-game debug (play page)

- `F2` / 3-finger tap: debug HUD (state, level, diameter, XP, score, items left, speed, position, stick and camera values,
  sliders for camera distance / pitch and the joystick). With it on, the joystick prints its vector next to the finger.
- `F4` (or the HUD button): eat-rule rings round the nearest idle items (`debug/eat-rings.ts`), green = edible now, red =
  too big, labelled with the item's hole level.
- Console: `__hole.benchmark(240)` (average and worst ms per frame incl. GPU, works with the tab hidden),
  `__hole.advance(seconds)` (steps without animation frames), `__hole.sim`, `__hole.setLevel(n)`.
- **Screenshots** (README, menu cards): open `quality=high&mute=1`, pose with `__hole.setLevel(n)`, `__hole.sim.hole.x / z`
  and `__hole.game.rig.snap()`, grab `__hole.game.captureCanvas()`, draw it into a 1280 × 720 (menu cards 640 × 360)
  canvas and POST the JPEG data URL to `/__dev/thumbnail?game=hole` (the `F9` endpoint; it writes
  `src/games/hole/thumbnail.jpg`, so move the file into `screenshots/` and restore the portal thumbnail).

### Tests – `tests/hole/` (rstest, node)

| Test                                                       | Checks                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `progression`                                              | diameter growth, points table, XP curve, eat rule, tier derivation                                                                        |
| `items`, `toy-items`, `animal-items`, `construction-items` | ≥ 2 types per tier / level, builders match the catalog size (footprint ±15 %, height ±10 %), on the ground, paint lists, triangle budgets |
| `clip`, `toy-clip`, `construction-clip`                    | no z-fighting faces, no buried parts (animal: inside `animal-items`)                                                                      |
| `map`, `toy-map`, `animal-map`, `construction-map`         | deterministic, exact points, every type placed, tiers / levels covered, busy start, reachability, balance bands                           |
| `spawn`                                                    | City `SPAWN` rows and zone rules on 5 seeds                                                                                               |
| `start`                                                    | random starts                                                                                                                             |
| `movers`                                                   | leash, ground rules, determinism, spatial hash, flee, speed cap, a 2 500-mover tick                                                       |
| `sim`                                                      | eating, teeter, level-up carry, clamp, clear bonus, time-up, fall determinism, identical bot runs, balance bands                          |
| `game`, `input`, `settings`                                | joystick maths, top 10 order and cut-off, settings storage                                                                                |
| `kit-ball`, `item-instances`, `city-decor`, `puffs`        | round primitive, batch culling + the three.js internals it relies on, render-only dressing, puff pool                                     |
| `release`                                                  | every registered map is listed once in `release.ts`                                                                                       |

Slow playtests are in `integration-tests/hole/`: `city-movers` (cars stay on the asphalt and don't stack, strollers stay
on the ring) and `balance`.

## Architecture

```
src/games/hole/
  game.json, release.ts      pages; which maps ship (MAPS_LIST)
  pages/                     play.ts, item-viewer.ts, map-viewer.ts, balance.ts
  sim/                       DOM-free + three-free: tests, bot and balance page run it in node
    progression.ts             D(L), points, XP, camera / speed formulas, TUNING (single source of truth)
    eat.ts, fall.ts            commit radius, teeter; idle -> tipping -> falling -> gone
    world.ts                   item instances (struct-of-arrays) + 8 m spatial hash
    movers.ts, roads.ts        moving items, awake set, flee; road graph for drive
    sim.ts                     fixed step: hole motion, clamp, commit, XP / level-up, score, clear bonus, events
    bot.ts                     greedy autopilot + runBot()
  items/
    catalog.ts                 ItemDef table (City) + per-map lists; size / tier / level / points derived
    catalog-toy|animal|construction.ts   the other maps' catalogs
    kit.ts                     Mesher (box / cyl / gable / hip / ball, transforms, vertex colours, window UVs) + palette
    kit-toy.ts, kit-site.ts    fraction-based recipe helpers
    build-*.ts                 procedural builders (City: small, vehicles, buildings; toy: plush, toys, toyveh,
                               landmarks; animal: animals, nature, zoo; construction: site, machines)
    builders.ts                registry + geometry cache
  map/
    types.ts                   MapData, coast / bounds helpers
    registry.ts                MapDef per map (generator, points, mood, menu camera, puffs, maxLevel)
    generate.ts, spawn.ts, city-movers.ts   City Island generator, spawn zones, movers
    start.ts, minimal.ts       random start; tiny map for viewers / tests
    toy/, animal/, construction/   each map's generator (+ layouts.ts / biomes.ts / layout.ts)
  render/
    renderer.ts                renderer (stencil on), quality tiers, lights, fog, shadow box
    materials.ts               item materials (window tiles, paint / glow / glass), stencil cut, building fade
    map-ground.ts              picks ground.ts / toy-ground.ts / animal-ground.ts / construction-ground.ts; soup.ts builds the triangles
    city-decor.ts, water.ts, toy-floor.ts, toy-signs.ts   render-only dressing
    hole-mesh.ts, hole-fade.ts, puffs.ts, leftover-rings.ts   the hole and its effects
    item-instances.ts          BatchedMesh per material style + shadow flag, own culling, LOD
    camera-rig.ts              follow camera, distance / pitch per level, portrait factor
  game/
    hole-game.ts               menu <-> run loop, fixed step + interpolation, events -> HUD / audio
    input.ts, stick.ts         joystick + keyboard + pad; the maths is separate and tested
    hud.ts, menu.ts, dom.ts, icons.ts, hole.css, ui-tokens.css
    scores.ts, settings.ts, storage.ts   localStorage with an in-memory fallback
    audio.ts, ios.ts
  debug/                     viewer-shell.ts, station.ts (item + hole running the real sim), clip-check.ts, eat-rings.ts
tests/hole/, integration-tests/hole/
```

### Performance

Targets: 60 fps on an iPad (A12 or newer), 30+ fps on a mid-range phone, pixel ratio capped at 2 (1.5 on `low`). Measure
with `__hole.benchmark(240)`; real-device numbers are still open (`TASKS.md`).

- **Batched items** (`render/item-instances.ts`): every item of one material style (`prop`, `punched`, `ribbon`, `glass`)
  and shadow flag (size ≥ 0.5 m casts) is one `BatchedMesh`, drawn with one multi-draw call per pass
  (`WEBGL_multi_draw`; without it three.js falls back to one draw per item).
- **Own culling** (`ItemBatch.cull`): instances are added cell by cell (64 m, 32 m for movers), so a cell is a contiguous
  id range. One frustum test per cell, visible cells sorted front to back, and a per-item sphere test only in cells that
  cross the frustum edge.
- **Level of detail** (`setView`, with the rig distance): items smaller than distance × `TINY_K` (about 2 px) are not
  drawn, smaller than distance × `SHADOW_TINY_K` cast no shadow. Viewers skip it.
- **Paint**: per-instance colours are the batch colour texture; the `paint` patch covers `instanceColor` and
  `getBatchingColor`. `tests/hole/item-instances.test.ts` fails if a three.js upgrade renames the internals it relies on.
- **Partial matrix upload** (`ItemBatch.setMatrix` / `flushMatrixRows`): after the first render only changed texture rows
  are sent (a full upload when over half changed).
- **One layout read per frame** for the "+N" pop-ups (`handleEvents`).
- **Adaptive resolution** (`adaptResolution` in `game/hole-game.ts`): a smoothed frame time above 24 ms steps the render
  scale down (floor 70 %); below 18 ms for 6 s it steps back up.
- **Idle frame cap**: menus, pause and results render at ~30 fps.
- If a device is too slow, in this order: raise `TINY_K` / `SHADOW_TINY_K`, cheaper shadows on `low`, merge the road
  dashes / zebras into a texture, cheaper round parts (`roundDetail`).

## Feature iterations

- **Enemy holes**: AI holes that eat the same items; you eat smaller ones, bigger ones eat you. Keep `sim/` ready (hole
  state in a list) and the bot as the base for enemy AI.
- More moving content (boats, stoplight rhythm, kids on playgrounds, spinning carousels) is a `MoveSpec` away.
- More maps: a `MapDef` in `map/registry.ts` + a generator (`hole-content` skill).
- Rigid-body falling (Rapier) if mobile performance allows; combo multiplier, time pickups, power-ups.
- Initials on high scores, online leaderboard, daily seed; hole skins unlocked by score; night mode with glowing windows.
- Rotating camera (two-finger twist) as an option.

## Open questions

- Final game name (the placeholder "Hole Island" avoids the trademark).
- Should XP stay equal to points, or follow a volume-based curve?
