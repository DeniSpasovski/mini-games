import type { Group } from 'three';
import { startRowLandmark } from '../maps/ajvatovci/start-row';
import type { BuildingDef, MapDef } from '../maps/shared/types';
import type { StaticCollider } from '../physics/types';
import type { TerrainSampler } from './heightfield';
import type { ScatterInstance } from './scatter';
import type { World } from './world';

/**
 * Landmarks (MapDef.landmarks): hand-modelled groups of buildings, yards and props that replace the
 * placeholder box buildings under them. A landmark is a map-folder module; this file is the registry
 * and the interface the world uses. Everything but `build` is pure (runs in node tests).
 */
export interface Landmark {
  id: string;
  /** Inside the landmark's lots grown by `margin` m: keeps scatter (trees, grass) off them. */
  occupies(x: number, z: number, margin: number): boolean;
  /** Placeholder buildings (MapDef.buildings) this landmark stands in for: they are not placed. */
  replaces(b: BuildingDef): boolean;
  /** Solid parts (building boxes), added to the scatter chunks. */
  colliders(ground: TerrainSampler): StaticCollider[];
  /**
   * The raised ground the car drives on where the landmark has a kerb / sidewalk / step (NaN elsewhere):
   * physics only, the landmark draws the same surface itself.
   */
  groundOverride?(ground: TerrainSampler): (x: number, z: number) => number;
  /** Rally assets (trees, bushes) it stands among: added to the fixed scatter, so they get LOD / colliders. */
  instances(ground: TerrainSampler): ScatterInstance[];
  /** Geometry, built in a time-sliced job (yield now and then). Browser only. */
  build(world: World): Generator<void, Group | undefined>;
}

const REGISTRY: Record<string, Landmark> = {
  [startRowLandmark.id]: startRowLandmark,
};

export function landmarksOf(map: MapDef): Landmark[] {
  return (map.landmarks ?? []).map((id) => {
    const landmark = REGISTRY[id];
    if (!landmark) throw new Error(`Unknown landmark "${id}" in map ${map.id}`);
    return landmark;
  });
}
