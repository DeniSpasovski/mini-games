# Vodno Hillclimb

Real-world hillclimb on Mount Vodno above Skopje, North Macedonia: from the Vodno neighbourhood up the hairpins of the
north face, through the pine woods, to Sredno Vodno. The 66 m Millennium Cross, the antenna mast and the cable car stand
on the ridge above the road; the whole 6 x 4 km round it (streets, houses, side roads) is in the world, and the Skopje valley
with the mountains beyond is the backdrop. One map, one stage (map id `vodno`, test content: dev server only).

![Start line](screenshots/start-line.jpg)

|                                            |                                                               |
| ------------------------------------------ | ------------------------------------------------------------- |
| ![Hairpins](screenshots/hairpins.jpg)      | ![Cross, mast and cable car](screenshots/cross-ridge.jpg)     |
| the hairpins above the suburb, guard rails | the Millennium Cross, the mast and the cable car on the ridge |

| Stage           | Id      | From -> to                                   | Length | Climb |
| --------------- | ------- | -------------------------------------------- | ------ | ----- |
| Vodno Hillclimb | `vodno` | Vodno neighbourhood -> Sredno Vodno (finish) | 4.0 km | 220 m |

Narrow tarmac with switchbacks (guard rails on the outside of the tight bends), black pine plantations with oak and scrub, dry
grass on the lower slopes. Side streets and tracks meeting the stage road are closed with barriers.

| Landmark                               | Where                                              |
| -------------------------------------- | -------------------------------------------------- |
| Millennium Cross, 66 m, round platform | Krstovar, 1 066 m, 1.7 km south-west of the finish |
| Antenna mast, 155 m                    | 270 m east of the cross                            |
| Cable car, two stations                | Sredno Vodno -> the cross: pylons, ropes, cabins   |
| Mountain lodge                         | by the cross: a round tower and a fan-shaped hall  |
| Church of the Nativity (three-lobed)   | Sredno Vodno, beside the finish                    |
| St. Panteleimon (1164, five domes)     | Gorno Nerezi, 2.9 km west of the finish            |
| Lookout tower, Markovi Kuli ruins      | on Abedishte; above Kisela Voda                    |

Two car parks sit on the stage road: the Vidikovec viewpoint lot at the hairpin and the Sredno Vodno lot at the finish (with the
flag of North Macedonia on its mast). Both are wide paved ribbons joined to the road (`lots.ts`), not the thin OSM aisle lines.

The churches, platform, lodge, stations, tower and ruins are hand-modelled in the style of the Ajvatovci hilltop church
(`landmarks/`): the real plans from OpenStreetMap, the sizes from published figures, fewer details (they are far away).

```bash
npm run dev     # /games/rally/?stage=vodno&mute=1
                # /games/rally/map-viewer.html?map=vodno&stage=vodno
```

## Data and credits

| What                                   | Source                                                                                                                       | Licence                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stage start / finish                   | [Google Maps route](https://www.google.com/maps/dir/41.9808131,21.4219566/41.9752441,21.4096439)                             | the end points only                                                              |
| Roads, buildings, cable car, landmarks | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the [Overpass API](https://overpass-api.de/)                    | ODbL, © OpenStreetMap contributors                                               |
| More building footprints               | [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints)                           | ODbL                                                                             |
| Elevation, far horizon                 | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)                                                            | [attributions](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Land cover                             | [ESA WorldCover 2021](https://esa-worldcover.org/)                                                                           | CC BY 4.0                                                                        |
| Landmark facts                         | [Millennium Cross](https://en.wikipedia.org/wiki/Millennium_Cross), [Vodno](https://en.wikipedia.org/wiki/Vodno) (Wikipedia) | reference only, nothing copied                                                   |

The baked map files (`*.json`, `buildings.csv`, the stage card in `preview/`) are a derived database of OpenStreetMap and stay under the ODbL. The cross, mast,
pylons and all landmark models are procedural (no logos or lettering).
