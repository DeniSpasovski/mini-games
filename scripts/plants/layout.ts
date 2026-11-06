/**
 * The plant card atlases (scripts/plants/bake-plants.mjs): which scanned clumps stand where in each cell. Pure and
 * seeded (src/shared/rng.ts), so a bake is the same on every machine; a test checks the committed atlas data
 * (`LAYOUT_HASH` in engine/plants/plant-atlas.data.ts) against it.
 */
import { hashString, Rng } from '../../src/shared/rng.ts';

/** The textures a clump wears: the model's own ('diff') or, Poly Haven scans with one, its dry colour map. */
export type Look = 'diff' | 'dry';

export interface Placement {
  model: string;
  mesh: string;
  look: Look;
  /** Metres in the cell's window (x across, z towards the camera), y rotation, xz and y scale. */
  x: number;
  z: number;
  rotY: number;
  scale: number;
  sy: number;
}

interface Group {
  model: string;
  /** Mesh name parts to pick from. */
  meshes: string[];
  count: [number, number];
  scale: [number, number];
  /** Extra vertical stretch (reeds). */
  sy?: [number, number];
  look?: Look;
  /** Share of the window's width the group spreads over (centred). */
  spread?: number;
}

export interface Cell {
  seed: number;
  look: Look;
  groups: Group[];
}

export interface Sheet {
  id: string;
  /** Atlas size (px) and grid. */
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** What one cell shows: width x height (m). */
  window: [number, number];
  cells: Cell[];
}

const GRASS_01 = 'grass_medium_01';
const GRASS_02 = 'grass_medium_02';
/** CC BY 4.0 Sketchfab models (Nicholas-3D, glb): pieces picked by bake-plants.mjs (`GLB_MODELS`). */
const REEDS = 'reed_pack';
const CATTAILS = 'cattails';
/** CC0 Poly Haven fern scan (four clumps), in sources/rally/polyhaven/fern_02. */
const FERN = 'fern_02';

/** A grass tuft: a few big clumps in the middle, smaller ones and single blades round them (a dome, no flat top). */
const tuft = (seed: number, look: Look): Cell => ({
  seed,
  look,
  groups: [
    {
      model: GRASS_01,
      meshes: ['mid_', 'large_'],
      count: [6, 8],
      scale: [1.5, 2.0],
      spread: 0.85,
    },
    {
      model: GRASS_02,
      meshes: ['_c', '_d', '_e'],
      count: [3, 4],
      scale: [1.1, 1.4],
      spread: 0.7,
    },
    {
      model: GRASS_01,
      meshes: ['small_', 'mid_'],
      count: [5, 6],
      scale: [1.2, 1.6],
      spread: 0.95,
    },
    {
      model: GRASS_01,
      meshes: ['tall_'],
      count: [3, 4],
      scale: [1.2, 1.6],
      spread: 0.8,
    },
    {
      model: GRASS_01,
      meshes: ['tiny_'],
      count: [4, 6],
      scale: [1.2, 1.8],
      spread: 0.95,
    },
  ],
});

/** The weed margin: grass with dandelion and celandine rosettes and a low weed in front. */
const margin = (seed: number): Cell => ({
  seed,
  look: 'diff',
  groups: [
    {
      model: GRASS_01,
      meshes: ['mid_', 'large_'],
      count: [5, 6],
      scale: [1.4, 1.8],
      spread: 0.85,
    },
    {
      model: GRASS_01,
      meshes: ['tall_'],
      count: [2, 3],
      scale: [1.2, 1.5],
      spread: 0.7,
    },
    {
      model: GRASS_02,
      meshes: ['_b', '_c', '_d'],
      count: [2, 3],
      scale: [1.0, 1.2],
      spread: 0.9,
    },
    {
      model: 'dandelion_01',
      meshes: ['_a', '_b', '_c'],
      count: [2, 3],
      scale: [1.2, 1.6],
      spread: 0.9,
    },
    {
      model: 'celandine_01',
      meshes: ['_a', '_c', '_d'],
      count: [1, 2],
      scale: [1.1, 1.4],
      spread: 0.9,
    },
    {
      model: 'weed_plant_02',
      meshes: ['_a', '_b', '_c'],
      count: [1, 2],
      scale: [1.0, 1.3],
      spread: 0.8,
    },
  ],
});

/** Tall weeds: a nettle stand with grass through it. */
const nettles = (seed: number, look: Look): Cell => ({
  seed,
  look,
  groups: [
    {
      model: 'nettle_plant',
      meshes: ['tall_'],
      count: [4, 5],
      scale: [3.6, 4.6],
      spread: 0.6,
    },
    {
      model: 'nettle_plant',
      meshes: ['medium_'],
      count: [3, 4],
      scale: [3.4, 4.2],
      spread: 0.85,
    },
    {
      model: GRASS_01,
      meshes: ['mid_', 'large_'],
      count: [2, 3],
      scale: [1.6, 2.0],
      spread: 0.85,
    },
  ],
});

/** Weed sheet cells 4, 5: unused since the reeds sheet (stretched grass); drop them on the next full bake. */
const stretchedGrass = (seed: number): Cell => ({
  seed,
  look: 'dry',
  groups: [
    {
      model: GRASS_01,
      meshes: ['tall_'],
      count: [8, 10],
      scale: [1.5, 1.9],
      sy: [2.4, 3.1],
      spread: 0.8,
    },
    {
      model: GRASS_02,
      meshes: ['_e'],
      count: [2, 3],
      scale: [0.9, 1.1],
      sy: [2.2, 2.6],
      spread: 0.7,
    },
  ],
});

/** A reed bed: the CC BY reed models (Nicholas-3D), each piece normalised to 1 m so the scale is its height. */
const reedBed = (seed: number): Cell => ({
  seed,
  look: 'diff',
  groups: [
    {
      model: REEDS,
      meshes: ['Reed_'],
      count: [8, 9],
      scale: [1.9, 2.4],
      spread: 0.8,
    },
    {
      model: REEDS,
      meshes: ['Reed_'],
      count: [6, 7],
      scale: [1.3, 1.7],
      spread: 0.95,
    },
  ],
});

/** Cattails in a reed bed (wet ditches): the cattail clumps of the CC BY ground-cover showcase in front of reeds. */
const cattailBed = (seed: number): Cell => ({
  seed,
  look: 'diff',
  groups: [
    {
      model: REEDS,
      meshes: ['Reed_'],
      count: [4, 5],
      scale: [1.8, 2.2],
      spread: 0.8,
    },
    {
      // The clump is as wide as tall: drawn a little narrower and taller so it stays inside the cell; one or two, so
      // the reeds show between them (more read as a solid block).
      model: CATTAILS,
      meshes: ['cattail'],
      count: [1, 2],
      scale: [0.75, 0.82],
      sy: [1.5, 1.7],
      spread: 0.45,
    },
  ],
});

/**
 * A fern stand of the shaded woods (male fern / bracken, 0.6-0.8 m): one or two big clumps of the CC0 Poly Haven
 * "Fern 02" scan in the middle, smaller ones beside them. The scan's clumps are ~1 m across and 0.2-0.4 m tall: scaled
 * up to the woods' ferns.
 */
const fernStand = (seed: number): Cell => ({
  seed,
  look: 'diff',
  groups: [
    {
      model: FERN,
      meshes: ['_c', '_d'],
      count: [1, 2],
      scale: [1.5, 1.8],
      spread: 0.75,
    },
    {
      model: FERN,
      meshes: ['_a', '_b'],
      count: [1, 2],
      scale: [1.6, 1.9],
      spread: 0.35,
    },
  ],
});

/** Grass cards: 2 x 2 cells of 1 x 0.5 m; cell 3 of the green / spring sheets is the weed margin. */
export const SHEETS: Sheet[] = [
  {
    id: 'grass-green',
    w: 1024,
    h: 512,
    cols: 2,
    rows: 2,
    window: [1, 0.5],
    cells: [tuft(11, 'diff'), tuft(12, 'diff'), tuft(13, 'diff'), margin(14)],
  },
  {
    id: 'grass-dry',
    w: 1024,
    h: 512,
    cols: 2,
    rows: 2,
    window: [1, 0.5],
    cells: [tuft(21, 'dry'), tuft(22, 'dry'), tuft(23, 'dry'), tuft(24, 'dry')],
  },
  {
    id: 'weeds',
    w: 1024,
    h: 1024,
    cols: 4,
    rows: 2,
    window: [0.6, 1.2],
    cells: [
      nettles(31, 'diff'),
      nettles(32, 'diff'),
      nettles(33, 'dry'),
      nettles(34, 'dry'),
      stretchedGrass(35),
      stretchedGrass(36),
      nettles(37, 'diff'),
      nettles(38, 'dry'),
    ],
  },
  // Reed cards: 4 x 2 cells of 1.2 x 2.4 m, cells 0-5 reed beds, 6-7 cattails.
  {
    id: 'reeds',
    w: 1024,
    h: 1024,
    cols: 4,
    rows: 2,
    window: [1.2, 2.4],
    cells: [
      reedBed(41),
      reedBed(42),
      reedBed(43),
      reedBed(44),
      reedBed(45),
      reedBed(46),
      cattailBed(47),
      cattailBed(48),
    ],
  },
  // Fern cards: 2 x 2 cells of 2.4 x 1.2 m.
  {
    id: 'ferns',
    w: 1024,
    h: 512,
    cols: 2,
    rows: 2,
    window: [2.4, 1.2],
    cells: [fernStand(51), fernStand(52), fernStand(53), fernStand(54)],
  },
];

/** The autumn fern sheet is the fern one (same layout) turned to dead bracken. */
export const AUTUMN_FROM = 'ferns';

/** The spring sheet is the green one (same layout) brought to the spring palette. */
export const SPRING_FROM = 'grass-green';

/** Mesh names of each model (the 1k glTF downloads), so the layout does not need the files. */
export const MODEL_MESHES: Record<string, string[]> = {
  grass_medium_01: [
    'small_a',
    'large_b',
    'mid_b',
    'tall_b',
    'tall_a',
    'tall_c',
    'small_b',
    'mid_c',
    'mid_a',
    'large_a',
    'large_c',
    'tiny_c',
    'tiny_a',
    'tiny_b',
    'tiny_d',
    'tiny_e',
    'tiny_f',
  ].map((n) => `grass_medium_01_${n}_LOD0`),
  grass_medium_02: ['a', 'b', 'c', 'd', 'e'].map((n) => `grass_medium_02_${n}`),
  nettle_plant: [
    'medium_a',
    'medium_b',
    'small_a',
    'small_b',
    'tall_a',
    'tall_b',
  ].map((n) => `nettle_plant_${n}_LOD0`),
  dandelion_01: ['a', 'b', 'c', 'd', 'e'].map((n) => `dandelion_01_${n}_LOD0`),
  celandine_01: ['a', 'b', 'c', 'd', 'e'].map((n) => `celandine_01_${n}_LOD0`),
  weed_plant_02: ['a', 'b', 'c', 'd', 'e'].map(
    (n) => `weed_plant_02_${n}_LOD0`,
  ),
  reed_pack: [1, 2, 3, 4, 5].map((n) => `Reed_${n}_${n}`),
  cattails: ['cattail'],
  fern_02: ['a', 'b', 'c', 'd'].map((n) => `fern_02_${n}`),
};

/** Every clump of a cell, back to front (the bake draws them with a depth test, the order only fixes the RNG). */
export function layoutCell(cell: Cell, window: [number, number]): Placement[] {
  const rng = new Rng(cell.seed);
  const out: Placement[] = [];
  for (const g of cell.groups) {
    const names = MODEL_MESHES[g.model].filter((n) =>
      g.meshes.some((m) => n.includes(m)),
    );
    const count = rng.int(g.count[0], g.count[1]);
    for (let i = 0; i < count; i++) {
      // Spread evenly with jitter (stratified), so clumps do not bunch up and leave a gap.
      const t = (i + rng.range(0.15, 0.85)) / count;
      const x = (t - 0.5) * (g.spread ?? 0.9) * window[0];
      // The dome: clumps near the edges are smaller.
      const edge = 1 - 0.35 * Math.abs(x / (window[0] / 2));
      out.push({
        model: g.model,
        mesh: rng.pick(names),
        look: g.look ?? cell.look,
        x,
        z: rng.range(-0.12, 0.12) * window[0],
        rotY: rng.range(0, Math.PI * 2),
        scale: rng.range(g.scale[0], g.scale[1]) * edge,
        sy: g.sy ? rng.range(g.sy[0], g.sy[1]) : 1,
      });
    }
  }
  return out.sort((a, b) => a.z - b.z);
}

/** Hash of every sheet's layout: changes when a recipe, seed or the RNG changes. */
export function layoutHash(): number {
  const parts: string[] = [];
  for (const s of SHEETS)
    for (const c of s.cells)
      for (const p of layoutCell(c, s.window))
        parts.push(
          `${s.id}|${p.mesh}|${p.look}|${p.x.toFixed(4)}|${p.z.toFixed(4)}|${p.rotY.toFixed(4)}|${p.scale.toFixed(4)}|${p.sy.toFixed(4)}`,
        );
  return hashString(parts.join(';'));
}
