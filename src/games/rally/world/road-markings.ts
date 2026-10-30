import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { getTexture } from '../engine/textures';
import type { RoadMarking } from '../maps/shared/types';
import type { World } from './world';

/**
 * Road paint (RoadDef.markings): lane lines and arrows laid on the stage road over its texture, as thin meshes along
 * the road. Pure geometry in `roadPaint` (the tests run it), the meshes in `roadMarkingsMesh`.
 */

/** Paint sits this far above the ground (m): the road ribbon is 0.02 above it. */
const LIFT = 0.036;
/** Metres between the points of a line (a curve is followed within a few centimetres). */
const STEP = 1;
/** Metres of line per repeat of the paint texture. */
const LINE_TILE = 4;
const DEFAULT_WIDTH = 0.15;
/** An arrow's size (m): the tail is where `at` minus half its length is. */
export const ARROW = { length: 4, width: 1.1 };

/** Triangles of one kind of paint: positions (xyz), uvs and indices. */
export interface Paint {
  pos: number[];
  uv: number[];
  idx: number[];
}

export interface RoadPaint {
  lines: Paint;
  left: Paint;
  straight: Paint;
}

/** What the paint needs of the road: its centre, direction and half width at a distance along it. */
export interface PaintRoad {
  at(along: number): {
    x: number;
    z: number;
    tx: number;
    tz: number;
    halfWidth: number;
  };
}

const empty = (): Paint => ({ pos: [], uv: [], idx: [] });

/** The dashes of a line: [from, to] pieces, a solid line is one piece. */
export function dashes(
  from: number,
  to: number,
  dash?: [number, number],
): [number, number][] {
  if (!dash) return [[from, to]];
  const out: [number, number][] = [];
  const period = dash[0] + dash[1];
  for (let a = from; a < to - 1e-6; a += period)
    out.push([a, Math.min(to, a + dash[0])]);
  return out;
}

/** The geometry of every marking on `road`; `height` = the ground height at (x, z). */
export function roadPaint(
  road: PaintRoad,
  markings: readonly RoadMarking[],
  height: (x: number, z: number) => number,
): RoadPaint {
  const out: RoadPaint = { lines: empty(), left: empty(), straight: empty() };
  /** A point `lat` m to the left of the road centre at `d`. */
  const point = (
    d: number,
    edge: 'left' | 'right',
    offset: number,
    off: number,
  ) => {
    const s = road.at(d);
    const lat =
      (edge === 'left' ? s.halfWidth - offset : offset - s.halfWidth) + off;
    const x = s.x + s.tz * lat;
    const z = s.z - s.tx * lat;
    return [x, height(x, z) + LIFT, z] as const;
  };
  const quad = (
    p: Paint,
    rows: { l: readonly number[]; r: readonly number[]; v: number }[],
  ): void => {
    const v0 = p.pos.length / 3;
    for (const row of rows) {
      p.pos.push(...row.l, ...row.r);
      p.uv.push(0, row.v, 1, row.v);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = v0 + i * 2;
      p.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  };
  for (const m of markings) {
    if (m.kind === 'line') {
      const w = m.width ?? DEFAULT_WIDTH;
      for (const [a, b] of dashes(m.from, m.to, m.dash)) {
        const rows = [];
        const n = Math.max(1, Math.ceil((b - a) / STEP));
        for (let i = 0; i <= n; i++) {
          const d = a + ((b - a) * i) / n;
          rows.push({
            l: point(d, m.edge, m.offset, w / 2),
            r: point(d, m.edge, m.offset, -w / 2),
            v: d / LINE_TILE,
          });
        }
        quad(out.lines, rows);
      }
    } else {
      const rows = [0, 1].map((k) => {
        const d = m.at + (k - 0.5) * ARROW.length;
        return {
          l: point(d, m.edge, m.offset, ARROW.width / 2),
          r: point(d, m.edge, m.offset, -ARROW.width / 2),
          v: k,
        };
      });
      quad(m.arrow === 'left' ? out.left : out.straight, rows);
    }
  }
  return out;
}

function paintMesh(
  paint: Paint,
  texture: 'road_paint' | 'road_arrow_left' | 'road_arrow_straight',
): Mesh | undefined {
  if (!paint.idx.length) return undefined;
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(paint.pos), 3),
  );
  g.setAttribute('uv', new BufferAttribute(new Float32Array(paint.uv), 2));
  const n = new Float32Array(paint.pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new BufferAttribute(n, 3));
  g.setIndex(paint.idx);
  g.computeBoundingSphere();
  const m = new Mesh(
    g,
    new MeshStandardMaterial({
      map: getTexture(texture),
      // Blended, not cut out: the worn paint stays a soft line from afar (a cut-out one fades away with the mip levels).
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      roughness: 0.8,
      side: DoubleSide,
      // One pass: a transparent DoubleSide material is otherwise drawn back then front, and three flips its side
      // with needsUpdate each time (two program look-ups a frame per material).
      forceSinglePass: true,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -10,
    }),
  );
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** The road's paint (RoadDef.markings) as meshes: one for the lines, one per arrow kind. */
export function roadMarkingsMesh(world: World): Group | undefined {
  const markings = world.map.road.markings;
  if (!markings?.length) return undefined;
  const paint = roadPaint(world.road, markings, (x, z) =>
    world.analytic.height(x, z),
  );
  const group = new Group();
  group.name = 'road-markings';
  for (const m of [
    paintMesh(paint.lines, 'road_paint'),
    paintMesh(paint.left, 'road_arrow_left'),
    paintMesh(paint.straight, 'road_arrow_straight'),
  ])
    if (m) group.add(m);
  return group.children.length ? group : undefined;
}
