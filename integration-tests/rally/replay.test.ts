import { expect, test } from '@rstest/core';
import { Autopilot } from '../../src/games/rally/game/autopilot';
import { getCar } from '../../src/games/rally/cars';
import {
  decodeBody,
  encodeBody,
  encodeReplay,
  gzip,
  readHeader,
  REPLAY_BUDGET,
  type ReplayRows,
} from '../../src/games/rally/game/replay/codec';
import {
  ROW,
  type ReplayHeader,
} from '../../src/games/rally/game/replay/format';
import { ReplayRecorder } from '../../src/games/rally/game/replay/recorder';
import { ALL_STAGES } from '../../src/games/rally/maps';
import { ajvatovciMap } from '../../src/games/rally/maps/ajvatovci/map';
import { galichicaMap } from '../../src/games/rally/maps/galichica/map';
import { petralicaMap } from '../../src/games/rally/maps/petralica/map';
import { testMap } from '../../src/games/rally/maps/test/map';
import { vodnoMap } from '../../src/games/rally/maps/vodno/map';
import { stageClimate } from '../../src/games/rally/maps/shared/day-temperature';
import type { MapDef } from '../../src/games/rally/maps/shared/types';
import {
  applySetup,
  SETUP_FOR_TYRE,
} from '../../src/games/rally/physics/car-setup';
import { PHYSICS_HZ, Vehicle } from '../../src/games/rally/physics/vehicle';
import { World } from '../../src/games/rally/world/world';

/**
 * Replay size and determinism on real stages (game/replay/, sources/rally/REPLAY.md): the autopilot drives whole
 * stages with the recorder on, as in game; prints bytes per second and per run for raw float32 / quantised /
 * quantised + gzip at 60 and 30 Hz, and checks a whole run stays under the 100 KB budget. Then drives the test stage
 * twice from the same recorded inputs to see whether input-only replays (re-simulation) would hold.
 */
const CAR = 'skoda_rally';
/** 60 Hz quantised + gzip stays under this (bytes per second; gravel at full attack is the worst, ~260). */
const RATE_BUDGET = 300;

function drive(
  map: MapDef,
  stageId: string,
  strides: number[],
  climate = true,
): {
  seconds: number;
  length: number;
  recs: { stride: number; rec: ReplayRows }[];
  inputs: Float64Array;
  steps: number;
  finished: boolean;
} {
  const stage = map.stages.find((s) => s.id === stageId)!;
  const info = ALL_STAGES.find((s) => s.id === stageId)!;
  const world = new World(map, stage);
  const car = getCar(CAR);
  const tyre = stage.tyre;
  const v = new Vehicle(
    climate ? applySetup(car.physics, SETUP_FOR_TYRE[tyre]) : car.physics,
    world,
  );
  if (climate) {
    v.setTyre(tyre);
    v.setClimate(stageClimate(info));
  }
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  const ap = new Autopilot(world.stageRoad);
  ap.reset(world.stage.start - 9);
  const recorders = strides.map((s) => new ReplayRecorder(PHYSICS_HZ, s));
  for (const r of recorders) r.start();
  const clock = {
    phase: 'running' as const,
    time: 0,
    progress: 0,
    cutWarning: false,
    wrongWay: false,
  };
  const limit = Math.max(240, (world.stage.finish - world.stage.start) / 10);
  const inputs = new Float64Array(Math.ceil(limit * PHYSICS_HZ) * 4 + 4);
  let steps = 0;
  while (clock.time < limit && ap.along < world.stage.finish) {
    ap.drive(v, v.controls);
    const o = steps * 4;
    inputs[o] = v.controls.throttle;
    inputs[o + 1] = v.controls.brake;
    inputs[o + 2] = v.controls.steer;
    inputs[o + 3] = v.controls.handbrake;
    v.step(1 / PHYSICS_HZ);
    clock.time += 1 / PHYSICS_HZ;
    clock.progress = ap.along;
    for (const r of recorders) r.step(v, clock);
    steps++;
  }
  return {
    seconds: clock.time,
    length: world.stage.finish - world.stage.start,
    recs: recorders.map((r, i) => ({ stride: strides[i], rec: r.snapshot() })),
    inputs,
    steps,
    finished: ap.along >= world.stage.finish,
  };
}

const HEADER: ReplayHeader = {
  format: 1,
  game: 'test',
  stage: '',
  map: '',
  car: CAR,
  livery: 0,
  tyre: 'gravel',
  setup: 'soft',
  gearing: 'medium',
  season: 'summer',
  stageVer: 1,
  carVer: 1,
  date: 0,
  splits: [],
  stride: 4,
  hz: PHYSICS_HZ,
  frames: 0,
};

const kb = (b: number) => (b / 1024).toFixed(1);

test.each([
  ['test', testMap, true],
  ['ajvatovci', ajvatovciMap, true],
  ['vodno', vodnoMap, true],
  ['petralica', petralicaMap, true],
  ['prespa_ohrid', galichicaMap, false],
] as const)(
  'replay size on %s',
  async (stageId, map, climate) => {
    const run = drive(map, stageId, [4, 8], climate);
    const lines: string[] = [];
    const rates: [number, number, number][] = [];
    for (const { stride, rec } of run.recs) {
      const f32 = new Float32Array(rec.rows).buffer;
      const raw = f32.byteLength;
      const rawGz = (await gzip(new Uint8Array(f32))).length;
      const body = encodeBody({ frames: rec.frames, rows: rec.rows.slice() });
      const quantGz = (await gzip(body)).length;
      const fileBytes = await encodeReplay(
        { ...HEADER, stage: stageId, map: map.id, stride },
        { frames: rec.frames, rows: rec.rows.slice() },
      );
      const file = fileBytes.length;
      const s = run.seconds;
      lines.push(
        `${stageId} ${(run.length / 1000).toFixed(1)} km ${s.toFixed(0)} s @${PHYSICS_HZ / stride} Hz (${rec.frames} frames, ${ROW} ch): ` +
          `raw f32 ${kb(raw)} KB (${(raw / s).toFixed(0)} B/s), f32+gz ${kb(rawGz)} KB, ` +
          `quant ${kb(body.length)} KB (${(body.length / s).toFixed(0)} B/s), quant+gz ${kb(quantGz)} KB (${(quantGz / s).toFixed(0)} B/s), file ${kb(file)} KB`,
      );
      // Round trip within the quantisation steps.
      const back = decodeBody(body, rec.frames);
      let maxPos = 0;
      for (let f = 0; f < rec.frames; f++)
        for (let k = 0; k < 3; k++)
          maxPos = Math.max(
            maxPos,
            Math.abs(back[f * ROW + k] - rec.rows[f * ROW + k]),
          );
      expect(maxPos).toBeLessThanOrEqual(0.0005 + 1e-9);
      if (stride === 4) {
        const h = readHeader(fileBytes);
        lines.push(
          `${stageId}: stored ${kb(file)} KB at ${PHYSICS_HZ / h.stride} Hz${run.finished ? '' : ' (autopilot did not finish)'}`,
        );
        rates.push([quantGz / s, file, s]);
      }
    }
    console.info(lines.join('\n'));
    const [rate, size, secs] = rates[0];
    expect(rate).toBeLessThan(RATE_BUDGET);
    // Up to ~7 minutes (the longest released stage) fits the budget at 60 Hz; longer runs are thinned to 30 Hz.
    if (secs < 420) expect(size).toBeLessThan(REPLAY_BUDGET);
    else expect(size).toBeLessThan((REPLAY_BUDGET * secs) / 420);
  },
  900000,
);

test('re-simulating recorded inputs on the test stage', () => {
  const stage = testMap.stages[0];
  const first = drive(testMap, stage.id, [4]);
  // Same inputs, a fresh world and car: does the trajectory come out bit for bit the same?
  const world = new World(testMap, stage);
  const car = getCar(CAR);
  const info = ALL_STAGES.find((s) => s.id === stage.id)!;
  const v = new Vehicle(
    applySetup(car.physics, SETUP_FOR_TYRE[stage.tyre]),
    world,
  );
  v.setTyre(stage.tyre);
  v.setClimate(stageClimate(info));
  const spawn = world.roadSpawn();
  v.reset(spawn.position, spawn.heading);
  const rec = new ReplayRecorder(PHYSICS_HZ, 4);
  rec.start();
  const clock = {
    phase: 'running' as const,
    time: 0,
    progress: 0,
    cutWarning: false,
    wrongWay: false,
  };
  for (let s = 0; s < first.steps; s++) {
    const o = s * 4;
    v.controls.throttle = first.inputs[o];
    v.controls.brake = first.inputs[o + 1];
    v.controls.steer = first.inputs[o + 2];
    v.controls.handbrake = first.inputs[o + 3];
    v.step(1 / PHYSICS_HZ);
    rec.step(v, clock);
  }
  const a = first.recs[0].rec;
  const b = rec.snapshot();
  let maxDiff = 0;
  let firstDiff = -1;
  for (let f = 0; f < a.frames; f++)
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a.rows[f * ROW + k] - b.rows[f * ROW + k]);
      if (d > 0 && firstDiff < 0) firstDiff = f;
      maxDiff = Math.max(maxDiff, d);
    }
  // Same inputs, rounded to float32 (what a compact input recording would keep): how far off does it end?
  const world2 = new World(testMap, stage);
  const v2 = new Vehicle(
    applySetup(car.physics, SETUP_FOR_TYRE[stage.tyre]),
    world2,
  );
  v2.setTyre(stage.tyre);
  v2.setClimate(stageClimate(info));
  v2.reset(spawn.position, spawn.heading);
  const rec2 = new ReplayRecorder(PHYSICS_HZ, 4);
  rec2.start();
  for (let s = 0; s < first.steps; s++) {
    const o = s * 4;
    v2.controls.throttle = Math.fround(first.inputs[o]);
    v2.controls.brake = Math.fround(first.inputs[o + 1]);
    v2.controls.steer = Math.round(first.inputs[o + 2] * 127) / 127;
    v2.controls.handbrake = Math.fround(first.inputs[o + 3]);
    v2.step(1 / PHYSICS_HZ);
    rec2.step(v2, clock);
  }
  const c = rec2.snapshot();
  const end = (a.frames - 1) * ROW;
  const drift = Math.hypot(
    c.rows[end] - a.rows[end],
    c.rows[end + 2] - a.rows[end + 2],
  );
  console.info(
    `re-sim with exact inputs: max position diff ${maxDiff} m (first diff at frame ${firstDiff}); ` +
      `with steer rounded to 1/127: ${drift.toFixed(3)} m off at the end of ${first.seconds.toFixed(0)} s`,
  );
  expect(maxDiff).toBe(0);
}, 600000);
