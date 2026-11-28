import type { Road } from './road';

/** Road points per bounding circle of the lookup. */
const RUN = 16;

/**
 * Distance from a point to the stage road for ANY range (the Road grid only knows its ~40 m influence): the nearest of
 * a coarse polyline of the road (every `step` m, its first `to` m), fine for "within 130 m of the stage" tests. Runs of RUN points carry a
 * bounding circle, so most are skipped (a hot path of a city map's load); same result as a plain scan.
 */
export function nearestRoadPoint(
  road: Road,
  step = 12,
  to = road.length,
): (x: number, z: number) => { d: number; x: number; z: number } {
  const pts: { x: number; z: number }[] = [];
  for (let d = 0; d <= to; d += step) pts.push(road.at(d));
  const runs: { x: number; z: number; r: number; k0: number; k1: number }[] =
    [];
  for (let k0 = 0; k0 < pts.length; k0 += RUN) {
    const k1 = Math.min(pts.length, k0 + RUN);
    let x = 0;
    let z = 0;
    for (let k = k0; k < k1; k++) {
      x += pts[k].x / (k1 - k0);
      z += pts[k].z / (k1 - k0);
    }
    let r = 0;
    for (let k = k0; k < k1; k++)
      r = Math.max(r, Math.hypot(pts[k].x - x, pts[k].z - z));
    runs.push({ x, z, r, k0, k1 });
  }
  return (x, z) => {
    let best = Infinity;
    let bk = -1;
    const scan = (run: (typeof runs)[number]) => {
      for (let k = run.k0; k < run.k1; k++) {
        const d = Math.hypot(pts[k].x - x, pts[k].z - z);
        // ties go to the first point along the road, as a plain scan
        if (d < best || (d === best && k < bk)) [best, bk] = [d, k];
      }
    };
    // The run whose circle is nearest first (a tight bound), then every run its circle cannot rule out.
    let first = -1;
    let fd = Infinity;
    runs.forEach((run, i) => {
      const d = Math.hypot(run.x - x, run.z - z) - run.r;
      if (d < fd) [fd, first] = [d, i];
    });
    if (first >= 0) scan(runs[first]);
    runs.forEach((run, i) => {
      if (i !== first && Math.hypot(run.x - x, run.z - z) - run.r <= best)
        scan(run);
    });
    const p = pts[bk] ?? { x: 0, z: 0 };
    return { d: best, x: p.x, z: p.z };
  };
}
