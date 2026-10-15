import { atlasKit } from '../shared/atlas-painter';
import type { LiveryInfo } from '../shared/livery';
import type { CarAtlas } from '../shared/types';
import source from './model.source.json';

/**
 * Runtime paint for the Peugeot 206 BODY (imported GLB, atlas layout in model.source.json): the model has no livery, so this
 * is one flat paint colour (seed 0 = `model.paint`, other seeds the seed's base) over a dark underside. Glass, lamps, trim
 * and the cockpit are separate parts (`gltf.parts` in model.source.json), so nothing painted here can reach them.
 */
const A = source.atlas;
const { K, B, CH } = atlasKit(A);

function paint(ctx: CanvasRenderingContext2D, info: LiveryInfo): void {
  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Underside: dark undercoat wherever the body faces down.
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(
    CH.bottom[0] * K,
    CH.bottom[1] * K,
    (B.z[1] - B.z[0]) * K,
    (B.x[1] - B.x[0]) * K,
  );
}

export const peugeot206Livery: CarAtlas = {
  width: Math.ceil(A.width * K),
  height: Math.ceil(A.height * K),
  layout: A,
  paint,
};
