import { describe, expect, rs, test } from '@rstest/core';
import { Texture } from 'three';
import {
  buildingFlat,
  housePitched,
  houseStone,
} from '../../src/games/rally/assets/builders/buildings';
import { HOUSE_WALL_FRACTION } from '../../src/games/rally/assets/catalog';
import {
  FIX,
  ROOF_SHARE,
  SLOT,
  SLOT_COLUMNS,
} from '../../src/games/rally/engine/house-walls';
import type { BuildingDef } from '../../src/games/rally/maps/shared/types';
import { buildingInstance } from '../../src/games/rally/world/buildings';
import type { TerrainSampler } from '../../src/games/rally/world/heightfield';

// Materials draw their textures on a canvas (no DOM here).
rs.mock('../../src/games/rally/engine/textures', () => ({
  getTexture: () => new Texture(),
}));

/**
 * Box buildings are a unit footprint scaled per instance. The `fix` attribute carries what must NOT scale with it
 * (windows, door, eaves, chimney: metres, see engine/house-walls.ts), so every vertex needs a code the shader knows.
 */
const ASSETS = [
  { name: 'house_pitched', build: housePitched, variants: 8 },
  { name: 'house_stone', build: houseStone, variants: 4 },
  { name: 'building_flat', build: buildingFlat, variants: 8 },
];

describe('box buildings', () => {
  test('roof share of the shader matches the catalog wall fraction', () => {
    expect(ROOF_SHARE).toBeCloseTo(1 - HOUSE_WALL_FRACTION, 6);
  });

  test.each(ASSETS)('$name: fix codes and a front door', (a) => {
    for (let variant = 0; variant < a.variants; variant++)
      for (const lod of [0, 1]) {
        const built = a.build({ seed: 7, variant, lod });
        expect(built.parts.length).toBe(1);
        const g = built.parts[0].geometry;
        const fix = g.getAttribute('fix');
        expect(fix.itemSize).toBe(4);
        expect(fix.count).toBe(g.getAttribute('position').count);
        let doors = 0;
        for (let i = 0; i < fix.count; i++) {
          const w = fix.getW(i);
          if (w >= 100) {
            expect(w).toBeLessThanOrEqual(FIX.hipEndRidge);
            continue;
          }
          if (w === FIX.plain) continue;
          const code = w - 2;
          const kind = Math.floor(code / 16);
          const col = code % 16;
          expect(kind).toBeLessThanOrEqual(SLOT.door);
          expect(col).toBeLessThan(
            kind === SLOT.alongZ ? SLOT_COLUMNS.short : SLOT_COLUMNS.long,
          );
          if (kind === SLOT.door) doors++;
        }
        // Halls (flat styles 0 / 1) have a roller door instead; far LODs drop the openings.
        const hall = a.name === 'building_flat' && variant % 4 < 2;
        if (lod === 0 && !hall) expect(doors).toBeGreaterThan(0);
        if (lod === 1) expect(doors).toBe(0);
      }
  });

  test('the door opens on the downhill side', () => {
    const b: BuildingDef = {
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
    };
    // Local +Z of the footprint is (-sin angle, cos angle).
    const slope = (k: number): TerrainSampler =>
      ({
        height: (x: number, z: number) =>
          k * (-Math.sin(b.angle) * x + Math.cos(b.angle) * z),
      }) as TerrainSampler;
    expect(buildingInstance(b, slope(0), false).rotY).toBeCloseTo(-b.angle);
    expect(buildingInstance(b, slope(-0.2), false).rotY).toBeCloseTo(-b.angle);
    expect(buildingInstance(b, slope(0.2), false).rotY).toBeCloseTo(
      -b.angle + Math.PI,
    );
  });
});
