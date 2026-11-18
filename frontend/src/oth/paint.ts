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
import { LOOK } from './Atmosphere'

export const PLANT_VALUE = 0.7
export const PLANT_VALUE_GLSL = /* glsl */ `const float PLANT_VALUE = ${PLANT_VALUE.toFixed(3)};`
/** The GOLDEN grass a step further (2026-11-02, the user: "too bright, like someone shining a torch from the ground —
 *  dark like in Over the Hill"): lit by the noon sun it sat in the tone map's shoulder, squeezed pale and flat; × this
 *  it is OTH's deeper honey-orange (≈ 15 % darker on screen, like the greens). */
const GOLD_VALUE = 0.66

/** `?fieldpaint=0`: the meadows without their painted clumps (the A/B — groundPaint). */
const NO_FIELDPAINT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fieldpaint') === '0'

export const PAINT_GLSL = /* glsl */ `
${NO_FIELDPAINT ? '#define NO_FIELDPAINT' : ''}
${LOOK ? "#define OTH_LOOK" : ""}
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
// (the look's earth — 2026-11-13: the painted frames' tracks, a mid brown ≈ sRGB 120 92 66 in the sun)
const vec3 TRAIL_LOOK = vec3(0.21, 0.135, 0.075);

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
#ifdef OTH_LOOK
  // THE LOOK'S FIELD (2026-11-13, round 5 — the user's Moth Stones / Lanterns frames: the meadow a MIX — olive and
  // green low growth, dry straw over it in drifts — never one mustard carpet): the dryness broken by patches tens of
  // metres and a few metres across, a wide blend through a dry OLIVE, the straw a duller tan-gold (less orange) and a
  // step darker. The blades take it (Grass.ts), so the carpet and the paint beyond it agree.
  float dl = clamp(d * 0.72 + 0.1 + (p.mid.r - 0.5) * 0.7 + (p.fine.b - 0.5) * 0.4, 0.0, 1.0);
  vec3 olive = mix(vec3(0.1, 0.155, 0.04), vec3(0.19, 0.2, 0.055), p.fine.g) * PLANT_VALUE;
  vec3 strawL = mix(vec3(0.5, 0.33, 0.12), vec3(0.6, 0.43, 0.19), 0.5 + (p.big.b - 0.5) * 0.6 + (p.fine.r - 0.5) * 0.5) * PLANT_VALUE * GOLD_VALUE * 0.86;
  vec3 c = mix(green, olive, smoothstep(0.2, 0.46, dl));
  return mix(c, strawL, smoothstep(0.44, 0.74, dl));
#else
  return mix(green, straw, smoothstep(0.4, 0.56, d));
#endif
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

// THE LOOK'S DAMP (round 5): where a track's wheel lines hold the wet — stretches a few metres long inside the broad
// wheel bands (±1 m of the middle, soft), by the paint's noise. The paint darkens the earth by it; the terrain makes it
// glossy and lets its deepest hold a pool (Terrain.ts surfaceAt).
float trackDamp(float trail, Paint p) {
  float wheels = 1.0 - smoothstep(0.35, 1.1, abs(abs(trail) - 1.0));
  return wheels * smoothstep(0.5, 0.64, p.fine.r * 0.55 + p.mid.g * 0.5);
}

// THE GROUND'S COLOUR at xz — the terrain draws it, and every grass blade takes the colour of the ground it grows from.
// m = mask (rock, dryness, wet — 1 water/gravel, forest), h = height (m), steep = 1 − N.y of the smooth normal,
// foot = the pixel's footprint (m; 0 in the vertex shaders) — fades the small marks out before they'd shimmer.
// rockNear / screeNear: the same fields read EARLIER — already 1 where the rock / scree starts, rising over the few
// metres before it (the grass shortens toward them)
// dots = the SHRUB DOTS' amount, not painted in (the terrain mixes SHRUB over the finished colour by it — its distance
// fade applied there, live, whether the ground came from the cache or not; GroundCache.ts); already × what covers them
struct Ground { vec3 col; float rock; float forest; float snow; float bed; float scree; float trail; float rockNear; float screeNear; float loose; float ripK; float lawn; float dots; };
// trail = distance (m) to the nearest dirt track's centre line, hw its half width
// far = 0 within the grass's reach … 1 beyond it: the shrub dots are a far-hillside breakup only (near, a bush is a
// real bush, not a disc painted on the ground)
Ground groundPaint(vec2 xz, vec4 m, float h, float steep, Paint p, float foot, float trail, float hw, float far) {
  Ground g;
  g.loose = 0.0; g.ripK = 0.5; g.lawn = 1.0;
  g.scree = 0.0; g.screeNear = 0.0; g.dots = 0.0;
  float near = 1.0 - smoothstep(0.35, 1.2, foot); // (small marks only while they're bigger than a pixel or two)
  float grain = mix(1.0, (0.68 + 0.64 * p.micro.g) * (0.9 + 0.2 * p.micro.b), near);
  // (where the rock relief shows — HIGH / ULTRA on PCs, rockRelief.ts — the rock, slabs and scree are plain: the relief
  //  is their detail now; the painted breakup is for where it doesn't, far away and on the other tiers)
  float paintK = 1.0;
#ifdef OTH_ROCK_RELIEF
  paintK = 1.0 - reliefShow(foot);
#endif
  // rock: neutral blue-grey in broad tones (the facets do the rest) — decided FIRST: where it covers the ground whole
  // (a wall, a cliff, a slab: g.rock exactly 1) the field under it — grass, earth, scree, shrub dots — isn't painted at
  // all (2026-11-06, docs/PERF.md: exact, the rock is mixed over it at 1)
  float rv = m.r + (p.mid.b - 0.5) * 0.3 + (p.grain.b - 0.5) * 0.1;
  // (2026-11-13, the roads' audit: a face over ~60° is rock whatever the 4 m mask says — the mask's grassy cells under a
  //  cliff stretched down its face as gold stripes)
  rv = max(rv, smoothstep(0.5, 0.7, steep));
  g.rock = smoothstep(0.42, 0.58, rv);
  g.rockNear = smoothstep(0.27, 0.433, rv); // (0.433: where g.rock reaches the grass's cut; ~2–6 m before it)
  // forest floor (the pines will stand here)
  g.forest = smoothstep(0.25, 0.75, m.a + (p.mid.b - 0.5) * 0.3);
  vec3 col = vec3(0.0);
  if (g.rock < 1.0) {
    col = grassPaint(m.g, p);
    // painterly mottling: soft light / dark patches a few metres across, a faint grain
    col *= 0.9 + 0.2 * p.fine.g + (p.mid.r - 0.5) * 0.12 + (p.grain.r - 0.5) * 0.1 * near;
    // wet hollows and stream sides: deeper green; earth on the water's very edge
    float wet = min(m.b / 0.85, 1.0);
    col = mix(col, mix(GREEN_DEEP, GREEN, p.mid.r), smoothstep(0.35, 0.85, wet) * 0.55);
    // (a ragged, painted edge; the earth itself mottled)
    float earth = smoothstep(0.86, 0.9, m.b + (p.grain.b - 0.5) * 0.06 + (p.fine.r - 0.5) * 0.04);
    // (earth: soft blotches, brushed streaks and a fine sandy grain — the grain only while it's bigger than a pixel)
    col = mix(col, DIRT * (0.8 + 0.18 * p.grain.g + 0.12 * p.fine.g + 0.12 * p.grain.b) * grain, earth * 0.88);
    // blue-grey SCREE patches on the steeper open slopes (the hillsides' grey breakup, seen from afar; no grass on them)
    float sc = p.mid.b + (p.fine.r - 0.5) * 0.35 + (p.grain.b - 0.5) * 0.1 * near + smoothstep(0.08, 0.3, steep) * 0.5 - 0.25;
    g.scree = smoothstep(0.66, 0.7, sc) * (1.0 - smoothstep(0.5, 0.8, wet)) * smoothstep(0.06, 0.14, steep);
    g.screeNear = smoothstep(0.56, 0.665, sc) * (1.0 - smoothstep(0.5, 0.8, wet)) * smoothstep(0.06, 0.14, steep);
    col = mix(col, SCREE * mix(1.0, 0.9 + 0.14 * p.fine.g + 0.08 * p.grain.r, paintK), g.scree);
    // THE FIELD'S CLUMPS (2026-11-06, the user: "why does our world feel empty, especially the valley"): past the blades
    // (ULTRA's 72 m, LOW's 38) a meadow was one flat colour. PATCHES a few metres across a step darker or lighter, and
    // TUSSOCKS — dark clumps of taller grass ~1.5 m round, one in about a third of 4 m cells. Every blade takes its root's
    // colour (Grass.ts), so the carpet near and the paint beyond it show the same clumps: no seam at the grass's edge. A
    // tussock melts into its average as it shrinks toward a pixel (no shimmer); the mean brightness stays as it was.
    // ?fieldpaint=0: without (the A/B)
#ifndef NO_FIELDPAINT
    float lawnK = (1.0 - earth) * (1.0 - g.scree);
    if (lawnK > 0.01) {
      float patchV = smoothstep(0.25, 0.75, p.fine.b + (p.mid.g - 0.5) * 0.4);
      // (the TUSSOCKS — dark clumps ~1.5 m round — gone, 2026-11-07, the user: "these dark circles in the whole terrain, I
      //  don't want that"; the patches kept, their mean as it was with them: 0.88 + 0.24 · ½ = 1)
      col *= mix(1.0, 0.88 + 0.24 * patchV, lawnK);
    }
#endif
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
    g.dots = dots * 0.85 * (1.0 - smoothstep(14.0, 30.0, foot)); // (mixed in by the terrain: SHRUB over the finished colour)
    col = mix(col, mix(FOREST, GREEN_DEEP, 0.5), g.forest * 0.2); // (the pines will cover it; until then only a hint)
  }
  vec3 rock = mix(ROCK_DEEP, ROCK, 0.7 + (p.mid.r - 0.5) * 0.4 + (p.fine.g - 0.5) * 0.2 * paintK);
  // the valley's slabs: light blue-grey, soft streaks down the faces, a little lichen; the far ranges stay warm
  vec3 slab = mix(SLAB_DEEP, SLAB, 0.78 + ((p.fine.g - 0.5) * 0.25 + (p.grain.r - 0.5) * 0.12 * near) * paintK - steep * 0.35);
  slab = mix(slab, slab * vec3(0.92, 1.0, 0.86), smoothstep(0.62, 0.8, p.mid.b) * 0.5 * paintK);
  // darker hollows a few metres across, faint cracks between the slabs
  slab *= mix(1.0, (1.0 - 0.1 * smoothstep(0.66, 0.8, p.grain.a) * near) * (0.88 + 0.2 * p.fine.a), paintK);
  rock = mix(slab, rock, smoothstep(700.0, 950.0, h)); // (the box's rock: slab grey; the far ranges warm)
#ifdef OTH_LOOK
  // (round 5 — the user's frames: the far peaks are ROCK: the high ranges' steep faces a deeper stone. No beds painted
  //  across them — 2026-11-13, the user: no "m" or zigzag patterns on the rock. The valley's grey slabs are as they are.)
  rock *= mix(1.0, 0.74, smoothstep(700.0, 950.0, h) * smoothstep(0.18, 0.5, steep));
#endif
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
  // (2026-11-13, the roads' audit: a track along a cliff's foot painted its earth up the wall — the earth is by distance in
  //  plan; a face steeper than ~55° is the cliff's, not the road's)
  g.trail *= 1.0 - smoothstep(0.42, 0.62, steep);
  float rut = (1.0 - smoothstep(0.15, 0.45, abs(trail - 0.85))) * near; // (a car's wheels ±0.85 m off the middle)
  float speck = mix(1.0, 0.94 + 0.12 * p.micro.g, near);
  // (the track's pale dots — the pebbles, the stones, the gravel below — about an eighth of what they were: 2026-11-13,
  //  the user: "reduce the white dots … now lets say its 100, reduce it to 10-15". Each dotsAt's fill is the share of
  //  its cells that hold a dot, measured on the noise: 0.22 → −0.04 here 72 % → 9 %; the stones' 0.3 → −0.03 87 % →
  //  10 %, 0.1 → −0.07 40 % → 5 %; the gravel's speckle 8.4 % → 1.2 % of the ground)
  float tpeb = near > 0.01 && g.trail > 0.01 ? dotsAt(xz + 0.7, 1.3, -0.04, 0.06, max(0.02, foot * 0.5)) * near : 0.0;
  vec3 track = TRAIL * (0.93 + 0.1 * p.fine.g + 0.06 * p.mid.r) * speck * (1.0 - 0.08 * rut) * (1.0 + 0.12 * tpeb);
  // the earth darkens a touch toward its edge, where the grass overhangs it
  track *= 0.9 + 0.1 * smoothstep(hw, hw * 0.5, trail);
#ifdef OTH_LOOK
  // THE LOOK'S EARTH (2026-11-13, the user's painted frames: "change the road colour to match"): a DARKER, browner
  // earth — the wheel ruts worn deep and darker still (damp), the wheels' bands darker (broad: see below)
  // along it, broad patches of darker earth a few metres across, the pebbles paler on it
  {
    float patchK = smoothstep(0.35, 0.75, p.mid.g + (p.fine.b - 0.5) * 0.4);
    vec3 e = TRAIL_LOOK * (0.9 + 0.14 * p.fine.g + 0.08 * p.mid.r) * speck * mix(1.0, 0.9, patchK);
    // (the WHEEL BANDS broad and soft: a box track knows its centre line only through a texture whose interpolation
    //  wobbles ~1 m — any band narrower than that broke into blocks at the texel pitch, a ladder of dashes down the track)
    float wheels = (1.0 - smoothstep(0.35, 1.1, abs(trail - 1.0))) * near;
    e *= 1.0 - 0.14 * wheels * (0.8 + 0.2 * p.fine.r);
    e *= 1.0 + 0.35 * tpeb;
    e *= 0.85 + 0.15 * smoothstep(hw, hw * 0.45, trail);
    // (round 5 — the user's Lanterns frame: a back-country track is STONY and WET — stones bedded in the earth, drifts
    //  of gravel, the wheels' lines damp and dark in stretches. None of it keyed to a narrow distance from the centre
    //  line (the ladder above): stones and gravel by the paint's noise alone, the damp inside the broad wheel bands)
    if (near > 0.01 && g.trail > 0.01) {
      float stone = dotsAt(xz + 2.3, 0.7, -0.03, 0.075, max(0.015, foot * 0.4)) + 0.6 * dotsAt(xz - 1.7, 1.9, -0.07, 0.15, max(0.02, foot * 0.4));
      float gravel = smoothstep(0.62, 0.82, p.fine.a * 0.35 + p.mid.b * 0.75) * smoothstep(0.64, 0.74, p.micro.r);
      // (a stone: the earth's own tone gone grey and a step lighter, its sun side — never a pale disc)
      e = mix(e, (e * 1.25 + vec3(0.05, 0.047, 0.043)) * (0.75 + 0.5 * p.micro.b), min(1.0, stone * 0.8 + gravel * 0.4) * near);
    }
    e *= 1.0 - 0.4 * trackDamp(trail, p) * near;
    track = e;
  }
#endif
  col = mix(col, track, g.trail);
  g.col = col;
  // (the dots under what was painted over them since)
  g.dots *= (1.0 - 0.2 * g.forest) * (1.0 - g.rock) * (1.0 - g.snow) * (1.0 - g.bed) * (1.0 - g.trail);
  return g;
}


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
