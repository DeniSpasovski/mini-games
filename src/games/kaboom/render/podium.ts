import {
  BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { ROUGH } from './materials';
import { bbox, merge, part } from './parts';

/**
 * The results podium (heights 3 : 2 : 1.4, order 2 - 1 - 3), mid-poly (DETAILS.md "Style"): each step a plinth of pale cut
 * stone courses with dark joints, a chamfered capstone overhanging it and a band in its medal's colour (gold, silver,
 * bronze) under the cap, the place pressed into the front; raised from under the arena floor when the match ends.
 * Geometry, material and number decals are built once per page and shared (`dispose` only lets go of the scene graph).
 * Fewer than three players: only the steps that are needed.
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
/** Stone of the courses (alternating), the capstone, and the medal bands by rank. */
const STONE = [0xe6d8be, 0xdccdb1];
const CAP = 0xf2e8d4;
const MEDAL = [0xe2ab2e, 0xc9ced6, 0xc27b46];
const COURSE = 0.36;

/** Left to right: second, first, third. */
const ORDER = [1, 0, 2] as const;

let shared: {
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

/** One step `h` tall (top on y = h), reaching `BELOW` under the floor; `rank` 0 = the winner's. */
function stepGeometry(h: number, rank: number): BufferGeometry {
  const capH = 0.12;
  const p: BufferGeometry[] = [];
  // courses of cut stone from the bottom up to the cap, a dark joint between each (the gap shows the darker core)
  p.push(
    part(bbox(STEP_W - 0.04, h + BELOW - capH, STEP_D - 0.04, 0.02), 0x8f8270, {
      y: (h - capH - BELOW) / 2,
      paint: 0,
      tint: 0,
    }),
  );
  let k = 0;
  for (let y0 = h - capH; y0 > -BELOW; y0 -= COURSE, k++) {
    const y1 = Math.max(-BELOW, y0 - COURSE);
    p.push(
      part(bbox(STEP_W, y0 - y1 - 0.025, STEP_D, 0.03), STONE[k & 1], {
        y: (y0 + y1) / 2,
        tint: 0.08,
        rough: ROUGH.stone,
      }),
    );
  }
  // the medal band just under the cap, and the overhanging capstone
  p.push(
    part(bbox(STEP_W + 0.03, 0.08, STEP_D + 0.03, 0.02), MEDAL[rank], {
      y: h - capH - 0.06,
      tint: 0.04,
      rough: ROUGH.iron,
    }),
    part(bbox(STEP_W + 0.14, capH, STEP_D + 0.14, 0.04, 2), CAP, {
      y: h - capH / 2,
      tint: 0.06,
      rough: ROUGH.stone,
    }),
  );
  return merge(p);
}

function build(): NonNullable<typeof shared> {
  return {
    steps: STEP_H.map((h, rank) => stepGeometry(h, rank)),
    material: new MeshLambertMaterial({ vertexColors: true }),
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
        // in front of the medal band, which stands a little proud of the stone
        d.position.set(0, p.height * 0.42, STEP_D / 2 + 0.02);
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
