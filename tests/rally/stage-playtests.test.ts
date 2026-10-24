import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@rstest/core';
import { ALL_STAGES } from '../../src/games/rally/maps';

/** Stages no playtest drives on purpose: galichica_east is the first half of prespa_ohrid (same start, same direction). */
const COVERED_BY_ANOTHER = ['galichica_east'];

test('every stage has an autopilot playtest (integration-tests/rally/stage-<map>.test.ts)', () => {
  const dir = join(import.meta.dirname, '../../integration-tests/rally');
  const files = readdirSync(dir).filter((f) => /^stage-.*\.test\.ts$/.test(f));
  for (const s of ALL_STAGES) {
    if (COVERED_BY_ANOTHER.includes(s.id)) continue;
    // A file covers its map's stages by `describeStages(<map>)`, or names the ones it drives.
    const covered = files.some((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      const all =
        new RegExp(`describeStages\\(\\w+\\);`).test(src) &&
        src.includes(`maps/${s.map}/map'`);
      return all || src.includes(`'${s.id}'`);
    });
    expect(
      covered,
      `${s.id} (map ${s.map}) is driven by a stage playtest`,
    ).toBe(true);
  }
});
