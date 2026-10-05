import {
  GridHelper,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DebugPanel } from '../../../shared/debug-panel';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { applyHoleCut } from '../render/materials';
import {
  Environment,
  QUALITY,
  bindCameraAspect,
  createRenderer,
  defaultQuality,
} from '../render/renderer';

export const TOOL_LINKS = [
  { label: 'Play', href: './' },
  { label: 'Item viewer', href: 'item-viewer.html' },
  { label: 'Map viewer', href: 'map-viewer.html' },
  { label: 'Balance', href: 'balance.html' },
];

/**
 * Shared scaffolding for the hole tool pages: left DebugPanel, renderer and
 * lights identical to the game, orbit camera, a grass ground that the hole cuts
 * (so falling items really drop in), stats (F3).
 */
export class ViewerShell {
  readonly panel: DebugPanel;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer;
  readonly controls: OrbitControls;
  readonly env: Environment;
  readonly stats: StatsOverlay;
  readonly ground: Mesh;
  readonly grid: GridHelper;
  private callbacks: ((dt: number) => void)[] = [];
  private beforeRender: (() => boolean) | null = null;

  constructor(title: string, opts: { ground?: boolean } = {}) {
    this.panel = new DebugPanel({ title, links: TOOL_LINKS });
    const quality = QUALITY[defaultQuality()];
    this.renderer = createRenderer(this.panel.viewport, {
      ...quality,
      shadows: true,
    });
    this.camera = new PerspectiveCamera(45, 1, 0.1, 3000);
    bindCameraAspect(this.renderer, this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.env = new Environment(this.scene, { ...quality, shadows: true });
    this.stats = new StatsOverlay(this.renderer, this.panel.viewport, true);

    this.ground = new Mesh(
      new PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
      applyHoleCut(new MeshLambertMaterial({ color: 0x7cc66a })),
    );
    this.ground.receiveShadow = true;
    this.ground.visible = opts.ground !== false;
    this.scene.add(this.ground);
    this.grid = new GridHelper(40, 40, 0x335533, 0x4b6f45);
    this.grid.position.y = 0.02;
    this.grid.visible = false;
    this.scene.add(this.grid);

    let last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.controls.update();
      for (const cb of this.callbacks) cb(dt);
      const focus = this.controls.target;
      const dist = this.camera.position.distanceTo(focus);
      this.env.follow(new Vector3(focus.x, 0, focus.z), dist * 0.8);
      this.env.setFog(dist * 4, dist * 20 + 200, this.scene);
      this.camera.near = Math.max(0.05, dist * 0.02);
      this.camera.far = dist * 40 + 800;
      this.camera.updateProjectionMatrix();
      this.env.updateDome(this.camera);
      if (!this.beforeRender || this.beforeRender())
        this.renderer.render(this.scene, this.camera);
      this.stats.end();
    };
    requestAnimationFrame(loop);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
  }

  /** Hook run right before rendering; return false to skip the default render. */
  setRenderOverride(fn: (() => boolean) | null): void {
    this.beforeRender = fn;
  }

  /** Frame an object of `size` metres at `centre` from a 3/4 view. */
  frame(centre: Vector3, size: number): void {
    const d = Math.max(2.5, size * 2.2);
    this.controls.target.copy(centre);
    this.camera.position.set(
      centre.x + d * 0.5,
      centre.y + d * 0.55,
      centre.z + d,
    );
    this.controls.update();
  }
}
