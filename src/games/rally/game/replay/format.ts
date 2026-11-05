/**
 * Replay format (DOM-free; DETAILS.md "Replays"). A replay is the car's STATE sampled every `stride` physics steps
 * (60 Hz by default), not its inputs: playback poses the car from it and never runs the physics, so it plays the same on
 * every device and after any physics change. One frame = the channels below, kept as plain numbers by the recorder and
 * quantised + delta-coded + gzipped by `codec.ts`.
 */
import type { SurfaceId } from '../../physics/surfaces';

/** Bumped when the binary layout changes; old replays then fail to decode (`decodeReplay` throws). */
export const REPLAY_FORMAT = 1;
/** Physics steps per recorded frame (240 Hz / 4 = 60 Hz). */
export const DEFAULT_STRIDE = 4;

/** Surface ids by index (the frame stores the index); append only. */
export const SURFACE_IDS: SurfaceId[] = [
  'gravel',
  'gravel_loose',
  'grass',
  'dirt',
  'rock',
  'tarmac',
  'tarmac_gravel',
  'mud',
  'snow',
];

/** Per-frame flags (`F_*` bits of channel `flags`). */
export const F_TC_ON = 1;
export const F_TC_ACTIVE = 2;
export const F_ABS_ON = 4;
export const F_ABS_ACTIVE = 8;
export const F_HOLD = 16;
export const F_AUTO = 32;
/** The car was put somewhere else since the last frame (reset, cut, restart): never interpolate across it. */
export const F_TELEPORT = 64;
export const F_CUT_WARN = 128;
export const F_WRONG_WAY = 256;
/** Stage clock running (phase `running`). */
export const F_RUNNING = 512;
export const F_FINISHED = 1024;

/**
 * Per-wheel channels (x4: FL FR RL RR). Suspension travel, contact, surface and the contact patch are NOT stored:
 * they follow from the pose (`Vehicle.probeGround`, the physics' own ground ray), and the slide / roll speeds from the
 * pose's velocity + the wheel spin (playback.ts).
 */
export const WHEEL_CHANNELS = [
  /** Wheel spin speed (rad/s). */
  'omega',
  /** Tyre temperature (°C). */
  'temp',
  /** Brake disc temperature (°C). */
  'disc',
] as const;
export type WheelChannel = (typeof WHEEL_CHANNELS)[number];

/** Whole-car channels after the position (3) and the quaternion (4). */
export const CAR_CHANNELS = [
  'rpm',
  'gear',
  /** Throttle the engine sees (after TC / shift cut), 0..1. */
  'effThrottle',
  'throttle',
  'brake',
  'steer',
  'handbrake',
  /** Body contact impulse (N s): crash sound, camera shake. */
  'impact',
  'flags',
  /** Stage clock (s, penalties included). */
  'stageTime',
  /** Stage progress along the stage road (m). */
  'progress',
] as const;
export type CarChannel = (typeof CAR_CHANNELS)[number];

export interface ReplayHeader {
  format: number;
  /** `game.json` version that recorded it. */
  game: string;
  stage: string;
  map: string;
  car: string;
  livery: number;
  tyre: string;
  setup: string;
  gearing: string;
  season: string;
  hour?: number;
  weather?: string;
  /** Times versions (game/stage.ts) the run was driven under: an older replay is listed as such. */
  stageVer: number;
  carVer: number;
  /** Date.now() at the finish (= the `RunRecord.date` of the run, links the two). */
  date: number;
  /** Final stage time (s, penalties included); absent = not finished (free drive, a quit run). */
  time?: number;
  penalty?: number;
  /** Split times (s, cumulative). */
  splits: number[];
  /** The reference best's sector times when the run was driven (colours the replay's split chips as they were). */
  refSectors?: number[];
  /** Physics steps per frame and the physics rate. */
  stride: number;
  hz: number;
  frames: number;
  /** Spawn was not the stage start (free drive: no clock). */
  free?: boolean;
}

/** One decoded frame (playback interpolates two of these). */
export interface ReplayFrame {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wheels: Record<WheelChannel, number>[];
  car: Record<CarChannel, number>;
}

/** Floats per recorded frame in the recorder's row: position 3 + quaternion 4 + wheels + car. */
export const ROW = 3 + 4 + WHEEL_CHANNELS.length * 4 + CAR_CHANNELS.length;
export const W0 = 7;
export const C0 = W0 + WHEEL_CHANNELS.length * 4;
/** Offset of wheel `w`'s channel `c` in a row. */
export const wheelCol = (w: number, c: number): number =>
  W0 + w * WHEEL_CHANNELS.length + c;
export const carCol = (name: CarChannel): number =>
  C0 + CAR_CHANNELS.indexOf(name);
