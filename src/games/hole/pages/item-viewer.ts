import {
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Vector3,
} from 'three';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { ViewerShell } from '../debug/viewer-shell';
import { Station } from '../debug/station';
import {
  getItem,
  itemsForMap,
  rederiveCatalog,
  type ItemMap,
} from '../items/catalog';
import { buildItemGeometry, triCount } from '../items/builders';
import { minimalMap } from '../map/minimal';
import { CameraRig } from '../render/camera-rig';
import { HOLE_COLORS, HoleMesh, holeColorById } from '../render/hole-mesh';
import { ItemInstances } from '../render/item-instances';
import { getItemMaterials } from '../render/materials';
import { World } from '../sim/world';
import {
  MAX_LEVEL,
  SIZE_RULES,
  SIZE_RULES_DEFAULT,
  TIER_COUNT,
  cameraDistance,
  holeDiameter,
  maxEdibleSize,
  levelTier,
  pointsForTier,
} from '../sim/progression';

/**
 * Item viewer: every edible item and the hole in one tool.
 *   item-viewer.html?item=bench&mode=compare&level=6&slow=0.25&overlay=bounds,fit
 * Modes: single (item + hole of its level), compare (level-1 vs level hole),
 * lineup (all items sorted by size), hole (just the hole).
 */
const DEFAULTS = {
  /** 'city', 'toy' (Toy Emporium) or 'animal' (Animal Island): which catalog the list and the lineup show. */
  map: 'city',
  /** Lineup filter: only item ids containing this text (e.g. plush_panda). */
  family: '',
  item: 'bench',
  mode: 'single',
  level: 0,
  variant: 0,
  paint: 0,
  color: 'ocean',
  slow: 1,
  tier: 0,
  bounds: false,
  rings: true,
  wire: false,
  grid: false,
  gamecam: false,
  frame: 'ipad-landscape',
  stress: 0,
  /** Size rules preview (not saved): fit / height factor, and a size / points override of the selected item (0 = catalog). */
  fit: SIZE_RULES_DEFAULT.fit as number,
  hf: SIZE_RULES_DEFAULT.heightFactor as number,
  size: 0,
  pts: 0,
};
const state = readUrlState(DEFAULTS);
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);
const ITEMS = itemsForMap(state.map as ItemMap);
// the default item belongs to City Island: start the toy catalog on its first plush, the animal one on the rabbit
if (!ITEMS.some((i) => i.id === state.item))
  state.item = (
    ITEMS.find((i) => i.id === 'plush_panda_s' || i.id === 'rabbit') ?? ITEMS[0]
  ).id;
/** Hole level of every item with the shipped rules, to count what a rule change moves. */
const SHIPPED_LEVEL = new Map(ITEMS.map((i) => [i.id, i.level]));
function itemOverrides(): Record<string, { size?: number; points?: number }> {
  return state.size || state.pts
    ? {
        [state.item]: {
          size: state.size || undefined,
          points: state.pts || undefined,
        },
      }
    : {};
}
// a link with rule values (or an item override) previews them from the first frame
SIZE_RULES.fit = state.fit;
SIZE_RULES.heightFactor = state.hf;
rederiveCatalog(itemOverrides());

const shell = new ViewerShell('Item viewer');
const { scene, panel } = shell;
const holeColor = () => holeColorById(state.color);

let stations: Station[] = [];
let lineup: {
  world: World;
  instances: ItemInstances;
  labels: HTMLElement[];
} | null = null;
let holeOnly: { mesh: HoleMesh; rig: Group } | null = null;
let stress: InstancedMesh | null = null;
const overlays = new Group();
scene.add(overlays);
const labelHost = document.createElement('div');
labelHost.style.cssText =
  'position:absolute;inset:0;pointer-events:none;overflow:hidden;font:11px system-ui;color:#fff';
panel.viewport.append(labelHost);

const itemLevel = () =>
  state.level > 0 ? state.level : getItem(state.item).level;

// ---------------------------------------------------------------- UI
const listSection = panel.section('Items');
const buildList = () => {
  listSection.clear();
  return listSection.list(
    [
      { id: '__hole', label: 'Hole', group: 'Hole' },
      ...ITEMS.map((i) => ({
        id: i.id,
        label: `${i.name}  ·  ${i.size.toFixed(2)} m`,
        group: `Tier ${i.tier} · ${i.points} pt · hole L${i.level}`,
        hint: `${i.w} x ${i.d} x ${i.h} m`,
      })),
    ],
    state.mode === 'hole' ? '__hole' : state.item,
    (id) => {
      if (id === '__hole') state.mode = 'hole';
      else {
        state.item = id;
        state.variant = 0;
        state.paint = 0;
        state.level = 0;
        if (state.mode === 'hole') state.mode = 'single';
        if (state.size || state.pts) {
          // an override belongs to one item: drop it, re-derive, redraw the list
          state.size = state.pts = 0;
          sizeSlider.set(0);
          ptsSlider.set(0);
          applyRules();
        }
      }
      syncControls();
      rebuild(true);
      sync(true);
    },
  );
};
let list = buildList();

const vals = panel.section('Values');
vals.select('Map', state.map, ['city', 'toy', 'animal'], (v) => {
  state.map = v;
  state.item = '';
  sync();
  location.reload();
});
const modeSel = vals.select(
  'Mode',
  state.mode,
  ['single', 'compare', 'lineup', 'hole'],
  (v) => {
    state.mode = v;
    rebuild(true);
    sync();
  },
);
const levelSlider = vals.slider(
  'Hole level (0 = item level)',
  state.level,
  { min: 0, max: MAX_LEVEL, step: 1 },
  (v) => {
    state.level = v;
    rebuild(false);
    sync();
  },
);
const variantSlider = vals.slider(
  'Variant',
  state.variant,
  { min: 0, max: 5, step: 1 },
  (v) => {
    state.variant = v;
    rebuild(false);
    sync();
  },
);
const paintSlider = vals.slider(
  'Paint colour',
  state.paint,
  { min: 0, max: 7, step: 1 },
  (v) => {
    state.paint = v;
    rebuild(false);
    sync();
  },
);
vals.select(
  'Hole colour',
  state.color,
  HOLE_COLORS.map((c) => ({ value: c.id, label: c.name })),
  (v) => {
    state.color = v;
    for (const s of stations) s.setColor(holeColor());
    holeOnly?.mesh.setColor(holeColor());
    sync();
  },
);
vals.slider(
  'Time scale',
  state.slow,
  { min: 0.05, max: 2, step: 0.05 },
  (v) => {
    state.slow = v;
    sync();
  },
);
vals.slider(
  'Lineup tier (0 = all)',
  state.tier,
  { min: 0, max: TIER_COUNT, step: 1 },
  (v) => {
    state.tier = v;
    if (state.mode === 'lineup') rebuild(true);
    sync();
  },
);

// Size rules: preview what a different fit / height factor or a per-item size / points would do.
// Nothing is saved: copy the numbers into sim/progression.ts (SIZE_RULES) or the catalog row.
const rules = panel.section('Size rules (preview, not saved)', false);
const rulesInfo = rules.info();
const fitSlider = rules.slider(
  'Fit (hole D = eat size / fit)',
  state.fit,
  { min: 0.5, max: 1, step: 0.01 },
  (v) => ((state.fit = v), applyRules(), sync()),
);
const hfSlider = rules.slider(
  'Height factor (height x f counts as size)',
  state.hf,
  { min: 0, max: 0.6, step: 0.01 },
  (v) => ((state.hf = v), applyRules(), sync()),
);
const sizeSlider = rules.slider(
  'Selected item size m (0 = catalog)',
  state.size,
  { min: 0, max: 40, step: 0.05 },
  (v) => ((state.size = v), applyRules(), sync()),
);
const ptsSlider = rules.slider(
  'Selected item points (0 = tier points)',
  state.pts,
  { min: 0, max: 50, step: 1 },
  (v) => ((state.pts = v), applyRules(), sync()),
);
rules.button('Reset size rules', () => {
  state.fit = SIZE_RULES_DEFAULT.fit;
  state.hf = SIZE_RULES_DEFAULT.heightFactor;
  state.size = state.pts = 0;
  fitSlider.set(state.fit);
  hfSlider.set(state.hf);
  sizeSlider.set(0);
  ptsSlider.set(0);
  applyRules();
  sync();
});
rules.button('Copy size rules', () => {
  const i = getItem(state.item);
  void navigator.clipboard?.writeText(
    JSON.stringify(
      {
        SIZE_RULES: { fit: state.fit, heightFactor: state.hf },
        item: {
          id: i.id,
          sizeOverride: state.size || undefined,
          pointsOverride: state.pts || undefined,
        },
        itemsOnAnotherLevel: movedItems(),
      },
      null,
      2,
    ),
  );
});
function movedItems(): number {
  return ITEMS.filter((i) => i.level !== SHIPPED_LEVEL.get(i.id)).length;
}
/** Push the rule sliders into the live catalog, then redraw everything that was derived from it. */
function applyRules(): void {
  SIZE_RULES.fit = state.fit;
  SIZE_RULES.heightFactor = state.hf;
  rederiveCatalog(itemOverrides());
  list = buildList();
  rebuild(false);
}

const act = panel.section('Actions');
act.button('Drop (hole moves under the item)', () =>
  stations.forEach((s) => (s.reset(), s.drop())),
);
act.button('Slide across (teeter test)', () =>
  stations.forEach((s) => (s.reset(), s.slideAcross())),
);
act.button('Level-up at the rim', () =>
  stations.forEach((s) => s.levelUp(itemLevel())),
);
act.button('Reset', () => stations.forEach((s) => s.reset()));
act.slider(
  'Stress test N×N (0 = off)',
  state.stress,
  { min: 0, max: 60, step: 1 },
  (v) => {
    state.stress = v;
    buildStress();
    sync();
  },
);

const ov = panel.section('Overlays');
ov.checkbox('Bounds box', state.bounds, (v) => ((state.bounds = v), sync()));
ov.checkbox(
  'Size + fit rings',
  state.rings,
  (v) => ((state.rings = v), sync()),
);
ov.checkbox('Wireframe', state.wire, (v) => {
  state.wire = v;
  for (const m of Object.values(getItemMaterials())) m.wireframe = v;
  sync();
});
ov.checkbox('Grid (1 m)', state.grid, (v) => {
  state.grid = v;
  shell.grid.visible = v;
  sync();
});
ov.checkbox('Game camera preview', state.gamecam, (v) => {
  state.gamecam = v;
  sync();
});
ov.select(
  'Preview frame',
  state.frame,
  [
    { value: 'ipad-landscape', label: 'iPad landscape 4:3' },
    { value: 'ipad-portrait', label: 'iPad portrait 3:4' },
    { value: 'phone-portrait', label: 'Phone portrait 9:19.5' },
    { value: 'fit', label: 'Fit window' },
  ],
  (v) => ((state.frame = v), sync()),
);
const infoSection = panel.section('Info');
const setInfo = infoSection.info();
panel.section('Copy', false).button('Copy item JSON', () => {
  const i = getItem(state.item);
  void navigator.clipboard?.writeText(
    JSON.stringify(
      {
        id: i.id,
        w: i.w,
        d: i.d,
        h: i.h,
        size: i.size,
        level: i.level,
        points: i.points,
      },
      null,
      2,
    ),
  );
});

function syncControls(): void {
  list.set(state.mode === 'hole' ? '__hole' : state.item);
  modeSel.set(state.mode);
  levelSlider.set(state.level);
  variantSlider.set(state.variant);
  paintSlider.set(state.paint);
}

// ---------------------------------------------------------------- scenes
function clearScene(): void {
  for (const s of stations) s.dispose(scene);
  stations = [];
  if (lineup) {
    scene.remove(lineup.instances.group);
    lineup.labels.forEach((l) => l.remove());
    lineup = null;
  }
  if (holeOnly) {
    scene.remove(holeOnly.mesh.group, holeOnly.rig);
    holeOnly = null;
  }
  overlays.clear();
  buildStress();
}

function rebuild(reframe: boolean): void {
  clearScene();
  const info = getItem(state.item);
  const lvl = itemLevel();
  const variant = state.variant % info.variants;
  const paint = info.paints?.length ? state.paint % info.paints.length : -1;
  if (state.mode === 'single') {
    const st = new Station(scene, info.id, 0, lvl, holeColor(), variant, paint);
    stations.push(st);
    if (reframe)
      shell.frame(
        new Vector3(-2, info.h * 0.3, 0),
        Math.max(info.size, info.h * 0.6) + holeDiameter(lvl),
      );
  } else if (state.mode === 'compare') {
    const gap = Math.max(info.size, holeDiameter(lvl)) * 1.5 + 4;
    const a = new Station(
      scene,
      info.id,
      -gap,
      Math.max(1, lvl - 1),
      holeColor(),
      variant,
      paint,
    );
    const b = new Station(
      scene,
      info.id,
      gap,
      lvl,
      holeColor(),
      variant,
      paint,
    );
    stations.push(a, b);
    if (reframe)
      shell.frame(new Vector3(0, info.h * 0.3, 0), gap * 1.6 + info.size);
  } else if (state.mode === 'lineup') {
    buildLineup(reframe);
  } else {
    const mesh = new HoleMesh(holeColor());
    mesh.setDiameter(holeDiameter(lvl));
    const rig = new Group();
    const d = holeDiameter(lvl);
    // scale references: pedestrian (1.75 m), sedan, bench
    const refs = ['pedestrian', 'car_sedan', 'bench'];
    const ids = refs.map((id, i) => ({
      item: id,
      x: d / 2 + 2 + i * 4,
      z: 0,
      rot: 0,
      variant: 0,
      paint: 0,
    }));
    const world = new World(minimalMap(ids));
    const inst = new ItemInstances(world);
    rig.add(inst.group);
    scene.add(mesh.group, rig);
    holeOnly = { mesh, rig };
    if (reframe) shell.frame(new Vector3(d / 2, 0, 0), d * 1.5 + 8);
  }
  makeOverlays();
  refreshInfo();
}

function buildLineup(reframe: boolean): void {
  const items = ITEMS.filter(
    (i) =>
      (state.tier === 0 || i.tier === state.tier) &&
      (!state.family || i.id.includes(state.family)),
  ).sort((a, b) => a.size - b.size);
  const placements = [];
  let x = 0;
  placements.push({
    item: 'pedestrian',
    x,
    z: -4,
    rot: 0,
    variant: 0,
    paint: 0,
  });
  x += 2;
  for (const it of items) {
    const half = Math.max(it.w, it.d) / 2;
    x += half + 0.6;
    placements.push({ item: it.id, x, z: 0, rot: 0, variant: 0, paint: 0 });
    x += half;
  }
  const world = new World(minimalMap(placements));
  const instances = new ItemInstances(world);
  scene.add(instances.group);
  const labels: HTMLElement[] = [];
  for (let i = 1; i < placements.length; i++) {
    const el = document.createElement('div');
    const it = getItem(placements[i].item);
    el.textContent = `${it.name} · T${it.tier} · ${it.points}pt`;
    el.style.cssText =
      'position:absolute;white-space:nowrap;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.55)';
    labelHost.append(el);
    labels.push(el);
  }
  lineup = { world, instances, labels };
  if (reframe) shell.frame(new Vector3(x / 2, 3, 0), Math.min(x, 60));
}

// ---------------------------------------------------------------- overlays
const ringMat = new LineBasicMaterial({ color: 0xffd23f });
const fitMat = new LineBasicMaterial({ color: 0x35d06a });
function circle(r: number, mat: LineBasicMaterial): LineLoop {
  const pts: number[] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(Math.cos(a) * r, 0.08, Math.sin(a) * r);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const l = new LineLoop(g, mat);
  l.renderOrder = 5;
  return l;
}

let sizeRings: { ring: LineLoop; fit: LineLoop; st: Station }[] = [];
function makeOverlays(): void {
  sizeRings = [];
  if (lineup || holeOnly) return;
  for (const st of stations) {
    const info = getItem(st.itemId);
    const ring = circle(0.5, ringMat);
    ring.scale.set(info.size, 1, info.size);
    ring.position.set(st.itemX, 0, 0);
    const fit = circle(0.5, fitMat);
    overlays.add(ring, fit);
    sizeRings.push({ ring, fit, st });
    const g = buildItemGeometry(info.id, st.variant % info.variants);
    const box = new Box3()
      .copy(g.boundingBox!)
      .translate(new Vector3(st.itemX, 0, 0));
    const helper = new Box3Helper(box, 0x66ccff);
    helper.userData.kind = 'bounds';
    overlays.add(helper);
  }
}

function refreshInfo(): void {
  const i = getItem(state.item);
  if (state.mode === 'hole') {
    const l = itemLevel() || 1;
    setInfo({
      level: l,
      diameter: `${holeDiameter(l).toFixed(2)} m`,
      'eats size ≤': `${maxEdibleSize(l).toFixed(2)} m`,
      'size tier': levelTier(l),
      'points at this tier': pointsForTier(levelTier(l)),
      'camera dist': `${cameraDistance(holeDiameter(l)).toFixed(1)} m`,
    });
    return;
  }
  const g = buildItemGeometry(i.id, state.variant % i.variants);
  const bb = g.boundingBox!;
  rulesInfo({
    'fit / height factor': `${SIZE_RULES.fit} / ${SIZE_RULES.heightFactor}`,
    'items on another hole level': movedItems(),
  });
  setInfo({
    id: i.id,
    group: i.group,
    'catalog w×d×h': `${i.w} × ${i.d} × ${i.h} m`,
    'built w×d×h': `${(bb.max.x - bb.min.x).toFixed(2)} × ${(bb.max.z - bb.min.z).toFixed(2)} × ${(bb.max.y - bb.min.y).toFixed(2)}`,
    size: `${i.size.toFixed(2)} m`,
    'size tier': i.tier,
    'first hole level': i.level,
    points: i.points,
    triangles: triCount(g),
    style: i.style,
    placed: i.where,
  });
}

// ---------------------------------------------------------------- stress test
function buildStress(): void {
  if (stress) {
    scene.remove(stress);
    stress.dispose();
    stress = null;
  }
  const n = state.stress;
  if (n <= 0 || state.mode === 'hole') return;
  const info = getItem(state.item);
  const mesh = new InstancedMesh(
    buildItemGeometry(info.id, 0),
    getItemMaterials()[info.style],
    n * n,
  );
  const sp = Math.max(info.w, info.d) * 1.3;
  const m = new Matrix4();
  const c = new Color();
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      m.makeTranslation((i - n / 2) * sp, 0, 12 + info.size + j * sp);
      mesh.setMatrixAt(i * n + j, m);
      if (info.paints?.length)
        mesh.setColorAt(
          i * n + j,
          c.setHex(info.paints[(i + j) % info.paints.length]),
        );
    }
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  stress = mesh;
  scene.add(mesh);
}

// ---------------------------------------------------------------- frame loop
const rig = new CameraRig();
const tmp = new Vector3();
shell.onFrame((dt) => {
  for (const s of stations) s.step(dt * state.slow);
  for (const r of sizeRings) {
    const h = r.st.sim.hole;
    r.fit.position.set(h.x, 0, h.z);
    r.fit.scale.set(
      h.diameter * SIZE_RULES.fit,
      1,
      h.diameter * SIZE_RULES.fit,
    );
    r.fit.visible = r.ring.visible = state.rings;
  }
  overlays.children.forEach((c) => {
    if (c.userData.kind === 'bounds') c.visible = state.bounds;
  });
  if (holeOnly) holeOnly.mesh.tick(dt);
  if (lineup) {
    const cam = shell.camera;
    const w = panel.viewport.clientWidth;
    const h = panel.viewport.clientHeight;
    const world = lineup.world;
    lineup.labels.forEach((el, k) => {
      const i = k + 1;
      tmp.set(world.x[i], world.height[i] + 0.4, world.z[i]).project(cam);
      const visible =
        tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (visible)
        el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
    });
  }
});

// Game camera preview: render the scene from the real game camera into a framed box.
shell.setRenderOverride(() => {
  if (!state.gamecam) {
    shell.renderer.setScissorTest(false);
    return true;
  }
  const r = shell.renderer;
  const el = r.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const aspect =
    state.frame === 'ipad-landscape'
      ? 4 / 3
      : state.frame === 'ipad-portrait'
        ? 3 / 4
        : state.frame === 'phone-portrait'
          ? 9 / 19.5
          : W / H;
  let bw = W;
  let bh = W / aspect;
  if (bh > H) {
    bh = H;
    bw = H * aspect;
  }
  const bx = (W - bw) / 2;
  const by = (H - bh) / 2;
  const lvl = state.mode === 'compare' ? itemLevel() : itemLevel() || 1;
  const focus = stations[stations.length - 1]?.sim.hole ?? {
    x: holeOnly ? 0 : 0,
    z: 0,
    diameter: holeDiameter(lvl),
  };
  rig.camera.aspect = bw / bh;
  rig.snap();
  rig.update(0.016, focus.x, focus.z, focus.diameter, lvl);
  r.setScissorTest(true);
  r.setViewport(bx, by, bw, bh);
  r.setScissor(bx, by, bw, bh);
  r.setClearColor(0x111111);
  r.clear();
  r.render(scene, rig.camera);
  r.setScissorTest(false);
  r.setViewport(0, 0, W, H);
  return false;
});

// ---------------------------------------------------------------- go
shell.grid.visible = state.grid;
if (state.wire)
  for (const m of Object.values(getItemMaterials())) m.wireframe = true;
rebuild(true);
(window as unknown as { __itemViewer: unknown }).__itemViewer = {
  get stations() {
    return stations;
  },
  shell,
  state,
};
