import { DoubleSide, Group, Mesh, MeshLambertMaterial } from 'three';
import {
  BIOMES,
  BIOME_COLORS,
  MUD_COLOR,
  SEA,
  WATER_COLOR,
  biomeCode,
} from '../map/animal/biomes';
import { coastRadius, insideIsland, type MapData } from '../map/types';
import { createGroundMaterial } from './materials';
import { Soup } from './soup';
import { buildWater } from './water';

const SAND = 0xe6d29a;
const SKIRT = 0x8b6f52;
/** Beach band width (m): the same as the generator. */
const BEACH = 14;

/**
 * Ground of Animal Island: a base fan coloured per coast segment, the biome cells (10 m, a checker of two
 * greens per biome) that lie inside the beach, the sand ring, flat rects (compound roads and pads), the
 * mud banks + water of rivers and ponds, the skirt and the sea. Everything uses the stencil-cut material, so
 * the hole opens through all of it; `userData.animate(seconds)` moves the sea.
 */
export function buildAnimalGround(map: MapData): Group {
  const group = new Group();
  const t = map.terrain!;
  const n = map.coast.length;
  const ground = new Soup();
  const skirt = new Soup();
  const at = (i: number, inset: number): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    const r = coastRadius(map.coast, a) - inset;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const colorAt = (x: number, z: number): number => {
    const code = biomeCode(t.biome, x, z);
    return BIOME_COLORS[BIOMES[code === SEA ? 0 : code]][0];
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, z0] = at(i, 0);
    const [x1, z1] = at(j, 0);
    const [sx0, sz0] = at(i, BEACH);
    const [sx1, sz1] = at(j, BEACH);
    const [mx, mz] = at(i, BEACH + 5);
    ground.tri([0, 0, 0], [sx1, 0, sz1], [sx0, 0, sz0], colorAt(mx, mz));
    ground.tri([sx0, 0.008, sz0], [sx1, 0.008, sz1], [x1, 0.008, z1], SAND);
    ground.tri([sx0, 0.008, sz0], [x1, 0.008, z1], [x0, 0.008, z0], SAND);
    skirt.tri([x0, 0.008, z0], [x1, 0.008, z1], [x1, -2.6, z1], SAND);
    skirt.tri([x0, 0.008, z0], [x1, -2.6, z1], [x0, -2.6, z0], SKIRT);
  }
  // biome cells inside the beach band (the base fan shows through the gaps at the coast)
  const b = t.biome;
  for (let iz = 0; iz < b.nz; iz++)
    for (let ix = 0; ix < b.nx; ix++) {
      const x0 = b.x0 + ix * b.cell;
      const z0 = b.z0 + iz * b.cell;
      const code = b.data[iz * b.nx + ix];
      if (code === SEA) continue;
      const corners: [number, number][] = [
        [x0, z0],
        [x0 + b.cell, z0],
        [x0, z0 + b.cell],
        [x0 + b.cell, z0 + b.cell],
      ];
      if (!corners.every(([x, z]) => insideIsland(map.coast, x, z, BEACH + 1)))
        continue;
      ground.flat(
        x0,
        z0,
        x0 + b.cell,
        z0 + b.cell,
        0.004,
        BIOME_COLORS[BIOMES[code]][(ix + iz) % 2],
      );
    }
  for (const r of map.rects) ground.flat(r.x0, r.z0, r.x1, r.z1, r.y, r.color);

  // rivers: a mud bank strip under a water strip, in 2 m pieces so the mouth stops at the coast
  const piece = 2;
  for (const rv of t.rivers)
    for (let k = 0; k + 1 < rv.pts.length; k++) {
      const [ax, az] = rv.pts[k];
      const [bx, bz] = rv.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / piece));
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let s = 0; s < steps; s++) {
        const p0 = s / steps;
        const p1 = (s + 1) / steps;
        const x0 = ax + (bx - ax) * p0;
        const z0 = az + (bz - az) * p0;
        const x1 = ax + (bx - ax) * p1;
        const z1 = az + (bz - az) * p1;
        if (!insideIsland(map.coast, (x0 + x1) / 2, (z0 + z1) / 2, -1))
          continue;
        for (const [hw, y, col] of [
          [rv.width / 2 + 2.2, 0.006, MUD_COLOR],
          [rv.width / 2, 0.009, WATER_COLOR],
        ] as const)
          ground.quad(
            [
              [x0 + nx * hw, z0 + nz * hw],
              [x1 + nx * hw, z1 + nz * hw],
              [x1 - nx * hw, z1 - nz * hw],
              [x0 - nx * hw, z0 - nz * hw],
            ],
            y,
            col,
          );
      }
    }
  for (const pd of t.ponds) {
    ground.disc(pd.x, pd.z, pd.r + 2.2, 0.006, MUD_COLOR, 24);
    ground.disc(pd.x, pd.z, pd.r, 0.009, WATER_COLOR, 24);
  }

  const groundMesh = new Mesh(ground.geometry(), createGroundMaterial());
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  group.add(
    new Mesh(
      skirt.geometry(),
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    ),
  );
  const water = buildWater(map);
  group.add(water.group);
  group.userData.animate = water.animate;
  return group;
}
