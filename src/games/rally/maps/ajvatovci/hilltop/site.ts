import type { FlatArea } from '../../shared/types';

/**
 * Where the hilltop landmark's structures stand (world metres, +X east, +Z south). Outlines are the
 * OpenStreetMap ways reprojected with the baker's projection (`scripts/realmap/bake.py` `Proj`, origin
 * 42.004 N, 21.596 E), so they line up with the baked buildings / paths. Pure data (runs in node).
 *
 * A `Site` is a structure's local frame: local +x runs along `yaw` (rad, from +X towards +Z), local +z
 * is 90 degrees clockwise from it seen from above (towards +Z when yaw = 0), y is up from the ground.
 */
export interface Site {
  x: number;
  z: number;
  yaw: number;
}

/** OSM way 1395332286 "St. Peter & St. Paul" (building=church): body + the south porch on the west half. */
export const CHURCH_OSM: [number, number][] = [
  [1505.03, -506.32],
  [1501.66, -497.12],
  [1506.39, -495.39],
  [1507.7, -498.96],
  [1512.46, -497.23],
  [1514.53, -502.86],
];

/** OSM way 1395332293 (building=yes): the bell tower north-west of the church. */
export const TOWER_OSM: [number, number][] = [
  [1493.03, -516.61],
  [1491.0, -511.89],
  [1495.48, -509.98],
  [1497.51, -514.7],
];

/** OSM way 1395332282 (leisure=pitch, surface=asphalt): the playground court by the hill road junction. */
export const COURT_OSM: [number, number][] = [
  [1653.22, -367.71],
  [1628.6, -348.36],
  [1641.61, -331.94],
  [1666.22, -351.28],
];

/**
 * The church: local x = its east-west axis (the apse at +x, east), z = across (+z = the south side with
 * the porch). The OSM outline is 10.1 x 9.8 m, 20 degrees off east: a 6 m wide body (OSM v -4.9 .. 1.1)
 * plus the porch strip on its south-west (v 1.1 .. 4.9), so the body's centre line sits 1.9 m north of
 * the outline's centre. The apse (not in the OSM outline) adds ~1.7 m at the east end.
 */
const CHURCH_YAW = Math.atan2(
  CHURCH_OSM[5][1] - CHURCH_OSM[0][1],
  CHURCH_OSM[5][0] - CHURCH_OSM[0][0],
);
const OSM_CENTRE = { x: 1508.094, z: -499.987 };
const BODY_SHIFT = -1.9;
export const CHURCH: Site = {
  x: OSM_CENTRE.x - Math.sin(CHURCH_YAW) * BODY_SHIFT,
  z: OSM_CENTRE.z + Math.cos(CHURCH_YAW) * BODY_SHIFT,
  yaw: CHURCH_YAW,
};

/** The bell tower: centre and edge direction of its OSM square. */
export const TOWER: Site = {
  x: TOWER_OSM.reduce((s, p) => s + p[0], 0) / 4,
  z: TOWER_OSM.reduce((s, p) => s + p[1], 0) / 4,
  yaw: Math.atan2(
    TOWER_OSM[2][1] - TOWER_OSM[1][1],
    TOWER_OSM[2][0] - TOWER_OSM[1][0],
  ),
};

/** The court: local x along its long side (31.3 m), z across (20.9 m). */
export const COURT: Site = {
  x: COURT_OSM.reduce((s, p) => s + p[0], 0) / 4,
  z: COURT_OSM.reduce((s, p) => s + p[1], 0) / 4,
  yaw: Math.atan2(
    COURT_OSM[0][1] - COURT_OSM[1][1],
    COURT_OSM[0][0] - COURT_OSM[1][0],
  ),
};
export const COURT_SIZE = {
  length: Math.hypot(
    COURT_OSM[0][0] - COURT_OSM[1][0],
    COURT_OSM[0][1] - COURT_OSM[1][1],
  ),
  width: Math.hypot(
    COURT_OSM[2][0] - COURT_OSM[1][0],
    COURT_OSM[2][1] - COURT_OSM[1][1],
  ),
};

/** Local (x, z) of a site -> world (x, z). */
export function toWorld(site: Site, x: number, z: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  return [site.x + x * c - z * s, site.z + x * s + z * c];
}

/** World (x, z) -> local (x, z) of a site. */
export function toLocal(site: Site, x: number, z: number): [number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  const dx = x - site.x;
  const dz = z - site.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}

/** Local rectangles (x0, x1, z0, z1) of the solid / occupied parts: scatter is kept off them. */
export const CHURCH_RECT = [-5.7, 7.1, -3.6, 3.6] as const;
export const PORCH_RECT = [-5.3, -1.4, 3.0, 6.0] as const;
export const TOWER_RECT = [-2.6, 2.6, -2.6, 2.6] as const;
export const COURT_RECT = [
  -COURT_SIZE.length / 2,
  COURT_SIZE.length / 2,
  -COURT_SIZE.width / 2,
  COURT_SIZE.width / 2,
] as const;

/**
 * Levelled ground (MapDef.terrain.flatAreas): the 30 m elevation model gives the hilltop lawn and the
 * court a ~20 % slope, the real ones are level (the church on a mown lawn, the court on a terrace cut
 * into the hillside). One disc round the church + bell tower (+ one under the event marquees), one round
 * the court; the names make them
 * spawn points (`?spawn=church`, `?spawn=court`); no map viewer labels.
 */
export const HILLTOP_FLATS: FlatArea[] = [
  { name: 'church', x: 1504.7, z: -506.4, radius: 16, blend: 9, label: false },
  // The marquees in front of the church (yard.ts TENTS) stand on a level patch too.
  { name: 'marquees', x: 1507.7, z: -531, radius: 7.5, blend: 7, label: false },
  {
    name: 'court',
    x: COURT.x,
    z: COURT.z,
    radius: Math.hypot(COURT_SIZE.length, COURT_SIZE.width) / 2 + 0.8,
    blend: 7,
    label: false,
  },
];
