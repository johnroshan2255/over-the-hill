# overhill — what's next (hand-off, 2026-11-06: the valley's places and caves)

Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first ("Make the Valley great — stage 2" and "The caves, as land").
The previous hand-off (the desert and the crossing) is in git: `git show 3a28864:docs/NEXT.md`.

## Where it stands

**Committed in `28e074b`** (both sessions' work together); the caves' round 2 (section 1) is not committed yet. That commit holds:
- **This one (places and caves):**
  - New files: `Kit.ts`, `Locations.ts`, `Sites.ts`.
  - Changes in `Landmarks.ts`, `Bridges.ts`, `Atmosphere.ts`, `Terrain.ts`, `Rocks.ts`, `Bushes.ts`, `Places.ts`, `Props.ts`, `World.ts`, `main.ts`, `MapData.ts`, `Chart.ts`, `paint.ts` and `index.html`.
  - Harness scripts: `absites.mjs`, `abverge.mjs`, `cavecost.mjs`, `caveshot.mjs`.
- **The other session's:**
  - `Grass.ts`, `GroundCache.ts`, `Trees.ts`, `treeGeometry.ts`, part of `Terrain.ts`.
  - The valley's data: `public/oth/valley/{height,far,trail}.bin`, `meta.json`, `chart.webp`.
  - `trackdrive.mjs`, `trackgrade.py`, `trackscan.py`, `waterdump.mjs`.
  - Its own changes in `Props.ts` and `World.ts` (the water and the tracks).

The valley's data changed, and the new places are planned from it on every load (`Sites.planSites`). Where each place lands may therefore differ from the last screenshots. Re-shoot before judging.

What's in, working:
- **Valley details:** verge stones and logs, field paint, light.
- **Places:** composed places (cabins with paint and porches, the mine site, four camp styles, docks, the hamlet, ruins, garage, ranger station, the Hollow House with its flickering window), night windows, smoke columns, and notes (11 + the cave ones; 15 coins on first read).
- **The caves:**
  - **Lantern Tunnel:** the track through a grassy hill.
  - **Sky Hollow:** a dome with a hole in the roof and pines growing in the shaft of light.
  - **Crystal Grotto:** a long gallery with the survey's camp.
  - **Bear's Den:** small and low.
  - Every cave is one way in and has its own shape.

Cost, measured: ULTRA 1080p +0.02 to +0.14 ms at a cave; the worst view is 1.34 ms (745 fps, deep forest). LOW adds at most 0.18 ms. Elsewhere ULTRA averages 0.787 ms (about 1270 fps). The details are in `docs/PERF.md`.

## 0. THE CAVE WORLD (2026-11-07) — replaces the procedural caves (ARCHITECTURE.md "The cave world — Sky Hollow")

Done: modelled in Blender (`scripts/oth/caves.py`), exported (`public/oth/valley/cave.glb` + `cave.json`), placed,
laid on the land, painted (grass gold and green with rock patches, the terrain's rock inside), pines on top and in the
skylight's garden, collision, the dark, the drivable lane (`cavedrive.mjs`: to the far chamber, no flip). The
procedural tunnel and the three grottos are gone (Locations.ts' caves, Sites' tunnel / grotto picks). Sections 1 and the
caves' items in 2 below are history.

Round 4 (2026-11-07, the user: "twice the height; on top like the terrain — rock no grass, green grass on green, yellow on
yellow; a gradual transition, not a sticker"): every roof twice as high over its floor (caves.py `TALL`, `_taller`;
floors, the lane, the pools, the Haven unmoved), the hill ~77 m (its blobs raised), the arch scaled with the mouth.
The hill's turf paints from the land's MASK as the terrain does (Bridges `uMask` / `uMaskGrid`; CaveWorld.grassOn writes
the hill's rock as smooth ramps into R and its dryness, softened over 20 m, into G — the blades read the same).
The turf shader: the paint blended across the floor→wall bend (no stepped line), a ragged wide grass → soil →
rock band, the lit-blades normal bend eased out over it; inside per pixel from the slope (grass up, rock on the walls,
moss-green on ledges, green / gold patches). Views on the top: `cavecheck.mjs` o_top / p_top_rim / q_top_flank.
Next:
- **The user's idea: the cave as its OWN small world** (~400 m, Draco; the outside unloaded while inside — World.ts's
  swap, as at the pass). Then the deep parts can go under the land.
- Water in the far chamber's basin; the hill's shadow on the land (TerrainShadow: the TOP grid into its heights).
- The garden turf's edge shows a seam on the rock floor (separate meshes): blend it.
- The terrain's own ground shows a little at the mouth's threshold (a gold patch on the floor just inside the arch).
- Measure on a phone (the cave's inside: ~200 k triangles, its trees and bushes — only drawn from in or near it); the
  inside's cost in the great hall is +0.6 ms ULTRA on the M4 (the growth) — LODs for the tufts / a lighter far LOD.
- A faint dotted line on the hill from afar (the grass field's far edge crossing the slope, likely) — check.
- The lake / ponds are flat dark water: a reflection, a ripple.
- Old saves: the places after it got new ids (the four caves became one) — a found-flag may point at the wrong place.

## 1. DONE: the caves' rock read as cement, not as the terrain's rock (the user, 2026-11-06)

The user's words: *"i asked u to change the rock part to the texture the outside and top where we used the normal terrain was really good, now it's like a cement building."*

**What the user liked** was:
- the HILL itself: its turf, `SURF.turf`, the field's own `grassPaint`, with bare rock where it's steep;
- the real terrain around it;
- the terrain's own rock: faceted, blue-grey, crumpled.

**What they dislike** is everything in `SURF.cliff`:
- the mouths' faces;
- the tunnel's cut walls and portal faces;
- the vaults and domes;
- the passages and the skylight's shaft.

**Why it reads as cement:**
- `smoothMesh` (`Locations.ts`) gives the cliff shells *smooth* normals over big, slow bulges (`wobble`). The result is large, soft, plastered surfaces.
- The cliff paint (Bridges FRAG, `surf > 7.5`) adds horizontal "beds" every 1.35 m. Those read as concrete pour lines or building courses.
- The terrain's rock looks good for three reasons, and the caves have none of them:
  1. its FACETS: the heightfield's triangles, about 2 m, flat-ish;
  2. `ROCK_RELIEF_GLSL` (`rockRelief.ts`): per-pixel crumpled creases on HIGH/ULTRA, also used by the boulders (`Rocks.ts`);
  3. its paint varies with steepness and comes in broad tones (`paint.ts`: slab, streaks, lichen, `rockFill`).

**DONE (round 2, 2026-11-06; the user then asked for it "like in Genshin Impact").** Re-shoot with `caveshot.mjs`.

Fix 1.1 as planned (turf down over the faces) was not done. Chunky rock FACES with moss on their ledges, and the hill
swept down beside them, read as Genshin's cave mouths. They also keep the meshes that the colliders and `dressHills`
already know. What was done (ARCHITECTURE.md "The caves, as land" has the how):
- **Facets, not plaster.** Every cliff shell goes through `rockMesh`:
  - it is pushed out and back by `rockField` (ridged 3D noise: chunks ~7 m, crumples ~2.5 m, wandering ledges ~2.7 m;
    about ±1 m);
  - each triangle is drawn flat with its own normal, darker in the hollows;
  - shared edges move as one (`D`), the turf's edge stays put (`K` = 0), and coincident vertices share a normal;
  - sizes: dome facets ~1.6 m (`T` from its size), the cavern face 8 rows, the tunnel's vault 24 round.
- **The hills' steep parts** are rock the same way (`hillMesh`: gently pushed, faceted). The rest is smooth turf.
- **Paint** (`rockPaint`, Bridges FRAG):
  - the beds are gone;
  - the terrain's slab grey in broad tones, read on each facet's own plane (the old projection smeared);
  - streaks, and MOSS on what faces up;
  - `ROCK_VALUE` 1.55 sets its value against the terrain's rock. Checked side by side: the tunnel by the grey
    boulders, the grotto under the grey hills.
- **The terrain's relief** (`rockRelief`) on the cliff and on the turf's rock, HIGH / ULTRA.
- **Shapes:**
  - Sky Hollow's trapezoid is gone. The hill sweeps down beside the mouth (`cavernLand`: the front's depth `fr` grows
    with |x|; `M` extra rows in front of the hill's grid draw the slopes).
  - The tunnel's cut leans back from the face itself (no vertical edges), and its arches are uneven at the mouths too.
  - The dome's ring now closes (its wobble wrapped). There had been a crack of daylight at th = 0 since the first
    version.
- **Cost:** within noise (PERF.md).
- **Harness:** `caveshot.mjs` and `cavecost.mjs` now find Chrome on Windows too.
- **Also fixed: grass on rock** (the user's screenshot of a track's cut, grey with a meadow on it). The grass bake
  read the ground's normal blurred (mip 2.5), so narrow steep cuts the terrain paints as scree grew grass. It now
  reads mip 0, as the terrain does up close, and stops a little short of scree (ARCHITECTURE.md "No grass on stone").
- **Also fixed: patchy rock** (the user's screenshots: a rock hill crumpled in blocks, smooth between). The ground
  cache baked the relief weaker than the live steep walls drew it; now the relief is live on all rock, exactly as on
  2026-11-04, and the cache keeps everything else (ARCHITECTURE.md "The rock's relief is LIVE"). No measurable cost.
  The user rejected painted creases and a sunlight gain: keep the relief as it was. **To do: confirm on the Mac
  mini** (the user's 500+ fps at ULTRA): \`node scripts/harness/abq.mjs "" rockhill,spawn,forest,cliff 4\` before and
  after this change.

**Still open on the look** (ask the user first; they've not seen round 2):
- Sky Hollow's hill top is flat and its sides steep, so from above it reads as a mesa. Rounder shoulders would help.
- Genshin-style touches not tried yet:
  - grass spilling over the face's brow (longer tufts, `tuftMesh` lean);
  - the crystals tinting the walls near them;
  - a warmer lit / cooler shaded rock.
- Sky Hollow's floor climbs steeply from the mouth to the chamber (the passage keeps the mouth's height, `y0`). So
  from the chamber, looking out, you face the dome wall above the passage. `caveshot`'s `e_inside_out` shows only rock
  there (it did before round 2 too). This is part of the drive-in check below.

## 1b. The frame rate round (2026-11-07) — docs/PERF.md "2026-11-07"

The user: travel the whole valley, fix every sudden fps drop, 500+ fps at ULTRA on the Windows laptop (Ryzen 7 +
RTX 4050), 700+ on the Mac mini, 100+ on a Chromebook / small phone — never at the cost of the look.

- **Done (all CPU-side, pixel-identical — `pixdiff.mjs`):** PlayCanvas's release build in dev (`vite.config.ts`;
  `PCDEBUG=1` for the debug one — this also makes `vite build` work again); the gfx layer's frame (uniforms bound once,
  no key strings / sets / attribute lists a frame, hidden meshes not re-prepared, `OthMaterial`); the driving HUD
  written only on change; instancing buffers sized to what's drawn (the 20–96 ms hitches); the horizon built a slice a
  frame; the garbage cut (158 → 89 KB a frame).
- **Tools:** `tour.mjs sweep` (every track every 150 m + every place: the GPU cost spot by spot) and `tour.mjs drive`
  (the camera down every track at 25 m/s: each frame, each system — the hitches and where); `pixdiff.mjs` (the same
  picture? two servers, with the noise floor); `playchrome.mjs` (a VISIBLE Chrome, uncapped, the car driven with the
  keys, the overlay); `abq.mjs` variants take `port=N` (a second dev server: e.g. a copy of the old code).
- **Where it stands (this laptop, ULTRA 1080p uncapped):** spawn driving 373 → 687 fps, forest 509 → 782, lake 543 →
  801, cliff 560 → 790, rockhill 521 → 913; the whole valley driven at 25 m/s: mean 794 fps, 0.22 % hitches; a visible
  Chrome with the car driven: 614 fps (PERF.md has the tables). The terrain shadow's bake (every ~12 s of play): 5.2 →
  3.0 ms.
- **Open — the collection stall:** every 30–50 s, uncapped, a MAJOR garbage collection gives 1–2 s of 20–60 ms frames
  on the dev server; the production build (`npm run build` then `npm run preview`) only ~0.5 s of 10–20 ms. What's
  promoted is PlayCanvas's per-frame frame graph and WebGPU objects (~2.4 KB a frame) — the next lever, inside
  PlayCanvas. (Ruled out: physics, the JS heap's size, the uniform staging.) Play / judge fps on the production build.
- **To do:** re-run on the Mac mini: `node scripts/harness/abq.mjs "" spawn,forest,lake,cliff,rockhill 4` and
  `node scripts/harness/tour.mjs drive` — the M4's CPU is faster, so expect more than this PC's gains. A phone /
  Chromebook needs measuring on the device (`phone.mjs`); a 60 Hz screen caps Chrome at 60 fps, so "100+" there needs
  a 90 / 120 Hz screen. The garbage left (~89 KB a frame: Rapier, PlayCanvas's own, the terrain select) is the next
  hitch source to cut.

## 2. Other fixes, smaller

- **Glare through rock.** The sun's glow sprite shows through cave roofs (a star on the vault in the tunnel and the hall). `Glow.ts` draws it without testing occlusion. Hide it while the camera is in a cave: `caveK` at the camera, done on the CPU in `main.ts`.
- **Drive into every cave with the car and the bike.** The colliders are boxes: the walls, the hill's bulk by rows, and a lid over each roof. Check that nothing snags at the mouths and that the floors are drivable (the skylight's mound especially). `scripts/harness/rockdrive.mjs` / `trackdrive.mjs` are a start.
- **Phone.** Measure the caves with `PHONE=1` (`absites.mjs` has the phone viewport; `cavecost.mjs` doesn't yet).
- **Notes.** Sky Hollow and Bear's Den have none (`NOTES` in `Sites.ts`, keyed by name). The Ranger Station's note mentions "the grotto"; keep the story consistent.
- **Crate ids.** After the data changes, re-check that every crate keeps its id with `?sites=0` vs `1` (it held at 72 before).
- **Commit** the caves' round 2 when the user has seen it.

## Where things are

| what | where |
|---|---|
| the kit (walls, roofs, windows, tents, docks, trucks, rock chunks) | `src/oth/Kit.ts` |
| the places' compositions; the caves (`tunnelHill`, `tunnel`, `cavernLand`, `cavern`, `smoothMesh`, `wobble`, tufts) | `src/oth/Locations.ts` (the caves: from "THE CAVES") |
| where the new places go, the caves' darkness (`caveUniforms`, nearest three per frame), trees lifted onto hills (`dressHills`), notes | `src/oth/Sites.ts` |
| the surfaces' shading (`SURF`: wood, stone, metal, fabric, plain, lamp, eerie, turf, cliff) | `src/oth/Bridges.ts` FRAG |
| a cave's darkness in the shaders (`caveK`, the skylight's lit column in `B.w`) | `src/oth/Atmosphere.ts` |
| each kind built (PLACES table) | `src/oth/Landmarks.ts` |
| build order (plan → keep discs → dress hills → trees and bushes → landmarks) | `src/oth/World.ts` |

**Gotchas:**
- The gfx layer drops GLSL uniform arrays: use single vec4s.
- Editing `src/` during a harness run makes Vite reload and kills the run.
- `map.trackDist` saturates a few metres off a track. For direction, use `toTrackPt` in `Sites.ts`, which samples track points every 6 m.
- `Sites.ts` was emptied once by a bad script this session and rebuilt from the session's edit record. It compiles and works, but commit it soon.

## Checking

```
cd frontend && npm run dev                                  # (port 5200 for the scripts)
node scripts/harness/caveshot.mjs <dir>                     # every cave: front, side, above, inside, skylight
node scripts/harness/cavecost.mjs ultra                     # ?sites=0 vs on at each cave (and `low`)
PORT=5200 node scripts/harness/absites.mjs ultra            # every new place (heavy: if it gets killed, use cavecost)
npx tsc --noEmit -p . && npm test
```
