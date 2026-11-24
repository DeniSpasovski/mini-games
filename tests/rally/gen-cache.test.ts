import { describe, expect, rs, test } from '@rstest/core';
import { MeshBasicMaterial, Vector3 } from 'three';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import {
  type GenCache,
  packObjects,
  unpackObjects,
} from '../../src/games/rally/world/gen-cache';
import { TerrainRenderer } from '../../src/games/rally/world/terrain-renderer';
import { World } from '../../src/games/rally/world/world';

// The real terrain material draws its textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/world/terrain-material', () => ({
  getTerrainMaterial: () => new MeshBasicMaterial(),
  setGroundTint: () => {},
  setGroundMoisture: () => {},
  setCulvertHoles: () => {},
}));

/** The disk cache as the generators see it: what one load records, the next one takes (a structured clone between). */
function fakeCache(store: Map<string, unknown>, recording: boolean): GenCache {
  return {
    recording,
    take: (k: string) => {
      const v = store.get(k);
      return v === undefined ? undefined : structuredClone(v);
    },
    put: (k: string, v: unknown) => store.set(k, structuredClone(v)),
  } as unknown as GenCache;
}

describe('rally gen cache', () => {
  test('packed objects come back with the same keys, order and values', () => {
    const list = [
      {
        asset: 'pine',
        variant: 2,
        x: 1.5,
        y: -0,
        z: NaN,
        tree: { species: 'p', hue: 0.1 },
      },
      {
        asset: 'rock',
        variant: 0,
        x: 1e-300,
        near: true,
        extra: false,
        sx: undefined,
      },
      {
        asset: 'pine',
        variant: 3,
        x: -7,
        y: 2 ** 60,
        z: 0.1 + 0.2,
        tree: { species: 'q', hue: 0 },
      },
    ];
    const back = unpackObjects<Record<string, unknown>>(packObjects(list)!);
    expect(back.map((o) => Object.keys(o))).toEqual(
      list.map((o) => Object.keys(o)),
    );
    expect(back).toEqual(list);
    expect(Object.is(back[0].y, -0)).toBe(true);
    expect(packObjects([{ f: () => 0 }])).toBeNull();
  });

  test('scatter, heightfield and terrain tiles from the cache equal the generated ones', () => {
    const map = ALL_MAPS.find((m) => m.id === 'test')!;
    const store = new Map<string, unknown>();
    const load = (recording: boolean) => {
      const world = new World(map);
      const cache = fakeCache(store, recording);
      world.scatter.cache = cache;
      world.heightfield.cache = cache;
      const focus = world.spawn('start').position;
      const terrain = new TerrainRenderer(world, {
        viewDistance: 600,
        lodDistances: [120, 250, 450],
      });
      terrain.cache = cache;
      for (let i = 0; i < 5000 && !terrain.update(focus, 1e9); i++);
      const cs = world.scatter.chunkSize;
      const scatter: string[] = [];
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const c = world.scatter.chunk(
            Math.floor(focus.x / cs) + dx,
            Math.floor(focus.z / cs) + dz,
          );
          scatter.push(
            JSON.stringify(c.instances),
            JSON.stringify(c.colliders),
          );
        }
      const tiles = [
        ...(
          terrain as unknown as {
            tiles: Map<
              number,
              {
                mesh: {
                  geometry: {
                    attributes: Record<string, { array: ArrayLike<number> }>;
                  };
                };
              }
            >;
          }
        ).tiles,
      ]
        .sort((a, b) => a[0] - b[0])
        .map(([k, t]) => [
          k,
          ...['position', 'normal', 'splat'].map((n) =>
            Array.from(t.mesh.geometry.attributes[n].array),
          ),
        ]);
      const hf = world.heightfield.chunk(
        Math.floor(focus.x / cs),
        Math.floor(focus.z / cs),
      );
      return {
        scatter,
        tiles,
        hf: [
          Array.from(hf.heights),
          Array.from(hf.normals),
          Array.from(hf.splat),
        ],
      };
    };
    const made = load(true);
    expect([...store.keys()].some((k) => k.startsWith('s:'))).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith('h:'))).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith('t:'))).toBe(true);
    const read = load(false);
    expect(read.scatter).toEqual(made.scatter);
    expect(read.tiles).toEqual(made.tiles);
    expect(read.hf).toEqual(made.hf);
  });
});
