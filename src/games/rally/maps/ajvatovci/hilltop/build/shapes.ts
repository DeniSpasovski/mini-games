import {
  Matrix4,
  ShapeUtils,
  Vector2,
  type BufferGeometry,
  type ColorRepresentation,
} from 'three';
import { Frame, type Bucket } from '../../start-row/build/kit';
import type { MatKey } from '../../start-row/build/materials';
import type { Site } from '../site';

/**
 * Geometry helpers of the hilltop landmark, on top of the start row's kit (`start-row/build/kit.ts`:
 * per-material soups, paint in vertex colours, metre UVs). A `Local` is one structure's frame
 * (site.ts `Site`): pieces are written in its local metres (x along the structure, z across, y up from
 * its ground) and moved into the world by one rigid matrix. Every helper takes the normal a face should
 * have and fixes the winding itself, so pieces can be written in any vertex order.
 */
export type V3 = [number, number, number];
export type V2 = [number, number];

/** A flat wall face: `o` a point on it at y = 0, `n` its outward normal (horizontal). */
export interface Wall {
  o: V3;
  n: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Right-hand direction along a wall seen from outside: (s, y) counter-clockwise faces `n`. */
const rightOf = (w: Wall): V3 => [w.n[2], 0, -w.n[0]];

/** Point on a wall at (s along it, y up), pushed `off` metres out of it. */
export const onWall = (w: Wall, s: number, y: number, off = 0): V3 => {
  const r = rightOf(w);
  return [
    w.o[0] + r[0] * s + w.n[0] * off,
    y,
    w.o[2] + r[2] * s + w.n[2] * off,
  ];
};

/** Outline of an arched opening: `w` wide, sill at `y0`, top of the arch at `y1`, round head. */
export function archOutline(
  s: number,
  y0: number,
  w: number,
  y1: number,
  segments = 8,
): V2[] {
  const r = w / 2;
  const spring = y1 - r;
  const pts: V2[] = [
    [s - r, y0],
    [s + r, y0],
  ];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI;
    pts.push([s + Math.cos(a) * r, spring + Math.sin(a) * r]);
  }
  return pts;
}

/** Rectangle outline (s0, y0) .. (s1, y1). */
export const rectOutline = (
  s0: number,
  y0: number,
  s1: number,
  y1: number,
): V2[] => [
  [s0, y0],
  [s1, y0],
  [s1, y1],
  [s0, y1],
];

export class Local {
  readonly frame: Frame;
  readonly m: Matrix4;

  constructor(
    bucket: Bucket,
    tile: string,
    readonly site: Site,
    readonly baseY: number,
  ) {
    this.frame = new Frame(bucket, tile, undefined, { x: site.x, z: site.z });
    this.m = new Matrix4().makeRotationY(-site.yaw).setPosition(0, baseY, 0);
  }

  /** One triangle facing `want` (winding fixed here); `uv` in metres. */
  tri(
    key: MatKey,
    a: V3,
    b: V3,
    c: V3,
    color: ColorRepresentation,
    uv: [V2, V2, V2],
    want: V3,
  ): void {
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, want) < 0)
      this.frame.tri(key, a, c, b, color, [uv[0], uv[2], uv[1]], {
        matrix: this.m,
      });
    else this.frame.tri(key, a, b, c, color, uv, { matrix: this.m });
  }

  /** Convex quad / polygon fan facing `want`; `uvOf` maps a point to metre UVs. */
  fan(
    key: MatKey,
    pts: V3[],
    color: ColorRepresentation,
    want: V3,
    uvOf: (p: V3) => V2,
  ): void {
    for (let i = 1; i + 1 < pts.length; i++)
      this.tri(
        key,
        pts[0],
        pts[i],
        pts[i + 1],
        color,
        [uvOf(pts[0]), uvOf(pts[i]), uvOf(pts[i + 1])],
        want,
      );
  }

  /** Axis-aligned box in local metres (UVs from its local coordinates). `extra` = a local matrix first. */
  box(
    key: MatKey,
    a: V3,
    b: V3,
    color: ColorRepresentation,
    extra?: Matrix4,
  ): void {
    this.frame.box(key, a, b, color, {
      matrix: extra ? this.m.clone().multiply(extra) : this.m,
    });
  }

  /** Any geometry in local metres (`extra` = its own placement). */
  add(
    key: MatKey,
    g: BufferGeometry,
    color: ColorRepresentation,
    extra?: Matrix4,
  ): void {
    this.frame.add(key, g, color, {
      matrix: extra ? this.m.clone().multiply(extra) : this.m,
    });
  }

  /**
   * A flat wall panel: `outline` (s, y) with `holes`, on wall `w` pushed out by `off`. UVs (s + uOff, y).
   * With `depth`, the back face (inside) and the reveals of every hole are written too.
   */
  panel(
    key: MatKey,
    w: Wall,
    outline: V2[],
    color: ColorRepresentation,
    o: { holes?: V2[][]; off?: number; depth?: number; uOff?: number } = {},
  ): void {
    const holes = o.holes ?? [];
    const off = o.off ?? 0;
    const uOff = o.uOff ?? 0;
    const faces = ShapeUtils.triangulateShape(
      outline.map(([s, y]) => new Vector2(s, y)),
      holes.map((h) => h.map(([s, y]) => new Vector2(s, y))),
    );
    const all = [...outline, ...holes.flat()];
    const back: V3 = [-w.n[0], -w.n[1], -w.n[2]];
    for (const [i, j, k] of faces) {
      const tri = [all[i], all[j], all[k]];
      const uv = tri.map(([s, y]): V2 => [s + uOff, y]) as [V2, V2, V2];
      this.tri(
        key,
        onWall(w, tri[0][0], tri[0][1], off),
        onWall(w, tri[1][0], tri[1][1], off),
        onWall(w, tri[2][0], tri[2][1], off),
        color,
        uv,
        w.n,
      );
      if (o.depth)
        this.tri(
          key,
          onWall(w, tri[0][0], tri[0][1], off - o.depth),
          onWall(w, tri[1][0], tri[1][1], off - o.depth),
          onWall(w, tri[2][0], tri[2][1], off - o.depth),
          color,
          uv,
          back,
        );
    }
    if (!o.depth) return;
    // Reveals: every hole edge becomes a strip through the wall, facing into the opening.
    for (const h of holes) {
      const cs = h.reduce((s, p) => s + p[0], 0) / h.length;
      const cy = h.reduce((s, p) => s + p[1], 0) / h.length;
      let u = 0;
      for (let i = 0; i < h.length; i++) {
        const p = h[i];
        const q = h[(i + 1) % h.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 1e-4) continue;
        // In-plane normal of the edge towards the hole's centre.
        let ns = -(q[1] - p[1]) / len;
        let ny = (q[0] - p[0]) / len;
        if ((cs - p[0]) * ns + (cy - p[1]) * ny < 0) {
          ns = -ns;
          ny = -ny;
        }
        const r = rightOf(w);
        const want: V3 = [r[0] * ns, ny, r[2] * ns];
        const a = onWall(w, p[0], p[1], off);
        const b = onWall(w, q[0], q[1], off);
        const c = onWall(w, q[0], q[1], off - o.depth);
        const d = onWall(w, p[0], p[1], off - o.depth);
        this.fan(key, [a, b, c, d], color, want, (pt) => [
          pt === a || pt === d ? u : u + len,
          pt === a || pt === b ? 0 : o.depth!,
        ]);
        u += len;
      }
    }
  }

  /**
   * A tiled roof plane: polygon `pts` (local), the first edge (pts[0] -> pts[1]) is the eave. Tile UVs
   * run along the eave (u) and up the slope (v). A soffit (painted underside `under` m lower) closes it
   * from below, and the edges listed in `trim` (index i = pts[i] -> pts[i + 1]) get a dark fascia board.
   */
  roof(
    pts: V3[],
    o: {
      color?: ColorRepresentation;
      trim?: number[];
      under?: number;
      soffit?: ColorRepresentation;
      fascia?: ColorRepresentation;
    } = {},
  ): void {
    const e = norm(sub(pts[1], pts[0]));
    const centre = pts
      .reduce(
        (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as V3,
        [0, 0, 0],
      )
      .map((v) => v / pts.length) as V3;
    const toC = sub(centre, pts[0]);
    const up = norm(sub(toC, e.map((v) => v * dot(toC, e)) as V3));
    const uvOf = (p: V3): V2 => [
      dot(sub(p, pts[0]), e),
      dot(sub(p, pts[0]), up),
    ];
    const n = norm(cross(e, up));
    const nUp: V3 = n[1] >= 0 ? n : [-n[0], -n[1], -n[2]];
    this.fan('tiles', pts, o.color ?? '#ffffff', nUp, uvOf);
    const under = o.under ?? 0.12;
    const low = pts.map((p): V3 => [p[0], p[1] - under, p[2]]);
    this.fan(
      'paint',
      low,
      o.soffit ?? '#5a4636',
      [-nUp[0], -nUp[1], -nUp[2]],
      uvOf,
    );
    for (const i of o.trim ?? []) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const out = norm(
        sub(
          [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2],
          [centre[0], 0, centre[2]],
        ),
      );
      const t = 0.03;
      const f = (p: V3, dy: number): V3 => [
        p[0] + out[0] * t,
        p[1] + dy,
        p[2] + out[2] * t,
      ];
      this.fan(
        'paint',
        [f(a, 0.04), f(b, 0.04), f(b, -under - 0.1), f(a, -under - 0.1)],
        o.fascia ?? '#45484b',
        out,
        () => [0, 0],
      );
    }
  }
}
