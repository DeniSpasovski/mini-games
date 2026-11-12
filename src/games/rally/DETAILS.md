# Gravel Rally - details

> Overview and screenshots: [README.md](README.md). This file explains how the game works and where the code is.

Point-to-point rally. Look: late-2000s rally game (sun and shadows, sky / IBL, fog, dense forest, dust). Feel: grounded
sim-lite physics that is still fun on a keyboard.

## Pages and URLs

| Page        | URL                                                                | What it is                                                                                              |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Game        | `/games/rally/`                                                    | welcome -> select stage -> select car -> (set-up) -> drive                                              |
| Map viewer  | `/games/rally/map-viewer.html?map=test&stage=test&grid=1&splat=1`  | a map with one of its stages from above: layers, click to inspect, "Drive from here" (Tool pages below) |
| Car viewer  | `/games/rally/car-viewer.html?car=skoda_rally&seed=5`              | one car: livery, door plate, pose, wheels, lights, specs, sound, on grass or a road backdrop            |
| Asset debug | `/games/rally/asset-debug.html?asset=tree:pine_tree&season=autumn` | every prop, car (`car:<id>`), tree type (`tree:<type>`) and texture (`tex:<id>`) as the game draws it   |

### Tool pages

Dev server only (`dev: true` in `game.json`); every setting is in the URL, so a view is a link. Shell:
`debug/viewer-shell.ts` (panel, renderer with the game's lights, orbit camera, stats); look: `debug/viewer-shell.css`
(`STYLEGUIDE.md` -> Tool pages).

- **Every page**: `H` or the "Panel · H" plate hides the panel, `F3` stats, Help = key table; sections remember open / closed. "Copy camera link" ->
  `cam=x,y,z&look=x,y,z&fov=<deg>&clean=1` (`clean=1` hides every plate). Weather (`weather=`, reloads) and Time of day (`tod=`, live; the page's own hour
  sits in its nearest slot): `ViewerShell.addWeatherAndTime`. A "Loading <map / car / asset>" plate shows while it builds (`showViewerLoading`).
- **Map viewer** (`pages/map-viewer.ts`): a map and stage in a season, weather and time; camera presets (top down, oblique, start line, link); layers
  (scatter, tree debug `F6`, road centreline, stage route + markers, chunk grid, splat, drainage lines + culverts `drain=1`, wireframe, fog); click the terrain for a picked point (position,
  height, slope, surface, cover; real maps: lat / lon, satellite and Street View links; "Drive from here"); buildings (`building=<id>`); `along=<m>&zoom=<f>`
  flies to a spot on the stage road.
- **Car viewer** (`pages/car-viewer.ts`): the cars (All / AWD / FWD / RWD chips), livery `seed`, `paint`, `tyre`, door plate `num` / `rally`, camera presets
  or an axle camera, pose (`steer`, `susp`, `spin`, `turntable`), scene (weather, time, `backdrop` studio / road with its `season` and `trees`, sun), lights
  (`beam`, `lamps`), wheels (`wheels=1` overlay, `wangle`, `tyres` / `rims` / `brakes` / `body`, axle camera `wcam`), debug (`wire`, `hull`, `fallback`),
  specs (numbers, torque / power chart, test-drive links, model credit) and sound (`debug/sound-debug.ts`). Console: `__carViewer`.
- **Asset debugger** (`pages/asset-debug.ts`): the assets plus the options of the picked kind only (props seed / variant / LOD / instances / gap / wire /
  bounds / colliders; trees seed / variant / instances / season / leaves and a Tree tuning section: leaf cover, sprite size, sparse share / cover, light / clump colour spread, bare - regrown live, in the URL; cars livery seed; textures repeat), info, camera and scene; `F6` tree debug views.

**URL parameters** (any of the play ones skips the menu):

| Parameter                  | Pages | Effect                                                                                                                                                                                                                                                                       |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`, `car`, `livery`   | play  | stage id, car, livery seed; an old `map=<id>` link is rewritten in place to `stage=` (`stageLinkParams`; a map with several stages opens its first)                                                                                                                          |
| `tyre`, `susp`, `gear`     | play  | `tarmac / tarmac_hard / mixed / gravel_hard / gravel`, `soft / medium / stiff`, `short / medium / long` (default: the stage's pick)                                                                                                                                          |
| `spawn`                    | play  | `start`, a flat-area name (`pad`) or metres along the stage road = free drive (no clock, never ranked)                                                                                                                                                                       |
| `quality`                  | play  | `low / medium / high`                                                                                                                                                                                                                                                        |
| `mute=1`                   | play  | silent (bots and tests)                                                                                                                                                                                                                                                      |
| `display=auto / sdr / hdr` | all   | lower exposure on HDR monitors (white paint glare)                                                                                                                                                                                                                           |
| `tod=<hours>`, `tonemap=`  | all   | time of day (maps with `environment.timeOfDay`; 20-4:30 = night, see Look; the stage menu sets it), `aces / agx / neutral`                                                                                                                                                   |
| `air=<°C>`                 | play  | air temperature for the tyre temperatures (default: the stage's `temps` for the season and hour)                                                                                                                                                                             |
| `season=`                  | play  | `spring / summer / autumn`: tree leaf colours, ground colour and the stage's `temps` for it (default: `StageDef.season`, else `environment.season`, summer); the map viewer takes it too                                                                                     |
| `weather=`                 | all   | `dry / overcast / pre_rain / rain_light / rain_heavy / post_rain / fog` (`weather.ts`; the stage menu sets it; dev / test only): sky, temperatures, wet surfaces and grip, puddles, rain, spray, lens drops, valley fog with a top (`StageDef.weather` retunes it per stage) |
| `perf=1`                   | play  | open the perf panel (below)                                                                                                                                                                                                                                                  |

Perf panel (`` ` `` key in game or `perf=1`, `game/perf-panel.ts`): FPS, frame ms, CPU ms per frame step, GPU ms (timer
queries; "Wait for GPU" measures it by a readback where they are missing), draw calls, triangles; switches for every
costly feature (world layers, each tree part, shadows, clouds, fog, IBL, effects) and sliders (resolution, object /
tree distance, shadow map). Remembered in localStorage, applied only while the panel exists.

Console: `__rally.benchmark(240)` (avg / worst ms per frame, works with the tab hidden), `__rally.loadTimings`,
`__rally.vehicle`, `__rallyProbe()` (what the camera draws), `__worldShading`, `__mapViewer`, `__carViewer`.

## Photo mode (`game/photo/`)

From the pause menu (**Photo mode**) or a replay (**Photo**, `P`; the replay pauses). The game stands still; `Back` / `Esc` returns to where it was.

- **Camera** (`photo-mode.ts`): free orbit around the car's middle (full turn, pitch, distance 1.6-40 m, pan up to 15 m), kept above the ground; starts
  from the game's view. Lens: focal length 16-200 mm on a 35 mm full frame (= field of view), aperture f/1.4-f/22, focus (auto on the orbit point, or set),
  exposure ±2 EV, roll ±30°, shutter speed (Off ... 1/8 s: the motion blur) keeping the **car** sharp (the camera pans with it) or the **background** (the camera holds still).
- **Render** (`engine/post-fx.ts` `PHOTO`): thin-lens depth of field on the HDR image (circle of confusion `f² / (N (s - f)) · |z - s| / z`, 64 gather taps,
  max 2.5 % of the height; a sharp nearer pixel never bleeds into the blur behind it) and exposure, before the bloom; lens drops off. Pages without the
  High effects make a `PostFx` for photo mode only.
- **Filter** (`PHOTO_FILTERS`, `PHOTO_LOOK`): the last pass, on the finished picture (saturation, contrast, tint, faded blacks, dark corners), mixed in by its strength.
- **Motion blur** (`RallyGame.posePhotoSample`, `photoSamples`, `PostFx.render(shutter)`): the scene drawn many times across the shutter, the car moved
  by its velocity, turned by its rotation, wheels spun by their speed (full tyre detail), averaged before the depth of field. Enough images that a wheel's
  rim moves about 1 px between two (`PHOTO_BLUR`; fewer shows spokes and the sidewall print as separate copies), a share per frame: the view gets smoother
  over the next frames and starts over when the camera or shutter changes. By day the mean is of the linear pictures, not of the HDR estimate (there one
  near-white image outweighs all the others: solid bright rings from the tyre print).
- **Take photo**: a frame (with motion blur: as many as its images need, the camera held) rendered at up to 3840 px on the long edge (`PHOTO_LONG_EDGE`, at most 3x the screen, within the GPU's limits), as a JPEG download (`gravel-rally-<stage>-<date>-<time>.jpg`).

## Controls

| Input    | Keys                                                                                                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard | `W` / `S` throttle / brake (hold `S` when stopped = reverse), `A` / `D` steer, `Space` handbrake                                                                                                                                                                                                                      |
|          | `R` reset to road, `C` camera, `Esc` menu, `Q` / `E` shift (`G` manual gearbox), `T` traction / stability assist, `B` ABS                                                                                                                                                                                             |
|          | `M` mute, `F2` telemetry, `F3` stats, `F4` force vectors + hull, `F6` tree debug view, `F8` autopilot, `` ` `` perf panel, `F9` save the portal thumbnail (dev)                                                                                                                                                       |
| Gamepad  | RT / LT throttle / brake, left stick steer, A / X handbrake, B reset, Y camera, LB / RB shift; menus: d-pad / stick, A / B (the B that closes the pause menu is not a reset); steering mode: Options -> Pad steering (PHYSICS.md "Steering input")                                                                    |
| Replay   | `Space` / `K` play, `←` / `→` / `J` / `L` ±5 s (`Shift` ±1 s), `,` / `.` frame, `[` / `]` speed, `Home` / `End`, `C` / `1`-`8` camera, `H` clean feed, `P` photo mode, `V` export, `Esc` exit; pad X play, Y clean feed, LB / RB camera, B exit                                                                       |
| Photo    | drag orbit, right-drag / `Shift`-drag pan, wheel zoom, `W` `A` `S` `D` / arrows orbit, `Q` / `E` zoom, `R` recentre, `Enter` / `P` take photo, `H` hide, `Esc` back; pad left stick orbit, right stick zoom / pan, LT / RT focal length, A take photo, Y hide, B back; touch drag orbit, two fingers pan / pinch zoom |
| Touch    | floating steering stick (or arrows: Options -> Touch steering), BRAKE / GAS, reset to road and pause, landscape only (`game/touch-controls.ts`)                                                                                                                                                                       |

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
- **Menu music** (main menu only): `game/menu-music.ts` loops `sources/music/*.mp3` (git-ignored, copied on build; only files present at
  build time play and are credited, so a CI / Pages build is silent), starts on the first click / key, shows "now playing" bottom
  right and pauses with the tab. Options slider `musicVolume` (0 = off); `?mute=1` silences it. Add a track = file + `MENU_TRACKS` row
  (+ `THIRD-PARTY.md`).
- **Pause** (`Esc`): resume, restart, free-drive pad <-> stage, options, main menu (a page reload: the loading box goes up
  first, `leaveTo` in pages/play.ts, or the frozen stage stays on screen until the menu paints).
- **Stage times** (welcome menu): stage list on the left (↑↓), the selected stage's saved runs over its map view in a card docked beside the list (`.menu-times-card`); current versions first, older ones dimmed below.
- **About:** every external source per map (`MapDef.sources` + its stages' `StageDef.sources`) and car (`CarDef.sources`), menu music
  credits, plus `version` from `game.json`.
- **Select car**: a "Loading model" spinner (`Showroom.loadCue`) while the GLB downloads; an All / AWD / RWD / FWD filter row
  (`driveGroup` from `drivetrain.frontSplit`, not remembered). On screens >= 800 px the description / stats / livery sit in a card
  docked beside the list (`.menu-side-card`, `MainMenu.sideCard`, shared with Select stage and Stage times); the showroom car keeps its
  place and size (`CAR_SHIFT`, `CAR_DIST_SCALE`) and may run behind it. The card's **Details** tab (`MainMenu.minimizer`) minimizes it
  to its description; narrower screens lay it over the map above the buttons. The last picked stage, car and livery are remembered
  (`rally.settings`, saved on Start); a car that is hidden in the build or unknown falls back to the default car and livery 1.
- **Select stage**: the stage's description (`StageDef.description`: what the drive is like for the player, no data sources or build
  details), the recommended set-up and the **Season** / **Time of day** dropdowns (with the **Month** it is driven in) sit in the same
  card (phones: under the selected stage); left / right (or the pad) step the time; the list cards keep the route, tags and best time.
- **Time of day** (`game/time-of-day.ts`, the one config): early morning 07:00, mid day 12:00, afternoon 15:30, evening 17:30, night
  01:00, each a `?tod=<hours>` hour, so any stage of a map with `environment.timeOfDay` takes any of them. A stage keeps its own default
  hour on its nearest slot (Jackie opens on "Early morning · 08:00"); `StageDef.slotHours` moves a slot (Vodno's early morning is
  08:00). A pick applies to every stage until changed, is not remembered and is mirrored into the URL (`tod=`); a stage without
  `timeOfDay` shows no dropdown. The card shows the clock time and the air / road temperature at that hour (`StageDef.temps`, see
  PHYSICS.md). Times are saved per stage, not per time of day.
- **Season** (`season.ts`): spring / summer / autumn, the stage's own (`StageDef.season`, else `environment.season`, default summer;
  `stageSeason`) or `?season=` (the stage screen mirrors the pick into the URL; every stage has it). It sets the tree leaf colours
  (`trees/seasons.ts`), the ground and the air / road temperatures (`StageDef.temps`, "Temperatures" below). The card lists the
  **Month** the stage is driven in (`environment.months`, default April / July / October).
- **Season ground**: `environment.groundTint` is the map's own season; `environment.groundTints` has the other seasons' tints (fresh
  green / young crops in spring, dry olive / stubble in autumn). `mapInSeason` (`maps/shared/season-map.ts`) returns the map in that
  season and `RallyGame` builds its `World` from it, so terrain, horizon and sky follow. The stage card has one picture per season
  (`<stage id>-<season>.jpg`, `cardImageName`; the other seasons' hash + floor colour in the card's `seasons`); the dropdown swaps
  it (`Showroom.setSeason`) and only the shown season is fetched. A map without `groundTints` shows one picture for every season.

**On a stage** (`game/stage.ts`):

- **Hold:** a stopped car with no pedal pressed is held (HUD `HOLD`); throttle releases it.
- **Sectors:** one bar segment per sector, amber while running, green / yellow against your best run (faster / slower).
- **Cutting** (`StageTimer.updateCut`): up to `CUT_WARN` (20 m off the road edge) is allowed. Past it the HUD shows `OFF STAGE`
  and a grace timer runs; when it ends, or past `CUT_MAX`, or on a later part of the road, the car is put back where it left.
- **Penalties:** manual reset +2 s (+10 s when flipped), forced reset +5 s. Knocked-over marker posts are free, chevron signs only slow the car a bit
  (`breakable` assets, `slow` in the catalog, `world/breakables.ts`): the car drives over them and they tip over until the stage restarts.
- **Finish:** the car brakes itself to a stop on the run-off (`finishStopControls()`), so every map needs a run-off. The
  autopilot (`F8`, finish stop) runs per 240 Hz physics step, exactly as in the tests.
- **Results:** time, delta to the best run, sector chips (green / red with the gap to the fastest that sector among the other runs shown (follows the All cars / this car toggle)), **Watch replay** (Replays below), then the stage top 10 (all cars / this car)
  with each run's set-up. Stored per stage in localStorage (`rally.times.<stage>`). `STAGE_TIMES_VERSIONS` + `CAR_TIMES_VERSIONS`
  (`game/stage.ts`): each run stores its stage and car version; on a bump `migrateTimes` keeps the runs, tags them with the version
  they were set on (`RunRecord.ver` / `carVer`) and lists them below the current ones, dimmed (the bumped stage's / car's per-car
  bests move into the leaderboard as old runs; times from before versions show as `v0`). Each run also stores `season` + `hour`
  (older runs show Summer and the stage's own time of day: `runConditions`). A stage's road change bumps that stage (a map's road
  change bumps every stage on it), a car's handling change bumps that car, a shared physics change every car; livery / model fixes
  never. Bumps are made when the owner says we are making a build (`AGENTS.md`).

## Replays (`game/replay/`)

**On in every build** (`REPLAYS_ENABLED`, `store.ts`): every run is recorded. A run can be watched from the results, from
Stage times (▶ on a run with a replay, "Replays on this device" list) or by URL: `?replay=<id>` on the play URL is the whole link (`replayUrl()`): stage, car, set-up and conditions are read from the saved replay's header and any other params are ignored (old long links work the same). Replays are saved in this browser, so the link opens on the device that recorded the run.

- **Recording** (`recorder.ts`): state, not inputs (re-simulating from rounded inputs drifts hundreds of metres in a minute). `RallyGame.frame` calls
  `recorder.step` after each physics step; every 4th step (60 Hz) it stores pose, per-wheel omega / temperatures and car channels (rpm, gear, pedals, steer,
  impact, flags, stage clock, progress; `format.ts`). No physics changes: `Vehicle.probeGround()` is the old first half of `suspensionPass`, split out so
  playback can re-run the wheel rays. The finished run records on for `REPLAY_TAIL` (the run-off), then is encoded; a restart or leaving the page in that tail
  saves it at once (`flushReplay`). **Limit:** `MAX_SECONDS` (30 min) of recording; a longer run (or free drive) has no replay: not saved, Watch replay says not available.
- **File** (`codec.ts`, DOM-free): `RRP` + format byte + JSON header (stage, car, set-up, conditions, versions, splits) + quantised, delta-coded,
  zigzag-varint, gzipped columns (`WHEEL_QUANT` / `CAR_QUANT`, pos 1 mm); ~200-260 B/s. Over `REPLAY_BUDGET` (100 KB) the rate halves (max 30 Hz). Bump
  `REPLAY_FORMAT` on a layout change (old files are refused).
- **Storage** (`store.ts`): IndexedDB `rally-replays` (`meta` + `data`); every finished ranked run is an **auto save** and nothing is evicted
  (`navigator.storage.persist()` is asked on the first save). **Save replay** (results, replay bar) or **Name** (Stage times) makes a **named save**
  (`meta.name`, `cleanName`). Stage times lists named saves first, then the newest auto saves, each with rename and delete, over a storage line with **Delete
  auto saves** (all stages; named saves never, personal bests kept unless unticked: `autoDeleteIds`). From `REPLAY_SOFT_LIMIT` (1000) replays the line becomes
  a notice with size and quota; saving never stops. Failures are silent: never a lost time.
- **Playback** (`playback.ts`, `session.ts`): no physics; `ReplayTrack.apply` poses the real `Vehicle` (Catmull-Rom position, slerp, velocities from the
  frames, `probeGround`, derived wheel slide / roll speeds and slip), so model, dust, tyre marks, sound and HUD run as in a drive, on replay time; opening a replay or seeking back clears the marks and tyre dust, which it redraws. `ReplayClock` feeds the HUD the
  recorded clock and sector colours.
- **Cameras** (`replay-cameras.ts`, `tv-cameras.ts`): Broadcast (auto director), Trackside, Chase, Far, Bonnet, Bumper, Drone. Trackside cameras: one outside
  every big corner (> 0.6 rad over 40 m) plus fillers on long straights, placed by terrain line of sight past tree crowns / colliders, planned at the finish
  in slices (`tvCamerasFor`); each films only the stretch it sees unbroken (none: Chase). Broadcast shows big corners from their trackside camera and cycles
  the others between them; no cut under 2.5 s or in the air.
- **UI** (`replay-ui.ts`, `replay.css`; STYLEGUIDE "Replay"): camera plate, timeline with split marks, transport, speed 0.25-2x, camera picker (a dropdown
  under 1360 px), Save (name; an inactive "Saved" once named, absent for a replay opened from the menu: rename it in Stage times), Clean feed, Export, Exit (back to results, or the menu for a URL replay).
- **Export** (`export.ts`, `audio-tape.ts`, `RallyGame.exportReplay`): a section (amber handles on the timeline, `I` / `O` at the
  playhead) at 720p / 1080p / 1440p / 4K, 60 fps, rendered offline frame by frame at exactly that size, so no frame is dropped on a slow machine.
  MP4 at Standard / High / Maximum quality: WebCodecs H.264 (else HEVC / VP9 / AV1) at a fixed quantizer (else a constant 25 / 50 / 100 Mbps at
  1080p, scaled by pixels), muxed by Mediabunny (loaded on the first export). Chrome / Edge ask where to save first and write while it renders;
  elsewhere the MP4 downloads at the end. The sound is the same synth on an OfflineAudioContext fed what each frame told the live one. Before the section (not in the file) the camera
  holds until the ground tiles and trees around it have loaded, then a 1.5 s run-up; the panel shows each step and the time left.
- **Debug** (`debug-export.ts`): `__rally.replay.copy()` / `download()` / `load(text|bytes)` / `info()` / `list()`; `trace(s, every)` / `copyTrace()` /
  `downloadTrace()` = every 240 Hz physics step of the last 20 s (inputs, pose, per-wheel load / slip / forces) as TSV (the F2 panel has buttons); `load` of
  another stage / car reloads into it.

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
    tree materials look it up at their shadow lookup point (out of their own crown, as in the sun's map). The sun's map
    cross-fades into it over `NEAR_FADE` m (no brightness step where they hand over);
  - past both, the baked canopy shadows (World shading below).
  - Terrain casts into both maps (`TerrainOptions.castShadow`), but only from inside their boxes; a low sun's shadow of a
    ridge runs on for a kilometre. `world/terrain-light.ts` (8 m texels, baked in slices of the frame's slack after the
    start, faded in) bakes the height a point must reach to see the sun past every hill (a crown or a car over a shaded
    slope still stands in the sun) and dims the ground's sky light by the sky its surroundings leave in view (valleys,
    the foot of a slope; `TERRAIN_SKY` in `engine/world-shading.ts`: `lightsEnd` writes it with the forest floor and the wet
    shading's terms on every `setWet`, so it holds on every stage).
- **Night** (`engine/night.ts`, `?tod=<hours>` from 19:30 to 04:30 on any map; not in the studio): the moon is the directional light
  (dim, blue, `moonAt`), the sky a dark dome with a town glow, moon and stars (`NightSky`), fog dark, tone mapping AgX at a fixed
  exposure; the env map and the tree ambient (`setTreeSky`) are rebuilt from the night sky. The car's lights fade in with the dark
  (`lightNeed` from the sun height: off by day, ~0.6 at the 17:30 evening, 1 at night; scales lamps, beam, cones and dust glow):
  `CarModel.setLamps(level)` and `game/headlights.ts` (`CarDef.headlights`: strength, colour and beam shape per car) add a low-beam
  spot (one per lamp in rain / fog), a wide spill spot and two soft beam cones; dust, spray and haze glow inside the beam
  (`ParticleSystem.setHeadlight`). Only one low beam and the moon cast shadows, on high quality. In rain / fog by day (`lightNeed`
  under `BEAM_MIN_NEED`, `rally-game.ts`) the lamps glow near full (`WEATHER_LAMPS`) with only the two unshadowed low beams (no spill,
  cones, street lamps or pools: they read as smears in daylight). Head lamps (`part-materials.ts` `headLamp`) are nearly dark with the
  lights off and get a halo in the beam colour when on (`LampHalos`); the beam starts at the model's own lamps (`CarModel.onHeadlamps`
  -> `Headlights.moveTo`) and its cones fade when seen from in front. Road side (`engine/night-glow.ts`, shared `ws*` uniforms):
  marker-post reflectors and chevron boards light up in the car's beam (`retro`), street lamp lenses glow with `lightNeed` and
  `world/lamp-pools.ts` lays a soft pool under each lamp, draped over the ground. High quality adds bloom (`engine/post-fx.ts`;
  lenses and reflectors are emissive well over its threshold). There is no high / low beam key.
- **Post effects (High):** `engine/post-fx.ts`, options **Bloom** (off / soft / strong, default off, `BLOOM_MIX` in `game/settings.ts`) and
  **Ambient occlusion** (default off). Bloom: the whole picture, no threshold, mixed back at a few percent, worked on an HDR
  estimate of the finished picture, so with it off the image is unchanged. AO: GTAO from the depth at half resolution.
  Test links: `?bloom=<mix>` (0 = off), `?ao=0|1`; console `__rally.post.set({ day: 0.04, ao: true })`.
- **Sun glare (medium, high, by day):** `engine/sun-glare.ts`, a veiling glow round the sun and faint lens ghosts, as much
  as the world leaves of the sun in view (occlusion queries on probe quads at the sun, eased: it flickers through a
  crown); weaker under clouds (`cloudCoverage`). Drawn only while the sun is near the view. `?glare=0` / `__rally.glare.enabled`.
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
  Over that sky the car reflects its surroundings (`world/car-surround.ts` -> `engine/car-reflections.ts`, medium / high,
  `?surround=0..1`): per 2.8 deg of azimuth round the car, how much of 8 elevation bands its scatter trees (crowns as
  cylinders, trunks), the far forest's canopy map and the terrain horizon cover, in their colour lit like the env map's
  ground, plus the shade of the forest floor; eased (no pops), blurred per roughness row, one 128 x 12 texture. CPU only:
  a cube-map probe rendering the scene cost milliseconds of draw calls per face and its own shader programs. The covered
  share of the sky also dims the car's diffuse sky light (`wsSurroundOn.y`). The showroom / car viewer turn it off.
- **World shading** (tune live with `__worldShading`): cloud shadows, a canopy shadow texture that keeps woods dark where
  neither shadow map reaches (`world/canopy-shadows.ts`: a coarse whole-map texture plus a 1.5 m local window of 768 m
  around the camera, rebuilt from the generated scatter chunks every 64 m), height fog
  warming towards the sun, wind, leaf translucency. Custom shaders must call `addWorldUniforms(shader)`. Flag cloth
  (`defines.RALLY_FLAG`: materials `flag` = the printed flag of North Macedonia, texture `flag_mk`; `fan_flag`) turns downwind
  and ripples; print the pattern on the cloth, never lay geometry over it (the wind shader moves vertices, not surfaces).
  `groundTint.variety` adds deeper-green / yellow-green meadow patches to the tinted grass (spring).
  Levelled gardens / park strips: `terrain.lawns` (flat world polygons) paints the terrain itself pure grass (splat) and wet
  (`world/ground-moisture.ts`, lush green) - do not lay a green decal over terrain.
- **Surfaces:** bump relief on roads, rocks and terrain (off on low); grass cards use alpha-to-coverage with MSAA. Terrain ground = Poly Haven scans in one
  texture array (`engine/ground-textures.ts`, tiles in `engine/ground/`, `scripts/ground/bake.py`): grass per season, soil, gravel, rock, leaf litter, stubble
  under crops. The splat channels blend by height (scan brightness), a blurred rotated second tap breaks the tiling and unused layers are not sampled. Leaf
  litter lies where the canopy texture has crowns (`wsCanopyCover`; `groundTint.litter`), with fresh coloured leaves in autumn; under pines a needle carpet in every season (`landcover.needles`, G of
  `world/ground-moisture.ts`). `groundTint.shade` darkens the floor under crowns and shuts that share of the sky light out (`CANOPY_FLOOR`,
  `engine/world-shading.ts`). The meadow scans carry the old tile's olive hue so each map's `groundTint` keeps its look. Chunks beyond the first LOD band use the cheaper `TERRAIN_FAR` material
  (`world/terrain-material.ts`): no relief, one tap per layer, no specular environment lookup.
- **Effects:** dust, haze and water splash (`game/dust.ts`; sprites fade into the ground or water under them, `floor`), gravel spray as tumbling stones
  (`game/gravel-stones.ts`), splash off wheels in water (`rally-game.ts` `emitSplash`), tyre marks (`game/tyre-marks.ts`) and a contact shadow under the car.
- **Car lamps** (`CarModel.setBrake(level, reversing)`, `part-materials.ts` `lamp()`, `cars/shared/lamp-halo.ts`): with the lights off a lamp is dark (by day
  too); on, it moves to its `LampNight` glow and gets a soft halo plus a camera-facing corona per lit lens. Brake and reversing lamps follow the pedal and
  gear R (in R the throttle key is the brake pedal). Red glows stay low and pure red because AgX turns a bright red salmon pink. Special cases: a centre-line
  piece (the third brake light) is split off at load (`lamp-islands.ts`) and lights with the brake only; `gltf.bootLamps` does the same for a boot-lid half
  (Bimmer GT2); `lamp()` `idleGlow` / `chamberGlow` and `gltf.tailHalo` cover sheet lamps and lamps with one glow map. At night `game/headlights.ts`
  `TailLight` adds two dim red spots under the model's own tail lamps (`CarModel.onTaillamps`; none on a rain / fog day) that follow the brake and tint the
  dust behind (`ParticleSystem.setTaillight`); a wet road shows each lit lamp as a streak (`game/lamp-reflections.ts`). Check lamps in the car viewer: `tod=1`
  (night; `tod=17.5` = evening) with `lamps=off|on|brake|reverse`, `beam=0` hides the beam, `quality=high` adds the bloom.

## Maps

Maps and stages: a **map** is the world (terrain, roads, land cover, scatter, buildings, environment: `maps/<id>/map.ts`); a **stage** (`StageDef`, the map's
`stages`, `maps/<id>/stages.ts`) is the event on it: name, tyre / gearing, `reverse` (driven against the road's direction), `timing` (start / finish /
splits), `closures` (barrier rows at side-road mouths, `stageMargin` = only along the stage), `cornerFans`, event `props`. Players only see stages; times
(`rally.times.<stage>`), release flags (`STAGES_LIST`), URLs (`?stage=<id>`; an old `?map=<id>` link is rewritten) and cards
(`maps/<map>/preview/<stage>.json` + one `<stage>-<season>.jpg` per season) are keyed by stage id; every map from before the split has one stage with the old
map id, so stored times kept their keys. The world never depends on the stage: `World(map, stage)` keeps `road` (geometry) and adds `stageRoad` (the road, or
its `reversed()` view) for timing, spawn, signs, fans, closures and the autopilot.

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
- **Field crops** (`landcover.fields.crops`, Ajvatovci): each field parcel's palette entry names the crop standing on it per season, and scatter rules with
  `crop` grow only there (`TerrainGenerator.cropAt`, not within 0.8 m of a parcel edge). Wheat is green and short in spring, ripe in summer and gone in autumn
  (stubble tint): 1 m card patches to 90 m, at least 2 m clear of the stage road. Corn (`corn`, `corn_row`; no stage grows it yet) grows in rows 0.75 m apart
  along the strips (`rows.fields`). Both are CC BY Sketchfab models (`THIRD-PARTY.md`) baked by `scripts/crops/bake-crops.py` into `crop-models.data.ts`;
  `bakeCropCards` (`engine/crops.ts`) renders the cards once per page, 4 variants each with its own mix of plant heights so the field tops are uneven. Near
  detail is chosen by road distance, never camera distance (catalog `nearRoad`, `nearBoost`): grass is denser within 14 m of a road and is crossed cards at
  every distance, so nothing swaps or fills in as the car drives on.
- **Grass, weeds, reeds** (`engine/grass.ts`, `assets/builders/vegetation.ts`): crossed cards cut from seven atlases (`engine/plants/*.webp`, coverage mips)
  that `scripts/plants/bake-plants.mjs` renders from CC0 Poly Haven plant models (green / dry / spring grass tufts, the weed margin, nettles `tall_weeds`) and
  CC BY Sketchfab models by Nicholas-3D (reed beds and cattails `reeds`; `--sheets reeds` rebakes only that sheet; credits in `THIRD-PARTY.md` and About), and the woods' ferns (`fern`,
  `fern_autumn` = dead bracken toned by `pack.py` `bracken()`) from the CC0 Poly Haven Fern 02.
  `SHEET_GAIN` brings each sheet into the measured colour bands (cards and blade strips alike; a test checks) and `GRASS_CARD_ALPHA` sets the card cut. Keep
  grass at two variants (it draws as a variant set). A stage loads only the sheets its season's assets use (`plantSheetsReady`, `assetIds`); a sheet that
  fails to load is logged and drawn as plain blades.
  Meadow patches (`world/meadow-patches.ts`, catalog `patches`): a seeded noise field makes the grass yellower / paler or deeper green in 5-30 m
  drifts (per-instance colour over the fine `tint` jitter) and picks the variant (0 = the drier look). `tall_grass` = knee-high seeding grass (the
  scans drawn tall, straw stalks, a green base in the lush patches) on uncut verges and in fallow stands, summer and autumn (`seedingGrass`, `maps/shared/seasonal-grass.ts`).
- **Vineyards** (`engine/vines.ts`): canopy cards painted per season from the trees' lobed leaf sprays (`trees/leaftex.ts`)
  as canes rising from the cordon, colours in the trees' measured bands (`LEAF`); trunks and cordon arms wear the trees'
  scanned cedar bark (`vineBarkMaterial`).
- **Horizon backdrop** (`horizon`, real maps): the land ~25 km around the map (terrain + land cover from Terrarium / WorldCover, no roads or buildings), baked
  by `scripts/realmap/horizon.py` into `<map>/horizon.json` and drawn behind everything with its own far plane (`world/horizon.ts`; cut away inside the
  streamed terrain). A grid may be off-centre and non-square (`horizon` `extent` in the bake config: Vodno reaches 50 km north, 16 km south). Catalog assets
  named in `FAR_LANDMARKS` (the Vodno cross and mast) are also drawn there with their last LOD. Its woods are shaded per pixel (`LAND_DETAIL`) in the stage's
  crown colour (`setForest`, `canopyTone`) and match the map's own forests through the far forest's canopy map. A far river (`HorizonDef.rivers`,
  `scripts/realmap/rivers.py` after horizon.py) is one flat ribbon over the finest grid (`riverGeometry`; Vodno: the Vardar). `skyline` (`SkylineBuilding`)
  adds the city's tall buildings beyond the baked area (Vodno; one draw, `skylineGeometry`).
- **Cable cars** (`aerialways`): a gondola line from a polyline - pylons on its vertices (`pylonsAtVertices`) or evenly spaced (taller
  where the slope asks), two ropes in a sag parabola, cabins running the loop (`world/aerialway.ts` pure layout + `cabinPose`, test;
  `aerialway-mesh.ts` one instanced mesh moved when drawn; asset `gondola_pylon`).
- **Corner fans** (stage `cornerFans`; `world/corner-fans.ts`, `World.cornerFans`): small groups on the inside of tight corners along the whole stage: red /
  white tape (always a chain of posts ~5 m apart with a `tape_span` tied between them, tilted to the slope; a blocked post splits the run and a lone post is
  dropped, `world/tape.ts`; the roadside `tape_post` rules and service-park lots use the same), spectators (some waving their map's own hand flag,
  `MapDef.country`, or a plain colour flag, never another country's) + visitors, a marshal, 1-2 photographers, flags; marshals at every side-road mouth, 5
  photographers each at start and finish (people are capped on purpose: `DEFAULT_FANS`, `SHOOTERS`, `END_PHOTOGRAPHERS`). People animate
  (`world/people-anim.ts`, run by `RallyGame.frame`): within 45 m they turn to watch the car, photographers (75 m) keep it centred; hand flags wave in the
  `people_flag` shader.
- **Service park** (stage `servicePark`; `world/service-park.ts`, `World.servicePark`; per map `maps/<id>/service-park.ts`; tests `service-park`,
  `parc-ferme`): team bays on levelled gravel lots with a truck / van, team cars on ground sheets, tents, props, crew and guests, plus tape, a crowd and a
  start control. Assets: `assets/builders/service.ts` + `teams.ts`; the props are NVIDIA SimReady scans and Poly Haven models baked together (`simready.ts`:
  tool chest, tyre racks, jack, axle stands, flood light, extinguisher, wheelbarrow, hand truck, ladder, bin, table and chairs, generator, jerrycans); team
  trucks, vans and the catering van are the background models in team paint plus side stripes.
  - **Lot** (`ServiceLot` in `maps/shared/types.ts`): a rectangle levelled by a `terrain.pads` entry (`servicePad` in `maps/shared/service-lot.ts`; `apron`
    levels the strip to the road, `level` fixes a flat field). `cars` = team cars wanted (a works bay holds two), `semis` = team lorries (`service_semi`)
    behind one row of bays, `links` = dirt links across the verge (`linkPad`: a gravel ramp up to the road, 5 m wide; tape, crowd and press keep off them).
    `mechanics` [min, max] makes a lean lot (no crew / drivers / guests / aisle visitors), `crowd` and `press` set the spectators and photographers along the
    edge, `showWithin` draws the lot and its park cars only within that many metres of the camera (`ScatterInstance.showWithin`).
  - **Parc fermé** (`ferme`): a row of team cars, noses to the tape, on a lay-by behind the start (`ServiceLot.bays`), each with its crew and, on a lot 12.5 m
    deep (`TENT_DEPTH`), its team tent and tool chest. On a street (Jackie, Vodno) the lot lies over the road (`paved`, no pad) and `parallel` parks the cars
    nose to tail along the kerb with a 3 x 6 m tent behind each.
  - **Recovery truck** (`ServiceLot.tow`): `service_tow` (dump cab + roll-back deck, `build/truck-backs.ts`) and a marshal in a 9.5 m stretch at the lot's far
    end; make the lot that much longer.
- **Park cars**: `team_car` only places the car and its collider. The car is a real released model at low quality
  (`world/park-car-mesh.ts` `ParkCars`, owned by `InstanceStreamer`, `streamer.ready`): `public/models/cars/<id>_park.glb`
  (`scripts/car-model/park-lods.mjs`: body LODs of about 7.5k / 2.3k / 1.1k triangles, three rims) in the team's livery (car's own
  painter, one texture per car and team), two draw calls per car; a raised car stands on axle stands (`tyre_stack` beside it). Models
  load near the park and are freed far away (`parkCarsPlan`). Tests `park-cars`, `car-glb-meshopt`.
- **People** (`assets/builders/people.ts`; credits `THIRD-PARTY.md`): close up (LOD 0; LOD 1 on the mid mesh) a person is one of two CC BY base bodies
  (`engine/people-base.data.ts`, baked by `scripts/people/extract-base.py` + `skin-map.py` + `bake-base.mjs`), posed on the CPU per variant (`people-body.ts`:
  13 bones, `widen` for build) with a painted face (`engine/people-skin-material.ts`). Everything worn is cut from that body: `people-tailor.ts` (scalar
  fields clip, offset and relax the body and unwrap it onto the fabric atlas cells of `engine/people-fabrics.ts`; `split` / `splitIn` cut exact bands, checks,
  tape, pads), `people-wear.ts` (`dress`: tops, trousers, skirts, coverall, hi-vis vest, gloves, team shirt patterns), `people-hair.ts` (scalp cut from the
  head, hats) and `people-shoes.ts`. `pickHair` picks a hairstyle by gender, length and age; `Outfit` fields override the defaults. LOD 2 / 3 stay code-built
  (`farJointedFigure`, `farCrowdFigure`, `farSilhouette`). Roles: `spectator`, `mechanic`, `crew`, `driver`, `marshal`, `photographer`, `visitor` (12
  personas). A new look = a field in `Outfit`, a new pose = `POSES`; test `people`.
  - The two detailed levels are `lazy` (`LodSpec.lazy`, tens of ms per person) and built in workers (`people-worker.ts`, `people-pool.ts`: geometry only, each
    part tagged with its material's look), not per variant at load. The load builds what the spawn view needs (`world/people-warm.ts`) and one warm variant
    per material (`AssetMeta.warm`; a test checks no other variant adds a shader); while driving `InstanceStreamer` (`prefetch`) asks for the levels ahead of
    the car, nearest first (`world/build-queue.ts`), and draws the next cheaper LOD until one is there. Built levels are capped (`LAZY_BUDGET`, 48 MB): idle
    ones the car left ~600 m behind are dropped, least recently used first (`InstanceStreamer.evict`), and rebuilt if needed.
- **Guard rails** (`barriers`): continuous swept rails / Jersey walls by distance; `hairpinRails` (`maps/shared/real-map.ts`)
  puts them on the outside of every tight bend of a mountain road (Galichica). `rusty: true` = weathered brown steel (Vodno).
  `MapDef.dropRails` derives more (`world/drop-rails.ts`): wherever the carved ground falls more than `minDrop` m within `within`
  (3) m of the verge; the map's own `barriers` (hand, hairpin, OSM-mapped `barrier=guard_rail`) win on their side and stretch,
  and a derived run ending within `gap` of one carries it on (its steel and offset, no gap).
- **Fill banks** (`RoadDef.fills`, `TerrainGen.carveRoad` / `paintFill`): the valley-side mirror of `rockCuts` - where the land 5 m
  past the verge lies `minDrop` m below the road, the verge holds to its rim and a straight `slope` bank of stony earth falls to the
  land (no ditch). With `dropRails` the rails stand on its rim (Vodno).
- **Culverts** (`MapDef.culverts` = `maps/<id>/culverts.json`, baked by `scripts/realmap/culverts.py`; `world/culverts.ts`,
  `culvert-mesh.ts`): where a drainage line of the elevation data crosses the stage road, a concrete pipe with a headwall, wing walls
  and an apron at both ends, the gully carved to and from it (`TerrainGen` after `carveRoad`, never on the road or its verge: no
  times bump), a few stones at the outlet. Sized and placed against the carved ground on first use (`gen.culverts`). In rain they run
  (`world/culvert-water.ts`): one muddy ribbon through each pipe, over the apron and down the gully, one draw call, built at full flow
  and lowered by the weather in the shader (nothing drawn when dry; a trickle stays after the rain). Looks only.
- **Natural ground** (opt-in, `TerrainDef`): `talus` paints bare stony ground on natural slopes in its `slope` range (judged on
  the elevation data, `paintTalus`, cached on a 4 m lattice; coarse far terrain tiles paint the face only) and scree up to
  `reach` m below them, less under a closed canopy; `streamBeds` lists the
  channel kinds whose bed is pebbles and stones. Scatter `minSlope` puts crags and loose rocks on the steep ground only.
  Rock bands: a scatter rule with `outcrop` (asset `rock_outcrop`, two CC0 Poly Haven rock-face scans, `scripts/rocks/bake-outcrops.mjs`)
  grows a row of pieces along the contour from each point (`world/outcrops.ts`): faces down the slope, leant back, open backs
  buried, the row ends where the slope eases under `minSlope` or at the chunk edge (Vodno: the steep spurs).
- **Generated trees' leaves** (`trees/leaves/<style>.webp` + `-n.webp`, `scripts/trees/bake-leaves.py`): the broadleaf and
  pine sprays are photo crops of the same LOLIPOP packs' leaf textures (normal + thickness from the pack normal map), decoded
  in the tree worker (`trees/leafphoto.ts`); node tests, vines and the narrow / juniper styles keep the drawn atlas (`leaftex.ts`).
- **Hero trees** (`pack_pine` / `pack_oak` / `pack_fir` / `pack_birch` / `pack_maple` / `pack_elm` / `pack_willow` / `pack_lilac` /
  `pack_bush`, `assets/builders/tree-packs.ts`): CC BY pack models, kept in the catalog but used by no map (every map grows
  generated trees only; they cost too much). The hooks stay: `MapDef.heroTrees` (a share of a species' scattered trees near
  the road as a pack kind; the map's `packs` in `maps/index.ts` load them), `realTrees.near`, a scatter rule naming a
  `pack_*` asset. Size ladder: `.claude/reference/trees/Placement.md`.
- **Stands** (generated trees; worked example Vodno `map.ts`): woods are layers, not lone trees - an overstorey (Vodno: tall
  black pines sized by the canopy model's stand height), a 4-10 m broadleaf middle layer and shrub thickets within `UNDER`
  m of the road, every age in one stand (the age ladder). Scatter tools: `mask.group` (rules on one clump field: mixed
  thickets; `invert` = the ground between: pine blocks with broadleaf between), `contour` (strips / planting rows along the
  contour: Vodno's logged slope regrowth), `lean` (stems within `within` m tilt toward the road, also on `realTrees`),
  `fieldEdge` (within [min, max] m of a field parcel's edge: Petralica field-edge tree bands; with a `mask` so only some
  boundaries carry one). `minRoadDist` / `maxRoadDist` past the road query's ~35 m reach use a coarse distance field
  (`farRoadDist`, to 260 m).
  `forestEdge()` (`maps/shared/forest-edge.ts`) adds the verge belt: thicket / hazel / bush clumps and leaning young trees.
  Nothing grows on a rock cut's face, and no tree stands where its crown would hang over one (`ScatterContext.cutAt`,
  `world.ts`: carved below the land where `rockCutWeightAt` says cut; `CUT_CROWN` toward the road).
- **Piles** (`maps/shared/piles.ts`): sand / crushed-stone / spread heaps for road closures, depots and sites - shape, scanned
  material (kit keys `sand` / `aggregate`, spill `sandSpill` / `stoneSpill`), weeds, colliders; a landmark builds them into its bucket.
- **Forest-floor debris** (`forest_stump`, `forest_log`, `forest_trunk`, `forest_branches`, `forest_roots`; `simready.ts`): CC0 Poly
  Haven scans, bake group `forest` - the one group that keeps its models' own colour + normal maps (option `gain` warms a pale scan; atlas
  `engine/props/simready-forest.*.webp`, `debris` material). A map lists `'forest'` in its `models` and scatters them; sunk into
  the ground, colliders on the stump, log and trunk only.
- **OSM features** (bake `osm.features`, `data.json` "features", `MapDef.features`): park furniture, gates / blocks / bollards,
  single trees, signs and fence / wall / kerb / guard-rail lines within the corridor; a map landmark places them (Vodno:
  `vodno-osm-features`, built from the map in `world/landmarks.ts` `FROM_MAP`, after and around the hand-built ones).
- **Scatter area** (`MapDef.scatterBounds`): narrows where trees / bushes / rocks are generated (any side of `bounds`) - for land no
  camera can see (Vodno: nothing south of the ridge). A way merging into another at a shallow angle sets `PathDef.mergeTaper` (its end
  narrows to a point) and `joinsUnder` (its ribbon lies under the other's).
- **Road textures** (`RoadDef.texture`, per stretch in `sections`): gravel `road`; the tarmacs `road_tarmac` (Poly Haven Asphalt 04 scan, CC0, with hairline
  cracks and faint tyre / oil marks: Ajvatovci, Galichica, Petralica; the scan goes in `sources/textures/asphalt_04/`, listed in `PHOTOS` in
  `scripts/asphalt/bake.mjs`), `road_tarmac_kerbed` (no edge grit: Ajvatovci's kerbed start street), `road_tarmac_lines` (white edge and centre lines) and
  `road_tarmac_plain` (no lines: Vodno's crossroad, where the road paint lies over it); `road_parkway` and the city asphalts (`road_city`, `road_street`,
  `road_street4`, `junction_asphalt`).
  - The asphalts are baked images, not drawn at load: `engine/asphalt/<id>.<size>.{color,normal,rough}.webp` from `scripts/asphalt/bake.mjs` (tiles drawn by
    `gen.js` in headless Chromium; the output is committed, rerun after changing `gen.js`). High loads the 1024 px set, Medium / Low their own 512 px set.
    `engine/road-surface.ts` loads them (the play page preloads the map's sets) and `getRoadMaterial` puts them on the road: colour + a normal map with the
    roughness packed in its alpha + a tone shader (blotches and streaks that never repeat; Vodno's tiles get pale repair patches, more of them higher up). A
    new asphalt id = a `gen.js` preset, `ROAD_SURFACE_LEN` (same `len` as `texLength`; a test checks) and a rebake.
  - Rally-worn tarmac (`world/road-wear.ts`, the stage road's `WEAR_TEX` tarmacs): per-sample masks in the `rwA` / `rwB` vertex attributes,
    drawn by the asphalt shader - a light film of earth on the inside of some hairpins (under ~40 m radius, not on decks, kerbed
    streets or behind barriers), rubber on the braking line, mud out of dirt tracks, sealed cracks on `PATCHES` roads. Visual only.
  - The gravel road (`road`) is not baked: it is the terrain's own gravel layer in world space (`world/gravel-road.ts`: the same taps, brightness variation
    and relief rule as `world/terrain-material.ts`, so road and verge are one surface) with two wheel tracks along the line cars drive (`drivenLine` in
    `world/road-mesh.ts`), the loose gravel pushed aside (a ridge between the tracks, a berm along each edge), water standing in the tracks when wet, and an
    edge that thins out into the verge (dithered; the ribbon is opaque and drawn before the terrain, so the terrain under it is not shaded twice). The gravel
    tile is darker and browner than the scan (`GRAVEL_LUM` / `GRAVEL_TINT` in `scripts/ground/bake.py`; `GROUND_MEAN.gravel` follows): compare it with the
    verge in the map viewer (`along=300&zoom=0.2`) after changing the tile or either shader. The road bed has lumps and dips in the same order as the car's
    own bumps (`surfaceBump`, gravel 15 mm).
- **Road paint** (`RoadDef.markings`): lane lines (solid or dashed) and left / straight arrows as thin meshes over the road
  (`world/road-markings.ts`: `roadPaint` is the pure geometry, `roadMarkingsMesh` the meshes; textures `road_paint`,
  `road_arrow_left`, `road_arrow_straight`). Positions are measured from the road's left or right edge, so a lane keeps its
  place where the road widens on the other side (Vodno's crossroad: `maps/vodno/crossroad.ts`).
- **Other roads** (`paths`): tarmac ribbons, dirt paint or canals with their own surface; side roads carved with grade limits and extended to meet the stage
  road, the stage's `closures` close the mouths (`world/junctions.ts`). Dirt tracks / paths are painted into the splat (`splat` `minPathHw` keeps them lines
  from afar) and drawn as gravel ribbons too on maps with `trackRibbons` (a foot way, <= `FOOT_WIDTH`, is worn earth with
  stone patches and roots); `pathProfiles` overrides the height-line smoothing / grade per OSM kind
  (`PATH_PROFILE`). The baker splits an OSM way where it folds back (> 120 deg) or revisits one of its nodes; a ground way under 15 m anchored at both ends is
  one straight ramp (`SHORT_JOINT`).
  - Paved mouths (plain tarmac side roads and city streets, not on a plaza) get rounded corners (`junctionFillets`, drawn with the street ribbons in
    `road-mesh.ts`): every surface there blends into one world-aligned asphalt (`JUNCTION_ASPHALT` in `junctions.ts`: `road_tarmac_junction`, Vodno's
    `road_tarmac_plain_junction`; a square tile with no wheel paths, edges or lines, sampled by world XZ, weight in the mesh's `jw` attribute;
    `junctionMouths`) within 6 m, or 2 m where painted lines end at the mouth, with the dusty edge band running round each curve. On `cityStreets` maps the
    sidewalk turns round each corner onto the stage road edge, its kerb dropping flush there (`mouthCorners`, `StreetDetail.returns`).
- **Road slab** (`world/road-slab.ts`, every map): roads are a layer laid into the ground, not a texture on it. The drawn terrain is cut
  under the stage road, the ribbon side roads / tracks and the paved mouth corners (`RoadSlab.sink`, `TerrainGenerator.meshHeight`; `SLAB_SINKS`:
  6 cm under asphalt, 2 cm under gravel / dirt), easing in over the first metre inside the edge so the 1 m mesh dips under the road,
  not beside it. Physics and placement keep the uncut ground. Each ribbon edge has a skirt `SKIRT_DEPTH` deep (the slab's side), which the road
  shader darkens by the face's own slope (`road-surface.ts`); none where the edge meets another paved surface (`RoadSlab.paved`: roads
  join flush) and none round the mouth corners (their dust strip is the edge). The cut fades to 0 over 6 m onto bridge decks and plazas.
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
- **Terrain by hand:** `terrain.pads` level the land round a lot (along the road: `frontage` + `lift`) or a house on a slope (a terrace: `PadDef.level`); the
  road's carve wins near the road. `road.cutWalls.range` limits the sheer, walled cut to one stretch (Vodno's concrete wall at the first crossroad:
  `maps/vodno/crossroad.ts`); `cutWalls.solid` holds the cut tight (a thin coping) and gives the face box colliders (`world/cut-wall-colliders.ts`), so a car
  stops at it. `routePoints` takes a sideways shift (a lane added on one side). `MapDef.treeSetback` keeps the solid trees back from the road's edge along a
  stretch; `MapDef.treeCrownClear` (Vodno: 1.5 m) re-poses any tree whose low leaves (under 4 m) would reach that far past the road's edge (`lowOverRoad` in
  `world/scatter.ts`), so no limb hangs over the road.
- **Landmarks:** hand-modelled lots on graded pads that replace the placeholders, hooks `surfaceAt` / `keepsClear` / `groundOverride` (`world/landmarks.ts`,
  `pads.ts`; Ajvatovci `start-row`, `hilltop`, `station`; Vodno's car parks, gate, start-street flats and wall, and the brick hotel behind the side street at
  the first crossroad: `maps/vodno/landmarks/`, `start-blocks.ts`, `start-wall.ts`, `hotel.ts`). A `PathDef.bare` street gets no kerbs / sidewalks / lamps
  inside `cityStreets` reach.
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
- The city maps' parked cars (`street_car`, `taxi`, `police_car`; `assets/builders/vehicles.ts`) are NOT the rally cars: they are 10 cars of a CC BY pack with
  their own triangles and textures (`street-car-models.ts`, data `street-cars.data.ts`, atlas `street-car-atlas.jpg` + `street-car-mask.png`; baked by
  `scripts/car-model/street-pack-extract.py` + `bake-street-textures.py` + `bake-street-cars.mjs`, flags in their headers). LOD 0 is the full model, LOD 1 / 2
  meshopt reductions (budgets: `tests/rally/street-car.test.ts`). One shared material (`streetCarMaterial`): the atlas, with the paint (per-vertex `color`)
  multiplied in only where the mask is white, so lamps, glass and trim keep their texels; the taxi sign, light bar and lettering are a second `vehicle` part
  up to LOD 1. Variants 0-9 = model (`STREET_CAR_MIX` weights what streets pick; 10-12 = the white hatch, dark sedan and white minivan a map places); the LODs
  set `separateVariants` (no merged variant set: every instance would run the vertex shader over all 10 models).
- Pack 7's five vans and trucks (`service-vehicles.data.ts`, `bake-street-cars.mjs --vans`, `serviceVehicleModel`) are baked the same way into the same atlas
  and dress the service park (`builders/service.ts`: team paint through the tint mask, stripes and awnings a second `vehicle` part up to LOD 1,
  `PACK_VEHICLE_LODS`) and the Ajvatovci start-row lots; both lists are baked again after every atlas change (budgets:
  `tests/rally/service-vehicles.test.ts`).
- The two fire engines (`fire_truck` = the US engine of Jackie's junctions, `fire_truck_mk` = the Macedonian engine at a start control; `MapDef.country`
  picks) are two CC BY models with their own livery and one atlas each (`fire-truck-models.ts`, `fire-trucks.data.ts`, `fire-truck-us.jpg` /
  `fire-truck-mk.jpg`, so a map loads only its engine's image): `street-pack-extract.py` + `bake-fire-truck-textures.py` + `bake-fire-trucks.mjs` (scale, turn
  and LOD budgets are its `MODELS`; mesh helpers shared with the street cars in `street-bake-lib.mjs`). No paint tint, no add-ons.
- The Ajvatovci yards' cars and vans (`MODEL` in `maps/ajvatovci/start-row/build/vehicles.ts`) are these models (a few per kind taken in turn, scaled to the
  footprint, drawn per instance colour through the tint mask in three distance tiers `CAR_LOD_RANGE`, then a two-box stand-in). Their trucks
  (`truck-models.ts`) are baked from two CC BY models by `scripts/car-model/bake-trucks.mjs` (data `truck-models.data.ts`): `tractor` + `trailer`, a `tanker`
  (tractor and trailer chassis under a code-built tank), a `cab` under a code-built body (`box`, `cab-tow`, `cab-reefer`) and a `dump` truck whose back is
  swapped (tipper, flatbed, van body, tank, `tow`, `reefer`; `truck-backs.ts`); box-truck places go to these in turn (`RIGID_CYCLE`). The models keep their
  own triangles (welded, never simplified) and textures, the code adds nothing to lamps or grilles; `cab` / `paint` parts take the placement's colour through
  a tint mask (`truckMaps`) and the `tyre` model is the template for the axles. Textures + masks: `scripts/car-model/bake-truck-textures.py` (run after
  `street-pack-extract.py --images`, then `bake-trucks.mjs`); the hub-cap emblem is blanked there.
- Car GLBs are committed plain (the model scripts and `hull-fit.test.ts` read them); the build copies them meshopt-compressed
  (`scripts/car-model/glb-meshopt.mjs`, about half the size, same meshes; `car-glb-meshopt.test.ts` checks every file).
- **Door plates** (`cars/shared/rally-badge.ts`): our own event plate (emblem, car number, map name) projected onto both front
  doors. Liveries carry no numbers or lettering.
- **Release flags** (`release.ts`): `CARS_LIST` / `STAGES_LIST` / `WEATHERS_LIST` list every car / stage / weather id (a map ships when one of its stages does; a hidden weather is left out of the Weather picker and `?weather=`); `hideInProd: true` = dev server + `npm run build:test` only (TEST badge). Same flag and `RELEASE_BUILD` check (`src/shared/release.ts`) as `game.json`.
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
- **Start**: browsers block sound until a key or click. The first one unblocks it even during loading or the countdown
  (a held throttle sends only key repeats, which do not count); pause and a hidden tab suspend it (`sync`, re-checked
  when a resume / suspend lands).
- **Listener** = camera mode: hood / bumper hear more intake, gearbox and wind, less exhaust; far chase is quieter and duller.
- **Tunnels**: `World.tunnelAt` (portal slabs) -> `setEnclosure`: low-mid build-up, a slap echo per ear at each wall's
  distance (narrow = tighter flutter), a tail that grows with the tunnel length, a whump at each headwall.
- **Sound debugger**: car viewer "Sound" section (`debug/sound-debug.ts`) drives a `CarAudio` for the shown car: tick "Sound on"
  (the gesture), then rpm / throttle / pedal / gear / speed / slide + surface / lock-up / impact / listener / tunnel. State in the
  URL (`srpm`, `sthr`, `sgear`, `sspd`, `sslide`, `ssrf`, `slock`, `slis`, `stun`, `svol`); `mute=1` starts muted.
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

Rendering: `cars/shared/tyre-mesh.ts` (carcass, tread band, lettering ring), `tyre-tread.ts` (tread pattern per compound:
normal + groove maps, materials, dust tint), `tyre-sidewall.ts` (wordmark, tyre name, compound band), `suspension-mesh.ts` (per
`model.suspensionStyle`), `buildWheelSet` in `car-model.ts`.
Tyre detail levels (`tyre-lod.ts`, `CarModel.setTyreLod` from the game loop): the full displaced tread at rest, below 20 km/h and
within 9 m of the camera; a ~3k-triangle tyre with the same normal map further away (no lettering past 25 m); above 20-40 km/h
(dithered crossfade) the same low tyre with the tread smeared along the rolling direction (no strobing). Replays scale the speed by
the playback rate (paused = full detail). Never called (car viewer, showroom, setup bench) = full detail.
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

On a forest stage the CPU side of a frame is mostly draw submission (three.js + ANGLE), the GPU side mostly trees.

**Measuring**

- Compare old / new in the same page, interleaved (switch at runtime), on the median and p99: runs minutes apart, other benches or a background tab swing a
  result 2-3x.
- Judge slow frames with vsync on: uncapped, a CPU frame shorter than the GPU frame shows up as 20-40 ms back-pressure spikes.
- Tools: `__rally.benchmark(n)` / `__rallyProbe()` on `npm run dev:noreload`.

**Frame pacing**

- Background work shares one budget a frame (`RallyGame.frameSlack`), spent in order by terrain, objects, the tree job and
  the canopy. Never give a system a fixed slice; the ground near the car is built whatever it costs (`URGENT_MS`).
- No garbage in per-frame or per-texel loops: hot loops take plain numbers and typed arrays (`splatEllipse` in
  world/canopy-shadows.ts).
- Per-instance caches live on the instance (`ScatterInstance.streamed`), never in a `WeakMap` over every scatter
  instance: one with 300k+ entries made 30-50 ms GC pauses.
- Big GPU uploads go up in row bands (`copyTextureToTexture`), never whole while driving.
- Many small texture updates a frame (the trees' `TreePool.flush`) call `texSubImage2D` with a tight piece of the
  array each: unpacking with skipped rows of a big array is slow in Firefox.
- Never write into a buffer the GPU drew from last frame: rotate copies (`COPIES` in game/tyre-marks.ts,
  world/far-shadow.ts) and upload only the used range. A buffer drawn but never written turns static on ANGLE / D3D11 and
  its next write waits for the GPU: the tyre marks re-upload one quad every frame.
- Canvas textures use a CPU-backed canvas (`willReadFrequently`); gantry clocks redraw only near the car (`CLOCK_NEAR`).

**Draw calls**

- Never clone geometry or materials per instance: `getAsset(id, variant, lod)` -> `InstancedMesh`. Variant sets draw
  every variant of an LOD in one mesh (`getVariantSet`, `?variantsets=0`).
- Whole-map static meshes are merged per material into a `BatchedMesh` at load (`world/static-batch.ts`,
  `STATIC_ROAD_GROUPS`); anything that changes later stays a plain mesh. No `BatchedMesh` for streamed meshes (terrain
  tiles): writes into its shared buffers stall ANGLE / D3D11.
- Tree batches: one `multiDrawElementsInstancedWEBGL` per material and part (`trees/multi-draw.ts`), per-tree data in a
  float texture (`TreePool`); `?multidraw=0` draws one call per batch.
- Terrain tiles merge per LOD band and reuse released geometry (`terrain-renderer.ts`, `MERGE`, `SPARE_TILES`). A block
  over the map edge merges too, cut to the map (`grid`): never a strip of single chunks along the edge.
- A `discard` goes in its own material variant, used only where it is needed: the near terrain's culvert holes
  (`getTerrainMaterial(far, holes)`) draw on the tiles a culvert stands on; a warm-up mesh compiles the variant at load.
- Many materials = many draws: use a texture array (`engine/texture-array.ts`). A custom shader scales
  `envMapIntensity`, never replaces it.
- Scatter LOD1+ buckets draw only the camera's view (`InstanceStreamer.setView`).
- Empty InstancedMeshes are hidden (each still costs a draw setup). A split by camera distance runs before the render
  (the road `DistanceCull` calls `userData.beforeRender`), not in `onBeforeRender`, which needs a visible mesh; the
  cull hides an empty InstancedMesh only under such a hook (nothing else would show it again once filled).
- Level fades (`world/lod-fade.ts`, catalog `fade`: grass, weeds, crops, vines, people): a level change at a rebuild draws
  the instance in both buckets for 0.3 s with a per-instance `instFade` (start, role); the fade copy of the material
  (`lodFadeMaterial`) dithers the two with the trees' 8 x 8 pattern, only while a fade runs (its `discard` costs early
  depth). One copy casts the shadow; when the fades end, a bucket without outgoing copies draws plain again (`endFades`), one
  with them keeps the fade material (the copies collapsed) until the next rebuild drops them. The far end of the last
  level fades too, and while driving an instance new to the stream fades in.
- Meshes that never move set `matrixAutoUpdate = false`; transparent `DoubleSide` materials set `forceSinglePass`.

**GPU**

- The sky is drawn last, at the far plane, so covered pixels skip it. Nothing opaque may count on the sky being under it
  (the horizon backdrop's `depthPush` in world/horizon.ts).
- Trees are about half the GPU frame (crown-proxy shadows, impostors, leaf sprites). How they are drawn, their levels,
  fades and shadows: the tree spec ([ProceduralTrees](../../../.claude/reference/trees/ProceduralTrees.md),
  [Drawing](../../../.claude/reference/trees/Drawing.md), [Performance](../../../.claude/reference/trees/Performance.md)).
  Measure with the tree overlay (`F6`) and `?treebench=1`.
- Past `forestDistance` the far forest takes over (`world/far-forest.ts`: far tree impostors to `FAR_REACH`, then the
  canopy shell).
- Render scale option (Auto / 100 / 85 / 70 %, `RENDER_SCALE`). Auto (`adaptScale`) steps down only while the GPU falls
  behind, stops when a step saved under 5 % and waits longer after each step up that did not hold. A step lands before
  the frame renders (a resize clears the canvas: after the render it showed a black frame). Not the default: each step is
  a resize hitch.

**Streaming and distances**

- Streaming is time-sliced within the frame budget: terrain, the 1 m heightfield, grass chunks
  (`ScatterField.detailSteps`), instance re-bucketing. Whole-map work uses `world.analytic` and spatial grids, never
  all-against-all.
- Scatter chunks past 1.25 x the view distance are dropped (`ScatterField.pruneChunks`), so memory stays flat.
- Nothing is drawn past the streamed terrain (`quality.viewDistance`; the road group via `world/distance-cull.ts`).
  Knobs: `engine/quality.ts`, LOD distances in `assets/catalog.ts`, `TERRAIN_LODS`, the **Object distance** option.

**Shadows**

- Only LOD0 casts shadows, so every LOD0 radius must reach the far edge of the shadow box (1.5 x `shadowExtent`).
- The shadow pass is triangle bound: hidden parts do not cast, and a whole-area `InstancedMesh` is never culled.

**Loading**

- Loading ends with a warm-up (`RallyGame.init`): compile, then one render with culling off, so shaders (shadow pass
  included) and uploads happen behind the loading screen. A material first used mid-stage compiles then (a hitch): it
  must be in the scene at load (`assetIds` adds the world-placed assets).
- Background work runs in module workers (`shared/worker-pool.ts`): tree variants, leaf atlases, people, procedural
  textures; the tree workers read the IndexedDB cache. `__rally.loadTimings` splits the load by phase.
- A long load-time task holds every worker pool up: slice once-per-page bakes (`bakeCropCards`). Long synchronous steps
  set their label and `paint()` first.

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
