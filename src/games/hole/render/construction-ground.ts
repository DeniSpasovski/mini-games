import {
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import { Mesher } from '../items/kit';
import { SITE_COLORS } from '../map/construction/generate';
import type { MapData, ZoneInfo } from '../map/types';
import {
  applyHoleCut,
  createGroundMaterial,
  getItemMaterials,
} from './materials';
import { Soup } from './soup';
import { SIGN_Y, signMaterial, textTexture } from './toy-signs';

/** Level of the ground outside the fence (below the site, so the hoarding stands on something). */
export const OUTSIDE_Y = -0.9;

const CAP = 0xf4f1ea;
const POST = 0x6e543b;
const HOARD_H = 7;
const LOW_H = 1.6;
const T = 0.6;
const GATE_HALF = 10;

/** Hoarding: plywood panels in alternating site colours with a white cap; low on the camera side, gate at x = 0. */
function buildHoarding(hx: number, hz: number): Mesher {
  const m = new Mesher();
  const panel = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    i: number,
  ) => {
    m.box(x, 0, z, w, h, d, SITE_COLORS.hoarding[i % 2]);
    m.box(x, h, z, w + 0.2, 0.3, d + 0.2, CAP);
  };
  const PW = 12;
  // north, west, east: tall
  for (let i = 0, x = -hx; x < hx - 0.1; i++, x += PW)
    panel(x + PW / 2, -hz - T / 2, PW, T, HOARD_H, i);
  for (const s of [-1, 1])
    for (let i = 0, z = -hz; z < hz - 0.1; i++, z += PW)
      panel(s * (hx + T / 2), z + PW / 2, T, PW, HOARD_H, i);
  // south: low, with the gate gap; posts frame it and a header spans it
  for (const s of [-1, 1])
    for (let i = 0, x = GATE_HALF; x < hx; i++, x += PW) {
      const w = Math.min(PW, hx - x);
      panel(s * (x + w / 2), hz + T / 2, w, T, LOW_H, i);
    }
  for (const s of [-1, 1]) {
    m.box(s * GATE_HALF, 0, hz + T / 2, 1.2, 8.6, 1.2, POST);
    m.box(s * GATE_HALF, 2.4, hz + T / 2, 1.4, 0.8, 1.4, 0xf2c230);
  }
  m.box(0, 7.4, hz + T / 2, 2 * GATE_HALF + 1.2, 1.4, 1.0, POST);
  m.box(0, 8.8, hz + T / 2, 2 * GATE_HALF + 1.6, 0.3, 1.2, CAP);
  return m;
}

/**
 * Ground for Construction City: the map's flat rects over a dirt base with a 10 m checker, a skirt under
 * the fence, the plane outside, the hoarding (non-edible, item material) and painted district names.
 * All ground uses the stencil-cut material, so the hole opens through it.
 */
export function buildConstructionGround(map: MapData): Group {
  const group = new Group();
  const { hx, hz } = map.bounds ?? { hx: 270, hz: 210 };

  const ground = new Soup();
  ground.flat(-hx, -hz, hx, hz, 0, SITE_COLORS.dirt);
  const size = 10;
  for (let gx = -Math.ceil(hx / size); gx < Math.ceil(hx / size); gx++)
    for (let gz = -Math.ceil(hz / size); gz < Math.ceil(hz / size); gz++)
      if ((gx + gz) % 2 !== 0)
        ground.flat(
          gx * size,
          gz * size,
          gx * size + size,
          gz * size + size,
          0.004,
          SITE_COLORS.dirtAlt,
        );
  // rects of equal height are drawn in order; sort so lower ones never cover higher ones
  for (const r of [...map.rects].sort((a, b) => a.y - b.y))
    ground.flat(r.x0, r.z0, r.x1, r.z1, r.y, r.color);
  const mesh = new Mesh(ground.geometry(), createGroundMaterial());
  mesh.receiveShadow = true;
  group.add(mesh);

  const skirt = new Soup();
  const d = -2.6;
  for (const [x0, z0, x1, z1] of [
    [-hx, -hz, hx, -hz],
    [hx, -hz, hx, hz],
    [hx, hz, -hx, hz],
    [-hx, hz, -hx, -hz],
  ]) {
    skirt.tri(
      [x0, 0.008, z0],
      [x1, 0.008, z1],
      [x1, d, z1],
      SITE_COLORS.dirtAlt,
    );
    skirt.tri([x0, 0.008, z0], [x1, d, z1], [x0, d, z0], SITE_COLORS.dirtAlt);
  }
  group.add(
    new Mesh(
      skirt.geometry(),
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    ),
  );

  const outside = new Mesh(
    new PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    applyHoleCut(new MeshLambertMaterial({ color: 0x9a7b58 })),
  );
  outside.position.y = OUTSIDE_Y;
  group.add(outside);

  const fence = new Mesh(
    buildHoarding(hx, hz).build(),
    getItemMaterials().prop,
  );
  fence.castShadow = true;
  fence.receiveShadow = true;
  group.add(fence);

  // district names painted on the ground, once per district (its biggest plot), near the south edge
  const biggest = new Map<string, ZoneInfo>();
  for (const z of map.zones ?? []) {
    const cur = biggest.get(z.name);
    if (
      !cur ||
      (z.x1 - z.x0) * (z.z1 - z.z0) > (cur.x1 - cur.x0) * (cur.z1 - cur.z0)
    )
      biggest.set(z.name, z);
  }
  for (const z of biggest.values()) {
    const zw = z.x1 - z.x0;
    const zd = z.z1 - z.z0;
    const w = Math.max(30, Math.min(zw * 0.55, zd * 1.4, 90));
    const h = w / 4;
    const tex = textTexture(
      z.name.toUpperCase(),
      '#ffffff',
      null,
      'rgba(0,0,0,0.5)',
    );
    const sign = new Mesh(
      new PlaneGeometry(w, h).rotateX(-Math.PI / 2),
      signMaterial(tex, true),
    );
    sign.position.set((z.x0 + z.x1) / 2, SIGN_Y, z.z1 - h * 0.7 - 6);
    sign.renderOrder = 2;
    group.add(sign);
  }
  return group;
}
