// Tiny dependency-free audio manager: sfx one-shots + looping music tracks,
// with a mute toggle persisted to localStorage.

export type SfxName = 'rug' | 'meeting' | 'vote' | 'slash' | 'win-crew' | 'win-rugger' | 'step';
export type MusicTrack = 'lobby' | 'tension';

const SFX_FILES: Record<SfxName, string> = {
  rug: '/sfx/rug.mp3',
  meeting: '/sfx/meeting.mp3',
  vote: '/sfx/vote.mp3',
  slash: '/sfx/slash.mp3',
  'win-crew': '/sfx/win-crew.mp3',
  'win-rugger': '/sfx/win-rugger.mp3',
  step: '/sfx/step.mp3',
};

const MUSIC_FILES: Record<MusicTrack, string> = {
  lobby: '/music/lobby.mp3',
  tension: '/music/tension.mp3',
};

const MUTE_KEY = 'rugged:muted';

class AudioManager {
  private sfx = new Map<SfxName, HTMLAudioElement>();
  private currentMusic: HTMLAudioElement | null = null;
  private currentTrack: MusicTrack | null = null;
  private muted: boolean;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  /** Preload every sfx clip so play() is instant. */
  preload(): void {
    for (const [name, src] of Object.entries(SFX_FILES) as [SfxName, string][]) {
      const el = new Audio(src);
      el.preload = 'auto';
      this.sfx.set(name, el);
    }
  }

  play(name: SfxName): void {
    if (this.muted) return;
    const base = this.sfx.get(name);
    if (!base) return;
    // Clone so overlapping plays of the same sfx don't cut each other off.
    const el = base.cloneNode(true) as HTMLAudioElement;
    void el.play().catch(() => {});
  }

  music(track: MusicTrack, opts: { loop?: boolean } = {}): void {
    if (this.currentTrack === track) return;
    this.currentMusic?.pause();
    const el = new Audio(MUSIC_FILES[track]);
    el.loop = opts.loop ?? true;
    el.muted = this.muted;
    void el.play().catch(() => {});
    this.currentMusic = el;
    this.currentTrack = track;
  }

  stopMusic(): void {
    this.currentMusic?.pause();
    this.currentMusic = null;
    this.currentTrack = null;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (this.currentMusic) this.currentMusic.muted = muted;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }
}

export const audio = new AudioManager();
