import { describe, expect, test } from '@rstest/core';
import { Box3 } from 'three';
import { buildCrew, crewSit } from '../../src/games/rally/assets/builders/crew';
import { helmet } from '../../src/games/rally/assets/builders/crew-helmet';
import { ALL_CARS } from '../../src/games/rally/cars';
import {
  crewLivery,
  liveryInfo,
  type CrewLivery,
  type CrewMotif,
} from '../../src/games/rally/cars/shared/livery';

const MOTIFS: CrewMotif[] = [
  'plain',
  'stripes',
  'slant',
  'split',
  'peaks',
  'swoosh',
  'checker',
];
const livery = (motif: CrewMotif): CrewLivery => ({
  main: '#1f4fb5',
  second: '#f2f2f2',
  third: '#f0c020',
  motif,
});
const tris = (parts: ReturnType<typeof buildCrew>): number =>
  parts.reduce(
    (n, p) =>
      n +
      (p.geometry.index?.count ?? p.geometry.getAttribute('position').count) /
        3,
    0,
  );

describe('rally crew in the seats', () => {
  const cars = ALL_CARS.filter((c) => c.model.cockpit);

  test('every car with a glazed cockpit model seats a crew', () => {
    expect(cars.length).toBeGreaterThan(10);
    for (const c of ALL_CARS)
      if (c.model.cockpit) expect(c.model.glass, c.id).toBeTruthy();
  });

  test('driver on the wheel side, both under the roof, one size', () => {
    for (const c of cars) {
      const cp = c.model.cockpit!;
      const d = crewSit(cp, false);
      const k = crewSit(cp, true);
      expect(Math.sign(d.hip.x), c.id).toBe(Math.sign(cp.wheel.at[0]));
      expect(Math.sign(k.hip.x), c.id).toBe(-Math.sign(cp.wheel.at[0]));
      expect(d.scale, c.id).toBe(k.scale);
      expect(d.scale, c.id).toBeGreaterThanOrEqual(0.9);
      // The driver may sit ahead of the model's seat to reach its wheel, never behind it.
      expect(d.hip.z, c.id).toBeGreaterThanOrEqual(k.hip.z - 1e-6);
      expect(d.hip.z - k.hip.z, c.id).toBeLessThan(0.3);
      for (const codriver of [false, true]) {
        const box = new Box3();
        for (const p of buildCrew(codriver, 1, {
          cockpit: cp,
          livery: livery('plain'),
        })) {
          p.geometry.computeBoundingBox();
          box.union(p.geometry.boundingBox!);
        }
        expect(box.max.y, c.id).toBeLessThanOrEqual(cp.roof);
        expect(box.min.y, c.id).toBeGreaterThan(0);
        expect(Math.abs(box.max.x) + Math.abs(box.min.x), c.id).toBeLessThan(2);
      }
    }
  });

  test('dressed for the livery: its own colours, a motif where it has graphics', () => {
    const of = (id: string): CrewLivery => {
      const def = ALL_CARS.find((c) => c.id === id)!;
      return crewLivery(def, liveryInfo(def, 0), 0);
    };
    expect(of('fiesta').motif).toBe('peaks');
    expect(of('lancer_evo_6').motif).toBe('stripes');
    expect(of('subie_22b').motif).toBe('swoosh');
    const plain = of('peugeot_206');
    expect(plain.motif).toBe('plain');
    expect(plain.main).toBe(
      ALL_CARS.find((c) => c.id === 'peugeot_206')!.model.paint,
    );
    // Every livery gives a motif and three different colours.
    for (const c of ALL_CARS) {
      const lv = crewLivery(c, liveryInfo(c, 0), 0);
      expect(MOTIFS, c.id).toContain(lv.motif);
      expect(new Set([lv.main, lv.second, lv.third]).size, c.id).toBe(3);
    }
  });

  test('every motif stays within the triangle budget', () => {
    const cp = cars.find((c) => c.id === 'skoda_rally')!.model.cockpit!;
    for (const motif of MOTIFS)
      for (const codriver of [false, true]) {
        const of = (lod: number): number =>
          tris(
            buildCrew(codriver, lod, { cockpit: cp, livery: livery(motif) }),
          );
        expect(of(0), motif).toBeLessThan(30000);
        expect(of(1), motif).toBeLessThan(12000);
      }
  });

  test('helmet shell faces outward in every design', () => {
    for (const motif of MOTIFS) {
      const h = helmet(livery(motif), true);
      const p = h.shell.getAttribute('position');
      const n = h.shell.getAttribute('normal');
      let out = 0;
      for (let i = 0; i < p.count; i++)
        if (
          p.getX(i) * n.getX(i) +
            p.getY(i) * n.getY(i) +
            p.getZ(i) * n.getZ(i) >
          0
        )
          out++;
      expect(out / p.count, motif).toBeGreaterThan(0.97);
    }
  });
});
