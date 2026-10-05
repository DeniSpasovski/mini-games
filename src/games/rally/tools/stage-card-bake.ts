import {
  Color,
  FloatType,
  Group,
  OrthographicCamera,
  Scene,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { getAssetMeta } from '../assets/catalog';
import { Environment } from '../engine/environment';
import type { QualitySettings } from '../engine/quality';
import { worldUniforms } from '../engine/world-shading';
import { ALL_MAPS } from '../maps';
import { AerialTerrain } from '../world/aerial-terrain';
import { AerialTrees } from '../world/aerial-trees';
import { InstanceStreamer } from '../world/instance-streamer';
import { roadMeshJob } from '../world/road-mesh';
import { setGroundTint } from '../world/terrain-material';
import { TerrainGrid } from '../world/terrain-renderer';
import { RENDER_MARGIN, World } from '../world/world';
import {
  CARD_MARGIN,
  encodeHeights,
  isLargeMap,
  mapHash,
  STAGE_CARD_VERSION,
  type StageCardData,
  stageBox,
  stagePoints,
} from './stage-card';

/** Long side of the baked image (px) and of the height grid (vertices). */
const IMAGE = 2048;
const GRID = 257;
/** Outer fraction of the image faded into the floor colour (no hard card edge in the view). */
const FADE = 0.07;

/** Yield to the browser now and then while a long job runs (keeps the page responsive). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * DEV ONLY (dynamically imported by the menu with `?bakecards=1` / `?bakecard=<id>`): bake a large map's stage card
 * (stage-card.ts) and save it through the dev server (`/__dev/stage-card`, rsbuild.config.ts) into
 * `maps/<id>/preview/`. Full scatter density (the old live card thinned it), trees as canopy discs, one sun shadow
 * map over the whole card so trees / buildings / hills cast long shadows into the image.
 */
export async function bakeStageCard(
  renderer: WebGLRenderer,
  quality: QualitySettings,
  mapId: string,
  log: (s: string) => void = console.info,
): Promise<string> {
  const map = ALL_MAPS.find((m) => m.id === mapId);
  if (!map) throw new Error(`unknown map ${mapId}`);
  if (!isLargeMap(map)) return `${mapId}: small map, built live - no card`;
  const t0 = performance.now();
  log(`${mapId}: world`);
  await breathe();
  const world = new World(map);
  const box = stageBox(world);

  // Card rectangle: the route's bounding box + CARD_MARGIN, inside the map's terrain, snapped to the height grid.
  const b = map.bounds;
  const mx0 = Math.max(b.minX - RENDER_MARGIN, box.x0 - CARD_MARGIN);
  const mx1 = Math.min(b.maxX + RENDER_MARGIN, box.x1 + CARD_MARGIN);
  const mz0 = Math.max(b.minZ - RENDER_MARGIN, box.z0 - CARD_MARGIN);
  const mz1 = Math.min(b.maxZ + RENDER_MARGIN, box.z1 + CARD_MARGIN);
  const d = Math.max(mx1 - mx0, mz1 - mz0) / (GRID - 1);
  const nx = Math.round((mx1 - mx0) / d) + 1;
  const nz = Math.round((mz1 - mz0) / d) + 1;
  const rect = { x0: mx0, z0: mz0, w: (nx - 1) * d, h: (nz - 1) * d };

  // Heights: the same grid sampler as the aerial terrain.
  log(`${mapId}: heights ${nx} x ${nz}`);
  const grid = new TerrainGrid(world.gen, rect.x0, rect.z0, d, nx, nz);
  grid.heights(0, nz + 2);
  const pos = new Float32Array(nx * nz * 3);
  grid.vertices(
    0,
    nz,
    pos,
    new Float32Array(nx * nz * 3),
    new Uint8Array(nx * nz * 4),
  );
  const heights = new Float32Array(nx * nz);
  for (let k = 0; k < heights.length; k++) heights[k] = pos[k * 3 + 1];

  // Scene: terrain, roads (+ buildings / landmarks / bridges), canopy discs, props - lit by the map's own sun.
  const scene = new Scene();
  const long = Math.max(rect.w, rect.h);
  const maxTex = renderer.capabilities.maxTextureSize;
  const env = new Environment(
    scene,
    renderer,
    { ...map.environment, fogDensity: 0 },
    {
      ...quality,
      shadowMapSize: Math.min(8192, maxTex),
      shadowExtent: long * 0.75,
    },
  );
  const saved = {
    cloud: worldUniforms.wsCloud.value.x,
    fog: worldUniforms.wsFog.value.w,
    wind: worldUniforms.wsWind.value.z,
  };
  // No drifting cloud shadows / height fog / sway baked into the image.
  worldUniforms.wsCloud.value.x = 0;
  worldUniforms.wsFog.value.w = 0;
  worldUniforms.wsWind.value.z = 0;
  scene.fog = null;
  env.sky.visible = false;
  setGroundTint(map.environment.groundTint);

  const content = new Group();
  scene.add(content);
  const terrain = new AerialTerrain(world, Math.min(1536, Math.ceil(long / 3)));
  content.add(terrain.mesh);
  log(`${mapId}: terrain`);
  let n = 0;
  while (!terrain.update(30)) if (++n % 4 === 0) await breathe();

  log(`${mapId}: roads, buildings, landmarks`);
  const road = new Group();
  content.add(road);
  const job = roadMeshJob(world);
  for (let r = job.next(); ; r = job.next()) {
    if (r.done) {
      if (r.value) road.add(r.value);
      break;
    }
    if (++n % 8 === 0) await breathe();
  }

  log(`${mapId}: trees`);
  const trees = new AerialTrees(world, 1);
  trees.mesh.castShadow = true;
  trees.mesh.receiveShadow = true;
  content.add(trees.mesh);
  const treeJob = trees.job();
  while (!treeJob.next().done) if (++n % 16 === 0) await breathe();

  log(`${mapId}: props`);
  const center = new Vector3(box.x, world.heightAt(box.x, box.z), box.z);
  const streamer = new InstanceStreamer(world, {
    lodScale: 6,
    detailDensity: 0,
    rebuildDistance: 25,
    budgetMs: 40,
  });
  streamer.filter = (asset) => getAssetMeta(asset).category !== 'vegetation';
  content.add(streamer.group);
  while (!streamer.commits) {
    streamer.update(center);
    await breathe();
  }
  content.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
    // GL lines (power line wires) are 1 px whatever the scale: black strokes across the card.
    if ((o as { isLine?: boolean }).isLine) o.visible = false;
  });

  // One shadow map over the whole card: the sun far out along its direction, a deep depth range.
  env.update(center);
  const sun = env.sun;
  const sc = sun.shadow.camera;
  sc.near = 10;
  sc.far = 12000;
  sc.updateProjectionMatrix();
  sun.position.copy(sun.target.position).addScaledVector(env.sunDir, 6000);
  sun.updateMatrixWorld();
  sun.shadow.bias = -0.00002;
  sun.shadow.normalBias = 1.5;
  sun.shadow.needsUpdate = true;

  // Straight down, screen-up = -Z: image top = z0 (texture v = 1 at z0).
  log(`${mapId}: render`);
  const w = Math.round((IMAGE * rect.w) / long);
  const h = Math.round((IMAGE * rect.h) / long);
  const cam = new OrthographicCamera(
    -rect.w / 2,
    rect.w / 2,
    rect.h / 2,
    -rect.h / 2,
    1,
    20000,
  );
  cam.up.set(0, 0, -1);
  cam.position.set(rect.x0 + rect.w / 2, 9000, rect.z0 + rect.h / 2);
  cam.lookAt(rect.x0 + rect.w / 2, 0, rect.z0 + rect.h / 2);
  cam.updateProjectionMatrix();
  const target = new WebGLRenderTarget(w, h, { type: FloatType, samples: 4 });
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  const px = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
  renderer.setRenderTarget(null);

  const route = stagePoints(world, 8);
  const { jpeg, floor } = encodeImage(px, w, h);

  const data: StageCardData = {
    version: STAGE_CARD_VERSION,
    hash: mapHash(map),
    map: mapId,
    rect,
    grid: encodeHeights(heights, nx, nz),
    center: [box.x, center.y, box.z],
    size: box.size,
    stage: route.flatMap((p) => [
      Math.round(p.x * 10) / 10,
      Math.round(p.y * 10) / 10,
      Math.round(p.z * 10) / 10,
    ]),
    floor: `#${floor.getHexString()}`,
  };

  // Restore the shared state, free everything.
  worldUniforms.wsCloud.value.x = saved.cloud;
  worldUniforms.wsFog.value.w = saved.fog;
  worldUniforms.wsWind.value.z = saved.wind;
  target.dispose();
  terrain.dispose();
  trees.dispose();
  streamer.dispose();
  road.traverse((o) =>
    (o as { geometry?: { dispose(): void } }).geometry?.dispose(),
  );
  env.dispose();
  sun.shadow.map?.dispose();

  log(`${mapId}: save`);
  const res = await fetch(
    `/__dev/stage-card?map=${encodeURIComponent(mapId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: JSON.stringify(data), jpeg }),
    },
  );
  const msg = await res.text();
  if (!res.ok) throw new Error(`${mapId}: ${msg}`);
  return `${mapId}: ${msg} (${w} x ${h}, ${((performance.now() - t0) / 1000).toFixed(1)} s)`;
}

/** Linear float pixels (bottom row first) -> sRGB JPEG with faded edges; the floor colour = the faded edge. */
function encodeImage(
  px: Float32Array,
  w: number,
  h: number,
): { jpeg: string; floor: Color } {
  const toSrgb = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  // Floor = the image's average, a little darker (reads as the far-off land around the stage).
  const avg = [0, 0, 0];
  for (let k = 0; k < w * h; k++)
    for (let c = 0; c < 3; c++) avg[c] += px[k * 4 + c];
  for (let c = 0; c < 3; c++) avg[c] = (avg[c] / (w * h)) * 0.85;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const fx = FADE * w;
  const fz = FADE * h;
  for (let y = 0; y < h; y++) {
    const src = h - 1 - y; // readPixels: bottom row first
    for (let x = 0; x < w; x++) {
      const e = Math.min(
        1,
        Math.min(x, w - 1 - x) / fx,
        Math.min(y, h - 1 - y) / fz,
      );
      const t = e * e * (3 - 2 * e);
      const k = (src * w + x) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++)
        img.data[o + c] = Math.round(
          255 * toSrgb(avg[c] + (px[k + c] - avg[c]) * t),
        );
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Linear like the pixels (getHexString() writes sRGB, `new Color(hex)` reads it back to linear).
  const floor = new Color().setRGB(avg[0], avg[1], avg[2]);
  return { jpeg: canvas.toDataURL('image/jpeg', 0.88), floor };
}
