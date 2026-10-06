# Zastava 101 (`zastava_101`)

The 1970s Yugoslav "Stojadin": a light front-wheel-drive five-door with a mildly tuned 1.3 (about 85 hp), plated
differential and stock 145/80 R13 tyres, painted British racing green. The body is **hand-built in code** from
measured dimensions (`blueprint.ts` -> `body.ts`, no imported mesh): shark nose, body crease, flared arch lips, real
window openings, wrap-round lamps and a modelled cabin. The paint is a procedural atlas with panel gaps, rust and road
dirt. Light and slow, it wins on momentum and understeers if you are greedy.

![Front three-quarter](screenshots/front-34.jpg)

|                                                |                               |
| ---------------------------------------------- | ----------------------------- |
| ![Rear three-quarter](screenshots/rear-34.jpg) | ![Side](screenshots/side.jpg) |

```bash
npm run dev     # /games/rally/car-viewer.html?car=zastava_101
```

## Stats (game engine configuration)

| Stat       | Value                                                            |
| ---------- | ---------------------------------------------------------------- |
| Drivetrain | FWD, 5-speed, final drive 4.4, fixed gearing                     |
| Engine     | ~84 hp at 6500 rpm, 100 Nm peak, redline 7000 rpm                |
| Mass       | 870 kg                                                           |
| Wheels     | radius 0.285 m; 145/80 R13 on every surface                      |
| Top speed  | 160 km/h (drag-limited; 5th would reach 199 km/h at the redline) |

| 0-100 km/h / 100-0 km/h | Tarmac | Dusty tarmac | Gravel | Loose gravel |
| ----------------------- | ------ | ------------ | ------ | ------------ |
| 0-100 km/h              | 10.9 s | 11.4 s       | 11.8 s | 13.3 s       |
| 100-0 km/h, full brake  | 44 m   | 50 m         | 46 m   | 52 m         |

Measured by the physics sim on flat ground (full throttle from standstill, traction control on, each surface on its
home tyre + set-up, 2026-10-04): `straight()` in `tests/rally/handling-harness.ts`. Top speed is the setup screen's number
(`topSpeed()` in `physics/gearing.ts`). Retune a car and these move - rerun and update.

## Credits and licence

| What                        | Source                                                                                                                                               | Licence                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Shape and styling reference | ["Zastava 101 (Stojadin)" by Tomislav Tomljenovic, Sketchfab](https://sketchfab.com/3d-models/zastava-101-stojadin-52c885cfc52a4ac1acb14f84a3feacfa) | CC BY 4.0 (no mesh used) |
| Outlines and dimensions     | a 4-view factory blueprint (outlines traced, dimensions measured);                                                                                   | public domain            |
| Body, paint, physics        | own work                                                                                                                                             | project licence          |

## Files

| File             | What                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `zastava-101.ts` | `CarDef`: physics (+ explicit hull), `custom` body, glass / paint finish, wheels          |
| `blueprint.ts`   | every measured dimension as data / curves (silhouette, edges, sections, arches, windows)  |
| `body.ts`        | mesh builder (`cars/shared/mesh-kit.ts`): painted shell + glass, trim, lamps, cabin       |
| `lamps.ts`       | 3D lamp building blocks: bezel frames, reflector dishes, ribbed lenses, wrap-round lenses |
| `paint.ts`       | atlas layout + UV functions + the paint texture painter                                   |
| `wheels.ts`      | 145/80 R13 tyre (grooved tread, road dust) on a holed steel rim                           |

## Build notes

- Outlines and dimensions come from the 4-view factory blueprint (length 3836, wheelbase 2448 mm), overlay-checked against
  orthographic car-viewer renders; `tests/rally/zastava-body.test.ts` pins them. The blueprint shows the early car (round lamps,
  chrome bumpers): grille, lamps and bumpers follow the later car's photos instead.
- The rear arch is as tight as the real one (2 cm over the tyre): on full bump the tyre pokes into it.
- The rim barrel is a closed 4 mm section (a single surface vanished from inside); the front wheel wells reach 0.36 m in so the
  wheels clear them at full lock.
- No traction control (`physics.noTractionControl`: the assist is always off, the Options row is hidden). Brake light is red
  only (no reversing lamp).
- Tyres, suspension, gearing: [`PHYSICS.md`](../../PHYSICS.md).
  Open work: [`../../TASKS.md`](../../TASKS.md).
