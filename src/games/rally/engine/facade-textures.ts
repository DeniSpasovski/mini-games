import { Rng } from '../../../shared/rng';

/**
 * Building facade textures: ONE bay (3.2 m wide) x ONE floor (3.2 m tall) per tile, repeated across a
 * wall by world/building-mesh.ts (u = bays along the wall, v = floors up it). Drawn in light neutral
 * tones: the mesh multiplies a per-building vertex colour (brick red, tan, cream ...) on top, so a
 * handful of textures give every building its own colour while windows stay dark.
 */
export type FacadeId =
  | 'facade_brick'
  | 'facade_stucco'
  | 'facade_concrete'
  | 'facade_commercial'
  | 'facade_industrial'
  | 'facade_stone'
  | 'facade_plainstone'
  | 'facade_garage';

export interface FacadeDef {
  name: string;
  size: [number, number];
  color: boolean;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

type Ctx = CanvasRenderingContext2D;

function speckle(
  ctx: Ctx,
  w: number,
  h: number,
  seed: number,
  amount: number,
): void {
  const rng = new Rng(seed);
  for (let i = 0; i < (w * h) / 14; i++) {
    const v = rng.chance(0.5) ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rng.range(0.02, 0.07) * amount})`;
    ctx.fillRect(
      rng.next() * w,
      rng.next() * h,
      rng.range(1, 3),
      rng.range(1, 3),
    );
  }
}

/** Running-bond brick coursing over the whole tile (light mortar, per-brick shade). */
function bricks(ctx: Ctx, w: number, h: number, seed: number): void {
  const rng = new Rng(seed);
  const bh = 4.5;
  const bw = 14;
  ctx.fillStyle = '#c9c4bb';
  ctx.fillRect(0, 0, w, h);
  for (let row = 0, y = 0; y < h; row++, y += bh) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -off; x < w; x += bw) {
      const k = rng.range(0.9, 1.07);
      ctx.fillStyle = `rgb(${232 * k},${226 * k},${216 * k})`;
      ctx.fillRect(x + 0.6, y + 0.6, bw - 1.2, bh - 1.2);
    }
  }
  speckle(ctx, w, h, seed + 1, 1);
}

function glass(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#5b6f80');
  g.addColorStop(0.55, '#2c3944');
  g.addColorStop(1, '#202a33');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Double-hung window: frame, two sashes, sill (stone) and an optional lintel. */
function window2(
  ctx: Ctx,
  cx: number,
  top: number,
  w: number,
  h: number,
  frame: string,
  sill: boolean,
  lintel: boolean,
): void {
  const x = cx - w / 2;
  ctx.fillStyle = frame;
  ctx.fillRect(x - 3, top - 3, w + 6, h + 6);
  glass(ctx, x, top, w, h);
  ctx.fillStyle = frame;
  ctx.fillRect(x, top + h / 2 - 1.5, w, 3); // meeting rail
  ctx.fillRect(cx - 1, top, 2, h); // mullion
  if (sill) {
    ctx.fillStyle = '#e9e5dc';
    ctx.fillRect(x - 6, top + h + 3, w + 12, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 6, top + h + 8, w + 12, 2);
  }
  if (lintel) {
    ctx.fillStyle = '#e4e0d6';
    ctx.fillRect(x - 5, top - 9, w + 10, 6);
  }
}

function floorLine(
  ctx: Ctx,
  w: number,
  h: number,
  color = 'rgba(0,0,0,0.16)',
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, h - 2, w, 2);
}

export const FACADE_DEFS: Record<FacadeId, FacadeDef> = {
  facade_brick: {
    name: 'Facade: brick row house (tint with vertex colour)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      bricks(ctx, w, h, 301);
      window2(ctx, w / 2, 40, 62, 82, '#f1eee6', true, true);
      floorLine(ctx, w, h);
    },
  },
  facade_stucco: {
    name: 'Facade: stucco / siding house',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#e6e2d8';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 311, 1.6);
      // Faint horizontal siding laps.
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let y = 6; y < h; y += 9) ctx.fillRect(0, y, w, 1.5);
      window2(ctx, w / 2, 48, 54, 74, '#fbfaf6', true, false);
      // Shutters.
      ctx.fillStyle = 'rgba(40,60,70,0.55)';
      ctx.fillRect(w / 2 - 54 / 2 - 17, 48, 13, 74);
      ctx.fillRect(w / 2 + 54 / 2 + 4, 48, 13, 74);
      floorLine(ctx, w, h, 'rgba(0,0,0,0.1)');
    },
  },
  facade_concrete: {
    name: 'Facade: concrete apartment block (window band)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#d6d3cb';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 321, 1.2);
      // Slab edge + spandrel panel, then a ribbon window with mullions.
      ctx.fillStyle = '#c2beb4';
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
      glass(ctx, 12, 34, w - 24, 78);
      ctx.fillStyle = '#e4e1da';
      for (const x of [12, w / 2 - 2, w - 14]) ctx.fillRect(x, 34, 3, 78);
      ctx.fillRect(12, 34, w - 24, 3);
      ctx.fillRect(12, 109, w - 24, 3);
      floorLine(ctx, w, h, 'rgba(0,0,0,0.22)');
    },
  },
  facade_commercial: {
    name: 'Facade: commercial / institutional (large glazing)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      ctx.fillStyle = '#dcd9d1';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 331, 1.2);
      glass(ctx, 14, 20, w - 28, 112);
      ctx.fillStyle = '#9ea4a8';
      ctx.fillRect(14, 20, w - 28, 4);
      ctx.fillRect(14, 128, w - 28, 4);
      for (const x of [14, w / 3 + 4, (2 * w) / 3 - 4, w - 18])
        ctx.fillRect(x, 20, 4, 112);
      floorLine(ctx, w, h, 'rgba(0,0,0,0.2)');
    },
  },
  facade_industrial: {
    name: 'Facade: industrial hall (corrugated cladding)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      for (let x = 0; x < w; x += 6) {
        ctx.fillStyle = x % 12 ? '#cfd2d3' : '#bfc3c5';
        ctx.fillRect(x, 0, 6, h);
      }
      speckle(ctx, w, h, 341, 1.4);
      // High strip window.
      glass(ctx, 22, 18, w - 44, 22);
      ctx.fillStyle = '#9da2a5';
      ctx.fillRect(22, 18, w - 44, 2);
      ctx.fillRect(22, 38, w - 44, 2);
      floorLine(ctx, w, h, 'rgba(0,0,0,0.1)');
    },
  },
  facade_stone: {
    name: 'Facade: stone (church) with an arched window',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      ashlar(ctx, w, h, 351);
      const cx = w / 2;
      ctx.fillStyle = '#ece8de';
      ctx.beginPath();
      ctx.moveTo(cx - 24, 150);
      ctx.lineTo(cx - 24, 62);
      ctx.arc(cx, 62, 24, Math.PI, 0);
      ctx.lineTo(cx + 24, 150);
      ctx.fill();
      ctx.fillStyle = '#26323c';
      ctx.beginPath();
      ctx.moveTo(cx - 17, 148);
      ctx.lineTo(cx - 17, 62);
      ctx.arc(cx, 62, 17, Math.PI, 0);
      ctx.lineTo(cx + 17, 148);
      ctx.fill();
      ctx.fillStyle = '#ece8de';
      ctx.fillRect(cx - 1.5, 45, 3, 103);
    },
  },
  facade_plainstone: {
    name: 'Facade: plain stone blocks (mausoleum)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      ashlar(ctx, w, h, 361);
    },
  },
  facade_garage: {
    name: 'Facade: garage (block wall + roll-up door)',
    size: [192, 192],
    color: true,
    draw(ctx, w, h) {
      const rng = new Rng(371);
      ctx.fillStyle = '#c8c5bd';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 12)
        for (let x = (y / 12) % 2 ? -12 : 0; x < w; x += 24) {
          const k = rng.range(0.93, 1.05);
          ctx.fillStyle = `rgb(${214 * k},${211 * k},${203 * k})`;
          ctx.fillRect(x + 0.8, y + 0.8, 22.4, 10.4);
        }
      // Roll-up door.
      ctx.fillStyle = '#8f969b';
      ctx.fillRect(28, 46, w - 56, 140);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 52; y < 186; y += 11) ctx.fillRect(28, y, w - 56, 1.5);
      speckle(ctx, w, h, 372, 1);
    },
  },
};

function ashlar(ctx: Ctx, w: number, h: number, seed: number): void {
  const rng = new Rng(seed);
  ctx.fillStyle = '#b5b1a7';
  ctx.fillRect(0, 0, w, h);
  let y = 0;
  while (y < h) {
    const bh = rng.pick([22, 28, 34]);
    let x = -rng.range(0, 30);
    while (x < w) {
      const bw = rng.range(30, 58);
      const k = rng.range(0.9, 1.08);
      ctx.fillStyle = `rgb(${225 * k},${221 * k},${212 * k})`;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      x += bw;
    }
    y += bh;
  }
  speckle(ctx, w, h, seed + 1, 1.5);
}
