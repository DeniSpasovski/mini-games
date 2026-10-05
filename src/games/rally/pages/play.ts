import { probeScene } from '../engine/perf-probe';
import '../game/hud.css';
import '../game/menu.css';
import { goToPortal, portalUrl } from '../../../shared/portal-link';
import { installThumbnailCapture } from '../../../shared/thumbnail';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { DEFAULT_CAR } from '../cars';
import { loadQuality } from '../engine/quality';
import {
  buildLeaderboard,
  buildOptions,
  buildSectors,
  runMenu,
} from '../game/menu';
import {
  activateFocused,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
} from '../game/pad-nav';
import { RallyGame } from '../game/rally-game';
import { loadSettings } from '../game/settings';
import {
  forceLandscape,
  isTouchDevice,
  TouchControls,
} from '../game/touch-controls';
import { formatDelta, formatTime, purgeStaleTimes } from '../game/stage';
import { DEFAULT_MAP, getMap } from '../maps';
import { SETUP_FOR_TYRE, SETUP_IDS } from '../physics/car-setup';
import { isGearingId } from '../physics/gearing';
import { parseTyre } from '../physics/tyres';

/**
 * /games/rally/                -> main menu (welcome -> stage -> car, options)
 * /games/rally/?map=test&car=skoda_rally&livery=3&tyre=tarmac|mixed|gravel&susp=soft|medium|stiff&gear=short|medium|long&spawn=start|pad|<metres>&quality=high
 *                              -> straight into the stage (deep links from the tool pages, reloads)
 */
const DEFAULTS = {
  map: DEFAULT_MAP,
  car: DEFAULT_CAR,
  livery: 0,
  /** '' = the map's recommended tyre. */
  tyre: '',
  /** '' = the recommended suspension for the tyre (gravel soft, mixed medium, tarmac stiff). */
  susp: '',
  /** '' = the map's recommended gearing (medium unless the map says otherwise; fixed-gearing cars ignore it). */
  gear: '',
  spawn: 'start',
};
/** Only `spawn` is dropped at its default, so the URL stays a deep link. */
const KEEP = { spawn: DEFAULTS.spawn };
const root = document.querySelector<HTMLElement>('#root')!;
const search = new URLSearchParams(location.search);
const deepLink = Object.keys(DEFAULTS).some((k) => search.has(k));
/** Phones / tablets: on-screen controls + landscape only (menus included). */
const touch = isTouchDevice();
if (touch) {
  document.documentElement.classList.add('touch');
  forceLandscape();
}

/** "All games" button, only when the game runs inside the portal (PWA has no back button). */
const portalButton = portalUrl()
  ? `<button data-a="portal">All games</button>`
  : '';

purgeStaleTimes(); // physics changed -> old stage times are erased before any menu reads them

if (deepLink) play(readUrlState(DEFAULTS));
else
  void runMenu(root).then((r) => {
    // Mirror the choice in the URL: reload = same stage, link is shareable.
    const { setup, gearing, ...rest } = r;
    const params = { ...DEFAULTS, ...rest, susp: setup, gear: gearing };
    writeUrlState(params, KEEP);
    play(params);
  });

/** Back to the main menu (fresh page: the stage isn't torn down in place). */
function mainMenu(): void {
  location.href = location.pathname;
}

function play(params: typeof DEFAULTS): void {
  const loading = overlay(`
    <div class="box">
      <h2>Loading stage…</h2>
      <div class="bar"><div></div></div>
      <div class="status">Preparing</div>
    </div>`);

  const tyre = parseTyre(params.tyre, getMap(params.map).tyre);
  const setup =
    SETUP_IDS.find((s) => s === params.susp) ?? SETUP_FOR_TYRE[tyre];
  const gearing = isGearingId(params.gear)
    ? params.gear
    : (getMap(params.map).gearing ?? 'medium');
  const game = new RallyGame(root, {
    mapId: params.map,
    carId: params.car,
    livery: params.livery,
    tyre,
    setup,
    gearing,
    spawn: params.spawn,
    quality: loadQuality(),
    settings: loadSettings(),
  });
  (window as unknown as { __rally: RallyGame }).__rally = game;
  // Dev tool: what the camera draws, by group / asset (`__rallyProbe()` in the console, engine/perf-probe.ts).
  (window as unknown as { __rallyProbe: () => unknown }).__rallyProbe = () =>
    probeScene(game.scene, game.camera, game.renderer);

  const nav = (o: Partial<typeof DEFAULTS>) => {
    writeUrlState({ ...params, ...o }, KEEP);
    location.reload();
  };
  const freeDrive = params.spawn !== 'start';

  // --- pause menu (Esc) -----------------------------------------------------------------
  const pause = overlay(`<div class="box"></div>`);
  pause.classList.add('hidden');
  const pauseBox = pause.querySelector<HTMLElement>('.box')!;
  let pauseView: 'menu' | 'options' = 'menu';
  const showPauseMenu = () => {
    pauseView = 'menu';
    pauseBox.innerHTML = `
      <h2>Paused</h2>
      <div class="menu">
        <button data-a="resume">Resume</button>
        <button data-a="restart">Restart stage</button>
        <button data-a="${freeDrive ? 'stage' : 'pad'}">${freeDrive ? 'Back to the stage start' : 'Free drive on the test pad'}</button>
        <button data-a="options">Options</button>
        <button data-a="menu">Main menu</button>
        ${portalButton}
      </div>`;
    pauseBox.querySelector<HTMLElement>('[data-a="resume"]')!.focus();
  };
  const showPauseOptions = () => {
    pauseView = 'options';
    pauseBox.innerHTML = `<h2>Options</h2>`;
    pauseBox.append(
      buildOptions({
        onBack: showPauseMenu,
        onChange: (s) => game.applySettings(s),
        // The renderer is built for one quality: reload into the same stage.
        onQuality: () => {
          const u = new URL(location.href);
          u.searchParams.delete('quality');
          location.href = u.toString();
        },
      }),
    );
    pauseBox.querySelector<HTMLElement>('.menu-opt button.on')?.focus();
  };
  pause.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'resume') game.setPaused(false);
    if (a === 'restart') game.restart();
    if (a === 'pad') nav({ spawn: 'pad' });
    if (a === 'stage') nav({ spawn: 'start' });
    if (a === 'options') showPauseOptions();
    if (a === 'menu') mainMenu();
    if (a === 'portal') goToPortal();
  });

  // --- stage results ------------------------------------------------------------------------
  const results = overlay(`
    <div class="box results">
      <div class="res-main">
        <h2>Stage complete</h2>
        <div class="yours">
          <div class="label">Your time</div>
          <div class="result" data-ref="time"></div>
          <div class="sub" data-ref="sub"></div>
          <div data-ref="sectors"></div>
        </div>
        <div class="menu">
          <button data-a="again">Drive again (Enter)</button>
          <button data-a="menu">Main menu</button>
          ${portalButton}
        </div>
      </div>
      <div class="res-board" data-ref="board"></div>
    </div>`);
  results.classList.add('hidden');
  const hideResults = () => {
    results.classList.add('hidden');
    game.input.enabled = !game.paused;
  };
  results.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'again') {
      hideResults();
      game.restart();
    }
    if (a === 'menu') mainMenu();
    if (a === 'portal') goToPortal();
  });

  let touchControls: TouchControls | undefined;
  game.onPauseChange = (p) => {
    touchControls?.reset();
    // Unhide first: showPauseMenu() focuses Resume, which fails while hidden.
    pause.classList.toggle('hidden', !p);
    if (p) showPauseMenu();
    if (p) hideResults();
  };
  game.onFinish = (time, delta, run, board) => {
    const sectors = buildSectors(board, run);
    results
      .querySelector('[data-ref="board"]')!
      .replaceChildren(buildLeaderboard(board, run, sectors.setScope));
    results.querySelector('[data-ref="sectors"]')!.replaceChildren(sectors);
    results.querySelector('[data-ref="time"]')!.innerHTML =
      formatTime(time) +
      (run.penalty ? ` <span class="pen">(+${run.penalty}s)</span>` : '');
    results.querySelector('[data-ref="sub"]')!.textContent =
      delta === undefined
        ? 'First time on this stage with this car.'
        : delta <= 0
          ? `New best! ${formatDelta(delta)}`
          : `${formatDelta(delta)} to your best`;
    setTimeout(() => {
      results.classList.remove('hidden');
      // The results own the pad now (A = confirm, not handbrake).
      game.input.enabled = false;
      if (game.paused) return;
      results.querySelector<HTMLElement>('[data-a="again"]')!.focus();
    }, 1200);
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') hideResults();
  });

  // --- gamepad: drive whichever overlay is open --------------------------------------------
  // Start toggles pause in the game itself (input.ts), so it's ignored here.
  new GamepadMenuNav((a: NavAction) => {
    const box = !pause.classList.contains('hidden')
      ? pauseBox
      : !results.classList.contains('hidden')
        ? results
        : null;
    if (!box || a === 'start') return;
    if (a === 'confirm') activateFocused(box);
    else if (a === 'back') {
      if (box !== pauseBox) return;
      if (pauseView === 'options') showPauseMenu();
      else game.setPaused(false);
    } else moveFocus(box, a);
  });

  installThumbnailCapture('rally', () => {
    game.renderer.render(game.scene, game.camera);
    return game.renderer.domElement;
  });

  game
    .init((f, text) => {
      loading.querySelector<HTMLElement>('.bar div')!.style.width =
        `${f * 100}%`;
      loading.querySelector('.status')!.textContent = text;
    })
    .then(() => {
      loading.remove();
      if (touch)
        touchControls = new TouchControls(root, game.input, () =>
          game.setPaused(true),
        );
      game.start();
    })
    .catch((err) => {
      loading.querySelector('.status')!.textContent = `Failed: ${err}`;
      console.error(err);
    });
}

function overlay(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = html;
  root.append(el);
  return el;
}
