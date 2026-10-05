import {
  BackSide,
  Camera,
  Color,
  DirectionalLight,
  Fog,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { SKY } from './materials';

export type QualityName = 'low' | 'high';

export interface Quality {
  name: QualityName;
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low',
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
  },
  high: {
    name: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
  },
};

/** Pick the default quality: phones and small tablets start on `low`. */
export function defaultQuality(): QualityName {
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(screen.width, screen.height) < 700 ? 'low' : 'high';
}

/** Renderer shared by the game and every tool page. The stencil buffer is needed for the hole cut. */
export function createRenderer(
  container: HTMLElement,
  quality: Quality,
): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: quality.antialias,
    stencil: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, quality.maxPixelRatio),
  );
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.append(renderer.domElement);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dispatchEvent(new CustomEvent('resized'));
  };
  new ResizeObserver(resize).observe(container);
  resize();
  return renderer;
}

export function bindCameraAspect(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  onChange?: () => void,
): void {
  const update = () => {
    const c = renderer.domElement;
    camera.aspect = (c.width || 1) / (c.height || 1);
    camera.updateProjectionMatrix();
    onChange?.();
  };
  renderer.domElement.addEventListener('resized', update);
  update();
}

/** Sun, sky light, fog. The shadow box follows the focus point and grows with the camera distance. */
export class Environment {
  readonly sun = new DirectionalLight(0xfff1d6, 2.4);
  readonly hemi = new HemisphereLight(0xdff1ff, 0x7e9b6a, 1.5);
  /** Gradient sky (horizon colour = fog colour, up to `skyTop`); hidden for maps without a sky colour (indoors). */
  readonly dome: Mesh;
  private domeGeo = new SphereGeometry(1, 24, 12);
  private offset = new Vector3(0.45, 0.8, 0.35).normalize();

  constructor(
    scene: Scene,
    quality: Quality,
    readonly sky: Color = SKY,
  ) {
    scene.background = sky;
    scene.fog = new Fog(sky, 60, 400);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.domeGeo.setAttribute(
      'color',
      new Float32BufferAttribute(this.domeGeo.attributes.position.count * 3, 3),
    );
    this.dome = new Mesh(
      this.domeGeo,
      new MeshBasicMaterial({
        vertexColors: true,
        side: BackSide,
        fog: false,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    scene.add(this.sun, this.sun.target, this.hemi, this.dome);
  }

  /** Centre the sky dome on the camera and keep it inside the far plane. */
  updateDome(camera: Camera & { far: number }): void {
    if (!this.dome.visible) return;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);
  }

  /** Paint the dome: `sky` at and below the horizon, fading to `top` overhead. */
  private paintDome(sky: Color, top: Color): void {
    const pos = this.domeGeo.attributes.position;
    const col = this.domeGeo.attributes.color as Float32BufferAttribute;
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const k = Math.pow(Math.max(0, pos.getY(i)), 0.7);
      c.copy(sky).lerp(top, k);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  /** Move the shadow box to `focus`; `extent` is its half size in metres. */
  follow(focus: Vector3, extent: number): void {
    const s = this.sun.shadow.camera;
    const e = Math.max(12, extent);
    if (s.right !== e) {
      s.left = -e;
      s.right = e;
      s.top = e;
      s.bottom = -e;
      s.near = 1;
      s.far = e * 8 + 400;
      s.updateProjectionMatrix();
    }
    // snap to the shadow texel grid so shadows don't shimmer while moving
    const texel = (2 * e) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.offset, e * 4 + 150);
    this.sun.target.updateMatrixWorld();
  }

  /** Per-map colours: sky + fog, the hemisphere light and the sun tint. */
  setMood(m: {
    sky: number;
    /** Colour overhead: set it for an outdoor map to get the sky gradient. */
    skyTop?: number;
    hemiSky: number;
    hemiGround: number;
    sun: number;
  }): void {
    this.sky.setHex(m.sky);
    this.dome.visible = m.skyTop !== undefined;
    if (m.skyTop !== undefined) this.paintDome(this.sky, new Color(m.skyTop));
    this.hemi.color.setHex(m.hemiSky);
    this.hemi.groundColor.setHex(m.hemiGround);
    this.sun.color.setHex(m.sun);
  }

  setFog(near: number, far: number, scene: Scene): void {
    const fog = scene.fog as Fog;
    fog.near = near;
    fog.far = far;
  }
}
