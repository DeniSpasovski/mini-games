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
 * Reeds (canal and drain banks): cards of the reeds sheet, baked from CC BY reed and cattail models; the last variant
 * is a cattail stand.
 */
export const reeds: AssetBuilder = ({ seed, variant }) => {
  const rng = new Rng(seed);
  const h = rng.range(1.7, 2.3);
  return {
    parts: [
      {
        geometry: plantCards(
          rng,
          'reeds',
          variant === 2 ? CELLS.cattails : CELLS.reeds,
          h * 0.5,
          h,
          3,
          0.6,
        ),
        material: getMaterial('foliage_card_reeds'),
      },
    ],
  };
};

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
