import fs from 'node:fs';
import { describe, expect, test } from '@rstest/core';
import { readGlb } from '../../scripts/car-model/glb-meshopt.mjs';

/** Every car GLB carries baked vertex AO (`scripts/car-model/bake-ao.mjs`): a `_DARK` float in 0..1 on each primitive. */
const FILES = fs
  .readdirSync('public/models/cars')
  .filter((f) => f.endsWith('.glb') && !f.endsWith('_wheel.glb'));

describe('baked car AO', () => {
  test.each(FILES)('%s has _DARK on every primitive', (file) => {
    const glb = readGlb(fs.readFileSync(`public/models/cars/${file}`));
    expect(glb).toBeTruthy();
    const { json, bin } = glb;
    let sum = 0;
    let n = 0;
    for (const mesh of json.meshes)
      for (const p of mesh.primitives) {
        const a = json.accessors[p.attributes._DARK];
        expect(a, 'run scripts/car-model/bake-ao.mjs').toBeTruthy();
        expect(a.count).toBe(json.accessors[p.attributes.POSITION].count);
        expect(a.componentType).toBe(5126);
        const v = json.bufferViews[a.bufferView];
        const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
        const f = new Float32Array(
          bin.buffer.slice(
            bin.byteOffset + start,
            bin.byteOffset + start + a.count * 4,
          ),
        );
        for (const x of f) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          sum += x;
          n++;
        }
      }
    // Some occlusion, but not a black car.
    expect(sum / n).toBeGreaterThan(0.05);
    expect(sum / n).toBeLessThan(0.8);
  });
});
