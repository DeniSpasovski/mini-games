# Subaru WRX STI 22B (`subie_22b`)

A 1998-style blue Group A coupe with the works side graphic: a yellow crescent, three rising streaks and a cluster of
four-point stars on the rear quarter (generic shapes, no logo or lettering). 2.2 l turbo flat-four (~280 PS, 363 Nm), five-speed
box, permanent AWD with a rear bias, 1,270 kg ([STI](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)). Wheels are the game's own (centred on the hubs
by construction): 235/45 R17 on tarmac, 215/60 R16 on gravel. **Test only** (`TEST_CARS` in `release.ts`).

![Front three-quarter](screenshots/front-34.jpg)

|                                                |                               |
| ---------------------------------------------- | ----------------------------- |
| ![Rear three-quarter](screenshots/rear-34.jpg) | ![Side](screenshots/side.jpg) |

```bash
npm run dev     # /games/rally/car-viewer.html?car=subie_22b
```

## How it is built

- The body is the generic loft (`model.stations` / `cabin` in `subie-22b.ts`), no GLB. The station numbers (floor, belt, half
  widths, wheelbase 2.52 m, cabin z) were measured on the reference model below; nothing of its mesh or texture ships.
- The livery is the `star` style in `cars/shared/livery.ts` (side charts only; roof, bonnet and ends stay plain blue).
- `hull-fit.test.ts` treats the stations' floor line as the underside of a generic body.

## Credits and licence

| What                | Source                                                                                                                              | Licence                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Size / section data | ["Subaru Impreza" by Mateusz Woliński](https://sketchfab.com/3d-models/subaru-impreza-7fb4298d5d8f4185b25bb2c43d7f3787) (Sketchfab) | CC BY-NC 4.0 (reference) |
| Specs               | [STI Impreza 22B](https://www.sti.jp/en/roadcars/1998/impreza-22b.html)                                                             | looked at only           |

Code and the star graphic: PolyForm Noncommercial 1.0.0 (see the root [LICENSE](../../../../../LICENSE)). The noncommercial
reference licence is why this car must stay out of any commercial fork.
