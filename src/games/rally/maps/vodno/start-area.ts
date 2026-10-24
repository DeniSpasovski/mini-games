import type { BuildingDef, PathDef } from '../shared/types';

/**
 * The first stretch of the road, by the embassies on Todor Aleksandrov street (world x 1550-1620, z -1150 to -1060): the main
 * street curves on into the stage road, a side street leaves it to the east and runs behind a car park, and the car park
 * (`landmarks/start-lot.ts`) lies between the two. OSM draws the side street's mouth as a pair of one-way slips and the
 * car park's aisle as a loop; here the mouth is one plain T and the lot is a paved area (the aisle is dropped).
 */
const pointKey = (x: number, z: number): string =>
  `${Math.round(x)},${Math.round(z)}`;
const wayKey = (p: PathDef): string => {
  const n = p.pts.length;
  return `${pointKey(p.pts[0], p.pts[1])}>${pointKey(p.pts[n - 2], p.pts[n - 1])}`;
};

/** The two one-way slips of the side street's mouth and the car park's aisle (first > last point of the BAKED way, rounded). */
const DROPPED = new Set([
  '1586,-1148>1558,-1166',
  '1574,-1144>1586,-1148',
  '1594,-1140>1608,-1103',
]);

/**
 * The side street leaves the main street 13 m before the stage road starts: a two-way mouth (the slips ran one way each)
 * that bends from the main street's line onto the baked street. It starts 2.9 m back from the main street's end: a way
 * ending at another's end counts as a node of the street network and the engine would not run the main street on to the
 * stage road's start (`connectPaths`).
 */
const MOUTH = [1566.2, -1150.6, 1573, -1151.4, 1579, -1151.3, 1584, -1150.3];

export const startStreets = (paths: PathDef[]): PathDef[] =>
  paths
    .filter((p) => !DROPPED.has(wayKey(p)))
    .map((p) =>
      p.kind === 'residential' &&
      !p.oneway &&
      pointKey(p.pts[0], p.pts[1]) === '1586,-1148'
        ? { ...p, pts: [...MOUTH, ...p.pts] }
        : p,
    );

/** Baked buildings that stand where the car park and its tree island are (a garage footprint on the island; another at the lot's end). */
const DROPPED_BUILDINGS = new Set([53, 64]);

/**
 * The block closing the car park to the south (flat roof, three storeys, a car row along its north wall): OSM has no
 * building there, the footprint only had a garage.
 */
const SOUTH_BLOCK: BuildingDef = {
  id: 900001,
  x: 1586,
  z: -1086,
  w: 26,
  d: 22,
  angle: 0,
  h: 9,
  floors: 3,
  type: 'flat',
  source: 'manual',
  along: 40,
  kind: 'commercial',
  roof: 'flat',
};

export const startBuildings = (buildings: BuildingDef[]): BuildingDef[] => [
  ...buildings.filter((b) => !DROPPED_BUILDINGS.has(b.id)),
  SOUTH_BLOCK,
];
