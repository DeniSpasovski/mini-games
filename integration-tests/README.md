# Integration tests (slow playtests)

Whole-game simulations that take minutes: autopilot drives, car x tyre x set-up matrices, bot balance playthroughs.
Everything fast (unit, data and content checks) stays in `tests/`.

| Folder                      | What                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `integration-tests/rally/`  | `stage` (autopilot finishes every map), `car-matrix`, `tyres`, `gearing`, `handling`         |
| `integration-tests/hole/`   | `city-movers` (traffic / walkers over time), `balance` (good bot on every map)               |
| `integration-tests/kabooom/` | `bots` (200 headless bot-only rounds per difficulty: end in time, no suicides, no idle bots) |

Commands: `npm run test:integration` (all) · `:rally` · `:hole` · `:kabooom`. `npm run test` skips this folder.
Rules for adding tests and how CI runs them: `.claude/skills/testing/SKILL.md`.
