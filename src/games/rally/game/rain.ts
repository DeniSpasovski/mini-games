import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { worldUniforms, type DryZone } from '../engine/world-shading';
import type { World } from '../world/world';
import { Rng } from '../../../shared/rng';

const RAIN_SEED = 0x7a1d;

/** The box of rain around the camera (m): drops further out are the fog's job. */
const BOX = new Vector3(32, 20, 32);

/**
 * Falling rain: thin streaks in a box that wraps around the camera, all moved in the vertex shader (one draw, no CPU
 * per drop). Each streak is the path a drop covers in a short exposure as the camera sees it (fall + wind - the
 * camera's own motion), so at speed the rain slants towards the windscreen as in an on-board video. A drop is lit by
 * the sky and glints in the car's low beam at night (`wsHead`). `rate` (mm/h, `weather.ts`) sets how many of the
 * `max` drops show and how fast they fall (bigger drops in harder rain).
 */
export class Rain {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  /** Rain beyond the drop box (`curtainMaterial`); shares the drops' uniforms. */
  private curtainMat: ShaderMaterial;
  private lastCam = new Vector3();
  private camVel = new Vector3();
  private step = new Vector3();
  private t = 0;
  private started = false;

  constructor(max: number, rate: number, sky: Color) {
    const pos = new Float32Array(max * 4 * 3);
    const drop = new Float32Array(max * 4 * 4);
    const corner = new Float32Array(max * 4 * 2);
    const index = new Uint32Array(max * 6);
    // Seeded (shared/rng.ts): the same rain field every run.
    const rng = new Rng(RAIN_SEED);
    for (let i = 0; i < max; i++) {
      const d = [rng.next(), rng.next(), rng.next(), i / max];
      for (let k = 0; k < 4; k++) {
        drop.set(d, (i * 4 + k) * 4);
        corner.set([k & 1 ? 1 : -1, k >> 1], (i * 4 + k) * 2);
      }
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    const g = new BufferGeometry();
    // Positions are made in the shader; the attribute only gives three a vertex count.
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aDrop', new BufferAttribute(drop, 4));
    g.setAttribute('aCorner', new BufferAttribute(corner, 2));
    g.setIndex(new BufferAttribute(index, 1));
    // Light rain ~2 mm/h: about half the drops, ~6 m/s; heavy ~8 mm/h: all of them, ~8 m/s.
    const density = Math.min(1, 0.25 + rate / 10.7);
    const fall = 5.5 + Math.min(rate, 12) * 0.3;
    this.material = new ShaderMaterial({
      uniforms: {
        uCam: { value: new Vector3() },
        uCamVel: { value: new Vector3() },
        uBox: { value: BOX.clone() },
        uTime: { value: 0 },
        uFall: { value: fall },
        uWind: { value: new Vector2(1.2, 0.6) },
        uDensity: { value: density },
        uColor: { value: sky.clone() },
        uAlpha: { value: 0.35 + 0.2 * Math.min(1, rate / 8) },
        wsHead: worldUniforms.wsHead,
        wsHeadPos: worldUniforms.wsHeadPos,
        wsHeadDir: worldUniforms.wsHeadDir,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aDrop;
        attribute vec2 aCorner;
        uniform vec3 uCam;
        uniform vec3 uCamVel;
        uniform vec3 uBox;
        uniform float uTime;
        uniform float uFall;
        uniform vec2 uWind;
        uniform float uDensity;
        uniform vec3 wsHead;
        uniform vec3 wsHeadPos;
        uniform vec3 wsHeadDir;
        varying float vAlpha;
        varying vec2 vCorner;
        varying float vBeam;
        void main() {
          vCorner = aCorner;
          vAlpha = 0.0;
          vBeam = 0.0;
          // Drops past the rain's density collapse to nothing.
          if ( aDrop.w > uDensity ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
          vec3 vel = vec3( uWind.x, - uFall * ( 0.8 + 0.4 * fract( aDrop.w * 7.31 ) ), uWind.y );
          vec3 p = aDrop.xyz * uBox + vel * uTime;
          vec3 head = uCam + mod( p - uCam + 0.5 * uBox, uBox ) - 0.5 * uBox;
          // The streak: where the drop was, seen from a camera that moved, over a 1/25 s exposure.
          vec3 rel = vel - uCamVel;
          vec3 tail = head - rel * 0.04;
          vec3 at = mix( head, tail, aCorner.y );
          vec3 dir = head - tail;
          vec3 toCam = uCam - at;
          float dist = length( toCam );
          vec3 side = cross( dir, toCam );
          float sl = length( side );
          side = sl > 1e-5 ? side / sl : vec3( 1.0, 0.0, 0.0 );
          // ~1.5 mm drops, never thinner than about a pixel far away (fainter instead).
          float width = max( 0.0015, dist * 0.0018 );
          at += side * aCorner.x * width;
          // Drops differ in size and catch the light differently: some faint, some bright.
          vAlpha = ( 0.35 + 0.65 * fract( aDrop.w * 13.7 + aDrop.x * 5.3 ) ) * smoothstep( 0.6, 2.5, dist ) * ( 1.0 - smoothstep( 0.3 * uBox.x, 0.5 * uBox.x, length( head.xz - uCam.xz ) ) )
            * min( 1.0, 0.006 / width );
          // Glint in the low beam (night, rain): in the cone ahead of the lamps, fading with distance.
          vec3 toDrop = at - wsHeadPos;
          float ld = length( toDrop );
          float cone = smoothstep( 0.9, 0.97, dot( toDrop / max( ld, 1e-3 ), wsHeadDir ) );
          vBeam = cone * clamp( 1.0 - ld / 45.0, 0.0, 1.0 );
          gl_Position = projectionMatrix * viewMatrix * vec4( at, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform vec3 wsHead;
        varying float vAlpha;
        varying vec2 vCorner;
        varying float vBeam;
        void main() {
          float across = 1.0 - abs( vCorner.x );
          float along = smoothstep( 0.0, 0.25, vCorner.y ) * smoothstep( 1.0, 0.6, vCorner.y );
          float a = uAlpha * vAlpha * across * ( 0.35 + 0.65 * along );
          vec3 c = uColor + wsHead * vBeam * 0.6;
          gl_FragColor = vec4( c, a * ( 1.0 + 2.0 * vBeam ) );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      // The streak's side flips with the camera's view of it: draw both faces.
      side: DoubleSide,
    });
    // The first `density` share of the drops show (the shader drops the rest): draw only those.
    g.setDrawRange(0, Math.ceil(max * density) * 6);
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.curtainMat = curtainMaterial(this.material, density, rate);
    const curtains = new Mesh(curtainGeometry(), this.curtainMat);
    curtains.frustumCulled = false;
    curtains.renderOrder = 9;
    this.mesh.add(curtains);
  }

  /** Follow the camera (call every frame with the camera's world position). */
  update(cam: Vector3, dt: number): void {
    const u = this.material.uniforms;
    if (this.started && dt > 0) {
      // Smoothed: the streaks lean with the camera's motion, not its frame-to-frame jitter.
      const k = Math.min(1, dt * 8);
      // A respawn or camera cut is not motion: capped at 80 m/s.
      this.step
        .subVectors(cam, this.lastCam)
        .divideScalar(dt)
        .clampLength(0, 80);
      this.camVel.lerp(this.step, k);
    }
    this.started = true;
    this.lastCam.copy(cam);
    // Wrapped so the shader's float precision holds over a long stage (a jump of a random field shows nothing).
    this.t = (this.t + dt) % 600;
    u.uTime.value = this.t;
    u.uCam.value.copy(cam);
    u.uCamVel.value.copy(this.camVel);
  }

  /** Sky light on the drops (linear colour). */
  setLight(sky: Color): void {
    this.material.uniforms.uColor.value.copy(sky);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    for (const c of this.mesh.children) (c as Mesh).geometry.dispose();
    this.curtainMat.dispose();
  }
}

/** Rain curtains round the camera: radius (m), height (m) and strength of each (`curtainMaterial`). */
const CURTAINS: readonly { radius: number; height: number; alpha: number }[] = [
  { radius: 30, height: 30, alpha: 0.55 },
  { radius: 70, height: 50, alpha: 0.45 },
  { radius: 150, height: 90, alpha: 0.35 },
];
const CURTAIN_SEGMENTS = 96;

/** The curtains' open cylinders: per vertex its angle, 0 / 1 bottom / top and its curtain. */
function curtainGeometry(): BufferGeometry {
  const n = CURTAIN_SEGMENTS + 1;
  const cyl = new Float32Array(CURTAINS.length * n * 2 * 3);
  const index: number[] = [];
  CURTAINS.forEach((_, layer) => {
    for (let i = 0; i < n; i++) {
      const a = (i / CURTAIN_SEGMENTS) * Math.PI * 2;
      const v = (layer * n + i) * 2;
      cyl.set([a, 0, layer, a, 1, layer], v * 3);
      if (i < CURTAIN_SEGMENTS)
        index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(cyl, 3));
  g.setIndex(index);
  return g;
}

/**
 * Rain beyond the drop box, as rain games draw it (ATI's ToyShop: layers of scrolling streaks at a few distances round
 * the camera): three open cylinders of falling streak lanes at 30 / 70 / 150 m, each streak sized for its distance
 * (~6 cm wide, ~1.5 m long at 30 m) and never thinner than a pixel (fainter instead). Depth-tested, so a forest hides
 * them and open ground shows the rain sweeping across the hills. Lit like the drops (`uColor`).
 */
function curtainMaterial(
  drops: ShaderMaterial,
  density: number,
  rate: number,
): ShaderMaterial {
  const u = drops.uniforms;
  return new ShaderMaterial({
    uniforms: {
      uCam: u.uCam,
      uTime: u.uTime,
      uFall: u.uFall,
      uWind: u.uWind,
      uColor: u.uColor,
      uDensity: { value: density },
      uAlpha: { value: 0.12 + 0.18 * Math.min(1, rate / 8) },
      uLayers: {
        value: CURTAINS.map((c) => new Vector3(c.radius, c.height, c.alpha)),
      },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uCam;
      uniform vec3 uLayers[ ${CURTAINS.length} ];
      varying vec3 vWorld;
      varying float vArc;
      varying vec3 vLayer;
      void main() {
        vec3 l = uLayers[ int( position.z + 0.5 ) ];
        vLayer = l;
        vec3 w = uCam + vec3( cos( position.x ) * l.x, ( position.y - 0.35 ) * l.y, sin( position.x ) * l.x );
        vWorld = w;
        vArc = position.x * l.x;
        gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCam;
      uniform float uTime;
      uniform float uFall;
      uniform vec2 uWind;
      uniform vec3 uColor;
      uniform float uDensity;
      uniform float uAlpha;
      varying vec3 vWorld;
      varying float vArc;
      varying vec3 vLayer;
      float hash( float n ) { return fract( sin( n * 91.3458 ) * 47453.5453 ); }
      void main() {
        float width = vLayer.x * 0.0018;
        float lane = width * 7.0;
        // Lanes slant with the wind.
        float x = vArc + ( vWorld.y - uCam.y ) * uWind.x / uFall;
        float id = floor( x / lane ) + vLayer.x;
        float r1 = hash( id );
        if ( r1 > uDensity ) discard;
        float r2 = hash( id + 17.0 );
        float dx = ( fract( x / lane ) - 0.2 - 0.6 * r2 ) * lane;
        float px = fwidth( x );
        float w = max( width, px );
        float across = ( 1.0 - smoothstep( 0.5 * w, 0.5 * w + px, abs( dx ) ) ) * width / w;
        float len = vLayer.x * 0.05;
        float s = fract( ( vWorld.y + uTime * uFall * ( 0.85 + 0.3 * r2 ) ) / ( len * 3.0 ) + r1 * 7.0 );
        float along = smoothstep( 0.0, 0.05, s ) * ( 1.0 - smoothstep( 0.2, 0.33, s ) );
        float t = ( vWorld.y - uCam.y ) / vLayer.y + 0.35;
        float band = smoothstep( 0.0, 0.1, t ) * ( 1.0 - smoothstep( 0.7, 1.0, t ) );
        float a = across * along * band * uAlpha * vLayer.z;
        if ( a < 0.002 ) discard;
        gl_FragColor = vec4( uColor, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * The stage road's roofed stretches, where no rain falls (engine/world-shading.ts `setDryZones`): its tunnels (the
 * slab over it, dry below the slab) and the ground under its bridge decks (dry below the deck). Capsules ~12 m long
 * along the road.
 */
export function roofZones(world: World): DryZone[] {
  const out: DryZone[] = [];
  const STEP = 12;
  const stretch = (
    from: number,
    to: number,
    roof: (along: number) => number,
    widen: number,
  ) => {
    for (let d = from; d < to; d += STEP) {
      const a = world.road.at(d);
      const b = world.road.at(Math.min(to, d + STEP));
      out.push({
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        radius: Math.max(a.halfWidth, b.halfWidth) + widen,
        top: roof(d),
      });
    }
  };
  for (const p of world.gen.portals.list) {
    const rows = p.rows;
    stretch(
      p.from,
      p.to,
      (d) => {
        const i = Math.min(
          rows.length - 1,
          Math.max(
            0,
            Math.round(((d - p.from) / (p.to - p.from)) * (rows.length - 1)),
          ),
        );
        return rows[i].top - 0.3;
      },
      1.5,
    );
  }
  for (const sp of world.road.bridges)
    stretch(sp.from, sp.to, (d) => world.road.at(d).y - 0.4, 0.5);
  return out;
}

/** The `n` zones nearest to (x, z), into `out` (reused). */
export function nearestZones(
  zones: readonly DryZone[],
  x: number,
  z: number,
  n: number,
  out: DryZone[],
): DryZone[] {
  const dist = (q: DryZone) =>
    Math.hypot((q.ax + q.bx) / 2 - x, (q.az + q.bz) / 2 - z);
  out.length = 0;
  for (const q of zones) {
    if (dist(q) > 200) continue;
    out.push(q);
  }
  if (out.length > n) out.sort((a, b) => dist(a) - dist(b)).length = n;
  return out;
}
