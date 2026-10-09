import { PerspectiveCamera, Vector3 } from 'three';

/** Tilted diorama view: narrow FOV, steep pitch, fixed yaw (looking north, grid +y = screen down). DETAILS.md "Camera". */
export const CAM_FOV = 30;
export const CAM_PITCH_DEG = 58;

/** What must stay on screen: the slab (half-extent padding, depth under the floor) and the tallest thing on it. */
export const SLAB_PAD = 0.9;
export const SLAB_DEPTH = 1.8;
export const TOP_HEIGHT = 1.6;

/** Arenas bigger than this many cells (the Medium one is 221) are followed instead of fitted. */
export const FOLLOW_ABOVE_CELLS = 17 * 13;
const DIST_MIN = 6;
const DIST_MAX = 160;

export class CameraRig {
  readonly camera = new PerspectiveCamera(CAM_FOV, 1, 0.5, 400);
  readonly target = new Vector3();
  distance = 30;
  private readonly dir = new Vector3(
    0,
    Math.sin((CAM_PITCH_DEG * Math.PI) / 180),
    Math.cos((CAM_PITCH_DEG * Math.PI) / 180),
  );

  /** True when the camera follows the player (big arenas, tall screens) instead of showing the whole slab. */
  following = false;
  private viewCols = 0;
  private viewRows = 0;
  private arenaW = 0;
  private arenaH = 0;

  /** Frame the whole `cols x rows` slab (centred on the origin) for the camera's current aspect. */
  fitArena(cols: number, rows: number, margin = 1.06): void {
    this.following = false;
    this.target.set(0, 0, 0);
    this.distance = fitDistance(this.camera, this.dir, cols, rows, margin);
    this.update();
  }

  /**
   * Pick the framing for an arena of `w x h` cells and the camera's current aspect: the whole slab when it fits
   * comfortably (small / medium arenas on a landscape screen), otherwise a window of about 14 x 11 cells (9 x 13 on a
   * portrait phone) that `followTo` moves with the player.
   */
  fitView(w: number, h: number): void {
    const aspect = this.camera.aspect;
    if (aspect >= 1 && w * h <= FOLLOW_ABOVE_CELLS) {
      this.fitArena(w, h);
      return;
    }
    const portrait = aspect < 1;
    this.following = true;
    this.arenaW = w;
    this.arenaH = h;
    this.viewCols = Math.min(w, portrait ? 9 : 14);
    this.viewRows = Math.min(h, portrait ? 13 : 11);
    // only the ground window matters when following: no slab underside, no margin
    this.distance = fitDistance(
      this.camera,
      this.dir,
      this.viewCols,
      this.viewRows,
      1.02,
      0.3,
      0,
    );
    this.update();
  }

  /** Move the followed window towards world `(x, z)`, never past the slab edge. No-op when showing the whole slab. */
  followTo(x: number, z: number, dt: number): void {
    if (!this.following) return;
    const maxX = Math.max(0, this.arenaW / 2 - this.viewCols / 2 + 0.3);
    const maxZ = Math.max(0, this.arenaH / 2 - this.viewRows / 2 + 0.3);
    const tx = Math.min(maxX, Math.max(-maxX, x));
    const tz = Math.min(maxZ, Math.max(-maxZ, z));
    const k = 1 - Math.exp(-dt * 5);
    this.target.x += (tx - this.target.x) * k;
    this.target.z += (tz - this.target.z) * k;
  }

  /** Place the camera from `target` + `distance` (call after changing either). */
  update(): void {
    this.camera.position
      .copy(this.target)
      .addScaledVector(this.dir, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}

const corner = new Vector3();

/** Smallest distance at which all slab corners project inside the screen (with `margin`), by bisection on the real projection. */
export function fitDistance(
  camera: PerspectiveCamera,
  dir: Vector3,
  cols: number,
  rows: number,
  margin: number,
  pad = SLAB_PAD,
  depth = SLAB_DEPTH,
): number {
  const hx = cols / 2 + pad;
  const hz = rows / 2 + pad;
  const fits = (d: number): boolean => {
    camera.position.copy(dir).multiplyScalar(d);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const y of [-depth, TOP_HEIGHT]) {
          corner.set(sx * hx, y, sz * hz).project(camera);
          if (
            Math.abs(corner.x) * margin > 1 ||
            Math.abs(corner.y) * margin > 1
          )
            return false;
        }
    return true;
  };
  let lo = DIST_MIN;
  let hi = DIST_MAX;
  if (fits(lo)) return lo;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
