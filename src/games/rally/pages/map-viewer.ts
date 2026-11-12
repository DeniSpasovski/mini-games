import {
  Box2,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { paramOneOf } from '../../../shared/url-params';
import { track } from '../../../shared/analytics';
import {
  CAMERA_LINK_DEFAULTS,
  showViewerLoading,
  ViewerShell,
} from '../debug/viewer-shell';
import {
  DEFAULT_STAGE,
  getMapInfo,
  getStage,
  loadMap,
  MAPS,
  stagesOf,
} from '../maps';
import { isTestMap, isTestStage, listLabel, TEST_NOTE } from '../release';
import { stageSeason } from '../maps/shared/climate';
import { mapInSeason } from '../maps/shared/season-map';
import { SEASON_LABELS, SEASONS, seasonParam } from '../season';
import { offeredWeathers } from '../weather';
import { loadQuality } from '../engine/quality';
import { InstanceStreamer } from '../world/instance-streamer';
import { TreeRenderer } from '../trees/draw';
import { TreeLibrary } from '../trees/load';
import { TreeStatsOverlay } from '../trees/overlay';
import { worldToGeo } from '../world/real-data';
import { newRoadQuery } from '../world/road';
import { buildRoadMeshSliced } from '../world/road-mesh';
import { batchRoad } from '../world/static-batch';
import { getTerrainMaterial } from '../world/terrain-material';
import { canopyTone, FarForest, forestColor } from '../world/far-forest';
import { setForest } from '../engine/world-shading';
import { Horizon } from '../world/horizon';
import { TerrainRenderer } from '../world/terrain-renderer';
import { RENDER_MARGIN, World } from '../world/world';
import type { GroundSample } from '../physics/types';
import { SURFACES } from '../physics/surfaces';

/**
 * Map viewer: aerial view of one stage on its map, for quick iteration. Opens framed on the stage's route and streams
 * around it; the rest of the map streams in where the camera goes.
 *   map-viewer.html?map=test&stage=test&scatter=1&road=1&grid=0&splat=0&drain=0&fog=0&labels=1&along=1100&zoom=0.5
 * `stage` = the stage shown (its route, start / splits / finish, closures and fans; default the map's first). Old links
 * `map=<stage id>` open that stage on its map. Distances (`along`, the 250 m ticks, "Drive from here") are along the
 * stage road, in the stage's direction. `season` = spring | summer | autumn (ground, leaves; default the stage's own, as in the game).
 * `weather=rain_heavy|fog|...` (a change reloads) and `tod=<hours>` (time of day; default the map's own hour) are read by
 * `Environment` from the URL (pickers: `ViewerShell.addWeatherAndTime`, as in the car viewer).
 * "Copy camera link" (Camera section) shares the exact view (`cam`, `look`, `fov`, `clean`).
 * Panel: Map (map / stage / season / weather / time pickers), Camera, Layers, Picked point, Buildings, Stats, Credits, Scene, Help.
 */
const DEFAULTS = {
  map: DEFAULT_STAGE,
  /** Stage id on the map; '' = its first stage. */
  stage: '',
  /** Season shown; '' = the stage's own. */
  season: '',
  weather: 'dry',
  /** Hour of day; -1 = the map's own. */
  tod: -1,
  scatter: true,
  road: true,
  grid: false,
  splat: false,
  /** Drainage lines and culverts (MapDef.culverts, scripts/realmap/culverts.py). */
  drain: false,
  fog: false,
  labels: true,
  wire: false,
  /** Real-world maps: focus + inspect this building id ("stage 1 - building 12"). */
  building: 0,
  /** Fly to this distance along the stage road (m); 0 = overview. `zoom` scales the camera offset (default 1). */
  along: 0,
  zoom: 1,
  // Shared camera: cam / look / fov / clean (see "Copy camera link").
  ...CAMERA_LINK_DEFAULTS,
};
const state = readUrlState(DEFAULTS);
{
  // `map` may be a stage id (old links, the game's ids): open that stage on its map.
  const info = getMapInfo(state.map);
  if (info.id !== state.map && !state.stage)
    state.stage = getStage(state.map).id;
  state.map = paramOneOf(
    info.id,
    MAPS.map((m) => m.id),
    getStage(DEFAULT_STAGE).map,
  );
  if (!stagesOf(state.map).some((st) => st.id === state.stage))
    state.stage = stagesOf(state.map)[0]?.id ?? '';
  state.weather = paramOneOf(
    state.weather,
    offeredWeathers(),
    DEFAULTS.weather,
  );
}
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);
/** Start / split / finish / distance labels: the display face (italic, as the HUD plates). */
const LABEL_FONT = 'italic 700 40px "Barlow Condensed", sans-serif';
/** Streaming time per frame (ms): terrain, then objects, then the tree job get what is left. */
const STREAM_MS = 6;
/** The tree job's slice of it (ms). */
const TREE_JOB_MS = 2;
/** Land around the stage's route that the opening view frames and streams (m). */
const STAGE_MARGIN = 300;
// An old `map=<stage id>` link (or a map with several stages): the URL now names the map and its stage.
sync();
track('rally', 'select_content', {
  game_content_type: 'map_viewer',
  game_content_id: state.map,
});

// The map's baked data is loaded on demand (own chunk), so the viewer body runs once it is here.
const loaded = showViewerLoading(`Loading ${getMapInfo(state.map).name} …`);
void loadMap(state.map).then(async (map) => {
  const b = map.bounds;
  const mapSize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const stageDef = stagesOf(map.id).find((st) => st.id === state.stage);
  const shell = new ViewerShell({
    title: 'Map viewer',
    ground: false,
    // Long maps: the whole-map views sit further away than the default far plane.
    far: Math.max(8000, mapSize * 3),
    env: {
      ...map.environment,
      fogDensity: state.fog ? map.environment.fogDensity : 0.00005,
    },
  });
  const { scene, camera, controls, renderer } = shell;
  // No frames while the world builds: the first view is streamed in and its shaders compiled off the main thread first (below).
  shell.paused = true;
  const ownSeason = stageSeason({
    season: stageDef?.season,
    environment: map.environment,
  });
  const season = seasonParam(state.season, ownSeason);
  const world = new World(mapInSeason(map, season), state.stage || undefined);
  // The stage's route (start -> finish) with STAGE_MARGIN around it: what the views frame and the streaming reaches,
  // not the whole map (a map may hold several stages: Galichica's is 3x the size of one).
  const route = new Box2();
  for (let d = world.stage.start; ; d += 20) {
    const p = world.stageRoad.at(Math.min(d, world.stage.finish));
    route.expandByPoint(new Vector2(p.x, p.z));
    if (d >= world.stage.finish) break;
  }
  route.expandByScalar(STAGE_MARGIN);
  const size = Math.max(route.max.x - route.min.x, route.max.y - route.min.y);
  const center = new Vector3(
    (route.min.x + route.max.x) / 2,
    0,
    (route.min.y + route.max.y) / 2,
  );
  // Mountain maps: orbit around the ground, not sea level.
  center.y = world.analytic.height(center.x, center.z);

  // --- world rendering -----------------------------------------------------------------
  const viewDistance = size + RENDER_MARGIN * 2;
  // The trees load in the workers (trees/load.ts) while the road builds here.
  const treesLoading = TreeLibrary.load(
    TreeLibrary.speciesOf(world.placedAssets(), season),
    renderer,
  );
  const terrain = new TerrainRenderer(world, {
    viewDistance,
    lodDistances: [120, 260, 520],
  });
  scene.add(terrain.group);
  let horizon: Horizon | undefined;
  if (map.horizon) {
    horizon = new Horizon(world, map.horizon);
    horizon.setCutoff(viewDistance);
    scene.add(horizon.group);
  }
  const road = await buildRoadMeshSliced(
    world,
    () => new Promise((r) => setTimeout(r)),
  );
  // One multi-draw per material, as in the game: unbatched the road's tiles were ~1,100 draw calls on Ajvatovci.
  batchRoad(road);
  scene.add(road);
  const quality = loadQuality();
  // The game's object distances (InstanceStreamer in game/rally-game.ts): the viewer drew them 2.5-4x farther, up to
  // 14 M scatter triangles a frame from 120 m up.
  const streamer = new InstanceStreamer(world, {
    lodScale: quality.lodScale,
    detailDensity: 0,
    maxDistance: viewDistance,
    // People close up are built off the main thread, as in the game: built here they were 100-450 ms hitches.
    prefetch: true,
    rebuildDistance: 25,
    budgetMs: STREAM_MS,
  });
  streamer.group.visible = state.scatter;
  scene.add(streamer.group);
  const treeLibrary = await treesLoading;
  // Trees as in the game (game/rally-game.ts) out to its forest distance, then its far trees and canopy shell: every
  // tree on the map drawn one by one (500 k impostors on Galichica's overview) was most of the viewer's frame. Not the
  // game's impostor-only trees far from the road (`fakeFrom`) nor its coarser levels on medium: seen from above, the
  // impostors read as blobs.
  const trees = new TreeRenderer(world, treeLibrary, {
    lodScale: quality.lodScale,
    // The job only visits the scatter it draws; the rest of the map's, for the far forest's canopy map, comes from
    // `scatterFill` after the first frame (generated up front it held the first frame back for seconds).
    maxDistance: quality.forestDistance + 2 * world.scatter.chunkSize,
    forestDistance: quality.forestDistance,
    shadowDistance: quality.treeShadowDistance,
    rebuildDistance: 25,
    budgetMs: TREE_JOB_MS,
  });
  trees.group.visible = state.scatter;
  scene.add(trees.group);
  trees.attachRenderer(renderer);
  const farForest = new FarForest(
    world,
    treeLibrary,
    quality.forestDistance,
    viewDistance,
    renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float'),
  );
  farForest.renderer = renderer;
  trees.group.add(farForest.mesh);
  if (farForest.farTrees) trees.group.add(farForest.farTrees);
  horizon?.setForest(canopyTone(treeLibrary, world), farForest.canopy);
  setForest(forestColor(treeLibrary), quality.forestDistance);
  const treeStats = new TreeStatsOverlay(
    renderer.domElement.parentElement ?? document.body,
    trees,
    treeLibrary,
  );

  // --- overlays ------------------------------------------------------------------------------
  const overlays = new Group();
  scene.add(overlays);
  // Marker labels in the display face (STYLEGUIDE.md): loaded before they are drawn into their canvases.
  await document.fonts.load(LABEL_FONT).catch(() => undefined);
  const plate = `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--ui-glass-rgb').trim() || '10 11 13'} / 0.85)`;
  const roadLine = buildRoadLine();
  const markers = buildMarkers();
  const stageLines = buildStageLines();
  const drainage = buildDrainage();
  overlays.add(roadLine, stageLines, markers, drainage);
  drainage.visible = state.drain;
  stageLines.visible = state.labels;
  roadLine.visible = state.road;
  markers.visible = state.labels;
  // Built when first shown (a height sample every 8 m of every chunk edge on the map).
  let chunkGrid: LineSegments | undefined;
  const showGrid = (v: boolean): void => {
    if (v && !chunkGrid) overlays.add((chunkGrid = buildChunkGrid()));
    if (chunkGrid) chunkGrid.visible = v;
  };
  showGrid(state.grid);
  getTerrainMaterial().userData.uniforms.uDebugSplat.value = state.splat
    ? 1
    : 0;

  function buildRoadLine(): Line {
    const s = world.road.samples;
    const pos = new Float32Array(s.length * 3);
    const col = new Float32Array(s.length * 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of s) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const c = new Color();
    s.forEach((p, i) => {
      pos.set([p.x, p.y + 2, p.z], i * 3);
      c.setHSL(0.66 - ((p.y - minY) / (maxY - minY || 1)) * 0.66, 1, 0.5);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    return new Line(
      g,
      new LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        transparent: true,
      }),
    );
  }

  function label(text: string, color: string): Sprite {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    // A glass plate with an edge in the marker's colour, as the HUD plates.
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 6, 64);
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 33);
    const s = new Sprite(
      new SpriteMaterial({
        map: new CanvasTexture(c),
        depthTest: false,
        sizeAttenuation: false,
      }),
    );
    s.scale.set(0.12, 0.03, 1);
    s.renderOrder = 20;
    return s;
  }

  /** The stage's start -> finish as a thick orange line. */
  function buildStageLines(): Group {
    const g = new Group();
    const pts: number[] = [];
    for (let d = world.stage.start; d <= world.stage.finish; d += 4) {
      const p = world.stageRoad.at(d);
      pts.push(p.x, p.y + 3, p.z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.add(
      new Line(
        geo,
        new LineBasicMaterial({
          color: 0xffa020,
          depthTest: false,
          transparent: true,
        }),
      ),
    );
    return g;
  }

  function buildMarkers(): Group {
    const g = new Group();
    const st = world.stage;
    const pole = (along: number, text: string, color: string) => {
      const p = world.stageRoad.at(along);
      const m = new Mesh(
        new CylinderGeometry(0.8, 0.8, 30, 8),
        new MeshBasicMaterial({ color }),
      );
      m.position.set(p.x, p.y + 15, p.z);
      g.add(m);
      const l = label(text, color);
      l.position.set(p.x, p.y + 34, p.z);
      g.add(l);
    };
    pole(st.start, 'START', '#40e070');
    st.splits.forEach((s, i) => pole(s, `SPLIT ${i + 1}`, '#40a0ff'));
    pole(st.finish, 'FINISH', '#ff5050');
    for (const f of map.terrain.flatAreas) {
      if (f.label === false) continue;
      const l = label(f.name ?? 'flat', '#f0c040');
      l.position.set(f.x, world.heightAt(f.x, f.z) + 20, f.z);
      g.add(l);
    }
    // Distance ticks every 250 m along the stage road.
    for (let d = 250; d < world.stageRoad.length; d += 250) {
      const p = world.stageRoad.at(d);
      const l = label(`${d} m`, '#ffffff');
      l.scale.set(0.07, 0.0175, 1);
      l.position.set(p.x, p.y + 8, p.z);
      g.add(l);
    }
    return g;
  }

  /** Drainage lines near the road (blue, darker = larger catchment) and the culverts (magenta poles, pipe axis). */
  function buildDrainage(): Group {
    const g = new Group();
    const c = new Color();
    // Flat ribbons (a line is one pixel from the overview height), wider and darker with the catchment.
    for (const ln of map.culverts?.lines ?? []) {
      const k = Math.min(1, Math.log10(Math.max(1, ln.area)) / 2);
      const hw = 1.5 + 3 * k;
      const pos: number[] = [];
      const n = ln.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let tx = ln.pts[b * 2] - ln.pts[a * 2];
        let tz = ln.pts[b * 2 + 1] - ln.pts[a * 2 + 1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const x = ln.pts[i * 2];
        const z = ln.pts[i * 2 + 1];
        const y = world.gen.height(x, z) + 1.2;
        pos.push(x - tz * hw, y, z + tx * hw, x + tz * hw, y, z - tx * hw);
      }
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++)
        idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const geo = new BufferGeometry();
      geo.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(pos), 3),
      );
      geo.setIndex(idx);
      c.setHSL(0.58, 1, 0.7 - 0.35 * k);
      const ribbon = new Mesh(
        geo,
        new MeshBasicMaterial({
          color: c.clone(),
          depthTest: false,
          transparent: true,
          opacity: 0.85,
          side: DoubleSide,
        }),
      );
      ribbon.renderOrder = 10;
      g.add(ribbon);
    }
    for (const s of world.gen.culverts) {
      const [a, b] = s.ends;
      const ends = [a, b].map((e) => [
        s.x + s.ax * e.side * e.u,
        e.invert + s.diameter / 2,
        s.z + s.az * e.side * e.u,
      ]);
      const geo = new BufferGeometry();
      geo.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(ends.flat()), 3),
      );
      g.add(
        new Line(
          geo,
          new LineBasicMaterial({ color: 0xff40ff, depthTest: false }),
        ),
      );
      const pole = new Mesh(
        new CylinderGeometry(0.6, 0.6, 20, 8),
        new MeshBasicMaterial({ color: 0xff40ff }),
      );
      pole.position.set(s.x, s.y + 10, s.z);
      g.add(pole);
      const along = world.stageDef.reverse
        ? world.road.length - s.along
        : s.along;
      const l = label(`${Math.round(along)} m ${s.area} ha`, '#ff40ff');
      l.scale.set(0.09, 0.0225, 1);
      l.position.set(s.x, s.y + 24, s.z);
      g.add(l);
    }
    return g;
  }

  function buildChunkGrid(): LineSegments {
    const cs = world.heightfield.chunkSize;
    const m = RENDER_MARGIN;
    const x0 = Math.floor((b.minX - m) / cs) * cs;
    const x1 = Math.ceil((b.maxX + m) / cs) * cs;
    const z0 = Math.floor((b.minZ - m) / cs) * cs;
    const z1 = Math.ceil((b.maxZ + m) / cs) * cs;
    const pts: number[] = [];
    const step = 8;
    const seg = (ax: number, az: number, bx: number, bz: number) => {
      pts.push(
        ax,
        world.gen.height(ax, az) + 0.6,
        az,
        bx,
        world.gen.height(bx, bz) + 0.6,
        bz,
      );
    };
    for (let x = x0; x <= x1; x += cs)
      for (let z = z0; z < z1; z += step) seg(x, z, x, z + step);
    for (let z = z0; z <= z1; z += cs)
      for (let x = x0; x < x1; x += step) seg(x, z, x + step, z);
    // Map bounds in orange.
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    return new LineSegments(
      g,
      new LineBasicMaterial({
        color: 0x00e0ff,
        transparent: true,
        opacity: 0.45,
      }),
    );
  }

  // --- panel -----------------------------------------------------------------------------------
  // Map, stage and season: a change reloads the page (the world is built for one stage in one season).
  const pick = shell.panel.section('Map');
  pick.select(
    'Map',
    map.id,
    MAPS.map((m) => ({
      value: m.id,
      label: listLabel(
        m.stages.length > 1 ? `${m.name} (${m.stages.length} stages)` : m.name,
        isTestMap(m.stages.map((st) => st.id)),
      ),
    })),
    (id) => {
      // Camera, focus, season and time belong to the old map: the new one opens on its overview in its own season.
      Object.assign(state, {
        map: id,
        stage: DEFAULTS.stage,
        cam: DEFAULTS.cam,
        look: DEFAULTS.look,
        fov: DEFAULTS.fov,
        along: DEFAULTS.along,
        zoom: DEFAULTS.zoom,
        building: DEFAULTS.building,
        season: DEFAULTS.season,
        tod: DEFAULTS.tod,
      });
      sync(true);
      location.reload();
    },
  );

  // The stages on this map (the one shown: its route, start / finish, closures, fans).
  const stages = stagesOf(map.id);
  const stagePick = pick.select(
    'Stage',
    world.stageDef.id,
    stages.map((st) => ({
      value: st.id,
      label: listLabel(st.name, isTestStage(st.id)),
    })),
    (id) => {
      Object.assign(state, { stage: id, along: DEFAULTS.along });
      sync(true);
      location.reload();
    },
  );
  stagePick.el.querySelector('select')!.disabled = stages.length < 2;
  // The season of the ground and the leaves (the game's Season picker); the stage's own is marked.
  pick.select(
    'Season',
    season,
    SEASONS.map((id) => ({
      value: id,
      label:
        id === ownSeason ? `${SEASON_LABELS[id]} (stage)` : SEASON_LABELS[id],
    })),
    (id) => {
      state.season = id;
      sync(true);
      location.reload();
    },
  );
  // Maps with fixed sun angles (no `timeOfDay`) ignore `tod`: no hour picker there.
  const ownHour = map.environment.timeOfDay;
  shell.addWeatherAndTime(
    pick,
    state,
    sync,
    ownHour === undefined ? undefined : { tod: DEFAULTS.tod, hour: ownHour },
  );
  // A linked hour: re-light as a picker change does (the night bloom on High, as in the car viewer).
  if (state.tod !== DEFAULTS.tod) shell.setHour(state.tod);
  const shown = world.stageDef;
  pick.note(
    isTestStage(shown.id)
      ? `${TEST_NOTE}. ${shown.description}`
      : shown.description,
  );

  const view = shell.panel.section('Camera');
  view.buttons([
    ['Top down', () => topDown()],
    ['Oblique', () => oblique()],
    ['Start line', () => focusAlong(world.stage.start)],
  ]);
  shell.addCameraShare(view, state, sync);

  const layers = shell.panel.section('Layers');
  layers.checkbox('Scatter (trees, props)', state.scatter, (v) => {
    state.scatter = v;
    streamer.group.visible = v;
    trees.group.visible = v;
    sync();
  });
  const treeDebug = layers.select(
    'Tree debug',
    String(trees.debugMode),
    [
      { value: '0', label: 'off' },
      { value: '1', label: 'levels, fades, flicker' },
      { value: '2', label: 'lighting only' },
      { value: '3', label: 'normals only' },
      { value: '4', label: 'depth' },
      { value: '5', label: 'equal-depth misses (?treeprepass=1)' },
    ],
    (v) => (trees.debugMode = Number(v)),
  );
  layers.checkbox('Road centreline (height colour)', state.road, (v) => {
    state.road = v;
    roadLine.visible = v;
    sync();
  });
  layers.checkbox('Stage route + markers', state.labels, (v) => {
    state.labels = v;
    markers.visible = v;
    stageLines.visible = v;
    sync();
  });
  layers.checkbox('Chunk grid (64 m)', state.grid, (v) => {
    state.grid = v;
    showGrid(v);
    sync();
  });
  if (map.culverts)
    layers.checkbox('Drainage + culverts', state.drain, (v) => {
      state.drain = v;
      drainage.visible = v;
      sync();
    });
  layers.checkbox('Surface splat colours', state.splat, (v) => {
    state.splat = v;
    getTerrainMaterial().userData.uniforms.uDebugSplat.value = v ? 1 : 0;
    sync();
  });
  layers.checkbox('Terrain wireframe', state.wire, (v) => {
    state.wire = v;
    getTerrainMaterial().wireframe = v;
    getTerrainMaterial(false, true).wireframe = v;
    sync();
  });
  layers.checkbox('Fog', state.fog, (v) => {
    state.fog = v;
    shell.envDef.fogDensity = v ? map.environment.fogDensity : 0.00005;
    shell.env.apply(shell.envDef);
    sync();
  });

  const pickSec = shell.panel.section('Picked point');
  const pickInfo = pickSec.info();
  const pickLinks = pickSec.html('Click the terrain to inspect it.');

  if (world.buildings.buildings.length) {
    const bsec = shell.panel.section('Buildings');
    const counts = { house: 0, flat: 0 };
    for (const bd of world.buildings.buildings) counts[bd.type]++;
    bsec.info()({
      total: world.buildings.buildings.length,
      'sloped roof': counts.house,
      'flat roof': counts.flat,
    });
    bsec.number('Go to #', state.building, (v) => focusBuilding(v), {
      min: 1,
      placeholder: 'building id',
    });
  }

  const statInfo = shell.panel.section('Stats', false).info();
  let roadMin = Infinity;
  let roadMax = -Infinity;
  for (const s of world.road.samples) {
    roadMin = Math.min(roadMin, s.y);
    roadMax = Math.max(roadMax, s.y);
  }
  if (map.credits)
    shell.panel.section('Credits', false).note(map.credits.join('\n'));
  shell.addSceneSection();
  shell.addHelp(
    [
      ['Click', 'inspect the terrain (and a building)'],
      ['F6', 'next tree debug view'],
    ],
    [
      'Distances (along, the 250 m ticks, Drive from here) run along the stage road in its direction.',
    ],
  );
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F6') return;
    e.preventDefault();
    treeDebug.set(String(trees.cycleDebug()));
  });

  function topDown(): void {
    controls.target.copy(center);
    camera.position.set(center.x, center.y + size * 1.15, center.z + 1);
  }
  function oblique(): void {
    controls.target.copy(center);
    camera.position.set(
      center.x - size * 0.35,
      center.y + size * 0.55,
      center.z - size * 0.75,
    );
  }
  function focusAlong(along: number, zoom = 1): void {
    const p = world.stageRoad.at(along);
    controls.target.set(p.x, p.y, p.z);
    camera.position.set(
      p.x + (-p.tx * 60 + 30) * zoom,
      p.y + 45 * zoom,
      p.z - p.tz * 60 * zoom,
    );
  }

  // --- picking -----------------------------------------------------------------------------------
  const marker = new Mesh(
    new CylinderGeometry(0.4, 0.4, 12, 8),
    new MeshBasicMaterial({ color: 0xff00ff }),
  );
  marker.visible = false;
  scene.add(marker);
  const ray = new Raycaster();
  const ndc = new Vector2();
  let down = new Vector2();
  renderer.domElement.addEventListener(
    'pointerdown',
    (e) => (down = new Vector2(e.clientX, e.clientY)),
  );
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (down.distanceTo(new Vector2(e.clientX, e.clientY)) > 4) return; // was a drag
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(ndc, camera);
    const hit = marchTerrain(ray.ray.origin, ray.ray.direction);
    if (hit) inspect(hit);
  });

  function marchTerrain(o: Vector3, d: Vector3): Vector3 | null {
    let prev = 0;
    // As far as the camera sees (whole-map views of the long maps sit further out than 6 km).
    for (let t = 0; t < camera.far; t += 4) {
      const p = o.clone().addScaledVector(d, t);
      if (p.y < world.gen.height(p.x, p.z)) {
        // Bisection refine between prev and t.
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          const q = o.clone().addScaledVector(d, mid);
          if (q.y < world.gen.height(q.x, q.z)) hi = mid;
          else lo = mid;
        }
        return o.clone().addScaledVector(d, hi);
      }
      prev = t;
    }
    return null;
  }

  const sample: GroundSample = {
    height: 0,
    normal: new Vector3(),
    surface: SURFACES.grass,
  };
  const rq = newRoadQuery();
  function inspect(p: Vector3): void {
    // Real-world maps: show where this is (to match screenshots / photos).
    const geo = map.geo ? worldToGeo(map.geo, p.x, p.z) : null;
    const bld = world.buildings.nearest(p.x, p.z, 6);
    if (bld) {
      state.building = bld.id;
      sync();
    }
    world.sampleGround(p.x, p.z, sample);
    world.stageRoad.query(p.x, p.z, rq);
    marker.position.set(p.x, sample.height + 6, p.z);
    marker.visible = true;
    pickInfo({
      x: p.x.toFixed(1),
      z: p.z.toFixed(1),
      height: sample.height.toFixed(2),
      slope: `${(Math.acos(sample.normal.y) * 57.3).toFixed(1)}°`,
      surface: sample.surface.name,
      'road along': rq.found ? `${rq.along.toFixed(0)} m` : '—',
      'road offset': rq.found ? `${rq.lateral.toFixed(1)} m` : '—',
      chunk: `${Math.floor(p.x / 64)}, ${Math.floor(p.z / 64)}`,
      ...(geo && {
        'lat, lon': `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`,
        cover: world.gen.landcover?.coverAt(p.x, p.z) ?? '—',
      }),
      ...(bld && {
        building: `#${bld.id} ${bld.type}, ${bld.w.toFixed(0)}×${bld.d.toFixed(0)} m, ${bld.floors} fl, ${bld.source}`,
      }),
    });
    const along = rq.found ? Math.max(0, rq.along - 15) : null;
    pickLinks.innerHTML =
      (along !== null
        ? `<a href="./?stage=${world.stageDef.id}&spawn=${along.toFixed(0)}">▶ Drive ${world.stageDef.name} from here (${along.toFixed(0)} m)</a>`
        : 'Not near the road.') +
      (geo
        ? `<br><a class="rv-ext" target="_blank" rel="noopener" href="https://www.google.com/maps/@${geo.lat.toFixed(6)},${geo.lon.toFixed(6)},250m/data=!3m1!1e3">Satellite (Google Maps)</a>` +
          ` · <a class="rv-ext" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${geo.lat.toFixed(6)},${geo.lon.toFixed(6)}">Street View</a>`
        : '') +
      (bld ? `<br><code>${buildingRef(bld.id)}</code>` : '');
    // The read-out may sit below the fold: open it and bring it into the panel's view.
    (pickSec.el as HTMLDetailsElement).open = true;
    pickSec.el.scrollIntoView({ block: 'nearest' });
  }

  /** How we refer to a building when detailing it: "stage 1 - building 12 - 42.001234, 21.581234". */
  function buildingRef(id: number): string {
    const bd = world.buildings.byId(id);
    if (!bd) return '';
    const g = map.geo ? worldToGeo(map.geo, bd.x, bd.z) : null;
    const ll = g ? ` - ${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}` : '';
    return `stage ${map.stageNumber ?? 1} - building ${bd.id}${ll}`;
  }

  /** Fly to a building and inspect it (?building=N). */
  function focusBuilding(id: number): boolean {
    const bd = world.buildings.byId(id);
    if (!bd) return false;
    const y = world.gen.height(bd.x, bd.z);
    controls.target.set(bd.x, y + bd.h / 2, bd.z);
    const r = Math.max(25, Math.hypot(bd.w, bd.d) * 1.6);
    camera.position.set(bd.x + r * 0.7, y + r * 0.6, bd.z + r * 0.7);
    inspect(new Vector3(bd.x, y, bd.z));
    return true;
  }

  // --- orbit target ------------------------------------------------------------------------------
  /**
   * Orbit controls zoom / pan relative to their target, and right-drag pans in the screen plane, so the target
   * drifts into the air: every wheel step is then 5% of a tiny distance (copied links ended 0.45 m from a target
   * 550 m above the ground - "can't zoom further"). Re-seat the target where the view ray meets the terrain
   * (same view, the camera does not move) whenever the user grabs the camera or the wheel.
   */
  const _dir = new Vector3();
  function groundTarget(): void {
    const o = camera.position;
    camera.getWorldDirection(_dir);
    const gap = (t: number) =>
      o.y + _dir.y * t - world.gen.height(o.x + _dir.x * t, o.z + _dir.z * t);
    if (gap(0) <= 0) return; // camera under the ground
    let prev = 0;
    let t = 0.25;
    // Steps grow with the height above the ground and with the distance: a few hundred samples at most.
    for (let i = 0; i < 600 && t < camera.far; i++) {
      const g = gap(t);
      if (g <= 0) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (gap(mid) > 0) lo = mid;
          else hi = mid;
        }
        controls.target.copy(o).addScaledVector(_dir, hi);
        return;
      }
      prev = t;
      t += Math.max(0.25, g * 0.5, t * 0.02);
    }
  }
  controls.addEventListener('start', groundTarget);

  // --- loop ----------------------------------------------------------------------------------------
  /**
   * The scatter of the whole map, a few chunks a frame from the first one on, nearest the opening view first: the far
   * forest's canopy map takes each as it comes (world/far-forest.ts `update`) and shows its estimate until then.
   */
  function* scatterFill(from: Vector3): Generator<void> {
    const cs = world.scatter.chunkSize;
    const cells: [number, number, number][] = [];
    // The canopy map's own reach around the map (world/far-forest.ts).
    const pad = 300;
    for (
      let cz = Math.floor((b.minZ - pad) / cs);
      cz * cs <= b.maxZ + pad;
      cz++
    )
      for (
        let cx = Math.floor((b.minX - pad) / cs);
        cx * cs <= b.maxX + pad;
        cx++
      )
        cells.push([
          cx,
          cz,
          Math.hypot((cx + 0.5) * cs - from.x, (cz + 0.5) * cs - from.z),
        ]);
    cells.sort((p, q) => p[2] - q[2]);
    for (const [cx, cz] of cells) {
      if (world.scatter.cachedChunk(cx, cz)) continue;
      world.scatter.chunk(cx, cz);
      yield;
    }
  }
  // Sorted at its first step: by then the opening view (overview, `along`, a camera link) is set.
  const fill = scatterFill(controls.target);
  let statsAt = 0;
  shell.onFrame(() => {
    const t = controls.target;
    const above =
      camera.position.y -
      world.gen.height(camera.position.x, camera.position.z);
    // Stream around the point the camera looks at; height makes LODs coarser from the air.
    const focus = new Vector3(camera.position.x, 0, camera.position.z).lerp(
      t,
      0.5,
    );
    // Terrain, objects and trees share one frame's budget (STREAM_MS): each with its own 8-30 ms they took 20-30 ms
    // of every frame while the camera moved. A bit more while the terrain catches up after a jump.
    const t0 = performance.now();
    terrain.update(focus, terrain.pending > 20 ? 8 : 3, above * 0.8);
    streamer.update(t, Math.max(1, STREAM_MS - (performance.now() - t0)));
    trees.setJobBudget(
      Math.min(
        TREE_JOB_MS,
        Math.max(0.5, STREAM_MS - (performance.now() - t0)),
      ),
    );
    trees.update(camera);
    // The map's scatter fills in with what is left of half the frame's budget (one chunk at least).
    do if (fill.next().done) break;
    while (performance.now() - t0 < STREAM_MS / 2);
    farForest.update(camera.position);
    treeStats.update();
    // A few times a second (the counters change while streaming; `info` only touches changed values).
    const now = performance.now();
    if (now - statsAt < 250) return;
    statsAt = now;
    statInfo({
      road: `${world.road.length.toFixed(0)} m`,
      stage: world.stageDef.name,
      'stage (start→finish)': `${(world.stage.finish - world.stage.start).toFixed(0)} m`,
      'road height': `${roadMin.toFixed(0)} … ${roadMax.toFixed(0)} m`,
      bounds: `${b.maxX - b.minX} × ${b.maxZ - b.minZ} m`,
      'terrain chunks': `${terrain.chunkCount} (+${terrain.pending} queued)`,
      'hf cache': `${world.heightfield.cachedChunks} chunks`,
      'instances drawn': streamer.drawn.toLocaleString(),
      'trees drawn': trees.drawn.toLocaleString(),
      'trees flickering': trees.flickering,
    });
  });

  oblique();
  if (state.along > 0) focusAlong(state.along, state.zoom);
  if (state.building) focusBuilding(state.building);
  // A shared camera link wins over the default / along / building framing.
  shell.applyCameraLink(state);
  // A first pass of streaming (a few terrain chunks, the scatter and trees near the target), then every shader that
  // view uses compiled by the driver in the background (`compileAsync`, as the game does) before the first frame: one
  // frame would otherwise compile them all on the main thread, a frozen page. The rest streams in as usual.
  {
    const t = controls.target;
    // The tiles the first frames want (the frame loop's focus and height): from the air those are the coarse ones.
    terrain.update(
      new Vector3(camera.position.x, 0, camera.position.z).lerp(t, 0.5),
      30,
      (camera.position.y -
        world.gen.height(camera.position.x, camera.position.z)) *
        0.8,
    );
    for (let i = 0; i < 6; i++) streamer.update(t);
    trees.updateNow(camera);
    farForest.fillNow(camera.position);
  }
  await renderer.compileAsync(scene, camera);
  shell.paused = false;
  loaded();
  /**
   * Test hook for bots / the console (the preview pane renders one frame every few seconds): put the camera
   * somewhere and stream every terrain chunk + instance around it at once, so the next screenshot is complete.
   * `look(cx, cy, cz, lx, ly, lz, fov)` = camera position, target, vertical fov.
   */
  function look(
    cx: number,
    cy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
    fov = 55,
  ): number {
    camera.position.set(cx, cy, cz);
    controls.target.set(lx, ly, lz);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.update();
    const above = cy - world.gen.height(cx, cz);
    const focus = new Vector3(cx, 0, cz).lerp(controls.target, 0.3);
    const t0 = performance.now();
    let n = 0;
    while ((terrain.pending > 0 || n < 3) && performance.now() - t0 < 90000) {
      terrain.update(focus, 200, Math.max(0, above) * 0.8);
      n++;
    }
    // The instance streamer builds its chunks over several updates.
    for (let i = 0; i < 80; i++) streamer.update(controls.target);
    while (!fill.next().done);
    trees.updateNow(camera);
    farForest.fillNow(camera.position);
    return n;
  }

  (window as unknown as Record<string, unknown>).__mapViewer = {
    world,
    terrain,
    streamer,
    trees,
    shell,
    look,
  };
});
