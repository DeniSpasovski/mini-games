import type { MapInfo } from '../shared/types';
import data from './route.json';
import { ajvatovciStages } from './stages';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const ajvatovciInfo: MapInfo = {
  id: 'ajvatovci',
  name: 'Ajvatovci Hill',
  stages: ajvatovciStages,
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
  environment: {
    sunElevation: 40,
    // Afternoon sun from the south-west (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 315,
    // Hot June morning, 07:30: low sun (~22 deg) in the east. ?tod=<hours> to try.
    timeOfDay: 7.5,
    months: { spring: 4, summer: 6, autumn: 10 },
    cloudCoverage: 0.1,
    // Golden farmland morning: light warm haze, pale blue sky above, warm light.
    turbidity: 4,
    rayleigh: 1.9,
    skyBrightness: 0.4,
    fogColor: '#d6cbb4',
    fogDensity: 0.00042,
    exposure: 0.92,
    grade: {
      warmth: 0.3,
      contrast: 1.1,
      saturation: 1.08,
      vibrance: 0.15,
      shadowTint: { color: '#2f6f6a', amount: 0.05 },
      highlightTint: { color: '#ffd08a', amount: 0.12 },
      vignette: 0.15,
    },
    // Summer: green meadows, wheat parcels the dull straw of the ground between the stalks (not yellow).
    groundTint: { grass: '#65952f', amount: 0.8, crop: '#a38d5e' },
    groundTints: {
      spring: { grass: '#5fae2e', amount: 0.85, crop: '#7fa63c', variety: 1 },
      autumn: { grass: '#847636', amount: 0.85, crop: '#7e5f2e' },
    },
  },
  route: data.route,
  surfaces: ['tarmac_gravel'],
};
