import type {
  BuildingDef,
  PadDef,
  PathDef,
  SidewalkLink,
} from '../shared/types';

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

/**
 * The street round the building site east of 250 m: OSM still runs it through the site's east end, where blocks now
 * stand (`landmarks/start-shells.ts`); it goes along the site's north edge instead, between the first point kept before
 * the site (`SITE_FROM`) and the first after it (`SITE_TO`).
 */
const SITE_STREET = '1617,-1054';
const SITE_FROM = '1621,-1005';
const SITE_TO = '1696,-1012';
const SITE_EDGE = [1645, -1006, 1668, -1008, 1688, -1008];

function roundSite(pts: number[]): number[] {
  const keys = Array.from({ length: pts.length / 2 }, (_, i) =>
    pointKey(pts[2 * i], pts[2 * i + 1]),
  );
  const a = keys.indexOf(SITE_FROM);
  const b = keys.indexOf(SITE_TO);
  if (a < 0 || b < a) return pts;
  return [...pts.slice(0, 2 * a + 2), ...SITE_EDGE, ...pts.slice(2 * b)];
}

export const startStreets = (paths: PathDef[]): PathDef[] =>
  paths
    .filter((p) => !DROPPED.has(wayKey(p)))
    .map((p) =>
      p.kind === 'residential' &&
      !p.oneway &&
      pointKey(p.pts[0], p.pts[1]) === '1586,-1148'
        ? { ...p, pts: [...MOUTH, ...p.pts] }
        : p.kind === 'residential' &&
            pointKey(p.pts[0], p.pts[1]) === SITE_STREET
          ? { ...p, pts: roundSite(p.pts) }
          : p,
    );

/** Baked buildings that stand where the car park and its tree island are (a garage footprint on the island; another at the lot's end). */
const DROPPED_BUILDINGS = new Set([53, 64]);

/**
 * The terrace of the curved-roof block south of the car park (`landmarks/start-towers.ts`): the land falls ~8 m along it
 * towards the start, so it stands cut into the slope at its uphill end and on a low bank at the start's end.
 */
export const HALL_PAD: PadDef = {
  name: 'hall',
  polygon: [1557, -1089, 1586, -1089, 1586, -1043, 1557, -1043],
  blend: 4,
  level: { at: [1571.5, -1076], lift: 0.1 },
};

/** The white villas on the street above the courts (Microsoft footprints): white flat roofs, as the aerial shows, not gables. */
const FLAT_ROOFED = new Set([550, 581, 604, 615]);
const WHITE_ROOF = '#e8e6e0';

/**
 * The two houses in the trees west of the road at 100 m, as the aerial shows them: the north one's brown tiled roof stands
 * ~7 m north of its footprint (moved there), the south one is a flat-roofed house with a terrace.
 */
const TREE_HOUSES: Record<number, Partial<BuildingDef>> = {
  43: { x: 1480.5, z: -1112, roofColor: '#8a5a44' },
  40: { roof: 'flat', roofColor: '#8f8d88' },
};

export const startBuildings = (buildings: BuildingDef[]): BuildingDef[] =>
  buildings
    .filter((b) => !DROPPED_BUILDINGS.has(b.id))
    .map((b): BuildingDef =>
      FLAT_ROOFED.has(b.id)
        ? { ...b, roof: 'flat', roofColor: WHITE_ROOF }
        : { ...b, ...TREE_HOUSES[b.id] },
    );

/**
 * The sidewalks at the side street's mouth (the street detail stops each run short of the other street's ribbon): the main
 * street's east sidewalk turns round the corner into the side street's north one (a curve between the two run ends, the
 * kerb lines read from the engine), and the side street's south sidewalk runs on to the main street's edge.
 */
export const START_SIDEWALKS: SidewalkLink[] = [
  {
    side: 1,
    pts: [
      1567.31, -1154.74, 1567.55, -1154.1, 1567.95, -1153.65, 1568.8, -1153.35,
      1569.88, -1153.55,
    ],
  },
  {
    side: -1,
    dropStart: true,
    pts: [1569.7, -1148.72, 1571, -1148.77, 1572.38, -1148.81],
  },
];

/**
 * Unwatered ground round the start (`terrain.dryGround`): the low neighbourhood's open ground would read as a lush valley
 * floor, but the aerial shows olive lawns and dry, trodden earth between the blocks and on the open slope above the road to
 * the 560 m junction; the meadow there at 300-450 m (OSM way 230112771) is dry tan grass.
 */
export const START_DRY: { poly: number[]; moisture: number }[] = [
  {
    // (the neighbourhood, and the open slope above the road to the 560 m junction, 10 m off its north edge)
    poly: [
      1480, -1260, 1720, -1260, 1720, -1040, 1880, -1040, 1880, -760, 1817,
      -760, 1801, -796, 1784, -833, 1757, -878, 1719, -913, 1672, -938, 1625,
      -955, 1587, -967, 1558, -977, 1532, -987, 1480, -1040,
    ],
    moisture: 0.36,
  },
  {
    poly: [
      1809, -906, 1804, -941, 1800, -955, 1784, -946, 1772, -967, 1778, -971,
      1759, -996, 1722, -982, 1711, -971, 1712, -956, 1711, -940, 1718, -917,
      1754, -886, 1772, -883, 1785, -881, 1802, -888,
    ],
    moisture: 0.15,
  },
];
