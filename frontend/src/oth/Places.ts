import type { Landmark, MapData } from './MapData'
import type { Rocks } from './Rocks'
import { TREE_STRIDE, type Trees } from './Trees'

/**
 * THE VALLEY'S SMALL THINGS (2026-11-02, "make the valley great": something every 30–60 s of driving): where they stand,
 * picked once at load from the map's own data — seeded, so every session puts them in the same places (a crate's id
 * is stable: the journal keeps which were found).
 *
 *   sign    a SIGNPOST at every trail junction (its board names the places the trails lead to — the HUD reads it)
 *   table   a PICNIC TABLE at each viewpoint
 *   fence   split-rail FENCES by the cabins
 *   logs    LOG PILES along the forest tracks
 *   cairn   a stone CAIRN at the high point of each rough (trekking) trail
 *   truck   an abandoned LOGGING TRUCK by the sawmill, another in the deep forest
 *   stones  small STONES (~800): along the tracks' edges, round the camps, on the river banks — each its own size / turn
 *   shed    a TOOL SHED by each cabin and along the forest tracks
 *   outhouse  by the cabins and some camps
 *   ruin    an old homestead's RUIN (a stone chimney among low foundation walls) out in the meadows (~6)
 *   crate   SUPPLY CRATES (~70) to find: behind the landmarks, in the hidden places, at the trails' dead ends, on the
 *           river banks — and out in the open meadows, away from the tracks (they pull you off them)
 *   camps   CAMPSITES (Landmarks.ts kind 'camp': a tent, a fire ring, log seats, a lantern) at the scenic flat spots —
 *           the hidden basins, the Flower Hollow, the lake shore, the river's bends, the larger ponds
 *   swarms  wild FIREFLIES at night (2026-11-02, the user: "near some trees and random places"): by trees at a
 *           grove's edge, round the ponds, along the streams, in the Flower Hollow and the open meadows (~40)
 *
 * THE DESERT'S (2026-11-02, NEXT.md 5): the same signposts, crates (their ids from 100000: the journal keeps both
 * worlds'), stones (sandstone) and camps — at the oasis: by the lagoon and along the river — and its own: a stone WELL
 * by each oasis camp, at the ksar and along the oasis road; Bedouin TENTS by the camps and a nomads' camp on the plain;
 * sandstone RUINS out on the sand; an abandoned truck by the ksar. No log piles, sheds, outhouses or meadow fireflies
 * (the fireflies keep to the palms).
 *
 * Every spot is checked against the water, the tracks, the slope, the rocks and the trees (spatial hashes: ~10 ms for
 * the whole valley).
 */
export type PropKind = 'sign' | 'table' | 'fence' | 'logs' | 'cairn' | 'truck' | 'crate' | 'stones' | 'shed' | 'outhouse' | 'ruin' | 'well' | 'tent'
export const PROP_KINDS: PropKind[] = ['sign', 'table', 'fence', 'logs', 'cairn', 'truck', 'crate', 'stones', 'shed', 'outhouse', 'ruin', 'well', 'tent']
/** The desert's things' ids start here (a crate's id is kept in the journal: the two worlds' never meet). */
export const DESERT_IDS = 100000

/** A thing's place: on the ground at (x, y, z), turned `rot` about +y, scaled `s` (default 1). */
export interface Prop { kind: PropKind; id: number; x: number; y: number; z: number; rot: number; s?: number }
/** `swarms`: where wild FIREFLIES gather at night (Props.ts) — by the trees, the ponds and streams, in the meadows. */
export interface PlacesOut { props: Prop[]; camps: Landmark[]; swarms: [number, number, number][]; ms: number }

class Hash {
  private readonly m = new Map<number, number[]>()
  constructor(private readonly cell: number) {}
  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096) }
  add(x: number, z: number, v: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))
    const l = this.m.get(k)
    if (l) l.push(v)
    else this.m.set(k, [v])
  }
  /** Every value within r of (x, z)'s cells (a superset: test the distance yourself); stops when fn returns true. */
  some(x: number, z: number, r: number, fn: (v: number) => boolean): boolean {
    const c = this.cell, i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = this.m.get(this.key(i, j))
      if (l) for (const v of l) if (fn(v)) return true
    }
    return false
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
}

/** The camps' names, by where they stand. */
const CAMP_NAMES: Record<string, string[]> = {
  falls: ['Falls Camp', 'Spray Camp'],
  meadow: ['Hollow Camp'],
  lake: ['Lakeshore Camp', 'Loon Point Camp', 'Driftwood Camp'],
  river: ['Riverbend Camp', 'Gravel Bar Camp', 'Alder Camp'],
  pond: ['Still Water Camp', 'Reed Pond Camp', 'Lily Pond Camp'],
}
const DESERT_CAMP_NAMES: Record<string, string[]> = {
  falls: ['Spring Camp'],
  lake: ['Lagoon Camp', 'Palm Shore Camp'],
  river: ['Oasis Camp', 'Date Grove Camp', 'Tamarisk Camp'],
  pond: [],
}

export function placeThings(map: MapData, rocks: Rocks, trees: Trees): PlacesOut {
  const t0 = performance.now()
  const rnd = rng(0x0b5e55)
  const meta = map.meta, hw = meta.trails.hw, lines = meta.trails.lines, half = map.half, desert = map.desert
  const idBase = desert ? DESERT_IDS : 0
  const mk: [number, number, number, number] = [0, 0, 0, 0]
  // ---- what's already there
  const rockHash = new Hash(16)
  rocks.all.forEach((r, i) => rockHash.add(r.x, r.z, i))
  const treeHash = new Hash(16), td = trees.data
  for (let i = 0; i < trees.count; i++) treeHash.add(td[i * TREE_STRIDE], td[i * TREE_STRIDE + 2], i)
  const pads = meta.landmarks ?? []
  const props: Prop[] = []
  const placed = new Hash(48)

  const slope = (x: number, z: number) => Math.max(Math.abs(map.height(x + 1.5, z) - map.height(x - 1.5, z)), Math.abs(map.height(x, z + 1.5) - map.height(x, z - 1.5))) / 3
  const clearOf = (x: number, z: number, clear: number) =>
    !rockHash.some(x, z, clear + 12, (i) => { const r = rocks.all[i]; return (r.x - x) ** 2 + (r.z - z) ** 2 < (r.s * 0.65 + clear) ** 2 }) &&
    !treeHash.some(x, z, clear + 2, (i) => (td[i * TREE_STRIDE] - x) ** 2 + (td[i * TREE_STRIDE + 2] - z) ** 2 < (clear + 0.7) ** 2)
  /** A spot fit for a thing: in the box, dry, not a bridge, gentle, off rock, off the track (by offTrack m), clear
   *  of rocks / trees (by clear m), off the landmarks' pads, and `spacing` m from the same kind. */
  const free = (x: number, z: number, o: { clear: number; maxSlope: number; offTrack: number; spacing: number; kind: PropKind | 'camp'; onRock?: boolean }) => {
    if (Math.abs(x) > half - 60 || Math.abs(z) > half - 60) return false
    if (map.waterLevel(x, z) !== null || map.bridgeAt(x, z) !== null || map.mudAt(x, z) > 0.3) return false
    if (slope(x, z) > o.maxSlope) return false
    map.maskAt(x, z, mk)
    if (mk[0] > 0.35 && !o.onRock) return false
    // (trailDist reads only 8 m out: farther, the coarser trackDist, ≤ 48 m)
    if ((o.offTrack > 7.5 ? map.trackDist(x, z) : map.trailDist(x, z)) < o.offTrack) return false
    if (pads.some((l) => !AREA.has(l.kind) && (l.x - x) ** 2 + (l.z - z) ** 2 < (l.r + 5) ** 2)) return false
    if (placed.some(x, z, o.spacing, (i) => { const p = props[i]; return p.kind === o.kind && (p.x - x) ** 2 + (p.z - z) ** 2 < o.spacing * o.spacing })) return false
    return clearOf(x, z, o.clear)
  }
  const add = (kind: PropKind, x: number, z: number, rot: number, sc?: number) => {
    props.push({ kind, id: idBase + props.length, x, y: map.height(x, z), z, rot, ...(sc ? { s: sc } : {}) })
    placed.add(x, z, props.length - 1)
  }
  /** A spot on a ring round (x, z) (radius r, from angle a0 on, n tries) where `ok` holds. */
  const ring = (x: number, z: number, r: number, a0: number, n: number, ok: (px: number, pz: number) => boolean): [number, number] | null => {
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * Math.PI * 2) / n, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
      if (ok(px, pz)) return [px, pz]
    }
    return null
  }
  /** The trail's direction at point i of line L (rad, for things lying along it). */
  const along = (L: [number, number][], i: number) => {
    const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)]
    return Math.atan2(b[0] - a[0], b[1] - a[1])
  }

  // ---- CAMPSITES (landmarks of their own: Landmarks.ts builds them, finds them, puts them on the map)
  const camps: Landmark[] = []
  const used: Record<string, number> = {}
  let nextId = Math.max(0, ...pads.map((l) => l.id)) + 1
  // (2026-11-04: the camps are BASE CAMPS now — a camper, a trailer, tarps … ~24 × 14 m: more room clear)
  const campOk = (x: number, z: number) => free(x, z, { clear: 9, maxSlope: 0.08, offTrack: hw + 8, spacing: 0, kind: 'camp' }) &&
    !camps.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 380 * 380) && !pads.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < (AREA.has(l.kind) ? 25 : 110) ** 2)
  const camp = (kind: string, x: number, z: number, faceX: number, faceZ: number) => {
    const names = (desert ? DESERT_CAMP_NAMES : CAMP_NAMES)[kind] ?? [], n = used[kind] ?? 0
    if (n >= names.length || camps.length >= 9) return false
    used[kind] = n + 1
    camps.push({ id: nextId++, kind: 'camp', name: names[n], x, z, y: map.height(x, z), rot: Math.atan2(faceX - x, faceZ - z), r: 13 })
    return true
  }
  const tryCamp = (kind: string, x: number, z: number, faceX: number, faceZ: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r += 6) {
      const s = ring(x, z, r, rnd() * 6.283, 16, campOk)
      if (s) return camp(kind, s[0], s[1], faceX, faceZ)
    }
    return false
  }
  for (const h of meta.hidden ?? []) {
    if (h.kind === 'falls' && h.pool) tryCamp('falls', h.pool.cx, h.pool.cz, h.pool.cx, h.pool.cz, 18, 52)
    else if (h.kind === 'meadow') tryCamp('meadow', h.x, h.z, h.x, h.z, 12, 46)
  }
  const lake = meta.water.lake
  for (let k = 0; k < 3; k++) {
    // (the base camps want room: a few distances out, past the palms — 2026-11-04)
    for (let t = 0; t < 25; t++) {
      const a = rnd() * 6.283, c = Math.cos(lake.rot), s = Math.sin(lake.rot), d = 30 + (t % 5) * 12
      const ex = Math.cos(a) * (lake.rx + d), ez = Math.sin(a) * (lake.rz + d)
      const x = lake.cx + ex * c - ez * s, z = lake.cz + ex * s + ez * c
      if (campOk(x, z)) { camp('lake', x, z, lake.cx, lake.cz); break }
    }
  }
  const riv = meta.water.river
  for (let i = 12; i < riv.x.length - 12 && (used.river ?? 0) < 3; i += 9) {
    const dx = riv.x[i + 1] - riv.x[i - 1], dz = riv.z[i + 1] - riv.z[i - 1], l = Math.hypot(dx, dz) || 1
    let done = false
    for (let k = 0; k < 5 && !done; k++) for (const side of [1, -1]) {
      const off = riv.hw[i] * 1.75 + 16 + k * 12, x = riv.x[i] - (dz / l) * off * side, z = riv.z[i] + (dx / l) * off * side
      if (campOk(x, z)) { camp('river', x, z, riv.x[i], riv.z[i]); done = true; break }
    }
  }
  for (const P of [...(meta.water.ponds ?? [])].sort((a, b) => b.rx * b.rz - a.rx * a.rz)) {
    if ((used.pond ?? 0) >= 3) break
    tryCamp('pond', P.cx, P.cz, P.cx, P.cz, Math.max(P.rx, P.rz) + 14, Math.max(P.rx, P.rz) + 32)
  }
  const allPads = [...pads, ...camps]

  // ---- SIGNPOSTS at the junctions (where a trail's end meets another trail)
  const pts = new Hash(10)
  lines.forEach((L, li) => L.forEach(([x, z], pi) => pts.add(x, z, li * 65536 + pi)))
  const junctions: [number, number][] = []
  lines.forEach((L, li) => {
    for (const pi of [0, L.length - 1]) {
      const [x, z] = L[pi]
      const meets = pts.some(x, z, 9, (v) => (v >> 16) !== li && (lines[v >> 16][v & 0xffff][0] - x) ** 2 + (lines[v >> 16][v & 0xffff][1] - z) ** 2 < 81)
      if (meets && !junctions.some(([jx, jz]) => (jx - x) ** 2 + (jz - z) ** 2 < 50 * 50)) junctions.push([x, z])
    }
  })
  for (const [jx, jz] of junctions) {
    const s = ring(jx, jz, hw + 2.6, rnd() * 6.283, 12, (x, z) => map.trailDist(x, z) > hw + 1.2 && free(x, z, { clear: 0.8, maxSlope: 0.4, offTrack: hw + 1.2, spacing: 30, kind: 'sign' }))
    if (s) add('sign', s[0], s[1], Math.atan2(jx - s[0], jz - s[1]))
  }

  // ---- PICNIC TABLES at the viewpoints, FENCES by the cabins, the TRUCK by the sawmill
  for (const l of pads) {
    const c = Math.cos(l.rot), s = Math.sin(l.rot)
    const local = (lx: number, lz: number): [number, number] => [l.x + lx * c + lz * s, l.z - lx * s + lz * c]
    if (l.kind === 'view' || l.kind === 'tower') {
      // (just past the pad's edge, at its sides first: the table looks the same way as the view)
      for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, (-2 * Math.PI) / 3]) {
        const [x, z] = local(Math.sin(a) * (l.r + 6.5), Math.cos(a) * (l.r + 6.5))
        if (free(x, z, { clear: 1.4, maxSlope: 0.2, offTrack: hw + 1.5, spacing: 20, kind: 'table' })) { add('table', x, z, l.rot); break }
      }
    } else if (l.kind === 'cabin') {
      let n = 0
      for (let k = 0; k < 6 && n < 3; k++) {
        const [x, z] = local(-6 + k * 4.2, 9.5)
        if (free(x, z, { clear: 0.6, maxSlope: 0.25, offTrack: hw + 1, spacing: 3.5, kind: 'fence' })) { add('fence', x, z, l.rot + Math.PI / 2); n++ }
      }
    } else if (l.kind === 'sawmill') {
      const s2 = ring(l.x, l.z, l.r + 10, l.rot, 10, (x, z) => free(x, z, { clear: 3.2, maxSlope: 0.12, offTrack: hw + 3, spacing: 50, kind: 'truck' }))
      if (s2) add('truck', s2[0], s2[1], l.rot + 0.4)
    }
  }

  // picnic tables by the water too: the lake's shore and the larger ponds
  let shore = 0
  for (const P of [{ cx: lake.cx, cz: lake.cz, rx: lake.rx, rz: lake.rz, rot: lake.rot }, ...[...(meta.water.ponds ?? [])].sort((a, b) => b.rx * b.rz - a.rx * a.rz).slice(0, 4)]) {
    for (let t = 0; t < 12 && shore < 5; t++) {
      const a = rnd() * 6.283, c = Math.cos(P.rot), sn = Math.sin(P.rot), ex = Math.cos(a) * (P.rx + 12), ez = Math.sin(a) * (P.rz + 12)
      const x = P.cx + ex * c - ez * sn, z = P.cz + ex * sn + ez * c
      if (free(x, z, { clear: 1.4, maxSlope: 0.16, offTrack: hw + 2, spacing: 250, kind: 'table' })) { add('table', x, z, Math.atan2(P.cx - x, P.cz - z)); shore++; break }
    }
  }

  // ---- along the TRACKS: log piles in the forest, the deep-forest truck, the cairns on the rough trails (the valley's)
  let deep: [number, number, number, number] | null = null // (x, z, rot, forest)
  if (!desert) lines.forEach((L, li) => {
    let run = 0
    for (let i = 1; i < L.length; i++) {
      run += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1])
      if (run < 110) continue
      run = 0
      map.maskAt(L[i][0], L[i][1], mk)
      if (mk[3] < 0.3) continue
      const a = along(L, i)
      for (const side of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
        const off = hw + 3.2, x = L[i][0] + Math.cos(a) * off * side, z = L[i][1] - Math.sin(a) * off * side
        if (free(x, z, { clear: 1.0, maxSlope: 0.25, offTrack: hw + 1.5, spacing: 100, kind: 'logs' })) { add('logs', x, z, a + Math.PI / 2); break }
      }
      const so = rnd() < 0.5 ? 1 : -1
      if (!deep || mk[3] > deep[3]) deep = [L[i][0] + Math.cos(a) * (hw + 5.5) * so, L[i][1] - Math.sin(a) * (hw + 5.5) * so, a, mk[3]]
    }
    if ((meta.trails.rough ?? []).includes(li)) {
      let top = 0
      for (let i = 1; i < L.length; i++) if (map.height(L[i][0], L[i][1]) > map.height(L[top][0], L[top][1])) top = i
      const s = ring(L[top][0], L[top][1], hw + 2.8, rnd() * 6.283, 12, (x, z) => free(x, z, { clear: 0.8, maxSlope: 0.6, offTrack: hw + 1.4, spacing: 120, kind: 'cairn', onRock: true }))
      if (s) add('cairn', s[0], s[1], rnd() * 6.283)
    }
  })
  const dp = deep as [number, number, number, number] | null
  if (dp) {
    const s = ring(dp[0], dp[1], 4, 0, 8, (x, z) => free(x, z, { clear: 2.2, maxSlope: 0.16, offTrack: hw + 3, spacing: 600, kind: 'truck' }))
    if (s) add('truck', s[0], s[1], dp[2] + 0.3)
  }

  // ---- the small HUMAN TRACES: a shed and an outhouse by every cabin, sheds along the forest tracks, outhouses at some
  //      camps, homestead RUINS in the open meadows
  if (!desert) for (const l of pads) {
    if (l.kind !== 'cabin') continue
    const c = Math.cos(l.rot), sn = Math.sin(l.rot)
    // (just outside the cabin's pad: it keeps l.r + 5 m clear)
    for (const [kind, spots] of [['shed', [[-12.5, -3], [-12.5, 3], [12.5, -3]]], ['outhouse', [[10, -8], [-10, -8], [8, -10]]]] as [PropKind, number[][]][]) {
      for (const [lx, lz] of spots) {
        const x = l.x + lx * c + lz * sn, z = l.z - lx * sn + lz * c
        if (free(x, z, { clear: kind === 'shed' ? 1.4 : 0.8, maxSlope: 0.22, offTrack: hw + 2, spacing: 30, kind })) { add(kind, x, z, l.rot); break }
      }
    }
  }
  if (!desert) camps.forEach((cp, i) => {
    if (i % 3) return
    const c = Math.cos(cp.rot), sn = Math.sin(cp.rot), x = cp.x - 6 * c - 6 * sn, z = cp.z + 6 * sn - 6 * c
    if (free(x, z, { clear: 0.9, maxSlope: 0.2, offTrack: hw + 2, spacing: 30, kind: 'outhouse' })) add('outhouse', x, z, cp.rot)
  })
  if (!desert) lines.forEach((L) => {
    let run = 0
    for (let i = 1; i < L.length; i++) {
      run += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1])
      if (run < 520) continue
      run = 0
      map.maskAt(L[i][0], L[i][1], mk)
      if (mk[3] < 0.1 || rnd() > 0.6) continue
      const a = along(L, i)
      placeShed: for (const off of [hw + 4.5, hw + 7.5]) for (const side of [1, -1]) {
        const x = L[i][0] + Math.cos(a) * off * side, z = L[i][1] - Math.sin(a) * off * side
        if (free(x, z, { clear: 1.3, maxSlope: 0.18, offTrack: hw + 3, spacing: 350, kind: 'shed' })) { add('shed', x, z, a + (side > 0 ? -Math.PI / 2 : Math.PI / 2)); break placeShed }
      }
    }
  })
  for (let t = 0, n = 0; t < 8000 && n < 6; t++) {
    const x = (rnd() * 2 - 1) * (half - 150), z = (rnd() * 2 - 1) * (half - 150)
    if (map.trackDist(x, z) < 12) continue
    map.maskAt(x, z, mk)
    if (mk[3] > 0.45 || (desert && mk[1] > 0.8)) continue // (the desert's: on firm ground, not the loose sand)
    if (free(x, z, { clear: 2.0, maxSlope: 0.18, offTrack: hw + 6, spacing: 600, kind: 'ruin' }) && !allPads.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < 100 * 100)) { add('ruin', x, z, rnd() * 6.283); n++ }
  }

  // ---- THE DESERT's own: a WELL by each oasis camp, at the ksar's gate and along the oasis road; a Bedouin TENT by
  //      each camp and a nomads' camp on the plain; an abandoned truck by the ksar
  if (desert) {
    const near = (x: number, z: number, r0: number, r1: number, kind: PropKind, clear: number, spacing: number, rot?: number) => {
      for (let r = r0; r <= r1; r += 3) {
        const s = ring(x, z, r, rnd() * 6.283, 14, (px, pz) => free(px, pz, { clear, maxSlope: 0.18, offTrack: hw + 2, spacing, kind }))
        if (s) { add(kind, s[0], s[1], rot ?? Math.atan2(x - s[0], z - s[1])); return true }
      }
      return false
    }
    for (const cp of camps) { near(cp.x, cp.z, 11, 24, 'well', 1.4, 60); near(cp.x, cp.z, 12, 26, 'tent', 3.2, 20) }
    for (const l of pads) {
      if (l.kind === 'ksar') { near(l.x, l.z, l.r + 8, l.r + 30, 'well', 1.4, 60); near(l.x, l.z, l.r + 14, l.r + 40, 'truck', 3.2, 600, rnd() * 6.283) }
      if (l.kind === 'oasis') near(l.x, l.z, l.r + 10, l.r + 40, 'well', 1.4, 60)
    }
    // the nomads: three tents and a well in a ring by a track, out on the plain
    for (let t = 0; t < 4000; t++) {
      const L = lines[Math.floor(rnd() * lines.length)], i = Math.floor(rnd() * L.length), [x0, z0] = L[i]
      const a = rnd() * 6.283, x = x0 + Math.cos(a) * 40, z = z0 + Math.sin(a) * 40
      map.maskAt(x, z, mk)
      if (mk[0] > 0.1 || mk[3] > 0.1 || mk[1] > 0.85 || slope(x, z) > 0.08 || allPads.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < 300 * 300)) continue
      if (!free(x, z, { clear: 6, maxSlope: 0.08, offTrack: hw + 14, spacing: 0, kind: 'tent' })) continue
      for (let k = 0; k < 3; k++) near(x, z, 9, 16, 'tent', 3.2, 9)
      near(x, z, 0, 6, 'well', 1.4, 60)
      break
    }
  }

  // ---- small STONES: in little clusters along the tracks' edges, round the camps, on the river's banks
  const stoneOk = (x: number, z: number) => free(x, z, { clear: 0.25, maxSlope: 0.75, offTrack: hw + 0.5, spacing: 1.2, kind: 'stones', onRock: true })
  const cluster = (x: number, z: number, n: number, r: number) => {
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.283, d = r * Math.sqrt(rnd()), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
      if (stoneOk(px, pz)) add('stones', px, pz, rnd() * 6.283, 0.5 + rnd() * 1.1)
    }
  }
  lines.forEach((L) => {
    let run = 0
    for (let i = 1; i < L.length; i++) {
      run += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1])
      if (run < 45) continue
      run = 0
      if (rnd() > 0.7) continue
      const a = along(L, i), side = rnd() < 0.5 ? 1 : -1, off = hw + 1.2 + rnd() * 2.5
      cluster(L[i][0] + Math.cos(a) * off * side, L[i][1] - Math.sin(a) * off * side, 1 + Math.floor(rnd() * 3), 1.4)
    }
  })
  for (const cp of camps) for (let k = 0; k < 5; k++) { const a = rnd() * 6.283, d = 5 + rnd() * 4; cluster(cp.x + Math.cos(a) * d, cp.z + Math.sin(a) * d, 2, 1.2) }
  for (let i = 6; i < riv.x.length - 6; i += 5) {
    const dx = riv.x[i + 1] - riv.x[i - 1], dz = riv.z[i + 1] - riv.z[i - 1], l = Math.hypot(dx, dz) || 1, side = rnd() < 0.5 ? 1 : -1
    const off = riv.hw[i] * 1.75 + 1 + rnd() * 3
    cluster(riv.x[i] - (dz / l) * off * side, riv.z[i] + (dx / l) * off * side, 2, 1.6)
  }

  // ---- SUPPLY CRATES
  const crateOk = (x: number, z: number) => free(x, z, { clear: 1.1, maxSlope: 0.45, offTrack: hw + 1.2, spacing: 120, kind: 'crate' }) &&
    !allPads.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < (l.r + 4) ** 2)
  const crate = (x: number, z: number) => { add('crate', x, z, rnd() * 6.283); return true }
  // behind every landmark and camp
  for (const l of allPads) {
    const s = ring(l.x, l.z, l.r + 8 + rnd() * 8, l.rot + Math.PI * (0.6 + rnd() * 0.8), 10, crateOk)
    if (s) crate(s[0], s[1])
  }
  // in the hidden places (two each)
  for (const h of meta.hidden ?? []) {
    let n = 0
    for (let t = 0; t < 30 && n < 2; t++) {
      const a = rnd() * 6.283, r = h.r * (0.25 + rnd() * 0.5), x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r
      if (crateOk(x, z)) { crate(x, z); n++ }
    }
  }
  // the trails' dead ends (an end that meets no other trail)
  lines.forEach((L, li) => {
    for (const pi of [0, L.length - 1]) {
      const [x, z] = L[pi]
      if (junctions.some(([jx, jz]) => (jx - x) ** 2 + (jz - z) ** 2 < 30 * 30)) continue
      if (pts.some(x, z, 12, (v) => (v >> 16) !== li)) continue
      const s = ring(x, z, hw + 4 + rnd() * 6, rnd() * 6.283, 10, crateOk)
      if (s) crate(s[0], s[1])
    }
  })
  // the river's banks
  for (let i = 20; i < riv.x.length - 20; i += 23) {
    const dx = riv.x[i + 1] - riv.x[i - 1], dz = riv.z[i + 1] - riv.z[i - 1], l = Math.hypot(dx, dz) || 1, side = rnd() < 0.5 ? 1 : -1
    const off = riv.hw[i] * 1.75 + 6 + rnd() * 8, x = riv.x[i] - (dz / l) * off * side, z = riv.z[i] + (dx / l) * off * side
    if (crateOk(x, z)) crate(x, z)
  }
  // out in the open, away from the tracks, until there are ~70
  let n = props.filter((p) => p.kind === 'crate').length
  for (let t = 0; t < 12000 && n < 72; t++) {
    // (trackDist: metres to the nearest track, ≤ 48 — trailDist only reads 8 m out)
    const x = (rnd() * 2 - 1) * (half - 100), z = (rnd() * 2 - 1) * (half - 100)
    if (map.trackDist(x, z) < 32) continue
    if (crateOk(x, z)) { crate(x, z); n++ }
  }
  // ---- wild FIREFLIES: at a grove's edge (a tree with open ground beside it), by the ponds and streams, in meadows
  const swarms: [number, number, number][] = []
  const dryOpen = (x: number, z: number) => Math.abs(x) < half - 80 && Math.abs(z) < half - 80 && map.waterLevel(x, z) === null && map.trailDist(x, z) > hw + 3 &&
    !swarms.some(([sx, , sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 140 * 140)
  const sw = (x: number, z: number) => { if (dryOpen(x, z)) swarms.push([x, map.height(x, z), z]) }
  for (let t = 0; t < 600 && swarms.length < 18; t++) {
    const i = Math.floor(rnd() * trees.count), o = i * TREE_STRIDE, a = rnd() * 6.283
    const x = td[o] + Math.cos(a) * 4.5, z = td[o + 2] + Math.sin(a) * 4.5
    if (!treeHash.some(x, z, 3, (j) => (td[j * TREE_STRIDE] - x) ** 2 + (td[j * TREE_STRIDE + 2] - z) ** 2 < 6)) sw(x, z)
  }
  for (const P of meta.water.ponds ?? []) { const a = rnd() * 6.283, r = Math.max(P.rx, P.rz) + 6; sw(P.cx + Math.cos(a) * r, P.cz + Math.sin(a) * r) }
  for (const S of meta.water.streams ?? []) for (let i = 4; i < S.x.length; i += 40) sw(S.x[i] + (rnd() - 0.5) * 12, S.z[i] + (rnd() - 0.5) * 12)
  for (const h of meta.hidden ?? []) if (h.kind === 'meadow') for (let k = 0; k < 3; k++) { const a = rnd() * 6.283, r = h.r * 0.4 * rnd(); sw(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r) }
  for (let t = 0; t < 400 && swarms.length < 44 && !desert; t++) {
    const x = (rnd() * 2 - 1) * (half - 150), z = (rnd() * 2 - 1) * (half - 150)
    map.maskAt(x, z, mk)
    if (mk[1] < 0.5 && mk[0] < 0.2 && slope(x, z) < 0.2) sw(x, z) // (the green meadows)
  }
  return { props, camps, swarms, ms: performance.now() - t0 }
}

/** Landmarks that are AREAS (a basin, a meadow), not buildings: things may stand inside them. */
const AREA = new Set<Landmark['kind']>(['falls', 'meadow'])
