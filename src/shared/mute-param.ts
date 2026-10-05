/**
 * `?mute=1` (also `true`) silences a game's audio for this page load. Players
 * never need it; bots / automated browser sessions add it to every game URL so
 * testing is silent. Every game's audio class must start muted when this is set.
 * `?mute=0` (or no param) = normal sound, used when the work is a sound fix.
 */
export function isMutedByUrl(search: string = location.search): boolean {
  const raw = new URLSearchParams(search).get('mute');
  return raw === '1' || raw === 'true';
}
