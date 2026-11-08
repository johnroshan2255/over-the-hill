# PERF — 500 fps on the PC, a constant 60 on a Snapdragon 6-series phone, both at ULTRA

The user, 2026-11-06: *"i want to get 500 fps uncapped … make a plan to get 500+ fps so even snapdragon 600+ phone
will give const 60+ in ultra"*; *"we can hide things from far"*; *"do all the steps … even more graphics webgames get 800 fps"*; *"the trick is to
preserve the visual appearance while reducing the actual rendering cost"*; *"check the cheapest way to create water"*.
This is step 8 of `MIGRATION.md`, with the phone made a goal of its own.

## 2026-11-07 — Chromebooks and integrated GPUs: ULTRA drawn the phones' way, the resolution adaptive everywhere

The user: *"we need it be played on anything"*; *"do all optimization works, so that even a chrome book will get 500
fps in ultra"*. **500 fps on a Chromebook is not reachable**: its screen is 60 Hz (Chrome stops at the screen's rate),
and an Intel UHD / Mali has ~1/10–1/20 of the RTX 4050's GPU (which draws a view in ~1 ms). The goal set instead: a
**steady 60 at ULTRA** — the same world, ranges and look, fewer pixels (as the phones, "The phone, by the numbers").

Before this, a Chromebook was drawn as a PC: not "mobile", so ULTRA with MSAA 4×, the 2× pixel cap, the 1024 ground
cache, the rock relief, WebGPU, and NO adaptive resolution (phones only).

| change | where |
|---|---|
| **A weak GPU recognised** by its name (WebGL's unmasked renderer, a throwaway context at boot): Intel HD / UHD / Iris Plus (not Iris Xe, Arc), Mali / Immortalis / PowerVR / Adreno (not Snapdragon X), software. 19 real strings tested (`npm run test:gpu`) | `DeviceProfile.ts` `isWeakGpu` / `weakRenderer`; `tests/gpuclass.test.ts` |
| On a weak GPU, ULTRA the phones' way: **MSAA 2×** (not 4×; on WebGL2 PlayCanvas's own multisampled back buffer takes `device.samples`, `core.ts`), ground cache 512 (34 MB, not ~4×: shared memory), the rock relief off, ≤ 1 pixel per CSS pixel, WebGL2 (the phones' path; these drivers' WebGPU the least tried). `?gpu=weak` / `?gpu=full` force it; `?aa=0` no MSAA, `?msaa=4` 4× | `quality.ts` `pickTier`, `main.ts`, `gfx/core.ts` |
| **Adaptive resolution on EVERY device** (was phones only): judged on each second's AVERAGE frame (a GC stall or a hitch barely moves it), two slow seconds (> 19 ms) running to drop 15 %, down to half; back up 8 % when fast (< 12.5 ms) — and on a 60 Hz screen (which never shows < 12.5 ms) a TRY up after 8 s held at ≥ 57 fps, the wait doubled (to 2 min) when a try turns slow. A frame > 250 ms (tab hidden, a load) restarts the second. A PC at 500 fps never moves. The Resolution setting at a fixed % / `?dpr=fixed` / `?adaptive=0` turn it off | `main.ts` |
| `gpuclass.mjs`: what the game makes of a machine's GPU (name, weak, backend, canvas, the resolution share) | `scripts/harness/` |

**Cost, measured on the M4 (abq.mjs, ULTRA 1920 × 1080 uncapped, 3 reps interleaved) — `gpu=weak` forces the profile
here, so this is the profile's saving on the M4, not a Chromebook's frame:**

| view | ULTRA (PC way) | ULTRA, weak-GPU way | + 70 % resolution |
|---|---|---|---|
| spawn | 4.740 ms | 1.914 (−60 %) | 1.661 |
| forest | 4.543 | 1.717 (−62 %) | 1.449 |
| lake | 4.824 | 1.854 (−62 %) | 1.387 |
| cliff | 4.349 | 1.664 (−62 %) | 1.491 |
| rockhill | 3.750 | 1.681 (−55 %) | 1.689 |

(That table was the weak way with NO MSAA, before the user's *"can't we at least MSAA 2× on small"*. MSAA on it,
abq.mjs, WebGL2, 3 reps — forest / lake / cliff: off 1.736 / 1.890 / 1.676 ms, **2× +0.70 / +0.66 / +0.65**, 4× +1.01 /
+1.11 / +1.03: 2× is ~⅔ of 4×'s cost on the M4; on an Intel UHD (no tile memory) the saving should be larger, on a
Mali / PowerVR (MSAA resolved in tile memory) both are cheap. The spawn's row was thrown by a stall, not used. The look,
`viewshot.mjs`: 2× smooths the trunks, ridges and the car as 4× does; off they stair-step.)

**CAUTION, these absolute numbers:** a tab in the user's own Chrome was running at 70–115 % CPU for 1.5 h during the
run (likely the game: the GPU shared), and `fps.mjs ultra` read 3.562 ms mean against 1.885 on 2026-11-06 — re-measure
on a quiet machine before believing either column; the A/B's ratio is the interleaved, fair part. The look: the same
(`viewshot.mjs`: grass edges a touch harder without MSAA, the rock without its relief, as on phones).

**Not done yet (the order to do them):** (1) measure on a real Chromebook (`gpuclass.mjs`'s numbers there, `?stats=1`,
`chrome://inspect`), and the WebGPU vs WebGL2 A/B on it; (2) render scale + a sharpening upscale (FSR1-style EASU /
RCAS, or PlayCanvas's `CameraFrame` `renderTargetScale`) so a dropped resolution keeps its edges — the main camera
into a target and a blit; the water's depth reads to check; (3) f16 / mediump in the terrain, grass and tree colour
maths (Mali / PowerVR run it at 2×; Intel's GL drivers mostly ignore it; never world positions — 16 km); (4) the
major-GC stall (PlayCanvas's per-frame allocations) — on a Chromebook's CPU it's longer; (5) physics in a worker,
multi-draw for trees / rocks (Phase 5).

## 2026-11-07 — the Windows PC (Ryzen 7 7435HS + RTX 4050 Laptop): the CPU's frame, and the hitches

The user: *"travel around all places in valley and check places with fps drop and fix it … loop it until we get
500+"*; *"this PC must get 500+ fps, Mac mini … 700+"*; *"even a Chromebook … and a small phone 100+ … all ULTRA"*;
*"don't compromise current visual quality"*.

**What the frame was here.** WebGPU timestamps: the GPU drew a view in **0.8–1.0 ms**; the frame took 1.9–3.4 ms. The
rest was the CPU — the game's JavaScript, PlayCanvas, Chrome's WebGPU calls — so this PC (unlike the M4) was CPU-bound
(the GPU ~60 % busy). Every fix below is CPU-side and changes no pixel (`pixdiff.mjs`: old vs new at the noise floor).

| | what | gain (`abq.mjs`, interleaved) |
|---|---|---|
| 1 | PlayCanvas's RELEASE build in dev (the `development` export is the debug build: error scopes round every GPU call, validation) — `vite.config.ts`; `PCDEBUG=1` for the debug one | spawn −0.83 ms, forest −0.84, lake −0.47, cliff −0.49 |
| 2 | the gfx layer's frame (`material.ts` uniforms bound once, `scene.ts` no key strings / attribute lists / sets a frame, hidden meshes not re-prepared) | spawn −0.74, forest −0.70, lake −0.66, cliff −0.55 |
| 3 | the driving HUD written only when it changes (the same text set again re-lays out the page every frame) | spawn −0.73 |
| 4 | garbage and small things: the character's math at offsets, the instance getter, the terrain's sort, the frustum tests, PlayCanvas's parameter walk (`OthMaterial`), the car shadow's stream written in place, the hills' answer kept per horizon | garbage 158 → 89 KB a frame; spawn under the profiler 496 → 562 fps |

Then the HITCHES, found by driving the camera down every track at 25 m/s (`tour.mjs drive`: each frame, each system):

| hitch | cause | fix |
|---|---|---|
| 20–96 ms, every tree update | the far impostors' instancing buffer (50 391 slots, ~1000 drawn) copied and sent whole (1.6 MB) at each change; the terrain's 2048 nodes every frame | buffers sized to what's drawn (grown by half), copied from where they were last copied to (`scene.ts`) |
| 1.3–5.5 ms every 4 m driven | the horizon (occlusion) rebuilt in one frame: 33 k height samples | built an eighth a frame from 2.5 m, swapped in whole; the 4 m limit kept (`Horizon.ts`) |
| 2–4 ms every ~200 frames | a garbage collection: ~150 KB of garbage a frame (the character's animation, the scene walk, the terrain sort, the horizon query …) | the hot paths allocation-free where it was easy |
| ~5 ms every ~12 s of play (the day running) | the terrain shadow's bake: 6.3 MB of textures copied twice on the main thread before the upload | the worker's arrays become the textures' data, handed to PlayCanvas as its level (`TerrainShadow.ts`, `texture.ts`): 5.2 → 3.0 ms |
| 20–60 ms for 1–2 s, every 30–50 s, uncapped | a MAJOR garbage collection (the frame it starts on, the heap drops 70–120 MB; the GPU's own time unchanged): Chrome's, after ~30 s of promoted garbage — PlayCanvas's per-frame frame graph and WebGPU objects, ~2.4 KB a frame. NOT physics (the same with it off), not the JS heap's size (its object graph is small: 730 k nodes), not the uniform staging (`queue.writeBuffer` instead: tried, no change, reverted) | **mostly a DEV-server thing**: the production build (`npm run build` + `npm run preview`) has 10–20 ms frames for ~0.5 s instead; capped to the screen (144 Hz) none in 90 s driving. Open — the next lever is PlayCanvas's per-frame allocations |

**Where it stands (dev server, ULTRA 1920 × 1080 uncapped, WebGPU, the Windows laptop):**

| view | before this round (the release build already in) | now |
|---|---|---|
| spawn, DRIVING (the car, the HUD) | 373 fps | **687** |
| forest | 509 | **782** |
| lake | 543 | **801** |
| cliff | 560 | **790** |
| rockhill | 521 | **913** |

(30 s of frames counted at each, one after the other — `abq.mjs`'s drained samples were thrown about by the
collection stall above, so the steady pace is the honest yardstick here. Before the release build the spawn was ~240.)

**The whole valley** (`tour.mjs drive`, every track at 25 m/s: 63 tracks, 30.6 km, 957 859 frames): mean **1.26 ms
(794 fps)**, 0.22 % of frames a hitch (> 2.5× the median), the worst left the collection stall. `tour.mjs sweep`
(every 150 m of track both ways + every place, 529 spots): median 1.654 ms (605 fps) mid-round. **In a visible Chrome**
(`playchrome.mjs`: the car driven with the keys, the overlay on): 614 fps over 60 s, the overlay 686 fps — frame 1.7,
CPU 1.2, GPU 1.1 ms.

## Now (2026-11-06, end of day) — `fps.mjs ultra`: mean 2.827 → **1.885 ms (354 → 531 fps)**

| view | this morning | now | |
|---|---|---|---|
| spawn (car) | 2.956 ms (338 fps) | **1.928 (519)** | ✓ |
| forest | 2.955 (338) | **1.800 (556)** | ✓ |
| lake | 3.479 (287) | 2.039 (491) | water 0.55 ms |
| cliff | 2.958 (338) | **1.896 (527)** | ✓ |
| oasis | 2.563 (390) | 2.037 (491) | water 0.2, grass 0.27 |
| plain | 2.051 (488) | **1.607 (622)** | ✓ |

(Interleaved A/B, `abq.mjs`, 4 reps, old vs new in one run: spawn −1.26 ms, forest −1.24, lake −1.58, cliff −0.78,
oasis −0.50, plain −0.60. LOW: −27 to −37 % (spawn 554 → 856 fps). WebGL2 ULTRA: −19 to −22 %. Moving at 30 m/s:
+0.02 ms. Old vs new pixel diff: 0–2.6 % of pixels > 8/255 — mostly the wind-blown grass and trees between the two
captures; checked by eye on all six views.)

What did it (each with an A/B switch):
1. **THE GROUND CACHE** (`GroundCache.ts`, `?gcache=0`): the ground's paint baked into a camera clipmap + a whole-world
   far level, the rock relief and the ripples as a normal map; the terrain reads 4–8 texels instead of painting.
2. **The leaves' depth pre-pass** (`Trees.ts`, `?treepre=0`): the near trees 0.85 → ~0.35 ms at the spawn.
3. **The rock shortcut** (`paint.ts`): where the ground is all rock, the field under it isn't painted (exact).
4. **Water** (`Water.ts`): the ripple reads skipped past 160 m (they're flat there), the foam read only on its band.
5. **Phones' tier** (`quality.ts`): the dead override fixed — phones on ULTRA draw without MSAA (it was on), cache 512.

Still to do, in order: the lake's still water (0.55 ms, spread over its whole shader — see the water section); the
oasis (its water and grass); then Phase 0 on a real phone (`phone.mjs`, written, needs a phone on USB).

## The two targets

| | where | the bar | the yardstick |
|---|---|---|---|
| **PC** | this M4 Mac, ULTRA, 1920 × 1080, uncapped, WebGPU | **≤ 2.00 ms (≥ 500 fps) on EVERY view**, not just on average | `scripts/harness/fps.mjs ultra` (GPU-drained) |
| **Phone** | a ~₹15k Snapdragon 6-series (Adreno 619 / 710) **and** a Dimensity (Mali-G57/G615 — half the ₹15k phones are MediaTek), ULTRA, Chrome | **≥ 99 % of frames ≤ 16.7 ms and p99 ≤ 20 ms, over a 10-minute drive** (the phone heated up, not fresh) | `phone.mjs` (written; needs a phone) |

## Where it started (measured 2026-11-06, commit 3a28864)

`fps.mjs ultra`: **mean 2.83 ms (354 fps)**: spawn 2.96, forest 2.96, **lake 3.48 (287)**, cliff 2.96, oasis 2.56,
plain 2.05. JS 0.5–0.7 ms a frame; 52–92 draws; 250–730 k triangles. To pass, the worst view has to lose ~1.5 ms (−43 %).

What the frame is made of (`pix.mjs`, `gpubase.mjs`, `farcost.mjs`, `ablate.mjs`):

1. **It's the pixels.** Render scale 75 % (56 % of the pixels): spawn 3.04 → 2.18 ms, lake 3.73 → 2.18. At 50 %: ~1.0 ms
   (~1000 fps). The vertex work, the triangles and the draws barely matter on the PC.
2. **The terrain is most of it**: hiding it saves 1.5 ms at the spawn, 2.2 ms at the lake (ablation; noisy at ±0.3 ms, but
   nothing else comes close). Its fragment shader (paint noise + mask + groundPaint, the rock relief, haze, specular)
   runs on every ground pixel.
3. **The far distance is cheap.** Far plane 9 km → 800 m saves 0.0 ms at the spawn and oasis, 0.25–0.44 ms in the forest,
   0.37 ms at the lake. So *hiding* far things buys little; *shading the far ground and far woods cheaply* is the form
   of it that pays (Phase 3).
4. **"Nothing drawn" still takes 0.71 ms on WebGPU** (WebGL2 1.2–1.7) — but that's mostly the CPU's frame (the game's
   JS is 0.5–0.9 ms a frame) and the browser's: with the GPU idle the CPU sets the pace. With a world to draw the two
   run side by side, so it isn't a GPU cost to cut (corrected later the same day).
5. **MSAA 4×**: +0.3–0.45 ms on WebGPU, **+1.2–1.4 ms on WebGL2** (the phones' backend).
6. **WebGL2 without MSAA beats WebGPU without MSAA** here (spawn 2.49 vs 2.72, lake 2.40 vs 3.29): Dawn's Metal vertex
   pulling (MIGRATION.md). Windows (D3D12) doesn't pay that — so A/B both backends on each platform; don't assume.
7. **BUG: phones get MSAA 4× and 2× density on ULTRA.** `quality.ts`'s phone override is `if (mobile && out.bloom)`, and
   bloom is 0 since the post pass went (2026-10-27) — so the override never runs. Only the phones' adaptive DPR
   (`main.ts`) saves them.
8. **`gpuprof.mjs` is broken**: with `bench=offscreen` it reports "nothing drawn" ≈ the whole frame and per-part costs
   ~0. Use **`abq.mjs`** (each variant in its own tab, only the front one renders, interleaved; `hide=trees.2` hides one
   draw; prints console errors — a variant whose shader failed to compile is no measurement).
9. **The terrain's shader WAS the frame** (`?tcut=flat`, a plain colour: spawn 3.45 → 2.00 ms, lake 4.33 → 1.44, cliff
   → 0.63) — and no one part of it: the paint noise 0.4–0.5, the relief 0.2–0.3, the rest groundPaint's mixing and its
   ~20 reads. Hence a cache, not a trim.
10. **Water**: drawn as a flat colour it costs nothing (blending is free); its 0.55 ms at the lake is its shader —
   depth + ownership reads 0.15, sun shade + shore 0.1, the look (sky reflection, Fresnel, glint, foam) 0.3. No one
   part dominates; the discard isn't it.

## The phone, by the numbers

Adreno 619 (Snapdragon 695): ~486 GFLOPS FP32 (~973 FP16), ~17–22 GB/s; Adreno 710 ≈ 1.4× the 619 in games
(Notebookcheck). The M4's 10-core GPU: ~4.3 TFLOPS, 120 GB/s. **~9× the compute, ~6× the bandwidth** — and in a
browser, hot, on a tiler, assume **10–15×** until Phase 0 measures it.

The budget: 16.7 ms, minus ~30 % for heat and the CPU's share → **~12 ms of GPU**, i.e. **~1.0 ms of M4 time** at
the phone's resolution. A phone held landscape at 2× density is 1830 × 824 = 1.5 Mpx (73 % of 1080p). Even the
500-fps frame (2.0 ms at 1080p) is ~1.46 ms at 1.5 Mpx → **15–22 ms on an Adreno 619**. So:

> **ULTRA on a phone = the same world, the same draw distances and the same look, rendered at ~0.7 Mpx inside the
> frame (≈ 1.35× density, or 65–70 % of 2×) and upscaled + sharpened.** Native 2× resolution at a constant 60 on a
> Snapdragon 6 isn't reachable with this look, and the plan doesn't promise it. The adaptive resolution
> (`main.ts`) stays as the safety net under heat.

## The tools (what each is for)

| tool | for | |
|---|---|---|
| `fps.mjs`, `ablate.mjs`, `pix.mjs`, `farcost.mjs`, `gpubase.mjs` | the PC scoreboard and the cost of each part | here; one window, nothing else running, plugged in, interleaved A/B |
| **`abq.mjs`** | THE A/B tool: `"|gcache=0|hide=water|tcut=flat"` — each variant in its own tab, interleaved | here |
| `movecost.mjs` | what moving costs (the cache's re-bakes): mean / p99 / max still vs flying at N m/s | here |
| **`phone.mjs`** | the phone scoreboard: `fps.mjs`'s views on a real phone over USB (`adb forward tcp:9222 localabstract:chrome_devtools_remote` → `puppeteer.connect`): p50/p95/p99, % frames > 16.7 ms, a 10-min heat run | adb is installed (`~/Library/Android/sdk`) |
| **Android GPU Inspector** (Google) | Adreno / Mali GPU counters: fragment vs vertex vs binning, bandwidth, overdraw | free; works on Chrome |
| **Perfetto** | CPU clocks, heat throttling, Chrome's trace on one timeline | built into Android |
| **Arm Performance Studio** (Streamline) / **Snapdragon Profiler** | deep counters on Mali / Adreno | free |
| **PerfDog** (Tencent) | fps, frame time, CPU / GPU / heat on several phones at once from the Mac, no root | paid; optional — `phone.mjs` + AGI cover it |
| Chrome DevTools (`chrome://inspect`) | the phone's JS / CPU frame | its GPU times are unreliable on phones |
| `?stats=1` / F3 (MiniStats) | a live look | |
| **PERF MARKS** (F9 in game, `?perfmark=1`; `src/oth/PerfMarks.ts`) | the spots where the frame rate FALLS as you play — a half second ≥ 1.5× the run's usual frame (and < 450 fps), or one stall ≥ 6× / 40 ms — marked with the camera's place and look, the frame vs the usual, the CPU's and the GPU's share, what was drawn; red ✕ on the map (Tab); `__oth.perfMarks()`, Shift F9 clears | in any browser — a player's own marks: `copy(JSON.stringify(__oth.perfMarks()))` |
| **`perfmarks.mjs`** | `drive`: the car carried along every track on the chase camera (ZOOM m back) with the marks on → a JSON; `why`: each mark flown back to, each part of the world hidden in turn — the cause | here |

Several windows at once are fine for CHECKING (browsers, phones), never for MEASURING: they share one GPU.

## The plan, in order (each step: interleaved A/B, `fps.mjs ultra` + LOW + `phone.mjs`, a `shot.mjs` look, a row in the log below)

### Phase 0 — tools and the truth on a phone (first)
**Status 2026-11-06:** the tools are written (`abq.mjs`, `movecost.mjs`, `phone.mjs`); the phone run waits for a phone on USB. `gpuprof.mjs` still broken.

1. Buy / borrow **one Snapdragon 695 / 6 Gen 1 phone** (Adreno 619 / 710, e.g. a Redmi Note / Poco / Galaxy M at ~₹15k)
   and, if possible, one Dimensity one (Mali).
2. Write **`phone.mjs`**; run today's build at ULTRA on it → the real phone : M4 ratio (replaces the 10–15× guess),
   and what AGI says the phone's frame is (fragment? binning? bandwidth?).
3. Fix `gpuprof.mjs` (or retire it); `ablate.mjs` ×8 reps for ±0.1 ms.

### Phase 1 — the phones' tier, today's bug (small, big on phones)
**Status:** step 4 DONE (no MSAA on phones' ULTRA, cache 512); 5–6 need the phone's numbers first.

4. Fix the dead override: on phones, ULTRA = no MSAA on WebGL2 (unless the phone shows its tiler resolves 4× for
   free — measure), the leaf cards alpha-test, the pixel-ratio cap from Phase 0's numbers.
5. **Render scale + upscale on phones**: PlayCanvas 2.23's `CameraFrame` has `rendering.renderTargetScale`,
   `sharpness` (a CAS-style sharpen) and TAA — or our own one-pass bilinear + sharpen into the canvas (cheaper: no
   HDR target). The start point is ~0.7 Mpx, then adaptive within 0.5–0.9 Mpx. A/B `CameraFrame` vs our pass on the phone.
6. A/B **WebGPU vs WebGL2 on the phone** (Chrome enables WebGPU on Adreno 6xx+ / Android 12+); pick per GPU family.

### Phase 2 — the terrain's pixels (the biggest PC win: −0.8 to −1.2 ms)
**Status:** 7–8 DONE, bigger than planned — the GROUND CACHE (−0.5 to −1.6 ms a view); 9 (f16) not yet — a phone matter.

7. **Bake the ground's paint into a camera-following texture** — the grass field's trick (`Grass.ts`): the noise +
   mask + groundPaint per texel, re-baked only where a move uncovers ground; the fragment reads 1–2 texels instead of
   ~20 noise taps. Two rings (fine near, coarse far), like a clipmap.
8. **Shader LOD by distance** (the "hide far" that pays): past ~150 m no rock relief, no detail noise, no specular — the
   haze already hides them; past ~1.5 km one texture read + haze. A branch on distance, coherent per tile.
9. **mediump / f16** in the terrain, grass and tree shaders (phones run fp16 at 2× the rate; the M4 doesn't care).

### Phase 3 — overdraw, the far woods, water
**Status:** 10 DONE for the trees (the leaves' depth pre-pass; the terrain already drew last); 11 not needed (`farcost.mjs`: little to win, and the far level now paints the far ground for 4 reads); 12 partly — the cheap reads; the lake's still water is next.

10. **Draw order and early-z**: near opaque things first (car, rocks, tree trunks), then the terrain, then alpha-tested
    leaves / grass, the sky last — so hidden ground is never shaded. Measure overdraw with AGI on the phone.
11. **The far woods into the ground**: impostors past ~600 m become a colour + a darkening in the terrain's far paint (the
    forest as a texture); far rocks the same. (`farcost.mjs`: ≤ 0.44 ms is the most the far distance can give back.)
12. **Water** (~0.6 ms at the lake, noisy): ablate it at ×8; a cheaper reflection / its depth fade.

### Phase 4 — the fixed cost and the anti-aliasing (PC)
**Status:** 13 was a misreading (the empty frame is the CPU's pace — finding 4); 14 open: MSAA is 0.1–0.45 ms a view.

13. The 0.71 ms empty frame: an opaque canvas (`alpha: false`), no DOM layer composited over the canvas when the HUD is
    idle, MiniStats off, transient MSAA (done).
14. **ULTRA's anti-aliasing**: MSAA 4× (+0.35 ms) vs 2× vs `CameraFrame` TAA — A/B cost and look. The ULTRA look
    stays; the way to get it may change.

### Phase 5 — the CPU and the draws (for the phone, whose CPU is ~4–6× slower: 0.6 ms of JS here ≈ 3 ms there)
**Status:** not started; the JS is 0.5–0.9 ms a frame here.

15. `cpuprof.mjs` on the phone; `MeshInstance.setMultiDraw` (WEBGL_multi_draw / indirect) for trees, rocks, props;
    on WebGPU, culling on the GPU (`Compute` + `setIndirect`) for the trees and rocks.

**Where that should land (estimates, to be proven)**: the lake 3.48 − terrain 1.1 − far 0.3 − water 0.3 − fixed / AA 0.2
≈ **1.6 ms**; the spawn 2.96 − terrain 0.8 − order / far 0.2 − AA / fixed 0.2 ≈ **1.75 ms**. Phone: that frame at
~0.7 Mpx ≈ 0.6 M4-ms × 10–15 ≈ **6–9 ms** on an Adreno 619 — inside the 12 ms budget, with room for heat.

## Log

| date | change | PC ULTRA mean / worst (ms) | phone (p99 ms, % > 16.7) | commit |
|---|---|---|---|---|
| 2026-11-06 | baseline | 2.83 / 3.48 (lake) | not measured yet | 3a28864 |
| 2026-11-06 | ground cache + far level + normal map; leaves' pre-pass; rock shortcut; water reads; phones' tier | 1.885 / 2.039 (lake) | not measured yet (no phone) | — |
| 2026-11-06 | the small shapes' light (`?shape=0`: the fields' bumps and hollows visible — a look change the user asked for) | 1.929 / 2.166 (lake) — +0.05–0.2 ms | — | — |
| 2026-11-06 | the broadleaf matched to the valley (crown volume, colours, bark, crown shapes, 8–16.5 m) — its leaf cards OCTAGONS (a quarter fewer cut-out pixels: pays for the bigger crowns); the leaves' depth pass without its early return (WebGPU's naga compiles it, no fallback) | birch grove −0.02, aspen −0.03, spawn −0.03 ms (interleaved, frozen before/after copies); the bigger crowns alone were +0.15 ms on square cards | — | — |
| 2026-11-06 | the trees' SEE-THROUGH (Trees.seeThrough, `?see=0`: Over the Hill's — the foliage in a cone from the camera to the car cut away, dithered rim, trunks kept; part of the leaves' cut-out in the depth pre-pass). First cut, every leaf pixel tested: +0.25 ms at spawn; now each tree tested once per vertex (its crown against the cone, flagged in vFol) and only those trees' leaves per pixel | spawn +0.00 (2.382 vs 2.401 off) | — | — |
| 2026-11-06 | the spruce / larch past the near ring as IMPOSTORS, not the mid LOD (`?treemid=geo`: as before) — the user: the impostor (the near LOD's own picture) reads fuller; 2 triangles a tree, not ~480 | forest −0.16, spawn +0.01, lake 0.00, cliff +0.08 ms (noise) | — | — |
| 2026-11-06 | the valley's places (Kit / Locations / Sites; ARCHITECTURE.md "stage 2"): composed cabins, mine, camps, tunnel, grotto, ghost house, ruins, hamlet …; the caves' dark; smoke columns; landmarks cut past the tier's reach (`absites.mjs`, `?sites=0`) | calm, interleaved: 0.768 → 0.787 (≈ 1270 fps); every place 0.70–1.05, worst the Hollow House in deep forest 1.30 (770 fps); the caves' dark +0.01 | LOW phone viewport 0.593 → 0.627, worst 0.82 (no phone) | — |
| 2026-11-06 | every valley track DRIVABLE (`trackgrade.py`: the lines cleaned and re-traced for a 7.5 m turn, the ground graded ≤ 22 % / ≤ 28 % rock-crawl, level across; `Rocks.ts`: outcrop blocks out of the beds) — the bot (`trackdrive.mjs`, every track both ways) clean on 46 → 121 runs, 465 → 21 problems | spawn +0.07, forest −0.05, lake −0.08, cliff −0.06 ms (noise: a data change; the stones / trees re-picked on the new ground); load +~1 ms (the rock filter) | — | — |
| 2026-11-06 | the caves as land (tunnel hill, three one-way caves; cavecost.mjs, ?sites=0) | ULTRA 1080p: +0.02–0.14 ms at a cave, worst 1.34 (745 fps, deep forest; 1.67 without the sites) | LOW: +0.01–0.18, worst 1.03 | — |
| 2026-11-06 | the caves' rock round 2 — FACETS not plaster (`rockMesh` / `hillMesh`: pushed by `rockField`, flat-shaded; `rockPaint`: no beds, moss; `rockRelief` on the cliff HIGH / ULTRA). Measured on the WINDOWS PC (slower than the Mac: baselines 2.3–3.6 ms), `cavecost.mjs`, the original two files swapped in for the "before" run; triangles +~1 k a cave | ULTRA: the caves over `?sites=0` +0.14–0.34 before, +0.05–0.26 after: no measurable cost (the run-to-run noise at a view with no cave, spawn, was 0.19 ms). LOW: unresolved — the `?sites=0` baseline itself moved up to 0.8 ms between runs; "on" 2.59–3.69 before, 2.62–3.75 after (the LOW rock reads 3 paint fetches, was 6) | not measured (no phone) | — |
| 2026-11-06 | no grass on stone: the grass bake reads the ground's normal at mip 0 (was 2.5 — the terrain paints with mip 0 up close) and stops short of scree (`screeNear`) | no frame cost: the bake re-runs only the texels the camera uncovers, the same fetches (one mip, one smoothstep more) | — | — |
| 2026-11-06 | the rock's relief LIVE on every rock pixel (the cache stores its strength, no longer the baked bend — that came out weaker than the live walls': the user's patchy rock). Everything else the ground cache does is as it was | Windows PC, `abq.mjs` ABBA `"|tcut=ncr|tcut=ncr|"` × 4 (ncr: a temporary switch, the relief off on cached ground — the cost of exactly this; removed after): rockhill (a new view: the user's rock hillside, -864.6 / -449.9) 2.821 live vs 2.853 without, forest 3.164 vs 3.215, spawn 4.423 vs 4.361, cliff 2.829 vs 2.756 — no measurable cost (±0.07, this PC's noise). The bake no longer runs the relief: lighter. Re-run on the Mac mini to confirm 500+ | phones: not compiled (no relief there) | — |
| 2026-11-07 | the CPU's frame and the hitches (the Windows laptop): PlayCanvas's release build in dev; the gfx layer's frame; the HUD's DOM; instancing buffers sized to what's drawn; the horizon a slice a frame; the garbage 158 → 89 KB a frame; the shadow bake's copies — all pixel-identical (`pixdiff.mjs`) | spawn driving 373 → 687 fps, forest 509 → 782, lake 543 → 801, cliff 560 → 790, rockhill 521 → 913; the valley drive 794 fps mean | not measured (no phone) | — |
| 2026-11-07 | Chromebooks / integrated GPUs: a weak GPU recognised by name → ULTRA the phones' way (MSAA 2× — +0.65–0.70 ms on the M4 against off, 4× +1.0–1.1 —, cache 512, no relief, ≤ 1 px/CSS px, WebGL2); adaptive resolution on every device (per-second average, two slow seconds, a try-up on 60 Hz screens) | M4 with `gpu=weak` forced: −55 to −62 % (spawn 4.74 → 1.91 ms) — a busy machine, re-measure; the PC way unchanged (`gpu=full` / not weak), the adaptive resolution never moves at 500 fps | not measured (no phone / Chromebook) | — |
| 2026-11-07 | THE CAVE WORLD (Blender's, CaveWorld.ts) replaces the four procedural caves: 54 k turf + 128 k rock + 1 k garden triangles, ~45 k tufts / stones; the inside drawn only from in / near it; no cave dark on the terrain and boulders any more; the car takes it | abq `|cave=0` (M4, ULTRA 1080p): in front of it −0.71 ms, in the great hall −0.43…−0.52 (the hill hides the land behind), over it from 120 m up +0.42 (its turf shader over much of the screen); spawn ±0.03. LOW: front −0.34, hall −0.82, above +0.23. Load: cave.glb 0.5 MB, ~100–130 ms | not measured (no phone) | — |
| 2026-11-07 | GROVES (Groves.ts): 151 groups of 5–10 trees and their bushes (~1 070 trees, ~750 bushes) | abq `|groves=0`: spawn +0.016, lake +0.044 ms (noise); the forest view's run was thrown by a stall | not measured | — |
| 2026-11-07 | THE CAVE WORLD round 3: taller, a second skylight, 3 ponds, ~30 trees, ~110 bushes, ~2 600 tufts, ~60 % grass inside; the field's grass on its hill (Grass.setHill, the tiles' boxes on it) | abq `|cave=0` (M4, ULTRA 1080p, a busy machine — spawn 5.1 ms): front −0.43, inside the great hall +0.62 (was −0.43 before the growth), above +0.60, spawn ±0.00. Load ~350 ms (cave.glb 0.83 MB, bones.glb 0.2) | not measured | — |
| 2026-11-07 | THE CAVE WORLD round 4: twice the height (184 k rock triangles), the hill painted from the land's mask, the turf's smooth transitions. Found on the way: the inside's tufts / bones / props mesh (122 k triangles) was drawn ALWAYS — now hidden with the inside; "in front of the mouth" counts only low enough to see in; the inside drawn after the turf from outside (renderOrder); the outside hill reads its paint from above only; the rock's 6-fetch paint only where it shows | abq `|cave=0` (M4, ULTRA 1080p): front +0.03, great hall +0.66 (+1.9 before the fixes), above +0.35 (+1.7 before; round 3 +0.60), spawn +0.04 | not measured | — |
| 2026-11-08 | FIRST SIGHT (the PERF MARKS drive, `perfmarks.mjs drive`, ZOOM 40 — the user: "sudden fps drops at places"): (1) the PlayCanvas port's `compileAsync` was a stub — every material's shader and WebGPU pipeline was made the first time it was DRAWN (30–60 ms each, one per new kind of thing coming into view); now THE WARM-UP (gfx/scene.ts): every mesh's material layout warmed once — 61 in the valley, behind the loading text (12 a frame), then 1 a frame for what's added (the crossing's world: `compileAsync` adds its group hidden); on WebGPU the warm draw is a `createRenderPipelineAsync` (Dawn compiles on a worker, the real draw finds the finished pipeline — the blocking compile of the desert's big shaders had stalled the GPU process ~0.3–1.1 s at a time near the pass). (2) the shore / paving picks allocated arrays and closures each frame — now none. Static views unchanged: at the user's Copper Mine meadow the frame is CPU-bound ~2.3 ms headless, its GPU 0.88 ms | the pass approach (452, −1071): stalls 1110 / 520 / 336 / 233 / 101 / 254 ms → 112 / 242 ms (the desert's build steps — `rocks` 151 ms one step; left); valley drive marks: see below | not measured | — |
