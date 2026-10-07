# Third-party models

Files in `public/models/cars/` are optional imported car bodies (see
`.claude/skills/rally-content/SKILL.md` -> "Imported models"). When a file is
present the game uses it instead of the procedural body; credits are also shown
in the car viewer.

| File                         | Model                                                                                                                                                                                                                                                           | Author               | Licence   | Source                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `cars/bimmer_m3.glb`         | "BMW E46 Coupe - Tuning - Model" (MakerWorld; the in-game "Bimmer M3") - body STL, labelled by `scripts/car-model/segment-stl.py`, converted by `scripts/car-model/stl-to-glb.mjs`                                                                              | Doomas3D             | CC BY 4.0 | https://makerworld.com/en/models/2056872-bmw-e46-coupe-tuning-model                       |
| `cars/bimmer_m3_wheel.glb`   | "BMW E46 Coupe - Tuning - Model" (MakerWorld) - the model's own 8-spoke rim, cut out by `scripts/car-model/stl-wheel-extract.py` (lip + barrel re-turned), converted by `scripts/car-model/wheel-stl-to-glb.mjs --keep`                                         | Doomas3D             | CC BY 4.0 | https://makerworld.com/en/models/2056872-bmw-e46-coupe-tuning-model                       |
| `cars/bimmer_gt2.glb`        | "E92 Barnfind" (Sketchfab; the in-game "Bimmer GT2") - GLB split by material (`scripts/car-model/glb-to-parts-stl.py`), converted by `scripts/car-model/stl-to-glb.mjs`; wheels, discs, calipers, roundels and plate dropped                                    | Tushar Singh         | CC BY 4.0 | https://sketchfab.com/3d-models/e92-barnfind-550c4113c2a34b0693e9ee6e7773d840             |
| `cars/bimmer_gt2_wheel.glb`  | "E92 Barnfind" (Sketchfab) - the model's own BBS wheel, extracted by `scripts/car-model/glb-wheel-extract.py`, converted by `scripts/car-model/wheel-stl-to-glb.mjs --keep`                                                                                     | Tushar Singh         | CC BY 4.0 | https://sketchfab.com/3d-models/e92-barnfind-550c4113c2a34b0693e9ee6e7773d840             |
| `cars/skoda_rally.glb`       | "Skoda Fabia R5 Rally Car" (Sketchfab) - GLB, primitives mapped by `scripts/car-model/glb-to-parts-stl.py`, converted by `scripts/car-model/stl-to-glb.mjs` (wheels + badges dropped, repainted)                                                                | SenturyUK            | CC BY 4.0 | https://sketchfab.com/3d-models/skoda-fabia-r5-rally-car-fe062f0fd05e43a6a32a88a1aa39ef14 |
| `cars/skoda_rally_wheel.glb` | "Skoda Fabia R5 Rally Car" (Sketchfab) - the model's own rim, exported by `scripts/car-model/glb-to-parts-stl.py`, converted by `scripts/car-model/wheel-stl-to-glb.mjs --keep` (the model's tyre mesh is unused)                                               | SenturyUK            | CC BY 4.0 | https://sketchfab.com/3d-models/skoda-fabia-r5-rally-car-fe062f0fd05e43a6a32a88a1aa39ef14 |
| `cars/fiesta.glb`            | "Ford Fiesta WRC" (Sketchfab) - GLB, primitives mapped by `scripts/car-model/glb-to-parts-stl.py` (root scale fixed by `glb-set-root-scale.py`), converted by `scripts/car-model/stl-to-glb.mjs` (wheels, badge, display bits dropped; cockpit kept; repainted) | kevin                | CC BY 4.0 | https://sketchfab.com/3d-models/ford-fiesta-wrc-8b3f0c6876c74c0480ca04e698582db3          |
| `cars/fiesta_wheel.glb`      | "Ford Fiesta WRC" (Sketchfab) - the model's own rim, de-cambered and centred on the hub by `scripts/car-model/glb-rim-extract.py`, converted by `scripts/car-model/wheel-stl-to-glb.mjs --keep`                                                                 | kevin                | CC BY 4.0 | https://sketchfab.com/3d-models/ford-fiesta-wrc-8b3f0c6876c74c0480ca04e698582db3          |
| _(not shipped)_              | Zastava 101 (Stojadin) - shape reference only, the car is hand-built in code, no GLB is used                                                                                                                                                                    | Tomislav Tomljenović | CC BY 4.0 | https://sketchfab.com/3d-models/zastava-101-stojadin-52c885cfc52a4ac1acb14f84a3feacfa     |

Bimmer M3 (`cars/bimmer_m3.glb`) model + livery references (the M3 ALMS livery it wears; articles, nothing copied):

- https://www.topgear.com/car-news/motorsport/e46-m3-gtr-would-be-ultimate-track-day-toy
- https://www.bmw-m.com/en/topics/magazine-article-pool/bmw-m3-gtr-need-for-speed-most-wanted.html
- https://bimmerlife.com/2026/08/11/the-m3-gtr-took-the-american-le-mans-series-by-storm-25-years-ago/

CC BY 4.0 requires attribution - keep this file and the `credit` fields in
`src/games/rally/cars/*.ts` up to date when adding models. Car makes/models are
trademarks of their owners; this is a non-commercial fan project.
