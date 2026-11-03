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
import {
  atlasUv,
  CLUSTER_COLS,
  CLUSTER_ROWS,
  SPRAY_BASE,
  spriteAtlas,
} from '../trees/leaftex';
import {
  barkGain,
  barkNormalTexture,
  barkTexture,
  coverageMips,
} from '../trees/materials';
import { merge, paint, shade } from './geo';
import { groundLitCard } from './world-shading';

/**
 * Vineyard rows (cordon-trained vines on posts and wires, as in the Skopje plain): one asset instance is a 6 m stretch
 * of a row - a post, five gnarled trunks (the trees' scanned bark) with their cordon arms on the bottom wire, two more
 * wires, and the canopy as leaf cards painted here per season from the trees' lobed leaf sprays (spring: young shoots
 * near the cordon; summer: a full hedge with dark grapes; autumn: yellow and rust leaves, picked).
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

/**
 * Leaf colours (linear albedo), from the shade leaf to the sun leaf. Summer sits between the trees' oak and plane
 * palettes (trees/species.ts, measured: olive, red / green ~0.65, blue / green ~0.35); spring is the flush band of
 * trees/Foliage.md (lighter, yellower); autumn yellows and rusts at luminance ~0.15-0.2, greyer than a painted autumn.
 */
const LEAF: Record<Season, RGB[]> = {
  spring: [
    [0.085, 0.14, 0.042],
    [0.11, 0.165, 0.048],
    [0.1, 0.155, 0.05],
  ],
  summer: [
    [0.06, 0.095, 0.035],
    [0.075, 0.115, 0.04],
    [0.093, 0.144, 0.05],
    [0.085, 0.125, 0.042],
  ],
  autumn: [
    [0.21, 0.17, 0.07],
    [0.19, 0.14, 0.065],
    [0.17, 0.1, 0.055],
    [0.14, 0.12, 0.06],
    [0.12, 0.11, 0.05],
  ],
};

type RGB = [number, number, number];

/** Canes per sheet (3 m of row), their length (m) and how far up they point (rad from the row; VSP: up). */
const CANES: Record<
  Season,
  { count: number; len: [number, number]; up: [number, number] }
> = {
  spring: { count: 26, len: [0.35, 0.6], up: [0.7, 1.5] },
  summer: { count: 46, len: [1.0, 1.5], up: [0.9, 1.45] },
  autumn: { count: 40, len: [0.9, 1.4], up: [0.8, 1.45] },
};

const linToSrgb8 = (c: number) =>
  Math.round(
    255 *
      Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055),
  );
const srgb8ToLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * Paint the canopy sheet of a season (RGBA, row 0 = the bottom = the cordon; x wraps): canes of the trees' lobed leaf
 * style (trees/leaftex.ts, the oak / plane sprays: alternating leaves along a shoot) rising from the cordon, back to
 * front, the deeper ones darker; summer bunches in the fruiting zone.
 */
function drawCanopy(season: Season): Uint8Array {
  const atlas = spriteAtlas('lobed');
  const img = atlas.width / CLUSTER_COLS;
  const out = new Uint8Array(SW * SH * 4);
  const rng = new Rng(season.length * 977 + 5);
  const pal = LEAF[season];
  const cane = CANES[season];
  const c = CANOPY[season];
  const pxPerM = SW / (VINE_SEGMENT / 2);
  // Sheet y (px from the bottom) of a height above the ground: the sheet spans the canopy band.
  const band = c.hi - c.lo;
  const sy = SH / band;
  for (let i = 0; i < cane.count; i++) {
    const depth = i / cane.count;
    const k = 0.6 + 0.4 * depth;
    const col = pal[rng.int(0, pal.length - 1)].map(
      (v) => (v * k) / atlas.mean,
    );
    const im = rng.int(0, CLUSTER_COLS * CLUSTER_ROWS - 1);
    const len = rng.range(cane.len[0], cane.len[1]);
    const up = rng.range(cane.up[0], cane.up[1]) * (rng.next() < 0.5 ? 1 : -1);
    // The image's shoot runs along x from its base (SPRAY_BASE left of the centre): put that on the cordon.
    // Up and to the right, or mirrored up and to the left.
    const ang = up > 0 ? up : Math.PI + up;
    const scale = (len * pxPerM) / img; // sheet px per image px
    const bx = rng.next() * SW;
    const by = rng.range(-0.05, 0.12) * sy; // the cordon is at the bottom of the band
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const half = (img * scale) / 2;
    // Image centre: from the base along the shoot.
    const cx = bx + ca * SPRAY_BASE * img * scale;
    const cy = by + sa * SPRAY_BASE * img * scale;
    const r = half * 1.42;
    for (
      let y = Math.max(0, Math.floor(cy - r));
      y < Math.min(SH, Math.ceil(cy + r));
      y++
    )
      for (let xx = Math.floor(cx - r); xx < Math.ceil(cx + r); xx++) {
        const dx = xx + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // Into the image (u along the shoot, v across), 0..1.
        const u = (dx * ca + dy * sa) / (2 * half) + 0.5;
        const v = (-dx * sa + dy * ca) / (2 * half) + 0.5;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        const [au, av] = atlasUv(im, u, v);
        const t =
          (Math.floor(av * atlas.height) * atlas.width +
            Math.floor(au * atlas.width)) *
          4;
        if (atlas.albedo[t + 3] < 128) continue;
        const x = ((xx % SW) + SW) % SW;
        const o = (y * SW + x) * 4;
        for (let ch = 0; ch < 3; ch++)
          out[o + ch] = linToSrgb8(srgb8ToLin(atlas.albedo[t + ch]) * col[ch]);
        out[o + 3] = 255;
      }
    // Summer: bunches under the leaves in the fruiting zone (just above the cordon), half hidden.
    if (season === 'summer' && i === Math.floor(cane.count * 0.55))
      for (let b = 0; b < 9; b++)
        bunch(out, rng, 20 + rng.next() * (SW - 40), sy * rng.range(0.12, 0.3));
  }
  return bleed(out);
}

/** A bunch of dark grapes hanging from (x, y) (sheet px, y up). */
function bunch(out: Uint8Array, rng: Rng, x: number, y: number) {
  const n = 14 + Math.floor(rng.next() * 10);
  const len = 16 + rng.next() * 10;
  for (let i = 0; i < n; i++) {
    const t = rng.next();
    const w = (1 - t) * 7 + 2;
    const bx = x + (rng.next() - 0.5) * 2 * w;
    const by = y - t * len;
    const r = 2.4 + rng.next() * 0.8;
    const k = 0.7 + rng.next() * 0.35;
    const col = [52 * k, 34 * k, 68 * k];
    for (let py = Math.floor(by - r); py <= Math.ceil(by + r); py++)
      for (let px = Math.floor(bx - r); px <= Math.ceil(bx + r); px++) {
        if (py < 0 || py >= SH || (px - bx) ** 2 + (py - by) ** 2 > r * r)
          continue;
        const o = (py * SW + (((px % SW) + SW) % SW)) * 4;
        out[o] = col[0];
        out[o + 1] = col[1];
        out[o + 2] = col[2];
        out[o + 3] = 255;
      }
  }
}

/** Pushes the colour of the leaves into the transparent texels (filtering never pulls in black); x wraps. */
function bleed(d: Uint8Array): Uint8Array {
  for (let pass = 0; pass < 6; pass++) {
    const prev = d.slice();
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4;
        if (prev[i + 3] > 0 || (prev[i] | prev[i + 1] | prev[i + 2]) !== 0)
          continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const yy = y + dy;
          if (yy < 0 || yy >= SH) continue;
          const j = (yy * SW + ((x + dx + SW) % SW)) * 4;
          if (prev[j + 3] === 0 && (prev[j] | prev[j + 1] | prev[j + 2]) === 0)
            continue;
          r += prev[j];
          g += prev[j + 1];
          b += prev[j + 2];
          n++;
        }
        if (n) {
          d[i] = r / n;
          d[i + 1] = g / n;
          d[i + 2] = b / n;
        }
      }
  }
  return d;
}

const sheets = new Map<Season, Texture>();

/** The canopy sheet of a season with coverage-preserving mipmaps (like the grass atlases). */
export function vineSheet(season: Season): Texture {
  const t = sheets.get(season);
  if (t) return t;
  const data = drawCanopy(season);
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

/** The trunks' bark: the trees' stringy scanned bark (trees/bark/cedar.webp), a grapevine's shaggy trunk. */
const VINE_BARK = 'cedar';
/** Bark tiles per metre along a trunk (and twice that around, the tile's aspect). */
const BARK_TILING = 4;
let bark: MeshStandardMaterial | null = null;

/** The trunks' material: scanned bark tile + its normal tile over the vertex colour (the trees' bark, without their shader). */
export function vineBarkMaterial(): MeshStandardMaterial {
  if (bark) return bark;
  bark = new MeshStandardMaterial({
    vertexColors: true,
    map: barkTexture(VINE_BARK),
    normalMap: barkNormalTexture(VINE_BARK),
    roughness: 0.95,
  });
  bark.color.setScalar(barkGain(VINE_BARK));
  bark.name = 'vine bark';
  return bark;
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

/**
 * A bent tube along `pts` (x, y, z triples) with radius r0 -> r1, `sides` around; non-indexed, uv = bark tile (u
 * around, a whole number of times; v = metres along x BARK_TILING).
 */
function tube(
  pts: number[][],
  r0: number,
  r1: number,
  sides: number,
): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const around = Math.max(1, Math.round(2 * Math.PI * r0 * BARK_TILING * 2));
  let along = 0;
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
    let ux = ay * dz;
    let uy = -ax * dz;
    let uz = ax * dy - ay * dx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const r = r0 + (r1 - r0) * (k / (pts.length - 1));
    if (k > 0)
      along += Math.hypot(
        p[0] - pts[k - 1][0],
        p[1] - pts[k - 1][1],
        p[2] - pts[k - 1][2],
      );
    const out: number[][] = [];
    // sides + 1: the seam repeats the first vertex with u = around.
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = Math.cos(a) * ux + Math.sin(a) * vx;
      const ny = Math.cos(a) * uy + Math.sin(a) * vy;
      const nz = Math.cos(a) * uz + Math.sin(a) * vz;
      out.push([
        p[0] + nx * r,
        p[1] + ny * r,
        p[2] + nz * r,
        nx,
        ny,
        nz,
        (s / sides) * around,
        along * BARK_TILING,
      ]);
    }
    return out;
  };
  const rings = pts.map((_, k) => ring(k));
  for (let k = 0; k + 1 < rings.length; k++)
    for (let s = 0; s < sides; s++) {
      const a = rings[k][s];
      const b = rings[k][s + 1];
      const c = rings[k + 1][s];
      const d = rings[k + 1][s + 1];
      for (const v of [a, c, b, b, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(v[3], v[4], v[5]);
        uvs.push(v[6], v[7]);
      }
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  return g;
}

/**
 * The wood of a segment: `post` = the post and the three wires (props material, vertex coloured); else the five
 * gnarled trunks (~0.85 m) with a cordon arm each way along the bottom wire (`vineBarkMaterial`). `near` = full detail;
 * otherwise the post and the trunks only.
 */
export function vineWood(
  seed: number,
  near: boolean,
  post: boolean,
): BufferGeometry {
  const rng = new Rng(seed * 7 + 3);
  const parts: BufferGeometry[] = [];
  const half = VINE_SEGMENT / 2;
  // Non-indexed like the tubes, so they merge.
  const box = new BoxGeometry(0.08, 2.05, 0.08).toNonIndexed();
  box.translate(0, 2.05 / 2 - 0.05, 0);
  box.rotateZ((rng.next() - 0.5) * 0.06);
  box.translate(-half, 0, 0);
  const postPart = shade(
    paint(box, '#7a5a3a', rng, 0.08),
    (_x, y) => 0.7 + 0.15 * y,
  );
  if (post) {
    parts.push(postPart);
    if (near)
      for (const y of [0.9, 1.45, 1.9]) {
        const w = new BoxGeometry(VINE_SEGMENT, 0.01, 0.01).toNonIndexed();
        w.translate(0, y, 0);
        parts.push(paint(w, '#8a8a86'));
      }
    return merge(parts);
  }
  postPart.dispose();
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
    // Vertex colour: the bark's brown under the grey scan (x its gain in the material).
    parts.push(
      paint(tube(pts, 0.045, 0.03, near ? 6 : 3), '#7a5e46', rng, 0.12),
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
        parts.push(paint(tube(arm, 0.028, 0.016, 4), '#7d624a', rng, 0.12));
      }
  }
  return merge(parts);
}
