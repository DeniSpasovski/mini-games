import type { Group } from 'three';
import type { World } from '../../../../world/world';
import { ORIGIN } from '../frame';
import type { Build } from './ctx';
import { Bucket } from './kit';
import { buildLots } from './lots';
import { buildStreet } from './street';
import { buildFleet } from './vehicles';

/**
 * The start row's geometry: the Mileks building, the neighbours' lots (buildings, yards, fences,
 * bays) and the street dressing, all written into one bucket and merged per 64 m tile and
 * material. A time-sliced job: yields between the parts.
 */
export function* buildStartRow(world: World): Generator<void, Group> {
  const started = performance.now();
  const bucket = new Bucket();
  const ground = world.analytic;
  const b: Build = {
    bucket,
    ground: (x, z) => ground.height(x + ORIGIN.x, z + ORIGIN.z),
    pads: [],
  };
  buildLots(b);
  yield;
  buildStreet(b);
  yield;
  const group = bucket.build('start-row');
  group.add(buildFleet(b));
  yield;
  group.userData.stats = {
    /** Merged tile meshes' triangles (the fleet is instanced, counted separately). */
    triangles: bucket.triangles,
    meshes: group.children.length,
    ms: Math.round(performance.now() - started),
  };
  return group;
}
