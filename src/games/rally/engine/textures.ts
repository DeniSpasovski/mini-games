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
  | 'road_parkway'
  | 'road_street'
  | 'road_street4'
  | 'road_city'
  | 'asphalt_street'
  | 'asphalt_highway'
  | 'junction_asphalt'
  | 'sidewalk'
  | 'crosswalk'
  | 'gore'
  | 'hatch'
  | 'barrier_jersey'
  | 'bridge_stone'
  | 'bridge_concrete'
  | 'vehicle_decals'
  | 'village_sign'
  | 'detail'
  | 'macro'
  | 'grass_card'
  | 'grass_card_dry'
  | 'grass_card_spring'
  | 'bark_pine'
  | 'bark_birch'
  | 'chevron'
  | 'dust'
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

export function getTexture(id: TextureId): Texture {
  let t = cache.get(id);
  if (!t) {
    const def = DEFS[id];
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = def.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    def.draw(ctx, canvas.width, canvas.height);
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

/** Alpha grass blades (bottom = root colour, top = tip colour), optional seed heads. */
function grassBlades(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  root: RGB,
  tip: RGB,
  heads: boolean,
): void {
  ctx.clearRect(0, 0, w, h);
  const rng = new Rng(seed);
  for (let i = 0; i < 110; i++) {
    const x = rng.range(0.08, 0.92) * w;
    const top = rng.range(0.05, 0.6) * h;
    const bend = rng.range(-18, 18);
    const l = rng.range(0.7, 1.25);
    const g = ctx.createLinearGradient(0, h, 0, top);
    g.addColorStop(0, `rgb(${root[0] * l},${root[1] * l},${root[2] * l})`);
    g.addColorStop(1, `rgb(${tip[0] * l},${tip[1] * l},${tip[2] * l})`);
    ctx.fillStyle = g;
    const bw = rng.range(2, 4.5);
    ctx.beginPath();
    ctx.moveTo(x - bw, h);
    ctx.quadraticCurveTo(x + bend * 0.3, (h + top) / 2, x + bend, top);
    ctx.quadraticCurveTo(x + bend * 0.3 + bw * 0.3, (h + top) / 2, x + bw, h);
    ctx.fill();
    if (heads && rng.chance(0.35)) {
      ctx.fillStyle = `rgb(${tip[0] * l},${tip[1] * l * 0.95},${tip[2] * l * 0.85})`;
      ctx.beginPath();
      ctx.ellipse(x + bend, top + 4, 2.2, 7, bend * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
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
  o: { dark: 0 | 1; patches: number; seams: number; snakes?: number },
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

// --- definitions ---------------------------------------------------------------------

/** Crushed granite of a railway's ballast: blue-grey, a few rusty stones. */
const BALLAST_PALETTE: RGB[] = [
  [128, 128, 126],
  [104, 104, 104],
  [150, 148, 142],
  [86, 86, 88],
  [124, 112, 98],
];
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
    // u (x) across the ballast bed (4.8 m, toe to toe), v (y) along it (1.2 m: two concrete sleepers).
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
      stones(ctx, w, h, 4200, [1.4, 3.4], 72, BALLAST_PALETTE);
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
  grass_card: {
    name: 'Grass card (alpha)',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      grassBlades(ctx, w, h, 81, [40, 52, 22], [130, 140, 70], false);
    },
  },
  grass_card_dry: {
    name: 'Dry grass card (alpha)',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      grassBlades(ctx, w, h, 82, [96, 78, 44], [232, 208, 150], true);
    },
  },
  grass_card_spring: {
    name: 'Spring grass card (alpha)',
    size: [256, 128],
    color: true,
    draw(ctx, w, h) {
      grassBlades(ctx, w, h, 83, [74, 112, 34], [150, 192, 76], false);
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
  dust: {
    name: 'Dust puff (alpha)',
    size: [64, 64],
    color: false,
    draw(ctx, w, h) {
      const n = tileNoise(w, h, 4, 3, 111);
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x + 0.5) / w - 0.5;
          const dy = (y + 0.5) / h - 0.5;
          const d = Math.sqrt(dx * dx + dy * dy) * 2;
          const a = Math.max(0, 1 - d) ** 1.6 * (0.55 + 0.45 * n[y * w + x]);
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
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
    name: 'Vehicle decals atlas (plain white, POLICE lettering, FIRE DEPT lettering, AMBULANCE)',
    size: [768, 128],
    color: true,
    draw(ctx, w, h) {
      // u 0 .. 0.067: plain white (every painted face of a vehicle samples it, the colour is the vertex colour).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      // u 0.067 .. 0.367: POLICE, navy letters on white.
      const text = (
        t: string,
        x0: number,
        x1: number,
        bg: string,
        fg: string,
      ) => {
        ctx.fillStyle = bg;
        ctx.fillRect(x0, 0, x1 - x0, h);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(h * 0.74)}px Arial, Helvetica, sans-serif`;
        ctx.fillText(t, (x0 + x1) / 2, h * 0.54, x1 - x0 - 16);
      };
      text('POLICE', w * 0.067, w * 0.367, '#f4f4f1', '#14306b');
      // u 0.367 .. 0.667: FIRE DEPT, white letters on engine red.
      text('FIRE DEPT', w * 0.367, w * 0.667, '#b3121a', '#fbfbf8');
      // u 0.667 .. 1.0: AMBULANCE, red letters on white (generic words only, no agency names).
      text('AMBULANCE', w * 0.667, w, '#f4f4f1', '#c8161d');
    },
  },
  village_sign: {
    name: 'Village name board (Latin + Cyrillic)',
    size: [512, 192],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#f4f4f1';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#1d3c78';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = '#16181c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.3)}px Arial, Helvetica, sans-serif`;
      ctx.fillText('Ajvatovci', w / 2, h * 0.34, w - 50);
      ctx.fillText(
        '\u0410\u0458\u0432\u0430\u0442\u043e\u0432\u0446\u0438',
        w / 2,
        h * 0.7,
        w - 50,
      );
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
