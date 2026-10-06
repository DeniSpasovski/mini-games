import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { ScatterInstance } from '../../../world/scatter';
import { buildStation, BENCHES, SHELTER } from './build';
import {
  CANOPY_COLS,
  CANOPY_Z,
  FORECOURT,
  HALF_L,
  HOUSE_X,
  houseEdge,
  inRect,
  ISLAND_X,
  islandEdges,
  islandTop,
  MAIN_RECT,
  onHouse,
  onIsland,
  STATION,
  stationLevels,
  toLocal,
  toWorld,
  trackZ,
  STATION_TRACK,
  MAIN_TRACK,
  WING_E_RECT,
  WING_W_RECT,
} from './site';
import { RAIL_H } from '../../../world/railways';

/**
 * Ilinden railway station (see site.ts): the station building (two-storey centre block, single-storey wings, a
 * canopy over the house platform), the house platform, the island platform between the station track and the
 * main line (ramps at both ends, a shelter, a name board) with a pedestrian crossing, and the asphalt forecourt.
 * Modelled from the OSM outline in the line's 1970s style (no photos yet: see the map TODO). Geometry in build.ts.
 */

const near = (x: number, z: number, r: number) =>
  Math.abs(x - STATION.x) < r && Math.abs(z - STATION.z) < r;

/** Box collider round a local rectangle, from `y` up `h` metres. */
function box(
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  y: number,
  h: number,
): StaticCollider {
  const [x, z] = toWorld(STATION, (x0 + x1) / 2, (z0 + z1) / 2);
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  return {
    kind: 'box',
    x,
    z,
    y,
    h,
    hx,
    hz,
    rot: -STATION.yaw,
    r: Math.hypot(hx, hz),
  };
}

/** Rail top of a track at local x from the ground (crest of the ballast). */
const railTop = (
  ground: TerrainSampler,
  track: [number, number][],
  x: number,
) => {
  const [wx, wz] = toWorld(STATION, x, trackZ(track, x));
  return ground.height(wx, wz) + RAIL_H;
};

export const stationLandmark: Landmark = {
  id: 'ajvatovci-station',

  occupies: (x, z, m) => {
    if (!near(x, z, 60)) return false;
    const [lx, lz] = toLocal(STATION, x, z);
    return (
      inRect([-HALF_L, HALF_L, -8, CANOPY_Z[1]], lx, lz, m) ||
      inRect(FORECOURT, lx, lz, m) ||
      onHouse(lx, lz, m) ||
      onIsland(lx, lz, m)
    );
  },

  // The placeholder box of the station itself and any on the platforms / forecourt.
  replaces: (b) => {
    if (!near(b.x, b.z, 60)) return false;
    const [lx, lz] = toLocal(STATION, b.x, b.z);
    return (
      inRect([-HALF_L, HALF_L, -8, CANOPY_Z[1]], lx, lz, 2) ||
      inRect(FORECOURT, lx, lz) ||
      onHouse(lx, lz) ||
      onIsland(lx, lz)
    );
  },

  surfaceAt: (x, z) => {
    if (!near(x, z, 60)) return undefined;
    const [lx, lz] = toLocal(STATION, x, z);
    return inRect(FORECOURT, lx, lz) || onHouse(lx, lz) || onIsland(lx, lz)
      ? 'tarmac'
      : undefined;
  },

  // The platform tops (the island's ramps lead up from the track level at its ends).
  groundOverride: (ground) => {
    const lv = stationLevels(ground);
    return (x, z) => {
      if (!near(x, z, 60)) return NaN;
      const [lx, lz] = toLocal(STATION, x, z);
      if (onHouse(lx, lz)) return lv.floor;
      if (onIsland(lx, lz)) {
        const rail = Math.max(
          railTop(ground, STATION_TRACK, lx),
          railTop(ground, MAIN_TRACK, lx),
        );
        return islandTop(lv, lx, rail);
      }
      return NaN;
    };
  },

  colliders: (ground) => {
    const lv = stationLevels(ground);
    const y = lv.floor - 1.2;
    const out: StaticCollider[] = [
      box(MAIN_RECT, y, 10.5),
      box(WING_W_RECT, y, 6.5),
      box(WING_E_RECT, y, 6.5),
    ];
    for (const cx of CANOPY_COLS) {
      const [x, z] = toWorld(STATION, cx, CANOPY_Z[1] - 0.3);
      out.push({ kind: 'cylinder', x, z, y: lv.floor - 0.2, r: 0.2, h: 3.6 });
    }
    // The platforms' track-side faces: a car on the tracks hits the edge instead of climbing it.
    const edge = (
      x0: number,
      x1: number,
      zAt: (x: number) => number,
      top: number,
      side: number,
    ) => {
      for (let x = x0; x < x1; x += 6) {
        const end = Math.min(x + 6, x1);
        const z = zAt((x + end) / 2) + side * 0.15;
        out.push(box([x, end, z - 0.15, z + 0.15], top - 1.4, 1.4));
      }
    };
    edge(HOUSE_X[0], HOUSE_X[1], houseEdge, lv.floor, -1);
    const i0 = ISLAND_X[0] + 6;
    const i1 = ISLAND_X[1] - 6;
    edge(i0, i1, (x) => islandEdges(x)[0], lv.island, 1);
    edge(i0, i1, (x) => islandEdges(x)[1], lv.island, -1);
    // Shelter posts and benches.
    for (const px of [SHELTER.x0 + 0.4, SHELTER.x1 - 0.4]) {
      const [x, z] = toWorld(STATION, px, SHELTER.z);
      out.push({ kind: 'cylinder', x, z, y: lv.island - 0.2, r: 0.12, h: 3.2 });
    }
    for (const b of BENCHES) {
      const top = b.island ? lv.island : lv.floor;
      out.push(
        box([b.x - 0.9, b.x + 0.9, b.z - 0.3, b.z + 0.3], top - 0.1, 0.9),
      );
    }
    return out;
  },

  // Platform lamps (fixed scatter: LOD + their own colliders).
  instances: (ground) => {
    const lv = stationLevels(ground);
    const out: ScatterInstance[] = [];
    const lamp = (lx: number, lz: number, y: number, rotY: number) => {
      const [x, z] = toWorld(STATION, lx, lz);
      out.push({
        asset: 'street_lamp',
        variant: 0,
        x,
        y,
        z,
        rotY,
        scale: 0.85,
        tiltX: 0,
        tiltZ: 0,
      });
    };
    for (const lx of [-21, 21])
      lamp(lx, houseEdge(lx) - 1.2, lv.floor, -STATION.yaw);
    for (const lx of [-12, 0, 12, 24]) {
      const [a, b] = islandEdges(lx);
      lamp(lx, (a + b) / 2, lv.island, -STATION.yaw);
    }
    return out;
  },

  build: buildStation,
};

export { STATION_FLAT } from './site';
