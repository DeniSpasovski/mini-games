import { Matrix4 } from 'three';
import { Rng } from '../../../../../shared/rng';
import {
  arc,
  FOOT,
  LIFT,
  PLINTH,
  ringWalls,
  WOOD,
  type Local,
  type V2,
  type V3,
} from './common';

/**
 * Two outposts on the Vodno hills: the observation tower on Abedishte (OSM node 4299022626) and Markovi Kuli, the
 * Byzantine fort ruins above Crnce (OSM node 3951819342, "Marky's towers").
 *
 * Tower: a timber lookout - four legs braced with crosses, a stair landing, a cabin with a pyramid roof - 11 m. Ruins:
 * a ring of rubble-stone wall stumps round a courtyard with three tower stumps; deterministic broken heights.
 */
const STEEL = '#8d9188';

/** A leaning strut between two points (a box 0.14 m thick). */
function strut(l: Local, a: V3, b: V3, t: number, color: string): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const ax = Math.atan2(Math.hypot(dx, dz), dy);
  const ay = Math.atan2(dx, dz);
  // A box along +Y, tipped onto the direction: rotate about X, then Y (the order power.ts uses).
  const m = new Matrix4()
    .makeRotationY(ay)
    .multiply(new Matrix4().makeRotationX(ax));
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  l.box('metal', [-t / 2, -len / 2, -t / 2], [t / 2, len / 2, t / 2], color, m);
}

export function buildLookout(l: Local): void {
  const H = 10.5;
  const base = 2.6;
  const top = 1.5;
  const half = (y: number): number => base + (top - base) * (y / H);
  const legs: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  const at = (i: number, y: number): V3 => [
    legs[i][0] * half(y),
    y,
    legs[i][1] * half(y),
  ];
  for (let i = 0; i < 4; i++) strut(l, at(i, FOOT), at(i, H), 0.22, WOOD);
  const levels = [0, 3.5, 7.0, H];
  for (let k = 0; k < levels.length; k++)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      strut(l, at(i, levels[k]), at(j, levels[k]), 0.14, WOOD);
      if (k + 1 < levels.length) {
        strut(l, at(i, levels[k]), at(j, levels[k + 1]), 0.1, WOOD);
        strut(l, at(j, levels[k]), at(i, levels[k + 1]), 0.1, WOOD);
      }
    }
  // The platform and its railing, the cabin above it with a pyramid roof.
  l.box('paint', [-1.9, H, -1.9], [1.9, H + 0.2, 1.9], WOOD);
  for (const s of [-1, 1]) {
    l.box(
      'paint',
      [s * 1.85 - 0.04, H + 0.2, -1.9],
      [s * 1.85 + 0.04, H + 1.1, 1.9],
      WOOD,
    );
    l.box(
      'paint',
      [-1.9, H + 0.2, s * 1.85 - 0.04],
      [1.9, H + 1.1, s * 1.85 + 0.04],
      WOOD,
    );
  }
  l.box('paint', [-1.3, H + 0.2, -1.3], [1.3, H + 2.6, 1.3], '#a8895f');
  const o = 0.5;
  const apex: V3 = [0, H + 4.0 + LIFT, 0];
  const c: V2[] = [
    [-1.3 - o, -1.3 - o],
    [1.3 + o, -1.3 - o],
    [1.3 + o, 1.3 + o],
    [-1.3 - o, 1.3 + o],
  ];
  for (let i = 0; i < 4; i++)
    l.roof(
      [
        [c[i][0], H + 2.6 + LIFT, c[i][1]],
        [c[(i + 1) % 4][0], H + 2.6 + LIFT, c[(i + 1) % 4][1]],
        apex,
      ],
      { trim: [0] },
    );
  // A stair flight up one face: steps between the two legs.
  for (let i = 0; i < 14; i++) {
    const y = 0.7 + i * 0.7;
    l.box(
      'paint',
      [half(y) - 0.9, y, -0.5],
      [half(y) + 0.55, y + 0.08, 0.5],
      STEEL,
    );
  }
}

/** One broken piece of the courtyard wall: the segment a -> b (local metres), its footprint, its height. */
export interface RuinStump {
  a: V2;
  b: V2;
  quad: V2[];
  h: number;
}

/** The ruins' layout (deterministic): wall stumps, the three tower stumps [x, z, r, h] and fallen blocks. */
export function ruinsLayout(): {
  stumps: RuinStump[];
  towers: [number, number, number, number][];
  blocks: { x: number; z: number; s: number; h: number }[];
} {
  const rng = new Rng(2602);
  // Courtyard wall: an irregular ring (a 22 x 15 m rounded rectangle), broken into stumps of 0.8 .. 3.8 m.
  const ring: V2[] = [
    [-11, -6.5],
    [-3, -7.6],
    [6, -7.1],
    [11, -4],
    [11.6, 3],
    [7, 7.4],
    [-2, 7.9],
    [-9.5, 6.1],
    [-11.6, 0],
  ];
  const T = 1.3; // wall thickness
  const stumps: RuinStump[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    const parts = Math.max(2, Math.round(len / 2.4));
    for (let p = 0; p < parts; p++) {
      if (rng.chance(0.18)) continue; // a breach
      const t0 = p / parts;
      const t1 = (p + 1) / parts;
      const h = 0.8 + rng.next() * 3.0;
      const px0 = ax + (bx - ax) * t0;
      const pz0 = az + (bz - az) * t0;
      const px1 = ax + (bx - ax) * t1;
      const pz1 = az + (bz - az) * t1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      stumps.push({
        a: [px0, pz0],
        b: [px1, pz1],
        quad: [
          [px0 - nx * T, pz0 - nz * T],
          [px1 - nx * T, pz1 - nz * T],
          [px1 + nx * T, pz1 + nz * T],
          [px0 + nx * T, pz0 + nz * T],
        ],
        h,
      });
    }
  }
  const towers: [number, number, number, number][] = [
    [-11, -6.5, 2.6, 5.2],
    [11.2, -4, 2.4, 4.4],
    [7, 7.4, 2.5, 3.2],
  ];
  const blocks: { x: number; z: number; s: number; h: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const x = -7 + rng.next() * 14;
    const z = -3.5 + rng.next() * 7;
    const s = 0.5 + rng.next() * 0.7;
    blocks.push({ x, z, s, h: 0.3 + rng.next() * 0.4 });
  }
  return { stumps, towers, blocks };
}

export function buildRuins(l: Local): void {
  const { stumps, towers, blocks } = ruinsLayout();
  for (const { quad, h } of stumps) {
    ringWalls(l, quad, FOOT, h, 'rubble', '#cfc6b4');
    l.fan(
      'rubble',
      quad.map(([x, z]): V3 => [x, h, z]),
      '#b8ae9b',
      [0, 1, 0],
      (q) => [q[0], q[2]],
    );
  }
  // Three tower stumps on the corners: round, thicker and taller.
  for (const [cx, cz, r, h] of towers) {
    const pts = arc(cx, cz, r, 0, Math.PI * 2, 14).slice(0, -1);
    ringWalls(l, pts, FOOT, h, 'rubble', '#d3cab8');
    l.fan(
      'rubble',
      pts.map(([x, z]): V3 => [x, h, z]),
      '#b4aa97',
      [0, 1, 0],
      (q) => [q[0], q[2]],
    );
    ringWalls(
      l,
      pts.map(([x, z]): V2 => [cx + (x - cx) * 1.04, cz + (z - cz) * 1.04]),
      FOOT,
      0.5,
      'ashlar',
      PLINTH,
    );
  }
  // Fallen blocks in the courtyard.
  for (const { x, z, s, h } of blocks)
    l.box(
      'rubble',
      [x - s, FOOT + 0.8, z - s * 0.7],
      [x + s, h, z + s * 0.7],
      '#c3baa8',
    );
}
