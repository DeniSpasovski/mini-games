/** Files present in public/models/cars at build time (see rsbuild.config.ts). */
declare const __CAR_MODEL_FILES__: string[];
/** Files present in sources/music at build time (see rsbuild.config.ts). */
declare const __MUSIC_FILES__: string[];
/** True in `npm run build:test`: TEST cars / maps ship too (see release.ts). */
declare const __TEST_BUILD__: boolean;
/** GPU-compressed textures (rsbuild source.assetsInclude): the emitted file's URL. */
declare module '*.ktx2' {
  const url: string;
  export default url;
}
