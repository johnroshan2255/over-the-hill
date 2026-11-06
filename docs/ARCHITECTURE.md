# overhill — architecture

The game was map 3 ("Over the Hill") of DARK until 2026-11-02, when it became its own game in this repo. The world
notes below are carried over from DARK's ARCHITECTURE.md §10 (paths now relative to `frontend/`: `oth.html` → `index.html`,
`scripts/oth-shot.mjs` → `scripts/shot.mjs`); the front end and the saves are new (bottom).

## The renderer (2026-11-03: PlayCanvas — branch `playcanvas-migration`, docs/MIGRATION.md)

- **PlayCanvas 2.23 as a library** (no editor): `src/oth/gfx/` is the game's graphics layer — three's API shape (math,
  `BufferGeometry`, `ShaderMaterial`, `Mesh` / `InstancedMesh`, `Scene`, `Renderer`, `RenderTarget`, `GLTFLoader` +
  Draco) over PlayCanvas's device, meshes, mesh instances and render targets; the game modules import `./gfx` as
  `GFX` and keep their own GLSL. three.js is gone from the game.
- **Backends**: WebGPU on desktops, WebGL2 on phones and wherever WebGPU is missing (`?api=webgl2` / `?api=webgpu`).
  On WebGPU our GLSL becomes WGSL at runtime — naga (`naga-wasm`) first, glslang + twgsl (`public/lib/`) for any
  shader naga can't read (`gfx/core.ts` `fastWgsl`).
- **Shaders** (`gfx/material.ts` `convert`): three's built-ins → PlayCanvas's, `in` / `out` → `attribute` / `varying`,
  MRT outputs → `pcFragColorN`, `#include <tonemapping_fragment>` / `<colorspace_fragment>` → our hue-keeping Neutral
  tone map + sRGB (`OTH_OUTPUT_GLSL`, switched per target as three's are); WebGPU's separate texture + sampler
  rewritten in. No shader loops with a data-dependent trip count in hot paths — write them out (MIGRATION.md: WebGPU's
  loop guard stops unrolling).
- **Frame**: PlayCanvas's own loop (`renderer.start`); the game runs in `app.on('update')`, `renderer.prepare(scene,
  camera)` syncs the scene (world matrices, culling, draw order — `renderOrder`, then material; transparent back to
  front) and PlayCanvas draws. Offscreen draws (the impostor bake) use `renderer.render(scene, camera)`.
- **Stats**: PlayCanvas's MiniStats (FPS, frame / CPU / GPU time, draw calls, VRAM) — F3 or `?stats=1`.

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
  **THE GROUND CACHE** (`GroundCache.ts`, 2026-11-06, docs/PERF.md — the paint was ~70 % of the frame): the ground's
  surface (colour, rock, roughness, AO, sheen share, grass shade, track, puddle inputs, shrub dots, flowers, and the
  rock relief + desert ripples as a NORMAL MAP — `SURF_GLSL`, one code path for bake and live) baked into a CLIPMAP
  round the camera: 8 toroidal levels (ULTRA 3.1 cm … 4 m texels, 1024² each; phones 512², 6.25 cm … 8 m) + a FAR level
  (the whole 16 km, baked once), one 3 × 3 atlas per output (4 × RGBA8; ULTRA ~152 MB, phones ~38 MB). Each level is
  baked with its texel as the footprint (the live paint's own mip chain); re-baked only where a 16-texel step uncovers
  ground (moving at 30 m/s: +0.02 ms). The terrain reads the level whose texel ≈ the pixel (or the finest that reaches
  it), two blended: 4–8 fetches. Live: the steep walls within the cache's reach (paint + relief — a top-down texel
  smears down a wall), the light, the weather, the haze. `?gcache=0` paints live everywhere (the A/B).
  **THE SMALL SHAPES' LIGHT** (2026-11-06, the user: "the grass fields look a plane — bumps, dips, hollows we can't
  tell"; the soft wrapped + S-curved light moved a 10° bump's brightness ~1 % at noon, and the grass lit itself from
  a normal blurred over ~11 m): `OTH_SHAPE` (`Terrain.ts` `shapeDefines` / `SHAPE_GLSL`) — the hollows darker, the
  crests lighter (`groundRelief`: the height against rings at 6 and 12 m, baked into the cache and the grass field),
  the small slopes lit against the hill's broad normal (~30 m), the grass's normal 1 mip up (~4 m, was ~11 m) and its
  blades a little taller in the hollows. +0.05–0.2 ms. `?shape=0` off; `?shapeao=` (0.09 / m) and `?shapesun=` (1.1).
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
  **ONE WATER** (2026-11-04/05, the user: "two types of water, not connected, one goes above the other — a proper
  transition, on the ground, not in the air"; the valley's lake laid a sheet over the meadow by its outlet and its river
  ran on into it as a second layer; the desert's river drew its own angular band across the lagoon). In the loader's
  worker (`mapPrep.ts`, ~150–200 ms a world):
  - `reconcileWater`: where a river / stream crosses a lake's or pond's ellipse its surface is eased to that water's
    level (≤ 5 %: the lake pours out down a short rapid, a river runs down into it — the valley's outlet was a 1.2 m
    step), at it inside, downstream never rising; where that lifts it over its banks its ribbon reaches further (`wk`).
    The still levels never move (their beaches, docks and the rowboat are made for them — lowered to the outlet's
    banks, the lake left a bare ring and buried the boat). A stream joining the river takes the river's surface there.
  - `waterOwner`: each lake / pond floods from its middle over ground below its level inside its disc, on into a
    channel only while the flow there is at its own level (never down an outlet to the lower land beside it) → RGBA8 on
    the mask's 4 m grid (`MapData.waterTex`: R its ground, G the depth under it, B how near it is, A the river's own
    water) + the owning body (`MapData.stillLevel` / `stillDepth`).
  - Drawing (`Water.ts`): the still water only on its ground, the ribbons only off it — a hard hand-over (a cross-fade
    of two half-clear layers let the bed show through), the ribbon at that water's exact level there on its fine line
    (`meetStill`: held 6 m past its ground at its middle or either edge, then ≤ 5 %), and in its look (`stillLook`, B:
    all still where they meet, its own over ~22 m, its foam building over ~32 m); a stream runs 16 m on into the river
    it joins and fades out there (A — from 10 m in at the river's ends: a creek into the river's head, end to end, left a
    wedge of bed between two square-cut ends); every ribbon fades in over its first 8 m.
  - RIBBONS: the lines resampled every ≤ 4 m (Catmull-Rom; 18–26 m chords with a corner at every point), the inner
    reach held to 85 % of a tight bend's radius, the outer 20 % faded; the rapids' shallows clear (the bed, a ford's
    track), calm shallows don't foam; the still water's shore foam a band in metres from the waterline (screen-space
    slope — by depth alone a wide flat shallow was a white pane).
  - The grass bake grows nothing under still water, no bush stands in it; `MapData.waterAt` (the drawn water: the car's
    splash, drag, tracks, dust, where a tent can go). Seeded placement (camps, props, trees, the GPS) keeps `waterLevel`
    — a rejected candidate shifts the rest, and the camps' ids are saved.
  **Falls** (`Falls.ts fallLip`): each sheet starts at the brink where the ground really ends (searched along lip →
  foot) and keeps in front of the face it falls past; a fall with no cliff under its lip isn't drawn (a console
  warning); a stream's run over a lip stops at the edge.
- **Post** (`Post.ts`): REMOVED in the PlayCanvas port (2026-11-03; off by default since 2026-10-27 — the user's call):
  every tier draws straight to the canvas, each shader tone-mapping its own output (the sky paints the sun's glow).
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
  **The leaves' DEPTH PRE-PASS** (2026-11-06, docs/PERF.md — a cut-out's discard turns the early depth test off, so every
  card in a crown was shaded): the 4 leaf / frond LODs drawn first depth-only (the cut-out, alpha-to-coverage on MSAA),
  then shaded with depth EQUAL and no discard — each visible leaf sample shaded once (`?treepre=0`: one pass).
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
  FULL SCREEN button (top-right corner, title and game — `ui/fullscreen.ts`; Fullscreen API, the orientation left to
  the phone; iPhone: "Add to Home Screen" hint). Default tier
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
- **Matte paint, grain relief** (2026-11-05, the user — after Over the Hill's cars: "ours are shiny, glossy"; "by
  grains I mean the 3D grains, not the colour"; "tiny 3D dots — on red, small red dots"; "on the body and the bonnet,
  not the tyres"; "so small, like sand grains"; "only on the red parts — not the top of the car"): every vehicle (both
  cars, both bikes — `Vehicle.ts` FRAG, shared by Bike.ts) is MATTE: rough everywhere (0.92), no clear coat (the
  Schlick glint and the sky mirrored in the paint gone), only a very broad faint sheen in the paint's own colour and the
  soft glow of the sky's light. All its BODYWORK carries a RELIEF of tiny raised GRAINS, light only, so each takes the
  colour of what it's on: a dome round each point of the paint noise's cellular channel (A), at two sizes by the
  distance, both fixed on the surface — SAND up close (~4.5 mm across every ~6.5 mm, ~1 mm high) giving way to DOTS
  further off (~1 cm every ~2 cm, ~3 mm high; sand is under a pixel past ~2 m) — over a faint orange peel. In the
  vehicle's own space, projected along each face's own axis (its normal from the position's derivatives: no
  stretching, whichever way it turns), turned into a slope by Mikkelsen's surface gradient (three height samples a
  pixel); the gaps between the grains shaded (their occlusion — a face square to a high sun shows no slope) and their
  tops catching a little sky (black parts show faint grey grains); faded by the pixel's MEAN footprint (the longest
  faded the grains off the top of the car, seen at a glance) and skipped beyond. WHERE: the paint mask — 1 the paint
  (tinted), 2 the rest of the bodywork (untinted: the roof, trim, bumpers, arches; a bike's plastics, frame, engine —
  loadModels.ts / Bike.ts), 0 smooth (the wheels and tyres, the chain, the cabin, the controls, the glass); the
  character keeps his own (`NO_GRAIN`). `?grain=0` turns it off: A/B (abgpu, 1080p, the chase view) ULTRA +0.06 ms,
  LOW +0.08 ms (4 %).
- **Seen from inside** (2026-11-05, the user: "from inside the car the water isn't visible"): the windows no longer
  write depth — the water, transparent too and drawn after them, was culled behind every window (the lake bed showed
  through). And the meadow lies FLAT under the car (`Grass.car`: its footprint, 10 cm round its box; the blades in it
  at 12 %) — it grew up through the floor and the dash. `?carflat=0` turns that off.
- **Camera zoom** (the user): the chase camera's distance 3.5–40 m, eased — mouse wheel, two-finger PINCH, + / − keys,
  on-screen + / − buttons (held: keeps zooming); in the free camera the buttons change the field of view.
- **The MOUNTAIN BIKE** (2026-11-05, the user: "a mountain bike like the stunt bike in GTA 5 … each and every physics
  for the bike, the shock absorber and all"): a full-suspension enduro bike (27.5", 150 mm fork, 142 mm rear on a single
  pivot) and its rider, carried on the car — **B** takes it off (the car PARKED: kinematic, engine off, no keys, no
  winch — the physics streams round the bike now), B again gets back in, or brings the car to you from > 15 m (GTA).
  - **One geometry** (`gameplay/vehicle/mtb.geometry.json`): every dimension and pivot, its rotation convention, for
    the model, the physics and the drawing alike; the API the game reads is `mtbTypes.ts`.
  - **The model** (`scripts/oth/mtb.py`, Blender headless, reads the JSON → `assets/models/vehicles/mtb.glb`; a
    `.blend` in `scripts/oth/.cache/`): 24 flat parts at their pivots — frame, steer, fork lowers, both wheels, swingarm,
    the shock's body and shaft, cranks, pedals, chain, 12 rider segments built straight from their joints; flat colours
    by name (`Paint` tinted). Bike ≈ 15.4 k tris, rider ≈ 7.2 k.
  - **The physics** (`MtbSim.ts`, `tests/mtb.test.ts`): one Rapier body, the wheels, springs, tyres and rider solved
    each step from 6 rays at real gravity — the fork along the steering axis, progressive air springs (27 / 30 % sag),
    separate compression / rebound damping, bumpers and hard stops, the rear's swingarm angle and shock length from the
    geometry; knobbly tyres per surface (grip, rolling resistance), kerb rays; human pedalling (375 W, a sprint), a
    12-speed cassette shifted for 70–95 rpm, a freewheel; front-biased discs (0.8 g, a rear skid, over the bars, a
    stoppie); balance as a hard roll constraint (lean into turns, a foot at a stop); the rider's weight moving the COM
    (wheelies, manuals, reflexes on climbs / brakes / drops); a bunny hop (hold to load); flips and spins in the air;
    landings judged, crashes (impacts, bad landings, loop-outs, wash-outs) throw the rider off as their own body.
    ~21 µs a step.
  - **The drawing** (`src/oth/Bike.ts`): ONE draw for the bike and the rider — every part's vertices carry its index,
    the parts' poses (3 × 4, bike space) go up as one uniform array (`uParts[0]`, both backends), the car's surface
    shader. Bars and fork about the steering axis, lowers + front wheel up it, swingarm R(a) about the pivot, the shock's
    halves aimed at each other, the chain aimed and stretched BB → rear axle, cranks with the cadence, pedals level;
    the rider by two-bone IK (hips on the saddle or up out of it, the torso leant till the hands reach the grips, feet
    on the pedals with the heel dropping, knees forward, elbows out, a foot down at a stop; thrown off: the bail body).
  - Around it: the chase camera framed for it (5.2 m, look 1.25 m — `ChaseCam.frame`, a `ChaseTarget` either vehicle),
    the map / GPS / crossing / pickups / camp / saved spot follow what's ridden (main.ts `ride`), thin tyre tracks and
    small dust (`TyreTracks.bikeMarks`, `Dust.bikeTyres`), its tyres' sound and a freewheel ratchet (Audio.ts), the
    touch pads HOP / LEAN ▲ ▼ (BIKE / CAR in the action wheel). Keys: W pedal, S brake, A D steer, ↑ ↓ lean, Space hop, Shift sprint, R back on.
    (2026-11-05: the BICYCLE is out of the game — the user — only the motorbike is built; this section describes
    the shared machine.) Harness: `scripts/harness/bikeride.mjs` (a scripted ride, state logged), `bikeshot.mjs` (still views);
    `?ride=bike` starts on it, `?bikedraw=0` hides it (cost A/B).
- **The motorbike** (2026-11-05, the user: "it's a cycle, not a bike — we want a proper bike too, like the stunt bike in
  GTA 5"): a 450 cm³ motocross / enduro bike, our own design (`moto.geometry.json`, `scripts/oth/moto.py` → `moto.glb`).
  - **The physics** is the bicycle's: `MtbSim.ts` exports `buildBikeSim(geometry, tune)` — the suspension, tyres,
    balance, rider, stunts and crashes are one machine; `MtbSim` is it with the bicycle's numbers, `MotoSim`
    (`MotoSim.ts`) with the motorbike's: 105 + 82 kg, 310 mm both ends on near-linear coils, and an ENGINE in place of
    the legs (`tune.engine`: 49 N·m / ~61 hp, idle 1700, limiter 11 800, 5 gears × 2.6 primary × 50/13 final; an
    automatic clutch that slips under 3200 rpm, automatic shifts, engine braking; the drive held to 1.3 × the rear's
    grip; WHEELIE CONTROL — not leaning back, the throttle eases as the front loses its load; the rear brake held to its
    grip, ABS). Air control (flips, spins) only after 0.3 s in the air — a bump at 80 km/h isn't a jump; a front sliding
    1.1 s washes out. 0–60 km/h 2.5 s, ~155–165 km/h flat out. Tests: `tests/moto.test.ts` (13).
  - **The drawing** is the bicycle's: `Bike.ts` exports `Bike` and `MotoBike` (`buildBikeView(geometry, opts)`): the
    countershaft sprocket is the 'crank' (turned by the rear wheel × the final drive), the footpegs are the 'pedals'
    (fixed — `opts.pegs`), the rider stands at `rider.standHip`; the shock's halves are turned from their rest angle
    (the motorbike's slants). The rider is the bicycle's — a stand-in until a character GLB.
  - **Around it** (main.ts): `two` the two-wheeler ridden (`riding`); F on / off the motorbike, B the bicycle, either
    straight across to the other; the action wheel has Car / Bicycle / Motorbike. The chase camera 6.2 m back. Its
    engine is a second voice of the synth (`VOICES.moto`, a single — Audio.ts `moto`). HUD: gear · rpm.
    `bikeride.mjs` takes `VEH=moto`; `?ride=moto` starts on it.
- **The rider** (2026-11-05, the user's character — `refer/char.png`): `src/assets/models/human/rider.glb`, built by
  `scripts/oth/rider.py` from the Meshy mesh (a bare A-posed mesh): decimated to 12 k tris (the colour borders kept),
  cut into Bike.ts's 12 rider segments, each straightened into its frame (local −y from the proximal joint) and stretched
  to the geometry's bone lengths, painted by region (flat colours by material). Near a joint each vertex also carries
  the neighbour segment, its place and normal in that segment's frame and a weight: Bike.ts's vertex shader mixes the
  two poses (smooth elbows, knees, hips, shoulders, neck). `Bike.load(url, riderUrl)` takes the bike's parts from its
  model and the rider's from rider.glb (the model's own rider is the fallback). The vertex attributes are packed
  (`aPack` = paint, part, blend part, weight) — WebGPU allows 8 vertex buffers. The three GLBs (mtb, moto, rider) are
  DRACO-compressed by their scripts (14-bit positions, 10-bit normals, 12-bit generic — DRACO=0 writes them plain):
  ~¼ the download, the same triangles; Bike.ts decodes them on PlayCanvas's workers (public/draco), as the formations.
- **On foot** (2026-11-05, the user: "a skeleton and proper animation for walk, run, jump, grab … getting out of the
  car by opening the door, on and off the bikes"): `src/oth/Character.ts`, the model `human/character.glb`.
  - **The asset** (`scripts/oth/character.py`): rider.py's painted, decimated mesh; a 22-bone skeleton on its measured
    joints with Mixamo's names; automatic (bone heat) weights, 4 a vertex; 19 Mixamo clips (`scripts/harness/
    mixamo.mjs` — exported on Mixamo's X Bot through the user's signed-in session) RETARGETED: the source turned to face
    our way, each of our bones made to point as the source's does at rest (their T-pose vs our A-pose), then the
    source's turn from its rest applied; the hips' travel scaled by the legs. Loops (idle, walk, run …) have their
    travel taken out and their speed kept (the skeleton node's `clips` extra); one-offs keep it. Blender at 30 fps.
  - **Drawn**: one draw, skinned in the vertex shader (the bones' 3 × 4 poses × the inverse binds as one uniform array,
    the bikes' pattern), the car's surface shader. The skin and clips are read from the GLB by Character.ts (the
    game's loader keeps neither); the mesh through the loader (Draco).
  - **Played**: clips sampled on the CPU and cross-faded (0.2 s); a loop's rate follows the speed it moves at; a one-off's
    travel (`travel()`) is handed to the character's place and heading at its end.
  - **Moved**: Rapier's kinematic character controller (a 0.3 × 1.7 m capsule in the Player group — it meets the ground,
    rocks, trees, props and the cars, never a bike): W A S D from the camera's view, run 4.6 m/s, Shift sprint 7.2,
    Ctrl walk 1.7; on a touch screen (the car's pads hidden) a STICK (a little = walk, most = run, the rim = sprint),
    JUMP, SPRINT (held), the DOOR button; the camera dragged with a free finger. After getting out he turns to face
    along the car (the camera comes round behind him down its flank). Space jumps
    ~0.65 m (4.8 m/s, g 18) — GTA's short hop: Mixamo's game-pack "Unarmed Jump" / "Unarmed Jump Running" (the first
    clips read "like Spider-Man"), IN STEP: each clip's air (its hips back up through their start after the crouch,
    and down again) found at load, the clip started a moment before its take-off and its air played over the
    physics'; their own rise and drift taken out; the arms 65 % the idle's / run's (an arms-only layer: closer to the
    sides); a fall holds the jump's top; a real drop lands into a crouch.
  - **GTA-style locomotion** (the user: "how walking and jumping work in GTA 4 and 5 — that much realism"; GTA IV's
    Euphoria — physics-driven bodies — is beyond this; GTA V's techniques are here): ONE BLEND ('loco': idle → walk →
    run → sprint by the speed, each over the last) on ONE stride PHASE — each clip lined up at load on its left foot
    furthest forward, the phase advanced a cycle per stride length at the speed moved (no sliding feet, no foot
    clash between clips); WEIGHT (up to speed at 9 m/s², stops at 13, turning 11 rad/s standing down to 5 at a
    sprint, slower up a grade); a LEAN into turns (rate × speed, ≤ 12°) about the feet and forward / back with the
    acceleration; the HEAD toward where the camera looks; stepping feet turning on the spot; FOOT IK — each ankle on
    the ground under it (the terrain or a slab's top), the pelvis down for the lower, two-bone legs on their own bend
    plane, the feet keeping their turn (all as model-space turns after the clips, before the skin).
  - **On the bikes** (2026-11-05, the user: "the human on the bike is broken — I can see through his buttocks and hands,
    parts are cracked"): the SKINNED character rides both bikes (`Character.rideOn(bike)`); the segment rider
    (rider.glb) is no longer drawn (`Bike.skinned`: its parts zeroed). Bike.ts still poses its rider model each step and
    hands the character its targets (`Bike.riderT`, bike space): the hips' centre, the torso's lean, the grips, the
    ankles. On them: the seated clip as the base, the hips put on the bike's, the body tipped so the torso (hips →
    neck, measured after the clip) leans as the rider model does, two-bone IK for the arms (the wrist 8 cm back from
    the grip) and the legs (the feet keep their turn).
  - **The bail** (GTA's): thrown off, he follows the crash's capsule (the falling clip, his middle on it) and the chase
    camera follows him, not the bike; come to rest (under 0.8 m/s for 0.35 s, or 4 s), he GETS UP — Mixamo's
    "Getting Up" from his back or from his stomach, chosen by which way his chest faces, the clip's lying pose laid
    where the body lies with his head where its head is (`Character.lieOf`), its middle played at 1.8× (~2.5 s) — then
    you're ON FOOT, the bike lying where it fell. F by it ("Get on"): stood up and ridden. Taking anything else, a
    bike left lying is stood up, parked (`clearFallen`).
  - **The API badge**: a small tag on the menu button's corner — amber GPU (WebGPU), grey GL2 (WebGL2).
  - **Cameras** (2026-11-05): V first person ⇄ third (third the default), Shift + V the free camera. FIRST PERSON: the
    camera at HIS EYES everywhere — on foot, on both bikes, in both cars (the user: "the camera must be his eyes, not
    above his head"): the point between the eyes, 1.5 cm behind their surface, found on the mesh at load (the nose's
    tip, the eyes 3.8 cm over it) and carried on the head bone (`Character.headWorld` — it turns and leans with the
    head); the head shrunk away, the near plane 5 cm. In a car it's kept under the roof lining (`Vehicle.roofY`). On
    foot the stride's bob is steadied (25 % of the head's swing round its 0.6 s average, as GTA's); W walks where you
    look. Dragging looks round, in a vehicle easing back ahead. ON A BIKE (still his eyes) the lens widens to 70° and he sits up 0.4 rad
    (`FPP_SIT_UP` — none of him seen but his arms: a leant rider's eye is over the bars, and a screen is narrower than
    an eye), the view tipped down to put the grips ¾ of the way to its bottom edge (~22° on the motorbike, 34° on the
    bicycle): the bars, the number board and his hands in view.
  - **The cockpit** (Vehicle.ts): the models' own steering wheel (14 : 1 to the front wheels), pedals, gear lever and
    wipers — never drawn before — on their pivots; the wipers always (P sweeps them), the rest within 14 m or inside.
    THE DRIVER sits in the car whenever you're in it (`Character.sitIn`: the seated clip, the hips behind and under
    the wheel's hub, under the roof), his hands at ten to two by two-bone IK, turning with the wheel (to ±80°).
  - **Proportions** (rider.py, both the rider and the character): the shoulders and upper torso narrowed up to 13 %
    and the head 5 % larger — the user: "a normal human, nothing big, nothing small" (from the back the shoulders were
    round domes); the shoulder caps the clavicles' (the arms' share fades in past the joint); the FACE painted from
    the nose's tip — eyes, brows, lips, a moustache, stubble on the jaw. Checked by eye in headless Chrome from
    six sides.
  - **The weights** (character.py): above the hip joints the thighs' share eased onto the hips (sooner at the back) — bone
    heat had the buttocks swinging with every stride. AMBIENT OCCLUSION baked by Cycles into the vertices (COLOR_0),
    multiplied into the colours (0.4 + 0.6·ao).
  - **In and out** (main.ts `getOut` / `getIn`, F — on a touch screen the DOOR button, shown only when there's
    something to get into or out of; on foot by a vehicle the prompt "F Get in / Get on"): the car stops and parks,
    its DRIVER'S DOOR (drawn on its own pivot — `Vehicle.doorOpen`, `driverDoor`) moves IN STEP with the clip — from
    the left hand's path in it: getting out it's pushed open over 7–27 %, the body leaves the seat over 34–55 % (the
    step down from the 4×4's height), pushed shut over 62–74 %; getting in pulled open over 12–30 %, the climb up over
    36–55 %, pulled shut over 60–75 %. A DOOR CAMERA (outside the driver's door, behind it) films it. Off a bike the bike is PARKED there (`Bike.park`: drawn without its rider, no physics); F
    near it gets back on. WHICH VEHICLE is chosen in the GARAGE (2026-11-05, the user: not from the wheel): G500, E30,
    the mountain bike, the motorbike (`settings.ride`; in the pause menu taken at once — `applyRide`: onto it beside
    you, the car parked, or into the car — brought to you if it's far). The action wheel keeps only the rare things. The chase camera frames the character
    (4.2 m) and stops in front of the cars (VehicleMesh in its ray). `?ride=foot` starts out of the car,
    `?chardraw=0` hides the character (cost A/B: within noise, ULTRA and LOW).
- **The motorbike's power and the climb assist** (2026-11-05, the user: "more speed and power so it can climb every
  wall and hill"): ~80 hp (~180 km/h); `tune.climbGrip / climbTorque / climbStick` — on a slope from 12° to 55° the
  tyres grip up to ×2.2, the drive ×2, the bike is held into the face with up to 0.9 g (and for 0.35 s after a bump
  throws it off one); the rider lets the drive through on a face; fallen-over and sideways-landing judged against the
  ground. Tests: 30° … 70° faces climbed; in the valley 33–46° hills (a rock ledge ridden into head-on still crashes).
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
  - **Map + compass** (MapView.ts — since 2026-11-03 with waypoints, both worlds' tabs and the GPS: "The GPS" below):
    Tab / MAP — a painted chart (hillshade, 40 m contours, colour fields, tracks — rough
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
- **Woods (2026-11-05, the user: "the valley feels empty … make it feel full, without increasing cost — real trees at
  the front, the back an image, no one will notice")**: `placeTrees` gathers the trees into STANDS (the 45 m clump noise
  past 0.42–0.58: crown to crown, a dark mass with an edge) with open ground between, plus COPSES of a few on the open
  meadows (the 28 m noise, off the forest mask); a stand's spruce a little taller toward its core and ~1 in 9 an old
  GIANT of 26–36 m (was 6–21 m: nothing to read the hills' scale by). 23.1k → 42.9k trees (mean height 13.3 → 17.4 m).
  Paid for by the LOD ranges (quality.ts): the mid LOD hands over to the impostor a quarter sooner (ULTRA 140 → 95,
  HIGH 120 → 95, MEDIUM 100 → 80, LOW 85 → 70 m), ULTRA's full LOD 60 → 50 m, and the far rank cull starts ~1/6 sooner
  (ULTRA 450 → 380 …; the survivors grow, and there are more trees to thin). Checked in headless Chrome: a still frame
  can't tell an impostor from the tree past ~60 m; the near LOD at 50 m can't be told from 60, at 40 its plumes drop
  off; a drive-by shows no pop. Cost (`scripts/harness/abwoods.mjs`, uncapped 1080p, interleaved ×4, 6 views + 6 spots
  on tracks through the forest): ULTRA 1.02 → 1.01 ms, HIGH 0.91 → 0.95, LOW on the phone viewport 0.56 → 0.58 (the
  run-to-run spread ±0.08). Most views are flat or cheaper; standing in a dense stand is ~+0.25 ms on ULTRA / HIGH
  (the near crowns' fill, not their count). `?woods=0`: the old scatter and the old ranges.
- **Fuller valley (2026-11-06, the user: "why does our world feel empty, especially the valley" — the painted rock
  stays as it is)**: measured first — within 25 m of a track stood ~3.4 trees, 3.6 bushes, 1.8 rocks, 1.4 props; a
  meadow past the grass's reach was one flat colour; a hill's sunny and shaded sides were nearly one value.
  - THE VERGES (`?verge=0` off): along both edges of every track (each spot its own `cellSeed`, after everything
    else) — stones in ones to threes 0.9–3 m and now and then a 3–5.5 m boulder (`Rocks.place`, the last pass: the
    grass is ~1 m, a smaller stone is lost in it), bush groups (`placeBushes`'s last pass: 1–2.5 m, thick on the green
    and at the forest's edge, sparse on the gold), FALLEN LOGS and STUMPS (Places.ts's last pass, new prop kinds `log`
    / `stump`: by the trees mostly; a collider each). The verges' stones are held back (`Rocks.settleVerge`, World.build
    after the places): placed with the rest they moved every tree and a log pile — and with it every supply crate's id
    (the journal keeps them); now the trees, the field's bushes and every prop and id are as before (checked), the
    verges' stones keep clear of the trees and props. +1.8k rocks (8.8k → 10.7k), +3.3k bushes, 107 logs, 118 stumps.
    (The stone PROP scaled up read as a block: none in the verges.)
  - THE FIELD'S CLUMPS (`paint.ts` groundPaint, `?fieldpaint=0` off): patches a few metres across a step darker or
    lighter and TUSSOCKS (dark clumps ~1.5 m round in a 4 m cell, `dotsAt`) on the open grass; the blades take their
    root's colour, so near and far show the same clumps — no seam at the grass's edge; fading to their mean toward a
    pixel; mean brightness kept.
  - THE LIGHT (`Atmosphere`, `?light=0` off; the valley by day only, fading out by dusk): the haze a third longer and
    clear for 260 m (was 130); the sky fill and bounce −22 %, the sun +8 %, and `uWrapCut` 0.6 — the wrapped diffuse's
    wrap (0.62 on the ground: a face square to the sun took 38 % of it) cut in `shade()`; the fill alone moved the frame
    ~1 %. Shaded ground ~5–7 / 255 darker, the lit faces as they were.
  - Cost (`scripts/harness/abverge.mjs`, uncapped, interleaved ×4, 6 views + 6 track spots at the chase camera's
    height): ULTRA 1080p 0.770 → 0.778 ms (CPU 0.268 → 0.280), LOW phone viewport 0.577 → 0.590 ms (CPU 0.21 both);
    +2 draws (log, stump), triangles +2–8 % (LOW +3–15 %). Load: +4 ms (settleVerge), +7 ms bushes.
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
- **The HUD's controls** (2026-11-05, the user: "congested and overlapping … make it like GTA 5, all inside a round
  thing"): the top-right corner holds FULL SCREEN and the ACTION WHEEL's button (`oth/Wheel.ts`, Q on a keyboard) — one
  SVG ring of sectors: pause, map, minimap, bike / car, winch, reset, lights, time, weather, sound (+ the free camera
  on a keyboard). Tap the button then a sector, or hold it and slide onto one (GTA's); a tap outside / in the middle, Esc
  or Q close it. Built when it opens, nothing while shut (DOM only: no GPU cost). The touch screen keeps only what you
  drive with: ◀ ▶ bottom left, GAS / BRAKE bottom right (manual ▲ ▼ over the brake; on the bike HOP over GAS, LEAN ▲ ▼
  beside the steering), the speed between them, CAMP a pill over the speed when you can. Portrait: smaller pads, the
  speed above them, the compass its own row, the coins top left. Short screens shrink the title's list (`menu.css`).
  Checked: `scripts/harness/uishot.mjs` — title, settings, car, bike, minimap, wheel, pause at 360×740, 740×360,
  640×320 (touch), 1024×768, 900×600, 1280×720, 1920×1080: no two controls overlap, none leaves the screen.
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
- **Birds** `oth/Birds.ts` (2026-11-02, ULTRA on a PC only for now; `?birds=1|0` forces them): seen from far below, so
  low things — 8 triangles a bird (head, tail, two wings bent at the elbow), dark silhouettes in the haze. 7 FLOCKS
  (a V of 7–11, or a loose band of 4–10) crossing the sky weaving, 6 LONE birds of prey circling (banked, gliding, a
  few slow beats now and then); 63 birds, ONE draw, no CPU per frame: the vertex shader moves and flaps them from the
  clock. Paths repeat every 1 600 m round the camera (shrunk to nothing at 576–752 m first), so there are birds
  wherever you are; 35–130 m over the ground (the height texture, looked ahead 70 / 150 m). They roost one by one from
  dusk (not drawn at night) and shelter in the rain. Cost: ~0.01 ms (noise) on ultra.
- **Place sounds** `oth/Audio.ts` (2026-11-02; every tier — sound costs no GPU): a CAMPFIRE's crackle by every fire
  (loud at 2.5 m, gone past 34 m) and a POND's frogs and birds by day (streamed beds like the others); CALLS round the
  camera — blackbirds in the trees by day (every 2–9 s, 12–55 m off, more often deep in the woods), a tawny owl from
  the woods at night (every 14–44 s, 35–110 m off; a third of the time another answers), frogs along the nearest
  shore from dusk (rain or not; ≤ 3) — decoded clips fetched the first time they're wanted, each at a spot in the
  world: 1 / distance, a low-pass that dulls the far ones, panned and re-panned as the camera turns; ≤ 5 calls at once.
  The RIDGE WIND is synthesized (brown noise → a band-pass wandering with slow gusts + a low-pass roar) and swells
  with how far the ground stands over its surroundings (140 m ring), its height and the camera's — silent in the
  valley. Main thread: the camera's surroundings 4× a second (a few height samples). Sources and processing:
  `docs/ASSETS.md`. No CC0 hawk / eagle cry was found (the birds of prey are silent for now).

## Make the Valley great — stage 2: places worth stopping for (2026-11-06)

The user: *"improve the existing world so players enjoy exploring it — recognizable points of interest, not random
objects; lakesides worth stopping at; tents and camps that look lived in; broken houses, hidden places, caves big
enough to drive through, with lights on the walls; a terror feel at the ghost house; houses lit at night; colour and
realistic stylized textures at no cost; cabins and tents too small beside our vehicles and people; 500+ fps on ULTRA
after all of it"*.

- **The kit** (`oth/Kit.ts`): the parts every place is built from, on the bridges' `Builder` (one geometry a place, one
  material) — clapboard / board-and-batten / log walls, gable roofs with real thickness, shingle rows (or tin), fascia,
  barge boards, rafter tails, a ridge cap; framed windows (lit / dark / broken / boarded / eerie, shutters), plank doors
  ajar or shut, steps, porches with rails, stone chimneys, stovepipes, STONE FOUNDATIONS that reach the real ground at
  every point; woodpiles, chopping blocks, mailboxes, barrels, crates, camp chairs and tables, lanterns, packs,
  clotheslines; an old PICKUP (rust, flat tyres, a door open, a wheel gone); A-frame wall TENTS with sagging ridges and
  panels, guy lines and stakes, DOME tents on crossed poles, tarp shelters, fire rings (lit / cold); DOCKS on piles to
  the bed with cross-bracing, cleats and a ladder, ROWBOATS and canoes lofted from sections; rails, ore carts, spoil
  heaps, warning signs, a headframe, a radio mast, split-rail fences. Every part takes a `Ground` (the height under a
  local point): nothing floats, nothing is set on a flat patch.
- **Surfaces** (`Builder.setSurf`, `SURF`): wood (the grain), STONE (blotches at two scales, lichen on what faces up),
  painted METAL (rust bleeding in by a slow noise), FABRIC (a weave, sun-bleached tops, the light wrapping through),
  plain; LAMP (crystals, cave lanterns: their own light day and night) and EERIE (the ghost house's window: a cold light
  that gutters, dusk to dawn). Packed with the glow in the one existing attribute (glow + 2 × surface): no new vertex
  data, no textures, a few ALU in the props' / landmarks' shader.
- **Sizes** against the 1.8 m character and the 2.3 m truck: cabins ~8.5 × 6.5 m with 3.3 m walls, 2.3 m doors, a
  ~6 m ridge (SCALE 1 now — they were the kit's ×1.3); wall tents 2 m tall, 3.6 m long; dome tents 1.6–2.0 m.
- **The places composed** (`oth/Locations.ts`, built by `Landmarks.ts`' PLACES with a context: the ground, colliders,
  the grass kept off floors and yards — stamped into the rocks' footprint):
  - CABINS each their own story: Trapper's (logs, lit, a hide frame, a woodpile, his truck), Pond Cabin (barn-red
    clapboard, white trim, green shutters, porch chairs, a mailbox, a clothesline, a boat pulled up), Birch Hollow
    (slate-blue board-and-batten, green tin roof, a garden behind a fence, the outhouse), Old Hut (mustard paint gone,
    the roof sagging and holed, windows broken / boarded, the porch fallen in, a rusted truck on flat tyres, junk).
  - THE MINE: the adit in a heavy timber portal with the hill's rock built up round it, rails out to an ore bin on
    stilts, carts (one tipped), spoil heaps down the slope, a headframe over a fenced shaft, a tool shed, a stone
    powder house with its warning sign, barrels, crates, lantern posts.
  - THE FISHING HUT on the lake: board-and-batten, tin roof, stovepipe, a net on its rack, a 14 m dock, the rowboat
    tied to it, a canoe upturned on the bank.
  - CAMPS in four styles (by place: water camps fish): EXPEDITION (the camper), HIKERS (three tents round the fire,
    chairs, a table, packs, a clothesline, their truck), FISHERS (a wall tent, a tarp shelter, a canoe, rods out, a
    drying rack), ABANDONED (a tent fallen in, the fire cold, a pack spilled, a chair over — no fire, no light).
- **New places** (`oth/Sites.ts` picks where — deterministic, from the map — clear of the old places, the props and
  each other; `?sites=0` without them): the LANTERN TUNNEL (a drive-through cave over a straight 30 m of track: rock
  walls 5.4 m out each side, a vault ~7 m up, moss and grass on top, vines at the mouths; crystals glowing on the
  walls, lanterns on old timbers, the miners' broken scaffolding, a fire in an alcove), the CRYSTAL GROTTO (an overhang
  at a slope's foot, deep enough to drive into, its back closed: crystals, a camp with a fire, timbers propping the
  roof, a lip of blocks over the mouth), THE HOLLOW HOUSE (a two-storey house gone grey deep in the forest, its roof
  sagging, one upstairs window holding a light that gutters from dusk, dead trees, a swing, a graveyard, the gate
  hanging), two STONE RUINS (walls standing to different heights, a gable end, a lone chimney, rubble), RANGER STATION
  7 (painted cabin, green tin roof, a 16 m radio mast with its red light, a flag, a notice board, a water tank), HANK'S
  GARAGE (barn-red workshop, doors open, a car on blocks, a fuel pump, tyres), two RIVER SHELTERS (log lean-tos, a fire
  burning), ASHFORD (an abandoned hamlet: a ruin, a cabin falling in, a barn with its roof half gone, a well, a cart),
  the SURVEY CAMP (dome tents, a weather mast, a solar panel, a generator, survey stakes — left in a hurry), four pond
  DOCKS (with a boat or a canoe, a rod, a bank shelter, a cold fire), THE DROWNED TRUCK at a river crossing.
  Each takes its ground: the trees, bushes, stones and small props in its disc are taken out (World.build) — the
  trees' places as before for Places.ts, so every crate's id is unchanged.
- **The pads grown back** (`Sites.regrowPads`): scenery.mjs had painted every landmark's levelled pad as TRACK (a bald
  sand disc); the trail texture there is the real tracks' distance again, plus a worn yard at the door and a 2 m path to
  the nearest track — the rest grass.
- **Caves' dark** (`Atmosphere.caveK`, uniforms `uCaveA0..2` / `uCaveB0..2` — single vec4s: the renderer's layer sets no
  uniform arrays): within a cave's radius of its line and under its roof the sun and the sky's light fall to ~15 %,
  fading in over the mouth's first 9 m (a grotto's back closed) — the ground, the rocks and the places' shaders; the
  crystals, the fire (its light: `uFire`) and the headlights are what you see by.
- **Fires, lights, smoke** (Landmark `fire` / `lights` / `smoke`, Props.ts): any place can burn a fire (the camps but
  the abandoned, the tunnel's alcove, the grotto, the shelters), glow at its windows from dusk (the lived-in cabins, the
  ranger station, the fishing hut), and send up a SMOKE COLUMN (chimneys, camps): 10 big soft puffs rising ~40 m,
  leaning with the wind, seen out to ~1.4 km — one draw for all, while one is within 1.5 km. What pulls you off the road.
- **Notes** (Landmark `note`, `Sites.NOTES`; main.ts `noteHud`): stopped within 11 m of a place with one, its card
  (`.oth-note`); the first read pays 15 ◆ and is kept (`oth.notes.<map>`). Eleven notes, one story between them — the
  survey team, the lights on the ridge, the Hollow family, the tapping below the mine.
- **Cost** (`scripts/harness/absites.mjs`, `?sites=0` vs on, interleaved; and everything of this round off vs on, 4
  views ×3): ULTRA 1080p 0.778 → 0.796 ms (≈ 1250 fps); see docs/PERF.md for the per-place numbers. Load: sites
  ~80 ms, the landmarks' build ~125 ms (the tunnel's and grotto's rocks), pads 6 ms.
- **Not yet**: trails cut to the hidden places (they're reached off-road); interiors; the grotto deeper than its
  overhang (the heightfield has no overhangs: caves are built over it); chimney smoke by night.

### The caves, as land (2026-11-06, later)

The user: caves must be real land with grass above, rock that looks like the terrain's (no piles of boulders, inside
or out), different shapes, one way in, big ones with pines under a hole in the roof. `Locations.ts` THE CAVES:
- every cave is a HILL of turf (`SURF.turf`: the field's own `grassPaint`, the land's dryness per vertex, grass tufts)
  over one continuous rock shell in `SURF.cliff` (the terrain's slab paint, its beds, `rockFill`), smooth surfaces with
  their own normals (`Builder.raw`, `smoothMesh`) — no blocks;
- the Lantern Tunnel: the track through a hill, cliff faces over the arches, the road's cut walled in leaning rock;
- three one-way caves (`grotto`, `Landmark.style`): `sky` (a big dome, a shaft through the hill to a hole in the turf,
  a lit column — `caveK`'s B.w — young pines and bushes growing in it), `hall` (a long gallery, crystals, the survey's
  camp), `den` (small and low, a nest); each mouth a cliff face leaning back, its line, the walls' bulge and the sizes
  varied by the seed (`cavernLand`, shared with `Sites.dressHills`, which lifts the trees and bushes onto the hills);
- the dark: the three caves nearest the camera each frame (`caveUniforms`).
Cost (`scripts/harness/cavecost.mjs`): ≤ 0.14 ms at a cave ULTRA (worst 1.34 ms ≈ 745 fps, the forest's), ≤ 0.18 LOW.

## Worlds, the desert (2026-11-02 — the to-do list: docs/NEXT.md)

- **World.ts**: everything built from one map under one group, built a step a frame while playing, disposed whole
  (verified: GPU memory back to the same counts after every swap). What lasts — renderer, camera, Atmosphere, car,
  physics (`setWorld`), sound (`setWorld`), HUD, terrain shadow (`setMap`) — reads the current map via `liveMap()`.
- **Workers**: `mapLoad.worker.ts` + `mapPrep.ts` (fetch + heights, normals, distance fields, the terrain's pyramid);
  Draco in DRACOLoader's workers; textures uploaded and shaders compiled a step at a time before a world is entered.
- **The desert** (`public/oth/desert`, `?world=desert`): `scripts/oth/desert.py` (terrain, beds terraced, ledge roads,
  masks, meta with `biome` + `gate`), `scripts/oth/desert_rocks.py` (Blender: the sandstone slabs' low-poly skins →
  `formations.glb`, drawn by `Formations.ts`); `OTH_DESERT` in every world material (sand / sandstone palette, wind
  ripples, oasis-only grass, date palms, Over the Hill's bushes, the desert sky grade).
- **The crossing** (`Crossing.ts`, round 2 — NEXT.md has the numbers): each world's `meta.gate` (where, how high, the
  way out, its `mist`) at the top of a long climb — the valley's GREAT CLIFF (`scripts/oth/valley_cliff.py` over the
  baked valley: a ~490 m plateau, a 7-leg LEDGE ROAD up its west face — `scripts/oth/ledgeroad.py`), the desert's
  escarpment (the same `LedgeRoad`, 4 legs). The MIST (`uMist`: a fog round the camera in `ATMOS_GLSL`, the sky gone
  to it) thickens with the climb; the other world is BUILT IN THE BACKGROUND within 1100 m of the gate (`World.build`
  `background`: the terrain shadow `prepare`d, the shade and the far grid left alone until `World.adopt`; tree / bush
  placement sliced over frames) and kept (not drawn) until the car is 1600 m away; the SWAP at the gate line, at the
  start of a frame: `enter`, the car / dust / free camera moved by the gates' offset (a pure translation: the gates
  face opposite ways), the old world kept for a way back, then disposed whole.
- **The desert's weather and sand**: a SANDSTORM spell (`uDust`: dust fog, dust sky, a dimmed sun, `Rain.ts` 'sand'
  streaks, headlights on, the wind loud) instead of rain; ruts in loose sand (TyreTracks), sand spray by the ground
  (Dust), the car's SAND COAT (`uCoat`, Vehicle.weather).
- **The desert's structures** (`desert_rocks.py` → `formations.glb` + `structures.json` colliders, `Formations.ts`):
  the natural arch (its deck the road — a ground collider), the Roman aqueduct, the ksar, the gorge's blocks; the
  gorge's ROPE BRIDGE (`Bridge.kind 'rope'`, `sag`, `deckY` — Bridges.ts draws it, Physics follows the sag in pieces).
- **The desert's things** (`Places.ts` `desert` branches: oasis camps, wells, Bedouin tents, sandstone ruins; crate ids
  from 100000) and sound (`Audio.ts`: open-sand wind, oasis-only birds and crickets, no owls). Per world: the journal's
  `totals`, the player's camp (`Progress.camps`). `?save=0`: a test session that never saves.

## The GPS: waypoint, route, radar (2026-11-03 — the user: "like GTA 5: mark a destination on the map and it shows the fastest route like Google Maps"; "I don't know how to get to the other map")

- **Nav.ts** — the ROAD GRAPH (`RoadGraph.of(meta)`, once per meta): every `trails.lines` point a node, joined along
  its track; a track's ends to the nearest point of another within 20 m, every point to the nearest point of each other
  track within 7 m (crossings). Edge cost = seconds (40 km/h tracks, 9 km/h rock-crawl routes — only where nothing else goes; the plate warns of one). `route(from, to, map?)`:
  Dijkstra from the track points within 320 m of the start, each reached OFF-ROAD at 22 km/h with a toll sampled every
  8 m on the real ground (`offRoad`: grade², > 70 % a wall, forest / rock slower, fords slower, deep water and the box
  edge walls; a tree trunk or a boulder > 1.3 m within 1.6 m of the line rules it out — `Obstacles`, a grid built the
  first time a world plans a route, ~7 ms), to the point leaving the least off-road time to the end — or straight there when that's quicker; kinks
  in the track data (> 120° back over < 15 m) dropped from the line. A `Route`: points, per-segment off-road / seconds,
  the turns (junctions and leaving / joining the tracks bending > 26°), the progress (`track`: nearest point near where
  the car was, all of it when lost). The GUIDE (one in main.ts, lasts across worlds): the WAYPOINT (`{ world, x, z,
  name }`), this world's leg (to the waypoint, or to this world's gate when it lies in the other world — that world's
  leg from its gate priced on the flat from its fetched meta.json), re-routing (> 40 m off a track / 70 m off-road for
  1.5 s, 3 s apart), the arrival (≤ 25 m: a toast + the chime); `setWorld` at a crossing re-plans from the car next
  frame. Valley graph 4.7k nodes; a route ~1–2 ms (the first ~13 with the graph built).
- **Chart.ts** — the CHART painted a slice a frame (2.5 ms) from entering a world (1024², 768² on phones); the other
  world's is baked: `public/oth/<id>/chart.webp` (`scripts/harness/chartbake.mjs` — RE-RUN AFTER A MAP IS REBUILT).
  Tracks, bridges, places, the pass, the route and the pin are drawn over it as lines each time (sharp, never stale).
- **MapView.ts** — tabs THE VALLEY · THE DESERT; click: waypoint (a place / the pass snaps to it; on the pin: clear),
  drag pans, wheel / + − zoom about the pointer, Z whole ⇄ 800 m, right-click / Del clear, ROUTE TO THE <OTHER WORLD>
  (the waypoint where its pass lets you out). The foot: name, distance, ETA, "via the pass". The HUD under the open map
  is hidden (`body.oth-map-open`); Esc closes the map only (`stopImmediatePropagation`: it used to pause too). The
  compass: the pass (⇑) and the waypoint (violet ◆); its line shows the waypoint's distance while one is set.
- **Radar.ts** — the minimap (bottom left 240×160; top left 150×100 on phones; hidden in the free camera and under the
  map): drawn into a canvas a few times a second (north up, round the car, a margin), turned and slid by a CSS transform
  each frame (compositor only), the car's arrow and N on the rim DOM; zoom 1.7 → 3.4 m/px with speed; the waypoint held
  at the edge; a plate: the next turn (arrow, distance) or the end, the total and the ETA. `?radar=0` turns it off.
- **Checks** (headless Chrome, `frontend/scripts/harness/`): `navtest.mjs` (routes from the spawn to all 24 valley places,
  the cross-world waypoint before / after a swap, pictures of the radar, the map, the desert tab), `gpsdrive.mjs` (a
  steering bot that follows the guide's route until the arrival — `START=world:x,z DEST=world:name|gate|x,z`).


## Every track drivable (2026-11-06 — the user: "travel in the valley and check all routes are actually possible to drive … lot of routes are impossible to drive")

- **Measured first**: `scripts/oth/trackscan.py` (every line every 2 m off the baked ground: the grade over 6 m, the lean
  across the car, the 2 m step, the paint's offset) and `scripts/harness/trackdrive.mjs` — a careful STEERING BOT on the
  game's own physics (TruckSim + Rapier: ground tiles, rocks, trunks, props, bridges, landmarks), run faster than real
  time in batches of fixed steps, driving EVERY track BOTH WAYS; where it stalls, flips, leaves the line or is thrown it
  logs the spot — the grade, the lean, what solid thing it brushed in the last 4 s — and goes on 14 m further
  (`TRACKS=0,3,7`, `TRACE=i0-i1`, `SHOTS=dir`). Before: ~5 of 33 km over the limits; the bot clean on 46 of 152 runs,
  465 problems — the rock-crawl routes up to 200 % (walls of stepped blocks), ordinary tracks to 60 % with 50 % side
  leans, 257 hairpins of 2–6 m radius (A*'s 8 m grid: the car turns on ~7 m), out-and-back spikes in the lines, three
  tracks running through bridge rails, 30 house-sized outcrop blocks and 4 stream-road boulders inside tracks.
- **The fix** (`scripts/oth/trackgrade.py`, a post-process after valley_cliff.py, from `.cache/valley-pregrade`): the
  lines cleaned (spikes cut, bridge crossings snapped onto the deck, every line re-traced by a car that can't turn under
  7.5 m, 10 redundant duplicates dropped), then each track's ground GRADED — a grade-limited profile (≤ 22 % ordinary,
  ≤ 28 % rock-crawl) as close to the ground as cut-and-fill allows, level across the bed, the hillside beside it only
  shifted by the cut; junctions take the bed already graded; water, bridges and the cliff's road untouched; trail.bin
  repainted from the new lines. 24 ha of ground moved, mostly < 3 m; the deepest cut ~21 m (a rock-crawl route into a
  formation: a cutting through the rock). `Rocks.ts`: an outcrop's block whose bulk reaches into a track's bed is taken
  out after the draws (no other stone moves; the desert's crawl-past stones kept) — ~1 ms at load.
- **After**: 121 of 134 runs clean, 21 problems — the rock-crawl routes 1. Left: the cliff's ledge-road hairpins (the
  bot cuts them; `climbtest.mjs` is that road's own check), a short ford beside the bridge at (55, 605), one junction
  step at (−146, −543), and the COPPER MINE site's pieces on track 0 at (−138, 238) / (−139, 248) (Locations.ts — the
  places' own layout, not the ground).
