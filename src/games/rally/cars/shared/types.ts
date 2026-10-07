import type { SuspensionStyle } from './suspension-mesh';
import type { CarPhysicsDef } from '../../physics/types';
import type { SourceLink } from '../../maps/shared/types';
import type { LiveryInfo } from './livery';
import type { BufferGeometry } from 'three';
import type { TyreId } from '../../physics/tyres';
import type { CarPartGeometry } from './car-parts';

/**
 * A car = physics definition + procedural model parameters.
 * Model space: y = 0 is flat ground at static ride height, z = 0 is the centre
 * of mass (same Z origin as physics), +Z forward, +X left.
 */
export interface CarDef {
  id: string;
  name: string;
  /** e.g. "Group N AWD", shown in menus. */
  className: string;
  description: string;
  /** External resources used (models, references; shown on the About screen). Keep public/models/CREDITS.md in sync. */
  sources?: SourceLink[];
  physics: CarPhysicsDef;
  model: CarModelDef;
  sound: CarSoundDef;
}

/** Cylinder layout = firing pattern (game/engine-sound.ts). `v8` is cross-plane; `flat4` has unequal headers. */
export type EngineLayout = 'i4' | 'i5' | 'i6' | 'v8' | 'flat4';

/** How the car sounds; game/audio.ts synthesises it from these (no samples). Levels are 0..1. */
export interface CarSoundDef {
  layout: EngineLayout;
  /** Litres: bigger = deeper, heavier, louder. */
  displacement: number;
  /** 0 = road silencer (soft, dull) .. 1 = open race exhaust (loud, raspy). */
  exhaust: number;
  /** Induction roar on throttle (carburettors, individual throttle bodies, an airbox under the bonnet). */
  intake: number;
  /** Turbo whistle + spool; `antiLag` = rally anti-lag bangs off throttle (else the wastegate flutters on a lift). */
  turbo?: { antiLag: boolean };
  /** Overrun crackle and pops on a lift from high rpm. */
  pops: number;
  /** Straight-cut gear whine (rises with road speed). */
  gearWhine: number;
  /** Sequential = a clunk and an ignition cut on every shift; manual = a soft clutch shift. */
  gearbox: 'sequential' | 'manual';
  /** Lumpy idle of a race camshaft. */
  cam: number;
  /** Cylinder-to-cylinder variation (default 0.05): a tired engine is rougher. */
  roughness?: number;
}

/**
 * One cross-section of the lower body. Stations are listed rear -> front and
 * interpolated with a smooth spline, so 6-10 stations give a convincing shape.
 */
export interface BodyStation {
  z: number;
  /** Underside height. */
  floor: number;
  /** Top of the lower body (bonnet / boot lid / beltline) at this station. */
  belt: number;
  /** Half width at the widest point of the side. */
  hw: number;
  /** Half width at the beltline (tumblehome). */
  hwBelt: number;
}

/** Glass house: from beltline up to the roof. */
export interface CabinDef {
  /** Z where the windscreen meets the bonnet / where the rear glass meets the boot. */
  zFront: number;
  zRear: number;
  /** Z of roof front / rear edges (windscreen + rear screen rake). */
  roofFront: number;
  roofRear: number;
  roofY: number;
  /** Roof half width. */
  roofHw: number;
  /** Rear side window: length (m) over which its lower edge kicks up into the C pillar (0 = square end). */
  kick?: number;
  /** Z of the B pillar (default: middle of the roof + 5 cm). */
  bPillar?: number;
}

export interface CarModelDef {
  stations: BodyStation[];
  cabin: CabinDef;
  /** Default paint (sRGB hex string). Liveries derive accents from the seed. */
  paint: string;
  /** How far the wheel-arch flares stick out from the body side (m). */
  flare: number;
  rim: {
    color: string;
    spokes: number;
    /** 'spoke' = alloy rally wheel, 'steel' = pressed steel disc with hub cap. */
    style?: 'spoke' | 'steel';
    /** Brake caliper colour (default red). */
    caliper?: string;
  };
  /** Body styling + rally parts. Everything optional; see car-parts.ts. */
  parts: CarParts;
  /**
   * Window glass tint override (default: dark, 45% opaque). On an imported body it also replaces the opaque `glass`
   * part, so set it only when the model has a cockpit to see through the windows.
   */
  glass?: { color: number; opacity: number };
  /** Paint finish: 'satin' = old weathered paint (rough, thin clearcoat). Default 'gloss'. */
  paintFinish?: 'gloss' | 'satin';
  /**
   * Car-specific rim + caliper geometry (axis X, outer face +X, see buildWheelGeometries). The returned `tire` is
   * ignored: every tyre comes from cars/shared/tyre-mesh.ts (size + tread per compound).
   */
  wheels?: (
    radius: number,
    width: number,
  ) => { tire: BufferGeometry; rim: BufferGeometry; caliper: BufferGeometry };
  /**
   * Wheel GLB in public/models/cars/ (`rim` + `tyre` meshes in unit wheel space, made from STLs by
   * scripts/car-model/wheel-stl-to-glb.mjs, see cars/shared/stl-wheel.ts). Scaled to the physics wheel
   * size; replaces the procedural tyre + rim once loaded and adds a brake disc behind the open spokes.
   */
  wheelModel?: string;
  /**
   * Per-compound wheel: another wheel GLB (`model`) and / or rim colour for a tyre compound (the rest falls back to
   * `wheelModel` / `rim.color`) - e.g. the body's own alloy on tarmac, a black rim on gravel.
   */
  wheelByCompound?: Partial<
    Record<TyreId, { model?: string; rimColor?: string }>
  >;
  /** Road dust on the tyres' sidewalls and in the grooves (old road cars, see cars/shared/tyre-mesh.ts). */
  tyreDust?: boolean;
  /** Look of this car's coil-overs / struts on the setup screen (cars/shared/suspension-mesh.ts). */
  suspensionStyle: SuspensionStyle;
  livery: 'stripes' | 'swoosh' | 'classic' | 'rally1';
  /**
   * Rally door plate (car number + rally name, cars/shared/rally-badge.ts) - centre on the front door in
   * model space (m); the plate size is the same on every car (0.6 m wide). Default: middle of the front door,
   * just under the beltline.
   */
  doorBadge?: { z?: number; y?: number };
  /**
   * Hand-built body (see cars/zastava-101/body.ts): replaces the generic station loft + parts.
   * `stations` / `cabin` are then only used for the bolt-on kit of an imported model.
   */
  custom?: CarCustomBody;
  /**
   * Optional imported model. Used instead of the procedural body when the file
   * exists in public/models/cars/ (see .claude/skills/rally-content "Imported models").
   * The procedural wheels are kept (they're driven by physics); GLB wheels are hidden.
   */
  gltf?: CarGltfDef;
  /** Draw hub uprights + wishbones + dampers behind the wheels (useful with open-arch imported bodies). */
  suspension?:
    boolean | { /** Damper colour (default gold). */ damper: string };
}

export interface CarGltfDef {
  /** File name inside public/models/cars/, e.g. "skoda_rally.glb". */
  file: string;
  /** Attribution (CC-BY etc.) shown in the car viewer / menu. */
  credit: string;
  /** Extra yaw (rad) if the model's front isn't +Z. */
  rotationY?: number;
  /** Uniform scale; default = fit model length to physics.length. */
  scale?: number;
  /** Fine offset after auto-fit (m, model space). */
  offset?: [number, number, number];
  /** Regex (case-insensitive) of node names to hide - default hides wheels / tyres / brakes. */
  hideNodes?: string;
  /**
   * false = the file is already in car model space (metres, y = 0 ground, z = 0 centre of mass,
   * +Z forward) - e.g. made by scripts/car-model/stl-to-glb.mjs - so it is not auto-fitted.
   */
  autoFit?: boolean;
  /** Livery painted at runtime onto the model's atlas UVs (replaces the file's materials). */
  atlas?: CarAtlas;
  /** Satin paint instead of glossy clearcoat (atlas models only). */
  matte?: boolean;
  /** Procedural rally add-ons layered on the imported body (pod lights, mudflaps, roof vent, wing). */
  addOns?: Pick<CarParts, 'lightPod' | 'mudflaps' | 'roofVent' | 'rearWing'>;
}

export interface CarParts {
  /** Arch shape: 'round' = thin lip, 'box' = wide Rally1-style fender boxes. */
  arches?: 'round' | 'box';
  /** Number of auxiliary lights on a bonnet pod (0 = none). */
  lightPod?: number;
  /** 'lip' = small roof spoiler, 'rally1' = big swan-neck wing with endplates. */
  rearWing?: 'none' | 'lip' | 'rally1';
  mudflaps?: boolean;
  roofVent?: boolean;
  headlights?: 'slim' | 'rect' | 'round';
  grille?: 'mouth' | 'slats' | 'small';
  splitter?: boolean;
  canards?: boolean;
  sideSkirts?: boolean;
  hoodVents?: boolean;
  diffuser?: boolean;
  bumpers?: 'body' | 'black';
  /** 2 or 4 doors (panel seams + handles). */
  doors?: number;
}

/** A body built by car-specific code (cars/shared/mesh-kit.ts) instead of the generic loft. */
export interface CarCustomBody {
  /** Paint texture, drawn at runtime onto the `paint` geometry's UVs (px / atlas size, v down). */
  atlas: CarAtlas;
  /** DOM-free. `paint` = painted shell (atlas UVs); `parts` = everything else, per shared material. */
  build(def: CarDef): { paint: BufferGeometry; parts: CarPartGeometry };
}

/** A runtime-painted livery texture for a model with atlas UVs (imported or custom body). */
export interface CarAtlas {
  /** Canvas size (px). */
  width: number;
  height: number;
  /** Paint the whole atlas (seeded; info.base = chosen paint colour). */
  paint(ctx: CanvasRenderingContext2D, info: LiveryInfo, seed: number): void;
  /** Atlas px rect [x, y, w, h] painted black that renders matte (no clearcoat) - wheel arches. */
  matteRect?: [number, number, number, number];
}
