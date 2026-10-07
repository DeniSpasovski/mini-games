import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TyreId } from '../../physics/tyres';
import { loadCarModelFile } from './car-gltf';
import type { CarDef } from './types';

/**
 * Wheels converted from 3D-print STLs (`model.wheelModel`, e.g. the Skoda Rally rim + tyre):
 * scripts/car-model/wheel-stl-to-glb.mjs writes a GLB with a `rim` and a `tyre` mesh in UNIT wheel
 * space - x = axle (outer face +x, tyre centre 0, 1 = tyre width), y / z radial (1 = tyre radius).
 * Each car scales them to its physics wheel size. The rim face is open between the spokes, so the
 * brake disc + caliper from `buildBrakeGeometries` show through.
 *
 * Proportions of the converted rim (fractions of the tyre radius R / width W): barrel inside 0.62 R,
 * spoke backs at +0.29 W, hub ring back at +0.17 W, centre bore 0.125 R.
 */
export function hasWheelModel(file: string | undefined): file is string {
  return !!file && __CAR_MODEL_FILES__.includes(file);
}

/** The wheel GLB fitted on a compound (`model.wheelByCompound` over `model.wheelModel`; null tyre = the default). */
export function wheelModelFor(
  model: CarDef['model'],
  tyre: TyreId | null,
): string | undefined {
  return (tyre && model.wheelByCompound?.[tyre]?.model) || model.wheelModel;
}

/** Rim colour on a compound (`model.wheelByCompound` over `model.rim.color`). */
export function rimColorFor(
  model: CarDef['model'],
  tyre: TyreId | null,
): string {
  return (tyre && model.wheelByCompound?.[tyre]?.rimColor) || model.rim.color;
}

/** Every distinct wheel GLB of a car that exists in this build, loaded as unit rims by file name. */
export async function loadRimUnits(
  model: CarDef['model'],
): Promise<Map<string, BufferGeometry>> {
  const files = new Set(
    [
      model.wheelModel,
      ...Object.values(model.wheelByCompound ?? {}).map((c) => c?.model),
    ].filter(hasWheelModel),
  );
  const out = new Map<string, BufferGeometry>();
  await Promise.all(
    [...files].map(async (f) => {
      try {
        out.set(f, await loadRimUnit(f));
      } catch (e) {
        console.warn(`[car] wheel model ${f} failed, procedural`, e);
      }
    }),
  );
  return out;
}

/**
 * The rim of the wheel GLB in UNIT wheel space (owned by the caller; the file's own tyre mesh is not used - tyres
 * come from tyre-mesh.ts). Scale it per tyre size: x = tyre width, y / z = `RIM_UNIT_SCALE` conversion below.
 */
export async function loadRimUnit(file: string): Promise<BufferGeometry> {
  const scene = await loadCarModelFile(file);
  const mesh = scene.getObjectByName('rim');
  if (!(mesh instanceof Mesh)) throw new Error(`${file}: no "rim" mesh`);
  return (mesh.geometry as BufferGeometry).clone();
}

/** The converted rim's barrel radius in unit wheel space (see the proportions above). */
export const RIM_UNIT_BARREL = 0.62;

/**
 * Brake disc (with its hat closing the rim's centre bore) and caliper sized for the converted rim.
 * Wheel space as above, in metres; the caliper sits at the top rear of the disc.
 */
export function buildBrakeGeometries(
  radius: number,
  width: number,
): { disc: BufferGeometry; caliper: BufferGeometry } {
  const R = radius;
  const W = width;
  const axle = (g: BufferGeometry, x: number) => {
    g.rotateZ(-Math.PI / 2);
    g.translate(x, 0, 0);
    return g.toNonIndexed();
  };
  const discX = -0.04 * W;
  const parts = [
    axle(new CylinderGeometry(0.5 * R, 0.5 * R, 0.028, 28, 1), discX),
    // Hat: from the disc out to just behind the hub ring.
    axle(
      new CylinderGeometry(0.2 * R, 0.24 * R, 0.17 * W, 18, 1),
      discX + 0.085 * W,
    ),
  ];
  const disc = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());

  const caliper = new BoxGeometry(0.075, 0.17 * R, 0.42 * R);
  caliper.translate(discX, 0.47 * R, 0);
  caliper.rotateX(-0.6);
  return { disc, caliper };
}
