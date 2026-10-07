import { atlasKit, type Pt } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Bimmer GT2 BODY (imported GLB, atlas layout in model.source.json). Glass, lamps, grille, wing,
 * splitter and diffuser are separate parts with their own materials (`gltf.parts` in model.source.json), so nothing
 * painted here can reach them. Clean base colour with a dark undercoat; livery elements are added step by step.
 */
const A = source.atlas;
const { K, B, CH } = atlasKit(A);

/** Dark undercoat on the bottom chart (bumper / sill undersides). */
function underside(ctx: CanvasRenderingContext2D): void {
  const pts: Pt[] = [
    [CH.bottom[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1]],
    [CH.bottom[0] + B.z[1] - B.z[0], CH.bottom[1] + B.x[1] - B.x[0]],
    [CH.bottom[0], CH.bottom[1] + B.x[1] - B.x[0]],
  ];
  ctx.fillStyle = '#2a2c2f';
  ctx.beginPath();
  pts.forEach(([x, y], i) =>
    i ? ctx.lineTo(x * K, y * K) : ctx.moveTo(x * K, y * K),
  );
  ctx.closePath();
  ctx.fill();
}

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  underside(ctx);
}

export const bimmerGt2Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  paint,
};
