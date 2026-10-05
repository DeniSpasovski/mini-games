import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { getAssetMeta } from '../assets/catalog';
import { getCar } from '../cars';
import { CarModel } from '../cars/shared/car-model';
import type { RallyBadge } from '../cars/shared/rally-badge';
import { Environment } from '../engine/environment';
import type { TyreId } from '../physics/tyres';
import { SetupBench } from './setup-bench';
import type { QualitySettings } from '../engine/quality';
import { bindCameraAspect, createRenderer } from '../engine/renderer';
import { getTexture, setTextureAnisotropy } from '../engine/textures';
import { getMap, MAPS } from '../maps';
import type { MapDef } from '../maps/shared/types';
import { testMap } from '../maps/test/map';
import { AerialTerrain } from '../world/aerial-terrain';
import { AerialTrees } from '../world/aerial-trees';
import { InstanceStreamer } from '../world/instance-streamer';
import { roadMeshJob } from '../world/road-mesh';
import { setGroundTint } from '../world/terrain-material';
import { RENDER_MARGIN, World } from '../world/world';

/** Setup screen: the car is centred on the screen, the picker rows may cover part of it (fraction of the width, + = right). */
const SETUP_SHIFT = 0;
const CAR_ENV = { ...testMap.environment, fogDensity: 0.02, sunElevation: 24 };
/**
 * Maps bigger than this (m²) get the cheap aerial preview: thinned scatter, trees as
 * green circles, everything baked into a top-down texture on a coarse mesh (a map
 * card, ~75k triangles). Smaller maps show their real terrain / trees / rocks.
 */
const LARGE_MAP_AREA = 8e6;
/** Map card: quads in the coarse terrain mesh, long side of the baked texture (px). */
const CARD_QUADS = 34000;
const CARD_TEXTURE = 2048;

/**
 * Aerial preview of one map (built once per map, kept while the menu is open).
 * `step()` builds it time-sliced: the terrain first (then the view can be shown,
 * with the stage ribbon), then roads, trees and buildings fill in.
 */
interface MapView {
  id: string;
  group: Group;
  /** Terrain / roads / scatter. Large maps: hidden, only drawn into the card. */
  detail: Group;
  /** Stage ribbon, start / finish poles, floor (+ the card mesh on large maps). */
  overlay: Group;
  center: Vector3;
  size: number;
  card?: MapCard;
  /** The view can be shown. */
  ready: () => boolean;
  /** Time-sliced build, yields true after each finished part; null when complete. */
  build: Iterator<boolean | void> | null;
  /** Large maps: free the detail meshes once the final card is baked. */
  freeDetail: () => void;
  dispose: () => void;
}

/** Large maps: the detail meshes rendered top-down into a texture on a coarse mesh. */
interface MapCard {
  mesh: Mesh;
  target: WebGLRenderTarget;
  /** World rect covered by the texture. */
  x0: number;
  z0: number;
  w: number;
  h: number;
  minY: number;
  baked: boolean;
}

/** Continue a view's build for up to `budgetMs`: 0 = nothing new, 1 = a part finished, 2 = all done. */
function step(v: MapView, budgetMs: number): number {
  const t0 = performance.now();
  let added = 0;
  while (v.build && performance.now() - t0 < budgetMs) {
    const r = v.build.next();
    if (r.done) {
      v.build = null;
      return 2;
    }
    if (r.value) added = 1;
  }
  return added;
}

/**
 * 3D backdrop for the main menu, lit by the game's sky / sun / IBL:
 *  - car mode: the selected car on a slow turntable on a gravel pad
 *  - map mode: slow aerial orbit over the selected stage (real terrain, road,
 *    scatter; the stage highlighted with start / finish poles)
 * One renderer for the whole menu; dispose() before the stage is built.
 */
export class Showroom {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 3000);
  readonly renderer: WebGLRenderer;
  /** Horizontal screen shift of the car (fraction of the width, + = right) so it clears the menu panel. */
  shift = 0.2;
  private env: Environment;
  private ground: Mesh;
  private model?: CarModel;
  /** Setup screen: the car's tyres and coil-overs, one little studio per picker box (setup-bench.ts). */
  private bench?: SetupBench;
  private benchCar = '';
  /** The picker boxes (DOM windows) the studios are rendered into. */
  private benchBoxes: { key: string; el: HTMLElement }[] = [];
  /** Tyre fitted to the turntable car (the stage's pick, set by the menu). */
  private tyre: TyreId | null = null;
  /** Ride height offset of the car's suspension preset (m): shown now (eases towards the target) and wanted. */
  private ride = 0;
  private rideTarget = 0;
  private key = '';
  private angle = 0.7;
  private running = true;
  private target = new Vector3(0, 0.75, 0);
  private pad = new Group();
  private uploadTarget = new WebGLRenderTarget(64, 64);
  private uploadCam = new PerspectiveCamera(30, 1, 2, 3000);
  private bakeCam = new OrthographicCamera();
  private maps = new Map<string, MapView>();
  /** Displayed map (undefined = car mode). */
  private mapView?: MapView;
  /** Requested map, shown once its terrain is built. */
  private wanted?: MapView;

  constructor(
    container: HTMLElement,
    private quality: QualitySettings,
  ) {
    this.renderer = createRenderer(container, quality);
    setTextureAnisotropy(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    bindCameraAspect(this.renderer, this.camera);
    this.env = new Environment(this.scene, this.renderer, CAR_ENV, {
      ...quality,
      shadowExtent: 6,
    });
    const tex = getTexture('gravel').clone();
    tex.repeat.set(40, 40);
    tex.needsUpdate = true;
    this.ground = new Mesh(
      new CircleGeometry(120, 48),
      new MeshStandardMaterial({ map: tex, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.pad.add(this.ground);
    this.scene.add(this.pad);
    this.env.update(this.target);

    let last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    requestAnimationFrame(loop);
  }

  /** Show a car (no-op if it's already shown). */
  setCar(carId: string, livery: number, badge?: RallyBadge): void {
    const key = `${carId}#${livery}`;
    if (key === this.key) {
      this.model?.setBadge(badge);
      return;
    }
    this.key = key;
    this.model?.dispose();
    const def = getCar(carId);
    const m = new CarModel(def, { seed: livery, badge, tyre: this.tyre });
    // Root = centre of mass; wheels at the set-up's static ride height (a new car starts on its set-up, no easing).
    this.ride = this.rideTarget;
    m.setRideHeight(this.ride);
    this.pad.add(m.root);
    this.model = m;
  }

  /** Fit a tyre compound on the turntable car (tread, rim size, compound ring); applies to later cars too. */
  setTyre(tyre: TyreId): void {
    this.tyre = tyre;
    this.model?.setTyre(tyre);
  }

  /** Ride height offset (m) of the chosen suspension preset: the shown car's body eases up / down over its wheels. */
  setRide(ride: number): void {
    this.rideTarget = ride;
  }

  /** Car mode (turntable). */
  showCar(): void {
    this.wanted = undefined;
    this.display(undefined);
    this.bench?.dispose();
    this.bench = undefined;
    this.benchCar = '';
    this.benchBoxes = [];
    this.shift = 0.2;
  }

  /**
   * Setup mode: the turntable car stays behind the menu (pushed further right, the boxes fill the left) and each
   * picker box (`key` = `tyre:<id>` / `susp:<id>`, a transparent DOM element) shows its own live 3D part - the car's
   * tyre on its rim or coil-over (see setup-bench.ts). Call again after the menu re-renders (the elements change); the
   * studios are only rebuilt when the car changes.
   */
  showSetup(carId: string, boxes: { key: string; el: HTMLElement }[]): void {
    this.wanted = undefined;
    this.display(undefined);
    if (this.benchCar !== carId) {
      this.bench?.dispose();
      this.bench = new SetupBench(getCar(carId));
      this.benchCar = carId;
    }
    this.benchBoxes = boxes;
    // The normal turntable ground + sky + car stay as the background (like the car screen), the pickers sit over them.
    this.shift = SETUP_SHIFT;
  }

  /**
   * Map mode: aerial view of `mapId`. Built on first use and cached (usually
   * already, by the background warm-up); otherwise the current view stays
   * until the map's terrain is built, then roads / trees / buildings fill in.
   */
  showMap(mapId: string): void {
    this.wanted = this.getMap(mapId);
    if (this.wanted.ready()) this.display(this.wanted);
  }

  private getMap(mapId: string): MapView {
    let view = this.maps.get(mapId);
    if (!view) {
      view = buildMapView(mapId, this.quality);
      view.group.visible = false;
      this.maps.set(mapId, view);
      this.scene.add(view.group);
    }
    return view;
  }

  private display(view: MapView | undefined): void {
    if (view === this.mapView) return;
    if (this.mapView) this.mapView.group.visible = false;
    this.mapView = view;
    this.pad.visible = !view;
    if (view) {
      view.group.visible = true;
      // The terrain material is shared: re-apply this map's grass tint (another map may have set it).
      setGroundTint(getMap(view.id).environment.groundTint);
      this.env.apply({
        ...getMap(view.id).environment,
        fogDensity: 0.25 / view.size,
      });
      this.env.update(view.center);
    } else {
      this.env.apply(CAR_ENV);
      this.env.update(this.target);
    }
  }

  private frame(dt: number): void {
    const c = this.renderer.domElement;
    const w = c.width || 1;
    const h = c.height || 1;
    // The requested map first (a big budget until its terrain shows - the menu doesn't
    // need 60 fps then), then warm up the other maps in the background (from the
    // welcome screen on) so switching stage is instant.
    const wanted = this.wanted;
    if (wanted?.build) {
      const r = step(wanted, wanted.ready() ? 8 : 30);
      if (r) this.finished(wanted, r === 2, true);
      if (wanted.ready()) this.display(wanted);
    } else {
      const next = MAPS.find((m) => this.maps.get(m.id)?.build !== null);
      if (next) {
        const v = this.getMap(next.id);
        const r = step(v, wanted ? 6 : 4);
        if (r) this.finished(v, r === 2, false);
      }
    }

    if (this.mapView) {
      this.mapFrame(dt, this.mapView, w, h);
      return;
    }
    this.bench?.update(dt);
    if (this.model && this.ride !== this.rideTarget) {
      // Ease to the new set-up's ride height (~0.25 s), then snap.
      const d = this.rideTarget - this.ride;
      this.ride =
        Math.abs(d) < 5e-4
          ? this.rideTarget
          : this.ride + d * Math.min(1, dt * 10);
      this.model.setRideHeight(this.ride);
    }
    this.angle += dt * 0.18;
    // Back off on narrow windows so the car still fits beside the panel.
    const dist = 8.2 * Math.max(1, 1.7 / (w / h));
    const cam = this.camera;
    cam.position.set(
      Math.sin(this.angle) * dist,
      1.9,
      Math.cos(this.angle) * dist,
    );
    cam.lookAt(this.target);
    this.render(w, h, 0.1, 3000);
    if (this.bench) this.renderBoxes();
  }

  private mapFrame(dt: number, v: MapView, w: number, h: number): void {
    this.angle += dt * 0.05;
    this.aim(this.camera, v, w / h);
    this.render(w, h, 2, v.size * 4);
  }

  /** Aerial orbit camera for a map view. */
  private aim(cam: PerspectiveCamera, v: MapView, aspect: number): void {
    const r = v.size * 0.95 * Math.max(1, 1.5 / aspect);
    cam.position.set(
      v.center.x + Math.sin(this.angle) * r,
      v.center.y + v.size * 0.7,
      v.center.z + Math.cos(this.angle) * r,
    );
    cam.lookAt(v.center);
  }

  /**
   * A part of a map view finished building. Map cards are re-baked (the requested
   * map after every part; background maps once, at the end - each bake swaps the
   * environment twice); other hidden views upload their new meshes.
   */
  private finished(v: MapView, all: boolean, wanted: boolean): void {
    if (v.card) {
      if (all || wanted || v === this.mapView) this.bake(v);
      if (all) v.freeDetail();
    } else if (v !== this.mapView) this.upload(v);
  }

  /**
   * Render a large map's detail meshes straight down into its card texture, lit
   * by the map's own environment (lighting is baked; the card mesh is unlit).
   */
  private bake(v: MapView): void {
    const card = v.card!;
    const env = getMap(v.id).environment;
    const shown = v === this.mapView;
    const prevEnv = this.env.def;
    if (!shown) this.env.apply({ ...env, fogDensity: 0 });
    setGroundTint(env.groundTint);
    const fog = this.scene.fog;
    this.scene.fog = null;
    // Only v's detail: hide the car pad, sky, other maps and v's overlay.
    this.pad.visible = false;
    this.env.sky.visible = false;
    for (const m of this.maps.values()) m.group.visible = m === v;
    v.overlay.visible = false;
    v.detail.visible = true;

    const cam = this.bakeCam;
    cam.left = -card.w / 2;
    cam.right = card.w / 2;
    cam.top = card.h / 2;
    cam.bottom = -card.h / 2;
    cam.near = 1;
    cam.far = 6000;
    // Looking straight down, screen-up = -Z: texture v = 1 at z0 (AerialTerrain UVs).
    cam.up.set(0, 0, -1);
    cam.position.set(
      card.x0 + card.w / 2,
      card.minY + 5000,
      card.z0 + card.h / 2,
    );
    cam.lookAt(card.x0 + card.w / 2, card.minY, card.z0 + card.h / 2);
    cam.updateProjectionMatrix();
    this.renderer.setRenderTarget(card.target);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    card.baked = true;

    v.detail.visible = false;
    v.overlay.visible = true;
    for (const m of this.maps.values()) m.group.visible = m === this.mapView;
    this.pad.visible = !this.mapView;
    this.env.sky.visible = true;
    this.scene.fog = fog;
    if (!shown) this.env.apply(prevEnv);
    if (this.mapView)
      setGroundTint(getMap(this.mapView.id).environment.groundTint);
  }

  /**
   * Draw a hidden map view once into a small off-screen target, so its new
   * meshes are uploaded (and shaders compiled) during the warm-up instead of
   * on the first frame the stage is selected.
   */
  private upload(v: MapView): void {
    // Only `v`: hide what is on screen (the car pad or the shown map).
    const shown = this.mapView?.group ?? this.pad;
    shown.visible = false;
    v.group.visible = true;
    const cam = this.uploadCam;
    this.aim(cam, v, 1);
    cam.far = v.size * 4;
    cam.updateProjectionMatrix();
    this.renderer.setRenderTarget(this.uploadTarget);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    v.group.visible = false;
    shown.visible = true;
  }

  /**
   * Draw every picker box's studio camera into the box's screen rectangle (scissor) over the background that was just
   * rendered - no clear, only the depth buffer - so the parts sit on the normal showroom ground and sky.
   */
  private renderBoxes(): void {
    const r = this.renderer;
    const bench = this.bench!;
    bench.scene.environment = this.scene.environment;
    const canvas = r.domElement.getBoundingClientRect();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    for (const { key, el } of this.benchBoxes) {
      const card = bench.cards.get(key);
      if (!card || !el.isConnected) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      if (b.bottom < canvas.top || b.top > canvas.bottom) continue;
      const x = b.left - canvas.left;
      const y = canvas.bottom - b.bottom; // WebGL origin is bottom-left
      r.setViewport(x, y, b.width, b.height);
      r.setScissor(x, y, b.width, b.height);
      r.clearDepth();
      card.cam.aspect = b.width / b.height;
      card.cam.updateProjectionMatrix();
      r.render(bench.scene, card.cam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, canvas.width, canvas.height);
    r.autoClear = autoClear;
  }

  private render(w: number, h: number, near: number, far: number): void {
    const cam = this.camera;
    cam.near = near;
    cam.far = far;
    // Off-centre projection: keep the subject right of the menu panel (also updates the projection).
    const shift = w > h ? this.shift : 0;
    cam.setViewOffset(w, h, -w * shift, 0, w, h);
    this.env.follow(cam.position);
    this.renderer.render(this.scene, cam);
  }

  dispose(): void {
    this.running = false;
    this.model?.dispose();
    this.bench?.dispose();
    for (const v of this.maps.values()) v.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).map?.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.env.dispose();
    this.uploadTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/**
 * Large maps: scatter thinned for the aerial view (Petralica ~190k trees ->
 * ~85k circles over the whole map) - the skipped instances are never generated;
 * rocks (not drawn up there) are dropped. `grow` = tree circle radius factor so
 * woods still cover the same ground.
 */
function previewMap(map: MapDef): { map: MapDef; grow: number } {
  const b = map.bounds;
  const k = Math.min(
    1,
    LARGE_MAP_AREA / ((b.maxX - b.minX) * (b.maxZ - b.minZ)),
  );
  const scatter = map.scatter
    .filter((r) => !r.detail && getAssetMeta(r.asset).category !== 'rocks')
    .map((r) => ({
      ...r,
      density: r.density * k,
      rows: r.rows && { ...r.rows, keep: (r.rows.keep ?? 0.93) * k },
    }));
  return { map: { ...map, scatter }, grow: Math.min(3, 1 / Math.sqrt(k)) };
}

function buildMapView(mapId: string, quality: QualitySettings): MapView {
  const map = getMap(mapId);
  const b = map.bounds;
  const large = (b.maxX - b.minX) * (b.maxZ - b.minZ) > LARGE_MAP_AREA;
  const preview = large ? previewMap(map) : undefined;
  const world = new World(preview?.map ?? map);
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const center = new Vector3(cx, world.heightAt(cx, cz), cz);
  const group = new Group();
  const detail = new Group();
  const overlay = new Group();
  group.add(detail, overlay);

  // Map rect covered by the terrain (and the card texture).
  const x0 = b.minX - RENDER_MARGIN;
  const z0 = b.minZ - RENDER_MARGIN;
  const w = b.maxX - b.minX + 2 * RENDER_MARGIN;
  const h = b.maxZ - b.minZ + 2 * RENDER_MARGIN;
  // ~8 m cells (the old aerial LOD) on small maps, 512 cells along the long side at most.
  const terrain = new AerialTerrain(
    world,
    Math.min(512, Math.ceil(Math.max(w, h) / 8)),
  );
  const road = new Group();
  const streamer = new InstanceStreamer(world, {
    lodScale: Math.max(2.5, quality.lodScale * 3),
    detailDensity: 0,
    rebuildDistance: 25,
    budgetMs: 2,
  });
  const trees = preview && new AerialTrees(world, preview.grow);
  if (trees) {
    // Trees are green circles; buildings / props stay models.
    streamer.filter = (asset) => getAssetMeta(asset).category !== 'vegetation';
    detail.add(trees.mesh);
  }
  detail.add(terrain.mesh, road, streamer.group);

  let card: MapCard | undefined;
  let cardTerrain: AerialTerrain | undefined;
  if (large) {
    detail.visible = false;
    const long = Math.max(w, h);
    const tw = Math.round((CARD_TEXTURE * w) / long);
    const th = Math.round((CARD_TEXTURE * h) / long);
    const target = new WebGLRenderTarget(tw, th, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    target.texture.anisotropy = 8;
    cardTerrain = new AerialTerrain(
      world,
      Math.floor(Math.sqrt((CARD_QUADS * long) / Math.min(w, h))),
      new MeshBasicMaterial({ map: target.texture }),
    );
    cardTerrain.mesh.receiveShadow = false;
    overlay.add(cardTerrain.mesh);
    card = {
      mesh: cardTerrain.mesh,
      target,
      x0,
      z0,
      w,
      h,
      minY: 0,
      baked: false,
    };
  }

  function* build(): Generator<boolean | void> {
    while (!terrain.update(0)) yield;
    if (cardTerrain) while (!cardTerrain.update(0)) yield;
    yield true;
    road.add(yield* roadMeshJob(world));
    yield true;
    if (trees) {
      yield* trees.job();
      yield true;
    }
    while (!streamer.commits) {
      streamer.update(center);
      yield;
    }
  }

  // Stage highlight: start -> finish drawn over the terrain + start / finish poles.
  const st = world.stage;
  // Flat ribbon (GL lines are 1 px), width scaled to the map so it reads from the air.
  const half = size / 320;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let d = st.start, i = 0; d <= st.finish; d += 4, i++) {
    const p = world.road.at(d);
    pos.push(p.x - p.tz * half, p.y + 2, p.z + p.tx * half);
    pos.push(p.x + p.tz * half, p.y + 2, p.z - p.tx * half);
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  lineGeo.setIndex(idx);
  const lineMat = new MeshBasicMaterial({
    color: 0xf0a020,
    depthTest: false,
    side: DoubleSide,
    fog: false,
  });
  const line = new Mesh(lineGeo, lineMat);
  line.renderOrder = 10;
  // Ground beyond the streamed area, so the map doesn't float in the sky.
  const floorGeo = new CircleGeometry(size * 4, 48);
  const floorMat = new MeshBasicMaterial({ color: 0x5a5c48 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  let minY = Infinity;
  for (let i = 0; i <= 16; i++)
    for (let j = 0; j <= 16; j++)
      minY = Math.min(
        minY,
        world.analytic.height(
          b.minX + ((b.maxX - b.minX) * i) / 16,
          b.minZ + ((b.maxZ - b.minZ) * j) / 16,
        ),
      );
  floor.position.set(cx, minY - 5, cz);
  if (card) card.minY = minY - 100;
  overlay.add(floor);
  const poleGeo = new CylinderGeometry(4, 4, size * 0.05, 10);
  const poleMats = [0x3ddc6a, 0xff4a3a].map(
    (color) => new MeshBasicMaterial({ color }),
  );
  [st.start, st.finish].forEach((along, i) => {
    const p = world.road.at(along);
    const m = new Mesh(poleGeo, poleMats[i]);
    m.position.set(p.x, p.y + size * 0.025, p.z);
    overlay.add(m);
  });
  overlay.add(line);

  let detailFreed = false;
  const freeDetail = () => {
    if (detailFreed) return;
    detailFreed = true;
    group.remove(detail);
    terrain.dispose();
    trees?.dispose();
    streamer.dispose();
    road.traverse((o) => (o as Mesh).geometry?.dispose());
  };
  return {
    id: mapId,
    group,
    detail,
    overlay,
    center,
    size,
    card,
    ready: () => (card ? card.baked : terrain.done),
    build: build(),
    freeDetail,
    dispose: () => {
      freeDetail();
      if (card) {
        cardTerrain!.dispose();
        (card.mesh.material as MeshBasicMaterial).dispose();
        card.target.dispose();
      }
      lineGeo.dispose();
      lineMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      poleGeo.dispose();
      poleMats.forEach((m) => m.dispose());
    },
  };
}
