import {
  Matrix4,
  type PerspectiveCamera,
  type Scene,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { SurfaceId } from '../physics/surfaces';
import type { MapDef, RoadTexture } from '../maps/shared/types';
import { buildRoadMesh } from '../world/road-mesh';
import { World } from '../world/world';
import { TreeRenderer } from '../trees/draw';
import { TreeLibrary } from '../trees/load';
import type { QualitySettings } from '../engine/quality';

/**
 * What a viewer car stands on: the plain grass studio, or a short flat road (`ROAD_LENGTH` x `ROAD_WIDTH`, the car in
 * the middle) of a stage surface with a few trees behind it, so a car can be checked on gravel, tarmac or a city street,
 * wet in the rain (`weather=`: the road's own wet shading). The real road materials and trees, nothing else streamed.
 */
export const BACKDROPS: readonly {
  id: string;
  label: string;
  surface?: SurfaceId;
  texture?: RoadTexture;
}[] = [
  { id: 'studio', label: 'Studio (grass)' },
  { id: 'gravel', label: 'Gravel road', surface: 'gravel', texture: 'road' },
  {
    id: 'tarmac',
    label: 'Tarmac road',
    surface: 'tarmac',
    texture: 'road_tarmac',
  },
  {
    id: 'city',
    label: 'City street',
    surface: 'tarmac',
    texture: 'road_street',
  },
];

const ROAD_LENGTH = 50;
const ROAD_WIDTH = 5;
/** The trees round the road: [along, lateral (+ = left), species]. */
const TREES: [number, number, string][] = [
  [4, 9, 'pine_tree'],
  [11, -12, 'birch_tree'],
  [17, 14, 'pine_tree'],
  [21, -8, 'pine_tree'],
  [29, 10, 'birch_tree'],
  [33, -16, 'pine_tree'],
  [38, 8, 'pine_tree'],
  [44, -10, 'birch_tree'],
  [47, 18, 'pine_tree'],
  [8, -20, 'pine_tree'],
];

/** A flat world with just the road and the trees (`environment`: the viewer's own sky is used). */
function sceneMap(
  surface: SurfaceId,
  texture: RoadTexture | undefined,
  environment: MapDef['environment'],
): MapDef {
  const h = ROAD_LENGTH / 2;
  return {
    id: 'viewer',
    name: 'Viewer',
    country: 'mk',
    stages: [
      {
        id: 'viewer',
        name: 'Viewer',
        year: 2026,
        temps: {} as MapDef['stages'][number]['temps'],
        description: '',
        tyre: surface === 'gravel' ? 'gravel' : 'tarmac',
        timing: { start: 0, finishFromEnd: 0, splits: 0 },
      },
    ],
    seed: 1,
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    terrain: { baseHeight: 0, layers: [], edgeRise: 0, flatAreas: [] },
    road: {
      width: ROAD_WIDTH,
      shoulder: 0.4,
      ditch: 0,
      crown: 0,
      smoothing: 4,
      surface,
      texture,
      points: [
        [0, -h],
        [0, 0],
        [0, h],
      ],
    },
    scatter: [],
    roadside: [],
    props: TREES.map(([along, lateral, asset], i) => ({
      asset,
      along,
      lateral,
      rotY: i * 47,
      scale: 0.9 + (i % 3) * 0.12,
      variant: i,
    })),
    environment,
  };
}

/** The road and trees round the car; `frame` = the car's place (car space -> world): the road's middle, facing along it. */
export class StageBackdrop {
  readonly frame = new Matrix4();
  private constructor(
    private readonly trees: TreeRenderer,
    spot: Vector3,
    heading: number,
  ) {
    this.frame.makeRotationY(heading).setPosition(spot);
  }

  static async build(
    id: string,
    environment: MapDef['environment'],
    scene: Scene,
    renderer: WebGLRenderer,
    quality: QualitySettings,
  ): Promise<StageBackdrop> {
    const def = BACKDROPS.find((b) => b.id === id)!;
    const world = new World(
      sceneMap(def.surface ?? 'gravel', def.texture, environment),
    );
    const s = world.roadSpawn(ROAD_LENGTH / 2);
    const road = buildRoadMesh(world);
    // The road only: no start / finish gantries.
    road.getObjectByName('stage-signs')?.removeFromParent();
    scene.add(road);
    const library = await TreeLibrary.load(
      TreeLibrary.speciesOf(world.placedAssets()),
      renderer,
    );
    const trees = new TreeRenderer(world, library, {
      lodScale: quality.lodScale,
      maxDistance: 200,
      shadowDistance: quality.shadowExtent * 2 + 10,
      rebuildDistance: 15,
      budgetMs: 8,
    });
    scene.add(trees.group);
    trees.attachRenderer(renderer);
    return new StageBackdrop(trees, s.position, s.heading);
  }

  update(camera: PerspectiveCamera): void {
    this.trees.update(camera);
  }
}
