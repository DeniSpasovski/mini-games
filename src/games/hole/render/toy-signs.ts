import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { Soup } from './soup';
import { applyHoleCut, createGroundMaterial } from './materials';
import type { MapData, ZoneInfo } from '../map/types';

/**
 * Wayfinding of the toy store, all render-only (derived from the map's zones and door):
 * - big painted department names on the floor (a transparent canvas decal, stencil-cut like the floor),
 * - chevron trails: up the central aisle from the entrance, and a branch to every department,
 * - department banners hung on the side walls.
 */
export const SIGN_Y = 0.07;
const TRAIL_Y = 0.05;

/** Darken a colour (0..1 = keep that much of each channel). */
export function shade(hex: number, k: number): number {
  const c = new Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

const textures = new Map<string, CanvasTexture>();

/** Cached canvas texture of one line of text; `bg` null = transparent (a floor decal). */
export function textTexture(
  text: string,
  fg: string,
  bg: string | null,
  outline: string | null,
): CanvasTexture {
  const key = `${text}|${fg}|${bg}|${outline}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 36);
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 170;
  g.font = `900 ${size}px system-ui, "Arial Black", sans-serif`;
  const max = W - 110;
  const w = g.measureText(text).width;
  if (w > max) {
    size = Math.floor((size * max) / w);
    g.font = `900 ${size}px system-ui, "Arial Black", sans-serif`;
  }
  if (outline) {
    g.lineWidth = size * 0.12;
    g.lineJoin = 'round';
    g.strokeStyle = outline;
    g.strokeText(text, W / 2, H / 2 + size * 0.04);
  }
  g.fillStyle = fg;
  g.fillText(text, W / 2, H / 2 + size * 0.04);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  return tex;
}

const css = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

export function signMaterial(
  tex: CanvasTexture,
  floor: boolean,
): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return floor ? applyHoleCut(m) : m;
}

/** A flat chevron (">" pointing along +dir) of size `s` at (x, z); dir is (dx, dz) normalised. */
function chevron(
  soup: Soup,
  x: number,
  z: number,
  dx: number,
  dz: number,
  s: number,
  color: number,
): void {
  // tip, two wing ends and two inner points (a V shape pointing along dir)
  const px = -dz;
  const pz = dx;
  const pt = (a: number, b: number): [number, number] => [
    x + dx * a + px * b,
    z + dz * a + pz * b,
  ];
  const t = s * 0.38; // arm thickness along dir
  soup.quad(
    [pt(s, 0), pt(s - t, 0), pt(-s * 0.2 - t, -s), pt(-s * 0.2, -s)],
    TRAIL_Y,
    color,
  );
  soup.quad(
    [pt(s, 0), pt(-s * 0.2, s), pt(-s * 0.2 - t, s), pt(s - t, 0)],
    TRAIL_Y,
    color,
  );
}

/** Floor names + chevron trails (stencil-cut ground) and department banners on the side walls. */
export function buildToySigns(map: MapData): Group {
  const group = new Group();
  const b = map.bounds;
  const zones = map.zones ?? [];
  if (!b || !zones.length) return group;
  const dx = b.door ?? 0;

  // ---- painted department names on the floor ---------------------------------------------
  for (const z of zones) {
    const zw = z.x1 - z.x0;
    const zd = z.z1 - z.z0;
    const w = Math.max(40, Math.min(zw * 0.5, zd * 1.4, 130));
    const h = w / 4;
    const cx = (z.x0 + z.x1) / 2;
    const cz = z.z1 - h * 0.7 - 5; // just inside the south (entrance side) edge
    const tex = textTexture(
      z.name.toUpperCase(),
      css(shade(z.color, 0.55)),
      null,
      'rgba(255,255,255,0.55)',
    );
    const m = new Mesh(
      new PlaneGeometry(w, h).rotateX(-Math.PI / 2),
      signMaterial(tex, true),
    );
    m.position.set(cx, SIGN_Y, cz);
    m.renderOrder = 2;
    group.add(m);
  }

  // ---- chevron trails ----------------------------------------------------------------------
  const soup = new Soup();
  const aisle = 0xe2a900;
  for (let zz = b.hz - 14; zz > -b.hz + 14; zz -= 14)
    chevron(soup, dx, zz, 0, -1, 2.6, aisle);
  for (const z of zones) {
    if (z.x0 <= dx && z.x1 >= dx) continue; // the aisle runs through it
    const zc = (z.z0 + z.z1) / 2;
    const east = z.x0 > dx;
    const from = dx + (east ? 7 : -7);
    const to = east ? z.x0 - 2 : z.x1 + 2;
    const dir = east ? 1 : -1;
    const color = shade(z.color, 0.62);
    for (let x = from; east ? x < to : x > to; x += dir * 10)
      chevron(soup, x, zc, dir, 0, 2.2, color);
  }
  if (soup.triangles) {
    const mesh = new Mesh(soup.geometry(), createGroundMaterial());
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---- banners on the side walls -----------------------------------------------------------
  for (const z of zones) {
    const side = z.x0 <= -b.hx + 0.5 ? -1 : z.x1 >= b.hx - 0.5 ? 1 : 0;
    if (!side) continue;
    banner(group, z, side, b.hx);
  }
  return group;
}

function banner(group: Group, z: ZoneInfo, side: -1 | 1, hx: number): void {
  const w = Math.min(46, (z.z1 - z.z0) * 0.62);
  const h = w / 4;
  const tex = textTexture(
    z.name.toUpperCase(),
    '#ffffff',
    css(shade(z.color, 0.62)),
    css(shade(z.color, 0.3)),
  );
  const m = new Mesh(new PlaneGeometry(w, h), signMaterial(tex, false));
  m.position.set(side * (hx - 0.9), 7.4, (z.z0 + z.z1) / 2);
  m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  m.renderOrder = 3;
  group.add(m);
}

/** "TOY EMPORIUM" sign over the entrance, facing the camera (south). */
export function buildEntranceSign(
  hz: number,
  door: number,
  depth: number,
): Mesh {
  const tex = textTexture('TOY EMPORIUM', '#ffffff', '#c93b2c', '#7a1f16');
  const w = 13;
  const m = new Mesh(new PlaneGeometry(w, w / 4), signMaterial(tex, false));
  m.position.set(door, 6.9, hz + depth + 0.15);
  m.renderOrder = 3;
  return m;
}
