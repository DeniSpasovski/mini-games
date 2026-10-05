import { BufferAttribute, BufferGeometry, type Material, Mesh } from 'three';
import { getTerrainMaterial } from './terrain-material';
import { TerrainGrid } from './terrain-renderer';
import { RENDER_MARGIN, type World } from './world';

/**
 * The whole map (bounds + RENDER_MARGIN) as ONE low-res terrain mesh, for
 * aerial previews (menu stage select). Streaming 64 m chunks instead costs a
 * draw call per chunk - ~13k on a 5 x 10 km map.
 *
 * Built time-sliced by `update()` (a row at a time); the mesh is empty until `done`.
 * UVs span the map rect (bounds + margin), e.g. for a baked top-down texture.
 */
export class AerialTerrain {
  readonly mesh: Mesh;
  private job: Iterator<void, BufferGeometry> | null;

  constructor(
    private world: World,
    /** Grid cells along the map's long side. */
    cells = 512,
    material: Material = getTerrainMaterial(),
  ) {
    const b = world.map.bounds;
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.position.set(b.minX - RENDER_MARGIN, 0, b.minZ - RENDER_MARGIN);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'aerial terrain';
    this.job = this.grid(cells);
  }

  /** Grid built and shown. */
  get done(): boolean {
    return !this.job;
  }

  /** Continue the grid for up to `budgetMs` (at least one row); true when complete. */
  update(budgetMs: number): boolean {
    if (!this.job) return true;
    const t0 = performance.now();
    do {
      const r = this.job.next();
      if (r.done) {
        this.mesh.geometry.dispose();
        this.mesh.geometry = r.value;
        this.job = null;
        return true;
      }
    } while (performance.now() - t0 < budgetMs);
    return false;
  }

  /** Builds a grid geometry, yielding after every row. */
  private *grid(cells: number): Generator<void, BufferGeometry> {
    const b = this.world.map.bounds;
    const w = b.maxX - b.minX + 2 * RENDER_MARGIN;
    const h = b.maxZ - b.minZ + 2 * RENDER_MARGIN;
    const d = Math.max(w, h) / cells;
    const nx = Math.ceil(w / d) + 1;
    const nz = Math.ceil(h / d) + 1;
    const g = new TerrainGrid(
      this.world.gen,
      b.minX - RENDER_MARGIN,
      b.minZ - RENDER_MARGIN,
      d,
      nx,
      nz,
    );
    const pos = new Float32Array(nx * nz * 3);
    const nor = new Float32Array(nx * nz * 3);
    const spl = new Uint8Array(nx * nz * 4);
    const uv = new Float32Array(nx * nz * 2);
    // Height rows run 2 ahead of the vertex rows that read them.
    g.heights(0, 2);
    for (let j = 0; j < nz; j++) {
      g.heights(j + 2, j + 3);
      g.vertices(j, j + 1, pos, nor, spl);
      for (let i = 0; i < nx; i++) {
        uv[(j * nx + i) * 2] = (i * d) / w;
        uv[(j * nx + i) * 2 + 1] = 1 - (j * d) / h;
      }
      yield;
    }
    const idx = new (nx * nz > 65535 ? Uint32Array : Uint16Array)(
      (nx - 1) * (nz - 1) * 6,
    );
    let t = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        // Same split as the chunk meshes: (00,01,11) and (00,11,10).
        idx[t++] = a;
        idx[t++] = a + nx;
        idx[t++] = a + nx + 1;
        idx[t++] = a;
        idx[t++] = a + nx + 1;
        idx[t++] = a + 1;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('splat', new BufferAttribute(spl, 4, true));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
