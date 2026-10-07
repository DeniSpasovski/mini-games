import type { ItemMap } from '../items/catalog';
import {
  DEFAULT_ANIMAL,
  animalTargetPoints,
  generateAnimalIsland,
} from './animal/generate';
import { generateCity, targetPoints } from './generate';
import { DEFAULT_TOY, generateToyStore, toyTargetPoints } from './toy/generate';
import type { MapData } from './types';

/** Everything the game needs to know about a playable map. DOM-free (tests and the bot use it too). */
export type MapId = 'city' | 'toy' | 'animal';

export interface MapMood {
  /** Sky / fog / background colour (the horizon colour when `skyTop` is set). */
  sky: number;
  /** Colour overhead: outdoor maps get a gradient sky dome from `sky` up to this. Omit indoors. */
  skyTop?: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  /** One line for the map card in the menu. */
  blurb: string;
  /** What a "cleared" map is called in the HUD ("island", "store"). */
  noun: string;
  itemMap: ItemMap;
  /** Total points of every seed (before the clear bonus). */
  points: number;
  generate(seed: number): MapData;
  /** The menu offers a seed stepper ("Island #7"): every seed holds the same points, so one score list covers them all. */
  seeded?: boolean;
  /** Swallow puff colours: dust outdoors, confetti in the store. */
  puffs: 'dust' | 'confetti' | 'fur';
  mood: MapMood;
  /** Menu fly-around camera. */
  aerial: { radius: number; pitchDeg: number };
}

export const MAPS: MapDef[] = [
  {
    id: 'city',
    name: 'City Island',
    blurb: 'Swallow the city. Trash cans first, skyscrapers last.',
    noun: 'island',
    itemMap: 'city',
    points: targetPoints({ tiles: 10, pointsPerTile: 300 }),
    generate: (seed) => generateCity({ seed }),
    seeded: true,
    puffs: 'dust',
    mood: {
      sky: 0xbfe3f5,
      skyTop: 0x6fb4ea,
      hemiSky: 0xdff1ff,
      hemiGround: 0x7e9b6a,
      sun: 0xfff1d6,
    },
    aerial: { radius: 330, pitchDeg: 36 },
  },
  {
    id: 'toy',
    name: 'Toy Emporium',
    blurb:
      'A giant toy store. Bricks and figures first, then plush, rafts, robots and a store-sized teddy bear.',
    noun: 'store',
    itemMap: 'toy',
    points: toyTargetPoints(DEFAULT_TOY),
    generate: (seed) => generateToyStore({ seed }),
    seeded: true,
    puffs: 'confetti',
    mood: {
      sky: 0xf7e9d2,
      hemiSky: 0xfff6e6,
      hemiGround: 0xe3c7a0,
      sun: 0xfff3dc,
    },
    aerial: { radius: 900, pitchDeg: 40 },
  },
  {
    id: 'animal',
    name: 'Animal Island',
    blurb:
      'Ants first, giant elephants last. Chase the animals, eat the hills, find the secret zoo.',
    noun: 'island',
    itemMap: 'animal',
    points: animalTargetPoints(DEFAULT_ANIMAL),
    generate: (seed) => generateAnimalIsland({ seed }),
    seeded: true,
    puffs: 'fur',
    mood: {
      sky: 0xcfe9d6,
      skyTop: 0x78bde6,
      hemiSky: 0xe3f4ea,
      hemiGround: 0x7f9a58,
      sun: 0xffefcc,
    },
    aerial: { radius: 300, pitchDeg: 36 },
  },
];

export function getMapDef(id: string | null | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
