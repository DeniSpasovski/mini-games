/**
 * The car's sound of a replay export (`export.ts`). The export renders frames slower (or faster) than real time, so the
 * live sound can't be recorded: while it renders, the game's `CarAudio` tapes what each frame tells the synth
 * (`CarAudio.tape`), then the same synth is built on an OfflineAudioContext and fed the tape frame by frame, at each
 * frame's time (the context is suspended at every frame), which renders the sound track as fast as the CPU allows.
 */
import type { CarDef } from '../../cars/shared/types';
import type { TunnelAcoustics } from '../../world/world';
import { CarAudio, type CarSoundFrame } from '../audio';
import type { CameraMode } from '../camera-rig';

interface TapeFrame {
  listener?: CameraMode;
  weather?: [number, number];
  enclosure?: [TunnelAcoustics | undefined, number];
  sound?: CarSoundFrame;
}

export class AudioTape {
  readonly frames: TapeFrame[] = [];
  private cur: TapeFrame = {};

  /** Close this frame's calls (after the game frame ran). */
  next(): void {
    this.frames.push(this.cur);
    this.cur = {};
  }

  listener(mode: CameraMode): void {
    this.cur.listener = mode;
  }

  weather(rain: number, wet: number): void {
    this.cur.weather = [rain, wet];
  }

  enclosure(tunnel: TunnelAcoustics | undefined, speed: number): void {
    this.cur.enclosure = [tunnel, speed];
  }

  update(s: CarSoundFrame): void {
    this.cur.sound = { ...s, surfaces: { ...s.surfaces } };
  }
}

/** Sample rate of the export's sound track (Hz). */
export const EXPORT_SAMPLE_RATE = 48000;

/** Render the tape (one entry per video frame at `fps`) to a stereo buffer as long as the video. */
export async function renderAudioTape(
  tape: AudioTape,
  car: CarDef,
  weather: { rain: number; wet: number },
  fps: number,
): Promise<AudioBuffer> {
  const n = tape.frames.length;
  const length = Math.max(1, Math.round((n / fps) * EXPORT_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE);
  const audio = new CarAudio(car, weather, ctx);
  const apply = (f: TapeFrame) => {
    if (f.listener) audio.setListener(f.listener);
    if (f.weather) audio.setWeather(...f.weather);
    if (f.sound) audio.update(f.sound);
    if (f.enclosure) audio.setEnclosure(...f.enclosure);
  };
  // Frame 0 at time 0 (before rendering starts), every other one where the context reaches its time: suspend()
  // rounds to the 128-sample render quantum, so a frame's calls land within 2.7 ms of it.
  apply(tape.frames[0] ?? {});
  for (let i = 1; i < n; i++) {
    const t = i / fps;
    if (t >= length / EXPORT_SAMPLE_RATE) break;
    void ctx.suspend(t).then(() => {
      apply(tape.frames[i]);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}
