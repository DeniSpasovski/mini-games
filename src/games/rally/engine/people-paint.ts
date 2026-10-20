import type { Rng } from '../../../shared/rng';

/** Canvas helpers of the people atlas: cells, seams, creases, weaves (all in grey: the vertex colours tint them). */
export type Ctx = CanvasRenderingContext2D;

/** One cell is 256 px; the atlas is 4 cells wide. */
export const CELL = 256;

export function paintTools(ctx: Ctx, rng: Rng) {
  const S = CELL;
  const P = {
    cell(
      i: number,
      base: number,
      wCells: number,
      fn: (ox: number, oy: number, w: number) => void,
    ) {
      const ox = (i % 4) * S;
      const oy = Math.floor(i / 4) * S;
      const w = S * wCells;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, S);
      ctx.clip();
      ctx.fillStyle = `rgb(${base},${base},${base})`;
      ctx.fillRect(ox, oy, w, S);
      fn(ox, oy, w);
      ctx.restore();
    },
  };
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: string,
    width = 1,
    dash: number[] = [],
  ) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  /** A seam: a dark groove with a stitched highlight beside it. */
  const seam = (x0: number, y0: number, x1: number, y1: number, k = 1) => {
    line(x0, y0, x1, y1, `rgba(0,0,0,${0.5 * k})`, 2.6);
    line(
      x0 + 2.5,
      y0,
      x1 + 2.5,
      y1,
      `rgba(255,255,255,${0.35 * k})`,
      1.2,
      [4, 3],
    );
  };
  const blob = (
    cx: number,
    cy: number,
    r: number,
    rgba: string,
    sx = 1,
    sy = 1,
  ) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  };
  const speckle = (ox: number, oy: number, w: number, n: number, a: number) => {
    for (let k = 0; k < n; k++) {
      ctx.fillStyle =
        rng.next() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(ox + rng.next() * w, oy + rng.next() * S, 1.5, 1.5);
    }
  };
  /** Soft creases: dark band with a light edge, along a wobbly path. */
  const crease = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    a: number,
    wid: number,
  ) => {
    const mx = (x0 + x1) / 2 + rng.range(-8, 8);
    const my = (y0 + y1) / 2 + rng.range(-5, 5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = wid;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`;
    ctx.lineWidth = wid * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + wid);
    ctx.quadraticCurveTo(mx, my + wid, x1, y1 + wid);
    ctx.stroke();
    ctx.restore();
  };
  /** Edge shading where the garment turns away: the back seam (u 0 / 1) and the flanks. */
  const turn = (ox: number, oy: number, w: number) => {
    for (const [x, a] of [
      [0, 0.32],
      [w, 0.32],
    ] as const) {
      const g = ctx.createLinearGradient(
        ox + x,
        0,
        ox + (x === 0 ? w * 0.18 : w * 0.82),
        0,
      );
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox, oy, w, S);
    }
  };
  const weave = (ox: number, oy: number, w: number, a: number, step = 2) => {
    for (let y = 0; y < S; y += step)
      line(ox, oy + y, ox + w, oy + y, `rgba(0,0,0,${a})`, 1);
    for (let x = 0; x < w; x += step + 1)
      line(ox + x, oy, ox + x, oy + S, `rgba(0,0,0,${a * 0.8})`, 1);
  };

  return { P, line, seam, blob, speckle, crease, turn, weave, S };
}
