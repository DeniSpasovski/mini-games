import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { Rng } from '../../../shared/rng';
import type { Season } from '../season';
import { coverageMips } from '../trees/materials';
import { merge, paint, shade } from './geo';
import { dilateAndFlip } from './grass';
import { groundLitCard } from './world-shading';

/**
 * Vineyard rows (cordon-trained vines on posts and wires, as in the Skopje plain): one asset instance is a 6 m stretch
 * of a row - a post, five gnarled trunks with their cordon arms on the bottom wire, two more wires, and the canopy as
 * leaf cards painted here per season (spring: young shoots near the cordon; summer: a full hedge with dark grapes;
 * autumn: yellow and rust leaves, picked).
 */

/** Length of one row segment (m): post to post. */
export const VINE_SEGMENT = 6;

type CanopyRange = { lo: number; hi: number; half: number };

/** Canopy height band (m above ground) and half thickness per season. */
const CANOPY: Record<Season, CanopyRange> = {
  spring: { lo: 0.82, hi: 1.3, half: 0.12 },
  summer: { lo: 0.7, hi: 1.95, half: 0.24 },
  autumn: { lo: 0.75, hi: 1.85, half: 0.2 },
};

/** Sheet: 512 px = 3 m of row (u repeats twice per segment), 256 px = the canopy band. */
const SW = 512;
const SH = 256;

const LEAF: Record<Season, string[]> = {
  spring: ['#9cc24a', '#b4d35c', '#88b03e', '#c3d873'],
  summer: ['#3f6b22', '#4e7d2a', '#5c8c31', '#36601e', '#6a9a3a'],
  autumn: ['#c99a2e', '#d8b23c', '#b5662a', '#9c4a22', '#a88a34', '#7f6a2a'],
};

/** One palmate vine leaf (5 lobes, the stem notch at the bottom). */
function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rot: number,
  fill: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    // Lobes from the outline's polar wave; a notch where the stem joins (a = pi/2, the bottom).
    const lobe = 0.72 + 0.28 * Math.abs(Math.cos(a * 2.5));
    const notch = 1 - 0.55 * Math.exp(-((a - Math.PI / 2) ** 2) * 18);
    const r = s * lobe * notch;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // Veins: slightly darker.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(0.6, s * 0.06);
  ctx.beginPath();
  for (const a of [
    -Math.PI / 2,
    -Math.PI / 2 - 1,
    -Math.PI / 2 + 1,
    -0.1,
    Math.PI + 0.1,
  ]) {
    ctx.moveTo(0, s * 0.3);
    ctx.lineTo(Math.cos(a) * s * 0.75, Math.sin(a) * s * 0.75);
  }
  ctx.stroke();
  ctx.restore();
}

/** A bunch of dark grapes hanging from (x, y). */
function bunch(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number) {
  const n = 14 + Math.floor(rng.next() * 10);
  const len = 16 + rng.next() * 10;
  for (let i = 0; i < n; i++) {
    const t = rng.next();
    const w = (1 - t) * 7 + 2;
    const bx = x + (rng.next() - 0.5) * 2 * w;
    const by = y + t * len;
    const r = 2.4 + rng.next() * 0.8;
    const k = 0.7 + rng.next() * 0.35;
    ctx.fillStyle = `rgb(${Math.round(52 * k)},${Math.round(34 * k)},${Math.round(68 * k)})`;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Paint the canopy sheet of a season (transparent background; x wraps). */
function drawCanopy(ctx: CanvasRenderingContext2D, season: Season) {
  const rng = new Rng(season.length * 977 + 5);
  const pal = LEAF[season];
  const count = season === 'spring' ? 260 : season === 'autumn' ? 900 : 1300;
  const size = season === 'spring' ? [7, 12] : [10, 17];
  // Leaves painted back to front: the deeper ones darker. A wrapped copy at the edges keeps the sheet tileable.
  for (let i = 0; i < count; i++) {
    const depth = i / count;
    const x = rng.next() * SW;
    // Spring shoots stay near the cordon (the bottom of the band); summer / autumn fill it, thinner at the edges.
    const v =
      season === 'spring'
        ? 1 - Math.pow(rng.next(), 1.6) * 0.95
        : 0.06 +
          0.88 * (0.5 + (rng.next() + rng.next() + rng.next() - 1.5) / 3);
    const y = v * SH;
    const s = size[0] + rng.next() * (size[1] - size[0]);
    const base = pal[Math.floor(rng.next() * pal.length)];
    const k = 0.55 + 0.45 * depth;
    const c = base.match(/\w\w/g)!.map((h) => Math.round(parseInt(h, 16) * k));
    const fill = `rgb(${c[0]},${c[1]},${c[2]})`;
    const rot = (rng.next() - 0.5) * 1.2;
    for (const dx of [0, -SW, SW])
      if (x + dx > -s * 1.2 && x + dx < SW + s * 1.2)
        leaf(ctx, x + dx, y, s, rot, fill);
    // Summer: bunches under the leaves along the fruiting zone (the lower third), half hidden.
    if (season === 'summer' && i === Math.floor(count * 0.55)) {
      for (let b = 0; b < 9; b++)
        bunch(
          ctx,
          rng,
          20 + rng.next() * (SW - 40),
          SH * (0.62 + rng.next() * 0.12),
        );
    }
  }
}

const sheets = new Map<Season, Texture>();

/** The canopy sheet of a season with bled colour and coverage-preserving mipmaps (like the grass sheets). */
export function vineSheet(season: Season): Texture {
  const t = sheets.get(season);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let data: Uint8Array;
  if (ctx) {
    drawCanopy(ctx, season);
    data = dilateAndFlip(ctx.getImageData(0, 0, SW, SH).data, SW, SH);
  } else data = new Uint8Array(SW * SH * 4); // no 2D canvas (tests)
  const dt = new DataTexture(data, SW, SH);
  dt.mipmaps = coverageMips(data, SW, SH, false).main;
  dt.generateMipmaps = false;
  dt.magFilter = LinearFilter;
  dt.minFilter = LinearMipmapLinearFilter;
  dt.colorSpace = SRGBColorSpace;
  dt.wrapS = RepeatWrapping;
  dt.anisotropy = 8;
  dt.needsUpdate = true;
  sheets.set(season, dt);
  return dt;
}

const materials = new Map<Season, MeshStandardMaterial>();
let a2c = false;

/** Canopy card material (alpha-tested, lit like the ground; wind sway like the grass). */
export function vineMaterial(season: Season): MeshStandardMaterial {
  let m = materials.get(season);
  if (m) return m;
  m = new MeshStandardMaterial({
    map: vineSheet(season),
    alphaTest: 0.5,
    side: DoubleSide,
    roughness: 0.9,
  });
  m.alphaToCoverage = a2c;
  m.name = `vine canopy ${season}`;
  m.defines = { RALLY_WIND: 0.04, RALLY_FOLIAGE: 0.3, RALLY_GROUND: 1 };
  groundLitCard(m, 'vine');
  materials.set(season, m);
  return m;
}

/** Alpha-to-coverage on the canopy cards when the renderer has MSAA. */
export function setVineAntialias(on: boolean): void {
  a2c = on;
  for (const m of materials.values())
    if (m.alphaToCoverage !== on) {
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
}

/** A plane card along the row (x) at depth z, y from lo to hi, u over the segment (2 sheet repeats) + `u0`. */
function rowCard(
  lo: number,
  hi: number,
  z: number,
  u0: number,
): BufferGeometry {
  const g = new PlaneGeometry(VINE_SEGMENT, hi - lo).toNonIndexed();
  g.translate(0, (lo + hi) / 2, z);
  const uv = g.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2 + u0);
  return g;
}

/** The canopy of a segment: both faces of the hedge, a middle card and a top card; normals up (ground lit). */
export function vineCanopy(
  seed: number,
  season: Season,
  far: boolean,
): BufferGeometry {
  const rng = new Rng(seed);
  const c = CANOPY[season];
  const parts = far
    ? [
        rowCard(c.lo, c.hi, 0, rng.next()),
        rowCard(c.lo, c.hi, c.half * 0.6, rng.next()),
      ]
    : [
        rowCard(c.lo, c.hi, -c.half, rng.next()),
        rowCard(c.lo, c.hi, c.half, rng.next()),
        rowCard(c.lo + 0.05, c.hi - 0.05, (rng.next() - 0.5) * 0.1, rng.next()),
      ];
  if (!far && season !== 'spring') {
    // The top of the hedge seen from above / a raised camera: a horizontal card.
    const top = new PlaneGeometry(VINE_SEGMENT, c.half * 2.2).toNonIndexed();
    top.rotateX(-Math.PI / 2);
    top.translate(0, c.hi - 0.08, 0);
    const uv = top.getAttribute('uv') as BufferAttribute;
    const u0 = rng.next();
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) * 2 + u0, 0.35 + uv.getY(i) * 0.3);
    parts.push(top);
  }
  for (const p of parts) {
    const n = p.getAttribute('normal') as BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  }
  return merge(parts);
}

/** A bent tube along `pts` (x, y, z triples) with radius r0 -> r1, `sides` around; non-indexed with uv. */
function tube(
  pts: number[][],
  r0: number,
  r1: number,
  sides: number,
): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const ring = (k: number) => {
    const p = pts[k];
    const q = pts[Math.min(pts.length - 1, k + 1)];
    const o = pts[Math.max(0, k - 1)];
    // Direction of the tube here and two axes across it.
    let dx = q[0] - o[0];
    let dy = q[1] - o[1];
    let dz = q[2] - o[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    // a = any vector not along d, crossed twice.
    const ax = Math.abs(dy) < 0.9 ? 0 : 1;
    const ay = Math.abs(dy) < 0.9 ? 1 : 0;
    let ux = ay * dz - 0 * dy;
    let uy = 0 * dx - ax * dz;
    let uz = ax * dy - ay * dx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const r = r0 + (r1 - r0) * (k / (pts.length - 1));
    const out: number[][] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = Math.cos(a) * ux + Math.sin(a) * vx;
      const ny = Math.cos(a) * uy + Math.sin(a) * vy;
      const nz = Math.cos(a) * uz + Math.sin(a) * vz;
      out.push([p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz]);
    }
    return out;
  };
  const rings = pts.map((_, k) => ring(k));
  for (let k = 0; k + 1 < rings.length; k++)
    for (let s = 0; s < sides; s++) {
      const a = rings[k][s];
      const b = rings[k][(s + 1) % sides];
      const c = rings[k + 1][s];
      const d = rings[k + 1][(s + 1) % sides];
      for (const v of [a, c, b, b, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(v[3], v[4], v[5]);
      }
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  return g;
}

/**
 * The wood of a segment (props material, vertex coloured): a post at the start, three wires, five trunks (gnarled,
 * ~0.85 m) with a cordon arm each way along the bottom wire. `near` = full detail; otherwise the post and trunks only.
 */
export function vineWood(seed: number, near: boolean): BufferGeometry {
  const rng = new Rng(seed * 7 + 3);
  const parts: BufferGeometry[] = [];
  const half = VINE_SEGMENT / 2;
  // Non-indexed like the tubes, so they merge.
  const post = new BoxGeometry(0.08, 2.05, 0.08).toNonIndexed();
  post.translate(0, 2.05 / 2 - 0.05, 0);
  post.rotateZ((rng.next() - 0.5) * 0.06);
  post.translate(-half, 0, 0);
  parts.push(
    shade(paint(post, '#7a5a3a', rng, 0.08), (_x, y) => 0.7 + 0.15 * y),
  );
  if (near)
    for (const y of [0.9, 1.45, 1.9]) {
      const w = new BoxGeometry(VINE_SEGMENT, 0.01, 0.01).toNonIndexed();
      w.translate(0, y, 0);
      parts.push(paint(w, '#8a8a86'));
    }
  for (let i = 0; i < 5; i++) {
    const x = -half + 0.6 + i * 1.2 + (rng.next() - 0.5) * 0.15;
    const lean = (rng.next() - 0.5) * 0.12;
    const pts: number[][] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push([
        x + Math.sin(t * 5 + i) * 0.03,
        t * 0.88,
        lean * t + Math.cos(t * 4 + i * 2) * 0.025,
      ]);
    }
    parts.push(
      paint(tube(pts, 0.045, 0.03, near ? 5 : 3), '#5a4632', rng, 0.12),
    );
    if (near)
      for (const dir of [-1, 1]) {
        const arm: number[][] = [];
        for (let k = 0; k <= 3; k++) {
          const t = k / 3;
          arm.push([
            x + dir * t * 0.55,
            0.88 + Math.sin(t * Math.PI) * 0.04,
            lean + Math.sin(t * 6 + i) * 0.015,
          ]);
        }
        parts.push(paint(tube(arm, 0.028, 0.016, 4), '#5d4935', rng, 0.12));
      }
  }
  return merge(parts);
}
