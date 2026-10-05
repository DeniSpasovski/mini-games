import { atlasKit, type AtlasLayout, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import * as B from './blueprint';

/**
 * Paint texture of the hand-built Skoda Rally body (body.ts). The shell is unwrapped by plain
 * projection - body sides (z, y), top surfaces (z, x), nose / tail panels (x, y) - so everything
 * here is drawn in model-space metres and lands exactly on the matching geometry. For now: base
 * paint, panel gaps and soft shading (the imported body has its own livery painter, livery.ts).
 */
export const ATLAS: AtlasLayout = {
  pxPerMetre: 300,
  width: 6.27,
  height: 4.83,
  bounds: { x: [-0.95, 0.95], y: [0.08, 1.5], z: [-2.25, 2.05] },
  charts: {
    left: [0.01, 0.01],
    right: [0.01, 1.45],
    top: [0.01, 2.89],
    front: [4.33, 0.01],
    rear: [4.33, 1.45],
    bottom: [4.33, 2.89],
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
const PX: Record<Chart, (a: number, b: number) => Pt> = {
  left: (z, y) => sidePx('left', z, y),
  right: (z, y) => sidePx('right', z, y),
  top: topPx,
  front: frontPx,
  rear: rearPx,
};

const SEAM = 'rgba(10,14,22,0.7)';
const SEAM_LIGHT = 'rgba(255,255,255,0.18)';

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
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
  const sides = (draw: (px: (z: number, y: number) => Pt) => void) => {
    on('left', draw);
    on('right', draw);
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
    ctx.lineWidth = 3.6;
    ctx.stroke();
    ctx.strokeStyle = SEAM;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  };
  const stroke = (
    px: (a: number, b: number) => Pt,
    pts: Pt[],
    style: string,
    width: number,
  ) => {
    path(px, pts);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  // --- base paint ------------------------------------------------------------------------------
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, W, H);
  // Underside chart: dark undercoat.
  const [bx, by] = ATLAS.charts.bottom;
  ctx.fillStyle = '#23262a';
  ctx.fillRect(bx * K, by * K, SIZE.top[0] * K, SIZE.top[1] * K);

  // --- top: bonnet + tailgate shut lines -----------------------------------------------------
  on('top', (px) => {
    for (const s of [1, -1]) {
      // Bonnet: from the headlight's inner corner back to the scuttle, hugging the wing top.
      seam(px, [
        [1.9, 0.44 * s],
        [1.6, 0.62 * s],
        [1.0, 0.7 * s],
        [0.8, 0.72 * s],
      ]);
    }
    // Scuttle / wiper trough under the windscreen.
    const xs = Array.from({ length: 17 }, (_, i) => -0.72 + i * 0.09);
    path(px, [
      ...xs.map((x): Pt => [0.86 - 0.11 * (x / 0.75) ** 2 + 0.005, x]),
      ...xs.reverse().map((x): Pt => [0.86 - 0.11 * (x / 0.75) ** 2 + 0.05, x]),
    ]);
    ctx.closePath();
    ctx.fillStyle = '#17191c';
    ctx.fill();
    // Tailgate: hinge line under the roof lip, down the quarter edges.
    seam(px, [
      [-1.9, 0.72],
      [-1.63, 0.6],
      [-1.6, 0],
      [-1.63, -0.6],
      [-1.9, -0.72],
    ]);
  });

  // --- sides: door gaps, arch shading -----------------------------------------------------
  sides((px) => {
    const [a0, a1] = B.A_PILLAR;
    const aLine = (y: number, off: number) =>
      a0[0] + ((a1[0] - a0[0]) * (y - a0[1])) / (a1[1] - a0[1]) - off;
    const top = B.RAIL_Y - 0.03;
    // Front door: shut line down from the belt, frame up the A pillar and along the rail.
    seam(
      px,
      [
        [B.SEAM_FRONT, B.DOOR_BOTTOM + 0.02],
        [B.SEAM_FRONT, B.belt(B.SEAM_FRONT) - 0.01],
        [aLine(0.95, 0.09), 0.95],
        [aLine(top, 0.1), top],
        [B.SEAM_MID, top],
        [B.SEAM_MID, B.DOOR_BOTTOM],
        [B.SEAM_FRONT - 0.02, B.DOOR_BOTTOM],
      ],
      true,
    );
    // Rear door: rear edge follows the quarter glass, then round the rear arch.
    seam(px, [
      [B.SEAM_MID, top],
      [-1.06, top + 0.004],
      [-1.1, top - 0.03],
      ...B.SEAM_REAR,
      [B.SEAM_MID, B.DOOR_BOTTOM],
    ]);
    // Soft shadow under the belt and round the flare bands.
    const zl = Array.from({ length: 70 }, (_, i) => -2.0 + i * 0.05);
    stroke(
      px,
      zl
        .filter((z) => z <= B.Z_BELT_F && z >= B.Z_BELT_R)
        .map((z): Pt => [z, B.belt(z) - 0.035]),
      'rgba(15,20,40,0.1)',
      5,
    );
    for (const a of [B.ARCH_F, B.ARCH_R]) {
      const o = a.opening;
      stroke(
        px,
        o.map(([z, y]): Pt => [z, y + a.lipW + 0.012]),
        'rgba(15,20,40,0.14)',
        7,
      );
    }
    // Road film rising from the sills.
    const [, yTop] = px(0, 0.5);
    const [, yBot] = px(0, 0.18);
    const film = ctx.createLinearGradient(0, yTop, 0, yBot);
    film.addColorStop(0, 'rgba(96,86,70,0)');
    film.addColorStop(1, 'rgba(96,86,70,0.28)');
    ctx.fillStyle = film;
    ctx.fillRect(0, yTop, W, yBot - yTop);
  });

  // --- nose / tail: shading under the lamps, black lower bumper band ------------------------
  on('front', (px) => {
    const [, y0] = px(0, 0.3);
    const [, y1] = px(0, 0.16);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(60,56,50,0)');
    g.addColorStop(1, 'rgba(60,56,50,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);
  });
  on('rear', (px) => {
    const [, y0] = px(0, 0.6);
    const [, y1] = px(0, 0.42);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(60,56,50,0)');
    g.addColorStop(1, 'rgba(60,56,50,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);
  });
}

export const skodaRallyAtlas: CarAtlas = { width: W, height: H, paint };
