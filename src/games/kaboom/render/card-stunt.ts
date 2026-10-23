/**
 * The crowd's card stunt (DETAILS.md "UI"): the far stand holds up a board of cards that spells a name. The stands are warped
 * rings, so the board is a plain grid laid over the stand in screen space: each cell is a card, cream when dark and in the
 * team colour when lit. Pure maths, no WebGL (tests/kaboom/crowd.test.ts).
 */

const ROWS = 9;
const TEXT_ROWS = 7;
const GAP = 1;
const MIN_COLS = 29;
const MARGIN_COLS = 4;

/** 5 x 7 capitals, only the letters the critters' names (and "YOU!") need. */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
};

/** Columns the bitmap of `text` takes (5 per letter and 1 between; unknown characters are skipped). */
export function textColumns(text: string): number {
  const n = [...text].filter((c) => GLYPHS[c]).length;
  return n === 0 ? 0 : n * 5 + (n - 1) * GAP;
}

/**
 * The board for `text`: `rows` x `cols` cards, `lit[row * cols + col]` = 1 where a card shows the team colour (row 0 is the top).
 * The word is centred with at least two spare cards each side; `null` (or text with no known letters) lights every card.
 * `text` in the result is what was spelled ('' for the all-lit board).
 */
export function boardMask(text: string | null): {
  cols: number;
  rows: number;
  lit: Uint8Array;
  text: string;
} {
  const letters = text === null ? [] : [...text].filter((c) => GLYPHS[c]);
  const tc = textColumns(letters.join(''));
  if (tc === 0) {
    return {
      cols: MIN_COLS,
      rows: ROWS,
      lit: new Uint8Array(MIN_COLS * ROWS).fill(1),
      text: '',
    };
  }
  const cols = Math.max(tc + MARGIN_COLS, MIN_COLS);
  const lit = new Uint8Array(cols * ROWS);
  const x0 = Math.floor((cols - tc) / 2);
  const y0 = (ROWS - TEXT_ROWS) >> 1;
  letters.forEach((ch, k) => {
    GLYPHS[ch].forEach((row, y) => {
      for (let x = 0; x < 5; x++)
        if (row[x] === '1') lit[(y0 + y) * cols + x0 + k * (5 + GAP) + x] = 1;
    });
  });
  return { cols, rows: ROWS, lit, text: letters.join('') };
}
