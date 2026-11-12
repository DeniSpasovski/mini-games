import { Matrix4, Vector2 } from 'three';
import { ORIGIN, type Corner } from '../frame';
import { inside } from '../layout';
import { padPlane } from '../yard-surfaces';
import { Bucket, Frame, tileKey, type Plane } from './kit';

/** Everything the builders share: where geometry goes, the terrain, the placed assets. */
export interface Build {
  bucket: Bucket;
  /** World ground height at a site point. */
  ground: (x: number, z: number) => number;
  /** Paved yard surfaces on their own planes (lifted above the ground): the parked vehicles stand on them. */
  pads: { polygon: Vector2[]; plane: Plane; top: number }[];
}

const _q = new Vector2();
/** Height a vehicle stands on at a site point: the highest yard surface over it, else the ground. */
export function standHeight(b: Build, x: number, z: number): number {
  let y = b.ground(x, z);
  _q.set(x, z);
  for (const { polygon, plane, top } of b.pads)
    if (inside(_q, polygon))
      y = Math.max(
        y,
        plane.a * (x + ORIGIN.x) + plane.b * (z + ORIGIN.z) + plane.c + top,
      );
  return y;
}

/**
 * A frame on a lot's graded pad: geometry is built level (y = 0 is the pad) and sheared onto the
 * plane fitted through the ground under `points` (a pad is planar, so the fit is exact).
 */
export function lotFrame(b: Build, points: Corner[], cover = false): Frame {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
  return new Frame(
    b.bucket,
    tileKey(cx, cz),
    padPlane((x, z) => b.ground(x, z), points, cover),
  );
}

/** A frame without a plane: its pieces carry their own world heights (street, fences, sidewalks). */
export function drapedFrame(b: Build, x: number, z: number): Frame {
  return new Frame(b.bucket, tileKey(x, z));
}

/** Local matrix: rotate `yaw` about y (heading 0 = facing +x, as the layout's vehicles) then move. */
export function placeAt(x: number, y: number, z: number, yaw = 0): Matrix4 {
  return new Matrix4().makeRotationY(yaw).setPosition(x, y, z);
}
