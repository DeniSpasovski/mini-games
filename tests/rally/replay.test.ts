import { describe, expect, test } from '@rstest/core';
import {
  CAR_QUANT,
  REPLAY_BUDGET,
  WHEEL_QUANT,
  decodeReplay,
  encodeReplay,
  readHeader,
  replayFromText,
  replayToText,
  thinFrames,
} from '../../src/games/rally/game/replay/codec';
import {
  CAR_CHANNELS,
  F_RUNNING,
  F_TELEPORT,
  REPLAY_FORMAT,
  ROW,
  WHEEL_CHANNELS,
  carCol,
  wheelCol,
  type ReplayHeader,
} from '../../src/games/rally/game/replay/format';
import {
  autoDeleteIds,
  bestIds,
  bytesOf,
  cleanName,
  NAME_MAX,
  REPLAY_SOFT_LIMIT,
  replayTotals,
  type ReplayMeta,
} from '../../src/games/rally/game/replay/store';
import {
  cameraFor,
  findCorners,
  planTvCameras,
} from '../../src/games/rally/game/replay/tv-cameras';
import { Road, type RoadDef } from '../../src/games/rally/world/road';
import { Rng } from '../../src/shared/rng';

const HZ = 60;

const header = (frames: number): ReplayHeader => ({
  format: REPLAY_FORMAT,
  game: '0.0.0',
  stage: 'test',
  map: 'test',
  car: 'skoda_rally',
  livery: 0,
  tyre: 'gravel',
  setup: 'gravel',
  gearing: 'normal',
  season: 'summer',
  stageVer: 1,
  carVer: 1,
  date: 1,
  time: frames / HZ,
  splits: [10, 20],
  stride: 4,
  hz: 240,
  frames,
});

/** A car-like run: a winding path at ~25 m/s with yaw, pitch wobble, wheel spin, revs, a noisy steer. */
function synthetic(
  seconds: number,
  seed = 1,
): { frames: number; rows: Float64Array } {
  const rng = new Rng(seed);
  const rand = () => rng.next();
  const frames = Math.round(seconds * HZ);
  const rows = new Float64Array(frames * ROW);
  let x = 1234.5;
  let z = -3456.7;
  let yaw = 0;
  let steer = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / HZ;
    const r = f * ROW;
    steer += (rand() - 0.5) * 0.05;
    steer = Math.max(-1, Math.min(1, steer * 0.99 + Math.sin(t * 0.4) * 0.01));
    yaw += steer * 0.02;
    x += (Math.sin(yaw) * 25) / HZ;
    z += (Math.cos(yaw) * 25) / HZ;
    rows[r] = x;
    rows[r + 1] = 300 + Math.sin(t * 0.1) * 40 + Math.sin(t * 7) * 0.02;
    rows[r + 2] = z;
    const pitch = Math.sin(t * 3) * 0.02;
    // yaw then pitch, as a quaternion
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    rows[r + 3] = cy * sp;
    rows[r + 4] = sy * cp;
    rows[r + 5] = -sy * sp;
    rows[r + 6] = cy * cp;
    for (let w = 0; w < 4; w++) {
      rows[r + wheelCol(w, 0)] = 80 + Math.sin(t + w) * 5 + (rand() - 0.5) * 2;
      rows[r + wheelCol(w, 1)] = 40 + t * 0.2;
      rows[r + wheelCol(w, 2)] = 120 + Math.sin(t * 0.3) * 60;
    }
    rows[r + carCol('rpm')] = 5000 + Math.sin(t * 2) * 1500;
    rows[r + carCol('gear')] = 3 + Math.round(Math.sin(t * 0.2));
    rows[r + carCol('effThrottle')] = 0.5 + Math.sin(t) * 0.5;
    rows[r + carCol('throttle')] = rows[r + carCol('effThrottle')];
    rows[r + carCol('brake')] = Math.max(0, -Math.sin(t));
    rows[r + carCol('steer')] = steer;
    rows[r + carCol('handbrake')] = 0;
    rows[r + carCol('impact')] = f === 600 ? 4200 : 0;
    rows[r + carCol('flags')] = F_RUNNING | (f === 900 ? F_TELEPORT : 0);
    rows[r + carCol('stageTime')] = t;
    rows[r + carCol('progress')] = t * 25;
  }
  return { frames, rows };
}

describe('replay codec', () => {
  test('round trip: every channel within half a quantisation step', async () => {
    const rec = synthetic(30);
    const file = await encodeReplay(header(rec.frames), rec);
    const { header: h, rows } = await decodeReplay(file);
    expect(h.frames).toBe(rec.frames);
    expect(h.stage).toBe('test');
    let posErr = 0;
    let quatErr = 0;
    for (let f = 0; f < rec.frames; f++) {
      const r = f * ROW;
      for (let k = 0; k < 3; k++)
        posErr = Math.max(posErr, Math.abs(rows[r + k] - rec.rows[r + k]));
      // Rotation angle between the two (q and -q are one rotation; playback normalises).
      let dot = 0;
      let len = 0;
      for (let k = 3; k < 7; k++) {
        dot += rows[r + k] * rec.rows[r + k];
        len += rows[r + k] ** 2;
      }
      quatErr = Math.max(
        quatErr,
        2 * Math.acos(Math.min(1, Math.abs(dot) / Math.sqrt(len))),
      );
    }
    expect(posErr).toBeLessThanOrEqual(0.0005 + 1e-9);
    expect(quatErr).toBeLessThan(0.0005); // rad (0.03°)
    // Full-rate channels: exact to half a step on every frame.
    for (const c of CAR_CHANNELS) {
      const q = CAR_QUANT[c];
      if (q.every !== 1) continue;
      for (let f = 0; f < rec.frames; f++) {
        const i = f * ROW + carCol(c);
        expect(Math.abs(rows[i] - rec.rows[i])).toBeLessThanOrEqual(
          q.step / 2 + 1e-9,
        );
      }
    }
    // Decimated channels: exact on the kept frames, interpolated between them.
    WHEEL_CHANNELS.forEach((c, ci) => {
      const q = WHEEL_QUANT[c];
      for (let f = 0; f < rec.frames; f += q.every) {
        const i = f * ROW + wheelCol(2, ci);
        expect(Math.abs(rows[i] - rec.rows[i])).toBeLessThanOrEqual(
          q.step / 2 + 1e-9,
        );
      }
    });
  });

  test('size: a minute of driving stays far under the budget', async () => {
    const rec = synthetic(60);
    const file = await encodeReplay(header(rec.frames), rec);
    // Measured on real stages ~200-260 B/s (integration-tests/rally/replay.test.ts); synthetic noise is rougher.
    expect(file.length / 60).toBeLessThan(600);
    expect(file.length).toBeLessThan(REPLAY_BUDGET);
  });

  test('a run over the budget is thinned to fit (stride doubles, teleport + impact survive)', async () => {
    const rec = synthetic(60);
    const full = await encodeReplay(header(rec.frames), rec);
    const file = await encodeReplay(
      header(rec.frames),
      rec,
      Math.round(full.length * 0.7),
    );
    expect(file.length).toBeLessThan(full.length * 0.7);
    const h = readHeader(file);
    expect(h.stride).toBe(8);
    // Even frames plus the last one.
    expect(h.frames).toBe(Math.ceil(rec.frames / 2) + ((rec.frames - 1) % 2));
    const { rows } = await decodeReplay(file);
    let teleports = 0;
    let impact = 0;
    for (let f = 0; f < h.frames; f++) {
      if (rows[f * ROW + carCol('flags')] & F_TELEPORT) teleports++;
      impact = Math.max(impact, rows[f * ROW + carCol('impact')]);
    }
    expect(teleports).toBe(1);
    expect(impact).toBe(4200);
  });

  test('thinFrames keeps the last frame and moves a dropped teleport forward', () => {
    const rows = new Float64Array(5 * ROW);
    rows[3 * ROW + carCol('flags')] = F_TELEPORT;
    rows[4 * ROW + carCol('stageTime')] = 9;
    const t = thinFrames({ frames: 5, rows });
    expect(t.frames).toBe(3);
    expect(t.rows[2 * ROW + carCol('stageTime')]).toBe(9);
    expect(t.rows[2 * ROW + carCol('flags')] & F_TELEPORT).toBe(F_TELEPORT);
  });

  test('text form round trip and a foreign file is refused', async () => {
    const rec = synthetic(2);
    const file = await encodeReplay(header(rec.frames), rec);
    const back = replayFromText(replayToText(file));
    expect([...back]).toEqual([...file]);
    expect(() =>
      readHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])),
    ).toThrow();
    const old = file.slice();
    old[3] = REPLAY_FORMAT + 1;
    expect(() => readHeader(old)).toThrow(/format/);
  });
});

describe('replay store policy', () => {
  const meta = (
    i: number,
    time?: number,
    car = 'a',
    stageVer = 1,
    name?: string | null,
    stage = 's',
  ): ReplayMeta => ({
    id: `${stage}:${i}`,
    stage,
    car,
    date: i,
    time,
    stageVer,
    carVer: 1,
    bytes: 1000 + i,
    header: header(1),
    name,
  });

  test('bests: fastest per stage, car and times version', () => {
    const list = [
      meta(1, 50),
      meta(2, 45), // best of a / v1 on s
      meta(3, 70, 'b'), // only run of b
      meta(4, 40, 'a', 0), // best of the older stage version
      meta(5, undefined), // not finished
      meta(6, 60, 'a', 1, null, 't'), // other stage
    ];
    expect([...bestIds(list)].sort()).toEqual(['s:2', 's:3', 's:4', 't:6']);
  });

  test('delete auto saves: never a named save; bests kept unless asked', () => {
    const list = [
      meta(1, 50),
      meta(2, 45), // best, auto
      meta(3, 30, 'b', 1, 'my line'), // named (and a best)
      meta(4, 55, 'a', 1, ''), // empty name = auto
      meta(5, undefined, 'a', 1, null),
    ];
    expect(autoDeleteIds(list).sort()).toEqual(['s:1', 's:4', 's:5']);
    expect(autoDeleteIds(list, false).sort()).toEqual([
      's:1',
      's:2',
      's:4',
      's:5',
    ]);
    expect(bytesOf(list, ['s:1', 's:4'])).toBe(1001 + 1004);
  });

  test('totals and the soft limit (saving never stops)', () => {
    const many = Array.from({ length: REPLAY_SOFT_LIMIT }, (_, i) =>
      meta(i, 60, 'a', 1, i === 7 ? 'keep' : null),
    );
    const t = replayTotals(many);
    expect(t.count).toBe(REPLAY_SOFT_LIMIT);
    expect(t.named).toBe(1);
    expect(t.full).toBe(true);
    expect(replayTotals(many.slice(1)).full).toBe(false);
  });

  test('names: one line, trimmed, capped; blank = auto', () => {
    expect(cleanName('  Best   run\n ever ')).toBe('Best run ever');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(100))!.length).toBe(NAME_MAX);
    // Stored as text, shown with textContent: markup stays text.
    expect(cleanName('<b>hi</b>')).toBe('<b>hi</b>');
  });
});

describe('replay TV cameras', () => {
  // Straight north 400 m, a 90° right-hander, 400 m east (x decreases going right when facing +Z).
  const pts: [number, number][] = [];
  for (let s = 0; s <= 400; s += 20) pts.push([0, s]);
  for (let a = 1; a <= 9; a++) {
    const t = (a / 10) * (Math.PI / 2);
    pts.push([-40 + 40 * Math.cos(t), 400 + 40 * Math.sin(t)]);
  }
  for (let s = 0; s <= 400; s += 20) pts.push([-40 - s, 440]);
  const road = new Road(
    { points: pts.map(([x, z]) => ({ x, z })), width: 7 } as unknown as RoadDef,
    () => 0,
  );

  test('finds the corner with its direction and covers the road', () => {
    const corners = findCorners(road, 0, road.length);
    expect(corners.length).toBe(1);
    expect(corners[0].turn).toBeLessThan(0); // right-hander
    // The arc runs 400-463 m; the apex lands in it.
    expect(corners[0].along).toBeGreaterThan(395);
    expect(corners[0].along).toBeLessThan(470);
    const cams = planTvCameras(road, 0, road.length, { heightAt: () => 0 });
    const corner = cams.find((c) => c.kind === 'corner')!;
    expect(corner).toBeTruthy();
    // Outside of a right-hander = left of travel: towards +x / +z of the bend.
    expect(corner.pos.x + corner.pos.z).toBeGreaterThan(-40 + 440);
    expect(cams.length).toBeGreaterThan(1); // fillers on the straights
    for (let s = 10; s < road.length - 10; s += 25)
      expect(cameraFor(cams, s)).not.toBeNull();
  });
});
