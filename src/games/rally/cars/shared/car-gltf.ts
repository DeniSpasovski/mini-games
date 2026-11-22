import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  Mesh,
  Raycaster,
  Vector3,
  type Matrix4,
  type Group,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { wheelAt, wheelAxis } from './cockpit';
import type { CarDef, CarGltfRecolor, Cockpit } from './types';

/**
 * Imported car models (glTF/GLB) - e.g. Sketchfab downloads - living in
 * public/models/cars/. The file list is baked in at build time
 * (__CAR_MODEL_FILES__), so we never request missing files.
 *
 * The GLB is loaded once per file and cloned per car (geometry/materials are
 * shared). It is auto-fitted to the car's physics: length matched, centred between
 * the axles (fine-tune with `offset`), wheels hidden (physics-driven procedural wheels are used) -
 * unless `autoFit: false` (file already in model space, e.g. from stl-to-glb.mjs).
 * The build serves them meshopt-compressed (scripts/car-model/glb-meshopt.mjs); plain files load too.
 */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<Group>>();

export function hasImportedModel(def: CarDef): boolean {
  const g = def.model.gltf;
  return !!g && __CAR_MODEL_FILES__.includes(g.file);
}

/** Load a file from public/models/cars/ once (cached; callers clone what they keep). */
export function loadCarModelFile(file: string): Promise<Group> {
  let p = cache.get(file);
  if (!p) {
    // Built into the rally folder (dist/games/rally/models/cars, rsbuild.config.ts gamePublicFiles),
    // next to the pages -> the game stays self-contained and works in subfolders too.
    const url = new URL(`models/cars/${file}`, location.href).href;
    p = loader.loadAsync(url).then((g) => g.scene);
    cache.set(file, p);
  }
  return p;
}

/** Start downloading a car's GLB (no-op without one): the stage loader calls it while the map data loads. */
export function preloadCarModel(def: CarDef): void {
  if (hasImportedModel(def))
    void loadCarModelFile(def.model.gltf!.file).catch(() => {});
}

const DEFAULT_HIDE = 'wheel|tire|tyre|rim|brake|caliper|disc';

/** Load + clone + fit. Resolves to an object in car model space (y = 0 ground, z = 0 COM). */
export async function loadImportedCar(def: CarDef): Promise<Object3D> {
  const g = def.model.gltf!;
  const src = await loadCarModelFile(g.file);
  const obj = src.clone(true);
  const hide = new RegExp(g.hideNodes ?? DEFAULT_HIDE, 'i');
  obj.traverse((o) => {
    if (o.name && hide.test(o.name)) o.visible = false;
    if ((o as Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  obj.rotation.y = g.rotationY ?? 0;
  if (g.autoFit === false) {
    if (g.offset) obj.position.set(...g.offset);
    if (g.scale) obj.scale.setScalar(g.scale);
    return obj;
  }
  obj.updateMatrixWorld(true);

  // Length / centring from the visible body; ground from everything (tyre bottoms).
  const box = new Box3();
  const all = new Box3();
  obj.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const b = new Box3().setFromObject(o, true);
    all.union(b);
    let visible = true;
    for (let p: Object3D | null = o; p; p = p.parent) visible &&= p.visible;
    if (visible) box.union(b);
  });
  box.min.y = all.min.y;
  const size = box.getSize(new Vector3());
  const scale = g.scale ?? def.physics.length / Math.max(size.z, 1e-3);
  obj.scale.multiplyScalar(scale);
  const centreZ = (def.physics.front.z + def.physics.rear.z) / 2;
  const c = box.getCenter(new Vector3()).multiplyScalar(scale);
  const o = g.offset ?? [0, 0, 0];
  obj.position.set(
    -c.x + o[0],
    -box.min.y * scale + o[1],
    centreZ - c.z + o[2],
  );
  return obj;
}

/**
 * Cut the triangles of `mesh` whose centroid lies in `r.box` out into a new mesh (same attributes, own index; the source
 * geometry is shared between cars, so it is never edited). `mesh` keeps the rest. Returns undefined if nothing matched.
 */
export function splitRecolor(mesh: Mesh, r: CarGltfRecolor): Mesh | undefined {
  const [x0, x1, y0, y1, z0, z1] = r.box;
  mesh.updateMatrix();
  return splitBy(mesh, mesh.matrix, (v) => {
    const x = r.absX ? Math.abs(v.x) : v.x;
    return (
      x >= x0 && x <= x1 && v.y >= y0 && v.y <= y1 && v.z >= z0 && v.z <= z1
    );
  });
}

/**
 * Cut the triangles of `mesh` whose centroid (through `matrix`) passes `take` out into a new mesh beside it (same
 * attributes, own index: the geometry is shared between cars and never edited). Undefined if nothing matched.
 */
export function splitBy(
  mesh: Mesh,
  matrix: Matrix4,
  take: (centroid: Vector3) => boolean,
): Mesh | undefined {
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as BufferAttribute;
  const src = g.index;
  const n = src ? src.count : pos.count;
  const taken: number[] = [];
  const kept: number[] = [];
  const v = new Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    const t = [0, 1, 2].map((k) => (src ? src.getX(i + k) : i + k));
    v.set(0, 0, 0);
    for (const j of t) {
      v.x += pos.getX(j);
      v.y += pos.getY(j);
      v.z += pos.getZ(j);
    }
    v.divideScalar(3).applyMatrix4(matrix);
    (take(v) ? taken : kept).push(...t);
  }
  if (!taken.length) return undefined;
  const index = (a: number[]) => {
    const out = new BufferGeometry();
    for (const k of Object.keys(g.attributes))
      out.setAttribute(k, g.attributes[k]);
    out.setIndex(a);
    return out;
  };
  mesh.geometry = index(kept);
  const piece = new Mesh(index(taken), mesh.material);
  piece.castShadow = mesh.castShadow;
  piece.receiveShadow = mesh.receiveShadow;
  piece.position.copy(mesh.position);
  piece.quaternion.copy(mesh.quaternion);
  piece.scale.copy(mesh.scale);
  mesh.parent?.add(piece);
  return piece;
}

/**
 * The steering wheel of a cockpit model brought back to the driver (`wheel.pull`): its triangles (rim, spokes, hub) are
 * cut out of the model's parts and moved along the column. Returns the column to draw, from the wheel's hub to the dash
 * (the model's own column when the wheel was pulled off it; `wheel.column`: the model has none), or undefined.
 * `obj` is the loaded model before it is added to the car, so its world space is the cockpit's model space.
 */
export function fitWheel(
  obj: Object3D,
  cp: Cockpit,
): { from: Vector3; to: Vector3 } | undefined {
  const pull = cp.wheel.pull ?? 0;
  if (!pull && !cp.wheel.column) return undefined;
  obj.updateMatrixWorld(true);
  const at = new Vector3(...cp.wheel.at);
  const axis = wheelAxis(cp);
  const meshes: Mesh[] = [];
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.visible && m.userData.partName !== 'glass')
      meshes.push(m);
  });
  const d = new Vector3();
  const moved: Mesh[] = [];
  if (pull)
    for (const m of meshes) {
      const piece = splitBy(m, m.matrixWorld, (c) => {
        d.copy(c).sub(at);
        const along = d.dot(axis);
        return (
          along > -WHEEL_DEPTH &&
          along < WHEEL_DEPTH &&
          d.addScaledVector(axis, -along).length() < cp.wheel.r + WHEEL_GRIP
        );
      });
      if (!piece) continue;
      piece.userData.partName = m.userData.partName;
      const p = piece.parent ?? obj;
      const a = p.worldToLocal(new Vector3());
      const b = p.worldToLocal(axis.clone().multiplyScalar(-pull));
      piece.position.add(b.sub(a));
      moved.push(piece);
    }
  // The column: from the back of the (moved) hub forward to whatever the model has there (its column or the dash).
  const from = wheelAt(cp).addScaledVector(axis, 0.03);
  const start = at.clone().addScaledVector(axis, WHEEL_DEPTH);
  const ray = new Raycaster(start, axis, 0, 0.6);
  const hit = ray.intersectObjects(
    meshes.filter((m) => !moved.includes(m)),
    false,
  )[0];
  const to = start.addScaledVector(axis, (hit?.distance ?? 0.2) + 0.01);
  return { from, to };
}

/** How far a steering wheel reaches either side of its rim's plane (hub, spokes, rim), and past the rim (m). */
const WHEEL_DEPTH = 0.05;
const WHEEL_GRIP = 0.03;

/**
 * Both front seats of a cockpit model lowered by `seat.drop`: the triangles of the cushions and backrests (and head
 * rests) are cut out of the model's parts and moved down. What is under a seat (frame, rails, floor) stays, below the
 * lowered cushion. `obj`: the loaded model before it is added to the car (world space = cockpit model space).
 */
export function fitSeats(obj: Object3D, cp: Cockpit): void {
  const drop = cp.seat.drop ?? 0;
  if (!drop) return;
  obj.updateMatrixWorld(true);
  const { x, cushion, back } = cp.seat;
  const [z0, y0, z1, y1] = back;
  const backZ = (y: number): number => z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
  const low = Math.max(cp.floor + 0.03, cushion - drop - 0.02);
  const seated = (c: Vector3): boolean => {
    if (Math.abs(Math.abs(c.x) - x) > SEAT_HALF || c.y < low) return false;
    const b = backZ(Math.max(c.y, y0));
    // The cushion, from behind the backrest's foot to its front edge; the backrest along its line, up to the head rest.
    if (c.y < cushion + 0.1) return c.z > b - 0.13 && c.z < z0 + SEAT_LONG;
    return c.y < y1 + 0.3 && c.z > b - 0.15 && c.z < b + 0.12;
  };
  const meshes: Mesh[] = [];
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.visible && m.userData.partName !== 'glass')
      meshes.push(m);
  });
  for (const m of meshes) {
    const piece = splitBy(m, m.matrixWorld, seated);
    if (!piece) continue;
    piece.userData.partName = m.userData.partName;
    const p = piece.parent ?? obj;
    const a = p.worldToLocal(new Vector3());
    const b = p.worldToLocal(new Vector3(0, -drop, 0));
    piece.position.add(b.sub(a));
  }
}

/** Half the width of a front seat, and its cushion's length from the backrest (m). */
const SEAT_HALF = 0.26;
const SEAT_LONG = 0.56;
