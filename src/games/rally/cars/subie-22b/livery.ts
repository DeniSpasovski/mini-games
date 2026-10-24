import { Rng } from '../../../../shared/rng';
import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Subaru WRX STI 22B BODY (converted GLB, atlas layout in model.source.json). Glass, lamps, mirrors and
 * trim are separate parts with their own materials, so only body panels get paint: blue base, dark undercoat and dust.
 */
const A = source.atlas;
const { K, B, CH, sidePx, frontPx, rearPx } = atlasKit(A);

/** Dust and mud on the lower body: a fade towards the sills on every chart, plus road-spray speckle round the arches. */
function weather(ctx: CanvasRenderingContext2D, seed: number): void {
  const rng = new Rng(0x22b + seed);
  const yTop = 0.5; // dirt starts this high
  const yLow = B.y[0];
  const px = (
    chart: 'left' | 'right' | 'front' | 'rear',
    z: number,
    y: number,
  ): Pt =>
    chart === 'front'
      ? frontPx(z, y)
      : chart === 'rear'
        ? rearPx(z, y)
        : sidePx(chart, z, y);
  const size = (chart: 'left' | 'right' | 'front' | 'rear') =>
    chart === 'front' || chart === 'rear'
      ? [B.x[1] - B.x[0], B.y[1] - B.y[0]]
      : [B.z[1] - B.z[0], B.y[1] - B.y[0]];
  for (const chart of ['left', 'right', 'front', 'rear'] as const) {
    const [cx, cy] = CH[chart];
    const [w, h] = size(chart);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx * K, cy * K, w * K, h * K);
    ctx.clip();
    const g = ctx.createLinearGradient(
      0,
      px(chart, 0, yTop)[1],
      0,
      px(chart, 0, yLow)[1],
    );
    g.addColorStop(0, 'rgba(112,92,64,0)');
    g.addColorStop(1, 'rgba(112,92,64,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(cx * K, cy * K, w * K, h * K);
    // Speckle: spray thrown up by the wheels, densest low down and round the arches (z of the axles).
    const arches = chart === 'left' || chart === 'right' ? [1.08, -1.46] : [0];
    for (let i = 0; i < 900; i++) {
      const arch = rng.pick(arches);
      const z =
        chart === 'left' || chart === 'right'
          ? arch + rng.gauss() * 0.45
          : rng.range(B.x[0], B.x[1]);
      const y = yLow + Math.abs(rng.gauss()) * 0.16;
      const [x0, y0] = px(chart, z, y);
      ctx.fillStyle = `rgba(${rng.int(70, 110)},${rng.int(55, 85)},${rng.int(40, 60)},${rng.range(0.1, 0.32)})`;
      ctx.beginPath();
      ctx.arc(x0, y0, rng.range(0.003, 0.011) * K, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function paint(
  ctx: CanvasRenderingContext2D,
  info: LiveryInfo,
  seed = 0,
): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Dark undercoat on the bottom chart (bumper / sill undersides).
  const [bx, by] = CH.bottom;
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(bx * K, by * K, (B.z[1] - B.z[0]) * K, (B.x[1] - B.x[0]) * K);

  weather(ctx, seed);
}

export const subie22bLivery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
