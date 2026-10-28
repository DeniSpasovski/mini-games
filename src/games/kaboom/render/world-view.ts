import {
  Group,
  Scene,
  Vector3,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { LevelId } from '../game/levels';
import { MAX_PLAYERS, MAX_TNT } from '../sim/rules';
import { Terrain, type KaboomSim, type SimEvent } from '../sim/types';
import { Arena } from './arena';
import { CAM_PITCH_DEG, CameraRig, SLAB_PAD } from './camera-rig';
import { treadMidD, TIERS } from './bowl';
import { Crowd } from './crowd';
import { Crew, TEAM_COLORS, type PodiumSpot } from './characters';
import { Podium, STEP_D, STEP_W } from './podium';
import { Fx } from './fx/fx';
import { ItemRenderer } from './items';
import { GlowGrid } from './fx/glow-grid';
import { levelEnvironment } from './environment';
import { makeSkyTexture } from './materials';
import { levelTheme } from './themes';
import type { LevelTheme, PlatformPose } from './themes/theme';
import type { Quality } from './renderer';
import { BlobShadows } from './shadows';
import { TntRenderer } from './tnt';

export interface WorldViewOptions {
  /** Share a camera rig (tool pages) instead of creating one. */
  rig?: CameraRig;
  /** Follow the human on big arenas / portrait screens (default true); the tool pages show the whole slab. */
  follow?: boolean;
  /** Scene background; default the sky gradient (needs a canvas). `null` = none (tests). */
  background?: Texture | null;
  /** TNT digit atlas / comic word atlas (default: drawn on canvases). */
  digitAtlas?: Texture;
  wordAtlas?: Texture;
  /** The look of the arena (default Quarry). */
  level?: LevelId;
}

const shakeOffset = new Vector3();
/** Seconds ahead of a falling wall that its landing cell is marked. */
const WARN_S = 1.5;
/** Seconds between two redraws of the static shadow map while crates keep breaking. */
const SHADOW_REDRAW_S = 0.15;

/**
 * Everything on screen for one match, built from the sim: arena, crew, TNT, blob shadows, FX, glow grid, camera. The
 * game and the bench page both drive it the same way: `onEvents(sim.tick(...))`, then `update(alpha, dt)` each frame, then
 * `render(renderer)`. `root` holds the content; `scene` = `root` + background for pages that render it themselves.
 */
export class WorldView {
  readonly scene = new Scene();
  readonly root = new Group();
  /** Arena, crew, TNT, items, shadows and FX: what rides the platform (it bobs at sea). The crowd and the scenery stay put. */
  readonly platform = new Group();
  readonly theme: LevelTheme;
  private readonly pose: PlatformPose = { y: 0, rx: 0, rz: 0 };
  readonly rig: CameraRig;
  arena!: Arena;
  glow!: GlowGrid;
  readonly crew: Crew;
  readonly crowd: Crowd;
  readonly tnt: TntRenderer;
  readonly items: ItemRenderer;
  readonly fx: Fx;
  readonly shadows = new BlobShadows(MAX_PLAYERS + MAX_TNT);
  private readonly pos = { x: 0, z: 0 };
  private shadowAge = SHADOW_REDRAW_S;
  private readonly fallCells = new Int16Array(16);
  private readonly fallSecs = new Float32Array(16);
  /** false = something else (an orbit camera) owns the camera: skip the rig placement and the shake. */
  controlCamera = true;
  /** Player the camera follows on big arenas / portrait (-1 = none, e.g. the menu background). */
  followId = 0;
  private followCamera: boolean;
  /** The results podium (`finale`), its critters and where the results card leaves room for it. */
  private podium: Podium | null = null;
  private podiumSpots: { spot: PodiumSpot; place: number }[] = [];
  private dock: 'left' | 'up' | null = null;
  /** Jump the follow camera onto the player at the next update (a new round, a camera change) instead of gliding. */
  private snapCamera = true;
  private mapRef;
  private envAsked = false;

  constructor(
    private readonly sim: KaboomSim,
    private readonly quality: Quality,
    opts: WorldViewOptions = {},
  ) {
    this.rig = opts.rig ?? new CameraRig();
    this.followCamera = opts.follow ?? true;
    this.theme = levelTheme(opts.level ?? 'quarry');
    const bg =
      opts.background === undefined
        ? makeSkyTexture(this.theme.sky)
        : opts.background;
    if (bg) this.scene.background = bg;
    this.mapRef = sim.map;
    const { w, h } = sim.map;
    this.crew = new Crew(sim.players, w, h, {
      rings: true,
      low: quality.name === 'low',
    });
    this.crew.onLaunch = (x, z) => this.fx.launch(x, z);
    this.crew.onLand = (x, z) => this.fx.land(x, z);
    this.tnt = new TntRenderer(w, h, opts.digitAtlas, quality);
    this.items = new ItemRenderer(w, h);
    this.fx = new Fx(w, h, opts.wordAtlas, this.theme.fx);
    this.fx.sea = this.theme.fall === 'tile';
    this.fx.hardAt = (x, y) => {
      const m = this.sim.map;
      return (
        x >= 0 &&
        y >= 0 &&
        x < m.w &&
        y < m.h &&
        m.terrain[y * m.w + x] === Terrain.Hard
      );
    };
    this.crowd = new Crowd(w, h, SLAB_PAD, quality, this.theme.crowd);
    this.crowd.setPlayers(sim.players);
    this.buildArena();
    this.platform.add(
      this.crew.group,
      this.tnt.group,
      this.items.group,
      this.shadows.mesh,
      this.fx.group,
    );
    this.root.add(this.crowd.group, this.platform);
    this.scene.add(this.root);
    this.fit();
  }

  private buildArena(): void {
    const { w, h } = this.sim.map;
    this.glow = new GlowGrid(w, h);
    this.arena = new Arena(this.sim.map, this.quality, this.glow, this.theme);
    this.platform.add(this.arena.group);
    this.root.add(this.arena.scenery);
  }

  /** Frame the whole arena for the camera's current aspect (call when the canvas is resized). */
  fit(): void {
    this.snapCamera = true;
    if (this.followCamera) this.rig.fitView(this.sim.map.w, this.sim.map.h);
    // behind the menu (attract): pull back so the stands show too, not just the floor
    else
      this.rig.fitArena(
        this.sim.map.w,
        this.sim.map.h,
        1.02,
        SLAB_PAD + treadMidD(TIERS - 1) + 0.8,
      );
    this.applyDock();
    this.crowd.refreshStunt();
  }

  /** The results card covers the left of a wide screen (or the bottom of a phone): move the view so the podium stays clear of it. */
  private applyDock(): void {
    if (!this.dock) return;
    const cam = this.rig.camera;
    const visH = 2 * this.rig.distance * Math.tan((cam.fov * Math.PI) / 360);
    if (this.dock === 'left') this.rig.target.x -= visH * cam.aspect * 0.18;
    else
      this.rig.target.z +=
        (visH * 0.27) / Math.sin((CAM_PITCH_DEG * Math.PI) / 180);
    this.rig.update();
  }

  /**
   * The match is over: the camera pulls back to the whole stand, a clay podium rises from the floor and the crew in `order`
   * (best first; up to three) climb on it, the winner hopping. With `stunt` the fans in the far stand hold up cards that
   * spell the winner. `dock`: which part of the screen the results card covers.
   */
  finale(
    order: readonly number[],
    opts: {
      dock?: 'left' | 'up';
      stunt?: { text: string | null; color: number; color2?: number };
      still?: boolean;
    } = {},
  ): void {
    const ids = order.slice(0, 3);
    if (ids.length === 0) return;
    this.podium = new Podium(ids.length, (x, z) => this.fx.land(x, z));
    this.platform.add(this.podium.group);
    const half = (this.podium.places.length * (STEP_W + 0.1)) / 2 + 0.3;
    this.arena.clearArea(-half, half, -(STEP_D / 2 + 0.2), STEP_D / 2 + 0.2);
    this.podiumSpots = ids.map((id, rank) => ({
      spot: { id, x: 0, y: -2, z: 0, hop: rank === 0 },
      place: this.podium!.places.findIndex((p) => p.rank === rank),
    }));
    this.syncPodium();
    this.crew.setPodium(this.podiumSpots.map((p) => p.spot));
    this.followCamera = false;
    this.dock = opts.dock ?? null;
    this.fit();
    if (opts.stunt)
      this.crowd.cardStunt(opts.stunt.text, opts.stunt.color, {
        camera: this.rig.camera,
        color2: opts.stunt.color2,
        still: opts.still,
      });
  }

  /** The critters follow their steps as they rise. */
  private syncPodium(): void {
    if (!this.podium) return;
    for (const { spot, place } of this.podiumSpots) {
      spot.x = this.podium.x(place);
      spot.y = this.podium.topY(place);
    }
  }

  /** Who stands on the podium, best first (for tests). */
  get podiumOrder(): number[] {
    return this.podiumSpots.map((p) => p.spot.id);
  }

  /** The sim started a new round (new map): rebuild the arena, clean the crew and FX. */
  newRound(): void {
    this.platform.remove(this.arena.group);
    this.root.remove(this.arena.scenery);
    this.arena.dispose();
    this.glow.dispose();
    this.buildArena();
    this.mapRef = this.sim.map;
    this.crew.reset();
    this.fx.clear();
    this.fit();
  }

  /** Feed one tick's events: crates vanish, the crew reacts, FX spawn. */
  onEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'blockBroken') this.arena.removeCrate(e.x, e.y);
      else if (e.type === 'blockFell') {
        // a wall lands on a crate and flattens it; a sinking tile takes its crate down with it
        if (this.theme.fall === 'wall') this.arena.removeCrate(e.x, e.y);
        this.arena.dropWall(e.x, e.y, this.fx.time.value);
      } else if (e.type === 'playerKo') {
        const p = this.sim.players[e.id];
        if (p) {
          if (this.arena.isSunk(Math.floor(p.x), Math.floor(p.y)))
            this.fx.onKoSplash(p.x, p.y);
          else
            this.fx.onKo(p.x, p.y, TEAM_COLORS[p.color % TEAM_COLORS.length]);
        }
      }
      if (e.type === 'tntExploded')
        this.crowd.excite(0.35 + 0.1 * e.chainDepth);
      else if (e.type === 'playerKo') this.crowd.excite(0.6);
      this.crew.onEvent(e);
      this.fx.onEvent(e);
    }
  }

  /** Pose and upload everything for this frame. `alpha` = progress between the last two sim ticks. */
  update(alpha: number, dt: number): void {
    if (this.sim.map !== this.mapRef) this.newRound();
    this.shadowAge += dt;
    if (this.podium) {
      this.podium.update(dt);
      this.syncPodium();
    }
    this.crew.update(alpha, dt);
    this.tnt.update(this.sim.tnts, dt, this.sim.fuseS);
    this.items.update(this.sim.items, dt);

    const sh = this.shadows;
    sh.begin();
    const players = this.sim.players;
    for (let i = 0; i < players.length; i++) {
      if (players[i].state !== 'alive') continue;
      this.crew.worldPos(i, alpha, this.pos);
      sh.add(this.pos.x, this.pos.z, 0.4);
    }
    const { w, h } = this.sim.map;
    for (const t of this.sim.tnts)
      if (t.active) sh.add(t.x + 0.5 - w / 2, t.y + 0.5 - h / 2, 0.32);
    sh.end();

    this.glow.update(this.sim.flame);
    this.fx.update(dt);
    this.arena.update(this.fx.time.value);
    if (this.theme.motion) {
      const p = this.pose;
      this.theme.motion(this.fx.time.value, this.quality, p);
      this.platform.position.y = p.y;
      this.platform.rotation.set(p.rx, 0, p.rz);
    }
    this.crowd.setPlayers(players);
    this.crowd.update(this.fx.time.value, dt);
    const falls = this.sim.upcomingFalls(WARN_S, this.fallCells, this.fallSecs);
    this.arena.setWarnings(
      this.fallCells,
      falls,
      this.fx.time.value,
      this.fallSecs,
      WARN_S,
    );

    if (this.controlCamera) {
      if (
        this.followCamera &&
        this.followId >= 0 &&
        this.followId < players.length
      ) {
        this.crew.worldPos(this.followId, alpha, this.pos);
        this.rig.followTo(this.pos.x, this.pos.z, dt, this.snapCamera);
        this.snapCamera = false;
      }
      this.rig.update();
      this.rig.camera.position.add(
        this.fx.shake.offset(shakeOffset, this.fx.time.value),
      );
    }
  }

  /**
   * Should the static shadow map be redrawn this frame? It is when casters changed (a crate broke), but at most every
   * `SHADOW_REDRAW_S`: a chain breaks crates nearly every frame and a full shadow redraw each time would cost more
   * than the rest of the frame. Call once per frame before rendering; set `renderer.shadowMap.needsUpdate` when true.
   */
  takeShadowUpdate(): boolean {
    if (!this.arena.isShadowDirty() || this.shadowAge < SHADOW_REDRAW_S)
      return false;
    this.arena.consumeShadowDirty();
    this.shadowAge = 0;
    return true;
  }

  /**
   * High quality: light the scene with the level's HDRI as well (the arena materials are physically based there). Loads
   * once; until it is there, the hemisphere fill alone lights the shade. Call before drawing (no-op after the first call).
   */
  prepareEnvironment(renderer: WebGLRenderer): Promise<void> {
    if (this.quality.name !== 'high' || this.envAsked) return Promise.resolve();
    this.envAsked = true;
    return levelEnvironment(renderer, this.theme.id).then((env) => {
      if (!env) return;
      let top: Object3D = this.root;
      while (top.parent) top = top.parent;
      for (const s of new Set([this.scene, top]))
        if ((s as Scene).isScene) {
          (s as Scene).environment = env;
          (s as Scene).environmentIntensity = this.theme.light.env;
        }
    });
  }

  render(renderer: WebGLRenderer, scene: Scene = this.scene): void {
    void this.prepareEnvironment(renderer);
    this.crowd.prepare(renderer);
    if (this.takeShadowUpdate()) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, this.rig.camera);
  }

  /**
   * Compile every shader and upload every texture / buffer before play, so the first blast does not hitch: all FX pools
   * are in the scene from the start (empty ones still compile), then one frame is drawn.
   */
  async warmUp(
    renderer: WebGLRenderer,
    scene: Scene = this.scene,
  ): Promise<void> {
    await this.prepareEnvironment(renderer);
    this.crowd.prepare(renderer, true);
    this.items.showForCompile();
    await renderer.compileAsync(scene, this.rig.camera);
    this.shadowAge = SHADOW_REDRAW_S; // the first shadow draw belongs here, not to the first frame of play
    this.fx.prime();
    this.render(renderer, scene);
  }

  dispose(): void {
    this.arena.dispose();
    this.glow.dispose();
    this.crew.dispose();
    this.crowd.dispose();
    this.tnt.dispose();
    this.items.dispose();
    this.fx.dispose();
    this.shadows.dispose();
  }
}
