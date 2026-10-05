import type { Camera, Mesh, Object3D, Scene, WebGLRenderer } from 'three';

/**
 * Render cost probe (dev tool, `__rallyProbe()` in the console of the game page): what the camera draws,
 * grouped by the top-level scene groups (terrain / road / scatter / car ...), and the heaviest instanced
 * assets (instances x triangles of their LOD - three.js does not cull individual instances).
 * Meshes outside the view frustum are skipped, instanced meshes count all their instances.
 */

export interface ProbeResult {
  gpu: string;
  /** Last rendered frame (renderer.info): draw calls and triangles incl. the shadow pass. */
  info: { calls: number; triangles: number };
  groups: Record<
    string,
    { meshes: number; triangles: number; instances: number }
  >;
  /** Heaviest instanced assets: "oak_tree lod2" -> instances / triangles. */
  assets: { name: string; instances: number; triangles: number }[];
}

export function probeScene(
  scene: Scene,
  camera: Camera,
  renderer: WebGLRenderer,
): ProbeResult {
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  // Frustum planes from projection * view (Gribb-Hartmann), normalised.
  const pm = camera.projectionMatrix.elements;
  const vm = camera.matrixWorldInverse.elements;
  const m = new Array<number>(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += pm[k * 4 + j] * vm[i * 4 + k];
      m[i * 4 + j] = s;
    }
  const planes: number[][] = [];
  for (const [r, sg] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ]) {
    const p = [
      m[3] + sg * m[r],
      m[7] + sg * m[r + 4],
      m[11] + sg * m[r + 8],
      m[15] + sg * m[r + 12],
    ];
    const l = Math.hypot(p[0], p[1], p[2]);
    planes.push(p.map((x) => x / l));
  }
  const inView = (o: Mesh): boolean => {
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere!;
    const e = o.matrixWorld.elements;
    const c = s.center;
    const x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12];
    const y = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13];
    const z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
    const sc = Math.max(
      Math.hypot(e[0], e[1], e[2]),
      Math.hypot(e[4], e[5], e[6]),
      Math.hypot(e[8], e[9], e[10]),
    );
    return planes.every(
      (p) => p[0] * x + p[1] * y + p[2] * z + p[3] >= -s.radius * sc,
    );
  };
  const groups: ProbeResult['groups'] = {};
  const assets = new Map<string, { instances: number; triangles: number }>();
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    const inst = (mesh as { isInstancedMesh?: boolean }).isInstancedMesh;
    if (!inst && mesh.frustumCulled !== false && !inView(mesh)) return;
    const g = mesh.geometry;
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = inst ? (mesh as unknown as { count: number }).count : 1;
    let top: Object3D = o;
    while (top.parent && top.parent !== scene) top = top.parent;
    const key = top.name || top.type;
    const e = (groups[key] ??= { meshes: 0, triangles: 0, instances: 0 });
    e.meshes++;
    e.triangles += per * n;
    if (inst) {
      e.instances += n;
      const name = o.name.replace(/#\d+ lod/, ' lod');
      const a = assets.get(name) ?? { instances: 0, triangles: 0 };
      a.instances += n;
      a.triangles += per * n;
      assets.set(name, a);
    }
  });
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '?',
    info: {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    },
    groups,
    assets: [...assets]
      .map(([name, a]) => ({ name, ...a }))
      .sort((a, b) => b.triangles - a.triangles)
      .slice(0, 12),
  };
}
