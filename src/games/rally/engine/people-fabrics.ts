import type { Rng } from '../../../shared/rng';
import { CELL, type Ctx, type paintTools } from './people-paint';

/**
 * The fabrics of the people atlas that are unwrapped round a body (rows 4-7, plus the rib and belt leather cells):
 * u = 0 is the front centre line, 0.5 the side seam, 1 the back centre line (mirrored left / right); v runs down from a
 * fixed start (neck, shoulder, waist) at 0.62 .. 1 metre per cell (people-tailor.ts `SPAN`), so a weave keeps its scale
 * and a pocket sits where it should. Painted in grey: the garment colour tints them.
 */

type Tools = ReturnType<typeof paintTools>;

export function drawFabrics(ctx: Ctx, rng: Rng, tools: Tools): void {
  const { P, line, seam, speckle, crease, blob } = tools;
  const S = CELL;
  /** Cell pixel of u / v (the unwrap keeps a 2% margin). */
  const X = (ox: number, u: number): number => ox + S * (0.02 + 0.96 * u);
  const Y = (oy: number, v: number): number => oy + S * (0.02 + 0.96 * v);

  const knit = (ox: number, oy: number, a = 0.07): void => {
    for (let x = 0; x < S; x += 2)
      line(ox + x, oy, ox + x, oy + S, `rgba(0,0,0,${a})`, 1);
    for (let y = 1; y < S; y += 3)
      line(ox, oy + y, ox + S, oy + y, `rgba(0,0,0,${a * 0.6})`, 1);
  };
  const twill = (ox: number, oy: number, a: number, pitch = 3): void => {
    for (let k = -S; k < S * 2; k += pitch)
      line(ox + k, oy, ox + k + S, oy + S, `rgba(0,0,0,${a})`, 1);
  };
  const ripstop = (ox: number, oy: number, a = 0.06): void => {
    for (let k = 0; k < S; k += 2) {
      line(ox + k, oy, ox + k, oy + S, `rgba(0,0,0,${a * 0.5})`, 1);
      line(ox, oy + k, ox + S, oy + k, `rgba(0,0,0,${a * 0.5})`, 1);
    }
    for (let k = 0; k < S; k += 12) {
      line(ox + k, oy, ox + k, oy + S, `rgba(0,0,0,${a * 1.6})`, 1);
      line(ox, oy + k, ox + S, oy + k, `rgba(0,0,0,${a * 1.6})`, 1);
    }
  };
  /** A zip down a line: dark tape, teeth, a pull tab. */
  const zip = (x: number, y0: number, y1: number): void => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - 6, y0, 12, y1 - y0);
    line(x, y0, x, y1, 'rgba(0,0,0,0.7)', 3);
    line(x, y0, x, y1, 'rgba(255,255,255,0.75)', 1.2, [2, 2]);
    ctx.fillStyle = 'rgba(25,25,25,0.9)';
    ctx.fillRect(x - 2.5, y0 + 3, 5, 14);
  };
  /** A stitched rectangle (pocket, flap, pad) with a top edge shadow. */
  const patch = (
    x: number,
    y: number,
    w: number,
    h: number,
    a = 0.5,
    r = 0,
  ): void => {
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (r) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (r) ctx.roundRect(x + 3, y + 3, w - 6, h - 6, r);
    else ctx.rect(x + 3, y + 3, w - 6, h - 6);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const button = (x: number, y: number, r = 3.4): void => {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x - 0.8, y - 0.8, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  };
  const creases = (
    ox: number,
    oy: number,
    v0: number,
    v1: number,
    n: number,
    a: number,
  ): void => {
    for (let k = 0; k < n; k++) {
      const v = v0 + ((v1 - v0) * k) / Math.max(1, n - 1);
      crease(
        X(ox, rng.range(0.05, 0.35)),
        Y(oy, v),
        X(ox, rng.range(0.6, 0.95)),
        Y(oy, v) + rng.range(-6, 6),
        a,
        5,
      );
    }
  };

  // 0 rib: vertical ribbing, the collars, cuffs and hems.
  P.cell(0, 236, 1, (ox, oy) => {
    for (let x = 0; x < S; x += 4) {
      line(ox + x, oy, ox + x, oy + S, 'rgba(0,0,0,0.3)', 1.8);
      line(ox + x + 2, oy, ox + x + 2, oy + S, 'rgba(255,255,255,0.22)', 1);
    }
  });

  // 3 belt leather: grain, stitching, a buckle at the front centre.
  P.cell(3, 150, 1, (ox, oy) => {
    speckle(ox, oy, S, 900, 0.12);
    line(ox, oy + S * 0.12, ox + S, oy + S * 0.12, 'rgba(255,255,255,0.35)', 1.2, [5, 4]);
    line(ox, oy + S * 0.88, ox + S, oy + S * 0.88, 'rgba(255,255,255,0.35)', 1.2, [5, 4]);
    ctx.fillStyle = 'rgba(210,210,215,0.95)';
    ctx.fillRect(ox + 2, oy + S * 0.04, 30, S * 0.92);
    ctx.fillStyle = 'rgba(70,70,75,0.9)';
    ctx.fillRect(ox + 8, oy + S * 0.16, 18, S * 0.68);
  });

  // 16 jersey: fine knit, a faint side seam, creases over the belly.
  P.cell(16, 250, 1, (ox, oy) => {
    knit(ox, oy);
    seam(X(ox, 0.5) - 2, Y(oy, 0), X(ox, 0.5) - 2, Y(oy, 1), 0.4);
    creases(ox, oy, 0.62, 0.78, 8, 0.1);
    speckle(ox, oy, S, 400, 0.05);
  });

  // 17 polo: piqué dots, the placket with buttons at the front centre, side seams.
  P.cell(17, 248, 1, (ox, oy) => {
    for (let y = 0; y < S; y += 4)
      for (let x = (y / 4) % 2 ? 2 : 0; x < S; x += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.09)';
        ctx.fillRect(ox + x, oy + y, 2, 2);
      }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox + 1, Y(oy, 0.0), 22, S * 0.2);
    line(ox + 24, Y(oy, 0), ox + 24, Y(oy, 0.2), 'rgba(0,0,0,0.45)', 1.5);
    for (const v of [0.04, 0.1, 0.16]) button(ox + 12, Y(oy, v), 3);
    seam(X(ox, 0.5) - 2, Y(oy, 0.1), X(ox, 0.5) - 2, Y(oy, 1), 0.4);
    creases(ox, oy, 0.62, 0.78, 6, 0.09);
  });

  // 18 jersey sleeve: knit along the arm, an underarm seam, elbow creases.
  P.cell(18, 250, 1, (ox, oy) => {
    knit(ox, oy);
    seam(X(ox, 1) - 4, Y(oy, 0), X(ox, 1) - 4, Y(oy, 1), 0.4);
    for (let k = 0; k < 7; k++) {
      const y = Y(oy, 0.4 + k * 0.03);
      crease(ox, y, ox + S, y + rng.range(-5, 5), 0.12, 5);
    }
    speckle(ox, oy, S, 300, 0.05);
  });

  // 19 fleece / sweat: soft mottled pile, the kangaroo pocket, a hem seam, side seams.
  P.cell(19, 246, 1, (ox, oy) => {
    speckle(ox, oy, S, 3200, 0.07);
    for (let k = 0; k < 40; k++)
      blob(ox + rng.range(0, S), oy + rng.range(0, S), rng.range(8, 18), 'rgba(0,0,0,0.045)');
    // Kangaroo pocket across the front with its slanted opening.
    patch(X(ox, 0.02), Y(oy, 0.6), S * 0.34, S * 0.2, 0.45, 8);
    line(X(ox, 0.02), Y(oy, 0.6), X(ox, 0.34), Y(oy, 0.64), 'rgba(0,0,0,0.5)', 2.4);
    seam(X(ox, 0.5) - 2, Y(oy, 0.1), X(ox, 0.5) - 2, Y(oy, 1), 0.5);
    // Drawcord eyelets at the neck.
    for (const u of [0.03, 0.09]) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(X(ox, u), Y(oy, 0.08), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    creases(ox, oy, 0.55, 0.9, 8, 0.1);
  });

  // 20 fleece sleeve.
  P.cell(20, 246, 1, (ox, oy) => {
    speckle(ox, oy, S, 2600, 0.07);
    for (let k = 0; k < 24; k++)
      blob(ox + rng.range(0, S), oy + rng.range(0, S), rng.range(8, 18), 'rgba(0,0,0,0.045)');
    seam(X(ox, 1) - 4, Y(oy, 0), X(ox, 1) - 4, Y(oy, 1), 0.5);
    seam(ox + 4, Y(oy, 0.06), ox + S - 4, Y(oy, 0.06), 0.6);
    for (let k = 0; k < 8; k++) {
      const y = Y(oy, 0.38 + k * 0.03);
      crease(ox, y, ox + S, y + rng.range(-5, 5), 0.12, 5);
    }
  });

  // 21 jacket: ripstop shell, the front zip with its storm flap, chest and hand pockets, yoke and side seams.
  P.cell(21, 248, 1, (ox, oy) => {
    ripstop(ox, oy);
    zip(ox + 8, Y(oy, 0), Y(oy, 0.86));
    line(ox + 22, Y(oy, 0.02), ox + 22, Y(oy, 0.86), 'rgba(0,0,0,0.35)', 2);
    // Chest pocket, zipped, on the wearer's left and right (u mirrored) high on the chest.
    line(X(ox, 0.22), Y(oy, 0.16), X(ox, 0.38), Y(oy, 0.14), 'rgba(0,0,0,0.65)', 2.6);
    line(X(ox, 0.22), Y(oy, 0.16) + 3, X(ox, 0.38), Y(oy, 0.14) + 3, 'rgba(255,255,255,0.4)', 1, [3, 3]);
    // Slanted hand pockets.
    line(X(ox, 0.3), Y(oy, 0.5), X(ox, 0.42), Y(oy, 0.66), 'rgba(0,0,0,0.65)', 2.6);
    line(X(ox, 0.3) + 3, Y(oy, 0.5), X(ox, 0.42) + 3, Y(oy, 0.66), 'rgba(255,255,255,0.4)', 1, [3, 3]);
    seam(X(ox, 0.5) - 2, Y(oy, 0.12), X(ox, 0.5) - 2, Y(oy, 1), 0.7);
    seam(ox, Y(oy, 0.13), ox + S, Y(oy, 0.13), 0.5);
    seam(X(ox, 0.78), Y(oy, 0.13), X(ox, 0.78), Y(oy, 1), 0.5);
    creases(ox, oy, 0.55, 0.85, 9, 0.12);
  });

  // 22 jacket sleeve: ripstop, an underarm seam, elbow creases, a cuff tab.
  P.cell(22, 248, 1, (ox, oy) => {
    ripstop(ox, oy);
    seam(X(ox, 1) - 4, Y(oy, 0), X(ox, 1) - 4, Y(oy, 1), 0.6);
    seam(X(ox, 0.45), Y(oy, 0.1), X(ox, 0.45), Y(oy, 1), 0.4);
    for (let k = 0; k < 9; k++) {
      const y = Y(oy, 0.38 + k * 0.03);
      crease(ox, y, ox + S, y + rng.range(-5, 5), 0.14, 5);
    }
    patch(X(ox, 0.1), Y(oy, 0.8), S * 0.34, S * 0.07, 0.4);
  });

  // 23 coverall (cotton drill): twill, the front zip, two flap pockets on the chest, a back yoke, the waist seam.
  P.cell(23, 246, 1, (ox, oy) => {
    twill(ox, oy, 0.1, 3);
    zip(ox + 8, Y(oy, 0), Y(oy, 0.9));
    line(ox + 22, Y(oy, 0.02), ox + 22, Y(oy, 0.9), 'rgba(0,0,0,0.3)', 2);
    patch(X(ox, 0.13), Y(oy, 0.14), S * 0.2, S * 0.12, 0.55);
    line(X(ox, 0.13), Y(oy, 0.19), X(ox, 0.33), Y(oy, 0.19), 'rgba(0,0,0,0.6)', 2.4);
    button(X(ox, 0.23), Y(oy, 0.2));
    // A pen pocket and a utility pocket at the hip.
    patch(X(ox, 0.34), Y(oy, 0.44), S * 0.16, S * 0.12, 0.45);
    seam(X(ox, 0.5) - 2, Y(oy, 0.1), X(ox, 0.5) - 2, Y(oy, 1), 0.6);
    seam(X(ox, 0.7), Y(oy, 0.14), X(ox, 1), Y(oy, 0.14), 0.5);
    seam(ox, Y(oy, 0.69), ox + S, Y(oy, 0.69), 0.4);
    // Belt loops.
    for (const u of [0.18, 0.5, 0.82]) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(X(ox, u) - 3, Y(oy, 0.66), 6, S * 0.07);
    }
    creases(ox, oy, 0.55, 0.95, 9, 0.12);
  });

  // 24 coverall sleeve: twill, a pen pocket on the upper arm, an elbow patch seam, the underarm seam.
  P.cell(24, 246, 1, (ox, oy) => {
    twill(ox, oy, 0.1, 3);
    seam(X(ox, 1) - 4, Y(oy, 0), X(ox, 1) - 4, Y(oy, 1), 0.6);
    patch(X(ox, 0.04), Y(oy, 0.16), S * 0.12, S * 0.2, 0.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(ox + S * 0.5, Y(oy, 0.5), S * 0.5, S * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 7; k++) {
      const y = Y(oy, 0.4 + k * 0.035);
      crease(ox, y, ox + S, y + rng.range(-5, 5), 0.13, 5);
    }
  });

  // 25 coverall leg: twill, a hip pocket, a thigh pocket with a flap on the side, a knee seam, side seams.
  P.cell(25, 246, 1, (ox, oy) => {
    twill(ox, oy, 0.1, 3);
    seam(X(ox, 0.5) - 2, Y(oy, 0), X(ox, 0.5) - 2, Y(oy, 1), 0.7);
    patch(X(ox, 0.36), Y(oy, 0.26), S * 0.16, S * 0.2, 0.55);
    line(X(ox, 0.36), Y(oy, 0.31), X(ox, 0.52), Y(oy, 0.31), 'rgba(0,0,0,0.6)', 2.4);
    seam(X(ox, 0.7), Y(oy, 0.04), X(ox, 1), Y(oy, 0.04), 0.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(ox, Y(oy, 0.52), S * 0.34, S * 0.08, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    for (let k = 0; k < 8; k++)
      crease(X(ox, 0.1), Y(oy, 0.46 + k * 0.025), X(ox, 0.5), Y(oy, 0.46 + k * 0.025) + 4, 0.13, 5);
    for (let k = 0; k < 6; k++)
      crease(X(ox, 0.1), Y(oy, 0.82 + k * 0.025), X(ox, 0.9), Y(oy, 0.82 + k * 0.025) + 4, 0.1, 5);
  });

  // 26 hi-vis vest: perforated mesh, the front strip, a seam down each side.
  P.cell(26, 250, 1, (ox, oy) => {
    for (let y = 1; y < S; y += 3)
      for (let x = (y / 3) % 2 ? 1 : 0; x < S; x += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.09)';
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox + 1, oy, 24, S);
    zip(ox + 8, Y(oy, 0), Y(oy, 0.88));
    seam(X(ox, 0.5) - 2, Y(oy, 0.05), X(ox, 0.5) - 2, Y(oy, 1), 0.6);
    creases(ox, oy, 0.4, 0.8, 7, 0.1);
  });

  // 27 denim: diagonal twill, the stitched side seams, back pockets, whiskers at the hip, knee creases.
  P.cell(27, 240, 1, (ox, oy) => {
    twill(ox, oy, 0.15, 3);
    blob(X(ox, 0.2), Y(oy, 0.12), 60, 'rgba(255,255,255,0.2)', 1.4, 1);
    blob(X(ox, 0.15), Y(oy, 0.5), 40, 'rgba(255,255,255,0.16)', 1.6, 0.7);
    // Waistband with belt loops, front pocket scoop, back pockets.
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(ox, Y(oy, 0), S, S * 0.05);
    line(ox, Y(oy, 0.05), ox + S, Y(oy, 0.05), 'rgba(255,225,150,0.7)', 1.4, [4, 3]);
    for (const u of [0.22, 0.6]) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(X(ox, u) - 3, Y(oy, 0), 6, S * 0.07);
    }
    ctx.strokeStyle = 'rgba(255,225,150,0.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(X(ox, 0.34), Y(oy, 0.04), S * 0.15, 0.3, 1.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,225,150,0.6)';
    ctx.beginPath();
    ctx.moveTo(X(ox, 0.72), Y(oy, 0.07));
    ctx.lineTo(X(ox, 0.9), Y(oy, 0.07));
    ctx.lineTo(X(ox, 0.82), Y(oy, 0.16));
    ctx.lineTo(X(ox, 0.72), Y(oy, 0.07));
    ctx.stroke();
    seam(X(ox, 0.5) - 2, Y(oy, 0.05), X(ox, 0.5) - 2, Y(oy, 0.95), 1.2);
    for (let k = 0; k < 12; k++) {
      const x = X(ox, rng.range(0.05, 0.4));
      line(x, Y(oy, 0.1), x + rng.range(-24, 24), Y(oy, rng.range(0.2, 0.3)), 'rgba(255,255,255,0.2)', 2);
    }
    for (let k = 0; k < 7; k++)
      crease(X(ox, 0.1), Y(oy, 0.47 + k * 0.025), X(ox, 0.9), Y(oy, 0.47 + k * 0.025) + 6, 0.16, 4);
    for (let k = 0; k < 6; k++)
      crease(X(ox, 0.1), Y(oy, 0.82 + k * 0.02), X(ox, 0.9), Y(oy, 0.82 + k * 0.02) + 3, 0.13, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(ox, Y(oy, 0.93), S, S * 0.07);
    line(ox, Y(oy, 0.93), ox + S, Y(oy, 0.93), 'rgba(255,225,150,0.7)', 1.5, [5, 3]);
  });

  // 28 twill (chinos, suit trousers): fine weave, the front crease, side seams, knee creases.
  P.cell(28, 248, 1, (ox, oy) => {
    twill(ox, oy, 0.06, 2);
    line(ox + 6, Y(oy, 0.02), ox + 6, Y(oy, 0.93), 'rgba(0,0,0,0.16)', 3);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox, Y(oy, 0), S, S * 0.04);
    seam(X(ox, 0.5) - 2, Y(oy, 0.04), X(ox, 0.5) - 2, Y(oy, 0.96), 0.7);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X(ox, 0.36), Y(oy, 0.03), S * 0.14, 0.3, 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeRect(X(ox, 0.72), Y(oy, 0.08), S * 0.18, 4);
    for (let k = 0; k < 7; k++)
      crease(X(ox, 0.1), Y(oy, 0.47 + k * 0.025), X(ox, 0.9), Y(oy, 0.47 + k * 0.025) + 5, 0.12, 5);
    speckle(ox, oy, S, 400, 0.04);
  });

  // 29 cargo: coarse twill, big bellows pockets at the side of the thigh, a lower pocket, side seams.
  P.cell(29, 244, 1, (ox, oy) => {
    twill(ox, oy, 0.11, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox, Y(oy, 0), S, S * 0.04);
    seam(X(ox, 0.5) - 2, Y(oy, 0.04), X(ox, 0.5) - 2, Y(oy, 0.96), 0.7);
    patch(X(ox, 0.36), Y(oy, 0.22), S * 0.3, S * 0.22, 0.6);
    line(X(ox, 0.36), Y(oy, 0.27), X(ox, 0.66), Y(oy, 0.27), 'rgba(0,0,0,0.6)', 2.6);
    button(X(ox, 0.5), Y(oy, 0.3), 3.6);
    patch(X(ox, 0.4), Y(oy, 0.5), S * 0.2, S * 0.14, 0.4);
    for (let k = 0; k < 7; k++)
      crease(X(ox, 0.1), Y(oy, 0.7 + k * 0.025), X(ox, 0.9), Y(oy, 0.7 + k * 0.025) + 5, 0.12, 5);
  });

  // 30 pleats: knife pleats round the skirt (u runs round it), a waistband seam, a faint sheen.
  P.cell(30, 242, 1, (ox, oy) => {
    const n = 16;
    for (let k = 0; k < n; k++) {
      const x0 = X(ox, k / n);
      const g = ctx.createLinearGradient(x0, 0, x0 + (S * 0.96) / n, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.92, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(255,255,255,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, oy, (S * 0.96) / n, S);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(ox, oy, S, S * 0.07);
    line(ox, oy + S * 0.07, ox + S, oy + S * 0.07, 'rgba(0,0,0,0.5)', 1.6);
    const g = ctx.createLinearGradient(0, oy, 0, oy + S);
    g.addColorStop(0, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, S, S);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox, oy + S * 0.94, S, S * 0.06);
  });

  // 31 plaid: a tartan of broad and thin bars in both directions with a twill underneath, pleat shading.
  P.cell(31, 238, 1, (ox, oy) => {
    twill(ox, oy, 0.08, 3);
    const bars: [number, number, number][] = [
      [0.0, 0.22, 0.2],
      [0.3, 0.04, 0.34],
      [0.4, 0.04, 0.34],
      [0.5, 0.22, 0.2],
      [0.8, 0.04, 0.34],
      [0.9, 0.04, 0.34],
    ];
    for (const [p, wd, a] of bars) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      for (let rep = 0; rep < 2; rep++) {
        ctx.fillRect(ox + (p / 2 + rep / 2) * S, oy, wd * S * 0.5, S);
        ctx.fillRect(ox, oy + (p / 2 + rep / 2) * S, S, wd * S * 0.5);
      }
    }
    const n = 12;
    for (let k = 0; k < n; k++) {
      const x0 = X(ox, k / n);
      const g = ctx.createLinearGradient(x0, 0, x0 + (S * 0.96) / n, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, oy, (S * 0.96) / n, S);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(ox, oy, S, S * 0.06);
  });
}
