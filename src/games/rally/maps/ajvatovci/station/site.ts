import type { FlatArea } from '../../shared/types';
import { RAIL_H } from '../../../world/railways';
import data from '../data.json';
import { toLocal, toWorld, type Site } from '../hilltop/site';

/**
 * Ilinden railway station (OSM way 640268324 `building=train_station`, node 1861425879 `railway=station`) on the
 * Tabanovci - Gevgelija main line, 200 m west of the stage start. World metres (+X east, +Z south), reprojected
 * with the baker's `Proj` so the outline lines up with the baked tracks. Pure data + helpers (runs in node).
 *
 * Local frame (`STATION`): x along the building's long side (east), z across (+z = south, towards the tracks),
 * y up. The tracks run parallel to x: the station track (OSM spur 640268322) 15 m south of the building centre,
 * then the two main line tracks (173769542, 1066438264).
 */

/** OSM way 640268324: 34.6 x 15.5 m. */
export const STATION_OSM: [number, number][] = [
  [-1664.67, 578.23],
  [-1630.15, 580.6],
  [-1631.23, 596.09],
  [-1665.74, 593.7],
];
/** OSM way 640268325 `railway=platform` (the island platform's centre line). */
export const PLATFORM_OSM: [number, number][] = [
  [-1670.23, 607.73],
  [-1610.95, 611.91],
];

export const STATION: Site = {
  x: STATION_OSM.reduce((s, p) => s + p[0], 0) / 4,
  z: STATION_OSM.reduce((s, p) => s + p[1], 0) / 4,
  yaw: Math.atan2(
    STATION_OSM[1][1] - STATION_OSM[0][1],
    STATION_OSM[1][0] - STATION_OSM[0][0],
  ),
};
export const HALF_L = 17.3;
export const HALF_D = 7.75;

/** Building parts (local x0, x1, z0, z1): the two-storey centre block and the single-storey wings. */
export const MAIN_RECT = [-7, 7, -HALF_D, 4.25] as const;
export const WING_W_RECT = [-HALF_L, -7, -6.25, 4.25] as const;
export const WING_E_RECT = [7, HALF_L, -6.25, 4.25] as const;
/** The platform canopy along the south face (columns on its outer edge). */
export const CANOPY_Z = [4.25, 8.2] as const;
/** Canopy columns (local x) on its outer edge. */
export const CANOPY_COLS = [-15.5, -10, -4.5, 4.5, 10, 15.5];

/** Platform height over the rail top (m): the low platforms of the line. */
export const PLATFORM_H = 0.38;
/** Platform edge to track centre (m). */
export const EDGE_OFF = 1.65;
/** House platform (building to the station track) and island platform (between it and the main line), local x. */
export const HOUSE_X = [-27, 27] as const;
export const ISLAND_X = [-24, 37] as const;
/** Length of the ramps at the island platform's ends (m). */
export const RAMP = 6;
/** Forecourt north of the building (local x0, x1, z0, z1). */
export const FORECOURT = [-22, 22, -17, -HALF_D] as const;
/** Pedestrian crossing over the station track, local x. */
export const CROSSING_X = -12;

/** The baked track (MapDef.railways) passing within 1.5 m of a world point, in local coordinates. */
function trackThrough(x: number, z: number): [number, number][] {
  for (const r of data.railways) {
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ex = p[k + 2] - p[k];
      const ez = p[k + 3] - p[k + 1];
      const L2 = ex * ex + ez * ez || 1;
      const t = Math.max(
        0,
        Math.min(1, ((x - p[k]) * ex + (z - p[k + 1]) * ez) / L2),
      );
      if (Math.hypot(p[k] + ex * t - x, p[k + 1] + ez * t - z) < 1.5) {
        const out: [number, number][] = [];
        for (let i = 0; i < p.length; i += 2)
          out.push(toLocal(STATION, p[i], p[i + 1]));
        return out.sort((a, b) => a[0] - b[0]);
      }
    }
  }
  throw new Error(`station: no baked track through ${x}, ${z}`);
}

/** Local polylines (sorted by x) of the station track and the nearer main line track. */
export const STATION_TRACK = trackThrough(-1650, 602.64);
export const MAIN_TRACK = trackThrough(-1650, 611.69);

/** Local z of a track at local x. */
export function trackZ(track: [number, number][], x: number): number {
  for (let i = 0; i + 1 < track.length; i++) {
    const [x0, z0] = track[i];
    const [x1, z1] = track[i + 1];
    if (x >= x0 && x <= x1) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0 || 1);
  }
  return x < track[0][0] ? track[0][1] : track[track.length - 1][1];
}

/** Edges of the platforms at local x (local z). */
export const houseEdge = (x: number) => trackZ(STATION_TRACK, x) - EDGE_OFF;
export const islandEdges = (x: number): [number, number] => [
  trackZ(STATION_TRACK, x) + EDGE_OFF,
  trackZ(MAIN_TRACK, x) - EDGE_OFF,
];

export interface StationLevels {
  /** Building floor = house platform top (world y). */
  floor: number;
  /** Island platform top (world y). */
  island: number;
  /** Rail top of the station track at the crossing (world y). */
  crossing: number;
}

/** Platform levels from the ground (the terrain carries the ballast crest on the track centre). */
export function stationLevels(ground: {
  height(x: number, z: number): number;
}): StationLevels {
  const railTop = (track: [number, number][], x: number) => {
    const [wx, wz] = toWorld(STATION, x, trackZ(track, x));
    return ground.height(wx, wz) + RAIL_H;
  };
  const mean = (f: (x: number) => number, x0: number, x1: number) => {
    let s = 0;
    for (let i = 0; i <= 8; i++) s += f(x0 + ((x1 - x0) * i) / 8);
    return s / 9;
  };
  return {
    floor:
      mean((x) => railTop(STATION_TRACK, x), HOUSE_X[0], HOUSE_X[1]) +
      PLATFORM_H,
    island:
      mean(
        (x) => (railTop(STATION_TRACK, x) + railTop(MAIN_TRACK, x)) / 2,
        ISLAND_X[0],
        ISLAND_X[1],
      ) + PLATFORM_H,
    crossing: railTop(STATION_TRACK, CROSSING_X),
  };
}

/** Inside a local rectangle grown by `m`. */
export const inRect = (
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  x: number,
  z: number,
  m = 0,
) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;

/** On the house platform (local), grown by `m`. */
export const onHouse = (x: number, z: number, m = 0) =>
  x > HOUSE_X[0] - m &&
  x < HOUSE_X[1] + m &&
  z > 4.25 - m &&
  z < houseEdge(x) + m;

/** On the island platform (local, incl. its ramps), grown by `m`. */
export function onIsland(x: number, z: number, m = 0): boolean {
  if (x < ISLAND_X[0] - m || x > ISLAND_X[1] + m) return false;
  const [a, b] = islandEdges(x);
  return z > a - m && z < b + m;
}

/** Island platform top at local x (world y): level, ramps down to the rail-top level at both ends. */
export function islandTop(levels: StationLevels, x: number, rail: number) {
  const e = Math.min(x - ISLAND_X[0], ISLAND_X[1] - x);
  return rail + (levels.island - rail) * Math.min(1, Math.max(0, e / RAMP));
}

/**
 * Level ground round the station (named: `?spawn=station`). The 30 m elevation model is gently tilted there; the
 * building and its forecourt stand on one level.
 */
export const STATION_FLAT: FlatArea = {
  name: 'station',
  ...(() => {
    const [x, z] = toWorld(STATION, 0, -6);
    return { x, z };
  })(),
  radius: 21,
  blend: 12,
  label: false,
};

export { toLocal, toWorld };
