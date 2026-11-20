import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { getAsset, requestAsset } from '../assets/library';
import type { BuiltAsset } from '../assets/types';
import type { CarDef } from '../cars/shared/types';

/** The figures' detail level: seen through tinted glass, never closer than the chase camera. */
const LOD = 1;
/** Heel floor above the ground (model space), and the seat's hip behind the front axle (share of the wheelbase). */
const FLOOR_Y = 0.2;
const HIP_BACK = 0.55;
/** The hip ahead of the figure's back (its rearmost point) and above its heels. */
const HIP_FROM_BACK = 0.14;

let helmetGeo: SphereGeometry | undefined;
let visorGeo: SphereGeometry | undefined;
let helmetMat: MeshStandardMaterial | undefined;
let visorMat: MeshStandardMaterial | undefined;

/**
 * A full-face rally helmet: a shell a little longer than high, a dark visor across the eyes. Shared by every crew;
 * built once.
 */
function helmet(): Group {
  helmetGeo ??= new SphereGeometry(0.148, 20, 14).scale(0.95, 1, 1.1);
  // The visor: a band of a slightly larger sphere round the front (three's sphere: +Z at phi = pi / 2).
  visorGeo ??= new SphereGeometry(
    0.152,
    16,
    4,
    Math.PI / 2 - 0.8,
    1.6,
    1.22,
    0.42,
  ).scale(0.95, 1, 1.1);
  helmetMat ??= new MeshStandardMaterial({
    color: 0xeeeeec,
    roughness: 0.3,
    metalness: 0,
  });
  visorMat ??= new MeshStandardMaterial({
    color: 0x0c0f13,
    roughness: 0.08,
    metalness: 0.2,
  });
  const g = new Group();
  g.add(new Mesh(helmetGeo, helmetMat), new Mesh(visorGeo, visorMat));
  return g;
}

/**
 * Driver and co-driver in the seats of the player's car (a car with a modelled cockpit, `model.glass`): left-hand
 * drive, the driver on the left (+X), hands on the wheel, the co-driver on the right reading the notes; race suits in
 * the team's colours, helmets on. Built in the people worker, so the car shows up first and the crew a moment later.
 * Add `group` to the body (model space: y = 0 ground, +Z forward); it rolls and pitches with it.
 */
export class CarCrew {
  readonly group = new Group();
  private disposed = false;

  constructor(def: CarDef, team: number) {
    this.group.name = 'crew';
    this.group.userData.noDirt = true;
    if (!def.model.glass) return;
    const p = def.physics;
    const wheelbase = p.front.z - p.rear.z;
    const hipZ = p.front.z - HIP_BACK * wheelbase;
    const seatX = Math.min(0.4, p.width * 0.2);
    for (const seat of [0, 1]) {
      const variant = seat + 2 * team;
      const place = () => {
        if (this.disposed) return;
        this.place(
          getAsset('crew_seated', variant, LOD),
          seat ? -seatX : seatX,
          hipZ,
          p.height,
        );
      };
      if (!requestAsset('crew_seated', variant, LOD, place)) place();
    }
  }

  private place(a: BuiltAsset, x: number, hipZ: number, roof: number): void {
    const box = new Box3();
    for (const part of a.parts) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox!);
    }
    // The head: the top of the figure (the points within a head's height of it).
    const head = new Vector3();
    let n = 0;
    for (const part of a.parts) {
      const pos = part.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < box.max.y - 0.22) continue;
        head.x += pos.getX(i);
        head.z += pos.getZ(i);
        n++;
      }
    }
    if (n) head.set(head.x / n, box.max.y - 0.115, head.z / n);
    const figure = new Group();
    for (const part of a.parts) {
      const m = new Mesh(part.geometry, part.material as Material);
      m.receiveShadow = true;
      figure.add(m);
    }
    const h = helmet();
    h.position.copy(head);
    figure.add(h);
    // Shrink a tall figure to fit under the roof (the helmet's top 4 cm over the head's).
    const top = box.max.y + 0.04 - box.min.y;
    const room = roof - 0.1 - FLOOR_Y;
    const s = top > room ? room / top : 1;
    figure.scale.setScalar(s);
    figure.position.set(
      x - head.x * s,
      FLOOR_Y - box.min.y * s,
      hipZ - (box.min.z + HIP_FROM_BACK) * s,
    );
    figure.traverse((o) => {
      o.castShadow = false;
    });
    this.group.add(figure);
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    // Geometry and materials are shared (the asset cache, the helmet): nothing to free.
  }
}
