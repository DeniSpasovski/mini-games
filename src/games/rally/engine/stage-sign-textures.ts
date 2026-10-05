import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Canvas textures of the stage furniture (world/stage-sign-mesh.ts): the start / finish gantry
 * header (map name + year), its side panels and timing clock and the split boards. Unlike engine/textures.ts these depend on the map (name, year, split
 * number, distance), so they are cached by their parameters instead of by a fixed id.
 */

export type GantryKind = 'start' | 'finish';

export interface StageTitle {
  /** Map name, shown big in the header. */
  name: string;
  year: number;
  /** "SS3" badge text source (MapDef.stageNumber), omitted when the map has none. */
  stageNumber?: number;
}

const cache = new Map<string, Texture>();

/** Header aspect (width : height): the panel in stage-sign-mesh.ts is built to this ratio. */
export const HEADER_ASPECT = 8;
const FONT = 'Impact, Haettenschweiler, Arial Black, sans-serif';

function make(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Texture {
  let t = cache.get(key);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  t.name = key;
  cache.set(key, t);
  return t;
}

/** Font size (px) at which `text` is at most `maxW` wide. */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  maxW: number,
  font = FONT,
): number {
  ctx.font = `${size}px ${font}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}

function chequer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  a = '#f4f4f0',
  b = '#101010',
): void {
  for (let j = 0; j * s < h; j++)
    for (let i = 0; i * s < w; i++) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(x + i * s, y + j * s, Math.min(s, w - i * s), Math.min(s, h - j * s));
    }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Soft diagonal speed stripes over a banner (adds depth to the flat gradient). */
function speedStripes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let x = -h; x < w; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 38, h);
    ctx.lineTo(x + 38 + h * 0.6, 0);
    ctx.lineTo(x + h * 0.6, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const THEME = {
  start: { top: '#2a6ee0', bottom: '#0a2766', accent: '#f5c518', word: 'START' },
  finish: { top: '#e23a2c', bottom: '#7a1109', accent: '#ffffff', word: 'FINISH' },
} as const;

/**
 * Header of a gantry (2048 x 256): [START / FINISH badge] [MAP NAME + small "GRAVEL RALLY" line]
 * [year badge], framed by yellow trim (start) or chequers (finish).
 */
export function headerTexture(kind: GantryKind, title: StageTitle): Texture {
  const name = title.name.toUpperCase();
  const key = `header:${kind}:${name}:${title.year}:${title.stageNumber ?? ''}`;
  return make(key, 2048, 256, (ctx, w, h) => {
    const th = THEME[kind];
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, th.top);
    g.addColorStop(1, th.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    speedStripes(ctx, w, h, 'rgba(255,255,255,0.07)');
    // Frame.
    if (kind === 'finish') {
      chequer(ctx, 0, 0, w, 24, 24);
      chequer(ctx, 0, h - 24, w, 24, 24, '#101010', '#f4f4f0');
    } else {
      ctx.fillStyle = th.accent;
      ctx.fillRect(0, 0, w, 14);
      ctx.fillRect(0, h - 14, w, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 14, w, 4);
      ctx.fillRect(0, h - 18, w, 4);
    }
    const inset = kind === 'finish' ? 30 : 24;
    // Left badge: START / FINISH (+ stage number).
    const bw = 380;
    roundRect(ctx, 36, inset + 10, bw, h - 2 * inset - 20, 22);
    ctx.fillStyle = kind === 'start' ? '#1faa4b' : '#101010';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hasSs = title.stageNumber !== undefined;
    ctx.font = `${fit(ctx, th.word, hasSs ? 92 : 120, bw - 50)}px ${FONT}`;
    ctx.fillText(th.word, 36 + bw / 2, h / 2 + (hasSs ? 30 : 4));
    if (hasSs) {
      ctx.fillStyle = kind === 'start' ? '#d9ffe3' : '#f5c518';
      ctx.font = `44px ${FONT}`;
      ctx.fillText(`SS${title.stageNumber}`, 36 + bw / 2, inset + 50);
    }
    // Year badge on the right.
    const yw = 340;
    const yx = w - 36 - yw;
    roundRect(ctx, yx, inset + 10, yw, h - 2 * inset - 20, 22);
    ctx.fillStyle = '#f5c518';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#101010';
    ctx.stroke();
    ctx.fillStyle = '#101010';
    ctx.font = `34px ${FONT}`;
    ctx.fillText('RALLY', yx + yw / 2, inset + 46);
    ctx.font = `${fit(ctx, String(title.year), 128, yw - 40)}px ${FONT}`;
    ctx.fillText(String(title.year), yx + yw / 2, h / 2 + 18);
    // Map name between the badges.
    const cx0 = 36 + bw + 30;
    const cx1 = yx - 30;
    const cx = (cx0 + cx1) / 2;
    ctx.fillStyle = th.accent;
    ctx.font = `38px ${FONT}`;
    ctx.fillText('G R A V E L   R A L L Y', cx, inset + 34);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    ctx.font = `${fit(ctx, name, 150, cx1 - cx0)}px ${FONT}`;
    ctx.fillText(name, cx, h / 2 + 24);
    ctx.shadowColor = 'transparent';
  });
}

/** Vertical panel on a gantry pillar (256 x 1024): map name and year along the pillar, read bottom-up. */
export function sideTexture(kind: GantryKind, title: StageTitle): Texture {
  const name = title.name.toUpperCase();
  const key = `side:${kind}:${name}:${title.year}`;
  return make(key, 256, 1024, (ctx, w, h) => {
    const th = THEME[kind];
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, th.bottom);
    g.addColorStop(0.5, th.top);
    g.addColorStop(1, th.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = th.accent;
    ctx.fillRect(0, 0, 14, h);
    ctx.fillRect(w - 14, 0, 14, h);
    chequer(ctx, 14, h - 96, w - 28, 96, 24);
    ctx.save();
    ctx.translate(w / 2, (h - 96) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${fit(ctx, name, 130, h - 96 - 140)}px ${FONT}`;
    ctx.fillText(name, 0, -18);
    ctx.fillStyle = th.accent;
    ctx.font = `70px ${FONT}`;
    ctx.fillText(`RALLY ${title.year}`, 0, 62);
    ctx.restore();
  });
}

/** Timing clock hung under the header (512 x 192): amber caption + red LED digits. */
export function clockTexture(kind: GantryKind): Texture {
  return make(`clock:${kind}`, 512, 192, (ctx, w, h) =>
    drawClock(ctx, w, h, kind, kind === 'start' ? '0:00.0' : '-:--.-'),
  );
}

function drawClock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  kind: GantryKind,
  digits: string,
): void {
  ctx.fillStyle = '#16181c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a3e46';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb000';
  ctx.font = `46px ${FONT}`;
  ctx.fillText(kind === 'start' ? 'STAGE START' : 'STAGE TIME', w / 2, 44);
  ctx.fillStyle = '#ff2a1a';
  ctx.shadowColor = '#ff2a1a';
  ctx.shadowBlur = 18;
  ctx.font = `bold 96px Consolas, 'Courier New', monospace`;
  ctx.fillText(digits, w / 2, 124);
  ctx.shadowBlur = 0;
}

const clockShown = new Map<GantryKind, string>();

/** Live gantry clock: redraws the digits (tenths of a second) when they change. */
export function setClockTime(kind: GantryKind, seconds: number): void {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const digits = `${m}:${(Math.floor(t * 10) / 10 - m * 60).toFixed(1).padStart(4, '0')}`;
  if (clockShown.get(kind) === digits) return;
  const tex = cache.get(`clock:${kind}`);
  if (!tex) return;
  clockShown.set(kind, digits);
  const canvas = tex.image as HTMLCanvasElement;
  drawClock(canvas.getContext('2d')!, canvas.width, canvas.height, kind, digits);
  tex.needsUpdate = true;
}

export interface BoardInfo {
  /** 1-based split number. */
  split: number;
  /** Distance from the start line (m). */
  distance: number;
}

/** Split board (256 x 384): "SPLIT n" header, "SECTOR n > n+1", distance from the start, chequer foot. */
export function boardTexture(info: BoardInfo): Texture {
  const km = (info.distance / 1000).toFixed(2);
  return make(`board:${info.split}:${km}`, 256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#0d2c66';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, w, 78);
    ctx.fillStyle = '#101010';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `64px ${FONT}`;
    ctx.fillText(`SPLIT ${info.split}`, w / 2, 42);
    ctx.fillStyle = '#9fc0ff';
    ctx.font = `34px ${FONT}`;
    ctx.fillText('SECTOR', w / 2, 118);
    // "1 > 2": the sector that ends here and the one that starts.
    ctx.fillStyle = '#ffffff';
    ctx.font = `120px ${FONT}`;
    ctx.fillText(String(info.split), 64, 208);
    ctx.fillText(String(info.split + 1), w - 64, 208);
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, 168);
    ctx.lineTo(w / 2 + 26, 208);
    ctx.lineTo(w / 2 - 26, 248);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `46px ${FONT}`;
    ctx.fillText(`${km} km`, w / 2, 286);
    chequer(ctx, 0, h - 52, w, 52, 26);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}
