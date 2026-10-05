import {
  CircleGeometry,
  Color,
  Group,
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
import {
  cardMesh,
  isLargeMap,
  LARGE_MAP_AREA,
  loadStageCard,
  mapHash,
  STAGE_CARD_VERSION,
  stageBox,
  stageOverlay,
  stagePoints,
} from '../tools/stage-card';

/**
 * Car screens (welcome, car select, setup): the car's screen shift (fraction of the width, + = right) - the same on all
 * of them, so the car doesn't move when the screen changes.
 */
const CAR_SHIFT = 0.1;
const CAR_ENV = { ...testMap.environment, fogDensity: 0.02, sunElevation: 24 };
/** Map view: camera height angle over the stage (rad), ~36 deg. */
const ORBIT_ELEVATION = Math.atan2(0.7, 0.95);
/**
 * Live map card (fallback for a large map without a baked stage card, stage-card.ts): thinned scatter, trees as
 * green circles, baked at runtime into a top-down texture on a coarse mesh. Quads in that mesh, texture long side.
 */
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
  /** Orbit centre and size (m): the stage's bounding box + margin (`stageBox`), not the whole map. */
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
  /** Baked-card view of a map that has no card (yet): build it live when it is wanted. */
  missing?: boolean;
  /** Stage line points the orbit keeps in view (`fitDistance`); empty = fit the bounding sphere (`size`). */
  fit: Vector3[];
  /** Cached orbit distance for one view shape (fov / aspect / shift). */
  fitCache?: { key: string; d: number };
}

/** Stage view: the orbit centre sits this fraction of the screen height above the middle (more sky room below). */
const MAP_LIFT = 0.06;
/** Margin around the stage line in the stage view (x its projected extent). */
const FIT_MARGIN = 1.15;
/** Orbit angles sampled for the (constant) zoom: the stage fits at every angle. */
const FIT_ANGLES = 24;

/** Every `n`-th point of a line (and the last one), so the fit stays cheap. */
function thin(points: Vector3[], max = 160): Vector3[] {
  const n = Math.max(1, Math.ceil(points.length / max));
  const out = points.filter((_, i) => i % n === 0);
  if (points.length && out[out.length - 1] !== points[points.length - 1])
    out.push(points[points.length - 1]);
  return out;
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
  /**
   * Fixed horizontal screen shift of the subject (fraction of the width, + = right; car / setup screens), or null =
   * centred in the screen area right of the menu panel (`panelRight`, the stage view).
   */
  private fixedShift: number | null = CAR_SHIFT;
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
  private preloaded = false;
  /** Displayed map (undefined = car mode). */
  private mapView?: MapView;
  /** Requested map, shown once its terrain is built. */
  private wanted?: MapView;

  constructor(
    container: HTMLElement,
    private quality: QualitySettings,
    /** Right edge of the menu panel (CSS px from the canvas' left edge); 0 = no panel. */
    private panelRight: () => number = () => 0,
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
    this.fixedShift = CAR_SHIFT;
  }

  /**
   * Setup mode: the turntable car stays where it is on the car screens (the picker boxes sit over the left) and each
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
    this.fixedShift = CAR_SHIFT;
  }

  /**
   * Map mode: aerial view of `mapId`. Built on first use and cached (usually
   * already, by the background warm-up); otherwise the current view stays
   * until the map's terrain is built, then roads / trees / buildings fill in.
   */
  showMap(mapId: string): void {
    this.fixedShift = null;
    this.preloadCards();
    this.wanted = this.getMap(mapId);
    if (this.wanted.ready()) this.display(this.wanted);
  }

  private getMap(mapId: string): MapView {
    let view = this.maps.get(mapId);
    if (!view) {
      view = isLargeMap(getMap(mapId))
        ? cardView(mapId)
        : buildMapView(mapId, this.quality);
      this.addView(view);
    }
    return view;
  }

  private addView(view: MapView): void {
    view.group.visible = false;
    this.maps.set(view.id, view);
    this.scene.add(view.group);
  }

  /** A large map without a baked card: replace its (empty) card view with a live build. */
  private buildLive(old: MapView): MapView {
    console.warn(
      `[stage card] ${old.id}: no baked card - building the view live (bake it: /games/rally/?bakecard=${old.id})`,
    );
    this.scene.remove(old.group);
    const view = buildMapView(old.id, this.quality);
    this.addView(view);
    if (this.wanted === old) this.wanted = view;
    return view;
  }

  /** Start loading every large map's baked card (cheap: two small files each, no map build). */
  private preloadCards(): void {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const m of MAPS) if (isLargeMap(m)) this.getMap(m.id);
  }

  /**
   * DEV: bake the stage cards of `ids` (stage-card-bake.ts, saved into maps/<id>/preview/ by the dev server), one
   * after another. Stops the menu loop - reload the page afterwards to see the new cards.
   */
  async bakeStageCards(ids: string[], log: (s: string) => void): Promise<void> {
    if (!import.meta.env.DEV) return; // the baker (and its chunk) never ships
    this.running = false;
    const { bakeStageCard } = await import('../tools/stage-card-bake');
    for (const id of ids)
      log(await bakeStageCard(this.renderer, this.quality, id, log));
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
    // Only the requested map is built (a big budget until its terrain shows - the menu doesn't need 60 fps then).
    // No background warm-up: large maps load a baked stage card (stage-card.ts), small ones build in ~0.1 s.
    let wanted = this.wanted;
    if (wanted?.missing) wanted = this.buildLive(wanted);
    if (wanted?.build) {
      const r = step(wanted, wanted.ready() ? 8 : 30);
      if (r) this.finished(wanted, r === 2, true);
    }
    if (wanted?.ready()) this.display(wanted);

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
  /**
   * Screen shift of the subject (fraction of the width): the centre of the area right of the menu panel - panel
   * width / 2 of the canvas width (the 440 px panel: 0.17 at 1280 px, 0.11 at 1920 px). Phones (panel over most of
   * the screen): none.
   */
  private shift(): number {
    if (this.fixedShift !== null) return this.fixedShift;
    const width = this.renderer.domElement.clientWidth || 1;
    const panel = this.panelRight();
    return panel > width * 0.6 ? 0 : panel / (2 * width);
  }

  private aim(cam: PerspectiveCamera, v: MapView, aspect: number): void {
    const d = this.fitDistance(v, cam.fov, aspect);
    const flat = d * Math.cos(ORBIT_ELEVATION);
    cam.position.set(
      v.center.x + Math.sin(this.angle) * flat,
      v.center.y + d * Math.sin(ORBIT_ELEVATION),
      v.center.z + Math.cos(this.angle) * flat,
    );
    cam.lookAt(v.center);
  }

  /**
   * Orbit distance (constant while it turns): the closest at which the whole stage line (+ FIT_MARGIN) is in view at
   * every sampled orbit angle - vertically, and horizontally in the room either side of the orbit centre (the
   * off-centre projection puts the centre `shift` of the width right, see `render`). Long thin stages come much
   * closer than with their bounding sphere (which is the fallback without fit points).
   */
  private fitDistance(v: MapView, fov: number, aspect: number): number {
    const t = Math.tan((fov * Math.PI) / 360);
    const shift = aspect > 1 ? this.shift() : 0;
    const tH = t * aspect * (1 - 2 * shift);
    // Lifted centre (MAP_LIFT, see `render`): less room above it, more below.
    const tUp = t * (1 - 2 * MAP_LIFT);
    const tDown = t * (1 + 2 * MAP_LIFT);
    const key = `${fov}|${aspect.toFixed(3)}|${shift.toFixed(3)}|${v.fit.length}`;
    if (v.fitCache?.key === key) return v.fitCache.d;
    let d: number;
    if (!v.fit.length) {
      d = v.size / 2 / Math.sin(Math.atan(Math.min(tUp, tH)));
    } else {
      d = 0;
      const ce = Math.cos(ORBIT_ELEVATION);
      const se = Math.sin(ORBIT_ELEVATION);
      for (let k = 0; k < FIT_ANGLES; k++) {
        const a = (k / FIT_ANGLES) * Math.PI * 2;
        // Camera looks along f = -(sin a ce, se, cos a ce); right = f x up; camera up = right x f.
        const fx = -Math.sin(a) * ce;
        const fy = -se;
        const fz = -Math.cos(a) * ce;
        const rl = Math.hypot(fz, fx);
        const rx = -fz / rl;
        const rz = fx / rl;
        const ux = -rz * fy;
        const uy = rz * fx - rx * fz;
        const uz = rx * fy;
        for (const p of v.fit) {
          const px = p.x - v.center.x;
          const py = p.y - v.center.y;
          const pz = p.z - v.center.z;
          const x = Math.abs(px * rx + pz * rz) * FIT_MARGIN;
          const yc = (px * ux + py * uy + pz * uz) * FIT_MARGIN;
          const y = Math.abs(yc) / (yc > 0 ? tUp : tDown);
          const z = px * fx + py * fy + pz * fz;
          d = Math.max(d, Math.max(x / tH, y) - z);
        }
      }
    }
    v.fitCache = { key, d };
    return d;
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
    const shift = w > h ? this.shift() : 0;
    // Stage view: the subject a little above the middle (MAP_LIFT); car screens: vertically centred.
    const lift = this.mapView ? h * MAP_LIFT : 0;
    cam.setViewOffset(w, h, -w * shift, lift, w, h);
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

/**
 * Map view from the map's baked stage card (stage-card.ts): nothing to build, `ready()` once the two files are loaded
 * and decoded. Marked `missing` when the map has no card yet (the menu then builds it live).
 */
function cardView(mapId: string): MapView {
  const map = getMap(mapId);
  const group = new Group();
  const detail = new Group();
  const overlay = new Group();
  group.add(detail, overlay);
  let loaded = false;
  let mesh: Mesh | undefined;
  let marks: ReturnType<typeof stageOverlay> | undefined;
  const view: MapView = {
    id: mapId,
    group,
    detail,
    overlay,
    center: new Vector3(),
    size: 1,
    ready: () => loaded,
    fit: [],
    build: null,
    freeDetail: () => {},
    dispose: () => {
      mesh?.geometry.dispose();
      (mesh?.material as MeshBasicMaterial | undefined)?.map?.dispose();
      (mesh?.material as MeshBasicMaterial | undefined)?.dispose();
      marks?.dispose();
    },
  };
  loadStageCard(mapId).then(
    (card) => {
      const d = card.data;
      if (
        import.meta.env.DEV &&
        (d.version !== STAGE_CARD_VERSION || d.hash !== mapHash(map))
      )
        console.warn(
          `[stage card] ${mapId}: out of date (map or baker changed) - re-bake: /games/rally/?bakecard=${mapId}`,
        );
      // Relief exaggeration around the card's lowest point (flat maps read better with some).
      const relief = map.previewRelief ?? 1;
      const base = d.grid.min;
      const ex = (y: number) => base + (y - base) * relief;
      mesh = cardMesh(card, relief, base);
      overlay.add(mesh);
      const points: Vector3[] = [];
      for (let i = 0; i < d.stage.length; i += 3)
        points.push(
          new Vector3(d.stage[i], ex(d.stage[i + 1]), d.stage[i + 2]),
        );
      view.center.set(d.center[0], ex(d.center[1]), d.center[2]);
      view.size = d.size;
      view.fit = thin(points);
      marks = stageOverlay({
        points,
        size: d.size,
        floor: {
          x: d.rect.x0 + d.rect.w / 2,
          y: base - 5,
          z: d.rect.z0 + d.rect.h / 2,
          radius: Math.max(d.rect.w, d.rect.h) * 4,
          color: new Color(d.floor),
        },
      });
      overlay.add(marks.group);
      loaded = true;
    },
    () => {
      view.missing = true;
    },
  );
  return view;
}

function buildMapView(mapId: string, quality: QualitySettings): MapView {
  const map = getMap(mapId);
  const b = map.bounds;
  const large = (b.maxX - b.minX) * (b.maxZ - b.minZ) > LARGE_MAP_AREA;
  const preview = large ? previewMap(map) : undefined;
  const world = new World(preview?.map ?? map);
  // Map extent (terrain floor) vs the stage: the orbit camera circles the STAGE (start -> finish bounding box),
  // not the map bounds - on maps where the stage uses a corner of the map (Ajvatovci) the view stays on it.
  const mapSize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const stage = stageBox(world);
  const size = stage.size;
  const center = new Vector3(
    stage.x,
    world.heightAt(stage.x, stage.z),
    stage.z,
  );
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

  // Stage highlight (ribbon + start / finish poles) and the floor beyond the map, at its lowest point.
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
  if (card) card.minY = minY - 100;
  const line = stagePoints(world);
  const stageMarks = stageOverlay({
    points: line,
    size,
    floor: {
      x: cx,
      y: minY - 5,
      z: cz,
      radius: mapSize * 4,
      color: new Color(0x5a5c48),
    },
  });
  overlay.add(stageMarks.group);

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
    fit: thin(line),
    build: build(),
    freeDetail,
    dispose: () => {
      freeDetail();
      if (card) {
        cardTerrain!.dispose();
        (card.mesh.material as MeshBasicMaterial).dispose();
        card.target.dispose();
      }
      stageMarks.dispose();
    },
  };
}
