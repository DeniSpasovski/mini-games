import { carName, CARS, DEFAULT_CAR } from '../cars';
import {
  clampCarNumber,
  MAX_CAR_NUMBER,
  MIN_CAR_NUMBER,
  rallyName,
  type RallyBadge,
} from '../cars/shared/rally-badge';
import type { CarDef } from '../cars/shared/types';
import {
  loadQuality,
  QUALITY,
  saveQuality,
  type QualityName,
  type QualitySettings,
} from '../engine/quality';
import { DEFAULT_MAP, MAPS } from '../maps';
import type { MapDef, SourceLink } from '../maps/shared/types';
import { peakPower } from '../physics/drivetrain';
import {
  applySetup,
  compliance,
  SETUP_COLORS,
  SETUP_FOR_TYRE,
  SETUP_IDS,
  SETUP_NAMES,
  setupCharacter,
} from '../physics/car-setup';
import { carGripRating, tyreLabel, tyreSizeFor } from '../physics/car-tyres';
import {
  applyGearing,
  GEARING_IDS,
  GEARING_NAMES,
  gearTopSpeeds,
  isGearingId,
  hasGearings,
  topSpeed,
} from '../physics/gearing';
import { SURFACES } from '../physics/surfaces';
import {
  GRIP_LABELS,
  isTyreId,
  TYRE_IDS,
  TYRES,
  type TyreId,
} from '../physics/tyres';
import type { CarPhysicsDef, GearingId, SetupId } from '../physics/types';
import { isTestCar, isTestMap, TEST_NOTE } from '../release';
import { portalUrl } from '../../../shared/portal-link';
import gameManifest from '../game.json';
import {
  DISPLAY_MODES,
  isHdrDisplay,
  loadDisplayMode,
  saveDisplayMode,
} from '../engine/display';
import { CAMERA_MODES, type CameraMode } from './camera-rig';
import {
  activateFocused,
  GamepadMenuNav,
  moveFocus,
  type NavAction,
  type NavDir,
} from './pad-nav';
import { loadSettings, saveSettings, type RallySettings } from './settings';
import { Showroom } from './showroom';
import { formatTime, loadTimes, sectorTimes, type RunRecord } from './stage';

/** Game version (game.json, semver 0.x.y), shown in the menu + About. */
const VERSION = gameManifest.version;

const CAR_IDS = CARS.map((c) => c.id);

const KEY_DIRS: Record<string, NavDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const BUILT_WITH: SourceLink[] = [
  { label: 'three.js', url: 'https://threejs.org/', note: 'rendering, MIT' },
  { label: 'Rsbuild', url: 'https://rsbuild.rs/', note: 'build tooling, MIT' },
];

/**
 * Main menu flow:  welcome -> (options) / map select -> car select -> start; the car screen has an optional
 * "Setup car" screen (tyres + suspension + gearing, defaults = the stage recommendation, see PHYSICS.md / README
 * "Setup screen").
 * Mouse, keyboard (arrows, Enter, Esc = back) or gamepad (d-pad / stick,
 * A confirm, B back - see pad-nav.ts). The selected car turns on a
 * 3D showroom behind the panel. Resolves with the chosen stage.
 */
export interface MenuResult {
  map: string;
  car: string;
  livery: number;
  tyre: TyreId;
  setup: SetupId;
  gearing: GearingId;
}

type Screen = 'welcome' | 'options' | 'about' | 'map' | 'car' | 'setup';

export function runMenu(container: HTMLElement): Promise<MenuResult> {
  return new Promise((resolve) => {
    const menu = new MainMenu(container, loadQuality(), (r) => {
      menu.dispose();
      resolve(r);
    });
  });
}

class MainMenu {
  private root = document.createElement('div');
  private panel: HTMLDivElement;
  readonly showroom: Showroom;
  private screen: Screen = 'welcome';
  private settings: RallySettings;
  private mapIndex: number;
  private carIndex: number;
  private livery: number;
  /** Setup screen choices for one map + car (anything else resets to the stage recommendation, nothing is saved). */
  private pick: {
    map: string;
    car: string;
    tyre: TyreId;
    setup: SetupId;
    gearing: GearingId;
  } | null = null;
  /**
   * Setup screen: 0 = tyre row, 1 = suspension row, 2 = gearing row (cars that can change it) - up / down switch, left /
   * right change the choice.
   */
  private setupRow = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private pad = new GamepadMenuNav((a) => this.nav(a));

  constructor(
    container: HTMLElement,
    quality: QualitySettings,
    private done: (r: MenuResult) => void,
  ) {
    this.settings = loadSettings();
    this.mapIndex = Math.max(
      0,
      MAPS.findIndex((m) => m.id === (this.settings.map || DEFAULT_MAP)),
    );
    // The menu always opens on the default car (the map + livery are remembered).
    this.carIndex = Math.max(
      0,
      CARS.findIndex((c) => c.id === DEFAULT_CAR),
    );
    this.livery = this.settings.livery;

    this.root.className = 'menu-root';
    this.root.innerHTML = `
      <div class="menu-bg"></div>
      <div class="menu-panel"></div>
      <div class="menu-version">v${VERSION}</div>`;
    container.append(this.root);
    this.panel = this.root.querySelector('.menu-panel')!;
    this.showroom = new Showroom(this.root.querySelector('.menu-bg')!, quality);
    this.showroom.setCar(this.car.id, this.livery, this.badge);
    window.addEventListener('keydown', this.onKey);
    // Console handle: __rallyMenu.showroom
    (window as unknown as { __rallyMenu: MainMenu }).__rallyMenu = this;
    this.show('welcome');
  }

  private get map(): MapDef {
    return MAPS[this.mapIndex];
  }

  private get car(): CarDef {
    return CARS[this.carIndex];
  }

  private get picked(): boolean {
    return this.pick?.map === this.map.id && this.pick.car === this.car.id;
  }

  /** The stage recommended tyre / set-up (the set-up follows the tyre: gravel soft ... tarmac stiff). */
  private get recTyre(): TyreId {
    return this.map.tyre;
  }

  private get recSetup(): SetupId {
    return SETUP_FOR_TYRE[this.map.tyre];
  }

  private get tyre(): TyreId {
    return this.picked ? this.pick!.tyre : this.recTyre;
  }

  private get setup(): SetupId {
    return this.picked ? this.pick!.setup : this.recSetup;
  }

  /** The stage's recommended gearing (medium unless the map asks for another, e.g. long on a fast stage). */
  private get recGearing(): GearingId {
    return this.map.gearing ?? 'medium';
  }

  private get gearing(): GearingId {
    return this.picked ? this.pick!.gearing : this.recGearing;
  }

  /** Anything off the stage recommendation (gearing only counts on cars that can change it). */
  private get custom(): boolean {
    return (
      this.tyre !== this.recTyre ||
      this.setup !== this.recSetup ||
      (hasGearings(this.car.physics) && this.gearing !== this.recGearing)
    );
  }

  /** Door plates: the player's number (options) + the selected stage's rally name. */
  private get badge(): RallyBadge {
    return {
      number: loadSettings().carNumber,
      rally: rallyName(this.map.name),
    };
  }

  private show(screen: Screen): void {
    // Re-rendering the setup screen after a pick keeps its scroll position (three rows scroll on small screens).
    const keepScroll =
      screen === 'setup' && this.screen === 'setup' ? this.panel.scrollTop : 0;
    this.screen = screen;
    this.panel.dataset.screen = screen;
    this.panel.replaceChildren();
    if (screen === 'welcome') this.welcome();
    if (screen === 'options')
      this.panel.append(
        header('Options'),
        buildOptions({
          onBack: () => this.show('welcome'),
          // Car number -> door plates on the showroom car.
          onChange: () =>
            this.showroom.setCar(this.car.id, this.livery, this.badge),
        }),
      );
    if (screen === 'about') this.about();
    if (screen === 'map') this.mapSelect();
    if (screen === 'car') this.carSelect();
    if (screen === 'setup') this.setupSelect();
    // Stage select shows the map from the air, everything else the car.
    // The setup screen drives the showroom itself (parts bench, see setupSelect).
    if (screen === 'map') this.showroom.showMap(this.map.id);
    else if (screen !== 'setup') this.showroom.showCar();
    // Options start on the first setting, every other screen on its primary button.
    this.panel
      .querySelector<HTMLElement>(
        screen === 'options' ? '.menu-opt button.on' : '[data-primary]',
      )
      ?.focus({ preventScroll: true });
    this.panel.scrollTop = keepScroll;
  }

  private welcome(): void {
    // Inside the portal: a way back to the other games (PWA has no back button).
    const portal = portalUrl();
    this.panel.innerHTML = `
      <div class="menu-brand">
        <div class="menu-title">Gravel<br>Rally</div>
        <div class="menu-tagline">Point-to-point stages against the clock</div>
      </div>
      <div class="menu-list">
        <button class="menu-btn big" data-primary data-a="start">Start rally</button>
        <button class="menu-btn" data-a="options">Options</button>
        <button class="menu-btn" data-a="about">About</button>
        ${portal ? `<a class="menu-btn" href="${portal}">‹ All games</a>` : ''}
      </div>
      <div class="menu-foot">↑↓ select · Enter confirm · Esc back<br>Gamepad: D-pad select · A confirm · B back</div>`;
    this.panel
      .querySelector('[data-a="start"]')!
      .addEventListener('click', () => this.show('map'));
    this.panel
      .querySelector('[data-a="options"]')!
      .addEventListener('click', () => this.show('options'));
    this.panel
      .querySelector('[data-a="about"]')!
      .addEventListener('click', () => this.show('about'));
  }

  private about(): void {
    const links = (sources: SourceLink[] | undefined, none: string) =>
      sources?.length
        ? `<ul>${sources
            .map(
              (s) =>
                `<li>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>` : s.label}${s.note ? `<small>${s.note}</small>` : ''}</li>`,
            )
            .join('')}</ul>`
        : `<p class="menu-none">${none}</p>`;
    const body = div('menu-about');
    body.innerHTML = `
      <p class="menu-credit">This game was made using AI agents under direction of Deni S.</p>
      <p class="menu-credit">Version ${VERSION}</p>
      <p>Gravel Rally is a point-to-point rally game: one stage, one car, the clock. Beat your split times and
      climb the stage leaderboard. Custom raycast-vehicle physics at 240 Hz, streamed terrain, procedural
      forests, props, cars and liveries - and real-world stages baked from open map data.</p>
      <p class="menu-keys"><b>W/S</b> throttle / brake · <b>A/D</b> steer · <b>Space</b> handbrake ·
      <b>R</b> reset · <b>C</b> camera · <b>Esc</b> pause</p>
      <h2>Maps</h2>
      ${MAPS.map((m) => `<h3>${m.name}</h3>${links(m.sources, 'Fully procedural - no external data.')}`).join('')}
      <h2>Cars</h2>
      ${CARS.map((c) => `<h3>${c.name}</h3>${links(c.sources, 'Procedural model - no external sources.')}`).join('')}
      <h2>Built with</h2>
      ${links(BUILT_WITH, '')}`;
    this.panel.append(
      header('About'),
      body,
      buttons(['Back', () => this.show('welcome'), true]),
    );
  }

  private mapSelect(): void {
    this.panel.append(header('Select stage', 'Step 1 / 3'));
    const list = div('menu-cards');
    MAPS.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'menu-card';
      b.classList.toggle('selected', i === this.mapIndex);
      const best = loadTimes(m.id, CAR_IDS)[0];
      b.innerHTML = `
        ${routeSvg(m)}
        <div class="menu-card-body">
          <div class="menu-card-title">${m.name}${testBadge(isTestMap(m.id))}</div>
          <div class="menu-card-desc">${m.description}</div>
          <div class="menu-tags">
            <span>${(stageLength(m) / 1000).toFixed(1)} km</span>
            <span>${m.stage.splits} splits</span>
            <span>${[...new Set([m.road.surface, ...(m.road.sections ?? []).map((s) => s.surface)])].map((s) => s.replace(/_/g, ' + ')).join(' → ')}</span>
          </div>
          <div class="menu-best">${best ? `Best ${formatTime(best.time)} · ${carName(best.car)}` : 'No time set yet'}</div>
        </div>`;
      b.addEventListener('click', () => {
        if (this.mapIndex === i) return this.show('car');
        this.mapIndex = i;
        this.show('map');
      });
      list.append(b);
    });
    this.panel.append(
      list,
      buttons(
        ['Back', () => this.show('welcome')],
        ['Next: choose car ›', () => this.show('car'), true],
      ),
    );
  }

  private carSelect(): void {
    const car = this.car;
    this.showSetupCar();
    this.panel.append(header('Select car', `Step 2 / 3 · ${this.map.name}`));
    const list = div('menu-list compact');
    const times = loadTimes(this.map.id, CAR_IDS);
    CARS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'menu-btn menu-car';
      b.classList.toggle('selected', i === this.carIndex);
      const best = times.find((r) => r.car === c.id);
      b.innerHTML = `<span><b>${c.name}${testBadge(isTestCar(c.id))}</b><small>${c.className}</small></span>
        <span class="menu-car-best">${best ? formatTime(best.time) : ''}</span>`;
      b.addEventListener('click', () => this.selectCar(i));
      list.append(b);
    });

    const p = car.physics;
    const pk = peakPower(p.engine);
    const specs = div('menu-specs');
    specs.innerHTML = `
      <p>${car.description}</p>
      ${isTestCar(car.id) ? `<p class="menu-test-note">${TEST_NOTE}</p>` : ''}
      <dl>
        <dt>Drive</dt><dd>${driveLabel(p.drivetrain.frontSplit)}</dd>
        <dt>Power</dt><dd>${Math.round(pk.kw * 1.341)} hp</dd>
        <dt>Weight</dt><dd>${p.mass} kg</dd>
        <dt>Power / weight</dt><dd>${Math.round((pk.kw * 1341) / p.mass)} hp/t</dd>
      </dl>
      ${this.setupSummary()}
      <div class="menu-livery">Livery
        <button class="menu-btn small" data-a="livery-" title="← key">‹</button>
        <b>${this.livery + 1}</b>
        <button class="menu-btn small" data-a="livery+" title="→ key">›</button>
      </div>`;
    specs
      .querySelector('[data-a="livery-"]')!
      .addEventListener('click', () => this.setLivery(this.livery - 1));
    specs
      .querySelector('[data-a="livery+"]')!
      .addEventListener('click', () => this.setLivery(this.livery + 1));

    this.panel.append(
      list,
      specs,
      buttons(
        ['Back', () => this.show('map')],
        ['Setup car', () => this.show('setup')],
        ['Start stage ›', () => this.start(), true],
      ),
    );
  }

  /** The showroom car as it will run: its livery, the picked tyre compound and the suspension preset's ride height. */
  private showSetupCar(): void {
    const car = this.car;
    this.showroom.setTyre(this.tyre);
    this.showroom.setRide(car.physics.setups[this.setup].ride);
    this.showroom.setCar(car.id, this.livery, this.badge);
  }

  /** One line on the car screen: what the stage will run with (recommended unless the setup screen changed it). */
  private setupSummary(): string {
    const custom = this.custom;
    const size = tyreLabel(tyreSizeFor(this.car.physics, this.tyre));
    const gear = hasGearings(this.car.physics)
      ? ` · ${GEARING_NAMES[this.gearing]} gearing`
      : '';
    return `<div class="menu-setup-line ${custom ? 'custom' : ''}">${TYRES[this.tyre].name} tyres ${size} · ${SETUP_NAMES[this.setup]} suspension${gear} <em>${custom ? 'custom' : 'recommended'}</em></div>`;
  }

  /**
   * Optional setup screen: horizontal pickers - tyre compounds, suspension set-ups, gearing - as rows of three boxes;
   * tyres and springs are rendered live inside (the box is a transparent window onto the showroom canvas, see
   * Showroom.showSetup), gearing shows a speed-per-gear chart. Cars with fixed gearing show theirs as one box with "no
   * configuration available". Most players skip it: every row starts on the stage recommendation.
   */
  private setupSelect(): void {
    const map = this.map;
    const car = this.car;
    const p = applySetup(car.physics, this.setup);
    this.panel.append(header('Setup car', `${car.name} · ${map.name}`));
    // The car behind the pickers re-renders with the chosen tyre and suspension (ride height) on every pick.
    this.showSetupCar();
    // The road surfaces the stage uses, in driving order.
    const surfaces = [
      ...new Set([
        map.road.surface,
        ...(map.road.sections ?? []).map((s) => s.surface),
      ]),
    ];
    const reco = '<em class="menu-reco">recommended</em>';
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    const card = (
      key: string,
      selected: boolean,
      label: string,
      onPick: () => void,
    ): HTMLElement => {
      const b = document.createElement('button');
      b.className = 'setup-card';
      b.classList.toggle('selected', selected);
      b.innerHTML = `<div class="setup-view" data-view="${key}"></div><div class="setup-label">${label}</div>`;
      b.addEventListener('click', onPick);
      return b;
    };
    const section = (
      row: number,
      title: string,
      sub: string,
      extra?: HTMLElement,
    ): { el: HTMLElement; grid: HTMLElement } => {
      const el = div('setup-section');
      const head = rowTitle(title, sub);
      if (extra) head.append(extra);
      const grid = div('setup-row');
      el.classList.toggle('active', this.setupRow === row);
      el.append(head, grid);
      return { el, grid };
    };

    const tyres = section(0, 'Tyres', 'Tread, grip and rim size per compound');
    TYRE_IDS.forEach((id) => {
      const t = TYRES[id];
      const chips = surfaces
        .map((s) => {
          const r = carGripRating(p, id, s);
          return `<span class="r${r}">${SURFACES[s].name}<b>${GRIP_LABELS[r]}</b></span>`;
        })
        .join('');
      tyres.grid.append(
        card(
          `tyre:${id}`,
          id === this.tyre,
          `<div class="setup-name"><i class="menu-tyre-dot" style="background:${hex(t.color)}"></i><b>${t.name}</b>${id === this.recTyre ? reco : ''}</div>
           <small>${tyreLabel(tyreSizeFor(car.physics, id))} · ${t.blurb}</small>
           <div class="setup-chips">${chips}</div>`,
          () => this.setSetup({ tyre: id }, 0),
        ),
      );
    });

    const susp = section(
      1,
      'Suspension',
      'Springs, travel, ride height and damping',
      this.rangeBar(),
    );
    SETUP_IDS.forEach((id) => {
      const preset = car.physics.setups[id];
      const c = compliance(applySetup(car.physics, id));
      const rebound = Math.min(
        5,
        Math.max(1, Math.round(preset.front.rebound / 1600)),
      );
      // Ride height vs the car's standard one (+ = more ground clearance, higher centre of mass).
      const rideMm = Math.round(preset.ride * 1000);
      const ride =
        rideMm === 0
          ? 'standard'
          : `${rideMm > 0 ? '+' : '−'}${Math.abs(rideMm)} mm`;
      susp.grid.append(
        card(
          `susp:${id}`,
          id === this.setup,
          `<div class="setup-name"><i class="menu-tyre-dot spring" style="background:${hex(SETUP_COLORS[id])}"></i><b>${SETUP_NAMES[id]}</b>${id === this.recSetup ? reco : ''}</div>
           <small>${setupCharacter(c)}</small>
           <div class="setup-chips data">
             <span>Travel<b>${Math.round(preset.travel * 1000)} mm</b></span>
             <span>Ride height<b>${ride}</b></span>
             <span>Spring<b>${Math.round(preset.front.spring / 1000)} / ${Math.round(preset.rear.spring / 1000)} N/mm</b></span>
             <span>Rebound<b class="bars">${'●'.repeat(rebound)}<i>${'●'.repeat(5 - rebound)}</i></b></span>
           </div>`,
          () => this.setSetup({ setup: id }, 1),
        ),
      );
    });

    const gear = section(
      2,
      'Gearing',
      hasGearings(car.physics)
        ? 'Final drive: short pulls harder, long goes faster'
        : 'Final drive',
    );
    const fixed = !hasGearings(car.physics);
    // One speed scale for the row: the longest preset's top-gear redline speed.
    const scale = Math.max(
      ...GEARING_IDS.map((id) =>
        Math.max(...gearTopSpeeds(applyGearing(car.physics, id))),
      ),
    );
    const gearIds: GearingId[] = fixed ? ['medium'] : [...GEARING_IDS];
    gearIds.forEach((id) => {
      const d = applyGearing(car.physics, id);
      const med = car.physics.gearbox.finalDrive;
      const pull = Math.min(
        5,
        // Wheel torque vs medium, kept modest: the close-ratio boxes make the real 0-100 gap small.
        Math.max(1, Math.round(3 + (d.gearbox.finalDrive / med - 1) * 5)),
      );
      const name = fixed ? 'Standard' : GEARING_NAMES[id];
      const label = `<div class="setup-name"><b>${name}</b>${!fixed && id === this.recGearing ? reco : ''}</div>
           <small>${fixed ? 'No configuration available - road car gearbox' : id === 'short' ? 'Harder pull, lower top speed' : id === 'long' ? 'Higher top speed, softer pull' : 'Standard final drive'}</small>
           <div class="setup-chips data">
             <span>Top speed<b>${Math.round(topSpeed(d) * 3.6)} km/h</b></span>
             <span>Final drive<b>${d.gearbox.finalDrive.toFixed(2)}</b></span>
             <span>Pull<b class="bars">${'●'.repeat(pull)}<i>${'●'.repeat(5 - pull)}</i></b></span>
           </div>`;
      const b = document.createElement(fixed ? 'div' : 'button');
      b.className = 'setup-card gear-card';
      b.classList.toggle('selected', !fixed && id === this.gearing);
      b.classList.toggle('fixed', fixed);
      b.innerHTML = `<div class="setup-view gear-view">${gearChart(d, scale)}</div><div class="setup-label">${label}</div>`;
      if (!fixed)
        b.addEventListener('click', () => this.setSetup({ gearing: id }, 2));
      gear.grid.append(b);
    });

    const custom = this.custom;
    this.panel.append(
      tyres.el,
      susp.el,
      gear.el,
      buttons(
        [
          'Reset to recommended',
          () => {
            this.pick = null;
            this.show('setup');
          },
        ],
        ['Done', () => this.show('car'), !custom],
        ['Start stage ›', () => this.start(), custom],
      ),
    );
    // The boxes exist now: point the showroom's studios at them (they change on every re-render).
    this.showroom.showSetup(
      car.id,
      [...this.panel.querySelectorAll<HTMLElement>('[data-view]')].map(
        (el) => ({ key: el.dataset.view!, el }),
      ),
    );
  }

  /** "Adjustment range": where on soft ... stiff this car three presets can reach (rally car wide, road / race car narrow). */
  private rangeBar(): HTMLElement {
    const c = (id: SetupId) => compliance(applySetup(this.car.physics, id));
    const left = 100 * (1 - c('soft'));
    const right = 100 * (1 - c('stiff'));
    const el = div('menu-range');
    el.title =
      'How far this car can be set up between soft (gravel) and stiff (tarmac)';
    el.innerHTML = `<span>soft</span><div><i style="left:${left}%;width:${Math.max(4, right - left)}%"></i></div><span>stiff</span>`;
    return el;
  }

  private setSetup(
    patch: { tyre?: TyreId; setup?: SetupId; gearing?: GearingId },
    row: number,
  ): void {
    this.pick = {
      map: this.map.id,
      car: this.car.id,
      tyre: patch.tyre ?? this.tyre,
      setup: patch.setup ?? this.setup,
      gearing: patch.gearing ?? this.gearing,
    };
    this.setupRow = row;
    this.show('setup');
  }

  private selectCar(i: number): void {
    this.carIndex = (i + CARS.length) % CARS.length;
    this.show('car');
  }

  private setLivery(n: number): void {
    this.livery = Math.max(0, n);
    this.show('car');
  }

  private start(): void {
    const r = {
      map: this.map.id,
      car: this.car.id,
      livery: this.livery,
      tyre: this.tyre,
      setup: this.setup,
      gearing: this.gearing,
    };
    saveSettings({ map: r.map, car: r.car, livery: r.livery });
    this.done(r);
  }

  private key(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'Backspace') return this.nav('back');
    const dir = KEY_DIRS[e.code];
    if (dir) {
      // A focused slider keeps its own arrow-key handling.
      const slider =
        document.activeElement instanceof HTMLInputElement &&
        (dir === 'left' || dir === 'right');
      if (slider) return;
      e.preventDefault();
      return this.nav(dir);
    }
    const focusedButton =
      document.activeElement instanceof HTMLButtonElement ||
      document.activeElement instanceof HTMLAnchorElement;
    if (e.code === 'Enter' && !focusedButton)
      this.panel.querySelector<HTMLElement>('[data-primary]')?.click();
  }

  /** Menu navigation shared by the keyboard and the gamepad. */
  private nav(a: NavAction): void {
    const s = this.screen;
    if (a === 'back') {
      if (s === 'options' || s === 'about' || s === 'map') this.show('welcome');
      if (s === 'car') this.show('map');
      if (s === 'setup') this.show('car');
      return;
    }
    const up = a === 'up';
    if (s === 'map' && (up || a === 'down')) {
      this.mapIndex =
        (this.mapIndex + (up ? -1 : 1) + MAPS.length) % MAPS.length;
      this.show('map');
    } else if (s === 'car' && (up || a === 'down')) {
      this.selectCar(this.carIndex + (up ? -1 : 1));
    } else if (s === 'setup' && (up || a === 'down')) {
      // The gearing row is only selectable when the car can change it.
      const rows = hasGearings(this.car.physics) ? 3 : 2;
      this.setupRow = (this.setupRow + (up ? -1 : 1) + rows) % rows;
      this.show('setup');
      this.panel
        .querySelector('.setup-section.active')
        ?.scrollIntoView({ block: 'nearest' });
    } else if (s === 'setup' && (a === 'left' || a === 'right')) {
      const d = a === 'left' ? -1 : 1;
      if (this.setupRow === 0) {
        const n = TYRE_IDS.length;
        const k = (TYRE_IDS.indexOf(this.tyre) + d + n) % n;
        this.setSetup({ tyre: TYRE_IDS[k] }, 0);
      } else if (this.setupRow === 2) {
        const n = GEARING_IDS.length;
        const k = (GEARING_IDS.indexOf(this.gearing) + d + n) % n;
        this.setSetup({ gearing: GEARING_IDS[k] }, 2);
      } else {
        const n = SETUP_IDS.length;
        const k = (SETUP_IDS.indexOf(this.setup) + d + n) % n;
        this.setSetup({ setup: SETUP_IDS[k] }, 1);
      }
    } else if (s === 'car' && (a === 'left' || a === 'right')) {
      this.setLivery(this.livery + (a === 'left' ? -1 : 1));
    } else if (a === 'confirm' || a === 'start') {
      activateFocused(this.panel);
    } else {
      moveFocus(this.panel, a);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.pad.dispose();
    this.showroom.dispose();
    this.root.remove();
  }
}

/**
 * Options form, shared by the main menu and the pause menu. Every change is
 * saved immediately; `onChange` lets a running game apply it live. Graphics
 * changes call `onQuality` (the game needs a reload to rebuild the renderer).
 */
export function buildOptions(opts: {
  onBack: () => void;
  onChange?: (s: RallySettings) => void;
  onQuality?: (q: QualityName) => void;
}): HTMLElement {
  const el = div('menu-options');
  let s = loadSettings();
  const quality = loadQuality().name;
  const set = (patch: Partial<RallySettings>) => {
    s = saveSettings(patch);
    opts.onChange?.(s);
  };

  const row = (label: string, control: HTMLElement, note = '') => {
    const r = div('menu-opt');
    r.innerHTML = `<span>${label}${note ? `<small>${note}</small>` : ''}</span>`;
    r.append(control);
    el.append(r);
  };
  const choice = <T extends string | boolean>(
    values: [T, string][],
    current: T,
    onPick: (v: T) => void,
  ) => {
    const g = div('menu-seg');
    for (const [v, label] of values) {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', v === current);
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onPick(v);
      });
      g.append(b);
    }
    return g;
  };

  row(
    'Graphics',
    choice(
      (Object.keys(QUALITY) as QualityName[]).map((q) => [q, cap(q)]),
      quality,
      (q) => {
        saveQuality(q);
        opts.onQuality?.(q);
      },
    ),
    opts.onQuality ? 'reloads the stage' : '',
  );
  row(
    'Display',
    choice(
      DISPLAY_MODES.map((m): [typeof m, string] => [
        m,
        m === 'auto' ? 'Auto' : m.toUpperCase(),
      ]),
      loadDisplayMode(),
      (m) => saveDisplayMode(m),
    ),
    `HDR screens look washed out otherwise · auto = ${isHdrDisplay() ? 'HDR' : 'SDR'} here`,
  );
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '100';
  vol.value = String(Math.round(s.volume * 100));
  vol.addEventListener('input', () => set({ volume: Number(vol.value) / 100 }));
  row('Volume', vol, 'M mutes in game');
  row(
    'Gearbox',
    choice(
      [
        [true, 'Automatic'],
        [false, 'Manual'],
      ],
      s.automatic,
      (v) => set({ automatic: v }),
    ),
    'G in game · Q/E shift',
  );
  row(
    'Traction assist',
    choice(
      [
        [true, 'On'],
        [false, 'Off'],
      ],
      s.traction,
      (v) => set({ traction: v }),
    ),
    'T in game',
  );
  const num = div('menu-number');
  const numLabel = document.createElement('b');
  const step = (d: number) => {
    const n = clampCarNumber(s.carNumber + d);
    if (n !== s.carNumber) set({ carNumber: n });
    numLabel.textContent = String(n);
  };
  const numBtn = (label: string, d: number, title: string) => {
    const b = document.createElement('button');
    b.className = 'menu-btn small';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => step(d));
    return b;
  };
  numLabel.textContent = String(s.carNumber);
  num.append(
    numBtn('‹', -1, `down to ${MIN_CAR_NUMBER}`),
    numLabel,
    numBtn('›', 1, `up to ${MAX_CAR_NUMBER}`),
  );
  row('Car number', num, 'on the rally plates on both doors');
  row(
    'Camera',
    choice(
      CAMERA_MODES.map((m): [CameraMode, string] => [m, cameraLabel(m)]),
      s.camera,
      (v) => set({ camera: v }),
    ),
    'C in game',
  );
  el.append(buttons(['Back', opts.onBack, true]));
  return el;
}

/**
 * Sector chips of the run just driven (empty when it kept no splits). Each chip is green / red
 * against the same sector of the best other run in the selected scope (all cars / this car);
 * `setScope` re-colours them when the leaderboard toggle changes.
 */
export function buildSectors(
  board: RunRecord[],
  run: RunRecord,
): HTMLElement & { setScope: (carOnly: boolean) => void } {
  const el = div('menu-sectors') as unknown as HTMLElement & {
    setScope: (carOnly: boolean) => void;
  };
  const mine = sectorTimes(run);
  el.setScope = (carOnly) => {
    const ref = board.find(
      (r) => r !== run && (!carOnly || r.car === run.car) && r.splits?.length,
    );
    const refSec = ref ? sectorTimes(ref) : [];
    el.innerHTML = mine
      .map((t, i) => {
        const r = refSec[i];
        const cls =
          r === undefined ? '' : t <= r ? ' class="good"' : ' class="bad"';
        return `<div${cls}><span>S${i + 1}</span>${t.toFixed(2)}</div>`;
      })
      .join('');
  };
  el.setScope(false);
  return el;
}

/**
 * Stage results top 10, toggle "All cars" / "<this car>". `run` is highlighted;
 * if it's outside the top 10 its row is appended under a gap.
 */
export function buildLeaderboard(
  board: RunRecord[],
  run: RunRecord,
  onScope?: (carOnly: boolean) => void,
): HTMLElement {
  const el = div('menu-board');
  let carOnly = false;
  const render = () => {
    const rows = carOnly ? board.filter((r) => r.car === run.car) : board;
    const rank = rows.indexOf(run);
    const lead = rows[0]?.time ?? 0;
    // Set-up columns: what the run was driven with ("–" = not recorded: older runs, or fixed gearing on the road car).
    const dash = '<span class="na">–</span>';
    const tyreCol = (r: RunRecord) =>
      isTyreId(r.tyre) ? TYRES[r.tyre].name : dash;
    const suspCol = (r: RunRecord) =>
      r.susp && r.susp in SETUP_NAMES ? SETUP_NAMES[r.susp as SetupId] : dash;
    const gearCol = (r: RunRecord) =>
      isGearingId(r.gear) ? GEARING_NAMES[r.gear] : dash;
    const row = (r: RunRecord, i: number) => {
      const sec = sectorTimes(r);
      const cls = r === run ? ' class="me"' : '';
      return (
        `<tr${cls}><td rowspan="2">${i + 1}</td><td>${formatTime(r.time)}${r.penalty ? ` <span class="pen">(+${r.penalty}s)</span>` : ''}</td>` +
        `<td>${r === run ? '<b>YOU</b> ' : ''}${carName(r.car)}${r.date ? ` <small>#${r.livery + 1}</small>` : ''}</td>` +
        `<td class="set">${tyreCol(r)}</td><td class="set">${suspCol(r)}</td><td class="set">${gearCol(r)}</td>` +
        `<td>${i ? `+${(r.time - lead).toFixed(2)}` : ''}</td></tr>` +
        `<tr${cls ? ' class="me sec"' : ' class="sec"'}><td colspan="6">${
          sec.length
            ? sec.map((t, k) => `S${k + 1} ${t.toFixed(2)}`).join(' · ')
            : 'no sector times'
        }</td></tr>`
      );
    };
    el.innerHTML = `
      <div class="menu-seg">
        <button data-f="all" class="${carOnly ? '' : 'on'}">All cars</button>
        <button data-f="car" class="${carOnly ? 'on' : ''}">${carName(run.car)}</button>
      </div>
      <table><thead><tr><th>#</th><th>Time</th><th>Car</th><th>Tyres</th><th>Suspension</th><th>Gearing</th><th>Gap</th></tr></thead>${rows
        .slice(0, 10)
        .map(row)
        .join(
          '',
        )}${rank >= 10 ? `<tr class="gap"><td colspan="7">…</td></tr>${row(run, rank)}` : ''}</table>
      ${rank < 0 ? '<p class="menu-none">Practice run - not ranked.</p>' : ''}`;
  };
  el.addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).dataset.f;
    if (!f) return;
    carOnly = f === 'car';
    render();
    onScope?.(carOnly);
    // Keep keyboard / gamepad focus on the toggle that was pressed.
    if (document.activeElement === document.body)
      el.querySelector<HTMLElement>(`[data-f="${f}"]`)?.focus();
  });
  render();
  return el;
}

// --- helpers ---------------------------------------------------------------------------

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

/** Dev-server marker on a test-only car / map (release.ts) - published builds never list one. */
function testBadge(test: boolean): string {
  return test
    ? ` <span class="menu-test" title="${TEST_NOTE}">TEST</span>`
    : '';
}

function rowTitle(title: string, sub: string): HTMLElement {
  const h = div('menu-row-title');
  h.innerHTML = `<b>${title}</b><small>${sub}</small>`;
  return h;
}

function header(title: string, sub = ''): HTMLElement {
  const h = div('menu-header');
  h.innerHTML = `<h1>${title}</h1>${sub ? `<div>${sub}</div>` : ''}`;
  return h;
}

function buttons(
  ...items: [label: string, action: () => void, primary?: boolean][]
): HTMLElement {
  const row = div('menu-buttons');
  for (const [label, action, primary] of items) {
    const b = document.createElement('button');
    b.className = `menu-btn${primary ? ' primary' : ''}`;
    b.textContent = label;
    if (primary) b.dataset.primary = '';
    b.addEventListener('click', action);
    row.append(b);
  }
  return row;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function cameraLabel(m: CameraMode): string {
  return m === 'chase_far' ? 'Far' : cap(m);
}

function driveLabel(frontSplit: number): string {
  if (frontSplit === 0) return 'RWD';
  if (frontSplit === 1) return 'FWD';
  return `AWD ${Math.round(frontSplit * 100)}/${Math.round((1 - frontSplit) * 100)}`;
}

const last = (a: number[]) => a[a.length - 1];

function roadXZ(m: MapDef): { x: number; z: number }[] {
  return m.road.points.map((p) =>
    Array.isArray(p) ? { x: p[0], z: p[1] } : p,
  );
}

/** Road polyline lengths (control points; close enough to the spline for menus). */
function cumulative(m: MapDef): number[] {
  const pts = roadXZ(m);
  const out = [0];
  for (let i = 1; i < pts.length; i++)
    out.push(
      out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z),
    );
  return out;
}

function stageLength(m: MapDef): number {
  const total = last(cumulative(m));
  return Math.max(0, total - m.stage.start - m.stage.finishFromEnd);
}

/** Small route outline: whole road faint, stage start -> finish highlighted (north up). */
function routeSvg(m: MapDef): string {
  const pts = roadXZ(m);
  const acc = cumulative(m);
  const total = last(acc);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const size = Math.max(maxX - minX, maxZ - minZ) * 1.12 || 1;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const f = (x: number, z: number) =>
    `${(((x - cx) / size + 0.5) * 100).toFixed(1)},${(((z - cz) / size + 0.5) * 100).toFixed(1)}`;
  const at = (d: number) => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < d) i++;
    const t = (d - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    return f(
      pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
    );
  };
  const a = m.stage.start;
  const b = total - m.stage.finishFromEnd;
  const stage = [at(a)];
  pts.forEach((p, i) => {
    if (acc[i] > a && acc[i] < b) stage.push(f(p.x, p.z));
  });
  stage.push(at(b));
  const [sx, sy] = at(a).split(',');
  const [fx, fy] = at(b).split(',');
  return `<svg class="menu-route" viewBox="0 0 100 100" aria-hidden="true">
    <polyline points="${pts.map((p) => f(p.x, p.z)).join(' ')}" class="all"/>
    <polyline points="${stage.join(' ')}" class="stage"/>
    <circle cx="${sx}" cy="${sy}" r="3.2" class="start"/>
    <circle cx="${fx}" cy="${fy}" r="3.2" class="finish"/>
  </svg>`;
}

/**
 * Setup screen gearing chart: one bar per gear = the road speed at the redline in that gear, capped at the car's real
 * top speed (drag can stop it before the redline - the Zastava tops out at 160 km/h, not 5th gear's 199), shared scale
 * `scale` m/s across the row so short / medium / long compare at a glance; the top speed printed on the last bar.
 */
function gearChart(def: CarPhysicsDef, scale: number): string {
  const top = topSpeed(def);
  const speeds = gearTopSpeeds(def).map((v) => Math.min(v, top));
  const n = speeds.length;
  const w = 220;
  const h = 100;
  const pad = 14;
  const bw = (w - pad * 2) / n - 6;
  const bars = speeds
    .map((v, i) => {
      const bh = Math.max(2, (v / scale) * (h - 30));
      const x = pad + i * ((w - pad * 2) / n) + 3;
      const y = h - 12 - bh;
      const top = i === n - 1;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${top ? '#f0a020' : '#5a6a7c'}"/><text x="${(x + bw / 2).toFixed(1)}" y="${h - 1}" text-anchor="middle">${i + 1}</text>${top ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="top">${Math.round(v * 3.6)}</text>` : ''}`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Speed at the redline per gear">${bars}</svg>`;
}
