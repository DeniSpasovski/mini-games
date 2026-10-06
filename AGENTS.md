# AGENTS.md

## Commands

- `npm run dev` - Start the dev server (http://localhost:3000)
- `npm run build` - Build the app for production (one self-contained `dist/games/<id>/` per game, see `DETAILS.md` -> Deploying)
- `npm run build -- --environment <id>` - Rebuild only one game's folder (`portal` = only the portal files)
- `npm run preview` - Preview the production build locally
- `npm run test` - Run tests (rstest) · `npm run test:watch`
- `npm run lint` - Lint (rslint) · `npm run format` - Prettier
- `npx tsc --noEmit -p tsconfig.json` - Type check (the build does not type check)

## Public repo and licences - read before adding anything

This is a **public, source-available repository** (educational three.js project, not commercial). Everything committed is
visible and redistributable by anyone, so treat every file as published.

- **Project licence:** code, procedural assets, docs and screenshots = [PolyForm Noncommercial 1.0.0](LICENSE) (noncommercial use,
  modification and sharing allowed; commercial use not). Baked map data (`maps/*/data.json`, `buildings.csv`, `preview/stage-card.json` + its `.jpg` render) is derived from
  OpenStreetMap and stays **ODbL** (attribution + share-alike). Third-party models / data keep their own licences.
- **Never commit a third-party file** (3D model, texture, font, sound, image, dataset) unless its licence explicitly allows
  redistribution of the file AND of derivatives (CC0, CC BY, CC BY-SA, MIT ...). "Personal use only", "Standard Digital File
  License" (MakerWorld / Printables defaults), "no derivatives" and "non-commercial" files must stay out of git and out of
  `public/`. Converted models count as derivatives. When the licence is unknown, treat it as NOT allowed and ask the user.
- **Every external source gets a row** in the matching `DETAILS.md` (link, author, licence, what it was used for)
  and, if it ships, in `THIRD-PARTY.md` + `public/models/CREDITS.md`. CC BY / ODbL need attribution: keep the `credit` /
  `data.meta.sources` strings in the code and the in-game About screen up to date. Never write "TODO" licences into shipped files.
- **Reference material** (Google Maps / Street View screenshots, photos, blueprints, press images) is local-only in `sources/`
  (git-ignored). Do not copy, trace or ship it. Prefer OpenStreetMap-compatible imagery for tracing and record how it was used.
- **No trademarks or real branding:** no manufacturer, sponsor, series or agency logos and wordmarks in liveries, signs or
  decals; use generic names. Car makes / models appear only to identify the car (see the trademark note in `THIRD-PARTY.md`).
- **No secrets or personal data** in code, docs or commit history (keys, tokens, private paths, e-mails). The repo is published
  from this folder only - never from the parent monorepo, whose history holds unrelated projects.
- Docs / README text must stay accurate about licences: if a source or licence changes, update `DETAILS.md`, the short README,
  `THIRD-PARTY.md`, `public/models/CREDITS.md` and the in-game credits in the same change.

## Documentation structure

Every level has a short **`README.md`** (rendered by GitHub: what it is, 1-4 in-game screenshots, how to run, credits and
licence summary, links to deeper docs) and a sibling **`DETAILS.md`** with everything else (architecture, flows, URLs, short build
notes, source links). Keep READMEs high level - move detail into `DETAILS.md`, never the other way round.

| Level                         | `README.md` (high level)                                 | `DETAILS.md` / other docs                                                                                                      |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| root                          | purpose (learning three.js), games, quick start, licence | portal layout, domain lock, analytics, PWA, deploying; `THIRD-PARTY.md` (all third-party sources + licence status)             |
| `src/games/<id>/`             | game overview, screenshots, stages / cars tables         | rules, flows, architecture, debug tools; `TASKS.md` (open work); rally: `PHYSICS.md`; hole: `TOY-STORE.md`, `ANIMAL-ISLAND.md` |
| `src/games/rally/maps/<id>/`  | route, screenshots, data credits + licences              | every source link, bake notes, reference images; `TODO.md` (open work)                                                         |
| `src/games/rally/cars/<car>/` | description, screenshots, credits + licence              | build notes, rebuild commands, every source; `TODO.md` where present                                                           |

**Write short.** Docs describe how things work NOW, for someone who has not seen the session; they are not a diary.

- **Size:** a README fits one screen or two (about 60 lines max). A `DETAILS.md` is a reference, not a log: when it grows past a
  few hundred lines, condense it instead of appending.
- **Say it once:** one fact lives in one place; link to it, do not copy it. Name the code (file, function, setting) instead of
  retelling what the code does.
- **Keep:** what it is, how to use it, how it is wired, the rules that must not be broken, and the reason behind a non-obvious
  decision (one sentence).
- **Leave out:** history ("was X before", "round 4", dated passes - git has it), tuning trial-and-error, bench logs, numbers that
  rot (frame times, triangle counts, per-map tweaks), trivia, and anything the code or a test already states.
- **Shape:** lead with the point, use bullets and tables, short sentences, no filler or hedging; 1-2 lines per bullet.
- **Open work** goes in `TASKS.md` / `TODO.md` as short checkboxes; when finished, delete the item and, only if it changed how
  things work, add a line to the matching doc.
- When you touch a doc, also trim what you pass: stale, repeated or diary-style text goes.

- **Screenshots** live in a `screenshots/` folder next to the README that shows them: taken in game (car / map viewer or the game
  page), 16:9 jpg, about 1280-1536 px wide, no debug panels. Retake them when a car, map or the look changes visibly.
- Finished work is documented in `DETAILS.md` (and the README if it changes the overview); `TASKS.md` / `TODO.md` hold only open
  work. Update the docs in the same change as the behaviour.
- Skills (`.claude/skills/`) and this file point at `DETAILS.md` for detail; keep those links valid when moving or renaming docs.

## Project map

- `README.md` / `DETAILS.md` - portal overview / folder layout, domain lock, analytics, PWA, deploying; `THIRD-PARTY.md` - every third-party source, licence and status (keep current)
- `src/games/rally/DETAILS.md` - rally architecture, URLs, keys, menus (setup screen), roadmap
- `src/games/rally/PHYSICS.md` - rally physics: model, tuning guide, tyre compounds / sizes, suspension set-ups, reference numbers, open physics work
- `src/games/hole/DETAILS.md` - Hole Island (Gravity hole style game, touch-first, three.js): rules, 15 hole levels / 25 size tiers, item catalog, map generator, debug tools, architecture; open work in `src/games/hole/TASKS.md`; second map Toy Emporium (toy store) design, asset roster and open tasks in `src/games/hole/TOY-STORE.md`; third map Animal Island (moving animals, edible hills, rivers, 37 giants, secret zoo + lab) design, roster and open tasks in `src/games/hole/ANIMAL-ISLAND.md`
- Games live in `src/games/<id>/` and are registered only by their `game.json` (build + portal auto-discover).
- Default engine for games: three.js.
- `src/site.config.ts` - allowed hosts (domain lock, runs before every page), owner, portal tagline.
- `src/games/rally/TASKS.md` - open rally tasks + index of every map / car task list; finished work moves into the DETAILS.md files (game / car / map), not this file.
- `src/games/rally/maps/<id>/` - one folder per map (`map.ts`, baked `data.json`, `TODO.md` task list, `README.md` = overview + screenshots + data credits, `DETAILS.md` = every source link / licence / reference used - keep updated); `maps/shared/` = map format + shared helpers.
- `src/games/rally/cars/<car>/` - one folder per car (`<car>.ts` + `README.md` = description + screenshots + credits / licence, `DETAILS.md` = build notes + every source / licence); `cars/shared/` = car code used by every car.
- `sources/cars/<car>/`, `sources/maps/<map>/` - original files the user shared (models, reference photos, data downloads). Git-ignored + never served; each file is listed in the matching code folder's `DETAILS.md`. When the user shares a file for a car / map, copy it here and add the DETAILS row.
- `scripts/car-model/scan-mesh.py` - run on every new car model BEFORE importing (gate in `rally-car-import` step 1, after the **licence gate** - no licence check, no import): already split / real panel edges / blob = abandon.
- `scripts/car-model/assemble-kit.py` - assembles a car printed as a model KIT (parts on a sprue frame) into one oriented body STL (`kit` block of `model.source.json`).
- `scripts/car-model/chart-probe.py` - which atlas chart each body triangle of a car GLB uses (per box / seam / height profile): livery debugging, see `rally-livery`.
- `scripts/car-model/stl-wheel-extract.py` - cuts a print model's own rim out of its source STL (`wheelRim` block: spoke face + lathed lip / barrel) for `wheel-stl-to-glb.mjs` (worked example `cars/bimmer-m3/`).
- `scripts/car-model/stl-to-glb.mjs` - converts an STL body (from `sources/`) into a game GLB with livery-atlas UVs.
- `scripts/realmap/overpass.py` (OSM for dense cities), `scripts/realmap/buildings.py` (footprints, classes, heights) - used by `bake.py`.
- `scripts/realmap/bake.py` - bakes real-world maps (OSM roads, ESA WorldCover, elevation tiles or a local GeoTIFF, building footprints) into `maps/<id>/data.json`; `scripts/realmap/trace_route.py` traces road parts OSM lacks from a route screenshot.

## Skills (workflows) - read before doing these tasks

- `.claude/skills/new-minigame/SKILL.md` - add a new game to the portal
- `.claude/skills/hole-content/SKILL.md` - Hole Island: add an item (catalog row + builder + tests) or a new map (bounds, zones, budget, registry, scores version)
- `.claude/skills/rally-maps/SKILL.md` - create / edit rally maps, verify in the map viewer (bridges / underpasses of city maps: its "Bridges and underpasses" section)
- `.claude/skills/rally-content/SKILL.md` - add / iterate assets and cars (procedural builders, LODs, liveries)
- `.claude/skills/rally-car-import/SKILL.md` - import a 3D car model as a new car (starts with the LICENCE GATE): orient, split parts, convert, materials, livery, verify (checklist + gotchas; worked example `cars/skoda-rally/`)
- `.claude/skills/rally-livery/SKILL.md` - create / change / debug a car's livery (atlas painter, chart seams, panel-line edges, checker grids; camera links, chart tinting, debug grid, `chart-probe.py`, `chartBoxes`, symptom table; worked example `cars/bimmer-m3/`)
- `.claude/skills/rally-physics-tuning/SKILL.md` - change handling, run the regression + autopilot tests
- `.claude/skills/source-files/SKILL.md` - the user shares models / photos / data / links for a car or map: copy to `sources/` (git-ignored), document in that folder's DETAILS.md

## Conventions

- Determinism: all procedural content uses `src/shared/rng.ts` / `noise.ts` with explicit seeds.
- Rendering: never clone geometry/materials per instance; use the asset library + InstancedMesh.
- Physics code (`src/games/rally/physics`, `world/` logic) must stay DOM-free so tests run in node.
- Tool pages mirror their state in the URL (`src/shared/url-state.ts`) so views are shareable.
- Sound while testing: games are silent under `?mute=1` (`src/shared/mute-param.ts`, `isMutedByUrl()`). Whenever a bot opens a game in the browser pane to create / edit / verify something, add `mute=1` to the URL (`/games/rally/?map=x&mute=1`). Leave it off only when the task IS a sound fix (then use `mute=0` / no param, and keep the volume low). Every game's audio class must honour the param; players never see it.
- When behaviour changes, update the relevant README / DETAILS.md / skill in the same change.
- Rally release flags: `src/games/rally/release.ts` tracks every car / map id - `AVAILABLE_CARS` / `AVAILABLE_MAPS` ship in the published build, `TEST_CARS` / `TEST_MAPS` are dev server only (TEST badge). A new car / map goes into `TEST_*` first.
- Game versions: `version` in `src/games/<id>/game.json` (semver, every game stays at `0.x.y`), shown on the game's main menu and About screen. Minor = a new feature, patch = a small fix. Do NOT bump it on your own - only when the user says we are making a build; then bump per feature / fix since the last build.
- Rally: NEVER bump `TIMES_VERSION` in `src/games/rally/game/stage.ts` on your own - saved times are the owner's way to compare changes and players do not care. When physics / handling / time penalties / a map's road change enough that times are no longer comparable, only mention it; bump (which erases saved times) only when the user explicitly says so.
- Hole Island: when scoring logic changes (item points / tiers, clear bonus, difficulty times, map content), bump that map's number in `MAP_SCORING_VERSIONS` (`src/games/hole/game/scores.ts`; shared rules in `sim/` = every map) so its saved high scores are erased. Each map is wiped on its own.

## Docs

- Rsbuild: https://rsbuild.rs/llms.txt
- Rspack: https://rspack.rs/llms.txt
- Rstest: https://rstest.rs/llms.txt
- Rslint: https://rslint.rs/llms.txt
