import { describe, expect, test } from '@rstest/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { getMap } from '../../src/games/rally/maps';
import { Breakables } from '../../src/games/rally/world/breakables';
import { World } from '../../src/games/rally/world/world';

describe('breakable marker posts (test map)', () => {
  const world = new World(getMap('test'));
  const posts = [...world.scatter.fixedInstances()].filter(
    (i) => i.asset === 'marker_post',
  );
  const make = () =>
    new Breakables(world.scatter, (x, z) => world.heightAt(x, z));
  const quat = (heading: number) =>
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading);
  const car = (x: number, z: number, heading: number, y?: number) => ({
    position: new Vector3(x, y ?? world.heightAt(x, z) + 0.5, z),
    quaternion: quat(heading),
    velocity: new Vector3(
      Math.sin(heading),
      0,
      Math.cos(heading),
    ).multiplyScalar(20),
    length: 4,
    width: 1.8,
  });

  test('the map has marker posts', () => {
    expect(posts.length).toBeGreaterThan(10);
  });

  test('driving the centre line knocks none over', () => {
    const b = make();
    for (let d = 0; d < world.road.length; d += 0.5) {
      const s = world.road.at(d);
      b.hit(car(s.x, s.z, Math.atan2(s.tx, s.tz), s.y + 0.5));
    }
    expect(b.count).toBe(0);
  });

  test('driving over a post knocks it over once, it falls flat, reset stands it up', () => {
    const b = make();
    const p = posts[0];
    const hits = b.hit(car(p.x + 0.5, p.z, 0.3));
    expect(hits).toEqual([p]);
    expect(b.hit(car(p.x, p.z, 0.3))).toEqual([]);
    let last = new Matrix4();
    for (let i = 0; i < 120; i++)
      b.update(1 / 60, (inst, m) => {
        expect(inst).toBe(p);
        last = m.clone();
      });
    // The post's local up axis now lies (nearly) flat, slid along the push direction.
    const up = new Vector3().setFromMatrixColumn(last, 1).normalize();
    expect(Math.abs(up.y)).toBeLessThan(0.05);
    const pos = new Vector3().setFromMatrixPosition(last);
    expect(Math.hypot(pos.x - p.x, pos.z - p.z)).toBeGreaterThan(0.5);
    const restored: unknown[] = [];
    b.reset((inst) => restored.push(inst));
    expect(restored).toEqual([p]);
    expect(b.count).toBe(0);
  });

  test('jumping high over a post misses it', () => {
    const b = make();
    const p = posts[0];
    expect(b.hit(car(p.x, p.z, 0, p.y + 3))).toEqual([]);
  });
});
