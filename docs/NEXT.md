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

## 8. The seams (2026-11-11, night) — "the lines, the repeated M shapes, the sudden colour changes … all over the unlocked map"

| what was wrong | the fix | where |
|---|---|---|
| **M-shaped spikes along every cliff that runs across the grid** (the gorges, the canyon, the mesa, the terraces): a wall fell 40–185 m inside ONE 8 m cell of `far.bin`, and each cell's bilinear patch kinked its own way — a row of teeth along the rim and the foot | the walls anti-aliased IN THE DATA: no cell's bend (`H[k+o] + H[k−o] − 2 H[k]`, along both axes and diagonals) over 10 m (20 on a diagonal) — the steps become S-curves 3–5 cells wide, still 70–80° in the middle; a smooth flank (Raven Peak falls 40 m a cell) bends little and is left alone. 24 622 cells moved (1.6 km²), 7 m on average, 100 m at most (the canyon's 185 m steps at its two ends). The ground, `MapData.height` and the physics' tiles all read the one file: they agree | `scripts/oth/walls.mjs` (Node: there's no Python on the Windows laptop) |
| — what it never touches | every outland road within 15 m of its centre line (eased to free over 16 m more) — byte-identical, checked; the outland bridges' ends (20 m) and no ground raised under a deck; the canyon's fall (lip, foot, the line between); the Skyfall Overlook, the Giant's Gate, the World Tree, the ranger towers, the view points; the box and its 24 m seam; beyond the playable land; a lake's shore never lowered under its water | |
| **a hard line across the field and the road at the box's edge** (and on the radar): inside, the ground's mask is `mask.bin`'s (its rim had grey wet beds and greens); outside, `outlandMask`'s gold — switched at one line; the 2 m normals beside the 8 m | the box's mask handed over to the outland's across its last ~220 m, the line of the hand-over pushed in and out ±70 m by the paint's noise (`Terrain.ts` `boxRim`); the normals over the last 100 m (`boxRimN`); the same in the grass's bake and its blades' light (`Grass.ts`), the ground cache (one code path), and the box's chart into the outland chart's colours (`Chart.ts` `farTint`) | `?rim=0`: the old line (the A/B) |
| **striped peaks** (the user's next pictures: wavy horizontal lines over every mountain, through the snow) — PAINT, not shape: the outland's "cliffs' beds" (bands of slate / buff / grey every 46, 15 and 5 m of height, a dark ledge line under each) and every steep face's fainter 13 m / 4 m bands | both gone: the outland's faces take broad 2D patches of tone instead (the paint's noises, no height in them); the steep faces keep their streaks and the moss on their ledges. The Great Cliff's benches are its real shape, untouched | `Terrain.ts` (THE CLIFFS' TONE, CLIFF FACES) |
| **water hanging in the air at Frost Tarn** (the user's screenshot, 2026-11-11 late) — and a strip of it among the trees west of Heron Lake: an outland lake was ALL the ground below its level within its reach, so the low ground past the bowl's rim (the mountain falling away) took a flat sheet at the lake's level, the bed's gravel painted down the face under it | each lake is what a flood from its middle reaches below its level (8 m grid, as the map loads); any other low ground in its reach is cut off by a straight line through the dry rim between them (the widest gap of 180 tried; Frost Tarn and Heron Lake have one — the other six none). The water's sheet, the bed and wet-shore paint, the grass, `lakeAt` (the splash, the GPS, the chart) all stop there. A warning in the console if a lake's stray ground can't be cut off cleanly | `MapData.ts` `cutLakes` / `lakeOff`, `Terrain.ts` `lakeOne` (`uLakeB.zw`); `?lakecut=0`: as it was |
| the gorges' rims a chain of beads on the radar | the outland chart 1536² on PCs (8 m a pixel, the grid's own; it was 768², 16 m) — phones keep 768² | `Chart.ts` `farS` |

**Run `node scripts/oth/walls.mjs` after any `wilds.py` / `outland.py` run** (first delete `scripts/oth/.cache/valley-prewalls`:
it holds the far.bin from before the walls — the script reads from there so it can be re-run with another `C=`).

**Checked:** the shots before / after (the diagonal gorge at (−4500, −1650) from its floor and the air, the bridge gorge
at (−1616, 4972), the box's edge on roads 0 and 3 from the ground and from 60 m, the radar on both edges); driven with
the keys on the chase camera over the box's edge on road 3 (95 km/h, the wheels on the ground throughout) and over the
gorge bridge at (−4460, −1652); `SET=bridges DIRS=fwd,rev trackdrive.mjs`: 6 events, all at the dead ends of bridges 4
and 7 (the known ones) — 9 with the old far.bin. Cost: `docs/PERF.md` (none measurable).

**Still open:** the box's own tracks end where its texture ends (one stops ~20 m short of an outland road at
(2048, −250)); the outland's green / gold meadow patches are the paint's (`grassPaint`, a ~40 m blend, as in the valley)
— left as they are; the roads' deep cut banks keep their teeth inside the 15 m kept round each road; `SET=outland`
was not re-driven (the roads' cells are unchanged to the bit).

## 9. The autopilot (2026-11-11, night) — "mark where to go on the map … turn autopilot on and off … safely go there … no hills or anything stop it, like a human drives"

| what | where |
|---|---|
| the driver | `src/oth/Autopilot.ts` — drives the GPS's route (`Guide.route`) in the car's fixed step: pure pursuit (the harness bot's steering) with the wheel wound at a driver's pace and limited by speed; a fan of 9 rays ahead (±50°, bumper height, Static + Vehicle groups — never the ground; an up-facing face is no wall) steers round what blocks the line and stops short of what it can't get round; 45 km/h on roads, 25 off, 9 on rock crawls, slower into bends / down grades / back onto the line; on a side-slope over ~17° it creeps and turns downhill; three-point turns; stuck (< 1.5 m in 4 s) → backs off at walking pace, alternating sides, the blocker handed to the GPS (`Guide.replan(block)`) and a way round planned; rolled (1 s) or 6 tries → the reset (upright where it is, facing along the route); 5 resets with no 150 m gained → gives the wheel back |
| the hook | `Vehicle.pilot` (Vehicle.fixed: it sets `sim.controls` when on; any of W A S D / arrows / Space / the touch pedals → off) |
| the switch | **O**; the action wheel (Q) "Autopilot"; the button over the speed (`.oth-ap`, shown while a destination is set — amber + "going round" / "easing off the slope" / "backing up" while it drives); the help line |
| the GPS | `Nav.ts`: the places (cabins, ruins, towers, camps) are now off-road obstacles (`main.ts obstacles`), the destination's own disc exempt (`Obstacles.except`) |
| the harness | `window.__oth.autopilot` (`.log = []` records x, z, v, steer, throttle, brake, target, room, up, lean per step) |

Checked by driving it (headless, real time, the chase camera): spawn → Copper Mine ×5 (arrives, stops); a 30° larch hillside start → past the Old Hut (eases off the slope, arrives); a route through the Old Hut (re-planned round it); spawn → Stag Ridge Lookout (roads into the outland, 25–45 km/h, within 0.5 m of the line). Not done: a phone; the gate crossing to the desert under autopilot; co-op (the remotes see a car driven as any other).

## 10. The outland dressed (2026-11-12) — "just an empty place … we need naturality, beauty like this" (the user's Genshin Impact frames) and "statues, old writings, secret places, paths"

| what | how | where | A/B |
|---|---|---|---|
| **CRAGS AND LEDGES** — a third of the outland is slope over 30°, one smooth painted face | on the steep ground BANDS of 2–4 big blocks (18–42 m) along the contour, each facing down the hill and sunk into it, a second band above on the steepest: stepped cliffs, grassy shelves between; on the grassy slopes LEDGES (2–5 low wide slabs). ~27 k, a 64 m grid each cell its own seed. Drawn on their own pass to 2.8 × the rocks' reach (2.5 km ULTRA; a weak GPU ×0.65), under ~8 px skipped. GROUND to the wheels (they climb onto them) | `Rocks.ts` (place: THE OUTLAND'S CRAGS; update: THE CRAGS; `onCrag`), `Physics.ts` | `?crags=0` |
| **THE PARKLAND** — the open country and the hillsides to ~37° bare between the stands | a ~72 m grid, likelier where there's no stand: GROVES of 4–9 round broadleaf trees (mostly the new OAK, birch gold, aspen orange) or a LONE BIG TREE; smaller groups on the hillsides; a ring of bushes round each grove. ~30 k trees (13 k oaks) | `Trees.ts` (THE PARKLAND, `parklandOf`), `Bushes.ts` | `?park=0` |
| **THE OAK** (species 6) — the references' round lush crowns | the broadleaf geometry made a wide dome on a stout brown trunk in the vertex shader (`oakShape`, the bake too), a lush green; its own impostor row, its frame 1.62× wider | `Trees.ts`, `Physics.ts` (its trunk) | — |
| **THE WARDENS' COUNTRY** — the ruins of the people who kept the World Tree | 502 named sites: 50 BEACON TOWERS on the crests (most with an amber crystal burning), 46 GIANTS (Sword-Bearers and Kneeling Wardens on plinths, fallen heads, a toppled Warden, twin guardians), 104 TEMPLES (platform, steps, columns standing / broken / fallen, some roofed, a statue), 155 STONE RINGS, 49 colonnades, 49 statue gardens, 49 obelisk groups; GATES over the roads every ~1.6 km; shrines / stones / lanterns every ~450 m of road; flagstone PATHS from the road to every site within 260 m; 538 WRITINGS (36 texts — stop by a stone: the card, 10 ◆ the first time). The sites are landmarks (found, the map, the signposts, the GPS). A 16-piece stone kit, one InstancedMesh each, per 256 m cell culled, each piece's reach growing with its size (2.6 km+ for a tower or a giant) | `Wardens.ts` (planWardens, Wardens), `World.ts`, `main.ts` (noteHud), `Props.ts` / `Physics.ts` (ground colliders) | `?wardens=0` · `?wdraw=0` · `?wsites=0` |
| fixed on the way | the compass rewrote every marker's style 10× a second (only on change now; the ruins on it within 1.2 km); `caveUniforms` rebuilt the caves' list from every place every frame (cached) | `MapView.ts`, `Sites.ts` | — |

**Cost** (`docs/PERF.md`): outland views ULTRA +0.05–0.18 ms (≥ 500 fps everywhere measured: 504 at a giant filling the view, 720–860 elsewhere), LOW +0.05–0.19 ms; the box's spawn unchanged. **Still to do:** the giants' shapes (the Kneeling Warden reads crudely), a cipher for the writings, the beacons lighting when reached, more kinds of site (a sealed door in a hillside, a sunken stair), grass caps on the crags, the phone measured on a phone.

## 11. The outland, round 2 (2026-11-12, later) — `docs/NEXT_outland.md` worked through

| what | how | where | A/B |
|---|---|---|---|
| **A BUG in §10 first: nine pieces drawn kilometres off** — every temple's steps, statue and plinth, the giants' steps and lanterns, the gardens' lanterns, the whole toppled Warden: `PC('stair', ...L(0, 10.5), foot, …)` spread a local point's world (x, z) into the piece's (x, **y**) — the z landed in the height | `up(L(…), y)` puts them where they were meant | `Wardens.ts` | — |
| **The giants' shapes** | THE KNEELING WARDEN: a figure — down on one knee (thigh, shin, foot each side), the body leaning back, the head thrown back, the arms out and up to the palms, a hood and a cape, the sun a faceted ball in eight rays (~560 triangles). THE FALLEN HEAD: a helm to the brow with a crown ridge, a nasal bar, cheek plates, deep eye sockets, a beard in five strands, the neck's broken stump (~420); set on the ground at its middle (it was sunk to the brow on a slope), its face clear. A limb helper (`limb`: tapered, any axis, wound outward) | `KIT.kneel`, `KIT.head` | `?wkit=<m>` lays the whole kit out by the first temple (`&wkitrot`, `&wkittx`, `&wkittz`) |
| **The beacons light when reached** | every tower has its crystal: ASLEEP (dull smoked amber, `crystalDark`) until the tower is found, burning for good after (`Wardens.light`, from the landmarks' found set). A burning crystal never looks smaller than from 380 m (grown about its foot as the camera backs off) and the haze dims a lamp 60 % less (`Bridges.ts` FRAG): a spark on its ridge from 2 km, day and night. "Beacon lit · n / 50"; the last one pays 10 places | `Wardens.ts`, `main.ts` onDiscover | `?beacons=lit` |
| **The writing's cipher** | the Wardens' script: 26 glyphs of our own (a stem and 1–3 strokes on a 3 × 3 lattice, seeded; one hidden SVG sprite — no font to be missing on a phone). A letter not learned yet is its glyph; each stone read for the first time teaches three (the commonest first): nine stones and it's plain. Old stones read better when you come back | `wardenScript.ts`, `main.ts` noteHud, `index.html` `.wg` | `?wscript=0` |
| **More writings** | 98 texts (36 + 62: the Tree, the Grey, the beacons, the giants, the leaving; builders, children, lovers, lists) — plus each secret's own | `WRITINGS` | — |
| **SECRET PLACES** (not on the map, the compass or a signpost until found; no path leads to one) | THE SUNKEN COURTS (4): a 16 m floor 5 m down — the ground CUT as the map loads (`mapPrep.sinkCourts`: 3 × 3 samples of the 8 m grid set to the floor, before anything is derived: the drawn ground, normals, quadtree, physics, grass and chart all read one shape; `far.bin` untouched), a ring of flagged stone over the one cell of slope, a stair down the side facing the road (a ramp: the car drives in and out), three crystals burning on a dais, four Wardens in the corners, the court's own words. Invisible from 150 m. THE SEALED VAULTS (7): a chamber against the foot of a steep face, a carved frame, a door slab, a KEYSTONE with an iron ring. The WINCH takes the ring (`Winch.extra`); hold the brake while it pulls (~1.2 s of the car's weight on the cable) and the door falls — a ramp down to the ground in front — the car drives in: a Warden, crystals, the vault's words; +4 places. Kept (`oth.wvaults.<map>`) | `mapPrep.ts`, `MapData.courts`, `Wardens.ts` (planWardens, `openVault`), `Winch.ts`, `Physics.propsDirty`, `PropCollider.off` | `?courts=0` |
| **Colliders that turn with their piece** | `PropCollider.q` (a full quaternion; Physics streams it): a STAIR is a ramp along its steps, GROUND to the wheels (the car climbs a temple's steps onto its platform); fallen columns and the toppled giant lie where they're drawn; every leaning stone has its box (a ring's stones had none: any tilt dropped the collider) | `Props.ts`, `Physics.ts`, `Wardens.ts` PC | — |
| **The names on the map** | a small ruin is on the map once FOUND (a smaller disc, its name when zoomed in); the towers and the giants always. 96 "?" out there, not 502 | `Chart.ts` `onMap`, `MapView.ts` | — |
| **Grass under the floors** | the outland's stone floors as a list of turned rectangles in a 48 m grid (an R32F texture, six values a cell); the grass field's BAKE looks at the 3 × 3 cells round a root — no blade in a rectangle. Nothing per blade or per frame | `Grass.setFloors`, FIELD_FRAG `onFloor`, `WardenPlan.floors` | — |
| **Sites in the lakes** | THE HAND (Mirror Pool, Long Mere: a giant's hand up out of the water, a new kit piece), THE DROWNED TEMPLE (Stillwater, Frost Tarn: columns in the shallows, steps going under, a Kneeling Warden at the far end), THE ISLAND SHRINE (Heron Lake: stepping stones out to a platform). From the shore nearest a road | `planWardens` (THE DROWNED PLACES) | — |
| **The regions' character** | four countries: the FROZEN COURT (pale stone; beacons 800 m apart, not 1250), the TREE'S (mossed green; gardens, lanterns every 260 m of road), the SCRIBES' (ochre; written stones by the roads, needles), the DROWNED SHRINES (dark slate; the lake ruins). The tone is the material's, by where the stone stands (four `uRegion` vec4s on the Wardens' own material — no per-instance colour needed) | `Wardens.ts` (`region`), `Bridges.ts` `regionTint` | `?wregions=0` |
| **Grass caps on the crags** | what faces up on a crag is turf — the hillside's gold, green in the paint's patches, ragged at its rim, a little moss down the face; SNOW above the early snow's line. The face's own normal (from the surface: the vertex normal of a stretched block leans) | `Rocks.ts` FRAG `OTH_CRAG` | `?cragcaps=0` |
| **Flowers** | five more meadows (the shores of Long Mere and Stillwater, two saddles, the open south-west): `uMeadow3–7` | `Terrain.ts` `MORE_MEADOWS` | `?meadows=0` |

**The harness:** `scripts/harness/wardens.mjs [dir] [tier] "name=<site regexp>,dist,up,f<rad round from its front>,pitch[,hour]" …`
(a view per site, by name or style, from its front); `STONE=n SEEN=k` (a writing's card with k stones read), `BEACON=1`,
`STAIR=1` (the car up a temple's steps), `VAULT=1` (the winch on a keystone, the brake held, the car in), `COURT=1` (down
a court's stair and back out), `HEADFUL=1` (a real window), `Q=` (URL params), `EVAL=`.

**Checked by driving** (headless, real time): up a temple's steps onto the platform; the winch on two vaults' keystones
(opened after 2.5 s of brake, the car in over the fallen door); down a court's stair to the floor and out again forwards.

**Cost** (`docs/PERF.md`): none measurable at any view, ULTRA or LOW (the Mac; 632–870 fps ULTRA, 990–1440 LOW).

**Still to do:** `docs/NEXT_outland.md`.

## 12. The mires (2026-11-12, evening) — "I want dirt roads, not a racing thing — a mixture of mud and watery, slippery places … the brown thing in the centre of the valley does not look like a real one"

| what | how | where | A/B |
|---|---|---|---|
| **MUD THAT LOOKS LIKE MUD** — everywhere there is any (the valley's marsh and mud holes, the outland's bog, the mires): it was one flat dark brown | two muds: a WET core (dark earth, churned into clods and smears) and a DRYING rim (paler clay, crusts dragged along); the wheels' RUTS on a track or a road cut darker; and WATER standing in it at any weather — long thin pools in the ruts (broken along their length), round ones in the dips — TURBID (milky brown from above, the sky in it at a glance: the puddles' pass, `s.bog`), not a black mirror. No hard sheen (a sky-grey glaze read as tarmac) | `Terrain.ts` (MUD, the puddles) | — |
| **THE MIRES** — twelve places where an outland road crosses a low, level hollow and turns to mud | chosen as the map loads (`MapData.findMires`): the deepest hollows first, 800 m+ apart, the road under 3.5 % there, below 430 m, clear of bridges, places, lakes and the box. Each a round 32–62 m across on the road: the road and its verges mud (the edge ragged ±1.5 m), WALLOWS in the grass beside it (round blotches ~15 m, more toward the middle). Twelve `uMire` vec4s; a pixel outside them all pays twelve squared distances. The grass's bake reads the same (no blades in it; reeds at its rim, as the marsh). The tyres: `mudAt` — the mud tyre (μ 0.45, soft, Crr 0.08) on the road, a third of it in the wallows | `MapData.ts`, `Terrain.ts` ROAD_GLSL `mireK` / `mireMud`, `Grass.ts` `mudOut` | `?mires=0` |

Checked: the shots (a mire from 34 m, from the air, from the road at 2 m; the valley's marsh from 40 m and the air);
driven through at full throttle (`MIRE=1 wardens.mjs`: mud 0.95 under the wheels across it, the car off the road at
the bend after). Cost: +0.07 ms ULTRA / +0.12 ms LOW where a mire fills the view, nothing elsewhere.

**Not done:** (the rally stages went the same night: §13); no SPRAY of mud / water from the wheels in a mire's pools beyond what the mud
surface already throws (`Dust.ts`); the pools are paint — no depth, the car doesn't sink; the mires are level
ground (real ruts would need the heights cut, as the courts').

## 13. The rest of the list (2026-11-12, night) — "do all things in the Not done list and remove the rally stages"

| what | how | where | A/B |
|---|---|---|---|
| **THE RALLY STAGES TAKEN OUT** | the start / finish gates, marker posts, bend boards, the stage clock and its toasts, the stages' red lines on the map and the radar — gone. The roads stay; `meta.outland.stages` is still in the file, unread | `Wonders.ts`, `main.ts`, `Chart.ts`, `MapView.ts`, `Radar.ts`, `index.html` | — |
| **THE HIDDEN VALES** (2 — the third secret place) | a round hollow cut INTO a hill (a level floor 116 m across, 16 m+ of the hill's own rock all round) and a curving RAVINE into it from the low ground beside (12 m of floor; from its mouth you can't see in) — cut in the samples as the map loads (`mapPrep.carveVales`: only ever lowering, the lip a smooth minimum, the walls a parabola to 56°: no cell bends over ~9 m). The walls paint as rock and take crags; the floor is meadow and the trees find it. In it: nine tall stones round a flagged dais, five crystals burning, a Kneeling Warden at the far wall. The route finder knows the ravine (`meta.navExtra` → `Nav.ts` RoadGraph, drawn on no map): the autopilot drives in (both, ~50 s, no stall) | `mapPrep.ts`, `MapData.vales`, `Wardens.ts` (THE HIDDEN VALES), `Nav.ts` | `?vales=0` |
| **Site ids are places, not turns** | a site's id is its 4 m cell (a writing's its 2 m cell): a change to the plan no longer re-numbers every site under a save's found set, lit beacons, read stones and opened vaults. (Saves from before today still point at the old numbers.) | `planWardens` `idAt` | — |
| **The steepest faces by the roads** | a face over ~37° within ~450 m of a road takes a crag band in 0.9 of its cells (0.42 elsewhere, as before) and always its second band: 27.4 k → 38.6 k crags | `Rocks.ts` (`byRoad`) | `?cragsroad=0` |
| a crag cleared from a site was still DRAWN | `removeWithin` took it off the list and the physics, not off the crags' own grid — every Warden site with a crag on it | `Rocks.ts` | — |
| **The oak up close** | each leaf card's CENTRE goes where the wide crown puts it and the card keeps its own shape about it (×1.22): round leaves, not ovals stretched 1.5× across. A `cardC` attribute on the tree geometries (the card's middle; the vertex itself elsewhere) | `treeGeometry.ts`, `Trees.ts` `oakShape` | — |
| **The autopilot, beached** | stuck again within 0.8 m of where it first stuck (a back-off that moved nothing — up on a boulder, wheels in the air): the reset at once — ~12 s, not six tries and 38 s | `Autopilot.ts` | — |
| **The autopilot on a phone: CAMP stood on its button** | on the touch layout the CAMP button lay over AUTOPILOT — a tap pitched a camp. CAMP sits a row higher while the autopilot's button shows | `index.html`, `main.ts` (`oth-ap-shown`) | — |
| **The roads meet** | ~20 outland roads ended 7–30 m short of the road they meet (the "track that stops ~20 m short" at (2048, −256) was one): each carried on to the other's nearest point, as the map loads; a road that begins on the box's edge with no track under it is carried in to the nearest one (up to 90° of turn, 120 m) | `mapPrep.joinRoads` | — |
| **The roads' cut banks** | the samples 11.5–31 m from a road's centre (never the bed's own) that stand over 5 m off their four neighbours' mean — the spikes walls.mjs's 15 m keep-out left on the ledge roads' cliffs — brought to 5 m of it, three passes | `mapPrep.easeBanks` | `?banks=0` |

**The autopilot, where it hadn't been** (`scripts/harness/ap.mjs`, `aptouch.mjs`, `apcoop.mjs`):
THE PASS — set down 30 m before the valley's gate with a waypoint 290 m into the desert: through the crossing after
9 s with the autopilot still on, arrived in 36 s. A PHONE (emulated: Pixel 5 landscape, touch events — not a phone's
GPU or thumbs) — the button shows, a tap turns it on (45 km/h after 7 s), a touch on GAS gives the wheel back.
CO-OP (two profiles, the server) — A under the autopilot 138 m in 14 s, B sees A's car within 1.06 m of where it is,
B's own car untouched. Off-road: the temple → the Hand stall is 12.5 s now (one reset), not 38.5.

**The spawn view** (`docs/NEXT_outland.md` §5 said "under 500 fps at ULTRA on the laptop"): on THIS Mac it is 607–632 fps
(1.58–1.65 ms); `abq "|crags=0|cragsroad=0|hide=rocks|hide=grass|hide=trees" spawn 5` — the crags 0.02 ms (noise),
all rocks 0.125, the trees 0.10, the grass 0.04. Nothing of the outland's work is in it. The Windows laptop's 2.0–2.26 ms
could not be re-measured from here (`ablate.mjs` on this Mac swings by ±2 ms between parts — not usable).

**The bot down every outland road** (`SET=outland DIRS=fwd trackdrive.mjs`, after all of the above): all 69 lines to their
ends, 138.9 km, 7 events, all "off the line by 6 m", none a stall or a flip — five at the new joins (lines 4, 59 ×2, 65: a
T-junction's corner, cut), two on steep pitches (line 44 at (−3767, −1512), 28 %; line 56 at (4460, 2221), 24 %) that
are there with `banks=0&mires=0&crags=0&wardens=0&courts=0&vales=0` too — the roads' own, from before.

**Cost** (`docs/PERF.md`): none measurable — `abq "|cragsroad=0|vales=0&banks=0"`, ULTRA canyon 2.084 vs 2.102 / 2.031,
oroad 1.489 vs 1.448 / 1.450; LOW canyon 1.150 vs 1.178 / 1.146, oroad 0.720 vs 0.705 / 0.713, spawn 1.065 vs 1.093 / 1.095.

## 14. After the user played it (2026-11-12, late) — "you made some story restriction … boring, I want exploration … all the outside part of the map is huge and nothing placed on it — buildings, broken places, like Genshin … check the initial place for that … make it CONGESTED, not a big plain place … the outer map's valley must be re-sculpted — the outer hills are okay"

| what | how | where | A/B |
|---|---|---|---|
| **The writings read plain** | the Wardens' script that had to be learned stone by stone is off by default (it was the "story restriction") | `main.ts` noteHud | `?wscript=1` |
| **THE BUILT COUNTRY** | RUINED TOWNS (71): a street — a cross of two in the bigger ones — of roofless stone houses in two rows a side (walls with windows and doorways, two storeys on four in ten, half a roof on a quarter), a square with a well / an obelisk / a Warden, lanterns down the street, stretches of a town wall and a gate toward the road, a tower on the big ones; 30–260 m from a road, ~750 m apart. FORTS (12) on the gentle hilltops: a square curtain wall, a round tower at each corner, a gate, a keep. FARMSTEADS every ~380 m of gentle land: one to three houses in a yard of low dry-stone walls, a well. FIELD WALLS along the roads' verges in runs of 50–180 m: the road a lane between them. Three new kit pieces (a wall with a window, with a doorway, broken off); 69 k pieces, 52 k boxes (25 k / 7 k before). Towns and forts are on the map from the start, as the towers and giants | `Wardens.ts` (THE BUILT COUNTRY: `house`, `lowWall`, `well`, the towns / forts / farmsteads / field walls) | `?wardens=0` |
| — kept cheap | a cell of small things is skipped past the reach of its biggest piece (a town's cells aren't walked from 2 km); a wall panel reads to ~800 m | `Wardens.update` | — |
| **MORE WOODS** | the outland's wooded country starts lower on its slow noise (0.14, was 0.34: most of the land, not a third), its thinnest cells hold four times the trees, the open country takes a grove in more cells: 163 k → ~250 k+ trees | `Trees.ts` (THE OUTLAND'S WOODS) | `?woods=0` |
| **THE LOWLANDS RE-SCULPTED** | as the map loads (the samples, before anything is derived): ROLLING GROUND (hillocks ~110 m across, ±10 m), PLATEAUS (flat-topped outcrops 15–44 m high, 90–260 m across, ragged outlines, cliff sides the ground paints rock and the crags hang on — eight in ten 400 m cells), TERRACES (9 m steps in some country). Only where it's valley (below ~380 m, the broad slope gentle: the hills stay), never within 14 m of a road's centre, clear of the box, the lakes, the places. A third of the outland's samples move, 2–3 m on average, 15 m+ on the plateaus. The towns, forts and ruins are placed after — they take the new ground (some stand on plateau tops) | `mapPrep.sculptLowlands` | `?sculpt=0` |

**Cost** (the Mac, ULTRA, `abq "|woods=0|wardens=0&courts=0" town,townair,oroad,giant`): a town from its street 1.476 ms
(678 fps) vs 1.602 without the ruins — noise; from over it 1.588 vs 1.498; the woods +0.05–0.2 ms (oroad 1.625 vs 1.422).
LOW: a town 0.79 vs 0.78 / 0.89; the rest of that run was disturbed — re-measure. Load: the Wardens' plan ~230 ms.

**Not done / to look at:** the towns are one house kit in one stone — no variety of building (a mill, a hall, a
market), no furniture, nothing to find INSIDE a house (a crate, a note) — the next thing if "exploration" is still thin;
the sculpt and the denser woods are not on a phone; houses on a slope step awkwardly (each takes its own level).

**… and the same night, after "not just roads — I need Genshin-like LANDSCAPES, not a plain place like our centre":**

| what | how | where | A/B |
|---|---|---|---|
| **MESAS** (the plateaus, bolder) | 28–80 m of cliff, 120–360 m across, eight in ten 400 m cells of lowland; over half carry a SECOND tier (22–58 m more, set back): hills of stacked cliffs and ledges. A cliff's depth in plan grows with its height (≤ ~65° a cell) | `mapPrep.sculptLowlands` | `?sculpt=0` |
| **STONE FORESTS** | clusters of 3–8 tall stone PILLARS (12–26 m thick, 30–95 m high, the tallest in the middle, turf on top, fallen blocks at their feet) every ~600 m of lowland — the crags' blocks stood on end: the same draws and hulls | `Rocks.ts` (THE STONE FORESTS) | `?pillars=0` |
| the joined road ends are road to the sculpt | `joinRoads` runs first; a verge's wall no longer crosses the mouth of a road that joins there | `mapPrep.prepareMap`, `Wardens.lowWall` | — |

**Still to do for the landscape** (the user's bar is Genshin): WATER in it — rivers down the valleys, waterfalls off the
mesas, pools at their feet (the eight lake slots are full: the lakes need to be a list the shader walks, or a texture);
natural ARCHES and overhangs (meshes: the heightfield can't); the mesas' tops and the pillars' are bare of anything to
reach them for (a shrine, a chest, a view point on each); colour — the references are green and flowered, ours autumn
gold (ask). Not on a phone; the cost of the sculpt, the pillars and the woods together is in `docs/PERF.md` once measured.

**The bot down every outland road, after all of §14** (`SET=outland DIRS=fwd trackdrive.mjs`): 69 lines to their ends,
138.9 km. Left the line at the joined junctions (corners cut) and on the two steep pitches of §13; the two STALLS it
found are fixed (line 4: a join dropped 74 % down a bank between two roads — joins steeper than 22 % aren't made; line
59: a verge's wall across the junction, in a mire — no field wall within six points of a road's end, on a road, or in
mud). Open: line 63 FLIPPED once at (1512, 1632) on a 21 % pitch inside the box in three runs of five (not with
`wardens=0` or `woods=0`, both far from it: the bot on the edge there); line 65 (the 50 m spur to the Skyfall Overlook)
stalls at the deck's foot in some runs. Look at both by hand.

