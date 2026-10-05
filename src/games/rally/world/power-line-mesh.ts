import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import {
  POLE_H,
  POLE_WIRES,
  PYLON_H,
  PYLON_WIRES,
} from '../assets/builders/power';
import type { PowerSupport } from './power-lines';
import type { World } from './world';

/**
 * Cables of the power lines (MapDef.pylons / powerLines): three conductors per span, hanging in a parabola
 * between the support attachment points (tower arms / pole cross arm), one line mesh per power line.
 */

/** Sag of a span: ~10 m for a 300 m tower span, ~0.4 m for a 60 m pole span. */
const sagOf = (span: number): number => (span * span) / 9000;
const SEG = 8;

const wires = (s: PowerSupport) => (s.tower ? PYLON_WIRES : POLE_WIRES);

export function* powerLineMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const net = world.power;
  if (!net || !net.spans.length) return undefined;
  const ground = world.analytic;
  const byLine = new Map<number, number[]>();
  for (const { a, b } of net.spans) {
    const arr = byLine.get(a.line) ?? [];
    byLine.set(a.line, arr);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = Math.hypot(dx, dz);
    if (span < 8) continue;
    // Lateral (arm) direction: left of the span direction = (tz, -tx).
    const nx = dz / span;
    const nz = -dx / span;
    const ya = ground.height(a.x, a.z);
    const yb = ground.height(b.x, b.z);
    const wa = wires(a);
    const wb = wires(b);
    const sag = sagOf(span);
    for (let w = 0; w < 3; w++) {
      const n = Math.max(2, Math.ceil(span / SEG / 2));
      let prev: [number, number, number] | undefined;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lat = wa[w][1] + (wb[w][1] - wa[w][1]) * t;
        const h = wa[w][0] + (wb[w][0] - wa[w][0]) * t;
        const y0 = ya + (yb - ya) * t;
        const p: [number, number, number] = [
          a.x + dx * t + nx * lat,
          y0 + h - 4 * sag * t * (1 - t),
          a.z + dz * t + nz * lat,
        ];
        if (prev) arr.push(...prev, ...p);
        prev = p;
      }
    }
    if (arr.length > 60000) yield;
  }
  const group = new Group();
  group.name = 'power-lines';
  const mat = new LineBasicMaterial({ color: '#2b2d30' });
  for (const arr of byLine.values()) {
    if (!arr.length) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    g.computeBoundingSphere();
    const l = new LineSegments(g, mat);
    l.frustumCulled = true;
    l.matrixAutoUpdate = false;
    group.add(l);
    yield;
  }
  void PYLON_H;
  void POLE_H;
  return group.children.length ? group : undefined;
}
