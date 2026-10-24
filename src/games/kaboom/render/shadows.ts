import {
  DataTexture,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MultiplyBlending,
  PlaneGeometry,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

/** Soft round alpha blob (procedural, no canvas so it also builds in node). */
function blobTexture(size = 32): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - d, 1.6);
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 20;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.minFilter = t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Cheap contact shadows for everything that moves (players, TNT): ONE InstancedMesh of flat soft blobs just above the
 * floor, instead of dynamic shadow maps. Call `begin()`, `add()` per shadow, `end()` each frame.
 */
export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private n = 0;
  private readonly tex = blobTexture();
  private readonly geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly mat = new MeshBasicMaterial({
    map: this.tex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    toneMapped: false,
  });

  constructor(readonly capacity: number) {
    this.mesh = new InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  begin(): void {
    this.n = 0;
  }

  /** A blob of `radius` metres at world `(x, z)`; `strength` 0..1 fades it (e.g. a player in the air). */
  add(x: number, z: number, radius: number, strength = 1): void {
    if (this.n >= this.capacity) return;
    const r = radius * 2 * (0.7 + 0.3 * strength);
    this.m.makeScale(r, 1, r);
    this.m.setPosition(x, 0.015, z);
    this.mesh.setMatrixAt(this.n++, this.m);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

/**
 * Multiply patch for the contact shading: white (no change) outside, a cool dark tint under the block's footprint fading
 * out over a third of a cell round it. `k` = how dark it gets at the block's edge.
 */
function footTexture(k: number, size = 48): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const inner = 0.27; // half the block footprint (0.8 m) in a 1.5 m quad
  const tint = [0.42, 0.42, 0.5];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs((x + 0.5) / size - 0.5) - inner);
      const dy = Math.max(0, Math.abs((y + 0.5) / size - 0.5) - inner);
      const d = Math.min(1, Math.hypot(dx, dy) / (0.5 - inner));
      const a = k * (1 - d) ** 2.2;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++)
        data[o + c] = Math.round(255 * (1 - a * (1 - tint[c])));
      data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.minFilter = t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

const footTextures = new Map<number, DataTexture>();

/** Quad side of a contact patch (m): the 0.8 m block plus about a third of a cell all round. */
const FOOT_SIZE = 1.5;

/**
 * Contact shading on the floor round every block and crate (DETAILS.md "Style"): ONE InstancedMesh of soft dark patches
 * just above the tiles, so nothing looks pasted on. Patches come and go with their block (`add` / `remove` by cell).
 */
export class ContactShade {
  readonly mesh: InstancedMesh;
  private readonly slot: Int32Array;
  private readonly cells: number[] = [];
  private readonly m = new Matrix4();
  private static geo: PlaneGeometry | null = null;
  private readonly mat: MeshBasicMaterial;

  /** `strength` 0..1: how dark the floor gets at a block's foot. */
  constructor(cellCount: number, strength: number) {
    let tex = footTextures.get(strength);
    if (!tex) footTextures.set(strength, (tex = footTexture(strength)));
    const geo = (ContactShade.geo ??= new PlaneGeometry(
      FOOT_SIZE,
      FOOT_SIZE,
    ).rotateX(-Math.PI / 2));
    this.mat = new MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: MultiplyBlending,
      premultipliedAlpha: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(geo, this.mat, Math.max(1, cellCount));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.slot = new Int32Array(cellCount).fill(-1);
  }

  /** A patch under cell index `cell`, centred on world `(x, z)`. */
  add(cell: number, x: number, z: number): void {
    if (this.slot[cell] >= 0) return;
    const k = this.cells.length;
    this.cells.push(cell);
    this.slot[cell] = k;
    this.m.makeTranslation(x, 0.012, z);
    this.mesh.setMatrixAt(k, this.m);
    this.mesh.count = this.cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  remove(cell: number): void {
    const k = this.slot[cell];
    if (k < 0) return;
    const last = this.cells.length - 1;
    if (k !== last) {
      this.mesh.getMatrixAt(last, this.m);
      this.mesh.setMatrixAt(k, this.m);
      const moved = this.cells[last];
      this.cells[k] = moved;
      this.slot[moved] = k;
    }
    this.cells.pop();
    this.slot[cell] = -1;
    this.mesh.count = this.cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.dispose();
  }
}
