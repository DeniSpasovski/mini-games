import { Rng } from '../../../shared/rng';
import renderUrl from './facades/render.webp';
import clayUrl from './facades/clay_brick.webp';
import brickUrl from './facades/brick_red.webp';
import rubbleUrl from './facades/rubble.webp';
import blockUrl from './facades/block.webp';
import sheetUrl from './facades/sheet.webp';
import slabUrl from './facades/slab.webp';
import ashlarUrl from './facades/ashlar.webp';
import sidingUrl from './facades/siding.webp';

/** One 3.2 m bay of a Poly Haven (CC0) scan, 512 px, neutralised where the vertex colour supplies the paint. */
const PHOTO_URLS = {
  render: renderUrl,
  clay: clayUrl,
  brick: brickUrl,
  rubble: rubbleUrl,
  block: blockUrl,
  sheet: sheetUrl,
  slab: slabUrl,
  ashlar: ashlarUrl,
  siding: sidingUrl,
};
type PhotoId = keyof typeof PHOTO_URLS;
const photos = new Map<PhotoId, HTMLImageElement>();
export let facadePhotosReady = false;
Promise.all(
  (Object.keys(PHOTO_URLS) as PhotoId[]).map(async (id) => {
    const img = new Image();
    img.src = PHOTO_URLS[id];
    await img.decode();
    photos.set(id, img);
  }),
).then(
  () => (facadePhotosReady = true),
  () => (facadePhotosReady = true),
);

function photo(
  ctx: CanvasRenderingContext2D,
  id: PhotoId,
  w: number,
  h: number,
): void {
  const img = photos.get(id);
  if (img) ctx.drawImage(img, 0, 0, w, h);
  else {
    ctx.fillStyle = '#c9c4bb';
    ctx.fillRect(0, 0, w, h);
  }
}

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
  | 'facade_garage'
  | 'facade_clay'
  | 'facade_rubble'
  | 'facade_block'
  | 'facade_siding';

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
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'brick', w, h);
      window2(ctx, w / 2, 40, 62, 82, '#f1eee6', true, true);
      floorLine(ctx, w, h);
    },
  },
  facade_stucco: {
    name: 'Facade: stucco / siding house',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'render', w, h);
      window2(ctx, w / 2, 48, 54, 74, '#fbfaf6', true, false);
      floorLine(ctx, w, h, 'rgba(0,0,0,0.1)');
    },
  },
  facade_concrete: {
    name: 'Facade: concrete apartment block (window band)',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'slab', w, h);
      // Spandrel panel, then a ribbon window with mullions.
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
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
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
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
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'sheet', w, h);
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
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'ashlar', w, h);
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
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'ashlar', w, h);
    },
  },
  facade_garage: {
    name: 'Facade: garage (block wall + roll-up door)',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      const w = 192;
      const h = 192;
      photo(ctx, 'block', w, h);
      // Roll-up door.
      ctx.fillStyle = '#8f969b';
      ctx.fillRect(28, 46, w - 56, 140);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 52; y < 186; y += 11) ctx.fillRect(28, y, w - 56, 1.5);
    },
  },
  facade_clay: {
    name: 'Facade: unfinished red clay brick house',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      photo(ctx, 'clay', 192, 192);
      window2(ctx, 96, 48, 54, 74, '#f1eee6', true, false);
      floorLine(ctx, 192, 192, 'rgba(0,0,0,0.12)');
    },
  },
  facade_rubble: {
    name: 'Facade: lime-plastered rubble stone house',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      photo(ctx, 'rubble', 192, 192);
      window2(ctx, 96, 52, 46, 66, '#e8e4da', true, true);
      floorLine(ctx, 192, 192, 'rgba(0,0,0,0.1)');
    },
  },
  facade_block: {
    name: 'Facade: bare concrete block wall (shed, no door)',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      photo(ctx, 'block', 192, 192);
      floorLine(ctx, 192, 192, 'rgba(0,0,0,0.12)');
    },
  },
  facade_siding: {
    name: 'Facade: clapboard / vinyl siding house',
    size: [512, 512],
    color: true,
    draw(ctx, W, H) {
      ctx.scale(W / 192, H / 192);
      photo(ctx, 'siding', 192, 192);
      window2(ctx, 96, 48, 54, 74, '#fbfaf6', true, false);
      ctx.fillStyle = 'rgba(40,60,70,0.5)';
      ctx.fillRect(96 - 27 - 17, 48, 13, 74);
      ctx.fillRect(96 + 27 + 4, 48, 13, 74);
      floorLine(ctx, 192, 192, 'rgba(0,0,0,0.1)');
    },
  },
};
