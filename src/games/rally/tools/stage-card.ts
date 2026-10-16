import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three';
import type { MapDef, StageDef } from '../maps/shared/types';
import { DEFAULT_SEASON, type Season } from '../season';
import type { World } from '../world/world';

/**
 * Stage cards: the stage-select view of a large map, PRE-BAKED on the dev server (`?bakecards=1`, see
 * stage-card-bake.ts) instead of building the whole map in the menu (0.5-6 s of main-thread work per map).
 *
 * A card = `maps/<map>/preview/<stage id>.json` (height grid, stage polyline, framing) + `<stage id>-<season>.jpg` (top-down
 * render of the stage area: terrain, roads, trees, buildings, the map's sun and long shadows baked in). At runtime it
 * is ONE textured grid mesh (relief from the height grid, `MapDef.previewRelief` exaggerates it) + the stage ribbon,
 * start / finish poles and a floor - loaded lazily per map, ~30-50 ms.
 *
 * DOM-free at import (node tests can check a card against `stageCardHash`).
 */

/** Maps bigger than this (m²) use a baked card; smaller maps are built live (cheap: real 3D trees / rocks). */
export const LARGE_MAP_AREA = 8e6;
/** Bump when the baker's look or the card format changes: every card must be re-baked. */
export const STAGE_CARD_VERSION = 3;
/**
 * A card has one image per season (spring / summer / autumn), every one named `<stage id>-<season>.jpg`; the JSON
 * (`StageCardData.season`) says which is the map's own. Only the image shown is fetched.
 */
export function cardImageName(stageId: string, season: Season): string {
  return `${stageId}-${season}`;
}
/** Card = the stage's bounding rectangle + this margin (m): a tight cut, the rest of the map stays a surprise. */
export const CARD_MARGIN = 500;
/** Margin around the stage (m), so the start / finish poles and corners aren't at the view's edge. */
const STAGE_MARGIN = 150;

export interface StageCardData {
  version: number;
  /** `stageCardHash(map, stage)` at bake time: a different hash = the map or stage changed since, re-bake. */
  hash: string;
  map: string;
  /** Ground rectangle of the texture / grid (m): texture u = (x - x0) / w, v = 1 - (z - z0) / h. */
  rect: { x0: number; z0: number; w: number; h: number };
  /** Height grid nx x nz over `rect`: base64 Uint16, height = min + value * step. */
  grid: { nx: number; nz: number; min: number; step: number; heights: string };
  /** Orbit centre (x, y, z) and framing size (m), see `stageBox`. */
  center: [number, number, number];
  size: number;
  /** Stage polyline start -> finish, flat [x, y, z, ...] (m, 0.1 m precision). */
  stage: number[];
  /** Floor colour ('#rrggbb') = the card's faded edge colour. */
  floor: string;
  /** Season of the base image (default summer): the map's own. */
  season?: Season;
  /** The other seasons' images (`cardImageName`): their hash (as `hash`) and floor colour. */
  seasons?: Partial<Record<Season, { hash: string; floor: string }>>;
}

/**
 * The stage (start -> finish along the road) for the map view's orbit: centre (x, z) of its bounding box and size =
 * the diameter of its bounding sphere (box diagonal incl. the climb) plus a margin on both sides.
 */
export function stageBox(world: World): {
  x: number;
  z: number;
  size: number;
  /** Bounding rectangle of the route (m). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
} {
  const st = world.stage;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let d = st.start; ; d = Math.min(st.finish, d + 10)) {
    const p = world.stageRoad.at(d);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
    if (d >= st.finish) break;
  }
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    size: Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 2 * STAGE_MARGIN,
    x0,
    x1,
    z0,
    z1,
  };
}

/** Stage polyline (every `step` m from start to finish) as points. */
export function stagePoints(world: World, step = 4): Vector3[] {
  const st = world.stage;
  const out: Vector3[] = [];
  for (let d = st.start; ; d = Math.min(st.finish, d + step)) {
    const p = world.stageRoad.at(d);
    out.push(new Vector3(p.x, p.y, p.z));
    if (d >= st.finish) break;
  }
  return out;
}

/**
 * Map fields a card does not draw: text and menu data (names, links, credits, the menu outline), `previewRelief`
 * (applied at load time) and `horizon` (the far backdrop is not on the card). Changing them needs no re-bake.
 */
const NOT_ON_CARD = new Set([
  'id',
  'name',
  'stages',
  'sources',
  'credits',
  'geo',
  'stageNumber',
  'previewRelief',
  'route',
  'surfaces',
  'horizon',
]);

/** The environment as drawn: not the air temperatures, months nor the other seasons' tints (the card is one season's picture). */
function drawnEnvironment(env: MapDef['environment']): unknown {
  const {
    airTemp: _a,
    airTemps: _t,
    months: _m,
    groundTints: _g,
    ...drawn
  } = env;
  return drawn;
}

/**
 * Hash of what a stage's card is rendered from: the map's world data (terrain, roads, land cover, scatter, buildings,
 * environment, ...) and the stage's stretch of road and event dressing (`reverse`, `timing`, `closures`, `cornerFans`,
 * `props`). Stage text (name, description, year, tyre, gearing, links) is left out. JSON with sorted keys (moving a
 * property in a file is no change), FNV-1a 32 bit, hex. Data only: a change in the generators / renderers needs a
 * `STAGE_CARD_VERSION` bump instead.
 */
export function stageCardHash(map: MapDef, stage: StageDef): string {
  const world = Object.fromEntries(
    Object.entries(map)
      .filter(([k]) => !NOT_ON_CARD.has(k))
      .map(([k, v]) => [k, k === 'environment' ? drawnEnvironment(v) : v]),
  );
  const { reverse, timing, closures, cornerFans, props } = stage;
  const s = JSON.stringify(
    { world, stage: { reverse, timing, closures, cornerFans, props } },
    (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface StageOverlay {
  group: Group;
  /** The floor disc's colour (a season's card has its own). */
  setFloor(color: Color): void;
  dispose(): void;
}

/**
 * Map view overlay: the stage as a flat orange ribbon (GL lines are 1 px; width scaled to the view so it reads from
 * the air), start / finish poles and a big floor disc so the map doesn't float in the sky.
 */
export function stageOverlay(o: {
  points: Vector3[];
  size: number;
  floor: { x: number; y: number; z: number; radius: number; color: Color };
}): StageOverlay {
  const group = new Group();
  const { points, size } = o;
  const half = size / 320;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / l;
    const tz = (b.z - a.z) / l;
    pos.push(p.x - tz * half, p.y + 2, p.z + tx * half);
    pos.push(p.x + tz * half, p.y + 2, p.z - tx * half);
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  lineGeo.setIndex(idx);
  const lineMat = new MeshBasicMaterial({
    color: 0xf0a020,
    depthTest: false,
    side: DoubleSide,
    fog: false,
  });
  const line = new Mesh(lineGeo, lineMat);
  line.renderOrder = 10;

  const floorGeo = new CircleGeometry(o.floor.radius, 48);
  const floorMat = new MeshBasicMaterial({ color: o.floor.color });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(o.floor.x, o.floor.y, o.floor.z);
  group.add(floor);

  const poleGeo = new CylinderGeometry(4, 4, size * 0.05, 10);
  const poleMats = [0x3ddc6a, 0xff4a3a].map(
    (color) => new MeshBasicMaterial({ color }),
  );
  [points[0], points[points.length - 1]].forEach((p, i) => {
    const m = new Mesh(poleGeo, poleMats[i]);
    m.position.set(p.x, p.y + size * 0.025, p.z);
    group.add(m);
  });
  group.add(line);
  return {
    group,
    setFloor: (color) => floorMat.color.copy(color),
    dispose() {
      lineGeo.dispose();
      lineMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      poleGeo.dispose();
      poleMats.forEach((m) => m.dispose());
    },
  };
}

/** A loaded card: data + the image of one season (decoded). */
export interface StageCard {
  data: StageCardData;
  texture: Texture;
  /** The season of `texture`: the one asked for, or the base one when that season has no image. */
  season: Season;
}

/** The card's data (`maps/<map>/preview/<stage>.json`, lazy chunk per map). */
export async function loadStageCardData(
  mapId: string,
  stageId: string,
): Promise<StageCardData> {
  const json = await import(`../maps/${mapId}/preview/${stageId}.json`);
  return (json.default ?? json) as StageCardData;
}

/** One season's image of a card; null when that season was not baked. */
async function loadSeasonImage(
  mapId: string,
  name: string,
): Promise<Texture | null> {
  try {
    const jpg = await import(`../maps/${mapId}/preview/${name}.jpg`);
    const texture = await new TextureLoader().loadAsync(
      (jpg.default ?? jpg) as string,
    );
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  } catch {
    return null;
  }
}

/**
 * Load a map's card (lazy chunk per map: only the selected map's files are fetched), with the image of `season`
 * (default: the card's own; a season that was not baked shows the own one). Rejects when the map has no card (not baked
 * yet) - the caller then builds the view live.
 */
export async function loadStageCard(
  mapId: string,
  stageId: string,
  season?: Season,
  data?: StageCardData,
): Promise<StageCard> {
  const card = data ?? (await loadStageCardData(mapId, stageId));
  const own = card.season ?? DEFAULT_SEASON;
  const want = season ?? own;
  const image = await loadSeasonImage(mapId, cardImageName(stageId, want));
  if (image) return { data: card, texture: image, season: want };
  const base =
    want !== own
      ? await loadSeasonImage(mapId, cardImageName(stageId, own))
      : null;
  if (!base) throw new Error(`no stage card image for ${stageId}`);
  return { data: card, texture: base, season: own };
}

/** Heights of a card's grid (m). */
export function cardHeights(g: StageCardData['grid']): Float32Array {
  const bin = atob(g.heights);
  const out = new Float32Array(g.nx * g.nz);
  for (let k = 0; k < out.length; k++)
    out[k] =
      g.min +
      (bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8)) * g.step;
  return out;
}

/** Encode heights for `StageCardData.grid` (Uint16 little endian, base64). */
export function encodeHeights(
  h: Float32Array,
  nx: number,
  nz: number,
): StageCardData['grid'] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const step = Math.max(1e-3, (max - min) / 65535);
  let bin = '';
  for (const v of h) {
    const q = Math.round((v - min) / step);
    bin += String.fromCharCode(q & 255, q >> 8);
  }
  return { nx, nz, min, step, heights: btoa(bin) };
}

/**
 * The card's terrain: the grid over `rect` with the baked texture (unlit - the lighting is in the image), heights
 * exaggerated by `relief` around `base`.
 */
export function cardMesh(card: StageCard, relief: number, base: number): Mesh {
  const { rect, grid } = card.data;
  const { nx, nz } = grid;
  const hs = cardHeights(grid);
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const u = i / (nx - 1);
      const v = j / (nz - 1);
      pos[k * 3] = rect.x0 + u * rect.w;
      pos[k * 3 + 1] = base + (hs[k] - base) * relief;
      pos[k * 3 + 2] = rect.z0 + v * rect.h;
      uv[k * 2] = u;
      uv[k * 2 + 1] = 1 - v;
    }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], n);
      n += 6;
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new Mesh(g, new MeshBasicMaterial({ map: card.texture }));
  mesh.name = 'stage card';
  return mesh;
}
