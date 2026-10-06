import { Vector2 } from 'three';
import { Shell, type Wall } from '../wall';
import { planter, solarField, stonePot } from '../props';
import { COLOR, dockDoors, hippedRoof, ribbon, type LotCtx } from './common';

/**
 * The north side of the street, west to east: north 1 (the freight forwarder's warehouse with its
 * office tower), north 2 (car service), north 4 (glass-fronted showroom), north 5 (the framed hall)
 * and north 10 (the villa); the offices of north 6-9 are in `north-offices.ts`. Built with real
 * openings.
 */

/** Distances from the end of a wall nearest the street, as a u range. */
export const fromFront =
  (w: Wall, ctx: LotCtx) =>
  (d0: number, d1: number): [number, number] => {
    const L = w.length;
    const streetIsSouth = ctx.plot.side === 'north';
    const frontAtStart = streetIsSouth ? w.w.a.y > w.w.b.y : w.w.a.y < w.w.b.y;
    return frontAtStart ? [d0, d1] : [L - d1, L - d0];
  };

const RED = '#c8322b';

/** A slanted glass wall leaning out of a wall: from `base` (at `w0`) up to `top` (`lean` m further out). */
function leaningGlass(
  w: Wall,
  [u0, u1]: [number, number],
  base: number,
  top: number,
  w0: number,
  lean: number,
  bays: number,
  frame: string,
): void {
  w.quad(
    'glass',
    [
      [u0, base, w0],
      [u1, base, w0],
      [u1, top, w0 + lean],
      [u0, top, w0 + lean],
    ],
    '#ffffff',
    undefined,
    true,
  );
  const slope = lean / (top - base);
  const out = (y: number) => w0 + (y - base) * slope + 0.04;
  for (let i = 0; i <= bays; i++) {
    const u = u0 + ((u1 - u0) * i) / bays;
    w.quad(
      'paint',
      [
        [u - 0.05, base, out(base)],
        [u + 0.05, base, out(base)],
        [u + 0.05, top, out(top)],
        [u - 0.05, top, out(top)],
      ],
      frame,
      undefined,
      true,
    );
  }
  for (const y of [base + 0.05, 3.4, 6.5, 9.6, top - 0.1])
    w.quad(
      'paint',
      [
        [u0, y - 0.06, out(y - 0.06)],
        [u1, y - 0.06, out(y - 0.06)],
        [u1, y + 0.06, out(y + 0.06)],
        [u0, y + 0.06, out(y + 0.06)],
      ],
      frame,
      undefined,
      true,
    );
}

// ----- north 1: the freight forwarder's warehouse and office tower -----

export function dressHq(ctx: LotCtx): void {
  const { shell, plot, f } = ctx;
  const h = ctx.h;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.6);
    // Red eaves band, and ribs down the grey cladding.
    w.paint([-0.15, L + 0.15], [h - 0.9, h + 0.6], [-0.05, 0.3], RED);
    for (let u = 4; u < L - 2; u += 6)
      w.box('metal', [u - 0.2, u + 0.2], [0.6, h - 0.9], [0, 0.14], '#9da1a4');
    if (ctx.dockEdges.has(w.w.side)) dockDoors(w, ctx);
  }
  shell.finish();

  const a = plot.annex!;
  const ah = a.height;
  const tower = new Shell(
    f,
    a.corners,
    ah,
    { mat: 'panel', tint: '#6a6e72' },
    { mat: 'roofing', tint: RED },
  );
  const CENTRE = 6.4; // half the width of the glass entrance wall
  const PILLARS = 8.1; // and out to the far side of the red pillars
  for (const w of tower.walls) {
    const L = w.length;
    const m = L / 2;
    const facade = w.w.side === ctx.front;
    const street = facade || w.w.side === 'e' || w.w.side === 'w';
    w.paint(
      [-1, L + 1],
      [ah - 0.4, ah + 0.4],
      [-0.02, street ? 1.8 : 0.9],
      RED,
    );
    w.paint([-0.1, L + 0.1], [ah - 3.4, ah - 0.4], [-0.02, 0.7], '#d3d7da');
    for (let d = 0; m + d < L - 1.5; d += 0.4)
      for (const sign of d ? [1, -1] : [1])
        w.paint(
          [m + sign * d, m + sign * d + 0.12],
          [12.3, ah - 3.4],
          [-0.02, 0.22],
          '#e4e6e7',
        );
    if (!street) continue;
    // Glazing either side of the entrance (all along the sides).
    const zones: [number, number][] = facade
      ? [
          [0.8, m - PILLARS - 0.6],
          [m + PILLARS + 0.6, L - 0.8],
        ]
      : [[0.8, L - 0.8]];
    for (const [z0, z1] of zones) {
      for (const [y0, y1] of [
        [5.2, 8],
        [9.2, 12],
      ]) {
        w.paint(
          [z0 - 0.2, z1 + 0.2],
          [y0 - 0.65, y0 - 0.35],
          [-0.02, 1.7],
          RED,
        );
        w.applied([z0, z1], [y0, y1], 0.02, {
          across: 1.4,
          frame: COLOR.mullion,
        });
      }
      // Ground floor: separate windows in the dark cladding.
      for (let u = z0 + 0.6; u + 3.2 <= z1 - 0.4; u += 4)
        w.window([u, u + 3.2], [0.8, 3.4], {
          frame: COLOR.doorFrame,
          sill: false,
          panes: 3,
        });
    }
    if (!facade) continue;
    // The entrance wall: glass leaning out over its whole height under a red cap between the
    // pillars, with the doors, a red canopy and steps at the foot.
    const lean = 1.8;
    const base = 0.3;
    const top = ah - 3.6;
    leaningGlass(
      w,
      [m - CENTRE, m + CENTRE],
      base,
      top,
      0.08,
      lean,
      Math.round((2 * CENTRE) / 1.6),
      COLOR.mullion,
    );
    w.paint(
      [m - PILLARS, m + PILLARS],
      [top, top + 0.7],
      [-0.02, lean + 0.5],
      RED,
    );
    w.paint([m - PILLARS, m - CENTRE], [0, ah - 2.6], [-0.02, 2.3], RED);
    w.paint([m + CENTRE, m + PILLARS], [0, ah - 2.6], [-0.02, 2.3], RED);
    w.paint([m - 2.3, m + 2.3], [0, 3.2], [0, 0.62], COLOR.doorFrame);
    w.panel('glass', [m - 2.1, m + 2.1], [0.1, 3.05], 0.66, '#ffffff', true);
    w.paint([m - CENTRE, m + CENTRE], [4.6, 4.85], [0.6, 3.6], RED);
    w.paint([m - 3, m + 3], [0, 0.18], [0.3, 2.6], COLOR.steps);
    w.paint([m - 2.5, m + 2.5], [0.18, 0.36], [0.3, 1.6], COLOR.steps);
  }
  tower.finish();

  // Solar panels on both roofs: the warehouse's (behind the offices) and the offices' own.
  const wh = plot.corners.map(([x, z]) => new Vector2(x, z));
  solarField(f, wh, 3, [3, 4], h + 0.1);
  solarField(
    f,
    a.corners.map(([x, z]) => new Vector2(x, z)),
    1.8,
    [2, 1],
    ah + 0.1,
  );
}

// ----- north 2: the car service -----

export function dressService(ctx: LotCtx): void {
  const { shell, plot, f, h } = ctx;
  const BLUE = '#1f82d8';
  const GREY = '#8e9396';
  const WHITE = '#f4f4f2';
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.4);
    w.paint([-0.2, L + 0.2], [h - 0.1, h + 0.45], [0, 0.2], WHITE);
    if (w.w.side === ctx.front) {
      // Two open service bays between blue piers, under a deep blue canopy.
      w.paint([-0.3, L + 0.3], [4.1, 5], [0, 2.6], BLUE);
      w.paint([-0.3, L + 0.3], [5, 5.08], [0, 2.6], '#cfd3d6');
      const pier = 0.7;
      const bay = (L - 2 - 3 * pier) / 2;
      let u = 1;
      for (let k = 0; k < 2; k++) {
        w.paint([u, u + pier], [0, 4.1], [0, 0.35], BLUE);
        u += pier;
        // The dark workshop inside, folding door leaves swung back either side.
        w.doorway([u, u + bay], 4.1, {
          leaf: 'none',
          room: 9,
          frame: COLOR.workshop,
        });
        w.paint([u + 0.05, u + 0.15], [0.05, 4], [0.03, 1.3], COLOR.doorLeaf);
        w.paint(
          [u + bay - 0.15, u + bay - 0.05],
          [0.05, 4],
          [0.03, 1.3],
          COLOR.doorLeaf,
        );
        u += bay;
      }
      w.paint([u, u + pier], [0, 4.1], [0, 0.35], BLUE);
    } else {
      // Small high windows along the sides and back.
      for (let d = 2; d + 1.6 < L - 1; d += 3.5)
        w.window([d, d + 1.6], [2.7, 3.6], { frame: WHITE, sill: false });
    }
  }
  shell.finish();

  // The office block beside it: white render, a blue and a grey tower up the street front,
  // blue bands along the top, tall narrow windows.
  const a = plot.annex!;
  const ah = a.height;
  const office = new Shell(
    f,
    a.corners,
    ah,
    { mat: 'render', tint: '#f1f2f0' },
    { mat: 'roofing', tint: '#d9dcde' },
  );
  for (const w of office.walls) {
    const L = w.length;
    w.paint([-0.2, L + 0.2], [ah - 0.1, ah + 0.4], [-0.12, 0.26], WHITE);
    if (w.w.side === ctx.front) {
      // u runs west to east: the blue tower, the grey one, then white by the workshop.
      w.paint([-0.18, L * 0.44], [0, ah + 0.3], [-0.02, 0.22], BLUE);
      w.paint([L * 0.44, L * 0.73], [0, ah + 0.55], [-0.02, 0.32], GREY);
      w.paint([L * 0.73, L + 0.18], [ah - 1.6, ah + 0.3], [-0.02, 0.22], BLUE);
      const blue = L * 0.22;
      const grey = L * 0.585;
      const white = L * 0.865;
      w.applied([blue - 0.45, blue + 0.45], [1, 3.1], 0.22, {
        frame: WHITE,
        sill: true,
      });
      w.applied([blue - 0.45, blue + 0.45], [3.6, 6.4], 0.22, {
        frame: WHITE,
        sill: true,
      });
      w.applied([grey - 0.4, grey + 0.4], [0.5, 2.5], 0.32, {
        frame: WHITE,
        sill: true,
      });
      w.applied([grey - 0.4, grey + 0.4], [3.6, 6.4], 0.32, {
        frame: WHITE,
        sill: true,
      });
      w.window([white - 0.4, white + 0.4], [3.6, 6.4], { frame: WHITE });
    } else {
      w.paint([-0.18, L + 0.18], [ah - 1.6, ah - 0.1], [-0.02, 0.2], BLUE);
      if (w.w.side === 'w')
        for (const d of [L * 0.3, L * 0.7]) {
          w.window([d - 0.45, d + 0.45], [1, 3.1], { frame: WHITE });
          w.window([d - 0.45, d + 0.45], [3.6, 6.4], { frame: WHITE });
        }
    }
  }
  office.finish();
}

// ----- north 4: the glass-fronted showroom -----

export function dressShowroom(ctx: LotCtx): void {
  const { shell, h } = ctx;
  const CLAD = '#5d6266';
  const FASCIA = '#eceeed';
  const frontWall = shell.side(ctx.front)!;
  for (const w of shell.walls) {
    const L = w.length;
    // White fascia band round the top, standing proud of the walls as a parapet.
    w.paint([-0.3, L + 0.3], [h - 2, h + 0.4], [-0.02, 0.32], FASCIA);
    if (w === frontWall) {
      // Dark cladding, glazed in three tall bays between piers; the entrance in the middle.
      w.box('panel', [-0.25, L + 0.25], [-0.1, h - 2], [-0.02, 0.25], CLAD);
      const pier = 1.3;
      const bay = (L - 4 * pier) / 3;
      for (let k = 0; k < 3; k++) {
        const u0 = pier + k * (bay + pier);
        const u1 = u0 + bay;
        const top = h - 2.3;
        w.applied([u0, u1], [0.35, top], 0.27, {
          across: 1.1,
          rows: [3.3, 4.1, top - 2],
          frame: COLOR.mullion,
        });
        if (k === 1) {
          const m = (u0 + u1) / 2;
          w.paint(
            [m - 1.1, m + 1.1],
            [0.35, 2.9],
            [0.28, 0.36],
            COLOR.doorFrame,
          );
          w.panel('glass', [m - 1, m + 1], [0.4, 2.8], 0.37, '#ffffff', true);
          w.paint([m - 2.2, m + 2.2], [3.2, 3.35], [0.3, 2], '#9ca2a6');
          w.paint([m - 2, m + 2], [0, 0.18], [0.3, 1.8], COLOR.steps);
          w.paint([m - 1.6, m + 1.6], [0.18, 0.34], [0.3, 1.1], COLOR.steps);
        }
      }
      continue;
    }
    w.plinth(COLOR.plinth, 0.5);
    const near = fromFront(w, ctx);
    // The dark front wraps round the corner, with a tall strip of glass in it.
    w.box('panel', near(-0.24, 3), [-0.1, h - 2], [-0.02, 0.24], CLAD);
    w.applied(near(0.9, 2.3), [0.35, h - 2.3], 0.27, { frame: COLOR.mullion });
    // Two ribbons of windows in the light panels.
    for (let d = 5; d + 2.6 < L - 1.5; d += 4.4)
      for (const y of [
        [4.9, 6],
        [6.6, 7.6],
      ] as [number, number][])
        w.window(near(d, d + 2.6), y, {
          frame: COLOR.doorFrame,
          sill: false,
          panes: 2,
          depth: 0.1,
        });
    // Two roller doors off the west drive, behind the office.
    if (w.w.side === 'w')
      for (const d of [L * 0.42, L * 0.42 + 6.5])
        w.doorway(near(d, d + 4.6), 4.3, {
          leaf: 'roller',
          color: '#d3d7da',
          frame: COLOR.doorFrame,
        });
  }
  shell.finish();
}

// ----- plain warehouse: the default style (no lot uses it since north 6-9 got their offices) -----

export function dressPlain(ctx: LotCtx): void {
  const { shell, plot, f } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth(COLOR.plinth, 0.9);
    // Roof edge, a little proud of the wall and standing above the roof.
    w.coping(plot.roof, 0.375, 0.25);
    if (ctx.dockEdges.has(w.w.side)) dockDoors(w, ctx);
    else if (w.w.side === ctx.front && L > 12) {
      // Street side: a ribbon of office windows.
      for (let u = 3; u + 1.1 < L - 2; u += 4)
        w.window([u - 1.2, u + 1.2], [1.7, 3.3], {
          frame: COLOR.doorFrame,
          panes: 2,
        });
    } else if (L > 14) {
      ribbon(w, [3, L - 3], { width: 2.2, pitch: 5, y: [5.2, 6.4] });
    }
  }
  shell.finish();
  // Solar panels on the roof (the north 9 warehouse has a full field).
  if (plot.solar)
    solarField(
      f,
      plot.corners.map(([x, z]) => new Vector2(x, z)),
      2.5,
      [3, 3],
      plot.height + 0.1,
    );
}

// ----- north 10: the villa at the east end -----

export function dressHouse(ctx: LotCtx): void {
  const { shell, plot, f, h } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    const isFront = w.w.side === ctx.front;
    w.plinth('#bdb7aa', 0.5);
    // Fascia under the eaves.
    w.paint([-0.2, L + 0.2], [h - 0.15, h + 0.12], [-0.02, 0.28], '#f2eee4');
    const n = Math.max(2, Math.floor((L - 1) / 3.2));
    for (let k = 0; k < n; k++) {
      const u = (L * (k + 0.5)) / n;
      const door = isFront && k === Math.floor(n / 2);
      if (door) {
        w.doorway([u - 0.6, u + 0.6], 2.2, {
          leaf: 'panel',
          color: '#6b4a2f',
          frame: '#f2eee4',
          depth: 0.15,
        });
        w.paint([u - 1.4, u + 1.4], [2.35, 2.5], [0, 1.1], '#cfc9bb'); // little canopy
        w.paint([u - 1, u + 1], [0, 0.18], [0, 0.9], '#cfc9bb'); // step
      } else
        w.window([u - 0.65, u + 0.65], [0.9, 2.3], {
          frame: '#f6f3ea',
          panes: 2,
        });
      w.window([u - 0.65, u + 0.65], [3.5, 4.9], {
        frame: '#f6f3ea',
        panes: 2,
      });
    }
  }
  shell.finish();
  hippedRoof(f, plot.corners, h, plot.roof, ctx.front, 2.6);
}

// ----- north 5: the dark hall under the red portal frame -----

const PORTAL_RED = '#b00c14';
const CHARCOAL = '#3b3f43';
const FRAME_DARK = '#202326';

/**
 * A leaning column of the red portal frame: `bottom` / `top` are its u ranges at `y0` / `y1`, standing
 * `depth` m out of the wall (its front and both sides; the band and the wall cover the rest).
 */
function redColumn(
  w: Wall,
  bottom: [number, number],
  top: [number, number],
  [y0, y1]: [number, number],
  depth: number,
): void {
  const q = (p: [number, number, number][]) =>
    w.quad('paint', p, PORTAL_RED, undefined, true);
  q([
    [bottom[0], y0, depth],
    [bottom[1], y0, depth],
    [top[1], y1, depth],
    [top[0], y1, depth],
  ]);
  q([
    [bottom[0], y0, 0],
    [bottom[0], y0, depth],
    [top[0], y1, depth],
    [top[0], y1, 0],
  ]);
  q([
    [bottom[1], y0, depth],
    [bottom[1], y0, 0],
    [top[1], y1, 0],
    [top[1], y1, depth],
  ]);
}

/**
 * North 5 (ref-17..19): charcoal panel walls; the street front is recessed behind a red portal frame (a
 * band 1 m proud over the whole width and leaning columns at each end) with three glazed sectional doors
 * standing a little open between pillars; the entrance, a red balcony slab and the glazed upper door
 * at the east end; a ribbon of tall narrow windows high in the side walls.
 */
export function dressFramed(ctx: LotCtx): void {
  const { shell, h } = ctx;
  const OUT = 1; // how far the frame stands out of the door wall
  const BAND: [number, number] = [6, 7.8];
  for (const w of shell.walls) {
    const L = w.length;
    w.coping('#2e3236', 0.14, 0.1);
    if (w.w.side !== ctx.front) {
      w.plinth('#2a2d30', 0.4);
      const near = fromFront(w, ctx);
      for (let d = 3; d + 0.8 < L - 1.5; d += 3.2)
        w.window(near(d, d + 0.8), [h - 2.8, h - 1.4], {
          frame: FRAME_DARK,
          sill: false,
          panes: 1,
          depth: 0.1,
        });
      continue;
    }
    // Doors between pillars, from the west column to the entrance block.
    const PIER = 0.9;
    const start = 1.7;
    const end = L - 5.3;
    const bay = (end - start - 2 * PIER) / 3;
    const DOOR = 4.5;
    const LIFT = 0.9; // the leaf hangs this far off the floor: a dark gap under it
    const at = -0.16 + 0.06;
    for (let k = 0; k < 3; k++) {
      const u0 = start + k * (bay + PIER);
      const u1 = u0 + bay;
      w.doorway([u0, u1], DOOR, { leaf: 'none', room: 10, frame: FRAME_DARK });
      w.panel('panel', [u0, u1], [LIFT, 2.15], at, CHARCOAL);
      w.panel('panel', [u0, u1], [3.85, DOOR], at, CHARCOAL);
      w.panel(
        'glass',
        [u0 + 0.12, u1 - 0.12],
        [2.15, 3.85],
        at,
        '#ffffff',
        true,
      );
      for (const y of [2.15, 3.85])
        w.paint(
          [u0, u1],
          [y - 0.06, y + 0.06],
          [at - 0.01, at + 0.04],
          FRAME_DARK,
        );
      for (let m = 0; m <= 4; m++) {
        const u = u0 + 0.12 + ((bay - 0.24) * m) / 4;
        w.paint(
          [u - 0.035, u + 0.035],
          [2.15, 3.85],
          [at - 0.01, at + 0.04],
          FRAME_DARK,
        );
      }
      // The pier after the door, a shade lighter than the wall.
      if (k < 2) w.paint([u1, u1 + PIER], [0, BAND[0]], [0, 0.12], '#464a4e');
    }
    w.paint([end, end + 0.5], [0, BAND[0]], [0, 0.12], '#464a4e');

    // The red portal frame: the band, its columns, and spots in the soffit.
    w.paint([-0.7, L + 0.7], BAND, [0, OUT], PORTAL_RED);
    redColumn(w, [0, 1], [-0.7, 1], [0, BAND[0]], OUT);
    redColumn(w, [L - 5, L - 3.7], [L - 4.3, L - 3.4], [0, BAND[0]], OUT);
    redColumn(w, [L - 1.5, L - 0.1], [L - 1.5, L + 0.7], [0, BAND[0]], OUT);
    for (const u of [
      start + bay + PIER / 2,
      start + 2 * (bay + PIER) - PIER / 2,
    ])
      w.paint(
        [u - 0.12, u + 0.12],
        [BAND[0] - 0.04, BAND[0]],
        [0.4, 0.64],
        '#f6f3e6',
      );

    // The entrance: glazed door and sidelights, steps; above it the red balcony slab with a dark glass
    // balustrade and the glazed upper door.
    const e0 = L - 3.4;
    const e1 = L - 1.5;
    w.paint([e0 - 0.3, e1 + 0.3], [0, 0.16], [0, OUT], COLOR.steps);
    w.applied([e0 + 0.1, e1 - 0.1], [0.16, 2.8], 0.04, {
      frame: COLOR.mullion,
      across: 0.95,
      rows: [2.2],
    });
    w.paint([e0, e1], [2.9, 3.5], [0, OUT], PORTAL_RED);
    w.paint([e0, e1], [3.5, 4.4], [OUT - 0.1, OUT - 0.02], '#2f3337');
    w.paint([e0, e1], [4.4, 4.48], [OUT - 0.12, OUT], '#25282b');
    for (const u of [e0, e1 - 0.06])
      w.paint([u, u + 0.06], [3.5, 4.48], [0, OUT], '#25282b');
    w.applied([e0 + 0.1, e1 - 0.1], [4.5, BAND[0] - 0.05], 0.04, {
      frame: COLOR.mullion,
      across: 0.8,
    });

    // The Mileks lot's pots against the front (ref-18: clipped balls in urns, dwarf conifers in planters).
    for (const [u, out] of [
      [-0.9, 0.6],
      [L - 5.8, 0.6],
    ]) {
      const q = w.w.point(u, out);
      stonePot(ctx.f, q.x, q.y);
    }
    for (const [u, out] of [
      [-2, 0.5],
      [L - 0.8, 1.5],
    ]) {
      const q = w.w.point(u, out);
      planter(ctx.f, q.x, q.y);
    }
  }
  shell.finish();
}
