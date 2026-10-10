import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import type { BufferAttribute, Group, Mesh, Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MAX_ERROR, meshoptGlb } from '../../scripts/car-model/glb-meshopt.mjs';

/**
 * The build serves every car GLB meshopt-compressed (rsbuild.config.ts -> scripts/car-model/glb-meshopt.mjs).
 * The game's loader must read it back as the same car: same meshes, materials, vertex / triangle counts, and
 * no vertex, normal or livery UV moved more than a hair (relative to the value past 1).
 */
const DIR = 'public/models/cars';
const files = readdirSync(DIR).filter((f) => f.endsWith('.glb'));

function parse(buf: Buffer): Promise<Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  return new Promise((resolve, reject) =>
    loader.parse(ab as ArrayBuffer, '', (g) => resolve(g.scene), reject),
  );
}

function meshes(g: Group): Mesh[] {
  const out: Mesh[] = [];
  g.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

// three's attribute names -> glTF semantics.
const MAX: Record<string, number> = {
  position: MAX_ERROR.POSITION,
  normal: MAX_ERROR.NORMAL,
  uv: MAX_ERROR.TEXCOORD_0,
  _dark: 0, // baked AO: lossless
};

describe.each(files)('%s', (file) => {
  test('compressed file loads as the same car', async () => {
    const plain = readFileSync(`${DIR}/${file}`);
    const packed = await meshoptGlb(plain);
    expect(packed.length).toBeLessThan(plain.length * 0.6);
    const a = meshes(await parse(plain));
    const b = meshes(await parse(packed));
    expect(b.map((m) => m.name)).toEqual(a.map((m) => m.name));
    expect(b.map((m) => (m.material as Material).name)).toEqual(
      a.map((m) => (m.material as Material).name),
    );
    a.forEach((m, i) => {
      const n = b[i].geometry;
      expect(n.index!.count).toBe(m.geometry.index!.count);
      for (const [key, attr] of Object.entries(m.geometry.attributes)) {
        const x = (attr as BufferAttribute).array;
        const y = (n.getAttribute(key) as BufferAttribute).array;
        expect(y.length).toBe(x.length);
        // Relative past 1 (the exponent filter's precision): tiling UVs of source-textured parts reach +-9.
        let err = 0;
        for (let j = 0; j < x.length; j++)
          err = Math.max(
            err,
            Math.abs(x[j] - y[j]) / Math.max(1, Math.abs(x[j])),
          );
        expect(err).toBeLessThanOrEqual(MAX[key]);
      }
    });
  });
});
