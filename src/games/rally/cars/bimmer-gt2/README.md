# Bimmer GT2 (`bimmer_gt2`)

A wide-body E92 M3 GT2-style racer (splitter, big wing, diffuser, side exhaust) converted from Tushar Singh's **CC BY** "E92 Barnfind"
Sketchfab model. The GLB came split by material, so glass, kidneys, intakes, carbon parts and mirrors are separate parts, and the
front bumper lip and side skirts (carbon, cut along the original texture's border), intake mesh panels, headlights (housing, projectors, LED rings) and tail lamps (3D slats, red LED strip, covers) keep their modelled geometry.
Specs follow the M3 GT2 (ALMS) race car (357 kW / 485 hp, 1,150 kg; [BMW M](https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m3-e92-e90-and-e93.html)),
RWD V8, faster than the Bimmer M3 on every surface. Wheels: tarmac tyres (300/30 R19) wear the model's own BBS mesh wheel
(`bimmer_gt2_wheel.glb`); mixed (245/45 R18) and gravel (235/50 R17) wear the Bimmer M3 rim painted black. Clean base livery for now.
**Test only** (`TEST_CARS` in `release.ts`).

![Front three-quarter](screenshots/front-34.jpg)

|                                                |                               |
| ---------------------------------------------- | ----------------------------- |
| ![Rear three-quarter](screenshots/rear-34.jpg) | ![Side](screenshots/side.jpg) |

```bash
npm run dev     # /games/rally/car-viewer.html?car=bimmer_gt2
```

## Files

| File                | What                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `bimmer-gt2.ts`     | `CarDef`: drivetrain, tyres, set-ups, body-fitted hull, fallback body, glTF  |
| `livery.ts`         | body atlas painter: base colour + dark undercoat                             |
| `model.source.json` | GLB material -> part mapping, scale / offset, atlas layout (read at runtime) |

The models live in `public/models/cars/bimmer_gt2.glb` (+ `bimmer_gt2_wheel.glb`, cut from the same model by `scripts/car-model/glb-wheel-extract.py`); the raw download stays out of git (`sources/`, local only).

## Credits and licence

| What        | Source                                                                                                                              | Licence       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Model (GLB) | ["E92 Barnfind" by Tushar Singh, Sketchfab](https://sketchfab.com/3d-models/e92-barnfind-550c4113c2a34b0693e9ee6e7773d840)          | **CC BY 4.0** |
| Specs       | [BMW M - BMW M3 E92, E90 and E93](https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m3-e92-e90-and-e93.html) (numbers only) | reference     |

The converted model is a derivative (split, simplified, repainted). BMW and M3 are trademarks of BMW AG and only identify the car. The
model's roundel logos and number plate are removed, its Gulf-style rust paint is not used; the game paints its own livery. Code and
livery: [PolyForm Noncommercial 1.0.0](../../../../../LICENSE).
