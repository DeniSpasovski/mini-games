/** Files present in public/models/cars at build time (see rsbuild.config.ts). */
declare const __CAR_MODEL_FILES__: string[];
/** Files present in sources/music at build time (see rsbuild.config.ts). */
declare const __MUSIC_FILES__: string[];
/** True in `npm run build:test`: TEST cars / maps ship too (see release.ts). */
declare const __TEST_BUILD__: boolean;
/** New on every production build, empty on a dev server: key of the rally disk cache (see rsbuild.config.ts). */
declare const __BUILD_ID__: string;
