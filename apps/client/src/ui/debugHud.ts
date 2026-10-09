import type { WebGLRenderer } from 'three';

/** `?debug=1` overlay (GAME_DESIGN.md §14). Dev-only, so strings are not localized. */
export class DebugHud {
  private readonly el: HTMLElement;
  private fpsEma = 60;
  private frameMsEma = 16;
  private lastUpdateMs = 0;
  private lastTicks = 0;
  private tickRate = 0;
  private mapInfo = '';

  constructor(el: HTMLElement) {
    this.el = el;
    el.classList.remove('hidden');
  }

  setMapInfo(text: string): void {
    this.mapInfo = text;
  }

  frame(
    frameMs: number,
    nowMs: number,
    renderer: WebGLRenderer,
    projectiles: number,
    ticks: number,
  ): void {
    if (frameMs > 0) {
      this.frameMsEma += (frameMs - this.frameMsEma) * 0.05;
      this.fpsEma = 1000 / this.frameMsEma;
    }
    if (nowMs - this.lastUpdateMs < 250) return;
    this.tickRate = ((ticks - this.lastTicks) * 1000) / (nowMs - this.lastUpdateMs);
    this.lastTicks = ticks;
    this.lastUpdateMs = nowMs;
    const info = renderer.info.render;
    this.el.textContent =
      `fps ${this.fpsEma.toFixed(0)}  frame ${this.frameMsEma.toFixed(1)} ms\n` +
      `tick ${this.tickRate.toFixed(1)} Hz  projectiles ${projectiles}\n` +
      `draw calls ${info.calls}  triangles ${info.triangles}\n` +
      this.mapInfo;
  }
}
