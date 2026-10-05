import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Canvas textures of the highway structures (world/bridge-mesh.ts, world/gantry-mesh.ts): the plates on a
 * portal headwall (street name, clearance) and the green overhead sign boards. Like
 * stage-sign-textures.ts they depend on the map's data (names, heights), so they are cached by their text.
 * Everything is generic: plain text, no shields, logos or agency marks.
 */

const cache = new Map<string, Texture>();
const FONT = 'Arial Narrow, Arial, Helvetica, sans-serif';

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
  weight = 'bold',
): number {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}

/** Green street-name plate on a headwall (1024 x 256, 4 : 1): white text, white border. */
export function namePlateTexture(name: string): Texture {
  const text = name.toUpperCase();
  return make(`name:${text}`, 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0f6b3a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f4f4f1';
    ctx.lineWidth = 12;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#f7f7f4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fit(ctx, text, 150, w - 90)}px ${FONT}`;
    ctx.fillText(text, w / 2, h / 2 + 8);
  });
}

/** White clearance plate (512 x 320, 8 : 5): the height big, "CLEARANCE" small, black border. */
export function clearancePlateTexture(height: string): Texture {
  return make(`clear:${height}`, 512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#f6f6f2';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 12;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#141414';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fit(ctx, height, 170, w - 70)}px ${FONT}`;
    ctx.fillText(height, w / 2, h * 0.42);
    ctx.font = `bold 58px ${FONT}`;
    ctx.fillText('CLEARANCE', w / 2, h * 0.8);
  });
}

/** Yellow advisory speed plate (384 x 384): "35" big, "MPH" small, "ADVISORY" on top - black on yellow. */
export function advisoryPlateTexture(speed: number): Texture {
  return make(`advisory:${speed}`, 384, 384, (ctx, w, h) => {
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 14;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#141414';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 62px ${FONT}`;
    ctx.fillText('ADVISORY', w / 2, h * 0.17);
    ctx.font = `bold ${fit(ctx, String(speed), 220, w - 100)}px ${FONT}`;
    ctx.fillText(String(speed), w / 2, h * 0.52);
    ctx.font = `bold 78px ${FONT}`;
    ctx.fillText('MPH', w / 2, h * 0.84);
  });
}

/** Feet-inches text of a height in metres (clearance plates): 3.86 m -> 12'-8". */
export function feetInches(m: number): string {
  const total = Math.round((m / 0.3048) * 12);
  const ft = Math.floor(total / 12);
  const inch = total - ft * 12;
  return `${ft}'-${inch}"`;
}

export interface SignBoard {
  /** Small tab above the board ("EXIT 7", "EXITS 8 E-W"); omitted = none. */
  tab?: string;
  /** Big lines (road names / destinations). */
  lines: string[];
  /** Last line smaller ("1/4 MILE", "NEXT RIGHT"); omitted = none. */
  small?: string;
  /** Arrow under the text: 'down' (this lane), 'right' / 'left' (exit), omitted = none. */
  arrow?: 'down' | 'right' | 'left';
}

/** Overhead guide sign (1024 x 512 + tab): green board, white text and border, an arrow. */
export function signBoardTexture(b: SignBoard): Texture {
  const key = `sign:${b.tab ?? ''}|${b.lines.join('|')}|${b.small ?? ''}|${b.arrow ?? ''}`;
  return make(key, 1024, 640, (ctx, w, h) => {
    const tabH = b.tab ? 110 : 0;
    ctx.clearRect(0, 0, w, h);
    // Board.
    ctx.fillStyle = '#0f6b3a';
    ctx.fillRect(0, tabH, w, h - tabH);
    ctx.strokeStyle = '#f4f4f1';
    ctx.lineWidth = 10;
    ctx.strokeRect(12, tabH + 12, w - 24, h - tabH - 24);
    ctx.fillStyle = '#f7f7f4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b.tab) {
      // Tab: a narrower green plate above the board's right half.
      const tw = Math.min(w - 40, 120 + b.tab.length * 44);
      const tx = w - 40 - tw;
      ctx.fillStyle = '#0f6b3a';
      ctx.fillRect(tx, 0, tw, tabH + 12);
      ctx.strokeRect(tx + 10, 10, tw - 20, tabH - 10);
      ctx.fillStyle = '#f7f7f4';
      ctx.font = `bold ${fit(ctx, b.tab, 64, tw - 50)}px ${FONT}`;
      ctx.fillText(b.tab, tx + tw / 2, tabH / 2 + 6);
    }
    const lines = b.lines.length;
    const area = h - tabH - 60 - (b.small ? 70 : 0) - (b.arrow ? 110 : 0);
    const lh = Math.min(150, area / Math.max(1, lines));
    let y = tabH + 40 + lh / 2;
    for (const line of b.lines) {
      ctx.font = `bold ${fit(ctx, line, lh * 0.74, w - 100)}px ${FONT}`;
      ctx.fillText(line, w / 2, y);
      y += lh;
    }
    if (b.small) {
      ctx.font = `bold 56px ${FONT}`;
      ctx.fillText(b.small, w / 2, y + 10);
    }
    if (b.arrow) {
      ctx.save();
      ctx.translate(w / 2, h - 70);
      if (b.arrow === 'right') ctx.rotate(-Math.PI / 2);
      if (b.arrow === 'left') ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo(-38, -4);
      ctx.lineTo(-14, -4);
      ctx.lineTo(-14, -42);
      ctx.lineTo(14, -42);
      ctx.lineTo(14, -4);
      ctx.lineTo(38, -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
}

/** Chain-link fence (256 x 256, tileable, alpha): a diamond mesh on transparent ground. */
export function chainLinkTexture(): Texture {
  return make('chainlink', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(190,195,200,0.95)';
    ctx.lineWidth = 3;
    const s = 32;
    ctx.beginPath();
    for (let x = -h; x < w + h; x += s) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.moveTo(x + h, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
  });
}
