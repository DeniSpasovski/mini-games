/**
 * Times of day offered on the stage-select screen (game/menu.ts), in dropdown order (night last) - the one place to
 * retune them. The hour is the `?tod=<hours>` the environment reads (engine/environment.ts: `sunAt` for the sun,
 * engine/night.ts for the moon), so every stage of a map with `environment.timeOfDay` can run at any of them. Sun
 * heights are from `sunAt`.
 */
export const TIMES_OF_DAY = [
  /** Sun ~15 deg in the east: long cool shadows. */
  { id: 'early', label: 'Early morning', hour: 7 },
  /** Sun ~58 deg due south: short shadows, flat light. */
  { id: 'midday', label: 'Mid day', hour: 12 },
  /** Sun ~35 deg in the west. */
  { id: 'afternoon', label: 'Afternoon', hour: 15.5 },
  /** Sun ~8 deg in the west: low golden light, long shadows (night follows from 19:30). */
  { id: 'evening', label: 'Evening', hour: 17.5 },
  /** Moon high in the south, headlights on. */
  { id: 'night', label: 'Night', hour: 1 },
] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export type TimeOfDayId = TimeOfDay['id'];

export function timeOfDay(id: TimeOfDayId): TimeOfDay {
  return TIMES_OF_DAY.find((t) => t.id === id)!;
}

/** The slot whose hour is closest on the 24 h clock (a map's own default hour, `?tod=`) - labels the dropdown. */
export function slotFor(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24;
  const gap = (t: TimeOfDay) => {
    const d = Math.abs(t.hour - h);
    return Math.min(d, 24 - d);
  };
  // Clock order, so an hour exactly between two slots takes the earlier one whatever the dropdown order.
  const byHour = [...TIMES_OF_DAY].sort((a, b) => a.hour - b.hour);
  return byHour.reduce((a, b) => (gap(b) < gap(a) ? b : a));
}

/** 15.5 -> "15:30". */
export function formatHour(hour: number): string {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
