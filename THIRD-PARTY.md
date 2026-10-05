# Third-party material

Everything that is not original code or art in this repository, with its licence and its status. Per-map and per-car
README files carry the same information in more detail. Keep this file current when a source is added.

## Licence scope

| Material                                                                | Licence                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source code, procedural assets, docs, screenshots (everything original) | [PolyForm Noncommercial 1.0.0](LICENSE)                                 |
| Baked map data (`maps/*/data.json`, `buildings.csv`)                    | ODbL 1.0 + attribution (derived from OpenStreetMap and other open data) |
| Third-party models and data listed below                                | their own licences; not relicensed by this project                      |

## Software

| Package                                                                         | Licence          | Use                               |
| ------------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| [three.js](https://threejs.org/)                                                | MIT              | rendering (runtime)               |
| Rsbuild, Rspack, Rstest, Rslint, TypeScript, Prettier, happy-dom, meshoptimizer | MIT / Apache-2.0 | build and test tooling (dev only) |

No fonts, textures, sounds or music files are bundled: textures are painted on canvases at runtime, audio is
synthesised with WebAudio, and text uses system fonts.

## Map data (baked into `src/games/rally/maps/<id>/data.json`)

| Data                                           | Provider                                                                                           | Licence / attribution                                                                                                                              | Used in                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Roads, land use, water, buildings, power lines | [OpenStreetMap](https://www.openstreetmap.org/copyright)                                           | ODbL 1.0, © OpenStreetMap contributors. The baked `data.json` files are derived databases and stay under the ODbL                                  | all real maps           |
| Building footprints                            | [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | ODbL, © Microsoft                                                                                                                                  | Ajvatovci               |
| Land cover                                     | [ESA WorldCover 10 m 2021](https://esa-worldcover.org/)                                            | CC BY 4.0, © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021)                                                       | all real maps           |
| Elevation (30 m)                               | [Copernicus DEM GLO-30](https://doi.org/10.5069/G9028PQB) via OpenTopography                       | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA                                    | Petralica               |
| Elevation (5 m lidar)                          | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program)                             | US public domain, credit USGS 3DEP                                                                                                                 | Jackie Robinson Parkway |
| Elevation (horizon)                            | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium)                      | mixed open sources (SRTM, EU-DEM, national datasets), see the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | all real maps           |

Raw downloads are never committed (`sources/` and `scripts/realmap/.cache/` are git-ignored); only the baked,
resampled result is. The credits that appear in the game come from each map's `data.meta.sources`.

Some road parts and land-cover outlines were **traced by eye from screenshots of commercial map imagery** (the two
missing road parts of Petralica, the orchard outline and the start-street lot positions of Ajvatovci). Only the
traced coordinates are in the repository, no imagery. Re-trace them from OpenStreetMap-compatible imagery if you
need to be certain of the imagery provider's terms.

## 3D models

| File (`public/models/cars/`)               | Source                                                                                           | Licence                                                                    | 
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `bimmer_m3.glb`, `bimmer_m3_wheel.glb`     | "BMW E46 Coupe - Tuning - Model" by Doomas3D (MakerWorld)                                        | CC BY 4.0 | 
| `skoda_rally.glb`, `skoda_rally_wheel.glb` | "Skoda Fabia R5 Rally Car" by SenturyUK (Sketchfab)                                              | CC BY 4.0 | 
| none (Zastava 101)                         | hand-built in code; shape reference "Zastava 101 (Stojadin)" by Tomislav Tomljenovic (Sketchfab) | CC BY 4.0 | 

The car liveries, parts, physics, door plates and every other asset are original and generated in code.

## Trademarks and likenesses

Skoda, Fabia, BMW, M3, Zastava and other make or model names are trademarks of their owners and appear only to
identify the car that inspired a model. The liveries use no manufacturer, sponsor or series logos. Emergency vehicles
in the Jackie map carry only generic lettering ("POLICE", "FIRE DEPT", "AMBULANCE") and no agency names, logos or badges.
The signs on the Ajvatovci are approved to be used by owners. 
