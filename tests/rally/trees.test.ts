import { describe, expect, test } from '@rstest/core';
import { checkBudget, summarize } from '../../src/games/rally/game/tree-bench';
import { derive } from '../../src/games/rally/trees/grammar';
import {
  hashText,
  tcos,
  tsin,
  TreeRng,
} from '../../src/games/rally/trees/math';
import {
  MAX_FADES,
  selectLevel,
  spriteRole,
  stepFade,
  type FadeState,
} from '../../src/games/rally/trees/draw';
import { spriteAtlas } from '../../src/games/rally/trees/leaftex';
import { HeightGrid, Horizon } from '../../src/games/rally/trees/occlusion';
import {
  placeTree,
  treeColliders,
} from '../../src/games/rally/trees/placement';
import { buildSkeleton } from '../../src/games/rally/trees/skeleton';
import {
  SPECIES,
  TREE_TYPES,
  getSpecies,
  speciesHash,
  type SpeciesDef,
} from '../../src/games/rally/trees/species';
import {
  generateVariant,
  variantSeed,
} from '../../src/games/rally/trees/variants';

/** Procedural L-system trees: the pure stages (grammar, skeleton, meshing, placement) run in node. */
describe('trees', () => {
  test('the PRNG and trig are fixed integer / polynomial code', () => {
    const r = new TreeRng(12345);
    expect([r.u32(), r.u32(), r.u32()]).toEqual([
      new TreeRng(12345).u32(),
      (() => {
        const q = new TreeRng(12345);
        q.u32();
        return q.u32();
      })(),
      (() => {
        const q = new TreeRng(12345);
        q.u32();
        q.u32();
        return q.u32();
      })(),
    ]);
    for (let x = -20; x <= 20; x += 0.37) {
      expect(Math.abs(tsin(x) - Math.sin(x))).toBeLessThan(1e-8);
      expect(Math.abs(tcos(x) - Math.cos(x))).toBeLessThan(1e-8);
    }
  });

  test.each(SPECIES.map((s) => [s.name, s] as const))(
    '%s: same seed, same skeleton; other seed, other tree',
    (_n, def: SpeciesDef) => {
      const a = buildSkeleton(derive(def, variantSeed(def, 0)), def);
      const b = buildSkeleton(derive(def, variantSeed(def, 0)), def);
      const c = buildSkeleton(derive(def, variantSeed(def, 1)), def);
      const h = (x: unknown) => hashText(JSON.stringify(x));
      expect(h(a)).toBe(h(b));
      expect(h(a)).not.toBe(h(c));
      expect(a.segments.length).toBeGreaterThan(50);
      expect(a.segments.length).toBeLessThanOrEqual(def.segmentCap);
      expect(a.leaves.length).toBeGreaterThan(50);
    },
  );

  test.each(SPECIES.map((s) => [s.name, s] as const))(
    '%s: radii taper, priorities nest',
    (_n, def: SpeciesDef) => {
      const sk = buildSkeleton(derive(def, variantSeed(def, 2)), def);
      for (const s of sk.segments) {
        expect(s.r0).toBeGreaterThanOrEqual(s.r1 - 1e-9);
        if (s.parent < 0) continue;
        const p = sk.segments[s.parent];
        expect(p.r1).toBeGreaterThanOrEqual(s.r0 - 1e-9);
        expect(p.priority).toBeGreaterThan(s.priority);
      }
    },
  );

  test.each(SPECIES.map((s) => [s.name, s] as const))(
    '%s: LOD1 is the trunk and first-order limbs of LOD0; one sprite per leaf point (capped)',
    (_n, def: SpeciesDef) => {
      const sk = buildSkeleton(derive(def, variantSeed(def, 3)), def);
      const { meshes } = generateVariant(def, 3);
      const [s0, s1] = meshes.segments;
      expect(s1).toBeLessThanOrEqual(s0);
      // LOD1 keeps only trunk and first-order limb segments.
      expect(s1).toBeLessThanOrEqual(
        sk.segments.filter((s) => s.order <= 1).length,
      );
      expect(s1).toBeGreaterThan(0);
      expect(meshes.sprites.count).toBe(
        Math.min(sk.leaves.length, def.maxSprites),
      );
      expect(meshes.sprites.count).toBeGreaterThan(30);
    },
  );

  test('a species change gives new variant seeds', () => {
    const def = getSpecies('Conifer');
    const changed = { ...def, angle: def.angle + 1 };
    expect(speciesHash(changed)).not.toBe(speciesHash(def));
    expect(variantSeed(changed, 0)).not.toBe(variantSeed(def, 0));
  });

  test('every tree type maps to a species', () => {
    for (const s of Object.values(TREE_TYPES))
      expect(getSpecies(s)).toBeTruthy();
  });

  test('placement is a function of the stage id and the placement index', () => {
    const a = placeTree('petralica', 42, 'pine_tree');
    expect(placeTree('petralica', 42, 'pine_tree')).toEqual(a);
    expect(placeTree('jackie', 42, 'pine_tree')).not.toEqual(a);
    const def = getSpecies('Conifer');
    expect(a.scale).toBeGreaterThanOrEqual(def.scale[0]);
    expect(a.scale).toBeLessThanOrEqual(def.scale[1]);
  });

  test('conifers and broadleaves collide on their trunk; shrubs are drive-through', () => {
    const at = (asset: string) =>
      treeColliders({
        asset,
        variant: 0,
        x: 10,
        y: 2,
        z: -5,
        rotY: 0.7,
        scale: 1.2,
      });
    for (const asset of ['pine_tree', 'oak_tree']) {
      const cs = at(asset);
      expect(cs.length).toBeGreaterThan(0);
      // The lowest capsule stands on the ground at the tree.
      const low = cs.reduce((m, c) => (c.y < m.y ? c : m));
      expect(low.kind).toBe('capsule');
      expect(Math.hypot(low.a![0] - 10, low.a![2] + 5)).toBeLessThan(0.01);
      expect(low.a![1]).toBeCloseTo(2, 5);
    }
    expect(at('bush')).toEqual([]);
  });
});

describe('tree LOD transitions', () => {
  // Branch thresholds: LOD0 -> LOD1 at 7 %, LOD1 -> impostor at 3.5 % of the screen height.
  const T = [0.07, 0.035];
  const settled = (level: number): FadeState => ({
    from: level,
    to: level,
    fade: 1,
    dir: 1,
  });

  test('hysteresis: coarser below a threshold, finer only 15% above it', () => {
    expect(selectLevel(0.0699, 0, T, 0.15, 300)).toBe(1);
    expect(selectLevel(0.072, 1, T, 0.15, 300)).toBe(1);
    expect(selectLevel(0.0804, 1, T, 0.15, 300)).toBe(1);
    expect(selectLevel(0.0806, 1, T, 0.15, 300)).toBe(0);
    expect(selectLevel(0.02, 0, T, 0.15, 300)).toBe(2);
  });

  test('default thresholds: a 15 m tree at 60 deg goes LOD1 at ~185 m and impostor at ~370 m', () => {
    const px = 1 / (2 * Math.tan(Math.PI / 6));
    const at = (d: number) => selectLevel((15 * px) / d, 0, T, 0, d);
    expect([at(180), at(190), at(365), at(375)]).toEqual([0, 1, 1, 2]);
  });

  test('within 60 m always LOD0, whatever the projected height', () => {
    expect(selectLevel(0.0001, 2, T, 0.15, 59)).toBe(0);
    expect(selectLevel(0.0001, 2, T, 0.15, 61)).toBe(2);
  });

  test('sprites stay solid between branch levels and fade only against the impostor', () => {
    expect(spriteRole({ from: 0, to: 0, fade: 1, dir: 1 })).toBe(0);
    expect(spriteRole({ from: 0, to: 1, fade: 0.4, dir: 1 })).toBe(0);
    expect(spriteRole({ from: 1, to: 2, fade: 0.4, dir: 1 })).toBe(1);
    expect(spriteRole({ from: 2, to: 1, fade: 0.4, dir: 1 })).toBe(2);
    expect(spriteRole({ from: 2, to: 2, fade: 1, dir: 1 })).toBe(-1);
  });

  test('a fade runs a fixed time, whatever the frame rate', () => {
    for (const dt of [1 / 30, 1 / 144]) {
      const st = settled(0);
      let t = 0;
      stepFade(st, 1, false, dt, 0.3);
      while (st.from !== st.to) {
        t += dt;
        stepFade(st, 1, false, dt, 0.3);
      }
      expect(st.to).toBe(1);
      expect(Math.abs(t + dt - 0.3)).toBeLessThan(dt * 1.01);
    }
  });

  test('changing back reverses from the current value; a third level waits', () => {
    const st = settled(1);
    stepFade(st, 2, false, 0.1, 0.3);
    const f = st.fade;
    expect(st).toMatchObject({ from: 1, to: 2 });
    stepFade(st, 1, false, 0.05, 0.3);
    expect(st.fade).toBeCloseTo(f - 0.05 / 0.3, 6);
    expect(st).toMatchObject({ from: 1, to: 2, dir: -1 });
    // Level 3 requested mid-fade: the running fade goes on.
    stepFade(st, 3, false, 0.01, 0.3);
    expect(st).toMatchObject({ from: 1, to: 2, dir: -1 });
    for (let i = 0; i < 20; i++) stepFade(st, 1, false, 0.05, 0.3);
    expect(st).toMatchObject({ from: 1, to: 1 });
  });

  test('a culled tree / one coming into view takes its level at once', () => {
    const st = settled(3);
    expect(stepFade(st, 0, true, 0.016, 0.3)).toBe(false);
    expect(st).toMatchObject({ from: 0, to: 0 });
  });
});

describe('tree benchmark summary', () => {
  test('average, 1% low (99th percentile) and worst frame time', () => {
    const times = [...Array(100).keys()].map((i) =>
      i === 99 ? 50 : i === 98 ? 30 : 10,
    );
    const r = summarize(true, times, [4, 6]);
    expect(r.avgMs).toBeCloseTo(10.6, 5);
    expect(r.low1Ms).toBe(50);
    expect(r.worstMs).toBe(50);
    expect(r.treeGpuMs).toBe(5);
  });
});

describe('tree performance rules (trees/Performance.md#mitigations)', () => {
  test.each(SPECIES.map((s) => [s.name, s] as const))(
    '%s: LOD0 branches and the crown stay under their caps in every variant',
    (_n, def: SpeciesDef) => {
      for (let v = 0; v < (def.variants ?? 8); v++) {
        const m = generateVariant(def, v).meshes;
        expect(m.levels[0].index.length / 3).toBeLessThanOrEqual(
          def.maxBranchTriangles,
        );
        expect(m.sprites.count).toBeLessThanOrEqual(def.maxSprites);
      }
    },
  );

  test('the sprite atlas: 4-8 cluster images, each cut to a 6-8 vertex outline around its opaque texels', () => {
    for (const kind of ['needles', 'broadleaf'] as const) {
      const a = spriteAtlas(kind);
      expect(a.outlines.length).toBeGreaterThanOrEqual(4);
      expect(a.outlines.length).toBeLessThanOrEqual(8);
      for (const o of a.outlines) {
        expect(o.length).toBeGreaterThanOrEqual(6);
        expect(o.length).toBeLessThanOrEqual(8);
        let area = 0;
        for (let i = 0; i < o.length; i++) {
          const [x0, y0] = o[i];
          const [x1, y1] = o[(i + 1) % o.length];
          area += x0 * y1 - x1 * y0;
        }
        // Smaller than the full square, but not empty.
        expect(Math.abs(area / 2)).toBeLessThan(0.95);
        expect(Math.abs(area / 2)).toBeGreaterThan(0.2);
      }
    }
  });

  test('without a free fade slot a settled tree keeps its level, then gets a full fade', () => {
    const st: FadeState = { from: 1, to: 1, fade: 1, dir: 1 };
    stepFade(st, 2, false, 0.05, 0.3, false);
    expect(st).toMatchObject({ from: 1, to: 1 });
    stepFade(st, 2, false, 0.05, 0.3, true);
    expect(st).toMatchObject({ from: 1, to: 2 });
    expect(st.fade).toBeCloseTo(0.05 / 0.3, 6);
    expect(MAX_FADES).toBe(32);
  });

  test('a benchmark over budget is a failing result', () => {
    const run = (trees: boolean, avg: number, low: number, select = 0) => ({
      trees,
      frames: 10,
      avgMs: avg,
      low1Ms: low,
      worstMs: low,
      treeGpuMs: 0,
      selectMs: select,
    });
    expect(
      checkBudget([run(true, 5.5, 8, 0.05), run(false, 5, 7.5)], 300).pass,
    ).toBe(true);
    const bad = checkBudget([run(true, 7, 12, 0.3), run(false, 5, 7.5)], 900);
    expect(bad.pass).toBe(false);
    expect(bad.failures.length).toBe(4);
  });
});

describe('tree drawing (trees/Drawing.md)', () => {
  test('every tree material is opaque, depth-tested and depth-writing (the prepass pairing aside)', async () => {
    const m = await import('../../src/games/rally/trees/materials');
    const { EqualDepth, LessEqualDepth } = await import('three');
    for (const mat of [
      m.barkMaterial('furrowed'),
      m.treeDepthMaterial(true),
      m.treeDepthMaterial(false),
    ]) {
      expect(mat.transparent).toBe(false);
      expect(mat.depthTest).toBe(true);
      expect(mat.depthWrite).toBe(true);
    }
    // Prepass on (the default): the prepass writes depth, the lit sprites shade where it is EQUAL, both opaque and
    // on the same program (same cache key), so their depths match.
    m.setSpritePrepass(true);
    const lit = m.spriteMaterial('broadleaf', 1);
    const pre = m.spritePrepassMaterial('broadleaf', 1);
    expect(lit.depthFunc).toBe(EqualDepth);
    expect(lit.depthWrite).toBe(false);
    expect(lit.transparent).toBe(false);
    expect(pre.depthWrite).toBe(true);
    expect(pre.colorWrite).toBe(false);
    expect(pre.alphaTest).toBe(m.ALPHA_TEST);
    expect(pre.customProgramCacheKey()).toBe(lit.customProgramCacheKey());
    // Prepass off (debug toggle / failed load check): the normal depth test, writing depth.
    m.setSpritePrepass(false);
    expect(lit.depthFunc).toBe(LessEqualDepth);
    expect(lit.depthWrite).toBe(true);
    m.setSpritePrepass(true);
  });
});

describe('tree terrain occlusion (trees/occlusion.ts)', () => {
  const bounds = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
  // A 60 m high ridge across x = 300..340, flat ground elsewhere.
  const ridge = (x: number) => (x > 300 && x < 340 ? 60 : 0);
  const horizon = (move: number) => {
    const h = new Horizon(
      new HeightGrid((x) => ridge(x), bounds),
      { x: 0, y: 2, z: 0 },
      move,
      1700,
    );
    while (!h.step(128));
    return h;
  };

  test('a tree behind a high ridge is hidden, one in front of it or above it is not', () => {
    const h = horizon(9);
    expect(h.hides(800, 8, 0, 6)).toBe(true);
    expect(h.hides(200, 8, 0, 6)).toBe(false);
    // Far enough that its top clears the ridge's sight line.
    expect(h.hides(800, 400, 0, 6)).toBe(false);
    // To the side, where the ridge does not reach the sight line (the ridge spans every z, so look backwards).
    expect(h.hides(-800, 8, 0, 6)).toBe(false);
  });

  test('conservative: a bigger camera window hides less, never more', () => {
    const near = horizon(2);
    const far = horizon(40);
    let a = 0;
    let b = 0;
    for (let x = 360; x < 1600; x += 20)
      for (const y of [0, 20, 60, 120]) {
        const hn = near.hides(x, y, 30, 8);
        const hf = far.hides(x, y, 30, 8);
        if (hf) expect(hn).toBe(true);
        a += hn ? 1 : 0;
        b += hf ? 1 : 0;
      }
    expect(a).toBeGreaterThan(b);
  });
});
