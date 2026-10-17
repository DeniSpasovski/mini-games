import { Box3, BufferGeometry, type Matrix4, Mesh, Vector3 } from 'three';

/** A mesh's vertices in body space and which of them share a spot (the triangles of one lamp piece are joined). */
export interface Welded {
  /** Body-space position of each vertex, 3 numbers. */
  xyz: Float32Array;
  /** Representative vertex of the piece that vertex `i` belongs to. */
  find: (i: number) => number;
  /** Vertex index of corner `c` of triangle `t`. */
  corner: (t: number, c: number) => number;
  /** Triangle count. */
  count: number;
}

/**
 * Vertices at the same spot welded (a mesh may repeat them for its UV seams), then each triangle's corners joined: the
 * pieces are the triangles that share vertices. `toBody` = world -> body matrix (the mesh's matrix world must be current).
 */
export function weld(mesh: Mesh, toBody: Matrix4): Welded {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const index = geo.index;
  const n = pos.count;
  const m = toBody.clone().multiply(mesh.matrixWorld);
  const v = new Vector3();
  const xyz = new Float32Array(n * 3);
  const first = new Map<string, number>();
  const root = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
      .applyMatrix4(m)
      .toArray(xyz, i * 3);
    const k = `${Math.round(xyz[i * 3] * 1e4)},${Math.round(xyz[i * 3 + 1] * 1e4)},${Math.round(xyz[i * 3 + 2] * 1e4)}`;
    let r = first.get(k);
    if (r === undefined) first.set(k, (r = i));
    root[i] = r;
  }
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = root[root[i]];
    return i;
  };
  const count = (index ? index.count : n) / 3;
  const corner = (t: number, c: number): number =>
    index ? index.getX(t * 3 + c) : t * 3 + c;
  for (let t = 0; t < count; t++) {
    const a = find(corner(t, 0));
    for (let c = 1; c < 3; c++) root[find(corner(t, c))] = a;
  }
  return { xyz, find, corner, count };
}

/** A lamp piece on the car's centre line counts as the third brake light up to this offset / width (metres). */
const CENTRE_X = 0.12;
const CENTRE_WIDTH = 0.9;

/** `geo` with only the triangles `tris` (own copies of its attributes, so it can be disposed on its own). */
function subset(geo: BufferGeometry, tris: number[]): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of Object.keys(geo.attributes))
    out.setAttribute(name, geo.getAttribute(name).clone());
  out.setIndex(tris);
  out.computeBoundingSphere();
  return out;
}

/**
 * The third brake light (a high-mount strip, a small bumper lamp): pieces of `mesh` that sit on the car's centre line are
 * moved into a new mesh next to it (same parent and transform), so it can have its own material that lights only with the
 * brake. When the whole mesh is such a piece it is returned as it is. `null` = no centre piece.
 */
export function splitCentreLamp(mesh: Mesh, toBody: Matrix4): Mesh | null {
  const w = weld(mesh, toBody);
  const boxes = new Map<number, Box3>();
  const v = new Vector3();
  const roots: number[] = [];
  for (let t = 0; t < w.count; t++) {
    const r = w.find(w.corner(t, 0));
    roots.push(r);
    let box = boxes.get(r);
    if (!box) boxes.set(r, (box = new Box3()));
    for (let c = 0; c < 3; c++) {
      const i = w.corner(t, c) * 3;
      box.expandByPoint(v.set(w.xyz[i], w.xyz[i + 1], w.xyz[i + 2]));
    }
  }
  const centre = new Set<number>();
  for (const [r, box] of boxes) {
    const size = box.getSize(v);
    if (
      Math.abs((box.min.x + box.max.x) / 2) < CENTRE_X &&
      size.x < CENTRE_WIDTH
    )
      centre.add(r);
  }
  if (!centre.size) return null;
  if (centre.size === boxes.size) return mesh;
  const mine: number[] = [];
  const rest: number[] = [];
  for (let t = 0; t < w.count; t++)
    (centre.has(roots[t]) ? mine : rest).push(
      w.corner(t, 0),
      w.corner(t, 1),
      w.corner(t, 2),
    );
  const part = new Mesh(subset(mesh.geometry, mine), mesh.material);
  part.name = `${mesh.name}_centre`;
  part.position.copy(mesh.position);
  part.quaternion.copy(mesh.quaternion);
  part.scale.copy(mesh.scale);
  part.renderOrder = mesh.renderOrder;
  part.castShadow = mesh.castShadow;
  part.receiveShadow = mesh.receiveShadow;
  part.frustumCulled = mesh.frustumCulled;
  part.layers.mask = mesh.layers.mask;
  mesh.parent?.add(part);
  mesh.geometry = subset(mesh.geometry, rest);
  return part;
}
