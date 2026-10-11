# Gravel Rally - details

> Overview and screenshots: [README.md](README.md). This file explains how the game works and where the code is.

Point-to-point rally. Look: late-2000s rally game (sun and shadows, sky / IBL, fog, dense forest, dust). Feel: grounded
sim-lite physics that is still fun on a keyboard.

## Pages and URLs

| Page        | URL                                                    | What it is                                                                       |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Game        | `/games/rally/`                                        | welcome -> select stage -> select car -> (set-up) -> drive                       |
| Map viewer  | `/games/rally/map-viewer.html?map=test&grid=1&splat=1` | aerial view, click terrain to inspect, "Drive from here", lat / lon on real maps |
| Car viewer  | `/games/rally/car-viewer.html?car=skoda_rally&seed=5`  | livery seed, door plate, pose, physics hull, torque chart, test drive            |
| Asset debug | `/games/rally/asset-debug.html?asset=pine_tree&lod=1`  | every asset / car (`car:<id>`) / texture (`tex:<id>`): seed, variant, LOD        |

Tool pages are dev-server only and keep their state in the URL; `H` hides the panel, `F3` shows stats, "Copy camera link"
gives `cam=x,y,z&look=x,y,z&fov=<deg>&clean=1`.

**URL parameters** (any of the play ones skips the menu):

| Parameter                  | Pages | Effect                                                                                                                              |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `map`, `car`, `livery`     | play  | stage, car, livery seed                                                                                                             |
| `tyre`, `susp`, `gear`     | play  | `tarmac / tarmac_hard / mixed / gravel_hard / gravel`, `soft / medium / stiff`, `short / medium / long` (default: the stage's pick) |
| `spawn`                    | play  | `start`, a flat-area name (`pad`) or metres along the road = free drive (no clock, never ranked)                                    |
| `quality`                  | play  | `low / medium / high`                                                                                                               |
| `mute=1`                   | play  | silent (bots and tests)                                                                                                             |
| `display=auto / sdr / hdr` | all   | lower exposure on HDR monitors (white paint glare)                                                                                  |
| `tod=<hours>`, `tonemap=`  | all   | look experiments: time of day (maps with `environment.timeOfDay`), `aces / agx / neutral`                                           |
| `air=<°C>`                 | play  | air temperature for the tyre temperatures (default: the map's `environment.airTemp`)                                                |

Console: `__rally.benchmark(240)` (avg / worst ms per frame, works with the tab hidden), `__rally.loadTimings`,
`__rally.vehicle`, `__rallyProbe()` (what the camera draws), `__worldShading`, `__mapViewer`, `__carViewer`.

## Controls

| Input    | Keys                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Keyboard | `W` / `S` throttle / brake (hold `S` when stopped = reverse), `A` / `D` steer, `Space` handbrake                           |
|          | `R` reset to road, `C` camera, `Esc` menu, `Q` / `E` shift (`G` manual gearbox), `T` traction / stability assist, `B` ABS  |
|          | `M` mute, `F2` telemetry, `F3` stats, `F4` force vectors + hull, `F8` autopilot, `F9` save the portal thumbnail (dev)      |
| Gamepad  | RT / LT throttle / brake, left stick steer, A / X handbrake, B reset, Y camera, LB / RB shift; menus: d-pad / stick, A / B |
| Touch    | on-screen steer arrows, BRAKE / GAS, reset to road and pause, landscape only (`game/touch-controls.ts`)                    |

## Game flow

- **Menus** (`game/menu.ts`): welcome -> **select stage** (orbiting 3D view of the stage, length, splits, best time; every map
  shows a pre-baked stage card, `tools/stage-card.ts`, re-baked with `?bakecard=<id>` only when asked) -> **select car** ->
  **Start stage** with the recommended set-up, or **Setup car**. The car stands in a 3D showroom (`game/showroom.ts`): car
  screens add studio strip lights to the env map (`Environment` `studio`) and a shallow depth of field
  (`engine/depth-of-field.ts`, off on low quality); the stage view keeps the map's sky env, no blur. Console (dev): `__showroom`.
- **Options** (main and pause menu): quality, object distance, volume, gearbox, traction assist and ABS (each hidden for
  cars with `physics.noTractionControl` / `noAbs`), car number (door plates), start camera. Saved in localStorage (`game/settings.ts`).
- **Menu music** (main menu only, none in the race): `game/menu-music.ts` loops `sources/music/*.mp3` (git-ignored, copied on build; only files present at build time play and are credited, so a CI checkout / Pages deploy is silent, no errors) (tracks + credits listed
  there), starts on the first click / key (autoplay rule), shows "now playing" bottom right, pauses with the tab. Main-menu
  Options slider `musicVolume` (0 = off, 100% plays at half of full volume); `?mute=1` silences it. Add a track = file + `MENU_TRACKS` row (+ `THIRD-PARTY.md`).
- **Pause** (`Esc`): resume, restart, free-drive pad <-> stage, options, main menu.
- **About:** every external source per map (`MapDef.sources`) and car (`CarDef.sources`), menu music credits, plus `version` from `game.json`.

**On a stage** (`game/stage.ts`):

- **Hold:** a stopped car with no pedal pressed is held (HUD `HOLD`); throttle releases it.
- **Sectors:** one bar segment per sector, amber while running, green / red against your best run.
- **Cutting** (`StageTimer.updateCut`): up to `CUT_WARN` (20 m off the road edge) is allowed. Past it the HUD shows `OFF STAGE`
  and a grace timer runs; when it ends, or past `CUT_MAX`, or on a later part of the road, the car is put back where it left.
- **Penalties:** manual reset +2 s (+10 s when flipped), forced reset +5 s. Knocked-over marker posts are free, chevron signs only slow the car a bit
  (`breakable` assets, `slow` in the catalog, `world/breakables.ts`): the car drives over them and they tip over until the stage restarts.
- **Finish:** the car brakes itself to a stop on the run-off (`finishStopControls()`), so every map needs a run-off. The
  autopilot (`F8`, finish stop) runs per 240 Hz physics step, exactly as in the tests.
- **Results:** time, delta to the best run, sector chips, then the stage top 10 (all cars / this car) with each run's set-up.
  Stored per map in localStorage (`rally.times.<map>`). `MAP_TIMES_VERSIONS` + `CAR_TIMES_VERSIONS` (`game/stage.ts`): each run stores its map and car version. On a bump
  `migrateTimes` keeps the runs, tags them with the version they were set on (`RunRecord.ver` / `carVer`) and lists them below all
  current runs, dimmed, behind a divider; the bumped map's / car's per-car bests move into the leaderboard as old runs. Times saved before per-map / per-car versions show as `v0`. Map change = bump that map; a car's
  handling change = bump that car; a shared physics change = bump every car. Livery / model fixes never bump. Agents bump
  them as part of the change (AGENTS.md).

## Look (`engine/environment.ts`, `engine/world-shading.ts`)

Per-map settings live in `MapDef.environment`; everything has a default.

- **Light:** the sun follows `timeOfDay` (or `sunElevation` / `sunAzimuth`); a lower sun is warmer and dimmer (raise `exposure`).
  Cool sky fill + warm ground bounce; a PMREM of the sky gives paint, glass and water reflections.
- **Shadows:** one shadow map ahead of the camera, snapped to texels so edges do not crawl.
- **Sky / tone mapping:** drifting clouds (`cloudCoverage`, `cloudSpeed`); ACES, or `toneMapping: 'agx' | 'neutral'` per map.
- **World shading** (tune live with `__worldShading`): cloud shadows, a canopy shadow texture that keeps woods dark outside the
  shadow box (`world/canopy-shadows.ts`), height fog warming towards the sun, wind, leaf translucency. Custom shaders must call
  `addWorldUniforms(shader)`.
- **Surfaces:** bump relief on roads, rocks and terrain (off on low); grass cards use alpha-to-coverage with MSAA.
- **Effects:** dust, gravel spray and haze (`game/dust.ts`), tyre marks (`game/tyre-marks.ts`), a contact shadow under the car,
  brake and reversing lamps (`CarModel.setBrake(level, reversing)`; a lamp's `userData.brakeLamp.reverseGlow` map lights its
  white section in gear R, in R the throttle key is the brake pedal; car viewer `lamps=brake|reverse`).

## Maps

| id          | name           | notes                                                                |
| ----------- | -------------- | -------------------------------------------------------------------- |
| `test`      | Test Map       | procedural 1.7 km forest gravel stage, hairpin, crest jump, test pad |
| `ajvatovci` | Ajvatovci Hill | real world (Ilinden, North Macedonia), 4.5 km old tarmac             |
| `petralica` | Petralica      | real world (North Macedonia), 9.6 km mountain stage, 560 m of climb  |
| `jackie`    | The Jackie     | real world (New York), 7.3 km parkway with bridges and portals       |

A map is `maps/<id>/map.ts` (gameplay and look) plus a baked `data.json` (`scripts/realmap/bake.py`: OpenStreetMap, ESA
WorldCover, elevation). Format and helpers: `maps/shared/`. World axes: +X east, **+Z south**. How to build and verify maps:
rally-maps skill.

**Lazy loading:** the registry (`maps/index.ts`) holds each map's light `MapInfo` (`<id>/info.ts` + the small baked
`route.json`: menus, stage select, URL defaults) and a dynamic import of the full `MapDef` (`map.ts` + `data.json` = its own
chunk). Menus use `MAPS` / `getMap(id)` (info); anything that builds a `World` awaits `loadMap(id)`. Tests and tools that need
every full map use `maps/all.ts`. `info.ts` must not import `data.json` (the landmark code in `world/` imports map files
eagerly: they use `route.json` too); `tests/rally/map-registry.test.ts` checks the info against the full map.

**Map features** (all set in `MapDef`):

- **Terrain:** real heightmap (detail + horizon grids), cover splat, field patchwork, `groundTint` season look
  (`world/terrain-gen.ts`, `real-data.ts`). Grass moisture: greener in hollows and along water, straw on ridges and steep
  slopes - a baked map texture (`world/ground-moisture.ts`, `World.moisture`) + the slope in the terrain shader;
  `groundTint.moisture` sets the strength (0 = off).
- **Horizon backdrop** (`horizon`, real maps): the land ~25 km around the map (terrain + land cover from Terrarium /
  WorldCover, no roads or buildings), baked by `scripts/realmap/horizon.py` into `<map>/horizon.json`, drawn behind
  everything with its own far plane (`world/horizon.ts`; ~2 draws, cut away inside the streamed terrain).
- **Corner fans** (`cornerFans`): small groups on the inside of tight corners along the whole stage - red / white tape,
  spectators, flags (`world/corner-fans.ts`, `World.cornerFans`; test `corner-fans`).
- **Other roads** (`paths`): tarmac ribbons, dirt paint or canals with their own surface; side roads carved with grade limits
  and extended to meet the stage road, `junctionBarriers` closes the mouths (`world/junctions.ts`). Dirt tracks / paths are
  only painted into the splat; coarse terrain tiles paint them at least ~a vertex step wide (`splat` `minPathHw`) so
  they stay lines from afar.
  The baker splits an OSM way where it folds back (> 120 deg) or revisits one of its nodes (two ways meeting there);
  a ground way under 15 m anchored at both ends is one straight ramp (`SHORT_JOINT`). Paved mouths on rural
  maps get rounded corners (`junctionFillets`, drawn with the street ribbons in `road-mesh.ts`; not on `cityStreets` maps).
- **Water:** canals / drains / rivers (`paths` surface `water`) and `lakes`, with real banks and water physics
  (`world/lakes.ts`, `water-mesh.ts`).
- **Railways:** OSM tracks as `rail` paths with a drivable ballast hump, rails and catenary (`world/railways.ts`, `rail-mesh.ts`).
- **Buildings:** placeholder boxes with stable ids (`buildings.csv`, viewer `?building=N`) or mesh buildings from the real
  footprints (`world/building-mesh.ts`).
- **Stage signs:** start / finish gantries and split boards from `MapDef.stage` (`world/stage-signs.ts`).
- **Landmarks:** hand-modelled lots on graded pads that replace the placeholders, hooks `surfaceAt` / `keepsClear` /
  `groundOverride` (`world/landmarks.ts`, `pads.ts`; `maps/ajvatovci/start-row`, `hilltop`, `station`).
- **City maps** (`jackie`): one-way carriageways, bridges and decks, portals, junction plazas, parkway lanes, continuous
  barriers, retaining walls, gores, overhead signs, kerbs / crosswalks / lamps, parked vehicles (`world/bridge-mesh.ts`,
  `portals.ts`, `plazas.ts`, `parkway-lanes.ts`, `barriers.ts`, `cut-wall-mesh.ts`, `street-detail.ts`).

City-map rules (streets keep their own height line, no terrain through decks, bug-fix workflow): rally-maps skill "Bridges and
underpasses". Tests: `tests/rally/` `bridges`, `city-maps`, `junctions`, `side-roads`, `water`, `railways`, `stage-signs`.

## Cars

| id             | name               | drive | notes                                                                                    |
| -------------- | ------------------ | ----- | ---------------------------------------------------------------------------------------- |
| `skoda_rally`  | Skoda Rally        | AWD   | Rally2-class hatch from a CC BY Fabia R5 model, own livery                               |
| `bimmer_m3`    | Bimmer M3          | RWD   | lowered E46 coupe from a CC BY print model, own livery                                   |
| `bimmer_gt2`   | Bimmer GT2         | RWD   | wide-body E92 GT2 racer from a CC BY Sketchfab model, clean livery (test only)           |
| `subie_22b`    | Subaru WRX STI 22B | AWD   | widebody GC8 / 22B from a CC BY-NC Sketchfab model, crescent / stars graphic (test only) |
| `zastava_101`  | Zastava 101        | FWD   | stock "Stojadin", body hand-built from dimensions and a blueprint                        |
| `fiesta`       | Fiesta WRC         | AWD   | World Rally Car from a CC BY model with its cockpit, own rim and livery, test car        |
| `citroen_c4`   | Citroen C4 WRC     | AWD   | 2007 World Rally Car from a CC BY model with its cockpit, own rim and livery, test car   |
| `lancer_evo_6` | Lancer EVO VI      | AWD   | 1999-style Lancer from a CC BY model with its cockpit, own rim and livery, test car      |

- A car is `cars/<car>/<car>.ts` (a `CarDef`: physics + model + sound) with its README. A GLB in `public/models/cars/` replaces the
  car's own body (`cars/shared/car-gltf.ts`; credits in `public/models/CREDITS.md`). Imports: rally-car-import skill.
- Every car has a body without its GLB: hand-built `model.custom` (Zastava) or `model.profile` (`cars/<car>/profile.ts`,
  baked by `scripts/car-model/side-profile.mjs`): the boxy side outline extruded to the body width with its glass and lamps
  tagged (`cars/shared/profile-body.ts`), shown only if the GLB fails to load. It wears the car's livery, box-projected
  onto the atlas (`CarAtlas.layout`). Car viewer `fallback=1` shows it.
- The same profiles are the city maps' parked cars (`street_car`, `taxi`, `police_car`; `assets/builders/vehicles.ts`):
  one paint, simple wheels, one draw call per LOD (variant sets); the far LOD simplifies the outlines and drops rims and
  lamps (`tests/rally/street-car.test.ts` holds the triangle budget).
- Car GLBs are committed plain (the model scripts and `hull-fit.test.ts` read them); the build copies them meshopt-compressed
  (`scripts/car-model/glb-meshopt.mjs`, about half the size, same meshes; `car-glb-meshopt.test.ts` checks every file).
- **Door plates** (`cars/shared/rally-badge.ts`): our own event plate (emblem, car number, map name) projected onto both front
  doors. Liveries carry no numbers or lettering.
- **Release flags** (`release.ts`): `CARS_LIST` / `MAPS_LIST` list every car / map id; `hideInProd: true` = dev server + `npm run build:test` only (TEST badge). Same flag and `RELEASE_BUILD` check (`src/shared/release.ts`) as `game.json`.
  Unknown ids fall back to the defaults; `tests/rally/release.test.ts` guards the lists. The flag only hides - code still ships.

## Sound (`game/audio.ts`, `game/engine-sound.ts`)

All synthesised (Web Audio, no samples), tuned per car by `CarDef.sound` (`CarSoundDef` in `cars/shared/types.ts`).

- **Engine**: one 4-stroke cycle of exhaust pulses from the firing order (`layout`: `i4 / i5 / i6`, `v8` cross-plane, `flat4`
  unequal headers) becomes a PeriodicWave played at rpm / 120 Hz; uneven layouts burble between the firing orders.
  `displacement` sets loudness and low end (a 1.3 l is thin and weak, a 4 l V8 heavy), `exhaust` the drive / rasp / brightness,
  `intake` the induction roar, `cam` the idle lope, `roughness` the cylinder-to-cylinder variation (seeded).
- **Events**: `turbo` = whistle + spool, then anti-lag bangs off throttle (`antiLag`) or a wastegate flutter on a lift; no
  `turbo` = none of it. `pops` = overrun crackle (and a crack on flat upshifts); `gearbox: 'sequential'` = clunk + ignition
  cut per shift; `gearWhine` follows road speed; rev limiter stutter.
- **Listener** = camera mode: hood / bumper hear more intake, gearbox and wind, less exhaust; far chase is quieter and duller.
- **Tunnels**: `World.tunnelAt` (portal slabs) -> `setEnclosure`: low-mid build-up, a slap echo per ear at each wall's
  distance (narrow = tighter flutter), a tail that grows with the tunnel length, a whump at each headwall.
- Ambient: wind (speed²), tyre roll on hard ground, gravel crunch, slide / lock-up per surface (`SLIDE_SOUND`), impacts. A
  compressor keeps bangs and tunnel build-up from clipping.

## Physics and set-up

Each stage recommends a tyre (`MapDef.tyre`) and with it a suspension preset (gravel soft, mixed medium, tarmac stiff). Each car
has its own tyre sizes per tyre family and a tyre grade (road / rally / slick) (`physics.tyres`), suspension presets (`physics.setups`) and gearings (`physics.gearings`). Grip =
surface x compound x tyre size / grade x set-up. Details and tuning workflow: [PHYSICS.md](PHYSICS.md), rally-physics-tuning skill.

**Setup screen** (`game/menu.ts` `setupSelect`, `game/setup-bench.ts`, `Showroom.renderBoxes`): optional; most players never
open it.

- Rows of boxes: **Tyres** (five: soft and hard tarmac, mixed, hard and soft gravel; on the car's own rim, grip chip per surface
  of the stage; the boxes shrink to fit), **Suspension** (the car's coil-over,
  travel, ride height, spring, rebound), **Gearing** (speed-per-gear chart, race cars only). `RECOMMENDED` marks the pick.
- Click, or arrows + Enter, Esc / B back. Choices are not saved (they reset with the stage or car); the URL and the leaderboard
  carry them.
- Each box is a transparent DOM element; `renderBoxes` draws the showroom, then each part's studio camera into its box. Call
  `showSetup(carId, boxes)` again after the menu re-renders. Styles: `game/menu.css` "setup screen".
- In game: no set-up HUD; a "hold on!" line at GO for a poor tyre pick; the dash shows the four tyre temperatures
  and a disc mark per wheel (PHYSICS.md "Tyre temperature" / "Brakes"); `F2` shows tyre, set-up, per-wheel grip, tyre and disc temperature.

Rendering: `cars/shared/tyre-mesh.ts` (tread per compound, compound ring), `suspension-mesh.ts` (per
`model.suspensionStyle`), `buildWheelSet` in `car-model.ts`.
Cars whose model has empty wheel wells set `model.cornerSuspension` (`cars/shared/corner-suspension.ts`): a coil-over in the car's
style plus arms / drive shafts, following the live wheel travel (Zastava, M3, GT2, C4, Lancer; Skoda, Fiesta, 22B show the model's own).

## Architecture

```
physics/      pure TS, no scene / DOM -> testable in node
  vehicle.ts    raycast-suspension rigid body, 240 Hz fixed step
  tire.ts       combined-slip tyre curve (friction ellipse)
  drivetrain.ts engine curve, gearbox, launch clutch, diffs
  surfaces.ts   grip / dust / bump per surface  <- tune surfaces here
world/        map data -> deterministic world
  road.ts         centreline at 1 m, height smoothing, spatial queries
  terrain-gen.ts  noise + real heightmap + pads + channels + road carving + splat
  heightfield.ts  chunked 1 m height cache = shared truth for physics and the LOD0 mesh
  scatter.ts      per-chunk placement, road-side rules, props, colliders
  world.ts        ties it together; physics ground; spawns, stage layout
  terrain-renderer.ts, instance-streamer.ts, road-mesh.ts, building-mesh.ts, landmarks.ts, ...
assets/       catalog.ts (variants, LODs, colliders <- add assets here), builders/, library.ts (cached geometry)
cars/         index.ts registry; <car>/ per car; shared/ = body, parts, tyres, suspension, livery, door plate
engine/       renderer, quality, sky / sun / fog / IBL, world shading, textures, materials, texture arrays
game/         rally-game.ts (frame loop), input, camera, stage timing, HUD, effects, audio, autopilot, menus
maps/         one folder per map, shared/ (format + helpers), index.ts registry
tools/        dev-only builders (stage cards)
pages/        entry points listed in game.json; debug/ = tool page shell
```

## Performance rules (keep these)

The game is CPU bound: **draw calls cost more than triangles**. Measure with `__rally.benchmark(n)` / `__rallyProbe()` on
`npm run dev:noreload`. Background load (other sessions, builds) and the tab (background tabs run slower) swing a single
run 2-3x, so compare old / new **in the same page, interleaved** over several rounds (switch at runtime, e.g.
`__setVariantSets(on)` + `__rally.streamer.reset(pos)`) and use the median; never compare runs minutes apart.

**Instancing and streaming**

- Never clone geometry or materials per instance: everything goes through `getAsset(id, variant, lod)` -> `InstancedMesh`,
  materials from `engine/materials.ts`.
- Streaming stays time-sliced: terrain (`terrain.update(pos, budgetMs)`), the 1 m heightfield (`Heightfield.prepare`) and
  instance re-bucketing (`InstanceStreamer`, ~2 ms per frame). Whole-map work uses `world.analytic`, not the 1 m cache.
- Whole-map set-up loops use a spatial grid, never all-against-all (a town map has ~900 roads, ~2000 way ends).

**Draw calls**

- Far terrain merges chunks 2 x 2 (LOD2) / 4 x 4 (LOD3) into one mesh; the tile plan is redone after 8 m of travel.
- Whole-map meshes are merged per tile, never per object. Many materials = many draws: use a texture array
  (`engine/texture-array.ts` `layeredMaterial`; mesh buildings = one mesh per 192 m tile, start-row lots = 3 material groups
  per 128 m tile). A custom shader must scale `envMapIntensity` (it carries `scene.environmentIntensity`), never replace it.
- Scatter view culling (`InstanceStreamer.setView`, called every frame by the game): non-shadow buckets (LOD1+) are
  angle-sorted and only the camera's view (+ 25 deg) is drawn. LOD0 shadow casters are drawn whole.
- Far trees: variants share one bucket past ~420 m (`LodSpec.oneVariant`); past 900 m they are 2-triangle camera-facing
  impostors (`LodSpec.impostor`, `assets/impostor.ts`).
- Variant sets (`getVariantSet`, `assets/library.ts`): the other LODs draw every variant with ONE `InstancedMesh` per material -
  all variants in one geometry, the instance's `instVariant` picks one, the shader clips the rest (`variantMaterial` /
  `variantDepthMaterial` for the shadow pass). Costs vertex work x variants, so sets are capped (vegetation 1200 triangles:
  big tree crowns stay per variant). `?variantsets=0` turns them off; test `variant-sets`.

**Distances**

- Nothing is drawn past the streamed terrain (`quality.viewDistance`): the streamer gets it as `maxDistance`, the whole-map road
  group is distance-culled by `world/distance-cull.ts`. Far scatter chunks of short-range assets are skipped wholesale.
- Knobs: `engine/quality.ts`, LOD distances in `assets/catalog.ts`, `TERRAIN_LODS` in `game/rally-game.ts`, map `fogDensity`,
  and the **Object distance** option (x1 / x1.5 / x2 on objects only, `OBJECT_DISTANCE` in `game/settings.ts`).

**Shadows**

- Only LOD0 casts shadows, so every LOD0 radius must reach the far edge of the shadow box: 1.5 x `quality.shadowExtent`.
- The shadow pass is triangle bound: hidden parts do not cast (car interior, parked vehicles' glass / chrome / details). An
  `InstancedMesh` spanning a whole area is never culled, so each of its casters draws every frame.

**Loading**

- Loading ends with a warm-up (`RallyGame.init`): wait for the imported car, compile, render one frame with culling off - so
  shaders (incl. the shadow pass) and buffer uploads happen behind the loading screen. A material first used mid-stage
  compiles then (a hitch): add it to the scene at load.
- Long synchronous steps (world build, road, props, shader compile) set their label and `paint()` first, so the bar never
  sits unlabelled at 0%. The car's GLB starts downloading before the map data (`preloadCarModel`).
- Car select: a "Loading model" spinner (`Showroom.loadCue`) shows while a car's GLB downloads (the car stays hidden until then).

## Known limitations

- Generation runs on the main thread (time-sliced); very large maps would need a Web Worker for heightfield and scatter.
- Real-world map data is not lazy-loaded; a bare-earth DEM would help where the elevation model includes trees.
- Not done: tyre relaxation length, co-driver pace notes, car damage.
