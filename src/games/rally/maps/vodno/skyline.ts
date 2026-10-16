import type { SkylineBuilding } from '../shared/types';

/**
 * Skopje's tall buildings that stand out from Vodno, beyond the baked 6 x 4 km (MapDef.skyline, drawn with the horizon,
 * world/horizon.ts). Footprints, heights and floor counts from OpenStreetMap (the baker's projection); only the shapes
 * are used, the facades are generic (a light wall band and a glass band per floor).
 */

/**
 * Cevahir Sky City (Srbija Boulevard, Aerodrom, 2020): four residential slabs of 42 floors, 136 m (OSM ways 604418672 A,
 * 604418675 B, 604418674 C, 604418673 D), and the two-storey Cevahir Mall at their foot (way 1289766262).
 */
const SKY_CITY: SkylineBuilding[] = [
  {
    name: 'Cevahir tower A',
    footprint: [
      5097.6, -852.1, 5102.2, -857.4, 5137, -890.1, 5144.4, -882.5, 5139.7,
      -878.1, 5140.7, -877.1, 5142.3, -874.8, 5143.3, -872, 5143.3, -869.1,
      5142.4, -866.3, 5140.5, -863.7, 5124, -847.9, 5121.4, -846.1, 5118.5,
      -845.2, 5115.6, -845.3, 5112.8, -846.4, 5110.6, -848, 5109.6, -849.1,
      5105, -844.6,
    ],
    height: 136,
    floors: 42,
    wall: '#dcd9d2',
    glass: '#566b82',
  },
  {
    name: 'Cevahir tower B',
    footprint: [
      5172, -893.8, 5226.6, -888.6, 5225.6, -878.1, 5219.2, -878.7, 5219,
      -877.3, 5218.3, -874.7, 5216.8, -872.2, 5214.6, -870.2, 5211.9, -869.1,
      5208.6, -868.9, 5185.8, -871, 5182.7, -871.9, 5180.2, -873.5, 5178.4,
      -875.8, 5177.4, -878.6, 5177.2, -881.3, 5177.4, -882.7, 5171, -883.3,
    ],
    height: 136,
    floors: 42,
    wall: '#dcd9d2',
    glass: '#566b82',
  },
  {
    name: 'Cevahir tower C',
    footprint: [
      5220.4, -920.6, 5274.9, -914.5, 5276.1, -924.9, 5269.6, -925.6, 5269.8,
      -927, 5269.7, -929.8, 5268.7, -932.5, 5266.9, -934.9, 5264.5, -936.5,
      5261.4, -937.4, 5238.6, -940, 5235.4, -939.8, 5232.7, -938.7, 5230.4,
      -936.8, 5228.8, -934.3, 5228.1, -931.7, 5228, -930.3, 5221.5, -931,
    ],
    height: 136,
    floors: 42,
    wall: '#dcd9d2',
    glass: '#566b82',
  },
  {
    name: 'Cevahir tower D',
    footprint: [
      5258.1, -885.6, 5312.7, -880.4, 5311.7, -870, 5305.3, -870.6, 5305.2,
      -869.2, 5304.5, -866.5, 5303, -864, 5300.7, -862.1, 5298, -861, 5294.8,
      -860.7, 5272, -862.9, 5268.8, -863.7, 5266.4, -865.3, 5264.5, -867.6,
      5263.5, -870.4, 5263.4, -873.1, 5263.5, -874.5, 5257.1, -875.1,
    ],
    height: 136,
    floors: 42,
    wall: '#dcd9d2',
    glass: '#566b82',
  },
  {
    name: 'Cevahir Mall',
    footprint: [
      5154.1, -860.6, 5153.2, -851.3, 5140.1, -838.2, 5139.2, -828.1, 5248.3,
      -792.8, 5256.4, -792.9, 5264.3, -794.8, 5271.9, -798.7, 5284, -809,
      5293.1, -818.4, 5301, -826.7, 5311.9, -837.7, 5312, -840.6, 5310.1,
      -842.8,
    ],
    height: 12,
    floors: 2,
    wall: '#cfc8bb',
    glass: '#6c7b8a',
    roof: '#9b968c',
  },
];

/**
 * The Macedonian Radio Television centre (Goce Delchev Boulevard, 1984): the 25-floor, 70 m tower at the west end of the
 * complex and the low wings beside it (OSM way 35867931, split at the tower; the tower's position from Wikipedia).
 */
const MRT: SkylineBuilding[] = [
  {
    name: 'MRT tower',
    footprint: [
      3424.3, -2773.6, 3477.3, -2775.9, 3478.8, -2739.8, 3425.9, -2737.3,
    ],
    height: 70,
    floors: 25,
    wall: '#bdb9ad',
    glass: '#3f4b57',
    roof: '#8f8c85',
  },
  {
    name: 'MRT wings',
    footprint: [
      3477.3, -2775.9, 3475.5, -2816.1, 3502.1, -2817.3, 3535.4, -2819.1,
      3536.7, -2793.8, 3580.2, -2796.1, 3580.4, -2792, 3584.9, -2792.3, 3587.1,
      -2752.6, 3581, -2752.2, 3581.5, -2742.5, 3501.6, -2738.6, 3502, -2729.9,
      3479.3, -2728.9, 3478.8, -2739.8,
    ],
    height: 22,
    floors: 6,
    wall: '#bdb9ad',
    glass: '#4a5560',
  },
];

export const SKYLINE: SkylineBuilding[] = [...SKY_CITY, ...MRT];
