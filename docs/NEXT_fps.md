# NEXT — the fps drops along every way (hand-off, 2026-11-17, stopped mid-way)

The user: "we have a tool that goes all the paths and marks places where we drop fps — check that tool, walk all the
paths and fix the places where we experience fps drops." This is where it stands: the tool made fit for it, three
things fixed (one of them a leak that crashed long drives), the first full drive's marks in, their causes not yet
found. Rules as ever (CLAUDE.md, the memory): measure, look, no picture change without the user's say.

## 1. The tools (frontend/scripts/harness)

| tool | what | run |
|---|---|---|
| `perfmarks.mjs drive <file>` | the car carried along ways at SPEED m/s on the zoomed-out chase camera, the in-game PERF MARKS on (`src/oth/PerfMarks.ts`): every half second ≥ 1.5× the usual frame ("slow") and every single frame ≥ HITCHMS ("hitch") marked with where, what was drawn | `SET=all SPEED=28 node scripts/harness/perfmarks.mjs drive marks.json` (~2.5 h for all 252 ways) |
| `perfmarks.mjs why <file>` | each of the worst marks flown back to; every part of the world hidden in turn: the GPU's frame with / without it | `TOP=12 node scripts/harness/perfmarks.mjs why marks.json` |
| `hitchprof.mjs [way] [s]` | NEW: one way driven with Chrome's sampling profiler on; the samples inside the long frames summed by function and by the game's call chain; per long frame the ground cache's texels and the heap (a drop = a GC) | `LONG=70 SET=tracks node scripts/harness/hitchprof.mjs 0 60` |
| `leakprof.mjs <ways>` | NEW: ways driven with a forced GC after each (the heap that's really kept) and the sampling heap profiler: what's still alive, by the game function that allocated it | `SET=roads node scripts/harness/leakprof.mjs 13,14,15,16,17` |

What changed in `perfmarks.mjs`: `SET` (tracks — the valley's | roads — the outland's | paths — the narrow ways |
all; it only drove the valley's tracks), the marks written after EVERY way (a crash lost them all), a crash → a new
browser and on from the next way, the JS heap logged per way, `HITCHMS` (70), and the browser closed when the script
is stopped.

**What bites (each cost me a wrong conclusion):**
- **Orphan browsers.** Stopping a harness's node used to leave its headless Chrome rendering, uncapped, under every
  later measure (two of them at 125 % CPU each). All three scripts close it on SIGINT / SIGTERM now — still check:
  `pgrep -f puppeteer_dev_chrome_profile` must print nothing before a measure.
- **Headless Chrome's own frames.** Uncapped, it gives a ~46 ms frame about twice a second STANDING STILL — not the
  game. A hitch below ~60 ms there means nothing; the harness runs at `hitchms=70`.
- **`why` read ~6 ms high** until 2026-11-18 (`gpuDone`'s constant late answer — docs/PERF.md 2026-11-10; now `pace.mjs`).
- **GPU timing.** `renderer.gpuTime()` switches PlayCanvas's GPU profiler on for good: timestamps on every pass of
  every frame → 66 stalls of 70–94 ms a minute. The marks no longer turn it on (`?perfgpu=1` to have it).
- **The heap figure mid-drive** (900–1500 MB) is garbage not yet collected — `leakprof.mjs` forces the GC; trust it.
- Don't edit `src/` while a drive runs (Vite reloads the page — the memory note).

## 2. Fixed (2026-11-17, committed with this file)

| what | the proof |
|---|---|
| **A MEMORY LEAK** — `gfx/geometry.ts addUpdateRange` kept every range it was handed and nothing ever read or cleared them; the grass's rings and the terrain's nodes call it every frame (~1 600 objects a second) | `leakprof.mjs` over 17 km of outland road: the heap after GC 576 → 604 MB before, 576 → 573 after. The long drives' growing GC pauses and the page dying at ~1 h (way 88) were this |
| **The marks marked themselves** — `main.ts` turned the GPU profiler on whenever the marks were on (also for a player with F9) | `hitchprof.mjs`, track 0, 60 s: marks + GPU timing 66 frames ≥ 70 ms; marks without it 1; marks off 2 |
| **Audio params every frame** — ~12 `setTargetAtTime` / `.value =` a frame; now only when a value moves enough to hear (`glide`, `setParam` in Audio.ts) | clean A/B: no fps difference on the Mac (2.40 ms median either way). Kept: harmless, fewer calls into the audio thread — may matter on a phone. (An early "5.0 → 2.8 ms" was an orphan browser leaving, not this) |

The clean baseline after them, track 0 driven at 28 m/s, ULTRA 1080p uncapped: median 2.4 ms (~415 fps), 1–2
frames ≥ 70 ms a minute.

## 2b. 2026-11-18 — the first drive's marks were mostly the DESERT; the crossing's build stall fixed

**76 of the 106 marks weren't the valley.** A way passing the Great Cliff's gate (1102, −1990) crossed into the desert
world (Crossing.ts: the swap), and every way after it was driven in the desert at the valley's coordinates — that's
"Lead 2" (no trees drawn, a 1.4 ms usual frame: the desert's) and three of the four "rim" hitches (the desert's box
edge). The marks say so (`world: "desert"`). (Then `Crossing.hold` kept the drive in the valley — since 2d there is
no desert to go to.)

**The crossing's build: one frame of 687 ms**, 1 100 m from the gate (BUILD_AT — the valley's 113 ms mark at
480, −1093 was it). `renderer.compileAsync` joins the new world to the scene HIDDEN for its shaders' warm-up, and
`Scene.sync` made every one of its meshes in that first frame: `prepare` (PlayCanvas meshes, every vertex buffer
written) for each hidden mesh never made — both in `walk` and in the warm-up's `tryWarm` (that one had no budget at
all). Now a hidden mesh never made is made within `HIDDEN_MS` (2 ms) a frame, the rest next frame (`warm.hidden` —
`compileAsync` waits for it); a mesh SHOWN is made at once, as ever. `hitchprof.mjs` FROM=60 on track 66: 687 →
233 → **78 ms** (what's left: one 681 KB mesh alone ~30 ms, a warm-up's createShaderModule). pixcmp against the
commit before: forest, cliff, oroad, town, boxedge, caveFront ≤ 2 of 255 (the noise); spawn noisy in itself (old vs
old max 60).

**The outland's big hitches (road 57 at 4058, 3026 ×3; road 55 at 5683, 1983) don't come back**: hitchprof over
them shows only 66–71 ms frames — headless Chrome's own GPU waits (`(program)`, `getCurrentTexture`, no game code),
the same as on track 0 far from everything.

**Then the build's own steps** (`crossbuild.mjs` — deleted with the desert, 2d: the car put near the gate, every frame timed until the desert
is ready, the build's step timings, a CPU profile inside one function): the frame the map arrived in was 114–123 ms —
the `rocks` step, 61–66 ms in ONE frame, 36 ms of it `stampRock` (the desert's 12 k big stones' footprint discs,
millions of cells). The stamping is now `Rocks.stampFootprint()`, a generator World.build runs `sliced` (6 ms a
frame) right after `rocks` — the same bytes (a max over the rocks; `Math.sqrt` vs `Math.hypot` checked too: identical,
but no faster there). That frame 123 → **84 ms**; `rocks` itself 27 ms. The other frames of the build (40–57 ms) are
at headless Chrome's own floor (the same 52 ms frame comes BEFORE the build starts). pixcmp vs the commit before:
forest, omeadow, orocks, rockhill, lake ≤ 2; the desert's two views 0–1; spawns noisy in themselves (old vs old 37).

**The crossing's build, in all: 687 → ~84 ms worst frame.** Left: `compile` (the warm-up, ~0.9 s spread over frames:
a 50–80 ms frame now and then — one big shader's naga + createShaderModule), `placing trees`, `placing bushes`
(already sliced).

`hitchprof.mjs` now: `FROM` (start part-way along the way), each long frame's own top call chains (`ROWS`).

## 2c. 2026-11-18 — the drive again, every way, the valley held (`docs/perf/marks_2026-11-18.json`)

All 252 ways in 2 h 18 min, every mark in the valley world: **83 marks — 45 hitches, 38 slow** (the first drive: 106
over 141 ways, 76 of them the desert's).

- **The hitches are at headless Chrome's floor**: 36 of the 45 are 70–80 ms. Headless Chrome on this Mac gives 1–2
  frames ≥ 70 ms a minute anywhere (track 0, far from everything) — over 138 min that's more frames than the marks.
  A game stall would come back at its place: re-driven with hitchprof, road 13 (138 ms), road 7 (105), road 9 (95),
  road 57, road 55 — none did (0–1 frames ≥ 80 ms, `getCurrentTexture` / `(program)`: GPU waits, no game code).
  The one that does come back is 480, −1093 ×2 (110 ms) — the crossing's build, fixed above after this drive.
- **The slow marks are mild**: 36 of 38 at 3.5–5 ms against a usual 2.3 (still 200–280 fps). The two big ones
  (−2097, 1107: 9.2 ms; −918, 3391: 8.7 ms — narrow paths) are NOT slow standing there: 2.4 ms from the first half
  second after arriving. `why` said 10.5 ms there — `why` was reading `gpuDone`'s constant (above).
- **The page died once** (way 131, ~1 h 40 min in, the heap mid-drive ~920 MB); way 131 alone drives fine. A run
  that long is what kills it — see Lead 4 below.

## 2d. 2026-11-18 — the memory, and THE DESERT DELETED

**The leak the long drives died of: the crossing.** `leakprof.mjs` over all 69 outland roads (a forced GC after each),
the process memory logged every 30 s: the heap after GC stepped +124 MB (road 3), −70 (road 4), +122 (road 7), −69
(road 8), +53 (road 21), +54 (road 61) — 577 → 794 MB. Each step was the desert BUILT behind the play (a road within
1 100 m of the gate) and let go (1 600 m away): ~52 MB of it never came back, every time. The full drive passes the
gate again and again; the page died at ~1 h 40 min (way 131 — which alone drives fine). The renderer's and the GPU
process's memory stayed flat (690–770 MB, 260–350 MB) — it was the JS heap.

**Then the user: "delete the desert and the path to desert"** — chosen: the gate only (the Great Cliff and its ledge
road kept, the valley's picture unchanged). Gone: the desert world (`public/oth/desert`, 23 MB; `scripts/oth/desert*.py`),
`Crossing.ts` (→ `PassMist.ts`: only the cloud on the pass, the same), `Formations.ts`, world swapping
(`swapTo`, `World.adopt` / `dispose` / background builds), the map's desert tab and route-via-the-pass, the sandstorm,
the desert's grade, palms, slab stacks, sculpted stones, scrub, props and sounds, every `map.desert` branch and the
`OTH_DESERT` / `OTH_STACK` / `SAND` shader branches; the harness's `crossbuild`, `crosstest`, `swaptest`,
`desertshot`, `desertcost`, `oasisshot`. Every seeded placement draws as it did (each removed branch checked: no `rnd()`
call the valley made is gone). **pixcmp vs the commit before, 10 views: within ±2 everywhere; the only change the
compass's ⇑ for the gate.** A drive through where the gate was: the cloud as before (0.97 at the top), no errors.
(The fixes above for the crossing's build — `HIDDEN_MS`, `Rocks.stampFootprint` — stay: they help any world joined
hidden, and the load.)

**What holds the memory now** (`memmap.mjs` — new: every object reachable from `window.__oth` walked, each
ArrayBuffer charged to the path it was first met by): the heap after GC ~547 MB; ~360 MB of it in ArrayBuffers:
- PlayCanvas's own CPU copy of every vertex / index buffer (`device.buffers[].storage`): **~64 MB** — the same data as
  our geometries' arrays (`scene.inLayer` … `geometry.attributes`: ~70 MB). On WebGPU the copy is only read when a
  buffer is written again (`Mesh.update`, `writeStreams`) — droppable after upload, re-made from the geometry before
  any later write (a mesh that ever needs it: keep its copy). WebGL2 keeps them (context loss restores from them).
  **DONE — LEAN BUFFERS** (`scene.ts`: `lean` / `unlean` / `refill`; `?lean=0` the A/B): the copies 63.6 MB → ~0,
  **the heap after GC 545 → 478 MB**. pixcmp lean vs lean=0, 10 views: ±2 (the caves 0). `abq.mjs` spawn / forest /
  oroad: ±0.1 ms (the noise). `leancheck.mjs` (new): a 20 s drive (the changing meshes re-made and kept) and a LOST
  DEVICE (`renderer.loseDevice()` — PlayCanvas's own recovery) — the same pictures as lean=0, no errors.
  FOUND THERE (not the lean buffers' — lean=0 the same): after a lost device the ground comes back BLACK, the grass and
  most trees gone — the bakes (the ground cache's clipmap, the grass field, the impostor atlas …) aren't redone on
  'devicerestored'. A phone's browser does lose its GPU (backgrounded, memory pressure): worth fixing.
- PlayCanvas's uniform staging buffers: ~21 MB.
- the map's grids: far 40 MB, roads 18 MB, trails 16 MB, inner heights 16 MB …; trees' data 12.7 MB, bushes' 7.8 MB.
- ~187 MB of plain JS objects (rocks' `Inst` objects, ~56 k; the rest).

## 2e. 2026-11-18 — the memory mapped whole (the user: "check where we can cut memory and make it like 100–200")

Tools (new): `heapsnap.mjs` (a heap snapshot after a GC → a file), `heapsum.mjs` (it summed by kind, the biggest
objects), `heapwho.mjs` (WHO HOLDS IT: a breadth-first walk from the roots, one kind's bytes summed by the names on
the way — `KIND="string "`, `"heap number"`, default the ArrayBuffers). Measure the PRODUCTION build (`vite build`,
`vite preview --port 4173`, `PORT=4173`): the dev server's source maps and unminified sources are ~40 MB of its own.

**Cut today (production, the heap after GC 434.5 → 404.3 MB; the snapshot's total 537 → 452 MB):**

| what | MB |
|---|---|
| glslang + twgsl (the fallback GLSL → WGSL pair) were loaded once the game played, for shaders naga has never failed on (checked: cave, town, cliff, outland, lake, night, rain — none). Now loaded only if naga isn't there, or once it has failed (`localStorage oth.wgslFallback` → from the start of every session after), or `?fallback=1` | ~39 |
| the cave's mesh builders (`Bridges.Builder`: ~0.55 M vertices as plain number arrays) lived on in `CaveWorld`'s scope (`wallAt` closes over it) → `Builder.free()` | ~17 (+ their boxed numbers) |
| `World.build`'s `treeAll` (every tree's 8 numbers, a second time) lived on in the build's scope → let go after `dressHills` | 12.9 |
| PlayCanvas's uniform staging pool: the load's bakes leave ~215 idle 100 kB buffers, mapped (not in `usedJSHeapSize`; as much again on the GPU) → `renderer.trimPools()` every 20 s, from the frame's start (`?trim=0` the A/B): 215 → 16. No more long frames with it than without (hitchprof, 50 s each: 8 vs 10 ≥ 60 ms) | ~20 + ~20 GPU |

pixcmp vs the commit before, 9 views (the caves too): ±2, the caves 0.

**Then the static meshes (the user: "yes do it") — the heap 404.3 → 356.0 MB:**

- **RELEASED GEOMETRIES** (`gfx/scene.ts`, `gfx/geometry.ts`; `?release=0` the A/B): a geometry marked `releasable`
  lets go of its own arrays once its mesh is lean — the GPU then has the only copy. Marked: what `splitMeshes` builds
  (the landmarks', the bridges', the wonders' parts), `Buildings.buildPlaces`' merged models, the cave's meshes (at the
  end of `CaveWorld.load`). The scene's geometry arrays 70 → 19 MB. Counts and bounds are kept; a later mesh of the
  same geometry (or another material's with the same vertex slots) draws from the same PlayCanvas mesh; a read of a
  released array gets an empty one, a console error with the stack, and `window.__othReleasedReads` counts it.
  Also fixed there: a second mesh sharing a lean geometry had its copy made again for nothing.
- **A LOST DEVICE RELOADS THE PAGE** (`main.ts`, `renderer.onDeviceLost`): the journey saved, CONTINUE asked, the
  page reloaded — at once, or when a hidden tab is shown again; three losses in two minutes: no more reloads, a
  message stays. (Nothing on the GPU could be put back: the released arrays, the lean copies — and before any of
  this a restored device drew a black ground.)
- pixcmp release vs `release=0`, 13 views (towns, paved places, the fort, the giants, the caves, a bridge): ±2, the
  caves 0. `leancheck.mjs` (rewritten): a drive, the cave, a town, the fort, a bridge, night and rain — 0 released
  arrays read, no errors; the device lost → reloaded, the car 0 m from where it was (twice); the third loss → the
  message, no reload.

**Then the remaining safe steps (the user: "do the remaining safe steps") — the heap 356.0 → 319.6 MB:**

- **The WORLD's heights 16-bit** (`MapData.HeightGrid`: `far.h` is null; `at(k)` and `sample` decode the height
  texture's own Uint16 — `Math.fround(raw × kq + min)`, the very float `mapPrep.heightsOf` stored): −16 MB. The BOX
  keeps its Float32 `h` (`BoxGrid`): the cave and the claims write heights finer than 16 bits into it.
- **The box's 16-bit copy let go once on the GPU** (`inner.dropRaw()`, with the pool's trim; `Texture.releaseData` —
  WebGPU): −8 MB. `rawData()` makes it again for whoever writes it (the claims' edits, the cave): `h` rounded as they
  round it — and NOT where the drawn ground isn't the heights' own: **the cave's hill, 9 539 cells up to 77 m apart**
  (the hill is a mesh; the land under it is drawn as it was) — `dropRaw` keeps those cells' numbers (13 ms, once).
  Checked in the page: made again = the old array at all 4 198 401 cells.
- **The Wardens' pieces let go** (`Wardens.pieces`: a Map of the vaults' doors and keystones — the only ones that move
  after the build; the plan's list emptied): 87 595 objects of ten numbers, −12 MB. A vault opened in the old build
  and the new, four sides: the same picture (8 px of the HUD's GPU badge apart).
- NOT done — the rocks (56 708 `Inst`) and the props (47 866) as typed arrays: measured, they're ~13 MB as objects and
  would be ~7 MB packed as Float64 (Float32 would move them by rounding) — ~6 MB for a rewrite of everything that
  reads a rock. The earlier "−35 MB" guess for this row was wrong: most of it was the Wardens' pieces, now gone.
- pixcmp vs the commit before, 20 views (the box, the outland's roads / meadows / rocks / snow / canyon / gorge /
  tarn, the towns, the fort, the court, the ring, the giants, the caves, the box's edge): ±2, the caves and the edge 0.
  `leancheck.mjs`: as before (0 released reads, the reload lands 0 m away). An outland road driven: 1 frame ≥ 70 ms
  in 40 s.

**What holds the rest (production, 404 MB before the two steps above — 320 MB now):**

| what | MB | can it go? |
|---|---|---|
| the map's grids, each READ BY THE GAME'S CPU CODE at run time: roads 18 (3072² RG), trails 16 (RGBA), heights 16 + 16 (Float32, box + world), the world's normals 16, the box's 8, the two height textures' own copies 8 + 8 (R16UI), mask 4, far track / river distances 4 + 4, water 4, mud 2 | ~125 | the height textures' copies (16): yes — made again from the heights when a claim edits the ground. Heights as the 16-bit they came as, not Float32 (16): yes, bit-identical, ~30 call sites. The rest: only at a coarser CPU grid (a placement / physics change) |
| the static meshes' vertex data — landmarks 30, the cave 14, bridges 7 | ~~51~~ | DONE (above). Left: the car 4, the rest ~15 (shared / changing geometries) |
| Rapier's WebAssembly memory | 29 | no |
| trees' data 12.7, bushes' 7.8, the Wardens' and rocks' instance matrices 9, footprints 8, the shadow's textures 6, other textures' copies 9 | ~55 | some: the Wardens' matrices and the footprint's base are derivable |
| the Wardens' 87 k pieces and the 57 k rocks as JS objects (boxed numbers 19, objects 10, arrays 17) | ~46 | yes → typed arrays; a refactor of Wardens.ts / Rocks.ts |
| strings: shader sources ~13 (PlayCanvas keeps each shader's GLSL three times), Rapier's base64 4, the rest 5 | ~22 | the sources: maybe (PlayCanvas's insides) |
| the scripts' source, compiled code, WebAssembly modules | ~28 | no |

**So: 320 MB with the picture untouched — the safe steps are done** (434 this morning; 545 before the desert went).
What's left is the map's grids the game reads (roads 18, trails 16, the box's heights 16, the world's 8, normals 24,
…), Rapier (29), the trees' and bushes' data (20), the code (28). **Under 200 needs the map's CPU grids coarser or the world smaller on a phone;
100 isn't reachable for this world.** And the GPU's side is as big: 387 MB of textures on ULTRA (`device._vram.tex`) —
on a phone that's the same RAM; the low tier's share is not measured yet.

## 3. The drive's marks (2026-11-17 — see 2b: most of them the desert's)

`docs/perf/marks_2026-11-17.json`: the post-fix drive at 28 m/s, SET=all, ways 0–141 of 252 (the valley's 68
tracks, the outland's 69 roads, the first narrow ways) — the rest of the paths were still being driven when this
was written (the full file: the scratchpad's `marks_all.json`, likely gone — re-run). 106 marks: 85 slow (7 in the
valley, 78 in the outland), 21 hitches.

**Lead 1 — hitches AT THE BOX'S EDGE.** Four of the six worst hitches stand ~2 008–2 010 m out on one axis — the
4 096 m box's rim, where the box's grids hand over to the outland's:

| frame | where (player x, z) |
|---|---|
| 232 ms | −2009, 1079 |
| 215 ms | 2008, −261 |
| 166 ms | 666, −2010 |
| 152 ms | −414, 2010 |
| 113 ms | 480, −1093 (valley) |

Something crossing the rim stalls for 150–230 ms: suspects — `Physics.follow` swapping box tiles for outland tiles
(each a heightfield built on the main thread), the grass field's bake across the rim, the ground cache, `Horizon`.
`hitchprof.mjs` on a way that crosses the rim will name it.

**Lead 2 — outland slow spots WITH NO TREES DRAWN.** 69 of the 78 outland slow marks record `trees [0,0,0,0,0]` —
not even an impostor card — with a usual frame of only ~1.4 ms (the valley's is ~2.4) and 24–37 draws, the camera
1–106 m over the ground (not inside a hill). Either the outland's woods aren't drawn there (Horizon occluding too
much? the trees' tile reach?) or the count doesn't see them. Then the spike to 6–11 ms with ~150 k grass blades on
screen. First: fly to the worst and LOOK —

| frame (usual) | player | camera (x, y, z), agl |
|---|---|---|
| 11.4 ms (1.41) | 2795, 3300 | 2757.7, 353.4, 3287.1 · 1.2 m |
| 9.4 ms (1.44) | 3922, 133 | 3884.3, 232, 144.4 · 12.5 m |
| 9.1 ms (1.40) | −1555, 4140 | −1587.3, 347.1, 4162.7 · 18.7 m |
| 7.4 ms (1.46) | −2248, 173 | −2254.7, 187.2, 211.3 · 1.2 m |

then `perfmarks.mjs why` on the file.

**Lead 3 — the valley's slow spots** are mild (3.6–5 ms against 2.4): many full trees and rocks in view (−348, −444;
384, 1486; 97, 618). `why` will say which part.

**Lead 4 — the page died twice more on long drives** (way 88 before the leak fix; way 120 after it, ~90 min into the
drive). After the restart the browser's memory stayed flat (renderer ~700 MB, GPU 270–500 MB, logged every 30 s), so
the second crash isn't explained yet. Watch the renderer / GPU process RSS over a 2 h drive
(`ps axo rss,command | grep puppeteer_dev_chrome_profile`); check WebGPU device loss in the console.

## 4. Next, in order (2026-11-18)

1. Memory: the safe steps are done (320 MB). Next is the GPU's side — 387 MB of textures on ULTRA, the phone's
   tier not measured — and a real phone. Below 300 on the CPU needs coarser grids (roads 3072² → 2048², the trails'
   RGBA) — a change to what the game reads, the user's say.
1b. (A lost device: answered — the page reloads and continues, 2e.)
2. Re-run the long memory drive (`leakprof.mjs` over the roads, the RSS logged) — it must stay flat now the desert is
   gone; and a full `perfmarks.mjs` drive: the page must live through all 252 ways.
3. A phone: none of this has been on one.

(Before 2026-11-18:)

1. Re-run the full drive (or `START=` from where it stopped) and keep the file: `SET=all SPEED=28 node
   scripts/harness/perfmarks.mjs drive docs/perf/marks.json`.
2. Lead 1: `hitchprof.mjs` on a way crossing the box's rim → fix the stall (spread it over frames, or do it ahead).
3. Lead 2: look at the no-trees marks; then `why`.
4. `why` on the worst 12 → fix each part named; re-drive; compare the counts.
5. A phone: none of this has been on one. The JS heap of a loaded valley is ~575 MB after GC — big for a ₹15k phone;
   worth a look (what holds it: a heap snapshot).
