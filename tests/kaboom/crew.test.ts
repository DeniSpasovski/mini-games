import { expect, test } from '@rstest/core';
import { Box3, DataTexture, Mesh } from 'three';
import {
  CRITTER_SCALE,
  Crew,
  TEAM_COLORS,
} from '../../src/games/kaboom/render/characters';
import { buildCritter } from '../../src/games/kaboom/render/crew-parts';
import { BONE_COUNT } from '../../src/games/kaboom/render/critters';
import { TOON_MARKS } from '../../src/games/kaboom/render/toon';
import { BlobShadows } from '../../src/games/kaboom/render/shadows';
import { TntRenderer, tntLevel } from '../../src/games/kaboom/render/tnt';
import { TNT_LAYOUTS } from '../../src/games/kaboom/render/crew-parts';
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
    expect(g.getAttribute('position').count).toBeLessThan(30000);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    expect(b.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(b.max.y).toBeLessThan(1.1);
    expect(b.max.x).toBeLessThan(0.55);
    expect(b.min.x).toBeGreaterThan(-0.55);
    expect(b.min.z).toBeGreaterThan(-0.95); // tails stick out behind
    expect(b.max.z).toBeLessThan(0.55);
    // the hat sits on top of the head
    expect(m.hatY).toBeGreaterThan(0.7);
    expect(m.hatY).toBeLessThan(b.max.y + 0.02);
    expect(m.hatY).toBeGreaterThan(b.max.y - 0.2);
  }
});

test('the crew differ in build: heights and widths spread, a slim tall one and a low broad one', () => {
  const size = CRITTERS.map((id) => {
    const g = buildCritter(id).geometry;
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    // width of the torso at the waist band, not the arms
    return { id, h: b.max.y, w: b.max.x - b.min.x };
  });
  const hs = size.map((s) => s.h);
  expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.2);
  const otter = size.find((s) => s.id === 'otter')!;
  const mole = size.find((s) => s.id === 'mole')!;
  expect(otter.h).toBeGreaterThan(
    hs.reduce((a, b) => a + b, 0) / hs.length + 0.08,
  );
  expect(mole.w).toBeGreaterThan(otter.w + 0.15);
});

test('every critter is painted: its marks fit the shader, the skin is tagged for the paint, the rigid parts not', () => {
  for (const id of CRITTERS) {
    const m = buildCritter(id);
    expect(m.paint.marks.length).toBeGreaterThan(10);
    expect(m.paint.marks.length).toBeLessThanOrEqual(TOON_MARKS);
    const tag = m.geometry.getAttribute('aToon');
    expect(tag.count).toBe(m.geometry.getAttribute('position').count);
    let painted = 0;
    for (let i = 0; i < tag.count; i++) if (tag.getX(i) > 0.5) painted++;
    expect(painted).toBeGreaterThan(3000); // the skin
    expect(painted).toBeLessThan(tag.count); // eyes are paint, but noses, gloves and the belt are parts
  }
});

test('every critter is skinned: weights summing to 1 on real bones', () => {
  for (const id of CRITTERS) {
    const m = buildCritter(id);
    expect(m.joints.length).toBe(BONE_COUNT * 3);
    for (const g of [m.geometry]) {
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      expect(si.count).toBe(g.getAttribute('position').count);
      for (let i = 0; i < si.count; i += 7) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          expect(si.getComponent(i, k)).toBeLessThan(BONE_COUNT);
          sum += sw.getComponent(i, k);
        }
        expect(Math.abs(sum - 1)).toBeLessThan(1e-3);
      }
    }
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
  expect(meshes).toBe(8 + 3 + 1); // a body each, + the arrow over the human
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
  const arrow = crew.group.getObjectByName('you-arrow') as Mesh;
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

test('crew: a benched critter is launched into the sky and gone; back in, it drops onto its spawn and lands', () => {
  const ps = players(3);
  const crew = new Crew(ps, W, H);
  const landed: number[] = [];
  let launched = 0;
  crew.onLaunch = () => launched++;
  crew.onLand = (x) => landed.push(x);
  crew.update(1, 1 / 60);
  const body = crew.group.children[1] as Mesh; // player 1's body (one mesh per player)
  (ps[1] as { state: string }).state = 'out';
  for (let t = 0; t < 12; t++) crew.update(1, 1 / 60);
  expect(launched).toBe(1);
  expect(body.matrix.elements[13]).toBeGreaterThan(0.3); // up in the air
  for (let t = 0; t < 60; t++) crew.update(1, 1 / 60);
  expect(body.matrix.elements[5]).toBeCloseTo(0); // scaled away

  (ps[1] as { state: string }).state = 'alive';
  crew.update(1, 1 / 60);
  expect(body.matrix.elements[13]).toBeGreaterThan(4); // starts high
  for (let t = 0; t < 40; t++) crew.update(1, 1 / 60);
  expect(landed.length).toBe(1);
  expect(body.matrix.elements[13]).toBeLessThan(0.2);
});

test('crew: a critter that is already benched when the crew is built is simply not there', () => {
  const ps = players(2);
  (ps[1] as { state: string }).state = 'out';
  const crew = new Crew(ps, W, H);
  let launched = 0;
  crew.onLaunch = () => launched++;
  crew.update(1, 1 / 60);
  expect(launched).toBe(0);
  const body = crew.group.children[1] as Mesh;
  expect(body.matrix.elements[5]).toBeCloseTo(0);
});

test('TNT renderer: a TNT shows its blast level as sticks - 1 stick at level 1 (range 2) up to 5 at level 5', () => {
  expect([2, 3, 4, 5, 6].map(tntLevel)).toEqual([1, 2, 3, 4, 5]);
  expect(TNT_LAYOUTS.map((l) => l.length)).toEqual([1, 2, 3, 4, 5]);
  const r = new TntRenderer(W, H, digitAtlas());
  const list = tntList([2, 2, 2, 2, 2]);
  list.forEach((t, i) => ((t as { range: number }).range = 2 + i));
  r.update(list, 1 / 60);
  const level = (r as unknown as { level: { getX(i: number): number } }).level;
  expect([0, 1, 2, 3, 4].map((i) => level.getX(i))).toEqual([1, 2, 3, 4, 5]);
  // every stick layout is in the body geometry, tagged with its level; the fuse (0) is shared
  const body = (r as unknown as { body: Mesh }).body.geometry;
  const tags = new Set(Array.from(body.getAttribute('aLayout').array));
  expect([...tags].sort()).toEqual([0, 1, 2, 3, 4, 5]);
});
