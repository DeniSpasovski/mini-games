import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshLambertMaterial,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type IUniform,
} from 'three';

/**
 * Shell fur for the Boom Crew (DETAILS.md "Style"). The furry parts of a critter (`critters.ts`, with a per-vertex `fur`
 * length) are drawn `shells` times in ONE instanced draw, each shell pushed a little further out along the normal.
 * A shell keeps only the pixels that land on a hair: a 3D strand pattern in the critter's own space (no UVs, no seams),
 * hairs of varied length that taper to a point. Roots are darker, tips lighter, a soft rim sheen catches the light,
 * gravity combs the tips down and `sway` makes them lag behind when the critter waddles or squashes.
 */

/** Hair length (critter units) for `fur` = 1. */
export const FUR_LEN = 0.045;
/** Strands per critter unit. */
const DENSITY = 78;
/** Shells per quality (the most a critter draws): more = smoother hair, costs vertices. */
export const FUR_SHELLS = { high: 14, low: 7 } as const;
/** Fewest shells, and how many on-screen pixels of critter height buy one more (`shellsFor`). */
const MIN_SHELLS = 4;
const PX_PER_SHELL = 10;

/**
 * Shells worth drawing for a critter `px` pixels tall: a 50 px critter on the whole-arena view gets 5, a close-up
 * gets them all. Fewer shells = the same hair, coarser steps nobody can see at that size.
 */
export function shellsFor(px: number, most: number): number {
  return Math.max(
    Math.min(MIN_SHELLS, most),
    Math.min(most, Math.round(px / PX_PER_SHELL)),
  );
}

/** The furry parts as an instanced geometry: one instance per shell. */
export function shellGeometry(
  fur: BufferGeometry,
  shells: number,
): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.copy(fur as InstancedBufferGeometry);
  const id = new Float32Array(shells);
  for (let i = 0; i < shells; i++) id[i] = i;
  g.setAttribute('aShell', new InstancedBufferAttribute(id, 1));
  g.instanceCount = shells;
  return g;
}

const COMMON_FRAG = /* glsl */ `
  varying float vFur;
  float furHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
`;

/** Lambert-lit sheen at grazing angles: fur and velvety skin glow softly along the outline. */
const RIM = /* glsl */ `
  float furRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  outgoingLight += diffuseColor.rgb * pow(furRim, 3.0) * RIM_STRENGTH;
`;

/**
 * The critter's body material: clay Lambert + grain, darker where fur grows out of it (the undercoat between hairs)
 * and a soft rim sheen.
 */
export function skinMaterial(grain: DataTexture): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ map: grain, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float fur;\nvarying float vFur;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFur = fur;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.65, smoothstep(0.0, 0.15, vFur));',
      )
      .replace(
        '#include <opaque_fragment>',
        `#define RIM_STRENGTH 0.25\n${RIM}\n#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'kaboom-skin';
  return m;
}

/** A fur material: one per critter (its own `sway`); every critter shares the same program. */
export function furMaterial(
  grain: DataTexture,
  shells: number,
  smooth: boolean,
): {
  material: MeshLambertMaterial;
  sway: Vector3;
  /** Shells drawn this frame (set together with the geometry's `instanceCount`). */
  drawn: IUniform<number>;
} {
  const sway: IUniform<Vector3> = { value: new Vector3() };
  const drawn: IUniform<number> = { value: shells };
  const m = new MeshLambertMaterial({ map: grain, vertexColors: true });
  // with MSAA the hair edges blend by coverage; without it, a hard cut
  m.alphaToCoverage = smooth;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSway = sway;
    shader.uniforms.uFurLen = { value: FUR_LEN };
    shader.uniforms.uShells = drawn;
    shader.uniforms.uDensity = { value: DENSITY };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float fur;
        attribute float aShell;
        uniform float uFurLen;
        uniform float uShells;
        uniform vec3 uSway;
        varying vec3 vFurPos;
        varying float vShellH;
        varying float vFur;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float furH = (aShell + 1.0) / uShells;
        vShellH = furH;
        vFur = fur;
        vFurPos = position;
        transformed += normalize(objectNormal) * fur * uFurLen * furH;
        // tips droop a little and trail the motion
        transformed += (vec3(0.0, -0.35 * uFurLen, 0.0) + uSway) * fur * furH * furH;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${COMMON_FRAG}
        uniform float uDensity;
        varying vec3 vFurPos;
        varying float vShellH;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        // which hair is this pixel on, how long is it, how thick is it at this height?
        vec3 fq = vFurPos * uDensity;
        vec3 fc = floor(fq);
        vec3 fj = vec3(furHash(fc), furHash(fc + 19.19), furHash(fc + 47.7));
        float fDist = length(fract(fq) - 0.25 - fj * 0.5);
        float fLen = mix(0.55, 1.0, furHash(fc + 7.3));
        float fh = vShellH / fLen;
        if (vFur < 0.02 || fh > 1.0) discard;
        float fRad = 0.62 * (1.0 - fh * 0.85);
        float furCov = 1.0 - smoothstep(fRad * 0.7, fRad, fDist);
        ${smooth ? '' : 'if (furCov < 0.5) discard;'}
        if (furCov < 0.02) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // the undercoat is in shadow, the tips catch the light
        diffuseColor.rgb *= mix(0.68, 1.12, vShellH);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#define RIM_STRENGTH (0.2 + 0.4 * vShellH)
        ${RIM}
        #include <opaque_fragment>
        gl_FragColor.a = ${smooth ? 'furCov' : '1.0'};`,
      );
  };
  m.customProgramCacheKey = () => `kaboom-fur-${shells}-${smooth ? 1 : 0}`;
  return { material: m, sway: sway.value, drawn };
}
