import { LANGUAGES, currentLanguage, onLanguageChange, saveLanguage, setLanguage, setTitle } from '../i18n/index.ts';

const GLOBE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 4 5.7 4 9s-1.4 6.3-4 9c-2.6-2.7-4-5.7-4-9s1.4-6.3 4-9z"/></svg>';

/**
 * The language button of the start screen: it shows the name of the language in use and opens a list of all of them.
 * A choice takes effect at once, on the whole page, without a reload (see `setLanguage`), and is remembered.
 */
export class LanguagePicker {
  private readonly button = document.createElement('button');
  private readonly name = document.createElement('span');
  private readonly list = document.createElement('ul');
  private readonly items: HTMLLIElement[] = [];

  constructor(private readonly root: HTMLElement) {
    this.button.type = 'button';
    this.button.className = 'lp-button';
    this.button.setAttribute('aria-haspopup', 'listbox');
    setTitle(this.button, 'menu.language');
    const caret = document.createElement('i');
    caret.className = 'lp-caret';
    const globe = document.createElement('span');
    globe.className = 'lp-globe';
    globe.innerHTML = GLOBE;
    this.button.append(globe, this.name, caret);
    this.list.className = 'lp-list hidden';
    this.list.setAttribute('role', 'listbox');
    for (const lang of LANGUAGES) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      li.textContent = lang.name;
      // (The item's own language lets the browser pick the right font for its script.)
      li.lang = lang.code;
      li.addEventListener('click', () => this.choose(lang.code));
      li.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.choose(lang.code);
        }
      });
      this.list.append(li);
      this.items.push(li);
    }
    this.root.append(this.button, this.list);
    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    // Clicking elsewhere or pressing Escape closes it.
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !this.root.contains(e.target as Node)) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape') {
        this.close();
        this.button.focus();
      }
    });
    onLanguageChange(() => this.refresh());
    this.refresh();
  }

  private get isOpen(): boolean {
    return !this.list.classList.contains('hidden');
  }

  private open(): void {
    this.list.classList.remove('hidden');
    this.button.setAttribute('aria-expanded', 'true');
  }

  private close(): void {
    this.list.classList.add('hidden');
    this.button.setAttribute('aria-expanded', 'false');
  }

  private choose(code: string): void {
    this.close();
    saveLanguage(code);
    void setLanguage(code);
  }

  private refresh(): void {
    const now = currentLanguage();
    this.name.textContent = LANGUAGES.find((l) => l.code === now)?.name ?? 'English';
    this.name.lang = now;
    this.items.forEach((li, i) => {
      const on = LANGUAGES[i]!.code === now;
      li.classList.toggle('on', on);
      li.setAttribute('aria-selected', String(on));
    });
  }
}
