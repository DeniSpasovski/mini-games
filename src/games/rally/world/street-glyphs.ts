import type { PathDef } from '../maps/shared/types';
import { CROSS_LEN } from './street-detail';
import { BIKE_W, END_GAP, type MarkColor, PARK_W } from './street-markings';

/**
 * Painted shapes of the modelled streets (beside the lines of street-markings.ts): stop bars before the crosswalks, lane
 * arrows from OSM `turn:lanes`, bike symbols along the bike lanes. Pure (no scene): `street-markings-mesh.ts` lays the
 * triangles on the ribbon, the world tests run the layout. Coordinates: metres along the path, lateral + = left.
 */

/** A painted shape on the road: triangles as flat [along, lat, along, lat, along, lat, ...]. */
export interface MarkGlyph {
  color: MarkColor;
  tris: number[];
}

/** Stop bar width along the street (m) and its gap before the crosswalk. */
const BAR_W = 0.45;
const BAR_GAP = 1.2;
/** Lane arrow length, the gap from its tip back to the stop bar (m), a second one this far behind on a long block. */
export const ARROW_LEN = 4.2;
const ARROW_BACK = 4;
const ARROW_REPEAT = 28;
/** Bike symbols every BIKE_EVERY m along a bike lane. */
const BIKE_EVERY = 60;

const BIG = /^(motorway|trunk)/;

/** Travel band of a city street (between the parking / bike lanes): right edge, left edge, lane width, centre line. */
export function travelBand(
  p: PathDef,
  width = p.width,
): { b0: number; b1: number; laneW: number; centre: number } | undefined {
  const l = p.layout;
  if (!l) return undefined;
  const hw = width / 2;
  const left = hw - l.parkL * PARK_W;
  const right = -hw + l.parkR * PARK_W;
  const b0 = right + l.bikeR * BIKE_W;
  const b1 = left - l.bikeL * BIKE_W;
  const n = l.fwd + l.back;
  if (n < 1 || b1 - b0 < 2) return undefined;
  const laneW = (b1 - b0) / n;
  return { b0, b1, laneW, centre: b0 + l.fwd * laneW };
}

/** Local frame of a glyph: s forward along its travel direction, t to its left; placed at (u0, v0) on the path. */
class Frame {
  constructor(
    private readonly u0: number,
    private readonly v0: number,
    /** +1 = travel in the path direction, -1 = against it. */
    private readonly dir: number,
    private readonly out: number[],
  ) {}

  tri(
    s0: number,
    t0: number,
    s1: number,
    t1: number,
    s2: number,
    t2: number,
  ): void {
    const d = this.dir;
    // (a mirrored frame keeps the winding: the mesh is double sided)
    this.out.push(
      this.u0 + d * s0,
      this.v0 + d * t0,
      this.u0 + d * s1,
      this.v0 + d * t1,
      this.u0 + d * s2,
      this.v0 + d * t2,
    );
  }

  /** Axis-aligned rectangle (s0, t0) - (s1, t1). */
  rect(s0: number, t0: number, s1: number, t1: number): void {
    this.tri(s0, t0, s1, t0, s1, t1);
    this.tri(s0, t0, s1, t1, s0, t1);
  }

  /** A stroke of width `w` between two points. */
  line(s0: number, t0: number, s1: number, t1: number, w: number): void {
    const l = Math.hypot(s1 - s0, t1 - t0) || 1;
    const ns = (-(t1 - t0) / l) * (w / 2);
    const nt = ((s1 - s0) / l) * (w / 2);
    this.tri(s0 + ns, t0 + nt, s1 + ns, t1 + nt, s1 - ns, t1 - nt);
    this.tri(s0 + ns, t0 + nt, s1 - ns, t1 - nt, s0 - ns, t0 - nt);
  }
}

/** One lane arrow (~4 m), tip at s = 0 pointing forward: `kinds` = the lane's `turn:lanes` entry split at ';'. */
function arrow(f: Frame, kinds: string[]): void {
  const stem = 0.22;
  const headL = 1.1;
  const headW = 0.75;
  // a turn branch keeps within ~1 m of the lane centre (narrow city lanes)
  const sideL = 0.75;
  const has = (...k: string[]) => kinds.some((x) => k.includes(x));
  const through = has('through', '');
  const left = has('left', 'sharp_left');
  const right = has('right', 'sharp_right');
  const sLeft = has('slight_left', 'merge_to_left');
  const sRight = has('slight_right', 'merge_to_right');
  const turns = left || right || sLeft || sRight;
  // the stem: full length for a through arrow, to the bend for a turn-only arrow
  const bend = -headL - 1.0;
  f.rect(
    -ARROW_LEN,
    -stem / 2,
    through || !turns ? -headL : bend + stem / 2,
    stem / 2,
  );
  if (through || !turns) f.tri(-headL, -headW / 2, 0, 0, -headL, headW / 2);
  for (const [on, side, slight] of [
    [left, 1, false],
    [right, -1, false],
    [sLeft, 1, true],
    [sRight, -1, true],
  ] as const) {
    if (!on) continue;
    if (slight) {
      // a 35 deg branch off the stem
      const es = bend + 1.0;
      const et = side * 0.45;
      f.line(bend, 0, es, et, stem);
      const L = Math.hypot(es - bend, et);
      const ux = (es - bend) / L;
      const uy = et / L;
      f.tri(
        es - uy * (headW / 2),
        et + ux * (headW / 2),
        es + ux * sideL,
        et + uy * sideL,
        es + uy * (headW / 2),
        et - ux * (headW / 2),
      );
    } else {
      // a right-angle branch out of the bend, the head pointing to the side
      const reach = 0.25;
      f.rect(bend - stem / 2, 0, bend + stem / 2, side * reach);
      const t0 = side * reach;
      f.tri(
        bend - headW / 2,
        t0,
        bend,
        t0 + side * sideL,
        bend + headW / 2,
        t0,
      );
    }
  }
}

/** A plain bicycle (two wheels, frame, handlebar) with a forward arrow ahead of it, centred on (0, 0). */
function bike(f: Frame): void {
  const w = 0.09;
  const r = 0.38;
  for (const cs of [-0.62, 0.62]) {
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      f.line(
        cs + Math.cos(a0) * r,
        Math.sin(a0) * r,
        cs + Math.cos(a1) * r,
        Math.sin(a1) * r,
        w,
      );
    }
  }
  f.line(-0.62, 0, -0.15, 0.05, w);
  f.line(-0.15, 0.05, 0.25, 0.05, w);
  f.line(0.25, 0.05, 0.62, 0, w);
  f.line(0.4, -0.25, 0.4, 0.25, w);
  // the arrow ahead of it
  f.rect(1.3, -0.07, 2.1, 0.07);
  f.tri(2.1, -0.3, 2.6, 0, 2.1, 0.3);
}

/**
 * Stop bars, lane arrows and bike symbols of modelled street `p` (`length` m long, drawn `width` wide).
 * `crossings` = its crosswalks (street-detail.ts): traffic arriving at the junction beyond a crosswalk stops BAR_GAP
 * before it. An end without a crosswalk gets a bar END_GAP short of it where the data has a stop there (`marks.stop`), or
 * END_GAP short of where the street it meets begins (`free`: m along where the paint starts / ends, road-mesh.ts).
 * Arrows only where OSM has `turn:lanes` with one entry per approach lane. Carriageways / ramps get none.
 */
export function junctionGlyphs(
  p: PathDef,
  length: number,
  crossings: readonly { at: number; atEnd: boolean }[],
  width = p.width,
  free: readonly [number, number] = [0, length],
): MarkGlyph[] {
  const l = p.layout;
  if (!l || BIG.test(p.kind) || p.kind.endsWith('_link')) return [];
  const band = travelBand(p, width);
  if (!band) return [];
  const white: number[] = [];
  const { b0, b1, laneW, centre } = band;
  for (const atEnd of [false, true]) {
    // traffic arriving at this end: the fwd lanes at the end, the back lanes at the start
    const lanes = atEnd ? l.fwd : l.back;
    if (lanes < 1) continue;
    const dir = atEnd ? 1 : -1;
    const cross = crossings.find((c) => c.atEnd === atEnd);
    let bar: number;
    if (cross) bar = cross.at - dir * (CROSS_LEN / 2 + BAR_GAP + BAR_W / 2);
    else if (p.marks?.stop?.[atEnd ? 1 : 0])
      bar = atEnd
        ? Math.min(length - END_GAP, free[1] - BAR_GAP - BAR_W / 2)
        : Math.max(END_GAP, free[0] + BAR_GAP + BAR_W / 2);
    else continue;
    if (bar < 2 || bar > length - 2) continue;
    // across the approach lanes and the bike lane on their right; clear of the centre line
    const v0 = atEnd ? b0 - (l.bikeR ? BIKE_W : 0) + 0.15 : centre + 0.2;
    const v1 = atEnd
      ? centre - (l.back > 0 ? 0.2 : -(l.bikeL ? BIKE_W : 0) + 0.15)
      : b1 + (l.bikeL ? BIKE_W : 0) - 0.15;
    new Frame(bar, 0, 1, white).rect(-BAR_W / 2, v0, BAR_W / 2, v1);
    const turn = atEnd ? p.marks?.turn : p.marks?.turnBack;
    if (!turn) continue;
    const per = turn.split('|');
    if (per.length !== lanes) continue;
    for (let k = 0; k < lanes; k++) {
      const kinds = per[k].split(';');
      if (kinds.every((x) => x === 'none' || x === '')) continue;
      // lane k from the left of its traffic: next to the centre line, outwards
      const vc = atEnd
        ? centre - laneW * (k + 0.5)
        : centre + laneW * (k + 0.5);
      for (const back of [ARROW_BACK, ARROW_BACK + ARROW_REPEAT]) {
        if (back > ARROW_BACK && length < 3 * ARROW_REPEAT) continue;
        const tip = bar - dir * (BAR_W / 2 + back);
        const tail = tip - dir * ARROW_LEN;
        if (Math.min(tip, tail) < 3 || Math.max(tip, tail) > length - 3)
          continue;
        arrow(new Frame(tip, vc, dir, white), kinds);
      }
    }
  }
  // bike symbols along the bike lanes: a right-side lane runs with the path, a left one against it on a two-way street
  const hw = width / 2;
  for (const [has, side] of [
    [l.bikeR, -1],
    [l.bikeL, 1],
  ] as const) {
    if (!has) continue;
    const edge = side < 0 ? -hw + l.parkR * PARK_W : hw - l.parkL * PARK_W;
    const vc = edge - side * (BIKE_W / 2);
    const dir = side < 0 || l.back === 0 ? 1 : -1;
    for (let u = 20; u < length - 20; u += BIKE_EVERY)
      bike(new Frame(u, vc, dir, white));
  }
  return white.length ? [{ color: 'white', tris: white }] : [];
}
