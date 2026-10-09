import { FUR_SHELLS } from './fur';
import { Group, Scene, Vector3, type Texture, type WebGLRenderer } from 'three';
import { MAX_PLAYERS, MAX_TNT } from '../sim/rules';
import type { KabooomSim, SimEvent } from '../sim/types';
import { Arena } from './arena';
import { CameraRig } from './camera-rig';
import { Crew } from './characters';
import { Fx } from './fx/fx';
import { ItemRenderer } from './items';
import { GlowGrid } from './fx/glow-grid';
import { makeSkyTexture } from './materials';
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
}

const shakeOffset = new Vector3();
/** Seconds ahead of a falling wall that its landing cell is marked. */
const WARN_S = 1.2;
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
  readonly rig: CameraRig;
  arena!: Arena;
  glow!: GlowGrid;
  readonly crew: Crew;
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
  private readonly followCamera: boolean;
  private mapRef;

  constructor(
    private readonly sim: KabooomSim,
    private readonly quality: Quality,
    opts: WorldViewOptions = {},
  ) {
    this.rig = opts.rig ?? new CameraRig();
    this.followCamera = opts.follow ?? true;
    const bg =
      opts.background === undefined ? makeSkyTexture() : opts.background;
    if (bg) this.scene.background = bg;
    this.mapRef = sim.map;
    const { w, h } = sim.map;
    this.crew = new Crew(sim.players, w, h, {
      shells: FUR_SHELLS[quality.name],
      smooth: quality.antialias,
    });
    this.crew.onLaunch = (x, z) => this.fx.launch(x, z);
    this.crew.onLand = (x, z) => this.fx.land(x, z);
    this.tnt = new TntRenderer(w, h, opts.digitAtlas);
    this.items = new ItemRenderer(w, h);
    this.fx = new Fx(w, h, opts.wordAtlas);
    this.buildArena();
    this.root.add(
      this.crew.group,
      this.tnt.group,
      this.items.group,
      this.shadows.mesh,
      this.fx.group,
    );
    this.scene.add(this.root);
    this.fit();
  }

  private buildArena(): void {
    const { w, h } = this.sim.map;
    this.glow = new GlowGrid(w, h);
    this.arena = new Arena(this.sim.map, this.quality, this.glow);
    this.root.add(this.arena.group);
  }

  /** Frame the whole arena for the camera's current aspect (call when the canvas is resized). */
  fit(): void {
    if (this.followCamera) this.rig.fitView(this.sim.map.w, this.sim.map.h);
    else this.rig.fitArena(this.sim.map.w, this.sim.map.h);
  }

  /** The sim started a new round (new map): rebuild the arena, clean the crew and FX. */
  newRound(): void {
    this.root.remove(this.arena.group);
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
        this.arena.removeCrate(e.x, e.y);
        this.arena.dropWall(e.x, e.y, this.fx.time.value);
      } else if (e.type === 'playerKo') {
        const p = this.sim.players[e.id];
        if (p) this.fx.onKo(p.x, p.y);
      }
      this.crew.onEvent(e);
      this.fx.onEvent(e);
    }
  }

  /** Pose and upload everything for this frame. `alpha` = progress between the last two sim ticks. */
  update(alpha: number, dt: number): void {
    if (this.sim.map !== this.mapRef) this.newRound();
    this.shadowAge += dt;
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
    const falls = this.sim.upcomingFalls(WARN_S, this.fallCells, this.fallSecs);
    this.arena.setWarnings(this.fallCells, falls, this.fx.time.value);

    if (this.controlCamera) {
      if (
        this.followCamera &&
        this.followId >= 0 &&
        this.followId < players.length
      ) {
        this.crew.worldPos(this.followId, alpha, this.pos);
        this.rig.followTo(this.pos.x, this.pos.z, dt);
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

  render(renderer: WebGLRenderer, scene: Scene = this.scene): void {
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
    await renderer.compileAsync(scene, this.rig.camera);
    this.shadowAge = SHADOW_REDRAW_S; // the first shadow draw belongs here, not to the first frame of play
    this.fx.prime();
    this.render(renderer, scene);
  }

  dispose(): void {
    this.arena.dispose();
    this.glow.dispose();
    this.crew.dispose();
    this.tnt.dispose();
    this.items.dispose();
    this.fx.dispose();
    this.shadows.dispose();
  }
}
