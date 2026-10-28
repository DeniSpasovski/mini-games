import {
  Color,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { seconds, track, type EventParams } from '../../../shared/analytics';
import gameManifest from '../game.json';
import { CarModel } from '../cars/shared/car-model';
import { CARS, getCar } from '../cars';
import { rallyName } from '../cars/shared/rally-badge';
import type { CarDef } from '../cars/shared/types';
import { Environment } from '../engine/environment';
import { LIGHTS_MIN_NEED } from '../engine/night';
import { setHeadBeam, setLampGlow } from '../engine/night-glow';
import { LampPools } from '../world/lamp-pools';
import { PostFx, postFxFromUrl } from '../engine/post-fx';
import type { QualitySettings } from '../engine/quality';
import { bakeCropCards, setCropAntialias } from '../engine/crops';
import { setVineAntialias } from '../engine/vines';
import { bindCameraAspect, createRenderer } from '../engine/renderer';
import { setClockTime } from '../engine/stage-sign-textures';
import { setTextureAnisotropy } from '../engine/textures';
import { SURFACES, type SurfaceId } from '../physics/surfaces';
import { applySetup } from '../physics/car-setup';
import { applyGearing, hasGearings } from '../physics/gearing';
import { carGripRating } from '../physics/car-tyres';
import { brakeLevel } from '../physics/brakes';
import { TYRES, type TyreId } from '../physics/tyres';
import type { GearingId, SetupId } from '../physics/types';
import { PHYSICS_HZ, Vehicle } from '../physics/vehicle';
import { isTestCar, isTestStage, TEST_NOTE } from '../release';
import { getAssetMeta } from '../assets/catalog';
import { Breakables } from '../world/breakables';
import { PeopleAnimator } from '../world/people-anim';
import { DistanceCull } from '../world/distance-cull';
import { prefetchTextures, rememberTextures } from '../engine/texture-prefetch';
import { warmLevels } from '../world/people-warm';
import { InstanceStreamer } from '../world/instance-streamer';
import { TreeRenderer } from '../trees/draw';
import { TreeLibrary } from '../trees/load';
import { TreeStatsOverlay } from '../trees/overlay';
import { PerfPanel } from './perf-panel';
import {
  benchPath,
  checkBudget,
  compareReports,
  gpuName,
  summarize,
  waitForGpu,
  writeReport,
  type BenchRun,
  type SpikeFrame,
  type TreeBenchReport,
} from './tree-bench';
import { buildRoadMeshSliced } from '../world/road-mesh';
import { TerrainRenderer } from '../world/terrain-renderer';
import { setTerrainDetail, setTerrainRelief } from '../world/terrain-material';
import { CanopyShadows } from '../world/canopy-shadows';
import { canopyTone, FarForest } from '../world/far-forest';
import { FarShadow } from '../world/far-shadow';
import { Horizon } from '../world/horizon';
import {
  setCanopyLocalMap,
  setCanopyShadows,
  setForest,
  setNearShadowFade,
} from '../engine/world-shading';
import { World } from '../world/world';
import { CarAudio } from './audio';
import { Autopilot, finishStopControls } from './autopilot';
import { ContactShadow } from './contact-shadow';
import {
  Headlights,
  headlightMount,
  TailLight,
  tailLightMount,
} from './headlights';
import { CameraRig } from './camera-rig';
import { ParticleSystem } from './dust';
import { TyreMarks } from './tyre-marks';
import { Hud } from './hud';
import { InputController, type InputAction } from './input';
import {
  BLOOM_MIX,
  OBJECT_DISTANCE,
  RENDER_SCALE,
  type RallySettings,
  saveSettings,
} from './settings';
import {
  bestKey,
  formatDelta,
  loadTimes,
  recordTime,
  type RunRecord,
  formatTime,
  PENALTY_CUT,
  PENALTY_RESET,
  PENALTY_RESET_FLIPPED,
  FLIPPED_UP_Y,
  StageTimer,
  type StageEvent,
  carTimesVersion,
  timesVersion,
} from './stage';
import { infoOf, stageInfo } from '../maps';
import { stageSeason } from '../maps/shared/climate';
import { mapInSeason } from '../maps/shared/season-map';
import { stageClimate } from '../maps/shared/day-temperature';
import { seasonParam, type Season } from '../season';
import { slotFor } from './time-of-day';
import type { MapDef, StageDef } from '../maps/shared/types';
import { trackTemp } from '../physics/tyre-temp';
import type { TyreGaugeState } from './tyre-gauge';
import { ForceLines, Telemetry } from './telemetry';
import { paramNumber } from '../../../shared/url-params';

export interface GameOptions {
  /** The full map (`loadStage`, maps/index.ts: the baked data is loaded on demand). */
  map: MapDef;
  /** The stage driven on it (default: the map's first). */
  stage?: StageDef;
  carId: string;
  /** Livery seed. */
  livery: number;
  /** Fitted tyre compound (the stage's recommended one unless the player picked another). */
  tyre: TyreId;
  /** Suspension set-up preset of the car (the recommended one for the tyre unless the player picked another). */
  setup: SetupId;
  /** Gearing preset (physics/gearing.ts); cars with fixed gearing ignore it. */
  gearing: GearingId;
  /** "start" | flat-area name (e.g. "pad") | metres along the road. */
  spawn: string;
  quality: QualitySettings;
  /** Player options (volume, gearbox, assists, camera). */
  settings: RallySettings;
}

const STEP = 1 / PHYSICS_HZ;
/** The far shadow map fades in this far (m) before the sun's fades out: both draw over the band (`placeShadows`). */
const SHADOW_OVERLAP = 25;
/** Trees farther than this from the stage road (m) are only ever impostors (trees/draw.ts `fakeFrom`). */
const FAKE_TREES_FROM = 250;
/** A gantry clock is redrawn only while the car is this close to it along the road (m): each redraw uploads a texture. */
const CLOCK_NEAR = 400;

/** The far forest's colour on the ground: the stage's foliage, darker (a canopy seen from afar is mostly shade). */
function forestColor(lib: TreeLibrary): Color {
  const c = new Color(0, 0, 0);
  const all = lib.all();
  for (const v of all) c.add(new Color(...v.info.foliageColor));
  if (all.length) c.multiplyScalar(0.55 / all.length);
  else c.set(0x26341c);
  return c;
}

/** Terrain LOD bands at lodScale 1 (m): 1 m grid / 2 m / 4 m / 8 m beyond. */
const TERRAIN_LODS = [160, 520, 1100];
/** Extra half-angle (rad) around the camera view for scatter view culling (`InstanceStreamer.setView`). */
const VIEW_MARGIN = (25 * Math.PI) / 180;
const MAX_STEPS = 10;
/**
 * Longest frame the game simulates (s): what MAX_STEPS physics steps cover. A slower frame (a hitch) runs in slow
 * motion as a whole, so the camera, effects and audio never get ahead of the car (the car seemed to jump back).
 */
const MAX_FRAME = MAX_STEPS * STEP;

/**
 * Owns everything in a play session. Frame order:
 *   input -> fixed-step physics + stage timing -> interpolate car model ->
 *   camera -> streaming (terrain / scatter) -> effects / audio / HUD -> render
 */
export class RallyGame {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.1, 3000);
  readonly renderer: WebGLRenderer;
  readonly world: World;
  readonly car: CarDef;
  vehicle!: Vehicle;
  model!: CarModel;
  env!: Environment;
  terrain!: TerrainRenderer;
  /** The far shadow map past the sun's (world/far-shadow.ts); null on quality presets without one. */
  far: FarShadow | null = null;
  /** Hides road-group meshes beyond the terrain view distance (world/distance-cull.ts). */
  roadCull!: DistanceCull;
  contactShadow!: ContactShadow;
  /** Night only (`env.night`): the car's lights. */
  private headlights?: Headlights;
  private tailLight?: TailLight;
  /** High quality at night / dusk: glow around lamps and reflectors. */
  /** High quality post effects (bloom, AO); `__rally.post.set({ ... })` from the console. */
  post?: PostFx;
  private readonly lampColor = new Color();
  private lampPos = new Vector3();
  private lampDir = new Vector3();
  private readonly tailColor = new Color();
  private readonly tailPos = new Vector3();
  streamer!: InstanceStreamer;
  /** Season of the stage: its own, or `?season=spring|summer|autumn` (leaf colours, ground, temperatures). */
  readonly season: Season;
  /** L-system trees (trees/): their variants and the renderer drawing them. */
  treeLibrary!: TreeLibrary;
  trees!: TreeRenderer;
  private treeStats!: TreeStatsOverlay;
  /** Stage load time (init), ms. */
  loadMs = 0;
  /** Marker posts the car knocks over (drawn by the streamer). */
  breakables!: Breakables;
  /** Fans, marshals and photographers turning to follow the car. */
  people!: PeopleAnimator;
  stage!: StageTimer;
  readonly input = new InputController();
  rig!: CameraRig;
  hud!: Hud;
  dust!: ParticleSystem;
  /** Ruts / skid marks behind the wheels. */
  tyreMarks!: TyreMarks;
  /** Small dark stones flung from loose surfaces (bounce on the terrain). */
  gravel!: ParticleSystem;
  /** Big faint dust that hangs over the road for a while (medium / high quality). */
  haze?: ParticleSystem;
  private gravelAcc = [0, 0, 0, 0];
  /** Far tree shadows, filled in as the streamer generates scatter (world/canopy-shadows.ts). */
  private canopy!: CanopyShadows;
  private farForest!: FarForest;
  private hazeAcc = 0;
  audio: CarAudio;
  telemetry!: Telemetry;
  forceLines = new ForceLines();
  stats: StatsOverlay;
  paused = false;
  /** Load phase durations (ms), filled by init(). */
  loadTimings: Record<string, number> = {};
  /** F8: road-following AI drives (soak tests, screenshots). */
  autopilot?: Autopilot;
  /** Debug: the perf panel (` key / `?perf=1`, game/perf-panel.ts) while it exists. */
  perf?: PerfPanel;
  /** Scene parts the perf panel switches. */
  roadGroup?: Object3D;
  horizonGroup?: Object3D;
  private horizon?: Horizon;
  /** Called on pause / finish so the page can show menus. */
  onPauseChange?: (paused: boolean) => void;
  onFinish?: (
    time: number,
    delta: number | undefined,
    run: RunRecord,
    leaderboard: RunRecord[],
  ) => void;

  private acc = 0;
  private last = 0;
  private running = false;
  private renderPos = new Vector3();
  private renderFwd = new Vector3();
  private renderUp = new Vector3();
  private camDir = new Vector3();
  private emitAcc = [0, 0, 0, 0];
  private dustColor = new Color();
  private gravelColor = new Color();
  private lastCount = -1;
  private finishPilot?: Autopilot;
  private lastFov = 0;
  private freeDrive: boolean;

  constructor(
    private container: HTMLElement,
    readonly opts: GameOptions,
  ) {
    this.renderer = createRenderer(container, opts.quality);
    setCropAntialias(opts.quality.antialias);
    setVineAntialias(opts.quality.antialias);
    void bakeCropCards(this.renderer);
    setTextureAnisotropy(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    bindCameraAspect(this.renderer, this.camera);
    const stage = opts.stage ?? opts.map.stages[0];
    this.season = seasonParam(
      new URLSearchParams(location.search).get('season'),
      stageSeason({ season: stage.season, environment: opts.map.environment }),
    );
    this.world = new World(mapInSeason(opts.map, this.season), stage);
    this.car = getCar(opts.carId);
    this.audio = new CarAudio(this.car);
    // Any spawn other than the stage start (pad, ?spawn=<metres>) is free drive: no clock, no splits.
    this.freeDrive = opts.spawn !== 'start';
    this.stats = new StatsOverlay(this.renderer, container, false);
  }

  /** Build the world around the spawn point. Yields to the browser so the loading bar animates. */
  async init(report: (f: number, text: string) => void): Promise<void> {
    const map = this.world.map;
    const q = this.opts.quality;
    const loadStart = performance.now();
    // Textures and the people the first frame needs are made by workers while the rest loads.
    prefetchTextures(map.id);
    const objectScale =
      q.lodScale * OBJECT_DISTANCE[this.opts.settings.objectDistance];
    const spawnAt = this.world.spawn(this.opts.spawn).position;
    const people = warmLevels(
      this.world,
      spawnAt.x,
      spawnAt.z,
      objectScale,
      q.viewDistance,
    );
    // Phase timings (ms) for load-time tuning: __rally.loadTimings
    let phase = '';
    let t = performance.now();
    const progress = (f: number, text: string) => {
      const now = performance.now();
      if (phase)
        this.loadTimings[phase] = Math.round(
          (this.loadTimings[phase] ?? 0) + now - t,
        );
      phase = text.replace(/ (.*)$/, '');
      t = now;
      report(f, text);
    };
    progress(0.05, 'Sky & lighting');
    this.env = new Environment(this.scene, this.renderer, map.environment, q);
    await frame();

    // Tree variants: generated in a worker (or read from the disk cache) and their impostors baked before any
    // scatter chunk is used (their colliders come from the same skeletons).
    progress(0.08, 'Trees');
    this.treeLibrary = await TreeLibrary.load(
      TreeLibrary.speciesOf(this.world.placedAssets(), this.season),
      this.renderer,
      (f) => progress(0.08 + 0.06 * f, 'Trees'),
    );

    progress(0.15, 'Road');
    await paint();
    // The bar creeps towards the terrain step (the job's length is not known up front).
    let slices = 0;
    const road = await buildRoadMeshSliced(this.world, () => {
      progress(0.15 + 0.14 * (1 - 20 / (20 + ++slices)), 'Road');
      return frame();
    });
    this.scene.add(road);
    this.roadGroup = road;
    // Whole-map meshes: nothing past the streamed terrain (no ground under them there).
    this.roadCull = new DistanceCull(road, q.viewDistance);
    await frame();

    const spawn = this.world.spawn(this.opts.spawn);
    this.terrain = new TerrainRenderer(this.world, {
      viewDistance: q.viewDistance,
      lodDistances: TERRAIN_LODS.map((d) => d * q.lodScale) as [
        number,
        number,
        number,
      ],
      // Hills shade the valleys (both shadow maps): the low morning / evening sun on the passes.
      castShadow: true,
    });
    this.scene.add(this.terrain.group);
    // Far land beyond the streamed terrain (real maps): a backdrop drawn behind everything, ~2 draws.
    if (map.horizon) {
      const horizon = new Horizon(this.world, map.horizon);
      horizon.setCutoff(q.viewDistance);
      this.scene.add(horizon.group);
      this.horizonGroup = horizon.group;
      this.horizon = horizon;
    }
    // Terrain bump relief: medium / high only (derivative noise + cost on weak GPUs).
    setTerrainRelief(q.name === 'low' ? 0 : 1);
    // Second ground-scan taps + relief: a 45 m ring on high, 20 m on medium, none on low.
    setTerrainDetail(q.name === 'high' ? 45 : q.name === 'medium' ? 20 : 0);
    progress(0.3, 'Terrain');
    // Load everything near the start synchronously-ish (time sliced).
    for (let i = 0; i < 400; i++) {
      const done = this.terrain.update(spawn.position, 40);
      progress(
        0.3 + 0.45 * Math.min(1, i / 30),
        `Terrain (${this.terrain.chunkCount} chunks)`,
      );
      await frame();
      if (done) break;
    }

    progress(0.8, 'Vegetation & props');
    await paint();
    this.streamer = new InstanceStreamer(this.world, {
      lodScale: q.lodScale * OBJECT_DISTANCE[this.opts.settings.objectDistance],
      detailDensity: q.detailDensity,
      grassNear: q.grassNear,
      // Nothing past the streamed terrain (it would stand on nothing).
      maxDistance: q.viewDistance,
      // People close up are built ahead of the car, not all at load.
      prefetch: true,
    });
    this.scene.add(this.streamer.group);
    this.streamer.updateNow(spawn.position);
    this.trees = new TreeRenderer(this.world, this.treeLibrary, {
      lodScale:
        q.treeLodScale * OBJECT_DISTANCE[this.opts.settings.objectDistance],
      maxDistance: q.viewDistance,
      forestDistance: q.forestDistance,
      // Real tree shadows near the camera; the far shadow map's crowns, then the baked canopy shadows, take over.
      shadowDistance: q.treeShadowDistance,
      shadowExtent: q.shadowExtent,
      fakeFrom: FAKE_TREES_FROM,
    });
    this.scene.add(this.trees.group);
    this.trees.attachRenderer(this.renderer);
    this.treeStats = new TreeStatsOverlay(
      this.container,
      this.trees,
      this.treeLibrary,
    );
    // F6: tree debug view (off -> levels -> lighting only -> normals) + tree stats (trees/Lod.md#debug-view).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F6') {
        e.preventDefault();
        this.trees.cycleDebug();
      }
      // ` (backquote): the perf panel (FPS, frame steps, feature switches: game/perf-panel.ts).
      if (e.code === 'Backquote') {
        e.preventDefault();
        this.togglePerfPanel();
      }
    });
    this.canopy = new CanopyShadows(this.world, this.env.sunDir);
    this.canopy.renderer = this.renderer;
    // The canopy shell past the forest distance; with the trees (the tree benchmark hides both).
    this.farForest = new FarForest(
      this.world,
      this.treeLibrary,
      q.forestDistance,
      q.viewDistance,
    );
    this.trees.group.add(this.farForest.mesh);
    if (this.farForest.farTrees) this.trees.group.add(this.farForest.farTrees);
    // The land beyond: its woods in the stage's crown colour, inside the map the canopy map's.
    this.horizon?.setForest(
      canopyTone(this.treeLibrary, this.world),
      this.farForest.canopy,
    );
    this.updateCanopy();
    setCanopyShadows(
      this.canopy.texture,
      this.canopy.map,
      map.environment.canopyShadow ?? 0.6,
      { texture: this.canopy.local, map: this.canopy.localMap },
    );
    if (q.farShadowSize > 0)
      this.far = new FarShadow(
        this.renderer,
        this.scene,
        this.world,
        this.env.sunDir,
        q.farShadowSize,
        q.farShadowExtent,
      );
    setForest(forestColor(this.treeLibrary), q.forestDistance);
    this.breakables = new Breakables(this.world.scatter, (x, z) =>
      this.world.heightAt(x, z),
    );
    await bakeCropCards(this.renderer); // field crop cards (baked once per page)
    await this.streamer.ready; // the service park's team cars
    this.people = new PeopleAnimator(this.world.scatter.fixedInstances());
    await frame();

    progress(0.9, 'Car');
    await paint();
    this.vehicle = new Vehicle(
      applyGearing(
        applySetup(this.car.physics, this.opts.setup),
        this.opts.gearing,
      ),
      this.world,
    );
    this.vehicle.setTyre(this.opts.tyre);
    // Tyre temperatures: the stage's predefined air and road for the season at the hour drawn (`?tod=`; `?air=<°C>` to
    // try other air). The table holds at the stage start; higher up the air and the road are colder.
    const air = new URLSearchParams(location.search).get('air');
    this.vehicle.setClimate(
      stageClimate(
        stageInfo(infoOf(map), this.world.stageDef),
        this.env.hour,
        this.season,
        paramNumber(air, -60, 70, undefined),
      ),
      this.world.roadSpawn(this.world.stage.start).position.y,
    );
    this.model = new CarModel(this.car, {
      seed: this.opts.livery,
      tyre: this.opts.tyre,
    });
    this.scene.add(this.model.root);
    if (this.env.lightNeed >= LIGHTS_MIN_NEED) {
      // Lights on (night, and fading in through dusk / dawn): lamp glow, tail lamps, two spot lights and the beam in
      // the air, all scaled by how dark it is (before the first compile).
      const need = this.env.lightNeed;
      this.model.setLamps(need);
      this.headlights = new Headlights(
        this.model.root,
        headlightMount(this.car.physics),
        q.name,
        this.car.headlights,
        need,
      );
      this.tailLight = new TailLight(
        this.model.root,
        tailLightMount(this.car.physics),
        need,
      );
      // The beam starts at the model's own lamps once they are known.
      this.model.onHeadlamps((m) => this.headlights?.moveTo(m));
    }
    if (q.name === 'high')
      this.post = new PostFx(
        this.renderer,
        this.scene,
        this.camera,
        q.antialias,
        postFxFromUrl(
          this.env.lightNeed >= LIGHTS_MIN_NEED ? this.env.lightNeed : 0,
          BLOOM_MIX[this.opts.settings.bloom],
          this.opts.settings.ambientOcclusion,
        ),
      );
    setLampGlow(this.env.lightNeed);
    if (this.env.lightNeed >= LIGHTS_MIN_NEED) {
      // Street lamps: light pools on the ground under the lamps (the lens glow is the `lamp_lens` material).
      this.scene.add(
        new LampPools(
          [...this.world.scatter.fixedInstances()].filter(
            (i) => i.asset === 'street_lamp',
          ),
          (x, z) => this.world.heightAt(x, z),
          this.env.lightNeed,
        ).mesh,
      );
    }
    // Soft dark patch under the car: grounds it at any shadow resolution.
    this.contactShadow = new ContactShadow(this.vehicle, (x, z) =>
      this.world.heightAt(x, z),
    );
    this.scene.add(this.contactShadow.mesh);
    this.tyreMarks = new TyreMarks(this.vehicle);
    this.scene.add(this.tyreMarks.mesh);
    this.dust = new ParticleSystem(q.particles);
    this.dust.material.uniforms.uLight.value.setScalar(1.7);
    this.gravel = new ParticleSystem(
      Math.round(q.particles / 6),
      false,
      (x, z) => this.world.heightAt(x, z),
    );
    if (q.name !== 'low') {
      this.haze = new ParticleSystem(Math.round(q.particles / 8));
      this.haze.material.uniforms.uLight.value.setScalar(1.7);
      this.scene.add(this.haze.points);
    }
    this.lightParticles();
    this.scene.add(this.dust.points, this.gravel.points, this.forceLines.lines);
    this.rig = new CameraRig(this.camera, (x, z) => this.world.heightAt(x, z));
    this.hud = new Hud(
      this.container,
      `${this.world.stageDef.name} · ${this.car.name}`,
      isTestStage(this.world.stageDef.id) || isTestCar(this.car.id)
        ? [TEST_NOTE]
        : [],
    );
    this.hud.setFreeDrive(this.freeDrive);
    this.telemetry = new Telemetry(this.container);
    this.stage = new StageTimer(
      this.world,
      bestKey(this.world.stageDef.id, this.car.id),
    );
    this.stage.on((e) => this.onStageEvent(e));
    this.input.onAction((a) => this.onAction(a));
    this.renderer.domElement.addEventListener('resized', () =>
      this.updateParticleScale(),
    );
    this.updateParticleScale();
    this.applySettings(this.opts.settings);
    this.placeAtSpawn();
    // Warm up so the first frames don't hitch: wait for the imported car (hidden until then, so compile()
    // would skip it), then render one frame with culling off - compile() covers neither the shadow pass nor
    // the buffer uploads, and a culled render uploads only what the spawn camera sees.
    progress(0.93, 'Car model');
    await this.model.ready;
    await paint();
    this.model.updateFromVehicle(this.vehicle, 1);
    // The chase camera at the start line (it only moves in frame()): the trees are batched for where it looks from.
    this.lightParticlesByLamps(0);
    this.renderPos.copy(this.model.root.position);
    this.renderFwd.set(0, 0, 1).applyQuaternion(this.model.root.quaternion);
    this.renderUp.set(0, 1, 0).applyQuaternion(this.model.root.quaternion);
    this.rig.update(
      0,
      this.vehicle,
      this.renderPos,
      this.renderFwd,
      this.renderUp,
    );
    this.placeShadows(
      this.model.root.position,
      this.camera.getWorldDirection(this.camDir),
    );
    progress(0.94, 'People');
    await people;
    await this.streamer.whenBuilt();
    progress(0.95, 'Batching');
    this.streamer.updateNow(spawn.position);
    this.streamer.prewarm();
    this.trees.updateNow(this.camera, this.rig.steady);
    this.trees.prewarm(this.camera);
    // Every chunk the trees' first job generated, into the canopy map now (not grown in during the countdown).
    this.farForest.fillNow(this.camera.position);
    this.canopy.update(performance.now(), undefined, Infinity);
    progress(0.96, 'Compiling shaders');
    await this.renderer.compileAsync(this.scene, this.camera);
    progress(0.98, 'First frame');
    const culled: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) culled.push(o);
      o.frustumCulled = false;
    });
    this.renderer.render(this.scene, this.camera);
    this.trees.checkPrepass(this.renderer, this.scene, this.camera);
    for (const o of culled) o.frustumCulled = true;
    this.streamer.settle();
    this.trees.settle();
    // One real frame behind the loading screen: the settled batches' full instance buffers upload now, not in the
    // first frame of the stage, and the canvas shows the real scene (not the warm-up render) when the screen goes.
    this.frame(0);
    rememberTextures(map.id);
    this.loadMs = performance.now() - loadStart;
    progress(1, 'Ready');
  }

  /** Apply player options; safe to call while driving (pause-menu options). */
  applySettings(s: RallySettings): void {
    const old = this.opts.settings;
    this.opts.settings = s;
    this.audio.setVolume(s.volume);
    this.vehicle.drivetrain.automatic = s.automatic;
    this.vehicle.tractionControl = s.traction;
    this.vehicle.abs = s.abs;
    this.rig.mode = s.camera;
    // Object draw distance (options): the streamer re-buckets on its next update.
    const lodScale =
      this.opts.quality.lodScale * OBJECT_DISTANCE[s.objectDistance];
    if (this.streamer.lodScale !== lodScale)
      this.streamer.setOptions({ lodScale });
    const treeLodScale =
      this.opts.quality.treeLodScale * OBJECT_DISTANCE[s.objectDistance];
    if (this.trees.lodScale !== treeLodScale)
      this.trees.setOptions({ lodScale: treeLodScale });
    // Render scale: fewer pixels on a sharp screen (the post effects and particles follow the 'resized' event).
    const scale = RENDER_SCALE[s.renderScale];
    if (this.renderScale !== scale) {
      this.renderScale = scale;
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, this.opts.quality.maxPixelRatio) *
          scale,
      );
      this.renderer.domElement.dispatchEvent(new CustomEvent('resized'));
    }
    // Bloom / AO (High only): only a change in the options, so a test link's `?bloom=` / `?ao=` keeps its pick.
    if (old.bloom !== s.bloom) this.post?.set({ day: BLOOM_MIX[s.bloom] });
    if (old.ambientOcclusion !== s.ambientOcclusion)
      this.post?.set({ ao: s.ambientOcclusion });
    this.model.setBadge({
      number: s.carNumber,
      rally: rallyName(this.world.stageDef.name),
    });
  }

  /** Render scale applied to the pixel ratio (`applySettings`). */
  private renderScale = 1;

  private updateParticleScale(): void {
    this.lastFov = this.camera.fov;
    for (const p of [this.dust, this.gravel, this.haze])
      p?.setViewport(this.renderer.domElement.height, this.camera.fov);
  }

  /** Dust / gravel lit by the map's sun (warm at a low sun, glowing when backlit) and sky. */
  private lightParticles(): void {
    const sun = this.env.sun.color
      .clone()
      .multiplyScalar(this.env.sun.intensity / 3.1);
    // Half sky colour, half white: dust in the shade stays dust-coloured, not blue. Night: only the moon's blue.
    const ambient = this.env.night
      ? this.env.hemi.color.clone().multiplyScalar(0.25)
      : this.env.hemi.color
          .clone()
          .lerp(new Color(1, 1, 1), 0.5)
          .multiplyScalar(0.65);
    for (const p of [this.dust, this.gravel, this.haze])
      p?.setLight(sun, ambient);
  }

  /**
   * Night: dust, spray and haze glow in the headlight beam and red behind the car, the road markers glow in the beam, and
   * the tail light's red spill follows the brake pedal (`brake` 0..1). The lamps follow the car, so this runs every frame.
   */
  private lightParticlesByLamps(brake: number): void {
    const root = this.model.root;
    root.updateMatrixWorld();
    const c = this.headlights?.color;
    if (c) {
      this.lampPos.set(0, 0.7, 2).applyMatrix4(root.matrixWorld);
      this.lampDir.set(0, -0.02, 1).transformDirection(root.matrixWorld);
      this.lampColor.copy(c).multiplyScalar(this.env.lightNeed);
      for (const p of [this.dust, this.gravel, this.haze])
        p?.setHeadlight(this.lampColor, this.lampPos, this.lampDir);
      // Reflectors and reflective boards in the beam.
      setHeadBeam(this.lampColor, this.lampPos, this.lampDir);
    }
    if (this.tailLight) {
      this.tailLight.setBrake(brake);
      const at = tailLightMount(this.car.physics);
      this.tailPos.set(at.x, at.y, at.z).applyMatrix4(root.matrixWorld);
      this.tailColor
        .setRGB(1, 0.05, 0.03)
        .multiplyScalar(this.env.lightNeed * (0.1 + 0.9 * brake));
      for (const p of [this.dust, this.gravel, this.haze])
        p?.setTaillight(this.tailColor, this.tailPos);
    }
  }

  /** Name of the stage surface the fitted tyre grips worst ("gravel"), or null when it is fine on all of them. */
  private wrongTyreSurface(): string | null {
    // The recommended tyre is the stage's own answer: never nag about it (it may be poor on part of the road).
    if (this.opts.tyre === this.world.stageDef.tyre) return null;
    const road = this.world.map.road;
    let worst: SurfaceId | null = null;
    let worstRating = 2; // only "poor" (1) or "bad" (0) counts as wrong
    for (const s of new Set([
      road.surface,
      ...(road.sections ?? []).map((x) => x.surface),
    ])) {
      const r = carGripRating(this.vehicle.def, this.opts.tyre, s);
      if (r < worstRating) {
        worst = s;
        worstRating = r;
      }
    }
    return worst ? SURFACES[worst].name.toLowerCase() : null;
  }

  placeAtSpawn(): void {
    const spawn = this.world.spawn(this.opts.spawn);
    this.vehicle.reset(spawn.position, spawn.heading);
    this.vehicle.resetTyreTemps();
    this.tyreMarks?.breakStrips();
    this.rig.snap();
    this.breakables.reset((inst) => this.streamer.setMatrix(inst, null));
    this.people.reset((inst, m) => this.streamer.setMatrix(inst, m));
    if (this.freeDrive) {
      this.stage.freeDrive();
      this.hud.message('FREE DRIVE', 2, 'small');
    } else {
      this.stage.reset();
    }
    this.lastCount = -1;
    this.finishPilot = undefined;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.audio.setPaused(this.paused);
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      // rAF's timestamp can precede the performance.now() taken in start(): never step backwards.
      const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    this.audio.setPaused(true);
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.input.enabled = !p;
    this.audio.setPaused(p || !this.running);
    this.onPauseChange?.(p);
  }

  restart(): void {
    this.trackQuit('restart');
    this.opts.spawn = this.freeDrive ? this.opts.spawn : 'start';
    this.placeAtSpawn();
    this.setPaused(false);
  }

  private gaugeState: TyreGaugeState = {
    temps: [0, 0, 0, 0],
    window: TYRES.mixed.temp,
    brakes: [0, 0, 0, 0],
    discs: [0, 0, 0, 0],
    steer: 0,
    air: 0,
    track: 0,
  };

  /** HUD tyre temperatures (none without a climate / tyre). */
  private tyreGaugeState(): TyreGaugeState | undefined {
    const v = this.vehicle;
    if (!v.climate || !v.tyre) return undefined;
    const g = this.gaugeState;
    const temps = g.temps as number[];
    v.wheels.forEach((w, i) => {
      temps[i] = w.temp;
      (g.brakes as number[])[i] = brakeLevel(w.brakeTemp, w.brake);
      (g.discs as number[])[i] = w.brakeTemp;
    });
    g.window = TYRES[v.tyre].temp;
    g.steer = v.wheels[0].steerAngle;
    g.air = v.climate.air;
    g.track = trackTemp(v.climate, v.wheels[0].surface);
    return g;
  }

  /** Put the car back on the road (R / B button / touch + pause-menu button); costs a penalty while the stage runs. */
  resetToRoad(): void {
    const v = this.vehicle;
    if (this.paused || this.stage.phase === 'countdown') return;
    if (this.stage.phase === 'running') {
      // Back onto the stretch of stage around the progress (never a later leg).
      const along = this.stage.resetAlong(v.position.x, v.position.z);
      this.placeOnRoad(along);
      this.stage.rejoin(along);
      const penalty =
        v.up.y < FLIPPED_UP_Y ? PENALTY_RESET_FLIPPED : PENALTY_RESET;
      this.stage.addPenalty(penalty);
      this.hud.message(`RESET +${penalty}s`, 1.5, 'small bad');
    } else {
      const s = this.world.resetSpawn(
        v.position.x,
        v.position.z,
        this.stage.progress,
      );
      v.reset(s.position, s.heading);
      this.tyreMarks.breakStrips();
      this.rig.snap();
    }
  }

  private onAction(a: InputAction): void {
    const v = this.vehicle;
    switch (a) {
      case 'pause':
        this.setPaused(!this.paused);
        break;
      case 'reset':
        this.resetToRoad();
        break;
      case 'camera':
        this.rig.next();
        saveSettings({ camera: this.rig.mode });
        break;
      case 'restart':
        if (this.stage.phase === 'finished' && !this.freeDrive) this.restart();
        break;
      case 'shiftUp':
        v.drivetrain.automatic = false;
        v.drivetrain.shiftUp();
        break;
      case 'shiftDown':
        v.drivetrain.automatic = false;
        v.drivetrain.shiftDown();
        break;
      case 'toggleGearbox':
        v.drivetrain.automatic = !v.drivetrain.automatic;
        saveSettings({ automatic: v.drivetrain.automatic });
        this.hud.message(
          v.drivetrain.automatic ? 'AUTOMATIC' : 'MANUAL (Q/E)',
          1.2,
          'small',
        );
        break;
      case 'traction':
        if (this.car.physics.noTractionControl) {
          this.hud.message('NO TRACTION CONTROL', 1.2, 'small');
          break;
        }
        v.tractionControl = !v.tractionControl;
        saveSettings({ traction: v.tractionControl });
        this.hud.message(
          `TRACTION CONTROL ${v.tractionControl ? 'ON' : 'OFF'}`,
          1.2,
          'small',
        );
        break;
      case 'abs':
        if (this.car.physics.noAbs) {
          this.hud.message('NO ABS', 1.2, 'small');
          break;
        }
        v.abs = !v.abs;
        saveSettings({ abs: v.abs });
        this.hud.message(`ABS ${v.abs ? 'ON' : 'OFF'}`, 1.2, 'small');
        break;
      case 'telemetry':
        this.telemetry.toggle();
        break;
      case 'physicsDebug':
        this.forceLines.lines.visible = !this.forceLines.lines.visible;
        this.model.debug.visible = this.forceLines.lines.visible;
        break;
      case 'autopilot':
        if (this.autopilot) this.autopilot = undefined;
        else {
          this.autopilot = new Autopilot(this.world.stageRoad);
          this.autopilot.reset(this.stage.progress);
        }
        this.hud.message(
          this.autopilot ? 'AUTOPILOT' : 'AUTOPILOT OFF',
          1.2,
          'small',
        );
        break;
      case 'mute':
        this.hud.message(
          this.audio.toggleMute() ? 'MUTED' : 'SOUND ON',
          1,
          'small',
        );
        break;
    }
  }

  /** Put the car on the road centreline at `along`, facing the stage direction. */
  private placeOnRoad(along: number): void {
    const s = this.world.roadSpawn(along);
    this.vehicle.reset(s.position, s.heading);
    this.tyreMarks.breakStrips();
    this.autopilot?.reset(along);
    this.rig.snap();
  }

  /** Shared GA params of a ranked run (see src/shared/analytics.ts, DETAILS.md "Analytics"). */
  private runParams(): EventParams {
    return {
      game_level_name: this.world.stageDef.id,
      game_version: gameManifest.version,
      game_rally_car: this.car.id,
      game_rally_tyre: this.opts.tyre,
      game_rally_setup: this.opts.setup,
      game_rally_gearing: hasGearings(this.car.physics)
        ? this.opts.gearing
        : undefined,
      game_rally_times_version: timesVersion(this.world.stageDef.id),
      game_rally_season: this.season,
      game_rally_time_of_day:
        this.env.hour === undefined ? undefined : slotFor(this.env.hour).id,
    };
  }

  /**
   * GA `level_end` with game_success=false when a ranked run is left mid-stage (restart, menu,
   * portal, other spawn). Free drive is never tracked.
   */
  trackQuit(reason: string): void {
    if (this.freeDrive || this.stage.phase !== 'running') return;
    track('rally', 'level_end', {
      ...this.runParams(),
      game_success: false,
      game_reason: reason,
      game_time_s: seconds(this.stage.time),
      game_rally_progress_pct: Math.round(
        (100 * this.stage.progress) / this.world.stage.finish,
      ),
    });
  }

  private onStageEvent(e: StageEvent): void {
    if (e.type === 'go') {
      if (!this.freeDrive) track('rally', 'level_start', this.runParams());
      const wrong = this.wrongTyreSurface();
      if (wrong)
        this.hud.message(
          `GO!
${TYRES[this.opts.tyre].name} tyres on ${wrong}... hold on!`,
          2.5,
          'good',
        );
      else this.hud.message('GO!', 1, 'good');
    }
    if (e.type === 'cut') {
      this.placeOnRoad(e.along!);
      this.hud.message(
        `OFF STAGE +${PENALTY_CUT}s\nreset to the road`,
        2,
        'small bad',
      );
    }
    if (e.type === 'split') {
      const d = e.delta !== undefined ? `\n${formatDelta(e.delta)}` : '';
      this.hud.message(
        `SPLIT ${e.index! + 1}  ${formatTime(e.time!)}${d}`,
        2.5,
        // Colour = this sector vs the best's sector (same as the HUD bar), the number stays cumulative.
        `small ${e.sectorDelta !== undefined ? (e.sectorDelta <= 0 ? 'good' : 'bad') : ''}`,
      );
    }
    if (e.type === 'finish') {
      this.hud.message('FINISH', 3, 'good');
      const run: RunRecord = {
        time: e.time!,
        car: this.car.id,
        livery: this.opts.livery,
        tyre: this.opts.tyre,
        susp: this.opts.setup,
        ...(hasGearings(this.car.physics) ? { gear: this.opts.gearing } : {}),
        splits: [...this.stage.splitTimes],
        ...(e.penalty ? { penalty: e.penalty } : {}),
        season: this.season,
        ...(this.env.hour !== undefined ? { hour: this.env.hour } : {}),
        ver: timesVersion(this.world.stageDef.id),
        carVer: carTimesVersion(this.car.id),
        date: Date.now(),
      };
      // Free drive runs don't count.
      const ranked = !this.freeDrive;
      const board = ranked
        ? recordTime(
            this.world.stageDef.id,
            CARS.map((c) => c.id),
            run,
          )
        : loadTimes(
            this.world.stageDef.id,
            CARS.map((c) => c.id),
          );
      if (ranked) {
        const params = this.runParams();
        track('rally', 'level_end', {
          ...params,
          game_success: true,
          game_time_s: seconds(e.time!),
          game_rally_penalty_s: e.penalty || 0,
          game_rally_new_best: e.delta === undefined || e.delta < 0,
        });
        // GA4 score event: lower is better here (stage time in ms).
        track('rally', 'post_score', {
          ...params,
          game_score: Math.round(e.time! * 1000),
          game_character: this.car.id,
        });
      }
      this.onFinish?.(e.time!, e.delta, run, board);
    }
  }

  /**
   * Dev helper: run N frames synchronously and report CPU+GPU ms per frame
   * (works even when the tab is in the background). Call from the console:
   *   await __rally.benchmark(120)
   */
  benchmark(frames = 120): {
    msPerFrame: number;
    /** Slowest single frame (CPU side incl. streaming work), ms. */
    worstMs: number;
    calls: number;
    triangles: number;
  } {
    const gl = this.renderer.getContext();
    const t0 = performance.now();
    let worst = 0;
    for (let i = 0; i < frames; i++) {
      const f0 = performance.now();
      this.frame(1 / 60);
      worst = Math.max(worst, performance.now() - f0);
    }
    waitForGpu(gl);
    const info = this.renderer.info.render;
    return {
      msPerFrame: (performance.now() - t0) / frames,
      worstMs: worst,
      calls: info.calls,
      triangles: info.triangles,
    };
  }

  /**
   * Tree benchmark (trees/Performance.md#benchmark): the camera flies a fixed path from the stage start along the
   * road (`step` m per frame), every frame finished on the GPU (waitForGpu, so vsync does not hide the cost), first
   * with the trees, then (`withoutTrees`) the same path with them hidden; the difference is the trees' own cost.
   * Each run starts after a warm-up pass over the path. Writes the report to a JSON file and returns it:
   *   await __rally.treeBenchmark()
   */
  async treeBenchmark(
    opts: {
      frames?: number;
      step?: number;
      withoutTrees?: boolean;
      download?: boolean;
      gpuTimer?: boolean;
      /** An earlier report to compare with (the change in every figure lands in `comparison`). */
      compare?: TreeBenchReport;
      machine?: string;
    } = {},
  ): Promise<TreeBenchReport> {
    const frames = opts.frames ?? 1200;
    const step = opts.step ?? 0.5;
    const wasRunning = this.running;
    this.stop();
    const gl = this.renderer.getContext();
    const path = benchPath(this.world, frames, step);
    const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));
    const runs: BenchRun[] = [];
    for (const trees of opts.withoutTrees === false ? [true] : [true, false]) {
      this.trees.group.visible = trees;
      // Warm-up: stream terrain, scatter and tree batches along the path.
      for (let i = 0; i < frames; i += 8) {
        this.benchFrame(path.poses[i], trees, 40);
        if (i % 64 === 0) await yieldFrame();
      }
      // Start settled at the first pose, as after a stage load (not with the batches of the path's far end).
      this.benchFrame(path.poses[0], trees, 40);
      if (trees) this.trees.updateNow(this.camera);
      waitForGpu(gl);
      // Frame times with the GPU timer off: its queries stall the pipeline now and then (they would show as spikes).
      this.trees.measure = false;
      const times: number[] = [];
      const select: number[] = [];
      let active = 0;
      let activePeak = 0;
      const detail: SpikeFrame[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        const programs = this.renderer.info.programs?.length ?? 0;
        this.benchFrame(path.poses[i], trees, 2.5);
        const t1 = performance.now();
        waitForGpu(gl);
        times.push(performance.now() - t0);
        const c = this.trees.current;
        if (trees) {
          select.push(c.selectMs);
          active += c.active;
          activePeak = Math.max(activePeak, c.active);
        }
        detail.push({
          frame: i,
          ms: Math.round(times[times.length - 1] * 100) / 100,
          cpuMs: Math.round((t1 - t0) * 100) / 100,
          steps: { ...this.benchSteps },
          gpuWaitMs:
            Math.round((t0 + times[times.length - 1] - t1) * 100) / 100,
          treeCpuMs: trees ? Math.round((c.selectMs + c.jobMs) * 100) / 100 : 0,
          programs: (this.renderer.info.programs?.length ?? 0) - programs,
          allocs: trees ? c.allocs : 0,
          uploadBytes: trees ? c.uploadBytes : 0,
          repacks: trees ? c.repacks : 0,
          commit: trees && c.commit,
        });
        if (i % 60 === 59) await yieldFrame();
      }
      // Tree GPU time: a second pass over every 4th pose with the timer on.
      let gpu: number[] = [];
      let pass = { main: [] as number[], shadow: [] as number[] };
      if (trees && this.trees.timer?.available && opts.gpuTimer !== false) {
        this.trees.measure = true;
        this.trees.update(this.camera);
        this.trees.timer.takeSamples();
        for (let i = 0; i < frames; i += 4) {
          this.benchFrame(path.poses[i], trees, 2.5);
          waitForGpu(gl);
          if (i % 120 === 0) await yieldFrame();
        }
        this.trees.update(this.camera);
        gpu = this.trees.timer.takeSamples();
        pass = this.trees.timer.takePassSamples();
        this.trees.measure = false;
      }
      const run = summarize(trees, times, gpu, select);
      const mean = (a: number[]) =>
        a.length
          ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100
          : NaN;
      run.spikes = detail.filter((d) => d.ms > run.avgMs * 3);
      if (trees) {
        run.active = Math.round(active / frames);
        run.activePeak = activePeak;
        run.treeMainGpuMs = mean(pass.main);
        run.treeShadowGpuMs = mean(pass.shadow);
      }
      runs.push(run);
    }
    this.trees.group.visible = true;
    this.trees.measure = false;
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const report: TreeBenchReport = {
      stage: this.world.map.id,
      quality: this.opts.quality.name,
      resolution: `${size.x}x${size.y}`,
      pixelRatio: this.renderer.getPixelRatio(),
      gpu: gpuName(this.renderer),
      date: new Date().toISOString(),
      path: { start: path.start, metres: frames * step, step },
      loadMs: Math.round(this.loadMs),
      treeLoad: { ...this.treeLibrary.stats },
      runs,
      treeCostMs:
        runs.length > 1
          ? Math.round((runs[0].avgMs - runs[1].avgMs) * 100) / 100
          : null,
      result: checkBudget(runs, this.treeLibrary.stats.totalMs),
      machine: [
        opts.machine,
        navigator.platform,
        `${navigator.hardwareConcurrency} threads`,
      ]
        .filter(Boolean)
        .join(', '),
      mitigations: this.trees.mitigations(),
    };
    if (opts.compare) report.comparison = compareReports(opts.compare, report);
    console.table(runs);
    console.log('tree benchmark', report);
    if (opts.download !== false) writeReport(report);
    this.placeAtSpawn();
    if (wasRunning) this.start();
    return report;
  }

  /** One benchmark frame: camera on the path, world streaming, render (no car / physics / effects). */
  /** ms per step of the last benchmark frame (where a spike frame's CPU time went). */
  benchSteps: Record<string, number> = {};

  private benchFrame(
    pose: { pos: Vector3; look: Vector3 },
    trees: boolean,
    terrainBudget: number,
  ): void {
    const steps = this.benchSteps;
    let t = performance.now();
    const lap = (k: string) => {
      const n = performance.now();
      steps[k] = Math.round((n - t) * 10) / 10;
      t = n;
    };
    const cam = this.camera;
    cam.position.copy(pose.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(pose.look);
    cam.fov = 65;
    cam.updateProjectionMatrix();
    this.terrain.update(cam.position, terrainBudget);
    lap('terrain');
    this.roadCull.update(cam.position);
    this.streamer.update(cam.position);
    lap('scatter');
    if (trees) this.trees.update(cam);
    lap('trees');
    const dir = cam.getWorldDirection(this.camDir);
    const halfFov = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
    this.streamer.setView({
      yaw: Math.atan2(dir.z, dir.x),
      half: halfFov + VIEW_MARGIN,
    });
    this.placeShadows(cam.position, dir);
    this.env.follow(cam.position);
    this.updateCanopy();
    lap('env');
    this.renderer.render(this.scene, cam);
    lap('render');
  }

  /** Smoothed time between frames and CPU time of a frame without the object streaming (ms; streamBudget). */
  private frameInterval = 1000 / 60;
  private frameWork = 8;

  /**
   * Time the object streaming may take this frame (ms): what the frame rate leaves over (85 % of the time between
   * frames, less the rest of the frame's work), 1-8 ms. A fast device catches up in a frame or two, a busy one keeps
   * its frame rate; the driving speed plays no part.
   */
  private streamBudget(dt: number): number {
    if (dt > 0) this.frameInterval += (dt * 1000 - this.frameInterval) * 0.1;
    return Math.min(8, Math.max(1, this.frameInterval * 0.85 - this.frameWork));
  }

  private frame(dt: number): void {
    const t0 = performance.now();
    const v = this.vehicle;
    // --- input + physics --------------------------------------------------------
    if (!this.paused) {
      const lat = v.velocity.dot(v.right);
      const lon = v.velocity.dot(v.forward);
      const slip =
        Math.hypot(lat, lon) > 2 ? Math.atan2(lat, Math.abs(lon)) : 0;
      const c = this.input.update(dt, {
        speed: lon,
        slipAngle: slip,
        maxSteer: (v.def.maxSteerDeg * Math.PI) / 180,
      });
      v.controls.throttle = c.throttle;
      v.controls.brake = c.brake;
      v.controls.steer = c.steer;
      v.controls.handbrake = c.handbrake;
      if (this.stage.phase === 'countdown') {
        // Held on the line: rev it, but don't roll.
        v.parked = true;
        const n = Math.ceil(this.stage.countdown);
        if (n !== this.lastCount && n > 0) {
          this.hud.message(String(n), 0.9);
          this.lastCount = n;
        }
      }
      if (this.stage.phase !== 'countdown') v.parked = false;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        // AI drivers update at the physics rate (same as the headless tests).
        if (this.autopilot) this.autopilot.drive(v, v.controls);
        if (this.stage.phase === 'finished' && !this.freeDrive)
          this.finishStop(v);
        v.step(STEP);
        this.stage.update(
          STEP,
          v.position.x,
          v.position.z,
          v.forward.x,
          v.forward.z,
          v.speed,
        );
        this.acc -= STEP;
        steps++;
      }
      // Slow-mo instead of a death spiral; keep the remainder (< 1 step) so the interpolated car never steps back.
      if (steps === MAX_STEPS) this.acc = Math.min(this.acc, STEP);
      this.knockPosts(dt);
      this.people.update(
        dt,
        v.position.x,
        v.position.z,
        v.velocity.x,
        v.velocity.z,
        (inst, m) => this.streamer.setMatrix(inst, m),
      );
    } else this.input.poll();
    const tPhysics = performance.now();
    const alpha = this.paused ? 1 : this.acc / STEP;

    // --- car model + camera -------------------------------------------------------------
    this.model.updateFromVehicle(v, alpha);
    this.contactShadow.update(this.model.root);
    // In reverse gear the throttle key brakes (see Vehicle.resolvePedals), so that is the brake lamp's pedal.
    const reversing = v.drivetrain.gear === -1;
    const brakePedal = reversing ? v.controls.throttle : v.controls.brake;
    this.model.setBrake(brakePedal, reversing);
    if (this.headlights || this.tailLight)
      this.lightParticlesByLamps(brakePedal);
    this.renderPos.copy(this.model.root.position);
    this.renderFwd.set(0, 0, 1).applyQuaternion(this.model.root.quaternion);
    this.renderUp.set(0, 1, 0).applyQuaternion(this.model.root.quaternion);
    // Paused: the camera freezes where it is (the rig would keep carrying it at the car's frozen velocity).
    if (!this.paused)
      this.rig.update(dt, v, this.renderPos, this.renderFwd, this.renderUp);
    if (Math.abs(this.camera.fov - this.lastFov) > 0.5)
      this.updateParticleScale();

    // --- streaming ----------------------------------------------------------------------------
    const camPos = this.camera.position;
    const tCamera = performance.now();
    this.terrain.update(camPos, 2.5);
    this.roadCull.update(camPos);
    const tTerrain = performance.now();
    this.streamer.update(camPos, this.streamBudget(dt));
    const tObjects = performance.now();
    this.trees.update(this.camera, this.rig.steady);
    const tTrees = performance.now();
    // Far scatter: draw only the instances inside the camera's horizontal view (+ margin for the repack step
    // and the streamer's focus lagging the camera). Looking steeply down: everything.
    const dir = this.camera.getWorldDirection(this.camDir);
    const flat = Math.hypot(dir.x, dir.z);
    const halfFov = Math.atan(
      Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect,
    );
    this.streamer.setView(
      flat > 0.4
        ? { yaw: Math.atan2(dir.z, dir.x), half: halfFov + VIEW_MARGIN }
        : null,
    );
    // Shadow box ahead of the camera (where the player looks), not centred on the car.
    this.placeShadows(this.renderPos, dir);
    this.env.follow(camPos);
    this.updateCanopy();

    // --- effects / audio / HUD ------------------------------------------------------------------
    if (!this.paused) {
      this.emitDust(dt);
      this.tyreMarks.update();
    }
    this.dust.update(dt);
    this.gravel.update(dt, 0.35, -9.8);
    this.haze?.update(dt, 0.12, 0.02);
    this.forceLines.update(v);
    const slide = Math.max(
      ...v.wheels.map((w) => (w.contact ? w.slideSpeed : 0)),
    );
    const loose =
      v.wheels.reduce((s, w) => s + (w.contact ? w.surface.loose : 0), 0) / 4;
    // Braking lock-up: fraction of the ground speed a braked wheel is behind (0 = rolling, 1 = locked).
    let lock = 0;
    const gs = Math.abs(v.speed);
    if (gs > 2 && (v.controls.brake > 0.3 || v.controls.handbrake > 0.3))
      for (const w of v.wheels)
        if (w.contact)
          lock = Math.max(lock, 1 - (Math.abs(w.omega) * w.radius) / gs);
    const surfaces: Partial<Record<SurfaceId, number>> = {};
    for (const w of v.wheels)
      if (w.contact)
        surfaces[w.surface.id] = (surfaces[w.surface.id] ?? 0) + 0.25;
    this.audio.setListener(this.rig.mode);
    this.audio.update({
      rpm: v.drivetrain.rpm,
      throttle: v.drivetrain.effectiveThrottle,
      pedal: v.controls.throttle,
      gear: v.drivetrain.gear,
      speed: gs,
      wheelHz: gs / (2 * Math.PI * v.wheels[0].radius),
      slide,
      loose,
      impact: v.impact,
      surfaces,
      lock,
    });
    this.audio.setEnclosure(
      this.world.tunnelAt(v.position.x, v.position.y, v.position.z),
      gs,
    );
    // Gantry clocks run from GO whether or not the car has moved (a forgotten start shows); the
    // finish clock stops on the stage time (penalties included) once the car crosses the line.
    if (!this.freeDrive) {
      const st = this.world.stage;
      const at = this.stage.progress;
      if (Math.abs(at - st.start) < CLOCK_NEAR)
        setClockTime('start', this.stage.time);
      if (Math.abs(at - st.finish) < CLOCK_NEAR)
        setClockTime('finish', this.stage.time);
    }
    this.hud.update(
      dt,
      {
        speedKmh: v.speed * 3.6,
        rpm: v.drivetrain.rpm,
        redline: v.def.engine.redlineRpm,
        gear: v.drivetrain.gear,
        automatic: v.drivetrain.automatic,
        tc: v.tractionControl && !this.car.physics.noTractionControl,
        tcActive: v.tcFactor < 0.95,
        abs: v.abs && !this.car.physics.noAbs,
        absActive: v.absActive,
        hold: v.parked || v.holding,
        tyres: this.tyreGaugeState(),
      },
      this.stage,
    );
    const st = this.world.stage;
    this.hud.setDistance(
      this.freeDrive
        ? 'free drive'
        : `${Math.max(0, this.stage.progress - st.start).toFixed(0)} / ${(st.finish - st.start).toFixed(0)} m`,
    );
    this.telemetry.update(dt, v);

    const tFx = performance.now();
    this.perf?.gpuBegin();
    if (this.post?.active) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    this.perf?.gpuEnd();
    const tRender = performance.now();
    // The frame's own work, the object streaming left out (it fills the time left over: streamBudget).
    this.frameWork +=
      (tRender - t0 - (tObjects - tTerrain) - this.frameWork) * 0.1;
    this.perf?.frame({
      physics: tPhysics - t0,
      'car + camera': tCamera - tPhysics,
      terrain: tTerrain - tCamera,
      objects: tObjects - tTerrain,
      trees: tTrees - tObjects,
      'fx + hud': tFx - tTrees,
      render: tRender - tFx,
    });
    this.treeStats.update();
    this.stats.set(
      'chunk',
      `${this.terrain.chunkCount} (+${this.terrain.pending})  hf ${this.world.heightfield.cachedChunks}`,
    );
    this.stats.set(
      'inst',
      `${this.streamer.drawn} in ${this.streamer.meshCount} meshes, ${this.trees.drawn} trees in ${this.trees.meshCount}` +
        (this.trees.debug ? `, ${this.trees.flickering} flickering` : ''),
    );
    this.stats.set(
      'fx',
      `${this.dust.aliveCount} dust  ${this.gravel.aliveCount} gravel  ${this.haze?.aliveCount ?? 0} haze`,
    );
    this.stats.end();
  }

  /**
   * The sun's shadow map and the far one ahead of the camera, and where the sun's fades out: before a tree just past
   * `treeShadowDistance` (not in it) could shade the ground - its crown top's shadow reaches ~20 m at a high sun,
   * more at a low one (the far map's crowns cover that band). The far map fades in SHADOW_OVERLAP m closer, so the two
   * overlap instead of handing over in one line.
   */
  private placeShadows(focus: Vector3, forward: Vector3): void {
    this.env.update(focus, forward);
    this.far?.update(focus, forward, this.env.sun.castShadow);
    const s = this.env.sunDir.y;
    const reach = Math.min(
      25,
      (18 * Math.sqrt(Math.max(0, 1 - s * s))) / Math.max(0.05, s),
    );
    const end = this.opts.quality.treeShadowDistance - reach;
    setNearShadowFade(end - 15, end, SHADOW_OVERLAP);
  }

  /** Canopy shadows (global map + the local window around the camera). */
  private updateCanopy(): void {
    const p = this.camera.position;
    this.canopy.update(performance.now(), p);
    setCanopyLocalMap(this.canopy.localMap);
    this.farForest?.update(p);
  }

  /** Show / hide the perf panel (created on first use; its switches stay applied while it exists). */
  togglePerfPanel(): void {
    this.perf ??= new PerfPanel(this, this.container);
    this.perf.toggle();
  }

  /** Breakables under the car fall over; those with `slow` (chevrons) also slow the car. */
  private knockPosts(dt: number): void {
    const v = this.vehicle;
    const hits = this.breakables.hit({
      position: v.position,
      quaternion: v.quaternion,
      velocity: v.velocity,
      length: v.def.length,
      width: v.def.width,
    });
    // Sturdy breakables (chevrons) take a bit of speed off the car.
    for (const inst of hits) {
      const slow = getAssetMeta(inst.asset).breakable?.slow;
      if (slow) v.velocity.multiplyScalar(slow);
    }
    this.breakables.update(dt, (inst, m) => this.streamer.setMatrix(inst, m));
  }

  /**
   * After the finish line the car brakes itself to a stop, keeping to the road;
   * auto-hold then keeps it parked until the stage is restarted.
   */
  private finishStop(v: Vehicle): void {
    if (!this.finishPilot) {
      this.finishPilot = new Autopilot(this.world.stageRoad);
      this.finishPilot.reset(this.stage.progress);
    }
    finishStopControls(this.finishPilot, v, v.controls);
  }

  private emitDust(dt: number): void {
    const v = this.vehicle;
    const quality = this.opts.quality.particles / 2000;
    const p = new Vector3();
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      if (!w.contact || w.surface.dust <= 0) continue;
      const rate =
        w.surface.dust *
        (w.contactSpeed * 1.6 + w.slideSpeed * 5) *
        quality *
        (i >= 2 ? 1 : 0.5);
      this.emitAcc[i] += rate * dt;
      this.dustColor.setHex(w.surface.dustColor);
      while (this.emitAcc[i] >= 1) {
        this.emitAcc[i] -= 1;
        // Spawn slightly behind the tyre and let the plume travel with the car for a
        // moment (exaggerated, like most rally games) so the chase cam sees it.
        p.copy(w.contactPoint).addScaledVector(
          v.forward,
          -0.4 - Math.random() * 0.6,
        );
        p.x += (Math.random() - 0.5) * 0.5;
        p.z += (Math.random() - 0.5) * 0.5;
        p.y += 0.2;
        const r = () => (Math.random() - 0.5) * 2;
        const carry = 0.55 + Math.random() * 0.25;
        this.dust.emit(
          p,
          v.velocity.x * carry + r() * 1.5 + v.right.x * r() * 1.5,
          0.6 + Math.random() * 1.6,
          v.velocity.z * carry + r() * 1.5 + v.right.z * r() * 1.5,
          0.8 + Math.random() * 0.8,
          3.2 + Math.random() * 3.2,
          2.2 + Math.random() * 2.4,
          this.dustColor,
          0.38 + w.surface.dust * 0.22,
        );
      }
      // Gravel spray: stones flung back and up from loose surfaces, most when sliding / spinning.
      if (w.surface.loose > 0.3) {
        this.gravelAcc[i] +=
          w.surface.loose *
          (w.slideSpeed * 10 + w.contactSpeed * 0.5) *
          quality *
          (i >= 2 ? 1 : 0.4) *
          dt;
        while (this.gravelAcc[i] >= 1) {
          this.gravelAcc[i] -= 1;
          const r = () => (Math.random() - 0.5) * 2;
          const back = 1 + w.slideSpeed * 0.5 + Math.random() * 2;
          const side = r() * 1.8;
          p.copy(w.contactPoint).addScaledVector(v.forward, -0.3);
          p.y += 0.1;
          this.gravelColor
            .copy(this.dustColor)
            .multiplyScalar(0.45 + Math.random() * 0.2);
          this.gravel.emit(
            p,
            v.velocity.x * 0.55 - v.forward.x * back + v.right.x * side,
            1.2 + Math.random() * 2.8,
            v.velocity.z * 0.55 - v.forward.z * back + v.right.z * side,
            0.05 + Math.random() * 0.07,
            0,
            0.8 + Math.random() * 0.6,
            this.gravelColor,
            0.95,
          );
        }
      }
    }
    // Hanging dust: a faint cloud left over the road behind a fast car, drifting for 10-15 s.
    const rearDust =
      (v.wheels[2].contact ? v.wheels[2].surface.dust : 0) +
      (v.wheels[3].contact ? v.wheels[3].surface.dust : 0);
    const speed = Math.abs(v.speed);
    if (this.haze && rearDust > 0 && speed > 6) {
      this.hazeAcc += rearDust * 2.2 * Math.min(1, speed / 25) * quality * dt;
      this.dustColor.setHex(v.wheels[2].surface.dustColor);
      while (this.hazeAcc >= 1) {
        this.hazeAcc -= 1;
        const r = () => (Math.random() - 0.5) * 2;
        p.copy(v.position)
          .addScaledVector(v.forward, -3 - Math.random() * 3)
          .addScaledVector(v.right, r() * 1.5);
        p.y = this.world.heightAt(p.x, p.z) + 0.8 + Math.random() * 0.8;
        this.haze.emit(
          p,
          v.velocity.x * 0.12 + r() * 0.4,
          0.1,
          v.velocity.z * 0.12 + r() * 0.4,
          2.5 + Math.random() * 1.5,
          0.6 + Math.random() * 0.4,
          9 + Math.random() * 6,
          this.dustColor,
          0.06 + Math.random() * 0.03,
        );
      }
    }
  }
}

/** Yield until the browser has painted (so a loading label shows before a long synchronous step). */
async function paint(): Promise<void> {
  await frame();
  await new Promise<void>((r) => setTimeout(r));
}

/** Yield to the browser (next frame, or a timer when the tab is hidden and rAF is paused). */
function frame(): Promise<void> {
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(go);
    setTimeout(go, 30);
  });
}
