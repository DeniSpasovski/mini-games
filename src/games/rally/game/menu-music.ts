import { isMutedByUrl } from '../../../shared/mute-param';
import type { SourceLink } from '../maps/shared/types';

/** Main menu music only (the race has no music). Files live in `sources/music/` (git-ignored), copied to `dist/games/rally/music/`. */
export interface MusicTrack {
  file: string;
  title: string;
  artist: string;
  /** Track page, shown in About (Pixabay Content License, attribution not required but given). */
  url: string;
}

/** Every track we have credits for; only the ones whose file was present at build time play (never requests a missing file). */
const ALL_TRACKS: MusicTrack[] = [
  {
    file: 'darkside-rally-house.mp3',
    title: 'darkside - rally house',
    artist: 'kawaiiwork',
    url: 'https://pixabay.com/music/upbeat-darkside-rally-house-410400/',
  },
  {
    file: 'sunset-house.mp3',
    title: 'Sunset House',
    artist: 'Aurec',
    url: 'https://pixabay.com/music/electronic-sunset-house-598438/',
  },
];

export const MENU_TRACKS = ALL_TRACKS.filter((t) =>
  __MUSIC_FILES__.includes(t.file),
);

/** About credits: one row per track. */
export const MUSIC_CREDITS: SourceLink[] = MENU_TRACKS.map((t) => ({
  label: `${t.title} - ${t.artist}`,
  url: t.url,
  note: 'menu music, Pixabay Content License',
}));

const FADE_MS = 400;

/** Slider 100% plays at this fraction of full volume (menu music was too loud). */
const MAX_LEVEL = 0.5;

/**
 * Loops the menu tracks in order and shows the current one bottom right. Browsers block audio before the first
 * click / key, so it starts on that gesture. No file at build time = no tracks: no request, no label, no About credit. A blocked play() stays silent.
 */
export class MenuMusic {
  private audio = new Audio();
  private label = document.createElement('div');
  private index = 0;
  private failed = 0;
  private volume: number;
  private fade = 0;
  private onGesture = () => this.play();
  private onHidden = () => {
    if (document.hidden) this.audio.pause();
    else this.play();
  };

  constructor(
    parent: HTMLElement,
    volume: number,
    private tracks: MusicTrack[] = MENU_TRACKS,
  ) {
    this.volume = volume;
    if (!tracks.length) return; // no music files in this build
    this.label.className = 'menu-now-playing';
    this.label.hidden = true;
    parent.append(this.label);
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.next());
    // A missing file is skipped; when every file is missing it stays silent (no label).
    this.audio.addEventListener('error', () => {
      this.label.hidden = true;
      if (++this.failed < this.tracks.length) this.next();
    });
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
    this.load();
    this.play();
  }

  /** 0..1, from the Options slider; 0 = off (fades out, starts again when raised). */
  setVolume(v: number): void {
    this.volume = v;
    if (!this.enabled) return this.stop();
    clearInterval(this.fade);
    this.fade = 0;
    this.audio.volume = this.level;
    this.play();
  }

  private next(): void {
    this.index = (this.index + 1) % this.tracks.length;
    this.load();
    this.play();
  }

  private get enabled(): boolean {
    return this.volume > 0 && !isMutedByUrl() && this.tracks.length > 0;
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    this.stop(true);
    this.label.remove();
  }

  private get level(): number {
    return Math.min(1, Math.max(0, this.volume)) * MAX_LEVEL;
  }

  private load(): void {
    const t = this.tracks[this.index];
    this.audio.src = new URL(`music/${t.file}`, location.href).href;
    this.label.textContent = `♪ ${t.title} · ${t.artist}`;
  }

  private play(): void {
    if (!this.enabled || document.hidden) return;
    if (!this.audio.paused) {
      this.label.hidden = false; // slider raised while fading out
      return;
    }
    this.audio.volume = this.level;
    this.audio.play().then(
      () => {
        this.failed = 0;
        this.label.hidden = false;
      },
      () => {
        // autoplay blocked: the first click / key calls play() again
      },
    );
  }

  /** Fade out, then pause (immediately on dispose, the menu is going away). */
  private stop(now = false): void {
    this.label.hidden = true;
    clearInterval(this.fade);
    if (now || this.audio.paused) {
      this.fade = 0;
      this.audio.pause();
      return;
    }
    const step = this.audio.volume / (FADE_MS / 40);
    this.fade = window.setInterval(() => {
      this.audio.volume = Math.max(0, this.audio.volume - step);
      if (this.audio.volume <= 0.001) {
        clearInterval(this.fade);
        this.fade = 0;
        this.audio.pause();
      }
    }, 40);
  }
}
