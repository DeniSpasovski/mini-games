import { expect, test } from '@rstest/core';
import { Hud } from '../../src/games/kaboom/game/hud';
import { Controls } from '../../src/games/kaboom/game/input';
import {
  dragToDir,
  followOrigin,
  keysToDir,
  padToDir,
} from '../../src/games/kaboom/game/input-map';
import { Menu, type MenuApi } from '../../src/games/kaboom/game/menu';
import {
  DEFAULT_SETTINGS,
  clampBots,
  loadSettings,
  loadStats,
  recordMatch,
  sanitizeSettings,
  saveSettings,
} from '../../src/games/kaboom/game/settings';
import { memoryStorage } from '../../src/games/kaboom/game/storage';
import {
  CameraRig,
  FOLLOW_ABOVE_CELLS,
} from '../../src/games/kaboom/render/camera-rig';
import { MAP_SIZES } from '../../src/games/kaboom/map/sizes';
import {
  CRITTERS,
  type CritterId,
  type PlayerInput,
} from '../../src/games/kaboom/sim/types';
import { simOn } from './helpers';

const portraits = Object.fromEntries(
  CRITTERS.map((c) => [c, `data:,${c}`]),
) as Record<CritterId, string>;

// ------------------------------------------------------------------ settings + stats

test('settings: invalid or missing fields fall back to defaults, bots follow the arena size', () => {
  expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  expect(
    sanitizeSettings({
      critter: 'dragon',
      size: 'xl',
      rounds: 7,
      difficulty: 'insane',
      volume: 5,
      quality: 'ultra',
    }),
  ).toEqual({
    ...DEFAULT_SETTINGS,
    volume: 1,
  });
  expect(sanitizeSettings({ size: 's', bots: 7 }).bots).toBe(
    MAP_SIZES.s.maxPlayers - 1,
  );
  expect(sanitizeSettings({ size: 'l', bots: 0 }).bots).toBe(1);
  expect(clampBots('l', 99)).toBe(7);
  expect(clampBots('m', 99)).toBe(5);
});

test('settings: saved and loaded, and a broken store never throws', () => {
  const store = memoryStorage();
  const s = {
    ...DEFAULT_SETTINGS,
    critter: 'otter' as const,
    size: 'l' as const,
    bots: 6,
    rounds: 5 as const,
  };
  saveSettings(store, s);
  expect(loadSettings(store)).toEqual(s);
  store.setItem('kaboom.settings', '{not json');
  expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {},
  };
  expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  expect(() => saveSettings(broken, s)).not.toThrow();
  expect(loadStats(broken).matches).toBe(0);
});

test('stats: matches and wins are counted per critter', () => {
  const store = memoryStorage();
  recordMatch(store, 'mole', true);
  recordMatch(store, 'mole', false);
  const s = recordMatch(store, 'otter', true);
  expect(s.matches).toBe(3);
  expect(s.wins).toBe(2);
  expect(loadStats(store).byCritter).toEqual({
    mole: { played: 2, won: 1 },
    otter: { played: 1, won: 1 },
  });
});

// ------------------------------------------------------------------ input maths

test('keys: opposite keys cancel, diagonals are not faster, WASD = arrows', () => {
  expect(keysToDir(new Set(['KeyA', 'KeyD']))).toEqual({ dx: 0, dy: 0 });
  expect(keysToDir(new Set(['ArrowUp']))).toEqual({ dx: 0, dy: -1 });
  expect(keysToDir(new Set(['KeyS']))).toEqual({ dx: 0, dy: 1 });
  const d = keysToDir(new Set(['KeyW', 'KeyD']));
  expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1);
  expect(d.dx).toBeGreaterThan(0);
  expect(d.dy).toBeLessThan(0);
});

test('touch stick: dead zone, full speed at the max drag, the origin follows a long drag', () => {
  expect(dragToDir(3, 3)).toEqual({ dx: 0, dy: 0 });
  const full = dragToDir(200, 0);
  expect(full.dx).toBeCloseTo(1);
  expect(Math.hypot(...Object.values(dragToDir(30, 30)))).toBeLessThan(1);
  expect(followOrigin(0, 0, 30, 0, 64)).toEqual({ x: 0, y: 0 });
  expect(followOrigin(0, 0, 100, 0, 64).x).toBeCloseTo(36);
});

test('gamepad: stick dead zone, d-pad wins', () => {
  const none = { up: false, down: false, left: false, right: false };
  expect(padToDir([0.1, -0.2], none)).toEqual({ dx: 0, dy: 0 });
  expect(padToDir([1, 0], none).dx).toBeCloseTo(1);
  expect(padToDir([1, 0], { ...none, down: true })).toEqual({ dx: 0, dy: 1 });
});

test('controls: keyboard moves, one press places one TNT, Escape pauses, disabled = silent', () => {
  const surface = document.createElement('div');
  const overlay = document.createElement('div');
  const c = new Controls(surface, overlay);
  let paused = 0;
  c.onPause = () => paused++;
  const out: PlayerInput = { dx: 0, dy: 0, place: false };
  const key = (type: string, code: string, repeat = false) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, repeat }));

  key('keydown', 'KeyD');
  expect(c.read(out)).toEqual({ dx: 0, dy: 0, place: false }); // disabled

  c.setEnabled(true);
  expect(c.read(out).dx).toBe(1);
  key('keydown', 'Space');
  expect(c.read(out).place).toBe(true);
  expect(c.read(out).place).toBe(false); // edge-triggered: consumed
  key('keydown', 'Space', true); // key repeat does not place again
  expect(c.read(out).place).toBe(false);
  key('keyup', 'KeyD');
  expect(c.read(out).dx).toBe(0);
  key('keydown', 'Escape');
  expect(paused).toBe(1);
  c.setEnabled(false);
  key('keydown', 'Escape');
  expect(paused).toBe(1);
});

// ------------------------------------------------------------------ camera

test('camera: small / medium arenas are fitted whole, big ones and tall screens follow the player inside the slab', () => {
  const rig = new CameraRig();
  rig.camera.aspect = 16 / 9;
  rig.camera.updateProjectionMatrix();
  rig.fitView(MAP_SIZES.m.w, MAP_SIZES.m.h);
  expect(rig.following).toBe(false);
  expect(MAP_SIZES.m.w * MAP_SIZES.m.h).toBeLessThanOrEqual(FOLLOW_ABOVE_CELLS);

  rig.fitView(MAP_SIZES.l.w, MAP_SIZES.l.h);
  expect(rig.following).toBe(true);
  const dist = rig.distance;
  for (let i = 0; i < 200; i++) rig.followTo(-50, 50, 0.05); // far corner: clamped
  expect(Math.abs(rig.target.x)).toBeLessThan(MAP_SIZES.l.w / 2);
  expect(Math.abs(rig.target.z)).toBeLessThan(MAP_SIZES.l.h / 2);
  expect(rig.target.x).toBeLessThan(0);
  expect(rig.target.z).toBeGreaterThan(0);
  for (let i = 0; i < 200; i++) rig.followTo(0, 0, 0.05);
  expect(Math.abs(rig.target.x)).toBeLessThan(0.05);

  rig.camera.aspect = 9 / 19; // a phone held upright
  rig.camera.updateProjectionMatrix();
  rig.fitView(MAP_SIZES.s.w, MAP_SIZES.s.h);
  expect(rig.following).toBe(true);
  expect(rig.distance).toBeGreaterThan(0);
  expect(dist).toBeGreaterThan(0);
});

// ------------------------------------------------------------------ HUD + menus

test('hud: a chip per player, round and TNT text, out state, banners', () => {
  const sim = simOn(['#########', '#0.....1#', '#########'], { rounds: 3 }, 0);
  const root = document.createElement('div');
  const hud = new Hud(root, () => {}, portraits);
  hud.setPlayers(sim);
  expect(root.querySelectorAll('.kb-chip').length).toBe(2);
  hud.show();
  hud.update(sim, 3);
  expect(root.querySelector('.kb-timer')!.textContent).toBe('2:00');
  expect(root.querySelector('.kb-round')!.textContent).toBe('Round 1 / 3');
  expect(root.querySelector('.kb-tntleft')!.textContent).toBe('TNT 1');

  (sim.players[1] as { state: string }).state = 'ko';
  hud.update(sim, 3);
  expect(root.querySelectorAll('.kb-chip.out').length).toBe(1);

  hud.setBanner('3');
  expect(root.querySelector('.kb-banner')!.textContent).toBe('3');
  expect(root.querySelector('.kb-banner')!.classList.contains('show')).toBe(
    true,
  );
  hud.setBanner('');
  expect(root.querySelector('.kb-banner')!.classList.contains('show')).toBe(
    false,
  );
  hud.update(sim, 1);
  expect((root.querySelector('.kb-round') as HTMLElement).style.display).toBe(
    'none',
  );
});

function menuApi(over: Partial<MenuApi> = {}): MenuApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    settings: { ...DEFAULT_SETTINGS },
    portraits,
    stats: () => ({ matches: 0, wins: 0, byCritter: {} }),
    onPlay: (s) => calls.push(`play ${JSON.stringify(s)}`),
    onSettings: () => calls.push('settings'),
    onVolume: (v) => calls.push(`volume ${v}`),
    onQuality: (q) => calls.push(`quality ${q}`),
    onResume: () => calls.push('resume'),
    onRestart: () => calls.push('restart'),
    onMainMenu: () => calls.push('menu'),
    onClick: () => {},
    ...over,
  };
}

const buttons = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].filter((b) =>
    b.textContent?.includes(text),
  );

test('menu: welcome -> setup -> pick a critter and an arena -> Start hands over the setup', () => {
  const root = document.createElement('div');
  const api = menuApi();
  const menu = new Menu(root, api);
  menu.welcome();
  expect(root.querySelector('.kb-logo')).not.toBeNull();
  buttons(root, 'Play')[0].click();
  expect(root.querySelectorAll('.kb-critter').length).toBe(8);

  (root.querySelectorAll('.kb-critter')[6] as HTMLElement).click(); // capybara
  expect(api.settings.critter).toBe('capybara');
  buttons(root, 'Small')[0].click();
  expect(api.settings.size).toBe('s');
  expect(api.settings.bots).toBe(3); // clamped to the small arena
  buttons(root, 'Hard')[0].click();
  buttons(root, 'Best of 5')[0].click();
  buttons(root, 'Start!')[0].click();
  const play = api.calls.find((c) => c.startsWith('play '))!;
  expect(JSON.parse(play.slice(5))).toEqual({
    critter: 'capybara',
    bots: 3,
    difficulty: 'hard',
    size: 's',
    rounds: 5,
  });
});

test('menu: the bot stepper stays within the arena size', () => {
  const root = document.createElement('div');
  const api = menuApi();
  api.settings.size = 'm';
  api.settings.bots = 5;
  const menu = new Menu(root, api);
  menu.setup();
  const plus = buttons(root, '+')[0] as HTMLButtonElement;
  const minus = buttons(root, '−')[0] as HTMLButtonElement;
  expect(plus.disabled).toBe(true); // medium = 6 players = 5 bots
  for (let i = 0; i < 6; i++) minus.click();
  expect(api.settings.bots).toBe(1);
  expect(minus.disabled).toBe(true);
});

test('menu: pause, options and results screens', () => {
  const root = document.createElement('div');
  const api = menuApi();
  const menu = new Menu(root, api);
  menu.pause();
  buttons(root, 'Resume')[0].click();
  buttons(root, 'Main menu')[0].click();
  expect(api.calls).toEqual(['resume', 'menu']);

  menu.options(() => menu.pause());
  const range = root.querySelector('input[type=range]') as HTMLInputElement;
  range.value = '0.2';
  range.dispatchEvent(new Event('input'));
  buttons(root, 'Low')[0].click();
  expect(api.calls).toContain('volume 0.2');
  expect(api.calls).toContain('quality low');

  menu.results({
    outcome: 'win',
    headline: 'You win the match!',
    rounds: 3,
    standings: [
      { critter: 'mole', wins: 2, you: true, slot: 0 },
      { critter: 'badger', wins: 1, you: false, slot: 1 },
      { critter: 'beaver', wins: 0, you: false, slot: 2 },
    ],
  });
  expect(root.querySelector('h2')!.textContent).toBe('You win the match!');
  const names = [...root.querySelectorAll('.kb-standings .name')].map(
    (n) => n.textContent,
  );
  expect(names).toEqual(['Mole (you)', 'Badger', 'Beaver']);
  buttons(root, 'Play again')[0].click();
  expect(api.calls.at(-1)).toBe('restart');
  menu.hide();
  expect(root.querySelector('.kb-card')).toBeNull();
});
