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
  spriteKeep,
  spriteRole,
  stepFade,
  type FadeState,
} from '../../src/games/rally/trees/draw';
import { treeUniforms } from '../../src/games/rally/trees/materials';
import {
  LEAF_STYLES,
  spriteAtlas,
  styleKind,
} from '../../src/games/rally/trees/leaftex';
import { HeightGrid, Horizon } from '../../src/games/rally/trees/occlusion';
import {
  placeTree,
  treeColliders,
} from '../../src/games/rally/trees/placement';
import { buildSkeleton } from '../../src/games/rally/trees/skeleton';
import {
  FOREST_REACH,
  NEAR_SPRITES,
  ROAD_REACH,
  SPECIES,
  speciesOfType,
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
    const def = getSpecies('Pine');
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
    const def = getSpecies('Pine');
    expect(a.scale).toBeGreaterThanOrEqual(def.scale[0]);
    expect(a.scale).toBeLessThanOrEqual(def.scale[1]);
  });

  test("the map's scale multiplies the species' size", () => {
    const a = placeTree('petralica', 42, 'pine_tree');
    const b = placeTree('petralica', 42, 'pine_tree', 0.5);
    expect(b.scale).toBeCloseTo(a.scale * 0.5, 6);
  });

  // Each map tree type looks like the tree its map describes (spec trees/Species.md#types).
  test('every tree type has the shape the map data describes', () => {
    const v = (asset: string) => {
      const def = speciesOfType(asset);
      return { def, info: generateVariant(def, 0).info };
    };
    const ratio = (asset: string) => {
      const { info } = v(asset);
      return info.height / (2 * info.radius);
    };
    const lum = (hex: string) =>
      [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) /
      765;
    // Columnar poplar and juniper; spreading walnut and willow; a pine taller than wide.
    expect(ratio('poplar_tree')).toBeGreaterThan(2.5);
    expect(ratio('juniper')).toBeGreaterThan(1.1);
    expect(ratio('cypress_tree')).toBeGreaterThan(2.5);
    expect(ratio('pine_tree')).toBeGreaterThan(1.3);
    // The plantation pine is the pine's cone grown cheaper: as tall and narrow, with fewer sprites and limbs.
    expect(ratio('plantation_pine')).toBeGreaterThan(1.3);
    expect(v('plantation_pine').info.height).toBeGreaterThan(
      v('pine_tree').info.height * 0.8,
    );
    expect(
      generateVariant(speciesOfType('plantation_pine'), 0).meshes.sprites.count,
    ).toBeLessThan(
      generateVariant(speciesOfType('pine_tree'), 0).meshes.sprites.count * 0.6,
    );
    expect(ratio('walnut_tree')).toBeLessThan(1);
    expect(ratio('willow_tree')).toBeLessThan(0.8);
    // Black pine: a bare trunk under an umbrella crown (its lowest crown point in the top third).
    const bp = v('black_pine').info;
    expect(bp.crown.c[1] - bp.crown.r[1]).toBeGreaterThan(bp.height * 0.6);
    // Pale-barked birch and plane, white against the oak's brown.
    for (const pale of ['birch_tree', 'pale_tree'])
      expect(lum(v(pale).def.bark.color)).toBeGreaterThan(
        lum(v('oak_tree').def.bark.color) + 0.3,
      );
    // Conifers wear needles, the rest leaves; the thicket is in autumn colours (red over green).
    for (const c of [
      'pine_tree',
      'plantation_pine',
      'black_pine',
      'juniper',
      'cypress_tree',
    ])
      expect(v(c).def.foliage.kind).toBe('needles');
    for (const c of [
      'oak_tree',
      'poplar_tree',
      'willow_tree',
      'bush',
      'locust_tree',
      'bramble_shrub',
    ])
      expect(v(c).def.foliage.kind).toBe('broadleaf');
    for (const hex of v('thicket_shrub').def.foliage.palette)
      expect(parseInt(hex.slice(1, 3), 16)).toBeGreaterThan(
        parseInt(hex.slice(3, 5), 16) - 20,
      );
    // Sizes: shrubs and junipers are low; the fruit tree is smaller than the oak; the poplar is the tallest.
    for (const low of ['bush', 'scrub_bush', 'juniper', 'bramble_shrub'])
      expect(v(low).info.height).toBeLessThan(4);
    expect(v('fruit_tree').info.height).toBeLessThan(
      v('oak_tree').info.height * 0.7,
    );
    expect(v('poplar_tree').info.height).toBeGreaterThan(
      v('oak_tree').info.height * 1.4,
    );
    // The cypress is a tall dark column under the poplar; the locust a mid-size light tree.
    expect(v('cypress_tree').info.height).toBeGreaterThan(7);
    expect(v('cypress_tree').info.height).toBeLessThan(
      v('poplar_tree').info.height,
    );
    expect(lum(v('cypress_tree').def.foliage.palette[0])).toBeLessThan(0.25);
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
    for (const asset of [
      'bush',
      'scrub_bush',
      'thicket_shrub',
      'hazelnut_tree',
      'juniper',
      'bramble_shrub',
    ])
      expect(at(asset)).toEqual([]);
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
    expect(selectLevel(0.0349, 1, T, 0.15, 300)).toBe(2);
    expect(selectLevel(0.036, 2, T, 0.15, 300)).toBe(2);
    expect(selectLevel(0.0402, 2, T, 0.15, 300)).toBe(2);
    expect(selectLevel(0.0404, 2, T, 0.15, 300)).toBe(1);
    expect(selectLevel(0.02, 0, T, 0.15, 300)).toBe(2);
  });

  test('LOD0 branches only in the full-detail zone, with its hysteresis margin', () => {
    // A tall tree just past 40 m: LOD0 keeps LOD0 up to 40 m x 1.15, LOD1 goes back only inside 40 m.
    expect(selectLevel(0.5, 0, T, 0.15, 45)).toBe(0);
    expect(selectLevel(0.5, 0, T, 0.15, 47)).toBe(1);
    expect(selectLevel(0.5, 1, T, 0.15, 41)).toBe(1);
    expect(selectLevel(0.5, 1, T, 0.15, 39)).toBe(0);
  });

  test('default thresholds: a 15 m tree at 60 deg is LOD1 past 40 m and an impostor at ~370 m', () => {
    const px = 1 / (2 * Math.tan(Math.PI / 6));
    const at = (d: number) => selectLevel((15 * px) / d, 0, T, 0, d);
    expect([at(39), at(41), at(365), at(375)]).toEqual([0, 1, 1, 2]);
  });

  test('within 40 m always LOD0, whatever the projected height', () => {
    expect(selectLevel(0.0001, 2, T, 0.15, 39)).toBe(0);
    expect(selectLevel(0.0001, 2, T, 0.15, 41)).toBe(2);
  });

  test('the first row keeps LOD0 and its full sprite share out to its own, longer reach', () => {
    expect(ROAD_REACH.full).toBeGreaterThan(FOREST_REACH.full);
    const mid = (FOREST_REACH.full + ROAD_REACH.full) / 2;
    // A forest tree is LOD1 there, a first-row tree still LOD0 (sprites + branches: no drop in detail at 40 m).
    expect(selectLevel(0.5, 0, T, 0.15, mid)).toBe(1);
    expect(selectLevel(0.5, 0, T, 0.15, mid, ROAD_REACH.full)).toBe(0);
    expect(
      selectLevel(0.5, 1, T, 0.15, ROAD_REACH.full + 1, ROAD_REACH.full),
    ).toBe(1);
    // The sprite share holds NEAR_SPRITES to the reach and eases to the far share over its ramp.
    const keep = (d: number, r = FOREST_REACH) =>
      spriteKeep(Infinity, d, 1, 0.5, r);
    expect(keep(FOREST_REACH.full)).toBeCloseTo(NEAR_SPRITES, 5);
    expect(keep(mid)).toBeLessThan(NEAR_SPRITES);
    expect(keep(mid, ROAD_REACH)).toBeCloseTo(NEAR_SPRITES, 5);
    const far = treeUniforms.tlFar.value.x;
    expect(keep(ROAD_REACH.full + ROAD_REACH.ramp, ROAD_REACH)).toBeCloseTo(
      far,
      5,
    );
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

  test('the sprite atlases: 4-8 cluster images, each cut to a 6-8 vertex outline around its opaque texels', () => {
    for (const style of LEAF_STYLES) {
      const a = spriteAtlas(style);
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
        // Smaller than the full square, but not empty (a spray lies along x: a third of it or more).
        expect(Math.abs(area / 2)).toBeLessThan(0.95);
        expect(Math.abs(area / 2)).toBeGreaterThan(0.15);
      }
    }
  });

  test.each(SPECIES.map((s) => [s.name, s] as const))(
    '%s: its leaf style is one of the atlases and matches its foliage kind',
    (_n, def: SpeciesDef) => {
      expect(LEAF_STYLES).toContain(def.foliage.leaf);
      expect(styleKind(def.foliage.leaf)).toBe(def.foliage.kind);
    },
  );

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
    const { LessEqualDepth } = await import('three');
    for (const mat of [
      m.barkMaterial('furrowed'),
      m.treeDepthMaterial(true),
      m.treeDepthMaterial(false),
    ]) {
      expect(mat.transparent).toBe(false);
      expect(mat.depthTest).toBe(true);
      expect(mat.depthWrite).toBe(true);
    }
    // Prepass on (the default off touch devices): the prepass writes depth, the lit sprites shade where it is not
    // behind (less-or-equal, offset toward the camera: never EQUAL, it blinked), both opaque and on the same program.
    m.setSpritePrepass(true);
    const lit = m.spriteMaterial('ovate');
    const pre = m.spritePrepassMaterial('ovate');
    expect(lit.depthFunc).toBe(LessEqualDepth);
    expect(lit.polygonOffset).toBe(true);
    expect(lit.depthWrite).toBe(false);
    expect(lit.transparent).toBe(false);
    expect(pre.depthWrite).toBe(true);
    expect(pre.colorWrite).toBe(false);
    expect(pre.alphaTest).toBe(m.ALPHA_TEST);
    expect(pre.customProgramCacheKey()).toBe(lit.customProgramCacheKey());
    // Prepass off (debug toggle / failed load check): the normal depth test, writing depth.
    m.setSpritePrepass(false);
    expect(lit.depthFunc).toBe(LessEqualDepth);
    expect(lit.polygonOffset).toBe(false);
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
