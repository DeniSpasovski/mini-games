import { FOOT, gabledBox, hole, TRIM, type Local, type Wall } from './common';

/**
 * A station of the Millennium Cross cable car: a long low hall under a gabled roof with a wide opening in the end wall
 * the ropes run through (7 m above the ground: `aerialways` `stationHeight`), a row of windows along the sides and a
 * dark band under the eaves. Local x runs along the rope line (+x up the line); the building is `length` x `width`.
 * `openEnd` = +1: the ropes leave the up-line end (lower station), -1: they arrive at the down-line end (upper station).
 */
const EAVE = 7.8;
const RIDGE = 9.6;
const WALL = { key: 'render', color: '#d9dbd6' } as const;

export function buildStation(
  l: Local,
  length: number,
  width: number,
  openEnd: 1 | -1,
): void {
  const x0 = -length / 2;
  const x1 = length / 2;
  const hw = width / 2;
  gabledBox(l, x0, x1, -hw, hw, EAVE, RIDGE, WALL, false, {
    roofColor: '#9aa29f',
  });
  l.box(
    'wall',
    [x0 - 0.1, FOOT, -hw - 0.1],
    [x1 + 0.1, 0.5, hw + 0.1],
    '#b9b6ae',
  );
  // The opening for the ropes and the cabins, on the open end wall.
  const end: Wall =
    openEnd > 0
      ? { o: [x1, 0, 0], n: [1, 0, 0] }
      : { o: [x0, 0, 0], n: [-1, 0, 0] };
  hole(l, end, -hw + 0.8, 3.0, hw - 0.8, EAVE - 0.3, '#1c2024');
  // Windows along both sides, a dark band under the eaves.
  for (const side of [-1, 1]) {
    const w: Wall = { o: [0, 0, side * hw], n: [0, 0, side] };
    for (let x = x0 + 3; x < x1 - 2; x += 4)
      hole(l, w, side * x - 0.9, 3.4, side * x + 0.9, 5.2, '#2a3036');
    l.box(
      'paint',
      [x0, EAVE - 0.5, side * hw - 0.03],
      [x1, EAVE, side * hw + 0.03],
      TRIM,
    );
  }
  // The closed end wall: a door.
  const shut: Wall =
    openEnd > 0
      ? { o: [x0, 0, 0], n: [-1, 0, 0] }
      : { o: [x1, 0, 0], n: [1, 0, 0] };
  hole(l, shut, -1.0, 0.0, 1.0, 2.6, '#3b3f44');
}
