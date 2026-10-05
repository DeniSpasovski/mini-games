import { Vector2 } from 'three';
import {
  NORTH_FENCE,
  ROAD,
  roadLine,
  SIDEWALK_BACK,
  SOUTH_FENCE,
  STREET_X,
} from './frame';
import { getLayout, getYards, type Plot } from './layout';

/**
 * The street's fixed furniture as pure data, shared by the geometry (`build/street.ts`) and the physics
 * (`index.ts`: fence colliders, the kerb you feel in the suspension, pole colliders): driveway gaps,
 * every fence run, the Mileks front wall, the power poles. Site metres.
 */

/** x ranges (site metres), sorted. */
export type Gaps = [number, number][];

/** The street dressing starts here (west of it the road is bare: the start area). */
export const CURBS_FROM = -300;

/** The x ranges between (and outside) the sorted `gaps`, from `from` to `to`. */
export const between = (gaps: Gaps, from: number, to: number): Gaps => {
  const runs: Gaps = [];
  let at = from;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > at) runs.push([at, Math.min(g0, to)]);
    at = Math.max(at, g1);
  }
  if (at < to) runs.push([at, to]);
  return runs.filter(([a, b]) => b > a);
};

/** Driveway gaps in the north / south kerb (one per lot gate). */
export const gates = () => {
  const layout = getLayout();
  return { north: layout.northGates, south: layout.southGates };
};

/** The kerb / sidewalk runs: the street outside the gates. */
export const kerbRuns = () => {
  const g = gates();
  return {
    north: between(g.north, CURBS_FROM, STREET_X[1]),
    south: between(g.south, CURBS_FROM, STREET_X[1]),
  };
};

/** A fence run: points along the fence line, west to east (or as the yard outline runs). */
export interface FenceRun {
  line: Vector2[];
  /** 'street': the wire fence along the sidewalk; 'lot': between lots / round a yard; 'wall': a low garden wall. */
  kind: 'street' | 'lot' | 'wall';
  /** Heavier gate posts at the ends (a gate stands there). */
  gatePosts?: boolean;
}

/** The Mileks lot: its front is a low garden wall with a wire fence on top, not the street fence. */
const mileks = (): Plot | undefined =>
  getYards().find((y) => y.plot.style === 'mileks')?.plot;

let cache: FenceRun[] | undefined;

/** Every fence of the row. */
export const fenceRuns = (): FenceRun[] => {
  if (cache) return cache;
  const runs: FenceRun[] = [];
  const yards = getYards();

  // The street fence along each lot's frontage (north on the sidewalk's back edge, south on the verge),
  // with the gate gap; the Mileks lot has the garden wall instead.
  for (const { plot } of yards) {
    if (plot.style === 'mileks' || plot.open || !plot.yard.street) continue;
    const north = plot.side === 'north';
    const gate = [
      plot.gate - (plot.gateWidth ?? 9) / 2,
      plot.gate + (plot.gateWidth ?? 9) / 2,
    ];
    for (const [x0, x1] of between(
      [[gate[0], gate[1]]],
      plot.yard.street[0],
      plot.yard.street[1],
    )) {
      const line = roadLine(north ? NORTH_FENCE : SOUTH_FENCE, x0, x1);
      if (line.length > 1) runs.push({ line, kind: 'street', gatePosts: true });
    }
  }

  // Lot fences: every yard's perimeter minus what a neighbour already fences.
  for (const y of yards)
    for (const line of y.fence) runs.push({ line, kind: 'lot' });

  // The Mileks garden: a low wall with a wire fence on top along the sidewalk, a gap for the gate.
  const o = mileks();
  if (o) {
    const gate = [
      o.gate - (o.gateWidth ?? 9) / 2,
      o.gate + (o.gateWidth ?? 9) / 2,
    ];
    for (const [x0, x1] of between(
      [[gate[0], gate[1]]],
      o.yard.street![0],
      o.yard.street![1],
    )) {
      const line = roadLine(SIDEWALK_BACK, x0, x1);
      if (line.length > 1) runs.push({ line, kind: 'wall' });
    }
  }
  return (cache = runs);
};

/** Power poles on the south verge, every 42 m, every other one carrying a street lamp. */
export const poleSpots = (): { p: Vector2; dir: Vector2; lamp: boolean }[] => {
  const line = roadLine(-ROAD.half - ROAD.curb - 1.6, -290, 212);
  const out: { p: Vector2; dir: Vector2; lamp: boolean }[] = [];
  let next = 10;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = a.distanceTo(b);
    while (next <= walked + length) {
      out.push({
        p: a.clone().lerp(b, (next - walked) / length),
        dir: b.clone().sub(a).normalize(),
        lamp: out.length % 2 === 0,
      });
      next += 42;
    }
    walked += length;
  }
  return out;
};

/** A run with the points that lie within `tolerance` of the chord of their neighbours dropped (straight runs collapse to two points). */
export const straighten = (run: Vector2[], tolerance = 0.12): Vector2[] => {
  if (run.length < 3) return run;
  const a = run[0];
  const b = run[run.length - 1];
  const ab = b.clone().sub(a);
  let worst = -1;
  let at = 0;
  for (let i = 1; i < run.length - 1; i++) {
    const t = Math.max(
      0,
      Math.min(1, run[i].clone().sub(a).dot(ab) / (ab.lengthSq() || 1)),
    );
    const d = run[i].distanceTo(a.clone().addScaledVector(ab, t));
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [
    ...straighten(run.slice(0, at + 1), tolerance),
    ...straighten(run.slice(at), tolerance).slice(1),
  ];
};
