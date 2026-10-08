/** Tuning constants (DETAILS.md "Rules"). The only place to change a rule number. DOM-free. */

/** Simulation rate; the renderer interpolates between ticks. */
export const TICK_HZ = 60;
export const STEP = 1 / TICK_HZ;

/** Seconds a TNT burns (the band counts 3 -> 2 -> 1, one per second). */
export const FUSE_S = 3;
/** Delay before a TNT hit by a blast goes off: spreads a long chain over many frames. */
export const CHAIN_DELAY_S = 0.08;
/** How long a flame tile burns. */
export const FLAME_S = 0.5;

export const START_TNT = 1;
export const START_RANGE = 2;
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
/** Per-player TNT cap with power-ups (v1). */
export const MAX_TNT_PER_PLAYER = 8;
/** Size of the fixed TNT pool in the sim and the renderer. */
export const MAX_TNT = MAX_PLAYERS * MAX_TNT_PER_PLAYER;

/** Share of the free cells that get a crate (before the spawn clearings). */
export const CRATE_RATIO = 0.7;

/** Cell edge in world metres (the renderer's unit). */
export const CELL_SIZE = 1;

/** Cornering assist: a player this far (cells) past the middle of a lane is slid into the free lane next to a wall corner. */
export const CORNER_MIN = 0.2;
