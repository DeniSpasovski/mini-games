# Subaru WRX STI 22B (`subie_22b`)

A blue 22B-style widebody rally coupe (bonnet scoop, big wing, mudflaps) with the works side graphic: a crescent
swoosh and a cluster of four-point stars, redrawn as shapes after the owner's reference picture (no lettering; see the
trademark note below). Body, glass, 3D lamps, exhaust and the gold mesh alloy are converted from Lukas Scheermann's
**CC BY 4.0** "Subaru Impreza 22B_v2" Sketchfab model; the model has no cockpit, so the windows are tinted. Specs follow
the 22B: 2.2 l turbo flat-four (~280 PS / 206 kW at 6000 rpm, 363 Nm at 3200 rpm), five-speed box, permanent AWD with a rear
bias, 1,270 kg ([STI](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)). Tyres 235/40 R17 (the real size), 215/55 R16 on
gravel. The paint is a metallic mica blue (`gltf.metallic`) with dust and road spray towards the sills. **Test only** (`hideInProd` in `CARS_LIST`, `release.ts`).

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

`public/models/cars/subie_22b.glb` (+ `subie_22b_wheel.glb`) are the converted models, narrowed to the real 1.77 m body width with `scripts/car-model/scale-x.mjs` (rerun after a rebuild). The download is modelled at an angle, so
`scripts/car-model/glb-orient.py` turns it nose-first before the conversion (`model.source.json`); the raw file stays out of git
(`sources/`, local only).

## Credits and licence

| What  | Source                                                                                                                                            | Licence               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Model | ["Subaru Impreza 22B_v2" by Lukas Scheermann](https://sketchfab.com/3d-models/subaru-impreza-22b-v2-dbd871a37f80439f982ca523c1de4eef) (Sketchfab) | CC BY 4.0 (converted) |
| Specs | [STI Impreza 22B](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)                                                                           | looked at only        |

Code: PolyForm Noncommercial 1.0.0. The body paint is replaced by our livery; the model's badges and number plate are dropped. **Trademark note:** the side
graphic follows a reference picture of a manufacturer's motorsport emblem that the owner asked for; it is our own redrawn
shapes, not the picture, and is a trademark risk if the repo is ever published beyond a noncommercial hobby project -
`livery.ts` is the only file to change to drop it.
