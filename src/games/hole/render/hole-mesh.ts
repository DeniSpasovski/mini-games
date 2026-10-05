import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
} from 'three';
import { createMaskMaterial } from './materials';

export const HOLE_COLORS: { id: string; name: string; hex: number }[] = [
  { id: 'ocean', name: 'Ocean', hex: 0x2f80ff },
  { id: 'lime', name: 'Lime', hex: 0x7ed321 },
  { id: 'pink', name: 'Pink', hex: 0xff3d9a },
  { id: 'orange', name: 'Orange', hex: 0xff8a00 },
  { id: 'violet', name: 'Violet', hex: 0x8b5cf6 },
  { id: 'cyan', name: 'Cyan', hex: 0x19d3da },
  { id: 'red', name: 'Red', hex: 0xff3b30 },
  { id: 'gold', name: 'Gold', hex: 0xffc800 },
];

export function holeColorById(id: string): number {
  return (HOLE_COLORS.find((c) => c.id === id) ?? HOLE_COLORS[0]).hex;
}

/** Rim / glow height above the ground layers (m). Kept tiny: a tall rim shows grass through the gap at low camera angles. */
const RIM_Y = 0.05;
/** Depth rows of the wall (fraction of the depth): a soil lip first, then the hole colour fading to black. */
const WALL_ROWS = [0, 0.04, 0.08, 0.35, 0.7, 1];
const SIDES = 48;
/** Rim widths in unit-hole fractions for small holes; capped in metres so a big hole does not get a fat ring. */
const RIM_IN = 0.05;
const RIM_OUT = 0.06;
const RIM_TOP_OUT = 0.04;
const RIM_IN_MAX = 0.35;
const RIM_OUT_MAX = 0.45;
const RIM_TOP_OUT_MAX = 0.3;
const SOIL = new Color(0x5b3d27);
const SOIL_DARK = new Color(0x3a2618);

/** Soft ring (transparent inside the hole) used for the breathing glow around the rim. */
function glowTexture(): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // the quad is 1.5 hole diameters wide, so the hole edge sits at 0.5 / 0.75 = 0.667 of its radius
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0)');
  grad.addColorStop(0.69, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.84, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The hole: an invisible stencil disc that cuts the ground, an open cylinder
 * (a soil lip, then the hole colour fading to black), a black bottom, a rim that
 * breathes all the time, a glow that kicks on every item and a level-up pulse.
 * Built with unit radius 0.5 and scaled to the current diameter.
 */
export class HoleMesh {
  readonly group = new Group();
  private walls: Mesh;
  private bottom: Mesh;
  private rim: Mesh;
  private rimTop: Mesh;
  private glow: Mesh;
  private pulseRing: Mesh;
  private pulseRing2: Mesh;
  private flash: Mesh;
  private rimMat = new MeshBasicMaterial({ toneMapped: false });
  private overlayMat = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
  });
  private glowMat = new MeshBasicMaterial({
    map: glowTexture(),
    toneMapped: false,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  private pulseMat = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  private pulseMat2 = this.pulseMat.clone();
  private flashMat = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  private flashT = 1;
  private lastD = 0;
  private wallColors: Float32BufferAttribute;
  private pulseT = 1;
  private kickAmt = 0;
  private time = 0;
  private depth = 3;
  private color = new Color();

  constructor(color: number) {
    const mask = new Mesh(
      new CircleGeometry(0.5, SIDES).rotateX(-Math.PI / 2),
      createMaskMaterial(),
    );
    mask.renderOrder = -100;
    mask.position.y = 0.002;

    // same number of sides as the mask, so there is no sliver between the cut and the wall
    const wallGeo = new CylinderGeometry(
      0.5,
      0.5,
      1,
      SIDES,
      WALL_ROWS.length - 1,
      true,
    );
    const pos = wallGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, -WALL_ROWS[Math.floor(i / (SIDES + 1))]);
    this.wallColors = new Float32BufferAttribute(
      new Float32Array(pos.count * 3),
      3,
    );
    wallGeo.setAttribute('color', this.wallColors);
    this.walls = new Mesh(
      wallGeo,
      new MeshBasicMaterial({
        vertexColors: true,
        side: BackSide,
        toneMapped: false,
      }),
    );
    this.bottom = new Mesh(
      new CircleGeometry(0.5, SIDES).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x000000 }),
    );

    // the rim starts inside the hole edge so it always overlaps the cut
    this.rim = new Mesh(
      new RingGeometry(0.45, 0.56, SIDES).rotateX(-Math.PI / 2),
      this.rimMat,
    );
    this.rim.position.y = RIM_Y;
    this.rimTop = new Mesh(
      new RingGeometry(0.5, 0.54, SIDES).rotateX(-Math.PI / 2),
      this.overlayMat,
    );
    this.rimTop.renderOrder = 998;
    this.rimTop.position.y = RIM_Y;
    this.glow = new Mesh(
      new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2),
      this.glowMat,
    );
    this.glow.position.y = RIM_Y + 0.005;
    this.glow.renderOrder = 5;
    this.pulseRing = new Mesh(
      new RingGeometry(0.5, 0.58, SIDES).rotateX(-Math.PI / 2),
      this.pulseMat,
    );
    this.pulseRing.renderOrder = 999;
    this.pulseRing.position.y = RIM_Y;
    this.pulseRing2 = new Mesh(this.pulseRing.geometry, this.pulseMat2);
    this.pulseRing2.renderOrder = 999;
    this.pulseRing2.position.y = RIM_Y;

    this.flash = new Mesh(
      new CircleGeometry(0.52, SIDES).rotateX(-Math.PI / 2),
      this.flashMat,
    );
    this.flash.renderOrder = 997;
    this.flash.position.y = RIM_Y;

    this.group.add(
      mask,
      this.walls,
      this.bottom,
      this.rim,
      this.rimTop,
      this.glow,
      this.pulseRing,
      this.pulseRing2,
      this.flash,
    );
    this.setColor(color);
    this.setDiameter(1);
  }

  setColor(hex: number): void {
    const c = this.color.set(hex);
    this.rimMat.color.copy(c);
    this.overlayMat.color.copy(c);
    this.glowMat.color.copy(c);
    this.pulseMat.color.copy(c).lerp(new Color(0xffffff), 0.5);
    this.pulseMat2.color.copy(c);
    this.flashMat.color.copy(c).lerp(new Color(0xffffff), 0.7);
    const pos = this.walls.geometry.getAttribute('position');
    const tmp = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i); // 0 at the top .. 1 at the bottom
      if (t < WALL_ROWS[2] - 1e-6) {
        // soil lip: the cut through the ground, darker with depth
        tmp.copy(SOIL).lerp(SOIL_DARK, t / WALL_ROWS[2]);
      } else {
        const u = (t - WALL_ROWS[2]) / (1 - WALL_ROWS[2]);
        const k = 0.5 * Math.pow(1 - u, 1.5);
        tmp.setRGB(c.r * k, c.g * k, c.b * k);
      }
      this.wallColors.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    this.wallColors.needsUpdate = true;
  }

  /** Cylinder depth is `1.5 + 0.8 * diameter` metres. */
  setDiameter(d: number): void {
    this.depth = 1.5 + 0.8 * d;
    this.group.scale.set(d, 1, d);
    this.walls.scale.set(1, this.depth, 1);
    this.bottom.position.y = -this.depth;
    if (Math.abs(d - this.lastD) > this.lastD * 0.004) {
      this.lastD = d;
      shapeRing(
        this.rim.geometry,
        0.5 - Math.min(RIM_IN, RIM_IN_MAX / d),
        0.5 + Math.min(RIM_OUT, RIM_OUT_MAX / d),
      );
      shapeRing(
        this.rimTop.geometry,
        0.5,
        0.5 + Math.min(RIM_TOP_OUT, RIM_TOP_OUT_MAX / d),
      );
    }
  }

  setPosition(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  /** Start the level-up pulse: two rings, a bright glow and a big kick. */
  pulse(): void {
    this.pulseT = 0;
    this.flashT = 0;
    this.kickAmt = Math.max(this.kickAmt, 1.6);
  }

  /** Small glow kick, called for every item swallowed. */
  kick(amount = 0.5): void {
    this.kickAmt = Math.min(1.6, Math.max(this.kickAmt, amount));
  }

  /** Call every frame: breathing rim + glow, kick decay, level-up rings. */
  tick(dt: number): void {
    this.time += dt;
    this.kickAmt *= Math.exp(-dt / 0.22);
    if (this.kickAmt < 0.002) this.kickAmt = 0;
    const b = 0.5 + 0.5 * Math.sin(this.time * ((Math.PI * 2) / 1.3));
    const k = this.kickAmt;
    this.overlayMat.opacity = 0.45 + 0.3 * b + 0.25 * Math.min(1, k);
    this.glowMat.opacity = Math.min(1, 0.22 + 0.22 * b + 0.45 * k);
    const gs = 1 + 0.06 * b + 0.16 * k;
    this.glow.scale.set(gs, 1, gs);
    const rs = 1 + 0.012 * b + 0.05 * k;
    this.rim.scale.set(rs, 1, rs);
    if (this.flashT < 1) {
      this.flashT = Math.min(1, this.flashT + dt / 0.4);
      this.flashMat.opacity = 0.75 * (1 - this.flashT) ** 2;
    } else this.flashMat.opacity = 0;
    if (this.pulseT >= 1) {
      this.pulseMat.opacity = this.pulseMat2.opacity = 0;
      return;
    }
    this.pulseT = Math.min(1, this.pulseT + dt / 0.9);
    const p = this.pulseT;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const s1 = 1 + 1.4 * ease(p);
    this.pulseRing.scale.set(s1, 1, s1);
    this.pulseMat.opacity = 0.9 * (1 - p);
    const p2 = Math.max(0, p - 0.18) / 0.82;
    const s2 = 1 + 1.9 * ease(p2);
    this.pulseRing2.scale.set(s2, 1, s2);
    this.pulseMat2.opacity = p2 > 0 ? 0.7 * (1 - p2) : 0;
  }
}

/** Re-radius a RingGeometry(inner, outer, segments, 1) in place: first row of vertices = inner, second = outer. */
function shapeRing(geo: BufferGeometry, inner: number, outer: number): void {
  const pos = geo.getAttribute('position');
  const row = pos.count / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z) || 1;
    const target = i < row ? inner : outer;
    pos.setX(i, (x / r) * target);
    pos.setZ(i, (z / r) * target);
  }
  pos.needsUpdate = true;
}
