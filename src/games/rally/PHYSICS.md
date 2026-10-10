# Gravel Rally - physics

How the car physics works, how to tune it, the tyre / suspension design (with the research and the numbers behind it)
and the open physics work. Code: `src/games/rally/physics/` (DOM-free, runs in node tests). Workflow for changes:
`.claude/skills/rally-physics-tuning/SKILL.md`. Rendering of tyres / coil-overs and the setup screen UI: `DETAILS.md`
("Physics", "Setup screen").

Rule for everything here: **arcade, not a sim**. Differences must be big enough to feel, explainable in one line in the
menu, and a "wrong" choice must still finish every stage. No tyre wear or pressure; tyre temperature is one number per
tyre ("Tyre temperature").

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
Driver aids: traction / stability control (`T`, `Vehicle.tractionAssist`: the traction term holds a driven wheel at
`TC_WHEELSPIN` (0.6) x the surface's peak slip ratio, so the tyre keeps sideways grip; the stability term trims throttle above
combined slip 1.15 on driven rear tyres, 2.0 on driven front tyres - `TC_REAR_SLIP` / `TC_FRONT_SLIP`; the stronger trim wins), ABS (`B`, `Vehicle.absPass`: per wheel, eases the
foot brake off past 1.3x the surface's peak slip ratio above ~11 km/h, so the fronts keep steering; the handbrake is
untouched; `physics.noAbs` = not fitted, the Zastava), auto reverse, keyboard steering ramp + speed limit
(`keyboardSteerLimit` in `game/input.ts`, close to the steering that gives peak grip).

## Tuning guide

Everything is in `cars/<car>/<car>.ts` (`physics`), `physics/surfaces.ts`, `physics/tyres.ts`, `physics/car-tyres.ts`
and `physics/car-setup.ts`. Workflow:

1. `npm run test` + `npm run test:integration:rally` - `tests/rally/vehicle.test.ts` prints 0-100, 100-0, top speed, lateral g (no tyre fitted = raw
   surfaces); `integration-tests/rally/stage.test.ts` drives every car through every map with the autopilot. Every car has its own
   expected ranges (`BANDS` in `vehicle.test.ts`) - add one for a new car. Tyre / set-up tests: see "Tests" below.
2. Drive it: `/games/rally/?car=<id>&spawn=pad&tyre=<tyre>&susp=<preset>`, press `F2` (per-wheel load, slip, forces,
   tyre, set-up, effective `mu`) and `F4` (force vectors + hull).
3. Inspect geometry / hull in the car viewer (`hull=1`, `tyre=`).

| Symptom                        | Knobs                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Spins under power              | more rear weight or a wider rear tyre, lower `rearDiffLock`, more `frontSplit`, less torque, `TC_WHEELSPIN`  |
| Won't turn when braking        | ABS on (`B`); without it the fronts lock and the car goes straight on whatever the steering does             |
| Won't turn in / understeer     | weight split, tyre stagger, `maxSteerDeg`, softer `front.antiRoll`, stiffer `rear.antiRoll`                  |
| Rolls over too easily          | raise `forceHeight` (0.15 -> 0.3), lower `comHeight`, stiffer `antiRoll`                                     |
| Leans / dives too little       | lower `forceHeight` (tyre forces reach the body higher up), softer `antiRoll` (dive: `forceHeight` only)     |
| Floaty / bouncy                | raise `bump` / `rebound` dampers (critical ≈ 2·sqrt(k·m_corner))                                             |
| Bottoms out on jumps           | more `travel`, stiffer `spring`, the preset's `ride` (ride height is kept automatically)                     |
| Surface too grippy / too icy   | `mu`, `slide` (grip left when sliding), `peakAngle` in `surfaces.ts`                                         |
| Twitchy at speed on gravel     | lower surface `bump` (it's an excitation, long wavelengths only)                                             |
| A tyre too strong / too weak   | its row in `TYRES` (`physics/tyres.ts`): `grip[surface]`, `slide`, `response`; a car class: `TyreSize.grade` |
| Wide / thin tyres off          | `sizeFactors` exponents in `physics/car-tyres.ts`, or the car's `tyres` sizes                                |
| Set-up makes too little change | set-up match factors in `carSurfaces` (`0.12` rough / `0.06` smooth), or the preset points                   |
| Too slow / fast in water       | `WHEEL_WATER_CD`, `BODY_WATER_CD`, intake height (`waterPass` in `physics/vehicle.ts`)                       |

Lessons already learned (also in the skill): "can't turn into corners" was the fronts locking under braking (ABS fixed
it; a grip-aware steering limit and a grip / diff retune were tried first and dropped); auto gearbox decisions use ground
speed, not wheel speed; the handbrake declutches the rear; flimsy props must not be solid colliders; rear-biased AWD at
full throttle mid-corner power-oversteers (the stability part of TC handles keyboard play); crests in corners unload the
tyres (loads drop to ~40 %) - place jumps on straights; short surface bumps become damper spikes (wheels are single rays
with no unsprung mass) - keep `bump` wavelengths long; the centre / axle lock torque is a stiff spring on a speed
difference, applied implicitly (`distributeTorque`): as a plain explicit torque it swung light wheels (clutch slipping,
traction control at its floor) past each other every step.

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
                  x tyre size     (car-tyres.ts)   width + sidewall of the car's size for that family, and its grade
                  x set-up match  (car-tyres.ts)   suspension compliance vs surface roughness
then x axle.grip (1 on M3 and GT2; a small per-axle trim on the Zastava and the 22B, in tire.ts)
```

- The effective surface keeps `id`, `dust`, `dustColor`, `loose`, `bump`, so dust, audio, skid effects and water keep
  working; traction control reads `w.surface.peakSlip`, so it adapts by itself.
- `Vehicle.setTyre(id)` swaps the wheel surfaces; **no tyre (`null`) = raw surfaces** (tool pages and `vehicle.test.ts`
  stay put). `Vehicle.surfaceFor(id)` is what the wheels see (the autopilot plans with it).
- The suspension preset is applied to the car **before** the `Vehicle` is built: `new Vehicle(applySetup(def, setup), ground)`
  then `setTyre(tyre)` (wheel mounts are computed in the constructor; ride height is kept automatically).
- In game: menu / URL (`?tyre=`, `?susp=`, missing = the stage recommendation) -> `RallyGame` -> `applySetup` + `setTyre`.

### Tyre types (`physics/tyres.ts`)

Five tyres in three families, generic names after the Pirelli WRC range (tarmac hard / soft, gravel hard / soft; Mixed is the
rallycross-style all-rounder, not a WRC tyre). The **family** (tarmac, mixed, gravel) sets the car's tyre size per axle
(`tyres.byCompound`), brake kit, rim and tread pattern; the **compound** sets grip, temperature window and character. The ids
`tarmac` and `gravel` are the soft compounds (saved set-ups and URLs keep working). Every `MapDef` has a required `tyre` =
its recommended one.

| Id            | Name        | Ring colour | Recommended on             | Feel                                                                   |
| ------------- | ----------- | ----------- | -------------------------- | ---------------------------------------------------------------------- |
| `tarmac`      | Tarmac Soft | red         | `jackie`                   | sharpest and stickiest on clean tarmac, warms fast                     |
| `tarmac_hard` | Tarmac Hard | orange      | no stage yet (a hot day)   | less peak grip, wider and hotter window, slow to warm                  |
| `mixed`       | Mixed       | yellow      | `ajvatovci` (dusty tarmac) | all-rounder, never bad anywhere                                        |
| `gravel_hard` | Gravel Hard | light blue  | no stage yet               | tough tread, level with soft on hard-packed gravel, less bite on loose |
| `gravel`      | Gravel Soft | white       | `petralica`, `test`        | deep tread bites loose ground and mud, lazy on asphalt                 |

`mu` multipliers per surface (`TyreDef.grip`, on a rally competition tyre, see "Tyre grade"):

| Tyre        | tarmac   | tarmac_gravel | rock | gravel   | gravel_loose | dirt | grass | mud  | snow |
| ----------- | -------- | ------------- | ---- | -------- | ------------ | ---- | ----- | ---- | ---- |
| Tarmac Soft | **1.26** | 1.07          | 1.0  | 0.72     | 0.64         | 0.68 | 0.62  | 0.55 | 0.6  |
| Tarmac Hard | 1.19     | 1.05          | 1.0  | 0.72     | 0.64         | 0.68 | 0.62  | 0.55 | 0.6  |
| Mixed       | 1.10     | **1.19**      | 1.0  | 0.93     | 0.90         | 0.92 | 0.90  | 0.85 | 0.85 |
| Gravel Hard | 0.96     | 1.03          | 0.96 | 1.03     | 1.00         | 1.02 | 1.00  | 0.90 | 0.92 |
| Gravel Soft | 0.92     | 1.03          | 0.94 | **1.04** | **1.08**     | 1.06 | 1.06  | 1.04 | 0.98 |

Character per compound: `slide` (grip left when fully sliding) is multiplied by `[hard, loose]` blended by `surface.loose`
(< 1 lets go suddenly, > 1 progressive); `response` multiplies `peakSlip` / `peakAngle` (< 1 sharp, > 1 lazy). Hard compounds
heat slower (`heat`), lose less grip with load (`loadSens`) and run in a warmer window (see "Tyre temperature"):

| Tyre        | slide hard / loose | response | Heat-up | Load sensitivity |
| ----------- | ------------------ | -------- | ------- | ---------------- |
| Tarmac Soft | 0.95 / 0.90        | 0.80     | 1.0     | 0.14             |
| Tarmac Hard | 1.0 / 0.92         | 0.85     | 0.9     | 0.12             |
| Mixed       | 1.0 / 1.0          | 1.00     | 1.0     | 0.12             |
| Gravel Hard | 1.06 / 1.0         | 1.15     | 0.75    | 0.09             |
| Gravel Soft | 1.08 / 1.03        | 1.25     | 0.85    | 0.10             |

**Soft vs hard** is a temperature trade, not a grip lottery: at its ideal temperature the soft compound grips as much or more
on every surface; the hard one keeps its grip when the soft one overheats and wants a hotter tyre to work. The stages are
mild to hot (Jackie 17 °C, test 20, Petralica 28, Ajvatovci 30 on a clear morning), and the soft tyres still peak inside their
windows (the Skoda on Ajvatovci peaks at ~88 °C against a 100 °C limit), so the soft compound is the recommended one
everywhere and a hard one is a slightly slower pick (Gravel Hard is level with Soft on Petralica). Hard compounds only win
on a stage hotter or harder on the tyres than these (open work). The wrong **family** is still the big penalty: tarmac tyres on gravel +10-25 % stage time, gravel tyres on
tarmac +5 %.

**Tyre grade** (`TyreSize.grade`): what class of rubber a car runs, as grip against a rally competition tyre (1, the default).
It multiplies the grip of the car's default size and its tarmac and mixed sizes on both axles (so it moves the car's
grip, never its balance); loose ground keeps only 40 % of the difference (`GRADE_LOOSE`: the soil limits the grip there).
Tarmac tyres on tarmac, medium set-up, 80 km/h ramp steer:

| Class             | Grade | Cars                                 | Lateral g | Real range                      |
| ----------------- | ----- | ------------------------------------ | --------- | ------------------------------- |
| track slick       | 1.12  | Bimmer GT2                           | 1.4-1.5   | slicks / race rubber 1.4-1.5+ g |
| rally competition | 1.0   | Skoda Rally, Fiesta, C4, Lancer, 22B | 1.15-1.2  | WRC tarmac ~1.2-1.3 g           |
| road, sport       | 0.82  | Bimmer M3 (245 / 265 40 R18)         | 1.05      | summer road tyre ~1.0-1.1 g     |
| old road          | 0.72  | Zastava 101 (165/70 R13)             | 0.8       | period road tyre ~0.8 g         |

No per-car grip multiplier hides a balance problem: M3 and GT2 run `axle.grip` 1 on both axles; the balance comes from the
weight split, the tyre stagger and the set-up (see "Weight distribution and inertia"). Rally tyre families: tarmac - wide,
shallow tread, stiff sidewall; gravel - deep blocky tread, tall sidewall; mixed - medium blocks. Off its surface a tarmac tyre
skates and lets go suddenly, a gravel tyre on tarmac squirms but is easy to catch.

### Tyre sizes (`CarPhysicsDef.tyres`)

`TyreSize` = sidewall marking (`205/65 R15` -> `{ width: 0.205, aspect: 65, rim: 15 }`); `tyres.size` is the default,
`tyres.byCompound` overrides it (rally teams change the **rim with the compound**), `tyres.rear` gives the rear axle its own
sizes (staggered RWD cars; missing = the front's). The default front size rolls on `wheelRadius`; any other size on
`wheelRadius` scaled by its overall radius (`rim * 0.0127 + width * aspect / 100`, `tyreRadius`) over the default's
(`axleRadius`, set per wheel in `Vehicle.setTyre`), so a car's default handling stays as measured. The hubs stay put (the
model's), so a taller tyre lifts its end of the car, and the gearbox sees the driven axle's radius (`drivenRadius`: gear
speeds, top speed). Every size stays within 4 % of `wheelRadius` (a staggered rear 8 %) and its width within 5 cm of
`wheelWidth` (water drag / hull) - tested. Each axle grades its own size (`carSurfaces(def, tyre, axle)`; one shared table
when both axles run one size); the autopilot plans with the lower axle. 4WD cars keep one radius on both axles (the centre
coupling compares wheel spin; tested).

| Car / compound                | Front      | Rear       | Rolling radius F / R |
| ----------------------------- | ---------- | ---------- | -------------------- |
| Skoda Rally - gravel, mixed   | 205/65 R15 | =          | 0.321 m              |
| Skoda Rally - tarmac          | 235/40 R18 | =          | 0.320 m              |
| Zastava 101 - tarmac          | 165/70 R13 | =          | 0.284 m              |
| Zastava 101 - mixed           | 145/80 R13 | =          | 0.285 m              |
| Zastava 101 - gravel          | 155/80 R13 | =          | 0.293 m              |
| Bimmer M3 - tarmac, mixed     | 245/40 R18 | 265/40 R18 | 0.330 / 0.338 m      |
| Bimmer M3 - gravel            | 205/65 R16 | =          | 0.340 m              |
| Bimmer GT2 - tarmac           | 300/34 R18 | 310/41 R18 | 0.334 / 0.359 m      |
| Bimmer GT2 - mixed            | 245/42 R18 | 265/48 R18 | 0.335 / 0.359 m      |
| Bimmer GT2 - gravel           | 235/50 R17 | 235/60 R17 | 0.337 / 0.361 m      |
| Fiesta - tarmac, mixed        | 235/40 R18 | =          | 0.325 m              |
| Fiesta - gravel               | 215/65 R15 | =          | 0.333 m              |
| Citroen C4 - tarmac, mixed    | 235/45 R18 | =          | 0.336 m              |
| Citroen C4 - gravel           | 215/65 R15 | =          | 0.332 m              |
| Lancer EVO VI - tarmac, mixed | 235/40 R18 | =          | 0.316 m              |
| Lancer EVO VI - gravel        | 205/60 R15 | =          | 0.307 m              |
| Subaru 22B - tarmac, mixed    | 235/40 R17 | =          | 0.310 m              |
| Subaru 22B - gravel           | 215/55 R16 | =          | 0.322 m              |

The Zastava gets the period 13" steel sizes (wider 165/70 on tarmac, taller 155/80 on gravel); the M3 the V8 (E92) road
M3's staggered 18s; the GT2 its slicks (30/66-18 front, 31/71-18 rear = width cm / overall diameter cm - rim), keeping the
taller rear on the rally compounds but one width on gravel (a wide tyre ploughs on loose ground). The GT2's final drive
went up x 1.076 with the taller rear (no published ratios: its gear speeds stay). The M3
keeps the game's close-ratio box: the E92's 6-speed (4.055 ... 0.872, 3.846 final) spun it on loose gravel at full
throttle even with TC.

Size factors (`sizeFactors`, reference 205/65 R15 = 1; `w` = width / 0.205, `h` = sidewall height / 0.133 m):

| Factor                       | Formula                                    | Zastava 145/80 | Skoda Rally 235/40 | Bimmer M3 245/40 | 205/65 (Skoda / M3 gravel) |
| ---------------------------- | ------------------------------------------ | -------------- | ------------------ | ---------------- | -------------------------- |
| mu on hard ground            | `w ^ 0.3`                                  | 0.90           | 1.04               | 1.05             | 1.00                       |
| mu on loose ground           | `w < 1 ? w ^ 0.12 : 1 - 0.22 * (w - 1)`    | 0.96           | 0.97               | 0.96             | 1.00                       |
| blend hard -> loose          | by `surface.loose` (0 tarmac ... 1 gravel) |                |                    |                  |                            |
| response (peak slip / angle) | `h ^ 0.3` (low profile = sharper)          | 0.96           | 0.90               | 0.91             | 1.00                       |
| slide (forgiveness)          | `h ^ 0.1`                                  | 0.99           | 0.97               | 0.97             | 1.00                       |
| rolling on loose             | `1 + 0.3 * max(0, w - 1)` x `loose`        | 1.00           | 1.04               | 1.06             | 1.00                       |

So the Zastava's thin tyres lose grip everywhere (least on loose ground); the M3's 245/40 street tyres are a little wider and
lower than the Skoda Rally's tarmac tyre, but their road-tyre grade (0.82) puts it below the rally car on tarmac, and on gravel
both run the reference 205/65 size. The M3's wider 265 rear gains on hard ground but loses on loose ground; with `axle.grip` 1
the launch on loose ground is held straight by the traction term of TC (`car-setup.test.ts` "straight-line launch").

### Suspension set-ups (`physics/car-setup.ts`)

Every car has three presets, always **Soft / Medium / Stiff** (springs yellow / orange / red in the menu), but each car
defines its own values - that is where its **limits** live. `CarPhysicsDef.setups` holds them, `CarPhysicsDef.setup`
names the preset the base axle numbers equal, `applySetup(def, id)` returns the car with a preset, `deriveSetups` builds
the presets from spring rates + travel (dampers scale with `sqrt(spring)` so the damping ratio stays put, anti-roll bars
with the spring rate).

**Roll and dive**: tyre forces act `forceHeight` of the way up from the contact patch to the centre of mass (0.15, Zastava
0.2), so 85 % of the real moment leans the body; the anti-roll bars add roll stiffness on top of the springs (they do
nothing for dive). A real car puts the whole moment into the body, so this stays above zero to keep rally cars from
flipping on a sideways trip; `integration-tests/rally/rollover.test.ts` guards that margin.

**Weight distribution and inertia**: the centre of mass is the body origin, so the front share of the weight is where the
axles sit against it (`buildWheels`). A car keeps the split its model came with unless the real car is more than 3 points
away: the GT2 is 45 / 55 and the Lancer 55 / 45, set with `shiftCom` (`cars/shared/com-shift.ts`: axles, hull, boxy profile
and door plate move together, the wheelbase and the model on its wheels stay); `tests/rally/weight-split.test.ts` holds
every car to its target. Each car has its own `inertia` (pitch / yaw / roll, kg m²): radius of gyration x mass from where
the mass sits, estimated (about +-15 %, no rally car publishes one); a solid box of the car's size was 10-25 % high on roll.
At the limit every car understeers (the fronts reach their peak first): with equal grip on both axles the rear axle uses
84-94 % of its grip when the front is at the limit on tarmac (M3 90 %, GT2 85 %, rally cars 84-89 %, 22B 94 %, Zastava 91 %),
and 90-100 % on gravel (M3 and GT2 ~100 %, nearly neutral; they step out on power). The front / rear anti-roll split moves
the balance by only a couple of per cent, the weight split, tyre stagger and tyre class move it. The M3 weighs what the real
E92 does, 1,680 kg (BMW USA curb weight): its springs, dampers, bars and brake clamps are scaled by 1680 / 1180 to keep ride
frequency, damping ratio and roll angle of the lighter model it started as.

**Dampers and bump stop** (`suspensionPass`): rebound is ~1.8x bump (Zastava 1.6x: softer road dampers keep it
climbing steep, twisted ramps), so the body settles after a jump instead of bouncing. The bump stop is progressive: it
starts over the last 35 % of the travel (`STOP_ZONE`) with a rate rising from zero, which softens hard landings on cars
that bottom out. Short-travel cars that rarely bottom out (Bimmer M3, Bimmer GT2, Subaru 22B) keep only the stiff stop
past full travel (`hardBumpStop`). Next step if small ruts feel harsh: two-stage (speed-dependent) damping. Research,
also in the game's About screen (`SUSPENSION_RESEARCH` in `game/menu.ts`):
[racing game approaches](https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs),
[offroad driving simulation](https://www.gamedeveloper.com/programming/rendering-and-simulation-in-offroad-driving-game),
[asymmetric damping, arXiv 2605.05235](https://arxiv.org/abs/2605.05235).

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

Damping ratio stays 0.25-0.8 on every axle of every preset (tested; ~0.35 bump / ~0.65 rebound). The **recommended
set-up follows the recommended tyre** (`SETUP_FOR_TYRE`: gravel -> soft, mixed -> medium, tarmac -> stiff), using the
car's own preset of that name. So the Skoda Rally can be set up properly for any stage, the Zastava is always soft-ish (rides
bumps, rolls on tarmac), the Bimmer M3 always stiff-ish (sharp on tarmac, skips on gravel even on its softest).

### Gearing (`physics/gearing.ts`)

A third setup row: **Short / Medium / Long** final drive (the gearbox ratios stay - like a rally team swapping the final
drive for a fast or a twisty stage). Only the race cars carry presets (`CarPhysicsDef.gearings`); the Zastava's gearing is
fixed (setup screen: one "Standard" box, "no configuration available"). Medium is always the car's own
`gearbox.finalDrive`. `applyGearing(def, id)` after `applySetup`; `topSpeed(def)` (wheel force vs drag + rolling, capped by
the redline) is the setup screen's number and matches the sim within 2 km/h; the box chart shows each gear's redline speed
capped at that top speed, both for the fitted tyre (a taller tyre gears longer; the table: the default size). A map can recommend a gearing (`MapDef.gearing`, missing = medium): Jackie and Ajvatovci recommend `long`.

| Car         | Short          | Medium (own)           | Long           |
| ----------- | -------------- | ---------------------- | -------------- |
| Skoda Rally | 5.2 - 146 km/h | 4.6 - 165 km/h         | 3.7 - 206 km/h |
| Bimmer M3   | 4.8 - 224 km/h | 4.2 - 256 km/h         | 3.8 - 282 km/h |
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
without it the Tarmac tyre arrived at Petralica's gravel at 116 km/h and slid 30 m off the road). It steers like a driver
who knows the car swings: the lock shrinks above 9 m/s (past the front tyres' peak slip angle the lock only washes the
front out), a yaw-rate term damps the swing about the pursuit curve (a rear-drive car with equal axle grip on loose ground
has a lightly damped yaw mode), and in the air it lifts and holds the wheels near straight.

### Tyre temperature (`physics/tyre-temp.ts`)

Cold tyres grip less, tyres overheated by sliding grip less, in between they are at full grip. One temperature per tyre
(`WheelState.temp`), only with a climate (`Vehicle.setClimate`; the game sets it from the map, `null` = off, so tool
pages and the reference tests above are unchanged).

- **Climate:** `EnvironmentDef.airTemp` (°C, default 20; Ajvatovci 30, Jackie 17, test 20, Petralica 28, `?air=` to try)
  and the sun (`stageClimate`: sun height after `?tod=`, `cloudCoverage`, default 0.4; Ajvatovci 0.1). Track temperature = air + sun x `SurfaceDef.heat`
  (tarmac 1 ... grass 0.3, snow 0).
- **Heat:** sliding work (`|F| x slide speed / static load`, the stones take 60 % of it on loose ground) + carcass flex
  (speed x load). **Cooling:** air (more with speed), the ground (towards the track temperature), water. Capped at 150 °C.
  Tyres start a stage at the air temperature (`resetTyreTemps` on start / restart; reset to road keeps them).
- **Grip:** `TyreDef.temp` window per compound; below it grip falls to `cold` over 45 °C, above it to `hot` over 35 °C
  (smoothstep), and loose ground halves the loss (tread bites, rubber matters less). The factor multiplies the wheel's
  grip input (`tire.ts` and the cached surface tables are untouched); the autopilot's corner plan includes it
  (`tempGripFor`).

| Tyre        | Window    | Cold grip | Overheated grip | Heat-up | Load sensitivity | Cold pressure |
| ----------- | --------- | --------- | --------------- | ------- | ---------------- | ------------- |
| Tarmac Soft | 66-104 °C | 0.72      | 0.78            | 1.0     | 0.14             | 1.85 bar      |
| Tarmac Hard | 78-120 °C | 0.70      | 0.86            | 0.9     | 0.12             | 1.85 bar      |
| Mixed       | 60-100 °C | 0.80      | 0.84            | 1.0     | 0.12             | 1.80 bar      |
| Gravel Hard | 58-98 °C  | 0.86      | 0.88            | 0.75    | 0.09             | 1.80 bar      |
| Gravel Soft | 46-86 °C  | 0.90      | 0.83            | 0.85    | 0.10             | 1.75 bar      |

Beyond the grip level (`TyreDef.heat`, `loadSens`, `pressure`; numbers scaled from road / FSAE / rally press data, not
measured on rally tyres):

- **Response:** a cold tyre peaks at a smaller slip angle (x0.85 at the cold floor), a cooked one is lazier (x1.15):
  `tempResponse` scales `peakSlip` / `peakAngle` in `tire.ts` (`TireInput.response`); loose ground halves it.
- **Load sensitivity:** grip lost per unit of load above the static corner load, per compound (softer rubber loses more),
  x0.6 on fully loose ground; it is what makes the load transfer of a leaning car cost grip.
- **Pressure:** a fixed fill at 20 °C (`FILL_TEMP`) follows the gas law with the gas at half the tread's rise over the air
  (`gasPressure`), so a stage starts ~15 % under the hot target (`targetPressure`: the window's middle) and a cold /
  hot day moves it a few %. Off target: grip x`1 - 0.7 dp²` under, `1 - 0.4 dp²` over, response x`1/(1 + 0.5 dp)`, heat
  x`1 + 0.8 (under) / 0.3 (over)` (`WheelState.pressure`; `F2` shows it). Pressure effects stay under ~2 % near target.
- **Not modelled:** a direct track-temperature term (research bound: < 1.5 % on the shipped stages, the tyre's own
  temperature dominates), tyre wear, wet.

Feel targets (`tests/rally/tyre-temp.test.ts`, Skoda Rally, tarmac tyre, 20 °C): a 60 km/h circle reaches the window in
~14 s, a donut overheats it in ~6.5 s and 60 km/h straight cools it back in ~10 s; cold vs warm lateral g 0.81 vs 0.95.
On a stage the careful autopilot warms its home tyre into the window in ~30 s. Gravel runs cool and tarmac hot, so a
tarmac tyre on gravel also stays cold, and a gravel tyre on tarmac overheats sooner.

HUD: four tyres in the dash, white (cold) -> green (window) -> yellow -> red (`game/tyre-gauge.ts`), air / track
temperature under them; `F2` shows temperature and grip factor per wheel.

Research behind the model (also in the game's About screen under Physics > Tyres, `TYRE_RESEARCH` in `game/menu.ts`):

- [Tyre friction vs temperature, rig test](https://pmc.ncbi.nlm.nih.gov/articles/PMC9459800/): grip curve, warm-up
  under sliding
- [Izze Racing tyre temperature white paper](https://www.izzeracing.com/ewExternalFiles/Izze_Racing_White_Paper_Tire_Temperature.pdf):
  grip vs temperature shape
- [arXiv 2602.22078](https://arxiv.org/pdf/2602.22078): glass transition, peak grip temperature
- Pirelli press, [tarmac (Rally Spain)](https://press.pirelli.com/p-zero-ra-wrc-shows-reliability-on-wet-and-dry-asphalt/)
  and [gravel (Rally Finland)](https://press.pirelli.com/scorpion-kx-soft-stars-on-opening-day-of-rally-finland/): real
  rally tyre temperatures
- [Pirelli press, the WRC tyre range](https://press.pirelli.com/pirelli-returns-to-the-wrc-with-a-renewed-tire-range/): tarmac
  hard / soft, gravel hard / soft
- [Demon Tweeks, choosing rally tyres](https://blog.demon-tweeks.com/motorsport/how-to-choose-rally-track-tyre/): soft = more
  grip; [Edmunds, 2008 M3](https://edmunds.com/bmw/m3/2008/review): road-tyre braking

### Brakes (`physics/brakes.ts`)

A wheel's brake is its real hardware: `CarPhysicsDef.brakes` = front / rear `BrakeDef` (vented / solid disc or drum,
diameter, thickness, pad class, `clamp` force at full pedal). Torque = 2 x clamp x pad mu x 0.425 D (a drum: clamp x mu
x D x 1.5, self-energising). The Skoda, Fiesta, C4 and Lancer add `gravelBrakes`, the 300 mm kit of the 15 in wheels, fitted
with the mixed and gravel families (`Vehicle.setTyre`, `brakeKit`). The brake acts on the wheel's effective inertia
(`wheelPass`), so the tyre force settles at torque / radius.

- **`clamp` is the one tuned number** per axle and kit: the rally cars (tarmac kit 1.37 g, gravel kit 1.20 g of total torque
  limit, 75 / 72 % front) and the GT2 (1.83 g, 61 % front: more than its 45 % static front weight, so the fronts lock first and it stays stable under
  braking) keep headroom over their tyre; the M3 (1.35 g, 64 % front) is limited by its road tyre, the Zastava and the 22B by their brakes
  (period or road-car brakes: 100-0 on tarmac 52 / 38 m against ~53 / 36-39 m in road tests).
- **Pads** (`PADS`): friction factor against the disc's bulk temperature, rising from the cold factor at 20 °C to 1 at `full`,
  flat to `fade`, then falling to a floor: road 100 / 330 / 600 C, sport 150 / 450 / 700, rally 250 / 650 / 850, race 300 /
  750 / 950; floors 0.45-0.55, cold 0.65-0.9. A drum uses a lower window (80 / 250 / 450) and torque = factor^1.4.
- **Heat** (only with a climate, `Vehicle.brakeTempPass`): the braking work (torque x wheel speed) x 0.94 goes into the
  disc, c(T) of cast iron; it loses heat to the air (`h = 8 + k v^0.8` on the faces and vanes: vented x2, ducted GT2 x5, drum
  x0.38), radiation and water. Discs start 80 K over the air (the liaison to the start line); wet pads give 30 % less.
  One 100-0 stop warms a Skoda front disc ~50 K (gravel kit ~75), a Zastava front ~130; ten 150-60 km/h stops 30 s
  apart take the Skoda to ~470 C, the Zastava past 950 C (pads at the floor); a 600 C disc is under 300 C after ~4 min at 100 km/h.
- **Autopilot:** plans its braking with `Vehicle.brakeDecel` (the brakes' pull now, so fade slows it down early).
- **Not modelled:** brake fluid / caliper limits, pad wear, disc glow (an optional visual), a brake-bias control.

HUD: a thin disc mark beside each tyre in the dash (white cold, green biting, yellow fading, red at the floor,
`game/tyre-gauge.ts`); `F2` lists the disc temperatures and the pull left.

Research behind it (About > Physics > Brakes, `BRAKE_RESEARCH` in `game/menu.ts`): [Brembo WRC](https://www.brembo.com/en/motorsport/wrc),
[Skoda Motorsport R5 brakes](https://www.skoda-motorsport.com/en/6-interesting-facts-about-fabia-r5-brakes-rally-technology/),
[AP Racing disc temperatures](https://apracing.com/race-car/brake-discs/disc-temperatures),
[DBA rotor bulletin](https://dba.com.au/wp-content/uploads/2022/10/Technical_Bulletin_DBA_MotorSport_Important_Information.pdf),
[Autospeed pad table](https://autospeed.com.au/cms/A_0351/printArticle.html),
[Adamowicz and Grzes](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-article-BPB2-0068-0006/c/httpwww_actawm_pb_edu_plvolumevol6no2adamowiczgrzesen2012015.pdf).

## Reference numbers

Full brake, ABS on (`brake-sweep` style probe, flat ground, warm tyres, medium set-up), home tyres, 100-0 km/h in metres
(`tests/rally/abs.test.ts` guards ABS: fronts stay unlocked and steering under full brake):

| Car           | Tarmac tyre on tarmac | Gravel tyre on gravel | Front share of the brake torque |
| ------------- | --------------------- | --------------------- | ------------------------------- |
| Skoda Rally   | 31.4                  | 45.5                  | 75 % (gravel kit 72 %)          |
| Bimmer M3     | 36.6                  | 48.0                  | 64 %                            |
| Bimmer GT2    | 25.9                  | 49.9                  | 61 %                            |
| Subaru 22B    | 38.5                  | 44.9                  | 75 %                            |
| Fiesta WRC    | 31.6                  | 46.0                  | 75 % (72 %)                     |
| Citroen C4    | 31.1                  | 46.0                  | 75 % (72 %)                     |
| Lancer EVO VI | 31.9                  | 45.4                  | 75 % (72 %)                     |
| Zastava 101   | 52.4 (no ABS)         | 54.3 (no ABS)         | 75 %                            |

At part pedal (60 %) no wheel locks and the distances match. Compare with ABS off in the harness via
`Cfg.patch: (v) => { v.abs = false; }` (`straight().full.firstLock` is `-` with ABS on). First stop of a stage (cold tyres, discs
80 K over the air, 20 °C): Skoda 46.8 m, M3 47.5, GT2 35.8, Zastava 61.5 - mostly the cold tyre, not the pads.

Peak lateral g at 80 km/h on flat ground (ramp steer, medium set-up; `integration-tests/rally/handling.test.ts` has the full
set), and the balance: the rear axle's grip use when the front is at its limit (100 % = neutral), tarmac tyre on tarmac /
gravel tyre on gravel:

| Car         | Tarmac Soft on tarmac | Mixed on tarmac | Gravel Soft on gravel | Balance tarmac / gravel |
| ----------- | --------------------- | --------------- | --------------------- | ----------------------- |
| Skoda Rally | **1.17**              | 1.02            | **0.85**              | 87 % / 92 %             |
| Zastava 101 | **0.78**              | 0.67            | **0.73**              | 91 % / 93 %             |
| Bimmer M3   | **1.05**              | 0.93            | **0.83**              | 90 % / 99 %             |
| Bimmer GT2  | **1.44**              | 1.12            | **0.81**              | 85 % / 100 %            |
| Subaru 22B  | **1.14**              | 1.02            | **0.85**              | 94 % / 93 %             |
| Fiesta WRC  | **1.17**              | 1.05            | **0.84**              | 84 % / 90 %             |
| Citroen C4  | **1.19**              | 1.07            | **0.85**              | 89 % / 93 %             |
| Lancer EVO  | **1.18**              | 1.06            | **0.86**              | 89 % / 93 %             |

The home tyre family is the best on every surface for every car (`tyres.test.ts`). Whole-car handling per car (balance,
braking, keyboard, ride): `integration-tests/rally/handling.test.ts` (`HANDLING_OUT=out.json` writes every number).

### Stage times

Skoda Rally, every tyre with its matching set-up, both drivers (`tyres.test.ts`, 2026-10-09); s, in the order tarmac soft /
tarmac hard / mixed / gravel hard / gravel soft, recommended in bold:

| Map (recommended)    | Careful driver                            | Limit driver (`useExtraGrip`)             |
| -------------------- | ----------------------------------------- | ----------------------------------------- |
| `test` (gravel)      | 84.3 / 87.5 / 70.7 / 68.2 / **68.1**      | 84.3 / 87.5 / 70.7 / 67.6 / **67.1**      |
| `petralica` (gravel) | 461.9 / 469.3 / 414.6 / 406.5 / **406.2** | 439.1 / 447.1 / 397.1 / **394.2** / 395.5 |
| `jackie` (tarmac)    | **201.6** / 201.7 / 201.8 / 202.2 / 202.2 | **188.8** / 189.0 / 191.4 / 198.3 / 199.9 |
| `ajvatovci` (mixed)  | 161.4 / 161.8 / **160.4** / 160.7 / 160.6 | 155.5 / 157.2 / **150.8** / 157.9 / 157.7 |

Every car, careful driver, recommended pick / worst pick (`car-matrix.test.ts`, 2026-10-09; worst = tarmac tyres on a gravel
stage, gravel tyres on a tarmac or dusty one). The other rally cars (22B, Fiesta, C4, Lancer) sit within 1-2 % of the Skoda:

| Map (recommended)    | Skoda Rally       | Zastava 101   | Bimmer M3     | Bimmer GT2        |
| -------------------- | ----------------- | ------------- | ------------- | ----------------- |
| `test` (gravel)      | **68.0** / 82.0   | 77.5 / 101.2  | 70.1 / 91.5   | 69.8 / 87.6       |
| `petralica` (gravel) | **406.2** / 461.1 | 498.6 / 548.4 | 417.2 / 516.8 | 413.1 / 481.9     |
| `jackie` (tarmac)    | 201.4 / 202.1     | 224.3 / 262.2 | 201.5 / 202.7 | **198.1** / 200.3 |
| `ajvatovci` (mixed)  | 160.3 / 160.5     | 194.6 / 203.1 | 165.6 / 165.1 | **159.1** / 161.2 |

Reading it: the recommended tyre is the fastest (or within 0.5 %) with the limit driver on every stage, and the wrong tyre on
gravel costs the most (tarmac tyres +26 % on the test map, +11 % on Petralica; a hard tarmac tyre is worse still). On tarmac
the careful driver can't show the gain - it never corners above the gravel baseline and is capped at 151 km/h, so every tyre
ties within 0.5 % - the limit driver does (gravel tyres +6 % on Jackie, Mixed ahead by 3-5 % on Ajvatovci). A hard compound
never beats the soft one by more than 0.3 % (Petralica): the four stages run at 17-30 °C, so the soft tyre stays inside its
window and the hard one only gives up peak grip. Car character: the AWD rally cars lead on gravel; the M3 (road tyres, 1,680 kg) is
~3 % behind them on gravel and mixed and level on Jackie; the GT2 (slicks) beats the Skoda on tarmac and mixed but is 2-3 %
behind on gravel; Zastava is slowest everywhere (power and old road tyres). Rank checks: `car-matrix.test.ts`.

## Tests

| File                                         | What it holds                                                                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/rally/vehicle.test.ts`                | per-car bands (0-100, braking, top speed), lateral g ranks per surface - no tyre fitted (raw surfaces)                                                                                                                                   |
| `integration-tests/rally/stage.test.ts`      | every car finishes every map with the autopilot, upright (raw surfaces)                                                                                                                                                                  |
| `integration-tests/rally/tyres.test.ts`      | tyre data complete; the home family is best on its surface, mixed never best / worst; careful + limit driver per stage with the stage climate (the recommended tyre is within 0.5 % of the fastest)                                      |
| `tests/rally/tyre-types.test.ts`             | five tyres in three families, hard vs soft windows, tyre grade (road < rally < slick, loose ground keeps 40 %), M3 mass, no grip multiplier on M3 / GT2, TC traction term holds the launch under the peak slip                           |
| `tests/rally/car-setup.test.ts`              | sizes fit `wheelRadius` per axle; presets: damping, ride height per preset (body, wheels), compliance range per car; width effects; car vs car lateral g; straight launch on loose ground (every car reaches 100 km/h pointing straight) |
| `integration-tests/rally/car-matrix.test.ts` | every car x stage on the recommended and the worst pick finishes upright; cars rank by character; set-up alone is worth time                                                                                                             |
| `tests/rally/tyre-mesh.test.ts`              | tyre geometry: budget, size, tread depth order, rim switch (rendering, but sized from the physics data)                                                                                                                                  |
| `tests/rally/suspension-mesh.test.ts`        | coil-over geometry: length by travel, coils / wire by rate, one style per car                                                                                                                                                            |
| `tests/rally/water-physics.test.ts`          | dry / shallow / deep acceleration per car                                                                                                                                                                                                |
| `tests/rally/abs.test.ts`                    | ABS keeps the front wheels unlocked and steering under full brake (tarmac, gravel); a car without ABS ignores the setting                                                                                                                |
| `tests/rally/hull-fit.test.ts`               | every car's collision hull follows its model: underside per zone (front overhang, between axles, rear overhang) and the nose / tail ends; prints the profile                                                                             |
| `integration-tests/rally/gearing.test.ts`    | gearing presets: race cars only, medium = own final drive, short < medium < long top speed, setup-screen top speed = sim, Skoda Rally on long reaches 200 km/h on Jackie                                                                 |
| `tests/rally/tyre-temp.test.ts`              | tyre temperature: grip curves per compound, HUD colours, climate per stage, cold vs warm grip, warm-up, a donut overheats and cools down, gravel heats less, reset keeps temperatures                                                    |
| `tests/rally/brakes.test.ts`                 | brakes: torque from size + clamp, disc mass, pad windows per class, heat per stop, ten-stop fade (road yes, rally no), cooling, water, torque = force x radius, cold / faded brakes pull less                                            |
| `integration-tests/rally/tyre-temp.test.ts`  | every car x stage with the stage climate, recommended and worst pick: finishes upright (one reset if stuck), tyres under 150 °C, discs under 1300 °C, home tyre warm at the finish                                                       |
| `integration-tests/rally/handling.test.ts`   | whole-car handling per car x tyre x set-up x surface (`handling-harness.ts`): ramp / step steer, lift / power / brake mid-corner, handbrake, slalom, keyboard lock, braking, drops, jump landing, ruts                                   |

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
  numbers. Gearing follows the driven tyre's radius (`drivenRadius`), so a compound with a taller tyre gears longer.

## Open work

- [ ] **Hot-day stage or weather**: the hard compounds only pay off once a stage runs hot (soft overheats); none does today.
      Also camber gain with roll (next chassis phase) will move the front / rear balance.
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
