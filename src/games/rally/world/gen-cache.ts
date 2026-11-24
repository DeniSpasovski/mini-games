/**
 * Disk cache of what a stage load generates (scatter chunks, heightfield chunks, coarse terrain tiles, crop cards),
 * so a second visit reads the numbers back instead of generating them. IndexedDB `rally-gen`, used only from a worker
 * (world/gen-cache-worker.ts): the load asks for its scope's entries at once and gets their buffers handed over (no
 * copy, no decoding on this thread); what it generated is copied and sent to the worker after the load, in idle time,
 * a few large bundles per scope.
 *
 * Stale entries are impossible by key: every key starts with the build id (`__BUILD_ID__`, new on every production
 * build, so any change to a generator or to the map data is a new key) and the scope (map, stage, season: what
 * `new World` is built from; or `global`). Other builds' entries are deleted on the next write; at most MAX_SCOPES
 * stages are kept (the least recently loaded go). Off unless the player turns on the Stage cache option
 * (`setGenCacheEnabled`; turning it off deletes the database, `clearGenCache`) or the URL has `?gencache=1`. No
 * IndexedDB / worker, a failed or slow read, `?gencache=0`, a dev server (its id is `dev-` + its start: on only with
 * `?gencache=1`): no cache, everything is generated as before.
 */

/** Stages kept on disk (each ~10-60 MB). */
const MAX_SCOPES = 4;
/** A load waits this long for its entries at most (then generates; entries arriving later are still used). */
const READ_WAIT_MS = 3000;
/** Bytes copied for the worker per idle slice, and the size of one stored bundle. */
const SLICE_BYTES = 4 << 20;

const DB_NAME = 'rally-gen';

/** The player's Stage cache option (game/settings.ts `stageCache`); off until set. */
let enabled = false;

export function setGenCacheEnabled(on: boolean): void {
  enabled = on;
}

/**
 * Build id of this bundle; '' = no cache (option off, `?gencache=0`, tests, a dev server's `dev-<start>`).
 * `?gencache=1` turns it on whatever the option.
 */
export function genCacheBuild(): string {
  const flag =
    typeof location === 'undefined'
      ? null
      : new URLSearchParams(location.search).get('gencache');
  const id = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
  if (flag === '1') return id;
  if (flag === '0' || !enabled || id.startsWith('dev-')) return '';
  return id;
}

/** Turns the cache off and deletes everything it stored on this device (the option switched off). */
export function clearGenCache(): void {
  enabled = false;
  worker?.terminate();
  worker = undefined;
  for (const f of waiting.values()) f({ ok: false });
  waiting.clear();
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // no IndexedDB: nothing stored
  }
}

/** One stored bundle: entries `kind:id` and their values. */
interface Bundle {
  keys: string[];
  values: unknown[];
}

type GenCacheMessage = { build: string; scope: string } & (
  { op: 'read' } | { op: 'write'; bundles: Bundle[]; maxScopes: number }
);

export type GenCacheRequest = GenCacheMessage & { id: number };

export interface GenCacheAnswer {
  ok: boolean;
  bundles?: Bundle[];
}

let worker: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<number, (a: GenCacheAnswer) => void>();

/** Ask the cache worker (started on first use); `{ ok: false }` when there is none or it failed. */
function ask(
  m: GenCacheMessage,
  transfer: Transferable[] = [],
): Promise<GenCacheAnswer> {
  // A write after the option was switched off (a load's idle-time flush) stores nothing.
  if (m.op === 'write' && !genCacheBuild())
    return Promise.resolve({ ok: false });
  if (worker === undefined) {
    worker = null;
    try {
      if (typeof Worker !== 'undefined' && typeof indexedDB !== 'undefined') {
        const w = new Worker(
          new URL('./gen-cache-worker.ts', import.meta.url),
          {
            type: 'module',
          },
        );
        w.onmessage = (e: MessageEvent<GenCacheAnswer & { id: number }>) => {
          waiting.get(e.data.id)?.(e.data);
          waiting.delete(e.data.id);
        };
        w.onerror = () => {
          worker = null;
          for (const f of waiting.values()) f({ ok: false });
          waiting.clear();
        };
        worker = w;
      }
    } catch {
      worker = null;
    }
  }
  const w = worker;
  if (!w) return Promise.resolve({ ok: false });
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ ...m, id }, transfer);
  });
}

/** Bytes a cached value holds (its typed arrays; strings and numbers roughly). */
function bytesOf(v: unknown): number {
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + bytesOf(x), 0);
  if (v && typeof v === 'object')
    return Object.values(v).reduce((n: number, x) => n + bytesOf(x), 0);
  return typeof v === 'string' ? v.length * 2 : 8;
}

/** `v` with every typed array copied (the page keeps using its own), and the copies' buffers. */
function copyOf(v: unknown, out: Transferable[]): unknown {
  if (ArrayBuffer.isView(v)) {
    const c = (v as unknown as { slice(): ArrayBufferView }).slice();
    out.push(c.buffer as ArrayBuffer);
    return c;
  }
  if (Array.isArray(v)) return v.map((x) => copyOf(x, out));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = copyOf(x, out);
    return o;
  }
  return v;
}

export interface GenCacheStats {
  /** Entries read / handed out / recorded and written. */
  read: number;
  hits: number;
  puts: number;
  /** MB read / written. */
  readMB: number;
  writeMB: number;
  /** ms from asking to the entries being here; ms spent on this thread copying the writes. */
  readMs: number;
  writeMs: number;
  /** MB per kind written (`s` scatter, `h` heightfield, `t` terrain tile, `crop`). */
  kinds: Record<string, number>;
  /** Why there is no cache ('' = there is one; 'read slow': the load did not wait for it). */
  off: string;
  /** `flush` has finished (written, or nothing to write). */
  flushed: boolean;
}

/**
 * The entries of one scope for one load. `take` hands out an entry read at the start (once: then it is dropped from
 * memory); `put` records a generated one while `recording`; `flush` writes what was recorded, in idle time.
 */
export class GenCache {
  readonly ready: Promise<void>;
  readonly stats: GenCacheStats = {
    read: 0,
    hits: 0,
    puts: 0,
    readMB: 0,
    writeMB: 0,
    readMs: 0,
    writeMs: 0,
    kinds: {},
    off: '',
    flushed: false,
  };
  /** Generated entries are kept for writing only while this is on (the load; not what streams in while driving). */
  recording = true;
  private entries = new Map<string, unknown>();
  private pending: [string, unknown][] = [];

  constructor(
    readonly scope: string,
    /** Build id (`genCacheBuild`); '' = no cache. */
    readonly build = genCacheBuild(),
  ) {
    this.ready = build ? this.load() : this.disable('no build id');
  }

  private disable(why: string): Promise<void> {
    this.stats.off = why;
    this.recording = false;
    return Promise.resolve();
  }

  private async load(): Promise<void> {
    const t0 = performance.now();
    const a = await ask({ op: 'read', build: this.build, scope: this.scope });
    if (!a.ok || !a.bundles) return this.disable('no IndexedDB');
    let bytes = 0;
    for (const b of a.bundles)
      for (let i = 0; i < b.keys.length; i++) {
        this.entries.set(b.keys[i], b.values[i]);
        bytes += bytesOf(b.values[i]);
      }
    this.stats.read = this.entries.size;
    this.stats.readMB = Math.round(bytes / 1e5) / 10;
    this.stats.readMs = Math.round(performance.now() - t0);
  }

  /** Waits for the entries, at most `ms` (then the load goes on generating; later entries are still used). */
  async wait(ms = READ_WAIT_MS): Promise<void> {
    let late = false;
    await Promise.race([
      this.ready,
      new Promise<void>((r) =>
        setTimeout(() => {
          late = true;
          r();
        }, ms),
      ),
    ]);
    if (late && !this.stats.off) this.stats.off = 'read slow';
  }

  /** An entry read at the start (`kind:id`), handed out once. */
  take<T>(key: string): T | undefined {
    const v = this.entries.get(key);
    if (v === undefined) return undefined;
    this.entries.delete(key);
    this.stats.hits++;
    return v as T;
  }

  /** Keep a generated entry for writing (while `recording`). Its value must not change afterwards. */
  put(key: string, value: unknown): void {
    if (!this.recording) return;
    this.pending.push([key, value]);
  }

  /**
   * Stop recording, drop the entries nobody took and send the recorded ones to the worker: copied a slice at a time
   * in idle time (the copy is all this thread pays), stored as bundles of about SLICE_BYTES.
   */
  flush(): Promise<void> {
    this.recording = false;
    this.entries.clear();
    const todo = this.pending.splice(0);
    if (!todo.length || this.stats.off) {
      this.stats.flushed = true;
      return Promise.resolve();
    }
    const idle = (): Promise<void> =>
      new Promise((r) =>
        typeof requestIdleCallback === 'function'
          ? requestIdleCallback(() => r(), { timeout: 1000 })
          : setTimeout(r, 50),
      );
    return (async () => {
      const bundles: Bundle[] = [];
      const transfer: Transferable[] = [];
      let i = 0;
      while (i < todo.length) {
        await idle();
        const t0 = performance.now();
        const b: Bundle = { keys: [], values: [] };
        let bytes = 0;
        while (i < todo.length && bytes < SLICE_BYTES) {
          const [k, v] = todo[i++];
          const n = bytesOf(v);
          b.keys.push(k);
          b.values.push(copyOf(v, transfer));
          bytes += n;
          const kind = k.slice(0, k.indexOf(':'));
          this.stats.kinds[kind] = (this.stats.kinds[kind] ?? 0) + n / 1e6;
        }
        bundles.push(b);
        this.stats.puts += b.keys.length;
        this.stats.writeMB += bytes / 1e6;
        this.stats.writeMs += performance.now() - t0;
      }
      const a = await ask(
        {
          op: 'write',
          build: this.build,
          scope: this.scope,
          bundles,
          maxScopes: MAX_SCOPES,
        },
        transfer,
      );
      if (!a.ok) this.stats.off = 'write failed';
      this.stats.writeMs = Math.round(this.stats.writeMs);
      this.stats.writeMB = Math.round(this.stats.writeMB * 10) / 10;
      for (const k in this.stats.kinds)
        this.stats.kinds[k] = Math.round(this.stats.kinds[k] * 10) / 10;
      this.stats.flushed = true;
    })();
  }
}

let global: GenCache | undefined;

/** The entries every stage shares (the crop cards): one per page. */
export function globalGenCache(): GenCache {
  return (global ??= new GenCache('global'));
}

/**
 * Plain objects (numbers, strings, booleans, nested plain objects; scatter instances) as numbers + a string table,
 * so the cache clones a few typed arrays instead of every object. `unpackObjects` gives back objects with the same
 * keys in the same order and the same values (a number is stored as a float64: exact).
 */
export interface PackedObjects {
  /** Per object: its shape (index into `shapes`). */
  shape: Uint16Array;
  /** Shapes: `key:type` lists, type n(umber) s(tring) b(oolean) u(ndefined) o<shape> (nested object). */
  shapes: string[][];
  strings: string[];
  values: Float64Array;
}

export function packObjects(list: readonly object[]): PackedObjects | null {
  const shapeIds = new Map<string, number>();
  const shapes: string[][] = [];
  const stringIds = new Map<string, number>();
  const strings: string[] = [];
  const values: number[] = [];
  const shape = new Uint16Array(list.length);
  const add = (o: Record<string, unknown>): number => {
    const parts: string[] = [];
    for (const k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      const v = o[k];
      let t: string;
      if (typeof v === 'number') {
        t = 'n';
        values.push(v);
      } else if (typeof v === 'string') {
        t = 's';
        let id = stringIds.get(v);
        if (id === undefined) stringIds.set(v, (id = strings.push(v) - 1));
        values.push(id);
      } else if (typeof v === 'boolean') {
        t = 'b';
        values.push(v ? 1 : 0);
      } else if (v === undefined) t = 'u';
      else if (
        v !== null &&
        typeof v === 'object' &&
        Object.getPrototypeOf(v) === Object.prototype
      ) {
        const s = add(v as Record<string, unknown>);
        if (s < 0) return -1;
        t = `o${s}`;
      } else return -1;
      parts.push(`${k}:${t}`);
    }
    const sig = parts.join(',');
    let id = shapeIds.get(sig);
    if (id === undefined) {
      if (shapes.length >= 65535) return -1;
      shapeIds.set(sig, (id = shapes.push(parts) - 1));
    }
    return id;
  };
  for (let i = 0; i < list.length; i++) {
    const s = add(list[i] as Record<string, unknown>);
    if (s < 0) return null; // something not packable: not cached
    shape[i] = s;
  }
  return { shape, shapes, strings, values: Float64Array.from(values) };
}

export function unpackObjects<T>(p: PackedObjects): T[] {
  const { strings, values } = p;
  // Per shape: [key, type] with type 0 number, 1 string, 2 boolean, 3 undefined, 4 + s nested object of shape s.
  const shapes = p.shapes.map((parts) =>
    parts.map((part) => {
      const c = part.lastIndexOf(':');
      const t = part.slice(c + 1);
      const code =
        t === 'n'
          ? 0
          : t === 's'
            ? 1
            : t === 'b'
              ? 2
              : t === 'u'
                ? 3
                : 4 + Number(t.slice(1));
      return [part.slice(0, c), code] as const;
    }),
  );
  let at = 0;
  // Values are stored depth first in key order, as `packObjects` met them.
  const make = (s: number): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, t] of shapes[s]) {
      if (t === 0) o[k] = values[at++];
      else if (t === 1) o[k] = strings[values[at++]];
      else if (t === 2) o[k] = values[at++] === 1;
      else if (t === 3) o[k] = undefined;
      else o[k] = make(t - 4);
    }
    return o;
  };
  const out = new Array<T>(p.shape.length);
  for (let i = 0; i < p.shape.length; i++) out[i] = make(p.shape[i]) as T;
  return out;
}
