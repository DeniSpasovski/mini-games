import { parseTyre, TYRE_IDS } from '../physics/tyres';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { paramOneOf } from '../../../shared/url-params';
import { track } from '../../../shared/analytics';
import { CarModel } from '../cars/shared/car-model';
import { hasImportedModel } from '../cars/shared/car-gltf';
import { CARS, DEFAULT_CAR, getCar } from '../cars';
import { clampCarNumber, rallyName } from '../cars/shared/rally-badge';
import { MAPS } from '../maps';
import { isTestCar, listLabel, TEST_NOTE } from '../release';
import {
  parseVec3,
  showViewerLoading,
  VIEWER_HOUR,
  ViewerShell,
} from '../debug/viewer-shell';
import { LIGHTS_MIN_NEED } from '../engine/night';
import {
  carLights,
  Headlights,
  headlightMount,
  TailLight,
  tailLightMount,
} from '../game/headlights';
import { offeredWeathers } from '../weather';
import { BACKDROPS, StageBackdrop } from '../debug/stage-backdrop';
import { DEFAULT_SEASON, SEASONS, SEASON_LABELS, type Season } from '../season';
import { Rain, RAIN_DROPS } from '../game/rain';
import { LampReflections } from '../game/lamp-reflections';
import { Color, Group } from 'three';
import { peakPower, sampleTorque } from '../physics/drivetrain';
import { axleRadius, tyreSizeFor } from '../physics/car-tyres';
import { WheelDebug } from '../debug/wheel-debug';
import { SoundDebug } from '../debug/sound-debug';
import { rimRadius } from '../cars/shared/tyre-mesh';

/**
 * Car viewer: inspect and iterate on car models.
 *   car-viewer.html?car=skoda_rally&seed=3&paint=%23ff0000&steer=0.5&susp=0.3&hull=1&wire=1&view=side&num=7&rally=petralica
 * `num` = door plate car number (0 = no plate), `rally` = map id whose name is on the plate.
 * Every variable in the left panel is mirrored into the URL.
 * Free camera (close-ups, screenshots): `cam=x,y,z` (model space, metres, +z = nose, +x = the car's left),
 * `look=x,y,z` (default 0,0.6,0), `fov` (degrees, default 45; a small fov from far away is near-orthographic)
 * and `clean=1` (hides the panel, like the H key), e.g.
 *   car-viewer.html?car=bimmer_m3&cam=-1.2,4,-1.6&look=-0.5,0.7,-1.8&fov=14&clean=1
 * `cam` overrides `view`; choosing a view in the panel clears the free camera.
 * "Copy camera link" (Pose section) writes the current orbit (position, target, fov) into these params and copies the URL.
 * `lamps=off|on|brake|reverse|reverse+brake`: off = every lamp dark, on (default) = the running lamps as the hour of day has them (night = lit), brake / reverse = pedal down / gear R. `fallback=1` shows the body a car
 * falls back to when its GLB can't load (hand-built `custom` or the boxy side-outline `profile`).
 * `tod=<hours>` = the game's time of day (default: the test map's afternoon): 17.5 evening (lights half on), 1 night (moon,
 * dark fog, running lamps + headlights + beam (`beam=0` hides the beam), bloom on High quality), e.g. `car-viewer.html?car=audi_rs6&tod=1&lamps=brake&view=rear`.
 * `weather=rain_heavy|fog|...` (dev / test builds): the weather's sky and light, the lights switched on as in the game (`carLights`).
 * Wheels section (debug/wheel-debug.ts): `wheels=1` overlay (fixed hub crosshair + tyre / bead circles, spin pointer, fitted
 * arch circle + offsets), `wangle=<deg>` wheel angle while not spinning, `tyres=0` / `rims=0` / `brakes=0` / `body=0` hide
 * parts, `wcam=FL|FR|RL|RR` near-orthographic camera straight along that wheel's axle, e.g.
 *   car-viewer.html?car=bimmer_m3&wheels=1&wcam=FL&body=0&spin=1
 */
const DEFAULTS = {
  car: DEFAULT_CAR,
  seed: 0,
  paint: '',
  /** Fitted tyre compound: tarmac | mixed | gravel (tread, rim size, compound ring). */
  tyre: 'mixed',
  num: 7,
  rally: MAPS[0].id,
  steer: 0,
  susp: 0,
  spin: false,
  /** Wheel debugger overlay (debug/wheel-debug.ts). */
  wheels: false,
  /** Wheel angle (deg) while not spinning. */
  wangle: 0,
  tyres: true,
  rims: true,
  brakes: true,
  body: true,
  /** off | FL | FR | RL | RR: camera along that wheel's axle (fov ~3 deg from 20 m = near-orthographic). */
  wcam: 'off',
  hull: false,
  /** Show the fallback body (`custom` / `profile`) instead of the GLB. */
  fallback: false,
  wire: false,
  turntable: false,
  /** off | on | brake | reverse | reverse+brake: lamps dark / running lamps / rear lamps lit (CarModel.setBrake). */
  lamps: 'on',
  /** Hour of day (`Environment`, `?tod=`): from 19:30 to 04:30 night, the car's lights come on as the sun goes down. */
  tod: VIEWER_HOUR,
  /** Weather (`Environment`, `?weather=`): rain / fog switch the lights on by day as in the game (`carLights`). */
  weather: 'dry',
  /** Where the car stands (`debug/stage-backdrop.ts`): studio grass, or a short road of a stage surface with trees. */
  backdrop: 'studio',
  /** Season of the backdrop's trees. */
  season: DEFAULT_SEASON as Season,
  /** Backdrop trees shown. */
  trees: true,
  /** Headlight beam (spot lights + the cones in the air) at night: off to see the car and its lamps without it. */
  beam: true,
  view: 'three-quarter',
  cam: '',
  look: '',
  fov: 0,
  clean: false,
};
const state = readUrlState(DEFAULTS);
state.car = getCar(state.car).id;
state.tyre = paramOneOf(state.tyre, TYRE_IDS, DEFAULTS.tyre);
state.rally = paramOneOf(
  state.rally,
  MAPS.map((m) => m.id),
  DEFAULTS.rally,
);
const LAMP_MODES = [
  { value: 'off', label: 'off' },
  { value: 'on', label: 'on' },
  { value: 'brake', label: 'brake' },
  { value: 'reverse', label: 'reverse' },
  { value: 'reverse+brake', label: 'reverse + brake' },
];
state.lamps = paramOneOf(
  state.lamps,
  LAMP_MODES.map((m) => m.value),
  DEFAULTS.lamps,
);
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);
const trackCar = () =>
  track('rally', 'select_content', {
    game_content_type: 'car_viewer',
    game_content_id: state.car,
  });
trackCar();

state.backdrop = paramOneOf(
  state.backdrop,
  BACKDROPS.map((b) => b.id),
  DEFAULTS.backdrop,
);
const spot = BACKDROPS.find((b) => b.id === state.backdrop)!;
const shell = new ViewerShell({ title: 'Car viewer' });
const { scene, camera, controls } = shell;
let model: CarModel | undefined;
/** The car's place: the world origin, or the middle of the backdrop's road (`shell.frame`). */
const carFrame = new Group();
carFrame.matrixAutoUpdate = false;
scene.add(carFrame);
/** A camera set in car space (views, wheel cams) moved to the car's place. */
const toFrame = () => {
  camera.position.applyMatrix4(shell.frame);
  controls.target.applyMatrix4(shell.frame);
};

const VIEWS: Record<string, [number, number, number]> = {
  'three-quarter': [4.2, 1.8, 5.2],
  front: [0, 1.0, 6.5],
  rear: [0, 1.4, -6.5],
  side: [6.8, 0.9, 0],
  top: [0.01, 8, 0],
  low: [3.5, 0.35, 3.5],
};

const WHEEL_CAMS = ['off', 'FL', 'FR', 'RL', 'RR'];
state.view = paramOneOf(state.view, Object.keys(VIEWS), DEFAULTS.view);
state.wcam = paramOneOf(state.wcam, WHEEL_CAMS, DEFAULTS.wcam);

/** Near-orthographic view straight along a wheel's axle (from 20 m outside, ~1 m tall frame). */
function setWheelCam(name: string): void {
  const i = WHEEL_CAMS.indexOf(name) - 1;
  if (i < 0) return;
  const p = getCar(state.car).physics;
  const axle = i < 2 ? p.front : p.rear;
  const s = i % 2 === 0 ? 1 : -1;
  const hub: [number, number, number] = [
    (s * axle.track) / 2,
    p.wheelRadius,
    axle.z,
  ];
  camera.position.set(s * 20, hub[1], hub[2]);
  controls.target.set(...hub);
  toFrame();
  camera.fov = (2 * Math.atan(0.5 / 20) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

function setView(name: string): void {
  const p = parseVec3(state.cam) ?? VIEWS[name] ?? VIEWS['three-quarter'];
  camera.position.set(...p);
  controls.target.set(...(parseVec3(state.look) ?? [0, 0.6, 0]));
  toFrame();
  camera.fov = state.fov > 0 ? state.fov : 45;
  camera.updateProjectionMatrix();
}

/** Drivetrain from the front torque split (the car menu's All / AWD / FWD / RWD filter). */
function driveLabel(frontSplit: number): 'RWD' | 'FWD' | 'AWD' {
  return frontSplit === 0 ? 'RWD' : frontSplit === 1 ? 'FWD' : 'AWD';
}

// --- panel ------------------------------------------------------------------------
const pick = shell.panel.section('Cars');
pick.list(
  CARS.map((c) => ({
    id: c.id,
    label: listLabel(c.name, isTestCar(c.id)),
    group: c.className,
    hint: isTestCar(c.id) ? `${TEST_NOTE}. ${c.description}` : c.description,
    tags: [driveLabel(c.physics.drivetrain.frontSplit)],
  })),
  state.car,
  (id) => {
    state.car = id;
    sync(true);
    trackCar();
    rebuild();
  },
  { chips: ['All', 'AWD', 'FWD', 'RWD'] },
);

const vars = shell.panel.section('Car');
const seedCtl = vars.seed('Livery seed', state.seed, (v) => {
  state.seed = Math.max(0, v);
  seedCtl.set(state.seed);
  sync();
  rebuild();
});
const paintCtl = vars.color(
  'Paint',
  state.paint || getCar(state.car).model.paint,
  (v) => {
    state.paint = v;
    sync();
    rebuild();
  },
);
const resetPaint = document.createElement('button');
resetPaint.type = 'button';
resetPaint.className = 'dp-btn';
resetPaint.textContent = 'Livery colour';
resetPaint.title = 'Back to the livery paint';
resetPaint.addEventListener('click', () => {
  state.paint = '';
  sync();
  rebuild();
});
paintCtl.el.append(resetPaint);
vars.select('Tyre', state.tyre, [...TYRE_IDS], (v) => {
  state.tyre = v;
  sync();
  model?.setTyre(parseTyre(v, null));
  wheelDebug?.setTyre(fittedTyre());
  updateWheelInfo();
});
const numCtl = vars.seed('Door plate #', state.num, (v) => {
  state.num = v <= 0 ? 0 : clampCarNumber(v);
  numCtl.set(state.num);
  sync();
  applyBadge();
});
vars.select(
  'Plate rally',
  state.rally,
  MAPS.map((m) => ({ value: m.id, label: m.name })),
  (v) => {
    state.rally = v;
    sync();
    applyBadge();
  },
);
vars.note('Door plate # 0 = no plate.');

const camSec = shell.panel.section('Camera');
const VIEW_LABELS: Record<string, string> = {
  'three-quarter': '3/4',
  front: 'Front',
  rear: 'Rear',
  side: 'Side',
  top: 'Top',
  low: 'Low',
};
const viewNames = Object.keys(VIEWS);
const viewButtons = [viewNames.slice(0, 3), viewNames.slice(3)].flatMap(
  (names) =>
    camSec.buttons(
      names.map((v) => [
        VIEW_LABELS[v],
        () => {
          state.view = v;
          state.wcam = 'off';
          wcamCtl.set('off');
          ViewerShell.clearCameraLink(state);
          sync();
          setView(v);
          markView();
        },
      ]),
    ),
);
/** The preset in use is the active button (none while a camera link or an axle camera holds the view). */
function markView(): void {
  const on = !state.cam && state.wcam === 'off';
  viewButtons.forEach((b, i) =>
    b.classList.toggle('active', on && viewNames[i] === state.view),
  );
}
shell.addCameraShare(camSec, state, sync);

const pose = shell.panel.section('Pose');
pose.slider('Steer', state.steer, { min: -1, max: 1, step: 0.01 }, (v) => {
  state.steer = v;
  sync();
});
pose.slider('Suspension', state.susp, { min: -1, max: 1, step: 0.01 }, (v) => {
  state.susp = v;
  sync();
});
pose.note('Suspension -1 = full droop, 0 = static, 1 = full bump.');
pose.checkbox('Spin wheels', state.spin, (v) => {
  state.spin = v;
  sync();
});
pose.checkbox('Turntable', state.turntable, (v) => {
  state.turntable = v;
  sync();
});

// Weather and backdrop are fixed per page, as in the game (the wet shading compiles into the shaders): a change reloads.
const weathers = offeredWeathers();
state.weather = paramOneOf(state.weather, weathers, DEFAULTS.weather);
const sceneSec = shell.panel.section(
  'Scene',
  state.weather !== DEFAULTS.weather ||
    state.backdrop !== DEFAULTS.backdrop ||
    state.tod !== VIEWER_HOUR,
);
const reload = () => {
  sync();
  location.reload();
};
shell.addWeatherAndTime(
  sceneSec,
  state,
  sync,
  { tod: VIEWER_HOUR, hour: VIEWER_HOUR },
  applyLights,
);
sceneSec.select(
  'Backdrop',
  state.backdrop,
  BACKDROPS.map((b) => ({ value: b.id, label: b.label })),
  (v) => {
    state.backdrop = v;
    reload();
  },
);
if (spot.surface) {
  state.season = paramOneOf(state.season, SEASONS, DEFAULT_SEASON);
  sceneSec.select(
    'Season',
    state.season,
    SEASONS.map((v) => ({ value: v, label: SEASON_LABELS[v] })),
    (v) => {
      state.season = v as Season;
      reload();
    },
  );
  sceneSec.checkbox('Trees', state.trees, (v) => {
    state.trees = v;
    sync();
    backdrop?.showTrees(v);
  });
}
const reloaders = [
  ...(weathers.length > 1 ? ['weather'] : []),
  'backdrop',
  ...(spot.surface ? ['season'] : []),
];
sceneSec.note(
  `Changing ${reloaders.slice(0, -1).join(', ')}${reloaders.length > 1 ? ' or ' : ''}${reloaders[reloaders.length - 1]} reloads the page.`,
);
shell.addSceneSection(false, sceneSec);

const lights = shell.panel.section(
  'Lights',
  state.lamps !== 'on' || !state.beam,
);
lights.checkbox('Headlight beam', state.beam, (v) => {
  state.beam = v;
  sync();
  applyLights();
});
lights.select('Lamps', state.lamps, LAMP_MODES, (v) => {
  state.lamps = v;
  applyLamps();
  sync();
});
lights.note(
  'Lamps: off = all dark; on = as the hour and weather have them; brake / reverse = pedal down / gear R.',
);

const wheelsSec = shell.panel.section(
  'Wheels',
  state.wheels || state.wcam !== 'off',
);
wheelsSec.checkbox('Overlay: hub, radii, arch fit', state.wheels, (v) => {
  state.wheels = v;
  sync();
  applyWheelDebug();
});
wheelsSec.slider(
  'Wheel angle',
  state.wangle,
  { min: 0, max: 360, step: 1 },
  (v) => {
    state.wangle = v;
    sync();
  },
);
wheelsSec.note('Wheel angle in degrees, used while Spin wheels is off.');
const partToggle = (
  label: string,
  key: 'tyres' | 'rims' | 'brakes' | 'body',
): void => {
  wheelsSec.checkbox(label, state[key], (v) => {
    state[key] = v;
    sync();
    applyParts(true);
  });
};
partToggle('Tyres', 'tyres');
partToggle('Rims', 'rims');
partToggle('Brakes', 'brakes');
partToggle('Body', 'body');
const wcamCtl = wheelsSec.select('Axle camera', state.wcam, WHEEL_CAMS, (v) => {
  state.wcam = v;
  ViewerShell.clearCameraLink(state);
  sync();
  if (v === 'off') setView(state.view);
  else setWheelCam(v);
  markView();
});
wheelsSec.note(
  'Axle camera: near-orthographic, straight along that wheel’s axle.',
);
const wheelInfo = wheelsSec.info();
if (state.clean) document.body.classList.add('dp-hidden', 'rv-clean');

const debugSec = shell.panel.section(
  'Debug',
  state.wire || state.hull || state.fallback,
);
debugSec.checkbox('Wireframe', state.wire, (v) => {
  state.wire = v;
  sync();
  applyWire();
});
debugSec.checkbox('Physics hull + centre of mass', state.hull, (v) => {
  state.hull = v;
  sync();
  if (model) model.debug.visible = v;
});
debugSec.checkbox('Fallback body (no GLB)', state.fallback, (v) => {
  state.fallback = v;
  sync();
  rebuild();
});

const specs = shell.panel.section('Specs');
const specInfo = specs.info();
const chart = document.createElement('canvas');
chart.className = 'rv-chart';
specs.body.append(chart);
specs.html(
  '<div class="rv-legend"><span class="rv-torque">torque</span><span class="rv-power">power</span><span class="rv-redline">redline</span></div>',
);
const testDrive = specs.html('');
let specRows: Record<string, string> = {};
// The GLB loads after `rebuild`: recount its triangles twice a second while Specs is open.
let specClock = 0;
shell.onFrame((dt) => {
  specClock += dt;
  if (specClock < 0.5 || !model || !(specs.el as HTMLDetailsElement).open)
    return;
  specClock = 0;
  specRows.triangles = model.triangleCount().toLocaleString();
  specInfo(specRows);
});

const soundDebug = new SoundDebug(
  shell.panel.section('Sound', false),
  getCar(state.car),
);
shell.onFrame((dt) => soundDebug.onFrame(dt));

shell.addHelp(
  [],
  [
    'Camera links (Copy camera link) keep the exact view; a preset or the axle camera clears them.',
  ],
);

// --- model ------------------------------------------------------------------------------
function applyBadge(): void {
  const map = MAPS.find((m) => m.id === state.rally) ?? MAPS[0];
  model?.setBadge(
    state.num > 0
      ? { number: state.num, rally: rallyName(map.name) }
      : undefined,
  );
}

let wheelDebug: WheelDebug | undefined;

const fittedTyre = () => parseTyre(state.tyre, 'mixed');

function applyWheelDebug(): void {
  wheelDebug?.dispose();
  wheelDebug = undefined;
  if (!model || !state.wheels) {
    wheelInfo({});
    return;
  }
  wheelDebug = new WheelDebug(model, fittedTyre(), updateWheelInfo);
  updateWheelInfo();
}

function updateWheelInfo(): void {
  if (!wheelDebug) return;
  const cm = (v: number) => `${(v * 100).toFixed(1)}`;
  const rows: Record<string, string> = {
    tyre: (['front', 'rear'] as const)
      .map((a) => {
        const p = getCar(state.car).physics;
        const r = axleRadius(p, fittedTyre(), a);
        return `${a} R ${cm(r)} cm, bead ${cm(rimRadius(tyreSizeFor(p, fittedTyre(), a)))} cm`;
      })
      .join(' · '),
  };
  for (const r of wheelDebug.report())
    rows[`arch ${r.wheel}`] = r.arch
      ? `dz ${cm(r.arch.dz)} dy ${cm(r.arch.dy)} r ${cm(r.arch.radius)} gap ${cm(r.arch.gap)} (rms ${cm(r.arch.rms)})`
      : 'no fit';
  wheelInfo(rows);
}

/** Part toggles: `force` also re-shows parts (a checkbox click); per frame only hides, so the load-time hide stays. */
function applyParts(force = false): void {
  if (!model) return;
  const w = model.wheelParts;
  const set = (o: { visible: boolean }, on: boolean) => {
    if (!on) o.visible = false;
    else if (force) o.visible = true;
  };
  for (const t of w.tyres) set(t, state.tyres);
  for (const r of w.rims) set(r, state.rims);
  for (const b of w.brakes) set(b, state.brakes);
  set(model.body, state.body);
}

function rebuild(): void {
  headlights?.dispose();
  headlights = undefined;
  tailLight?.dispose();
  tailLight = undefined;
  reflections?.dispose();
  reflections = undefined;
  model?.dispose();
  const def = getCar(state.car);
  soundDebug?.setCar(def);
  model = new CarModel(def, {
    seed: state.seed,
    paint: state.paint || undefined,
    tyre: parseTyre(state.tyre, 'mixed'),
    fallback: state.fallback,
  });
  // Put the car on the ground (model root is the centre of mass; taller tyres lift it).
  model.root.position.y = def.physics.comHeight + model.tyreLift;
  model.debug.visible = state.hull;
  carFrame.add(model.root);
  // Its GLB and wheels download after this: name the car over the view until they are in.
  hideLoading();
  const done = (hideLoading = showViewerLoading(
    `Loading ${def.name} …`,
    shell.panel.viewport,
  ));
  void model.ready.then(done);
  if (shell.env.weatherLook.wet > 0) model.setWet();
  // The beam starts at the model's own lamps once they are known.
  model.onHeadlamps((m) => headlights?.moveTo(m));
  if (!state.paint) paintCtl.set(model.livery.base);
  applyBadge();
  applyWire();
  applyLights();
  applyWheelDebug();
  updateSpecs();
}

/** Removes the "Loading <car>" plate of the model being built. */
let hideLoading = () => {};
let headlights: Headlights | undefined;
let tailLight: TailLight | undefined;
/** A wet road's mirror streaks under the lit lamps (as in the game). */
let reflections: LampReflections | undefined;

/** Lights for the hour of day (`Environment.lightNeed`, as in the game): headlamps, the beam and the tail lamps' red spill (their glow follows `applyLamps`). Before the first compile where possible. */
function applyLights(): void {
  headlights?.dispose();
  headlights = undefined;
  tailLight?.dispose();
  tailLight = undefined;
  reflections?.dispose();
  reflections = undefined;
  const need = shell.env.lightNeed;
  const wet = shell.env.weatherLook.wet;
  if (model && need >= LIGHTS_MIN_NEED) {
    const lit = carLights(need, shell.env.weatherLook);
    if (wet > 0) {
      const m = model;
      m.onHeadlamps((head) => {
        if (m !== model) return;
        reflections?.dispose();
        reflections = new LampReflections(
          m.root,
          head,
          tailLightMount(m.def.physics),
          -m.root.position.y,
          wet,
          lit.day,
        );
        applyLamps();
      });
    }
    tailLight = new TailLight(
      model.root,
      tailLightMount(model.def.physics),
      need,
      lit.perLamp ? headlightMount(model.def.physics).x : 0,
    );
    if (state.beam)
      headlights = new Headlights(
        model.root,
        model.headlampMount ?? headlightMount(model.def.physics),
        shell.quality.name,
        model.def.headlights,
        need,
        lit,
      );
  }
  applyLamps();
}

/** `lamps=off`: every lamp dark; otherwise the lamps follow the hour of day and the weather (night, rain / fog = running lamps lit) plus the brake / reverse pedal. */
function applyLamps(): void {
  const need = shell.env.lightNeed;
  const on = need >= LIGHTS_MIN_NEED && state.lamps !== 'off';
  const lit = carLights(need, shell.env.weatherLook);
  // The red spill tints the road at night; by day (rain / fog) the lamps show only in the wet road's streaks.
  const level = on && !lit.day ? need : 0;
  const brake =
    state.lamps === 'brake' || state.lamps === 'reverse+brake' ? 1 : 0;
  model?.setLamps(on ? lit.lamps : 0, on && lit.day);
  model?.setBrake(brake, state.lamps.startsWith('reverse'));
  tailLight?.setLevel(level);
  tailLight?.setBrake(brake);
  const lamps = on ? lit.lamps : 0;
  reflections?.setLevels(lamps, lamps, brake);
}
shell.onFrame(() => reflections?.update(camera.position));

function applyWire(): void {
  model?.root.traverse((o) => {
    const m = (
      o as { material?: { wireframe?: boolean } | { wireframe?: boolean }[] }
    ).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : [])
      if ('wireframe' in mat) mat.wireframe = state.wire;
  });
}

function updateSpecs(): void {
  const def = getCar(state.car);
  const p = def.physics;
  const pk = peakPower(p.engine);
  const peakT = p.engine.torqueCurve.reduce((a, b) => (b[1] > a[1] ? b : a));
  const wb = p.front.z - p.rear.z;
  specRows = {
    mass: `${p.mass} kg`,
    power: `${pk.kw.toFixed(0)} kW / ${(pk.kw * 1.341).toFixed(0)} hp @ ${pk.rpm}`,
    torque: `${peakT[1]} Nm @ ${peakT[0]}`,
    'power/weight': `${((pk.kw * 1000) / p.mass).toFixed(0)} W/kg`,
    drive:
      driveLabel(p.drivetrain.frontSplit) === 'AWD'
        ? `AWD ${Math.round(p.drivetrain.frontSplit * 100)}/${Math.round((1 - p.drivetrain.frontSplit) * 100)}`
        : driveLabel(p.drivetrain.frontSplit),
    'weight F/R': `${Math.round((-p.rear.z / wb) * 100)} / ${Math.round((p.front.z / wb) * 100)} %`,
    wheelbase: `${wb.toFixed(2)} m`,
    gears: p.gearbox.ratios.join(' · '),
    final: String(p.gearbox.finalDrive),
    triangles: model ? model.triangleCount().toLocaleString() : '-',
    'livery #': String(state.seed),
    model:
      def.model.gltf && hasImportedModel(def) && !state.fallback
        ? 'imported glTF'
        : `${def.model.custom ? 'hand-built' : 'side-outline fallback'}${def.model.gltf && !hasImportedModel(def) ? ` (drop ${def.model.gltf.file} in public/models/cars)` : ''}`,
  };
  specInfo(specRows);
  drawCurve(def.physics.engine);
  const credit =
    def.model.gltf && hasImportedModel(def) && !state.fallback
      ? `<small>Model: ${def.model.gltf.credit}</small>`
      : '';
  testDrive.innerHTML = `<a href="./?car=${def.id}&livery=${state.seed}&spawn=pad">▶ Test drive on the pad</a> · <a href="./?car=${def.id}&livery=${state.seed}">on a stage</a>${credit}`;
}

/** Torque (amber) and power (link blue) over rpm, the redline band in red: token colours, sharp at the screen's DPR. */
function drawCurve(eng: Parameters<typeof sampleTorque>[0]): void {
  const css = getComputedStyle(document.body);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = chart.clientWidth || 272;
  const H = 120;
  chart.width = Math.round(W * dpr);
  chart.height = Math.round(H * dpr);
  const ctx = chart.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const maxRpm = eng.redlineRpm + 500;
  const maxT = Math.max(...eng.torqueCurve.map((c) => c[1])) * 1.15;
  let maxP = 0;
  for (let r = eng.idleRpm; r <= eng.redlineRpm; r += 100)
    maxP = Math.max(maxP, sampleTorque(eng, r) * r);
  const plot = (f: (rpm: number) => number, max: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let r = eng.idleRpm; r <= eng.redlineRpm; r += 50) {
      const x = (r / maxRpm) * W;
      const y = H - (f(r) / max) * (H - 10);
      if (r === eng.idleRpm) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  plot((r) => sampleTorque(eng, r), maxT, token('--ui-accent'));
  plot((r) => sampleTorque(eng, r) * r, maxP * 1.1, token('--ui-link'));
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = token('--ui-slower');
  ctx.fillRect((eng.redlineRpm / maxRpm) * W, 0, W, H);
  ctx.globalAlpha = 1;
}

// --- animation ---------------------------------------------------------------------------
let spin = 0;
shell.onFrame((dt) => {
  if (!model) return;
  const p = model.def.physics;
  if (state.spin) spin += dt * 8;
  else spin = (state.wangle * Math.PI) / 180;
  for (let i = 0; i < 4; i++) {
    const axle = i < 2 ? p.front : p.rear;
    const travel = axle.travel;
    const staticComp =
      (p.mass * 9.81 * Math.abs(i < 2 ? p.rear.z : p.front.z)) /
      (p.front.z - p.rear.z) /
      2 /
      axle.spring;
    // susp: -1 = full droop, 0 = static, +1 = full bump.
    const comp =
      state.susp >= 0
        ? staticComp + (travel - staticComp) * state.susp
        : staticComp * (1 + state.susp);
    model.wheelPos[i].y = p.wheelRadius - p.comHeight + (comp - staticComp);
    model.wheelSteer[i] =
      -state.steer * axle.steer * ((p.maxSteerDeg * Math.PI) / 180);
    model.wheelSpin[i] = spin;
  }
  // Body moves opposite to the wheels when compressing.
  model.root.position.y = p.comHeight + model.tyreLift;
  model.syncWheels();
  wheelDebug?.update();
  applyParts();
  if (state.turntable) model.root.rotation.y += dt * 0.4;
});

if (state.tod !== VIEWER_HOUR) shell.setHour(state.tod);
setView(state.view);
if (state.wcam !== 'off' && !state.cam) setWheelCam(state.wcam);
markView();
rebuild();

// Falling rain round the camera (weather.ts rain rate, game/rain.ts as in the game).
const rainRate = shell.env.weatherLook.rain;
if (rainRate > 0) {
  const rain = new Rain(RAIN_DROPS[shell.quality.name], rainRate, new Color());
  scene.add(rain.mesh);
  shell.onFrame((dt) => {
    if (scene.fog)
      rain.setLight(
        scene.fog.color.clone().multiplyScalar(shell.env.night ? 0.5 : 1.15),
      );
    rain.update(camera.position, dt);
  });
}

// A road backdrop: the car in the middle of it, facing along it.
let backdrop: StageBackdrop | undefined;
if (spot.surface)
  void StageBackdrop.build(
    spot.id,
    state.season,
    shell.envDef,
    scene,
    shell.renderer,
    shell.quality,
  ).then((b) => {
    backdrop = b;
    b.showTrees(state.trees);
    shell.frame.copy(b.frame);
    carFrame.matrix.copy(b.frame);
    carFrame.matrixWorldNeedsUpdate = true;
    setView(state.view);
    if (state.wcam !== 'off' && !state.cam) setWheelCam(state.wcam);
    shell.onFrame(() => b.update(camera));
  });

// Console handle for debugging: __carViewer.model, __carViewer.shell
(window as unknown as Record<string, unknown>).__carViewer = {
  shell,
  get backdrop() {
    return backdrop;
  },
  get model() {
    return model;
  },
  get wheels() {
    return wheelDebug?.report();
  },
  /** `lamps=` without a reload (batch shots): off | on | brake | reverse | reverse+brake. */
  setLamps(mode: string) {
    state.lamps = LAMP_MODES.some((m) => m.value === mode) ? mode : 'on';
    applyLamps();
  },
};
