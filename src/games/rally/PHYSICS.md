# Gravel Rally - physics

How the car physics works, how to tune it, the tyre / suspension design (with the research and the numbers behind it)
and the open physics work. Code: `src/games/rally/physics/` (DOM-free, runs in node tests). Workflow for changes:
`.claude/skills/rally-physics-tuning/SKILL.md`. Rendering of tyres / coil-overs and the setup screen UI: `DETAILS.md`
("Physics", "Setup screen").

Rule for everything here: **arcade, not a sim**. Differences must be big enough to feel, explainable in one line in the
menu, and a "wrong" choice must still finish every stage. No tyre wear, temperature or pressure.

"Reference numbers" were measured on 2026-10-04 with the shipped cars (Skoda Rally at the R5 torque of 402 Nm, Bimmer M3
on street tyres).

Conventions: body frame +Z forward, +Y up, **+X left**; steer input +1 = right; positive wheel steer angle = left;
240 Hz fixed step (`PHYSICS_HZ`).

## Model in one paragraph

`Vehicle` (`physics/vehicle.ts`) is a raycast-suspension rigid body: each wheel raycasts the ground, spring + damper +
anti-roll bar give the tyre load, the drivetrain (`drivetrain.ts`) gives drive torque, wheel spin is integrated
semi-implicitly, and the combined-slip tyre curve (`tire.ts`, Pacejka-like with a friction ellipse) turns slip ratio +
slip angle into forces using the **surface the wheel stands on** (`surfaces.ts`: `mu`, `slide`, `peakSlip`, `peakAngle`,
`rolling`, `bump`, `rough`). Hull spheres collide with the ground and static colliders; `waterPass` adds water drag.
Driver aids: traction / stability control (`T`; stability trims throttle above combined slip 1.15 on driven rear
tyres, 2.0 on driven front tyres - `TC_REAR_SLIP` / `TC_FRONT_SLIP`), auto reverse, keyboard steering ramp + speed
limit (`keyboardSteerLimit` in `game/input.ts`, close to the steering that gives peak grip).

## Tuning guide

Everything is in `cars/<car>/<car>.ts` (`physics`), `physics/surfaces.ts`, `physics/tyres.ts`, `physics/car-tyres.ts`
and `physics/car-setup.ts`. Workflow:

1. `npm run test` + `npm run test:integration:rally` - `tests/rally/vehicle.test.ts` prints 0-100, 100-0, top speed, lateral g (no tyre fitted = raw
   surfaces); `integration-tests/rally/stage.test.ts` drives every car through every map with the autopilot. Every car has its own
   expected ranges (`BANDS` in `vehicle.test.ts`) - add one for a new car. Tyre / set-up tests: see "Tests" below.
2. Drive it: `/games/rally/?car=<id>&spawn=pad&tyre=<tyre>&susp=<preset>`, press `F2` (per-wheel load, slip, forces,
   tyre, set-up, effective `mu`) and `F4` (force vectors + hull).
3. Inspect geometry / hull in the car viewer (`hull=1`, `tyre=`).

| Symptom                        | Knobs                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Spins under power              | raise `rear.grip` relative to `front.grip`, lower `rearDiffLock`, more `frontSplit`, less torque |
| Won't turn in / understeer     | `front.grip`, `maxSteerDeg`, softer `front.antiRoll`, stiffer `rear.antiRoll`                    |
| Rolls over too easily          | raise `forceHeight` (0.3 -> 0.45), lower `comHeight`, stiffer `antiRoll`                         |
| Floaty / bouncy                | raise `bump` / `rebound` dampers (critical ≈ 2·sqrt(k·m_corner))                                 |
| Bottoms out on jumps           | more `travel`, stiffer `spring`, the preset's `ride` (ride height is kept automatically)         |
| Surface too grippy / too icy   | `mu`, `slide` (grip left when sliding), `peakAngle` in `surfaces.ts`                             |
| Twitchy at speed on gravel     | lower surface `bump` (it's an excitation, long wavelengths only)                                 |
| A tyre too strong / too weak   | its row in `TYRES` (`physics/tyres.ts`): `grip[surface]`, `slide`, `response`                    |
| Wide / thin tyres off          | `sizeFactors` exponents in `physics/car-tyres.ts`, or the car's `tyres` sizes                    |
| Set-up makes too little change | set-up match factors in `carSurfaces` (`0.12` rough / `0.06` smooth), or the preset points       |
| Too slow / fast in water       | `WHEEL_WATER_CD`, `BODY_WATER_CD`, intake height (`waterPass` in `physics/vehicle.ts`)           |

Lessons already learned (also in the skill): auto gearbox decisions use ground speed, not wheel speed; the handbrake
declutches the rear; flimsy props must not be solid colliders; rear-biased AWD at full throttle mid-corner
power-oversteers (the stability part of TC handles keyboard play); crests in corners unload the tyres (loads drop to
~40 %) - place jumps on straights; short surface bumps become damper spikes (wheels are single rays with no unsprung
mass) - keep `bump` wavelengths long.

**Water** (canals / rivers, `GroundProvider.waterLevel` -> `World.waterLevel` -> `gen.waterSurfaceAt`): `Vehicle.waterPass`
adds hydrodynamic drag `0.5 * rho * Cd * A * v^2` per tyre (A = tyre width x depth) and on the submerged body (width /
length / plan area x depth by direction, applied at the submerged centre so the nose dips on entry); water at the air
intake (45 % of the body height above the underside) cuts engine power to 20 %; the bed is `mud`. No buoyancy.
`vehicle.waterDepth` / `engineWater` are exposed for effects. Skoda Rally, 6 s full throttle: dry 117 km/h, 0.2 m water
22 km/h, 0.6 m 10 km/h; 83 km/h into 0.5 m water -> 11 km/h after 2 s. Tests: `tests/rally/water-physics.test.ts`.

## Grip layers (tyres + suspension)

A tyre never touches the tyre model (`tire.ts`): it re-tunes every **surface** for the wheels that run on it. The
layers are precomputed once per car in `physics/car-tyres.ts` - `carSurfaces(def, tyre)` returns `table[surfaceId]`,
cached by tyre size + compound + compliance, so the physics step allocates nothing:

```
effective surface = surface (surfaces.ts)
                  x compound      (tyres.ts)       grip per surface, slide, response
                  x tyre size     (car-tyres.ts)   width + sidewall of the car's size for that compound
                  x set-up match  (car-tyres.ts)   suspension compliance vs surface roughness
then x axle.grip (per car front / rear balance, in tire.ts)
```

- The effective surface keeps `id`, `dust`, `dustColor`, `loose`, `bump`, so dust, audio, skid effects and water keep
  working; traction control reads `w.surface.peakSlip`, so it adapts by itself.
- `Vehicle.setTyre(id)` swaps the wheel surfaces; **no tyre (`null`) = raw surfaces** (tool pages and `vehicle.test.ts`
  stay put). `Vehicle.surfaceFor(id)` is what the wheels see (the autopilot plans with it).
- The suspension preset is applied to the car **before** the `Vehicle` is built: `new Vehicle(applySetup(def, setup), ground)`
  then `setTyre(tyre)` (wheel mounts are computed in the constructor; ride height is kept automatically).
- In game: menu / URL (`?tyre=`, `?susp=`, missing = the stage recommendation) -> `RallyGame` -> `applySetup` + `setTyre`.

### Tyre compounds (`physics/tyres.ts`)

Three compounds, room for two more (max 5). Every `MapDef` has a required `tyre` = its recommended compound.

| Id       | Ring colour | Recommended on                                            | Best on       | Feel                                                    |
| -------- | ----------- | --------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| `tarmac` | red         | `jackie` (Jackie - inspired by Jackie Robinson Parkway)   | clean tarmac  | sharp, direct, grips hard - skates and lets go on loose |
| `mixed`  | yellow      | `ajvatovci` (Ajvatovci Hill, near Ilinden - dusty tarmac) | dusty tarmac  | all-rounder, never bad anywhere                         |
| `gravel` | white       | `petralica` (near Kriva Palanka), `test`                  | gravel / dirt | lazy turn-in, big easy drifts; floaty on asphalt        |
| (`snow`) | blue        | a future winter map (`snow` surface exists)               |               | not built - only when a snow map exists                 |
| (`wet`)  | green       | rain on tarmac                                            |               | not built - only if weather is ever added               |

`mu` multipliers per surface (`TyreDef.grip`):

| Tyre   | tarmac   | tarmac_gravel | rock | gravel   | gravel_loose | dirt | grass | mud  | snow |
| ------ | -------- | ------------- | ---- | -------- | ------------ | ---- | ----- | ---- | ---- |
| Tarmac | **1.12** | 0.95          | 1.0  | 0.72     | 0.65         | 0.68 | 0.62  | 0.55 | 0.6  |
| Mixed  | 0.98     | **1.06**      | 1.0  | 0.93     | 0.90         | 0.92 | 0.90  | 0.85 | 0.85 |
| Gravel | 0.84     | 0.94          | 0.95 | **1.05** | **1.06**     | 1.05 | 1.04  | 1.0  | 0.95 |

Character: `slide` (grip left when fully sliding) is multiplied by `[hard, loose]` blended by `surface.loose`
(< 1 lets go suddenly, > 1 progressive); `response` multiplies `peakSlip` / `peakAngle` (< 1 sharp, > 1 lazy):

| Tyre   | slide hard / loose | response |
| ------ | ------------------ | -------- |
| Tarmac | 0.95 / 0.90        | 0.8      |
| Mixed  | 1.0 / 1.0          | 1.0      |
| Gravel | 1.08 / 1.03        | 1.25     |

Why three: every current road is tarmac, dusty tarmac, gravel or tarmac -> gravel, so three compounds cover every real
decision; a 4th with no map that needs it would only be a worse choice in the list. The test map is on a hill but gravel
all the way - the surface decides the tyre, the slope only changes load transfer (already simulated). Petralica (~4.8 km
valley tarmac, then ~4.7 km gravel climb) is the real dilemma: Gravel is recommended, Mixed is within ~1-2 %.

### Tyre sizes (`CarPhysicsDef.tyres`)

`TyreSize` = sidewall marking (`205/65 R15` -> `{ width: 0.205, aspect: 65, rim: 15 }`); `tyres.size` is the default,
`tyres.byCompound` overrides it (rally teams change the **rim with the compound**). The overall radius
`rim * 0.0127 + width * aspect / 100` must stay within 4 % of `wheelRadius` (tested) - gearing and ride height never
change per compound. `wheelWidth` stays the water-drag / hull width (within 5 cm of every size, tested).

| Car / compound              | Size       | Overall radius | `wheelRadius` |
| --------------------------- | ---------- | -------------- | ------------- |
| Skoda Rally - gravel, mixed | 205/65 R15 | 0.324 m        | 0.321         |
| Skoda Rally - tarmac        | 235/40 R18 | 0.323 m        | 0.321         |
| Zastava 101 - all           | 145/80 R13 | 0.281 m        | 0.285         |
| Bimmer M3 - tarmac, mixed   | 245/40 R18 | 0.327 m        | 0.33          |
| Bimmer M3 - gravel          | 205/65 R16 | 0.337 m        | 0.33          |

Size factors (`sizeFactors`, reference 205/65 R15 = 1; `w` = width / 0.205, `h` = sidewall height / 0.133 m):

| Factor                       | Formula                                    | Zastava 145/80 | Skoda Rally 235/40 | Bimmer M3 245/40 | 205/65 (Skoda / M3 gravel) |
| ---------------------------- | ------------------------------------------ | -------------- | ------------------ | ---------------- | -------------------------- |
| mu on hard ground            | `w ^ 0.3`                                  | 0.90           | 1.04               | 1.05             | 1.00                       |
| mu on loose ground           | `w < 1 ? w ^ 0.12 : 1 - 0.22 * (w - 1)`    | 0.96           | 0.97               | 0.96             | 1.00                       |
| blend hard -> loose          | by `surface.loose` (0 tarmac ... 1 gravel) |                |                    |                  |                            |
| response (peak slip / angle) | `h ^ 0.3` (low profile = sharper)          | 0.96           | 0.90               | 0.91             | 1.00                       |
| slide (forgiveness)          | `h ^ 0.1`                                  | 0.99           | 0.97               | 0.97             | 1.00                       |
| rolling on loose             | `1 + 0.3 * max(0, w - 1)` x `loose`        | 1.00           | 1.04               | 1.06             | 1.00                       |

So the Zastava's thin tyres lose grip everywhere (least on loose ground); the M3's 245/40 street tyres are a little
wider and lower than the Skoda Rally's tarmac tyre (its tarmac lead, 1.19 vs 1.12 g, comes mostly from `front.grip` 1.06 and
more downforce), and on gravel both run the reference 205/65 size. The M3 keeps `rear.grip` 1.3: the size factors act on both
axles, so they don't replace the rear bias a 450 Nm RWD car needs (1.15 made it spin under full throttle on loose ground;
guarded by `car-setup.test.ts` "straight-line launch").

### Suspension set-ups (`physics/car-setup.ts`)

Every car has three presets, always **Soft / Medium / Stiff** (springs yellow / orange / red in the menu), but each car
defines its own values - that is where its **limits** live. `CarPhysicsDef.setups` holds them, `CarPhysicsDef.setup`
names the preset the base axle numbers equal, `applySetup(def, id)` returns the car with a preset, `deriveSetups` builds
the presets from spring rates + travel (dampers scale with `sqrt(spring)` so the damping ratio stays put, anti-roll bars
with the spring rate).

**Compliance** (no hand-set label - retuning springs changes the behaviour by itself):

```
ride frequency f (Hz) per axle = sqrt(spring / cornerMass) / (2 pi)        (cornerMass = static corner load / g)
compliance c = clamp01( 0.5 * (2.6 - f_avg) + 0.5 * (travel - 0.14) / 0.12 )   0 = stiff tarmac ... 1 = soft gravel
```

**Set-up match** with `SurfaceDef.rough` (tarmac 0, tarmac_gravel 0.25, snow 0.5, gravel 0.6, dirt 0.7, gravel_loose
0.75, grass 0.8, rock / mud 0.9):

```
match = (c - 0.5) * 2                                   -1 stiff ... +1 soft
mu       *= 1 + 0.12 * match * rough - 0.06 * match * (1 - rough)   rough 0.12 (was 0.08 - review 2026-10-03)
response *= 1 + 0.08 * match * (1 - rough)              soft set-ups are a bit lazier on smooth tarmac
```

| Car (character)             | Preset | f (Hz) | Spring front / rear (kN/m) | Travel | c    | Range       | Ride height |
| --------------------------- | ------ | ------ | -------------------------- | ------ | ---- | ----------- | ----------- |
| **Skoda Rally** (rally car) | Soft   | 1.61   | 34 / 29 (base)             | 260 mm | 0.99 | full        | +30 mm      |
|                             | Medium | 2.1    | 59 / 48                    | 200 mm | 0.50 | 0.0 - 0.99  | standard    |
|                             | Stiff  | 2.7    | 98 / 79                    | 150 mm | 0.0  |             | -20 mm      |
| **Zastava** (road car)      | Soft   | 1.53   | 23 / 17 (base)             | 220 mm | 0.87 | soft half   | +15 mm      |
|                             | Medium | 1.76   | 32 / 21                    | 200 mm | 0.67 | 0.49 - 0.87 | standard    |
|                             | Stiff  | 1.95   | 39 / 26                    | 180 mm | 0.49 |             | -10 mm      |
| **Bimmer M3** (race car)    | Soft   | 1.95   | 47 / 42                    | 170 mm | 0.45 | stiff half  | +35 mm      |
|                             | Medium | 2.24   | 62 / 55                    | 160 mm | 0.26 | 0.04 - 0.45 | +15 mm      |
|                             | Stiff  | 2.52   | 78 / 70 (base)             | 140 mm | 0.04 |             | standard    |

**Ride height per preset** (`SetupPreset.ride`, `deriveSetups` point `ride`; `applySetup` -> `CarPhysicsDef.rideHeight`):
softer presets lift the body (gravel kit: more clearance, higher centre of mass, more roll), stiffer ones lower it. The
`Vehicle` keeps that height whatever the springs (`staticComHeight` = `comHeight` + `rideHeight`; the wheel mounts follow);
`comHeight` stays the body's reference, so the model and the hull (both body-fixed) rise with it and the wheels hang
lower. **Hull** = the real body: `bodyHull` (`physics/hull.ts`) puts low spheres along the splitter, sills, floor and
rear bumper at the model's heights (Bimmer M3 floor + sills 0.14 m, Skoda Rally splitter 0.12 / floor 0.14 m, Zastava floor 0.24 m), so a
low car scrapes on crests and landings; `tests/rally/hull-fit.test.ts` checks it against the model for every car.

Damping ratio stays 0.25-0.8 on every axle of every preset (tested; ~0.35 bump / ~0.5 rebound). The **recommended
set-up follows the recommended tyre** (`SETUP_FOR_TYRE`: gravel -> soft, mixed -> medium, tarmac -> stiff), using the
car's own preset of that name. So the Skoda Rally can be set up properly for any stage, the Zastava is always soft-ish (rides
bumps, rolls on tarmac), the Bimmer M3 always stiff-ish (sharp on tarmac, skips on gravel even on its softest).

### Gearing (`physics/gearing.ts`)

A third setup row: **Short / Medium / Long** final drive (the gearbox ratios stay - like a rally team swapping the final
drive for a fast or a twisty stage). Only the race cars carry presets (`CarPhysicsDef.gearings`); the Zastava's gearing is
fixed (setup screen: one "Standard" box, "no configuration available"). Medium is always the car's own
`gearbox.finalDrive`. `applyGearing(def, id)` after `applySetup`; `topSpeed(def)` (wheel force vs drag + rolling, capped by
the redline) is the setup screen's number and matches the sim within 2 km/h; the box chart shows each gear's redline speed
capped at that top speed. A map can recommend a gearing (`MapDef.gearing`, missing = medium): Jackie and Ajvatovci recommend `long`.

| Car         | Short          | Medium (own)           | Long           |
| ----------- | -------------- | ---------------------- | -------------- |
| Skoda Rally | 5.2 - 146 km/h | 4.6 - 165 km/h         | 3.7 - 206 km/h |
| Bimmer M3   | 4.8 - 218 km/h | 4.2 - 249 km/h         | 3.8 - 276 km/h |
| Zastava     | -              | 4.4 - 160 km/h (fixed) | -              |

Measured (limit driver with the speed cap lifted, `Autopilot.maxSpeed` 70 m/s): the Skoda Rally on long reaches 205 km/h on
Jackie and is 5 % faster there (165.6 vs 174.6 s); on the test map and Petralica the gearing is worth < 0.5 %. **Short
barely pulls harder** (Skoda Rally 0-100 4.60 vs 4.65 s): the engines have broad torque curves and close-ratio boxes, so the
engine stays in its power band either way - final drive mostly trades top speed. If short should matter, it needs a
peakier engine or slower shifts (open question). The stage tests' autopilot stays capped at 151 km/h (`maxSpeed` 42).

### Autopilot and grip (`game/autopilot.ts`)

The autopilot (stage tests, `F8`) plans corner speed from the road curvature and the fitted tyre's grip on the road
surface **ahead** (`Vehicle.surfaceFor`). By default it never corners above the gravel-grade baseline (`REF_MU` 0.86), so
the stage tests and `F8` keep their pace and a wrong tyre only slows it down ("careful driver"). With
`autopilot.useExtraGrip = true` corner / braking speed also rises with grip ("limit driver") - the tests use it to measure
what a grippier tyre is worth. Low grip also caps straight-line speed (a wrong tyre brakes for the next surface change -
without it the Tarmac tyre arrived at Petralica's gravel at 116 km/h and slid 30 m off the road).

## Reference numbers

Max lateral g at 60 km/h on flat ground (`handling.test.ts` ramp steer, true lateral acceleration; each tyre with its
matching set-up), 2026-10-04 - tarmac / dusty tarmac / gravel / loose gravel, home tyre in bold:

| Car         | Tarmac tyre (stiff)           | Mixed tyre (medium)           | Gravel tyre (soft)                |
| ----------- | ----------------------------- | ----------------------------- | --------------------------------- |
| Skoda Rally | **1.12** / 0.79 / 0.53 / 0.40 | 0.90 / **0.84** / 0.72 / 0.60 | 0.73 / 0.74 / **0.83** / **0.73** |
| Zastava 101 | **0.95** / 0.73 / 0.56 / 0.43 | 0.82 / **0.80** / 0.72 / 0.60 | 0.69 / 0.70 / **0.81** / **0.70** |
| Bimmer M3   | **1.19** / 0.83 / 0.55 / 0.40 | 1.03 / **0.91** / 0.71 / 0.57 | 0.82 / 0.79 / **0.84** / **0.71** |

The home tyre is the best on all four surfaces for every car. `tyres.test.ts` prints the same for the Skoda Rally with the
older steady-state method (v x yaw rate, lower numbers, same ranking): tarmac 0.89 / 0.78 / 0.67, dusty 0.63 / 0.75 / 0.70,
gravel 0.44 / 0.67 / 0.83 (tarmac / mixed / gravel tyre). Whole-car handling per car (balance, braking, keyboard, ride):
`integration-tests/rally/handling.test.ts` (`HANDLING_OUT=out.json` writes every number).

### Stage times

Skoda Rally, every tyre with its matching set-up, both drivers (`tyres.test.ts`, 2026-10-04); s, tarmac / mixed / gravel
tyre, recommended in bold:

| Map (recommended)    | Careful driver            | Limit driver (`useExtraGrip`) |
| -------------------- | ------------------------- | ----------------------------- |
| `test` (gravel)      | 81.5 / 70.0 / **67.9**    | 81.5 / 70.0 / **66.8**        |
| `petralica` (gravel) | 461.6 / 416.0 / **410.4** | 439.8 / 405.1 / **401.5**     |
| `jackie` (tarmac)    | **196.0** / 196.0 / 197.9 | **187.6** / 189.6 / 197.9     |
| `ajvatovci` (mixed)  | 162.1 / **161.0** / 162.7 | 161.2 / **156.4** / 162.7     |

Every car, careful driver, recommended pick / worst pick (`car-matrix.test.ts`, 2026-10-04; worst = tarmac tyres on a gravel
stage, gravel tyres on a tarmac or dusty one):

| Map (recommended)    | Skoda Rally     | Zastava 101   | Bimmer M3         |
| -------------------- | --------------- | ------------- | ----------------- |
| `test` (gravel)      | **67.9** / 81.5 | 75.2 / 87.1   | 68.0 / 84.2       |
| `petralica` (gravel) | 410.4 / 461.6   | 477.8 / 530.4 | **407.6** / 471.2 |
| `jackie` (tarmac)    | 196.0 / 197.9   | 217.5 / 223.5 | **193.6** / 195.0 |
| `ajvatovci` (mixed)  | 161.0 / 162.7   | 189.1 / 194.8 | **159.5** / 161.9 |

Reading it: the recommended tyre is the fastest with the limit driver on every stage, and the wrong tyre on gravel costs the
most (tarmac tyres +20 % on the test map, +10-12 % on Petralica). On tarmac the careful driver can't show the gain - it never
corners above the gravel baseline and is capped at 151 km/h, so it ties or loses only 1-2 % on the wrong tyre - the limit
driver does (gravel tyres +5 % on Jackie, Mixed ahead by 3 % on Ajvatovci). Car character: the Skoda Rally feels better on
gravel (AWD) but is not guaranteed the fastest - the more powerful M3 ties it on the test map and is ~1 % ahead on Petralica
and Ajvatovci (by design: the AWD car should feel better on gravel, a more powerful car may still be quicker over a stage); M3 fastest on tarmac; Zastava slowest
everywhere (power, not grip).

## Tests

| File                                  | What it holds                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/rally/vehicle.test.ts`         | per-car bands (0-100, braking, top speed), lateral g ranks per surface - no tyre fitted (raw surfaces)                                                                                                                                   |
| `integration-tests/rally/stage.test.ts`           | every car finishes every map with the autopilot, upright (raw surfaces)                                                                                                                                                                  |
| `integration-tests/rally/tyres.test.ts`           | compound data complete; right tyre best on its home surface, mixed never best / worst; careful + limit driver per stage                                                                                                                  |
| `tests/rally/car-setup.test.ts`       | sizes match `wheelRadius`; presets: damping, ride height per preset (body + wheels), compliance ranges per car; width effects; car vs car lateral g; straight-line launch on loose ground (every car reaches 100 km/h pointing straight) |
| `integration-tests/rally/car-matrix.test.ts`      | every car x stage on the recommended and the worst pick finishes upright; cars rank by character; set-up alone is worth time                                                                                                             |
| `tests/rally/tyre-mesh.test.ts`       | tyre geometry: budget, size, tread depth order, rim switch (rendering, but sized from the physics data)                                                                                                                                  |
| `tests/rally/suspension-mesh.test.ts` | coil-over geometry: length by travel, coils / wire by rate, one style per car                                                                                                                                                            |
| `tests/rally/water-physics.test.ts`   | dry / shallow / deep acceleration per car                                                                                                                                                                                                |
| `tests/rally/hull-fit.test.ts`        | every car's collision hull follows its model: underside per zone (front overhang, between axles, rear overhang) and the nose / tail ends; prints the profile                                                                             |
| `integration-tests/rally/gearing.test.ts`         | gearing presets: race cars only, medium = own final drive, short < medium < long top speed, setup-screen top speed = sim, Skoda Rally on long reaches 200 km/h on Jackie                                                                 |
| `integration-tests/rally/handling.test.ts`        | whole-car handling per car x tyre x set-up x surface (`handling-harness.ts`): ramp / step steer, lift / power / brake mid-corner, handbrake, slalom, keyboard lock, braking, drops, jump landing, ruts                                   |

`tyres.test.ts` and `car-matrix.test.ts` import the four stages directly (`test`, `petralica`, `jackie`, `ajvatovci`) - add a
new map there. The "worst pick" in `car-matrix.test.ts` is tarmac tyres on a gravel stage, gravel tyres on a tarmac or
dusty-tarmac stage. Ajvatovci has its own margin test: Mixed ahead of Tarmac and Gravel by > 1.5 % (limit driver).

## Research notes

**Rally tyre families** (the family matters more than the compound): Tarmac - wide, shallow tread, sticky, stiff
sidewall (asphalt rallies); Gravel - deep blocky tread, tall reinforced sidewall (gravel rallies); Mixed / all-surface -
medium blocks, what rallycross runs (half tarmac, half dirt); Snow - narrow, studded for ice; Wet tarmac - tarmac carcass
with deep grooves. Off their surface: a tarmac tyre on gravel can't bite through the stones - it skates and lets go
suddenly; a gravel tyre on tarmac squirms and slides but progressively, easy to catch; a mixed tyre is never the best on
clean tarmac or proper gravel, never terrible, best on dirty asphalt.

**Width and sidewall**: a wider tyre has a bigger contact patch - more grip and sharper response on tarmac; on loose
gravel it floats on top and ploughs a bow wave of stones - less grip, more drag. Narrow tyres cut down to the hard base
(why gravel rally tyres are narrow), but very narrow road tyres simply have little rubber. A tall sidewall is soft,
forgiving and lazy (absorbs rocks); a low profile is direct and snappy. Rally2: 205/65 R15 gravel, 235/40 R18 tarmac.

**Suspension**: gravel set-ups are soft with long travel (ride frequency ~1.4-1.9 Hz, ~250 mm) so the wheels follow the
ruts and stay loaded; tarmac set-ups are stiff and low (~2.5-3.5 Hz, ~120-150 mm) for less roll / pitch and faster
response. A tarmac car on rough gravel skips, hits the bump stops and loses grip; a gravel car on tarmac rolls and feels
vague but stays drivable. Rally cars carry two complete kits; road and circuit cars only adjust around one design point.
Hardware look: rally coil-overs long with remote reservoirs; road cars a plain MacPherson strut with a rubber boot; race
cars short stubby coil-overs with a piggyback reservoir, adjuster knob and helper spring.

## Design rules (arcade)

- The **wrong tyre / set-up must still finish** for a careful player (`car-matrix.test.ts` holds this). The biggest
  "fun moment" lever is the Tarmac tyre's `slide` on loose ground (how sudden the breakaway is): 0.9 now (0.82 rolled the
  car over on the test map).
- The right pick is a modest bonus (+5-12 %) - it should feel planted, not change the car's personality; the wrong one is
  a clear penalty (-12 % gravel on tarmac up to -30-40 % tarmac on gravel). The loose shoulders (`gravel_loose`) punish a
  tarmac tyre hardest - the price for running wide.
- **Defaults are the best choice**: the stage's recommended tyre + set-up are preselected, most players never open the
  setup screen. Choices are not saved; a "<tyre> tyres on <surface>... hold on!" line at GO flags a poor / bad pick.
- No hidden mechanics: the setup screen shows the grip per surface for this car (`carGripRating`: best >= 0.97,
  good >= 0.82, poor >= 0.65 of the best compound's `mu`), the spring data and the car's adjustment range.
- One builder (`car-tyres.ts`) owns every grip multiplier; `tire.ts` stays untouched; `applySetup` only swaps axle
  numbers. `wheelRadius` drives gearing, ride height and the autopilot - never change it per compound or preset.

## Open work

- [ ] **Handling follow-ups**: keyboard play-test (Jackie, the test map's loose shoulders),
      then decide the Skoda Rally's `rear.grip` 1.03-1.05 (stops the 25-44 deg keyboard slides at 100-140 km/h on loose
      gravel, max g unchanged); M3 gravel play-test; lift-off rotation (optional).
- [ ] **Human play-test** (keyboard + pad): Zastava on tarmac (thin tyres = slides early), Bimmer M3 on Petralica gravel on
      its softest set-up + 16" tyres (skips, floats, still finishes), Skoda Rally stiff on gravel vs soft on Jackie, Jackie on
      gravel tyres, the test map on tarmac tyres, Petralica Mixed vs Gravel (should feel close). Tune `TYRES`,
      `sizeFactors`, the set-up match factors and the preset points; update the tables here when numbers move.
- [ ] **In-car coil-overs**: replace the Skoda Rally's thin damper link (`buildSuspensionGeometries`, `model.suspension`) by
      `buildCoilover` so the chosen set-up's spring colour shows through the open arches in game (`CarModel` option
      `{ setup }` + `setSetup`, spring length from the live compression). Bimmer / Zastava stay without (closed wells / none).
- [ ] **Asset debugger**: tyre + set-up pickers for `car:<id>` in `pages/asset-debug.ts`; `?susp=` in the car viewer.
- [ ] **Optional emergent roughness**: raise `bump` on loose surfaces (gravel 6 -> ~15 mm, long wavelengths) so stiff
      short-travel set-ups really skip - only with a rough-strip test and green `stage.test.ts`; back it out if the soft
      cars get twitchy.
- [ ] **Tyre look in motion**: check the three tread patterns can be told apart at chase-cam distance; mud / wear vertex
      colours; fewer segments (80) if the triangle count matters on phones.
- [ ] **Optional extras**: audio layers (tarmac squeal near the limit, gravel-tread hum on asphalt), co-driver style
      lines, tyre / set-up choice in the pause menu.
