import { Vector2 } from 'three';
import {
  inside,
  getLayout,
  type LotStyle,
  type Plot,
  type Yard,
} from '../../layout';
import type { Corner } from '../../frame';
import { drapedFrame, lotFrame, type Build } from '../ctx';
import { tileKey } from '../kit';
import type { MatKey } from '../materials';
import { buildMileks } from '../mileks';
import { boomBarrier, stripedBarrier } from '../props';
import { Shell } from '../wall';
import type { LotCtx } from './common';
import { scatterRoofUnits } from './common';
import { dressSite, siteProps } from './site';
import {
  dressCompound,
  dressDealer,
  dressMall,
  dressSlab,
  dressStatues,
  dressTruckYard,
  dressVilla,
} from './east-end';
import {
  dressCarPark,
  dressCarService,
  dressFactory,
  dressMast,
  dressSubstation,
  dressTrailerPark,
} from './west-end';
import {
  dressDarkOffice,
  dressGlassTower,
  dressRedPortal,
  dressRedTrim,
} from './north-offices';
import {
  dressFramed,
  dressHouse,
  dressHq,
  dressPlain,
  dressService,
  dressShowroom,
} from './north';
import {
  dressDepot,
  dressHall,
  dressLogistics,
  dressOffice,
  dressSheds,
  dressStriped,
} from './south';

type Style = LotStyle | 'plain';

const DRESS: Record<Style, (ctx: LotCtx) => void> = {
  hq: dressHq,
  service: dressService,
  showroom: dressShowroom,
  plain: dressPlain,
  depot: dressDepot,
  hall: dressHall,
  striped: dressStriped,
  logistics: dressLogistics,
  sheds: dressSheds,
  office: dressOffice,
  house: dressHouse,
  framed: dressFramed,
  redTrim: dressRedTrim,
  redPortal: dressRedPortal,
  glassTower: dressGlassTower,
  darkOffice: dressDarkOffice,
  villa: dressVilla,
  slab: dressSlab,
  dealer: dressDealer,
  truckYard: dressTruckYard,
  compound: dressCompound,
  statues: dressStatues,
  mall: dressMall,
  carService: dressCarService,
  carPark: dressCarPark,
  factory: dressFactory,
  mast: dressMast,
  trailerPark: dressTrailerPark,
  substation: dressSubstation,
  site: dressSite,
  mileks: (ctx) => buildMileks(ctx.b, ctx.yard),
};

/** Wall material per style: panels, sheeting or render. */
const WALLS: Record<Style, MatKey> = {
  hq: 'panel',
  service: 'render',
  showroom: 'panel',
  plain: 'panel',
  depot: 'render',
  hall: 'panel',
  striped: 'panel',
  logistics: 'panel',
  sheds: 'sheet',
  office: 'render',
  house: 'render',
  framed: 'panel',
  redTrim: 'panel',
  redPortal: 'panel',
  glassTower: 'panel',
  darkOffice: 'panel',
  villa: 'render',
  slab: 'concrete',
  dealer: 'panel',
  truckYard: 'sheet',
  compound: 'render',
  statues: 'sheet',
  mall: 'render',
  carService: 'sheet',
  carPark: 'paint',
  factory: 'panel',
  mast: 'paint',
  trailerPark: 'render',
  substation: 'render',
  site: 'panel',
  mileks: 'render',
};

/** Roof material per style: coloured metal roofs are sheeting, the rest flat membrane. */
const ROOFS: Partial<Record<Style, MatKey>> = {
  striped: 'sheet',
  sheds: 'sheet',
  truckYard: 'sheet',
  compound: 'sheet',
  statues: 'sheet',
};

/** Paint colour of the lines in the parking bays. */
const BAY = '#e9e6dc';

/** Builds one lot: the building (and its annex), its yard, drive, bays, fence and dividers. */
function buildLot(b: Build, yard: Yard, index: number): void {
  const { plot } = yard;
  const style: Style = plot.style ?? 'plain';
  const anchor: Corner[] = [
    ...plot.corners,
    ...(plot.annex?.corners ?? []),
    ...(plot.more ?? []).flatMap((m) => m.corners),
    ...yard.polygon.map((p): Corner => [p.x, p.y]),
  ];
  const f = lotFrame(b, anchor);
  const front = plot.side === 'north' ? 's' : 'n';
  const dockEdges = new Set(
    plot.rows
      .filter(
        (r) =>
          r.edge &&
          r.layout === 'dock' &&
          r.kind !== 'car' &&
          r.kind !== 'sport',
      )
      .map((r) => r.edge!),
  );
  const shell = new Shell(
    f,
    plot.corners,
    plot.height,
    { mat: WALLS[style], tint: plot.walls },
    { mat: ROOFS[style] ?? 'roofing', tint: plot.roof },
  );
  const ctx: LotCtx = {
    b,
    f,
    plot,
    yard,
    layout: getLayout(),
    shell,
    h: plot.height,
    front,
    dockEdges,
    index,
  };
  DRESS[style](ctx);
  if (
    ![
      'office',
      'hq',
      'mileks',
      'house',
      'site',
      'villa',
      'slab',
      'dealer',
      'compound',
      'statues',
      'mall',
      'carService',
      'carPark',
      'mast',
      'trailerPark',
      'substation',
    ].includes(style)
  )
    scatterRoofUnits(ctx);

  // The yard: worn asphalt or pavers right up to its own fence; the drive across the sidewalk
  // hugs the terrain.
  const surface: MatKey =
    style === 'mileks'
      ? 'concrete'
      : plot.paving === 'gravel'
        ? 'gravel'
        : plot.paving === 'pavers'
          ? 'pavers'
          : 'asphalt';
  const tint =
    surface === 'pavers'
      ? '#d6d3cc'
      : surface === 'concrete'
        ? '#c9c6bf'
        : '#ffffff';
  const d = drapedFrame(
    b,
    (yard.drive[0] ?? yard.polygon[0]).x,
    (yard.drive[0] ?? yard.polygon[0]).y,
  );
  // The yard in strips across the street, each on its own plane: the pad follows the road's profile
  // along the street (a long lot cannot be one plane) and level across it.
  const patches = (plot.patches ?? []).map((patch) => ({
    ...patch,
    polygon: patch.polygon.map((c) => new Vector2(c[0], c[1])),
  }));
  // A lot on the natural ground (no pad) drapes its yard over the terrain instead: a plane lifted to clear the
  // highest ground would float above the low side of a slope, where its fence stands on the ground.
  const lift = { lift: (x: number, z: number) => b.ground(x, z), step: 3 };
  for (const strip of stripsOf(yard)) {
    if (plot.noPad) {
      const c = strip
        .reduce((sum, p) => sum.add(p), new Vector2())
        .divideScalar(strip.length);
      const g = drapedFrame(b, c.x, c.y);
      g.polygon(surface, strip, 0.05, tint, lift);
      for (const patch of patches) {
        const part = clipConvex(strip, patch.polygon);
        if (part.length >= 3)
          g.polygon(
            patch.material === 'pavers' ? 'patchPavers' : 'patchConcrete',
            part,
            0.08,
            patch.tint,
            lift,
          );
      }
      continue;
    }
    const f = lotFrame(
      b,
      strip.map((p): Corner => [p.x, p.y]),
      true,
    );
    const top = style === 'mileks' ? 0.03 : 0.04;
    f.polygon(surface, strip, top, tint);
    b.pads.push({ polygon: strip, plane: f.plane!, top });
    // Parts of the yard with another ground (sand, dirt, pavement) lie on the same plane as the strip they
    // are cut from, so they never dip below the yard under them.
    for (const patch of patches) {
      const part = clipConvex(strip, patch.polygon);
      if (part.length >= 3) {
        f.polygon(
          patch.material === 'pavers' ? 'patchPavers' : 'patchConcrete',
          part,
          0.07,
          patch.tint,
        );
        b.pads.push({ polygon: part, plane: f.plane!, top: 0.07 });
      }
    }
  }
  if (yard.drive.length)
    d.polygon(surface, yard.drive, 0.05, tint, {
      lift: (x, z) => b.ground(x, z),
      step: 3,
    });
  if (style === 'site') siteProps(b);

  // Red and white striped barriers dividing off a yard's back part, a boom barrier at the gap.
  for (const [a, c] of yard.barriers)
    stripedBarrier(d.onTile(drapedTile(a)), a, c, (x, z) => b.ground(x, z));
  if (yard.divider) {
    const [a, c] = yard.divider.gap;
    const dir = c.clone().sub(a).normalize();
    const out = new Vector2(dir.y, -dir.x);
    boomBarrier(
      d.onTile(drapedTile(a)),
      c.clone().addScaledVector(dir, -0.6).addScaledVector(out, 0.7),
      dir,
      (x, z) => b.ground(x, z),
    );
  }
}

const drapedTile = (p: Vector2): string => tileKey(p.x, p.y);

/** `polygon` clipped to the band `a <= p . dir <= b` (Sutherland-Hodgman against two half-planes). */
function clipBand(
  polygon: Vector2[],
  dir: Vector2,
  a: number,
  b: number,
): Vector2[] {
  const half = (poly: Vector2[], keep: (p: Vector2) => number): Vector2[] => {
    const out: Vector2[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const kp = keep(p);
      const kq = keep(q);
      if (kp >= 0) out.push(p);
      if (kp >= 0 !== kq >= 0) out.push(p.clone().lerp(q, kp / (kp - kq)));
    });
    return out;
  };
  const low = half(polygon, (p) => p.dot(dir) - a);
  return low.length ? half(low, (p) => b - p.dot(dir)) : [];
}

/** `subject` clipped to the convex polygon `clip` (Sutherland-Hodgman, either winding). */
function clipConvex(subject: Vector2[], clip: Vector2[]): Vector2[] {
  const area = clip.reduce(
    (sum, p, i) => sum + p.cross(clip[(i + 1) % clip.length]),
    0,
  );
  const sign = area >= 0 ? 1 : -1;
  let out = subject;
  clip.forEach((a, i) => {
    const c = clip[(i + 1) % clip.length];
    const side = (p: Vector2) =>
      sign * ((c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    input.forEach((p, k) => {
      const q = input[(k + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) out.push(p.clone().lerp(q, sp / (sp - sq)));
    });
  });
  return out;
}

/** The yard cut every ~18 m along the street into polygons (a lot on a long frontage becomes several). */
function stripsOf(yard: Yard): Vector2[][] {
  const { polygon, plot } = yard;
  // Along the frontage; a lot off the street is cut along x (the street runs roughly east).
  const last = polygon.length - plot.yard.back.length - 1;
  const dir = plot.yard.street
    ? polygon[last].clone().sub(polygon[0]).normalize()
    : new Vector2(1, 0);
  return strips(polygon, dir);
}

/** `polygon` cut every ~18 m along `dir` into polygons, each fit for its own plane. */
function strips(polygon: Vector2[], dir: Vector2): Vector2[][] {
  const ts = polygon.map((p) => p.dot(dir));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const n = Math.max(1, Math.round((t1 - t0) / 18));
  const out: Vector2[][] = [];
  for (let k = 0; k < n; k++) {
    const strip = clipBand(
      polygon,
      dir,
      t0 + ((t1 - t0) * k) / n - 1e-3,
      t0 + ((t1 - t0) * (k + 1)) / n + 1e-3,
    );
    if (strip.length >= 3) out.push(strip);
  }
  return out;
}

/** Painted bay lines between adjacent parking spaces. */
function bayLines(b: Build, yards: Yard[]): void {
  const lines = getLayout().parkingLines;
  for (const yard of yards) {
    const mine = lines.filter(([a]) => inside(a, yard.polygon));
    if (!mine.length) continue;
    const f = drapedFrame(b, mine[0][0].x, mine[0][0].y);
    for (const [a, c] of mine)
      f.sweep(
        'marking',
        [a, c],
        [
          [-0.05, 0.06],
          [0.05, 0.06],
        ],
        BAY,
        { lift: (x, z) => b.ground(x, z) },
      );
  }
}

/** Every lot on both sides of the street. */
export function buildLots(b: Build): Plot[] {
  const layout = getLayout();
  layout.yards.forEach((yard, i) => buildLot(b, yard, i));
  bayLines(b, layout.yards);
  return layout.yards.map((y) => y.plot);
}
