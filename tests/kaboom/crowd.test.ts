import { expect, test } from '@rstest/core';
import { Color, InstancedMesh, Matrix4 } from 'three';
import { SLAB_PAD } from '../../src/games/kaboom/render/camera-rig';
import { TEAM_COLORS } from '../../src/games/kaboom/render/characters';
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

/** Shirt colours (hex) currently set across the crowd's instances. */
function shirtColors(crowd: Crowd): Set<number> {
  const out = new Set<number>();
  for (const mesh of crowd.group.children as InstancedMesh[]) {
    const a = mesh.geometry.getAttribute('aShirtCol');
    for (let i = 0; i < mesh.count; i++)
      out.add(new Color(a.getX(i), a.getY(i), a.getZ(i)).getHex());
  }
  return out;
}

test('crowd: draw calls and triangles stay small on every arena size', () => {
  for (const [w, h] of [
    [13, 11],
    [17, 13],
    [23, 17],
  ]) {
    const crowd = new Crowd(w, h, SLAB_PAD, QUALITY.high);
    expect(crowd.group.children.length).toBe(CRITTERS.length);
    expect(crowd.count).toBeGreaterThan(150);
    expect(crowd.triangles).toBeLessThan(100_000);
    const low = new Crowd(w, h, SLAB_PAD, QUALITY.low);
    expect(low.count).toBeLessThan(crowd.count);
  }
});

test('crowd: shirts only in the colours of the players in the match', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  crowd.setPlayers([player(0, 0), player(1, 1), player(2, 4, 'out')]);
  const allowed = new Set([TEAM_COLORS[0], TEAM_COLORS[1]]);
  const seen = shirtColors(crowd);
  // spectators are shaded a few percent: every shirt is near one of the allowed colours
  expect(seen.size).toBeGreaterThan(0);
  const near = (hex: number) =>
    [...allowed].some((a) => {
      const d = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
      return d(a).every((v, k) => Math.abs(v - d(hex)[k]) < 70);
    });
  for (const hex of seen) expect(near(hex)).toBe(true);

  // a bench change updates the palette
  crowd.setPlayers([player(0, 3)]);
  expect(crowd.shirtMask).toBe(1 << 3);
});

test('crowd: still at rest, jumps after an explosion and settles again', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  const mesh = crowd.group.children[0] as InstancedMesh;
  const m = new Matrix4();
  // height of the highest spectator of this animal
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
