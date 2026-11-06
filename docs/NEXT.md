# overhill — what's next (hand-off, 2026-11-06: the valley's places and caves)

Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first ("Make the Valley great — stage 2" and "The caves, as land").
The previous hand-off (the desert and the crossing) is in git: `git show 3a28864:docs/NEXT.md`.

## Where it stands

**Nothing is committed.** The working tree mixes two sessions' work:
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

## 1. THE FIX: the caves' rock reads as cement, not as the terrain's rock (the user, 2026-11-06)

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

**The fix, in order. Check each step visually against a terrain cliff in the same frame:**
1. **Outside: no separate cliff faces where possible.** Let the hill's turf mesh itself come down over the front and the cut. The turf already paints rock where it's steep (vertex z = rock share, `fillK`). That surface is exactly what the user liked on top. Concretely:
   - In `cavern()`, extend the hill grid forward past the mouth and use a steep falloff instead of the vertical face.
   - Cut the mouth's arch out of it. The jagged edge can be hidden under a thin cliff "lip" (a ring, a couple of metres deep) or snapped to the arch, as the skylight's hole does: grid vertices inside it are pushed out to its rim.
   - Do the same for the tunnel's cut walls: make the cut a steep turf slope rather than a wall.
2. **Inside, and any rock that remains: FACETS, not plaster.**
   - Give `smoothMesh` a `flat` option: each triangle gets its own vertices and its face normal.
   - Rebuild the cliff shells at about 1.5–2 m triangles.
   - Displace them with ridged fractal noise (2–3 octaves, about 0.6–1.5 m) instead of the slow `wobble` bulges.
   - It should look like the terrain's low-poly mountains.
3. **The terrain's relief on the cliff surface.**
   - Include `ROCK_RELIEF_GLSL` in the Bridges FRAG, under the same `OTH_ROCK_RELIEF` define the tier sets (see how `Rocks.ts` includes and calls it).
   - Apply it to `SURF.cliff` only.
   - Measure it with `cavecost.mjs`, since it adds a few texture fetches per pixel on the rock.
4. **Paint.** Drop the beds (`bed` / `band` in the cliff branch), or make them faint and broken. Then match the slab colour and value to the terrain's rock side by side, both in the sun and in shade (the `rockFill` is already there).
5. Re-shoot with `node scripts/harness/caveshot.mjs <dir>` (`ONLY=Sky` for one cave) and show the user before going further.

## 2. Other fixes, smaller

- **Sky Hollow's front face** is one big flat trapezoid. Taper it into the hill at the sides and break it with grass ledges. This mostly goes away with fix 1.1.
- **Glare through rock.** The sun's glow sprite shows through cave roofs (a star on the vault in the tunnel and the hall). `Glow.ts` draws it without testing occlusion. Hide it while the camera is in a cave: `caveK` at the camera, done on the CPU in `main.ts`.
- **Drive into every cave with the car and the bike.** The colliders are boxes: the walls, the hill's bulk by rows, and a lid over each roof. Check that nothing snags at the mouths and that the floors are drivable (the skylight's mound especially). `scripts/harness/rockdrive.mjs` / `trackdrive.mjs` are a start.
- **Phone.** Measure the caves with `PHONE=1` (`absites.mjs` has the phone viewport; `cavecost.mjs` doesn't yet).
- **Notes.** Sky Hollow and Bear's Den have none (`NOTES` in `Sites.ts`, keyed by name). The Ranger Station's note mentions "the grotto"; keep the story consistent.
- **Crate ids.** After the data changes, re-check that every crate keeps its id with `?sites=0` vs `1` (it held at 72 before).
- **Tunnel cut and portal faces.** Covered by fix 1; they are the smoothest, most "cement" parts now.
- **Commit.** Ask the user: separate commits for the other session's water/track work and for this (places + caves).

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
