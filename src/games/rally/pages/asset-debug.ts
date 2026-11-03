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
import { loadSimready } from '../assets/builders/simready';
import type { BuiltAsset } from '../assets/types';
import { CarModel } from '../cars/shared/car-model';
import { CARS, getCar } from '../cars';
import { isTestCar, listLabel } from '../release';
import {
  CAMERA_LINK_DEFAULTS,
  showViewerLoading,
  VIEWER_HOUR,
  ViewerShell,
} from '../debug/viewer-shell';
import { paramOneOf } from '../../../shared/url-params';
import { offeredWeathers } from '../weather';
import {
  getTexture,
  TEXTURE_IDS,
  textureName,
  type TextureId,
} from '../engine/textures';
import { TreeRenderer } from '../trees/draw';
import { TreeLibrary } from '../trees/load';
import { placeTree } from '../trees/placement';
import { speciesOfType, TREE_TYPES, variantCount } from '../trees/species';
import { DEFAULT_SEASON, SEASONS, seasonParam } from '../season';
import type { RoadQuery } from '../world/road';
import type { ScatterChunk, ScatterInstance } from '../world/scatter';
import type { World } from '../world/world';

/**
 * Asset debugger: every procedural asset, car and texture in one list.
 *   asset-debug.html?asset=rock_boulder&seed=42&lod=1&grid=10&wire=1&bounds=1&collider=1
 *   asset-debug.html?asset=tex:road&repeat=3
 *   asset-debug.html?asset=car:skoda_rally&seed=5
 *   asset-debug.html?asset=tree:oak_tree&variant=2&season=autumn&grid=3
 * `seed=-1` uses the in-world variant seed for `variant`.
 * "Copy camera link" (Camera section) shares the exact view (`cam`, `look`, `fov`, `clean=1` hides the panel).
 * The Options section shows only the controls the picked kind uses (`showOptions`); hidden ones keep their URL value.
 */
const DEFAULTS = {
  asset: 'rock_boulder',
  seed: -1,
  variant: 0,
  lod: 0,
  grid: 1,
  spacing: 0,
  wire: false,
  bounds: false,
  collider: false,
  turntable: false,
  /** Trees: leaf sprites drawn (off: the wood alone, to see what the sprays hang on). */
  leaves: true,
  repeat: 1,
  /** Trees: leaf colours of this season. */
  season: DEFAULT_SEASON as string,
  /** Weather and hour of day (`Environment` reads `?weather=` / `?tod=`), as in the car viewer. */
  weather: 'dry',
  tod: VIEWER_HOUR,
  // Shared camera: cam / look / fov / clean (see "Copy camera link").
  ...CAMERA_LINK_DEFAULTS,
};
const state = readUrlState(DEFAULTS);
state.weather = paramOneOf(state.weather, offeredWeathers(), DEFAULTS.weather);
/** Half size of the sun's shadow box (m) for trees: a tall poplar and its evening shadow. */
const TREE_SHADOW_EXTENT = 40;
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);

const isTree = (id: string) => id.startsWith('tree:');
type AssetKind = 'asset' | 'car' | 'tree' | 'tex';
const kindOf = (id: string): AssetKind =>
  id.startsWith('tex:')
    ? 'tex'
    : id.startsWith('car:')
      ? 'car'
      : isTree(id)
        ? 'tree'
        : 'asset';
// A tree needs a bigger shadow box than a prop (set at load: switching between the two reloads the page).
const shell = new ViewerShell({
  title: 'Asset debugger',
  shadowExtent: isTree(state.asset) ? TREE_SHADOW_EXTENT : 12,
});
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
  ...Object.entries(TREE_TYPES).map(([type, species]) => ({
    id: `tree:${type}`,
    label: species,
    group: 'trees',
    hint: type,
  })),
  ...TEXTURE_IDS().map((t) => ({
    id: `tex:${t}`,
    label: textureName(t),
    group: 'textures',
    hint: t,
  })),
];
shell.panel.section('Assets').list(items, state.asset, (id) => {
  const reload = isTree(id) !== isTree(state.asset);
  state.asset = id;
  state.lod = 0;
  ViewerShell.clearCameraLink(state); // the new asset is framed afresh
  sync(true);
  if (reload) return location.reload();
  lodCtl.set('0');
  rebuild(true);
});

const vars = shell.panel.section('Options');
const seedCtl = vars.seed('Seed', state.seed, (v) => {
  state.seed = v;
  sync();
  rebuild();
});
const seedNote = vars.note('');
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
const gridCtl = vars.slider(
  'Instances N×N',
  state.grid,
  { min: 1, max: 40, step: 1 },
  (v) => {
    state.grid = v;
    sync();
    rebuild();
  },
);
const spacingCtl = vars.slider(
  'Gap (0 = auto)',
  state.spacing,
  { min: 0, max: 20, step: 0.5 },
  (v) => {
    state.spacing = v;
    sync();
    rebuild();
  },
);
const repeatCtl = vars.slider(
  'Repeat',
  state.repeat,
  { min: 1, max: 8, step: 1 },
  (v) => {
    state.repeat = v;
    sync();
    rebuild();
  },
);
const seasonCtl = vars.select('Season', state.season, [...SEASONS], (v) => {
  state.season = v;
  sync();
  rebuild();
});
const wireCtl = vars.checkbox('Wireframe', state.wire, (v) => {
  state.wire = v;
  sync();
  rebuild();
});
const boundsCtl = vars.checkbox('Bounds', state.bounds, (v) => {
  state.bounds = v;
  sync();
  rebuild();
});
const colliderCtl = vars.checkbox('Colliders', state.collider, (v) => {
  state.collider = v;
  sync();
  rebuild();
});
vars.checkbox('Turntable', state.turntable, (v) => {
  state.turntable = v;
  sync();
});
const leavesCtl = vars.checkbox('Leaves', state.leaves, (v) => {
  state.leaves = v;
  sync();
  showLeaves();
});

const infoSec = shell.panel.section('Info');
const desc = infoSec.html('');
const info = infoSec.info();
shell.addCameraShare(shell.panel.section('Camera'), state, sync);
// The car viewer's Scene section without its backdrop.
const sceneSec = shell.panel.section(
  'Scene',
  state.weather !== DEFAULTS.weather || state.tod !== VIEWER_HOUR,
);
shell.addWeatherAndTime(sceneSec, state, sync, {
  tod: VIEWER_HOUR,
  hour: VIEWER_HOUR,
});
if (offeredWeathers().length > 1)
  sceneSec.note('Changing weather reloads the page.');
shell.addSceneSection(false, sceneSec);
if (state.tod !== VIEWER_HOUR) shell.setHour(state.tod);
shell.addHelp(
  [['F6', 'next tree debug view (trees)']],
  [
    'Every asset shares geometry + material across instances (InstancedMesh): raise Instances to stress-test.',
  ],
);

/**
 * Only the controls the picked kind uses (the others keep their URL value): props = seed, variant, LOD,
 * instances, wire, bounds, colliders; trees = seed, variant, instances, season, leaves; cars = livery seed;
 * textures = repeat. `variants` / `lods` = the picked asset's counts.
 */
function showOptions(kind: AssetKind, variants = 1, lods = 1): void {
  const show = (ctl: { el: HTMLElement }, on: boolean) => (ctl.el.hidden = !on);
  const asset = kind === 'asset';
  const tree = kind === 'tree';
  show(seedCtl, kind !== 'tex');
  seedNote.hidden = kind === 'tex';
  seedNote.textContent =
    kind === 'car'
      ? 'The livery (0 and up).'
      : '-1 = the in-world seed of the variant.';
  show(variantCtl, (asset || tree) && variants > 1);
  variantCtl.setRange(0, Math.max(0, variants - 1));
  show(lodCtl, asset && lods > 1);
  lodCtl.el
    .querySelectorAll('option')
    .forEach((o, i) => (o.hidden = i >= lods));
  show(gridCtl, asset || tree);
  show(spacingCtl, asset || tree);
  show(repeatCtl, kind === 'tex');
  show(seasonCtl, tree);
  show(leavesCtl, tree);
  show(wireCtl, asset);
  show(boundsCtl, asset);
  show(colliderCtl, asset);
}

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

/** Removes the "Loading <asset>" plate of the asset being built (cars: their GLB, trees: their variants). */
let hideLoading = () => {};
const loadingPlate = (name: string) => {
  hideLoading();
  return (hideLoading = showViewerLoading(
    `Loading ${name} …`,
    shell.panel.viewport,
  ));
};

function rebuild(reframe = false): void {
  hideLoading();
  disposeCurrent();
  holder.clear();
  holder.rotation.set(0, 0, 0);
  const id = state.asset;
  showOptions(kindOf(id));
  if (id.startsWith('tex:'))
    return showTexture(id.slice(4) as TextureId, reframe);
  if (id.startsWith('car:')) return showCar(id.slice(4), reframe);
  if (isTree(id)) return showTree(id.slice(5), reframe);
  if (!hasAsset(id)) return;
  const meta = getAssetMeta(id);
  showOptions('asset', meta.variants, meta.lods.length);
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
  void model.ready.then(loadingPlate(def.name));
  info({
    id: carId,
    triangles: model.triangleCount().toLocaleString(),
    livery: Math.max(0, state.seed),
  });
  desc.innerHTML = `${def.description}<br/><a href="car-viewer.html?car=${encodeURIComponent(def.id)}&seed=${Math.max(0, state.seed)}">Open in car viewer →</a>`;
  if (reframe) frame(new Vector3(2, 1.5, 4.2), new Vector3(0, 0.7, 0));
  disposeCurrent = () => model.dispose();
}

/**
 * A tree type as the game draws it: its species' variants grown (or read from the disk cache) by `TreeLibrary`, drawn
 * by the game's `TreeRenderer` over a stand-in world of one chunk (flat ground, every tree in the first row), so its
 * levels, fades, sprites, impostor and shadows are the stage's; the shell's sun and sky light it. `seed` -1: the
 * variants in order from `variant` at the species' mean size; else hashed poses (variant, turn, size) from `seed`.
 */
let trees: TreeRenderer | null = null;
let treeJob = 0;
function showTree(type: string, reframe: boolean): void {
  if (!(type in TREE_TYPES)) return;
  const job = ++treeJob;
  const season = seasonParam(state.season, DEFAULT_SEASON);
  const def = speciesOfType(type);
  showOptions('tree', variantCount(def));
  info({ id: type, species: def.name, status: 'growing ...' });
  desc.textContent = '';
  const t0 = performance.now();
  disposeCurrent = () => {
    treeJob++;
  };
  const loaded = loadingPlate(TREE_TYPES[type]);
  void TreeLibrary.load(
    TreeLibrary.speciesOf([type], season),
    shell.renderer,
  ).then((lib) => {
    if (job !== treeJob) return lib.dispose();
    loaded();
    const count = variantCount(def);
    const n = state.grid;
    const mean = (def.scale[0] + def.scale[1]) / 2;
    const lv = lib.variant(def.name, state.variant % count)!;
    const spacing = state.spacing || Math.max(3, lv.info.radius * 2.6 * mean);
    const fixed = state.seed < 0;
    const instances: ScatterInstance[] = [];
    for (let i = 0; i < n * n; i++) {
      const p = placeTree('asset-debug', Math.max(0, state.seed) + i, type);
      instances.push({
        asset: type,
        variant: fixed ? (state.variant + i) % count : p.variant,
        x: ((i % n) - (n - 1) / 2) * spacing,
        y: 0,
        z: (Math.floor(i / n) - (n - 1) / 2) * spacing,
        rotY: fixed ? 0 : p.rotY,
        scale: fixed ? mean : p.scale,
        tiltX: 0,
        tiltZ: 0,
        tree: p.pose,
      });
    }
    const chunk: ScatterChunk = { instances, colliders: [], breakables: [] };
    const empty: ScatterChunk = {
      instances: [],
      colliders: [],
      breakables: [],
    };
    const at = (cx: number, cz: number) =>
      cx === 0 && cz === 0 ? chunk : empty;
    const half = spacing * n + 100;
    const world = {
      road: {
        query: (_x: number, _z: number, out: RoadQuery) =>
          Object.assign(out, { found: true, distance: 0, halfWidth: 0 }),
      },
      scatter: { chunkSize: 4 * half, cachedChunk: at, chunk: at },
      map: { bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half } },
      analytic: { height: () => 0 },
    } as unknown as World;
    const q = shell.quality;
    const mine = new TreeRenderer(world, lib, {
      lodScale: q.treeLodScale,
      maxDistance: q.viewDistance,
      forestDistance: q.forestDistance,
      shadowDistance: q.treeShadowDistance,
      shadowExtent: TREE_SHADOW_EXTENT,
    });
    trees = mine;
    holder.add(mine.group);
    mine.attachRenderer(shell.renderer);
    showLeaves();
    const height = lv.info.height * mean;
    // (After the async load: a shared camera link, applied meanwhile, still wins.)
    if (reframe && !state.cam) {
      // The whole stand in view from a person's height off the ground, a little above the tree's middle.
      const d =
        Math.max(height, spacing * (n - 1) + lv.info.radius * mean * 2) * 1.5;
      controls.target.set(0, height * 0.45, 0);
      camera.position.set(
        d * 0.7,
        Math.min(height * 0.5, 1.6 + d * 0.15),
        d * 0.7,
      );
    }
    mine.updateNow(camera);
    mine.checkPrepass(shell.renderer, scene, camera);
    info({
      id: type,
      species: def.name,
      season,
      variant: fixed
        ? `${state.variant % count} / ${count}`
        : `hashed (${count})`,
      'height (mean size)': `${height.toFixed(1)} m`,
      'crown radius': `${(lv.info.radius * mean).toFixed(1)} m`,
      'tris LOD0 / LOD1': lv.levels
        .map((g) => triCount(g).toLocaleString())
        .join(' / '),
      sprites: lv.spriteCount.toLocaleString(),
      'load ms': (performance.now() - t0).toFixed(0),
      generated: `${lib.stats.variants - lib.stats.cached} (cached ${lib.stats.cached})`,
    });
    desc.textContent =
      "Drawn by the game's tree renderer: orbit out for its levels; F6 cycles the debug views (levels, lighting only, normals). Spec: .claude/reference/trees/Species.md.";
    disposeCurrent = () => {
      mine.dispose();
      lib.dispose();
      if (trees === mine) trees = null;
    };
  });
}

/** Leaf sprites on / off (the `Leaves` toggle). */
function showLeaves(): void {
  for (const part of ['near', 'prepass', 'far'] as const)
    trees?.setPartVisible(part, state.leaves);
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
  trees?.update(camera);
});
// F6: the tree debug views (off -> levels -> lighting only -> normals), as in the game.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F6' && trees) {
    e.preventDefault();
    trees.cycleDebug();
  }
});

// The park, yard and village props' models are chunks of their own (`loadSimready`).
const propsLoaded = loadingPlate('asset models');
void loadSimready('park', 'yard', 'village').then(() => {
  propsLoaded();
  rebuild(true);
  // A shared camera link wins over the automatic framing.
  shell.applyCameraLink(state);
});
