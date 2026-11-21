import { Group, Mesh } from 'three';
import { crewSeated, type CrewParams } from '../assets/builders/crew';
import { variantSeed } from '../assets/library';
import {
  canRequestPerson,
  materialOf,
  requestPerson,
} from '../assets/people-pool';
import type { BuiltAsset } from '../assets/types';
import type { CarDef } from '../cars/shared/types';
import type { LiveryInfo } from '../cars/shared/livery';

const ASSET = 'crew_seated';
/** Up close (replay cameras, photo mode, the car viewer) the full figures, otherwise the mid-range ones. */
const NEAR = 4.5;

/**
 * Driver and co-driver in the seats of a car whose cockpit shows through its glass (`model.glass` + `model.cockpit`):
 * built for that cockpit in the car's colours (assets/builders/crew.ts), in the people worker, so the car shows up
 * first and the crew a moment later. Add `group` to the body (model space); it rolls and pitches with it.
 */
export class CarCrew {
  readonly group = new Group();
  private disposed = false;
  private readonly params?: CrewParams;
  /** Per level of detail: its figures, once asked for. */
  private readonly levels: (Group | undefined)[] = [];
  private level = -1;

  constructor(def: CarDef, livery: LiveryInfo) {
    this.group.name = 'crew';
    this.group.userData.noDirt = true;
    const { cockpit, glass } = def.model;
    if (!cockpit || !glass) return;
    this.params = {
      cockpit,
      colors: {
        base: livery.base,
        accent: livery.accent,
        accent2: livery.accent2,
      },
    };
    this.show(1);
  }

  /** Picks the level of detail for a camera `distance` m from the car. */
  update(distance: number): void {
    if (!this.params) return;
    // A band between the two, so a camera hovering at the limit does not swap every frame.
    if (distance < NEAR) this.show(0);
    else if (distance > NEAR + 1.5) this.show(1);
  }

  private show(lod: number): void {
    if (this.level === lod) return;
    this.level = lod;
    if (!this.levels[lod]) this.build(lod);
    this.sync();
  }

  /** The wanted level when it is built, till then whichever is. */
  private sync(): void {
    const ready = (g?: Group): boolean => !!g && g.children.length === 2;
    const want = this.levels[this.level];
    const pick = ready(want) ? want : this.levels.find((g) => ready(g));
    for (const g of this.levels) if (g) g.visible = g === pick;
  }

  private build(lod: number): void {
    const params = this.params!;
    const level = new Group();
    this.levels[lod] = level;
    this.group.add(level);
    for (const seat of [0, 1]) {
      const seed = variantSeed(ASSET, seat);
      const add = (a: BuiltAsset): void => {
        if (this.disposed) {
          for (const p of a.parts) p.geometry.dispose();
          return;
        }
        const figure = new Group();
        for (const part of a.parts) {
          const m = new Mesh(part.geometry, part.material);
          m.receiveShadow = true;
          m.castShadow = false;
          figure.add(m);
        }
        level.add(figure);
        this.sync();
      };
      const inline = (): BuiltAsset => ({
        parts: crewSeated({ seed, variant: seat, lod, params }).parts.map(
          (p) => ({
            geometry: p.geometry,
            material: materialOf(p.material as unknown as string),
          }),
        ),
      });
      if (canRequestPerson(ASSET))
        requestPerson(
          ASSET,
          seed,
          seat,
          lod,
          (a) => add(a ?? inline()),
          params,
        );
      else add(inline());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    // The figures are this car's own (built for its cockpit and colours); the materials are shared.
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
  }
}
