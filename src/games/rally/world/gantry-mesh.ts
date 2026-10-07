import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from 'three';
import { merge, paint, planarUV } from '../engine/geo';
import { getMaterial } from '../engine/materials';
import { signBoardTexture } from '../engine/structure-textures';
import {
  GANTRY_CLEARANCE,
  POST_RADIUS,
  type GantryPlan,
} from './overhead-signs';
import type { RoadSample } from './road';
import type { World } from './world';

/**
 * Draws world.overheadSigns (overhead-signs.ts): galvanised steel sign gantries - a round post (or two) on
 * a concrete footing, a truss beam (two chords with verticals) over the road and the green boards hung
 * under it, their backs plain grey. Built in the road frame at `along` (x = left, y = up, z = travel),
 * baked into world space, merged per material.
 */

const STEEL = '#9ea4a8';
const DARK = '#2b2e33';
/** Board size (m): the texture is 1024 x 640. */
const BOARD_W = 3.8;
const BOARD_H = BOARD_W * (640 / 1024);
/** Truss chord spacing (m). */
const TRUSS_H = 0.9;

const matCache = new Map<string, MeshStandardMaterial>();
function textured(t: Texture): MeshStandardMaterial {
  let m = matCache.get(t.uuid);
  if (!m) {
    m = new MeshStandardMaterial({ map: t, roughness: 0.65 });
    matCache.set(t.uuid, m);
  }
  return m;
}

const solid = (g: BufferGeometry, color: string): BufferGeometry =>
  planarUV(paint(g, color), 1.3);
const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color = STEEL,
): BufferGeometry => solid(new BoxGeometry(w, h, d).translate(x, y, z), color);

const frameOf = (s: Pick<RoadSample, 'x' | 'y' | 'z' | 'tx' | 'tz'>): Matrix4 =>
  new Matrix4()
    .makeRotationY(Math.atan2(s.tx, s.tz))
    .setPosition(s.x, s.y, s.z);

function gantry(g: GantryPlan): {
  solid: BufferGeometry[];
  textured: Map<Texture, BufferGeometry[]>;
} {
  const solids: BufferGeometry[] = [];
  const maps = new Map<Texture, BufferGeometry[]>();
  const beamY = GANTRY_CLEARANCE + BOARD_H + 0.3;
  // Posts on footings.
  for (const p of g.posts) {
    const y0 = -p.drop - 0.3;
    solids.push(
      solid(
        new CylinderGeometry(
          POST_RADIUS,
          POST_RADIUS * 1.15,
          beamY + TRUSS_H - y0,
          10,
        )
          .translate(0, (beamY + TRUSS_H + y0) / 2, 0)
          .translate(p.lateral, 0, 0),
        STEEL,
      ),
      box(1.0, 0.6, 1.0, p.lateral, y0 + 0.3, 0, '#8e8c86'),
    );
  }
  // Beam: from the right post (or the only one) to the left post / past the last board.
  const lats = g.posts.map((p) => p.lateral);
  const x0 = Math.min(...lats);
  const x1 =
    g.posts.length > 1
      ? Math.max(...lats)
      : Math.max(...g.boards.map((b) => b.lateral)) + BOARD_W / 2 + 0.3;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  for (const y of [beamY, beamY + TRUSS_H])
    for (const z of [-0.35, 0.35]) solids.push(box(len, 0.14, 0.14, cx, y, z));
  for (let x = x0 + 0.6; x < x1; x += 1.5)
    for (const z of [-0.35, 0.35])
      solids.push(box(0.09, TRUSS_H, 0.09, x, beamY + TRUSS_H / 2, z));
  for (let x = x0 + 0.6; x < x1; x += 1.5)
    for (const y of [beamY, beamY + TRUSS_H])
      solids.push(box(0.09, 0.09, 0.7, x, y, 0));
  // Boards hung under the beam, face towards the oncoming driver (-Z), dark back.
  for (const b of g.boards) {
    const tex = signBoardTexture(b.def);
    const y = beamY - 0.15 - BOARD_H / 2;
    const face = new PlaneGeometry(BOARD_W, BOARD_H)
      .rotateY(Math.PI)
      .translate(b.lateral, y, -0.03);
    maps.set(tex, [...(maps.get(tex) ?? []), face.toNonIndexed()]);
    solids.push(box(BOARD_W, BOARD_H, 0.05, b.lateral, y, 0.0, DARK));
    for (const dx of [-BOARD_W * 0.3, BOARD_W * 0.3])
      solids.push(box(0.08, 0.3, 0.08, b.lateral + dx, beamY - 0.15, 0));
  }
  return { solid: solids, textured: maps };
}

function shadowed(m: Mesh): Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

export function* gantryMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const plans = world.overheadSigns.gantries;
  if (!plans.length) return undefined;
  const group = new Group();
  group.name = 'gantries';
  const solids: BufferGeometry[] = [];
  const maps = new Map<Texture, BufferGeometry[]>();
  for (const g of plans) {
    const s = g.frame ?? world.road.at(g.along);
    const built = gantry(g);
    const f = frameOf(s);
    for (const geo of built.solid) solids.push(geo.applyMatrix4(f));
    for (const [t, geos] of built.textured)
      maps.set(t, [
        ...(maps.get(t) ?? []),
        ...geos.map((geo) => geo.applyMatrix4(f)),
      ]);
    yield;
  }
  if (solids.length)
    group.add(shadowed(new Mesh(merge(solids), getMaterial('props'))));
  for (const [t, geos] of maps) {
    const m = shadowed(new Mesh(merge(geos), textured(t)));
    m.castShadow = false;
    group.add(m);
  }
  return group;
}
