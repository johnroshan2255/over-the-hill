import * as GFX from './gfx'

/**
 * SUN, SKY AND AIR — one set of uniforms shared by every material of the world (same objects, so one write per frame
 * reaches all of them) and one GLSL chunk (`ATMOS_GLSL`) with the sky colour, the aerial perspective and the surface
 * light, so the ground, the grass, the sky and the haze between them always agree.
 *
 * The look: warm cinematic light — a golden sun low over the ridges, a pale cream-blue sky, peach haze toward the sun
 * and a cooler lavender one away from it, distant ranges dissolving into it layer by layer.
 */
const C = (r: number, g: number, b: number) => new GFX.Color(r, g, b)

/** Keyframes by sun height (sin of the elevation): colours are linear, intensities scene-referred. Below the horizon
 *  the sky goes through dusk (−0.08 … −0.18) to NIGHT (deep blue, the moon lights the land). */
const KEYS = [
  { s: -0.38, sun: C(0.9, 0.38, 0.24), sunI: 0.0, zen: C(0.006, 0.011, 0.03), hor: C(0.02, 0.032, 0.07), glow: C(0.02, 0.025, 0.05), amb: 0.16 },
  { s: -0.18, sun: C(0.9, 0.38, 0.24), sunI: 0.0, zen: C(0.07, 0.06, 0.15), hor: C(0.34, 0.16, 0.24), glow: C(0.4, 0.12, 0.12), amb: 0.45 },
  { s: -0.08, sun: C(0.9, 0.38, 0.24), sunI: 0.0, zen: C(0.3, 0.24, 0.42), hor: C(1.05, 0.46, 0.5), glow: C(1.1, 0.35, 0.3), amb: 1.05 },
  // (golden hour → sunset, after the user's OTH sunset: a pink-violet sky, a red-orange sun, thick pink haze, the land
  //  still lit warm — never black)
  { s: 0.05, sun: C(1.0, 0.46, 0.28), sunI: 2.2, zen: C(0.42, 0.36, 0.58), hor: C(1.3, 0.62, 0.58), glow: C(1.6, 0.55, 0.35), amb: 1.35 },
  { s: 0.22, sun: C(1.0, 0.66, 0.42), sunI: 2.6, zen: C(0.38, 0.5, 0.78), hor: C(1.12, 0.8, 0.74), glow: C(1.2, 0.66, 0.42), amb: 0.92 },
  { s: 0.5, sun: C(1.0, 0.86, 0.7), sunI: 2.25, zen: C(0.4, 0.62, 0.88), hor: C(0.98, 0.88, 0.88), glow: C(0.95, 0.78, 0.6), amb: 0.8 },
  { s: 1.0, sun: C(1.0, 0.95, 0.88), sunI: 2.3, zen: C(0.32, 0.52, 0.86), hor: C(0.82, 0.88, 0.95), glow: C(0.8, 0.78, 0.7), amb: 0.82 },
]
const MOON = C(0.55, 0.68, 1.0)
/** A colour scaled up (its tint kept) to at least luminance min. */
function floorLum(c: GFX.Color, min: number): void {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  if (l < min) c.multiplyScalar(min / Math.max(l, 1e-4))
}
/** A colour pulled toward its own grey (its luminance kept): k of its tint left. */
function keepTint(c: GFX.Color, k: number): GFX.Color {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return c.setRGB(l + (c.r - l) * k, l + (c.g - l) * k, l + (c.b - l) * k)
}

/**
 * DAY AND NIGHT (the user: "sun, bloom and day-night like OTH"): the clock runs — a day takes `dayMinutes` real
 * minutes, the night passes 3× faster — the sun rises in the east, crosses the south 62° high, sets in the west (a
 * golden hour, a pink dusk), then night: the light switches to the MOON (opposite the sun, pale blue, dim), stars
 * come out (Sky.ts), the cars' headlights come on (`uHead*` / `uTail`, painted on every material by `headlight()`).
 */
export class Atmosphere {
  readonly uniforms = {
    uCamPos: { value: new GFX.Vector3() },
    /** The light's direction: the sun by day, the moon by night. */
    uSunDir: { value: new GFX.Vector3(0, 1, 0) },
    uSunColor: { value: new GFX.Color() },
    uSkyZenith: { value: new GFX.Color() },
    uSkyHorizon: { value: new GFX.Color() },
    uSunGlow: { value: new GFX.Color() },
    /** The sun's own colour (vivid: its disc in the sky, its glint on the water) — uSunColor is its LIGHT on the land. */
    uSunDisc: { value: new GFX.Color() },
    uAmbSky: { value: new GFX.Color() },
    uAmbGround: { value: new GFX.Color() },
    /** The HAZE: clear air to x m, then AERIAL PERSPECTIVE over a length of y m (the tier's fogNear / haze, shorter
     *  in the rain — main.ts, update) — and its colour (the sky's horizon leaning to its zenith: a blue-grey). */
    uFogRange: { value: new GFX.Vector2(130, 2600) },
    uFogColor: { value: new GFX.Color() },
    uTime: { value: 0 },
    /** THE CAVES' DARK (2026-11-06, Sites.ts — the drive-through tunnel, the grotto): per cave a segment (x0, z0, x1, z1)
     *  and (radius, the roof's height, closed at its far end 0 / 1, 0); radius 0 = none. caveK() in ATMOS_GLSL. */
    //  (three single vec4 pairs, not arrays: the renderer's layer sets no uniform arrays)
    uCaveA0: { value: new GFX.Vector4() }, uCaveB0: { value: new GFX.Vector4() },
    uCaveA1: { value: new GFX.Vector4() }, uCaveB1: { value: new GFX.Vector4() },
    uCaveA2: { value: new GFX.Vector4() }, uCaveB2: { value: new GFX.Vector4() },
    uNoise: { value: null as GFX.Texture | null },
    /** 0 day … 1 full night (stars, the moon's disc, headlights). */
    uNight: { value: 0 },
    /** The rock's extra sky fill (rockFill), × this: 1 in the valley; the desert's less — most at dusk and night. */
    uRockFill: { value: 1 },
    /** How much of the wrapped light's wrap is cut (shade): 0 as painted; the valley by day a share (VALLEY_LIGHT). */
    uWrapCut: { value: 0 },
    /** Headlights (Vehicle.lights): the left lamp (xyz) and on (w), the right lamp, the car's forward and up axes;
     *  the tail lamps' middle (xyz) and the brake light (w, 0 … 1). */
    uHeadL: { value: new GFX.Vector4() },
    uHeadR: { value: new GFX.Vector3() },
    uHeadDir: { value: new GFX.Vector3(0, 0, -1) },
    uHeadUp: { value: new GFX.Vector3(0, 1, 0) },
    uTail: { value: new GFX.Vector4() },
    /** A CAMPFIRE near the camera (Props.ts): its centre (xyz) and how bright it is now (w, flickering; 0 = none). */
    /** LAMPS ON 0 … 1: lanterns, lit windows, embers, fireflies — off by day, on from dusk (the sun under ~8°) to dawn. */
    uLamps: { value: 0 },
    uFire: { value: new GFX.Vector4() },
    /** WEATHER (`weather`, below): cloud cover 0 … 1, rain 0 … 1, how wet the land is 0 … 1, the wind (m/s, xz). */
    uCloud: { value: 0.25 },
    uRain: { value: 0 },
    uWet: { value: 0 },
    uWind: { value: new GFX.Vector2(2.2, 0.9) },
    /** 1 without the post pass (Glow.ts): the sky paints the bloom's halo round the sun, the haze glows toward it. */
    uGlow: { value: 0 },
    /** THE CROSSING's MIST (Crossing.ts): 0 clear … 1 inside the cloud (~10 m to see) — a fog round the camera on top
     *  of the haze, the sky gone to it; its colour the horizon's brightness as a grey-white (dark at night). */
    uMist: { value: 0 },
    uMistColor: { value: new GFX.Color() },
    /** The desert's SANDSTORM (`weather`): 0 … 1, and the dust's colour (the sand lit by what light gets through). */
    uDust: { value: 0 },
    uDustColor: { value: new GFX.Color() },
  }
  /** WEATHER (2026-10-27, OTH has it): spells of CLEAR, CLOUDY and RAIN a few real minutes each, easing into one another
   *  (the clouds over a minute, the rain over ~25 s once the sky is heavy); the land gets wet in the rain over ~40 s and
   *  dries over ~3 min. In the DESERT the third is a SANDSTORM (2026-11-02, the user: "we will have a sand storm at
   *  some time, use a filter for that"): the dust blows up over ~20 s and settles over ~30. `?weather=clear|cloudy|
   *  rain|sandstorm` pins it, K / Shift+G step through them. */
  weather: 'auto' | 'clear' | 'cloudy' | 'rain' | 'sandstorm' = 'auto'
  private spell: 'clear' | 'cloudy' | 'rain' = 'clear'
  private spellLeft = 240
  private wseed = (Date.now() & 0xffff) | 1
  /** The haze's length (m) in clear air (main.ts sets it from the tier). */
  hazeLen = 2600
  /** Hours (6 sunrise … 12 noon … 18 sunset … 24 / 0 midnight). */
  hour = 15.5
  /** Real minutes for one daytime (06–18); the night runs 3× faster. 0 = the clock stands still. */
  dayMinutes = 24

  constructor(noise: GFX.Texture) {
    this.uniforms.uNoise.value = noise
  }

  /** Advance the clock and the weather by dt real seconds. */
  tick(dt: number): void {
    this.tickWeather(dt)
    if (this.dayMinutes <= 0) return
    const night = this.hour < 6 || this.hour > 18.6
    this.hour = (this.hour + (dt * 12 * (night ? 3 : 1)) / (this.dayMinutes * 60)) % 24
  }

  private tickWeather(dt: number): void {
    const u = this.uniforms
    let kind = this.weather === 'auto' ? this.spell : this.weather
    if (this.weather === 'auto' && (this.spellLeft -= dt) <= 0) {
      this.wseed = (Math.imul(this.wseed, 1103515245) + 12345) >>> 0
      const r = (this.wseed >>> 8) / 16777216
      this.spell = kind = r < 0.45 ? 'clear' : r < 0.75 ? 'cloudy' : 'rain'
      this.spellLeft = 180 + ((this.wseed >>> 4) % 240)
    }
    // (each world's own wet spell: rain in the valley, a sandstorm in the desert — never rain on the sand)
    if (this.desert && kind === 'rain') kind = 'sandstorm'
    if (!this.desert && kind === 'sandstorm') kind = 'rain'
    // (the desert's clear sky nearly cloudless — 2026-11-04, the stylised warm look)
    const cloudT = kind === 'rain' ? 0.95 : kind === 'cloudy' ? 0.62 : kind === 'sandstorm' ? 0.3 : this.desert ? 0.04 : 0.22
    const rainT = kind === 'rain' && u.uCloud.value > 0.75 ? 1 : 0
    const ease = (v: number, t: number, rate: number) => (v < t ? Math.min(t, v + dt * rate) : Math.max(t, v - dt * rate))
    u.uCloud.value = ease(u.uCloud.value, cloudT, 1 / 60)
    u.uRain.value = ease(u.uRain.value, rainT, 1 / 25)
    u.uDust.value = ease(u.uDust.value, kind === 'sandstorm' ? 1 : 0, kind === 'sandstorm' ? 1 / 20 : 1 / 30)
    u.uWet.value = ease(u.uWet.value, u.uRain.value > 0.3 ? 1 : 0, u.uRain.value > 0.3 ? 1 / 40 : 1 / 180)
  }

  /** Wait out the weather (a rest at a camp): a clear spell from now, settled at once. */
  clearSky(): void {
    this.spell = 'clear'
    this.spellLeft = 240
    if (this.weather !== 'auto') this.weather = 'clear'
    this.settleWeather()
  }

  /** Snap the weather to its target (the shot harness, a forced change). */
  settleWeather(): void {
    for (let i = 0; i < 400; i++) this.tickWeather(1)
  }

  /** K: clear → cloudy → rain (the desert: a sandstorm) → auto. */
  stepWeather(): string {
    const order = ['auto', 'clear', 'cloudy', this.desert ? 'sandstorm' : 'rain'] as const
    const i = order.indexOf(this.weather as (typeof order)[number])
    this.weather = order[(i + 1) % order.length]
    return this.weather
  }

  /** "HH:MM". */
  get clock(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  /** The world's air (World / main.ts: set on entering one): the DESERT's grade — Over the Hill's Algeria measured
   *  (2026-11-02): a pale cyan-white sky by day (their ≈ sRGB 229 244 251), a warm cream horizon, sand-coloured haze,
   *  clearer air; hot pink sunsets, a purple night; the sand's warm bounce light. */
  desert = false
  /** How far the air has gone to the desert's grade (0 … 1): it follows `desert` over a few seconds, so a crossing's
   *  swap (in the mist) never snaps the sky's colours. */
  private dk = -1
  private lastT = 0

  update(cam: GFX.Vector3, t: number): void {
    const u = this.uniforms
    u.uCamPos.value.copy(cam)
    u.uTime.value = t
    const dt = Math.min(Math.max(t - this.lastT, 0), 0.1)
    this.lastT = t
    this.dk = this.dk < 0 ? (this.desert ? 1 : 0) : this.dk + GFX.MathUtils.clamp((this.desert ? 1 : 0) - this.dk, -dt / 4, dt / 4)
    const dk = this.dk
    // the sun's path: east at 6, south (+z) at noon, west at 18, under the ground at night; 62° at its highest
    const az = ((this.hour - 6) / 12) * Math.PI
    const el = Math.sin(az) * GFX.MathUtils.degToRad(62)
    const sun = new GFX.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
    const s = sun.y
    let i = 0
    while (i < KEYS.length - 2 && s > KEYS[i + 1].s) i++
    const a = KEYS[i], b = KEYS[i + 1]
    const f = GFX.MathUtils.clamp((s - a.s) / (b.s - a.s), 0, 1)
    // (under a heavy sky the sun dims and the sky goes a soft grey, its brightness kept)
    const overcast = GFX.MathUtils.smoothstep(u.uCloud.value, 0.45, 1.0)
    // (in a sandstorm the sun is a pale disc through the dust)
    const dust = u.uDust.value
    const sunI = (a.sunI + (b.sunI - a.sunI) * f) * (1 - 0.72 * overcast) * (1 - 0.68 * dust)
    u.uSkyZenith.value.copy(a.zen).lerp(b.zen, f)
    u.uSkyHorizon.value.copy(a.hor).lerp(b.hor, f)
    u.uSunGlow.value.copy(a.glow).lerp(b.glow, f).multiplyScalar(1 - 0.8 * overcast)
    if (dk > 0) {
      const day = GFX.MathUtils.smoothstep(s, 0.12, 0.35) * dk, low = GFX.MathUtils.smoothstep(s, -0.04, 0.06) * (1 - day) * dk
      const zl = 0.2126 * u.uSkyZenith.value.r + 0.7152 * u.uSkyZenith.value.g + 0.0722 * u.uSkyZenith.value.b
      const hl = 0.2126 * u.uSkyHorizon.value.r + 0.7152 * u.uSkyHorizon.value.g + 0.0722 * u.uSkyHorizon.value.b
      // (2026-11-03, DESERT_MATCH round 1 — measured on real Saharan skies (Tassili n'Ajjer, Wadi Rum): a deep blue
      //  overhead paling to a light blue at the horizon, ≈ sRGB 125 181 254 some 25° up; ours was a pale cyan-white,
      //  214 224 233 — the zenith to the deep blue, the horizon to a pale blue, both at the keyframe's brightness)
      // (2026-11-04 — the desert's own STYLISED, WARM look, replacing round 1's deep photographic blue: a pale cyan
      //  overhead going to a warm near-white at the horizon by day; a hot pink sky at sunset, top to bottom; a purple
      //  night)
      u.uSkyZenith.value.lerp(D_BLUE.clone().multiplyScalar(zl * 1.05), 0.85 * day).lerp(D_PINK.clone().multiplyScalar(Math.max(zl, 0.01) * 1.4), 0.7 * low)
      u.uSkyHorizon.value.lerp(D_PALEBLUE.clone().multiplyScalar(hl * 0.95), 0.85 * day).lerp(D_PINK.clone().multiplyScalar(hl * 1.25), 0.85 * low)
      const nightK = dk * (1 - GFX.MathUtils.smoothstep(s, -0.25, 0.0))
      u.uSkyZenith.value.lerp(D_PURPLE.clone().multiplyScalar(Math.max(zl, 0.004) * 3.2), 0.9 * nightK)
      u.uSkyHorizon.value.lerp(D_PURPLE.clone().multiplyScalar(Math.max(hl, 0.006) * 2.6).lerp(D_PINK.clone().multiplyScalar(Math.max(hl, 0.006) * 2.0), 0.35), 0.8 * nightK)
    }
    for (const c of [u.uSkyZenith.value, u.uSkyHorizon.value]) {
      const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
      c.lerp(new GFX.Color(l * 0.95, l, l * 1.04), 0.75 * overcast)
    }
    // THE DUST: the sand's own warm orange, as bright as the horizon is (darker overhead, dim at night) — the sky goes
    // to it; the haze, the light and the bounce follow below
    const hlum = 0.2126 * u.uSkyHorizon.value.r + 0.7152 * u.uSkyHorizon.value.g + 0.0722 * u.uSkyHorizon.value.b
    u.uDustColor.value.copy(DUST).multiplyScalar(hlum * 0.82)
    if (dust > 0) {
      u.uSkyHorizon.value.lerp(u.uDustColor.value, 0.85 * dust)
      u.uSkyZenith.value.lerp(DUST.clone().multiplyScalar(hlum * 0.6), 0.75 * dust)
      u.uSunGlow.value.multiplyScalar(1 - 0.5 * dust)
    }
    // (the desert's air clearer still: its aerial views were pale and washed out — frame 221 196 170 vs their 213 175 158)
    // (2026-11-04: the desert's air THICK and warm — far layers fading to a peach-white, one behind another; it was
    //  clearer than the valley's)
    // (2026-11-06, the user: "the valley feels empty": its middle distance went pale — the valley's air a third longer
    //  and clear for its first 260 m, not 130; VALLEY_LIGHT below. ?light=0: as before)
    const vk = (1 - dk) * VALLEY_LIGHT
    u.uFogRange.value.y = this.hazeLen * (1 - 0.1 * dk + 0.3 * vk) * (1 - 0.45 * u.uRain.value)
    // (…and the first 400 m clear: near and middle ground keep their colour, only the far layers melt into the haze)
    u.uFogRange.value.x = 130 + 270 * dk + 130 * vk
    // THE VALLEY'S FOG (2026-11-08, the user: "we lack fog — put a simple fog, like a filter, no volumetric"): the air
    // clear only ~35 m round you, then a soft distance fog — ~20 % at 300 m, half at 1 km, the far ranges pale layers
    // (the haze's length × 0.33 here; `?fog=` scales its density: 0 the old clear air). The desert keeps its own.
    if (FOG_K > 0) {
      u.uFogRange.value.y = GFX.MathUtils.lerp(u.uFogRange.value.y, this.hazeLen * 0.33 / FOG_K * (1 - 0.45 * u.uRain.value), 1 - dk)
      u.uFogRange.value.x = GFX.MathUtils.lerp(u.uFogRange.value.x, 35, 1 - dk)
    }
    const amb = a.amb + (b.amb - a.amb) * f
    const night = GFX.MathUtils.smoothstep(-s, 0.06, 0.2)
    u.uNight.value = night
    u.uLamps.value = Math.max(night, 1 - GFX.MathUtils.smoothstep(s, 0.03, 0.14))
    if (s > -0.05) {
      u.uSunDir.value.copy(sun)
      u.uSunDisc.value.copy(a.sun).lerp(b.sun, f).multiplyScalar(sunI)
    } else {
      // the MOON: opposite the sun, its light fading in as the sun sinks
      u.uSunDir.value.copy(sun).negate()
      if (u.uSunDir.value.y < 0.15) u.uSunDir.value.y = 0.15
      u.uSunDir.value.normalize()
      u.uSunDisc.value.copy(MOON).multiplyScalar(0.16 * night)
    }
    // sky fill: the sky's average (bluer than its horizon); ground bounce: warm by day, cool and dim by night
    u.uAmbSky.value.copy(u.uSkyZenith.value).lerp(u.uSkyHorizon.value, 0.4).multiplyScalar(0.62 * amb)
    u.uAmbSky.value.lerp(MOON.clone().multiplyScalar(0.07), night * 0.8)
    u.uAmbGround.value.setRGB(0.42 + 0.18 * dk, 0.34 + 0.06 * dk, 0.22 + 0.03 * dk).multiplyScalar((0.55 * amb + 0.12 * sunI) * (1 + 0.2 * dk)).lerp(MOON.clone().multiplyScalar(0.025), night)
    // the LIGHT ON THE LAND keeps every colour true at every hour (the user: "when the time changes to evening, night,
    // morning, the terrain, grass and trees all change colour with it"): the sun's, the sky's and the bounce's light
    // lose most of their tint — a warm / cool hint is left, the brightness still follows the day; the SKY itself (its
    // colours, the sun's disc, the haze, the glint on the water) stays as vivid as the keyframes paint it
    keepTint(u.uSunColor.value.copy(u.uSunDisc.value), 0.3)
    keepTint(u.uAmbSky.value, 0.35)
    keepTint(u.uAmbGround.value, 0.5)
    // a floor on the sky's fill through dusk (the land darker than by day, its colours still its own) — but deep in
    // the night it gives way (2026-10-27, the user: "night needs more darkness, like in real life"): only the moon's
    // cold light is left, the land a dark silhouette against the sky, what the headlights paint is what you see
    floorLum(u.uAmbSky.value, GFX.MathUtils.lerp(0.22, 0.022, night))
    floorLum(u.uAmbGround.value, GFX.MathUtils.lerp(0.09, 0.006, night))
    // (DESERT_MATCH round 12 — the desert by day: a hard sun, deep shade; photographed, its scenes have half again our
    //  contrast — the sky's fill and the sand's bounce (and their floors) a third less)
    // (2026-11-04: the desert's shade BRIGHT and WARM — a soft, stylised light, its shadows a rosy brown, never dark;
    //  rounds 12–13's deeper shade was for the photographs)
    const fill = 1 + 0.15 * dk * GFX.MathUtils.smoothstep(s, 0.12, 0.35)
    u.uAmbSky.value.multiplyScalar(fill)
    u.uAmbGround.value.multiplyScalar(fill)
    // THE VALLEY'S SHADE (2026-11-06, the user: "the valley feels empty"): a hill's sunny and shaded sides were nearly
    // one value — the land read flat. By day the sky's fill and the bounce 16 % less, the sun 6 % more: the lit faces
    // keep their brightness (and the calibrated colours), the faces turned away fall a step darker
    const vday = (1 - dk) * VALLEY_LIGHT * GFX.MathUtils.smoothstep(s, 0.05, 0.3)
    // (the fill alone moved the frame ~1 %: the WRAP is what lights a slope turned away — 0.62 on the ground, so a face
    //  at right angles to the sun took 38 % of it. A third of the wrap cut: the hills' far sides a clear step darker)
    u.uAmbSky.value.multiplyScalar(1 - 0.22 * vday)
    u.uAmbGround.value.multiplyScalar(1 - 0.22 * vday)
    u.uSunColor.value.multiplyScalar(1 + 0.08 * vday)
    u.uWrapCut.value = 0.6 * vday
    // (2026-11-04 — the user: "at evening and night the rocks' reddish colour is bright, even in the shadows": the
    //  coral rock is twice the old albedo, so the desert's shade DIMS as the sun goes down — the fill and the bounce
    //  ×0.55 at dusk, the rock's extra fill (rockFill) half by day and a quarter from dusk on; the night's purple fill
    //  a third of what it was)
    const dayK = GFX.MathUtils.smoothstep(s, 0.12, 0.35)
    u.uRockFill.value = 1 - dk * (0.5 + 0.25 * (1 - dayK))
    if (dk > 0) {
      const al = 0.2126 * u.uAmbSky.value.r + 0.7152 * u.uAmbSky.value.g + 0.0722 * u.uAmbSky.value.b
      u.uAmbSky.value.lerp(D_WARMFILL.clone().multiplyScalar(al), 0.55 * dk * dayK)
      const dim = 1 - 0.45 * dk * (1 - dayK)
      u.uAmbSky.value.multiplyScalar(dim)
      u.uAmbGround.value.multiplyScalar(dim)
      // (by night a faint purple fill: the rocks a dark magenta against the sky, never a black hole — nor a glow)
      u.uAmbSky.value.lerp(D_PURPLE.clone().multiplyScalar(0.016), 0.6 * night * dk)
    }
    // the HAZE's colour: the horizon leaning to the zenith, much of its tint kept — far ridges go blue-grey in layers
    keepTint(u.uFogColor.value.copy(u.uSkyHorizon.value).lerp(u.uSkyZenith.value, 0.42), 0.75)
    // (the desert's haze: the sand's own warm colour in it)
    if (dk > 0) { const fl = 0.2126 * u.uFogColor.value.r + 0.7152 * u.uFogColor.value.g + 0.0722 * u.uFogColor.value.b; u.uFogColor.value.lerp(D_SANDHAZE.clone().multiplyScalar(fl * 1.05), 0.55 * dk).lerp(u.uSkyHorizon.value, 0.2 * dk * GFX.MathUtils.smoothstep(s, 0.12, 0.35)) } // (the far land melts into a warm peach-white)
    // the MIST's colour: the horizon's brightness as a cool grey-white (dark at night, rosy-grey at dusk)
    keepTint(u.uMistColor.value.copy(u.uSkyHorizon.value).lerp(u.uSkyZenith.value, 0.2), 0.18).multiplyScalar(0.92)
  }
}

/** The valley's clearer air and deeper shade (2026-11-06): 1 on; `?light=0` 0 — as before (the A/B). */
/** The valley's fog density (`?fog=`: 1 the default, 0 none — the old clear air — 2 twice as thick). */
const FOG_K = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('fog') ?? 1) : 1
const VALLEY_LIGHT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('light') === '0' ? 0 : 1

/** The desert's grade (Atmosphere.desert): colours of unit luminance-ish, scaled to the keyframe's brightness. */
// (2026-11-04: the stylised warm grade — was round 1's deep photographic blue)
const D_BLUE = new GFX.Color(0.62, 0.95, 1.32) // (the zenith: a pale cyan)
const D_PALEBLUE = new GFX.Color(1.06, 1.0, 0.96) // (the horizon: a warm near-white)
const D_PINK = new GFX.Color(2.1, 0.5, 0.78) // (sunset: hot pink)
const D_PURPLE = new GFX.Color(1.05, 0.42, 1.35) // (night: purple)
const D_SANDHAZE = new GFX.Color(1.16, 0.93, 0.86) // (the haze: peach-white)
const D_WARMFILL = new GFX.Color(1.32, 0.86, 0.8) // (the shade's fill: rosy)
/** The sandstorm's dust (unit-ish luminance): Over the Hill's orange-brown haze. */
const DUST = new GFX.Color(1.42, 0.86, 0.5)

/** First line of every world fragment shader (GLSL3: three's tone-map / colour-space chunks write gl_FragColor). */
export const FRAG_OUT = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`

/** Uniform declarations + the shared functions. Include in vertex AND fragment shaders that need them. */
export const ATMOS_GLSL = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSunDisc;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec2 uFogRange;
uniform vec3 uFogColor;
uniform float uTime;
uniform vec4 uCaveA0;
uniform vec4 uCaveB0;
uniform vec4 uCaveA1;
uniform vec4 uCaveB1;
uniform vec4 uCaveA2;
uniform vec4 uCaveB2;
// HOW DEEP IN A CAVE p is (0 out in the open … ~0.85 deep under the roof): within its radius of the cave's line, under
// its roof, fading out toward an open mouth over its first metres (a grotto's far end closed: dark to the back)
float caveOne(vec3 p, vec4 A, vec4 B) {
  if (B.x <= 0.0) return 0.0;
  vec2 a = A.xy, ab = A.zw - A.xy;
  float L2 = max(dot(ab, ab), 1e-3), t = clamp(dot(p.xz - a, ab) / L2, 0.0, 1.0), L = sqrt(L2);
  float d = length(p.xz - (a + ab * t));
  float fl = 9.0 * max(B.z, 1.0); // (B.z: the far end closed (> 0.5) and the fade in from the mouth, its metres / 9)
  float mouth = smoothstep(0.0, fl, t * L) * (B.z > 0.5 ? 1.0 : smoothstep(0.0, 9.0, (1.0 - t) * L));
  float sky = B.w > 0.0 ? smoothstep(B.w * 0.6, B.w * 1.7, length(p.xz - A.zw)) : 1.0; // (a skylight: lit under it)
  return 0.86 * (1.0 - smoothstep(B.x * 0.75, B.x, d)) * (1.0 - smoothstep(B.y - 1.2, B.y, p.y)) * mouth * sky;
}
float caveK(vec3 p) { return max(caveOne(p, uCaveA0, uCaveB0), max(caveOne(p, uCaveA1, uCaveB1), caveOne(p, uCaveA2, uCaveB2))); }
// THE SKYLIGHT'S BOUNCE (2026-11-07, the cave world): the daylight down its shaft lights the chamber round it softly —
// 1 under the light, 0 by ~7 radii off (a cave without a skylight: 0)
float caveBounceOne(vec3 p, vec4 A, vec4 B) { return B.x > 0.0 && B.w > 0.0 ? 1.0 - smoothstep(B.w, B.w * 7.0, length(p.xz - A.zw)) : 0.0; }
float caveBounce(vec3 p) { return max(caveBounceOne(p, uCaveA0, uCaveB0), max(caveBounceOne(p, uCaveA1, uCaveB1), caveBounceOne(p, uCaveA2, uCaveB2))); }
// THE CAVE'S OWN LIGHT (2026-11-07, the user: "inside, the wall — where is the shader? the real rock 3D thing we use on
// the terrain"): the daylight comes in from a reach's open end (its mouth, or the skylight it starts at) and down its
// skylight — a DIRECTION, so the rock's relief and its shapes read in there as under the sun (a flat fill drew the walls
// as a smooth dark sheet). Wrapped, 0…1.
vec3 caveLightOne(vec3 p, vec4 A, vec4 B) {
  if (B.x <= 0.0) return vec3(0.0);
  vec2 a = A.xy - p.xz;
  float da = max(length(a), 1.0);
  vec3 L = (vec3(a.x / da, 0.45, a.y / da)) / (1.0 + da * 0.02);
  if (B.w > 0.0) { vec2 s = A.zw - p.xz; float ds = max(length(s), 1.0); L += vec3(s.x / ds * 0.5, 1.0, s.y / ds * 0.5) * 2.5 / (1.0 + ds * 0.04); }
  return L * (caveOne(p, A, B) + 0.02);
}
float caveLit(vec3 p, vec3 N) {
  vec3 L = caveLightOne(p, uCaveA0, uCaveB0) + caveLightOne(p, uCaveA1, uCaveB1) + caveLightOne(p, uCaveA2, uCaveB2);
  float l = length(L);
  float x = clamp(dot(N, l > 1e-4 ? L / l : vec3(0.0, 1.0, 0.0)) * 0.6 + 0.4, 0.0, 1.0);
  return x * x;
}
uniform sampler2D uNoise;
uniform float uNight;
uniform float uRockFill;
uniform float uWrapCut;
uniform vec4 uHeadL;
uniform vec3 uHeadR;
uniform vec3 uHeadDir;
uniform vec3 uHeadUp;
uniform vec4 uTail;
uniform vec4 uFire;
uniform float uLamps;
uniform float uCloud;
uniform float uRain;
uniform float uWet;
uniform vec2 uWind;
uniform float uGlow;
uniform float uMist;
uniform vec3 uMistColor;
uniform float uDust;
uniform vec3 uDustColor;
// (the player's own car takes less of the mist — MIST_K 0.45, Vehicle.ts: it stays readable a few metres off)
#ifndef MIST_K
#define MIST_K 1.0
#endif
// how far the sky and the haze have gone to the mist (0 … 1)
float mistK() { return smoothstep(0.05, 0.55, uMist); }

// HEADLIGHTS, PAINTED (the user, 2026-10-27: "the light comes from the centre of the front, not the headlamps — use a
// light like paint, not an actual light"): from EACH lamp a beam whose footprint is an ellipse in angle space (wide,
// low, aimed a little down), laid on in three soft VALUE BANDS (a painter's hot core, body and fringe) with a soft edge,
// fading over 16 … 46 m; a surface takes it almost flat (little N·L), so the pool on the track reads as a shape of
// light painted onto the ground. The two beams overlap ahead of the car.
float beamOf(vec3 lamp, vec3 wpos) {
  vec3 v = wpos - lamp;
  float a = dot(v, uHeadDir);
  if (a < 0.3) return 0.0;
  vec3 side = normalize(cross(uHeadDir, uHeadUp));
  vec2 ang = vec2(dot(v, side), dot(v, uHeadUp) + 0.07 * a) / a;
  float r = length(ang / vec2(0.40, 0.17));
  float b = (1.0 - smoothstep(0.78, 1.0, r)) * (1.0 - smoothstep(16.0, 46.0, a)) * smoothstep(0.3, 1.2, a)
          * (0.45 + 0.55 * (1.0 - smoothstep(0.0, 0.6, r)));
  float q = b * 3.0;
  return (floor(q) + smoothstep(0.3, 0.7, fract(q))) / 3.0;
}
// The car's lights on a surface at wpos (normal N): the two painted beams, and behind the car the BRAKE lights' red
// pool on the ground (strong at night, a hint by day).
vec3 headlight(vec3 albedo, vec3 N, vec3 wpos) {
  vec3 c = vec3(0.0);
  if (uHeadL.w > 0.5) {
    float b1 = beamOf(uHeadL.xyz, wpos), b2 = beamOf(uHeadR, wpos);
    float B = max(b1, b2) * 0.75 + (b1 + b2) * 0.25;
    float face = 0.6 + 0.4 * clamp(dot(N, normalize((uHeadL.xyz + uHeadR) * 0.5 - wpos)), 0.0, 1.0);
    c += albedo * vec3(1.0, 0.88, 0.66) * (3.2 * B * face);
  }
  if (uTail.w > 0.01) {
    vec3 v = wpos - uTail.xyz;
    float a = -dot(v, uHeadDir), side = length(v - dot(v, uHeadDir) * uHeadDir - dot(v, uHeadUp) * uHeadUp);
    float pool = 1.0 - smoothstep(0.0, 1.0, (side * 0.8 + max(a, 0.0) * 0.35 + max(-a, 0.0) * 4.0) / 3.2);
    c += albedo * vec3(1.0, 0.08, 0.04) * (1.1 * uTail.w * pool * (0.15 + 0.85 * uNight));
  }
  // a CAMPFIRE's glow (one, the nearest lit — Props.ts): warm, fading over ~18 m, stronger on what faces it
  if (uFire.w > 0.001) {
    vec3 v = uFire.xyz - wpos;
    float d2 = dot(v, v);
    if (d2 < 400.0) {
      float k = uFire.w / (1.0 + d2 * 0.05) * (1.0 - smoothstep(196.0, 400.0, d2));
      c += albedo * vec3(1.0, 0.5, 0.18) * k * (0.35 + 0.65 * clamp(dot(N, v * inversesqrt(max(d2, 1e-4))) * 0.5 + 0.5, 0.0, 1.0));
    }
  }
  return c;
}

// The sky in direction d: zenith → a broad warm horizon band, the sun's glow round it.
vec3 skyColor(vec3 d) {
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(up, 0.55));
  // a thin brighter band right at the horizon, and below it the haze a touch darker
  c = mix(c, uSkyHorizon * 1.06, exp(-abs(y) * 26.0) * 0.6);
  c *= 1.0 - clamp(-y * 1.4, 0.0, 0.18);
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (0.3 * pow(s, 4.0) + 0.6 * pow(s, 24.0)) * (0.6 + 0.4 * (1.0 - up));
  // (the lower sky is the fog: the fogged land melts into it, no horizon line)
  c = mix(c, uFogColor + uSunGlow * (0.18 * pow(s, 6.0)) * (1.0 - uNight), 1.0 - smoothstep(-0.02, 0.2, y));
  // (in the crossing's cloud the sky is the mist, a touch brighter overhead where the sun comes through)
  // (a sandstorm: the sky is the blowing dust, a little brighter toward the sun)
  if (uDust > 0.001) c = mix(c, uDustColor * (1.0 + 0.25 * pow(s, 4.0)), smoothstep(0.05, 0.7, uDust) * 0.92);
  // (no brighter overhead once it's thick: the far ridges, fogged to the mist's own colour, must not show against it)
  if (uMist > 0.001) c = mix(c, uMistColor * (1.0 + 0.12 * up * (1.0 - uMist)) + uSunGlow * 0.05 * pow(s, 3.0) * (1.0 - uNight), mistK());
  return c;
}

// THE HAZE (2026-10-27 — before, a solid white fog hid everything past ~900 m; now the whole 16 km world is drawn, so
// landmarks and far ranges can be seen and driven to): clear air round the player (uFogRange.x), then AERIAL
// PERSPECTIVE — each farther ridge paler and bluer (1 − e^(−d / uFogRange.y)), a little thicker low in the valleys,
// never solid (≤ 94 %): the far mountains stand as layered blue silhouettes. Its colour: the horizon leaning to the
// zenith (dark at night), a faint glow toward the sun.
vec3 fogColor(vec3 d) {
  float s = max(dot(d, uSunDir), 0.0);
  // (without the post pass the bloom's spread over the hazy ridges toward the sun is painted here: wider, warmer)
  vec3 c = uFogColor + uSunGlow * (0.18 * pow(s, 6.0) + uGlow * (0.22 * pow(s, 3.0) + 0.35 * pow(s, 24.0))) * (1.0 - uNight);
  if (uDust > 0.001) c = mix(c, uDustColor * (1.0 + 0.25 * pow(s, 4.0)), smoothstep(0.05, 0.6, uDust));
  return uMist > 0.001 ? mix(c, uMistColor + uSunGlow * 0.05 * pow(s, 3.0) * (1.0 - uNight), mistK()) : c;
}
float fogAmount(vec3 wpos) {
  float d = max(length(wpos - uCamPos) - uFogRange.x, 0.0);
  float a = 1.0 - exp(-d / uFogRange.y);
  float low = exp(-max(wpos.y - 30.0, 0.0) / 380.0);
  float f = min(a * (0.86 + 0.14 * low), 0.94);
  // THE CROSSING'S MIST: a fog round the camera itself (no clear air) — at 1 the land 85 % gone ~40 m off;
  // whichever is thicker
  // (2026-11-04 — the user: "the fog on the hill is okay but it hides the path": at its thickest 85 % gone at ~40 m, not
  //  10 — the road readable 30–40 m ahead, ~3 s at the pass's pace; the sky behind still all mist)
  if (uMist > 0.001) f = max(f, 1.0 - exp(-length(wpos - uCamPos) * 0.048 * MIST_K * uMist * uMist * uMist));
  // THE SANDSTORM: the dust round the camera — ~110 m to see at its height (never quite solid: shapes in it)
  if (uDust > 0.001) f = max(f, (1.0 - exp(-length(wpos - uCamPos) * 0.028 * MIST_K * uDust * uDust)) * 0.97);
  return f;
}
vec3 applyAtmos(vec3 col, vec3 wpos) {
  return mix(col, fogColor(normalize(wpos - uCamPos)), fogAmount(wpos));
}

// Ambient: sky from above, warm bounce from below.
vec3 ambient(vec3 N) {
  return mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
}

// STYLIZED ROCK FILL (2026-10-27, Over the Hill's soft pale rock: its shade a light blue-grey, never near black — ours
// lit 8 : 1 sun to shade went black): the sky's light again, strongest on the faces turned from the sun — the cool of
// the shade. Rock only (the terrain's rock, the boulders); it follows the sky, so the nights stay dark.
vec3 rockFill(vec3 albedo, vec3 N) { return albedo * uAmbSky * (0.45 + 0.8 * (1.0 - clamp(dot(N, uSunDir) * 1.5, 0.0, 1.0))) * uRockFill; }

// GGX distribution (art-directed spec: rough ground, a soft wide sheen).
float ggx(float NoH, float r) {
  float a = r * r;
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}

// Surface light: wrapped diffuse (soft terminator, painterly), sky / bounce ambient, a GGX lobe.
vec3 shade(vec3 albedo, vec3 N, vec3 V, float rough, float f0, float ao, float sunVis, float wrap) {
  // WET (the rain): every surface darker; what faces up a touch glossier — rock, wood, metal only (rough < 0.75), never
  // the leaves or the grass. NO SKY SHEEN (2026-11-07, the user: "when it rains you make it all white — no need: some
  // water on the ground, droplets on the trees"): the sky mirrored on every wet face read as white; the water lies in
  // the puddles (Terrain.ts) and on the leaves as droplets (Trees.ts)
  float wet = uWet * smoothstep(0.1, 0.8, N.y) * (1.0 - smoothstep(0.65, 0.75, rough));
  albedo *= 1.0 - 0.28 * uWet;
  rough = mix(rough, 0.35, wet * 0.6);
  f0 = mix(f0, 0.04, wet);
  float NoL = dot(N, uSunDir);
  wrap *= 1.0 - uWrapCut;
  float diff = clamp((NoL + wrap) / (1.0 + wrap), 0.0, 1.0);
  diff *= diff * (3.0 - 2.0 * diff) * 0.35 + 0.65; // a gentle S: fuller light faces, softer shade
  vec3 col = albedo * (uSunColor * diff * sunVis + ambient(N) * ao);
#ifdef OTH_SPEC
  vec3 H = normalize(uSunDir + V);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
  col += uSunColor * sunVis * ggx(NoH, rough) * F * max(NoL, 0.0) * 0.25;
#endif
  return col;
}
`
