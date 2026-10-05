import { parseTyre, TYRE_IDS } from '../physics/tyres';
import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { CarModel } from '../cars/shared/car-model';
import { hasImportedModel } from '../cars/shared/car-gltf';
import { CARS, DEFAULT_CAR, getCar } from '../cars';
import { clampCarNumber, rallyName } from '../cars/shared/rally-badge';
import { MAPS } from '../maps';
import { isTestCar, listLabel, TEST_NOTE } from '../release';
import { parseVec3, ViewerShell } from '../debug/viewer-shell';
import { peakPower, sampleTorque } from '../physics/drivetrain';
import { tyreSizeFor } from '../physics/car-tyres';
import { WheelDebug } from '../debug/wheel-debug';
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
 * Wheels section (debug/wheel-debug.ts): `wheels=1` overlay (fixed hub crosshair + tyre / bead circles, spin pointer, fitted
 * arch circle + offsets), `wangle=<deg>` wheel angle while not spinning, `tyres=0` / `rims=0` / `brakes=0` / `body=0` hide
 * parts, `wcam=FL|FR|RL|RR` near-orthographic camera straight along that wheel's axle, e.g.
 *   car-viewer.html?car=bimmer_m3&wheels=1&wcam=FL&body=0&spin=1
 */
const DEFAULTS = {
  car: DEFAULT_CAR,
  seed: 0,
  paint: '',
  /** Fitted tyre compound: none | tarmac | mixed | gravel (tread, rim size, compound ring). */
  tyre: 'none',
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
  wire: false,
  turntable: false,
  view: 'three-quarter',
  cam: '',
  look: '',
  fov: 0,
  clean: false,
};
const state = readUrlState(DEFAULTS);
const sync = (push = false) => writeUrlState(state, DEFAULTS, push);

const shell = new ViewerShell({ title: 'Car viewer' });
const { scene, camera, controls } = shell;
let model: CarModel | undefined;

const VIEWS: Record<string, [number, number, number]> = {
  'three-quarter': [4.2, 1.8, 5.2],
  front: [0, 1.0, 6.5],
  rear: [0, 1.4, -6.5],
  side: [6.8, 0.9, 0],
  top: [0.01, 8, 0],
  low: [3.5, 0.35, 3.5],
};

const WHEEL_CAMS = ['off', 'FL', 'FR', 'RL', 'RR'];

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
  camera.fov = (2 * Math.atan(0.5 / 20) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

function setView(name: string): void {
  const p = parseVec3(state.cam) ?? VIEWS[name] ?? VIEWS['three-quarter'];
  camera.position.set(...p);
  controls.target.set(...(parseVec3(state.look) ?? [0, 0.6, 0]));
  camera.fov = state.fov > 0 ? state.fov : 45;
  camera.updateProjectionMatrix();
}

// --- panel ------------------------------------------------------------------------
const pick = shell.panel.section('Cars');
pick.list(
  CARS.map((c) => ({
    id: c.id,
    label: listLabel(c.name, isTestCar(c.id)),
    group: c.className,
    hint: isTestCar(c.id) ? `${TEST_NOTE}. ${c.description}` : c.description,
  })),
  state.car,
  (id) => {
    state.car = id;
    sync(true);
    rebuild();
  },
);

const vars = shell.panel.section('Model');
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
vars.button('Reset paint to livery', () => {
  state.paint = '';
  sync();
  rebuild();
});
const numCtl = vars.seed('Door plate number (0 = none)', state.num, (v) => {
  state.num = v <= 0 ? 0 : clampCarNumber(v);
  numCtl.set(state.num);
  sync();
  applyBadge();
});
vars.select('Tyre', state.tyre, ['none', ...TYRE_IDS], (v) => {
  state.tyre = v;
  sync();
  model?.setTyre(parseTyre(v, null));
  wheelDebug?.setTyre(tyreSize());
  updateWheelInfo();
});
vars.select(
  'Plate rally',
  state.rally,
  MAPS.map((m) => m.id),
  (v) => {
    state.rally = v;
    sync();
    applyBadge();
  },
);
vars.checkbox('Wireframe', state.wire, (v) => {
  state.wire = v;
  sync();
  applyWire();
});
vars.checkbox('Physics hull + COM', state.hull, (v) => {
  state.hull = v;
  sync();
  if (model) model.debug.visible = v;
});

const pose = shell.panel.section('Pose');
pose.slider('Steer', state.steer, { min: -1, max: 1, step: 0.01 }, (v) => {
  state.steer = v;
  sync();
});
pose.slider('Suspension', state.susp, { min: -1, max: 1, step: 0.01 }, (v) => {
  state.susp = v;
  sync();
});
pose.checkbox('Spin wheels', state.spin, (v) => {
  state.spin = v;
  sync();
});
pose.checkbox('Turntable', state.turntable, (v) => {
  state.turntable = v;
  sync();
});
pose.select('Camera', state.view, Object.keys(VIEWS), (v) => {
  state.view = v;
  ViewerShell.clearCameraLink(state);
  sync();
  setView(v);
});
shell.addCameraShare(pose, state, sync);

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
  'Wheel angle (deg, spin off)',
  state.wangle,
  { min: 0, max: 360, step: 1 },
  (v) => {
    state.wangle = v;
    sync();
  },
);
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
wheelsSec.select('Wheel camera (ortho)', state.wcam, WHEEL_CAMS, (v) => {
  state.wcam = v;
  ViewerShell.clearCameraLink(state);
  sync();
  if (v === 'off') setView(state.view);
  else setWheelCam(v);
});
const wheelInfo = wheelsSec.info();
if (state.clean) document.body.classList.add('dp-hidden');

const specs = shell.panel.section('Specs');
const specInfo = specs.info();
const chart = document.createElement('canvas');
chart.width = 260;
chart.height = 120;
chart.style.cssText = 'width:100%;background:#11151a;border-radius:4px';
specs.body.append(chart);
const testDrive = specs.html('');

shell.addSceneSection();
shell.panel
  .section('Help', false)
  .html(
    '<kbd>H</kbd> hide panel · <kbd>F3</kbd> stats · drag = orbit, wheel = zoom, right-drag = pan',
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

function tyreSize() {
  const def = getCar(state.car);
  const t = parseTyre(state.tyre, null);
  return t ? tyreSizeFor(def.physics, t) : def.physics.tyres.size;
}

function applyWheelDebug(): void {
  wheelDebug?.dispose();
  wheelDebug = undefined;
  if (!model || !state.wheels) {
    wheelInfo({});
    return;
  }
  wheelDebug = new WheelDebug(model, tyreSize(), updateWheelInfo);
  updateWheelInfo();
}

function updateWheelInfo(): void {
  if (!wheelDebug) return;
  const cm = (v: number) => `${(v * 100).toFixed(1)}`;
  const rows: Record<string, string> = {
    tyre: `R ${cm(getCar(state.car).physics.wheelRadius)} cm, bead ${cm(rimRadius(tyreSize()))} cm`,
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
  set(w.tyres, state.tyres);
  set(w.rims, state.rims);
  for (const b of w.brakes) set(b, state.brakes);
  set(model.body, state.body);
}

function rebuild(): void {
  model?.dispose();
  const def = getCar(state.car);
  model = new CarModel(def, {
    seed: state.seed,
    paint: state.paint || undefined,
    tyre: parseTyre(state.tyre, null),
  });
  // Put the car on the ground (model root is the centre of mass).
  model.root.position.y = def.physics.comHeight;
  model.debug.visible = state.hull;
  scene.add(model.root);
  if (!state.paint) paintCtl.set(model.livery.base);
  applyBadge();
  applyWire();
  applyWheelDebug();
  updateSpecs();
}

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
  specInfo({
    mass: `${p.mass} kg`,
    power: `${pk.kw.toFixed(0)} kW / ${(pk.kw * 1.341).toFixed(0)} hp @ ${pk.rpm}`,
    torque: `${peakT[1]} Nm @ ${peakT[0]}`,
    'power/weight': `${((pk.kw * 1000) / p.mass).toFixed(0)} W/kg`,
    drive:
      p.drivetrain.frontSplit === 0
        ? 'RWD'
        : p.drivetrain.frontSplit === 1
          ? 'FWD'
          : `AWD ${Math.round(p.drivetrain.frontSplit * 100)}/${Math.round((1 - p.drivetrain.frontSplit) * 100)}`,
    'weight F/R': `${Math.round((-p.rear.z / wb) * 100)} / ${Math.round((p.front.z / wb) * 100)} %`,
    wheelbase: `${wb.toFixed(2)} m`,
    gears: p.gearbox.ratios.join(' · '),
    final: String(p.gearbox.finalDrive),
    triangles: model ? model.triangleCount().toLocaleString() : '-',
    'livery #': String(state.seed),
    model: def.model.gltf
      ? hasImportedModel(def)
        ? 'imported glTF'
        : `procedural (drop ${def.model.gltf.file} in public/models/cars)`
      : 'procedural',
  });
  drawCurve(def.physics.engine);
  const credit =
    def.model.gltf && hasImportedModel(def)
      ? `<div style="margin-top:6px;font-size:10px">Model: ${def.model.gltf.credit}</div>`
      : '';
  testDrive.innerHTML = `<a href="./?car=${def.id}&livery=${state.seed}&spawn=pad" style="color:#f0a020">▶ Test drive on the pad</a> · <a href="./?car=${def.id}&livery=${state.seed}" style="color:#f0a020">stage</a>${credit}`;
}

function drawCurve(eng: Parameters<typeof sampleTorque>[0]): void {
  const ctx = chart.getContext('2d')!;
  const W = chart.width;
  const H = chart.height;
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
  plot((r) => sampleTorque(eng, r), maxT, '#f0a020');
  plot((r) => sampleTorque(eng, r) * r, maxP * 1.1, '#4fb0ff');
  ctx.fillStyle = 'rgba(255,60,40,0.25)';
  ctx.fillRect((eng.redlineRpm / maxRpm) * W, 0, W, H);
  ctx.fillStyle = '#aaa';
  ctx.font = '10px monospace';
  ctx.fillText('torque', 6, 12);
  ctx.fillStyle = '#4fb0ff';
  ctx.fillText('power', 52, 12);
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
  model.root.position.y = p.comHeight;
  model.syncWheels();
  wheelDebug?.update();
  applyParts();
  if (state.turntable) model.root.rotation.y += dt * 0.4;
});

setView(state.view);
if (state.wcam !== 'off' && !state.cam) setWheelCam(state.wcam);
rebuild();

// Console handle for debugging: __carViewer.model, __carViewer.shell
(window as unknown as Record<string, unknown>).__carViewer = {
  shell,
  get model() {
    return model;
  },
  get wheels() {
    return wheelDebug?.report();
  },
};
