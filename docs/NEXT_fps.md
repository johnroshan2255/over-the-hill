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

## 3. The drive's marks — what's left to fix

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

## 4. Next, in order

1. Re-run the full drive (or `START=` from where it stopped) and keep the file: `SET=all SPEED=28 node
   scripts/harness/perfmarks.mjs drive docs/perf/marks.json`.
2. Lead 1: `hitchprof.mjs` on a way crossing the box's rim → fix the stall (spread it over frames, or do it ahead).
3. Lead 2: look at the no-trees marks; then `why`.
4. `why` on the worst 12 → fix each part named; re-drive; compare the counts.
5. A phone: none of this has been on one. The JS heap of a loaded valley is ~575 MB after GC — big for a ₹15k phone;
   worth a look (what holds it: a heap snapshot).
