import {
  AxesHelper,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  Quaternion,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { autoHull, type Vehicle } from '../../physics/vehicle';
import { BodyShape, endCaps, loft } from './car-body';
import { buildCarParts, type CarPartGeometry } from './car-parts';
import { hasImportedModel, loadImportedCar } from './car-gltf';
import { paintLivery, type LiveryInfo } from './livery';
import { tyreSizeFor } from '../../physics/car-tyres';
import type { TyreId } from '../../physics/tyres';
import {
  buildBrakeGeometries,
  hasWheelModel,
  loadRimUnit,
  RIM_UNIT_BARREL,
} from './stl-wheel';
import { buildTyre, rimRadius } from './tyre-mesh';
import { partMaterial } from './part-materials';
import {
  badgeMaterial,
  buildBadgeGeometry,
  type BadgeTarget,
  type RallyBadge,
} from './rally-badge';
import type { CarAtlas, CarDef } from './types';

/**
 * Procedural car model built from CarDef.model.
 *
 *  root (physics body frame: origin = centre of mass)
 *   ├─ body   (model space: y = 0 ground at static ride height), offset -comHeight
 *   │    lofted lower body + greenhouse (livery), end caps (base paint),
 *   │    parts (car-parts.ts): plain paint, trim, carbon, mesh, glass, lights, tail,
 *   │    cockpit (interior, cage, headliner) seen through cut-out windows
 *   └─ wheels: 3 InstancedMeshes x 4 instances (tyre, rim+disc, caliper); STL wheels
 *      (model.wheelModel, stl-wheel.ts) add a 4th for the brake disc
 *
 * ~16 draw calls per car. Materials marked "shared" are module-level and
 * reused by every car; only paint + livery texture are per car.
 */
export interface CarModelOptions {
  /** Livery seed (0 = the car's default paint). */
  seed?: number;
  /** Override base paint colour. */
  paint?: string;
  /** Rally door plates (number + rally name) on both front doors; none if omitted. */
  badge?: RallyBadge;
  /** Fitted tyre compound (tread, rim size, compound ring); none = plain default-size tyre (tool pages). */
  tyre?: TyreId | null;
}

// --- shared materials ------------------------------------------------------------
// Decal-type materials (they sit a few mm above the body) get a depth bias.
const decal = {
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -2,
};
const glassMat = new MeshStandardMaterial({
  color: 0x1c2630,
  metalness: 0.3,
  roughness: 0.04,
  envMapIntensity: 1.8,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  ...decal,
});
const interiorMat = new MeshStandardMaterial({
  color: 0x2a2c30,
  roughness: 0.9,
});
const cageMat = new MeshStandardMaterial({
  color: 0xd6d8db,
  roughness: 0.45,
  metalness: 0.2,
});
const liningMat = new MeshStandardMaterial({
  color: 0x303236,
  roughness: 0.95,
  side: BackSide,
});
const trimMat = new MeshStandardMaterial({
  color: 0x151515,
  roughness: 0.8,
  side: DoubleSide,
  ...decal,
});
const carbonMat = new MeshStandardMaterial({
  color: 0x1b1d22,
  roughness: 0.36,
  metalness: 0.35,
  side: DoubleSide,
  ...decal,
});
const lightMat = new MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff2d6,
  emissiveIntensity: 0.6,
  metalness: 0.8,
  roughness: 0.12,
  ...decal,
});
// Unlit lamp lenses: deep glossy colour, a little glow (ribbed lens geometry gives the sparkle).
const tailMat = new MeshStandardMaterial({
  color: 0x720709,
  emissive: 0xff1a10,
  emissiveIntensity: 0.14,
  metalness: 0.1,
  roughness: 0.16,
  ...decal,
});
const amberMat = new MeshStandardMaterial({
  color: 0xb85806,
  emissive: 0xff8a10,
  emissiveIntensity: 0.12,
  metalness: 0.1,
  roughness: 0.18,
  ...decal,
});
const chromeMat = new MeshStandardMaterial({
  color: 0xdfe3e8,
  metalness: 1,
  roughness: 0.2,
  envMapIntensity: 1.4,
});
/** Clear lamp glass over a chrome reflector. */
const lensMat = new MeshStandardMaterial({
  color: 0xdde4ea,
  metalness: 0,
  roughness: 0.06,
  envMapIntensity: 1.8,
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});
let cellTex: CanvasTexture | undefined;
/**
 * Lamp optics: a fine grid of small cells (bright rims, dark centres) - the pattern you see
 * through a tail-lamp lens. Grey, tinted by the material colour; UVs of lamp parts are in metres.
 */
function lampCellTexture(): CanvasTexture {
  if (cellTex) return cellTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a5a5a';
  g.fillRect(0, 0, 32, 32);
  for (const [x, y] of [
    [0, 0],
    [16, 0],
    [8, 16],
    [24, 16],
    [-8, 16],
  ]) {
    const r = g.createRadialGradient(x + 8, y + 8, 1, x + 8, y + 8, 9);
    r.addColorStop(0, '#2a2a2a');
    r.addColorStop(0.6, '#8c8c8c');
    r.addColorStop(0.85, '#ffffff');
    r.addColorStop(1, '#5a5a5a');
    g.fillStyle = r;
    g.fillRect(x, y, 16, 16);
  }
  cellTex = new CanvasTexture(c);
  cellTex.wrapS = cellTex.wrapT = RepeatWrapping;
  // 32 px tile = 2 x 2 cells of ~6 mm.
  cellTex.repeat.set(80, 80);
  cellTex.anisotropy = 4;
  return cellTex;
}

/** Mark a lamp material as a brake light: its emissive intensity goes from today's value to `on` when braking. */
function markBrakeLamp<M extends Material & { emissiveIntensity: number }>(
  m: M,
  on: number,
): M {
  m.userData.brakeLamp = { off: m.emissiveIntensity, on };
  return m;
}

/**
 * Tinted lamps: a coloured metallic reflector (facets catch the sky like the cells of a real
 * lamp) under a thin glossy tinted lens - reads as translucent plastic with depth.
 */
const tintedReflector = (color: number, glow: number) =>
  new MeshStandardMaterial({
    color,
    map: lampCellTexture(),
    emissive: color,
    emissiveIntensity: glow,
    metalness: 0.6,
    roughness: 0.32,
    envMapIntensity: 1.2,
  });
const tintedLens = (color: number, opacity: number) =>
  new MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.03,
    envMapIntensity: 2,
    transparent: true,
    opacity,
    depthWrite: false,
  });
const redReflectorMat = tintedReflector(0x5c0509, 0.08);
const amberReflectorMat = tintedReflector(0x9a4c06, 0.08);
const redLensMat = tintedLens(0x8a0a14, 0.24);
// Brake lamps: glow off / with the brake pedal down (CarModel.setBrake).
markBrakeLamp(tailMat, 3);
markBrakeLamp(redReflectorMat, 2.2);
markBrakeLamp(redLensMat, 2.7);
const amberLensMat = tintedLens(0xd88214, 0.24);
/** Tyres: vertex colours (rubber, compound ring, road dust) - cars/shared/tyre-mesh.ts. */
const tireVertexMat = new MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.95,
});
const discMat = new MeshStandardMaterial({
  color: 0x5a5d61,
  roughness: 0.6,
  metalness: 0.45,
});
const caliperMat = new MeshStandardMaterial({
  color: 0xc81e1e,
  roughness: 0.45,
  metalness: 0.3,
});
/** The shared wheel materials (the setup screen's parts bench draws the same tyres / rims / brakes). */
export const wheelMaterials = {
  get tire() {
    return tireVertexMat;
  },
  get disc() {
    return discMat;
  },
  get caliper() {
    return caliperMat;
  },
};
const suspensionMat = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.55,
  metalness: 0.5,
});
const uprightMat = new MeshStandardMaterial({
  color: 0x2c2f33,
  roughness: 0.5,
  metalness: 0.6,
});
/** Link instances per wheel: 2 lower + 2 upper wishbone legs + 1 damper (last, coloured). */
const LINKS = 5;
let meshMat: MeshStandardMaterial | undefined;

/** Black grille mesh (diamond holes); UVs of mesh parts are in metres. */
function getMeshMaterial(): MeshStandardMaterial {
  if (meshMat) return meshMat;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#050505';
  ctx.beginPath();
  ctx.moveTo(16, 3);
  ctx.lineTo(29, 16);
  ctx.lineTo(16, 29);
  ctx.lineTo(3, 16);
  ctx.closePath();
  ctx.fill();
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.anisotropy = 4;
  meshMat = new MeshStandardMaterial({
    map: tex,
    roughness: 0.7,
    metalness: 0.4,
    side: DoubleSide,
    ...decal,
  });
  return meshMat;
}

export class CarModel {
  readonly root = new Group();
  readonly body = new Group();
  readonly livery: LiveryInfo;
  readonly debug = new Group();
  readonly shape: BodyShape;
  /** Resolves true when an imported glTF body replaced the procedural one. */
  readonly imported: Promise<boolean>;
  private disposed = false;
  /** Painted body surfaces (body space) the door plates are projected onto; resolves after an import. */
  private paintTargets: Promise<BadgeTarget[]>;
  private badgeMeshes: Mesh[] = [];
  private badgeKey = '';
  private importedPaint: BadgeTarget[] = [];
  private owned: (Material | Texture | BufferGeometry)[] = [];
  /** This car's own copies of its brake-lamp materials (collected on the first setBrake / after the import). */
  private brakeLamps?: MeshStandardMaterial[];
  private brakeLevel = 0;
  /** Fitted compound (null = plain tyre). */
  private tyre: TyreId | null;
  /** The wheel geometries currently on the instanced meshes (owned here, replaced by `refreshWheels`). */
  private wheelGeoms: BufferGeometry[];
  /** Rim of the wheel GLB in unit space once loaded (STL wheels). */
  private stlRim: BufferGeometry | null = null;
  private calMat: MeshStandardMaterial;
  private tires: InstancedMesh;
  private rims: InstancedMesh;
  private calipers: InstancedMesh;
  /** Brake discs of STL wheels (static like the calipers: they are round). */
  private discs?: InstancedMesh;
  /** Optional suspension detail (model.suspension): hub uprights follow the wheel, links join them to the body. */
  private uprights?: InstancedMesh;
  private links?: InstancedMesh;
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();
  private tmpD = new Vector3();
  private tmpE = new Vector3();
  private m = new Matrix4();
  private q = new Quaternion();
  private flip = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI,
  );
  private tmpQ = new Quaternion();
  private tmpQ2 = new Quaternion();
  private rodScale = new Vector3(1, 1, 1);
  private one = new Vector3(1, 1, 1);
  readonly wheelPos: Vector3[];
  readonly wheelSteer = [0, 0, 0, 0];
  readonly wheelSpin = [0, 0, 0, 0];

  constructor(
    readonly def: CarDef,
    opts: CarModelOptions = {},
  ) {
    const p = def.physics;
    this.root.name = `car ${def.id}`;
    this.body.position.y = -p.comHeight;
    this.root.add(this.body);

    const { texture, info } = paintLivery(def, opts.seed ?? 0, opts.paint);
    this.livery = info;
    const satin = def.model.paintFinish === 'satin';
    const paintMat = new MeshPhysicalMaterial({
      map: texture,
      metalness: satin ? 0.1 : 0.25,
      roughness: satin ? 0.62 : 0.42,
      clearcoat: satin ? 0.25 : 1,
      clearcoatRoughness: satin ? 0.45 : 0.1,
    });
    const plainMat = new MeshPhysicalMaterial({
      color: new Color(info.base),
      metalness: satin ? 0.1 : 0.25,
      roughness: satin ? 0.62 : 0.42,
      clearcoat: satin ? 0.25 : 1,
      clearcoatRoughness: satin ? 0.45 : 0.1,
    });
    const carGlass = def.model.glass
      ? new MeshStandardMaterial({
          color: def.model.glass.color,
          metalness: 0.3,
          roughness: 0.04,
          envMapIntensity: 1.8,
          transparent: true,
          opacity: def.model.glass.opacity,
          depthWrite: false,
          ...decal,
        })
      : glassMat;
    if (carGlass !== glassMat) this.owned.push(carGlass);
    const rimMat = new MeshStandardMaterial({
      color: def.model.rim.color,
      metalness: 0.75,
      roughness: 0.32,
    });
    this.owned.push(texture, paintMat, plainMat, rimMat);

    this.shape = new BodyShape(def);
    const addParts = (g: CarPartGeometry) => [
      this.addMesh(g.plain, plainMat),
      this.addMesh(g.trim, trimMat),
      this.addMesh(g.carbon, carbonMat),
      this.addMesh(g.mesh, getMeshMaterial()),
      this.addMesh(g.glass, carGlass),
      this.addMesh(g.lights, lightMat),
      this.addMesh(g.tail, tailMat),
      this.addMesh(g.amber, amberMat),
      this.addMesh(g.interior, interiorMat),
      this.addMesh(g.cage, cageMat),
      this.addMesh(g.lining, liningMat, false),
      ...(g.chrome ? [this.addMesh(g.chrome, chromeMat)] : []),
      ...(g.lens ? [this.addMesh(g.lens, lensMat, false)] : []),
      ...(g.redReflector
        ? [this.addMesh(g.redReflector, redReflectorMat)]
        : []),
      ...(g.amberReflector
        ? [this.addMesh(g.amberReflector, amberReflectorMat)]
        : []),
      ...(g.redLens ? [this.addMesh(g.redLens, redLensMat, false)] : []),
      ...(g.amberLens ? [this.addMesh(g.amberLens, amberLensMat, false)] : []),
    ];
    const custom = def.model.custom;
    let procedural: Mesh[];
    let proceduralPaint: Mesh[];
    if (custom) {
      // Hand-built body: its own painted shell (atlas texture) + parts.
      const built = custom.build(def);
      procedural = [
        this.addMesh(
          built.paint,
          this.atlasMaterial(
            custom.atlas,
            info,
            opts.seed ?? 0,
            def.model.paintFinish ?? 'gloss',
          ),
        ),
        ...addParts(built.parts),
      ];
      proceduralPaint = procedural.slice(0, 1);
    } else {
      const lower = this.shape.lower.slices;
      procedural = [
        this.addMesh(
          loft(lower, () => 0, 1),
          paintMat,
        ),
        // End caps (nose / tail panels) use the solid base paint, not the livery atlas.
        this.addMesh(endCaps(lower), plainMat),
        this.addMesh(
          loft(this.shape.cabin.slices, this.shape.cabinQuad, 1),
          paintMat,
        ),
        ...addParts(buildCarParts(def, this.shape)),
      ];
      proceduralPaint = [procedural[0], procedural[2]];
    }
    const meshTargets = (meshes: Mesh[]): BadgeTarget[] =>
      meshes.map((m) => ({ geometry: m.geometry, matrix: m.matrix.clone() }));
    // Imported model (if present) replaces the procedural body once loaded. The procedural body is
    // only a fallback for a failed load: never show it while the real model is downloading.
    const willImport = hasImportedModel(def);
    if (willImport) for (const m of procedural) m.visible = false;
    this.imported = willImport
      ? loadImportedCar(def)
          .then((obj) => {
            if (this.disposed) return false;
            const atlas = def.model.gltf?.atlas;
            const matte = def.model.gltf?.matte;
            const painted: Mesh[] = [];
            if (atlas) {
              const mat = this.atlasMaterial(
                atlas,
                info,
                opts.seed ?? 0,
                matte ? 'matte' : 'gloss',
              );
              // The livery goes on the body; named parts (glass, trim, lamps...) keep
              // their own materials, so the paint can never bleed onto them.
              obj.traverse((o) => {
                const mesh = o as Mesh;
                if (!mesh.isMesh) return;
                const part = partMaterial((mesh.material as Material).name);
                mesh.material = part ?? mat;
                if (!part && mesh.visible) painted.push(mesh);
              });
            } else {
              obj.traverse((o) => {
                if ((o as Mesh).isMesh && o.visible) painted.push(o as Mesh);
              });
            }
            // Plate targets in body space (obj has no parent yet, so matrixWorld = obj -> body).
            obj.updateMatrixWorld(true);
            this.importedPaint = painted.map((m) => ({
              geometry: m.geometry,
              matrix: m.matrixWorld.clone(),
            }));
            this.body.add(obj);
            this.brakeLamps = undefined;
            for (const m of procedural) m.visible = false;
            if (def.model.gltf?.addOns)
              addParts(buildCarParts(def, this.shape, true));
            return true;
          })
          .catch((e) => {
            console.warn(
              `[car] ${def.id}: imported model failed, using procedural`,
              e,
            );
            for (const m of procedural)
              m.visible = m.geometry.getAttribute('position').count > 0;
            return false;
          })
      : Promise.resolve(false);
    this.paintTargets = this.imported.then((ok) =>
      ok ? this.importedPaint : meshTargets(proceduralPaint),
    );
    if (opts.badge) this.setBadge(opts.badge);

    // Wheels: tyre (size + tread per compound) + rim + brakes, see buildWheelSet. A converted STL rim
    // (model.wheelModel) swaps in once loaded; its brake discs are built right away.
    this.tyre = opts.tyre ?? null;
    const wheel = buildWheelSet(def, this.tyre, null);
    this.wheelGeoms = [wheel.tire, wheel.rim, wheel.caliper];
    const wheelModel = def.model.wheelModel;
    let wheelsLoaded: Promise<unknown> = Promise.resolve();
    this.tires = this.instanced(wheel.tire, tireVertexMat);
    this.rims = this.instanced(wheel.rim, rimMat);
    this.calMat = caliperMat;
    if (def.model.rim.caliper) {
      this.calMat = caliperMat.clone();
      this.calMat.color.set(def.model.rim.caliper);
      this.owned.push(this.calMat);
    }
    this.calipers = this.instanced(wheel.caliper, this.calMat);
    if (hasWheelModel(wheelModel) && wheel.disc) {
      this.wheelGeoms.push(wheel.disc);
      this.discs = this.instanced(wheel.disc, discMat);
      wheelsLoaded = loadRimUnit(wheelModel)
        .then((unit) => {
          if (this.disposed) {
            unit.dispose();
            return;
          }
          this.owned.push(unit);
          this.stlRim = unit;
          this.refreshWheels();
        })
        .catch((e) =>
          console.warn(`[car] ${def.id}: wheel model failed, procedural`, e),
        );
    }
    if (def.model.suspension) {
      const up = buildSuspensionGeometries(p.wheelRadius, p.wheelWidth);
      this.owned.push(up.upright, up.link);
      this.uprights = this.instanced(up.upright, uprightMat);
      this.links = new InstancedMesh(up.link, suspensionMat, LINKS * 4);
      this.links.castShadow = true;
      this.links.frustumCulled = false;
      const c = new Color();
      const damper =
        typeof def.model.suspension === 'object'
          ? def.model.suspension.damper
          : 0xd4a017;
      for (let i = 0; i < LINKS * 4; i++)
        this.links.setColorAt(i, c.set(i % LINKS === 4 ? damper : 0x303338));
      this.root.add(this.links);
    }
    const restY = p.wheelRadius - p.comHeight;
    this.wheelPos = [
      new Vector3(p.front.track / 2, restY, p.front.z),
      new Vector3(-p.front.track / 2, restY, p.front.z),
      new Vector3(p.rear.track / 2, restY, p.rear.z),
      new Vector3(-p.rear.track / 2, restY, p.rear.z),
    ];
    this.syncWheels();

    // Show the car in one piece: while the imported body / wheel model download, hide the
    // wheels, brakes and suspension too, so they never float on their own in the scene.
    if (willImport || hasWheelModel(wheelModel)) {
      const parts = [...this.root.children];
      for (const o of parts) o.visible = false;
      void Promise.allSettled([this.imported, wheelsLoaded]).then(() => {
        if (!this.disposed) for (const o of parts) o.visible = true;
      });
    }

    this.debug.visible = false;
    this.root.add(this.debug);
    this.buildDebug();
  }

  /**
   * Rally door plates on both front doors (car number + rally name); undefined removes them.
   * Built once the body is final (after an imported model loads).
   */
  setBadge(badge: RallyBadge | undefined): void {
    const key = badge ? `${badge.number}|${badge.rally}` : '';
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    this.clearBadge();
    if (!badge) return;
    void this.paintTargets.then((targets) => {
      if (this.disposed || this.badgeKey !== key) return;
      this.clearBadge();
      const mat = badgeMaterial(badge);
      for (const side of [1, -1] as const) {
        const g = buildBadgeGeometry(targets, this.def, side);
        if (!g.getAttribute('position')?.count) {
          g.dispose();
          continue;
        }
        const mesh = new Mesh(g, mat);
        mesh.receiveShadow = true;
        mesh.name = 'rally badge';
        this.body.add(mesh);
        this.badgeMeshes.push(mesh);
      }
      if (!this.badgeMeshes.length) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  private clearBadge(): void {
    const mat = this.badgeMeshes[0]?.material as
      MeshStandardMaterial | undefined;
    for (const m of this.badgeMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    mat?.map?.dispose();
    mat?.dispose();
    this.badgeMeshes = [];
  }

  /** Paint material with the livery painted at runtime onto atlas UVs (imported / custom bodies). */
  private atlasMaterial(
    atlas: CarAtlas,
    info: LiveryInfo,
    seed: number,
    finish: 'gloss' | 'satin' | 'matte',
  ): MeshPhysicalMaterial {
    const matte = finish === 'matte';
    const satin = finish === 'satin';
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    atlas.paint(canvas.getContext('2d')!, info, seed);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.flipY = false; // glTF UV convention
    map.anisotropy = 8;
    const mat = new MeshPhysicalMaterial({
      map,
      metalness: matte ? 0 : satin ? 0.1 : 0.2,
      roughness: matte ? 0.88 : satin ? 0.58 : 0.45,
      clearcoat: matte ? 0 : satin ? 0.35 : 1,
      clearcoatRoughness: satin ? 0.4 : 0.12,
    });
    if (atlas.matteRect && !matte) {
      // Matte patch (wheel arches): rough + no clearcoat where the atlas says so.
      const [rx, ry, rw, rh] = atlas.matteRect;
      const maskTex = (body: number, patch: number) => {
        const c = document.createElement('canvas');
        c.width = atlas.width;
        c.height = atlas.height;
        const g = c.getContext('2d')!;
        g.fillStyle = `rgb(${body},${body},${body})`;
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = `rgb(${patch},${patch},${patch})`;
        g.fillRect(rx, ry, rw, rh);
        const t = new CanvasTexture(c);
        t.flipY = false;
        return t;
      };
      mat.roughness = 1;
      mat.roughnessMap = maskTex(Math.round(0.45 * 255), 255);
      mat.clearcoatMap = maskTex(255, 0);
      this.owned.push(mat.roughnessMap, mat.clearcoatMap);
    }
    this.owned.push(map, mat);
    return mat;
  }

  private addMesh(
    g: BufferGeometry,
    mat: Material | Material[],
    castShadow = true,
  ): Mesh {
    const mesh = new Mesh(g, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.visible = g.getAttribute('position').count > 0;
    this.body.add(mesh);
    this.owned.push(g);
    return mesh;
  }

  private instanced(g: BufferGeometry, mat: Material): InstancedMesh {
    const im = new InstancedMesh(g, mat, 4);
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    this.root.add(im);
    return im;
  }

  private buildDebug(): void {
    const p = this.def.physics;
    const mat = new MeshBasicMaterial({ color: 0x00ffaa, wireframe: true });
    this.owned.push(mat);
    for (const [x, y, z, r] of p.hull ?? autoHull(p)) {
      const s = new Mesh(new SphereGeometry(r, 10, 6), mat);
      s.position.set(x, y, z);
      this.debug.add(s);
      this.owned.push(s.geometry);
    }
    this.debug.add(new AxesHelper(0.8));
  }

  // --- runtime ---------------------------------------------------------------------------

  /** Push wheelPos / wheelSteer / wheelSpin into the instanced wheel meshes. */
  syncWheels(): void {
    for (let i = 0; i < 4; i++) {
      const right = i % 2 === 1;
      this.q.setFromAxisAngle(Y_AXIS, this.wheelSteer[i]);
      if (right) this.q.multiply(this.flip);
      this.m.compose(this.wheelPos[i], this.q, this.one);
      this.calipers.setMatrixAt(i, this.m);
      this.discs?.setMatrixAt(i, this.m);
      this.uprights?.setMatrixAt(i, this.m);
      if (this.links) this.syncLinks(i);
      this.tmpQ.setFromAxisAngle(
        X_AXIS,
        right ? -this.wheelSpin[i] : this.wheelSpin[i],
      );
      this.tmpQ2.copy(this.q).multiply(this.tmpQ);
      this.m.compose(this.wheelPos[i], this.tmpQ2, this.one);
      this.tires.setMatrixAt(i, this.m);
      this.rims.setMatrixAt(i, this.m);
    }
    this.tires.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
    this.calipers.instanceMatrix.needsUpdate = true;
    if (this.discs) this.discs.instanceMatrix.needsUpdate = true;
    if (this.uprights) this.uprights.instanceMatrix.needsUpdate = true;
    if (this.links) this.links.instanceMatrix.needsUpdate = true;
  }

  /** Wishbones + damper from fixed body points to the (steered, bouncing) upright of wheel i. */
  private syncLinks(i: number): void {
    const p = this.def.physics;
    const sgn = i % 2 === 0 ? 1 : -1; // +x = left
    const hub = this.wheelPos[i];
    const restY = p.wheelRadius - p.comHeight;
    const inner = -p.wheelWidth / 2 + 0.015;
    const jy = p.wheelRadius * 0.36;
    const lower = this.tmpA.set(inner, -jy, 0).applyQuaternion(this.q).add(hub);
    const upper = this.tmpB.set(inner, jy, 0).applyQuaternion(this.q).add(hub);
    const pivot = this.tmpC;
    const links = this.links!;
    let k = i * LINKS;
    const rod = (a: Vector3, b: Vector3, r: number) => {
      const len = a.distanceTo(b) || 1e-4;
      this.tmpQ.setFromUnitVectors(
        Y_AXIS,
        this.tmpD.copy(b).sub(a).divideScalar(len),
      );
      this.m.compose(
        this.tmpE.copy(a).add(b).multiplyScalar(0.5),
        this.tmpQ,
        this.rodScale.set(r, len, r),
      );
      links.setMatrixAt(k++, this.m);
    };
    const x = sgn * (Math.abs(hub.x) * 0.38);
    for (const dz of [0.2, -0.2])
      rod(lower, pivot.set(x, restY - 0.1, hub.z + dz), 0.014);
    for (const dz of [0.17, -0.17])
      rod(upper, pivot.set(x, restY + 0.2, hub.z + dz), 0.011);
    rod(
      lower,
      pivot.set(sgn * Math.abs(hub.x) * 0.66, restY + 0.44, hub.z),
      0.02,
    );
  }

  /** Copy (interpolated) physics state onto the model. alpha = render interpolation factor. */
  updateFromVehicle(v: Vehicle, alpha = 1): void {
    this.root.position.lerpVectors(v.prev.position, v.position, alpha);
    this.root.quaternion.slerpQuaternions(
      v.prev.quaternion,
      v.quaternion,
      alpha,
    );
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      v.wheelLocalPosition(w, this.wheelPos[i]);
      this.wheelSteer[i] = w.steerAngle;
      this.wheelSpin[i] = w.spin;
    }
    this.syncWheels();
  }

  triangleCount(): number {
    let n = 0;
    this.root.traverse((o) => {
      if (o instanceof Mesh && o.visible && o.parent?.visible !== false) {
        const g = o.geometry as BufferGeometry;
        const tris =
          (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        n += o instanceof InstancedMesh ? tris * o.count : tris;
      }
    });
    return n;
  }

  /**
   * Showroom pose at rest: the root sits at the set-up's centre-of-mass height (standard + `ride`, m) and the wheels
   * stay on the ground - so the body rises / sinks over them like the stage car with that suspension preset.
   */
  setRideHeight(ride: number): void {
    const p = this.def.physics;
    this.root.position.y = p.comHeight + ride;
    for (const w of this.wheelPos) w.y = p.wheelRadius - p.comHeight - ride;
    this.syncWheels();
  }

  /** Fit another compound: new tread, ring colour and (when the size differs) rim size on the same instanced meshes. */
  setTyre(tyre: TyreId | null): void {
    if (tyre === this.tyre) return;
    this.tyre = tyre;
    this.refreshWheels();
  }

  /** The instanced wheel meshes by part (debug tools: the car viewer's "Wheels" section toggles them). */
  get wheelParts(): {
    tyres: InstancedMesh;
    rims: InstancedMesh;
    brakes: InstancedMesh[];
  } {
    return {
      tyres: this.tires,
      rims: this.rims,
      brakes: this.discs ? [this.calipers, this.discs] : [this.calipers],
    };
  }

  /** Rebuild tyre / rim / brake geometry for the fitted compound and swap it in (old ones are disposed). */
  private refreshWheels(): void {
    const w = buildWheelSet(this.def, this.tyre, this.stlRim);
    for (const g of this.wheelGeoms) g.dispose();
    this.wheelGeoms = [w.tire, w.rim, w.caliper];
    this.tires.geometry = w.tire;
    this.rims.geometry = w.rim;
    this.calipers.geometry = w.caliper;
    if (this.discs && w.disc) {
      this.discs.geometry = w.disc;
      this.wheelGeoms.push(w.disc);
    }
  }

  /**
   * Brake lights: 0 = off (the lamps' faint idle glow), 1 = brake pedal fully down (bright). The car's brake-lamp
   * materials (`userData.brakeLamp`) are cloned once per CarModel, so other cars (showroom, bench) never light up.
   */
  setBrake(level: number): void {
    if (!this.brakeLamps) {
      const own = new Map<Material, MeshStandardMaterial>();
      this.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as MeshStandardMaterial;
        if (!m || Array.isArray(m) || !m.userData.brakeLamp) return;
        if (m.userData.brakeOwner === this) {
          own.set(m, m);
          return;
        }
        let c = own.get(m);
        if (!c) {
          c = m.clone();
          c.userData = { ...m.userData, brakeOwner: this };
          own.set(m, c);
          this.owned.push(c);
        }
        mesh.material = c;
      });
      this.brakeLamps = [...new Set(own.values())];
      this.brakeLevel = -1;
    }
    const l = Math.max(0, Math.min(1, level));
    if (Math.abs(l - this.brakeLevel) < 0.02) return;
    this.brakeLevel = l;
    for (const m of this.brakeLamps) {
      const { off, on } = m.userData.brakeLamp as { off: number; on: number };
      m.emissiveIntensity = off + (on - off) * l;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const g of this.wheelGeoms) g.dispose();
    this.clearBadge();
    this.root.removeFromParent();
    for (const o of this.owned) o.dispose();
    this.tires.dispose();
    this.rims.dispose();
    this.calipers.dispose();
    this.discs?.dispose();
    this.uprights?.dispose();
    this.links?.dispose();
  }
}

export interface WheelSet {
  tire: BufferGeometry;
  rim: BufferGeometry;
  caliper: BufferGeometry;
  /** Brake disc (STL wheels only). */
  disc?: BufferGeometry;
}

/**
 * Tyre + rim + brakes for a car on a compound (wheel space: axis X, outer face +X). The overall radius is always the
 * physics wheel radius; the tyre SIZE sets width, rim diameter and sidewall height (so the rim visibly switches
 * between compounds on cars with a `tyres.byCompound`). Rims: the wheel GLB's rim scaled to the size (`stlRim`, unit
 * space, null while it loads), a car's own `model.wheels` rim (Zastava), else the procedural rim.
 */
export function buildWheelSet(
  def: CarDef,
  tyre: TyreId | null,
  stlRim: BufferGeometry | null,
): WheelSet {
  const p = def.physics;
  const size = tyre ? tyreSizeFor(p, tyre) : p.tyres.size;
  const tire = buildTyre({
    radius: p.wheelRadius,
    size,
    compound: tyre,
    dust: def.model.tyreDust,
  });
  const barrel = rimRadius(size);
  const base = def.model.wheels
    ? def.model.wheels(p.wheelRadius, size.width)
    : buildWheelGeometries(
        p.wheelRadius,
        size.width,
        def.model.rim.spokes,
        def.model.rim.style,
        barrel,
      );
  base.tire.dispose();
  if (!hasWheelModel(def.model.wheelModel))
    return { tire, rim: base.rim, caliper: base.caliper };
  // Converted STL rim: its barrel (0.62 of the unit radius) = the size's rim radius; brakes follow the rim.
  const scale = barrel / RIM_UNIT_BARREL;
  const brakes = buildBrakeGeometries(scale, size.width);
  base.caliper.dispose();
  let rim = base.rim;
  if (stlRim) {
    base.rim.dispose();
    rim = stlRim.clone();
    rim.scale(size.width, scale, scale);
  }
  return { tire, rim, caliper: brakes.caliper, disc: brakes.disc };
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

// --- wheels ----------------------------------------------------------------------------------

/** Wheel geometry with its axis along X and the outer face towards +X. */
export function buildWheelGeometries(
  radius: number,
  width: number,
  spokes: number,
  style: 'spoke' | 'steel' = 'spoke',
  /** Rim barrel radius (default 0.66 x the tyre radius). */
  barrelRadius?: number,
): { tire: BufferGeometry; rim: BufferGeometry; caliper: BufferGeometry } {
  const R = radius;
  const W = width;
  const prof = [
    [R * 0.66, -W / 2],
    [R - 0.035, -W / 2],
    [R - 0.008, -W / 2 + 0.022],
    [R, -W / 2 + 0.05],
    [R, W / 2 - 0.05],
    [R - 0.008, W / 2 - 0.022],
    [R - 0.035, W / 2],
    [R * 0.66, W / 2],
  ].map(([x, y]) => new Vector2(x, y));
  const tire = new LatheGeometry(prof, 28);
  tire.rotateZ(-Math.PI / 2);

  const rimR = barrelRadius ?? R * 0.66;
  const parts: BufferGeometry[] = [];
  const barrel = new CylinderGeometry(rimR, rimR, W * 0.9, 20, 1, true);
  barrel.rotateZ(-Math.PI / 2);
  parts.push(barrel.toNonIndexed());
  const hub = new CylinderGeometry(rimR * 0.22, rimR * 0.26, 0.05, 12);
  hub.rotateZ(-Math.PI / 2);
  hub.translate(W * 0.3, 0, 0);
  parts.push(hub.toNonIndexed());
  if (style === 'steel') {
    // Pressed steel disc + domed hub cap, recessed slightly.
    // Ring of ventilation holes (real cut-outs: the dark disc behind shows through).
    const shape = new Shape();
    shape.absarc(0, 0, rimR * 0.98, 0, Math.PI * 2, false);
    const holes = Math.max(8, spokes || 12);
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * Math.PI * 2;
      const h = new Path();
      h.absarc(
        Math.cos(a) * rimR * 0.66,
        Math.sin(a) * rimR * 0.66,
        rimR * 0.075,
        0,
        Math.PI * 2,
        true,
      );
      shape.holes.push(h);
    }
    const disc = new ExtrudeGeometry(shape, {
      depth: 0.02,
      bevelEnabled: false,
      curveSegments: 8,
    });
    disc.rotateY(Math.PI / 2);
    disc.translate(W * 0.21, 0, 0);
    parts.push(disc.toNonIndexed());
    const cap = new CylinderGeometry(rimR * 0.4, rimR * 0.48, 0.05, 16);
    cap.rotateZ(-Math.PI / 2);
    cap.translate(W * 0.28, 0, 0);
    parts.push(cap.toNonIndexed());
  }
  for (let i = 0; i < (style === 'steel' ? 0 : spokes); i++) {
    const s = new BoxGeometry(0.025, rimR * 0.8, Math.min(0.05, 0.3 / spokes));
    s.translate(W * 0.3, rimR * 0.5, 0);
    s.rotateX((i / spokes) * Math.PI * 2);
    parts.push(s.toNonIndexed());
  }
  const lip = new CylinderGeometry(rimR * 1.02, rimR * 1.02, 0.02, 20, 1, true);
  lip.rotateZ(-Math.PI / 2);
  lip.translate(W * 0.36, 0, 0);
  parts.push(lip.toNonIndexed());
  const disc = new CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.025, 22);
  disc.rotateZ(-Math.PI / 2);
  disc.translate(-0.02, 0, 0);
  parts.push(disc.toNonIndexed());
  const rim = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());

  // Steel-wheel cars run drums: no visible caliper through the wheel holes.
  const caliper =
    style === 'steel'
      ? new BoxGeometry(0.001, 0.001, 0.001)
      : new BoxGeometry(0.07, 0.11, 0.2);
  if (style !== 'steel') caliper.translate(0.01, rimR * 0.62, -rimR * 0.35);
  return { tire, rim, caliper };
}

/** Hub upright (in wheel space: axis X, outer +X) and a unit link rod (radius 1, length 1 along Y). */
export function buildSuspensionGeometries(
  radius: number,
  width: number,
): { upright: BufferGeometry; link: BufferGeometry } {
  const x = -width / 2 + 0.015;
  const parts: BufferGeometry[] = [];
  const knuckle = new BoxGeometry(0.045, radius * 0.9, 0.085);
  knuckle.translate(x, 0, 0);
  parts.push(knuckle);
  const stub = new CylinderGeometry(
    radius * 0.13,
    radius * 0.13,
    width * 0.7,
    10,
  );
  stub.rotateZ(-Math.PI / 2);
  stub.translate(-width * 0.05, 0, 0);
  parts.push(stub.toNonIndexed());
  const steerArm = new BoxGeometry(0.03, 0.03, 0.14);
  steerArm.translate(x, -radius * 0.12, -0.1);
  parts.push(steerArm);
  const upright = mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
  parts.forEach((g) => g.dispose());
  return { upright, link: new CylinderGeometry(1, 1, 1, 6, 1) };
}
