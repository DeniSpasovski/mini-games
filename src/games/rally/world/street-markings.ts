import type { PathDef } from '../maps/shared/types';

/**
 * Paint of the streets that carry the street model (`PathDef.layout`, scripts/realmap/streets.py): which lines run where
 * across a street, from its width, lane layout and class. Pure (no scene): `road-mesh.ts` sweeps the lines along the
 * ribbon, the world tests run the layout.
 *
 * Lateral positions are metres from the street's centre line, + = LEFT of travel (the mesh convention (tz, -tx)).
 * Traffic drives on the right: the `fwd` lanes lie on the right half of a two-way street, the `back` lanes on the left.
 */

/** `wear` is not paint: a faint dark wheel path along a travel lane. */
export type MarkColor = 'white' | 'yellow' | 'wear';

export interface MarkLine {
  lat: number;
  /** Line width (m). */
  w: number;
  color: MarkColor;
  /** Dashed: paint `on` m, gap `off` m (NYC 10 ft / 30 ft). Absent = solid. */
  dash?: [number, number];
}

/** Parking lane, bike lane, minimum travel lane (m): the same numbers `streets.py` fits the layout with. */
export const PARK_W = 2.2;
export const BIKE_W = 1.5;
const DASH: [number, number] = [3, 9];
const LINE_W = 0.1;
const EDGE_W = 0.15;
/** A ramp edge line sits this far inside the edge (m). */
const EDGE_IN = 0.45;
/**
 * A mainline carriageway's edge lines sit this far inside its edges, like the stage road's (`road_parkway` texture: 4.5 % of
 * 7.4 m); its lanes are at least LANE_MIN wide, a shoulder only where the width leaves room beyond them.
 */
const MAIN_EDGE_IN = 0.33;
const LANE_MIN = 3.3;
/** Paint stops this far short of the end of a street that meets another (m). */
export const END_GAP = 4;

const BIG = /^(motorway|trunk)/;

/** The street carries the model, so the marking layer paints it (older streets keep their painted texture tiles). */
export const hasMarkings = (p: PathDef, deck = false): boolean =>
  !!p.layout && p.surface === 'tarmac' && (deck || !p.bridge) && p.width >= 3;

/**
 * An end of `p` that continues into exactly one other way in a straight line (an OSM joint): the paint runs on across it.
 * `paths` = every way of the map.
 */
export function straightJoint(
  paths: readonly PathDef[],
  p: PathDef,
  atEnd: boolean,
): boolean {
  const n = p.pts.length;
  const ex = atEnd ? p.pts[n - 2] : p.pts[0];
  const ez = atEnd ? p.pts[n - 1] : p.pts[1];
  const dx = ex - (atEnd ? p.pts[n - 4] : p.pts[2]);
  const dz = ez - (atEnd ? p.pts[n - 3] : p.pts[3]);
  const dl = Math.hypot(dx, dz) || 1;
  let count = 0;
  let straight = false;
  for (const q of paths) {
    if (q === p || q.surface !== 'tarmac') continue;
    const m = q.pts.length;
    for (const qEnd of [false, true]) {
      const qx = qEnd ? q.pts[m - 2] : q.pts[0];
      const qz = qEnd ? q.pts[m - 1] : q.pts[1];
      if (Math.hypot(qx - ex, qz - ez) > 2.5) continue;
      count++;
      const ox = (qEnd ? q.pts[m - 4] : q.pts[2]) - qx;
      const oz = (qEnd ? q.pts[m - 3] : q.pts[3]) - qz;
      const ol = Math.hypot(ox, oz) || 1;
      // leaving the shared end in the direction the street arrives from = a straight continuation
      if ((ox * dx + oz * dz) / (ol * dl) > 0.85) straight = true;
    }
  }
  return count === 1 && straight;
}

/** Roadway texture of a street with markings: highway asphalt for carriageways / ramps, street asphalt for the rest. */
export const baseTexture = (
  p: PathDef,
): 'asphalt_highway' | 'asphalt_street' =>
  BIG.test(p.kind) || p.kind.endsWith('_link')
    ? 'asphalt_highway'
    : 'asphalt_street';

/** The two wheel paths of a travel lane centred at `c`: 0.5 m strips 0.75 m either side. */
function wheelPaths(out: MarkLine[], c: number): void {
  out.push({ lat: c - 0.75, w: 0.5, color: 'wear' });
  out.push({ lat: c + 0.75, w: 0.5, color: 'wear' });
}

/** The lines of a street of width `width` (the tapered half width times two may differ from `p.width`). */
export function markingLines(p: PathDef, width = p.width): MarkLine[] {
  const l = p.layout;
  if (!l) return [];
  const out: MarkLine[] = [];
  const hw = width / 2;
  const carriageway = BIG.test(p.kind) || p.kind.endsWith('_link');
  if (carriageway) {
    // One-way roadway: yellow left edge, white right edge, dashed white lane lines between the lanes.
    const lanes = Math.max(1, l.fwd);
    const main = BIG.test(p.kind);
    // (the street model's shoulder was fitted to the baked width; the game may narrow a mainline carriageway to the
    // stage road's, matchCarriagewayWidth)
    const shoulder = main
      ? Math.min(
          l.shoulder,
          Math.max(0, (width - 2 * MAIN_EDGE_IN - lanes * LANE_MIN) / 2),
        )
      : l.shoulder;
    const edgeIn = main ? MAIN_EDGE_IN : EDGE_IN;
    const a = -hw + shoulder + edgeIn;
    const b = hw - shoulder - edgeIn;
    out.push({ lat: a, w: EDGE_W, color: 'white' });
    out.push({ lat: b, w: EDGE_W, color: 'yellow' });
    for (let k = 1; k < lanes; k++)
      out.push({
        lat: a + ((b - a) * k) / lanes,
        w: main ? EDGE_W : LINE_W,
        color: 'white',
        dash: DASH,
      });
    for (let k = 0; k < lanes; k++)
      wheelPaths(out, a + ((b - a) * (k + 0.5)) / lanes);
    return out;
  }
  // City street: parking (and bike) lanes at the kerbs, the travel lanes between them.
  const bikeL = l.bikeL * BIKE_W;
  const bikeR = l.bikeR * BIKE_W;
  const left = hw - l.parkL * PARK_W;
  const right = -hw + l.parkR * PARK_W;
  if (l.bikeL) out.push({ lat: left - BIKE_W, w: EDGE_W, color: 'white' });
  if (l.bikeR) out.push({ lat: right + BIKE_W, w: EDGE_W, color: 'white' });
  const b0 = right + bikeR;
  const b1 = left - bikeL;
  const n = l.fwd + l.back;
  if (n < 1 || b1 - b0 < 2) return out;
  const laneW = (b1 - b0) / n;
  // the line between the two directions (fwd lanes on the right)
  const centre = b0 + l.fwd * laneW;
  if (l.back > 0 && p.marks?.centre === 'double_yellow') {
    out.push({ lat: centre - 0.1, w: LINE_W, color: 'yellow' });
    out.push({ lat: centre + 0.1, w: LINE_W, color: 'yellow' });
  } else if (l.back > 0 && l.fwd + l.back >= 2 && width >= 8.5) {
    // a wide two-way street without a painted centre line still gets a dashed one (lanes that share a road need it)
    out.push({ lat: centre, w: LINE_W, color: 'yellow', dash: DASH });
  }
  for (let k = 0; k < n; k++) wheelPaths(out, b0 + laneW * (k + 0.5));
  // dashed white lines between lanes of the same direction
  for (let k = 1; k < l.fwd; k++)
    out.push({ lat: b0 + laneW * k, w: LINE_W, color: 'white', dash: DASH });
  for (let k = 1; k < l.back; k++)
    out.push({
      lat: centre + laneW * k,
      w: LINE_W,
      color: 'white',
      dash: DASH,
    });
  return out;
}

/** Whether paint stops short at a path end: the end meets another street (not a straight OSM joint). */
export function trimsEnd(joint: boolean): number {
  return joint ? 0 : END_GAP;
}

/**
 * Dash intervals `[from, to]` (metres along) of a dashed line over [a0, a1]: `on` m painted, `off` m gap, in phase with the
 * distance along the street so the dashes of neighbouring ways line up.
 */
export function dashIntervals(
  a0: number,
  a1: number,
  dash: [number, number],
): [number, number][] {
  const period = dash[0] + dash[1];
  const out: [number, number][] = [];
  let k = Math.floor(a0 / period);
  for (; k * period < a1; k++) {
    const s = Math.max(a0, k * period);
    const e = Math.min(a1, k * period + dash[0]);
    if (e - s > 0.2) out.push([s, e]);
  }
  return out;
}
