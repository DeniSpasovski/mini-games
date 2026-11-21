import { ROAD, roadLine, SIDEWALK_BACK } from '../frame';
import {
  apronLine,
  type ApronLine,
  fenceRuns,
  gates,
  kerbRuns,
  poleSpots,
} from '../streetwork';
import { yardTop } from '../yard-surfaces';
import { drapedFrame, type Build } from './ctx';
import type { Frame } from './kit';
import { meshFence, powerPole, powerWires } from './props';

/**
 * The street at ground level: kerbs, a paver sidewalk on the row's (north) side with concrete
 * aprons at every driveway, the wire fences (street, lots, the Mileks garden wall), the power poles
 * with their wires along the south verge. The asphalt is the game's road. Everything follows the
 * road's own height (the sidewalk stays level across the ditch), the same surface the car feels:
 * `index.ts` raises the physical ground to the kerb and sidewalk (`groundOverride`).
 * Layout data (gaps, fence runs, poles): `streetwork.ts`.
 */

/** Kerb top above the road centre (m); the sidewalk behind it is 2 cm lower. */
export const KERB = 0.17;
export const SIDEWALK = 0.15;

export function buildStreet(b: Build): void {
  const { half, curb } = ROAD;
  const centre = roadLine(0);
  // The road's own height along the street: sidewalk and kerb ride on it, not on the ditch beside it.
  const heights = centre.map((p) => b.ground(p.x, p.y));
  const centreY = (x: number): number => {
    const i = centre.findIndex((p) => p.x >= x);
    if (i === -1) return heights[heights.length - 1];
    if (i === 0) return heights[0];
    const t = (x - centre[i - 1].x) / (centre[i].x - centre[i - 1].x);
    return heights[i - 1] + (heights[i] - heights[i - 1]) * t;
  };
  const road = (x: number): number => centreY(x);
  const ground = (x: number, z: number): number => b.ground(x, z);
  const frameAt = (x: number) => drapedFrame(b, x, 0);

  const g = gates();
  const runs = kerbRuns();

  // North: kerb and sidewalk, broken at every driveway, which gets a concrete apron instead.
  for (const [x0, x1] of runs.north) {
    const line = roadLine(0, x0, x1);
    if (line.length < 2) continue;
    const f = frameAt((x0 + x1) / 2);
    // Swept westbound, so the kerb face (walls face the left of the sweep) looks at the road, not into the sidewalk.
    f.sweep(
      'concrete',
      [...line].reverse(),
      [
        [-half, 0.0],
        [-half, KERB],
        [-half - curb, KERB],
        [-half - curb, SIDEWALK],
      ],
      '#d9d6cf',
      { lift: road, caps: 0.15, endX: true },
    );
    f.sweep(
      'pavers',
      line,
      [
        [half + curb, SIDEWALK],
        [SIDEWALK_BACK, SIDEWALK],
        [SIDEWALK_BACK, 0.02],
      ],
      '#d2cfc8',
      { lift: road, caps: 0.15, endX: true },
    );
  }
  // The driveway aprons: ramps from the road up to each gate's yard.
  const across = apronLine(ground, yardTop(ground));
  for (const [x0, x1] of g.north) apron(b, across, x0, x1, 'north');
  for (const [x0, x1] of g.south) apron(b, across, x0, x1, 'south');
  // South: kerb.
  for (const [x0, x1] of runs.south) {
    const line = roadLine(0, x0, x1);
    if (line.length < 2) continue;
    frameAt((x0 + x1) / 2).sweep(
      'concrete',
      line,
      [
        [-half, 0.0],
        [-half, KERB],
        [-half - curb, KERB],
        [-half - curb, 0.1],
      ],
      '#d9d6cf',
      { lift: road, caps: 0.15, endX: true },
    );
  }

  // Fences: street, lot and garden-wall runs (posts every 2.5 m, heavier posts either side of each gate).
  for (const run of fenceRuns()) {
    // The tile the run starts in (not the street's at that x): a lot fence can lie 100 m behind the street.
    const f = drapedFrame(b, run.line[0].x, run.line[0].y);
    if (run.kind === 'wall') {
      // The Mileks garden: a low wall with the wire fence on top.
      f.sweep(
        'concrete',
        run.line,
        [
          [0, 0.02],
          [0, 0.5],
          [0.25, 0.5],
          [0.25, 0.02],
        ],
        '#d9d6cf',
        { lift: ground },
      );
      meshFence(f, run.line, {
        bottom: 0.5,
        top: 1.7,
        post: '#3d4247',
        square: true,
        lift: ground,
      });
      continue;
    }
    meshFence(f, run.line, {
      gatePost: run.gatePosts,
      post: run.kind === 'lot' ? '#bdb9b0' : undefined,
      lift: ground,
    });
  }

  // Power poles on the south verge, three wires between them; every other one carries a street lamp.
  const poles = poleSpots().map((pole) => ({
    ...pole,
    y: ground(pole.p.x, pole.p.y),
  }));
  for (const { p, dir, lamp } of poles)
    powerPole(frameAt(p.x), p, dir, lamp, ground);
  for (let i = 1; i < poles.length; i++)
    powerWires(frameAt(poles[i].p.x), poles[i - 1], poles[i]);
}

/** How far the apron's sides reach under its lower end (m). */
const APRON_TOE = 0.15;

type V3 = [number, number, number];

/** A face of `pts` (a convex polygon) turned to face `out` (x, y, z). */
function face(f: Frame, pts: V3[], out: V3, uv: [number, number][]): void {
  const [a, b, c] = pts;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
  const p = flip ? [...pts].reverse() : pts;
  const t = flip ? [...uv].reverse() : uv;
  f.quad('concrete', p[0], p[1], p[2], p[3], '#c4c1ba', t);
}

/**
 * One driveway apron, x0..x1 (cut along x like the gate in the fence and the drive behind it): a ramp from the
 * road's edge to the yard's front (streetwork.ts `apronLine`), with solid sides where the sidewalk or kerb stops.
 */
function apron(
  b: Build,
  across: (x: number, side: 'north' | 'south') => ApronLine,
  x0: number,
  x1: number,
  side: 'north' | 'south',
): void {
  const f = drapedFrame(b, (x0 + x1) / 2, 0);
  const n = Math.max(1, Math.ceil(x1 - x0));
  const lines = Array.from({ length: n + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / n;
    return { x, ...across(x, side) };
  });
  for (let i = 0; i < n; i++) {
    const p = lines[i];
    const q = lines[i + 1];
    face(
      f,
      [
        [p.x, p.yf, p.zf],
        [q.x, q.yf, q.zf],
        [q.x, q.yb, q.zb],
        [p.x, p.yb, p.zb],
      ],
      [0, 1, 0],
      [
        [p.x, p.zf],
        [q.x, q.zf],
        [q.x, q.zb],
        [p.x, p.zb],
      ],
    );
  }
  for (const [l, dir] of [
    [lines[0], -1],
    [lines[n], 1],
  ] as const) {
    const low = Math.min(l.yf, l.yb) - APRON_TOE;
    face(
      f,
      [
        [l.x, l.yf, l.zf],
        [l.x, l.yb, l.zb],
        [l.x, low, l.zb],
        [l.x, low, l.zf],
      ],
      [dir, 0, 0],
      [
        [l.zf, l.yf],
        [l.zb, l.yb],
        [l.zb, low],
        [l.zf, low],
      ],
    );
  }
}
