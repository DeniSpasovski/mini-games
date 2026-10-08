/** Look-and-feel parameters of one map style; the generator and the renderer read them (DETAILS.md "Maps"). */
export interface MapStyle {
  id: string;
  label: string;
  /** Share of the free cells that get a crate (before the spawn clearings). */
  crateRatio: number;
  /** Visual variants of crates and hard blocks (`MapData.variant` is in `0..n-1`). */
  crateVariants: number;
  hardVariants: number;
  /** Chance that a broken crate drops a power-up (v1; unused in v0). */
  powerUpRate: number;
}

export const QUARRY: MapStyle = {
  id: 'quarry',
  label: 'Quarry',
  crateRatio: 0.7,
  crateVariants: 2,
  hardVariants: 2,
  powerUpRate: 0.25,
};

export const MAP_STYLES: Record<string, MapStyle> = { quarry: QUARRY };
