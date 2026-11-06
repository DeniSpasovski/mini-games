/**
 * Replay video: the game canvas (the 3D view only: the HUD and replay bar are DOM, so the video is a clean feed) plus
 * the car's sound, recorded in real time with MediaRecorder and downloaded when stopped. MP4 (H.264) where the
 * browser records it (Chrome 126+), else WebM (VP9 / VP8). Real time: a slow frame on the machine is a held frame in
 * the video (an offline fixed-step render is listed in sources/rally/REPLAY.md for later).
 */
import { RELEASE_BUILD } from '../../../../shared/release';

const TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
/** Video bitrate (bits/s): plenty for 1080p60 of a forest stage. */
const BITRATE = 16_000_000;

/** Recording is not in the release build for now (it is being fixed): no button, no key. */
export function videoSupported(): boolean {
  return (
    !RELEASE_BUILD &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype &&
    TYPES.some((t) => MediaRecorder.isTypeSupported(t))
  );
}

export class ReplayVideo {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  readonly type: string;
  readonly started = performance.now();
  private done: Promise<Blob>;

  constructor(
    canvas: HTMLCanvasElement,
    audio: { stream: MediaStream; release: () => void } | null,
    private name: string,
  ) {
    this.type = TYPES.find((t) => MediaRecorder.isTypeSupported(t))!;
    const stream = canvas.captureStream(60);
    for (const t of audio?.stream.getAudioTracks() ?? []) stream.addTrack(t);
    this.rec = new MediaRecorder(stream, {
      mimeType: this.type,
      videoBitsPerSecond: BITRATE,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      this.rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        audio?.release();
        resolve(new Blob(this.chunks, { type: this.type.split(';')[0] }));
      };
    });
    this.rec.start(1000);
  }

  get seconds(): number {
    return (performance.now() - this.started) / 1000;
  }

  /** Stop and download the file; resolves with its size (bytes). */
  async stop(): Promise<number> {
    if (this.rec.state !== 'inactive') this.rec.stop();
    const blob = await this.done;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.name}.${this.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return blob.size;
  }
}
