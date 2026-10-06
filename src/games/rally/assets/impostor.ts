import { BufferAttribute, BufferGeometry, Color } from 'three';
import { getMaterial } from '../engine/materials';
import type { BuiltAsset } from './types';

/**
 * Far-tree impostor (`LodSpec.impostor`): one flat diamond (2 triangles) the 'tree_impostor' material turns
 * towards the camera. Sized and coloured from the asset's previous LOD: bottom tip at the trunk foot, widest
 * where the crown is, top tip at the top; the crown's average vertex colour, darker at the foot.
 */
export function impostorOf(from: BuiltAsset): BuiltAsset {
  let maxY = 0;
  for (const p of from.parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  }
  let r = 0;
  let y = 0;
  let n = 0;
  const c = new Color(0, 0, 0);
  for (const p of from.parts) {
    const pos = p.geometry.getAttribute('position');
    const col = p.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < maxY * 0.35) continue; // the crown, not the trunk
      r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
      y += pos.getY(i);
      n++;
      if (col)
        c.setRGB(c.r + col.getX(i), c.g + col.getY(i), c.b + col.getZ(i));
    }
  }
  if (!n || c.r + c.g + c.b === 0) c.set(0x4d6a2a);
  else c.multiplyScalar(1 / n);
  const mid = n ? y / n : maxY * 0.6;
  // A crown's silhouette is a bit narrower than its widest vertex.
  const w = r * 0.9;
  const foot = c.clone().multiplyScalar(0.45);
  // bottom, right, top, left
  const pos = new Float32Array([0, 0, 0, w, mid, 0, 0, maxY, 0, -w, mid, 0]);
  const col = new Float32Array([
    foot.r,
    foot.g,
    foot.b,
    c.r,
    c.g,
    c.b,
    c.r * 1.08,
    c.g * 1.08,
    c.b * 1.08,
    c.r,
    c.g,
    c.b,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return { parts: [{ geometry: g, material: getMaterial('tree_impostor') }] };
}
