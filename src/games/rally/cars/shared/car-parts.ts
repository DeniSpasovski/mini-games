import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Shape,
  ShapeGeometry,
  Quaternion,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  arcIdx,
  CABIN_RAIL,
  emptyGeometry,
  loft,
  idxAtX,
  idxAtY,
  pointAt,
  smoothstep,
  type BodyShape,
  type Profile,
  type Range,
} from './car-body';
import type { CarDef, CarParts } from './types';

/**
 * Body styling + rally parts for the procedural car model, driven by
 * `CarDef.model.parts`. Returns one merged geometry per material so the whole
 * car stays at ~13 draw calls:
 *   plain  = body-coloured add-ons (mirrors, scoops, old-style flares / wings)
 *   trim   = black plastic (window frames, seams, liners, grilles...)
 *   carbon = glossy carbon aero (splitter, wing, skirts, diffuser)
 *   mesh   = grille mesh (UVs in metres)
 *   glass  = window glass decals
 *   lights / tail = emissive lamps
 *   interior / cage / lining = cockpit seen through the glass
 * Most details are "skin patches" (BodyShape surfaces) that follow the body.
 * Model space: y = 0 ground, z = 0 centre of mass, +Z forward, +X left.
 */
export interface CarPartGeometry {
  plain: BufferGeometry;
  trim: BufferGeometry;
  carbon: BufferGeometry;
  mesh: BufferGeometry;
  glass: BufferGeometry;
  lights: BufferGeometry;
  tail: BufferGeometry;
  /** Amber indicators / reflectors (emissive orange). */
  amber: BufferGeometry;
  /** Cockpit: dark interior, light roll cage + seat shells, back-face-only headliner. */
  interior: BufferGeometry;
  cage: BufferGeometry;
  lining: BufferGeometry;
  /** Polished chrome (lamp reflectors, bezels) - optional, hand-built bodies. */
  chrome?: BufferGeometry;
  /** Clear lamp glass - optional, hand-built bodies. */
  lens?: BufferGeometry;
  /** Tinted lamps (hand-built bodies): faceted coloured reflector seen through a tinted clear lens. */
  redReflector?: BufferGeometry;
  redLens?: BufferGeometry;
  amberReflector?: BufferGeometry;
  amberLens?: BufferGeometry;
}

function nonIndexed(g: BufferGeometry): BufferGeometry {
  if (!g.index) return g;
  const out = g.toNonIndexed();
  g.dispose();
  return out;
}

/** Non-indexed box, optionally rotated (X, then Y, then Z) and placed. */
export function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return nonIndexed(g);
}

/** Rounded box (soft-edged scoops, mirrors). */
export function rbox(
  w: number,
  h: number,
  d: number,
  r: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, r);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return nonIndexed(g);
}

export function cyl(
  r: number,
  len: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'y' | 'z',
  open = false,
): BufferGeometry {
  const g = new CylinderGeometry(r, r, len, segs, 1, open);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return nonIndexed(g);
}

const shapeOf = (pts: [number, number][]) =>
  new Shape(pts.map(([a, b]) => new Vector2(a, b)));

/** Plate in the YZ plane from (z, y) outline points, `th` thick, centred on x. */
function sidePlate(
  pts: [number, number][],
  x: number,
  th: number,
): BufferGeometry {
  const g = new ExtrudeGeometry(shapeOf(pts), {
    depth: th,
    bevelEnabled: false,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(x + th / 2, 0, 0);
  return nonIndexed(g);
}

/** Horizontal plate from plan (x, z) outline points; top face at yTop. */
function planPlate(
  pts: [number, number][],
  yTop: number,
  th: number,
): BufferGeometry {
  const g = new ExtrudeGeometry(shapeOf(pts), {
    depth: th,
    bevelEnabled: false,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, yTop, 0);
  return nonIndexed(g);
}

/**
 * Flat shape on a front / rear end panel from (x, y) points (left side, x > 0).
 * `mirror` adds the right-side copy; centred shapes pass the full outline.
 */
function capShape(
  pts: [number, number][],
  z: number,
  rear: boolean,
  mirror = true,
): BufferGeometry {
  const out: BufferGeometry[] = [];
  for (const side of mirror ? [1, -1] : [1]) {
    const g = new ShapeGeometry(
      shapeOf(pts.map(([x, y]) => [x * side * (rear ? -1 : 1), y])),
    );
    if (rear) g.rotateY(Math.PI);
    g.translate(0, 0, z);
    out.push(nonIndexed(g));
  }
  return mergeAll(out);
}

export function mergeAll(g: BufferGeometry[]): BufferGeometry {
  const list = g.filter((x) => x.getAttribute('position').count > 0);
  if (!list.length) return emptyGeometry();
  if (list.length === 1) return list[0];
  const out = mergeGeometries(list, false)!;
  g.forEach((x) => x.dispose());
  return out;
}

/** Half width of an end panel at height y. */
const capX = (pts: Profile, y: number) => pointAt(pts, idxAtY(pts, y, 1))[0];

/**
 * @param addOnsOnly only the bolt-on rally kit (pod, mudflaps, roof vent, wing, cockpit) -
 *        used on top of imported glTF bodies.
 */
export function buildCarParts(
  def: CarDef,
  body: BodyShape,
  addOnsOnly = false,
): CarPartGeometry {
  const p = def.physics;
  const m = def.model;
  const parts: CarParts = addOnsOnly ? (m.gltf?.addOns ?? {}) : m.parts;
  const c = m.cabin;
  const zf = body.zFront;
  const zr = body.zRear;
  const wr = p.wheelRadius;
  const R = body.archR;
  const station = (z: number) => body.station(z);
  const L = body.lower;
  const C = body.cabin;
  const plain: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const carbon: BufferGeometry[] = [];
  const mesh: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const lights: BufferGeometry[] = [];
  const tail: BufferGeometry[] = [];
  const amber: BufferGeometry[] = [];
  const interior: BufferGeometry[] = [];
  const cage: BufferGeometry[] = [];
  const lining: BufferGeometry[] = [];
  const wide = body.wide;
  const bz = body.bPillar;
  const doors = parts.doors ?? 2;

  /** Skin patch + a slightly bigger frame under it (frame `pad` metres wider). */
  const framed = (
    list: BufferGeometry[],
    frame: BufferGeometry[],
    z0: number,
    z1: number,
    range: (pad: number) => Range,
    pad = 0.015,
  ) => {
    frame.push(L.patch(z0 - pad, z1 + pad, range(pad), { offset: 0.003 }));
    list.push(L.patch(z0, z1, range(0), { offset: 0.0055 }));
  };
  /** Range between two heights on the body side. */
  const yBand =
    (
      y0: (z: number) => number,
      y1: (z: number) => number,
      pad: number,
    ): Range =>
    (z, pts) => {
      const a = y0(z) - pad;
      const b = y1(z) + pad;
      return b - a > 0.004 ? [idxAtY(pts, a), idxAtY(pts, b)] : null;
    };

  // --- wheel arches -----------------------------------------------------------------
  if (!addOnsOnly) {
    for (const axle of [p.front, p.rear]) {
      const s = station(axle.z);
      for (const side of [1, -1]) {
        if (!wide) {
          const t = new TorusGeometry(R + 0.01, m.flare * 0.6, 6, 18, Math.PI);
          t.rotateY(Math.PI / 2);
          t.scale(1.6, 1, 1);
          t.translate(side * (s.hw - 0.01), wr, axle.z);
          plain.push(nonIndexed(t));
        }
        // Liner so the arch looks deep, not see-through.
        const outer = s.hw + (wide ? body.flare(axle.z).out : 0.02);
        const inner = axle.track / 2 - 0.18;
        const liner = new CylinderGeometry(
          R,
          R,
          outer - inner,
          18,
          1,
          true,
          0, // upper half (after rotateZ: y = R sin(theta))
          Math.PI,
        );
        liner.rotateZ(Math.PI / 2);
        liner.translate(side * (inner + outer) * 0.5, wr, axle.z);
        trim.push(nonIndexed(liner));
      }
    }
  }
  if (parts.mudflaps) {
    for (const axle of [p.front, p.rear])
      for (const side of [1, -1])
        trim.push(
          box(
            0.28,
            0.34,
            0.012,
            side * (axle.track / 2),
            0.21,
            axle.z - R - 0.04,
          ),
        );
  }

  if (!addOnsOnly || parts.cockpit) buildInterior();
  if (!addOnsOnly) {
    buildWindows();
    buildDoors();
    if (wide) buildRally1Body();
    else buildClassicBody();
  }

  // --- glass house + cockpit --------------------------------------------------------------
  function buildWindows(): void {
    const PAD = 0.022;
    const CABIN_FRAME = { offset: 0.003, step: 0.03, astep: 0.06 };
    for (const w of body.windows()) {
      // Glass over the cut-out; a black frame ring round it hides the stepped
      // edge of the cut-out (see BodyShape.cabinQuad).
      const g = w.range(0);
      const f = w.range(PAD);
      const z0 = w.z0 - PAD;
      const z1 = w.z1 + PAD;
      trim.push(
        C.patch(
          z0,
          z1,
          (z, pts) => {
            const o = f(z, pts);
            const i = g(z, pts);
            return o && [o[0], i ? i[0] : o[1]];
          },
          CABIN_FRAME,
        ),
        C.patch(
          z0,
          z1,
          (z, pts) => {
            const o = f(z, pts);
            const i = g(z, pts);
            return o && i && o[1] - i[1] > 1e-3 ? [i[1], o[1]] : null;
          },
          CABIN_FRAME,
        ),
      );
      glass.push(C.patch(w.z0, w.z1, g, { ...CABIN_FRAME, offset: 0.0055 }));
    }
    // B pillar.
    const bh = 0.045 + PAD;
    trim.push(
      C.patch(bz - bh, bz + bh, (_z, pts) => [
        arcIdx(pts, 0, 0.008),
        arcIdx(pts, CABIN_RAIL, -0.013),
      ]),
    );
  }

  function buildInterior(): void {
    // Dark headliner: the greenhouse inset a little (more on an imported body, whose roof is not the generic loft),
    // drawn back-face only, so through a window you see the far side's lining, not the sky.
    const inset = addOnsOnly ? 0.07 : 0.015;
    const rally = !addOnsOnly || parts.cockpit === 'rally';
    // Coarse is fine: chords of a convex shell stay inside it.
    const keep = [0, CABIN_RAIL / 2, CABIN_RAIL];
    for (let i = CABIN_RAIL + 4; i < C.slices[0].pts.length; i += 4)
      keep.push(i);
    lining.push(
      loft(
        C.slices
          .filter((_, k) => k % 4 === 0 || k === C.slices.length - 1)
          .map((sl) => ({
            ...sl,
            pts: keep.map((i) => {
              const [x, y, nx, ny] = pointAt(sl.pts, i);
              return [Math.max(0, x - nx * inset), y - ny * inset];
            }),
          })),
        () => 0,
        1,
      ),
    );
    // Floor (top of the lower body inside the cabin).
    interior.push(
      L.patch(
        c.zRear,
        c.zFront,
        (z, pts) => [idxAtX(pts, station(z).hwBelt * 0.93), pts.length - 1],
        { offset: 0.004, step: 0.1, astep: 0.1 },
      ),
    );
    // Inner contour of the greenhouse at z: belt / rail points, inset.
    const belt = (z: number, side: number, up = 0) => {
      const [x, y] = C.profile(z)[0];
      return new Vector3(side * (x - 0.07), y + 0.01 + up, z);
    };
    const rail = (z: number, side: number) => {
      const [x, y] = C.profile(z)[CABIN_RAIL];
      return new Vector3(side * (x - 0.06), y - 0.06, z);
    };
    const tube = (a: Vector3, b: Vector3, r = 0.02) => {
      const len = a.distanceTo(b);
      const g = new CylinderGeometry(r, r, len, 6, 1, true);
      g.applyQuaternion(
        new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          b.clone().sub(a).normalize(),
        ),
      );
      const mid = a.clone().add(b).multiplyScalar(0.5);
      g.translate(mid.x, mid.y, mid.z);
      cage.push(nonIndexed(g));
    };
    const zh = bz - 0.06;
    const zA = c.zFront - 0.1;
    const zRF = c.roofFront - 0.03;
    const zRR = Math.max(c.zRear + 0.12, c.roofRear - 0.25);
    if (rally) {
      tube(rail(zh, 1), rail(zh, -1));
      tube(rail(zRF, 1), rail(zRF, -1));
      tube(rail(zRF, 1), rail(zh, -1));
      tube(belt(zA, 1), belt(zA, -1), 0.018);
      tube(rail(zh, 1), belt(zh, -1));
      for (const side of [1, -1]) {
        tube(belt(zh, side), rail(zh, side));
        tube(belt(zA, side), rail(zRF, side));
        tube(rail(zRF, side), rail(zh, side));
        tube(rail(zh, side), belt(zRR, side));
        tube(belt(zA, side, 0.1), belt(zh, side, 0.22), 0.018);
      }
    }
    // Bucket seats (light shells) + dash + steering wheel (left-hand drive).
    const hw = C.profile(zh)[0][0];
    const sb = station(zh - 0.3).belt;
    for (const side of [1, -1]) {
      const x = side * Math.min(0.34, hw * 0.48);
      const zs = zh - 0.32;
      const seat = rally ? cage : interior;
      seat.push(rbox(0.44, 0.52, 0.1, 0.035, x, sb + 0.0, zs, -0.22));
      for (const s2 of [1, -1])
        seat.push(
          box(0.07, 0.16, 0.17, x + s2 * 0.19, sb + 0.15, zs + 0.03, -0.22),
        );
    }
    const sd = station(c.zFront - 0.25).belt;
    // Imported body: the generic loft is wider and higher than its real cowl, so the dash stays low and narrow.
    interior.push(
      addOnsOnly
        ? box(1.2, 0.07, 0.3, 0, sd - 0.03, c.zFront - 0.3)
        : box(
            C.profile(c.zFront - 0.25)[0][0] * 1.8,
            0.1,
            0.3,
            0,
            sd + 0.07,
            c.zFront - 0.27,
          ),
    );
    const wheel = new TorusGeometry(0.15, 0.016, 6, 20);
    wheel.rotateX(-0.45);
    wheel.translate(
      Math.min(0.34, hw * 0.48),
      sd + (addOnsOnly ? 0.08 : 0.17),
      c.zFront - 0.5,
    );
    interior.push(nonIndexed(wheel));
  }

  // --- door shut lines + handles --------------------------------------------------------
  function buildDoors(): void {
    const seams =
      doors === 4
        ? [
            c.zFront - 0.04,
            bz + 0.02,
            wide ? body.fenderRear[1] + 0.03 : c.roofRear + 0.08,
          ]
        : [c.zFront - 0.04, bz - 0.15];
    const sillY = (z: number) =>
      wide ? body.flare(z).top + 0.035 : station(z).floor + 0.06;
    const beltY = (z: number) => station(z).belt - 0.03;
    for (const zs of seams)
      trim.push(
        L.patch(zs - 0.004, zs + 0.004, yBand(sillY, beltY, 0), {
          offset: 0.002,
          step: 0.008,
        }),
      );
    for (let i = 0; i < seams.length - 1; i++) {
      const z = seams[i + 1] + 0.1;
      trim.push(
        L.patch(
          z - 0.06,
          z + 0.06,
          yBand(
            (zz) => station(zz).belt - 0.12,
            (zz) => station(zz).belt - 0.095,
            0,
          ),
          { offset: 0.004, step: 0.01 },
        ),
      );
    }
  }

  // --- modern Rally1 wide body --------------------------------------------------------------
  function buildRally1Body(): void {
    const capF = L.profile(zf);
    const capR = L.profile(zr);
    const sf = station(zf);
    const sr = station(zr);
    const ZF = zf + 0.003;
    const ZR = zr - 0.003;
    const belt = (z: number) => station(z).belt;
    const [ff0] = body.fenderFront;
    const [, rr1] = body.fenderRear;

    // Nose: big lower intake, slim upper grille.
    const b = sf.belt;
    const g0 = sf.floor + 0.07;
    const g1 = sf.floor + 0.3;
    const gx0 = capX(capF, g0) * 0.6;
    const gx1 = capX(capF, g1) * 0.5;
    const trap = (x0: number, y0: number, x1: number, y1: number, e = 0) =>
      [
        [-x0 - e, y0 - e],
        [x0 + e, y0 - e],
        [x1 + e, y1 + e],
        [-x1 - e, y1 + e],
      ] as [number, number][];
    carbon.push(capShape(trap(gx0, g0, gx1, g1, 0.03), ZF, false, false));
    mesh.push(capShape(trap(gx0, g0, gx1, g1), ZF + 0.003, false, false));
    const u0 = b - 0.15;
    const u1 = b - 0.085;
    trim.push(capShape(trap(0.26, u0, 0.3, u1, 0.015), ZF, false, false));
    mesh.push(capShape(trap(0.26, u0, 0.3, u1), ZF + 0.003, false, false));
    // Bumper corner intakes.
    const i0 = sf.floor + 0.09;
    const i1 = sf.floor + 0.32;
    const ix = capX(capF, i0) - 0.05;
    const inlet = (e: number): [number, number][] => [
      [ix - 0.1 - e, i0 - e],
      [ix + e, i0 - e],
      [ix + e - 0.03, i1 + e],
      [ix - 0.08 - e, i1 + e],
    ];
    carbon.push(capShape(inlet(0.02), ZF, false));
    mesh.push(capShape(inlet(0), ZF + 0.003, false));

    // Headlights: swept teardrops wrapping round the nose corners.
    const hx = capX(capF, b - 0.08) - 0.008;
    const lamp = (e: number): [number, number][] => [
      [hx + e, b - 0.025 + e],
      [hx - 0.2, b - 0.04 + e],
      [hx - 0.29 - e, b - 0.08],
      [hx - 0.24, b - 0.12 - e],
      [hx + e, b - 0.15 - e],
    ];
    trim.push(capShape(lamp(0.015), ZF, false));
    lights.push(capShape(lamp(0), ZF + 0.003, false));
    const lampSide =
      (pad: number): Range =>
      (z, pts) => {
        const t = (z - (zf - 0.36)) / 0.36;
        const yT = belt(z) - 0.025 + pad;
        const yB = belt(z) - 0.025 - 0.125 * smoothstep(0, 0.75, t) - pad;
        return yT - yB > 0.004 ? [idxAtY(pts, yB), idxAtY(pts, yT)] : null;
      };
    framed(lights, trim, zf - 0.36, zf, lampSide);

    // Splitter with endplates.
    const W = L.profile(zf - 0.3)[3][0] - 0.01;
    const sy = Math.max(0.1, sf.floor - 0.004);
    carbon.push(
      planPlate(
        [
          [-W, zf - 0.36],
          [W, zf - 0.36],
          [W, zf + 0.02],
          [W - 0.1, zf + 0.12],
          [0.25, zf + 0.15],
          [-0.25, zf + 0.15],
          [-W + 0.1, zf + 0.12],
          [-W, zf + 0.02],
        ],
        sy,
        0.025,
      ),
    );
    for (const side of [1, -1]) {
      carbon.push(
        sidePlate(
          [
            [zf - 0.34, sy - 0.01],
            [zf + 0.04, sy - 0.01],
            [zf - 0.02, sy + 0.1],
            [zf - 0.2, sy + 0.17],
          ],
          side * (W - 0.008),
          0.012,
        ),
      );
      if (parts.canards)
        for (const [dy, dz] of [
          [0.2, -0.1],
          [0.29, -0.13],
        ])
          carbon.push(
            box(
              0.09,
              0.012,
              0.2,
              side * (capX(capF, sf.floor + dy) + 0.025),
              sf.floor + dy,
              zf + dz,
              0,
              side * 0.25,
              side * -0.22,
            ),
          );
    }

    // Bonnet: louvred vents behind the headlights + a cowl strip.
    if (parts.hoodVents) {
      const vent =
        (pad: number): Range =>
        (z, pts) => {
          const t = (z - (zf - 0.62)) / 0.34;
          const hb = station(z).hwBelt;
          const xo = hb * 0.9 + pad;
          const xi = hb * (0.86 - 0.3 * smoothstep(0, 0.8, t)) - pad;
          return xo - xi > 0.004 ? [idxAtX(pts, xo), idxAtX(pts, xi)] : null;
        };
      carbon.push(L.patch(zf - 0.64, zf - 0.26, vent(0.02), { offset: 0.003 }));
      mesh.push(L.patch(zf - 0.62, zf - 0.28, vent(0), { offset: 0.0055 }));
    }
    trim.push(
      L.patch(c.zFront - 0.005, c.zFront + 0.06, (z, pts) => [
        idxAtX(pts, station(z).hwBelt * 0.9),
        pts.length - 1,
      ]),
    );

    // Fender exit vents behind both wheels.
    for (const axle of [p.front, p.rear]) {
      const z1 = axle.z - R - 0.035;
      const z0 = z1 - (axle === p.front ? 0.12 : 0.1);
      framed(mesh, carbon, z0, z1, (pad) =>
        yBand(
          () => wr + 0.03,
          () => body.archTop + 0.03,
          pad,
        ),
      );
    }
    // Rear quarter cooling vent above the rear arch.
    {
      const z0 = p.rear.z + 0.02;
      const z1 = p.rear.z + 0.38;
      const round = (z: number) =>
        Math.sqrt(
          Math.max(
            0,
            smoothstep(z0 - 0.02, z0 + 0.06, z) *
              (1 - smoothstep(z1 - 0.06, z1 + 0.02, z)),
          ),
        );
      framed(mesh, carbon, z0, z1, (pad) => (z, pts) => {
        const mid = belt(z) - 0.135;
        const h = 0.065 * round(z) + pad;
        return h > 0.004 ? [idxAtY(pts, mid - h), idxAtY(pts, mid + h)] : null;
      });
    }

    // Side skirts: carbon over the flared sill + a protruding blade.
    if (parts.sideSkirts) {
      carbon.push(
        L.patch(rr1 - 0.02, ff0 + 0.02, (z, pts) => [
          0.95,
          idxAtY(
            pts,
            Math.min(body.flare(z).top - 0.012, station(z).floor + 0.13),
          ),
        ]),
      );
      for (const side of [1, -1]) {
        const outline: [number, number][] = [];
        const n = 10;
        for (let i = 0; i <= n; i++) {
          const z = rr1 + ((ff0 - rr1) * i) / n;
          outline.push([side * (L.profile(z)[3][0] + 0.04), z]);
        }
        for (let i = n; i >= 0; i--) {
          const z = rr1 + ((ff0 - rr1) * i) / n;
          outline.push([side * (L.profile(z)[3][0] - 0.06), z]);
        }
        carbon.push(
          planPlate(outline, station((rr1 + ff0) / 2).floor + 0.012, 0.014),
        );
      }
    }

    // Mirrors: carbon pods on stalks.
    for (const side of [1, -1]) {
      const zm = c.zFront - 0.2;
      const sm = station(zm);
      carbon.push(
        rbox(
          0.07,
          0.15,
          0.12,
          0.02,
          side * (sm.hwBelt + 0.13),
          sm.belt + 0.17,
          zm,
        ),
      );
      carbon.push(
        box(
          0.12,
          0.022,
          0.05,
          side * (sm.hwBelt + 0.06),
          sm.belt + 0.1,
          zm + 0.01,
          0,
          0,
          side * 0.6,
        ),
      );
      trim.push(
        box(
          0.012,
          0.12,
          0.09,
          side * (sm.hwBelt + 0.13),
          sm.belt + 0.17,
          zm - 0.062,
          0,
          0,
          0,
        ),
      );
    }

    // Roof: scoop, antennas, small vents, spoiler lip.
    const ry = c.roofY + 0.035;
    plain.push(rbox(0.36, 0.1, 0.44, 0.045, 0, ry + 0.02, c.roofFront - 0.36));
    trim.push(box(0.28, 0.05, 0.02, 0, ry + 0.035, c.roofFront - 0.135));
    for (const side of [1, -1]) {
      trim.push(
        cyl(0.004, 0.16, 5, side * 0.12, ry + 0.08, c.roofRear + 0.3, 'y'),
      );
      trim.push(box(0.07, 0.012, 0.05, side * 0.28, ry, c.roofFront - 0.12));
    }
    plain.push(
      box(
        c.roofHw * 1.85,
        0.025,
        0.16,
        0,
        c.roofY + 0.03,
        c.roofRear - 0.06,
        -0.18,
      ),
    );

    // Tail: wrap-around lamps, black lower bumper, diffuser, exhaust.
    const tb = sr.belt;
    const tx = capX(capR, tb - 0.09) - 0.006;
    const tlamp = (e: number): [number, number][] => [
      [tx + e, tb - 0.04 + e],
      [tx - 0.24, tb - 0.06 + e],
      [tx - 0.32 - e, tb - 0.1],
      [tx - 0.26, tb - 0.135 - e],
      [tx + e, tb - 0.14 - e],
    ];
    trim.push(capShape(tlamp(0.012), ZR, true));
    tail.push(capShape(tlamp(0), ZR - 0.003, true));
    framed(tail, trim, zr, zr + 0.28, (pad) => (z, pts) => {
      const t = (zr + 0.28 - z) / 0.28;
      const yT = belt(z) - 0.05 + pad;
      const yB = belt(z) - 0.05 - 0.075 * smoothstep(0, 0.6, t) - pad;
      return yT - yB > 0.004 ? [idxAtY(pts, yB), idxAtY(pts, yT)] : null;
    });
    const lx0 = capR[1][0] - 0.004;
    const lx1 = capX(capR, sr.floor + 0.2) - 0.004;
    carbon.push(
      capShape(
        trap(lx0, sr.floor + 0.004, lx1, sr.floor + 0.22),
        ZR,
        true,
        false,
      ),
    );
    // Bumper reflectors.
    tail.push(
      capShape(
        [
          [lx1 - 0.13, sr.floor + 0.15],
          [lx1 - 0.04, sr.floor + 0.15],
          [lx1 - 0.04, sr.floor + 0.19],
          [lx1 - 0.13, sr.floor + 0.19],
        ],
        ZR - 0.003,
        true,
      ),
    );
    if (parts.diffuser) {
      // Sloped tray rising to the bumper, with vertical strakes under it.
      const dw = lx0 - 0.06;
      const yr = sr.floor - 0.02;
      carbon.push(
        sidePlate(
          [
            [zr + 0.42, 0.2],
            [zr - 0.04, yr],
            [zr - 0.04, yr - 0.018],
            [zr + 0.42, 0.182],
          ],
          0,
          dw * 2,
        ),
      );
      for (let i = -2; i <= 2; i++)
        carbon.push(
          sidePlate(
            [
              [zr + 0.4, 0.19],
              [zr - 0.04, yr - 0.01],
              [zr - 0.04, yr - 0.12],
              [zr + 0.25, 0.15],
            ],
            (i * dw) / 2.4,
            0.01,
          ),
        );
    }
    trim.push(
      cyl(0.05, 0.24, 14, -0.32, sr.floor + 0.06, zr + 0.06, 'z', true),
    );
    trim.push(cyl(0.04, 0.01, 12, -0.32, sr.floor + 0.06, zr + 0.12, 'z'));
  }

  // --- classic body (older cars) ---------------------------------------------------------------
  function buildClassicBody(): void {
    const sf = station(zf - 0.05);
    const lightY = (sf.floor + sf.belt) / 2 + 0.06;
    const grille = parts.grille ?? 'small';
    if (grille === 'slats') {
      // 70s full-width black grille with slats.
      const gw = sf.hwBelt * 1.0;
      trim.push(box(gw, 0.17, 0.04, 0, lightY, zf - 0.005));
      for (let i = 0; i < 4; i++)
        plain.push(
          box(gw * 0.98, 0.012, 0.012, 0, lightY - 0.06 + i * 0.04, zf + 0.018),
        );
    } else {
      trim.push(box(sf.hw * 0.9, 0.16, 0.04, 0, sf.floor + 0.2, zf - 0.02));
    }
    trim.push(box(sf.hw * 1.8, 0.03, 0.2, 0, sf.floor + 0.02, zf - 0.08));
    for (const side of [1, -1]) {
      if ((parts.headlights ?? 'rect') === 'round') {
        lights.push(
          cyl(0.085, 0.05, 14, side * sf.hwBelt * 0.66, lightY, zf - 0.02, 'z'),
        );
      } else {
        const gw = sf.hwBelt * 1.0;
        lights.push(
          box(0.2, 0.13, 0.05, side * (gw / 2 + 0.12), lightY, zf - 0.01),
        );
        // Amber indicator under it.
        tail.push(
          box(0.12, 0.04, 0.03, side * (gw / 2 + 0.12), lightY - 0.12, zf),
        );
      }
    }
    if (parts.bumpers === 'black') {
      const sr = station(zr + 0.05);
      for (const [z, s] of [
        [zf + 0.03, sf],
        [zr - 0.03, sr],
      ] as const) {
        trim.push(box(s.hw * 1.95, 0.11, 0.1, 0, s.floor + 0.1, z));
        for (const side of [1, -1])
          trim.push(
            box(
              0.06,
              0.11,
              0.3,
              side * s.hw * 0.95,
              s.floor + 0.1,
              z - Math.sign(z) * 0.14,
            ),
          );
      }
    }
    for (const side of [1, -1]) {
      const sr = station(zr + 0.05);
      tail.push(
        box(
          0.3,
          0.12,
          0.05,
          side * sr.hwBelt * 0.72,
          sr.belt - 0.12,
          zr + 0.01,
        ),
      );
      const sm = station(c.zFront - 0.25);
      plain.push(
        box(
          0.17,
          0.11,
          0.09,
          side * (sm.hwBelt + 0.12),
          sm.belt + 0.13,
          c.zFront - 0.25,
        ),
      );
      trim.push(
        box(
          0.1,
          0.025,
          0.04,
          side * (sm.hwBelt + 0.04),
          sm.belt + 0.09,
          c.zFront - 0.22,
        ),
      );
    }
    const se = station(zr);
    trim.push(
      cyl(0.045, 0.22, 10, -se.hw * 0.6, se.floor + 0.06, zr, 'z', true),
    );
  }

  // --- bolt-on kit (also used on imported bodies) ------------------------------------------------
  const pod = parts.lightPod ?? 0;
  if (pod > 0) {
    const zp = zf - 0.22;
    const sp = station(zp);
    trim.push(
      box(sp.hwBelt * (pod > 2 ? 1.5 : 0.9), 0.2, 0.08, 0, sp.belt + 0.16, zp),
    );
    for (let i = 0; i < pod; i++) {
      const x = (i - (pod - 1) / 2) * sp.hwBelt * 0.38;
      lights.push(cyl(0.075, 0.06, 14, x, sp.belt + 0.16, zp + 0.05, 'z'));
    }
  }
  if (parts.roofVent)
    trim.push(box(0.3, 0.07, 0.26, 0, c.roofY + 0.05, c.roofFront - 0.25));
  const wing = parts.rearWing ?? 'none';
  if (wing === 'lip') {
    plain.push(
      box(
        c.roofHw * 2.1,
        0.035,
        0.32,
        0,
        c.roofY + 0.06,
        c.roofRear - 0.08,
        -0.12,
      ),
    );
    for (const side of [1, -1])
      trim.push(
        box(
          0.02,
          0.12,
          0.34,
          side * c.roofHw * 1.05,
          c.roofY + 0.03,
          c.roofRear - 0.08,
        ),
      );
  } else if (wing === 'rally1') {
    rally1Wing();
  }

  /** Big swan-neck wing overhanging the hatch, with tall wedge endplates. */
  function rally1Wing(): void {
    const sr = station(zr);
    const ry = c.roofY;
    const half = Math.max(c.roofHw + 0.06, station(c.zRear).hwBelt * 0.9);
    const yTop = ry + 0.08;
    const zLE = zr + 0.14;
    const chord = 0.33;
    const yLE = yTop - 0.075;
    const rise = 0.05;
    // Main plane (inverted aerofoil, trailing edge up) + upper flap.
    const foil = (z0: number, y0: number, ch: number, up: number, th: number) =>
      [
        [z0, y0],
        [z0 - ch * 0.08, y0 + th * 0.6],
        [z0 - ch * 0.4, y0 + th * 0.75 + up * 0.4],
        [z0 - ch, y0 + up + th * 0.1],
        [z0 - ch, y0 + up - th * 0.1],
        [z0 - ch * 0.45, y0 - th * 0.35 + up * 0.4],
        [z0 - ch * 0.1, y0 - th * 0.35],
      ] as [number, number][];
    carbon.push(sidePlate(foil(zLE, yLE, chord, rise, 0.045), 0, half * 2));
    carbon.push(
      sidePlate(
        foil(zLE - chord + 0.07, yLE + rise + 0.03, 0.11, 0.05, 0.018),
        0,
        half * 2,
      ),
    );
    for (const side of [1, -1]) {
      // Endplate: tall at the back, front edge leaning forward over the hatch.
      carbon.push(
        sidePlate(
          [
            [zr + 0.46, yTop - 0.05],
            [zr - 0.22, yTop + 0.01],
            [zr - 0.2, sr.belt + 0.02],
            [zr + 0.2, sr.belt + 0.05],
          ],
          side * (half + 0.006),
          0.012,
        ),
      );
      // Swan-neck pylon from the hatch up to the wing.
      const hb = station(zr + 0.3).belt + 0.03;
      carbon.push(
        sidePlate(
          [
            [zr + 0.34, hb],
            [zr + 0.24, hb],
            [zLE - 0.2, yLE - 0.005],
            [zLE - 0.04, yLE - 0.005],
            [zLE - 0.02, yLE - 0.1],
          ],
          side * 0.24,
          0.014,
        ),
      );
    }
  }

  return {
    plain: mergeAll(plain),
    trim: mergeAll(trim),
    carbon: mergeAll(carbon),
    mesh: mergeAll(mesh),
    glass: mergeAll(glass),
    lights: mergeAll(lights),
    tail: mergeAll(tail),
    amber: mergeAll(amber),
    interior: mergeAll(interior),
    cage: mergeAll(cage),
    lining: mergeAll(lining),
  };
}
