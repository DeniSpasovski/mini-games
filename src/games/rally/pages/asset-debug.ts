import {
  Box3,
  Box3Helper,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { ASSET_CATALOG, getAssetMeta, hasAsset } from '../assets/catalog';
import { buildAsset, variantSeed } from '../assets/library';
import type { BuiltAsset } from '../assets/types';
import { CarModel } from '../cars/shared/car-model';
import { CARS, getCar } from '../cars';
import { isTestCar, listLabel } from '../release';
import { CAMERA_LINK_DEFAULTS, ViewerShell } from '../debug/viewer-shell';
import {
  getTexture,
  TEXTURE_IDS,
  textureName,
  type TextureId,
} from '../engine/textures';

/**
 * Asset debugger: every procedural asset, car and texture in one list.
 *   asset-debug.html?asset=pine_tree&seed=42&lod=1&grid=10&wire=1&bounds=1&collider=1
 *   asset-debug.html?asset=tex:road&repeat=3
 *   asset-debug.html?asset=car:skoda_rally&seed=5
 * `seed=-1` uses the in-world variant seed for `variant`.
 * "Copy camera link" (Camera section) shares the exact view (`cam`, `look`, `fov`, `clean=1` hides the panel).
 */
const DEFAULTS = {
  asset: 'pine_tree',
  seed: -1,
  variant: 0,
  lod: 0,
  grid: 1,
  spacing: 0,
  wire: false,
  bounds: false,
  collider: false,
  turntable: false,
  repeat: 1,
  // Shared camera: cam / look / fov / clean (see "Copy camera link").
  ...CAMERA_LINK_DEFAULTS,
};
const state = readUrlState(DEFAULTS);
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);

const shell = new ViewerShell({ title: 'Asset debugger' });
const { scene, camera, controls } = shell;
const holder = new Group();
scene.add(holder);
let disposeCurrent: () => void = () => {};

// --- list ---------------------------------------------------------------------------
const items = [
  ...ASSET_CATALOG.map((a) => ({
    id: a.id,
    label: a.name,
    group: a.category,
    hint: a.description,
  })),
  ...CARS.map((c) => ({
    id: `car:${c.id}`,
    label: listLabel(c.name, isTestCar(c.id)),
    group: 'cars',
    hint: c.description,
  })),
  ...TEXTURE_IDS().map((t) => ({
    id: `tex:${t}`,
    label: textureName(t),
    group: 'textures',
    hint: t,
  })),
];
shell.panel.section('Assets').list(items, state.asset, (id) => {
  state.asset = id;
  state.lod = 0;
  ViewerShell.clearCameraLink(state); // the new asset is framed afresh
  sync(true);
  lodCtl.set('0');
  rebuild(true);
});

const vars = shell.panel.section('Variables');
vars.seed('Seed (-1 = variant)', state.seed, (v) => {
  state.seed = v;
  sync();
  rebuild();
});
const variantCtl = vars.slider(
  'Variant',
  state.variant,
  { min: 0, max: 7, step: 1 },
  (v) => {
    state.variant = v;
    sync();
    rebuild();
  },
);
const lodCtl = vars.select(
  'LOD',
  String(state.lod),
  ['0', '1', '2', '3'],
  (v) => {
    state.lod = Number(v);
    sync();
    rebuild();
  },
);
vars.slider(
  'Instances (N×N)',
  state.grid,
  { min: 1, max: 40, step: 1 },
  (v) => {
    state.grid = v;
    sync();
    rebuild();
  },
);
vars.slider(
  'Spacing (0=auto)',
  state.spacing,
  { min: 0, max: 20, step: 0.5 },
  (v) => {
    state.spacing = v;
    sync();
    rebuild();
  },
);
vars.slider(
  'Texture repeat',
  state.repeat,
  { min: 1, max: 8, step: 1 },
  (v) => {
    state.repeat = v;
    sync();
    rebuild();
  },
);
vars.checkbox('Wireframe', state.wire, (v) => {
  state.wire = v;
  sync();
  rebuild();
});
vars.checkbox('Bounds', state.bounds, (v) => {
  state.bounds = v;
  sync();
  rebuild();
});
vars.checkbox('Colliders', state.collider, (v) => {
  state.collider = v;
  sync();
  rebuild();
});
vars.checkbox('Turntable', state.turntable, (v) => {
  state.turntable = v;
  sync();
});

shell.addCameraShare(shell.panel.section('Camera'), state, sync);
const infoSec = shell.panel.section('Info');
const info = infoSec.info();
const desc = infoSec.html('');
shell.addSceneSection();
shell.panel
  .section('Help', false)
  .html(
    'Every asset shares geometry + material across instances (InstancedMesh). Use <b>Instances</b> to stress-test. <kbd>H</kbd> hides the panel, <kbd>F3</kbd> stats.',
  );

// --- build ---------------------------------------------------------------------------------
function frame(size: Vector3, center: Vector3): void {
  const r = Math.max(size.x, size.y, size.z) * 0.5 + 0.5;
  const span = state.grid > 1 ? spacingFor(size) * state.grid : 0;
  const d = r * 2.8 + span * 0.7;
  controls.target.copy(center);
  camera.position.set(
    center.x + d * 0.75,
    center.y + d * 0.45,
    center.z + d * 0.9,
  );
}

function spacingFor(size: Vector3): number {
  return state.spacing || Math.max(1.5, Math.max(size.x, size.z) * 1.4);
}

function rebuild(reframe = false): void {
  disposeCurrent();
  holder.clear();
  holder.rotation.set(0, 0, 0);
  const id = state.asset;
  if (id.startsWith('tex:'))
    return showTexture(id.slice(4) as TextureId, reframe);
  if (id.startsWith('car:')) return showCar(id.slice(4), reframe);
  if (!hasAsset(id)) return;
  const meta = getAssetMeta(id);
  const lod = Math.min(state.lod, meta.lods.length - 1);
  const seed =
    state.seed < 0
      ? variantSeed(id, state.variant % meta.variants)
      : state.seed;
  const t0 = performance.now();
  const built: BuiltAsset = buildAsset(
    id,
    seed,
    state.variant % meta.variants,
    lod,
  );
  const buildMs = performance.now() - t0;

  const n = state.grid;
  const box = new Box3();
  for (const part of built.parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox!);
  }
  const size = box.getSize(new Vector3());
  const spacing = spacingFor(size);
  const mats: Material[] = [];
  let tris = 0;
  for (const part of built.parts) {
    const mat = state.wire ? wireCopy(part.material) : part.material;
    if (mat !== part.material) mats.push(mat);
    const mesh = new InstancedMesh(part.geometry, mat, n * n);
    const m = new Matrix4();
    let i = 0;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        m.makeRotationY(n > 1 ? (x * 7 + z * 13) % 6.28 : 0).setPosition(
          (x - (n - 1) / 2) * spacing,
          0,
          (z - (n - 1) / 2) * spacing,
        );
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.castShadow = mesh.receiveShadow = true;
    holder.add(mesh);
    tris += triCount(part.geometry) * n * n;
  }
  if (state.bounds) holder.add(new Box3Helper(box, 0xffcc00));
  if (state.collider) addColliders(meta.colliders ?? []);

  info({
    id,
    category: meta.category,
    'seed used': seed,
    variant: `${state.variant % meta.variants} / ${meta.variants}`,
    lod: `${lod} (draw < ${meta.lods[lod].maxDistance} m${meta.lods[lod].castShadow ? ', shadows' : ''})`,
    lods: meta.lods.map((l) => l.maxDistance).join(' / ') + ' m',
    parts: built.parts
      .map((p) => (p.material as Material).name || p.material.type)
      .join(', '),
    'tris / instance': (tris / (n * n)).toLocaleString(),
    'tris total': tris.toLocaleString(),
    'draw calls': built.parts.length,
    size: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`,
    colliders:
      meta.colliders?.map((c) => `${c.kind} r${c.r}`).join(', ') ?? 'none',
    'build ms': buildMs.toFixed(1),
  });
  desc.textContent = meta.description;
  variantCtl.el.style.opacity = '1';
  if (reframe) frame(size, box.getCenter(new Vector3()));
  disposeCurrent = () => {
    for (const p of built.parts) p.geometry.dispose();
    for (const m of mats) m.dispose();
    holder.traverse((o) => o instanceof InstancedMesh && o.dispose());
  };
}

function addColliders(
  cols: NonNullable<ReturnType<typeof getAssetMeta>['colliders']>,
): void {
  const mat = new MeshBasicMaterial({ color: 0xff3366, wireframe: true });
  for (const c of cols) {
    const g =
      c.kind === 'cylinder'
        ? new CylinderGeometry(c.r, c.r, c.h ?? 1, 16).translate(
            0,
            (c.h ?? 1) / 2,
            0,
          )
        : new SphereGeometry(c.r, 16, 10);
    const mesh = new Mesh(g, mat);
    mesh.position.set(c.x ?? 0, c.y ?? 0, c.z ?? 0);
    holder.add(mesh);
  }
}

function showTexture(id: TextureId, reframe: boolean): void {
  const src = getTexture(id);
  const tex = src.clone();
  tex.repeat.set(state.repeat, state.repeat);
  tex.needsUpdate = true;
  const img = src.image as HTMLCanvasElement;
  const aspect = img.width / img.height;
  const mat = new MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.01,
    side: 2,
    roughness: 0.9,
  });
  const plane = new Mesh(new PlaneGeometry(4 * aspect, 4), mat);
  plane.position.y = 2.2;
  plane.castShadow = true;
  holder.add(plane);
  info({
    id,
    size: `${img.width} × ${img.height}`,
    colorSpace: src.colorSpace || 'linear',
    repeat: state.repeat,
  });
  desc.textContent =
    'Procedural canvas texture (engine/textures.ts). Shared by every material that uses it.';
  if (reframe) {
    controls.target.set(0, 2.2, 0);
    camera.position.set(0, 2.4, 7);
  }
  disposeCurrent = () => {
    plane.geometry.dispose();
    mat.dispose();
    tex.dispose();
  };
}

function showCar(carId: string, reframe: boolean): void {
  // Unknown / hidden (test-only, published build) ids fall back to the default car.
  const def = getCar(carId);
  const model = new CarModel(def, { seed: Math.max(0, state.seed) });
  model.root.position.y = def.physics.comHeight;
  holder.add(model.root);
  info({
    id: carId,
    triangles: model.triangleCount().toLocaleString(),
    livery: Math.max(0, state.seed),
  });
  desc.innerHTML = `${def.description}<br/><a style="color:#f0a020" href="car-viewer.html?car=${carId}&seed=${Math.max(0, state.seed)}">Open in car viewer →</a>`;
  if (reframe) frame(new Vector3(2, 1.5, 4.2), new Vector3(0, 0.7, 0));
  disposeCurrent = () => model.dispose();
}

function wireCopy(m: Material): Material {
  const c = m.clone();
  (c as MeshStandardMaterial).wireframe = true;
  return c;
}

function triCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

const q = new Quaternion();
const up = new Vector3(0, 1, 0);
shell.onFrame((dt) => {
  if (state.turntable)
    holder.quaternion.multiply(q.setFromAxisAngle(up, dt * 0.5));
});

rebuild(true);
// A shared camera link wins over the automatic framing.
shell.applyCameraLink(state);
