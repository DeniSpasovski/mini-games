/**
 * Replay export: a section of a replay rendered frame by frame at a fixed rate and size (RallyGame.exportReplay), not
 * recorded in real time, so a slow machine never drops or holds a frame and the picture is never squeezed into what a
 * real-time encoder manages. Encoded with WebCodecs and written to an MP4 by Mediabunny (loaded on the first export).
 * The car's sound is rendered offline from the same frames (`audio-tape.ts`).
 */

/** Output sizes (16:9) and their video bitrates (bits/s): about 1.5x the usual 60 fps upload rates (foliage is busy). */
export const EXPORT_SIZES = [
  { id: '720p', label: '720p', w: 1280, h: 720, bitrate: 10_000_000 },
  { id: '1080p', label: '1080p', w: 1920, h: 1080, bitrate: 20_000_000 },
  { id: '1440p', label: '1440p', w: 2560, h: 1440, bitrate: 35_000_000 },
  { id: '2160p', label: '4K', w: 3840, h: 2160, bitrate: 70_000_000 },
] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];
export const DEFAULT_EXPORT_SIZE: ExportSize = EXPORT_SIZES[1];

/** Frames per second of an export. */
export const EXPORT_FPS = 60;

/** The browser can encode (WebCodecs) and render sound offline. */
export function exportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

/** One export being written: `frame()` after each rendered frame, then `finish()` with the sound. */
export class VideoExport {
  private constructor(
    private readonly output: import('mediabunny').Output,
    private readonly video: import('mediabunny').CanvasSource,
    private readonly audio: import('mediabunny').AudioBufferSource | null,
    private readonly target: import('mediabunny').BufferTarget,
  ) {}

  /** Null when the browser encodes none of the codecs at this size. */
  static async create(
    canvas: HTMLCanvasElement,
    size: ExportSize,
  ): Promise<VideoExport | null> {
    const mb = await import('mediabunny');
    // H.264 plays everywhere; HEVC / VP9 / AV1 (in MP4) where it can't do the size (4K on some machines).
    const codec = await mb.getFirstEncodableVideoCodec(
      ['avc', 'hevc', 'vp9', 'av1'],
      {
        width: size.w,
        height: size.h,
        bitrate: size.bitrate,
        frameRate: EXPORT_FPS,
      },
    );
    if (!codec) return null;
    const audioCodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 192_000,
    });
    const target = new mb.BufferTarget();
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    const video = new mb.CanvasSource(canvas, {
      codec,
      bitrate: size.bitrate,
      latencyMode: 'quality',
      keyFrameInterval: 1,
    });
    output.addVideoTrack(video, { frameRate: EXPORT_FPS });
    const audio = audioCodec
      ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 192_000 })
      : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();
    return new VideoExport(output, video, audio, target);
  }

  /** Add the canvas as frame `i` (call straight after it rendered: the drawing buffer is cleared once it shows). */
  frame(i: number): Promise<void> {
    return this.video.add(i / EXPORT_FPS, 1 / EXPORT_FPS);
  }

  /** Add the sound, close the file; resolves with it. */
  async finish(sound: AudioBuffer | null): Promise<Blob> {
    this.video.close();
    if (this.audio && sound) await this.audio.add(sound);
    this.audio?.close();
    await this.output.finalize();
    return new Blob([this.target.buffer!], { type: 'video/mp4' });
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}

/** Save a finished export as a file. */
export function downloadVideo(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.mp4`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
