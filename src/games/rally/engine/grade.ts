import { Color, ShaderChunk, Vector3, Vector4 } from 'three';
import type { ColorGrade } from '../maps/shared/types';

/**
 * Colour grade after tone mapping (`EnvironmentDef.grade`): white balance, contrast around mid grey, saturation,
 * vibrance, shadow / highlight tint and a vignette, in the tone-mapping chunk itself (no extra pass, so the canvas
 * keeps its MSAA). The ACES / AgX / Neutral functions are wrapped, so `toneMapping` and `?tonemap=` work as before.
 * The uniforms ride on `worldUniforms` (engine/world-shading.ts); a program without them reads 0 = no grade.
 */

/** Shared uniform objects (merged into `worldUniforms`). */
export const gradeUniforms = {
  /** x on (0 / 1), y contrast, z saturation, w vibrance. */
  rgGrade: { value: new Vector4(0, 1, 1, 0) },
  /** White balance multipliers (linear, luminance kept). */
  rgBalance: { value: new Vector3(1, 1, 1) },
  /** Shadow / highlight colour shifts (display space, luminance-free). */
  rgShadow: { value: new Vector3() },
  rgHighlight: { value: new Vector3() },
  /** x vignette strength, yz 1 / drawing buffer size. */
  rgVignette: { value: new Vector3(0, 1, 1) },
};

/** Mid grey in display space (~0.18 linear): contrast pivots here. */
const PIVOT = 0.46;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** The grade as plain numbers (what the shader reads). */
export interface ResolvedGrade {
  on: boolean;
  contrast: number;
  saturation: number;
  vibrance: number;
  balance: [number, number, number];
  shadow: [number, number, number];
  highlight: [number, number, number];
  vignette: number;
}

/** A tint colour's shift away from grey (display space, luminance removed) x amount. */
function shift(t: { color: string; amount: number } | undefined) {
  if (!t || !t.amount) return [0, 0, 0] as [number, number, number];
  const c = new Color(t.color);
  const l = c.r * LUMA[0] + c.g * LUMA[1] + c.b * LUMA[2];
  return [(c.r - l) * t.amount, (c.g - l) * t.amount, (c.b - l) * t.amount] as [
    number,
    number,
    number,
  ];
}

export function resolveGrade(g: ColorGrade | undefined | null): ResolvedGrade {
  const warmth = g?.warmth ?? 0;
  const tint = g?.tint ?? 0;
  const b = [1 + 0.1 * warmth, 1 - 0.08 * tint, 1 - 0.1 * warmth];
  const l = b[0] * LUMA[0] + b[1] * LUMA[1] + b[2] * LUMA[2];
  return {
    on: !!g && Object.keys(g).length > 0,
    contrast: g?.contrast ?? 1,
    saturation: g?.saturation ?? 1,
    vibrance: g?.vibrance ?? 0,
    balance: [b[0] / l, b[1] / l, b[2] / l],
    shadow: shift(g?.shadowTint),
    highlight: shift(g?.highlightTint),
    vignette: g?.vignette ?? 0,
  };
}

/** Grade in effect (null / {} = none, the plain tone-mapped image). */
export function setGrade(g: ColorGrade | undefined | null): void {
  const r = resolveGrade(g);
  const u = gradeUniforms;
  u.rgGrade.value.set(r.on ? 1 : 0, r.contrast, r.saturation, r.vibrance);
  u.rgBalance.value.fromArray(r.balance);
  u.rgShadow.value.fromArray(r.shadow);
  u.rgHighlight.value.fromArray(r.highlight);
  u.rgVignette.value.x = r.vignette;
}

/** Drawing buffer size for the vignette (call when the canvas size changes). */
export function setGradeViewport(width: number, height: number): void {
  gradeUniforms.rgVignette.value.y = 1 / Math.max(1, width);
  gradeUniforms.rgVignette.value.z = 1 / Math.max(1, height);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The shader's grade in TS (tests): a tone-mapped linear colour -> graded linear colour; `uv` = screen position
 * 0..1 (vignette). Keep in step with `GRADE_GLSL`.
 */
export function gradeColor(
  rgb: [number, number, number],
  r: ResolvedGrade,
  uv: [number, number] = [0.5, 0.5],
): [number, number, number] {
  if (!r.on) return rgb;
  let p = rgb.map((c, i) => Math.pow(Math.max(c * r.balance[i], 0), 1 / 2.2));
  p = p.map((c) => (c - PIVOT) * r.contrast + PIVOT);
  const l = p[0] * LUMA[0] + p[1] * LUMA[1] + p[2] * LUMA[2];
  const sat = Math.min(1, Math.max(0, Math.max(...p) - Math.min(...p)));
  const s = r.saturation * (1 + r.vibrance * (1 - sat));
  p = p.map((c) => l + (c - l) * s);
  const lt = Math.min(1, Math.max(0, l));
  const ws = 1 - smooth(0, 0.55, lt);
  const wh = smooth(0.45, 1, lt);
  p = p.map((c, i) => c + r.shadow[i] * ws + r.highlight[i] * wh);
  if (r.vignette > 0) {
    const x = uv[0] - 0.5;
    const y = uv[1] - 0.5;
    const v = 1 - r.vignette * smooth(0.2, 1, (x * x + y * y) * 2);
    p = p.map((c) => c * v);
  }
  return p.map((c) => Math.pow(Math.max(c, 0), 2.2)) as [
    number,
    number,
    number,
  ];
}

const GRADE_GLSL = /* glsl */ `
uniform vec4 rgGrade;
uniform vec3 rgBalance;
uniform vec3 rgShadow;
uniform vec3 rgHighlight;
uniform vec3 rgVignette;
vec3 rallyGrade( vec3 c ) {
	if ( rgGrade.x < 0.5 ) return c;
	vec3 p = pow( max( c * rgBalance, 0.0 ), vec3( 1.0 / 2.2 ) );
	p = ( p - ${PIVOT} ) * rgGrade.y + ${PIVOT};
	float l = dot( p, vec3( ${LUMA.join(', ')} ) );
	float sat = clamp( max( max( p.r, p.g ), p.b ) - min( min( p.r, p.g ), p.b ), 0.0, 1.0 );
	p = l + ( p - l ) * ( rgGrade.z * ( 1.0 + rgGrade.w * ( 1.0 - sat ) ) );
	float lt = clamp( l, 0.0, 1.0 );
	p += rgShadow * ( 1.0 - smoothstep( 0.0, 0.55, lt ) ) + rgHighlight * smoothstep( 0.45, 1.0, lt );
	if ( rgVignette.x > 0.0 ) {
		vec2 uv = gl_FragCoord.xy * rgVignette.yz - 0.5;
		p *= 1.0 - rgVignette.x * smoothstep( 0.2, 1.0, dot( uv, uv ) * 2.0 );
	}
	return pow( max( p, 0.0 ), vec3( 2.2 ) );
}
`;

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const chunks = ShaderChunk as Record<string, string>;
  let src = chunks.tonemapping_pars_fragment;
  const wrap: string[] = [];
  for (const name of [
    'ACESFilmicToneMapping',
    'AgXToneMapping',
    'NeutralToneMapping',
  ]) {
    const sig = `vec3 ${name}( vec3 color ) {`;
    if (!src.includes(sig))
      throw new Error(
        `grade: ShaderChunk.tonemapping_pars_fragment changed (three upgrade?): ${name}`,
      );
    src = src.replace(sig, `vec3 ${name}Base( vec3 color ) {`);
    wrap.push(
      `vec3 ${name}( vec3 color ) { return rallyGrade( ${name}Base( color ) ); }`,
    );
  }
  chunks.tonemapping_pars_fragment = `${GRADE_GLSL}\n${src}\n${wrap.join('\n')}\n`;
}

install();

// Dev: tune live from the console (`__grade.set({ contrast: 1.1, saturation: 1.08 })`).
(globalThis as { __grade?: unknown }).__grade = {
  uniforms: gradeUniforms,
  set: setGrade,
};
