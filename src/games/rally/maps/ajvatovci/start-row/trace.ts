import { backFenceZ, ORIGIN, roadZ, SOUTH_FENCE, type Corner } from './frame';

/**
 * The start row traced from a satellite image (north up, 2000 x 1073 px, the user's screenshot
 * `ref-15-satellite-start-row.webp` in `sources/maps/ajvatovci/`; the labelled twin is ref-14, the
 * western part is ref-16). Everything in this file is in image pixels and converted with `px()`.
 *
 * Calibration: world x = X0 + px * S, world z = Z0 + py * S. Fitted so the baked stage road lies on
 * the middle of the asphalt (it turns north exactly at the country road at the east end of the image)
 * - the road drawn in the data is ~3.5 m north of where the buildings fit (their OSM footprints land
 * on the roofs at Z0 = 254), and spacing to the road matters most in the game, so the buildings follow
 * the road: Z0 = 251.5. About 0.5 m accuracy in the middle of the row.
 */
const X0 = -1425;
const Z0 = 251.5;
const S = 0.271;

/** Image pixel -> site metres (the frame of `frame.ts`). */
export const px = (x: number, y: number): Corner => [
  X0 + x * S - ORIGIN.x,
  Z0 + y * S - ORIGIN.z,
];

/**
 * A traced outline made a true rectangle (parallel walls, right angles): the orientation is the mean of the four
 * edges, the size their mean extent, the centre the centroid; each corner keeps its place in the list.
 */
export const rect = (corners: Corner[]): Corner[] => {
  let sin = 0;
  let cos = 0;
  corners.forEach(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % corners.length];
    const a = 4 * Math.atan2(nz - z, nx - x);
    sin += Math.sin(a);
    cos += Math.cos(a);
  });
  const angle = Math.atan2(sin, cos) / 4;
  const u: Corner = [Math.cos(angle), Math.sin(angle)];
  const v: Corner = [-u[1], u[0]];
  const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const cz = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  const local = corners.map(([x, z]) => [
    (x - cx) * u[0] + (z - cz) * u[1],
    (x - cx) * v[0] + (z - cz) * v[1],
  ]);
  const hu = local.reduce((s, p) => s + Math.abs(p[0]), 0) / local.length;
  const hv = local.reduce((s, p) => s + Math.abs(p[1]), 0) / local.length;
  return local.map(([a, b]): Corner => {
    const su = Math.sign(a) * hu;
    const sv = Math.sign(b) * hv;
    return [cx + su * u[0] + sv * v[0], cz + su * u[1] + sv * v[1]];
  });
};

/**
 * The western part of the row traced from the second satellite image (`ref-16-satellite-start-row-west.webp`,
 * 2000 x 1283 px, a little closer than ref-15): its pixels map onto ref-15's by a plain scale + shift, fitted on
 * north 1's lot corner at the street, the back of its west fence and its solar roof's corners (within ~2 px).
 */
const W16 = { x0: 1030, y0: 838, x15: 135, y15: 580, k: 0.93 };
/** ref-16 pixel -> site metres. */
export const px16 = (x: number, y: number): Corner =>
  px(W16.x15 + (x - W16.x0) * W16.k, W16.y15 + (y - W16.y0) * W16.k);
/** A closed outline of ref-16 points -> site corners. */
export const quad16 = (...pts: (readonly [number, number])[]): Corner[] =>
  pts.map(([x, y]) => px16(x, y));
/** Site x of a ref-16 column. */
export const sx16 = (x: number): number => px16(x, 0)[0];

/** Site x of an image column (lot boundaries along the street). */
export const sx = (x: number): number => px(x, 0)[0];

/** A closed outline of image points -> site corners. */
export const quad = (...pts: [number, number][]): Corner[] =>
  pts.map(([x, y]) => px(x, y));

/**
 * The south lots' boundary lines, image points (top, bottom). They lean like the buildings' side walls
 * (about 8-12 degrees, not square to the road), and a line shared by two lots is one fence.
 */
const SOUTH_LINES = {
  west1: [
    [150, 640],
    [132, 850],
  ],
  b12: [
    [349, 636],
    [300, 860],
  ],
  b23: [
    [432, 636],
    [420, 780],
  ],
  b34: [
    [538, 636],
    [505, 790],
  ],
  b45: [
    [729, 636],
    [701, 850],
  ],
  east5: [
    [833, 636],
    [805, 840],
  ],
  west6: [
    [910, 636],
    [888, 790],
  ],
  east6: [
    [1008, 636],
    [1000, 820],
  ],
} as const satisfies Record<
  string,
  readonly [readonly [number, number], readonly [number, number]]
>;

export type SouthLine = keyof typeof SOUTH_LINES;

/** Where a boundary line meets the street fence (`front`) and the back fence along the motorway (`back`). */
export const southEdge = (name: SouthLine): { front: Corner; back: Corner } => {
  const [a, b] = SOUTH_LINES[name].map(([x, y]) => px(x, y));
  const xAt = (z: number) =>
    a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
  const meet = (zOf: (x: number) => number): Corner => {
    let z = a[1];
    for (let n = 0; n < 12; n++) z = zOf(xAt(z));
    return [xAt(z), z];
  };
  return {
    front: meet((x) => roadZ(x, SOUTH_FENCE - 0.4)),
    back: meet(backFenceZ),
  };
};

/**
 * Real roofs of the north row, west to east (corner order NW, NE, SE, SW), and of the two south
 * sheds. These follow the satellite image.
 */
export const ROOFS = {
  /** North 1: warehouse + the lower office strip along its street front. */
  north1: rect(quad([552, 272], [718, 315], [666, 563], [500, 520])),
  /** Car service (workshop) and the red-roofed building behind it. */
  north2: rect(quad([735, 461], [795, 462], [796, 508], [736, 509])),
  north2Annex: rect(quad([742, 386], [796, 387], [796, 408], [743, 408])),
  /** The Mileks building (white walls, cream roof) in the lot of the removed truck repair shop: its roof in the image. */
  mileks: rect(quad([814, 400], [862, 400], [862, 513], [814, 513])),
  /** The glass-fronted showroom, moved one lot west: the roof the Mileks building has in the image. */
  north4: rect(quad([898, 400], [958, 401], [956, 508], [898, 508])),
  /** A generic warehouse on the showroom's old lot (its roof shape is the showroom's). */
  north5: rect(quad([1003, 343], [1086, 339], [1090, 424], [1012, 431])),
  north6: rect(quad([1097, 211], [1190, 213], [1200, 420], [1117, 426])),
  north7: rect(quad([1217, 327], [1266, 326], [1282, 425], [1231, 426])),
  north8: rect(quad([1315, 331], [1395, 331], [1392, 420], [1325, 428])),
  /** Solar roof. */
  north9: rect(quad([1405, 322], [1493, 325], [1497, 418], [1415, 422])),
  /** The villa at the east end (hip roof). */
  north10: rect(quad([1585, 248], [1664, 248], [1664, 322], [1587, 322])),
  /** The villa's gabled house (the south part of its roof) and its single-storey wing behind it (ref-30..36). */
  north10House: rect(quad([1592, 283], [1664, 283], [1664, 322], [1592, 322])),
  north10Wing: rect(quad([1594, 251], [1662, 251], [1662, 280], [1594, 280])),
  /** The bare foundation slab at the back of the lot west of the villa (ref-35, ref-36). */
  slab: rect(quad([1504, 210], [1577, 210], [1577, 249], [1504, 249])),
  /** South side east of south 6 (ref-37..49): the car dealer's container office. */
  dealerOffice: rect(quad([1290, 529], [1313, 529], [1313, 539], [1290, 539])),
  /** The truck yard's grey hall at the back and the red-roofed shed by the street. */
  truckHall: rect(quad([1402, 596], [1474, 598], [1472, 628], [1400, 626])),
  truckShed: rect(quad([1406, 538], [1440, 538], [1440, 586], [1406, 586])),
  /** The old compound behind the field: its red-roofed hall and the white shed beside it. */
  compoundHall: rect(quad([1390, 880], [1494, 882], [1493, 964], [1389, 962])),
  compoundShed: rect(quad([1497, 873], [1533, 873], [1533, 964], [1497, 964])),
  /** The grey sheet-metal shed in the statue yard. */
  statueShed: rect(quad([1551, 897], [1611, 899], [1610, 954], [1550, 952])),
  /** The wholesale mall south-east of the street's end (its hipped red roof). */
  mall: rect(quad([1735, 716], [1920, 770], [1870, 958], [1680, 905])),
  /** The site office cabin of the construction site. */
  siteCabin: rect(quad([748, 330], [772, 330], [772, 341], [748, 341])),
  /** South 5's two sheds: yellow roof at the street (its shaded west part included), red roof behind. */
  south5Front: rect(quad([765, 674], [819, 680], [809, 760], [754, 757])),
  south5Back: rect(quad([751, 760], [805, 762], [799, 815], [744, 807])),
};

/** Image columns of the lot boundaries along the street (shared fences stand on them). */
export const LOT_X = {
  north1: [130, 716],
  /** The construction site's access lane, between north 1 and north 2. */
  site: [716, 734],
  north2: [734, 806],
  mileks: [806, 880],
  north4: [882, 984],
  north5: [987, 1093],
  north6: [1095, 1201],
  north7: [1203, 1302],
  north8: [1304, 1396],
  north9: [1398, 1500],
  /** The lot with the foundation slab, between north 9 and the villa. */
  slab: [1502, 1580],
  /** The villa's lot runs to the east road (the stage road turning north). */
  north10: [1582, 1672],
  /** South side east of south 6. */
  dealer: [1240, 1396],
  truckYard: [1398, 1672],
} as const;

/** The back of each north lot (east end first, then round to the west), image points. */
export const BACK = {
  north1: [
    [716, 126],
    [415, 102],
  ],
  /** The construction site: the lane, then everything east of north 1 behind north 2, the Mileks building and north 4. */
  site: [
    [734, 378],
    [806, 378],
    [880, 378],
    [984, 378],
    [987, 150],
    [716, 126],
  ],
  north2: [
    [806, 378],
    [734, 378],
  ],
  mileks: [
    [880, 378],
    [806, 378],
  ],
  north4: [
    [984, 378],
    [882, 378],
  ],
  north5: [
    [1093, 159],
    [988, 148],
  ],
  north6: [
    [1201, 171],
    [1095, 159],
  ],
  north7: [
    [1302, 183],
    [1203, 171],
  ],
  north8: [
    [1396, 194],
    [1304, 183],
  ],
  north9: [
    [1500, 205],
    [1398, 194],
  ],
  slab: [
    [1580, 205],
    [1502, 205],
  ],
  /** Along the east road's edge up to the back corner. */
  north10: [
    [1680, 384],
    [1686, 300],
    [1680, 243],
    [1582, 243],
  ],
  /** Shallower than the image's lot (user, 2026-10-04): the back fence ~10 m behind the truss slab. */
  dealer: [
    [1396, 592],
    [1240, 592],
  ],
  truckYard: [
    [1686, 668],
    [1398, 642],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

/** Rows of cypress trees along field edges and between lots, image points (start, end). */
export const CYPRESS: [[number, number], [number, number]][] = [
  [
    [732, 614],
    [701, 850],
  ],
  [
    [862, 632],
    [878, 950],
  ],
  [
    [940, 582],
    [1002, 590],
  ],
  /** The cypress in the statue yard. */
  [
    [1623, 905],
    [1625, 911],
  ],
];

/**
 * The three lots west of north 1, toward the roundabout (user, 2026-10-04; ref-16 pixels): the car service next to
 * north 1, the gravel car park, and the factory on the corner with the road north. `street` = ref-16 columns of the
 * frontage (the street line starts at ref-16 x 545, so the factory's west part is wrapped into its back outline),
 * `back` = the rest of the outline from the east end round to the west, buildings as ref-16 outlines.
 */
export const WEST = {
  service: {
    street: [842, 1024],
    back: [
      [1112, 705],
      [1112, 522],
      [880, 522],
      [852, 668],
    ],
    shed: [
      [852, 738],
      [905, 722],
      [918, 768],
      [866, 786],
    ],
    office: [
      [1012, 628],
      [1075, 640],
      [1068, 690],
      [1005, 680],
    ],
  },
  parking: {
    street: [748, 840],
    back: [
      [840, 702],
      [850, 668],
      [730, 838],
    ],
  },
  /** The mast's own triangular lot in the car park's south-west corner, by the street and the start line. */
  mast: {
    street: [682, 748],
    back: [[730, 838]],
    /** The mast's base (its splayed feet), centred in the triangle. */
    base: [
      [710, 872],
      [730, 872],
      [730, 892],
      [710, 892],
    ],
  },
  /**
   * The open gravel between the corner road and the factory's fence, where a few trailers park and the brick sign
   * booth of the economic zone stands by the junction (no fence of its own).
   */
  trailers: {
    street: [546, 640],
    back: [
      [615, 887],
      [440, 715],
      [438, 828],
      [462, 864],
      [510, 893],
    ],
    booth: [
      [448, 740],
      [462, 740],
      [462, 758],
      [448, 758],
    ],
  },
  /**
   * The electric substation west of the corner road (off the street): fence outline, the small house by the road,
   * the switchgear rows and transformers, and the line of portal gantries.
   */
  substation: {
    back: [
      [150, 273],
      [400, 325],
      [398, 495],
      [129, 440],
    ],
    house: [
      [352, 352],
      [386, 357],
      [384, 385],
      [350, 380],
    ],
    gear: [
      [
        [316, 351],
        [336, 353],
        [334, 402],
        [314, 400],
      ],
      [
        [307, 407],
        [323, 409],
        [321, 464],
        [305, 462],
      ],
      [
        [266, 357],
        [291, 360],
        [289, 389],
        [264, 386],
      ],
      [
        [260, 401],
        [285, 404],
        [283, 439],
        [258, 436],
      ],
    ],
    gantry: [
      [216, 301],
      [247, 445],
    ],
  },
  /**
   * Only its entrance reaches the street; the fence then runs straight along the hall's south-west front, parallel to
   * it ~14 m out (user 2026-10-04).
   */
  factory: {
    street: [640, 680],
    back: [
      [850, 665],
      [880, 520],
      [1112, 520],
      [1136, 292],
      [548, 150],
      [452, 196],
      [440, 715],
      [615, 887],
    ],
    /** The three-storey hall at the corner (the big beige roof): a pentagon, its west side along the road. */
    hall: [
      [548, 443],
      [800, 690],
      [650, 845],
      [452, 650],
      [452, 545],
    ],
    /** The white-roofed block north of it, and the long wing north-east of that. */
    north: [
      [548, 232],
      [855, 360],
      [770, 545],
      [462, 418],
    ],
    wing: [
      [790, 245],
      [1135, 330],
      [1110, 505],
      [775, 425],
    ],
  },
} as const;

/** Lots off the street (behind the field south of the street's east end), whole outlines, image points. */
export const BEHIND = {
  compound: [
    [1300, 838],
    [1545, 838],
    [1545, 1028],
    [1300, 1028],
  ],
  statues: [
    [1548, 866],
    [1660, 866],
    [1660, 1000],
    [1548, 1000],
  ],
  mall: [
    [1726, 698],
    [1945, 756],
    [1893, 982],
    [1660, 922],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

/** The field between the truck yard and the lots behind it: the placeholder houses the game put there are hidden. */
export const SOUTH_FIELD: [number, number][] = [
  [1240, 645],
  [1690, 672],
  [1690, 866],
  [1240, 836],
];
