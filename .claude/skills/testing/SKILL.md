---
name: testing
description: Where a test goes (tests/ vs integration-tests/<game>), which npm script runs it and how the seven GitHub Actions jobs map to them. Use when adding, moving or running tests, or editing .github/workflows/ci.yml.
---

# Testing layout

Regular tests are fast (the whole `tests/` folder runs in about a minute); integration tests are slow playtests.

| Kind                                                       | Folder                      | Script                            |
| ---------------------------------------------------------- | --------------------------- | --------------------------------- |
| Unit / data / content checks for rally                     | `tests/rally/`              | `npm run test:rally`              |
| Unit / data / content checks for hole                      | `tests/hole/`               | `npm run test:hole`               |
| Unit / data / content checks for kabooom                    | `tests/kabooom/`             | `npm run test:kabooom`             |
| Portal / shared (analytics, consent, dom, site config ...) | `tests/*.test.ts`           | `npm run test:shared`             |
| Rally playtests                                            | `integration-tests/rally/`  | `npm run test:integration:rally`  |
| Hole playtests                                             | `integration-tests/hole/`   | `npm run test:integration:hole`   |
| Kabooom bot playtests                                       | `integration-tests/kabooom/` | `npm run test:integration:kabooom` |

`npm run test` = every regular test (no integration); `npm run test:integration` = every playtest.

## Which folder?

Decide by what the test does, not only how long it takes. It is an **integration test** when it plays the game
end to end: a full stage with the autopilot, a car x tyre x set-up matrix, a bot playing a whole map, movers simulated
over time. It is a **regular test** when it checks one unit, a data table, a generator's output or a map's content.
Rough guide: over ~10 s for one file after the suite is warm, or minutes of simulated play, goes to `integration-tests/<game>/`.
Split a mixed file: keep the quick checks in `tests/`, move the playtest into its own file. Shared helpers (`handling-harness.ts`)
stay next to the tests that use them. A new game gets its own `tests/<id>/`, `integration-tests/<id>/` and CI jobs.

## CI (`.github/workflows/ci.yml`)

Runs on pull requests and on pushes to `main`, seven parallel jobs: rally tests, rally integration tests, hole tests, kabooom tests, kabooom integration tests,
hole integration tests, and a shared job (type check + lint + `test:shared`). A new script or folder needs a CI step in the
same change, otherwise it silently never runs. Run the matching script before pushing; after touching physics or a map also
run `npm run test:integration:rally`.

## Gotchas

- rstest path filters are substrings: `rstest tests/rally` would also match `integration-tests/rally`, so the regular scripts
  pass `--exclude 'integration-tests/**'`.
- Relative imports are `../../src/...` in both folders (same depth).
- Update the doc / skill links when you move a test (`grep -rn "<test-file>" --include=*.md .`).
