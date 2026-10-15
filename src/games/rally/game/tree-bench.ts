import { Vector3, type WebGLRenderer } from 'three';
import type { TreeLoadStats } from '../trees/stats';
import type { World } from '../world/world';

/**
 * Tree benchmark helpers (spec: trees/Performance.md#benchmark): the fixed camera path, the frame time summary and
 * the results file. `RallyGame.treeBenchmark` drives the runs (`?treebench=1` on the play page, or
 * `await __rally.treeBenchmark()` in the console).
 */

const pixel = new Uint8Array(4);

/**
 * Block until the GPU has finished every command so far: a 1-pixel readback of the drawing buffer. WebGL's
 * `gl.finish()` does not wait in Chrome (it only flushes), so frames timed with it queue up in the GPU process and
 * every few seconds one frame absorbs ~10 frames of GPU work (300-400 ms "spikes" that were never tree work).
 * Benchmark only: the tree code never reads back from the GPU during a run (trees/Performance.md#frame-stability).
 */
export function waitForGpu(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): void {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

export interface BenchRun {
  trees: boolean;
  frames: number;
  /** Frame time incl. GPU (each frame ends with waitForGpu(), so vsync does not cap it), ms. */
  avgMs: number;
  /** 1 % low: the 99th percentile frame time. */
  low1Ms: number;
  worstMs: number;
  /** Tree main + shadow pass GPU ms per frame (timer queries; NaN = no timer). */
  treeGpuMs: number;
  /** Main-thread ms of level selection + fade updates per frame (average). */
  selectMs: number;
  /** Trees re-selected per frame: average and peak (trees/Lod.md#active-set). */
  active?: number;
  activePeak?: number;
  /** Tree main pass and shadow pass GPU ms per frame, each on its own. */
  treeMainGpuMs?: number;
  treeShadowGpuMs?: number;
  /** Every frame slower than 3x the run's average (trees/Performance.md#benchmark). */
  spikes?: SpikeFrame[];
}

/** A spike frame and what the tree code did in it (trees/Performance.md#frame-stability). */
export interface SpikeFrame {
  frame: number;
  ms: number;
  /** CPU time until the frame was submitted, and the wait for the GPU to finish it. */
  cpuMs: number;
  gpuWaitMs: number;
  /** CPU ms per step of the frame: terrain, scatter, trees, env, render. */
  steps?: Record<string, number>;
  /** Tree CPU: selection + fades, batching job. */
  treeCpuMs: number;
  /** Shader programs compiled, instance buffer allocations, bytes uploaded, static re-packs, a job commit. */
  programs: number;
  allocs: number;
  uploadBytes: number;
  repacks: number;
  commit: boolean;
}

/** The budget of trees/Performance.md#budget: what "negligible" means. */
export const TREE_BUDGET = {
  /** Added to the average and to the 1 % low frame time (ms). */
  frameMs: 1.0,
  low1Ms: 1.0,
  /** Level selection + fade updates per frame (ms). */
  selectMs: 0.1,
  /** Added to the stage load (ms). */
  loadMs: 500,
};

export interface BudgetResult {
  pass: boolean;
  /** Which limits failed, with the measured value. */
  failures: string[];
  budget: typeof TREE_BUDGET;
}

/** Check a with / without trees pair against the budget (a run over it is a failing result). */
export function checkBudget(
  runs: BenchRun[],
  treeLoadMs: number,
): BudgetResult {
  const failures: string[] = [];
  const on = runs.find((r) => r.trees);
  const off = runs.find((r) => !r.trees);
  if (on && off) {
    const avg = on.avgMs - off.avgMs;
    const low = on.low1Ms - off.low1Ms;
    if (avg > TREE_BUDGET.frameMs)
      failures.push(
        `frame time +${avg.toFixed(2)} ms > ${TREE_BUDGET.frameMs} ms`,
      );
    if (low > TREE_BUDGET.low1Ms)
      failures.push(`1% low +${low.toFixed(2)} ms > ${TREE_BUDGET.low1Ms} ms`);
  } else failures.push('no run without trees to compare with');
  if (on && on.selectMs > TREE_BUDGET.selectMs)
    failures.push(
      `selection ${on.selectMs.toFixed(3)} ms > ${TREE_BUDGET.selectMs} ms`,
    );
  if (treeLoadMs > TREE_BUDGET.loadMs)
    failures.push(
      `tree load ${Math.round(treeLoadMs)} ms > ${TREE_BUDGET.loadMs} ms`,
    );
  // No frame over 3x the average because of trees: spikes that did tree work (or happen only with trees).
  const offSpikes = off?.spikes?.length ?? 0;
  if (on?.spikes && on.spikes.length > offSpikes)
    failures.push(
      `${on.spikes.length} frames over 3x the average (${offSpikes} without trees)`,
    );
  return { pass: failures.length === 0, failures, budget: TREE_BUDGET };
}

export interface TreeBenchReport {
  stage: string;
  quality: string;
  resolution: string;
  pixelRatio: number;
  gpu: string;
  date: string;
  /** Path: metres along the stage road it starts at, its length and camera step per frame. */
  path: { start: number; metres: number; step: number };
  /** Stage load (RallyGame.init) and the trees' share of it. */
  loadMs: number;
  treeLoad: TreeLoadStats;
  runs: BenchRun[];
  /** Average frame time with trees minus without: the trees' own cost (ms), when both ran. */
  treeCostMs: number | null;
  /** Against trees/Performance.md#budget: `pass` false = a failing result. */
  result: BudgetResult;
  /** Machine: the browser's platform / CPU threads (+ `machine` option), and the mitigations that were on. */
  machine: string;
  mitigations: Record<string, boolean>;
  /** Against an earlier result file: every figure's change (this run minus that one). */
  comparison?: Record<string, number>;
}

/** Every number of a report, flattened (`runs.0.avgMs` ...): what a comparison diffs. */
function figures(r: TreeBenchReport): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'number') out[p] = o;
    else if (o && typeof o === 'object' && !Array.isArray(o))
      for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(
    { loadMs: r.loadMs, treeCostMs: r.treeCostMs, treeLoad: r.treeLoad },
    '',
  );
  r.runs.forEach((run) => {
    const { spikes: _s, ...nums } = run;
    walk(nums, run.trees ? 'trees' : 'noTrees');
    if (run.spikes)
      out[`${run.trees ? 'trees' : 'noTrees'}.spikeFrames`] = run.spikes.length;
  });
  return out;
}

/** The change in every figure from an earlier report to this one (trees/Performance.md#benchmark). */
export function compareReports(
  before: TreeBenchReport,
  after: TreeBenchReport,
): Record<string, number> {
  const a = figures(before);
  const b = figures(after);
  const out: Record<string, number> = {};
  for (const k of Object.keys(b))
    if (k in a && Number.isFinite(a[k]) && Number.isFinite(b[k]))
      out[k] = Math.round((b[k] - a[k]) * 1000) / 1000;
  return out;
}

/** Camera height above the road and how far ahead it looks (a high chase view). */
const EYE = 3.2;
const AHEAD = 25;

/** The fixed path: camera position / look target for every frame, from the stage start along the road. */
export function benchPath(
  world: World,
  frames: number,
  step: number,
): { start: number; poses: { pos: Vector3; look: Vector3 }[] } {
  const start = world.stage.start;
  const poses = [];
  for (let i = 0; i < frames; i++) {
    const a = Math.min(start + i * step, world.road.length - AHEAD - 1);
    const p = world.road.at(a);
    const q = world.road.at(a + AHEAD);
    poses.push({
      pos: new Vector3(p.x, p.y + EYE, p.z),
      look: new Vector3(q.x, q.y + 1.5, q.z),
    });
  }
  return { start, poses };
}

export function summarize(
  trees: boolean,
  times: number[],
  gpu: number[],
  select: number[] = [],
): BenchRun {
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / Math.max(1, times.length);
  return {
    trees,
    frames: times.length,
    avgMs: round(avg),
    low1Ms: round(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ??
        0,
    ),
    worstMs: round(sorted[sorted.length - 1] ?? 0),
    treeGpuMs: gpu.length
      ? round(gpu.reduce((s, t) => s + t, 0) / gpu.length)
      : NaN,
    selectMs: select.length
      ? Math.round((select.reduce((s, t) => s + t, 0) / select.length) * 1000) /
        1000
      : 0,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** The renderer's GPU name (unmasked where the browser allows it). */
export function gpuName(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(
    gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  );
}

/** Save the report as a JSON file (browser download), named so runs can be compared side by side. */
export function writeReport(r: TreeBenchReport): string {
  const name = `tree-bench-${r.stage}-${r.quality}-${r.resolution}-${r.date.replace(/[:.]/g, '-')}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}
