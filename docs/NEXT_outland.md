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
| **The secrets' rewards** | a court / a vale pays a place + a note + a writing; a vault 4 places. Nothing to carry away: a chest of ◆, a part for the garage, a paint |
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

## 7. The outland as the valley (2026-11-17)

The user: "travelling from the middle to the ruins, some places look boring — make them look like the main valley"
(not the running water, not the flowers). Measured box vs outland per km² (the open country, the box's rim and the
land's edge left out), changed until they matched, then looked at:

| per km² | valley | outland before | outland now | what / where | A/B |
|---|---|---|---|---|---|
| trees | 2 717 | 1 797 | 2 680 | fuller stands (`Trees.ts` THIN2 / STAND2) | `?oveg=0` |
| gold trees | 20 % | 52 % | 19.5 % | the valley's 80 / 20 spruce rule; parkland groves mostly spruce; fewer roadside birches | `?oveg=0` |
| tree GROUPS | — | every tree alone | a quarter of the cells a group of 3–6 of a kind, the tallest in the middle | `Trees.ts` (the user, the same day) | `?ogroups=0` |
| bushes | 1 972 | 981 | 2 028 | thickets fuller (`Bushes.ts`) | `?oveg=0` |
| bare rock on open flat ground | 14.2 % | 0 % | 16 % | the knolls' caps — see THE GROUND below | `?orock2=0` |
| big rocks (≥ 4 m) | 115 | 69 | 120 | outcrops at the bare patches' edges (`Rocks.ts`, on the verge list: no index moves) | `?orock2=0` |
| boulders (1–4 m) | 241 | 189 | 273 | + the roads' verge stones | `?orock2=0` |
| props | 60 | 0 | 50 | logs, stumps, stone clusters, log piles, a cairn at each road's top (`Places.ts`, last: no id moves) | `?oprops=0` |
| small relief (rms, 6–8.5 m) | 59 cm | 37 cm | 53 cm | `mapPrep.roughenOutland` (±3.2 m, 10–17 m; off the roads, places, lakes) | `?orough=0` |
| road walled by trees both sides | 5 % | 5.3 % (9.7 % with the fuller woods) | 3.2 % | clearings along the roads (`Trees.ts`) | `?oroads=0` |
| field walls along the roads | none | ~70 % of road length | ~⅓, one verge mostly (`Wardens.ts`) | | `?oroads=0` |

Also: the green / gold ground (the same day): 70 % green, 30 % golden (`terrain.py` DRY_GOLD, `outlandMask`).

**THE GROUND — the real complaint** (the user, after the first pass: "the main issue was not the trees: the plain flat
ground — no small hills, no hill roads, no big bumps, no rocky texture. What we had was flat places and some huge
hills"; then: "make it exactly the same"). Measured on the OPEN COUNTRY (under 520 m, broad slope over ±150 m under
0.2 — the valley's 58 %, the outland's 23 %: its mountains are its own map and stay) — `shape_open`:

| open country | valley | outland before | outland now |
|---|---|---|---|
| small hill tops (4 m over a 60 m ring) / 1 000 samples | 16.5 | 4.1 | 15.3 |
| flat < 4° / 4–10° / 10–20° / 20–35° / > 35° | 10 / 29 / 39 / 18 / 4 % | 36 / 27 / 18 / 12 / 7 % | 12 / 29 / 36 / 19 / 3 % |
| relief at 25 / 60 / 150 m (rms) | 2.3 / 5.5 / 12.7 m | 3.7 / 9.4 / 23.9 m | 2.3 / 6.3 / 18.1 m |
| bare rock | 21 % | 7 % | 20 % |
| hill tops with bare rock | 75 % | 11 % | 81 % |
| road climb (m / km) · road dead flat | 113 · 16 % | 81 · 21 % | 105 · 13 % |

- **The knolls** (`mapPrep.sculptKnolls`, `?knolls=0`): a jittered 88 m grid, most cells a small hill 6–30 m high,
  100–300 m across (height ≤ 0.28 × radius: rolling flanks), oval and ragged, close ones run into ridges; on low ground
  not a big hill's face; a road over one makes it broad and low (≤ ~15 %) — the road climbs it.
- **The lowlands' sculpt is OFF** (`sculptLowlands` — the mesas, the 9 m terraces, the ±10 m swells of 2026-11-12,
  "Genshin"): the valley has none of them, and they were the outland's whole difference (twice the valley's relief at
  60–300 m, 2.5 × its share over 35°). `?sculpt=1` brings them back.
- **The rock** (`mapPrep.outlandRock`, `?orock2=0`): from the final heights, a CAP where the ground stands over its 24 /
  64 m rings (`ROCK_RISE` 1.8 m) broken into pieces with grass pockets, a LEDGE on 15–27° shoulders; none on a road's
  bed. In the B channel of the world grid's normals (`withRock` — RGBA8: **+8 MB GPU**; the terrain's materials have
  no texture slot left, WebGPU's 16 per stage — a 17th failed to bind). The trees and bushes keep off it; the
  outcrops stand at its edges and on the shoulders (the valley's slope term).
- The small bumps (`roughenOutland`) down to ±1.6 m: with the knolls the 25 m relief was twice the valley's.
- **A WebGL2-only fault, not new**: a crag mesh (`Rocks.cragMeshes`) draws with no instance buffer bound
  ("drawArraysInstanced: no buffer is bound to enabled attribute") — once in the untouched code, every frame at
  (−725, −3185) with the knolls (another pillar in view). Not the shared geometry (tried). WebGPU, the default, is clean.

**Cost of the ground** (abq.mjs, the old ground — sculpt on, knolls and rock off — vs now, 3 reps): ULTRA spawn −0.12,
oroad −0.06, town +0.07, townair +0.46 ms; LOW −0.02, −0.20, −0.11, +0.09. townair is the view: the ruined town is laid
out at load on the ground it finds — a different town under the camera now, not a per-pixel cost.

**Cost** (abq.mjs, interleaved, 1080p uncapped, this Mac; all six switches off vs on): ULTRA spawn −0.11, oroad +0.25,
town −0.04, townair −0.04 ms; LOW spawn −0.01, oroad +0.30, town +0.05, townair +0.01 ms. Split on oroad, LOW (6 reps):
the vegetation +0.07, the relief +0.11 — the relief's is the view (the camera stands on new ground: the same
triangles, draws and blades), −0.07 on `town`. The far trees are image cards (impostors): the counts cost little.

**Not done / to check**
- **A phone** — none of this measured on one.
- **Driving it** — the bumps are off the roads (10 m, eased to 30), but off-road they're ±3.2 m over 10–17 m: drive the
  open country and the bot (`SET=outland trackdrive.mjs`) before calling it done.
- **The relief** stops at 53 of 59 cm: the outland's grid is 8 m, the valley's 2 m — the finest bumps need a finer
  outland grid (a re-bake). Bigger bumps to make up the number would be lumps the valley doesn't have.
- **The bare patches** have a sharp painted edge (the valley's mask is blurred): the outcrops stand by the noise's
  field instead (`map.bareRaw`). A softer paint edge if they read as stickers.
