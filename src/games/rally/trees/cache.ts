import type { ImpostorPixels } from './impostor';
import type { VariantMeshes } from './mesh';
import type { TreeVariantInfo } from './variants';

/**
 * On-disk cache of generated variants (spec: trees/Placement.md#caching): IndexedDB, keyed by `cacheKey` = species
 * name + content hash, variant seed and generator version, so a change to any of them regenerates. Entries of a
 * species that no longer match its keys are dropped at load. No IndexedDB (node, private mode): no cache.
 */
export interface CachedVariant {
  info: TreeVariantInfo;
  meshes: VariantMeshes;
  impostor: ImpostorPixels;
}

const DB = 'rally-trees';
const STORE = 'variants';
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (db) return db;
  db = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
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

export async function getCached(
  key: string,
): Promise<CachedVariant | undefined> {
  const d = await open();
  if (!d) return undefined;
  return request<CachedVariant>(
    d.transaction(STORE).objectStore(STORE).get(key),
  );
}

export async function putCached(key: string, v: CachedVariant): Promise<void> {
  const d = await open();
  if (!d) return;
  await request(
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(v, key),
  );
}

/** Drop cached variants of `species` (key prefix `<name>:`) whose key is not in `keep`. */
export async function pruneCached(
  species: string,
  keep: Set<string>,
): Promise<void> {
  const d = await open();
  if (!d) return;
  const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
  const keys = (await request(store.getAllKeys())) ?? [];
  for (const k of keys)
    if (typeof k === 'string' && k.startsWith(`${species}:`) && !keep.has(k))
      store.delete(k);
}
