import type { District } from '../../items/catalog-construction';
import type { RoadNet } from '../types';

/**
 * Construction City floor plan (CONSTRUCTION-CITY.md section 3): a fenced 540 x 420 m site, a grid of
 * 12 m gravel haul roads, 6 x 5 plots grouped into 9 districts, and the open-pit mine (no roads) in the
 * north-east. Pure data; +X east, +Z south, the gate is in the south fence at x = 0.
 */
export const SITE = { hx: 270, hz: 210 };
export const ROAD_W = 12;
export const ROADS_X = [-180, -90, 0, 90, 180];
export const ROADS_Z = [-126, -42, 42, 126];
/** Right-hand lane offset of the driving trucks (m). */
export const LANE = 2.6;
/** The mine: one open area with no roads, north-east of the x = 0 road and north of z = -42. */
export const MINE = { x0: 6, z0: -210, x1: 270, z1: -48 };
/** Road ends this far inside the fence are dead ends where trucks turn round. */
const END = 8;

export const DISTRICT_NAMES: Record<District, string> = {
  gate: 'Site Gate',
  brickyard: 'Brickyard',
  roadworks: 'Road Works',
  housing: 'Housing Estate',
  yard: 'Material Yard',
  foundations: 'Foundations',
  depot: 'Plant Depot',
  towers: 'High-Rise Row',
  mine: 'Open-Pit Mine',
};

/** Plot districts by row (r0 = north) and column (c0 = west). */
const GRID: District[][] = [
  ['towers', 'towers', 'towers', 'mine', 'mine', 'mine'],
  ['towers', 'towers', 'towers', 'mine', 'mine', 'mine'],
  ['foundations', 'foundations', 'foundations', 'depot', 'depot', 'depot'],
  ['brickyard', 'housing', 'housing', 'yard', 'yard', 'roadworks'],
  ['brickyard', 'brickyard', 'gate', 'gate', 'roadworks', 'roadworks'],
];

export interface Plot {
  r: number;
  c: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  district: District;
}

/** Edges of the strips between the roads (and the fence). */
function strips(lines: number[], half: number): [number, number][] {
  const out: [number, number][] = [];
  let a = -half;
  for (const l of lines) {
    out.push([a, l - ROAD_W / 2]);
    a = l + ROAD_W / 2;
  }
  out.push([a, half]);
  return out;
}

export const COLS = strips(ROADS_X, SITE.hx);
export const ROWS = strips(ROADS_Z, SITE.hz);

/** Every plot outside the mine, plus the mine as one big plot (r 0, c 3). */
export function plots(): Plot[] {
  const out: Plot[] = [];
  ROWS.forEach(([z0, z1], r) =>
    COLS.forEach(([x0, x1], c) => {
      const district = GRID[r][c];
      if (district === 'mine') return;
      out.push({ r, c, x0, z0, x1, z1, district });
    }),
  );
  out.push({ r: 0, c: 3, ...MINE, district: 'mine' });
  return out;
}

/** A road strip: x road (along z) or z road (along x), from `a` to `b` along it. */
export interface RoadStrip {
  axis: 'x' | 'z';
  at: number;
  a: number;
  b: number;
}

/** The gravel roads. North-south roads east of x = 0 stop at the mine; the z = -126 road stops at x = 0. */
export function roadStrips(): RoadStrip[] {
  const out: RoadStrip[] = [];
  for (const x of ROADS_X)
    out.push({
      axis: 'x',
      at: x,
      a: x > 0 ? MINE.z1 : -SITE.hz,
      b: SITE.hz,
    });
  for (const z of ROADS_Z)
    out.push({
      axis: 'z',
      at: z,
      a: -SITE.hx,
      b: z < MINE.z1 ? ROAD_W / 2 : SITE.hx,
    });
  return out;
}

/** True when a circle of radius `r` at (x, z) touches a road. */
export function onRoad(x: number, z: number, r: number): boolean {
  const h = ROAD_W / 2 + r;
  for (const s of ROADS) {
    const across = s.axis === 'x' ? x : z;
    const along = s.axis === 'x' ? z : x;
    if (Math.abs(across - s.at) < h && along > s.a - r && along < s.b + r)
      return true;
  }
  return false;
}
const ROADS = roadStrips();

/**
 * Road graph of the trucks: every crossing and T-junction, plus a dead end near the fence at each road end
 * (the trucks turn round there). Arms are straight and axis-aligned.
 */
export function roadNet(): RoadNet {
  const nodes: [number, number][] = [];
  const edges: [number, number][] = [];
  const index = new Map<string, number>();
  const node = (x: number, z: number) => {
    const k = `${x},${z}`;
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push([x, z]);
      index.set(k, i);
    }
    return i;
  };
  const inside = (s: RoadStrip, v: number) => v >= s.a - 0.1 && v <= s.b + 0.1;
  for (const s of ROADS) {
    const cross = ROADS.filter((o) => o.axis !== s.axis && inside(o, s.at));
    const stops = cross.map((o) => o.at).filter((v) => inside(s, v));
    const lo = s.a <= -(s.axis === 'x' ? SITE.hz : SITE.hx) + 0.1;
    const hi = s.b >= (s.axis === 'x' ? SITE.hz : SITE.hx) - 0.1;
    if (lo) stops.push(s.a + END);
    if (hi) stops.push(s.b - END);
    stops.sort((a, b) => a - b);
    const ids = stops.map((v) =>
      s.axis === 'x' ? node(s.at, v) : node(v, s.at),
    );
    for (let i = 1; i < ids.length; i++) edges.push([ids[i - 1], ids[i]]);
  }
  return { nodes, edges };
}
