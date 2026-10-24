import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { Noise2D, smoothstep } from '../../../shared/noise';

/**
 * The dynamite atlas shared by every TNT and the stick power-ups: a colour texture and a matching normal map (alpha =
 * roughness multiplier, read by the High TNT material). Generated once, no DOM needed (the printed text on the wrap is
 * added only where a canvas exists). Regions (u ranges; v runs 0 ... 1):
 * - `paper`: the stick wrap, u round the stick, v along it (bottom = 0): red paper with fibres, lengthwise creases, a
 *   spiral seam, waxed darker ends, printed cream rings and a line of print, dust at the foot.
 * - `crimp`: a square seen from above: the folded paper end, eight creases running in to a dimple (match `PLEATS`).
 * - `rope`: across a cord (u = round it), v along it, repeating every `ROPE_M` metres: three twisted strands.
 * - from `plain` on: white and flat, for parts that only want their vertex colour.
 */
export const ATLAS = {
  paper: [0.008, 0.617] as const,
  crimp: { u0: 0.64, u1: 0.8, v0: 0.01, v1: 0.33 } as const,
  rope: [0.83, 0.94] as const,
  plain: 0.985,
};
/** Metres of cord per unit of rope v (six strand lays). */
export const ROPE_M = 0.36;
/** Creases round a crimped end (the geometry's pleats line up with them). */
export const PLEATS = 8;

const W = 1024;
const H = 512;

let atlas: { map: DataTexture; normal: DataTexture } | null = null;

/** The dynamite colour texture and its normal map (see `ATLAS`). */
export function dynamiteTextures(): { map: DataTexture; normal: DataTexture } {
  if (atlas) return atlas;
  const col = new Float32Array(W * H * 3).fill(1);
  const hgt = new Float32Array(W * H);
  const rough = new Float32Array(W * H).fill(1);
  // normal strength per pixel (0 = flat, so the gaps between regions stay flat)
  const bump = new Float32Array(W * H);
  const noise = new Noise2D(808);
  const n2 = new Noise2D(4242);
  // noise that wraps round u (period 1), so a stick or cord shows no seam
  const wrapN = (n: Noise2D, u: number, v: number, fu: number, fv: number) =>
    n.noise2(u * fu, v * fv) * (1 - u) + n.noise2((u - 1) * fu, v * fv) * u;

  const set = (i: number, r: number, g: number, b: number) => {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  };

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const i = y * W + x;
      if (u >= ATLAS.paper[0] - 0.006 && u < ATLAS.paper[1] + 0.006) {
        const ul = Math.min(
          1,
          Math.max(0, (u - ATLAS.paper[0]) / (ATLAS.paper[1] - ATLAS.paper[0])),
        );
        const mottle =
          wrapN(noise, ul, v, 3, 2) * 0.5 + wrapN(n2, ul, v, 7, 5) * 0.25;
        const fibre = wrapN(noise, ul, v, 120, 12);
        // soft wrinkles from wrapping, and a few sharp creases running along the stick
        const wrinkle = wrapN(n2, ul, v, 9, 2.2);
        const creaseLine =
          1 - smoothstep(0, 0.035, Math.abs(wrapN(noise, ul, v, 5, 1.1)));
        let k =
          1 + 0.07 * mottle + 0.03 * fibre + 0.04 * wrinkle - 0.07 * creaseLine;
        let h = wrinkle * 0.5 - creaseLine * 0.35 + fibre * 0.05;
        // the spiral seam: the overlapping edge stands proud, a shadow line below it
        const seam = (((ul + v * 0.35) % 1) + 1) % 1;
        if (seam > 0.495 && seam < 0.5) k *= 0.62;
        if (seam >= 0.5 && seam < 0.53) {
          k *= 1.06;
          h += 0.8;
        }
        // waxed, darker, glossier ends
        const end = Math.min(v, 1 - v);
        const wax = 1 - smoothstep(0.02, 0.07, end);
        k *= 1 - 0.25 * wax;
        let r = 0.72 * k;
        let g = 0.15 * k;
        let b = 0.12 * k;
        let ro = 1 - 0.45 * wax + 0.1 * mottle;
        // printed cream rings with dark pinstripes, the ink a little worn
        const ring = (lo: number, hi: number) => v > lo && v < hi;
        const inRing = ring(0.1, 0.17) || ring(0.83, 0.9);
        const wear =
          inRing || end < 0.2 ? 0.85 + 0.15 * wrapN(noise, ul, v, 40, 40) : 1;
        if (inRing) {
          const c = 0.92 * k * wear;
          r = c;
          g = 0.83 * k * wear;
          b = 0.64 * k * wear;
          h += 0.25;
          ro *= 1.1;
        }
        for (const e of [0.1, 0.17, 0.83, 0.9])
          if (Math.abs(v - e) < 0.004) r = g = b = 0.12 * wear;
        // dust settles on the foot
        const dust =
          v < 0.14
            ? (1 - smoothstep(0.0, 0.14, v)) *
              (0.5 + 0.5 * wrapN(n2, ul, v, 12, 12))
            : 0;
        r = r * (1 - 0.35 * dust) + 0.55 * 0.35 * dust;
        g = g * (1 - 0.35 * dust) + 0.45 * 0.35 * dust;
        b = b * (1 - 0.35 * dust) + 0.36 * 0.35 * dust;
        ro += 0.3 * dust;
        set(i, r, g, b);
        hgt[i] = h;
        rough[i] = ro;
        bump[i] = 1.2;
      } else if (
        u >= ATLAS.crimp.u0 - 0.01 &&
        u < ATLAS.crimp.u1 + 0.01 &&
        v < ATLAS.crimp.v1 + 0.02
      ) {
        // the folded end from above: creases running in, finer crinkles, a dark dimple in the middle
        const cx =
          (u - (ATLAS.crimp.u0 + ATLAS.crimp.u1) / 2) /
          ((ATLAS.crimp.u1 - ATLAS.crimp.u0) / 2);
        const cz =
          (v - (ATLAS.crimp.v0 + ATLAS.crimp.v1) / 2) /
          ((ATLAS.crimp.v1 - ATLAS.crimp.v0) / 2);
        const rr = Math.min(1.2, Math.hypot(cx, cz));
        const a = Math.atan2(cz, cx);
        const fold = Math.cos(a * PLEATS + noise.noise2(rr * 3, a) * 0.3);
        const crinkle =
          noise.noise2(cx * 18, cz * 18) * 0.5 +
          n2.noise2(cx * 45, cz * 45) * 0.3;
        const ridge = Math.pow(Math.abs(fold), 0.5) * Math.sign(fold);
        const inner = smoothstep(0.05, 0.9, rr);
        let k = 1 + 0.06 * crinkle + 0.1 * ridge * inner;
        k *= 0.55 + 0.45 * smoothstep(0.0, 0.25, rr);
        set(i, 0.88 * k, 0.76 * k, 0.55 * k);
        hgt[i] = ridge * inner * 0.9 + crinkle * 0.25;
        rough[i] = 0.85 + 0.15 * crinkle;
        bump[i] = 2.2;
      } else if (u >= ATLAS.rope[0] - 0.006 && u < ATLAS.rope[1] + 0.006) {
        const ul = Math.min(
          1,
          Math.max(0, (u - ATLAS.rope[0]) / (ATLAS.rope[1] - ATLAS.rope[0])),
        );
        // three strands laid in a spiral: each a rounded ridge, a dark groove between them
        const p = 3 * ul + 18 * v;
        const f = p - Math.floor(p);
        const strand = Math.pow(Math.sin(Math.PI * f), 0.6);
        // hemp fibres along the strand direction
        const fib =
          noise.noise2((ul * 3 + v * 18) * 2, (ul - v * 6) * 40) * 0.5;
        const k = (0.62 + 0.38 * strand) * (1 + 0.12 * fib);
        set(i, 0.8 * k, 0.64 * k, 0.42 * k);
        hgt[i] = strand + fib * 0.15;
        rough[i] = 1.1;
        bump[i] = 2.6;
      }
    }
  }

  // printed line on the wrap (needs a canvas: browser only)
  printWrap(col);

  const cdata = new Uint8Array(W * H * 4);
  const ndata = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const srgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c)));
      cdata[o] = srgb(col[i * 3]);
      cdata[o + 1] = srgb(col[i * 3 + 1]);
      cdata[o + 2] = srgb(col[i * 3 + 2]);
      cdata[o + 3] = 255;
      let nx = 0;
      let ny = 0;
      if (bump[i]) {
        const xl = y * W + Math.max(0, x - 1);
        const xr = y * W + Math.min(W - 1, x + 1);
        const yd = Math.max(0, y - 1) * W + x;
        const yu = Math.min(H - 1, y + 1) * W + x;
        if (bump[xl] && bump[xr]) nx = -(hgt[xr] - hgt[xl]) * bump[i];
        if (bump[yd] && bump[yu]) ny = -(hgt[yu] - hgt[yd]) * bump[i];
      }
      const l = Math.hypot(nx, ny, 1);
      ndata[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      ndata[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      ndata[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      ndata[o + 3] = Math.round(
        (Math.min(1.5, Math.max(0.3, rough[i])) / 1.5) * 255,
      );
    }

  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new DataTexture(data, W, H, RGBAFormat, UnsignedByteType);
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    // clamped round u (the regions sit side by side), repeating along v (the rope)
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  atlas = { map: make(cdata, true), normal: make(ndata, false) };
  return atlas;
}

/**
 * The printed line on the wrap: "HIGH EXPLOSIVE · HANDLE WITH CARE" running up the stick twice round it, worn ink
 * multiplied into the paper. Needs a canvas, so node (tests) gets plain paper.
 */
function printWrap(col: Float32Array): void {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const pw = (ATLAS.paper[1] - ATLAS.paper[0]) * W;
  g.fillStyle = '#1c1210';
  g.font = '800 21px "Arial Narrow", "Arial", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const at of [0.25, 0.75]) {
    g.save();
    // canvas rows run down, the stick's v up: drawn upside down here, copied flipped below, it reads bottom to top
    g.translate(ATLAS.paper[0] * W + at * pw, H / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('HIGH EXPLOSIVE  •  HANDLE WITH CARE', 0, 0);
    g.restore();
  }
  const img = g.getImageData(0, 0, W, H).data;
  const noise = new Noise2D(77);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = ((H - 1 - y) * W + x) * 4;
      const ink = 1 - img[s] / 255;
      if (ink <= 0) continue;
      const worn = ink * (0.75 + 0.25 * noise.noise2(x * 0.3, y * 0.3));
      const i = (y * W + x) * 3;
      for (let k = 0; k < 3; k++)
        col[i + k] = col[i + k] * (1 - worn) + 0.09 * worn;
    }
}
