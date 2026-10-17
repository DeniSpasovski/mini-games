/** Paint finishes of the body (`atlasMaterial`; the service park's copies of the cars share them). */
export type PaintFinish = 'gloss' | 'satin' | 'matte' | 'metallic';

/** MeshPhysicalMaterial parameters of a paint finish. */
export function paintParams(finish: PaintFinish) {
  const matte = finish === 'matte';
  const satin = finish === 'satin';
  const metallic = finish === 'metallic';
  return {
    metalness: matte ? 0 : satin ? 0.1 : metallic ? 0.35 : 0.2,
    roughness: matte ? 0.88 : satin ? 0.58 : metallic ? 0.34 : 0.45,
    clearcoat: matte ? 0 : satin ? 0.35 : metallic ? 0.65 : 1,
    clearcoatRoughness: satin ? 0.4 : metallic ? 0.04 : 0.12,
    envMapIntensity: 1,
  };
}
