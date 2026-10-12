import type { MapSizeDef, MapSizeId } from '../sim/types';

/** The three sizes of the Quarry (DETAILS.md "Maps"). */
export const MAP_SIZES: Record<MapSizeId, MapSizeDef> = {
  s: { id: 's', label: 'Small', w: 13, h: 11, maxPlayers: 4 },
  m: { id: 'm', label: 'Medium', w: 17, h: 13, maxPlayers: 6 },
  l: { id: 'l', label: 'Large', w: 23, h: 17, maxPlayers: 8 },
};

export const MAP_SIZE_IDS: readonly MapSizeId[] = ['s', 'm', 'l'];

export const isMapSizeId = (v: string): v is MapSizeId => v in MAP_SIZES;
