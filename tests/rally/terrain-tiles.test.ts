import { describe, expect, rs, test } from '@rstest/core';
import { type Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { ALL_MAPS, ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { TerrainRenderer } from '../../src/games/rally/world/terrain-renderer';
import { RENDER_MARGIN, World } from '../../src/games/rally/world/world';

// The real terrain material draws its textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/world/terrain-material', () => ({
  getTerrainMaterial: () => new MeshBasicMaterial(),
  setGroundTint: () => {},
  setGroundMoisture: () => {},
}));

interface Tile {
  cx: number;
  cz: number;
  span: number;
  lod: number;
  mesh: Mesh;
}

type Lods = [number, number, number];

const tilesOf = (terrain: TerrainRenderer): Map<number, Tile> =>
  (terrain as unknown as { tiles: Map<number, Tile> }).tiles;

function settle(terrain: TerrainRenderer, focus: Vector3, budget = 1e9): void {
  for (let i = 0; i < 5000 && !terrain.update(focus, budget); i++);
  expect(terrain.pending).toBe(0);
}

/**
 * The streamer before tiles merged per detail band (fresh start): chunk -> LOD, and its tile count. It merged
 * 2 x 2 chunks at LOD2 and 4 x 4 at LOD3, and only where the block lies inside the map.
 */
function unmerged(
  world: World,
  f: Vector3,
  vd: number,
  t: Lods,
): { lods: Map<string, number>; tiles: number } {
  const cs = world.heightfield.chunkSize;
  const b = world.map.bounds;
  const x0 = Math.floor((b.minX - RENDER_MARGIN) / cs);
  const x1 = Math.floor((b.maxX + RENDER_MARGIN) / cs);
  const z0 = Math.floor((b.minZ - RENDER_MARGIN) / cs);
  const z1 = Math.floor((b.maxZ + RENDER_MARGIN) / cs);
  const cx0 = Math.max(x0, Math.floor((f.x - vd) / cs));
  const cx1 = Math.min(x1, Math.floor((f.x + vd) / cs));
  const cz0 = Math.max(z0, Math.floor((f.z - vd) / cs));
  const cz1 = Math.min(z1, Math.floor((f.z + vd) / cs));
  const lods = new Map<string, number>();
  let tiles = 0;
  const visit = (cx: number, cz: number, span: number): void => {
    const dx = Math.max(cx * cs - f.x, 0, f.x - (cx + span) * cs);
    const dz = Math.max(cz * cs - f.z, 0, f.z - (cz + span) * cs);
    const d = Math.hypot(dx, dz);
    if (d > vd) return;
    if (span === 1) {
      if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) return;
      lods.set(`${cx},${cz}`, d < t[0] ? 0 : d < t[1] ? 1 : d < t[2] ? 2 : 3);
      tiles++;
      return;
    }
    const lod = span === 2 ? 2 : 3;
    const inMap =
      cx >= x0 && cx + span - 1 <= x1 && cz >= z0 && cz + span - 1 <= z1;
    if (inMap && d >= t[lod - 1] * 1.1) {
      for (let j = 0; j < span; j++)
        for (let i = 0; i < span; i++) lods.set(`${cx + i},${cz + j}`, lod);
      tiles++;
      return;
    }
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        visit(cx + (i * span) / 2, cz + (j * span) / 2, span / 2);
  };
  for (let bz = Math.floor(cz0 / 4); bz <= Math.floor(cz1 / 4); bz++)
    for (let bx = Math.floor(cx0 / 4); bx <= Math.floor(cx1 / 4); bx++)
      visit(bx * 4, bz * 4, 4);
  return { lods, tiles };
}

/** Chunk "cx,cz" -> LOD of the tile covering it. */
function chunkLods(terrain: TerrainRenderer): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tilesOf(terrain).values())
    for (let j = 0; j < t.span; j++)
      for (let i = 0; i < t.span; i++)
        out.set(`${t.cx + i},${t.cz + j}`, t.lod);
  return out;
}

/** Chunk "cx,cz" -> how many tiles cover it. */
function coverage(terrain: TerrainRenderer): Map<string, number> {
  const n = new Map<string, number>();
  for (const t of tilesOf(terrain).values())
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

  const FOCI: [number, number][] = [
    [0, 0],
    [300, 200],
    [-300, -350],
  ];

  test('merging never makes a chunk coarser and needs fewer tiles', () => {
    for (const lods of [
      [100, 250, 500],
      [60, 150, 300],
    ] as Lods[]) {
      for (const [x, z] of FOCI) {
        const focus = new Vector3(x, 0, z);
        const terrain = new TerrainRenderer(world, {
          viewDistance: vd,
          lodDistances: lods,
        });
        settle(terrain, focus);
        const now = chunkLods(terrain);
        const before = unmerged(world, focus, vd, lods);
        for (const [k, lod] of before.lods) {
          const [cx, cz] = k.split(',').map(Number);
          const dx = Math.max(cx * cs - x, 0, x - (cx + 1) * cs);
          const dz = Math.max(cz * cs - z, 0, z - (cz + 1) * cs);
          if (Math.hypot(dx, dz) > vd) continue; // only drawn as part of a merged tile
          expect(now.get(k), k).toBeLessThanOrEqual(lod);
        }
        expect(terrain.chunkCount).toBeLessThan(before.tiles);
        terrain.dispose();
      }
    }
  });

  test('the big stages merge up to 8 x 8 chunks', () => {
    const { map, stage } = ALL_STAGE_DEFS.find(
      (d) => d.stage.id === 'ajvatovci',
    )!;
    const big = new World(map, stage);
    const road = big.stageRoad.at(big.stageRoad.length / 2);
    const focus = new Vector3(road.x, road.y, road.z);
    const lods: Lods = [160, 520, 1100];
    const terrain = new TerrainRenderer(big, {
      viewDistance: 2400,
      lodDistances: lods,
    });
    settle(terrain, focus);
    const spans = new Set([...tilesOf(terrain).values()].map((t) => t.span));
    expect(spans.has(8)).toBe(true);
    const before = unmerged(big, focus, 2400, lods);
    expect(terrain.chunkCount).toBeLessThan(before.tiles * 0.7);
    const now = chunkLods(terrain);
    for (const [k, lod] of before.lods)
      if (now.has(k)) expect(now.get(k), k).toBeLessThanOrEqual(lod);
    terrain.dispose();
  });

  test('a merged tile holds the same vertices as its chunks at that LOD', () => {
    const terrain = new TerrainRenderer(world, {
      viewDistance: vd,
      lodDistances: [60, 150, 300],
    });
    settle(terrain, new Vector3());
    const build = terrain as unknown as {
      buildGeometry(
        cx: number,
        cz: number,
        span: number,
        lod: number,
      ): Mesh['geometry'];
    };
    const seen = new Set<string>();
    for (const t of tilesOf(terrain).values()) {
      const id = `${t.span}:${t.lod}`;
      if (t.span === 1 || seen.has(id)) continue;
      seen.add(id);
      const step = 2 ** t.lod;
      const q = 64 / step; // vertex intervals per chunk
      const n = t.span * q + 1;
      const g = t.mesh.geometry;
      for (let j = 0; j < t.span; j++)
        for (let i = 0; i < t.span; i++) {
          const c = build.buildGeometry(t.cx + i, t.cz + j, 1, t.lod);
          for (let v = 0; v <= q; v++)
            for (let u = 0; u <= q; u++) {
              const a = (j * q + v) * n + i * q + u;
              const b = v * (q + 1) + u;
              expect(g.attributes.position.getY(a)).toBe(
                c.attributes.position.getY(b),
              );
              for (const axis of ['getX', 'getY', 'getZ'] as const)
                expect(g.attributes.normal[axis](a)).toBeCloseTo(
                  c.attributes.normal[axis](b),
                  5,
                );
              for (const axis of ['getX', 'getY', 'getZ', 'getW'] as const)
                expect(g.attributes.splat[axis](a)).toBe(
                  c.attributes.splat[axis](b),
                );
            }
        }
    }
    expect(seen.size).toBeGreaterThan(1);
    terrain.dispose();
  });

  test('big tiles sampled across several updates equal the one-shot build', () => {
    const opts = { viewDistance: vd, lodDistances: [100, 250, 500] as Lods };
    const whole = new TerrainRenderer(world, opts);
    settle(whole, new Vector3());
    const sliced = new TerrainRenderer(world, opts);
    let calls = 0;
    while (!sliced.update(new Vector3(), 0) && calls < 5000) calls++;
    expect(calls).toBeGreaterThan(1);
    const names = (t: TerrainRenderer) =>
      new Map([...tilesOf(t).values()].map((x) => [x.mesh.name, x.mesh]));
    const a = names(whole);
    const b = names(sliced);
    expect(b.size).toBe(a.size);
    for (const [name, mesh] of a) {
      const other = b.get(name)!;
      for (const attr of ['position', 'normal', 'splat'])
        expect(Array.from(other.geometry.attributes[attr].array), name).toEqual(
          Array.from(mesh.geometry.attributes[attr].array),
        );
    }
    whole.dispose();
    sliced.dispose();
  });
});
