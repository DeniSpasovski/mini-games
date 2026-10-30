/**
 * Layer of meshes drawn only into the sun's shadow map (tree crown proxies): the main camera never walks them, where a
 * mesh hidden per frame (`count = 0`) still cost a program and uniform set-up per draw. Switched on for the shadow pass
 * only (trees/draw.ts `shadowGate`).
 */
export const SHADOW_ONLY_LAYER = 6;
