import { Scene } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DebugPanel } from '../../../shared/debug-panel';
import { RELEASE_BUILD } from '../../../shared/release';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { CameraRig } from '../render/camera-rig';
import { makeSkyTexture } from '../render/materials';
import {
  QUALITY,
  bindCameraAspect,
  createRenderer,
  defaultQuality,
} from '../render/renderer';

export const TOOL_LINKS = [
  { label: 'Play', href: './' },
  { label: 'Map viewer', href: 'map-viewer.html' },
  { label: 'Crew viewer', href: 'crew-viewer.html' },
  ...(RELEASE_BUILD ? [] : [{ label: 'Bench', href: 'bench.html' }]),
];

/**
 * Shared scaffolding for the tool pages: left DebugPanel, the game's renderer, a scene, the game camera (`rig`) and an
 * orbit camera (`orbit`) you can switch to, stats (F3). `onFrame` callbacks run before each render.
 */
export class ViewerShell {
  readonly panel: DebugPanel;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly renderer;
  readonly stats: StatsOverlay;
  readonly quality = QUALITY[defaultQuality()];
  readonly orbit: OrbitControls;
  /** true = render through the game camera (`rig`), false = the free orbit camera. */
  useGameCamera = true;
  private callbacks: ((dt: number) => void)[] = [];
  private onFit: (() => void) | null = null;

  constructor(title: string) {
    this.panel = new DebugPanel({ title, links: TOOL_LINKS });
    this.renderer = createRenderer(this.panel.viewport, this.quality);
    this.scene.background = makeSkyTexture();
    bindCameraAspect(this.renderer, this.rig.camera, () => this.onFit?.());
    this.orbit = new OrbitControls(this.rig.camera, this.renderer.domElement);
    this.orbit.enabled = false;
    this.stats = new StatsOverlay(this.renderer, this.panel.viewport, true);

    let last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.useGameCamera) this.orbit.update();
      for (const cb of this.callbacks) cb(dt);
      this.renderer.render(this.scene, this.rig.camera);
      this.stats.end();
    };
    requestAnimationFrame(loop);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
  }

  /** Re-fit the game camera whenever the viewport changes (and once now). */
  fitArenaOnResize(fit: () => void): void {
    this.onFit = fit;
    fit();
  }

  /** Switch between the game camera and the free orbit camera. */
  setGameCamera(on: boolean): void {
    this.useGameCamera = on;
    this.orbit.enabled = !on;
    if (on) this.onFit?.();
    else this.orbit.target.copy(this.rig.target);
  }
}
