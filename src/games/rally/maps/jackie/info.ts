import type { MapInfo } from '../shared/types';
import data from './route.json';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const jackieInfo: MapInfo = {
  id: 'jackie',
  name: 'The Jackie',
  year: 2026,
  /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
  tyre: 'tarmac',
  // Fast parkway: the race cars' long final drive (Skoda Rally ~205 km/h instead of 165).
  gearing: 'long',
  description:
    'Real-world city stage in New York: the narrow, winding 1930s Jackie Robinson Parkway from East New York through three cemeteries and Forest Park to the Grand Central Parkway interchange in Queens. 7.3 km of tree-lined tarmac.',
  seed: 4040,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: [
    ...data.meta.sources,
    'Kew Gardens junction surface, medians, street trees: NYC Planimetric Database + Street Tree Census (NYC Open Data)',
  ],
  sources: [
    {
      label:
        'Google Maps route (Vermont St -> Jackie Robinson Pkwy -> Kew Gardens)',
      url: 'https://www.google.com/maps/dir/40.6808527,-73.8963462/Jackie+Robinson+Pkwy,+New+York,+NY/40.714605,-73.8298097',
      note: 'stage waypoints',
    },
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'route, parkway carriageways + ramps, streets, bridges, land use, buildings with NYC roof heights - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'USGS 3D Elevation Program (3DEP)',
      url: 'https://www.usgs.gov/3d-elevation-program',
      note: 'bare-earth lidar elevation - US public domain',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'far horizon elevation',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
    {
      label: 'NYC Planimetric Database, Street Tree Census (NYC Open Data)',
      url: 'https://opendata.cityofnewyork.us/',
      note: 'street surface, medians, sidewalks and street trees of the Kew Gardens junction - NYC Office of Technology and Innovation, NYC Parks',
    },
  ],
  stageNumber: 3,
  bounds: { minX: -3150, maxX: 3550, minZ: -2300, maxZ: 2300 },
  // Finish at 7 298 m: past the Queens Blvd portal (7 186-7 273 m), 2 m before the last green gantry (7 300 m; the two
  // gantries clipped when they stood on the same spot).
  stage: { start: 40, finishFromEnd: 47, splits: 4 },
  environment: {
    sunElevation: 42,
    sunAzimuth: 330,
    // Hazy morning on the parkway: low sun from the east (~29 deg). ?tod=<hours> to try others.
    timeOfDay: 8,
    turbidity: 6,
    rayleigh: 1.4,
    fogColor: '#bfc8d0',
    fogDensity: 0.00042,
    exposure: 0.84,
    groundTint: { grass: '#7d8f4c', amount: 0.55 },
  },
  // Baked route + the run-out past the Queens Blvd portal (see `road.points` in ./map.ts).
  route: [...data.route, [2835, -1847], [2866, -1858.6], [2896, -1870.9]],
  surfaces: ['tarmac'],
};
