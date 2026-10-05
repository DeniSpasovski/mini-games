import { Matrix4, Vector2 } from 'three';
import { hash3 } from '../../../../../../../shared/rng';
import {
  inside,
  type Compass,
  type Layout,
  type Plot,
  type Yard,
} from '../../layout';
import type { Build } from '../ctx';
import type { Frame } from '../kit';
import { roofUnit } from '../props';
import { wallFrames, type Shell, type Wall } from '../wall';
import type { Corner } from '../../frame';

/** What a style function needs to dress one lot. */
export interface LotCtx {
  b: Build;
  f: Frame;
  plot: Plot;
  yard: Yard;
  layout: Layout;
  shell: Shell;
  /** Wall height of the main building (m). */
  h: number;
  /** The wall that faces the street. */
  front: Compass;
  /** Walls that have trucks docked at them (rows of box / trailer trucks `edge`). */
  dockEdges: Set<Compass>;
  /** 0-based index of the lot (salt for deterministic variety). */
  index: number;
}

/** Dock door pitch = the parked trucks' pitch (box truck 2.6 m + 1), so each door has a truck in front. */
export const DOCK_PITCH = 3.6;

/** Colours the trim and openings of the industrial lots share. */
export const COLOR = {
  plinth: '#8d8a83',
  doorFrame: '#4a5056',
  door: '#d9dbdb',
  glassFrame: '#4a5056',
  stripe: '#ebe6dc',
  steps: '#d2cfc8',
  mullion: '#3a3f43',
  workshop: '#2e3236',
  doorLeaf: '#c9ced1',
};

const DOOR_TINTS = ['#e1e3e3', '#d2d7db', '#c8d0d6', '#e6e6e0'];

/** Roller doors along a wall at the dock pitch; a few stand open on a dark hall. */
export function dockDoors(
  w: Wall,
  ctx: LotCtx,
  o: { span?: [number, number]; height?: number; width?: number } = {},
): void {
  const [from, to] = o.span ?? [0, w.length];
  const height = o.height ?? 3.6;
  const half = (o.width ?? 2.8) / 2;
  let k = 0;
  for (
    let u = from + 1 + DOCK_PITCH / 2;
    u + DOCK_PITCH / 2 < to;
    u += DOCK_PITCH, k++
  ) {
    const h = hash3(Math.round(w.w.a.x * 10) + k, ctx.index, 3, 91) % 100;
    w.doorway([u - half, u + half], height, {
      leaf: h < 14 ? 'none' : 'roller',
      color: DOOR_TINTS[h % DOOR_TINTS.length],
      frame: COLOR.doorFrame,
      room: 5,
      raised: h > 85 ? 0.35 : 0,
    });
  }
}

/** A ribbon of equal windows from `u0`, `pitch` apart, until `u1`. */
export function ribbon(
  w: Wall,
  [u0, u1]: [number, number],
  size: { width: number; pitch: number; y: [number, number] },
  o: { frame?: string; sill?: boolean; skip?: (u: number) => boolean } = {},
): void {
  for (let u = u0; u + size.width <= u1; u += size.pitch) {
    if (o.skip?.(u)) continue;
    w.window([u, u + size.width], size.y, {
      frame: o.frame ?? COLOR.glassFrame,
      sill: o.sill ?? false,
      panes: Math.max(1, Math.round(size.width / 1.3)),
      depth: 0.1,
    });
  }
}

/** Rooftop units scattered over the roof of the main building (not over its annex). */
export function scatterRoofUnits(ctx: LotCtx, count = 4): void {
  const { plot, f } = ctx;
  const polygon = plot.corners.map(([x, z]) => new Vector2(x, z));
  const middle = polygon
    .reduce((s, c) => s.add(c), new Vector2())
    .divideScalar(polygon.length);
  let seed = Math.round(plot.corners[0][0] * 7 + plot.corners[0][1]);
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  for (let k = 0, placed = 0; k < 40 && placed < count; k++) {
    const at = middle
      .clone()
      .add(new Vector2((random() - 0.5) * 30, (random() - 0.5) * 40));
    const w = 1.6 + random() * 1.4;
    const d = 1.2 + random();
    const corners = [
      [w, d],
      [w, -d],
      [-w, -d],
      [-w, d],
    ].map(([x, z]) => new Vector2(at.x + x, at.y + z));
    if (!corners.every((c) => inside(c, polygon))) continue;
    roofUnit(f, at, w, d, ctx.h, 0.9 + random() * 0.5);
    placed++;
  }
}

/**
 * A hipped roof over a rectangular footprint (any of the four corners first): the ridge runs along the
 * depth (the wall facing `front` is the width), shorter than the eaves, `rise` m high. Sheet metal.
 */
export function hippedRoof(
  f: Frame,
  corners: Corner[],
  y: number,
  color: string,
  front: Compass,
  rise = 2.6,
): void {
  const frames = wallFrames(corners);
  const west = frames.find((fr) => fr.side === 'w')!;
  const north = frames.find((fr) => fr.side === front)!;
  const long = west.length * 0.96;
  const wide = north.length * 0.98;
  const [lx, wz, rx] = [long / 2, wide / 2, (long * 0.6) / 2];
  const at = (x: number, h: number, z: number): [number, number, number] => [
    x,
    h,
    z,
  ];
  const tris: [number, number, number][][] = [
    [at(-rx, rise, 0), at(rx, rise, 0), at(lx, 0, wz)],
    [at(-rx, rise, 0), at(lx, 0, wz), at(-lx, 0, wz)],
    [at(rx, rise, 0), at(-rx, rise, 0), at(-lx, 0, -wz)],
    [at(rx, rise, 0), at(-lx, 0, -wz), at(lx, 0, -wz)],
    [at(rx, rise, 0), at(lx, 0, -wz), at(lx, 0, wz)],
    [at(-rx, rise, 0), at(-lx, 0, wz), at(-lx, 0, -wz)],
  ];
  const centre = corners
    .map(([x, z]) => new Vector2(x, z))
    .reduce((s, c) => s.add(c), new Vector2())
    .divideScalar(corners.length);
  const yaw = Math.atan2(-west.dir.y, west.dir.x);
  const matrix = new Matrix4()
    .makeRotationY(yaw)
    .setPosition(centre.x, y, centre.y);
  for (const tri of tris)
    f.tri(
      'sheet',
      tri[0],
      tri[1],
      tri[2],
      color,
      [
        [tri[0][0], tri[0][2] + tri[0][1]],
        [tri[1][0], tri[1][2] + tri[1][1]],
        [tri[2][0], tri[2][2] + tri[2][1]],
      ],
      { matrix },
    );
}
