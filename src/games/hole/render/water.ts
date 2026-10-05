import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { Rng } from '../../../shared/rng';
import { coastRadius, type MapData } from '../map/types';
import { applyHoleCut } from './materials';
import { Soup } from './soup';

/** Water level; the island skirt dives below it. */
export const WATER_Y = -0.9;

/** Soft wavy highlight lines on a transparent tile (white, low alpha); tiles seamlessly. */
function rippleTexture(seed: number): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rng = new Rng(seed);
  g.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const w = rng.range(14, 38);
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.1, 0.26).toFixed(3)})`;
    g.lineWidth = rng.range(1.5, 3);
    // draw each wave three times around the tile edge so the repeat has no seam
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + ox - w / 2, y + oy);
        g.quadraticCurveTo(x + ox, y + oy - 3.5, x + ox + w / 2, y + oy);
        g.stroke();
      }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/**
 * Sea around an island: the water plane, two crossing layers of drifting ripple lines and the
 * white foam ring that breathes along the coast. `animate(seconds)` moves them (the game and the
 * map viewer call it every frame); everything is a shared texture + two planes, no per-frame allocation.
 */
export function buildWater(map: MapData): {
  group: Group;
  animate: (t: number) => void;
} {
  const group = new Group();
  const n = map.coast.length;
  const at = (i: number, inset: number): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    const r = coastRadius(map.coast, a) - inset;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };

  const water = new Mesh(
    new PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
    // the sea is cut by the hole like the ground, so the hole opens into its dark walls (not into the water)
    applyHoleCut(new MeshLambertMaterial({ color: 0x4aa3df })),
  );
  water.position.y = WATER_Y;
  group.add(water);

  // two ripple layers (different scale, direction and speed) cross each other
  const ripple = (seed: number, tile: number, y: number) => {
    const tex = rippleTexture(seed);
    const size = 5000;
    tex.repeat.set(size / tile, size / tile);
    const m = new Mesh(
      new PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      applyHoleCut(
        new MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          fog: true,
        }),
      ),
    );
    m.position.y = y;
    m.renderOrder = 1;
    group.add(m);
    return { tex, tile };
  };
  const rippleA = ripple(11, 22, WATER_Y + 0.004);
  const rippleB = ripple(29, 37, WATER_Y + 0.006);

  const foam = new Soup();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, z0] = at(i, -0.2);
    const [x1, z1] = at(j, -0.2);
    const [ox0, oz0] = at(i, -2.6);
    const [ox1, oz1] = at(j, -2.6);
    const y = WATER_Y + 0.008;
    foam.tri([x0, y, z0], [x1, y, z1], [ox1, y, oz1], 0xffffff);
    foam.tri([x0, y, z0], [ox1, y, oz1], [ox0, y, oz0], 0xffffff);
  }
  const foamMat = applyHoleCut(
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
    }),
  );
  const foamMesh = new Mesh(foam.geometry(), foamMat);
  foamMesh.renderOrder = 2;
  group.add(foamMesh);

  const animate = (t: number): void => {
    rippleA.tex.offset.set((t * 0.55) / rippleA.tile, (t * 0.3) / rippleA.tile);
    rippleB.tex.offset.set(
      (-t * 0.4) / rippleB.tile,
      (t * 0.65) / rippleB.tile,
    );
    foamMat.opacity = 0.5 + 0.14 * Math.sin(t * 1.6);
  };
  animate(0);
  return { group, animate };
}
