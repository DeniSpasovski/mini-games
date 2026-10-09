import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { ViewerShell } from '../debug/viewer-shell';
import { generateMap } from '../map/generate';
import {
  REACTION_S,
  checkAllSpawns,
  escapeSeconds,
  stepsFrom,
} from '../map/safety';
import { MAP_SIZES, MAP_SIZE_IDS, isMapSizeId } from '../map/sizes';
import { Arena } from '../render/arena';
import { GlowGrid } from '../render/fx/glow-grid';
import { BASE_SPEED, FUSE_S, MIN_FUSE_S, START_RANGE } from '../sim/rules';
import { DangerMap, NEVER } from '../sim/danger';
import { crossCells } from '../sim/blast';
import { gridToWorldX, gridToWorldZ } from '../sim/grid';
import { PowerUp } from '../sim/powerups';
import { Sim } from '../sim/sim';
import { Terrain, type MapData } from '../sim/types';

/**
 * Map viewer: regenerate the arena from a size + seed and inspect it.
 *   map-viewer.html?size=m&seed=1&overlay=escape&spawn=0&orbit=0
 * Overlays: spawn zones (cells within 3 steps of each spawn), escape (a TNT dropped on a spawn: burning cells, and how
 * long each reachable safe cell takes to reach), danger (the same TNT through the bots' danger map: when each cell burns).
 */
const OVERLAYS = ['none', 'spawns', 'escape', 'danger', 'powerups'] as const;
type Overlay = (typeof OVERLAYS)[number];
const DEFAULTS = {
  size: 'm',
  seed: 1,
  overlay: 'spawns' as string,
  spawn: 0,
  orbit: false,
};
const state = readUrlState(DEFAULTS);
if (!isMapSizeId(state.size)) state.size = DEFAULTS.size;
if (!(OVERLAYS as readonly string[]).includes(state.overlay))
  state.overlay = DEFAULTS.overlay;

const shell = new ViewerShell('Kabooom · Map viewer');
let map: MapData;
let arena: Arena | null = null;
let glow: GlowGrid | null = null;
let overlayMesh: InstancedMesh | null = null;
let clock = 0;

const RED = new Color(0xff4d3a);
const GREEN = new Color(0x3ddc6a);
const CYAN = new Color(0x38d6ff);
const GREY = new Color(0x777777);
const GOLD = new Color(0xffc22e);

function buildOverlay(): void {
  if (overlayMesh) {
    shell.scene.remove(overlayMesh);
    overlayMesh.geometry.dispose();
    (overlayMesh.material as MeshBasicMaterial).dispose();
    overlayMesh.dispose();
  }
  const { w, h } = map;
  overlayMesh = new InstancedMesh(
    new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
    w * h,
  );
  overlayMesh.renderOrder = 5;
  shell.scene.add(overlayMesh);
  paintOverlay();
}

/** Colour every cell for the current overlay; cells with no colour are moved out of sight. */
function paintOverlay(): void {
  if (!overlayMesh) return;
  const { w, h } = map;
  const m = new Matrix4();
  const colors: (Color | null)[] = new Array(w * h).fill(null);
  const spawn = map.spawns[Math.min(state.spawn, map.spawns.length - 1)];
  const overlay = state.overlay as Overlay;

  if (overlay === 'spawns') {
    for (const s of map.spawns) {
      const steps = stepsFrom(map.terrain, w, h, s.x, s.y);
      for (let i = 0; i < steps.length; i++)
        if (steps[i] >= 0 && steps[i] <= 3) colors[i] = GREEN;
    }
    for (const s of map.spawns) colors[s.y * w + s.x] = CYAN;
  } else if (overlay === 'escape') {
    const burning = new Set(
      crossCells(map.terrain, w, h, spawn.x, spawn.y, START_RANGE),
    );
    const steps = stepsFrom(map.terrain, w, h, spawn.x, spawn.y);
    const limit = (MIN_FUSE_S - REACTION_S) * BASE_SPEED;
    for (let i = 0; i < steps.length; i++) {
      if (burning.has(i)) colors[i] = RED;
      else if (steps[i] > 0)
        colors[i] =
          steps[i] <= limit
            ? GREEN.clone().multiplyScalar(1.2 - steps[i] / 14)
            : GREY;
    }
    colors[spawn.y * w + spawn.x] = CYAN;
  } else if (overlay === 'powerups') {
    // the crates that hide a power-up (cyan = more dynamites, gold = more sticks), and the spawns
    const sim = new Sim(
      {
        seed: map.seed,
        size: map.sizeId,
        bots: map.spawns.length - 1,
        difficulty: 'normal',
        rounds: 1,
        critter: 'mole',
      },
      () => map,
      { countdown: 0 },
    );
    sim.hiddenItems.forEach((k, i) => {
      if (k >= 0) colors[i] = k === PowerUp.Dynamites ? CYAN : GOLD;
    });
    for (const s of map.spawns) colors[s.y * w + s.x] = GREEN;
  } else if (overlay === 'danger') {
    const sim = new Sim(
      {
        seed: map.seed,
        size: map.sizeId,
        bots: 1,
        difficulty: 'normal',
        rounds: 1,
        critter: 'mole',
      },
      () => map,
      { countdown: 0 },
    );
    const danger = new DangerMap();
    danger.compute(sim, { x: spawn.x, y: spawn.y, range: START_RANGE });
    for (let i = 0; i < w * h; i++) {
      if (danger.start[i] >= NEVER) continue;
      const t = Math.min(1, danger.start[i] / FUSE_S);
      colors[i] = new Color().setHSL(0.02 + t * 0.12, 1, 0.5);
    }
  }

  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i - x) / w;
    const c = colors[i];
    m.makeTranslation(
      gridToWorldX(w, x + 0.5),
      c ? 0.03 : -50,
      gridToWorldZ(h, y + 0.5),
    );
    overlayMesh.setMatrixAt(i, m);
    overlayMesh.setColorAt(i, c ?? GREY);
  }
  overlayMesh.instanceMatrix.needsUpdate = true;
  if (overlayMesh.instanceColor) overlayMesh.instanceColor.needsUpdate = true;
}

const infoSection = shell.panel.section('Info');
const setInfo = infoSection.info();

function updateInfo(): void {
  const { w, h } = map;
  let crates = 0;
  let free = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (x % 2 === 0 && y % 2 === 0) continue;
      free++;
      if (map.terrain[y * w + x] === Terrain.Crate) crates++;
    }
  const checks = checkAllSpawns(map);
  const spawn = map.spawns[Math.min(state.spawn, map.spawns.length - 1)];
  const hiddenCount = (() => {
    try {
      const sim = new Sim(
        {
          seed: map.seed,
          size: map.sizeId,
          bots: Math.max(1, map.spawns.length - 1),
          difficulty: 'normal',
          rounds: 1,
          critter: 'mole',
        },
        () => map,
        { countdown: 0 },
      );
      return sim.hiddenItems.reduce((a, k) => a + (k >= 0 ? 1 : 0), 0);
    } catch {
      return 0;
    }
  })();
  setInfo({
    'power-ups (all spawns)': hiddenCount,
    size: `${w} x ${h}`,
    crates: `${crates} / ${free} (${Math.round((crates / free) * 100)} %)`,
    spawns: `${map.spawns.length}, all safe: ${checks.every((c) => c.ok)}`,
    [`spawn ${state.spawn} escape`]: `${escapeSeconds(map.terrain, w, h, spawn.x, spawn.y).toFixed(2)} s`,
  });
}

function rebuild(): void {
  if (arena) {
    shell.scene.remove(arena.group);
    arena.dispose();
    glow?.dispose();
  }
  const sizeId = isMapSizeId(state.size) ? state.size : 'm';
  map = generateMap({ size: sizeId, seed: state.seed });
  glow = new GlowGrid(map.w, map.h);
  arena = new Arena(map, shell.quality, glow);
  shell.scene.add(arena.group);
  shell.fitArenaOnResize(() => {
    const { w, h } = MAP_SIZES[sizeId];
    shell.rig.fitArena(w, h);
  });
  buildOverlay();
  updateInfo();
  writeUrlState({ ...state }, DEFAULTS);
}

const s = shell.panel.section('Map');
s.select(
  'Size',
  state.size,
  MAP_SIZE_IDS.map((id) => ({
    value: id,
    label: `${MAP_SIZES[id].label} (${MAP_SIZES[id].w}x${MAP_SIZES[id].h})`,
  })),
  (v) => {
    state.size = v;
    state.spawn = 0;
    rebuild();
  },
);
s.seed('Seed', state.seed, (v) => {
  state.seed = v;
  rebuild();
});
const o = shell.panel.section('View');
o.select('Overlay', state.overlay, [...OVERLAYS], (v) => {
  state.overlay = v;
  paintOverlay();
  writeUrlState({ ...state }, DEFAULTS);
});
o.slider('Spawn', state.spawn, { min: 0, max: 7, step: 1 }, (v) => {
  state.spawn = Math.round(v);
  paintOverlay();
  updateInfo();
  writeUrlState({ ...state }, DEFAULTS);
});
o.checkbox('Free camera', state.orbit, (v) => {
  state.orbit = v;
  shell.setGameCamera(!v);
  writeUrlState({ ...state }, DEFAULTS);
});

shell.onFrame((dt) => {
  clock += dt;
  if (!arena) return;
  arena.update(clock);
  if (arena.consumeShadowDirty()) shell.renderer.shadowMap.needsUpdate = true;
});

rebuild();
if (state.orbit) shell.setGameCamera(false);
