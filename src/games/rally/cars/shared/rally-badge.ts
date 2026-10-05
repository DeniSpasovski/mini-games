import {
  BufferGeometry,
  CanvasTexture,
  Euler,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { CarDef } from './types';

/**
 * Rally door badge: the event plate every entry carries on both front doors -
 * our own design in the style of the ARA plates: game emblem top left, the car
 * number on the right, a chequered strip, and the rally name on an amber band.
 *
 * The plate is a decal projected onto the painted body (any body: procedural
 * loft, hand-built shell or imported GLB), so it follows the door's curvature.
 * Placement: `CarModelDef.doorBadge` (model space, metres), default from the cabin.
 */
export interface RallyBadge {
  /** Car (start) number, 1..99 - player option. */
  number: number;
  /** Rally name, from the map (see rallyName). */
  rally: string;
}

export const MIN_CAR_NUMBER = 1;
export const MAX_CAR_NUMBER = 99;

/** Plate aspect = canvas aspect (width / height). */
/** Plate width in metres - the same on every car; only the position (`doorBadge`) is per car. */
const BADGE_WIDTH = 0.6;
const CANVAS_W = 768;
const CANVAS_H = 416;
const AMBER = '#f0a020';
const INK = '#15171b';

/** Event title for a map: "Petralica" -> "PETRALICA RALLY" (kept as is if it already says rally). */
export function rallyName(mapName: string): string {
  const name = mapName.trim().toUpperCase();
  return /\bRALLY\b/.test(name) ? name : `${name} RALLY`;
}

export function clampCarNumber(n: number): number {
  return Math.min(
    MAX_CAR_NUMBER,
    Math.max(MIN_CAR_NUMBER, Math.round(Number.isFinite(n) ? n : 1)),
  );
}

/** Where the plate sits: centre (z, y) on the door, size in metres. */
export function badgePlacement(def: CarDef): {
  z: number;
  y: number;
  width: number;
  height: number;
} {
  const m = def.model;
  const c = m.cabin;
  const bPillar = c.bPillar ?? (c.roofFront + c.roofRear) / 2 + 0.05;
  const z = m.doorBadge?.z ?? (c.zFront + bPillar) / 2;
  const width = BADGE_WIDTH;
  const height = (width * CANVAS_H) / CANVAS_W;
  const belt = beltAt(def, z);
  return { z, y: m.doorBadge?.y ?? belt - height / 2 - 0.06, width, height };
}

function beltAt(def: CarDef, z: number): number {
  const st = def.model.stations;
  if (z <= st[0].z) return st[0].belt;
  for (let i = 1; i < st.length; i++)
    if (z <= st[i].z) {
      const t = (z - st[i - 1].z) / (st[i].z - st[i - 1].z);
      return st[i - 1].belt + (st[i].belt - st[i - 1].belt) * t;
    }
  return st[st.length - 1].belt;
}

// --- texture ------------------------------------------------------------------------------

/** Paint the plate (transparent outside the rounded corners). */
export function paintBadge(
  ctx: CanvasRenderingContext2D,
  badge: RallyBadge,
): void {
  const W = ctx.canvas.width;
  const k = W / CANVAS_W;
  ctx.save();
  ctx.scale(k, k);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // White rim + black plate.
  ctx.fillStyle = '#f4f4f2';
  roundRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 34);
  ctx.fill();
  ctx.fillStyle = INK;
  roundRect(ctx, 10, 10, CANVAS_W - 20, CANVAS_H - 20, 26);
  ctx.fill();

  // Rally name band (amber, bottom, clipped to the plate's rounded corners).
  const bandY = 300;
  ctx.save();
  roundRect(ctx, 10, 10, CANVAS_W - 20, CANVAS_H - 20, 26);
  ctx.clip();
  ctx.fillStyle = AMBER;
  ctx.fillRect(10, bandY, CANVAS_W - 20, CANVAS_H - bandY);
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(10, bandY - 8, CANVAS_W - 20, 8);
  ctx.restore();
  fitText(ctx, badge.rally, CANVAS_W / 2, bandY + 58, CANVAS_W - 70, 70, INK);

  // Number panel on the right, split off by a white rule.
  const nx0 = 486;
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(nx0 - 8, 30, 6, bandY - 58);
  fitText(
    ctx,
    String(badge.number),
    (nx0 + CANVAS_W - 14) / 2,
    bandY / 2 + 12,
    CANVAS_W - 14 - nx0 - 30,
    250,
    '#ffffff',
  );

  // Emblem: three amber slashes (gravel spray) + "GRAVEL / RALLY".
  ctx.fillStyle = AMBER;
  for (let i = 0; i < 3; i++) {
    const x = 34 + i * 30;
    ctx.beginPath();
    ctx.moveTo(x + 34, 38);
    ctx.lineTo(x + 56, 38);
    ctx.lineTo(x + 22, 172);
    ctx.lineTo(x, 172);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 900 70px "Arial Black", Impact, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('GRAVEL', 152, 100, nx0 - 176);
  ctx.fillStyle = AMBER;
  ctx.fillText('RALLY', 152, 170, nx0 - 176);

  // Chequered strip under the emblem.
  const cy = 200;
  const cs = 20;
  for (let i = 0; 34 + (i + 1) * cs <= nx0 - 30; i++)
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = (i + j) % 2 ? INK : '#f4f4f2';
      ctx.fillRect(34 + i * cs, cy + j * cs, cs, cs);
    }
  ctx.restore();
}

/** Bold condensed text centred on (x, y), squeezed horizontally to fit maxW. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  ctx.translate(x, y);
  if (w > maxW) ctx.scale(maxW / w, 1);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Badge material (owns its texture: dispose both). */
export function badgeMaterial(badge: RallyBadge): MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  paintBadge(canvas.getContext('2d')!, badge);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return new MeshStandardMaterial({
    map,
    roughness: 0.38,
    metalness: 0.05,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

// --- geometry -----------------------------------------------------------------------------

/** A painted body mesh to project onto: geometry + its transform into body (model) space. */
export interface BadgeTarget {
  geometry: BufferGeometry;
  matrix: Matrix4;
}

/** How far the plate floats above the paint (m). */
const LIFT = 0.004;

/**
 * Plate geometry on one side (+1 = left / +X, -1 = right), in body space. Only
 * outward-facing paint near the door is projected, so the cabin / far side never
 * catch it. Empty geometry if no body surface is there.
 */
export function buildBadgeGeometry(
  targets: BadgeTarget[],
  def: CarDef,
  side: 1 | -1,
): BufferGeometry {
  const { z, y, width, height } = badgePlacement(def);
  const margin = 0.08;
  const pos: number[] = [];
  const nrm: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const vn = new Vector3();
  // Outermost paint x under the plate (any kept vertex if none falls inside it).
  let surfX = -Infinity;
  let surfAny = -Infinity;
  for (const t of targets) {
    const p = t.geometry.getAttribute('position');
    if (!p) continue;
    const vNormal = t.geometry.getAttribute('normal');
    const nm = new Matrix3().getNormalMatrix(t.matrix);
    const idx = t.geometry.index;
    const count = idx ? idx.count : p.count;
    const at = (i: number) => (idx ? idx.getX(i) : i);
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(p, at(i)).applyMatrix4(t.matrix);
      b.fromBufferAttribute(p, at(i + 1)).applyMatrix4(t.matrix);
      c.fromBufferAttribute(p, at(i + 2)).applyMatrix4(t.matrix);
      if (
        Math.max(a.z, b.z, c.z) < z - width / 2 - margin ||
        Math.min(a.z, b.z, c.z) > z + width / 2 + margin ||
        Math.max(a.y, b.y, c.y) < y - height / 2 - margin ||
        Math.min(a.y, b.y, c.y) > y + height / 2 + margin
      )
        continue;
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      if (n.x * side < 0.02) continue;
      for (const [v, k] of [
        [a, i],
        [b, i + 1],
        [c, i + 2],
      ] as const) {
        pos.push(v.x, v.y, v.z);
        if (vNormal)
          vn.fromBufferAttribute(vNormal, at(k)).applyMatrix3(nm).normalize();
        else vn.copy(n);
        nrm.push(vn.x, vn.y, vn.z);
        surfAny = Math.max(surfAny, v.x * side);
        if (Math.abs(v.z - z) < width / 2 && Math.abs(v.y - y) < height / 2)
          surfX = Math.max(surfX, v.x * side);
      }
    }
  }
  if (!pos.length) return new BufferGeometry();
  if (!Number.isFinite(surfX)) surfX = surfAny;

  const near = new BufferGeometry();
  near.setAttribute('position', new Float32BufferAttribute(pos, 3));
  near.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  const depth = 0.3;
  const decal = new DecalGeometry(
    new Mesh(near),
    new Vector3(side * (surfX + 0.05 - depth / 2), y, z),
    new Euler(0, (side * Math.PI) / 2, 0),
    new Vector3(width, height, depth),
  );
  near.dispose();
  // One averaged normal for the whole plate: it lifts the plate off the paint in one piece
  // (per-vertex normals would tear it open along panel creases) and lights it evenly.
  const dp = decal.getAttribute('position');
  const dn = decal.getAttribute('normal');
  if (dn) {
    const avg = new Vector3();
    for (let i = 0; i < dn.count; i++) avg.add(vn.fromBufferAttribute(dn, i));
    avg.normalize();
    for (let i = 0; i < dp.count; i++) {
      dp.setXYZ(
        i,
        dp.getX(i) + avg.x * LIFT,
        dp.getY(i) + avg.y * LIFT,
        dp.getZ(i) + avg.z * LIFT,
      );
      dn.setXYZ(i, avg.x, avg.y, avg.z);
    }
  }
  return decal;
}
