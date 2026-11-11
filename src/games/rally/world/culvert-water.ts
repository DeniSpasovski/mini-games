import { BufferAttribute, BufferGeometry, Mesh, type Scene } from 'three';
import { smoothstep } from '../../../shared/noise';
import { worldUniforms } from '../engine/world-shading';
import { culvertFloor, WALL_T, WING_FLARE } from './culverts';
import type { CulvertEnd, CulvertSite } from './culverts';
import { animateWater, culvertFlow, getWaterMaterial } from './water-mesh';
import type { World } from './world';

/**
 * Storm water in the culverts: when it rains the drainage lines the culverts carry run. At each end a ribbon of
 * muddy water lies in the pipe, spreads over the apron and follows the gully (the outlet jets out and breaks into foam,
 * the inlet backs up against the headwall and is sucked in). One merged mesh built at full flow; the shader lowers it to
 * the flow the weather gives (`culvertFlow`) and draws nothing when it is dry, so there is no per-frame work.
 */

/** Pipe barrel / silt as the headwall mesh builds them (culvert-mesh.ts): water starts inside the wall's back. */
const PLUG = -WALL_T + 0.03;
const MOUTH = 0.25;
const SILT_TOP = 0.05;
/** The apron slab's top over the channel floor (culvert-mesh.ts) and the gully's side slope (culverts.ts). */
const APRON_TOP = 0.065;
const SIDE = 0.9;
/** Depth of the stream in the gully at full flow (m) and the share of the pipe diameter the water fills in the pipe. */
const STREAM = 0.14;
const FILL = 0.32;
/** Across samples (odd), and how far the ribbon reaches under the banks. */
const ACROSS = 7;
const OVERLAP = 1.15;

export interface WaterRow {
  /** Distance out from the headwall face (m, negative = inside the pipe). */
  t: number;
  /** Water surface over the pipe invert at the centre line (m), centre depth (m) and half width (m). */
  level: number;
  depth: number;
  half: number;
  /** Churn 0..1 (the jet leaving the pipe, the water piling at the inlet). */
  turb: number;
}

/** Rows of a culvert end's water at full flow, from inside the pipe out along the gully. */
export function waterRows(site: CulvertSite, e: CulvertEnd): WaterRow[] {
  const ri = site.diameter / 2;
  const hPipe = Math.min(FILL * site.diameter, 0.45 * site.diameter);
  const chord = Math.sqrt(Math.max(0.01, ri * ri - (ri - hPipe) ** 2)) * 0.98;
  const out = e.side > 0;
  const tip = e.wing;
  // The inlet's water only backs up in front of the wall; the outlet runs on down the gully.
  const end = Math.max(tip + 2, out ? e.run : Math.min(e.run, 5));
  const ts = [PLUG, 0, MOUTH];
  for (let t = MOUTH + 0.5; t < tip; t += 0.5) ts.push(t);
  for (let t = tip; t < end; t += 1) ts.push(t);
  ts.push(end);
  return ts.map((t) => {
    if (t <= MOUTH)
      return {
        t,
        level: hPipe,
        depth: hPipe - SILT_TOP,
        half: chord,
        turb: out ? 0.5 : 0.35,
      };
    const floor = culvertFloor(e, t) - e.invert;
    const lip = APRON_TOP * (1 - smoothstep(tip, tip + 0.6, t));
    const bed = floor + lip;
    const k = t - MOUTH;
    // The outlet's jet settles to the stream in ~1.5 m; the inlet piles up against the wall and eases over ~2.5 m.
    const settle = Math.exp(-k / (out ? 1.5 : 2.5));
    const fade = 1 - smoothstep(end - 4, end, t);
    const depth = (STREAM + (hPipe - APRON_TOP - STREAM) * settle) * fade;
    const wingInner = e.half - 0.15 + t * WING_FLARE;
    // The stream spreads out of the pipe's width over the apron and settles to the gully's.
    const spread = Math.min(
      chord + k * (out ? 0.3 : 0.18),
      0.5 * site.diameter + 0.4 + depth / SIDE,
    );
    const half = t < tip ? Math.min(wingInner - 0.04, spread) : spread;
    return {
      t,
      level: bed + depth,
      depth,
      half: Math.max(half * fade, 0.02),
      turb: out ? settle : 0.5 * settle,
    };
  });
}

/** One merged mesh with the water of every culvert end of the map, or undefined without culverts. */
export function culvertWaterMesh(world: World): Mesh | undefined {
  const sites = world.gen.culverts;
  if (!sites.length) return undefined;
  const pos: number[] = [];
  const uv: number[] = [];
  const depth: number[] = [];
  const turb: number[] = [];
  const idx: number[] = [];
  const R = ACROSS;
  for (const s of sites)
    for (const e of s.ends) {
      const rows = waterRows(s, e);
      const dx = s.ax * e.side;
      const dz = s.az * e.side;
      const v0 = pos.length / 3;
      // Ripples run the way the water goes: out of the outlet, into the inlet.
      const dir = e.side > 0 ? 1 : -1;
      for (const r of rows)
        for (let j = 0; j < R; j++) {
          const side = (j / (R - 1)) * 2 - 1;
          const x = side * r.half * OVERLAP;
          const edge = side * OVERLAP;
          pos.push(
            s.x + dx * (e.u + r.t) + dz * x,
            e.invert + r.level,
            s.z + dz * (e.u + r.t) - dx * x,
          );
          uv.push(x / 9, (dir * (e.u + r.t)) / 9);
          depth.push(r.depth * Math.max(0, 1 - edge * edge));
          turb.push(r.turb);
        }
      for (let i = 0; i < rows.length - 1; i++)
        for (let j = 0; j < R - 1; j++) {
          const a = v0 + i * R + j;
          idx.push(a, a + R, a + 1, a + 1, a + R, a + R + 1);
        }
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('waterDepth', new BufferAttribute(new Float32Array(depth), 1));
  g.setAttribute('waterTurb', new BufferAttribute(new Float32Array(turb), 1));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = getWaterMaterial(true, true);
  const mesh = new Mesh(g, mat);
  mesh.name = 'culvert-water';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.onBeforeRender = (_r, scene: Scene) => {
    const u = worldUniforms.wsWet.value;
    culvertFlow.value = flowOf(u.x, u.y);
    animateWater(scene, mat);
  };
  return mesh;
}

/** How much the culverts run (0..1): in the rain the drainage lines run, a trickle stays after it. */
export function flowOf(wet: number, rain: number): number {
  const storm = Math.min(1, rain / 6);
  const after = 0.15 * smoothstep(0.35, 0.6, wet);
  return Math.max(storm * (0.5 + 0.5 * storm), after);
}
