# Subaru WRX STI 22B (`subie_22b`)

A blue 22B-style widebody coupe (big wing, splitter, diffuser) with the works side graphic: a crescent swoosh and a cluster
of four-point stars, redrawn as shapes after the owner's reference picture (no lettering; see the trademark note below). The
body, glass and 5-spoke alloy are converted from SIU Car Garage's **CC BY-NC** "1999 Subaru MPREZA WRX STi GC8 'Minotaurus'"
Sketchfab model, and so is the lamp art: headlight, tail lamps, corner lens and indicators are the model's own lamp triangles
with their art cut out of its texture (`subie_22b_lamps.png`). The model has no cockpit, so the shared procedural one (seats,
dash, wheel, headliner) shows through the tinted windows. Specs follow the 22B: 2.2 l turbo flat-four (~280 PS / 206 kW at 6000 rpm,
363 Nm at 3200 rpm), five-speed box, permanent AWD with a rear bias, 1,270 kg ([STI](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)).
Tyres 235/40 R17 (the real size; the model's wheel is cut out and centred on the hub axis), 215/55 R16 on gravel. The body is
lifted 5 cm for clearance. The paint is a metallic mica blue (`gltf.metallic`) with dust and road spray towards the sills. **Test only** (`TEST_CARS` in `release.ts`).

![Front three-quarter](screenshots/front-34.jpg)

|                                                |                               |
| ---------------------------------------------- | ----------------------------- |
| ![Rear three-quarter](screenshots/rear-34.jpg) | ![Side](screenshots/side.jpg) |

```bash
npm run dev     # /games/rally/car-viewer.html?car=subie_22b
```

## Files

| File                | What                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `subie-22b.ts`      | `CarDef`: drivetrain, tyres, set-ups, body-fitted hull, fallback body, glTF  |
| `livery.ts`         | body atlas painter: blue base, dark undercoat, side crescent + stars graphic |
| `model.source.json` | GLB material -> part mapping, scale / offset, atlas layout (read at runtime) |

`public/models/cars/subie_22b.glb` (+ `subie_22b_wheel.glb`, `subie_22b_lamps.png`) are the converted models; the raw download stays out of git
(`sources/`, local only).

## Credits and licence

| What  | Source                                                                                                                                                                                  | Licence                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Model | ["1999 Subaru MPREZA WRX STi GC8 Minotaurus" by SIU Car Garage](https://sketchfab.com/3d-models/1999-subaru-mpreza-wrx-sti-gc8-minotaurus-6117b4accfb748e2af4641c1d45bf0cc) (Sketchfab) | CC BY-NC 4.0 (converted) |
| Specs | [STI Impreza 22B](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)                                                                                                                 | looked at only           |

Code: PolyForm Noncommercial 1.0.0. The model's noncommercial licence is why this car must stay out of any commercial fork.
Of the source texture only the lamp art is used (the yellow livery, logos and text are not). **Trademark note:** the side
graphic follows a reference picture of a manufacturer's motorsport emblem that the owner asked for; it is our own redrawn
shapes, not the picture, and is a trademark risk if the repo is ever published beyond a noncommercial hobby project -
`livery.ts` is the only file to change to drop it.
