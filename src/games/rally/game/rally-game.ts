import {
  Color,
  PerspectiveCamera,
  Scene,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { CarModel } from '../cars/shared/car-model';
import { CARS, getCar } from '../cars';
import { rallyName } from '../cars/shared/rally-badge';
import type { CarDef } from '../cars/shared/types';
import { Environment } from '../engine/environment';
import type { QualitySettings } from '../engine/quality';
import { bindCameraAspect, createRenderer } from '../engine/renderer';
import { setClockTime } from '../engine/stage-sign-textures';
import { setTextureAnisotropy } from '../engine/textures';
import { getMap } from '../maps';
import { SURFACES, type SurfaceId } from '../physics/surfaces';
import { applySetup } from '../physics/car-setup';
import { applyGearing, hasGearings } from '../physics/gearing';
import { carGripRating } from '../physics/car-tyres';
import { TYRES, type TyreId } from '../physics/tyres';
import type { GearingId, SetupId } from '../physics/types';
import { PHYSICS_HZ, Vehicle } from '../physics/vehicle';
import { isTestCar, isTestMap, TEST_NOTE } from '../release';
import { Breakables } from '../world/breakables';
import { InstanceStreamer } from '../world/instance-streamer';
import { buildRoadMesh } from '../world/road-mesh';
import { TerrainRenderer } from '../world/terrain-renderer';
import { World } from '../world/world';
import { CarAudio } from './audio';
import { Autopilot, finishStopControls } from './autopilot';
import { CameraRig } from './camera-rig';
import { ParticleSystem } from './dust';
import { Hud } from './hud';
import { InputController, type InputAction } from './input';
import { type RallySettings, saveSettings } from './settings';
import {
  bestKey,
  formatDelta,
  loadTimes,
  recordTime,
  type RunRecord,
  formatTime,
  PENALTY_CUT,
  PENALTY_MARKER,
  PENALTY_RESET,
  StageTimer,
  type StageEvent,
} from './stage';
import { ForceLines, Telemetry } from './telemetry';

export interface GameOptions {
  mapId: string;
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
  streamer!: InstanceStreamer;
  /** Marker posts the car knocks over (drawn by the streamer). */
  breakables!: Breakables;
  stage!: StageTimer;
  readonly input = new InputController();
  rig!: CameraRig;
  hud!: Hud;
  dust!: ParticleSystem;
  audio = new CarAudio(4);
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
  private emitAcc = [0, 0, 0, 0];
  private dustColor = new Color();
  private lastCount = -1;
  private finishPilot?: Autopilot;
  private lastFov = 0;
  private freeDrive: boolean;

  constructor(
    private container: HTMLElement,
    readonly opts: GameOptions,
  ) {
    this.renderer = createRenderer(container, opts.quality);
    setTextureAnisotropy(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    bindCameraAspect(this.renderer, this.camera);
    this.world = new World(getMap(opts.mapId));
    this.car = getCar(opts.carId);
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
    this.scene.add(buildRoadMesh(this.world));
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
      lodScale: q.lodScale,
      detailDensity: q.detailDensity,
    });
    this.scene.add(this.streamer.group);
    this.streamer.updateNow(spawn.position);
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
    this.model = new CarModel(this.car, {
      seed: this.opts.livery,
      tyre: this.opts.tyre,
    });
    this.scene.add(this.model.root);
    this.dust = new ParticleSystem(q.particles);
    this.dust.material.uniforms.uLight.value.setScalar(1.7);
    this.scene.add(this.dust.points, this.forceLines.lines);
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
    // Warm up shaders so the first frames don't hitch.
    this.streamer.prewarm();
    this.renderer.compile(this.scene, this.camera);
    this.streamer.settle();
    progress(1, 'Ready');
  }

  /** Apply player options; safe to call while driving (pause-menu options). */
  applySettings(s: RallySettings): void {
    this.opts.settings = s;
    this.audio.setVolume(s.volume);
    this.vehicle.drivetrain.automatic = s.automatic;
    this.vehicle.tractionControl = s.traction;
    this.rig.mode = s.camera;
    this.model.setBadge({
      number: s.carNumber,
      rally: rallyName(this.world.map.name),
    });
  }

  private updateParticleScale(): void {
    this.lastFov = this.camera.fov;
    this.dust.setViewport(this.renderer.domElement.height, this.camera.fov);
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
      const dt = Math.min(0.1, (now - this.last) / 1000);
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
    this.opts.spawn = this.freeDrive ? this.opts.spawn : 'start';
    this.placeAtSpawn();
    this.setPaused(false);
  }

  private onAction(a: InputAction): void {
    const v = this.vehicle;
    switch (a) {
      case 'pause':
        this.setPaused(!this.paused);
        break;
      case 'reset':
        if (this.paused || this.stage.phase === 'countdown') return;
        if (this.stage.phase === 'running') {
          // Back onto the stretch of stage around the progress (never a later leg).
          const along = this.stage.resetAlong(v.position.x, v.position.z);
          this.placeOnRoad(along);
          this.stage.rejoin(along);
          this.stage.addPenalty(PENALTY_RESET);
          this.hud.message(`RESET +${PENALTY_RESET}s`, 1.5, 'small bad');
        } else {
          const s = this.world.resetSpawn(
            v.position.x,
            v.position.z,
            this.stage.progress,
          );
          v.reset(s.position, s.heading);
          this.rig.snap();
        }
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
        v.tractionControl = !v.tractionControl;
        saveSettings({ traction: v.tractionControl });
        this.hud.message(
          `TRACTION CONTROL ${v.tractionControl ? 'ON' : 'OFF'}`,
          1.2,
          'small',
        );
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
    this.autopilot?.reset(along);
    this.rig.snap();
  }

  private onStageEvent(e: StageEvent): void {
    if (e.type === 'go') {
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
    this.renderPos.copy(this.model.root.position);
    this.renderFwd.set(0, 0, 1).applyQuaternion(this.model.root.quaternion);
    this.renderUp.set(0, 1, 0).applyQuaternion(this.model.root.quaternion);
    this.rig.update(dt, v, this.renderPos, this.renderFwd, this.renderUp);
    if (Math.abs(this.camera.fov - this.lastFov) > 0.5)
      this.updateParticleScale();

    // --- streaming ----------------------------------------------------------------------------
    const camPos = this.camera.position;
    this.terrain.update(camPos, 2.5);
    this.streamer.update(camPos);
    this.env.update(this.renderPos);
    this.env.follow(camPos);

    // --- effects / audio / HUD ------------------------------------------------------------------
    if (!this.paused) this.emitDust(dt);
    this.dust.update(dt);
    this.forceLines.update(v);
    const slide = Math.max(
      ...v.wheels.map((w) => (w.contact ? w.slideSpeed : 0)),
    );
    const loose =
      v.wheels.reduce((s, w) => s + (w.contact ? w.surface.loose : 0), 0) / 4;
    this.audio.update(
      v.drivetrain.rpm,
      v.drivetrain.effectiveThrottle,
      Math.abs(v.speed),
      slide,
      loose,
      v.impact,
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
        tc: v.tractionControl,
        tcActive: v.tcFactor < 0.95,
        hold: v.parked || v.holding,
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

    this.renderer.render(this.scene, this.camera);
    this.stats.set(
      'chunk',
      `${this.terrain.chunkCount} (+${this.terrain.pending})  hf ${this.world.heightfield.cachedChunks}`,
    );
    this.stats.set(
      'inst',
      `${this.streamer.drawn} in ${this.streamer.meshCount} meshes`,
    );
    this.stats.set('fx', `${this.dust.aliveCount} particles`);
    this.stats.end();
  }

  /** Marker posts under the car fall over (+PENALTY_MARKER each while the stage clock runs). */
  private knockPosts(dt: number): void {
    const v = this.vehicle;
    const hits = this.breakables.hit({
      position: v.position,
      quaternion: v.quaternion,
      velocity: v.velocity,
      length: v.def.length,
      width: v.def.width,
    }).length;
    if (hits && this.stage.phase === 'running') {
      const pen = hits * PENALTY_MARKER;
      this.stage.addPenalty(pen);
      this.hud.message(`MARKER POST +${pen}s`, 1.5, 'small bad');
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
