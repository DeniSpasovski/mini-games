import {
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { Rng } from '../../../../shared/rng';
import { RIM_D, RIM_H, bowlGeometry, treadHeight, warpedRing } from '../bowl';
import { QUARRY_FX } from '../fx/particles';
import { PALETTE } from '../materials';
import {
  boulderGeometry,
  decorGeometry,
  flagTileGeometry,
  floorGeometry,
  postGeometry,
  potsGeometry,
  rimRockGeometry,
  woodCrateGeometry,
} from '../parts';
import { shared } from './cache';
import type { LevelTheme, SceneryCtx } from './theme';

const UP = new Vector3(0, 1, 0);
const RIM_TINTS = [0xd9b07c, 0xc6976a, 0xe0bf8e, 0xb08a6c, 0xa79a8c];

/** Boulders on the rim above the cliff: one instanced mesh, seeded. */
function rimRocks(
  hx: number,
  hz: number,
  rng: Rng,
  mat: Material,
): InstancedMesh {
  const m4 = new Matrix4();
  const quat = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const tint = new Color();
  const spots: [number, number, number][] = [];
  for (const d of [RIM_D + 1.2, RIM_D + 3.6, RIM_D + 7]) {
    const pts = warpedRing(hx, hz, d);
    for (let i = 0; i < pts.length; i += 2)
      if (rng.chance(0.45)) spots.push([pts[i], pts[i + 1], d]);
  }
  const mesh = new InstancedMesh(
    shared('rim-rock', rimRockGeometry),
    mat,
    Math.max(1, spots.length),
  );
  spots.forEach(([x, z], k) => {
    // the camera looks north from high over the front (+z) rim: rocks there sit right under the wide menu / finale view
    // and would fill its bottom edge, so they shrink towards the front
    const front = Math.min(1, Math.max(0, (z - hz * 0.3) / (hz * 0.7 + 6)));
    const sc = rng.range(1.2, 2.8) * (1 - 0.6 * front);
    m4.compose(
      pos.set(x, RIM_H - 0.2, z),
      quat.setFromAxisAngle(UP, rng.range(0, 6.28)),
      scl.set(sc * rng.range(0.9, 1.4), sc * rng.range(0.8, 1.6), sc),
    );
    mesh.setMatrixAt(k, m4);
    // sandstone of the cliff's strata: ochre to brown, a few greyer
    mesh.setColorAt(k, tint.set(RIM_TINTS[rng.int(0, RIM_TINTS.length - 1)]));
  });
  return mesh;
}

function scenery({ w, h, hx, hz, rng, flat, quality }: SceneryCtx) {
  const low = quality.name === 'low';
  return {
    objects: [
      new Mesh(
        shared(`bowl${w}x${h}${low ? 'l' : ''}`, () =>
          bowlGeometry(hx, hz, undefined, low),
        ),
        flat,
      ),
      rimRocks(hx, hz, rng, flat),
    ],
  };
}

/** The first level: a sandstone quarry, a rocky bowl, granite, cut sandstone and timber (DETAILS.md "Style"). */
export const QUARRY_THEME: LevelTheme = {
  id: 'quarry',
  sky: [PALETTE.skyTop, PALETTE.skyMid, PALETTE.skyLow],
  light: {
    key: 0xfff0d8,
    keyIntensity: 2.75,
    sky: 0xbcd6ff,
    ground: 0x9a7a55,
    fill: 1.25,
    env: 0.15,
  },
  fx: QUARRY_FX,
  warnColor: 0xff4a2a,
  fall: 'wall',
  wallVariants: [0, 1],
  tiles: {
    colors: PALETTE.flags,
    geometry: flagTileGeometry,
    vertexColors: true,
    rotate: 'any',
    tint(_x, _y, r, out) {
      out.setScalar(r.range(0.93, 1.04));
    },
  },
  hard: [boulderGeometry, postGeometry],
  crate: [() => woodCrateGeometry(), potsGeometry],
  floor: floorGeometry,
  decor: decorGeometry,
  scenery,
  crowd: { ring: warpedRing, height: treadHeight },
};
