import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { Rng } from '../../../shared/rng';

/**
 * Procedural floor textures of the toy store: greyscale tiles that multiply the vertex colour of a
 * floor patch, so every department keeps its mat colour and gains a surface (carpet, foam tiles,
 * waves, studs...). Tileable 256 px canvases, nearest filtering like the window tiles. `metres` is
 * the world size one tile covers (the floor mesh derives its UVs from x / z).
 */
export type FloorKind =
  | 'terrazzo'
  | 'carpet'
  | 'foam'
  | 'waves'
  | 'concrete'
  | 'tile'
  | 'dots'
  | 'studs';

export const FLOOR_METRES: Record<FloorKind, number> = {
  terrazzo: 24,
  carpet: 10,
  foam: 14,
  waves: 16,
  concrete: 24,
  tile: 20,
  dots: 12,
  studs: 12,
};

/** Which texture a department mat gets (by zone name); everything else is terrazzo. */
export function floorKindOf(zoneName: string): FloorKind {
  const n = zoneName.toLowerCase();
  if (n.includes('plush')) return 'carpet';
  if (n.includes('doll')) return 'dots';
  if (n.includes('brick')) return 'studs';
  if (n.includes('splash')) return 'waves';
  if (n.includes('stock')) return 'concrete';
  if (n.includes('robot') || n.includes('checkout') || n.includes('atrium'))
    return 'tile';
  if (n.includes('game') || n.includes('vroom') || n.includes('figure'))
    return 'foam';
  return 'terrazzo';
}

const S = 256;
const cache = new Map<FloorKind, CanvasTexture>();

function grey(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}

/** Fill the tile with a base grey plus per-pixel noise of +-`amp`. */
function noiseFill(
  g: CanvasRenderingContext2D,
  rng: Rng,
  base: number,
  amp: number,
  step = 2,
): void {
  for (let y = 0; y < S; y += step)
    for (let x = 0; x < S; x += step) {
      g.fillStyle = grey(base + (rng.next() - 0.5) * 2 * amp);
      g.fillRect(x, y, step, step);
    }
}

function draw(kind: FloorKind, g: CanvasRenderingContext2D): void {
  const rng = new Rng(kind.length * 977 + kind.charCodeAt(0));
  switch (kind) {
    case 'terrazzo': {
      noiseFill(g, rng, 240, 6, 4);
      for (let i = 0; i < 260; i++) {
        const x = rng.range(0, S);
        const y = rng.range(0, S);
        const r = rng.range(1, 3.2);
        g.fillStyle = grey(rng.chance(0.5) ? 196 + rng.range(0, 16) : 255);
        for (const ox of [-S, 0, S])
          for (const oy of [-S, 0, S]) g.fillRect(x + ox, y + oy, r, r);
      }
      break;
    }
    case 'carpet': {
      noiseFill(g, rng, 232, 22, 2);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 2;
      for (let k = -S; k < S * 2; k += 16) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + S, S);
        g.stroke();
      }
      break;
    }
    case 'foam': {
      // 4 x 4 interlocking mat tiles: darker seams, lighter inner face
      g.fillStyle = grey(236);
      g.fillRect(0, 0, S, S);
      const t = S / 4;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = grey(250 - ((i + j) % 2) * 10);
          g.fillRect(i * t + 4, j * t + 4, t - 8, t - 8);
          g.fillStyle = grey(255);
          g.fillRect(i * t + 4, j * t + 4, t - 8, 3);
        }
      break;
    }
    case 'waves': {
      g.fillStyle = grey(252);
      g.fillRect(0, 0, S, S);
      g.strokeStyle = grey(200);
      g.lineWidth = 8;
      for (let row = 0; row < 8; row++) {
        g.beginPath();
        for (let x = 0; x <= S; x += 4) {
          const y = row * 32 + 16 + Math.sin((x / S) * Math.PI * 4) * 7;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
    case 'concrete': {
      noiseFill(g, rng, 238, 7, 4);
      g.strokeStyle = grey(214);
      g.lineWidth = 3;
      g.strokeRect(1, 1, S - 2, S - 2);
      for (let i = 0; i < 6; i++) {
        let x = rng.range(0, S);
        let y = rng.range(0, S);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += rng.range(-14, 14);
          y += rng.range(4, 14);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
    case 'tile': {
      // 4 x 4 glossy tiles with grout
      g.fillStyle = grey(212);
      g.fillRect(0, 0, S, S);
      const t = S / 4;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          g.fillStyle = grey(250 - ((i * 3 + j) % 3) * 5);
          g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
          g.fillStyle = grey(255);
          g.fillRect(i * t + 3, j * t + 3, (t - 6) * 0.45, 3);
        }
      break;
    }
    case 'dots': {
      g.fillStyle = grey(214);
      g.fillRect(0, 0, S, S);
      g.fillStyle = grey(255);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) {
          const x = col * 64 + (row % 2 ? 64 : 32);
          const y = row * 64 + 32;
          for (const ox of [-S, 0, S]) {
            g.beginPath();
            g.arc(x + ox, y, 15, 0, Math.PI * 2);
            g.fill();
          }
        }
      break;
    }
    case 'studs': {
      // a brick base plate: an 8 x 8 grid of round studs with a highlight and a shadow edge
      g.fillStyle = grey(236);
      g.fillRect(0, 0, S, S);
      const t = S / 8;
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          const cx = i * t + t / 2;
          const cy = j * t + t / 2;
          g.fillStyle = grey(214);
          g.beginPath();
          g.arc(cx + 2, cy + 3, t * 0.36, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = grey(255);
          g.beginPath();
          g.arc(cx, cy, t * 0.36, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = grey(240);
          g.beginPath();
          g.arc(cx + 1.5, cy + 1.5, t * 0.2, 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
  }
}

/** Shared texture per kind (created once, repeats in both directions). */
export function floorTexture(kind: FloorKind): CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  draw(kind, c.getContext('2d')!);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  cache.set(kind, tex);
  return tex;
}
