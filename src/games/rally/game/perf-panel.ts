import '../../../shared/debug-panel.css';
import './perf-panel.css';
import type { Fog, Texture } from 'three';
import { PanelSection } from '../../../shared/debug-panel';
import { worldUniforms } from '../engine/world-shading';
import { OBJECT_DISTANCE } from './settings';
import type { TreePart } from '../trees/draw';
import { treeUniforms } from '../trees/materials';
import { FAR_SPRITES, FOREST_REACH, ROAD_REACH } from '../trees/species';
import type { RallyGame } from './rally-game';

/**
 * Perf panel (the backquote key ` in game, or `?perf=1`): FPS, frame time, the CPU ms of each frame step, the GPU ms of the frame
 * (timer queries, or a 1-pixel readback with "Wait for GPU"), draw calls / triangles, and switches for every costly
 * feature, so the cost of each shows on the device itself. Switches and sliders are remembered in localStorage and
 * applied whenever the panel is open (a player who never opens it never gets a feature switched off).
 */

interface Switch {
  id: string;
  label: string;
  section: string;
  set(game: RallyGame, on: boolean): void;
}

interface Slider {
  id: string;
  label: string;
  section: string;
  min: number;
  max: number;
  step: number;
  /** Default (the game's own setting). */
  value(game: RallyGame): number;
  set(game: RallyGame, v: number): void;
}

const KEY = 'rally.perf';

/** Scene state the switches put back (captured when the panel opens). */
interface Saved {
  fog: Fog | null;
  environment: Texture | null;
  cloud: number;
  wind: number;
  canopy: number;
  pixelRatio: number;
}
let saved: Saved;

const tree = (part: TreePart) => (g: RallyGame, on: boolean) =>
  g.trees.setPartVisible(part, on);

const SWITCHES: Switch[] = [
  {
    id: 'terrain',
    label: 'Terrain',
    section: 'World',
    set: (g, on) => (g.terrain.group.visible = on),
  },
  {
    id: 'road',
    label: 'Road',
    section: 'World',
    set: (g, on) => g.roadGroup && (g.roadGroup.visible = on),
  },
  {
    id: 'horizon',
    label: 'Horizon',
    section: 'World',
    set: (g, on) => g.horizonGroup && (g.horizonGroup.visible = on),
  },
  {
    id: 'objects',
    label: 'Objects (rocks, bushes, props)',
    section: 'World',
    set: (g, on) => (g.streamer.group.visible = on),
  },
  {
    id: 'grass',
    label: 'Grass',
    section: 'World',
    set: (g, on) =>
      g.streamer.setOptions({
        detailDensity: on ? g.opts.quality.detailDensity : 0,
      }),
  },
  {
    id: 'trees',
    label: 'Trees (all)',
    section: 'Trees',
    set: (g, on) => (g.trees.group.visible = on),
  },
  { id: 'lod0', label: 'Branches LOD0', section: 'Trees', set: tree('lod0') },
  { id: 'lod1', label: 'Branches LOD1', section: 'Trees', set: tree('lod1') },
  {
    id: 'near',
    label: `Near sprites (< ${FOREST_REACH.near} m, roadside ${ROAD_REACH.near})`,
    section: 'Trees',
    set: tree('near'),
  },
  {
    id: 'prepass',
    label: 'Near sprite depth prepass',
    section: 'Trees',
    set: tree('prepass'),
  },
  {
    id: 'far',
    label: 'Far sprites (quads)',
    section: 'Trees',
    set: tree('far'),
  },
  {
    id: 'impostors',
    label: 'Impostors (near, baked depth)',
    section: 'Trees',
    set: tree('impostors'),
  },
  {
    id: 'farImpostors',
    label: 'Impostors (far)',
    section: 'Trees',
    set: tree('farImpostors'),
  },
  {
    id: 'proxy',
    label: 'Tree shadows (crown proxies)',
    section: 'Trees',
    set: tree('proxy'),
  },
  {
    id: 'wind',
    label: 'Wind',
    section: 'Trees',
    set: (_g, on) => (worldUniforms.wsWind.value.z = on ? saved.wind : 0),
  },
  {
    id: 'shadows',
    label: 'Sun shadows',
    section: 'Lighting',
    set: (g, on) => (g.env.sun.castShadow = on),
  },
  {
    id: 'canopy',
    label: 'Far canopy shadows',
    section: 'Lighting',
    set: (_g, on) =>
      (worldUniforms.wsShadowBox.value.w = on ? saved.canopy : 0),
  },
  {
    id: 'clouds',
    label: 'Cloud shadows',
    section: 'Lighting',
    set: (_g, on) => (worldUniforms.wsCloud.value.x = on ? saved.cloud : 0),
  },
  {
    id: 'fog',
    label: 'Fog',
    section: 'Lighting',
    set: (g, on) => (g.scene.fog = on ? saved.fog : null),
  },
  {
    id: 'ibl',
    label: 'Sky reflections (IBL)',
    section: 'Lighting',
    set: (g, on) => (g.scene.environment = on ? saved.environment : null),
  },
  {
    id: 'car',
    label: 'Car',
    section: 'Effects',
    set: (g, on) => {
      g.model.root.visible = on;
      g.contactShadow.mesh.visible = on;
    },
  },
  {
    id: 'particles',
    label: 'Dust, gravel, haze',
    section: 'Effects',
    set: (g, on) => {
      for (const p of [g.dust, g.gravel, g.haze]) if (p) p.points.visible = on;
    },
  },
  {
    id: 'tyreMarks',
    label: 'Tyre marks',
    section: 'Effects',
    set: (g, on) => (g.tyreMarks.mesh.visible = on),
  },
];

const far = () => treeUniforms.tlFar.value;

const SLIDERS: Slider[] = [
  {
    id: 'farStart',
    label: `Far sprites past ${FOREST_REACH.full + FOREST_REACH.ramp} m (roadside ${ROAD_REACH.full + ROAD_REACH.ramp})`,
    section: 'Trees',
    min: 0.05,
    max: 0.55,
    step: 0.01,
    value: () => FAR_SPRITES[0],
    set: (g, v) => g.trees.setFarSprites(v, Math.min(v, far().y)),
  },
  {
    id: 'farEnd',
    label: 'Far sprites at impostor',
    section: 'Trees',
    min: 0.03,
    max: 0.4,
    step: 0.01,
    value: () => FAR_SPRITES[1],
    set: (g, v) => g.trees.setFarSprites(Math.max(v, far().x), v),
  },
  {
    id: 'resolution',
    label: 'Resolution',
    section: 'Render',
    min: 0.4,
    max: 1,
    step: 0.05,
    value: () => 1,
    set: (g, v) => g.renderer.setPixelRatio(saved.pixelRatio * v),
  },
  {
    id: 'objectDistance',
    label: 'Object distance',
    section: 'Render',
    min: 0.25,
    max: 2,
    step: 0.05,
    value: () => 1,
    set: (g, v) =>
      g.streamer.setOptions({
        lodScale:
          g.opts.quality.lodScale *
          OBJECT_DISTANCE[g.opts.settings.objectDistance] *
          v,
      }),
  },
  {
    id: 'treeDistance',
    label: 'Tree distance',
    section: 'Render',
    min: 0.25,
    max: 3,
    step: 0.05,
    value: () => 1,
    set: (g, v) =>
      g.trees.setOptions({
        lodScale:
          g.opts.quality.treeLodScale *
          OBJECT_DISTANCE[g.opts.settings.objectDistance] *
          v,
      }),
  },
  {
    id: 'forestDistance',
    label: 'Forest distance (m)',
    section: 'Render',
    min: 200,
    max: 2400,
    step: 50,
    value: (g) => g.opts.quality.forestDistance,
    set: (g, v) => {
      g.trees.setOptions({ forestDistance: v });
      g.farForest.setForestDistance(v);
      worldUniforms.wsForest.value.w = v;
    },
  },
  {
    id: 'shadowMap',
    label: 'Shadow map (log2)',
    section: 'Render',
    min: 9,
    max: 12,
    step: 1,
    value: (g) => Math.log2(g.opts.quality.shadowMapSize),
    set: (g, v) => {
      const size = 2 ** v;
      const s = g.env.sun.shadow;
      if (s.mapSize.x === size) return;
      s.mapSize.set(size, size);
      s.map?.dispose();
      s.map = null;
    },
  },
];

interface State {
  off: string[];
  sliders: Record<string, number>;
  syncGpu: boolean;
}

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as State;
    return { off: s.off ?? [], sliders: s.sliders ?? {}, syncGpu: !!s.syncGpu };
  } catch {
    return { off: [], sliders: {}, syncGpu: false };
  }
}

function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / blocked storage: the panel still works, nothing is remembered.
  }
}

/** GPU ms of the frame's render (EXT_disjoint_timer_query_webgl2), read back a few frames later, never waited on. */
class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private free: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  samples: number[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get available(): boolean {
    return !!this.ext;
  }

  begin(): void {
    if (!this.ext || this.current || this.pending.length > 4) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = q;
  }

  end(): void {
    const gl = this.gl;
    if (this.current && this.ext) {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.current);
      this.current = null;
    }
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = this.ext && gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.free.push(q);
      if (!disjoint) this.samples.push(ns / 1e6);
    }
  }
}

export class PerfPanel {
  readonly el: HTMLElement;
  private state = load();
  private gpu: GpuTimer;
  private pixel = new Uint8Array(4);
  private last = 0;
  private times: number[] = [];
  private steps: Record<string, number[]> = {};
  private gpuWait: number[] = [];
  private shown = false;
  private nextReadout = 0;
  private readout: (v: Record<string, string | number>) => void;
  private stepsOut: (v: Record<string, string | number>) => void;

  constructor(
    private game: RallyGame,
    parent: HTMLElement,
  ) {
    saved = {
      fog: game.scene.fog as Fog | null,
      environment: game.scene.environment,
      cloud: worldUniforms.wsCloud.value.x,
      wind: worldUniforms.wsWind.value.z,
      canopy: worldUniforms.wsShadowBox.value.w,
      pixelRatio: game.renderer.getPixelRatio(),
    };
    this.gpu = new GpuTimer(
      game.renderer.getContext() as WebGL2RenderingContext,
    );
    this.el = document.createElement('aside');
    this.el.className = 'pp-panel';
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    const head = document.createElement('div');
    head.className = 'pp-head';
    head.textContent = 'Performance (` key)';
    this.el.append(head);

    const stats = this.section('Frame');
    this.readout = stats.info();
    stats.checkbox(
      'Wait for GPU each frame (GPU ms without timer queries)',
      this.state.syncGpu,
      (v) => {
        this.state.syncGpu = v;
        save(this.state);
      },
    );
    this.stepsOut = this.section('CPU ms per step').info();

    const sections = new Map<string, PanelSection>();
    const sectionOf = (t: string) => {
      let s = sections.get(t);
      if (!s) sections.set(t, (s = this.section(t)));
      return s;
    };
    for (const sw of SWITCHES) {
      const on = !this.state.off.includes(sw.id);
      sw.set(game, on);
      sectionOf(sw.section).checkbox(sw.label, on, (v) => {
        sw.set(game, v);
        this.state.off = this.state.off.filter((id) => id !== sw.id);
        if (!v) this.state.off.push(sw.id);
        save(this.state);
      });
    }
    for (const sl of SLIDERS) {
      const v = this.state.sliders[sl.id] ?? sl.value(game);
      if (v !== sl.value(game)) sl.set(game, v);
      sectionOf(sl.section).slider(sl.label, v, sl, (x) => {
        sl.set(game, x);
        this.state.sliders[sl.id] = x;
        save(this.state);
      });
    }
    const reset = this.section('Reset');
    reset.button('Everything back on', () => {
      for (const sw of SWITCHES) sw.set(game, true);
      for (const sl of SLIDERS) sl.set(game, sl.value(game));
      this.state = { off: [], sliders: {}, syncGpu: this.state.syncGpu };
      save(this.state);
      this.el.remove();
      this.game.perf = undefined;
      this.game.togglePerfPanel();
    });
    parent.append(this.el);
    this.el.style.display = 'none';
  }

  private section(title: string): PanelSection {
    const s = new PanelSection(title, true);
    this.el.append(s.el);
    return s;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.el.style.display = this.shown ? '' : 'none';
  }

  gpuBegin(): void {
    // The tree timer (F6 view / benchmark) uses the same queries: one at a time.
    if (this.shown && !this.game.trees.debug && !this.game.trees.measure)
      this.gpu.begin();
  }

  gpuEnd(): void {
    this.gpu.end();
    if (!this.shown || !this.state.syncGpu) return;
    const gl = this.game.renderer.getContext();
    const t = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
    this.gpuWait.push(performance.now() - t);
  }

  /** Every frame: the CPU ms of its steps. */
  frame(steps: Record<string, number>): void {
    const now = performance.now();
    if (this.last) this.times.push(now - this.last);
    this.last = now;
    if (!this.shown) return;
    for (const [k, v] of Object.entries(steps)) (this.steps[k] ??= []).push(v);
    if (now < this.nextReadout) return;
    this.nextReadout = now + 500;
    const t = this.times.splice(0);
    const avg = (a: number[]) =>
      a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
    const ms = avg(t);
    const info = this.game.renderer.info.render;
    const cpu = Object.values(this.steps).reduce((s, a) => s + avg(a), 0);
    const r = this.game.renderer.domElement;
    this.readout({
      FPS: Number.isFinite(ms) ? (1000 / ms).toFixed(0) : '-',
      'frame ms': `${ms.toFixed(1)}  (worst ${Math.max(0, ...t).toFixed(1)})`,
      'CPU ms': cpu.toFixed(1),
      'GPU ms': this.gpu.samples.length
        ? avg(this.gpu.samples.splice(0)).toFixed(1)
        : this.gpu.available
          ? '-'
          : 'n/a (no timer queries)',
      ...(this.state.syncGpu
        ? { 'GPU wait ms': avg(this.gpuWait.splice(0)).toFixed(1) }
        : {}),
      'draw calls': info.calls,
      triangles: `${(info.triangles / 1e6).toFixed(2)} M`,
      trees: this.game.trees.drawn,
      resolution: `${r.width} x ${r.height}`,
    });
    this.stepsOut(
      Object.fromEntries(
        Object.entries(this.steps).map(([k, a]) => [
          k,
          avg(a.splice(0)).toFixed(2),
        ]),
      ),
    );
  }
}
