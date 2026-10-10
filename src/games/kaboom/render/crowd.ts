import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { CRITTERS, type PlayerView } from '../sim/types';
import { treadHeight, treadMidD, TIERS, warpedRing } from './bowl';
import { CAM_PITCH_DEG } from './camera-rig';
import { Crew, TEAM_COLORS } from './characters';
import { FUR_SHELLS } from './fur';
import type { Quality } from './renderer';
import { Player } from '../sim/state';

/**
 * The spectators in the stands (DETAILS.md "Style"): the same eight animals as the crew, drawn as SPRITES. The camera never
 * turns, so each animal is rendered once, with the game's own crew renderer (fur, face, vest, no hard hat), from the game
 * camera's pitch into an atlas: 8 animals x 4 facings x 8 team colours. A spectator is then one instanced billboard that
 * picks its tile: a few hundred spectators cost one draw call and a handful of vertices each, and look as good as the crew.
 * Tiles are drawn on demand (`prepare`): only the colours of the players in the match, and a new colour later costs 32 tiles.
 * Shirts only come in colours that are on screen (`setPlayers`). The crowd is still until something blows up, then it jumps.
 */

/** World size of a sprite (square) at scale 1, and the height its look-at point sits above the animal's feet. */
const SPRITE = 1.5;
const SPRITE_MID = 0.45;
const FACINGS = 4;
const COLORS = TEAM_COLORS.length;
const SLOTS = CRITTERS.length * FACINGS * COLORS;
/** Tile size in pixels and atlas size, per quality. */
const TILE_PX = { high: 112, low: 72 } as const;
/** Crew facing angle (grid radians) of the four sprite facings: toward the camera, right, away, left. */
const FACING_ANGLE = [Math.PI / 2, 0, -Math.PI / 2, Math.PI] as const;
const FOV = 6;

const tileIndex = (species: number, facing: number, color: number): number =>
  (species * FACINGS + facing) * COLORS + color;

interface Spectator {
  species: number;
  facing: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
  /** Favourite colour: a fixed draw in 0..1 that picks one of the colours on screen. */
  fav: number;
}

const AXIS_X = new Vector3(1, 0, 0);

export class Crowd {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly tileAttr: InstancedBufferAttribute;
  private readonly spectators: Spectator[] = [];
  private readonly material: ShaderMaterial;
  private readonly tilePx: number;
  private readonly cols: number;
  private atlas: WebGLRenderTarget | null = null;
  private crews: { crew: Crew; player: Player }[] | null = null;
  private readonly rendered = new Set<number>();
  private readonly wanted: number[] = [];
  private excitement = 0;
  private colorMask = -1;
  private atRest = false;
  private readonly quat = new Quaternion().setFromAxisAngle(
    AXIS_X,
    -(CAM_PITCH_DEG * Math.PI) / 180,
  );
  private readonly m4 = new Matrix4();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();

  /** Spectators seat themselves round a floor of `w x h` cells grown by `pad`. */
  constructor(
    w: number,
    h: number,
    pad: number,
    private readonly quality: Quality,
  ) {
    const hx = w / 2 + pad;
    const hz = h / 2 + pad;
    const low = quality.name === 'low';
    const tiers = low ? TIERS - 1 : TIERS;
    const spacing = low ? 1.3 : 1.0;
    const fill = [0.94, 0.9, 0.82, 0.72];
    const rng = new Rng(hash3(w, h, 0xc0de, 5));
    this.tilePx = TILE_PX[quality.name];
    this.cols = Math.floor(this.sideFor(quality) / this.tilePx);

    for (let t = 0; t < tiers; t++) {
      const pts = warpedRing(hx, hz, treadMidD(t));
      const n = pts.length / 2;
      let carry = rng.range(0, spacing);
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const az = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const bz = pts[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        let s = carry;
        for (; s < len; s += spacing) {
          if (rng.next() > fill[t]) continue;
          const k = s / len;
          let x = ax + (bx - ax) * k;
          let z = az + (bz - az) * k;
          // look at the nearest point of the floor: the facing is the screen direction it is closest to
          const fx = Math.max(-hx, Math.min(hx, x));
          const fz = Math.max(-hz, Math.min(hz, z));
          let dx = fx - x;
          let dz = fz - z;
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl;
          dz /= dl;
          x -= dx * rng.range(-0.22, 0.22);
          z -= dz * rng.range(-0.22, 0.22);
          const facing =
            Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? 0 : 2) : dx > 0 ? 1 : 3;
          this.spectators.push({
            species: rng.int(0, CRITTERS.length - 1),
            facing,
            x,
            y: treadHeight(t, x, z) + 0.03,
            z,
            scale: rng.range(0.97, 1.03),
            phase: rng.range(0, 6.28),
            fav: rng.next(),
          });
        }
        carry = s - len;
      }
    }

    const n = Math.max(1, this.spectators.length);
    const geo = new PlaneGeometry(1, 1);
    this.tileAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aTile', this.tileAttr);
    this.material = this.makeMaterial();
    this.mesh = new InstancedMesh(geo, this.material, n);
    this.mesh.count = this.spectators.length;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false; // until the atlas is drawn (`prepare`)
    this.group.add(this.mesh);
    this.place(0, 0);
  }

  /** Atlas side in pixels: the most tiles (`SLOTS`) must fit in a square, power of two not required. */
  private sideFor(q: Quality): number {
    const per = Math.ceil(Math.sqrt(SLOTS));
    return per * TILE_PX[q.name];
  }

  private makeMaterial(): ShaderMaterial {
    const side = this.cols * this.tilePx;
    return new ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uCols: { value: this.cols },
        uCell: { value: this.tilePx / side },
        uPad: { value: 1.5 / this.tilePx },
      },
      vertexShader: /* glsl */ `
        attribute float aTile;
        uniform float uCols;
        uniform float uCell;
        uniform float uPad;
        varying vec2 vUv;
        void main() {
          float col = mod( aTile, uCols );
          float row = floor( aTile / uCols );
          vUv = ( vec2( col, row ) + mix( vec2( uPad ), vec2( 1.0 - uPad ), uv ) ) * uCell;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D( uMap, vUv );
          if ( t.a < 0.45 ) discard;
          gl_FragColor = vec4( t.rgb, 1.0 );
          #include <colorspace_fragment>
        }`,
    });
  }

  get count(): number {
    return this.spectators.length;
  }

  /** Draw calls for the whole crowd. */
  get drawCalls(): number {
    return 1;
  }

  /**
   * Shirts take the colours of the players in the match (benched bots do not count), so a colour only shows in the stands
   * when it is on screen. Cheap to call every frame: it only works when the set of colours changes. Colours whose
   * tiles are not drawn yet queue up for `prepare`.
   */
  setPlayers(players: readonly PlayerView[]): void {
    let mask = 0;
    for (const p of players)
      if (p.state !== 'out') mask |= 1 << (p.color % COLORS);
    if (mask === this.colorMask) return;
    this.colorMask = mask;
    const palette: number[] = [];
    for (let i = 0; i < COLORS; i++) if (mask & (1 << i)) palette.push(i);
    if (palette.length === 0) for (let i = 0; i < COLORS; i++) palette.push(i);
    this.spectators.forEach((sp, k) => {
      const color =
        palette[
          Math.min(palette.length - 1, Math.floor(sp.fav * palette.length))
        ];
      this.tileAttr.setX(k, tileIndex(sp.species, sp.facing, color));
    });
    this.tileAttr.needsUpdate = true;
    for (const c of palette)
      if (!this.rendered.has(c) && !this.wanted.includes(c))
        this.wanted.push(c);
  }

  /** The colours the shirts can take right now (bit per team colour; for tests). */
  get shirtMask(): number {
    return this.colorMask;
  }

  /** Team colour index of spectator `k`'s sprite (for tests). */
  colorOf(k: number): number {
    return this.tileAttr.getX(k) % COLORS;
  }

  /**
   * Draw the tiles that are wanted but missing (one colour = 32 tiles per call after the first, which draws every colour
   * of the match so there is no pop-in); needs a WebGL renderer, so the tool pages and tests never call it. Call it before
   * the frame is drawn; it restores the renderer's state.
   */
  prepare(renderer: WebGLRenderer, all = false): void {
    if (this.wanted.length === 0) return;
    const atlas = (this.atlas ??= this.makeAtlas());
    const crews = (this.crews ??= this.makeCrews());
    const prevTarget = renderer.getRenderTarget();
    const prevClear = new Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const sun = new DirectionalLight(0xfff0d8, 2.5);
    sun.position.set(-0.5, 1, 0.7).normalize().multiplyScalar(40);
    scene.add(
      sun,
      new HemisphereLight(0xcfe6ff, 0x9a7a55, 1.25),
      new AmbientLight(0xffffff, 0),
    );
    const camera = new PerspectiveCamera(FOV, 1, 1, 60);
    const dist = SPRITE / 2 / Math.tan((FOV * Math.PI) / 360);
    const pitch = (CAM_PITCH_DEG * Math.PI) / 180;
    camera.position.set(
      0,
      SPRITE_MID + Math.sin(pitch) * dist,
      Math.cos(pitch) * dist,
    );
    camera.lookAt(0, SPRITE_MID, 0);
    camera.updateMatrixWorld();

    const colors = all ? this.wanted.splice(0) : this.firstBatch();
    const px = this.tilePx;
    for (const color of colors) {
      this.rendered.add(color);
      crews.forEach(({ crew, player }, species) => {
        player.color = color;
        scene.add(crew.group);
        for (let f = 0; f < FACINGS; f++) {
          player.facing = FACING_ANGLE[f];
          crew.update(1, 1); // dt 1 snaps the turn
          const tile = tileIndex(species, f, color);
          const col = tile % this.cols;
          const row = Math.floor(tile / this.cols);
          atlas.viewport.set(col * px, row * px, px, px);
          atlas.scissor.set(col * px, row * px, px, px);
          atlas.scissorTest = true;
          renderer.setRenderTarget(atlas);
          renderer.clear();
          renderer.render(scene, camera);
        }
        scene.remove(crew.group);
      });
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    this.material.uniforms.uMap.value = atlas.texture;
    this.mesh.visible = true;
  }

  /** The first call draws every colour wanted; later ones one colour at a time. */
  private firstBatch(): number[] {
    return this.rendered.size === 0
      ? this.wanted.splice(0)
      : this.wanted.splice(0, 1);
  }

  private makeAtlas(): WebGLRenderTarget {
    const side = this.cols * this.tilePx;
    const rt = new WebGLRenderTarget(side, side, {
      depthBuffer: true,
      generateMipmaps: true,
    });
    rt.texture.colorSpace = SRGBColorSpace;
    rt.texture.minFilter = LinearMipmapLinearFilter;
    rt.texture.magFilter = LinearFilter;
    return rt;
  }

  private makeCrews(): { crew: Crew; player: Player }[] {
    return CRITTERS.map((id) => {
      const player = new Player(0, id, false, 0);
      player.x = player.px = player.y = player.py = 0;
      const crew = new Crew([player], 0, 0, {
        shells: FUR_SHELLS[this.quality.name],
        smooth: false,
      });
      crew.setHatsVisible(false);
      return { crew, player };
    });
  }

  /** After a lost WebGL context the atlas is empty: draw every tile again at the next `prepare`. */
  invalidate(): void {
    this.rendered.clear();
    this.wanted.length = 0;
    const mask = this.colorMask;
    this.colorMask = -1;
    this.atlas?.dispose();
    this.atlas = null;
    for (let i = 0; i < COLORS; i++)
      if (mask & (1 << i) || mask < 0) this.wanted.push(i);
    this.mesh.visible = false;
  }

  /** Something blew up: the crowd jumps (`amount` 0..1, adds up to 1). */
  excite(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  update(t: number, dt: number): void {
    if (this.excitement <= 0.01) {
      this.excitement = 0;
      if (!this.atRest) this.place(t, 0);
      return;
    }
    this.excitement *= Math.exp(-dt * 1.6);
    this.place(t, this.excitement);
  }

  /** Matrices for every sprite: a fixed billboard facing the camera, hopping when excited. */
  private place(t: number, excite: number): void {
    this.atRest = excite === 0;
    const { m4, quat, pos, scl } = this;
    this.spectators.forEach((sp, k) => {
      const hop = excite * 0.28 * Math.abs(Math.sin(t * 9 + sp.phase));
      const s = SPRITE * sp.scale;
      scl.set(s, s, 1);
      // the sprite's centre is its look-at point: a little above the feet, along the world up
      pos.set(sp.x, sp.y + SPRITE_MID * sp.scale + hop, sp.z);
      m4.compose(pos, quat, scl);
      this.mesh.setMatrixAt(k, m4);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.atlas?.dispose();
    this.crews?.forEach(({ crew }) => crew.dispose());
  }
}
