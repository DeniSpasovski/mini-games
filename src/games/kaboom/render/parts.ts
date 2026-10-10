import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise2D } from '../../../shared/noise';
import { PALETTE } from './materials';

/**
 * Procedural clay models, one merged geometry each (vertex colours = the paint job), so every kind of block is one
 * InstancedMesh. Local space: centred on the cell in xz, standing on y = 0 (the top of the floor tiles).
 */
const noise = new Noise2D(2024);

interface PartOpts {
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Yaw in radians. */
  ry?: number;
  /** Strength of the smooth colour noise (0 = flat paint). */
  tint?: number;
  /** Push vertices along their normal by a noise amount (lumpy rocks, mounds). */
  lumpy?: number;
}

/** Transform, paint and de-index one primitive so it can be merged with others. */
export function part(
  geo: BufferGeometry,
  hex: number,
  o: PartOpts = {},
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  if (o.ry) g.rotateY(o.ry);
  g.translate(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const base = new Color(hex);
  const tint = o.tint ?? 0.1;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (o.lumpy) {
      const n = noise.noise2(x * 4.1 + z * 2.3, y * 4.7 + 0.3);
      pos.setXYZ(
        i,
        x + nor.getX(i) * n * o.lumpy,
        y + nor.getY(i) * n * o.lumpy,
        z + nor.getZ(i) * n * o.lumpy,
      );
    }
    const f = 1 + tint * noise.noise2(x * 3.3 + z * 1.9, y * 3.1 + z * 0.7);
    c.copy(base).multiplyScalar(f);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (o.lumpy) g.computeVertexNormals();
  return g;
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('kaboom: could not merge geometries');
  for (const p of parts) p.dispose();
  return g;
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r: number, seg = 1) =>
  new RoundedBoxGeometry(w, h, d, seg, r);
const rock = (r: number, detail = 1) => new IcosahedronGeometry(r, detail);

/** Floor tile: a flat rounded slab, top on y = 0. Tinted per instance. */
export function tileGeometry(): BufferGeometry {
  return box(0.97, 0.16, 0.97).translate(0, -0.08, 0);
}

/** Hard block 0: a granite boulder with two small rocks at its feet. */
export function boulderGeometry(): BufferGeometry {
  return merge([
    part(rock(0.55, 2), PALETTE.granite, {
      y: 0.46,
      sy: 0.92,
      lumpy: 0.09,
      tint: 0.12,
    }),
    part(rock(0.2, 0), PALETTE.graniteDark, {
      x: 0.36,
      y: 0.14,
      z: 0.34,
      lumpy: 0.04,
    }),
    part(rock(0.15, 0), PALETTE.graniteDark, {
      x: -0.38,
      y: 0.1,
      z: 0.3,
      lumpy: 0.03,
    }),
  ]);
}

/** Hard block 1: a stone pillar propped with timber beams. */
export function postGeometry(): BufferGeometry {
  return merge([
    part(rbox(0.8, 1.1, 0.8, 0.1), PALETTE.post, { y: 0.55, tint: 0.1 }),
    part(rbox(0.96, 0.14, 0.96, 0.05), PALETTE.postCap, { y: 1.15 }),
    part(box(1.04, 0.12, 0.16), PALETTE.timber, { y: 0.9, tint: 0.14 }),
    part(box(0.16, 0.12, 1.04), PALETTE.timber, { y: 0.66, tint: 0.14 }),
    part(box(0.9, 0.12, 0.9), PALETTE.graniteDark, { y: 0.06 }),
  ]);
}

/** Crate 0: a wooden crate with corner posts, bands and a cross plank. */
export function woodCrateGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(rbox(0.8, 0.8, 0.8, 0.06), PALETTE.crate, { y: 0.42, tint: 0.1 }),
    part(box(0.88, 0.1, 0.88), PALETTE.crateBand, { y: 0.2 }),
    part(box(0.88, 0.1, 0.88), PALETTE.crateBand, { y: 0.64 }),
    part(box(0.07, 0.08, 0.7), PALETTE.crateDark, { y: 0.83, x: 0.12 }),
    part(box(0.07, 0.08, 0.7), PALETTE.crateDark, { y: 0.83, x: -0.12 }),
  ];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(
        part(box(0.11, 0.84, 0.11), PALETTE.crateDark, {
          x: sx * 0.4,
          z: sz * 0.4,
          y: 0.42,
        }),
      );
  return merge(p);
}

/** Crate 1: a dirt mound with pebbles and a tuft of grass. */
export function moundGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(rock(0.5, 2), PALETTE.dirt, {
      y: 0.32,
      sx: 1.12,
      sy: 0.8,
      sz: 1.12,
      lumpy: 0.08,
      tint: 0.16,
    }),
    part(rock(0.1, 0), PALETTE.pebble, { x: 0.3, y: 0.18, z: 0.38 }),
    part(rock(0.08, 0), PALETTE.pebble, { x: -0.34, y: 0.16, z: 0.36 }),
    part(rock(0.07, 0), PALETTE.pebble, { x: 0.4, y: 0.12, z: -0.25 }),
  ];
  for (const [x, z, h] of [
    [0, 0.02, 0.3],
    [0.1, -0.06, 0.22],
    [-0.1, -0.02, 0.26],
  ])
    p.push(
      part(new ConeGeometry(0.05, h, 5), PALETTE.grass, {
        x,
        z,
        y: 0.62 + h / 2 - 0.1,
      }),
    );
  return merge(p);
}

/** The plate the tiles lie on: `w x h` cells plus `pad` all round, its top just under the tiles. */
export function floorGeometry(
  w: number,
  h: number,
  pad: number,
): BufferGeometry {
  return merge([
    part(rbox(w + pad * 2, 0.5, h + pad * 2, 0.18), PALETTE.slab[0], {
      y: -0.1 - 0.25,
      tint: 0.18,
    }),
  ]);
}

export interface DecorParts {
  body: BufferGeometry;
  /** Lantern bulbs (drawn unlit). */
  bulbs: BufferGeometry;
}

/**
 * Quarry decor on the slab margin around the arena (never inside it): mine-cart rails along the front edge with a cart,
 * barrels, rocks, and a lantern post at each corner.
 */
export function decorGeometry(w: number, h: number, pad: number): DecorParts {
  const p: BufferGeometry[] = [];
  const bulbs: BufferGeometry[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const mz = hh + pad * 0.5; // middle of the front margin

  // rails + sleepers along the front
  for (const dz of [-0.2, 0.2])
    p.push(
      part(box(w + pad, 0.07, 0.07), PALETTE.rail, { z: mz + dz, y: 0.1 }),
    );
  for (let x = -hw; x <= hw; x += 0.55)
    p.push(
      part(box(0.16, 0.05, 0.62), PALETTE.timber, {
        x,
        z: mz,
        y: 0.04,
        tint: 0.2,
      }),
    );

  // a mine cart on the rails
  const cx = hw * 0.35;
  p.push(
    part(rbox(0.9, 0.42, 0.55, 0.05), PALETTE.rail, { x: cx, z: mz, y: 0.42 }),
    part(rbox(0.8, 0.12, 0.45, 0.03), PALETTE.graniteDark, {
      x: cx,
      z: mz,
      y: 0.64,
    }),
  );
  for (const dx of [-0.3, 0.3])
    for (const dz of [-0.22, 0.22])
      p.push(
        part(
          new CylinderGeometry(0.11, 0.11, 0.06, 10).rotateX(Math.PI / 2),
          PALETTE.postCap,
          {
            x: cx + dx,
            z: mz + dz,
            y: 0.14,
          },
        ),
      );

  // barrels + rocks on the back and side margins
  const back = -hh - pad * 0.5;
  for (const [x, z, s] of [
    [-hw * 0.5, back, 1],
    [-hw * 0.5 + 0.42, back + 0.05, 0.85],
    [hw * 0.55, back, 1],
  ] as const)
    p.push(
      part(
        new CylinderGeometry(0.2 * s, 0.22 * s, 0.5 * s, 10),
        PALETTE.timber,
        { x, z, y: 0.25 * s, tint: 0.2 },
      ),
      part(new CylinderGeometry(0.225 * s, 0.225 * s, 0.05, 10), PALETTE.rail, {
        x,
        z,
        y: 0.2 * s,
      }),
    );
  for (const [x, z, r] of [
    [-hw - pad * 0.5, -hh * 0.4, 0.28],
    [-hw - pad * 0.45, hh * 0.3, 0.2],
    [hw + pad * 0.5, hh * 0.45, 0.3],
    [hw + pad * 0.5, -hh * 0.5, 0.2],
  ] as const)
    p.push(
      part(rock(r, 1), PALETTE.granite, {
        x,
        z,
        y: r * 0.6,
        sy: 0.8,
        lumpy: r * 0.2,
      }),
    );

  // lantern posts at the four corners of the margin
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (hw + pad * 0.5);
      const z = sz * (hh + pad * 0.5);
      p.push(
        part(box(0.1, 1.25, 0.1), PALETTE.timber, { x, z, y: 0.62 }),
        part(box(0.3, 0.06, 0.3), PALETTE.rail, { x, z, y: 1.3 }),
        part(rbox(0.3, 0.02, 0.3, 0.01), PALETTE.rail, { x, z, y: 1.02 }),
      );
      bulbs.push(
        part(rbox(0.2, 0.26, 0.2, 0.05), PALETTE.lantern, {
          x,
          z,
          y: 1.16,
          tint: 0,
        }),
      );
    }
  return { body: merge(p), bulbs: merge(bulbs) };
}
