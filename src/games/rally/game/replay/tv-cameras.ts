/**
 * Trackside "TV" cameras for replays (DOM-free, tested in node): one camera outside every big corner of the stage
 * road plus fillers along long straights, so the whole stage is covered by a chain of fixed cameras that pan with the
 * car. Placement tries a few spots (distance off the road, height, a little before / after the apex) and keeps the
 * one that sees most of its stretch of road over the terrain and past every tree crown, is not inside a crown and is
 * clear of every other leg of the road (hairpins).
 */
import { Vector3 } from 'three';
import { newRoadQuery, type Road } from '../../world/road';

export interface TvCamera {
  /** World position of the lens. */
  pos: Vector3;
  /** Stretch of stage road this camera films (m along the stage road). */
  from: number;
  to: number;
  /** Where the car is closest (corner apex / filler spot). */
  along: number;
  kind: 'corner' | 'straight';
  /** Side of the road (+1 = left of travel). */
  side: 1 | -1;
  /** Share of its stretch it sees (0..1). */
  seen: number;
}

export interface TvWorld {
  /** Ground height (terrain, decks). */
  heightAt(x: number, z: number): number;
  /** A tree crown / trunk, rock or building fills this point (optional: node tests without scatter). */
  solid?(x: number, y: number, z: number): boolean;
}

/** Window (m) over which a corner's heading change is measured. */
const WINDOW = 40;
/** Heading change over WINDOW that makes a "big corner" (rad, ~35°). */
const CORNER_TURN = 0.6;
/** Corners closer than this (m) share one camera (the sharper one). */
const MERGE = 90;
/** A camera films this far before / after its apex (m). */
const BEFORE = 90;
const AFTER = 45;
/** Straights longer than this (m) between corner cameras get filler cameras. */
const FILL_GAP = 170;
/** Uncovered stretches shorter than this (m) after placing are left to the other shots. */
const MIN_GAP = 40;
/** Car roof height above the road the cameras aim at (m). */
const CAR_H = 1.1;

const STEP = 4;

/** Heading (rad, unwrapped) along the road every STEP m from a to b. */
function headings(road: Road, a: number, b: number): Float64Array {
  const n = Math.max(2, Math.floor((b - a) / STEP) + 1);
  const out = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const s = road.at(a + i * STEP);
    let h = Math.atan2(s.tx, s.tz);
    if (i) {
      while (h - prev > Math.PI) h -= 2 * Math.PI;
      while (h - prev < -Math.PI) h += 2 * Math.PI;
    }
    out[i] = h;
    prev = h;
  }
  return out;
}

/** Big corners: along (m) of each apex and its signed turn (rad, + = left). */
export function findCorners(
  road: Road,
  start: number,
  finish: number,
): { along: number; turn: number }[] {
  const a0 = Math.max(0, start - 20);
  const b0 = Math.min(road.length, finish + 20);
  const h = headings(road, a0, b0);
  const half = Math.round(WINDOW / 2 / STEP);
  const turn = (i: number) =>
    h[Math.min(h.length - 1, i + half)] - h[Math.max(0, i - half)];
  const found: { along: number; turn: number }[] = [];
  for (let i = 1; i < h.length - 1; i++) {
    const t = turn(i);
    if (Math.abs(t) < CORNER_TURN) continue;
    // Local peak of the turn (ties: the first).
    if (
      Math.abs(t) < Math.abs(turn(i - 1)) ||
      Math.abs(t) <= Math.abs(turn(i + 1))
    )
      continue;
    // Heading atan2(tx, tz) is a rotation about +Y: it grows turning left (facing +Z, left is +X).
    found.push({ along: a0 + i * STEP, turn: t });
  }
  // Merge close apexes, keeping the sharper.
  const merged: { along: number; turn: number }[] = [];
  for (const c of found) {
    const last = merged[merged.length - 1];
    if (last && c.along - last.along < MERGE) {
      if (Math.abs(c.turn) > Math.abs(last.turn)) merged[merged.length - 1] = c;
    } else merged.push(c);
  }
  return merged.filter((c) => c.along >= start - 10 && c.along <= finish + 10);
}

const _q = newRoadQuery();

/** Road sample spacing of the visibility test (m). */
const SAMPLE = 6;

/**
 * What a camera at `cam` sees of the road stretch [from, to] over the terrain and past crowns: the share of samples
 * (`seen`) and the longest unbroken visible run (`runFrom` - `runTo`, m along): the camera films only that run.
 */
export function visibility(
  road: Road,
  w: TvWorld,
  cam: Vector3,
  from: number,
  to: number,
): { seen: number; runFrom: number; runTo: number } {
  let seen = 0;
  let n = 0;
  let run = 0;
  let best = { len: 0, from, to: from };
  for (let a = from; a <= to; a += SAMPLE) {
    const s = road.at(a);
    const tx = s.x;
    const ty = s.y + CAR_H;
    const tz = s.z;
    const d = Math.hypot(tx - cam.x, tz - cam.z);
    n++;
    let ok = d <= 260;
    const steps = Math.max(2, Math.ceil(d / 3));
    for (let k = 1; k < steps; k++) {
      const f = k / steps;
      const x = cam.x + (tx - cam.x) * f;
      const z = cam.z + (tz - cam.z) * f;
      const y = cam.y + (ty - cam.y) * f;
      if (w.heightAt(x, z) + 0.25 > y) {
        ok = false;
        break;
      }
    }
    if (ok && w.solid) {
      // Crowns and trunks along the line, every 1.5 m (not the last 2 m: the car's own spot on the road).
      const len = Math.hypot(d, ty - cam.y);
      const n2 = Math.ceil(len / 1.5);
      for (let k = 1; k < n2 && ok; k++) {
        const f = k / n2;
        if ((1 - f) * len < 2) break;
        if (
          w.solid(
            cam.x + (tx - cam.x) * f,
            cam.y + (ty - cam.y) * f,
            cam.z + (tz - cam.z) * f,
          )
        )
          ok = false;
      }
    }
    if (ok) {
      seen++;
      run++;
      if (run > best.len)
        best = { len: run, from: a - (run - 1) * SAMPLE, to: a };
    } else run = 0;
  }
  return {
    seen: n ? seen / n : 0,
    runFrom: Math.max(from, best.from - SAMPLE / 2),
    runTo: Math.min(to, best.to + SAMPLE / 2),
  };
}

/** Best spot for a camera filming around `along` from `side` (+1 = left of travel). */
function place(
  road: Road,
  w: TvWorld,
  along: number,
  side: 1 | -1,
  from: number,
  to: number,
  roads: Road[],
): { pos: Vector3; seen: number; from: number; to: number } | null {
  let best: {
    pos: Vector3;
    seen: number;
    from: number;
    to: number;
    score: number;
  } | null = null;
  for (const shift of [0, -15, 12]) {
    const s = road.at(along + shift);
    const lx = s.tz;
    const lz = -s.tx;
    // From the verge (a real trackside camera) out to the field.
    for (const off of [5, 9, 15, 24]) {
      const d = s.halfWidth + off;
      const x = s.x + lx * side * d;
      const z = s.z + lz * side * d;
      // Never on (or next to) any leg of a road: hairpins, crossings.
      if (
        roads.some((r) => {
          const q = r.query(x, z, _q);
          return q.found && q.distance < q.halfWidth + 3;
        })
      )
        continue;
      const g = w.heightAt(x, z);
      for (const h of [2.4, 4.5, 8]) {
        const pos = new Vector3(x, Math.max(g, s.y - 1) + h, z);
        // Not inside a crown (or with one right in front of the lens).
        if (
          w.solid &&
          (w.solid(pos.x, pos.y, pos.z) || w.solid(pos.x, pos.y - 1.5, pos.z))
        )
          continue;
        const vis = visibility(road, w, pos, from, to);
        // The unbroken run it sees counts; lower and nearer reads better on screen (small penalties).
        const seen = (vis.runTo - vis.runFrom) / Math.max(1, to - from);
        const score = seen - h * 0.012 - off * 0.004;
        if (!best || score > best.score)
          best = { pos, seen, from: vis.runFrom, to: vis.runTo, score };
      }
    }
  }
  return best && best.seen >= 0.45 ? best : null;
}

/** Every camera for the stage, in order along the road. */
export function planTvCameras(
  road: Road,
  start: number,
  finish: number,
  w: TvWorld,
  otherRoads: Road[] = [],
): TvCamera[] {
  const roads = [road, ...otherRoads];
  const cams: TvCamera[] = [];
  for (const c of findCorners(road, start, finish)) {
    // Outside of the corner: right of travel for a left-hander.
    const side: 1 | -1 = c.turn > 0 ? -1 : 1;
    const from = Math.max(start - 30, c.along - BEFORE);
    const to = Math.min(finish + 60, c.along + AFTER);
    const spot =
      place(road, w, c.along, side, from, to, roads) ??
      place(road, w, c.along, side === 1 ? -1 : 1, from, to, roads);
    if (spot)
      cams.push({
        pos: spot.pos,
        from: spot.from,
        to: spot.to,
        along: c.along,
        kind: 'corner',
        side,
        seen: spot.seen,
      });
  }
  // Fillers: straights longer than FILL_GAP between the cameras (and from the start, to the finish).
  const fills: TvCamera[] = [];
  let side: 1 | -1 = 1;
  // Gaps: [start, first camera's from], [each camera's to, the next's from], [last to, finish].
  const edges = [
    start - 30,
    ...cams.flatMap((c) => [c.from, c.to]),
    finish + 60,
  ];
  for (let k = 0; k + 1 < edges.length; k += 2) {
    const gapFrom = edges[k];
    const gapTo = edges[k + 1];
    const gap = gapTo - gapFrom;
    if (gap < FILL_GAP * 0.6) continue;
    const n = Math.max(1, Math.round(gap / FILL_GAP));
    const len = gap / n;
    for (let i = 0; i < n; i++) {
      const from = gapFrom + i * len;
      const to = from + len;
      // The camera stands near the end of its stretch: the car drives towards it, then past.
      const along = from + len * 0.7;
      const spot =
        place(road, w, along, side, from, to, roads) ??
        place(road, w, along, side === 1 ? -1 : 1, from, to, roads);
      if (spot)
        fills.push({
          pos: spot.pos,
          from: spot.from,
          to: spot.to,
          along,
          kind: 'straight',
          side,
          seen: spot.seen,
        });
      side = side === 1 ? -1 : 1;
    }
  }
  // A camera films only what it sees unbroken: two more passes put cameras on the stretches still uncovered.
  const all = [...cams, ...fills];
  for (let pass = 0; pass < 2; pass++) {
    const added: TvCamera[] = [];
    for (const [gapFrom, gapTo] of uncovered(all, start - 30, finish + 60)) {
      if (gapTo - gapFrom < MIN_GAP) continue;
      const from = gapFrom - 15;
      const to = gapTo + 15;
      const along = from + (to - from) * 0.7;
      const sd = side;
      side = side === 1 ? -1 : 1;
      const spot =
        place(road, w, along, sd, from, to, roads) ??
        place(road, w, along, side, from, to, roads);
      if (spot)
        added.push({
          pos: spot.pos,
          from: spot.from,
          to: spot.to,
          along,
          kind: 'straight',
          side: sd,
          seen: spot.seen,
        });
    }
    if (!added.length) break;
    all.push(...added);
  }
  return all.sort((a, b) => a.from - b.from);
}

/** Stretches of road in [a, b] no camera films. */
function uncovered(cams: TvCamera[], a: number, b: number): [number, number][] {
  const sorted = [...cams].sort((x, y) => x.from - y.from);
  const out: [number, number][] = [];
  let at = a;
  for (const c of sorted) {
    if (c.from > at) out.push([at, Math.min(b, c.from)]);
    at = Math.max(at, c.to);
    if (at >= b) break;
  }
  if (at < b) out.push([at, b]);
  return out;
}

/** The camera to film the car at `along` (m): the one whose stretch holds it, nearest its own spot. */
export function cameraFor(cams: TvCamera[], along: number): TvCamera | null {
  let best: TvCamera | null = null;
  let bd = Infinity;
  for (const c of cams) {
    if (along < c.from || along > c.to) continue;
    const d = Math.abs(along - c.along);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
