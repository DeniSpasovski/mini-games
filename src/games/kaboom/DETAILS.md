# 3, 2, 1 Kabooom - details

> **Status:** playable end to end (menus, bots, HUD, touch / keyboard / gamepad, audio, sudden death); polish and a real-device
> pass remain (`TASKS.md`, local).
> **Released** (listed in `GAME_LIST`, `src/portal/release.ts`).

An arena game in a tilted 3D view: you and up to 7 bots walk a grid, place TNT, blow up crates and each other. The last
one standing wins the round. three.js, procedural art (no model or sound files; one small HDRI and one detail tile per level from Poly Haven).

## Pillars

1. **60+ FPS even in a 40-TNT chain.** Explosion cost is flat: pooled instanced FX, no per-blast meshes, lights,
   materials or allocations. Every feature names its frame cost.
2. **Readable at a glance.** The camera tilt, the colours and the flame shapes show who, where and when. Danger is
   always visible (TNT count, flame tiles, fuse sparks).
3. **Our own look.** Original characters, art, sounds and level layouts, all procedural; no third-party model or sound files. The UI fonts, one small CC0 HDRI per level (environment light) and one baked-down CC0 detail tile per level are the only files from elsewhere; models stay reference only. See "Style".
4. **Short loop.** Pick bots, map size, go. Rounds of about 2 minutes; best of 3 by default.

## Style

**The bowl** (Quarry; the other levels: "Levels"): each arena sits on the floor of a rocky bowl, a gladiator arena: a low
wall faced with ashlar (High), four sandstone terraces for the crowd, each riser faced with big cut blocks (High) under a
course of coping stones, scree at
the foot of a banded cliff, then a flat rim with sandstone boulders (`render/bowl.ts`: rings are the floor grown by an offset,
bent by slow noise and carved by finer noise; smooth shading inside each face, hard creases at the step edges, painted per
vertex; one tile of sand margin round the battle zone). Deliberately different from Hole Island's sharp blocky toys.

**Mid-poly stylised** (the art direction): real objects built from their real parts, every edge bevelled, medium-scale detail,
saturated natural colour under soft filmic light; straight true shapes, no bending or swelling.

- **Parts and bevels** (`render/parts.ts`): an object is the pieces it is made of (a pillar is cut stones on a mortar core with
  an iron band and a capstone, the floor is separate flags, a crate is posts, rails, a criss-cross lattice of slats, boards and nails); `bbox` bevels every edge by `BEVEL` (0.04 m), `flagstone` cuts a chamfered
  stone or plank from an outline. Rocks are welded (`smooth`) with cut faces, cracks and a flat base. At most about 1,500
  triangles per block variant on High (a crate about 600: there can be a hundred) (`__kaboomBench.triangles()`); a model may take a lighter Low version (`BlockModel`).
- **Painted look** (`part()`): vertex colours with lighter tops and bevelled edges, warm above and cool below, darker
  undersides, hollows and cracks; no grain texture on the arena. `footShade` darkens every block towards the floor and
  `ContactShade` (`render/shadows.ts`, one instanced draw) lays a soft multiply patch round each block and crate.
- **Detail texture** (`render/detail.ts`, baked by `scripts/kaboom/bake-textures.py`): one grey 512 px tile per level, red =
  the ground (gravelly sand, grass, deck wood), green = the second surface (rock, dry soil, weathered hull paint). The scenery
  material projects it in world space from three sides (no UVs) and scales the paint by it where a vertex asks
  (`aDetail`, `part({ detail })`): the Quarry's margin, terraces, rim, cliff and cut stones, the Valley's meadow,
  margin and turf tiles (a brown dirt tile takes the soil channel: `soil` in `arenaMaterial`), the Sea's decks, hulls and
  rails. The rest of the arena stays untextured paint.
- **Light** (`render/renderer.ts`, `materials.ts`, `environment.ts`): ACES filmic tone mapping; warm sun with one soft static
  shadow, a cool hemisphere fill. High: `MeshStandardMaterial` with the roughness `part()` stores per vertex (`ROUGH`: wood
  0.85, stone 0.75, iron 0.45 ...) and the level's HDRI as environment light (the fill is cut to 36 %); Low: Lambert
  plus a faint cool rim. Each theme sets its sun, fill and `env` strength.

**Crowd** (`render/crowd.ts`): about 250-400 spectators on the terraces, the same eight animals as the crew, drawn as
**sprites**. The camera never turns, so each animal is rendered once with the crew renderer (fur, face, a plain sleeved fan shirt from `fanShirtGeometry`, no hard hat)
from the game camera's pitch into an atlas (8 animals x 4 facings x 8 team colours, 112 px tiles, 72 on low), and a
spectator is one instanced billboard picking its tile: the sprites are one draw call. Tiles are drawn on demand
(`prepare`, from `WorldView.warmUp` / `render`): every colour of the match at load, a new colour later (the colour
picker) one colour = 32 tiles per frame. Shirts only come in the colours of the players in the match (benched
bots do not count): `setPlayers` re-deals them when that set changes. Fans sit in blocks of 3-8 neighbours on one terrace
that share a colour; about half the blocks wave flags (second instanced mesh, one shader draws arm, pole and flag in the
shirt colour, moving with the game clock). Never frozen: everyone breathes and sways, each block cheers on its own slow rhythm (jumping in step), a stadium wave
runs round every terrace every ~34 s, and a blast or a KO makes everyone jump (`excite`, decays in about a second); all
of it is a pure function of the clock in `Crowd.place`. Low quality drops the top terrace and thins the rest. The crowd
steps back so the arena leads (`RECEDE_VERT` / `RECEDE_FRAG`): sprites and flags a touch darker and less saturated than the
crew, rows further from the arena fading a little towards the sky.

**Blasts** (`render/fx/`): soft camera-facing fire puffs from one generated noise flipbook (`fx/puff-atlas.ts`) that grow,
swirl, rise and cool from white-hot to deep red, overlapping into a roaring jet along each arm (`fx/flames.ts`); a white
flash, a shockwave ring over the floor, spark streaks, a skirt of dust, wood splinters, a low ring of dark purple-grey billows
born with the blast that engulf the fireball (the fire glows through them while they are young, strongest underneath),
then a column of them rising (lit on top, darker underneath, shrinking as they thin) that lingers about 2 s and a cracked scorch mark (embers glowing in it for a moment) that fades over 6 s. A
broken crate throws big plank chunks that land, lie still for a second and shrink away, with a ring of dust; an arm that
stops against a hard block throws stone chips and a grey puff back off its face. A KO holds the whole picture still for
70 ms (hit-stop) and flashes a ring in the critter's team colour. The cells where sudden-death walls will land show a
pulsing outline that beats faster, and the wall's shadow growing, as it comes. Fire blends premultiplied and mostly additive (it glows but keeps some
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

**Power-ups** (`render/items.ts`, models in `crew-parts.ts`): _more dynamites_ = a small open wooden crate (planks,
corner posts, rope handles, a cyan stencilled band) with five crimped sticks leaning out, under a cyan plus; _more sticks_
= one tall bundle of seven crimped sticks in two gold straps with a buckle and a fuse, under a gold up arrow (wide and low
vs tall and narrow, cyan vs gold). They hover, spin and pop in when a crate breaks, over a stone plinth whose inlay plate
takes the kind's colour (`aTint`, the instance colour) and a glow ring of that colour (both hidden while nothing lies on
the floor: an empty instanced mesh still costs a draw; `showForCompile` lets `WorldView.warmUp` compile them anyway), and
a ring of that colour flashes over the floor as one appears; the HUD shows the stock as dynamite (`game/icons.ts`): one stick per TNT you can hold (lit = ready,
faded = out on the field) and the blast level as a bundle of 1-5 sticks (flames either side at 4 and 5, the corner
levels), and pops the one that grew.

**TNT = "the counter".** As many paper sticks as its blast level: 1 at level 1 ... 5 at level 5, so you can read how far a
TNT will reach (`TNT_LAYOUTS` in `crew-parts.ts`; all five in one geometry, each TNT shows its own: `aLevel` in
`tnt.ts`). Everything in it samples one generated atlas (`render/dynamite-texture.ts`, shared with the pickups): a
1024 x 512 colour map plus a normal map whose alpha is a roughness multiplier, with regions for the stick wrap (red
paper, wrinkles, sparse creases, a spiral seam, printed rings and a line of print, waxed ends, dust at the foot), the
crimped end seen from above and three twisted rope strands (`ATLAS`, `ropeUV` in `crew-parts.ts`). Sticks are lathed
with rounded shoulders and an eight-fold crimp, a hair apart in height; on High they are physically based. Two turns of
rope with a knot and the paper label hug the bundle's outline (`hullBand`); the label (aged paper, worn hazard stripes,
"DANGER" / warning print, a crinkle normal map) prints **3 -> 2 -> 1** once on the front (uv.x runs round the band in atlas cells, a plain fourth cell elsewhere;
digit picked per instance). The fuse leaves a brass blasting cap, curls forward and frays at its tip (`fusePoint`); the
spark (a star burst with embers, all in its shader) rides down it and the cord behind turns to grey ash (`aFuseT` /
`aBurn`). It pulses faster as it burns and blinks white-hot in the last half second.
A comic **KABOOOM!** / **BOOM!** / **KA-POW!** word pops over blasts (throttled): chunky 3D lettering painted into the word
atlas (`fx/word-burst.ts`: an outline round the block, an extruded side, a bevelled gradient face; Grandstander once loaded).

**Readability**: light flagged floor, mid-value cool stone (blue-grey pillars taller than a crate, grey boulders), warm
breakables (wood crates, terracotta pots with a tall amphora); a hard block never shares the breakables' warm hue; critters are drawn 14 % bigger than their hitbox, hard hats 15 % bigger than
the models fit them, vests glow a little in their own colour, and a warm rim light sets critters and TNT off the floor.
Every critter stands on a ring in its team colour (one instanced draw); the human's ring is thicker and pulses, and a
chunky bevelled arrow (team colour in a white outline) bounces over their head. The 3D view gets a soft vignette and, on
High, a gentle warm grade per level (`.kb-finish`, CSS over the canvas).

**Story props** (one big landmark per level): a timber derrick on the Quarry's back margin with a cut block on its hook,
a whitewashed windmill with turning sails off the Valley's left side, a ship's mast with a furled sail, shrouds and a
pennant at the back of the Sea Deck.

## UI style

Tokens, type, components and rules: [STYLEGUIDE.md](STYLEGUIDE.md) ("Sandstone"). Code: `game/ui-tokens.css` (every colour, the
stone finish and the self-hosted Grandstander / Nunito faces from `assets/fonts/`), `game/kaboom.css` (`var(--kb-*)` only, no
literal colours; the 3D letters rule shared by logo, headings and banners), `game/icons.ts`. One button shape (`.kb-btn`); the HUD
hides under pause and results; setup fits 1280x720 and the action buttons and the version label stay visible at 915x412.

**Finale** (`WorldView.finale`, called from `KaboomGame.endMatch`): the camera pulls back to the whole stand (`dock` shifts the
view clear of the results card), `Arena.clearArea` removes the crates and hard blocks in the middle, a `Podium` (`render/podium.ts`: cut stone courses, a
capstone, a gold / silver / bronze band) rises and `Crew.setPodium` puts the top three on it (the winner hops). `Crowd.cardStunt` lays a board of cards over the far stand
in screen space (`render/card-stunt.ts`: a 5x7 letter bitmap, 9 rows, one instanced mesh, no depth test; text null = every card
lit, two colours for a tie); `refreshStunt` re-lays it after a resize. The results card opens `RESULTS_DELAY_S` (1.2 s) after the
match ends. A round win runs a one-second card wave. Tests: `tests/kaboom/podium.test.ts`, `crowd.test.ts`.

## Levels

A level is a **render theme** (`render/themes/<id>.ts`, the `LevelTheme` type in `theme.ts`). The sim, the map generator, the
bots, the safety checks and `MapData` never see it: layouts, crate ratio and rules are identical, only the look, the sounds and
how a sudden-death cell falls differ. `game/levels.ts` = ids, labels, the banner line; `release.ts` = `LEVELS_LIST`
(all three are released; `offeredLevels()` feeds the setup menu, whose Level row shows
only with more than one level, and `sanitizeSettings`). Pick it in the setup menu (`settings.level`) or with `?level=quarry|valley|sea`
(skips the menu like `size`); the map viewer and the bench take it too.

| Level        | Floor and blocks                                                                                                                                        | Surroundings                                                                                                                                                                                                                                                                                                                             | Sudden death                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Quarry       | sandstone flags; granite boulders / sandstone pillars with a timber brace; wooden crates, clay pots; rails                                              | rocky bowl: ashlar wall, terraces with coping stones, scree, banded cliff, sandstone rim boulders                                                                                                                                                                                                                                        | a wall lands                    |
| Green Valley | turf tiles mown in stripes along the rows, tufts, dirt patches; mossy boulders / cairns; apple crates, round hay bales; stream, fence, cart             | a hedge of rounded bushes on a stone footing, a meadow with lush / dry patches, grass clumps and drifts of wildflowers (baked into the meadow's draw), the crowd in three rows on it, groves of spruces and oaks (leaf clusters) close behind, its own sky; the stream on the front margin has a wet bed, stones, reeds and a footbridge | a boulder lands                 |
| Sea Deck     | plank tiles on a raft; painted iron bollards (rope coil) / capstans (whelps, bar sockets); cargo barrels, tarp-lashed cargo; ropes, lanterns, lifebuoys | open sea (`render/sea.ts`, below), the crowd on moored barges (`render/boats.ts`: planked hulls and transoms, plank decks, rub rails, a railing with a lifebuoy, tyre fenders, a mast with stays and a pennant), a bobbing raft                                                                                                          | the tile sinks (`fall: 'tile'`) |

- **What a theme holds**: sky, light, `fx` tint (dust / splinter / scorch colours as uniforms of the shared particle shaders), warning colour,
  `fall`, tile / hard-block / crate / floor / decor geometry, `scenery` (static things: bowl, water, boats, trees; `update`, `ripple`,
  `dispose`), `crowd` (`CrowdLayout`: ring, height, optional `tiers` / `rowD` / `fill` / `seat` mask) and an optional `motion` (the platform's bob).
  `Arena.group` is the platform, `Arena.scenery` stays put. Geometry is built once per page (`themes/cache.ts`), never per instance or round.
- **Sea Deck sudden death** reuses `blockFell`: `Arena.sinkTile` shakes the tile `SINK_DELAY_S` = 0.2 s, drops and tilts it, scales it
  away under the water; the splash (`Fx.splash`, `Sea.ripple`) comes `TILE_SPLASH_S` = 0.6 s after the event. A crate on the cell
  rides down; a critter KO'd on a sunk cell (`Arena.isSunk`) gets a splash, not dust and stars. The sim already treats the cell as hard.
- **The sea** (`render/sea.ts`, one shader plane, no tiling texture): three long swells move the vertices; six shorter chop waves
  (fanned round `WIND`, uneven wavelengths, on a noise-warped grid, faded where a pixel is wider than the wave) only bend the normals.
  Fresnel mixes the water colour with the sky's reflection (the level's sky colours; on High the level's HDRI once it has loaded,
  `Sea.mesh.onBeforeRender`). `contactField` bakes the distance to the raft and every hull (`fleetOutlines`) into a small R8 texture
  once per raft size: the water is lighter teal near the fleet, darker in a band against the wood, calmer there, and foam breaks along
  every hull and the raft's edge; wavelets lap outwards (High). Slow noise patches vary the chop and the colour far out.
- **Sounds** (`game/audio.ts`): `Sfx.level` picks the ambience (birds in the valley, a gull and water on the sea) and the fall sound
  (`splash` on the sea). The sudden-death banner's second line is `LEVELS[id].closing`.
- **Budgets hold per level**: draw calls <= 60 in the 40-TNT chain, the arena a handful (`tests/kaboom/levels.test.ts` checks every theme).
  Low quality: a coarser water plane with half the chop, no sun glint, HDRI or lapping wavelets, no bob, fewer trees and one row less of spectators.
- **New level**: add the id to `LEVEL_IDS` / `LEVELS`, a `LEVELS_LIST` entry (`hideInProd` first, remove it to ship), a theme file and its line in `themes/index.ts`.

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
| Power-ups     | two kinds, levels 1-5, hidden in crates: **more dynamites** (+1 TNT out at once, max 5) and **more sticks** (+1 blast range, max 6); `6 + 2 x players` each round (`powerUpTotal`, at most 40 % of the arena's crates), one in a crate close to every player; maxing both takes 8, so the rest must come from other players' crates; flames do not destroy them; walls do                            |

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

Perspective, FOV 30 deg, pitch 54 deg (tested 52-58: lower shows the blocks' sides, higher keeps cells behind tall blocks visible), fixed yaw (looking north, grid +y = screen down): a tilted diorama. Two views
(`CameraRig.view`, the Camera option, `C` in a match, `?camera=follow|full`): **follow** (default) always frames a window of
about 14 x 11 cells (9 x 12 in portrait) that `followTo` moves with the human; **full** is the framing below.
In full, `CameraRig.fitView` frames the whole slab (bisecting the distance on the real projection of its corners) for Small and
Medium arenas on a landscape screen; for Large arenas and portrait phones it frames a window of about 14 x 11 cells (9 x 13 in
portrait) that `followTo` moves with the human, clamped at the slab edge. The bot match behind the home menu pulls back
further (`WorldView.fit`) so the whole crowd shows. `Shake` (one capped trauma accumulator) is added on top.

## Game flow (`game/kaboom-game.ts`)

`menu` (a bot-only match plays behind the cards, on the arena size picked in the setup) -> `loading` (`WorldView.warmUp` behind a card) -> countdown 3-2-1-GO -> `play`
-> round banner (2.8 s) -> next round ... -> `results`; `paused` from the pause button / Esc / P / gamepad Start / the page going to
the background. While the human is out and the round is still on, the sim runs at 2x ("watching the bots").

- **Background match**: it fills every spawn and benches the bots beyond the picked count (`Sim.setPresent`: state `out`). The
  bot stepper flies bots in from the sky / launches them away (`Crew` animates the state change), the colour picker
  recolours in place (`Sim.setTeamColor`); only another arena size rebuilds the scene.
- **Menus** (`game/menu.ts`): welcome, setup (one live critter turning on a stage in the team colour with arrows to flip through: `render/critter-preview.ts`,
  its own small renderer while the card is up, a portrait without WebGL; team colour, arena, bots 1-7 limited by the arena, bot skill, rounds), how
  to play, about (creator and the Poly Haven credit, text from `shared/about.ts`), options (volume, graphics: Auto / Low / High, reloads), pause, match results. An **All games** button appears when
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
  skips the menu; also `seed=<n>`, `bot=1` (autopilot), `debug=1` (stats), `quality=low|high`, `camera=follow|full`, `mute=1`.

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

| Cause                                 | Rule                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New mesh / material / light per blast | Never. Fixed pools created at load; a blast writes a few attribute slots.                                                                                                                                                                                |
| Dynamic point lights                  | None. **Glow grid** (`fx/glow-grid.ts`): a w x h texture of flame heat sampled by the floor and block shaders. Any number of blasts = one tiny upload.                                                                                                   |
| CPU particle updates                  | **GPU particles** (`fx/particles.ts`): ring buffer per kind (fire, smoke, dust, splinter, spark, flash, ring, scorch), motion / size / colour / death in the vertex shader from one clock. Only ever-used slots are drawn.                               |
| Flame meshes per blast                | `fx/flames.ts`: one InstancedMesh, a ring-buffer slot per burning tile (three puff quads), animated in the shader.                                                                                                                                       |
| Fur                                   | Shells are one instanced draw per critter; the fur geometry keeps only triangles that grow hair (none under the vest).                                                                                                                                   |
| Shader compile + upload hitch         | `WorldView.warmUp`: `compileAsync`, then one frame with every pool primed (`Fx.prime`) and the first shadow draw.                                                                                                                                        |
| Shadow map redrawn every frame        | Static sun shadow (`shadowMap.autoUpdate = false`), redrawn when a crate breaks but at most every 0.15 s (`WorldView.takeShadowUpdate`); movers use `BlobShadows`.                                                                                       |
| Chain resolved in one frame           | The sim spreads a chain over the 0.08 s chain delay; blasts only set fuses, never explode each other inside one tick.                                                                                                                                    |
| Block removal rebuilding geometry     | One InstancedMesh per crate variant; removal swaps with the last instance and shrinks `count`.                                                                                                                                                           |
| Hitch at a round change               | A new round builds a new `Arena`, but its merged geometry, the grain texture and the sun (with its 2048 shadow map) are shared module-level, so it costs well under a millisecond.                                                                       |
| Draw calls                            | Arena ~12 (incl. the contact patches), crowd 2 (sprites + flags), crew bodies + fur + 3 shared (hats / vests / feet) + the team rings + the you-arrow, TNT 4, power-ups 2 (+ plinths and glows while any lie out), blob shadows 1, FX 10 (budget below). |
| Garbage collection                    | Sim state in preallocated typed arrays; events are pooled objects in a reused array; render code allocates nothing per frame.                                                                                                                            |
| Audio                                 | Max 4 blast voices; blasts within 50 ms merge; procedural WebAudio.                                                                                                                                                                                      |

**Budgets**: draw calls <= 60, frame <= 4 ms on desktop / <= 12 ms on a mid phone in the stress scenes, sim tick worst case
< 0.5 ms. Checked by the bench page (`__kaboomBench.run(scene, frames)`: avg / p95 / worst, sim time, draw calls, slowest
frames; scenes `chain40`, `grid-all`, `8bots` = two minutes of eight hard bots) and by `tests/kaboom/` (sim tick time, draw-call
count in a 40-TNT chain, pools never overflow). Quality `low | high`: low has no shadow map and a lower pixel ratio (Auto picks
Low on small touch screens; low also halves the fur shells). Triangle counts per part: `__kaboomBench.triangles()`.
Headless Chromium (SwiftShader) queues frames and stalls once the queue fills, so its ms are meaningless: there read only `callsMax` / `trisMax`.

## Architecture

Same split as Hole Island: DOM-free `sim/` + `map/` (tested in node), three.js `render/`, glue in `game/`.

```
src/games/kaboom/
  game.json  release.ts (the levels' release list)  README.md  DETAILS.md  TASKS.md (local)  thumbnail.jpg  screenshots/
  sim/     types.ts rules.ts grid.ts (the contract)  state.ts movement.ts blast.ts sim.ts danger.ts bot.ts powerups.ts
  map/     sizes.ts blank.ts generate.ts spawns.ts safety.ts styles.ts
  render/  renderer.ts camera-rig.ts materials.ts parts.ts arena.ts critters.ts fur.ts crew-parts.ts characters.ts tnt.ts
           bowl.ts crowd.ts shadows.ts portraits.ts critter-preview.ts items.ts world-view.ts sea.ts boats.ts
           themes/ theme.ts index.ts cache.ts quarry.ts valley.ts sea.ts
           fx/ glow-grid.ts puff-atlas.ts particles.ts flames.ts word-burst.ts shake.ts fx.ts
  game/    kaboom-game.ts levels.ts menu.ts hud.ts icons.ts input.ts input-map.ts audio.ts settings.ts storage.ts dom.ts ios.ts
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

| Page        | URL                                                                            | Notes                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play        | `/games/kaboom/`                                                               | menus; URL params above                                                                                                                                                          |
| Map viewer  | `/games/kaboom/map-viewer.html?size=m&level=sea&seed=1&overlay=escape&spawn=2` | regenerate; overlays: spawn zones, escape (TNT on a spawn), danger map, power-ups (the crates hiding them); safety result                                                        |
| Crew viewer | `/games/kaboom/crew-viewer.html?critter=mole&anim=walk&blast=1`                | one critter or all eight; idle / walk / place / ko / cheer; TNT (`view=tnt` = close-up); both power-ups; a looping blast of any level (`blastLevel=5`; `blastAt=0.2` freezes it) |
| Bench       | `/games/kaboom/bench.html?scene=chain40&level=sea`                             | `chain40`, `grid-all`, `8bots`; live or `__kaboomBench.run`; link hidden in the release build (`hideInProd`)                                                                     |

Debug hooks (the browser pane throttles frames, so these step the scene): `__kaboom.advance(s)` / `.benchmark()` /
`.screenshot(name)` (play; the last saves `screenshots/<name>.jpg` through the dev server), `__crew.advance(s)` (crew viewer),
`__kaboomBench.advance(s)` / `.triangles()` (bench).
