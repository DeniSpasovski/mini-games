import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { Rng } from '../../../shared/rng';
import { ViewerShell } from '../debug/viewer-shell';
import { generateMap } from '../map/generate';
import { WorldView } from '../render/world-view';
import { MAX_TNT, STEP } from '../sim/rules';
import { BotController } from '../sim/bot';
import { Sim } from '../sim/sim';
import { Terrain, type PlayerInput } from '../sim/types';
import type { InstancedMesh } from 'three';

/**
 * Bench: scripted stress scenes with ms / frame and draw calls. Live on the page, or `__kabooomBench.run(scene, frames)`.
 *   bench.html?scene=chain40&seed=1&orbit=0
 *   chain40  - Large map, 8 players, 40 TNT lit by one fuse: a chain across the whole map
 *   grid-all - Large map, a full pool of TNT (every one lit at once): the worst simultaneous blast
 *   8bots    - Large map, eight hard bots playing real rounds (2 minutes when run as a benchmark)
 * Budgets (DETAILS.md "Performance"): draw calls <= 60, frame <= 4 ms desktop, sim tick worst case < 0.5 ms.
 */
const SCENES = ['chain40', 'grid-all', '8bots'] as const;
type SceneId = (typeof SCENES)[number];
const DEFAULTS = {
  scene: 'chain40' as string,
  seed: 1,
  orbit: false,
  auto: true,
};
const state = readUrlState(DEFAULTS);
if (!(SCENES as readonly string[]).includes(state.scene))
  state.scene = DEFAULTS.scene;

const shell = new ViewerShell('Kabooom · Bench');
const IDLE: PlayerInput[] = Array.from({ length: 8 }, () => ({
  dx: 0,
  dy: 0,
  place: false,
}));

let sim: Sim;
/** Drives the players in the `8bots` scene (the other scenes leave them idle). */
let botCtl: BotController | null = null;
const botInputs: PlayerInput[] = [];
let view: WorldView;
let acc = 0;
let doneAt = -1;
let clock = 0;
let running = false;

const stats = shell.panel.section('Result');
const setStats = stats.info();

function setup(scene: SceneId): void {
  if (view) {
    shell.scene.remove(view.root);
    view.dispose();
  }
  const map = generateMap({ size: 'l', seed: state.seed });
  // chain40: TNT on 40 (odd, odd) cells two apart - the cells between them are free ground (no pillar), so every blast
  // reaches its neighbours; the crates in that block are cleared so nothing stops an arm. One short fuse in the middle.
  const lattice: number[] = [];
  if (scene === 'chain40') {
    for (let y = 1; y < map.h - 1 && lattice.length < 40; y += 2)
      for (let x = 1; x < map.w - 1 && lattice.length < 40; x += 2)
        lattice.push(y * map.w + x);
    const maxY = Math.floor(lattice[lattice.length - 1] / map.w);
    for (let y = 1; y <= maxY; y++)
      for (let x = 1; x < map.w - 1; x++)
        if (!(x % 2 === 0 && y % 2 === 0))
          map.terrain[y * map.w + x] = Terrain.Empty;
  }
  sim = new Sim(
    {
      seed: state.seed,
      size: 'l',
      bots: 7,
      difficulty: 'normal',
      rounds: 5,
      critter: 'mole',
    },
    () => map,
    { countdown: 0 },
  );
  view = new WorldView(sim, shell.quality, {
    rig: shell.rig,
    background: null,
    follow: false,
  });
  view.controlCamera = !state.orbit;
  shell.scene.add(view.root);
  shell.fitArenaOnResize(() => view.fit());
  acc = 0;
  doneAt = -1;

  const { w } = map;
  const free: number[] = [];
  for (let i = 0; i < map.terrain.length; i++) {
    const x = i % w;
    const y = (i - x) / w;
    const near = map.spawns.some(
      (s) => Math.abs(s.x - x) + Math.abs(s.y - y) <= 3,
    );
    if (map.terrain[i] === Terrain.Empty && !near) free.push(i);
  }
  botCtl =
    scene === '8bots'
      ? new BotController(
          sim,
          'hard',
          state.seed,
          sim.players.map((p) => p.id),
        )
      : null;
  if (scene === '8bots') {
    // nothing planted: the bots make the show
  } else if (scene === 'chain40') {
    const start = lattice.indexOf(3 * w + 11); // middle of the lattice: the chain runs both ways
    lattice.forEach((c, n) =>
      sim.plantTnt(
        c % w,
        (c - (c % w)) / w,
        n % 8,
        2,
        c === lattice[start] ? 0.3 : 3,
      ),
    );
  } else {
    const rng = new Rng(7);
    for (let i = free.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [free[i], free[j]] = [free[j], free[i]];
    }
    for (const c of free.slice(0, MAX_TNT))
      sim.plantTnt(c % w, (c - (c % w)) / w, c % 8, 2, 1);
  }
}

/** One sim tick with the scene's inputs; the bot scene starts the next round when one ends. */
function tick(): ReturnType<Sim['tick']> {
  const events = sim.tick(botCtl ? botCtl.inputs(botInputs) : IDLE);
  if (botCtl && sim.over && !sim.matchOver) sim.nextRound();
  return events;
}

function busy(): boolean {
  if (botCtl) return false; // the bots never stop
  return sim.tnts.some((t) => t.active) || sim.flame.some((f) => f > 0);
}

export interface BenchResult {
  scene: string;
  frames: number;
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  simAvgMs: number;
  /** Average ms of `view.onEvents` + `view.update` (CPU side of drawing: matrices, FX spawns, uploads). */
  viewAvgMs: number;
  /** Average ms of `render` + `gl.finish` (command submission + the GPU). */
  drawAvgMs: number;
  simWorstMs: number;
  callsMax: number;
  trisMax: number;
  explosions: number;
  cratesBroken: number;
  /** The three slowest frames (index, ms) to chase hitches. */
  slowest: { frame: number; ms: number }[];
}

/** Run the scene from the start for `frames` frames at the fixed step, timing sim + view + draw (with `gl.finish`). */
async function run(
  scene: SceneId = state.scene as SceneId,
  frames = scene === '8bots' ? 7200 : 240,
): Promise<BenchResult> {
  running = true;
  setup(scene);
  await view.warmUp(shell.renderer, shell.scene);
  const gl = shell.renderer.getContext();
  const info = shell.renderer.info;
  const times: number[] = [];
  const simTimes: number[] = [];
  let viewSum = 0;
  let drawSum = 0;
  let callsMax = 0;
  let trisMax = 0;
  let explosions = 0;
  let cratesBroken = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    const events = tick();
    const t1 = performance.now();
    for (const e of events) {
      if (e.type === 'tntExploded') explosions++;
      else if (e.type === 'blockBroken') cratesBroken++;
    }
    view.onEvents(events);
    view.update(1, STEP);
    const t2 = performance.now();
    if (view.takeShadowUpdate()) shell.renderer.shadowMap.needsUpdate = true;
    shell.renderer.render(shell.scene, shell.rig.camera);
    gl.finish();
    const t3 = performance.now();
    viewSum += t2 - t1;
    drawSum += t3 - t2;
    times.push(t3 - t0);
    simTimes.push(t1 - t0);
    callsMax = Math.max(callsMax, info.render.calls);
    trisMax = Math.max(trisMax, info.render.triangles);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const result: BenchResult = {
    scene,
    frames,
    avgMs: times.reduce((a, b) => a + b, 0) / frames,
    p95Ms: sorted[Math.floor(frames * 0.95)],
    worstMs: sorted[frames - 1],
    simAvgMs: simTimes.reduce((a, b) => a + b, 0) / frames,
    viewAvgMs: viewSum / frames,
    drawAvgMs: drawSum / frames,
    simWorstMs: Math.max(...simTimes),
    callsMax,
    trisMax,
    explosions,
    cratesBroken,
    slowest: times
      .map((ms, frame) => ({ frame, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3),
  };
  show(result);
  running = false;
  setup(state.scene as SceneId);
  return result;
}

function show(r: BenchResult): void {
  const f = (n: number) => n.toFixed(2);
  setStats({
    scene: r.scene,
    'frame avg / p95 / worst': `${f(r.avgMs)} / ${f(r.p95Ms)} / ${f(r.worstMs)} ms`,
    'view update / draw (avg)': `${f(r.viewAvgMs)} / ${f(r.drawAvgMs)} ms`,
    'sim tick avg / worst': `${f(r.simAvgMs)} / ${f(r.simWorstMs)} ms`,
    'draw calls (max)': `${r.callsMax}  (budget 60)`,
    'triangles (max)': r.trisMax,
    explosions: r.explosions,
    'crates broken': r.cratesBroken,
  });
}

const s = shell.panel.section('Scene');
s.select('Scene', state.scene, [...SCENES], (v) => {
  state.scene = v;
  setup(v as SceneId);
  writeUrlState({ ...state }, DEFAULTS);
});
s.seed('Seed', state.seed, (v) => {
  state.seed = v;
  setup(state.scene as SceneId);
  writeUrlState({ ...state }, DEFAULTS);
});
s.button('Restart', () => setup(state.scene as SceneId));
s.button('Run benchmark (4 s; 8bots 2 min)', () => void run());
s.checkbox('Restart when finished', state.auto, (v) => {
  state.auto = v;
  writeUrlState({ ...state }, DEFAULTS);
});
s.checkbox('Free camera', state.orbit, (v) => {
  state.orbit = v;
  view.controlCamera = !v;
  shell.setGameCamera(!v);
  writeUrlState({ ...state }, DEFAULTS);
});

shell.onFrame((dt) => {
  if (running) return;
  clock += dt;
  acc += dt;
  while (acc >= STEP) {
    view.onEvents(tick());
    acc -= STEP;
  }
  view.update(acc / STEP, dt);
  if (view.takeShadowUpdate()) shell.renderer.shadowMap.needsUpdate = true;
  if (state.auto) {
    if (!busy()) {
      if (doneAt < 0) doneAt = clock;
      else if (clock - doneAt > 3) setup(state.scene as SceneId);
    }
  }
  const info = shell.renderer.info.render;
  setStats({
    scene: state.scene,
    'draw calls': `${info.calls}  (budget 60)`,
    triangles: info.triangles,
    'TNT / crates': `${sim.tnts.filter((t) => t.active).length} / ${view.arena.crateCount}`,
    'shake trauma': view.fx.shake.trauma.toFixed(2),
  });
});

(window as unknown as { __kabooomBench: unknown }).__kabooomBench = {
  run: (scene?: SceneId, frames?: number) => run(scene, frames),
  get sim() {
    return sim;
  },
  get view() {
    return view;
  },
  /** Step the scene `seconds` ahead without drawing (the pane throttles frames; take a screenshot afterwards). */
  advance(seconds: number) {
    for (let t = 0; t < seconds; t += STEP) {
      view.onEvents(tick());
      view.update(1, STEP);
    }
  },
  /** Triangles per drawable (geometry triangles x instances), biggest first: where the triangle budget goes. */
  triangles() {
    const rows: { name: string; tris: number }[] = [];
    view.root.traverse((o) => {
      const m = o as InstancedMesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const per =
        (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      rows.push({
        name:
          o.parent?.children.indexOf(o) +
          ':' +
          (m.material as { type?: string }).type,
        tris: Math.round(per * (m.isInstancedMesh ? m.count : 1)),
      });
    });
    return rows.sort((x, y) => y.tris - x.tris);
  },
};

setup(state.scene as SceneId);
if (state.orbit) shell.setGameCamera(false);
