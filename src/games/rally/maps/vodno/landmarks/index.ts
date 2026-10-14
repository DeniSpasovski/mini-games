import type { Group } from 'three';
import { getAssetMeta } from '../../../assets/catalog';
import { hash3 } from '../../../../../shared/rng';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Landmark } from '../../../world/landmarks';
import type { ScatterInstance } from '../../../world/scatter';
import type { World } from '../../../world/world';
import { Local } from '../../ajvatovci/hilltop/build/shapes';
import { Bucket } from '../../ajvatovci/start-row/build/kit';
import type { BuildingDef } from '../../shared/types';
import { boxCollider, cylinderCollider, turnedBoxCollider } from './common';
import { buildNereziChurch } from './nerezi-church';
import { buildLookout, buildRuins, ruinsLayout } from './outposts';
import { buildSrednoChurch, NAVE_X0 } from './sredno-church';
import { buildStation } from './station';
import { buildLodge, buildPlatform } from './summit';
import {
  LODGE,
  LOOKOUT,
  LOT_FLAGPOLE,
  LOWER_STATION,
  NEREZI_AREAS,
  NEREZI_CHURCH,
  onAreas,
  OUTPOST_AREAS,
  PLATFORM,
  RUINS,
  SREDNO_AREAS,
  SREDNO_CHURCH,
  STATION_LENGTH,
  STATION_WIDTH,
  SUMMIT_AREAS,
  toWorld,
  UPPER_STATION,
  type Area,
  type Site,
} from './sites';

/**
 * The hand-modelled landmarks of Vodno Hillclimb, from the Ajvatovci hilltop's kit (`ajvatovci/hilltop/build/shapes.ts`):
 * the three-lobed church and the lower cable car station at Sredno Vodno (the finish), the Millennium Cross platform, the
 * mountain lodge and the upper station on the summit, the five-domed church of St. Panteleimon at Gorno Nerezi, the
 * observation tower on Abedishte and the ruins of Markovi Kuli. Far landmarks: the rough shape and the materials of the
 * Ajvatovci church, fewer details. Positions in `sites.ts`, notes in the map's DETAILS.md. Pure data here - safe in node.
 */
interface Plant {
  asset: string;
  site: Site;
  x: number;
  z: number;
  scale: number;
}

interface Spec {
  id: string;
  areas: Area[];
  /** Placeholder buildings this landmark stands in for besides those whose centre lies in its areas. */
  replaces?: (b: BuildingDef) => boolean;
  colliders: (ground: TerrainSampler) => StaticCollider[];
  plants?: Plant[];
  /** Writes the structures into the bucket, `at` = a structure's frame on the ground under its site. */
  build: (at: (site: Site, tile: string) => Local) => void;
}

function landmark(spec: Spec): Landmark {
  return {
    id: spec.id,
    occupies: (x, z, margin) => onAreas(spec.areas, x, z, margin),
    replaces: (b) => onAreas(spec.areas, b.x, b.z, 0) || !!spec.replaces?.(b),
    colliders: (ground) => spec.colliders(ground),
    instances: (ground): ScatterInstance[] =>
      (spec.plants ?? []).map((p, i) => {
        const [x, z] = toWorld(p.site, p.x, p.z);
        const h = hash3(i, 9, 5, 5101);
        return {
          asset: p.asset,
          variant: h % getAssetMeta(p.asset).variants,
          x,
          y: ground.height(x, z),
          z,
          rotY: ((h >>> 8) % 628) / 100,
          scale: p.scale,
          tiltX: 0,
          tiltZ: 0,
        };
      }),
    *build(world: World): Generator<void, Group> {
      const bucket = new Bucket();
      const at = (site: Site, tile: string) =>
        new Local(bucket, tile, site, world.analytic.height(site.x, site.z));
      spec.build(at);
      yield;
      const group = bucket.build(spec.id);
      group.userData.stats = {
        triangles: bucket.triangles,
        meshes: group.children.length,
      };
      return group;
    },
  };
}

/** The ground level the colliders start at: a little under the structure's ground. */
const base = (ground: TerrainSampler, s: Site): number =>
  ground.height(s.x, s.z) - 0.8;

const HALF_L = STATION_LENGTH / 2;
const HALF_W = STATION_WIDTH / 2;

/** Sredno Vodno: the church of the Nativity of the Theotokos and the lower cable car station. */
export const srednoVodnoLandmark = landmark({
  id: 'vodno-sredno-vodno',
  areas: SREDNO_AREAS,
  // The baked box of the station (the OSM node has no building: bake config `buildings.manual`).
  replaces: (b) => Math.hypot(b.x - 380, b.z + 455) < 4,
  colliders: (g) => {
    const yc = base(g, SREDNO_CHURCH);
    const ys = base(g, LOWER_STATION);
    return [
      boxCollider(SREDNO_CHURCH, [NAVE_X0, -4.2, -3.05, 3.05], yc, 5.6),
      boxCollider(SREDNO_CHURCH, [-4.2, 2.05, -3.05, 3.05], yc, 6.8),
      cylinderCollider(SREDNO_CHURCH, -1.1, -3.05, yc, 3.1, 3.8),
      cylinderCollider(SREDNO_CHURCH, -1.1, 3.05, yc, 3.1, 3.8),
      cylinderCollider(SREDNO_CHURCH, 2.05, 0, yc, 3.1, 3.8),
      boxCollider(LOWER_STATION, [-HALF_L, HALF_L, -HALF_W, HALF_W], ys, 9.6),
      cylinderCollider(LOT_FLAGPOLE, 0, 0, base(g, LOT_FLAGPOLE), 0.12, 11),
    ];
  },
  plants: [
    { asset: 'flagpole', site: LOT_FLAGPOLE, x: 0, z: 0, scale: 1 },
    { asset: 'juniper', site: SREDNO_CHURCH, x: -9, z: -4.6, scale: 0.8 },
    { asset: 'juniper', site: SREDNO_CHURCH, x: -5, z: 6.4, scale: 0.7 },
    { asset: 'pine_tree', site: SREDNO_CHURCH, x: -14.5, z: 4.6, scale: 0.9 },
    { asset: 'bush', site: SREDNO_CHURCH, x: 6.2, z: 4.6, scale: 0.7 },
  ],
  build: (at) => {
    buildSrednoChurch(at(SREDNO_CHURCH, 'church'));
    buildStation(
      at(LOWER_STATION, 'lower-station'),
      STATION_LENGTH,
      STATION_WIDTH,
      1,
    );
  },
});

/** The summit: the cross platform (the cross itself is the asset `millennium_cross`), the lodge, the upper station. */
export const summitLandmark = landmark({
  id: 'vodno-summit',
  areas: SUMMIT_AREAS,
  colliders: (g) => {
    const yp = base(g, PLATFORM);
    const yl = base(g, LODGE);
    const yu = base(g, UPPER_STATION);
    const out: StaticCollider[] = [
      cylinderCollider(PLATFORM, 0, 0, yp, 7.2, 6),
      boxCollider(PLATFORM, [-3.2, 3.2, 12, 15.6], yp, 5.8),
      cylinderCollider(LODGE, 0.8, -3, yl, 6, 7),
      cylinderCollider(LODGE, -5.5, 4.5, yl, 4.2, 7),
      cylinderCollider(LODGE, 0, 6, yl, 4.2, 7),
      cylinderCollider(LODGE, 5, 5, yl, 4.2, 7),
      boxCollider(UPPER_STATION, [-HALF_L, HALF_L, -HALF_W, HALF_W], yu, 9.6),
    ];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out.push(
        cylinderCollider(
          PLATFORM,
          Math.cos(a) * 10.1,
          Math.sin(a) * 10.1,
          yp,
          0.6,
          5.2,
        ),
      );
    }
    return out;
  },
  plants: [
    { asset: 'juniper', site: LODGE, x: 12, z: 2, scale: 0.7 },
    { asset: 'juniper', site: LODGE, x: -13, z: 6, scale: 0.6 },
    { asset: 'rock_boulder', site: PLATFORM, x: 17, z: -6, scale: 1.1 },
  ],
  build: (at) => {
    buildPlatform(at(PLATFORM, 'platform'));
    buildLodge(at(LODGE, 'lodge'));
    buildStation(
      at(UPPER_STATION, 'upper-station'),
      STATION_LENGTH,
      STATION_WIDTH,
      -1,
    );
  },
});

/** Gorno Nerezi: the church of St. Panteleimon. */
export const nereziLandmark = landmark({
  id: 'vodno-nerezi',
  areas: NEREZI_AREAS,
  colliders: (g) => {
    const y = base(g, NEREZI_CHURCH);
    return [
      boxCollider(NEREZI_CHURCH, [-5.05, 5.85, -1.9, 1.9], y, 8),
      boxCollider(NEREZI_CHURCH, [-1.9, 1.9, -4.8, 4.8], y, 8),
      boxCollider(NEREZI_CHURCH, [-5.05, -1.9, 1.9, 4.8], y, 6),
      boxCollider(NEREZI_CHURCH, [-5.05, -1.9, -4.8, -1.9], y, 6),
      boxCollider(NEREZI_CHURCH, [1.9, 5.85, 1.9, 4.8], y, 6),
      boxCollider(NEREZI_CHURCH, [1.9, 5.85, -4.8, -1.9], y, 6),
      boxCollider(NEREZI_CHURCH, [-7.95, -5.05, -4.8, 4.8], y, 5),
      cylinderCollider(NEREZI_CHURCH, 5.85, 0, y, 1.9, 5),
    ];
  },
  plants: [
    { asset: 'juniper', site: NEREZI_CHURCH, x: -9.5, z: -5.5, scale: 0.9 },
    { asset: 'juniper', site: NEREZI_CHURCH, x: -9.5, z: 5.5, scale: 0.9 },
    { asset: 'oak_tree', site: NEREZI_CHURCH, x: 4, z: 8.5, scale: 1 },
    { asset: 'bush', site: NEREZI_CHURCH, x: -3.5, z: -7, scale: 0.7 },
    { asset: 'bush', site: NEREZI_CHURCH, x: 2, z: 7.2, scale: 0.6 },
  ],
  build: (at) => buildNereziChurch(at(NEREZI_CHURCH, 'church')),
});

/** Outposts: the observation tower on Abedishte, the ruins of Markovi Kuli. */
export const outpostsLandmark = landmark({
  id: 'vodno-outposts',
  areas: OUTPOST_AREAS,
  colliders: (g) => {
    const yt = base(g, LOOKOUT);
    const yr = base(g, RUINS);
    const { stumps, towers } = ruinsLayout();
    return [
      boxCollider(LOOKOUT, [-2.6, 2.6, -2.6, 2.6], yt, 11),
      ...towers.map(([x, z, r, h]) => cylinderCollider(RUINS, x, z, yr, r, h)),
      // The wall stumps (a car does not drive through them).
      ...stumps.map(({ a, b, h }) =>
        turnedBoxCollider(
          RUINS,
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2,
          Math.atan2(b[1] - a[1], b[0] - a[0]),
          Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
          1.3,
          yr,
          h,
        ),
      ),
    ];
  },
  build: (at) => {
    buildLookout(at(LOOKOUT, 'lookout'));
    buildRuins(at(RUINS, 'ruins'));
  },
});

export const VODNO_LANDMARKS: Landmark[] = [
  srednoVodnoLandmark,
  summitLandmark,
  nereziLandmark,
  outpostsLandmark,
];
export { VODNO_FLATS } from './sites';
