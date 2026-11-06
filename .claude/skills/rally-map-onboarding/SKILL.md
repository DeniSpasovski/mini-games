---
name: rally-map-onboarding
description: Guided intake for a NEW real-world Gravel Rally map or stage. Asks the developer for the place, the route and the visuals first (OpenStreetMap area, Google Maps route, satellite / Street View screenshots), files them in sources/maps/<id>/, proves the route with a trial bake, then builds to the rally-maps standards. Use when someone says "add a map / stage / track at <place>", shares a Google Maps or OpenStreetMap link for a new map, or asks how to start one.
---

# Onboarding a new rally map

You guide a developer who has not made a map here before. **Do not start with code:** ask for the inputs (1), file them (2), prove the
route (3), then build (4-6). This skill is the intake and the order of work. Options and engine details live in
`.claude/skills/rally-maps/SKILL.md` (read it before step 4), file handling in `.claude/skills/source-files/SKILL.md`, licence rules in
`AGENTS.md` "Public repo and licences".

Worked examples, same shape every time (read their `DETAILS.md` first): mountain road `maps/vodno/`, rural `maps/ajvatovci/`,
tarmac to gravel `maps/petralica/`, three stages on one map `maps/galichica/`, city parkway `maps/jackie/`. Where it exists on this
machine, `sources/maps/vodno/PLAN.md` is the model for your plan.

New real maps use the baker (`scripts/realmap/bake.py`). The v2 road engine (`maps/jackie-2/`) is not the default: ask the orchestrator first.

## 1. Ask first (one message; skip what is already given; never fill a gap from memory)

Send the developer this, adapted to what they already said:

> To start the map I need the place and the road, from OpenStreetMap or Google Maps, and some pictures of it:
>
> 1. **Place and stage:** name, region, one stage or several, surface (tarmac / gravel / mixed), feel (hillclimb, rural, forest, city),
>    season and time of day.
> 2. **Start from one or both:**
>    - **OpenStreetMap:** open openstreetmap.org, frame the whole playable area at zoom 15 (about 6 x 4 km) and send the URL
>      (`#map=15/<lat>/<lon>`) and a screenshot. That view becomes the map box, its centre the world origin.
>    - **Google Maps:** a directions link for the stage (`google.com/maps/dir/<start>/<finish>`, both points on the real road) and a
>      satellite screenshot with the route line showing. Google's length is what the baked route is checked against.
> 3. **Pictures** (each one is used, see below): start and finish close-ups, Street View frames, landmark photos.
> 4. **Anything that must be in or out**, who took the pictures (yours or from the web), and an elevation file if you have a better one.

| Ask for                                                                                          | Used for                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| OSM area screenshot                                                                              | what is imported, the landmark list                                  |
| Google route screenshot (satellite, route line, start and finish markers)                        | route check; `trace_route.py` where OSM lacks the road               |
| Satellite close-ups of the start and the finish                                                  | start area, service park, gantry spot                                |
| Street View or dash-cam frames: start, finish, every surface change, bridge, hairpin, wall, rail | `road.sections`, barriers, bridges, rails                            |
| Photos or links of landmarks (church, tower, cross, lodge)                                       | procedural landmark shapes: reference only, nothing traced from them |
| Optional: GeoTIFF / OpenTopography DEM (US: USGS 3DEP lidar is built in)                         | `dem.file`; only if better than the free Terrarium tiles             |

No OSM or Google link, only a name? Ask for the links; stop if there are none. Ask again whenever OSM misses a road, the surface
change is unknown, or the baked route differs from Google's.

## 2. File what they sent (licence first)

- Copy every file to `sources/maps/<id>/` as `ref-NN-<what>.webp` (ASCII, kebab-case, in the order given; pasted images: the path in
  `[Image: source: ...]`). Never move, never put them in `src/` or `public/`.
- `src/games/rally/maps/<id>/DETAILS.md` (local): one row per file (what, used for) and per URL (what, verified licence). `sources/maps/<id>/PLAN.md`: what we
  build (id, stage, tyre, area, imported, landmarks, look, release), the developer's links verbatim, the route table.

| Source                                                    | Rule                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap / Overpass, Microsoft ML footprints / roads | ODbL, credit "(c) OpenStreetMap contributors"; baked `data.json`, `route.json`, `buildings.csv`, `horizon.json`, `preview/` stay ODbL (map README + `THIRD-PARTY.md`)                                                                   |
| ESA WorldCover, Terrarium tiles, 3DEP, Sentinel-2         | open, credited in `MapDef.sources` (About screen) and the README table, as on the examples                                                                                                                                              |
| Google Maps / Earth / Street View, web photos             | **reference only**: local `sources/`, never copied, never shipped; from a Google link only the start / finish coordinates are used; a traced road part (`trace_route.py`: waypoints only) is disclosed in the README + `THIRD-PARTY.md` |
| Anything else (model, texture, font, dataset)             | must allow redistribution of the file and of derivatives (CC0, CC BY, MIT); unknown = not allowed, ask the orchestrator. No logos, sponsors or brands on signs and banners                                                              |

## 3. Prove the route before building

1. `scripts/realmap/<id>.json` from `vodno.json`: `origin` = centre of the OSM view, `waypoints` = the Google start and finish (+ a
   via on every spot where the shortest OSM path leaves the developer's road), extents from the box.
2. `python -X utf8 scripts/realmap/bake.py scripts/realmap/<id>.json --preview` (numpy, scipy, Pillow, opencv-python; Overpass needs
   `curl` and an unsandboxed shell). Output of trial runs: `sources/maps/<id>/trial-bake/`.
3. Report: route length vs Google's, control points, min corner radius, closest approach, bridges, junctions, height profile every
   250 m; the `--preview` image; the route drawn over **their** screenshot. A missing road: `trace_route.py`, then ask for close-up crops.
4. Wait for "yes, that is the road".

## 4. Build to the standard

Folder `src/games/rally/maps/<id>/` (copy `maps/test/` or the closest example): `info.ts` (menus, bounds, environment, `stageNumber`,
`sources`), `stages.ts` (id, name, `tyre`, `year`, `timing`, `closures`, `cornerFans`, `temps` for every season and time slot), `map.ts`
(the world), baked `data.json` / `route.json` / `buildings.csv` / `horizon.json` / `preview/`, `README.md`, `DETAILS.md` + `TODO.md`
(local). Then:

- register in `maps/index.ts` (`ENTRIES`; lazy-loaded `map.ts`, rally `DETAILS.md` "Lazy loading");
- **`STAGES_LIST` entry with `hideInProd: true`** (`release.ts`), `STAGE_TIMES_VERSIONS[<stage>] = 1` (`game/stage.ts`);
- `integration-tests/rally/stage-<id>.test.ts` (`describeStages`), the map in `integration-tests/rally/tyres.test.ts`;
- a row in the "Maps" table of `src/games/rally/TASKS.md`, open work in `maps/<id>/TODO.md`;
- credits: `MapDef.sources` / `credits: data.meta.sources`, README table, `THIRD-PARTY.md`.

Every other road meeting the stage road is joined and closed with barriers (junction rule), real data first: check the DEM and OSM
against the pictures before hand-tuning anything.

## 5. Verify, and ask for eyes

- `npm run test -- tests/rally/world.test.ts`, `release.test.ts`, `side-roads`, `water`, `junctions`; then `npx rstest integration-tests/rally/stage-<id>.test.ts`.
- Map viewer `/games/rally/map-viewer.html?map=<id>&stage=<id>` (a click shows lat / lon and Google Maps / Street View links: use them to
  compare with the developer's pictures), drive `/games/rally/?stage=<id>&spawn=<m>&mute=1`.
- Send the developer review shots and camera links; ask for a Street View of anything that looks wrong. Review shots go to
  `sources/maps/<id>/review/`, never `src/games/rally/screenshots/`.
- Do not bake the stage card unless asked (rally-maps "Verify" 6).

## 6. Hand over

README (about 60 lines: what it is, 1-4 in-game screenshots, how to run, credits table, licence), `DETAILS.md` (every source and the exact
bake commands), `TODO.md`. Screenshots last: 16:9 jpg, 1280-1536 px, taken in game, no HUD. The stage stays `hideInProd` until the orchestrator
says release. PR description: short, which stage is new, no times bump.
