import { DoubleSide, Group, Mesh, MeshLambertMaterial } from 'three';
import { COLORS } from '../map/generate';
import { coastRadius, insideIsland, type MapData } from '../map/types';
import { buildCityDecor } from './city-decor';
import { createGroundMaterial } from './materials';
import { Soup } from './soup';
import { buildWater } from './water';

export { WATER_Y } from './water';

/**
 * Ground + water for a map: grass with a checker, sand ring, coast skirt, then
 * every GroundRect (roads, sidewalks, lots), the sea and the dressing (`city-decor.ts`). All ground
 * uses the stencil-cut material, so the hole opens through everything. `group.userData.animate(seconds)`
 * moves the water; the game and the map viewer call it every frame.
 */
export function buildGround(map: MapData): Group {
  const group = new Group();
  const n = map.coast.length;
  const ground = new Soup();
  const skirt = new Soup();

  // grass fan + sand ring + skirt
  const at = (i: number, inset: number): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    const r = coastRadius(map.coast, a) - inset;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, z0] = at(i, 0);
    const [x1, z1] = at(j, 0);
    const [sx0, sz0] = at(i, map.beachWidth);
    const [sx1, sz1] = at(j, map.beachWidth);
    ground.tri([0, 0, 0], [sx1, 0, sz1], [sx0, 0, sz0], COLORS.grass);
    // sand band
    ground.tri(
      [sx0, 0.008, sz0],
      [sx1, 0.008, sz1],
      [x1, 0.008, z1],
      COLORS.sand,
    );
    ground.tri(
      [sx0, 0.008, sz0],
      [x1, 0.008, z1],
      [x0, 0.008, z0],
      COLORS.sand,
    );
    // skirt (outer wall of the island)
    skirt.tri([x0, 0.008, z0], [x1, 0.008, z1], [x1, -2.6, z1], COLORS.sand);
    skirt.tri([x0, 0.008, z0], [x1, -2.6, z1], [x0, -2.6, z0], COLORS.skirt);
  }
  // grass checker (10 m squares) gives a sense of speed and scale
  const size = 10;
  const R = Math.max(...map.coast);
  for (let gx = -Math.ceil(R / size); gx < Math.ceil(R / size); gx++)
    for (let gz = -Math.ceil(R / size); gz < Math.ceil(R / size); gz++) {
      if ((gx + gz) % 2 === 0) continue;
      const x0 = gx * size;
      const z0 = gz * size;
      const corners = [
        [x0, z0],
        [x0 + size, z0],
        [x0, z0 + size],
        [x0 + size, z0 + size],
      ];
      if (
        corners.every(([x, z]) =>
          insideIsland(map.coast, x, z, map.beachWidth + 1),
        )
      )
        ground.flat(x0, z0, x0 + size, z0 + size, 0.004, COLORS.grassAlt);
    }
  for (const r of map.rects) ground.flat(r.x0, r.z0, r.x1, r.z1, r.y, r.color);

  const groundMesh = new Mesh(ground.geometry(), createGroundMaterial());
  groundMesh.receiveShadow = true;
  group.add(groundMesh);
  const skirtMesh = new Mesh(
    skirt.geometry(),
    new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
  );
  group.add(skirtMesh);

  // sea (animated ripples + breathing foam) and the dressing: curbs, roundabouts, decals, rocks, pier
  const water = buildWater(map);
  group.add(water.group, buildCityDecor(map));
  group.userData.animate = water.animate;
  return group;
}
