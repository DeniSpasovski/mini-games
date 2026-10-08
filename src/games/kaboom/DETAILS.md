# 3, 2, 1 Kabooom - details

> **Status:** playable end to end (menus, bots, HUD, touch / keyboard / gamepad, audio, sudden death); polish and a real-device
> pass remain (`TASKS.md`, local).
> **Unlisted on the portal** (`hideInProd` in `game.json`): the release build still builds it, so `games/kaboom/` plays
> for anyone with the link; the portal card shows on the dev server and in `npm run build:test` only. Remove the flag to release.

An arena game in a tilted 3D view: you and up to 7 bots walk a grid, place TNT, blow up crates and each other. The last
one standing wins the round. three.js, procedural art only (no model / texture / sound files).

## Pillars

1. **60+ FPS even in a 40-TNT chain.** Explosion cost is flat: pooled instanced FX, no per-blast meshes, lights,
   materials or allocations. Every feature names its frame cost.
2. **Readable at a glance.** The camera tilt, the colours and the flame shapes show who, where and when. Danger is
   always visible (TNT count, flame tiles, fuse sparks).
3. **Our own look.** Original characters, art, sounds and level layouts, all procedural; no third-party files. See "Style".
4. **Short loop.** Pick bots, map size, go. Rounds of about 2 minutes; best of 3 by default.

## Style

**Look: "clay diorama".** Each arena is a stepped slab floating in a sky gradient with drifting clouds; the sides show
sand / ochre / rock layers and stalactites. Rounded blocks, matte grain over Lambert shading, warm key light + cool fill,
one soft static sun shadow. Deliberately different from Hole Island's sharp blocky toys.

**Blasts** (`render/fx/`): soft camera-facing fire puffs from one generated noise flipbook (`fx/puff-atlas.ts`) that grow,
swirl, rise and cool from white-hot to deep red, overlapping into a roaring jet along each arm (`fx/flames.ts`); a white
flash, a shockwave ring over the floor, spark streaks, a skirt of dust, wood splinters, a column of smoke that lingers
about 2 s and a scorch mark that fades over 6 s. Fire blends premultiplied and mostly additive (it glows but keeps some
body); deep in a chain the extras thin out so the screen never drowns in smoke.

**Cast: "the Boom Crew"** - 8 furry animal demolition workers (`render/critters.ts`), each its own build so they read
apart by silhouette: Otter (tallest, slim, thick tail), Raccoon (tall and lean, mask, ringed tail), Beaver (pear-shaped,
paddle tail), Capybara (barrel, long blunt head), Badger (low and broad, wedge head, striped face), Mole (short, wide,
neckless, star nose, spade hands), Hedgehog (small, round, quills), Armadillo (hunched under a banded shell). Visual only:
every critter stands on the same footprint and has the same hitbox. Built from a kit: a turned torso profile, ellipsoids,
tapered limbs, eyes and ears placed on the head surface. **Fur** (`render/fur.ts`): shell fur, the furry parts redrawn in
shells by one instanced draw, as many as the critter's size on screen is worth (`shellsFor` in the fur mesh's
`onBeforeRender`: about 5 on the whole-arena view, up to `FUR_SHELLS` = 14 high / 7 low close up); hairs from a 3D strand
pattern in critter space (no UVs), darker roots, lighter tips, a rim sheen, gravity and a lag behind the waddle. Every
part has a fur length (velvet mole .. shaggy raccoon); bald parts (eyes, noses, teeth, claws, quills, shells) and the
gear clear the fur around them; patterns (raccoon mask, badger face, otter chest) are painted into the fur colour. Team
colour = hard hat (ribbed dome, rolled brim, front peak) + hi-vis vest (open front, straps, hems, pockets, silver
reflective stripes that keep their colour: `aPlain`) (`render/crew-parts.ts`, `TEAM_COLORS`); both are shared instanced
meshes placed per critter by its fit (`hatY` / `hatZ` / `hatScale` / `hatTilt`, `vest`, `feet`). Animated by code
(`render/characters.ts`): waddle + bob, squash when placing TNT, hop when winning. A KO is family friendly: the critter
shrinks into a puff of dust and stars, the hard hat bounces away, and the sooty critter sits dazed on the slab edge.

**Power-ups** (`render/items.ts`, models in `crew-parts.ts`): _more dynamites_ = two full dynamite bundles on a cyan
pad, _more sticks_ = one fat bundle of seven sticks tied with a golden band on a gold pad. They hover, spin and pop in
when a crate breaks; the HUD shows the stock as dynamite (`game/icons.ts`): one stick per TNT you can hold (lit = ready,
faded = out on the field) and the blast level as a bundle of 1-5 sticks (flames either side at 4 and 5, the corner
levels), and pops the one that grew.

**TNT = "the counter".** As many paper sticks as its blast level: 1 at level 1 ... 5 at level 5, so you can read how far a
TNT will reach (`TNT_LAYOUTS` in `crew-parts.ts`; all five in one geometry, each TNT shows its own: `aLevel` in
`tnt.ts`). Sticks (`stickPaperTexture` in `render/tnt.ts`: red wrap with fibres, a spiral seam,
printed rings, waxed ends; generated, shared with the pickups) with crimped caps, two turns of twine, a paper label with
hazard-stripe borders showing **3 -> 2 -> 1** (digit atlas, picked per instance in the vertex shader) and a curling fuse
(`fusePoint`) the spark rides down in a soft glow; it pulses faster and blinks white-hot in the last half second.
A comic **KABOOOM!** / **BOOM!** / **KA-POW!** word pops over blasts (throttled).

**Readability**: slate-blue pillars, grey-brown boulders, warm wood crates and brown dirt mounds are four distinct
families; critters are drawn 14 % bigger than their hitbox; a bobbing arrow in the team colour marks the human; self-lit
clouds.

**Map 1: Quarry.** Sandstone tiles; hard blocks = granite boulders / timber-propped pillars; breakables = wooden crates and
dirt mounds; decor on the slab margin: mine-cart rails with a cart, barrels, rocks, lantern posts.

## Rules (`sim/rules.ts` holds every number)

| Item          | Value                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players       | you (slot 0) + 1-7 bots; bot difficulty easy / normal / hard                                                                                                                                                                                                                                                                                                                                         |
| Start stats   | 1 TNT at a time, blast range 2 tiles, base speed 4 tiles/s                                                                                                                                                                                                                                                                                                                                           |
| Fuse          | per difficulty (`FUSE_BY_DIFFICULTY`): Easy 3 s, Normal / Hard 2 s, the band always counts 3-2-1 across it; a blast that reaches TNT sets it off 0.08 s later, so a chain spreads over frames                                                                                                                                                                                                        |
| Blast         | cross shape; an arm stops before a hard block, breaks the first crate and stops, stops at the first TNT it hits; from level 4 (range 5) each arm also turns the first corner it passes (an open side), at level 5 the first two, each branch `CORNER_REACH` = 2 cells and stopping the same way (`walkBlast` in `sim/blast.ts`: the one rule the sim, the bots' danger map and the map checks share) |
| Flames        | stay 0.5 s; a player whose cell burns is KO (credit = the TNT's owner)                                                                                                                                                                                                                                                                                                                               |
| TNT collision | solid, except for players whose hitbox overlapped it when it was placed (until they leave it)                                                                                                                                                                                                                                                                                                        |
| Movement      | one axis at a time; cornering assist slides a player into the free lane past a wall corner                                                                                                                                                                                                                                                                                                           |
| Round         | 3 s countdown; last player standing wins; all KO in one tick = draw                                                                                                                                                                                                                                                                                                                                  |
| Sudden death  | from 70 s a wall lands every 0.3 s in a spiral from the edge (faster on big arenas, done by 117 s): it flattens crates, removes TNT, knocks out whoever stands under it; 120 s = draw as a safety net                                                                                                                                                                                                |
| Match         | best of 1 / 3 / 5: first to the majority, or all rounds played; a draw gives no point                                                                                                                                                                                                                                                                                                                |
| Power-ups     | two kinds, levels 1-5, hidden in crates: **more dynamites** (+1 TNT out at once, max 5) and **more sticks** (+1 blast range, max 6); 5 per player each round, one in a crate close to every player; maxing both takes 8, so 3 must come from other players' crates; flames do not destroy them; walls do                                                                                             |

## Maps

- **Grid**: hard border, hard pillars on every (even, even) cell, the rest crate or empty. Odd sizes.

  | Size   | Cells (w x h incl. border) | Players |
  | ------ | -------------------------- | ------- |
  | Small  | 13 x 11                    | 2-4     |
  | Medium | 17 x 13                    | 2-6     |
  | Large  | 23 x 17                    | 2-8     |

- **Generator** (`map/generate.ts`, seeded, `matchMapFactory` = `seed + round`): ~70 % crates, decided for one quadrant
  and **mirrored across both axes**, so every spawn sees the same arena. The layout does not depend on the player count.
- **Spawns** (`map/spawns.ts`): top-left, bottom-right, top-right, bottom-left, then the edge middles.
- **Spawn safety (hard rule, tested)**: each spawn keeps a cleared zone: the spawn, 2 cells along each border it touches
  and the free cells beside them (for spawn (1,1) that is the L plus the **hiding pockets** (3,2) and (2,3); the L alone
  would burn completely under a range-2 blast). `map/safety.ts` proves per spawn, with start stats:
  1. a TNT dropped on the spawn leaves a cell outside the blast reachable within the shortest fuse (`MIN_FUSE_S`) minus 0.5 s reaction time, so every difficulty is safe;
  2. some cell within 4 steps has a TNT that hits a crate and passes check 1.

  A failing spawn is repaired (nearest crate and its mirror images cleared) and re-checked; `tests/kaboom/map.test.ts`
  sweeps 1000 seeds x 3 sizes x every spawn.

## Camera

Perspective, FOV 30 deg, pitch 58 deg, fixed yaw (looking north, grid +y = screen down): a tilted diorama.
`CameraRig.fitView` frames the whole slab (bisecting the distance on the real projection of its corners) for Small and
Medium arenas on a landscape screen; for Large arenas and portrait phones it frames a window of about 14 x 11 cells (9 x 13 in
portrait) that `followTo` moves with the human, clamped at the slab edge. `Shake` (one capped trauma accumulator) is added on top.

## Game flow (`game/kaboom-game.ts`)

`menu` (a bot-only match plays behind the cards, on the arena size picked in the setup) -> `loading` (`WorldView.warmUp` behind a card) -> countdown 3-2-1-GO -> `play`
-> round banner (2.8 s) -> next round ... -> `results`; `paused` from the pause button / Esc / P / gamepad Start / the page going to
the background. While the human is out and the round is still on, the sim runs at 2x ("watching the bots").

- **Background match**: it fills every spawn and benches the bots beyond the picked count (`Sim.setPresent`: state `out`). The
  bot stepper flies bots in from the sky / launches them away (`Crew` animates the state change), the colour picker
  recolours in place (`Sim.setTeamColor`); only another arena size rebuilds the scene.
- **Menus** (`game/menu.ts`): welcome, setup (one live critter turning on a stage in the team colour with arrows to flip through: `render/critter-preview.ts`,
  its own small renderer while the card is up, a portrait without WebGL; team colour, arena, bots 1-7 limited by the arena, bot skill, rounds), how
  to play, options (volume, graphics: Auto / Low / High, reloads), pause, match results. An **All games** button appears when
  `portalUrl()` is not null.
- **HUD** (`game/hud.ts`): a chip per player (portrait, team colour, round wins, out), timer (blinks in sudden death), round,
  pause, TNT stock and blast level as dynamite icons, centre banners; it only touches the DOM when something changes.
- **Input** (`game/input.ts`, maths in `input-map.ts`): WASD / arrows + Space / Enter / E, a gamepad (left stick / d-pad +
  A), and on touch a floating stick anywhere + a big TNT button on the right. Placing is edge-triggered (one press = one TNT).
- **Audio** (`game/audio.ts`): procedural WebAudio, silent with `?mute=1`; at most 4 blast voices, blasts within 50 ms merge.
- **Settings / stats** (`game/settings.ts`, `storage.ts`): last setup, volume, quality and win counts in localStorage
  (`kaboom.settings`, `kaboom.stats`), every access in try / catch with an in-memory fallback.
- **Analytics**: `level_start` / `level_end` (see the root `DETAILS.md`); none for autopilot (`bot=1`) or fixed-seed (`seed=`) runs.
- **URL params** (play): any of `play=1`, `size=s|m|l`, `bots=1-7`, `difficulty=easy|normal|hard`, `rounds=1|3|5`, `critter=<id>`
  skips the menu; also `seed=<n>`, `bot=1` (autopilot), `debug=1` (stats), `quality=low|high`, `mute=1`.

## Bots (`sim/bot.ts`)

The bots go for **you**: other bots are worth little to them (`botWeight`), the human a lot (`humanWeight`). Every
`thinkS` seconds (staggered per bot) a bot plans on the shared `DangerMap`: **flee** to the nearest cell that is safe for
good (a goal it already runs to wins ties, so it never dithers between two exits), else **trap** a nearby enemy who would have
no way out of the blast while it can still get away, else drop TNT where it hits crates or enemies **and** a way out exists
(checked with the new TNT added to the danger map), else walk to the best such spot, else approach the nearest enemy or roam.
Paths are breadth-first over free cells and time-aware (a cell is entered only when it is not burning while the bot is in it);
target cells are never in a blast that is already due; every decision starts from a fresh path. Difficulty only changes
`BOT_PARAMS`: think time, blunder chance (a short random walk towards safe cells), how much the human is worth and how
far away they are chased (Easy only comes for you when you are close and mostly farms crates), whether it drops TNT
beside you to cut your escape (`pressure`), traps you in corridors (`trap`) and aims where you are heading (`lead`,
Hard), safety margin (a shorter fuse asks for more escape room before placing: `SLACK_PER_S`), how early it flees.
`integration-tests/kaboom/bots.test.ts` plays 200 headless rounds per difficulty (rounds end in time, nobody idles, few
suicides) and checks that harder bots catch an idle or wandering human more often and sooner.

## Performance (the main risk of this genre)

What usually kills FPS in these games, and our rule for each:

| Cause                                 | Rule                                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New mesh / material / light per blast | Never. Fixed pools created at load; a blast writes a few attribute slots.                                                                                                                                                  |
| Dynamic point lights                  | None. **Glow grid** (`fx/glow-grid.ts`): a w x h texture of flame heat sampled by the floor and block shaders. Any number of blasts = one tiny upload.                                                                     |
| CPU particle updates                  | **GPU particles** (`fx/particles.ts`): ring buffer per kind (fire, smoke, dust, splinter, spark, flash, ring, scorch), motion / size / colour / death in the vertex shader from one clock. Only ever-used slots are drawn. |
| Flame meshes per blast                | `fx/flames.ts`: one InstancedMesh, a ring-buffer slot per burning tile (three puff quads), animated in the shader.                                                                                                         |
| Fur                                   | Shells are one instanced draw per critter; the fur geometry keeps only triangles that grow hair (none under the vest).                                                                                                     |
| Shader compile + upload hitch         | `WorldView.warmUp`: `compileAsync`, then one frame with every pool primed (`Fx.prime`) and the first shadow draw.                                                                                                          |
| Shadow map redrawn every frame        | Static sun shadow (`shadowMap.autoUpdate = false`), redrawn when a crate breaks but at most every 0.15 s (`WorldView.takeShadowUpdate`); movers use `BlobShadows`.                                                         |
| Chain resolved in one frame           | The sim spreads a chain over the 0.08 s chain delay; blasts only set fuses, never explode each other inside one tick.                                                                                                      |
| Block removal rebuilding geometry     | One InstancedMesh per crate variant; removal swaps with the last instance and shrinks `count`.                                                                                                                             |
| Hitch at a round change               | A new round builds a new `Arena`, but its merged geometry, the grain texture and the sun (with its 2048 shadow map) are shared module-level, so it costs well under a millisecond.                                         |
| Draw calls                            | Arena ~11, crew bodies + fur + 3 shared (hats / vests / feet) + the you-arrow, TNT 3, blob shadows 1, FX 10 (budget below).                                                                                                |
| Garbage collection                    | Sim state in preallocated typed arrays; events are pooled objects in a reused array; render code allocates nothing per frame.                                                                                              |
| Audio                                 | Max 4 blast voices; blasts within 50 ms merge; procedural WebAudio.                                                                                                                                                        |

**Budgets**: draw calls <= 60, frame <= 4 ms on desktop / <= 12 ms on a mid phone in the stress scenes, sim tick worst case
< 0.5 ms. Checked by the bench page (`__kaboomBench.run(scene, frames)`: avg / p95 / worst, sim time, draw calls, slowest
frames; scenes `chain40`, `grid-all`, `8bots` = two minutes of eight hard bots) and by `tests/kaboom/` (sim tick time, draw-call
count in a 40-TNT chain, pools never overflow). Quality `low | high`: low has no shadow map and a lower pixel ratio (Auto picks
Low on small touch screens; low also halves the fur shells). Triangle counts per part: `__kaboomBench.triangles()`.

## Architecture

Same split as Hole Island: DOM-free `sim/` + `map/` (tested in node), three.js `render/`, glue in `game/`.

```
src/games/kaboom/
  game.json  README.md  DETAILS.md  TASKS.md (local)  thumbnail.jpg  screenshots/
  sim/     types.ts rules.ts grid.ts (the contract)  state.ts movement.ts blast.ts sim.ts danger.ts bot.ts powerups.ts
  map/     sizes.ts blank.ts generate.ts spawns.ts safety.ts styles.ts
  render/  renderer.ts camera-rig.ts materials.ts parts.ts arena.ts critters.ts fur.ts crew-parts.ts characters.ts tnt.ts
           shadows.ts portraits.ts critter-preview.ts items.ts world-view.ts
           fx/ glow-grid.ts puff-atlas.ts particles.ts flames.ts word-burst.ts shake.ts fx.ts
  game/    kaboom-game.ts menu.ts hud.ts icons.ts input.ts input-map.ts audio.ts settings.ts storage.ts dom.ts ios.ts
           kaboom.css
  debug/   viewer-shell.ts
  pages/   play.ts map-viewer.ts crew-viewer.ts bench.ts
```

- **Fixed step**: sim at 60 Hz, render interpolates positions with `alpha` (pattern: `src/games/rally/game/rally-game.ts`).
- **Contract** (`sim/types.ts`, `rules.ts`, `grid.ts`; change only in a small change of its own): `Terrain` (empty / hard /
  crate; TNT and flames are sim state), `MapData` (typed arrays, `idx = y * w + x`), `MatchConfig`, `PlayerInput`,
  `PlayerView` / `TntView` (read-only views with the previous position for interpolation), `KaboomSim` and the
  `SimEvent`s the renderer and audio consume: `tntPlaced`, `tntExploded { x, y, arms, chainDepth }`, `blockBroken`,
  `blockFell`, `itemAppeared`, `itemTaken`, `playerKo`, `roundOver`, `matchOver`. `PlayerView.color` = team colour (the human's from `MatchConfig.color`, the bots take
  the others); state `out` = benched. Render never writes sim state. World mapping: the grid is centred on
  the origin, 1 cell = 1 m, grid `y` = world Z.
- **Sim** (`sim/sim.ts`): `new Sim(config, makeMap, { countdown })`; `tick(inputs)` returns a reused event array (pooled
  event objects); `nextRound()`; `plantTnt(x, y, owner, range, fuse)` places TNT for scenarios, tests and the bench;
  `upcomingFalls(horizon, cells, secs)` announces sudden-death walls. Deterministic for the same config, map factory and inputs.
- **Power-ups** (`sim/powerups.ts`, numbers in Rules): `assignPowerUps` decides at round start which crates hide what
  (seeded: same match = same drops; the close one is picked among the nearest three crates `CLOSE_MIN_STEPS` ..
  `CLOSE_MAX_STEPS` from a spawn). A broken crate drops its item (`itemAppeared`); walking onto it takes it (`itemTaken`)
  unless that kind is at `MAX_POWER_LEVEL`, then it stays for others. Bots fetch the ones they can still use
  (`itemRange` per difficulty).
- **Danger map** (`sim/danger.ts`): per cell the time until it starts burning and when it ends, following chains in time
  order and crates cleared by earlier blasts, plus walls about to fall; can add a hypothetical TNT. Used by the bots and the map viewer.
- **WorldView** (`render/world-view.ts`) builds everything on screen from a `KaboomSim`: arena, crew, TNT, blob shadows, FX,
  glow grid, camera (fit or follow). Drive it with `onEvents(sim.tick(...))`, `update(alpha, dt)`, `render(renderer)`. A new map
  (new round) is picked up automatically. The game and the bench page use it the same way.
- **Portraits** (`render/portraits.ts`): `PortraitStudio.get(critter, color)` draws a critter in a team colour with the
  game's renderer into an offscreen target on first use, framed by its own height, and caches the PNG (HUD chips, results,
  the picker without WebGL).

## Pages

| Page        | URL                                                                  | Notes                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play        | `/games/kaboom/`                                                     | menus; URL params above                                                                                                                                                          |
| Map viewer  | `/games/kaboom/map-viewer.html?size=m&seed=1&overlay=escape&spawn=2` | regenerate; overlays: spawn zones, escape (TNT on a spawn), danger map, power-ups (the crates hiding them); safety result                                                        |
| Crew viewer | `/games/kaboom/crew-viewer.html?critter=mole&anim=walk&blast=1`      | one critter or all eight; idle / walk / place / ko / cheer; TNT (`view=tnt` = close-up); both power-ups; a looping blast of any level (`blastLevel=5`; `blastAt=0.2` freezes it) |
| Bench       | `/games/kaboom/bench.html?scene=chain40`                             | `chain40`, `grid-all`, `8bots`; live or `__kaboomBench.run`; dev, link hidden in prod                                                                                            |

Debug hooks (the browser pane throttles frames, so these step the scene): `__kaboom.advance(s)` / `.benchmark()` /
`.screenshot(name)` (play; the last saves `screenshots/<name>.jpg` through the dev server), `__crew.advance(s)` (crew viewer),
`__kaboomBench.advance(s)` / `.triangles()` (bench).
