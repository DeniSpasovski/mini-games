import {
  DataTexture,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
  Vector2,
  type IUniform,
  type Texture,
} from 'three';
import { FLAME_S } from '../../sim/rules';

/** The uniforms the arena shaders read to light floor and blocks near flames (one texel per tile). */
export interface GlowUniforms {
  uGlow: IUniform<Texture>;
  uGlowGrid: IUniform<Vector2>;
}

/**
 * Heat texture, one texel per tile: replaces dynamic point lights, so any number of simultaneous blasts costs the same
 * (one tiny texture upload per frame while something burns, nothing otherwise). Bilinear filtering spreads the glow
 * into neighbouring tiles and onto block faces for free.
 */
export class GlowGrid {
  readonly texture: DataTexture;
  readonly uniforms: GlowUniforms;
  private readonly data: Uint8Array;
  private active = false;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h);
    this.texture = new DataTexture(
      this.data,
      w,
      h,
      RedFormat,
      UnsignedByteType,
    );
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uGlow: { value: this.texture },
      uGlowGrid: { value: new Vector2(w, h) },
    };
  }

  /** Copy the sim's flame timers (seconds left per cell) into the texture; skipped while nothing burns. */
  update(flame: Float32Array): void {
    let any = false;
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const f = flame[i];
      if (f > 0) {
        any = true;
        d[i] = Math.min(255, Math.round((f / FLAME_S) * 255));
      } else d[i] = 0;
    }
    if (any || this.active) this.texture.needsUpdate = true;
    this.active = any;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
