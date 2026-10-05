# Gravel Rally - details

> Overview and screenshots: [README.md](README.md). This file holds the details.

Point-to-point gravel rally. Target look: late-2000s rally game (sun + shadows,
sky/IBL, fog, dense forest, dust). Target feel: grounded sim-lite physics that
is still fun on a keyboard.

## Pages & URLs

| Page        | URL                                                                                              | Notes                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main menu   | `/games/rally/`                                                                                  | welcome -> select stage -> select car -> (setup car) -> drive; options (see "Game flow")                                                                                                                                                                                                                        |
| Play        | `/games/rally/?map=test&car=skoda_rally&livery=3&tyre=gravel&susp=soft&spawn=start&quality=high` | `tyre`: `tarmac` / `mixed` / `gravel`, `susp`: `soft` / `medium` / `stiff` and `gear`: `short` / `medium` / `long` (defaults = the stage's recommended tyre + its matching set-up + the map's gearing, else medium); `spawn`: `start`, a flat-area name (`pad` = free-drive test pad), or metres along the road |
| Map viewer  | `/games/rally/map-viewer.html?map=test&grid=1&splat=1`                                           | aerial view, click terrain to inspect, "Drive from here"; real maps: lat/lon + Google links                                                                                                                                                                                                                     |
| Car viewer  | `/games/rally/car-viewer.html?car=skoda_rally&seed=5&steer=0.5&susp=0.4&hull=1`                  | livery seed, paint, door plate (`num`, `rally`), pose, physics hull, torque/power chart, "Test drive"; free camera `cam=x,y,z&look=x,y,z&fov=<deg>&clean=1` + Pose -> "Copy camera link" (share an exact view; the map viewer and asset debugger have the same button + params); Wheels section (`debug/wheel-debug.ts`): `wheels=1` overlay - fixed hub crosshair + tyre (cyan) / bead (yellow) circles, red spin pointer, the body's arch fitted as a circle (magenta) with its offset / gap per wheel - `wangle=<deg>`, `tyres=0` / `rims=0` / `brakes=0` / `body=0`, `wcam=FL\|FR\|RL\|RR` = near-orthographic view along that axle                                 |
| Asset debug | `/games/rally/asset-debug.html?asset=pine_tree&lod=1&grid=20`                                    | every asset / car (`car:<id>`) / texture (`tex:<id>`); seed, variant, LOD, instancing stress                                                                                                                                                                                                                    |

All tool-page variables are mirrored in the URL. `H` hides the left panel, `F3` shows stats.

`?display=auto|sdr|hdr` (every page; also in the options menu, saved in localStorage): on an HDR monitor the browser
shows this SDR canvas at the OS's "SDR content brightness", so sunlit white paint glares - `hdr` lowers the
tone-mapping exposure (`engine/display.ts`, x0.68); `auto` follows the `dynamic-range: high` media query.

### In-game keys

`W/S` throttle / brake (hold S when stopped = reverse) · `A/D` steer · `Space` handbrake ·
`R` reset to road · `C` camera · `Esc` menu · `Q/E` shift (`G` toggles manual) · `T` traction/stability assist ·
`M` mute (`?mute=1` starts muted - bots / tests) · `F2` telemetry · `F3` stats · `F4` force vectors + hull · `F8` autopilot · `F9` save portal thumbnail (dev).
Gamepad (standard mapping): RT/LT throttle/brake, left stick steer, A/X handbrake, B reset, Y camera, LB/RB shift.
Menus: d-pad / left stick, A confirm, B back (`game/pad-nav.ts`). The stick only navigates after it has been seen
near centre and uses hysteresis, so a drifting stick or an off-centre device axis (wheel pedals) can't scroll the menu.
Touch (phone / iPad, `game/touch-controls.ts`): on-screen ◀ ▶ steer (left thumb) and BRAKE / GAS (right thumb) plus a
pause button; a finger can slide between buttons. They feed the input as virtual keys, so touch gets the keyboard's
speed-sensitive steering. Touch devices are landscape only: the first tap tries fullscreen + orientation lock (Android);
otherwise a portrait screen gets `html.force-landscape`, which turns `#root` 90° (iPad Safari can't lock orientation).

### Game flow

- **Main menu** (`/games/rally/` with no `map` / `car` / `livery` / `spawn` param): welcome screen (Start rally /
  Options / About; no portal link inside the game) -> **select stage** (the background switches to an aerial 3D render
  of the selected map with the stage ribbon + start / finish poles; route outline, length, splits, best time) ->
  **select car** (specs,
  livery, best time on that stage) -> a summary line of what the stage will run with (tyres + suspension, "recommended" or "custom") and two buttons:
  **Start stage** (recommended tyres + set-up - what most players use) and the optional **Setup car** screen (tyres + suspension
  as two big rows of picker boxes with the part rendered live inside, grip chips and spring data per car; nothing is saved, it resets to the recommendation per stage / car)
  -> loads the stage. Keyboard: arrows, Enter, Esc = back (car screen: ←/→ livery; setup screen: ↑/↓ switch row, ←/→
  change the choice). See "Setup screen" below and [`PHYSICS.md`](PHYSICS.md).
  The selected car turns on a 3D showroom behind the panel (`game/showroom.ts`, disposed before the stage loads).
  Map renders are a cache per map, warmed up in the background from the welcome screen on. A map is shown once its
  terrain is built (one mesh, `world/aerial-terrain.ts`, ~8 m cells / 512 along the long side at most, + stage ribbon;
  until then the previous view stays), then roads (`roadMeshJob`) and scatter fill in. Maps up to 8 km²
  (`LARGE_MAP_AREA`) show their real trees / rocks / buildings (finished parts are drawn once off-screen so the GPU
  upload happens during the warm-up). Larger maps get a **map card** (~75k triangles, 5 draw calls): thinned scatter
  (`previewMap`: density x 8 km² / area, rocks dropped), trees as green canopy circles (`world/aerial-trees.ts`, radius
  x 1/sqrt so woods cover the same ground), and terrain + roads + trees + buildings rendered straight down with the
  map's lighting into a 2048 px half-float texture (`Showroom.bake`), shown unlit on a coarse ~34k-quad terrain mesh
  (`CARD_QUADS`, `CARD_TEXTURE`); the detail meshes are freed after the final bake. Console: `__rallyMenu.showroom`.
- **About**: short game description + every external resource with links, grouped per map (`MapDef.sources`) and
  per car (`CarDef.sources`), plus "built with" and the game version.
- **Version**: `version` in `game.json` (semver 0.x.y, see AGENTS.md), shown bottom left over every menu screen
  (`.menu-version`) and on the About screen.
  The choice is mirrored in the URL, so a reload restarts the same stage; any of those params skips the menu
  (deep links from the map / car viewers). The menu always opens on the default car (Skoda Rally); the last map + livery are preselected next time.
- **Options** (main menu and pause menu, `buildOptions` in `game/menu.ts`): graphics quality (reloads a running
  stage), volume, gearbox auto / manual, traction assist, **car number** (1-99, on the rally door plates),
  starting camera. Stored in `rally.settings`
  (`game/settings.ts`, quality keeps its own `rally.quality` key); applied live via `RallyGame.applySettings`.
  The in-game toggles `C` / `G` / `T` save too.
- **Pause** (`Esc`): resume, restart, free drive pad <-> stage, options, main menu (reloads into the menu).
- **Time penalties**: manual reset +2 s, off-stage forced reset +5 s (`PENALTY_RESET` / `PENALTY_CUT` in `game/stage.ts`), added into the stage time and shown red as `(+7s)` next to the time on the results card and in the top 10.
- **Results**: your time in a large highlighted card (delta to best + sector chips, green / red vs the best other run in the selected All cars / car scope), **top 10** for the stage, toggle
  all cars / this car (your run highlighted with "YOU"; shown under a gap with its rank when outside the top 10); every
  row has its sector times underneath (`S1 .. Sn`, from the run's cumulative `splits`; old runs show none). Wide
  two-column window (up to 1180 px / 94 % of the screen: time + buttons left, leaderboard right; one column under 860 px,
  scrolls when taller than the screen); the table has columns `# · Time · Car · Tyres · Suspension · Gearing · Gap`
  (`–` = not recorded: older runs, the Zastava's fixed gearing).
  Leaderboard per map in `rally.times.<map>` (fastest 10 runs per car; old per-car bests are folded in once, and
  dropped again if they are the run just driven) - `loadTimes` / `recordTime` in `game/stage.ts`. Free drive (`spawn=pad`,
  or `spawn=<metres>` = free drive from that point on the road: no clock, no splits) is never ranked. **Times are versioned**: `TIMES_VERSION` in `game/stage.ts` (saved in
  `rally.timesVersion`); when it differs on game start (`purgeStaleTimes`, called from `pages/play.ts`) every `rally.times.*` /
  `rally.best.*` entry is erased. BUMP it whenever physics / penalties / a map's road change (v1 = tyre / set-up / gearing rework); rows show the tyre + set-up used (`RunRecord.tyre` / `susp`; one board per map, all tyres share it).
  Drive again (Enter) or main menu.

### Stage flow

- **Hold**: the car is held (auto handbrake, HUD `HOLD`) whenever it's stopped with no pedal pressed - on the start line,
  after a reset, on hills. Throttle releases it (brake = reverse). `Vehicle.autoHold` / `holding`; static friction
  while held so it doesn't creep on slopes. Test: "auto-hold: no roll-back on a slope" (12% slope, < 5 cm in 3 s).
- **Sector bar** (top-left): one segment per sector (start / splits / finish), sized by sector length. Amber = in
  progress; finished sectors turn green when faster than your best run, red when slower (white = no best yet),
  tooltip = delta. `StageTimer.sectorBounds / sectorTimes() / referenceSectorTimes()` (reference = best at the start
  of the run). Bests per map + car in localStorage.
- **Cutting the stage** (`StageTimer.updateCut` in `game/stage.ts`, running stages only): distance is measured beyond
  the road edge to the stretch of road within ±40 m of the progress (`Road.queryRange`, so a hairpin's other leg
  never counts). Up to `CUT_WARN` (20 m; 10 m = strict) is allowed corner cutting. Past it the HUD shows
  `OFF STAGE — return to the road 3`; the grace timer (`CUT_GRACE` 3 s) only runs while the car isn't closing on the
  road (> 1 m/s), paused - not reset - while heading back. Grace used up, past `CUT_MAX` (40 m), or on the tarmac
  of a later part of the road (`SHORTCUT`) = the car is put back where it last left the road (within 2 m of the
  edge), progress rolled back to there ('cut' event). Manual reset (`R`) during a stage also uses the local road.
  Tests: `tests/rally/stage-cut.test.ts`.
- **Finish**: after the line the car brakes itself to a stop on the road run-off and stays held
  (`finishStopControls()` in `game/autopilot.ts`: follows the road, no throttle, progressive brake). Maps need a
  run-off past the finish (`stage.finishFromEnd`; test map ~175 m). Test (`stage.test.ts`): stops from ~140 km/h
  within ~130 m, upright, on road / verge, held.
- AI controls (autopilot + finish stop) run per physics step (240 Hz) in game, same as in the tests. The autopilot
  speed plan knows about crests (no braking in the air), so corners after a jump get enough braking distance.

### Maps

| id          | name                 | notes                                                                                                                                                                                                       |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`      | Test Map             | procedural 1.7 km forest gravel stage, hairpin, crest jump, test pad                                                                                                                                        |
| `ajvatovci` | Ajvatovci Hill       | real world (Ilinden, North Macedonia), 4.5 km dusty tarmac, baked from OSM / WorldCover / DEM                                                                                                               |
| `jackie`    | Jackie Robinson Pkwy | **TEST** - real world, New York, 7.3 km parkway tarmac; USGS lidar terrain, divided highway with bridges / overpasses, Kew Gardens interchange at the end, mesh buildings from OSM heights (220 m corridor) |
| `petralica` | Petralica            | real world (Ginovci -> Petralica -> Vila Ristovski, North Macedonia), 9.6 km gravel mountain stage, 560 m of climb; baked from OSM / WorldCover / Copernicus DEM, two road parts traced, houses generated   |

Real-world maps are baked by `scripts/realmap/bake.py` (see the rally-maps skill). World axes: +X east, **+Z south**.
One folder per map: `maps/<id>/map.ts` (+ baked `data.json`, `TODO.md` task list, `README.md` overview + data credits, `DETAILS.md` with every source link,
licence and reference used); format + shared helpers in `maps/shared/`. Open work per map lives in its `TODO.md`
(index in `TASKS.md`).

Real-world map features (engine side, first used by `ajvatovci`):

- `terrain.heightmap` (bicubic int16 grids: detail + horizon), `landcover` (cover-class splat + field patchwork),
  `paths` (other roads as tarmac ribbons / dirt paint / carved canals, with tarmac / dirt physics), scatter
  `cover` / `rows` / `minPathDist`, roadside `minRadius`, `road.texture`, `environment.groundTint`, `MapDef.geo` /
  `credits` / `sources`.
- Junctions: the baker cuts side roads short of the stage road; `world/junctions.ts` (`connectPaths`, run by
  `TerrainGenerator`, result in `gen.junctions`) extends each end along its own direction until it reaches the stage
  road (drawn on top), skipping paths flagged `junction: false` (grade-separated crossings) and bridge decks. `MapDef.junctionBarriers`
  (`{ asset: 'road_barrier', length, setback, minWidth }`) closes each mouth with a row of barriers across the side
  road (`World.junctionInstances`, solid, kept `setback` m clear of the road edge). Tests: `tests/rally/junctions.test.ts`.
- Side roads are carved like real roads (`TerrainGenerator.buildPathProfiles`): each `paths` way gets its own height
  line (land along the centreline, smoothed + grade limited per OSM kind in `PATH_PROFILE`: motorway 220 m / 4 %,
  village street 40 m / 14 %, ...; smoothed together with the ways it continues into, since OSM splits roads into
  many ways), then - widest road first - eased to the height of the stage road / wider roads it meets or crosses.
  The terrain is flat across the road and blends back to the land within `PATH_REACH` (10 m) of its edge. Scatter
  keeps off side roads (`minPathDist` default 1.5 m solid, 0.4 m grass / plants). Tests: `tests/rally/side-roads.test.ts`
  (flat across, no elevation-model bumps along, no grass cards on them).
- Canals / drains / rivers (`paths` with surface `water`) hold water: each channel gets a bank line (land smoothed
  over 80 m, then made to fall steadily from its higher end), the banks are cut into / built up to it and the bed
  is `CHANNEL_DEPTH` (per kind) below; the water surface (`world/water-mesh.ts`, built with the road meshes) is a
  flat ribbon half the depth below the banks (`gen.channelWaterLevel` / `waterLevelAt`), its edges tucked under the
  banks; ripple normal map `water_normal` drifts, the sky is reflected. Road crossings sit above the water (bridge /
  culvert). Tests: `tests/rally/water.test.ts` (water along the whole channel, between bed and banks, never uphill).
- Lakes / ponds / reservoirs (`MapDef.lakes`, baked from OSM `natural=water` / `landuse=reservoir` polygons; river
  areas skipped): `world/lakes.ts` (signed distance to the shore). One flat level per lake = median land height along
  the shore - `LAKE_RIM`; the basin drops to `LAKE_DEPTH` over `LAKE_SHELF`, a `LAKE_CREST` wide rim (a dam on the
  low side) sits `LAKE_RIM` above the water, then blends back to the land. Water mesh = the polygon at that level;
  mud bed, muddy shore splat, no scatter in the water, same water physics as the canals.
- Season look per map: `environment.groundTint` (`grass` colour + `amount`, `crop` = ripe crop colour). Splat weight
  a field palette entry leaves unused (sum < 1, e.g. `[0, 0, 0, 0]`) is drawn as ripe crop (wheat) and drives like
  grass. Detail grass cards: `grass_tuft` (olive, untinted ground), `spring_grass` (bright green), `dry_grass`
  (golden). `ajvatovci` = spring (green meadows / young crops, a few ploughed + wheat parcels).
- Buildings: two placeholder assets, `building_flat` (flat roof: sheds, shops, blocks, halls) and `house_pitched`
  (red tile hip / gable roof, 1-2 floors); unit footprint scaled per instance (`sx/sy/sz`), `box` collider. Stable
  ids numbered along the route -> `stage <n> - building <N> - <lat>, <lon>` (`buildings.csv`, map viewer
  `?building=N`). Scatter avoids buildings.
- **Stage signs** (every map, automatic - there are no start / finish props to place): `world/stage-signs.ts` derives them from
  `MapDef.stage` + `name` + `year` (+ `stageNumber` for the SS badge). Inflatable **start / finish gantries** (width follows the
  road and any barrier; header with START / FINISH badge, the map name and the year, pillar sleeves, a timing clock, flags), and a **pair of temporary A-frame split boards** ("SPLIT n, SECTOR n > n+1,
  km from the start") standing on the ground at least 3 m beyond the road edge (and any barrier) at every split - the sector markings of a real stage; nothing is painted on the road, and the boards are
  yawed towards the oncoming driver. Colliders: pillars + A-frame footprint boxes (`tests/rally/stage-signs.test.ts`). Look: `?spawn=<along>`
  just before `stage.start` / a split / `stage.finish`. Bump `MapDef.year` for a new edition.
- **Landmarks** (`MapDef.landmarks`, registry `world/landmarks.ts`): hand-modelled groups that replace the placeholder
  buildings under them - lots with real window / door openings, yards, fences, kerbs, poles, trees and instanced parked
  vehicles. A landmark is a map-folder module (first one: `maps/ajvatovci/start-row/`, the Ilinden industrial street at the
  start of `ajvatovci`, see its DETAILS.md) with `replaces()` (hides placeholders), `occupies()` (keeps scatter out),
  `colliders()`, `instances()` (rally tree / bush assets as fixed scatter) and `build()` (time-sliced geometry job in
  `buildRoadMesh`). **Pads** (`TerrainDef.pads`, `world/pads.ts`, applied in `terrain-gen.ts`): a polygon graded level across
  the street and following the stage road's height along it (frontage knots every ~10 m) - how a lot sits flush with
  its sidewalk; built after the road so the road profile is unchanged. A landmark can also give `groundOverride()`
  (raises `World.sampleGround`, so kerbs / sidewalks are physical for the wheels) and fence / pole colliders. New textures: `engine/lot-textures.ts` (`lot_*`).
- City maps (first used by `jackie`, see `maps/jackie/DETAILS.md`) add:
  - **Highways**: `route.highways` lets the baker route along one-way motorway / parkway carriageways (direction
    respected); the opposite carriageway and the ramps are ordinary `paths` (kind `motorway` / `motorway_link`, width
    from `lanes`). The paths carry `bridge` / `layer` / `lanes` / `oneway` / `name`. Mainline motorway ribbons use the
    `road_parkway` texture (yellow / white edge lines, dashed lane line, 12 m per repeat; `pathTexture` in road-mesh.ts).
  - **Bridges of the stage road** (`RoadDef.spans`, baked `routeSpans` from OSM `bridge=yes` on the route): the deck is
    straight between its abutments (`Road.straightenBridges`), `TerrainGenerator.height` is the GROUND UNDER the deck
    (no embankment, land dropped to >= 5 m below, fill ramps down over `BRIDGE_RAMP`), `deckHeightAt` / `surfaceHeight`
    are the deck; `World.sampleGround` / `heightAt` / `AnalyticTerrain` drive on the deck, the road mesh follows it, and
    `bridge-mesh.ts` adds girder fascia + underside. Streets / rail run beneath: the baker keeps ways under a bridge span
    uncut. Test: `tests/rally/bridges.test.ts`.
  - **Decks of other roads** (`PathDef.bridge`, OSM bridge=yes: overpasses, interchange ramps, `layer` 1 / 2): not carved
    into the ground (`carvePaths` / splat / surface skip them), profile built in a first pass lowest layer first
    (`buildPathProfiles`: parallel carriageways locked to the stage road, `lift` = raised >= 5.6 m over whatever crosses
    beneath, raise-only grade limit), ground roads afterwards ease to the deck ends (approach fill). Drawn by
    `bridge-mesh.ts` (road surface, parapets, girders); `World.deckPiers()` stands piers (drawn by the bridge builder, solid) every
    ~24 m (not on roads); decks are visual only (no collider on the deck itself).
  - **Barriers**: `MapDef.barriers` (`{ kind: 'jersey' | 'guardrail', side, offset, onBridge, skipJunctions }`) are
    continuous: `world/barriers.ts` lays out the runs (broken at bridge spans / ramp mouths) and their box colliders,
    `barrier-mesh.ts` sweeps the Jersey profile (texture `barrier_jersey`, a joint every 4 m) or the W-beam rail
    (+ posts every 2 m) along the road edge as one smooth mesh per ~100 m. (Assets `concrete_block` for piers,
    `jersey_barrier` / `guard_rail` 4 m props remain for hand placement via `roadside`.) Roadside rules also have
    `onBridge` / `skipJunctions`.
  - **Ribbon precedence**: stage road > mainline highway ribbons (`road_parkway`) > other roads (polygon offset by
    material layer; path ribbons sink under the stage road where they overlap, so merging ramps never paint over
    its lane lines). The baker keeps the opposite carriageway whole (only pieces ON the route are cut) and limits its
    width to the room beside the stage road.
  - **Mesh buildings** (`BuildingDef.kind`, baked from OSM with the NYC roof `height`): `world/building-mesh.ts` extrudes
    the real footprint outline (`poly`), facade textures `engine/facade-textures.ts` (one 3.2 m bay x floor tile, tinted
    per building by vertex colour), flat roofs with parapet / bulkhead / water tank or gable roofs (houses, churches,
    tombs); merged per 128 m tile and facade. Colliders are the footprint boxes (`ScatterField.addFixedCollider`).
    Classes (baker `classify_kind`): house, row (terraced = shares a side wall), apartment, commercial, industrial,
    garage, church, tomb. Buildings without `kind` keep the old placeholder instances (ajvatovci, petralica).
  - Map options: `terrain.rockSlope` (where bare rock replaces ground cover), `RoadDef.texture: 'road_parkway'`.
  - **Opposite carriageway** (`MapDef.pathBarriers`): the other carriageways are `paths`, so they get their own barriers:
    `barriers.ts` `pathBarrierRuns` lays a Jersey wall on the median side (another carriageway / the stage road within
    `medianReach`) and a guard rail outside, broken where the barrier would stand on the stage road or on another road
    (ramp mouths, merges). Runs follow a path (`BarrierRun.path`), `barrier-mesh.ts` / colliders use `frameAt`.
    `pathTexture` gives every mainline carriageway >= 5.5 m the `road_parkway` lane markings.
  - **Interchange rules** (Round 4, the "mess" fixes - keep them when touching decks / terrain):
    - A road that is drawn always wins: terrain around a road fits it (`carvePaths` blends the nearest TWO paths, `PathNetwork.queryTwo`,
      so the ground between two roads never tears); a bridge over nothing sits on solid ground (`crossingNear`: the pit under a span only
      exists where a street / channel passes beneath).
    - Crossing test = angle: a street counts as crossing a deck when `|cos| < CROSS_COS` (0.93, ~21 degrees) - `lift` and the underpass dip
      use the same value, so shallow ramps are lifted as well.
    - Clearance under a bridge is `BRIDGE_CLEARANCE` 10 m for streets (deck lift over a lower road stays `DECK_CLEARANCE` 5.6 m). The lidar DEM contains the
      decks as ground, so the depth is a rule, not measured. Drivability depends on the GRADE, not the length: the dip is a V along the street
      (`dipUnderBridges`, `DIP_GRADE` 5 %, ~200 m each side, found from the deck positions) and only for ground streets
      (`underStreet`: not motorway / trunk / links / decks). Checked 2026-10-04: every street under a stage-road bridge sits 10.0 m under it, max 5 % along the dip.
    - Deck clean-up before profiles (`under-bridges.ts`): `dropDuplicateDecks` (same kind + layer, >= 60 % of the shorter inside the longer),
      `trimMergingDecks` (the narrower deck's end that lies inside a wider deck is cut). `tests/rally/city-maps.test.ts` "no two decks lie on top
      of each other" guards it.
    - Drawing overlapping decks (`bridge-mesh.ts` `Coverage`): where a deck edge / end lies inside another deck at the same height its fascia,
      parapet, pilasters, joints and abutment are skipped, and the narrower road surface is drawn 1.2 cm higher per overlap (no z-fighting).
    - Divider / barriers under a bridge never stop (runs end exactly where the next rule's run begins); the opposite carriageway is never closed by a
      junction barrier row.
  - **Lane drops** (`PathNetwork.halfWidthAt`): where a carriageway continues into a way of another width (or a short bridge
    deck of another width) both ribbons taper to the mean over 45 m (ribbons, deck rows, barriers use it), no notch.
  - **Bridge builder** (`bridge-mesh.ts`, one builder for stage-road spans and other roads' decks): fascia girders, a
    recessed soffit with a row of beams, stone parapets with pilasters (decks), dark expansion joints, stone-faced abutments
    with returns that taper into the slope and wing walls retaining the approach fill (`bridge_stone` / `bridge_concrete`
    textures); piers (`World.piers`, column + cap beam, solid) come from `deckPiers()`.
  - **Streets over tunnels** (`under-bridges.ts`): OSM tags the parkway `tunnel=yes layer=-1` where a street crosses
    over it (`RoadDef.spans` kind `under`) but the street is an ordinary way cut at the stage road. `bridgeOverUnderSpans`
    rejoins the two halves and turns the stretch over the parkway into a deck (`bridge: true, layer: 1`), so the existing
    deck profile pass lifts it >= 5.6 m clear and the bridge builder draws it.
  - **Portals** (`world/portals.ts`, Round 5): every `under` span is ONE cut-and-cover structure - a slab wall to wall (the far
    wall beyond the opposite carriageway included) at road + 5.6 m, soffit with cross beams, stone headwalls with a concrete
    lintel at both ends carrying a green street-name plate (the widest named deck crossing it) and white clearance plates
    (feet-inches of the real soffit height, `engine/structure-textures.ts`), parapets with railings along the long edges
    (open where a street deck crosses), square piers in the median where there is room (`World.deckPiers`, `cap: false`).
    The land around is a pad at the slab top (`Portals.padRaise` in `naturalHeight`: the lidar holds the trench floor under a
    wide structure); carriageways, ramps and streets running inside the trench footprint (a third of their length or more)
    are not raised. Decks crossing a slab (`isPortalDeck`) are streets at grade: lifted onto the slab (+0.2 m), never over
    streets, nothing dips under them, drawn without fascia / parapets / abutments inside the footprint (Coverage). No
    junction is made with the stage road inside any span (`junctions.ts`). `RoadDef.trenchFills` pads a stretch the same way
    where the DEM has a void (Jackie 7 035-7 186 m: the land read 5-10 m below the road). Tests: `city-maps.test.ts`
    "portals". Under the slab: emissive strip lights (`MeshBasicMaterial`, two rows over the carriageways every 7 m), and a
    yellow advisory-speed plate (`advisoryPlateTexture`) on the entry headwall next to the clearance plate.
  - **Sheer cuts** (`RoadDef.cutWalls`, `terrain-gen.ts` `carveRoad` / `cutWeightAt`, `cut-wall-mesh.ts`): where the land is
    deeper than `minHeight` above the road the verge stays level out to `offset` and the land rises sheer; a stone retaining
    wall with a concrete coping walk, a stone edge course and a steel railing stands on that line. The terrain step starts
    `CUT_SETBACK` (1.5 m) behind the wall line and the face is built one terrain cell in front of wherever the land actually
    rises (the mesh smears a step over a 1-2 m cell; in front of the face it would show as a leaning slab), the coping walk
    covers the gap. A carriageway keeps a flat verge (`CARRIAGEWAY_VERGE` 2 m) where a street more than 2 m above or
    below it overlaps its edge (the service road of a sunken parkway). Gentle (the old embankment) at side-road mouths - but a street up on the land (higher than the cut is deep) or
    anything inside a portal never softens the wall. Mainline carriageways (`isCarriageway`: motorway / trunk, not links) are
    cut the same way (`carvePaths` + `pathCutWeight`), so the sunken parkway has walls on both sides. `cutWalls.concreteFrom`
    (m along the stage road; carriageway paths follow it by position) switches to the newer stretch's style: plain concrete
    face + concrete coping and a 2.2 m galvanised chain-link fence (alpha-tested `chainLinkTexture` mesh, posts every 3 m,
    top rail) instead of stone + picket railing.
  - **Drivable decks** (free roam): `World.sampleGround(x, z, out, fromY)` returns the deck of another road when it is above
    the ground and not above the probe (`fromY` = the wheel mount / hull point: a car on the street under an overpass keeps
    the street; blind calls - map viewer picks, spawns, tests - keep any road beneath). Deck parapets and portal-slab parapets
    are box colliders (`parapetColliders`), piers too.
  - **Arch soffits** (`bridge-mesh.ts` `deckBody(..., arch)`): decks of streets (`STREET_KINDS`, not portal decks, >= 12 m long)
    over the parkway get the old stone-bridge look - the intrados is a shallow parabola along the span (girder depth at the
    abutments, slab depth at midspan, `ARCH_RISE`) with stone spandrel faces instead of the flat soffit + beams. Ramps and motorway
    decks keep the beam soffit.
  - **Gore areas** (`MapDef.goreAreas`, `gore-mesh.ts`): where a ramp (`*_link`) leaves / joins the stage road at a shallow
    angle, the strip between the road edge and the ramp's near edge (gap 0.4-7 m, up to 100 m from the junction, starting as a
    point) is a textured strip draped over the terrain: asphalt, white edge lines, diagonal hatching (`gore` texture,
    5 m repeat) with a `crash_cushion` asset (concrete block + graduated yellow drums, solid) at the wide nose facing the traffic.
    `goreWedges(road, net)` / `goreCushions` in `gore.ts` are the pure analysis (Jackie: 13 wedges; test `city-maps.test.ts`).
  - **Overhead signs** (`MapDef.overheadSigns`, `overhead-signs.ts` + `gantry-mesh.ts`): steel gantries with green boards
    (`structure-textures.ts` `signBoardTexture`: tab, lines, small line, arrow - plain road names, no shields). `exits: true`
    puts "EXIT n" + the name of the street at the ramp's far end on a cantilever 130 m before every one-way ramp leaving
    the stage road on the right (the ramp is followed through its further `*_link` ways to the street it ends at);
    `signs` are hand-placed portal / cantilever gantries. Posts are cylinder colliders.
  - Roadside props with colliders (lamps, signs) are never placed on another road (`roadsideInstances` gets the path network):
    the cobra-head lamps of the Jackie stand on both verges except where the opposite carriageway runs right beside the median.
  - **City streets** (`MapDef.cityStreets`, `street-detail.ts` + `street-detail-mesh.ts`): the other roads get city asphalt
    (`road_street`: double yellow line from 6.4 m wide, `road_city`), and within `reach` m of the stage road kerbs +
    sidewalks (runs break at cross streets, the stage road and buildings), zebra crosswalks at street T junctions and
    stop lines (the arriving half of a two-way street, just short of the crosswalk) and lamps (`street_lamp`) on the
    sidewalks. Analysis is pure (`World.streetDetail`), meshes merged per 256 m tile.
  - **Street dressing** (`MapDef.streetDressing`, `street-dressing.ts`): parked cars (`street_car`, `taxi`) along the kerbs,
    spectators on the overpasses and behind the closed junction mouths, `police_car` (POLICE), `ambulance` (FIRE DEPT /
    AMBULANCE) and `fire_truck` (FIRE DEPT) queued at the junction mouths (police first, two abreast on wide mouths; shares per
    vehicle in `emergency`). Deterministic from the map seed; vehicle assets in `assets/builders/vehicles.ts` (decals atlas
    `vehicle_decals`, material `vehicle`). The lettering is reversed on purpose (no real agency names).
- The road arc-length table scales with the number of control points (was 200 divisions -> uneven 1 m samples on
  long roads); world test "road spline has no loops or kinks"; stage test time limit scales with stage length.

### Cars

| id            | name        | drive       | notes                                                                                                                                                                                  |
| ------------- | ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skoda_rally` | Skoda Rally | AWD (42/58) | Rally2-class hatch from SenturyUK's CC BY Fabia R5 GLB (parts mapped, badges dropped), white + green stripe livery; hand-built fallback body; R5 physics on the model's real wheelbase |
| `bimmer_m3`    | Bimmer M3   | RWD         | released: lowered E46 coupe from a CC BY 1:33 print STL, separate parts, street tyres; RWD V8, M3 ALMS livery (hood fitted, rest to be adapted);                                          |
| `zastava_101` | Zastava 101 | FWD         | stock "Stojadin", body hand-built from the blueprint, ~85 hp                                                                                                                           |

Per-car description, sources and build notes: `cars/<car>/README.md` (overview) and `cars/<car>/DETAILS.md`.

**Release flags - test-only cars / maps** (`release.ts`): one file tracks all high-level content, so enabling /
disabling a car or map is a one-line move. Every registered car / map id is in exactly one list:
`AVAILABLE_CARS` / `AVAILABLE_MAPS` = in the published build, `TEST_CARS` / `TEST_MAPS` = work in progress (a new car
/ map starts here). The dev server (`npm run dev`) uses `ALL_CARS` / `ALL_MAPS` (the whole registry) and marks test
entries: red TEST badge in the stage / car menus (the car screen adds a note), a red tag under the HUD title in game,
`<name> · TEST` in the map / car viewer and asset debugger lists. `npm run build` (and `npm run preview`) offer only
the `AVAILABLE_*` ids; a deep link / saved setting with a hidden id falls back to the default car / map, and
leaderboards keep the hidden car's name for old runs (`carName`). Game + tool pages read `CARS` / `MAPS` (= what this
build offers), tests read `ALL_CARS` / `ALL_MAPS`. `tests/rally/release.test.ts` fails if a registered id is missing
from both lists (or in both), or if `DEFAULT_CAR` / `DEFAULT_MAP` aren't available. The flag only hides: the code and
assets (GLB in `public/models/cars/`) are still deployed. `TEST_CARS` is currently empty.

**Rally door plates** (`cars/shared/rally-badge.ts`): every car carries the event plate on both front doors - our own
design in the style of the ARA plates (Gravel Rally emblem + chequered strip top left, car number right, rally name on
an amber band). Number = the player's option (`RallySettings.carNumber`), rally name = the map name (`rallyName`:
"Petralica" -> "PETRALICA RALLY"). The plate is a canvas texture on a decal projected (three `DecalGeometry`) onto the
outward-facing paint of the final body - procedural loft, hand-built shell or imported GLB - lifted 4 mm along one
averaged normal. Placement: `CarModelDef.doorBadge` (`z`, `y` in model space; the plate is 0.6 m wide on every car, only the position is per car; default = middle of the front
door under the beltline). `CarModel` option `badge` / `setBadge()` (live from the pause-menu options). Liveries
themselves carry **no numbers or lettering**. Car viewer: `num` (0 = no plate) and `rally` (map id) URL params.
Reference photos (local only, `sources/cars/shared/`): `rally-plate-ref-01-wrc-2011-red-bull-door.png`,
`rally-plate-ref-02-hyundai-door-plate.png`, `rally-plate-ref-03-square-number-logo-top.png`,
`rally-plate-ref-04-ara-dirtfish-plate.png` - plate shapes (rectangular / square with logo on top); the ARA plate
(logo top left, number right, rally name bottom) is the model for ours. Reference only, no logos copied.
STL bodies are converted with `scripts/car-model/stl-to-glb.mjs` (rally-content skill, "STL bodies").
Real models can replace the procedural bodies: drop a GLB in `public/models/cars/` (see `public/models/CREDITS.md`
and the rally-content skill, "Imported models"). `model.gltf` (`cars/shared/car-gltf.ts`) auto-fits it, hides the
GLB wheels, bolts on the procedural rally add-ons and shows credits in the viewer; files are discovered at build
time with page-relative URLs (sub-folder hosting OK). Verified with a synthetic cm-scale glTF.

Console helpers: `__rally.benchmark(240)` (avg + worst ms/frame incl. GPU, works with the tab hidden),
`__rally.loadTimings`, `__rally.vehicle`, `__mapViewer`, `__carViewer`.

## Architecture

```
physics/      pure TS, no three.js scene / DOM (math types only) -> testable in node
  vehicle.ts    raycast-suspension rigid body, 240 Hz fixed step
  tire.ts       combined-slip tyre curve (Pacejka-like, friction ellipse)
  drivetrain.ts engine curve, auto/manual gearbox, launch clutch, diffs
  surfaces.ts   grip / dust / bump per surface  <- tune surfaces here
world/        map data -> deterministic world
  road.ts         Catmull-Rom centreline @1 m, height smoothing + maxGrade, spatial grid queries
  terrain-gen.ts  noise layers (+ real heightmap) + flat pads + channels + road carving (crown, verge, ditch,
                  embankment) + splat weights (land cover classes, field patchwork, side-road paint)
  real-data.ts    real-world map data: int16 height grids (bicubic), land cover zone raster, other-roads network
  heightfield.ts  chunked (64 m) lazy LRU 1 m height/normal/splat cache = shared truth for physics + LOD0 mesh;
                  time-sliced generation (prepare). AnalyticTerrain = uncached sampler for whole-map work
  scatter.ts      per-chunk procedural placement + road-side rules + props, colliders
  world.ts        ties it together; implements physics GroundProvider; spawns, stage layout
  terrain-renderer.ts  streamed chunk meshes, 4 LODs + skirts, shared index buffers, time-sliced; TerrainGrid sampler
  aerial-terrain.ts    whole map as one low-res terrain mesh (menu stage select), time-sliced, map-rect UVs
  aerial-trees.ts      vegetation as one InstancedMesh of green canopy circles (menu map card)
  instance-streamer.ts InstancedMesh per (asset, variant, LOD, part); incremental time-sliced re-bucketing + atomic commit
  road-mesh.ts, terrain-material.ts (4-way splat on MeshStandardMaterial)
  bridge-mesh.ts       girders / parapets / road surface of bridges (stage-road spans + other roads' decks)
  building-mesh.ts     mesh buildings: extruded footprints + facade tiles + roofs, merged per 128 m tile
  landmarks.ts         registry + interface of hand-modelled landmarks (maps/<id>/<landmark>/); pads.ts = graded lots
  stage-signs.ts       stage furniture layout from `StageDef` (gantries, painted lines, split boards, colliders), pure;
                       stage-sign-mesh.ts draws it, textures in engine/stage-sign-textures.ts
assets/
  catalog.ts      metadata only: variants, LOD distances, colliders  <- add assets here
  builders/*.ts   procedural geometry (merged, vertex coloured, one shared material per kind)
  library.ts      id -> builder, cached shared geometry per (id, variant, lod)
release.ts      release flags: AVAILABLE_CARS / _MAPS = published build, TEST_CARS / _MAPS = dev server only (TEST)
cars/           index.ts = car registry (ALL_CARS, CARS = released, getCar, carName)
  <car>/<car>.ts  one folder per car: CarDef = physics + procedural model params
                  (skoda-rally/, zastava-101/, bimmer-m3/)
  shared/         code shared by every car:
    types.ts        CarDef / CarModelDef / CarParts / CarGltfDef
    mesh-kit.ts     toolkit for hand-built bodies (CarModelDef.custom, e.g. zastava-101/body.ts): triangle soup,
                    grids / polygons with holes / sweeps, creased normals
    car-body.ts     BodyShape: station spline, wide-body flares, lofted lower body + greenhouse, window cut-outs,
                    Surface.patch() skin decals that follow the body (lamps, vents, frames, glass, skirts)
    car-model.ts    materials + meshes (~16 draw calls), 3 instanced meshes for 4 wheels; swaps in a glTF body
    stl-wheel.ts    STL-converted wheel rim (model.wheelModel: rim GLB rescaled per tyre size) + brake disc / caliper
    tyre-mesh.ts    every tyre: size, tread per compound, compound ring (see "Tyres and suspension rendering")
    suspension-mesh.ts  coil-overs / struts per car style, spring colour per set-up preset
    car-parts.ts    styling / rally kit / cockpit from CarDef.model.parts (wing, splitter, lights, vents, cage...)
    car-gltf.ts     imported model loading (loadCarModelFile, cached) + auto-fit
    livery.ts       seeded livery atlas (see UV layout comment)
    rally-badge.ts  rally door plate (car number + rally name): canvas texture + decal projected onto the doors
engine/         renderer, quality presets, sky/sun/fog/IBL environment, textures, materials
game/           rally-game.ts (frame loop), input, camera, stage timing, HUD, dust, audio, telemetry, autopilot,
                menu.ts (main menu screens + options form), showroom.ts (menu 3D backdrop), settings.ts (player options)
maps/           one folder per map (<id>/map.ts, data.json, TODO.md), shared/ (types.ts format, helpers), index.ts registry
                (ALL_MAPS, MAPS = released, getMap)
debug/          viewer-shell.ts shared by the tool pages
pages/          entry points listed in game.json
```

### Performance rules (keep these)

- **Never clone geometry/material per instance.** Everything placed in the world goes through
  `getAsset(id, variant, lod)` -> `InstancedMesh`. Materials come from `engine/materials.ts`.
- Physics runs at a fixed 240 Hz (`PHYSICS_HZ`); rendering interpolates (`vehicle.prev`).
- Streaming is time-sliced and must stay that way: terrain (`terrain.update(pos, budgetMs)`), the 1 m heightfield
  (`Heightfield.prepare`), and instance re-bucketing (`InstanceStreamer` jobs, ~2 ms/frame). Only LOD0 terrain
  uses the 1 m cache; whole-map work (scatter, road mesh) uses `world.analytic`.
- Only LOD0 casts shadows - every LOD0 radius must stay >= the shadow box (`quality.shadowExtent`, <= 75 m).
- Draw distance knobs: `engine/quality.ts` (`viewDistance`, `lodScale`), `assets/catalog.ts` LOD distances,
  `TERRAIN_LODS` in `game/rally-game.ts`, map `fogDensity`.
- LOD distances: trees 110 / 420 / 1700 m; terrain view 1100 / 1700 / 2400 m (low / medium / high), terrain LOD
  bands scale with quality. Shaders are prewarmed at load.
- Measured (test map, 1280x720, autopilot drive, `__rally.benchmark`) - re-check with `__rally.benchmark(2400)`:

  |                  | before streaming rework (medium) | medium             | high                |
  | ---------------- | -------------------------------- | ------------------ | ------------------- |
  | instances / tris | 16k / 0.93M                      | 27k / 1.6M         | 42k / 2.2M          |
  | avg frame        | 1.8 ms                           | ~2-3 ms            | ~2-3 ms             |
  | worst frame      | 10-12 ms                         | ~10 ms (0 > 16 ms) | ~8.5 ms (0 > 16 ms) |
  | load             | ~6-8 s                           | 1.7 s              | 1.9 s               |

  Ajvatovci hill (high): 2.8-4.4 ms avg, 0.8-1.3k draw calls, 1.3-1.7M tris; world init 30 ms.

- **Render cost probe** (`__rallyProbe()` in the game console, `engine/perf-probe.ts`): what the camera draws, per
  scene group (terrain / road / scatter / car) and the heaviest instanced assets (instances x triangles of their LOD;
  three.js does not cull single instances, an `InstancedMesh` costs all its instances even behind the camera). Road mesh
  build times per job: `__roadJobMs`. Together with `__rally.benchmark(n)` this is the way to find what to trim.
- **Pass 2026-10-04** (RTX 3070 Ti laptop, preview pane, `?map=jackie&spawn=3000`; the other maps are in the table below):
  far tree LODs are one octahedron crown (8 tris, no trunk on tall trees) instead of an icosahedron + trunk (28 tris):
  oak LOD2 469k -> 134k tris in view, scatter 917k -> 471k (-49 %); bush LOD1 is one blob; fruit tree LOD2 28 -> 14 tris
  (the stub trunk stays: orchards are low). Draw calls: barrier pieces are merged per 192 m tile and kind, bridge parts per
  256 m tile, building tiles 128 -> 192 m: road-group meshes in the whole Jackie map 2 080 -> ~1 300 (barriers 425 -> 142,
  bridges 164 -> 95, buildings 1 094 -> 677), in view 363 -> 234. Path ribbons take one normal per row (their build time
  901 -> 589 ms, road load ~2 s in total, `__roadJobMs`).

  | map (spawn)      | avg frame | draw calls | tris | scatter tris | notes                                                              |
  | ---------------- | --------- | ---------- | ---- | ------------ | ------------------------------------------------------------------ |
  | jackie (3000)    | 5.5 ms    | 1 146      | 1.7M | 0.47M        | terrain 437 chunk meshes in view, road 234, 7 800 meshed buildings |
  | ajvatovci (1700) | 3.2 ms    | 696        | 1.2M | 0.44M        | orchard: 15k fruit trees in view (LOD1 / LOD2)                     |
  | petralica (2500) | ~3-16 ms  | 696        | 1.3M | 0.49M        | first frames after load include shader compiles                    |

## Physics

Everything about the car physics lives in [`PHYSICS.md`](PHYSICS.md): the model, the **tuning guide** (symptom -> knob
table, water), the grip layers (surface x tyre compound x tyre size x suspension set-up), every tyre / set-up table with the
current numbers, the autopilot's grip logic, reference test results, research notes and the open physics work. Workflow for
changes: `.claude/skills/rally-physics-tuning/SKILL.md`.

In short: each stage recommends a tyre (`MapDef.tyre`: Tarmac / Mixed / Gravel) and with it a suspension preset (gravel soft,
mixed medium, tarmac stiff); each car has its own tyre sizes (`physics.tyres`, with a rim switch per compound on the Skoda Rally and
the Bimmer) and three presets within its own limits (`physics.setups`: Skoda Rally full range, Zastava soft half, Bimmer stiff half).
`new Vehicle(applySetup(def, setup), ground)` + `vehicle.setTyre(tyre)`; no tyre = raw surfaces (tool pages, `vehicle.test.ts`).

### Tyres and suspension rendering

`cars/shared/tyre-mesh.ts` builds every tyre (carcass from the size, tread relief per compound as grid
vertices sinking into grooves, coloured compound ring on the outer sidewall, `tyreDust` for old road cars; ~5.2k triangles).
`buildWheelSet` (car-model.ts) = tyre + rim + brakes for a car and compound; the rim follows the size (Skoda Rally 15" <-> 18",
Bimmer 16" <-> 18"; the wheel GLB's rim is kept and rescaled, the Zastava keeps its 13" steel rim). `CarModel` takes
`{ tyre }` and `setTyre(id)` (car viewer `?tyre=`). `cars/shared/suspension-mesh.ts` builds coil-overs / struts per
`model.suspensionStyle` (Skoda Rally `rally`: long gold coil-over + remote reservoir; Zastava `road`: black MacPherson strut +
rubber boot; Bimmer `race`: stubby silver unit + piggyback reservoir) with the spring coloured yellow / orange / red by
preset, length from the travel and coil count / wire from the rate.

### Setup screen

Code: `game/menu.ts` (`setupSelect`), `game/setup-bench.ts`, `Showroom.showSetup` / `renderBoxes`. Optional: the car
screen starts the stage with the stage's recommended tyres + suspension and shows a summary line (`Gravel tyres 205/65 R15 ·
Soft suspension RECOMMENDED`, amber `CUSTOM` when changed); `Setup car` opens this screen. Most players never open it.

- **Layout**: full width, two sections one under the other, each a row of three fixed-size boxes aligned to the left (the row is
  not stretched: there is room to add more options on the right). Header strip per section (`TYRES` / `SUSPENSION`), then the
  boxes, then the buttons.
  - **Tyres**: Tarmac / Mixed / Gravel. Each box renders that compound on the car's own rim, turning slowly (tread pattern, rim
    switch 15/16" <-> 18", coloured compound ring); under it: dot in the compound colour (red / yellow / white), name, green
    `RECOMMENDED` tag, size (`205/65 R15`) + one-line blurb, and a Best / Good / Poor / Bad chip per road surface of the stage
    (`carGripRating` for this car as currently set up).
  - **Suspension**: Soft / Medium / Stiff. Each box renders the car's own coil-over / strut (Skoda Rally gold rally coil-over with remote
    reservoir, Zastava black MacPherson strut, Bimmer short silver race unit) with the spring coloured yellow `#f2c230` / orange
    `#f08a24` / red `#e0413a`, longer for more travel, fewer + thicker coils for a stiffer rate; under it: spring-colour chip, name,
    `RECOMMENDED` tag, character (`Soft · gravel`), `Travel 260 mm` (= the wheel droop / "max rebound"), `Ride height +30 mm`
    (vs the car's standard; `standard` when 0), `Spring 34 / 29 N/mm`
    (front / rear) and `Rebound ●●○○○` (global scale: rebound N·s/m / 1600, 1-5). The section header carries the car's
    **adjustment range** bar (soft ... stiff; the lit segment is what this car can reach: Skoda Rally wide, Zastava soft half, Bimmer
    stiff half).
  - **Gearing**: Short / Medium / Long final drive (race cars: Skoda Rally, Bimmer). Each box shows a speed-per-gear bar chart (redline
    speed per gear, capped at the real top speed, one scale across the row; top speed printed on the last bar) instead of a 3D part,
    then the name, `RECOMMENDED`, a one-liner, `Top speed 206 km/h`, `Final drive 3.70` and `Pull ●●○○○`. The Zastava shows one
    non-selectable `Standard` box ("No configuration available - road car gearbox"). Recommended = `MapDef.gearing` (Jackie:
    long), else medium. Three rows scroll on short screens: the panel keeps its scroll on a pick and keyboard / pad row changes
    scroll the active row into view.
  - **Buttons**: `Reset to recommended`, `Done` (primary while nothing is custom), `Start stage ›` (primary once custom). Compact,
    taller than the other menus' buttons (min width 150 px, padding 15 x 28 px) and left-aligned, not stretched across the screen.
- **Input**: mouse = click a box; keyboard / pad = up / down switch the section, left / right change the choice, Enter confirms,
  Esc / B = back to the car screen. The active section has an amber inset edge on its header strip.
- **Choices are not saved**: they reset to the recommendation whenever the stage or the car changes (nothing in localStorage). The
  URL carries them (`?tyre=` / `?susp=` / `?gear=`; missing = recommended) so a reload or a shared link keeps the setup;
  `RunRecord.tyre` / `susp` / `gear` (race cars only) fill the leaderboard's Tyres / Suspension / Gearing columns.
- **Background (consistency rule)**: like every menu screen it shows the showroom's ground + sky behind the content - never a
  plain dark background. The turntable car stays visible behind the boxes (centred on the screen, `SETUP_SHIFT` in `game/showroom.ts`;
  the rows may cover part of it) and re-renders on every pick: the tyre compound (`Showroom.setTyre`: tread, rim size, ring colour) and
  the suspension preset's ride height (`Showroom.setRide` -> `CarModel.setRideHeight`: the body eases up / down over the wheels
  in ~0.25 s, same pose as the stage car). Travel / springs are not visible at rest, only ride height. `Menu.showSetupCar()`
  applies tyre + ride + livery on the car and setup screens. The boxes are transparent windows onto the 3D canvas.
- **Style tokens** (`game/menu.css`, search `setup screen`): section width = its row (`fit-content`); box `270 px` wide, window
  height `clamp(96px, 16vh, 170px)`, 2 px border `rgba(255,255,255,.28)`, radius 10; window tint `rgba(60, 66, 76, .4)` (a 40 %
  mid-dark grey: a light 20 % grey looked washed out, the main menu darks too heavy); label strip `rgba(10,13,18,.8)` + 6 px blur
  so the text reads over the pebbles; header strips `rgba(8,10,14,.72)`, title 20 px amber uppercase, subtitle 13 px; selected box
  = 2 px amber `#f0a020` border + soft amber glow; recommended tag green `#2f7d4f`. No dashed outlines (an earlier version had
  them around each row - removed as out of place).
- **How the boxes are drawn**: each box is a transparent DOM element (`.setup-view[data-view="tyre:gravel"]`). Every frame
  `Showroom.renderBoxes` first lets the normal showroom render the ground + sky, then, per box, sets viewport + scissor to the
  element's rectangle, clears only the depth buffer and renders that part's own studio camera from `SetupBench` (an own scene
  with studio lights that shares the showroom environment map, six little studios `tyre:<id>` / `susp:<id>`, no backdrop). So
  `showSetup(carId, boxes)` must be called again after the menu re-renders (the elements change); the studios themselves are
  only rebuilt when the car changes. The turntable car wears the picked tyre + ride height on the car screen too.

In-game: no tyre / suspension readout on the HUD (kept clean on purpose), a "<tyre> tyres on
<surface>... hold on!" line at GO for a poor / bad pick (car-aware `carGripRating`), `F2` shows tyre, set-up and per-wheel `mu`.

## Known limitations / roadmap

- Breakable props (marker posts & chevrons are currently drive-through, not solid).
- Generation runs on the main thread (time-sliced). For very large maps move heightfield + scatter generation to a
  Web Worker, merge far terrain chunks into bigger meshes (draw calls), and cull instances per chunk.
- Tyre relaxation length, skid marks, gravel spray particles, co-driver pace notes, car damage.
- Real-world maps: buildings / pylons from the baked data, lazy-load map data, better DEM (see `maps/ajvatovci/TODO.md`).
- Asset/car art is procedural placeholder quality — use the car/asset viewers to iterate.
