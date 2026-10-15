import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import { type StageCardData } from '../../src/games/rally/tools/stage-card';
import { ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { isReleased } from '../../src/shared/release';
import { STAGES_LIST } from '../../src/games/rally/release';

/**
 * Released stages need a baked stage card (`maps/<map>/preview/<stage id>.json` + `.jpg`) for the stage select (tools/stage-card.ts). Only existence + format are
 * checked: an out-of-date card is a dev console warning, re-baked only when the user asks.
 */
const mapsDir = path.resolve(__dirname, '../../src/games/rally/maps');

describe('stage cards', () => {
  const released = ALL_STAGE_DEFS.filter((d) =>
    isReleased(STAGES_LIST, d.stage.id),
  );
  test.each(released.map((d) => [d.stage.id, d.map.id] as const))(
    '%s has a baked card',
    (id, mapId) => {
      const dir = path.join(mapsDir, mapId, 'preview');
      const jsonFile = path.join(dir, `${id}.json`);
      expect(
        fs.existsSync(jsonFile),
        `no card - bake /games/rally/?bakecard=${id}`,
      ).toBe(true);
      expect(fs.existsSync(path.join(dir, `${id}.jpg`))).toBe(true);
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
