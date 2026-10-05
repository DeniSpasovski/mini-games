import { Rng } from '../../../../shared/rng';
import { atlasKit, type AtlasLayout, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import * as B from './blueprint';

/**
 * Paint texture of the hand-built Zastava body (body.ts). The shell is unwrapped by plain
 * projection - body sides (z, y), top surfaces (z, x), nose / tail panels (x, y) - so everything
 * here is drawn in model-space metres and lands exactly on the matching geometry:
 * panel gaps, scuttle, sill strips, filler flap, then old-car wear (fading, rust, road dirt).
 */
export const ATLAS: AtlasLayout = {
  pxPerMetre: 360,
  width: 5.64,
  height: 4.31,
  bounds: { x: [-0.82, 0.82], y: [0.15, 1.45], z: [-2.3, 1.65] },
  charts: {
    left: [0.01, 0.01],
    right: [0.01, 1.33],
    top: [0.01, 2.65],
    front: [3.98, 0.01],
    rear: [3.98, 1.33],
    bottom: [3.98, 2.66],
  },
};
const { K, sidePx, topPx, frontPx, rearPx } = atlasKit(ATLAS);
const W = Math.ceil(ATLAS.width * K);
const H = Math.ceil(ATLAS.height * K);
const uv = ([x, y]: Pt): Pt => [x / W, y / H];

/** UVs of the body shell (s = +1 left side, -1 right side). */
export const uvSide = (s: number, z: number, y: number) =>
  uv(sidePx(s > 0 ? 'left' : 'right', z, y));
export const uvTop = (z: number, x: number) => uv(topPx(z, x));
export const uvFront = (x: number, y: number) => uv(frontPx(x, y));
export const uvRear = (x: number, y: number) => uv(rearPx(x, y));

type Chart = 'left' | 'right' | 'top' | 'front' | 'rear';
const BZ = ATLAS.bounds.z;
const BY = ATLAS.bounds.y;
const BX = ATLAS.bounds.x;
const SIZE: Record<Chart, Pt> = {
  left: [BZ[1] - BZ[0], BY[1] - BY[0]],
  right: [BZ[1] - BZ[0], BY[1] - BY[0]],
  top: [BZ[1] - BZ[0], BX[1] - BX[0]],
  front: [BX[1] - BX[0], BY[1] - BY[0]],
  rear: [BX[1] - BX[0], BY[1] - BY[0]],
};
/** Model-space point -> canvas px on a chart: sides (z, y), top (z, x), ends (x, y). */
const PX: Record<Chart, (a: number, b: number) => Pt> = {
  left: (z, y) => sidePx('left', z, y),
  right: (z, y) => sidePx('right', z, y),
  top: topPx,
  front: frontPx,
  rear: rearPx,
};

const SEAM = 'rgba(10,14,22,0.78)';
const SEAM_LIGHT = 'rgba(255,255,255,0.22)';

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed: number,
): void {
  const rng = new Rng(seed * 977 + 101);

  /** Run `draw` clipped to a chart. */
  const on = (
    chart: Chart,
    draw: (px: (a: number, b: number) => Pt) => void,
  ) => {
    const [cx, cy] = ATLAS.charts[chart];
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx * K, cy * K, SIZE[chart][0] * K, SIZE[chart][1] * K);
    ctx.clip();
    draw(PX[chart]);
    ctx.restore();
  };
  const sides = (
    draw: (px: (z: number, y: number) => Pt, s: number) => void,
  ) => {
    on('left', (px) => draw(px, 1));
    on('right', (px) => draw(px, -1));
  };
  const path = (px: (a: number, b: number) => Pt, pts: Pt[], close = false) => {
    ctx.beginPath();
    pts.forEach(([a, b], i) => {
      const [x, y] = px(a, b);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (close) ctx.closePath();
  };
  /** Panel gap: dark line with a thin catch-light beside it. */
  const seam = (px: (a: number, b: number) => Pt, pts: Pt[], close = false) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    path(px, pts, close);
    ctx.strokeStyle = SEAM_LIGHT;
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.strokeStyle = SEAM;
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const fill = (px: (a: number, b: number) => Pt, pts: Pt[], style: string) => {
    path(px, pts, true);
    ctx.fillStyle = style;
    ctx.fill();
  };
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  // --- base paint + sun fade / patina (whole atlas) --------------------------------------------
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, W, H);
  // Fading is scaled by how light the paint is: white haze over a dark colour (British racing
  // green) would turn it into a pale mid-tone instead of a deep, slightly weathered one.
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(info.base.slice(i, i + 2), 16) / 255,
  );
  const fade = 0.25 + 0.75 * (0.3 * r + 0.59 * g + 0.11 * b);
  for (let i = 0; i < 260; i++)
    blob(
      rng.range(0, W),
      rng.range(0, H),
      rng.range(30, 130),
      '255,255,255',
      rng.range(0.03, 0.09) * fade,
    );
  for (let i = 0; i < 200; i++)
    blob(
      rng.range(0, W),
      rng.range(0, H),
      rng.range(20, 90),
      '30,34,70',
      rng.range(0.03, 0.08),
    );

  // --- top: scuttle, bonnet + hatch shut lines ---------------------------------------------------
  const scuttle = (x: number) =>
    B.A_PILLAR[0][0] + 0.085 * (1 - (x / 0.71) ** 2);
  on('top', (px) => {
    // Chalky fade on the flat tops.
    for (let i = 0; i < 90; i++) {
      const [x, y] = px(rng.range(-2.1, 1.55), rng.range(-0.6, 0.6));
      blob(x, y, rng.range(25, 80), '255,255,255', rng.range(0.04, 0.1) * fade);
    }
    // Scuttle panel under the wipers.
    const xs = Array.from({ length: 21 }, (_, i) => -0.66 + i * 0.066);
    fill(
      px,
      [
        ...xs.map((x): Pt => [scuttle(x) + 0.012, x]),
        ...xs.reverse().map((x): Pt => [scuttle(x) + 0.062, x]),
      ],
      '#17191c',
    );
    // Bonnet: front-hinged panel between the wing tops, flaring out at the scuttle.
    for (const s of [1, -1])
      seam(px, [
        [1.565, 0.42 * s],
        [0.78, 0.425 * s],
        [0.71, 0.45 * s],
        [scuttle(0.6) + 0.07, 0.6 * s],
      ]);
    // Hatch: hinge line across the roof, sides just inside the pillars.
    seam(px, [
      [-1.9, 0.6],
      [-1.66, 0.625],
      [-1.26, 0.545],
      [-1.215, 0.5],
      [-1.2, 0],
      [-1.215, -0.5],
      [-1.26, -0.545],
      [-1.66, -0.625],
      [-1.9, -0.6],
    ]);
  });

  // --- sides ---------------------------------------------------------------------------------------
  const [a0, a1] = B.A_PILLAR;
  /** z of a line parallel to the A pillar, `off` metres behind it, at height y. */
  const aLine = (y: number, off: number) =>
    a0[0] + ((a1[0] - a0[0]) * (y - a0[1])) / (a1[1] - a0[1]) - off;
  const top = 1.29;
  sides((px, s) => {
    // Front door (frame runs up the A pillar and along the roof rail).
    seam(
      px,
      [
        [B.SEAM_FRONT, B.DOOR_BOTTOM + 0.02],
        [B.SEAM_FRONT, 0.86],
        [aLine(0.9, 0.105), 0.9],
        [aLine(top - 0.02, 0.105), top - 0.02],
        [aLine(top, 0.13), top],
        [B.SEAM_MID, top],
        [B.SEAM_MID, B.DOOR_BOTTOM],
        [B.SEAM_FRONT - 0.02, B.DOOR_BOTTOM],
      ],
      true,
    );
    // Rear door (rear edge follows the C pillar, then the wheel arch).
    seam(px, [
      [B.SEAM_MID, top],
      [-1.07, top + 0.004],
      [-1.105, top - 0.03],
      ...B.SEAM_REAR,
      [B.SEAM_MID, B.DOOR_BOTTOM],
    ]);
    // Sill panel under the doors.
    seam(px, [
      [0.62, B.DOOR_BOTTOM - 0.03],
      [-1.13, B.DOOR_BOTTOM - 0.03],
    ]);
    // Black rubbing strip along the bottom of the doors.
    fill(
      px,
      [
        [0.47, 0.345],
        [0.47, 0.4],
        [-1.085, 0.4],
        [-1.06, 0.345],
      ],
      '#131416',
    );
    // Filler flap on the left rear wing.
    if (s > 0) {
      ctx.lineWidth = 2;
      seam(
        px,
        [
          [-1.81, 0.585],
          [-1.81, 0.695],
          [-1.955, 0.695],
          [-1.955, 0.585],
        ],
        true,
      );
    }
    // Soft shadow hugging the flared arch lips, under the shoulder and under the crease.
    for (const a of [B.ARCH_F, B.ARCH_R]) {
      const [cx, cy] = px(a.z, B.WHEEL_R);
      ctx.beginPath();
      ctx.arc(cx, cy, (a.r + a.lipW + 0.014) * K, Math.PI, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15,20,40,0.13)';
      ctx.lineWidth = 9;
      ctx.stroke();
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(15,20,40,0.11)';
    const zl = Array.from({ length: 74 }, (_, i) => -2.09 + i * 0.05);
    path(
      px,
      zl.map((z): Pt => [z, B.shoulder(z) - 0.04]),
    );
    ctx.stroke();
    path(
      px,
      zl.map((z): Pt => [z, B.crease(z) - 0.012]),
    );
    ctx.stroke();
  });

  // --- wear ------------------------------------------------------------------------------------------
  const speck = (x: number, y: number, r: number) => {
    ctx.fillStyle =
      rng.next() < 0.6 ? 'rgba(112,64,40,0.6)' : 'rgba(70,52,84,0.45)';
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      r,
      r * rng.range(0.5, 1),
      rng.range(0, 3),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  };
  sides((px) => {
    // Rust: scabs clustered along the sills, the arch lips and the door edges.
    const scab = (z: number, y: number, n: number, spread: number) => {
      for (let i = 0; i < n; i++) {
        const [x, py] = px(
          z + (rng.next() - rng.next()) * spread,
          y + (rng.next() - rng.next()) * spread * 0.6,
        );
        speck(x, py, rng.range(0.6, 2.8) * (rng.next() < 0.12 ? 2 : 1));
      }
    };
    for (let i = 0; i < 16; i++)
      scab(rng.range(-2.05, 1.5), rng.range(0.26, 0.34), rng.int(5, 22), 0.07);
    for (const a of [B.ARCH_F, B.ARCH_R])
      for (let i = 0; i < 6; i++) {
        const t = rng.range(-0.1, Math.PI + 0.1);
        const r = a.r + rng.range(0.01, a.lipW + 0.02);
        scab(
          a.z + Math.cos(t) * r,
          B.WHEEL_R + Math.sin(t) * r,
          rng.int(5, 16),
          0.05,
        );
      }
    for (const z of [B.SEAM_FRONT, B.SEAM_MID, -1.25])
      for (let i = 0; i < 3; i++)
        scab(z, rng.range(0.34, 0.8), rng.int(4, 10), 0.025);
    for (let i = 0; i < 60; i++) {
      const [x, y] = px(rng.range(-2.1, 1.55), rng.range(0.26, 0.86));
      speck(x, y, rng.range(0.5, 1.4));
    }
    // Stains + streaks running down from the window sill and the trim.
    for (let i = 0; i < 46; i++) {
      const [x, y] = px(rng.range(-2.0, 1.5), rng.range(0.4, 0.84));
      blob(x, y, rng.range(10, 34), '86,70,110', rng.range(0.06, 0.16));
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const z = rng.range(-2.05, 1.5);
      const y0 = rng.next() < 0.5 ? B.shoulder(z) - 0.04 : rng.range(0.4, 0.8);
      const [x, y] = px(z, y0);
      const g = ctx.createLinearGradient(0, y, 0, y + rng.range(20, 70));
      g.addColorStop(0, 'rgba(40,36,50,0.16)');
      g.addColorStop(1, 'rgba(40,36,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, rng.range(1.2, 3), 70);
    }
    // Scratches.
    ctx.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const [x, y] = px(rng.range(-2.0, 1.5), rng.range(0.4, 0.85));
      ctx.strokeStyle = 'rgba(225,232,240,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-46, 46), y + rng.range(-5, 5));
      ctx.stroke();
    }
    // Road dirt: film rising from the sills, heavier behind each wheel.
    const [, yTop] = px(0, 0.62);
    const [, yBot] = px(0, 0.2);
    const film = ctx.createLinearGradient(0, yTop, 0, yBot);
    film.addColorStop(0, 'rgba(104,90,70,0)');
    film.addColorStop(0.55, 'rgba(104,90,70,0.2)');
    film.addColorStop(1, 'rgba(96,82,62,0.62)');
    ctx.fillStyle = film;
    ctx.fillRect(0, yTop, W, yBot - yTop);
    for (const a of [B.ARCH_F, B.ARCH_R])
      for (let i = 0; i < 260; i++) {
        const d = rng.next() ** 1.6;
        const [x, y] = px(
          a.z - a.r - 0.02 - d * 0.55,
          0.26 + rng.next() ** 1.4 * (0.42 - d * 0.25),
        );
        blob(x, y, rng.range(2, 9), '98,84,64', rng.range(0.12, 0.34));
      }
  });
  // Nose: bugs + grit; tail: road film sucked up behind the car.
  on('front', (px) => {
    for (let i = 0; i < 120; i++) {
      const [x, y] = px(rng.range(-0.66, 0.66), rng.range(0.25, 0.76));
      speck(x, y, rng.range(0.6, 1.8));
    }
    const [, y0] = px(0, 0.52);
    const [, y1] = px(0, 0.22);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(100,86,66,0)');
    g.addColorStop(1, 'rgba(100,86,66,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);
  });
  on('rear', (px) => {
    const [, y0] = px(0, 0.78);
    const [, y1] = px(0, 0.22);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(104,90,70,0.08)');
    g.addColorStop(1, 'rgba(100,86,66,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);
    for (let i = 0; i < 90; i++) {
      const [x, y] = px(rng.range(-0.66, 0.66), rng.range(0.27, 0.74));
      speck(x, y, rng.range(0.6, 2));
    }
  });
  on('top', (px) => {
    // Dust thrown onto the hatch + rust along the bonnet edges.
    for (let i = 0; i < 70; i++) {
      const [x, y] = px(rng.range(-2.1, -1.7), rng.range(-0.62, 0.62));
      blob(x, y, rng.range(8, 30), '104,90,70', rng.range(0.06, 0.16));
    }
    for (let i = 0; i < 110; i++) {
      const s = rng.next() < 0.5 ? 1 : -1;
      const [x, y] = px(
        rng.range(0.72, 1.56),
        s * (0.42 + rng.range(-0.012, 0.012)),
      );
      speck(x, y, rng.range(0.6, 1.7));
    }
  });
}

export const zastavaAtlas: CarAtlas = { width: W, height: H, paint };
