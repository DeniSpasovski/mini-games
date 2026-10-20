# Third-party material

Everything that is not original code or art in this repository, with its licence and its status. Per-map and per-car
README files carry the same information in more detail. Keep this file current when a source is added.

## Licence scope

| Material                                                                                                                                                                              | Licence                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source code, procedural assets, docs, screenshots (everything original)                                                                                                               | [PolyForm Noncommercial 1.0.0](LICENSE)                                 |
| Baked map data of the real maps (`maps/<id>/`: `data.json`, `route.json`, `horizon.json`, `junction*.json`, `buildings.csv`, `preview/<stage>.json` + `<stage>-<season>.jpg` renders) | ODbL 1.0 + attribution (derived from OpenStreetMap and other open data) |
| Third-party models and data listed below                                                                                                                                              | their own licences; not relicensed by this project                      |

## Software

| Package                                                                         | Licence          | Use                               |
| ------------------------------------------------------------------------------- | ---------------- | --------------------------------- |
| [three.js](https://threejs.org/)                                                | MIT              | rendering (runtime)               |
| Rsbuild, Rspack, Rstest, Rslint, TypeScript, Prettier, happy-dom, meshoptimizer | MIT / Apache-2.0 | build and test tooling (dev only) |

3, 2, 1 Kabooom (`src/games/kaboom/`) uses nothing third-party: its critters, arenas, effects and sounds are original and procedural.

No fonts, sounds or music files are bundled: audio is synthesised with WebAudio and text uses system fonts. Most textures
are painted on canvases at runtime; the only texture files that ship are the car lamp, seat, fabric and cab textures (listed
with their licences in `public/models/CREDITS.md`) and the truck textures (listed under "Parked trucks" below).

## Map data (baked into `src/games/rally/maps/<id>/`)

| Data                                                     | Provider                                                                                                                                                                                                       | Licence / attribution                                                                                                                              | Used in                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Roads, railways, land use, water, buildings, power lines | [OpenStreetMap](https://www.openstreetmap.org/copyright), downloaded via the [Overpass API](https://overpass-api.de/)                                                                                          | ODbL 1.0, © OpenStreetMap contributors. The baked map files are derived databases and stay under the ODbL                                          | all real maps           |
| Building footprints                                      | [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints)                                                                                                             | ODbL, © Microsoft                                                                                                                                  | Ajvatovci               |
| Roads OSM does not have                                  | [Microsoft ML Road Detections](https://github.com/microsoft/RoadDetections)                                                                                                                                    | ODbL, © Microsoft                                                                                                                                  | Petralica, Ajvatovci    |
| Land cover                                               | [ESA WorldCover 10 m 2021](https://esa-worldcover.org/)                                                                                                                                                        | CC BY 4.0, © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021)                                                       | all real maps           |
| Elevation (30 m)                                         | [Copernicus DEM GLO-30](https://doi.org/10.5069/G9028PQB) via OpenTopography                                                                                                                                   | © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA                                    | Petralica               |
| Elevation (5 m lidar)                                    | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program)                                                                                                                                         | US public domain, credit USGS 3DEP                                                                                                                 | Jackie Robinson Parkway |
| Junction street surface, medians, sidewalks, trees       | [NYC Planimetric Database, Street Tree Census](https://opendata.cityofnewyork.us/) (NYC Open Data)                                                                                                             | no restrictions on use (NYC Open Data); credit NYC Office of Technology and Innovation (OTI)                                                       | Jackie Robinson Parkway |
| Elevation (horizon; Ajvatovci, Galichica, Vodno terrain) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium)                                                                                                                                  | mixed open sources (SRTM, EU-DEM, national datasets), see the [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | all real maps           |
| Landmark facts for the Vodno stage and models            | [Millennium Cross](https://en.wikipedia.org/wiki/Millennium_Cross), [Vodno](https://en.wikipedia.org/wiki/Vodno) (Wikipedia), [St. Panteleimon, Nerezi](https://haemus.org.mk/st-pantejelmon-nerezi/) (HAEMUS) | reference only, nothing copied                                                                                                                     |
| Park facts for the stage descriptions                    | [Galichica National Park](https://nationalparksmacedonia.com/en/parks/galicica)                                                                                                                                | reference only, nothing copied                                                                                                                     | Galichica               |

Raw downloads are never committed (`sources/` and `scripts/realmap/.cache/` are git-ignored); only the baked,
resampled result is. The in-game credits come from each map's `meta.sources` (`route.json`) and its About links (`info.ts`).

Some roads, properties and outlines were added or traced by hand on top of the open data. No imagery is in the repository.

## 3D models

| File (`public/models/cars/`)                                                             | Source                                                                                                                                                                                                                                                                                             | Licence                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `bimmer_m3.glb`, `bimmer_m3_wheel.glb`                                                   | "BMW E46 Coupe - Tuning - Model" by Doomas3D (MakerWorld)                                                                                                                                                                                                                                          | CC BY 4.0                 |
| `bimmer_gt2.glb`, `bimmer_gt2_wheel.glb`                                                 | "E92 Barnfind" by Tushar Singh (Sketchfab; split by material and converted, roundel logos + plate removed)                                                                                                                                                                                         | CC BY 4.0                 |
| `skoda_rally.glb`, `skoda_rally_wheel.glb`                                               | "Skoda Fabia R5 Rally Car" by SenturyUK (Sketchfab)                                                                                                                                                                                                                                                | CC BY 4.0                 |
| `subie_22b.glb`, `subie_22b_wheel.glb`, `subie_22b_lamps.png`                            | "1998 Subaru Impreza 22B STi" by 007 (tangwang920) (Sketchfab, https://sketchfab.com/3d-models/1998-subaru-impreza-22b-sti-62ce498bf3204ccbb875c8682ccd87b2; split by material and converted, wheels / discs / calipers / badges / plate dropped; wheel extracted; lamp texture + cockpit kept)    | CC BY 4.0                 |
| none (Zastava 101)                                                                       | hand-built in code from a public-domain factory blueprint; shape reference "Zastava 101 (Stojadin)" by Tomislav Tomljenovic (Sketchfab)                                                                                                                                                            | CC BY 4.0                 |
| `fiesta.glb`, `fiesta_wheel.glb`                                                         | "Ford Fiesta WRC" by kevin (Sketchfab)                                                                                                                                                                                                                                                             | CC BY 4.0                 |
| `citroen_c4.glb`, `citroen_c4_wheel.glb`                                                 | "Citroen C4 WRC Red Bull 2007" by Max (Sketchfab; sponsor livery, boot-lid emblem and plate removed, repainted)                                                                                                                                                                                    | CC BY 4.0                 |
| `ford_gt3.glb`, `ford_gt3_wheel.glb`                                                     | "2024 Ford Mustang GT3" by kevin (Sketchfab; split by material and converted, tyres + discs + calipers dropped, logo banner dropped; rim extracted; flat paint at runtime)                                                                                                                         | CC BY 4.0                 |
| `merc_190.glb`, `merc_190_wheel.glb`                                                     | "Mercedes 190E EVO 1982 3D Model Free" by Betier Models (Sketchfab; split by material and converted, tyres + discs + calipers + own springs and arms dropped, hood star, grille, boot-lid and steering-wheel badges removed; rim extracted with the hub-cap star flattened; flat paint at runtime) | CC BY 4.0                 |
| `peugeot_206.glb`, `peugeot_206_wheel.glb`                                               | "Peugeot 206" by Alvier (Sketchfab; split by material and converted, tyres + discs + calipers + springs dropped, lion emblem, rear lettering and side badge dropped; rim extracted, centre-cap emblem flattened; flat paint at runtime)                                                            | CC BY 4.0                 |
| `audi_rs6.glb`, `audi_rs6_wheel.glb`, `audi_rs6_lamps.png`                               | "Audi RS 6 Avant (C8)" by Mona x Supercars (Sketchfab; split by material and converted, tyres + discs + calipers + engine bay dropped, rings, badges, lettering and plate removed; rim extracted; lamp texture kept; flat paint at runtime)                                                        | CC BY 4.0                 |
| `porsche_911_930.glb`, `porsche_911_930_wheel.glb`, `porsche_911_930_lamp.png`           | "Porsche 911 (930) Turbo 1975" by Lexyc16 (Sketchfab; split by material and converted, wheels dropped, rear light wordmark replaced by a flat lens; rim extracted, nuts dropped, recoloured two-tone; headlamp texture kept; flat paint at runtime)                                                | CC BY 4.0                 |
| `subie_wrx_sti.glb`, `subie_wrx_sti_wheel.glb`, `subie_wrx_sti_lamps.png`                | "2019 Rowen Subaru WRX STI" by Car design (Sketchfab; split by material and converted, tyres + discs + calipers + engine bay dropped, badges, lettering and plates removed; rim extracted; lamp texture kept; cockpit simplified; flat paint at runtime)                                           | CC BY 4.0                 |
| `lancer_evo_6.glb`, `lancer_evo_6_wheel.glb`, `lancer_evo_6_{lamps,seat,fabric,cab}.png` | "Mitsubishi Lancer Evolution 6" by vecarz (Sketchfab; converted and repainted, badges + plate removed; lamp and seat textures kept)                                                                                                                                                                | CC BY 4.0                 |
| `<car>_park.glb` (the nine cars above that the service park shows)                       | low-detail copies of the matching model and its rim, simplified by `scripts/car-model/park-lods.mjs`                                                                                                                                                                                               | as that model (CC BY 4.0) |

### Background cars (baked into `src/games/rally/assets/builders/street-cars.data.ts`)

The parked cars of the city maps, the vans and trucks of the Ajvatovci start lots and the service park trucks, vans and
pickups are simplified, recoloured copies of vehicles from three CC BY 4.0 packs (split, reduced to about 900 / 450 triangles
and packed by `scripts/car-model/bake-street-cars.mjs`; the source files are not in the repository).

| Pack                                                                                                                                              | Author                                                       | Licence   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| ["Generic passenger car pack"](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) (modern cars)         | [Comrade1280](https://sketchfab.com/comrade1280) (Sketchfab) | CC BY 4.0 |
| ["Low Poly Vehicle Mini Pack 8"](https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-8-52ee24ff6eb2479891fe68e6ce46af28) (old boxy cars)   | [Vladek](https://sketchfab.com/vladek27) (Sketchfab)         | CC BY 4.0 |
| ["Low Poly Vehicle Mini Pack 7"](https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-7-c8fce59e51874a4182dc20a66cbc6c74) (vans and trucks) | [Vladek](https://sketchfab.com/vladek27) (Sketchfab)         | CC BY 4.0 |

### Parked trucks (baked into `src/games/rally/maps/ajvatovci/start-row/build/truck-models.data.ts`)

The tractor units, trailers, box-truck cabs and dump trucks parked at Ajvatovci are recoloured copies of two CC BY 4.0
models (split and packed by `scripts/car-model/street-pack-extract.py` + `bake-truck-textures.py` + `bake-trucks.mjs`; their own
triangles and textures, the tyre hub-cap emblem blanked; the tank, tow and freezer bodies and the dump truck's other backs are built in code; the source files are not in
the repository).

| Model                                                                                                                   | Author                   | Licence   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------- |
| ["Low Poly Truck"](https://sketchfab.com/3d-models/low-poly-truck-d61a2ac0a706462ebf82459907f21573) (tractor + trailer) | FS 3D Studio (Sketchfab) | CC BY 4.0 |
| ["Dump Truck"](https://sketchfab.com/3d-models/dump-truck-781c616da8f44982a59cb3fc3fa67f98)                             | ElectroNick (Sketchfab)  | CC BY 4.0 |

### People (baked into `src/games/rally/engine/people-base.data.ts`)

Every spectator, marshal, mechanic, crew member, driver, photographer and visitor close up is one of two CC BY 4.0 base bodies (their
own mesh, simplified in `scripts/people/extract-base.py` + `bake-base.mjs`; the source files are not in the repository). The face
(eyes, brows, lips) is painted by `scripts/people/skin-map.py`. Clothes, hair, hats and shoes are built in code from the body itself;
far away the people are low-poly figures built in code.

| Model                                                                                                                       | Author                                         | Licence   |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- |
| ["Male Base Mesh (Low Poly)"](https://sketchfab.com/3d-models/male-base-mesh-low-poly-fece8bfaefdb42cb9fc2a9492ffa18c7)     | FormForge3D (account aleenasani841, Sketchfab) | CC BY 4.0 |
| ["Female Base Mesh (Low Poly)"](https://sketchfab.com/3d-models/female-base-mesh-low-poly-b80022fb9db94c9e83cae5361931b3c9) | FormForge3D (account aleenasani841, Sketchfab) | CC BY 4.0 |

The car liveries, parts, physics, door plates and every other asset are original and generated in code.

## Music

Not committed: the file stays local in `sources/music/` and is copied into the build.

| File (`sources/music/`)    | Source                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `darkside-rally-house.mp3` | "darkside - rally house" by kawaiiwork (https://pixabay.com/music/upbeat-darkside-rally-house-410400/), Pixabay Content License, credited in About |
| `sunset-house.mp3`         | "Sunset House" by Aurec (https://pixabay.com/music/electronic-sunset-house-598438/), Pixabay Content License, credited in About                    |

## Research references

Papers and articles read to tune the rally tyre types, tyre temperature, suspension and brake models; linked in the game's About screen and
`src/games/rally/PHYSICS.md`. Nothing from them is copied or bundled.

- https://pmc.ncbi.nlm.nih.gov/articles/PMC9459800/
- https://www.izzeracing.com/ewExternalFiles/Izze_Racing_White_Paper_Tire_Temperature.pdf
- https://arxiv.org/pdf/2602.22078
- https://press.pirelli.com/p-zero-ra-wrc-shows-reliability-on-wet-and-dry-asphalt/
- https://press.pirelli.com/scorpion-kx-soft-stars-on-opening-day-of-rally-finland/
- https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs
- https://www.gamedeveloper.com/programming/rendering-and-simulation-in-offroad-driving-game
- https://arxiv.org/abs/2605.05235
- https://www.brembo.com/en/motorsport/wrc
- https://www.skoda-motorsport.com/en/6-interesting-facts-about-fabia-r5-brakes-rally-technology/
- https://dba.com.au/wp-content/uploads/2022/10/Technical_Bulletin_DBA_MotorSport_Important_Information.pdf
- https://koreascience.or.kr/article/CFKO200111921184854.page
- https://en.wikipedia.org/wiki/Brake_fade
- https://www.counterman.com/drum-brakes-the-beat-goes-on/

## Trademarks and likenesses

Skoda, Fabia, BMW, M3, Ford, Fiesta, Subaru, Impreza, WRX, STI, Citroen, C4, Mitsubishi, Lancer Evolution, Zastava and other make or model names are trademarks of their owners and appear only to
identify the car that inspired a model. The liveries use no manufacturer, sponsor or series logos. Emergency vehicles
in the Jackie map carry only generic lettering ("POLICE", "FIRE DEPT", "AMBULANCE") and no agency names, logos or badges.
The Subaru WRX STI 22B (test car) carries a crescent-and-stars side graphic redrawn as shapes after a reference picture of
the manufacturer's motorsport emblem, at the owner's request; it is not the picture and has no lettering, but it is the one
exception to "no manufacturer logos" - `cars/subie-22b/livery.ts` drops it.
The signs on the Ajvatovci are approved to be used by owners.
