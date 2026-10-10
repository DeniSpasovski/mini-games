import { expect, test } from '@rstest/core';
import { Matrix4, type InstancedMesh } from 'three';
import { SLAB_PAD } from '../../src/games/kaboom/render/camera-rig';
import { Crowd } from '../../src/games/kaboom/render/crowd';
import { QUALITY } from '../../src/games/kaboom/render/renderer';
import { Player } from '../../src/games/kaboom/sim/state';
import { CRITTERS } from '../../src/games/kaboom/sim/types';

function player(id: number, color: number, state: 'alive' | 'out' = 'alive') {
  const p = new Player(id, CRITTERS[id], id > 0);
  p.resetForRound(1 + id, 1);
  p.color = color;
  p.state = state;
  return p;
}

/** Team colours currently on the crowd's sprites. */
function shirtColors(crowd: Crowd): Set<number> {
  const out = new Set<number>();
  for (let k = 0; k < crowd.count; k++) out.add(crowd.colorOf(k));
  return out;
}

test('crowd: one draw call and a few hundred spectators on every arena size, fewer on low quality', () => {
  for (const [w, h] of [
    [13, 11],
    [17, 13],
    [23, 17],
  ]) {
    const crowd = new Crowd(w, h, SLAB_PAD, QUALITY.high);
    expect(crowd.group.children.length).toBe(crowd.drawCalls);
    expect(crowd.count).toBeGreaterThan(150);
    expect(crowd.count).toBeLessThan(600);
    const low = new Crowd(w, h, SLAB_PAD, QUALITY.low);
    expect(low.count).toBeLessThan(crowd.count);
    // nothing is drawn until the atlas is (needs WebGL)
    expect(crowd.group.children[0].visible).toBe(false);
  }
});

test('crowd: shirts only in the colours of the players in the match', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  crowd.setPlayers([player(0, 0), player(1, 1), player(2, 4, 'out')]);
  expect(shirtColors(crowd)).toEqual(new Set([0, 1]));

  // a bench change updates the palette
  crowd.setPlayers([player(0, 3)]);
  expect(crowd.shirtMask).toBe(1 << 3);
  expect(shirtColors(crowd)).toEqual(new Set([3]));
});

test('crowd: still at rest, jumps after an explosion and settles again', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  const mesh = crowd.group.children[0] as InstancedMesh;
  const m = new Matrix4();
  // height of the highest spectator
  const y = (): number => {
    let top = -Infinity;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      top = Math.max(top, m.elements[13]);
    }
    return top;
  };
  crowd.update(1, 0.016);
  const rest = y();
  crowd.excite(1);
  crowd.update(1.1, 0.016);
  expect(y()).toBeGreaterThan(rest);
  for (let t = 0; t < 400; t++) crowd.update(2 + t * 0.016, 0.016);
  expect(y()).toBe(rest);
});

test('crowd: fans sit in same-colour groups of up to 8, and some wave flags', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  crowd.setPlayers([player(0, 0), player(1, 1), player(2, 2), player(3, 5)]);
  const sizes = new Map<number, number>();
  const colours = new Map<number, number>();
  for (let k = 0; k < crowd.count; k++) {
    const g = crowd.groupOf(k);
    sizes.set(g, (sizes.get(g) ?? 0) + 1);
    // one colour per group
    expect(colours.get(g) ?? crowd.colorOf(k)).toBe(crowd.colorOf(k));
    colours.set(g, crowd.colorOf(k));
  }
  expect(Math.max(...sizes.values())).toBeLessThanOrEqual(8);
  expect(sizes.size).toBeGreaterThan(20);
  expect(crowd.flagCount).toBeGreaterThan(10);
  expect(crowd.flagCount).toBeLessThan(crowd.count / 2);
});
