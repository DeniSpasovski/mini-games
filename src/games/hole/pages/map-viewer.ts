import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Plane,
  PlaneGeometry,
  RGBAFormat,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { track } from '../../../shared/analytics';
import { ViewerShell } from '../debug/viewer-shell';
import { getItem } from '../items/catalog';
import { BIOMES, BIOME_COLORS, SEA } from '../map/animal/biomes';
import { RING_CORNERS } from '../map/city-movers';
import { DEFAULT_CITY, generateCity, targetPoints } from '../map/generate';
import type { DistrictId, MapData, MoveKind } from '../map/types';
import { buildMapGround } from '../render/map-ground';
import { MAPS, getMapDef } from '../map/registry';
import { ItemInstances } from '../render/item-instances';
import { CameraRig } from '../render/camera-rig';
import { World } from '../sim/world';
import {
  MAX_LEVEL,
  TIER_COUNT,
  cumulativeXp,
  holeDiameter,
} from '../sim/progression';

/**
 * Map viewer: regenerates City Island from a seed + parameters.
 *   map-viewer.html?seed=1&radius=235&overlay=districts&tier=0&level=12
 * Click the ground / an item to inspect it; "Play from here" opens the game there.
 */
const D = DEFAULT_CITY;
const DEFAULTS = {
  /** 'city' (City Island), 'toy' (Toy Emporium) or 'animal' (Animal Island). */
  map: 'city',
  seed: D.seed,
  radius: D.radius,
  noise: D.coastNoise,
  parks: D.parks,
  litter: D.litter,
  downtown: D.downtownMax,
  commercial: D.commercialMax,
  overlay: true,
  /** Animal Island overlays: biome grid, walk grid (land / water / blocked), leash circles, trail paths. */
  biomes: false,
  walkgrid: false,
  leash: false,
  paths: false,
  roads: false,
  tier: 0,
  level: 8,
  gamecam: false,
  x: 0,
  z: 0,
};
const state = readUrlState(DEFAULTS);
const sync = () => writeUrlState(state, DEFAULTS);
track('hole', 'select_content', {
  game_content_type: 'map_viewer',
  game_content_id: state.map,
});

const shell = new ViewerShell('Map viewer');
const { scene, panel } = shell;
shell.ground.visible = false;
shell.camera.position.set(0, 380, 330);
shell.controls.target.set(0, 0, 0);

let map: MapData;
let world: World;
let instances: ItemInstances;
let groundGroup: Group | null = null;
shell.onFrame(() =>
  (groundGroup?.userData.animate as ((t: number) => void) | undefined)?.(
    performance.now() / 1000,
  ),
);
const overlay = new Group();
scene.add(overlay);
/** Animal Island overlays (biome / walk textures, leash circles, paths), rebuilt with the map. */
const animalOverlay = {
  biomes: new Group(),
  walkgrid: new Group(),
  leash: new Group(),
  paths: new Group(),
  roads: new Group(),
};
for (const g of Object.values(animalOverlay)) scene.add(g);
const marker = new Mesh(
  new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new MeshBasicMaterial({
    color: 0xff3b30,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  }),
);
marker.renderOrder = 10;
marker.visible = false;
scene.add(marker);

const MOVE_COLOR: Record<MoveKind, number> = {
  wander: 0xffffff,
  hop: 0xffe66d,
  crawl: 0xc08a5a,
  skitter: 0xff9f43,
  flutter: 0x7fdbff,
  swim: 0x3d9cff,
  trail: 0xff4d6d,
  patrol: 0xd33fff,
  roam: 0xff2d2d,
  drive: 0xffd400,
  stroll: 0x00e5a8,
};

const DISTRICT_COLOR: Record<DistrictId, number> = {
  core: 0xff2d55,
  downtown: 0xaf52de,
  commercial: 0xff9500,
  residential: 0x34c759,
  park: 0x00c7be,
  edge: 0x8e8e93,
};

const mapDef = getMapDef(state.map);
/** Every map except City Island is generated from its seed alone (no island sliders). */
const isToy = mapDef.id !== 'city';
shell.env.setMood(mapDef.mood); // the map's own sky, fog and light colours, as in the game
panel.section('Map').select(
  'Map',
  state.map,
  MAPS.map((m) => m.id),
  (v) => {
    state.map = v;
    state.x = 0;
    state.z = 0;
    sync();
    location.reload();
  },
);
const vals = panel.section(mapDef.id === 'toy' ? 'Store' : 'Island');
vals.seed('Seed', state.seed, (v) => {
  state.seed = v;
  regenerate();
});
const slider = (
  label: string,
  key: 'radius' | 'noise' | 'parks' | 'litter' | 'downtown' | 'commercial',
  min: number,
  max: number,
  step: number,
) =>
  vals.slider(label, state[key], { min, max, step }, (v) => {
    state[key] = v;
    regenerate();
  });
if (!isToy) {
  slider('Radius (m)', 'radius', 150, 320, 5);
  slider('Coast noise (m)', 'noise', 0, 40, 1);
  slider('Parks', 'parks', 0, 10, 1);
  slider('Litter density', 'litter', 0, 3, 0.1);
  slider('Downtown radius (m)', 'downtown', 40, 140, 5);
  slider('Commercial radius (m)', 'commercial', 80, 200, 5);
}

const view = panel.section('View');
view.checkbox(
  mapDef.id === 'city' ? 'District overlay' : 'Department overlay',
  state.overlay,
  (v) => {
    state.overlay = v;
    overlay.visible = v;
    sync();
  },
);
view.slider(
  'Show only tier (0 = all)',
  state.tier,
  { min: 0, max: TIER_COUNT, step: 1 },
  (v) => {
    state.tier = v;
    applyTier();
    sync();
  },
);
view.slider(
  'Game camera level',
  state.level,
  { min: 1, max: MAX_LEVEL, step: 1 },
  (v) => {
    state.level = v;
    if (state.gamecam) placeGameCamera();
    sync();
  },
);
view.button('Game camera at the red marker', () => {
  state.gamecam = true;
  placeGameCamera();
});
view.button('Top-down overview', () => {
  state.gamecam = false;
  shell.controls.target.set(0, 0, 0);
  shell.camera.position.set(0, 380, 330);
});
const moverView = mapDef.id !== 'toy' ? panel.section('Movers') : null;
const moverToggle = (
  label: string,
  key: 'biomes' | 'walkgrid' | 'leash' | 'paths' | 'roads',
) =>
  moverView?.checkbox(label, state[key], (v) => {
    state[key] = v;
    applyAnimalOverlays();
    sync();
  });
if (mapDef.id === 'animal') {
  moverToggle('Biome grid', 'biomes');
  moverToggle('Walk grid (land / water / blocked)', 'walkgrid');
}
moverToggle('Leash circles (colour = behaviour)', 'leash');
moverToggle('Trail / patrol / stroll paths', 'paths');
if (mapDef.id === 'city') moverToggle('Road network (car lanes)', 'roads');
const play = panel.section('Play');
play.button('Play from the red marker', () => {
  location.href = `./?map=${state.map}&seed=${state.seed}&x=${state.x.toFixed(1)}&z=${state.z.toFixed(1)}&level=${state.level}&difficulty=medium`;
});
const budgetSection = panel.section('Content budget');
const setBudget = budgetSection.info();
const clickSection = panel.section('Clicked');
const setClicked = clickSection.info();

function regenerate(): void {
  map = isToy
    ? mapDef.generate(state.seed)
    : generateCity({
        seed: state.seed,
        radius: state.radius,
        coastNoise: state.noise,
        parks: state.parks,
        litter: state.litter,
        downtownMax: state.downtown,
        commercialMax: state.commercial,
      });
  if (groundGroup) scene.remove(groundGroup);
  if (instances) {
    scene.remove(instances.group);
    instances.dispose();
  }
  groundGroup = buildMapGround(map) as Group;
  scene.add(groundGroup);
  world = new World(map);
  instances = new ItemInstances(world);
  scene.add(instances.group);
  buildOverlay();
  buildAnimalOverlays();
  applyTier();
  if (state.x === 0 && state.z === 0) {
    state.x = map.start.x;
    state.z = map.start.z;
  }
  marker.position.set(state.x, 0.4, state.z);
  marker.visible = true;
  updateMarkerScale();
  refreshBudget();
  sync();
}

function buildOverlay(): void {
  overlay.clear();
  for (const z of map.zones ?? []) {
    const m = new Mesh(
      new PlaneGeometry(z.x1 - z.x0, z.z1 - z.z0).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: z.color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    m.position.set((z.x0 + z.x1) / 2, 0.5, (z.z0 + z.z1) / 2);
    overlay.add(m);
  }
  for (const b of map.blocks) {
    const m = new Mesh(
      new PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: DISTRICT_COLOR[b.district],
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    m.position.set(b.cx, 0.5, b.cz);
    overlay.add(m);
  }
  overlay.visible = state.overlay;
}

/** A flat grid of `nx` x `nz` cells as one textured plane; `colorOf` returns [r, g, b, a] (0-255) per cell. */
function gridPlane(
  g: { x0: number; z0: number; cell: number; nx: number; nz: number },
  colorOf: (ix: number, iz: number) => [number, number, number, number],
  y: number,
): Mesh {
  const px = new Uint8Array(g.nx * g.nz * 4);
  for (let iz = 0; iz < g.nz; iz++)
    for (let ix = 0; ix < g.nx; ix++) {
      // texture row 0 is the bottom (largest z after rotateX(-90deg)), so store the rows reversed
      px.set(colorOf(ix, iz), ((g.nz - 1 - iz) * g.nx + ix) * 4);
    }
  const tex = new DataTexture(px, g.nx, g.nz, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  const w = g.nx * g.cell;
  const d = g.nz * g.cell;
  const m = new Mesh(
    new PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.position.set(g.x0 + w / 2, y, g.z0 + d / 2);
  m.renderOrder = 5;
  return m;
}

function lineSet(segs: number[], cols: number[], y: number): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(segs, 3));
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
  const l = new LineSegments(
    geo,
    new LineBasicMaterial({ vertexColors: true, depthTest: false }),
  );
  l.position.y = y;
  l.renderOrder = 8;
  return l;
}

function buildAnimalOverlays(): void {
  for (const g of Object.values(animalOverlay)) g.clear();
  const t = map.terrain;
  if (t)
    animalOverlay.biomes.add(
      gridPlane(
        t.biome,
        (ix, iz) => {
          const c = t.biome.data[iz * t.biome.nx + ix];
          if (c === SEA) return [0, 0, 0, 0];
          const hex = BIOME_COLORS[BIOMES[c]][0];
          return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 200];
        },
        0.55,
      ),
    );
  const wg = map.walk;
  if (wg)
    animalOverlay.walkgrid.add(
      gridPlane(
        wg,
        (ix, iz) => {
          const c = wg.data[iz * wg.nx + ix];
          if (c === 1) return [60, 200, 90, 90];
          if (c === 2) return [40, 140, 255, 170];
          return [230, 50, 50, 170];
        },
        0.6,
      ),
    );
  // one leash circle per distinct home + radius + behaviour (a herd shares one); trails / patrols get a line
  const seen = new Set<string>();
  const circ: number[] = [];
  const circCol: number[] = [];
  const path: number[] = [];
  const pathCol: number[] = [];
  const c = new Color();
  const STEPS = 40;
  for (const p of map.placements) {
    const mv = p.move;
    if (!mv) continue;
    c.setHex(MOVE_COLOR[mv.kind]);
    if (mv.kind === 'drive') continue; // cars follow the road network overlay
    if (mv.kind === 'trail' || mv.kind === 'patrol') {
      path.push(mv.hx, 0, mv.hz, mv.tx ?? mv.hx, 0, mv.tz ?? mv.hz);
      pathCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (mv.kind === 'stroll') {
      // the sidewalk ring round the block, once per block and size
      const rk = `ring:${mv.hx.toFixed(0)}:${mv.hz.toFixed(0)}:${mv.leash.toFixed(1)}`;
      if (!seen.has(rk)) {
        seen.add(rk);
        const o = mv.leash;
        for (let k = 0; k < 4; k++) {
          const [ax, az] = RING_CORNERS[k];
          const [bx, bz] = RING_CORNERS[(k + 1) % 4];
          path.push(
            mv.hx + ax * o,
            0,
            mv.hz + az * o,
            mv.hx + bx * o,
            0,
            mv.hz + bz * o,
          );
          pathCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
      continue;
    }
    const key = `${mv.kind}:${mv.hx.toFixed(0)}:${mv.hz.toFixed(0)}:${mv.leash.toFixed(0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let k = 0; k < STEPS; k++) {
      const a0 = (k / STEPS) * Math.PI * 2;
      const a1 = ((k + 1) / STEPS) * Math.PI * 2;
      circ.push(
        mv.hx + Math.cos(a0) * mv.leash,
        0,
        mv.hz + Math.sin(a0) * mv.leash,
        mv.hx + Math.cos(a1) * mv.leash,
        0,
        mv.hz + Math.sin(a1) * mv.leash,
      );
      circCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  if (circ.length) animalOverlay.leash.add(lineSet(circ, circCol, 0.7));
  if (path.length) animalOverlay.paths.add(lineSet(path, pathCol, 0.75));
  const net = map.roads;
  if (net) {
    const seg: number[] = [];
    const segCol: number[] = [];
    c.setHex(MOVE_COLOR.drive);
    for (const [a, b] of net.edges) {
      seg.push(
        net.nodes[a][0],
        0,
        net.nodes[a][1],
        net.nodes[b][0],
        0,
        net.nodes[b][1],
      );
      segCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (seg.length) animalOverlay.roads.add(lineSet(seg, segCol, 0.8));
  }
  applyAnimalOverlays();
}

function applyAnimalOverlays(): void {
  animalOverlay.biomes.visible = state.biomes;
  animalOverlay.walkgrid.visible = state.walkgrid;
  animalOverlay.leash.visible = state.leash;
  animalOverlay.paths.visible = state.paths;
  animalOverlay.roads.visible = state.roads;
}

function moverSummary(): string {
  const n: Partial<Record<MoveKind, number>> = {};
  for (const p of map.placements)
    if (p.move) n[p.move.kind] = (n[p.move.kind] ?? 0) + 1;
  return `${world.movers.length}: ${Object.entries(n)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')}`;
}

function applyTier(): void {
  instances.filter((i) => state.tier === 0 || world.tier[i] === state.tier);
}

function updateMarkerScale(): void {
  const d = holeDiameter(state.level);
  marker.scale.set(d, 1, d);
}

function placeGameCamera(): void {
  const rig = new CameraRig();
  rig.camera.aspect = shell.camera.aspect;
  rig.snap();
  rig.update(0, state.x, state.z, holeDiameter(state.level), state.level);
  shell.camera.position.copy(rig.camera.position);
  shell.controls.target.copy(rig.target);
}

function refreshBudget(): void {
  const perTier = new Array(TIER_COUNT + 1).fill(0);
  const pts = new Array(TIER_COUNT + 1).fill(0);
  let total = 0;
  for (let i = 0; i < world.n; i++) {
    perTier[world.tier[i]]++;
    pts[world.tier[i]] += world.points[i];
    total += world.points[i];
  }
  const thin = perTier
    .map((n, l) => ({ n, l }))
    .filter((t) => t.l > 0 && t.n < 2)
    .map((t) => t.l);
  const target = isToy ? mapDef.points : targetPoints(DEFAULT_CITY);
  const zonePoints: Record<string, number> = {};
  if (map.zones)
    for (let i = 0; i < world.n; i++) {
      const z = map.zones.find(
        (q) =>
          world.x[i] >= q.x0 &&
          world.x[i] < q.x1 &&
          world.z[i] >= q.z0 &&
          world.z[i] < q.z1,
      );
      if (z) zonePoints[z.name] = (zonePoints[z.name] ?? 0) + world.points[i];
    }
  const need = cumulativeXp(MAX_LEVEL) * 2;
  setBudget({
    items: world.n,
    'total points': `${total}  (target ${target}: ${total === target ? 'OK' : 'OFF'}; ≥ ${need} for Easy: ${total >= need ? 'OK' : 'LOW'})`,
    'tiers with < 2 items': thin.length ? thin.join(', ') : 'none',
    'items per tier': perTier
      .slice(1)
      .map((n, i) => `L${i + 1}:${n}`)
      .join(' '),
    'points per tier': pts
      .slice(1)
      .map((n, i) => `L${i + 1}:${n}`)
      .join(' '),
    'skyscrapers (tier 22+)': perTier.slice(22).reduce((a, b) => a + b, 0),
    ...(map.zones
      ? {
          'points per department': Object.entries(zonePoints)
            .map(([n, p]) => `${n} ${p} (${Math.round((p / total) * 100)}%)`)
            .join(' · '),
        }
      : {}),
    ...(world.movers.length ? { movers: moverSummary() } : {}),
    start: `${map.start.x.toFixed(0)}, ${map.start.z.toFixed(0)}`,
  });
}

// click: inspect an item or pick a spot
const ray = new Raycaster();
const ndc = new Vector2();
const dom = shell.renderer.domElement;
let down: { x: number; y: number } | null = null;
dom.addEventListener(
  'pointerdown',
  (e) => (down = { x: e.clientX, y: e.clientY }),
);
dom.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const r = dom.getBoundingClientRect();
  ndc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  ray.setFromCamera(ndc, shell.camera);
  const hits = ray.intersectObjects(
    instances.group.children.filter((c) => c.visible),
    false,
  );
  const hit = hits.find((h) => h.batchId !== undefined);
  if (hit) {
    const i = instances.itemOf(hit.object, hit.batchId!);
    const info = getItem(world.types[world.type[i]].id);
    setClicked({
      item: `${info.name} (${info.id})`,
      'size tier': info.tier,
      'first hole level': info.level,
      points: info.points,
      size: `${info.size.toFixed(2)} m`,
      at: `${world.x[i].toFixed(1)}, ${world.z[i].toFixed(1)}`,
    });
  }
  const p = new Vector3();
  if (ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p)) {
    state.x = p.x;
    state.z = p.z;
    marker.position.set(p.x, 0.4, p.z);
    updateMarkerScale();
    sync();
  }
});

regenerate();
(window as unknown as { __mapViewer: unknown }).__mapViewer = {
  shell,
  state,
  get map() {
    return map;
  },
};
