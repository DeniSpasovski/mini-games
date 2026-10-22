import { BufferAttribute, PlaneGeometry, type BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, shade } from '../../engine/geo';
import {
  cropBlock,
  cropCardMaterial,
  crossedCards,
  type CropCard,
} from '../../engine/crops';
import { bladeTuftGeometry, type GrassKind } from '../../engine/grass';
import { getMaterial, type MaterialId } from '../../engine/materials';
import { vineCanopy, vineMaterial, vineWood } from '../../engine/vines';
import type { Season } from '../../season';
import type { AssetBuilder } from '../types';

/**
 * Grass / reed / weed cards (the detail layer; grass is blade strips up close). All cards of a kind are ONE merged
 * geometry with vertex colours + a shared foliage card material = one draw call per (asset, variant) for any number
 * of instances. Trees and
 * bushes are not assets: they grow from L-systems (`trees/`).
 */

/** Near LOD of the grass assets: real blade strips (engine/grass.ts); the far LOD is the crossed cards. */
function bladeTuft(seed: number, kind: GrassKind, height: number) {
  return {
    parts: [
      {
        geometry: bladeTuftGeometry(seed, kind, 0.9, height),
        material: getMaterial('grass_blade'),
      },
    ],
  };
}

export const grassTuft: AssetBuilder = ({ seed, lod }) => {
  if (lod === 0) return bladeTuft(seed, 'green', 0.5);
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const w = rng.range(0.8, 1.1);
  const h = rng.range(0.38, 0.55);
  for (let i = 0; i < 3; i++) {
    const g = new PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY((i * Math.PI) / 3 + rng.next() * 0.3);
    const pg = paint(g, rng.pick(['#c8d0a0', '#b8c48c', '#d8d0a0']));
    // Normals straight up: grass is lit like the ground under it (no dark backfaces).
    const n = pg.getAttribute('normal') as BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    // Darker at the roots (the sheet darkens them too).
    shade(pg, (_x, y) => 0.7 + 0.3 * Math.min(1, y / h));
    parts.push(pg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('foliage_card') }],
  };
};

/**
 * Crossed grass cards (same construction as grass_tuft) where the card TEXTURE carries
 * the colour; the near-white vertex colours only vary it a little. `blades` = the near LOD is blade strips.
 */
function colouredGrass(
  material: MaterialId,
  height: [number, number],
  colors: string[],
  blades?: GrassKind,
): AssetBuilder {
  return ({ seed, lod }) => {
    if (blades && lod === 0)
      return bladeTuft(seed, blades, (height[0] + height[1]) / 2);
    const rng = new Rng(seed);
    const parts: BufferGeometry[] = [];
    const w = rng.range(0.7, 1.05);
    const h = rng.range(height[0], height[1]);
    for (let i = 0; i < 3; i++) {
      const g = new PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      g.rotateY((i * Math.PI) / 3 + rng.next() * 0.3);
      const pg = paint(g, rng.pick(colors));
      const nrm = pg.getAttribute('normal') as BufferAttribute;
      for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
      shade(pg, (_x, y) => 0.6 + 0.4 * Math.min(1, y / h));
      parts.push(pg);
    }
    return {
      parts: [{ geometry: merge(parts), material: getMaterial(material) }],
    };
  };
}

/** Dry summer grass (golden). */
export const dryGrass = colouredGrass(
  'foliage_card_dry',
  [0.45, 0.7],
  ['#ffffff', '#f1eadb', '#e6dcc4', '#fff6e4'],
  'dry',
);

/** Fresh spring grass (bright green), for maps with a green `groundTint`. */
export const springGrass = colouredGrass(
  'foliage_card_spring',
  [0.3, 0.5],
  ['#ffffff', '#eef3dc', '#f6f2d4', '#e4eecf'],
  'spring',
);

/** Tall golden reed cards (canal and drain banks). */
export const reeds = colouredGrass(
  'foliage_card_dry',
  [1.3, 2.1],
  ['#f1e6c4', '#e6d9b0', '#d9ca9a', '#f6eccf'],
);

/** Tall dry weeds / thistles (field margins, ditches): between grass and reeds. */
export const tallWeeds = colouredGrass(
  'foliage_card_dry',
  [0.8, 1.35],
  ['#e6dcc4', '#d9c9a5', '#efe4c8', '#cdbd95'],
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

// --- vineyards (engine/vines.ts: posts, wires, trunks and painted canopy cards, per season) ---

/** A 6 m stretch of a vineyard row: full wood + canopy up close, trunks + two canopy cards, then the cards only. */
function vineRow(season: Season): AssetBuilder {
  return ({ seed, lod }) => ({
    parts: [
      ...(lod < 2
        ? [
            {
              geometry: vineWood(seed, lod === 0),
              material: getMaterial('props'),
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
