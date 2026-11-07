import { gameParams } from '../settings'
import type { MapData } from './MapData'
import { cellSeed, type Rocks } from './Rocks'

/**
 * GROVES (2026-11-07, the user: "lots of trees at random places, that's good — but I need some places with a group of
 * trees, 5–6 trees together, and bushes, like a natural place; some random areas have that kind of thing, maybe 10
 * together — whatever looks best at that place"): one in about every other 230 m cell of the valley, on open ground or a
 * forest's edge (in a dense wood a group doesn't read) — 5–10 trees standing together, the tallest at the middle, a
 * looser fringe, and a ring of bushes about their feet. Most are spruce (a few larch among them); some groves are
 * birch and aspen, gold and red, a green one now and then. Each cell its own seed (`cellSeed`): nothing else the
 * placement does moves them, and they move nothing. Trees.placeTrees and Bushes.placeBushes add them after their own.
 * `?groves=0`: none (the A/B).
 */
export interface Grove {
  x: number; z: number
  /** x, z, height, species — Trees' */
  trees: [number, number, number, number][]
  /** x, z, size, kind — Bushes' */
  bushes: [number, number, number, number][]
}

const CELL = 230
const cache = new WeakMap<MapData, Grove[]>()

export function grovesOf(map: MapData, rocks: Rocks): Grove[] {
  const hit = cache.get(map)
  if (hit) return hit
  const out: Grove[] = []
  cache.set(map, out)
  if (map.desert || gameParams().get('groves') === '0') return out
  const mk: [number, number, number, number] = [0, 0, 0, 0]
  const hw = map.meta.trails.hw, fp = rocks.footprint.image.data as Uint8Array, g = map.inner, sp = map.meta.spawn
  const half = map.half - 80
  const slope = (x: number, z: number) => Math.hypot(map.height(x + 3, z) - map.height(x - 3, z), map.height(x, z + 3) - map.height(x, z - 3)) / 6
  const rocky = (x: number, z: number) => {
    const gi = Math.round((x - g.origin) / g.step), gj = Math.round((z - g.origin) / g.step)
    return gi < 0 || gj < 0 || gi >= g.n || gj >= g.n || fp[gj * g.n + gi] > 40
  }
  // a spot a tree / a bush can stand on (trailDist saturates a few metres off a track: past that, trackDist)
  const ground = (x: number, z: number, edge: number) => {
    map.maskAt(x, z, mk)
    return mk[2] < 0.75 && mk[0] < 0.45 && map.trailDist(x, z) > hw + Math.min(edge, 3) && map.trackDist(x, z) > hw + edge && !rocky(x, z) && slope(x, z) < 0.8 && map.stillDepth(x, z) < -0.2
      && (x - sp.x) ** 2 + (z - sp.z) ** 2 > 18 * 18
  }
  for (let cz = -half; cz < half; cz += CELL) for (let cx = -half; cx < half; cx += CELL) {
    let s = cellSeed(Math.round(cx), Math.round(cz), 77)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    if (rnd() > 0.62) continue
    // its middle: open ground or a forest's edge, gentle, off the tracks and the water
    let at: [number, number] | null = null
    for (let t = 0; t < 8 && !at; t++) {
      const x = cx + (0.15 + 0.7 * rnd()) * CELL, z = cz + (0.15 + 0.7 * rnd()) * CELL
      map.maskAt(x, z, mk)
      if (mk[3] > 0.55 || mk[2] > 0.5 || mk[0] > 0.3 || map.trackDist(x, z) < 16 || slope(x, z) > 0.45) continue
      if (ground(x, z, 6)) at = [x, z]
    }
    if (!at) continue
    const [x0, z0] = at
    const broad = rnd() < 0.3, n = 5 + Math.floor(rnd() * 6), step = broad ? 2.7 : 3.3
    const tallest = broad ? 11 + 5 * rnd() : 13 + 9 * rnd()
    const grove: Grove = { x: x0, z: z0, trees: [], bushes: [] }
    // (the trees on a spiral, the golden angle, each a little off it: a clump, never a ring or a row)
    let rMax = 0
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rnd() * 0.6, rr = step * Math.sqrt(i + 0.3) * (0.8 + 0.45 * rnd())
      const x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr
      if (!ground(x, z, 3)) continue
      const k = rnd()
      const species = broad ? (k < 0.45 ? 3 : k < 0.9 ? 4 : 5) : k < 0.13 ? 1 : 0
      // (the tallest in the middle, the fringe lower — the crown line of a stand)
      const h = tallest * (1.08 - 0.42 * Math.min(1, rr / (step * 3.2))) * (0.85 + 0.25 * rnd())
      grove.trees.push([x, z, h, species])
      rMax = Math.max(rMax, rr)
    }
    if (grove.trees.length < 4) continue
    // bushes about its feet: in the gaps of the fringe, a few just outside it
    const nb = 4 + Math.floor(rnd() * 5)
    for (let i = 0; i < nb; i++) {
      const a = rnd() * 6.283, rr = rMax * (0.55 + 0.6 * rnd()) + 1.2
      const x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr
      if (!ground(x, z, 1.5)) continue
      if (grove.trees.some(([tx, tz]) => (tx - x) ** 2 + (tz - z) ** 2 < 1.6 * 1.6)) continue
      const r = rnd()
      grove.bushes.push([x, z, 1.0 + 1.3 * Math.pow(rnd(), 1.2), r < 0.08 ? 2 : r < 0.4 ? 1 : 0])
    }
    out.push(grove)
  }
  return out
}
