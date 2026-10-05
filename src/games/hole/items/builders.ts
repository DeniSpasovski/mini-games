import type { BufferGeometry } from 'three';
import { getItem } from './catalog';
import { BUILDING_BUILDERS } from './build-buildings';
import { SMALL_BUILDERS, type Builder } from './build-small';
import { VEHICLE_BUILDERS } from './build-vehicles';
import { LANDMARK_BUILDERS } from './build-landmarks';
import { PLUSH_BUILDERS, plushBuilder } from './build-plush';
import { animalBuilder } from './build-animals';
import { NATURE_BUILDERS } from './build-nature';
import { ZOO_BUILDERS } from './build-zoo';
import { TOY_BUILDERS } from './build-toys';
import { TOYVEH_BUILDERS } from './build-toyveh';
import { Mesher } from './kit';

const BUILDERS: Record<string, Builder> = {
  ...SMALL_BUILDERS,
  ...VEHICLE_BUILDERS,
  ...BUILDING_BUILDERS,
  ...TOY_BUILDERS,
  ...TOYVEH_BUILDERS,
  ...LANDMARK_BUILDERS,
  ...PLUSH_BUILDERS,
  ...NATURE_BUILDERS,
  ...ZOO_BUILDERS,
};

/** plush_<family>_<size> ids share one parametric rig. */
function plushFamily(id: string): string | null {
  const m = /^plush_([a-z_]+?)_(xs|s|m|l|xl|xxl)$/.exec(id);
  return m ? m[1] : null;
}
function resolveBuilder(id: string): Builder | undefined {
  if (BUILDERS[id]) return BUILDERS[id];
  const animal = animalBuilder(id);
  if (animal) return (BUILDERS[id] = animal);
  const fam = plushFamily(id);
  if (fam) {
    try {
      return (BUILDERS[id] = plushBuilder(fam));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const cache = new Map<string, BufferGeometry>();

export function hasBuilder(id: string): boolean {
  return !!resolveBuilder(id);
}

/** Procedural geometry of an item variant (cached; shared by every instance). */
export function buildItemGeometry(id: string, variant = 0): BufferGeometry {
  const key = `${id}#${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const info = getItem(id);
  const b = resolveBuilder(id);
  if (!b) throw new Error(`no builder for item "${id}"`);
  const m = new Mesher();
  const prev = Mesher.decoplanar;
  Mesher.decoplanar = info.map === 'toy';
  try {
    b(m, variant % info.variants, info.w, info.d, info.h);
  } finally {
    Mesher.decoplanar = prev;
  }
  const g = m.build();
  cache.set(key, g);
  return g;
}

/** Triangle count of a built geometry. */
export function triCount(g: BufferGeometry): number {
  return g.getAttribute('position').count / 3;
}
