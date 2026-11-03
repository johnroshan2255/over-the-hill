/**
 * THE PALETTE + the ground's paint, shared by the terrain and the grass (a blade takes the colour of the ground it
 * grows from). Colours are linear albedo, CALIBRATED against Over-the-Hill screenshots with scripts/oth/compare.py
 * (region medians, sRGB): golden field ≈ 254 192 105, sage-green grass (#59804A), neutral blue-grey rock ≈ 157 167 173,
 * light warm earth on the trails and banks.
 *
 * `paintNoise(xz)` samples the PAINT texture (noiseTex.ts) at three world scales. `groundPaint` is the ground's
 * colour at a point: soft painterly MOTTLING, scattered SHRUB DOTS and grey SCREE PATCHES with ragged edges (the
 * texture OTH's hillsides read by from afar), wet greens, earth, forest floor, rock, snow, the water's gravel.
 */
/** THE PLANTS' VALUE (2026-11-02, the user: "a bit darker — now 5 out of 10, I want 7"): every plant colour is × this
 *  (linear; 0.7 ≈ 15 % darker on screen, 1 = the colours calibrated against OTH) — the grass (and the ground it grows
 *  from), the shrub dots, the forest floor (here), the trees' leaves and needles (Trees.ts, their impostors too), the
 *  bushes (Bushes.ts). The rock, tracks, water, flowers, bark and the sky keep theirs. */
export const PLANT_VALUE = 0.7
export const PLANT_VALUE_GLSL = /* glsl */ `const float PLANT_VALUE = ${PLANT_VALUE.toFixed(3)};`
/** The GOLDEN grass a step further (2026-11-02, the user: "too bright, like someone shining a torch from the ground —
 *  dark like in Over the Hill"): lit by the noon sun it sat in the tone map's shoulder, squeezed pale and flat; × this
 *  it is OTH's deeper honey-orange (≈ 15 % darker on screen, like the greens). */
const GOLD_VALUE = 0.66

export const PAINT_GLSL = /* glsl */ `
${PLANT_VALUE_GLSL}
const float GOLD_VALUE = ${GOLD_VALUE.toFixed(3)};
const vec3 STRAW      = vec3(0.68, 0.4, 0.115) * PLANT_VALUE * GOLD_VALUE;
const vec3 STRAW_DEEP = vec3(0.58, 0.32, 0.09) * PLANT_VALUE * GOLD_VALUE;
const vec3 STRAW_PALE = vec3(0.76, 0.5, 0.24) * PLANT_VALUE * GOLD_VALUE;
// (the user's grass colour: #59804A ≈ sRGB 89 128 74 on screen, a sunlit field by day — calibrated through the
//  hue-keeping tone map, toneMap.ts; was an emerald ≈ 40 115 54; PLANT_VALUE darkens it from there)
const vec3 GREEN      = vec3(0.0652, 0.1516, 0.052) * PLANT_VALUE;
const vec3 GREEN_DEEP = vec3(0.0286, 0.077, 0.0249) * PLANT_VALUE;
const vec3 SHRUB      = vec3(0.05, 0.12, 0.05) * PLANT_VALUE;
const vec3 FOREST     = vec3(0.04, 0.07, 0.03) * PLANT_VALUE;
const vec3 DIRT       = vec3(0.66, 0.33, 0.15);
const vec3 SCREE      = vec3(0.125, 0.135, 0.158); // (stone grey like the slabs: brighter read as snow in the clear near air)
const vec3 ROCK       = vec3(0.52, 0.38, 0.38);
const vec3 ROCK_DEEP  = vec3(0.34, 0.23, 0.25);
// the valley's OUTCROPS (OTH: light blue-grey slabs ≈ sRGB 157 167 173), a cooler deeper grey in the crevices
// (a touch darker than the measured grey: in the clear near air a sunlit slab would read white against the grass)
// (2026-10-27: a touch lighter and warmer — with the rock's sky fill (rockFill) the shade reads pale blue-grey)
const vec3 SLAB       = vec3(0.13, 0.136, 0.15);
const vec3 SLAB_DEEP  = vec3(0.066, 0.07, 0.084);
const vec3 SNOW       = vec3(0.80, 0.85, 0.93);
const vec3 BED        = vec3(0.6, 0.37, 0.21);
// (the tracks: the user's golden-valley reference — light sandy tan packed earth ≈ sRGB 205 158 121 in the sun)
const vec3 TRAIL      = vec3(0.40, 0.27, 0.17);

// (every paint-noise read goes through PAINT_TEX: a shader that bakes the paint — Grass.ts's field — reads mip 0, as
//  a vertex shader does, where a fragment shader's texture() would pick the mip its own pixel spacing asks for)
#ifndef PAINT_TEX
#define PAINT_TEX(uv) texture(uNoise, uv)
#endif
struct Paint { vec4 fine; vec4 mid; vec4 big; vec4 grain; vec4 micro; };
Paint paintNoise(vec2 xz) {
  Paint p;
  p.micro = PAINT_TEX(xz * (1.0 / 0.85) + vec2(0.61, 0.37));
  p.grain = PAINT_TEX(xz * (1.0 / 3.7) + vec2(0.23, 0.91));
  p.fine = PAINT_TEX(xz * (1.0 / 13.0) + vec2(0.71, 0.13));
  p.mid = PAINT_TEX(xz * (1.0 / 71.0));
  p.big = PAINT_TEX(xz * (1.0 / 389.0) + vec2(0.37, 0.59));
  return p;
}

// Soft irregular DOTS from the paint texture's cell channel (A: distance to the nearest of 16 × 16 random points per
// tile) — one fetch, no loops, the same in the terrain's fragment shader and the grass's vertex shader. cellM = the
// cell size (m), fill ≈ the share of cells that hold a dot (picked by a second, smooth channel — dots come in
// patches), rad / soft in metres.
float dotsAt(vec2 xz, float cellM, float fill, float rad, float soft) {
  vec2 uv = xz / (cellM * 16.0);
  float d = PAINT_TEX(uv).a * cellM;
  float sel = PAINT_TEX(uv * 2.3 + vec2(0.17, 0.53)).g;
  float on = smoothstep(0.62 - fill, 0.66 - fill, sel);
  return on * (1.0 - smoothstep(rad - soft, rad + soft, d));
}

// The grass colour of a field (its sunlit mid-blade albedo): dry 0 sage green … 1 golden straw. No olive in between:
// the field is green OR golden, the edge between them a short painted blend.
vec3 grassPaint(float dry, Paint p) {
  float d = clamp(dry + (p.big.r - 0.5) * 0.35 + (p.mid.g - 0.5) * 0.12, 0.0, 1.0);
  vec3 green = mix(GREEN_DEEP, GREEN, 0.7 + (p.big.b - 0.5) * 0.5);
  vec3 straw = mix(STRAW_DEEP, STRAW, 0.78 + (p.big.b - 0.5) * 0.4);
  straw = mix(straw, STRAW_PALE, clamp((p.big.g - 0.55) * 2.0, 0.0, 1.0) * 0.45);
  return mix(green, straw, smoothstep(0.4, 0.56, d));
}

// THE TRACK'S EDGE, shared by the ground (paints the earth) and the grass (keeps off it, shortening toward it): the
// half width pushed in and out by grass CLUMPS a few metres across (OTH: the field's tufts overhang the track in
// scallops), a finer ragged fringe on top. trackEdge = that RAGGED distance from the centre line (m; the edge is where
// it reaches hw), trackMask = 1 on the track … 0 off it. trail = distance to the centre line (m).
float trackEdge(vec2 xz, float trail) {
  float clumps = PAINT_TEX(xz / 9.0 + vec2(0.41, 0.17)).r - 0.5;
  float fringe = PAINT_TEX(xz / 2.3 + vec2(0.23, 0.91)).b - 0.5;
  return trail + clumps * 1.5 + fringe * 0.45;
}
float trackMask(vec2 xz, float trail, float hw) { return 1.0 - smoothstep(hw - 0.35, hw + 0.15, trackEdge(xz, trail)); }

// THE GROUND'S COLOUR at xz — the terrain draws it, and every grass blade takes the colour of the ground it grows from.
// m = mask (rock, dryness, wet — 1 water/gravel, forest), h = height (m), steep = 1 − N.y of the smooth normal,
// foot = the pixel's footprint (m; 0 in the vertex shaders) — fades the small marks out before they'd shimmer.
// rockNear / screeNear: the same fields read EARLIER — already 1 where the rock / scree starts, rising over the few
// metres before it (the grass shortens toward them)
struct Ground { vec3 col; float rock; float forest; float snow; float bed; float scree; float trail; float rockNear; float screeNear; };
// trail = distance (m) to the nearest dirt track's centre line, hw its half width
// far = 0 within the grass's reach … 1 beyond it: the shrub dots are a far-hillside breakup only (near, a bush is a
// real bush, not a disc painted on the ground)
#ifdef OTH_DESERT
// THE DESERT (Over the Hill's Algeria, their Steam shots measured, 2026-11-02): pale orange SAND (sunlit ≈ sRGB 213 173
// 128), red-orange SANDSTONE in BEDS 9 m thick (≈ 213 140 111 in the sun, 181 116 99 in shade) — each bed its own tone,
// a darker undercut at its foot, sand dusting the flat tops; damp sand by the water, olive ground under the oasis's
// growth, light compacted sand on the tracks. Mask: R rock, G loose sand, B wet / water, A the oasis's growth.
// (2026-11-03, DESERT_MATCH round 2 — real Saharan / Wadi Rum sand, photographed: an orange-red ≈ 25° hue (sRGB 248 157
//  97 open, 243 189 150 compacted); ours read 32° (233 189 140, 244 211 173), a pale yellow-beige: redder and a
//  little darker)
const vec3 SAND        = vec3(0.42, 0.193, 0.082);
const vec3 SAND_DEEP   = vec3(0.37, 0.155, 0.067);
const vec3 SAND_PALE   = vec3(0.47, 0.235, 0.103);
// (2026-11-03, DESERT_MATCH round 3 — the photographed sandstone (Tassili, Iherir, Wadi Rum) is a tan-brown to golden,
//  hue ≈ 26–38°, about half as bright as ours was (a pink-orange 20°, 235 170 137 on screen): darker, browner; the
//  formations (Formations.ts) keep the same three)
const vec3 STONE       = vec3(0.23, 0.133, 0.076);
const vec3 STONE_PALE  = vec3(0.29, 0.18, 0.105);
const vec3 STONE_DEEP  = vec3(0.15, 0.082, 0.048);
const vec3 DAMP        = vec3(0.24, 0.15, 0.085);
const vec3 OASIS_FLOOR = vec3(0.16, 0.15, 0.06);
const vec3 TRACK_SAND  = vec3(0.5, 0.28, 0.16);
// (a bed's tone: 0..1 per bed, the beds wobbling a little in height like the generator's)
float bedTone(float h, Paint p) { float b = floor((h + (p.big.g - 0.5) * 5.0) / 9.0); return fract(sin(b * 12.9898 + 4.1) * 43758.5453); }
Ground groundPaint(vec2 xz, vec4 m, float h, float steep, Paint p, float foot, float trail, float hw, float far) {
  Ground g;
  g.snow = 0.0; g.scree = 0.0; g.screeNear = 0.0;
  float near = 1.0 - smoothstep(0.35, 1.2, foot);
  float grain = mix(1.0, (0.86 + 0.28 * p.micro.g) * (0.95 + 0.1 * p.micro.b), near);
  // sand: the loose (dunes, drifts) paler and yellower, the compact redder; broad soft drifts of tone
  vec3 col = mix(SAND_DEEP, mix(SAND, SAND_PALE, p.mid.r), 0.35 + 0.65 * m.g);
  col *= (0.93 + 0.1 * p.fine.g + (p.big.r - 0.5) * 0.12 + (p.mid.b - 0.5) * 0.06) * grain;
  // damp sand toward the water, the oasis's olive floor under its palms and scrub
  float wet = min(m.b / 0.85, 1.0);
  col = mix(col, DAMP * (0.9 + 0.2 * p.fine.g), smoothstep(0.3, 0.85, wet) * 0.7);
  g.forest = smoothstep(0.25, 0.75, m.a + (p.mid.b - 0.5) * 0.3);
  col = mix(col, OASIS_FLOOR * (0.85 + 0.3 * p.grain.r), g.forest * 0.45);
  // SANDSTONE: the beds' tones, a darker undercut at each bed's foot (steep faces only), sand on the flat tops
  float rv = m.r + (p.mid.b - 0.5) * 0.3 + (p.grain.b - 0.5) * 0.1;
  g.rock = smoothstep(0.42, 0.58, rv);
  g.rockNear = smoothstep(0.27, 0.433, rv);
  float bt = bedTone(h, p);
  vec3 stone = mix(STONE, STONE_PALE, bt * 0.8 + (p.mid.r - 0.5) * 0.3) * (0.92 + 0.12 * p.fine.g);
  float hb = (h + (p.big.g - 0.5) * 5.0) / 9.0, bf = hb - floor(hb);
  stone = mix(stone, STONE_DEEP, (1.0 - smoothstep(0.0, 0.16, bf)) * smoothstep(0.2, 0.45, steep) * 0.55);
  stone = mix(stone, SAND_PALE * 0.96, (1.0 - smoothstep(0.03, 0.12, steep)) * 0.55); // (sand on the tops)
  col = mix(col, stone, g.rock);
  // the water's bed: wet gravel and sand
  g.bed = smoothstep(0.9, 0.97, m.b);
  col = mix(col, DAMP * (0.75 + 0.3 * p.grain.g) * mix(vec3(1.0), vec3(0.92, 0.97, 0.95), p.mid.g), g.bed);
  // the TRACKS: compacted lighter sand, two wheel ruts a touch darker
  g.trail = trail < hw + 1.2 ? trackMask(xz, trail, hw) * (1.0 - g.bed) : 0.0;
  float rut = (1.0 - smoothstep(0.15, 0.45, abs(trail - 0.85))) * near;
  vec3 track = TRACK_SAND * (0.94 + 0.08 * p.fine.g + 0.05 * p.mid.r) * mix(1.0, 0.95 + 0.1 * p.micro.g, near) * (1.0 - 0.07 * rut);
  col = mix(col, track, g.trail);
  g.col = col;
  return g;
}
#else
Ground groundPaint(vec2 xz, vec4 m, float h, float steep, Paint p, float foot, float trail, float hw, float far) {
  Ground g;
  vec3 col = grassPaint(m.g, p);
  float near = 1.0 - smoothstep(0.35, 1.2, foot); // (small marks only while they're bigger than a pixel or two)
  // painterly mottling: soft light / dark patches a few metres across, a faint grain
  col *= 0.9 + 0.2 * p.fine.g + (p.mid.r - 0.5) * 0.12 + (p.grain.r - 0.5) * 0.1 * near;
  // wet hollows and stream sides: deeper green; earth on the water's very edge
  float wet = min(m.b / 0.85, 1.0);
  float grain = mix(1.0, (0.68 + 0.64 * p.micro.g) * (0.9 + 0.2 * p.micro.b), near);
  col = mix(col, mix(GREEN_DEEP, GREEN, p.mid.r), smoothstep(0.35, 0.85, wet) * 0.55);
  // (a ragged, painted edge; the earth itself mottled)
  float earth = smoothstep(0.86, 0.9, m.b + (p.grain.b - 0.5) * 0.06 + (p.fine.r - 0.5) * 0.04);
  // (earth: soft blotches, brushed streaks and a fine sandy grain — the grain only while it's bigger than a pixel)
  col = mix(col, DIRT * (0.8 + 0.18 * p.grain.g + 0.12 * p.fine.g + 0.12 * p.grain.b) * grain, earth * 0.88);
  // blue-grey SCREE patches on the steeper open slopes (the hillsides' grey breakup, seen from afar; no grass on them)
  float sc = p.mid.b + (p.fine.r - 0.5) * 0.35 + (p.grain.b - 0.5) * 0.1 * near + smoothstep(0.08, 0.3, steep) * 0.5 - 0.25;
  g.scree = smoothstep(0.66, 0.7, sc) * (1.0 - smoothstep(0.5, 0.8, wet)) * smoothstep(0.06, 0.14, steep);
  g.screeNear = smoothstep(0.56, 0.665, sc) * (1.0 - smoothstep(0.5, 0.8, wet)) * smoothstep(0.06, 0.14, steep);
  // (where the rock relief shows — HIGH / ULTRA on PCs, rockRelief.ts — the rock, slabs and scree are plain: the relief
  //  is their detail now; the painted breakup below is for where it doesn't, far away and on the other tiers)
  float paintK = 1.0;
#ifdef OTH_ROCK_RELIEF
  paintK = 1.0 - reliefShow(foot);
#endif
  col = mix(col, SCREE * mix(1.0, 0.9 + 0.14 * p.fine.g + 0.08 * p.grain.r, paintK), g.scree);
  // SHRUB DOTS: small dark-green bushes scattered over the open slopes (thicker on the green, sparse on gold)
  // (only on open grass ground: not on the water's earth / gravel, rock or forest floor)
  float open = (1.0 - g.scree) * (1.0 - smoothstep(0.8, 0.86, m.b)) * (1.0 - smoothstep(0.3, 0.5, m.r)) * (1.0 - smoothstep(0.3, 0.6, m.a));
  float fill = mix(0.16, 0.08, smoothstep(0.3, 0.7, m.g)) * open * far;
  // (two fixed layers: single bushes near, clumps of them far — a hillside of dots, never sub-pixel shimmer)
  float fade = smoothstep(2.0, 5.0, foot);
  float dots = 0.0;
  if (fill > 0.001) {
    float rv = 0.7 + 0.6 * p.fine.b; // (irregular sizes)
    if (fade < 1.0) dots = dotsAt(xz, 7.0, fill, 1.4 * rv, max(0.15, foot * 0.45)) * (1.0 - fade);
    if (fade > 0.0) dots = max(dots, dotsAt(xz + 3.1, 19.0, fill * 1.4, 3.2 * rv, max(0.3, foot * 0.45)) * fade);
  }
  col = mix(col, SHRUB * (0.8 + 0.4 * p.grain.r), dots * 0.85 * (1.0 - smoothstep(14.0, 30.0, foot)));
  // forest floor (the pines will stand here)
  g.forest = smoothstep(0.25, 0.75, m.a + (p.mid.b - 0.5) * 0.3);
  col = mix(col, mix(FOREST, GREEN_DEEP, 0.5), g.forest * 0.2); // (the pines will cover it; until then only a hint)
  // rock: neutral blue-grey in broad tones (the facets do the rest)
  float rv = m.r + (p.mid.b - 0.5) * 0.3 + (p.grain.b - 0.5) * 0.1;
  g.rock = smoothstep(0.42, 0.58, rv);
  g.rockNear = smoothstep(0.27, 0.433, rv); // (0.433: where g.rock reaches the grass's cut; ~2–6 m before it)
  vec3 rock = mix(ROCK_DEEP, ROCK, 0.7 + (p.mid.r - 0.5) * 0.4 + (p.fine.g - 0.5) * 0.2 * paintK);
  // the valley's slabs: light blue-grey, soft streaks down the faces, a little lichen; the far ranges stay warm
  vec3 slab = mix(SLAB_DEEP, SLAB, 0.78 + ((p.fine.g - 0.5) * 0.25 + (p.grain.r - 0.5) * 0.12 * near) * paintK - steep * 0.35);
  slab = mix(slab, slab * vec3(0.92, 1.0, 0.86), smoothstep(0.62, 0.8, p.mid.b) * 0.5 * paintK);
  // darker hollows a few metres across, faint cracks between the slabs
  slab *= mix(1.0, (1.0 - 0.1 * smoothstep(0.66, 0.8, p.grain.a) * near) * (0.88 + 0.2 * p.fine.a), paintK);
  rock = mix(slab, rock, smoothstep(700.0, 950.0, h)); // (the box's rock: slab grey; the far ranges warm)
  col = mix(col, rock, g.rock);
  // snow on the high peaks, on the gentler faces
  float sl = 900.0 + (p.big.r - 0.5) * 260.0 + (p.mid.g - 0.5) * 90.0;
  g.snow = smoothstep(sl, sl + 70.0, h) * (1.0 - smoothstep(0.28, 0.42, steep));
  col = mix(col, SNOW, g.snow);
  // water + its gravel edge (mask B = 1): pebbles
  g.bed = smoothstep(0.9, 0.97, m.b);
  float peb = g.bed > 0.01 ? dotsAt(xz, 0.6, 0.5, 0.07, max(0.015, foot * 0.5)) * near : 0.0;
  col = mix(col, BED * (0.8 + 0.18 * p.grain.g + 0.12 * p.fine.g + 0.12 * p.grain.b) * grain * (1.0 + 0.25 * peb) * mix(vec3(1.0), vec3(0.9, 0.96, 0.92), p.mid.g), g.bed);
  // the DIRT TRACKS — ONE look on every track, anywhere (the user: "the same texture for all paths", after their
  // golden-valley reference): smooth packed SANDY earth, light tan, soft broad tonal drifts and a faint fine grain, two
  // worn wheel ruts a touch darker, sparse small pebbles, darker toward the grassy edge. (Over a trekking hill's rock
  // ledges too: the track is earth there as well.)
  // (the ragged edge reaches ≤ 1.13 m out past hw: farther off, no fetch — exact, 2 reads saved on most pixels)
  g.trail = trail < hw + 1.2 ? trackMask(xz, trail, hw) * (1.0 - g.bed) : 0.0;
  float rut = (1.0 - smoothstep(0.15, 0.45, abs(trail - 0.85))) * near; // (a car's wheels ±0.85 m off the middle)
  float speck = mix(1.0, 0.94 + 0.12 * p.micro.g, near);
  float tpeb = near > 0.01 && g.trail > 0.01 ? dotsAt(xz + 0.7, 1.3, 0.22, 0.06, max(0.02, foot * 0.5)) * near : 0.0;
  vec3 track = TRAIL * (0.93 + 0.1 * p.fine.g + 0.06 * p.mid.r) * speck * (1.0 - 0.08 * rut) * (1.0 + 0.12 * tpeb);
  // the earth darkens a touch toward its edge, where the grass overhangs it
  track *= 0.9 + 0.1 * smoothstep(hw, hw * 0.5, trail);
  col = mix(col, track, g.trail);
  g.col = col;
  return g;
}

#endif

// WILDFLOWERS (mud.bin G): a drift's colour — one kind per patch (a slow noise picks it), a few of the next kind mixed
// in (pick: a per-plant random). White daisies, buttercups, lilac lupines, pink campion, poppies, cornflowers; linear
// albedo near the straw's brightness (they read as colour, not as glare).
vec3 flowerColor(vec2 xz, float pick) {
  float k = fract(PAINT_TEX(xz * (1.0 / 47.0) + vec2(0.29, 0.83)).b * 0.85 + pick * 0.3);
  // (soft, not candy: daisy white and buttercup the commonest, then lilac, campion pink, a few poppies, cornflowers)
  return k < 0.27 ? vec3(0.8, 0.79, 0.72) : k < 0.52 ? vec3(0.85, 0.64, 0.12) : k < 0.71 ? vec3(0.47, 0.32, 0.72)
       : k < 0.83 ? vec3(0.84, 0.43, 0.55) : k < 0.91 ? vec3(0.74, 0.16, 0.08) : vec3(0.3, 0.42, 0.8);
}

// A per-FACET random (0..1): the same over one flat triangle (its normal), different on the next — low-poly tone.
float facetRand(vec3 n) { return fract(sin(dot(floor(n * 400.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`
