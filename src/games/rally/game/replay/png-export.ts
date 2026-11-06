/**
 * Lossless replay export: every frame as a numbered PNG and the sound as a WAV, written into a folder the player picks
 * (Chrome / Edge: `showDirectoryPicker`). Nothing is compressed away; editors import it as an image sequence.
 */
import type { ExportWriter } from './export';

type DirPicker = (opts: {
  id?: string;
  mode: 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

/** The browser can write into a picked folder. */
export function losslessSupported(): boolean {
  return (
    typeof (window as unknown as { showDirectoryPicker?: DirPicker })
      .showDirectoryPicker === 'function' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/** Ask for a folder and make `name` in it; null when the player cancelled. */
export async function pickSaveFolder(name: string): Promise<{
  parent: FileSystemDirectoryHandle;
  dir: FileSystemDirectoryHandle;
} | null> {
  const pick = (window as unknown as { showDirectoryPicker: DirPicker })
    .showDirectoryPicker;
  try {
    const parent = await pick({ id: 'rally-export', mode: 'readwrite' });
    const dir = await parent.getDirectoryHandle(name, { create: true });
    return { parent, dir };
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

/** PNGs encoding at once (each holds a copy of the frame). */
const IN_FLIGHT = 4;

export class PngSequenceExport implements ExportWriter {
  private readonly free: OffscreenCanvas[] = [];
  private readonly pending = new Set<Promise<void>>();
  private error: unknown;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly parent: FileSystemDirectoryHandle,
    private readonly dir: FileSystemDirectoryHandle,
  ) {}

  /** Copy the canvas now (the drawing buffer is cleared once it shows; opaque: the WebGL alpha is not coverage), encode and write it in the background. */
  async frame(i: number): Promise<void> {
    if (this.error) throw this.error;
    const { width: w, height: h } = this.canvas;
    let c = this.free.pop();
    if (!c || c.width !== w || c.height !== h) c = new OffscreenCanvas(w, h);
    c.getContext('2d', { alpha: false })!.drawImage(this.canvas, 0, 0);
    const copy = c;
    const job = (async () => {
      const png = await copy.convertToBlob({ type: 'image/png' });
      this.free.push(copy);
      await this.write(`frame_${String(i + 1).padStart(6, '0')}.png`, png);
    })()
      .catch((e: unknown) => {
        this.error ??= e;
      })
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
    while (this.pending.size >= IN_FLIGHT) await Promise.race(this.pending);
    if (this.error) throw this.error;
  }

  async finish(sound: AudioBuffer | null): Promise<Blob | null> {
    await Promise.all(this.pending);
    if (this.error) throw this.error;
    if (sound) await this.write('sound.wav', wav(sound));
    return null;
  }

  /** Stop and remove the half-written folder. */
  async cancel(): Promise<void> {
    await Promise.allSettled(this.pending);
    await this.parent
      .removeEntry(this.dir.name, { recursive: true })
      .catch(() => {});
  }

  private async write(name: string, data: Blob): Promise<void> {
    const f = await this.dir.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write(data);
    await w.close();
  }
}

/** 24-bit PCM WAV of a buffer. */
function wav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels;
  const n = b.length;
  const bytes = 3;
  const data = n * ch * bytes;
  const out = new DataView(new ArrayBuffer(44 + data));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  out.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, b.sampleRate, true);
  out.setUint32(28, b.sampleRate * ch * bytes, true);
  out.setUint16(32, ch * bytes, true);
  out.setUint16(34, bytes * 8, true);
  str(36, 'data');
  out.setUint32(40, data, true);
  const chans = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 0x7fffff);
      out.setUint8(o, v & 0xff);
      out.setUint8(o + 1, (v >> 8) & 0xff);
      out.setUint8(o + 2, (v >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
