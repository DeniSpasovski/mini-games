/**
 * HUD dynamite icons as inline SVG strings (DOM-free, so the HUD tests run in node): a single stick for the TNT stock,
 * and a bundle of 1-5 sticks for the blast level - the more sticks, the bigger the blast. Levels 4 and 5 (blasts that
 * turn corners, `walkBlast`) get little flames either side.
 */

const RED = '#d8362f';
const SHADE = '#a5241f';
const CREAM = '#f4dcae';
const INK = '#2b1d17';
const SPARK = '#ffc247';

/** One stick standing at `x` (left), its top at `y`, `h` tall, 7 wide: paper wrap, printed rings, crimped cap. */
function stick(x: number, y: number, h: number): string {
  const w = 7;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${RED}" stroke="${INK}" stroke-width="1"/>` +
    `<rect x="${x + w - 2.2}" y="${y + 1}" width="1.6" height="${h - 2}" fill="${SHADE}"/>` +
    `<rect x="${x + 0.5}" y="${y + 2.5}" width="${w - 1}" height="1.6" fill="${CREAM}"/>` +
    `<rect x="${x + 0.5}" y="${y + h - 4}" width="${w - 1}" height="1.6" fill="${CREAM}"/>` +
    `<ellipse cx="${x + w / 2}" cy="${y + 0.6}" rx="${w / 2 - 0.4}" ry="1.4" fill="${CREAM}" stroke="${INK}" stroke-width="0.8"/>`
  );
}

/** The fuse from (`x`, `y`) curling up and right, with a spark when `lit`. */
function fuse(x: number, y: number, lit: boolean): string {
  return (
    `<path d="M${x} ${y} q0 -4 3 -6" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>` +
    (lit
      ? `<circle cx="${x + 3}" cy="${y - 6}" r="2.1" fill="${SPARK}" stroke="#fff3c4" stroke-width="0.8"/>`
      : '')
  );
}

/** One dynamite stick (the TNT stock: one per TNT you can hold). `lit` = ready to drop. */
export function stickIcon(lit: boolean): string {
  return (
    `<svg viewBox="0 0 12 30" width="14" height="34" aria-hidden="true" class="kb-ico${lit ? '' : ' spent'}">` +
    stick(2.5, 9, 20) +
    fuse(6, 9, lit) +
    `</svg>`
  );
}

/** A bundle of `level` sticks (1-5) tied with a band: the blast level. 4 and 5 burn round corners: flames either side. */
export function bundleIcon(level: number): string {
  const n = Math.max(1, Math.min(5, Math.round(level)));
  const step = 6;
  const flames = n >= 4 ? 7 : 0;
  const w = flames * 2 + 7 + step * (n - 1) + 2;
  const mid = (n - 1) / 2;
  let body = '';
  // back row first, the middle stick in front and tallest
  const order = [...Array(n).keys()].sort(
    (a, b) => Math.abs(b - mid) - Math.abs(a - mid),
  );
  for (const k of order) {
    const lift = (mid - Math.abs(k - mid)) * 1.2;
    body += stick(flames + 1 + k * step, 10 - lift, 19 + lift);
  }
  const bandX = flames + 0.5;
  const bandW = 7 + step * (n - 1) + 1;
  body += `<rect x="${bandX}" y="17" width="${bandW}" height="5" rx="1.5" fill="${CREAM}" stroke="${INK}" stroke-width="1"/>`;
  body += fuse(flames + 1 + mid * step + 3.5, 10 - mid * 1.2, true);
  let fire = '';
  if (flames) {
    const flame = (x: number, flip: number) =>
      `<path d="M${x} 28 c${-3 * flip} -3 ${-2 * flip} -7 0 -10 c0 3 ${2.5 * flip} 3 ${2 * flip} 6 c${1.5 * flip} -1 ${1.5 * flip} -3 ${1 * flip} -4 c${2.5 * flip} 3 ${1.5 * flip} 7 ${-3 * flip} 8 z" fill="#ff8a1c" stroke="#c4410f" stroke-width="0.8"/>`;
    fire = flame(5, 1) + flame(w - 5, -1);
    if (n === 5) fire += flame(3, 1) + flame(w - 3, -1);
  }
  return (
    `<svg viewBox="0 0 ${w} 30" height="34" width="${(w * 34) / 30}" aria-hidden="true" class="kb-ico">` +
    fire +
    body +
    `</svg>`
  );
}
