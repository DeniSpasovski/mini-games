import {
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clayMaterial, makeGrainTexture } from './materials';

/**
 * The results podium: three rounded clay boxes (heights 3 : 2 : 1.4, order 2 - 1 - 3) with the place pressed into the front,
 * raised from under the arena floor when the match ends. Geometry, material and number decals are built once per page and
 * shared (`dispose` only lets go of the scene graph). Fewer than three players: only the steps that are needed.
 */

/** Step size in cells (the arena's unit) and the unit height of the 3 : 2 : 1.4 ratio. */
export const STEP_W = 2.0;
export const STEP_D = 1.7;
const STEP_GAP = 0.08;
const HEIGHT_UNIT = 0.36;
export const STEP_H = [
  3 * HEIGHT_UNIT,
  2 * HEIGHT_UNIT,
  1.4 * HEIGHT_UNIT,
] as const;
/** The box reaches this far below the floor so a rising podium never shows its bottom. */
const BELOW = 1.2;
const RISE_S = 0.5;
const RISE_STAGGER_S = 0.14;
const RADIUS = 0.14;

/** Left to right: second, first, third. */
const ORDER = [1, 0, 2] as const;

let shared: {
  grain: DataTexture;
  steps: BufferGeometry[];
  material: MeshLambertMaterial;
  decalGeo: PlaneGeometry;
  decals: (MeshLambertMaterial | null)[];
} | null = null;

/** A pressed-in digit: dark in the upper left edge, light in the lower right, on a transparent plane (none when there is no canvas, e.g. in tests). */
function digitMaterial(n: number): MeshLambertMaterial | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.font = "800 104px 'Grandstander', 'Nunito', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText(String(n), 66, 70);
  g.fillStyle = 'rgba(110,82,64,0.95)';
  g.fillText(String(n), 62, 66);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return new MeshLambertMaterial({ map: tex, transparent: true });
}

function build(): NonNullable<typeof shared> {
  const grain = makeGrainTexture();
  return {
    grain,
    steps: STEP_H.map((h) =>
      new RoundedBoxGeometry(STEP_W, h + BELOW, STEP_D, 3, RADIUS).translate(
        0,
        (h - BELOW) / 2,
        0,
      ),
    ),
    material: clayMaterial(grain, { color: 0xf3e2c4 }),
    decalGeo: new PlaneGeometry(0.9, 0.9),
    decals: [1, 2, 3].map(digitMaterial),
  };
}

/** Where the places stand: `count` steps (1-3), left to right by `ORDER`, centred. */
export function podiumPlaces(
  count: number,
): { rank: number; x: number; height: number }[] {
  const ranks = ORDER.filter((r) => r < Math.max(1, Math.min(3, count)));
  const pitch = STEP_W + STEP_GAP;
  return ranks.map((rank, i) => ({
    rank,
    x: (i - (ranks.length - 1) / 2) * pitch,
    height: STEP_H[rank],
  }));
}

export class Podium {
  readonly group = new Group();
  readonly places: { rank: number; x: number; height: number }[];
  private time = 0;
  private readonly meshes: Mesh[] = [];
  private landed: boolean[] = [];

  /** `onLand(x, z)` fires when a step reaches the floor (a puff of dust). */
  constructor(
    count: number,
    private readonly onLand: ((x: number, z: number) => void) | null = null,
  ) {
    const s = (shared ??= build());
    this.places = podiumPlaces(count);
    for (const p of this.places) {
      const step = new Mesh(s.steps[p.rank], s.material);
      step.position.x = p.x;
      step.castShadow = step.receiveShadow = true;
      this.group.add(step);
      this.meshes.push(step);
      const decal = s.decals[p.rank];
      if (decal) {
        const d = new Mesh(s.decalGeo, decal);
        d.position.set(0, p.height * 0.5, STEP_D / 2 + 0.003);
        d.scale.setScalar(Math.min(0.9, p.height * 0.75) / 0.9);
        step.add(d);
      }
    }
    this.landed = this.places.map(() => false);
    this.update(0);
  }

  /** How far step `i` has risen, 0..1 (third place first, the winner last). */
  rise(i: number): number {
    const k = this.places[i].rank;
    const t = (this.time - (2 - k) * RISE_STAGGER_S) / RISE_S;
    const u = Math.min(1, Math.max(0, t));
    // ease out with a little overshoot: it pops up like clay pushed through a hole
    const c = 1.5;
    return u === 1 ? 1 : 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
  }

  /** Height of step `i`'s top above the floor now (it rises; critters on it follow). */
  topY(i: number): number {
    const p = this.places[i];
    return p.height - (1 - this.rise(i)) * (p.height + BELOW);
  }

  /** World x of step `i`'s centre. */
  x(i: number): number {
    return this.places[i].x;
  }

  update(dt: number): void {
    this.time += dt;
    this.places.forEach((p, i) => {
      this.meshes[i].position.y = this.topY(i) - p.height;
      if (
        !this.landed[i] &&
        this.time > (2 - p.rank) * RISE_STAGGER_S + RISE_S
      ) {
        this.landed[i] = true;
        this.onLand?.(p.x, 0);
      }
    });
  }

  /** True once the winner's step is up. */
  get done(): boolean {
    return this.landed.every(Boolean);
  }
}
