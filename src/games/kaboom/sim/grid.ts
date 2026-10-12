import { CELL_SIZE } from './rules';

/** Cell index in the typed arrays of a `w`-wide grid. */
export const cellIndex = (w: number, x: number, y: number): number => y * w + x;

export const inBounds = (w: number, h: number, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < w && y < h;

/** World X (metres) of a grid x in cell units; the grid is centred on the origin, `y` maps to world Z. */
export const gridToWorldX = (w: number, x: number): number =>
  (x - w / 2) * CELL_SIZE;
export const gridToWorldZ = (h: number, y: number): number =>
  (y - h / 2) * CELL_SIZE;
