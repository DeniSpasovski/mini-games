import { Vector2 } from 'three';
import { getAssetMeta } from '../../../assets/catalog';
import { isTreeType } from '../../../trees/species';
import { hash3, Rng } from '../../../../../shared/rng';
import type { ScatterInstance } from '../../../world/scatter';
import { ORIGIN, roadZ, SIDEWALK_BACK } from './frame';
import { getLayout, MILEKS_CORNERS, ROTUNDA_DEPTH } from './layout';
import { CYPRESS, px } from './trace';
import { yardPropInstances } from './yard-props';

/**
 * The start row's trees and shrubs: rally assets (`hedge_cypress` rows and hedges, `oak_tree`
 * for the garden trees, `bush`) placed as fixed scatter instances, so they get the game's LOD,
 * instancing, shadows and colliders. Pure (runs in node); `ground` takes WORLD coordinates.
 */
export function startRowInstances(
  ground: (x: number, z: number) => number,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const plant = (asset: string, at: Vector2, scale: number, salt: number) => {
    const h = hash3(Math.round(at.x * 10), Math.round(at.y * 10), salt, 4207);
    const x = at.x + ORIGIN.x;
    const z = at.y + ORIGIN.z;
    out.push({
      asset,
      // Trees: the placement stage sets variant, rotation and scale (trees/placement.ts).
      variant: isTreeType(asset) ? 0 : h % getAssetMeta(asset).variants,
      x,
      y: ground(x, z),
      z,
      rotY: ((h >>> 8) % 628) / 100,
      scale,
      tiltX: 0,
      tiltZ: 0,
    });
  };
  const layout = getLayout();
  const rng = new Rng(77);
  /** A row of hedge cypress along a fence edge, 1.2 m inside it (towards `centre`), one every `step` m for `length` m. */
  const fenceRow = (
    a: Vector2,
    b: Vector2,
    centre: Vector2,
    step: number,
    salt: number,
    length = a.distanceTo(b),
  ) => {
    const v = b.clone().sub(a).normalize();
    const inward = new Vector2(-v.y, v.x).multiplyScalar(1.2);
    if (inward.dot(centre.clone().sub(a)) < 0) inward.negate();
    for (let d = 0; d <= Math.min(length, a.distanceTo(b)); d += step)
      plant(
        'hedge_cypress',
        a.clone().addScaledVector(v, d).add(inward),
        0.9 + rng.next() * 0.2,
        salt,
      );
  };
  /** The edge of a fence run furthest from the street (the south lots' back, at the motorway). */
  const backEdge = (run: Vector2[]) => {
    let back = 1;
    for (let i = 2; i < run.length; i++)
      if (run[i].y + run[i - 1].y > run[back].y + run[back - 1].y) back = i;
    return back;
  };
  const centreOf = (polygon: Vector2[]) =>
    polygon
      .reduce((s, p) => s.add(p), new Vector2())
      .divideScalar(polygon.length);

  // Rows of cypress-like trees where the image shows them: between lots and along the field edges.
  for (const [from, to] of CYPRESS) {
    const a = new Vector2(...px(...from));
    const b = new Vector2(...px(...to));
    const n = Math.max(1, Math.round(a.distanceTo(b) / 3));
    for (let k = 0; k <= n; k++) {
      const at = a
        .clone()
        .lerp(b, k / n)
        .add(new Vector2((rng.next() - 0.5) * 0.8, (rng.next() - 0.5) * 0.8));
      // Never in front of a gate, where they would block the way in.
      if (
        [...layout.southGates, ...layout.northGates].some(
          ([g0, g1]) => at.x > g0 - 2 && at.x < g1 + 2,
        )
      )
        continue;
      plant('hedge_cypress', at, 0.9 + rng.next() * 0.2, 1);
    }
  }

  // South 6: cypress along its two side fences (none at the back), and four small trees in front of the round glass.
  for (const yard of layout.yards) {
    const { plot, polygon } = yard;
    if (plot.style !== 'office') continue;
    const centre = centreOf(polygon);
    for (const run of yard.fence) {
      const back = backEdge(run);
      for (let i = 1; i < run.length; i++)
        if (i !== back) fenceRow(run[i - 1], run[i], centre, 3.2, 3);
    }
    const north = plot.corners
      .map(([x, z]) => new Vector2(x, z))
      .sort((p, q) => p.y - q.y)
      .slice(0, 2);
    const mid = north[0].clone().add(north[1]).multiplyScalar(0.5);
    const along = north[1].clone().sub(north[0]).normalize();
    const out2 = new Vector2(along.y, -along.x);
    for (const u of [-3.3, -1.1, 1.1, 3.3])
      plant(
        'hedge_cypress',
        mid
          .clone()
          .addScaledVector(out2, ROTUNDA_DEPTH + 3)
          .addScaledVector(along, u),
        0.55 + rng.next() * 0.1,
        4,
      );
  }

  // South 4: a short row of cypress along its east fence from the street, where its cars park (none at the back).
  for (const yard of layout.yards) {
    if (yard.plot.name !== 'south 4') continue;
    const [a, b] = yard.fence[0];
    fenceRow(a, b, centreOf(yard.polygon), 2.2, 7, 24);
  }

  // The Mileks front garden: shrubs along the inside of the low wall and two small trees.
  const [, , se, sw] = MILEKS_CORNERS;
  for (let x = sw[0] + 0.5; x < se[0] - 0.4; x += 0.85 + rng.next() * 0.25)
    plant(
      'bush',
      new Vector2(x, roadZ(x, SIDEWALK_BACK + 0.55)),
      0.45 + rng.next() * 0.2,
      5,
    );
  [sw[0] + 1.6, se[0] - 2.4].forEach((x, k) =>
    plant(
      'oak_tree',
      new Vector2(x, roadZ(x, SIDEWALK_BACK + 1.15)),
      0.42 + k * 0.05,
      6,
    ),
  );
  out.push(...yardPropInstances(ground));
  return out;
}
