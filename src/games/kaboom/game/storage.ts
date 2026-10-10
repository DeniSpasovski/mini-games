/** Storage-like subset so settings and stats can be tested in node. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage when available (private mode / blocked storage throw), otherwise an in-memory store. */
export function defaultStorage(): KV {
  try {
    const s = window.localStorage;
    const k = '__kaboom_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return memoryStorage();
  }
}

export function memoryStorage(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}
