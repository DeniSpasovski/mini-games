import type { Builder } from './build-small';
import { Mesher, PAL as C } from './kit';

/**
 * Animal Island's secret zoo, farm and laboratory: fences and cages, barn and sheds, lab buildings,
 * growth vats, the staff and the compound's vehicles. Every builder is `fitted` to its catalog box.
 * Generic design only: no logos or text, a paw print is the lab's mark. Glow parts (`glow`) are
 * the green serum, screens and lamps.
 */
const GLOW = 0x5dff8a;
const LAMP = 0xfff2b0;
const STEEL = 0xaeb4ba;
const STEEL_DARK = 0x6a7076;
const LAB_WHITE = 0xe9eef0;
const TEAL = 0x2f8f8a;
const HAZARD = 0xf2c230;

type F = Mesher;
const fit =
  (fn: (f: F, v: number, w: number, d: number, h: number) => void): Builder =>
  (m, v, w, d, h) =>
    m.fitted(w, d, h, (f) => fn(f, v, w, d, h));
const B: Record<string, Builder> = {};

/** A paw print (pad + 3 toes) on a +Z facing wall, stuck out 1.5 cm. */
function paw(f: F, x: number, y: number, z: number, s: number) {
  f.ball(x, y, z, s * 0.4, s * 0.34, s * 0.12, 0x25282b, { seg: 6, rings: 3 });
  for (const dx of [-0.42, 0, 0.42])
    f.ball(x + dx * s, y + s * 0.55, z, s * 0.14, s * 0.14, s * 0.1, 0x25282b, {
      seg: 6,
      rings: 3,
    });
}

// ------------------------------------------------------------------------------------------ fences, cages
B.fence_wood = fit((f, _v, w, d, h) => {
  for (const x of [-0.45, 0, 0.45])
    f.box(x * w, 0, 0, w * 0.07, h, d * 1.4, C.wood);
  for (const y of [0.35, 0.7])
    f.box(0, y * h, d * 0.2, w, h * 0.12, d * 0.7, 0xb8844f);
});
B.zoo_fence = fit((f, _v, w, d, h) => {
  for (const x of [-0.47, 0.47]) f.box(x * w, 0, 0, w * 0.05, h, d, STEEL_DARK);
  f.box(0, h * 0.9, 0, w * 0.88, h * 0.06, d * 0.8, STEEL_DARK);
  f.box(0, h * 0.02, 0, w * 0.88, h * 0.05, d * 0.8, STEEL_DARK);
  for (let k = 1; k < 9; k++)
    f.box((-0.5 + k / 9) * w, h * 0.08, 0, w * 0.012, h * 0.82, d * 0.5, STEEL);
  f.box(0, h * 0.5, 0, w * 0.88, h * 0.02, d * 0.3, STEEL);
});
B.lab_fence = fit((f, _v, w, d, h) => {
  for (const x of [-0.48, 0.48])
    f.box(x * w, 0, 0, w * 0.06, h, d * 1.5, 0xc9cdd1);
  f.box(0, h * 0.05, 0, w, h * 0.55, d, 0xdfe3e6);
  f.box(0, h * 0.6, 0, w, h * 0.06, d * 1.2, STEEL_DARK);
  f.box(0, h * 0.82, d * 0.1, w * 0.92, h * 0.025, d * 0.2, GLOW, {
    glow: true,
  });
  f.box(0, h * 0.9, d * 0.1, w * 0.92, h * 0.025, d * 0.2, GLOW, {
    glow: true,
  });
  for (const x of [-0.48, 0.48])
    f.box(x * w, h * 0.78, 0, w * 0.03, h * 0.2, d * 2.0, STEEL);
});
B.cage_bars = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.06, d * 1.2, STEEL_DARK);
  f.box(0, h * 0.94, 0, w, h * 0.06, d * 1.2, STEEL_DARK);
  for (let k = 0; k < 11; k++)
    f.cyl(
      (-0.5 + (k + 0.5) / 11) * w,
      h * 0.06,
      0,
      d * 0.16,
      d * 0.16,
      h * 0.88,
      5,
      STEEL,
    );
  f.box(0, h * 0.5, 0, w, h * 0.03, d * 0.7, STEEL_DARK);
});

// ------------------------------------------------------------------------------------------ zoo and farm props
B.feed_bucket = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.34, w * 0.5, h, 8, 0x3b82d6);
  f.cyl(0, h * 0.98, 0, w * 0.44, w * 0.44, h * 0.04, 8, 0xe8c070);
  f.box(0, h * 0.9, 0, w * 0.04, h * 0.45, w * 0.7, STEEL_DARK);
});
B.feeding_trough = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.6, d, C.wood);
  f.box(0, h * 0.58, 0, w * 0.88, h * 0.4, d * 0.7, 0xe8c070);
  for (const x of [-0.42, 0.42])
    f.box(x * w, 0, d * 0.54, w * 0.08, h * 0.9, d * 0.12, C.woodDark);
});
B.hay_bale = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h, d, 0xe0c060);
  for (const x of [-0.28, 0.28])
    f.box(x * w, 0, 0, w * 0.04, h * 1.03, d * 1.03, 0x6a5a3a);
  f.ball(w * 0.1, h * 1.0, d * 0.1, w * 0.18, h * 0.08, d * 0.18, 0xd8b850, {
    half: true,
    seg: 6,
    rings: 3,
  });
});
B.beehive = fit((f, _v, w, d, h) => {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.36,
        0,
        sz * d * 0.36,
        w * 0.1,
        h * 0.25,
        d * 0.1,
        C.woodDark,
      );
  f.box(0, h * 0.25, 0, w * 0.9, h * 0.3, d * 0.9, 0xf2c230);
  f.box(0, h * 0.55, 0, w * 0.86, h * 0.25, d * 0.86, 0xe8b020);
  f.ball(0, h * 0.78, 0, w * 0.5, h * 0.22, d * 0.5, 0xd89a20, {
    half: true,
    seg: 8,
    rings: 4,
  });
  f.box(0, h * 0.28, d * 0.46, w * 0.2, h * 0.05, d * 0.03, 0x25282b);
});
B.giant_carrot = fit((f, _v, w, _d, h) => {
  f.cyl(0, h * 0.5, 0, h * 0.5, h * 0.18, w * 0.8, 7, 0xf08a2b, { axis: 'x' });
  f.ball(w * 0.45, h * 0.5, 0, h * 0.5, h * 0.4, h * 0.5, C.leaf, {
    seg: 6,
    rings: 4,
  });
  for (const sz of [-1, 1])
    f.ball(
      w * 0.5,
      h * 0.7,
      sz * h * 0.3,
      h * 0.2,
      h * 0.3,
      h * 0.12,
      C.leafDark,
      { seg: 6, rings: 4 },
    );
});
B.keeper_hut = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.68, d, 0xc9a070, { wall: false });
  f.hip(0, h * 0.68, 0, w * 1.12, d * 1.12, h * 0.32, 0.12, C.roof);
  f.box(w * 0.2, 0, d * 0.505, w * 0.24, h * 0.5, d * 0.02, C.woodDark);
  f.box(-w * 0.2, h * 0.3, d * 0.505, w * 0.2, h * 0.2, d * 0.02, C.glass);
});
B.zoo_shed = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.65, d, 0xb8744a);
  f.gable(
    0,
    h * 0.65,
    0,
    w * 1.1,
    d * 1.15,
    h * 0.35,
    0x6a7076,
    false,
    0xb8744a,
  );
  f.box(0, 0, d * 0.505, w * 0.3, h * 0.5, d * 0.02, C.woodDark);
});
B.feeding_station = fit((f, _v, w, d, h) => {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.44,
        0,
        sz * d * 0.44,
        w * 0.07,
        h * 0.85,
        d * 0.07,
        C.woodDark,
      );
  f.box(0, h * 0.85, 0, w, h * 0.15, d, 0x8a5a3a);
  f.box(0, h * 0.3, 0, w * 0.7, h * 0.18, d * 0.4, 0xe8c070);
  f.box(0, 0, 0, w * 0.74, h * 0.3, d * 0.44, C.wood);
});
B.barn = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.62, d, 0xc4452f);
  f.gable(
    0,
    h * 0.62,
    0,
    w * 1.06,
    d * 1.1,
    h * 0.38,
    0x8a8f95,
    false,
    0xc4452f,
  );
  f.box(0, 0, d * 0.51, w * 0.3, h * 0.45, d * 0.02, C.white);
  f.box(0, h * 0.04, d * 0.52, w * 0.012, h * 0.4, d * 0.012, 0xc4452f);
  f.box(0, h * 0.7, d * 0.51, w * 0.14, h * 0.14, d * 0.02, C.white);
});
B.aviary = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.52, w * 0.52, h * 0.06, 12, STEEL_DARK);
  f.ball(0, h * 0.06, 0, w * 0.5, h * 0.94, d * 0.5, 0xcfe8f0, {
    half: true,
    seg: 12,
    rings: 8,
  });
  for (const t of [0.35, 0.65]) {
    const r = 0.5 * Math.sqrt(1 - t * t) * 1.025;
    f.cyl(0, h * (0.06 + t * 0.94), 0, w * r, w * r, h * 0.02, 12, STEEL);
  }
});

// ------------------------------------------------------------------------------------------ the laboratory
B.serum_barrel = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.5, w * 0.5, h, 8, 0x4a7a96);
  f.cyl(0, h * 0.4, 0, w * 0.52, w * 0.52, h * 0.16, 8, GLOW, { glow: true });
  f.cyl(0, h * 0.98, 0, w * 0.42, w * 0.42, h * 0.05, 8, STEEL_DARK);
});
B.warning_sign = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.04, w * 0.04, h * 0.75, 5, STEEL_DARK);
  f.xf(
    0,
    h * 0.55,
    0,
    () => f.cyl(0, 0, 0, w * 0.5, w * 0.5, d * 0.5, 3, 0x25282b, { axis: 'z' }),
    0,
    0,
    0,
  );
  f.xf(
    0,
    h * 0.58,
    d * 0.3,
    () => f.cyl(0, 0, 0, w * 0.4, w * 0.4, d * 0.2, 3, HAZARD, { axis: 'z' }),
    0,
    0,
    0,
  );
  paw(f, 0, h * 0.58, d * 0.5, w * 0.1);
});
B.camera_pole = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.22, w * 0.15, h * 0.96, 6, 0x6a7076);
  f.box(w * 0.25, h * 0.9, 0, w * 0.9, h * 0.08, w * 0.4, 0x3a3f45);
  f.ball(w * 0.72, h * 0.95, 0, w * 0.1, w * 0.1, w * 0.1, 0xff3a3a, {
    glow: true,
    seg: 6,
    rings: 3,
  });
});
B.lab_cart = fit((f, _v, w, d, h) => {
  f.box(0, h * 0.3, 0, w, h * 0.12, d, 0xd94a3a, { paint: true });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.cyl(
        sx * w * 0.38,
        h * 0.12,
        sz * d * 0.42,
        h * 0.12,
        h * 0.12,
        d * 0.12,
        6,
        0x25282b,
        { axis: 'z' },
      );
  f.box(-w * 0.46, h * 0.42, 0, w * 0.06, h * 0.58, d * 0.9, STEEL);
  for (let k = 0; k < 4; k++)
    f.cyl(
      (-0.25 + k * 0.17) * w,
      h * 0.42,
      0,
      w * 0.04,
      w * 0.04,
      h * 0.3,
      5,
      GLOW,
      { glow: true },
    );
});
B.lab_crate = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h, d, 0xd8d2c0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.46,
        0,
        sz * d * 0.46,
        w * 0.1,
        h * 1.02,
        d * 0.1,
        STEEL_DARK,
      );
  paw(f, 0, h * 0.35, d * 0.5, w * 0.16);
});
B.lab_desk = fit((f, _v, w, d, h) => {
  f.box(0, h * 0.55, 0, w, h * 0.08, d, 0xe9eef0);
  for (const sx of [-1, 1])
    f.box(sx * w * 0.44, 0, 0, w * 0.06, h * 0.55, d * 0.9, STEEL);
  f.box(0, h * 0.63, -d * 0.1, w * 0.4, h * 0.35, d * 0.06, 0x25282b);
  f.box(0, h * 0.67, -d * 0.06, w * 0.34, h * 0.27, d * 0.015, GLOW, {
    glow: true,
  });
});
B.growth_vat = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.5, w * 0.5, h * 0.12, 10, STEEL_DARK);
  f.cyl(0, h * 0.12, 0, w * 0.42, w * 0.42, h * 0.72, 10, 0x2a9a5a, {
    glow: true,
  });
  f.cyl(0, h * 0.84, 0, w * 0.48, w * 0.48, h * 0.1, 10, STEEL_DARK);
  f.ball(0, h * 0.94, 0, w * 0.22, h * 0.06, w * 0.22, 0xf0a0a8, {
    half: true,
    seg: 8,
    rings: 4,
  });
  f.cyl(w * 0.55, 0, 0, w * 0.05, w * 0.05, h * 0.8, 5, STEEL);
});
B.growth_chamber = fit((f, _v, w, _d, h) => {
  f.cyl(0, 0, 0, w * 0.5, w * 0.5, h * 0.1, 12, STEEL_DARK);
  f.cyl(0, h * 0.1, 0, w * 0.42, w * 0.42, h * 0.6, 12, 0x2a9a5a, {
    glow: true,
  });
  f.ball(0, h * 0.7, 0, w * 0.44, h * 0.3, w * 0.44, STEEL, {
    half: true,
    seg: 12,
    rings: 6,
  });
  for (const a of [0.5, 2.6, 4.6])
    f.cyl(
      Math.cos(a) * w * 0.52,
      0,
      Math.sin(a) * w * 0.52,
      w * 0.05,
      w * 0.05,
      h * 0.75,
      5,
      STEEL,
    );
});
B.container = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h, d, 0xd94a3a, { paint: true });
  for (let k = 0; k < 9; k++)
    f.box(
      (-0.46 + k * 0.115) * w,
      h * 0.04,
      d * 0.5,
      w * 0.03,
      h * 0.9,
      d * 0.03,
      0xc8452f,
    );
  f.box(w * 0.5, h * 0.05, 0, w * 0.02, h * 0.9, d * 0.7, STEEL);
});
B.lab_generator = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.7, d, 0x6a7076);
  f.cyl(w * 0.3, h * 0.7, 0, d * 0.12, d * 0.1, h * 0.3, 6, STEEL_DARK);
  f.box(-w * 0.2, h * 0.2, d * 0.505, w * 0.4, h * 0.3, d * 0.02, GLOW, {
    glow: true,
  });
});
B.satellite_dish = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.06, w * 0.05, h * 0.55, 6, STEEL_DARK);
  f.xf(
    0,
    h * 0.62,
    0,
    () =>
      f.ball(0, 0, 0, w * 0.5, h * 0.18, d * 0.5, LAB_WHITE, {
        half: true,
        seg: 10,
        rings: 4,
      }),
    0,
    0,
    0.9,
  );
  f.cyl(w * 0.18, h * 0.8, 0, w * 0.02, w * 0.02, h * 0.18, 4, STEEL_DARK);
});
B.watchtower = fit((f, _v, w, d, h) => {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.box(
        sx * w * 0.38,
        0,
        sz * d * 0.38,
        w * 0.08,
        h * 0.7,
        d * 0.08,
        0x6a7076,
      );
  f.box(0, h * 0.7, 0, w, h * 0.12, d, 0x8a8f95);
  f.box(0, h * 0.82, 0, w * 0.8, h * 0.1, d * 0.8, 0xdfe3e6);
  f.hip(0, h * 0.92, 0, w * 1.0, d * 1.0, h * 0.08, 0.2, TEAL);
  f.box(0, h * 0.85, d * 0.41, w * 0.5, h * 0.05, d * 0.02, GLOW, {
    glow: true,
  });
  f.ball(w * 0.5, h * 0.88, 0, w * 0.1, h * 0.04, w * 0.1, LAMP, {
    glow: true,
    seg: 6,
    rings: 3,
  });
});
B.greenhouse = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.6, d, 0xcfe8f0, { wall: true });
  f.gable(
    0,
    h * 0.6,
    0,
    w * 1.02,
    d * 1.02,
    h * 0.4,
    0xb0d8e8,
    false,
    0xcfe8f0,
  );
  f.box(0, h * 0.02, 0, w * 1.02, h * 0.06, d * 1.02, STEEL_DARK);
  for (const x of [-0.25, 0.1, 0.35])
    f.ball(x * w, h * 0.05, 0, w * 0.1, h * 0.4, d * 0.18, 0x3c8a3e, {
      seg: 6,
      rings: 4,
    });
});
B.lab_dome = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.5, w * 0.5, h * 0.35, 12, LAB_WHITE);
  f.ball(0, h * 0.35, 0, w * 0.5, h * 0.65, d * 0.5, 0xf4f6f6, {
    half: true,
    seg: 12,
    rings: 8,
  });
  f.box(0, h * 0.12, d * 0.505, w * 0.18, h * 0.22, d * 0.03, STEEL_DARK);
  f.box(0, h * 0.22, d * 0.5, w * 0.6, h * 0.04, d * 0.08, GLOW, {
    glow: true,
  });
});
B.lab_block = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h, d, LAB_WHITE, { wall: true });
  f.box(0, h, 0, w * 0.96, h * 0.04, d * 0.96, STEEL_DARK);
  f.box(w * 0.22, h * 1.04, 0, w * 0.26, h * 0.12, d * 0.3, STEEL);
  f.box(-w * 0.1, h * 0.0, d * 0.505, w * 0.14, h * 0.2, d * 0.02, TEAL);
});
B.lab_wing = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.7, d, LAB_WHITE, { wall: true });
  f.box(0, h * 0.7, 0, w * 0.98, h * 0.06, d * 0.98, STEEL_DARK);
  f.box(-w * 0.2, h * 0.76, 0, w * 0.3, h * 0.24, d * 0.5, STEEL);
  f.box(0, h * 0.62, d * 0.505, w * 0.9, h * 0.05, d * 0.02, GLOW, {
    glow: true,
  });
  f.box(w * 0.3, h * 0.76, d * 0.1, w * 0.12, h * 0.18, w * 0.12, TEAL);
});
B.lab_hangar = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.7, d, 0x9aa4ac);
  f.gable(
    0,
    h * 0.7,
    0,
    w * 1.03,
    d * 1.03,
    h * 0.3,
    STEEL_DARK,
    false,
    0x9aa4ac,
  );
  f.box(0, 0, d * 0.51, w * 0.6, h * 0.6, d * 0.02, 0x4a5258);
  f.box(w * 0.2, 0, d * 0.53, w * 0.2, h * 0.6, d * 0.02, 0x2a3036);
  f.box(w * 0.22, 0, d * 0.62, w * 0.18, h * 0.3, d * 0.16, 0xd8d2c0);
  paw(f, w * 0.22, h * 0.12, d * 0.71, w * 0.03);
  f.box(0, h * 0.62, d * 0.52, w * 0.6, h * 0.04, d * 0.02, GLOW, {
    glow: true,
  });
});
B.biodome = fit((f, _v, w, d, h) => {
  f.cyl(0, 0, 0, w * 0.52, w * 0.52, h * 0.1, 14, LAB_WHITE, { wall: true });
  f.ball(0, h * 0.1, 0, w * 0.5, h * 0.9, d * 0.5, 0xbfe4d8, {
    half: true,
    seg: 14,
    rings: 8,
  });
  for (const t of [0.3, 0.6]) {
    const r = 0.5 * Math.sqrt(1 - t * t) * 1.025;
    f.cyl(0, h * (0.1 + t * 0.9), 0, w * r, w * r, h * 0.02, 14, STEEL);
  }
});
B.lab_tower = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.12, d, 0x6a7076);
  f.box(0, h * 0.12, 0, w * 0.5, h * 0.62, d * 0.5, 0xc9cdd1, {
    wall: true,
    taper: 0.45,
  });
  for (const y of [0.3, 0.52, 0.72])
    f.box(
      0,
      y * h,
      0,
      w * (0.66 - y * 0.3),
      h * 0.025,
      d * (0.66 - y * 0.3),
      STEEL_DARK,
    );
  f.box(0, h * 0.72, 0, w * 0.12, h * 0.2, d * 0.12, 0xc9cdd1);
  f.cyl(0, h * 0.9, 0, w * 0.015, w * 0.008, h * 0.1, 4, STEEL_DARK);
  f.ball(0, h * 0.98, 0, w * 0.06, w * 0.06, w * 0.06, 0xff3a3a, {
    glow: true,
    seg: 6,
    rings: 3,
  });
});
B.growth_reactor = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.12, d, 0x6a7076);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    f.ball(
      Math.cos(a) * w * 0.34,
      h * 0.55 + Math.sin(a) * h * 0.34,
      0,
      w * 0.1,
      h * 0.1,
      d * 0.14,
      k % 2 ? STEEL : LAB_WHITE,
      { seg: 6, rings: 4 },
    );
  }
  f.ball(0, h * 0.55, 0, w * 0.2, h * 0.2, d * 0.2, GLOW, {
    glow: true,
    seg: 10,
    rings: 6,
  });
  for (const sx of [-1, 1])
    f.box(sx * w * 0.45, h * 0.12, 0, w * 0.06, h * 0.45, d * 0.25, STEEL_DARK);
  f.cyl(0, h * 0.55, d * 0.1, w * 0.04, w * 0.04, d * 0.5, 6, GLOW, {
    axis: 'z',
    glow: true,
  });
});
B.lab_hq = fit((f, _v, w, d, h) => {
  f.box(0, 0, 0, w, h * 0.34, d, LAB_WHITE, { wall: true });
  f.box(0, h * 0.34, 0, w * 0.72, h * 0.3, d * 0.72, LAB_WHITE, { wall: true });
  f.box(0, h * 0.64, 0, w * 0.46, h * 0.28, d * 0.46, 0xc9cdd1, { wall: true });
  f.ball(0, h * 0.92, 0, w * 0.2, h * 0.08, d * 0.22, LAB_WHITE, {
    half: true,
    seg: 10,
    rings: 4,
  });
  f.box(0, h * 0.34, 0, w * 1.02, h * 0.03, d * 1.02, STEEL_DARK);
  f.box(0, h * 0.64, 0, w * 0.74, h * 0.03, d * 0.74, STEEL_DARK);
  f.box(0, h * 0.12, d * 0.505, w * 0.3, h * 0.12, d * 0.02, GLOW, {
    glow: true,
  });
  f.cyl(w * 0.1, h * 0.92, 0, w * 0.01, w * 0.006, h * 0.12, 4, STEEL_DARK);
  paw(f, 0, h * 0.5, d * 0.37, w * 0.045);
});

// ------------------------------------------------------------------------------------------ people
function person(
  f: F,
  coat: number,
  trousers: number,
  hat: number | null,
  paint: boolean,
  w: number,
  d: number,
  h: number,
) {
  f.box(-w * 0.2, 0, 0, w * 0.26, h * 0.45, d * 0.34, trousers);
  f.box(w * 0.2, 0, 0, w * 0.26, h * 0.45, d * 0.34, trousers);
  f.box(0, h * 0.45, 0, w * 0.82, h * 0.34, d * 0.62, coat, { paint });
  for (const sx of [-1, 1])
    f.box(sx * w * 0.5, h * 0.46, 0, w * 0.18, h * 0.32, d * 0.3, coat, {
      paint,
    });
  f.ball(0, h * 0.8, 0, w * 0.26, h * 0.12, d * 0.4, 0xf0c49a, {
    seg: 8,
    rings: 5,
  });
  if (hat !== null)
    f.ball(0, h * 0.9, 0, w * 0.3, h * 0.06, d * 0.45, hat, {
      half: true,
      seg: 8,
      rings: 3,
    });
  else
    f.ball(0, h * 0.9, -d * 0.04, w * 0.27, h * 0.06, d * 0.42, 0x4b3425, {
      half: true,
      seg: 8,
      rings: 3,
    });
}
B.scientist = fit((f, _v, w, d, h) => {
  person(f, 0xf4f1ea, 0x3a4f6a, null, true, w, d, h);
  f.box(w * 0.5, h * 0.4, d * 0.2, w * 0.12, h * 0.16, d * 0.3, 0x3b82d6);
});
B.zookeeper = fit((f, _v, w, d, h) => {
  person(f, 0xb8a070, 0x6a5a3a, 0x8a7a50, true, w, d, h);
  f.box(-w * 0.5, h * 0.24, d * 0.2, w * 0.2, h * 0.14, d * 0.2, 0x3b82d6);
});

// ------------------------------------------------------------------------------------------ vehicles
B.research_jeep = fit((f, _v, w, d, h) => {
  f.box(0, h * 0.2, 0, w * 0.94, h * 0.35, d * 0.9, 0xf2f2f2, { paint: true });
  f.box(-w * 0.1, h * 0.55, 0, w * 0.5, h * 0.3, d * 0.8, 0xf2f2f2, {
    paint: true,
  });
  f.box(-w * 0.1, h * 0.6, 0, w * 0.46, h * 0.2, d * 0.84, C.glass);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      f.cyl(
        sx * w * 0.32,
        h * 0.2,
        sz * d * 0.46,
        h * 0.2,
        h * 0.2,
        d * 0.14,
        8,
        0x25282b,
        { axis: 'z' },
      );
  f.box(-w * 0.1, h * 0.85, 0, w * 0.5, h * 0.06, d * 0.7, TEAL);
  f.ball(w * 0.48, h * 0.4, d * 0.28, h * 0.06, h * 0.06, h * 0.06, LAMP, {
    glow: true,
    seg: 6,
    rings: 3,
  });
  f.ball(w * 0.48, h * 0.4, -d * 0.28, h * 0.06, h * 0.06, h * 0.06, LAMP, {
    glow: true,
    seg: 6,
    rings: 3,
  });
});
B.transport_truck = fit((f, _v, w, d, h) => {
  f.box(-w * 0.1, h * 0.18, 0, w * 0.74, h * 0.1, d * 0.95, 0x6a7076);
  f.box(w * 0.36, h * 0.18, 0, w * 0.22, h * 0.62, d * 0.92, 0xf2f2f2);
  f.box(w * 0.42, h * 0.5, 0, w * 0.12, h * 0.26, d * 0.9, C.glass);
  for (const x of [-0.42, 0.1, 0.34])
    for (const sz of [-1, 1])
      f.cyl(
        x * w,
        h * 0.16,
        sz * d * 0.46,
        h * 0.16,
        h * 0.16,
        d * 0.1,
        8,
        0x25282b,
        { axis: 'z' },
      );
  f.ball(-w * 0.12, h * 0.5, 0, w * 0.2, h * 0.2, d * 0.28, 0x8a6a4a, {
    seg: 8,
    rings: 5,
  });
  f.ball(0, h * 0.62, 0, w * 0.08, h * 0.12, d * 0.14, 0x8a6a4a, {
    seg: 8,
    rings: 4,
  });
  for (let k = 0; k < 8; k++)
    f.cyl(
      -w * 0.44 + k * w * 0.095,
      h * 0.28,
      d * 0.46,
      w * 0.012,
      w * 0.012,
      h * 0.62,
      4,
      STEEL,
    );
  f.box(-w * 0.1, h * 0.9, 0, w * 0.72, h * 0.04, d * 0.94, STEEL_DARK);
});
B.helicopter = fit((f, _v, w, d, h) => {
  f.ball(w * 0.05, h * 0.5, 0, w * 0.26, h * 0.3, d * 0.34, 0xf2f2f2, {
    seg: 10,
    rings: 6,
  });
  f.ball(w * 0.18, h * 0.55, 0, w * 0.12, h * 0.16, d * 0.35, C.glass, {
    seg: 8,
    rings: 5,
  });
  f.cyl(-w * 0.4, h * 0.55, 0, d * 0.06, d * 0.03, w * 0.5, 6, 0xf2f2f2, {
    axis: 'x',
  });
  f.box(-w * 0.62, h * 0.55, 0, w * 0.03, h * 0.3, d * 0.04, TEAL);
  f.cyl(0, h * 0.78, 0, d * 0.03, d * 0.03, h * 0.1, 5, STEEL_DARK);
  f.box(0, h * 0.88, 0, w * 0.9, h * 0.025, d * 0.07, 0x3a3f45);
  f.box(0, h * 0.9, 0, d * 0.07, h * 0.025, w * 0.9, 0x3a3f45);
  for (const sz of [-1, 1]) {
    f.box(w * 0.05, 0, sz * d * 0.34, w * 0.5, h * 0.04, d * 0.04, STEEL_DARK);
    f.box(
      w * 0.02,
      h * 0.04,
      sz * d * 0.3,
      d * 0.04,
      h * 0.2,
      d * 0.04,
      STEEL_DARK,
    );
    f.box(
      w * 0.14,
      h * 0.04,
      sz * d * 0.3,
      d * 0.04,
      h * 0.2,
      d * 0.04,
      STEEL_DARK,
    );
  }
});

export const ZOO_BUILDERS: Record<string, Builder> = B;
