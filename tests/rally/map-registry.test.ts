import { describe, expect, it } from '@rstest/core';
import { ALL_MAPS as FULL } from '../../src/games/rally/maps/all';
import {
  ALL_MAPS,
  ALL_STAGES,
  getMapInfo,
  getStage,
  loadMap,
  loadStage,
  stageLinkParams,
} from '../../src/games/rally/maps';

describe('map registry: light info vs full map', () => {
  it('lists the same maps in the same order', () => {
    expect(ALL_MAPS.map((m) => m.id)).toEqual(FULL.map((m) => m.id));
  });

  it('old map links are rewritten to stage links, other parameters kept in order', () => {
    const link = (q: string) =>
      stageLinkParams(new URLSearchParams(q))?.toString() ?? null;
    expect(
      link(
        'map=ajvatovci&car=citroen_c4&livery=0&tyre=mixed&susp=medium&gear=long',
      ),
    ).toBe(
      'stage=ajvatovci&car=citroen_c4&livery=0&tyre=mixed&susp=medium&gear=long',
    );
    // A map with several stages opens its first one.
    expect(link('map=galichica&car=fiesta')).toBe(
      'stage=galichica_west&car=fiesta',
    );
    expect(link('car=fiesta&map=jackie&spawn=500')).toBe(
      'car=fiesta&stage=jackie&spawn=500',
    );
    expect(link('stage=prespa_ohrid&map=galichica')).toBe('stage=prespa_ohrid');
    expect(link('stage=jackie')).toBeNull();
  });

  it('stage ids are unique across all maps', () => {
    const ids = ALL_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(FULL.map((m) => [m.id, m] as const))('%s', (_id, full) => {
    const info = ALL_MAPS.find((m) => m.id === full.id)!;

    it('loadMap returns the full map', async () => {
      expect((await loadMap(full.id)).id).toBe(full.id);
    });

    it('every stage resolves to this map (by stage id, and old map-id links)', async () => {
      expect(full.stages.length).toBeGreaterThan(0);
      for (const st of full.stages) {
        expect(getStage(st.id).map).toBe(full.id);
        expect(getMapInfo(st.id).id).toBe(full.id);
        const loaded = await loadStage(st.id);
        expect(loaded.map.id).toBe(full.id);
        expect(loaded.stage.id).toBe(st.id);
      }
      expect(getStage(full.id).map).toBe(full.id);
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
        'stages',
        'bounds',
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
