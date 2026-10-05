import { Color, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three';
import { edgesOf, type Compass } from '../layout';
import type { Corner } from '../frame';
import type { Frame } from './kit';
import type { MatKey } from './materials';

/**
 * Walls of a building. A wall has its own coordinates: u along it (to the right when looking at
 * it from outside), y up, w out of the building. Features are boxes / quads in those coordinates,
 * or openings (windows, doors, bays) cut into the wall sheet with real reveals, frames and a dark
 * room behind the glass, so a window reads as a window from any angle.
 */
export interface WallFrame {
  /** Start of the wall (site metres) and the wall's direction: u grows from a to b. */
  a: Vector2;
  b: Vector2;
  dir: Vector2;
  /** Unit normal out of the building. */
  normal: Vector2;
  length: number;
  side: Compass;
  /** Local (u, y, w) -> site (x, y, z). */
  matrix: Matrix4;
  /**
   * Distances `d0..d1` measured from the wall's reference end (the west end of a street or back
   * wall, the north end of a side wall) as a u range.
   */
  span(d0: number, d1: number): [number, number];
  /** Distances measured from the other end (east / south). */
  far(d0: number, d1: number): [number, number];
  /** Site point at (u, w). */
  point(u: number, w?: number): Vector2;
}

/** Wall frames of a footprint, one per edge, in corner order. */
export function wallFrames(corners: Corner[]): WallFrame[] {
  return edgesOf(corners).map((e) => {
    let { a, b, dir } = e;
    // u must grow to the right seen from outside: normal = (-dir.y, dir.x). Reverse the edge if not.
    const wants = new Vector2(-dir.y, dir.x);
    if (wants.dot(e.normal) < 0) {
      [a, b] = [b, a];
      dir = dir.clone().negate();
    }
    const across = e.side === 'n' || e.side === 's';
    // Reference end: west (across walls) or north (side walls) - start of u or its end.
    const refAtStart = across ? dir.x > 0 : dir.y > 0;
    const L = e.length;
    const matrix = new Matrix4().makeBasis(
      new Vector3(dir.x, 0, dir.y),
      new Vector3(0, 1, 0),
      new Vector3(e.normal.x, 0, e.normal.y),
    );
    matrix.setPosition(a.x, 0, a.y);
    return {
      a,
      b,
      dir,
      normal: e.normal,
      length: L,
      side: e.side,
      matrix,
      span: (d0, d1) => (refAtStart ? [d0, d1] : [L - d1, L - d0]),
      far: (d0, d1) => (refAtStart ? [L - d1, L - d0] : [d0, d1]),
      point: (u, w = 0) =>
        new Vector2(
          a.x + dir.x * u + e.normal.x * w,
          a.y + dir.y * u + e.normal.y * w,
        ),
    };
  });
}

/** Opening cut into a wall sheet: u0..u1 across, y0..y1 up. */
type Cut = [number, number, number, number];

export interface Look {
  /** Wall material and paint. */
  mat: MatKey;
  tint: string;
}

const shade = (hex: string, k: number): string =>
  `#${new Color(hex).multiplyScalar(k).getHexString()}`;
export { shade };

const DARK = '#14181b';

export interface WindowOptions {
  /** Glass divided into this many panes by mullions (default 2). */
  panes?: number;
  /** Frame paint (default white). */
  frame?: string;
  /** A stone sill below the opening (default true). */
  sill?: boolean;
  /** Depth of the reveal, metres (default 0.14). */
  depth?: number;
  /** Horizontal transom this far below the top (0 = none). */
  transom?: number;
  /** Mullions in this paint (default frame). */
  mullion?: string;
}

/**
 * One wall of a building: builds boxes, quads and openings in the wall's own coordinates and, on
 * `finish()`, the wall sheet (with every opening cut out) itself.
 */
export class Wall {
  private cuts: Cut[] = [];
  /** Sheet bottom: below the ground so a sloping pad never shows a gap under the wall. */
  static readonly SKIRT = 0.6;

  constructor(
    readonly f: Frame,
    readonly w: WallFrame,
    readonly height: number,
    readonly look: Look,
  ) {}

  get length(): number {
    return this.w.length;
  }

  private m(): { matrix: Matrix4 } {
    return { matrix: this.w.matrix };
  }

  /** Box: u0..u1 along, y0..y1 up, w0..w1 out of the wall (negative = into the building). */
  box(
    key: MatKey,
    [u0, u1]: [number, number],
    [y0, y1]: [number, number],
    [w0, w1]: [number, number],
    color: string,
    o: { bottom?: boolean; top?: boolean } = {},
  ): void {
    this.f.box(key, [u0, y0, w0], [u1, y1, w1], color, { ...this.m(), ...o });
  }

  /** Painted box (the usual trim). */
  paint(
    u: [number, number],
    y: [number, number],
    w: [number, number],
    color: string,
  ): void {
    this.box('paint', u, y, w, color);
  }

  /** A quad in wall coordinates (counter-clockwise seen from outside, +w). */
  quad(
    key: MatKey,
    p: [number, number, number][],
    color: string,
    uv?: [number, number][],
    raw = false,
  ): void {
    this.f.quad(key, p[0], p[1], p[2], p[3], color, uv, {
      ...this.m(),
      rawUv: raw,
    });
  }

  /** A flat panel on the wall: u0..u1, y0..y1 at w, facing out. */
  panel(
    key: MatKey,
    [u0, u1]: [number, number],
    [y0, y1]: [number, number],
    w: number,
    color: string,
    raw = false,
  ): void {
    this.quad(
      key,
      [
        [u0, y0, w],
        [u1, y0, w],
        [u1, y1, w],
        [u0, y1, w],
      ],
      color,
      raw
        ? [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ]
        : [
            [u0, y0],
            [u1, y0],
            [u1, y1],
            [u0, y1],
          ],
      raw,
    );
  }

  /** Low plinth along the whole wall (or part of it). */
  plinth(
    color: string,
    h = 0.5,
    [u0, u1]: [number, number] = [0, this.length],
  ): void {
    this.paint([u0, u1], [-0.1, h], [-0.02, 0.05], color);
  }

  /** Roof edge cap standing `above` m over the wall top, overhanging `out` m. */
  coping(
    color: string,
    above = 0.3,
    out = 0.2,
    [u0, u1]: [number, number] = [-0.15, this.length + 0.15],
  ): void {
    this.paint(
      [u0, u1],
      [this.height - 0.12, this.height + above],
      [-0.06, out],
      color,
    );
  }

  /**
   * An opening (window, glazed door, bay) cut into the wall: reveals, a dark room behind. Returns
   * the depth of the reveal; callers add glass / frames / doors in it.
   */
  opening(u0: number, u1: number, y0: number, y1: number, depth: number): void {
    this.cuts.push([u0, u1, y0, y1]);
    const reveal = shade(this.look.tint, 0.78);
    const d = -depth;
    const q = (p: [number, number, number][]) =>
      this.quad('paint', p, reveal, undefined, true);
    // Left / right / top / bottom reveals, facing into the opening.
    q([
      [u0, y0, 0],
      [u0, y0, d],
      [u0, y1, d],
      [u0, y1, 0],
    ]);
    q([
      [u1, y0, d],
      [u1, y0, 0],
      [u1, y1, 0],
      [u1, y1, d],
    ]);
    q([
      [u0, y1, d],
      [u1, y1, d],
      [u1, y1, 0],
      [u0, y1, 0],
    ]);
    q([
      [u0, y0, 0],
      [u1, y0, 0],
      [u1, y0, d],
      [u0, y0, d],
    ]);
  }

  /** Glass at depth `d` in the opening, paned, framed. */
  glazing(
    u0: number,
    u1: number,
    y0: number,
    y1: number,
    d: number,
    o: WindowOptions = {},
  ): void {
    const t = 0.055;
    const frame = o.frame ?? '#f2f3f1';
    const mull = o.mullion ?? frame;
    const gd = -d + 0.02;
    // The room behind the glass.
    this.quad(
      'paint',
      [
        [u0, y0, gd - 0.5],
        [u1, y0, gd - 0.5],
        [u1, y1, gd - 0.5],
        [u0, y1, gd - 0.5],
      ],
      DARK,
      undefined,
      true,
    );
    this.panel('glass', [u0, u1], [y0, y1], gd, '#ffffff', true);
    const fw = -d + 0.07;
    // Frame: four flat strips just in front of the glass.
    this.panel('paint', [u0, u1], [y1 - t, y1], fw, frame);
    this.panel('paint', [u0, u1], [y0, y0 + t], fw, frame);
    this.panel('paint', [u0, u0 + t], [y0 + t, y1 - t], fw, frame);
    this.panel('paint', [u1 - t, u1], [y0 + t, y1 - t], fw, frame);
    const panes = o.panes ?? 2;
    for (let k = 1; k < panes; k++) {
      const u = u0 + ((u1 - u0) * k) / panes;
      this.panel('paint', [u - t / 2, u + t / 2], [y0 + t, y1 - t], fw, mull);
    }
    if (o.transom)
      this.panel(
        'paint',
        [u0 + t, u1 - t],
        [y1 - o.transom - t / 2, y1 - o.transom + t / 2],
        fw,
        mull,
      );
  }

  /** A window: opening + glazing + sill. */
  window(
    [u0, u1]: [number, number],
    [y0, y1]: [number, number],
    o: WindowOptions = {},
  ): void {
    const d = o.depth ?? 0.14;
    this.opening(u0, u1, y0, y1, d);
    this.glazing(u0, u1, y0, y1, d, o);
    if (o.sill !== false)
      this.paint(
        [u0 - 0.06, u1 + 0.06],
        [y0 - 0.06, y0 + 0.0],
        [0, 0.14],
        '#dcd9d2',
      );
  }

  /**
   * Glass applied to the wall face (or to a box standing on it) at distance `at` out of the wall:
   * no opening is cut. A framed window or, with `grid`, a curtain wall of mullions and transoms.
   */
  applied(
    [u0, u1]: [number, number],
    [y0, y1]: [number, number],
    at: number,
    o: {
      frame?: string;
      /** Mullions every this many metres (default: one pane). */
      across?: number;
      /** Transoms at these heights (m). */
      rows?: number[];
      sill?: boolean;
      thickness?: number;
    } = {},
  ): void {
    const t = o.thickness ?? 0.05;
    const frame = o.frame ?? '#3a3f43';
    this.panel('glass', [u0, u1], [y0, y1], at, '#ffffff', true);
    const d = 0.045;
    this.box(
      'paint',
      [u0 - t, u1 + t],
      [y1, y1 + t],
      [at - 0.01, at + d],
      frame,
    );
    this.box(
      'paint',
      [u0 - t, u1 + t],
      [y0 - t, y0],
      [at - 0.01, at + d],
      frame,
    );
    this.box('paint', [u0 - t, u0], [y0, y1], [at - 0.01, at + d], frame);
    this.box('paint', [u1, u1 + t], [y0, y1], [at - 0.01, at + d], frame);
    if (o.across) {
      const n = Math.max(1, Math.round((u1 - u0) / o.across));
      for (let k = 1; k < n; k++) {
        const u = u0 + ((u1 - u0) * k) / n;
        this.box(
          'paint',
          [u - t / 2, u + t / 2],
          [y0, y1],
          [at - 0.01, at + d],
          frame,
        );
      }
    }
    for (const y of o.rows ?? [])
      this.box(
        'paint',
        [u0, u1],
        [y - t / 2, y + t / 2],
        [at - 0.01, at + d],
        frame,
      );
    if (o.sill)
      this.paint(
        [u0 - 0.06, u1 + 0.06],
        [y0 - 0.08, y0 - 0.02],
        [at - 0.02, at + 0.14],
        '#dcd9d2',
      );
  }

  /**
   * A door / bay opening from the ground up. `leaf` fills it (roller door, glazed door, or none:
   * an open bay on a dark room).
   */
  doorway(
    [u0, u1]: [number, number],
    height: number,
    o: {
      leaf?: 'roller' | 'glass' | 'panel' | 'none';
      color?: string;
      frame?: string;
      /** How far an open bay's dark room runs back. */
      room?: number;
      /** Roller door raised to this fraction (0 closed .. 1 open), slats drawn over the rest. */
      raised?: number;
      depth?: number;
    } = {},
  ): void {
    const d = o.depth ?? 0.16;
    const frame = o.frame ?? '#4a5056';
    this.opening(u0, u1, 0, height, d);
    // Surround.
    this.paint([u0 - 0.16, u0], [0, height + 0.12], [-0.01, 0.12], frame);
    this.paint([u1, u1 + 0.16], [0, height + 0.12], [-0.01, 0.12], frame);
    this.paint(
      [u0 - 0.16, u1 + 0.16],
      [height, height + 0.16],
      [-0.01, 0.14],
      frame,
    );
    const leaf = o.leaf ?? 'roller';
    if (leaf === 'roller') {
      const top = height * (1 - (o.raised ?? 0));
      this.panel(
        'roller',
        [u0, u1],
        [0.02, top],
        -d + 0.05,
        o.color ?? '#d7d9d9',
      );
      // Dark behind the raised part.
      if (top < height)
        this.quad(
          'paint',
          [
            [u0, top, -d - 0.4],
            [u1, top, -d - 0.4],
            [u1, height, -d - 0.4],
            [u0, height, -d - 0.4],
          ],
          DARK,
          undefined,
          true,
        );
      // Rubber seal along the bottom.
      this.paint([u0, u1], [0, 0.07], [-d + 0.03, -d + 0.09], '#1d1f21');
    } else if (leaf === 'glass') {
      this.glazing(u0, u1, 0.1, height - 0.05, d, {
        panes: Math.max(2, Math.round((u1 - u0) / 0.9)),
        frame: o.frame ?? '#3a3f43',
        transom: 0.5,
      });
    } else if (leaf === 'panel') {
      this.panel(
        'paint',
        [u0, u1],
        [0.02, height],
        -d + 0.05,
        o.color ?? '#c9ced1',
      );
    } else {
      // Open bay: a dark room running back, so it reads as a hall you can look into.
      const room = o.room ?? 6;
      const back = -room;
      const q = (p: [number, number, number][]) =>
        this.quad('paint', p, DARK, undefined, true);
      q([
        [u0, 0, back],
        [u1, 0, back],
        [u1, height, back],
        [u0, height, back],
      ]);
      q([
        [u0, 0, 0],
        [u0, 0, back],
        [u0, height, back],
        [u0, height, 0],
      ]);
      q([
        [u1, 0, back],
        [u1, 0, 0],
        [u1, height, 0],
        [u1, height, back],
      ]);
      q([
        [u0, height, back],
        [u1, height, back],
        [u1, height, 0],
        [u0, height, 0],
      ]);
      this.quad(
        'paint',
        [
          [u0, 0.02, 0],
          [u1, 0.02, 0],
          [u1, 0.02, back],
          [u0, 0.02, back],
        ],
        '#2a2c2e',
        undefined,
        true,
      );
    }
  }

  /** The wall sheet, with every opening cut out. Call once, after the features. */
  finish(): void {
    const L = this.w.length;
    const H = this.height;
    const bottom = -Wall.SKIRT;
    const outline = [
      new Vector2(0, bottom),
      new Vector2(L, bottom),
      new Vector2(L, H),
      new Vector2(0, H),
    ];
    const holes = this.cuts.map(([u0, u1, y0, y1]) => [
      new Vector2(u0, y0),
      new Vector2(u0, y1),
      new Vector2(u1, y1),
      new Vector2(u1, y0),
    ]);
    const faces = ShapeUtils.triangulateShape(outline, holes);
    const all = [...outline, ...holes.flat()];
    for (const [i, j, k] of faces) {
      const a = all[i];
      let b = all[j];
      let c = all[k];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross < 0) [b, c] = [c, b];
      // Offset the texture per wall so neighbouring walls do not repeat in step.
      const off = (this.w.a.x * 1.7 + this.w.a.y * 0.9) % 4;
      this.f.tri(
        this.look.mat,
        [a.x, a.y, 0],
        [b.x, b.y, 0],
        [c.x, c.y, 0],
        this.look.tint,
        [
          [a.x + off, a.y],
          [b.x + off, b.y],
          [c.x + off, c.y],
        ],
        this.m(),
      );
    }
  }
}

/** A building shell: one wall per edge of the footprint and a flat roof. */
export class Shell {
  readonly walls: Wall[];

  constructor(
    readonly f: Frame,
    readonly corners: Corner[],
    readonly height: number,
    readonly look: Look,
    readonly roof: { mat: MatKey; tint: string } | null = {
      mat: 'roofing',
      tint: '#a0a09c',
    },
  ) {
    this.walls = wallFrames(corners).map((w) => new Wall(f, w, height, look));
  }

  /** The wall facing `side`, if the footprint has one. */
  side(side: Compass): Wall | undefined {
    return this.walls.find((w) => w.w.side === side);
  }

  /** Walls facing `side`. */
  sides(side: Compass): Wall[] {
    return this.walls.filter((w) => w.w.side === side);
  }

  /** The sheets and the roof. */
  finish(): void {
    for (const wall of this.walls) wall.finish();
    if (this.roof)
      this.f.polygon(
        this.roof.mat,
        this.corners.map(([x, z]) => new Vector2(x, z)),
        this.height,
        this.roof.tint,
      );
  }
}
