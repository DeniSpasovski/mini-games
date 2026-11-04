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
  const logoH = 58;
  const logoW = logoH * LOGO_ASPECT;
  const fontPx = 64;
  ctx.font = `italic 800 ${fontPx}px ${fontReady ? FONT : "'Barlow Condensed', sans-serif"}`;
  const name = TYRES[c].name.toUpperCase();
  const nameW = ctx.measureText(name).width;
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
  // Wordmark (white in the svg) and the tyre's name in the compound colour.
  if (logo) {
    ctx.globalAlpha = 1;
    ctx.drawImage(logo, W * 0.25 - logoW / 2, (H - logoH) / 2, logoW, logoH);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = paint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GRAVEL RALLY', W * 0.25, H / 2 + 2);
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, W * 0.75, H / 2 + 2);
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
