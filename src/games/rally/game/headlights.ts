import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SpotLight,
} from 'three';
import type { QualityName } from '../engine/quality';
import type { CarHeadlightsDef } from '../cars/shared/types';
import type { CarPhysicsDef } from '../physics/types';

/** Luminous intensity of the main low beam (scene units, physical falloff). */
const BEAM = 3200;
/** A car without its own `headlights` def. */
export const DEFAULT_HEADLIGHTS: CarHeadlightsDef = {
  power: 1,
  color: 0xfff1cf,
  angle: 0.42,
  penumbra: 0.55,
  spill: 0.2,
};
/** Visible beam length (m) and the cone's radius at its far end. */
const CONE_LENGTH = 28;
const CONE_RADIUS = 5.5;
/** The default beam angle the cone radius is made for. */
const CONE_ANGLE = 0.42;

/** Lamp position on a car (`Headlights`): 0.8 of the widest half-track, 0.75 m ahead of the front axle, 0.7 m up. */
export function headlightMount(p: Pick<CarPhysicsDef, 'front' | 'rear'>): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: (Math.max(p.front.track, p.rear.track) / 2) * 0.8,
    y: 0.7,
    z: p.front.z + 0.75,
  };
}

/**
 * The car's headlights at night (`Environment.night`): a narrow bright low beam, a wide dim spill for the verges and
 * two soft additive cones for the beam seen in the air. Children of the car, so they follow its pitch and roll.
 * The low beam casts shadows on high quality only (one extra shadow pass over what the beam covers; medium / low
 * keep the light and drop the shadow). Created before the first compile: lights are compiled into every lit shader.
 */
export class Headlights {
  readonly group = new Group();
  private readonly cones: Mesh[] = [];
  private readonly spots: SpotLight[] = [];
  readonly color: Color;
  private readonly beamMat = new ShaderMaterial({
    uniforms: { uTint: { value: new Color() }, uGain: { value: 1 } },
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vU;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vU = uv;
        vH = position.y;
        vN = normalize( normalMatrix * normal );
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vV = normalize( - mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vU;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      uniform vec3 uTint;
      uniform float uGain;
      void main() {
        float t = 1.0 - vU.y;
        float rim = 1.0 - abs( dot( normalize( vN ), vV ) );
        float f = exp( - t * 3.5 ) * ( 0.55 + 0.45 * ( 1.0 - rim ) ) * smoothstep( 0.0, 0.08, t ) * 0.55;
        // Only the part above the lamps shows: the lower half would draw bright arcs where the cone meets the road.
        f *= smoothstep( - 0.1, 0.5, vH );
        f *= uGain;
        gl_FragColor = vec4( uTint * f, f );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  /** `lamp` = lamp position on the car (x = half the lamp spacing, y height, z the nose), `car` = its root. */
  constructor(
    car: Object3D,
    lamp: { x: number; y: number; z: number },
    quality: QualityName,
    def: CarHeadlightsDef = DEFAULT_HEADLIGHTS,
    /** 0..1 (`Environment.lightNeed`): dusk lights are weaker, so the beam and its air cones fade with it. */
    level = 1,
  ) {
    this.color = new Color(def.color);
    this.beamMat.uniforms.uTint.value
      .copy(this.color)
      .lerp(new Color(1, 1, 1), 0.2);
    // Brighter lamps show a stronger beam in the air, old dim ones a faint one.
    this.beamMat.uniforms.uGain.value =
      Math.min(1.4, 0.4 + 0.6 * def.power) * level;
    const spot = (
      x: number,
      aim: number,
      aimY: number,
      angle: number,
      penumbra: number,
      power: number,
      distance: number,
      shadow: boolean,
    ): void => {
      const l = new SpotLight(this.color, power, distance, angle, penumbra, 2);
      l.position.set(x, lamp.y, lamp.z);
      l.target.position.set(x, aimY, lamp.z + aim);
      if (shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(2048, 2048);
        l.shadow.camera.near = 1;
        l.shadow.camera.far = distance;
        l.shadow.bias = -0.0008;
        l.shadow.normalBias = 0.05;
      }
      this.spots.push(l);
      this.group.add(l, l.target);
    };
    // Low beam (both lamps as one, centred), wide spill for the verges.
    spot(
      0,
      60,
      -0.9,
      def.angle,
      def.penumbra,
      BEAM * def.power * level,
      170,
      quality === 'high',
    );
    spot(0, 35, -0.6, 0.85, 1, BEAM * def.power * def.spill * level, 90, false);
    for (const side of [-1, 1]) {
      const geo = new ConeGeometry(
        CONE_RADIUS * (def.angle / CONE_ANGLE),
        CONE_LENGTH,
        24,
        1,
        true,
      );
      // Apex at the lamp, opening forwards (+Z).
      geo.translate(0, -CONE_LENGTH / 2, 0).rotateX(-Math.PI / 2);
      const cone = new Mesh(geo, this.beamMat);
      cone.position.set(side * lamp.x, lamp.y, lamp.z);
      cone.rotation.x = 0.03;
      cone.renderOrder = 10;
      cone.frustumCulled = false;
      this.cones.push(cone);
      this.group.add(cone);
    }
    car.add(this.group);
  }

  dispose(): void {
    for (const c of this.cones) c.geometry.dispose();
    this.beamMat.dispose();
    for (const s of this.spots) s.shadow.map?.dispose();
    this.group.removeFromParent();
  }
}

/** Luminous intensity of the tail lamps' red spill (scene units): the running lights, and the brake pedal fully down. */
const TAIL_IDLE = 0.8;
const TAIL_BRAKE = 10;

/** Where the red spill starts (`TailLight`): centred, 0.55 m above the road (the car's origin is its centre of mass), just behind the bumper (the rear overhang is ~0.38 of the wheelbase). */
export function tailLightMount(
  p: Pick<CarPhysicsDef, 'front' | 'rear' | 'comHeight'>,
): { x: number; y: number; z: number } {
  return {
    x: 0,
    y: 0.55 - p.comHeight,
    z: p.rear.z - 0.38 * (p.front.z - p.rear.z) - 0.15,
  };
}

/**
 * The tail lamps' red spill at night: one dim red spot light at the bumper aimed back and down, so it tints the road and
 * the verges behind the car (not the car's own rear), brighter with the brake. A child of the car; like the headlights
 * it exists from the first compile (lights are compiled into every lit shader), so it is created only when the lights are on.
 */
export class TailLight {
  private readonly light = new SpotLight(0xff1408, 0, 6.5, 0.95, 1, 2);
  private brake = 0;

  /** `level` = 0..1 lights level (`Environment.lightNeed`). */
  constructor(
    car: Object3D,
    at: { x: number; y: number; z: number },
    private level: number,
  ) {
    this.light.position.set(at.x, at.y, at.z);
    this.light.target.position.set(at.x, at.y - 0.55, at.z - 3);
    car.add(this.light, this.light.target);
    this.apply();
  }

  /** 0..1 lights level; 0 = off (the light stays in the scene, so no shader recompiles). */
  setLevel(level: number): void {
    this.level = level;
    this.apply();
  }

  /** 0 = running lights, 1 = brake pedal fully down. */
  setBrake(brake: number): void {
    this.brake = brake;
    this.apply();
  }

  private apply(): void {
    this.light.intensity =
      this.level * (TAIL_IDLE + (TAIL_BRAKE - TAIL_IDLE) * this.brake);
  }

  dispose(): void {
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
