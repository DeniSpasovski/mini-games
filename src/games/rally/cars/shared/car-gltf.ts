import { Box3, Mesh, Vector3, type Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarDef } from './types';

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
