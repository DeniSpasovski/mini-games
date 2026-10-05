/**
 * Ground surface definitions. The tire model reads grip/shape from here, the
 * effects read dust / colour. Add new surfaces here and reference them by id
 * from maps (road surface) or from the terrain classifier in world/world.ts.
 *
 * Tuning notes:
 *  - mu         peak friction coefficient (tarmac ~1.0, gravel ~0.8)
 *  - slide      friction left when fully sliding, as a fraction of peak.
 *               Lower = snappier breakaway, higher = forgiving/predictable.
 *  - peakSlip   slip ratio where longitudinal grip peaks (loose = larger)
 *  - peakAngle  slip angle (deg) where lateral grip peaks (loose = larger)
 *  - rolling    rolling resistance coefficient (drag on every loaded wheel)
 *  - bump       amplitude (m) of high-frequency surface noise felt by wheels
 *  - rough      0..1 how bumpy / rutted the surface is for suspension set-ups (soft set-ups gain on rough
 *               ground, stiff ones on smooth - physics/car-tyres.ts); not a physics force by itself
 */
export interface SurfaceDef {
  id: SurfaceId;
  name: string;
  mu: number;
  slide: number;
  peakSlip: number;
  peakAngle: number;
  rolling: number;
  bump: number;
  rough: number;
  /** 0..1, how much dust / debris the wheels throw up. */
  dust: number;
  /** Dust / debris colour (sRGB hex). */
  dustColor: number;
  /** Skid / audio "crunch" character 0 = hard surface, 1 = loose. */
  loose: number;
}

export type SurfaceId =
  | 'gravel'
  | 'gravel_loose'
  | 'grass'
  | 'dirt'
  | 'rock'
  | 'tarmac'
  | 'tarmac_gravel'
  | 'mud'
  | 'snow';

export const SURFACES: Record<SurfaceId, SurfaceDef> = {
  gravel: {
    id: 'gravel',
    name: 'Gravel',
    mu: 0.86,
    slide: 0.84,
    peakSlip: 0.16,
    peakAngle: 9,
    rolling: 0.022,
    bump: 0.006,
    rough: 0.6,
    dust: 1,
    dustColor: 0xb7a58a,
    loose: 1,
  },
  gravel_loose: {
    id: 'gravel_loose',
    name: 'Loose gravel',
    mu: 0.72,
    slide: 0.86,
    peakSlip: 0.2,
    peakAngle: 11,
    rolling: 0.045,
    bump: 0.01,
    rough: 0.75,
    dust: 1,
    dustColor: 0xb3a387,
    loose: 1,
  },
  grass: {
    id: 'grass',
    name: 'Grass',
    mu: 0.62,
    slide: 0.8,
    peakSlip: 0.14,
    peakAngle: 9,
    rolling: 0.06,
    bump: 0.012,
    rough: 0.8,
    dust: 0.25,
    dustColor: 0x6f7a48,
    loose: 0.6,
  },
  dirt: {
    id: 'dirt',
    name: 'Dirt',
    mu: 0.74,
    slide: 0.82,
    peakSlip: 0.16,
    peakAngle: 10,
    rolling: 0.04,
    bump: 0.01,
    rough: 0.7,
    dust: 0.8,
    dustColor: 0x8d7457,
    loose: 0.8,
  },
  rock: {
    id: 'rock',
    name: 'Rock',
    mu: 0.9,
    slide: 0.75,
    peakSlip: 0.11,
    peakAngle: 7,
    rolling: 0.02,
    bump: 0.015,
    rough: 0.9,
    dust: 0.1,
    dustColor: 0x8a8a86,
    loose: 0.2,
  },
  tarmac: {
    id: 'tarmac',
    name: 'Tarmac',
    mu: 1.05,
    slide: 0.72,
    peakSlip: 0.1,
    peakAngle: 7,
    rolling: 0.013,
    bump: 0.003,
    rough: 0,
    dust: 0,
    dustColor: 0x555555,
    loose: 0,
  },
  // Old, narrow village asphalt with a film of loose gravel / dust on top: less grip than
  // clean tarmac, slides earlier and a little dust, but much grippier than gravel.
  tarmac_gravel: {
    id: 'tarmac_gravel',
    name: 'Dusty tarmac',
    mu: 0.9,
    slide: 0.76,
    peakSlip: 0.12,
    peakAngle: 8,
    rolling: 0.016,
    bump: 0.004,
    rough: 0.25,
    dust: 0.35,
    dustColor: 0xa99f8c,
    loose: 0.35,
  },
  mud: {
    id: 'mud',
    name: 'Mud',
    mu: 0.5,
    slide: 0.88,
    peakSlip: 0.25,
    peakAngle: 13,
    rolling: 0.09,
    bump: 0.02,
    rough: 0.9,
    dust: 0.5,
    dustColor: 0x4b3a2a,
    loose: 0.9,
  },
  snow: {
    id: 'snow',
    name: 'Snow',
    mu: 0.4,
    slide: 0.9,
    peakSlip: 0.2,
    peakAngle: 12,
    rolling: 0.05,
    bump: 0.01,
    rough: 0.5,
    dust: 0.9,
    dustColor: 0xf2f4f8,
    loose: 0.9,
  },
};
