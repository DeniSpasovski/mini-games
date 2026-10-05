import { hash3, Rng } from '../../../shared/rng';

/**
 * Textures of the hand-modelled lots (maps/ajvatovci/start-row): render, sandwich panels, trapezoid
 * sheeting, roller doors, glass, yard asphalt, pavers, concrete, wire fence, roof membrane, solar
 * panels, striped barrier, signs. Drawn on canvases like every texture in `textures.ts`, which
 * registers them (`LOT_DEFS`). Wall textures are light neutrals: the meshes multiply a per-building
 * vertex colour on top. The metres each texture covers is written on its entry, and
 * `build/materials.ts` sets the UVs to match.
 *
 * (The noise helpers are small copies of the ones in `textures.ts`: that file imports this one.)
 */
export type LotTextureId =
  | 'lot_render'
  | 'lot_panel'
  | 'lot_sheet'
  | 'lot_roller_door'
  | 'lot_glass'
  | 'lot_asphalt'
  | 'lot_pavers'
  | 'lot_concrete'
  | 'lot_fence'
  | 'lot_roofing'
  | 'lot_solar'
  | 'lot_barrier'
  | 'lot_sign_mileks';

export interface LotTexDef {
  name: string;
  size: [number, number];
  color: boolean;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const lattice = (i: number, j: number, o: number, seed: number) =>
  hash3(i, j, o, seed) / 4294967296;

/** Tileable value-noise fbm, w*h values in [0,1]. */
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

/** Per-pixel colour from a coarse (`n`) and a fine (`n2`) noise field. */
function fillNoise(
  ctx: Ctx,
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

/** Draw at every wrap offset that touches the tile, so the shape tiles seamlessly. */
function wrap(
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  draw: (x: number, y: number) => void,
): void {
  for (const ox of [-w, 0, w])
    for (const oy of [-h, 0, h]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
      draw(px, py);
    }
}

/** Random 1-3 px grains over the whole tile (cheap surface grit). */
function grit(
  ctx: Ctx,
  w: number,
  h: number,
  seed: number,
  count: number,
  alpha: number,
): void {
  const rng = new Rng(seed);
  for (let i = 0; i < count; i++) {
    const dark = rng.chance(0.55);
    ctx.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${rng.range(0.3, 1) * alpha})`;
    const s = rng.range(0.8, 2.4);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Vertical rain / run-off streaks that fade out downwards. */
function streaks(
  ctx: Ctx,
  w: number,
  h: number,
  seed: number,
  count: number,
  alpha: number,
  color = '40,36,30',
): void {
  const rng = new Rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const len = rng.range(h * 0.12, h * 0.6);
    const sw = rng.range(1.5, 6);
    wrap(w, h, x, y, len, (px, py) => {
      const g = ctx.createLinearGradient(0, py, 0, py + len);
      g.addColorStop(0, `rgba(${color},${alpha * rng.range(0.4, 1)})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - sw / 2, py, sw, len);
    });
  }
}

/** A hairline crack: a short random walk. */
function crack(
  ctx: Ctx,
  w: number,
  h: number,
  rng: Rng,
  steps: number,
  step: number,
  color: string,
  width: number,
  heading?: number,
): void {
  let x = rng.next() * w;
  let y = rng.next() * h;
  let a = heading ?? rng.next() * Math.PI * 2;
  const pts: [number, number][] = [[x, y]];
  for (let k = 0; k < steps; k++) {
    a += rng.range(-0.6, 0.6);
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  wrap(w, h, pts[0][0], pts[0][1], steps * step, (px, py) => {
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (const [qx, qy] of pts)
      ctx.lineTo(px + qx - pts[0][0], py + qy - pts[0][1]);
    ctx.stroke();
  });
}

export const LOT_DEFS: Record<LotTextureId, LotTexDef> = {
  lot_render: {
    // 4 m x 4 m. Painted render: light mottled grey-white with trowel texture, rain run-off and a
    // few hairline cracks. Tint per building with the vertex colour.
    name: 'Lot: painted render (4 m)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([212, 210, 204], [240, 238, 232], n * 0.55 + n2 * 0.45),
        6,
        701,
      );
      streaks(ctx, w, h, 702, 70, 0.07);
      const rng = new Rng(703);
      for (let i = 0; i < 5; i++)
        crack(ctx, w, h, rng, 14, 7, 'rgba(60,56,50,0.35)', 0.8);
      grit(ctx, w, h, 704, 5000, 0.07);
    },
  },
  lot_panel: {
    // 4 m x 4 m. Insulated sandwich panels, 1 m wide, vertical micro-ribs and a shadow joint; each
    // panel a touch different in tone; a little dirt run-off.
    name: 'Lot: sandwich panel cladding (4 m, 1 m panels)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      const panel = w / 4;
      fillNoise(
        ctx,
        w,
        h,
        (n, n2, x) => {
          const k =
            0.965 +
            (0.05 * hash3(Math.floor(x / panel), 0, 7, 711)) / 4294967296;
          return mix([214, 215, 212], [236, 237, 234], n * 0.4 + n2 * 0.6).map(
            (c) => c * k,
          ) as RGB;
        },
        4,
        712,
      );
      // Micro-ribs (every 6 cm) as faint light / dark pairs.
      for (let x = 0; x < w; x += 7.7) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x, 0, 1.2, h);
        ctx.fillStyle = 'rgba(0,0,0,0.055)';
        ctx.fillRect(x + 1.8, 0, 1.4, h);
      }
      // Joints between panels: a dark groove with a lit edge.
      for (let i = 0; i < 4; i++) {
        const x = i * panel;
        ctx.fillStyle = 'rgba(30,32,34,0.55)';
        ctx.fillRect(x - 1.5, 0, 3, h);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x + 1.5, 0, 1.4, h);
      }
      streaks(ctx, w, h, 713, 40, 0.06);
      grit(ctx, w, h, 714, 2500, 0.05);
    },
  },
  lot_sheet: {
    // 2 m x 2 m. Trapezoid-profile steel sheeting: 25 cm pitch, lit left flank, shaded right flank,
    // screw heads on the crests every 50 cm, light weathering. Tint with the vertex colour.
    name: 'Lot: trapezoid steel sheeting (2 m)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      const pitch = w / 8;
      const img = ctx.createImageData(w, h);
      const n = tileNoise(w, h, 8, 4, 721);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = (x % pitch) / pitch;
          // valley 0-.36, rising flank .36-.46, crest .46-.74, falling flank .74-.84, valley .84-1
          let k: number;
          if (p < 0.36) k = 0.86;
          else if (p < 0.46) k = 0.86 + ((p - 0.36) / 0.1) * 0.22;
          else if (p < 0.74) k = 1.0;
          else if (p < 0.84) k = 1.0 - ((p - 0.74) / 0.1) * 0.3;
          else k = 0.78 + ((p - 0.84) / 0.16) * 0.08;
          const v = (200 + n[y * w + x] * 36) * k;
          const i = (y * w + x) * 4;
          img.data[i] = v;
          img.data[i + 1] = v * 1.01;
          img.data[i + 2] = v * 1.03;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      // Screws on the crests.
      for (let c = 0; c < 8; c++)
        for (let r = 0; r < 4; r++) {
          const x = c * pitch + pitch * 0.6;
          const y = (r + 0.5) * (h / 4);
          ctx.fillStyle = 'rgba(40,42,44,0.55)';
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(x - 1, y - 1.6, 1.2, 1);
        }
      streaks(ctx, w, h, 722, 24, 0.08, '70,50,34');
      grit(ctx, w, h, 723, 1800, 0.05);
    },
  },
  lot_roller_door: {
    // 1 m wide x 0.9 m tall = 12 slats of 7.5 cm. Embossed ribbed steel slats with a groove between
    // each, a faint dent here and there. Tint (white, grey, blue, green) with the vertex colour.
    name: 'Lot: roller door slats (1 m x 0.9 m)',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      const slat = h / 12;
      const rng = new Rng(731);
      ctx.fillStyle = '#d6d8d8';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) {
        const y = i * slat;
        const g = ctx.createLinearGradient(0, y, 0, y + slat);
        g.addColorStop(0, '#f0f1f1');
        g.addColorStop(0.18, '#e2e4e4');
        g.addColorStop(0.62, '#cfd2d3');
        g.addColorStop(1, '#a9adae');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, w, slat - 1.5);
        // Embossed rib in the middle of the slat.
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(0, y + slat * 0.42, w, 1.2);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(0, y + slat * 0.42 + 1.4, w, 1.2);
        // Groove between slats.
        ctx.fillStyle = 'rgba(20,22,24,0.75)';
        ctx.fillRect(0, y + slat - 1.5, w, 1.5);
      }
      // Soft dents and smudges.
      for (let i = 0; i < 16; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const r = rng.range(8, 26);
        wrap(w, h, x, y, r, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, `rgba(0,0,0,${rng.range(0.04, 0.1)})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      grit(ctx, w, h, 732, 500, 0.06);
    },
  },
  lot_glass: {
    // One pane (UV 0..1 per pane): dark blue-green glass, sky gradient from the top, a soft diagonal
    // reflection band, faint reflected skyline at the bottom. Reads as glazing at any size.
    name: 'Lot: glazing (one pane)',
    size: [128, 256],
    color: true,
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w * 0.5, h);
      g.addColorStop(0, '#8fb0c4');
      g.addColorStop(0.28, '#51707f');
      g.addColorStop(0.7, '#27363f');
      g.addColorStop(1, '#1b252c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Reflected skyline.
      const rng = new Rng(741);
      ctx.fillStyle = 'rgba(20,28,34,0.45)';
      for (let x = 0; x < w; x += 12) {
        const bh = rng.range(0.05, 0.22) * h;
        ctx.fillRect(x, h - bh, 12, bh);
      }
      // Diagonal glare bands.
      for (const [x0, bw, a] of [
        [0.15, 0.16, 0.16],
        [0.55, 0.07, 0.1],
      ] as const) {
        ctx.save();
        ctx.translate(w * x0, 0);
        ctx.transform(1, 0, -0.45, 1, 0, 0);
        const b = ctx.createLinearGradient(0, 0, w * bw, 0);
        b.addColorStop(0, 'rgba(255,255,255,0)');
        b.addColorStop(0.5, `rgba(255,255,255,${a})`);
        b.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = b;
        ctx.fillRect(0, 0, w * bw, h);
        ctx.restore();
      }
    },
  },
  lot_asphalt: {
    // 5 m x 5 m. Worn yard asphalt: dark aggregate, tar-filled cracks, repair patches, oil stains,
    // polished tyre tracks, a dusty film. Not tinted.
    name: 'Lot: yard asphalt (5 m)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([66, 66, 68], [104, 103, 100], n * 0.5 + n2 * 0.5),
        5,
        751,
      );
      const rng = new Rng(752);
      // Repair patches: slightly darker blocks with a tar edge.
      for (let i = 0; i < 5; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const pw = rng.range(30, 90);
        const ph = rng.range(20, 60);
        wrap(w, h, x, y, 100, (px, py) => {
          ctx.fillStyle = 'rgba(30,30,32,0.28)';
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = 'rgba(14,14,16,0.6)';
          ctx.lineWidth = 1.6;
          ctx.strokeRect(px, py, pw, ph);
        });
      }
      // Oil stains.
      for (let i = 0; i < 9; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const r = rng.range(8, 24);
        wrap(w, h, x, y, r, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(12,10,8,0.55)');
          g.addColorStop(0.6, 'rgba(20,18,14,0.22)');
          g.addColorStop(1, 'rgba(20,18,14,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 16; i++)
        crack(
          ctx,
          w,
          h,
          rng,
          rng.int(8, 22),
          8,
          'rgba(14,14,16,0.7)',
          rng.range(0.8, 1.8),
        );
      // Aggregate speckle.
      for (let i = 0; i < 9000; i++) {
        const v = rng.range(40, 170);
        ctx.fillStyle = `rgba(${v},${v},${v * 0.98},${rng.range(0.25, 0.7)})`;
        const s = rng.range(0.6, 1.6);
        ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
      }
    },
  },
  lot_pavers: {
    // 3.2 m x 3.2 m = 16 x 32 concrete blocks of 20 x 10 cm in stretcher bond. Per-block tone, lit
    // top-left edge, dark joints, dirt in the joints and a few moss-green blocks.
    name: 'Lot: concrete block paving (3.2 m)',
    size: [320, 320],
    color: true,
    draw(ctx, w, h) {
      const bw = 20;
      const bh = 10;
      const rng = new Rng(761);
      ctx.fillStyle = '#6f6c66';
      ctx.fillRect(0, 0, w, h);
      for (let row = 0; row < h / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < w / bw + 1; col++) {
          const x = col * bw + off;
          const y = row * bh;
          const k = rng.range(0.9, 1.1);
          const moss = rng.chance(0.04);
          const base: RGB = moss ? [128, 134, 112] : [158, 155, 148];
          ctx.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
          for (const ox of [-w, 0, w])
            ctx.fillRect(x + ox + 0.8, y + 0.8, bw - 1.6, bh - 1.6);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          for (const ox of [-w, 0, w]) {
            ctx.fillRect(x + ox + 0.8, y + 0.8, bw - 1.6, 0.8);
            ctx.fillRect(x + ox + 0.8, y + 0.8, 0.8, bh - 1.6);
          }
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          for (const ox of [-w, 0, w]) {
            ctx.fillRect(x + ox + 0.8, y + bh - 1.6, bw - 1.6, 0.8);
            ctx.fillRect(x + ox + bw - 1.6, y + 0.8, 0.8, bh - 1.6);
          }
        }
      }
      grit(ctx, w, h, 762, 1500, 0.1);
    },
  },
  lot_concrete: {
    // 4 m x 4 m: one concrete slab, joint along its left and top edge, hairline cracks, tyre and
    // damp stains. Light, so it can be tinted for kerbs and aprons.
    name: 'Lot: concrete slab (4 m)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([176, 174, 168], [208, 206, 199], n * 0.55 + n2 * 0.45),
        4,
        771,
      );
      const rng = new Rng(772);
      for (let i = 0; i < 6; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const r = rng.range(30, 90);
        wrap(w, h, x, y, r, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(60,56,50,0.12)');
          g.addColorStop(1, 'rgba(60,56,50,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      for (let i = 0; i < 5; i++)
        crack(ctx, w, h, rng, 16, 9, 'rgba(50,48,44,0.5)', 0.9);
      ctx.fillStyle = 'rgba(40,40,40,0.5)';
      ctx.fillRect(0, 0, w, 2.5);
      ctx.fillRect(0, 0, 2.5, h);
      grit(ctx, w, h, 773, 3500, 0.07);
    },
  },
  lot_fence: {
    // 0.5 m x 0.5 m, alpha: diamond wire mesh (6 cm), thin galvanised wire.
    name: 'Lot: wire mesh fence (0.5 m, alpha)',
    size: [128, 128],
    color: true,
    draw(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(170,176,182,1)';
      ctx.lineWidth = 2.6;
      const p = 16;
      ctx.beginPath();
      for (let k = -h; k <= w + h; k += p) {
        ctx.moveTo(k, 0);
        ctx.lineTo(k + h, h);
        ctx.moveTo(k, h);
        ctx.lineTo(k + h, 0);
      }
      ctx.stroke();
      // Knuckles at the crossings.
      ctx.fillStyle = 'rgba(190,196,202,0.9)';
      for (let y = 0; y <= h; y += p)
        for (let x = 0; x <= w; x += p) ctx.fillRect(x - 1, y - 1, 2, 2);
    },
  },
  lot_roofing: {
    // 4 m x 4 m. Flat-roof membrane: 1 m strips with a welded seam, grey with weathering and darker
    // damp patches. Tint per roof with the vertex colour.
    name: 'Lot: flat roof membrane (4 m)',
    size: [512, 512],
    color: true,
    draw(ctx, w, h) {
      fillNoise(
        ctx,
        w,
        h,
        (n, n2) => mix([150, 150, 146], [196, 195, 190], n * 0.5 + n2 * 0.5),
        4,
        781,
      );
      for (let i = 0; i < 4; i++) {
        const x = (i * w) / 4;
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x, 0, 2, h);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 2, 0, 2.2, h);
      }
      const rng = new Rng(782);
      for (let i = 0; i < 7; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const rx = rng.range(20, 60);
        const ry = rng.range(14, 40);
        wrap(w, h, x, y, rx, (px, py) => {
          ctx.fillStyle = `rgba(40,40,38,${rng.range(0.08, 0.2)})`;
          ctx.beginPath();
          ctx.ellipse(px, py, rx, ry, rng.next() * 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      grit(ctx, w, h, 783, 3000, 0.08);
    },
  },
  lot_solar: {
    // One panel, 1.65 m x 1.0 m (UV 0..1): 6 x 10 monocrystalline cells with silver busbars in a
    // white frame.
    name: 'Lot: solar panel (1.65 m x 1 m)',
    size: [330, 200],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#e4e6e8';
      ctx.fillRect(0, 0, w, h);
      const m = 7;
      const cw = (w - m * 2) / 10;
      const ch = (h - m * 2) / 6;
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 10; c++) {
          const x = m + c * cw;
          const y = m + r * ch;
          const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
          g.addColorStop(0, '#2a3a63');
          g.addColorStop(0.5, '#1c284a');
          g.addColorStop(1, '#25345a');
          ctx.fillStyle = g;
          ctx.fillRect(x + 0.8, y + 0.8, cw - 1.6, ch - 1.6);
          ctx.fillStyle = 'rgba(190,200,215,0.55)';
          for (const f of [0.33, 0.66])
            ctx.fillRect(x + cw * f, y + 0.8, 0.7, ch - 1.6);
        }
      const sheen = ctx.createLinearGradient(0, 0, w, h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
    },
  },
  lot_barrier: {
    // 1 m x 1 m: red and white diagonal stripes of 25 cm, for striped concrete barriers.
    name: 'Lot: red-white striped barrier (1 m)',
    size: [256, 256],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#efede8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c4322c';
      const s = w / 4;
      for (let k = -h; k < w + h; k += s * 2) {
        ctx.beginPath();
        ctx.moveTo(k, h);
        ctx.lineTo(k + s, h);
        ctx.lineTo(k + s + h, 0);
        ctx.lineTo(k + h, 0);
        ctx.fill();
      }
      grit(ctx, w, h, 791, 800, 0.1);
    },
  },
  lot_sign_mileks: {
    // 8 : 1 fascia sign of the Mileks building: teal lettering on white.
    name: 'Lot: Mileks-AS fascia sign',
    size: [1024, 128],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#f4f5f3';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1f7f86';
      ctx.font = '700 88px system-ui, "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MILEKS-AS', w / 2, h / 2 + 4);
      ctx.fillStyle = '#1f7f86';
      ctx.fillRect(0, h - 6, w, 6);
    },
  },
};
