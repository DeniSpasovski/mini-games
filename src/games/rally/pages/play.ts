import { probeScene } from '../engine/perf-probe';
import '../game/ui-tokens.css';
import '../game/hud.css';
import '../game/menu.css';
import { portalUrl } from '../../../shared/portal-link';
import { installThumbnailCapture } from '../../../shared/thumbnail';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { DEFAULT_CAR, getCar } from '../cars';
import { preloadCarModel } from '../cars/shared/car-gltf';
import { preloadRoadSurfaces } from '../engine/road-surface';
import { loadQuality } from '../engine/quality';
import {
  buildLeaderboard,
  buildOptions,
  buildSectors,
  runMenu,
  stagePlateHtml,
} from '../game/menu';
import {
  activateFocused,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
} from '../../../shared/pad-nav';
import { RallyGame } from '../game/rally-game';
import { loadSettings } from '../game/settings';
import {
  forceLandscape,
  isTouchDevice,
  TouchControls,
} from '../game/touch-controls';
import { formatDelta, formatTime, migrateTimes } from '../game/stage';
import { DEFAULT_STAGE, getStage, loadStage, stageLinkParams } from '../maps';
import { SETUP_FOR_TYRE, SETUP_IDS } from '../physics/car-setup';
import { isGearingId } from '../physics/gearing';
import { parseTyre, TYRES, wetTyre } from '../physics/tyres';
import {
  isRaining,
  offeredWeathers,
  WEATHER_LOOKS,
  weatherLook,
  weatherParam,
} from '../weather';
import { paramInt } from '../../../shared/url-params';
import { stageSeason } from '../maps/shared/climate';
import { seasonParam } from '../season';
import { stageCardImageUrl } from '../tools/stage-card';
import { ReplayUi } from '../game/replay/replay-ui';
import { readHeader } from '../game/replay/codec';
import { nameForm, storageLine } from '../game/replay/manage-ui';
import {
  cleanName,
  loadReplay,
  renameReplay,
  replayId,
  REPLAYS_ENABLED,
} from '../game/replay/store';

/**
 * /games/rally/                -> main menu (welcome -> stage -> car, options)
 * /games/rally/?stage=test&car=skoda_rally&livery=3&tyre=tarmac|mixed|gravel&susp=soft|medium|stiff&gear=short|medium|long&spawn=start|pad|<metres>&quality=high
 *                              -> straight into the stage (deep links from the tool pages, reloads)
 * Old links say `map=<id>`: every old map id is its stage's id, so it is read as the stage.
 */
const DEFAULTS = {
  stage: DEFAULT_STAGE,
  car: DEFAULT_CAR,
  livery: 0,
  /** '' = the stage's recommended tyre. */
  tyre: '',
  /** '' = the recommended suspension for the tyre (gravel soft, mixed medium, tarmac stiff). */
  susp: '',
  /** '' = the stage's recommended gearing (medium unless the stage says otherwise; fixed-gearing cars ignore it). */
  gear: '',
  spawn: 'start',
};
/** Only `spawn` is dropped at its default, so the URL stays a deep link. */
const KEEP = { spawn: DEFAULTS.spawn };
const root = document.querySelector<HTMLElement>('#root')!;
const search = rewriteOldLink(new URLSearchParams(location.search));
const deepLink = Object.keys(DEFAULTS).some((k) => search.has(k));
/** Phones / tablets: on-screen controls + landscape only (menus included). */
const touch = isTouchDevice();
if (touch) {
  document.documentElement.classList.add('touch');
  forceLandscape();
}

/** "All games" button, only when the game runs inside the portal (PWA has no back button). */
const portalButton = portalUrl()
  ? `<button class="menu-btn" data-a="portal">All games</button>`
  : '';

migrateTimes(); // physics changed -> old stage times are tagged with their version before any menu reads them

if (deepLink) void play(readUrlState(DEFAULTS));
else
  void runMenu(root).then((r) => {
    // Mirror the choice in the URL: reload = same stage, link is shareable.
    const { setup, gearing, tod, season, weather, ...rest } = r;
    const params = { ...DEFAULTS, ...rest, susp: setup, gear: gearing };
    // `tod` / `season` / `weather` = picked on the stage screen (the game reads them); none = the stage's own / dry.
    writeUrlState(
      {
        ...params,
        tod: tod ?? '',
        season: season ?? '',
        weather: weather ?? '',
      },
      { ...KEEP, tod: '', season: '', weather: '' },
    );
    void play(params);
  });

/** An old `map=<id>` link is rewritten in place to its `stage=<id>` form (`stageLinkParams`, no reload). */
function rewriteOldLink(params: URLSearchParams): URLSearchParams {
  const out = stageLinkParams(params);
  if (!out) return params;
  history.replaceState(
    history.state,
    '',
    `${location.pathname}?${out.toString()}${location.hash}`,
  );
  return out;
}

/**
 * Leave the stage for another page (fresh page: the stage isn't torn down in place). The browser keeps showing the old
 * page until the new one paints (~2 s after a big stage), which looked like a frozen game: a loading screen goes up
 * first and the page changes once it is on screen.
 */
function leaveTo(url: string, title: string): void {
  const el = overlay(
    `<div class="box"><h2>${title}</h2><div class="bar"><div></div></div></div>`,
    'loading leaving',
  );
  // A finished run's replay still being saved gets a moment to finish (never more than LEAVE_WAIT_MS).
  const saved = Promise.race([
    beforeLeave(),
    new Promise((r) => setTimeout(r, LEAVE_WAIT_MS)),
  ]);
  requestAnimationFrame(() => {
    // No real progress to show: the bar eases towards the end while the next page loads.
    el.querySelector<HTMLElement>('.bar div')!.style.width = '90%';
    void saved.then(() =>
      requestAnimationFrame(() => {
        location.href = url;
      }),
    );
  });
}

/** Longest wait for `beforeLeave` before the page changes (ms). */
const LEAVE_WAIT_MS = 1500;
/** Runs before the page is left (play: saves the finished run's replay if its tail is still recording). */
let beforeLeave: () => Promise<unknown> = () => Promise.resolve();

/** Back to the main menu. */
function mainMenu(): void {
  leaveTo(location.pathname, 'Loading menu…');
}

/** To the portal (when the game is hosted there). */
function toPortal(): void {
  const url = portalUrl();
  if (url) leaveTo(url, 'Loading…');
}

async function play(raw: typeof DEFAULTS): Promise<void> {
  // Only real values go on: known stage / car ids (unknown -> default), a whole livery number, a spawn that is metres or a short name.
  const params = {
    ...raw,
    stage: getStage(raw.stage).id,
    car: getCar(raw.car).id,
    livery: paramInt(String(raw.livery), 0, 9999, 0),
    spawn: /^(\d{1,6}(\.\d{1,3})?|[a-z][a-z0-9_-]{0,31})$/.test(raw.spawn)
      ? raw.spawn
      : 'start',
  };
  const info = getStage(params.stage);
  const loading = overlay(
    `
    <div class="box">
      <h2>Loading stage…</h2>
      <div class="bar"><div></div></div>
      <div class="status">Preparing</div>
    </div>
    <div class="stage-plate">${stagePlateHtml(info)}</div>`,
    'loading',
  );
  // The stage's baked card (aerial picture) behind the loading box, in the season the stage runs in; none = plain glass.
  void stageCardImageUrl(
    info.map,
    info.id,
    seasonParam(
      new URLSearchParams(location.search).get('season'),
      stageSeason(info),
    ),
  ).then((url) => {
    if (url) loading.style.setProperty('--card', `url("${url}")`);
  });
  // In the wet the stage's tyre is its wet one, and no near-slicks start in the rain (an old link / saved pick).
  const weather = weatherParam(
    new URLSearchParams(location.search).get('weather'),
  );
  const recTyre = wetTyre(info.tyre, weatherLook(weather, info.weather).wet);
  let tyre = parseTyre(params.tyre, recTyre);
  if (isRaining(weather) && TYRES[tyre].dryOnly)
    tyre = TYRES[recTyre].dryOnly ? 'mixed' : recTyre;
  // Tarmac Wet is not offered while the build ships dry only (an old link).
  if (
    tyre === 'tarmac_wet' &&
    !offeredWeathers().some((w) => WEATHER_LOOKS[w].wet > 0)
  )
    tyre = recTyre;
  const setup =
    SETUP_IDS.find((s) => s === params.susp) ?? SETUP_FOR_TYRE[tyre];
  const gearing = isGearingId(params.gear)
    ? params.gear
    : (info.gearing ?? 'medium');
  // The map's baked data is its own chunk: fetched here, behind the loading overlay.
  // The car's GLB downloads while the map's data loads / the world builds (both block the main thread a while).
  preloadCarModel(getCar(params.car));
  const setLoading = (f: number, text: string) => {
    loading.querySelector<HTMLElement>('.bar div')!.style.width = `${f * 100}%`;
    loading.querySelector('.status')!.textContent = text;
  };
  setLoading(0.01, 'Loading map data');
  await paintNow();
  const { map, stage } = await loadStage(params.stage);
  setLoading(0.02, 'Loading road textures');
  await preloadRoadSurfaces(map);
  // Building the world is one synchronous step: show its label first.
  setLoading(0.03, 'Building world');
  await paintNow();
  const game = new RallyGame(root, {
    map,
    stage,
    carId: params.car,
    livery: params.livery,
    tyre,
    setup,
    gearing,
    spawn: params.spawn,
    quality: loadQuality(),
    settings: loadSettings(),
  });
  beforeLeave = () => game.flushReplay();
  (window as unknown as { __rally: RallyGame }).__rally = game;
  // Dev tool: what the camera draws, by group / asset (`__rallyProbe()` in the console, engine/perf-probe.ts).
  (window as unknown as { __rallyProbe: () => unknown }).__rallyProbe = () =>
    probeScene(game.scene, game.camera, game.renderer);

  const nav = (o: Partial<typeof DEFAULTS>) => {
    game.trackQuit('spawn');
    writeUrlState({ ...params, ...o }, KEEP);
    location.reload();
  };
  const freeDrive = params.spawn !== 'start';

  // --- pause menu (Esc) -----------------------------------------------------------------
  const pause = overlay(`<div class="box"></div>`, 'pause');
  pause.classList.add('hidden');
  const pauseBox = pause.querySelector<HTMLElement>('.box')!;
  let pauseView: 'menu' | 'options' = 'menu';
  const showPauseMenu = () => {
    pauseView = 'menu';
    pauseBox.innerHTML = `
      <h2>Paused</h2>
      <div class="menu">
        <button class="menu-btn primary" data-a="resume">Resume</button>
        <button class="menu-btn" data-a="reset">Reset to road</button>
        <button class="menu-btn" data-a="restart">Restart stage</button>
        <button class="menu-btn" data-a="${freeDrive ? 'stage' : 'pad'}">${freeDrive ? 'Back to the stage start' : 'Free drive on the test pad'}</button>
        <button class="menu-btn" data-a="options">Options</button>
        <button class="menu-btn" data-a="menu">Main menu</button>
        ${portalButton}
      </div>`;
    pauseBox.querySelector<HTMLElement>('[data-a="resume"]')!.focus();
  };
  const showPauseOptions = () => {
    pauseView = 'options';
    pauseBox.innerHTML = `<h2>Options</h2>`;
    pauseBox.append(
      buildOptions({
        tractionControl: !getCar(params.car).physics.noTractionControl,
        abs: !getCar(params.car).physics.noAbs,
        onBack: showPauseMenu,
        onChange: (s) => {
          game.applySettings(s);
          touchControls?.setSteering(s.touchSteering);
        },
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
    if (a === 'reset') {
      game.setPaused(false);
      game.resetToRoad();
    }
    if (a === 'restart') game.restart();
    if (a === 'pad') nav({ spawn: 'pad' });
    if (a === 'stage') nav({ spawn: 'start' });
    if (a === 'options') showPauseOptions();
    if (a === 'menu') {
      game.trackQuit('menu');
      mainMenu();
    }
    if (a === 'portal') {
      game.trackQuit('portal');
      toPortal();
    }
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
          <button class="menu-btn primary" data-a="again">Drive again (Enter)</button>
          ${REPLAYS_ENABLED ? '<button class="menu-btn res-replay" data-a="replay">Watch replay<small data-ref="replayNote"></small></button><button class="menu-btn res-name" data-a="nameReplay" hidden>Save replay</button>' : ''}
          <button class="menu-btn" data-a="menu">Main menu</button>
          ${portalButton}
        </div>
        <div class="res-replay-extra" data-ref="replayExtra"></div>
      </div>
      <div class="res-board" data-ref="board"></div>
    </div>`);
  results.classList.add('hidden');
  const hideResults = () => {
    results.classList.add('hidden');
    game.input.enabled = !game.paused;
  };
  // --- replays (game/replay/) -----------------------------------------------------------------
  /** `?replay=<saved id>` (or `pending`: a pasted / loaded one) opens the page as a replay viewer. */
  const replayParam = REPLAYS_ENABLED
    ? new URLSearchParams(location.search).get('replay')
    : null;
  const replayUi = new ReplayUi(root, game, {
    exitLabel: replayParam ? 'Menu' : 'Results',
    canSave: !replayParam,
    onExit: () => {
      game.exitReplay();
      if (replayParam) {
        mainMenu();
        return;
      }
      results.classList.remove('hidden');
      game.input.enabled = false;
      results.querySelector<HTMLElement>('[data-a="replay"]')!.focus();
    },
  });
  const watch = async (file?: Uint8Array) => {
    try {
      await game.watchReplay(file);
    } catch (e) {
      console.error(e);
      game.hud.message('REPLAY NOT AVAILABLE', 2, 'small bad');
    }
  };
  // Every way into a replay (results, `?replay=`, the console's `__rally.replay`) shows the replay UI.
  game.onReplayChange = (on) => {
    if (!on) return replayUi.hide();
    results.classList.add('hidden');
    replayUi.show(game.watching!);
  };
  /** The finished run's saved replay (an auto save until named here). */
  let savedId: string | null = null;
  const replayNote = (text: string) => {
    const note = results.querySelector('[data-ref="replayNote"]');
    if (note) note.textContent = text;
  };
  const nameButton = () =>
    results.querySelector<HTMLButtonElement>('[data-a="nameReplay"]');
  /** A new finish: drop the last run's note / name button until this run's replay is saved (onReplayReady). */
  const clearReplayResult = () => {
    savedId = null;
    replayNote('');
    const nb = nameButton();
    if (nb) nb.hidden = true;
    results.querySelector('.res-name-form')?.remove();
    results.querySelector('[data-ref="replayExtra"]')?.replaceChildren();
  };
  game.onReplayReady = (file, saved) => {
    savedId = saved ? replayId(readHeader(file)) : null;
    replayNote(saved ? 'auto save' : '');
    const nb = nameButton();
    if (nb) {
      nb.hidden = !saved;
      nb.textContent = 'Save replay';
    }
    results.querySelector('.res-name-form')?.remove();
    const extra = results.querySelector<HTMLElement>(
      '[data-ref="replayExtra"]',
    )!;
    extra.replaceChildren();
    // Past the soft limit: the notice with "Delete auto saves" (saving never stops).
    if (saved)
      void storageLine(() => game.onReplayReady?.(file, saved)).then((line) => {
        if (line?.classList.contains('full')) extra.append(line);
      });
  };
  const nameReplay = () => {
    const nb = nameButton();
    if (!nb || !savedId) return;
    const id = savedId;
    const form = nameForm(
      '',
      async (raw) => {
        const name = cleanName(raw);
        if (await renameReplay(id, raw)) {
          replayNote(name ? `named “${name}”` : 'auto save');
          nb.textContent = name ? 'Rename replay' : 'Save replay';
        }
        form.remove();
        nb.hidden = false;
        nb.focus();
      },
      () => {
        form.remove();
        nb.hidden = false;
        nb.focus();
      },
    );
    form.classList.add('res-name-form');
    nb.hidden = true;
    nb.after(form);
  };

  results.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
      ?.dataset.a;
    if (a === 'again') {
      hideResults();
      game.restart();
    }
    if (a === 'replay') void watch();
    if (a === 'nameReplay') nameReplay();
    if (a === 'menu') mainMenu();
    if (a === 'portal') toPortal();
  });

  let touchControls: TouchControls | undefined;
  game.onPauseChange = (p) => {
    touchControls?.reset();
    // Unhide first: showPauseMenu() focuses Resume, which fails while hidden.
    pause.classList.toggle('hidden', !p);
    if (p) showPauseMenu();
    if (p) hideResults();
  };
  game.onFinish = (time, delta, run, board, refSectors) => {
    if (REPLAYS_ENABLED) clearReplayResult();
    const sectors = buildSectors(run, refSectors);
    results
      .querySelector('[data-ref="board"]')!
      .replaceChildren(
        buildLeaderboard(board, run, game.world.map.environment.timeOfDay),
      );
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
    if (e.code === 'Enter' && !replayUi.open) hideResults();
  });

  // --- gamepad: drive whichever overlay is open --------------------------------------------
  // Start toggles pause in the game itself (input.ts), so it's ignored here.
  new GamepadMenuNav((a: NavAction) => {
    const box = replayUi.open
      ? replayUi.box
      : !pause.classList.contains('hidden')
        ? pauseBox
        : !results.classList.contains('hidden')
          ? results
          : null;
    if (!box || a === 'start') return;
    if (a === 'confirm') activateFocused(box);
    else if (a === 'back') {
      if (box === replayUi.box) {
        replayUi.setClean(false);
        document
          .querySelector<HTMLElement>('.replay-ui [data-a="exit"]')
          ?.click();
        return;
      }
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
    .init(setLoading)
    .then(async () => {
      // F2 panel: the hidden debug exports (also `__rally.replay` in the console).
      if (REPLAYS_ENABLED) {
        game.telemetry.addAction('Copy replay', () => game.replay.copy());
        game.telemetry.addAction('Copy trace 5 s', () =>
          game.replay.copyTrace(5, 4),
        );
        game.telemetry.addAction('Download trace 20 s', () =>
          game.replay.downloadTrace(20, 1),
        );
      }
      if (replayParam) {
        const file = await loadReplay(replayParam);
        if (file) await watch(file);
        else game.hud.message('REPLAY NOT FOUND', 2.5, 'small bad');
      }
      loading.remove();
      if (touch)
        touchControls = new TouchControls(
          root,
          game.input,
          () => game.setPaused(true),
          () => game.resetToRoad(),
          loadSettings().touchSteering,
        );
      game.start();
      // `?perf=1`: open the perf panel (the ` key in game, game/perf-panel.ts).
      if (new URLSearchParams(location.search).get('perf') === '1')
        game.togglePerfPanel();
      // Tree benchmark (trees/Performance.md#benchmark): `?treebench=1` runs the path with and without trees and
      // downloads the report; `treebench=trees` skips the run without them.
      const bench = new URLSearchParams(location.search).get('treebench');
      if (bench)
        void game
          .treeBenchmark({ withoutTrees: bench !== 'trees' })
          .then((r) =>
            console.info(`tree cost ${r.treeCostMs ?? '?'} ms / frame`, r),
          );
    })
    .catch((err) => {
      loading.querySelector('.status')!.textContent = `Failed: ${err}`;
      console.error(err);
    });
}

/** Resolves once the browser has painted the last DOM change. */
function paintNow(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
}

function overlay(html: string, kind = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `overlay ${kind}`.trim();
  el.innerHTML = html;
  root.append(el);
  return el;
}
