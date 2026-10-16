import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import {
  cardImageName,
  type StageCardData,
} from '../../src/games/rally/tools/stage-card';
import { mapSeason } from '../../src/games/rally/maps/shared/climate';
import { SEASONS } from '../../src/games/rally/season';
import { ALL_STAGE_DEFS } from '../../src/games/rally/maps/all';
import { isReleased } from '../../src/shared/release';
import { STAGES_LIST } from '../../src/games/rally/release';

/**
 * Released stages need a baked stage card (`maps/<map>/preview/<stage id>.json` + `<stage id>-<season>.jpg`) for the stage select (tools/stage-card.ts). Only existence + format are
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
      const card = JSON.parse(
        fs.readFileSync(jsonFile, 'utf8'),
      ) as StageCardData;
      const own = card.season ?? 'summer';
      expect(
        fs.existsSync(path.join(dir, `${cardImageName(id, own)}.jpg`)),
      ).toBe(true);
      expect(card.map).toBe(id);
      expect(card.stage.length % 3).toBe(0);
      expect(card.grid.nx * card.grid.nz * 2).toBe(
        Buffer.from(card.grid.heights, 'base64').length,
      );
    },
  );

  // One picture per season the map has its own ground for (`groundTints`) (bake: /games/rally/?bakecard=<stage id>&season=all).
  test.each(released.map((d) => [d.stage.id, d.map.id, d.map] as const))(
    '%s has a card picture for each season',
    (id, mapId, map) => {
      const dir = path.join(mapsDir, mapId, 'preview');
      const card = JSON.parse(
        fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'),
      ) as StageCardData;
      const own = mapSeason(map.environment);
      expect(card.season ?? 'summer').toBe(own);
      for (const season of SEASONS) {
        if (!map.environment.groundTints?.[season] && season !== own) continue;
        const name = cardImageName(id, season);
        expect(
          fs.existsSync(path.join(dir, `${name}.jpg`)),
          `no ${season} picture - bake /games/rally/?bakecard=${id}&season=${season}`,
        ).toBe(true);
        if (season === own) continue;
        expect(card.seasons?.[season]?.hash).toBeTruthy();
        expect(card.seasons?.[season]?.floor).toMatch(/^#[0-9a-f]{6}$/);
      }
    },
  );
});
