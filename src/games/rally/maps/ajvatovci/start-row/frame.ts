import { CatmullRomCurve3, Vector2, Vector3 } from 'three';
import data from '../data.json';

/**
 * Coordinate frame of the start row. The lots are laid out in "site" metres around the Mileks
 * warehouse (x east, z south, y up) and moved into the rally world by a plain translation:
 * every point of the site's street centre line lies within 1 m of the baked stage road.
 */
export type Corner = [number, number];

/** World position of the site origin: the Mileks warehouse, 42.000553 N 21.581597 E. */
export const ORIGIN = { x: -1193.226, z: 382.87 };

export const toWorld = ([x, z]: Corner): Corner => [x + ORIGIN.x, z + ORIGIN.z];
export const toSite = (x: number, z: number): Corner => [
  x - ORIGIN.x,
  z - ORIGIN.z,
];

/**
 * The OSM footprints and the motorway line (south side, hand-modelled lots) sit this far
 * (m, along z) from where the satellite image puts them relative to the baked road: the road is drawn
 * ~3.5 m north of the asphalt in the image, the buildings were traced to the image (see trace.ts).
 */
export const OSM_DZ = -2.5;

/** Site x range the street dressing covers (the stage road turns north just east of it). */
export const STREET_X: [number, number] = [-318, 222];

/**
 * The street's centre line in site metres, west to east: the baked stage road (the same
 * centripetal Catmull-Rom the game builds), so kerbs, fences and lots follow the drawn road.
 */
const centre: Vector2[] = (() => {
  const control = (data.route as number[][])
    .filter(([x]) => x < ORIGIN.x + 330)
    .map(([x, z]) => new Vector3(x - ORIGIN.x, 0, z - ORIGIN.z));
  const curve = new CatmullRomCurve3(control, false, 'centripetal');
  curve.arcLengthDivisions = control.length * 40;
  const points = curve
    .getSpacedPoints(Math.ceil(curve.getLength() / 2))
    .map((p) => new Vector2(p.x, p.z));
  const out: Vector2[] = [];
  for (const p of points) {
    if (p.x < STREET_X[0]) continue;
    if (out.length && p.x <= out[out.length - 1].x) break;
    out.push(p);
    if (p.x > STREET_X[1]) break;
  }
  return out;
})();

/** Cross-section, metres from the centre line (north / the row's side positive). */
export const ROAD = {
  /** Asphalt edge. */
  half: 3.6,
  curb: 0.18,
  sidewalk: 2,
  /** Grass verge, south side. */
  verge: 4,
};
/** Back edge of the north sidewalk, where property lines start. */
export const SIDEWALK_BACK = ROAD.half + ROAD.curb + ROAD.sidewalk;
/** Wire fence along the back of the north sidewalk / the south verge (offsets from the centre line). */
export const NORTH_FENCE = SIDEWALK_BACK + 0.15;
export const SOUTH_FENCE = -ROAD.half - ROAD.curb - ROAD.verge + 0.4;

const leftOf = (i: number): Vector2 => {
  const a = centre[Math.max(0, i - 1)];
  const b = centre[Math.min(centre.length - 1, i + 1)];
  const d = b.clone().sub(a).normalize();
  return new Vector2(d.y, -d.x); // left of eastbound = north
};

/** The line `offset` metres left (north) of the centre, clipped to x0..x1 (ends interpolated). */
export const roadLine = (offset: number, x0 = -Infinity, x1 = Infinity) => {
  const line = centre.map((p, i) =>
    p.clone().addScaledVector(leftOf(i), offset),
  );
  const clipped: Vector2[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const q = line[i + 1];
    if (p.x >= x0 && p.x <= x1) clipped.push(p);
    if (!q) break;
    for (const x of [x0, x1])
      if ((p.x - x) * (q.x - x) < 0)
        clipped.push(p.clone().lerp(q, (x - p.x) / (q.x - p.x)));
  }
  return clipped.sort((a, b) => a.x - b.x);
};

/** z of the line `offset` metres north of the centre, at x (extended past the ends). */
export const roadZ = (x: number, offset: number) => {
  const line = roadLine(offset);
  let i = line.findIndex((p) => p.x >= x);
  if (i === -1) i = line.length - 1;
  if (i === 0) i = 1;
  const a = line[i - 1];
  const b = line[i];
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
};

/** Centre line of the A2 motorway south of the row (site metres), for the south lots' back fences. */
const MOTORWAY: Corner[] = [
  [-563.2, 80.3],
  [-380.2, 97.9],
  [-311.5, 107.1],
  [-242.9, 118.8],
  [-174.2, 130.9],
  [-105.6, 143],
  [-37, 155.1],
  [31.7, 167.4],
  [100.3, 180.4],
  [169, 195.6],
  [237.6, 213.8],
  [306.2, 235],
];
const motorway = new CatmullRomCurve3(
  MOTORWAY.map(([x, z]) => new Vector3(x, 0, z + OSM_DZ)),
  false,
  'centripetal',
)
  .getSpacedPoints(240)
  .map((p) => new Vector2(p.x, p.z));

const motorwayZ = (x: number) => {
  const i = Math.max(
    1,
    motorway.findIndex((q) => q.x >= x),
  );
  const a = motorway[i - 1];
  const b = motorway[i];
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
};

/** Half width of the motorway's carriageways + stopping lanes, metres from its centre line. */
export const MOTORWAY_HALF = 11.7;
/** How far the south lots' back fences stand from the motorway's edge, metres. */
export const HIGHWAY_GAP = 10;

/**
 * z, at x, of the line `offset` metres north of the motorway's centre line, measured across it
 * (the line is the centre line moved along its normals, so at a given x it lies a little off the
 * plain vertical offset).
 */
export const motorwayOffsetZ = (x: number, offset: number) => {
  const slopeAt = (at: number) => motorwayZ(at + 0.5) - motorwayZ(at - 0.5);
  let at = x;
  for (let n = 0; n < 4; n++)
    at += x - (at + (offset * slopeAt(at)) / Math.hypot(1, slopeAt(at)));
  return motorwayZ(at) - offset / Math.hypot(1, slopeAt(at));
};

/** z of the line the south lots' back fences run along (parallel to the motorway) at x. */
export const backFenceZ = (x: number) =>
  motorwayOffsetZ(x, MOTORWAY_HALF + HIGHWAY_GAP);
