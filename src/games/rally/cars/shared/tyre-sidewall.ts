import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import fontUrl from '../../assets/fonts/barlow-condensed-latin-800-italic.woff2';
import { TYRES, type TyreId } from '../../physics/tyres';
import wordmarkUrl from '../../wordmark.svg';

/**
 * Sidewall lettering, printed like on real rally tyres: the game's wordmark on one side, the tyre's name (in the
 * compound colour) on the other, and the compound colour band running between them. Drawn into a strip texture once per
 * compound: u around the tyre, v across the lettering band (tyre-mesh.ts lays a thin ring over the outer sidewall for
 * it). Redrawn once the wordmark and the font have loaded.
 */

/** Strip size (px): ~0.5 mm per pixel around a 15-18" tyre, the band ~50 mm tall. */
const W = 3200;
const H = 80;
const FONT = 'TyreSidewall';
const LOGO_ASPECT = 5237 / 1020; // wordmark.svg viewBox

let logo: HTMLImageElement | null = null;
let fontReady = false;
let loading = false;
const strips = new Map<
  TyreId,
  { canvas: HTMLCanvasElement; tex: CanvasTexture }
>();

function load(): void {
  if (loading || typeof document === 'undefined') return;
  loading = true;
  const redraw = () => {
    for (const [c, s] of strips) {
      draw(c, s.canvas);
      s.tex.needsUpdate = true;
    }
  };
  const img = new Image();
  img.onload = () => {
    logo = img;
    measureLogo(img);
    redraw();
  };
  img.src = wordmarkUrl;
  if (typeof FontFace !== 'undefined')
    new FontFace(FONT, `url(${fontUrl})`, { style: 'italic', weight: '800' })
      .load()
      .then((f) => {
        document.fonts.add(f);
        fontReady = true;
        redraw();
      })
      .catch(() => undefined);
}

function draw(c: TyreId, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  // Printed paint: the menu dot's colour, brightened so it reads on black rubber in any light.
  const hsl = new Color(TYRES[c].color).getHSL(
    { h: 0, s: 0, l: 0 },
    SRGBColorSpace,
  );
  const color = `#${new Color()
    .setHSL(
      hsl.h,
      Math.min(1, hsl.s * 1.1),
      Math.max(0.62, Math.min(0.9, hsl.l + 0.12)),
      SRGBColorSpace,
    )
    .getHexString()}`;
  const paint = '#f4f4f0';
  // The two prints, centred a half turn apart: [centre, width].
  const fontPx = 64;
  ctx.font = `italic 800 ${fontPx}px ${fontReady ? FONT : "'Barlow Condensed', sans-serif"}`;
  const name = TYRES[c].name.toUpperCase();
  const nm = ctx.measureText(name);
  const nameW = nm.width;
  // The wordmark scaled so its letters are as tall as the name's capitals.
  const capH = nm.actualBoundingBoxAscent - nm.actualBoundingBoxDescent;
  const [inkTop, inkBottom] = logoInk ?? [0.11, 0.81];
  const logoH = capH / (inkBottom - inkTop);
  const logoW = logoH * LOGO_ASPECT;
  const prints: [number, number][] = [
    [W * 0.25, logoW],
    [W * 0.75, nameW],
  ];
  // Band between them (a quarter of the font size thick), a clear gap either side of each print.
  ctx.fillStyle = color;
  const band = fontPx / 4;
  const gap = fontPx;
  for (let i = 0; i < prints.length; i++) {
    const [c0, w0] = prints[i];
    const [c1, w1] = prints[(i + 1) % prints.length];
    const x0 = c0 + w0 / 2 + gap;
    const x1 = (i === prints.length - 1 ? c1 + W : c1) - w1 / 2 - gap;
    // The strip wraps around: draw the band twice, shifted a turn.
    for (const shift of [0, -W])
      ctx.fillRect(x0 + shift, H / 2 - band / 2, x1 - x0, band);
  }
  // Wordmark (white in the svg) and the tyre's name in the compound colour, both centred on the band by their ink
  // (not their boxes: the wordmark's letters sit high in its viewBox, caps sit high in the em box).
  if (logo) {
    const y = H / 2 - logoH * ((inkTop + inkBottom) / 2);
    ctx.drawImage(logo, W * 0.25 - logoW / 2, y, logoW, logoH);
  } else centredText(ctx, 'GRAVEL RALLY', W * 0.25, paint);
  centredText(ctx, name, W * 0.75, color);
}

/** Text centred across the band by its ink. */
function centredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const ink = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent;
  ctx.fillText(text, x, H / 2 + ink / 2);
}

/** The wordmark's ink rows (top, bottom) as fractions of its height, measured once it has loaded. */
let logoInk: [number, number] | null = null;
function measureLogo(img: HTMLImageElement): void {
  const w = 512;
  const h = Math.round(w / LOGO_ASPECT);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, w, h);
  const a = ctx.getImageData(0, 0, w, h).data;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[(y * w + x) * 4 + 3] > 64) {
        if (top < 0) top = y;
        bottom = y + 1;
        break;
      }
  if (top >= 0) logoInk = [top / h, bottom / h];
}

const materials = new Map<TyreId, MeshStandardMaterial>();

/** The lettering ring's material of a compound (shared by every car). */
export function sidewallMaterial(c: TyreId): MeshStandardMaterial {
  let m = materials.get(c);
  if (m) return m;
  m = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  m.name = `tyre-sidewall-${c}`;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    if (canvas.getContext('2d')) {
      draw(c, canvas);
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = RepeatWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.anisotropy = 8;
      tex.name = m.name;
      m.map = tex;
      strips.set(c, { canvas, tex });
      load();
    } else m.visible = false;
  } else m.visible = false;
  materials.set(c, m);
  return m;
}
