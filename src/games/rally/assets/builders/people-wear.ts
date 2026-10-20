import { type BufferGeometry } from 'three';
import type { Outfit } from './people';
import { RIGS } from './people-body';
import { hairOf, hatOf } from './people-hair';
import { shoesOf } from './people-shoes';
import type { LegKind, Pattern, ShoeKind, TopKind } from './people-looks';
import {
  F_CARGO,
  F_COVERALL,
  F_COVERALL_LEG,
  F_COVERALL_SLEEVE,
  F_DENIM,
  F_FLEECE,
  F_FLEECE_SLEEVE,
  F_JACKET,
  F_JACKET_SLEEVE,
  F_JERSEY,
  F_JERSEY_SLEEVE,
  F_PLAID,
  F_PLEAT,
  F_POLO,
  F_TWILL,
  F_VEST,
  GLOVE,
  LEATHER,
  REFLECT,
} from './people-parts';
import type { Surf } from './people-surf';
import {
  alongOf,
  gloves,
  legs,
  painted,
  between,
  skirt,
  splitIn,
  top,
  type Cloth,
  type Cut,
  type Field,
  type LegOpts,
  type Piece,
  type Tailor,
  type TopOpts,
} from './people-tailor';

/** What a figure wears: pieces cut from its body (painted), the fields that hide the body under them, rigid extras. */
export interface Wardrobe {
  cloth: Surf[];
  /** Skirts: posed apart from the rest, then kept clear of the legs. */
  skirts: Surf[];
  /** Hair and hats: on the head bone. */
  hair: Surf[];
  /** Shoes: on the foot bones. */
  shoes: Surf[];
  /** Per base vertex, >= 0 where a garment covers the body (metres inside its edge). */
  covers: Float32Array[];
  rigid: BufferGeometry[];
}

const SILVER = '#cfd2d6';
const DARK = '#26282c';

/** Boots for work wear, flats for skirts, sneakers otherwise. */
function defaultShoe(o: Outfit): ShoeKind {
  if (o.topKind === 'overall' || o.legKind === 'overall') return 'boot';
  if (o.legKind === 'skirt' || o.legKind === 'pleat' || o.legKind === 'plaid')
    return 'flat';
  return 'sneaker';
}

/** The leg garment of a kind (skirts and overalls are built elsewhere). */
function legSpec(kind: LegKind, o: Outfit, waist: number): LegOpts | undefined {
  const spec = legSpec0(kind, o, waist);
  // The hem stops above the shoe's collar.
  return spec && { ...spec, hem: spec.hem + SHOE_CLEAR };
}

const SHOE_CLEAR = 0.035;
/** Height (m) above the floor where bare legs begin (the collar of the lowest shoe ends here). */
const SHOE_TOP = 0.086;

function legSpec0(
  kind: LegKind,
  o: Outfit,
  waist: number,
): LegOpts | undefined {
  const base = { color: o.legs, waist, seed: 1, trim: o.legs };
  switch (kind) {
    case 'jeans':
      return {
        ...base,
        hem: 0.05,
        fit: 0.016,
        flare: 0.012,
        bag: 0.006,
        soft: 4,
        cell: F_DENIM,
        band: 0.035,
      };
    case 'slim':
      return {
        ...base,
        hem: 0.06,
        fit: 0.008,
        flare: 0.003,
        soft: 3,
        cell: F_TWILL,
        band: 0.03,
      };
    case 'chino':
      return {
        ...base,
        hem: 0.05,
        fit: 0.013,
        flare: 0.012,
        bag: 0.004,
        soft: 4,
        cell: F_TWILL,
        band: 0.03,
      };
    case 'cargo':
      return {
        ...base,
        hem: 0.05,
        fit: 0.022,
        flare: 0.016,
        bag: 0.01,
        soft: 5,
        fold: 0.004,
        cell: F_CARGO,
        band: 0.035,
      };
    case 'jogger':
      return {
        ...base,
        hem: 0.08,
        fit: 0.014,
        flare: -0.004,
        soft: 4,
        cell: F_JERSEY,
        cuff: 0.045,
        band: 0.04,
      };
    case 'leggings':
      return {
        ...base,
        hem: 0.06,
        fit: 0.003,
        flare: 0,
        soft: 1,
        fold: 0.001,
        cell: F_JERSEY,
        band: 0.04,
      };
    case 'shorts':
      return {
        ...base,
        hem: o.hem ?? 0.6,
        fit: 0.02,
        flare: 0.022,
        soft: 4,
        cell: F_TWILL,
        band: 0.03,
        cuff: 0.02,
      };
    case 'bermuda':
      return {
        ...base,
        hem: o.hem ?? 0.43,
        fit: 0.02,
        flare: 0.022,
        soft: 4,
        cell: F_TWILL,
        band: 0.03,
        cuff: 0.02,
      };
    case 'capri':
      return {
        ...base,
        hem: o.hem ?? 0.28,
        fit: 0.01,
        flare: 0.006,
        soft: 3,
        cell: F_TWILL,
        band: 0.03,
      };
    default:
      return undefined;
  }
}

/** The top of a kind. */
function topSpec(kind: TopKind, o: Outfit): TopOpts {
  const common = {
    color: o.torso,
    trim: o.collar ?? o.torso,
    seed: 2,
    cell: F_JERSEY,
    sleeveCell: F_JERSEY_SLEEVE,
  };
  switch (kind) {
    case 'long':
      return {
        ...common,
        sleeve: 9,
        neck: 'crew',
        hem: 0.88,
        fit: 0.024,
        ease: 0.01,
        collar: 0.022,
        cuff: 0.025,
      };
    case 'polo':
      return {
        ...common,
        sleeve: 0.21,
        neck: 'v',
        neckDrop: -0.09,
        hem: 0.88,
        fit: 0.022,
        ease: 0.01,
        cell: F_POLO,
        collar: 0.03,
      };
    case 'hoodie':
      return {
        ...common,
        sleeve: 9,
        neck: 'high',
        hem: 0.84,
        fit: 0.034,
        ease: 0.022,
        loose: 0.01,
        soft: 6,
        fold: 0.004,
        cell: F_FLEECE,
        sleeveCell: F_FLEECE_SLEEVE,
        collar: 0.05,
        cuff: 0.05,
        hemBand: 0.05,
      };
    case 'jacket':
      return {
        ...common,
        sleeve: 9,
        neck: 'high',
        hem: 0.84,
        fit: 0.03,
        ease: 0.016,
        loose: 0.008,
        soft: 5,
        fold: 0.004,
        cell: F_JACKET,
        sleeveCell: F_JACKET_SLEEVE,
        collar: 0.04,
        cuff: 0.03,
        hemBand: 0.04,
      };
    case 'tank':
      return {
        ...common,
        sleeve: 0,
        neck: 'scoop',
        hem: 0.88,
        fit: 0.02,
        ease: 0.008,
        armhole: [0.2, 1.33, 0.1],
      };
    case 'overall':
      return {
        ...common,
        sleeve: 9,
        neck: 'high',
        hem: 0.88,
        fit: 0.024,
        ease: 0.004,
        soft: 5,
        fold: 0.004,
        cell: F_COVERALL,
        sleeveCell: F_COVERALL_SLEEVE,
        collar: 0.04,
        cuff: 0.04,
        suit: { hem: 0.06 + SHOE_CLEAR, cell: F_COVERALL_LEG, flare: 0.014 },
      };
    default:
      return {
        ...common,
        sleeve: o.shortSleeves === false ? 0.45 : 0.19,
        neck: 'crew',
        hem: 0.88,
        fit: 0.022,
        ease: 0.01,
        collar: 0.022,
      };
  }
}

/** The shirt's pattern in the team's colours: bands and blocks cut along fields, edges exact. */
function patterned(
  t: Tailor,
  pieces: Piece[],
  p: Pattern,
  accent: string,
  accent2: string,
): Piece[] {
  const rig = RIGS[t.m];
  const Y = (s: Surf, i: number): number => s.a.pos[i * 3 + 1] + rig.hip;
  const along = alongOf(t);
  const yy: Field = (s, i) => Y(s, i);
  const yc = rig.chest - 0.12;
  /** A ring round the torso (height) and round the sleeves (distance from the shoulder), `half` wide. */
  const ring = (y: number, a: number, half: number): Cut => ({
    torso: between(yy, y - half, y + half),
    arm: between(along, a - half, a + half),
  });
  /** Stripes every `period`: one pair of straight cuts each. */
  const stripes = (from: number, to: number, period: number, half: number) => {
    const out: [number, number][] = [];
    for (let q = from; q < to; q += period) out.push([q - half, q + half]);
    return out;
  };
  switch (p) {
    case 'hoops': {
      let out = pieces;
      for (const [lo, hi] of stripes(yc - 0.35, yc + 0.2, 0.1, 0.025))
        out = splitIn(out, { torso: between(yy, lo, hi) }, { color: accent2 });
      for (const [lo, hi] of stripes(0.05, t.reach, 0.1, 0.025))
        out = splitIn(out, { arm: between(along, lo, hi) }, { color: accent2 });
      return out;
    }
    case 'chest': {
      const out = splitIn(pieces, ring(yc, 0.19, 0.034), { color: accent2 });
      return splitIn(out, ring(yc, 0.19, 0.01), { color: accent });
    }
    case 'triple': {
      let out = splitIn(pieces, ring(yc + 0.024, 0.17, 0.008), {
        color: accent2,
      });
      out = splitIn(out, ring(yc, 0.19, 0.008), { color: accent });
      return splitIn(out, ring(yc - 0.024, 0.21, 0.008), { color: accent2 });
    }
    case 'yoke':
      return splitIn(
        pieces,
        {
          torso: [
            (s, i) =>
              Y(s, i) - (rig.chest - 0.1 - 0.3 * Math.abs(s.a.pos[i * 3])),
          ],
          arm: [(s, i) => 0.14 - along(s, i)],
        },
        { color: accent2 },
      );
    case 'checker': {
      const hemY = 0.88;
      const sq = 0.03;
      let out = pieces;
      // Squares of a chessboard on the front and the back of the hem (fu runs 0 at the front to 1 at the back).
      for (let r = 0; r < 3; r++)
        for (let c = r % 2; c < 15; c += 2) {
          const y0 = hemY + 0.04 + r * sq;
          const u0 = (c * sq) / 0.47;
          out = splitIn(
            out,
            {
              torso: [
                ...between(yy, y0, y0 + sq),
                ...between((s, i) => s.a.fu[i], u0, u0 + sq / 0.47),
              ],
            },
            { color: accent2 },
          );
        }
      return out;
    }
    case 'streaks': {
      const bar = (y: number, half: number): Cut => ({
        torso: [...between(yy, y - half, y + half), (s, i) => s.a.fu[i] - 0.3],
      });
      let out = splitIn(pieces, bar(yc + 0.04, 0.007), { color: accent2 });
      out = splitIn(out, bar(yc, 0.014), { color: accent });
      return splitIn(out, bar(yc - 0.04, 0.005), { color: accent2 });
    }
    case 'diagonal':
      return splitIn(
        pieces,
        { torso: [(s, i) => yc - 0.04 + 0.9 * s.a.pos[i * 3] - Y(s, i)] },
        { color: accent2 },
      );
    case 'rings': {
      const out = splitIn(pieces, ring(0, 0.27, 0.013), { color: accent2 });
      return splitIn(out, ring(0, 0.3, 0.013), { color: accent2 });
    }
    default:
      return pieces;
  }
}

/** Reflective tape in rings round the torso (heights) and the sleeves (distances from the shoulder). */
function tape(
  t: Tailor,
  pieces: Piece[],
  heights: number[],
  arms: number[],
): Piece[] {
  const rig = RIGS[t.m];
  let out = pieces;
  const Y = (s: Surf, i: number): number => s.a.pos[i * 3 + 1] + rig.hip;
  for (const h of heights)
    out = splitIn(
      out,
      { body: between((s, i) => Y(s, i), h - 0.014, h + 0.014) },
      { color: SILVER, cell: REFLECT, raise: 0.002, fixed: true },
    );
  for (const a of arms)
    out = splitIn(
      out,
      { arm: between(alongOf(t), a - 0.014, a + 0.014) },
      { color: SILVER, cell: REFLECT, raise: 0.002, fixed: true },
    );
  return out;
}

/** The clothes of an outfit on its body at a level of detail. */
export function dress(o: Outfit, t: Tailor, hi: boolean): Wardrobe {
  const rig = RIGS[t.m];
  const cloth: Surf[] = [];
  const skirts: Surf[] = [];
  const covers: Float32Array[] = [];
  const put = (c: Cloth, into = cloth): void => {
    for (const p of c.pieces) into.push(painted(p));
    covers.push(c.cover);
  };
  const accent = o.collar ?? o.torso;
  const accent2 = o.stripe ?? accent;
  const topKind: TopKind = o.topKind ?? (o.shortSleeves ? 'tee' : 'long');
  const legKind: LegKind =
    o.legKind ?? (o.skirt ? 'skirt' : o.shorts ? 'shorts' : 'jeans');
  const overall = topKind === 'overall' || legKind === 'overall';

  // Legs.
  if (!overall) {
    const spec = legSpec(legKind, o, rig.waist + 0.01);
    if (spec) put(legs(t, spec));
    else {
      if (o.tights)
        put(
          legs(t, {
            color: o.tights,
            waist: rig.waist,
            hem: 0.06,
            fit: 0.003,
            flare: 0,
            soft: 1,
            fold: 0.001,
            cell: F_JERSEY,
          }),
        );
      const pleated = legKind === 'pleat';
      put(
        skirt(t, {
          color: o.skirt ?? o.legs,
          waist: rig.waist + 0.01,
          hem: o.hem ?? 0.55,
          fit: 0.014,
          flare: legKind === 'skirt' ? 0.07 : 0.1,
          pleats: pleated || legKind === 'plaid' ? 32 : 0,
          depth: pleated ? 0.014 : legKind === 'plaid' ? 0.01 : 0,
          cell: legKind === 'plaid' ? F_PLAID : F_PLEAT,
          band: 0.03,
          trim: o.skirt ?? o.legs,
          seed: 3,
        }),
        skirts,
      );
    }
  }

  // Top.
  const spec = topSpec(topKind, o);
  const c = top(t, spec);
  if (o.pattern && o.pattern !== 'none')
    c.pieces = patterned(t, c.pieces, o.pattern, accent, accent2);
  if (topKind === 'overall') c.pieces = coverallDetails(t, c.pieces, o);
  put(c);

  // A hi-vis vest over it.
  if (o.vest) {
    const v = top(t, {
      color: o.vest,
      sleeve: 0,
      neck: 'v',
      neckDrop: 0.02,
      hem: 0.86,
      // Over the top, never inside it.
      fit: spec.fit + 0.014,
      ease: (spec.ease ?? 0) + 0.004,
      soft: 6,
      fold: 0.003,
      cell: F_VEST,
      sleeveCell: F_VEST,
      armhole: [0.215, 1.3, 0.115],
      seed: 4,
    });
    if (o.bands) {
      v.pieces = tape(t, v.pieces, [1.18, 1.0], []);
      // The two vertical bands over the shoulders, front and back.
      v.pieces = splitIn(
        v.pieces,
        {
          torso: between((s, i) => Math.abs(s.a.pos[i * 3]), 0.072, 0.1),
        },
        { color: SILVER, cell: REFLECT, raise: 0.002, fixed: true },
      );
    }
    put(v);
  }

  if (o.gloves)
    put(
      gloves(t, { color: o.gloves, cell: GLOVE, trim: o.gloves, cuff: 0.03 }),
    );

  // Hair, and a hat over it.
  const hair: Surf[] = [];
  const style =
    o.hairStyle ??
    (o.hairKind === 'bald'
      ? 'bald'
      : o.hairKind === 'long'
        ? 'long'
        : o.model === 'female'
          ? 'pixie'
          : 'crop');
  if (o.hat === 'none') hair.push(...hairOf(t, style, o.hair, o.seed ?? 1));
  else {
    // Under a hat only what hangs out of it shows: the back and the sides of long hair, a tail, a bun.
    hair.push(...hairOf(t, style, o.hair, o.seed ?? 1).slice(1));
    hair.push(...hatOf(t, o.hat, o.hatColor));
  }
  // The base legs end ragged at the ankle: the skin stops just above the shoe's collar.
  const low = new Float32Array(t.body.s.n);
  for (let i = 0; i < low.length; i++)
    low[i] = 0.03 + SHOE_TOP - (t.body.s.a.pos[i * 3 + 1] + RIGS[o.model].hip);
  covers.push(low);
  const shoes = shoesOf(
    o.model,
    o.shoeKind ?? defaultShoe(o),
    o.shoes,
    o.soleColor ?? '#e9e6df',
    hi,
  );
  return { cloth, skirts, hair, shoes, covers, rigid: [] };
}

/** A mechanic's overall: belt, knee pads, elbow patches, tape and the team's stripes on the sleeves. */
function coverallDetails(t: Tailor, pieces: Piece[], o: Outfit): Piece[] {
  const rig = RIGS[t.m];
  const accent2 = o.stripe ?? o.collar ?? o.torso;
  const Y = (s: Surf, i: number): number => s.a.pos[i * 3 + 1] + rig.hip;
  let out = pieces;
  // Team stripe down the outside of each sleeve.
  out = splitIn(
    out,
    { arm: [(s, i) => 0.014 - s.a.fu[i] * 0.2] },
    { color: accent2, fixed: true },
  );
  // Belt.
  const bw = rig.waist - 0.015;
  out = splitIn(
    out,
    { torso: between((s, i) => Y(s, i), bw - 0.017, bw + 0.017) },
    { color: '#2a2b2e', cell: LEATHER, raise: 0.004, fixed: true },
  );
  // Knee pads on the front of the knees (a squared pad: straight cuts).
  const kx = rig.hipJ[0];
  const ky = rig.kneeJ[1] + 0.02;
  out = splitIn(
    out,
    {
      leg: [
        (s, i) => 0.5 * s.a.nor[i * 3 + 2] - 0.05,
        ...between((s, i) => Math.abs(s.a.pos[i * 3]), kx - 0.06, kx + 0.06),
        ...between((s, i) => Y(s, i), ky - 0.075, ky + 0.075),
      ],
    },
    { color: DARK, raise: 0.01, slope: 0.025, fixed: true },
  );
  // Elbow patches on the back of the elbows.
  const el = Math.hypot(
    rig.elbow[0] - rig.shoulder[0],
    rig.elbow[1] - rig.shoulder[1],
    rig.elbow[2] - rig.shoulder[2],
  );
  out = splitIn(
    out,
    {
      arm: [
        (s, i) => 0.4 - s.a.fu[i],
        ...between(alongOf(t), el - 0.055, el + 0.055),
      ],
    },
    { color: DARK, raise: 0.006, slope: 0.02, fixed: true },
  );
  return tape(t, out, [1.17, 0.28], [0.34]);
}
