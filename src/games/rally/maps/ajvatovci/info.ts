import type { MapInfo } from '../shared/types';
import data from './route.json';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const ajvatovciInfo: MapInfo = {
  id: 'ajvatovci',
  name: 'Ajvatovci Hill',
  year: 2026,
  /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
  tyre: 'mixed',
  /** Long gearing on the long straights (cars that cannot change it ignore this). */
  gearing: 'long',
  description:
    'Real-world stage near Ilinden, North Macedonia: from the A2 industrial zone across the plain and Ajvatovci village up the hill. Narrow dusty tarmac.',
  seed: 4207,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label: 'Google Maps route (start -> Ajvatovci Hill)',
      url: 'https://www.google.com/maps/dir/42.0001365,21.5777226/42.0085904,21.6141518',
      note: 'stage waypoints',
    },
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'route, roads, railways, canals, land use, buildings, power lines - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'elevation - SRTM / EU-DEM derived',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
    {
      label: 'Microsoft Global ML Building Footprints',
      url: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
      note: 'building footprints where OSM has none, ODbL',
    },
    {
      label: 'Microsoft ML Road Detections',
      url: 'https://github.com/microsoft/RoadDetections',
      note: 'tracks and lanes OpenStreetMap does not have, detected in Bing Maps imagery - (c) Microsoft, ODbL',
    },
  ],
  stageNumber: 1,
  // Stage + free-drive background: Ilinden town / A2 (west, south-west) and Marino (south). The baked
  // detail heights / land cover / roads / buildings cover this box (scripts/realmap/ajvatovci.json).
  bounds: { minX: -4300, maxX: 4600, minZ: -3450, maxZ: 3500 },
  stage: { start: 40, finishFromEnd: 150, splits: 3 },
  environment: {
    sunElevation: 40,
    // Afternoon sun from the south-west (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 315,
    // Spring morning: low sun in the east (~22 deg) - the stage drives towards it up to the hill. ?tod=<hours> to try.
    timeOfDay: 7.5,
    turbidity: 6,
    rayleigh: 1.5,
    fogColor: '#c3c9cf',
    fogDensity: 0.00042,
    exposure: 0.88,
    // Spring: fresh green meadows and young crops, golden wheat parcels.
    groundTint: { grass: '#65952f', amount: 0.8, crop: '#c49c36' },
  },
  route: data.route,
  surfaces: ['tarmac_gravel'],
};
