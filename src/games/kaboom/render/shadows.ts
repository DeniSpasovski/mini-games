import {
  DataTexture,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
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
