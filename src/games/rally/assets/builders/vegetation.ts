import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge } from '../../engine/geo';
import {
  cropBlock,
  cropCardMaterial,
  crossedCards,
  type CropCard,
} from '../../engine/crops';
import {
  bladeTuftGeometry,
  CELLS,
  GRASS_SHEET,
  plantCards,
  type GrassKind,
} from '../../engine/grass';
import { getMaterial, type MaterialId } from '../../engine/materials';
import {
  vineBarkMaterial,
  vineCanopy,
  vineMaterial,
  vineWood,
} from '../../engine/vines';
import type { Season } from '../../season';
import type { AssetBuilder } from '../types';

/**
 * Grass / weed / reed cards (the detail layer): crossed cards cut from the scanned plant atlases (engine/grass.ts),
 * one merged geometry per variant + a shared card material = one draw call per (asset, variant) for any number of
 * instances. Grass is blade strips up close. Trees and bushes are not assets: they grow from L-systems (`trees/`).
 */

/** Grass footprint (m): the blade strips and the cards cover the same width, so the levels match. */
const GRASS_W = 0.9;

const GRASS_MATERIAL: Record<GrassKind, MaterialId> = {
  green: 'foliage_card',
  dry: 'foliage_card_dry',
  spring: 'foliage_card_spring',
};

/**
 * Grass: blade strips (LOD 0, engine/grass.ts, the sheet's measured colours) and crossed cards of the scanned tufts
 * (LOD 1). Variant 1 of the green and spring grass carries the weed margin (dandelion, celandine): one narrow card in
 * place of its third tuft card (a small share of the cards' area, not a third of the tufts), flowers on the blade strips
 * so both levels show it. Two variants only: grass draws as a variant set, every instance runs the vertex shader over all.
 */
function grass(kind: GrassKind, height: [number, number]): AssetBuilder {
  return ({ seed, variant, lod }) => {
    const rng = new Rng(seed);
    const h = rng.range(height[0], height[1]);
    const margin = kind !== 'dry' && variant === 1;
    if (lod === 0)
      return {
        parts: [
          {
            geometry: bladeTuftGeometry(
              seed,
              kind,
              GRASS_W,
              h,
              undefined,
              margin ? 2 : 0,
            ),
            material: getMaterial('grass_blade'),
          },
        ],
      };
    const sheet = GRASS_SHEET[kind];
    const cells = kind === 'dry' ? CELLS.dryTufts : CELLS.tufts;
    // A card's window is 1 x 0.5 m (scripts/plants/layout.ts): the tuft fills its width, so scale both ways.
    const w = GRASS_W * rng.range(0.95, 1.05) * (h / 0.5) ** 0.5;
    const geometry = margin
      ? merge([
          plantCards(rng, sheet, cells, w, h, 2),
          plantCards(rng, sheet, [CELLS.margin], w * 0.6, h, 1),
        ])
      : plantCards(rng, sheet, cells, w, h);
    return {
      parts: [{ geometry, material: getMaterial(GRASS_MATERIAL[kind]) }],
    };
  };
}

export const grassTuft = grass('green', [0.38, 0.55]);

/** Dry summer grass (golden): the scans' own dry colour. */
export const dryGrass = grass('dry', [0.45, 0.7]);

/** Fresh spring grass (bright green), for maps with a green `groundTint`. */
export const springGrass = grass('spring', [0.3, 0.5]);

/**
 * Seeding grass (uncut verges, fallow): knee-high, the tuft scans drawn about twice as tall as wide so their seed stalks
 * stand up out of the tufts; the meadow patches pick the variant (world/meadow-patches.ts): all straw in the dry patches,
 * a green base under the straw in the lush ones.
 */
export const tallGrass: AssetBuilder = ({ seed, variant, lod }) => {
  const rng = new Rng(seed);
  const h = rng.range(0.75, 1.05);
  const w = GRASS_W * rng.range(0.8, 0.95);
  if (lod === 0)
    return {
      parts: [
        {
          geometry: bladeTuftGeometry(seed, 'dry', w, h),
          material: getMaterial('grass_blade'),
        },
      ],
    };
  // Variant 0: three straw cards. Variant 1: two straw cards over a lower green one (green leaves under dry stalks).
  const straw = plantCards(
    rng,
    'grass-dry',
    CELLS.dryTufts,
    w,
    h,
    variant === 0 ? 3 : 2,
  );
  if (variant === 0)
    return {
      parts: [{ geometry: straw, material: getMaterial('foliage_card_dry') }],
    };
  return {
    parts: [
      { geometry: straw, material: getMaterial('foliage_card_dry') },
      {
        geometry: plantCards(rng, 'grass-green', CELLS.tufts, w, h * 0.65, 1),
        material: getMaterial('foliage_card'),
      },
    ],
  };
};

/** Weeds: tall cards (the cells are 0.6 x 1.2 m). */
function tallCards(
  cells: readonly number[],
  height: [number, number],
): AssetBuilder {
  return ({ seed }) => {
    const rng = new Rng(seed);
    const h = rng.range(height[0], height[1]);
    return {
      parts: [
        {
          geometry: plantCards(rng, 'weeds', cells, h * 0.5, h, 3, 0.75),
          material: getMaterial('foliage_card_weeds'),
        },
      ],
    };
  };
}

/**
 * Reed stands (Phragmites) of canals and ditches: three crossed cards of the reeds sheet, dark in the lower two thirds
 * (inside a dense bed little light reaches the stems). `green` summer; `dry` the November stand (olive below, straw
 * above, beige plumes: the reeds-autumn sheet); `young` the spring shoots; `old` last year's bleached stand in spring.
 */
type ReedLook = 'green' | 'dry' | 'young' | 'old';
const REED_SHEET = {
  green: 'reeds',
  young: 'reeds',
  dry: 'reeds-autumn',
  old: 'reeds-winter',
} as const;
const REED_MATERIAL: Record<ReedLook, MaterialId> = {
  green: 'foliage_card_reeds',
  young: 'foliage_card_reeds',
  dry: 'foliage_card_reeds_dry',
  old: 'foliage_card_reeds_old',
};

function reedStand(look: ReedLook): AssetBuilder {
  const height: [number, number] =
    look === 'young' ? [0.8, 1.4] : look === 'old' ? [1.4, 2.1] : [2.1, 2.7];
  return ({ seed, variant }) => {
    const rng = new Rng(seed);
    const h = rng.range(...height);
    return {
      parts: [
        {
          geometry: plantCards(
            rng,
            REED_SHEET[look],
            variant === 2 && look === 'green' ? CELLS.cattails : CELLS.reeds,
            h * 0.5,
            h,
            3,
            0.35,
            0.7,
          ),
          material: getMaterial(REED_MATERIAL[look]),
        },
      ],
    };
  };
}

export const reeds = reedStand('green');
export const reedsDry = reedStand('dry');
export const reedsYoung = reedStand('young');
export const reedsOld = reedStand('old');

/**
 * Cattail stands (Typha): the cells of the cattail clumps (blades, brown spikes), standing in the water of canals and
 * drains. `dry` = the November clumps (the reeds-autumn sheet); `young` = the spring shoots, drawn lower.
 */
function cattailStand(look: 'green' | 'dry' | 'young'): AssetBuilder {
  const height: [number, number] = look === 'young' ? [0.7, 1.2] : [1.4, 2.0];
  return ({ seed }) => {
    const rng = new Rng(seed);
    const h = rng.range(...height);
    return {
      parts: [
        {
          geometry: plantCards(
            rng,
            look === 'dry' ? 'reeds-autumn' : 'reeds',
            CELLS.cattails,
            h * 0.5,
            h,
            3,
            0.4,
            0.65,
          ),
          material: getMaterial(
            look === 'dry' ? 'foliage_card_reeds_dry' : 'foliage_card_reeds',
          ),
        },
      ],
    };
  };
}

export const cattails = cattailStand('green');
export const cattailsDry = cattailStand('dry');
export const cattailsYoung = cattailStand('young');

/**
 * Dead docks and knotweed of the ditch banks in autumn (rust red and brown, dark seed spikes): the nettle cells of the
 * weeds-rust sheet, 0.6-1.1 m, three crossed cards in a patch.
 */
export const rustWeeds: AssetBuilder = ({ seed }) => {
  const rng = new Rng(seed);
  const h = rng.range(0.6, 1.1);
  return {
    parts: [
      {
        geometry: plantCards(
          rng,
          'weeds-rust',
          [...CELLS.nettles, ...CELLS.dryNettles],
          h * 0.6,
          h,
          3,
          0.45,
          0.6,
        ),
        material: getMaterial('foliage_card_weeds_rust'),
      },
    ],
  };
};

/**
 * A heap of spoil dredged out of a ditch (dark wet earth, lumpy, 2.5-4 m long and 0.6-1 m high) with the cut reed stems
 * and weeds thrown on it: a mound of vertex-coloured soil (lighter where the top has dried) with cards of bleached straw
 * stems sticking out of it.
 */
export const spoilHeap: AssetBuilder = ({ seed, variant }) => {
  const rng = new Rng(seed + variant * 977);
  const len = rng.range(2.5, 4);
  const wid = rng.range(1.6, 2.4);
  const hgt = rng.range(0.6, 1.0);
  const NU = 18;
  const NV = 9;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bumps = Array.from({ length: 6 }, () => [
    rng.range(-0.8, 0.8),
    rng.range(-0.7, 0.7),
    rng.range(0.1, 0.25),
    rng.range(0.25, 0.5),
  ]);
  for (let j = 0; j <= NV; j++) {
    const v = j / NV; // 0 = rim on the ground, 1 = the crest
    for (let i = 0; i < NU; i++) {
      const a = (i / NU) * Math.PI * 2;
      const r = Math.cos((v * Math.PI) / 2);
      let x = Math.cos(a) * r;
      let z = Math.sin(a) * r;
      let y = Math.sin((v * Math.PI) / 2);
      // Clods and dents.
      let lift = 0;
      for (const [bx, bz, bh, br] of bumps) {
        const d2 = (x - bx) ** 2 + (z - bz) ** 2;
        lift += bh * Math.exp(-d2 / (br * br));
      }
      const jit = rng.range(-0.06, 0.06);
      y = Math.max(0, y * (0.75 + lift) + (j > 0 ? jit : 0));
      x *= 1 + jit;
      z *= 1 + jit;
      pos.push(x * len * 0.5, y * hgt - 0.05, z * wid * 0.5);
      // Dark wet earth, lighter where it has dried on top, grey-brown clods.
      const dry = 0.6 + 0.5 * v + rng.range(-0.15, 0.15);
      col.push(0.17 * dry, 0.135 * dry, 0.1 * dry);
    }
  }
  const top = pos.length / 3;
  pos.push(0, hgt * 0.95, 0);
  col.push(0.2, 0.16, 0.12);
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const a = j * NU + i;
      const b = j * NU + ((i + 1) % NU);
      idx.push(a, a + NU, b, b, a + NU, b + NU);
    }
  for (let i = 0; i < NU; i++)
    idx.push(NV * NU + i, top, NV * NU + ((i + 1) % NU));
  const mound = new BufferGeometry();
  mound.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  mound.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  mound.setIndex(idx);
  // Faceted (clods), not a smooth dome.
  const clods = mound.toNonIndexed();
  clods.computeVertexNormals();
  // Cut straw stems thrown on it, sticking out of the earth at angles.
  const stems = plantCards(
    rng,
    'reeds-winter',
    CELLS.reeds,
    len * 0.8,
    1.1,
    4,
    0.5,
    0.5,
  );
  stems.rotateZ(rng.range(-0.25, 0.25));
  stems.translate(0, hgt * 0.35, 0);
  return {
    parts: [
      { geometry: clods, material: soilMaterial() },
      { geometry: stems, material: getMaterial('foliage_card_reeds_old') },
    ],
  };
};

let soil: MeshStandardMaterial | undefined;
/** Bare earth lit like the ground (vertex colour only). */
function soilMaterial(): MeshStandardMaterial {
  soil ??= new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  soil.defines = { RALLY_GROUND: 1 };
  soil.name = 'spoil_soil';
  return soil;
}

/**
 * Ferns of the shaded woods (male fern / bracken): three crossed cards of the fern sheet (2.4 x 1.2 m cells, the stand
 * ~0.6 of the card's height), green or dead bracken (autumn).
 */
function fernStand(autumn: boolean): AssetBuilder {
  return ({ seed }) => {
    const rng = new Rng(seed);
    const h = rng.range(0.9, 1.3);
    return {
      parts: [
        {
          geometry: plantCards(
            rng,
            autumn ? 'ferns-autumn' : 'ferns',
            CELLS.ferns,
            h * 2,
            h,
            3,
            0.6,
          ),
          material: getMaterial(
            autumn ? 'foliage_card_ferns_autumn' : 'foliage_card_ferns',
          ),
        },
      ],
    };
  };
}

export const fern = fernStand(false);
export const fernAutumn = fernStand(true);

/** Nettle stands of the field margins and ditches, green and dried. */
export const tallWeeds = tallCards(
  [...CELLS.nettles, ...CELLS.dryNettles],
  [0.75, 1.15],
);

// --- field crops (engine/crops.ts: the CC BY wheat and corn models, cards baked from them) ---

/** A crop: crossed cards baked from the model (the same at every distance, so nothing swaps near the car). */
function crop(look: CropCard, planes: number): AssetBuilder {
  return ({ seed, variant }) => ({
    parts: [
      {
        geometry: crossedCards(look, planes, seed, variant),
        material: cropCardMaterial(look),
      },
    ],
  });
}

/** Ripe wheat (summer) and green wheat (spring): 1 m card patches. */
export const wheat = crop('wheat', 3);
export const greenWheat = crop('green_wheat', 3);
/** A 3 x 2 m block of a wheat field as one instance (engine/crops.ts `cropBlock`): the fields away from the road. */
function cropBlockAsset(look: 'wheat' | 'green_wheat'): AssetBuilder {
  return ({ seed, variant }) => ({
    parts: [
      {
        geometry: cropBlock(look, seed, variant),
        material: cropCardMaterial(look),
      },
    ],
  });
}
export const wheatBlock = cropBlockAsset('wheat');
export const greenWheatBlock = cropBlockAsset('green_wheat');
/** Corn: a crossed card of one plant. */
export const corn = crop('corn', 2);
export const dryCorn = crop('dry_corn', 2);
/** A 3 m stretch of a corn row as one card (the fields away from the roads). */
export const cornRowCard = crop('corn_row', 1);
export const dryCornRowCard = crop('dry_corn_row', 1);

// --- vineyards (engine/vines.ts: posts, wires, bark trunks and leaf canopy cards, per season) ---

/** A 6 m stretch of a vineyard row: full wood + canopy up close, trunks + two canopy cards, then the cards only. */
function vineRow(season: Season): AssetBuilder {
  return ({ seed, lod }) => ({
    parts: [
      ...(lod < 2
        ? [
            {
              geometry: vineWood(seed, lod === 0, true),
              material: getMaterial('props'),
            },
            {
              geometry: vineWood(seed, lod === 0, false),
              material: vineBarkMaterial(),
            },
          ]
        : []),
      {
        geometry: vineCanopy(seed, season, lod > 0),
        material: vineMaterial(season),
      },
    ],
  });
}
export const vineRowSpring = vineRow('spring');
export const vineRowSummer = vineRow('summer');
export const vineRowAutumn = vineRow('autumn');
