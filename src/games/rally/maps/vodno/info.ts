import { shiftedRoute } from '../shared/real-map';
import type { MapInfo } from '../shared/types';
import { laneShift } from './crossroad';
import data from './route.json';
import { vodnoStages } from './stages';

/**
 * Light part of the Vodno map (menus, stage select, URL defaults): the map and its stage. ./map.ts spreads it into the
 * full `MapDef` and is loaded on demand (`loadStage`, ../index.ts).
 */
export const vodnoInfo: MapInfo = {
  id: 'vodno',
  name: 'Vodno Hillclimb',
  stages: vodnoStages,
  seed: 5210,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: data.meta.sources,
  sources: [
    {
      label: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      note: 'the streets and roads of Vodno, Kisela Voda and Nerezi, every building footprint, the cable car line and its stations, the Millennium Cross and the antenna mast - (c) OpenStreetMap contributors, ODbL',
    },
    {
      label: 'Overpass API',
      url: 'https://overpass-api.de/',
      note: 'how the OpenStreetMap data was downloaded',
    },
    {
      label: 'Microsoft Global ML Building Footprints',
      url: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
      note: 'the houses OpenStreetMap does not have yet - ODbL',
    },
    {
      label: 'AWS Terrain Tiles (Terrarium)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      note: 'elevation of the map and of the far horizon (Skopje valley, Skopska Crna Gora, Sar Mountains) - SRTM / EU-DEM derived, see the tile attributions',
    },
    {
      label: 'ESA WorldCover 10 m 2021 v200',
      url: 'https://esa-worldcover.org/',
      note: 'land cover (woods, scrub, built-up land) - contains modified Copernicus Sentinel data (2021), CC BY 4.0',
    },
    {
      label: 'Copernicus Sentinel-2 L2A',
      url: 'https://registry.opendata.aws/sentinel-2-l2a-cogs/',
      note: 'which woods are pine and which are oak and hornbeam, from a winter and a summer scene - contains modified Copernicus Sentinel data (2025)',
    },
    {
      label: 'Millennium Cross (Wikipedia)',
      url: 'https://en.wikipedia.org/wiki/Millennium_Cross',
      note: 'height and look of the cross on Krstovar - reference only',
    },
    {
      label: 'Vodno (Wikipedia)',
      url: 'https://en.wikipedia.org/wiki/Vodno',
      note: 'the mountain, its woods and the cable car - reference only',
    },
  ],
  stageNumber: 5,
  bounds: { minX: -3000, maxX: 3000, minZ: -1750, maxZ: 1750 },
  environment: {
    sunElevation: 30,
    // Morning sun from the south-east (azimuth from +Z towards +X; +Z = south).
    sunAzimuth: 35,
    // 10:00: the valley haze of Skopje, the pine slope in the mountain's shade.
    timeOfDay: 10,
    months: { spring: 4, summer: 7, autumn: 10 },
    cloudCoverage: 0.25,
    // Green forest with warm sun patches, cool but saturated shade, blue sky through the canopy.
    turbidity: 3,
    rayleigh: 2.2,
    skyBrightness: 0.32,
    fogColor: 'sky',
    fogBrightness: 0.55,
    fogDensity: 0.0003,
    exposure: 1,
    grade: {
      warmth: 0.1,
      contrast: 1.15,
      saturation: 1.1,
      vibrance: 0.2,
      shadowTint: { color: '#2f6f5a', amount: 0.08 },
      highlightTint: { color: '#ffd9a0', amount: 0.08 },
      vignette: 0.15,
    },
    groundTint: { grass: '#9d9560', amount: 0.5 },
    // Summer is the map's own look; the grass of an April hillside and of an October one.
    groundTints: {
      spring: { grass: '#76a44a', amount: 0.65, variety: 1 },
      autumn: { grass: '#86703f', amount: 0.62 },
    },
  },
  // The road's centre line (the first crossroad's extra lane moves it): the same points as the full map's road.
  route: shiftedRoute(data.route, laneShift),
  // The road's surface, then each section's (the lined road, the crossroad's wide stretch, the lined road again): see
  // `infoOf` in ../index.ts.
  surfaces: ['tarmac', 'tarmac', 'tarmac'],
};
