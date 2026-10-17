import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@rstest/core';
import { ALL_STAGES } from '../../src/games/rally/maps';
import {
  TIMES_OF_DAY,
  formatHour,
} from '../../src/games/rally/game/time-of-day';
import { slotHour } from '../../src/games/rally/maps/shared/day-temperature';
import { SEASONS } from '../../src/games/rally/season';

/**
 * The matrix in rally DETAILS.md "Temperatures" is the stages' `temps` as a table. It is written from the data, so it
 * cannot drift: after editing a `temps` table or `slotHours` run `UPDATE_TEMPS_DOC=1 npm run test:rally -- temps-doc`.
 */
const DOC = path.resolve(__dirname, '../../src/games/rally/DETAILS.md');
const START = '<!-- temps-matrix -->';
const END = '<!-- /temps-matrix -->';

function matrix(): string {
  // Stages that share one table (the Galichica stages) share a row group.
  const groups: (typeof ALL_STAGES)[] = [];
  for (const s of ALL_STAGES) {
    const g = groups.find((x) => x[0].temps === s.temps);
    if (g) g.push(s);
    else groups.push([s]);
  }
  const head = ['Stage', 'Season', ...TIMES_OF_DAY.map((t) => t.label)];
  const rows: string[][] = [];
  for (const g of groups) {
    const s = g[0];
    const own = s.environment.timeOfDay!;
    const moved = TIMES_OF_DAY.filter((t) => s.slotHours?.[t.id] !== undefined)
      .map((t) => `${t.label.toLowerCase()} ${formatHour(slotHour(s, t))}`)
      .join(', ');
    const label = `${g.map((x) => `\`${x.id}\``).join(' · ')} (${formatHour(own)}${moved ? `; ${moved}` : ''})`;
    SEASONS.forEach((season, i) =>
      rows.push([
        i ? '' : label,
        season,
        ...TIMES_OF_DAY.map((t) => {
          const [air, road] = s.temps[season][t.id];
          const cell = `${air} / ${road}`;
          // The stage's own slot sits at its own hour.
          return slotHour(s, t) === own ? `**${cell}**` : cell;
        }),
      ]),
    );
  }
  const width = head.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (r: string[]) =>
    `| ${r.map((cell, c) => cell.padEnd(width[c])).join(' | ')} |`;
  return [
    line(head),
    `| ${width.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

test('DETAILS.md "Temperatures" shows every stage\'s temps', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  expect(a >= 0 && b > a, `markers ${START} ... ${END} missing`).toBe(true);
  const want = matrix();
  if (process.env.UPDATE_TEMPS_DOC) {
    fs.writeFileSync(
      DOC,
      `${doc.slice(0, a + START.length)}\n\n${want}\n\n${doc.slice(b)}`,
    );
    return;
  }
  const have = doc.slice(a + START.length, b).trim();
  expect(
    have,
    'out of date - UPDATE_TEMPS_DOC=1 npm run test:rally -- temps-doc',
  ).toBe(want);
});
