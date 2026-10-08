/**
 * The contract of 3, 2, 1 Kabooom: every work package codes against these types (DETAILS.md, TASKS.md).
 * DOM-free, no three.js. Change it only in a small change of its own.
 *
 * Coordinates: a cell is `(x, y)` with `0 <= x < w`, `0 <= y < h`, index `y * w + x`. Positions of players are in cell units
 * (a float; the centre of cell (3, 2) is `(3.5, 2.5)`). The renderer maps them to world metres with `cellToWorld` (grid.ts).
 */

// ------------------------------------------------------------------ map

/** Static terrain of one cell. TNT and flames are not terrain: they live in the sim state. */
export const Terrain = { Empty: 0, Hard: 1, Crate: 2 } as const;
export type TerrainKind = (typeof Terrain)[keyof typeof Terrain];

export type MapSizeId = 's' | 'm' | 'l';

export interface MapSizeDef {
  id: MapSizeId;
  label: string;
  /** Cells incl. the hard border. Both odd, so the pillars sit symmetric. */
  w: number;
  h: number;
  /** Spawn points the layout is built for. */
  maxPlayers: number;
}

export interface CellPos {
  x: number;
  y: number;
}

/** Generated map (`map/`), the sim's starting point. `terrain` is copied into the sim state; crates then disappear there. */
export interface MapData {
  sizeId: MapSizeId;
  w: number;
  h: number;
  seed: number;
  /** `Terrain` per cell. */
  terrain: Uint8Array;
  /** Visual variant per cell (crate / block model 0-3), chosen by the generator so the look is seeded too. Not used by the sim. */
  variant: Uint8Array;
  /** Spawn cells in assignment order: player `i` starts on `spawns[i]` (`spawns.length >= MapSizeDef.maxPlayers`). */
  spawns: readonly CellPos[];
}

// ------------------------------------------------------------------ match

/** The Boom Crew, in the fixed order used for colours and slots (DETAILS.md "Style"). */
export const CRITTERS = [
  'mole',
  'badger',
  'beaver',
  'hedgehog',
  'armadillo',
  'raccoon',
  'capybara',
  'otter',
] as const;
export type CritterId = (typeof CRITTERS)[number];

export type Difficulty = 'easy' | 'normal' | 'hard';
export type RoundCount = 1 | 3 | 5;

/** Menu choices of one match. Player 0 is the human, 1..bots are bots. Same config + seed + inputs = same match. */
export interface MatchConfig {
  seed: number;
  size: MapSizeId;
  /** 1..7 (bounded by the map size's `maxPlayers - 1`). */
  bots: number;
  difficulty: Difficulty;
  rounds: RoundCount;
  /** The human's critter; the bots get the others in `CRITTERS` order. */
  critter: CritterId;
}

// ------------------------------------------------------------------ sim in / out

/** What one player wants this tick. Bots and the keyboard / touch / gamepad layer fill the same struct. */
export interface PlayerInput {
  /** Move direction, each -1..1 (the sim normalises). */
  dx: number;
  dy: number;
  /** Place TNT (edge: counts when true on the tick). */
  place: boolean;
}

export type PlayerState = 'alive' | 'ko';

/** Read-only view of a player for rendering, HUD, bots. The sim owns and mutates the real data. */
export interface PlayerView {
  readonly id: number;
  readonly critter: CritterId;
  readonly isBot: boolean;
  readonly state: PlayerState;
  /** Position in cell units. */
  readonly x: number;
  readonly y: number;
  /** Position one tick ago (render interpolation). */
  readonly px: number;
  readonly py: number;
  /** Facing angle in radians (0 = +x, counter-clockwise on the grid, i.e. +y is `PI / 2`). */
  readonly facing: number;
  /** Walking right now (drives the waddle animation). */
  readonly moving: boolean;
  /** TNT the player can still place / the number placed and not yet gone off. */
  readonly tntLeft: number;
  readonly range: number;
  readonly speed: number;
  /** Rounds won in this match. */
  readonly wins: number;
}

/** A TNT on the field. `active` slots are valid; the array is a fixed pool of `MAX_TNT`. */
export interface TntView {
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly owner: number;
  /** Seconds until it goes off (the band shows `ceil(fuse)` as 3 / 2 / 1). */
  readonly fuse: number;
  /** Blast range in cells (the owner's range when it was placed). */
  readonly range: number;
}

/** Events of one tick, consumed by render / audio / HUD in the same frame. */
export type SimEvent =
  | { type: 'tntPlaced'; x: number; y: number; owner: number }
  | {
      type: 'tntExploded';
      x: number;
      y: number;
      owner: number;
      /** Arm length in cells (not counting the centre) for +x, -x, +y, -y. */
      arms: readonly [number, number, number, number];
      /** 0 = lit by its fuse, n = n links down a chain (the renderer may fade extra FX with it). */
      chainDepth: number;
    }
  | { type: 'blockBroken'; x: number; y: number }
  | { type: 'blockFell'; x: number; y: number }
  | { type: 'playerKo'; id: number; byOwner: number }
  | { type: 'roundOver'; winner: number | null }
  | { type: 'matchOver'; winner: number | null };

/**
 * The simulation (`sim/sim.ts`, WP1). Fixed step `STEP` seconds. Allocation-free after construction: `tick` returns the
 * same reused array every call (valid until the next tick).
 */
export interface KaboomSim {
  readonly map: MapData;
  readonly players: readonly PlayerView[];
  readonly tnts: readonly TntView[];
  /** Live terrain: a broken crate becomes `Terrain.Empty`. */
  readonly terrain: Uint8Array;
  /** Seconds of flame left per cell (0 = no flame). The renderer turns it into flame meshes + the glow grid. */
  readonly flame: Float32Array;
  /** Seconds since GO (0 during the countdown). */
  readonly time: number;
  /** Seconds left of the 3-2-1 countdown (players are frozen until 0). */
  readonly countdown: number;
  /** 0-based round index. */
  readonly round: number;
  /** This round has ended (players frozen; TNT and flames still play out). `nextRound()` starts the next one. */
  readonly over: boolean;
  /** The match has ended (a player has the majority of rounds, or all rounds were played). */
  readonly matchOver: boolean;
  /** Sudden death has begun: walls fall in a spiral from the edge. */
  readonly suddenDeath: boolean;
  /**
   * The next walls to fall within `horizonS` seconds: cell index into `cells`, seconds until it lands into `secs`
   * (at most their length); returns how many. Bots and the danger map use it.
   */
  upcomingFalls(
    horizonS: number,
    cells: Int16Array,
    secs: Float32Array,
  ): number;
  tick(inputs: readonly PlayerInput[]): readonly SimEvent[];
  /** Start the next round on a fresh map (`makeMap(round)`); no-op once the match is over. */
  nextRound(): void;
}
