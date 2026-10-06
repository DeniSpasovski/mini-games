import { describe, expect, rs, test } from '@rstest/core';
import { MeshBasicMaterial, Vector3 } from 'three';
import { ALL_MAPS } from '../../src/games/rally/maps';
import { TerrainRenderer } from '../../src/games/rally/world/terrain-renderer';
import { RENDER_MARGIN, World } from '../../src/games/rally/world/world';

// The real terrain material draws its textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/world/terrain-material', () => ({
  getTerrainMaterial: () => new MeshBasicMaterial(),
  setGroundTint: () => {},
}));

interface Tile {
  cx: number;
  cz: number;
  span: number;
}

/** Chunk "cx,cz" -> how many tiles cover it. */
function coverage(terrain: TerrainRenderer): Map<string, number> {
  const tiles = (terrain as unknown as { tiles: Map<number, Tile> }).tiles;
  const n = new Map<string, number>();
  for (const t of tiles.values())
    for (let j = 0; j < t.span; j++)
      for (let i = 0; i < t.span; i++) {
        const k = `${t.cx + i},${t.cz + j}`;
        n.set(k, (n.get(k) ?? 0) + 1);
      }
  return n;
}

describe('terrain tiles', () => {
  const world = new World(ALL_MAPS.find((m) => m.id === 'test')!);
  const cs = world.heightfield.chunkSize;
  const b = world.map.bounds;
  const vd = 1200;

  test('far chunks merge; the view is covered exactly once, also after moving', () => {
    const terrain = new TerrainRenderer(world, {
      viewDistance: vd,
      lodDistances: [100, 250, 500],
    });
    const focus = new Vector3();
    for (const x of [0, 300, 700]) {
      focus.x = x;
      for (let i = 0; i < 50 && !terrain.update(focus, 1e9); i++);
      expect(terrain.pending).toBe(0);
      const cover = coverage(terrain);
      for (const n of cover.values()) expect(n).toBe(1);
      // No holes: every chunk in range and inside the map (+ margin) is drawn.
      const x0 = Math.max(
        Math.floor((b.minX - RENDER_MARGIN) / cs),
        Math.floor((x - vd) / cs),
      );
      const x1 = Math.min(
        Math.floor((b.maxX + RENDER_MARGIN) / cs),
        Math.floor((x + vd) / cs),
      );
      const z0 = Math.max(
        Math.floor((b.minZ - RENDER_MARGIN) / cs),
        Math.floor(-vd / cs),
      );
      const z1 = Math.min(
        Math.floor((b.maxZ + RENDER_MARGIN) / cs),
        Math.floor(vd / cs),
      );
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          const dx = Math.max(cx * cs - x, 0, x - (cx + 1) * cs);
          const dz = Math.max(cz * cs, 0, -(cz + 1) * cs);
          if (Math.hypot(dx, dz) <= vd)
            expect(cover.get(`${cx},${cz}`)).toBe(1);
        }
      expect(terrain.chunkCount).toBeLessThan(cover.size / 2);
    }
    terrain.dispose();
  });
});
