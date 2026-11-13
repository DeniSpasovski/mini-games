import { describe, expect, rs, test } from '@rstest/core';
import { Texture, type BufferGeometry } from 'three';
import {
  buildingFlat,
  houseDoor,
  housePitched,
  houseStone,
  houseWindows,
} from '../../src/games/rally/assets/builders/buildings';
import {
  getAssetMeta,
  HOUSE_WALL_FRACTION,
} from '../../src/games/rally/assets/catalog';
import {
  doorSlot,
  EAVE_MAX_DROP,
  eaveScale,
  FIX,
  HOUSE_PITCH,
  ROOF_SHARE,
  SLOT,
  SLOT_COLUMNS,
  slotAt,
  slotCount,
} from '../../src/games/rally/engine/house-walls';
import type { BuildingDef } from '../../src/games/rally/maps/shared/types';
import {
  BUILDING_SINK,
  buildingDoor,
  buildingInstance,
  buildingInstances,
  buildingWindows,
} from '../../src/games/rally/world/buildings';
import type { TerrainSampler } from '../../src/games/rally/world/heightfield';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * Box buildings are a unit footprint scaled per instance. The `fix` attribute carries what must NOT scale with it
 * (windows, eaves, chimney: metres, see engine/house-walls.ts), so every vertex needs a code the shader knows. The
 * windows and the door are instances of their own on the same building (world/buildings.ts `buildingInstances`).
 */
const BOXES = [
  { name: 'house_pitched', build: housePitched, variants: 8 },
  { name: 'house_stone', build: houseStone, variants: 4 },
  { name: 'building_flat', build: buildingFlat, variants: 8 },
];

const geometryOf = (b: ReturnType<typeof housePitched>): BufferGeometry => {
  expect(b.parts.length).toBe(1);
  return b.parts[0].geometry;
};
const tris = (g: BufferGeometry) => g.getAttribute('position').count / 3;

const house = (over: Partial<BuildingDef> = {}): BuildingDef => ({
  id: 3,
  x: 0,
  z: 0,
  w: 10,
  d: 8,
  angle: 0.4,
  h: 3.3,
  floors: 1,
  type: 'house',
  source: 'test',
  along: 0,
  ...over,
});
/** Ground rising `k` m per metre along the footprint's local (u, v) direction. */
const slope = (b: BuildingDef, ku: number, kv: number): TerrainSampler =>
  ({
    height: (x: number, z: number) => {
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      return ku * (c * x + s * z) + kv * (-s * x + c * z);
    },
  }) as TerrainSampler;

describe('box buildings', () => {
  test('roof share of the shader matches the catalog wall fraction', () => {
    expect(ROOF_SHARE).toBeCloseTo(1 - HOUSE_WALL_FRACTION, 6);
  });

  test.each(BOXES)('$name: fix codes, no openings in the box', (a) => {
    for (let variant = 0; variant < a.variants; variant++)
      for (const lod of [0, 1]) {
        const g = geometryOf(a.build({ seed: 7, variant, lod }));
        const fix = g.getAttribute('fix');
        expect(fix.itemSize).toBe(4);
        expect(fix.count).toBe(g.getAttribute('position').count);
        for (let i = 0; i < fix.count; i++) {
          const w = fix.getW(i);
          if (w >= 100) expect(w).toBeLessThanOrEqual(FIX.hipEndRidge);
          else expect(w).toBe(FIX.plain);
        }
      }
  });

  test('triangle budgets: the box, its windows, its door', () => {
    // Every house within 160 m runs all the variants of its box (variant set) in the colour and the shadow pass.
    for (const a of BOXES) {
      let set = 0;
      for (let variant = 0; variant < a.variants; variant++) {
        const near = tris(geometryOf(a.build({ seed: 7, variant, lod: 0 })));
        expect(near, `${a.name} ${variant}`).toBeLessThanOrEqual(180);
        expect(
          tris(geometryOf(a.build({ seed: 7, variant, lod: 1 }))),
        ).toBeLessThanOrEqual(48);
        set += near;
      }
      expect(set, a.name).toBeLessThanOrEqual(1000);
    }
    // Windows: 12 triangles each, every slot of the four walls per floor; drawn per variant, never in the shadow pass.
    const slots = 2 * (SLOT_COLUMNS.long + SLOT_COLUMNS.short);
    for (let variant = 0; variant < 4; variant++)
      expect(tris(geometryOf(houseWindows({ seed: 1, variant, lod: 0 })))).toBe(
        slots * 12 * (variant >= 2 ? 2 : 1),
      );
    const windows = getAssetMeta('house_windows').lods;
    expect(windows.length).toBe(1);
    expect(windows[0].castShadow).toBe(false);
    expect(windows[0].separateVariants).toBe(true);
    for (let variant = 0; variant < 4; variant++)
      expect(
        tris(geometryOf(houseDoor({ seed: 1, variant, lod: 0 }))),
      ).toBeLessThanOrEqual(30);
  });

  test('windows: slot codes within the columns built', () => {
    for (let variant = 0; variant < 4; variant++) {
      const fix = geometryOf(
        houseWindows({ seed: 1, variant, lod: 0 }),
      ).getAttribute('fix');
      const seen = new Set<number>();
      for (let i = 0; i < fix.count; i++) {
        const code = fix.getW(i) - 2;
        const kind = Math.floor(code / 16);
        const col = code % 16;
        expect(kind).toBeGreaterThanOrEqual(SLOT.alongX);
        expect(kind).toBeLessThanOrEqual(SLOT.frontGround);
        expect(col).toBeLessThan(
          kind === SLOT.alongZ ? SLOT_COLUMNS.short : SLOT_COLUMNS.long,
        );
        seen.add(code);
      }
      // Along x (back wall, upper floors), along z, the front wall's ground floor.
      expect(seen.size).toBe(2 * SLOT_COLUMNS.long + SLOT_COLUMNS.short);
    }
  });

  test('window slots on small and large walls', () => {
    const { long, short } = SLOT_COLUMNS;
    // Too short for a window, then one in the middle, then about one per pitch, spread evenly.
    expect(slotCount(2, long)).toBe(0);
    expect(slotAt(0, 2, long)).toBeNull();
    expect(slotCount(3, long)).toBe(1);
    expect(slotAt(0, 3, long)).toBeCloseTo(0);
    expect(slotCount(2 * HOUSE_PITCH, long)).toBe(2);
    expect(slotAt(0, 2 * HOUSE_PITCH, long)).toBeCloseTo(-0.25);
    expect(slotAt(1, 2 * HOUSE_PITCH, long)).toBeCloseTo(0.25);
    expect(slotAt(2, 2 * HOUSE_PITCH, long)).toBeNull();
    for (const length of [6, 9.5, 12, 17.3, 24]) {
      const n = slotCount(length, long);
      expect(Math.abs(length / n - HOUSE_PITCH)).toBeLessThan(1.1);
      for (let col = 0; col + 1 < n; col++)
        expect(
          (slotAt(col + 1, length, long)! - slotAt(col, length, long)!) *
            length,
        ).toBeCloseTo(length / n);
    }
    // A wall longer than its columns: they keep the pitch round the middle, the ends stay blank.
    for (const [length, cap] of [
      [40, long],
      [60, long],
      [17, short],
    ]) {
      expect(slotCount(length, cap)).toBe(cap);
      const first = slotAt(0, length, cap)! * length;
      const last = slotAt(cap - 1, length, cap)! * length;
      expect(first).toBeCloseTo(-last);
      expect(last - first).toBeCloseTo((cap - 1) * HOUSE_PITCH);
      expect(
        (slotAt(1, length, cap)! - slotAt(0, length, cap)!) * length,
      ).toBeCloseTo(HOUSE_PITCH);
    }
    // The door takes a column of the front wall (the middle one), also on a wall too short for a window.
    expect(doorSlot(2)).toEqual({ col: 0, u: 0 });
    expect(doorSlot(10).col).toBe(1);
    expect(doorSlot(10).u).toBeCloseTo(slotAt(1, 10, long)!);
    expect(doorSlot(40).u).toBeCloseTo(slotAt(4, 40, long)!);
  });

  test('eaves stay above the upper windows on narrow two-floor houses', () => {
    const windows = geometryOf(houseWindows({ seed: 1, variant: 2, lod: 0 }));
    const wp = windows.getAttribute('position');
    const wf = windows.getAttribute('fix');
    for (const variant of [4, 5]) {
      const g = geometryOf(housePitched({ seed: 7, variant, lod: 0 }));
      const p = g.getAttribute('position');
      const f = g.getAttribute('fix');
      for (const depth of [3.5, 4.5, 6, 8, 12]) {
        const walls = 6.2 + BUILDING_SINK;
        const height = walls / HOUSE_WALL_FRACTION;
        const k = eaveScale(height, depth, ROOF_SHARE);
        // (The shader's eave rule, engine/house-walls.ts `houseFix`.)
        let eave = Infinity;
        for (let i = 0; i < p.count; i++)
          if (f.getW(i) >= 100 && f.getZ(i) !== 0)
            eave = Math.min(
              eave,
              p.getY(i) * height +
                f.getY(i) -
                ((k * Math.abs(f.getZ(i)) * 2 * ROOF_SHARE) / depth) * height,
            );
        let head = -Infinity;
        for (let i = 0; i < wp.count; i++)
          head = Math.max(head, wp.getY(i) * walls + wf.getY(i));
        expect(walls - eave).toBeLessThan(EAVE_MAX_DROP + 0.35);
        expect(eave, `depth ${depth}`).toBeGreaterThan(head + 0.05);
      }
    }
  });

  test('the door goes on the downhill long wall, on flat ground on the one that faces the road', () => {
    const b = house();
    const flat = slope(b, 0, 0);
    expect(buildingInstance(b, flat).rotY).toBeCloseTo(-b.angle);
    expect(buildingInstance(b, slope(b, 0, -0.2)).rotY).toBeCloseTo(-b.angle);
    expect(buildingInstance(b, slope(b, 0, 0.2)).rotY).toBeCloseTo(
      -b.angle + Math.PI,
    );
    // Local +Z of the footprint is (-sin angle, cos angle): a road on that side, then on the other.
    const road = (side: number) => ({
      x: -Math.sin(b.angle) * 20 * side,
      z: Math.cos(b.angle) * 20 * side,
    });
    expect(buildingInstance(b, flat, false, road(1)).rotY).toBeCloseTo(
      -b.angle,
    );
    expect(buildingInstance(b, flat, false, road(-1)).rotY).toBeCloseTo(
      -b.angle + Math.PI,
    );
    // The slope wins over the road.
    expect(
      buildingInstance(b, slope(b, 0, -0.2), false, road(-1)).rotY,
    ).toBeCloseTo(-b.angle);
  });

  test('the door stands on the ground at its wall, also on a slope across it', () => {
    for (const [ku, kv] of [
      [0, 0],
      [0.25, 0],
      [-0.25, 0],
      [0.15, -0.2],
      [0.1, 0.2],
    ]) {
      const b = house({ w: 13, floors: 2, h: 6.2 });
      const ground = slope(b, ku, kv);
      const [body, windows, door] = buildingInstances(b, ground);
      expect(body.asset).toBe('house_pitched');
      expect(windows.asset).toBe('house_windows');
      expect(door.asset).toBe('house_door');
      // On the long wall the box turned to the front, at the column the windows leave free.
      const flip = body.rotY !== -b.angle;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const u = (door.x - b.x) * c + (door.z - b.z) * s;
      const v = -(door.x - b.x) * s + (door.z - b.z) * c;
      expect(v).toBeCloseTo((flip ? -1 : 1) * (b.d / 2));
      expect(u).toBeCloseTo((flip ? -1 : 1) * doorSlot(b.w).u * b.w);
      expect(door.rotY).toBe(body.rotY);
      expect(door.sx).toBeUndefined();
      // Its step on the ground there: not buried, not hanging.
      expect(door.y).toBeCloseTo(ground.height(door.x, door.z));
      expect(door.y).toBeGreaterThanOrEqual(body.y + BUILDING_SINK - 1e-9);
      // The windows: the same box up to the wall top.
      expect([windows.x, windows.y, windows.z, windows.rotY]).toEqual([
        body.x,
        body.y,
        body.z,
        body.rotY,
      ]);
      expect([windows.sx, windows.sz]).toEqual([body.sx, body.sz]);
      expect(windows.sy).toBeCloseTo(body.sy! * HOUSE_WALL_FRACTION);
      expect(windows.variant).toBe(2);
    }
  });

  test('halls have a roller door: no windows, no front door', () => {
    const hall = house({ type: 'flat', w: 30, d: 20, h: 7 });
    const body = buildingInstance(hall, slope(hall, 0, 0));
    expect(body.asset).toBe('building_flat');
    expect(body.variant % 4).toBeLessThan(2);
    expect(buildingWindows(hall, body)).toBeUndefined();
    expect(buildingDoor(hall, slope(hall, 0, 0), body)).toBeUndefined();
    const block = house({ type: 'flat', w: 6, d: 4, h: 2.7 });
    const parts = buildingInstances(block, slope(block, 0, 0));
    expect(parts.map((p) => p.asset)).toEqual([
      'building_flat',
      'house_windows',
      'house_door',
    ]);
    // Flat buildings are not a wall fraction of their height: the windows take the whole box.
    expect(parts[1].sy).toBe(parts[0].sy);
  });
});
