import type { Atmosphere } from './Atmosphere'
import type { Landmark, MapData } from './MapData'
import type { Prop } from './Places'
import type { Rocks } from './Rocks'
import { CAVE_PROPS, type CaveMeta, caveFrame, caveTop, inCaveFoot } from './CaveWorld'

/**
 * THE VALLEY'S NEW PLACES (2026-11-06, the user: "a player drives along a mountain road, notices smoke rising behind
 * the trees, leaves the road … discovers an abandoned campsite, an old cabin by a lake, an old vehicle and a strange
 * note"; "caves big enough to drive through, lights on the walls"; "broken houses, hidden places — a terror feel"):
 * where they go, picked ONCE from the map (deterministic — the same valley every session), each by its own rule:
 *
 *   cave      SKY HOLLOW — the cave world (2026-11-07, CaveWorld.ts: Blender's, one): a great grassed hill, its mouth
 *             toward a track, a cave to explore inside it (the procedural tunnel and three grottos it replaces are gone)
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
  'Ranger Station 7': { title: 'Duty board', text: 'SURVEY TEAM OVERDUE 3 DAYS. Last radio contact from the hill they call Sky Hollow. If found, bring them here. Do NOT follow them into the cave after dark.' },
  'Sky Hollow': { title: 'Scratched into the rock by the light', text: 'Ivers went on past the great hall to see where the passage goes. I am staying by the light. I am staying by the light.' },
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
  cave: ['Sky Hollow'], ghost: ['The Hollow House'], ruin: ['Stonewall Ruin', "Miller's Ruin"],
  ranger: ['Ranger Station 7'], garage: ["Hank's Garage"], shelter: ['Kingfisher Shelter', 'River Lean-to'], hamlet: ['Ashford'],
  research: ['Survey Camp'], dock: ['Heron Dock', 'Old Jetty', 'Quiet Pier', "Fisher's Landing"], wreck: ['The Drowned Truck'],
}

/** Where the new places go (the valley only), clear of `taken` (the landmarks and camps there), of the things placed
 *  (props) and of each other. ids from `idBase`. */
export function planSites(map: MapData, rocks: Rocks, props: Prop[], taken: Landmark[], idBase = 1000, cave: CaveMeta | null = null): SitePlan {
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

  // ---- THE CAVE WORLD (2026-11-07 — CaveWorld.ts, the user: "use this; make sure it's perfectly suited"): FIRST, the
  //  biggest — its hill's apron ~250 × 215 m. The mouth 22–90 m off a track and facing it; over the whole apron no
  //  track (but before the mouth), no water, no bridge, no bare cliff, no big thing; the land under it within 24 m of
  //  level (the hill is laid on it: CaveWorld) — gentle best, forest about best
  if (cave) {
    const f = cave.foot
    const fits = (x: number, z: number) => {
      const td = map.trackDist(x, z)
      if (td < 22 || td > 90 || fromSpawn(x, z) < 400 || !dry(x, z, 8)) return false
      const rot = toTrackPt(x, z), l = { x, z, rot } as Landmark, { wx, wz } = caveFrame(l)
      if (!farFrom(wx(f.cx, f.cz), wz(f.cx, f.cz), Math.max(f.rx, f.rz) + 20)) return false
      let lo = Infinity, hi = -Infinity
      for (let lz = f.cz - f.rz; lz <= f.cz + f.rz; lz += 12) for (let lx = -f.rx; lx <= f.rx; lx += 12) {
        if (!inCaveFoot(cave, lx, lz)) continue
        const px = wx(lx, lz), pz = wz(lx, lz)
        if (Math.abs(px) > half - 40 || Math.abs(pz) > half - 40) return false
        if (lz < -6 && map.trackDist(px, pz) < 10) return false
        if (map.waterLevel(px, pz) !== null || map.bridgeAt(px, pz) !== null || mask(px, pz)[2] > 0.55) return false
        const h = H(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h)
      }
      if (hi - lo > 24) return false
      const { local } = caveFrame(l)
      return big.every((p) => { const [lx, lz] = local(p.x, p.z); return !inCaveFoot(cave, lx, lz, 4) })
    }
    pick(48, 1, 400, fits, (x, z) => {
      const rot = toTrackPt(x, z), l = { x, z, rot } as Landmark, { wx, wz } = caveFrame(l), cx = wx(f.cx, f.cz), cz = wz(f.cx, f.cz)
      return -relief(cx, cz, 90) * 0.35 - Math.abs(map.trackDist(x, z) - 45) / 15 + mask(cx, cz)[3] * 2
    }, (x, z) => {
      const rot = toTrackPt(x, z), l = { x, z, rot } as Landmark, { wx, wz } = caveFrame(l)
      // (its dark in two reaches — the mouth to the skylight, the skylight to the far chamber and the loop — each 62 m
      //  wide: inside the hill, never out over the land beside it; the first ~26 m of the way in still in daylight)
      add('cave', x, z, rot, 24, 0, {
        dark: { z0: 0, z1: cave.sky[1], x1: cave.sky[0], r: 62, top: cave.dark.top, sky: cave.sky[2] * 1.3, fade: 26 },
        dark2: cave.sky2 ? { x0: cave.sky[0], z0: cave.sky[1], x1: cave.sky2[0], z1: cave.sky2[1], r: 62, top: cave.dark.top, fade: 9, sky: cave.sky2[2] * 1.3 }
          : { x0: cave.sky[0], z0: cave.sky[1], x1: 40, z1: cave.sky[1] - 40, r: 62, top: cave.dark.top, fade: 9 },
        ...(cave.haven ? { dark3: { x0: cave.sky[0], z0: cave.sky[1], x1: cave.haven[0], z1: cave.haven[2], r: 40, top: cave.dark.top, fade: 9 } } : {}),
      })
      keep.pop()
      // (everything on its ground goes — the trees on the hill are planted again on its top: dressHills; the way to its
      //  mouth clear too)
      for (let lz = f.cz - f.rz + 20; lz <= f.cz + f.rz - 10; lz += 20) for (let lx = -f.rx + 15; lx <= f.rx - 15; lx += 20) {
        if (inCaveFoot(cave, lx, lz, -8)) keep.push([wx(lx, lz), wz(lx, lz), 16])
      }
      for (let t = 4; t <= 26; t += 4) keep.push([wx(0, t), wz(0, t), 6])
      // (the hill takes the whole apron: nothing else on it)
      taken.push({ id: -1, kind: 'cave', name: '', rot, y: 0, r: Math.max(f.rx, f.rz), x: wx(f.cx, f.cz), z: wz(f.cx, f.cz) })
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
      const k = (j * g.n + i) * 4 // (R of the RGBA8: G the paving, B A the mud)
      // (on the old pad: the ground as worked out here; past it only the path and yard are added — whatever else the
      //  trail texture holds there stays)
      tex[k] = Math.hypot(x - l.x, z - l.z) < l.r + 7.5 ? v : Math.min(tex[k], v)
    }
  }
  map.trailTex.needsUpdate = true
}

/** The caves' DARK for this world (Atmosphere caveK): each cave's line (mouth → its far point), radius, roof, how far in
 *  from the mouth it comes on; none in the desert. */
const CAVES = new WeakMap<Landmark[], { n: number; caves: [Landmark, NonNullable<Landmark['dark']>][] }>()
export function caveUniforms(atmos: Atmosphere, landmarks: Landmark[], cam?: { x: number; z: number }): void {
  const u = atmos.uniforms
  const A = [u.uCaveA0.value, u.uCaveA1.value, u.uCaveA2.value], B = [u.uCaveB0.value, u.uCaveB1.value, u.uCaveB2.value]
  for (const v of B) v.set(0, 0, 0, 0)
  // (the shader has three: the three nearest the camera — every frame, a handful of places)
  // (the caves' list made once per list — 2026-11-12: rebuilt every frame it allocated three arrays a place, and with the
  //  Wardens' 500 ruins among the places that was ~0.1–0.3 ms a frame in the collector)
  let hit = CAVES.get(landmarks)
  if (!hit || hit.n !== landmarks.length) {
    hit = { n: landmarks.length, caves: landmarks.flatMap((l) => [l.dark ? [l, l.dark] : null, l.dark2 ? [l, l.dark2] : null, l.dark3 ? [l, l.dark3] : null].filter((e) => e !== null)) as [Landmark, NonNullable<Landmark['dark']>][] }
    CAVES.set(landmarks, hit)
  }
  const caves = hit.caves
  if (cam && caves.length > A.length) caves.sort(([p], [q]) => (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 - (q.x - cam.x) ** 2 - (q.z - cam.z) ** 2)
  for (let i = 0; i < Math.min(A.length, caves.length); i++) {
    const [l, d] = caves[i], sn = Math.sin(l.rot), cs = Math.cos(l.rot)
    const x0 = d.x0 ?? 0, x1 = d.x1 ?? 0
    A[i].set(l.x + x0 * cs + sn * d.z0, l.z - x0 * sn + cs * d.z0, l.x + x1 * cs + sn * d.z1, l.z - x1 * sn + cs * d.z1)
    // (B.z: the far end closed (> 0) and the fade in from the mouth, its metres / 9)
    B[i].set(d.r, l.y + d.top, (d.fade ?? 9) / 9, d.sky ?? 0)
  }
}

/** THE CAVE'S HILL DRESSED (2026-11-07 — CaveWorld.ts; the user: "on top of it some trees; inside, grass and some
 *  pine trees where the light gets"): what stood on its ground is gone (World.build's keep — and here every tree and
 *  bush in its apron, to the last), and on its TOP new ones of the kinds growing round it — in a few stands, never on
 *  its bare steep, none where it's under ~2.5 m (its foot: the field's own trees reach it there); in the GARDEN under
 *  the skylight, young pines and a few bushes on the cave's floor. Heights as CaveWorld lays it: the land's + its own.
 *  Returns the new arrays (same strides). */
export function dressHills(map: MapData, sites: Landmark[], trees: Float32Array, TS: number, bushes: Float32Array, BS: number, cave: CaveMeta | null = null): { trees: Float32Array; bushes: Float32Array } {
  let tl = Array.from(trees), bl = Array.from(bushes)
  for (const l of sites) {
    if (l.kind !== 'cave' || !cave) continue
    const { wx, wz, local } = caveFrame(l), f = cave.foot
    const cx = wx(f.cx, f.cz), cz = wz(f.cx, f.cz), R2 = (Math.max(f.rx, f.rz) + 40) ** 2
    // (the kinds round it: what grows within 60 m of its apron)
    const nearT: number[] = [], nearB: number[] = []
    const strip = (a: number[], S: number, near: number[]) => {
      const out: number[] = []
      for (let i = 0; i < a.length; i += S) {
        const d2 = (a[i] - cx) ** 2 + (a[i + 2] - cz) ** 2
        if (d2 < R2) {
          const [lx, lz] = local(a[i], a[i + 2])
          if (inCaveFoot(cave, lx, lz)) continue
          if (inCaveFoot(cave, lx, lz, 60)) near.push(out.length)
        }
        for (let k = 0; k < S; k++) out.push(a[i + k])
      }
      return out
    }
    tl = strip(tl, TS, nearT); bl = strip(bl, BS, nearB)
    let s = (l.id * 2654435761) >>> 0
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    // a spot on its top: high enough, not steep
    const onTop = (lx: number, lz: number) => {
      const h = caveTop(cave, lx, lz), hx = caveTop(cave, lx + 2, lz), hz = caveTop(cave, lx, lz + 2)
      if (h === null || hx === null || hz === null || h < 2.5 || Math.hypot(hx - h, hz - h) / 2 > 0.55) return null
      const x = wx(lx, lz), z = wz(lx, lz)
      return { x, z, y: map.height(x, z) + h }
    }
    // STANDS (the user: "put pine trees and all"): 11 groups of 4–10 trees on the top — mostly PINES (spruce), the
    //  kinds round it among them — and bushes about them
    for (let g = 0; g < 11; g++) {
      let c: { lx: number; lz: number } | null = null
      for (let t = 0; t < 40 && !c; t++) { const lx = (rnd() * 2 - 1) * f.rx * 0.75, lz = f.cz + (rnd() * 2 - 1) * f.rz * 0.75; if (onTop(lx, lz)) c = { lx, lz } }
      if (!c) continue
      const n = 4 + Math.floor(rnd() * 7)
      for (let k = 0; k < n; k++) {
        const a = rnd() * 6.283, d = 3 + rnd() * 14, p = onTop(c.lx + Math.cos(a) * d, c.lz + Math.sin(a) * d)
        if (!p) continue
        const src = nearT.length && rnd() < 0.25 ? nearT[Math.floor(rnd() * nearT.length)] : -1
        tl.push(p.x, p.y - 0.3, p.z, src >= 0 ? tl[src + 3] * (0.7 + 0.35 * rnd()) : 9 + 7 * rnd(), rnd() * 6.283, src >= 0 ? tl[src + 5] : 0, rnd(), rnd())
      }
      for (let k = 0; nearB.length && k < 6; k++) {
        const a = rnd() * 6.283, d = 2 + rnd() * 16, p = onTop(c.lx + Math.cos(a) * d, c.lz + Math.sin(a) * d)
        if (!p) continue
        const src = nearB[Math.floor(rnd() * nearB.length)], size = bl[src + 3]
        bl.push(p.x, p.y - 0.12 * size, p.z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
      }
    }
    // THE GARDEN: young pines on the cave's floor in the light, a few bushes
    for (const [lx, ly, lz] of cave.pines) {
      const x = wx(lx, lz), z = wz(lx, lz)
      tl.push(x, map.height(x, z) + ly - 0.3, z, 4 + 3 * rnd(), rnd() * 6.283, 0, rnd(), rnd())
    }
    // TREES INSIDE (the user: "trees — like a different place"): where it's tall enough, most spruce, some birch and aspen
    for (const [lx, ly, lz, room] of cave.innerTrees ?? []) {
      const x = wx(lx, lz), z = wz(lx, lz), k = rnd(), sp = k < 0.6 ? 0 : k < 0.8 ? 3 : k < 0.93 ? 4 : 5
      tl.push(x, map.height(x, z) + ly - 0.3, z, Math.min(room, (sp === 0 ? 8 : 7) + 6 * rnd()), rnd() * 6.283, sp, rnd(), rnd())
    }
    // THE CAVE'S FLOOR (the user: "add some bushes — make the cave inside beautifully full"): bushes on its spots (the
    //  first CAVE_PROPS hold its broken things and bones — CaveWorld)
    for (const [lx, ly, lz] of (cave.floorBushes ?? []).slice(CAVE_PROPS)) {
      if (!nearB.length) break
      const x = wx(lx, lz), z = wz(lx, lz), src = nearB[Math.floor(rnd() * nearB.length)], size = bl[src + 3] * (0.75 + 0.4 * rnd())
      bl.push(x, map.height(x, z) + ly - 0.12 * size, z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
    }
    // BUSHES ROUND THE MOUTH'S STONES (2026-11-08, the user: "grass, bushes — our goal is to hide all the patches"): a
    //  cluster round the outside of the boulders at the mouth's foot, both sides, never on the car's way in
    for (const [lx0, lz0] of [[-10.5, 9], [-8.5, 12], [-5.5, 12.6], [-12, 5.5], [-9.5, 3], [5.6, 12.6], [8.8, 12.4], [11.8, 12.2], [14.6, 12], [18.4, 11.4], [20, 8], [18.5, 4.5], [15.5, 2.5]]) {
      if (!nearB.length) break
      for (let q = 0; q < 2; q++) {
        const lx = lx0 + (rnd() - 0.5) * 2.2, lz = lz0 + (rnd() - 0.5) * 2.2
        if (Math.abs(lx) < 4.8) continue
        const x = wx(lx, lz), z = wz(lx, lz), src = nearB[Math.floor(rnd() * nearB.length)], size = bl[src + 3] * (0.9 + 0.5 * rnd())
        bl.push(x, map.height(x, z) - 0.1 * size, z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
      }
    }
    for (let k = 0; nearB.length && k < 5; k++) {
      const [lx, ly, lz] = cave.tufts[Math.floor(rnd() * cave.tufts.length)], x = wx(lx, lz), z = wz(lx, lz)
      const src = nearB[Math.floor(rnd() * nearB.length)], size = bl[src + 3] * 0.75
      bl.push(x, map.height(x, z) + ly - 0.12 * size, z, size, rnd() * 6.283, bl[src + 5], bl[src + 6])
    }
  }
  return { trees: new Float32Array(tl), bushes: new Float32Array(bl) }
}
