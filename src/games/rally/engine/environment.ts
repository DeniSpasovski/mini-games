import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Object3D,
  PMREMGenerator,
  Scene,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { EnvironmentDef } from '../maps/shared/types';
import { displayExposure, onDisplayChange } from './display';
import type { QualitySettings } from './quality';

/**
 * Sky dome, sun (with a shadow box that follows the focus point), hemisphere
 * fill, exponential fog and an image-based-lighting env map baked from the sky.
 * The same Environment is used by the game and all debug pages.
 */
export class Environment {
  readonly sky = new Sky();
  readonly sun = new DirectionalLight(0xfff1dc, 3);
  readonly hemi = new HemisphereLight(0xbcd2ee, 0x4a4630, 0.18);
  readonly sunDir = new Vector3();
  private target = new Object3D();
  private pmrem: PMREMGenerator;
  private envMap?: Texture;
  private shadowExtent: number;
  private offDisplay: () => void;

  constructor(
    private scene: Scene,
    private renderer: WebGLRenderer,
    public def: EnvironmentDef,
    quality: QualitySettings,
  ) {
    // Box half-size 1500 m: keep camera.far >= ~2700 (corner distance). Drawn first, never writes depth.
    this.sky.scale.setScalar(3000);
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    scene.add(this.hemi);

    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadowExtent = quality.shadowExtent;
    const cam = s.shadow.camera;
    cam.left = cam.bottom = -this.shadowExtent;
    cam.right = cam.top = this.shadowExtent;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
    s.target = this.target;
    scene.add(s, this.target);

    this.pmrem = new PMREMGenerator(renderer);
    this.offDisplay = onDisplayChange(() => this.refreshExposure());
    this.apply(def);
  }

  /** Re-apply settings (sun angle, fog, exposure) and rebuild the env map. */
  apply(def: EnvironmentDef): void {
    this.def = def;
    const u = this.sky.material.uniforms;
    u.turbidity.value = def.turbidity;
    u.rayleigh.value = def.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const phi = MathUtils.degToRad(90 - def.sunElevation);
    const theta = MathUtils.degToRad(def.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);

    // Warmer, dimmer sun near the horizon.
    const low = MathUtils.clamp(1 - def.sunElevation / 40, 0, 1);
    this.sun.color.setRGB(1, 0.93 - low * 0.18, 0.84 - low * 0.32);
    this.sun.intensity = 3.1 - low * 1.2;

    this.scene.fog = new FogExp2(new Color(def.fogColor), def.fogDensity);
    this.refreshExposure();
    this.rebuildEnvMap();
  }

  /** Map exposure, scaled for the display (engine/display.ts: HDR monitors get less). */
  refreshExposure(): void {
    this.renderer.toneMappingExposure = this.def.exposure * displayExposure();
  }

  private rebuildEnvMap(): void {
    const envScene = new Scene();
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const src = this.sky.material.uniforms;
    const dst = sky.material.uniforms;
    for (const k of [
      'turbidity',
      'rayleigh',
      'mieCoefficient',
      'mieDirectionalG',
    ] as const)
      dst[k].value = src[k].value;
    dst.sunPosition.value.copy(src.sunPosition.value);
    envScene.add(sky);
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
    this.scene.environment = this.envMap;
    // Key/fill balance: keep IBL + hemi low enough that sun shadows read clearly.
    this.scene.environmentIntensity = 0.28;
    sky.material.dispose();
    sky.geometry.dispose();
  }

  /** Keep the sun shadow box centred on `focus`, snapped to shadow texels to avoid shimmering. */
  update(focus: Vector3): void {
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.target.position.set(fx, focus.y, fz);
    this.sun.position
      .copy(this.target.position)
      .addScaledVector(this.sunDir, 300);
    this.sun.updateMatrixWorld();
    this.target.updateMatrixWorld();
  }

  /** Move the sky dome with the camera so it never clips. */
  follow(cameraPos: Vector3): void {
    this.sky.position.copy(cameraPos);
  }

  dispose(): void {
    this.offDisplay();
    this.envMap?.dispose();
    this.pmrem.dispose();
  }
}
