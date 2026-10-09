import { Vector2 } from 'three';
import type { Object3D, WebGLRenderer } from 'three';
import type { Stage } from '../render/stage.ts';
import type { WakeMap } from '../render/wakeMap.ts';

/**
 * Debug-only GPU/CPU probe (loaded lazily with `?debug=1`, never part of the normal bundle).
 * Browsers hide real GPU timers, so this renders the same frame many times and forces the GPU to
 * finish (a 1-pixel read-back) to time it. The numbers are for comparing parts of the scene and
 * resolutions on THIS machine; see docs/perf.md for how they are turned into estimates for
 * weaker hardware.
 */
export interface ProbeContext {
  stage: Stage;
  wakeMap: WakeMap;
  /** Named groups of scene objects that can be hidden to measure what they cost. */
  groups: Record<string, readonly Object3D[]>;
  /** Advances the game by `frames` rendered frames (synthetic time). */
  advance(frames: number, frameMs?: number): void;
}

const px = new Uint8Array(4);

function sync(renderer: WebGLRenderer): void {
  renderer
    .getContext()
    .readPixels(0, 0, 1, 1, WebGL2RenderingContext.RGBA, WebGL2RenderingContext.UNSIGNED_BYTE, px);
}

function timeMs(renderer: WebGLRenderer, frames: number, work: () => void): number {
  work();
  sync(renderer);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) work();
  sync(renderer);
  return (performance.now() - t0) / frames;
}

export interface ProbeResult {
  resolution: string;
  pixels: number;
  triangles: number;
  drawCalls: number;
  /** Average CPU time of one full game frame (sim + effects + submitting draw calls), ms. */
  cpuFrameMs: number;
  /** GPU+driver time of rendering the scene once, ms. */
  sceneMs: number;
  /** The foam-map pass (fade + stamps) per frame, ms. */
  wakeMs: number;
  /** Scene time with one group hidden, to show what it costs. */
  without: Record<string, number>;
  /** Scene time when only that group is visible. */
  only: Record<string, number>;
}

/** Measures the current scene at the given canvas size (physical pixels). */
export async function runProbe(
  ctx: ProbeContext,
  width: number,
  height: number,
): Promise<ProbeResult> {
  const { stage, wakeMap, groups } = ctx;
  const r = stage.renderer;
  const prevRatio = r.getPixelRatio();
  const prevSize = r.getSize(new Vector2());
  const prevW = prevSize.x;
  const prevH = prevSize.y;
  r.setPixelRatio(1);
  r.setSize(width, height, false);
  stage.camera.aspect = width / height;
  stage.camera.updateProjectionMatrix();

  // Warm up so shaders are compiled and the wake map has content.
  ctx.advance(30);

  // CPU: a full game frame, measured without waiting for the GPU.
  const cpuStart = performance.now();
  const n = 60;
  for (let i = 0; i < n; i++) ctx.advance(1);
  const cpuFrameMs = (performance.now() - cpuStart) / n;
  sync(r);

  const frames = 40;
  const sceneMs = timeMs(r, frames, () => stage.render());
  r.info.autoReset = false;
  r.info.reset();
  stage.render();
  const triangles = r.info.render.triangles;
  const drawCalls = r.info.render.calls;
  r.info.autoReset = true;
  const wakeMs = timeMs(r, frames, () => {
    wakeMap.begin(1200, 1200, 0.016);
    wakeMap.render(r);
  });

  const all: Object3D[] = [];
  for (const g of Object.values(groups)) all.push(...g);
  const setVisible = (list: readonly Object3D[], v: boolean): void => {
    for (const o of list) o.visible = v;
  };
  const without: Record<string, number> = {};
  const only: Record<string, number> = {};
  for (const [name, list] of Object.entries(groups)) {
    const was = list.map((o) => o.visible);
    setVisible(list, false);
    without[name] = timeMs(r, frames, () => stage.render());
    list.forEach((o, i) => (o.visible = was[i]!));
  }
  const wasAll = all.map((o) => o.visible);
  for (const [name, list] of Object.entries(groups)) {
    setVisible(all, false);
    setVisible(list, true);
    only[name] = timeMs(r, frames, () => stage.render());
  }
  all.forEach((o, i) => (o.visible = wasAll[i]!));

  r.setPixelRatio(prevRatio);
  r.setSize(prevW, prevH, false);
  stage.camera.aspect = prevW / prevH;
  stage.camera.updateProjectionMatrix();

  const round = (v: number): number => Math.round(v * 100) / 100;
  const roundAll = (o: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
  return {
    resolution: `${width}x${height}`,
    pixels: width * height,
    triangles,
    drawCalls,
    cpuFrameMs: round(cpuFrameMs),
    sceneMs: round(sceneMs),
    wakeMs: round(wakeMs),
    without: roundAll(without),
    only: roundAll(only),
  };
}
