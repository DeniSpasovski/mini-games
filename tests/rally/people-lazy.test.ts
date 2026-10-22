import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import {
  ASSET_CATALOG,
  getAssetMeta,
} from '../../src/games/rally/assets/catalog';
import { withLooks } from '../../src/games/rally/assets/builders/people';
import { buildAsset, variantSeed } from '../../src/games/rally/assets/library';
import { fromWire, toWire } from '../../src/games/rally/assets/people-wire';
import { PEOPLE_BUILDERS } from '../../src/games/rally/assets/people-builders';
import {
  BuildQueue,
  evictions,
  type Held,
} from '../../src/games/rally/world/build-queue';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * The detailed levels of a person (`LodSpec.lazy`) are built in a worker that has no materials: parts carry a look,
 * the main thread attaches the material. The worker's geometry must be the one the normal build makes, and the
 * variants the load skips must not bring a material (a shader to compile) the warm ones lack.
 */
const lazy = ASSET_CATALOG.filter((a) => a.lods.some((l) => l.lazy));

const looksOf = (id: string, variant: number, lod: number) =>
  withLooks(() =>
    PEOPLE_BUILDERS[id]({ seed: variantSeed(id, variant), variant, lod }),
  );

describe('people in the worker', () => {
  test('every lazy asset has a worker builder', () => {
    for (const a of lazy) expect(PEOPLE_BUILDERS[a.id]).toBeDefined();
  });

  test.each([
    ['spectator', 0, 0],
    ['spectator', 6, 1],
    ['spectator', 42, 0],
    ['mechanic', 5, 1],
    ['visitor', 17, 0],
  ])(
    '%s %i at LOD %i: the worker round trip gives the same parts',
    (id, v, lod) => {
      const direct = buildAsset(id, variantSeed(id, v), v, lod);
      const looks = looksOf(id, v, lod);
      expect(looks.parts.length).toBe(direct.parts.length);
      looks.parts.forEach((p, i) => {
        const g = fromWire(
          toWire(p.geometry, p.material as unknown as string, []),
        );
        const d = direct.parts[i].geometry;
        expect(Object.keys(g.attributes).sort()).toEqual(
          Object.keys(d.attributes).sort(),
        );
        for (const name of Object.keys(d.attributes))
          expect(Array.from(g.getAttribute(name).array)).toEqual(
            Array.from(d.getAttribute(name).array),
          );
        expect(g.index ? Array.from(g.index.array) : null).toEqual(
          d.index ? Array.from(d.index.array) : null,
        );
      });
    },
  );

  test('variants the load skips add no material: every one looks like a warm variant', () => {
    for (const meta of lazy) {
      const warm = meta.warm ?? [0];
      for (let lod = 0; lod < meta.lods.length; lod++) {
        if (!meta.lods[lod].lazy) continue;
        // What a shader depends on: the kind of material and the attributes of each part.
        const kind = (v: number) =>
          looksOf(meta.id, v, lod)
            .parts.map(
              (p) =>
                `${String(p.material).split('|')[0]}:${Object.keys(p.geometry.attributes).sort().join('+')}`,
            )
            .join(' ');
        const seen = new Set(warm.map(kind));
        for (let v = 0; v < meta.variants; v++)
          expect(seen, `${meta.id} variant ${v} at LOD ${lod}`).toContain(
            kind(v),
          );
      }
    }
  });

  test('warm variants exist', () => {
    for (const meta of lazy)
      for (const v of meta.warm ?? [0])
        expect(v).toBeLessThan(getAssetMeta(meta.id).variants);
  });
});

describe('BuildQueue', () => {
  const want = (key: string, slack: number) => ({
    key,
    asset: 'spectator',
    variant: 0,
    lod: 1,
    slack,
  });

  test('the level nearest to being needed comes first, and only what a finished rebuild asked for waits', () => {
    const q = new BuildQueue();
    q.want(want('a', 40));
    q.want(want('b', -5));
    q.want(want('c', 10));
    expect(q.size).toBe(0);
    q.swap();
    expect(q.size).toBe(3);
    expect(q.next(Infinity)!.key).toBe('b');
    expect(q.next(-10)).toBeNull();
    q.done(q.next(Infinity)!);
    expect(q.next(Infinity)!.key).toBe('c');
    // The next rebuild no longer asks for a / c: they are out of range.
    q.want(want('d', 1));
    q.swap();
    expect(q.size).toBe(1);
    expect(q.next(Infinity)!.key).toBe('d');
  });

  test('a level asked for twice keeps the smallest slack', () => {
    const q = new BuildQueue();
    q.want(want('a', 30));
    q.want(want('a', 12));
    q.want(want('a', 50));
    q.swap();
    expect(q.next(Infinity)!.slack).toBe(12);
  });
});

describe('evictions', () => {
  const held = (key: string, used: number, idle = true, bytes = 10): Held => ({
    key,
    bytes,
    used,
    idle,
  });

  test('nothing goes while the built levels fit the budget', () => {
    expect(evictions([held('a', 0), held('b', 1)], 500, 100, 60)).toEqual([]);
  });

  test('over budget: idle levels unused for the grace period go, the least recently used first, down to 3/4 of the budget', () => {
    const all = [
      held('recent', 95),
      held('busy', 0, false),
      held('old1', 5),
      held('old2', 1),
      held('old3', 3),
      held('old4', 2),
    ];
    // 60 bytes over a budget of 40: down to 30 means three go.
    expect(evictions(all, 100, 40, 60)).toEqual(['old2', 'old4', 'old3']);
  });

  test('a level in use or used within the grace period is never dropped, even over budget', () => {
    expect(
      evictions(
        [held('busy', 0, false, 100), held('new', 90, true, 100)],
        100,
        10,
        60,
      ),
    ).toEqual([]);
  });
});
