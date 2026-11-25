import { describe, expect, test } from '@rstest/core';
import type { PathDef } from '../../src/games/rally/maps/shared/types';
import {
  baseTexture,
  dashIntervals,
  hasMarkings,
  markingLines,
  straightJoint,
} from '../../src/games/rally/world/street-markings';
import { pathTexture } from '../../src/games/rally/world/road-mesh';
import {
  junctionGlyphs,
  travelBand,
} from '../../src/games/rally/world/street-glyphs';
import data from '../../src/games/rally/maps/jackie/data.json';

/** Paint only: the wear strips are checked on their own. */
const paint = (p: PathDef) => markingLines(p).filter((l) => l.color !== 'wear');

const street = (extra: Partial<PathDef>): PathDef => ({
  kind: 'residential',
  width: 9,
  surface: 'tarmac',
  pts: [0, 0, 50, 0],
  layout: {
    fwd: 1,
    back: 1,
    parkL: 1,
    parkR: 1,
    bikeL: 0,
    bikeR: 0,
    shoulder: 0,
  },
  marks: { centre: 'double_yellow', stop: [0, 0] },
  ...extra,
});

describe('street markings layout', () => {
  test('a two-way street: a double yellow between the two directions, none at the kerbs', () => {
    const lines = paint(street({}));
    const yellow = lines.filter((l) => l.color === 'yellow');
    expect(yellow).toHaveLength(2);
    // parking both sides, one lane each way: the travel band is centred -> the centre line is at 0
    expect(yellow[0].lat + yellow[1].lat).toBeCloseTo(0, 5);
    expect(lines.filter((l) => l.color === 'white')).toHaveLength(0);
  });

  test('parking on the right only shifts the centre line towards the left (the travel band is narrower on the right)', () => {
    const l = street({
      layout: {
        fwd: 1,
        back: 1,
        parkL: 0,
        parkR: 1,
        bikeL: 0,
        bikeR: 0,
        shoulder: 0,
      },
    });
    const y = paint(l).filter((m) => m.color === 'yellow');
    // band = [-4.5 + 2.2, 4.5] -> centre at 1.1
    expect((y[0].lat + y[1].lat) / 2).toBeCloseTo(1.1, 2);
  });

  test('a one-way street with two lanes: one dashed white line, no centre line', () => {
    const lines = paint(
      street({
        oneway: true,
        width: 8,
        layout: {
          fwd: 2,
          back: 0,
          parkL: 0,
          parkR: 0,
          bikeL: 0,
          bikeR: 0,
          shoulder: 0,
        },
        marks: { centre: 'none', stop: [0, 0] },
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].dash).toEqual([3, 9]);
    expect(lines[0].color).toBe('white');
  });

  test('a ramp / carriageway: yellow left edge, white right edge, dashed lane lines between the lanes', () => {
    const lines = paint(
      street({
        kind: 'motorway_link',
        width: 8,
        oneway: true,
        layout: {
          fwd: 2,
          back: 0,
          parkL: 0,
          parkR: 0,
          bikeL: 0,
          bikeR: 0,
          shoulder: 0.8,
        },
      }),
    );
    expect(lines.find((l) => l.color === 'yellow')!.lat).toBeGreaterThan(2);
    expect(lines.find((l) => l.color === 'white' && !l.dash)!.lat).toBeLessThan(
      -2,
    );
    expect(lines.filter((l) => l.dash)).toHaveLength(1);
  });

  test('a bike lane gets a solid white line 1.5 m inside the parking lane', () => {
    const lines = paint(
      street({
        width: 12,
        layout: {
          fwd: 1,
          back: 1,
          parkL: 0,
          parkR: 1,
          bikeL: 0,
          bikeR: 1,
          shoulder: 0,
        },
      }),
    );
    expect(
      lines.some((l) => l.color === 'white' && !l.dash && l.lat < -2),
    ).toBe(true);
  });

  test('every travel lane gets two wheel paths, centred in the lane', () => {
    const wear = markingLines(street({})).filter((l) => l.color === 'wear');
    expect(wear).toHaveLength(4); // 1 + 1 lanes
    for (const w of wear) expect(w.w).toBeLessThan(0.6);
    // the pairs straddle a lane centre 0.75 m either side
    const lats = wear.map((w) => w.lat).sort((a, b) => a - b);
    expect(lats[1] - lats[0]).toBeCloseTo(1.5, 5);
    expect(lats[3] - lats[2]).toBeCloseTo(1.5, 5);
  });

  test('dashes keep phase with the distance along the street', () => {
    const a = dashIntervals(0, 30, [3, 9]);
    expect(a).toEqual([
      [0, 3],
      [12, 15],
      [24, 27],
    ]);
    const b = dashIntervals(10, 30, [3, 9]);
    expect(b[0][0]).toBeCloseTo(12, 5);
  });

  test('textures: modelled streets get base asphalt, a city map never gets village tarmac', () => {
    expect(hasMarkings(street({}))).toBe(true);
    expect(hasMarkings(street({ bridge: true }))).toBe(false);
    expect(hasMarkings(street({ bridge: true }), true)).toBe(true);
    expect(baseTexture(street({ kind: 'motorway_link' }))).toBe(
      'asphalt_highway',
    );
    expect(baseTexture(street({}))).toBe('asphalt_street');
    for (const p of data.paths as PathDef[])
      if (p.surface === 'tarmac')
        expect(pathTexture(p.kind, p.width, true)).not.toBe('road_tarmac');
  });

  test('a straight OSM joint is found, a T junction is not', () => {
    const a = street({ pts: [0, 0, 50, 0] });
    const b = street({ pts: [50, 0, 100, 0] });
    const t = street({ pts: [50, 0, 50, 40] });
    expect(straightJoint([a, b], a, true)).toBe(true);
    expect(straightJoint([a, b, t], a, true)).toBe(false);
    expect(straightJoint([a], a, true)).toBe(false);
  });
});

/** Bounds of a glyph set: along / lateral extent of every triangle corner. */
const bounds = (tris: number[]) => {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < tris.length; i += 2) {
    u0 = Math.min(u0, tris[i]);
    u1 = Math.max(u1, tris[i]);
    v0 = Math.min(v0, tris[i + 1]);
    v1 = Math.max(v1, tris[i + 1]);
  }
  return { u0, u1, v0, v1 };
};

describe('street glyphs', () => {
  test('a stop bar stands before the crosswalk, across the approaching lanes only', () => {
    const p = street({ pts: [0, 0, 80, 0] });
    const g = junctionGlyphs(p, 80, [{ at: 74.8, atEnd: true }]);
    expect(g).toHaveLength(1);
    const b = bounds(g[0].tris);
    // before the crosswalk (74.8 - 1.3), not on it
    expect(b.u1).toBeLessThan(74.8 - 1.3);
    expect(b.u0).toBeGreaterThan(70);
    // fwd lanes (the right half): from the parking lane edge to the centre line
    const band = travelBand(p)!;
    expect(b.v1).toBeLessThan(band.centre);
    expect(b.v0).toBeGreaterThan(band.b0 - 0.01);
  });

  test('a one-way street has no bar where its traffic leaves; the data stop flag works without a crosswalk', () => {
    const one = street({
      oneway: true,
      layout: {
        fwd: 2,
        back: 0,
        parkL: 1,
        parkR: 1,
        bikeL: 0,
        bikeR: 0,
        shoulder: 0,
      },
      marks: { centre: 'none', stop: [1, 0] },
    });
    // stop flagged at the start, but traffic leaves there: nothing
    expect(junctionGlyphs(one, 80, [])).toHaveLength(0);
    const g = junctionGlyphs(one, 80, [], undefined);
    expect(g).toHaveLength(0);
    const flagged = junctionGlyphs(
      { ...one, marks: { centre: 'none', stop: [0, 1] } },
      80,
      [],
    );
    const b = bounds(flagged[0].tris);
    expect(b.u0).toBeGreaterThan(80 - 5);
  });

  test('turn:lanes gives one arrow per approach lane, pointing the right way', () => {
    const p = street({
      width: 12,
      layout: {
        fwd: 2,
        back: 1,
        parkL: 1,
        parkR: 1,
        bikeL: 0,
        bikeR: 0,
        shoulder: 0,
      },
      marks: {
        centre: 'double_yellow',
        stop: [0, 0],
        turn: 'left|through;right',
      },
    });
    const plain = junctionGlyphs(
      { ...p, marks: { ...p.marks!, turn: undefined } },
      120,
      [{ at: 114.8, atEnd: true }],
    );
    const g = junctionGlyphs(p, 120, [{ at: 114.8, atEnd: true }]);
    const nPlain = plain[0].tris.length;
    expect(g[0].tris.length).toBeGreaterThan(nPlain);
    // the arrows lie before the bar, on the fwd (right) half
    const arrows = g[0].tris.slice(nPlain);
    const b = bounds(arrows);
    expect(b.u1).toBeLessThan(114.8 - 1.3 - 0.45);
    expect(b.v1).toBeLessThan(travelBand(p)!.centre);
  });

  test('a bike lane gets bike symbols; ramps and carriageways get no glyphs', () => {
    const p = street({
      width: 12,
      layout: {
        fwd: 1,
        back: 1,
        parkL: 0,
        parkR: 1,
        bikeL: 0,
        bikeR: 1,
        shoulder: 0,
      },
    });
    const g = junctionGlyphs(p, 200, []);
    expect(g).toHaveLength(1);
    const b = bounds(g[0].tris);
    // in the bike lane: right of the travel band, left of the parking lane
    expect(b.v0).toBeGreaterThan(-6 + 2.2 - 0.01);
    expect(b.v1).toBeLessThan(-6 + 2.2 + 1.5 + 0.01);
    expect(
      junctionGlyphs(street({ kind: 'motorway_link' }), 200, [
        { at: 190, atEnd: true },
      ]),
    ).toHaveLength(0);
  });
});
