/** Paint finishes of the body (`atlasMaterial`; the service park's copies of the cars share them). */
export type PaintFinish = 'gloss' | 'satin' | 'matte' | 'metallic';

/** MeshPhysicalMaterial parameters of a paint finish ('gloss' = street paint: no metal, a soft thin clearcoat). */
export function paintParams(finish: PaintFinish) {
  const matte = finish === 'matte';
  const satin = finish === 'satin';
  const metallic = finish === 'metallic';
  return {
    metalness: matte ? 0 : satin ? 0.1 : metallic ? 0.3 : 0.05,
    roughness: matte ? 0.88 : satin ? 0.58 : metallic ? 0.4 : 0.5,
    clearcoat: matte ? 0 : satin ? 0.35 : metallic ? 0.5 : 0.6,
    clearcoatRoughness: satin ? 0.4 : metallic ? 0.12 : 0.2,
    envMapIntensity: 1,
  };
}
