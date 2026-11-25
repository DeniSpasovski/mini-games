# The Jackie 2

The Jackie Robinson Parkway in New York City rebuilt on the **v2 road engine** (`src/games/rally/world/v2/`): every road,
junction, bridge, tunnel, retaining wall, kerb, sidewalk, lane line, barrier, street lamp, street tree and parked car is
generated from the OpenStreetMap road network and lidar terrain - no per-site fixes in the map file. 7.4 km of 1930s
parkway from East New York to the Queens Blvd tunnel at Kew Gardens. Map id `jackie_2`, test map (dev server only).

How it is built (details: rally `DETAILS.md` "Road engine v2"): `network.json` is the road graph imported from
OpenStreetMap, `network-patches.json` holds hand edits by stable OSM id, the `nyc` template pack gives every road class its
cross-section, and the engine solves heights, junctions, structures and walls at load.

```bash
npm run dev     # /games/rally/?map=jackie_2&spawn=1000&mute=1
                # /games/rally/map-viewer.html?map=jackie_2
python scripts/realmap/network.py scripts/realmap/jackie-2.json   # re-import the road network
```

## Data and credits

| What                                                                                                              | Source                                                                                                                                                                                   | Licence                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stage route                                                                                                       | [Google Maps route (Vermont St -> Jackie Robinson Pkwy -> Kew Gardens)](https://www.google.com/maps/dir/40.6808527,-73.8963462/Jackie+Robinson+Pkwy,+New+York,+NY/40.714605,-73.8298097) | stage waypoints only                                                             |
| Road network, bridges, tunnels, buildings with heights                                                            | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass                                                                                                                    | ODbL, © OpenStreetMap contributors                                               |
| Terrain (5 m bare-earth lidar; 1 m lidar ground and road heights at the Kew Gardens end, 2013-14 NYC point cloud) | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program)                                                                                                                   | US public domain, credit USGS 3DEP                                               |
| Horizon terrain                                                                                                   | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)                                                                                                                        | [attributions](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Land cover (woods, grass)                                                                                         | [ESA WorldCover 2021](https://esa-worldcover.org/)                                                                                                                                       | CC BY 4.0                                                                        |
| Street widths, surveyed spot heights, Kew Gardens islands and park, street space (roadbed, sidewalks, medians)    | [NYC Planimetric Database](https://opendata.cityofnewyork.us/) (NYC Open Data)                                                                                                           | no restrictions on use; credit NYC Office of Technology and Innovation (OTI)     |
| Kew Gardens buildings OpenStreetMap lacks (outline, roof height)                                                  | [NYC Building Footprints](https://data.cityofnewyork.us/d/5zhs-2jue) (NYC Open Data)                                                                                                     | no restrictions on use; credit NYC Office of Technology and Innovation (OTI)     |
| Protected bike lanes                                                                                              | [NYC DOT Bike Routes](https://data.cityofnewyork.us/d/mzxg-pwib) (NYC Open Data)                                                                                                         | no restrictions on use; credit NYC DOT                                           |
| Roadside look (walls, barriers, signs)                                                                            | YouTube drive videos of the parkway                                                                                                                                                      | reference only, nothing copied                                                   |

The baked map files (`network.json`, `data.json`, `route.json`, `horizon.json`, `junction-qb-east.json`, `park-kew.json`,
`markings.json`) are a derived database of OpenStreetMap and stay
under the ODbL; `network.json` also carries the NYC survey widths and spot heights (`scripts/realmap/network_survey.py`). Terrain, land cover and buildings are copied from the `jackie` bake (`scripts/realmap/network.py`, config
`terrainFrom`).
