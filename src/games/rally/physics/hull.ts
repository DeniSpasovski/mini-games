import type { CarPhysicsDef } from './types';

/** Collision sphere [x, y, z, r] in the body frame, relative to the centre of mass (+X = left). */
export type HullSphere = [number, number, number, number];

/** The body dimensions a hull is built from. */
export type HullBody = Pick<
  CarPhysicsDef,
  'length' | 'width' | 'height' | 'comHeight' | 'wheelRadius'
>;

/** Default hull: 12 spheres approximating a car-shaped box (underside at 0.85 x wheel radius - higher than most bodies). */
export function autoHull(d: HullBody): HullSphere[] {
  const r = Math.min(0.32, d.width * 0.2);
  const floor = d.wheelRadius * 0.85 - d.comHeight + r;
  const roof = d.height - d.comHeight - r;
  const belt = floor + (roof - floor) * 0.45;
  const x = d.width / 2 - r;
  const zf = d.length / 2 - r;
  const zr = -d.length / 2 + r;
  const out: HullSphere[] = [];
  for (const sx of [-1, 1]) {
    out.push(
      [sx * x, floor, zf, r],
      [sx * x, floor, zr, r],
      [sx * x, belt, 0, r],
      [sx * x * 0.8, roof, zr * 0.35, r],
    );
  }
  // Centre spheres incl. nose / tail so nothing wedges between the corner spheres.
  out.push(
    [0, roof, zf * 0.15, r],
    [0, floor, 0, r],
    [0, floor, zf, r],
    [0, floor, zr, r],
  );
  return out;
}

/**
 * Low sphere row along the real underside: `bottom` = height of the sphere's lowest point above flat ground at the
 * car's standard ride height (read it off the body - `tests/rally/hull-fit.test.ts` prints the profile), `x` = offsets
 * from the centreline (each non-zero one is mirrored).
 */
export interface LowSphere {
  x: number[];
  z: number;
  r: number;
  bottom: number;
}

/**
 * Hull fitted to a real body: `autoHull`'s corner / belt / roof spheres (sides, roof, walls, trees) moved to the body's
 * centre `centreZ` (bodies are rarely centred on the COM), its high centre floor spheres dropped, plus `low` spheres
 * that follow the splitter, sills, floor and rear bumper - so a low car scrapes on crests and landings like its model
 * looks. The hull is body-fixed: a ride-height preset lifts it with the body.
 */
export function bodyHull(
  d: HullBody,
  centreZ: number,
  low: LowSphere[],
): HullSphere[] {
  // autoHull order: per side [floor front, floor rear, belt, roof] x2, then [roof centre, floor centre, nose, tail].
  const out = autoHull(d)
    .slice(0, 9)
    .map(([x, y, z, r]): HullSphere => [x, y, z + centreZ, r]);
  for (const l of low)
    for (const x of l.x)
      for (const sx of x === 0 ? [1] : [1, -1])
        out.push([sx * x, l.bottom + l.r - d.comHeight, l.z, l.r]);
  return out;
}
