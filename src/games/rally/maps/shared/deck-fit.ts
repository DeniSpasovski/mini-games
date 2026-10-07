import type { PathDef } from './types';

/**
 * Street decks that stop over the road they cross (OSM `bridge=yes` ways are often shorter than the structure: the way ends
 * at the abutment's edge, while the road beneath is wider than the span). The deck end then lies right above that road:
 * the way it continues into starts at the deck height 5 m over the ground road under its first metres, and the profile
 * passes pull it down to that road (a 70 % grade in 4 m).
 *
 * `extendDecks` finds those ends - a ground road that is not joined to the deck end but passes under the first metres of
 * the way beyond it - and turns that way's first stretch into deck, to `EXTRA` m past the road beneath. Pure (no scene).
 */

/** The deck runs this far past the outer edge of the road it crosses (abutment + approach start, m). */
export const EXTRA = 9;
/** Only a road under the first `START` m of the way counts (a road crossing further out is an ordinary crossing). */
const START = 9;
/** Longest extension (m). */
const MAX_EXTEND = 55;
/** Joined roads: an end within this distance of the deck end (m). */
const JOINT = 3;
/** A road runs along the way rather than crossing it above this |cos|. */
const PARALLEL = 0.93;
/** Longest chain of ways followed beyond a deck end (m). */
const CHAIN = 60;
/** Sample step along the way (m). */
const STEP = 1;

export interface DeckExtension {
  /** Index of the deck that was extended (the path list's index). */
  deck: number;
  /** Index of the way that continues it (its first stretch became deck, the rest keeps its index). */
  way: number;
  /** Which end of the deck. */
  atEnd: boolean;
  /** Metres of deck added. */
  by: number;
}

interface Pt {
  x: number;
  z: number;
}

const len = (pts: number[]): number => {
  let l = 0;
  for (let k = 0; k + 3 < pts.length; k += 2)
    l += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return l;
};

/** Point and unit direction at `a` metres along a flat polyline. */
function at(pts: number[], a: number): [number, number, number, number] {
  let along = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const dx = pts[k + 2] - pts[k];
    const dz = pts[k + 3] - pts[k + 1];
    const L = Math.hypot(dx, dz);
    if (a <= along + L || k + 5 >= pts.length) {
      const t = L > 0 ? Math.min(1, Math.max(0, (a - along) / L)) : 0;
      return [
        pts[k] + dx * t,
        pts[k + 1] + dz * t,
        dx / (L || 1),
        dz / (L || 1),
      ];
    }
    along += L;
  }
  const n = pts.length;
  return [pts[n - 2], pts[n - 1], 1, 0];
}

/** Closest point of a polyline to (x, z): distance and the unit direction of the polyline there. */
function nearest(
  pts: number[],
  x: number,
  z: number,
): { d: number; tx: number; tz: number } {
  let best = Infinity;
  let tx = 1;
  let tz = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k];
    const az = pts[k + 1];
    const ex = pts[k + 2] - ax;
    const ez = pts[k + 3] - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
    if (d < best) {
      best = d;
      const l = Math.sqrt(l2);
      tx = ex / l;
      tz = ez / l;
    }
  }
  return { d: best, tx, tz };
}

/** Cut a polyline at `a` metres: [0, a] and [a, end] share the cut point. */
function cut(pts: number[], a: number): [number[], number[]] {
  const first: number[] = [];
  let along = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const dx = pts[k + 2] - pts[k];
    const dz = pts[k + 3] - pts[k + 1];
    const L = Math.hypot(dx, dz);
    if (first.length === 0) first.push(pts[k], pts[k + 1]);
    if (along + L >= a) {
      const t = L > 0 ? (a - along) / L : 0;
      const cx = pts[k] + dx * t;
      const cz = pts[k + 1] + dz * t;
      first.push(cx, cz);
      return [first, [cx, cz, ...pts.slice(k + 2)]];
    }
    first.push(pts[k + 2], pts[k + 3]);
    along += L;
  }
  return [first, pts.slice(-2)];
}

const reversed = (pts: number[]): number[] => {
  const out: number[] = [];
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
  return out;
};

/** (x, z) inside the polygon `poly` ([x0, z0, x1, z1, ...]). */
function inPolygon(poly: number[], x: number, z: number): boolean {
  let c = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const zi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const zj = poly[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      c = !c;
  }
  return c;
}

/** Pieces of a deck / ground split shorter than this are merged into their neighbour (m). */
const MIN_PIECE = 1.5;

/**
 * A measured bridge structure (a city survey's outline, e.g. the NYC Planimetric Database transportation structures):
 * every street / ramp inside it is deck, split where it crosses the outline; the roads passing beneath (`under`) stay
 * ground. A way keeps its index with its first piece, the other pieces are appended. Pure (no scene).
 */
export function decksInOutline(
  list: PathDef[],
  outline: number[],
  under: (p: PathDef) => boolean,
  layer = 1,
): PathDef[] {
  const paths = list.map((p) => ({ ...p }));
  const added: PathDef[] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < outline.length; k += 2) {
    x0 = Math.min(x0, outline[k]);
    x1 = Math.max(x1, outline[k]);
    z0 = Math.min(z0, outline[k + 1]);
    z1 = Math.max(z1, outline[k + 1]);
  }
  paths.forEach((p, pi) => {
    if (p.surface !== 'tarmac' || under(p) || p.pts.length < 4) return;
    // The way's box overlaps the outline's (a long segment may cross it with both nodes outside).
    let px0 = Infinity;
    let px1 = -Infinity;
    let pz0 = Infinity;
    let pz1 = -Infinity;
    for (let k = 0; k + 1 < p.pts.length; k += 2) {
      px0 = Math.min(px0, p.pts[k]);
      px1 = Math.max(px1, p.pts[k]);
      pz0 = Math.min(pz0, p.pts[k + 1]);
      pz1 = Math.max(pz1, p.pts[k + 1]);
    }
    if (px1 < x0 - 1 || px0 > x1 + 1 || pz1 < z0 - 1 || pz0 > z1 + 1) return;
    // Cut points: where a segment crosses an edge of the outline (metres along the way).
    const L = len(p.pts);
    const cuts: number[] = [];
    let along = 0;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ax = p.pts[k];
      const az = p.pts[k + 1];
      const dx = p.pts[k + 2] - ax;
      const dz = p.pts[k + 3] - az;
      const sl = Math.hypot(dx, dz);
      const n = outline.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const bx = outline[j * 2];
        const bz = outline[j * 2 + 1];
        const ex = outline[i * 2] - bx;
        const ez = outline[i * 2 + 1] - bz;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((bx - ax) * ez - (bz - az) * ex) / den;
        const u = ((bx - ax) * dz - (bz - az) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(along + t * sl);
      }
      along += sl;
    }
    cuts.sort((a, b) => a - b);
    const bounds = [0, ...cuts.filter((c) => c > 0 && c < L), L];
    // Pieces with their side (a midpoint test), the short ones merged into the piece before.
    const pieces: { from: number; to: number; inside: boolean }[] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const [mx, mz] = at(p.pts, (bounds[i] + bounds[i + 1]) / 2);
      const inside = inPolygon(outline, mx, mz);
      const last = pieces[pieces.length - 1];
      if (
        last &&
        (last.inside === inside || bounds[i + 1] - bounds[i] < MIN_PIECE)
      )
        last.to = bounds[i + 1];
      else pieces.push({ from: bounds[i], to: bounds[i + 1], inside });
    }
    if (pieces.length > 1 && pieces[0].to - pieces[0].from < MIN_PIECE) {
      pieces[1].from = 0;
      pieces.shift();
    }
    const deck = (q: PathDef): PathDef => ({
      ...q,
      bridge: true,
      layer: Math.max(q.layer ?? 0, layer),
    });
    if (pieces.length === 1) {
      if (pieces[0].inside) paths[pi] = deck(p);
      return;
    }
    let rest = p.pts;
    let done = 0;
    pieces.forEach((pc, k) => {
      let part = rest;
      if (k < pieces.length - 1) {
        const [a, b] = cut(rest, pc.to - done);
        part = a;
        rest = b;
        done = pc.to;
      }
      const piece = { ...p, pts: part };
      if (k === 0) paths[pi] = pc.inside ? deck(piece) : piece;
      else added.push(pc.inside ? deck(piece) : piece);
    });
  });
  return [...paths, ...added];
}

const isStreetDeck = (p: PathDef): boolean =>
  !!p.bridge &&
  p.surface === 'tarmac' &&
  !/^(motorway|trunk)$/.test(p.kind) &&
  p.layer !== undefined &&
  p.layer > 0;

/**
 * Lengthens the street decks in `list` where a road passes under the start of the way they continue into. Returns the
 * new list (the extended deck's way keeps its index with the rest of its length; the deck pieces are appended) and what
 * was done. Only decks whose continuation is a ground way of the same kind of street; `maxX` / `minX` limit the area.
 */
export function extendDecks(
  list: PathDef[],
  area?: {
    minX?: number;
    maxX?: number;
    /** Decks whose end is here are left alone (approved structures). */
    skip?: (x: number, z: number) => boolean;
  },
): { paths: PathDef[]; extended: DeckExtension[] } {
  const paths = list.map((p) => ({ ...p }));
  const extended: DeckExtension[] = [];
  const added: PathDef[] = [];
  const used = new Set<number>();
  const box = paths.map((p) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k + 1 < p.pts.length; k += 2) {
      x0 = Math.min(x0, p.pts[k]);
      x1 = Math.max(x1, p.pts[k]);
      z0 = Math.min(z0, p.pts[k + 1]);
      z1 = Math.max(z1, p.pts[k + 1]);
    }
    return { x0, x1, z0, z1 };
  });

  paths.forEach((deck, di) => {
    if (!isStreetDeck(deck)) return;
    for (const atEnd of [false, true]) {
      const n = deck.pts.length;
      const E: Pt = {
        x: atEnd ? deck.pts[n - 2] : deck.pts[0],
        z: atEnd ? deck.pts[n - 1] : deck.pts[1],
      };
      if (
        (area?.minX !== undefined && E.x < area.minX) ||
        (area?.maxX !== undefined && E.x > area.maxX) ||
        area?.skip?.(E.x, E.z)
      )
        continue;
      // The deck's direction leaving its end.
      const dirx = atEnd
        ? deck.pts[n - 2] - deck.pts[n - 4]
        : deck.pts[0] - deck.pts[2];
      const dirz = atEnd
        ? deck.pts[n - 1] - deck.pts[n - 3]
        : deck.pts[1] - deck.pts[3];
      const dl = Math.hypot(dirx, dirz) || 1;
      // The ways continuing it: a ground way with an end at E (straightest on), then the way after it ... up to CHAIN m
      // (OSM leaves short connectors of a few metres between a bridge end and the next junction).
      interface Link {
        wi: number;
        fromEnd: boolean;
        pts: number[];
        len: number;
      }
      const chain: Link[] = [];
      let endX = E.x;
      let endZ = E.z;
      let hx = dirx / dl;
      let hz = dirz / dl;
      const taken = new Set<number>();
      for (let guard = 0; guard < 6; guard++) {
        let best: { wi: number; fromEnd: boolean; dot: number } | undefined;
        paths.forEach((w, wi) => {
          if (
            wi === di ||
            used.has(wi) ||
            taken.has(wi) ||
            w.bridge ||
            w.surface !== 'tarmac' ||
            w.pts.length < 4
          )
            return;
          for (const fromEnd of [false, true]) {
            const k = w.pts.length;
            const ex = fromEnd ? w.pts[k - 2] : w.pts[0];
            const ez = fromEnd ? w.pts[k - 1] : w.pts[1];
            if (Math.hypot(ex - endX, ez - endZ) > JOINT) continue;
            const ox = (fromEnd ? w.pts[k - 4] : w.pts[2]) - ex;
            const oz = (fromEnd ? w.pts[k - 3] : w.pts[3]) - ez;
            const ol = Math.hypot(ox, oz) || 1;
            const dot = (ox * hx + oz * hz) / ol;
            if (dot > 0.5 && (!best || dot > best.dot))
              best = { wi, fromEnd, dot };
          }
        });
        if (!best) break;
        const w = paths[best.wi];
        const line = best.fromEnd ? reversed(w.pts) : w.pts;
        const l = len(line);
        chain.push({ wi: best.wi, fromEnd: best.fromEnd, pts: line, len: l });
        taken.add(best.wi);
        const m = line.length;
        endX = line[m - 2];
        endZ = line[m - 1];
        const ddx = line[m - 2] - line[m - 4];
        const ddz = line[m - 1] - line[m - 3];
        const dd = Math.hypot(ddx, ddz) || 1;
        hx = ddx / dd;
        hz = ddz / dd;
        if (chain.reduce((a, c) => a + c.len, 0) >= CHAIN) break;
      }
      if (!chain.length) continue;
      const way = paths[chain[0].wi];
      // One polyline of the chain, from the deck end on.
      const line: number[] = [...chain[0].pts];
      for (const c of chain.slice(1)) line.push(...c.pts.slice(2));
      const wl = len(line);
      if (wl < 6) continue;
      // What passes under its first metres: another road (not joined at E or at the way's far end), crossing it.
      let cover = -1;
      for (let s = 0; s <= Math.min(START + 40, wl); s += STEP) {
        const [px, pz, tx, tz] = at(line, s);
        let under = false;
        for (let oi = 0; oi < paths.length; oi++) {
          if (oi === di || taken.has(oi)) continue;
          const o = paths[oi];
          if (o.surface !== 'tarmac' || o.pts.length < 4) continue;
          // Decks of its own level or higher are not beneath.
          if (o.bridge && (o.layer ?? 1) >= (deck.layer ?? 1)) continue;
          const b = box[oi];
          const reach = o.width / 2 + way.width / 2 + 1;
          if (
            px < b.x0 - reach ||
            px > b.x1 + reach ||
            pz < b.z0 - reach ||
            pz > b.z1 + reach
          )
            continue;
          // Joined at the deck end (a street meeting the bridge end, not passing under it).
          const k = o.pts.length;
          const joined = [
            [o.pts[0], o.pts[1]],
            [o.pts[k - 2], o.pts[k - 1]],
          ].some(([qx, qz]) => Math.hypot(qx - E.x, qz - E.z) <= JOINT);
          if (joined) continue;
          const q = nearest(o.pts, px, pz);
          if (q.d > o.width / 2 + way.width / 2) continue;
          if (Math.abs(q.tx * tx + q.tz * tz) > PARALLEL) continue;
          under = true;
          break;
        }
        if (under) cover = s;
        // Nothing beneath the first metres: no deck needed; after the first cover, stop at the first gap.
        else if (cover < 0 && s > START) break;
        else if (cover >= 0) break;
      }
      if (cover < 0) continue;
      const by = Math.min(MAX_EXTEND, cover + EXTRA, wl * 0.8);
      if (by < 4) continue;
      // Walk the chain: whole ways inside `by` become deck in place, the way it ends in is split (deck piece appended).
      let done = 0;
      for (const c of chain) {
        const w = paths[c.wi];
        used.add(c.wi);
        if (done + c.len <= by + 0.5) {
          paths[c.wi] = { ...w, bridge: true, layer: deck.layer };
          done += c.len;
          continue;
        }
        if (by - done >= 3) {
          const [deckPart, rest] = cut(c.pts, by - done);
          paths[c.wi] = { ...w, pts: c.fromEnd ? reversed(rest) : rest };
          added.push({
            ...w,
            bridge: true,
            layer: deck.layer,
            pts: c.fromEnd ? reversed(deckPart) : deckPart,
          });
        }
        break;
      }
      extended.push({ deck: di, way: chain[0].wi, atEnd, by });
    }
  });
  return { paths: [...paths, ...added], extended };
}
