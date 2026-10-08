# Subaru WRX STI 22B (`subie_22b`)

A blue 22B-style widebody rally coupe (bonnet scoop, big wing, mudflaps, roll cage) with the works side graphic: a crescent
swoosh and a cluster of four-point stars, redrawn as shapes after the owner's reference picture (no lettering; see the
trademark note below). Body, glass, cockpit (left-hand drive, bucket seats, cage), 5-spoke alloy and lamps are converted from
SpatialNeglect's **CC BY-NC** "Rally Car" Sketchfab model; the lamp art is its own texture baked into lamp space
(`subie_22b_lamps.png`, `scripts/car-model/bake-lamp-sheet.py`). The crew figures, plates and badge are dropped. Specs follow
the 22B: 2.2 l turbo flat-four (~280 PS / 206 kW at 6000 rpm, 363 Nm at 3200 rpm), five-speed box, permanent AWD with a rear
bias, 1,270 kg ([STI](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)). Tyres 235/40 R17 (the real size), 215/55 R16 on
gravel. The paint is a metallic mica blue (`gltf.metallic`) with dust and road spray towards the sills. **Test only** (`TEST_CARS` in `release.ts`).

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
| `model.source.json` | GLB node -> part mapping, scale / offset, atlas layout (read at runtime)     |

`public/models/cars/subie_22b.glb` (+ `subie_22b_wheel.glb`, `subie_22b_lamps.png`) are the converted models; the raw download stays out of git
(`sources/`, local only).

## Credits and licence

| What  | Source                                                                                                                  | Licence                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Model | ["Rally Car" by SpatialNeglect](https://sketchfab.com/3d-models/rally-car-e0dfd3b6d19947df85002fd8de0a3a02) (Sketchfab) | CC BY-NC 4.0 (converted) |
| Specs | [STI Impreza 22B](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)                                                 | looked at only           |

Code: PolyForm Noncommercial 1.0.0. The model's noncommercial licence is why this car must stay out of any commercial fork.
Of the source textures the body paint is replaced by our livery; the badge is dropped. **Trademark note:** the side
graphic follows a reference picture of a manufacturer's motorsport emblem that the owner asked for; it is our own redrawn
shapes, not the picture, and is a trademark risk if the repo is ever published beyond a noncommercial hobby project -
`livery.ts` is the only file to change to drop it.
