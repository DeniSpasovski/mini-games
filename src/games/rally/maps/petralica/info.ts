import type { MapInfo } from '../shared/types';
import data from './route.json';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const petralicaInfo: MapInfo = {
  id: 'petralica',
  name: 'Petralica',
  year: 2026,
  /** Recommended tyre (pre-selected on the car screen; see ../../PHYSICS.md). */
  tyre: 'gravel',
  description:
    'Real-world mountain stage in Rankovce municipality, north-east North Macedonia: from Ginovci up the valley to Petralica, then a narrow switchback climb through oak woods to Vila Ristovski. 9.6 km, 560 m of climb.',
  seed: 4222,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label: 'Google Maps route (Ginovci -> Vila Ristovski)',
      url: 'https://www.google.com/maps/dir/42.1707824,22.1691664/42.2401682,22.2009501',
      note: 'stage waypoints; the two parts of the road missing in OpenStreetMap were traced from a screenshot of this route',
    },
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'route, roads, tracks, river, land use, buildings - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'Microsoft ML Road Detections',
      url: 'https://github.com/microsoft/RoadDetections',
      note: 'tracks and lanes OpenStreetMap does not have, detected in Bing Maps imagery - (c) Microsoft, ODbL',
    },
    {
      label: 'Copernicus DEM GLO-30 (via OpenTopography)',
      url: 'https://doi.org/10.5069/G9028PQB',
      note: 'elevation - (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'far horizon elevation - SRTM / EU-DEM derived',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover + built-up areas used to place the houses - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
  ],
  stageNumber: 2,
  bounds: { minX: -2400, maxX: 2400, minZ: -4800, maxZ: 4800 },
  stage: { start: 40, finishFromEnd: 150, splits: 4 },
  environment: {
    sunElevation: 38,
    // Afternoon sun from the south-west (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 320,
    // Late afternoon: low warm sun from the WSW (~22 deg), long shadows. Try others with ?tod=<hours>.
    timeOfDay: 16.5,
    // Hot late-summer afternoon (dry golden grass).
    airTemp: 28,
    turbidity: 5,
    rayleigh: 1.6,
    fogColor: '#c2cbd2',
    fogDensity: 0.00036,
    exposure: 0.95,
    groundTint: { grass: '#9d9562', amount: 0.6 },
  },
  route: data.route,
  surfaces: ['tarmac', 'gravel'],
};
