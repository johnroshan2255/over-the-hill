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
| **Outland** | ranges and peaks (30 peaks, the highest 1 210 m), cliff-walled gorges, ~117 k trees, 10 ranger towers, 12 gorge bridges. **No tracks, bushes, boulders or other places out there yet** |
| **Spawn** | moved to the track by Eagle Point (rock hill inside the old valley); the old one kept as `meta.spawn0` |
| **Buildings' look** | flat colours (one muted colour a material, no photo scans) on the valley's buildings, ruins and the building kit. Shapes unchanged. `?flat=0` shows the scans |
| **Frame rate (M4, ULTRA 1080p, headless)** | `fps.mjs ultra` mean 1.58 ms (631 fps), every measured view ≥ 500. Three places measured under 500 before the outland work (below) |
| **Phone** | never measured on a real device. The phone path (LOW, `mobile=1`) loads without errors — that is all that is known |

## 2. What to do next, in order

1. **Tracks in the outland** (the towers and bridges are off-road only until then).
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
