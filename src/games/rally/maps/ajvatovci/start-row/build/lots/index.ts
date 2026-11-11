import { Color, Vector2 } from 'three';
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
import {
  clipConvex,
  stripsOf,
  surfacesOf,
  YARD_TOP,
} from '../../yard-surfaces';
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
      g.polygon(surface, strip, YARD_TOP.draped, tint, lift);
      for (const patch of patches) {
        const part = clipConvex(strip, patch.polygon);
        if (part.length >= 3)
          g.polygon(
            patch.material === 'pavers' ? 'patchPavers' : 'patchConcrete',
            part,
            YARD_TOP.drapedPatch,
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
    const top = style === 'mileks' ? YARD_TOP.mileks : YARD_TOP.pad;
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
          YARD_TOP.patch,
          patch.tint,
        );
        b.pads.push({ polygon: part, plane: f.plane!, top: YARD_TOP.patch });
      }
    }
  }
  if (yard.driveIn.length)
    d.polygon(surface, yard.driveIn, YARD_TOP.drive, tint, {
      lift: (x, z) => b.ground(x, z),
      step: 1,
    });
  yardEdge(b, yard, surface, tint);
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

/** Below the ground the yard's edge face reaches (m): it never shows a gap on a bumpy verge. */
const EDGE_TOE = 0.08;

/**
 * The yard's edge: a face from the paving's top down into the ground all round the yard and its drive, so the lot
 * reads as a slab of paving laid on the ground (a few cm proud), not a sheet floating over it. Darker than the top
 * (the cut side, in shade).
 */
function yardEdge(b: Build, yard: Yard, surface: MatKey, tint: string): void {
  const ground = (x: number, z: number) => b.ground(x, z);
  const pieces = surfacesOf(yard, ground);
  const top = (x: number, z: number): number => {
    let y = -Infinity;
    _p.set(x, z);
    for (const s of pieces)
      if (
        x >= s.x0 &&
        x <= s.x1 &&
        z >= s.z0 &&
        z <= s.z1 &&
        inside(_p, s.polygon)
      )
        y = Math.max(y, s.height(x, z));
    return y;
  };
  const edge = new Color(tint).multiplyScalar(0.55);
  for (const outline of [yard.polygon, yard.driveIn]) {
    if (outline.length < 3) continue;
    const c = outline
      .reduce((sum, p) => sum.add(p), new Vector2())
      .divideScalar(outline.length);
    const f = drapedFrame(b, c.x, c.y);
    outline.forEach((a, i) => {
      const e = outline[(i + 1) % outline.length];
      const len = a.distanceTo(e);
      if (len < 0.05) return;
      const n = Math.max(1, Math.ceil(len));
      // Outward: away from the outline's centre (the yards are convex-ish; a reflex corner only flips a face's light).
      const mid = a.clone().lerp(e, 0.5);
      const ex = e.x - a.x;
      const ez = e.y - a.y;
      const out = -ez * (mid.x - c.x) + ex * (mid.y - c.y) > 0;
      // (sampled a hair inside, where the top is defined)
      const inward = mid.clone().sub(c).normalize().multiplyScalar(-0.05);
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(e, k / n);
        const q = a.clone().lerp(e, (k + 1) / n);
        const tp = top(p.x + inward.x, p.y + inward.y);
        const tq = top(q.x + inward.x, q.y + inward.y);
        if (!Number.isFinite(tp) || !Number.isFinite(tq)) continue;
        const bp = ground(p.x, p.y) - EDGE_TOE;
        const bq = ground(q.x, q.y) - EDGE_TOE;
        if (tp - bp < EDGE_TOE + 0.005 && tq - bq < EDGE_TOE + 0.005) continue;
        const u0 = (len * k) / n;
        const u1 = (len * (k + 1)) / n;
        const quad: [number, number, number][] = out
          ? [
              [p.x, bp, p.y],
              [q.x, bq, q.y],
              [q.x, tq, q.y],
              [p.x, tp, p.y],
            ]
          : [
              [q.x, bq, q.y],
              [p.x, bp, p.y],
              [p.x, tp, p.y],
              [q.x, tq, q.y],
            ];
        f.quad(surface, quad[0], quad[1], quad[2], quad[3], edge, [
          [u0, 0],
          [u1, 0],
          [u1, 0.15],
          [u0, 0.15],
        ]);
      }
    });
  }
}

const _p = new Vector2();

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
