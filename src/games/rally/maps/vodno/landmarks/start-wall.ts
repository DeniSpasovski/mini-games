import { Matrix4 } from 'three';
import type { StaticCollider } from '../../../physics/types';
import type { TerrainSampler } from '../../../world/heightfield';
import type { Local } from '../../ajvatovci/hilltop/build/shapes';
import { turnedBoxCollider } from './common';
import type { Area, Site } from './sites';

/**
 * The street wall in front of the two blocks of flats: ONE wall along the road (the left side of the climb), a render base
 * that holds up the garden terraces with a timber panel fence on top, stepping with the ground in sections and rising to
 * a render pillar every other joint. `WALL_PTS` is the line 6.6 m left of the stage road's centre, world metres.
 */
const WALL_PTS: readonly [number, number][] = [
  [1514.2, -997.0],
  [1518.1, -993.1],
  [1522.4, -989.3],
  [1526.7, -985.8],
  [1530.9, -983.0],
  [1535.5, -980.9],
  [1540.9, -979.1],
  [1546.7, -977.2],
  [1552.3, -975.3],
];
/** Longest section of the wall (m): the polyline is cut into equal sections of about this length. */
const SECTION = 3;
/** The base reaches this far above the terraces behind it (m), the fence its own height above that. */
const BASE_UP = 0.5;
const FENCE = 1.2;
const SLATS = ['#a96b3d', '#b47745', '#9d6236', '#b07240'];

export const WALL_SITE: Site = { x: WALL_PTS[0][0], z: WALL_PTS[0][1], yaw: 0 };

export interface WallSection {
  /** Start and end in the world, the direction (rad from +x towards +z), the length and the unit normal away from the road. */
  a: [number, number];
  b: [number, number];
  angle: number;
  len: number;
  n: [number, number];
}

/** The wall cut into sections along its line. */
export function wallSections(): WallSection[] {
  const out: WallSection[] = [];
  for (let i = 0; i + 1 < WALL_PTS.length; i++) {
    const [ax, az] = WALL_PTS[i];
    const [bx, bz] = WALL_PTS[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.round(length / SECTION));
    const len = length / k;
    const dx = (bx - ax) / length;
    const dz = (bz - az) / length;
    for (let j = 0; j < k; j++) {
      out.push({
        a: [ax + dx * len * j, az + dz * len * j],
        b: [ax + dx * len * (j + 1), az + dz * len * (j + 1)],
        angle: Math.atan2(dz, dx),
        len,
        // Left of the direction of travel: the side the blocks stand on.
        n: [dz, -dx],
      });
    }
  }
  return out;
}

/** Where scatter stays off: a thin strip along every section. */
export const wallAreas = (): Area[] =>
  wallSections().map((s) => ({
    site: { x: s.a[0], z: s.a[1], yaw: s.angle },
    rect: [-0.6, s.len + 0.6, -1.4, 1.4],
  }));

/** Heights of one section: the terrace behind it, the street under it. */
function levels(
  s: WallSection,
  gy: (x: number, z: number) => number,
): { top: number; bottom: number } {
  const at = (p: [number, number], d: number): number =>
    gy(p[0] + s.n[0] * d, p[1] + s.n[1] * d);
  const wall = Math.max(at(s.a, 0), at(s.b, 0));
  const terrace = Math.max(at(s.a, 1.7), at(s.b, 1.7));
  const street = Math.min(at(s.a, -0.5), at(s.b, -0.5));
  return { top: Math.max(wall, terrace) + BASE_UP, bottom: street - 0.4 };
}

/** Writes the wall into `l` (a frame at `WALL_SITE`, yaw 0): `ground` = the world's terrain height. */
export function buildStartWall(
  l: Local,
  ground: (x: number, z: number) => number,
): void {
  const base0 = ground(WALL_SITE.x, WALL_SITE.z);
  const gy = (x: number, z: number): number => ground(x, z) - base0;
  const secs = wallSections();
  const lv = secs.map((s) => levels(s, gy));
  secs.forEach((s, i) => {
    const { top, bottom } = lv[i];
    const m = new Matrix4()
      .makeRotationY(-s.angle)
      .setPosition(s.a[0] - WALL_SITE.x, 0, s.a[1] - WALL_SITE.z);
    const L = s.len;
    l.box('render', [0, bottom, -0.14], [L, top, 0.14], '#e6e3da', m);
    l.box('paint', [0, top, -0.17], [L, top + 0.07, 0.17], '#cfcbc0', m);
    for (let k = 0; k < 4; k++)
      l.box(
        'paint',
        [0.04, top + 0.07 + k * 0.28, -0.04],
        [L - 0.04, top + 0.07 + (k + 1) * 0.28 - 0.02, 0.04],
        SLATS[(i + k) % 4],
        m,
      );
    l.box(
      'paint',
      [0, top + FENCE + 0.07, -0.05],
      [L, top + FENCE + 0.13, 0.05],
      '#3d4247',
      m,
    );
    // Pillars at the ends and every other joint (a slim post at the rest).
    const joint = (x: number, last: number, pillar: boolean): void => {
      const up = Math.max(top, last);
      if (pillar) {
        l.box(
          'render',
          [x - 0.26, bottom, -0.26],
          [x + 0.26, up + FENCE + 0.45, 0.26],
          '#e9e6dd',
          m,
        );
        l.box(
          'paint',
          [x - 0.32, up + FENCE + 0.45, -0.32],
          [x + 0.32, up + FENCE + 0.54, 0.32],
          '#cfcbc0',
          m,
        );
      } else
        l.box(
          'paint',
          [x - 0.03, top + 0.07, -0.06],
          [x + 0.03, top + FENCE + 0.13, 0.06],
          '#3d4247',
          m,
        );
    };
    if (i === 0 || i % 2 === 0) joint(0, lv[i - 1]?.top ?? top, true);
    else joint(0, top, false);
    if (i === secs.length - 1) joint(L, top, true);
  });
}

/** The wall stops a car (the base and the fence in one collider per section). */
export function startWallColliders(g: TerrainSampler): StaticCollider[] {
  const world = (x: number, z: number): number => g.height(x, z);
  return wallSections().map((s) => {
    const { top, bottom } = levels(s, world);
    const mx = (s.a[0] + s.b[0]) / 2;
    const mz = (s.a[1] + s.b[1]) / 2;
    return turnedBoxCollider(
      WALL_SITE,
      mx - WALL_SITE.x,
      mz - WALL_SITE.z,
      s.angle,
      s.len / 2,
      0.25,
      bottom,
      top - bottom + FENCE + 0.2,
    );
  });
}
