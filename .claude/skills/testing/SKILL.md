---
name: testing
description: Where a test goes (tests/ vs integration-tests/<game>), which npm script runs it and how the nine GitHub Actions jobs map to them. Use when adding, moving or running tests, or editing .github/workflows/ci.yml.
---

# Testing layout

Regular tests are fast (the whole `tests/` folder runs in about a minute); integration tests are slow playtests.

| Kind                                                       | Folder                      | Script                            |
| ---------------------------------------------------------- | --------------------------- | --------------------------------- |
| Unit / data / content checks for rally                     | `tests/rally/`              | `npm run test:rally`              |
| Unit / data / content checks for hole                      | `tests/hole/`               | `npm run test:hole`               |
| Unit / data / content checks for kaboom                    | `tests/kaboom/`             | `npm run test:kaboom`             |
| Portal / shared (analytics, consent, dom, site config ...) | `tests/*.test.ts`           | `npm run test:shared`             |
| Rally playtests                                            | `integration-tests/rally/`  | `npm run test:integration:rally`  |
| Hole playtests                                             | `integration-tests/hole/`   | `npm run test:integration:hole`   |
| Kaboom bot playtests                                       | `integration-tests/kaboom/` | `npm run test:integration:kaboom` |
| Browser smoke (each game's pages, console + WebGL)         | `scripts/smoke.mjs`         | `npm run test:smoke`              |

`npm run test` = every regular test (no integration); `npm run test:integration` = every playtest.

## Which folder?

Decide by what the test does, not only how long it takes. It is an **integration test** when it plays the game
end to end: a full stage with the autopilot, a car x tyre x set-up matrix, a bot playing a whole map, movers simulated
over time. It is a **regular test** when it checks one unit, a data table, a generator's output or a map's content.
Rough guide: over ~10 s for one file after the suite is warm, or minutes of simulated play, goes to `integration-tests/<game>/`.
Split a mixed file: keep the quick checks in `tests/`, move the playtest into its own file. Shared helpers (`handling-harness.ts`)
stay next to the tests that use them. A new game gets its own `tests/<id>/`, `integration-tests/<id>/` and CI jobs.

## CI (`.github/workflows/ci.yml`)

Runs on pull requests and on pushes to `main`, nine jobs (`changes` picks the integration tests, the other eight run in parallel): rally tests, rally integration tests, hole tests, kaboom tests, kaboom integration tests,
hole integration tests, a shared job (type check + lint + `test:shared`) and the browser smoke test (dev server + headless
Chrome on the SwiftShader GPU). A new script or folder needs a CI step in the same change, otherwise it silently never runs.

**Browser smoke** (`npm run test:smoke`, against `npm run dev:noreload`: HMR reloads from other sessions cause false failures;
`--base <url>`, `--stage`, `--car`, `--games rally,hole`, `--dist dist` for a build): drives a rally stage on autopilot, then loads
the rally, Hole Island and Kaboom play / tool pages in a fresh profile, and fails on any console error, exception, WebGL error
or failed same-origin request. `--profile <dir>` (or `SMOKE_PROFILE`) reuses a profile folder. Run it before calling rendering,
shader, loading or viewer work done. CI runs only the affected games' pages and skips it when none is affected (`smoke`
output of `scripts/ci-affected.mjs`).

Integration jobs are selective: `scripts/ci-affected.mjs` (job `changes`) runs only the test files whose import closure contains a
changed file (relative imports and `new URL()` workers, incl. imported assets such as `*.webp` and `*.data.ts`); a game with
none is skipped. Package / test / ts config, workflows or that script run all; pushes to `main` run all; docs run none. Rally per-car playtests (`stage-<map>`, `car-matrix` worst pick) drive
the five representative cars plus the cars a PR changed (`rally_cars` output -> `RALLY_CARS`, `cars-under-test.ts`); pushes to
`main` and local runs drive every car. A playtest file per map lets the maps run side by side (rstest runs files in parallel). Run the matching script before pushing; after touching physics or a map also
run `npm run test:integration:rally`.

## Gotchas

- rstest path filters are substrings: `rstest tests/rally` would also match `integration-tests/rally`, so the regular scripts
  pass `--exclude 'integration-tests/**'`. Session worktrees (`.claude/**`) are excluded in `rstest.config.ts`, but a CLI
  `--exclude` replaces that list: a script or command that passes one adds `--exclude '.claude/**'` too.
- Relative imports are `../../src/...` in both folders (same depth).
- Update the doc / skill links when you move a test (`grep -rn "<test-file>" --include=*.md .`).
