import type { Material } from 'three';
import { getMaterial } from '../engine/materials';
import { bodySkinMaterial } from '../engine/people-skin-material';
import { PEOPLE_BUILDERS } from './people-builders';
import { fromWire } from './people-wire';
import type { PersonRequest, PersonResult } from './people-worker';
import type { BuiltAsset } from './types';
import { WorkerPool } from '../../../shared/worker-pool';

/** The material a look stands for (people.ts `withLooks`). */
function materialOf(look: string): Material {
  if (look === 'atlas') return getMaterial('people');
  if (look === 'flag') return getMaterial('people_flag');
  const [, model, ...tone] = look.split('|');
  return bodySkinMaterial(model as 'male' | 'female', tone.join('|'));
}

const pool = new WorkerPool<PersonResult>(
  () =>
    new Worker(new URL('./people-worker.ts', import.meta.url), {
      type: 'module',
    }),
  undefined,
  'people',
);

/** True when `requestPerson` can build `asset` (it is a person and a worker runs). */
export function canRequestPerson(asset: string): boolean {
  return asset in PEOPLE_BUILDERS && pool.available;
}

/**
 * Builds a level in a worker (people-worker.ts): the long builds (tens of ms each) never land in a frame and the load
 * does not wait for them. `done` gets it, or null when no worker could (then build it on this thread).
 */
export function requestPerson(
  asset: string,
  seed: number,
  variant: number,
  lod: number,
  done: (a: BuiltAsset | null) => void,
): void {
  const req: Omit<PersonRequest, 'id'> = { asset, seed, variant, lod };
  const sent = pool.post(req, [], (r) =>
    done(
      r?.parts
        ? {
            parts: r.parts.map((p) => ({
              geometry: fromWire(p),
              material: materialOf(p.look),
            })),
          }
        : null,
    ),
  );
  if (!sent) done(null);
}
