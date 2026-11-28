import { describe, expect, test } from '@rstest/core';
import {
  decksInOutline,
  extendDecks,
} from '../../src/games/rally/maps/shared/deck-fit';
import type { PathDef } from '../../src/games/rally/maps/shared/types';

/** Street decks that stop over the road they cross are lengthened (maps/shared/deck-fit.ts). */
const street = (pts: number[], extra: Partial<PathDef> = {}): PathDef => ({
  kind: 'residential',
  width: 8,
  surface: 'tarmac',
  pts,
  ...extra,
});
const deck = (pts: number[]) => street(pts, { bridge: true, layer: 1 });

describe('extendDecks', () => {
  // A deck along +X from 0 to 30, then the street goes on to 200; a road crosses at x = 36 (north-south, 12 m wide).
  const base = (): PathDef[] => [
    deck([0, 0, 30, 0]),
    street([30, 0, 200, 0]),
    street([36, -100, 36, 100], { width: 12 }),
  ];

  test('a road under the first metres of the way beyond the deck end: the way starts as deck, past that road', () => {
    const { paths, extended } = extendDecks(base());
    expect(extended).toHaveLength(1);
    expect(extended[0].by).toBeGreaterThan(14);
    // the way keeps its index with the rest of its length; the deck piece is appended
    expect(paths[1].pts[0]).toBeGreaterThan(40);
    expect(paths).toHaveLength(4);
    const piece = paths[3];
    expect(piece.bridge).toBe(true);
    expect(piece.layer).toBe(1);
    // same direction of travel as the way it came from, from the old deck end on
    expect(piece.pts[0]).toBeCloseTo(30, 1);
    expect(piece.pts[piece.pts.length - 2]).toBeCloseTo(paths[1].pts[0], 1);
    // the crossing road is untouched
    expect(paths[2].pts).toEqual(base()[2].pts);
  });

  test('nothing beneath the first metres: nothing changes', () => {
    const list = base();
    list[2] = street([120, -100, 120, 100]);
    const { paths, extended } = extendDecks(list);
    expect(extended).toHaveLength(0);
    expect(paths).toEqual(list);
  });

  test('a road that joins at the deck end is a junction, not something passing under', () => {
    const list = base();
    list[2] = street([30, 0, 30, 100]); // a T ending on the node where the deck ends
    const { extended } = extendDecks(list);
    expect(extended).toHaveLength(0);
  });

  test('a short connector between the deck end and the junction is deck as a whole, the way after it is split', () => {
    const list: PathDef[] = [
      deck([0, 0, 30, 0]),
      street([30, 0, 34, 0]), // 4 m connector
      street([34, 0, 200, 0]),
      street([40, -100, 40, 100], { width: 12 }),
    ];
    const { paths, extended } = extendDecks(list);
    expect(extended).toHaveLength(1);
    expect(paths[1].bridge).toBe(true);
    expect(paths[1].pts).toEqual([30, 0, 34, 0]);
    expect(paths[2].pts[0]).toBeGreaterThan(48);
  });

  test('a way running against the direction (ends at the deck end) keeps its orientation', () => {
    const list: PathDef[] = [
      deck([100, 0, 70, 0]), // the deck runs towards -X
      street([0, 0, 70, 0]), // the way beyond it is drawn towards the deck: it ends on it
      street([64, -100, 64, 100], { width: 12 }),
    ];
    const { paths, extended } = extendDecks(list);
    expect(extended).toHaveLength(1);
    const piece = paths[paths.length - 1];
    // its points follow the way's own direction (away from the deck end -> to the deck end)
    expect(piece.pts[0]).toBeLessThan(piece.pts[piece.pts.length - 2]);
    expect(piece.pts[piece.pts.length - 2]).toBeCloseTo(70, 1);
    // the way keeps the rest, ending where the deck piece starts
    expect(paths[1].pts[paths[1].pts.length - 2]).toBeCloseTo(piece.pts[0], 1);
  });

  test('`skip` leaves approved structures alone', () => {
    const { extended } = extendDecks(base(), { skip: () => true });
    expect(extended).toHaveLength(0);
  });

  test('motorway decks and ground ways of another surface are not extended', () => {
    const list = base();
    list[0] = { ...list[0], kind: 'motorway' };
    expect(extendDecks(list).extended).toHaveLength(0);
  });
});

describe('decksInOutline', () => {
  // A measured structure 40 x 30 m; a street crosses it west to east, a motorway passes beneath north to south.
  const outline = [20, -15, 60, -15, 60, 15, 20, 15];
  const list = (): PathDef[] => [
    street([0, 0, 100, 0]),
    street([40, -100, 40, 100], { kind: 'motorway', width: 11 }),
    street([30, -5, 50, 5]),
  ];
  const under = (p: PathDef) => p.kind === 'motorway';

  test('a way crossing the outline is split at its edges: the piece inside is deck, the ones outside stay ground', () => {
    const out = decksInOutline(list(), outline, under);
    // the way keeps its index with its first piece; the other pieces are appended
    expect(out).toHaveLength(5);
    expect(out[0].bridge).toBeUndefined();
    expect(out[0].pts[out[0].pts.length - 2]).toBeCloseTo(20, 1);
    const deck = out[3];
    expect(deck.bridge).toBe(true);
    expect(deck.layer).toBe(1);
    expect(deck.pts[0]).toBeCloseTo(20, 1);
    expect(deck.pts[deck.pts.length - 2]).toBeCloseTo(60, 1);
    expect(out[4].bridge).toBeUndefined();
    expect(out[4].pts[0]).toBeCloseTo(60, 1);
  });

  test('a way wholly inside becomes deck in place; the road beneath stays ground', () => {
    const out = decksInOutline(list(), outline, under);
    expect(out[2].bridge).toBe(true);
    expect(out[2].pts).toEqual(list()[2].pts);
    expect(out[1].bridge).toBeUndefined();
  });
});
