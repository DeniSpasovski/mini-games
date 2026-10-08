import { expect, test } from '@rstest/core';
import { Box3, DataTexture, Mesh } from 'three';
import {
  CRITTER_SCALE,
  Crew,
  TEAM_COLORS,
} from '../../src/games/kaboom/render/characters';
import { buildCritter } from '../../src/games/kaboom/render/crew-parts';
import { BlobShadows } from '../../src/games/kaboom/render/shadows';
import { TntRenderer } from '../../src/games/kaboom/render/tnt';
import { FUSE_S, MAX_TNT } from '../../src/games/kaboom/sim/rules';
import { Player } from '../../src/games/kaboom/sim/state';
import { CRITTERS, type TntView } from '../../src/games/kaboom/sim/types';

const W = 13;
const H = 11;

function players(n = 8): Player[] {
  return CRITTERS.slice(0, n).map((c, i) => {
    const p = new Player(i, c, i > 0);
    p.resetForRound(1 + i, 1);
    return p;
  });
}

test('every critter model: painted, a cell tall at most, within the player footprint, light enough', () => {
  for (const id of CRITTERS) {
    const m = buildCritter(id);
    const g = m.geometry;
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('normal')).toBeDefined();
    expect(g.getAttribute('position').count).toBeLessThan(15000);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    expect(b.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(b.max.y).toBeLessThan(1.1);
    expect(b.max.x).toBeLessThan(0.55);
    expect(b.min.x).toBeGreaterThan(-0.55);
    expect(b.min.z).toBeGreaterThan(-0.95); // tails stick out behind
    expect(b.max.z).toBeLessThan(0.55);
    expect(m.hatY).toBeGreaterThan(0.8);
  }
});

test('team colours: one per player slot, all different', () => {
  expect(TEAM_COLORS.length).toBeGreaterThanOrEqual(8);
  expect(new Set(TEAM_COLORS).size).toBe(TEAM_COLORS.length);
});

test('crew: few draw calls however many players (bodies + hats + vests + feet + the you-arrow)', () => {
  const crew = new Crew(players(8), W, H);
  let meshes = 0;
  crew.group.traverse((o) => {
    if ((o as Mesh).isMesh) meshes++;
  });
  expect(meshes).toBe(8 + 3 + 1); // + the arrow over the human
});

test('crew: a KO sends the critter to a seat on the slab edge, a reset brings it back', () => {
  const ps = players(2);
  const crew = new Crew(ps, W, H);
  crew.update(1, 1 / 60);
  const body = crew.group.children[0] as Mesh;
  const homeX = body.matrix.elements[12];
  expect(Math.abs(homeX - (1.5 - W / 2))).toBeLessThan(0.05);

  ps[0].state = 'ko';
  crew.onEvent({ type: 'playerKo', id: 0, byOwner: 1 });
  for (let t = 0; t < 120; t++) crew.update(1, 1 / 60); // 2 s: shrink, pop, seated, hat landed
  const seatX = body.matrix.elements[12];
  const seatZ = body.matrix.elements[14];
  const outside = Math.abs(seatX) > W / 2 || Math.abs(seatZ) > H / 2;
  expect(outside).toBe(true);
  // the seated critter is visible (not scaled away)
  const sy = Math.hypot(
    body.matrix.elements[4],
    body.matrix.elements[5],
    body.matrix.elements[6],
  );
  expect(sy).toBeGreaterThan(0.5);

  crew.reset();
  crew.update(1, 1 / 60);
  expect(Math.abs(body.matrix.elements[12] - (1.5 - W / 2))).toBeLessThan(0.05);
});

test('crew: placing TNT squashes the critter, then it settles', () => {
  const ps = players(1);
  const crew = new Crew(ps, W, H);
  crew.update(1, 1 / 60);
  const body = crew.group.children[0] as Mesh;
  const height = () =>
    Math.hypot(
      body.matrix.elements[4],
      body.matrix.elements[5],
      body.matrix.elements[6],
    );
  crew.onEvent({ type: 'tntPlaced', x: 1, y: 1, owner: 0 });
  let min = 2;
  for (let t = 0; t < 30; t++) {
    crew.update(1, 1 / 60);
    min = Math.min(min, height());
  }
  expect(min).toBeLessThan(0.9);
  for (let t = 0; t < 60; t++) crew.update(1, 1 / 60);
  expect(Math.abs(height() - CRITTER_SCALE)).toBeLessThan(0.02);
});

const digitAtlas = () => new DataTexture(new Uint8Array(4), 1, 1);

function tntList(fuses: number[]): TntView[] {
  return Array.from({ length: MAX_TNT }, (_, i) => ({
    active: i < fuses.length,
    x: 1 + i,
    y: 1,
    owner: 0,
    fuse: fuses[i] ?? 0,
    range: 2,
  }));
}

test('TNT renderer: only active TNT are drawn and the band shows ceil(fuse)', () => {
  const r = new TntRenderer(W, H, digitAtlas());
  r.update(tntList([FUSE_S, 2.4, 1.2, 0.2]), 1 / 60);
  expect(r.count).toBe(4);
  r.update(tntList([]), 1 / 60);
  expect(r.count).toBe(0);
  r.update(tntList([2.9, 1.5, 0.1]), 1 / 60);
  const digit = (r as unknown as { digit: { getX(i: number): number } }).digit;
  expect([digit.getX(0), digit.getX(1), digit.getX(2)]).toEqual([2, 1, 0]);
});

test('TNT renderer: a full pool (MAX_TNT) fits', () => {
  const r = new TntRenderer(W, H, digitAtlas());
  r.update(tntList(new Array(MAX_TNT).fill(2)), 1 / 60);
  expect(r.count).toBe(MAX_TNT);
});

test('blob shadows: one draw call, capped at its capacity', () => {
  const s = new BlobShadows(3);
  s.begin();
  for (let i = 0; i < 5; i++) s.add(i, 0, 0.3);
  s.end();
  expect(s.mesh.count).toBe(3);
  s.begin();
  s.add(0, 0, 0.3);
  s.end();
  expect(s.mesh.count).toBe(1);
});

test('crew: the you-arrow follows the human and disappears when they are out', () => {
  const ps = players(2);
  const crew = new Crew(ps, W, H);
  const arrow = crew.group.children.find(
    (c) => (c as Mesh).geometry?.type === 'ConeGeometry',
  ) as Mesh;
  crew.update(1, 1 / 60);
  expect(arrow.visible).toBe(false); // nobody marked yet
  crew.setYou(0);
  crew.update(1, 1 / 60);
  expect(arrow.visible).toBe(true);
  expect(Math.abs(arrow.position.x - (ps[0].x - W / 2))).toBeLessThan(0.01);
  expect(arrow.position.y).toBeGreaterThan(1);
  ps[0].state = 'ko';
  crew.onEvent({ type: 'playerKo', id: 0, byOwner: 1 });
  crew.update(1, 1 / 60);
  expect(arrow.visible).toBe(false);
  crew.setYou(-1);
  crew.update(1, 1 / 60);
  expect(arrow.visible).toBe(false);
});
