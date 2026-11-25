import type { MapInfo } from '../shared/types';
import { jackieInfo } from '../jackie/info';
import data from './route.json';
import { jackie2Stages } from './stages';

/**
 * Light part of the map (menus, stage select, URL defaults). ./map.ts spreads it into the full `MapDef`, loaded on
 * demand (`loadMap`, ../index.ts). `route` = the stage route's control points (`scripts/realmap/network.py`).
 */
export const jackie2Info: MapInfo = {
  id: 'jackie_2',
  name: 'The Jackie 2',
  stages: jackie2Stages,
  seed: 4041,
  geo: { lat: data.meta.origin[0], lon: data.meta.origin[1] },
  credits: [
    'Roads, bridges, land use, buildings: (c) OpenStreetMap contributors (ODbL)',
    'Elevation: USGS 3D Elevation Program (3DEP) bare-earth DEM, public domain; horizon: AWS Terrain Tiles (Terrarium)',
    'Land cover: ESA WorldCover 10 m 2021 v200 (CC BY 4.0)',
    'Roadside look: YouTube drive videos of the parkway - reference only, nothing copied',
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
      note: 'road network (every street, ramp, bridge and tunnel), land use, buildings with NYC roof heights - (c) OpenStreetMap contributors, ODbL',
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
      label: 'NYC Planimetric Database (NYC Open Data)',
      url: 'https://opendata.cityofnewyork.us/',
      note: 'street widths (roadbed, medians) and surveyed spot heights - NYC Office of Technology and Innovation',
    },
  ],
  stageNumber: 3,
  bounds: { minX: -3300, maxX: 3700, minZ: -2400, maxZ: 2400 },
  previewRelief: 1.8,
  // Same sky, light, grade and seasons as The Jackie.
  environment: jackieInfo.environment,
  route: data.route,
  surfaces: ['tarmac'],
};
