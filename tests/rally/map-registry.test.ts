import { describe, expect, it } from '@rstest/core';
import { ALL_MAPS as FULL } from '../../src/games/rally/maps/all';
import { ALL_MAPS, loadMap } from '../../src/games/rally/maps';

describe('map registry: light info vs full map', () => {
  it('lists the same maps in the same order', () => {
    expect(ALL_MAPS.map((m) => m.id)).toEqual(FULL.map((m) => m.id));
  });

  describe.each(FULL.map((m) => [m.id, m] as const))('%s', (_id, full) => {
    const info = ALL_MAPS.find((m) => m.id === full.id)!;

    it('loadMap returns the full map', async () => {
      expect((await loadMap(full.id)).id).toBe(full.id);
    });

    it('info route and surfaces match the road', () => {
      const pts = full.road.points.map((p) =>
        Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z],
      );
      expect(info.route).toEqual(pts);
      expect(info.surfaces).toEqual([
        full.road.surface,
        ...(full.road.sections ?? []).map((s) => s.surface),
      ]);
    });

    it('info fields equal the full map', () => {
      for (const k of [
        'name',
        'description',
        'tyre',
        'gearing',
        'bounds',
        'stage',
        'environment',
        'stageNumber',
        'sources',
        'credits',
        'geo',
      ] as const)
        expect(info[k]).toEqual(full[k]);
    });
  });
});
