import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEAM_COUNT, TEAMS } from '../assets/builders/teams';
import { getCar } from '../cars';
import { loadCarModelFile } from '../cars/shared/car-gltf';
import { paintParams } from '../cars/shared/paint-finish';
import { rimColorFor, RIM_UNIT_BARREL } from '../cars/shared/stl-wheel';
import { rimRadius } from '../cars/shared/tyre-mesh';
import type { CarDef } from '../cars/shared/types';
import { axleRadius, tyreSizeFor, type Axle } from '../physics/car-tyres';
import { parkCarId } from './park-cars';
import type { ScatterInstance } from './scatter';

/**
 * The team cars of a service park: the real rally models at a fraction of their detail.
 *
 * `<car>_park.glb` (scripts/car-model/park-lods.mjs) holds three simplified bodies - `paint` (the livery shell on the
 * car's atlas UVs) and `parts` (everything else in vertex colours) - and a rim per LOD. Here a car is built from it:
 *   - the livery is the car's own atlas painter in the team's colours, drawn once per (car, team) at about 85 px/m;
 *   - wheels are built at runtime (a low lathe tyre + the baked rim scaled to the car's tyre size) and merged with the
 *     body parts, so a car is two draw calls (paint, parts) per LOD;
 *   - a raised car stands on axle stands with its rear wheels off (the layout puts the wheels beside it).
 * Cars are ordinary meshes (about twenty in a park), not instances: one LOD is shown per car by distance from the focus.
 */

/** Body LOD limits (m) before `lodScale`: full detail near, then ~1/3 and ~1/7 of the triangles, hidden beyond. */
const LOD_DISTANCE = [45, 120, 420];
/**
 * The car models (geometry, liveries) are loaded when the focus comes within `LOAD_MARGIN` m of the last LOD's reach of a
 * park car, and freed again beyond `UNLOAD_MARGIN` m of it (a stage driven away from its start no longer holds the park).
 */
const LOAD_MARGIN = 200;
const UNLOAD_MARGIN = 800;

/** What a park does with its car models: `nearest` = distance (m) of the focus to the closest car, `reach` = how far a car is drawn. */
export function parkCarsPlan(
  nearest: number,
  reach: number,
  loaded: boolean,
): 'load' | 'unload' | 'keep' {
  if (!loaded) return nearest < reach + LOAD_MARGIN ? 'load' : 'keep';
  return nearest > reach + UNLOAD_MARGIN ? 'unload' : 'keep';
}
/** Tyre lathe segments per LOD. */
const TYRE_SEGMENTS = [24, 14, 9];
/** Longest side of a livery texture (px). */
const LIVERY_SIDE = 768;
/** Height a raised car stands off the ground (m). */
const RAISE = 0.14;
/** LODs below this index draw their glass with its own material (a third draw call). */
const GLASS_LODS = 2;
const STAND = '#c8321e';
const TYRE = '#141516';

export interface ParkCarOptions {
  /** Multiplies the LOD distances. */
  lodScale: number;
  /** Nothing is drawn further than this (m). */
  maxDistance?: number;
}

/** One car's cheap model: shared by every car of that model (geometry is never cloned per car). */
interface Kit {
  def: CarDef;
  /** Livery shell per LOD (atlas UVs). */
  paint: BufferGeometry[];
  /** Body parts per LOD (vertex colours, linear). */
  parts: BufferGeometry[];
  /** Rim per LOD, in unit wheel space (`RIM_UNIT_BARREL`). */
  rim: BufferGeometry[];
  /** Body height over the wheels' rest pose (staggered tyres) (m). */
  lift: number;
  /** Body + wheels (+ stands) per (LOD, raised), built on first use. */
  poses: Map<number, BufferGeometry>;
}

const kits = new Map<string, Promise<Kit | null>>();
const loaded = new Map<string, Kit>();

/** The `<id>_park.glb` of a car once loaded (cached; null if the file or the car's atlas is missing). */
function loadKit(id: string): Promise<Kit | null> {
  let p = kits.get(id);
  if (!p) {
    p = loadKitFile(id).then(
      (kit) => {
        if (kit) loaded.set(id, kit);
        return kit;
      },
      (e) => {
        console.warn(`[park] ${id}: park model failed, car left out`, e);
        return null;
      },
    );
    kits.set(id, p);
  }
  return p;
}

async function loadKitFile(id: string): Promise<Kit | null> {
  const def = getCar(id);
  if (!def.model.gltf?.atlas) return null;
  const root = await loadCarModelFile(`${id}_park.glb`);
  const paint: BufferGeometry[] = [];
  const parts: BufferGeometry[] = [];
  const rim: BufferGeometry[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const lod = lodOf(mesh);
    const kind = (mesh.material as Material).name;
    if (lod < 0) return;
    if (kind === 'paint') paint[lod] = plain(mesh.geometry, true);
    else if (kind === 'parts') parts[lod] = withColors(mesh.geometry);
    else if (kind === 'rim') rim[lod] = plain(mesh.geometry, false);
  });
  for (let l = 0; l < LOD_DISTANCE.length; l++)
    if (!paint[l] || !parts[l] || !rim[l])
      throw new Error(`${id}_park.glb: LOD ${l} incomplete`);
  const p = def.physics;
  const lift =
    (axleRadius(p, null, 'front') + axleRadius(p, null, 'rear')) / 2 -
    p.wheelRadius;
  return { def, paint, parts, rim, lift, poses: new Map() };
}

/** LOD index of a mesh of the GLB (its node is `lodN` / `rimN`), -1 when it is neither. */
function lodOf(o: Object3D): number {
  for (let n: Object3D | null = o; n; n = n.parent) {
    const m = /^(?:lod|rim)(\d)$/.exec(n.name);
    if (m) return Number(m[1]);
  }
  return -1;
}

type Attr = BufferAttribute | InterleavedBufferAttribute;

function floats(a: Attr, size: number): Float32BufferAttribute {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) {
    out[i * size] = a.getX(i);
    out[i * size + 1] = a.getY(i);
    if (size > 2) out[i * size + 2] = a.getZ(i);
  }
  return new Float32BufferAttribute(out, size);
}

/** Own copy of a loaded geometry's position / normal (/ uv) / index (the loader's buffers may be interleaved). */
function plain(src: BufferGeometry, uv: boolean): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', floats(src.getAttribute('position') as Attr, 3));
  g.setAttribute('normal', floats(src.getAttribute('normal') as Attr, 3));
  if (uv) g.setAttribute('uv', floats(src.getAttribute('uv') as Attr, 2));
  g.setIndex(new BufferAttribute(src.index!.array.slice(), 1));
  return g;
}

const _c = new Color();
const linear: number[] = [];

/** The `parts` primitive with its colours (sRGB bytes) as linear floats, like every other vertex-coloured asset. */
function withColors(src: BufferGeometry): BufferGeometry {
  const g = plain(src, false);
  const col = src.getAttribute('color') as Attr;
  const out = new Float32Array(col.count * 3);
  const lin = (v: number): number =>
    (linear[Math.round(v * 255)] ??= _c.setRGB(v, v, v, SRGBColorSpace).r);
  for (let i = 0; i < col.count; i++) {
    out[i * 3] = lin(col.getX(i));
    out[i * 3 + 1] = lin(col.getY(i));
    out[i * 3 + 2] = lin(col.getZ(i));
  }
  g.setAttribute('color', new Float32BufferAttribute(out, 3));
  return g;
}

/** A solid-coloured piece in the `parts` layout (position, normal, colour; indexed). */
function solid(g: BufferGeometry, hex: string): BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const c = _c.set(hex);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(out, 3));
  return g;
}

/** A low tyre (wheel space: axis X, outer face +X): bead, rounded sidewall, flat tread. */
function tyreGeometry(
  radius: number,
  width: number,
  bead: number,
  segments: number,
): BufferGeometry {
  const sw = radius - bead;
  const hw = width / 2;
  const profile = [
    [bead, -hw * 0.78],
    [bead + sw * 0.3, -hw * 0.98],
    [radius - sw * 0.12, -hw * 0.9],
    [radius, -hw * 0.62],
    [radius, hw * 0.62],
    [radius - sw * 0.12, hw * 0.9],
    [bead + sw * 0.3, hw * 0.98],
    [bead, hw * 0.78],
  ].map(([r, a]) => new Vector2(r, a));
  const g = new LatheGeometry(profile, segments);
  g.rotateZ(-Math.PI / 2);
  return solid(g, TYRE);
}

const M = new Matrix4();
const R = new Matrix4();

/** Body parts + wheels (+ stands when raised) of a car in one geometry, the body lifted by `RAISE` when raised. */
function poseGeometry(kit: Kit, lod: number, raised: boolean): BufferGeometry {
  const key = lod * 2 + (raised ? 1 : 0);
  let g = kit.poses.get(key);
  if (g) return g;
  const { def } = kit;
  const p = def.physics;
  const up = raised ? RAISE : 0;
  const pieces: BufferGeometry[] = [
    kit.parts[lod].clone().translate(0, kit.lift + up, 0),
  ];
  const rimColor = rimColorFor(def.model, null);
  for (const axle of ['front', 'rear'] as Axle[]) {
    // A raised car's rear wheels are off (they lie beside it).
    if (raised && axle === 'rear') continue;
    const size = tyreSizeFor(p, null, axle);
    const radius = axleRadius(p, null, axle);
    const bead = rimRadius(size);
    const tyre = tyreGeometry(radius, size.width, bead, TYRE_SEGMENTS[lod]);
    const rim = solid(
      kit.rim[lod]
        .clone()
        .scale(size.width, bead / RIM_UNIT_BARREL, bead / RIM_UNIT_BARREL),
      rimColor,
    );
    const { track, z } = p[axle];
    for (const side of [1, -1]) {
      // The outer face turns away from the car; the spin only varies the rims' look.
      M.makeTranslation((side * track) / 2, radius + up, z);
      if (side < 0) M.multiply(R.makeRotationY(Math.PI));
      M.multiply(R.makeRotationX(side * 1.1 + z));
      pieces.push(tyre.clone().applyMatrix4(M), rim.clone().applyMatrix4(M));
    }
    tyre.dispose();
    rim.dispose();
  }
  if (raised) {
    // Axle stands under the sills, in front of and behind each axle.
    const height = 0.11 + kit.lift + up;
    for (const axle of ['front', 'rear'] as Axle[])
      for (const side of [1, -1]) {
        const x = side * (p[axle].track / 2 - 0.2);
        const z = p[axle].z + (axle === 'rear' ? 0.55 : -0.55);
        pieces.push(
          solid(new BoxGeometry(0.4, 0.06, 0.4).translate(x, 0.03, z), STAND),
          solid(
            new BoxGeometry(0.07, height, 0.07).translate(x, height / 2, z),
            STAND,
          ),
        );
      }
  }
  g = mergeGeometries(pieces, false)!;
  if (lod < GLASS_LODS) groupGlass(g);
  for (const piece of pieces) piece.dispose();
  g.computeBoundingSphere();
  kit.poses.set(key, g);
  return g;
}

// --- livery ------------------------------------------------------------------------------------

const liveries = new Map<string, MeshPhysicalMaterial>();

/**
 * The car's livery painter in a team's colours, drawn on the full atlas and scaled down to `LIVERY_SIDE`.
 * One material per (car, team), kept for the page's life (a park uses about a dozen).
 */
function liveryMaterial(def: CarDef, team: number): MeshPhysicalMaterial {
  const key = `${def.id}:${team}`;
  let mat = liveries.get(key);
  if (mat) return mat;
  const atlas = def.model.gltf!.atlas!;
  const t = TEAMS[team % TEAM_COUNT];
  const full = document.createElement('canvas');
  full.width = atlas.width;
  full.height = atlas.height;
  atlas.paint(
    full.getContext('2d')!,
    { base: t.base, accent: t.accent, accent2: t.accent2 },
    // Never 0: seed 0 is each car's own livery, any other seed wears the colours given.
    team + 1,
  );
  const f = Math.min(1, LIVERY_SIDE / Math.max(atlas.width, atlas.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(atlas.width * f));
  small.height = Math.max(1, Math.round(atlas.height * f));
  const g = small.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, small.width, small.height);
  full.width = full.height = 0;
  const map = new CanvasTexture(small);
  map.colorSpace = SRGBColorSpace;
  map.flipY = false; // glTF UV convention
  map.anisotropy = 4;
  // The finish of the car itself (clearcoat and all), so a team car shines like the player's.
  const gltf = def.model.gltf;
  mat = new MeshPhysicalMaterial({
    map,
    ...paintParams(
      gltf?.matte ? 'matte' : gltf?.metallic ? 'metallic' : 'gloss',
    ),
  });
  liveries.set(key, mat);
  return mat;
}

/** Frees a car model's geometry and the liveries painted for it (the shared part / glass materials stay). */
function releaseKit(id: string): void {
  const kit = loaded.get(id);
  if (kit) {
    for (const g of [
      ...kit.paint,
      ...kit.parts,
      ...kit.rim,
      ...kit.poses.values(),
    ])
      g.dispose();
    kit.poses.clear();
  }
  loaded.delete(id);
  kits.delete(id);
  for (const [key, mat] of liveries)
    if (key.startsWith(`${id}:`)) {
      const map = mat.map;
      mat.dispose();
      if (map) {
        map.dispose();
        const canvas = map.image as HTMLCanvasElement;
        canvas.width = canvas.height = 0;
      }
      liveries.delete(key);
    }
}

let partsMaterial: MeshStandardMaterial | undefined;
const parts = (): MeshStandardMaterial =>
  (partsMaterial ??= new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.1,
  }));

/** Glass and gloss-black parts of the near LODs: the reflective material of the car's own windows. */
let glassMaterial: MeshStandardMaterial | undefined;
const glass = (): MeshStandardMaterial =>
  (glassMaterial ??= new MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.3,
    roughness: 0.04,
    envMapIntensity: 1.8,
  }));

/** Linear colour below which a part is glass or gloss black (baked as #0a0d10 / #08090a; the tyres' #141516 is above). */
const DARK = 0.006;

/** Puts the dark triangles of `g` (indexed, vertex colours) first and gives them group 1, the rest group 0. */
function groupGlass(g: BufferGeometry): void {
  const col = g.getAttribute('color');
  const index = g.index!.array;
  const dark: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < index.length; i += 3) {
    const isDark = [0, 1, 2].every((k) => {
      const v = index[i + k];
      return col.getX(v) < DARK && col.getY(v) < DARK && col.getZ(v) < DARK;
    });
    (isDark ? dark : rest).push(index[i], index[i + 1], index[i + 2]);
  }
  g.setIndex([...rest, ...dark]);
  g.addGroup(0, rest.length, 0);
  g.addGroup(rest.length, dark.length, 1);
}

// --- the cars of a park ---------------------------------------------------------------------------

interface ParkCar {
  id: string;
  team: number;
  raised: boolean;
  x: number;
  z: number;
  root: Group;
  /** One group per LOD, built when first shown. */
  lods: (Group | undefined)[];
  /** Shown LOD (-1 hidden, -2 not decided yet). */
  lod: number;
}

/** Draws the `team_car` instances of a service park as real cars (see the file comment). */
export class ParkCars {
  readonly group = new Group();
  private cars: ParkCar[];
  private focus = new Vector3(Infinity, 0, 0);
  private enabled = true;
  /** idle: no models in memory (the focus is far from the park); loading / ready: they are being loaded / in. */
  private state: 'idle' | 'loading' | 'ready' = 'idle';
  private loading: Promise<void> = Promise.resolve();

  constructor(
    instances: ScatterInstance[],
    private opts: ParkCarOptions,
  ) {
    this.group.name = 'park cars';
    this.cars = instances.map((i) => {
      const root = new Group();
      root.position.set(i.x, i.y, i.z);
      // The catalog's team car faces +X; the model faces +Z.
      root.rotation.y = i.rotY + Math.PI / 2;
      root.matrixAutoUpdate = false;
      root.updateMatrix();
      root.visible = false;
      this.group.add(root);
      const team = i.variant % TEAM_COUNT;
      return {
        id: parkCarId(team),
        team,
        raised: i.variant >= TEAM_COUNT,
        x: i.x,
        z: i.z,
        root,
        lods: [],
        lod: -2,
      };
    });
  }

  /**
   * Resolves once the car models are in (the cars appear on their own; loading screens wait for this). The models load when
   * the focus first comes near the park (`update`), so call that before waiting.
   */
  get ready(): Promise<void> {
    return this.loading;
  }

  /** Pick each car's LOD from its distance to `focus`; `enabled` false hides them all. */
  update(focus: Vector3, enabled = true): void {
    this.focus.copy(focus);
    this.enabled = enabled;
    let nearest = Infinity;
    for (const c of this.cars)
      nearest = Math.min(nearest, Math.hypot(c.x - focus.x, c.z - focus.z));
    const reach = Math.min(
      this.opts.maxDistance ?? Infinity,
      LOD_DISTANCE[LOD_DISTANCE.length - 1] * this.opts.lodScale,
    );
    const plan = parkCarsPlan(nearest, reach, this.state !== 'idle');
    if (plan === 'load') this.load();
    else if (plan === 'unload' && this.state === 'ready') this.unload();
    this.apply();
  }

  private load(): void {
    this.state = 'loading';
    const ids = new Set(this.cars.map((c) => c.id));
    this.loading = Promise.all([...ids].map(loadKit)).then(() => {
      // Left again (unloaded) while the files were coming in: nothing to show.
      if (this.state !== 'loading') return;
      this.state = 'ready';
      this.apply();
    });
  }

  /** Drop the models, their liveries and every LOD built from them (`load` brings them back). */
  private unload(): void {
    for (const c of this.cars) {
      for (const g of c.lods) if (g) c.root.remove(g);
      c.lods = [];
      c.lod = -2;
      c.root.visible = false;
    }
    for (const id of new Set(this.cars.map((c) => c.id))) releaseKit(id);
    this.state = 'idle';
    this.loading = Promise.resolve();
  }

  private apply(): void {
    if (!isFinite(this.focus.x)) return;
    const scale = this.opts.lodScale;
    const maxD = this.opts.maxDistance ?? Infinity;
    for (const c of this.cars) {
      const kit = loaded.get(c.id);
      if (!kit) continue;
      const d = Math.hypot(c.x - this.focus.x, c.z - this.focus.z);
      let lod = -1;
      if (this.enabled && d <= maxD)
        for (let i = 0; i < LOD_DISTANCE.length; i++)
          if (d < LOD_DISTANCE[i] * scale) {
            lod = i;
            break;
          }
      if (lod === c.lod) continue;
      c.lod = lod;
      if (lod >= 0) this.show(c, kit, lod);
      for (let i = 0; i < c.lods.length; i++)
        if (c.lods[i]) c.lods[i]!.visible = i === lod;
      c.root.visible = lod >= 0;
    }
  }

  private show(c: ParkCar, kit: Kit, lod: number): Group {
    let g = c.lods[lod];
    if (g) return g;
    g = new Group();
    const body = new Mesh(kit.paint[lod], liveryMaterial(kit.def, c.team));
    body.position.y = kit.lift + (c.raised ? RAISE : 0);
    const rest = new Mesh(
      poseGeometry(kit, lod, c.raised),
      lod < GLASS_LODS ? [parts(), glass()] : parts(),
    );
    for (const m of [body, rest]) {
      m.castShadow = lod < 2;
      m.receiveShadow = true;
      g.add(m);
    }
    g.visible = false;
    c.lods[lod] = g;
    c.root.add(g);
    return g;
  }

  /** Build every car at every LOD and show it all, so the shader compile and first render cover them. */
  prewarm(): void {
    for (const c of this.cars) {
      const kit = loaded.get(c.id);
      if (!kit) continue;
      for (let lod = 0; lod < LOD_DISTANCE.length; lod++)
        this.show(c, kit, lod).visible = true;
      c.root.visible = true;
    }
  }

  /** Back to the LODs the focus asks for (after `prewarm`). */
  settle(): void {
    for (const c of this.cars) c.lod = -2;
    this.apply();
  }

  /** Cars drawn now (stats). */
  get drawn(): number {
    return this.cars.filter((c) => c.root.visible).length;
  }

  dispose(): void {
    this.group.removeFromParent();
    if (this.state === 'ready') this.unload();
  }
}
