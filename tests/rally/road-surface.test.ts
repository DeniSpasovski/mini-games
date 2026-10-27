import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { ROAD_SURFACE_LEN } from '../../src/games/rally/engine/road-surface';

const dir = path.resolve(__dirname, '../../src/games/rally/engine/asphalt');
const gen = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/asphalt/gen.js'),
  'utf8',
);
// The gravel road is baked from a scan by its own script.
const gravel = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/gravel/bake.py'),
  'utf8',
);

describe('baked road asphalt', () => {
  const ids = Object.keys(
    ROAD_SURFACE_LEN,
  ) as (keyof typeof ROAD_SURFACE_LEN)[];

  it('has every set at both sizes (High 1024, Medium / Low 512)', () => {
    for (const id of ids)
      for (const size of [1024, 512])
        for (const part of ['color', 'normal', 'rough'])
          expect(
            fs.existsSync(path.join(dir, `${id}.${size}.${part}.webp`)),
          ).toBe(true);
  });

  it('bakes the tile length the road mesh uses (metres per repeat)', () => {
    expect(Number(gravel.match(/^LEN = ([\d.]+)/m)?.[1])).toBe(
      ROAD_SURFACE_LEN.road,
    );
    for (const id of ids) {
      if (id === 'road') continue;
      const preset = gen.match(new RegExp(`${id}: \\{[^}]*?len: (\\d+)`, 's'));
      expect(Number(preset?.[1])).toBe(ROAD_SURFACE_LEN[id]);
    }
  });
});
