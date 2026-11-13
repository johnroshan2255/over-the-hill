# The look (branch `look-haze`, 2026-11-13)

The user's painted frames (two Gemini paint-overs of our own screenshots — a fort and a forest track at golden hour):
warm golden light, a haze that swallows the middle distance, rich brown-olive darks, brown dirt tracks, and ruins that
are *dressed* — laid stone, moss and ivy, rubble, burned timbers, a camp, watchtowers. "No real fog, a fog-like
filter"; "we see far and it's empty — hide it"; "in PC good details, in phones reduce it".

`?look=0` turns all of it off (the A/B). Every part is in the shaders the world already runs or in instanced draws.

| part | where | what | tiers |
|---|---|---|---|
| **height haze** | `Atmosphere.ts` `hazeAmount`, `uHaze`, `mistFloor` (main.ts) | exponential height fog: clear ~35 m, ½ gone at ~300 m on the low ground, ~90 % by 1 km, thinner on ridges (peaks stay as silhouettes); its floor the low ground round the camera, eased. `?hz=` density | all |
| **haze colour** | `fogColorK`, `uHazeSun` | gold toward a low sun, a darker amber in the middle distance, peach-lilac far off; the sky's low band matches | all |
| **grade** | `gfx/material.ts` `othGrade` (inside the tone map — no pass) | greens → olive, +sat, a soft S, brown shadows lifted, gold highlights; warmth and S fade at night (`uOthWarm`). `?grade=` | all |
| **vignette** | `Glow.ts` (CSS) | deeper, warm brown | all |
| **tracks** | `paint.ts` `OTH_LOOK` (`TRAIL_LOOK`), `Terrain.ts` | mid-brown earth, deep dark ruts, a dry crown with grass tufts; the rock relief on the earth (0.55) and on the paving | relief: HIGH / ULTRA |
| **masonry** | `Bridges.ts` `masonry`, `SURF.masonry` | the Wardens' walls, towers, arches, house walls and the meadow ruins: courses of blocks, chipped joints, bevels, a tone each, moss on tops and in joints; the rock relief over it; ivy curtains and rain grime | relief, ivy, grime: HIGH / ULTRA |
| **ruin dressing** | `Wardens.ts` KIT `rubble bricks timber crate barrel camp watch`, `D` / `strew` | every fort: rubble along the walls and fallen outside, the houses' charred timbers, bricks, a CAMP inside the gate (Landmarks.campKit; its fire, smoke, lantern and light in Props via `plan.fires`; its ground cleared of tall grass), crates and barrels, two timber watchtowers. Towns: rubble, bricks, timbers. Own seed per site (names and shapes unchanged) | the small pieces: ULTRA / HIGH all, MEDIUM 60 %, LOW / phones 35 % (`detailKeep`) |
| **ground clutter** | `Clutter.ts` | stumps, mossy fallen logs, ferns, dead branches in the woods; stones in the open and on rock; old fences and stones by the tracks. 16 m cells, own seed, streamed round the camera (ULTRA 150 m … phones 80 m), never on a way, water, a place or a ruin. `?clutter=0` | radius and density by tier |
| **ground mist** | `Mist.ts` | soft cards in the hollows 55–300 m out, wisped by the noise, the haze's colour; strongest at dawn / dusk and after rain. `?mist=0` | 36 / 22 / 10 cards |

### Round 2 (same day) — the forest-track frame, the road's dashes

- **The sun's glow in the haze** (`fogColorK`): a Henyey–Greenstein forward lobe (g 0.6, normalised to 1 at the sun)
  instead of s² / s³ — the corridor toward a low sun a hot gold, the sides a dim brown (the cheap model of Unity's *The
  Blacksmith*: height fog + an HG sun lobe).
- **Fog banks** (`hazeAmount`, `?fogbanks=0`): the density ±30 % in broad drifting patches (~300–700 m), read where the ray
  meets the land, from slow SINES — no fetch. Tried and dropped: a noise read part way along the ray (streaked the
  screen in columns), a fine noise on the land (camouflage paint), any texture read (~0.1 ms on the leaves' overdraw).
  Cost with sines: +0.05 / −0.04 ms (spawn / forest — noise).
- **The road's "ladder of dashes"**: a box track knows its centre line only through a texture whose interpolation
  wobbles ~1 m; the look's narrow crown band and deep narrow ruts broke into blocks at the texel pitch. Now one broad,
  soft band per wheel (±1 m), 14 %; no crown band, no painted tufts.

### Round 3 (same day) — box rocks out, the ground sculpted, broken walls, creepers, the harder colour

- **No box rocks on the hills**: the valley's outcrop blocks on a hillside (> ~17° or on the rock mask) removed after the
  draws (`Rocks.ts`, `outcrop0`); the outland's crag bands and ledges not placed. The stone forests' pillars and the
  off-road zones' boulders stay.
- **The ground sculpted** (`mapPrep.sculptCliffs`, `?cliffs=0`): steep ground (27° → 40°) stepped into STRATA in the
  heights themselves — drawn, physics, shadows, grass all one shape. The box's 2 m grid ~8 m steps (crisp); the world's
  8 m grid ~34 m soft bands at half strength (sharp ones aliased into a sawtooth). Off the tracks (24–44 m), roads
  (18–40 m), water, places; faded out at the grids' seam.
- **The meadows' small ruins** (a lone chimney among low walls — a tall box in a field) gone.
- **The roads' low walls** (`lowWall`): `drywall` / `drywall2` — rough single field stones (jittered hexahedra, a
  weathered grey-brown) in four courses, the top broken in two places, moss cushions on the top course, the fallen
  stones at the foot.
- **Creepers** (`creeper`, `creep`): drapes of 8–11 vines with leaves (green, a few red / orange), over the tops and down
  the faces of the forts', towns' and houses' walls and the low walls; their own seed per wall. Thinned by tier.
- **The harder colour**: the grade's saturation 1.2, its S up to 0.52, the shade's lift halved; the rock's extra sky
  fill a third (deep slate shade — the light only); the haze a little thinner (σ 0.0015) and its far colour a darker
  blue-lilac. `?fogbanks=0` (renamed: `?banks=0` is the roads' banks).
- Cost (ABBA, `look=0` vs on): spawn +0.06 ms, fortGate +0.14, omeadow +0.04.

### Round 4 (same day) — the roads' audit (`scripts/harness/audit.mjs <dir>`)

The audit checks every landmark, Wardens piece and prop against the ground under its whole footprint, and every box
track and outland road (170 km) every 8 m for tilt across the wheels, grade jumps and colliders in the way. It then shoots
a chase-camera tour (~400 stops, one every 450 m, plus each flagged spot) onto captioned contact sheets. Loops run so far:

| loop | floating pieces | landmarks off ground | road flags | fixed after it |
|---|---|---|---|---|
| 1 | 3 536 | 1 (Lookout Peak, 9 m up) | 31 | pieces settled; landmarks settled; tower legs to 9 m down |
| 2 | 2 (stairs, 0.3 m — by design) | 0 | 29 (pre-existing: the same with `?look=0`) | the cliff on track 67 painted as road → rock; the mires' pools mirrored the sky as snow; dry walls' stones stretched into boxes |
| 3 | 2 | 0 | 29 | — |

- **Landmarks settled** (Landmarks.ts `settled`): a place more than 0.8 m off the ground as it is now is set down on it.
- **Wardens pieces settled** (`?wsettle=0`): lowered to the lowest ground under their footprint, and walls grown down.
- **Fences**: not scattered in the open any more; broken runs along every road and track (`Clutter.buildFences`, `?fences=0`).
- **Rock**: its shade fill back to 4/5 (two thirds off showed the terrain shadow's scalloped 4 m edge); stone gets the
  sky fill too; faces over ~60° are always rock (the coarse mask's grass stretched down cliffs as stripes); the track's
  earth stays off them.
- **Dry walls**: stones 0.25–0.55 m (they were 1 m slabs), five courses, both variants used, more gaps; creepers without stems.
- The remaining road flags are the box tracks' own 2–3 m grade changes (drivable) and track 67's narrow shelf against
  its cliff. Both come from the baked heights and are left as they are.

### Round 5 (same day) — four more frames measured: the colour, the track, the stones, the walls, the fort

The user's five frames (the fort, the forest track, **The Moth Stones**, the road to **Ruins of Lanterns**, and our own
Copper Mine track) set beside the game at the same places, 17:20, ULTRA and measured: their
saturation 0.37–0.47 / ours 0.56–0.62; their shade a neutral warm brown (`#19150f`) / ours an olive (`#101006`); their
local contrast 6–9 / ours 2.5–4. What changed:

- **The grade** (`othGrade`): saturation 1.2 → 0.84 in the darks … 1.0 in the lights; the shade's tint a brown that keeps
  its blue. Measured after: saturation 0.32–0.47, shade `#1a170d` (theirs 0.37–0.47, `#19150f`).
- **The meadow** (`paint.ts grassPaint`, `OTH_LOOK`): a MIX — green, a dry olive, a duller tan straw — the dryness broken
  by patches at two scales, a wide blend (it was green OR mustard, a hard seam along the Lanterns road). The blades
  take it.
- **The sky** (`skyColor`): the zenith a deep blue-violet while the sun is low, the gradient steeper; the first stars
  out high up in the golden hour (`Sky.ts`).
- **The trees**: a RIM light on every crown's sunward edge in the golden hour (`Trees.ts RIM` — a few instructions, no
  fetch); the larch and the birch a deeper gold; one spruce in five within 30 m of a track or a road turns birch / aspen
  (a hash picks it: no tree moves, none is added).
- **The tracks** (`paint.ts`, `Terrain.ts surfaceAt`): stones bedded in the earth, drifts of gravel, the wheel bands damp
  in stretches (`trackDamp`) — glossy, the wettest holding a shallow pool in any weather. In the ground cache: baked.
- **The standing stones** (`SURF.megalith`, Bridges.ts): weathered rock — a deep grey, rain streaks, lichen, moss on
  the tops, the rock relief on HIGH / ULTRA; their carved marks worn shallow. Every ring: ivy over the stones and down
  from the lintels, rubble at their feet, a COURT.
- **Courts** (`Grass.setFloors`, a negative half depth): a second rectangle a 48 m cell — the grass there short and
  thin, its edge soft. The rings and the forts' yards.
- **The roads' walls**: in two thirds of the country (160 m cells) DRESSED stone (`kerb` / `kerb2`: big laid blocks, tops broken
  down in steps, their fallen blocks at the foot, bricks and rubble where a stretch is gone); the rest dry field stone.
  Longer runs, shorter gaps, both verges more often. The masonry a step deeper (0.45, was 0.56), its mortar grey.
- **The forts**: the curtain wall 2.6 m thick (was 1.6), broken merlons along its top; a stretch whose ground fell
  away with the sculpted cliffs is a gap with its rubble (it was a sheet grown down the cliff); banners on three towers
  and at the gate, ladders inside, the houses' roofs slate and half fallen in (`slate`), the yard a court. The rubble
  the walls' own tone (it lay on the grass like snow).
- **The lamps**: on from the sun ~12° up (`Atmosphere.sunY`), the pool half strength by daylight; the lit tail lamps'
  red on the track behind.
- **The clutter**: twice the tries in the open, a new mossy `boulder`; the far ranges' steep faces a deeper banded rock.
- **The river's sun glint** capped (under a low sun the lobe lay over half the river in white blocks).

Round 5's cost — by COUNT (1920 × 1080, noon, the commit before → now; `window.__oth.stats()`):

| view | ULTRA draws | ULTRA triangles | LOW draws | LOW triangles |
|---|---|---|---|---|
| spawn | 125 → 128 | 648k → 676k | 127 → 130 | 311k → 312k |
| forest | 105 → 106 | 941k → 968k | 92 → 93 | 356k → 361k |
| omeadow | 90 → 96 | 1072k → 1087k | 84 → 88 | 546k → 557k |
| town | 76 → 80 | 1002k → 1024k | 71 → 74 | 352k → 321k |
| a fort from over its corner | 94 → 100 | 812k → 812k | 89 → 98 | 313k → 338k |
| The Moth Stones | 79 → 84 | 894k → 1043k | 73 → 79 | 247k → 290k |
| a walled road | 63 → 69 | 1026k → 1149k | 67 → 70 | 384k → 376k |

The frame time is NOT measured: the interleaved A/B (`abq.mjs "port=5201|"`, the commit before served from a worktree)
gave readings from 2 to 18 ms for one variant on one view — the laptop was busy with other work the whole session. To
be run again on a quiet machine, and on a phone. What the counts say: a dry wall is ~1 000 triangles a piece and the
longer runs added them — hence two thirds of the walls dressed (~170 a piece); the rings' rise is their ivy and rubble.
The shader work added: the trees' rim (a few instructions a fragment), the megalith's four reads on the standing
stones only, the track's stones and damp (in the ground cache — baked), the sky's zenith (none to speak of).

Not done in round 5 (round 6 did the first two): the track does not run THROUGH the Moth Stones (the roads are baked);
the far peaks are still smooth (their shape is the height data); the frames' photographic light — bounce, contact
shadows, every leaf its own — is beyond a flat-shaded frame at 60 fps on the phones.

### Round 6 (same day) — the fog matched, and round 5's "not done" list

- **The ground mist** (`uHazeLow`, `hazeAmountL`, `?gm=` its density, `?gm=0` off): a second, SHALLOW layer of the
  height fog (~11 m) on its own floor — the low ground within 180 m of the camera (`Atmosphere.mistFloorLow`, eased) —
  so a bank lies where you are, the trees' feet in it and their tops clear; whole from the sun ~7° up through the
  dusk, a third by night, a sixth at noon, more in rain. It GLOWS gold toward the sun (`applyAtmos`: the sun's tint in
  it, not the far haze's pink). Two `exp` a fragment, no fetch, no pass.
- **The peaks** (`mapPrep.sculptPeaks`, `?peaks=0`): the world's grid above ~560 m (whole by ~840 m) takes a ridged
  noise at three scales — arêtes, teeth, gullies (+85 / −45 m, more above 840 m); off the roads, the places, the box;
  the bare summits sculpted to within 25 m of their top. The land, shadows and physics are one shape.
- **Trodden ground** (`Wardens.trod`, `Grass.setFloors` — a negative half WIDTH is a PATH; `Terrain.trodAt`, `GC_BAKE`):
  a path from the road to every ring of stones within 85 m, and from a fort's camp out through its gate to the road;
  the courts worn in patches. The blades are thinned by the grid; the EARTH is painted in the ground cache's bake only
  (a few texel fetches a baked texel, nothing a frame) — a tier without the cache gets the worn grass, not the earth.
- **The forts**: wooden gate LEAVES in the arch, swung open (`gate`); a timber HOARDING round three towers' heads
  (`hoard`) with a ladder up from the yard; a FINGERPOST where a path leaves the road (`fingerpost`).
- **Hides** along the roads: a small watchtower every ~900 m, 9–14 m off the edge.
- **The grass** blade by blade: the blades' tones twice as far apart, one in five in shade, darker roots, lighter tips.
- **The rapids' foam**: its edge softer, never solid (under a low sun: hard white blocks). The masonry 0.5 (0.45 sent
  the lakes' slate region near black).

Counts after round 6 (ULTRA / LOW triangles; the commit before round 5 in brackets): spawn 676k (648k) / 312k (311k) ·
forest 968k (941k) / 361k (356k) · omeadow 1090k (1072k) / 551k (546k) · town 1025k (1002k) / 318k (352k) · a fort 816k
(812k) / 339k (313k) · The Moth Stones 1044k (894k) / 288k (247k) · a walled road 1144k (1026k) / 371k (384k). Draws
+3 … +8. The frame time is still to be measured on a quiet machine and a phone.

Left as it is: the car's colour (the frames' dark grey is a PAINT the player picks — `settings.paint`, the garage);
the frames' photographic light. Local contrast measured 2.9–6.6 (theirs 6–9).

### Round 7 (same day) — the user's checks: the stones, the zigzag, the day's light, the cost

- **No loose stones**: the clutter's `stones` and `boulder` are not placed ("all the game has that with the same shape").
- **No strata**: `sculptCliffs` is OFF (`?cliffs=1` brings it back) — its wandering bands were the "m" / zigzag on every
  rocky rise, on both grids; the high faces' painted beds gone too. `sculptPeaks` (ridges, no bands) stays.
- **The day, hour by hour** (three views × ten hours, clipped and black pixels counted): a fort's walls in their own
  shade at noon were near black — the laid stone's sky fill 0.8 (was 0.35); toward a low sun 11 % of a frame sat at
  252+ (the same in the commit before) — the sun's glow 45 % less while it is low, the grade's highlights gold by
  taking green and blue down, never red up: 8 %, the sun's own disc and halo. Night and the hour before dawn are dark
  (7–35 % of the pixels under 6 / 255) but lit by the lamps; left as they are.
- **The trees' far images**: no border found in the two views cropped ×3 against the commit before (the larch's and
  the birch's new gold is in the impostors' bake as in the near trees: one `treeAlbedo`).
- **No water on the road**: round 5's standing pools and wet gloss in the wheel lines are gone (the damp stretches stay
  as darker earth; the mires' mud keeps its pools). **Far ruins simpler** and **the reaches in under the haze**
  (`LOOK_REACH` 0.75, `?lreach=1` the A/B): `docs/PERF.md`.
- **The cost**: `docs/PERF.md`, 2026-11-13 — the look is 0.3–0.8 ms a frame and the PC is at 404–476 fps with it
  (478–623 without); this table below is NOT to be trusted.

## Cost (ULTRA 1920×1080, uncapped, `abq.mjs "look=0||look=0|"`, ABBA, this laptop)

| view | look=0 | look | Δ |
|---|---|---|---|
| spawn | 2.155 ms | 2.148 ms | −0.01 (noise) |
| forest | 1.923 | 1.875 | −0.05 (noise) |
| omeadow | 1.667 | 1.711 | +0.04 |
| pavedRuin | 1.785 | 1.829 | +0.04 |
| fortGate (walls fill the frame — the worst case) | 1.55 | 1.77 | **+0.22** — the masonry's relief; still ~560 fps |

Not measured yet: a real phone (the LOW tier renders correctly headless — no relief, no ivy, the dressing thinned).

## Next

- The forts' grass is waist-high and hides the rubble; the painted fort has shorter grass and a trodden path from the
  gate — a floor-like "short grass" mask for the courts.
- The haze now hides the far land: the tiers' draw distances (trees, rocks, Wardens' reach) can come in on the phones
  with nobody seeing the cut.
- More dressing kinds from the frames: a broken cart, a signpost at the gate, banners on the towers, smoke from the
  burned houses.
