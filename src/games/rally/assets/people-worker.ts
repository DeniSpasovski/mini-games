import { withLooks } from './builders/people';
import { PEOPLE_BUILDERS } from './people-builders';
import { toWire, type WirePart } from './people-wire';

/** People worker: builds the detailed levels of a person off the main thread (people-pool.ts), geometry only. */

export interface PersonRequest {
  id: number;
  asset: string;
  seed: number;
  variant: number;
  lod: number;
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

scope.onmessage = (e) => {
  const { id, asset, seed, variant, lod } = e.data;
  try {
    const built = withLooks(() =>
      PEOPLE_BUILDERS[asset]({ seed, variant, lod }),
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
