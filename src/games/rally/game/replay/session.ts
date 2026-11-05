/**
 * One replay being watched (DOM-free): the track, its clock for the HUD, the camera director and the transport
 * (time, speed, play / pause, seek). `RallyGame.frame` calls `advance` once per frame and poses the car from
 * `track.apply(time, dt)`.
 */
import type { PerspectiveCamera } from 'three';
import type { World } from '../../world/world';
import { decodeReplay } from './codec';
import { ReplayClock, ReplayTrack } from './playback';
import { ReplayDirector } from './replay-cameras';
import { planTvCameras, type TvCamera, type TvWorld } from './tv-cameras';

/** Playback speeds offered (UI, `[` / `]`). */
export const SPEEDS = [0.25, 0.5, 1, 2];

/** TV cameras per stage, planned once per page. */
const planned = new Map<string, Promise<TvCamera[]>>();

/** Corridor (m either side of the road) whose trees and buildings can block a TV camera. */
const CORRIDOR = 45;
/** Crown of a scattered tree, generic (the planner must not load tree models): radius and top over its foot (m) at scale 1. */
const CROWN_R = 3.2;
const CROWN_TOP = 20;
const CROWN_FOOT = 1.6;
/** Main-thread slice (ms) before the planner yields a frame. */
const SLICE = 6;

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * What can hide the car from a TV camera along the stage: every scattered tree as a crown cylinder, every other collider
 * (rocks, walls, buildings) as its own cylinder. Builds the scatter chunks of the corridor (deterministic, the same the
 * drive builds; pruned again by the streamer) in slices, so it never hitches a frame.
 */
async function tvWorld(world: World): Promise<TvWorld> {
  const cs = world.scatter.chunkSize;
  const st = world.stage;
  const road = world.stageRoad;
  const keys = new Set<string>();
  for (
    let a = Math.max(0, st.start - 60);
    a <= Math.min(road.length, st.finish + 90);
    a += 12
  ) {
    const s = road.at(a);
    for (
      let cz = Math.floor((s.z - CORRIDOR) / cs);
      cz <= Math.floor((s.z + CORRIDOR) / cs);
      cz++
    )
      for (
        let cx = Math.floor((s.x - CORRIDOR) / cs);
        cx <= Math.floor((s.x + CORRIDOR) / cs);
        cx++
      )
        keys.add(`${cx},${cz}`);
  }
  // Discs on an 8 m grid: x, z, r, y0, y1.
  const CELL = 8;
  const grid = new Map<number, number[]>();
  const cellKey = (ix: number, iz: number) => ix * 73856093 + iz * 19349663;
  const add = (x: number, z: number, r: number, y0: number, y1: number) => {
    for (
      let iz = Math.floor((z - r) / CELL);
      iz <= Math.floor((z + r) / CELL);
      iz++
    )
      for (
        let ix = Math.floor((x - r) / CELL);
        ix <= Math.floor((x + r) / CELL);
        ix++
      ) {
        const k = cellKey(ix, iz);
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(x, z, r, y0, y1);
      }
  };
  let t0 = performance.now();
  for (const k of keys) {
    const [cx, cz] = k.split(',').map(Number);
    const ch = world.scatter.chunk(cx, cz);
    for (const inst of ch.instances)
      if (inst.tree)
        add(
          inst.x,
          inst.z,
          CROWN_R * inst.scale,
          inst.y + CROWN_FOOT * inst.scale,
          inst.y + CROWN_TOP * inst.scale,
        );
    for (const c of ch.colliders)
      if (c.r < 30)
        add(
          c.x,
          c.z,
          c.r,
          c.y - (c.kind === 'sphere' ? c.r : 0),
          c.y + (c.kind === 'sphere' ? c.r : c.h),
        );
    if (performance.now() - t0 > SLICE) {
      await nextFrame();
      t0 = performance.now();
    }
  }
  return {
    heightAt: (x, z) => world.heightAt(x, z),
    solid: (x, y, z) => {
      const c = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!c) return false;
      for (let i = 0; i < c.length; i += 5)
        if (
          y > c[i + 3] &&
          y < c[i + 4] &&
          (x - c[i]) ** 2 + (z - c[i + 1]) ** 2 < c[i + 2] ** 2
        )
          return true;
      return false;
    },
  };
}

/** The stage's TV cameras (planned in the background the first time, cached per stage). Call early: at the finish. */
export function tvCamerasFor(world: World): Promise<TvCamera[]> {
  const id = world.stageDef.id;
  let p = planned.get(id);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const w = await tvWorld(world);
      await nextFrame();
      const t1 = performance.now();
      const cams = planTvCameras(
        world.stageRoad,
        world.stage.start,
        world.stage.finish,
        w,
        world.stageRoad === world.road ? [] : [world.road],
      );
      console.info(
        `replay: ${cams.length} TV cameras (${cams.filter((c) => c.kind === 'corner').length} corners), blockers ${Math.round(t1 - t0)} ms, plan ${Math.round(performance.now() - t1)} ms`,
      );
      return cams;
    })();
    planned.set(id, p);
  }
  return p;
}

export class ReplaySession {
  time = 0;
  speed = 1;
  playing = true;
  /** Replay seconds this frame moved (signed; 0 while paused). */
  dt = 0;
  /** Set by a seek: the frame jumps (no impacts, marks break, cameras snap). */
  jumped = true;
  /** Hide every overlay (video / clean feed). */
  clean = false;
  private seekTarget: number | null = null;
  readonly clock: ReplayClock;
  readonly director: ReplayDirector;

  private constructor(
    readonly track: ReplayTrack,
    readonly file: Uint8Array,
    world: World,
    camera: PerspectiveCamera,
    cams: TvCamera[],
  ) {
    const st = world.stage;
    this.clock = new ReplayClock(track, [st.start, ...st.splits, st.finish]);
    this.director = new ReplayDirector(
      camera,
      (x, z) => world.heightAt(x, z),
      world.stageRoad,
      cams,
    );
    // Start a moment before GO: the launch is part of the show.
    this.time = Math.max(0, track.goTime - 1.5);
  }

  static async open(
    file: Uint8Array,
    world: World,
    camera: PerspectiveCamera,
  ): Promise<ReplaySession> {
    const [decoded, cams] = await Promise.all([
      decodeReplay(file),
      tvCamerasFor(world),
    ]);
    return new ReplaySession(
      new ReplayTrack(decoded),
      file,
      world,
      camera,
      cams,
    );
  }

  get duration(): number {
    return this.track.duration;
  }

  seek(t: number): void {
    this.seekTarget = Math.max(0, Math.min(this.duration, t));
  }

  togglePlay(): void {
    if (!this.playing && this.time >= this.duration - 0.01) this.seek(0);
    this.playing = !this.playing;
  }

  /** Real seconds since the last frame -> the replay time of this frame. */
  advance(realDt: number): void {
    if (this.seekTarget !== null) {
      const back = this.seekTarget < this.time;
      this.time = this.seekTarget;
      this.seekTarget = null;
      this.dt = 0;
      this.jumped = true;
      this.track.seeked(this.time);
      this.director.snap();
      this.wentBack = back;
      return;
    }
    this.jumped = false;
    this.wentBack = false;
    if (!this.playing) {
      this.dt = 0;
      return;
    }
    const next = Math.min(this.duration, this.time + realDt * this.speed);
    this.dt = next - this.time;
    this.time = next;
    if (this.time >= this.duration) this.playing = false;
  }

  /** The last seek went backwards (knocked-over posts stand up again). */
  wentBack = false;
}
