import {
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DebugPanel, type PanelSection } from '../../../shared/debug-panel';
import { StatsOverlay } from '../../../shared/stats-overlay';
import { Environment } from '../engine/environment';
import { loadQuality } from '../engine/quality';
import { bindCameraAspect, createRenderer } from '../engine/renderer';
import { getTexture, setTextureAnisotropy } from '../engine/textures';
import { testMap } from '../maps/test/map';
import type { EnvironmentDef } from '../maps/shared/types';

/**
 * Shared scaffolding for the rally tool pages: left DebugPanel, renderer with
 * the SAME lighting setup as the game, orbit camera, optional ground, stats.
 */
export const TOOL_LINKS = [
  { label: 'Play', href: './' },
  { label: 'Map viewer', href: 'map-viewer.html' },
  { label: 'Car viewer', href: 'car-viewer.html' },
  { label: 'Assets', href: 'asset-debug.html' },
];

/**
 * URL params of a shareable camera (all tool pages): `cam=x,y,z` position, `look=x,y,z` orbit target,
 * `fov=<deg>` (0 = keep the page default), `clean=1` hides the panel. Spread into the page DEFAULTS.
 */
export const CAMERA_LINK_DEFAULTS = { cam: '', look: '', fov: 0, clean: false };
export type CameraLinkState = typeof CAMERA_LINK_DEFAULTS;

/** "x,y,z" -> numbers, or undefined when malformed. */
export function parseVec3(text: string): [number, number, number] | undefined {
  const v = text.split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite)
    ? (v as [number, number, number])
    : undefined;
}

const num3 = (n: number) => String(Math.round(n * 1000) / 1000);

export interface ShellOptions {
  title: string;
  ground?: boolean;
  env?: EnvironmentDef;
  far?: number;
}

export class ViewerShell {
  readonly panel: DebugPanel;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer;
  readonly controls: OrbitControls;
  readonly env: Environment;
  readonly stats: StatsOverlay;
  readonly ground?: Mesh;
  readonly grid: GridHelper;
  private callbacks: ((dt: number) => void)[] = [];
  envDef: EnvironmentDef;

  constructor(opts: ShellOptions) {
    this.panel = new DebugPanel({ title: opts.title, links: TOOL_LINKS });
    const quality = loadQuality();
    this.renderer = createRenderer(this.panel.viewport, quality);
    setTextureAnisotropy(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.camera = new PerspectiveCamera(45, 1, 0.05, opts.far ?? 3000);
    bindCameraAspect(this.renderer, this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.envDef = {
      ...(opts.env ?? testMap.environment),
      fogDensity: opts.env?.fogDensity ?? 0.006,
    };
    this.env = new Environment(this.scene, this.renderer, this.envDef, {
      ...quality,
      shadowExtent: 12,
    });
    this.stats = new StatsOverlay(this.renderer, this.panel.viewport, true);

    if (opts.ground !== false) {
      const tex = getTexture('grass').clone();
      tex.repeat.set(160, 160);
      tex.needsUpdate = true;
      this.ground = new Mesh(
        new PlaneGeometry(800, 800),
        new MeshStandardMaterial({ map: tex, roughness: 1 }),
      );
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.receiveShadow = true;
      this.scene.add(this.ground);
    }
    this.grid = new GridHelper(20, 20, 0x666666, 0x3a3a3a);
    this.grid.position.y = 0.005;
    this.grid.visible = false;
    this.scene.add(this.grid);

    let last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.controls.update();
      for (const cb of this.callbacks) cb(dt);
      this.env.update(this.controls.target);
      this.env.follow(this.camera.position);
      this.renderer.render(this.scene, this.camera);
      this.stats.end();
    };
    requestAnimationFrame(loop);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
  }

  /**
   * Apply `cam` / `look` / `fov` from the URL state (call after the page has framed its own default view);
   * `clean=1` hides the panel. Returns true when a free camera was applied.
   */
  applyCameraLink(state: CameraLinkState): boolean {
    if (state.clean) document.body.classList.add('dp-hidden');
    const p = parseVec3(state.cam);
    if (!p) return false;
    this.camera.position.set(...p);
    const look = parseVec3(state.look);
    if (look) this.controls.target.set(...look);
    if (state.fov > 0) {
      this.camera.fov = state.fov;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    return true;
  }

  /** Forget the shared camera (the page is about to frame something else). */
  static clearCameraLink(state: CameraLinkState): void {
    state.cam = '';
    state.look = '';
    state.fov = 0;
  }

  /**
   * "Copy camera link" button: writes the current orbit (position, target, fov - zoom is the distance) into
   * the URL params and copies the URL, so an exact view can be shared.
   */
  addCameraShare(
    section: PanelSection,
    state: CameraLinkState,
    sync: () => void,
  ): void {
    const label = 'Copy camera link';
    const btn = section.button(label, () => {
      const c = this.camera.position;
      const t = this.controls.target;
      state.cam = [c.x, c.y, c.z].map(num3).join(',');
      state.look = [t.x, t.y, t.z].map(num3).join(',');
      state.fov = Math.round(this.camera.fov * 100) / 100;
      sync();
      const done = (ok: boolean) => {
        btn.textContent = ok
          ? 'Copied!'
          : 'Copy failed - link is in the URL bar';
        setTimeout(() => (btn.textContent = label), 1800);
      };
      // The async clipboard API is refused in some embedded panes / insecure origins: fall back to a
      // temporary textarea + execCommand.
      const legacyCopy = (): boolean => {
        const ta = document.createElement('textarea');
        ta.value = location.href;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        let ok: boolean;
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
        ta.remove();
        return ok;
      };
      if (navigator.clipboard)
        navigator.clipboard.writeText(location.href).then(
          () => done(true),
          () => done(legacyCopy()),
        );
      else done(legacyCopy());
    });
  }

  /** Standard "Scene" section: sun, fog, ground, grid toggles. */
  addSceneSection(open = false): PanelSection {
    const s = this.panel.section('Scene', open);
    const apply = () => this.env.apply(this.envDef);
    s.slider(
      'Sun elevation',
      this.envDef.sunElevation,
      { min: 2, max: 89, step: 1 },
      (v) => {
        this.envDef.sunElevation = v;
        apply();
      },
    );
    s.slider(
      'Sun azimuth',
      this.envDef.sunAzimuth,
      { min: 0, max: 360, step: 1 },
      (v) => {
        this.envDef.sunAzimuth = v;
        apply();
      },
    );
    s.slider(
      'Exposure',
      this.envDef.exposure,
      { min: 0.2, max: 2, step: 0.05 },
      (v) => {
        this.envDef.exposure = v;
        apply();
      },
    );
    if (this.ground)
      s.checkbox('Ground', true, (v) => (this.ground!.visible = v));
    s.checkbox('Grid', false, (v) => (this.grid.visible = v));
    s.checkbox('Shadows', true, (v) => (this.env.sun.castShadow = v));
    return s;
  }
}
