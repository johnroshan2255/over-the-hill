# PERF — 500 fps on the PC, a constant 60 on a Snapdragon 6-series phone, both at ULTRA

The user, 2026-11-06: *"i want to get 500 fps uncapped … make a plan to get 500+ fps so even snapdragon 600+ phone
will give const 60+ in ultra"*; *"we can hide things from far"*; *"do all the steps … even more graphics webgames get 800 fps"*; *"the trick is to
preserve the visual appearance while reducing the actual rendering cost"*; *"check the cheapest way to create water"*.
This is step 8 of `MIGRATION.md`, with the phone made a goal of its own.

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
