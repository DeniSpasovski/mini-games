import { getAssetMeta } from '../assets/catalog';
import { canBuildAway, hasAsset, requestAsset } from '../assets/library';
import { assetIds } from './instance-streamer';
import type { World } from './world';

/**
 * Asks the workers for the `lazy` levels the first frame needs (the people within reach of the spawn, and the warm
 * variants every shader compiles from) as soon as the world exists, so they are built while the rest of the load runs.
 * Resolves when all are in the cache. The streamer then finds them there (`InstanceStreamer.updateNow`).
 */
export function warmLevels(
  world: World,
  x: number,
  z: number,
  lodScale: number,
  maxDistance: number,
): Promise<void> {
  const wanted = new Map<string, [string, number, number]>();
  const want = (id: string, variant: number, lod: number): void => {
    if (!hasAsset(id, variant, lod))
      wanted.set(`${id}:${variant}:${lod}`, [id, variant, lod]);
  };
  const people = [...assetIds(world)].filter(
    (id) => canBuildAway(id) && getAssetMeta(id).lods.some((l) => l.lazy),
  );
  for (const id of people) {
    const meta = getAssetMeta(id);
    meta.lods.forEach((l, lod) => {
      if (l.lazy) for (const v of meta.warm ?? [0]) want(id, v, lod);
    });
  }
  for (const inst of world.scatter.fixedInstances()) {
    if (!people.includes(inst.asset)) continue;
    const dist = Math.hypot(inst.x - x, inst.z - z);
    if (dist > maxDistance) continue;
    const lods = getAssetMeta(inst.asset).lods;
    const lod = lods.findIndex((l) => dist < l.maxDistance * lodScale);
    if (lod >= 0 && lods[lod].lazy) want(inst.asset, inst.variant, lod);
  }
  if (!wanted.size) return Promise.resolve();
  return new Promise((resolve) => {
    let left = wanted.size;
    for (const [id, v, lod] of wanted.values())
      requestAsset(id, v, lod, () => --left === 0 && resolve());
  });
}
