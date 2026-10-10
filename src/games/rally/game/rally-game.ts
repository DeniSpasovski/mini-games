import {
  Color,
  type Object3D,
  PerspectiveCamera,
  Scene,
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
import type { QualitySettings } from '../engine/quality';
import { PostFx, postEnabled } from '../engine/post-fx';
import { bindCameraAspect, createRenderer } from '../engine/renderer';
import { setClockTime } from '../engine/stage-sign-textures';
import { setTextureAnisotropy } from '../engine/textures';
import { SURFACES, type SurfaceId } from '../physics/surfaces';
import { applySetup } from '../physics/car-setup';
import { applyGearing, hasGearings } from '../physics/gearing';
import { carGripRating } from '../physics/car-tyres';
import { TYRES, type TyreId } from '../physics/tyres';
import type { GearingId, SetupId } from '../physics/types';
import { PHYSICS_HZ, Vehicle } from '../physics/vehicle';
import { isTestCar, isTestMap, TEST_NOTE } from '../release';
import { getAssetMeta } from '../assets/catalog';
import { Breakables } from '../world/breakables';
import { DistanceCull } from '../world/distance-cull';
import { InstanceStreamer } from '../world/instance-streamer';
import { buildRoadMesh } from '../world/road-mesh';
import { TerrainRenderer } from '../world/terrain-renderer';
import { setTerrainRelief } from '../world/terrain-material';
import { CanopyShadows } from '../world/canopy-shadows';
import { Horizon } from '../world/horizon';
import { setCanopyShadows } from '../engine/world-shading';
import { World } from '../world/world';
import { CarAudio } from './audio';
import { Autopilot, finishStopControls } from './autopilot';
import { ContactShadow } from './contact-shadow';
import { CameraRig } from './camera-rig';
import { ParticleSystem } from './dust';
import { TyreMarks } from './tyre-marks';
import { Hud } from './hud';
import { InputController, type InputAction } from './input';
import { OBJECT_DISTANCE, type RallySettings, saveSettings } from './settings';
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
import { stageClimate } from '../maps/shared/climate';
import type { MapDef } from '../maps/shared/types';
import { trackTemp } from '../physics/tyre-temp';
import type { TyreGaugeState } from './tyre-gauge';
import { ForceLines, Telemetry } from './telemetry';

export interface GameOptions {
  /** The full map (`loadMap`, maps/index.ts: the baked data is loaded on demand). */
  map: MapDef;
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
/** Terrain LOD bands at lodScale 1 (m): 1 m grid / 2 m / 4 m / 8 m beyond. */
const TERRAIN_LODS = [160, 520, 1100];
/** Extra half-angle (rad) around the camera view for scatter view culling (`InstanceStreamer.setView`). */
const VIEW_MARGIN = (25 * Math.PI) / 180;
const MAX_STEPS = 10;

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
  /** Hides road-group meshes beyond the terrain view distance (world/distance-cull.ts). */
  roadCull!: DistanceCull;
  private contactShadow!: ContactShadow;
  streamer!: InstanceStreamer;
  /** Marker posts the car knocks over (drawn by the streamer). */
  breakables!: Breakables;
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
  /** AO + bloom + grade (engine/post-fx.ts), medium / high quality; undefined = straight render. */
  private post?: PostFx;

  constructor(
    private container: HTMLElement,
    readonly opts: GameOptions,
  ) {
    const post = postEnabled(opts.quality);
    this.renderer = createRenderer(container, opts.quality, { post });
    if (post) this.post = new PostFx(this.renderer, opts.quality.antialias);
    setTextureAnisotropy(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    bindCameraAspect(this.renderer, this.camera);
    this.world = new World(opts.map);
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

    progress(0.15, 'Road');
    const road = buildRoadMesh(this.world);
    this.scene.add(road);
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
    });
    this.scene.add(this.terrain.group);
    // Far land beyond the streamed terrain (real maps): a backdrop drawn behind everything, ~2 draws.
    if (map.horizon) {
      const horizon = new Horizon(this.world, map.horizon);
      horizon.setCutoff(q.viewDistance);
      this.scene.add(horizon.group);
    }
    // Terrain bump relief: medium / high only (derivative noise + cost on weak GPUs).
    setTerrainRelief(q.name === 'low' ? 0 : 1);
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
    this.streamer = new InstanceStreamer(this.world, {
      lodScale: q.lodScale * OBJECT_DISTANCE[this.opts.settings.objectDistance],
      detailDensity: q.detailDensity,
      // Nothing past the streamed terrain (it would stand on nothing).
      maxDistance: q.viewDistance,
    });
    this.scene.add(this.streamer.group);
    this.streamer.updateNow(spawn.position);
    this.canopy = new CanopyShadows(this.world, this.env.sunDir);
    this.canopy.update();
    setCanopyShadows(
      this.canopy.texture,
      this.canopy.map,
      map.environment.canopyShadow ?? 0.6,
    );
    this.breakables = new Breakables(this.world.scatter, (x, z) =>
      this.world.heightAt(x, z),
    );
    await frame();

    progress(0.9, 'Car');
    this.vehicle = new Vehicle(
      applyGearing(
        applySetup(this.car.physics, this.opts.setup),
        this.opts.gearing,
      ),
      this.world,
    );
    this.vehicle.setTyre(this.opts.tyre);
    // Tyre temperatures: the map's air temperature (`?air=<°C>` to try others) and the sun as drawn (after `?tod=`).
    const air = new URLSearchParams(location.search).get('air');
    this.vehicle.setClimate(
      stageClimate(
        map.environment,
        this.env.sunElevation,
        air && Number.isFinite(Number(air)) ? Number(air) : undefined,
      ),
    );
    this.model = new CarModel(this.car, {
      seed: this.opts.livery,
      tyre: this.opts.tyre,
    });
    this.scene.add(this.model.root);
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
      `${map.name} · ${this.car.name}`,
      isTestMap(map.id) || isTestCar(this.car.id) ? [TEST_NOTE] : [],
    );
    this.telemetry = new Telemetry(this.container);
    this.stage = new StageTimer(this.world, bestKey(map.id, this.car.id));
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
    await this.model.ready;
    this.model.updateFromVehicle(this.vehicle, 1);
    this.env.update(
      this.model.root.position,
      this.camera.getWorldDirection(this.camDir),
    );
    this.streamer.prewarm();
    this.renderer.compile(this.scene, this.camera);
    const culled: Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) culled.push(o);
      o.frustumCulled = false;
    });
    this.renderer.render(this.scene, this.camera);
    for (const o of culled) o.frustumCulled = true;
    this.streamer.settle();
    progress(1, 'Ready');
  }

  /** Apply player options; safe to call while driving (pause-menu options). */
  applySettings(s: RallySettings): void {
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
    this.model.setBadge({
      number: s.carNumber,
      rally: rallyName(this.world.map.name),
    });
  }

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
    // Half sky colour, half white: dust in the shade stays dust-coloured, not blue.
    const ambient = this.env.hemi.color
      .clone()
      .lerp(new Color(1, 1, 1), 0.5)
      .multiplyScalar(0.65);
    for (const p of [this.dust, this.gravel, this.haze])
      p?.setLight(sun, ambient);
  }

  /** Name of the stage surface the fitted tyre grips worst ("gravel"), or null when it is fine on all of them. */
  private wrongTyreSurface(): string | null {
    // The recommended tyre is the stage's own answer: never nag about it (it may be poor on part of the road).
    if (this.opts.tyre === this.world.map.tyre) return null;
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
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
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
    v.wheels.forEach((w, i) => (temps[i] = w.temp));
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
          this.autopilot = new Autopilot(this.world.road);
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
      game_level_name: this.world.map.id,
      game_version: gameManifest.version,
      game_rally_car: this.car.id,
      game_rally_tyre: this.opts.tyre,
      game_rally_setup: this.opts.setup,
      game_rally_gearing: hasGearings(this.car.physics)
        ? this.opts.gearing
        : undefined,
      game_rally_times_version: timesVersion(this.world.map.id),
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
        ver: timesVersion(this.world.map.id),
        carVer: carTimesVersion(this.car.id),
        date: Date.now(),
      };
      // Free drive runs don't count.
      const ranked = !this.freeDrive;
      const board = ranked
        ? recordTime(
            this.world.map.id,
            CARS.map((c) => c.id),
            run,
          )
        : loadTimes(
            this.world.map.id,
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
    gl.finish();
    const info = this.renderer.info.render;
    return {
      msPerFrame: (performance.now() - t0) / frames,
      worstMs: worst,
      calls: info.calls,
      triangles: info.triangles,
    };
  }

  private frame(dt: number): void {
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
      if (steps === MAX_STEPS) this.acc = 0; // slow-mo instead of a death spiral
      this.knockPosts(dt);
    } else this.input.poll();
    const alpha = this.paused ? 1 : this.acc / STEP;

    // --- car model + camera -------------------------------------------------------------
    this.model.updateFromVehicle(v, alpha);
    this.contactShadow.update(this.model.root);
    // In reverse gear the throttle key brakes (see Vehicle.resolvePedals), so that is the brake lamp's pedal.
    const reversing = v.drivetrain.gear === -1;
    this.model.setBrake(
      reversing ? v.controls.throttle : v.controls.brake,
      reversing,
    );
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
    this.terrain.update(camPos, 2.5);
    this.roadCull.update(camPos);
    this.streamer.update(camPos);
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
    this.env.update(this.renderPos, dir);
    this.env.follow(camPos);
    this.canopy.update();

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
      setClockTime('start', this.stage.time);
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

    if (this.post) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    this.stats.set(
      'chunk',
      `${this.terrain.chunkCount} (+${this.terrain.pending})  hf ${this.world.heightfield.cachedChunks}`,
    );
    this.stats.set(
      'inst',
      `${this.streamer.drawn} in ${this.streamer.meshCount} meshes`,
    );
    this.stats.set(
      'fx',
      `${this.dust.aliveCount} dust  ${this.gravel.aliveCount} gravel  ${this.haze?.aliveCount ?? 0} haze`,
    );
    this.stats.end();
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
      this.finishPilot = new Autopilot(this.world.road);
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
