import { describe, expect, test } from '@rstest/core';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { splitCentreLamp } from '../../src/games/rally/cars/shared/lamp-islands';

/** A flat lamp quad (two triangles) centred on (x, 0.9) in the rear plane. */
function quad(x: number, w: number, h = 0.1): number[] {
  const [a, b] = [x - w / 2, x + w / 2];
  return [
    a,
    0.9,
    0,
    b,
    0.9,
    0,
    b,
    0.9 + h,
    0,
    a,
    0.9,
    0,
    b,
    0.9 + h,
    0,
    a,
    0.9 + h,
    0,
  ];
}

function lampMesh(pieces: number[][]): Mesh {
  const g = new BufferGeometry();
  const pos = pieces.flat();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mesh = new Mesh(g, new MeshStandardMaterial());
  new Group().add(mesh);
  mesh.updateWorldMatrix(true, false);
  return mesh;
}

describe('splitCentreLamp', () => {
  test('moves the lamp on the centre line into its own mesh', () => {
    const mesh = lampMesh([quad(-0.7, 0.3), quad(0, 0.4), quad(0.7, 0.3)]);
    const part = splitCentreLamp(mesh, new Matrix4())!;
    expect(part).not.toBe(mesh);
    expect(part.parent).toBe(mesh.parent);
    expect(part.geometry.index!.count / 3).toBe(2);
    expect(mesh.geometry.index!.count / 3).toBe(4);
  });

  test('a mesh that is only the centre lamp is returned as it is', () => {
    const mesh = lampMesh([quad(0.02, 0.4)]);
    expect(splitCentreLamp(mesh, new Matrix4())).toBe(mesh);
  });

  test('a lamp pair without a centre piece, or a full-width bar, is left alone', () => {
    expect(
      splitCentreLamp(
        lampMesh([quad(-0.7, 0.3), quad(0.7, 0.3)]),
        new Matrix4(),
      ),
    ).toBeNull();
    expect(splitCentreLamp(lampMesh([quad(0, 1.4)]), new Matrix4())).toBeNull();
  });
});
