# overhill — what's next (hand-off, 2026-11-10: the garage, the big valley, the flat look)

Read this first when you pick the work up again. The hand-off before this one (the valley's places and the cave
world, 2026-11-06 … 08) is kept whole in `docs/NEXT_caves.md`.

**Nothing from 2026-11-10 is committed.** Branch `coop-claims`, ~95 changed / new files (the cars, the outland, the
flat look, the harness fixes, the docs). Commit before anything risky.

---

## 1. Where things stand

| area | state |
|---|---|
| **Garage** | the Overlander 4×4 (ours) + 18 kit cars, all painted (PC file 2048², phone file 1024²), real spare wheels, no overlapping skins (17 of 19 clean), paint grain off on them. G500 and E30 shelved in code. `docs/VEHICLES.md` |
| **Playable land** | 4 km → **12 km** (walls at ±6104 m, `MapData.play`). The old 4 km valley untouched; the country round it re-shaped and drivable |
| **Outland** | ranges and peaks (30 peaks, the highest 1 210 m), cliff-walled gorges, ~117 k trees, 10 ranger towers, 12 gorge bridges. **2026-11-11 — THE WILDS (§7 below): 119 km of gravel roads to every tower, 11 of the 12 bridges and the new places (the World Tree, a crater, a mesa, a stone arch over a road, 3 mountain views, the early snow on Whitecrown), all on the map.** Still no bushes or boulders out there |
| **Spawn** | moved to the track by Eagle Point (rock hill inside the old valley); the old one kept as `meta.spawn0` |
| **Buildings' look** | flat colours (one muted colour a material, no photo scans) on the valley's buildings, ruins and the building kit. Shapes unchanged. `?flat=0` shows the scans |
| **Frame rate (M4, ULTRA 1080p, headless)** | `fps.mjs ultra` mean 1.58 ms (631 fps), every measured view ≥ 500. Three places measured under 500 before the outland work (below) |
| **Phone** | never measured on a real device. The phone path (LOW, `mobile=1`) loads without errors — that is all that is known |

## 2. What to do next, in order

1. ~~Tracks in the outland~~ — **done 2026-11-11, another way (§7): `scripts/oth/wilds.py`, painted from a field, not ribbons.** What is left of this item: the radar (`Radar.ts`) and the route finder (`Nav.ts`) still know only the box's tracks (the map, `MapView.ts`, shows all 12 km); the server's bounds. The plan as it was written:
   - The box's track texture (`trail.bin`, 2 m, 4 km) cannot cover 12 km. Plan: A* on the world's 8 m grid in
     `scripts/oth/outland.py` (valley floors → each tower, across each gorge bridge, joined to the box's tracks at its
     edge), written to `meta.outland.trails`; drawn as ground-hugging ribbons (a strip mesh a track, near ones only),
     not a texture.
   - Then: the map (`MapView.ts`), radar (`Radar.ts`), chart (`Chart.ts`) and nav (`Nav.ts`) to 12 km — they use
     `meta.inner.origin` (2048) as the map's half; the server's bounds (`backend/src/map.rs`, `world.rs`).
   - Keep trees off the tracks (`Trees.placeTrees`, the outland loop's `keepOff`).
2. **Building SHAPES** (the user's two reference pictures, `~/Desktop/Screenshot 2026-11-10 at 11.51.00 AM.png` /
   `11.51.12 AM.png` — one is an AI render, one is Over the Hill; both the same style): 6–7 thick squared logs with
   notched corners (ours: ~15 thin round ones), a roof of 8–10 big slabs (ours: hundreds of shingles), grey faceted
   BOULDERS for foundations, chimneys and ruin walls (ours: thin walls), squat proportions, bare dirt round a place.
   Cobblestone paving STAYS (the user). Files: `scripts/oth/places.py` (the valley's buildings → `places.glb`),
   `scripts/oth/buildkit.py` (the co-op kit → `kit.glb`), then the plants. Props drawn by `Landmarks.ts` /
   `Locations.ts` (tents, carts, crates, the mine's white boulders) still have their own textures / colours.
3. **Fill the outland**: bushes (`Bushes.ts`), rocks / boulders (`Rocks.ts`), groves (`Groves.ts`), places
   (`Sites.planSites` stops at `map.half - 140`) — each planned per cell on its own seed so the load stays flat. Rock
   out there is plain grey (the slope's paint alone): give it the relief / strata the box's rock has. A few grass
   tufts still stand on gorge walls. Tree shade is box-only.
4. **The night as Over the Hill's** — not started. Get reference frames first (the user's, or the Steam page's).
5. **Frame rate**:
   - three places under 500 fps on the M4 (measured before the outland): Falls Camp 458, Fisher's Landing 477, Birch
     Hollow Cabin 484. At Falls Camp the ground / rock is 0.95 ms of 2.1, trees 0.32, the fall 0.19, water 0.15.
     Re-measure (`ONLY=places node scripts/harness/tour.mjs sweep`), then cut the rock's cost near cliffs.
   - **a real phone on USB** (`scripts/harness/phone.mjs` — it still uses the old timer: switch it to `pace.mjs` first).
   - the Windows laptop not re-measured since 2026-11-07 (687–913 fps then).
6. **Smaller leftovers**: the three cab-overs of the 21 (Forward, Rust Ox, Mammoth) not built; the headlamp glow ~9 cm
   off on textured cars; whether old saves keep their position with the new spawn — not checked; the walls at ±6104 m
   not driven into; the desert keeps its 4 km box (`MapData.play` is the valley's only).

## 3. How to run

```sh
cd backend  && cargo run --release            # the server, :5280
cd frontend && npm run dev                    # the game, http://localhost:5200  (what the harnesses expect)
cd frontend && npm run dev:lan                # for a phone on the Wi-Fi: https://<this Mac's IP>:5300/
cd frontend && npx tsc --noEmit && npm test   # typecheck; drivetrain (745 checks) + mtb + moto + gpu + wire
cd backend  && cargo test --test golden       # the wire's golden file (GOLDEN=update to rewrite)
```

Do NOT rebuild models or edit `src/` while someone has the game open on a phone: every change reloads the page, and a
flood of reloads once hung the LAN server (2026-11-10).

## 4. The scripts added on 2026-11-10

| script | what |
|---|---|
| `scripts/oth/outland.py` | THE OUTLAND: `python3 scripts/oth/outland.py [PREVIEW=<dir>] [WRITE=0] [SEED=7]` — re-shapes the world's grid beyond the box (8 m, 2049²), places the towers, the gorge bridges, the spawn; writes `far.bin` + `meta.json`. Re-runnable: it starts from `scripts/oth/.cache/valley-preoutland` |
| `scripts/oth/offroader.py`, `carkit.py`, `cars.py` | the cars (Blender): `blender -b --factory-startup --python scripts/oth/cars.py -- CAR=<id>` (one car a run), `… offroader.py`; each writes `<id>.glb` + `<id>.m.glb`; `cars.py` also `cars.json` |
| `scripts/oth/coplanar.py` | two skins in one plane (they blink): `blender -b --factory-startup --python scripts/oth/coplanar.py -- <a.glb> … [TOP=14]` — run after any car rebuild |
| `scripts/harness/pace.mjs` | the honest frame timer (two drained windows, the slope). Used by `fps`, `abq`, `ablate`, `floor`, `tour sweep`. NOT yet by `abgpu`, `farcost`, `gpubase`, `movecost`, `perfmarks`, `phone`, `pix`, `placecost` |
| `scripts/harness/outland.mjs` | the outland checked: the car set down at 5 spots, views of the spawn, towers, bridges |
| `scripts/harness/carshot.mjs`, `fleetshot.mjs`, `flicker.mjs` | a car looked over (QUICK=1: outside only); every car loaded and shot; jumping pixels on a car |
| `scripts/harness/floor.mjs`, `passes.mjs`, `pipes.mjs`, `gputime.mjs`, `devinfo.mjs` | the empty frame's cost; a frame's render passes; every pipeline / shader; the GPU's own clock; the device |

## 5. Things that will bite

- **Never re-run `terrain.py` on the valley.** Its files are `terrain.py` + `valley_cliff.py` + `trackgrade.py` + the
  cave's ground + … in a chain; a re-run loses the graded tracks. Post-process instead (as `outland.py` does).
- **Every frame time recorded 2026-11-07 … 11-10 morning is ~2–3 ms too high** (`docs/PERF.md`, top section):
  `queue.onSubmittedWorkDone()` answers ~0.6 s late on PlayCanvas's release build. A/B differences are right; absolute
  numbers are not. Use `pace.mjs`.
- **The two worlds' grids differ now** (valley world 2049² at 8 m, desert 1025² at 16 m). `TerrainShadow` bakes the
  world's shade at a fixed 1025²; anything else that assumed one size for both will throw at the crossing.
- **The box's textures end at its edge** (mask, track, normals): a shader that samples them beyond ±2048 reads the rim
  texel. The grass bake is fixed (`Grass.ts`, "THE OUTLAND"); check any new one.
- **Tree placement order matters**: the box's trees use one shared random sequence — add new placement AFTER it, on
  per-cell seeds (as the outland's loop), or every tree in the valley moves.
- **The user's standing rules**: no subagents; every feature measured per tier and checked in headless Chrome; phones
  must hold 60 fps; commit only when asked; Over the Hill is a reference for style, never copied.

## 6. Docs

`docs/PERF.md` (the measurements and the log) · `docs/VEHICLES.md` (the 21 cars) · `docs/ARCHITECTURE.md` (the world,
the renderer) · `docs/MULTIPLAYER.md` (co-op) · `docs/ASSETS.md` (every model's source) · `docs/NEXT_caves.md` (the
previous hand-off: places, the cave world, its open items).

## 7. THE WILDS (2026-11-11) — the outland's places and roads

The user: "we unlocked the rest of the map but did not add anything there — add peaks and off-road places like in a
real world, a small early-snow shader at some place, and a world tree; dig paths to all places and connect all … Dirt
Rally like places … natural beautiful places … adventure and natural beauty mixed".

| what | where | state |
|---|---|---|
| the places' ground, the roads, the dig | `scripts/oth/wilds.py` (after `outland.py`; re-runnable from `.cache/valley-prewilds` — **delete that folder after re-running `outland.py`**) → `far.bin`, `height.bin`, `meta.json` `outland.{peaks, snow, places, trails}` | 63 roads, 118.7 km, none steeper than 20 %, the deepest cut 7.6 m; 2.6 km of them inside the box (to its own tracks, on four sides) |
| the roads painted, asked | `mapPrep.ts roadField` (a signed distance to the road's edge, 4 m texels, 3072², built in the map's worker) → `MapData.roadTex / roadEdge / wayEdge`; `Terrain.ts ROAD_GLSL` (the ground), `Grass.ts` (no blade on a road), `Trees.ts` (none within 4 m; the box's taken off after its own placement), tyres / bike / dust (`wayEdge`) | `?roads=0` |
| the early snow | `Terrain.ts earlySnow` (`meta.outland.snow`: the line 900 → 450 m within 2.3 km of Whitecrown; a dusting first, streaks on steep faces, the summits white), the grass thins in it | `?snow=0` |
| the World Tree, the Giant's Gate | `Wonders.ts` (the landmarks' Builder and material; colliders joined to the landmarks' — the tree's roots are ground to the wheels) | `?wonders=0` |
| the map | `Chart.ts` (the outland's own chart, 768² over ±6144), `MapView.ts` (zooms out to the playable land: roads, places, peaks named) | radar, nav: not yet |
| the check | `node scripts/harness/wilds.mjs [out] [tier]` (ONLY=<name part>): views of every place and road, the map, the car set down on three roads; it reports WebGPU validation warnings (a refused draw is a black frame) | |

Cost (this M4, 1080p uncapped, `abq.mjs "|roads=0&snow=0&wonders=0"`, 4 reps): ULTRA spawn 0 (noise), the lake +0.03,
on an outland road +0.06, at the World Tree +0.08, in the snow 0 ms; LOW spawn +0.04, on a road +0.12, the tree +0.07,
the snow +0.02 ms. Every ULTRA view ≥ 530 fps. **No phone measured** (the field is 12.6 MB of GPU memory with its mips).

What bit, and what is left:
- **WebGPU's 16 textures a stage**: the road field was the 17th in the cave's "holes" draw — every frame with it in
  the list was refused (black). `OTH_NO_ROAD` (the skin, the holes) reads none. And a 1 × 1 fallback texture would not
  bind (the desert went black): `NO_ROADS` is 2 × 2.
- **The search needs its hairpins priced**: on a hillside steeper than a road may climb, a grid search zigzags in 16 m
  legs; smoothed, that is a road up the fall line, dug 50–100 m deep. `wilds.py` searches two layers (the hill on the
  left / on the right), a change of layer on steep ground costs 300 m and is not allowed over 27° — so roads top out
  at ~600 m: **Whitecrown's pass and the highest shoulders have no road**, and one gorge bridge (−2600, 5608: on a
  cliff-ringed plateau) is not reached.

### Later the same day — "do the things in the Not done list"

| what | where | state |
|---|---|---|
| more peaks | `wilds.py` (a horn on each high crest that had none) | +6, 36 in all; the map names them |
| a road to Whitecrown, the last bridge | `wilds.py` THE HIGH LINES: a grade line traced DOWN from the place (the hill on one hand, a steady 12 %, no hairpin), its foot joined by the search | **Whitecrown Pass**: 5.06 km from 464 m to the col at 1 154 m, a shelf across the massif's cliffs (the deepest cut 18 m); the plateau bridge's two ends (one cut 24.5 m at the plateau's lip); Frost Tarn. Every target has a road now: 73 roads, 120.1 km |
| water | `wilds.py` LAKES (a bowl, a bank raised where the ground fell below the water) → `meta.outland.lakes`; `Wonders.addLakes` (the valley's still water, `Water.poolMaterial`), `MapData.lakeAt` / `waterAt` (the splash, the drag), `ROAD_GLSL lakeDepth` (wet gravel on the shore and bed, no grass), no tree / bush / boulder in one | Mirror Pool (the crater), Stillwater, Heron Lake, Long Mere, Frost Tarn. `?lakes=0` |
| rally dressing | `wilds.py` STAGES → `meta.outland.stages` (14: Whitecrown Pass 5.0 km +682 m, the climbs, the lake runs, World Tree Run, Giant's Gate Sprint, Table Rock Hillclimb, two tower stages); `Wonders.stage` (a start gate, a finish gate, a marker post every 100 m, boards on the sharp bends), `Wonders.update` (the clock: start gate → that stage's finish, the best in `localStorage oth.stage.<name>`, told by the game's toast); `Chart.drawStages` (red dashes, a flag, the name) | `?stages=0`. No collision on posts and boards (the gates' posts have one) |
| radar, GPS | `Radar.ts` (the outland's chart, roads, stages, places), `Nav.ts` (the outland's roads in the graph, the gorge bridges joined across their decks, off-road legs allowed out to the playable land's edge, not through a lake) | spawn → the World Tree 9.6 km, → Whitecrown Pass 14.6 km, all by road |
| bushes, boulders | `Bushes.ts` (thickets by a slow noise on the floors and lower flanks, a hedge along every road's verges), `Rocks.ts` (falls of 3–7 blocks on steeper ground, a lone boulder on the floors) — per-cell seeds, after the valley's own | 89.7 k bushes in all. `?obush=0`, `?orocks=0` |
| snow | `snowFall` (what has fallen) × the slope's hold; the summits white from ~200 m over the line; the grass asks `snowFall`: none in the snow's country (tufts stood black on the steep white faces) | |

Cost with all of it (M4, 1080p uncapped, `abq.mjs "|roads=0&snow=0&wonders=0&obush=0&orocks=0"`, 3 reps): ULTRA spawn 0,
on a road +0.06, the World Tree +0.15 (the bushes +0.08 of it), the snow +0.08 ms; LOW spawn +0.02, a road +0.02, the
tree +0.07, the snow +0.02 ms. **Still no phone measured.**

Still open: the far peaks seen from kilometres off read grey where they face away from the sun (the snow is there:
it is the haze and the shade); a stage's finish and another's start can stand side by side at a junction; no collision
on the marker posts and boards; the outland's lakes have no fish, reeds or reflections of their own beyond the valley
water's; discovering the new places (they are always shown); no groves out there.

### 2026-11-11, later still — "the map we unlocked does not have proper collision on grounds … grass … check all and fix"

**What was wrong, found by measuring (not by the earlier "HELD" check, which only compared the car's height with the
ground's):**

| what | the fault | the fix |
|---|---|---|
| the ground under a car | **no collider at all beyond the box**: `Physics.follow` built heightfield tiles from the box's grid only. Out there no wheel touched anything (0 of 4) — the car fell through and was set back on the drawn ground, over and over. Since 2026-11-10 | `Physics.ts` `farTiles`: 256 m tiles of the world's ground (`MapData.height`, sampled every 4 m), the 3 × 3 round the car / the hero / the bike, beside the box's own. `follow` costs the same out there as in the valley (median 1 ms, worst 5.8, a step of 48 m; 44 k rocks, 156 k trees) |
| the grass | the field's bake took a MASK OF ZEROS beyond the box (lush green blades on golden ground, grass on grey rock) and lit every blade with the box's rim normal | `Terrain.ts outlandMask` (one function for the ground's paint and the bake), `Grass.ts`: the world's normal texture (`uNFar`) for the bake and the blades out there |
| the roads, driven | the bot (`trackdrive.mjs SET=outland`) rolled or stalled on 8 roads: a later road's banks dug through an earlier bed (a 17 m step), hairpins turning on 5 m with legs 7 m apart, a second road 7 m beside the Frostfang climb, a box boulder in a connector, a road through a tower | `wilds.py` (its header: the dig's rules now), `Rocks.ts` (a valley stone in an outland road taken off after the draws) |
| the gorge bridges | never driven on real ground: the rim stood up to 0.6 m over the planks at a mouth or fell away before it; the roads met the decks up to 1.8 m off (9 m at the plateau's); five bridges had a road on one side only | decks lengthened 10 m onto the land at both ends (`meta.bridges`), the ground under each kept under its planks, every end exact, a road to each far end (5; the other 5 ends have a pad) |

**Now** (`SET=outland` then `SET=bridges`, the game's own physics): 63 roads, 125.1 km — 61 without an event, 2 with
one "left the line by 6 m" at a hairpin (no roll); the nine through-bridges crossed clean both ways, twice. On foot the
hero stands on the ground out there; a car in a lake is on its bed with the water's drag (as in the valley's lake).

**Run after any change to `wilds.py`:** `SET=outland TRACKS=0,…  DIRS=fwd node scripts/harness/trackdrive.mjs out.json`
(two halves: a run is ~4 min for 60 km), `SET=bridges DIRS=fwd,rev …`, `node scripts/harness/wilds.mjs`.

Still open: the far ends of bridges 1, 4 and 7 (and two more ends) lead to a pad, not a road; a lake is 5–6 m deep
and a car simply drives on its bed under the water; two hairpins where the bot runs wide; the server knows nothing of
the outland's ground beyond `height.bin`'s box; **no phone measured**.

### 2026-11-11, evening — "natural beauty … huge cliffs and bridges in between, a world tree, off-road places, dirt-rally places" → "go"

Four things, in the order agreed (map side `scripts/oth/wilds.py`, game side as named):

| what | where | how |
|---|---|---|
| **Skyfall Canyon** | (−3392, −2592): a tableland levelled, a two-tier cut 163 m deep, the long lake *Emerald Narrows* on its floor (`OutLake.x1, z1`: a capsule), a 164 m fall into it, the rope **High Bridge** 188 m long and 168 m over the water, the **Skyfall Overlook** — a timber deck over the brink facing the fall (`Wonders.lookout`, `deck`) | the cliffs' beds are painted in three scales of strata (`Terrain.ts`, CLIFFS' BEDS); the deck's ground is bare (`mapPrep.roadField`: a deck's line joins the road field — grass came up through the planks) |
| **The World Tree, 320 m** | (3648, 4960) | `TREE_H=320` (was 150): `Wonders.worldTree` scales by `p.h / 150`; its crown glows at night (the gold masses 0.16, the green 0.04 of the lamps' glow), 170 lights, **falling leaves** (`Wonders.fallingLeaves`: one instanced draw, moved in the vertex shader — 900 / 520 / 260 by tier, not drawn beyond its reach + 700 m), *The Root Spring* among its roots, a flower meadow round its hill |
| **Off-road places** (`meta.outland.zones`, each a place on the map) | *The Boulder Field* (3357, −24) r 75; *Blackwater Bog* (−3529, 3189) r 85; *The Shallows* (4864, 1485), a ford | boulders 0.5–3.4 m on a 5 m grid over bare stone (`Rocks.ts`; `Terrain.ts stonyAt`; no trees: `Trees.ts`); mud the tyres sink in (`MapData.mudAt` beyond the box, `bogMud` in the paint and the grass's bake); the ford is a lake 0.6 m deep the road runs through |
| **Rally feel** | every stage | crests dug into the fast roads (`crests` per stage) with an amber "!" board 70 m before each, both ways (`Wonders.stage`); **the stage clock on screen** while a stage is run (`Wonders.clock` → `main.ts stageClock`, `.oth-stage` in `index.html`: the name, the time, the best — white once it's behind); the roads turn to grey gravel as they climb (360 → 560 m) and darker under the forest |
| **Flower meadows** (`meta.outland.meadows`, three) | the World Tree's hill, the crater's floor, Heron Lake's side | `meadowAt` sets the paint's flower channel and the blades' — what `mud.bin`'s second channel does in the box |

The shader's lakes are eight now (`uLake0..7`: the gfx layer has no uniform arrays); three more uniforms for the
meadows, one each for the bog and the boulder field. A/B switches: `?zones=0` (bog, boulder field, meadows),
`?leaves=0`, with the earlier `roads / snow / wonders / lakes / stages / obush / orocks`.

**Seen** (`wilds.mjs`, ULTRA and LOW, no WebGPU validation warning): the canyon from the overlook and the air, the High
Bridge, the tree by day and at night, the three zones from the ground and the air, the meadows, a crest's board, the map.


**Driven** (the bot, the game's own physics, after the last rebuild): all 69 roads, 140.4 km, `SET=outland DIRS=fwd` —
67 without an event, 2 (lines 44, 56) with one "left the line by 6 m" each, no roll, no stall. `SET=bridges DIRS=fwd,rev`,
13 bridges: 10 clean both ways, the rope High Bridge among them (one run-wide on its first pass in three); bridges 1, 4
and 7 still fail at their dead ends (a pad on a steep side, no road — as before).

**Found by that run and fixed:** the road down to the west gorge's bridge (5) reached the deck at 130° to it and hooked
on inside 8 m, a metre below it — the bot rolled there, one way. `wilds.py axis_in`: a road that arrives more than 60°
off a bridge's line comes round onto that line 30 m out (seven ends changed; all re-driven).

**Cost:** `docs/PERF.md`, 2026-11-11 evening — every new view over 500 fps at ULTRA on the M4, the LOW frames beside the
spawn's; the leaves 900 / 520 / 260 by tier. No phone measured.

**Still open:** the three dead-end bridges; the canyon's sunlit wall reads pale (the grey rock paint in full sun); the
High Bridge's side view was never framed (the harness's camera sits under it); a stage has no penalty for cutting its
bends; the server knows nothing of the zones; the desert was not looked at (the user: later).
