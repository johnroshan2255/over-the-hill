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
