import { Color, IcosahedronGeometry, type BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { displaceRadial, paint } from '../../engine/geo';
import { GROUND_SCAN } from '../../engine/ground-textures';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/** Rock scan size (m): the texture keeps the scale it has on the ground. */
const SCAN = GROUND_SCAN.rock;

/** Displaced icospheres wearing the terrain's rock scan, faceted shading, moss on upward faces. */
function rock(
  seed: number,
  radius: number,
  detail: number,
  moss: number,
): BufferGeometry {
  const rng = new Rng(seed);
  const g = new IcosahedronGeometry(radius, detail); // non-indexed already
  const p1 = rng.next() * 10;
  const p2 = rng.next() * 10;
  displaceRadial(
    g,
    (x, y, z) =>
      (Math.sin((x * 2.3) / radius + p1) *
        Math.sin((z * 1.9) / radius + (y * 1.3) / radius + p2) *
        0.22 +
        Math.sin((x * 5.1) / radius - (z * 4.3) / radius + p2) * 0.07) *
      radius,
  );
  g.scale(rng.range(1.0, 1.5), rng.range(0.6, 0.9), rng.range(0.9, 1.3));
  g.rotateY(rng.next() * Math.PI);
  // Flatten the underside so it sits on the ground.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -radius * 0.25)
      p.setY(i, -radius * 0.25 + (y + radius * 0.25) * 0.25);
  }
  g.computeVertexNormals();
  // Near white: the scan carries the rock colour, the vertex colour only varies it.
  const out = paint(g, rng.pick(['#f2f0ea', '#e6e2d8', '#fbf6ec']), rng, 0.06);
  // Moss tint on up-facing faces; box-mapped UVs (each face projected along its main axis, so the scan never stretches).
  const n = out.getAttribute('normal');
  const c = out.getAttribute('color');
  const uv = out.getAttribute('uv');
  const mossC = new Color('#8fa05a');
  for (let i = 0; i < n.count; i++) {
    const up = Math.max(0, n.getY(i) - 0.55) / 0.45;
    const k = up * moss;
    c.setXYZ(
      i,
      c.getX(i) * (1 - k) + mossC.r * k,
      c.getY(i) * (1 - k) + mossC.g * k,
      c.getZ(i) * (1 - k) + mossC.b * k,
    );
    const px = p.getX(i);
    const py = p.getY(i);
    const pz = p.getZ(i);
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, px / SCAN, pz / SCAN);
    else if (ax >= az) uv.setXY(i, pz / SCAN, py / SCAN);
    else uv.setXY(i, px / SCAN, py / SCAN);
  }
  return out;
}

export const rockBoulder: AssetBuilder = ({ seed, lod }) => ({
  parts: [
    {
      geometry: rock(seed, 1, lod === 0 ? 2 : 1, 0.7),
      material: getMaterial('rock'),
    },
  ],
});

export const rockSmall: AssetBuilder = ({ seed }) => ({
  parts: [
    { geometry: rock(seed, 0.22, 1, 0.2), material: getMaterial('rock') },
  ],
});
