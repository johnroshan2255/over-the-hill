# PERF — 500 fps on the PC, a constant 60 on a Snapdragon 6-series phone, both at ULTRA

The user, 2026-11-06: *"i want to get 500 fps uncapped … make a plan to get 500+ fps so even snapdragon 600+ phone
will give const 60+ in ultra"*; *"we can hide things from far"*; *"do all the steps … even more graphics webgames get 800 fps"*; *"the trick is to
preserve the visual appearance while reducing the actual rendering cost"*; *"check the cheapest way to create water"*.
This is step 8 of `MIGRATION.md`, with the phone made a goal of its own.

## 2026-11-13 — the look measured for what it costs; NOT at 500 fps with it on (`docs/LOOK.md` rounds 5–7)

The user: *"make sure all mobile devices with Snapdragon 600+ get a constant 60+ fps in ULTRA and other devices 500+"*.
Measured on the M4, release builds (`vite build` + `preview`; the commit before from a worktree on :5201), 1080p
uncapped, `abq.mjs "look=0|port=5201|"`, interleaved, 4 reps — fps (ms):

| view | `look=0` | the look as committed (83914dc) | now (rounds 5–7, after the trims) |
|---|---|---|---|
| spawn | 597 (1.675) | 460 (2.173) | 476 (2.101) |
| forest | 546 (1.832) | 418 (2.393) | 431 (2.320) |
| lake | 478 (2.090) | 419 (2.387) | 412 (2.427) |
| omeadow | 623 (1.606) | 460 (2.172) | 465 (2.150) |
| town | 606 (1.649) | 410 (2.437) | 404 (2.476) |

- **THE LOOK COSTS 0.3–0.8 ms** — `LOOK.md`'s first table ("spawn −0.01 ms") was wrong (the laptop it was taken on was
  busy; today's first runs read 2–18 ms for one view for the same reason — nothing here is from those). With it on,
  no valley view is at the bar (≤ 2.00 ms); without it all but the lake are.
- Where it goes (`abq` ablations, ms): the Wardens' laid stone 0.42 at the town / 0.17 at omeadow (`wardens=0`); the
  grade 0.03–0.2 (`grade=0`: every fragment, the overdraw's too); the height haze ~0.1 (`hz=0`); the clutter 0.04–0.13;
  the rest spread. The trees and the grass are 0.3 ms each in the forest with or without the look.
- **The rock relief ran almost everywhere**: on any pixel whose rock share was over 1 % (up to 18 reads) — 0.14–0.32 ms
  with `look=0` too. Now from 6 %, eased in (`rockRelief.ts`): the lake's `look=0` frame 2.26 → 2.02–2.09 ms.
- Trimmed today: the grade's maths (ramps for its smoothsteps, multiply-adds for its mixes); the trees' rim and the
  ground mist skipped by day (a branch on a uniform); the tracks' and the masonry's relief near only (a pixel under
  3 … 10 cm); the clutter's loose stones gone (the user's ask); two thirds of the roads' walls the cheap dressed kind.
- `getCurrentTexture` is ~1.05 ms of `cpuprof`'s "JS" (WebGPU waiting for the GPU): the page's own JavaScript is
  ~0.45 ms a frame — the frame is the GPU's.
- **The phone profile** (`mobile=1`, ULTRA, 1080p): spawn 1.72 / forest 1.95 / town 1.83 ms with the look, 1.43 / 1.49 /
  1.31 without. By "The phone, by the numbers" (× 0.7 / 2.07 Mpx, × 10–15): ~6–10 ms on an Adreno 619 with the look —
  inside the 12 ms budget on paper, a third heavier than without. **Not measured on a phone**: `phone.mjs` still needs
  one on USB; nothing here guarantees a constant 60 there.
- What would close the PC gap, each a decision about the look (none taken): ULTRA without MSAA 4× (`aa=0`: spawn 519,
  forest 459, town 519 fps); the draw distances brought in under the haze (the far land is 90 % gone by 1 km); the
  masonry's ivy and grime by distance; a lighter grade.

Later the same day — the two cuts the user chose ("shorter draw distance hidden behind the fog and simpler stonework
on far ruins"), `abq.mjs "look=0|lreach=1|"`, 4 reps (the machine warmer than the table above: read the differences):

| view | `look=0` | reach as the tier's (`lreach=1`) | now |
|---|---|---|---|
| spawn | 567 (1.763) | 473 (2.116) | 475 (2.106) |
| forest | 506 (1.977) | 406 (2.461) | 414 (2.416) |
| lake | 442 (2.264) | 378 (2.646) | 375 (2.665) |
| omeadow | 566 (1.766) | 415 (2.410) | 438 (2.281) |
| town | 614 (1.630) | 412 (2.427) | 424 (2.356) |

- `Atmosphere.LOOK_REACH` 0.75 (the valley with the look: the trees' far images, the rocks, the crags, the props, the
  Wardens' pieces): −0.01 … −0.13 ms — the far distance is cheap, as measured on 2026-11-06.
- The masonry's FAR path (`Bridges.ts masonry`, a pixel over ~7 … 11 cm of wall: tone, moss and ivy only — two reads
  for five): the town's look cost 0.83 → 0.73 ms; its street view is mostly NEAR wall, which this does not touch.
- Still under the bar with the look on. What is left of the gap is per-pixel work near the camera: MSAA 4× (`aa=0`
  measured −0.12 … −0.40 ms), the near stonework, the grade, the haze.

### The water, Over the Hill's way (`?water=oth` — a switch, not the default yet)

The user: *"check water, check how can we make it like Over the Hill with a cheaper way"*. Their frames (`frontend/refer/`,
the oasis lagoon): a FLAT pastel sheet — its colour by depth alone, pale and clear at the edge to a soft blue; a broad
soft sheen of the sky; one thin white line along the shore; no ripples, no sun glints, no foam streaks. Ours: ripples
(two noise reads), the sky's function along a reflection vector, a glint, a lapping foam line (a read), the terrain's
shadow (a read), the depth from the height grid (four fetches, the other grid's four too if the translator evaluates
both arms). `OTH_WATER` (`Water.ts`): the sheet above — and the still water's DEPTH from the owner mask's G (baked, to
2 m, on the 4 m grid — the mask is read anyway). Still water: one read. A fast stream: the height grid and one streak read.

`abq.mjs "|water=oth|hide=water" lake 5` (M4, ULTRA, 1080p, release): **2.314 → 2.083 ms (432 → 480 fps)**; without any
water 1.862 — the water's own cost 0.45 → 0.22 ms. Phone profile (`mobile=1`, before the mask's depth): 1.651 → 1.468.
The tarn and the canyon (the outland's lakes are `Wonders.ts`, not this shader): no change.

## 2026-11-12, late — the built country, more woods, the lowlands re-sculpted, the stone forests (`docs/NEXT.md` §14)

`abq.mjs "|sculpt=0&pillars=0|woods=0" oroad,town,spawn` (the Mac, 1080p uncapped, interleaved, 4–5 reps), ms:

| view | ULTRA base | sculpt + pillars off | woods off | LOW base | sculpt + pillars off | woods off |
|---|---|---|---|---|---|---|
| oroad | 1.498 (668 fps) | 1.575 | 1.382 (−0.116) | 0.922 | 0.883 | 0.822 (−0.099) |
| town (a ruined town from its street) | 1.479 (676) | 1.407 | 1.431 | 0.854 | 0.793 | 0.817 |
| spawn | 1.623 (616) | 1.653 | 1.606 | 1.132 | 1.086 | 1.053 |

The WOODS are what costs: ~0.1 ms at an outland road view on both tiers (163 k → 250 k+ trees). The mesas and the
pillars are inside the spread; the ruins (69 k pieces; `wardens=0&courts=0` at the town: 1.602 vs 1.476 — noise, the
empty ground costing as much as the walls) too: a cell of small pieces is skipped past the reach of its biggest.
(The first ULTRA oroad run of this set read 7.8 ms with reps from −1 to 10: the game was being played on the Mac's GPU
at the time — discarded, re-run alone.) NOT on a phone: the woods' +0.1 ms here will be several times that there.

## 2026-11-12, night — the hidden vales, the crags by the roads, the oak, the banks (`docs/NEXT.md` §13)

`abq.mjs "|cragsroad=0|vales=0&banks=0"` (the Mac, 1080p uncapped, interleaved, 4 reps), ms: ULTRA canyon 2.084 / 2.102 /
2.031, oroad 1.489 / 1.448 / 1.450, wtree 0.852 / 0.874 / 0.876; LOW canyon 1.150 / 1.178 / 1.146, oroad 0.720 / 0.705 /
0.713, spawn 1.065 / 1.093 / 1.095 — all inside the reps' spread. 11 k more crags (27.4 k → 38.6 k) are in cells that were
already walked and mostly out of any one view; the vales and the banks are heights; the oak one more vertex attribute.
The canyon overlook is 480 fps at ULTRA here with or without any of it (the fall and the long lake: it was before).
Spawn, taken apart (`abq "|crags=0|cragsroad=0|hide=rocks|hide=grass|hide=trees" spawn 5`): 1.647 base, crags 1.624,
no rocks 1.522 (−0.125), no trees 1.550 (−0.10), no grass 1.611 (−0.04): 607 fps on this Mac — nothing of the outland in it.

## 2026-11-12, later — the outland, round 2: secrets, lake sites, regions, crag caps, meadows, the mires (`docs/NEXT.md` §11–§12)

The Mac (M-series, Chrome / Metal), 1080p uncapped, interleaved, 4 reps, `abq.mjs`; ms a frame (fps):

| view | ULTRA base | ULTRA without | LOW base | LOW without |
|---|---|---|---|---|
| oroad | 1.333 (750) | `wardens=0&courts=0` 1.339 · `cragcaps=0&meadows=0&wregions=0` 1.311 | 0.719 | 0.693 · 0.692 |
| giant (2200, 250) | 1.149 (870) | 1.156 · 1.113 | 0.704 | 0.705 · 0.694 |
| ring | 1.508 (663) | 1.536 · 1.506 | 0.861 | 0.875 · 0.866 |
| spawn | 1.581 (632) | 1.593 · 1.604 | 1.006 | 0.980 · 0.986 |
| court (a sunken court from its rim) | 1.304 (767) | `wardens=0&courts=0` 1.382 | 0.864 | 0.822 |
| hand (the Hand in Mirror Pool) | 1.578 (634) | `wardens=0&courts=0` 1.678 | 1.012 | 1.063 |
| **mire** (a mud place on a road, 34 m off) | **1.499 (667)** | **`mires=0` 1.433 (+0.066)** | **0.988** | **0.870 (+0.118)** |

Everything but the mire is inside the spread between reps (±0.05 ms): the secrets are a few hundred instances more in
the Wardens' 21 draws, the regions' tint and the crags' caps a handful of ALU and two noise reads on pixels that were
drawn anyway, the floors a look-up in the grass field's BAKE only, the five meadows five distances a pixel.
THE MIRES: where one fills the view, the mud's paint (three noise reads more than the old flat brown) and its pools
(the puddles' pass, on at any weather there) cost ~0.07 ms ULTRA / ~0.12 ms LOW; away from them, twelve squared
distances a pixel of the outland — not measurable (court / hand with `mires=0`: ±0.04–0.1, both signs).
(These absolute numbers are this Mac's — spawn 632 fps here, where the Windows laptop reads 2.0–2.26 ms: compare A/B only.)
NOT measured: a phone. Load: not timed (the Wardens' plan grew: courts, vaults, lake sites; `World.timings`).

## 2026-11-12 — the outland dressed: crags, parkland, the Wardens' ruins (`docs/NEXT.md` §10)

`abq.mjs "|wardens=0&park=0&crags=0"` (the laptop, 1080p uncapped, interleaved, 4–5 reps): ULTRA ring 1.164 vs 1.265, giant 1.985 vs 1.831,
oroad 1.387 vs 1.207, spawn 2.124 vs 1.951 (re-run per feature: spawn +0.011 / −0.018 / +0.049 — noise; spawn was 2.0–2.26 before). LOW ring 1.485 vs
1.344, giant 1.754 vs 1.700, oroad 1.455 vs 1.260, spawn 1.917 vs 1.915. Per feature at oroad (ULTRA): wardens 0.07 (after the compass fix),
crags 0.06, park ~0. The Wardens draw 3–8 k triangles in a view (≤ 16 draws, empty kinds hidden). Load: +0.16 s plan, +0.17 s trees.

## 2026-11-11, late — the outland lakes cut at their rims (`docs/NEXT.md` §8)

`abq.mjs "|lakecut=0" tarn,omeadow` (the laptop, 1080p uncapped, interleaved): ULTRA tarn 2.090 vs 2.165 ms (less water drawn), omeadow 1.573 vs
1.575; LOW tarn 1.612 vs 1.526, re-run in the other order 1.598 vs 1.625 — noise. The cost: a dot product per lake in the
ground's and the grass's shaders (outland only), and the flood as the map loads (~80 k height reads over the eight lakes, not timed).

## 2026-11-11, night — the box's rim blended, the walls anti-aliased (`docs/NEXT.md` §8)

`TIER=… abq.mjs "|rim=0" spawn,boxedge 4` (the Windows laptop, RTX 4050, 1080p uncapped, interleaved; base = with the
rim's hand-over):

| view | ULTRA base | ULTRA `rim=0` | LOW base | LOW `rim=0` |
|---|---|---|---|---|
| spawn | 2.259 ms | 2.324 (base −0.065) | 2.171 | 2.122 (base +0.049) |
| boxedge (672, −2015, on a road 33 m in) | 1.771 | 1.848 (base −0.077) | 1.786 | 1.724 (base +0.061) |

All within the spread between reps (±0.1 ms; one LOW rep 2.37): the rim is a `max`, two `abs` and a `smoothstep` a pixel
inside the box, its two extra reads (the far normal) only in the last 100 m. The walls (`walls.mjs`) change heights
only — the same mesh, the same draws. The outland chart at 1536² (PCs): the chart painted in ~0.85 s of 2.5 ms slices
(was ~0.5 s) — ready ~6 s after the load instead of ~3.5 s; phones keep 768².

## 2026-11-11 — the wilds: outland roads, the early snow, the World Tree (`docs/NEXT.md` §7)

`abq.mjs "|roads=0&snow=0&wonders=0" spawn,lake,oroad,wtree,osnow 4` (M4, 1080p uncapped, interleaved; base = with them):

| view | ULTRA base | ULTRA without | LOW base | LOW without |
|---|---|---|---|---|
| spawn | 1.50 ms | 1.553 (+0.05: noise) | 0.968 | 0.932 (−0.04) |
| lake | 1.885 | 1.851 (−0.03) | — | — |
| oroad (on an outland road) | 1.242 | 1.184 (−0.06) | 0.698 | 0.577 (−0.12) |
| wtree (190 m from the World Tree) | 0.856 | 0.779 (−0.08) | 0.629 | 0.562 (−0.07) |
| osnow (the Frostfang view, in the snow) | 0.916 | 0.922 (0) | 0.638 | 0.616 (−0.02) |

One more texture read in the ground's paint (the road field, mip-mapped R8 3072²: 12.6 MB), the snow's arithmetic, two
meshes (~8.5 k triangles). Not measured on a phone.

Later the same day (lakes, 14 rally stages' gates / posts / boards, the outland's bushes and boulders, a road to
Whitecrown's pass) — `abq.mjs "|roads=0&snow=0&wonders=0&obush=0&orocks=0|obush=0|orocks=0" spawn,oroad,wtree,osnow 3`:

| view | ULTRA with all | without any | without bushes | without boulders | LOW with all | LOW without any |
|---|---|---|---|---|---|---|
| spawn | 1.482 ms | 1.475 | 1.452 | 1.480 | 0.966 | 0.950 |
| oroad | 1.171 | 1.114 | 1.137 | 1.146 | 0.588 | 0.572 |
| wtree | 0.945 | 0.792 | 0.861 | 0.916 | 0.623 | 0.556 |
| osnow | 1.144 | 1.065 | 1.182 | 1.124 | 0.725 | 0.704 |

Evening (Skyfall Canyon, the World Tree at 320 m with its falling leaves and night glow, the boulder field, the bog,
the ford, three flower meadows, crest boards, the stage clock — `docs/NEXT.md` §7) —
`abq.mjs "|roads=0&snow=0&wonders=0&obush=0&orocks=0&zones=0|zones=0|leaves=0" spawn,wtree,canyon,orocks,obog,omeadow,oroad 4`,
then the same with `TIER=low` and `mobile=1` in every variant (M4, 1080p uncapped, interleaved):

| view | ULTRA with all | without any | LOW (phone profile) with all | without any |
|---|---|---|---|---|
| spawn | 1.509 ms (663 fps) | 1.470 | 1.024 | 1.007 |
| wtree (190 m from the tree, under its leaves) | 1.058 (945) | 0.820 | 0.697 | 0.596 |
| canyon (the overlook's deck, facing the fall) | 1.798–1.903 (525–556) | 1.779 | 1.097–1.120 | 1.063 |
| orocks (in the boulder field) | 1.337 (748) | 1.072 | 0.740 | 0.553 |
| obog (in the bog) | 1.399 (715) | 1.255 | 0.878 | 0.658 |
| omeadow (a flower meadow) | 1.333 (750) | 1.289 | 0.811 | 0.759 |
| oroad | 1.248 (801) | 1.212 | — | — |

- The falling leaves: ULTRA 900 quads −0.035 ms without, LOW 260 quads 0 (noise). 520 on MEDIUM.
- The boulder field and the bog cost what BARE ground costs anywhere (the valley's own rock and marsh): the ground's
  whole fragment shader on every pixel, where a meadow's ground is behind its grass. The stones themselves: 0
  (`orocks=0` at the field: +0.01).
- The canyon is the outland's dearest view and none of it is the new content (−0.02 without): it is a frame of bare
  rock. ULTRA: the rock relief 0.30 ms of it (`tcut=relief` 1.585 ms, 631 fps); water and the fall within noise. LOW
  has no relief.
- **`?tcut=pud` did not compile until today** (`pudOn` was declared in the arm it cut): the ground went undrawn and the
  variant read 0.2–1.2 ms "cheaper" — for an hour that looked like a puddle cost in every view. `abq.mjs` prints
  "Failed to transpile" for exactly this; a grep had hidden it. Fixed; the puddles' real cost at the canyon: −0.06.
- Every new view is over 500 fps at ULTRA on the M4 (the canyon the lowest, 525–556) and under the spawn view's frame on
  LOW except the canyon (+8 %). **Not measured on a phone** — by "The phone, by the numbers" (≈ 1.0 ms of M4 time at the
  phone's resolution) the LOW frames fit, the canyon with the least room; `phone.mjs` on a real Snapdragon 6 is still
  the only proof.

## 2026-11-10 — THE YARDSTICK WAS WRONG since 2026-11-07: every "GPU-drained" number read ~+2–3 ms too high

The user: *"make sure … in pc 500+ ultra const"*. `fps.mjs ultra` read 3.48 ms (287 fps) on the M4 against 1.885 on
2026-11-06 — a regression? Bisected with a worktree: the 11-06 evening build 2.14 ms, the 11-07 morning one 3.59. The
one change between them that mattered: PlayCanvas's RELEASE build (`vite.config.ts`). Today's game on the DEBUG build
(`PCDEBUG=1`): 2.13 ms. But the two builds send the GPU **the same frame** — hooked WebGPU (`passes.mjs`, `pipes.mjs`):
one pass, 74 draws, 1.83 M vertices, the same 119 pipelines and shaders, the same attachments and load / store ops.

**The cause: `queue.onSubmittedWorkDone()` (our `gpuDone`) answers ~0.59 s late on the release build while the game
runs — a CONSTANT, whatever the frame costs** (the debug build's error scopes flush the queue at every call; nothing
does in release). "200 frames, then drained" charged those 590 ms to 200 frames: **+2.9 ms a frame** (300 frames:
+2.0; `tour.mjs sweep`'s 80: +7). `gputime.mjs`: 2 855 frames in 5 s then the same 588 ms to drain = 1.96 ms; the
GPU's own clock (timestamp queries, debug build) 1.68 ms for the pass.

**The fix — `scripts/harness/pace.mjs`:** two drained windows of different lengths (150 and 750 frames) and the SLOPE
between them; the constant cancels. `fps.mjs`, `abq.mjs`, `ablate.mjs`, `floor.mjs`, `tour.mjs sweep` use it. NOT yet:
`abgpu`, `farcost`, `gpubase`, `movecost`, `perfmarks`, `phone`, `pix`, `placecost` (rAF only) — their absolute numbers
are still inflated on WebGPU. **A/B DIFFERENCES in the log below stay right** (the constant is on both sides); the
ABSOLUTE ms since 2026-11-07 (the "4.7 ms spawn" of every `abq` row) are not — read them as ~1.8.

**Where the M4 really stands (ULTRA, 1920 × 1080, uncapped, WebGPU, headless, the release build, all 19 painted cars in):**

| `fps.mjs ultra` | ms | fps |
|---|---|---|
| spawn (car) | 1.751 | 571 |
| forest | 1.640 | 610 |
| lake | 1.826 | 548 |
| cliff | 1.593 | 628 |
| oasis | 1.994 | 501 |
| plain | 1.448 | 691 |
| **mean** | **1.709** | **585** |

`floor.mjs` (new): the EMPTY frame (every part hidden) 0.40 ms at 1080p, 0.19 at 960 × 540 — the clear, the 4× resolve,
the present; the world 1.45 ms. `ablate.mjs ultra spawn`: terrain 0.45, rocks 0.36, trees 0.23, grass 0.19, bushes 0.12,
sky 0.08, landmarks (the places) 0.06.

**The places** (`ONLY=places tour.mjs sweep`: each of the 38 from 26 m): median 1.538 ms (650 fps), mean 1.615; 35 of
38 at ≥ 500 fps. Under: Falls Camp 2.182 (458), Fisher's Landing 2.095 (477), Birch Hollow Cabin 2.065 (484).

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
| 2026-11-10 | THE OFF-ROADER (our own model, 26.7 k triangles, 0.87 MB, no textures) as the main car in place of the G500 (29.7 k, 1.98 MB): the same three draws + the driver's door + the cockpit's parts | `abq.mjs "car=g500\|car=offroader" spawn 5` (M4, 1080p uncapped, interleaved): ULTRA 4.668 → 4.665 ms, HIGH 4.570 → 4.585, MEDIUM 4.053 → 4.063, LOW 3.029 → 3.013 — no measurable cost (±0.02) | not measured (no phone) | — |
| 2026-11-10 | the off-roader RESTYLED (soft bevels, cargo on the rack: 31.5 k triangles, 0.95 MB), drawn without the paint grain (`smooth`), its glass darker from outside | `abq.mjs "car=g500\|car=offroader" spawn 5` (M4, 1080p): ULTRA 4.710 → 4.654 ms, LOW 2.935 → 2.901 — no cost (the grain's fetches saved) | not measured (no phone) | — |
| 2026-11-10 | the off-roader's last rework (30.5 k triangles, 1.01 MB; the grain back on, dark glass) | `abq.mjs "car=g500\|car=offroader" spawn 5` (M4, 1080p): ULTRA 4.661 → 4.671 ms, LOW 2.897 → 2.947 — level with the G500 (within the run's spread) | not measured (no phone) | — |
| 2026-11-10 | SIERRA K, the first of the 21 (docs/VEHICLES.md): 21.4 k triangles, 0.77 MB | `abq.mjs "car=offroader\|car=sierra" spawn 5` (M4, 1080p): ULTRA 4.697 → 4.603 ms, LOW 2.937 → 2.897 — no cost over the off-roader | not measured (no phone) | — |
| 2026-11-10 | the cars WEATHERED (carkit.py `weather`: baked AO + road dust in the vertex colours, the big panels cut on a grid for it; dark glass): off-roader 30.5 k → 34.4 k triangles, 1.52 MB; Sierra K 26.4 k, 1.24 MB | `abq.mjs "car=g500\|car=offroader\|car=sierra" spawn 5` (M4, 1080p; the ULTRA run drifted 4.66 → 4.96 ms over its reps — a warming machine): ULTRA g500 4.866, off-roader 4.995 (+0.13), Sierra 4.927 (+0.06); LOW 3.045 / 3.095 (+0.05) / 3.036 (−0.01). Re-measure the off-roader's +0.1 on a quiet machine | not measured (no phone) | — |
| 2026-11-10 | THE KIT'S 18 CARS in the garage (25–28 k triangles, ~1.2 MB each; only the driven one is loaded) | `abq.mjs "car=offroader\|car=wagon63\|car=steppe" spawn 4` (M4, ULTRA 1080p): 4.741 / 4.655 / 4.595 ms — under the off-roader; the others not measured one by one (the same kit, the same size) | not measured (no phone) | — |
| 2026-11-10 | the off-roader PAINTED (carkit.py `paint_texture`: one image over the paint's panels — chips, scratches, rust, mud — baked by rules in Blender; the garage's paint through the game's white-paint mask). PC: `offroader.glb`, 2048² (2.15 MB); PHONES (a weak GPU, LOW / MEDIUM): `offroader.m.glb`, 1024² (1.97 MB), drawn at 512² on LOW (loadModels `carDetailFor`) | `abq.mjs "car=g500\|car=offroader" spawn 5` (M4, 1080p): ULTRA 4.664 → 4.748 ms (+0.085), LOW 2.971 → 3.051 (+0.08). Texture memory with mips: 21 MB at 2048², 5.6 MB at 1024², 1.4 MB at 512². All 19 cars load on LOW the phones' way (`Q=mobile=1 fleetshot.mjs <dir> low`): no errors | a real phone: not measured | — |
| 2026-11-10 | EVERY CAR PAINTED, and the BLINK fixed (the user: "some pixels or the car's body parts blink"). Three causes, all in the models / their look: (1) the paint GRAIN's dots are one pixel each at a few metres and sparkled as the car moved — off on the painted cars (catalogue `smooth`; the texture carries the wear), three height samples a pixel fewer; (2) TWO SKINS IN ONE PLANE (arch liners / flares on the body's arch, the tail between the quarters, a flush bonnet, grille bars, and a doubled nose on the four winged cars) — found by the new `scripts/oth/coplanar.py`, 17 of 19 cars clean, the other two ≤ 100 cm² under the sills; (3) the paint atlas's unbaked ground was BLACK and bled into the islands' edges through the mips (the off-roader's "black, unpainted" back) — now the paint's pale. The spares are real wheels (`make_wheel`, +3 k triangles where a car carries one). Files: PC `<id>.glb` 2048² (1.7–2.3 MB), phones `<id>.m.glb` 1024² (1.5–2.1 MB), LOW draws 512². | abq, spawn, 4 reps, interleaved — ULTRA 1080p: G500 (the old car, grain on) 4.947 ms · off-roader 4.975 (+0.03) · Sierra 4.881 (−0.07) · Eighty-Eight 4.875 (−0.07). LOW + `mobile=1`: G500 3.064 · off-roader 3.098 (+0.03) · Sierra 3.003 (−0.06). All within the run's noise (±0.15 ms): no cost. Not measured on a real phone. |
| 2026-11-10 | THE BIG VALLEY, first steps (docs/NEXT.md): the playable land 4 km → 12 km (walls at ±6104 m), the world's grid 8 m (2049², far.bin 2.1 → 8.4 MB; the valley's folder 29 MB), the outland's woods (+117 k trees: 160 k), 10 ranger towers, 12 gorge bridges, the buildings in flat colours | `fps.mjs ultra` (pace.mjs's timer): mean 1.709 → 1.584 ms (585 → 631 fps; the spawn is a new spot), every view ≥ 500; `abq "\|flat=0"` spawn: 1.475 vs 1.471 (the flat look: no cost). Load to ready in headless: ~5–7 s (not A/B'd against before). Memory not measured: + ~25 MB of world heights / normals | not measured (no phone); LOW + `mobile=1` loads without errors | — |
