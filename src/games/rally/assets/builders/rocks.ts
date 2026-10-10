import { Color, IcosahedronGeometry, type BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { displaceRadial, paint } from '../../engine/geo';
import { getMaterial } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/** Rock tones: limestone, granite, sandstone, dark basalt. One per seed, so a field of rocks is not one grey. */
const STONES = ['#b8b0a0', '#8f8a82', '#b09a78', '#6e6c6a', '#8a7058'];

/** The rock texture is a mid grey that multiplies the vertex colour, so lift the stone tones to keep rocks readable. */
const LIFT = 1.4;

/**
 * Displaced icospheres, faceted shading. Moss only on gentle upward faces, in patches, never the whole top.
 * The foot is darkened (fake occlusion where the rock meets the ground) and the underside is dark.
 */
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
  const out = paint(g, rng.pick(STONES), rng, 0.06);
  // Moss tint on up-facing faces, spherical-ish UVs for the rock texture.
  const n = out.getAttribute('normal');
  const c = out.getAttribute('color');
  const uv = out.getAttribute('uv');
  const mossC = new Color('#5f6e3e');
  const mp = rng.next() * 10;
  for (let i = 0; i < n.count; i++) {
    const px = p.getX(i);
    const py = p.getY(i);
    const pz = p.getZ(i);
    // Patchy moss on gentle upward faces: a coarse noise gates it.
    const up = Math.max(0, n.getY(i) - 0.7) / 0.3;
    const patch = Math.max(
      0,
      Math.sin((px * 3.1) / radius + mp) *
        Math.sin((pz * 2.7) / radius - mp) *
        1.6 +
        0.2,
    );
    const k = Math.min(1, up * patch) * moss;
    // Dark foot + underside: ground contact occlusion.
    const foot = Math.min(
      1,
      Math.max(0, (py + radius * 0.25) / (radius * 0.6)),
    );
    const under = 0.55 + 0.45 * Math.min(1, Math.max(0, n.getY(i) + 0.4) / 0.8);
    const dark = (0.5 + 0.5 * foot) * under * LIFT;
    c.setXYZ(
      i,
      (c.getX(i) * (1 - k) + mossC.r * k) * dark,
      (c.getY(i) * (1 - k) + mossC.g * k) * dark,
      (c.getZ(i) * (1 - k) + mossC.b * k) * dark,
    );
    uv.setXY(i, (px + pz * 0.6) / radius, (py + pz * 0.4) / radius);
  }
  return out;
}

export const rockBoulder: AssetBuilder = ({ seed, lod }) => ({
  parts: [
    {
      geometry: rock(seed, 1, lod === 0 ? 2 : 1, 0.45),
      material: getMaterial('rock'),
    },
  ],
});

export const rockSmall: AssetBuilder = ({ seed }) => ({
  parts: [
    { geometry: rock(seed, 0.22, 0, 0.2), material: getMaterial('rock') },
  ],
});
