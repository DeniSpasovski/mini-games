import type { MapInfo } from '../shared/types';
import data from './route.json';
import { jackieStages } from './stages';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const jackieInfo: MapInfo = {
  id: 'jackie',
  name: 'The Jackie',
  stages: jackieStages,
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
  environment: {
    sunElevation: 42,
    sunAzimuth: 330,
    // Hazy morning on the parkway: low sun from the east (~29 deg). ?tod=<hours> to try others.
    timeOfDay: 8,
    months: { spring: 5, summer: 7, autumn: 10 },
    // Natural city colours: facades and paint as they are, a lighter haze.
    turbidity: 4,
    rayleigh: 1.8,
    skyBrightness: 0.4,
    fogColor: 'sky',
    fogBrightness: 0.58,
    fogDensity: 0.00042,
    exposure: 0.88,
    grade: {
      warmth: 0.04,
      contrast: 1.08,
      saturation: 1.04,
      vibrance: 0.1,
      vignette: 0.12,
    },
    // Evening: city golden hour, warm light and a pink horizon.
    goldenHour: {
      turbidity: 4.5,
      rayleigh: 2.5,
      skyBrightness: 0.5,
      fogColor: '#b39c8c',
      exposure: 1.15,
      grade: {
        warmth: 0.2,
        contrast: 1.12,
        saturation: 1.1,
        vibrance: 0.15,
        shadowTint: { color: '#3a5a7a', amount: 0.08 },
        highlightTint: { color: '#ffcf8a', amount: 0.1 },
        vignette: 0.18,
      },
    },
    groundTint: { grass: '#7d8f4c', amount: 0.55 },
    groundTints: {
      spring: { grass: '#72a640', amount: 0.65, variety: 1 },
      autumn: { grass: '#867438', amount: 0.65 },
    },
  },
  // Baked route + the run-out past the Queens Blvd portal (see `road.points` in ./map.ts).
  route: [...data.route, [2835, -1847], [2866, -1858.6], [2896, -1870.9]],
  surfaces: ['tarmac'],
};
