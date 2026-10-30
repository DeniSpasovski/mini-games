# Performance

## Description

The cost of the tree system is measured in the running game, not guessed. The hand-made trees are gone, so the cost is measured against the same stage with no trees.

## Counters

- A tree stats overlay, shown with the [Lod.debugView](./Lod.md#debug-view) toggle, reports per frame the number of trees drawn at each level and in a fade, the number of foliage sprites drawn, the triangles and draw calls of the tree passes, shadow passes included, and the GPU time of the tree main pass and tree shadow pass on their own.
- It also reports the CPU time of level selection and fade updates per frame, the number of trees re-selected that frame, the number drawn from static batches, and the number of cells checked ([Lod.activeSet](./Lod.md#active-set)).
- It shows which mitigations are on: occlusion culling, the sprite depth prepass, the shadow cascade rules and sprite thinning.
- At stage load it records the time spent deriving, meshing and baking variants, how many came from the disk cache, and the GPU and disk memory the variants use.

## Benchmark

- A benchmark runs a fixed camera path along a stage with the procedural trees and reports the average, 1% low and worst frame time, the tree GPU time and the stage load time.
- It can run the same path with trees turned off, so the trees' own cost is the difference between the two runs.
- Results are written to a file with the stage, graphics quality setting, resolution, GPU and machine name, so runs can be compared. The file also records which mitigations were on, the average and peak number of re-selected trees, and the tree main pass and tree shadow pass GPU times separately.
- Every frame slower than three times the run's average is listed in the file with its frame number, its CPU and GPU time, the tree CPU and GPU time, and any pipeline or shader creation, buffer allocation or upload, or GPU readback that happened in it.
- A run can be compared with an earlier result file, and the comparison prints the change in every figure, so the effect of each fix is shown on its own.

## Budget

- The trees' cost is negligible: on the benchmark, at the game's minimum-spec GPU, 1080p and medium quality, trees add at most 1.0 ms to the average GPU frame time and at most 1.0 ms to the 1% low, compared with the same path with no trees.
- Level selection and fade updates take at most 0.1 ms of main-thread CPU time per frame.
- Players never wait for tree generation: with the shipped cache, trees add at most 0.5 s to a stage's load time compared with the same stage with no trees.
- No frame spikes because of trees: during a run, no frame takes more than three times the average because of tree work.
- A run over budget is a failing result in the benchmark's output file.

## Frame Stability

- The tree code never waits on the GPU during a frame. Counters, timestamps, culling results and anything else read back from the GPU are read at least two frames after they were written, from buffers in a ring, and never with a blocking map or a wait-for-idle.
- Every pipeline and shader the trees can use, for every level, pass, cascade, fade and debug mode, is created or warmed at stage load, so none is compiled the first time a tree reaches a new level or pass.
- Instance, indirect-argument and fade buffers are allocated at stage load at their largest size for the stage, and are never resized, reallocated or fully re-uploaded during a run. Per-frame changes upload only the entries that changed.
- Cache reads and any variant generation finish before the stage starts; nothing in the tree system touches the disk or a worker queue's results on the main thread during a run.

## Mitigations

- Every mitigation below is on by default at every graphics quality setting. Only a debug toggle may turn one off, and the benchmark records it.
- Foliage overdraw. Within the full-detail distance, where crowns fill the screen, each atlas cluster image has a tight polygon of 6 to 8 vertices around its opaque part, and sprites use it instead of a full quad, so few pixels are spent on texels that fail the alpha test; these sprites draw in a depth-only pass first and are then shaded only where their depth is equal, so each covered pixel is shaded once; both passes compute positions identically ([Foliage.wind](./Foliage.md#wind)). Farther crowns are bound by draw calls and vertices, not pixels: their sprites are plain quads drawn in one lit pass, from one batch per variant holding the far share (thinner crowns shrink the rest away in the shader), so far crowns are not split over many draws of a few trees each. Sprite thinning past 60 m (past 80 m for the first row, [Lod.selection](./Lod.md#selection); [Foliage.simplification](./Foliage.md#simplification)) cuts the sprite count of distant crowns.
- Impostor shading. Impostors are far trees: diffuse lighting, no shadow-map reads, the albedo blended from the three nearest views but the normal read from the nearest one only, and the billboard cropped to the area its baked views cover, so few empty pixels are tested.
- Far forest. Trees are drawn up to a forest distance set by the graphics quality setting; past it, out to the view distance, the forest is a canopy shell: one mesh raised to the forest's canopy height and coloured like its crowns, so the distant woods keep their volume and silhouette and cost nothing per tree. Trees dissolve out over the last 15% of that distance with the level fades' dither, and the shell dissolves in over the same band with the complementary dither, so nothing appears at once.
- Impostors. Static impostors farther than 120 m write no baked depth, which would cost them the early depth test; their quad stands through the bounding sphere's centre, and at that distance their depth is off by a few metres at most.
- Wind. Sway fades out by 110 m, where it is under a pixel, and trees past that skip its vertex work.
- Culling. Each frame, instances are culled against the view frustum and against a hierarchical depth buffer built from the previous frame's terrain and trees, on the GPU, and the survivors are compacted into indirect draws. A tree hidden behind a hill or a closer stand of trees costs neither vertices nor pixels.
- Draw calls. Every impostor of every species shares one texture array and draws in a single instanced call.
- Foliage shading. Leaf translucency is a cheap wrap-lighting term from the atlas thickness map, not a ray march or extra light lookup; ambient occlusion stays baked. No foliage shader samples more than its three atlas textures plus the shadow map.
- Geometry. LOD0 branches of a variant have at most 2,500 triangles for most trees (3,000 to 3,500 for the poplar and willow) and 1,400 for a shrub: the finest twigs drop out first, and a crown has at most 400 sprites for a conifer, 360 for a broadleaf and 200 for a shrub: the denser leaf bunches need fewer.
- Fades. At most 32 trees fade at once; a tree whose level changes while that many are fading switches at its next free slot, still with a full fade.
- Shadows. Tree shadow casting follows [Lod.shadows](./Lod.md#shadows).
- Load. The cache is generated when the game is built and shipped with it ([Placement.caching](./Placement.md#caching)).

## Hotspots

- Alpha-tested foliage overdraw near the camera, within the 40 m full-detail distance.
- The two levels drawn together during a branch or impostor fade.
- Shadow casters, drawn again for each cascade.
- Stage load on a cold cache, when every variant and impostor is generated.
