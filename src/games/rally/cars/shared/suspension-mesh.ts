import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SetupPreset } from '../../physics/types';

/**
 * Coil-over / strut geometry for the setup screen's parts bench (and later the in-car suspension). Local frame:
 * y = 0 at the lower mount, y up to `suspensionLength`, the unit stands upright, +x = the side the reservoir
 * (rally / race) sticks out to. Three geometries so the caller colours them separately: `body` (the damper
 * housing - anodised / black / silver), `chrome` (shaft, reservoir details, mounts) and `spring` (coloured by
 * the preset: yellow soft -> orange -> red stiff, physics/car-setup.ts).
 *
 * Style = how the car's hardware looks (CarDef.model.suspensionStyle):
 *   rally - long gold coil-over, remote reservoir on a hose, long soft spring
 *   road  - plain black MacPherson strut with a ribbed rubber boot and a thin spring
 *   race  - short stubby silver coil-over, piggyback reservoir with an adjuster knob and a helper spring
 *   wrc   - blue medium coil-over, reservoir tube beside the housing, rubber bump-stop boot
 *   evo   - slim red coil-over, short piggyback reservoir high on the housing, threaded spring seat
 * The spring gets fewer, thicker coils the stiffer the rate; the whole unit is longer the more travel the preset
 * has (soft = long).
 */
export type SuspensionStyle = 'rally' | 'road' | 'race' | 'gt' | 'wrc' | 'evo';

export const SUSPENSION_STYLE_COLORS: Record<
  SuspensionStyle,
  { body: number; chrome: number }
> = {
  rally: { body: 0xd4a017, chrome: 0xc8ccd0 },
  road: { body: 0x1b1b1d, chrome: 0x9a9da0 },
  race: { body: 0xb9bdc3, chrome: 0xd2d5d9 },
  gt: { body: 0x2a56a8, chrome: 0xc4c8cc },
  wrc: { body: 0x2a62c9, chrome: 0xc8ccd0 },
  evo: { body: 0xc8281e, chrome: 0xc8ccd0 },
};

/** Installed length (m) of a unit for a preset's travel. */
export const suspensionLength = (travel: number): number => 0.3 + 1.1 * travel;

/** Coil count and wire radius (m) for a spring rate (N/m): stiffer = fewer, thicker coils. */
export function springShape(rate: number): { coils: number; wire: number } {
  const k = rate / 1000;
  return {
    coils: Math.min(12, Math.max(5, 14 - k / 10)),
    wire: 0.004 + k * 0.00006,
  };
}

export interface CoiloverGeometry {
  body: BufferGeometry;
  chrome: BufferGeometry;
  spring: BufferGeometry;
  length: number;
}

const nonIndexed = (g: BufferGeometry): BufferGeometry => {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  return out;
};

const merge = (parts: BufferGeometry[]): BufferGeometry => {
  const g = mergeGeometries(parts.map(nonIndexed), false)!;
  parts.forEach((p) => p.dispose());
  return g;
};

/** Cylinder from y0 to y1 at (x, z). */
function rod(r: number, y0: number, y1: number, x = 0, z = 0, seg = 14) {
  const g = new CylinderGeometry(r, r, y1 - y0, seg, 1);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

function helix(
  radius: number,
  wire: number,
  y0: number,
  y1: number,
  coils: number,
): BufferGeometry {
  const steps = Math.round(coils * 16);
  const pts: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * coils * Math.PI * 2;
    pts.push(
      new Vector3(
        Math.cos(a) * radius,
        y0 + (y1 - y0) * t,
        Math.sin(a) * radius,
      ),
    );
  }
  return new TubeGeometry(new CatmullRomCurve3(pts), steps, wire, 6, false);
}

/** One unit for a car style and a preset (front axle numbers: `axle` picks front / rear spring rate). */
export function buildCoilover(
  style: SuspensionStyle,
  preset: SetupPreset,
  axle: 'front' | 'rear' = 'front',
): CoiloverGeometry {
  const L = suspensionLength(preset.travel);
  const { coils, wire } = springShape(preset[axle].spring);
  const body: BufferGeometry[] = [];
  const chrome: BufferGeometry[] = [];
  const spring: BufferGeometry[] = [];

  if (style === 'rally') {
    // Long housing at the bottom, shaft up through a long spring to the top mount.
    body.push(rod(0.03, 0, L * 0.5));
    chrome.push(rod(0.012, L * 0.5, L * 0.97, 0, 0, 10));
    chrome.push(rod(0.034, L * 0.97, L, 0, 0, 12)); // top mount
    chrome.push(rod(0.052, L * 0.5, L * 0.5 + 0.008, 0, 0, 16)); // lower perch
    chrome.push(rod(0.052, L * 0.93, L * 0.93 + 0.008, 0, 0, 16)); // upper perch
    spring.push(helix(0.046, wire, L * 0.5 + 0.008, L * 0.93, coils));
    // Remote reservoir on the housing, joined by a hose.
    body.push(rod(0.024, L * 0.18, L * 0.18 + 0.13, 0.085, 0, 12));
    chrome.push(rod(0.026, L * 0.18 + 0.13, L * 0.18 + 0.145, 0.085, 0, 12));
    const hose = new CatmullRomCurve3([
      new Vector3(0.03, L * 0.4, 0),
      new Vector3(0.07, L * 0.36, 0.01),
      new Vector3(0.085, L * 0.3, 0),
    ]);
    chrome.push(new TubeGeometry(hose, 8, 0.005, 5, false));
  } else if (style === 'road') {
    // Plain MacPherson strut: black tube, ribbed boot over the shaft, thin spring, rubber top mount.
    body.push(rod(0.024, 0, L * 0.55, 0, 0, 12));
    chrome.push(rod(0.011, L * 0.55, L * 0.98, 0, 0, 10));
    chrome.push(rod(0.04, L * 0.96, L, 0, 0, 14));
    for (let i = 0; i < 6; i++) {
      const y = L * 0.58 + i * 0.026;
      body.push(
        new TorusGeometry(0.022, 0.006, 5, 12)
          .rotateX(Math.PI / 2)
          .translate(0, y, 0),
      );
    }
    chrome.push(rod(0.05, L * 0.4, L * 0.4 + 0.007, 0, 0, 14)); // lower perch
    spring.push(helix(0.04, wire * 0.85, L * 0.4 + 0.007, L * 0.92, coils));
  } else if (style === 'evo') {
    // Slim red housing, short piggyback reservoir high on the body, a threaded spring seat that rides on the housing.
    body.push(rod(0.028, 0, L * 0.52));
    body.push(rod(0.02, L * 0.3, L * 0.3 + 0.1, 0.06, 0, 12));
    chrome.push(rod(0.012, L * 0.3 + 0.1, L * 0.3 + 0.115, 0.06, 0, 8)); // adjuster
    chrome.push(rod(0.012, L * 0.52, L * 0.97, 0, 0, 10));
    chrome.push(rod(0.034, L * 0.97, L, 0, 0, 12));
    chrome.push(rod(0.048, L * 0.5, L * 0.5 + 0.008, 0, 0, 16));
    chrome.push(rod(0.048, L * 0.92, L * 0.92 + 0.008, 0, 0, 16));
    spring.push(helix(0.042, wire, L * 0.5 + 0.008, L * 0.92, coils));
  } else if (style === 'wrc') {
    // World Rally Car: medium housing with a reservoir tube beside it (clamped at both ends), bump-stop boot on the shaft.
    body.push(rod(0.032, 0, L * 0.5));
    body.push(rod(0.019, L * 0.1, L * 0.45, 0.07, 0, 12));
    chrome.push(rod(0.024, L * 0.1, L * 0.1 + 0.012, 0.07, 0, 12));
    chrome.push(rod(0.024, L * 0.45 - 0.012, L * 0.45, 0.07, 0, 12));
    chrome.push(rod(0.012, L * 0.5, L * 0.97, 0, 0, 10));
    chrome.push(rod(0.034, L * 0.97, L, 0, 0, 12));
    chrome.push(rod(0.05, L * 0.5, L * 0.5 + 0.008, 0, 0, 16));
    chrome.push(rod(0.05, L * 0.9, L * 0.9 + 0.008, 0, 0, 16));
    body.push(rod(0.02, L * 0.78, L * 0.9, 0, 0, 10)); // bump-stop boot
    spring.push(helix(0.044, wire, L * 0.5 + 0.008, L * 0.9, coils));
  } else {
    // Race: short fat housing, piggyback reservoir with an adjuster knob, a small helper spring on top.
    body.push(rod(0.036, 0, L * 0.46));
    body.push(rod(0.022, L * 0.12, L * 0.12 + 0.11, 0.07, 0, 12));
    chrome.push(rod(0.012, L * 0.46, L * 0.97, 0, 0, 10));
    chrome.push(rod(0.034, L * 0.97, L, 0, 0, 12));
    chrome.push(rod(0.056, L * 0.46, L * 0.46 + 0.008, 0, 0, 16));
    chrome.push(rod(0.056, L * 0.86, L * 0.86 + 0.008, 0, 0, 16));
    chrome.push(rod(0.012, L * 0.12 + 0.11, L * 0.12 + 0.135, 0.07, 0, 8)); // adjuster knob
    chrome.push(rod(0.02, L * 0.12 + 0.032, L * 0.12 + 0.038, 0.045, 0, 8)); // block
    spring.push(helix(0.05, wire, L * 0.46 + 0.008, L * 0.86, coils * 0.85));
    chrome.push(helix(0.034, 0.003, L * 0.88, L * 0.96, 3)); // helper spring (always chrome)
  }
  return {
    body: merge(body),
    chrome: merge(chrome),
    spring: merge(spring),
    length: L,
  };
}
