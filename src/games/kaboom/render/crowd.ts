import {
  AmbientLight,
  Color,
  type Camera,
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
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { CRITTERS, type PlayerView } from '../sim/types';
import { treadHeight, treadMidD, TIERS, warpedRing } from './bowl';
import type { CrowdLayout } from './themes/theme';
import { boardMask } from './card-stunt';

/** The rocky bowl's seating (Quarry, Green Valley): warped rings, swelling terraces. */
const BOWL_LAYOUT: CrowdLayout = { ring: warpedRing, height: treadHeight };
import { CAM_PITCH_DEG } from './camera-rig';
import { Crew, TEAM_COLORS } from './characters';
import type { Quality } from './renderer';
import { Player } from '../sim/state';

/**
 * The spectators in the stands (DETAILS.md "Style"): the same eight animals as the crew, drawn as SPRITES. The camera never
 * turns, so each animal is rendered once, with the game's own crew renderer (paint, face, vest, no hard hat), from the game
 * camera's pitch into an atlas: 8 animals x 4 facings x 8 team colours. A spectator is then one instanced billboard that
 * picks its tile: a few hundred spectators cost one draw call and a handful of vertices each, and look as good as the crew.
 * Tiles are drawn on demand (`prepare`): only the colours of the players in the match, and a new colour later costs 32 tiles.
 * Shirts only come in colours that are on screen (`setPlayers`). The crowd is still until something blows up, then it jumps.
 */

/**
 * The crowd steps back so the arena leads (DETAILS.md "Style"): every spectator and flag is a touch darker and less
 * saturated than the crew, and the rows further from the arena fade a little towards the sky (`uHalf` = the floor's half
 * extents incl. its margin).
 */
const RECEDE_VERT = /* glsl */ `
  uniform vec2 uHalf;
  varying float vFar;
  void recede() {
    vec4 w = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
    vFar = smoothstep( 0.5, 6.0, length( max( abs( w.xz ) - uHalf, 0.0 ) ) );
  }`;
const RECEDE_FRAG = /* glsl */ `
  varying float vFar;
  vec3 recede( vec3 c ) {
    c = mix( c, vec3( dot( c, vec3( 0.3, 0.59, 0.11 ) ) ), 0.12 + 0.1 * vFar );
    c *= mix( 0.9, 0.8, vFar );
    return mix( c, vec3( 0.6, 0.7, 0.78 ), 0.14 * vFar );
  }`;

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
/** Fans sit in groups of this many neighbours (3..GROUP_MAX) in one colour, like a fan block. */
const GROUP_MIN = 3;
const GROUP_MAX = 8;
/** Share of the groups that bring flags, and of the fans in such a group who hold one. */
const FLAG_GROUPS = 0.45;
const FLAG_FANS = 0.45;
/** Flag layer: the quad's size in world units and where the shoulder sits in the sprite (above the feet). */
/** The stadium wave: a hop runs once round each terrace ring every `WAVE_EVERY` s, taking `WAVE_RUN` s. */
const WAVE_EVERY = 34;
const WAVE_RUN = 11;
const WAVE_WIDTH = 0.1;
const FLAG_W = 1.8;
const FLAG_H = 2.4;
const FLAG_MID = 0.7;
const SHOULDER_Y = 0.6;
/** The flag layer is drawn this far towards the camera so it never sinks into its fan's sprite. */
const FLAG_LIFT = 0.25;

/** The card display: a lattice of cards over the far stand in screen space; card size relative to its cell, the seconds a card takes to rise and the ripple across the stand. */
const CARD_FILL = 0.88;
const CARD_RISE_S = 0.35;
const CARD_RIPPLE_S = 0.6;
/** Most cards a board has (9 rows by up to 60 columns). */
const CARD_MAX = 9 * 60;

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
  /** Favourite colour: a fixed draw in 0..1 that picks one of the colours on screen (shared by the whole group). */
  fav: number;
  /** Seat group (up to `GROUP_MAX` neighbours on one terrace cheering for the same colour). */
  group: number;
  /** Slot in the flag layer when this fan waves a flag, else -1; -1 / +1 = which hand. */
  flag: number;
  side: number;
  /** Place along its terrace ring, 0..1 (the stadium wave runs round it). */
  u: number;
  /** The block's own rhythm: when it cheers and how it jumps (shared by the group). */
  cheer: number;
}

const AXIS_X = new Vector3(1, 0, 0);
const tint = new Color();
/** Towards the camera, in world space. */
const LIFT = new Vector3(
  0,
  Math.sin((CAM_PITCH_DEG * Math.PI) / 180),
  Math.cos((CAM_PITCH_DEG * Math.PI) / 180),
).multiplyScalar(FLAG_LIFT);

export class Crowd {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly tileAttr: InstancedBufferAttribute;
  private readonly spectators: Spectator[] = [];
  private readonly material: ShaderMaterial;
  private readonly flags: InstancedMesh;
  private readonly flagColor: InstancedBufferAttribute;
  private readonly flagMaterial: ShaderMaterial;
  private readonly holders: number[] = [];
  /** The far stand's fans (facing the camera): each holds one card in a stunt. */
  private readonly cardFans: number[] = [];
  private readonly cards: InstancedMesh;
  private readonly cardMaterial: ShaderMaterial;
  private readonly cardCell: InstancedBufferAttribute;
  private readonly cardColor: InstancedBufferAttribute;
  private readonly cardLit: InstancedBufferAttribute;
  private stunt: {
    text: string | null;
    color: number;
    color2: number | null;
    camera: Camera;
    still: boolean;
    until: number;
  } | null = null;
  private clock = 0;
  private readonly tilePx: number;
  private readonly cols: number;
  private atlas: WebGLRenderTarget | null = null;
  private crews: { crew: Crew; player: Player }[] | null = null;
  private readonly rendered = new Set<number>();
  private readonly wanted: number[] = [];
  private excitement = 0;
  private colorMask = -1;
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
    quality: Quality,
    layout: CrowdLayout = BOWL_LAYOUT,
  ) {
    const hx = w / 2 + pad;
    const hz = h / 2 + pad;
    const low = quality.name === 'low';
    const tiers = (layout.tiers ?? TIERS) - (low ? 1 : 0);
    const spacing = low ? 1.3 : 1.0;
    const fill = [0.94, 0.9, 0.82, 0.72];
    const rng = new Rng(hash3(w, h, 0xc0de, 5));
    let groups = 0;
    this.tilePx = TILE_PX[quality.name];
    this.cols = Math.floor(this.sideFor(quality) / this.tilePx);

    for (let t = 0; t < tiers; t++) {
      const pts = layout.ring(hx, hz, layout.rowD?.(t) ?? treadMidD(t));
      const n = pts.length / 2;
      let carry = rng.range(0, spacing);
      let acc = 0;
      const first = this.spectators.length;
      let left = 0;
      let fav = 0;
      let flagGroup = false;
      let group = groups;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const az = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const bz = pts[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        let s = carry;
        for (; s < len; s += spacing) {
          if (rng.next() > fill[t] * (layout.fill ?? 1)) continue;
          if (layout.seat && !layout.seat(i + s / len, n, hx, hz)) continue;
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
          if (left === 0) {
            left = rng.int(GROUP_MIN, GROUP_MAX);
            fav = rng.next();
            flagGroup = rng.next() < FLAG_GROUPS * (low ? 0.6 : 1);
            group = ++groups;
          }
          left--;
          const flag = flagGroup && rng.next() < FLAG_FANS;
          this.spectators.push({
            species: rng.int(0, CRITTERS.length - 1),
            facing,
            x,
            y: layout.height(t, x, z) + 0.03,
            z,
            scale: rng.range(0.97, 1.03),
            phase: rng.range(0, 6.28),
            fav,
            group,
            flag: flag ? this.holders.push(this.spectators.length) - 1 : -1,
            side: rng.next() < 0.5 ? -1 : 1,
            u: acc + s,
            cheer: (hash3(group, w, h, 0xcee5) % 1000) / 1000,
          });
        }
        carry = s - len;
        acc += len;
      }
      for (let k = first; k < this.spectators.length; k++)
        this.spectators[k].u /= acc;
    }

    const n = Math.max(1, this.spectators.length);
    const geo = new PlaneGeometry(1, 1);
    this.tileAttr = new InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aTile', this.tileAttr);
    this.material = this.makeMaterial(hx, hz);
    this.mesh = new InstancedMesh(geo, this.material, n);
    this.mesh.count = this.spectators.length;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false; // until the atlas is drawn (`prepare`)
    this.group.add(this.mesh);

    const f = Math.max(1, this.holders.length);
    const flagGeo = new PlaneGeometry(1, 1);
    this.flagColor = new InstancedBufferAttribute(new Float32Array(f * 3), 3);
    flagGeo.setAttribute('aColor', this.flagColor);
    const side = new Float32Array(f);
    const phase = new Float32Array(f);
    this.holders.forEach((k, j) => {
      side[j] = this.spectators[k].side;
      phase[j] = this.spectators[k].phase;
    });
    flagGeo.setAttribute('aSide', new InstancedBufferAttribute(side, 1));
    flagGeo.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    this.flagMaterial = this.makeFlagMaterial(hx, hz);
    this.flags = new InstancedMesh(flagGeo, this.flagMaterial, f);
    this.flags.count = this.holders.length;
    this.flags.frustumCulled = false;
    this.flags.visible = false;
    this.group.add(this.flags);

    this.spectators.forEach((sp, k) => {
      if (sp.facing === 0) this.cardFans.push(k);
    });
    const cardGeo = new PlaneGeometry(1, 1);
    this.cardCell = new InstancedBufferAttribute(
      new Float32Array(CARD_MAX * 2),
      2,
    );
    this.cardColor = new InstancedBufferAttribute(
      new Float32Array(CARD_MAX * 3),
      3,
    );
    this.cardLit = new InstancedBufferAttribute(
      new Float32Array(CARD_MAX * 2),
      2,
    );
    cardGeo.setAttribute('aCell', this.cardCell);
    cardGeo.setAttribute('aColor', this.cardColor);
    cardGeo.setAttribute('aLit', this.cardLit);
    this.cardMaterial = this.makeCardMaterial();
    this.cards = new InstancedMesh(cardGeo, this.cardMaterial, CARD_MAX);
    this.cards.count = 0;
    this.cards.frustumCulled = false;
    this.cards.renderOrder = 10;
    this.cards.visible = false; // until a stunt
    this.group.add(this.cards);
    this.place(0, 0);
  }

  /** Atlas side in pixels: the most tiles (`SLOTS`) must fit in a square, power of two not required. */
  private sideFor(q: Quality): number {
    const per = Math.ceil(Math.sqrt(SLOTS));
    return per * TILE_PX[q.name];
  }

  private makeMaterial(hx: number, hz: number): ShaderMaterial {
    const side = this.cols * this.tilePx;
    return new ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uCols: { value: this.cols },
        uCell: { value: this.tilePx / side },
        uPad: { value: 1.5 / this.tilePx },
        uHalf: { value: new Vector2(hx, hz) },
      },
      vertexShader: /* glsl */ `
        attribute float aTile;
        uniform float uCols;
        uniform float uCell;
        uniform float uPad;
        varying vec2 vUv;
        ${RECEDE_VERT}
        void main() {
          float col = mod( aTile, uCols );
          float row = floor( aTile / uCols );
          vUv = ( vec2( col, row ) + mix( vec2( uPad ), vec2( 1.0 - uPad ), uv ) ) * uCell;
          recede();
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        ${RECEDE_FRAG}
        void main() {
          vec4 t = texture2D( uMap, vUv );
          if ( t.a < 0.45 ) discard;
          gl_FragColor = vec4( recede( t.rgb ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  /** The waving flags: arm (shirt sleeve, then paw), pole and flag drawn in one billboard, moving with the shader's clock. */
  private makeFlagMaterial(hx: number, hz: number): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHalf: { value: new Vector2(hx, hz) } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSide;
        attribute float aPhase;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vSide;
        varying float vPhase;
        ${RECEDE_VERT}
        void main() {
          vUv = uv;
          vColor = aColor;
          vSide = aSide;
          vPhase = aPhase;
          recede();
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vSide;
        varying float vPhase;
        ${RECEDE_FRAG}
        float seg( vec2 p, vec2 a, vec2 b, out float t ) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          t = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
          return length( pa - ba * t );
        }
        void main() {
          // world units relative to the fan's shoulder
          vec2 q = ( vUv - 0.5 ) * vec2( ${FLAG_W.toFixed(2)}, ${FLAG_H.toFixed(2)} ) + vec2( 0.0, ${FLAG_MID.toFixed(2)} );
          float w = sin( uTime * 5.5 + vPhase );
          vec2 shoulder = vec2( vSide * 0.2, 0.0 );
          vec2 hand = vec2( vSide * 0.27, 0.2 + 0.17 * w );
          vec2 top = hand + vec2( 0.0, 0.72 );
          vec3 col = vec3( 0.0 );
          bool hit = false;
          float t;
          if ( seg( q, shoulder, hand, t ) < 0.075 ) {
            col = t > 0.7 ? vec3( 0.26, 0.13, 0.06 ) : vColor;
            hit = true;
          }
          if ( length( q - hand ) < 0.095 ) { col = vec3( 0.26, 0.13, 0.06 ); hit = true; }
          if ( seg( q, hand, top, t ) < 0.022 ) { col = vec3( 0.15, 0.07, 0.03 ); hit = true; }
          // the flag, rippling along its length
          float fx = ( q.x - top.x ) * vSide;
          float fy = q.y - top.y + 0.035 * sin( fx * 11.0 - uTime * 9.0 + vPhase ) * fx / 0.5;
          if ( fx > 0.0 && fx < 0.5 && fy < 0.0 && fy > -0.34 ) {
            col = ( fy < -0.13 && fy > -0.21 ) ? vec3( 1.0 ) : vColor;
            hit = true;
          }
          if ( !hit ) discard;
          gl_FragColor = vec4( recede( col ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  /**
   * The card display: a lattice of cards laid over the far stand in screen space (one InstancedMesh, one draw call, no depth
   * test), each card cream or the stunt colour with an ink edge, popping up in a ripple. The lattice cell of card `i` comes
   * in `aCell`; the board's place on screen (NDC) in `uBoard`.
   */
  private makeCardMaterial(): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: {
        uT: { value: 0 },
        uRise: { value: 1 },
        uBoard: { value: new Vector4(-1, 1, 2, -2) },
        uGrid: { value: new Vector2(1, 1) },
        uInk: { value: new Color(0x3b2418) },
        uCream: { value: new Color(0xf8ecd6) },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      vertexShader: /* glsl */ `
        attribute vec2 aCell;
        attribute vec3 aColor;
        attribute vec2 aLit;
        uniform float uT;
        uniform float uRise;
        uniform vec4 uBoard;
        uniform vec2 uGrid;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vLit;
        varying float vP;
        void main() {
          vUv = uv;
          vColor = aColor;
          vLit = aLit.x;
          float p = uRise > 0.5 ? clamp( ( uT - aLit.y ) / ${CARD_RISE_S.toFixed(2)}, 0.0, 1.0 ) : 1.0;
          vP = p;
          // pop up with a little overshoot
          float k = p - 1.0;
          float pop = p >= 1.0 ? 1.0 : 1.0 + 2.5 * k * k * k + 1.5 * k * k;
          vec2 size = abs( uBoard.zw ) / uGrid;
          vec2 centre = uBoard.xy + ( aCell + 0.5 ) * uBoard.zw / uGrid;
          vec2 pos = centre + position.xy * size * ${CARD_FILL.toFixed(2)} * max( pop, 0.0 );
          gl_Position = vec4( pos, 0.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uInk;
        uniform vec3 uCream;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vLit;
        varying float vP;
        void main() {
          if ( vP <= 0.001 ) discard;
          float e = min( min( vUv.x, 1.0 - vUv.x ), min( vUv.y, 1.0 - vUv.y ) );
          vec3 col = e < 0.12 ? uInk : ( vLit > 0.5 ? vColor : uCream );
          gl_FragColor = vec4( col, 1.0 );
          #include <colorspace_fragment>
        }`,
    });
  }

  /**
   * Stunt: the fans of the far stand hold up a card display: cards in a lattice over the stand, lit ones in team colour
   * `color` spelling `text`, or all lit when `text` is null (a round win: a wave of colour, in two colours when `color2` is
   * given). The cards pop up in a ripple from left to right unless `still`; with `seconds` they go down again, otherwise they
   * stay until `endStunt`. Needs the final camera (call it after the view is fitted).
   */
  cardStunt(
    text: string | null,
    color: number,
    opts: {
      camera: Camera;
      color2?: number;
      still?: boolean;
      seconds?: number;
    },
  ): string {
    this.stunt = {
      text,
      color,
      color2: opts.color2 ?? null,
      camera: opts.camera,
      still: !!opts.still,
      until: opts.seconds === undefined ? Infinity : this.clock + opts.seconds,
    };
    return this.layCards();
  }

  /** The cards go down (the next match builds a new crowd anyway; this is for a card closing while the view stays). */
  endStunt(): void {
    this.stunt = null;
    this.cards.visible = false;
  }

  /** The text on the cards now ('' = no stunt or a wave). */
  get stuntText(): string {
    return this.stunt?.text ?? '';
  }

  /** A running stunt, laid over the stand again for the camera as it is now (the window was resized). */
  refreshStunt(): void {
    if (this.stunt) this.layCards();
  }

  private readonly cardTmp = new Vector3();

  /** Where the far stand is on screen (NDC), and the cards that fill it. */
  private layCards(): string {
    const st = this.stunt!;
    const cam = st.camera;
    cam.updateMatrixWorld();
    const t = this.cardTmp;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const k of this.cardFans) {
      const sp = this.spectators[k];
      t.set(sp.x, sp.y + 1.0 * sp.scale, sp.z).project(cam);
      x0 = Math.min(x0, t.x);
      x1 = Math.max(x1, t.x);
      y0 = Math.min(y0, t.y);
      y1 = Math.max(y1, t.y);
    }
    if (!isFinite(x0)) {
      this.cards.visible = false;
      return '';
    }
    // a little more than the fans' heads: the cards cover the stand
    const pad = 0.04;
    x0 -= pad;
    x1 += pad;
    y0 -= pad;
    y1 += pad * 1.5;
    // the stand can reach past the screen edge (the top on a wide screen): keep every card in view
    const edge = 0.97;
    x0 = Math.max(x0, -edge);
    x1 = Math.min(x1, edge);
    y0 = Math.max(y0, -edge);
    y1 = Math.min(y1, edge);
    const board = boardMask(st.text);
    const { cols, rows } = board;
    const n = cols * rows;
    const c1 = new Color().setHex(TEAM_COLORS[st.color % COLORS]);
    const c2 = new Color().setHex(
      TEAM_COLORS[(st.color2 ?? st.color) % COLORS],
    );
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = (i - col) / cols;
      this.cardCell.setXY(i, col, rows - 1 - row);
      const c = st.color2 !== null && Math.floor(col / 3) % 2 === 1 ? c2 : c1;
      this.cardColor.setXYZ(i, c.r, c.g, c.b);
      // the ripple runs left to right across the board
      this.cardLit.setXY(
        i,
        board.lit[i],
        this.clock + (st.still ? 0 : (col / cols) * CARD_RIPPLE_S),
      );
    }
    this.cardCell.needsUpdate = true;
    this.cardColor.needsUpdate = true;
    this.cardLit.needsUpdate = true;
    const u = this.cardMaterial.uniforms;
    u.uBoard.value.set(x0, y0, x1 - x0, y1 - y0);
    u.uGrid.value.set(cols, rows);
    u.uRise.value = st.still ? 0 : 1;
    this.cards.count = n;
    this.cards.visible = true;
    return board.text;
  }

  get count(): number {
    return this.spectators.length;
  }

  /** Draw calls for the whole crowd. */
  get drawCalls(): number {
    return 3; // the sprites, the flags and the stunt cards (hidden until a stunt)
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
      if (sp.flag >= 0) {
        tint.setHex(TEAM_COLORS[color]);
        this.flagColor.setXYZ(sp.flag, tint.r, tint.g, tint.b);
      }
    });
    this.flagColor.needsUpdate = true;
    this.tileAttr.needsUpdate = true;
    for (const c of palette)
      if (!this.rendered.has(c) && !this.wanted.includes(c))
        this.wanted.push(c);
  }

  /** The colours the shirts can take right now (bit per team colour; for tests). */
  get shirtMask(): number {
    return this.colorMask;
  }

  /** Fans waving a flag (for tests). */
  get flagCount(): number {
    return this.holders.length;
  }

  /** Seat group of spectator `k` (for tests): neighbours sharing it cheer in one colour. */
  groupOf(k: number): number {
    return this.spectators[k].group;
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
    this.flags.visible = this.holders.length > 0;
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
      const crew = new Crew([player], 0, 0, { fan: true });
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
    this.flags.visible = false;
  }

  /** Something blew up: the crowd jumps (`amount` 0..1, adds up to 1). */
  excite(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  update(t: number, dt: number): void {
    this.clock = t;
    this.flagMaterial.uniforms.uTime.value = t;
    this.cardMaterial.uniforms.uT.value = t;
    if (this.stunt && t > this.stunt.until) this.endStunt();
    if (this.excitement <= 0.01) this.excitement = 0;
    else this.excitement *= Math.exp(-dt * 1.6);
    this.place(t, this.excitement);
  }

  /**
   * Matrices for every sprite: a fixed billboard facing the camera that is never quite still. Everyone breathes and sways;
   * each block of fans cheers now and then (jumping together); a stadium wave runs round the bowl every `WAVE_EVERY`
   * seconds; a blast or a KO makes everyone jump (`excite`). Deterministic in `t`.
   */
  private place(t: number, excite: number): void {
    const { m4, quat, pos, scl } = this;
    const wavePos = (t % WAVE_EVERY) / WAVE_RUN;
    this.spectators.forEach((sp, k) => {
      const idle = 0.012 * (1 + Math.sin(t * 2.3 + sp.phase));
      // a block cheers when its own slow rhythm is high: members jump almost in step
      const g = Math.min(
        1,
        Math.max(0, (Math.sin(t * 0.42 + sp.cheer * 6.283) - 0.3) * 3),
      );
      const cheer =
        g *
        0.2 *
        Math.abs(Math.sin(t * 6.4 + sp.cheer * 6.283 + sp.phase * 0.12));
      // the wave front passes this seat: one smooth hop
      const d = wavePos - sp.u;
      const wave =
        d > 0 && d < WAVE_WIDTH ? Math.sin((Math.PI * d) / WAVE_WIDTH) : 0;
      const hop =
        idle +
        cheer +
        wave * 0.32 +
        excite * 0.28 * Math.abs(Math.sin(t * 9 + sp.phase));
      const sway = 1 + 0.025 * Math.sin(t * 3.1 + sp.phase);
      const s = SPRITE * sp.scale;
      scl.set(s / sway, s * sway, 1);
      // the sprite's centre is its look-at point: a little above the feet, along the world up
      pos.set(sp.x, sp.y + SPRITE_MID * sp.scale + hop, sp.z);
      m4.compose(pos, quat, scl);
      this.mesh.setMatrixAt(k, m4);
      if (sp.flag >= 0) {
        pos.set(sp.x, sp.y + (SHOULDER_Y * sp.scale + hop), sp.z).add(LIFT);
        pos.y += FLAG_MID * sp.scale;
        scl.set(FLAG_W * sp.scale, FLAG_H * sp.scale, 1);
        m4.compose(pos, quat, scl);
        this.flags.setMatrixAt(sp.flag, m4);
      }
    });
    this.flags.instanceMatrix.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.flags.geometry.dispose();
    this.flags.dispose();
    this.flagMaterial.dispose();
    this.cards.geometry.dispose();
    this.cards.dispose();
    this.cardMaterial.dispose();
    this.atlas?.dispose();
    this.crews?.forEach(({ crew }) => crew.dispose());
  }
}
