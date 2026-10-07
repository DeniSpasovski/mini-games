# Subaru WRX STI 22B (`subie_22b`)

A blue 22B-style widebody coupe (big wing, splitter, diffuser) with the works side graphic: a yellow crescent, three rising
streaks and a cluster of four-point stars (generic shapes drawn at runtime, no logo or lettering). The body, glass and the
5-spoke alloy are converted from SIU Car Garage's **CC BY-NC** "1999 Subaru MPREZA WRX STi GC8 'Minotaurus'" Sketchfab model.
Specs follow the 22B: 2.2 l turbo flat-four (~280 PS, 363 Nm), five-speed box, permanent AWD with a rear bias, 1,270 kg
([STI](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)). Tyres 235/40 R17 (the real size; the model's wheel is cut out
and centred on the hub axis), 215/55 R16 on gravel. Lamps: the headlight lens and the tail lamps are cut out of the model and
get drawn art (`headlight22` / `tail22` in `part-materials.ts`). The body is lifted 5 cm for clearance. **Test only**
(`TEST_CARS` in `release.ts`).

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
| `livery.ts`         | body atlas painter: blue base, dark undercoat, side star graphic             |
| `model.source.json` | GLB material -> part mapping, scale / offset, atlas layout (read at runtime) |

`public/models/cars/subie_22b.glb` (+ `subie_22b_wheel.glb`) are the converted models; the raw download stays out of git
(`sources/`, local only).

## Credits and licence

| What  | Source                                                                                                                                                                                  | Licence                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Model | ["1999 Subaru MPREZA WRX STi GC8 Minotaurus" by SIU Car Garage](https://sketchfab.com/3d-models/1999-subaru-mpreza-wrx-sti-gc8-minotaurus-6117b4accfb748e2af4641c1d45bf0cc) (Sketchfab) | CC BY-NC 4.0 (converted) |
| Specs | [STI Impreza 22B](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)                                                                                                                 | looked at only           |

Code and the star graphic: PolyForm Noncommercial 1.0.0. The model's noncommercial licence is why this car must stay out of
any commercial fork. The source texture (yellow livery, logos, text) is not used.
