import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { TimeUniform } from './particles';

/** The comic words of the atlas, one cell each, in order. The first is the game's name for the big blasts. */
export const WORDS = ['KABOOOM!', 'BOOM!', 'KA-POW!'] as const;
const CELL_W = 512;
const CELL_H = 192;

/** Depth of the extruded letters in atlas pixels (down and a little right), and the lettering's font stack. */
const DEPTH = 15;
const FONT = '"Grandstander", "Arial Black", Impact, sans-serif';

/**
 * Chunky 3D comic lettering, three words side by side (browser only: uses a canvas): a dark outline round the whole
 * block, an extruded side stepping down and right in deep orange to brown, and a bevelled face (yellow to orange, a light
 * edge top-left, a shaded edge bottom-right), like letters cut from a slab. Drawn with the UI's Grandstander once it has
 * loaded (the texture is redrawn then), a system face before.
 */
export function makeWordAtlas(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL_W * WORDS.length;
  c.height = CELL_H;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  drawWords(c);
  document.fonts
    ?.load(`800 120px ${FONT}`)
    .then(() => {
      drawWords(c);
      t.needsUpdate = true;
    })
    .catch(() => {});
  return t;
}

function drawWords(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  // the face is drawn on its own layer so its bevel stays inside the letters
  const face = document.createElement('canvas');
  face.width = CELL_W;
  face.height = CELL_H;
  const f = face.getContext('2d')!;
  for (const ctx of [g, f]) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
  }
  WORDS.forEach((word, i) => {
    // fit the lettering to its cell (outline and depth need about 30 px)
    let size = 132;
    g.font = `800 ${size}px ${FONT}`;
    const width = g.measureText(word).width;
    size = Math.min(
      132,
      Math.floor((size * (CELL_W - 64)) / Math.max(1, width)),
    );
    const font = `800 ${size}px ${FONT}`;
    g.font = f.font = font;
    const x = i * CELL_W + CELL_W / 2 - 6;
    const y = CELL_H / 2 - DEPTH / 2 + 4;
    // outline round the face and the whole extrusion
    g.lineWidth = 18;
    g.strokeStyle = '#2e1206';
    for (let d = 0; d <= DEPTH; d += 3) g.strokeText(word, x + d * 0.35, y + d);
    // the extruded side: back to front, a deep orange that darkens a little towards the back
    for (let d = DEPTH; d >= 1; d--) {
      const k = d / DEPTH;
      g.fillStyle = `rgb(${Math.round(232 - 60 * k)}, ${Math.round(112 - 46 * k)}, ${Math.round(28 - 12 * k)})`;
      g.fillText(word, x + d * 0.35, y + d);
    }
    // the face: a bright gradient, then a light bevel edge up-left kept inside the letters (the side does the shading)
    f.clearRect(0, 0, CELL_W, CELL_H);
    const fx = CELL_W / 2 - 6;
    const grad = f.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grad.addColorStop(0, '#fffad0');
    grad.addColorStop(0.4, '#ffd640');
    grad.addColorStop(1, '#ffa126');
    f.fillStyle = grad;
    f.fillText(word, fx, y);
    f.globalCompositeOperation = 'source-atop';
    f.lineWidth = 5;
    f.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    f.strokeText(word, fx - 2, y - 2);
    f.globalCompositeOperation = 'source-over';
    g.drawImage(face, i * CELL_W, 0);
  });
}

const VERT = /* glsl */ `
  uniform float uTime;
  attribute vec4 aSpawn; // xyz = position, w = spawn time
  attribute vec4 aMisc;  // x = word index, y = life, z = size (m wide), w = seed
  varying vec2 vUv;

  void main() {
    float age = uTime - aSpawn.w;
    float life = aMisc.y;
    if (age < 0.0 || age > life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float k = age / life;
    // pop with a bounce, hold, shrink away
    float t = clamp(age / 0.2, 0.0, 1.0);
    float c1 = 1.70158;
    float pop = 1.0 + (c1 + 1.0) * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0);
    float s = pop * (1.0 - smoothstep(0.75, 1.0, k)) * aMisc.z;
    float rot = (fract(aMisc.w * 7.0) - 0.5) * 0.4 + sin(age * 22.0) * 0.035 * (1.0 - k);
    vec2 q = position.xy * s;
    q = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
    vec3 centre = aSpawn.xyz + vec3(0.0, 0.9 * age + 0.2 * t, 0.0);
    // billboard in view space
    vec4 mv = viewMatrix * modelMatrix * vec4(centre, 1.0);
    mv.xy += q;
    vUv = vec2((uv.x + aMisc.x) / ${WORDS.length}.0, uv.y);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb, 1.0);
  }
`;

/**
 * Pooled "KABOOOM!" words that pop over a blast: a handful of billboards in ONE InstancedMesh, animated in the vertex
 * shader. `maybeSpawn` throttles them, so a chain of forty blasts shows a few words, not forty.
 */
export class WordBurst {
  readonly mesh: InstancedMesh;
  private readonly spawn: InstancedBufferAttribute;
  private readonly misc: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private head = 0;
  private dirty = false;
  private last = -99;

  constructor(
    readonly capacity: number,
    time: TimeUniform,
    atlas: Texture,
    /** Minimum seconds between two words. */
    readonly gap = 0.25,
  ) {
    const geo = new PlaneGeometry(1, CELL_H / CELL_W);
    this.spawn = new InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    );
    this.misc = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (let i = 0; i < capacity; i++) this.spawn.setW(i, 1e9);
    geo.setAttribute('aSpawn', this.spawn);
    geo.setAttribute('aMisc', this.misc);
    this.material = new ShaderMaterial({
      uniforms: { uTime: time, uMap: { value: atlas } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    const id = new Matrix4();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, id);
  }

  /** Pop a word at world `(x, y, z)` unless one popped less than `gap` seconds ago. Returns whether it did. */
  maybeSpawn(
    t: number,
    x: number,
    y: number,
    z: number,
    word: number,
    seed: number,
  ): boolean {
    if (t - this.last < this.gap) return false;
    this.last = t;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.spawn.setXYZW(i, x, y, z, t);
    this.misc.setXYZW(
      i,
      word % WORDS.length,
      1.1,
      word === 0 ? 3.2 : 2.4,
      seed,
    );
    this.dirty = true;
    return true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.spawn.needsUpdate = true;
    this.misc.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.spawn.setW(i, 1e9);
    this.spawn.needsUpdate = true;
    this.last = -99;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
