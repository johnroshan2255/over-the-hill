import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import { LAKE_DISC, RIVER_WIDEN, STREAM_WIDEN } from './mapPrep'
import { fallLip } from './Falls'
import type { Tier } from './quality'
import { HEIGHT_GLSL, type Terrain } from './Terrain'
import { SHADOW_GLSL } from './TerrainShadow'
import { gameParams } from '../settings'

/**
 * WATER — the lake and the ponds (a disc each at its level: calm, see-through turquoise → deep teal, the sky by
 * Fresnel, sun glints on drifting ripples) and the FLOWING water — the river and the streams (a ribbon along each
 * centre line at its sloping surface) — as RAPIDS (the user's reference: a fast shallow stream, light blue under
 * white foam streaks racing downstream). The depth under every pixel comes from the height grid itself (HEIGHT_GLSL:
 * no depth pre-pass); a soft white line where the water meets the bank.
 *
 * RAPIDS, cheap: two noise reads stretched along the current in the ribbon's own coordinates (metres downstream,
 * metres across — the streaks bend with the river) scrolling at the water's speed (faster where its surface drops
 * more), a slow churn, whiter in the shallows, along the banks and round the boulders (their footprint, blurred).
 */
/** COST TESTS (docs/PERF.md, abq.mjs): ?wcut=sky,sun,atmos,depth,flat — a part of the water's shader cut. */
function wcut(): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of (gameParams().get('wcut') ?? '').split(',')) if (k) o[`WC_${k.toUpperCase()}`] = ''
  return o
}

export class Water {
  readonly group = new GFX.Group()
  /** The still water's material for a pond set in a cave (its depth per vertex: aUV.x). */
  readonly poolMaterial: () => GFX.ShaderMaterial

  constructor(map: MapData, atmos: Atmosphere, terrain: Terrain, tier: Tier, rockFootprint: GFX.Texture) {
    const t = terrain.uniforms
    const uniforms = {
      ...atmos.uniforms,
      uHIn: t.uHIn, uHFar: t.uHFar, uInGrid: t.uInGrid, uFarGrid: t.uFarGrid, uInScale: t.uInScale, uFarScale: t.uFarScale, uBoxHalf: t.uBoxHalf,
      uShBox: t.uShBox, uShWorld: t.uShWorld, uShBoxGrid: t.uShBoxGrid, uShOn: t.uShOn, uTreeSh: t.uTreeSh, uTreeShGrid: t.uTreeShGrid, uTreeShOn: t.uTreeShOn,
      uRocks: { value: rockFootprint },
      // (the ground the still water owns — mapPrep.ts waterOwner: the lake / ponds draw only on it, the ribbons off it)
      uOwn: { value: map.waterTex }, uOwnGrid: { value: new GFX.Vector3(map.meta.mask.n, map.meta.mask.step, map.meta.mask.origin) },
    }
    const material = (rapids: boolean) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms,
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(rapids ? { RAPIDS: '' } : {}), ...map.biomeDefines, ...wcut() },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: GFX.DoubleSide,
    })
    const still = material(false), flowing = material(true)
    // THE CAVE'S PONDS (CaveWorld.addPools — 2026-11-07, the user: "the water must be like the outside water"): the
    //  still water's own shader, its depth from the pond's shape (aUV.x: the ground under it is the hill's top), the
    //  cave's dark on it
    this.poolMaterial = () => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3, uniforms,
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...map.biomeDefines, CAVE_POOL: '' },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: GFX.DoubleSide,
    })
    // the lake: a disc round its ellipse (the shore clips it); the PONDS and small lakes: a disc each, at its level —
    // all in ONE mesh (2026-11-02: a draw each, up to 17 in a view, most of them behind the hills); the parts under
    // the banks cost little: the water is drawn after the terrain, its depth test drops them before they're shaded
    const pos: number[] = [], idx: number[] = []
    const disc = (cx: number, cz: number, rx: number, rz: number, rot: number, level: number, seg: number) => {
      const g = new GFX.CircleGeometry(1, seg)
      g.rotateX(-Math.PI / 2)
      g.scale(rx, 1, rz)
      g.rotateY(-rot)
      g.translate(cx, level, cz)
      const base = pos.length / 3
      pos.push(...(g.attributes.position.array as Float32Array))
      for (const i of g.index!.array) idx.push(base + i)
      g.dispose()
    }
    const L = map.meta.water.lake
    disc(L.cx, L.cz, L.rx * LAKE_DISC, L.rz * LAKE_DISC, L.rot, L.level, 96)
    for (const P of map.meta.water.ponds ?? []) disc(P.cx, P.cz, P.rx, P.rz, P.rot, P.level, 48)
    const g = new GFX.BufferGeometry()
    const n = pos.length / 3
    g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
    g.setAttribute('aFlow', new GFX.BufferAttribute(new Float32Array(n * 2), 2))
    g.setAttribute('aUV', new GFX.BufferAttribute(new Float32Array(n * 4), 4))
    g.setIndex(idx)
    g.computeBoundingSphere()
    const m = new GFX.Mesh(g, still)
    m.renderOrder = 5
    this.group.add(m)
    // the river (and on beyond the box, where the desert's gorge goes on) and the streams: ribbons (the banks clip
    // them) — one draw for all of them
    const r = map.meta.water.river, out = map.meta.water.riverOut
    // (a stream that runs over a fall's lip stops at the lip — Falls.ts fallLip, the ground's real edge: the runs above
    //  the valley's Hidden Falls and Veil Falls hung on out over the drop, 20 m up in front of their cliffs)
    const lips = (map.meta.water.falls ?? []).map((F) => fallLip(map, F)).filter((p) => p !== null)
    const streams = (map.meta.water.streams ?? []).map((S) => intoRiver(trimAtLips(S, lips), r))
    this.group.add(ribbons([{ ...r, widen: RIVER_WIDEN, stream: false }, ...(out ? [{ ...out, widen: RIVER_WIDEN, stream: false }] : []), ...streams.map((S) => ({ ...S, widen: STREAM_WIDEN, stream: true }))].filter((L) => L.x.length > 1).map(downstreamFirst).map(smooth).map((L) => meetStill(L, map)), flowing))
  }
}

/** A line as the ribbons take it, downstream first: the valley's river and streams are written that way, the desert's
 *  river from its head (104 m) down to the gorge (66 m) — read as it was, it flowed uphill and its rapids were still. */
function downstreamFirst<L extends { x: number[]; z: number[]; y: number[]; hw: number[] }>(L: L): L {
  return L.y[0] > L.y[L.y.length - 1] ? { ...L, x: [...L.x].reverse(), z: [...L.z].reverse(), y: [...L.y].reverse(), hw: [...L.hw].reverse() } : L
}

type Line = { x: number[]; z: number[]; y: number[]; hw: number[]; wk?: number[] }
/** A stream's line without the points out past a fall's lip at its level (over the drop): the first of them moved back
 *  onto the lip's edge, the rest dropped. */
function trimAtLips<L extends Line>(L: L, lips: NonNullable<ReturnType<typeof fallLip>>[]): L {
  let cur: L = L
  for (const p of lips) {
    const past = cur.x.map((x, i) => {
      const ex = x - p.x, ez = cur.z[i] - p.z, along = ex * p.dx + ez * p.dz, side = -ex * p.dz + ez * p.dx
      return along > 0 && along < 30 && Math.abs(side) < p.hw * 2 + 4 && Math.abs(cur.y[i] - p.y) < Math.min(1.5, 0.4 * p.drop) ? along : -1
    })
    if (!past.some((a) => a > 0)) continue
    const x: number[] = [], z: number[] = [], y: number[] = [], hw: number[] = [], wk: number[] = []
    let moved = false
    for (let i = 0; i < cur.x.length; i++) {
      if (past[i] < 0) { x.push(cur.x[i]); z.push(cur.z[i]); y.push(cur.y[i]); hw.push(cur.hw[i]); if (cur.wk) wk.push(cur.wk[i]); continue }
      // (the past points are at one end — the run's downstream end: keep one, on the edge, next to the kept ones)
      const nextKept = (i > 0 && past[i - 1] < 0) || (i < cur.x.length - 1 && past[i + 1] < 0)
      if (nextKept && !moved) { moved = true; x.push(cur.x[i] - p.dx * past[i]); z.push(cur.z[i] - p.dz * past[i]); y.push(cur.y[i]); hw.push(cur.hw[i]); if (cur.wk) wk.push(cur.wk[i]) }
    }
    cur = { ...cur, x, z, y, hw, ...(cur.wk ? { wk } : {}) }
  }
  return cur
}

/** A stream whose mouth is on the river runs on 16 m into it (its own way): it fades out in the river's water
 *  (waterOwner A), and where it meets the river end to end — the desert's creek into the river's head — the two ribbons'
 *  square-cut ends left a wedge of bed between them. */
function intoRiver<L extends Line>(S: L, R: Line): L {
  const n = S.x.length
  if (n < 2) return S
  const m = S.y[0] <= S.y[n - 1] ? 0 : n - 1, p = m === 0 ? 1 : n - 2
  let best = Infinity, rhw = 0
  for (let i = 0; i < R.x.length; i++) { const d = Math.hypot(R.x[i] - S.x[m], R.z[i] - S.z[m]); if (d < best) { best = d; rhw = R.hw[i] } }
  if (best > rhw * 1.5 + 4) return S
  let dx = S.x[m] - S.x[p], dz = S.z[m] - S.z[p]
  const l = Math.hypot(dx, dz) || 1
  dx /= l; dz /= l
  const add = <T,>(a: T[], v: T) => (m === 0 ? [v, ...a] : [...a, v])
  return { ...S, x: add(S.x, S.x[m] + dx * 16), z: add(S.z, S.z[m] + dz * 16), y: add(S.y, S.y[m]), hw: add(S.hw, S.hw[m]), ...(S.wk ? { wk: add(S.wk, S.wk[m]) } : {}) }
}

/** A line resampled every ≤ 4 m through a Catmull-Rom of its points (the height and the half width linear): the
 *  ribbon's edges were straight 18–26 m chords with a corner at every point (2026-11-04, the user's screenshot of the
 *  desert's lagoon). */
function smooth<L extends Line>(L: L): L {
  const n = L.x.length
  if (n < 3) return L
  const x: number[] = [], z: number[] = [], y: number[] = [], hw: number[] = [], wk: number[] = []
  const P = (i: number) => Math.min(n - 1, Math.max(0, i))
  for (let k = 0; k < n - 1; k++) {
    const len = Math.hypot(L.x[k + 1] - L.x[k], L.z[k + 1] - L.z[k]), m = Math.max(1, Math.ceil(len / 4))
    const a = P(k - 1), b = k, c = k + 1, d = P(k + 2)
    for (let i = 0; i < m; i++) {
      const t = i / m, t2 = t * t, t3 = t2 * t
      const cr = (p0: number, p1: number, p2: number, p3: number) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
      x.push(cr(L.x[a], L.x[b], L.x[c], L.x[d])); z.push(cr(L.z[a], L.z[b], L.z[c], L.z[d]))
      y.push(L.y[b] + (L.y[c] - L.y[b]) * t); hw.push(L.hw[b] + (L.hw[c] - L.hw[b]) * t)
      if (L.wk) wk.push(L.wk[b] + (L.wk[c] - L.wk[b]) * t)
    }
  }
  x.push(L.x[n - 1]); z.push(L.z[n - 1]); y.push(L.y[n - 1]); hw.push(L.hw[n - 1])
  if (L.wk) wk.push(L.wk[n - 1])
  return { ...L, x, z, y, hw, ...(L.wk ? { wk } : {}) }
}

/** A ribbon's line meeting the lake / pond it runs into or out of at that water's EXACT level (on its fine 4 m line:
 *  mapPrep.ts reconcileWater eases the meta's 18–26 m points, and between two of them the surface was already 15 cm
 *  down where the two waters hand over — a crack of bed showing between them): on the still water's ground (and a cell
 *  round it — MapData.stillLevel — at its middle or either edge: the shore crosses a channel aslant) at its level, held
 *  there 6 m on, then changing by at most 5 % until it meets its own profile. */
function meetStill<L extends Line & { widen: number }>(L: L, map: MapData): L {
  const n = L.x.length, HOLD = 6, SLOPE = 0.05
  const s = new Float64Array(n)
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(L.x[i] - L.x[i - 1], L.z[i] - L.z[i - 1])
  const lv = L.x.map((x, i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let tx = L.x[b] - L.x[a], tz = L.z[b] - L.z[a]
    const l = Math.hypot(tx, tz) || 1, w = L.hw[i] * (L.wk ? L.wk[i] : L.widen)
    tx /= l; tz /= l
    return map.stillLevel(x, L.z[i]) ?? map.stillLevel(x - tz * w, L.z[i] + tx * w) ?? map.stillLevel(x + tz * w, L.z[i] - tx * w)
  })
  if (lv.every((v) => v === null)) return L
  const y = [...L.y]
  const pull = (i: number, at: number, level: number) => {
    const r = SLOPE * Math.max(0, Math.abs(s[i] - at) - HOLD)
    y[i] = Math.min(Math.max(y[i], level - r), level + r)
  }
  for (let i = 0, at = NaN, level = 0; i < n; i++) { const v = lv[i]; if (v !== null) { at = s[i]; level = v } if (!Number.isNaN(at)) pull(i, at, level) }
  for (let i = n - 1, at = NaN, level = 0; i >= 0; i--) { const v = lv[i]; if (v !== null) { at = s[i]; level = v } if (!Number.isNaN(at)) pull(i, at, level) }
  return { ...L, y }
}

/** Flowing-water ribbons, one mesh: each along x / z (surface y, half width hw × widen each side — less on the inside
 *  of a tight bend, where the offset edge folded over itself into a sharp corner), downstream toward index 0 — aFlow =
 *  the downstream direction × speed (faster where the surface drops more), aUV = (metres downstream from its source,
 *  metres across, −1 … 1 across: the outer edge fades out, never a cut). */
function ribbons(lines: (Line & { widen: number; stream: boolean })[], mat: GFX.Material): GFX.Mesh {
  const total = lines.reduce((a, L) => a + L.x.length, 0)
  const pos = new Float32Array(total * 2 * 3), flow = new Float32Array(total * 2 * 2), uv = new Float32Array(total * 2 * 4), idx: number[] = []
  let o = 0
  for (const { x, z, y, hw, wk, widen, stream } of lines) {
    o += ribbon(x, z, y, hw, wk ?? null, widen, stream, pos, flow, uv, idx, o)
  }
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.BufferAttribute(pos, 3))
  g.setAttribute('aFlow', new GFX.BufferAttribute(flow, 2))
  g.setAttribute('aUV', new GFX.BufferAttribute(uv, 4))
  g.setIndex(idx)
  g.computeBoundingSphere()
  const m = new GFX.Mesh(g, mat)
  m.renderOrder = 5
  return m
}
/** One ribbon written from vertex pair o on; returns its pair count. */
function ribbon(x: number[], z: number[], y: number[], hw: number[], wk: number[] | null, widen: number, stream: boolean, pos: Float32Array, flow: Float32Array, uv: Float32Array, idx: number[], o: number): number {
  const n = x.length
  // arc length from the source (the last point) down
  const s = new Float32Array(n)
  for (let i = n - 2; i >= 0; i--) s[i] = s[i + 1] + Math.hypot(x[i + 1] - x[i], z[i + 1] - z[i])
  // the bend: the heading's turn per metre, over ±3 points (~±12 m)
  const head = new Float32Array(n), kap = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    head[i] = Math.atan2(z[b] - z[a], x[b] - x[a])
    if (i > 0) { let d = head[i] - head[i - 1]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; head[i] = head[i - 1] + d }
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3)
    kap[i] = b > a ? (head[b] - head[a]) / Math.max(0.5, s[a] - s[b]) : 0
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let tx = x[b] - x[a], tz = z[b] - z[a]
    const l = Math.hypot(tx, tz) || 1
    tx /= l; tz /= l
    // (the heading turning + bends the line toward the (−tz, tx) side — the first vertex's: its edge is the inner one;
    //  there the reach is held to 85 % of the bend's radius, never under the water's own half width)
    const w = hw[i] * (wk ? wk[i] : widen), inner = Math.max(hw[i] * 1.05, 0.85 / Math.max(1e-4, Math.abs(kap[i])))
    const wl = kap[i] > 0 ? Math.min(w, inner) : w, wr = kap[i] < 0 ? Math.min(w, inner) : w
    pos.set([x[i] - tz * wl, y[i], z[i] + tx * wl, x[i] + tz * wr, y[i], z[i] - tx * wr], (o + i) * 6)
    const drop = Math.max(0, (y[b] - y[a]) / l) // (the surface's fall per metre, downstream)
    // (a stream calms over its last 30 m into the water it joins — the river, a lake: the same calm water at the mouth)
    const sp = Math.min(4.5, 1.3 + 30 * drop * (stream ? Math.min(1, (s[0] - s[i]) / 30) : 1))
    flow.set([-tx * sp, -tz * sp, -tx * sp, -tz * sp], (o + i) * 4)
    uv.set([s[i], -wl, -1, stream ? 1 : 0, s[i], wr, 1, stream ? 1 : 0], (o + i) * 8)
    if (i < n - 1) { const k = (o + i) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2) }
  }
  return n
}

const VERT = /* glsl */ `
in vec2 aFlow;
in vec4 aUV;
out vec3 vWorld;
out vec2 vFlow;
out vec4 vUV;
void main() {
  vWorld = position;
  vFlow = aFlow;
  vUV = aUV;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${HEIGHT_GLSL}
${SHADOW_GLSL}
uniform sampler2D uRocks;
uniform sampler2D uOwn;
uniform vec3 uOwnGrid; // n, step, origin (the mask's 4 m grid)
in vec3 vWorld;
in vec2 vFlow;
in vec4 vUV; // (ribbons: metres downstream, metres across, −1 … 1 across, 1 on a stream)

// (2026-11-08: the shallows a deep clear green-teal — they're seen THROUGH, over the bed (stillLook's opacity); the pale
//  0.2 0.55 0.52 at half opacity over the sand read as milk)
const vec3 SHALLOW = vec3(0.06, 0.22, 0.2);
const vec3 DEEP = vec3(0.02, 0.15, 0.18);
// the waterline LAPPING: a few cm up and down, in its own time along the shore (m — added to the depth)
float shoreLap(vec2 xz) {
  float ph = uTime * 1.25 + dot(xz, vec2(0.23, 0.17)) + texture(uNoise, xz / 23.0).r * 7.0;
  return 0.028 * sin(ph) + 0.012 * sin(ph * 2.3 + 1.7);
}
// the rapids (the reference ≈ sRGB 150 190 215 under the streaks, the foam ≈ 235 242 248)
const vec3 RUN = vec3(0.26, 0.47, 0.64);
const vec3 RUN_DEEP = vec3(0.1, 0.27, 0.42);
const vec3 FOAM = vec3(0.83, 0.89, 0.94);
// (2026-10-27, the colour pass: the slow wide river was painted as rapids end to end — pale ice-blue under white
//  hatching. Calm water is clear TEAL, Over the Hill's river colour; the rapids stay on the fast streams)
const vec3 TEAL = vec3(0.1, 0.4, 0.44);
const vec3 TEAL_DEEP = vec3(0.025, 0.19, 0.25);
// the desert's gueltas (≈ sRGB 97 91 44 looking down into one) and the sandstone their canyons mirror (paint.ts STONE)
// (2026-11-04, the stylised look: a pale glossy blue, light where shallow — was round 4's olive guelta)
// (2026-11-04, round 2 — the user's reference frames: an oasis lagoon a pale MILKY sky-blue, ≈ sRGB 172 198 222 — ours
//  read 136 166 193: lighter, the deep less dark; the walls in it the stacks' sandstone)
const vec3 G_SHALLOW = vec3(0.5, 0.7, 0.84);
const vec3 G_DEEP = vec3(0.26, 0.48, 0.68);
const vec3 G_WALL = vec3(0.44, 0.19, 0.11);

// THE STILL WATER's look — the lake and the ponds; a ribbon takes it as it comes to them (flowK: how much its ripples
// drift with the current)
vec4 stillLook(vec2 xz, float depth, vec3 V, float sun, float dcam, float flowK, float shoreM) {
  // ripples: two noise layers drifting
  // (ripples fade with distance: far water is calm — and no moiré; past 160 m, where they're gone, not read at all)
  vec2 slope = vec2(0.0);
  float rk = 1.0 - smoothstep(25.0, 160.0, dcam);
  if (rk > 0.0) {
    vec2 drift = vFlow * uTime * flowK;
    vec2 n1 = texture(uNoise, xz / 9.0 - drift / 9.0 + uTime * vec2(0.012, 0.007)).rg - 0.5;
    vec2 n2 = texture(uNoise, xz / 3.1 - drift / 3.1 - uTime * vec2(0.02, -0.015)).gr - 0.5;
    slope = (n1 * 0.16 + n2 * 0.08) * rk;
  }
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  // body colour: see-through shallows → deep teal
  float k = 1.0 - exp(-depth * 0.55);
#ifdef OTH_DESERT
  // (DESERT_MATCH round 4 — a GUELTA, as photographed in the Tassili's canyons: olive-green over its sand, dark where
  //  deep — never turquoise)
  vec3 body = mix(G_SHALLOW, G_DEEP, k) * (ambient(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.35 * sun);
#else
  vec3 body = mix(SHALLOW, DEEP, k) * (ambient(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.35 * sun);
#endif
  // the sky by Fresnel
  // (art-directed: the reflection never quite whites out the water, and takes its colour)
  float F = 0.02 + 0.42 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
#ifdef WC_SKY
  vec3 refl = uSkyHorizon;
#else
  vec3 refl = skyColor(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * vec3(0.72, 0.9, 0.95);
#endif
#ifdef OTH_DESERT
  // (in a canyon the low half of the reflection is its walls — warm sandstone in the light — not the sky)
  refl = mix(G_WALL * (ambient(vec3(0.0, 1.0, 0.0)) * 0.7 + uSunColor * 0.45), refl, smoothstep(0.04, 0.28, R.y));
#endif
  vec3 c = mix(body, refl, F);
  // sun glints
  vec3 H = normalize(uSunDir + V);
  c += uSunDisc * sun * pow(max(dot(N, H), 0.0), 220.0) * 2.5; // (the sun's own colour: its reflection)
#ifdef OTH_DESERT
  // the shore line: a soft bright edge where it's a few cm deep
  // (a band in METRES from the waterline — shoreM — and a few cm deep at most: by depth alone a wide flat shallow was a
  //  white pane metres across — the lagoon over the ford in the user's screenshot)
  float foam = (1.0 - smoothstep(0.02, 0.14, depth)) * (1.0 - smoothstep(0.4, 1.6, shoreM));
  if (foam > 0.0) foam *= 0.55 + 0.45 * texture(uNoise, xz / 1.7 + uTime * 0.05).b; // (its read only on the band)
  c = mix(c, vec3(0.9, 0.93, 0.95) * (ambient(vec3(0.0, 1.0, 0.0)) * 1.4 + uSunColor * 0.5 * sun), foam * 0.75);
  float alpha = clamp(smoothstep(0.0, 0.08, depth) * mix(0.55, 0.97, k) + F * 0.5 + foam * 0.5, 0.0, 1.0);
#else
  // THE SHORE (2026-11-08, the user's screenshot — a milky pale band along the beach: "the sides of the water must be
  // properly shaded and look real good"): the water ABSORBS — clear at the edge, the bed showing through darkened and
  // tinted green-teal, deepening to the dark teal (its opacity 1 − e^(−1.4 d): 13 % at 10 cm, 57 % at 60 cm, 94 % at
  // 2 m), never a pale sheet; at the waterline a THIN broken foam line that LAPS in and out (the line's depth rising and
  // falling a few cm, unevenly along the shore) — the bank's wet band is main()'s
  float lap = shoreLap(xz);
  float dl = depth + lap;
  float foam = smoothstep(-0.004, 0.006, dl) * (1.0 - smoothstep(0.012, 0.04, dl)) * (1.0 - smoothstep(0.3, 0.9, shoreM));
  if (foam > 0.0) foam *= (0.35 + 0.65 * smoothstep(0.25, 0.7, texture(uNoise, xz / 7.0 + vec2(uTime * 0.01, 0.0)).r)) * (1.0 - smoothstep(60.0, 140.0, dcam)); // (a soft line, thicker and thinner along the shore — never dashes)
  c = mix(c, vec3(0.86, 0.9, 0.92) * (ambient(vec3(0.0, 1.0, 0.0)) * 1.3 + uSunColor * 0.5 * sun), foam * 0.8);
  float alpha = clamp((1.0 - exp(-max(dl, 0.0) * 1.4)) * 0.97 + F * 0.45 * smoothstep(0.0, 0.05, dl) + foam * 0.6, 0.0, 1.0);
#endif
  return vec4(c, alpha);
}

void main() {
  vec2 xz = vWorld.xz;
#ifdef WC_FLAT
  gl_FragColor = vec4(0.1, 0.4, 0.44, 0.9);
  return;
#endif
#ifdef WC_DEPTH
  float depth = 2.0;
#elif defined(CAVE_POOL)
  float depth = vUV.x;
#else
  float depth = vWorld.y - terrainHeight(xz);
#endif
  // the ground the still water owns (mapPrep.ts waterOwner): the lake and the ponds draw only there, the ribbons only
  // off it — and a ribbon's outer edge fades out (where its bank is under the water: never a straight cut)
  vec4 ow = texture(uOwn, ((xz - uOwnGrid.z) / uOwnGrid.y + 0.5) / uOwnGrid.x);
// (the wet bank above the waterline: the TERRAIN draws it — Terrain.ts uShore; this sheet lies under the bank there)
  if (depth < 0.0) discard;
  // (one or the other — the two looks are one at their seam; a cross-fade of two half-clear layers let the floor
  //  show through, a pale line across the river's mouth)
  float own = step(0.5, ow.r);
#ifdef RAPIDS
  float keep = (1.0 - own) * (1.0 - smoothstep(0.8, 1.0, abs(vUV.z)));
  keep *= 1.0 - vUV.w * smoothstep(0.3, 0.9, ow.a); // (a stream fades out in the river it joins: never a second layer)
  keep *= smoothstep(0.0, 8.0, vUV.x); // (and every ribbon fades in from its source — over a creek running into it, at a fall's foot — never a square cut)
#elif defined(CAVE_POOL)
  float keep = 1.0;
#else
  float keep = own;
#endif
  if (keep < 0.004) discard;
  vec3 V = normalize(uCamPos - vWorld);
#ifdef WC_SUN
  float sun = 1.0;
#else
  float sun = sunVisibility(xz);
#endif
  vec3 light = ambient(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.45 * sun;
  float dcam = length(uCamPos - vWorld);
  // how far (m) to the waterline: the depth over its slope (its change per pixel over the pixel's size, from screen-space
  // derivatives — taken here, in uniform control flow)
  float px = max(length(vec2(dFdx(xz.x), dFdy(xz.x))), length(vec2(dFdx(xz.y), dFdy(xz.y))));
  float shoreM = depth / max(length(vec2(dFdx(depth), dFdy(depth))) / max(px, 1e-4), 0.02);

#ifdef RAPIDS
  // RAPIDS: streaks stretched along the current (u = metres downstream, v = metres across), racing downstream
  float spd = length(vFlow);
  float u = vUV.x - uTime * spd, v = vUV.y;
  float s1 = texture(uNoise, vec2(v / 1.1, u / 11.0) + vec2(0.13, 0.0)).r;
  float s2 = texture(uNoise, vec2(v / 0.45, (u - uTime * spd * 0.6) / 4.2) + vec2(0.57, 0.31)).g;
  float churn = texture(uNoise, xz / 5.0 + uTime * vec2(0.06, -0.045)).b;
  float k = 1.0 - exp(-depth * 0.9);
  // the foam: the streaks, more of them in the shallows (rocks under the surface) and on fast water; the banks and the
  // boulders ringed white
  float rocks = textureLod(uRocks, ((xz - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x, 1.2).r;
  float calm = 1.0 - smoothstep(1.7, 2.6, spd); // (the river ≈ 1.5 m/s: calm; the streams' runs and steps: rapids)
  // (whiter in the shallows only where it runs fast: a calm river spreading shallow into a lagoon was a grey-white sheet)
  float rough = 0.6 * s1 + 0.4 * s2 + (churn - 0.5) * 0.25 + (1.0 - k) * 0.1 * (1.0 - calm) + smoothstep(1.5, 4.0, spd) * 0.1 + rocks * 0.6;
  float foam = smoothstep(0.57 + 0.1 * calm, 0.68 + 0.1 * calm, rough);
  // (the waterline: a thin broken line — white to 22 cm deep, a ford over a track was one grey-white pane)
  foam = max(foam, (1.0 - smoothstep(0.02, 0.09, depth)) * (0.45 + 0.55 * s2));
  // (the streaks blur into an even light blue far away: no shimmer)
  foam = mix(foam, mix(0.3, 0.08, calm), smoothstep(60.0, 260.0, dcam));
  // (and build up over the whole way out of a lake — waterOwner B, ~32 m: a rapid out of it began at a crisp line)
  foam *= 1.0 - smoothstep(0.05, 0.85, ow.b);
#ifdef OTH_DESERT
  vec3 still = mix(G_SHALLOW, G_DEEP, k * 0.75); // (the desert's river: the gueltas' olive where it's calm)
#else
  vec3 still = mix(TEAL, TEAL_DEEP, k * 0.75);
#endif
  vec3 body = mix(mix(RUN, RUN_DEEP, k * 0.6), still, calm) * (0.9 + 0.2 * s1);
  // a little sky on the blue, none on the foam
  vec3 N = normalize(vec3((s1 - 0.5) * 0.25, 1.0, (s2 - 0.5) * 0.25));
  float F = 0.02 + (0.3 + 0.12 * calm) * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyColor(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * mix(vec3(1.0), vec3(0.72, 0.9, 0.95), calm);
  vec3 c = mix(body * light, refl, F * (1.0 - foam));
  c = mix(c, FOAM * (light * 1.15), foam);
  // (clear where shallow: the bed — and a ford's track — shows through the first half metre)
  float alpha = clamp(smoothstep(0.0, 0.05, depth) * max(mix(0.3, 0.97, max(smoothstep(0.0, 0.9, depth), k)), foam * 0.92), 0.0, 1.0);
  // coming to a lake or a pond (waterOwner B: 1 at its shore → 0 32 m off) the river takes the still water's own look —
  // its colour by depth, its ripples, its light — so where they meet (one height: mapPrep.ts reconcileWater) they're one
  float nearS = smoothstep(0.25, 0.8, ow.b); // (all still where they meet — ~5 m off its own ground — none 22 m on)
  if (nearS > 0.002) {
    vec4 st = stillLook(xz, depth, V, sun, dcam, 1.0 - nearS, shoreM);
    c = mix(c, st.rgb, nearS);
    alpha = mix(alpha, st.a, nearS);
  }
#else
  vec4 st = stillLook(xz, depth, V, sun, dcam, 1.0, shoreM);
  vec3 c = st.rgb;
  float alpha = st.a;
#endif
#ifdef CAVE_POOL
  // (in the cave: its dark, as on the rock round it — the sky it mirrors is the roof's, but for the skylight's light)
  float ck = caveK(vWorld);
  c *= 1.0 - 0.8 * ck;
  c += vec3(0.02, 0.05, 0.055) * uAmbSky * ck + vec3(0.05, 0.1, 0.1) * (uSunColor * 0.3 + uAmbSky * 0.3) * caveBounce(vWorld) * ck;
#endif
#ifdef WC_ATMOS
  gl_FragColor = vec4(c, alpha * keep);
#else
  gl_FragColor = vec4(applyAtmos(c, vWorld), alpha * keep);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
