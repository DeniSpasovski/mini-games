import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import { Mesher } from '../items/kit';
import { TOY_COLORS } from '../map/toy/generate';
import type { MapData } from '../map/types';
import {
  applyHoleCut,
  createGroundMaterial,
  getItemMaterials,
} from './materials';
import {
  FLOOR_METRES,
  floorKindOf,
  floorTexture,
  type FloorKind,
} from './toy-floor';
import { buildEntranceSign, buildToySigns } from './toy-signs';

/** Level of the void outside the store (below the floor so the walls stand on something). */
export const VOID_Y = -0.9;

const WALL = 0xf3ead8;
const WALL_TRIM = 0xd9c9a8;
const WINDOW = 0xa9d8f2;
const BUNTING = [0xd94a3a, 0xf2c230, 0x3b82d6, 0x4fa84a, 0xe86aa6, 0xf08a2b];
const RACK = 0x6b7b8c;
const CARTONS = [0xc9a06b, 0xd8b27d, 0xb98a58, 0xe6c795, 0xa9794a];
const WALL_THICKNESS = 3;

/** Flat floor geometry: a triangle list with vertex colours (same recipe as the island ground). */
class Flat {
  private pos: number[] = [];
  private col: number[] = [];
  private c = new Color();

  quad(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    color: number,
  ): void {
    this.c.setHex(color);
    const v: [number, number, number][] = [
      [x0, y, z0],
      [x0, y, z1],
      [x1, y, z1],
      [x0, y, z0],
      [x1, y, z1],
      [x1, y, z0],
    ];
    for (const p of v) {
      this.pos.push(...p);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Vertical face from (x0, z0) to (x1, z1), from y = top down to y = bottom. */
  wall(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    top: number,
    bottom: number,
    color: number,
  ): void {
    this.c.setHex(color);
    const v: [number, number, number][] = [
      [x0, top, z0],
      [x1, top, z1],
      [x1, bottom, z1],
      [x0, top, z0],
      [x1, bottom, z1],
      [x0, bottom, z0],
    ];
    for (const p of v) {
      this.pos.push(...p);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** `metres`: world size of one texture tile; UVs come straight from x / z (the floor is axis aligned). */
  geometry(metres = 0): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    if (metres > 0) {
      const uv: number[] = [];
      for (let i = 0; i < this.pos.length; i += 3)
        uv.push(this.pos[i] / metres, this.pos[i + 2] / metres);
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    }
    g.computeVertexNormals();
    return g;
  }
}

/** Perimeter walls (non-edible): tall on three sides, low on the camera side with an entrance gap. */
function buildWalls(hx: number, hz: number, door = 0): Mesher {
  const m = new Mesher();
  const T = WALL_THICKNESS;
  const H = 11;
  const LOW = 1.4;
  const gap = 14; // half width of the entrance
  // north (far) wall = the stockroom: racks of cartons on the inner face (3 beams, 4 cartons per bay)
  m.box(0, 0, -hz - T / 2, 2 * hx + 2 * T, H, T, WALL);
  m.box(0, H, -hz - T / 2, 2 * hx + 2 * T + 0.8, 0.6, T + 0.8, WALL_TRIM);
  for (let i = 0, x = -hx + 12; x < hx - 12; i++, x += 20) {
    const z = -hz + 0.55;
    for (const px of [-8.2, 8.2]) m.box(x + px, 0, z, 0.5, 9.4, 0.9, RACK);
    for (const [k, y] of [1.2, 4.2, 7.2].entries()) {
      m.box(x, y, z, 17.2, 0.35, 1.0, RACK);
      for (let n = 0; n < 4; n++) {
        const h = 1.6 + ((i * 3 + k * 5 + n * 7) % 3) * 0.45;
        m.box(
          x - 6.45 + n * 4.3,
          y + 0.35,
          z,
          3.9,
          h,
          0.85,
          CARTONS[(i + k * 2 + n) % CARTONS.length],
        );
      }
    }
  }
  // west / east walls
  for (const sx of [-1, 1]) {
    m.box(sx * (hx + T / 2), 0, 0, T, H, 2 * hz, WALL);
    m.box(sx * (hx + T / 2), H, 0, T + 0.8, 0.6, 2 * hz + 0.8, WALL_TRIM);
    m.box(sx * (hx - 0.2), 4.2, 0, 0.4, 2.6, 2 * hz - 6, WINDOW);
    for (let i = 0, z = -hz + 6; z < hz - 6; i++, z += 10)
      m.box(
        sx * (hx - 0.35),
        7.4,
        z,
        0.5,
        2,
        5,
        BUNTING[(i + 2) % BUNTING.length],
      );
  }
  // south (camera) wall: low, with a gap for the doors
  for (const sx of [-1, 1]) {
    // the wall runs from the door pillar out to the corner on each side
    const near = door + sx * gap;
    const far = sx * (hx + T);
    const mid = (near + far) / 2;
    const len = Math.abs(far - near);
    if (len > 0.5) {
      m.box(mid, 0, hz + T / 2, len, LOW, T, WALL);
      m.box(mid, LOW, hz + T / 2, len, 0.3, T + 0.5, WALL_TRIM);
    }
    // door pillars with a colour stripe
    m.box(near, 0, hz + T / 2, 1.6, 8.6, T + 0.6, WALL_TRIM);
    m.box(
      near,
      2.4,
      hz + T / 2,
      1.8,
      0.8,
      T + 0.8,
      sx < 0 ? 0xd94a3a : 0x3b82d6,
    );
  }
  // header over the entrance (the sign hangs on its camera side) with a glass transom band under it
  m.box(door, 5.2, hz + T / 2, 2 * gap, 3.4, T + 0.6, WALL_TRIM);
  m.box(door, 4.4, hz + T / 2, 2 * gap - 1.6, 0.8, 0.5, WINDOW);
  return m;
}

/**
 * Floor + walls for the toy store: a pastel tiled floor with the department mats (the
 * map's flat rects), a skirt under the edge so the hole walls have something to cut
 * through, and the void outside. All floor uses the stencil-cut ground material.
 */
export function buildToyGround(map: MapData): Group {
  const group = new Group();
  const { hx, hz } = map.bounds ?? { hx: 100, hz: 100 };
  // the floor in layers: terrazzo base + checker, one textured mat per department (carpet, foam tiles,
  // waves, studs ...), and the plain painted bits (tape, door mat, guide line)
  const zones = map.zones ?? [];
  const base = new Flat();
  const plain = new Flat();
  const mats = new Map<FloorKind, Flat>();
  base.quad(-hx, -hz, hx, hz, 0, TOY_COLORS.tileA);
  for (const r of map.rects) {
    const zone =
      r.y < 0.02 && r.y > 0.01
        ? zones.find(
            (z) =>
              z.x0 === r.x0 && z.z0 === r.z0 && z.x1 === r.x1 && z.z1 === r.z1,
          )
        : undefined;
    if (zone) {
      const kind = floorKindOf(zone.name);
      let f = mats.get(kind);
      if (!f) mats.set(kind, (f = new Flat()));
      f.quad(r.x0, r.z0, r.x1, r.z1, r.y, r.color);
    } else if (r.y < 0.01) base.quad(r.x0, r.z0, r.x1, r.z1, r.y, r.color);
    else plain.quad(r.x0, r.z0, r.x1, r.z1, r.y, r.color);
  }
  const textured = (flat: Flat, kind: FloorKind) => {
    const mat = createGroundMaterial();
    mat.map = floorTexture(kind);
    const m = new Mesh(flat.geometry(FLOOR_METRES[kind]), mat);
    m.receiveShadow = true;
    group.add(m);
  };
  textured(base, 'terrazzo');
  for (const [kind, f] of mats) textured(f, kind);
  const plainMesh = new Mesh(plain.geometry(), createGroundMaterial());
  plainMesh.receiveShadow = true;
  group.add(plainMesh);

  const skirt = new Flat();
  const d = -2.6;
  skirt.wall(-hx, -hz, hx, -hz, 0.008, d, TOY_COLORS.skirt);
  skirt.wall(hx, -hz, hx, hz, 0.008, d, TOY_COLORS.skirt);
  skirt.wall(hx, hz, -hx, hz, 0.008, d, TOY_COLORS.skirt);
  skirt.wall(-hx, hz, -hx, -hz, 0.008, d, TOY_COLORS.skirt);
  group.add(
    new Mesh(
      skirt.geometry(),
      new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    ),
  );

  const outside = new Mesh(
    new PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    applyHoleCut(new MeshLambertMaterial({ color: 0xe2d6bd })),
  );
  outside.position.y = VOID_Y;
  group.add(outside);

  const walls = new Mesh(
    buildWalls(hx, hz, map.bounds?.door ?? 0).build(),
    getItemMaterials().prop,
  );
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);
  group.add(buildToySigns(map));
  group.add(buildEntranceSign(hz, map.bounds?.door ?? 0, WALL_THICKNESS + 0.3));
  return group;
}
