/**
 * Surveyed retaining walls (MapDef.retainingWalls): polylines with the land level on each side, sampled from the
 * terrain once it is built (TerrainGenerator.buildWalls). The terrain steps at each line (`TerrainGenerator.height`:
 * held at `high` behind the face, at `low` in front of it) and cut-wall-mesh.ts builds the wall on it.
 */

/** Grid cell of the segment index (m). */
const CELL = 16;
/**
 * A point that projects past an inner vertex (outside a bend) belongs to the wall only this close to the vertex (m): the
 * step runs round the bend at the wall itself; further out the segment's straight extension lifted a wedge of land
 * (a hooked wall end at B8 stood a 5 m ridge in the parkway's median).
 */
const BEND_REACH = 5;

export interface WallQuery {
  found: boolean;
  wall: number;
  /** Distance along the wall of the nearest point (m). */
  along: number;
  /** Signed distance from the line: + on the high side (m). */
  side: number;
  /** Land levels at that point: behind the face (top) and in front of it (foot). */
  high: number;
  low: number;
}

export function newWallQuery(): WallQuery {
  return { found: false, wall: -1, along: 0, side: 0, high: 0, low: 0 };
}

export class RetainingWalls {
  readonly lines: Float32Array[];
  /** Cumulative length at each vertex. */
  readonly acc: Float32Array[];
  /** Per vertex: +1 the land left of the line's direction is high, -1 right, 0 no step there. */
  readonly sides: Int8Array[];
  readonly highs: Float32Array[];
  readonly lows: Float32Array[];
  private grid = new Map<number, number[]>();

  constructor(lines: number[][]) {
    this.lines = lines.map((l) => Float32Array.from(l));
    this.acc = this.lines.map((l) => {
      const n = l.length / 2;
      const a = new Float32Array(n);
      for (let i = 1; i < n; i++)
        a[i] =
          a[i - 1] +
          Math.hypot(l[i * 2] - l[i * 2 - 2], l[i * 2 + 1] - l[i * 2 - 1]);
      return a;
    });
    this.sides = this.lines.map((l) => new Int8Array(l.length / 2));
    this.highs = this.lines.map((l) => new Float32Array(l.length / 2));
    this.lows = this.lines.map((l) => new Float32Array(l.length / 2));
    this.lines.forEach((l, w) => {
      for (let i = 0; i + 3 < l.length; i += 2) {
        const x0 = Math.min(l[i], l[i + 2]);
        const x1 = Math.max(l[i], l[i + 2]);
        const z0 = Math.min(l[i + 1], l[i + 3]);
        const z1 = Math.max(l[i + 1], l[i + 3]);
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
          for (
            let cz = Math.floor(z0 / CELL);
            cz <= Math.floor(z1 / CELL);
            cz++
          ) {
            const k = key(cx, cz);
            const list = this.grid.get(k);
            const id = w * 65536 + i / 2;
            if (list) list.push(id);
            else this.grid.set(k, [id]);
          }
      }
    });
  }

  get length(): number {
    return this.lines.length;
  }

  /** Point and unit direction of wall `w` at `a` m along it. */
  pointAt(
    w: number,
    a: number,
    out: { x: number; z: number; tx: number; tz: number },
  ): void {
    const l = this.lines[w];
    const acc = this.acc[w];
    const n = acc.length;
    let i = 0;
    while (i < n - 2 && acc[i + 1] < a) i++;
    const seg = acc[i + 1] - acc[i] || 1;
    const t = Math.min(1, Math.max(0, (a - acc[i]) / seg));
    const dx = l[i * 2 + 2] - l[i * 2];
    const dz = l[i * 2 + 3] - l[i * 2 + 1];
    out.x = l[i * 2] + dx * t;
    out.z = l[i * 2 + 1] + dz * t;
    out.tx = dx / seg;
    out.tz = dz / seg;
  }

  /** Vertex values of wall `w` interpolated at `a` m along it. */
  valueAt(arr: Float32Array, w: number, a: number): number {
    const acc = this.acc[w];
    const n = acc.length;
    let i = 0;
    while (i < n - 2 && acc[i + 1] < a) i++;
    const t = Math.min(
      1,
      Math.max(0, (a - acc[i]) / (acc[i + 1] - acc[i] || 1)),
    );
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }

  /**
   * The wall with a stepped vertex nearest (x, z) within `reach` m, projecting inside a segment (not past the line's
   * ends: the step stops with the wall).
   */
  query(x: number, z: number, reach: number, out: WallQuery): WallQuery {
    out.found = false;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = reach;
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = this.grid.get(key(gx, gz));
        if (!list) continue;
        for (const id of list) {
          const w = Math.floor(id / 65536);
          const i = id % 65536;
          const s = this.sides[w];
          if (!s[i] && !s[i + 1]) continue;
          const l = this.lines[w];
          const ax = l[i * 2];
          const az = l[i * 2 + 1];
          const ex = l[i * 2 + 2] - ax;
          const ez = l[i * 2 + 3] - az;
          const len2 = ex * ex + ez * ez || 1e-9;
          const t = ((x - ax) * ex + (z - az) * ez) / len2;
          const n = l.length / 2;
          if ((t < 0 && i === 0) || (t > 1 && i === n - 2)) continue;
          const tc = Math.min(1, Math.max(0, t));
          const d = Math.hypot(ax + ex * tc - x, az + ez * tc - z);
          if (d >= best || (tc !== t && d > BEND_REACH)) continue;
          best = d;
          const len = Math.sqrt(len2);
          // + = left of the segment's direction, (tz, -tx).
          const left = ((x - ax) * ez - (z - az) * ex) / len;
          const sign = s[i] || s[i + 1];
          out.found = true;
          out.wall = w;
          out.along = this.acc[w][i] + tc * len;
          out.side = left * sign;
          out.high =
            this.highs[w][i] + (this.highs[w][i + 1] - this.highs[w][i]) * tc;
          out.low =
            this.lows[w][i] + (this.lows[w][i + 1] - this.lows[w][i]) * tc;
        }
      }
    return out;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
