import { describe, expect, test } from '@rstest/core';
import { jackie2Map } from '../../src/games/rally/maps/jackie-2/map';
import network from '../../src/games/rally/maps/jackie-2/network.json';
import shapes from '../../src/games/rally/maps/jackie-2/landmarks/kew-shapes.json';
import { KEW_STYLES } from '../../src/games/rally/maps/jackie-2/landmarks/kew-styles';
import {
  KEW_BUILDINGS,
  kewBuildingsLandmark as landmark,
  kewShare,
} from '../../src/games/rally/maps/jackie-2/landmarks/kew-blocks';

/**
 * The one-off buildings at the Kew Gardens end of Jackie 2 (`maps/jackie-2/landmarks/kew-blocks.ts`): every record has
 * its survey shape and every shape its record, they replace the footprint boxes under them and nothing else, and
 * their solid boxes stay off the stage road.
 */
const flat = {
  chunkSize: 64,
  height: () => 0,
  normal: (_x: number, _z: number, out: never) => out,
};
const cps = (network as unknown as { stage: { cps: [number, number][] } }).stage
  .cps;

function distToStage(x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < cps.length; i++) {
    const [ax, az] = cps[i - 1];
    const [bx, bz] = cps[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
}

describe('jackie 2 Kew Gardens buildings', () => {
  test('the map uses the landmark and every record has its survey shape (and back)', () => {
    expect(jackie2Map.landmarks).toContain(landmark.id);
    const bins = new Set(shapes.map((s) => s.bin));
    for (const bin of Object.keys(KEW_STYLES))
      expect(bins.has(Number(bin))).toBe(true);
    for (const s of shapes) expect(KEW_STYLES[s.bin]).toBeDefined();
    expect(KEW_BUILDINGS.length).toBe(shapes.length);
  });

  test('survey shapes are whole: walls, a roof, a ground ring', () => {
    for (const s of shapes) {
      expect(s.walls.length).toBeGreaterThanOrEqual(4);
      expect(s.roofs.length).toBeGreaterThanOrEqual(1);
      expect(s.foot.length).toBeGreaterThanOrEqual(12);
      for (const w of s.walls) expect(w.length % 3).toBe(0);
    }
  });

  test('replaces the footprint boxes under the buildings, and only near them', () => {
    const replaced = jackie2Map.buildings!.filter((b) => landmark.replaces(b));
    expect(replaced.length).toBeGreaterThan(10);
    // (U-shaped blocks: the box centre lies in the yard, the box still goes)
    for (const id of [7917, 7949, 7954, 2707])
      expect(replaced.some((b) => b.id === id)).toBe(true);
  });

  test('no kept box stands inside a Kew building, no removed box leaves an empty lot', () => {
    for (const b of jackie2Map.buildings!) {
      const share = kewShare(b);
      if (landmark.replaces(b)) expect(share).toBeGreaterThanOrEqual(0.4);
      else expect(share).toBeLessThan(0.15);
    }
  });

  test('solid boxes stay off the stage road', () => {
    for (const c of landmark.colliders(flat)) {
      const corners = [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => {
          const u = sx * c.hx!;
          const v = sz * c.hz!;
          const a = -c.rot!;
          return [
            c.x + u * Math.cos(a) - v * Math.sin(a),
            c.z + u * Math.sin(a) + v * Math.cos(a),
          ];
        }),
      );
      for (const [x, z] of corners)
        expect(distToStage(x, z)).toBeGreaterThan(8);
    }
  });
});
