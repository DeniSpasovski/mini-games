# Gravel Rally - details

> Overview and screenshots: [README.md](README.md). This file explains how the game works and how the code is organised.

Point-to-point rally. Target look: late-2000s rally game (sun and shadows, sky / IBL, fog, dense forest, dust). Target
feel: grounded sim-lite physics that is still fun on a keyboard.

## Pages and URLs

| Page        | URL                                                    | What it is                                                                                |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Game        | `/games/rally/`                                        | welcome -> select stage -> select car -> (set-up) -> drive                                |
| Map viewer  | `/games/rally/map-viewer.html?map=test&grid=1&splat=1` | aerial view, click the terrain to inspect it, "Drive from here"; real maps show lat / lon |
| Car viewer  | `/games/rally/car-viewer.html?car=skoda_rally&seed=5`  | livery seed, door plate, pose, physics hull, torque chart, "Test drive", wheel overlay    |
| Asset debug | `/games/rally/asset-debug.html?asset=pine_tree&lod=1`  | every asset / car (`car:<id>`) / texture (`tex:<id>`): seed, variant, LOD, instancing     |

The three tool pages are dev-server only. Their settings live in the URL, so a view is shareable; `H` hides the left panel
and `F3` shows stats. Camera links (`cam=x,y,z&look=x,y,z&fov=<deg>&clean=1`, "Copy camera link") work on all three.

**Play URL parameters** (`/games/rally/?...`): `map`, `car`, `livery`, `quality=low|medium|high`, `mute=1` (silent, for bots and
tests), `tyre=tarmac|mixed|gravel`, `susp=soft|medium|stiff`, `gear=short|medium|long` (defaults: the stage's recommended
tyre, the matching set-up, the map's gearing) and `spawn` (`start`, a flat-area name such as `pad` = free-drive pad, or
metres along the road = free drive from there: no clock, never ranked). Any of these skips the menu.
`?display=auto|sdr|hdr` (every page) lowers the tone-mapping exposure on HDR monitors, where sunlit white paint would glare.
Look experiments (every page): `?tod=<hours>` sets the time of day on maps that use `environment.timeOfDay` (e.g. `tod=7.5`
low morning sun, `tod=17` evening) and `?tonemap=aces|agx|neutral` swaps the tone-mapping operator.

### Look (`engine/environment.ts`, `engine/world-shading.ts`)

Per-map settings live in `MapDef.environment`; everything below has a sensible default.

- **Light:** the sun follows `timeOfDay` (or `sunElevation` / `sunAzimuth`); a lower sun is warmer and dimmer, so raise `exposure`
  with it. A cool sky-coloured hemisphere fill with a warm ground bounce keeps shadows blue-ish, and a PMREM of the sky over a
  ground disc gives paint, glass and water something to reflect.
- **Shadows:** one shadow map that sits ahead of the camera and snaps to texels, so edges do not crawl while driving.
- **Sky and tone mapping:** drifting clouds (`cloudCoverage`, `cloudSpeed`); ACES by default, `toneMapping: 'agx' | 'neutral'` per map.
- **World shading** (installed on import; tune live with `__worldShading`): cloud shadows drifting over the ground, a top-down
  **canopy shadow** texture so woods stay dark outside the shadow-map box (`world/canopy-shadows.ts`), height fog that warms
  towards the sun, wind on trees and grass, and leaf translucency when backlit. Custom shaders call `addWorldUniforms(shader)`.
- **Surfaces:** roads, rocks and terrain use bump relief (off on low quality); grass cards use alpha-to-coverage when MSAA is on.
- **Effects:** wheel dust, gravel spray and hanging dust clouds (`game/dust.ts`), tyre marks (`game/tyre-marks.ts`: ruts on loose
  ground, rubber on hard ground when sliding), a soft contact shadow under the car, and brake lights.

### Controls

| Input    | Keys                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Keyboard | `W` / `S` throttle / brake (hold `S` when stopped = reverse), `A` / `D` steer, `Space` handbrake                           |
|          | `R` reset to road, `C` camera, `Esc` menu, `Q` / `E` shift (`G` manual gearbox), `T` traction / stability assist           |
|          | `M` mute, `F2` telemetry, `F3` stats, `F4` force vectors + hull, `F8` autopilot, `F9` save the portal thumbnail (dev)      |
| Gamepad  | RT / LT throttle / brake, left stick steer, A / X handbrake, B reset, Y camera, LB / RB shift; menus: d-pad / stick, A / B |
| Touch    | on-screen steer arrows and BRAKE / GAS plus a pause button, landscape only (`game/touch-controls.ts`)                      |

## Game flow

- **Main menu:** welcome (Start rally / Options / About) -> **select stage** (aerial 3D render of the map with the stage ribbon,
  length, splits, best time) -> **select car** (specs, livery, best time) -> **Start stage** with the recommended tyres and
  set-up, or the optional **Setup car** screen. The selected car stands in a 3D showroom behind the panel (`game/showroom.ts`).
  The stage view orbits the stage: large maps show a pre-baked stage card (`tools/stage-card.ts`, baked with
  `/games/rally/?bakecard=<id>` on the dev server - only when the user asks), small maps are built live.
- **Options** (main and pause menu, `game/menu.ts`): quality, object distance, volume, gearbox auto / manual, traction assist, car number (1-99,
  shown on the door plates), start camera. Stored in localStorage (`game/settings.ts`).
- **Pause** (`Esc`): resume, restart, free-drive pad <-> stage, options, main menu.
- **About:** every external resource with links, per map (`MapDef.sources`) and per car (`CarDef.sources`), plus the game version
  (`version` in `game.json`).
- **Time penalties:** manual reset +2 s, forced off-stage reset +5 s (`game/stage.ts`),
  added to the stage time. Knocked-over marker posts cost nothing.
- **Breakable props** (catalog `breakable`, so far `marker_post`): no collider, the car drives over them; the post tips over
  in the push direction, slides a little and lies on the ground until the stage restarts (`world/breakables.ts`, drawn by
  patching its slot in `InstanceStreamer.setMatrix`). No time penalty.
- **Results and top 10:** your time with the delta to the best run and sector chips, then a top 10 for the stage (all cars / this
  car) with tyres, suspension and gearing per run. Times are stored per map in localStorage (`rally.times.<map>`).
  **Times are versioned:** when physics, penalties or a map's road change enough that times are no longer comparable, bump
  `TIMES_VERSION` in `game/stage.ts` and every saved time is erased on the next start.

### Stage flow

- **Hold:** the car is held (auto handbrake, HUD `HOLD`) whenever it is stopped with no pedal pressed; throttle releases it.
- **Sector bar:** one segment per sector, amber while running, green / red when faster / slower than your best run.
- **Cutting the stage** (`StageTimer.updateCut`): corner cutting up to `CUT_WARN` (20 m from the road edge) is allowed. Beyond it
  the HUD shows `OFF STAGE`, a grace timer runs, and when it is used up, or the car passes `CUT_MAX` or drives onto a later part
  of the road, the car is put back where it left the road. Tests: `tests/rally/stage-cut.test.ts`.
- **Finish:** after the line the car brakes itself to a stop on the run-off (`finishStopControls()`), so every map needs a run-off
  past the finish.
- The autopilot (`F8`, and the finish stop) runs per physics step at 240 Hz in the game, exactly as in the tests, and knows about
  crests (no braking in the air).

## Maps

| id          | name                 | notes                                                                        |
| ----------- | -------------------- | ---------------------------------------------------------------------------- |
| `test`      | Test Map             | procedural 1.7 km forest gravel stage, hairpin, crest jump, test pad         |
| `ajvatovci` | Ajvatovci Hill       | real world (Ilinden, North Macedonia), 4.5 km old tarmac                     |
| `petralica` | Petralica            | real world (North Macedonia), 9.6 km mountain stage, 560 m of climb          |
| `jackie`    | Jackie Robinson Pkwy | **test map**: real world (New York), 7.3 km parkway with bridges and portals |

Real-world maps are baked by `scripts/realmap/bake.py` from OpenStreetMap, ESA WorldCover and elevation data (see the
rally-maps skill and each map's README). World axes: +X east, **+Z south**. A map is `maps/<id>/map.ts` (gameplay and look) plus
the baked `data.json`; the format and shared helpers are in `maps/shared/`.

**Engine features for real-world maps** (all configured in `MapDef`):

- **Terrain:** a real heightmap (detail + horizon grids), cover-class splat, field patchwork, and other roads (`paths`) as tarmac
  ribbons, dirt paint or carved canals, each with its own surface physics.
- **Side roads and junctions:** side roads are carved like real roads (own height line, grade limits per road kind), and
  `world/junctions.ts` extends each one until it meets the stage road; `junctionBarriers` closes the mouths with barrier rows.
- **Water:** canals, drains and rivers (`paths` with surface `water`) and lakes (`MapDef.lakes`, `world/lakes.ts`) hold flat
  water with real banks and water physics. A street along a drain bank stops its embankment at the water (only its own
  surface crosses a channel, as a culvert); a drain ending in another drops to that channel's level over its last 60 m.
- **Railways** (`MapDef.railways`, baked from OSM `railway=rail`; `world/railways.ts`): each track joins the other roads as a
  path of kind `rail` (300 m smoothing, 2.5 % grade limit, never eased to a road - a road crossing at grade meets the rail
  level), with a ballast hump carved into the terrain (drivable, `gravel_loose`). Road decks crossing a track are lifted by
  `RAIL_CLEARANCE`. `world/rail-mesh.ts` draws the ballast + sleeper strip (texture `rail_track`) and the rails per 256 m
  tile; electrified tracks get `catenary_mast`s every ~58 m and contact / messenger wires (dropped under decks).
  Placeholder buildings on a track bed are dropped. Test: `tests/rally/railways.test.ts`.
- **Season look:** `environment.groundTint` (grass / crop colours) and the grass-card variants (`grass_tuft`, `spring_grass`,
  `dry_grass`).
- **Buildings:** placeholder boxes (`building_flat`, `house_pitched`) with stable ids along the route (`buildings.csv`, map
  viewer `?building=N`), or **mesh buildings** extruded from the real footprints with facade textures
  (`world/building-mesh.ts`).
- **Stage signs:** start / finish gantries and A-frame split boards are derived automatically from `MapDef.stage`, name and
  year (`world/stage-signs.ts`).
- **Landmarks** (`MapDef.landmarks`, `world/landmarks.ts`): hand-modelled groups that replace the placeholders under them (lots
  with real window openings, yards, fences, kerbs, parked vehicles) on graded **pads** (`world/pads.ts`). First one:
  `maps/ajvatovci/start-row/`; second `maps/ajvatovci/hilltop/` (church, bell tower, courtyard, court on `flatAreas`,
  reusing the start row's kit with its own site origin); third `maps/ajvatovci/station/` (Ilinden railway station: platforms
  placed from the baked tracks, raised platform ground via `groundOverride`). Optional hooks: `surfaceAt` (paved ground: physics surface),
  `keepsClear` (no junction barriers / marshals there), `groundOverride` (kerbs). `FlatArea.label: false` hides a
  levelled spot's map viewer label.
- **City maps** (first used by `jackie`): one-way carriageway routing, bridges and decks of other roads (`bridge-mesh.ts`, piers,
  parapets, drivable decks), portals (`world/portals.ts`), junction plazas on a portal (`MapDef.junctionPlazas`, `world/plazas.ts`), parkway lanes (streets in the cut beside the carriageways, `MapDef.parkwayLanes`, `world/parkway-lanes.ts`), continuous Jersey / guard-rail barriers (`barriers.ts`), sheer
  retaining-wall cuts (`cut-wall-mesh.ts`), lane drops, gore areas, overhead signs, city streets with kerbs / crosswalks / lamps
  (`street-detail.ts`) and street dressing with parked and emergency vehicles. Tests: `tests/rally/bridges.test.ts`,
  `city-maps.test.ts`, `junctions.test.ts`, `side-roads.test.ts`, `water.test.ts`, `stage-signs.test.ts`.
  Bridges, underpasses, retaining walls and street joints - rules and the bug-fix workflow: rally-maps skill "Bridges and underpasses".
  No terrain through streets: a street ribbon holds its own height line where the land under it falls away (cut beside it,
  trench under a portal slab; not on / under the stage road, `pathMeshesJob`), the ground under a deck end is not pitted inside
  a junction plaza (`capUnderDecks`), a sidewalk is lifted clear of a bank beside the street, and decks on a portal slab carry
  sidewalks (`street-detail.ts` `deck`).

## Cars

| id            | name        | drive | notes                                                                                |
| ------------- | ----------- | ----- | ------------------------------------------------------------------------------------ |
| `skoda_rally` | Skoda Rally | AWD   | Rally2-class hatch from a CC BY Fabia R5 model, own livery, hand-built fallback body |
| `bimmer_m3`   | Bimmer M3   | RWD   | lowered E46 coupe from a CC BY print model, own livery                               |
| `zastava_101` | Zastava 101 | FWD   | stock "Stojadin", body hand-built from dimensions and a blueprint                    |

Each car is a folder `cars/<car>/<car>.ts` (a `CarDef`: physics plus model parameters) with its README. Real models replace the
procedural body when a GLB exists in `public/models/cars/` (files are discovered at build time; credits are in
`public/models/CREDITS.md` and shown in the car viewer); `cars/shared/car-gltf.ts` loads and fits it, hides its wheels and
bolts on the procedural rally parts. STL bodies are converted with `scripts/car-model/stl-to-glb.mjs` (rally-content and
rally-car-import skills).

**Release flags** (`release.ts`): every registered car / map id is in exactly one list. `AVAILABLE_CARS` / `AVAILABLE_MAPS` are in
the published build; `TEST_CARS` / `TEST_MAPS` are dev-server only and show a TEST badge. `npm run build` offers only the
available ids and unknown ids fall back to the default car / map. `tests/rally/release.test.ts` guards the lists. The flag only
hides: the code and assets are still deployed.

**Rally door plates** (`cars/shared/rally-badge.ts`): every car wears the event plate on both front doors, our own design in the
style of rally door plates (Gravel Rally emblem, car number, rally name = the map name). It is a canvas texture projected as a
decal onto the final body. Liveries themselves carry no numbers or lettering.

Console helpers: `__rally.benchmark(240)` (avg and worst ms per frame, works with the tab hidden), `__rally.loadTimings`,
`__rally.vehicle`, `__mapViewer`, `__carViewer`.

## Architecture

```
physics/      pure TS, no three.js scene / DOM -> testable in node
  vehicle.ts    raycast-suspension rigid body, 240 Hz fixed step
  tire.ts       combined-slip tyre curve (Pacejka-like, friction ellipse)
  drivetrain.ts engine curve, auto / manual gearbox, launch clutch, diffs
  surfaces.ts   grip / dust / bump per surface  <- tune surfaces here
world/        map data -> deterministic world
  road.ts         Catmull-Rom centreline at 1 m, height smoothing, spatial queries
  terrain-gen.ts  noise + real heightmap + pads + channels + road carving + splat weights
  real-data.ts    baked real-world data: height grids, land-cover raster, other-roads network
  heightfield.ts  chunked 1 m height / normal / splat cache = shared truth for physics and the LOD0 mesh
  scatter.ts      per-chunk procedural placement, road-side rules, props, colliders
  world.ts        ties it together; implements the physics ground; spawns, stage layout
  terrain-renderer.ts  streamed chunk meshes, 4 LODs + skirts; aerial-terrain.ts = whole map as one low-res mesh
  instance-streamer.ts InstancedMesh per (asset, variant, LOD, part), time-sliced
  road-mesh.ts, bridge-mesh.ts, building-mesh.ts, stage-signs.ts, landmarks.ts, ...
assets/
  catalog.ts      metadata only: variants, LOD distances, colliders  <- add assets here
  builders/*.ts   procedural geometry (merged, vertex coloured, one shared material per kind)
  library.ts      id -> builder, cached shared geometry per (id, variant, lod)
release.ts      AVAILABLE_* / TEST_* lists
cars/           index.ts = registry; <car>/ = one folder per car; shared/ = body, parts, tyres, suspension, livery, door plate
engine/         renderer, quality presets, sky / sun / fog / IBL, world-shading (clouds, canopy, fog, wind), textures, materials
game/           rally-game.ts (frame loop), input, camera, stage timing, HUD, dust / gravel / haze, tyre marks, audio, autopilot, menu.ts, showroom.ts
maps/           one folder per map, shared/ (format + helpers), index.ts registry
debug/          shared shell of the tool pages
pages/          entry points listed in game.json
```

### Performance rules (keep these)

- **Never clone geometry or materials per instance.** Everything placed in the world goes through `getAsset(id, variant, lod)` ->
  `InstancedMesh`; materials come from `engine/materials.ts`.
- Physics runs at a fixed 240 Hz (`PHYSICS_HZ`); rendering interpolates.
- Streaming is time-sliced and must stay that way: terrain (`terrain.update(pos, budgetMs)`), the 1 m heightfield
  (`Heightfield.prepare`) and instance re-bucketing (`InstanceStreamer`, ~2 ms per frame). Only LOD0 terrain uses the 1 m cache;
  whole-map work (scatter, road mesh) uses `world.analytic`.
- Only LOD0 casts shadows, so every LOD0 radius should stay >= the far edge of the shadow box, which sits half a box ahead of
  the camera: 1.5 x `quality.shadowExtent` (<= 75 m, so ~112 m on high).
- Draw-distance knobs: `engine/quality.ts`, LOD distances in `assets/catalog.ts`, `TERRAIN_LODS` in `game/rally-game.ts`, map
  `fogDensity`, and the **Object distance** option (Normal / Far / Max = x1 / x1.5 / x2 on the preset's object `lodScale`,
  `OBJECT_DISTANCE` in `game/settings.ts`, live from the pause menu; objects only, the terrain keeps the preset).
- Nothing is drawn past the streamed terrain (`quality.viewDistance`): the instance streamer gets it as `maxDistance`, and the
  whole-map road group (stage road, other roads, barriers, bridges, water, landmarks, cables) is distance-culled by
  `world/distance-cull.ts` (re-checked every 10 m of camera travel). Before, a wide real map drew roads, barriers and trees to
  the 3 km far plane over empty sky.
- The streamer skips a scatter chunk wholesale when it is further than the longest LOD distance of anything in it (per-chunk
  reach): far chunks of bushes / orchards / rocks cost nothing. Ajvatovci, driving: a re-bucketing job takes 3 frames at x1
  (was 6) and 5 at x2 (was 11), so objects lag 1-2.5 m behind the camera instead of 3-6 m.
- Whole-map set-up loops must not compare everything with everything (a town map has ~900 roads, ~2000 way ends): use a
  spatial grid (`junctions.ts` shared ends, `terrain-gen.ts` deck points / way ends / street joints).
- Measure with `__rally.benchmark(n)` and find what to trim with `__rallyProbe()` (what the camera draws per group and the heaviest
  instanced assets; `engine/perf-probe.ts`) and `__roadJobMs` (road mesh build times). On a desktop GPU the maps run at
  roughly 3-6 ms per frame with 0.7-1.1k draw calls and 1.2-1.7M triangles in view.

## Physics

Each stage recommends a tyre (`MapDef.tyre`: Tarmac / Mixed / Gravel) and with it a suspension preset (gravel soft, mixed medium,
tarmac stiff). Each car has its own tyre sizes (`physics.tyres`, with a rim switch per compound) and three suspension presets
within its own limits (`physics.setups`), plus gearing presets (`physics.gearings`). Grip is layered: surface x tyre compound x
tyre size x suspension set-up. `new Vehicle(applySetup(def, setup), ground)` + `vehicle.setTyre(tyre)`; with no tyre the raw
surfaces are used (tool pages, `vehicle.test.ts`). Workflow for changing handling and the regression tests:
`.claude/skills/rally-physics-tuning/SKILL.md`.

Rendering: `cars/shared/tyre-mesh.ts` builds every tyre (size, tread per compound, compound ring);
`cars/shared/suspension-mesh.ts` builds coil-overs / struts per `model.suspensionStyle` (`rally`, `road`, `race`) with the spring
coloured by preset; `buildWheelSet` (`car-model.ts`) combines tyre, rim and brakes.

### Setup screen

Code: `game/menu.ts` (`setupSelect`), `game/setup-bench.ts`, `Showroom.showSetup` / `renderBoxes`. Optional: the car screen starts
the stage with the recommended tyres and suspension and shows a summary line (amber `CUSTOM` when changed); `Setup car` opens
the screen. Most players never open it.

- **Rows** of three fixed-size boxes, left-aligned: **Tyres** (Tarmac / Mixed / Gravel, each rendered on the car's own rim, with
  size and a Best / Good / Poor / Bad grip chip per surface of the stage), **Suspension** (Soft / Medium / Stiff, each rendered
  as the car's own coil-over with travel, ride height, spring rate and rebound) and **Gearing** (Short / Medium / Long, a
  speed-per-gear chart; race cars only). `RECOMMENDED` marks the stage's pick.
- **Input:** click a box, or up / down switch the row, left / right change the choice, Enter confirms, Esc / B goes back.
- **Choices are not saved:** they reset to the recommendation when the stage or car changes. The URL carries them
  (`?tyre=`, `?susp=`, `?gear=`), and the leaderboard shows what each run used.
- **Drawing:** like every menu screen it shows the showroom's ground and sky behind the content. Each box is a transparent DOM
  element; every frame `Showroom.renderBoxes` renders the showroom first and then, per box, the part's own studio camera from
  `SetupBench` into that box's viewport. Call `showSetup(carId, boxes)` again after the menu re-renders.
- Style tokens (colours, sizes) are in `game/menu.css`, search "setup screen".

In game there is no tyre or suspension readout on the HUD (kept clean on purpose); a "<tyre> tyres on <surface>... hold on!"
line appears at GO for a poor pick, and `F2` shows tyre, set-up and per-wheel grip.

## Known limitations

- Chevrons are drive-through, not solid (marker posts are breakable, see Time penalties).
- Generation runs on the main thread (time-sliced). Very large maps would need a Web Worker for heightfield and scatter
  generation, merged far terrain chunks and per-chunk instance culling.
- Not done: tyre relaxation length, co-driver pace notes, car damage.
- Real-world maps: map data is not lazy-loaded yet, and a bare-earth DEM would help where the elevation model includes trees.
- Asset and car art is procedural or converted from open models; use the car and asset viewers to iterate.
