import type { CarDef, CarProfile } from './types';

/**
 * Put the centre of mass where the real car has it. A car file describes its model as baked (axles at the model's hubs,
 * hull, profile and door plate in the same frame); the front share of the weight is set by where the axles sit against
 * the COM (physics/vehicle.ts `buildWheels`). `dz` > 0 moves the axles and everything built on the model forward of the
 * COM (the COM sits further back, less weight on the front), `dz` < 0 the other way. Wheelbase and the model on its
 * wheels stay as they are.
 */
export function shiftCom(car: CarDef, dz: number): CarDef {
  const p = car.physics;
  const m = car.model;
  const g = m.gltf;
  return {
    ...car,
    physics: {
      ...p,
      front: { ...p.front, z: p.front.z + dz },
      rear: { ...p.rear, z: p.rear.z + dz },
      hull: p.hull?.map(([x, y, z, r]): [number, number, number, number] => [
        x,
        y,
        z + dz,
        r,
      ]),
    },
    model: {
      ...m,
      doorBadge: { ...m.doorBadge, z: m.doorBadge.z + dz },
      profile: m.profile && shiftProfile(m.profile, dz),
      gltf: g && {
        ...g,
        offset: [
          g.offset?.[0] ?? 0,
          g.offset?.[1] ?? 0,
          (g.offset?.[2] ?? 0) + dz,
        ],
      },
    },
  };
}

function shiftProfile(p: CarProfile, dz: number): CarProfile {
  const z = (o: number[]) => o.map((v, i) => (i % 2 === 0 ? v + dz : v));
  return {
    ...p,
    axles: [p.axles[0] + dz, p.axles[1] + dz],
    outline: z(p.outline),
    glass: z(p.glass),
  };
}
