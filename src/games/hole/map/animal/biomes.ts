/**
 * Biomes of Animal Island. The generator builds a biome grid from them (`Terrain.biome`), the ground
 * builder colours it, and every item lists the biomes it may be placed in (`catalog-animal.ts`).
 */
export const BIOMES = [
  'meadow',
  'forest',
  'savanna',
  'wetland',
  'highlands',
  'beach',
  'jungle',
  'zoo',
  'lab',
  'farm',
] as const;
export type BiomeId = (typeof BIOMES)[number];

/** Code of a cell outside the island in the biome grid. */
export const SEA = 255;

export const biomeIndex = (b: BiomeId): number => BIOMES.indexOf(b);

/** Ground colours (a plain and a slightly different one for the 10 m checker). */
export const BIOME_COLORS: Record<BiomeId, [number, number]> = {
  meadow: [0x7cc66a, 0x72bd61],
  forest: [0x4f9a4a, 0x479244],
  savanna: [0xcdb860, 0xc4af58],
  wetland: [0x84a862, 0x7aa05a],
  highlands: [0x8ab463, 0x80ab5b],
  beach: [0xe6d29a, 0xe0cb92],
  jungle: [0x3f8a4a, 0x378243],
  zoo: [0xb89a6a, 0xb09262],
  lab: [0xc9cdd1, 0xc0c5c9],
  farm: [0x8ccf6a, 0x82c660],
};

/** Colour of river and pond water, the bank mud strip and the compound paths. */
export const WATER_COLOR = 0x4aa3df;
export const MUD_COLOR = 0x9a8a62;
export const PATH_COLOR = 0x8f9499;

/** Biome (`BIOMES` index, or `SEA`) at a world position from a terrain biome grid. */
export function biomeCode(
  t: {
    x0: number;
    z0: number;
    cell: number;
    nx: number;
    nz: number;
    data: Uint8Array;
  },
  x: number,
  z: number,
): number {
  const ix = Math.floor((x - t.x0) / t.cell);
  const iz = Math.floor((z - t.z0) / t.cell);
  if (ix < 0 || iz < 0 || ix >= t.nx || iz >= t.nz) return SEA;
  return t.data[iz * t.nx + ix];
}
