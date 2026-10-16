import {
  GONDOLA_PYLON_H,
  GONDOLA_ROPE_LAT,
  GONDOLA_ROPE_Y,
} from '../assets/builders/landmarks';
import type { AerialwayDef } from '../maps/shared/types';
import type { ScatterInstance } from './scatter';

/**
 * Cable cars (MapDef.aerialways): where the pylons stand and how tall they are, the two ropes (3D polylines hanging
 * in a parabola between the heads) and the static cabins on them. Pure (no scene), the world tests run it; the
 * drawing is world/aerialway-mesh.ts.
 */

export interface AerialwaySupport {
  x: number;
  z: number;
  /** Unit direction of the line through this support. */
  tx: number;
  tz: number;
  /** Station (rope enters the building) or pylon. */
  station: boolean;
  /** Instance scale of a pylon (unit = GONDOLA_PYLON_H m). */
  scale: number;
  /** Ground height under the support. */
  ground: number;
  /** Rope height (absolute) at this support. */
  head: number;
}

export interface AerialwayCabin {
  x: number;
  y: number;
  z: number;
  /** Yaw of the cabin (rad, three.js): its long side along the rope. */
  rotY: number;
}

export interface AerialwayLayout {
  supports: AerialwaySupport[];
  /** Two ropes, flat [x, y, z, ...]: left and right of the line (looking up the line). */
  ropes: number[][];
  /** Arc length (m) at every rope vertex (index = vertex), per rope. */
  ropeS: [number[], number[]];
  /** The cabins at time 0 (`cabinPose` moves them). */
  cabins: AerialwayCabin[];
  /** The loop the cabins run on: up rope 0, down rope 1; `length` = both ropes, `spacing` between cabins, speed in m/s. */
  loop: { length: number; spacing: number; count: number; speed: number };
}

/** Sag (m) of a rope span: ~2 m for a 125 m span, ~15 m for 350 m. */
export const ropeSag = (span: number): number => (span * span) / 7500;

/** Cabin hanger length (m, rope -> cabin roof). */
export const HANGER = 2.4;

export function aerialwayLayout(
  def: AerialwayDef,
  ground: (x: number, z: number) => number,
): AerialwayLayout {
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < def.line.length; i += 2)
    pts.push([def.line[i], def.line[i + 1]]);
  // Cumulative distance along the polyline.
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
    );
  const total = cum[cum.length - 1];
  const at = (s: number) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dz) || 1;
    return {
      x: pts[i - 1][0] + dx * t,
      z: pts[i - 1][1] + dz * t,
      tx: dx / L,
      tz: dz / L,
    };
  };
  const every = def.pylonEvery ?? 125;
  const stationH = def.stationHeight ?? 7;
  const clearance = def.clearance ?? 8;
  // Where the supports stand along the line (arc length): even spacing, or the line's own vertices (+ fill-ins for long spans).
  const stops: number[] = [0];
  if (def.pylonsAtVertices) {
    const maxSpan = def.maxSpan ?? 400;
    const marks = [...cum.slice(1, -1), total];
    for (const s of marks) {
      const base = stops[stops.length - 1];
      const gap = s - base;
      const m = Math.max(1, Math.ceil(gap / maxSpan));
      for (let j = 1; j <= m; j++) stops.push(base + (gap * j) / m);
    }
  } else {
    const n = Math.max(1, Math.round(total / every));
    for (let k = 1; k <= n; k++) stops.push((total * k) / n);
  }
  const supports: AerialwaySupport[] = [];
  for (let k = 0; k < stops.length; k++) {
    const p = at(stops[k]);
    const station = k === 0 || k === stops.length - 1;
    const g = ground(p.x, p.z);
    supports.push({
      ...p,
      station,
      scale: 1,
      ground: g,
      head: g + (station ? stationH : GONDOLA_ROPE_Y),
    });
  }
  // Lift a pylon (up to 2x) until every rope span clears the ground mid-span.
  const span = (a: AerialwaySupport, b: AerialwaySupport) =>
    Math.hypot(b.x - a.x, b.z - a.z);
  const clear = (a: AerialwaySupport, b: AerialwaySupport): number => {
    const L = span(a, b);
    const sag = ropeSag(L);
    let worst = Infinity;
    // Mid-span only: next to a station the rope is low by design (it starts at the station's low head).
    for (let i = 5; i <= 7; i++) {
      const t = i / 12;
      const y = a.head + (b.head - a.head) * t - 4 * sag * t * (1 - t);
      worst = Math.min(
        worst,
        y - ground(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t),
      );
    }
    return worst;
  };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 1; i < supports.length - 1; i++) {
      const s = supports[i];
      const worst = Math.min(
        clear(supports[i - 1], s),
        clear(s, supports[i + 1]),
      );
      if (worst < clearance && s.scale < 2) {
        s.scale = Math.min(2, s.scale + (clearance - worst) / GONDOLA_PYLON_H);
        s.head = s.ground + GONDOLA_ROPE_Y * s.scale;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Ropes: parabolas between the heads, offset sideways (the line's left normal = (tz, -tx)).
  const ropes: number[][] = [[], []];
  for (let i = 0; i + 1 < supports.length; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    const L = span(a, b);
    const sag = ropeSag(L);
    const m = Math.max(2, Math.ceil(L / 12));
    const dx = (b.x - a.x) / L;
    const dz = (b.z - a.z) / L;
    // The ropes sit on the pylon head's wheels: wider on a taller (scaled) pylon.
    const latA = GONDOLA_ROPE_LAT * (a.station ? 1 : a.scale);
    const latB = GONDOLA_ROPE_LAT * (b.station ? 1 : b.scale);
    for (let r = 0; r < 2; r++) {
      const side = r === 0 ? 1 : -1;
      for (let j = i === 0 ? 0 : 1; j <= m; j++) {
        const t = j / m;
        const lat = side * (latA + (latB - latA) * t);
        ropes[r].push(
          a.x + (b.x - a.x) * t + dz * lat,
          a.head + (b.head - a.head) * t - 4 * sag * t * (1 - t),
          a.z + (b.z - a.z) * t - dx * lat,
        );
      }
    }
  }
  // Arc length along each rope, for the cabins.
  const ropeS = ropes.map((rp) => {
    const s = [0];
    for (let i = 3; i < rp.length; i += 3)
      s.push(
        s[s.length - 1] +
          Math.hypot(
            rp[i] - rp[i - 3],
            rp[i + 1] - rp[i - 2],
            rp[i + 2] - rp[i - 1],
          ),
      );
    return s;
  }) as [number[], number[]];
  // The loop: up rope 0, round the top station, down rope 1, round the bottom station.
  const ropeLen = Math.min(
    ropeS[0][ropeS[0].length - 1],
    ropeS[1][ropeS[1].length - 1],
  );
  const cabinEvery = def.cabinEvery ?? 117;
  const length = 2 * ropeLen;
  const count = Math.max(2, Math.floor(length / cabinEvery));
  const loop = {
    length,
    spacing: length / count,
    count,
    speed: def.speed ?? 5,
  };
  const layout: AerialwayLayout = { supports, ropes, ropeS, cabins: [], loop };
  for (let i = 0; i < count; i++)
    layout.cabins.push(cabinPose(layout, i * loop.spacing));
  return layout;
}

/**
 * Where a cabin is `u` metres round the loop (u wraps; 0 = the bottom station, `loop.length / 2` = the top): the point on the
 * rope it hangs from, lowered by the hanger, facing along the rope.
 */
export function cabinPose(layout: AerialwayLayout, u: number): AerialwayCabin {
  const { length } = layout.loop;
  const half = length / 2;
  const w = ((u % length) + length) % length;
  // Up on rope 0 for the first half, down on rope 1 for the second (arc length measured from the bottom station).
  const r = w < half ? 0 : 1;
  const s = r === 0 ? w : length - w;
  const S = layout.ropeS[r];
  const rp = layout.ropes[r];
  let lo = 0;
  let hi = S.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = Math.min(1, Math.max(0, (s - S[lo]) / (S[hi] - S[lo] || 1)));
  const a = lo * 3;
  const b = hi * 3;
  const dx = rp[b] - rp[a];
  const dz = rp[b + 2] - rp[a + 2];
  return {
    x: rp[a] + dx * t,
    y: rp[a + 1] + (rp[b + 1] - rp[a + 1]) * t - HANGER,
    z: rp[a + 2] + dz * t,
    rotY: -Math.atan2(dz, dx),
  };
}

/** Pylon instances (y = ground), turned so local +X runs along the line. */
export function pylonInstances(layout: AerialwayLayout): ScatterInstance[] {
  return layout.supports
    .filter((s) => !s.station)
    .map((s) => ({
      asset: 'gondola_pylon',
      variant: 0,
      x: s.x,
      y: s.ground - 0.3,
      z: s.z,
      rotY: -Math.atan2(s.tz, s.tx),
      scale: s.scale,
      tiltX: 0,
      tiltZ: 0,
    }));
}
