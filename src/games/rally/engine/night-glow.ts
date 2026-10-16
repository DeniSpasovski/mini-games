import {
  type Color,
  Material,
  type MeshStandardMaterial,
  type Vector3,
} from 'three';
import { worldUniforms } from './world-shading';

/**
 * Night glow for road-side materials, fed by the shared world uniforms (`wsHead*`, `wsLamp`):
 * - `retro`: reflective sheeting and reflectors (marker posts, chevron boards) brighten inside the car's low beam, when
 *   they face the lamps. Bright enough for bloom to catch them.
 * - `lamp`: a street lamp lens glows warm with the lamps' level (`Environment.lightNeed`).
 * Both add emissive light only, so they cost nothing by day (the terms are zero).
 */
export type NightGlow = 'retro' | 'lamp';

const DECL = /* glsl */ `
varying vec3 vNightW;`;

const FRAG: Record<NightGlow, string> = {
  retro: /* glsl */ `
  {
    vec3 toHead = wsHeadPos - vNightW;
    float dHead = max( length( toHead ), 0.5 );
    vec3 lHead = toHead / dHead;
    float inBeam = smoothstep( 0.8, 0.95, dot( - lHead, wsHeadDir ) );
    float facing = max( dot( inverseTransformDirection( normal, viewMatrix ), lHead ), 0.0 );
    float reach = 1.0 - smoothstep( 110.0, 190.0, dHead );
    totalEmissiveRadiance += diffuseColor.rgb * wsHead * ( inBeam * facing * reach * 70.0 / ( 1.0 + dHead * 0.02 ) );
  }`,
  lamp: /* glsl */ `
  totalEmissiveRadiance += diffuseColor.rgb * ( wsLamp * 60.0 );`,
};

/** Give `m` the glow (call once, before its first compile). `m` must be vertex-coloured or mapped (`diffuseColor`). */
export function addNightGlow(m: MeshStandardMaterial, kind: NightGlow): void {
  m.onBeforeCompile = (shader, renderer) => {
    Material.prototype.onBeforeCompile.call(m, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${DECL}`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 nightP = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          nightP = instanceMatrix * nightP;
        #endif
        vNightW = ( modelMatrix * nightP ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>${DECL}
        uniform vec3 wsHead;
        uniform vec3 wsHeadPos;
        uniform vec3 wsHeadDir;
        uniform float wsLamp;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>${FRAG[kind]}`,
      );
  };
  m.customProgramCacheKey = () => `night-glow-${kind}`;
}

/** The car's low beam for the glow materials: colour x strength (black = off), world lamp position and aim. */
export function setHeadBeam(color: Color, pos: Vector3, dir: Vector3): void {
  worldUniforms.wsHead.value.copy(color);
  worldUniforms.wsHeadPos.value.copy(pos);
  worldUniforms.wsHeadDir.value.copy(dir);
}

/** Street lamp glow, 0..1. */
export function setLampGlow(level: number): void {
  worldUniforms.wsLamp.value = level;
}
