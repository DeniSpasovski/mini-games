/**
 * Saved replays in IndexedDB (`rally-replays`): store `meta` (small, listed by the menus) and store `data` (the file
 * bytes, read only to play). Every finished run is kept as an **auto save**; the player can name one (a **named save**).
 * Nothing is evicted: past `REPLAY_SOFT_LIMIT` the menus ask the player to delete auto saves (`autoDeleteIds`, bests
 * kept by default). Every call fails soft (private mode, quota, blocked): a run is never lost for a replay.
 */
import { RELEASE_BUILD } from '../../../../shared/release';
import { readHeader } from './codec';
import type { ReplayHeader } from './format';

/**
 * Replays are dev-only for now (the dev server and `npm run build:test`): the release build records nothing and shows
 * no replay entry point (results button, Stage times list, `?replay=`, F2 buttons). The repo's one release switch.
 */
export const REPLAYS_ENABLED = !RELEASE_BUILD;

const DB = 'rally-replays';
const VERSION = 1;
/** Saved replays (all stages) from which the menus ask the player to delete some (~20-90 KB each). Saving goes on. */
export const REPLAY_SOFT_LIMIT = 1000;
/** Longest replay name (characters). */
export const NAME_MAX = 40;

export interface ReplayMeta {
  /** `<stage>:<date>` */
  id: string;
  stage: string;
  car: string;
  date: number;
  time?: number;
  stageVer: number;
  carVer: number;
  bytes: number;
  header: ReplayHeader;
  /** A named save; absent / null / empty = an auto save. */
  name?: string | null;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) {
          const m = db.createObjectStore('meta', { keyPath: 'id' });
          m.createIndex('stage', 'stage');
        }
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export const replayId = (h: ReplayHeader): string => `${h.stage}:${h.date}`;

export const isNamed = (m: ReplayMeta): boolean =>
  typeof m.name === 'string' && m.name.length > 0;

/** A player's replay name: one line, trimmed, at most NAME_MAX characters; empty = none (an auto save). */
export function cleanName(raw: string): string | null {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return n || null;
}

/** Personal bests: the fastest finished run per stage, car and times versions (as the times lists them). */
export function bestIds(list: readonly ReplayMeta[]): Set<string> {
  const best = new Map<string, ReplayMeta>();
  for (const m of list) {
    if (m.time === undefined) continue;
    const k = `${m.stage}|${m.car}|${m.stageVer}|${m.carVer}`;
    const b = best.get(k);
    if (!b || m.time < b.time!) best.set(k, m);
  }
  return new Set([...best.values()].map((m) => m.id));
}

/** "Delete auto saves": every auto save, except personal bests when `keepBests`. Named saves are never in it. */
export function autoDeleteIds(
  list: readonly ReplayMeta[],
  keepBests = true,
): string[] {
  const bests = keepBests ? bestIds(list) : new Set<string>();
  return list.filter((m) => !isNamed(m) && !bests.has(m.id)).map((m) => m.id);
}

export interface ReplayTotals {
  count: number;
  bytes: number;
  named: number;
  /** At or past REPLAY_SOFT_LIMIT: the menus show the notice. */
  full: boolean;
}

export function replayTotals(list: readonly ReplayMeta[]): ReplayTotals {
  let bytes = 0;
  let named = 0;
  for (const m of list) {
    bytes += m.bytes;
    if (isNamed(m)) named++;
  }
  return {
    count: list.length,
    bytes,
    named,
    full: list.length >= REPLAY_SOFT_LIMIT,
  };
}

/** Bytes of the given ids. */
export const bytesOf = (
  list: readonly ReplayMeta[],
  ids: readonly string[],
): number => {
  const set = new Set(ids);
  return list.reduce((s, m) => s + (set.has(m.id) ? m.bytes : 0), 0);
};

let persistAsked = false;

/** Ask once per page that the browser never evicts the site's storage under pressure (replays are the player's). */
function askPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    /* not offered */
  }
}

/** The origin's used / quota bytes, where the browser tells. */
export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** Save a finished run's replay as an auto save (never evicts anything). False when storage is unavailable. */
export async function saveReplay(file: Uint8Array): Promise<boolean> {
  try {
    const db = await open();
    if (!db) return false;
    const h = readHeader(file);
    const meta: ReplayMeta = {
      id: replayId(h),
      stage: h.stage,
      car: h.car,
      date: h.date,
      time: h.time,
      stageVer: h.stageVer,
      carVer: h.carVer,
      bytes: file.length,
      header: h,
    };
    const tx = db.transaction(['meta', 'data'], 'readwrite');
    tx.objectStore('meta').put(meta);
    tx.objectStore('data').put(file, meta.id);
    await txDone(tx);
    askPersist();
    return true;
  } catch (e) {
    console.warn('replay: not saved', e);
    return false;
  }
}

/** Saved replays (of one stage, or all), newest first. */
export async function listReplays(stage?: string): Promise<ReplayMeta[]> {
  try {
    const db = await open();
    if (!db) return [];
    const store = db.transaction('meta').objectStore('meta');
    const all = (await done(
      stage ? store.index('stage').getAll(stage) : store.getAll(),
    )) as ReplayMeta[];
    return all.sort((a, b) => b.date - a.date);
  } catch {
    return [];
  }
}

export async function loadReplay(id: string): Promise<Uint8Array | null> {
  try {
    const db = await open();
    if (!db) return null;
    const v = await done(db.transaction('data').objectStore('data').get(id));
    return v instanceof Uint8Array
      ? v
      : v
        ? new Uint8Array(v as ArrayBuffer)
        : null;
  } catch {
    return null;
  }
}

export async function deleteReplays(ids: readonly string[]): Promise<void> {
  try {
    const db = await open();
    if (!db || !ids.length) return;
    const tx = db.transaction(['meta', 'data'], 'readwrite');
    for (const id of ids) {
      tx.objectStore('meta').delete(id);
      tx.objectStore('data').delete(id);
    }
    await txDone(tx);
  } catch {
    /* nothing to do */
  }
}

export const deleteReplay = (id: string): Promise<void> => deleteReplays([id]);

/** Name a replay (a named save) or clear the name (back to an auto save). False when it failed. */
export async function renameReplay(id: string, raw: string): Promise<boolean> {
  try {
    const db = await open();
    if (!db) return false;
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const m = (await done(store.get(id))) as ReplayMeta | undefined;
    if (!m) return false;
    store.put({ ...m, name: cleanName(raw) });
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

/** A pasted / loaded replay waiting for the page that plays it (key `pending` in `data`). */
export async function stashPending(file: Uint8Array): Promise<boolean> {
  try {
    const db = await open();
    if (!db) return false;
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(file, 'pending');
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}
