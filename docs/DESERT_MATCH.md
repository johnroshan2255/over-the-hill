# Matching Over the Hill's desert: the score method

The user, 2026-11-03: *"the method we used to make our valley almost match Over the Hill — the score method — I want the
same for the desert. Now it's just some place with nothing there, nothing matches, and incomplete terrain breaks the
terrain walls. Score 0 … 100, 100 = exactly Over the Hill's desert and oasis; develop until it matches."*

This is the hand-off for that work. It covers how the valley was matched, how to run the same loop on the desert, and
where to make each kind of fix. Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first.

> **2026-11-03: the references are REAL deserts, not another game.** The loop below scores our desert against openly
> licensed photographs of real Saharan / Arabian sandstone country (Tassili n'Ajjer and the Iherir oasis in Algeria,
> Wadi Rum in Jordan) — not against Over the Hill's screenshots, and nothing is placed to copy their layout. The method
> (pairs, the 0–100 score, one change per round) is unchanged; §3–§5 describe the current reference set, pairs and
> views, §10 the rounds.

---

## 1. The scale: what the score means

`frontend/scripts/oth/compare.py` scores one pair of images, a crop of an **Over the Hill (OTH) screenshot** against
a crop of **our render** of the same kind of place, from **0 to 100**.

| part | weight | what it measures | what a low value tells you |
|---|---|---|---|
| **colour** | 30 % | HSV histogram overlap (12 hue × 4 saturation × 4 value bins) | wrong palette: hue, saturation or brightness distribution |
| **tone** | 20 % | luminance mean (60 %) and spread / contrast (40 %) | too bright or dark, too flat or too contrasty (light, shadows, haze) |
| **texture** | 30 % | detail energy in 3 bands: fine 1–2 px, mid 2–6 px, coarse 6–16 px | surface too smooth or too busy at that scale (noise octaves, strata spacing, geometry detail, vegetation density) |
| **strokes** | 20 % | histogram of edge directions | the wrong *kind* of marks, e.g. horizontal beds vs vertical streaks, blades vs blobs |

**100 means "the same image"**, not "the same game". Measured on OTH against ITSELF (ARCHITECTURE.md, "Score ceiling"):

| pair | score |
|---|---|
| identical crop | 100 |
| the same crop shifted 5 % | 89 |
| golden grass from two different OTH screenshots | 70–73 |
| one OTH spruce vs another OTH spruce in the same shot | 51 |

So **70 or more on a pair means "as alike as two of their own screenshots"**: that's a match. The valley went from
**53.8 → 64.8 overall in 25 rounds** (golden slope 86–92, golden field 75, spruce 66, rock 57–64, far hillside 59–62).
Most of the remaining gap was content OTH has and we didn't (pines, bushes, snags), which a colour score can't fix.

**Desert targets:** overall ≥ 65 first, then ≥ 70; no pair below 55. Count a pair as *matched* at ≥ 70.

> The score only compares the regions you give it. A desert with *nothing in it* can still score well on "sand" and
> "sky". So the loop has three legs: **the score** (§4–6), **the content inventory** (§7) and **terrain integrity**
> (§8). Work all three every session.

---

## 2. Setup (at home)

```bash
git clone <this repo> && cd overhill && git checkout playcanvas-migration   # (or main, once merged)
cd frontend && npm install
npm run dev                      # the game on http://localhost:5200 (the harness expects this port)
```

- **Chrome** at its standard path. The harness scripts know the macOS and Windows paths.
- **The scorer:** `python3` with `numpy` + `Pillow` (`pip install numpy pillow`), *or* Blender. Both give identical
  scores:
  ```bash
  python3 scripts/oth/compare.py -- SPEC=<pairs.json> OUT=<dir>
  blender -b --factory-startup --python scripts/oth/compare.py -- SPEC=<pairs.json> OUT=<dir>
  ```
- **Blender (4.x)**, only to regenerate the desert's terrain / formations (§8).

**OTH's screenshots are theirs: never commit them.** Keep every reference image and every score run under
`frontend/scripts/oth/.cache/` (already in `.gitignore`).

---

## 3. Step 1: the reference set (real deserts)

Openly licensed photographs from Wikimedia Commons (1920 px), kept in `scripts/oth/.cache/ref/desert/` (git-ignored;
`README.txt` there lists each one's source page, author and licence). To rebuild it: search the Commons API
(`action=query&generator=search&gsrnamespace=6&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920`, a
descriptive User-Agent), download the `thumburl`s, and write README.txt. The connection here was slow (≈ 25–70 KB/s):
1920 px is enough — the scorer resizes every region to 480 × 270.

| file | Commons file | author, licence | shows | pairs |
|---|---|---|---|---|
| c21 | [Djanet Ihrir 1.jpg](https://commons.wikimedia.org/wiki/File:Djanet_Ihrir_1.jpg) | Kamachu87, CC BY-SA 4.0 | the Iherir oasis canyon: water between slabs, reeds, palms, walls both sides | frame, sky |
| c35 | [Wadi rum desert.jpg](https://commons.wikimedia.org/wiki/File:Wadi_rum_desert.jpg) | Peter Chisholm, CC0 | red-orange open sand, sandstone domes | sand_open |
| c32 | [Wadi Rum 01.jpg](https://commons.wikimedia.org/wiki/File:Wadi_Rum_01.jpg) | Bernard Gagnon, CC BY-SA 3.0 | a compacted sand track with ruts, a slab outcrop | sand_track |
| c33 | [Wadi Rum 03.jpg](https://commons.wikimedia.org/wiki/File:Wadi_Rum_03.jpg) | Bernard Gagnon, CC BY-SA 3.0 | a sunlit stacked-slab formation on sand | rock_sun |
| c27 | [Tassili Desert Algeria.jpg](https://commons.wikimedia.org/wiki/File:Tassili_Desert_Algeria.jpg) | magharebia, CC BY 2.0 | sandstone towers, faces in shade, a sand floor | rock_shade |
| c22 | [Djanet Ihrir 4.jpg](https://commons.wikimedia.org/wiki/File:Djanet_Ihrir_4.jpg) | Kamachu87, CC BY-SA 4.0 | close stacked beds over water | slabs_close |
| c30 | [Tassili N'Ajjer National Park (49465145453).jpg](https://commons.wikimedia.org/wiki/File:Tassili_N%27Ajjer_National_Park_(49465145453).jpg) | hanming_huang from Singapore, CC BY-SA 2.0 | towers on a rubble hill against the sky | spires |
| c15 | [Ihrir.jpg](https://commons.wikimedia.org/wiki/File:Ihrir.jpg) | Yacine james, CC BY-SA 4.0 | a guelta among sandstone slabs | oasis_water |
| c20 | [Ihrir 8.jpg](https://commons.wikimedia.org/wiki/File:Ihrir_8.jpg) | Yacine james, CC BY-SA 4.0 | palms and reeds round a pool, a wall behind | palms |
| c16 | [Ihrir 3.jpg](https://commons.wikimedia.org/wiki/File:Ihrir_3.jpg) | Yacine james, CC BY-SA 4.0 | green scrub and palms along the water | scrub |
| c37 | [Wadi Rum, Jordan, Infinite spaces.jpg](https://commons.wikimedia.org/wiki/File:Wadi_Rum,_Jordan,_Infinite_spaces.jpg) | Vyacheslav Argenberg, CC BY 4.0 | far massifs in haze over a plain | far_haze |
| c40 | [Wadi Rum 077.JPG](https://commons.wikimedia.org/wiki/File:Wadi_Rum_077.JPG) | Zairon, CC BY-SA 3.0 | a natural sandstone arch (rock bridge) | arch |

(`scripts/oth/.cache/ref/desert/candidates.json` holds the full shortlist — 43 photos — with each one's page,
author and licence; README.txt the twelve in use.)

What a real desert of this kind shows, and the score has to see: a DEEP BLUE sky paling to the horizon; saturated
orange-red sand with ripples and footprints; sandstone weathered grey-tan to golden, dark in shade, with strong
contrast; dark olive water in the gueltas; grey-green scrub, reeds, palms; far massifs in a pale haze.

---

## 4. Step 2: the pairs (what gets scored)

A pair is one *region*: the same kind of thing in the photo and in ours. 13 pairs
(`scripts/oth/.cache/desert/pairs.json`; rects are fractions of the image, x0, y0, x1, y1, top-left origin):

| pair | photo, rect | ours, rect |
|---|---|---|
| `frame` | c21 [0, .125, 1, .875] (a 16:9 cut) | oasis_up_canyon [0, 0, 1, 1] |
| `sky` | c21 [.4, .02, .85, .28] | oasis_up_canyon [.45, .02, .98, .3] |
| `sand_open` | c35 [0, .7, 1, 1] | spires [0, .62, 1, 1] |
| `sand_track` | c32 [.3, .78, 1, 1] | track [.25, .72, .9, 1] |
| `rock_sun` | c33 [.33, .22, .98, .62] | oasis_up_canyon [0, .1, .35, .55] |
| `rock_shade` | c27 [.64, .1, 1, .55] | escarpment_face [0, .1, 1, .55] |
| `slabs_close` | c22 [.62, .02, 1, .62] | mesa_face [0, .1, .8, .62] |
| `spires` | c30 [.28, .25, .78, .7] | spires [.12, 0, .95, .58] |
| `oasis_water` | c15 [.3, .72, 1, .9] | oasis_up_canyon [.05, .6, .95, 1] |
| `palms` | c20 [0, .2, 1, .42] | grove [0, .18, 1, .52] (fresh round 0 with this rect: the first, half sky, fell with a bluer sky) |
| `scrub` | c16 [.32, .38, 1, .66] | grove [0, .55, 1, .9] |
| `far_haze` | c37 [0, .08, 1, .47] | dunes [0, .2, 1, .42] |
| `arch` | c40 [0, .48, 1, .92] | arch_slot [.3, .25, .6, .55] |

Rules for a fair pair:
- **Same thing at the same scale:** a wall 200 m away in the photo, about 200 m away in ours.
- **Same light:** midday-ish photos — our renders are at hour 11, clear weather.
- **No HUD inside the rect.** desertshot.mjs hides it.
- **Keep the rects fixed across rounds**, or scores can't be compared. Change a rect only with a fresh round 0
  (re-score every kept render with the new rect).

---

## 5. Step 3: render our views

The views are `[name, x, z, h (m above ground), yaw, pitch]`. `yaw 0` looks NORTH (−z); to face (tx, tz) from
(x, z), use `yaw = atan2(−(tx−x), −(tz−z))`.

```bash
# a whole round: render the 11 views into rNN, score into sNN, print each pair's change from the round before
# (needs `npm run dev` — PORT=5299 for a private one; Blender 5.2 runs the scorer)
bash scripts/oth/.cache/desert/round.sh 07          # (the round before: 06; or give it: round.sh 07 05)
# the views alone (scripts/harness/desertshot.mjs — 1280×720, hour 11, clear, ULTRA, no HUD; PORT, HOUR, VIEWS env):
PORT=5299 node scripts/harness/desertshot.mjs scripts/oth/.cache/desert/r00
```

(`round.sh` lives in the git-ignored cache: it is three commands — desertshot.mjs into rNN, pairs.json with r00 →
rNN, `blender -b --factory-startup --python scripts/oth/compare.py -- SPEC=… OUT=sNN` — and a node one-liner
printing the deltas.)

`desertshot.mjs` views (x, z, h, yaw, pitch):

| view | x, z, h, yaw, pitch | note |
|---|---|---|
| oasis_up_canyon | −200, 330, 6, π/2+0.25, 0.02 | from the lagoon up the canyon |
| oasis_down | −900, 120, 30, −π/2+0.1, −0.1 | over the oasis from its head |
| escarpment_face | 600, 1250, 2, π, 0.12 | the escarpment's face from the plain (the doc's first view sat in the crossing's mist) |
| spires | −600, −1000, 4, π/2+0.6, 0.05 | the Needle Forest |
| arch_slot | 1166, −540, 1.7, −0.09, 0.22 | up the slot to the arch (the first view missed it) |
| dunes | −1150, 1150, 25, 1.2, −0.12 | over the erg (the first stood against a slip face) |
| gorge | 1420, 120, 40, π, −0.35 | over the gorge |
| aerial | 0, 900, 420, π, −0.45 | the desert from the south |
| track | 759.6, 1086.4, 1.7, 2.40, −0.1 | on the plain's track |
| mesa_face | 420, 1040, 1.7, 0, 0.12 | a mesa's stacked beds, 70 m off |
| grove | −700, 140, 1.7, π/2, 0.02 | in the palm grove by the river |

Always render **every view of the round** with the same build, tier and hour.

---

## 6. Step 4: score, change one thing, score again

```bash
python3 scripts/oth/compare.py -- SPEC=scripts/oth/.cache/desert/pairs.json OUT=scripts/oth/.cache/desert/s00
```

It prints, per pair, the score, its four parts, and the two regions' median sRGB, luminance and band energies. It
writes `s00/<pair>.jpg` (theirs | ours side by side) and `s00/scores.json`. **Look at the side-by-sides every round:
the numbers say how far off, the pictures say what.**

**Round 0 = the baseline.** Score the desert as it is now, before changing anything, and log it (§10).

Then loop, **one change per round**:

1. Pick the **lowest pair** (or the lowest of the pairs that matter most: oasis, rock, sand).
2. Read **which part is low**, and the printed `ref rgb` vs `ours rgb`:

   | low part | what to change | where |
   |---|---|---|
   | colour | the palette: the sand, sandstone, damp sand, oasis floor and track colours; the sky / haze colours; the water colours | `src/oth/paint.ts` (the `OTH_DESERT` constants SAND, STONE*, DAMP, OASIS_FLOOR, TRACK_SAND and `groundPaint`); the desert's sky and fog in `Atmosphere.ts`; `Water.ts`; `Formations.ts` |
   | tone | sun / ambient strength, shadow depth, haze amount, exposure | `Atmosphere.ts` (the desert's light and haze), `TerrainShadow.ts` |
   | texture | the scale and strength of detail: noise octaves, bed spacing (9 m), ripples, slab skins, scrub / bush density | `paint.ts` (desert `groundPaint`, `bedTone`), the ripples in `Terrain.ts`, `desert_rocks.py` (formation detail), `Grass.ts` / `Bushes.ts` / `Trees.ts` (oasis growth) |
   | strokes | the direction of the marks: horizontal strata vs vertical streaks, dune ripples, palm fronds | `paint.ts` / `Terrain.ts` (strata, streaks), `desert.py` (terraces), `desert_rocks.py` |

3. Make the change. Render **the same views** (r01, r02 …) and score **the same pairs** (s01, s02 …).
4. **Keep it** if its pair rose and no other pair fell by more than ~1 point. Otherwise revert.
5. Measure its cost (CLAUDE.md: `node scripts/harness/fps.mjs ultra`, and LOW for phones), check it visually, commit
   with the scores in the message (*"desert round 7: sand palette — sand_open 58 → 66, overall 54.1 → 55.0"*), and add a
   line to the log (§10).

When a pair is stuck because **the thing isn't there** (no palms in our view, no slab beds, no arch), stop tuning
colours and build it: §7.

---

## 7. The content inventory (what the score can't see)

Fill in the status every session. "Weak" = there, but it doesn't read as a real desert's in a side-by-side.
Status as of 2026-11-03 (round 13):

| a sandstone desert has | ours | status |
|---|---|---|
| a river / gueltas on the canyon floor, damp banks | `desert.py` water + `Water.ts` | **there** — olive guelta water (round 4); the river now flows downstream (it ran uphill) and goes on beyond the box (§8) |
| palm groves along the water | `Trees.ts` palms (desert species) | **there, weak** — dense groves; the fronds a bright yellow-green where real date palms are grey-green |
| scrub, round bushes, reeds | `Bushes.ts`, `Grass.ts` (oasis growth, mask A) | **weak** — the damp banks are an even grass carpet (scrub 29: σ 0.04 vs 0.19); few bushes. Clumps away from the water tried (round 11): right, but the grove crop sits on the bank |
| stacked slab walls, bed on bed | terraced heights (`desert.py`) + skins (`desert_rocks.py`) | **there** — tan-brown beds (round 3); a face lit head-on reads flat (slabs_close 32); the skins no longer stand out of gentle floors (§8) |
| towers / spires | `desert.py` cones + `desert_rocks.py` | **weak** — smooth, regular cones; real Tassili towers are blocky, fluted, flat-topped |
| a natural arch | `desert_rocks.py` arch (deck = road) | **there** — seen up its slot (arch_slot) |
| a deep gorge, rapids, a plank bridge | gorge blocks (`desert_rocks.py`), `Bridges.ts` | **there** — the gorge goes on east past the box now |
| ruins: an aqueduct, a ksar | `desert_rocks.py` | aqueduct **there** (oasis_down); ksar not checked |
| dunes (an erg) | `desert.py` dunes + ripples | **weak** — low dunes, few readable crests; the erg's mesas are sandstone now (round 7) |
| the light by the hour | `Atmosphere.ts` | day **there** (rounds 1, 13); dusk / night not checked this session |
| camps, wells, tents | `Places.ts`, `Props.ts` | there (a tent in the grove) |

For each "missing" or "weak" row:
1. Find it in the reference photos (or more from Commons — §3).
2. Model it (Blender python for structures, as `desert_rocks.py` does; TypeScript instancing for things placed in
   numbers).
3. Place it where it belongs in OUR desert's layout.
4. Then add a pair for it (§4) and score it like the rest.
5. Add an `docs/ASSETS.md` row for anything not made here.

---

## 8. Terrain integrity (the "incomplete terrain that breaks the walls")

Fix these **before** scoring; a broken edge ruins every view that sees it.

- **The box edge:** the playable box is ±2048 m (2 m heights), the world ±8192 m (16 m heights, `far.bin`). Look for
  cliffs cut off at the box edge, steps / seams where the 2 m grid meets the 16 m one, and holes. The physics walls
  stand 40 m inside the box's edge; the terrain must rise or fall smoothly to and past them.
  - **How to look:** views along all four edges and at the corners, from inside and from above, e.g.
    `WORLD=desert VIEWS='[["n_edge",0,-1950,30,0,-0.1,11],["e_edge",1950,0,30,-1.57,-0.1,11],["s_edge",0,1950,30,3.14,-0.1,11],["w_edge",-1950,0,30,1.57,-0.1,11],["corner",1900,1900,120,-2.36,-0.3,11]]' node scripts/harness/cliffshot.mjs scripts/oth/.cache/desert/edges ultra`
- **Formations:** none floating, sunk or cut by the terrain (`formations.glb` vs the heights); colliders match
  (`structures.json`).
- **Roads:** the escarpment road and the pass still drive end to end:
  `START=desert:<x>,<z> DIR=out node scripts/harness/climbtest.mjs`, and `crosstest.mjs` for the crossing.
- **Regenerate after editing the generators** (Blender):
  ```bash
  blender -b --factory-startup --python scripts/oth/desert.py -- OUT=public/oth/desert PREVIEW=scripts/oth/.cache/desert/gen
  blender -b --factory-startup --python scripts/oth/desert_rocks.py -- OUT=public/oth/desert PREVIEW=scripts/oth/.cache/desert/gen
  ```
  `desert.py` writes height.bin / far.bin / mask.bin / trail.bin / meta.json (+ `.cache/desert.npz` for
  `desert_rocks.py`). Re-run `desert_rocks.py` after every `desert.py` change.
- **After a regeneration,** re-render *all* views and re-score *all* pairs: a new terrain is a new round.
- **Done 2026-11-03** (commit 6da8501): the box's features stopped at its edge — the far world (16 m) had only the
  big landforms, so the gorge ended in a 92 m wall (E edge) and the erg in a 38 m one (W edge). `carve_canyon` now
  runs on both grids (the river's course goes on east, `RIVER_OUT`), the far erg carries the box's on, and a 256 m
  band outside the box eases the far heights into the box's edge: steps N 0.2, S 0.3, W 1.1, E 3.7 m (a wall's foot).
  Measure them with a script that reads height.bin / far.bin and compares the box's edge with the far grid 16 / 48 m
  outside (the session's `seams.mjs`: per edge, the max step and the runs over 6 m). Left: where the grids meet, the
  oasis's paint (the mask, inside the box only) ends in a straight line across the gorge's floor, and the far grid's
  16 m facets on the gorge's walls just outside — both past the physics walls.
- **Formations:** a contour that turned across a narrow slot's (or a cut's) gentle floor made a band standing out of
  it as a 10 m dark plate (the arch's slot, the Needle Forest): bands now only where the ground falls steeply ACROSS
  the line. `desert_rocks.py`'s outputs are byte-identical while `desert.npz` is (check with md5 before copying).

---

## 9. Rules (CLAUDE.md, still in force)

- Measure every change's cost per tier (`fps.mjs ultra`, LOW too); phones (₹15k) must hold 60 fps.
- Check every change visually in headless Chrome (the side-by-sides count).
- No code from DARK. OTH's images never in git. Add an `ASSETS.md` row for every outside model, image or sound.
- One change per round. A round that lowers the overall score gets reverted, not "fixed later".

---

## 10. Score log

| round | date | change | frame | sky | sand_open | sand_track | rock_sun | rock_shade | slabs_close | spires | oasis_water | palms | scrub | far_haze | arch | overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-11-03 | baseline: the desert after §8 (terrain integrity), real-desert references | 36.4 | 33.4 | 32.0 | 35.0 | 44.6 | 40.7 | 23.1 | 45.4 | 21.9 | 58.5 | 23.3 | 27.0 | 45.5 | **35.9** |
| 1 | 2026-11-03 | the day sky a desert blue (Atmosphere.ts: zenith deep blue, horizon pale blue — was a pale cyan-white) | 43.3 | 60.4 | 33.6 | 35.5 | 47.6 | 48.1 | 23.2 | 54.3 | 24.3 | 61.9 | 24.2 | 31.5 | 49.8 | **41.4** |
| 2 | 2026-11-03 | the sand's palette to a real desert's orange-red (paint.ts SAND*, TRACK_SAND: hue 32° → 25°, a little darker) | 43.4 | 60.5 | 63.8 | 68.1 | 48.7 | 47.5 | 23.2 | 53.8 | 24.3 | 61.6 | 24.0 | 32.6 | 49.8 | **46.3** |
| 3 | 2026-11-03 | the sandstone tan-brown (paint.ts + Formations.ts STONE*: half as bright, hue 20° → ≈ 30°; the formations' lip sand = the ground's) | 43.7 | 60.1 | 63.8 | 68.1 | 49.5 | 57.0 | 31.5 | 62.7 | 24.2 | 61.8 | 24.2 | 35.0 | 61.3 | **49.5** |
| 4 | 2026-11-03 | the desert's water a guelta's (Water.ts OTH_DESERT: an olive body, dark where deep; low reflections the canyon's sandstone; the river's calm reaches the same) | 53.6 | 60.6 | 63.8 | 68.1 | 51.4 | 57.0 | 31.5 | 62.7 | 33.6 | 61.8 | 24.1 | 35.0 | 61.3 | **51.1** |
| 5 | 2026-11-03 | the oasis grass olive-khaki (Grass.ts OTH_DESERT field colour: hue 85° → ≈ 50°, a little darker) | 53.5 | 60.5 | 63.8 | 68.1 | 50.9 | 57.0 | 31.5 | 62.7 | 33.6 | 61.8 | 28.1 | 35.0 | 61.3 | **51.4** |
| 6 | 2026-11-03 | stable scattering (Rocks / Trees / Bushes: in the desert each cell / item draws from its own seed — one stream for the map moved every stone and palm after any mask change) | 53.6 | 60.6 | 63.6 | 68.1 | 50.8 | 57.0 | 31.5 | 62.6 | 33.6 | 61.7 | 28.7 | 34.7 | 61.3 | **51.4** |
| 7 | 2026-11-03 | the erg's mesas sandstone (desert.py: the erg's 'sand, never rock or beds' only off the mesas — they were smooth sand-coloured blocks; regenerated, desert_rocks.py 624 → 674 bands) | 53.3 | 60.3 | 63.6 | 68.1 | 50.3 | 57.0 | 31.2 | 62.6 | 33.6 | 61.7 | 28.8 | 45.7 | 61.4 | **52.1** |
| 8 | 2026-11-03 | REVERTED — the sand's wind ripples deeper and kept further: texture 13 → 16 but strokes 92 → 81 (one direction of lines; the photos' marks go every way) | 53.2 | 60.3 | 62.3 | 68.0 | 50.3 | 57.0 | 31.2 | 62.6 | 33.6 | 61.8 | 28.7 | 45.7 | 61.4 | **52.0** |
| 9 | 2026-11-03 | speckle in the sand (paint.ts: two octaves of hash value noise, 0.22 / 0.6 m, ±7 / ±5 %, only while they span a few pixels — no direction, no texture fetch) | 53.5 | 60.4 | 64.6 | 68.2 | 50.6 | 57.0 | 31.1 | 62.6 | 33.6 | 61.7 | 28.8 | 45.7 | 61.4 | **52.2** |
| 10 | 2026-11-03 | REVERTED — the sandstone's hue toward golden (G ×1.15): slabs_close +3.6, but arch −14.6 (its photo 27° and ours crossed the scorer's 30° hue bin), spires −6.6 | 53.5 | 60.4 | 64.6 | 68.2 | 50.2 | 54.1 | 34.7 | 56.0 | 33.6 | 61.9 | 28.8 | 43.1 | 46.8 | **50.5** |
| 11 | 2026-11-03 | REVERTED — the oasis grass in clumps with sand between: right away from the water, but the grove crop is on the damp bank (kept full) — scrub unmoved, overall −0.1 | 53.0 | 60.1 | 64.6 | 68.2 | 49.9 | 57.0 | 31.1 | 62.6 | 33.7 | 61.7 | 28.8 | 45.7 | 61.4 | **52.1** |
| 12 | 2026-11-03 | NOT KEPT — the desert's day fill (sky + sand bounce) a third less: overall +1.2, but spires −1.7 (its hazy photo is brighter) | 55.5 | 60.7 | 65.4 | 68.7 | 51.7 | 62.9 | 32.9 | 60.9 | 33.6 | 61.3 | 29.2 | 47.8 | 63.9 | **53.4** |
| 13 | 2026-11-03 | the desert's day fill a fifth less (Atmosphere.ts: the sky's fill and the sand's bounce, their floors too — deeper shade, more contrast; spires −1.1) | 54.7 | 60.5 | 65.1 | 68.6 | 51.1 | 60.6 | 32.3 | 61.5 | 33.6 | 61.6 | 29.1 | 47.0 | 63.4 | **53.0** |
| 14 | 2026-11-03 | REVERTED — mottling on the sandstone (value noise across the faces, ±10 / ±8 %): no measurable change (a face lit head-on stays flat) | 54.4 | 60.5 | 65.1 | 68.6 | 50.7 | 60.7 | 32.4 | 61.5 | 33.6 | 61.6 | 29.0 | 47.1 | 63.4 | **53.0** |
| 15 | 2026-11-03 | REVERTED — the spires as columns (near-vertical sides, a domed top, an irregular outline, a rubble lip): they read far more like the Tassili's towers, but spires −2.1 (its photo is a butte on a huge scree cone) | 54.4 | 60.5 | 65.2 | 68.6 | 50.7 | 60.6 | 32.3 | 59.4 | 33.6 | 61.6 | 29.1 | 47.0 | 63.5 | **52.8** |
| 16 | 2026-11-03 | REVERTED — round 15 + a rubble apron to 45 % of the height: spires −0.8, and the aprons rerouted the roads (trail.bin) — overall −0.4 | 52.6 | 59.7 | 65.5 | 68.6 | 49.4 | 60.6 | 32.3 | 60.7 | 33.7 | 61.6 | 29.1 | 47.1 | 63.5 | **52.6** |

**Cost of rounds 1–13** (`abgpu.mjs`, round 0's build vs round 13's on two dev servers — `PORT_A` / `PORT_B`; 1080p
uncapped, WebGPU, RTX 40-series laptop, 3 interleaved loads a side): oasis ULTRA −0.155 ms (−6.5 %), LOW −0.015;
plain ULTRA −0.001, LOW −0.014 — nothing (a little less: fewer formation bands on gentle floors).

**Where it stands (2026-11-03, after round 16 — round 13 is the last kept): overall 35.9 → 53.0.** Matched (≥ 70): none yet; ≥ 60: sky, sand_open,
sand_track, rock_shade, spires, palms, arch. The weakest: scrub 29, slabs_close 32, oasis_water 34, far_haze 47.

Lessons (read before the next round):
- **The colour score bins hue in 30° steps** (0–30° orange-red, 30–60° yellow-orange …). A palette nudge across a bin
  edge swings a pair by 10–40 points; the photos don't agree on one hue (the arch's sandstone 27°, the slabs' 38°) —
  round 10 (golden sandstone) won slabs_close and lost the arch by 14.6. Check each pair's hue before moving a palette.
- **Placement noise:** stones / palms / bushes once came from one random stream for the map, so any mask change
  reshuffled them all and a crop's score moved with whatever happened to land in it. Seeded per cell now (round 6) —
  keep new scatterers that way.
- **A crop that holds the wrong thing** (the palms crop half sky, the rock_sun crop's stray palm) measures the
  accident: re-crop with a fresh round 0 (re-score every kept render).
- **Texture is the gap everywhere** (photographs carry 3–10× our fine detail). One direction of marks (round 8's
  ripples) costs more in strokes than it wins; isotropic speckle helps a little (round 9); flat paint noise on a face
  lit head-on doesn't show (round 14). What's left is form: deeper slab overhangs and undercuts, blocky fluted towers
  for the cones, scrub and reeds on the banks, real dune crests.

Next, in order:
1. **The spires pair's photo first.** c30 is a single butte on a huge scree cone — it rewards our smooth cones, and
   round 15's columns (which read far more like the Tassili's towers) scored −2.1 against it. Pick a photo of a FIELD
   of towers (Commons: "Tassili n'Ajjer" rock forest, Tadrart; the shortlist's c29 is one, hazy), re-crop with a fresh
   round 0, then redo round 15 in `desert.py`'s SPIRES loop: `d = hypot / (r · (1 + 0.16 sin 3a + 0.08 sin 5a))`,
   profile `d < 0.5: 1 − 0.08 (d/0.5)²` (the top), `0.5–0.62: 0.92 − 0.67 · smoothstep` (the wall), else
   `0.25 · (1 − smoothstep(0.62, 1.3, d))` (a rubble lip), the window ±1.3 r. Keep the skirt inside the A* block
   (r + 10 m) — round 16's wider apron rerouted the roads.
2. Scrub and reeds on the damp banks (`Bushes.ts` / `Grass.ts`, grey-green), and a scrub crop off the bank too.
3. The slabs' undercuts deeper (`desert_rocks.py` profile PB) — a face lit head-on needs its own shadows.
4. Dusk and night checked against photos.

---

## 12. Fuller — our own art direction (2026-11-04)

The user: the desert should feel FULL — "how fuller it is, even if it's just a desert with no trees": rock forms
everywhere, near and far, not an empty plain with a few mesas. This is our own design (not tuned to another game's
screenshots), checked by eye in driver-height views and the aerial, and measured for cost.

Done:
1. **Boulder fields and big blocks** (`Rocks.ts`, desert only, `?fields=0` turns them off for an A/B): the open
   sand strewn with chunky low-poly stones in fields and clearings (a slow noise), RUBBLE where gentle ground meets a
   cliff, and house-sized BLOCKS (6–16 m, alone or leaning in twos and threes) standing on the sand — what fills a
   view out to the haze (a small stone is culled past a few hundred metres). Never on a track (big ones keep their
   own size off it), in the water or on the oasis floor. The desert's boulders take the terrain's sandstone (they
   were the old pink). 3,223 → 28,687 stones; placement 8 → 46 ms at a world's build (a crossing's background build
   too — slice it like the trees if that frame shows); GPU (abgpu, 1080p uncapped): ULTRA +0.12–0.14 ms (oasis),
   +0.05 (plain); LOW within noise (the rubble 40 % as thick on LOW).

2. **Outcrops in the terrain** (`desert.py`, after the roads — `trail.bin`, `structures.json` unchanged): 400 tors
   and stacked-slab outcrops (10–42 m across, 1–3 flat-topped tiers, an irregular outline, sat on the low side of
   their ground) in ROCK GARDENS — clusters within ~130 m of a centre, a few alone — off the roads (1.5 R + 25 m), out
   of the canyon, clear of the places, the mesas, the spires, the gate's climb and each other; terraced into beds and
   in WALL, so `desert_rocks.py` skins them (674 → 1,187 bands, 271k → 344k vertices); never "erg sand". GPU
   (abgpu, the commit before vs this, 3 interleaved loads a side): +0.14–0.15 ms on every view and tier (ULTRA +7–9 %,
   LOW +9–10 %) — the noise here is ±0.1–0.15 ms; a shorter LOW skin reach (420 → 340 m) didn't measurably help.
   **Check LOW on a ₹15k phone** before shipping.

Next:
3. A phone check of LOW (the outcrops' +10 % there).
4. Slice the rock placement (a generator, like `placeTrees`) if the crossing's build frame grows past ~35 ms.
5. More forms near the roads' sides (the outcrops keep 25 m+ off them: a drive between rock gardens still opens wide).
   **Done (§13):** 520 outcrops, their edge ≥ ~13 m off a road.

---

## 13. Not a trenched hill, not a repeated texture (2026-11-04)

The user: *"the hills look like a trenched hill … the ground texture is like a repeated texture … sculpt the hills and
the rocks … roads … a desert but still fuller"*, and then: *"in a big wall there's a line, then the next line, then the
next — in the valley and the desert, wherever we have big walls. Don't use repeated textures, use shaders; from a
distance just colour."* (They asked to download Over the Hill's desert screenshots and match them exactly: declined —
copying another game's look isn't on, §3's real-desert references stand. Everything below is our own art direction,
checked by eye in driver-height views, the aerial and LOW.)

What was wrong, and what changed:

| problem | cause | now |
|---|---|---|
| every wall a stack of equal 9 m steps | `terrace()`: one bed thickness, one cliff fraction, everywhere | `desert.py` **strata**: a table of beds 7–37 m (a third SOFT — a plain slope — the rest HARD: a cliff over a short bench), offset at **joints** (a jittered Voronoi, 52 m, ±4.5 m: no ledge runs on unbroken). The ledge road's face uses them too (`ledgeroad.py strata_fn`) |
| moats round the spires and outcrops | a bench cut into a wall's foot went below the ground round it | the beds never go below the lowest ground within 10 m (`local_min`) |
| every outcrop on a square pad | `max(H, base)` over its whole square window | raised only within its outline |
| spires: smooth cones | — | blocky columns (a domed top, sheer fluted sides, an irregular outline) on a rubble cone; no beds or skins on them (a tower's wall is a cell or two wide: they made lens-shaped plates) |
| the skins on every bed | 1,187 bands | only a HARD bed's riser, sized to it (`desert_rocks.py`): 422 bands, 116k vertices (was 344k) |
| painted 9 m bands, a dark line at each | `bedTone` | beds of uneven tone (two smooth 1D noises, no period), no lines; DESERT VARNISH streaks down the faces (the two projections' results blended — blending coordinates swirled them into wood grain) |
| one sand, tiled | the paint octaves repeat every 0.85 / 3.7 / 13 m; one ripple direction everywhere | baked in the mask (G): GRAVEL plains, sand SHEETS, TAILS downwind of every rock, DRIFTS at the walls' feet; the paint's blotches from turned reads at scales sharing no period; PEBBLES from hashes (grit 3 cm, stones 7 cm, their average far); ripples only on loose sand, in patches, at two angles |
| the road a flat pale strip | — | compacted sand taking a little of the ground it crosses, a ragged edge, two pairs of ruts, a paler crown, sand and pebbles thrown up at its edges |
| the boulders: dice | chamfered boxes | **sculpted in Blender** (`desert_stones.py` → `stones.glb`, 30 kB): 6 sandstone stones (blocks, a boulder, slabs, a chunk) — fracture planes, bedding grooves, weathering — decimated to 256 / 60 triangles, the far one past ~5 % of the view's height; same variants, no stone moved |
| empty | — | desert SCRUB (grey-olive saltbush, dead brush) in patches, at the walls' feet and in the lee of rocks; twice the stones by the tracks |
| **(both worlds)** a line every row on a big wall | the 2 m grid's triangles: steep rock took 42 % of each one's flat normal and tone; the valley's cliff paint an even 3.4 m band with a seam; the 4 m shadow bake striping a near-vertical face; the rock relief's texture repeating every 7 m | steep walls take the smooth normal; the valley's beds uneven, no seams, the small ones and the streaks fading to plain colour with distance; a steep face reads its shade a few metres out in front of it; the relief shifted by a slow warp field (no two tiles match) |

Roads unchanged (`trail.bin` byte-identical); the escarpment's road driven by the bot (climbtest) end to end, through the
gate into the valley; WebGPU transpiles clean (wgslcheck, both worlds, ULTRA + LOW); the chart re-baked. Regenerate:
`desert.py`, then `desert_rocks.py`, then (only if its shapes change) `desert_stones.py -- OUT=public/oth/desert/stones.glb`.

**Cost** (abgpu, the commit before vs this, 1080p uncapped, WebGPU, 5 interleaved loads a side; the noise here ±0.13 ms):
| view | ULTRA | LOW |
|---|---|---|
| desert plain | +0.23 ms (+12 %) | +0.03 ms (+2 %) |
| oasis | +0.32 ms (+11 %) | +0.15 ms (+9 %) |
| valley, the Great Cliff filling the view (the walls' fix) | +0.46 ms (+12 %) | +0.25 ms (+10 %) |

Of the cliff's, ~0.3 ms is `Terrain.ts`'s wall shading, but no one part of it (the streaks, the shadow read, the facets,
the relief's warp — each put back alone) moved it outside the noise; the machine then went too noisy to split it
further. The fewer skins (344k → 116k vertices) and the sculpted stones (256 / 60 triangles a stone vs ≈ 50) don't
show on their own.
The first version (the no-repeat noise from hashes, ~16 `sin` a pixel) cost +0.6 ms everywhere (+40 % on LOW): the
blotches are texture reads now, and LOW drops the small-blotch read, the grit, the second ripple angle and the second
varnish read.

Next:
1. **A ₹15k phone on LOW** in the desert and at the valley's Great Cliff.
2. LOW's walls still band hard 100–300 m off (LOW's terrain mesh is coarser there: the ledges smear into waves).
3. The aqueduct, the ksar and the arch are still box slabs: sculpt them like the stones.
4. Re-score the pairs (§4–6) with the new desert.

---

## 14. Canyon country, and the stylised warm look (2026-11-04)

The user: *"the main problem is the layout — a plane map, no height, just some rocks and some hills on a plane; and the
type of colour and style they have is different."* Over the Hill's seven desert screenshots (their Steam page) are in
`scripts/oth/.cache/ref/oth-desert/` (git-ignored, README there) as a reference for mood and style — never copied or
traced; the map and the art are our own. `scripts/oth/.cache/ref/compare2/` holds our renders against them
(`pair_1…7.jpg`) and their scores.

**Layout** (`desert.py` `canyon_country`): the plain filled with RAISED ROCK MASSES — 40–120 m, two tiers — over 51 % of
the box; every route (and ramp) runs down a CANYON FLOOR 24–46 m wide at the plain's old level (`ROUTE_SKELETON`, the A*
routes' own waypoints), winding SIDE CANYONS through the masses (a warped noise's zero line), a few open BASINS; smaller
masses on the plateaus, the erg mostly open; masses beyond the box too (the far world: no flat horizon). A band down
every route the masses never close, and no bed steps across it; the A* keeps near its line (a cost off it) and may take a
short 34 % pitch rather than no road. No wall steeper than ~67° (only ever lowered — a 2 m grid draws a steeper one as
teeth and curtains), the spires excepted; most spires pointed.

**Look** (desert only): a pale cyan sky to a warm near-white horizon, nearly cloudless; a thick warm peach haze past
400 m (the near ground clear); a rosy, brighter shade; a hot pink sunset, a purple night with a purple fill; coral rock,
peach sand (redder rock so the two read apart), the mass tops rock; CLEAN surfaces — no pebbles, grit, varnish or rock
relief, soft broad tone only, ripples on the dunes only; the track a faint trace; pale blue water; darker palm fronds,
half the palms; lime oasis bushes. The skins (`desert_rocks.py`) are opt-in now (`SKINS=1`): their bands sawtoothed
along the walls.

**Fixed on the way** (old bugs): the outcrops' road check read a distance computed only 14 m out — outcrops stood over
roads in 10–25 m blocks; their beds terraced the escarpment's top leg into a 2 m pothole (it flipped the car); a bed's
ledge across the main road at the canyon's rim. Every road now within ±0.65 m of its neighbours along it (the arch deck
and the rope bridge excepted: spans).

**Scores** (`compare.py`, ours vs their screenshots, whole frames; colour in brackets): oasis 58 → 71 (39 → 55), arch
69 → 57 (48 → 46), spires 65 → 51 (31 → 32), gorge 56 → 64 (18 → 35), lagoon 42 → 66 (3 → 45), sunset 42 → 41
(2 → 11), night 61 → 45 (9 → 11); overall 56 → 56 — the colour columns up, the texture columns down (theirs carry more
edges: block on block). By eye: the oasis and the canyons now read in their family; their stacked-block rock shapes,
their arch and their saturated sunset / night don't yet.

**Cost** (abgpu, the commit before vs this, 1080p uncapped, WebGPU, 4 interleaved loads a side): plain ULTRA −0.18 ms,
LOW −0.17; oasis ULTRA −0.67, LOW −0.15 — cheaper (no skins, half the palms, no relief or fine marks in the desert).
Roads driven: the escarpment, the pass and the gate into the valley (climbtest).

Next:
1. **Stacked-block rock** — the biggest gap left: Blender meshes for the masses' walls (each bed a chunky slab with
   rounded edges, offset from the one below, flat-topped), in place of the heightfield's smooth walls.
2. The arch: a thin rock ribbon over a deep canyon, framed by stacks — ours sits in a narrow slot.
3. Sunset and night: a more saturated sky, the land lit by it (theirs: olive-gold sand under a hot pink sky).
4. A ₹15k phone on LOW.
---

## 11. Starting it with Claude Code at home

> Read `docs/DESERT_MATCH.md`. Rebuild the reference set if it is missing (§3; real deserts) and the 13 pairs (§4), render round 0 (§5) and
> score it (§6). Then fill in the content inventory (§7) and run the terrain-integrity views (§8). Show me the
> side-by-sides and the scores, then work the loop: one change per round, log every round in §10, commit each kept
> round with its scores. Target: overall ≥ 65, then ≥ 70, no pair below 55.
