import type { BuildingDef } from '../../shared/types';
import { LIFT, type Local, type V3 } from './common';
import type { Site } from './sites';

/**
 * The red tiled roofs of the Turkish residence beside the start of the run-up (OSM way 409230479, baked building 561): a
 * long two-storey wing with hipped roofs over it and over the bays that stand out of either side of it (the aerial
 * reference: terracotta tiles on the cross-shaped wing, a flat roof on the hall to the north-east, which stays the baked
 * building's own). The walls are the baked building's (world/building-mesh.ts); the roofs sit on its wall tops.
 *
 * Local frame: x along the wing (south-east), z across it (south-west), metres from the site; the outline of way
 * 409230479 in this frame runs x -22 to 25, the wing z 1.8 to 12.4 with bays out to z 18.3 and back to z -5.4.
 */
export const RESIDENCE_ID = 561;
export const RESIDENCE: Site = { x: 1655, z: -1135, yaw: 1.018 };

/** Roof pitch (rise per metre across) and the overhang past the walls (m). */
const PITCH = Math.tan((30 * Math.PI) / 180);
const OVER = 0.45;
// (the tile texture is terracotta already: a grey tint only darkens it towards the aged tiles of the aerial)
const TILE = '#a4a2a2';

/** A hipped roof over the rectangle x0..x1, z0..z1 (local, walls) with eaves at `eave`; `ends` false = no hip at that end (it runs into another roof). */
function hipRoof(
  l: Local,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  eave: number,
  ends: [boolean, boolean] = [true, true],
): void {
  const alongX = x1 - x0 >= z1 - z0;
  // Work in (a along the ridge, b across), map back to local x, z.
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const P = (a: number, b: number, y: number): V3 =>
    alongX ? [a, y, b] : [b, y, a];
  const A0 = a0 - OVER;
  const A1 = a1 + OVER;
  const B0 = b0 - OVER;
  const B1 = b1 + OVER;
  const half = (b1 - b0) / 2;
  const ye = eave - OVER * PITCH + LIFT;
  const yr = eave + half * PITCH + LIFT;
  const bm = (b0 + b1) / 2;
  // The ridge stops half the width in from a hipped end (the hips at 45 degrees in plan).
  const r0 = ends[0] ? a0 + half : A0;
  const r1 = ends[1] ? a1 - half : A1;
  const ridge0 = P(Math.min(r0, (a0 + a1) / 2), bm, yr);
  const ridge1 = P(Math.max(r1, (a0 + a1) / 2), bm, yr);
  // The two long planes (the eave first), then the hipped ends.
  l.roof([P(A0, B1, ye), P(A1, B1, ye), ridge1, ridge0], {
    color: TILE,
    trim: [0],
  });
  l.roof([P(A1, B0, ye), P(A0, B0, ye), ridge0, ridge1], {
    color: TILE,
    trim: [0],
  });
  if (ends[0])
    l.roof([P(A0, B0, ye), P(A0, B1, ye), ridge0], { color: TILE, trim: [0] });
  if (ends[1])
    l.roof([P(A1, B1, ye), P(A1, B0, ye), ridge1], { color: TILE, trim: [0] });
}

/** A building's wall top as world/building-mesh.ts draws it: the highest ground under its outline (or its box) + its height. */
export function wallTop(
  b: BuildingDef,
  ground: (x: number, z: number) => number,
): number {
  let hi = ground(b.x, b.z);
  const poly = b.poly ?? [];
  for (let i = 0; i + 1 < poly.length; i += 2)
    hi = Math.max(hi, ground(b.x + poly[i], b.z + poly[i + 1]));
  if (poly.length < 6) {
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      hi = Math.max(
        hi,
        ground(
          b.x + (u * b.w * c) / 2 - (v * b.d * s) / 2,
          b.z + (u * b.w * s) / 2 + (v * b.d * c) / 2,
        ),
      );
  }
  return hi + b.h;
}

export function buildResidenceRoof(l: Local, eaveY: number): void {
  const e = eaveY - l.baseY;
  // The wing, hipped at both ends.
  hipRoof(l, -22.1, 25.3, 1.8, 12.4, e);
  // Bays on the south-west side (their roofs run back into the wing's), the one on the north-east side.
  hipRoof(l, -19.8, -8, 7.1, 15.2, e, [true, true]);
  hipRoof(l, -4.7, 4.6, 7.1, 18.3, e, [false, true]);
  hipRoof(l, 12.4, 23.5, 7.1, 17.4, e, [true, true]);
  hipRoof(l, 12.6, 23.4, -5.4, 7.1, e, [true, false]);
}
