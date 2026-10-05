import { CatmullRomCurve3, Vector3 } from 'three';
import { smoothstep } from '../../../shared/noise';
import type { RoadDef, RoadPoint, RoadSpan } from '../maps/shared/types';

/**
 * Road centreline sampled every metre along a centripetal Catmull-Rom spline,
 * plus a spatial grid for fast "nearest point on road" queries (used by the
 * terrain carver, physics surface lookup, scatter exclusion and stage timing).
 */
export interface RoadSample {
  x: number;
  y: number;
  z: number;
  /** Distance along the road (m). */
  dist: number;
  /** Unit tangent (direction of travel) in XZ. */
  tx: number;
  tz: number;
  halfWidth: number;
  /** Signed curvature (1/m), + = turning left. */
  curvature: number;
}

export interface RoadQuery {
  found: boolean;
  /** Signed lateral offset from the centreline (m, + = left of travel direction). */
  lateral: number;
  /** |lateral| */
  distance: number;
  along: number;
  /** Centreline height at the nearest point. */
  height: number;
  halfWidth: number;
  /** Index of the segment start sample. */
  index: number;
}

export function newRoadQuery(): RoadQuery {
  return {
    found: false,
    lateral: 0,
    distance: Infinity,
    along: 0,
    height: 0,
    halfWidth: 0,
    index: 0,
  };
}

const CELL = 16;

export class Road {
  readonly samples: RoadSample[] = [];
  readonly length: number;
  /** Max distance from the centreline at which the road affects terrain. */
  readonly influence: number;
  /** Stretches on a bridge (deck over lowered ground), sorted by `from`. */
  readonly bridges: RoadSpan[];
  private grid = new Map<number, number[]>();

  constructor(
    readonly def: RoadDef,
    terrainHeight: (x: number, z: number) => number,
  ) {
    const pts = def.points.map(normalizePoint);
    const curve = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, 0, p.z)),
      false,
      'centripetal',
    );
    // Arc-length table resolution (three.js default 200 is far too coarse for km-long
    // roads: the 1 m samples would bunch up / stretch, i.e. kinks in height and timing).
    curve.arcLengthDivisions = Math.max(200, pts.length * 40);
    this.length = curve.getLength();
    const n = Math.max(2, Math.ceil(this.length));
    const tmp = new Vector3();
    const tan = new Vector3();
    let maxHw = 0;
    const dys: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const t = curve.getUtoTmapping(u, 0); // 0 = use u (falsy distance)
      curve.getPoint(t, tmp);
      curve.getTangent(t, tan);
      // Interpolate per-point attributes between control points.
      const f = t * (pts.length - 1);
      const k = Math.min(pts.length - 2, Math.floor(f));
      const s = smoothstep(0, 1, f - k);
      const a = pts[k];
      const b = pts[k + 1];
      const width =
        (a.width ?? def.width) * (1 - s) + (b.width ?? def.width) * s;
      dys.push((a.dy ?? 0) * (1 - s) + (b.dy ?? 0) * s);
      const tl = Math.hypot(tan.x, tan.z) || 1;
      this.samples.push({
        x: tmp.x,
        y: terrainHeight(tmp.x, tmp.z),
        z: tmp.z,
        dist: u * this.length,
        tx: tan.x / tl,
        tz: tan.z / tl,
        halfWidth: width / 2,
        curvature: 0,
      });
      maxHw = Math.max(maxHw, width / 2);
    }
    this.smoothHeights(def.smoothing);
    if (def.maxGrade) {
      this.limitGrade(def.maxGrade);
      this.smoothHeights(def.gradeSmoothing ?? 12);
    }
    this.samples.forEach((s, i) => (s.y += dys[i]));
    this.bridges = (def.spans ?? [])
      .filter((sp) => sp.kind === 'bridge')
      .sort((a, b) => a.from - b.from);
    this.straightenBridges();
    this.computeCurvature();
    this.influence = maxHw + def.shoulder + 30;
    this.buildGrid();
  }

  private smoothHeights(window: number): void {
    // Three box-filter passes ~= gaussian.
    const r = Math.max(1, Math.round(window / 2 / 3));
    const ys = this.samples.map((s) => s.y);
    for (let pass = 0; pass < 3; pass++) {
      const src = ys.slice();
      for (let i = 0; i < ys.length; i++) {
        let sum = 0;
        let cnt = 0;
        for (let j = i - r; j <= i + r; j++) {
          const jj = Math.min(ys.length - 1, Math.max(0, j));
          sum += src[jj];
          cnt++;
        }
        ys[i] = sum / cnt;
      }
    }
    this.samples.forEach((s, i) => (s.y = ys[i]));
  }

  /** Clamp the slope between samples (forward + backward passes until stable). */
  private limitGrade(maxGrade: number): void {
    const s = this.samples;
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let i = 1; i < s.length; i++) {
        const lim = maxGrade * (s[i].dist - s[i - 1].dist);
        const y = Math.min(
          s[i - 1].y + lim,
          Math.max(s[i - 1].y - lim, s[i].y),
        );
        if (y !== s[i].y) [s[i].y, changed] = [y, true];
      }
      for (let i = s.length - 2; i >= 0; i--) {
        const lim = maxGrade * (s[i + 1].dist - s[i].dist);
        const y = Math.min(
          s[i + 1].y + lim,
          Math.max(s[i + 1].y - lim, s[i].y),
        );
        if (y !== s[i].y) [s[i].y, changed] = [y, true];
      }
      if (!changed) break;
    }
  }

  /** A deck is straight between its abutments (the land under it - a street valley - is no business of the road). */
  private straightenBridges(): void {
    const s = this.samples;
    const k = (s.length - 1) / this.length;
    for (const sp of this.bridges) {
      const i0 = Math.max(0, Math.round(sp.from * k));
      const i1 = Math.min(s.length - 1, Math.round(sp.to * k));
      if (i1 - i0 < 2) continue;
      const y0 = s[i0].y;
      const y1 = s[i1].y;
      for (let i = i0 + 1; i < i1; i++)
        s[i].y = y0 + ((y1 - y0) * (i - i0)) / (i1 - i0);
    }
  }

  /** Bridge span containing `along`, if any. */
  bridgeAt(along: number): RoadSpan | undefined {
    for (const sp of this.bridges) {
      if (along < sp.from) return undefined;
      if (along <= sp.to) return sp;
    }
    return undefined;
  }

  private computeCurvature(): void {
    const s = this.samples;
    const k = 4; // finite difference half-window (m)
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(0, i - k)];
      const b = s[Math.min(s.length - 1, i + k)];
      const ang = Math.atan2(
        a.tx * b.tz - a.tz * b.tx,
        a.tx * b.tx + a.tz * b.tz,
      );
      // Heading measured from +Z towards +X is "left" in our frame; cross>0 => turning towards +X.
      s[i].curvature = -ang / Math.max(1e-3, b.dist - a.dist);
    }
  }

  private buildGrid(): void {
    const R = this.influence;
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - R) / CELL);
      const x1 = Math.floor((Math.max(a.x, b.x) + R) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - R) / CELL);
      const z1 = Math.floor((Math.max(a.z, b.z) + R) / CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cellKey(cx, cz);
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** Nearest point on the road within `influence`. */
  query(x: number, z: number, out: RoadQuery): RoadQuery {
    out.found = false;
    out.distance = Infinity;
    const list = this.grid.get(
      cellKey(Math.floor(x / CELL), Math.floor(z / CELL)),
    );
    if (!list) return out;
    let best = Infinity;
    let bi = -1;
    let bt = 0;
    const s = this.samples;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const a = s[i];
      const b = s[i + 1];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + ex * t - x;
      const pz = a.z + ez * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
      }
    }
    if (bi < 0 || best > this.influence * this.influence) return out;
    return this.fillQuery(out, x, z, bi, bt, best);
  }

  /**
   * Nearest point on the stretch of road between `alongMin` and `alongMax`
   * (no distance limit). Unlike `query`, a nearby later / earlier part of the
   * road (hairpin legs, crossings) is never picked - used for stage cut detection.
   */
  queryRange(
    x: number,
    z: number,
    alongMin: number,
    alongMax: number,
    out: RoadQuery,
  ): RoadQuery {
    const s = this.samples;
    const k = (s.length - 1) / this.length;
    const i0 = Math.max(0, Math.floor(alongMin * k));
    const i1 = Math.min(s.length - 2, Math.ceil(alongMax * k));
    let best = Infinity;
    let bi = -1;
    let bt = 0;
    for (let i = i0; i <= i1; i++) {
      const a = s[i];
      const b = s[i + 1];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + ex * t - x;
      const pz = a.z + ez * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
      }
    }
    out.found = false;
    out.distance = Infinity;
    if (bi < 0) return out;
    return this.fillQuery(out, x, z, bi, bt, best);
  }

  private fillQuery(
    out: RoadQuery,
    x: number,
    z: number,
    bi: number,
    bt: number,
    best: number,
  ): RoadQuery {
    const s = this.samples;
    const a = s[bi];
    const b = s[bi + 1];
    const cx = a.x + (b.x - a.x) * bt;
    const cz = a.z + (b.z - a.z) * bt;
    const tx = a.tx + (b.tx - a.tx) * bt;
    const tz = a.tz + (b.tz - a.tz) * bt;
    // Left of travel direction (+X is left when facing +Z): left = (tz, -tx).
    out.lateral = (x - cx) * tz - (z - cz) * tx;
    out.distance = Math.sqrt(best);
    out.along = a.dist + (b.dist - a.dist) * bt;
    out.height = a.y + (b.y - a.y) * bt;
    out.halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * bt;
    out.index = bi;
    out.found = true;
    return out;
  }

  /** Interpolated centreline sample at a distance along the road (clamped). */
  at(along: number): RoadSample {
    const d = Math.min(this.length, Math.max(0, along));
    const s = this.samples;
    const f = (d / this.length) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(f));
    const t = f - i;
    const a = s[i];
    const b = s[i + 1];
    const tx = a.tx + (b.tx - a.tx) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      dist: d,
      tx: tx / tl,
      tz: tz / tl,
      halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
    };
  }

  /** Heading (rad, rotation about +Y, 0 = facing +Z) of the road at `along`. */
  headingAt(along: number): number {
    const s = this.at(along);
    return Math.atan2(s.tx, s.tz);
  }
}

function normalizePoint(p: RoadPoint): {
  x: number;
  z: number;
  dy?: number;
  width?: number;
} {
  return Array.isArray(p) ? { x: p[0], z: p[1] } : p;
}

function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
