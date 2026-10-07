import {
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Material,
} from 'three';
import { buildWheelSet, wheelMaterials } from '../cars/shared/car-model';
import { loadRimUnits, rimColorFor } from '../cars/shared/stl-wheel';
import {
  buildCoilover,
  SUSPENSION_STYLE_COLORS,
} from '../cars/shared/suspension-mesh';
import type { CarDef } from '../cars/shared/types';
import { SETUP_COLORS, SETUP_IDS } from '../physics/car-setup';
import { TYRE_IDS } from '../physics/tyres';

/**
 * The setup screen's 3D pickers (Showroom.showSetup): one little studio per option - the car's three tyres on their
 * rims and its three coil-overs / struts (spring colour yellow / orange / red = soft / medium / stiff, length from the
 * preset's travel) - each with its own camera. The menu's picker boxes are transparent DOM windows; the showroom
 * renders each card's camera into the box's screen rectangle (scissor), so the boxes show live, slowly turning parts.
 * Keys: `tyre:<id>` and `susp:<id>`. Everything is built from the car's own builders, never per frame.
 */
const STUDIO_X = 0;
const SPACING = 6;
/** The outer face of a wheel turns towards the camera, a little to the right. */
const WHEEL_YAW = -1.05;
const COILOVER_SCALE = 1.5;

export interface BenchCard {
  key: string;
  cam: PerspectiveCamera;
  /** The slowly turning part. */
  spin: Group;
  /** Axis the part turns about. */
  axis: 'x' | 'y';
  speed: number;
}

export class SetupBench {
  /** Own scene: drawn over the showroom background without clearing it (the boxes are see-through). */
  readonly scene = new Scene();
  readonly group = new Group();
  readonly cards = new Map<string, BenchCard>();
  private geometries: BufferGeometry[] = [];
  private materials: Material[] = [];
  private disposed = false;
  private time = 0;

  constructor(private def: CarDef) {
    this.scene.add(this.group);
    this.group.position.set(STUDIO_X, 0, 0);
    // Studio lighting: soft sky / ground fill + a key light from the front-top-left (the world sun is low and dim).
    const key = new DirectionalLight(0xffffff, 3.2);
    key.position.set(-3, 5, 6);
    this.group.add(
      key,
      key.target,
      new HemisphereLight(0xdfe8ff, 0x303846, 1.6),
    );
    void loadRimUnits(def.model).then((rims) => {
      if (this.disposed) {
        for (const r of rims.values()) r.dispose();
        return;
      }
      this.geometries.push(...rims.values());
      this.build(rims);
    });
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.cards.values())
      c.spin.rotation[c.axis] = this.time * c.speed;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** One card: the part and a camera looking at it (no backdrop: the showroom ground and sky show through). */
  private studio(
    key: string,
    index: number,
    part: Group,
    spin: Group,
    axis: 'x' | 'y',
    speed: number,
    camOffset: Vector3,
  ): void {
    const local = new Vector3(index * SPACING, 0, 0);
    const root = new Group();
    root.position.copy(local);
    root.add(part);
    this.group.add(root);
    const world = local.clone().add(this.group.position);
    const cam = new PerspectiveCamera(26, 1.4, 0.1, 30);
    cam.position.copy(world).add(camOffset);
    cam.lookAt(world);
    this.cards.set(key, { key, cam, spin, axis, speed });
  }

  private build(rimUnits: ReadonlyMap<string, BufferGeometry>): void {
    const def = this.def;
    // Tyres on their rims: a real tyre + rim + brakes per compound, rolling on the axle.
    TYRE_IDS.forEach((id, i) => {
      const w = buildWheelSet(def, id, rimUnits);
      const rimMat = this.mat(
        new MeshStandardMaterial({
          color: rimColorFor(def.model, id),
          metalness: 0.75,
          roughness: 0.32,
        }),
      );
      this.geometries.push(w.tire, w.rim, w.caliper);
      if (w.disc) this.geometries.push(w.disc);
      const spin = new Group();
      spin.add(new Mesh(w.tire, wheelMaterials.tire));
      spin.add(new Mesh(w.rim, rimMat));
      spin.add(new Mesh(w.caliper, wheelMaterials.caliper));
      if (w.disc) spin.add(new Mesh(w.disc, wheelMaterials.disc));
      const aim = new Group(); // yaw: the outer face turns to the camera
      aim.rotation.y = WHEEL_YAW;
      aim.add(spin);
      const part = new Group();
      part.add(aim);
      this.studio(
        `tyre:${id}`,
        i,
        part,
        spin,
        'x',
        i % 2 ? -0.8 : 0.8,
        new Vector3(0, 0.45, 1.95),
      );
    });

    // Coil-overs: the car's own hardware style, spring colour per preset.
    const colors = SUSPENSION_STYLE_COLORS[def.model.suspensionStyle];
    const bodyMat = this.mat(
      new MeshStandardMaterial({
        color: colors.body,
        metalness: 0.55,
        roughness: 0.4,
      }),
    );
    const chromeMat = this.mat(
      new MeshStandardMaterial({
        color: colors.chrome,
        metalness: 0.85,
        roughness: 0.25,
      }),
    );
    SETUP_IDS.forEach((id, i) => {
      const c = buildCoilover(
        def.model.suspensionStyle,
        def.physics.setups[id],
      );
      this.geometries.push(c.body, c.chrome, c.spring);
      const springMat = this.mat(
        new MeshStandardMaterial({
          color: SETUP_COLORS[id],
          metalness: 0.5,
          roughness: 0.35,
        }),
      );
      const unit = new Group();
      unit.add(new Mesh(c.body, bodyMat));
      unit.add(new Mesh(c.chrome, chromeMat));
      unit.add(new Mesh(c.spring, springMat));
      unit.position.y = -c.length / 2; // turn about the middle
      const spin = new Group();
      spin.add(unit);
      spin.scale.setScalar(COILOVER_SCALE);
      const part = new Group();
      part.add(spin);
      this.studio(
        `susp:${id}`,
        3 + i,
        part,
        spin,
        'y',
        0.55 + i * 0.1,
        new Vector3(0, 0.25, 2.0),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.scene.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
