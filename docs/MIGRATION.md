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

## Progress

- 2026-11-03: plan, measurements, spike (`frontend/spike/`), yardsticks (`fps.mjs`, `cpuprof.mjs`, `ablate.mjs`).
