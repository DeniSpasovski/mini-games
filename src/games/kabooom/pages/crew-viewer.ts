import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { ViewerShell } from '../debug/viewer-shell';
import { Arena } from '../render/arena';
import { Crew } from '../render/characters';
import { Fx } from '../render/fx/fx';
import { GlowGrid } from '../render/fx/glow-grid';
import { ItemRenderer } from '../render/items';
import { BlobShadows } from '../render/shadows';
import { TntRenderer } from '../render/tnt';
import { PowerUp } from '../sim/powerups';
import { walkBlast } from '../sim/blast';
import { FLAME_S, FUSE_S, START_RANGE } from '../sim/rules';
import {
  CRITTERS,
  Terrain,
  type CritterId,
  type MapData,
  type PlayerView,
  type TntView,
} from '../sim/types';

/**
 * Crew viewer: every Boom Crew critter, its animations, the TNT and a blast, on a small open stage.
 *   crew-viewer.html?critter=lineup&anim=walk&speed=1&tnt=1&fuse=2&blast=1&blastAt=0.2
 * `critter` = `lineup` (all eight) or one critter id. Orbit with the mouse; `turntable` spins the camera.
 * `blast` loops an explosion behind the crew; `blastAt` >= 0 freezes it that many seconds in (FX tuning, screenshots).
 */
const ANIMS = ['idle', 'walk', 'place', 'ko', 'cheer'] as const;
type Anim = (typeof ANIMS)[number];
const DEFAULTS = {
  critter: 'lineup',
  anim: 'walk' as string,
  speed: 1,
  turntable: false,
  tnt: true,
  fuse: -1,
  blast: false,
  blastAt: -1,
  /** Blast level 1-5 of the demo blast (range = level + 1; corners from 4). */
  blastLevel: 3,
  /** `tnt` = a close-up of the TNT row and the pickups (texture work). */
  view: 'crew' as string,
};
const state = readUrlState(DEFAULTS);

const STAGE_W = 11;
const STAGE_H = 7;

/** A player whose fields the viewer writes directly (the sim does that in the game). */
class MockPlayer implements PlayerView {
  state: 'alive' | 'ko' = 'alive';
  x = 0;
  y = 0;
  px = 0;
  py = 0;
  facing = Math.PI / 2;
  moving = false;
  tntLeft = 1;
  maxTnt = 1;
  range = 2;
  speed = 4;
  wins = 0;
  homeX = 0;
  homeY = 0;
  constructor(
    readonly id: number,
    readonly critter: CritterId,
  ) {}
  readonly isBot = false;
  get color(): number {
    return this.id;
  }
}

const stageMap: MapData = {
  sizeId: 'm',
  w: STAGE_W,
  h: STAGE_H,
  seed: 1,
  terrain: new Uint8Array(STAGE_W * STAGE_H).fill(Terrain.Empty),
  variant: new Uint8Array(STAGE_W * STAGE_H),
  spawns: [],
};

const shell = new ViewerShell('Kabooom · Crew viewer');
const glow = new GlowGrid(STAGE_W, STAGE_H);
const arena = new Arena(stageMap, shell.quality, glow);
shell.scene.add(arena.group);
shell.setGameCamera(false);
shell.rig.camera.position.set(0, 5.5, 13);
shell.orbit.target.set(0, 0.6, 0.5);
shell.orbit.update();

let players: MockPlayer[] = [];
let crew: Crew | null = null;
let tntRenderer: TntRenderer | null = null;
// the two power-ups on the stage floor: more dynamites (left), more sticks (right)
const itemRenderer = new ItemRenderer(STAGE_W, STAGE_H);
shell.scene.add(itemRenderer.group);
const stageItems = new Int8Array(STAGE_W * STAGE_H).fill(-1);
stageItems[(STAGE_H - 2) * STAGE_W + 2] = PowerUp.Dynamites;
stageItems[(STAGE_H - 2) * STAGE_W + STAGE_W - 3] = PowerUp.Sticks;
// one TNT per blast level, 1 to 5 sticks
const tnts: TntView[] = [0, 1, 2, 3, 4].map((i) => ({
  active: true,
  x: Math.floor(STAGE_W / 2) - 2 + i,
  y: 5,
  owner: 0,
  fuse: 3 - (i % 3),
  range: 2 + i,
}));
// the blast: one TNT in front of the crew, arms reaching across the stage
const fx = new Fx(STAGE_W, STAGE_H);
shell.scene.add(fx.group);
const BLAST = { x: 5, y: 5 };
const BLAST_EVERY = 2.4;
const flame = new Float32Array(STAGE_W * STAGE_H);
/** The cells the demo blast burns (the real rule, `walkBlast`: corners from level 4). */
let blastCells: number[] = [];
let blastT = -99;
function fireBlast(): void {
  blastT = fx.time.value;
  fx.clear();
  const arms: [number, number, number, number] = [0, 0, 0, 0];
  const bends: number[] = [];
  blastCells = [];
  walkBlast(
    stageMap.terrain,
    STAGE_W,
    STAGE_H,
    BLAST.x,
    BLAST.y,
    START_RANGE + state.blastLevel - 1,
    {
      burn: (i) => {
        blastCells.push(i);
        return false;
      },
      arm: (d, len) => (arms[d] = len),
      bend: (x, y, d, len) => bends.push(x, y, d, len),
    },
  );
  fx.onEvent({
    type: 'tntExploded',
    x: BLAST.x,
    y: BLAST.y,
    owner: 0,
    arms,
    bends,
    bendCount: bends.length / 4,
    chainDepth: 0,
  });
}
/** The heat the floor glow reads: the blast's cross while its flames burn. */
function blastFlame(): Float32Array {
  flame.fill(0);
  const left = FLAME_S - (fx.time.value - blastT);
  if (!state.blast || left <= 0) return flame;
  for (const i of blastCells) flame[i] = left;
  return flame;
}
const shadows = new BlobShadows(16);
shell.scene.add(shadows.mesh);
let clock = 0;
let lastEvent = 0;

function rebuild(): void {
  if (crew) {
    shell.scene.remove(crew.group);
    crew.dispose();
  }
  const ids: CritterId[] =
    state.critter === 'lineup' ? [...CRITTERS] : [state.critter as CritterId];
  players = ids.map((c, i) => {
    const p = new MockPlayer(i, c);
    const n = ids.length;
    p.homeX = n === 1 ? STAGE_W / 2 : STAGE_W / 2 + (i - (n - 1) / 2) * 1.15;
    p.homeY = STAGE_H / 2 - 0.5;
    p.x = p.px = p.homeX;
    p.y = p.py = p.homeY;
    return p;
  });
  crew = new Crew(players, STAGE_W, STAGE_H);
  const single = ids.length === 1;
  shell.rig.camera.position.set(0, single ? 1.9 : 5.5, single ? 3.6 : 13);
  shell.orbit.target.set(0, single ? 0.5 : 0.6, single ? -0.4 : 0.5);
  if (state.view === 'tnt') {
    shell.rig.camera.position.set(0, 2.1, 5.9);
    shell.orbit.target.set(0, 0.3, 2);
  }
  shell.orbit.update();
  shell.scene.add(crew.group);
  lastEvent = -99;
  writeUrlState({ ...state }, DEFAULTS);
}

function rebuildTnt(): void {
  if (tntRenderer) {
    shell.scene.remove(tntRenderer.group);
    tntRenderer.dispose();
    tntRenderer = null;
  }
  if (state.tnt) {
    tntRenderer = new TntRenderer(STAGE_W, STAGE_H);
    shell.scene.add(tntRenderer.group);
  }
  writeUrlState({ ...state }, DEFAULTS);
}

const c = shell.panel.section('Crew');
c.select(
  'Critter',
  state.critter,
  [
    { value: 'lineup', label: 'All eight' },
    ...CRITTERS.map((id) => ({ value: id, label: id })),
  ],
  (v) => {
    if (!crew) return;
    state.critter = v;
    rebuild();
  },
);
c.select('Animation', state.anim, [...ANIMS], (v) => {
  state.anim = v;
  crew?.reset();
  for (const p of players) p.state = 'alive';
  lastEvent = -99;
  writeUrlState({ ...state }, DEFAULTS);
});
c.slider('Speed', state.speed, { min: 0.1, max: 2.5, step: 0.05 }, (v) => {
  state.speed = v;
  writeUrlState({ ...state }, DEFAULTS);
});
c.checkbox('Turntable', state.turntable, (v) => {
  state.turntable = v;
  shell.orbit.autoRotate = v;
  shell.orbit.autoRotateSpeed = 2.5;
  writeUrlState({ ...state }, DEFAULTS);
});
const t = shell.panel.section('TNT');
t.checkbox('Show TNT', state.tnt, (v) => {
  state.tnt = v;
  rebuildTnt();
});
t.slider(
  'Fuse (s), -1 = counting down',
  state.fuse,
  { min: -1, max: FUSE_S, step: 0.05 },
  (v) => {
    state.fuse = v;
    writeUrlState({ ...state }, DEFAULTS);
  },
);

const b = shell.panel.section('Blast');
b.checkbox('Loop a blast', state.blast, (v) => {
  state.blast = v;
  if (!v) fx.clear();
  blastT = -99;
  writeUrlState({ ...state }, DEFAULTS);
});
b.slider(
  'Freeze at (s), -1 = loop',
  state.blastAt,
  { min: -1, max: 3, step: 0.02 },
  (v) => {
    state.blastAt = v;
    writeUrlState({ ...state }, DEFAULTS);
  },
);

b.slider('Blast level', state.blastLevel, { min: 1, max: 5, step: 1 }, (v) => {
  state.blastLevel = v;
  blastT = -99;
  writeUrlState({ ...state }, DEFAULTS);
});

shell.orbit.autoRotate = state.turntable;
shell.orbit.autoRotateSpeed = 2.5;

/** Drive the mock players for the chosen animation. */
function drive(dt: number): void {
  const anim = state.anim as Anim;
  const step = dt * state.speed;
  clock += step;
  for (const p of players) {
    p.px = p.x;
    p.py = p.y;
    p.moving = false;
    if (anim === 'walk' && p.state === 'alive') {
      const a = clock * 1.1 + p.id;
      const r = players.length === 1 ? 1.6 : 0.35;
      p.x = p.homeX + Math.cos(a) * r;
      p.y = p.homeY + Math.sin(a) * r;
      p.facing = Math.atan2(p.y - p.py, p.x - p.px);
      p.moving = true;
      p.speed = 3.2 * state.speed;
    }
  }
  if (!crew) return;
  const every = anim === 'ko' ? 4.2 : anim === 'cheer' ? 2.6 : 1.6;
  if (anim !== 'idle' && anim !== 'walk' && clock - lastEvent > every) {
    lastEvent = clock;
    crew.reset();
    for (const p of players) p.state = 'alive';
    for (const p of players) {
      if (anim === 'place')
        crew.onEvent({ type: 'tntPlaced', x: 0, y: 0, owner: p.id });
      else if (anim === 'cheer') crew.cheer(p.id);
      else if (anim === 'ko') {
        p.state = 'ko';
        crew.onEvent({ type: 'playerKo', id: p.id, byOwner: 0 });
      }
    }
  }
}

function frame(dt: number): void {
  drive(dt);
  arena.update(clock);
  if (arena.consumeShadowDirty()) shell.renderer.shadowMap.needsUpdate = true;
  crew?.update(1, dt * state.speed);
  if (tntRenderer) {
    const cycle = (clock * 0.7) % (FUSE_S + 0.6);
    tnts.forEach((tt, i) => {
      const fuse =
        state.fuse >= 0
          ? state.fuse
          : Math.max(0.01, FUSE_S - ((cycle + i * 0.9) % (FUSE_S + 0.6)));
      (tt as { fuse: number }).fuse = fuse;
    });
    tntRenderer.update(tnts, dt * state.speed);
  }
  itemRenderer.update(stageItems, dt * state.speed);
  if (state.blast) {
    if (state.blastAt >= 0) {
      if (blastT < 0) fireBlast();
      fx.update(0);
      fx.time.value = blastT + state.blastAt;
    } else {
      fx.update(dt * state.speed);
      if (fx.time.value - blastT > BLAST_EVERY) fireBlast();
    }
  }
  glow.update(blastFlame());
  shadows.begin();
  if (crew) {
    const pos = { x: 0, z: 0 };
    for (const p of players) {
      crew.worldPos(p.id, 1, pos);
      if (p.state === 'alive') shadows.add(pos.x, pos.z, 0.36);
    }
  }
  if (tntRenderer)
    for (const tt of tnts)
      shadows.add(tt.x + 0.5 - STAGE_W / 2, tt.y + 0.5 - STAGE_H / 2, 0.3);
  shadows.end();
}
shell.onFrame(frame);
/** Debug hook: step the animation `seconds` ahead at 60 steps/s (the browser pane throttles frames). */
(window as unknown as { __crew: unknown }).__crew = {
  advance(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) frame(1 / 60);
  },
  get crew() {
    return crew;
  },
  players: () => players,
};

rebuild();
rebuildTnt();
