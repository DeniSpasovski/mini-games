import { MathUtils, Scene, Vector2, Vector3, type Object3D } from 'three';
import { seconds, track, type EventParams } from '../../../shared/analytics';
import gameManifest from '../game.json';
import { MAPS, getMapDef, type MapDef } from '../map/registry';
import { pickStart } from '../map/start';
import type { MapData } from '../map/types';
import { EatRings } from '../debug/eat-rings';
import { CameraRig } from '../render/camera-rig';
import { buildMapGround, disposeGround } from '../render/map-ground';
import { HoleMesh, holeColorById } from '../render/hole-mesh';
import { clearHoleFade, updateHoleFade } from '../render/hole-fade';
import { ItemInstances } from '../render/item-instances';
import { LeftoverRings } from '../render/leftover-rings';
import { Puffs } from '../render/puffs';
import {
  Environment,
  QUALITY,
  bindCameraAspect,
  createRenderer,
  defaultQuality,
  type QualityName,
} from '../render/renderer';
import { Bot, BOT_SKILLS } from '../sim/bot';
import {
  DIFFICULTIES,
  MAX_LEVEL,
  difficultyById,
  cameraDistance,
  cameraPitchDeg,
  holeDiameter,
  type Difficulty,
} from '../sim/progression';
import { Sim } from '../sim/sim';
import { Sfx } from './audio';
import { el } from './dom';
import { Hud } from './hud';
import { Controls } from './input';
import { onBackground } from './ios';
import { Menu, type MenuApi } from './menu';
import {
  bestScore,
  loadScores,
  migrateScores,
  recordScore,
  type ScoreEntry,
  MAP_SCORING_VERSIONS,
} from './scores';
import { loadSettings, saveSettings, type HoleSettings } from './settings';
import { defaultStorage } from './storage';

export type GameState =
  'menu' | 'countdown' | 'playing' | 'paused' | 'ending' | 'results';

const STEP = 1 / 60;
const COUNTDOWN = 2.4;
/** Adaptive resolution: frame time (ms) above / below which the render scale steps down / up. */
const SLOW_MS = 24;
const FAST_MS = 18;
const MIN_SCALE = 0.7;
/** Menus, pause and results are static: render them at ~30 fps to save battery. */
const IDLE_FRAME_MS = 30;
const _projected = new Vector3();

/**
 * The play page: menu <-> run loop. Fixed-step sim (60 Hz) + render
 * interpolation for the hole, DOM HUD/menus on top of the three.js canvas.
 */
export class HoleGame {
  state: GameState = 'menu';
  map!: MapData;
  mapDef!: MapDef;
  readonly sim: Sim;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly store = defaultStorage();
  readonly settings: HoleSettings;
  private renderer;
  private env: Environment;
  private ground: Object3D | null = null;
  private holeMesh: HoleMesh;
  private instances: ItemInstances;
  private leftovers: LeftoverRings;
  private puffs = new Puffs();
  private bufferSize = new Vector2();
  private stage = el('div', 'hg-stage');
  private hud: Hud;
  private menu: Menu;
  private controls: Controls;
  private sfx = new Sfx();
  private bot: Bot | null = null;
  private difficulty: Difficulty = DIFFICULTIES[1];
  private seconds = 250;
  private acc = 0;
  private prev = { x: 0, z: 0, d: 1 };
  private menuAngle = 0.6;
  /** Colour screen: the menu camera flies down to the demo hole. */
  private previewHole = false;
  private previewK = 0;
  private countT = 0;
  private lastCount = -1;
  private endT = 0;
  private freezeTimer = false;
  private debugEl = el('div', 'hg-debug');
  private rings = new EatRings();
  private ringLabels: HTMLElement[] = [];
  private startLevel = 1;
  private lastFrame = performance.now();
  /** Smoothed frame time (ms), the render scale it drives and when it last changed. */
  private frameMs = 16;
  private renderScale = 1;
  private scaleSince = 0;
  private basePixelRatio = 1;
  private menuGoal = new Vector3();
  private menuPos = new Vector3();
  private blendFrom = { pos: new Vector3(), target: new Vector3() };
  readonly params: URLSearchParams;

  constructor(root: HTMLElement) {
    this.params = new URLSearchParams(location.search);
    migrateScores(this.store); // scoring rules changed -> old high scores are tagged with their version and kept
    this.settings = loadSettings(this.store);
    const colorParam = this.params.get('color');
    if (colorParam) this.settings.color = colorParam;
    const qName = (this.params.get('quality') ??
      (this.settings.quality === 'auto'
        ? defaultQuality()
        : this.settings.quality)) as QualityName;
    const quality = QUALITY[qName] ?? QUALITY.high;

    root.classList.add('hg-root');
    root.append(this.stage);
    this.renderer = createRenderer(this.stage, quality);
    this.basePixelRatio = this.renderer.getPixelRatio();
    bindCameraAspect(this.renderer, this.rig.camera);
    this.env = new Environment(this.scene, quality);

    this.hud = new Hud(root, () => this.pause());
    this.setMap(this.params.get('map') ?? this.settings.map);
    this.holeMesh = new HoleMesh(holeColorById(this.settings.color));
    this.scene.add(this.holeMesh.group, this.puffs.group, this.rings.object);
    this.sim = new Sim(this.map, { seconds: 1e9 });
    this.instances = new ItemInstances(this.sim.world);
    this.scene.add(this.instances.group);
    this.leftovers = new LeftoverRings(this.sim.world);
    this.scene.add(this.leftovers.mesh);

    this.controls = new Controls(this.stage, root);
    this.controls.onThreeFingerTap = () => this.toggleDebug();
    this.menu = new Menu(root, this.menuApi());
    root.append(this.debugEl);
    this.sfx.volume = this.settings.volume;
    this.startDemo();

    // any first touch unlocks audio (iOS)
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    onBackground(() => {
      if (this.state === 'playing') this.pause();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));

    // dev deep link: ?difficulty=hard skips the menu
    const diff = this.params.get('difficulty');
    if (diff) {
      this.startRun(difficultyById(diff));
    } else {
      this.menu.welcome();
    }
    if (this.params.get('debug') === '1') this.toggleDebug();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ menu API
  private menuApi(): MenuApi {
    return {
      settings: this.settings,
      maps: MAPS.map((m) => ({
        id: m.id,
        name: m.name,
        blurb: m.blurb,
        noun: m.noun,
        seeded: !!m.seeded,
      })),
      mapId: () => this.mapDef.id,
      onMap: (id) => {
        if (id === this.mapDef.id) return;
        this.setMap(id);
        this.settings.map = id;
        saveSettings(this.store, this.settings);
        this.startDemo();
      },
      onVariant: (v) => {
        if (v.seed !== undefined) this.settings.seed = v.seed;
        saveSettings(this.store, this.settings);
        this.setMap(this.mapDef.id);
        this.startDemo();
      },
      best: (m, d) => bestScore(this.store, m, d),
      scores: (m, d) => loadScores(this.store, m, d),
      onPlay: (d) => this.startRun(d),
      onColor: (id) => {
        this.holeMesh.setColor(holeColorById(id));
        saveSettings(this.store, this.settings);
      },
      onSettings: () => {
        this.sfx.setVolume(this.settings.volume);
        saveSettings(this.store, this.settings);
      },
      onResume: () => this.resume(),
      onRestart: () => {
        this.trackQuit('restart');
        this.startRun(this.difficulty);
      },
      onMainMenu: () => {
        this.trackQuit('menu');
        this.toMenu();
      },
      onAgain: () => this.startRun(this.difficulty),
      onClick: () => this.sfx.click(),
      onPadStart: () => this.pause(),
      onPreview: (on) => (this.previewHole = on),
    };
  }

  // ------------------------------------------------------------------ map
  /** Build the ground, walls and mood of a map and make it the active one (the caller restarts the sim). */
  private setMap(id: string): void {
    const def = getMapDef(id);
    this.mapDef = def;
    // ?seed= (dev links) wins over the menu choice
    this.map = def.generate(
      Number(this.params.get('seed') ?? (def.seeded ? this.settings.seed : 1)),
    );
    if (this.ground) {
      this.scene.remove(this.ground);
      disposeGround(this.ground);
    }
    this.ground = buildMapGround(this.map);
    this.scene.add(this.ground);
    this.env.setMood(def.mood);
    this.puffs.setKind(def.puffs);
    this.hud.setNoun(def.noun);
  }

  // ------------------------------------------------------------------ run control
  /** Fresh sim + instances. */
  private newSim(seconds: number, randomStart = false): Sim {
    const sim = new Sim(this.map, {
      seconds,
      startLevel: this.startLevel,
      maxLevel: this.mapDef.maxLevel,
      start:
        this.startPos() ??
        (randomStart ? pickStart(this.map, Math.random) : undefined),
    });
    this.scene.remove(this.instances.group);
    this.disposeInstances();
    (this as { sim: Sim }).sim = sim;
    this.instances = new ItemInstances(sim.world);
    this.scene.add(this.instances.group);
    this.scene.remove(this.leftovers.mesh);
    this.leftovers.dispose();
    this.leftovers = new LeftoverRings(sim.world);
    this.scene.add(this.leftovers.mesh);
    return sim;
  }

  private startPos(): { x: number; z: number } | undefined {
    const x = this.params.get('x');
    const z = this.params.get('z');
    return x !== null && z !== null
      ? { x: Number(x), z: Number(z) }
      : undefined;
  }

  private disposeInstances(): void {
    this.instances.dispose();
  }

  /** Background demo: a bot-driven hole roams the island behind the menu. */
  private startDemo(): void {
    this.newSim(1e9);
    this.bot = new Bot(this.sim, BOT_SKILLS.good, 7);
    this.holeMesh.group.visible = true;
    this.syncHole(1);
    this.hud.show(false);
  }

  private startRun(d: Difficulty): void {
    this.difficulty = d;
    this.startLevel = Math.max(1, Number(this.params.get('level') ?? 1));
    this.seconds = Number(this.params.get('time') ?? d.seconds);
    this.menu.hide();
    this.sfx.unlock();
    this.controls.release();
    // remember where the demo camera was, to fly into the run
    this.aerialPose(this.menuAngle, this.blendFrom.pos, this.blendFrom.target);
    const sim = this.newSim(this.seconds, true); // every run starts somewhere else
    this.bot =
      this.params.get('bot') === '1' ? new Bot(sim, BOT_SKILLS.good) : null;
    this.settings.difficulty = d.id;
    saveSettings(this.store, this.settings);
    this.hud.reset();
    this.hudUpdate();
    this.hud.show(true);
    this.prev = { x: sim.hole.x, z: sim.hole.z, d: sim.hole.diameter };
    this.holeMesh.setColor(holeColorById(this.settings.color));
    this.syncHole(1);
    this.rig.snap();
    this.updateRig(0);
    this.state = 'countdown';
    if (this.ranked()) track('hole', 'level_start', this.runParams());
    this.countT = 0;
    this.lastCount = -1;
    this.acc = 0;
    this.controls.enabled = false;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.controls.enabled = false;
    this.controls.release();
    this.menu.pause();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.menu.hide();
    this.state = 'playing';
    this.controls.enabled = true;
    this.lastFrame = performance.now();
  }

  private toMenu(): void {
    this.state = 'menu';
    this.controls.enabled = false;
    this.controls.release();
    this.hud.show(false);
    this.hud.count(null);
    this.startLevel = 1;
    this.startDemo();
    this.menu.welcome();
  }

  /** Dev runs (custom time / start level / bot) are not ranked and not tracked. */
  private ranked(): boolean {
    return (
      this.params.get('time') === null &&
      this.params.get('level') === null &&
      this.params.get('bot') !== '1'
    );
  }

  /** Shared GA params of a run (see src/shared/analytics.ts, DETAILS.md "Analytics"). */
  private runParams(): EventParams {
    const map = this.mapDef.id;
    return {
      game_level_name: map,
      game_version: gameManifest.version,
      game_hole_difficulty: this.difficulty.id,
      game_hole_seed: this.mapDef.seeded ? this.settings.seed : undefined,
      game_hole_scoring_version: MAP_SCORING_VERSIONS[map],
    };
  }

  /** GA `level_end` with game_success=false when a run is left from the pause menu. */
  private trackQuit(reason: string): void {
    if (!this.ranked() || this.sim.over) return;
    if (this.state !== 'paused' && this.state !== 'playing') return;
    track('hole', 'level_end', {
      ...this.runParams(),
      game_success: false,
      game_reason: reason,
      game_time_s: seconds(this.sim.time),
      game_score: this.sim.score,
      game_hole_level: this.sim.hole.level,
    });
  }

  private finishRun(): void {
    const sim = this.sim;
    this.state = 'results';
    this.controls.enabled = false;
    this.hud.show(false);
    const entry: ScoreEntry = {
      score: sim.score,
      level: sim.hole.level,
      eaten: sim.itemsEaten,
      pct: sim.pointsEaten / sim.world.totalPoints,
      color: this.settings.color,
      date: Date.now(),
      ver: MAP_SCORING_VERSIONS[this.mapDef.id],
    };
    const ranked = this.ranked();
    if (ranked) {
      const params = this.runParams();
      track('hole', 'level_end', {
        ...params,
        game_success: true,
        game_score: entry.score,
        game_hole_level: entry.level,
        game_hole_cleared: sim.cleared,
        game_hole_items_eaten: entry.eaten,
        game_hole_pct_eaten: Math.round(entry.pct * 100),
      });
      track('hole', 'post_score', {
        ...params,
        game_score: entry.score,
        game_hole_level: entry.level,
        game_character: this.settings.color,
      });
    }
    const res = ranked
      ? recordScore(this.store, this.mapDef.id, this.difficulty.id, entry)
      : {
          list: loadScores(this.store, this.mapDef.id, this.difficulty.id),
          rank: 0,
        };
    this.menu.results({
      difficulty: this.difficulty,
      mapName: this.mapDef.name,
      noun: this.mapDef.noun,
      maxLevel: sim.maxLevel,
      score: entry.score,
      level: entry.level,
      eaten: entry.eaten,
      pct: entry.pct,
      cleared: sim.cleared,
      clearBonus: sim.clearBonus,
      perTier: sim.eatenPerTier,
      list: res.list,
      rank: res.rank,
      entry,
    });
  }

  // ------------------------------------------------------------------ keys
  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    } else if (e.code === 'F2') {
      e.preventDefault();
      this.toggleDebug();
    } else if (this.debugEl.classList.contains('on')) {
      if (e.code === 'F4') {
        e.preventDefault();
        this.toggleRings();
      } else if (e.code === 'F8') {
        e.preventDefault();
        this.bot = this.bot ? null : new Bot(this.sim, BOT_SKILLS.good);
      } else if (e.key === '+' || e.key === '=')
        this.sim.setLevel(this.sim.hole.level + 1);
      else if (e.key === '-') this.sim.setLevel(this.sim.hole.level - 1);
      else if (e.code === 'KeyT') this.freezeTimer = !this.freezeTimer;
    }
  }

  private toggleDebug(): void {
    const on = this.debugEl.classList.toggle('on');
    this.controls.showReadout = on;
    if (!on) this.setRings(false);
  }

  private toggleRings(): void {
    this.setRings(!this.rings.visible);
  }

  private setRings(on: boolean): void {
    this.rings.visible = on;
    this.debugRingsBtn?.classList.toggle('active', on);
    if (!on) for (const l of this.ringLabels) l.style.display = 'none';
  }

  /** Eat-rule rings + the hole level of the nearest items (F4). */
  private updateRings(): void {
    if (!this.rings.visible) return;
    const w = this.sim.world;
    const h = this.sim.hole;
    this.rings.update(w, h.x, h.z, h.diameter, h.level);
    const n = Math.min(this.rings.nearest.length, 18);
    while (this.ringLabels.length < n) {
      const l = el('div', 'hg-ring-label');
      this.debugEl.parentElement?.append(l);
      this.ringLabels.push(l);
    }
    for (let k = 0; k < this.ringLabels.length; k++) {
      const l = this.ringLabels[k];
      const i = k < n ? this.rings.nearest[k] : -1;
      const p = i >= 0 ? this.project(w.x[i], 0.3, w.z[i]) : null;
      if (!p) {
        l.style.display = 'none';
        continue;
      }
      l.style.display = '';
      l.textContent = `L${w.level[i]}`;
      l.classList.toggle('red', w.level[i] > h.level);
      l.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const ms = Math.max(0, now - this.lastFrame);
    const idle = this.state !== 'playing' && this.state !== 'countdown';
    if (idle && this.state !== 'ending' && ms < IDLE_FRAME_MS - 4) return;
    const dt = Math.min(0.1, ms / 1000);
    this.lastFrame = now;
    this.adaptResolution(ms, now);
    this.tick(dt, true);
  }

  /**
   * Keep phones smooth: when the frame time stays high in a run, render at a
   * lower resolution (down to 70 %); step back up when there is headroom.
   */
  private adaptResolution(ms: number, now: number): void {
    if (this.state !== 'playing' || ms > 100) return;
    this.frameMs += (ms - this.frameMs) * 0.05;
    const since = now - this.scaleSince;
    let scale = this.renderScale;
    if (this.frameMs > SLOW_MS && since > 1500)
      scale = Math.max(MIN_SCALE, scale * 0.88);
    else if (this.frameMs < FAST_MS && since > 6000)
      scale = Math.min(1, scale / 0.88);
    if (Math.abs(scale - this.renderScale) < 0.01) return;
    this.renderScale = scale;
    this.scaleSince = now;
    this.frameMs = (SLOW_MS + FAST_MS) / 2;
    this.renderer.setPixelRatio(this.basePixelRatio * scale);
  }

  /** One frame of game logic (+ optional render). Also used by `advance` for tests / headless stepping. */
  private tick(dt: number, render: boolean): void {
    switch (this.state) {
      case 'menu':
        this.stepDemo(dt);
        this.updateMenuCamera(dt);
        break;
      case 'countdown':
        this.stepCountdown(dt);
        break;
      case 'playing':
      case 'ending':
        this.stepRun(dt);
        break;
      default:
        break;
    }
    this.holeMesh.tick(dt);
    this.puffs.update(dt);
    this.instances.update();
    if (!render) return;
    const focus = this.rig.target;
    this.env.follow(focus, this.rig.distance * 0.95);
    this.env.setFog(
      this.rig.distance * 2.5,
      this.rig.distance * 10 + 300,
      this.scene,
    );
    this.fadeBuildings();
    this.animateScene();
    this.updateLeftovers();
    this.renderer.render(this.scene, this.rig.camera);
    if (this.debugEl.classList.contains('on')) this.updateDebug();
    this.updateRings();
  }

  /** Last items of a run (< `LEFTOVER_POINTS` left): pulsing rings, and drawn even when tiny for the camera. */
  private updateLeftovers(): void {
    const run = this.state === 'playing' || this.state === 'ending';
    const sim = this.sim;
    if (run)
      this.leftovers.update(
        sim.world.totalPoints - sim.pointsEaten,
        this.rig.distance,
        performance.now() / 1000,
      );
    this.instances.setView(this.leftovers.active ? 0 : this.rig.distance);
  }

  /** Drifting water and the sky dome follow the camera; both are cosmetic. */
  private animateScene(): void {
    (
      this.ground?.userData.animate as ((seconds: number) => void) | undefined
    )?.(performance.now() / 1000);
    this.env.updateDome(this.rig.camera);
  }

  /** Buildings between the camera and the hole turn into a dither (not in the menu fly-around). */
  private fadeBuildings(): void {
    if (this.state === 'menu') {
      clearHoleFade();
      return;
    }
    const g = this.holeMesh.group;
    this.renderer.getDrawingBufferSize(this.bufferSize);
    updateHoleFade(
      this.rig.camera,
      g.position.x,
      g.position.z,
      g.scale.x,
      this.bufferSize.x,
      this.bufferSize.y,
    );
  }

  /** Advance the game by `seconds` of game time without waiting for animation frames (background tabs, tests). */
  advance(seconds: number, fps = 30): void {
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) this.tick(dt, false);
    this.tick(0, true);
  }

  /** Items eaten in the menu background are just visual. */
  private stepDemo(dt: number): void {
    const sim = this.sim;
    if (sim.over) {
      this.startDemo();
      return;
    }
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const c = this.bot!.control(STEP);
      this.prev = { x: sim.hole.x, z: sim.hole.z, d: sim.hole.diameter };
      sim.step(STEP, c.x, c.z);
      sim.drainEvents();
    }
    this.syncHole(this.acc / STEP);
  }

  private updateMenuCamera(dt: number): void {
    this.menuAngle += dt * 0.06;
    this.aerialPose(this.menuAngle, this.rig.camera.position, this.rig.target);
    const k = (this.previewK +=
      ((this.previewHole ? 1 : 0) - this.previewK) * (1 - Math.exp(-dt / 0.3)));
    if (k > 0.001) {
      // close-up of the demo hole, shifted so it sits above the bottom card
      const h = this.sim.hole;
      const dist = cameraDistance(h.diameter) * 0.6;
      const pitch = MathUtils.degToRad(cameraPitchDeg(1));
      const goal = this.menuGoal.set(h.x, 0, h.z + dist * 0.4);
      const pos = this.menuPos.set(
        goal.x,
        Math.sin(pitch) * dist,
        goal.z + Math.cos(pitch) * dist,
      );
      this.rig.camera.position.lerp(pos, k);
      this.rig.target.lerp(goal, k);
    }
    this.rig.distance = MathUtils.lerp(this.mapDef.aerial.radius * 0.8, 12, k);
    this.rig.camera.far = 3000;
    this.rig.camera.near = k > 0.05 ? 0.4 : 5;
    this.rig.camera.updateProjectionMatrix();
    this.rig.camera.lookAt(this.rig.target);
  }

  private aerialPose(angle: number, pos: Vector3, target: Vector3): void {
    // portrait screens see less of the width: pull the aerial camera back
    const asp = this.rig.camera.aspect || 1.4;
    const r = this.mapDef.aerial.radius * Math.max(1, Math.pow(1.4 / asp, 0.6));
    const pitch = MathUtils.degToRad(this.mapDef.aerial.pitchDeg);
    target.set(0, 0, 0);
    pos.set(
      Math.cos(angle) * r * Math.cos(pitch),
      r * Math.sin(pitch),
      Math.sin(angle) * r * Math.cos(pitch),
    );
  }

  private stepCountdown(dt: number): void {
    this.countT += dt;
    const k = Math.min(1, this.countT / COUNTDOWN);
    const ease = k * k * (3 - 2 * k);
    // fly from the aerial view into the hole camera
    this.updateRig(0);
    const pos = this.rig.camera.position;
    const tgt = this.rig.target.clone();
    pos.lerpVectors(this.blendFrom.pos, pos.clone(), ease);
    tgt.lerpVectors(this.blendFrom.target, tgt, ease);
    this.rig.camera.lookAt(tgt);
    const n = Math.ceil(COUNTDOWN - this.countT);
    if (n !== this.lastCount && n >= 1) {
      this.lastCount = n;
      this.hud.count(String(n));
      this.sfx.beep(false);
    }
    if (this.countT >= COUNTDOWN) {
      this.hud.count('GO!');
      this.sfx.beep(true);
      window.setTimeout(() => this.hud.count(null), 600);
      this.state = 'playing';
      this.controls.enabled = true;
      this.lastFrame = performance.now();
    }
  }

  private stepRun(dt: number): void {
    const sim = this.sim;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps++ < 6) {
      this.acc -= STEP;
      this.prev = { x: sim.hole.x, z: sim.hole.z, d: sim.hole.diameter };
      let c = this.controls.world();
      if (this.bot) c = this.bot.control(STEP);
      if (this.freezeTimer) sim.time -= STEP;
      sim.step(STEP, c.x, c.z);
      this.handleEvents();
    }
    if (steps >= 6) this.acc = 0;
    this.syncHole(this.acc / STEP);
    this.updateRig(dt);
    this.hudUpdate();
    if (sim.over && this.state === 'playing') {
      this.state = 'ending';
      this.endT = 0;
      this.controls.enabled = false;
      this.controls.release();
      this.sfx.horn();
    }
    if (this.state === 'ending') {
      this.endT += dt;
      if (sim.settled || this.endT > 3) this.finishRun();
    }
  }

  private hudUpdate(): void {
    const sim = this.sim;
    this.hud.update(
      sim.timeLeft,
      sim.score,
      sim.hole.level,
      sim.levelProgress,
      sim.pointsEaten / sim.world.totalPoints,
    );
  }

  private handleEvents(): void {
    const sim = this.sim;
    const w = sim.world;
    // one layout read for all eats of this frame (each popup dirties the layout again)
    let rect: DOMRect | undefined;
    for (const e of sim.drainEvents()) {
      if (e.type === 'eat') {
        const tier = w.tier[e.item];
        this.sfx.gulp(tier, w.types[w.type[e.item]].group);
        this.holeMesh.kick(0.3 + tier * 0.025);
        if (w.types[w.type[e.item]].group === 'giants') {
          this.sfx.roar();
          this.rig.shake(1);
          this.holeMesh.kick(1);
        }
        this.puffs.spawn(
          e.x,
          e.z,
          w.size[e.item],
          w.types[w.type[e.item]].group === 'plush',
        );
        rect ??= this.stage.getBoundingClientRect();
        const p = this.project(
          e.x,
          Math.min(2, w.height[e.item] * 0.5),
          e.z,
          rect,
        );
        if (p) this.hud.popup(p.x, p.y, `+${e.points}`, tierColor(tier));
      } else if (e.type === 'levelup') {
        this.hud.banner(`LEVEL ${e.level}`);
        this.holeMesh.pulse();
        this.sfx.levelUp();
      } else if (e.type === 'cleared') {
        this.hud.banner(
          `${this.mapDef.noun.toUpperCase()} CLEARED!`,
          this.mapDef.id,
        );
      }
    }
  }

  private project(
    x: number,
    y: number,
    z: number,
    r: DOMRect = this.stage.getBoundingClientRect(),
  ): { x: number; y: number } | null {
    const v = _projected.set(x, y, z).project(this.rig.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return {
      x: r.left + ((v.x + 1) / 2) * r.width,
      y: r.top + ((1 - v.y) / 2) * r.height,
    };
  }

  private syncHole(alpha: number): void {
    const h = this.sim.hole;
    const a = Math.min(1, Math.max(0, alpha));
    const x = this.prev.x + (h.x - this.prev.x) * a;
    const z = this.prev.z + (h.z - this.prev.z) * a;
    const d = this.prev.d + (h.diameter - this.prev.d) * a;
    this.holeMesh.setPosition(x, z);
    this.holeMesh.setDiameter(d);
  }

  private updateRig(dt: number): void {
    const h = this.sim.hole;
    this.rig.update(dt, h.x, h.z, h.diameter, h.level);
  }

  // ------------------------------------------------------------------ debug
  private debugBuilt = false;
  private debugRingsBtn: HTMLElement | null = null;
  private debugText = el('div');

  private updateDebug(): void {
    if (!this.debugBuilt) {
      this.debugBuilt = true;
      const mk = (
        label: string,
        min: number,
        max: number,
        step: number,
        get: () => number,
        set: (v: number) => void,
      ) => {
        const l = el('label', '', label);
        const i = el('input', '', '', {
          type: 'range',
          min: String(min),
          max: String(max),
          step: String(step),
        });
        i.value = String(get());
        i.addEventListener('input', () => set(Number(i.value)));
        l.append(i);
        this.debugEl.append(l);
      };
      this.debugEl.append(this.debugText);
      mk(
        'cam distance',
        0.5,
        2,
        0.05,
        () => this.rig.tuning.distanceScale,
        (v) => (this.rig.tuning.distanceScale = v),
      );
      mk(
        'cam pitch +',
        -25,
        25,
        1,
        () => this.rig.tuning.pitchOffset,
        (v) => (this.rig.tuning.pitchOffset = v),
      );
      mk(
        'joy max px',
        30,
        160,
        1,
        () => this.controls.tuning.maxDragPx,
        (v) => (this.controls.tuning.maxDragPx = v),
      );
      mk(
        'joy dead px',
        0,
        30,
        1,
        () => this.controls.tuning.deadZonePx,
        (v) => (this.controls.tuning.deadZonePx = v),
      );
      this.debugRingsBtn = el('button', 'hg-debug-btn', 'eat rings (F4)', {
        type: 'button',
      });
      this.debugRingsBtn.addEventListener('click', () => this.toggleRings());
      this.debugEl.append(this.debugRingsBtn);
      this.debugEl.append(
        el(
          'div',
          '',
          'F4 eat rings (green eats, red too big, label = item level) · F8 bot · +/- level · T freeze timer · 3-finger tap toggles',
        ),
      );
    }
    const s = this.sim;
    const h = s.hole;
    this.debugText.textContent = [
      `state ${this.state}  bot ${this.bot ? 'on' : 'off'}`,
      `level ${h.level}/${MAX_LEVEL}  D ${h.diameter.toFixed(2)} (target ${holeDiameter(h.level).toFixed(2)})`,
      `xp ${h.xp}  score ${s.score}  eaten ${s.itemsEaten}`,
      `remaining ${s.world.remaining}/${s.world.n}  active ${s.world.active.size}`,
      `speed ${Math.hypot(h.vx, h.vz).toFixed(1)} m/s  pos ${h.x.toFixed(0)},${h.z.toFixed(0)}`,
      `stick ${this.controls.stick.x.toFixed(2)},${this.controls.stick.y.toFixed(2)}`,
      `cam dist ${this.rig.distance.toFixed(1)} pitch ${this.rig.pitchDeg.toFixed(0)}`,
    ].join('\n');
  }

  /** Console helper: average + worst ms per frame (incl. GPU) for `frames` bot-driven frames. */
  benchmark(frames = 240): { avgMs: number; worstMs: number } {
    const gl = this.renderer.getContext();
    const times: number[] = [];
    const bot = new Bot(this.sim, BOT_SKILLS.good);
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      const c = bot.control(STEP);
      this.sim.step(STEP, c.x, c.z);
      this.sim.drainEvents();
      this.instances.update();
      this.updateRig(STEP);
      this.syncHole(1);
      this.fadeBuildings();
      this.instances.setView(this.rig.distance);
      this.renderer.render(this.scene, this.rig.camera);
      gl.finish();
      times.push(performance.now() - t0);
    }
    return {
      avgMs: times.reduce((a, b) => a + b, 0) / times.length,
      worstMs: Math.max(...times),
    };
  }

  /** Canvas for the portal thumbnail capture (F9). */
  captureCanvas(): HTMLCanvasElement {
    this.fadeBuildings();
    this.animateScene();
    this.renderer.render(this.scene, this.rig.camera);
    return this.renderer.domElement;
  }
}

function tierColor(level: number): string {
  if (level <= 5) return '#ffffff';
  if (level <= 12) return '#ffe066';
  if (level <= 20) return '#ffb347';
  return '#ff7a6b';
}
