/**
 * Grass, weeds and reeds for the detail layer: crossed cards cut from the plant atlases (engine/plants/*.webp, baked
 * from CC0 Poly Haven plant scans by scripts/plants/bake-plants.mjs) and the blade strips of the grass's near LOD, whose
 * colours are the atlas' measured means so both levels match.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  PlaneGeometry,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { Rng } from '../../../shared/rng';
import { coverageMips } from '../trees/materials';
import { merge } from './geo';
import { PLANT_SHEETS } from './plants/plant-atlas.data';
import greenUrl from './plants/grass-green.webp';
import dryUrl from './plants/grass-dry.webp';
import springUrl from './plants/grass-spring.webp';
import weedsUrl from './plants/weeds.webp';

type RGB = [number, number, number];
export type GrassKind = 'green' | 'dry' | 'spring';
export type PlantSheet = keyof typeof PLANT_SHEETS;

const URLS: Record<PlantSheet, string> = {
  'grass-green': greenUrl,
  'grass-dry': dryUrl,
  'grass-spring': springUrl,
  weeds: weedsUrl,
};

/** The grass sheet of a kind. */
export const GRASS_SHEET: Record<GrassKind, PlantSheet> = {
  green: 'grass-green',
  dry: 'grass-dry',
  spring: 'grass-spring',
};

/** Cells of the sheets (scripts/plants/layout.ts): grass tufts, the weed margin, nettles, reeds. */
export const CELLS = {
  tufts: [0, 1, 2],
  dryTufts: [0, 1, 2, 3],
  margin: 3,
  nettles: [0, 1, 6],
  dryNettles: [2, 3, 7],
  reeds: [4, 5],
} as const;

interface Palette {
  root: RGB;
  tips: RGB[]; // weighted by order: mostly the first
  dead: RGB;
  /** Share of dead (pale) blades. */
  deadShare: number;
}

/**
 * Blade colours (linear) from the sheet's measured means: the roots, the leafy blades around the leaf mean and the
 * pale ones (dead blades, stalks) in their measured share, so the strips average to what the cards show.
 */
function palette(kind: GrassKind): Palette {
  const s = PLANT_SHEETS[GRASS_SHEET[kind]];
  const leaf = s.leaf as unknown as RGB;
  const k = (f: number, warm = 1): RGB => [
    leaf[0] * f * warm,
    leaf[1] * f,
    leaf[2] * f,
  ];
  return {
    root: s.root as unknown as RGB,
    tips: [k(1), k(0.85, 0.95), k(1.15, 1.05), k(0.95, 1.1)],
    dead: s.pale as unknown as RGB,
    deadShare: Math.min(0.5, s.paleShare),
  };
}

const sheets = new Map<PlantSheet, DataTexture>();
const loads = new Map<PlantSheet, Promise<void>>();

/**
 * A plant atlas with coverage-preserving mipmaps (cards do not thin out with distance). Transparent until the webp
 * has decoded (the same texture, its levels filled in place): `plantSheetsReady` resolves then.
 */
export function plantSheet(id: PlantSheet): Texture {
  const t = sheets.get(id);
  if (t) return t;
  const { w, h } = PLANT_SHEETS[id];
  const blank = new Uint8Array(w * h * 4);
  // The full chain from the start: the GPU texture's levels are fixed at its first upload.
  const levels = coverageMips(blank, w, h, false).main;
  const dt = new DataTexture(blank, w, h);
  dt.mipmaps = levels;
  dt.generateMipmaps = false;
  dt.magFilter = LinearFilter;
  dt.minFilter = LinearMipmapLinearFilter;
  dt.colorSpace = SRGBColorSpace;
  dt.anisotropy = 8;
  dt.name = `plants:${id}`;
  dt.needsUpdate = true;
  sheets.set(id, dt);
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const img = new Image();
    img.src = URLS[id];
    loads.set(
      id,
      img.decode().then(
        () => {
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          if (!ctx) return; // no 2D canvas (tests)
          ctx.drawImage(img, 0, 0);
          const data = flipRows(ctx.getImageData(0, 0, w, h).data, w, h);
          const mips = coverageMips(data, w, h, false).main;
          blank.set(data);
          mips.forEach((m, i) => levels[i].data.set(m.data));
          dt.needsUpdate = true;
        },
        () => undefined,
      ),
    );
  }
  return dt;
}

/** The atlases each catalog asset draws from. */
const ASSET_SHEETS: Record<string, PlantSheet> = {
  grass_tuft: 'grass-green',
  dry_grass: 'grass-dry',
  spring_grass: 'grass-spring',
  tall_weeds: 'weeds',
  reeds: 'weeds',
};

/**
 * Starts decoding the atlases these assets (the map's) draw from; resolves when every atlas asked for so far holds its
 * image (the game's load waits for it).
 */
export function plantSheetsReady(assets: Iterable<string>): Promise<void> {
  for (const a of assets) if (ASSET_SHEETS[a]) plantSheet(ASSET_SHEETS[a]);
  return Promise.all(loads.values()).then(() => undefined);
}

/** Rows bottom-up (DataTexture order: v = 0 is the first row). */
function flipRows(d: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(d.length);
  const row = w * 4;
  for (let y = 0; y < h; y++)
    out.set(d.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}

/** A cell's uv rect [u0, v0, u1, v1] (v up) in its sheet. */
export function cellRect(
  id: PlantSheet,
  cell: number,
): [number, number, number, number] {
  const s = PLANT_SHEETS[id];
  const cx = cell % s.cols;
  const cy = Math.floor(cell / s.cols);
  // Half a texel in, so the cells' bled borders never sample the neighbour.
  const iu = 0.5 / s.w;
  const iv = 0.5 / s.h;
  return [
    cx / s.cols + iu,
    1 - (cy + 1) / s.rows + iv,
    (cx + 1) / s.cols - iu,
    1 - cy / s.rows - iv,
  ];
}

/**
 * Crossed plant cards: `planes` cards w x h (m) standing on y = 0, each showing one of `cells` of the sheet. Normals
 * point up (lit like the ground under them), the vertex colour darkens the roots a little and varies the tone.
 */
export function plantCards(
  rng: Rng,
  sheet: PlantSheet,
  cells: readonly number[],
  w: number,
  h: number,
  planes = 3,
  root = 0.7,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const turn = rng.next() * Math.PI;
  for (let i = 0; i < planes; i++) {
    const g = new PlaneGeometry(w, h).toNonIndexed();
    g.translate(0, h / 2, 0);
    g.rotateY(turn + (i * Math.PI) / planes + rng.range(-0.15, 0.15));
    const [u0, v0, u1, v1] = cellRect(
      sheet,
      cells[(i + rng.int(0, cells.length - 1)) % cells.length],
    );
    // Mirror half of the cards (the same cell reads as a new tuft).
    const flip = rng.next() < 0.5;
    const uv = g.getAttribute('uv') as BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      const u = flip ? 1 - uv.getX(k) : uv.getX(k);
      uv.setXY(k, u0 + (u1 - u0) * u, v0 + (v1 - v0) * uv.getY(k));
    }
    const n = g.getAttribute('normal') as BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    const tone = rng.range(0.92, 1.04);
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const c = tone * (root + (1 - root) * Math.min(1, p.getY(k) / (h * 0.6)));
      col[k * 3] = c;
      col[k * 3 + 1] = c;
      col[k * 3 + 2] = c;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    parts.push(g);
  }
  return merge(parts);
}

/** Pushes colour into transparent texels (so filtering never pulls in black), flips rows for a DataTexture. */
export function dilateAndFlip(
  d: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array {
  const src = new Uint8Array(d);
  for (let pass = 0; pass < 8; pass++) {
    const prev = src.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (prev[i + 3] > 0 || (src[i] | src[i + 1] | src[i + 2]) !== 0)
          continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (prev[j + 3] === 0 && (prev[j] | prev[j + 1] | prev[j + 2]) === 0)
            continue;
          r += prev[j];
          g += prev[j + 1];
          b += prev[j + 2];
          n++;
        }
        if (n) {
          src[i] = r / n;
          src[i + 1] = g / n;
          src[i + 2] = b / n;
        }
      }
  }
  const out = new Uint8Array(src.length);
  const row = w * 4;
  for (let y = 0; y < h; y++)
    out.set(src.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}

/**
 * Near LOD: real blade strips (no alpha test, no card edges from any side), fanned out of 5 crowns over the cards' footprint, curved and
 * tapered, vertex colour root -> tip. blades * 6 triangles (one-sided strips, the material is DoubleSide).
 */
export function bladeTuftGeometry(
  seed: number,
  kind: GrassKind,
  width: number,
  height: number,
  blades = 72,
): BufferGeometry {
  const p = palette(kind);
  const rng = new Rng(seed);
  const seg = 3;
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  // Crowns across the card's footprint (the cards' tufts fill about 0.8 of their width).
  const crowns = Array.from({ length: 5 }, () => [
    rng.range(-0.3, 0.3) * width,
    rng.range(-0.15, 0.15) * width,
  ]);
  for (let b = 0; b < blades; b++) {
    const [ox, oz] = crowns[b % crowns.length];
    // Root spread inside the crown; the blade leans away from the crown centre (a fountain, not a brush).
    const ra = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.next()) * 0.07;
    const cx = ox + Math.cos(ra) * rr;
    const cz = oz + Math.sin(ra) * rr;
    const yaw = ra + rng.range(-0.5, 0.5);
    const outer = rr / 0.07;
    const lean = 0.15 + outer * 0.75 + rng.range(-0.1, 0.15);
    const len = height * rng.range(0.55, 1.1) * (1 - outer * 0.3);
    const bw = rng.range(0.012, 0.022);
    const tipC =
      rng.next() < p.deadShare
        ? p.dead
        : p.tips[Math.floor(rng.next() ** 1.8 * p.tips.length)];
    const l = rng.range(0.8, 1.1) * (outer < 0.4 ? 0.85 : 1);
    const dx = Math.cos(yaw),
      dz = Math.sin(yaw);
    // Blade faces sideways to its lean direction.
    const sx = -dz,
      sz = dx;
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const bend = lean * t * t * len;
      const x = cx + dx * (bend + rng.range(-0.004, 0.004));
      const z = cz + dz * bend;
      const y = len * t * (1 - lean * t * 0.35);
      const half = (bw * (1 - t * 0.95)) / 2;
      pos.push(
        x - sx * half,
        y,
        z - sz * half,
        x + sx * half,
        y,
        z + sz * half,
      );
      const c = mix(p.root, tipC, 0.3 + 0.7 * Math.min(1, t * 1.3));
      for (let k = 0; k < 2; k++) {
        col.push(c[0] * l, c[1] * l, c[2] * l);
        nrm.push(0, 1, 0);
      }
      // The tip is 5 % of the base width: its segment is one triangle (to the left tip vertex), not a quad.
      if (i < seg - 1) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      } else if (i === seg - 1) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  // Unused (the blade material has no map); merged variant sets expect the attribute.
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  g.setIndex(idx);
  return g;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
