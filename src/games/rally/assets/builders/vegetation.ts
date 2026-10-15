import { BufferAttribute, PlaneGeometry, type BufferGeometry } from 'three';
import { Rng } from '../../../../shared/rng';
import { merge, paint, shade } from '../../engine/geo';
import { getMaterial, type MaterialId } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/**
 * Grass / reed / weed cards (the detail layer). All cards of a kind are ONE merged geometry with vertex colours +
 * a shared foliage card material = one draw call per (asset, variant) for any number of instances. Trees and
 * bushes are not assets: they grow from L-systems (`trees/`).
 */

export const grassTuft: AssetBuilder = ({ seed }) => {
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
    // Darker at the roots.
    shade(pg, (_x, y) => 0.55 + 0.45 * Math.min(1, y / h));
    parts.push(pg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('foliage_card') }],
  };
};

/**
 * Crossed grass cards (same construction as grass_tuft) where the card TEXTURE carries
 * the colour; the near-white vertex colours only vary it a little.
 */
function colouredGrass(
  material: MaterialId,
  height: [number, number],
  colors: string[],
): AssetBuilder {
  return ({ seed }) => {
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
);

/** Fresh spring grass (bright green), for maps with a green `groundTint`. */
export const springGrass = colouredGrass(
  'foliage_card_spring',
  [0.3, 0.5],
  ['#ffffff', '#eef3dc', '#f6f2d4', '#e4eecf'],
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
