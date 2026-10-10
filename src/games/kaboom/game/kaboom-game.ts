import { Vector2 } from 'three';
import { CritterPreview } from '../render/critter-preview';
import { track } from '../../../shared/analytics';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { matchMapFactory } from '../map/generate';
import { MAP_SIZES, isMapSizeId } from '../map/sizes';
import { CameraRig } from '../render/camera-rig';
import { PortraitStudio } from '../render/portraits';
import {
  QUALITY,
  bindCameraAspect,
  createRenderer,
  defaultQuality,
  isQualityName,
} from '../render/renderer';
import { WorldView } from '../render/world-view';
import { BotController } from '../sim/bot';
import { COUNTDOWN_S, STEP } from '../sim/rules';
import { Sim } from '../sim/sim';
import { CRITTERS } from '../sim/types';
import type {
  CritterId,
  Difficulty,
  MapSizeId,
  MatchConfig,
  PlayerInput,
  RoundCount,
  SimEvent,
} from '../sim/types';
import manifest from '../game.json';
import { Sfx } from './audio';
import { title } from './dom';
import { Hud } from './hud';
import { Controls } from './input';
import { Menu, type MatchSetup, type MatchSummary } from './menu';
import {
  DIFFICULTIES,
  ROUND_COUNTS,
  clampBots,
  loadSettings,
  loadStats,
  recordMatch,
  saveSettings,
  type KaboomSettings,
  type CameraSetting,
  type QualitySetting,
} from './settings';
import { defaultStorage } from './storage';

/** Longest frame the loop catches up on (tab was in the background): drop the rest instead of a spiral of ticks. */
const MAX_FRAME_S = 0.1;
/** How long the result of a round stays on screen before the next round / the results card. */
const ROUND_HOLD_S = 2.8;
const ATTRACT_HOLD_S = 2;
/** The sim runs this much faster while the human is out and only bots are left. */
const SPECTATE_SPEED = 2;

type Phase = 'menu' | 'loading' | 'play' | 'paused' | 'results';
const rand = (): number => (Math.random() * 1e6) | 0;

/**
 * The play page's game: renderer, camera, the menus and HUD, and the state machine around one match - menu (a bot match
 * plays behind it) -> loading (warm-up) -> countdown -> play -> round over -> ... -> results, with pause. The sim ticks at
 * `STEP`; rendering interpolates with `alpha`. `WorldView` draws everything from the sim.
 */
export class KaboomGame {
  readonly params = new URLSearchParams(location.search);
  readonly store = defaultStorage();
  readonly settings: KaboomSettings;
  readonly renderer;
  readonly rig = new CameraRig();
  readonly stats: StatsOverlay;
  sim: Sim | null = null;
  view: WorldView | null = null;
  phase: Phase = 'menu';
  /** `match` = a real game with the human in slot 0; `attract` = bots only, behind the menu. */
  mode: 'attract' | 'match' = 'attract';

  private readonly sfx = new Sfx();
  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly portraits;
  private readonly quality;
  private bots: BotController | null = null;
  private cfg: MatchConfig | null = null;
  private setup: MatchSetup | null = null;
  private readonly humanIn: PlayerInput = { dx: 0, dy: 0, place: false };
  private readonly inputBuf: PlayerInput[] = [];
  private acc = 0;
  private alpha = 1;
  private last = performance.now();
  private clock = 0;
  /** Real-time clock when the round ended (-1 = running). */
  private roundEndedAt = -1;
  private roundBanner: {
    text: string;
    sub: string;
    kind: 'win' | 'lose' | '';
  } | null = null;
  private lastCount = -1;
  private suddenShownAt = -1;
  private ranked = true;
  /** Sim ticks run so far. */
  ticks = 0;

  constructor(root: HTMLElement) {
    this.settings = loadSettings(this.store);
    const camParam = this.params.get('camera');
    this.rig.view =
      camParam === 'full' || camParam === 'follow'
        ? camParam
        : this.settings.camera;
    const qParam = this.params.get('quality');
    const qSetting = this.settings.quality;
    const qName = isQualityName(qParam)
      ? qParam
      : qSetting === 'auto'
        ? defaultQuality()
        : qSetting;
    this.quality = QUALITY[qName];
    root.classList.add('kb-root');
    this.renderer = createRenderer(root, this.quality);
    bindCameraAspect(this.renderer, this.rig.camera, () => this.view?.fit());
    // a restored WebGL context starts with an empty shadow map, and the arena only redraws it when a crate breaks
    this.renderer.domElement.addEventListener('webglcontextrestored', () =>
      this.view?.arena.markShadowDirty(),
    );
    this.portraits = new PortraitStudio(this.renderer);
    this.stats = new StatsOverlay(
      this.renderer,
      root,
      this.params.get('debug') === '1',
    );

    this.controls = new Controls(this.renderer.domElement, root);
    this.controls.onPause = () => {
      if (this.phase === 'play' && this.mode === 'match') this.pause();
      else if (this.phase === 'paused') this.resume();
    };
    this.controls.onCamera = () => {
      if (this.phase === 'play' && this.mode === 'match')
        this.setCamera(this.settings.camera === 'follow' ? 'full' : 'follow');
    };
    this.hud = new Hud(root, () => this.pause(), this.portraits.get);
    this.menu = new Menu(root, {
      settings: this.settings,
      portrait: this.portraits.get,
      stats: () => loadStats(this.store),
      onPlay: (s) => void this.startMatch(s),
      onSettings: () => saveSettings(this.store, this.settings),
      onArena: () => {
        if (this.mode === 'attract') this.startAttract();
      },
      onLineup: () => this.syncAttract(),
      onVolume: (v) => this.sfx.setVolume(v),
      onQuality: (q) => this.changeQuality(q),
      onCamera: (c) => this.setCamera(c),
      onResume: () => this.resume(),
      onRestart: () => void this.startMatch(this.setup ?? this.currentSetup()),
      onMainMenu: () => this.toMenu(),
      onClick: () => this.sfx.click(),
      makeStage: () => {
        try {
          return new CritterPreview();
        } catch {
          return null; // no second GL context: the portrait stands in
        }
      },
    });
    this.sfx.volume = this.settings.volume;

    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const hidden = () => {
      if (this.phase === 'play' && this.mode === 'match') this.pause();
    };
    document.addEventListener(
      'visibilitychange',
      () => document.hidden && hidden(),
    );
    window.addEventListener('pagehide', hidden);

    this.startAttract();
    // dev deep link: ?play=1 (or any of size / bots / difficulty / rounds / critter) skips the menu
    if (
      ['play', 'size', 'bots', 'difficulty', 'rounds', 'critter'].some((k) =>
        this.params.has(k),
      )
    )
      void this.startMatch(this.setupFromUrl());
    else this.menu.welcome();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup helpers

  private currentSetup(): MatchSetup {
    const s = this.settings;
    return {
      critter: s.critter,
      color: s.color,
      bots: s.bots,
      difficulty: s.difficulty,
      size: s.size,
      rounds: s.rounds,
    };
  }

  /** The menu's setup, overridden by URL params (`size=l&bots=5&difficulty=hard&rounds=3&critter=otter`). */
  private setupFromUrl(): MatchSetup {
    const base = this.currentSetup();
    const p = this.params;
    const size = p.get('size') ?? '';
    const diff = p.get('difficulty') ?? '';
    const rounds = Number(p.get('rounds'));
    const critter = p.get('critter') ?? '';
    const sz: MapSizeId = isMapSizeId(size) ? size : base.size;
    return {
      size: sz,
      bots: clampBots(sz, p.has('bots') ? Number(p.get('bots')) : base.bots),
      difficulty: DIFFICULTIES.includes(diff as Difficulty)
        ? (diff as Difficulty)
        : base.difficulty,
      rounds: ROUND_COUNTS.includes(rounds as RoundCount)
        ? (rounds as RoundCount)
        : base.rounds,
      critter: (CRITTERS as readonly string[]).includes(critter)
        ? (critter as CritterId)
        : base.critter,
      color: base.color,
    };
  }

  /** Switch the camera view (options, or C in a match) and keep the choice. */
  private setCamera(c: CameraSetting): void {
    this.settings.camera = c;
    saveSettings(this.store, this.settings);
    this.rig.view = c;
    this.view?.fit();
  }

  private changeQuality(q: QualitySetting): void {
    this.settings.quality = q;
    saveSettings(this.store, this.settings);
    location.reload();
  }

  // ------------------------------------------------------------------ matches

  private disposeView(): void {
    this.view?.dispose();
    this.view = null;
    this.sim = null;
    this.bots = null;
  }

  /**
   * Bots only, behind the menu, on the arena size picked in the setup. Every spawn is filled; the ones beyond the
   * picked bot count sit benched (`syncAttract`), so changing the count or the colour never rebuilds the scene.
   */
  private startAttract(): void {
    this.disposeView();
    const size = this.settings.size;
    const cfg: MatchConfig = {
      seed: rand(),
      size,
      bots: MAP_SIZES[size].maxPlayers - 1,
      color: this.settings.color,
      difficulty: 'normal',
      rounds: 5,
      critter: this.settings.critter,
    };
    const sim = new Sim(cfg, matchMapFactory(cfg), { countdown: 0.6 });
    this.sim = sim;
    this.cfg = cfg;
    this.bots = new BotController(
      sim,
      'normal',
      cfg.seed,
      sim.players.map((p) => p.id),
    );
    this.view = new WorldView(sim, this.quality, {
      rig: this.rig,
      follow: false,
    });
    this.view.followId = -1;
    // benched before the first frame: the crew starts without them (no launch)
    const bots = clampBots(size, this.settings.bots);
    for (const p of sim.players) sim.setPresent(p.id, p.id <= bots);
    this.mode = 'attract';
    this.phase = 'menu';
    this.roundEndedAt = -1;
    this.roundBanner = null;
    this.acc = 0;
    this.hud.hide();
    this.controls.setEnabled(false);
  }

  /** Setup changes over the background match: bots fly in / out to match the count, the teams recolour. */
  private syncAttract(): void {
    const sim = this.sim;
    if (this.mode !== 'attract' || !sim) return;
    if (sim.map.sizeId !== this.settings.size) return this.startAttract();
    const bots = clampBots(this.settings.size, this.settings.bots);
    for (const p of sim.players) sim.setPresent(p.id, p.id <= bots);
    sim.setTeamColor(this.settings.color);
  }

  /** Build a match, warm everything up behind a loading card, then start the countdown. */
  async startMatch(setup: MatchSetup): Promise<void> {
    this.setup = setup;
    this.phase = 'loading';
    this.controls.setEnabled(false);
    this.menu.hide();
    this.menu.loading(true);
    this.disposeView();
    await new Promise((r) => setTimeout(r, 30)); // let the loading card paint

    const cfg: MatchConfig = {
      seed: Number(this.params.get('seed')) || rand(),
      size: setup.size,
      bots: setup.bots,
      difficulty: setup.difficulty,
      rounds: setup.rounds,
      critter: setup.critter,
      color: setup.color,
    };
    const sim = new Sim(cfg, matchMapFactory(cfg), { countdown: COUNTDOWN_S });
    const autopilot = this.params.get('bot') === '1';
    const bots = new BotController(
      sim,
      cfg.difficulty,
      cfg.seed,
      autopilot ? sim.players.map((p) => p.id) : undefined,
    );
    const view = new WorldView(sim, this.quality, { rig: this.rig });
    view.followId = autopilot ? -1 : 0;
    view.crew.setYou(autopilot ? -1 : 0);
    await view.warmUp(this.renderer, view.scene);

    this.sim = sim;
    this.cfg = cfg;
    this.bots = bots;
    this.view = view;
    this.mode = 'match';
    this.ranked = !autopilot && !this.params.has('seed');
    this.menu.loading(false);
    this.hud.setPlayers(sim);
    this.hud.resetTnt();
    this.hud.show();
    this.hud.showHint(
      this.controls.touchUi
        ? 'Drag to move · tap TNT to drop a bomb'
        : 'WASD / arrows to move · Space drops TNT',
      7,
    );
    this.controls.setEnabled(true);
    this.phase = 'play';
    this.roundEndedAt = -1;
    this.roundBanner = null;
    this.lastCount = -1;
    this.suddenShownAt = -1;
    this.acc = 0;
    if (this.ranked)
      track('kaboom', 'level_start', {
        game_level_name: cfg.size,
        game_version: manifest.version,
        game_kaboom_difficulty: cfg.difficulty,
        game_kaboom_bots: cfg.bots,
        game_kaboom_rounds: cfg.rounds,
        game_character: cfg.critter,
      });
  }

  private pause(): void {
    if (this.phase !== 'play') return;
    this.phase = 'paused';
    this.controls.setEnabled(false);
    this.menu.pause();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'play';
    this.menu.hide();
    this.controls.setEnabled(true);
  }

  private toMenu(): void {
    if (this.mode === 'match' && this.phase !== 'results')
      this.trackEnd(false, 'quit');
    this.hud.hide();
    this.controls.setEnabled(false);
    this.startAttract();
    this.menu.welcome();
  }

  private trackEnd(success: boolean, reason?: string): void {
    if (!this.ranked || !this.cfg || !this.sim) return;
    track('kaboom', 'level_end', {
      game_level_name: this.cfg.size,
      game_version: manifest.version,
      game_kaboom_difficulty: this.cfg.difficulty,
      game_kaboom_bots: this.cfg.bots,
      game_kaboom_rounds: this.cfg.rounds,
      game_character: this.cfg.critter,
      game_success: success,
      game_reason: reason,
      game_kaboom_round: this.sim.round + 1,
      game_kaboom_round_wins: this.sim.players[0].wins,
    });
  }

  // ------------------------------------------------------------------ the loop

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(MAX_FRAME_S, (now - this.last) / 1000);
    this.last = now;
    this.step(dt, true);
    this.stats.end();
  }

  /** One frame: advance the sim (unless paused), update the HUD, draw. `draw = false` for the debug `advance`. */
  private step(dt: number, draw: boolean): void {
    const sim = this.sim;
    const view = this.view;
    if (!sim || !view) return;
    this.clock += dt;
    const running =
      (this.phase === 'play' && this.mode === 'match') ||
      this.mode === 'attract';
    let speed = 1;
    if (this.mode === 'match' && sim.players[0].state === 'ko' && !sim.over)
      speed = SPECTATE_SPEED;
    if (running && this.phase !== 'loading') {
      this.acc += dt * speed;
      while (this.acc >= STEP) {
        this.tick(sim, view);
        this.acc -= STEP;
      }
      this.alpha = this.acc / STEP;
    }
    this.afterTicks(sim);
    view.update(this.alpha, this.phase === 'paused' ? 0 : dt * speed);
    if (this.mode === 'match' && this.phase !== 'loading') this.updateHud(sim);
    if (draw) {
      if (view.takeShadowUpdate()) this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(view.scene, this.rig.camera);
    }
  }

  private tick(sim: Sim, view: WorldView): void {
    const human =
      this.mode === 'match' ? this.controls.read(this.humanIn) : undefined;
    const events = sim.tick(this.bots!.inputs(this.inputBuf, human));
    this.ticks++;
    if (events.length === 0) return;
    view.onEvents(events);
    this.sfx.onEvents(events);
    for (const e of events) this.onEvent(sim, e);
  }

  private onEvent(sim: Sim, e: SimEvent): void {
    if (e.type === 'roundOver') {
      this.roundEndedAt = this.clock;
      if (this.mode === 'match') {
        const w = e.winner === null ? null : sim.players[e.winner];
        const youWon = e.winner === 0;
        this.roundBanner = w
          ? {
              text: youWon
                ? 'You win the round!'
                : `${title(w.critter)} wins the round!`,
              sub: '',
              kind: youWon ? 'win' : 'lose',
            }
          : { text: 'Draw!', sub: 'Nobody made it out', kind: '' };
        if (youWon) this.sfx.win();
        else if (w) this.sfx.lose();
      }
    }
  }

  /** Round and match transitions, driven by real time so they also work while FX are frozen. */
  private afterTicks(sim: Sim): void {
    if (this.roundEndedAt < 0 || !sim.over) return;
    const hold = this.mode === 'attract' ? ATTRACT_HOLD_S : ROUND_HOLD_S;
    if (this.clock - this.roundEndedAt < hold || this.phase === 'paused')
      return;
    this.roundEndedAt = -1;
    if (this.mode === 'attract') {
      if (sim.matchOver) {
        this.startAttract();
      } else {
        sim.nextRound();
        this.view?.crew.reset();
      }
      return;
    }
    if (sim.matchOver) this.endMatch(sim);
    else {
      sim.nextRound();
      this.roundBanner = null;
      this.lastCount = -1;
      this.suddenShownAt = -1;
      this.hud.resetTnt();
    }
  }

  private endMatch(sim: Sim): void {
    this.phase = 'results';
    this.controls.setEnabled(false);
    const winner = sim.matchWinner;
    const outcome: MatchSummary['outcome'] =
      winner === 0 ? 'win' : winner === null ? 'tie' : 'lose';
    const headline =
      outcome === 'win'
        ? 'You win the match!'
        : outcome === 'tie'
          ? "It's a tie!"
          : `${title(sim.players[winner!].critter)} wins the match`;
    if (this.ranked)
      recordMatch(this.store, sim.players[0].critter, outcome === 'win');
    this.trackEnd(outcome === 'win');
    this.hud.setBanner('');
    this.menu.results({
      outcome,
      headline,
      rounds: sim.config.rounds,
      standings: sim.players.map((p) => ({
        critter: p.critter,
        color: p.color,
        wins: p.wins,
        you: p.id === 0,
        slot: p.id,
      })),
    });
    if (outcome === 'win') this.sfx.win();
  }

  /** HUD text for this frame: countdown, GO, sudden death, the round result, "you're out". */
  private updateHud(sim: Sim): void {
    if (this.phase === 'results') return;
    this.hud.update(sim, sim.config.rounds);
    this.controls.setTntLeft(sim.players[0].tntLeft);
    if (this.roundBanner && sim.over) {
      this.hud.setBanner(
        this.roundBanner.text,
        this.roundBanner.sub,
        this.roundBanner.kind,
      );
      return;
    }
    if (sim.countdown > 0) {
      const n = Math.ceil(sim.countdown - 1e-6);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.sfx.countdown(n);
      }
      this.hud.setBanner(
        String(n),
        sim.round > 0 ? `Round ${sim.round + 1}` : '',
      );
      return;
    }
    if (this.lastCount > 0) {
      this.lastCount = 0;
      this.sfx.countdown(0);
    }
    if (sim.time < 0.9) {
      this.hud.setBanner('GO!', '', 'go');
      return;
    }
    if (sim.suddenDeath) {
      if (this.suddenShownAt < 0) {
        this.suddenShownAt = this.clock;
        this.sfx.siren();
      }
      if (this.clock - this.suddenShownAt < 2.4) {
        this.hud.setBanner('SUDDEN DEATH!', 'Walls are falling in', 'warn');
        return;
      }
    }
    if (sim.players[0].state === 'ko' && !sim.over)
      this.hud.setBanner('', "You're out! Watching the bots... (fast forward)");
    else this.hud.setBanner('');
  }

  // ------------------------------------------------------------------ dev helpers

  /** Console helper: average + worst ms per frame (incl. GPU) over `frames` frames, works with a hidden tab. */
  benchmark(frames = 240): { avgMs: number; worstMs: number } {
    const gl = this.renderer.getContext();
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      this.step(STEP, true);
      gl.finish();
      times.push(performance.now() - t0);
    }
    return {
      avgMs: times.reduce((a, b) => a + b, 0) / times.length,
      worstMs: Math.max(...times),
    };
  }

  /** Step the game `seconds` ahead without drawing (the browser pane throttles frames); then screenshot. */
  advance(seconds: number, fps = 30): void {
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) this.step(dt, false);
  }

  /** Canvas for the portal thumbnail capture (F9): render right before reading it. */
  captureCanvas(): HTMLCanvasElement {
    this.step(0, true);
    return this.renderer.domElement;
  }

  /** Dev-only: render at `w x h` and return the canvas to read straight away (README screenshots); the size is restored after. */
  captureAt(w: number, h: number): HTMLCanvasElement {
    const r = this.renderer;
    const size = r.getSize(new Vector2());
    const ratio = r.getPixelRatio();
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.view?.fit();
    this.step(0, true);
    queueMicrotask(() => {
      r.setPixelRatio(ratio);
      r.setSize(size.x, size.y, false);
      this.rig.camera.aspect = size.x / size.y;
      this.rig.camera.updateProjectionMatrix();
      this.view?.fit();
    });
    return r.domElement;
  }
}
