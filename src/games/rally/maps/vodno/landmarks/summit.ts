import { CylinderGeometry } from 'three';
import {
  arc,
  coneRoof,
  FOOT,
  flatTop,
  LIFT,
  placeAt,
  PLINTH,
  ringWalls,
  slit,
  TRIM,
  type Local,
  type V2,
  type V3,
  type Wall,
} from './common';
import { LODGE_OUTLINE, PLATFORM_RADIUS } from './sites';

/**
 * The summit of Vodno (Krstovar, 1 066 m): the platform of the Millennium Cross and the Dare Dzambaz mountain lodge.
 *
 * Platform (OSM way 618009929): a round platform 24 m across on twelve columns - the twelve apostles - round a solid core;
 * the cross (asset `millennium_cross`) rises through its deck. Modelled as a core drum, twelve square columns, a deck
 * slab with a parapet, a flight of steps and a paved apron.
 *
 * Lodge (OSM way 229939243): a stone house of two floors made of a round tower and a fan-shaped hall, tiled cone roofs.
 */
const CORE_R = 7.2;
const COLUMN_R = 10.1;
const DECK_Y = 5.0;
const DECK_T = 0.8;
const PARAPET = 1.1;
const CONCRETE = '#d8d4cb';

const circle = (r: number, n: number): V2[] =>
  arc(0, 0, r, 0, Math.PI * 2, n).slice(0, -1);

export function buildPlatform(l: Local): void {
  // Paved apron round the platform (a little over the levelled pad).
  flatTop(l, circle(PLATFORM_RADIUS + 1.6, 28), 0.04, 'pavers', '#c3bdb0');
  // Solid core and the deck over it.
  l.add(
    'wall',
    new CylinderGeometry(CORE_R, CORE_R, DECK_Y - FOOT, 28),
    CONCRETE,
    placeAt(0, (DECK_Y + FOOT) / 2, 0),
  );
  l.add(
    'wall',
    new CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS, DECK_T, 36),
    '#cfcac0',
    placeAt(0, DECK_Y + DECK_T / 2, 0),
  );
  // Twelve columns round it.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    l.box(
      'wall',
      [-0.5, FOOT, -0.5],
      [0.5, DECK_Y, 0.5],
      CONCRETE,
      placeAt(Math.cos(a) * COLUMN_R, 0, Math.sin(a) * COLUMN_R, -a),
    );
  }
  // Parapet of 24 pieces on the deck's rim.
  const top = DECK_Y + DECK_T;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const len = (Math.PI * 2 * (PLATFORM_RADIUS - 0.3)) / n + 0.05;
    l.box(
      'wall',
      [-0.3, 0, -len / 2],
      [0.3, PARAPET, len / 2],
      CONCRETE,
      placeAt(
        Math.cos(a) * (PLATFORM_RADIUS - 0.3),
        top,
        Math.sin(a) * (PLATFORM_RADIUS - 0.3),
        -a,
      ),
    );
  }
  // Steps up to the deck on the south side (a gap in the parapet is left by the stairs' width).
  for (let i = 0; i < 9; i++) {
    const h = ((i + 1) / 9) * (DECK_Y + DECK_T);
    l.box(
      'wall',
      [-3.2, FOOT, PLATFORM_RADIUS - 0.3 + (8 - i) * 0.4],
      [3.2, h, PLATFORM_RADIUS + 3.6],
      '#cbc6bc',
    );
  }
}

/** Walls' arched windows along every edge of `pts` that is long enough, in two rows. */
function windowsAlong(l: Local, pts: V2[], rows: number[]): void {
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1.4) continue;
    // Outward normal of a CCW outline (ringWalls' convention): (dz, -dx).
    let area = 0;
    for (let k = 0; k < pts.length; k++) {
      const [px, pz] = pts[k];
      const [qx, qz] = pts[(k + 1) % pts.length];
      area += px * qz - qx * pz;
    }
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const n: V3 = area > 0 ? [dz, 0, -dx] : [-dz, 0, dx];
    // The wall's own axis: its `right` is (n.z, -n.x), a point at the edge's start.
    const w: Wall = { o: [ax, 0, az], n };
    const right = [n[2], -n[0]];
    const along = dx * right[0] + dz * right[1] > 0 ? 1 : -1;
    for (const y0 of rows) slit(l, w, (along * len) / 2, y0, 0.55, 1.5);
  }
}

export function buildLodge(l: Local): void {
  const pts: V2[] = LODGE_OUTLINE;
  const EAVE = 6.2;
  ringWalls(l, pts, FOOT, EAVE, 'rubble', '#e6ded0');
  ringWalls(
    l,
    pts.map(([x, z]): V2 => [x * 1.012, z * 1.012]),
    FOOT,
    0.5,
    'ashlar',
    PLINTH,
  );
  windowsAlong(l, pts, [1.3, 3.9]);
  // Roofs: a cone over the round tower, a fan over the hall (apex at the fan's centre).
  const tower = { x: 0.8, z: -3.0, r: 6.0 };
  coneRoof(
    l,
    tower.x,
    tower.z,
    tower.r,
    0,
    Math.PI * 2,
    16,
    EAVE,
    [tower.x, EAVE + 3.4, tower.z],
    0.35,
  );
  const arcPts = pts.slice(13, 25);
  const apex: V3 = [0.2, EAVE + 2.6 + LIFT, 0.8];
  for (let i = 0; i + 1 < arcPts.length; i++) {
    const [ax, az] = arcPts[i];
    const [bx, bz] = arcPts[i + 1];
    // Grown a little outwards from the fan's centre for the eave overhang.
    const g = (x: number, z: number): V3 => {
      const d = Math.hypot(x - apex[0], z - apex[2]) || 1;
      return [
        x + ((x - apex[0]) / d) * 0.35,
        EAVE + LIFT - 0.15,
        z + ((z - apex[2]) / d) * 0.35,
      ];
    };
    l.roof([g(ax, az), g(bx, bz), apex], { trim: [0] });
  }
  // The fan's two straight sides: gable-like roof edges hide against the tower; a chimney on the hall.
  l.box('rubble', [-3.6, EAVE, 3.0], [-2.7, EAVE + 3.4, 3.9], '#d6cdbd');
  l.box('metal', [-3.65, EAVE + 3.4, 2.95], [-2.65, EAVE + 3.6, 3.95], TRIM);
}
