import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import { type StageCardData } from '../../src/games/rally/tools/stage-card';
import { ALL_MAPS } from '../../src/games/rally/maps/all';
import { AVAILABLE_MAPS } from '../../src/games/rally/release';

/**
 * Released maps need a baked stage card for the stage select (tools/stage-card.ts). Only existence + format are
 * checked: an out-of-date card is a dev console warning, re-baked only when the user asks.
 */
const mapsDir = path.resolve(__dirname, '../../src/games/rally/maps');

describe('stage cards', () => {
  const released = ALL_MAPS.filter((m) => AVAILABLE_MAPS.includes(m.id));
  test.each(released.map((m) => [m.id] as const))(
    '%s has a baked card',
    (id) => {
      const dir = path.join(mapsDir, id, 'preview');
      const jsonFile = path.join(dir, 'stage-card.json');
      expect(
        fs.existsSync(jsonFile),
        `no card - bake /games/rally/?bakecard=${id}`,
      ).toBe(true);
      expect(fs.existsSync(path.join(dir, 'stage-card.jpg'))).toBe(true);
      const card = JSON.parse(
        fs.readFileSync(jsonFile, 'utf8'),
      ) as StageCardData;
      expect(card.map).toBe(id);
      expect(card.stage.length % 3).toBe(0);
      expect(card.grid.nx * card.grid.nz * 2).toBe(
        Buffer.from(card.grid.heights, 'base64').length,
      );
    },
  );
});
