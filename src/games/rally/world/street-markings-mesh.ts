import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { PathDef } from '../maps/shared/types';
import { DOTTED, type EndPaint } from './merge-paint';
import type { MarkGlyph } from './street-glyphs';
import {
  dashIntervals,
  type MarkColor,
  markingLines,
  trimsEnd,
} from './street-markings';

/**
 * Paint of the modelled streets (street-markings.ts) as thin quads laid over the road ribbon, merged per 256 m tile and
 * colour (two draws a tile). `road-mesh.ts` hands over each street's ribbon rows (centre, direction, half width, the
 * ribbon's own heights across): the lines are swept along them at the same heights, 1.5 cm above the asphalt.
 */

/** Lateral positions of the ribbon's columns as fractions of the half width (road-mesh `PATH_ACROSS`). */
const COLS = [-1, -0.5, 0, 0.5, 1];
const TILE = 256;
const LIFT = 0.015;
const SAMPLE = 1.5;

export interface MarkRow {
  x: number;
  z: number;
  /** Unit direction of the street. */
  tx: number;
  tz: number;
  /** Half width of the ribbon here. */
  hw: number;
  /** Metres along the street. */
  d: number;
  /** Ribbon heights at the five columns (left = +). */
  y: number[];
  /** Inside a junction plaza that does not keep its ribbons: no paint. */
  skip: boolean;
}

const COLOR: Record<MarkColor, [number, number, number]> = {
  white: [0.93, 0.93, 0.9],
  yellow: [0.86, 0.68, 0.12],
  wear: [0, 0, 0],
};

class Acc {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
}

/** Ribbon height at lateral `lat` (m, + left) of row `r`: linear between the five columns. */
function heightAt(r: MarkRow, lat: number): number {
  const f = Math.max(-1, Math.min(1, lat / (r.hw || 1))) * 2 + 2; // 0..4
  const k = Math.min(3, Math.floor(f));
  return r.y[k] + (r.y[k + 1] - r.y[k]) * (f - k);
}

/** The row data at distance `a` along the street, interpolated between the two rows around it. */
function rowAt(rows: MarkRow[], a: number, hint: { k: number }): MarkRow {
  let k = hint.k;
  while (k > 0 && rows[k].d > a) k--;
  while (k < rows.length - 2 && rows[k + 1].d < a) k++;
  hint.k = k;
  const p = rows[k];
  const q = rows[k + 1];
  const t = Math.max(0, Math.min(1, (a - p.d) / (q.d - p.d || 1)));
  const tx = p.tx + (q.tx - p.tx) * t;
  const tz = p.tz + (q.tz - p.tz) * t;
  const l = Math.hypot(tx, tz) || 1;
  return {
    x: p.x + (q.x - p.x) * t,
    z: p.z + (q.z - p.z) * t,
    tx: tx / l,
    tz: tz / l,
    hw: p.hw + (q.hw - p.hw) * t,
    d: a,
    y: p.y.map((v, i) => v + (q.y[i] - v) * t),
    skip: p.skip || q.skip,
  };
}

export class MarkingBuilder {
  private readonly tiles = new Map<
    string,
    { white: Acc; yellow: Acc; wear: Acc }
  >();
  /** Quads placed (diagnostics / tests). */
  quads = 0;

  private acc(x: number, z: number, color: MarkColor): Acc {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let t = this.tiles.get(k);
    if (!t)
      this.tiles.set(
        k,
        (t = { white: new Acc(), yellow: new Acc(), wear: new Acc() }),
      );
    return t[color];
  }

  /**
   * Paint street `p` over its `rows`. `jointStart` / `jointEnd`: that end continues into a straight OSM joint (no gap there);
   * a street that meets another one stops its paint END_GAP m short. `merge` (carriageways / ramps, merge-paint.ts):
   * the through road of a split / merge paints on to the node with a dotted edge line on the branch's side, the branch
   * stops where the ribbons overlap.
   */
  addPath(
    p: PathDef,
    rows: MarkRow[],
    length: number,
    jointStart: boolean,
    jointEnd: boolean,
    merge?: readonly [EndPaint, EndPaint],
  ): void {
    if (rows.length < 2) return;
    const lines = markingLines(p);
    if (!lines.length) return;
    const trim = (e: EndPaint | undefined, joint: boolean) =>
      e?.through ? 0 : e && e.trim > 0 ? e.trim : trimsEnd(joint);
    const from = trim(merge?.[0], jointStart);
    const to = length - trim(merge?.[1], jointEnd);
    if (to - from < 3) return;
    const hint = { k: 0 };
    const hw = p.width / 2;
    for (const line of lines) {
      if (line.dash) {
        for (const [a0, a1] of dashIntervals(from, to, line.dash))
          this.strip(p, rows, hint, line, a0, a1);
        continue;
      }
      // a solid edge line turns dotted along a branch that overlaps it
      let s0 = from;
      let s1 = to;
      const edge = line.color !== 'wear' && Math.abs(line.lat) > hw * 0.5;
      const dotted: [number, number][] = [];
      for (const [k, e] of (merge ?? []).entries()) {
        const d = e.dotted;
        if (!edge || !d || Math.sign(line.lat) !== d.side) continue;
        if (k === 0) {
          dotted.push([from, Math.min(to, from + d.length)]);
          s0 = Math.min(to, from + d.length);
        } else {
          dotted.push([Math.max(from, to - d.length), to]);
          s1 = Math.max(from, to - d.length);
        }
      }
      if (s1 - s0 > 0.2) this.strip(p, rows, hint, line, s0, s1);
      for (const [d0, d1] of dotted)
        for (const [a0, a1] of dashIntervals(d0, d1, DOTTED))
          this.strip(p, rows, hint, { ...line, w: 0.2 }, a0, a1);
    }
  }

  /**
   * Painted shapes (street-glyphs.ts: stop bars, arrows, bike symbols) of street `p` over its `rows`: each triangle's
   * corners (metres along, lateral) laid on the ribbon like the lines (lateral scaled with the local half width).
   */
  addGlyphs(p: PathDef, rows: MarkRow[], glyphs: readonly MarkGlyph[]): void {
    if (rows.length < 2) return;
    const half = p.width / 2 || 1;
    const hint = { k: 0 };
    for (const g of glyphs) {
      const t = g.tris;
      for (let i = 0; i + 5 < t.length; i += 6) {
        const verts: number[] = [];
        let skip = false;
        for (let c = 0; c < 6; c += 2) {
          const r = rowAt(rows, t[i + c], hint);
          if (r.skip) skip = true;
          const lat = t[i + c + 1] * (r.hw / half);
          verts.push(
            r.x + r.tz * lat,
            heightAt(r, lat) + LIFT,
            r.z - r.tx * lat,
          );
        }
        if (skip) continue;
        const acc = this.acc(verts[0], verts[2], g.color);
        const v0 = acc.pos.length / 3;
        acc.pos.push(...verts);
        for (let c = 0; c < 3; c++) acc.col.push(...COLOR[g.color]);
        acc.idx.push(v0, v0 + 1, v0 + 2);
        this.quads++;
      }
    }
  }

  private strip(
    p: PathDef,
    rows: MarkRow[],
    hint: { k: number },
    line: { lat: number; w: number; color: MarkColor },
    a0: number,
    a1: number,
  ): void {
    const n = Math.max(1, Math.ceil((a1 - a0) / SAMPLE));
    const half = p.width / 2 || 1;
    let prev = -1;
    let acc: Acc | undefined;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const r = rowAt(rows, a, hint);
      if (r.skip) {
        prev = -1;
        continue;
      }
      // the line keeps its place in the (tapering) road: its offset scales with the local half width
      const lat = line.lat * (r.hw / half);
      // left = (tz, -tx)
      const lx = r.tz;
      const lz = -r.tx;
      if (!acc) acc = this.acc(r.x, r.z, line.color);
      const v0 = acc.pos.length / 3;
      for (const dl of [-line.w / 2, line.w / 2]) {
        const l = lat + dl;
        acc.pos.push(r.x + lx * l, heightAt(r, l) + LIFT, r.z + lz * l);
        acc.col.push(...COLOR[line.color]);
      }
      if (prev >= 0) {
        // ribbon winding: (a, d, d + 1, a, d + 1, a + 1) with columns running from the right edge to the left
        const q = prev;
        acc.idx.push(q, v0, v0 + 1, q, v0 + 1, q + 1);
        this.quads++;
      }
      prev = v0;
    }
  }

  build(): Group | undefined {
    const group = new Group();
    group.name = 'markings';
    const mats: Record<MarkColor, MeshStandardMaterial> = {
      white: this.material(),
      yellow: this.material(),
      wear: this.material(true),
    };
    for (const t of this.tiles.values())
      for (const color of ['wear', 'white', 'yellow'] as const) {
        const acc = t[color];
        if (!acc.idx.length) continue;
        const g = new BufferGeometry();
        g.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(acc.pos), 3),
        );
        const nor = new Float32Array(acc.pos.length);
        for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
        g.setAttribute('normal', new BufferAttribute(nor, 3));
        g.setAttribute(
          'color',
          new BufferAttribute(new Float32Array(acc.col), 3),
        );
        g.setIndex(acc.idx);
        g.computeBoundingSphere();
        const m = new Mesh(g, mats[color]);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        group.add(m);
      }
    return group.children.length ? group : undefined;
  }

  private material(wear = false): MeshStandardMaterial {
    return new MeshStandardMaterial({
      vertexColors: true,
      roughness: wear ? 0.95 : 0.78,
      metalness: 0,
      // worn wheel paths: a faint dark film under the paint
      transparent: wear,
      opacity: wear ? 0.13 : 1,
      depthWrite: !wear,
      polygonOffset: true,
      polygonOffsetFactor: wear ? -2 : -3,
      polygonOffsetUnits: wear ? -4 : -6,
      side: 2,
    });
  }
}

export { COLS as MARK_COLUMNS };
