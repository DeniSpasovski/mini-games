/// <reference lib="webworker" />
/**
 * The IndexedDB side of world/gen-cache.ts, off the page's thread: reads a scope's bundles (and hands their buffers
 * over without a copy), writes new bundles, prunes other builds and old scopes. Store `bundles`: key
 * `<build>|<scope>|#<id>` -> `{ keys, values }`; store `scopes`: `<build>|<scope>` -> last load (ms since 1970).
 */
import type { GenCacheRequest, GenCacheAnswer } from './gen-cache';

const DB = 'rally-gen'; // = DB_NAME in gen-cache.ts
const BUNDLES = 'bundles';
const SCOPES = 'scopes';

let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (db) return db;
  db = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(BUNDLES);
        req.result.createObjectStore(SCOPES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

function request<T>(r: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}

function done(t: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    t.oncomplete = () => resolve(true);
    t.onerror = () => resolve(false);
    t.onabort = () => resolve(false);
  });
}

/** Every ArrayBuffer under `v` (transferred to the page, not copied). */
function buffers(v: unknown, out: Set<ArrayBuffer>): Set<ArrayBuffer> {
  if (ArrayBuffer.isView(v)) {
    if (v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  } else if (Array.isArray(v)) for (const x of v) buffers(x, out);
  else if (v && typeof v === 'object')
    for (const x of Object.values(v)) buffers(x, out);
  return out;
}

async function read(build: string, scope: string): Promise<GenCacheAnswer> {
  const d = await open();
  if (!d) return { ok: false };
  const prefix = `${build}|${scope}|`;
  const t = d.transaction([BUNDLES, SCOPES], 'readwrite');
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const bundles = await request(t.objectStore(BUNDLES).getAll(range));
  if (!bundles) return { ok: false };
  t.objectStore(SCOPES).put(Date.now(), `${build}|${scope}`);
  return { ok: true, bundles };
}

async function write(
  build: string,
  scope: string,
  bundles: { keys: string[]; values: unknown[] }[],
  maxScopes: number,
): Promise<GenCacheAnswer> {
  const d = await open();
  if (!d) return { ok: false };
  const t = d.transaction([BUNDLES, SCOPES], 'readwrite');
  const store = t.objectStore(BUNDLES);
  const id = Date.now().toString(36);
  bundles.forEach((b, i) => store.put(b, `${build}|${scope}|#${id}-${i}`));
  t.objectStore(SCOPES).put(Date.now(), `${build}|${scope}`);
  if (!(await done(t))) return { ok: false };
  await prune(d, build, maxScopes);
  return { ok: true };
}

/** Delete other builds' bundles and all but the `maxScopes` most recently loaded stages of this one (+ its global). */
async function prune(d: IDBDatabase, build: string, maxScopes: number) {
  const t = d.transaction([BUNDLES, SCOPES], 'readwrite');
  const scopes = t.objectStore(SCOPES);
  const [keys, used] = await Promise.all([
    request(scopes.getAllKeys()),
    request(scopes.getAll()),
  ]);
  if (!keys || !used) return;
  const mine = keys
    .map((k, i) => [String(k), used[i] as number] as const)
    .filter(([k]) => k.startsWith(`${build}|`) && k !== `${build}|global`)
    .sort((a, b) => b[1] - a[1]);
  const keep = new Set([
    ...mine.slice(0, maxScopes).map(([k]) => k),
    `${build}|global`,
  ]);
  const store = t.objectStore(BUNDLES);
  for (const k of keys.map(String)) {
    if (keep.has(k)) continue;
    scopes.delete(k);
    store.delete(IDBKeyRange.bound(`${k}|`, `${k}|￿`));
  }
  // Every other build's bundles: keys before or after this build's range.
  store.delete(IDBKeyRange.upperBound(`${build}|`, true));
  store.delete(IDBKeyRange.lowerBound(`${build}|￿`, true));
  await done(t);
}

self.onmessage = async (e: MessageEvent<GenCacheRequest>) => {
  const m = e.data;
  let a: GenCacheAnswer;
  try {
    a =
      m.op === 'read'
        ? await read(m.build, m.scope)
        : await write(m.build, m.scope, m.bundles, m.maxScopes);
  } catch {
    a = { ok: false };
  }
  (self as unknown as Worker).postMessage({ id: m.id, ...a }, [
    ...buffers(a.bundles, new Set()),
  ]);
};
