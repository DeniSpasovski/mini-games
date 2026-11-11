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
import reedsUrl from './plants/reeds.webp';
import fernsUrl from './plants/ferns.webp';
import fernsAutumnUrl from './plants/ferns-autumn.webp';

type RGB = [number, number, number];
export type GrassKind = 'green' | 'dry' | 'spring';
export type PlantSheet = keyof typeof PLANT_SHEETS;

const URLS: Record<PlantSheet, string> = {
  'grass-green': greenUrl,
  'grass-dry': dryUrl,
  'grass-spring': springUrl,
  weeds: weedsUrl,
  reeds: reedsUrl,
  ferns: fernsUrl,
  'ferns-autumn': fernsAutumnUrl,
};

/** The grass sheet of a kind. */
export const GRASS_SHEET: Record<GrassKind, PlantSheet> = {
  green: 'grass-green',
  dry: 'grass-dry',
  spring: 'grass-spring',
};

/**
 * Cells of the sheets (scripts/plants/layout.ts): grass tufts, the weed margin, nettles (weed cells 4, 5 are unused),
 * reed beds and cattails (the reeds sheet).
 */
export const CELLS = {
  tufts: [0, 1, 2],
  dryTufts: [0, 1, 2, 3],
  margin: 3,
  nettles: [0, 1, 6],
  dryNettles: [2, 3, 7],
  reeds: [0, 1, 2, 3, 4, 5],
  cattails: [6, 7],
  ferns: [0, 1, 2, 3],
} as const;

interface Palette {
  root: RGB;
  tips: RGB[]; // weighted by order: mostly the first
  dead: RGB;
  /** Share of dead (pale) blades. */
  deadShare: number;
}

/**
 * Colour gain (linear) of each sheet's cards (the material colour) and of the blade strips made from its means: the
 * scans brought into the measured bands (trees/Foliage.md; ground tiles, engine/ground): summer grass olive at luminance
 * ~0.12, a little above the grass ground; spring the flush band (~0.14, yellower); dry grass pale straw (red / green
 * ~1.1, blue / green ~0.45, ~0.3; scripts/plants/pack.py already tones the scan's orange down); nettles a touch less
 * blue-starved; reeds (green with pale plumes and dead leaves) about the grass, the plumes and cattail heads brown,
 * not black; ferns a deep shade green under the grass (they stand under the crowns), dead bracken rust brown.
 */
export const SHEET_GAIN: Record<PlantSheet, RGB> = {
  'grass-green': [1.15, 1.3, 1.2],
  'grass-dry': [1.38, 1.42, 1.26],
  'grass-spring': [1.4, 1.2, 1.25],
  weeds: [1.1, 1.15, 1.15],
  reeds: [0.95, 1.05, 0.95],
  ferns: [1.0, 1.0, 1.4],
  'ferns-autumn': [1.0, 1.0, 1.0],
};

/**
 * The cards' extra lift over `SHEET_GAIN` (their vertex colour darkens the roots, the scans carry their own shading):
 * green and spring cards a little lighter, so they meet the blade strips at the level switch (green more: pack.py
 * pulls its pale seed stalks towards the leaf colour, which darkens the sheet).
 */
const CARD_LIFT: Partial<Record<PlantSheet, RGB>> = {
  'grass-green': [1.5, 1.35, 1.5],
  'grass-spring': [1.06, 1.02, 1.0],
};

/** A sheet's card material colour (linear): its gain x the card lift. */
export function cardColor(id: PlantSheet): RGB {
  const g = SHEET_GAIN[id];
  const l = CARD_LIFT[id] ?? [1, 1, 1];
  return [g[0] * l[0], g[1] * l[1], g[2] * l[2]];
}

/**
 * Blade colours (linear) from the sheet's measured means x its gain: roots between the measured root band and the
 * shaded blade (the cards' roots are mostly blade, a few pale stems), the blades around the leaf mean and the pale
 * ones (dead blades) at half their texel share (a whole pale blade reads much yellower than the cards' thin stalks).
 * A mostly pale sheet (dry grass) turns it round: straw blades around the pale mean, a quarter of greyer old straw.
 */
function palette(kind: GrassKind): Palette {
  const id = GRASS_SHEET[kind];
  const s = PLANT_SHEETS[id];
  const g = SHEET_GAIN[id];
  const straw = s.paleShare > 0.5;
  const leaf = (straw ? s.pale : s.leaf) as unknown as RGB;
  const root = s.root as unknown as RGB;
  const pale = (straw ? s.pale.map((c) => c * 0.75) : s.pale) as unknown as RGB;
  const k = (f: number, warm = 1): RGB => [
    leaf[0] * f * warm * g[0],
    leaf[1] * f * g[1],
    leaf[2] * f * g[2],
  ];
  return {
    root: [0, 1, 2].map(
      (i) => (root[i] * 0.5 + leaf[i] * 0.35) * g[i],
    ) as unknown as RGB,
    tips: [k(1), k(0.85, 0.95), k(1.15, 1.05), k(0.95, 1.1)],
    dead: [pale[0] * g[0], pale[1] * g[1], pale[2] * g[2]],
    deadShare: straw ? 0.25 : Math.min(0.5, s.paleShare) * 0.5,
  };
}

/** Weed-margin flowers on the blade strips (linear): dandelion yellow, its stalk and leaves the sheet's leaf. */
const FLOWER: RGB = [0.62, 0.42, 0.02];

const sheets = new Map<PlantSheet, DataTexture>();
const loads = new Map<PlantSheet, Promise<void>>();

/**
 * A plant atlas with coverage-preserving mipmaps (cards do not thin out with distance). Nothing is uploaded until the
 * webp has decoded (three binds an empty texture: the cards are invisible), then the image and its mips go up once;
 * `plantSheetsReady` resolves then. A sheet that fails to load is reported and replaced by plain painted blades.
 */
export function plantSheet(id: PlantSheet): Texture {
  const t = sheets.get(id);
  if (t) return t;
  const { w, h } = PLANT_SHEETS[id];
  const dt = new DataTexture(null, w, h);
  dt.generateMipmaps = false;
  dt.magFilter = LinearFilter;
  dt.minFilter = LinearMipmapLinearFilter;
  dt.colorSpace = SRGBColorSpace;
  dt.anisotropy = 8;
  dt.name = `plants:${id}`;
  sheets.set(id, dt);
  const fill = (data: Uint8Array) => {
    dt.image = { data, width: w, height: h };
    dt.mipmaps = coverageMips(data, w, h, false).main;
    dt.needsUpdate = true;
  };
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
          fill(flipRows(ctx.getImageData(0, 0, w, h).data, w, h));
        },
        (e: unknown) => {
          console.error(`plants: ${URLS[id]} failed to load`, e);
          fill(fallbackSheet(id));
        },
      ),
    );
  }
  return dt;
}

/** Stand-in for a sheet that did not load: every cell a tuft of plain blades in the sheet's measured leaf colour. */
function fallbackSheet(id: PlantSheet): Uint8Array {
  const s = PLANT_SHEETS[id];
  const out = new Uint8Array(s.w * s.h * 4);
  const cw = s.w / s.cols;
  const ch = s.h / s.rows;
  const srgb = (c: number) =>
    Math.round(
      255 *
        Math.min(
          1,
          c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055,
        ),
    );
  const leaf = (s.leaf as readonly number[]).map(srgb);
  const rng = new Rng(7);
  for (let cell = 0; cell < s.cols * s.rows; cell++) {
    const x0 = (cell % s.cols) * cw;
    const y0 = (s.rows - 1 - Math.floor(cell / s.cols)) * ch; // row 0 = the bottom (DataTexture order)
    for (let b = 0; b < 60; b++) {
      const bx = x0 + cw * rng.range(0.15, 0.85);
      const top = ch * rng.range(0.3, 0.9);
      const half = cw * 0.006;
      for (let y = 0; y < top; y++) {
        const r = half * (1 - y / top) + 0.5;
        for (let x = Math.floor(bx - r); x <= Math.ceil(bx + r); x++) {
          const o = ((y0 + y) * s.w + x) * 4;
          out[o] = leaf[0];
          out[o + 1] = leaf[1];
          out[o + 2] = leaf[2];
          out[o + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** The atlases each catalog asset draws from. */
const ASSET_SHEETS: Record<string, PlantSheet[]> = {
  grass_tuft: ['grass-green'],
  dry_grass: ['grass-dry'],
  spring_grass: ['grass-spring'],
  tall_grass: ['grass-dry', 'grass-green'],
  tall_weeds: ['weeds'],
  reeds: ['reeds'],
  fern: ['ferns'],
  fern_autumn: ['ferns-autumn'],
};

/**
 * Starts decoding the atlases these assets (the map's) draw from; resolves when every atlas asked for so far holds its
 * image (the game's load waits for it).
 */
export function plantSheetsReady(assets: Iterable<string>): Promise<void> {
  for (const a of assets) for (const s of ASSET_SHEETS[a] ?? []) plantSheet(s);
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
  flowers = 0,
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
  // The weed margin (the cards' margin cell): dandelions, a head on a stalk each, over a rosette of broad leaves.
  for (let f = 0; f < flowers; f++) {
    const [ox, oz] = crowns[f % crowns.length];
    const x = ox + rng.range(-0.08, 0.08);
    const z = oz + rng.range(-0.08, 0.08);
    const top = height * rng.range(0.45, 0.8);
    const lean = rng.range(-0.04, 0.04);
    const leafC = p.tips[0];
    // Stalk: a thin vertical strip.
    let base = pos.length / 3;
    for (const [px, py] of [
      [x - 0.003, 0],
      [x + 0.003, 0],
      [x - 0.002 + lean, top],
      [x + 0.002 + lean, top],
    ]) {
      pos.push(px, py, z);
      col.push(...leafC);
      nrm.push(0, 1, 0);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    // Head: a flat ragged disc (10 points, petal tips and gaps) facing up a little tilted.
    base = pos.length / 3;
    const r = rng.range(0.015, 0.022);
    const tilt = rng.range(0.2, 0.5);
    const hx = x + lean;
    pos.push(hx, top + 0.006, z);
    col.push(FLOWER[0] * 0.85, FLOWER[1] * 0.85, FLOWER[2]);
    nrm.push(0, 1, 0);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const rk = r * (k % 2 ? 0.7 : 1);
      pos.push(
        hx + Math.cos(a) * rk,
        top + Math.sin(a) * rk * tilt,
        z + Math.sin(a) * rk * Math.sqrt(1 - tilt * tilt),
      );
      col.push(...FLOWER);
      nrm.push(0, 1, 0);
    }
    for (let k = 0; k < 10; k++)
      idx.push(base, base + 1 + k, base + 1 + ((k + 1) % 10));
    // Rosette: three broad leaves flat on the ground around the stalk.
    for (let l = 0; l < 3; l++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(0.1, 0.16);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const lb = pos.length / 3;
      for (const [t, wd] of [
        [0, 0.004],
        [0.5, 0.022],
        [1, 0.002],
      ]) {
        const cx = x + dx * len * t;
        const cz = z + dz * len * t;
        const y = 0.01 + 0.03 * t;
        pos.push(cx + dz * wd, y, cz - dx * wd, cx - dz * wd, y, cz + dx * wd);
        for (let k = 0; k < 2; k++) {
          col.push(leafC[0] * 0.8, leafC[1] * 0.8, leafC[2] * 0.8);
          nrm.push(0, 1, 0);
        }
      }
      idx.push(
        lb,
        lb + 1,
        lb + 2,
        lb + 1,
        lb + 3,
        lb + 2,
        lb + 2,
        lb + 3,
        lb + 4,
        lb + 3,
        lb + 5,
        lb + 4,
      );
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
