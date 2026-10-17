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
    {
      label: 'Generic passenger car pack (Comrade1280, Sketchfab)',
      url: 'https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5',
      note: 'parked cars - CC BY 4.0',
    },
    {
      label: 'Low Poly Truck (FS 3D Studio, Sketchfab)',
      url: 'https://sketchfab.com/3d-models/low-poly-truck-d61a2ac0a706462ebf82459907f21573',
      note: 'parked tractor units, trailers and box trucks, recoloured - CC BY 4.0',
    },
    {
      label: 'Dump Truck (ElectroNick, Sketchfab)',
      url: 'https://sketchfab.com/3d-models/dump-truck-781c616da8f44982a59cb3fc3fa67f98',
      note: 'parked dump trucks, recoloured - CC BY 4.0',
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
    // Hot dry June morning near Skopje (a day that is 27 deg by 07:30 is a heatwave day with a clear sky). Humidity is not simulated.
    airTemp: 27,
    cloudCoverage: 0.1,
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
