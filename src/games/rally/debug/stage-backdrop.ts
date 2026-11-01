import {
  Matrix4,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { getStage, loadMap } from '../maps';
import { stageSeason } from '../maps/shared/climate';
import { mapInSeason } from '../maps/shared/season-map';
import type { MapDef } from '../maps/shared/types';
import { InstanceStreamer } from '../world/instance-streamer';
import { buildRoadMeshSliced } from '../world/road-mesh';
import { TerrainRenderer } from '../world/terrain-renderer';
import { Horizon } from '../world/horizon';
import { canopyTone } from '../world/far-forest';
import { World } from '../world/world';
import { TreeRenderer } from '../trees/draw';
import { TreeLibrary } from '../trees/load';
import type { QualitySettings } from '../engine/quality';
import type { Scene } from 'three';

/**
 * Where a viewer can stand a car: the plain grass studio, or a spot on a real stage (its terrain, road surface, trees,
 * buildings, sky and sun), so a car can be checked on tarmac, gravel or a city street, wet in the rain
 * (`weather=`, the road's own wet shading). `along` = metres along the stage road (default: the spot's own).
 */
export const BACKDROPS: readonly {
  id: string;
  label: string;
  stage?: string;
  along?: number;
}[] = [
  { id: 'studio', label: 'Studio (grass)' },
  {
    id: 'vodno',
    label: 'Mountain road, tarmac (Vodno)',
    stage: 'vodno',
    along: 900,
  },
  { id: 'jackie', label: 'City street (Jackie)', stage: 'jackie', along: 400 },
  {
    id: 'galichica',
    label: 'Mountain gravel (Galichica)',
    stage: 'galichica_west',
    along: 700,
  },
  {
    id: 'petralica',
    label: 'Forest gravel (Petralica)',
    stage: 'petralica',
    along: 500,
  },
  {
    id: 'ajvatovci',
    label: 'Village (Ajvatovci)',
    stage: 'ajvatovci',
    along: 300,
  },
];

/** How far (m) the backdrop draws round the car. */
const VIEW = 900;

/** A stage spot round the car: the world, its renderers and `frame` = the car's place (car space -> world). */
export class StageBackdrop {
  readonly frame = new Matrix4();
  private constructor(
    readonly map: MapDef,
    readonly world: World,
    private readonly terrain: TerrainRenderer,
    private readonly streamer: InstanceStreamer,
    private readonly trees: TreeRenderer,
    spot: Vector3,
    heading: number,
  ) {
    this.frame.makeRotationY(heading).setPosition(spot);
  }

  /** The stage's map (for the viewer's sky: build the shell with `map.environment`), before the world is built. */
  static loadMap(stage: string): Promise<MapDef> {
    return loadMap(getStage(stage).map);
  }

  static async build(
    map: MapDef,
    stage: string,
    along: number | undefined,
    scene: Scene,
    renderer: WebGLRenderer,
    quality: QualitySettings,
  ): Promise<StageBackdrop> {
    const info = getStage(stage);
    const season = stageSeason({
      season: info.season,
      environment: map.environment,
    });
    const world = new World(mapInSeason(map, season), info.id);
    const s = world.roadSpawn(along ?? world.stage.start + 200);
    const terrain = new TerrainRenderer(world, {
      viewDistance: VIEW,
      lodDistances: [120, 260, 520],
    });
    scene.add(terrain.group);
    const horizon = map.horizon ? new Horizon(world, map.horizon) : undefined;
    if (horizon) {
      horizon.setCutoff(VIEW);
      scene.add(horizon.group);
    }
    scene.add(
      await buildRoadMeshSliced(world, () => new Promise((r) => setTimeout(r))),
    );
    const streamer = new InstanceStreamer(world, {
      lodScale: quality.lodScale,
      detailDensity: quality.name === 'low' ? 0.5 : 1,
      rebuildDistance: 15,
      budgetMs: 8,
    });
    scene.add(streamer.group);
    const library = await TreeLibrary.load(
      TreeLibrary.speciesOf(world.placedAssets(), season),
      renderer,
    );
    // The land beyond the map: its woods in the stage's crown colour.
    horizon?.setForest(canopyTone(library, world));
    const trees = new TreeRenderer(world, library, {
      lodScale: quality.lodScale,
      maxDistance: VIEW,
      shadowDistance: quality.shadowExtent * 2 + 10,
      rebuildDistance: 15,
      budgetMs: 8,
    });
    scene.add(trees.group);
    trees.attachRenderer(renderer);
    const backdrop = new StageBackdrop(
      map,
      world,
      terrain,
      streamer,
      trees,
      s.position,
      s.heading,
    );
    // Everything round the spot at once: a debugger frame may take a while, the first view is complete.
    for (let i = 0; i < 400 && (terrain.pending > 0 || i < 3); i++)
      terrain.update(s.position, 200, 0);
    for (let i = 0; i < 80; i++) streamer.update(s.position);
    return backdrop;
  }

  /** Stream round what the camera looks at. */
  update(camera: PerspectiveCamera, target: Vector3): void {
    this.terrain.update(
      target,
      8,
      Math.max(0, camera.position.y - target.y) * 0.8,
    );
    this.streamer.update(target);
    this.trees.update(camera);
  }
}
