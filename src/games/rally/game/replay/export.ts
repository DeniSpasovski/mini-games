/**
 * Replay export: a section of a replay rendered frame by frame at a fixed rate and size (RallyGame.exportReplay), not
 * recorded in real time, so a slow machine never drops or holds a frame and the picture is never squeezed into what a
 * real-time encoder manages. Encoded with WebCodecs and written to an MP4 by Mediabunny (loaded on the first export).
 * The car's sound is rendered offline from the same frames (`audio-tape.ts`).
 */

/** Output sizes (16:9). */
export const EXPORT_SIZES = [
  { id: '720p', label: '720p', w: 1280, h: 720 },
  { id: '1080p', label: '1080p', w: 1920, h: 1080 },
  { id: '1440p', label: '1440p', w: 2560, h: 1440 },
  { id: '2160p', label: '4K', w: 3840, h: 2160 },
] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];
export const DEFAULT_EXPORT_SIZE: ExportSize = EXPORT_SIZES[1];

/**
 * MP4 quality: a fixed quantizer where the encoder offers one (the same quality in every frame, the size follows the
 * picture; `q` 0 = the codec's usual worst, 1 = its usual best, past 1 finer still), else a constant bitrate (`mbps` at
 * 1080p60, scaled by pixels; a variable rate let hardware encoders undershoot to a blocky picture). Foliage and gravel
 * are busy pictures: these sit well above the usual upload rates.
 */
export const EXPORT_QUALITIES = [
  { id: 'standard', label: 'Standard', q: 0.85, mbps: 25 },
  { id: 'high', label: 'High', q: 1.15, mbps: 50 },
  { id: 'max', label: 'Maximum', q: 1.45, mbps: 100 },
] as const;
export type Mp4Quality = (typeof EXPORT_QUALITIES)[number];
/** Lossless: numbered PNG frames + WAV sound in a picked folder (`png-export.ts`), where the browser can write one. */
export const LOSSLESS = { id: 'lossless', label: 'Lossless' } as const;
export type ExportQuality = Mp4Quality | typeof LOSSLESS;
export const DEFAULT_EXPORT_QUALITY: ExportQuality = EXPORT_QUALITIES[1];

/** Where an export is (`RallyGame.exportReplay` -> the panel's status line). */
export type ExportStatus =
  | { phase: 'encoder' }
  | { phase: 'stage'; left: number }
  | { phase: 'runup'; done: number }
  | { phase: 'frames'; done: number; total: number }
  | { phase: 'sound' }
  | { phase: 'file' };

/** What an export writes: a frame after each render, then the sound; resolves with a file to download, or none. */
export interface ExportWriter {
  frame(i: number): Promise<void>;
  finish(sound: AudioBuffer | null): Promise<Blob | null>;
  cancel(): Promise<void>;
}

/** Quantizer scale per codec (Mediabunny's: H.264 / HEVC 0-51, VP9 / AV1 0-255 in current Chrome): usual worst / best. */
const QUANTIZER = {
  avc: { worst: 41, best: 16 },
  hevc: { worst: 41, best: 16 },
  vp9: { worst: 208, best: 80 },
  av1: { worst: 208, best: 80 },
};

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
export class VideoExport implements ExportWriter {
  private constructor(
    private readonly output: import('mediabunny').Output,
    private readonly video: import('mediabunny').CanvasSource,
    private readonly audio: import('mediabunny').AudioBufferSource | null,
    private readonly target:
      import('mediabunny').BufferTarget | import('mediabunny').StreamTarget,
  ) {}

  /** Null when the browser encodes none of the codecs at this size. */
  static async create(
    canvas: HTMLCanvasElement,
    size: ExportSize,
    quality: Mp4Quality,
    /** A file picked on disk (`pickSaveFile`): written as it renders. Else kept in memory and downloaded at the end. */
    file?: FileSystemWritableFileStream,
  ): Promise<VideoExport | null> {
    const mb = await import('mediabunny');
    // H.264 plays everywhere; HEVC / VP9 / AV1 (in MP4) where it can't do the size (4K on some machines).
    const bitrate = Math.round(
      (quality.mbps * 1e6 * size.w * size.h) / (1920 * 1080),
    );
    const codec = await mb.getFirstEncodableVideoCodec(
      ['avc', 'hevc', 'vp9', 'av1'],
      { width: size.w, height: size.h, bitrate, frameRate: EXPORT_FPS },
    );
    if (!codec) return null;
    const qp = QUANTIZER[codec as keyof typeof QUANTIZER];
    const q = new mb.Quality({
      quantizer: Math.max(
        0,
        Math.round(qp.worst + (qp.best - qp.worst) * quality.q),
      ),
      bitrate,
      bitrateMode: 'constant',
    });
    const audioCodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 192_000,
    });
    const target = file
      ? new mb.StreamTarget(file, { chunked: true })
      : new mb.BufferTarget();
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: file ? false : 'in-memory' }),
      target,
    });
    const video = new mb.CanvasSource(canvas, {
      codec,
      quality: q,
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

  /** Add the sound, close the file; resolves with it (none when it was written to a picked file). */
  async finish(sound: AudioBuffer | null): Promise<Blob | null> {
    this.video.close();
    if (this.audio && sound) await this.audio.add(sound);
    this.audio?.close();
    await this.output.finalize();
    return 'buffer' in this.target
      ? new Blob([this.target.buffer!], { type: 'video/mp4' })
      : null;
  }

  async cancel(): Promise<void> {
    await this.output.cancel();
  }
}

type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * Ask where to save (Chrome / Edge: the file is written while it renders, nothing piles up in memory). Undefined where
 * the browser has no save dialog (the file downloads at the end); null when the player cancelled it.
 */
export async function pickSaveFile(
  name: string,
): Promise<FileSystemWritableFileStream | null | undefined> {
  const pick = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker;
  if (!pick) return undefined;
  try {
    const handle = await pick({
      suggestedName: `${name}.mp4`,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
    });
    return await handle.createWritable();
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
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
