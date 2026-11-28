import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { FACADE_DEFS, type FacadeId } from './facade-textures';
import { LOT_DEFS, type LotTextureId } from './lot-textures';
import {
  drawPeopleAtlas,
  drawPeopleNormal,
  PEOPLE_ATLAS_SIZE,
} from './people-atlas';

/**
 * Procedural texture library. Every texture is generated once on a canvas
 * (tileable value-noise + painted details) and cached by id, so all materials
 * share the same GPU texture. Swap any generator for an image later by
 * returning a loaded texture from the same id.
 *
 * Browse them in the asset debugger (category "textures").
 */
export type TextureId =
  | 'grass'
  | 'dirt'
  | 'rock'
  | 'gravel'
  | 'rail_track'
  | 'road'
  | 'road_tarmac'
  | 'road_tarmac_kerbed'
  | 'road_tarmac_plain_kerbed'
  | 'road_tarmac_junction'
  | 'road_tarmac_plain_junction'
  | 'road_tarmac_lines'
  | 'road_tarmac_new'
  | 'road_patch'
  | 'road_cracks'
  | 'road_tarmac_plain'
  | 'road_paint'
  | 'road_arrow_left'
  | 'road_arrow_straight'
  | 'road_parkway'
  | 'road_street'
  | 'road_street4'
  | 'road_city'
  | 'asphalt_street'
  | 'asphalt_highway'
  | 'asphalt_parkway'
  | 'concrete_highway'
  | 'junction_asphalt'
  | 'sidewalk'
  | 'crosswalk'
  | 'gore'
  | 'hatch'
  | 'barrier_jersey'
  | 'bridge_stone'
  | 'bridge_concrete'
  | 'barrier_rail'
  | 'vehicle_decals'
  | 'taxi_sign'
  | 'village_sign'
  | 'detail'
  | 'people'
  | 'people_normal'
  | 'flag_mk'
  | 'macro'
  | 'bark_pine'
  | 'bark_birch'
  | 'chevron'
  | 'chevron_us'
  | 'us_signs'
  | 'water_normal'
  | FacadeId
  | LotTextureId;

interface TexDef {
  name: string;
  size: [number, number];
  color: boolean;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

const cache = new Map<TextureId, Texture>();
let anisotropy = 8;

export function setTextureAnisotropy(n: number): void {
  anisotropy = n;
  for (const t of cache.values()) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

/** Textures drawn with text: the fonts of a worker are not the page's, so these are always drawn here. */
const TEXT_TEXTURES = new Set<TextureId>([
  'vehicle_decals',
  'taxi_sign',
  'village_sign',
  'lot_sign_mileks',
  'lot_sign_station',
]);

/** Whether a worker may draw this texture (engine/texture-prefetch.ts): not text, and not the facades (they draw decoded scans). */
export const drawableInWorker = (id: TextureId): boolean =>
  !TEXT_TEXTURES.has(id) && !(id in FACADE_DEFS);

export const textureSize = (id: TextureId): [number, number] => DEFS[id].size;

/** Draws a texture on any 2D context (the page's canvas, or a worker's OffscreenCanvas). */
export function drawTexture(
  id: TextureId,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  DEFS[id].draw(ctx, w, h);
}

/** Textures drawn in a worker and waiting for their first `getTexture`. */
const drawn = new Map<TextureId, ImageBitmap>();

/** A texture drawn elsewhere (a worker) stands for the first draw of `getTexture(id)`; ignored when it came too late. */
export function primeTexture(id: TextureId, bitmap: ImageBitmap): void {
  if (cache.has(id)) bitmap.close();
  else drawn.set(id, bitmap);
}

/** Whether `id` names a texture (a stored list may hold an old name). */
export const isTexture = (id: string): id is TextureId => id in DEFS;

/** Ids of every texture made so far (engine/texture-prefetch.ts remembers them per map). */
export const madeTextures = (): TextureId[] => [...cache.keys()];

export function getTexture(id: TextureId): Texture {
  let t = cache.get(id);
  if (!t) {
    const def = DEFS[id];
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = def.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const bitmap = drawn.get(id);
    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      drawn.delete(id);
    } else def.draw(ctx, canvas.width, canvas.height);
    t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = anisotropy;
    if (def.color) t.colorSpace = SRGBColorSpace;
    t.name = id;
    cache.set(id, t);
  }
  return t;
}

export const TEXTURE_IDS = (): TextureId[] => Object.keys(DEFS) as TextureId[];
export const textureName = (id: TextureId) => DEFS[id].name;

// --- noise helpers ---------------------------------------------------------------

/** Tileable value-noise fbm, returns size*size values in [0,1]. */
function tileNoise(
  w: number,
  h: number,
  period: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const px = period << o;
    const py = Math.max(1, Math.round((period * h) / w)) << o;
    for (let y = 0; y < h; y++) {
      const v = (y / h) * py;
      const j0 = Math.floor(v);
      const fy = v - j0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const u = (x / w) * px;
        const i0 = Math.floor(u);
        const fx = u - i0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = lattice(i0 % px, j0 % py, o, seed);
        const b = lattice((i0 + 1) % px, j0 % py, o, seed);
        const c = lattice(i0 % px, (j0 + 1) % py, o, seed);
        const d = lattice((i0 + 1) % px, (j0 + 1) % py, o, seed);
        out[y * w + x] +=
          amp * (a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy);
      }
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function lattice(i: number, j: number, o: number, seed: number): number {
  return hash3(i, j, o, seed) / 4294967296;
}

type RGB = [number, number, number];

function fillNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colorAt: (n: number, n2: number, x: number, y: number) => RGB,
  period: number,
  seed: number,
): void {
  const n1 = tileNoise(w, h, period, 5, seed);
  const n2 = tileNoise(w, h, period * 4, 3, seed + 99);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = colorAt(n1[i], n2[i], i % w, Math.floor(i / w));
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Draw a shape at all wrap offsets so it tiles seamlessly. */
function wrapDraw(
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  draw: (x: number, y: number) => void,
): void {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
      draw(px, py);
    }
  }
}

function stones(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  count: number,
  size: [number, number],
  seed: number,
  palette: RGB[],
  density?: (x: number, y: number) => number,
): void {
  const rng = new Rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    if (density && rng.next() > density(x / w, y / h)) continue;
    const r = rng.range(size[0], size[1]);
    const rx = r * rng.range(0.7, 1.3);
    const ry = r * rng.range(0.6, 1.1);
    const rot = rng.next() * Math.PI;
    const c = rng.pick(palette);
    const l = rng.range(0.8, 1.15);
    wrapDraw(w, h, x, y, r * 1.5, (px, py) => {
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(px + r * 0.25, py + r * 0.3, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${c[0] * l},${c[1] * l},${c[2] * l})`;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(
        px - rx * 0.25,
        py - ry * 0.3,
        rx * 0.45,
        ry * 0.35,
        rot,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }
}

/** A wandering polyline (random walk from (x, y) heading `ang`), drawn at every wrap offset so the tile stays seamless. */
function wanderStroke(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: Rng,
  x: number,
  y: number,
  ang: number,
  len: number,
  stepPx: number,
  turn: number,
): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  for (let s = 0; s < len; s += stepPx) {
    ang += rng.range(-turn, turn);
    x += Math.cos(ang) * stepPx;
    y += Math.sin(ang) * stepPx;
    pts.push([x, y]);
  }
  for (const ox of [-w, 0, w])
    for (const oy of [-h, 0, h]) {
      ctx.beginPath();
      pts.forEach(([px, py], j) =>
        j ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy),
      );
      ctx.stroke();
    }
  return pts;
}

/**
 * NYC street wear: crack sealant ("tar snakes", glossy black bands that wander along old cracks, mostly across the
 * lane) and hairline cracks. `k` = pixels per 1/512 of the tile (the details keep their size in metres at any resolution).
 * `across`: share of transverse cracks (u = across the street, v = along it); 0.5 = no direction (junction boxes).
 */
function streetCracks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  o: { snakes: number; cracks: number; across: number },
): void {
  const k = w / 512;
  const rng = new Rng(seed);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < o.snakes; i++) {
    const across = rng.chance(o.across);
    const ang = across
      ? rng.range(-0.25, 0.25) + (rng.chance(0.5) ? 0 : Math.PI)
      : Math.PI / 2 + rng.range(-0.25, 0.25);
    const x = rng.next() * w;
    const y = rng.next() * h;
    const len = rng.range(70, 300) * k;
    const bw = rng.range(2, 4.2) * k;
    ctx.strokeStyle = `rgba(16,16,18,${rng.range(0.32, 0.52)})`;
    ctx.lineWidth = bw;
    const r2 = new Rng(seed * 31 + i);
    const pts = wanderStroke(ctx, w, h, r2, x, y, ang, len, 5 * k, 0.32);
    // the sheen along the band's upper edge (fresh sealant is glossy)
    ctx.strokeStyle = 'rgba(150,150,160,0.07)';
    ctx.lineWidth = bw * 0.35;
    for (const ox of [-w, 0, w])
      for (const oy of [-h, 0, h]) {
        ctx.beginPath();
        pts.forEach(([px, py], j) =>
          j
            ? ctx.lineTo(px + ox - bw * 0.2, py + oy - bw * 0.2)
            : ctx.moveTo(px + ox - bw * 0.2, py + oy - bw * 0.2),
        );
        ctx.stroke();
      }
    // a branch now and then
    if (rng.chance(0.4)) {
      const [bx, by] = pts[Math.floor(pts.length / 2)];
      ctx.strokeStyle = `rgba(16,16,18,${rng.range(0.28, 0.45)})`;
      ctx.lineWidth = bw * 0.8;
      wanderStroke(
        ctx,
        w,
        h,
        r2,
        bx,
        by,
        ang + rng.range(0.8, 1.4) * (rng.chance(0.5) ? 1 : -1),
        len * 0.4,
        5 * k,
        0.35,
      );
    }
  }
  for (let i = 0; i < o.cracks; i++) {
    const across = rng.chance(o.across);
    const ang = across
      ? rng.range(-0.4, 0.4)
      : Math.PI / 2 + rng.range(-0.4, 0.4);
    ctx.strokeStyle = `rgba(24,24,26,${rng.range(0.22, 0.4)})`;
    ctx.lineWidth = rng.range(0.8, 1.5) * k;
    wanderStroke(
      ctx,
      w,
      h,
      new Rng(seed * 17 + i),
      rng.next() * w,
      rng.next() * h,
      ang,
      rng.range(25, 110) * k,
      3 * k,
      0.6,
    );
  }
}

/** Smooth dark city asphalt: wheel paths, patches, tar seams, aggregate (shared by the street textures). */
function drawCityAsphalt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
): void {
  const track = (u: number) =>
    Math.max(0, 1 - Math.abs(u - 0.3) / 0.1, 1 - Math.abs(u - 0.7) / 0.1);
  fillNoise(
    ctx,
    w,
    h,
    (n, n2, x) => {
      const t = track(x / w);
      let c = mix([66, 66, 68], [100, 99, 97], n * 0.55 + n2 * 0.45);
      c = mix(c, [54, 54, 56], t * 0.4);
      return c;
    },
    16,
    seed,
  );
  const k = w / 512;
  const rng = new Rng(seed + 1);
  // Utility-cut patches (darker, straight edged) and tar seams.
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(28,28,30,${rng.range(0.16, 0.34)})`;
    ctx.fillRect(
      rng.range(0.03, 0.6) * w,
      rng.next() * h,
      rng.range(0.15, 0.45) * w,
      rng.range(12, 60) * k,
    );
  }
  ctx.strokeStyle = 'rgba(20,20,22,0.55)';
  for (let i = 0; i < 7; i++) {
    const y = rng.next() * h;
    ctx.lineWidth = rng.range(1, 2.2) * k;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32 * k)
      ctx.lineTo(x, y + rng.range(-3, 3) * k);
    ctx.stroke();
  }
  streetCracks(ctx, w, h, seed + 3, { snakes: 4, cracks: 8, across: 0.7 });
  stones(ctx, w, h, Math.round(5200 * k * k), [0.5 * k, 1.1 * k], seed + 2, [
    [60, 60, 62],
    [130, 128, 122],
  ]);
}

/**
 * Asphalt with no paint and no wheel tracks: the same picture at any street width (the texture coordinates are metres).
 * `dark` 1 = parkway / ramp surface (darker, smoother).
 */
function baseAsphalt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  o: {
    dark: 0 | 1;
    patches: number;
    seams: number;
    snakes?: number;
    /** Fine, low-contrast aggregate without the bright polished specks (a calm parkway surface). */
    fine?: boolean;
  },
): void {
  const k = w / 512;
  const lo: RGB = o.dark ? [58, 58, 60] : [66, 66, 68];
  const hi: RGB = o.dark ? [92, 91, 90] : [102, 101, 99];
  fillNoise(ctx, w, h, (n, n2) => mix(lo, hi, n * 0.55 + n2 * 0.45), 16, seed);
  const rng = new Rng(seed + 1);
  // Utility-cut patches (darker, straight edged, a tar seam round them) and tar seams.
  for (let i = 0; i < o.patches; i++) {
    const x = rng.range(0.02, 0.6) * w;
    const y = rng.next() * h;
    const pw = rng.range(0.15, 0.4) * w;
    const ph = rng.range(12, 56) * k;
    ctx.fillStyle = `rgba(28,28,30,${rng.range(0.05, 0.12)})`;
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = 'rgba(16,16,18,0.35)';
    ctx.lineWidth = 1.5 * k;
    ctx.strokeRect(x, y, pw, ph);
  }
  ctx.strokeStyle = 'rgba(20,20,22,0.5)';
  for (let i = 0; i < o.seams; i++) {
    const y = rng.next() * h;
    ctx.lineWidth = rng.range(1, 2) * k;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32 * k)
      ctx.lineTo(x, y + rng.range(-3, 3) * k);
    ctx.stroke();
  }
  streetCracks(ctx, w, h, seed + 3, {
    snakes: o.snakes ?? (o.dark ? 2 : 5),
    cracks: o.dark ? 5 : 10,
    across: 0.7,
  });
  if (o.fine) {
    stones(ctx, w, h, Math.round(2600 * k * k), [0.3 * k, 0.7 * k], seed + 2, [
      [62, 62, 64],
      [96, 95, 93],
    ]);
    return;
  }
  stones(ctx, w, h, Math.round(5200 * k * k), [0.5 * k, 1.1 * k], seed + 2, [
    [60, 60, 62],
    [130, 128, 122],
  ]);
  // polished aggregate: a few bright specks
  stones(ctx, w, h, Math.round(380 * k * k), [0.3 * k, 0.6 * k], seed + 4, [
    [168, 166, 160],
  ]);
}

/** Wear specks over painted lines at the given u positions. */
function wearOver(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  us: number[],
  seed: number,
): void {
  const rng = new Rng(seed);
  const k = w / 512;
  for (let i = 0; i < 1800 * k * k; i++) {
    const u = rng.pick(us);
    ctx.fillStyle = `rgba(${70 + rng.int(0, 30)},${70 + rng.int(0, 30)},${72 + rng.int(0, 30)},${rng.range(0.3, 0.8)})`;
    ctx.fillRect(
      u * w + rng.range(-12, 12) * k,
      rng.next() * h,
      rng.range(1, 3) * k,
      rng.range(1, 4) * k,
    );
  }
}

/** The road paint of the lane lines and arrows: the colour of the road textures' own lines. */
const ROAD_PAINT = '#d6d6ce';

/** Wear on alpha road paint: `count` bald specks and short gaps cut out of it (a few of them wider). */
function wornPaint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  count: number,
): void {
  const rng = new Rng(seed);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.5, 1)})`;
    ctx.fillRect(
      rng.next() * w,
      rng.next() * h,
      rng.range(1, w / 10),
      rng.range(1, h / 40),
    );
  }
  ctx.globalCompositeOperation = 'source-over';
}

// --- definitions ---------------------------------------------------------------------

const GRAVEL_PALETTE: RGB[] = [
  [150, 140, 125],
  [128, 120, 108],
  [170, 160, 140],
  [112, 104, 96],
  [160, 146, 120],
  [95, 90, 86],
];

const DEFS: Record<TextureId, TexDef> = {
  ...FACADE_DEFS,
  ...LOT_DEFS,
  grass: {
    name: 'Grass',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      const dark: RGB = [52, 66, 30];
      const light: RGB = [104, 112, 54];
      const dry: RGB = [128, 120, 70];
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix(mix(dark, light, n), dry, Math.max(0, n2 - 0.55) * 1.6),
        8,
        11,
      );
      const rng = new Rng(5);
      for (let i = 0; i < 9000; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const len = rng.range(3, 9);
        const a = rng.range(-0.5, 0.5) - Math.PI / 2;
        const l = rng.range(0.6, 1.4);
        ctx.strokeStyle = `rgba(${70 * l},${88 * l},${38 * l},0.55)`;
        ctx.lineWidth = rng.range(0.8, 1.6);
        wrapDraw(w, h, x, y, len, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
          ctx.stroke();
        });
      }
    },
  },
  dirt: {
    name: 'Dirt',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([82, 62, 44], [128, 102, 74], n * 0.8 + n2 * 0.2),
        6,
        21,
      );
      stones(ctx, w, h, 220, [0.8, 2.2], 22, [
        [110, 96, 80],
        [140, 124, 104],
        [80, 70, 60],
      ]);
    },
  },
  rock: {
    name: 'Rock',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      const n3 = tileNoise(w, h, 16, 3, 33);
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x, y) => {
          const crack = Math.max(0, 1 - Math.abs(n3[y * w + x] - 0.5) * 18);
          return mix(
            mix([92, 90, 86], [150, 146, 138], n),
            [50, 48, 46],
            crack * 0.7 + (1 - n2) * 0.15,
          );
        },
        5,
        31,
      );
    },
  },
  gravel: {
    name: 'Gravel',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([118, 108, 94], [150, 138, 118], n * 0.7 + n2 * 0.3),
        10,
        41,
      );
      stones(ctx, w, h, 5200, [1.2, 3.2], 42, GRAVEL_PALETTE);
    },
  },
  rail_track: {
    // u (x) across the ballast bed (4.8 m, toe to toe), v (y) along it (1.2 m: two concrete sleepers). The stones
    // between the sleepers come from the gravel scan (world/rail-mesh.ts); this is their tone.
    name: 'Railway track bed',
    size: [512, 256],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([92, 90, 88], [128, 124, 118], n * 0.7 + n2 * 0.3),
        8,
        71,
      );
      const pxU = w / 4.8;
      const pxV = h / 1.2;
      // Rust-stained ballast under the rails (brake dust).
      for (const r of [2.4 - 0.7175, 2.4 + 0.7175]) {
        const g = ctx.createLinearGradient(
          (r - 0.5) * pxU,
          0,
          (r + 0.5) * pxU,
          0,
        );
        g.addColorStop(0, 'rgba(110,62,34,0)');
        g.addColorStop(0.5, 'rgba(110,62,34,0.35)');
        g.addColorStop(1, 'rgba(110,62,34,0)');
        ctx.fillStyle = g;
        ctx.fillRect((r - 0.5) * pxU, 0, pxU, h);
      }
      // Concrete sleepers (2.6 x 0.24 m), shadow on the far side, fastening clips at the rails.
      const rng = new Rng(73);
      for (const v of [0.3, 0.9]) {
        const y0 = (v - 0.12) * pxV;
        const sh = 0.24 * pxV;
        const x0 = (2.4 - 1.3) * pxU;
        const sw = 2.6 * pxU;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x0 + 2, y0 + sh, sw, 0.04 * pxV);
        const l = rng.range(0.92, 1.05);
        ctx.fillStyle = `rgb(${158 * l},${154 * l},${146 * l})`;
        ctx.fillRect(x0, y0, sw, sh);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x0, y0, sw, sh * 0.25);
        for (const r of [2.4 - 0.7175, 2.4 + 0.7175]) {
          ctx.fillStyle = '#3b3632';
          ctx.fillRect((r - 0.16) * pxU, y0 + sh * 0.2, 0.32 * pxU, sh * 0.6);
        }
      }
    },
  },
  road: {
    name: 'Gravel road',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      // u (x) runs across the road, v (y) along it. Two compacted wheel ruts.
      const rut = (u: number) =>
        Math.max(
          0,
          1 - Math.abs(u - 0.29) / 0.09,
          1 - Math.abs(u - 0.71) / 0.09,
        );
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x) => {
          const u = x / w;
          const r = rut(u);
          const edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.06);
          let c = mix([128, 116, 100], [158, 146, 126], n * 0.7 + n2 * 0.3);
          c = mix(c, [96, 88, 78], r * 0.55);
          return mix(c, [110, 100, 84], edge * 0.4);
        },
        8,
        51,
      );
      // Loose stones mostly outside the ruts (thrown to the centre and edges).
      stones(
        ctx,
        w,
        h,
        6500,
        [1.1, 3.0],
        52,
        GRAVEL_PALETTE,
        (u) => 0.25 + 0.75 * (1 - rut(u)),
      );
      // Longitudinal tyre streaks inside the ruts.
      const rng = new Rng(53);
      for (let i = 0; i < 260; i++) {
        const base = rng.chance(0.5) ? 0.29 : 0.71;
        const x = (base + rng.range(-0.07, 0.07)) * w;
        const y = rng.next() * h;
        const len = rng.range(30, 140);
        ctx.strokeStyle = `rgba(60,55,50,${rng.range(0.05, 0.16)})`;
        ctx.lineWidth = rng.range(1, 3);
        wrapDraw(w, h, x, y, len, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + rng.range(-2, 2), py + len);
          ctx.stroke();
        });
      }
    },
  },
  road_street: {
    name: 'City street asphalt with a double yellow centre line (8 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      drawCityAsphalt(ctx, w, h, 101);
      // Double yellow centre line.
      const k = w / 512;
      ctx.fillStyle = '#d2a82a';
      ctx.fillRect(w * 0.5 - 9 * k, 0, 5 * k, h);
      ctx.fillRect(w * 0.5 + 4 * k, 0, 5 * k, h);
      wearOver(ctx, w, h, [0.5], 102);
    },
  },
  road_street4: {
    name: 'Four-lane city street: double yellow centre line, white dashed lane lines (3 m dash, 9 m gap; 12 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      drawCityAsphalt(ctx, w, h, 106);
      const k = w / 512;
      ctx.fillStyle = '#d2a82a';
      ctx.fillRect(w * 0.5 - 6 * k, 0, 3 * k, h);
      ctx.fillRect(w * 0.5 + 3 * k, 0, 3 * k, h);
      ctx.fillStyle = '#d8d8d2';
      for (const u of [0.26, 0.74])
        ctx.fillRect(w * u - 2 * k, 0, 4 * k, h / 4);
      wearOver(ctx, w, h, [0.26, 0.5, 0.74], 107);
    },
  },
  road_city: {
    name: 'City side street asphalt, no markings (8 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      drawCityAsphalt(ctx, w, h, 111);
    },
  },
  asphalt_street: {
    name: 'City street asphalt, no paint and no wheel tracks (8 x 8 m per repeat): tiles at true scale on any street width, the marking layer draws the lines',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      baseAsphalt(ctx, w, h, 151, { dark: 0, patches: 4, seams: 6 });
    },
  },
  asphalt_highway: {
    name: 'Parkway / ramp asphalt, no paint and no wheel tracks (8 x 8 m per repeat): darker and smoother than a street, transverse expansion joints',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      baseAsphalt(ctx, w, h, 161, { dark: 1, patches: 2, seams: 3 });
      // transverse joints every 4 m (twice per tile), a dark line with a light edge
      const k = w / 512;
      for (const y of [0, h / 2]) {
        ctx.fillStyle = 'rgba(18,18,20,0.55)';
        ctx.fillRect(0, y - k, w, 2 * k);
        ctx.fillStyle = 'rgba(120,118,112,0.16)';
        ctx.fillRect(0, y + k, w, k);
      }
    },
  },
  asphalt_parkway: {
    name: 'v2 parkway / ramp asphalt (8 x 8 m per repeat): as asphalt_highway with a fine, calm aggregate (no gravelly speckle), transverse joints',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      baseAsphalt(ctx, w, h, 161, {
        dark: 1,
        patches: 2,
        seams: 3,
        fine: true,
      });
      const k = w / 512;
      for (const y of [0, h / 2, h]) {
        ctx.fillStyle = 'rgba(18,18,20,0.5)';
        ctx.fillRect(0, y - k, w, 2 * k);
      }
    },
  },
  concrete_highway: {
    name: 'Portland-cement concrete highway pavement (8 x 8 m per repeat): pale grey slabs, sealed transverse joints every 4 m, fine transverse tining, sealed cracks, a few asphalt patches',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      const k = w / 512;
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([142, 139, 132], [168, 164, 156], n * 0.5 + n2 * 0.5),
        16,
        171,
      );
      const rng = new Rng(172);
      // the two slabs of the tile: a tone each (cast on different days)
      for (const y of [0, h / 2]) {
        const d = rng.range(-1, 1);
        ctx.fillStyle =
          d < 0
            ? `rgba(70,70,72,${(-d * 0.08).toFixed(3)})`
            : `rgba(235,233,228,${(d * 0.08).toFixed(3)})`;
        ctx.fillRect(0, y, w, h / 2);
      }
      // tining: fine transverse grooves (they blur to a faint grain at a distance)
      for (let y = 0; y < h; y += 2.2 * k) {
        ctx.fillStyle = `rgba(40,40,42,${rng.range(0.03, 0.08).toFixed(3)})`;
        ctx.fillRect(0, y, w, 0.6 * k);
      }
      // a dark oily band down the middle of a lane is not drawn: the tile does not know where the lanes are
      stones(ctx, w, h, Math.round(1800 * k * k), [0.25 * k, 0.6 * k], 173, [
        [128, 127, 123],
        [192, 190, 184],
      ]);
      // asphalt patches over failed corners (dark, square edged)
      for (let i = 0; i < 2; i++) {
        const x = rng.range(0.05, 0.7) * w;
        const y = (rng.chance(0.5) ? 0 : h / 2) + rng.range(2, 30) * k;
        ctx.fillStyle = `rgba(64,64,66,${rng.range(0.45, 0.6).toFixed(2)})`;
        ctx.fillRect(x, y, rng.range(0.08, 0.2) * w, rng.range(16, 50) * k);
      }
      // sealed cracks: thin black wandering lines, mostly across the slab
      ctx.strokeStyle = 'rgba(40,40,42,0.45)';
      for (let i = 0; i < 3; i++) {
        ctx.lineWidth = rng.range(0.6, 1) * k;
        wanderStroke(
          ctx,
          w,
          h,
          rng,
          rng.next() * w,
          rng.next() * h,
          rng.chance(0.7) ? rng.range(-0.3, 0.3) : Math.PI / 2,
          rng.range(50, 140) * k,
          6 * k,
          0.35,
        );
      }
      // sealed transverse joints: a black sealant line with a pale chipped arris either side (y = h: the wrapped half)
      for (const y of [0, h / 2, h]) {
        ctx.fillStyle = 'rgba(210,208,202,0.35)';
        ctx.fillRect(0, y - 3 * k, w, 1.2 * k);
        ctx.fillRect(0, y + 1.8 * k, w, 1.2 * k);
        ctx.fillStyle = 'rgba(22,22,24,0.9)';
        ctx.fillRect(0, y - 1.2 * k, w, 2.4 * k);
        // sealant smeared over the arris here and there
        for (let x = 0; x < w; x += rng.range(20, 70) * k) {
          ctx.fillStyle = 'rgba(26,26,28,0.55)';
          ctx.fillRect(x, y - 3 * k, rng.range(6, 30) * k, 6 * k);
        }
      }
    },
  },
  junction_asphalt: {
    name: 'Junction box asphalt: city asphalt without wheel tracks or seams, any direction (8 x 8 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([66, 66, 68], [100, 99, 97], n * 0.55 + n2 * 0.45),
        16,
        141,
      );
      // A few patches and oil stains (round: no direction; off the edges: the tile wraps).
      const k = w / 512;
      const rng = new Rng(142);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(28,28,30,${rng.range(0.06, 0.16)})`;
        ctx.beginPath();
        ctx.ellipse(
          rng.range(0.1, 0.9) * w,
          rng.range(0.1, 0.9) * h,
          rng.range(8, 40) * k,
          rng.range(8, 40) * k,
          rng.next() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      streetCracks(ctx, w, h, 143, { snakes: 5, cracks: 10, across: 0.5 });
      stones(ctx, w, h, Math.round(5200 * k * k), [0.5 * k, 1.1 * k], 144, [
        [60, 60, 62],
        [130, 128, 122],
      ]);
    },
  },
  sidewalk: {
    name: 'Concrete sidewalk slabs (3 x 3 m per repeat, 2 x 2 slabs)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([150, 148, 142], [190, 188, 182], n * 0.55 + n2 * 0.45),
        6,
        121,
      );
      const k = w / 256;
      const rng = new Rng(122);
      // Each slab a slightly different tone (poured on different days).
      for (const [sx, sy] of [
        [0, 0],
        [0.5, 0],
        [0, 0.5],
        [0.5, 0.5],
      ]) {
        const t = rng.range(-0.06, 0.06);
        ctx.fillStyle = `rgba(${t > 0 ? '255,252,245' : '40,38,34'},${Math.abs(t)})`;
        ctx.fillRect(sx * w, sy * h, w / 2, h / 2);
      }
      // Expansion joints between the slabs (wraps), a lit edge beside each.
      ctx.fillStyle = 'rgba(60,58,54,0.8)';
      for (const f of [0, 0.5]) {
        ctx.fillRect(0, f * h - 1.5 * k, w, 3 * k);
        ctx.fillRect(f * w - 1.5 * k, 0, 3 * k, h);
      }
      ctx.fillStyle = 'rgba(230,226,216,0.25)';
      for (const f of [0, 0.5]) {
        ctx.fillRect(0, f * h + 1.5 * k, w, k);
        ctx.fillRect(f * w + 1.5 * k, 0, k, h);
      }
      // Hairline cracks across a slab now and then, gum spots, stains and chips.
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(50,48,44,${rng.range(0.3, 0.5)})`;
        ctx.lineWidth = rng.range(0.6, 1.1) * k;
        wanderStroke(
          ctx,
          w,
          h,
          new Rng(124 + i),
          rng.next() * w,
          rng.next() * h,
          rng.next() * Math.PI * 2,
          rng.range(20, 70) * k,
          3 * k,
          0.5,
        );
      }
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(40,38,36,${rng.range(0.15, 0.35)})`;
        ctx.beginPath();
        ctx.arc(
          rng.next() * w,
          rng.next() * h,
          rng.range(0.6, 1.4) * k,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(70,66,60,${rng.range(0.05, 0.18)})`;
        ctx.beginPath();
        ctx.ellipse(
          rng.next() * w,
          rng.next() * h,
          rng.range(2, 9) * k,
          rng.range(2, 9) * k,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      stones(ctx, w, h, Math.round(400 * k * k), [0.5 * k, 1.2 * k], 123, [
        [110, 108, 102],
        [205, 203, 196],
      ]);
    },
  },
  crosswalk: {
    name: 'Zebra crosswalk (alpha: eight white bars across the road)',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      // u (x) runs ACROSS the crosswalk, one bar per 0.5 m of a 4 m wide crossing; transparent between.
      ctx.clearRect(0, 0, w, h);
      const rng = new Rng(131);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(${226 + rng.int(-8, 8)},${226 + rng.int(-8, 8)},${220 + rng.int(-8, 8)},0.96)`;
        ctx.fillRect(i * (w / 8) + 4, 0, w / 8 - 8, h);
      }
      for (let i = 0; i < 700; i++) {
        ctx.fillStyle = `rgba(80,78,76,${rng.range(0.2, 0.7)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h,
          rng.range(1, 3),
          rng.range(1, 3),
        );
      }
    },
  },
  hatch: {
    name: 'Painted median hatching (alpha: white 45 deg stripes, tileable both ways, 4 m per tile)',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(228,228,222,0.95)';
      ctx.lineWidth = 14;
      // Period 128 px (2 m) along both axes: the stripes continue across the tile edges.
      for (let k = -w; k < 2 * w; k += 128) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + h, h);
        ctx.stroke();
      }
      const rng = new Rng(137);
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 600; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.6)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h,
          rng.range(1, 3),
          rng.range(1, 3),
        );
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  gore: {
    name: 'Gore area (asphalt, white edge lines, diagonal hatching; u across, v along 5 m)',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#4a4a4c';
      ctx.fillRect(0, 0, w, h);
      const rng = new Rng(133);
      for (let i = 0; i < 900; i++) {
        const g = rng.int(60, 110);
        ctx.fillStyle = `rgba(${g},${g},${g},${rng.range(0.15, 0.5)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h,
          rng.range(1, 3),
          rng.range(1, 3),
        );
      }
      // Diagonal hatching (period 64 px = four tiles per 5 m: tileable along v), kept inside the edge lines.
      ctx.save();
      ctx.beginPath();
      ctx.rect(22, 0, w - 44, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(226,226,220,0.9)';
      ctx.lineWidth = 9;
      for (let k = -6; k < 10; k++) {
        ctx.beginPath();
        ctx.moveTo(0, k * 64);
        ctx.lineTo(w, k * 64 + w);
        ctx.stroke();
      }
      ctx.restore();
      // Solid edge lines.
      ctx.fillStyle = 'rgba(232,232,226,0.95)';
      ctx.fillRect(6, 0, 11, h);
      ctx.fillRect(w - 17, 0, 11, h);
    },
  },
  barrier_rail: {
    name: 'Weathered guard rail (multiplies the rail colour): u along, 8 m per repeat (two 4 m beams, posts every 2 m), v = height 0-1 m (bottom = ground): road grime low down, rain streaks and rust bleed under the bolts, dull patches',
    size: [512, 128],
    color: true,
    draw(ctx, w, h) {
      const pxM = w / 8;
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x, y) => {
          const up = 1 - y / h; // metres above the ground
          // Each 4 m beam a slightly different grey; blotchy dull film over it.
          const beam = x < w / 2 ? 0 : 1;
          // (blotches of dull oxide and road film: n2 the broad ones)
          let c = mix([182, 180, 172], [246, 245, 240], n * 0.35 + n2 * 0.65);
          c = mix(c, [206, 202, 192], beam ? 0.4 : 0);
          // Road spray on the lower half of the beam (0.47-0.6 m) and caked dirt at the post feet.
          c = mix(
            c,
            [150, 140, 122],
            Math.max(0, 1 - Math.abs(up - 0.49) / 0.09) * (0.35 + 0.3 * n2),
          );
          c = mix(c, [118, 106, 88], Math.max(0, 1 - up / 0.25) * 0.75);
          return c;
        },
        16,
        171,
      );
      const rng = new Rng(172);
      // Rain streaks down the beam face from the top crest.
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = `rgba(86,80,70,${rng.range(0.08, 0.26)})`;
        ctx.fillRect(
          rng.next() * w,
          h * (1 - 0.78),
          rng.range(1, 2.5),
          rng.range(8, 34),
        );
      }
      // Rust bleeding from the bolts at the posts (every 2 m) and the beam splice (every 4 m).
      for (let k = 0; k < 4; k++) {
        const x0 = k * 2 * pxM;
        const splice = k % 2 === 0;
        for (let j = 0; j < (splice ? 9 : 4); j++) {
          const x = x0 + rng.range(-10, 10);
          ctx.fillStyle = `rgba(122,66,32,${rng.range(0.2, splice ? 0.5 : 0.35)})`;
          wrapDraw(w, h, x, h * (1 - 0.66), 40, (px, py) =>
            ctx.fillRect(px, py, rng.range(1, 2.5), rng.range(10, 40)),
          );
        }
      }
      // Rust pits along the bottom edge of the beam and small dark knocks.
      stones(
        ctx,
        w,
        h,
        320,
        [0.6, 1.6],
        173,
        [
          [140, 82, 44],
          [96, 64, 40],
          [110, 108, 102],
        ],
        (_x, y) => (Math.abs(1 - y / h - 0.48) < 0.04 ? 1 : 0.08),
      );
    },
  },
  barrier_jersey: {
    name: 'Jersey barrier (concrete, joint every 4 m)',
    size: [512, 256],
    color: true,
    draw(ctx, w, h) {
      // u (x) along the wall, one 4 m slab per tile; v (y) up it (bottom = ground).
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, _x, y) => {
          const up = 1 - y / h; // 0 at the foot
          let c = mix([150, 148, 143], [182, 180, 174], n * 0.6 + n2 * 0.4);
          // Road grime at the foot, a sun-bleached top.
          c = mix(c, [96, 94, 88], Math.max(0, 1 - up / 0.3) * 0.7);
          c = mix(c, [200, 198, 192], Math.max(0, (up - 0.85) / 0.15) * 0.4);
          return c;
        },
        8,
        91,
      );
      const rng = new Rng(92);
      // Rain streaks.
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(70,68,64,${rng.range(0.04, 0.12)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h * 0.5,
          rng.range(1, 3),
          rng.range(30, 120),
        );
      }
      // Joint between slabs (wraps: half on each edge).
      ctx.fillStyle = 'rgba(40,38,36,0.8)';
      ctx.fillRect(0, 0, 3, h);
      ctx.fillRect(w - 3, 0, 3, h);
      // Chips / pits.
      stones(ctx, w, h, 900, [0.5, 1.4], 93, [
        [90, 88, 84],
        [205, 203, 196],
      ]);
    },
  },
  road_parkway: {
    name: 'Parkway asphalt with lane markings (12 m per repeat)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      // u (x) across the road (0 = left / median side), v (y) along it, 12 m per tile.
      // Smooth dark asphalt, polished wheel paths, tar seams, patches; yellow edge line on the
      // median side, white dashed lane line (3 m dash, 9 m gap), white edge line outside.
      const track = (u: number) =>
        Math.max(0, 1 - Math.abs(u - 0.3) / 0.09, 1 - Math.abs(u - 0.7) / 0.09);
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x) => {
          const t = track(x / w);
          let c = mix([64, 64, 66], [98, 97, 96], n * 0.55 + n2 * 0.45);
          c = mix(c, [52, 52, 54], t * 0.4);
          return c;
        },
        16,
        81,
      );
      const rng = new Rng(82);
      // Patches and transverse tar seams.
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `rgba(30,30,32,${rng.range(0.15, 0.3)})`;
        ctx.fillRect(
          rng.range(0.05, 0.6) * w,
          rng.next() * h,
          rng.range(0.15, 0.4) * w,
          rng.range(10, 40),
        );
      }
      ctx.strokeStyle = 'rgba(20,20,22,0.55)';
      for (let i = 0; i < 6; i++) {
        const y = rng.next() * h;
        ctx.lineWidth = rng.range(1, 2);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + rng.range(-3, 3));
        ctx.stroke();
      }
      const line = (u: number, y0: number, y1: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(u * w - 5, y0, 10, y1 - y0);
      };
      line(0.045, 0, h, '#d9b43a');
      line(0.955, 0, h, '#dcdcd6');
      line(0.5, 0, h * 0.25, '#dcdcd6');
      // Wear: asphalt specks over the paint.
      for (let i = 0; i < 2600; i++) {
        const u = rng.pick([0.045, 0.955, 0.5]);
        ctx.fillStyle = `rgba(${70 + rng.int(0, 30)},${70 + rng.int(0, 30)},${72 + rng.int(0, 30)},${rng.range(0.3, 0.8)})`;
        ctx.fillRect(
          u * w + rng.range(-6, 6),
          rng.next() * h,
          rng.range(1, 3),
          rng.range(1, 4),
        );
      }
      stones(ctx, w, h, 5000, [0.5, 1.1], 83, [
        [60, 60, 62],
        [128, 126, 120],
      ]);
    },
  },
  road_tarmac: {
    name: 'Old tarmac (loose gravel film)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      // u (x) across the road, v (y) along it. Narrow village asphalt: polished darker wheel
      // paths, dusty centre + edges with loose gravel, repair patches, cracks, crumbling edges.
      const track = (u: number) =>
        Math.max(0, 1 - Math.abs(u - 0.27) / 0.1, 1 - Math.abs(u - 0.73) / 0.1);
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x) => {
          const u = x / w;
          const t = track(u);
          const edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.08);
          let c = mix([92, 90, 88], [122, 119, 114], n * 0.6 + n2 * 0.4);
          c = mix(c, [74, 73, 72], t * 0.45);
          // Dust film outside the wheel paths.
          c = mix(c, [150, 140, 122], (1 - t) * 0.22 * n2 + edge * 0.35);
          return c;
        },
        16,
        61,
      );
      const rng = new Rng(62);
      // Cracks: random-walk polylines, mostly longitudinal near the edges.
      for (let i = 0; i < 26; i++) {
        let x = (rng.chance(0.6) ? rng.pick([0.1, 0.9, 0.5]) : rng.next()) * w;
        let y = rng.next() * h;
        let a = Math.PI / 2 + rng.range(-0.6, 0.6);
        const steps = rng.int(6, 22);
        ctx.strokeStyle = `rgba(28,26,24,${rng.range(0.35, 0.7)})`;
        ctx.lineWidth = rng.range(0.8, 2);
        const pts: [number, number][] = [[x, y]];
        for (let k = 0; k < steps; k++) {
          a += rng.range(-0.7, 0.7);
          x += Math.cos(a) * 9;
          y += Math.sin(a) * 9;
          pts.push([x, y]);
        }
        wrapDraw(w, h, pts[0][0], pts[0][1], 220, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          for (const [qx, qy] of pts)
            ctx.lineTo(px + qx - pts[0][0], py + qy - pts[0][1]);
          ctx.stroke();
        });
      }
      // Aggregate speckles everywhere + loose gravel away from the wheel paths.
      stones(ctx, w, h, 9000, [0.5, 1.2], 63, [
        [70, 68, 66],
        [140, 136, 128],
        [110, 106, 100],
      ]);
      stones(
        ctx,
        w,
        h,
        2600,
        [0.9, 2.4],
        64,
        GRAVEL_PALETTE,
        (u) => 0.05 + 0.95 * (1 - track(u)) * (0.4 + Math.abs(u - 0.5)),
      );
      // Crumbling edges: gravel bites into the asphalt.
      for (let i = 0; i < 70; i++) {
        const left = rng.chance(0.5);
        const r = rng.range(4, 16);
        const x = (left ? rng.range(-0.01, 0.05) : rng.range(0.95, 1.01)) * w;
        const y = rng.next() * h;
        wrapDraw(w, h, x, y, r, (px, py) => {
          ctx.fillStyle = 'rgba(146,134,112,0.85)';
          ctx.beginPath();
          ctx.ellipse(px, py, r * 0.6, r, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    },
  },
  road_tarmac_lines: {
    name: 'Old tarmac with a worn white edge line each side and a worn white centre line',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac.draw(ctx, w, h);
      const rng = new Rng(65);
      const us = [0.05, 0.5, 0.95];
      ctx.fillStyle = '#d6d6ce';
      for (const u of us) ctx.fillRect(u * w - 6, 0, 12, h);
      // Wear: asphalt specks and gaps over the paint, a few bald stretches where the wheels run.
      for (let i = 0; i < 3600; i++) {
        ctx.fillStyle = `rgba(${84 + rng.int(0, 30)},${82 + rng.int(0, 30)},${80 + rng.int(0, 30)},${rng.range(0.35, 0.85)})`;
        ctx.fillRect(
          rng.pick(us) * w + rng.range(-7, 7),
          rng.next() * h,
          rng.range(1, 3),
          rng.range(1, 5),
        );
      }
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = `rgba(${96 + rng.int(0, 16)},${94 + rng.int(0, 16)},${92 + rng.int(0, 16)},${rng.range(0.45, 0.7)})`;
        ctx.fillRect(
          rng.pick(us) * w - 6,
          rng.next() * h,
          12,
          rng.range(6, 26),
        );
      }
    },
  },
  road_tarmac_kerbed: {
    name: 'Tarmac along a kerbed street (no edge grit): the surface of road_tarmac',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac.draw(ctx, w, h);
    },
  },
  road_tarmac_plain_kerbed: {
    name: 'Vodno tarmac along a kerbed city street: the surface of road_tarmac_plain',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac_plain.draw(ctx, w, h);
    },
  },
  road_tarmac_junction: {
    name: 'Tarmac at a junction corner (no wheel paths or edges): the surface of road_tarmac',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac.draw(ctx, w, h);
    },
  },
  road_patch: {
    name: 'A repair in old asphalt (alpha: a straight-cut patch, u across with ragged long edges, v along, 3 m per repeat): pale re-laid asphalt, its stones showing',
    size: [128, 256],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(176,172,164,0.82)';
      ctx.fillRect(0, 0, w, h);
      const rng = new Rng(157);
      for (let i = 0; i < 2600; i++) {
        const v = 120 + rng.int(0, 90);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},${rng.range(0.3, 0.8)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h,
          rng.range(1, 2.5),
          rng.range(1, 2.5),
        );
      }
      // The long edges: a dark sealed seam, ragged where the cut broke out.
      ctx.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < h; y += 2)
        for (const side of [0, 1]) {
          const bite =
            rng.range(0, 3) + (rng.chance(0.06) ? rng.range(2, 6) : 0);
          ctx.fillRect(side ? w - bite : 0, y, bite, 2);
        }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(40,38,36,0.55)';
      ctx.fillRect(4, 0, 2, h);
      ctx.fillRect(w - 6, 0, 2, h);
    },
  },
  road_cracks: {
    name: 'A crack field in old asphalt (alpha: dark alligator cracks, u across, v along, 3 m per repeat; ragged ends)',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      // Cells of a jittered grid (~0.2-0.35 m), their borders the cracks: a Voronoi edge where the two nearest seeds are
      // almost as near, wider and darker on the long main cracks.
      const rng = new Rng(311);
      const N = 9;
      const seeds: [number, number][] = [];
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++)
          seeds.push([
            ((i + 0.15 + 0.7 * rng.next()) / N) * w,
            ((j + 0.15 + 0.7 * rng.next()) / N) * h,
          ]);
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let d1 = Infinity;
          let d2 = Infinity;
          let n1 = 0;
          let n2 = 0;
          const ci = Math.floor((x / w) * N);
          const cj = Math.floor((y / h) * N);
          for (let dj = -2; dj <= 2; dj++)
            for (let di = -2; di <= 2; di++) {
              const ii = (ci + di + N) % N;
              const jj = (cj + dj + N) % N;
              const [sx0, sy0] = seeds[jj * N + ii];
              const sx = sx0 + Math.round((ci + di - ii) / N) * w;
              const sy = sy0 + Math.round((cj + dj - jj) / N) * h;
              const dd = Math.hypot(x - sx, y - sy);
              const id = jj * N + ii;
              if (dd < d1) {
                d2 = d1;
                n2 = n1;
                d1 = dd;
                n1 = id;
              } else if (dd < d2) {
                d2 = dd;
                n2 = id;
              }
            }
          const e = d2 - d1;
          const k = (y * w + x) * 4;
          // fading out across the field's long edges (u), so it has no straight border
          const across = Math.min(x, w - 1 - x) / (w * 0.22);
          // each crack (a pair of cells) its own strength: some open and dark, many hairlines, a third not there at all
          const lo = Math.min(n1, n2);
          const hi = Math.max(n1, n2);
          const r = (Math.sin(lo * 12.9898 + hi * 78.233) * 43758.5453) % 1;
          const k2 = Math.abs(r);
          const strength = k2 < 0.33 ? 0 : k2 < 0.8 ? 0.45 : 0.85;
          const a =
            Math.max(0, 1 - e / (strength > 0.6 ? 1.1 : 0.7)) *
            strength *
            Math.min(1, across);
          d[k] = 34;
          d[k + 1] = 32;
          d[k + 2] = 30;
          d[k + 3] = Math.round(200 * a);
        }
      ctx.putImageData(img, 0, 0);
    },
  },
  road_tarmac_new: {
    name: "Fresh dark asphalt with crisp white edge and centre lines (Vodno's re-laid upper road)",
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#3c3b39';
      ctx.fillRect(0, 0, w, h);
      const rng = new Rng(67);
      for (let i = 0; i < 9000; i++) {
        const v = 50 + rng.int(0, 40);
        ctx.fillStyle = `rgb(${v},${v},${v - 2})`;
        ctx.fillRect(rng.next() * w, rng.next() * h, 1.5, 1.5);
      }
      ctx.fillStyle = '#dcdcd4';
      for (const u of [0.05, 0.5, 0.95]) ctx.fillRect(u * w - 6, 0, 12, h);
    },
  },
  road_tarmac_plain: {
    name: 'Old tarmac without lines (where the road paint lies over it): the surface of road_tarmac_lines',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac.draw(ctx, w, h);
    },
  },
  road_tarmac_plain_junction: {
    name: 'Old tarmac at a junction mouth (no wheel paths, edges or lines): the surface of road_tarmac_lines',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      DEFS.road_tarmac.draw(ctx, w, h);
    },
  },
  road_paint: {
    name: 'Worn white road paint (alpha: a lane line; u across the line, v along it, 4 m per repeat): worn like the road textures own lines',
    size: [32, 512],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = ROAD_PAINT;
      ctx.fillRect(0, 0, w, h);
      const rng = new Rng(151);
      ctx.globalCompositeOperation = 'destination-out';
      // Specks of asphalt through the paint (a third of them bite the line's edges), and a few bald stretches.
      const bite = (x: number, y: number, bw: number, bh: number): void => {
        for (const dy of [-h, 0, h]) ctx.fillRect(x, y + dy, bw, bh);
      };
      for (let i = 0; i < 230; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rng.range(0.4, 0.9)})`;
        const bw = rng.range(2.6, 8);
        const x = rng.chance(0.3)
          ? rng.pick([0, w]) + rng.range(-0.2, 0.2) * w - bw / 2
          : rng.next() * w - bw / 2;
        bite(x, rng.next() * h, bw, rng.range(1.8, 8.7));
      }
      for (let i = 0; i < 1; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rng.range(0.4, 0.7)})`;
        bite(0, rng.next() * h, w, rng.range(10, 46));
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  road_arrow_left: {
    name: 'Worn white turn-left-only road arrow (alpha: u across 1.1 m, v along 4 m, a straight stem bending to a head pointing up-left)',
    size: [128, 512],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = ROAD_PAINT;
      // Metres -> pixels: u 0..1.1 across, v 0..4 up (canvas y runs down).
      const X = (u: number): number => (u * w) / 1.1;
      const Y = (v: number): number => h - (v * h) / 4;
      const stem = 0.13;
      // The stem rises to v 1.9, then runs up-left to the head.
      const bend: [number, number] = [0.74, 1.9];
      const tip: [number, number] = [0.3, 2.95];
      const dx = tip[0] - bend[0];
      const dy = tip[1] - bend[1];
      const len = Math.hypot(dx, dy);
      const d: [number, number] = [dx / len, dy / len];
      const p: [number, number] = [d[1], -d[0]];
      ctx.beginPath();
      ctx.moveTo(X(0.74 - stem), Y(0.1));
      ctx.lineTo(X(bend[0] - stem), Y(bend[1]));
      ctx.lineTo(X(tip[0] - p[0] * stem), Y(tip[1] - p[1] * stem));
      ctx.lineTo(X(tip[0] + p[0] * stem), Y(tip[1] + p[1] * stem));
      ctx.lineTo(X(bend[0] + stem), Y(bend[1] - 0.18));
      ctx.lineTo(X(0.74 + stem), Y(0.1));
      ctx.closePath();
      ctx.fill();
      // The head: base across the run, tip 0.8 m on.
      const head = 0.42;
      ctx.beginPath();
      ctx.moveTo(X(tip[0] + d[0] * 0.8), Y(tip[1] + d[1] * 0.8));
      ctx.lineTo(X(tip[0] + p[0] * head), Y(tip[1] + p[1] * head));
      ctx.lineTo(X(tip[0] - p[0] * head), Y(tip[1] - p[1] * head));
      ctx.closePath();
      ctx.fill();
      wornPaint(ctx, w, h, 152, 380);
    },
  },
  road_arrow_straight: {
    name: 'Worn white straight-ahead road arrow (alpha: u across 1.1 m, v along 4 m, head up)',
    size: [128, 512],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = ROAD_PAINT;
      const X = (u: number): number => (u * w) / 1.1;
      const Y = (v: number): number => h - (v * h) / 4;
      ctx.fillRect(X(0.55 - 0.13), Y(2.7), X(0.26), Y(0.1) - Y(2.7));
      ctx.beginPath();
      ctx.moveTo(X(0.55), Y(3.95));
      ctx.lineTo(X(1.0), Y(2.6));
      ctx.lineTo(X(0.1), Y(2.6));
      ctx.closePath();
      ctx.fill();
      wornPaint(ctx, w, h, 153, 380);
    },
  },
  flag_mk: {
    name: 'Flag of North Macedonia (2:1; the yellow eight-ray sun on red, official geometry 1200 x 600)',
    size: [1024, 512],
    color: true,
    draw(ctx, w, h) {
      // Flag units (centre origin, +y up): the sun disc of radius 85, eight rays from radius 107 widening from
      // 11 to 60 either side of their axis at the border - four along the axes, four to the corners.
      const k = w / 1200;
      ctx.fillStyle = '#d92125';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(k, -k);
      ctx.fillStyle = '#f8e92e';
      ctx.beginPath();
      ctx.arc(0, 0, 85, 0, Math.PI * 2);
      ctx.fill();
      const angles = [
        0,
        Math.PI,
        Math.PI / 2,
        -Math.PI / 2,
        Math.atan2(300, 600),
        Math.atan2(300, -600),
        Math.atan2(-300, 600),
        Math.atan2(-300, -600),
      ];
      for (const a of angles) {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        // Length to the border along the ray (the corner rays end in the corners).
        const L = Math.min(
          ux ? 600 / Math.abs(ux) : Infinity,
          uy ? 300 / Math.abs(uy) : Infinity,
        );
        const pt = (s: number, t: number): [number, number] => [
          ux * s - uy * t,
          uy * s + ux * t,
        ];
        ctx.beginPath();
        for (const [s, t] of [
          [107, -11],
          [L, -60],
          [L, 60],
          [107, 11],
        ] as const) {
          const [x, y] = pt(s, t);
          if (s === 107 && t < 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  },
  detail: {
    // Linear (not sRGB) multiplier around 0.85 - adds grain without darkening vertex colours.
    name: 'Detail noise (vegetation / props)',
    size: [256, 256],
    color: false,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => {
          const v = 218 + (n - 0.5) * 90 + (n2 - 0.5) * 30;
          return [v, v, v];
        },
        24,
        61,
      );
    },
  },
  people: {
    // Grey multiplier for the vertex colours of every figure: garments painted unwrapped (engine/people-atlas.ts).
    name: 'People atlas (garments, face)',
    size: PEOPLE_ATLAS_SIZE,
    color: false,
    draw(ctx) {
      drawPeopleAtlas(ctx);
    },
  },
  people_normal: {
    name: 'People normal map (stitching, weave, creases)',
    size: PEOPLE_ATLAS_SIZE,
    color: false,
    draw(ctx) {
      drawPeopleNormal(ctx, getTexture('people').image as HTMLCanvasElement);
    },
  },
  macro: {
    name: 'Macro variation',
    size: [256, 256],
    color: false,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n) => {
          const v = n * 255;
          return [v, v, v];
        },
        4,
        71,
      );
    },
  },
  bark_pine: {
    name: 'Bark (pine)',
    size: [128, 256],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([62, 40, 28], [128, 82, 54], n * 0.6 + n2 * 0.4),
        6,
        91,
      );
      const rng = new Rng(92);
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = `rgba(30,20,14,${rng.range(0.2, 0.5)})`;
        const x = rng.next() * w;
        wrapDraw(w, h, x, 0, 4, (px) =>
          ctx.fillRect(px, rng.next() * h, rng.range(1, 3), rng.range(10, 60)),
        );
      }
    },
  },
  bark_birch: {
    name: 'Bark (birch)',
    size: [128, 256],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n) => mix([200, 196, 186], [236, 232, 224], n),
        6,
        101,
      );
      const rng = new Rng(102);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = `rgba(30,30,30,${rng.range(0.5, 0.9)})`;
        const y = rng.next() * h;
        const x = rng.next() * w;
        wrapDraw(w, h, x, y, 30, (px, py) =>
          ctx.fillRect(px, py, rng.range(6, 26), rng.range(1, 3.5)),
        );
      }
    },
  },
  chevron_us: {
    name: 'US curve warning board (large arrow, black on yellow)',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      // retroreflective yellow, a thin black border inset from the edge, one black arrow pointing left
      ctx.fillStyle = '#f4c20d';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 5;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = '#111';
      const y = h / 2;
      ctx.fillRect(92, y - 11, 120, 22);
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(100, y - 38);
      ctx.lineTo(100, y + 38);
      ctx.closePath();
      ctx.fill();
    },
  },
  us_signs: {
    name: 'US road signs (exit gore signs, speed limit, curve warnings, advisory plate)',
    size: [1024, 512],
    color: true,
    draw(ctx, w, h) {
      // 8 cells of 256 x 256 (us-road-sign.ts US_SIGN_CELLS): EXIT 2-5, SPEED LIMIT 45, curve right, winding road,
      // the 25 MPH plate; each sign drawn at its own aspect from the cell's top left, the rest transparent
      ctx.clearRect(0, 0, w, h);
      const C = 256;
      const font = (px: number) =>
        `bold ${px}px Arial Narrow, Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const border = (
        x: number,
        y: number,
        bw: number,
        bh: number,
        fill: string,
        line: string,
      ) => {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = line;
        ctx.lineWidth = 6;
        ctx.strokeRect(x + 7, y + 7, bw - 14, bh - 14);
      };
      for (let k = 0; k < 4; k++) {
        // EXIT n with the up-right arrow: green, white legend (1.25 : 1)
        const x = k * C;
        border(x, 0, C, 205, '#0f6b3a', '#f4f4f1');
        ctx.fillStyle = '#f7f7f4';
        ctx.font = font(52);
        ctx.fillText('EXIT', x + C / 2, 48);
        ctx.font = font(96);
        ctx.fillText(String(k + 2), x + C / 2 - 34, 132);
        ctx.save();
        ctx.translate(x + C / 2 + 52, 132);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-9, -10, 18, 48);
        ctx.beginPath();
        ctx.moveTo(0, -44);
        ctx.lineTo(-28, -8);
        ctx.lineTo(28, -8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // SPEED LIMIT 45 (4 : 5)
      border(0, C, 205, 256, '#f6f6f2', '#111');
      ctx.fillStyle = '#111';
      ctx.font = font(44);
      ctx.fillText('SPEED', 102, C + 46);
      ctx.fillText('LIMIT', 102, C + 92);
      ctx.font = font(118);
      ctx.fillText('45', 102, C + 178);
      // yellow diamonds: curve right, winding road (a square turned 45 degrees in the cell)
      const diamond = (cx: number, cy: number) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 126);
        ctx.lineTo(cx + 126, cy);
        ctx.lineTo(cx, cy + 126);
        ctx.lineTo(cx - 126, cy);
        ctx.closePath();
        ctx.fillStyle = '#f4c20d';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx, cy - 112);
        ctx.lineTo(cx + 112, cy);
        ctx.lineTo(cx, cy + 112);
        ctx.lineTo(cx - 112, cy);
        ctx.closePath();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 6;
        ctx.stroke();
      };
      ctx.lineCap = 'butt';
      diamond(C + 128, C + 128);
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#111';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(C + 110, C + 200);
      ctx.lineTo(C + 110, C + 140);
      ctx.quadraticCurveTo(C + 110, C + 100, C + 150, C + 92);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(C + 186, C + 88);
      ctx.lineTo(C + 146, C + 60);
      ctx.lineTo(C + 146, C + 118);
      ctx.closePath();
      ctx.fill();
      diamond(2 * C + 128, C + 128);
      ctx.beginPath();
      ctx.moveTo(2 * C + 112, C + 205);
      ctx.bezierCurveTo(
        2 * C + 160,
        C + 180,
        2 * C + 160,
        C + 150,
        2 * C + 120,
        C + 135,
      );
      ctx.bezierCurveTo(
        2 * C + 85,
        C + 120,
        2 * C + 90,
        C + 95,
        2 * C + 128,
        C + 82,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2 * C + 150, C + 46);
      ctx.lineTo(2 * C + 112, C + 64);
      ctx.lineTo(2 * C + 146, C + 98);
      ctx.closePath();
      ctx.fill();
      // the 25 MPH advisory plate (square)
      border(3 * C, C, 256, 256, '#f4c20d', '#111');
      ctx.fillStyle = '#111';
      ctx.font = font(124);
      ctx.fillText('25', 3 * C + 128, C + 100);
      ctx.font = font(64);
      ctx.fillText('MPH', 3 * C + 128, C + 200);
    },
  },
  chevron: {
    name: 'Chevron board',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#d6191b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const x = 40 + i * 70;
        ctx.beginPath();
        ctx.moveTo(x + 30, 14);
        ctx.lineTo(x - 10, h / 2);
        ctx.lineTo(x + 30, h - 14);
        ctx.lineTo(x + 52, h - 14);
        ctx.lineTo(x + 12, h / 2);
        ctx.lineTo(x + 52, 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    },
  },
  bridge_stone: {
    name: 'Bridge ashlar (stone-faced abutments / parapets, 2 x 2 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      // u (x) along the wall, v (y) up it; four 0.5 m courses per tile, running bond, dark mortar.
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([138, 132, 122], [176, 170, 158], n * 0.6 + n2 * 0.4),
        6,
        141,
      );
      const k = w / 512;
      const rng = new Rng(142);
      const courses = 4;
      const ch = h / courses;
      for (let c = 0; c < courses; c++) {
        // Block lengths 0.7 - 1.3 m, the bond shifts every course.
        let x = -rng.range(0, 0.6) * (w / 2);
        const y0 = c * ch;
        while (x < w) {
          const bw = rng.range(0.7, 1.3) * (w / 2);
          const tone = rng.range(-0.12, 0.1);
          ctx.fillStyle = `rgba(${tone > 0 ? '255,250,240' : '30,28,24'},${Math.abs(tone)})`;
          ctx.fillRect(x, y0, bw, ch);
          // Rock-faced block: a darker band round the edge, the face lit from above.
          const g = ctx.createLinearGradient(0, y0, 0, y0 + ch);
          g.addColorStop(0, 'rgba(255,250,240,0.10)');
          g.addColorStop(0.5, 'rgba(255,250,240,0)');
          g.addColorStop(1, 'rgba(30,28,24,0.14)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y0, bw, ch);
          // Joints: dark mortar on the left and the bottom edge, a lit top edge.
          ctx.fillStyle = 'rgba(40,38,34,0.75)';
          ctx.fillRect(x - 1.5 * k, y0, 3 * k, ch);
          ctx.fillRect(x + w, y0, 3 * k, ch);
          ctx.fillRect(x, y0, bw, 3 * k);
          ctx.fillStyle = 'rgba(235,228,214,0.25)';
          ctx.fillRect(x, y0 + 3 * k, bw, 2 * k);
          x += bw;
        }
      }
      // Weathering: soot streaks, white lime runs out of the joints, pits.
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = `rgba(55,52,48,${rng.range(0.04, 0.12)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h * 0.6,
          rng.range(1, 4) * k,
          rng.range(40, 200) * k,
        );
      }
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = `rgba(236,232,222,${rng.range(0.05, 0.12)})`;
        ctx.fillRect(
          rng.next() * w,
          Math.floor(rng.next() * courses) * ch,
          rng.range(2, 6) * k,
          rng.range(20, 90) * k,
        );
      }
      stones(ctx, w, h, Math.round(500 * k * k), [0.5 * k, 1.3 * k], 143, [
        [96, 92, 86],
        [196, 190, 178],
      ]);
    },
  },
  bridge_concrete: {
    name: 'Bridge concrete (form boards, tie holes, rust and lime runs, stains; 4 x 4 m per repeat)',
    size: [1024, 1024],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([128, 126, 121], [170, 168, 162], n * 0.55 + n2 * 0.45),
        8,
        151,
      );
      const k = w / 512;
      const rng = new Rng(152);
      // Form boards: 0.25 m planks, each pour a slightly different tone, a faint wood grain.
      const boards = 16;
      for (let b = 0; b < boards; b++) {
        const t = rng.range(-0.05, 0.05);
        ctx.fillStyle = `rgba(${t > 0 ? '255,252,245' : '40,38,34'},${Math.abs(t)})`;
        ctx.fillRect(0, (b * h) / boards, w, h / boards);
        for (let g = 0; g < 6; g++) {
          ctx.fillStyle = `rgba(70,66,60,${rng.range(0.03, 0.07)})`;
          ctx.fillRect(
            0,
            ((b + rng.next()) * h) / boards,
            w,
            rng.range(0.6, 1.4) * k,
          );
        }
      }
      // Board joints every 0.5 m (darker), panel joints every 2 m (a sharp groove with a lit lower lip).
      ctx.fillStyle = 'rgba(60,58,54,0.35)';
      for (let y = 0; y < h; y += h / 8) ctx.fillRect(0, y, w, 2 * k);
      for (const x of [0, w / 2]) {
        ctx.fillStyle = 'rgba(40,38,34,0.55)';
        ctx.fillRect(x - 1.5 * k, 0, 3 * k, h);
        ctx.fillStyle = 'rgba(230,226,216,0.18)';
        ctx.fillRect(x + 1.5 * k, 0, k, h);
      }
      // Tie holes (a grid of plugged cones), some weeping rust.
      for (let y = h / 16; y < h; y += h / 4)
        for (let x = w / 16; x < w; x += w / 4) {
          ctx.fillStyle = 'rgba(50,48,45,0.6)';
          ctx.beginPath();
          ctx.arc(x, y, 2.5 * k, 0, Math.PI * 2);
          ctx.fill();
          if (rng.chance(0.3)) {
            const g = ctx.createLinearGradient(
              0,
              y,
              0,
              y + rng.range(30, 110) * k,
            );
            g.addColorStop(0, `rgba(122,74,38,${rng.range(0.18, 0.32)})`);
            g.addColorStop(1, 'rgba(122,74,38,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - 1.5 * k, y, rng.range(2, 4) * k, 110 * k);
          }
        }
      // Water stains running down from the top, white lime (efflorescence) out of the board joints.
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(48,46,42,${rng.range(0.05, 0.16)})`;
        ctx.fillRect(
          rng.next() * w,
          rng.next() * h * 0.5,
          rng.range(1, 5) * k,
          rng.range(40, 260) * k,
        );
      }
      for (let i = 0; i < 30; i++) {
        const y = Math.floor(rng.next() * 8) * (h / 8);
        const g = ctx.createLinearGradient(0, y, 0, y + rng.range(20, 80) * k);
        g.addColorStop(0, `rgba(238,236,228,${rng.range(0.1, 0.22)})`);
        g.addColorStop(1, 'rgba(238,236,228,0)');
        ctx.fillStyle = g;
        ctx.fillRect(rng.next() * w, y, rng.range(3, 10) * k, 80 * k);
      }
      stones(ctx, w, h, Math.round(700 * k * k), [0.5 * k, 1.3 * k], 153, [
        [92, 90, 86],
        [200, 198, 190],
      ]);
    },
  },
  vehicle_decals: {
    name: 'Vehicle decals atlas (plain white, POLICE lettering, Star of Life, AMBULANCE lettering)',
    size: [768, 128],
    color: true,
    draw(ctx, w, h) {
      // u 0 .. 0.067: plain white (every painted face of a vehicle samples it, the colour is the vertex colour).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      // u 0.067 .. 0.367: POLICE, navy letters.
      const text = (t: string, x0: number, x1: number, fg: string) => {
        // Transparent behind the letters (the vehicle material cuts it out): they sit on the paint itself.
        ctx.clearRect(x0, 0, x1 - x0, h);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(h * 0.74)}px Arial, Helvetica, sans-serif`;
        ctx.fillText(t, (x0 + x1) / 2, h * 0.54, x1 - x0 - 16);
      };
      text('POLICE', w * 0.067, w * 0.367, '#14306b');
      // u 0.367 .. 0.667: Star of Life (blue six-armed star, staff cut out).
      const sx0 = w * 0.367;
      const sw = w * 0.3;
      ctx.clearRect(sx0, 0, sw, h);
      ctx.save();
      ctx.translate(sx0 + sw / 2, h / 2);
      ctx.fillStyle = '#1d57b3';
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.fillRect(-h * 0.07, -h * 0.46, h * 0.14, h * 0.92);
      }
      ctx.restore();
      // The staff and its snake loop are cut out of the star.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(sx0 + sw / 2 - h * 0.025, h * 0.2, h * 0.05, h * 0.6);
      ctx.beginPath();
      ctx.arc(sx0 + sw / 2, h * 0.35, h * 0.1, 0, Math.PI * 2);
      ctx.lineWidth = h * 0.035;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      // u 0.667 .. 1.0: AMBULANCE, red letters (generic word, no agency names).
      text('AMBULANCE', w * 0.667, w, '#c8161d');
    },
  },
  taxi_sign: {
    name: 'Taxi roof sign: the lit face with TAXI (left three quarters), the plain housing (right)',
    size: [256, 64],
    color: true,
    draw(ctx, w, h) {
      // Housing: translucent yellow plastic.
      ctx.fillStyle = '#f2c230';
      ctx.fillRect(0, 0, w, h);
      // Face: brighter over the lamp in the middle, a dark rim.
      const fw = w * 0.75;
      const glow = ctx.createRadialGradient(
        fw / 2,
        h / 2,
        h * 0.1,
        fw / 2,
        h / 2,
        fw * 0.6,
      );
      glow.addColorStop(0, '#fff3b8');
      glow.addColorStop(1, '#f5c637');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, fw, h);
      ctx.strokeStyle = '#3a3320';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, fw - 3, h - 3);
      // The generic word, no operator name or number.
      ctx.fillStyle = '#15130f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.62)}px Arial, Helvetica, sans-serif`;
      const letters = 'TAXI';
      const step = fw * 0.2;
      for (let i = 0; i < letters.length; i++)
        ctx.fillText(
          letters[i],
          fw / 2 + (i - (letters.length - 1) / 2) * step,
          h * 0.54,
        );
    },
  },
  village_sign: {
    name: 'Village name board, front (top) and back with the red end slash (bottom)',
    size: [512, 384],
    color: true,
    draw(ctx, w, h) {
      const ph = h / 2;
      for (const end of [false, true]) {
        const y0 = end ? ph : 0;
        ctx.fillStyle = '#f4f4f1';
        ctx.fillRect(0, y0, w, ph);
        ctx.strokeStyle = '#1d3c78';
        ctx.lineWidth = 10;
        ctx.strokeRect(8, y0 + 8, w - 16, ph - 16);
        ctx.fillStyle = '#16181c';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(ph * 0.3)}px Arial, Helvetica, sans-serif`;
        ctx.fillText('Ajvatovci', w / 2, y0 + ph * 0.34, w - 50);
        ctx.fillText(
          '\u0410\u0458\u0432\u0430\u0442\u043e\u0432\u0446\u0438',
          w / 2,
          y0 + ph * 0.7,
          w - 50,
        );
        if (end) {
          // End of village: red slash from top right to bottom left, inside the border.
          ctx.save();
          ctx.beginPath();
          ctx.rect(13, y0 + 13, w - 26, ph - 26);
          ctx.clip();
          ctx.strokeStyle = '#c8161d';
          ctx.lineWidth = 34;
          ctx.lineCap = 'butt';
          ctx.beginPath();
          ctx.moveTo(w - 4, y0 + 4);
          ctx.lineTo(4, y0 + ph - 4);
          ctx.stroke();
          ctx.restore();
        }
      }
    },
  },
  water_normal: {
    // Tangent-space normal map of small wind ripples (canals / rivers), tileable.
    name: 'Water ripples (normal map)',
    size: [256, 256],
    color: false,
    draw(ctx, w, h) {
      const n = tileNoise(w, h, 6, 4, 131, 0.55);
      const img = ctx.createImageData(w, h);
      const at = (x: number, y: number) => n[((y + h) % h) * w + ((x + w) % w)];
      const k = 9;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (at(x - 1, y) - at(x + 1, y)) * k;
          const dy = (at(x, y - 1) - at(x, y + 1)) * k;
          const l = Math.hypot(dx, dy, 1);
          const i = (y * w + x) * 4;
          img.data[i] = (dx / l) * 127.5 + 127.5;
          img.data[i + 1] = (dy / l) * 127.5 + 127.5;
          img.data[i + 2] = (1 / l) * 127.5 + 127.5;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  },
};
