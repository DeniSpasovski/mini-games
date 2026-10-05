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
