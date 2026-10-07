import { CanvasTexture, SRGBColorSpace } from 'three';
import { Rng } from '../../../../shared/rng';
import type { CarDef } from './types';

/**
 * Seeded livery painter.
 *
 * Atlas layout (1024 x 512): top half = car's RIGHT side, bottom half = LEFT.
 * Inside a half, canvas y runs from the roof/bonnet centreline (y = 0) down to
 * the sill (y = H/2) - so anything painted near y = 0 shows up on top of the
 * bonnet / boot / roof. Canvas x is position along the car: rear -> front on
 * the right side, front -> rear on the left. No lettering: the car number + rally name
 * are a separate door decal (rally-badge.ts).
 * See car-model.ts for the matching UVs.
 */
export const LIVERY_W = 1024;
export const LIVERY_H = 512;

const PALETTE = [
  '#1d4fa8',
  '#c8102e',
  '#f2f0ea',
  '#111418',
  '#f5b400',
  '#0f7a3c',
  '#e05a12',
  '#5a2a86',
  '#9aa3ad',
];

export interface LiveryInfo {
  base: string;
  accent: string;
  accent2: string;
}

export function liveryInfo(
  def: CarDef,
  seed: number,
  paint?: string,
): LiveryInfo {
  const rng = new Rng(seed * 7919 + 13);
  const base = paint ?? (seed === 0 ? def.model.paint : rng.pick(PALETTE));
  const others = PALETTE.filter((c) => c !== base);
  const accent = rng.pick(others);
  const accent2 = rng.pick(others.filter((c) => c !== accent));
  return { base, accent, accent2 };
}

export function paintLivery(
  def: CarDef,
  seed: number,
  paint?: string,
): { texture: CanvasTexture; info: LiveryInfo } {
  const info = liveryInfo(def, seed, paint);
  const canvas = document.createElement('canvas');
  canvas.width = LIVERY_W;
  canvas.height = LIVERY_H;
  const ctx = canvas.getContext('2d')!;
  const half = LIVERY_H / 2;
  for (const side of ['right', 'left'] as const) {
    ctx.save();
    ctx.translate(0, side === 'right' ? 0 : half);
    ctx.beginPath();
    ctx.rect(0, 0, LIVERY_W, half);
    ctx.clip();
    drawSide(ctx, def, info, side, seed, LIVERY_W, half);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, info };
}

/** t: 0 = rear bumper, 1 = front bumper. s: 0 = sill, 1 = roof/bonnet centreline. */
function drawSide(
  ctx: CanvasRenderingContext2D,
  def: CarDef,
  info: LiveryInfo,
  side: 'right' | 'left',
  seed: number,
  W: number,
  H: number,
): void {
  const X = (t: number) => (side === 'right' ? t : 1 - t) * W;
  const Y = (s: number) => (1 - s) * H;
  const rng = new Rng(seed * 31 + 7);

  ctx.fillStyle = info.base;
  ctx.fillRect(0, 0, W, H);

  const poly = (pts: [number, number][], color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([t, s], i) =>
      i ? ctx.lineTo(X(t), Y(s)) : ctx.moveTo(X(t), Y(s)),
    );
    ctx.closePath();
    ctx.fill();
  };

  switch (def.model.livery) {
    case 'swoosh': {
      const k = rng.range(-0.05, 0.08);
      poly(
        [
          [0, 0.18],
          [0.35, 0.3 + k],
          [0.75, 0.62],
          [1, 0.7],
          [1, 0.6],
          [0.7, 0.5],
          [0.3, 0.2 + k],
          [0, 0.08],
        ],
        info.accent,
      );
      poly(
        [
          [0, 0.26],
          [0.4, 0.38 + k],
          [1, 0.8],
          [1, 0.75],
          [0.4, 0.34 + k],
          [0, 0.22],
        ],
        info.accent2,
      );
      // Bonnet / roof stripe pair.
      ctx.fillStyle = info.accent;
      ctx.fillRect(0, Y(1), W, H * 0.07);
      break;
    }
    case 'stripes': {
      ctx.fillStyle = info.accent;
      ctx.fillRect(0, Y(0.5), W, H * 0.08);
      ctx.fillStyle = info.accent2;
      ctx.fillRect(0, Y(0.4), W, H * 0.04);
      ctx.fillStyle = info.accent;
      ctx.fillRect(0, Y(1), W, H * 0.05);
      ctx.fillRect(0, Y(0.92), W, H * 0.03);
      break;
    }
    case 'classic': {
      // Sill band + bonnet stripes, 70s works style.
      ctx.fillStyle = info.accent;
      ctx.fillRect(0, Y(0.2), W, H * 0.12);
      ctx.fillStyle = info.accent2;
      ctx.fillRect(0, Y(0.24), W, H * 0.03);
      ctx.fillStyle = info.accent;
      ctx.fillRect(0, Y(1), W, H * 0.045);
      ctx.fillRect(0, Y(0.94), W, H * 0.025);
      break;
    }
    case 'star': {
      // Works-style side graphic: a yellow crescent under the door sill line that sweeps up at the front, three streaks
      // rising to the rear quarter and a cluster of four-point stars. Generic shapes, no lettering or logo.
      const yellow = '#f4c20d';
      const edge = '#2aa7d8';
      const crescent: [number, number][] = [
        [0.1, 0.62],
        [0.12, 0.42],
        [0.2, 0.25],
        [0.34, 0.13],
        [0.52, 0.09],
        [0.68, 0.13],
        [0.8, 0.3],
        [0.74, 0.2],
        [0.62, 0.17],
        [0.5, 0.18],
        [0.38, 0.24],
        [0.27, 0.36],
        [0.2, 0.52],
        [0.17, 0.66],
      ];
      poly(crescent, edge);
      ctx.save();
      ctx.translate(X(0.005), 0);
      poly(crescent, yellow);
      ctx.restore();
      for (const [t, w] of [
        [0.1, 0.05],
        [0.17, 0.045],
        [0.235, 0.04],
      ] as const) {
        poly(
          [
            [t, 0.66],
            [t + w, 0.66],
            [t + w * 1.9, 0.99],
            [t + w * 0.9, 0.99],
          ],
          yellow,
        );
      }
      const star = (t: number, s: number, r: number) => {
        ctx.fillStyle = yellow;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const rr = i % 2 ? r * 0.28 : r;
          const px = X(t) + Math.cos(a) * rr;
          const py = Y(s) - Math.sin(a) * rr;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      };
      star(0.3, 0.3, 20);
      star(0.38, 0.4, 13);
      star(0.255, 0.43, 11);
      star(0.32, 0.5, 10);
      star(0.4, 0.28, 9);
      break;
    }
    case 'rally1': {
      // Modern works livery: deep blue broken up by lighter / darker shards,
      // a gold panel over the front door, magenta flashes, dark sill.
      const shard = (t: number, s: number, size: number, color: string) => {
        const a = rng.range(0, Math.PI * 2);
        const pts: [number, number][] = [];
        for (let i = 0; i < 3; i++) {
          const ang = a + (i * Math.PI * 2) / 3 + rng.range(-0.5, 0.5);
          const r = size * rng.range(0.5, 1.2);
          pts.push([t + Math.cos(ang) * r * 0.5, s + Math.sin(ang) * r]);
        }
        poly(pts, color);
      };
      const shards = [
        'rgba(40,130,255,0.55)',
        'rgba(6,20,70,0.55)',
        'rgba(130,215,255,0.35)',
        'rgba(20,90,220,0.6)',
      ];
      for (let i = 0; i < 140; i++)
        shard(
          rng.range(0, 1),
          rng.range(0.1, 1),
          rng.range(0.04, 0.14),
          rng.pick(shards),
        );
      // Gold sunburst over the front door, fading into the blue.
      ctx.save();
      const rx = 0.11 * W;
      const ry = 0.62 * H;
      ctx.translate(X(0.6), Y(0.12));
      ctx.scale(1, ry / rx);
      const sun = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      sun.addColorStop(0, '#f6bd1c');
      sun.addColorStop(0.7, '#e3a417');
      sun.addColorStop(1, 'rgba(227,164,23,0)');
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Magenta flashes at the nose and over the rear arch.
      for (const [t, s, w] of [
        [0.9, 0.45, 0.1],
        [0.95, 0.3, 0.06],
        [0.14, 0.62, 0.09],
        [0.3, 0.3, 0.05],
      ])
        poly(
          [
            [t - w / 2, s - 0.02],
            [t + w / 2, s + 0.03],
            [t + w / 2 - 0.01, s + 0.06],
            [t - w / 2 - 0.01, s + 0.01],
          ],
          '#ff3fb4',
        );
      ctx.fillStyle = '#071640';
      ctx.fillRect(0, Y(0.15), W, H * 0.12);
      break;
    }
  }

  if (def.model.livery === 'star') return;

  if (def.model.livery === 'rally1') {
    dirt(ctx, Y, W, H);
    return;
  }

  // Sponsor blocks (plain boxes, no lettering) on the rear quarter, front wing and door top.
  const block = (t: number, s: number, w: number, bg: string) => {
    ctx.fillStyle = bg;
    ctx.fillRect(X(t) - w / 2, Y(s) - 15, w, 30);
  };
  block(0.16, 0.55, 150, '#111');
  block(0.84, 0.4, 120, '#fff');
  block(0.47, 0.25, 140, info.accent2);

  dirt(ctx, Y, W, H);
}

/** Subtle dirt towards the sill (rally cars are never clean). */
function dirt(
  ctx: CanvasRenderingContext2D,
  Y: (s: number) => number,
  W: number,
  H: number,
): void {
  const g = ctx.createLinearGradient(0, Y(0.35), 0, Y(0));
  g.addColorStop(0, 'rgba(120,100,70,0)');
  g.addColorStop(1, 'rgba(120,100,70,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, Y(0.35), W, H * 0.35);
}
