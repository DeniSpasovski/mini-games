import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  type Texture,
} from 'three';
import { merge, paint, planarUV } from '../engine/geo';
import { getMaterial } from '../engine/materials';
import {
  boardTexture,
  clockTexture,
  headerTexture,
  HEADER_ASPECT,
  sideTexture,
  type StageTitle,
} from '../engine/stage-sign-textures';
import type { RoadSample } from './road';
import {
  BOARD_H,
  BOARD_LEAN,
  BOARD_W,
  boardYaw,
  type BoardPlan,
  type GantryPlan,
} from './stage-signs';
import type { World } from './world';

/**
 * Draws world.signs (stage-signs.ts): inflatable start / finish gantries with the map name and year
 * in the header, and the split boards. Everything is built in
 * the local frame of the road at its `along` (x = left, y = up from the road centre, z = travel) and
 * baked into world space, merged per material: a handful of draw calls for the whole stage.
 */

const matCache = new Map<string, MeshStandardMaterial>();

function textured(t: Texture): MeshStandardMaterial {
  let m = matCache.get(t.uuid);
  if (!m) {
    m = new MeshStandardMaterial({ map: t, roughness: 0.7 });
    matCache.set(t.uuid, m);
  }
  return m;
}

const nonIndexed = (g: BufferGeometry): BufferGeometry =>
  g.index ? g.toNonIndexed() : g;

/** Vertex-coloured solid (shared `props` material). */
const solid = (g: BufferGeometry, color: Color | string): BufferGeometry =>
  planarUV(paint(g, color), 1.3);

const frameOf = (s: RoadSample): Matrix4 =>
  new Matrix4().makeRotationY(Math.atan2(s.tx, s.tz)).setPosition(s.x, s.y, s.z);

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: Color | string,
): BufferGeometry => solid(new BoxGeometry(w, h, d).translate(x, y, z), color);

/** Image plane (front normal +Z) at (x, y, z), turned by `yaw` about Y around its own centre. */
function plane(
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): BufferGeometry {
  return nonIndexed(
    new PlaneGeometry(w, h).rotateY(yaw).translate(x, y, z),
  );
}

/** A plane readable from both sides: [seen by the approaching driver (-Z side), seen after passing]. */
function bothSides(
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
): BufferGeometry[] {
  return [plane(w, h, x, y, -z, Math.PI), plane(w, h, x, y, z)];
}

/** Inflatable column (lathe with a bulge per section), `y0` ground .. `top`, a dome on top. */
function pillar(
  y0: number,
  top: number,
  main: Color,
  accent: Color,
): BufferGeometry {
  const R = 0.44;
  const sections = Math.max(4, Math.round((top - y0) / 0.95));
  const len = (top - y0) / sections;
  const pts: Vector2[] = [new Vector2(0, y0), new Vector2(R * 1.1, y0)];
  for (let i = 0; i < sections; i++)
    for (let k = 1; k <= 5; k++) {
      const f = k / 5;
      pts.push(
        new Vector2(R * 0.92 + 0.14 * Math.sin(Math.PI * f), y0 + (i + f) * len),
      );
    }
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push(new Vector2(R * 0.92 * Math.cos(a), top + 0.42 * Math.sin(a)));
  }
  const g = paint(new LatheGeometry(pts, 14), main);
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  const dark = main.clone().multiplyScalar(0.84);
  for (let i = 0; i < p.count; i++) {
    const sec = Math.min(sections - 1, Math.floor((p.getY(i) - y0) / len));
    const col = sec === 0 ? accent : sec % 2 ? dark : main;
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return planarUV(g, 1.3);
}

/** Round tube along X from -half to +half with rounded ends. */
function tube(half: number, y: number, r: number, color: Color): BufferGeometry[] {
  const t = new CylinderGeometry(r, r, half * 2, 14, 1)
    .rotateZ(Math.PI / 2)
    .translate(0, y, 0);
  return [
    solid(t, color),
    ...[-half, half].map((x) =>
      solid(new SphereGeometry(r, 12, 8).translate(x, y, 0), color),
    ),
  ];
}

interface Colors {
  main: Color;
  accent: Color;
  flag: [string, string];
}

const PALETTE: Record<GantryPlan['kind'], Colors> = {
  start: {
    main: new Color('#1f5fd6'),
    accent: new Color('#f4f4f0'),
    flag: ['#22b04b', '#22b04b'],
  },
  finish: {
    main: new Color('#d62a1f'),
    accent: new Color('#f4f4f0'),
    flag: ['#f4f4f0', '#101010'],
  },
};

const DARK = new Color('#1b1e23');

/** Geometry (road-local) of one gantry, split by material. */
function gantry(
  g: GantryPlan,
  title: StageTitle,
): { solid: BufferGeometry[]; textured: Map<Texture, BufferGeometry[]> } {
  const col = PALETTE[g.kind];
  const solids: BufferGeometry[] = [];
  const maps = new Map<Texture, BufferGeometry[]>();
  const add = (t: Texture, ...geo: BufferGeometry[]) =>
    maps.set(t, [...(maps.get(t) ?? []), ...geo]);

  const panelW = 2 * g.half - 1.5;
  const panelH = panelW / HEADER_ASPECT;
  const panelBottom = 4.8;
  const lowerTubeY = panelBottom - 0.3;
  const upperTubeY = panelBottom + panelH + 0.3;
  const top = upperTubeY + 0.4;

  // Pillars (left = +X, right = -X): inflatable column on a rubber foot, flag on top.
  [g.half, -g.half].forEach((x, i) => {
    const y0 = -g.drop[i] - 0.25;
    solids.push(pillar(y0, top, col.main, col.accent).translate(x, 0, 0));
    solids.push(box(1.5, 0.3, 1.5, x, y0 + 0.1, 0, DARK));
    const poleTop = top + 0.42;
    solids.push(
      solid(
        new CylinderGeometry(0.025, 0.03, 1.6, 6).translate(x, poleTop + 0.7, 0),
        '#c8ccd0',
      ),
    );
    // Pennant pointing away from the road, two colours (green / chequer halves), both faces.
    const out = Math.sign(x);
    col.flag.forEach((c, k) => {
      const fy = poleTop + 1.35 - k * 0.27;
      for (const face of [-1, 1])
        solids.push(
          solid(
            plane(0.9, 0.27, x + out * 0.5, fy, face * 0.004, face < 0 ? Math.PI : 0),
            c,
          ),
        );
    });
    // Vertical banner sleeve on the pillar with the name / year, readable from both directions.
    solids.push(box(0.9, 3.3, 1.1, x, 2.9, 0, col.main.clone().multiplyScalar(0.55)));
    add(sideTexture(g.kind, title), ...bothSides(0.8, 3.2, x, 2.9, 0.555));
  });

  // Header: two tubes, dark backing and the banner (map name + year) on both faces.
  solids.push(...tube(g.half, lowerTubeY, 0.27, col.accent));
  solids.push(...tube(g.half, upperTubeY, 0.3, col.main));
  const panelY = panelBottom + panelH / 2;
  solids.push(box(panelW + 0.3, panelH + 0.26, 0.3, 0, panelY, 0, DARK));
  add(headerTexture(g.kind, title), ...bothSides(panelW, panelH, 0, panelY, 0.155));

  // Clock hung under the header on two straps.
  const clockY = lowerTubeY - 0.27 - 0.1 - 0.33;
  solids.push(
    box(1.8, 0.7, 0.3, 0, clockY, 0, DARK),
    box(0.08, 0.14, 0.08, -0.6, clockY + 0.42, 0, '#8a8f96'),
    box(0.08, 0.14, 0.08, 0.6, clockY + 0.42, 0, '#8a8f96'),
  );
  add(clockTexture(g.kind), ...bothSides(1.7, 0.64, 0, clockY, 0.155));
  return { solid: solids, textured: maps };
}

/**
 * Geometry (road-local) of one split board: a temporary A-frame sign standing on the ground - two
 * panels hinged at the top ridge and leaning apart, printed on the outside (the front one faces the
 * oncoming driver), dark rubber feet and a hinge cap.
 */
function board(b: BoardPlan): {
  solid: BufferGeometry[];
  texture: Texture;
  faces: BufferGeometry[];
} {
  const base = -b.drop;
  const yaw = boardYaw(b.side);
  const lean = BOARD_LEAN;
  const nz = Math.cos(lean);
  const ny = Math.sin(lean);
  const solids: BufferGeometry[] = [];
  const faces: BufferGeometry[] = [];
  // Front panel in A-frame space (facing +Z, ridge at z = 0, feet on y = 0); the rear panel is its mirror.
  const panel = (g: BufferGeometry, offset = 0): BufferGeometry =>
    g
      .rotateX(-lean)
      .translate(
        0,
        BOARD_H - (BOARD_H / 2) * nz + offset * ny,
        (BOARD_H / 2) * ny + offset * nz,
      );
  for (const turn of [0, Math.PI]) {
    const at = (g: BufferGeometry): BufferGeometry =>
      g
        .rotateY(turn + yaw)
        .translate(b.side * b.lateral, base, 0);
    solids.push(
      at(
        solid(
          panel(new BoxGeometry(BOARD_W + 0.04, BOARD_H + 0.04, 0.03), -0.016),
          '#d9dce0',
        ),
      ),
    );
    faces.push(at(panel(new PlaneGeometry(BOARD_W, BOARD_H), 0.002)));
    // Rubber foot under the panel.
    solids.push(
      at(
        solid(
          new BoxGeometry(BOARD_W + 0.1, 0.05, 0.07).translate(
            0,
            0.025,
            BOARD_H * ny,
          ),
          '#26282c',
        ),
      ),
    );
  }
  solids.push(
    solid(
      new BoxGeometry(BOARD_W + 0.06, 0.06, 0.08)
        .translate(0, BOARD_H + 0.01, 0)
        .rotateY(yaw)
        .translate(b.side * b.lateral, base, 0),
      '#26282c',
    ),
  );
  return {
    solid: solids,
    texture: boardTexture({ split: b.split, distance: b.distance }),
    faces: faces.map((g) => nonIndexed(g)),
  };
}

function shadowed(m: Mesh): Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

export function* stageSignMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const signs = world.signs;
  if (!signs.gantries.length && !signs.boards.length) return undefined;
  const group = new Group();
  group.name = 'stage-signs';
  const title: StageTitle = {
    name: world.map.name,
    year: world.map.year,
    stageNumber: world.map.stageNumber,
  };
  const solids: BufferGeometry[] = [];
  const maps = new Map<Texture, BufferGeometry[]>();
  const bake = (geo: BufferGeometry, s: RoadSample): BufferGeometry =>
    geo.applyMatrix4(frameOf(s));

  for (const g of signs.gantries) {
    const s = world.road.at(g.along);
    const built = gantry(g, title);
    for (const geo of built.solid) solids.push(bake(geo, s));
    for (const [t, geos] of built.textured)
      maps.set(t, [...(maps.get(t) ?? []), ...geos.map((geo) => bake(geo, s))]);
    yield;
  }
  for (const b of signs.boards) {
    const s = world.road.at(b.along);
    const built = board(b);
    for (const geo of built.solid) solids.push(bake(geo, s));
    maps.set(built.texture, [
      ...(maps.get(built.texture) ?? []),
      ...built.faces.map((geo) => bake(geo, s)),
    ]);
  }
  yield;

  if (solids.length)
    group.add(shadowed(new Mesh(merge(solids), getMaterial('props'))));
  for (const [t, geos] of maps) {
    const m = shadowed(new Mesh(merge(geos), textured(t)));
    m.castShadow = false;
    group.add(m);
  }
  yield;
  return group;
}
