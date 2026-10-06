import type { Corner } from './frame';
import { quad, rect, SOUTH_FIELD } from './trace';

/**
 * The south side's building footprints (site metres, see frame.ts). `SOUTH_OSM` are the OSM outlines: only the placeholder
 * buildings under them are hidden now. The buildings themselves are traced from the satellite image.
 */

/** OSM outlines (south side, west to east) as the placeholder buildings have them: hidden under the new lots. */
export const SOUTH_OSM: Record<
  'south 1' | 'south 2' | 'south 3' | 'south 4' | 'south 6',
  Corner[]
> = {
  'south 1': [
    [-151.9, 52],
    [-157.7, 73.3],
    [-188.3, 64.4],
    [-182.5, 43.6],
  ],
  'south 2': [
    [-112.9, 48.9],
    [-120.8, 77.7],
    [-141.2, 71.9],
    [-133.2, 43.1],
  ],
  'south 3': [
    [-89.3, 47.6],
    [-99.1, 81.7],
    [-116.4, 76.8],
    [-107.1, 42.7],
  ],
  'south 4': [
    [-58.7, 46.7],
    [-70.2, 87.5],
    [-86.6, 82.6],
    [-75.5, 42.2],
  ],
  'south 6': [
    [32.7, 97.2],
    [11.4, 93.7],
    [18.5, 52.4],
    [39.8, 56],
  ],
};

/**
 * The south buildings' roofs traced from the satellite image (`trace.ts`; south 5's two sheds are in `ROOFS`).
 * South 4 is the main roof only (the lower strip along its east flank is the canopy annex). Corner order as the lot code expects: south 1-4 NE, SE, SW, NW; south 6 SE, SW, NW, NE (its street wall NW -> NE).
 */
export const SOUTH_BUILDINGS: Record<
  'south 1' | 'south 2' | 'south 3' | 'south 4' | 'south 6',
  Corner[]
> = {
  'south 1': rect(quad([280, 664], [268, 731], [159, 711], [172, 651])),
  'south 2': rect(quad([421, 654], [417, 760], [332, 746], [352, 652])),
  'south 3': rect(quad([519, 644], [492, 780], [424, 757], [442, 649])),
  'south 4': rect(quad([627, 650], [599, 801], [525, 784], [559, 637])),
  'south 6': rect(quad([972, 818], [895, 815], [916, 668], [1000, 678])),
};

/**
 * Small strips along the south verge that belong to those buildings (OSM slivers 11-15): the placeholder buildings the game placed there are hidden with the rest.
 */
export const SOUTH_STRIPS: Corner[][] = [
  // The field east of south 6 behind the truck yard (no buildings in the image).
  quad(...SOUTH_FIELD),
  [
    [18.1, 53.8],
    [18.5, 52.4],
    [26.5, 53.8],
  ],
  [
    [-58.7, 46.7],
    [-60.9, 53.8],
    [-78.7, 53.8],
    [-75.5, 42.2],
  ],
  [
    [-89.3, 47.6],
    [-91.1, 53.8],
    [-110.2, 53.8],
    [-107.1, 42.7],
  ],
  [
    [-112.9, 48.9],
    [-114.2, 53.8],
    [-136.4, 53.8],
    [-133.2, 43.1],
  ],
  [
    [-151.9, 52],
    [-152.3, 53.8],
    [-185.2, 53.8],
    [-182.5, 43.6],
  ],
];
