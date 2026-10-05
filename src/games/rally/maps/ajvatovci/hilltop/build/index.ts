import type { Group } from 'three';
import type { World } from '../../../../world/world';
import { Bucket } from '../../start-row/build/kit';
import { CHURCH, COURT, TOWER, toWorld, type Site } from '../site';
import { buildBellTower } from './bell-tower';
import { buildChurch } from './church';
import { buildCourt } from './court';
import { buildYard } from './yard';
import { Local } from './shapes';

/**
 * The hilltop landmark's geometry: the church, the bell tower, the courtyard (gravel, low wall) and the
 * court, each written into its own
 * tile of one bucket (merged per tile and material, ~20 meshes). A time-sliced job.
 */
export function* buildHilltop(world: World): Generator<void, Group> {
  const started = performance.now();
  const bucket = new Bucket();
  const at = (site: Site, tile: string) =>
    new Local(bucket, tile, site, world.analytic.height(site.x, site.z));
  buildChurch(at(CHURCH, 'church'));
  yield;
  buildBellTower(at(TOWER, 'tower'));
  yield;
  buildYard(bucket, (x, z) => world.analytic.height(x, z));
  yield;
  const court = at(COURT, 'court');
  buildCourt(court, (x, z) => {
    const [wx, wz] = toWorld(COURT, x, z);
    return world.analytic.height(wx, wz) - court.baseY;
  });
  yield;
  const group = bucket.build('hilltop');
  group.userData.stats = {
    triangles: bucket.triangles,
    meshes: group.children.length,
    ms: Math.round(performance.now() - started),
  };
  return group;
}
