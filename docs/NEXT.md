# overhill — where it stands, what's next (hand-off, 2026-11-02)

Read `docs/ARCHITECTURE.md` and `CLAUDE.md` first. This file is the to-do list for the **second world (the desert)
and the crossing between worlds**. The user's asks, in their words: *"do the cliff and path, not a bridge, it will walk
you through a fog then gradually the old world will disappear, we will entirely remove it … use workers and then load
the other world"*; *"Red desert canyons — check Over the Hill's desert and make it exactly like that"*; *"make this new
map in Blender so you can sculpt desert cliffs, rocks and all, also the oasis"*; *"we will have a sand storm at some
time, use a filter for that, and sands like in Over the Hill — the real looking thing"*; *"stones low poly like in the
valley"*; *"don't use the valley trees there, use the things in Over the Hill"*.

## Done

- **Worlds you can swap at runtime** — `src/oth/World.ts`: everything built from one map (terrain, grass, rocks,
  water, falls, trees + impostors, bushes, horizon, bridges, glow, places/landmarks/props, birds, formations) under one
  group, built in steps (`pace` = one frame between steps while playing) and **disposed whole** (geometries, materials,
  textures, the impostor atlas; `keep` = the textures that last). What lasts across worlds is in `main.ts`: renderer,
  camera, Atmosphere, car + physics (`OthPhysics.setWorld` swaps every collider), sound (`OthAudio.setWorld`), HUD,
  terrain shadow (`TerrainShadow.setMap`), the winch (`setWorld`), the map view (rebuilt). They read the current map
  through `liveMap()`. `main.ts` has `buildWorld(id)` + `enter(world)`; the harness has `__oth.swapTo('valley'|'desert')`
  and `__oth.gpuMemory()`.
  - Measured (valley → valley ×3): GPU geometries / textures / programs come back to the same counts every time (no
    leak); longest frame while a world builds ~40 ms (trees / bushes placement on the main thread), after entering
    ~20 ms.
- **Workers**: `mapLoad.worker.ts` fetches a world's files and computes heights, normals, the track / shore distance
  fields and the terrain's height pyramid (`mapPrep.ts`), arrays transferred, no copy (was ~200 ms on the main
  thread). Leaf / frond textures are made once (`leafTexture.ts`, `userData.shared`). Draco decoding (formations) runs
  in DRACOLoader's workers (`public/draco/`). The new world's textures are uploaded one a frame and its shaders
  compiled (`compileAsync`) before it is entered.
- **The desert** — `?world=desert` (or a save there) boots it.
  - `scripts/oth/desert.py` (Blender + numpy, `terrainlib.py` helpers): the plain, the north plateau (spire field),
    the high south plateau (the pass) with the escarpment, the oasis canyon W→E (buttressed two-tier walls, the river,
    the lagoon, a waterfall at its head), the gorge (east) with a plank bridge, the arch's slot, 10 mesas, 59 spires, a
    dune sea (two crossing crescent trains) in the south-west, the beds TERRACED into every steep wall (9 m beds),
    ledge roads cut into the cliffs (switchbacks down the escarpment, ramps on the canyon walls) + A* roads between,
    masks (R rock, G loose sand, B wet/water, A oasis growth), `meta.json` with `biome: 'desert'` and the `gate`.
  - `scripts/oth/desert_rocks.py` (Blender): the **sandstone skins** — for every bed, the contour at the riser's
    middle where the ground is steep, a 6-point low-poly profile swept along it (bulge, tuck, lip), jittered facets,
    cracks every 12–35 m → `public/oth/desert/formations.glb` (Draco, ~1.1 MB, ~270k vertices, 256 m cells).
    `src/oth/Formations.ts` draws them (reach by tier, frustum, Horizon), flat-faceted like the valley's rock.
  - Biome switch `OTH_DESERT` (MapData `desert` / `biomeDefines`) through Terrain (sand palette, sandstone beds, wind
    ripples, no green ledges), Grass (oasis only, green), Rocks (sandstone), Bushes (OTH's light yellow-green round
    bushes, oasis-heavy), Trees (**date palms** — `palmGeometry()` in the broadleaf family's place, impostors baked
    from it), Water, Atmosphere (`desert`: pale cyan-white sky, cream horizon, pink sunsets, purple night, warm haze,
    clearer air, warm sand bounce).
  - Rebuild: `cd frontend && blender -b --factory-startup --python scripts/oth/desert.py -- OUT=public/oth/desert
    PREVIEW=<dir>` then `blender -b --factory-startup --python scripts/oth/desert_rocks.py -- OUT=public/oth/desert`
    (the second reads `scripts/oth/.cache/desert.npz`, git-ignored).

## Reference: Over the Hill's desert (their Algeria region)

Not in the repo (their screenshots are theirs). Re-download: `curl "https://store.steampowered.com/api/appdetails?appids=2929250"`
→ `screenshots[7..13]` (1920×1080) are the desert; also the racinggames.gg Algeria reveal image. What they show:
oasis river winding along a canyon floor (palms, green scrub, round bushes on pale orange sand), red sandstone of
**stacked slabs** (flat tops, rounded edges), tall pointed **spires**, a **natural arch** the track drives over, a deep
**gorge** of huge blocks with rapids and a **plank rope bridge**, a **Roman aqueduct** by an oasis lagoon, **dunes**,
hot pink sunsets, a purple starry night. Measured (day shots): whole frame ≈ sRGB 213 175 158; sky ≈ 229 244 251;
sand ≈ 213 173 128; rock in sun ≈ 213 140 111, in shade ≈ 181 116 99; warm pixels 55–68 % of a frame. Compare
whole-frame colour stats against theirs before tweaking objects (`scripts/oth/compare.py` scores pairs).

## Next, in order

1. **THE CROSSING** (the user's main ask, not built yet). Design worked out:
   - **Mist**: two uniforms in `Atmosphere` (`uMist` 0…1, `uMistColor`) used in `ATMOS_GLSL`: `fogAmount` →
     `max(haze, 1 − exp(−d · 0.32 · uMist³))` (thick: ~10 m visibility at 1); `fogColor` and the end of `skyColor`
     mix toward `uMistColor` (the horizon's luminance as a grey-white, so it darkens at night). Every material copies
     `atmos.uniforms` at creation, so add them in the constructor.
   - **Building in the background must not touch the shared terrain shadow**: add a `background` flag to
     `World.build` — skip the `shadow.setMap` step and the Trees constructor's `shadow.setTrees` (give Trees a
     `shade = true` parameter); `enter()` already calls `adoptShadow` (setMap + reshade) at the swap.
   - **`Crossing.ts`** controller (per frame, car position): gate = `world.map.meta.gate` ({x, z, y, heading}:
     heading = the direction OUT of that world, 0 = −z). Mist target `1 − smoothstep(60, 520, d)`, eased. Start
     `buildWorld(other)` when d < 1100 m; dispose a built-but-unused world when d > 1600 m. Swap when the car crosses
     the gate line outward (`dot(p − gate, outDir)` changes sign, lateral < 30 m) and the world is ready: `enter(next)`,
     then shift the car (`Vehicle.shift(dx, dy, dz)` exists — keeps its speed), the chase / fly cameras, clear the
     dust / tracks, by `gateDest − gateSrc`. The two gates' headings must be opposite (`h_dest = h_src + π`): then
     it's a pure translation. If the next world isn't ready the car meets the box wall 18 m on (in the mist).
   - **Desert gate**: in `desert.py` `GATE = (-120, 1990)`; set its `heading` to **π** (out of the desert = south).
   - **The valley's GREAT CLIFF** (a post-process script over the valley's files, e.g. `scripts/oth/valley_cliff.py`,
     always starting from a backup of the originals in `.cache` so it can re-run after `terrain.py`): measured the
     valley's north-east — a shelf at ~200–224 m around x ≈ 950, z −1100 … −2000, mountains rising east of it; track
     73 ends at (764, −1122). Raise a ~300 m sandstone-free valley-rock cliff along z ≈ −1700 … −1820 (x 700–1300) up
     to ~520 m, the far grid behind it raised too (a plateau that continues north out of the box); cut a **ledge road**:
     ~7 switchback legs east–west across the face (x 760–1240), ~42 m up each, ~9 % grade; then the pass north on top
     to the **valley gate (1000, −1990), heading 0**; a new track from (764, −1122) to the cliff's foot. Terrace and
     skin the cliff the valley's way (grey slabs), add the new track to `meta.trails`, and `gate` to `meta.json`.
   - The ground at both gates should look alike in the mist (a neutral rock road) — or keep the mist ~85 % at the
     car's distance at the swap.
2. **Sandstorm** (desert weather instead of rain): `Atmosphere.weather` gets a `sandstorm` spell in the desert
   (Shift+G steps to it); a warm orange "filter": the fog range collapses (~60–120 m), fog colour dusty orange, the
   sun dimmed, sky → dust; blowing sand streaks (reuse `Rain.ts`'s particles: horizontal, sand-coloured, fast); the
   synthesized wind (Audio) loud + hiss; a light CSS/canvas grade only if needed. Cheap: it's the fog every shader has.
3. **Sand like theirs**: ripples are in (Terrain, desert only); add deeper tyre tracks in loose sand (`TyreTracks` —
   longer-lived, darker in sand), sand spray / dust colour from the ground (`Dust.ts` reads the mask), the car's sand
   coat (a `uSandCoat` on the car material that builds while driving on sand, washes in the oasis water).
4. **Formations**: the natural ARCH (a Blender mesh in `desert_rocks.py` — a stack of slab segments along an arc over
   the slot at (1180, −760), its deck drivable → a trimesh collider in `Physics`), the gorge's big blocks, the
   AQUEDUCT (Blender arches, sandstone ashlar) at (-560, 600) → (-90, 560), the KSAR ruins (980, 1020), a proper rope
   bridge for the gorge (the plank Bridges.ts bridge is 80 m up on tall posts now). Landmarks of these kinds draw
   nothing today (`KINDS[kind]?.`): their meshes come from Blender.
5. **Desert places & props**: `Places.ts` is valley-specific (camps at falls pools / meadows, sheds, outhouses, wood);
   give the desert its own (camps at the oasis, crates, signposts, a well, tents, ruins in sandstone). Crate ids must
   not collide across worlds (offset the desert's by 100000); `journal.totals`, the player's camp (`myCamp`, save's
   `camp`) should be per world.
6. **Sound**: desert ambience (wind over sand, oasis birds by day, crickets at night), no frogs / owls away from water.
7. **Look polish**: the aerial view is too hazy/pale (compare frame stats), spire shards at a few bases, a palm or two
   at the lagoon's edge in the water (use the lake ellipse with a margin in the palm placement), vertical shadow
   streaks on steep faces (desert: softened in Terrain; check formations), the lagoon/river colours vs theirs.
8. **Performance**: measure the desert per tier (formations triangles in view; LOW / phones: a smaller reach or a
   lower-poly LOD from `desert_rocks.py`), move tree / bush placement into the worker (the last ~40 ms frames).

## Harness

`frontend/scripts/harness/` (headless Chrome via puppeteer-core; the dev server on :5200): `desertshot.mjs <dir>`
(desert views), `oasisshot.mjs <dir>`, `swaptest.mjs [tier]` (world swaps: GPU memory, longest frames),
`buildprof.mjs` (CPU profile of a world build), `abprops.mjs [tier]` (props cost A/B, trimmed means — the machine
stalls at random, plain means mislead), `sheet.py out.jpg a.png b.png …` (contact sheets).
