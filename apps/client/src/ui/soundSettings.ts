import { audio } from '../audio/engine.ts';
import { onLanguageChange, t } from '../i18n/index.ts';

const SPEAKER_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const SPEAKER_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

const WAVES =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 9c2.5-3 4.5-3 7 0s4.5 3 7 0 4.5-3 6 0M2 16c2.5-3 4.5-3 7 0s4.5 3 7 0 4.5-3 6 0"/></svg>';

/**
 * The sound settings: a mute button, the volume and a switch for the sea and engine sounds. The same control
 * is used on the menu and in a corner of the match; they follow each other through the engine.
 */
export class SoundSettings {
  private readonly mute = document.createElement('button');
  private readonly volume = document.createElement('input');
  private readonly sea = document.createElement('button');

  constructor(root: HTMLElement) {
    this.mute.type = 'button';
    this.mute.className = 'ss-mute';
    this.volume.type = 'range';
    this.volume.className = 'ss-volume';
    this.volume.min = '0';
    this.volume.max = '100';
    this.volume.title = t('sound.volume');
    this.sea.type = 'button';
    this.sea.className = 'ss-sea';
    this.sea.innerHTML = WAVES;
    root.append(this.mute, this.volume, this.sea);
    // Mouse clicks must not reach the game (they would fire the guns), and typing must not steer.
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('keydown', (e) => e.stopPropagation());
    this.mute.addEventListener('click', () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
      this.mute.blur();
    });
    this.volume.addEventListener('input', () => {
      audio.unlock();
      audio.setVolume(Number(this.volume.value) / 100);
    });
    // (Leaving the slider returns the keys to the game.)
    this.volume.addEventListener('change', () => this.volume.blur());
    this.sea.addEventListener('click', () => {
      audio.unlock();
      audio.setAmbient(!audio.ambientOn);
      this.sea.blur();
    });
    audio.subscribe(() => this.refresh());
    onLanguageChange(() => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    this.mute.innerHTML = audio.muted ? SPEAKER_OFF : SPEAKER_ON;
    this.mute.title = t('sound.mute');
    this.volume.title = t('sound.volume');
    this.mute.classList.toggle('off', audio.muted);
    this.volume.value = String(Math.round(audio.volume * 100));
    this.sea.title = t('sound.ambient');
    this.sea.classList.toggle('off', !audio.ambientOn);
  }
}
