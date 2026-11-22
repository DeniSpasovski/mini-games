import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
} from 'three';
import { MeshStandardNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { getStage, loadStage } from '../maps';
import { stageSeason } from '../maps/shared/climate';
import { mapInSeason } from '../maps/shared/season-map';
import { loadQuality } from '../engine/quality';
import { sunAt } from '../engine/environment';
import { World } from '../world/world';
import { buildSlice, type TrialSlice } from '../gpu-trial/slice';
import {
  classicMaterial,
  sharedNodeMaterial,
  TERRAIN_PARAMS,
  unknownMaterials,
} from '../gpu-trial/materials';
import { CpuDraw } from '../gpu-trial/cpu-draw';
import { GpuDraw } from '../gpu-trial/gpu-draw';
import {
  buildPipeline,
  needsPipeline,
  parsePicture,
  pictureLabel,
  useCsm,
} from '../gpu-trial/picture';

/**
 * GPU trial (dev page, gravel rally v2): one stretch of a stage drawn by three renderers on the same scene, so the
 * render core can be measured before the game moves to it.
 *
 * - `r=webgpu` WebGPURenderer on WebGPU, node materials; `cull=gpu` (default) culls and picks levels in a compute
 *   pass and draws with indirect draws (gpu-trial/gpu-draw.ts), `cull=cpu` as the game does today.
 * - `r=webgl2` the same renderer on its WebGL 2 fallback (phones and browsers without WebGPU), CPU culling.
 * - `r=classic` today's WebGLRenderer, CPU culling.
 *
 * The scene is plain on purpose (gpu-trial/materials.ts): terrain coloured by slope, the road and every scatter /
 * detail instance with its own model and textures, sun shadows and fog; none of the game's own shading. The
 * benchmark drives the camera down the road at 90 km/h and reports frame times, CPU and GPU time.
 *
 * Picture switches for the WebGPURenderer modes (`aa`, `scale`, `gi`, `ssr`, `csm`): gpu-trial/picture.ts.
 */

type Mode = 'webgpu' | 'webgl2' | 'classic';

const params = new URLSearchParams(location.search);
const MODES: Mode[] = ['webgpu', 'webgl2', 'classic'];
const MODE_LABELS: Record<Mode, string> = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL 2 fallback',
  classic: 'Current renderer',
};
const askedMode = params.get('r') as Mode | null;
let mode: Mode = askedMode && MODES.includes(askedMode) ? askedMode : 'webgpu';
const gpuCull = params.get('cull') !== 'cpu';
const stageId = params.get('stage') ?? 'vodno';
/** Diagnostics: `shadows=0` drops the sun shadow pass, `ts=0` turns the GPU timestamp queries off. */
const shadows = params.get('shadows') !== '0';
const timestamps = params.get('ts') !== '0';
/**
 * How often the sun's shadow map is drawn (the shadow pass is about a fifth of the CPU frame):
 * - `shadow=frame` (default): every frame.
 * - `shadow=alt`: every `every`-th frame (default 2). The map keeps the matrix it was drawn with, so it does not swim;
 *   it lags the camera by up to `every` - 1 frames.
 * - `shadow=move`: a cache, drawn again only once the camera is `step` m (default 20) from where it was last drawn.
 *   Fits a static world; the game's car (and anything moving) would need its own small dynamic map on top.
 */
const shadowMode =
  (['frame', 'alt', 'move'] as const).find((m) => m === params.get('shadow')) ??
  'frame';
const shadowEvery = Math.max(2, Math.round(Number(params.get('every')) || 2));
const shadowStep = Math.max(1, Number(params.get('step')) || 20);
const picture = parsePicture(params);
/** Camera speed on the run (m/s). */
const SPEED = 25;

const root = document.createElement('div');
root.style.cssText =
  'position:fixed;inset:0;background:#0e0d0b;overflow:hidden';
document.body.style.margin = '0';
document.body.append(root);
const panel = document.createElement('div');
panel.style.cssText =
  'position:absolute;left:12px;top:12px;max-width:min(420px,calc(100vw - 24px));padding:10px 12px;border-radius:8px;' +
  'background:rgba(14,13,11,.82);color:#f3efe6;font:13px/1.45 system-ui,sans-serif;z-index:2';
root.append(panel);
const status = document.createElement('div');
const live = document.createElement('div');
live.style.cssText =
  'font-variant-numeric:tabular-nums;margin-top:6px;white-space:pre';
const results = document.createElement('pre');
results.style.cssText =
  'margin:8px 0 0;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;display:none';

/** Picture presets in the panel (WebGPURenderer modes). */
const PICTURES: [string, Record<string, string>][] = [
  ['MSAA', {}],
  ['TRAA', { aa: 'traa' }],
  ['TAAU 67 %', { aa: 'taau' }],
  ['TRAA + SSGI', { aa: 'traa', gi: '1' }],
  ['TRAA + SSR', { aa: 'traa', ssr: '1' }],
  ['TRAA + CSM', { aa: 'traa', csm: '1' }],
  ['All', { aa: 'traa', gi: '1', ssr: '1', csm: '1' }],
];
const PICTURE_KEYS = ['aa', 'scale', 'gi', 'gis', 'ssr', 'csm'];

function pictureLink(set: Record<string, string>): string {
  const p = new URLSearchParams(location.search);
  for (const k of PICTURE_KEYS) p.delete(k);
  for (const [k, v] of Object.entries(set)) p.set(k, v);
  p.delete('run');
  return `?${p}`;
}

function link(m: Mode, cull?: 'cpu'): string {
  const p = new URLSearchParams(location.search);
  p.set('r', m);
  if (cull) p.set('cull', cull);
  else p.delete('cull');
  p.delete('run');
  return `?${p}`;
}

function header(slice: TrialSlice | null, from: number, to: number) {
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.innerHTML = `<b>GPU trial</b> · ${getStage(stageId).name ?? stageId} ${Math.round(from)}–${Math.round(to)} m`;
  const modes = document.createElement('div');
  modes.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
  const opts: [string, string, boolean][] = [
    ['WebGPU, GPU culling', link('webgpu'), mode === 'webgpu' && gpuCull],
    [
      'WebGPU, CPU culling',
      link('webgpu', 'cpu'),
      mode === 'webgpu' && !gpuCull,
    ],
    [MODE_LABELS.webgl2, link('webgl2'), mode === 'webgl2'],
    [MODE_LABELS.classic, link('classic'), mode === 'classic'],
  ];
  const chip = (row: HTMLElement, label: string, href: string, on: boolean) => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.style.cssText = `padding:3px 8px;border-radius:5px;text-decoration:none;color:${on ? '#0e0d0b' : '#f3efe6'};background:${on ? '#f0a020' : 'rgba(255,255,255,.12)'}`;
    row.append(a);
  };
  for (const [label, href, on] of opts) chip(modes, label, href, on);
  panel.append(title, modes);
  if (mode !== 'classic') {
    const pics = document.createElement('div');
    pics.style.cssText = modes.style.cssText;
    const current = pictureLabel(picture);
    for (const [label, set] of PICTURES)
      chip(
        pics,
        label,
        pictureLink(set),
        pictureLabel(parsePicture(new URLSearchParams(set))) === current,
      );
    panel.append(pics);
  }
  panel.append(status, live, results);
  if (slice) {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:8px;align-items:center;margin-top:8px';
    const run = document.createElement('button');
    run.textContent = 'Run benchmark';
    run.onclick = () => startRun();
    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = String(slice.path.length / 3 - 1);
    scrub.value = '0';
    scrub.style.flex = '1';
    scrub.oninput = () => {
      if (!bench) placeCamera(Number(scrub.value));
    };
    row.append(run, scrub);
    panel.append(row);
  }
}

let bench: {
  t0: number;
  warmMs: number;
  frames: number[];
  cpu: number[];
  cull: number[];
  gpu: number[];
  draws: number[];
  drawn: number[];
} | null = null;
let startRun: () => void = () => {};
let placeCamera: (s: number) => void = () => {};

async function main() {
  const quality = loadQuality();
  const info = getStage(stageId);
  const fromParam = Number(params.get('from'));
  const lenParam = Number(params.get('len'));
  header(null, 0, 0);
  const say = async (t: string) => {
    status.textContent = t;
    await new Promise((r) => setTimeout(r));
  };
  await say('Loading the map…');
  const { map, stage } = await loadStage(info.id);
  const season = stageSeason({
    season: stage.season,
    environment: map.environment,
  });
  const world = new World(mapInSeason(map, season), stage);
  const from =
    Number.isFinite(fromParam) && fromParam > 0
      ? fromParam
      : world.stage.start + 300;
  const length = Number.isFinite(lenParam) && lenParam > 0 ? lenParam : 600;
  const slice = await buildSlice(
    world,
    from,
    length,
    params.get('trees') !== '0',
    say,
  );
  const to = from + slice.path.length / 3 - 1;
  header(slice, from, to);

  // Renderer.
  // Temporal AA replaces MSAA (and TAAU must not have it).
  const antialias =
    quality.antialias && (mode === 'classic' || picture.aa === 'msaa');
  let renderer: WebGLRenderer | WebGPURenderer;
  if (mode === 'classic') {
    const r = new WebGLRenderer({
      antialias,
      powerPreference: 'high-performance',
    });
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    renderer = r;
  } else {
    const r = new WebGPURenderer({
      antialias,
      powerPreference: 'high-performance',
      forceWebGL: mode === 'webgl2',
      trackTimestamp: timestamps,
    });
    await r.init();
    r.shadowMap.enabled = true;
    // No WebGPU in this browser: WebGPURenderer fell back to WebGL 2 on its own.
    if (
      mode === 'webgpu' &&
      !(r.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    )
      mode = 'webgl2';
    renderer = r;
  }
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, quality.maxPixelRatio),
  );
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  root.append(renderer.domElement);
  const camera = new PerspectiveCamera(60, 1, 0.3, 3000);
  const resize = () => {
    renderer.setSize(root.clientWidth, root.clientHeight, false);
    camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(root);
  resize();

  // Scene: sky colour, fog, sun with shadows following the camera, hemisphere fill.
  const env = map.environment;
  const scene = new Scene();
  const sky = new Color(0.62, 0.72, 0.84);
  scene.background = sky;
  scene.fog = new FogExp2(sky.getHex(), env.fogDensity ?? 0.0003);
  scene.add(new HemisphereLight(0xbfd4ef, 0x5a5040, 1.1));
  const sunDeg =
    env.timeOfDay !== undefined
      ? sunAt(env.timeOfDay)
      : { elevation: env.sunElevation, azimuth: env.sunAzimuth };
  const el = MathUtils.degToRad(sunDeg.elevation);
  const az = MathUtils.degToRad(sunDeg.azimuth);
  const sunDir = new Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  const sun = new DirectionalLight(0xfff2dd, 3);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -80;
  sc.right = sc.top = 80;
  sc.near = 1;
  sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const target = new Object3D();
  sun.target = target;
  scene.add(sun, target);
  if (mode !== 'classic' && picture.csm && shadows) useCsm(sun);
  const post =
    mode !== 'classic' && needsPipeline(picture)
      ? buildPipeline(renderer as WebGPURenderer, scene, camera, picture)
      : null;

  const node = mode !== 'classic';
  const material = (m: Material): Material =>
    node ? sharedNodeMaterial(m) : classicMaterial(m);
  slice.terrain.material = node
    ? new MeshStandardNodeMaterial(TERRAIN_PARAMS)
    : new MeshStandardMaterial(TERRAIN_PARAMS);
  scene.add(slice.terrain);
  for (const m of slice.road) {
    const mesh = m as Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(material)
      : material(mesh.material);
    mesh.receiveShadow = true;
    mesh.removeFromParent();
    scene.add(mesh);
  }
  const useGpu = mode === 'webgpu' && gpuCull;
  const cpu = useGpu ? null : new CpuDraw(slice, material);
  // `base=uniform`: the per-object uniform path even where firstInstance works (to compare the two).
  const firstInstance =
    useGpu &&
    params.get('base') !== 'uniform' &&
    (renderer as WebGPURenderer).hasFeature('indirect-first-instance');
  // `bundle=0`: draw the GPU path's meshes one by one instead of from a render bundle.
  const bundle = params.get('bundle') !== '0';
  const gpu = useGpu ? new GpuDraw(slice, firstInstance, bundle) : null;
  scene.add((cpu ?? gpu)!.group);
  const parts = slice.groups.reduce(
    (s, g) => s + g.lods.reduce((t, l) => t + l.parts.length, 0),
    0,
  );
  status.textContent =
    `${MODE_LABELS[mode]}${mode === 'webgpu' ? (gpuCull ? ', GPU culling' : ', CPU culling') : ''} · ` +
    `${slice.instances.toLocaleString()} instances (${slice.standIns.toLocaleString()} trees as pack trees), ${slice.groups.length} models, ${parts} parts` +
    (unknownMaterials.size
      ? ` · ${unknownMaterials.size} materials drawn grey`
      : '');

  // Camera on the run: 2.2 m above the road, looking 30 m ahead.
  const path = slice.path;
  const points = path.length / 3;
  const ahead = new Vector3();
  placeCamera = (s: number) => {
    // Stops 30 points before the end, so it never looks straight down at the last one.
    const i = Math.min(Math.max(0, points - 31), Math.max(0, Math.floor(s)));
    const j = Math.min(points - 1, i + 30);
    camera.position.set(path[i * 3], path[i * 3 + 1] + 2.2, path[i * 3 + 2]);
    ahead.set(path[j * 3], path[j * 3 + 1] + 1.2, path[j * 3 + 2]);
    camera.lookAt(ahead);
    camera.updateMatrixWorld();
    target.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 300);
  };
  placeCamera(0);

  // `shadow=alt` / `move`: the map is drawn only when asked (CSM's cascades keep their own shadows: not covered).
  sun.shadow.autoUpdate = shadowMode === 'frame';
  let shadowFrame = 0;
  let shadowAt: Vector3 | null = null;
  let shadowDraws = 0;
  const shadowLabel =
    shadowMode === 'alt'
      ? `every ${shadowEvery} frames`
      : shadowMode === 'move'
        ? `every ${shadowStep} m`
        : 'every frame';
  const askShadow = () => {
    if (shadowMode === 'frame') return;
    const due =
      shadowMode === 'alt'
        ? shadowFrame++ % shadowEvery === 0
        : !shadowAt || camera.position.distanceTo(shadowAt) >= shadowStep;
    if (!due) return;
    sun.shadow.needsUpdate = true;
    shadowDraws++;
    if (shadowMode === 'move')
      (shadowAt ??= new Vector3()).copy(camera.position);
  };

  // GPU time: timestamp queries (WebGPURenderer) or the WebGL timer query (classic).
  let gpuMs = NaN;
  const gl =
    mode === 'classic'
      ? ((renderer as WebGLRenderer).getContext() as WebGL2RenderingContext)
      : null;
  const timer = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const queries: WebGLQuery[] = [];

  // Shader compile + first upload before anything is timed.
  const summary = status.textContent;
  await say('Compiling shaders…');
  if (node) await (renderer as WebGPURenderer).compileAsync(scene, camera);
  else (renderer as WebGLRenderer).compile(scene, camera);
  if (gpu) await gpu.compile(renderer as WebGPURenderer);
  if (post) await post.compile();
  status.textContent = summary;

  // A render bundle is recorded again on every frame while one of its pipelines (the shadow pass's are not covered by
  // compileAsync) is still compiling, so the warm-up lasts until no bundle was recorded for WARM frames in a row.
  let recorded = 0;
  const backend = node
    ? ((renderer as WebGPURenderer).backend as unknown as {
        beginBundle?: (ctx: unknown) => void;
      })
    : null;
  if (backend?.beginBundle) {
    const begin = backend.beginBundle.bind(backend);
    backend.beginBundle = (ctx) => {
      recorded++;
      begin(ctx);
    };
  }
  const WARM = 30;
  const WARM_LIMIT = 30_000;
  let warmSince = 0;

  let warm = 0;
  let last = performance.now();
  let runAt = 0;
  let shown = 0;
  const recent: number[] = [];
  startRun = () => {
    results.style.display = 'none';
    runAt = 0;
    warm = WARM;
    warmSince = performance.now();
    bench = {
      t0: 0,
      warmMs: 0,
      frames: [],
      cpu: [],
      cull: [],
      gpu: [],
      draws: [],
      drawn: [],
    };
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    if (bench) {
      if (warm > 0) {
        warm--;
        placeCamera(0);
        if (recorded > 0 && now - warmSince < WARM_LIMIT) warm = WARM;
        recorded = 0;
      } else {
        runAt += (SPEED * dt) / 1000;
        if (bench.t0 === 0) {
          bench.t0 = now;
          bench.warmMs = now - warmSince;
          recorded = 0;
          shadowDraws = 0;
          runAt = 0;
        } else bench.frames.push(dt);
        placeCamera(runAt);
      }
    }
    const t0 = performance.now();
    if (cpu) cpu.update(camera);
    if (gpu) gpu.update(renderer as WebGPURenderer, camera);
    const cullMs = performance.now() - t0;
    let q: WebGLQuery | null = null;
    if (gl && timer && queries.length < 8) {
      q = gl.createQuery();
      if (q) gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    }
    askShadow();
    if (post) post.pipeline.render();
    else renderer.render(scene, camera);
    if (gl && timer && q) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      queries.push(q);
    }
    const cpuMs = performance.now() - t0;
    if (gl && timer && queries.length) {
      const head = queries[0];
      if (gl.getQueryParameter(head, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
          gpuMs = gl.getQueryParameter(head, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(head);
        queries.shift();
      }
    }
    if (node && timestamps) {
      const r = renderer as WebGPURenderer;
      void Promise.all([
        r.resolveTimestampsAsync('render'),
        useGpu ? r.resolveTimestampsAsync('compute') : 0,
      ]).then(([a, b]) => {
        if (typeof a === 'number') gpuMs = a + (typeof b === 'number' ? b : 0);
      });
    }
    const draws = node
      ? (renderer as WebGPURenderer).info.render.drawCalls
      : (renderer as WebGLRenderer).info.render.calls;
    const tris = node
      ? (renderer as WebGPURenderer).info.render.triangles
      : (renderer as WebGLRenderer).info.render.triangles;
    recent.push(dt);
    if (recent.length > 60) recent.shift();
    if (bench && bench.t0 && bench.frames.length) {
      bench.cpu.push(cpuMs);
      bench.cull.push(cullMs);
      if (Number.isFinite(gpuMs)) bench.gpu.push(gpuMs);
      bench.draws.push(draws);
      bench.drawn.push(cpu?.drawn ?? NaN);
      if (runAt >= points - 31) finishRun();
    }
    if (now - shown > 250) {
      shown = now;
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      live.textContent =
        `${(1000 / avg).toFixed(0)} fps · frame ${avg.toFixed(1)} ms · CPU ${cpuMs.toFixed(1)} ms · ` +
        `GPU ${Number.isFinite(gpuMs) ? gpuMs.toFixed(1) + ' ms' : 'n/a'}\n` +
        `${draws} draws · ${(tris / 1e6).toFixed(2)} M triangles` +
        (cpu ? ` · ${cpu.drawn.toLocaleString()} instances drawn` : '');
    }
  };
  requestAnimationFrame(frame);

  const finishRun = () => {
    const b = bench!;
    bench = null;
    const sorted = [...b.frames].sort((a, c) => a - c);
    const pct = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const mean = (a: number[]) =>
      a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
    const res = {
      renderer:
        MODE_LABELS[mode] +
        (mode === 'webgpu'
          ? gpuCull
            ? ', GPU culling'
            : ', CPU culling'
          : ''),
      stage: stageId,
      picture: mode === 'classic' ? 'MSAA' : pictureLabel(picture),
      shadow: shadows ? shadowLabel : 'off',
      shadowDraws: shadowMode === 'frame' ? b.frames.length : shadowDraws,
      from: Math.round(from),
      to: Math.round(to),
      pixels: `${renderer.domElement.width}x${renderer.domElement.height}`,
      frames: b.frames.length,
      avgFps: +(1000 / mean(b.frames)).toFixed(1),
      medianMs: +pct(0.5).toFixed(2),
      p99Ms: +pct(0.99).toFixed(2),
      worstMs: +sorted[sorted.length - 1].toFixed(2),
      cpuMs: +mean(b.cpu).toFixed(2),
      cullMs: +mean(b.cull).toFixed(2),
      shadows,
      timestamps,
      firstInstance,
      bundle: !!(gpu?.group as { isBundleGroup?: boolean } | undefined)
        ?.isBundleGroup,
      indirectDraws: gpu?.draws ?? 0,
      warmMs: Math.round(b.warmMs),
      bundleRecords: recorded,
      gpuMs: b.gpu.length ? +mean(b.gpu).toFixed(2) : null,
      draws: Math.round(mean(b.draws)),
      instances: slice.instances,
      userAgent: navigator.userAgent,
    };
    (window as { __trialResult?: unknown }).__trialResult = res;
    results.textContent =
      `${res.renderer}\n${res.avgFps} fps average, median frame ${res.medianMs} ms, 1 % slowest ${res.p99Ms} ms, worst ${res.worstMs} ms\n` +
      `CPU ${res.cpuMs} ms a frame (${res.cullMs} culling, the rest draw submit), GPU ${res.gpuMs ?? 'n/a'} ms, ${res.draws} draws\n` +
      `${res.pixels} px, ${res.frames} frames`;
    results.style.display = 'block';
    const copy = document.createElement('button');
    copy.textContent = 'Copy result';
    copy.onclick = () =>
      void navigator.clipboard?.writeText(JSON.stringify(res));
    results.append('\n', copy);
  };
  (window as { __trial?: unknown }).__trial = {
    renderer,
    scene,
    camera,
    slice,
    startRun,
  };
  if (params.get('run') === '1') startRun();
}

main().catch((e: unknown) => {
  status.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
