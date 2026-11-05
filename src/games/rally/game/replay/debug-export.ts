/**
 * `__rally.replay` in the console, and the F2 panel's hidden "Copy" buttons (DETAILS.md "Replays"):
 *   copy()                 the current / last run as text (`rally-replay:<base64>`) on the clipboard
 *   download()             the same as a .rrp file
 *   load(text | bytes)     play a replay (this stage + car here; another one reloads into its stage)
 *   trace(seconds, every)  the last seconds of every physics step (inputs, pose, tyre forces) as TSV text
 *   copyTrace(...)         the trace on the clipboard; downloadTrace(...) as a file
 *   info()                 the header + size of the current run's replay
 *   list()                 saved replays (IndexedDB)
 */
import type { RallyGame } from '../rally-game';
import { readHeader, replayFromText, replayToText } from './codec';
import { listReplays, stashPending, type ReplayMeta } from './store';

export function downloadBytes(
  data: Uint8Array | string,
  name: string,
  type: string,
): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** URL of the play page that opens a saved replay (stage, car and conditions from its header). */
export function replayUrl(
  m: ReplayMeta | { id: string; header: ReplayMeta['header'] },
): string {
  const h = m.header;
  const u = new URL(location.pathname, location.origin);
  const p = u.searchParams;
  p.set('stage', h.stage);
  p.set('car', h.car);
  p.set('livery', String(h.livery));
  p.set('tyre', h.tyre);
  p.set('susp', h.setup);
  p.set('gear', h.gearing);
  p.set('season', h.season);
  if (h.hour !== undefined) p.set('tod', String(h.hour));
  if (h.weather) p.set('weather', h.weather);
  for (const k of ['quality', 'mute', 'display'])
    if (new URLSearchParams(location.search).has(k))
      p.set(k, new URLSearchParams(location.search).get(k)!);
  p.set('replay', m.id);
  return u.toString();
}

export class ReplayConsole {
  constructor(private game: RallyGame) {}

  private name(ext: string): string {
    const h = this.game.world.stageDef.id;
    const d = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `rally-${h}-${this.game.car.id}-${d}.${ext}`;
  }

  /** The current run's replay (the finished one, or the run so far). */
  async bytes(): Promise<Uint8Array> {
    return this.game.watching?.file ?? (await this.game.currentReplay());
  }

  async copy(): Promise<string> {
    const text = replayToText(await this.bytes());
    const ok = await toClipboard(text);
    console.info(
      `replay: ${(text.length / 1024).toFixed(1)} KB of text ${ok ? 'copied' : '(clipboard blocked: returned instead)'}`,
    );
    return ok ? 'copied' : text;
  }

  async download(): Promise<void> {
    downloadBytes(
      await this.bytes(),
      this.name('rrp'),
      'application/octet-stream',
    );
  }

  async info(): Promise<unknown> {
    const b = await this.bytes();
    return { bytes: b.length, ...readHeader(b) };
  }

  /** Play a replay: text from `copy()`, or file bytes. Another stage / car: reloads into it. */
  async load(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    const bytes =
      typeof data === 'string'
        ? replayFromText(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    const h = readHeader(bytes);
    if (h.stage === this.game.world.stageDef.id && h.car === this.game.car.id) {
      await this.game.watchReplay(bytes);
      return;
    }
    if (!(await stashPending(bytes)))
      throw new Error(
        'replay: IndexedDB unavailable, cannot carry it to its stage',
      );
    location.href = replayUrl({ id: 'pending', header: h });
  }

  /** Last `seconds` of the physics trace, every `every`-th step (1 = 240 Hz), tab separated. */
  trace(seconds = 5, every = 4): string {
    return this.game.recorder.traceText(seconds, every);
  }

  async copyTrace(seconds = 5, every = 4): Promise<string> {
    const text = this.trace(seconds, every);
    const ok = await toClipboard(text);
    console.info(
      `trace: ${seconds} s, ${(text.length / 1024).toFixed(1)} KB ${ok ? 'copied' : '(clipboard blocked: returned instead)'}`,
    );
    return ok ? 'copied' : text;
  }

  downloadTrace(seconds = 20, every = 1): void {
    downloadBytes(
      this.trace(seconds, every),
      this.name('tsv'),
      'text/tab-separated-values',
    );
  }

  watch(): Promise<unknown> {
    return this.game.watchReplay();
  }

  list(): Promise<ReplayMeta[]> {
    return listReplays();
  }
}
