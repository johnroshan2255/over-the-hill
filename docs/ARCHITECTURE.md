# overhill — architecture

The game was map 3 ("Over the Hill") of DARK until 2026-11-02, when it became its own game in this repo. The world
notes below are carried over from DARK's ARCHITECTURE.md §10 (paths now relative to `frontend/`: `oth.html` → `index.html`,
`scripts/oth-shot.mjs` → `scripts/shot.mjs`); the front end and the saves are new (bottom).

## The world (`frontend/src/oth/`)

2026-10-26: map 3 is a NEW project inside this repo — "Over the Hill" stylized realism (painterly ground, art-directed
PBR-ish light, rolling mountains, warm cinematic air). It shares NOTHING of the game's world / rendering code: no
React, no WorldManager / stylize / bright style. Planned reuse: the vehicle physics and the vehicle models only.
The Select-map card (`MapInfo.page`) opens `/oth.html`; it is not a room map (the server doesn't know it yet).

- **Map** (`scripts/oth/terrain.py`, Blender's Python + numpy → `public/oth/valley/`): a 4 km playable box (2 m,
  `height.bin` Uint16 2049²) inside a 16 km world (16 m, `far.bin`), box mask at 4 m (`mask.bin` RGBA8: rock,
  dryness, wet — 1 = water + its gravel edge, forest), `meta.json` (grids, lake, river centre line + surface heights,
  spawn). Macro landform (rolling hills, ranges where a low-frequency mask says, the valley kept open) → vectorised
  droplet erosion → 2 m detail → valley floor / river channel / lake bowl carved with SLOPED banks (a flat shore turns
  mesh error into a zigzag water line). `PREVIEW=<dir>` writes top-down hillshades. ~17 s.
- **Look (2026-10-26, the user: "low poly like stylized", "smooth", "exactly like Over the Hill")**: SMOOTH landforms
  (light erosion kept only as broad shaping, no 2 m detail noise, soft broad colour fields — no speckle) and LOW-POLY
  light: the terrain blends each triangle's flat normal (`dFdx/dFdy`) over a soft normal (the normal grid a few mips
  up) — full facets on rock / snow, gentle on grassy hills — plus a per-facet tone jitter (`facetRand`).
- **Terrain** (`Terrain.ts`): CDLOD on the GPU — one patch mesh instanced per quadtree node (ONE draw for 16 km), heights
  from R16UI textures (4 texelFetch, exact), per-vertex geomorph through up to 3 levels (no pops, no cracks), CPU
  selection with a min/max pyramid + frustum. Fragment: the mask (procedural outside the box) painted by
  `groundPaint` (`paint.ts`: palette + world-space paint noise from `noiseTex.ts`, generated at boot).
- **Grass** (`Grass.ts`): the Over-the-Hill CARPET — low-poly tufts of thick pointed blades (6 per tuft, 20 cm wide,
  quad + tip; the far ring 3-blade triangles), even heights. THE GRASS IS THE GROUND GROWN UP: each blade takes
  `groundPaint` at its root (green ground → green grass) and the ground's soft normal, so a hill shades as one surface;
  only a root-to-tip ramp and a per-blade sun-facing nudge separate them. Three rings of world-locked tiles (one
  instanced draw each); per-tuft rank culls by a distance density curve and widens the survivors (same coverage, no
  ring edge); LOW = fewer, wider tufts (`uWidthK` vs HIGH's 17 tufts/m²), never a thinner field. None on rock, snow,
  water's gravel / earth band; thinner under the forest.
- **Light / air** (`Atmosphere.ts`): one shared uniform set + GLSL (`skyColor`, analytic height-fog aerial
  perspective toward the sky's horizon colour, wrapped-diffuse + GGX `shade`); sun path by hour (default 17:00).
  **Terrain sun shadow** (`TerrainShadow.ts` + worker): horizon march over both height grids → R8 textures (box 4 m,
  world 16 m), soft penumbra, re-baked when the sun moves ~1°; one fetch per pixel / blade root, no shadow-map pass.
- **Water** (`Water.ts`): lake disc + river ribbon; depth from the height grid in the fragment shader (no depth
  pre-pass) → see-through shallows → teal, shore line, Fresnel sky, glints, downstream flow.
- **Post** (`Post.ts`, MEDIUM+): HDR target (MSAA 4) → dual-filter bloom, vignette, Neutral tone map, dither. LOW
  draws straight to the canvas (same tone map, no bloom).
- **Tiers** (`quality.ts`, `?tier=`; DEFAULT ULTRA on every device — the user's call, 2026-10-26; with trees, bushes,
  rocks and the car, M4 1280×720 uncapped: LOW 1.4–1.7 ms GPU, MEDIUM 2.6–2.7, HIGH 4.2–4.6, ULTRA 6.4–7.2, phone
  viewport ULTRA 6.3–7.2): LOW terrain 16-quad patches / near 80 m, grass 38 m @ 9 tufts/m² × 6 blades,
  rocks to 900 m; ULTRA 32 / 300 m, 72 m @ 26 × 11, rocks to 2.6 km. Cost (M4, 1280×720, uncapped): LOW 1.0–1.3 ms
  GPU, 90–130 k tris, 10–13 draws; MEDIUM 2.5–2.7 ms; HIGH 2.6–3.9 ms, 0.3–0.48 M tris; ULTRA 4.9–6.8 ms, ~1 M tris.
  Phone viewport LOW: 0.6–0.8 ms, 50–63 k tris. Shrub dots / pebbles: one texture fetch each (paint texture's cell
  channel), no loops.
- **Verify**: `node scripts/oth-shot.mjs <outdir> <shots.json>` (needs `npm run dev`; PORT, UNCAPPED=1, PHONE=1) —
  shots at x / z / h / yaw / pitch / hour / tier; prints fps, CPU / GPU ms, draws, tris, patches, blades. Debug:
  `?stats=1` or F3; fly with drag + WASD / Space / C / Shift.
- **Erosion** (terrain.py): vectorised droplet erosion, 1.6 M drops in the box (4 m) and 2.4 M in the world (16 m),
  speed capped and the change per batch clamped (a vectorised batch can pile many drops into one channel cell →
  runaway → NaN). Kept in full on steep / high ground (gullied mountain faces, drainage networks); the gentle hills
  keep only its broad shaping (on a soft slope parallel droplet channels read as ripples).
- **Trails** (terrain.py → `trail.bin`, `meta.trails`): DIRT TRACKS by A* on an 8 m grid (cost len·(1 + 25·grade²) ×
  a slowly varying field so they wander, > 30 % or the lake a wall, the river a costly ford, cells already on a track
  cheap so routes merge), spawn ↔ lake, the south exit, the box's prominent hilltops joined to the nearest track;
  RDP → Catmull-Rom → Chaikin, a smoothed height profile CARVED into the ground (±hw + 5 m). The ground paints
  packed earth + two ruts with a ragged edge from the distance field; the grass keeps off it (its blades keep the
  field's colour at the edge).
- **Rocks** (`Rocks.ts`): chunky chamfered blocks (hull of a jittered box's chamfered corners, creased normals:
  flat faces, soft edges), light blue-grey; outcrops on steep ground / the rock mask, lone boulders, river stones;
  never on a track or in water; deterministic; one instanced draw per shape; re-picked only when the camera crosses a
  128 m cell; their 2 m footprint texture keeps the grass out of them.
- **Matching Over the Hill** (`scripts/oth/compare.py`, Blender python): pairs of (reference crop, our render crop)
  scored 0–100 on colour (HSV histogram), tone, texture energy in 3 bands, stroke orientation; writes side-by-sides.
  2026-10-26: 25 rounds, 53.8 → 64.8 overall (golden slope 86, golden field 75, green 67, trail 59, mountain 58,
  rock 57, ground 58, far hillside 59). The rest is mostly content OTH has and we don't yet (pines, bushes, snags).
- **The 4×4s** (`Vehicle.ts`, `Physics.ts`, `ChaseCam.ts`; 2026-10-26): the game's own vehicles — `loadVehicle` models,
  `TruckSim` + the spec-sheet drivetrain (Simulation handling, full aids, off-road assist) in the game's Rapier
  `PhysicsWorld` — on this map: the ground as 256 m heightfield tiles of the 2 m grid streamed 3 × 3 round the car,
  the rocks within 160 m as convex hulls of their drawn shapes, walls 40 m inside the box's edge. Tyres read this
  map's surfaces (dirt on the tracks, grass, sand / gravel at the water, rock). Drawn with this world's light
  (`shade`, the terrain's baked sun shadow) + a terrain-hugging contact shadow; paint per car (rust G500, cream E30,
  orange kei van; `?paint=`). Chase camera with drag-orbit; V = free camera. Keys W A S D / Space / Shift / R / 1 2 3,
  touch ◀ ▶ GAS BRAKE ⟲. Cost: the car + shadow ≈ 8 draws; LOW 1.45 ms GPU with it.
- **Trees** (`treeGeometry.ts`, `Trees.ts`; new for this world): the OTH spruce / golden larch — stacked FRILLED
  SKIRTS (dark apex, raised shoulder, a fringe of hanging saw-teeth gathered into plumes), indexed, **864 vertices**
  near, 217 mid; snags = the trunk + branch stubs. One instanced draw per LOD for every species. IMPOSTORS beyond
  `treeMid`: at load each species' near LOD is rendered from 12 azimuths × 3 elevations into a 2-target atlas (albedo ×
  AO sqrt-encoded, tree-space normal); a far tree is one camera-facing quad picking the nearest view, relit by the sun
  from the normal image, mip-corrected alpha (alpha-to-coverage on MSAA tiers). Beyond `treeFar` a rank cull thins the
  forest (survivors grow). Culling: 64 m tiles (distance + frustum), lists rebuilt only when the camera moves 4 m /
  turns. SHADOWS AS AN IMAGE: every tree stamps a soft ellipse (away from the sun) into a 2 m R8 texture
  (`TerrainShadow.treeTex`, re-baked when the sun moves 1°) — the ground, grass, water, rocks, bushes, the car and the
  trees' own lower crowns read it (`sunVisibility`); no shadow-map pass. Trunks near the car are physics cylinders.
- **Mixed woods** (2026-10-26, the user: "fewer pines, other trees like OTH"): a BROADLEAF family too
  (`broadleafGeometry`: white trunk + a tall loose oval of 34 jittered leaf clusters, ~320 vertices; leaf speckle in
  the shader) — gold birch, red / orange aspen, a few green — in DENSE GROVES (a slow noise picks grove vs conifer
  stand; ~half each; conifers sparser than before). 5 instanced draws: conifer near / mid, broadleaf near / mid, one
  impostor draw for all species (atlas rows: spruce, larch, birch, aspen, green × 3 elevations).
- **Trekking hills** (terrain.py `TREK`, the user: "hill-trekking places like OTH"): 4 broad rocky hills; their upper
  slopes TERRACED into ledges (a grassy shelf + a ~45° rock riser, 4–6 m, the step height wandering), tracks up to
  each top (A* allows 62 % steps there and the carve keeps 85 % of the ledges: rock crawling). More rock everywhere:
  slope rock from 25° and EXPOSED-BEDROCK patches on the hillsides (rock 3 % → 12 % of the box), never on a track.
- **Tracks** (the user: "exact OTH road texture"): one car wide (half width 1.8 m), smooth muted warm brown with a fine
  speckled grain, faint ruts, darker under the overhanging grass; the edge (`trackMask`, shared by the ground and the
  grass) pushed in / out by grass CLUMPS a few metres across + a finer fringe — OTH's scalloped grassy edges.
- **Round-leaf broadleaf + tightness** (2026-10-26 round 6, the user: "trees like a stick with paper — OTH has round
  leaves growing up and down"; "the spawn feels like a desert for 500 m"; "multiple hills and cliffs"; "rock
  formations on cliffs and hills, connected roads through them for trucking"): `broadleafGeometry` = a forked white
  trunk + ~210 ROUND LEAVES (quads cut to discs in the shader, per-leaf tint, one in ten yellow-green) on the
  surfaces of 7 lumpy clusters (some facing up, some out, the lower ones hanging) + a small dark core; 878 vertices
  (LOD 1 206). Placement adds clumps round the SPAWN (< 260 m), lining the TRACKS (5–26 m) and the RIVER banks (14–45
  m, mostly broadleaf) from coarse distance fields (`MapData.trackDist` / `riverDist`, 4 m, built at load); bushes
  thick along the banks / tracks / spawn; boulders round the spawn and along the tracks. Terrain: knolls + hummocks
  everywhere, ~30 more hills, ~14 CLIFFS (escarpments: a 12–30 m near-vertical rock step onto a plateau), rock
  FORMATIONS on 70 % of the hills and every plateau (48 in all), two by the spawn; TRUCKING ROUTES from the network
  into the 18 nearest formations and on between neighbours (A* may climb the rock there, the carve keeps the blocks)
  — 33 connected tracks, ~20 km.
- **Bushes** (`Bushes.ts`): lumpy clumps of icosphere blobs (green / juniper / autumn red), 2 LODs to `bushReach`,
  thicker at forest edges and in green hollows; beyond, the ground's painted shrub dots take over.
- **Rock outcrops** (terrain.py, the user: "huge rock — the terrain itself, rock texture, no grass"): 12 sites (2 in
  sight of the spawn), fused Voronoi BLOCKS raised out of the slope (flat tilted tops, steep sides, rounded crevices)
  in the HEIGHT GRID — the car climbs and hits them, they cast terrain shadow — painted blue-grey slab (mask R = 1), no
  grass / trees / bushes / loose boulders on them; tracks route round them. `meta.rocks` lists them.
- **Runtime**: ADAPTIVE RESOLUTION (PlayCanvas guideline: DPR at runtime) — once a second a slow frame (> 19 ms)
  lowers the pixel ratio 15 % (to half), a fast one (< 12.5 ms) raises it (`?dpr=fixed` off; F3 shows `res %`).
  FULL SCREEN button (top-left; Fullscreen API + landscape lock; iPhone: "Add to Home Screen" hint). Default tier
  ULTRA everywhere.
- **Score ceiling** (compare.py on OTH against ITSELF): golden grass from two OTH screenshots 70–73, a spruce vs another
  spruce in the same screenshot 51, the same crop shifted 5 % 89, identical 100 — so 100 means "the same image"; ours
  (2026-10-26, round oth2d): golden slope 92, golden field 75, spruce 66, rock 64, aspen grove 62, hillside 62,
  larch 61, overall 63.5.
- **Leaf cards + day / night** (2026-10-26, the user: "each leaf small and separated, the sky seen between them";
  "sun, bloom and day-night like OTH"): broadleaf crowns and bushes are LEAF CARDS showing a generated 512² atlas of 4
  leaf clusters (`leafTexture.ts`: ~80 tiny separate leaves each, gaps between them; R tone, G depth, A coverage —
  mip-corrected alpha test, alpha-to-coverage on MSAA tiers). `broadleafGeometry`: a low fork + side limbs, clumps of
  10 cards in 4 rings + a top + 5 dark core cards — the CROWN FILLS THE TOP 70 % of the tree (the user: "70 % leaves,
  30 % trunk"), each tree its own base (31–40 %) and width (×0.85–1.15) in the vertex shader; ~760 vertices (LOD 1
  ~190). Bushes: 5 clumps × 6 cards. The clock runs (`Atmosphere.tick`, 24 min a day, nights 3× faster; [ ] an hour,
  T stops it, `?time=0`): golden hour → pink dusk → night (the light becomes the MOON, stars twinkle, the headlights
  light every surface through the shared `headlight()`; L toggles them).
- **Clear near air** (the user: "no fog near us — the colours go dull"): the height fog starts at `FOG_START` = 140 m
  (`fogAmount` integrates only beyond it) and swallows the far hills by ~1.5 km; the vignette is the faintest
  darkening (no tint); the bloom keeps to what is brighter than white. In that clear air the sunlit SCREE and rock
  slabs read as snow, so both are a stone grey now (`paint.ts` SCREE / SLAB). The sky marks itself for the god rays
  (alpha 0) only when Post draws (LOW renders straight to the canvas: an opaque sky).
- **God rays + bloom** (`Post.ts`): the bloom's soft knee from 1.0 (the sun, the glowing sky round it, the sunset
  horizon, glints). GOD RAYS at a quarter of the resolution: the sky marks itself (the sky writes alpha 0, everything
  else 1 — a leaf card's edge, alpha-to-coverage, lets part through), its pixels near the sun (a tight falloff: the
  streaks keep their contrast) are the source, blurred RADIALLY toward the sun in 2 passes of 12 taps (the second 13×
  longer: 144 evenly spaced samples), added tinted as that sky is — light streams round every trunk, crown and ridge
  against the bright sky. Off (passes skipped) when the sun is behind the camera. `?rays=` strength (2.0), `?rays=-1`
  shows the rays alone. ≈ 0.1–0.2 ms.
- **The car, finished** (the user: "the car has no windows and no smoke"): the model's front DOORS (cut out of the body
  in Blender — `TruckModel.doors`) and the CABIN were never drawn here; now they are, and the glass is see-through
  (Fresnel sky, sun glint, the cabin behind it). DUST + SMOKE (`Dust.ts`): one instanced draw of soft painterly puffs
  from a ring (160 LOW … 360 ULTRA) — dust thrown back from each tyre on the ground by what it rolls on (orange-brown
  off the tracks, grey off rock, pale off gravel, a little off grass; none on a bridge), more with speed and tyre
  slip; exhaust from the catalogue's tailpipes (haze at idle, grey puffs on the gas). ≈ 0.03 ms CPU.
- **Camera zoom** (the user): the chase camera's distance 3.5–40 m, eased — mouse wheel, two-finger PINCH, + / − keys,
  on-screen + / − buttons (held: keeps zooming); in the free camera the buttons change the field of view.
- **A fuller map** (2026-10-26 round 7, the user: "more bumps and hills, bigger and smaller, some with rocks, some just
  rock on the ground; proper cliffs; random ponds and lakes with tracks, trees and hills near them; bridges like
  OTH; make it fuller, all explorable"): terrain.py adds a HILL FIELD (~240 hills: small 18–45 m / 3–12 m, medium
  45–100 m / 8–28 m, big 100–190 m / 18–50 m, ellipses at their own angles; a third crowned by a rock FORMATION, a
  third by a cap of BARE ROCK paint, the rest grass; some gathered round the ponds), 420 knolls, 22 PROPER CLIFFS (the
  big ones 24–46 m tall, up to 320 m long, the edge bending; the face LAYERED into 3–5 strata — near-vertical risers
  and narrow ledges — a scree apron at the foot), ~16 PONDS and small LAKES (16–110 m; a bowl under the level its own
  rim allows, a sloped beach; `meta.water.ponds`, a water disc each in `Water.ts`; the trees and bushes line their
  shores via `MapData.riverDist`; three within ~500 m of the spawn) with TRACKS to their shores (round the lakes), and
  3 PLANK BRIDGES over the river (`meta.bridges`; `Bridges.ts`: planks on three stringers, log posts + cap beams, curb
  logs and rails — one merged draw; the deck, curbs and rails are colliders in `Physics.ts`; the track ramps up to
  each deck and the river runs on under it; `MapData.bridgeAt` → the tyres feel planks, no dust). 74 tracks, ~35 km.
- **Culling, all of it** (the user: "check we have proper culling, all types"): DISTANCE (every system's tier reach),
  FRUSTUM (terrain CDLOD nodes, grass tiles, tree tiles, bush tiles, rock cells — the rocks had none before), LOD
  (CDLOD + geomorph, grass density rank, trees near / mid / impostor + far rank cull, bushes 2 LODs), BACKFACE (all
  closed meshes; leaf cards are double-sided by nature), SMALL-FEATURE (a rock under ~2 px tall is skipped), and
  OCCLUSION (`Horizon.ts`: 320 azimuth rays marched over the height grid from the camera each keep the highest slope
  met — the horizon; a tree / bush tile or rock cell whose top is under it in every azimuth it spans is behind a hill
  and skipped; conservative — eye +1.2 m, ±1 ray, a margin; rebuilt each 4 m moved ≈ 0.4–0.9 ms; `?occlusion=0`
  off). No shadow-map passes to cull (shadows are baked images). F3 shows the culled counts.
- **Gap round (2026-10-27, the user: "what are we missing vs Over the Hill — add those"; "fix the bridge colliders";
  "match the style")**:
  - **Track junctions** (terrain.py): a track near a bed already carved takes THAT bed's height (`BedH`, eased over
    40 m) and never re-carves it; a last GRADING pass re-grades any ordinary track step > 35 % over a metre (rock-crawl
    routes keep their ledges: `meta.trails.rough`). Four tracks met 20 m from the spawn with a 3.4 m step that rolled
    the car; ordinary tracks with a > 40 % step: 77 → 12. scenery.mjs's stream roads pin to the tracks the same way.
  - **Bridges**: decks slope y0 → y1 with their road (`meta.bridges`), river ramps as long as ≤ 12 % needs (30–110 m),
    a stream's deck spans the stream's whole cut, ends offset onto the road over 14 m (no lip, no kink); a bridge at
    every track × stream crossing. Physics: the deck is GROUND (`Static | StaticMesh` — the drivetrain's wheel rays see
    only ground: before, the tyres fell through and the car slid on its belly), every piece filtered off the car's
    exact body mesh (`STATIC_MESH_FILTER`: a curb inside that hollow shell flipped the car), capsule curbs, 1.5 m guard
    rails. Headless drive test (a steering bot, both ways, 40 km/h): every deck carries the car on its wheels.
  - **Far view**: the white fog is now AERIAL PERSPECTIVE (`fogAmount`: 1 − e^(−d / haze), ≤ 94 %, bluer colour) and the
    far plane 4.5–9 km — the 16 km world's layered ranges are seen; past 2 km the terrain reads 2 paint octaves, not 5.
  - **Weather** (Atmosphere `weather`, K, `?weather=`): clear / cloudy / rain spells; painted CLOUDS (Sky.ts, 3 value
    bands), RAIN (Rain.ts, one instanced draw), WET shading in `shade()` (darker, glossy by roughness), PUDDLES in the
    track ruts, wet grip + muddy tracks (Vehicle `wet`), a synthesized rain sound.
  - **Mud** (`mud.bin`, scenery.mjs): a MARSH ("The Bog"), mud holes in the tracks' dips, slow river banks — painted
    dark and glossy with standing bog water, reeds at its edge, Surf.Mud under the tyres, dark spray.
  - **Water**: `MapData.waterLevel()`; fording drags the car by depth; white splashes.
  - **Tyre tracks** (TyreTracks.ts): dark tread marks on dirt / mud / sand, multiply-blended, fade over 2 min.
  - **Landmarks** (scenery.mjs → `meta.landmarks`, Landmarks.ts): fire lookouts (red roofs, seen from afar), viewpoints,
    log cabins, a lakeside shack + dock, a sawmill, a mine adit, a meteorite crater — on levelled earth pads, built from
    the bridges' kit (`Builder` / `woodMaterial`, windows glow at night), box colliders (the dock is ground);
    DISCOVERED within ~40 m (localStorage) → a toast.
  - **Map + compass** (MapView.ts): Tab / MAP — a painted chart (hillshade, 40 m contours, colour fields, tracks — rough
    routes dashed — bridges, the bog, landmarks: icon + name found, "?" not), the car's arrow; click / Z zooms. The
    compass strip: heading + landmarks ahead and the nearest's distance.
  - **Winch** (Winch.ts, E / WINCH): hooks the nearest tree / boulder ahead within 35 m, reels in at 1.5 m/s, pulls
    while taut (≤ 1.3 g); a sagging cable ribbon.
  - **Lights**: a painted beam from EACH headlamp (`headlight()`: ellipse in angle space, 3 value bands), soft lens
    glows, faint beams in the air at night; BRAKE lights on braking (any hour) + a red pool behind at night; nights
    much darker (the ambient floor gives way to the moon).
- **No post pass by default (2026-10-27, the user: "400+ fps at 1080p on the laptop so a small phone holds 60+";
  "even remove post-processing, but keep the ULTRA look")**: every tier draws straight to the canvas with its own MSAA
  (on a phone's tile GPU resolved on-chip); the bloom and god rays are painted FORWARD (Glow.ts): a sun GLARE sprite
  (core + wide skirt + faint streaks; hidden by the terrain's horizon from a 32-step CPU march), LIGHT SHAFT cards
  among the trees toward a low sun, the sky's halo + a warmer haze toward the sun (`uGlow`), a sky dither, a CSS
  vignette. `?post=1` brings the old pass back (with a phone profile: no MSAA, bloom from ¼, rays at ⅛ — 7.5 → 3.2 ms).
  Also: grass lit PER VERTEX (the carpet is 3–4 blades deep), culled tufts stop at the top of the vertex shader, the
  near ring split (½ density 0.12–0.25 R), ULTRA 9 blades a tuft; bushes lit per vertex; the TERRAIN drawn LAST of the
  opaque things (the depth test skips the ground's paint under the grass: −0.47 ms at 1080p); clouds 2 octaves.
  Measured (M4, headless, uncapped, 1920 × 1080): ULTRA 3.66 → 2.56 ms (273 → 391 fps), HIGH 402, MEDIUM 411,
  LOW 611; the old post pass 219. Phone viewport ULTRA: 568 fps at 2× pixel ratio, 408 at native 2.6×. (An EMPTY
  scene costs ~1.1 ms in headless Chrome: the floor.) Cost tests: `?post=1 ?aa=0 ?maxdpr= ?far= ?samples= ?levels=
  ?relief=0 ?vignette=gl ?mobile=0|1`; profiling scripts: frame time by rAF count (the GPU timer query overlaps frames
  in headless Metal and can't split by system).
- **Hidden places round (2026-10-27, the user: "cliffs, valleys, hills, waterfalls, hidden beautiful places — like OTH
  and Genshin — the colour is the key, without the cost"; "ours look flat, all places visible — they have something
  different, and that helps: we don't render what's hidden")**:
  - LANDFORM (terrain.py): the valley BENDS (±120 m, ~1 km wavelength + a harmonic; the river keeps to its floor) and
    an INTERLOCKING SPUR reaches into the inside of each bend (7: nose ~70 m off the valley line, 14 → 46 m over the
    side, flanks ≤ ~45 %, clear of the spawn and the three river bridges); 12 RIDGES (350–800 m, 28–55 m, 1–2
    saddles) cut the side country into pockets; the hill field's big hills 26 → 40 (22–60 m). Ground in sight from
    the tracks within 1.5 km (`viewshed`: 360 rays from every ~25th track point, eye 2.2 m): mean 13.7 → 11.7 %,
    p90 24.2 → 20.5 %.
  - HIDDEN PLACES (`meta.hidden`, landmarks `falls` ≋ / `meadow` ✿, found from inside): two FALLS BASINS — a bowl
    60–72 m in radius cut into a hillside, an irregular banded cliff ring (26–44 m, bays and buttresses), the one way
    in a 24 m GORGE facing downhill (its floor an even ≤ 20 % ramp: a track always reaches it), a spring-fed stream on
    the rim over the back wall from a notch (the face behind the fall sheer: the sheet clears it) into a turquoise pool
    (carved with the basin, not the ponds' trim) — "Veil Falls" a 12 m curtain; one FLOWER HOLLOW — a grassy ring
    of hills (a 42 m bank, never the slope's bare rock, trees round the rim) round a wildflower meadow, a grassy pass.
    No trees on the hollow's floor or between a basin's gap and its fall; no hills, outcrops or streams inside.
  - WILDFLOWERS (mud.bin is RG now: G = blossoms; scenery.mjs): carpets on the basins' floors, drifts over the lush
    meadows (~0.8 km²). In the grass a flower is a grass blade in bloom at its TOP (since 2026-11-02 — it was the blade
    turned over, all of it coloured: "don't colour the grass, only the top"): its head colour lit per vertex beside the
    grass's (`vFlower`, flower blades only), the fragment paints the top third with it — every tier, the same
    triangles; one kind per drift (`flowerColor`: daisy, buttercup, lupine, campion, poppy, cornflower); past the
    grass the ground carries a light sprinkle of the drift's colour in paint.
  - COLOUR: rock gets a SKY FILL (`rockFill`: OTH's shade is pale blue-grey — ours lit 8 : 1 went black), the slab a
    touch lighter; CLIFF FACES layered (strata ~3.4 m, warm / cool bands, soft seams, water streaks, moss on the
    ledges); the slow river clear TEAL (rapids stay on the fast streams); the FALLS painted in three tones (deep teal
    sheet, aqua, white foam; a glassy lip, whiter as it falls, torn edges, a white foot) with a thicker mist and foam
    rings.
  - TRACK SAFETY (the new relief): a route whose smoothing cut its zig-zag into a straight climb keeps its corners;
    graded beds are locked (no tug-of-war where two tracks share a stretch); a last JUNCTION RELAX eases any ordinary
    bed steeper than 36 % (a 1.8 m step where a track's end stopped short of the bed it joined, 140 m from the spawn);
    stream banks never cut a track's bed (scenery.mjs). Steep spots on ordinary tracks (scan): 8, none > 55 %, the
    nearest 193 m from the spawn. Bridges: NO CURB COLLIDER — a car drifting to the edge rode up the curb against
    the guard wall and rolled along the deck; the wall alone keeps it on.
  - COST: the new look ≈ +0.06 ms; paid for by — terrain patches drawn NEAR → FAR (the early depth test skips what a
    nearer slope hides) and skipped whole behind the hills (`Horizon`, judged 3 m + 1.5 % of the distance high), the
    track's ragged edge read only within 1.2 m of a track (terrain) / 3.5 m (grass vertices) — exact, sub-pixel paint
    octaves skipped (≈ −0.29 ms together, interleaved A/B). 1080p ULTRA: 7 views mean 2.46 ms (406 fps), the
    round-8 spawn harness 394 fps (was 391); phone 2× 552; LOW 632.
- **Colour round (2026-11-02)**: the plants a step darker — `PLANT_VALUE` 0.7 (paint.ts) on the grass, shrub dots, forest
  floor, leaves and needles (impostors too), bushes; the golden grass a further `GOLD_VALUE` 0.66 (it sat in the tone
  map's shoulder, pale and "lit from the ground"); rock, tracks, water, flowers, bark and sky unchanged. An OPAQUE
  canvas (main.ts: our own `alpha: false` WebGL2 context — three always asks for alpha, and the leaf cards'
  alpha-to-coverage left alpha < 1 at their edges: the page's peach background showed through as a dotted light rim
  round every tree and bush, plainest at dusk and night). PUDDLES show their bed LIT (`c × 0.14`, was the unlit albedo
  × 0.32 — the same by day, but it glowed once the land went dark). Measured: green grass −14 %, pines −15 %, golden
  grass −11 % on screen; flower field A/B ULTRA 2.01 vs 2.03 ms, LOW 1.41 vs 1.27 ms (within the run-to-run spread).
- **Unseen-work round (2026-11-02, the user: "things we don't show on screen but use CPU / GPU — check water too")**:
  a draw-call log + an interleaved hide/show A/B per system (uncapped 1080p) found what was drawn from anywhere — the
  CAR (every part's cull off: ~0.2 ms with it off-screen), the LANDMARKS / BRIDGES / FALLS (one mesh each over the
  whole map: 0.1–0.2 ms), the PONDS (a draw each, up to 17), the DUST pool (drawn and uploaded with nothing alive) and
  the TYRE TRACKS (long faded). Now: `Vehicle.cull` (one sphere of 15 m — the beams — against the view + the hills
  for the body, glass, wheels, lamps, beams, shadow), a mesh per landmark / bridge and per 500 m cell of falls (three
  culls each by the view, `cullHidden` by the hills — `Builder.geometry(from, to)`, `Horizon.hiddenBox`), the lake +
  ponds ONE draw and the river + streams one, `Dust.cull` (its live puffs' box; uploads only when drawn),
  `TyreTracks.cull` (marks left and within 70 m). Water was never one sheet under the map: it is drawn after the
  terrain, the parts under the banks dropped by the depth test before shading. Not waste: draw order (grass → objects
  → terrain → sky), hill culling of terrain / trees / rocks / bushes, the game's JS (~0.1–0.2 ms a frame — the rest of
  the CPU time is waiting on the GPU), ~1.1 ms a frame of Chrome's own even with nothing drawn. Measured (M4, uncapped
  1080p, interleaved A/B ×2): free-camera views ULTRA 353 → 360 fps (gold field 382 → 406, grove 358 → 381), LOW
  597 → 625 (gold 741 → 829, flowers 618 → 721); driving unchanged within the noise (ULTRA 277 → 266, LOW 444 → 439
  over 6 runs each, runs spread 248–289 / 399–510) — the car is on screen there. Draws in places away from the car:
  40–50 → 23–33.
- **Draw-call / bake round (2026-11-02)**: the CAR is 3 draws, was 11 (`mergeParts`: body + cabin + the front doors at
  their hinges — they never open here — one mesh; the windows one; the four wheels one InstancedMesh posed from
  `update()`). Rocks stay 10 instanced draws: a BatchedMesh draws every instance as its own sub-draw (hundreds, on
  Metal emulated as real draws) — likely slower than now. A BAKED GROUND COLOUR was measured first and not built:
  the ceiling (groundPaint replaced by a constant) is ULTRA spawn +10 %, gold field +2 %, aerial +51 %; LOW spawn 0,
  gold +2 %, aerial +18 %; the grass's share alone ≤ +1 % ULTRA, ≤ +6 % LOW. The cheap part (far pixels skip the fine
  octaves: `foot > 1.6`, `farG`) was already in; a bake pays only in wide views and would blur the near ground's
  fine marks (grain, pebbles, ruts) unless its near level were finer than a phone can hold. Chrome's own floor here:
  1500 fps with MSAA (0.66 ms), 2100 without, for an empty 1080p canvas; MSAA costs ULTRA 0.7–0.9 ms at 1080p.
  Measured after both rounds (M4, uncapped 1080p, interleaved): draws spawn 46 → 37, gold 53 → 36, grove 45 → 26,
  driving 48 → 38; fps start → now ULTRA mean 349 → 340, LOW 578 → 596 (±5 % run to run); a steady drive bench (×4)
  ULTRA idle behind the car 340 → 341, driving 295 → 300. The M4 is bound by pixels / vertices / MSAA, not by draw
  calls — fewer draws should matter more on a phone's CPU (not measurable here: headless "phone" is still the M4).
- **Far-tree rims (2026-11-02, the user: "the far trees have a black border")**: the impostor atlas was meant to clear
  to each species' mid colour at alpha 0, but three premultiplies a clear colour by its alpha — it was always BLACK,
  and the mips blended every far tree's edge toward it (the mid colours, never seen working, were ~3× too light
  anyway). Now the atlas is treated as PREMULTIPLIED by coverage (cleared to transparent black; a drawn texel's alpha
  is 1) and IMP_FRAG divides the albedo and the normal / AO target by the coverage: a mip's edge is the tree's own
  average, never the background's. And the view ABOVE each in the atlas starts with its trunk's foot — blurred down a
  mip it drew a dark dash over the far trees' tops: the top (2^lod + 0.5) texels of a view are discarded.
- **Not yet**: planar reflections; grass flattened by the tyres; photo mode / co-op.


## The front end and the journey (2026-11-02)

- **Entry** `src/main.ts`: the TITLE screen (`ui/Menu.ts`, `ui/menu.css`) first; the game (`oth/main.ts`) is a separate
  chunk imported on PLAY. While the title waits (idle callback): three and Rapier (its WASM compiled ahead — the slowest
  part of a cold start), the chosen car's model (loaded and baked into the cache the game reads) and the valley's data
  files (HTTP cache). Measured headless: PLAY → playing in ~2.5 s. Title-screen JS 19 KB; game 299 KB, three 797 KB,
  rapier 4.3 MB (later, or preloaded). A dev / shot URL (`?tier=` `?drive=` `?x=` …) goes straight in.
- **UI**: GTA-style — square edges everywhere, condensed upper-case type (Anton titles, Barlow Condensed), near-black
  panels, white selection bars, one amber accent (#f2a93b). Keyboard (↑ ↓ ← → Enter Esc, Q / E tabs), mouse, touch.
  Screens: title (CONTINUE · NEW START / PLAY · GARAGE · SETTINGS · CO-OP soon), GARAGE (car: G500 4×4² / E30 M3 with
  their numbers; paint: the valley's colour per car or the catalogue's 16; driving: gearbox, aids, off-road assist),
  SETTINGS (graphics: quality, anti-aliasing, resolution, FPS overlay; audio; controls), PAUSE (Esc / the II button:
  resume, garage, settings, apply & restart here, quit to title). Paused = the frame returns at once: no physics, no
  clock, no drawing.
- **Settings** `src/settings.ts` (localStorage `overhill.settings.v1`) → `gameParams()`: the URL switches the game has
  always read (`tier`, `aa`, `scale`, `stats`, `car`, `paint`, `gearbox`, `aids`, `offroad`, `sound`), under the page's
  URL. Two cars only: the kei van was removed (catalogue, specs, engine voice, model).
- **The journey** `src/save.ts` (localStorage `overhill.progress.v1`): the car's last SAFE spot (≥ 2 wheels down, roof up,
  out of the water) and heading, the hour, metres driven, seconds played; saved every 20 s, on pause, when the page is
  hidden or closed. CONTINUE (and APPLY & RESTART) start there. The backend's save API will take the same shape.


## Make the Valley great — stage 1: things to find, places to stop (2026-11-02)

- **Places** `oth/Places.ts` `placeThings(map, rocks, trees)` → `{ props, camps, swarms }`, seeded (the same valley
  every time: a crate's id is stable, so the journal can keep it) and ~10 ms at load. Everything goes through `free()`:
  in the box, dry, off bridges / mud / steep ground / rock (unless it sits ON rock: cairns), clear of the tracks
  (`map.trackDist` beyond 7.5 m — `trailDist` caps at 8 m), of landmark pads (not the AREA ones: falls, meadow), of
  rocks and trees, and spaced from its own kind (a spatial hash). What's there (last count): 9 CAMPSITES (falls pools,
  meadow, lake / river / pond shores) · 39 SIGNPOSTS at the junctions · tables at view points and shores · fences by
  cabins · 2 abandoned trucks · log piles in the forest · 14 cairns on rough trail tops · sheds, outhouses (every third
  camp) · 6 stone RUINS · ~520 stone clusters (tracks, camps, river banks) · 72 SUPPLY CRATES · ~44 wild firefly swarms.
- **Sizes are real** (Landmarks.ts SCALE): the G500 4×4² is 4.7 m long and 1.9 m tall; the kit's cabin (5.2 × 4.2 m,
  walls 2.4 m) is drawn ×1.3 and the sawmill's shed (12 × 6 m) ×1.25 — a trapper's cabin is ~7 × 5.5 m — and the
  abandoned truck ×1.15: nothing is car-sized that isn't.
- **Props** `oth/Props.ts`: one InstancedMesh per kind (11 kinds, one shared wood/paint material), its matrices
  precomputed; per 128 m cell: frustum, hill occlusion (Horizon), a reach per kind and a 2 px small-thing cut. The list
  is rebuilt only when the camera moves 6 m or turns (15 µs), and only the matrices in use are uploaded. Colliders
  (140) stream into Rapier within 70 m (Physics.addPropColliders). Each prop clears the grass round it (the rocks'
  footprint texture: no extra pass).
- **Crates & the journal** `src/journal.ts` (localStorage `overhill.journal.v1`): drive within 4.5 m of a crate → +25
  coins, a chime, the toast (checked 10× a second from a 64 m hash: 0.02 µs). A place discovered +60, a camp +30. Coins
  buy paints in the garage (the classics are free; the rest 100 + 25 per step down the list).
- **Signposts**: within 15 m the HUD shows the board — the 4 nearest places, their distance and an arrow relative to
  the car.
- **Camping**: C (or the CAMP button) — at a campsite (22 m), your own camp (25 m), or anywhere dry and flat with the car
  stopped (pitches a tent, fire, lantern by the car, kept in the save). The camp menu: rest until sunrise / noon /
  evening / night (a fade, the clock jumps, saved — a checkpoint), wait out the weather, pack up, back on the road.
- **Evening lights — painted, never real lights**: `Atmosphere.uLamps` (0 by day, 1 from dusk) gates them all. A soft
  HALO on each camp lantern, campfire and lit cabin window (camera-facing additive quads, pulled toward the camera by
  their radius so the ground and the fire ring can't cut them — the same size on the screen); FIREFLIES round each camp,
  cabin and the wild swarms (36 per swarm; drifting, blinking ~35 % of the time, gone past 110 m and closer than 1 m);
  all one draw each, and not drawn at all by day.
- **The campfire**: 3 FLAME tongues (upright quads, a noise-torn shape licking sideways toward the tip, white-yellow core
  to deep orange), 14 SPARKS rising and cooling, 7 SMOKE puffs (blended, carried by the wind; a wisp by day, near
  nothing at night) — 3 draws for every fire in the valley, only with a fire within 160 m. Its LIGHT is painted like the
  headlights: the nearest fire within 60 m is `Atmosphere.uFire` (flickering), added in the shared `headlight()` to
  everything within 20 m — warm, stronger on what faces it.
- **Time and weather keys**: G → the next of morning (6:30) / noon / evening (17:30) / night (21:30); Shift+G → the next
  weather.
- **Cost** (uncapped 1080p, all of it shown vs hidden, interleaved ×5, a trimmed mean): ultra +0.03 ms at the spawn,
  +0.14 ms beside a lit camp at night (343 vs 361 fps), +0.07 ms at a cabin at dusk, +0.04 ms from the air; LOW
  +0.02–0.08 ms. CPU: the rebuild 15 µs (when moving), the fire light 0.2 µs, the crate check 0.02 µs.
