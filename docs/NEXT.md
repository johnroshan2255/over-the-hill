# overhill — where it stands, what's next (hand-off, 2026-11-02, round 2)

Read `docs/ARCHITECTURE.md` and `CLAUDE.md` first. This file is the to-do list for the **second world (the desert)
and the crossing between worlds**. The user's asks, in their words: *"do the cliff and path, not a bridge, it will walk
you through a fog then gradually the old world will disappear, we will entirely remove it … use workers and then load
the other world"*; *"Red desert canyons — check Over the Hill's desert and make it exactly like that"*; *"make this new
map in Blender so you can sculpt desert cliffs, rocks and all, also the oasis"*; *"we will have a sand storm at some
time, use a filter for that, and sands like in Over the Hill — the real looking thing"*; *"stones low poly like in the
valley"*; *"don't use the valley trees there, use the things in Over the Hill"*.

## Done — round 1 (worlds you can swap, the desert)

- **Worlds you can swap at runtime** (`World.ts`: one group, built in steps, disposed whole; what lasts in `main.ts`
  reads the current map through `liveMap()`), **workers** (`mapLoad.worker.ts` + `mapPrep.ts`; Draco in the loader's
  workers; textures uploaded and shaders compiled before a world is entered), **the desert** (`desert.py`,
  `desert_rocks.py` → `formations.glb`, `OTH_DESERT` through every world material). See ARCHITECTURE.md.

## Done — round 2 (this hand-off: NEXT.md items 1–8 of round 1)

1. **THE CROSSING** (`Crossing.ts`): drive the valley's ledge road up the Great Cliff into the cloud, through the gate,
   and you're on the desert's pass — and back. Verified by a steering bot (`climbtest.mjs`) both ways, every leg and
   hairpin of both roads, and by `crosstest.mjs` (the swap at 99 km/h, back by reversing).
   - **Mist** (`Atmosphere` `uMist` / `uMistColor`, `ATMOS_GLSL` `fogAmount` / `fogColor` / `skyColor`, Sky, Glow): a fog
     round the camera, density `0.19 · uMist³` (at 1: the land 85 % gone 10 m off). It thickens with the CLIMB near the
     gate (`gate.mist` {y0, y1, r} in meta: valley 300 → 469 m within 520 m, desert 200 → 315 m within 420 m) and is
     thickest at the gate. The player's car takes less of it (`MIST_K 0.45`); its shadow and the tyre tracks fade in
     it; at full mist the sky is the mist (no sun disc, clouds, stars — no ridge silhouettes against it).
   - **Background builds**: `World.build(…, background)` leaves what lasts alone (the terrain shadow: `prepare` sends
     the heights to its worker during the build, `use` at the swap; Trees' shade; the shared far grid) until
     `World.adopt` at the swap. Tree and bush PLACEMENT are generators (`placeTrees`, `placeBushes`) run ~6 ms a frame
     (`sliced` in World.build): the longest frame of a background build 82–92 ms → 26–34 ms (what's left: rocks
     ~25 ms, the impostor bake 15–34 ms).
   - **The swap** happens at the start of a frame (before the physics, the pose, the cameras): `enter(next)` (≈ 3 ms
     now), the car / its dust / the free camera moved by the gates' offset (the height from the ground under the car
     in each world), tyre tracks cleared, the region's title ("Entering the desert"). The world left stays built (not
     drawn) while the car is within 1600 m of the gate — turning back is instant — then it's disposed whole. A
     swap needs the car to have come from ≥ 8 m inside, on the gate's road (arming ignores a car not yet placed).
   - **The valley's GREAT CLIFF** (`scripts/oth/valley_cliff.py`, post-process, base copy in `.cache/valley-base`): the
     NE plateau raised to ~490 m (on north out of the box in the far grid), its west face ~300 m; the LEDGE ROAD
     (`scripts/oth/ledgeroad.py`, shared with the desert): 7 legs N ↔ S, 420 m, 26 m apart, 9.5 %, hairpins (r 13 m)
     on benches, a berm on each shelf's outer edge, risers in strata; the pass north through the gate (1102, −1990,
     483 m, heading 0) to the box's edge; an approach track (A*, 911 m) from track 64 by the pond to the foot.
   - **The desert's escarpment road** rebuilt the same way (`desert.py`, `LedgeRoad`: 4 legs E ↔ W, 380 m, 9.8 %, the
     face built out as a bastion where the slope was gentle; the top leg bends onto the pass; gate heading π). The
     old ramps cut across the slope rolled the car at their hairpins.
   - Cost: mist on vs off ≤ 0.017 ms (ULTRA 1080p, at the gate), nothing measurable on LOW (`abweather.mjs`).
2. **SANDSTORM** (desert weather instead of rain — `Atmosphere.weather` 'sandstorm', `uDust` / `uDustColor`; Shift+G /
   K step to it; `?weather=sandstorm`): an orange dust fog round the camera (~110 m to see), the sky gone to dust with
   a pale sun disc, the sun's light ×0.32, blowing SAND streaks (`Rain.ts` kind 'sand': flat with the wind, sand-
   coloured), headlights on by themselves, the synthesized wind loud everywhere + the hiss. Builds over 20 s, settles
   over 30. Cost ≤ 0.02 ms.
3. **SAND** (`TyreTracks`, `Dust`, `Vehicle`): ruts in loose sand (mask G) darker, wider, 5 min to fade; sand spray
   coloured and sized by the ground (pale orange plumes off loose sand, sandstone dust off rock); the car's SAND COAT
   (`uCoat` in the car shader — low on the body and on what faces up, in blotches; ~1 min of sand to coat it, washed off
   in a ford or the oasis water in a few seconds, slowly by rain; light dust on the valley's tracks too).
4. **FORMATIONS** (`desert_rocks.py` structures → `formations.glb`, colliders → `structures.json`, loaded by
   `Formations.ts`, added with the landmarks' in `main.ts`): the natural ARCH (15 stacked beds over the slot, its
   deck the road — level at 238.2 m, the road's ends levelled to it in desert.py; deck = ground collider, lips = 1.5 m
   walls), the Roman AQUEDUCT (39 bays, 472 m, voussoir arches, parapets, 3 bays fallen with their stones), the KSAR
   (walls in blocks with gates where the road runs through, corner towers, ruined houses), the GORGE's 46 huge blocks.
   The gorge's bridge is a ROPE BRIDGE now (`Bridge.kind 'rope'`, `sag` 3.5 m: `deckY()`; `Bridges.ropeBridge`: planks
   on cables, handrails, suspenders, A-frame towers; physics as 12 m pieces along the sag; the ground under it
   notched below the deck — the rim's lip stood through it). Both driven across (a test script, not in the repo).
5. **DESERT PLACES** (`Places.ts`, `Props.ts`): oasis camps (Lagoon, Oasis, Date Grove, Tamarisk), WELLS (by the camps,
   the ksar, the lagoon), Bedouin TENTS (by the camps + a nomads' camp on the plain), sandstone RUINS / stones, a truck
   by the ksar; no log piles, sheds, outhouses, meadow fireflies. Crate ids from 100000 (`DESERT_IDS`); the journal's
   `totals` per world; your camp per world (`Progress.camps`); the title screen's journal shows both worlds.
6. **SOUND** (`Audio.ts`): desert wind over the open sand (day and night), leaves / birds / most crickets only at the
   oasis, no owls; frogs only by the lagoon. (Not listened to — headless; check by ear.)
7. **LOOK** (partial): the desert's day sky more cyan, its horizon a cool white, its haze longer and following the
   horizon by day; the sand a step deeper / more orange (frame stats: whole frame 221 196 170 → 214 188 163, theirs
   213 175 158; sand from the air 223 191 154 → 217 181 139, at the oasis 204 168 120, theirs 213 173 128); no palms in
   the lagoon (its ellipse + margin).
8. **PERFORMANCE** (partial): the desert per tier (`desertcost.mjs`, 1080p uncapped, this PC): LOW 0.38–0.46 ms vs the
   valley's spawn 0.53; ULTRA 0.51–0.85 ms vs 0.97 — no smaller reach / LOD needed for the formations yet; the
   background build's long frames (above).
- `?save=0`: a session that never writes the journey or the journal — use it when testing in a real browser (a test
  drive on :5201 overwrote the user's saved journey, 2026-11-02).

## Done — round 3: THE GPS (2026-11-03, the user: "an option like in GTA 5: in the map we can mark a destination and the map shows the fastest route like Google Maps"; "I don't know how to get to the other map")

- **Waypoints on the map** (MapView.ts, Tab): click / tap sets one (a place or the pass snaps to it; on the pin clears;
  right-click / Del clears); drag pans, wheel / + − zoom, Z whole ⇄ 800 m. TABS for both worlds — the other world's
  chart is baked (`public/oth/<id>/chart.webp`, `scripts/harness/chartbake.mjs`: RE-RUN AFTER A MAP IS REBUILT), so a
  desert place can be picked from the valley. **ROUTE TO THE DESERT / VALLEY** (the foot): straight to the other
  world. The PASS is on the map, the radar and the compass (⇑) now — it wasn't anywhere before.
- **The route** (Nav.ts): the fastest way by time over the tracks (a road graph from `trails.lines`), off-road legs at
  the ends priced on the real ground (slope, forest, rock, fords; cliffs / deep water / the box edge walls; never
  through a trunk or a big boulder), rock-crawl routes only where nothing else goes (the plate warns), drawn
  violet (off-road dashed); a waypoint in the other world routes to this world's pass and on from the other's after the
  crossing. Re-routes when you leave it; "Arrived · <name>" + the chime at ≤ 25 m.
- **The radar** (Radar.ts): the minimap bottom left (top left on phones), turned with the camera, the route, the
  waypoint held at the edge, the next turn + distance + ETA on a plate under it. Compass: the waypoint ◆ and its distance.
- Checked in headless Chrome: `navtest.mjs` (routes to all 24 valley places ≤ 2 ms each, the cross-world waypoint
  before / after a swap), `gpsdrive.mjs` (a bot following the GPS: the ledge road, the swap, on to the desert's Old
  Aqueduct), `navphone.mjs` (the phone layouts). Cost (`abradar.mjs`, 1080p uncapped): radar parked ≤ 0.02 ms, driving
  0.10 ms LOW / within noise ULTRA; a redraw 0.1 ms; the chart 29 ms at 1024² in 2.5 ms slices.
- GPS bot drives (`gpsdrive.mjs`): the Great Cliff's foot → the pass → the swap → the desert's Old Aqueduct ARRIVED
  (12.5 min, ≤ 3.3 m off the route, no re-route); the first try at Old Hut rolled the car on a rock-crawl route taken at
  track speed (→ rock crawls priced 9 km/h, the plate's warning, the bot at the route's own pace), the second hit a pine
  on an off-road leg (→ `Obstacles`), the third stalled on Old Hut's rock-crawl ledges; Birch Hollow Cabin rolled on
  the 752 m rock-crawl stretch east of the spawn. Those stretches are UNAVOIDABLE (priced near-prohibitively the routes
  keep the same rock-crawl metres: the only way east, 203 m on the way to the pass) — the GPS warns; the bot can't
  crawl (a crawling bot — low speed, line choice on ledges — would be the next harness step).
- GPS next: when the destination itself is far from every track (the lake's west-shore camps: 570–655 m), the last leg
  falls back to a straight line that may cross trees — a hint, not a drivable line; the waypoint isn't saved with the journey (GTA doesn't either — `Progress` would need a `waypoint`, and the
  backend's API with it); no pinch-zoom on the phone map (+ / − and drag); spoken / 3D-ground directions not done.

## Reference: Over the Hill's desert (their Algeria region)

Not in the repo (their screenshots are theirs). Re-download: `curl "https://store.steampowered.com/api/appdetails?appids=2929250"`
→ `screenshots[7..13]` (1920×1080) are the desert; also the racinggames.gg Algeria reveal image. What they show:
oasis river winding along a canyon floor (palms, green scrub, round bushes on pale orange sand), red sandstone of
**stacked slabs** (flat tops, rounded edges), tall pointed **spires**, a **natural arch** the track drives over, a deep
**gorge** of huge blocks with rapids and a **plank rope bridge**, a **Roman aqueduct** by an oasis lagoon, **dunes**,
hot pink sunsets, a purple starry night. Measured (day shots): whole frame ≈ sRGB 213 175 158; sky ≈ 229 244 251;
sand ≈ 213 173 128; rock in sun ≈ 213 140 111, in shade ≈ 181 116 99; warm pixels 55–68 % of a frame. Compare
whole-frame colour stats against theirs before tweaking objects (`scripts/oth/compare.py` scores pairs).

## Done — round 4: SLABS, NOT PANCAKES (2026-11-04)

The user: the stacks "look like pancakes"; match their reference frames (`frontend/refer/`). The desert's rock is
angular stacked slabs now — rocky hills, terraces you crawl up, cliffs of slab walls on every steep face, the mesas
and spires rebuilt as stacks, shadows from the stacks in the baked shadow images, clean sand, sharp dunes with rock
shelves, a patchy oasis in a bowl of rock, a skyline of stacks. Details, cost and what's left: `docs/DESERT_MATCH.md` §15.

## Done — round 5: ONE WATER (2026-11-04/05)

The user's screenshots, valley and desert: "two types of water, not connected, one goes above the other — a proper
transition, on the ground, not in the air"; a waterfall standing in the open sand. Now (ARCHITECTURE.md, Water):
- the lake / ponds draw only on their own ground and the rivers / streams only off it (`mapPrep.ts waterOwner`, in the
  worker); where they meet, one surface at one height (`reconcileWater` + `Water.ts meetStill`: the valley's outlet
  was a 1.2 m step — it pours out down a short rapid now) and one look (`stillLook`); a stream fades into the river;
  smooth ribbons (Catmull-Rom, no corners at bends, faded edges); no grass on a lake's floor, no bush in its shallows;
  the car feels the water that's drawn (`MapData.waterAt`). The still levels never move (beaches, docks, the rowboat).
- every fall's sheet starts at its real brink and hugs its face (the valley's Hidden / Veil Falls hung 3–5 m out);
  a fall with no cliff isn't drawn. The desert's Spring Falls pours off a real 60 m cliff (`desert.py head_wall`) into a
  pool, a creek on to the river; the two road crossings of the river are real FORDS (they were dams) — DESERT_MATCH §15.
- Checked in headless Chrome at every junction (scratchpad shots), WebGPU clean both worlds / tiers, `npm test`.
- Left: the valley lake's floor dips toward the drowned river valley at its outlet — a broad darker tongue of real
  depth seen at low angles; the ford's edges follow the road's carve (angular corners); the desert's new cliff face is
  bare heightfield (slab walls can't fit the clearances); `waterOwner` ~200 ms of the worker's load per world.

## Done — round 6: THE MOUNTAIN BIKE (2026-11-05)

The user: "a mountain bike like the stunt bike in GTA 5 … add each and every physics for the bike, the shock absorber
and all". A full-suspension enduro bike and its rider, carried on the car: **B** takes it off (the car parked where it
stands), B again gets back in — or brings the car to you from afar. Details: ARCHITECTURE.md, the mountain bike.
- Our own model (`scripts/oth/mtb.py`, Blender headless, from `mtb.geometry.json` — one geometry for the model, the
  physics and the drawing; a `.blend` in `scripts/oth/.cache/`), drawn in ONE draw with its rider posed by IK.
- The physics (`MtbSim.ts`, 44 checks in `tests/mtb.test.ts`): fork and rear shock (progressive air springs, damping,
  bumpers), tyres per surface, pedalling with 12 gears and a freewheel, discs (skids, stoppies, over the bars), the lean,
  wheelies / manuals, bunny hops, flips and spins, landings, crashes with the rider thrown, a foot down at a stop.
- Ridden by `scripts/harness/bikeride.mjs` in both worlds on WebGPU and WebGL2; WebGPU transpiles clean while riding.
- Left: the chain and the derailleur are built in one gear (they don't move with a shift); the touch pads (HOP, LEAN,
  BIKE) not tried on a phone, nor the bike's cost measured on one; its sounds (tyres, the freewheel's ratchet) not
  listened to (headless); riding isn't saved (Continue puts you in the car, where you were); no stunt scoring (GTA's
  trick points); the thrown rider doesn't meet vehicles; a bunny hop clears ~0.35 m at 15 km/h (a skilled rider ~0.45).

## Done — round 7: THE MOTORBIKE and the touch UI (2026-11-05)

The user: "it's a cycle, not a bike — leave the cycle, we want a proper bike too, like the stunt bike in GTA 5"; and
"the keys are congested and overlapping … make it like GTA 5, all inside a round thing". Details: ARCHITECTURE.md.
- THE MOTORBIKE (F, or the action wheel): a 450 cm³ motocross bike — `MotoSim.ts` is the bicycle's simulation
  (`MtbSim.ts buildBikeSim`) with its own numbers and an ENGINE (torque curve, 5 gears, automatic clutch and shift,
  limiter, engine braking, traction and wheelie control, rear ABS); 13 checks in `tests/moto.test.ts`. Model
  `scripts/oth/moto.py` → `moto.glb`; drawn by the same `Bike.ts` (`MotoBike`); its engine a single-cylinder voice
  of the synth.
- THE RIDER is the user's character (`human/Meshy_AI_Trail_Warden_*.glb`, after `refer/char.png`): `scripts/oth/rider.py`
  (two passes: paint the full mesh, then decimate to 12 k tris and cut into the 12 segments, each straightened into
  Bike.ts's frame, with a SKIN BLEND at the joints — `_PART2 / _POS2 / _NOR2 / _W`, packed with the part into one vec4:
  WebGPU's 8 vertex buffers) → `human/rider.glb`, ridden on both bikes. Left: it's painted by region, not textured (a
  textured export from Meshy would look better); the hands are the model's open hands round the grips; no rig, so
  walking on foot needs one (or an auto-rigged export).
- THE UI: the action wheel (`oth/Wheel.ts`, Q) and full screen (`ui/fullscreen.ts`) in the top-right corner; the
  touch screen keeps only the driving pads; portrait / landscape / short screens laid out; `scripts/harness/uishot.mjs`
  checks every screen at seven sizes for overlaps.
- `?ride=bike|moto` works again (it fired before the car had physics). Cost of the motorbike drawn (abgpu 1080p, the
  chase view): +0.02 ms ULTRA, within noise LOW — with the character rider +0.16 ms ULTRA, within noise LOW.
- Left: the motorbike's model is a first pass (flat plastics, no decals or graphics, the engine simple); its sound not
  listened to (headless — the synth's level checked in Node); not tried on a phone; no stunt scoring; the wheel's
  slots aren't reachable by a gamepad.

## Done — round 9: the character rides; the bail; first person on the bikes (2026-11-05)

- The user: "the human on the bike is broken — I can see through his buttocks and hands, parts are cracked". The
  segment rider (rider.glb) is retired from riding: the SKINNED character rides both bikes (`Character.rideOn`, the
  targets from `Bike.riderT`: hips, lean, grips, ankles — IK for the limbs), leaning as a rider does.
- THE BAIL, GTA's: thrown off, he tumbles with the crash's body (the camera on him); at rest he gets up (Mixamo's two
  "Getting Up" clips, from his back / his front — `getup_back`, `getup_front`) and you're on foot; F by the fallen
  bike gets back on.
- FIRST PERSON on the bikes: from his head, a 70° lens, sat up and tipped down so the bars and his hands are in view.
- Then (the user: "first person must be his eyes, not above his head — on the bikes, walking, whatever"; "inside the
  jeep it's tilted to one side"; "remove the black / brown from the hands"): the camera at his eyes in every mode
  (found on the mesh, carried on the head bone; the walk's bob steadied); the G500's dashboard screen — yawed 21°
  across the windscreen in the model — straightened and brought down to its real height (`scripts/oth/g500_dash.py`);
  the hands bare (the glove band painted as patches).
- Then (the user, after Over the Hill's cars: "ours are shiny, glossy"; "from inside the car the water isn't
  visible"): every vehicle MATTE, all its bodywork (every colour — not the tyres) with a RELIEF of tiny raised grains
  (light only — each the colour of what it's on; sand up close, ~1 cm dots further off, so the top of the car shows
  them too); the windows stop writing depth (the water shows through them); the grass
  pressed flat under the car (it grew through the BMW's dash). The grain: +0.06 ms ULTRA, +0.08 ms LOW (1080p).
- Every game starts IN THE CAR (the user: "the default is the car, not the cycle"; "he must stay in his car — the bike
  only if you select it in the garage"): the Garage's motorbike holds for the session, not the next load
  (`loadSettings`), and ?ride= is honoured only in a test session (?save=0 — an old link kept starting him on a bike).
- THE BICYCLE IS OUT OF THE GAME (the user: "remove the cycle — we only need cars and the bike"): not built, not
  loaded, not in the Garage (`RideId` 'car' | 'moto'); the motorbike's physics are still `MtbSim.ts buildBikeSim` (its
  tests stay); the harnesses (bikeride, bikeshot, uishot) use the motorbike; `mtb.glb` / `mtb.py` kept, unused.
- Checked headless (WebGPU, WebGL2): the riders from three sides, a crash on each bike through to getting back on,
  first person on each; `npm test` and the build pass; uishot all clear for the bike / moto screens.
- Left: the bail capsule rolls on its long axis while it slides (he spins a little before he lies still); no
  hit-the-ground reaction (GTA IV's Euphoria) — the falling clip until he rests; getting on / off a bike is still
  instant; rider.glb is now only the fallback when character.glb fails to load.

## Done — round 8: ON FOOT, the character animated; the motorbike climbs (2026-11-05)

- The character (the Trail Warden) rigged in Blender, 17 Mixamo clips retargeted (`scripts/oth/character.py`,
  `scripts/harness/mixamo.mjs`), walking / running / sprinting / jumping / falling / landing / grabbing on foot
  (`Character.ts`); F out of the car (the driver's door opens, the exiting-car clip) and back in, off a bike (parked)
  and back on. The motorbike ~80 hp with a climb assist (hills to 70°). Details: ARCHITECTURE.md.
- Then (the user's notes): the butt's wobble (the hip weights), the jump (in step, no rise of its own, arms layered),
  the door in step with the hand, a door camera, F / the touch DOOR button only, the vehicle chosen in the GARAGE (the
  wheel keeps the rare things), the pick-up removed, a touch STICK on foot, ambient occlusion on the character.
- Then: the jumps swapped for Mixamo's game-pack ones (GTA's short hop — the first read "like Spider-Man"), timed from
  their hips; GTA V-style locomotion (one phase-synced blend, weight, lean, head look, foot IK); the API badge.
- Then: V first / third person (Shift + V free), the cockpit drawn (wheel, pedals, wipers — P), the driver seated with
  his hands on the wheel, the proportions and the face.
- NEXT (asked, not done): the G500's REAR DOORS (cut from the body in Blender) and a SEAT per door — entering by the
  nearest free one (mirrored clips for the right side), passengers (4 in the G500, 2 in the E30, a pillion on the
  motorbike — for multiplayer); the car knocking the character down.
- Left: the LEDGE grab and climb (the clips are in, not wired); getting on / off a bike is instant (no clip); no footstep sounds; the
  character is flat-coloured with baked shading — REALISM needs a texture: the full turnaround sheet (front, side,
  back, large) to project, or a textured export from Meshy; after getting out the chase camera can rise over the car
  (the character faces away from it).

## Next, in order

1. **Look**: the sky still short of their cyan-white (the light clouds grey it; try fewer clouds in the desert's clear
   spell); the arch reads as masonry — rounder, more irregular beds, a thicker crown; the escarpment's bastion sides
   are flat planes (strata / skins on them); the ksar wants crenellations, doorways, a mud-brick tint; spire shards at
   a few bases; vertical shadow streaks on steep faces; the lagoon / river colours vs theirs.
2. **The crossing, polish**: the valley's plateau top is plain (it's in the cloud, but a cairn or a shrine at the gate,
   a few pines in the mist would sell it); a muffled sound in the mist; a short "the other world is still loading"
   hint if the car reaches the wall before the build is done (never seen on this PC: ~1–2 s builds).
3. **Performance**: slice `Rocks` placement (~25 ms) like the trees; the impostor bake (15–34 ms, GPU) could be done a
   species a frame; measure phones (a device, not the headless phone viewport).
4. **Saves**: `Progress.camps` and `Journal.totals` (per world) changed shape — keep the backend's API in step when it
   lands (the `backend/` folder isn't in this repo yet).

## Harness

`frontend/scripts/harness/` (headless Chrome via puppeteer-core — Windows and macOS paths; the dev server on :5200):
`rockdrive.mjs [tier]` (the car driven into the desert's slab stacks: the physics step, the colliders, frames, time
stuck, a wheel's ray in rock — `SITES='[[x0,z0,x1,z1]]'`, `SHOTS=<dir>`),
`climbtest.mjs` (a STEERING BOT on the crossing's roads: `START=world:x,z DIR=out|in SECONDS=` — pure pursuit, slows
for hairpins, reports falls / flips / stalls), `crosstest.mjs` (the car driven through the gate and back: the swap, the
longest frames, GPU memory), `cliffshot.mjs <dir> [tier]` (still views: `WORLD=`, `VIEWS='[[name,x,z,h,yaw,pitch,hour]]'`,
`Q=` more URL — yaw 0 looks NORTH, −z; to face (tx, tz) from (x, z): `atan2(−(tx−x), −(tz−z))`), `abweather.mjs [tier]`
(the mist / sandstorm on vs off), `desertcost.mjs low,ultra` (the desert per tier beside the valley), `desertshot.mjs`,
`oasisshot.mjs`, `swaptest.mjs`, `buildprof.mjs`, `abprops.mjs` (macOS paths), `sheet.py`.
Rebuild — the valley: `terrain.py` → `scenery.mjs` → `valley_cliff.py` (`blender -b --factory-startup --python
scripts/oth/valley_cliff.py -- OUT=public/oth/valley PREVIEW=<png>`; after a new bake delete `scripts/oth/.cache/
valley-base`). The desert: `desert.py` (~2 min) → `desert_rocks.py` (reads `.cache/desert.npz`; writes formations.glb
and structures.json). Blender: `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe` on this PC.
