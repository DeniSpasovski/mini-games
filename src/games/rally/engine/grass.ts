/**
 * Grass for the detail layer (grass_tuft / dry_grass / spring_grass): the tuft sheets the far cards show and the
 * blade strips of the near LOD. One palette per kind so both LODs match.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { Rng } from '../../../shared/rng';
import { coverageMips } from '../trees/materials';

type RGB = [number, number, number];
export type GrassKind = 'green' | 'dry' | 'spring';

interface Palette {
  root: RGB;
  tips: RGB[]; // weighted by order: mostly the first
  dead: RGB;
  heads: number; // share of seed stalks
  weeds: boolean;
}

const SHEET_SEED: Record<GrassKind, number> = {
  green: 81,
  dry: 82,
  spring: 83,
};

const PALETTES: Record<GrassKind, Palette> = {
  green: {
    root: [34, 44, 18],
    tips: [
      [118, 132, 62],
      [96, 120, 50],
      [140, 146, 78],
      [160, 150, 92],
    ],
    dead: [170, 150, 104],
    heads: 0.06,
    weeds: true,
  },
  dry: {
    root: [86, 72, 40],
    tips: [
      [214, 190, 132],
      [196, 170, 112],
      [226, 206, 156],
      [150, 140, 84],
    ],
    dead: [160, 130, 90],
    heads: 0.22,
    weeds: false,
  },
  spring: {
    root: [52, 84, 24],
    tips: [
      [128, 176, 64],
      [110, 158, 52],
      [150, 186, 80],
      [134, 160, 70],
    ],
    dead: [150, 150, 96],
    heads: 0.04,
    weeds: true,
  },
};

const rgb = (c: RGB, l = 1) =>
  `rgb(${Math.min(255, c[0] * l)},${Math.min(255, c[1] * l)},${Math.min(255, c[2] * l)})`;

/**
 * A tuft sheet: blades fan out of a few crowns (not a picket row), a dome-shaped top so the card has no flat edge,
 * thin tapered curved blades, mixed green / yellowing / dead blades, back blades darker, seed stalks and weed leaves.
 */
export function drawTuftSheet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: GrassKind,
): void {
  const p = PALETTES[kind];
  const rng = new Rng(SHEET_SEED[kind]);
  ctx.clearRect(0, 0, w, h);
  const crowns = 7;
  const blade = (
    x0: number,
    len: number,
    ang: number,
    bw: number,
    col: RGB,
    l: number,
  ) => {
    // Curved, tapered blade: bends further the longer it is (droop).
    const droop = ang * 0.9 + rng.range(-0.15, 0.15);
    const n = 6;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    let x = x0;
    let y = h;
    let a = ang;
    const step = len / n;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const half = bw * (1 - t * 0.92) * 0.5;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      left.push([x - nx * half, y - ny * half]);
      right.push([x + nx * half, y + ny * half]);
      x += Math.sin(a) * step;
      y -= Math.cos(a) * step;
      a += (droop / n) * (0.5 + t);
    }
    const g = ctx.createLinearGradient(0, h, 0, h - len);
    g.addColorStop(0, rgb(p.root, l));
    g.addColorStop(0.35, rgb(mix(p.root, col, 0.55), l));
    g.addColorStop(1, rgb(col, l));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const q of left) ctx.lineTo(q[0], q[1]);
    ctx.lineTo(x, y);
    for (let i = right.length - 1; i >= 0; i--)
      ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
    // Midrib highlight on wider blades.
    if (bw > 3.5) {
      ctx.strokeStyle = rgb(col, l * 1.18);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(left[0][0] + bw / 2, h);
      for (let i = 1; i <= n; i++)
        ctx.lineTo(
          (left[i][0] + right[i][0]) / 2,
          (left[i][1] + right[i][1]) / 2,
        );
      ctx.stroke();
    }
  };
  const pickTip = (): RGB => {
    const r = rng.next();
    if (r < 0.07) return p.dead;
    const i = Math.min(
      p.tips.length - 1,
      Math.floor(rng.next() ** 1.8 * p.tips.length),
    );
    return p.tips[i];
  };
  // Two passes: back (darker, shorter) then front (lighter).
  for (const pass of [0, 1]) {
    for (let c = 0; c < crowns; c++) {
      const cx = ((c + 0.5) / crowns + rng.range(-0.05, 0.05)) * w;
      const env = 1 - Math.abs(cx / w - 0.5) * 1.3; // dome: middle tallest
      const count = pass ? 40 : 28;
      for (let i = 0; i < count; i++) {
        const spread = rng.range(-1, 1);
        const ang = spread * 0.55 + rng.range(-0.08, 0.08);
        const len =
          h *
          env *
          rng.range(0.45, 0.98) *
          (pass ? 1 : 0.85) *
          (1 - Math.abs(spread) * 0.25);
        const bw = rng.range(3, 6.5) * (w / 512);
        blade(
          cx + spread * w * 0.03,
          len,
          ang,
          bw,
          pickTip(),
          (pass ? 1 : 0.72) * rng.range(0.85, 1.12),
        );
      }
      // Seed stalks: thin, straight, a spikelet head.
      const stalks = Math.round(rng.range(0, 6) * p.heads * 3);
      for (let i = 0; i < stalks; i++) {
        const ang = rng.range(-0.25, 0.25);
        const len = h * env * rng.range(0.85, 1.0);
        const x1 = cx + Math.sin(ang) * len;
        const y1 = h - Math.cos(ang) * len;
        ctx.strokeStyle = rgb(p.tips[0], 0.9);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, h);
        ctx.quadraticCurveTo(
          cx + Math.sin(ang) * len * 0.4,
          h - len * 0.5,
          x1,
          y1,
        );
        ctx.stroke();
        ctx.fillStyle = rgb(
          kind === 'green' ? [150, 140, 96] : p.tips[2],
          rng.range(0.8, 1),
        );
        for (let k = 0; k < 7; k++) {
          ctx.beginPath();
          ctx.ellipse(
            x1 + rng.range(-2, 2),
            y1 + k * 2.6,
            1.5,
            3.4,
            ang + rng.range(-0.4, 0.4),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }
  }
  // Low broadleaf weeds (plantain / clover-like) between the crowns.
  if (p.weeds)
    for (let i = 0; i < 3; i++) {
      const x = rng.range(0.1, 0.9) * w;
      for (let k = 0; k < 4; k++) {
        const a = rng.range(-1.1, 1.1);
        const len = rng.range(0.06, 0.11) * h;
        ctx.fillStyle = rgb(
          mix(p.tips[1], [60, 90, 30], 0.5),
          rng.range(0.8, 1.05),
        );
        ctx.save();
        ctx.translate(x, h);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -len / 2, len * 0.2, len / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
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

const sheets = new Map<GrassKind, Texture>();

/** The tuft sheet of a kind with bled colour and coverage-preserving mipmaps (tufts do not thin out with distance). */
export function grassSheet(kind: GrassKind): Texture {
  const t = sheets.get(kind);
  if (t) return t;
  const w = 512,
    h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawTuftSheet(ctx, w, h, kind);
  const data = dilateAndFlip(ctx.getImageData(0, 0, w, h).data, w, h);
  const mips = coverageMips(data, w, h, false);
  const dt = new DataTexture(data, w, h);
  dt.mipmaps = mips.main;
  dt.generateMipmaps = false;
  dt.magFilter = LinearFilter;
  dt.minFilter = LinearMipmapLinearFilter;
  dt.colorSpace = SRGBColorSpace;
  dt.anisotropy = 8;
  dt.needsUpdate = true;
  sheets.set(kind, dt);
  return dt;
}

/**
 * Near LOD: real blade strips (no alpha test, no card edges from any side), fanned out of 5 crowns, curved and
 * tapered, vertex colour root -> tip. blades * 5 triangles (one-sided strips, the material is DoubleSide).
 */
export function bladeTuftGeometry(
  seed: number,
  kind: GrassKind,
  width: number,
  height: number,
  blades = 72,
): BufferGeometry {
  const p = PALETTES[kind];
  const rng = new Rng(seed);
  const seg = 3;
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  // Crowns spread over the card tuft's footprint (a tight clump reads as bare ground from a few metres).
  const crowns = Array.from({ length: 5 }, () => [
    rng.range(-0.32, 0.32) * width,
    rng.range(-0.32, 0.32) * width,
  ]);
  for (let b = 0; b < blades; b++) {
    const [ox, oz] = crowns[b % crowns.length];
    // Root spread inside the crown; the blade leans away from the crown centre (a fountain, not a brush).
    const ra = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.next()) * 0.1;
    const cx = ox + Math.cos(ra) * rr;
    const cz = oz + Math.sin(ra) * rr;
    const yaw = ra + rng.range(-0.5, 0.5);
    const outer = rr / 0.1;
    const lean = 0.15 + outer * 0.75 + rng.range(-0.1, 0.15);
    const len = height * rng.range(0.55, 1.1) * (1 - outer * 0.3);
    // 2-3.5 cm: narrower blades fall between the pixels a few metres away.
    const bw = rng.range(0.02, 0.035);
    const tipC =
      rng.next() < 0.07
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
        col.push(lin(c[0] * l), lin(c[1] * l), lin(c[2] * l));
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
