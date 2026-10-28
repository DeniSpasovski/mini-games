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

3, 2, 1 Kabooom (`src/games/kaboom/`) uses nothing third-party except its UI fonts and the CC0 Poly Haven environment light and detail textures (below): its critters, arenas, effects and sounds are original and procedural.

Ballistic Chess (`src/games/ballistic-chess/`) is built and hosted elsewhere; this repo holds only its card and
screenshots. The game is by Deni S.; the board textures in the screenshots are CC0 Poly Haven scans.

The only bundled font files are the UI faces of Gravel Rally, Hole Island and 3, 2, 1 Kabooom and the portal's (below); sounds are synthesised with WebAudio and no music file is committed. Most textures
are painted on canvases at runtime; the texture files that ship are listed with their licences below (building tiles, road
asphalt, background-car, fire-engine and truck textures) and in `public/models/CREDITS.md` (the car lamp, seat, fabric, cab, metal and dash textures).

## Fonts (game UIs)

| Font                                                                                                                                     | Licence                                        | Files                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| Barlow and Barlow Condensed (The Barlow Project Authors; woff2 latin + latin-ext subsets from Fontsource)                                | SIL Open Font License 1.1, `OFL.txt` alongside | `src/games/rally/assets/fonts/*.woff2`  |
| Fredoka (The Fredoka Project Authors) and Nunito (The Nunito Project Authors); woff2 latin + latin-ext subsets from Fontsource           | SIL Open Font License 1.1, `OFL.txt` alongside | `src/games/hole/assets/fonts/*.woff2`   |
| Grandstander (The Grandstander Project Authors) and Nunito (The Nunito Project Authors); woff2 latin + latin-ext subsets from Fontsource | SIL Open Font License 1.1, `OFL.txt` alongside | `src/games/kaboom/assets/fonts/*.woff2` |
| Atkinson Hyperlegible (Braille Institute of America) and IBM Plex Mono (IBM Corp.); woff2 latin subsets from Fontsource                  | SIL Open Font License 1.1, `OFL.txt` alongside | `src/portal/fonts/*.woff2`              |

The portal and game-cover `wordmark.svg` files are title text outlined from Archivo, Barlow Condensed, Chakra Petch, Fredoka and Grandstander (all SIL OFL 1.1, which allows this); the files hold only paths.

## Map data (baked into `src/games/rally/maps/<id>/`)

| Data                                                     | Provider                                                                                                                                                                                                       | Licence / attribution                                                                                                                              | Used in                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Roads, railways, land use, water, buildings, power lines | [OpenStreetMap](https://www.openstreetmap.org/copyright), downloaded via the [Overpass API](https://overpass-api.de/)                                                                                          | ODbL 1.0, © OpenStreetMap contributors. The baked map files are derived databases and stay under the ODbL                                          | all real maps           |
| Building footprints                                      | [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints)                                                                                                             | ODbL, © Microsoft                                                                                                                                  | Ajvatovci               |
| Roads OSM does not have                                  | [Microsoft ML Road Detections](https://github.com/microsoft/RoadDetections)                                                                                                                                    | ODbL, © Microsoft                                                                                                                                  | Petralica, Ajvatovci    |
| Land cover                                               | [ESA WorldCover 10 m 2021](https://esa-worldcover.org/)                                                                                                                                                        | CC BY 4.0, © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021)                                                       | all real maps           |
| Leaf type of the woods                                   | [Copernicus Sentinel-2 L2A](https://registry.opendata.aws/sentinel-2-l2a-cogs/)                                                                                                                                | free and open Copernicus data / contains modified Copernicus Sentinel data (2025)                                                                  | Vodno                   |
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
| `pezetka.glb`, `pezetka_wheel.glb`, `pezetka_metal.png`, `pezetka_lamps.png`             | "Polski Fiat (Fiat 126p)" by Martin Trafas (account TinoD2) (Sketchfab; split by material and converted, tyres + plates + badges + lettering dropped; rim extracted; bumper and headlamp textures kept, shrunk to 512 px; flat paint at runtime)                                                   | CC BY 4.0                 |
| `pezetka.glb` (interior), `pezetka_{seats,dash,chrome,floor}.png`                        | "fiat 126p" by subishi (Sketchfab; interior only: dash, steering wheel, seats, rear bench and floor, fitted to the body above; textures kept, shrunk to 512 px)                                                                                                                                    | CC BY 4.0                 |
| `lancer_evo_6.glb`, `lancer_evo_6_wheel.glb`, `lancer_evo_6_{lamps,seat,fabric,cab}.png` | "Mitsubishi Lancer Evolution 6" by vecarz (Sketchfab; converted and repainted, badges + plate removed; lamp and seat textures kept)                                                                                                                                                                | CC BY 4.0                 |
| `<car>_park.glb` (the nine cars above that the service park shows)                       | low-detail copies of the matching model and its rim, simplified by `scripts/car-model/park-lods.mjs`                                                                                                                                                                                               | as that model (CC BY 4.0) |

### Background cars (baked into `src/games/rally/assets/builders/`: `street-cars.data.ts`, `service-vehicles.data.ts`, `street-car-atlas.jpg`, `street-car-mask.png`)

The parked cars of the city maps and the Ajvatovci yards, the Ajvatovci lots' vans and the service park's trucks, vans and
pickups are recoloured copies of vehicles from two CC BY 4.0 packs (split and packed by
`scripts/car-model/street-pack-extract.py` + `bake-street-textures.py` + `bake-street-cars.mjs`; their own triangles and textures,
paint panels tinted, far LODs reduced, wheels redrawn at the far LODs; the source files are not in the repository).

| Pack                                                                                                                                              | Author                                                       | Licence   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------- |
| ["Generic passenger car pack"](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) (cars)                | [Comrade1280](https://sketchfab.com/comrade1280) (Sketchfab) | CC BY 4.0 |
| ["Low Poly Vehicle Mini Pack 7"](https://sketchfab.com/3d-models/low-poly-vehicle-mini-pack-7-c8fce59e51874a4182dc20a66cbc6c74) (vans and trucks) | [Vladek](https://sketchfab.com/vladek27) (Sketchfab)         | CC BY 4.0 |

### Fire engines (baked into `src/games/rally/assets/builders/`: `fire-trucks.data.ts`, `fire-truck-us.jpg`, `fire-truck-mk.jpg`)

The two fire engines keep their own triangles and textures (split and packed by `scripts/car-model/street-pack-extract.py` +
`bake-fire-truck-textures.py` + `bake-fire-trucks.mjs`; scaled to real size, unseen triangles dropped, far LODs reduced; the source
files are not in the repository).

| Model                                                                                                                                                      | Author                                                                             | Used for                              | Licence   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | --------- |
| ["Fire engine/Fire truck low poly game asset"](https://sketchfab.com/3d-models/fire-enginefire-truck-low-poly-game-asset-2f663c7477374d30af9f80c528fff55c) | Have a name ([FixedShark554](https://sketchfab.com/FixedShark554)) (Sketchfab)     | the Macedonian maps (`fire_truck_mk`) | CC BY 4.0 |
| ["Fire Truck"](https://sketchfab.com/3d-models/fire-truck-4a0d8c5bfca643d2aaa9b113ff752c26)                                                                | amongus ([holedonutdriveout](https://sketchfab.com/holedonutdriveout)) (Sketchfab) | the USA map (`fire_truck`)            | CC BY 4.0 |

### Ground textures (baked into `src/games/rally/engine/ground/`)

CC0 scans from Poly Haven, resized to 512 px tiles by `scripts/ground/bake.py`: Forest Ground 01 (Rob Tuytel), Grass Ground (Charlotte Baglioni), Leafy Grass (Charlotte Baglioni), Brown Mud Dry (Rob Tuytel), Rocky Trail (Amal Kumar), Rock Boulder Dry (Dimitrios Savva, Rico Cilliers), Forest Leaves 04 (Rob Tuytel), Leaves Forest Ground (Dimitrios Savva, Dario Barresi), Withered Grass (Charlotte Baglioni). No credit is required.

### Building textures (baked into `src/games/rally/engine/facades/`)

CC0 scans from Poly Haven, resized to 512 px tiles by `scripts/facades/bake.py`: Painted Plaster Wall (Amal Kumar), Brick Wall 006 (Jan Burghardt), Red Brick (Rob Tuytel), Plaster Stone Wall 02 (Charlotte Baglioni), Concrete Wall 007 (Dario Barresi, Rico Cilliers, Charlotte Baglioni), Corrugated Iron 03 (Charlotte Baglioni), Concrete Slab Wall (Dimitrios Savva), Sandstone Blocks 05 (Rob Tuytel), White Planks Clean (Rob Tuytel), Clay Roof Tiles 03 (Amal Kumar). No credit is required.

### Kaboom environment light (baked into `src/games/kaboom/assets/hdri/`)

CC0 HDRIs from Poly Haven, shrunk to 128 x 64 with the sun clipped out by `scripts/kaboom/bake-hdri.py`: Goegap (Greg Zaal) for the Quarry, Meadow 2 (Sergej Majboroda) for Green Valley, Small Harbour Morning (Greg Zaal, Jarod Guest) for Sea Deck. No credit is required.

### Kaboom detail textures (baked into `src/games/kaboom/assets/textures/`)

CC0 textures from Poly Haven, made grey, softened and shrunk to one 512 px tile per level by `scripts/kaboom/bake-textures.py`:
[Gravelly Sand](https://polyhaven.com/a/gravelly_sand) (Dario Barresi) and [Rock Face](https://polyhaven.com/a/rock_face)
(Greg Zaal, Dario Barresi) for the Quarry, [Leafy Grass](https://polyhaven.com/a/leafy_grass) (Charlotte Baglioni) and
[Brown Mud Dry](https://polyhaven.com/a/brown_mud_dry) (Rob Tuytel) and [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry)
(Dimitrios Savva, Rico Cilliers) for Green Valley, [Fine Grained Wood](https://polyhaven.com/a/fine_grained_wood) (Rob Tuytel) and
[Wood Peeling Paint Weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) (Rob Tuytel, Dimitrios Savva) for Sea
Deck. No credit is required.

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

### Field crops (baked into `src/games/rally/assets/builders/crop-models.data.ts`)

The wheat and corn in the Ajvatovci fields are two CC BY 4.0 models (their own triangles, normals, uvs and texture,
scaled to metres and packed by `scripts/crops/bake-crops.py`; recoloured for green spring wheat and dry autumn corn, the
corn cobs shown in their husks; the far cards are rendered from them in the game; the source files are not in the
repository).

| Model                                                                                                  | Author                                                      | Licence   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------- |
| ["Realistic Wheat"](https://sketchfab.com/3d-models/realistic-wheat-50270968690441d3ad9d2a8924c7338b)  | [Graphetta](https://sketchfab.com/Graphetta) (Sketchfab)    | CC BY 4.0 |
| ["Corn! Corn! Corn!"](https://sketchfab.com/3d-models/corn-corn-corn-10187bc37c9e42ef8770b28452ee7cd3) | [Tiia Tuulia](https://sketchfab.com/tiiatuulia) (Sketchfab) | CC BY 4.0 |

The car liveries, parts, physics, door plates and every other asset are original and generated in code.

## Road textures

| File (`src/games/rally/engine/asphalt/`)                                         | Source                                                                                                                                                                                                                    | Licence |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `road_tarmac.*.webp`, `road_tarmac_kerbed.*.webp`, `road_tarmac_junction.*.webp` | [Asphalt 04](https://polyhaven.com/a/asphalt_04) by Sergej Majboroda and Jenelle van Heerden (Poly Haven; colour, height and roughness maps resampled, with cracks and tyre marks painted on by `scripts/asphalt/gen.js`) | CC0     |

The other asphalt textures are painted procedurally by the same script. The scan itself is not committed (`sources/textures/`).

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
in the Jackie map carry only generic lettering ("POLICE", "FIRE DEPT", "AMBULANCE") and no agency names, logos or badges; the two fire engine models carry none.
The signs on the Ajvatovci are approved to be used by owners.
