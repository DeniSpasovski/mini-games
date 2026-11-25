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
import { farShadowCaster } from './far-shadow';
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
/** Lattice leg: chord spacing and brace step (m). */
const LEG = 0.9;
const LEG_STEP = 1.1;

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
  // Lattice legs: four angle chords on a footing, ladder braces and diagonals on every face.
  if (g.lattice)
    for (const p of g.posts) {
      const y0 = -p.drop - 0.3;
      const top = beamY + TRUSS_H;
      const h = top - y0;
      const ym = (top + y0) / 2;
      solids.push(box(1.3, 0.6, 1.3, p.lateral, y0 + 0.3, 0, '#8e8c86'));
      for (const dx of [-LEG / 2, LEG / 2])
        for (const dz of [-LEG / 2, LEG / 2])
          solids.push(box(0.08, h, 0.08, p.lateral + dx, ym, dz));
      // (the bays fill the leg up to the truss top exactly: no brace stands above the beam)
      const bays = Math.max(1, Math.round((top - (y0 + 0.6)) / LEG_STEP));
      const step = (top - (y0 + 0.6)) / bays;
      for (const dz of [-LEG / 2, LEG / 2])
        solids.push(box(LEG, 0.05, 0.05, p.lateral, top, dz));
      for (const dx of [-LEG / 2, LEG / 2])
        solids.push(box(0.05, 0.05, LEG, p.lateral + dx, top, 0));
      for (let k = 0, y = y0 + 0.6; k < bays; k++, y += step) {
        for (const dz of [-LEG / 2, LEG / 2])
          solids.push(box(LEG, 0.05, 0.05, p.lateral, y, dz));
        for (const dx of [-LEG / 2, LEG / 2])
          solids.push(box(0.05, 0.05, LEG, p.lateral + dx, y, 0));
        // diagonals (one per face, alternating)
        const a = Math.atan2(step, LEG);
        const d = Math.hypot(LEG, step);
        for (const dz of [-LEG / 2, LEG / 2])
          solids.push(
            solid(
              new BoxGeometry(d, 0.04, 0.04)
                .rotateZ(dz > 0 ? a : -a)
                .translate(p.lateral, y + step / 2, dz),
              STEEL,
            ),
          );
        for (const dx of [-LEG / 2, LEG / 2])
          solids.push(
            solid(
              new BoxGeometry(0.04, 0.04, d)
                .rotateX(dx > 0 ? a : -a)
                .translate(p.lateral + dx, y + step / 2, 0),
              STEEL,
            ),
          );
      }
    }
  // Posts on footings.
  for (const p of g.lattice ? [] : g.posts) {
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
  // a lattice gantry's beam is braced: diagonals in the two side faces between the verticals
  if (g.lattice) {
    const a = Math.atan2(TRUSS_H, 1.5);
    const d = Math.hypot(TRUSS_H, 1.5);
    for (let x = x0 + 0.6, k = 0; x + 1.5 < x1; x += 1.5, k++)
      for (const z of [-0.35, 0.35])
        solids.push(
          solid(
            new BoxGeometry(d, 0.06, 0.06)
              .rotateZ(k % 2 ? a : -a)
              .translate(x + 0.75, beamY + TRUSS_H / 2, z),
            STEEL,
          ),
        );
  }
  // Boards hung under the beam, face towards the oncoming driver (-Z), dark back.
  for (const b of g.boards) {
    const tex = signBoardTexture(b.def);
    const bw = b.w ?? BOARD_W;
    const bh = bw * (640 / 1024);
    const y = beamY - 0.15 - bh / 2;
    const face = new PlaneGeometry(bw, bh)
      .rotateY(Math.PI)
      .translate(b.lateral, y, -0.03);
    maps.set(tex, [...(maps.get(tex) ?? []), face.toNonIndexed()]);
    solids.push(box(bw, bh, 0.05, b.lateral, y, 0.0, DARK));
    for (const dx of [-bw * 0.3, bw * 0.3])
      solids.push(box(0.08, 0.3, 0.08, b.lateral + dx, beamY - 0.15, 0));
  }
  return { solid: solids, textured: maps };
}

function shadowed(m: Mesh): Mesh {
  m.castShadow = true;
  farShadowCaster(m);
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
