import type { Group } from 'three';
import { hilltopLandmark } from '../maps/ajvatovci/hilltop';
import { startRowLandmark } from '../maps/ajvatovci/start-row';
import { stationLandmark } from '../maps/ajvatovci/station';
import { propertiesLandmark } from '../maps/petralica/properties';
import { VODNO_LANDMARKS } from '../maps/vodno/landmarks';
import { osmFeaturesLandmark } from '../maps/vodno/landmarks/osm-features';
import type { BuildingDef, MapDef } from '../maps/shared/types';
import type { SurfaceId } from '../physics/surfaces';
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
  /**
   * How far the DRAWN terrain is cut at (x, z) (m), under a layer laid level with the ground (an unpaved track): the
   * mesh only, physics keeps the ground (`TerrainGenerator.sink`, like the road slabs).
   */
  meshSink?(): (x: number, z: number) => number;
  /**
   * Junction dressing (the barrier rows closing side-road mouths, marshals, parked emergency vehicles) is
   * not placed here: the landmark has its own (a paved apron, a gate barrier).
   */
  keepsClear?(x: number, z: number): boolean;
  /** The surface the car drives on where the landmark paves the ground (undefined elsewhere): physics only. */
  surfaceAt?(x: number, z: number): SurfaceId | undefined;
  /** Rally assets (trees, bushes) it stands among: added to the fixed scatter, so they get LOD / colliders. */
  instances(ground: TerrainSampler): ScatterInstance[];
  /** Geometry, built in a time-sliced job (yield now and then). Browser only. */
  build(world: World): Generator<void, Group | undefined>;
}

const REGISTRY: Record<string, Landmark> = {
  [startRowLandmark.id]: startRowLandmark,
  [hilltopLandmark.id]: hilltopLandmark,
  [stationLandmark.id]: stationLandmark,
  [propertiesLandmark.id]: propertiesLandmark,
  ...Object.fromEntries(VODNO_LANDMARKS.map((l) => [l.id, l])),
};

/** Landmarks built from the map's own data (its baked OSM features), after the hand-built ones (which they skip). */
const FROM_MAP: Record<string, (map: MapDef, others: Landmark[]) => Landmark> =
  {
    'vodno-osm-features': osmFeaturesLandmark,
  };

export function landmarksOf(map: MapDef): Landmark[] {
  const ids = map.landmarks ?? [];
  const fixed = ids
    .filter((id) => !FROM_MAP[id])
    .map((id) => {
      const landmark = REGISTRY[id];
      if (!landmark)
        throw new Error(`Unknown landmark "${id}" in map ${map.id}`);
      return landmark;
    });
  return [
    ...fixed,
    ...ids.filter((id) => FROM_MAP[id]).map((id) => FROM_MAP[id](map, fixed)),
  ];
}
