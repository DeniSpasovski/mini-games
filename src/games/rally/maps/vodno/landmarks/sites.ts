import { toLocal, type Site } from '../../ajvatovci/hilltop/site';
import type { FlatArea } from '../../shared/types';

export { toLocal, toWorld } from '../../ajvatovci/hilltop/site';
export type { Site } from '../../ajvatovci/hilltop/site';

/**
 * Where the Vodno landmarks stand (world metres, +X east, +Z south, origin 41.97219 N, 21.40287 E). Positions and
 * outlines are the OpenStreetMap ways / nodes reprojected with the baker's projection (`scripts/realmap/bake.py`
 * `Proj`); the OSM ids are in the map's DETAILS.md "Landmarks". A `Site` is a structure's local frame (see the Ajvatovci
 * hilltop `site.ts`): local +x runs along `yaw` (rad, from +X towards +Z), +z is 90 degrees clockwise from it.
 * Pure data (runs in node).
 */
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Church of the Nativity of the Theotokos (Middle Vodno monastery), OSM way 689815741: three-lobed (triconch) plan. */
export const SREDNO_CHURCH: Site = { x: 464.27, z: -528.81, yaw: rad(-16.5) };

/** The Millennium Cross platform, OSM way 618009929: a round platform of 24 m on twelve columns. */
export const PLATFORM: Site = { x: -700.6, z: 796.4, yaw: 0 };
export const PLATFORM_RADIUS = 12;

/** Dare Dzambaz mountain lodge, OSM way 229939243: a round tower house and a fan-shaped hall to the south. */
export const LODGE: Site = { x: -650.73, z: 750.38, yaw: 0 };
/** Its outline (local metres from the site, as OSM draws it): circle part north, fan south. */
export const LODGE_OUTLINE: [number, number][] = [
  [4.8, -7.1],
  [3.7, -7.8],
  [2.5, -8.4],
  [1.0, -8.6],
  [-0.4, -8.5],
  [-1.8, -8.1],
  [-3.0, -7.4],
  [-4.1, -6.3],
  [-4.9, -5.0],
  [-5.3, -3.8],
  [-5.4, -2.4],
  [-5.2, -1.0],
  [-4.7, 0.4],
  [-11.1, 2.3],
  [-9.8, 4.8],
  [-8.3, 6.6],
  [-6.1, 8.2],
  [-3.7, 9.3],
  [-1.5, 9.9],
  [0.8, 10.1],
  [3.0, 9.9],
  [4.9, 9.4],
  [5.8, 9.0],
  [6.7, 8.7],
  [3.6, 2.2],
  [6.0, 0.8],
  [6.7, -0.8],
  [6.9, -2.4],
  [6.8, -3.6],
  [6.5, -4.7],
  [5.8, -6.0],
];

/**
 * The cable car stations: the building (x along the rope line, +x up the line) ends at the rope's end point (the OSM
 * station node), so the ropes run into its end wall. Upper: OSM way 229939244 (23.4 m long, 6 m wide) at the summit.
 */
export const LINE_YAW = Math.atan2(741 - -455, -684 - 380);
export const STATION_LENGTH = 23.4;
export const STATION_WIDTH = 6.4;
/** Rope end of the lower / upper station (OSM nodes 1830721340 / 1830721339). */
export const LOWER_NODE = { x: 380.0, z: -455.0 };
export const UPPER_NODE = { x: -683.9, z: 740.7 };
/** The station buildings: the rope end node sits 1 m inside the up-line end wall. */
const stationSite = (n: { x: number; z: number }, back: number): Site => ({
  x: n.x - Math.cos(LINE_YAW) * back,
  z: n.z - Math.sin(LINE_YAW) * back,
  yaw: LINE_YAW,
});
export const LOWER_STATION: Site = stationSite(
  LOWER_NODE,
  STATION_LENGTH / 2 - 1,
);
export const UPPER_STATION: Site = {
  x: -680.87,
  z: 737.21,
  yaw: LINE_YAW,
};

/** St. Panteleimon, Gorno Nerezi (1164), OSM way 1330278523: the five-domed church, axis a little north of east. */
export const NEREZI_CHURCH: Site = { x: -2356.1, z: -524.6, yaw: rad(8) };

/** Observation tower on Abedishte (OSM node 4299022626) and Markovi Kuli, the Byzantine fort ruins (node 3951819342). */
export const LOOKOUT: Site = { x: -1731.8, z: 919.2, yaw: rad(20) };
export const RUINS: Site = { x: 2365.5, z: 440.5, yaw: rad(-25) };

/** A landmark's protected ground (scatter stays off it): a local rectangle (x0, x1, z0, z1) or a circle of `r` m. */
export interface Area {
  site: Site;
  rect?: readonly [number, number, number, number];
  r?: number;
}

/** True when (x, z), grown by `margin`, lies inside one of the areas. */
export function onAreas(
  areas: readonly Area[],
  x: number,
  z: number,
  margin: number,
): boolean {
  return areas.some(({ site, rect, r }) => {
    const reach = r ?? Math.hypot(rect![1] - rect![0], rect![3] - rect![2]);
    if (Math.abs(x - site.x) > reach + margin + 2) return false;
    if (Math.abs(z - site.z) > reach + margin + 2) return false;
    const [lx, lz] = toLocal(site, x, z);
    if (r !== undefined) return Math.hypot(lx, lz) < r + margin;
    return (
      lx > rect![0] - margin &&
      lx < rect![1] + margin &&
      lz > rect![2] - margin &&
      lz < rect![3] + margin
    );
  });
}

export const SREDNO_AREAS: Area[] = [
  { site: SREDNO_CHURCH, rect: [-13.2, 5.8, -6.9, 6.9] },
  { site: LOWER_STATION, rect: [-12.7, 2.5, -4.2, 4.2] },
];
export const SUMMIT_AREAS: Area[] = [
  { site: PLATFORM, r: PLATFORM_RADIUS + 1 },
  { site: LODGE, r: 13 },
  { site: UPPER_STATION, rect: [-12.7, 8, -4.2, 4.2] },
];
export const NEREZI_AREAS: Area[] = [
  { site: NEREZI_CHURCH, rect: [-9, 9.5, -6, 6] },
];
export const OUTPOST_AREAS: Area[] = [
  { site: LOOKOUT, r: 6 },
  { site: RUINS, r: 14 },
];

/**
 * Levelled ground (MapDef.terrain.flatAreas): the ~30 m elevation model gives these hillsides slopes the real structures
 * do not stand on (terraces, a platform, a church lawn). Named: `?spawn=<name>`; no map viewer labels.
 */
export const VODNO_FLATS: FlatArea[] = [
  {
    name: 'sredno_church',
    x: SREDNO_CHURCH.x,
    z: SREDNO_CHURCH.z,
    radius: 15.5,
    blend: 9,
    label: false,
  },
  {
    name: 'cable_lower',
    x: LOWER_STATION.x,
    z: LOWER_STATION.z,
    radius: 12.5,
    blend: 9,
    label: false,
  },
  {
    name: 'cross',
    x: PLATFORM.x,
    z: PLATFORM.z,
    radius: 16,
    blend: 10,
    label: false,
  },
  {
    name: 'lodge',
    x: LODGE.x,
    z: LODGE.z,
    radius: 12,
    blend: 8,
    label: false,
  },
  {
    name: 'cable_upper',
    x: UPPER_STATION.x,
    z: UPPER_STATION.z,
    radius: 12.5,
    blend: 9,
    label: false,
  },
  {
    name: 'nerezi',
    x: NEREZI_CHURCH.x,
    z: NEREZI_CHURCH.z,
    radius: 10,
    blend: 9,
    label: false,
  },
  {
    name: 'lookout',
    x: LOOKOUT.x,
    z: LOOKOUT.z,
    radius: 4.5,
    blend: 5,
    label: false,
  },
  {
    name: 'markovi_kuli',
    x: RUINS.x,
    z: RUINS.z,
    radius: 14,
    blend: 9,
    label: false,
  },
];
