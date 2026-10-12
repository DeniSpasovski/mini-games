import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Zastava 101 wheels: the pressed-steel 13" rim with a ring of ventilation holes, domed hub cap and wheel
 * nuts. (The tyre - 13", tall sidewall, size and tread per compound, road dust - is cars/shared/tyre-mesh.ts.)
 * Wheel space: axis X, outer face towards +X (same as `buildWheelGeometries`).
 */

const RIM_R = 0.168; // 13" rim

const nonIndexed = (g: BufferGeometry): BufferGeometry => {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  return out;
};

function buildRim(W: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const half = W * 0.5;
  const face = half * 0.3;
  // Drop-centre barrel: flanges at both edges, shallow well between. A closed 4 mm thick
  // section (outer skin out, inner skin back), so it is solid from every angle - a single
  // surface is invisible from inside and the wheel looks hollow.
  const skin: [number, number][] = [
    [RIM_R + 0.012, -half * 0.74],
    [RIM_R + 0.012, -half * 0.66],
    [RIM_R - 0.004, -half * 0.56],
    [RIM_R - 0.016, -half * 0.3],
    [RIM_R - 0.016, half * 0.3],
    [RIM_R - 0.004, half * 0.56],
    [RIM_R + 0.012, half * 0.66],
    [RIM_R + 0.012, half * 0.74],
  ];
  const section = [
    ...skin,
    // Inner skin: a plain cylinder just under the well.
    [RIM_R - 0.02, half * 0.74],
    [RIM_R - 0.02, -half * 0.74],
    skin[0],
  ];
  const barrel = new LatheGeometry(
    section.map(([r, a]) => new Vector2(r, a)),
    24,
  );
  barrel.rotateZ(-Math.PI / 2);
  parts.push(nonIndexed(barrel));

  // Centre disc with a ring of holes.
  const shape = new Shape();
  const dr = RIM_R - 0.012;
  shape.absarc(0, 0, dr, 0, Math.PI * 2, false);
  const holes = 12;
  for (let i = 0; i < holes; i++) {
    const a = ((i + 0.5) / holes) * Math.PI * 2;
    const h = new Path();
    h.absarc(
      Math.cos(a) * dr * 0.7,
      Math.sin(a) * dr * 0.7,
      dr * 0.07,
      0,
      Math.PI * 2,
      true,
    );
    shape.holes.push(h);
  }
  const disc = new ExtrudeGeometry(shape, {
    depth: 0.01,
    bevelEnabled: false,
    curveSegments: 4,
  });
  disc.rotateY(Math.PI / 2);
  disc.translate(face, 0, 0);
  parts.push(nonIndexed(disc));
  // Pressed bead outside the holes, raised centre, hub cap, four wheel nuts.
  const ring = new TorusGeometry(dr * 0.86, 0.007, 5, 28);
  ring.rotateY(Math.PI / 2);
  ring.translate(face + 0.008, 0, 0);
  parts.push(nonIndexed(ring));
  const dish = new CylinderGeometry(dr * 0.36, dr * 0.52, 0.02, 20);
  dish.rotateZ(-Math.PI / 2);
  dish.translate(face + 0.016, 0, 0);
  parts.push(nonIndexed(dish));
  const cap = new SphereGeometry(
    dr * 0.21,
    12,
    5,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  cap.rotateZ(-Math.PI / 2);
  cap.translate(face + 0.024, 0, 0);
  parts.push(nonIndexed(cap));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const nut = new CylinderGeometry(0.009, 0.009, 0.014, 6);
    nut.rotateZ(-Math.PI / 2);
    nut.translate(
      face + 0.03,
      Math.cos(a) * dr * 0.31,
      Math.sin(a) * dr * 0.31,
    );
    parts.push(nonIndexed(nut));
  }
  const rim = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return rim;
}

export function buildZastavaWheel(
  _radius: number,
  width: number,
): { tire: BufferGeometry; rim: BufferGeometry; caliper: BufferGeometry } {
  return {
    // The tyre is built by cars/shared/tyre-mesh.ts (the compound's 13" size, dusty) - only the rim + caliper live here.
    tire: new BufferGeometry(),
    rim: buildRim(width),
    caliper: new BoxGeometry(0.001, 0.001, 0.001),
  };
}
