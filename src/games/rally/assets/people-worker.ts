import type { WirePart } from './people-wire';

/** People worker: builds the detailed levels of a person off the main thread (people-pool.ts), geometry only. */

export interface PersonRequest {
  id: number;
  asset: string;
  seed: number;
  variant: number;
  lod: number;
  /** A builder's own extra input (plain data). */
  params?: unknown;
}

export interface PersonResult {
  id: number;
  parts?: WirePart[];
  error?: string;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<PersonRequest>) => void) | null;
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
};

// The builders' base bodies fetch their mesh file while their module loads (engine/people-base.data.ts), and a message
// that reaches a module worker before its top-level code has finished finds no handler: so the handler is set first and
// the builders come in through a dynamic import.
const modules = Promise.all([
  import('./builders/people'),
  import('./people-builders'),
  import('./people-wire'),
]);

scope.onmessage = async (e) => {
  const { id, asset, seed, variant, lod, params } = e.data;
  try {
    const [{ withLooks }, { PEOPLE_BUILDERS }, { toWire }] = await modules;
    const built = withLooks(() =>
      PEOPLE_BUILDERS[asset]({ seed, variant, lod, params }),
    );
    const buffers: ArrayBuffer[] = [];
    const parts = built.parts.map((p) =>
      toWire(p.geometry, p.material as unknown as string, buffers),
    );
    const result: PersonResult = { id, parts };
    scope.postMessage(result, [...new Set(buffers)]);
  } catch (err) {
    // The main thread builds it inline (people-pool.ts), where the error surfaces.
    scope.postMessage({ id, error: String(err) } satisfies PersonResult, []);
  }
};
