import type { Atmosphere } from './Atmosphere'
import type { Landmark, MapData } from './MapData'
import type { Prop } from './Places'
import type { Rocks } from './Rocks'
import { type CaveStyle, cavernLand, tunnelHill } from './Locations'

/**
 * THE VALLEY'S NEW PLACES (2026-11-06, the user: "a player drives along a mountain road, notices smoke rising behind
 * the trees, leaves the road … discovers an abandoned campsite, an old cabin by a lake, an old vehicle and a strange
 * note"; "caves big enough to drive through, lights on the walls"; "broken houses, hidden places — a terror feel"):
 * where they go, picked ONCE from the map (deterministic — the same valley every session), each by its own rule:
 *
 *   tunnel    a DRIVE-THROUGH cave over a straight stretch of track (a ridge's flank best), 30 m long
 *   grotto    a cave under an overhang at a slope's foot, deep enough to drive into — off the road, hidden
 *   ghost     the HOLLOW HOUSE deep in the forest, far from every track
 *   ruin      two stone house ruins in the meadows and the woods' edges
 *   ranger    a ranger station beside a road, on its high ground
 *   garage    a roadside garage
 *   shelter   lean-tos on the river's banks
 *   hamlet    an abandoned hamlet in a forest clearing
 *   research  a survey camp on the high ground
 *   dock      docks at the ponds no cabin or camp has taken
 *   wreck     a truck lost at a river crossing
 *
 * Each keeps a disc of ground for itself (`keep`: the trees, bushes and stones there are taken out — World.build) and
 * leaves room round the places that were there. A NOTE at some (main.ts shows it when you stop by): a story the places
 * tell between them. Also here: the old landmarks' PADS grown back over (`regrowPads`) and the caves' dark
 * (`caveUniforms`).
 */
export interface SitePlan { sites: Landmark[]; keep: [number, number, number][] }

/** The NOTES — what the places say (by name; the old landmarks' too). */
export const NOTES: Record<string, { title: string; text: string }> = {
  'Survey Camp': { title: 'Field log, day 19', text: 'Readings off the scale again below the north ridge. Ivers says the instruments are fine. They are not fine. We pack up at first light. — the rest of the page is torn out.' },
  'Ranger Station 7': { title: 'Duty board', text: 'SURVEY TEAM OVERDUE 3 DAYS. Last radio contact from the old tunnel road. If found, bring them here. Do NOT follow them into the grotto after dark.' },
  'Lantern Tunnel': { title: 'Scratched into a timber', text: 'The lights were here before the miners. We only built around them.' },
  'Crystal Grotto': { title: 'A notebook by the bedroll', text: 'The crystals hum when the fire goes low. Ivers went further in to listen. I am staying by the light. I am staying by the light.' },
  'The Hollow House': { title: 'Nailed to the door', text: 'WE ARE NOT HOME. — and under it, in another hand: They never left.' },
  'Ashford': { title: 'A water-stained register', text: 'Winter, \'58. The Hollow family stopped coming down to the village. The lamp in their upstairs window kept burning all the same.' },
  'The Drowned Truck': { title: 'A delivery slip on the seat', text: 'Ashford store — paraffin, rope, forty candles. URGENT. Deliver before dark.' },
  "Hank's Garage": { title: 'The workshop calendar', text: 'Every day crossed off but one, circled twice: "Ivers — collect survey truck." It was never collected.' },
  'Kingfisher Shelter': { title: 'Carved into the bench', text: 'Fished this river forty years. Never caught a thing after dark. Never stayed to try.' },
  'Copper Mine': { title: "Foreman's notice", text: 'Shaft 2 is CLOSED by order. Any man hearing tapping below the forty-metre level is to report it — and NOT to tap back.' },
  'Old Hut': { title: 'A letter under the stove', text: 'Hank — the lights are back on the ridge. I\'ve gone to my sister\'s in town. Feed the dog if he comes round. Don\'t go up there.' },
}

/** The places' names. */
const NAME: Partial<Record<Landmark['kind'], string[]>> = {
  tunnel: ['Lantern Tunnel'], grotto: ['Sky Hollow', 'Crystal Grotto', "Bear's Den"], ghost: ['The Hollow House'], ruin: ['Stonewall Ruin', "Miller's Ruin"],
  ranger: ['Ranger Station 7'], garage: ["Hank's Garage"], shelter: ['Kingfisher Shelter', 'River Lean-to'], hamlet: ['Ashford'],
  research: ['Survey Camp'], dock: ['Heron Dock', 'Old Jetty', 'Quiet Pier', "Fisher's Landing"], wreck: ['The Drowned Truck'],
}

/** Where the new places go (the valley only), clear of `taken` (the landmarks and camps there), of the things placed
 *  (props) and of each other. ids from `idBase`. */
export function planSites(map: MapData, rocks: Rocks, props: Prop[], taken: Landmark[], idBase = 1000): SitePlan {
  const sites: Landmark[] = [], keep: [number, number, number][] = []
  if (map.desert) return { sites, keep }
  const half = map.half - 140
  const H = (x: number, z: number) => map.height(x, z)
  const mk: [number, number, number, number] = [0, 0, 0, 0]
  const mask = (x: number, z: number) => map.maskAt(x, z, mk)
  /** Rise and fall across a disc (its rim and half-rim, 16 ways): how far from flat. */
  const relief = (x: number, z: number, r: number) => {
    let lo = Infinity, hi = -Infinity
    for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1]) { const h = H(x + Math.cos(a * 0.3927) * r * f, z + Math.sin(a * 0.3927) * r * f); lo = Math.min(lo, h); hi = Math.max(hi, h) }
    return hi - lo
  }
  const dry = (x: number, z: number, r: number) => {
    for (let a = 0; a < 8; a++) for (const f of [0, 1]) {
      const px = x + Math.cos(a * 0.785) * r * f, pz = z + Math.sin(a * 0.785) * r * f
      if (mask(px, pz)[2] > 0.45 || map.waterLevel(px, pz) !== null || map.mudAt(px, pz) > 0.3 || map.bridgeAt(px, pz) !== null) return false
    }
    return true
  }
  const all = () => [...taken, ...sites]
  const farFrom = (x: number, z: number, d: number) => all().every((l) => (l.x - x) ** 2 + (l.z - z) ** 2 > (d + l.r) ** 2)
  // (the small things — pebbles, logs, stumps — don't hold a place back: World.build clears them off its ground)
  const SMALL = new Set(['stones', 'log', 'stump', 'logs'])
  const big = props.filter((p) => !SMALL.has(p.kind))
  const propClear = (x: number, z: number, r: number) => big.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > r * r)
  // the big stones by 32 m cell (a check per candidate must not read all eleven thousand)
  const RC = 32, rockCells = new Map<number, { x: number; z: number; s: number }[]>()
  for (const k of rocks.all) if (k.s > 2.5) { const key = Math.floor(k.x / RC) * 4096 + Math.floor(k.z / RC); const l = rockCells.get(key); if (l) l.push(k); else rockCells.set(key, [k]) }
  const bigRock = (x: number, z: number, r: number) => {
    for (let i = Math.floor((x - r - 10) / RC); i <= Math.floor((x + r + 10) / RC); i++) for (let j = Math.floor((z - r - 10) / RC); j <= Math.floor((z + r + 10) / RC); j++) {
      for (const k of rockCells.get(i * 4096 + j) ?? []) if ((k.x - x) ** 2 + (k.z - z) ** 2 < (r + k.s * 0.5) ** 2) return true
    }
    return false
  }
  /** The way to the nearest track (rad, as a place's +z: atan2(dx, dz)) — the trackDist's slope, downhill. */
  // (the track's points by 64 m cell: the way to the nearest — map.trackDist saturates a few metres off a track)
  const TC = 64, tcells = new Map<number, [number, number][]>()
  for (const L of map.meta.trails.lines) for (let i = 0; i < L.length - 1; i++) {
    // (each stretch walked every ~6 m: a track's points can lie far apart on a straight)
    const n = Math.max(1, Math.ceil(Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]) / 6))
    for (let k = 0; k < n; k++) {
      const qx = L[i][0] + ((L[i + 1][0] - L[i][0]) * k) / n, qz = L[i][1] + ((L[i + 1][1] - L[i][1]) * k) / n
      const key = Math.floor(qx / TC) * 4096 + Math.floor(qz / TC), c = tcells.get(key)
      if (c) c.push([qx, qz]); else tcells.set(key, [[qx, qz]])
    }
  }
  const toTrackPt = (x: number, z: number) => {
    let best = Infinity, bx = x, bz = z + 1
    for (let i = Math.floor(x / TC) - 2; i <= Math.floor(x / TC) + 2; i++) for (let j = Math.floor(z / TC) - 2; j <= Math.floor(z / TC) + 2; j++) for (const [px, pz] of tcells.get(i * 4096 + j) ?? []) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < best) { best = d; bx = px; bz = pz } }
    return Math.atan2(bx - x, bz - z)
  }
  const toTrack = (x: number, z: number) => { const e = 6, gx = map.trackDist(x + e, z) - map.trackDist(x - e, z), gz = map.trackDist(x, z + e) - map.trackDist(x, z - e); return Math.atan2(-gx, -gz) }
  let s = 0x5173e5
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const add = (kind: Landmark['kind'], x: number, z: number, rot: number, r: number, keepR: number, extra: Partial<Landmark> = {}) => {
    const names = NAME[kind] ?? [kind], n = sites.filter((l) => l.kind === kind).length
    const name = names[n % names.length]
    const l: Landmark = { id: idBase + sites.length, kind, name, x: +x.toFixed(2), z: +z.toFixed(2), y: +H(x, z).toFixed(2), rot: +rot.toFixed(3), r, ...extra }
    if (NOTES[name]) l.note = NOTES[name]
    sites.push(l)
    keep.push([x, z, keepR])
  }
  /** The best of a scan (a jittered grid, `step` m): ok() filters, score() ranks; n picked, `sep` m apart. */
  const pick = (step: number, n: number, sep: number, ok: (x: number, z: number) => boolean, score: (x: number, z: number) => number, place: (x: number, z: number) => void) => {
    const cand: [number, number, number][] = []
    for (let gz = -half; gz < half; gz += step) for (let gx = -half; gx < half; gx += step) {
      const x = gx + rnd() * step, z = gz + rnd() * step
      if (!farFrom(x, z, sep) || !ok(x, z)) continue
      cand.push([x, z, score(x, z)])
    }
    cand.sort((a, b) => b[2] - a[2])
    let got = 0
    for (const [x, z] of cand) { if (got >= n) break; if (!farFrom(x, z, sep)) continue; place(x, z); got++ }
  }
  const sp = map.meta.spawn
  const fromSpawn = (x: number, z: number) => Math.hypot(x - sp.x, z - sp.z)

  // ---- THE TUNNEL: a straight 30 m of track, gentle along, no other track or thing beside it, the land rising on a side
  {
    let best: [number, number, number, number] | null = null
    for (const L of map.meta.trails.lines) for (let i = 1; i < L.length - 2; i++) {
      // the stretch from point i on to the first point 30 m away (the track's points are not evenly spaced)
      let j = i + 1
      while (j < L.length - 1 && Math.hypot(L[j][0] - L[i][0], L[j][1] - L[i][1]) < 30) j++
      const a = L[i], b = L[j]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 28 || len > 46) continue
      // straight: every point between within 1.5 m of the chord
      let straight = true
      for (let k = i + 1; k < j; k++) { const p = L[k]; const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len); const d = Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t)); if (d > 1.5) { straight = false; break } }
      if (!straight) continue
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len
      if (Math.abs(H(b[0], b[1]) - H(a[0], a[1])) / len > 0.1 || Math.abs(mx) > half || Math.abs(mz) > half) continue
      if (!farFrom(mx, mz, 260)) continue
      if (!propClear(mx, mz, 36)) continue // (the hill over it reaches ~30 m: no crate buried under it)
      if (fromSpawn(mx, mz) < 350) continue
      // nothing else beside it: no other track, no water, no bridge, along both walls
      let clear = true
      for (let t = -0.6; t <= 0.6 && clear; t += 0.2) for (const sd of [-1, 1]) {
        const px = mx + ux * len * t - uz * sd * 8.5, pz = mz + uz * len * t + ux * sd * 8.5
        if (map.trailDist(px, pz) < 7.5 || !dry(px, pz, 2) || !dry(mx + ux * len * t, mz + uz * len * t, 1)) clear = false
      }
      if (!clear) continue
      // (best where the road runs between rising ground — the hill over it then meets the land each side)
      const h0 = H(mx, mz), sa = H(mx - uz * 18, mz + ux * 18) - h0, sb = H(mx + uz * 18, mz - ux * 18) - h0
      // (no cliff, no bare rock beside it: the hill must be the land's, rounded and grassed, seen from round about)
      let soft = Math.max(sa, sb) < 11
      for (const d of [10, 20, 30]) for (const sd of [-1, 1]) for (const t of [-0.5, 0, 0.5]) {
        const px = mx + ux * len * t - uz * sd * d, pz = mz + uz * len * t + ux * sd * d
        if (mask(px, pz)[0] > 0.25 || Math.abs(H(px, pz) - h0) > 12) soft = false
      }
      if (!soft) continue
      const score = Math.min(Math.min(sa, sb), 6) + 0.3 * Math.min(Math.max(sa, sb), 8) - fromSpawn(mx, mz) / 3000
      if (!best || score > best[3]) best = [mx, mz, Math.atan2(ux, uz), score]
    }
    if (best) {
      const [x, z, rot] = best, Lt = 30
      add('tunnel', x, z, rot, 16, 0, { dark: { z0: -Lt / 2 - 1, z1: Lt / 2 + 1, r: 7.0, top: 11.0 } })
      keep.pop()
      for (let t = -Lt / 2 - 3; t <= Lt / 2 + 3; t += 4) keep.push([x + Math.sin(rot) * t, z + Math.cos(rot) * t, 10.5])
      // (the road's cut through the hill beyond each mouth)
      for (const e of [-1, 1]) for (let t = Lt / 2 + 6; t <= Lt / 2 + 32; t += 4) keep.push([x + Math.sin(rot) * t * e, z + Math.cos(rot) * t * e, 8.5])
    }
  }
  // ---- THE CAVES (2026-11-06, the user: "bigger, different shapes, one way in, no way out; big ones with pines inside
  //  and a small opening in the top — no two the same"): three, each its own make (Locations.cavern) in its own HILL —
  //  the mouth toward a track 22–70 m off, the hill's ground (≈ 60 × 60 m behind it) dry, no track or big thing on it
  for (const [style, name] of [['sky', 'Sky Hollow'], ['hall', 'Crystal Grotto'], ['den', "Bear's Den"]] as [CaveStyle, string][]) {
    const id = idBase + sites.length, seed = (id * 7919 + 13) >>> 0
    const spanX = (style === 'sky' ? 19 : style === 'hall' ? 11 : 8) + 14, back = style === 'sky' ? 52 : style === 'hall' ? 62 : 32
    pick(30, 1, 300, (x, z) => {
      const td = map.trackDist(x, z)
      if (td < 22 || td > 70 || !dry(x, z, 10) || bigRock(x, z, 14) || !propClear(x, z, Math.max(spanX, back) + 4)) return false
      const rot = toTrackPt(x, z), sn = Math.sin(rot), cs = Math.cos(rot)
      let lo = Infinity, hi = -Infinity
      for (let lz = 0; lz >= -back; lz -= 8) for (let lx = -spanX; lx <= spanX; lx += 8) {
        const px = x + lx * cs + lz * sn, pz = z - lx * sn + lz * cs, h = H(px, pz)
        if (map.trackDist(px, pz) < 8 || mask(px, pz)[2] > 0.45 || map.waterLevel(px, pz) !== null || map.bridgeAt(px, pz) !== null) return false
        lo = Math.min(lo, h); hi = Math.max(hi, h)
      }
      return hi - lo < 14
    }, (x, z) => {
      // (best where the land already climbs behind it — the hill joins a slope — and where there's forest about)
      const rot = toTrackPt(x, z), bx = x - Math.sin(rot) * 30, bz = z - Math.cos(rot) * 30
      return Math.min(H(bx, bz) - H(x, z), 8) * 0.6 + mask(x, z)[3] * 2 - relief(x, z, 8) * 0.5 - Math.abs(map.trackDist(x, z) - 35) / 20
    }, (x, z) => {
      const rot = toTrackPt(x, z), sn = Math.sin(rot), cs = Math.cos(rot)
      const y0 = H(x, z), g = (lx: number, lz: number) => H(x + lx * cs + lz * sn, z - lx * sn + lz * cs) - y0
      const land = cavernLand(style, seed, g), sp = land.spec
      add('grotto', x, z, rot, 12, 0, { name, style, dark: { z0: 0, z1: land.zc, r: Math.max(sp.Rx, sp.Rz) + 1, top: land.yc + sp.Ry + 6, sky: sp.sky ? sp.sky * 1.2 : undefined } })
      keep.pop()
      // (what stood in the passage and the chamber goes; what stood on the hill is lifted onto it: dressHills)
      for (let t = 18; t >= land.zc + sp.Rz; t -= 3) keep.push([x + sn * t, z + cs * t, sp.aw + (t > 0 ? 4 : 3)]) // (its approach clear too)
      for (let t = land.zc + sp.Rz * 0.6; t >= land.zc - sp.Rz * 0.6; t -= sp.Rz * 0.4) keep.push([x + sn * t, z + cs * t, Math.max(sp.Rx, sp.Rz * 0.6) + 2])
    })
  }
  // ---- THE HOLLOW HOUSE: deep in the forest, as far from the tracks as the map will say (≥ 40 m), flat enough
  pick(28, 1, 380, (x, z) => map.trackDist(x, z) > 40 && relief(x, z, 11) < 2.2 && dry(x, z, 12) && mask(x, z)[0] < 0.3 && !bigRock(x, z, 12),
    (x, z) => { let f = 0; for (let a = 0; a < 8; a++) f += mask(x + Math.cos(a * 0.785) * 28, z + Math.sin(a * 0.785) * 28)[3]; return f - relief(x, z, 11) * 0.5 },
    (x, z) => add('ghost', x, z, toTrack(x, z), 14, 18))
  // ---- THE HAMLET: a broad clearing at the forest's edge, off the road
  pick(32, 1, 300, (x, z) => map.trackDist(x, z) > 34 && relief(x, z, 22) < 4.0 && dry(x, z, 22) && mask(x, z)[0] < 0.25 && !bigRock(x, z, 20),
    (x, z) => { let f = 0; for (let a = 0; a < 8; a++) f += mask(x + Math.cos(a * 0.785) * 34, z + Math.sin(a * 0.785) * 34)[3]; return Math.min(f, 4) - relief(x, z, 22) * 0.6 },
    (x, z) => add('hamlet', x, z, toTrack(x, z), 24, 28))
  // ---- THE SURVEY CAMP: on the high ground near a track
  pick(30, 1, 280, (x, z) => { const td = map.trackDist(x, z); return td > 16 && td < 46 && relief(x, z, 10) < 2.4 && dry(x, z, 10) && !bigRock(x, z, 9) },
    (x, z) => H(x, z) - relief(x, z, 10) * 3, (x, z) => add('research', x, z, toTrack(x, z), 10, 12))
  // ---- THE RANGER STATION: beside a road (seen from it), on a rise
  pick(22, 1, 220, (x, z) => { const td = map.trackDist(x, z); return td > 12 && td < 28 && relief(x, z, 10) < 2.4 && dry(x, z, 10) && !bigRock(x, z, 10) && propClear(x, z, 14) },
    (x, z) => H(x, z) * 0.05 - relief(x, z, 10) * 2 - Math.abs(fromSpawn(x, z) - 900) / 600, (x, z) => add('ranger', x, z, toTrack(x, z), 10, 13))
  // ---- THE GARAGE: by a road, on the low ground
  pick(22, 1, 220, (x, z) => { const td = map.trackDist(x, z); return td > 12 && td < 24 && relief(x, z, 11) < 2.0 && dry(x, z, 11) && !bigRock(x, z, 11) && propClear(x, z, 16) },
    (x, z) => -H(x, z) * 0.03 - relief(x, z, 11) * 3, (x, z) => add('garage', x, z, toTrack(x, z), 11, 14))
  // ---- THE RUINS: open ground, the woods' edge, off the road
  pick(30, 2, 360, (x, z) => map.trackDist(x, z) > 30 && relief(x, z, 8) < 1.8 && dry(x, z, 9) && !bigRock(x, z, 9),
    (x, z) => { const f = mask(x, z)[3]; return 1 - Math.abs(f - 0.35) * 2 - relief(x, z, 8) * 0.5 + rnd() * 0.3 }, (x, z) => add('ruin', x, z, rnd() * 6.283, 8, 10))
  // ---- THE RIVER SHELTERS: on the river's banks, flat, facing the water
  pick(16, 2, 350, (x, z) => { const rd = map.riverDist(x, z); return rd > 9 && rd < 20 && map.trackDist(x, z) > 16 && relief(x, z, 5) < 1.0 && dry(x, z, 5) && !bigRock(x, z, 6) },
    (x, z) => -relief(x, z, 5) + rnd() * 0.5, (x, z) => {
      const e = 4, gx = map.riverDist(x + e, z) - map.riverDist(x - e, z), gz = map.riverDist(x, z + e) - map.riverDist(x, z - e)
      add('shelter', x, z, Math.atan2(-gx, -gz), 6, 7)
    })
  // ---- THE DOCKS: the ponds no landmark or camp is near — from the bank nearest a track, out toward the middle
  for (const P of map.meta.water.ponds ?? []) {
    if (sites.filter((l) => l.kind === 'dock').length >= 4) break
    if (Math.max(P.rx, P.rz) < 18 || !farFrom(P.cx, P.cz, 70 + Math.max(P.rx, P.rz))) continue
    const a = toTrack(P.cx, P.cz)
    let sx = P.cx, sz = P.cz, ok = false
    for (let d = 4; d < Math.max(P.rx, P.rz) * 1.6; d += 1) { sx = P.cx + Math.sin(a) * d; sz = P.cz + Math.cos(a) * d; if (H(sx, sz) > P.level + 0.3) { ok = true; break } }
    if (!ok || !propClear(sx, sz, 8)) continue
    add('dock', sx, sz, a + Math.PI, 6, 6, { style: String(P.level) })
  }
  // ---- THE WRECK: where a track fords the river, a little way down the bank
  {
    let done = false
    for (const L of map.meta.trails.lines) {
      if (done) break
      for (let i = 0; i < L.length && !done; i += 2) {
        const [x0, z0] = L[i]
        if (map.riverDist(x0, z0) > 3 || map.bridgeAt(x0, z0) !== null) continue
        for (let a = 0; a < 12 && !done; a++) {
          const x = x0 + Math.cos(a * 0.5236) * 14, z = z0 + Math.sin(a * 0.5236) * 14, rd = map.riverDist(x, z)
          if (rd < 2 || rd > 7 || map.trailDist(x, z) < 7 || !farFrom(x, z, 200) || !propClear(x, z, 10)) continue
          const wl = map.waterLevel(x0, z0) ?? H(x0, z0)
          add('wreck', x, z, a * 0.5236, 6, 7, { style: String(wl) })
          done = true
        }
      }
    }
  }
  return { sites, keep }
}

/** THE PADS GROWN BACK (2026-11-06 — scenery.mjs levelled each landmark's pad and painted it TRACK: a bald sand disc
 *  under every building): their ground is the real tracks' again (the distance to the tracks' centre lines, worked out
 *  afresh), a worn YARD before the door and a PATH from it to the nearest track; the rest grows grass. Into the trail
 *  texture (MapData.trailTex) after everything is placed (nothing moves). */
export function regrowPads(map: MapData, landmarks: Landmark[]): void {
  if (map.desert) return
  const g = map.inner, tex = map.trailTex.image.data as Uint8Array, hw = map.meta.trails.hw
  const lines = map.meta.trails.lines
  const KINDS = new Set(['cabin', 'shack', 'sawmill', 'mine', 'tower', 'view', 'meteorite'])
  const yardR: Record<string, number> = { cabin: 2.6, shack: 2.2, sawmill: 9, mine: 4.5, tower: 3.5, view: 3, meteorite: 0 }
  for (const l of landmarks) {
    if (!KINDS.has(l.kind)) continue
    const R = l.r + 9
    // the tracks' segments near it
    const segs: number[] = []
    for (const L of lines) for (let i = 0; i < L.length - 1; i++) {
      const [ax, az] = L[i], [bx, bz] = L[i + 1]
      if (Math.min(Math.hypot(ax - l.x, az - l.z), Math.hypot(bx - l.x, bz - l.z)) < R + 60) segs.push(ax, az, bx, bz)
    }
    const segD = (x: number, z: number) => {
      let best = 1e9
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i], az = segs[i + 1], dx = segs[i + 2] - ax, dz = segs[i + 3] - az, L2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t))
      }
      return best
    }
    // the door's yard (in front, +z) and the path from it to the nearest track point
    const cs = Math.cos(l.rot), sn = Math.sin(l.rot), fz = l.kind === 'cabin' ? 6.4 : l.kind === 'shack' ? 4 : 2
    const yx = l.x + fz * sn, yz = l.z + fz * cs, yr = yardR[l.kind] ?? 2.5
    let px = yx, pz = yz, pd = 1e9
    for (let i = 0; i < segs.length; i += 4) for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = segs[i] + (segs[i + 2] - segs[i]) * t, z = segs[i + 1] + (segs[i + 3] - segs[i + 1]) * t, d = Math.hypot(x - yx, z - yz)
      if (d < pd) { pd = d; px = x; pz = z }
    }
    const pathD = (x: number, z: number) => {
      const dx = px - yx, dz = pz - yz, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - yx) * dx + (z - yz) * dz) / L2))
      return Math.hypot(x - yx - dx * t, z - yz - dz * t)
    }
    const i0 = Math.max(0, Math.floor((l.x - R - g.origin) / g.step)), i1 = Math.min(g.n - 1, Math.ceil((l.x + R - g.origin) / g.step))
    const j0 = Math.max(0, Math.floor((l.z - R - g.origin) / g.step)), j1 = Math.min(g.n - 1, Math.ceil((l.z + R - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * g.step, z = g.origin + j * g.step
      if (Math.hypot(x - l.x, z - l.z) > R) continue
      // (as a distance from a track's centre line: the ground paint draws a track where it's under hw)
      let d = segD(x, z)
      if (pd < 70) d = Math.min(d, pathD(x, z) + hw - 1.0)          // the path: ~2 m wide
      if (yr > 0) d = Math.min(d, Math.hypot(x - yx, z - yz) - yr + hw) // the yard
      const v = Math.round(Math.min(1, Math.max(0, d / 8)) * 255)
      const k = j * g.n + i
      // (on the old pad: the ground as worked out here; past it only the path and yard are added — whatever else the
      //  trail texture holds there stays)
      tex[k] = Math.hypot(x - l.x, z - l.z) < l.r + 7.5 ? v : Math.min(tex[k], v)
    }
  }
  map.trailTex.needsUpdate = true
}

/** The caves' DARK for this world (Atmosphere caveK): each tunnel / grotto's line, radius and roof; none in the desert. */
export function caveUniforms(atmos: Atmosphere, landmarks: Landmark[], cam?: { x: number; z: number }): void {
  const u = atmos.uniforms
  const A = [u.uCaveA0.value, u.uCaveA1.value, u.uCaveA2.value], B = [u.uCaveB0.value, u.uCaveB1.value, u.uCaveB2.value]
  for (const v of B) v.set(0, 0, 0, 0)
  // (the shader has three: the three nearest the camera — every frame, a handful of places)
  const caves = landmarks.filter((l) => l.dark)
  if (cam && caves.length > A.length) caves.sort((p, q) => (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 - (q.x - cam.x) ** 2 - (q.z - cam.z) ** 2)
  for (let i = 0; i < Math.min(A.length, caves.length); i++) {
    const l = caves[i], sn = Math.sin(l.rot), cs = Math.cos(l.rot), d = l.dark!
    A[i].set(l.x + sn * d.z0, l.z + cs * d.z0, l.x + sn * d.z1, l.z + cs * d.z1)
    B[i].set(d.r, l.y + d.top, l.kind === 'grotto' ? 1 : 0, d.sky ?? 0)
  }
}

/** THE TUNNEL'S HILL DRESSED (2026-11-06): the trees and bushes that stood where its hill now is lifted onto it (a
 *  tree's foot back on the turf, not buried), and a few more pines / bushes on its crest from the kinds that grow round
 *  it — the land over the cave reads as land. Returns the new arrays (same strides). */
export function dressHills(map: MapData, sites: Landmark[], trees: Float32Array, TS: number, bushes: Float32Array, BS: number): { trees: Float32Array; bushes: Float32Array } {
  const tl = Array.from(trees), bl = Array.from(bushes)
  for (const l of sites) {
    if (l.kind !== 'tunnel' && l.kind !== 'grotto') continue
    const cr = Math.cos(l.rot), sr = Math.sin(l.rot)
    const g = (lx: number, lz: number) => map.height(l.x + lx * cr + lz * sr, l.z - lx * sr + lz * cr) - l.y
    const cave = l.kind === 'grotto' ? cavernLand((l.style ?? 'hall') as CaveStyle, (l.id * 7919 + 13) >>> 0, g) : null
    const hill = cave ? { X: cave.X, Z: -cave.zb, Zp: -cave.zc, y: cave.y } : tunnelHill(l.dark ? l.dark.z1 - l.dark.z0 - 2 : 30, g)
    const local = (x: number, z: number) => { const dx = x - l.x, dz = z - l.z; return [dx * cr - dz * sr, dx * sr + dz * cr] }
    const R2 = (hill.X + hill.Z) ** 2
    const lift = (a: number[], S: number, sink: (i: number) => number) => {
      const near: number[] = []
      for (let i = 0; i < a.length; i += S) {
        if ((a[i] - l.x) ** 2 + (a[i + 2] - l.z) ** 2 > R2) continue
        near.push(i)
        const [lx, lz] = local(a[i], a[i + 2]), y = hill.y(lx, lz)
        if (y === null || y - g(lx, lz) < 0.2) continue
        a[i + 1] = l.y + y - sink(i)
      }
      return near
    }
    const nearT = lift(tl, TS, () => 0.3), nearB = lift(bl, BS, (i) => 0.12 * bl[i + 3])
    // more on the crest, of the kinds round it (none where none grow)
    let s = (l.id * 2654435761) >>> 0
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const spot = (minX: number) => {
      for (let t = 0; t < 12; t++) {
        const lx = (rnd() < 0.5 ? -1 : 1) * (minX + (16 - minX) * rnd()), lz = cave ? cave.zb * 0.15 + (cave.zc - cave.zb * 0.15) * 2 * rnd() : (rnd() - 0.5) * 2 * (hill.Zp + 4), y = hill.y(lx, lz)
        if (y !== null && y - g(lx, lz) > 2) return { x: l.x + lx * cr + lz * sr, z: l.z - lx * sr + lz * cr, y: l.y + y }
      }
      return null
    }
    const pines = nearT.filter((i) => tl[i + 5] < 2)
    const fromT = pines.length ? pines : nearT
    // (pines on top whatever grows round it — the reference's; spruce 11–16 m where there are none to copy)
    for (let k = 0; k < 6; k++) {
      const p = spot(2.5), src = fromT.length ? fromT[Math.floor(rnd() * fromT.length)] : -1
      if (!p) continue
      tl.push(p.x, p.y - 0.3, p.z, src >= 0 ? tl[src + 3] * (0.7 + 0.3 * rnd()) : 11 + 5 * rnd(), rnd() * 6.283, src >= 0 ? tl[src + 5] : 0, rnd(), rnd())
    }
    for (let k = 0; nearB.length && k < 14; k++) {
      const p = spot(1.5), src = nearB[Math.floor(rnd() * nearB.length)]
      if (!p) continue
      const size = bl[src + 3]
      bl.push(p.x, p.y - 0.12 * size, p.z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
    }
    // THE SKYLIGHT'S GARDEN: young pines and ferny bushes on the chamber's floor in the shaft of light
    if (cave && cave.spec.sky > 0) {
      const R = cave.spec.sky * 0.9, at = (lx: number, lz: number) => ({ x: l.x + lx * cr + lz * sr, z: l.z - lx * sr + lz * cr })
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.283, d = R * Math.sqrt(rnd()), p = at(Math.sin(a) * d, cave.zc + Math.cos(a) * d)
        tl.push(p.x, map.height(p.x, p.z) - 0.3, p.z, 3.5 + 3.5 * rnd(), rnd() * 6.283, 0, rnd(), rnd())
      }
      const kinds = nearB.length ? nearB : []
      for (let k = 0; kinds.length && k < 6; k++) {
        const a = rnd() * 6.283, d = R * 1.2 * Math.sqrt(rnd()), p = at(Math.sin(a) * d, cave.zc + Math.cos(a) * d), src = kinds[Math.floor(rnd() * kinds.length)], size = bl[src + 3] * 0.8
        bl.push(p.x, map.height(p.x, p.z) - 0.12 * size, p.z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
      }
    }
  }
  return { trees: new Float32Array(tl), bushes: new Float32Array(bl) }
}
