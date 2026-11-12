import { describe, expect, test } from '@rstest/core';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
} from 'three';
import { fireTruckModel } from '../../src/games/rally/assets/builders/fire-truck-models';
import { FIRE_TRUCK_DATA } from '../../src/games/rally/assets/builders/fire-trucks.data';
import { vehicleModel } from '../../src/games/rally/assets/builders/street-car-models';
import { STREET_CAR_DATA } from '../../src/games/rally/assets/builders/street-cars.data';
import {
  roundWheels,
  type TriangleSoup,
} from '../../src/games/rally/assets/builders/wheel-rounding';

/**
 * Near-LOD wheels of the baked vehicles get more sides (wheel-rounding.ts): only the wheels change, the new points
 * are on the wheel's own circles, no seam opens, and the other LODs stay as baked.
 */
const soupOf = (parts: BufferGeometry[]): TriangleSoup => {
  const pos: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  for (const part of parts) {
    const g = part.toNonIndexed();
    pos.push(...g.getAttribute('position').array);
    normal.push(...g.getAttribute('normal').array);
    uv.push(...g.getAttribute('uv').array);
  }
  return {
    pos: new Float32Array(pos),
    normal: new Float32Array(normal),
    uv: new Float32Array(uv),
  };
};

const geometryOf = (soup: TriangleSoup): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(soup.pos, 3));
  return g;
};

/**
 * Seams in a mesh: three open edges (one triangle each, positions welded) that close a loop without being a triangle,
 * which is what an edge split on one side only leaves behind.
 */
function cracks(g: BufferGeometry): number {
  const pos = g.getAttribute('position').array;
  const n = pos.length / 3;
  const id = new Array<number>(n);
  const seen = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const key = [0, 1, 2]
      .map((k) => Math.round(pos[v * 3 + k] / 0.0005))
      .join();
    id[v] = seen.get(key) ?? (seen.set(key, v), v);
  }
  const count = new Map<string, number>();
  const faces = new Set<string>();
  const edge = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const face = (a: number, b: number, c: number) =>
    [a, b, c].sort((x, y) => x - y).join(':');
  for (let v = 0; v < n; v += 3) {
    const [a, b, c] = [id[v], id[v + 1], id[v + 2]];
    if (a === b || b === c || c === a) continue;
    faces.add(face(a, b, c));
    for (const k of [edge(a, b), edge(b, c), edge(c, a)])
      count.set(k, (count.get(k) ?? 0) + 1);
  }
  const open = new Map<number, number[]>();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const [a, b] = k.split(':').map(Number);
    (open.get(a) ?? open.set(a, []).get(a)!).push(b);
    (open.get(b) ?? open.set(b, []).get(b)!).push(a);
  }
  let found = 0;
  for (const [a, list] of open)
    for (const b of list) {
      if (b < a) continue;
      for (const m of open.get(b)!)
        if (m > b && open.get(m)!.includes(a) && !faces.has(face(a, b, m)))
          found++;
    }
  return found;
}

describe('wheel rounding', () => {
  test('a 12-sided wheel becomes 24-sided, the body stays', () => {
    const R = 0.32;
    const wheel = new CylinderGeometry(R, R, 0.2, 12, 1)
      .rotateX(Math.PI / 2)
      .translate(1.2, R, 0.8);
    const body = new BoxGeometry(4, 1, 1.4).translate(0, 0.9, 0);
    const before = soupOf([body, wheel]);
    const after = roundWheels(before);
    const bodyCount = body.toNonIndexed().getAttribute('position').count;
    // The body comes first and is untouched.
    expect(Array.from(after.pos.slice(0, bodyCount * 3))).toEqual(
      Array.from(before.pos.slice(0, bodyCount * 3)),
    );
    expect(after.pos.length).toBeGreaterThan(before.pos.length);
    const angles = new Set<number>();
    for (let v = bodyCount; v < after.pos.length / 3; v++) {
      const x = after.pos[v * 3] - 1.2;
      const y = after.pos[v * 3 + 1] - R;
      const r = Math.hypot(x, y);
      // Cap centres aside, every point is on the tyre's circle.
      if (r < 0.01) continue;
      expect(r).toBeCloseTo(R, 4);
      angles.add(Math.round((Math.atan2(y, x) * 180) / Math.PI));
      const n = Math.hypot(
        after.normal[v * 3],
        after.normal[v * 3 + 1],
        after.normal[v * 3 + 2],
      );
      expect(n).toBeCloseTo(1, 4);
    }
    expect(angles.size).toBe(24);
  });

  test('a model without wheels is returned as it is', () => {
    const soup = soupOf([new BoxGeometry(2, 1, 1).translate(0, 0.5, 0)]);
    expect(roundWheels(soup)).toBe(soup);
  });

  test.each([
    ...STREET_CAR_DATA.map((d, i) => ['car', d.id, i] as const),
    ['fire', 'fire_truck', 0] as const,
  ])('%s %s: rounder at LOD 0 only, same size', (kind, _id, index) => {
    const list = kind === 'car' ? STREET_CAR_DATA : FIRE_TRUCK_DATA;
    // A copy of the list is cached apart: the model as baked.
    const baked = [...list];
    for (const lod of [0, 1]) {
      const a = vehicleModel(baked, index, lod).geometry('#ffffff');
      const b = vehicleModel(list, index, lod, true).geometry('#ffffff');
      const na = a.getAttribute('position').count;
      const nb = b.getAttribute('position').count;
      if (lod === 0) {
        expect(nb).toBeGreaterThan(na);
        // Only the rings of the wheels' outer half are split.
        expect(nb).toBeLessThan(na * 1.2);
        // No seam opens: an edge is split in every triangle on it or in none.
        expect(cracks(b)).toBe(cracks(a));
        // Every new normal has unit length (the model's own few degenerate triangles aside).
        const loose = (g: BufferGeometry): number => {
          const n = g.getAttribute('normal').array;
          let count = 0;
          for (let v = 0; v < n.length; v += 3)
            if (Math.abs(Math.hypot(n[v], n[v + 1], n[v + 2]) - 1) > 1e-3)
              count++;
          return count;
        };
        expect(loose(b)).toBe(loose(a));
      } else expect(nb).toBe(na);
      a.computeBoundingBox();
      b.computeBoundingBox();
      for (const k of ['x', 'y', 'z'] as const) {
        expect(b.boundingBox!.min[k]).toBeCloseTo(a.boundingBox!.min[k], 2);
        expect(b.boundingBox!.max[k]).toBeCloseTo(a.boundingBox!.max[k], 2);
      }
    }
  });

  test('a hub edge shared with the axle is not split', () => {
    const R = 0.32;
    const wheel = new CylinderGeometry(R, R, 0.2, 12, 1)
      .rotateX(Math.PI / 2)
      .translate(1.2, R, 0.8);
    // A hub that is one shell with its axle: rings at z 0.3 (under the car), 0.85 and 0.95 (the hub's outer end).
    const tube = (z0: number, z1: number) =>
      new CylinderGeometry(0.15, 0.15, z1 - z0, 12, 1, true)
        .rotateX(Math.PI / 2)
        .translate(1.2, R, (z0 + z1) / 2);
    const before = soupOf([wheel, tube(0.3, 0.85), tube(0.85, 0.95)]);
    const after = roundWheels(before);
    expect(cracks(geometryOf(before))).toBe(0);
    expect(cracks(geometryOf(after))).toBe(0);
    const sides = (z: number) => {
      const angles = new Set<number>();
      for (let v = 0; v < after.pos.length / 3; v++) {
        const x = after.pos[v * 3] - 1.2;
        const y = after.pos[v * 3 + 1] - R;
        if (
          Math.abs(after.pos[v * 3 + 2] - z) < 1e-4 &&
          Math.abs(Math.hypot(x, y) - 0.15) < 1e-3
        )
          angles.add(Math.round((Math.atan2(y, x) * 180) / Math.PI));
      }
      return angles.size;
    };
    // The outer end is rounded; the ring it shares with the axle's triangles keeps its corners.
    expect(sides(0.95)).toBe(24);
    expect(sides(0.85)).toBe(12);
  });

  test('the US fire engine: round hubs, the same on both sides; the other engine as baked', () => {
    const us = FIRE_TRUCK_DATA.findIndex((d) => d.id === 'fire_truck');
    const baked = vehicleModel([...FIRE_TRUCK_DATA], us, 0).geometry('#fff');
    const round = fireTruckModel('fire_truck', 0).geometry('#fff');
    // Edges that run round the axle on the hub (0.15 to 0.3 m out, on the wheel's outer face) with a step over 20 deg,
    // chords inside the flat hub face aside.
    const coarse = (g: BufferGeometry, cx: number, side: number): number => {
      const pos = g.getAttribute('position').array;
      const at = (v: number) => {
        const x = (pos[v * 3] - cx) / 1.015;
        const y = (pos[v * 3 + 1] - 0.641) / 0.985;
        return [Math.hypot(x, y), Math.atan2(y, x), pos[v * 3 + 2] * side];
      };
      let count = 0;
      for (let t = 0; t < pos.length / 9; t++)
        for (let k = 0; k < 3; k++) {
          const p = at(t * 3 + k);
          const q = at(t * 3 + ((k + 1) % 3));
          if (Math.abs(at(t * 3 + ((k + 2) % 3))[2] - p[2]) < 0.005) continue;
          if (Math.min(p[0], q[0]) < 0.15 || Math.max(p[0], q[0]) > 0.3)
            continue;
          if (Math.min(p[2], q[2]) < 1.1 || Math.abs(p[2] - q[2]) > 0.002)
            continue;
          if (Math.abs(p[0] - q[0]) > 0.006) continue;
          let turn = Math.abs(p[1] - q[1]);
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if (turn > (20 * Math.PI) / 180 && turn < (80 * Math.PI) / 180)
            count++;
        }
      return count;
    };
    for (const cx of [2.417, -2.36])
      for (const side of [1, -1]) {
        expect(coarse(baked, cx, side), `${cx} ${side}`).toBeGreaterThan(5);
        expect(coarse(round, cx, side), `${cx} ${side}`).toBe(0);
      }
    const mk = FIRE_TRUCK_DATA.findIndex((d) => d.id === 'fire_truck_mk');
    expect(
      fireTruckModel('fire_truck_mk', 0)
        .geometry('#fff')
        .getAttribute('position').count,
    ).toBe(
      vehicleModel([...FIRE_TRUCK_DATA], mk, 0)
        .geometry('#fff')
        .getAttribute('position').count,
    );
  });
});
