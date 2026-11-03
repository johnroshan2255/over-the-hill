# Matching Over the Hill's desert: the score method

The user, 2026-11-03: *"the method we used to make our valley almost match Over the Hill — the score method — I want the
same for the desert. Now it's just some place with nothing there, nothing matches, and incomplete terrain breaks the
terrain walls. Score 0 … 100, 100 = exactly Over the Hill's desert and oasis; develop until it matches."*

This is the hand-off for that work. It covers how the valley was matched, how to run the same loop on the desert, and
where to make each kind of fix. Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first.

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

## 3. Step 1: the reference set (OTH's desert)

```bash
mkdir -p scripts/oth/.cache/ref/desert && cd scripts/oth/.cache/ref/desert
# list every store screenshot (full size, 1920×1080); the desert ones were [7..13] on 2026-11-02 — check by eye
curl -s "https://store.steampowered.com/api/appdetails?appids=2929250" \
  | python3 -c "import sys,json; [print(i, s['path_full']) for i, s in enumerate(json.load(sys.stdin)['2929250']['data']['screenshots'])]"
curl -sL -o ss_07.jpg "<path_full of [7]>"     # … one per desert shot
cd -
```

More references, if you need them:
- **The racinggames.gg Algeria reveal image.**
- **Frames from OTH's desert gameplay videos** (`yt-dlp` + `ffmpeg -ss <t> -i video.mp4 -frames:v 1 f_<t>.png`). Pick
  frames at a *driver's height*, in daylight, clear weather, with no HUD in the region you crop.

For every reference write one line in `scripts/oth/.cache/ref/desert/README.txt`: what it shows (oasis river, slab
wall, spires, arch, gorge, aqueduct, dunes), the time of day, and the camera (height, looking up / down / level). You
need those to stage our matching view.

What their desert shows (NEXT.md, "Reference"):
- an **oasis river** winding along a canyon floor (palms, green scrub, round bushes on pale orange sand)
- **red sandstone of stacked slabs** (flat tops, rounded edges)
- tall pointed **spires** and a **natural arch** the track drives over
- a deep **gorge** of huge blocks with rapids and a plank rope bridge
- a **Roman aqueduct** by an oasis lagoon, and **dunes**
- hot pink sunsets and a purple starry night

Measured on their day shots: whole frame ≈ sRGB 213 175 158; sky ≈ 229 244 251; sand ≈ 213 173 128; rock in sun
≈ 213 140 111, in shade ≈ 181 116 99; warm pixels 55–68 % of a frame.

---

## 4. Step 2: the pairs (what gets scored)

A pair is one *region*: the same kind of thing in their shot and in ours. Start with these 12. They are what
makes the desert read as theirs:

| pair | region in their shot | our view |
|---|---|---|
| `frame` | the whole frame of the oasis shot | `oasis_up_canyon` |
| `sky` | the open sky | any view, top 20 % |
| `sand_open` | open sand, sunlit, middle distance | `dunes` |
| `sand_track` | the track's compacted sand near the camera | a view on a track |
| `rock_sun` | a sunlit sandstone wall | `escarpment` |
| `rock_shade` | a wall in shade | `escarpment` / `gorge` |
| `slabs_close` | stacked slab beds, close (their flat-topped layers) | a view at a formation |
| `spires` | the spires against the sky | `spires` |
| `oasis_water` | the river / lagoon surface | `oasis_up_canyon` |
| `palms` | the palm grove | `oasis_up_canyon` |
| `scrub` | green scrub / round bushes on sand | oasis floor |
| `far_haze` | the far escarpment in the haze | `aerial` / `escarpment` |

`scripts/oth/.cache/desert/pairs.json` lists them. The rects are fractions of the image (x0, y0, x1, y1), top-left
origin:

```json
[
  { "name": "sand_open",  "ref": "scripts/oth/.cache/ref/desert/ss_09.jpg", "refRect": [0.05, 0.62, 0.45, 0.95],
                          "ours": "scripts/oth/.cache/desert/r00/dunes.png", "oursRect": [0.10, 0.60, 0.50, 0.95] },
  { "name": "rock_sun",   "ref": "scripts/oth/.cache/ref/desert/ss_07.jpg", "refRect": [0.55, 0.20, 0.95, 0.55],
                          "ours": "scripts/oth/.cache/desert/r00/escarpment.png", "oursRect": [0.50, 0.25, 0.90, 0.60] }
]
```

Rules for a fair pair:
- **Same thing at the same scale:** a wall 200 m away in theirs, about 200 m away in ours.
- **Same light:** match their time of day with `hour=`, and use clear weather.
- **No HUD inside the rect.** Our renders hide it; crop theirs clear of it.
- **Keep the rects fixed across rounds**, or scores can't be compared. Change a rect only with a fresh round 0.

---

## 5. Step 3: render our views

The views are `[name, x, z, h (m above ground), yaw, pitch, hour]`. `yaw 0` looks NORTH (−z); to face (tx, tz) from
(x, z), use `yaw = atan2(−(tx−x), −(tz−z))`.

```bash
# the 8 views placed to match their shots (scripts/harness/desertshot.mjs — 1280×720, hour 11, clear, ULTRA)
node scripts/harness/desertshot.mjs scripts/oth/.cache/desert/r00
# or your own views at any hour (cliffshot.mjs):
WORLD=desert VIEWS='[["oasis",-200,330,6,1.82,0.02,11],["slabs",-150,1650,3,0.2,0.05,16]]' \
  node scripts/harness/cliffshot.mjs scripts/oth/.cache/desert/r00 ultra
```

`desertshot.mjs` views (x, z, h, yaw, pitch):

| view | x, z, h, yaw, pitch | note |
|---|---|---|
| oasis_up_canyon | −200, 330, 6, π/2+0.25, 0.02 | like their ss_7 |
| oasis_down | −900, 120, 30, −π/2+0.1, −0.1 | |
| escarpment | −120, 1700, 8, 0, −0.12 | |
| spires | −600, −1000, 4, π/2+0.6, 0.05 | |
| arch | 1000, −700, 6, −π/2+0.2, 0 | |
| dunes | −800, 1150, 5, π/2+0.3, −0.02 | |
| gorge | 1420, 120, 40, π, −0.35 | |
| aerial | 0, 900, 420, π, −0.45 | |

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

| round | date | change | sky | sand_open | sand_track | rock_sun | rock_shade | slabs_close | spires | oasis_water | palms | scrub | far_haze | frame | overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | | baseline (desert as of 2026-11-03) | | | | | | | | | | | | | |

---

## 11. Starting it with Claude Code at home

> Read `docs/DESERT_MATCH.md`. Build the desert reference set (§3) and the 12 pairs (§4), render round 0 (§5) and
> score it (§6). Then fill in the content inventory (§7) and run the terrain-integrity views (§8). Show me the
> side-by-sides and the scores, then work the loop: one change per round, log every round in §10, commit each kept
> round with its scores. Target: overall ≥ 65, then ≥ 70, no pair below 55.
