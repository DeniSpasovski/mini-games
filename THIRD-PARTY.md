# Third-party material

Everything that is not original code or art in this repository, with its licence and its status. Per-map and per-car
README files carry the same information in more detail. Keep this file current when a source is added.

## Licence scope

| Material                                                                                                                                                                | Licence                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source code, procedural assets, docs, screenshots (everything original)                                                                                                 | [PolyForm Noncommercial 1.0.0](LICENSE)                                 |
| Baked map data of the real maps (`maps/<id>/`: `data.json`, `route.json`, `horizon.json`, `junction*.json`, `buildings.csv`, `preview/stage-card.json` + `.jpg` render) | ODbL 1.0 + attribution (derived from OpenStreetMap and other open data) |
| Third-party models and data listed below                                                                                                                                | their own licences; not relicensed by this project                      |

## Software

| Package                                                                         | Licence          | Use                               |
| ------------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| [three.js](https://threejs.org/)                                                | MIT              | rendering (runtime)               |
| Rsbuild, Rspack, Rstest, Rslint, TypeScript, Prettier, happy-dom, meshoptimizer | MIT / Apache-2.0 | build and test tooling (dev only) |

3, 2, 1 Kabooom (`src/games/kaboom/`) uses nothing third-party: its critters, arenas, effects and sounds are original and procedural.

No fonts, textures, sounds or music files are bundled: textures are painted on canvases at runtime, audio is
synthesised with WebAudio, and text uses system fonts.

## Map data (baked into `src/games/rally/maps/<id>/`)

| Data                                                     | Provider                                                                                           | Licence / attribution                                                                                                                              | Used in                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Roads, railways, land use, water, buildings, power lines | [OpenStreetMap](https://www.openstreetmap.org/copyright)                                           | ODbL 1.0, © OpenStreetMap contributors. The baked map files are derived databases and stay under the ODbL                                          | all real maps           |
| Building footprints                                      | [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | ODbL, © Microsoft                                                                                                                                  | Ajvatovci               |
| Roads OSM does not have                                  | [Microsoft ML Road Detections](https://github.com/microsoft/RoadDetections)                        | ODbL, © Microsoft                                                                                                                                  | Petralica, Ajvatovci    |
| Land cover                                               | [ESA WorldCover 10 m 2021](https://esa-worldcover.org/)                                            | CC BY 4.0, © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021)                                                       | all real maps           |
| Elevation (30 m)                                         | [Copernicus DEM GLO-30](https://doi.org/10.5069/G9028PQB) via OpenTopography                       | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA                                    | Petralica               |
| Elevation (5 m lidar)                                    | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program)                             | US public domain, credit USGS 3DEP                                                                                                                 | Jackie Robinson Parkway |
| Junction street surface, medians, sidewalks, trees       | [NYC Planimetric Database, Street Tree Census](https://opendata.cityofnewyork.us/) (NYC Open Data) | no restrictions on use (NYC Open Data); credit NYC Office of Technology and Innovation (OTI)                                                       | Jackie Robinson Parkway |
| Elevation (horizon)                                      | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium)                      | mixed open sources (SRTM, EU-DEM, national datasets), see the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | all real maps           |

Raw downloads are never committed (`sources/` and `scripts/realmap/.cache/` are git-ignored); only the baked,
resampled result is. The in-game credits come from each map's `meta.sources` (`route.json`) and its About links (`info.ts`).

Some roads, properties and outlines were added or traced by hand on top of the open data. No imagery is in the
repository.

## 3D models

| File (`public/models/cars/`)                                                             | Source                                                                                                                                                                                                                                                                                        | Licence                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `bimmer_m3.glb`, `bimmer_m3_wheel.glb`                                                   | "BMW E46 Coupe - Tuning - Model" by Doomas3D (MakerWorld)                                                                                                                                                                                                                                     | CC BY 4.0                    |
| `bimmer_gt2.glb`, `bimmer_gt2_wheel.glb`                                                 | "E92 Barnfind" by Tushar Singh (Sketchfab; split by material and converted, roundel logos + plate removed)                                                                                                                                                                                    | CC BY 4.0                    |
| `skoda_rally.glb`, `skoda_rally_wheel.glb`                                               | "Skoda Fabia R5 Rally Car" by SenturyUK (Sketchfab)                                                                                                                                                                                                                                           | CC BY 4.0                    |
| `subie_22b.glb`, `subie_22b_wheel.glb`, `subie_22b_lamps.png`                            | "Rally Car" by SpatialNeglect (Sketchfab, https://sketchfab.com/3d-models/rally-car-e0dfd3b6d19947df85002fd8de0a3a02; split by node and converted, crew / plates / badge dropped; wheel extracted; lamp art baked from its textures; side graphic redrawn at runtime as shapes, no lettering) | CC BY-NC 4.0 (noncommercial) |
| none (Zastava 101)                                                                       | hand-built in code from a public-domain factory blueprint; shape reference "Zastava 101 (Stojadin)" by Tomislav Tomljenovic (Sketchfab)                                                                                                                                                       | CC BY 4.0                    |
| `fiesta.glb`, `fiesta_wheel.glb`                                                         | "Ford Fiesta WRC" by kevin (Sketchfab)                                                                                                                                                                                                                                                        | CC BY 4.0                    |
| `citroen_c4.glb`, `citroen_c4_wheel.glb`                                                 | "Citroen C4 WRC Red Bull 2007" by Max (Sketchfab; sponsor livery, boot-lid emblem and plate removed, repainted)                                                                                                                                                                               | CC BY 4.0                    |
| `lancer_evo_6.glb`, `lancer_evo_6_wheel.glb`, `lancer_evo_6_{lamps,seat,fabric,cab}.png` | "Mitsubishi Lancer Evolution 6" by vecarz (Sketchfab; converted and repainted, badges + plate removed; lamp and seat textures kept)                                                                                                                                                           | CC BY 4.0                    |

The car liveries, parts, physics, door plates and every other asset are original and generated in code.

## Research references

Papers and articles read to tune the rally tyre temperature and suspension models; linked in the game's About screen and
`src/games/rally/PHYSICS.md`. Nothing from them is copied or bundled.

- https://pmc.ncbi.nlm.nih.gov/articles/PMC9459800/
- https://www.izzeracing.com/ewExternalFiles/Izze_Racing_White_Paper_Tire_Temperature.pdf
- https://arxiv.org/pdf/2602.22078
- https://press.pirelli.com/p-zero-ra-wrc-shows-reliability-on-wet-and-dry-asphalt/
- https://press.pirelli.com/scorpion-kx-soft-stars-on-opening-day-of-rally-finland/
- https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs
- https://www.gamedeveloper.com/programming/rendering-and-simulation-in-offroad-driving-game
- https://arxiv.org/abs/2605.05235

## Trademarks and likenesses

Skoda, Fabia, BMW, M3, Ford, Fiesta, Subaru, Impreza, WRX, STI, Citroen, C4, Mitsubishi, Lancer Evolution, Zastava and other make or model names are trademarks of their owners and appear only to
identify the car that inspired a model. The liveries use no manufacturer, sponsor or series logos. Emergency vehicles
in the Jackie map carry only generic lettering ("POLICE", "FIRE DEPT", "AMBULANCE") and no agency names, logos or badges.
The Subaru WRX STI 22B (test car) carries a crescent-and-stars side graphic redrawn as shapes after a reference picture of
the manufacturer's motorsport emblem, at the owner's request; it is not the picture and has no lettering, but it is the one
exception to "no manufacturer logos" - `cars/subie-22b/livery.ts` drops it.
The signs on the Ajvatovci are approved to be used by owners.
