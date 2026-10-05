import type { BuildingDef, RoadPoint, RoadSpan } from './types';

/**
 * Helpers for real-world maps baked by scripts/realmap/bake.py
 * (each map folder has `data.json` + `map.ts`, see maps/ajvatovci).
 */

/**
 * Baked route control points -> road points, with the width chosen by distance
 * along the route (e.g. wide industrial street, narrow hill road).
 */
export function routePoints(
  route: number[][],
  widthAt: (along: number) => number,
): RoadPoint[] {
  let along = 0;
  return route.map(([x, z], i) => {
    if (i > 0) along += Math.hypot(x - route[i - 1][0], z - route[i - 1][1]);
    return { x, z, width: widthAt(along) };
  });
}

/** Compact baked building rows -> BuildingDef[] (columns listed in `fields`). */
export function buildingsFromData(b: {
  fields: string[];
  types: string[];
  sources: string[];
  rows: number[][];
  kinds?: string[];
  roofs?: string[];
  polys?: Record<string, number[]>;
}): BuildingDef[] {
  const col = (name: string) => b.fields.indexOf(name);
  const [id, x, z, w, d, angle, h, floors, type, src, along, kind, roof] = [
    'id',
    'x',
    'z',
    'w',
    'd',
    'angle',
    'h',
    'floors',
    'type',
    'src',
    'along',
    'kind',
    'roof',
  ].map(col);
  return b.rows.map((r) => {
    const def: BuildingDef = {
      id: r[id],
      x: r[x],
      z: r[z],
      w: r[w],
      d: r[d],
      angle: r[angle],
      h: r[h],
      floors: r[floors],
      type: b.types[r[type]] as BuildingDef['type'],
      source: b.sources[r[src]],
      along: r[along],
    };
    if (kind >= 0 && b.kinds) {
      def.kind = b.kinds[r[kind]] as BuildingDef['kind'];
      def.roof = b.roofs?.[r[roof]] as BuildingDef['roof'];
      const poly = b.polys?.[String(r[id])];
      if (poly) def.poly = poly;
    }
    return def;
  });
}

/** Baked `routeSpans` (bridges / underpasses of the stage road) -> RoadDef.spans. */
export function routeSpans(
  spans: { kind: string; from: number; to: number; layer?: number }[],
): RoadSpan[] {
  return spans.map((s) => ({
    kind: s.kind as RoadSpan['kind'],
    from: s.from,
    to: s.to,
    layer: s.layer,
  }));
}

/**
 * Bridges shorter than `min` m are lengthened symmetrically (never closer than 6 m to the next span): a short span
 * over a street leaves no room for the underpass (walls, sidewalks, the street's width on a skew).
 */
export function lengthenBridges(spans: RoadSpan[], min: number): RoadSpan[] {
  const out = spans.map((s) => ({ ...s }));
  out.forEach((s, i) => {
    if (s.kind !== 'bridge' || s.to - s.from >= min) return;
    const grow = (min - (s.to - s.from)) / 2;
    const lo = i > 0 ? out[i - 1].to + 6 : -Infinity;
    const hi = i + 1 < out.length ? out[i + 1].from - 6 : Infinity;
    s.from = Math.max(lo, s.from - grow);
    s.to = Math.min(hi, s.to + grow);
  });
  return out;
}

/** A baked path as `fitBridgesToStreets` needs it. */
interface FitPath {
  kind: string;
  surface: string;
  bridge?: boolean;
  pts: number[];
}

/**
 * Grows each stage-road bridge span so that every street crossing beneath it fits inside with room to spare: the
 * street's footprint along the road (a skewed street crosses the whole divided parkway, ~30 m, plus its own width),
 * plus `margin` m each side for the abutment returns and the underpass walls. Without it the street ran into the
 * abutment faces at the span ends. Spans never grow by more than `maxGrow` per end nor closer than 6 m to the next.
 * `route` = the baked stage line (x, z); lateral band [`right`, `left`] m from it = the parkway (both carriageways).
 */
export function fitBridgesToStreets(
  spans: RoadSpan[],
  route: number[][],
  paths: FitPath[],
  opts: { left: number; right: number; margin: number; maxGrow: number },
): RoadSpan[] {
  const cum = [0];
  for (let i = 1; i < route.length; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(
          route[i][0] - route[i - 1][0],
          route[i][1] - route[i - 1][1],
        ),
    );
  /** Along / lateral (+ = left of travel) of a point against the segments of the route within [a0, a1]. */
  const project = (x: number, z: number, a0: number, a1: number) => {
    let best = { d: Infinity, along: 0, lat: 0, cos: 0, tx: 0, tz: 0 };
    for (let i = 0; i + 1 < route.length; i++) {
      if (cum[i + 1] < a0 || cum[i] > a1) continue;
      const ex = route[i + 1][0] - route[i][0];
      const ez = route[i + 1][1] - route[i][1];
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(
        0,
        Math.min(1, ((x - route[i][0]) * ex + (z - route[i][1]) * ez) / l2),
      );
      const px = route[i][0] + ex * t;
      const pz = route[i][1] + ez * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best.d) {
        const l = Math.sqrt(l2);
        best = {
          d,
          along: cum[i] + t * l,
          lat: ((x - px) * ez - (z - pz) * ex) / l,
          cos: 0,
          tx: ex / l,
          tz: ez / l,
        };
      }
    }
    return best;
  };
  const out = spans.map((s) => ({ ...s }));
  out.forEach((s, i) => {
    if (s.kind !== 'bridge') return;
    let lo = s.from;
    let hi = s.to;
    for (const p of paths) {
      if (
        p.bridge ||
        p.surface !== 'tarmac' ||
        /^(motorway|trunk)/.test(p.kind)
      )
        continue;
      for (let k = 0; k + 3 < p.pts.length; k += 2) {
        const ax = p.pts[k];
        const az = p.pts[k + 1];
        const L = Math.hypot(p.pts[k + 2] - ax, p.pts[k + 3] - az);
        for (let a = 0; a <= L; a += 1) {
          const t = L > 0 ? a / L : 0;
          const x = ax + (p.pts[k + 2] - ax) * t;
          const z = az + (p.pts[k + 3] - az) * t;
          const q = project(x, z, s.from - 60, s.to + 60);
          if (q.lat > opts.left || q.lat < opts.right) continue;
          if (q.along < s.from - opts.maxGrow || q.along > s.to + opts.maxGrow)
            continue;
          // Crossing, not running along the parkway.
          const dx = (p.pts[k + 2] - ax) / (L || 1);
          const dz = (p.pts[k + 3] - az) / (L || 1);
          if (Math.abs(dx * q.tx + dz * q.tz) > 0.8) continue;
          lo = Math.min(lo, q.along - opts.margin);
          hi = Math.max(hi, q.along + opts.margin);
        }
      }
    }
    const prev = i > 0 ? out[i - 1].to + 6 : -Infinity;
    const next = i + 1 < out.length ? out[i + 1].from - 6 : Infinity;
    s.from = Math.max(prev, s.from - opts.maxGrow, Math.min(s.from, lo));
    s.to = Math.min(next, s.to + opts.maxGrow, Math.max(s.to, hi));
  });
  return out;
}
