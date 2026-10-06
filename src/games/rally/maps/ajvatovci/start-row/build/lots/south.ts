import { Vector2 } from 'three';
import { edgesOf, HALL_WEST_SHARE } from '../../layout';
import { cartons, condenser, signPylon, splitUnit } from '../props';
import { Shell, Wall, wallFrames } from '../wall';
import { COLOR, dockDoors, hippedRoof, ribbon, type LotCtx } from './common';
import { fromFront } from './north';

/**
 * The south side of the street (behind the wire fence, backs to the fields), west to east:
 * south 1 (grey depot with blue office), south 2 (white panel hall), south 3 (red-roofed hall
 * with yellow bands), south 4 (logistics centre), south 5 (two dark sheds), south 6 (grey office
 * block with a round glazed front). Built with real openings.
 */

const RED = '#c8322b';

// ----- south 1: the depot -----

export function dressDepot(ctx: LotCtx): void {
  const { shell, h } = ctx;
  const BLUE = '#1f58a6';
  const CREAM = '#e3dcc8';
  const PARAPET = '#8f9396';
  const PANEL = '#d3d6d8';
  for (const w of shell.walls) {
    const L = w.length;
    const span = (d0: number, d1: number) => w.w.span(d0, d1);
    const near = fromFront(w, ctx);
    w.plinth(COLOR.plinth, 0.6);
    // Cream ledge with a darker parapet band above it.
    w.paint([-0.1, L + 0.1], [h - 2.1, h - 1.9], [-0.02, 0.6], CREAM);
    w.paint([-0.1, L + 0.1], [h - 1.9, h + 0.4], [-0.02, 0.3], PARAPET);
    // Floodlights.
    for (const d of [L * 0.3, L * 0.7])
      w.paint(span(d, d + 0.5), [6.3, 6.6], [0, 0.35], COLOR.doorFrame);
    if (w.w.side === 'e') {
      // The glazed office at the front corner: blue frame, two floors of glass.
      w.paint(near(0, 8.5), [0, h + 0.4], [-0.02, 0.3], BLUE);
      for (const y of [
        [0.9, 3.7],
        [5.2, 8.2],
      ] as [number, number][])
        w.applied(near(0.8, 7.7), y, 0.3, {
          across: 1.15,
          frame: COLOR.mullion,
        });
      w.paint(near(0, 8.5), [4.1, 4.9], [-0.02, 0.8], BLUE);
      ribbon(w, near(10.5, L - 1.5), { width: 2.6, pitch: 4.4, y: [6.2, 7.4] });
      continue;
    }
    if (ctx.dockEdges.has(w.w.side)) dockDoors(w, ctx);
    if (w.w.side === ctx.front) {
      // Blue wraps round the east corner; a side door under a blue canopy; a louvred vent and a
      // ribbon of high windows; the sign pylon by the street fence.
      w.paint(span(L - 2.5, L + 0.3), [0, h + 0.4], [-0.02, 0.32], BLUE);
      w.paint(span(L - 11.5, L - 5.5), [0, 3.7], [-0.02, 0.06], PANEL);
      w.doorway(span(L - 9.4, L - 8.2), 2.4, {
        leaf: 'panel',
        color: PANEL,
        frame: COLOR.doorFrame,
        depth: 0.1,
      });
      w.paint(span(L - 12, L - 5), [3.7, 4.1], [-0.02, 2.2], BLUE);
      w.paint(span(14, L - 13), [4.2, 5.2], [-0.02, 0.05], '#e4e6e7');
      ribbon(w, span(13.5, L - 3), { width: 3.6, pitch: 4.4, y: [6.2, 7.6] });
      signPylon(w, w.w.span(L * 0.7, L * 0.7)[0], 4);
    } else if (w.w.side !== 's' || !ctx.dockEdges.has('s')) {
      ribbon(w, span(4, L - 2), { width: 3.6, pitch: 4.4, y: [6.2, 7.6] });
    }
  }
  shell.finish();
}

// ----- south 2: the white panel hall -----

export function dressHall(ctx: LotCtx): void {
  const { shell, plot, f, h } = ctx;
  const TRIM = '#d4d6d5';
  const SLAT = '#e6e5df';
  const POST = '#cfcdc6';
  const westShare = HALL_WEST_SHARE;
  for (const w of shell.walls) {
    const L = w.length;
    const span = (d0: number, d1: number) => w.w.span(d0, d1);
    const westEnd = L * westShare;
    w.plinth(COLOR.plinth, 0.6);
    // A cap on the lower roof's edge, where the taller block doesn't cover it.
    if (w.w.side === 'w') w.coping(plot.roof, 0.35, 0.2);
    else if (w.w.side === 'n' || w.w.side === 's')
      w.coping(plot.roof, 0.35, 0.2, span(-0.15, westEnd));
    if (w.w.side === 's' && ctx.dockEdges.has('s')) dockDoors(w, ctx);
    if (w.w.side !== ctx.front) continue;

    // ----- the street front -----
    // The lower block: an open door at its east end with cartons stacked inside, a white door
    // frame with a green sign to the west of it.
    const d1 = westEnd - 1.2;
    const d0 = d1 - 4.4;
    w.doorway(span(d0, d1), 4.2, { leaf: 'none', room: 7, frame: TRIM });
    cartons(w, span(d0, d1)[0]);
    w.paint(span(d0 - 2.1, d0 - 1), [0, 3.6], [-0.02, 0.1], TRIM);
    w.paint(span(d0 - 1.75, d0 - 1.3), [1.9, 2.7], [0.1, 0.14], '#2e9e5b');
    w.paint(
      span(d0 + 1.7, d0 + 2.4),
      [5.6, 5.95],
      [-0.02, 0.45],
      COLOR.doorFrame,
    );
    // The carrier's sign board on the wall: dark head with a gold shield, white body.
    w.paint(span(1.1, 2.5), [5.2, 6.6], [-0.02, 0.14], '#3a2a1c');
    w.paint(span(1.45, 2.15), [5.45, 6.35], [0.14, 0.17], '#d9a62a');
    w.paint(span(1.1, 2.5), [3.3, 5.2], [-0.02, 0.14], SLAT);
    for (const y of [3.6, 4.1, 4.6])
      w.paint(span(1.3, 2.3), [y, y + 0.12], [0.14, 0.17], COLOR.doorFrame);
    // Air-conditioning condensers by the west corner.
    condenser(w, span(3, 4.2));
    condenser(w, span(4.6, 5.8));

    // The screen fence 1.3 m off the wall, open in front of the lower block's door and
    // returning to the wall on both sides of the gap.
    const gapA = d0 - 0.6;
    const gapB = d1 + 0.6;
    const F0 = 1.28;
    const F1 = 1.36;
    const H = 2.5;
    const slats = (a: number, b: number) => {
      const [u0, u1] = span(a, b);
      for (let y = 0.12; y + 0.14 < H; y += 0.27)
        w.box('paint', [u0, u1], [y, y + 0.14], [F0, F1], SLAT);
    };
    const posts = (a: number, b: number) => {
      const n = Math.max(1, Math.round((b - a) / 3.2));
      for (let k = 0; k <= n; k++) {
        const u = a + ((b - a) * k) / n;
        w.box(
          'paint',
          span(u - 0.05, u + 0.05),
          [0, H + 0.1],
          [F0 - 0.03, F1 + 0.05],
          POST,
        );
      }
    };
    slats(0, gapA);
    posts(0, gapA);
    slats(gapB, L);
    posts(gapB, L);
    for (const u of [gapA, gapB]) {
      const [s0, s1] = span(u - 0.04, u + 0.04);
      for (let y = 0.12; y + 0.14 < H; y += 0.27)
        w.box('paint', [s0, s1], [y, y + 0.14], [0, F0], SLAT);
      w.box(
        'paint',
        span(u - 0.06, u + 0.06),
        [0, H + 0.1],
        [F0 - 0.03, F1 + 0.05],
        POST,
      );
    }
  }
  shell.finish();

  // The taller block, in the same panels; a cap on its roof edge except on the side that meets the lower block.
  const a = plot.annex!;
  const tall = new Shell(
    f,
    a.corners,
    a.height,
    { mat: 'panel', tint: plot.walls },
    { mat: 'roofing', tint: plot.roof },
  );
  for (const w of tall.walls) {
    if (w.w.side !== 'w')
      w.coping(plot.roof, 0.35, 0.2, [-0.1, w.length + 0.1]);
    if (w.w.side === ctx.front) {
      // The street front of the taller block: a big roller door at its east end, a small blue plate beside
      // it and a floodlight above.
      const east = (d0: number, d1: number) => w.w.far(d0, d1);
      w.plinth(COLOR.plinth, 0.6);
      w.doorway(east(1.2, 6.2), 4.7, {
        leaf: 'roller',
        color: '#e1e3e3',
        frame: TRIM,
      });
      w.paint(east(7, 7.9), [2.3, 3.2], [-0.02, 0.05], '#2a78b8');
      w.paint(east(3.4, 4.1), [6.2, 6.55], [-0.02, 0.45], COLOR.doorFrame);
    }
  }
  tall.finish();
  void h;
}

// ----- south 3: the red-roofed hall with yellow bands -----

export function dressStriped(ctx: LotCtx): void {
  const { shell, h } = ctx;
  const YELLOW = '#e2bd10';
  const SOFFIT = '#6f757a';
  const SILVER = '#c3c8cb';
  for (const w of shell.walls) {
    const L = w.length;
    const span = (d0: number, d1: number) => w.w.span(d0, d1);
    w.plinth(COLOR.plinth, 0.9);
    // Red eaves band round the top.
    w.paint([-0.1, L + 0.1], [h - 1, h + 0.5], [-0.05, 0.25], RED);
    if (w.w.side === 's') {
      dockDoors(w, ctx);
      continue;
    }
    if (w.w.side === 'n') {
      // Yellow bands up the corners and beside the door, the street front's grey between.
      w.paint(span(0, 1.9), [0.9, 6.4], [-0.02, 0.06], YELLOW);
      w.paint(span(1.9, 6), [6.4, h - 1], [-0.02, 0.5], YELLOW);
      w.paint(span(2.3, 5.7), [h - 4, h - 1.8], [0.5, 0.56], COLOR.doorFrame);
      // The roller door with its pedestrian door.
      w.doorway(span(2.3, 6.2), 4.3, {
        leaf: 'roller',
        color: '#e1e3e3',
        frame: '#d4d6d5',
      });
      w.doorway(span(4.9, 5.9), 2.1, {
        leaf: 'panel',
        color: '#d4d6d5',
        frame: '#d4d6d5',
        depth: 0.06,
      });
      // Long canopy over the entrance, and the higher, rounder one further east.
      w.paint(span(-0.6, 10.6), [5.8, 6.5], [-0.02, 2.6], SOFFIT);
      w.paint(span(-0.6, 10.6), [6.5, 6.7], [2.3, 2.6], SILVER);
      w.paint(span(7.6, 13.6), [8.6, 9.3], [-0.02, 2.4], SOFFIT);
      w.paint(span(8.6, 12.6), [8.6, 9.3], [2.4, 3.1], SOFFIT);
      continue;
    }
    // The long sides: yellow at the street end, then light grey with a ribbon of windows high up
    // and small ones lower down.
    w.paint(span(0, 3.4), [0.9, h - 1], [-0.02, 0.06], YELLOW);
    for (let d = 5; d + 2.4 < L - 1; d += 3.4)
      w.window(span(d, d + 2.4), [h - 4.4, h - 2.2], {
        frame: SILVER,
        sill: false,
        depth: 0.1,
      });
    for (let d = 6; d + 0.7 < L - 1; d += 5.5)
      for (const y of [3.4, 8])
        w.window(span(d, d + 0.7), [y, y + 1.4], {
          frame: COLOR.doorFrame,
          sill: false,
          panes: 1,
          depth: 0.1,
        });
  }
  shell.finish();

  // The east block, longer towards the street: the same panels and red eaves, yellow up its street corners.
  const a = ctx.plot.annex!;
  const wing = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat: 'panel', tint: ctx.plot.walls },
    { mat: 'sheet', tint: ctx.plot.roof },
  );
  for (const w of wing.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.9);
    w.paint([-0.1, L + 0.1], [h - 1, h + 0.5], [-0.05, 0.25], RED);
    if (w.w.side === 'n') {
      w.paint(w.w.far(0, 2.6), [0.9, h - 1], [-0.02, 0.06], YELLOW);
      w.paint(w.w.far(2.9, 5.4), [0.9, 6.4], [-0.02, 0.06], YELLOW);
    } else if (w.w.side !== 's') {
      w.paint(w.w.span(0, 3.4), [0.9, h - 1], [-0.02, 0.06], YELLOW);
    }
  }
  wing.finish();
}

// ----- south 4: the logistics centre -----

export function dressLogistics(ctx: LotCtx): void {
  const { shell, plot, f, h } = ctx;
  const LOG_RED = '#d8442f';
  const DARK = '#5e6367';
  const BLUE = '#2c48ad';
  const STEEL = '#8f979c';
  const GREY = '#a1a5a8';
  for (const w of shell.walls) {
    const L = w.length;
    const near = fromFront(w, ctx);
    const isFront = w.w.side === ctx.front;
    w.plinth(COLOR.plinth, 0.5);
    // Roof overhang: a deep grey slab, thicker at the street end.
    w.paint(
      [-0.3, L + 0.3],
      [h - 0.7, h + 0.3],
      [-0.02, isFront ? 1.3 : 0.5],
      GREY,
    );
    if (isFront) {
      // Dark ground floor with glazing and a door, a red band, a fully glazed upper floor.
      w.box('panel', [0, L], [-0.1, 4.3], [-0.02, 0.3], DARK);
      w.applied([1.2, 6], [0.8, 3.4], 0.3, {
        across: 1.2,
        frame: COLOR.mullion,
      });
      w.paint([7, 9.6], [0, 3.2], [0.3, 0.4], COLOR.doorFrame);
      w.panel('glass', [7.15, 9.45], [0.1, 3.1], 0.44, '#ffffff', true);
      w.applied([11, L - 1.2], [0.8, 3.4], 0.3, {
        across: 1.2,
        frame: COLOR.mullion,
      });
      w.paint([2, 11.5], [3.55, 4.15], [0.3, 0.34], BLUE);
      w.paint([-0.3, L + 0.3], [4.3, 5.7], [-0.02, 1.2], LOG_RED);
      w.applied([1, L - 1], [5.9, h - 1], 0.02, {
        across: 1.5,
        rows: [7.6],
        frame: COLOR.mullion,
      });
      w.paint([-0.3, 1], [5.7, h - 0.7], [-0.02, 1.2], LOG_RED);
      w.paint([L - 1, L + 0.3], [5.7, h - 0.7], [-0.02, 1.2], LOG_RED);
    } else if (ctx.dockEdges.has(w.w.side)) {
      dockDoors(w, ctx);
    } else {
      // Sides: ribbon of small windows up top, a few below at the street end.
      const start = w.w.side === 'e' ? 24 : 6;
      for (let d = start; d + 2.2 < L - 3; d += 3.2)
        w.window(near(d, d + 2.2), [6.4, 7.6], {
          frame: COLOR.doorFrame,
          sill: false,
          depth: 0.1,
        });
      if (w.w.side === 'e')
        for (let d = 5; d + 2.4 < 20; d += 3.4)
          w.window(near(d, d + 2.4), [2.3, 3.5], {
            frame: COLOR.doorFrame,
            sill: false,
            depth: 0.1,
          });
      if (w.w.side === 'w') {
        // The glass wraps round the corner, over the same red band.
        w.box('panel', near(0, 4), [-0.1, 4.3], [-0.02, 0.3], DARK);
        w.paint(near(0, 4.5), [4.3, 5.7], [-0.02, 1.2], LOG_RED);
        w.applied(near(0.3, 4.2), [5.9, h - 1], 0.02, {
          across: 1.5,
          frame: COLOR.mullion,
        });
      }
    }
  }
  shell.finish();

  // The loading canopy: a flat steel roof on posts along its outer edge, a deep fascia; open underneath.
  const a = plot.annex!;
  const frames = wallFrames(a.corners);
  const outer = frames.find((fr) => fr.side === 'e');
  if (outer) {
    const w = new Wall(f, outer, a.height, { mat: 'panel', tint: '#b3b5b6' });
    const L = outer.length;
    const top = a.height;
    const depth = 7.3;
    w.box('metal', [0, L], [top - 0.3, top], [-depth, 0], STEEL);
    w.paint([-0.1, L + 0.1], [top - 1, top + 0.25], [-0.02, 0.2], GREY);
    for (let u = 0.4; u < L; u += 7)
      w.paint([u - 0.15, u + 0.15], [0, top - 0.3], [-0.6, -0.3], DARK);
    w.paint([L - 0.55, L - 0.25], [0, top - 0.3], [-0.6, -0.3], DARK);
  }
  void h;
}

// ----- south 5: the two dark sheds -----

export function dressSheds(ctx: LotCtx): void {
  const { shell, plot, f } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.5);
    w.coping(plot.roof, 0.35, 0.2, [-0.15, L + 0.15]);
    if (ctx.dockEdges.has(w.w.side)) dockDoors(w, ctx);
  }
  shell.finish();

  // The front shed: the same dark walls under its own roof colour, a tall opening for trucks to
  // drive into and a small door beside it.
  const a = plot.annex!;
  const shed = new Shell(
    f,
    a.corners,
    a.height,
    { mat: 'sheet', tint: a.walls ?? plot.walls },
    { mat: 'sheet', tint: a.roof ?? plot.roof },
  );
  for (const w of shed.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.5);
    w.coping(a.roof ?? plot.roof, 0.35, 0.2, [-0.15, L + 0.15]);
    if (w.w.side === ctx.front) {
      const span = (d0: number, d1: number) => w.w.span(d0, d1);
      w.doorway(span(2, 7.6), 5, { leaf: 'none', room: 11, frame: '#14171a' });
      w.doorway(span(9.4, 10.8), 2.3, {
        leaf: 'panel',
        color: COLOR.doorLeaf,
        frame: COLOR.doorFrame,
        depth: 0.1,
      });
    }
  }
  shed.finish();
}

// ----- south 6: the grey office block with a round glazed front -----

export function dressOffice(ctx: LotCtx): void {
  const { shell, plot, f, h } = ctx;
  const METAL = '#8b9096';
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.6);
    if (w.w.side === ctx.front) continue;
    // Grey metal cladding down from the eaves, then two floors of windows.
    w.box('metal', [-0.4, L + 0.4], [h - 1.7, h + 0.3], [-0.02, 0.95], METAL);
    let k = 0;
    for (let d = 2.2; d + 1.4 < L - 1.5; d += 3.4, k++)
      for (const y of [
        [1.3, 3],
        [4.6, 6.3],
      ] as [number, number][]) {
        w.window([d, d + 1.4], y, {
          frame: COLOR.doorFrame,
          sill: false,
          depth: 0.12,
        });
        // An air-conditioning unit beside every other upper window.
        if (k % 2 === 0 && y[0] > 4 && w.w.side !== 's') splitUnit(w, d + 1.7);
      }
  }
  shell.finish();

  // The round front: glass in two floors between grey slabs, a balcony rail round the roof, the
  // dark sign band and the entrance under it in red frames.
  const a = plot.annex!;
  const ah = a.height;
  const frontDir = edgesOf(plot.corners).find(
    (e) => e.side === ctx.front,
  )!.normal;
  for (const wf of wallFrames(a.corners)) {
    if (wf.normal.dot(frontDir) < 0.2) continue; // the flat back, inside the building
    const w = new Wall(f, wf, ah, { mat: 'panel', tint: METAL });
    const L = wf.length;
    for (const y of [0.05, 4.1, ah - 0.9])
      w.box('metal', [-0.05, L + 0.05], [y, y + 0.45], [-0.02, 0.2], METAL);
    w.applied([0, L], [0.5, 4.1], 0.0, { frame: COLOR.mullion, across: L });
    w.applied([0, L], [4.55, ah - 0.9], 0.0, {
      frame: COLOR.mullion,
      across: L,
    });
    for (const u of [0, L / 2])
      w.box(
        'paint',
        [u - 0.04, u + 0.04],
        [0.5, ah - 0.9],
        [-0.02, 0.1],
        COLOR.mullion,
      );
    // Balcony slab and rail on the roof edge.
    w.box('metal', [-0.1, L + 0.1], [ah, ah + 0.3], [-0.02, 0.6], METAL);
    w.paint([-0.05, L + 0.05], [ah + 0.3, ah + 1.1], [0.5, 0.54], '#f4f4f2');
    // Dark sign band in the middle of the front.
    if (wf.normal.dot(frontDir) > 0.85)
      w.paint([0, L], [ah - 0.85, ah - 0.1], [0.2, 0.28], '#26282b');
  }
  // Entrance: red frames on the middle segment, two steps out.
  const middle = wallFrames(a.corners)
    .filter((wf) => wf.normal.dot(frontDir) > 0.95)
    .sort((x, y) => y.length - x.length)[0];
  if (middle) {
    const w = new Wall(f, middle, ah, { mat: 'panel', tint: METAL });
    const L = middle.length;
    const m = L / 2;
    w.paint([m - 1.5, m - 1.3], [0.1, 3.6], [0.05, 0.16], RED);
    w.paint([m + 1.3, m + 1.5], [0.1, 3.6], [0.05, 0.16], RED);
    w.paint([m - 1.5, m + 1.5], [3.4, 3.6], [0.05, 0.16], RED);
    w.paint([m - 1.3, m + 1.3], [0.1, 3.4], [0.05, 0.1], COLOR.doorFrame);
    w.panel('glass', [m - 1.2, m + 1.2], [0.2, 3.3], 0.11, '#ffffff', true);
    w.paint([m - 1.8, m + 1.8], [0, 0.2], [0.2, 1.6], COLOR.steps);
    w.paint([m - 1.5, m + 1.5], [0.2, 0.4], [0.2, 1], COLOR.steps);
  }
  // The rotunda's roof, flat.
  f.polygon(
    'roofing',
    a.corners.map(([x, z]) => new Vector2(x, z)),
    ah,
    '#9aa0a5',
  );

  // The hipped roof over the main block: ridge along its length, shorter than the eaves.
  hippedRoof(f, plot.corners, h, plot.roof, ctx.front);
}
