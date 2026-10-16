import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { merge, paint } from '../engine/geo';
import { cabinPose, HANGER, type AerialwayLayout } from './aerialway';
import type { World } from './world';

/**
 * The ropes and cabins of the cable cars (MapDef.aerialways): one line mesh for the ropes, one instanced mesh for the
 * cabins (white, red band, dark windows) that run round the loop at the line's speed (`cabinPose`, moved when the mesh is
 * drawn, so a cable car out of view costs nothing). The pylons are scatter instances (`gondola_pylon`).
 */

const box = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: string,
): BufferGeometry => paint(new BoxGeometry(w, h, d).translate(x, y, z), color);

/** One cabin hanging from the rope point at the origin: hanger, roof, body with a window band. Long side along local X. */
function cabinGeometry(): BufferGeometry {
  const h = HANGER;
  return merge([
    box(0.12, h, 0.12, 0, -h / 2, 0, '#55595c'),
    box(2.2, 0.16, 2.5, 0, -h - 0.08, 0, '#8d9296'),
    box(2.1, 0.55, 2.4, 0, -h - 0.5, 0, '#cfcdc6'),
    box(2.12, 0.75, 2.42, 0, -h - 1.15, 0, '#37444e'),
    box(2.1, 0.45, 2.4, 0, -h - 1.75, 0, '#b3372e'),
  ]);
}

/** Moves the instances of one line to where the cabins are at `seconds`. */
function placeCabins(
  mesh: InstancedMesh,
  lay: AerialwayLayout,
  seconds: number,
  dummy: Object3D,
): void {
  const { spacing, speed, count } = lay.loop;
  for (let i = 0; i < count; i++) {
    const c = cabinPose(lay, i * spacing + seconds * speed);
    dummy.position.set(c.x, c.y + HANGER, c.z);
    dummy.rotation.set(0, c.rotY, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function* aerialwayMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const layouts = world.aerialways;
  if (!layouts.length) return undefined;
  const group = new Group();
  group.name = 'aerialways';
  const lines: number[] = [];
  for (const lay of layouts) {
    for (const rope of lay.ropes)
      for (let i = 3; i < rope.length; i += 3)
        lines.push(
          rope[i - 3],
          rope[i - 2],
          rope[i - 1],
          rope[i],
          rope[i + 1],
          rope[i + 2],
        );
    yield;
  }
  if (lines.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
    g.computeBoundingSphere();
    const l = new LineSegments(g, new LineBasicMaterial({ color: '#25282b' }));
    l.matrixAutoUpdate = false;
    group.add(l);
  }
  const geometry = cabinGeometry();
  const material = new MeshLambertMaterial({ vertexColors: true });
  const dummy = new Object3D();
  for (const lay of layouts) {
    const mesh = new InstancedMesh(geometry, material, lay.loop.count);
    mesh.name = 'cabins';
    // The cabins move over the whole line: never culled as one object.
    mesh.frustumCulled = false;
    placeCabins(mesh, lay, 0, dummy);
    mesh.onBeforeRender = () =>
      placeCabins(mesh, lay, performance.now() / 1000, dummy);
    group.add(mesh);
  }
  return group;
}
