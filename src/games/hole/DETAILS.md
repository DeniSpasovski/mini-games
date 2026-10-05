# Hole Island (working title) - details

> Overview and screenshots: [README.md](README.md). This file holds the details.

A simple game in which you play the role of gravity hole eating the world around you, built with three.js. You steer a hole
around a blocky toy-city island and swallow everything that fits. Each thing you eat makes the hole bigger. It starts
at trash cans and flowers and ends at skyscrapers. You play against the clock, and the score goes on a top-10 list for
each difficulty.

> **Status: v0 playable, three maps** (City Island, Toy Emporium and **Animal Island**, see "Map: Animal Island"). Menus, run loop, scoring, top 10, touch controls, **City Island** (83 item types)
> and **Toy Emporium** (a giant toy store, 210 item types, see "Map: Toy Emporium"), the item viewer, the map viewer and
> the balance page all work. Not done yet (see [`TASKS.md`](TASKS.md), [`TOY-STORE.md`](TOY-STORE.md)): real-device
> tuning on iPad / phone, enemy holes.

## Pillars

1. **Fits in your hand.** Made for iPad and phones first. One finger steers, and every menu works by touch. Keyboard
   and mouse are only for desktop testing.
2. **Blocky but polished.** Simple box-built models, a small colour palette, soft sun shadows and good motion (falling,
   tipping, a pulse on level-up). Detail stays low, but it should feel finished.
3. **Readable growth.** You can always see what you can eat next. The camera pulls back as the hole grows, so steering
   feels the same at level 1 and level 15.
4. **Short loop.** Start, pick a difficulty, play, see your score, play again. No accounts or online features in v0.

## Pages & URLs

| Page        | URL                                                              | Notes                                                                                   |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Play        | `/games/hole/`                                                   | menu -> difficulty -> countdown -> play -> results                                      |
| Play (dev)  | `/games/hole/?difficulty=hard&level=12&seed=1&color=pink`        | any `difficulty` skips the menu. Other params: see "Dev params"                         |
| Play (toy)  | `/games/hole/?map=toy&layout=a&difficulty=medium`                | Toy Emporium; `layout=a\|b\|c` picks the floor plan                                     |
| Item viewer | `/games/hole/item-viewer.html?item=bench&mode=compare&slow=0.25` | every edible item **and** the hole (see "Debug tools"). `map=toy`, `family=plush_panda` |
| Map viewer  | `/games/hole/map-viewer.html?seed=1&overlay=1&tier=0&level=8`    | regenerate the island, districts, content budget, click to inspect, "Play from here"    |
| Balance     | `/games/hole/balance.html?difficulty=all&runs=8&skill=good`      | headless bot runs, level / score vs time charts, level table                            |

All tool-page values are kept in the URL (`src/shared/url-state.ts`). Press `H` to hide the left panel and `F3` for stats.

### Dev params (play page)

`map=city|toy|animal` · `layout=a|b|c` (toy store floor plan) · `difficulty=easy|medium|hard` (skip the menu) · `time=<seconds>` · `level=<start level>` · `seed=<map seed>` ·
`color=<ocean|lime|pink|orange|violet|cyan|red|gold>` · `x=&z=` (start position) · `bot=1` (autopilot) · `debug=1`
(debug HUD) · `quality=low|high`. Runs with `time`, `level` or `bot` are **not** saved to the top 10.

Testing from an iPad / phone: `npm run dev -- --host`, then open `http://<your-LAN-ip>:3000/games/hole/`. The domain lock
allows private-network addresses in the dev server only (`isDevLanHost` in `src/site.config.ts`); production builds do
not.

## Game flow

- **Welcome** shows Play, Hole colour, Top scores and Options (plus the game version from `game.json`, just under the
  card; also on How to play) over a slowly orbiting aerial view of the island, where a
  bot-driven hole is already eating its way around.
- **Hole colour**: pick from 8 preset swatches (CSS preview of the hole; the in-world hole changes too). Saved, and
  pre-selected next time.
- **Pick a map** (Play -> map picker, remembered in `hole.settings`): City Island, Toy Emporium or Animal Island. Each map has its own
  top 10 and its own scoring version (`MAP_SCORING_VERSIONS` in `game/scores.ts`).
- **Pick difficulty**: above the time buttons sits the **map variant**: City Island has an island seed stepper
  (`‹  Island #7  ›` and `🎲 Random`, seeds 1-999, saved as `settings.seed`), the Toy Emporium has its three floor plans as
  tabs (Grand Hall / Ring Walk / Warehouse Sale, saved as `settings.layout`); the menu background shows the pick. Every
  seed holds the same points, so one top 10 per map and difficulty covers all islands (the toy layouts share one list
  too; layout B is a fast run and C a slow one, see TOY-STORE.md). `?seed=` / `?layout=` in the URL win over the saved
  choice (dev links). The setting is the time limit (same three times on every map):

  | Difficulty | Time  | Notes                                                          |
  | ---------- | ----- | -------------------------------------------------------------- |
  | Easy       | 500 s | enough time to eat the whole island and collect the time bonus |
  | Medium     | 250 s | a good run reaches skyscrapers around 2/3 of the way           |
  | Hard       | 100 s | fast scoring; the highest levels are a stretch goal            |

  Each card shows your best score for that difficulty.

- **Countdown** 3-2-1 while the camera flies from the aerial view down to the hole, then **Play**.
- **Pause** is a large button in the top-right corner (also `Esc` / `P`). Moving the page to the background
  (`visibilitychange` / `pagehide`) pauses too. The pause menu has Resume, Restart, Options and Main menu.
- **Time up**: the hole freezes, items that are already falling finish falling, then the **Results** screen opens. If
  every item is eaten early, the run ends with an **Island cleared** bonus (see Scoring).
- **Results** shows the score, level reached, items eaten, % of the island eaten, a bar chart of items eaten per size
  tier and the **top 10 for that difficulty** with your run highlighted. A run outside the top 10 shows under a gap.
  Buttons: Play again (same difficulty) and Main menu.
- **Persistence** (localStorage; every access is wrapped in try/catch and falls back to memory, so private mode works):
  - `hole.settings`: colour, volume, quality, last difficulty, last map, island seed, toy floor plan
  - `hole.scores.<map>.easy|medium|hard` (`city`, `toy`): top 10 `{ score, level, eaten, pct, color, date }`, sorted by
    score. Ties go to the higher level, then the earlier date.
  - No player names in v0 (one device = one player). Initials are listed under iterations.

## Controls

| Input        | Action                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touch (main) | **Floating joystick**: touch anywhere to set the origin, drag to steer. Direction sets heading; drag length up to `maxDragPx` (70 CSS px) sets speed. A 6 px dead zone stops jitter. Dragging further than `maxDragPx` drags the origin along, so reversing is instant. Lifting the finger stops the hole quickly (0.08 s, no drift). A ring and dot show the origin and the drag. |
| Mouse        | Same as touch (click and drag), for desktop testing                                                                                                                                                                                                                                                                                                                                |
| Keyboard     | `WASD` / arrows steer at full speed · `Esc` / `P` pause                                                                                                                                                                                                                                                                                                                            |
| Debug (play) | `F2` debug HUD (needed for the keys below) · `F8` bot · `+` / `-` level · `T` freeze timer · `F9` save portal thumbnail (dev server) · `F3` stats is not on the play page, use `__hole.benchmark()`                                                                                                                                                                                |
| Dev touch    | **3-finger tap** toggles the debug HUD (iPad has no F keys)                                                                                                                                                                                                                                                                                                                        |

The joystick works in **screen space** and is turned into a world direction (`stickToWorld`, with the camera yaw, which
is fixed north-up in v0), so "drag up" always means "away from the camera". It is the same in portrait and landscape.

Mobile web setup (done): viewport meta `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no,
viewport-fit=cover` (set per page in `rsbuild.config.ts`, hole pages only), `touch-action: none`, `user-select: none`,
`-webkit-touch-callout: none`, `overscroll-behavior: none`, `gesturestart` / double-tap / context-menu blocked
(`game/ios.ts`), HUD uses `env(safe-area-inset-*)`, targets are at least 44 px, WebAudio is resumed on the first
touch, `apple-mobile-web-app-capable` so "Add to Home Screen" runs full screen. `navigator.vibrate` doesn't exist on
iOS, so there is no haptic feedback.

## Core rules

All of this lives in DOM-free `sim/` code, so tests and the balance bot run it in node.

### Hole levels (25) and size tiers (25)

There are two ladders:

- **Size tiers 1–25** describe how big an item is. The tier decides the item's **points** (below). A tier-`t` item is at
  most `0.9 · 40^((t-1)/24)` m (0.9 m at tier 1, 36 m at tier 25).
- **Hole levels 1–15** are what the player sees. Each level can eat everything up to one size tier: levels 1–6 use tiers
  **1, 4, 8, 10, 12, 14** (big jumps, so the early game levels up quickly), then 16, 18, 19, 20, and finally every
  tier 21–25 (one level each, so the skyscraper tiers stay separate).
- **Hole levels 16–25** (`GROWTH_LEVELS`) unlock **nothing new**: level 15 already eats every item. They only keep
  growing the hole, **x1.075 per level** (48 m at level 15 → ~99 m at level 25, `holeDiameter`), so late sweeps are
  wider and faster and the camera pulls back further. They are fed by the points already on the map: XP to leave level 15
  is `TUNING.growthXpFirst` = 800, +80 per level (`growthXpStep`), 11 600 XP for all ten (cumulative 20 155 to level 25),
  so reaching level 25 needs most of a map to be eaten. Levels 1–15 (tiers, diameters, XP, camera, speed) are unchanged.

The hole is always **wider than what it can swallow**: `D = maxEdible / 0.75` (`SIZE_RULES.fit`), so the biggest thing a level can
eat fills at most 75 % of the hole's width. Diameter goes from 1.2 m (level 1) to 48 m (level 15). **XP to next level** is
`points(level's tier) × items(level)`, where `items(level)` is how many items of that tier fill the bar: 8 at level 1,
rising linearly to 46 at level 14 (`TUNING.itemsFirst` / `itemsLast`). Every item you eat adds its own points as XP.
The numbers below come straight from `sim/progression.ts`; the balance page shows the live table.

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

Camera distance is `7 + 3.2 · D/1.2` (times the portrait factor, see Camera) and full-stick speed is `6 + 1.2 · D/1.2`
m/s: both use the diameter divided by 1.2, so the bigger hole (the fit rule used to be 0.9) is also bigger on screen and
the view and speed are unchanged. They are single formulas in `sim/progression.ts`; the XP curve and speed are `TUNING`
knobs.

### Size and the eat rule

- Each item has one gameplay **size** in metres: `size = max(width, depth, height × 0.25)`. Footprint matters most, and
  height counts a little, so a lamp post isn't eaten as early as a soda can and skyscrapers sit in the top tiers.
- An item **can be eaten** when `size ≤ D × 0.75` (`SIZE_RULES.fit`), i.e. when it is at most `maxEdible(level)`. Its **tier** is the
  first size tier that fits it, and its **first hole level** is the first level that can eat it. The catalog stores the
  dimensions, and size, tier, level and points are derived from them, so a new item never needs hand-picked points. An
  override field exists for special cases (`sizeOverride`, `pointsOverride`).
- An item **commits to falling** once its centre (ground-plane pivot) is within `D/2 − 0.15·size` of the hole centre
  and it can be eaten.
- **Too big**: the hole slides under it (the hole is never blocked). The item **teeters**, tilting up to about 6°
  toward the hole with a spring wobble, then settles when the hole leaves. Teetering shows "you can't eat this yet"
  without any extra UI.
- The hole **can't leave the island**. Its centre is clamped to the coastline inset by `0.5 · D` (so it never overlaps
  the water), and the outward velocity is dropped so it slides along the coast. Water and ground are never eaten.

### Falling (scripted, no physics engine in v0)

Each item has a small state machine in `sim/fall.ts`, deterministic (seeded per item) and DOM-free:
`idle → tipping → falling → gone`.

- **tipping** (0.16–0.36 s): the item leans towards the hole (up to 40° for small items, 10° for items that nearly fill
  the hole, and never more than `atan(0.4·D / height)` so the top of a skyscraper doesn't swing out) while sliding
  half-way in.
- **falling**: the item slides to the hole centre and sinks (ease-in) over `0.55 + 0.22·√height` seconds (max 3 s) with
  a seeded yaw spin for small items. Tall buildings sink instead of tumbling.
- **gone**: after `tipTime + fallTime` the instance is hidden (zero scale).
- **Points and XP are awarded when the item commits** (starts tipping), so feedback is instant and items already falling
  at time-up are counted. Items keep falling after the hole moves away; a level-up during a fall doesn't change it.
- Why the item disappears into the hole: the hole is cut out of the ground with a stencil mask (see "How the hole is
  drawn"). Below y = 0 the ground hides the item everywhere except over the opening.
- A real rigid-body physics engine (Rapier) is listed under iterations. The scripted version is cheaper on mobile and
  easier to tune.

### Scoring and growth

- **Points per item** = points for its **size tier**: 1–20 for tiers 1–20 (most items), then **25, 30, 35, 40, 50** for
  tiers 21–25 (parking garage / apartment tower → skyscrapers). Points never depend on the hole level, only on how big
  the item is.
- **XP = points**. Each item eaten fills the level bar with its points. Levelling up animates the diameter to the new
  size (exponential approach, time constant 0.18 s), so items at the rim fall in as the hole grows. Level 25 is the cap;
  after that XP only adds score.
- **Island cleared bonus** (100 % of the island eaten before time runs out): **+2 points per remaining second**. The run
  ends immediately with the bonus. Easy (500 s) is the difficulty where this normally happens.
- Results also show **% eaten**, by points: points eaten ÷ total island points (City Island 30 000, Toy Emporium 25 000). The HUD shows the same percentage live.
- Combos and multipliers are not in v0 (see iterations).

#### High scores and the scoring version

High scores are only comparable while the scoring rules stay the same. The version is **per map**
(`MAP_SCORING_VERSIONS` in `game/scores.ts`: `city` = `SCORING_VERSION`, `toy`) and saved next to the lists
(`hole.scores.version` for the city, `hole.scores.version.toy`); **when the game opens and a saved version differs from
the code, that map's top-10 lists are erased** (`purgeStaleScores`, also true for lists saved before versions existed).
Changing one map never erases the other map's scores.

**Whenever scoring logic changes, bump the version of the map it affects** (and add a line to the history comment). A
change to shared rules (tier table, clear bonus, difficulty times, `sim/sim.ts`) bumps every map. That means any change
to: item points or size tiers (`sim/progression.ts`, item dimensions in `items/catalog.ts`), the clear bonus, the
difficulty times, how a run is scored (`sim/sim.ts`) or how much content the map holds (`map/generate.ts`, e.g. `tiles` or `pointsPerTile`). Pure
rebalancing of the XP curve, speed or camera does not change what a score means and needs no bump.

### Moving items (Animal Island)

Items can move. A placement with a `move` spec (`MoveSpec` in `map/types.ts`: kind, home, leash, speed, optional path
end and start delay, `flee`) becomes a **mover**: `sim/world.ts` keeps its state in struct-of-arrays (`isMover`,
`mKind`, `mHx / mHz` home, `mLeash`, `mSpeed`, target, wait, phase, flee timer) and a **dynamic spatial hash**
(`relocate(i)` re-buckets only when it crosses an 8 m cell). `sim/movers.ts` steps them from `Sim.step` before
`commitItems`: DOM-free, one seeded Rng and a fixed order, so the bot, the tests and the game agree.

- **Behaviours** (`MoveKind`): `wander` (walk to a random spot inside the leash, idle 1-4.5 s), `hop` (jumps, the
  instance lifts in an arc), `crawl` (very slow), `skitter` (short fast dashes), `flutter` (stays 0.3-0.9 m up and bobs),
  `swim` (only on water cells), `trail` (ants: back and forth between home and a second point, staggered by `delay`),
  `patrol` (staff: the same with long idles), `roam` (giants: slow, turn gently, idle 3-9 s). Herds are `wander`
  movers that share a home and leash.
- **Ground rules**: `MapData.walk` (a 2 m `WalkGrid`: 0 blocked, 1 land, 2 water). Walkers need land, swimmers water,
  flutterers anything that is not sea; the target and the straight line to it (checked every 2 m) must be clear. Hills,
  buildings, fences and big trees are blocked cells.
- **Awake set**: only movers within 1.6 x the camera distance of the hole **and** big enough to be seen from there
  (`size x 150` m) move; the rest stand still. Depends on the hole only, never on the camera, so it is deterministic.
- **Speed cap**: no mover is faster than 0.5 x the full speed of the hole level that first eats it (a level 4 hole
  always catches a rhino).
- **Flee** (`FLEE` in `sim/movers.ts`: range 1.3 x the hole diameter + size, 1.6 s, 1.1 x walking speed, any tier): an
  animal the hole can eat walks away from it. **Insects (`bugs`) and giants never flee** (`flee: false`). A thing that is too big
  to eat stops and teeters when the hole is under it. A mover that commits to falling freezes and falls like any item.
- **Rendering** (`render/item-instances.ts`): movers get their own `InstancedMesh`es (key `...#1`), on a smaller cell
  grid (32 m instead of 64 m: `CELL_MOVERS`) because the animals are heavier; matrices are rewritten only for movers
  that moved (`world.moving`, cleared by the renderer), the culling sphere of such a mesh is recomputed from its real
  positions, `world.lift` raises an idle mover (hop, flutter, a small walking bounce). Static items are untouched.
- **Cost** (`tests/hole/movers.test.ts`): a tick with 2 500 awake movers takes well under 3 ms in node (benchmark: 0.1 ms
  for the movement, 0.1 ms for the matrices); the game has about 2 500 movers, a few hundred awake.
- Not done: the bot does not lead moving targets, no leg animation (animals bob / hop as a whole), herd followers,
  see [`ANIMAL-ISLAND.md`](ANIMAL-ISLAND.md) section 7.

### Movement

- Full-stick speed `v(D) = 6 + 1.2 · D/1.2` m/s (level 1: 7.2, level 10: 28, level 15: 54, level 25: 105). Tunable (`TUNING.speedBase`,
  `speedPerMetre`).
- Short acceleration (0.12 s) and deceleration (0.08 s) so it feels tight on touch, with no inertia slide. The sim runs
  at a fixed 60 Hz; the hole is interpolated for rendering.

### Balance (first pass)

Measured with the headless bot (`sim/bot.ts`, 4 map seeds, 30 steps/s):

| Difficulty   | casual bot              | good bot                                |
| ------------ | ----------------------- | --------------------------------------- |
| Hard 100 s   | level ~9 of 15          | level ~13 of 15                         |
| Medium 250 s | level 15 at ~160 s      | level 15 at ~120 s, ~99 % of the island |
| Easy 500 s   | island cleared (~400 s) | island cleared (~310 s)                 |

Humans on touch will be slower than the bot. Medium and Easy are close in feel (both reach the top level and clear most
of the island); the clear bonus (+2 / s left) is what ranks fast Easy runs. Tune with real players (TASKS).

## Camera

- Perspective, FOV 50°. Follows the hole with a critically-damped smoothing (0.09 s) and looks north-up, from the
  south, at the hole.
- **Distance** `7 + 3.2·D`, eased (0.35 s) to the new value on level-up, so the view widens as the hole grows.
- **Pitch** goes from 52° at level 1 to 64° at level 15 (70° at level 25), getting steeper so skyscrapers don't hide the hole.
- **Portrait**: the distance is multiplied by `max(1, (1.4 / aspect)^0.6)` (about ×1.95 on a 9:19.5 phone, ×1.45 on an
  iPad in portrait), so the visible world width doesn't collapse.
- The hole rim is also drawn last with depth test off as a thin ring, so you never lose the hole behind a building.
- **Not done yet**: fading buildings that stand between the camera and the hole (TASKS).
- Shadow camera follows the focus point with a texel-snapped box that grows with the camera distance.

## Map: City Island

Always an island surrounded by water. The first map, `city`, is generated by `map/generate.ts` from a seed
(`src/shared/rng.ts` / `noise.ts`), so a given seed always gives the same island. The map viewer shows and tunes it.
World axes: +X east, +Z south (same as rally).

| Part         | How it is built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island shape | radius 255 m ± 14 m of noise (128-sample coast table); the **harbour bay** at a seeded angle (46 m deep, ~130 m wide, a headland on each side); 3-5 more seeded **headlands (+9..18 m) and inlets (-9..18 m)** (own RNG, so the coast never shifts the other draws); sand band 16 m wide inside the coast                                                                                                                                                                                               |
| Road grid    | **10 × 10 tiles** (`tiles`), 50 m pitch: 40 m blocks (3 m sidewalk + 34 m lot) and 10 m roads with yellow dashes. A block is built when all four corners are on the island                                                                                                                                                                                                                                                                                                                              |
| Core         | the central 2×2 blocks: the `landmark_tower` (in one seeded block) and three downtown towers                                                                                                                                                                                                                                                                                                                                                                                                            |
| Downtown     | block centres within 80 m (the ring is **warped by noise**, so its edge is blobby and different per seed; the core stays a clean ring): one skyscraper each (deck so every type appears), sidewalk meters / bollards / pedestrians, taxis, a tram                                                                                                                                                                                                                                                       |
| Commercial   | within 135 m (warped), plus a seeded **avenue**: a 60 m wide strip of commercial blocks through the residential part, out to 195 m: four 17 m cells with apartment blocks / shops / offices / school / gas station, or one big building (garage, tower, hotel), or two halves; parked cars, planters, dumpsters. The first two always get a garage and an apartment tower                                                                                                                               |
| Residential  | beyond: four lots per block with a house / small house / townhouses, front fences with a gate gap, hedges, driveway car, mailbox, bushes, shed, trees                                                                                                                                                                                                                                                                                                                                                   |
| Parks        | 5 blocks (the first near the centre = the start): fountain plaza, playground or woods, with paths, benches, flower beds, tall grass and flowers                                                                                                                                                                                                                                                                                                                                                         |
| Canal        | one road line near the middle (a column or a row, seeded, own RNG) is **water instead of asphalt**: 10 m wide between the sidewalks, the crossings on it stay asphalt and are the **bridges** (parapets from `city-decor.ts`), at both ends it runs on to the coast. Zone `water` in `map/spawn.ts` (rects at `CANAL_Y`): nothing may stand in it except 5 **rowboats**, no traffic on it. **The hole is only clamped to the coast, so it crosses the canal freely** (the water is cut like the ground) |
| Streets      | lamp posts, hydrants, trash cans, bus stops, billboards, vending machines, a **traffic light (busy / commercial blocks) or street sign (residential, parks) on every crossing corner of a live block**, parked cars at the curb, one vehicle per road segment                                                                                                                                                                                                                                           |
| Beach        | up to ~660 placement attempts in the sand band: chairs, umbrellas, palms, huts, lifeguard towers, rowboats, stands                                                                                                                                                                                                                                                                                                                                                                                      |
| Harbour      | at the bay: quay (plus a render-only pier, see Non-edible assets), crates, rowboats, speedboat, delivery trucks, water towers, lighthouse on the opposite headland                                                                                                                                                                                                                                                                                                                                      |
| Edge blocks  | blocks that don't fit are left as lawn with trees, bushes, grass and flowers                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Total points are fixed per map size.** A map of `tiles × tiles` tiles holds exactly `tiles² × pointsPerTile` points:
**10 × 10 × 300 = 30 000** (before the clear bonus), for every seed, so replays and score comparisons are consistent.
Individual tiles can be richer or emptier (parks vs. skyscrapers), only the total is fixed. How: the generator lays out the
island randomly, then `balancePoints` trims small scatter items (cans, paper, flowers, grass, cones, pedestrians, small
bushes, then other small street / nature items) if it came out too rich, and tops up with small scatter items (weighted
towards 1-point grass and flowers, so the last points are exact) until the total is exactly the target. When the layout
falls far short (300 points per tile: the generated content alone holds about 25 000), an **enrich pass** runs first: it
places mid-tier clutter (`ENRICH` in `map/generate.ts`: bushes, trees, flower beds, planters, benches, scooters, hedges, a
few cars, pedestrians) until only 4 % of the target (`ENRICH_LEFT`) is missing, so a denser map is richer and not padded
with thousands of grass tufts. The area around the start is never trimmed. `targetPoints(params)` gives the number.
Points per tile history: 250 (25 000 points, ~3 900 items) → 400 (40 000, ~10 000 items, too much) → **300** (30 000, ~7 000 items).

**Content budget** (checked by `tests/hole/map.test.ts`, shown in the map viewer):

- Total points are exactly 30 000 for every seed (and `tiles² × 300` for other sizes).
- Every size tier 1–25 and every hole level 1–15 has at least 2 item types placed; every item type up to tier 20 is placed at
  least once (`ensureAllTypes`).
- The total is at least 2× the cumulative XP to the top level (8555), so Easy can clear the island. About 7 000 items per
  seed; downtown holds the landmark tower and 11 skyscraper blocks, commercial blocks add hotels, slim towers, garages
  and apartment towers.
- The start is a clear spot in the park nearest the centre, with plenty of tier 1–3 items within reach.

### Map generation rules (City Island)

**1. Every item has a spawn zone.** The ground of the island is split into six kinds (`map/spawn.ts`, `makeZoneMap`,
built from the road rects, the blocks and the coast once the roads exist):

| Zone       | Where                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `road`     | the 10 m asphalt strips between blocks, crossings and zebras included    |
| `sidewalk` | the 3 m ring around a block (17 – 20 m from its centre), outside the lot |
| `lot`      | inside a block (buildings, yards, plazas, parking), park blocks excluded |
| `park`     | inside a park block                                                      |
| `beach`    | the sand band along the coast (16 m), also the harbour quay              |
| `lawn`     | everything else on the island: edge blocks and the grass between         |

The `SPAWN` table in the same file has **one row per City item** listing the zones its centre may be in (a test fails
for a missing or stale row). Typical rows: lamp posts, hydrants, signs, traffic lights, bus stops, billboards =
`sidewalk` only; trash cans, planters, mailboxes, benches = sidewalk / lot / park; houses, fences, sheds, towers = `lot`;
trees and bushes = lot / park / lawn; palms, beach gear, boats, crates, lighthouse = `beach`; pedestrians = sidewalk /
lot / park / beach (never road).

**2. Only vehicles touch the road.** Items whose row lists `road` (cars, taxis, police and fire cars, vans, pickups,
delivery and food trucks, buses, trams) may stand on asphalt; **every other item must keep its whole rotated footprint
off the asphalt**, not just its centre (`footprintHalf` / `ZoneMap.touchesRoad`). A scooter is in the `vehicle` group but
is not a car: sidewalk / lot only. Bus and tram are `road` only. Cars never stand on parks, lawn or sand (only the food
and delivery trucks may use park / beach); the curb lane for parked cars is the road at 21 m.

**3. One guard decides.** `tryPut` (`map/generate.ts`) rejects a placement when the item's zone or footprint breaks its row
(`spawnViolation`), when it is outside the island, or when it overlaps something (`Occupancy`). Fixed layouts that call
`put` directly (buildings, fences, hedges, fountain plaza) must be positioned so they pass; the test below checks them.

**4. Random placers pick a position in a zone of the item.** `spotFor(c, id)` takes a random zone of the item's row and
`spotIn(c, zone)` samples a point there (sidewalk ring, lot interior, park interior, curb lane, coast band, edge block),
so a bus is never searched for on a lawn and a tuft never on asphalt. The shared samplers serve `ensureAllTypes` (every
type up to tier 20 at least once), the enrich pass and the top-up. The last-resort tuft of the top-up goes to a lot or
park, never "anywhere on the island".

**5. Order of the generator** (`generateCity`): coast → blocks and districts → roads → zone map → ground rects → lots by
district → sidewalk furniture, pedestrians and curb cars → traffic (one vehicle per road segment) → beach → harbour →
edge nature → litter → `ensureAllTypes` → start point → `balancePoints` (trim → enrich → top-up). The point total is exact
(see above); the zone rules apply to every step because they live in `tryPut`.

**6. Adding or moving an item.** Add its `SPAWN` row (`map/spawn.ts`) together with its catalog row, and place it with
`tryPut` / `spotFor`. A new generator step must place only through `tryPut`, or position itself by the zone sizes above
(block ±20 m, lot ±17 m, road 20 – 30 m from a block centre). Checked by `tests/hole/spawn.test.ts` (5 seeds: every
placement passes `spawnViolation`, no non-vehicle footprint touches a road, bus / tram on road only, traffic exists).

**Random start (both maps).** Every run starts somewhere else: `map/start.ts` `pickStart(map, rnd)` samples spots inside the
playfield (14 m from the edge / walls, not on the canal), rejects a spot with an item the level 1 hole cannot eat under it
and wants >= 18 tier 1-3 items within 22 m (best of 300 tries, falls back to `map.start`). `?x=&z=` still forces a start;
the menu demo, the bot, the balance page and the tests keep `map.start`. `tests/hole/start.test.ts` checks it.

## Map: Toy Emporium

The second map: a giant toy store (working title). One closed rectangular floor with walls, no water. World scale is
about 5x a real store: a toy brick is 16 cm, a small panda 1.1 m, a ride-on car 3.2 m, a robot 14 m, so the hole sizes and
the camera are the same as on City Island. Design notes, the full asset roster and the open tasks are in
[`TOY-STORE.md`](TOY-STORE.md). Generated by `map/toy/generate.ts` from a seed + a floor plan (`map/toy/layouts.ts`),
deterministic per seed. Registered in `map/registry.ts` (`MapDef`: generator, point total, sky / light mood, menu camera,
noun for the HUD).

| Part          | How it is built                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Floor         | rectangle (`MapData.bounds`: `hx`, `hz`, `inset`, `door`), pastel 10 m checker, one coloured **mat** per department with a white tape border, a door mat and a yellow guide line from the entrance                                                                                                                                                                                                                                              |
| Walls         | non-edible, drawn with the item material so the building fade dithers them: tall on three sides (the north = stockroom wall carries **racks of cartons**, the side walls a window band + bunting), **low on the camera side** with a gap and two pillars for the entrance (south), a header with a transom band over it and a "TOY EMPORIUM" sign facing the camera                                                                             |
| Wayfinding    | render-only (`render/toy-signs.ts`, from the zones + the door): the department **name painted on the floor** at the south edge of each zone (transparent canvas decal, stencil-cut), **chevron trails** (yellow up the central aisle from the door, a branch in the zone colour to every department that is not on the aisle) and a **name banner** on the side wall behind every zone that touches it                                          |
| Hole bounds   | the hole centre may go to `0.15 x diameter` from the wall (`bounds.inset`; City Island uses 0.5) so it may bulge over the walls and corner items stay reachable; `tests/hole/toy-map.test.ts` checks it                                                                                                                                                                                                                                         |
| Layouts       | **A "Grand Hall"** (default, 11 departments around a big atrium, drawn 240 x 160 m, built x`FLOOR_SCALE` 2.5 = 600 x 400 m), **B "Ring Walk"** (departments hug the walls, atrium in the middle), **C "Warehouse Sale"** (5 bands from the entrance to the landmark row; slow start, a speed run)                                                                                                                                               |
| Zones         | Stockroom, Robot Factory, Game Room, Plush Meadow, Vroom Row, Splash Zone, Doll House Lane, Brick Alley, Figure Falls, Checkout, Atrium. Each has a points share (A: 4 / 11 / 6 / 20 / 9 / 9 / 7 / 12 / 9 / 5 / 8 %)                                                                                                                                                                                                                            |
| Fill          | per zone: fixed anchors (showpieces), one of every big item, department shelf rows, then **type quotas** (points per type ~ points^0.8, big types first) placed in **clusters** (loose items gather in displays and spills with empty floor between)                                                                                                                                                                                            |
| Atrium (A)    | a hall: Big Ted at the back of the central aisle (visible from the door), the two robots and the railway behind, rocket and titan on the sides, **two Ferris wheels and two carousels as pairs** either side of the aisle, a brick tower in each front corner                                                                                                                                                                                   |
| Floor         | textured in layers (`render/toy-floor.ts`, greyscale canvas tiles that multiply the mat colour, UVs from x / z): terrazzo base, **carpet** (Plush Meadow), **polka dots** (Doll House Lane), **brick base plate studs** (Brick Alley), **waves** (Splash Zone), **concrete** (Stockroom), glossy **tiles** (Robot Factory, Checkout, Atrium), **foam mat tiles** (Game Room, Vroom Row, Figure Falls); tape, door mat and guide line stay plain |
| Plush density | the Plush Meadow is the densest zone but not a pile-up: share 18 % (was 20 %) in layouts A / B, and the whale / penguin plush are stocked in the Splash Zone (`PLUSH_ELSEWHERE` in `map/toy/generate.ts`); the freed points go to the atrium, checkout, dolls and splash                                                                                                                                                                        |
| Start         | the checkout between Brick Alley and Figure Falls (layout A), ringed by ~36 tier 1-3 pieces (only the default / test start, see "Random start")                                                                                                                                                                                                                                                                                                 |

**Total points are exactly 25 000 for every seed**, like City Island: after the zones are filled, `balancePoints` trims
small items (never near the start) or tops up with 1-point fillers (`puzzle_piece`, `brick_2x2`, ...). Pacing: the
store has to be big for the same reason City Island is (points per m2), so the floor is 600 x 400 m. Points by tier
(layout A): tier 1 is ~5 % of the points, tiers 4-10 hold ~52 % (a third of the map is 8-point shelf units), tiers 20-25
~5 %: the early game is not a dust vacuum. Good bot, layout A:
level 15 at ~90 s, store cleared at ~320 s (City Island: level 15 at 120-160 s, cleared ~310-400 s). Layout B is faster
(level 15 at 70 s, cleared 265 s), layout C slower (level 15 at 160 s, cleared 380 s).

**Catalog:** 210 types in `items/catalog-toy.ts` (data) with builders in `build-plush.ts`, `build-toys.ts`,
`build-toyveh.ts`, `build-landmarks.ts` (all recipes in fractions of w x d x h, helpers in `kit-toy.ts`). Groups: bricks,
figures, toys, plush, dolls, toyveh, robots, games, outdoor, store, landmark. The plush are one parametric rig
(`build-plush.ts`, 13 families); the **panda, brown bear and gray rabbit** come in six sizes each (XS to XXL), so you eat
the small panda early and the giant one at level 10. Sizes, tiers and the department of every item are listed in
[`TOY-STORE.md`](TOY-STORE.md) section 4.1. The toy builders run with `Mesher.decoplanar` (builders.ts sets it for toy
items): a box face that lies in the same plane as an earlier box's face is pulled in 5.8 mm so nothing z-fights.
Triangle budgets (`tests/hole/toy-items.test.ts`): bricks 500, figures 450, toys 250, plush 700, dolls 450, toyveh 900,
robots 900, games 450, outdoor 600, store 1000, landmark 1400.

Sounds: plush squeak, bricks / figures / toys clack, vehicles and robots honk, inflatables boing (`Sfx.gulp(tier, group)`).
Swallow puffs: dust on City Island, **confetti** in the store (`MapDef.puffs`), and plush always burst into **white stuffing**
(`render/puffs.ts`, `PUFF_PALETTES`).

The menu's map cards show a picture each (`screenshots/menu-city.jpg`, `menu-toy.jpg`, `menu-animal.jpg`: 640 x 360 in-game shots, taken
with the game camera through the dev thumbnail endpoint, see "Debug tools"); the results screen colours the 25 tier bars
blue -> red, and the store's "STORE CLEARED!" banner is pink (the island's is gold).

## Map: Animal Island

The third map (`map=animal`): a round island of animals. You start by eating ants and ladybugs, move on to rabbits, sheep
and zebras, and end on **37 giant animals** (16 types, tiers 20-25) bred by a secret laboratory. Hills are edible items,
rivers and ponds are water the hole crosses freely. Design, roster, decisions and open tasks:
[`ANIMAL-ISLAND.md`](ANIMAL-ISLAND.md). Generated by `map/animal/generate.ts` from a seed (the menu has the island seed
stepper), deterministic, DOM-free; registered in `map/registry.ts` (id `animal`, 21 000 points, `puffs: 'fur'`).

| Part     | How it is built                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Island   | radius 210 m +- coast noise and 3-5 headlands / inlets, 14 m sand band                                                                                                                                                                                                                                                                                                                                                                                                     |
| Biomes   | seeded angular sectors (rotation from the seed, warped by noise): meadow (+ a farm), wetland, forest, jungle, the compound, savanna; a **highlands** disc in the middle, a beach ring. `map/animal/biomes.ts` has the ids and ground colours; a 2 m grid holds land / water / biome                                                                                                                                                                                        |
| Rivers   | the main river (13 m) runs from the highlands to the wetland coast, a stream (6 m) joins it from the forest, ponds in the wetland, a waterhole in the savanna and a hippo pool in the zoo; `Terrain` in `map/types.ts`, water cells are code 2 of the walk grid                                                                                                                                                                                                            |
| Hills    | `hill_great` (35 m, 1 copy) near the middle, then 7 hill clusters (highlands, savanna, meadow, forest): flattened domes from `molehill` to `hill_30`, 3 variants (bare, little trees, rocks and flowers). Static items, nothing stands on them                                                                                                                                                                                                                             |
| Compound | 180 x 126 m (a 200 x 140 unit layout, positions scaled by 0.9, item sizes not) on the sector between jungle and savanna, mirrored so the giant **paddock** (cage bars on three sides, 14 giants) is on the far side and the electric lab fence faces the island. West: three zoo pens (fence, big animals, sheds, aviary); east: the laboratory (HQ, hangar, domes, tower, reactor, vats, containers, helicopter, scientists, jeeps). Flat rects colour the roads and pads |
| Farm     | a barn, hay bales, beehives and a wooden fence ring in the meadow, 40 m `farm` biome (pigs, hens, chicks)                                                                                                                                                                                                                                                                                                                                                                  |
| Fill     | a per-tier point budget (`TIER_FRACTION`) shared by the types of the tier by priority and group weight (`planCounts`), placed biggest first; 80 % of the tier 1-12 items gather around **hotspots**; herds, ant trails from anthills, patrols; then `ensureTypes` and `balancePoints`                                                                                                                                                                                      |
| Start    | a clear meadow spot with the most tier 1-3 items within 22 m, plus a ring of 26 tiny things (`startPoint`); runs start at a random busy spot (`pickStart`: avoids water and hills and, on this map, needs >= 40 tier 1 items within 22 m because a level 1 hole eats tier 1 only; the tests check >= 30)                                                                                                                                                                   |

**Total points are exactly 21 000 for every seed**: the fill plans less than the target, `balancePoints` trims small
items (never within 28 m of the start) or adds mid-tier items and 1-point fillers (`grass_tuft`, `flower`, `clover`,
`pebble`) until the total is exact. About 4 900 items, ~2 500 of them movers. At most 50 terrain hills (per-type caps), the tiny mounds are small items. Items keep `3 + 0.15 x size` m from the coast (the biggest hole must reach them). Pacing is in `ANIMAL-ISLAND.md` 5.7.

**Catalog:** 181 types of its own in `items/catalog-animal.ts` (data: size, biomes, motion, priority) plus the 9 City
greenery items with identical sizes (`flower`, `grass_tuft`, both bushes, `hedge`, the three trees, `palm_tree`; they
are the round versions), 190 in all. Builders: `build-animals.ts` (rigs: quadruped, hopper, bird, insect, reptile, ape,
slug, crab; driven by family tables, `*_big` / `*_giant` / `lab_*` are the normal rig with a **glowing green collar**),
`build-nature.ts` (flora, rocks, hills, logs, big trees), `build-zoo.ts` (fences, cages, barn, lab buildings, vats,
staff, vehicles). Every animal and scenery builder runs in `Mesher.fitted(w, d, h, ...)`: the recipe is designed by
proportion and scaled so the **built size equals the catalog size** exactly. Bodies, heads, shells, wool, crowns and hills
are `ball()`s (see "Round parts"). Triangle budgets (`tests/hole/animal-items.test.ts`): bugs 300, critters 520,
animals 800, giants 1 600, flora 400, rocks 340, hills 400, zoo 600, farm 700, lab 1 400, labveh 700, staff 200.
Tiny parts (under ~4 mm after scaling) cannot be clip-free, so very small animals have fewer details (no bird feet
under 0.24 m deep).

Sounds: squeak (bugs, critters), grunt (animals, giants), thud (hills, rocks), clank (zoo, lab) - `Sfx.gulp(tier, group)`.
Swallow puffs: fur tufts and leaves. Ground (`render/animal-ground.ts`): a base fan coloured per coast segment, the 10 m
biome cells (two greens per biome), sand ring, flat rects, river ribbons with mud banks, ponds, the sea.

**Performance** (dev PC, software renderer, `quality=low`): about 130k triangles at level 1, 190k at level 8, 310k at
level 15 (City Island: 70k / 97k / 164k) with 170 / 310 / 640 draw calls: heavier than the City, **not yet measured on a
device** (open task AI-01).

## Art style

- **Blocky toy city.** Everything is built in code from boxes, plus a few low-sided cylinders and cones (6–8 sides)
  for trunks, cans and wheels, and **faceted balls / eggs / domes** for the greenery (see "Round parts"). No bevels, flat shading, chunky proportions (slightly oversized wheels and lamps).
- **Vertex colours** carry all colours (`items/kit.ts`, named palette `PAL`). Parts marked `paint` take a per-instance
  colour (car paint, petals, wall colours) through a small shader patch (`render/materials.ts`); the vertex colour of
  those parts is white so instance colour × ambient occlusion shows.
- **Window tiles**: buildings use one of three 16×16 pixel-art window textures (`punched`, `ribbon`, `glass`, nearest
  filter, repeating, 1 tile per 3 m × 3.2 m). Roofs and trims sample a plain wall pixel. No other textures.
- **Glow**: a Mesher box / cylinder with `{ glow: true }` writes paint attribute 2; the item material adds that
  vertex colour on top of the lighting (`vGlow` in `render/materials.ts`), so arcade screens, the claw machine lamp,
  pinball marquee and robot eyes / chest lights light up flat and bright. Paint attribute 1 is still "takes the instance
  colour" (the item tests count only 1 as paint).
- **Ambient occlusion feel**: vertex colours are darkened over the bottom 20 % (max 4 m) of every item.
- **Lighting:** a warm sun (directional) with one 2048 shadow map (high quality), a sky/ground hemisphere light and
  light fog towards the sky colour. `low` quality turns shadows off, caps the pixel ratio at 1.5 and drops
  antialiasing. No tone mapping, so flat colours stay flat.
- **Ground:** grass with a 10 m checker, sand band, asphalt with dashes, sidewalk and lot rects (a few cm apart in
  height), one merged mesh with the stencil-cut material; kerbs, roundabouts and road decals on top. **Water:** flat
  plane below the island skirt, drifting ripple layers and a breathing white foam ring (see "Non-edible assets").
- **Hole:** see "Assets – hole".
- **Geometry budgets** (enforced by `tests/hole/items.test.ts`): litter ≤ 60 tris, street ≤ 140, people ≤ 80,
  nature / park / beach ≤ 260, vehicles ≤ 500, harbour ≤ 300, houses and shops ≤ 450, buildings and skyscrapers
  ≤ 900. Each item is built once and every placement is an `InstancedMesh` instance (repo rule: never clone per
  instance).
- **No clipping** (enforced by `tests/hole/clip.test.ts`, checker in `debug/clip-check.ts`): in every item and variant,
  (1) no two faces that point the same way may share a plane (within 4 mm) and overlap - that is z-fighting, a flicker
  where the colours fight; (2) no box / cylinder may be completely hidden inside the model (a door behind its wall, a
  window inside a cab). The failure message names the builder `file:line` (set `Mesher.trace = true`, see `items/kit.ts`).
  Rules of thumb when building: decals and panels sit 1-3 cm _proud_ of the surface they decorate (a door on a plinth
  goes in front of the plinth, not at the wall); parts that meet at a corner differ by a few mm in size or height;
  wheels stick out of the body side (`WHEEL_OUT`); glass bands use `glassBand()` so they follow the cabin taper.

## Assets

### Edible items (catalog)

`size` = `max(w, d, h·0.25)`. `Tier` = size tier (1–25); `Pts` = points of that tier. The hole level that first eats an item is shown in the viewers (levels 1–15, see "Hole levels"). Sizes were checked
against the tier table (every size tier 1–25 and every hole level 1–15 has at least 2 item types). If you change a size, keep its tier in mind (it sets the points, and changing it means bumping `SCORING_VERSION`).
The item viewer shows the live value.

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
| 1    | 1   | `pedestrian`         | people      | 0.5×0.35×1.75 | 0.50 | sidewalks, plazas, beach    | standing, 6 colour combos; walking = iteration |
| 1    | 1   | `parking_meter`      | street      | 0.3×0.3×1.3   | 0.33 | downtown curbs              |                                                |
| 1    | 1   | `bollard`            | street      | 0.3×0.3×0.9   | 0.30 | plazas                      |                                                |
| 1    | 1   | `street_sign`        | street      | 0.6×0.1×2.5   | 0.63 | crossings                   | stop / parking / one-way plates (palette)      |
| 1    | 1   | `newspaper_box`      | street      | 0.6×0.5×1.1   | 0.60 | downtown                    |                                                |
| 2    | 2   | `mailbox`            | street      | 0.95×0.5×1.2  | 0.95 | residential                 | post box + house mailbox variants              |
| 2    | 2   | `bush_small`         | nature      | 1.0×1.0×0.8   | 1.00 | residential, parks          | two faceted balls                              |
| 2    | 2   | `planter`            | street      | 1.0×1.0×0.7   | 1.00 | plazas, shopfronts          | box with flowers on top                        |
| 2    | 2   | `shopping_cart`      | street      | 1.0×0.6×1.0   | 1.00 | parking lots                |                                                |
| 2    | 2   | `wooden_crate`       | harbour     | 1.0×1.0×1.0   | 1.00 | harbour, shops              |                                                |
| 3    | 3   | `lamp_post`          | street      | 0.35×0.35×4.5 | 1.13 | every sidewalk              | glowing head at night = iteration              |
| 3    | 3   | `phone_booth`        | street      | 1.1×1.1×2.4   | 1.10 | downtown                    |                                                |
| 3    | 3   | `vending_machine`    | street      | 1.1×0.8×1.9   | 1.10 | shopfronts, beach           |                                                |
| 3    | 3   | `flower_bed`         | nature      | 1.2×1.2×0.4   | 1.20 | parks                       | soil box + flower balls                        |
| 4    | 4   | `statue`             | park        | 1.3×1.3×3.0   | 1.30 | plaza, parks                | plinth + blocky figure                         |
| 4    | 4   | `recycling_bins`     | street      | 1.4×0.7×1.2   | 1.40 | residential                 | 3 coloured bins                                |
| 4    | 4   | `bush_large`         | nature      | 1.4×1.4×1.2   | 1.40 | residential, parks          |                                                |
| 5    | 5   | `traffic_light`      | street      | 1.5×0.4×4.5   | 1.50 | crossings                   | short arm                                      |
| 5    | 5   | `tree_small`         | nature      | 1.6×1.6×3.5   | 1.60 | streets, residential        | egg crown / 3 balls (2 variants)               |
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
| 8    | 8   | `tree`               | nature      | 2.6×2.6×6.0   | 2.60 | parks, residential          | stacked balls / cloud of 4 (2 variants)        |
| 9    | 9   | `fountain`           | park        | 3.0×3.0×1.8   | 3.00 | plaza, parks                | animated water = iteration                     |
| 9    | 9   | `playground_slide`   | park        | 3.0×1.0×2.2   | 3.00 | parks                       |                                                |
| 9    | 9   | `swing_set`          | park        | 3.0×2.0×2.2   | 3.00 | parks                       |                                                |
| 10   | 10  | `car_compact`        | vehicle     | 3.5×1.7×1.5   | 3.50 | everywhere (parked)         | 6 paint colours                                |
| 10   | 10  | `rowboat`            | harbour     | 3.5×1.4×0.8   | 3.50 | beach, harbour              | sits on sand                                   |
| 11   | 11  | `garden_shed`        | residential | 4.0×3.0×2.8   | 4.00 | residential                 |                                                |
| 11   | 11  | `billboard`          | commercial  | 4.0×0.6×6.0   | 4.00 | main roads                  | pixel ad panels (atlas)                        |
| 12   | 12  | `car_sedan`          | vehicle     | 4.2×1.8×1.5   | 4.20 | everywhere (parked)         | 6 paint colours                                |
| 12   | 12  | `taxi`               | vehicle     | 4.2×1.8×1.6   | 4.20 | downtown                    | yellow, roof sign                              |
| 12   | 12  | `police_car`         | vehicle     | 4.8×1.9×1.7   | 4.80 | downtown                    | light bar                                      |
| 12   | 12  | `kiosk_shop`         | commercial  | 4.5×4.5×3.2   | 4.50 | plazas, beach               | awning                                         |
| 13   | 13  | `van`                | vehicle     | 5.5×2.0×2.3   | 5.50 | commercial                  |                                                |
| 13   | 13  | `pickup`             | vehicle     | 5.4×2.0×1.9   | 5.40 | residential                 |                                                |
| 13   | 13  | `beach_hut`          | beach       | 5.5×5.0×4.0   | 5.50 | beach                       | stilts, striped walls                          |
| 13   | 13  | `tree_big`           | nature      | 5.5×5.5×10    | 5.50 | parks                       | oak-style crown of 4 balls                     |
| 14   | 14  | `water_tower`        | harbour     | 6×6×14        | 6.00 | harbour, commercial         | legs + tank                                    |
| 14   | 14  | `lighthouse`         | harbour     | 6×6×20        | 6.00 | headland                    | red/white bands                                |
| 14   | 14  | `delivery_truck`     | vehicle     | 6.5×2.4×3.4   | 6.50 | commercial, harbour         |                                                |
| 15   | 15  | `food_truck`         | vehicle     | 7.5×2.4×3.2   | 7.50 | plazas, beach               |                                                |
| 15   | 15  | `speedboat`          | harbour     | 7.5×2.5×2.0   | 7.50 | harbour slipway             | on trailer                                     |
| 16   | 16  | `house_small`        | residential | 8.0×7.0×6.0   | 8.00 | residential                 | pitched roof, 4 wall colours                   |
| 16   | 16  | `fire_truck`         | vehicle     | 8.5×2.5×3.2   | 8.50 | fire station lot            | ladder                                         |
| 17   | 17  | `bus`                | vehicle     | 10×2.5×3.2    | 10.0 | main roads, depot           |                                                |
| 17   | 17  | `house`              | residential | 9.5×9.0×8.0   | 9.50 | residential                 | 2 floors, garage                               |
| 17   | 17  | `corner_shop`        | commercial  | 10×8×5        | 10.0 | commercial                  | awning, sign                                   |
| 18   | 18  | `townhouse_row`      | residential | 12×8×9        | 12.0 | residential/commercial edge | 3 colourful units                              |
| 18   | 18  | `tram`               | vehicle     | 12×2.6×3.4    | 12.0 | downtown stop               | static                                         |
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

Builders share the `Mesher` in `items/kit.ts`: `box()` (with taper, window UVs, paint flag), `cyl()` (cylinder / cone, any
axis), `gable()`, `hip()`, and `xf()` for local transforms. Each item merges into one non-indexed geometry with its pivot
at the ground centre. Vehicles run along X and face +X; people and facades face +Z.

**Round parts.** `ball(cx, cy, cz, rx, ry, rz, color, opts)` is a faceted (flat shaded) ellipsoid: `seg` / `rings` (default
by size from `roundDetail`: 6x3 = 24 triangles up to 12x8 = 168; triangles = 2 x seg x (rings - 1)), `taper` (egg: the top
narrows), `half` (dome on its base `cy`, `bottom` closes it), `jitter` + `seed` (seeded radius noise: crowns, boulders),
`paint` / `glow` like `box()`. Faceted balls with an odd number of rings have no equator row, so builders use `blob()`
(`build-small.ts`, takes a bounding box like `box()`) which widens the radii to keep the catalog size. City greenery
(bushes, hedge, trees, flower plants, palm coconuts) uses it; sizes are unchanged, so points and scores did not change.
The clip checker (`Mesher.trace`) covers balls; `tests/hole/kit-ball.test.ts` checks sizes, eggs, domes, determinism.

### Non-edible assets

All of the City Island dressing is **render-only**: `render/city-decor.ts` derives it from the map data (rects,
placements, coast) with its own seeded RNG, so it never changes item placement, points or scores. Curbs and decals are
stencil-cut ground (the hole opens through them), built as 96 m chunks so the camera only draws the cells it sees
(~6.7k triangles in total).

| Asset            | Status | Notes                                                                                                                                                                                                                                                        |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Island ground    | done   | one merged mesh: grass + 10 m checker, sand band, coast skirt, all with the stencil-cut material                                                                                                                                                             |
| Roads            | done   | asphalt, yellow dashes, white zebra crossings at both ends of every road arm                                                                                                                                                                                 |
| Curbs            | done   | an 11 cm raised kerb (0.4 m wide) on the road side of every sidewalk, light top + darker side                                                                                                                                                                |
| Roundabouts      | done   | grass island + plaza ring + dashed lane ring on the crossings nearest the island centre that have all four arms (5 on the default map)                                                                                                                       |
| Road decals      | done   | stop line before each zebra, a straight lane arrow 10 m before each crossing (right-hand traffic), manholes on ~40 % of the arms, white parking-bay ticks fore and aft of every car parked at the kerb                                                       |
| Sidewalks / lots | done   | flat rects: sidewalk, plaza / concrete / lawn / park lots, park paths, play sand, harbour quay                                                                                                                                                               |
| Coast            | done   | sand band + skirt, grey low-poly rocks (one instanced mesh, 100+) in the water along the coast except at the harbour, and a plank **pier** (alternating plank colours, side boards, posts) running 30 m out from the quay                                    |
| Water            | done   | flat plane below the skirt, two crossing layers of drifting ripple lines (one shared canvas texture each, scrolled by `userData.animate(seconds)`) and a foam ring that breathes (`render/water.ts`); the game and the map viewer call `animate` every frame |
| Sky              | done   | outdoor maps set `mood.skyTop`: a gradient dome (`Environment.dome`, horizon colour = fog colour, fog off, drawn first, re-centred on the camera and kept inside the far plane). Indoors (toy store) has none                                                |
| Decals           | done   | see road decals; not done: crosswalk signs, road arrows for turns, bike lanes                                                                                                                                                                                |

### Assets – hole

| Part              | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stencil mask disc | done   | writes stencil = 1 at ground level, no colour or depth (`render/hole-mesh.ts`, `createMaskMaterial`)                                                                                                                                                                                                                                                                                       |
| Interior walls    | done   | open cylinder (BackSide, 48 sides like the mask), depth `1.5 + 0.8·D`: a thin brown soil lip (the cut through the ground), then the hole colour fading to black                                                                                                                                                                                                                            |
| Bottom            | done   | black disc at the bottom of the walls, so nothing shows through                                                                                                                                                                                                                                                                                                                            |
| Rim ring          | done   | (width is capped in metres: at most 0.45 m outside and 0.35 m inside the edge, so big holes keep a slim rim) flat ring in the chosen colour 5 cm above the ground layers (a taller rim let grass show through at low camera angles), plus a thinner always-on-top overlay. It **breathes** (1.3 s cycle) and a soft **glow** ring around it breathes and **kicks on every item** swallowed |
| Level-up pulse    | done   | two rings expand and fade (up to 2.4× / 2.9× the hole) and the glow flashes with a big kick                                                                                                                                                                                                                                                                                                |
| Level-up flash    | done   | a pale disc over the hole fades out in 0.4 s on every level up (`flash` in `HoleMesh`)                                                                                                                                                                                                                                                                                                     |
| Swallow puff      | done   | 6-12 blocky dust cubes pop up where an item falls in, sized by the item (`render/puffs.ts`, one pooled InstancedMesh of 256, ring buffer, no allocation per puff)                                                                                                                                                                                                                          |
| Building fade     | done   | surfaces nearer to the camera than the hole and drawn within 1.8× its screen radius turn into a dither (88 % of pixels dropped, `FADE_FRAGMENT` in `render/materials.ts`, uniforms set per frame by `render/hole-fade.ts`). Off in the menu                                                                                                                                                |
| Score pop-up      | done   | DOM "+N" label at the projected item position, floats up and fades; white / yellow / orange / red by tier                                                                                                                                                                                                                                                                                  |
| Colour presets    | done   | Ocean `#2f80ff` · Lime `#7ed321` · Pink `#ff3d9a` · Orange `#ff8a00` · Violet `#8b5cf6` · Cyan `#19d3da` · Red `#ff3b30` · Gold `#ffc800`                                                                                                                                                                                                                                                  |

**How the hole is drawn (stencil):** (1) the mask disc writes stencil 1 inside the hole circle. (2) **Every ground
material** draws only where stencil ≠ 1 (`applyHoleCut` in `render/materials.ts`), which cuts a real opening into the
ground. That includes the **sea** (plane, ripple layers, foam ring) and the toy store's **void** plane: they sit at
y = -0.9 and would otherwise show through the opening and hide the walls below, so the hole would look like a pond. (3) The interior walls and bottom draw normally and show through that opening. (4) Items are drawn normally.
Below y = 0 they are hidden by the ground everywhere except over the opening, so falling items look like they drop into
the hole. The renderer is created with `stencil: true` (off by default in three.js).

### UI assets

All done in DOM + CSS (`game/hud.ts`, `game/menu.ts`, `game/hole.css`, no images): placeholder logo text, welcome /
difficulty / colour / scores / options / how-to-play + credits / pause / results panels, top-10 table, HUD (timer, score with the **island completion** next to it - percent of the map's points eaten plus a small bar, stacked under the score on narrow screens - level badge with
progress ring and "eats up to" label, pause button), joystick ring, countdown digits, "+N" pop-ups, "LEVEL UP" and
"ISLAND CLEARED" banners. Chunky rounded cards, large touch targets. The colour screen puts its card at the bottom and flies the menu camera down to the
demo hole, so you pick a colour on the real 3D hole.

### Audio (simple WebAudio synth, no files in v0)

Done (`game/audio.ts`): gulp pitched by size tier (a second low tone for big items), level-up chime, countdown beeps, time-up
horn, UI clicks; volume slider in options (0 = mute); `?mute=1` never creates the audio context (bots / tests). Not done: ambient loop.

## Debug tools

Every tool page uses `src/shared/debug-panel.ts` (left menu), `url-state.ts` (state in the URL) and
`stats-overlay.ts` (F3). Item and map viewers share `debug/viewer-shell.ts` (renderer, lights and the stencil-cut
ground are the **same** as in the game, so what you tune is what ships).

### 1. Item viewer – `item-viewer.html` (items **and** the hole)

`map=toy` switches the list and the lineup to the Toy Emporium catalog; `family=plush_panda` limits the lineup to ids
containing the text (every size of one plush family side by side).

Everything in the game is either an edible item or the hole, so one viewer covers all content.

- **List:** `Hole` at the top, then every catalog item grouped by level, with a filter box. Each row shows its size.
- **Modes** (`mode=`)
  - `single`: the item next to a hole of the item's first hole level (or `level=`), running the real sim.
  - `compare`: the item twice, once with a level-(L−1) hole (teeters, can't eat) and once with a level-L hole (eats).
    Checks the tier boundary visually.
  - `lineup`: every item (or one tier, `tier=`) in a row sorted by size, with name / level / points labels and a
    `pedestrian` for scale. The main tool for "does the size ladder read right?"
  - `hole`: only the hole, with `level`, colour, and scale references (pedestrian, sedan, bench).
- **Values:** hole level (0 = the item's own level), geometry variant, paint colour, hole colour, time scale
  (slow motion), lineup tier.
- **Actions:** Drop (the hole moves under the item and the real fall plays), Slide across (teeter test), Level-up at the
  rim (the hole grows while the item sits at the rim), Reset, **Stress test N×N** (instanced grid; read ms / draw calls /
  triangles in the F3 box), Copy item JSON.
- **Overlays:** bounds box, size ring (yellow) and fit ring (green, `D × 0.9` = largest size the hole eats), wireframe,
  1 m grid, **game camera preview** in an iPad landscape / iPad portrait / phone portrait frame at the hole level.
- **Info box:** id, group, catalog and built dimensions, size, size tier, first hole level, points, triangles, style, where it is placed.
- URL example: `?item=bench&mode=compare&variant=1&slow=0.25&bounds=1&gamecam=1&frame=phone-portrait`.
- **Size rules (preview, not saved)**: sliders for `SIZE_RULES.fit` / `heightFactor` (sim/progression.ts) and a size /
  points override of the selected item. They call `rederiveCatalog()` (items/catalog.ts), which re-derives size / tier /
  level / points of every item in place; the list, the scene and the info box redraw, and the info box counts how many
  items land on another hole level than shipped. URL params `fit`, `hf`, `size`, `pts` make a preview shareable; "Copy
  size rules" gives the numbers to paste into `SIZE_RULES_DEFAULT` or a catalog row. Changing real item sizes still
  needs a scores version bump.

### 2. Map viewer – `map-viewer.html`

`map=toy` shows the toy store (department overlay, points per department next to the content budget); the island sliders
are City Island only.

- Seed, island radius, coast noise, parks, litter density, downtown / commercial radius: the island regenerates live.
- Overlays: district colours, "show only tier N" filter. Click an item to inspect it (name, level, points, size,
  position). Click the ground to move the red marker (drawn at the hole size of the chosen level).
- **Content budget box:** item count, total points against the exact target (30 000 City Island, 25 000 Toy Emporium), tiers with fewer than 2 item types, items
  and points per tier, skyscraper count, start position; draw calls and triangles in the F3 box.
- **Game camera** at the marker for level L (checks framing over the real map); **Play from the red marker** opens
  `./?seed=&x=&z=&level=&difficulty=medium`.

### 3. Balance – `balance.html`

- Runs the **headless sim** (same `sim/` code as the game) with the **bot** over N map seeds per difficulty. Skill
  presets `casual` / `good` / `perfect`; `map=city|toy|animal` picks the map.
- Output: table (level p10 / median / p90, median score, items eaten, % of the island, cleared count), level and score
  over time with the p10–p90 band, the live level table. "Copy results as JSON".
- Knobs live in `TUNING` (`sim/progression.ts`: items to fill the bar at level 1 / level 14, speed, growth XP). The
  **Tuning** panel edits every knob live (sliders, the level table below the results updates at once), mirrors them in
  the URL as `t_<name>` (`balance.html?t_itemsFirst=12`), has "Reset" and "Copy tuning" (the object to paste back into
  `progression.ts`); "Copy results as JSON" includes the tuning that produced the numbers.
- **Targets:** good bot Hard ~level 10–15, Medium reaches level 15 well before the end, Easy cleared with time to spare. `tests/hole/sim.test.ts`
  keeps the bands.

### 4. In-game debug (play page)

- URL params: see "Dev params".
- `F2` / 3-finger tap: debug HUD with state, level, diameter (animated and target), XP, score, items remaining, speed,
  position, stick and camera values, plus sliders for camera distance / pitch and joystick `maxDragPx` / dead zone.
- `F8` bot autopilot · `+` / `-` level · `T` freeze the timer · `F9` portal thumbnail (dev server).
- Console: `__hole.benchmark(240)` (average and worst ms per frame incl. GPU, works with the tab hidden),
  `__hole.advance(seconds)` (steps the game without animation frames: background tabs, scripted checks),
  `__hole.sim`, `__hole.setLevel(n)`.
- **Screenshots** (README, the menu map cards): there is no screenshot tool, so grab the game canvas from the page
  with `__hole.game.captureCanvas()` (renders one frame), draw it into a 1280 x 720 canvas, POST the JPEG data URL to
  `/__dev/thumbnail?game=hole` (the dev endpoint behind `F9`, it always writes `src/games/hole/thumbnail.jpg`) and move
  the file into `screenshots/`; restore the portal `thumbnail.jpg` afterwards. Open the game with `quality=high&mute=1`,
  pick a pose with `__hole.setLevel(n)`, `__hole.sim.hole.x / z` and `__hole.game.rig.snap()`, drive the bot with `F8`.
  The menu cards are 640 x 360, the README shots 1280 x 720.
- `F4` (or the "eat rings" button in the debug HUD, for touch): eat-rule rings (`debug/eat-rings.ts`) - a ring of the
  gameplay size around the nearest idle items, green = the current level can eat it, red = too big, with a label of the
  item's hole level (`L7`). With the debug HUD on, the joystick also prints its vector, magnitude and drag distance
  next to the finger.

### 5. Tests – `tests/hole/` (rstest, node)

- `progression`: diameter growth, points table, XP curve, eat rule and tier derivation.
- `clip`: no z-fighting faces and no fully buried parts in any item (see "Geometry budgets").
- `items`: every level 1–25 has ≥ 2 item types, ids unique, points follow the tier table, **every builder matches its
  catalog size (footprint ±15 %, height ±10 %), stays on the ground, stays in its triangle budget, and paint parts
  match the `paints` list**.
- `map`: deterministic per seed, every item is on the island, every tier has ≥ 2 types placed, total points ≥ 2× XP (and every hole level has ≥ 2 item types too), the
  start has small items nearby.
- `spawn`: every City item has a `SPAWN` row; zone lookup; for 5 seeds every placement stands on ground its row allows and
  no non-vehicle footprint touches a road; bus / tram only on the road.
- `sim`: eating, teeter, level-up carry, speed and island clamp, clear bonus, time-up, fall determinism, identical bot
  runs, and the balance bands.
- `game`: joystick maths (dead zone, clamp, direction, follow-origin), top 10 per difficulty (insert, order, tie-break,
  cut-off).
- `toy-items`: every toy tier / level has >= 2 types, the three required plush families exist at six sizes, builders
  match the catalog size, stay on the ground, keep their paint lists and triangle budgets. `toy-clip`: no z-fighting, no
  mostly-buried item (same checker as `clip`). `toy-map`: deterministic, exactly 25 000 points, every type placed, tiers /
  levels covered, start busy, layouts B and C, balance bands for the good bot, every item reachable by a hole of its level.

- `kit-ball`: the round primitive (radii, triangle count, domes, eggs, seeded jitter, outward faces, clip checker coverage).
- `movers`: moving items (leash, ground rules, determinism, the spatial hash follows them, flee, speed cap, 2 500-mover tick).
- `animal-items`: every animal tier / level has >= 2 types (P0 alone covers every tier), the 16 giants, every builder
  matches the catalog size, stays on the ground, keeps its paint list and triangle budget, no z-fighting, no buried part.
- `animal-map`: deterministic, exactly 21 000 points, every type placed, tiers / levels covered, 37 giants (14 in the paddock),
  movers bounded and on the right ground, a busy start, balance bands for the good bot.

## Architecture

```
src/games/hole/
  game.json            pages: play, item-viewer, map-viewer, balance
  TOY-STORE.md         Toy Emporium: design, asset roster, open tasks
  README.md, DETAILS.md, TASKS.md, thumbnail.jpg
  pages/               play.ts, item-viewer.ts, map-viewer.ts, balance.ts
  sim/                 DOM-free + three-free -> tests, bot, balance page run it in node
    progression.ts       D(L), points, XP, camera / speed formulas, TUNING (single source of truth)
    eat.ts               commit radius, teeter amount
    fall.ts              idle -> tipping -> falling -> gone (pose function, seeded)
    world.ts             item instances (struct-of-arrays) + 8 m spatial hash (movers re-bucket)
    movers.ts            moving items: wander / hop / swim / trail / patrol / roam, awake set, flee
    sim.ts               fixed-step update: hole motion, island clamp, commit, XP / level-up, score, clear bonus, events
    bot.ts               greedy autopilot + runBot()
  items/
    catalog.ts           ItemDef table; size / level / points derived
    kit.ts               Mesher (box / cyl / gable / hip, transforms, vertex colours, window UVs) + palette
    build-small.ts, build-vehicles.ts, build-buildings.ts   procedural builders per item (City Island)
    catalog-toy.ts       Toy Emporium catalog (data); builders: build-plush / -toys / -toyveh / -landmarks.ts, kit-toy.ts helpers
    builders.ts          registry + geometry cache
  map/
    types.ts             MapData, coast helpers (inside / clamp)
    generate.ts          seed -> coast, roads, blocks, districts, every placement
    spawn.ts             City spawn zones (road / sidewalk / lot / park / beach / lawn), SPAWN table, zone map
    minimal.ts           tiny map for viewers / tests
    registry.ts          MapDef per playable map (generator, points, mood, menu camera)
    toy/                 Toy Emporium: layouts.ts (floor plans), generate.ts
    animal/              Animal Island: biomes.ts, generate.ts (coast, biomes, rivers, compound, hills, fill)
  render/
    renderer.ts          renderer (stencil on), quality tiers, sun + sky light + fog, shadow box follow
    materials.ts         item materials (window tiles, paint patch), hole stencil cut / mask
    ground.ts            ground, sand, skirt from MapData (City Island); soup.ts = the triangle-soup builder (flat quads, discs, boxes)
    water.ts             sea, drifting ripple layers, foam ring (animate(seconds))
    city-decor.ts        curbs, roundabouts, road decals, rocks, pier (render-only, derived from MapData)
    toy-ground.ts        toy store floor, skirt, void, walls; map-ground.ts picks the right one
    hole-mesh.ts         mask disc, walls, bottom, rim, level-up pulse, colour presets
    item-instances.ts    one InstancedMesh per item type + variant; only moving items are rewritten
    camera-rig.ts        follow camera, distance / pitch per level, portrait factor
  game/
    hole-game.ts         menu <-> run loop, fixed step + interpolation, events -> HUD / audio
    input.ts, stick.ts   floating joystick + keyboard; the maths is separate and tested
    hud.ts, menu.ts, dom.ts, hole.css
    scores.ts, settings.ts, storage.ts   localStorage with an in-memory fallback
    audio.ts, ios.ts
  debug/                 viewer-shell.ts, station.ts (item + hole running the real sim)
tests/hole/
```

**Performance** (measured on the dev machine's software renderer, so only the counts matter). Targets for real
devices: 60 fps on an iPad (A12 or newer), 30+ fps on a mid-range phone, pixel ratio capped at 2 (1.5 on `low`).
What is in place:

- **Chunked culling** (`render/item-instances.ts`): items are one `InstancedMesh` per type + variant + 64 m map cell, each
  with a bounding sphere (cell + 14 m for items sliding into the hole) and `frustumCulled` on. The camera and the sun
  shadow draw only the cells they see. Measured triangles per frame (`low`, no shadow pass): 434k -> 70k at level 1,
  97k at level 8, 164k at level 15 (draw calls 107 / 175 / 342; they grow because the view covers more cells).
- **Adaptive resolution** (`adaptResolution` in `game/hole-game.ts`): during a run, a smoothed frame time above 24 ms
  steps the render scale down (x0.88 every 1.5 s, floor 70 %); below 18 ms for 6 s it steps back up.
- **Idle frame cap**: menus, pause and results render at ~30 fps (the sim of the menu demo still steps in real time).
- CPU is not a bottleneck: one sim tick costs 0.03 ms (level 1) to 0.11 ms (level 15) with the bot.

If a device is still too slow, in this order: hide tiny tiers (1-3) beyond a camera distance, cheaper shadows (smaller
box on `low`), merge the road dashes / zebra stripes into a texture (they are ~12k triangles of the ground mesh).

## Feature iterations (after v0)

- **Enemy holes**: AI holes that move around the map and eat the same items. You can eat a smaller hole, and a bigger
  hole can eat you. **Out of scope for v0.** Keep `sim/` ready by putting hole state in a list (one player hole in
  v0), and keep the bot as the base for enemy AI.
- Moving content on the other maps: the mover engine ("Moving items") exists now, so walking pedestrians, driving cars and buses on the road graph, boats on the water, carousels are a `MoveSpec` away.
- More maps: forest, farm, harbour, desert, winter (add a `MapDef` to `map/registry.ts` + a generator; the menu picker and per-map scores already exist).
- Rigid-body falling (Rapier) for better tumbling and stacking, if mobile performance allows.
- Combo multiplier (eat quickly in a row), time-bonus pickups, temporary "magnet" or "speed" power-ups.
- Initials on high scores, online leaderboard, daily seed challenge.
- Hole skins (patterns, animated rainbow rim), unlocked by score milestones.
- Night mode with glowing lamps and windows. Animated fountain water.
- Rotating camera (two-finger twist) as an option.

## Open questions

- Final game name (the placeholder "Hole Island" avoids the trademark).
- Should XP stay equal to points, or follow a volume-based curve? Decide after the balance page has real numbers.
- Top-10 lists are per difficulty (spec). The storage key already includes the map (`hole.scores.<map>.<difficulty>`),
  so adding more islands later needs no migration.
