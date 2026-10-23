import type { MapInfo } from '../shared/types';
import data from './route.json';
import { petralicaStages } from './stages';

/**
 * Light part of the map (menus, stage select, URL defaults): everything the menus need without the baked data.
 * ./map.ts spreads it into the full `MapDef` and is loaded on demand (`loadMap`, ../index.ts).
 * `route` / `surfaces` are the menu's route outline and surface tags - tests/rally/map-registry.test.ts checks them
 * against the full map.
 */
export const petralicaInfo: MapInfo = {
  id: 'petralica',
  name: 'Petralica',
  stages: petralicaStages,
  seed: 4222,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label: 'Google Maps route (Ginovci -> finish)',
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
  environment: {
    sunElevation: 38,
    // Afternoon sun from the south-west (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 320,
    // Late afternoon: low warm sun from the WSW (~22 deg), long shadows. Try others with ?tod=<hours>.
    timeOfDay: 16.5,
    months: { spring: 5, summer: 7, autumn: 9 },
    // Late-afternoon warmth: warm highlights, golden grass, blue overhead.
    turbidity: 3,
    rayleigh: 2,
    skyBrightness: 0.32,
    fogColor: 'sky',
    fogBrightness: 0.58,
    fogDensity: 0.00036,
    exposure: 0.95,
    grade: {
      warmth: 0.12,
      contrast: 1.12,
      saturation: 1.1,
      vibrance: 0.2,
      shadowTint: { color: '#2f6f6a', amount: 0.07 },
      highlightTint: { color: '#ffd8a0', amount: 0.07 },
      vignette: 0.15,
    },
    // Evening: the purple sky Petralica is known for, a lilac haze over the hills.
    goldenHour: {
      turbidity: 4,
      rayleigh: 3.5,
      mieCoefficient: 0.006,
      skyBrightness: 0.45,
      fogColor: '#9a8aa6',
      exposure: 1.15,
      grade: {
        warmth: 0.12,
        tint: 0.25,
        contrast: 1.12,
        saturation: 1.12,
        vibrance: 0.15,
        shadowTint: { color: '#5a3f7a', amount: 0.1 },
        highlightTint: { color: '#ffc8a0', amount: 0.08 },
        vignette: 0.2,
      },
    },
    groundTint: { grass: '#9d9562', amount: 0.6 },
    groundTints: {
      spring: { grass: '#76a048', amount: 0.7, variety: 1 },
      autumn: { grass: '#82683c', amount: 0.7 },
    },
  },
  route: data.route,
  surfaces: ['tarmac', 'gravel'],
};
