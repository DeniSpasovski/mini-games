import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
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
import { track } from '../../../shared/analytics';
import { CAMERA_LINK_DEFAULTS, ViewerShell } from '../debug/viewer-shell';
import { DEFAULT_MAP, loadMap, MAPS } from '../maps';
import { isTestMap, listLabel, TEST_NOTE } from '../release';
import { loadQuality } from '../engine/quality';
import { InstanceStreamer } from '../world/instance-streamer';
import { worldToGeo } from '../world/real-data';
import { newRoadQuery } from '../world/road';
import { roadMeshJob } from '../world/road-mesh';
import {
  getTerrainMaterial,
  setGroundMoisture,
} from '../world/terrain-material';
import { Horizon } from '../world/horizon';
import { TerrainRenderer } from '../world/terrain-renderer';
import { RENDER_MARGIN, World } from '../world/world';
import type { GroundSample } from '../physics/types';
import { SURFACES } from '../physics/surfaces';

/**
 * Map viewer: aerial view of a whole map for quick iteration.
 *   map-viewer.html?map=test&scatter=1&road=1&grid=0&splat=0&fog=0&labels=1&along=1100&zoom=0.5
 * Click the terrain to inspect a point; "Drive from here" opens the game at
 * that distance along the road. "Copy camera link" (Camera section) shares the exact view (`cam`, `look`, `fov`, `clean`).
 * Loading is progressive: the first frame shows right after the World is built; terrain, trees and buildings within
 * NEAR_VIEW of the opening camera come first (road / street meshes nearest first, `loadJobs`), then the rest of the map;
 * terrain tiles and scatter chunks show as they are built, nearest first (`partialCommitMs` on the first rebuild).
 */
/** Metres around the opening camera loaded before the rest of the map (terrain, scatter, buildings). */
const NEAR_VIEW = 600;

const DEFAULTS = {
  map: DEFAULT_MAP,
  scatter: true,
  road: true,
  grid: false,
  splat: false,
  fog: false,
  labels: true,
  wire: false,
  /** Real-world maps: focus + inspect this building id ("stage 1 - building 12"). */
  building: 0,
  /** Fly to this distance along the road (m); 0 = overview. `zoom` scales the camera offset (default 1). */
  along: 0,
  zoom: 1,
  // Shared camera: cam / look / fov / clean (see "Copy camera link").
  ...CAMERA_LINK_DEFAULTS,
};
const state = readUrlState(DEFAULTS);
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);
track('rally', 'select_content', {
  game_content_type: 'map_viewer',
  game_content_id: state.map,
});

// The map's baked data is loaded on demand (own chunk), so the viewer body runs once it is here.
void loadMap(state.map).then((map) => {
  const b = map.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const shell = new ViewerShell({
    title: 'Map viewer',
    ground: false,
    // Long maps: the whole-map views sit further away than the default far plane.
    far: Math.max(8000, size * 3),
    env: {
      ...map.environment,
      fogDensity: state.fog ? map.environment.fogDensity : 0.00005,
    },
  });
  const { scene, camera, controls, renderer } = shell;
  const world = new World(map);
  const center = new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  // Mountain maps: orbit around the ground, not sea level.
  center.y = world.analytic.height(center.x, center.z);

  // --- world rendering -----------------------------------------------------------------
  // Opening phase (`near`): terrain, scatter and buildings only within NEAR_VIEW of the camera, so the view of a
  // camera link is complete before the background chunks of the rest of the map (widened in `widen`).
  const fullView = size + RENDER_MARGIN * 2;
  const terrain = new TerrainRenderer(world, {
    viewDistance: Math.min(fullView, NEAR_VIEW),
    lodDistances: [120, 260, 520],
    // Baked after the roads (loadJobs): the first frame comes up without waiting for the whole map.
    deferMoisture: true,
  });
  scene.add(terrain.group);
  if (map.horizon) {
    const horizon = new Horizon(world, map.horizon);
    horizon.setCutoff(size + RENDER_MARGIN * 2);
    scene.add(horizon.group);
  }
  // Roads, streets, bridges, buildings: filled in over the first frames, nearest the camera first (loadJobs).
  const road = new Group();
  scene.add(road);
  const quality = loadQuality();
  const streamer = new InstanceStreamer(world, {
    lodScale: Math.max(2.5, quality.lodScale * 3),
    detailDensity: 0,
    rebuildDistance: 25,
    // First load: a bigger slice, the drawn set grows outward chunk by chunk (`loaded` sets the usual pacing).
    budgetMs: 16,
    partialCommitMs: 150,
  });
  streamer.group.visible = state.scatter;
  scene.add(streamer.group);

  // --- overlays ------------------------------------------------------------------------------
  const overlays = new Group();
  scene.add(overlays);
  const roadLine = buildRoadLine();
  const markers = buildMarkers();
  // (built when first shown: it samples the height along every chunk edge of the map)
  let chunkGrid: LineSegments | undefined;
  const showChunkGrid = (v: boolean) => {
    if (v && !chunkGrid) overlays.add((chunkGrid = buildChunkGrid()));
    if (chunkGrid) chunkGrid.visible = v;
  };
  overlays.add(roadLine, markers);
  roadLine.visible = state.road;
  markers.visible = state.labels;
  showChunkGrid(state.grid);
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
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = color;
    ctx.font = 'bold 34px system-ui';
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

  function buildMarkers(): Group {
    const g = new Group();
    const st = world.stage;
    const pole = (along: number, text: string, color: string) => {
      const p = world.road.at(along);
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
    // Distance ticks every 250 m.
    for (let d = 250; d < world.road.length; d += 250) {
      const p = world.road.at(d);
      const l = label(`${d} m`, '#ffffff');
      l.scale.set(0.07, 0.0175, 1);
      l.position.set(p.x, p.y + 8, p.z);
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
  shell.panel.section('Maps').list(
    MAPS.map((m) => ({
      id: m.id,
      label: listLabel(m.name, isTestMap(m.id)),
      hint: isTestMap(m.id) ? `${TEST_NOTE}. ${m.description}` : m.description,
    })),
    state.map,
    (id) => {
      // Camera / focus params belong to the old map: the new one opens on its default overview.
      Object.assign(state, {
        map: id,
        cam: DEFAULTS.cam,
        look: DEFAULTS.look,
        fov: DEFAULTS.fov,
        along: DEFAULTS.along,
        zoom: DEFAULTS.zoom,
        building: DEFAULTS.building,
      });
      sync(true);
      location.reload();
    },
  );

  const layers = shell.panel.section('Layers');
  layers.checkbox('Scatter (trees, props)', state.scatter, (v) => {
    state.scatter = v;
    streamer.group.visible = v;
    sync();
  });
  layers.checkbox('Road centreline (height colour)', state.road, (v) => {
    state.road = v;
    roadLine.visible = v;
    sync();
  });
  layers.checkbox('Labels (start / splits / finish)', state.labels, (v) => {
    state.labels = v;
    markers.visible = v;
    sync();
  });
  layers.checkbox('Chunk grid (64 m)', state.grid, (v) => {
    state.grid = v;
    showChunkGrid(v);
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
    sync();
  });
  layers.checkbox('Fog', state.fog, (v) => {
    state.fog = v;
    shell.envDef.fogDensity = v ? map.environment.fogDensity : 0.00005;
    shell.env.apply(shell.envDef);
    sync();
  });

  const view = shell.panel.section('Camera');
  view.button('Top down (whole map)', () => topDown());
  view.button('Oblique overview', () => oblique());
  view.button('Start line', () => focusAlong(world.stage.start));
  shell.addCameraShare(view, state, sync);

  const stats = shell.panel.section('Map');
  const statInfo = stats.info();
  if (map.credits)
    stats.html(`<small style="opacity:.7">${map.credits.join('<br>')}</small>`);
  const roadYs = world.road.samples.map((s) => s.y);
  const pickSec = shell.panel.section('Picked point');
  const pickInfo = pickSec.info();
  const pickLinks = pickSec.html('<i>Click the terrain…</i>');
  shell.addSceneSection();
  shell.panel
    .section('Help', false)
    .html(
      'Left-drag orbit · right-drag pan · wheel zoom · click terrain to inspect · <kbd>H</kbd> hide panel · <kbd>F3</kbd> stats',
    );

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
    const p = world.road.at(along);
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
    for (let t = 0; t < 6000; t += 4) {
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
    world.road.query(p.x, p.z, rq);
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
        ? `<a style="color:#f0a020" href="./?map=${map.id}&spawn=${along.toFixed(0)}">▶ Drive from here (${along.toFixed(0)} m)</a>`
        : '<i>Not near the road.</i>') +
      (geo
        ? `<br><a style="color:#7ab8ff" target="_blank" rel="noopener" href="https://www.google.com/maps/@${geo.lat.toFixed(6)},${geo.lon.toFixed(6)},250m/data=!3m1!1e3">Satellite (Google Maps)</a>` +
          ` · <a style="color:#7ab8ff" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${geo.lat.toFixed(6)},${geo.lon.toFixed(6)}">Street View</a>`
        : '') +
      (bld
        ? `<br><code style="user-select:all">${buildingRef(bld.id)}</code>`
        : '');
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

  // --- loading -------------------------------------------------------------------------------------
  /**
   * Everything that is not terrain or scatter, time-sliced so the first frame does not wait for the whole map: the
   * road / street meshes nearest the camera first (the view of a shared camera link fills in before the rest of the
   * map), then the map-wide ground moisture tint. Started on the first frame, once the camera link is applied.
   */
  let roadJob: Generator<void, unknown> | undefined;
  let roadsDone = false;
  let moistureJob: ReturnType<World['moistureJob']> | undefined =
    world.moistureJob();
  /** Runs the load jobs for `budgetMs` (at least one step); true when all are done. */
  function loadJobs(focus: Vector3, budgetMs: number): boolean {
    roadJob ??= roadMeshJob(world, { focus, group: road });
    const end = performance.now() + budgetMs;
    while (!roadsDone || moistureJob) {
      if (!roadsDone) roadsDone = !!roadJob.next().done;
      else {
        const r = moistureJob!.next();
        if (r.done) {
          setGroundMoisture(r.value);
          moistureJob = undefined;
        }
      }
      if (performance.now() >= end) break;
    }
    return roadsDone && !moistureJob;
  }

  let near = true;
  /** End of the opening phase: stream the whole map. */
  function widen(): void {
    near = false;
    terrain.setViewDistance(fullView);
  }
  let scatterLoaded = false;
  /** First scatter rebuild done: later ones (after camera moves) commit once, at the usual budget. */
  function loaded(): void {
    scatterLoaded = true;
    streamer.setOptions({ budgetMs: 8, partialCommitMs: undefined });
  }

  // --- loop ----------------------------------------------------------------------------------------
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
    // Big budget while catching up (tool page: a few long frames are fine).
    terrain.update(focus, terrain.pending > 20 ? 30 : 8, above * 0.8);
    if (near) {
      // Near ground, trees and buildings; the road job (nearest first) gets a small share.
      streamer.update(t);
      loadJobs(focus, 6);
      if (terrain.pending === 0 && streamer.covered >= NEAR_VIEW) widen();
    } else {
      loadJobs(focus, 10);
      streamer.update(t);
    }
    if (!scatterLoaded) {
      if (streamer.commits > 0) loaded();
      // The rest of the load done: the frame is the scatter's.
      else if (!near && !terrain.pending && roadsDone && !moistureJob)
        streamer.setOptions({ budgetMs: 40 });
    }
    statInfo({
      loading: near
        ? `near the camera (${NEAR_VIEW} m)`
        : !roadsDone
          ? 'roads (nearest first)'
          : moistureJob
            ? 'ground tint'
            : terrain.pending || streamer.busy
              ? 'rest of the map'
              : 'done',
      road: `${world.road.length.toFixed(0)} m`,
      'stage (start→finish)': `${(world.stage.finish - world.stage.start).toFixed(0)} m`,
      'road height': `${Math.min(...roadYs).toFixed(0)} … ${Math.max(...roadYs).toFixed(0)} m`,
      bounds: `${b.maxX - b.minX} × ${b.maxZ - b.minZ} m`,
      'terrain chunks': `${terrain.chunkCount} (+${terrain.pending} queued)`,
      'hf cache': `${world.heightfield.cachedChunks} chunks`,
      'instances drawn': streamer.drawn.toLocaleString(),
    });
  });

  oblique();
  if (state.along > 0) focusAlong(state.along, state.zoom);
  if (state.building) focusBuilding(state.building);
  // A shared camera link wins over the default / along / building framing.
  shell.applyCameraLink(state);
  if (world.buildings.buildings.length) {
    const bsec = shell.panel.section('Buildings');
    const bInfo = bsec.info();
    const counts = { house: 0, flat: 0 };
    for (const bd of world.buildings.buildings) counts[bd.type]++;
    bInfo({
      total: world.buildings.buildings.length,
      'sloped roof': counts.house,
      'flat roof': counts.flat,
    });
    bsec.html(
      '<label>Go to building # <input type="number" min="1" style="width:70px" data-ref="bid"></label>',
    );
    const input = document.querySelector<HTMLInputElement>('[data-ref="bid"]')!;
    if (state.building) input.value = String(state.building);
    input.addEventListener('change', () => focusBuilding(Number(input.value)));
  }
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
    if (near) widen();
    if (!scatterLoaded) loaded();
    const t0 = performance.now();
    let n = 0;
    while ((terrain.pending > 0 || n < 3) && performance.now() - t0 < 90000) {
      terrain.update(focus, 200, Math.max(0, above) * 0.8);
      n++;
    }
    while (!loadJobs(focus, 1000));
    // Every instance in range at once (replaces a rebuild still running).
    streamer.updateNow(controls.target);
    return n;
  }

  (window as unknown as Record<string, unknown>).__mapViewer = {
    world,
    terrain,
    streamer,
    shell,
    look,
  };
});
