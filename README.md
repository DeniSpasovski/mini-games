# Mini Game Portal

A small collection of browser games that I built to get familiar with [three.js](https://threejs.org/).
It is an educational, just-for-fun project: no commercial goal, no accounts, no ads. Large parts of the code were
written together with AI coding agents under my direction, and everything is kept readable so it can be studied,
played and modified locally.

| Game                             | What it is                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Gravel Rally](src/games/rally/) | Point-to-point rally on real-world roads (OpenStreetMap + elevation data), custom raycast-vehicle physics |
| [Hole Island](src/games/hole/)   | Touch-first "swallow everything" game on a blocky toy city and a giant toy store                          |

[![Gravel Rally - Zastava at the Ajvatovci start](src/games/rally/screenshots/start.jpg)](src/games/rally/)

|                                                                                               |                                                                                               |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ![Rally, Ajvatovci start street](src/games/rally/maps/ajvatovci/screenshots/start-street.jpg) | ![Rally, Jackie Robinson Parkway](src/games/rally/maps/jackie/screenshots/parkway-bridge.jpg) |
| ![Hole Island, City Island](src/games/hole/screenshots/city-late.jpg)                         | ![Hole Island, Toy Emporium](src/games/hole/screenshots/toy-late.jpg)                         |

## What is in here

- **three.js** scenes, instancing / LOD / streaming terrain, procedural assets, seeded generators.
- A hand-written **vehicle physics** model (raycast suspension, combined-slip tyres, drivetrain) that runs in plain
  node, so it is covered by regression tests.
- A **real-world map baker** (Python) that turns open data into playable stages.
- Small tool pages (map viewer, car viewer, asset / item viewers, balance charts) used while building the games.
- Bundled with [Rsbuild](https://rsbuild.rs/), tested with Rstest, written in TypeScript.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm run test       # physics / world / full-stage regression tests
npm run lint
npm run build      # dist/ (portal + one self-contained folder per game)
npm run build -- --environment rally   # rebuild only dist/games/rally/
```

Games are discovered automatically from `src/games/<id>/game.json`. Folder layout, the portal, deployment and other
project internals: [`DETAILS.md`](DETAILS.md).

## License

The source code, the procedurally generated assets, the documentation and the screenshots are licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE): you can read, run, modify and share them for any noncommercial
purpose (personal use, learning, hobby projects, research, education), but not for commercial purposes. The code is
source-available rather than OSI "open source".

Two things are **not** covered by that licence:

- the baked map data (`src/games/rally/maps/*/data.json`, `buildings.csv`) is derived from OpenStreetMap and other open
  datasets and stays under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) with attribution, so it can be
  reused freely under those terms;
- third-party models and data keep their own licences, see [`THIRD-PARTY.md`](THIRD-PARTY.md).

## Credits and data

The maps are baked from open data (© OpenStreetMap contributors, ESA WorldCover, Copernicus DEM, USGS 3DEP, Microsoft
building footprints); some car bodies are converted from models shared by their authors. Every source, licence and
attribution is listed in [`THIRD-PARTY.md`](THIRD-PARTY.md) and in each map / car folder.

Car makes and models, brand names and real places are used for identification only. This is a non-commercial fan
project and is not affiliated with or endorsed by any manufacturer, team, company or agency.
