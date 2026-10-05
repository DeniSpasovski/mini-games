import { newRoadQuery, type RoadQuery } from '../world/road';
import type { World } from '../world/world';

/**
 * Stage timing: countdown -> running -> finished, splits and progress along
 * the road. Progress only advances smoothly along the road, so cutting
 * across terrain to a far part of the road doesn't count.
 *
 * Cut detection (while running): distance is measured beyond the road edge, to
 * the stretch of road around the current progress only (so a hairpin's other
 * leg doesn't count as "on the road"). Past CUT_WARN the HUD warns; if the car
 * isn't heading back (closing on the road) for CUT_GRACE s in total, or ever
 * gets past CUT_MAX, or drives onto the road further ahead than the progress
 * window (a shortcut), it's put back where it last left the road ('cut' event).
 */
export type StagePhase = 'countdown' | 'running' | 'finished';

export interface StageEvent {
  type: 'go' | 'split' | 'finish' | 'wrongway' | 'cut';
  index?: number;
  time?: number;
  /** Delta to best (s), if a best exists. */
  delta?: number;
  /** 'split': delta of just this sector to the best's same sector (s); colours the split like the sector bar. */
  sectorDelta?: number;
  /** 'finish': penalty seconds included in `time`. */
  penalty?: number;
  /** 'cut': where to put the car back (m along the road). */
  along?: number;
}

const COUNTDOWN = 3;
/** Time penalties (s) added to the stage time. */
export const PENALTY_RESET = 2;
export const PENALTY_CUT = 5;
/** Per marker post (breakable prop) knocked over during the stage. */
export const PENALTY_MARKER = 10;
/** Progress only follows the road within this many metres of the current progress. */
const WINDOW = 40;
/** Metres beyond the road edge that start the off-stage warning (10 = strict). */
export const CUT_WARN = 20;
/** Seconds past CUT_WARN without heading back before the car is reset. */
export const CUT_GRACE = 3;
/** Metres beyond the road edge that reset the car at once. */
export const CUT_MAX = 40;
/** Within this many metres of the road edge counts as on the road (verge) - the reset point. */
const ON_ROAD = 2;
/** Closing on the road faster than this (m/s) counts as heading back. */
const RETURN_SPEED = 1;

export class StageTimer {
  phase: StagePhase = 'countdown';
  countdown = COUNTDOWN;
  time = 0;
  progress = 0;
  splitTimes: number[] = [];
  /** Metres beyond the road edge, to the road around the progress (running only). */
  offStage = 0;
  /** Where the car was last on the road (m along) - a cut puts it back here. */
  exitAlong = 0;
  /** Off-stage warning showing (past CUT_WARN, or on a later part of the road). */
  cutWarning = false;
  /** The warning is for driving onto a later part of the road. */
  shortcut = false;
  /** Car is closing on the road (the grace timer is paused). */
  returning = false;
  /** Seconds of grace used up. */
  cutTimer = 0;
  wrongWay = false;
  best: { total: number; splits: number[] } | null;
  /** Best run as it was when this run started (sector colours compare against it). */
  reference: { total: number; splits: number[] } | null;
  /** Total time when finished (for the last sector). */
  finishTime: number | null = null;
  /** Penalty seconds so far (already included in `time`). */
  penalty = 0;
  private q = newRoadQuery();
  private qLocal = newRoadQuery();
  private wrongTimer = 0;
  private prevOff = NaN;
  /** Smoothed rate of change of offStage (m/s, - = closing on the road). */
  private offRate = 0;
  private listeners: ((e: StageEvent) => void)[] = [];

  constructor(
    private world: World,
    private storeKey: string,
  ) {
    this.best = loadBest(storeKey);
    this.reference = this.best;
    this.progress = world.stage.start - 10;
  }

  on(fn: (e: StageEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: StageEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  reset(progress = this.world.stage.start - 10): void {
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.time = 0;
    this.penalty = 0;
    this.splitTimes = [];
    this.finishTime = null;
    this.progress = progress;
    this.wrongWay = false;
    this.reference = this.best;
    this.rejoin(progress);
  }

  /** Car put back on the road at `along` (reset / cut): clear the off-stage state. */
  rejoin(along: number): void {
    this.exitAlong = along;
    this.offStage = 0;
    this.cutWarning = false;
    this.shortcut = false;
    this.returning = false;
    this.cutTimer = 0;
    this.prevOff = NaN;
    this.offRate = 0;
    this.wrongTimer = 0;
  }

  /** Where a manual reset puts the car: nearest point on the road around the progress. */
  resetAlong(x: number, z: number): number {
    return this.world.road.queryRange(
      x,
      z,
      this.progress - WINDOW,
      this.progress + WINDOW,
      this.qLocal,
    ).along;
  }

  /** Sector boundaries along the road: start, splits..., finish. */
  get sectorBounds(): number[] {
    const st = this.world.stage;
    return [st.start, ...st.splits, st.finish];
  }

  /** Completed sector times so far (s). */
  sectorTimes(): number[] {
    const cum = [
      ...this.splitTimes,
      ...(this.finishTime !== null ? [this.finishTime] : []),
    ];
    return cum.map((t, i) => t - (i ? cum[i - 1] : 0));
  }

  /** Sector times of the reference best run, or null. */
  referenceSectorTimes(): number[] | null {
    const r = this.reference;
    if (!r) return null;
    const cum = [...r.splits, r.total];
    return cum.map((t, i) => t - (i ? cum[i - 1] : 0));
  }

  /** Adds a time penalty to the running stage time (splits, HUD and result all include it). */
  addPenalty(seconds: number): void {
    this.time += seconds;
    this.penalty += seconds;
  }

  /** Skip timing entirely (free drive / test pad). */
  freeDrive(): void {
    this.phase = 'finished';
    this.countdown = 0;
  }

  update(
    dt: number,
    x: number,
    z: number,
    fwdX: number,
    fwdZ: number,
    speed: number,
  ): void {
    const st = this.world.stage;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.emit({ type: 'go' });
      }
      return;
    }
    if (this.phase !== 'running') return;
    const q = this.world.road.query(x, z, this.q);
    this.time += dt;
    if (
      q.found &&
      q.distance < 25 &&
      q.along > this.progress - WINDOW &&
      q.along < this.progress + WINDOW
    ) {
      this.progress = Math.max(this.progress, q.along);
      // Wrong way: facing against the road while moving.
      const s = this.world.road.at(q.along);
      const against = fwdX * s.tx + fwdZ * s.tz < -0.4 && speed > 3;
      this.wrongTimer = against ? this.wrongTimer + dt : 0;
      const ww = this.wrongTimer > 1.5;
      if (ww && !this.wrongWay) this.emit({ type: 'wrongway' });
      this.wrongWay = ww;
    }
    if (this.updateCut(dt, x, z, q)) return;
    const i = this.splitTimes.length;
    if (i < st.splits.length && this.progress >= st.splits[i]) {
      const prev = i ? this.splitTimes[i - 1] : 0;
      this.splitTimes.push(this.time);
      const b = this.reference?.splits[i];
      const bPrev = i ? this.reference?.splits[i - 1] : 0;
      this.emit({
        type: 'split',
        index: i,
        time: this.time,
        delta: b !== undefined ? this.time - b : undefined,
        sectorDelta:
          b !== undefined && bPrev !== undefined
            ? this.time - prev - (b - bPrev)
            : undefined,
      });
    }
    if (this.progress >= st.finish) {
      this.phase = 'finished';
      this.finishTime = this.time;
      const delta = this.reference
        ? this.time - this.reference.total
        : undefined;
      if (!this.best || this.time < this.best.total) {
        this.best = { total: this.time, splits: [...this.splitTimes] };
        saveBest(this.storeKey, this.best);
      }
      this.emit({
        type: 'finish',
        time: this.time,
        delta,
        penalty: this.penalty,
      });
    }
  }

  /** Off-stage warning / reset (see the file comment). True = the car was reset ('cut' emitted). */
  private updateCut(dt: number, x: number, z: number, q: RoadQuery): boolean {
    const l = this.world.road.queryRange(
      x,
      z,
      this.progress - WINDOW,
      this.progress + WINDOW,
      this.qLocal,
    );
    const off = Math.max(0, l.distance - l.halfWidth);
    this.offStage = off;
    if (off <= ON_ROAD) this.exitAlong = l.along;
    if (!Number.isNaN(this.prevOff)) {
      const rate = (off - this.prevOff) / dt;
      this.offRate += (rate - this.offRate) * Math.min(1, dt / 0.3);
    }
    this.prevOff = off;
    // On the tarmac of a later part of the road (e.g. down to the next hairpin leg).
    this.shortcut =
      q.found &&
      q.distance < q.halfWidth &&
      q.along > this.progress + WINDOW &&
      off > ON_ROAD;
    if (this.shortcut || off > CUT_WARN) this.cutWarning = true;
    else if (off < CUT_WARN - 2) this.cutWarning = false;
    this.returning = !this.shortcut && this.offRate < -RETURN_SPEED;
    if (!this.cutWarning) {
      this.cutTimer = 0;
      return false;
    }
    // Paused (not reset) while heading back, so weaving in and out can't stall it.
    if (!this.returning) this.cutTimer += dt;
    if (this.cutTimer < CUT_GRACE && off < CUT_MAX) return false;
    const along = this.exitAlong;
    this.progress = Math.min(this.progress, along);
    this.rejoin(along);
    this.addPenalty(PENALTY_CUT);
    this.emit({ type: 'cut', along });
    return true;
  }

  get fraction(): number {
    const st = this.world.stage;
    return Math.min(
      1,
      Math.max(0, (this.progress - st.start) / (st.finish - st.start)),
    );
  }
}

/**
 * Version of the physics / timing the saved times were driven under.
 *
 * BUMP THIS whenever a change makes old times incomparable: handling / tyre / suspension / gearing
 * physics, car stats, track-limit penalties, or a map's road / length. On every game start
 * `purgeStaleTimes` compares it with the version stored in `rally.timesVersion` and wipes every
 * leaderboard (`rally.times.*`) and per-car best (`rally.best.*`) when they differ.
 *
 * History: 1 = first versioned release, after the tyre compounds / suspension set-ups / gearing / hull
 * physics rework (every time saved before it is erased).
 */
export const TIMES_VERSION = 1;
const TIMES_VERSION_KEY = 'rally.timesVersion';
const TIMES_PREFIXES = ['rally.times.', 'rally.best.'];

/**
 * Erase every saved time when they were saved under another `TIMES_VERSION` (or before versions
 * existed). Returns true when it wiped. Call once when the game opens, before any menu reads times.
 */
export function purgeStaleTimes(store: Storage = localStorage): boolean {
  try {
    const v = String(TIMES_VERSION);
    if (store.getItem(TIMES_VERSION_KEY) === v) return false;
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && TIMES_PREFIXES.some((p) => k.startsWith(p))) stale.push(k);
    }
    for (const k of stale) store.removeItem(k);
    store.setItem(TIMES_VERSION_KEY, v);
    return stale.length > 0;
  } catch {
    return false; // storage blocked: nothing saved, nothing to purge
  }
}

/** localStorage key of the best run per map + car. */
export function bestKey(mapId: string, carId: string): string {
  return `rally.best.${mapId}.${carId}`;
}

export function loadBest(
  key: string,
): { total: number; splits: number[] } | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBest(key: string, v: { total: number; splits: number[] }): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore - best times just won't persist
  }
}

/** One finished run, kept in the per-map leaderboard. */
export interface RunRecord {
  time: number;
  car: string;
  livery: number;
  /** Tyre fitted for the run; missing on runs saved before tyres existed (those were all the one raw grip). */
  tyre?: string;
  /** Suspension set-up id (soft / medium / stiff); missing on older runs. */
  susp?: string;
  /** Gearing preset (short / medium / long) of cars that can change it; missing on older runs and fixed-gearing cars. */
  gear?: string;
  /** Cumulative split times (s), one per split; missing on runs saved before sectors were kept. */
  splits?: number[];
  /** Penalty seconds included in `time` (reset / track limits); missing = none. */
  penalty?: number;
  /** ms since epoch (also the run's id); 0 = imported best from before the leaderboard existed. */
  date: number;
}

/** Runs kept per car and map (so "this car" can always show a full top 10). */
const RUNS_PER_CAR = 10;

const timesKey = (mapId: string) => `rally.times.${mapId}`;

/** Leaderboard of a map, fastest first. Older per-car bests are folded in once. */
export function loadTimes(mapId: string, carIds: string[]): RunRecord[] {
  let runs: RunRecord[] | null;
  try {
    const raw = localStorage.getItem(timesKey(mapId));
    runs = raw ? JSON.parse(raw) : null;
  } catch {
    runs = null;
  }
  if (!runs) {
    runs = [];
    for (const car of carIds) {
      const b = loadBest(bestKey(mapId, car));
      if (b)
        runs.push({
          time: b.total,
          car,
          livery: 0,
          splits: b.splits,
          date: 0,
        });
    }
  }
  return runs.sort((a, b) => a.time - b.time);
}

/** Add a run to the map leaderboard (keeps the fastest RUNS_PER_CAR per car). */
export function recordTime(
  mapId: string,
  carIds: string[],
  run: RunRecord,
): RunRecord[] {
  // The finish saves the per-car best before this runs, so on a map with no leaderboard
  // yet the imported best is this very run: drop it instead of listing the run twice.
  const old = loadTimes(mapId, carIds).filter(
    (r) => !(r.date === 0 && r.car === run.car && r.time === run.time),
  );
  const all = [...old, run].sort((a, b) => a.time - b.time);
  const perCar = new Map<string, number>();
  const kept = all.filter((r) => {
    const n = (perCar.get(r.car) ?? 0) + 1;
    perCar.set(r.car, n);
    return n <= RUNS_PER_CAR;
  });
  try {
    localStorage.setItem(timesKey(mapId), JSON.stringify(kept));
  } catch {
    // ignore - times just won't persist
  }
  return kept;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Sector times (s) from cumulative splits + the total; empty when the run kept no splits. */
export function sectorTimes(run: Pick<RunRecord, 'time' | 'splits'>): number[] {
  if (!run.splits) return [];
  const cum = [...run.splits, run.time];
  return cum.map((t, i) => t - (i ? cum[i - 1] : 0));
}

export function formatDelta(d: number): string {
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
}
