/**
 * Front fender light-blue area, traced on the car viewer (facets of the vent, the fender ridge and the bottom lines), as atlas
 * texel polygons (flat `x, y` lists; holes by even-odd fill) on the RIGHT side, TOP and REAR charts; `livery.ts` mirrors them to the left side.
 * Baked against the atlas layout in `model.source.json`: re-trace if the charts move.
 */
export const FENDER_POLYS = {
  right: [
    [
      837.5, 566.5, 859.8, 590.5, 898.5, 624, 902.5, 622.2, 905.5, 612.8, 905.2,
      607.8, 900, 600.5, 902.5, 596, 1036, 595.5, 1070.8, 599.8, 1097, 581.5,
      1095.5, 578.8, 1059, 571.2, 988.2, 565, 929.5, 565, 921.2, 569, 889.2,
      564,
    ],
  ],
  top: [
    [
      259, 830.5, 259.5, 842.8, 267.2, 844.8, 455, 844.8, 458.8, 840.5, 450,
      828.5, 434, 817, 400, 823, 363.2, 817, 304.2, 817, 263.8, 825.5,
    ],
  ],
  rear: [
    [
      1050.5, 1514, 1051.2, 1516.5, 1057.8, 1524.2, 1058.2, 1527.2, 1062.2,
      1528.5, 1075.5, 1543.2, 1076.2, 1542.2, 1072.5, 1537.2, 1055.5, 1518.2,
    ],
  ],
} as const;
