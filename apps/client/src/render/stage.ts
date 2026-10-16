import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Matrix4, Texture } from 'three';
import { CAMERA, FX } from '@tidebreaker/shared';

/** The unit vector from the sea toward the sun (the water shader and the particles use it too). */
export const SUN_DIR = new Vector3(...FX.light.sunDir).normalize();

/**
 * Renderer, scene, camera and lights (GAME_DESIGN.md §12.1). One sun with a shadow map that follows
 * the player (ships, islands and rigs cast and receive; the water receives too), and a hemisphere
 * light for the sky and sea bounce.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly sun: DirectionalLight;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = window.devicePixelRatio;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: dpr < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.scene.background = new Color(0x0b6989);

    this.camera = new PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far);

    const L = FX.light;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.sun = new DirectionalLight(L.sunColor, L.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    this.sun.shadow.bias = L.bias;
    this.sun.shadow.normalBias = L.normalBias;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1400;
    this.scene.add(this.sun, this.sun.target, new HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity));

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** The sun's shadow map (null until the first frame is rendered) and the matrix that looks it up. */
  get sunShadowMap(): Texture | null {
    return this.sun.shadow.map?.depthTexture ?? null;
  }

  get sunShadowMatrix(): Matrix4 {
    return this.sun.shadow.matrix;
  }

  /**
   * Moves the sun's shadow box to where the camera is looking. The box is snapped to whole shadow
   * texels along the light's own axes, so shadows do not shimmer while the camera moves.
   */
  followSun(focusX: number, focusZ: number): void {
    const L = FX.light;
    const range = Math.min(L.maxRange, Math.max(L.minRange, this.camera.position.y * L.rangePerHeight));
    const cam = this.sun.shadow.camera;
    // Rebuilding the projection only when the range actually changed (in steps of 10 units).
    const stepped = Math.ceil(range / 10) * 10;
    if (cam.right !== stepped) {
      cam.left = -stepped;
      cam.right = stepped;
      cam.top = stepped;
      cam.bottom = -stepped;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * stepped) / L.shadowMapSize;
    const s = SUN_DIR;
    // Light-space axes: right = up x sun, up = sun x right.
    let rx = s.z;
    let rz = -s.x;
    const rl = Math.hypot(rx, rz);
    rx /= rl;
    rz /= rl;
    const ux = s.y * rz;
    const uy = s.z * rx - s.x * rz;
    const uz = -s.y * rx;
    const a = focusX * rx + focusZ * rz;
    const snapA = Math.round(a / texel) * texel - a;
    // The focus has no height, so its up-axis part is only the horizontal one.
    const b = focusX * ux + focusZ * uz;
    const snapB = Math.round(b / texel) * texel - b;
    const fx = focusX + snapA * rx + snapB * ux;
    const fy = snapB * uy;
    const fz = focusZ + snapA * rz + snapB * uz;
    const dist = 700;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + s.x * dist, fy + s.y * dist, fz + s.z * dist);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
