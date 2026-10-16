/** The levels (looks) of the arena. Pure data: the rules and the map generator never read it (DETAILS.md "Levels"). */
export const LEVEL_IDS = ['quarry', 'valley', 'sea'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export const DEFAULT_LEVEL: LevelId = 'quarry';

export interface LevelInfo {
  id: LevelId;
  label: string;
  /** One short line for the setup card. */
  blurb: string;
  /** The sudden-death banner's second line. */
  closing: string;
}

export const LEVELS: Readonly<Record<LevelId, LevelInfo>> = {
  quarry: {
    id: 'quarry',
    label: 'Quarry',
    blurb: 'Sandstone pit',
    closing: 'Walls are falling in',
  },
  valley: {
    id: 'valley',
    label: 'Green Valley',
    blurb: 'Sunny meadow',
    closing: 'Walls are falling in',
  },
  sea: {
    id: 'sea',
    label: 'Sea Deck',
    blurb: 'Raft at sea',
    closing: 'The deck is sinking',
  },
};

export const isLevelId = (v: unknown): v is LevelId =>
  typeof v === 'string' && (LEVEL_IDS as readonly string[]).includes(v);
