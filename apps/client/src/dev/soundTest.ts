import { CONTINUOUS, audio } from '../audio/engine.ts';
import type { SoundId } from '../audio/engine.ts';
import { SOUNDS } from '../audio/recipes.ts';

/** The sound test page (dev tool): every sound on a button, the volume, the ambience and the engine. */
const bar = document.getElementById('bar') as HTMLElement;
const list = document.getElementById('list') as HTMLElement;

function button(text: string, click: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', () => {
    audio.unlock();
    click();
  });
  return b;
}

const volume = document.createElement('input');
volume.type = 'range';
volume.min = '0';
volume.max = '100';
volume.value = String(Math.round(audio.volume * 100));
volume.addEventListener('input', () => {
  audio.unlock();
  audio.setVolume(Number(volume.value) / 100);
});

let ambience = false;
const amb = button('Sea ambience: off', () => {
  ambience = !ambience;
  if (ambience) audio.startAmbient();
  else audio.stopAmbient();
  amb.textContent = `Sea ambience: ${ambience ? 'on' : 'off'}`;
  amb.classList.toggle('on', ambience);
});
const speed = document.createElement('input');
speed.type = 'range';
speed.min = '0';
speed.max = '100';
speed.value = '0';
speed.addEventListener('input', () => audio.setEngine(Number(speed.value) / 100, true));

const all = button('Play all, one after another', () => {
  const ids = Object.keys(SOUNDS) as SoundId[];
  ids.forEach((id, i) => setTimeout(() => audio.play(id, { own: true }), i * 1300));
});

bar.append('Volume', volume, amb, 'Engine (needs the ambience on)', speed, all);

const groups = new Map<string, HTMLElement>();
for (const id of Object.keys(SOUNDS) as SoundId[]) {
  const def = SOUNDS[id];
  let grid = groups.get(def.group);
  if (!grid) {
    const h = document.createElement('h2');
    h.textContent = def.group;
    grid = document.createElement('div');
    grid.className = 'grid';
    list.append(h, grid);
    groups.set(def.group, grid);
  }
  const b = button(`${def.label}  [${id}]`, () => audio.play(id, { own: true, size: 1 }));
  grid.append(b);
}

// Which sounds a file replaces (known once the audio is unlocked and the files are read): shown with a mark.
function markFiles(): void {
  for (const b of list.querySelectorAll('button')) {
    const id = /\[(\w+)\]$/.exec(b.textContent ?? '')?.[1];
    if (id && audio.usingFile(id)) b.classList.add('file');
  }
}
setInterval(markFiles, 1000);

const note = document.createElement('p');
note.textContent = `Sounds that run all the time can be replaced by files too (ids: ${CONTINUOUS.join(', ')}). Sounds that a file replaces are marked green.`;
list.append(note);
