# AGENTS.md

## Commands

- `npm run dev` - dev server (http://localhost:3000)
- `npm run dev:noreload` - same without HMR (file edits by other sessions / tools never reload the page): debugging, benchmarks,
  stage-card bakes. Reload by hand. Browser pane: `portal-dev-noreload`.
- `npm run build` - production build, one self-contained `dist/games/<id>/` per game (`DETAILS.md` -> Deploying);
  `npm run build -- --environment <id>` rebuilds one game (`portal` = portal files only)
- `npm run build:test` - same, but the TEST cars / maps (`release.ts`) ship too (the Pages workflow's default)
- `npm run preview` - preview the build
- `npm run test` (rstest, fast `tests/` only; per game: `test:rally` / `test:hole` / `test:kaboom`) · `npm run test:integration` (slow playtests in `integration-tests/<game>/`) · `npm run test:watch` · `npm run lint` (rslint) · `npm run format` (Prettier)
- `npx tsc --noEmit -p tsconfig.json` - type check (the build does not)

## Public repo and licences - read before adding anything

**Public, source-available repo** (educational three.js project, not commercial): treat every committed file as published.

- **Licences:** code, procedural assets, docs, screenshots = [PolyForm Noncommercial 1.0.0](LICENSE). Baked real-map data
  (`maps/<id>/` `data.json`, `route.json`, `horizon.json`, `junction*.json`, `buildings.csv`, `preview/stage-card.json` + `.jpg`)
  is OpenStreetMap-derived = **ODbL**; a new baked file joins this list (README, `THIRD-PARTY.md`). Third-party models / data keep
  their own licences.
- **Never commit a third-party file** (model, texture, font, sound, image, dataset) unless its licence allows redistribution of
  the file AND of derivatives (CC0, CC BY, CC BY-SA, MIT ...). "Personal use only", "Standard Digital File License" (MakerWorld /
  Printables default), no-derivatives and non-commercial files stay out of git and `public/`. Converted models are derivatives.
  Unknown licence = NOT allowed; ask the user.
- **Every external source gets a row** in the car / map README credits table (public) and its `DETAILS.md` (local,
  git-ignored) and, if it ships, in `THIRD-PARTY.md` + `public/models/CREDITS.md`. Keep CC BY / ODbL attribution current in
  the `credit` / `meta.sources` strings and the About links (`info.ts`).
- **Reference material** (Maps / Street View screenshots, photos, blueprints, press images): local-only in `sources/`
  (git-ignored); never copy or ship it. Trace only from OpenStreetMap-compatible imagery (`trace_route.py` on a route
  screenshot = waypoints only) and disclose any tracing in the map README + `THIRD-PARTY.md`.
- **No trademarks:** no manufacturer, sponsor, series or agency logos / wordmarks in liveries, signs or decals; generic names.
  Car makes / models only identify the car (trademark note in `THIRD-PARTY.md`).
- **No secrets or personal data** in code, docs or history. Publish from this folder only, never the parent monorepo.
- A source or licence change updates `DETAILS.md`, the README, `THIRD-PARTY.md`, `public/models/CREDITS.md` and the in-game
  credits in the same change.

## Documentation

Each level has a short **`README.md`** (what it is, 1-4 in-game screenshots, how to run, credits + licence, links) and a
**`DETAILS.md`** with the rest (architecture, flows, URLs, build notes, sources; optional for a small car). Detail moves down
into `DETAILS.md`, never up.

| Level                         | `README.md`                                 | `DETAILS.md` / other docs                                                                                                                |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| root                          | purpose, games, quick start, licence        | portal layout, domain lock, analytics, PWA, deploying; `THIRD-PARTY.md`                                                                  |
| `src/games/<id>/`             | overview, screenshots, stages / cars tables | rules, flows, architecture, debug tools; `TASKS.md`; rally `PHYSICS.md`; hole `TOY-STORE.md`, `ANIMAL-ISLAND.md`, `CONSTRUCTION-SITE.md` |
| `src/games/rally/maps/<id>/`  | route, screenshots, data credits + licences | every source link, bake notes, references; `TODO.md`                                                                                     |
| `src/games/rally/cars/<car>/` | description, screenshots, credits + licence | build notes, rebuild commands, every source; `TODO.md` where present                                                                     |

**Write short** - how things work NOW, for someone who has not seen the session; not a diary.

- README about 60 lines max; a `DETAILS.md` past a few hundred lines gets condensed, not appended to.
- Say each fact once and link to it; name the code (file, function, setting) instead of retelling it.
- Keep: what it is, how to use it, how it is wired, rules that must not break, the reason for a non-obvious decision (one sentence).
- Leave out: history ("was X", rounds, dates - git has it), trial-and-error, bench logs, numbers that rot, trivia, what code /
  tests already state.
- Bullets and tables, lead with the point, 1-2 lines per bullet. When you touch a doc, trim stale or repeated text.
- Open work = short checkboxes in `TASKS.md` / `TODO.md` (local, git-ignored); when done, delete it and document only what changed how things work.
- Update docs (README / DETAILS / skill) in the same change as the behaviour; keep skill links to `DETAILS.md` valid.
- **Screenshots**: `screenshots/` next to the README, taken in game (car / map viewer or game page), 16:9 jpg, 1280-1536 px wide,
  no debug panels; retake when the look changes.

## Project map

- `README.md` / `DETAILS.md` - portal; `THIRD-PARTY.md` - every third-party source + licence status (keep current)
- `src/site.config.ts` - allowed hosts (domain lock), owner, portal tagline
- Games live in `src/games/<id>/`, registered only by `game.json` (auto-discovered). Default engine: three.js.
- Rally: `DETAILS.md` (architecture, URLs, keys, menus, roadmap), `PHYSICS.md` (model, tuning, tyres, suspension), `TASKS.md`
  (open work, local)
- Rally maps: `maps/<id>/` = `info.ts` (menus, credits), `map.ts`, baked data, README; local-only DETAILS (every source) +
  `TODO.md`; `maps/shared/` = format + helpers
- Rally cars: `cars/<car>/` = `<car>.ts`, README, local-only DETAILS (build notes + sources); `cars/shared/` = code for every car
- 3, 2, 1 Kabooom (`src/games/kaboom/`, unlisted via `hideInProd` until released): `DETAILS.md` (rules, bots, architecture, performance, contract in `sim/types.ts`), `TASKS.md` (open work, local)
- Hole Island: `src/games/hole/DETAILS.md` (rules, levels, tiers, catalog, generator, debug, architecture), `TASKS.md`,
  `TOY-STORE.md`, `ANIMAL-ISLAND.md`, `CONSTRUCTION-SITE.md` (map design, roster, open tasks)
- `sources/cars/<car>/`, `sources/maps/<map>/` - files the user shared, git-ignored, never served. Models / data / licence files
  get a row in that folder's `DETAILS.md`; reference photos only in the local `NOTES.md`.
- `scripts/car-model/`: `scan-mesh.py` (run on every new model after the licence gate: split / panel edges / blob),
  `assemble-kit.py` (model kit on a sprue -> one body STL), `segment-stl.py` (labels body parts: seeds, regions, boxes, tubes),
  `stl-to-glb.mjs` (STL -> game GLB with livery-atlas UVs), `stl-wheel-extract.py` + `wheel-stl-to-glb.mjs` (a print model's own
  rim), `chart-probe.py` (atlas chart per triangle, livery debugging), `glb-meshopt.mjs` (the build's GLB compression), `side-profile.mjs` (boxy profile from a GLB: fallback body + street cars)
- `scripts/realmap/`: `bake.py` (OSM roads, land cover, elevation, buildings -> `maps/<id>/data.json`), `overpass.py`,
  `buildings.py`, `msroads.py` (Microsoft road detections), `horizon.py` (`horizon.json`), `plaza_islands.py` (city junction
  `junction.json`), `trace_route.py` (road parts OSM lacks, from a route screenshot), `dem_stream.py` (a stream OSM lacks, from
  the DEM)

## Skills - read before these tasks (`.claude/skills/<name>/SKILL.md`)

- `new-minigame` - add a game to the portal
- `hole-content` - Hole Island item or map
- `rally-maps` - create / edit rally maps, map viewer (bridges / underpasses: its own section)
- `rally-content` - rally assets and cars (procedural builders, LODs, liveries)
- `rally-car-import` - import a 3D car model (LICENCE GATE first; every car gets its boxy `profile.ts`, step 6c; worked
  examples `cars/skoda-rally/`, `cars/bimmer-m3/`)
- `rally-livery` - paint / debug a car livery (worked example `cars/bimmer-m3/`)
- `rally-physics-tuning` - handling changes + regression / autopilot tests
- `testing` - add / move / run tests: `tests/` vs `integration-tests/<game>/`, scripts, the CI jobs
- `source-files` - user shares models / photos / data / links: copy to `sources/`, document in DETAILS

## Conventions

- Determinism: procedural content uses `src/shared/rng.ts` / `noise.ts` with explicit seeds.
- Rendering: never clone geometry / materials per instance; asset library + InstancedMesh.
- Physics (`src/games/rally/physics`, `world/` logic) stays DOM-free so tests run in node.
- Tool pages mirror their state in the URL (`src/shared/url-state.ts`).
- Testing in the browser pane: add `mute=1` to game URLs (`isMutedByUrl()`, every audio class honours it); leave it off only for
  sound fixes (low volume).
- Rally release flags (`src/games/rally/release.ts`): new cars / maps go into `TEST_*` (dev only) first; `AVAILABLE_*` ship.
- Game `version` (`game.json`, `0.x.y`, minor = feature, patch = fix): bump only when the user says we are making a build.
- Rally times versions (`game/stage.ts`): bump `MAP_TIMES_VERSIONS[map]` when a map's road / layout / length / surfaces change, `CAR_TIMES_VERSIONS[car]`
  when that car's handling changes, every car for a shared physics change (livery / model fixes never); a new car / map adds its
  entry (a test checks). Old times stay, listed below the new ones. Say in the PR which versions you bumped.
- Hole Island: scoring changes (points, tiers, bonus, times, map content) bump that map's `MAP_SCORING_VERSIONS` entry
  (`game/scores.ts`; `sim/` changes = every map).

## Docs

- Rsbuild https://rsbuild.rs/llms.txt · Rspack https://rspack.rs/llms.txt · Rstest https://rstest.rs/llms.txt ·
  Rslint https://rslint.rs/llms.txt
