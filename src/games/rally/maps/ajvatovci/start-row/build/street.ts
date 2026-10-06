import { ROAD, roadLine, SIDEWALK_BACK, SOUTH_FENCE } from '../frame';
import { fenceRuns, gates, kerbRuns, poleSpots } from '../streetwork';
import { drapedFrame, type Build } from './ctx';
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
/** Driveway aprons are nearly flush with the road. */
export const APRON = 0.06;

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
    f.sweep(
      'concrete',
      line,
      [
        [half, 0.0],
        [half, KERB],
        [half + curb, KERB],
        [half + curb, SIDEWALK],
      ],
      '#d9d6cf',
      { lift: road },
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
      { lift: road },
    );
  }
  for (const [x0, x1] of g.north) {
    const line = roadLine(0, x0, x1);
    if (line.length < 2) continue;
    frameAt((x0 + x1) / 2).sweep(
      'concrete',
      line,
      [
        [half, 0.05],
        [SIDEWALK_BACK + 0.4, APRON + 0.01],
      ],
      '#c4c1ba',
      { lift: road },
    );
  }
  // South: kerb, concrete aprons at the gates.
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
      { lift: road },
    );
  }
  for (const [x0, x1] of g.south) {
    const line = roadLine(0, x0, x1);
    if (line.length < 2) continue;
    frameAt((x0 + x1) / 2).sweep(
      'concrete',
      line,
      [
        [-half, 0.05],
        [SOUTH_FENCE - 0.6, APRON],
      ],
      '#c4c1ba',
      { lift: road },
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
