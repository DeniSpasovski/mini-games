# Gravel Rally - details

> Overview and screenshots: [README.md](README.md). This file explains how the game works and where the code is.

Point-to-point rally. Look: late-2000s rally game (sun and shadows, sky / IBL, fog, dense forest, dust). Feel: grounded
sim-lite physics that is still fun on a keyboard.

## Pages and URLs

| Page        | URL                                                               | What it is                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game        | `/games/rally/`                                                   | welcome -> select stage -> select car -> (set-up) -> drive                                                                                                                                            |
| Map viewer  | `/games/rally/map-viewer.html?map=test&stage=test&grid=1&splat=1` | a map with one of its stages (`stage=`, default the first; a stage picker lists them) in a season (`season=`, the Season picker), click terrain to inspect, "Drive from here", lat / lon on real maps |
| Car viewer  | `/games/rally/car-viewer.html?car=skoda_rally&seed=5`             | livery seed, door plate, pose, physics hull, torque chart, test drive, time of day + lights (`tod=1&lamps=brake`)                                                                                     |
| Asset debug | `/games/rally/asset-debug.html?asset=pine_tree&lod=1`             | every asset / car (`car:<id>`) / texture (`tex:<id>`): seed, variant, LOD                                                                                                                             |

Tool pages are dev-server only and keep their state in the URL; `H` hides the panel, `F3` shows stats, "Copy camera link"
gives `cam=x,y,z&look=x,y,z&fov=<deg>&clean=1`.

**URL parameters** (any of the play ones skips the menu):

| Parameter                  | Pages | Effect                                                                                                                                                                                   |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`, `car`, `livery`   | play  | stage id, car, livery seed; an old `map=<id>` link is rewritten in place to `stage=` (`stageLinkParams`; a map with several stages opens its first)                                      |
| `tyre`, `susp`, `gear`     | play  | `tarmac / tarmac_hard / mixed / gravel_hard / gravel`, `soft / medium / stiff`, `short / medium / long` (default: the stage's pick)                                                      |
| `spawn`                    | play  | `start`, a flat-area name (`pad`) or metres along the stage road = free drive (no clock, never ranked)                                                                                   |
| `quality`                  | play  | `low / medium / high`                                                                                                                                                                    |
| `mute=1`                   | play  | silent (bots and tests)                                                                                                                                                                  |
| `display=auto / sdr / hdr` | all   | lower exposure on HDR monitors (white paint glare)                                                                                                                                       |
| `tod=<hours>`, `tonemap=`  | all   | time of day (maps with `environment.timeOfDay`; 20-4:30 = night, see Look; the stage menu sets it), `aces / agx / neutral`                                                               |
| `air=<°C>`                 | play  | air temperature for the tyre temperatures (default: the stage's `temps` for the season and hour)                                                                                         |
| `season=`                  | play  | `spring / summer / autumn`: tree leaf colours, ground colour and the stage's `temps` for it (default: `StageDef.season`, else `environment.season`, summer); the map viewer takes it too |
| `perf=1`                   | play  | open the perf panel (below)                                                                                                                                                              |

Perf panel (`` ` `` key in game or `perf=1`, `game/perf-panel.ts`): FPS, frame ms, CPU ms per frame step, GPU ms (timer
queries; "Wait for GPU" measures it by a readback where they are missing), draw calls, triangles; switches for every
costly feature (world layers, each tree part, shadows, clouds, fog, IBL, effects) and sliders (resolution, object /
tree distance, shadow map). Remembered in localStorage, applied only while the panel exists.

Console: `__rally.benchmark(240)` (avg / worst ms per frame, works with the tab hidden), `__rally.loadTimings`,
`__rally.vehicle`, `__rallyProbe()` (what the camera draws), `__worldShading`, `__mapViewer`, `__carViewer`.

## Controls

| Input    | Keys                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard | `W` / `S` throttle / brake (hold `S` when stopped = reverse), `A` / `D` steer, `Space` handbrake                                                                |
|          | `R` reset to road, `C` camera, `Esc` menu, `Q` / `E` shift (`G` manual gearbox), `T` traction / stability assist, `B` ABS                                       |
|          | `M` mute, `F2` telemetry, `F3` stats, `F4` force vectors + hull, `F6` tree debug view, `F8` autopilot, `` ` `` perf panel, `F9` save the portal thumbnail (dev) |
| Gamepad  | RT / LT throttle / brake, left stick steer, A / X handbrake, B reset, Y camera, LB / RB shift; menus: d-pad / stick, A / B                                      |
| Touch    | on-screen steer arrows, BRAKE / GAS, reset to road and pause, landscape only (`game/touch-controls.ts`)                                                         |

## Game flow

- **Menus** (`game/menu.ts`): welcome -> **select stage** (route outline of the stage and 150 m either side, orbiting 3D view of
  the stage, length, splits, best time; every stage shows a pre-baked stage card, `tools/stage-card.ts`, cropped to the stage +
  500 m and re-baked with `?bakecard=<stage id>&season=all` / `?bakecards=1&season=all` only when asked, one picture per
  season; `stageCardHash` covers only what the card draws, so text edits need no re-bake) -> **select car** ->
  **Start stage** with the recommended set-up, or **Setup car** (small button left of the livery picker). The car stands in a 3D showroom (`game/showroom.ts`): car
  screens add studio strip lights to the env map (`Environment` `studio`) and a shallow depth of field
  (`engine/depth-of-field.ts`, off on low quality); the stage view keeps the map's sky env, no blur. Console (dev): `__showroom`.
- **Options** (main and pause menu): quality, object distance, volume, gearbox, traction assist and ABS (each hidden for
  cars with `physics.noTractionControl` / `noAbs`), car number (door plates), start camera. Saved in localStorage (`game/settings.ts`).
- **Auto quality**: with no `?quality`, saved choice or earlier measurement, the first Select car / stage screen measures the menu's median
  frame time for 2.5 s (`Showroom.measureFrameTime`) and saves a preset under its own key (`engine/quality.ts`); a manual choice always wins. High (picked or measured) also sets object distance Far and Display HDR.
- **Menu music** (main menu only, none in the race): `game/menu-music.ts` loops `sources/music/*.mp3` (git-ignored, copied on build; only files present at build time play and are credited, so a CI checkout / Pages deploy is silent, no errors) (tracks + credits listed
  there), starts on the first click / key (autoplay rule), shows "now playing" bottom right, pauses with the tab. Main-menu
  Options slider `musicVolume` (0 = off, 100% plays at half of full volume); `?mute=1` silences it. Add a track = file + `MENU_TRACKS` row (+ `THIRD-PARTY.md`).
- **Pause** (`Esc`): resume, restart, free-drive pad <-> stage, options, main menu.
- **Stage times** (welcome menu): stage list on the left (↑↓), the selected stage's saved runs over its map view in a card docked beside the list (`.menu-times-card`); current versions first, older ones dimmed below.
- **About:** every external source per map (`MapDef.sources` + its stages' `StageDef.sources`) and car (`CarDef.sources`), menu music credits, plus `version` from `game.json`.

**On a stage** (`game/stage.ts`):

- **Hold:** a stopped car with no pedal pressed is held (HUD `HOLD`); throttle releases it.
- **Sectors:** one bar segment per sector, amber while running, green / yellow against your best run (faster / slower).
- **Cutting** (`StageTimer.updateCut`): up to `CUT_WARN` (20 m off the road edge) is allowed. Past it the HUD shows `OFF STAGE`
  and a grace timer runs; when it ends, or past `CUT_MAX`, or on a later part of the road, the car is put back where it left.
- **Penalties:** manual reset +2 s (+10 s when flipped), forced reset +5 s. Knocked-over marker posts are free, chevron signs only slow the car a bit
  (`breakable` assets, `slow` in the catalog, `world/breakables.ts`): the car drives over them and they tip over until the stage restarts.
- **Finish:** the car brakes itself to a stop on the run-off (`finishStopControls()`), so every map needs a run-off. The
  autopilot (`F8`, finish stop) runs per 240 Hz physics step, exactly as in the tests.
- **Results:** time, delta to the best run, sector chips, then the stage top 10 (all cars / this car) with each run's set-up.
  Stored per stage in localStorage (`rally.times.<stage>`). `STAGE_TIMES_VERSIONS` + `CAR_TIMES_VERSIONS` (`game/stage.ts`): each run stores its stage and car version. On a bump
  `migrateTimes` keeps the runs, tags them with the version they were set on (`RunRecord.ver` / `carVer`) and lists them below all
  current runs, dimmed, behind a divider; the bumped stage's / car's per-car bests move into the leaderboard as old runs. Times saved before per-stage / per-car versions show as `v0`. Each run also stores `season` + `hour`; runs without them show Summer and the stage's own time of day (`runConditions`). Stage road change = bump that stage (a map's road change bumps every stage on it); a car's
  handling change = bump that car; a shared physics change = bump every car. Livery / model fixes never bump. Agents bump
  them as part of the change (AGENTS.md).

## UI style

Tokens, type, shapes, components and rules: [STYLEGUIDE.md](STYLEGUIDE.md). Code: `game/ui-tokens.css`, `menu.css`, `hud.css`, `menu-icons.ts`; the stage plate is `stagePlateHtml` in `game/menu.ts`.

## Look (`engine/environment.ts`, `engine/world-shading.ts`)

Per-map settings live in `MapDef.environment`; everything has a default.

- **Light:** the sun follows `timeOfDay` (or `sunElevation` / `sunAzimuth`); a lower sun is warmer and dimmer (raise `exposure`).
  Cool sky fill + warm ground bounce; a PMREM of the sky gives paint, glass and water reflections.
- **Shadows:** three layers, each taking over where the one before ends, blended in `engine/world-shading.ts`
  (`SUN_TERMS`, `SUN_SHADOW`):
  - the sun's shadow map ahead of the camera (`quality.shadowExtent`, snapped to texels), every frame. Trees cast into
    it within `quality.treeShadowDistance`; it fades out before a tree past that could shade the ground
    (`setNearShadowFade`, from `RallyGame.placeShadows`: the distance minus a crown shadow's reach at this sun height);
  - the far shadow map (`world/far-shadow.ts`, `quality.farShadow*`, ~4x the box): terrain, static meshes
    (`farShadowCaster`) and one hashed ellipsoid per tree crown, re-drawn only when its snapped box moves (~every
    25 m), from inside the main render (`trigger`). Covers only the disc where it has crowns (`setFarShadowDisc`);
    tree materials look it up at their shadow lookup point (out of their own crown, as in the sun's map). It fades in
    `SHADOW_OVERLAP` m before the sun's map fades out; over that band the darker of the two wins;
  - past both, the baked canopy shadows (World shading below).
  - Terrain casts into both maps (`TerrainOptions.castShadow`): hills shade the valleys.
- **Night** (`engine/night.ts`, `?tod=<hours>` from 19:30 to 04:30 on any map; not in the studio): the moon is the directional light
  (dim, blue, `moonAt`), the sky is a dark dome with a town glow, moon and stars (`NightSky`), fog is dark, tone mapping AgX at a
  fixed exposure; the env map and the tree ambient (`setTreeSky`) are rebuilt from the night sky. The car's lights fade in with the dark (`lightNeed`, from the sun height: off by day, ~0.6 at the 17:30 evening, 1 at night; scales lamps, beam, cones and dust glow). They switch on
  (`CarModel.setLamps(level)`: head / tail lamp materials, `userData.headLamp`) and `game/headlights.ts` (strength, colour and beam shape per car: `CarDef.headlights`) adds a low-beam spot, a wide
  spill spot and two soft beam cones; dust, spray and haze glow inside the beam (`ParticleSystem.setHeadlight`). Shadows: the low
  beam and the moon cast them on high quality only. Head lamps (`part-materials.ts` `headLamp`) are nearly dark with the lights
  off and get a halo in the beam colour when on (`LampHalos` `front`); the beam starts at the model's own lamps
  (`CarModel.onHeadlamps` -> `Headlights.moveTo`), and its cones fade when seen from in front (glare, not a lit wall). No map has a night stage yet. Road side (`engine/night-glow.ts`, shared `ws*` uniforms): marker-post reflectors and chevron boards
  light up in the car's beam (`retro`), street lamp lenses glow with `lightNeed` and `world/lamp-pools.ts` lays a soft light pool under
  each lamp. High quality adds bloom (`engine/post-fx.ts`, threshold far above the lit ground, so lenses and reflectors are
  emissive well over it). Not done: high / low beam key.
- **Post effects (High):** `engine/post-fx.ts`, options **Bloom** (off / soft / strong, default off, `BLOOM_MIX` in `game/settings.ts`) and
  **Ambient occlusion** (default off). Bloom: the whole picture, no threshold, mixed back at a few percent, worked on an HDR
  estimate of the finished picture, so with it off the image is unchanged. AO: GTAO from the depth at half resolution.
  Test links: `?bloom=<mix>` (0 = off), `?ao=0|1`; console `__rally.post.set({ day: 0.04, ao: true })`.
- **Sky / tone mapping:** drifting clouds (`cloudCoverage`, `cloudSpeed`); ACES, or `toneMapping: 'agx' | 'neutral'` per map.
  `skyBrightness` dims the visible dome only (deeper blue; the env map keeps the full sky, so the world's light is unchanged).
  `fogColor: 'sky'` takes the hue of the sky just above the horizon (a tiny half-float cube of the env scene) at the
  luminance `fogBrightness`, so distant hills fade into the sky's colour.
- **Colour grade** (`engine/grade.ts`, `EnvironmentDef.grade`, season changes in `grades`): white balance, contrast round
  mid grey, saturation, vibrance, shadow / highlight tint, vignette, inside the tone-mapping chunk (wraps the ACES / AgX /
  Neutral functions: no extra pass, MSAA kept). No `grade` = the plain tone-mapped image. Off at night and in the studio;
  `goldenHour` replaces sky, fog, exposure and grade in the evening (`isGoldenHour`: 17:00 till night).
  `?grade=off` to compare, `?look=before|sky|soft|crisp|warm|cool|vodno-before|forest|forest-haze` to try test variants (`LOOKS` in environment.ts), `__grade.set({...})` to tune live. `gradeColor` mirrors the shader for tests.
- **Car reflections:** three.js draws a material without its own env map at `scene.environmentIntensity` (0.3), so car
  materials are flagged `carEnv` (engine/world-shading.ts): their specular env lookup uses their own `envMapIntensity`
  relative to `CAR_ENV_DAY` (0.6: by day 1 = 1.67x the world's, a street sheen, not a studio mirror; `setCarEnvSun`
  eases it to 0.3 with the sun below ~18 deg and at night, where the reflection is what shows a car's shape), the
  diffuse sky light stays the scene's.
- **World shading** (tune live with `__worldShading`): cloud shadows, a canopy shadow texture that keeps woods dark where
  neither shadow map reaches (`world/canopy-shadows.ts`: a coarse whole-map texture plus a 1.5 m local window of 768 m
  around the camera, rebuilt from the generated scatter chunks every 64 m), height fog
  warming towards the sun, wind, leaf translucency. Custom shaders must call `addWorldUniforms(shader)`. Flag cloth
  (`defines.RALLY_FLAG`: materials `flag` = the printed flag of North Macedonia, texture `flag_mk`; `fan_flag`) turns downwind
  and ripples; print the pattern on the cloth, never lay geometry over it (the wind shader moves vertices, not surfaces).
  `groundTint.variety` adds deeper-green / yellow-green meadow patches to the tinted grass (spring).
  Levelled gardens / park strips: `terrain.lawns` (flat world polygons) paints the terrain itself pure grass (splat) and wet
  (`world/ground-moisture.ts`, lush green) - do not lay a green decal over terrain.
- **Surfaces:** bump relief on roads, rocks and terrain (off on low); grass cards use alpha-to-coverage with MSAA.
  Terrain ground = Poly Haven scans in one texture array (`engine/ground-textures.ts`, tiles in `engine/ground/`,
  `scripts/ground/bake.py`): grass per season, soil, gravel, rock, leaf litter, stubble under crops. The splat channels blend by
  height (scan brightness), a blurred rotated second tap breaks the tiling, unused layers are not sampled. Leaf litter lies where
  the canopy texture has crowns (`wsCanopyCover`; strength per season, `groundTint.litter`), fresh coloured leaves in autumn.
  The meadow scans carry the old tile's olive hue so each map's `groundTint` keeps its look.
  Terrain chunks beyond the first LOD band use the cheaper `TERRAIN_FAR` material (`world/terrain-material.ts`): no relief, one
  tap per layer, no specular environment lookup.
- **Effects:** dust, haze and water splash (`game/dust.ts`; sprites fade into the ground or water under them, `floor`), gravel
  spray as tumbling stones (`game/gravel-stones.ts`), splash off wheels in water (`rally-game.ts` `emitSplash`), tyre marks (`game/tyre-marks.ts`), a contact shadow under the car,
  brake and reversing lamps (`CarModel.setBrake(level, reversing)`; a lamp's `userData.brakeLamp.reverseGlow` map lights its
  white section in gear R, in R the throttle key is the brake pedal; car viewer `lamps=brake|reverse`). With the lights off a lamp
  is dark (no glow, by day too); with the lights on it moves to its `LampNight` glow (`part-materials.ts` `lamp()`): red lamps keep it low and in pure red, because AgX turns a bright red
  salmon pink (ACES, by day, keeps pure red up to ~1.2); a lamp's glow map holds the LED parts at full red and the lens body dimmer.
  A lamp piece on the centre line (the third brake light) is split off at load (`lamp-islands.ts`) and lights with the brake only,
  halo included (`SOLID_CENTRE` sheets glow by the sheet's own red, so a speckled strip has no holes); `gltf.bootLamps` does the
  same for the boot-lid half of a split tail lamp, which is also its white reversing lamp (Bimmer GT2); `lamp()` `idleGlow` does
  it inside one glow map (22B: pale red body = running lamp, strong reds = brake).
  A lamp with a `LampNight` also gets a soft red halo (`cars/shared/lamp-halo.ts`: its silhouette from behind, blurred, on an
  additive quad), and at night `game/headlights.ts` `TailLight` adds a dim red spot behind the car (road, verges) while
  `ParticleSystem.setTaillight` tints the dust behind it; both follow the brake pedal (`rally-game.ts` `lightParticlesByLamps`).
  Check lamps in the car viewer: `tod=1` (night; `tod=17.5` = evening, lights half on) with `lamps=off|on|brake|reverse` (off = every lamp dark, on = the running lamps as the hour has them), `beam=0` hides
  the headlight beam, `quality=high` adds the bloom.

## Maps

Maps and stages: a **map** is the world (terrain, roads, land cover, scatter, buildings, environment: `maps/<id>/map.ts`); a
**stage** (`StageDef`, the map's `stages`, `maps/<id>/stages.ts`) is the event on it: name, tyre / gearing, `reverse` (driven
against the road's direction), `timing` (start / finish / splits), `closures` (barrier rows at side-road mouths, `stageMargin`
= only along the stage), `cornerFans`, event `props`. Players only see stages; times (`rally.times.<stage>`), release flags
(`STAGES_LIST`), URLs (`?stage=<id>`; an old `?map=<id>` link is rewritten to it) and cards (`maps/<map>/preview/<stage>.json` + one `<stage>-<season>.jpg` per season)
are keyed by stage id. Every map from before the split has one stage with the old map id, so stored times kept their keys
(`tests/rally/times-migration.test.ts`, `stage-identity.test.ts`). The world never depends on the stage: `World(map, stage)`
keeps `road` (geometry) and adds `stageRoad` (the road, or its `reversed()` view) for timing, spawn, signs, fans, closures
and the autopilot.

| map id      | name            | notes                                                                                                                                                          |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`      | Forest Rally    | procedural 1.7 km forest gravel stage, hairpin, crest jump, test pad                                                                                           |
| `ajvatovci` | Ajvatovci Hill  | real world (Ilinden, North Macedonia), 4.5 km old tarmac                                                                                                       |
| `petralica` | Petralica       | real world (North Macedonia), 9.6 km mountain stage, 560 m of climb                                                                                            |
| `jackie`    | The Jackie      | real world (New York), 7.3 km parkway with bridges and portals                                                                                                 |
| `galichica` | Galichica       | real world (North Macedonia), pass road between Lake Ohrid and Lake Prespa, 3 stages (two run against the road); West released, East and Prespa test           |
| `vodno`     | Vodno Hillclimb | real world (Skopje, North Macedonia), 4.0 km hillclimb up Mount Vodno, whole suburb, ai-generated churches and summit landmarks, cross, mast, moving cable car |

A map is `maps/<id>/map.ts` (gameplay and look) plus a baked `data.json` (`scripts/realmap/bake.py`: OpenStreetMap, ESA
WorldCover, elevation). Format and helpers: `maps/shared/`. World axes: +X east, **+Z south**. How to build and verify maps:
rally-maps skill.

**Lazy loading:** the registry (`maps/index.ts`) holds each map's light `MapInfo` (`<id>/info.ts` with its `stages` + the
small baked `route.json`: menus, stage select, URL defaults) and a dynamic import of the full `MapDef` (`map.ts` + `data.json` =
its own chunk, shared by every stage of the map). Menus use `STAGES` / `getStage(id)` (`StageInfo`); anything that builds a
`World` awaits `loadStage(id)` (`{ map, stage }`). Tests and tools that need every full map use `maps/all.ts`
(`ALL_STAGE_DEFS` = every map / stage pair). `info.ts` must not import `data.json` (the landmark code in `world/` imports map files
eagerly: they use `route.json` too); `tests/rally/map-registry.test.ts` checks the info against the full map.

**Map features** (all set in `MapDef`):

- **Terrain:** real heightmap (detail + horizon grids), cover splat, field patchwork, `groundTint` season look
  (`world/terrain-gen.ts`, `real-data.ts`). Grass moisture: greener in hollows and along water, straw on ridges and steep
  slopes - a baked map texture (`world/ground-moisture.ts`, `World.moisture`) + the slope in the terrain shader;
  `groundTint.moisture` sets the strength (0 = off).
- **Field crops** (`landcover.fields.crops`, Ajvatovci): each field parcel's palette entry names the crop standing on it per
  season, and scatter rules with `crop` grow only there (`TerrainGenerator.cropAt`, not within 0.8 m of a parcel edge).
  Wheat is green and short in spring, ripe in summer and gone in autumn (stubble tint): 1 m card patches to 90 m, at
  least 2 m clear of the stage road. Corn (assets `corn`, `corn_row`, dry versions; no stage grows it yet): rows 0.75 m
  apart along the strips (`rows.fields`), plant cards near the roads, 3 m row cards further in. The models are
  two CC BY Sketchfab models (`THIRD-PARTY.md`) baked by `scripts/crops/bake-crops.py` into `crop-models.data.ts`; the
  cards are rendered from them once per page (`engine/crops.ts` `bakeCropCards`), 4 variants each with their own mix of
  plant heights (stacked in one texture; the asset variant picks one) so the field tops are uneven. Near detail
  is fixed by road distance, never by camera distance (catalog `nearRoad`, `nearBoost`): grass is denser within 14 m of a road
  (crossed cards at every distance: blade strips by the road read as bare ground next to them), so nothing swaps or
  fills in as the car drives on.
- **Horizon backdrop** (`horizon`, real maps): the land ~25 km around the map (terrain + land cover from Terrarium /
  WorldCover, no roads or buildings), baked by `scripts/realmap/horizon.py` into `<map>/horizon.json`, drawn behind
  everything with its own far plane (`world/horizon.ts`; ~2 draws, cut away inside the streamed terrain). A grid may be
  off-centre and non-square (`horizon` `extent` in the bake config: Vodno reaches 50 km north over the valley, 16 km south behind
  the ridge). Catalog assets in `props` named in `FAR_LANDMARKS` (the Vodno cross and mast) are also drawn there with their last
  LOD, so they stay on the skyline beyond the scatter's view distance. Its woods are shaded per pixel (`LAND_DETAIL`: noisy
  edges, tone patches, crown speckle, rock on steep ground) in the stage's crown colour (`setForest`, `canopyTone`); inside
  the map they come from the far forest's canopy map, so they match the map's own forests.
  A far river (`HorizonDef.rivers`, bake config `rivers`: `scripts/realmap/rivers.py` after horizon.py) is a centreline + width from
  the WorldCover water pixels, drawn as one flat ribbon over the finest grid (`riverGeometry`; Vodno: the Vardar, one draw).
  `skyline` (`SkylineBuilding`: extruded footprint, one wall / glass band per floor, flat roof) adds the city's tall buildings beyond
  the baked area (Vodno: Cevahir Sky City, the MRT tower; one draw, `skylineGeometry`).
- **Cable cars** (`aerialways`): a gondola line from a polyline - pylons on its vertices (`pylonsAtVertices`) or evenly spaced (taller
  where the slope asks), two ropes in a sag parabola, cabins running the loop (`world/aerialway.ts` pure layout + `cabinPose`, test;
  `aerialway-mesh.ts` one instanced mesh moved when drawn; asset `gondola_pylon`).
- **Corner fans** (stage `cornerFans`): small groups on the inside of tight corners along the whole stage - red / white tape,
  spectators (some waving their map's own hand flag - `MapDef.country` - or a plain colour flag, never another country's) + visitors, a marshal, 1-2 photographers, flags; marshals at every side-road mouth, 5 photographers each at start and finish (people are capped on purpose: `DEFAULT_FANS`, `SHOOTERS`, `END_PHOTOGRAPHERS` in corner-fans.ts)
  (`world/corner-fans.ts`, `World.cornerFans`; test `corner-fans`). People animate (`world/people-anim.ts`, run by `RallyGame.frame`): within 45 m they turn to watch the car, photographers (75 m) keep it centred, via `InstanceStreamer.setMatrix`; hand flags wave in the `people_flag` shader (`engine/materials.ts`, own mesh from `markFlag` in people.ts).
- **Service park** (stage `servicePark`; `world/service-park.ts`, `World.servicePark`; assets `assets/builders/service.ts` + `teams.ts`, the tool chest / tyre rack / trolley jack scans in `simready.ts`;
  per map `maps/<id>/service-park.ts`; tests `service-park`, `parc-ferme`): team bays on levelled gravel lots - truck / van, team cars on
  ground sheets, tents, props, crew and guests - plus tape, a crowd (seated or flag-waving fans, photographers, visitors) and a start
  control. Team trucks, vans and the catering van are the background models in team paint plus side stripes.
  - **Lot** (`ServiceLot` in `maps/shared/types.ts`): a rectangle levelled by a `terrain.pads` entry (`servicePad` in
    `maps/shared/service-lot.ts`; its `apron` levels the strip to the road, `level` fixes a flat field). `cars` = team cars wanted
    (a works bay holds two), `semis` = team lorries (`service_semi`, the baked lorry model) across the gravel behind one row of bays,
    `links` = dirt links across the verge (`linkPad`: gravel ramp up to the road, 5 m wide; tape, crowd and press keep off them).
  - People per lot: `mechanics` [min, max] makes a lean lot (the cars with just that many mechanics each, no crew / drivers / guests /
    aisle visitors), `crowd` and `press` set the spectators and photographers along the edge, `showWithin` draws everything on the
    lot (and its park cars) only within that many metres of the camera (`ScatterInstance.showWithin`, checked by `InstanceStreamer`
    and `ParkCars`).
  - **Ajvatovci**: the start lot is lean (4 cars, 2-3 mechanics each, 20 spectators, 5 photographers, none at the start line itself); the
    west park (field beside the factory road, 6 cars, 5 lorries behind the bays, 3 links) is a full paddock with a crowd of 40, drawn
    only within 90 m (seen when driving back in free drive).
  - **Parc fermé** (`ferme`): a row of team cars, noses to the tape, on a lay-by behind the start (`ServiceLot.bays` per lot): Test 4,
    Galichica West 6, Galichica East / Prespa-Ohrid 5. Each car has its crew and, on a lot 12.5 m deep (`TENT_DEPTH`), its team tent
    and tool chest. On a street (The Jackie 5 + 5, Vodno 6 on its side street) the lot lies over the road (`paved`, no pad) and
    `parallel` parks the cars nose to tail along the kerb with a 3 x 6 m tent behind each.
  - **Recovery truck** (`ServiceLot.tow`): `service_tow` (dump cab + roll-back deck, `build/truck-backs.ts`, one colour) and a marshal in
    a 9.5 m stretch at the lot's far end; make the lot that much longer (Test, Galichica West, Jackie east street, Vodno).
- **Park cars**: `team_car` only places the car and its collider. The car is a real released model at low quality
  (`world/park-car-mesh.ts` `ParkCars`, owned by `InstanceStreamer`, `streamer.ready`): `public/models/cars/<id>_park.glb`
  (`scripts/car-model/park-lods.mjs`: body LODs of about 7.5k / 2.3k / 1.1k triangles, three rims) in the team's livery (car's own
  painter, one texture per car and team), two draw calls per car; a raised car stands on axle stands (`tyre_stack` beside it). Models
  load near the park and are freed far away (`parkCarsPlan`). Tests `park-cars`, `car-glb-meshopt`.
- **People** (`assets/builders/people.ts`; credits THIRD-PARTY.md): close up (LOD 0 ~7k body + ~6-15k clothes, LOD 1 the same on the 2.5k mid mesh)
  a person is one of two CC BY base bodies (`engine/people-base.data.ts`, baked by `scripts/people/extract-base.py` + `skin-map.py` +
  `bake-base.mjs`, sources in `sources/people/base/`), posed on the CPU per variant (`people-body.ts`: 13 bones, A-pose baked in, `widen` for
  build) with a painted face (`engine/people-skin-material.ts`, tinted to the skin tone). Everything worn is cut from that body:
  `people-tailor.ts` (scalar fields clip the body, offset, relax, crease, seal, unwrap onto the fabric atlas cells of
  `engine/people-fabrics.ts`; `split` / `splitIn` cut exact bands, hoops, checks, tape, pads), `people-wear.ts` (`dress`: tops, trousers, skirts,
  coverall, hi-vis vest, gloves; team shirt patterns), `people-hair.ts` (scalp cut from the head + curtains, buns, ponytails, hats),
  `people-shoes.ts` (lofts on the foot bones; the base legs end at the ankle). Each person gets a hairstyle from `pickHair` (people.ts) by
  gender, length, age; `Outfit.topKind` / `legKind` / `pattern` / `hairStyle` / `shoeKind` override the defaults. LOD 2 / 3 stay code-built
  (jointed figure, boxy body, silhouette). The two detailed levels are `lazy` (`LodSpec.lazy`, tens of ms per person): they are built in
  workers (`people-worker.ts`, `people-pool.ts`: geometry only, each part tagged with its material's look, `withLooks` in people.ts), not
  per variant at load. The load builds what the spawn view needs (`world/people-warm.ts`, started with the load) and one warm variant per
  material (`AssetMeta.warm`; a test checks no other variant adds a shader); while driving `InstanceStreamer` (`prefetch`) asks for the
  levels ahead of the car, nearest to being needed first (`world/build-queue.ts`), and draws the next cheaper LOD until one is there. Built levels are capped (`LAZY_BUDGET`, 48 MB): idle ones the car left ~600 m behind are dropped, least recently used first (`evictions`, `InstanceStreamer.evict`) and built again if needed.
  Roles: `spectator` (24 standing + 18 sitting / squatting + 12 flag wavers), `mechanic`, `crew`, `driver`, `marshal`, `photographer`,
  `visitor` (12 personas: ages, sizes, skirts, kids); test `people`. A new look = a field in `Outfit`, a new pose = `POSES`.
- **Guard rails** (`barriers`): continuous swept rails / Jersey walls by distance; `hairpinRails` (`maps/shared/real-map.ts`)
  puts them on the outside of every tight bend of a mountain road (Galichica). `rusty: true` = weathered brown steel (Vodno).
- **Scatter area** (`MapDef.scatterBounds`): narrows where trees / bushes / rocks are generated (any side of `bounds`) - for land no
  camera can see (Vodno: nothing south of the ridge). A way merging into another at a shallow angle sets `PathDef.mergeTaper` (its end
  narrows to a point) and `joinsUnder` (its ribbon lies under the other's).
- **Road textures** (`RoadDef.texture`, per stretch in `sections`): gravel `road`, `road_tarmac` (light neutral grey asphalt from the Poly Haven Asphalt 04 scan, CC0, with hairline cracks and faint tyre / oil marks: Ajvatovci, Galichica, Petralica; the scan goes in `sources/textures/asphalt_04/`, listed in `PHOTOS` in `scripts/asphalt/bake.mjs`), `road_tarmac_kerbed` (the same without edge grit: Ajvatovci's kerbed start street up to the canal bridge), `road_tarmac_lines` (the
  same with white edge and centre lines), `road_tarmac_plain` (the same surface without lines: Vodno's crossroad, where the road
  paint lies over it), `road_parkway`, the city asphalts (`road_city`, `road_street`, `road_street4`, `junction_asphalt`).
  The asphalts are baked images, not drawn at load: `engine/asphalt/<id>.<size>.{color,normal,rough}.webp`, made by
  `scripts/asphalt/bake.mjs` (tiles drawn by `gen.js` in headless Chromium; the output is committed, rerun after changing
  `gen.js`). High loads the 1024 px set, Medium / Low their own 512 px set. `engine/road-surface.ts` loads them (the play page
  preloads the map's sets), `getRoadMaterial` puts them on the road: colour + normal map with the roughness packed in its alpha
  (one sampler) + a tone shader (blotches and streaks that never repeat; Vodno's tiles also get pale repair patches there, more of
  them higher up the road). A new asphalt id = a `gen.js` preset, `ROAD_SURFACE_LEN` (same `len` as `texLength`, a test checks),
  a rebake.
- **Road paint** (`RoadDef.markings`): lane lines (solid or dashed) and left / straight arrows as thin meshes over the road
  (`world/road-markings.ts`: `roadPaint` is the pure geometry, `roadMarkingsMesh` the meshes; textures `road_paint`,
  `road_arrow_left`, `road_arrow_straight`). Positions are measured from the road's left or right edge, so a lane keeps its
  place where the road widens on the other side (Vodno's crossroad: `maps/vodno/crossroad.ts`).
- **Other roads** (`paths`): tarmac ribbons, dirt paint or canals with their own surface; side roads carved with grade limits
  and extended to meet the stage road, the stage's `closures` close the mouths (`world/junctions.ts`). Dirt tracks / paths are
  painted into the splat, and drawn as gravel ribbons too on maps with `trackRibbons`; `pathProfiles` overrides the
  height-line smoothing / grade per OSM kind (`PATH_PROFILE`); coarse terrain tiles paint them at least ~a vertex step wide (`splat` `minPathHw`) so
  they stay lines from afar.
  The baker splits an OSM way where it folds back (> 120 deg) or revisits one of its nodes (two ways meeting there);
  a ground way under 15 m anchored at both ends is one straight ramp (`SHORT_JOINT`). Paved mouths (plain tarmac
  side roads and city streets, not on a plaza) get rounded corners (`junctionFillets`, drawn with the street ribbons in
  `road-mesh.ts`): every surface there (stage road edge, side road, a pad over the corners) blends into one world-aligned
  asphalt, the stage road's own surface laid flat (`JUNCTION_ASPHALT` in `junctions.ts`: `road_tarmac_junction`, Vodno's
  `road_tarmac_plain_junction`; square tile, no wheel paths, edges or lines, sampled by world XZ in the road shader, weight
  in the mesh's `jw` attribute; `junctionMouths`), within 6 m, or 2 m where painted lines end at the mouth (Vodno's edge
  lines, a street's centre line), with the dusty edge band running round each curve. On `cityStreets` maps the sidewalk
  turns round each corner onto the stage road edge, its kerb dropping flush there (`mouthCorners`, `StreetDetail.returns`).
- **Water:** canals / drains / rivers (`paths` surface `water`) and `lakes`, with real banks and water physics
  (`world/lakes.ts`, `water-mesh.ts`). `Lakes.query` reads only the outline edges near the point (a 16 m grid per outline): exact `sd` within
  `LAKE_REACH` of the shore, `-LAKE_REACH` further inside (every user stops at `LAKE_SHELF`); test `lakes-index`.
- **Railways:** OSM tracks as `rail` paths with a drivable ballast hump, rails and catenary (`world/railways.ts`, `rail-mesh.ts`);
  the bed is the `rail_track` canvas (sleepers, rust) with the gravel ground scan's stones between the sleepers.
- **Buildings:** placeholder boxes with stable ids (`buildings.csv`, viewer `?building=N`) or mesh buildings from the real
  footprints (`world/building-mesh.ts`). Box houses take wall / roof scans from one texture array (`engine/house-walls.ts`, UVs from the
  instance scale in the shader; tiles in `engine/facades/`, `scripts/facades/bake.py`); on Galichica / Petralica the share of rubble-stone houses
  grows with height (`buildingInstance`).
- **Stage signs:** start / finish gantries and split boards from the stage's `timing`, along the stage road (`world/stage-signs.ts`).
- **Terrain by hand:** `terrain.pads` level the land round a lot (along the road: `frontage` + `lift`) or a house on a slope (a terrace:
  `PadDef.level`); the road's carve wins near the road. `road.cutWalls.range` limits the sheer, walled cut to one stretch of the stage
  road (Vodno's concrete wall at the first crossroad, on a pad `lift`ed above the road: `maps/vodno/crossroad.ts`);
  `cutWalls.solid` holds the cut tight (`cutShape`: a thin coping) and gives the face box colliders
  (`world/cut-wall-colliders.ts`), so a car stops at it. `routePoints` takes a
  sideways shift (a lane added on one side). `MapDef.treeSetback` keeps the solid trees back from the road's edge along a stretch.
- **Landmarks:** hand-modelled lots on graded pads that replace the placeholders, hooks `surfaceAt` / `keepsClear` /
  `groundOverride` (`world/landmarks.ts`, `pads.ts`; `maps/ajvatovci/start-row`, `hilltop`, `station`; Vodno's car parks:
  `maps/vodno/landmarks/car-parks.ts` + `lots.ts`, its gate `gate.ts`, the two flats and their wall on the start street `start-blocks.ts`, `start-wall.ts`, and the brick hotel behind the side street at the first crossroad (building on its own terrace, forecourt on the road) `hotel.ts`: its own `lot_brick` texture, fixed `street_car` variants 16 / 17). A `PathDef.bare` street gets no kerbs / sidewalks / lamps inside `cityStreets` reach.
- **City maps** (`jackie`): one-way carriageways, bridges and decks, portals, junction plazas, parkway lanes, continuous
  barriers, retaining walls, gores, overhead signs, kerbs / crosswalks / lamps, parked vehicles (`world/bridge-mesh.ts`,
  `portals.ts`, `plazas.ts`, `parkway-lanes.ts`, `barriers.ts`, `cut-wall-mesh.ts`, `street-detail.ts`). Plaza queries look
  only at the plazas listed on a 16 m candidate grid (`Plazas.candidates`); same answers as a loop over all
  (`tests/rally/plaza-index.test.ts`).

City-map rules (streets keep their own height line, no terrain through decks, bug-fix workflow): rally-maps skill "Bridges and
underpasses". Tests: `tests/rally/` `bridges`, `city-maps`, `junctions`, `side-roads`, `water`, `railways`, `stage-signs`.

## Cars

| id                | name               | drive | notes                                                                                                                 |
| ----------------- | ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `skoda_rally`     | Skoda Rally        | AWD   | Rally2-class hatch from a CC BY Fabia R5 model, own livery                                                            |
| `bimmer_m3`       | Bimmer M3          | RWD   | lowered E46 coupe from a CC BY print model, own livery                                                                |
| `bimmer_gt2`      | Bimmer GT2         | RWD   | wide-body E92 GT2 racer from a CC BY Sketchfab model, clean livery                                                    |
| `subie_22b`       | Subaru WRX STI 22B | AWD   | 1998 22B coupe from a CC BY Sketchfab model, side swoosh                                                              |
| `zastava_101`     | Zastava 101        | FWD   | stock "Stojadin", body hand-built from dimensions and a blueprint                                                     |
| `fiesta`          | Fiesta WRC         | AWD   | World Rally Car from a CC BY model with its cockpit, own rim and livery                                               |
| `citroen_c4`      | Citroen C4 WRC     | AWD   | 2007 World Rally Car from a CC BY model with its cockpit, own rim and livery                                          |
| `lancer_evo_6`    | Lancer EVO VI      | AWD   | 1999-style Lancer from a CC BY model with its cockpit, own rim and livery                                             |
| `ford_gt3`        | Ford Mustang GT3   | RWD   | 2024 GT3 racer from a CC BY model kept as is (own cockpit, lamps, rim), flat dark blue paint                          |
| `merc_190`        | Mercedes 190E      | RWD   | 2.5-16 Evolution saloon from a CC BY model kept as is (own cockpit, lamps, rim), badges removed, flat dark grey paint |
| `peugeot_206`     | Peugeot 206        | FWD   | tuned widebody 206 from a CC BY model kept as is (own cockpit, lamps, rim), flat paint                                |
| `audi_rs6`        | Audi RS6           | AWD   | C8 RS6 Avant from a CC BY model kept as is (own cockpit, lamps, rim), flat grey paint                                 |
| `porsche_911_930` | Porsche 911 (930)  | RWD   | 1975 911 Turbo from a CC BY model kept as is (own lamps, rim, no interior), flat yellow paint, test car               |
| `subie_wrx_sti`   | Subaru WRX STI     | AWD   | 2019 STI saloon from a CC BY model kept as is (own cockpit, lamps, rim), flat blue paint, released                    |
| `pezetka`         | Fiat 126p          | RWD   | 1970s rear-engined city car from a CC BY model kept as is (own cockpit, lamps, rim), blue-grey paint                  |

- A car is `cars/<car>/<car>.ts` (a `CarDef`: physics + model + sound) with its README. A GLB in `public/models/cars/` replaces the
  car's own body (`cars/shared/car-gltf.ts`; credits in `public/models/CREDITS.md`). Imports: rally-car-import skill.
- Every car has a body without its GLB: hand-built `model.custom` (Zastava) or `model.profile` (`cars/<car>/profile.ts`,
  baked by `scripts/car-model/side-profile.mjs`): the boxy side outline extruded to the body width with its glass and lamps
  tagged (`cars/shared/profile-body.ts`), shown only if the GLB fails to load. It wears the car's livery, box-projected
  onto the atlas (`CarAtlas.layout`). Car viewer `fallback=1` shows it.
- The city maps' parked cars (`street_car`, `taxi`, `police_car`; `assets/builders/vehicles.ts`) are NOT the rally cars: they are
  10 cars of a CC BY pack with their own triangles and textures (`street-car-models.ts`, data in `street-cars.data.ts`,
  atlas `street-car-atlas.jpg` + `street-car-mask.png`; baked by `scripts/car-model/street-pack-extract.py` +
  `bake-street-textures.py` + `bake-street-cars.mjs`, flags in their headers). LOD 0 is the full model (~6-7k triangles; interior
  triangles culled), LOD 1 ~2k, LOD 2 ~1k (meshopt, round wheels). One shared material (`streetCarMaterial`): the atlas, with the
  paint (per-vertex `color`) multiplied in only where the mask is white, so lamps, glass and trim keep their texels; the taxi sign,
  light bar and lettering are a second `vehicle` part up to LOD 1. Variants 0-9 = model (`STREET_CAR_MIX` weights what streets pick;
  10-12 = the white hatch, dark sedan and white minivan a map places). The car LODs set `separateVariants` (no merged variant set: every instance would run the
  vertex shader over all 10 models). Credits: THIRD-PARTY.md; `tests/rally/street-car.test.ts` holds the triangle budget.
- Pack 7's five vans and trucks (`service-vehicles.data.ts`, `bake-street-cars.mjs --vans`, `serviceVehicleModel`) are baked the same
  way into the same atlas and dress the service park (`builders/service.ts`: team paint through the tint mask, stripes and awnings a
  second `vehicle` part up to LOD 1, `PACK_VEHICLE_LODS`) and the Ajvatovci start-row lots. Both lists are baked again after every
  atlas change. `tests/rally/service-vehicles.test.ts` holds their triangle budgets.
- The two fire engines (`fire_truck` = the US engine of Jackie's junctions, `fire_truck_mk` = the Macedonian engine at a start control;
  junction dressing (street mouths 5 m or wider) and `addStartControl` pick by `MapDef.country`; both stand level with the slope under
  their wheels) are two CC BY models with their own livery and one atlas each
  (`fire-truck-models.ts`, data `fire-trucks.data.ts`, `fire-truck-us.jpg` / `fire-truck-mk.jpg`, so a map loads only its engine's
  image): `street-pack-extract.py` + `bake-fire-truck-textures.py` + `bake-fire-trucks.mjs` (scale, turn and LOD budgets are its
  `MODELS`; mesh helpers shared with the street cars in `street-bake-lib.mjs`). LOD 0 keeps the shapes (US ~22k triangles, hidden
  ones culled; MK ~11k), LOD 1 ~4k, LOD 2 ~2-3.5k (meshopt with `Prune`, LOD 2 reduced from LOD 1). No paint tint, no add-ons.
- The Ajvatovci yards' cars and vans (`MODEL` in `maps/ajvatovci/start-row/build/vehicles.ts`) are these models: a few per kind taken
  in turn, scaled to the layout's footprint, drawn per instance colour through the atlas tint mask in three distance tiers
  (`CAR_LOD_RANGE`: full / ~2k / ~1k triangles, then the two-box stand-in). The trucks are the baked models below.
- The Ajvatovci yards' trucks (`maps/ajvatovci/start-row/build/vehicles.ts`, `truck-models.ts`) are baked from two CC BY models
  (`scripts/car-model/bake-trucks.mjs`, data in `truck-models.data.ts`): `tractor` + `trailer` (the `trailer` kind), the `tractor` and
  the trailer's chassis under a code-built tank (`tanker`), the `cab` (back wall closed by the baker, the tractor's step column and side skirt kept behind the front wheel) under a code-built body
  (`box`, or `cab-tow` / `cab-reefer`) and a `dump` truck whose back is swapped (tipper, flatbed, van body, tank, `tow`,
  `reefer`; backs in `truck-backs.ts`). Box-truck places go to these in turn (`RIGID_CYCLE`). Models keep their origin under the middle of
  the 17.5 m footprint (`centre: 0`). The models keep their own triangles (welded, never simplified) and
  textures; the code adds nothing to lamps or grilles. `cab` / `paint` parts take the placement's cab / body colour through a tint
  mask (`truckMaps`: the light neutral panels of the texture, so grille, lamps and stripes keep their look); the `tyre` model is the
  template for the axles the builders add. Textures + masks come from `scripts/car-model/bake-truck-textures.py` (run it after
  `street-pack-extract.py --images`, then `bake-trucks.mjs`); the hub-cap emblem is blanked there.
- Car GLBs are committed plain (the model scripts and `hull-fit.test.ts` read them); the build copies them meshopt-compressed
  (`scripts/car-model/glb-meshopt.mjs`, about half the size, same meshes; `car-glb-meshopt.test.ts` checks every file).
- **Door plates** (`cars/shared/rally-badge.ts`): our own event plate (emblem, car number, map name) projected onto both front
  doors. Liveries carry no numbers or lettering.
- **Release flags** (`release.ts`): `CARS_LIST` / `STAGES_LIST` list every car / stage id (a map ships when one of its stages does); `hideInProd: true` = dev server + `npm run build:test` only (TEST badge). Same flag and `RELEASE_BUILD` check (`src/shared/release.ts`) as `game.json`.
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

- The menu slab with one row per setting: **Tyres** (five: soft and hard tarmac, mixed, hard and soft gravel; grip pips per
  surface of the stage), **Suspension** (travel, ride height, spring, rebound, the car's soft-stiff range), **Gearing** (top speed,
  final drive, pull; race cars only, else "Standard"). `RECOMMENDED` marks the stage's pick.
- ↑↓ / D-pad pick the row, ←→ or the row's arrows change it, Enter / A on the active row steps to the next option, Esc / B back.
  Choices are not saved (they reset with the stage or car); the URL and the leaderboard carry them.
- The part window top right shows the active row's pick: a transparent DOM element; `renderBoxes` draws the showroom, then the
  part's studio camera (`setup-bench.ts`) into it; gearing shows its speed-per-gear chart there. Call `showSetup(carId, boxes)`
  again after the menu re-renders. Styles: `game/menu.css` "Setup screen".
- In game: no set-up HUD; a "hold on!" line at GO for a poor tyre pick; the dash shows the four tyre temperatures
  and a disc mark per wheel (PHYSICS.md "Tyre temperature" / "Brakes"); `F2` shows tyre, set-up, per-wheel grip, tyre and disc temperature.

Rendering: `cars/shared/tyre-mesh.ts` (tread per compound, compound ring), `suspension-mesh.ts` (per
`model.suspensionStyle`), `buildWheelSet` in `car-model.ts`.
Cars whose model has empty wheel wells set `model.cornerSuspension` (`cars/shared/corner-suspension.ts`): a coil-over in the car's
style plus arms / drive shafts, following the live wheel travel (Zastava, M3, GT2, C4, Lancer; Skoda, Fiesta, 22B show the model's own).
A wheel GLB rim with `COLOR_0` vertex colours (two-tone, Porsche 930) gets its own `vertexColors` material (`rimColored` in
`car-model.ts`); `rim.caliper: false` draws no caliper.

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
  scatter.ts      per-chunk placement, road-side rules, props, colliders (trees posed by trees/placement.ts)
  world.ts        ties it together; physics ground; spawns, stage layout
  terrain-renderer.ts, instance-streamer.ts, road-mesh.ts, building-mesh.ts, landmarks.ts, ...
assets/       catalog.ts (variants, LODs, colliders <- add assets here), builders/, library.ts (cached geometry)
trees/        L-system trees: species -> grammar -> skeleton -> mesh -> impostor -> placement -> draw (worker + IndexedDB cache)
cars/         index.ts registry; <car>/ per car; shared/ = body, parts, tyres, suspension, livery, door plate
engine/       renderer, quality, sky / sun / fog / IBL, world shading, textures, materials, texture arrays
game/         rally-game.ts (frame loop), input, camera, stage timing, HUD, effects, audio, autopilot, menus
maps/         one folder per map (info.ts, map.ts, stages.ts, baked data), shared/ (format + helpers), index.ts registry
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
  instance re-bucketing (`InstanceStreamer`; in game the time the frame rate leaves over, 1-8 ms per frame,
  `RallyGame.streamBudget`). Whole-map work uses `world.analytic`, not the 1 m cache. A grass chunk is generated inside
  that slice too (`ScatterField.detailSteps`, yields every 256 candidates: one dense chunk took up to ~30 ms), and the
  canopy shadow map splats new chunks for at most 1 ms a frame and writes its texel bytes as it splats (no conversion
  pass before the 1.5 s upload, which sends only the changed rows: `copyTextureToTexture`, not the whole ~8 MB texture).
- Gantry clocks are redrawn (a canvas texture upload) only while the car is within `CLOCK_NEAR` of them along the road.
- Whole-map set-up loops use a spatial grid, never all-against-all (a town map has ~900 roads, ~2000 way ends).
- Generated scatter chunks past 1.25 x the view distance are dropped (`ScatterField.pruneChunks`, called by the streamer), so a long
  stage's memory stays flat; the radius must cover every reader (the tree job reads chunks out to the view distance).

**Draw calls**

- Terrain chunks merge per detail band into 2 x 2 (from LOD1) / 4 x 4 (from LOD2) and 8 x 8 (LOD3) meshes (`terrain-renderer.ts`: the
  `blockLod` bands never make a chunk coarser than unmerged, `MERGE_SLACK` stops tiles fragmenting along band edges; big tiles
  are sampled in slices). Merged tiles keep the vertex grid of their LOD; a tile that splits or merges at the same LOD copies
  its vertices from the tiles it replaces (`reuse`), so streaming while driving does not resample the generator. The plan is redone after 8 m of travel.
  Released tile geometries are kept (`SPARE_TILES`): tiles merge / split / change LOD back and forth as the car drives on,
  and one wanted again takes its old geometry (no build, no GPU upload).
- Whole-map meshes are merged per tile, never per object. Many materials = many draws: use a texture array
  (`engine/texture-array.ts` `layeredMaterial`; mesh buildings = one mesh per 192 m tile, start-row lots = 3 material groups
  per 128 m tile). A custom shader must scale `envMapIntensity` (it carries `scene.environmentIntensity`), never replace it.
- Scatter view culling (`InstanceStreamer.setView`, called every frame by the game): non-shadow buckets (LOD1+) are
  angle-sorted and only the camera's view (+ 25 deg) is drawn. LOD0 shadow casters are drawn whole.
- Trees (`trees/`, L-system species in `trees/species.ts`): map rules place the old tree type ids, each grown as the species
  its description names (`TREE_TYPES`: pine, plantation pine (half the sprites, for dense stands), black pine, juniper, cypress, hedge cypress, oak, locust, walnut, fruit tree, plane, birch, sapling, poplar,
  willow, bush, scrub, hazel, thicket, bramble); 6 variants for pine / oak / bush / scrub, 4 for the rest. The map's `scale`
  multiplies the species size.
  Branches are tubes at two levels (LOD0 = the skeleton without twigs, LOD1 = trunk + the first-order limbs thicker than 1/120 of the tree's height), then an
  octahedral impostor (albedo, normal + depth, thickness: lit like everything else). Foliage = one lit, camera-facing
  cluster sprite per leaf point from the atlas of its species' leaf style (`foliage.leaf`, 8 styles x 8 images (512 px; the pine's 256 px), `trees/leaftex.ts`: albedo, normal + thickness at half size; a leaf is 4-6 % of the image;
  broadleaf images are leafy branches (twigs with small stalked leaves, a side fork), cypress / juniper images drooping fronds, all turned in the shader to lie along their twig: `trees/sprite-attr.ts` packs the corner + heading into `treeSprite`),
  tinted by the species palette (`foliage.palette` = summer; spring / autumn palettes in `trees/seasons.ts`, picked by the stage's season, so each season is its own cache entry and the trees themselves stay the same),
  drawn with both branch levels; a crown draws its highest-ranked 35 % (`NEAR_SPRITES`, the rest left out, the kept
  ones grown to the same coverage) within the full-detail distance (`FOREST_REACH.full`, 40 m: the only trees with
  LOD0 branches; the first row within `ROADSIDE_EDGE` (9 m) of the road's edge uses `ROAD_REACH`: 80 m + 80 m ramp, flagged to the shader in the fraction of `treeInst.w`);
  over the next 60 m (`FOREST_REACH.ramp`, smooth) it eases to the far share (`FAR_SPRITES`: 20 %), then on to 15 % at
  the impostor (3.5 % of the screen height; perf panel sliders). Defaults at high quality:
  `QualitySettings.treeLodScale` brings every tree distance to half on medium, about a third on low. Past
  `QualitySettings.forestDistance` (400 / 500 / 600 m) no tree is drawn on the CPU (they dissolve out over its last 15 %,
  `tlForest`). Everything past it comes from a canopy map of 8 m cells (`world/far-forest.ts` `FarForest`: ground, crown
  height, cover, the crowns' drawn colour `LoadedVariant.canopyColor` and one tree's impostor slot per cell), estimated
  at load from the land cover and tree rules (`Scatter.treeRulesAt`) and replaced by each generated chunk's real trees:
  - **Far trees** (`farTrees`, to `FAR_REACH` 1.5 km, 200 m short of the view distance): the trees' own far impostors on
    6 m cells; the vertex shader places each cell's tree from the map (variant, height, cover; `FAR_TREE_MAIN`, the
    impostor material's `ImpostorGrid` hook), so the CPU only picks the 192 m tiles in view (`pickTiles`). They take the
    other side of the trees' dissolve dither, so the handover never pops.
  - **Canopy shell** past them, out to the view distance: one camera-centred ring grid raised to the canopy; it
    dissolves in where the far trees dissolve out and reaches a little past the view distance, where the horizon
    backdrop's woods take over. The tint map stores colour / `TINT_RANGE` (bright autumn reds times the gain clipped
    to yellow-green otherwise). The canopy map is mipmapped and each
    ring's vertices read it at four times their spacing (`ffHeightAt`: a coarse vertex on one cell's crown or gap made
    boxy facets on far slopes); the crowns are a baked, mipmapped, anisotropic tile (`crownTexture`) mapped triplanar by
    the shell's smooth normal, so a far slope keeps its crowns down to a pixel each. It lies over the ground that takes the forest's colour (`setForest`, engine/world-shading.ts; three's physical
    path lights `diffuseContribution`). Trees
    beyond the stage road's influence (half width + shoulder + 30 m, about 45 m from its edge; `FAKE_TREES_FROM` 250 m
    caps it, game/rally-game.ts) are static impostors (`fakeFrom`), except within `IMPOSTOR_FROM` (80 m,
    `trees/species.ts`) of the camera: no tree is an impostor up close, whatever the quality (it reads as a blotchy blob;
    medium and low bring the impostor in to about 50 m for a small tree). Level changes
    are a fixed 0.3 s fade per tree (8x8 ordered dither, one fade value per tree, at most 32 at once; a finer level a distance rule demands - no impostor inside
    `IMPOSTOR_FROM`, LOD0 inside the full-detail ring - never waits for a slot), selected from the
    camera before shake (`CameraRig.steady`) with 15 % hysteresis. A batching job (every 5 m of travel) puts every tree
    that keeps its level for any camera within 9 m into static batches; only trees near a switching boundary, fading or
    waiting for a fade slot are re-selected per frame (a few hundred), into a room of the same batch: one mesh set per
    variant and part, laid out [shadow casters | room | rest] (`StaticBatch`), so one draw call each. A room re-fills every
    frame but uploads only the slots and attributes that changed (`uploadRoom`; a `bufferSubData` per attribute and
    batch was ~450 calls a frame, ~2 ms on ANGLE / D3D11). Static trees and impostors keep their slot from job to job
    (`packStatic` / `packRuns`: a tree that left is collapsed, a new one takes a free slot), so a job or a view turn
    uploads only what came or went; a whole re-pack only when a region overflows, the room is resized (grows, or shrinks under half use) or holes pass 15 % of the slots. The
    per-frame impostor tail upload adds its range to the pack's (never clears it). The job sorts each
    scatter chunk's trees once (`chunkTrees`): the faked ones of a chunk farther than ~100 m go in as one ready block of
    impostors, and chunks past the forest distance are only generated (for the canopy texture), not walked. A camera
    jump > 50 m is a cut: every tree takes its level at once. The shadow distance is tested per instance in the shader
    (`tlShadowD`), so it never activates a tree; the shadow pass draws only a batch's casters, and a static tree is a
    caster only when its bounding sphere can reach the sun's shadow box (`shadowExtent`, light space, re-packed with
    the view). Sprites cast no shadow: the crown proxy does (`trees/proxy.ts` `crownProxy`, a ~100-triangle lathe
    through the sprites' reach, drawn in the shadow pass only, leafy holes from a world-space noise); a sprite looks
    its shadow up most of the way out of its crown's ellipsoid towards the sun (`SELF_SHADOW`). Every level casts LOD1 +
    the crown proxy, the impostor too (a shadow never pops with the level). Trees cast real shadows within
    `quality.treeShadowDistance` only (see Shadows above).
- Tree occlusion (`trees/occlusion.ts`): the job builds a terrain horizon map from the camera (1024 rays out to the
  forest distance over a lazy 8 m height grid) and leaves out trees beyond 140 m (faked ones per chunk) that a hill
  hides from every camera position in its window; margins cover the move (9 m + `HORIZON_REUSE` 30 m: the jobs within
  30 m of its eye reuse it), a 35 % grade, 0.5 slopes. CPU, not the spec's GPU depth pyramid (WebGL2 has no compute /
  indirect draws). `?treeocclusion=0` = debug toggle.
- Tree shading: sprites (Lambert: diffuse only) / impostors go through the lit path (sun, shadows, fog); the sky's diffuse light is
  spherical harmonics of the environment (`setTreeSky`, engine/environment.ts) instead of the env map, so they read 2
  atlas textures + shadow map + cloud noise. Sprite normals = crown ellipsoid bent by the atlas normal map;
  translucency = a wrap term on the thickness map; the sky light leans up and a small fill light keeps shaded crowns green. Caps: LOD0 branches <= 6,000 triangles (shrubs 2,000), <= 400
  sprites (broadleaf 360, shrubs 200). Wind fades out by 110 m (`TREE_WIND_FAR`; past it the vertex work is skipped).
- Tree drawing (spec `trees/Drawing`): every tree mesh is opaque, depth-tested and depth-writing; the depth buffer
  alone decides what is in front (nothing sorted). Sprite parts (`trees/draw.ts`): crowns within
  `Reach.near` (55 m, first row 95 m) use the tight outlines with a depth prepass, then shade where the depth is not behind it
  (less-or-equal + a polygon offset, never EQUAL: it blinked on some GPUs; off on touch devices, `?treeprepass=0|1`; the prepass
  draws after the horizon backdrop, which clears the depth: `PREPASS_ORDER`);
  farther crowns use plain quads (`quadSprites`) in one lit pass: a mid batch per variant over the ramp and a far one
  past it, each holding the share at its near end (one batch per thinning step left a few crowns per draw call);
  both use ONE program (`spriteLit`, `tlDepthOnly` stops the prepass after the alpha test) because two programs
  did not give bit-identical depths on ANGLE / Mesa. `checkPrepass` renders it once at load and falls back to a single
  normal-depth pass if any pixel misses (`prepassMisses`). The impostor quad sits at the front of the tree's bounding sphere and its
  baked depth only pushes pixels back; static impostors past `IMPOSTOR_FLAT_FROM` (350 m) use the far program (no
  baked depth, which costs the early depth test; the quad through the centre). Impostors are Lambert, receive no
  shadow (beyond the shadow box), read the normal from the nearest view only and are cropped to their views' coverage
  (`impostorBounds`). Trunks are sunk by their base radius. Debug views 4 (depth) and 5 (EQUAL
  misses, magenta) check it.
- Tree cost (`trees/stats.ts`): `F6` (= the LOD debug view) shows the tree stats overlay (`trees/overlay.ts`): trees per
  level / fading, re-selected / static trees, cells checked, terrain-hidden trees, draw calls, triangles and GPU ms
  (timer queries) of the tree main and shadow passes, selection CPU ms, which mitigations are on, load time, cache
  hits and memory. Debug view (`F6` cycles): levels (green LOD0, orange LOD1, blue impostor, magenta-white = fading, flashing
  red = more than 2 level changes in 1 s), lighting only, normals only, depth, EQUAL misses; `?treedebug=1..5`, map
  viewer select.
  Benchmark: `/games/rally/?map=<id>&treebench=1` or `await __rally.treeBenchmark()` flies a fixed path (stage start,
  600 m) with and without trees, checks the budget (`TREE_BUDGET` in `game/tree-bench.ts`: +1 ms frame and 1 %
  low, 0.1 ms selection, 0.5 s load, no tree spike frames; `result.pass` false = failing) and downloads
  `tree-bench-<stage>-<quality>-<res>-<date>.json` (machine, mitigations, re-selected trees, spike frames;
  `compare: <earlier report>` adds the change in every figure). Each frame ends with `waitForGpu` (a 1-pixel
  readback): WebGL `gl.finish()` does not wait in Chrome, so frames queued up and one in ~100 absorbed ~10 frames of GPU
  work (the old 300-400 ms "spikes").
- Variant sets (`getVariantSet`, `assets/library.ts`): the other LODs draw every variant with ONE `InstancedMesh` per material -
  all variants in one geometry, the instance's `instVariant` picks one, the shader clips the rest (`variantMaterial` /
  `variantDepthMaterial` for the shadow pass). Costs vertex work x variants, so sets are capped (vegetation 1200 triangles:
  big tree crowns stay per variant). `?variantsets=0` turns them off; test `variant-sets`.

**Distances**

- Nothing is drawn past the streamed terrain (`quality.viewDistance`): the streamer gets it as `maxDistance`, the whole-map road
  group is distance-culled by `world/distance-cull.ts`. Far scatter chunks of short-range assets are skipped wholesale.
- Knobs: `engine/quality.ts`, LOD distances in `assets/catalog.ts`, `TERRAIN_LODS` in `game/rally-game.ts`, map `fogDensity`,
  and the **Object distance** option (x1 / x1.5 / x2 on objects only, `OBJECT_DISTANCE` in `game/settings.ts`).
- **Render scale** option (100 / 85 / 70 %, `RENDER_SCALE`): multiplies the pixel ratio. A DPR 1.5 screen renders ~4.2 Mpx
  on High; there the GPU is the limit and the frame-time spikes grow with the pixel count.

**Shadows**

- Only LOD0 casts shadows, so every LOD0 radius must reach the far edge of the shadow box: 1.5 x `quality.shadowExtent`.
- The shadow pass is triangle bound: hidden parts do not cast (car interior, parked vehicles' glass / chrome / details). An
  `InstancedMesh` spanning a whole area is never culled, so each of its casters draws every frame.

**Loading**

- Loading ends with a warm-up (`RallyGame.init`): wait for the imported car, compile, render one frame with culling off - so
  shaders (incl. the shadow pass) and buffer uploads happen behind the loading screen. A material first used mid-stage
  compiles then (a hitch): add it to the scene at load.
- Background work runs in module workers (`shared/worker-pool.ts`: 4-6 threads, least-loaded first, a failed pool makes the caller do
  the work itself): tree variants and leaf atlases + mips (`trees/worker.ts`), people (above), procedural textures drawn on an
  OffscreenCanvas (`engine/texture-worker.ts`; `engine/texture-prefetch.ts`: a browser remembers the textures each map used and asks for
  those next time, `BY_MAP` seeds a first visit; text textures stay on the page). `__rally.loadTimings` splits the load by phase.
  The tree workers also read the IndexedDB cache (variants + their impostors' mip chains, and the leaf atlases + mips,
  keyed `atlas:<style>:v<GENERATOR_VERSION>`), so a warm Trees phase does no pixel work on the main thread.
- Workers only start while the main thread is free: a long load-time task holds every pool up. `bakeCropCards` yields
  between cards for that reason; keep other once-per-page bakes sliced the same way.
- Shader programs of the main pass compile in parallel (`compileAsync`); the shadow-pass ones compile in the first render. The tree
  prepass check (`TreeRenderer.checkPrepass`) draws only the trees and keeps its verdict per GPU in localStorage (it used to draw the
  whole scene into a target: 70 more programs, ~5 s on a cold shader cache).
- Long synchronous steps (world build, road, props, shader compile) set their label and `paint()` first, so the bar never
  sits unlabelled at 0%. The car's GLB starts downloading before the map data (`preloadCarModel`).
- Car select: a "Loading model" spinner (`Showroom.loadCue`) shows while a car's GLB downloads (the car stays hidden until then).
- Last picked stage, car and livery are remembered (`rally.settings`, saved on Start); a car that is hidden in the build or unknown falls back to the default car and livery 1.
- Car select: All / AWD / RWD / FWD filter row on top (`driveGroup` from the car's `drivetrain.frontSplit`, not remembered); up from the first car or the pad focuses it, left / right switch.
- Car select (screens >= 800 px wide): the description / stats / livery sit in a card docked beside the list (`.menu-side-card`, `MainMenu.sideCard`, shared with Select stage; Stage times uses the same placement). The showroom car keeps its shared place and size (`CAR_SHIFT`, `CAR_DIST_SCALE`) and may run behind the card; its **Details** tab (`MainMenu.minimizer`, class `min` on the card, shared with Select stage) minimizes the card to its description (the Stage times card has no tab). Narrower screens (< 800 px) lay the same card over the map above the buttons.
- Select stage: the stage's description (`StageDef.description`: what the drive is like for the player, no data sources or build details), recommended set-up and a **Time of day** dropdown sit in the same card (phones: under the selected stage), with a **Season** dropdown (spring / summer / autumn, above the time) and the **Month** it is driven in in front. Left / right (or the pad) step the time; the list cards keep the route, tags and best time.
- Time of day (`game/time-of-day.ts`, the one config): early morning 07:00, mid day 12:00, afternoon 15:30, evening 17:30, night 01:00 (dropdown order) - each is a `?tod=<hours>` hour, so any stage of a map with `environment.timeOfDay` takes any of them. A stage's own default hour stays exact on its nearest slot (Jackie opens on "Early morning · 08:00") and a stage can move a slot (`StageDef.slotHours`: Vodno's early morning is 08:00); a pick applies to every stage until changed and is not remembered; the menu mirrors it into the URL (`tod=`), a stage without `timeOfDay` shows no dropdown. Under it the card shows the clock time and the air / road temperature at that hour (`StageDef.temps`, the numbers the tyres run with, see PHYSICS.md). Times are saved per stage, not per time of day.
- Season (`season.ts`): spring / summer / autumn, the one the stage opens in (`StageDef.season`, else the map's `environment.season`, default summer; `stageSeason`) or `?season=`; the stage screen's pick is mirrored into the URL (`season=`, none = the stage's own) and shown on every stage including the test map. It sets the tree leaf colours (`trees/seasons.ts`), the ground (`environment.groundTints`, below) and the stage's air / road temperatures (`StageDef.temps`, "Temperatures" below). The stage card lists the **Month** the stage is driven in that season (`environment.months`, default April / July / October: e.g. Ajvatovci spring April, Jackie spring May).
- Season ground: `environment.groundTint` is the map's own season (`environment.season`, the card's `season`; a stage can open in another, e.g. Galichica West in autumn, East in spring); `environment.groundTints` has the other seasons' tint (fresh green / young crops in spring, dry olive / stubble in autumn). `mapInSeason` (`maps/shared/season-map.ts`) returns the map with that season's tint as `groundTint` and `season` set, and `RallyGame` builds its `World` from it, so terrain, horizon and sky colours follow. The stage card (select stage) has one picture per season, every one `<stage id>-<season>.jpg` (`cardImageName`; the card's `season` is the map's own), the other seasons listed with their hash + floor colour in the card's `seasons`; the dropdown swaps the picture (`Showroom.setSeason`), only the shown season is fetched. A map without `groundTints` shows one picture for every season.

## Temperatures (`StageDef.temps`)

Each stage lists `[air, road]` °C per season and time-of-day slot, hardcoded and researched, in `maps/<map>/stages.ts` (the
three Galichica stages share one table). The road is the stage's first surface. The stage's own slot sits at its own
`timeOfDay` (bold below) and a stage can move other slots (`StageDef.slotHours`: Vodno's early morning is 08:00); that cell, in
the season the stage opens in (`StageDef.season`), is the default look. Edit a cell to retune it: the stage screen and the
tyres follow, nothing is computed. Hours between the slots blend them, `?air=` overrides the air, a new stage needs a full
table (`tests/rally/seasons.test.ts`). Source figures: PHYSICS.md "Climate". The table below is written from the data
(`tests/rally/temps-doc.test.ts` fails when it is stale: `UPDATE_TEMPS_DOC=1 npm run test:rally -- temps-doc` rewrites it).
Each table holds at the stage start (its lowest point, `Vehicle.setClimate` `refHeight`): the car's air falls 6.5 K per km of
climb (`AIR_LAPSE`, tyre-temp.ts) and the road with it (the sun gap stays), so Petralica is ~3.4 K and Galichica ~4.5 K
colder at the top. Select stage shows "At the top" for climbs of 50 m or more (`loadStageRise`, from the stage card's route).

<!-- temps-matrix -->

| Stage                                                        | Season | Early morning | Mid day     | Afternoon   | Evening | Night   |
| ------------------------------------------------------------ | ------ | ------------- | ----------- | ----------- | ------- | ------- |
| `test` (15:48)                                               | spring | 5 / 7         | 12 / 20     | **14 / 19** | 13 / 14 | 3 / 3   |
|                                                              | summer | 11 / 15       | 18 / 30     | **20 / 27** | 19 / 21 | 9 / 9   |
|                                                              | autumn | 3 / 5         | 10 / 15     | **12 / 15** | 11 / 12 | 1 / 1   |
| `ajvatovci` (07:30)                                          | spring | **13 / 19**   | 20 / 32     | 21 / 30     | 20 / 22 | 10 / 10 |
|                                                              | summer | **27 / 35**   | 34 / 53     | 35 / 48     | 34 / 37 | 24 / 24 |
|                                                              | autumn | **14 / 18**   | 21 / 28     | 22 / 28     | 21 / 22 | 11 / 11 |
| `vodno` (10:00; early morning 08:00)                         | spring | 9 / 14        | **14 / 26** | 18 / 28     | 17 / 19 | 7 / 7   |
|                                                              | summer | 30 / 40       | **35 / 54** | 38 / 55     | 36 / 44 | 26 / 26 |
|                                                              | autumn | 6 / 9         | **11 / 19** | 15 / 21     | 14 / 16 | 4 / 4   |
| `petralica` (16:30)                                          | spring | 11 / 14       | 19 / 37     | **21 / 35** | 20 / 31 | 11 / 11 |
|                                                              | summer | 16 / 20       | 26 / 47     | **28 / 46** | 28 / 42 | 17 / 17 |
|                                                              | autumn | 11 / 11       | 21 / 35     | **24 / 34** | 23 / 30 | 14 / 14 |
| `galichica_west` · `galichica_east` · `prespa_ohrid` (09:00) | spring | **13 / 23**   | 18 / 36     | 20 / 37     | 19 / 30 | 10 / 10 |
|                                                              | summer | **19 / 32**   | 25 / 47     | 28 / 48     | 27 / 41 | 16 / 16 |
|                                                              | autumn | **9 / 13**    | 14 / 24     | 17 / 25     | 17 / 20 | 9 / 9   |
| `jackie` (08:00)                                             | spring | **15 / 21**   | 20 / 38     | 22 / 39     | 22 / 34 | 16 / 16 |
|                                                              | summer | **24 / 31**   | 28 / 50     | 30 / 51     | 30 / 45 | 24 / 24 |
|                                                              | autumn | **12 / 13**   | 17 / 26     | 19 / 27     | 19 / 23 | 14 / 14 |

<!-- /temps-matrix -->

## Known limitations

- Generation runs on the main thread, time-sliced: the load builds the road mesh in ~25 ms slices (`buildRoadMeshSliced`);
  terrain and scatter stream within per-frame budgets. On city maps the load cost is the road mesh and `new World` (one task).
- Real-world map data is not lazy-loaded; a bare-earth DEM would help where the elevation model includes trees.
- Not done: tyre relaxation length, co-driver pace notes, car damage.
