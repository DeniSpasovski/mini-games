import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Object3D,
} from 'three';

/** Streak length (m) at its longest and its width (m). */
const LENGTH = 5;
const WIDTH = 0.35;

/** Fade along the streak (strong at the lamp, gone towards the camera) and across it. */
function streakTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(32, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 32; x++) {
      const u = (x + 0.5) / 16 - 1;
      const v = (y + 0.5) / 128;
      const a =
        Math.max(0, 1 - u * u) ** 2 * Math.exp(-v * 3.2) * Math.min(1, v * 12);
      img.data.set([255, 255, 255, Math.round(a * 255)], (y * 32 + x) * 4);
    }
  g.putImageData(img, 0, 0);
  return new CanvasTexture(c);
}

interface Lamp {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  /** The lamp in the car's own space (m) and which way it shines (+1 front, -1 rear). */
  at: Vector3;
  facing: number;
  color: Color;
}

/**
 * Lit lamps mirrored in a wet road: a glossy wet surface reflects each lamp as a streak stretched from below it towards
 * the camera (the rough water film smears the mirror image along the view), as rally games show a car's tail lamps on
 * a wet stage. One additive quad per lamp, flat on the road, turned to the camera every frame; it shows only for lamps
 * that face the camera and fades into the fog (`RALLY_ADDITIVE`).
 */
export class LampReflections {
  private readonly lamps: Lamp[] = [];
  private readonly tmp = new Vector3();
  private readonly fwd = new Vector3();
  private readonly tex = streakTexture();
  private head = 0;
  private tail = 0;
  private brake = 0;

  /**
   * `head` / `tail`: the head lamp (`x` = half its spacing) and tail lamp mount in the car's space; `ground` = the road's
   * height in it (y, m). `wet` 0..1 scales them all.
   */
  constructor(
    private readonly car: Object3D,
    head: { x: number; y: number; z: number },
    tail: { x: number; y: number; z: number },
    private readonly ground: number,
    private readonly wet: number,
  ) {
    const g = new PlaneGeometry(1, 1);
    // Flat, its near end at the origin, running along +z.
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 0.5);
    for (const side of [-1, 1]) {
      this.add(
        g,
        new Vector3(side * head.x, head.y, head.z),
        1,
        new Color(1, 0.95, 0.85),
      );
      this.add(
        g,
        new Vector3(side * Math.max(0.5, head.x), tail.y, tail.z),
        -1,
        new Color(1, 0.05, 0.02),
      );
    }
  }

  private add(
    g: PlaneGeometry,
    at: Vector3,
    facing: number,
    color: Color,
  ): void {
    const mat = new MeshBasicMaterial({
      color,
      alphaMap: this.tex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.defines = { RALLY_ADDITIVE: 1 };
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.car.parent?.add(mesh);
    this.lamps.push({ mesh, mat, at, facing, color });
  }

  /** Lamp levels: head 0..1, tail running 0..1, brake pedal 0..1. */
  setLevels(head: number, tail: number, brake: number): void {
    this.head = head;
    this.tail = tail;
    this.brake = brake;
  }

  /** The brake pedal, 0..1 (the tail lamps' streaks brighten). */
  setBrake(brake: number): void {
    this.brake = brake;
  }

  /** Lay the streaks under the lamps towards the camera (every frame, after the car moved). */
  update(cam: Vector3): void {
    const m = this.car.matrixWorld;
    this.fwd.set(0, 0, 1).transformDirection(m);
    for (const l of this.lamps) {
      const p = l.mesh.position
        .set(l.at.x, this.ground + 0.02, l.at.z)
        .applyMatrix4(m);
      const to = this.tmp.subVectors(cam, p);
      to.y = 0;
      const d = to.length();
      if (d < 0.5) {
        l.mesh.visible = false;
        continue;
      }
      to.divideScalar(d);
      // A lamp shows its mirror image only to a camera in front of it.
      const face = Math.max(
        0,
        (to.x * this.fwd.x + to.z * this.fwd.z) * l.facing,
      );
      const level =
        l.facing > 0
          ? this.head
          : this.tail * (0.35 + 0.65 * this.brake) + this.brake * 0.6;
      const a = this.wet * level * face ** 1.5;
      l.mesh.visible = a > 0.01;
      if (!l.mesh.visible) continue;
      l.mesh.rotation.set(0, Math.atan2(to.x, to.z), 0);
      l.mesh.scale.set(WIDTH, 1, Math.min(LENGTH, d * 0.6));
      l.mat.opacity = Math.min(1, a) * (l.facing > 0 ? 0.9 : 0.8);
    }
  }

  dispose(): void {
    for (const l of this.lamps) {
      l.mesh.removeFromParent();
      l.mat.dispose();
    }
    this.lamps[0]?.mesh.geometry.dispose();
    this.tex.dispose();
  }
}
