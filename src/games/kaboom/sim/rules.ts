import type { Difficulty } from './types';

/** Tuning constants (DETAILS.md "Rules"). The only place to change a rule number. DOM-free. */

/** Simulation rate; the renderer interpolates between ticks. */
export const TICK_HZ = 60;
export const STEP = 1 / TICK_HZ;

/** Seconds a TNT burns on Easy (the band always counts 3 -> 2 -> 1, whatever the length). */
export const FUSE_S = 3;
/** Fuse per difficulty: Normal and Hard burn faster (a quicker game). */
export const FUSE_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = {
  easy: FUSE_S,
  normal: 2,
  hard: 2,
};
/** The shortest fuse of any difficulty: spawn safety is proven against it, so every difficulty is safe. */
export const MIN_FUSE_S = 2;
/** Delay before a TNT hit by a blast goes off: spreads a long chain over many frames. */
export const CHAIN_DELAY_S = 0.08;
/** How long a flame tile burns. */
export const FLAME_S = 0.5;

export const START_TNT = 1;
export const START_RANGE = 2;
/**
 * Blasts turn corners from level 4 (range 5): each arm branches round the first corner it passes (an open side), at
 * level 5 (range 6) round the first two; a branch reaches `CORNER_REACH` cells (`walkBlast` in `blast.ts`).
 */
export const CORNER_FROM_RANGE = START_RANGE + 3;
export const MAX_CORNERS = 2;
export const CORNER_REACH = 2;
/** Tiles per second. */
export const BASE_SPEED = 4;
/** Player collision radius in cells (cornering assist uses it). */
export const PLAYER_RADIUS = 0.35;

/** Round timer: a draw if nobody has won by then (sudden death makes that rare). */
export const ROUND_S = 120;
/** Sudden death: this many seconds before the round timer ends, walls start to fall in a spiral from the edge. */
export const SUDDEN_S = 50;
/** Seconds between two falling walls. */
export const FALL_INTERVAL_S = 0.3;
/** Seconds before the first input counts (countdown 3-2-1-GO). */
export const COUNTDOWN_S = 3;

export const MAX_PLAYERS = 8;
/** Team colours in the palette (`TEAM_COLORS` in `render/characters.ts`): one per player slot. */
export const TEAM_COUNT = MAX_PLAYERS;
/**
 * Power-ups: how many drop in a round (hidden in crates), and how many times each kind can be taken (level 1 -> 5:
 * TNT 1 -> 5, blast 2 -> 6). Maxing both takes 8, so a player who wants it all must win some of the others'. The
 * total grows by `POWERUPS_PER_PLAYER` per player on top of `POWERUPS_BASE`, but never covers more than
 * `POWERUPS_MAX_CRATE_SHARE` of the arena's crates (a full small arena would otherwise hide one in every other crate).
 */
export const POWERUPS_BASE = 6;
export const POWERUPS_PER_PLAYER = 2;
export const POWERUPS_MAX_CRATE_SHARE = 0.4;
/** Power-ups hidden this round for `players` players in an arena with `crates` crates. */
export const powerUpTotal = (players: number, crates: number): number =>
  Math.min(
    crates,
    POWERUPS_BASE + players * POWERUPS_PER_PLAYER,
    Math.floor(crates * POWERUPS_MAX_CRATE_SHARE),
  );
export const MAX_POWER_LEVEL = 4;
/** Per-player TNT cap with power-ups. */
export const MAX_TNT_PER_PLAYER = 8;
/** Size of the fixed TNT pool in the sim and the renderer. */
export const MAX_TNT = MAX_PLAYERS * MAX_TNT_PER_PLAYER;

/** Share of the free cells that get a crate (before the spawn clearings). */
export const CRATE_RATIO = 0.7;

/** Cell edge in world metres (the renderer's unit). */
export const CELL_SIZE = 1;

/** Cornering assist: a player this far (cells) past the middle of a lane is slid into the free lane next to a wall corner. */
export const CORNER_MIN = 0.2;
