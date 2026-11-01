import { describe, expect, test } from '@rstest/core';
import { Group, SpotLight } from 'three';
import { Headlights } from '../../src/games/rally/game/headlights';

const LAMP = { x: 0.6, y: 0.7, z: 2 };
const spots = (h: Headlights) =>
  h.group.children.filter((c): c is SpotLight => c instanceof SpotLight);

describe('headlights', () => {
  test('dry night: one centred, shadowed low beam + the spill (two spot lights in every lit shader)', () => {
    const s = spots(new Headlights(new Group(), LAMP, 'high'));
    expect(s.length).toBe(2);
    expect(s.map((l) => l.position.x)).toEqual([0, 0]);
    expect(s.filter((l) => l.castShadow).length).toBe(1);
  });

  test('rain / fog night: a low beam per lamp, one shadowed, + the spill', () => {
    const s = spots(
      new Headlights(new Group(), LAMP, 'high', undefined, 1, {
        perLamp: true,
      }),
    );
    expect(s.map((l) => l.position.x)).toEqual([-0.6, 0.6, 0]);
    expect(s.filter((l) => l.castShadow).length).toBe(1);
  });

  test('rain / fog day: the two low beams only, no shadow', () => {
    const s = spots(
      new Headlights(new Group(), LAMP, 'high', undefined, 0.2, { day: true }),
    );
    expect(s.map((l) => l.position.x)).toEqual([-0.6, 0.6]);
    expect(s.some((l) => l.castShadow)).toBe(false);
  });
});
