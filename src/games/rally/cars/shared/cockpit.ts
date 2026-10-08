import {
  CylinderGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { box, mergeAll, rbox } from './car-parts';
import { slab } from './profile-body';
import type { CarProfile } from './types';

/**
 * Procedural cockpit for an imported car whose GLB has none (`gltf.addOns.cockpit`), seen through its tinted glass:
 * seats, dash and steering wheel ('road'), plus a roll cage ('rally'). Placed from the car's boxy profile
 * (profile-body.ts): the greenhouse gives the windscreen base, beltline, roof and tumblehome (`glassWidth`). A dark
 * back-face-only tub (floor up to the beltline, clear of the wheel arches) closes the cabin below the windows, so
 * through a window you see the far door's inside, not the ground through the single-sided body. Left-hand drive.
 * Model space, DOM-free.
 */
export interface CockpitGeometry {
  /** Dash, wheel (and road seats). */
  interior: BufferGeometry;
  /** Rally seat shells + cage tubes (light). */
  cage: BufferGeometry;
  /** Back-face-only cabin tub (floor, door insides, firewall, rear bulkhead). */
  lining: BufferGeometry;
}

/** Cabin floor height (m). */
const FLOOR = 0.3;
/** Cage tubes / tub sides stand this far inside the glass (m). */
const INSET = 0.08;

export function buildCockpit(
  profile: CarProfile,
  style: 'road' | 'rally',
): CockpitGeometry {
  const g = profile.glass;
  const n = g.length / 2;
  const pt = (i: number): [number, number] => [
    g[2 * (i % n)],
    g[2 * (i % n) + 1],
  ];
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < n; i++) {
    if (pt(i)[0] < pt(lo)[0]) lo = i;
    if (pt(i)[0] > pt(hi)[0]) hi = i;
  }
  // Counter-clockwise: rear -> front along the bottom (beltline), front -> rear along the top (roof).
  const chain = (from: number, to: number) => {
    const out = [pt(from)];
    for (let i = from; i % n !== to % n; i++) out.push(pt(i + 1));
    return out;
  };
  const bottom = chain(lo, hi);
  const top = chain(hi, lo + n);
  const at = (c: [number, number][], z: number) => {
    const s = [...c].sort((a, b) => a[0] - b[0]);
    if (z <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++)
      if (z <= s[i][0]) {
        const [z0, y0] = s[i - 1];
        const [z1, y1] = s[i];
        return y0 + ((z - z0) / (z1 - z0 || 1)) * (y1 - y0);
      }
    return s[s.length - 1][1];
  };
  const belt = (z: number) => at(bottom, z);
  const roof = (z: number) => at(top, z);
  const zWs = pt(hi)[0];
  const zBack = pt(lo)[0];
  const hw = profile.width / 2;

  // Tub: floor -> beltline (2 cm under the glass), stepping up over the wheel arches (wheel radius + 6 cm).
  const archTop = 2 * profile.wheel + 0.06;
  const arch = profile.wheel + 0.1;
  const floorAt = (z: number) =>
    profile.axles.some((a) => Math.abs(z - a) < arch) ? archTop : FLOOR;
  const zs0 = zBack + 0.05;
  const zs1 = zWs - 0.05;
  const steps = [
    zs1,
    ...profile.axles.flatMap((a) => [a + arch, a - arch]),
    zs0,
  ]
    .filter((z) => z >= zs0 && z <= zs1)
    .sort((a, b) => b - a);
  const floor: number[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const y = floorAt((steps[i] + steps[i + 1]) / 2);
    floor.push(steps[i], y, steps[i + 1], y);
  }
  const beltLine: number[] = [];
  for (let z = zs0; z < zs1; z += 0.1) beltLine.push(z, belt(z) - 0.02);
  beltLine.push(zs1, belt(zs1) - 0.02);
  const lining = slab(
    [...floor, ...beltLine],
    profile.glassWidth[0] - 2 * INSET,
  );

  const interior: BufferGeometry[] = [];
  const cage: BufferGeometry[] = [];
  const sd = belt(zWs - 0.25);
  interior.push(
    box(
      Math.min(1.3, profile.glassWidth[0] - 0.25),
      0.08,
      0.3,
      0,
      sd - 0.03,
      zWs - 0.3,
    ),
  );
  const wheel = new TorusGeometry(0.15, 0.016, 6, 20);
  wheel.rotateX(-0.45);
  wheel.translate(Math.min(0.34, hw * 0.4), sd + 0.08, zWs - 0.5);
  interior.push(wheel.toNonIndexed());
  wheel.dispose();

  // Bucket seats: back + side bolsters + cushion.
  const zs = Math.max(zBack + 0.35, zWs - 1.25);
  const sb = belt(zs) - 0.22;
  const seats = style === 'rally' ? cage : interior;
  for (const side of [1, -1]) {
    const x = side * Math.min(0.34, hw * 0.4);
    seats.push(rbox(0.44, 0.52, 0.1, 0.035, x, sb, zs, -0.22));
    for (const s2 of [1, -1])
      seats.push(
        box(0.07, 0.16, 0.17, x + s2 * 0.19, sb + 0.15, zs + 0.03, -0.22),
      );
    seats.push(rbox(0.44, 0.09, 0.42, 0.03, x, sb - 0.3, zs + 0.25));
  }

  if (style === 'rally') {
    const tube = (a: Vector3, b: Vector3, r = 0.02) => {
      const t = new CylinderGeometry(r, r, a.distanceTo(b), 6, 1, true);
      t.applyQuaternion(
        new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          b.clone().sub(a).normalize(),
        ),
      );
      const mid = a.clone().add(b).multiplyScalar(0.5);
      t.translate(mid.x, mid.y, mid.z);
      cage.push(t.toNonIndexed());
      t.dispose();
    };
    // Tubes follow the tumblehome: belt width at the beltline, roof width under the roof.
    const [wb, wr] = profile.glassWidth;
    const xAt = (y: number, z: number) => {
      const t = Math.min(
        1,
        Math.max(0, (y - belt(z)) / (roof(z) - belt(z) || 1)),
      );
      return (wb + (wr - wb) * t) / 2 - INSET;
    };
    const zh = zs - 0.12;
    const zA = zWs - 0.15;
    const zRF = zWs - 0.7;
    const zRR = zBack + 0.25;
    const low = (z: number, side: number) => {
      const y = Math.max(floorAt(z), belt(z) - 0.25);
      return new Vector3(side * xAt(y, z), y, z);
    };
    const high = (z: number, side: number) => {
      const y = roof(z) - 0.06;
      return new Vector3(side * xAt(y, z), y, z);
    };
    tube(high(zh, 1), high(zh, -1));
    tube(high(zRF, 1), high(zRF, -1));
    tube(high(zh, 1), low(zh, -1));
    for (const side of [1, -1]) {
      tube(low(zh, side), high(zh, side));
      tube(low(zA, side), high(zRF, side));
      tube(high(zRF, side), high(zh, side));
      tube(high(zh, side), low(zRR, side));
    }
  }
  return { interior: mergeAll(interior), cage: mergeAll(cage), lining };
}
