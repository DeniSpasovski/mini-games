import type { MapInfo } from '../shared/types';
import data from './route.json';
import { galichicaStages } from './stages';

/**
 * Light part of the Galichica map (menus, stage select, URL defaults): the map and its three stages. ./map.ts spreads
 * it into the full `MapDef` and is loaded on demand (`loadStage`, ../index.ts).
 */
export const galichicaInfo: MapInfo = {
  id: 'galichica',
  name: 'Galichica',
  stages: galichicaStages,
  seed: 4310,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label: 'Galichica National Park',
      url: 'https://nationalparksmacedonia.com/en/parks/galicica',
      note: 'the national park the stages run through (karst mountain between the two lakes, beech woods) - reference only',
    },
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'the pass road (R2332) and the lakeside roads at its ends, the side roads and tracks near the stage, Lake Ohrid (relation 2905270) and Lake Prespa (relation 2905510), woods and land use, buildings - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'Overpass API',
      url: 'https://overpass-api.de/',
      note: 'how the OpenStreetMap data was downloaded',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'elevation of the map and of the far horizon (the whole Ohrid - Prespa basin) - SRTM / EU-DEM derived, see the tile attributions',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover (oak, beech and pasture belts by altitude) - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
  ],
  stageNumber: 4,
  bounds: { minX: -6000, maxX: 5600, minZ: -3000, maxZ: 2600 },
  environment: {
    sunElevation: 34,
    // Morning sun from the south-east (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 40,
    // Early October, 09:00: clear dry mountain air, long views over both lakes.
    timeOfDay: 9,
    airTemps: { spring: 6, summer: 12, autumn: 9 },
    months: { spring: 5, summer: 7, autumn: 10 },
    cloudCoverage: 0.15,
    turbidity: 3.5,
    rayleigh: 1.4,
    fogColor: '#c6d2dc',
    fogDensity: 0.00022,
    exposure: 0.95,
    // Golden autumn pasture on the karst top.
    groundTint: { grass: '#a59a62', amount: 0.55 },
    groundTints: {
      spring: { grass: '#7fa04a', amount: 0.65 },
      autumn: { grass: '#94784a', amount: 0.55 },
    },
  },
  route: data.route,
  surfaces: ['tarmac'],
};
