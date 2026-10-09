import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import { ALL_CARS } from '../../src/games/rally/cars';
import type { CarDef } from '../../src/games/rally/cars/shared/types';
import { autoHull } from '../../src/games/rally/physics/hull';

/**
 * The collision hull follows the real body (`bodyHull` in physics/hull.ts): in the
 * front overhang, between the axles and in the rear overhang the hull's underside is within a few cm of the model's
 * lowest point, and the nose / tail reach the bumpers. Before this the Bimmer's hull sat at 0.29 m under 0.11 m
 * bumpers - it could never scrape. Prints each car's profile (read `LowSphere.bottom` values off it for a new car).
 */
type P = [number, number, number];

/** Body vertices in model space (y = 0 = ground at the standard ride height, z forward). */
function bodyPoints(car: CarDef): P[] | null {
  const m = car.model;
  // The shipped body: the imported GLB when its file exists, else the hand-built body (a car can have both - the
  // custom body is then only the fallback for a missing file).
  const gltfFile = m.gltf && `public/models/cars/${m.gltf.file}`;
  if (m.custom && !(gltfFile && existsSync(gltfFile))) {
    const b = m.custom.build();
    const pts: P[] = [];
    for (const g of [b.paint, ...Object.values(b.parts)]) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++)
        pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    }
    return pts;
  }
  const file = `public/models/cars/${m.gltf?.file}`;
  if (!m.gltf || !existsSync(file)) return null;
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const bin = buf.subarray(20 + jsonLen + 8);
  const pts: P[] = [];
  // The model's runtime offset (a car whose centre of mass is not at the model's axle midpoint, cars/shared/com-shift.ts).
  const dz = m.gltf.offset?.[2] ?? 0;
  for (const mesh of gltf.meshes)
    for (const prim of mesh.primitives) {
      const a = gltf.accessors[prim.attributes.POSITION];
      const bv = gltf.bufferViews[a.bufferView];
      const stride = bv.byteStride ?? 12;
      const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i = 0; i < a.count; i++) {
        const o = off + i * stride;
        pts.push([
          bin.readFloatLE(o),
          bin.readFloatLE(o + 4),
          bin.readFloatLE(o + 8) + dz,
        ]);
      }
    }
  return pts;
}

describe.each(ALL_CARS.map((c) => c.id))('%s', (carId) => {
  test('hull underside and ends follow the body', () => {
    const car = ALL_CARS.find((c) => c.id === carId)!;
    const p = car.physics;
    const pts = bodyPoints(car);
    expect(pts).not.toBeNull();
    const hull = p.hull ?? autoHull(p);
    // Hull underside above flat ground at z (sphere bottoms, model space = + comHeight).
    const hullLow = (z: number) => {
      let y = Infinity;
      for (const [, hy, hz, r] of hull) {
        const dz = Math.abs(z - hz);
        if (dz < r) y = Math.min(y, hy - Math.sqrt(r * r - dz * dz));
      }
      return y + p.comHeight;
    };
    const zs = pts!.map(([, , z]) => z);
    // reduce, not spread: a model with a cockpit has more vertices than an argument list can hold
    const zMin = zs.reduce((a, b) => Math.min(a, b), Infinity);
    const zMax = zs.reduce((a, b) => Math.max(a, b), -Infinity);
    const r = p.wheelRadius + 0.05;
    const zones: [string, number, number][] = [
      ['front overhang', p.front.z + r, zMax - 0.04],
      ['between axles', p.rear.z + r, p.front.z - r],
      ['rear overhang', zMin + 0.04, p.rear.z - r],
    ];
    const rows: string[] = [];
    for (const [name, a, b] of zones) {
      let body = Infinity;
      for (const [, y, z] of pts!)
        if (z >= a && z <= b) body = Math.min(body, y);
      let h = Infinity;
      for (let z = a; z <= b; z += 0.02) h = Math.min(h, hullLow(z));
      rows.push(`${name}: body ${body.toFixed(3)} hull ${h.toFixed(3)} m`);
      // Never below the body (a phantom scrape), at most 3 cm above it (the low body must exist in the physics).
      expect(h).toBeGreaterThan(body - 0.015);
      expect(h).toBeLessThan(body + 0.03);
    }
    // Nose and tail reach the bumpers (within 6 cm, not poking past them by more than that).
    let front = -Infinity;
    let rear = Infinity;
    for (const [, , hz, hr] of hull) {
      front = Math.max(front, hz + hr);
      rear = Math.min(rear, hz - hr);
    }
    rows.push(
      `ends: body ${zMin.toFixed(2)}..${zMax.toFixed(2)} hull ${rear.toFixed(2)}..${front.toFixed(2)}`,
    );
    console.info(`[${carId}] ${rows.join(' | ')}`);
    expect(Math.abs(front - zMax)).toBeLessThan(0.06);
    expect(Math.abs(rear - zMin)).toBeLessThan(0.06);
  });
});
