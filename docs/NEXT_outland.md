# NEXT — the outland: what's left (hand-off, 2026-11-12, round 3)

Done, and where it's written: `docs/NEXT.md` §8 (the seams), §9 (the autopilot), §10 (the outland dressed), §11 (the
Wardens' secrets, lake sites, regions, crag caps), §12 (the mires: mud on the dirt roads), **§13 (the rally stages out,
the hidden vales, the steep faces, the oak, the roads joined, the banks eased, the autopilot through the pass / on a
touch screen / in co-op)**; the costs in `docs/PERF.md`. This is what is NOT done. The rules hold (CLAUDE.md, the
memory): no sub-agents, test with `?save=0`, measure every change per tier (`abq.mjs`, interleaved), look at it
(`scripts/harness/wardens.mjs`, `HEADFUL=1` for a real window) and drive it before calling it done.

## 1. Only a real device can settle these

| what | why |
|---|---|
| **A phone** (₹15k Snapdragon 6-series, ULTRA, 60 fps) | NOTHING of the outland's dressing has been on one. The touch LAYOUT and events are checked in emulation (`aptouch.mjs`); the frame rate is not. On a weak GPU the crags draw at 0.65× and the ruins at 0.7× of their reach; the mires' pools are on in any weather (+0.12 ms on LOW here) |
| **The Windows laptop's spawn view** (2.0–2.26 ms, under 500 fps) | this Mac reads 607–632 fps there and finds nothing of the outland in it (§13). Re-measure on that machine: `abq.mjs "|crags=0|hide=rocks|hide=trees|hide=grass" spawn 5`, then `?perfmark=1` F9 while driving |
| **A real window, by hand** | every check was headless Chrome. Drive a court, a vault (the winch + the brake), a vale and a mire with the keys |
| **The winch on a touch screen** | a keystone needs the brake held while the winch pulls: WINCH + BRAKE with two thumbs. If it's awkward, latch the handbrake while a keystone is hooked (`Winch.ts`) |

## 2. The Wardens' ruins (`src/oth/Wardens.ts`)

| what | why / how |
|---|---|
| **The secrets' rewards** | a court / a vale pays a place + a note + a writing; a vault 4 places. Nothing to carry away: a chest of ◆ (the supply crates' way), a part for the garage, a paint |
| **A vault's inside isn't dark** | lit as the open air (the terrain's shade knows no roof). The caves' dark has three slots, all taken (`Sites.caveUniforms`): a fourth, or a box test in the Wardens' material |
| **The sites in the lakes: the car** | the stepping stones are a walk (the car falls between); the drowned temple's steps go under water and nothing says how deep is too deep |
| **The beacons' chain** | lit ones are counted, nothing joins them: a line of sparks from each lit tower to its nearest lit neighbour at night |
| **The script's glyphs** | random strokes (seeded): legible as "a script", not beautiful. Hand-draw the 26 (`wardenScript.ts`) |
| **Old saves** | ids are places now (§13) — but a save from BEFORE 2026-11-12 night holds the old numbers: its found Warden sites, lit beacons and read stones are forgotten once (nothing breaks) |

## 3. The land

| what | why / how |
|---|---|
| **The vales' look** | the hollow's walls are the land's own paint and crags: good from inside, plain from the air. A waterfall down the back wall, a pool (`Wonders.addLakes`' material), flowers (the eight meadow slots are full: a ninth, or the vale's floor as one) |
| **The crags' caps and the grass** | the caps are paint: no blades stand on a crag's top |
| **The oak** | round leaves now, but the same 17 clumps spread 1.5× wider: the crown is a little thin against the sky from below. More cards (its own geometry) if it shows |
| **Green vs gold** | the outland's grass is the valley's autumn gold; the references are green. Not changed — ask the user |

## 4. The dirt roads (the mires — §12)

| what | why / how |
|---|---|
| **Wheel spray in the pools** | a mire's water is paint: a splash of brown water where `s.bog`'s pools are |
| **Depth** | the mires are level ground with mud painted on: no ruts to drop a wheel in. The 8 m grid can't hold a rut — a rougher `rough` for the mud surface in a mire (`tyre.ts`) is the cheap way |
| **More kinds of bad road** | fords where a stream crosses, washed-out stretches, a flooded dip (a real sheet of water over the road, 10–20 m) |
| **Wet weather** | in the rain a mire should grow (`uWet` into `mireMud`) |

## 5. The autopilot

- The GPS doesn't plan round **crags** or **boulders** off-road (it does round the ruins): it drove up one and beached (now a 12 s reset, §13). Make big rocks obstacles for the planner, as the places are (`main.ts obstacles`, `Nav.ts`).
- Top speed 45 km/h by choice (`V_ROAD`).

## 6. The seams

- `SET=outland trackdrive.mjs` (the bot down every outland road): see §13 for the last run.
- **Re-run `node scripts/oth/walls.mjs` after any `wilds.py` / `outland.py` run** (delete `scripts/oth/.cache/valley-prewalls` first — it is NOT on the Mac: made on the Windows laptop).
- The courts, the vales, the roads' joins and the banks' easing are all made at LOAD from the file's heights and lines (`mapPrep.ts`): a re-shaped outland moves or re-makes them — nothing to re-run, but look at them after.
