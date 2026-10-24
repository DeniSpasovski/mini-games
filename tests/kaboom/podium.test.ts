import { expect, test } from '@rstest/core';
import { PerspectiveCamera } from 'three';
import {
  boardMask,
  textColumns,
} from '../../src/games/kaboom/render/card-stunt';
import { SLAB_PAD } from '../../src/games/kaboom/render/camera-rig';
import { Crowd } from '../../src/games/kaboom/render/crowd';
import {
  Podium,
  podiumPlaces,
  STEP_H,
} from '../../src/games/kaboom/render/podium';
import { QUALITY } from '../../src/games/kaboom/render/renderer';

test('the podium stands second, first, third and is centred', () => {
  const p = podiumPlaces(3);
  expect(p.map((s) => s.rank)).toEqual([1, 0, 2]);
  expect(p[0].x).toBeCloseTo(-p[2].x);
  expect(p[1].x).toBeCloseTo(0);
  expect(p[1].height).toBe(STEP_H[0]);
  expect(STEP_H[0]).toBeGreaterThan(STEP_H[1]);
  expect(STEP_H[1]).toBeGreaterThan(STEP_H[2]);
});

test('with fewer players only the needed steps are built', () => {
  expect(podiumPlaces(2).map((s) => s.rank)).toEqual([1, 0]);
  expect(podiumPlaces(1).map((s) => s.rank)).toEqual([0]);
  expect(podiumPlaces(1)[0].x).toBeCloseTo(0);
});

test('steps rise from under the floor, third place first', () => {
  const lands: number[] = [];
  const p = new Podium(3, (x) => lands.push(x));
  const first = p.places.findIndex((s) => s.rank === 0);
  const third = p.places.findIndex((s) => s.rank === 2);
  expect(p.topY(first)).toBeLessThan(0);
  expect(p.done).toBe(false);
  p.update(0.2);
  expect(p.rise(third)).toBeGreaterThan(p.rise(first));
  for (let i = 0; i < 30; i++) p.update(0.05);
  expect(p.done).toBe(true);
  expect(p.topY(first)).toBeCloseTo(STEP_H[0]);
  expect(lands).toHaveLength(3);
});

test('the card board spells the text, centred, and lights all cards for a wave', () => {
  const b = boardMask('YOU!');
  expect(b.text).toBe('YOU!');
  expect(b.rows).toBe(9);
  expect(b.cols).toBeGreaterThanOrEqual(textColumns('YOU!') + 4);
  expect(b.lit).toHaveLength(b.rows * b.cols);
  const lit = b.lit.reduce((a, v) => a + v, 0);
  expect(lit).toBeGreaterThan(20);
  expect(lit).toBeLessThan(b.lit.length / 2);
  // top and bottom rows stay dark; the word is centred
  for (let x = 0; x < b.cols; x++) {
    expect(b.lit[x]).toBe(0);
    expect(b.lit[(b.rows - 1) * b.cols + x]).toBe(0);
  }
  const wave = boardMask(null);
  expect(wave.text).toBe('');
  expect(wave.lit.every((v) => v === 1)).toBe(true);
  expect(boardMask('?!').text).toBe('!');
  expect(boardMask('???').text).toBe('');
  // a long name widens the board instead of shrinking the letters
  expect(boardMask('CAPYBARA').cols).toBe(textColumns('CAPYBARA') + 4);
  expect(boardMask('YOU!')).toEqual(boardMask('YOU!'));
});

test('the crowd shows a stunt board on the far stand and takes it down', () => {
  const crowd = new Crowd(13, 11, SLAB_PAD, QUALITY.high);
  const cam = new PerspectiveCamera(35, 16 / 9, 1, 200);
  cam.position.set(0, 30, 25);
  cam.lookAt(0, 0, 0);
  expect(crowd.stuntText).toBe('');
  expect(crowd.cardStunt('BADGER', 1, { camera: cam, still: true })).toBe(
    'BADGER',
  );
  expect(crowd.stuntText).toBe('BADGER');
  crowd.refreshStunt();
  crowd.endStunt();
  expect(crowd.stuntText).toBe('');
  crowd.cardStunt('YOU!', 0, { camera: cam, seconds: 1 });
  expect(crowd.stuntText).toBe('YOU!');
  crowd.update(0.5, 0.5);
  expect(crowd.stuntText).toBe('YOU!');
  crowd.update(1.5, 1);
  expect(crowd.stuntText).toBe('');
  crowd.dispose();
});
