# overhill → PlayCanvas (branch `playcanvas-migration`)

The user, 2026-11-03: *"make a full plan for the migration then do it in steps and make sure we get 500 fps in ULTRA on
PC — do step by step until it is fully migrated, don't stop."* PlayCanvas was chosen over Babylon.js (phones first,
small runtime, mature WebGPU + automatic WebGL2 fallback; the engine as a library, no editor — MIT, no subscription).

**Goal**: the game rendered by PlayCanvas (2.23.3), three.js removed from `package.json`, the look unchanged, every
harness check passing, and **≥ 500 fps at ULTRA, 1920×1080, uncapped** (`scripts/harness/fps.mjs ultra`, this M4 Mac,
headless Chrome — the CLAUDE.md way: every feature's cost measured per tier).

## What we measured first (2026-11-03, before porting anything)

`fps.mjs`, `cpuprof.mjs`, `ablate.mjs`, `spike/` (all `frontend/`):

- **Baseline (three.js r186, WebGL2/ANGLE-Metal)**: ULTRA 1080p mean **2.60 ms (385 fps)** over 6 views — spawn
  3.00, forest 2.75, lake 3.00, cliff 2.39, oasis 2.43, desert plain 2.01 ms.
- **It is the GPU side, not our JavaScript**: the CPU profile at the spawn is 2.86 ms/frame of which our own code is
  ~0.2 ms; the rest is time *inside* WebGL calls (`drawElementsInstanced` 1.45, `uniform3f` 0.72, `bindVertexArray`
  0.33 ms) — the main thread blocked on Chrome's GPU process (ANGLE → Metal).
- **The frame's fixed cost**: with every part of the world hidden a frame still costs **1.29 ms** (1.04 without MSAA).
  The parts themselves (ablation, each hidden in turn): terrain 0.37, trees 0.21, grass 0.15, rocks 0.11, falls 0.06,
  water 0.04, sky 0.04, props 0.03 … ≈ 1.1 ms.
- **Raw WebGL on this machine** (`spike/floor2.html`): clear only 0.06 ms; + depth clear 0.29; + MSAA 0.55; each draw
  call ~3–16 µs (noisy) — ANGLE's per-draw cost is real.
- **PlayCanvas, WebGL2 vs WebGPU** (`spike/pc.ts`, a load like ours; the GPU's real pace — 300 frames, then wait for
  the GPU to finish: in headless Chrome WebGPU's rAF runs ahead of the GPU, so rAF timing LIES for WebGPU):

  | load | WebGL2 | WebGPU |
  |---|---|---|
  | nothing drawn, MSAA 4 | 1.42 ms | **0.55 ms** |
  | spike load, no MSAA | **1.75 ms** | 2.45 ms |
  | 600 k grass blades, MSAA 4 | **6.5 ms** | 10.8 ms |
  | 2 M grass blades, MSAA 4 | **18.3 ms** | 44.5 ms |

  WebGPU's fixed cost is lower, but its vertex throughput here is 1.7–2.4× worse (Chrome's WebGPU robustness on
  Metal). **PlayCanvas on WebGL2 has the same fixed cost as three.js** — it's Chrome / ANGLE's, not the engine's.

**So**: the port by itself does not give 500 fps; the 500 fps comes from cutting GPU work and draw calls after (and
during) the port. WebGL2 is the default backend (faster for this vertex-heavy world on this machine); WebGPU stays
available (`?api=webgpu`, our GLSL transpiled at runtime) and is re-measured on the finished port.

## The design

- **`src/oth/gfx/`** — the game's graphics layer, on PlayCanvas: our own math (`math.ts`: Vector2/3/4, Matrix3/4,
  Quaternion, Euler, Color, Box3, Sphere, Frustum, MathUtils — the subset the game uses, three's semantics, pure
  math), and a thin retained scene API (`Object3D`/`Group`/`Mesh`/`InstancedMesh`, `BufferGeometry`/
  `InstancedBufferGeometry`/attributes, `ShaderMaterial`, `DataTexture`/`Texture`, `RenderTarget`, `PerspectiveCamera`,
  `Scene`, `Renderer`) whose objects own PlayCanvas `GraphNode`s, `Mesh`es, `MeshInstance`s, `ShaderMaterial`s,
  `Texture`s and `RenderTarget`s. The game modules keep their logic and their GLSL; their import changes.
- **Shaders**: written once (our GLSL 3 as today). `gfx/shader.ts` turns them into PlayCanvas GLSL: `in`/`out` →
  `attribute`/`varying`, three's built-ins → PlayCanvas's (`projectionMatrix`→`matrix_projection`, `viewMatrix`→
  `matrix_view`, `modelMatrix`→`matrix_model`, `cameraPosition`→`view_position`, `instanceMatrix`→ four instance
  attributes), `#include <tonemapping_fragment>` / `<colorspace_fragment>` → our own chunk (the hue-keeping Neutral
  tone map + linear→sRGB, as toneMap.ts), defines prepended, attributes mapped to semantics per material.
- **Uniforms**: the ATMOSPHERE's are global — written once a frame to the device's scope; a material's own are pushed
  each frame (three's `{ value }` objects kept, so the modules' code stays as it is).
- **Draw order**: the world layer sorted manually — three's `renderOrder`, then opaque by material, transparent back
  to front (the terrain still draws last: the early depth test skips the ground under the grass).
- **Dropped**: `Post.ts` (the optional `?post=1` pass — off by default since 2026-10-27, the user's call); reversed-Z
  (PlayCanvas has none: the near plane and the depth precision re-checked for z-fighting far away).

## Steps (each: built, typechecked, screenshot-compared with `main` on :5201, measured, committed)

1. **gfx core**: math, geometry, material + shader conversion, textures, render targets, camera, scene, renderer
   (PlayCanvas device: WebGL2 default, `?api=webgpu`); `main.ts` boots it.
2. **The ground and the air**: Atmosphere, toneMap, noiseTex, MapData's textures, TerrainShadow, Terrain, Sky, Water.
3. **Plants and stones**: Grass, Rocks (+ rockRelief), Trees (+ impostor bake — render targets), Bushes, leafTexture,
   treeGeometry.
4. **Built things**: Bridges, Landmarks, Props, Falls, Formations (+ Draco GLB), Glow, Horizon.
5. **The car and what moves**: loadModels (GLB), Vehicle, Dust, TyreTracks, Rain, Winch, Birds; physics hulls without
   three's ConvexHull (Rapier builds the hull).
6. **Everything else**: World, main, ChaseCam/FlyCam, Crossing, MapView/Radar/Nav/Audio (math only); three removed.
7. **Parity**: every harness (`shot`, `navtest`, `gpsdrive`, `climbtest`, `crosstest`, `abweather`…) on the new build;
   screenshots side by side with `main`.
8. **500 fps**: profile → cut (draw calls merged, cheaper grass / terrain / tree shading, the far ground, MSAA vs
   cheaper AA on ULTRA…) until `fps.mjs ultra` ≥ 500 on every view; LOW / MEDIUM / HIGH re-measured; WebGPU
   re-measured.

## Measuring the GPU here (what the port taught us — read before trusting a number)

- **The yardstick is GPU-drained wall-clock** (`fps.mjs`, `gpubase.mjs`, `ablate.mjs`): N frames submitted, then wait
  until the GPU has finished them (`__oth.gpuDone()`). rAF timing alone lies on WebGPU in headless Chrome (rAF runs
  ahead of the GPU); WebGPU timestamp queries (PlayCanvas's `gpuProfiler`, `gpuprof.mjs`) work but on this M4 they
  read ~2.2 ms for a pass with nothing in it — they include the GPU's clock ramp / waits, not only the work.
- **Never subtract WebGL2's "nothing drawn" from its frame**: ANGLE's ~1.2 ms fixed cost is mostly CPU / GPU-process
  time that OVERLAPS the GPU's shading, so "frame − nothing" under-reads WebGL2's real shading. (That subtraction
  made WebGPU look 3–15× slower at shading than WebGL2; GPU-bound spikes (`spike/ops.html`: 64 / 128 independent
  fetches, helper functions, loops) show the two equal — Dawn's Metal code is not slower than ANGLE's.)
- **A/B on small costs: `?scale=200`** (the frame at 3840×2160) — the pixel work ×4 against the same fixed cost, so
  a shader change shows above the noise (1080p A/B noise is ±0.3 ms on this machine).
- **Never measure a shader cut short by an early `return`** (the old `TDEBUG` stops): the compiler then drops work
  the stop didn't mean to, and what's drawn is not the ground (checked by screenshot — the stops drew flat colour).
  Cut a FEATURE (its code skipped, its result a plausible constant) and screenshot it.
- **WebGPU loops**: Tint guards every WGSL loop that isn't a plain `for` with a 64-bit counter (infinite-loop
  safety), and the guard stops the GPU compiler unrolling it (DXC on Windows, Metal here) — naga writes GLSL `for`
  loops as `loop {}`. Our two shader loops (rockRelief, the terrain's geomorph) are written out instead.

## Progress

- 2026-11-03: plan, measurements, spike (`frontend/spike/`), yardsticks (`fps.mjs`, `cpuprof.mjs`, `ablate.mjs`).
- 2026-11-03: steps 1–6 — the game renders on PlayCanvas (commit 74de3b3); WebGPU on desktop, WebGL2 on phones and
  as the fallback, our GLSL → WGSL at runtime (naga; glslang + twgsl the fallback), MiniStats (F3 / `?stats=1`)
  (commit 962e2d3). WebGPU ULTRA 1080p mean 2.86 ms (350 fps) — spawn 3.75, forest 2.95, lake 3.61, cliff 3.18,
  oasis 2.16, plain 1.48 ms.
- 2026-11-03, the GPU, understood (`abgpu.mjs` A/B at 4K, `gpubase.mjs`, ablation): the frame is PIXEL work — 4K costs
  4.2× 1080p; the vertex stage hides behind it (halving the grass, or a 4× coarser terrain mesh, moves 4K by nothing).
  At the spawn (4K): terrain 49 %, trees 17 %, the rest < 3 % each; MSAA 4× costs ~0.7 ms at 1080p on this tiled GPU
  (its tiles shrink; it isn't memory traffic — memoryless attachments changed nothing here). Inside the terrain's
  shader (each feature cut, 4K): the paint (noise + mask + groundPaint) up to −37 % of the whole frame, the rock
  relief −10 %, the haze −6 %; the terrain shadow −1 %. Near ground (< 100 m) is 50–66 % of the screen at a driver's
  height. Dawn on Metal uses VERTEX PULLING (robustness: attributes read from buffers in the shader) — a Mac-only
  cost (D3D12 / Vulkan fetch robustly in hardware); hidden here behind the pixels.
- 2026-11-03, fixes and cuts: WebGPU IMPOSTORS were missing (every far tree): a target's depth was discarded after
  each pass (now a depth TEXTURE — PlayCanvas stores only those) and WebGPU's targets were upside down (now
  `RENDERTARGET_ORIGIN_BOTTOM`: GL's layout on both backends) — the WebGPU numbers before this were missing the far
  trees. The canvas's MSAA colour + depth TRANSIENT (memoryless on tiled GPUs; the stencil cleared, was loaded each
  frame). The GRASS FIELD (Grass.ts: each root's paint / growth baked into world-space texels round the camera — a
  blade vertex reads 2 texels, not ~20 reads + groundPaint, the same 45 times a tuft). Trees drawn nearest first.
  WebGPU ULTRA 1080p mean 2.89 ms (346 fps): spawn 4.24, forest 2.82, lake 3.85, cliff 2.88, oasis 2.12, plain 1.46
  (this machine ran slower through the afternoon — compare within one A/B run only).
