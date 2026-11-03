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

Fill in the status every session. "Weak" = there, but it doesn't read as theirs in a side-by-side.

| OTH desert has | ours | status |
|---|---|---|
| oasis river on the canyon floor, banks of damp sand | `desert.py` water + `Water.ts` | check |
| palm groves along the water | `Trees.ts` palms (desert species) | check |
| green scrub, round bushes on the sand | `Bushes.ts`, `Grass.ts` (oasis growth, mask A) | check |
| stacked slab walls: flat tops, rounded edges, bed on bed | terraced heights (`desert.py`) + skins (`desert_rocks.py`) | check |
| tall pointed spires on the plateaus | `desert_rocks.py` spires | check |
| natural arch the track drives over | `desert_rocks.py` arch (deck = road) | check |
| deep gorge of huge blocks, rapids, plank rope bridge | gorge blocks (`desert_rocks.py`), `Bridges.ts` | check |
| Roman aqueduct by an oasis lagoon | `desert_rocks.py` aqueduct | check |
| ksar / ruins | `desert_rocks.py` ksar | check |
| dunes (an erg) | `desert.py` dunes + ripples | check |
| hot pink sunset, purple starry night | `Atmosphere.ts` (desert light by hour) | check |
| props: camps, wells, tents | `Places.ts`, `Props.ts` | check |

For each "missing" or "weak" row:
1. Find it in their screenshots and videos.
2. Model it (Blender python for structures, as `desert_rocks.py` does; TypeScript instancing for things placed in
   numbers).
3. Place it where their layout has it.
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

---

## 11. Starting it with Claude Code at home

> Read `docs/DESERT_MATCH.md`. Build the desert reference set (§3) and the 12 pairs (§4), render round 0 (§5) and
> score it (§6). Then fill in the content inventory (§7) and run the terrain-integrity views (§8). Show me the
> side-by-sides and the scores, then work the loop: one change per round, log every round in §10, commit each kept
> round with its scores. Target: overall ≥ 65, then ≥ 70, no pair below 55.
