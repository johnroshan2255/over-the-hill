import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { World } from './World'
import type { Session } from '../net/Session'
import type { Ev, Pond, Stroke } from '../net/wire'

/**
 * THE CLAIMS' GROUND (docs/MULTIPLAYER.md §3, step 5 — SHAPE, PAVE, WATER): what the server keeps for each claim, drawn
 * on this world's ground —
 *  - THE HEIGHTS (the server's cells: a change in cm per vertex of the box's 2 m grid): into MapData's height grid (the
 *    CPU's — physics, the walker, what's placed — and the GPU's: the R16UI heights and the normals, only the rows
 *    touched re-sent). An edit EASES in (0.45 s, a cubic out: the ground heaves up / sinks, it doesn't jump); once it
 *    has settled, what stands on it follows: the physics' heightfield tiles there rebuilt, the trees moved with it, the
 *    grass and the ground's baked surface redone, the claim's flag set on it again.
 *  - THE PAVING (the claims' strokes, in order): into MapData.trailTex — STONE the places' flagstones (G; the claim a
 *    paved frame, so they're laid square to it), GRAVEL the tracks' gravel (R: the distance to a track), DIRT bare
 *    earth (B: the mud), ERASE the map's own back. Each a soft-edged disc, its rim broken by noise (no compass line).
 *  - THE PONDS: the water's own ground (MapData.waterTex R G, the 4 m grid) and a disc of the lake's water (Water.addDug)
 *    that FILLS — from the bowl's floor up to its level over 3 s — and is water to everything after (MapData.dug).
 * Applied for the welcome's state at once (no easing) and as events come.
 */
const EASE_S = 0.45
const FILL_S = 3
/** The paving's soft rim (m) and the noise that breaks it up. */
const RIM = 0.7

type Anim = { from: number; to: number; t: number }

export class GroundEdits {
  /** Each cell easing to its new height (k → from, to, time in). */
  private readonly anims = new Map<number, Anim>()
  /** The cells' heights when they last settled (for what stands on them: how far they moved). */
  private readonly settled = new Map<number, number>()
  /** The rows / box touched since the last settle (grid indices). */
  private box = [Infinity, Infinity, -Infinity, -Infinity]
  private lo = Infinity
  private hi = -Infinity
  /** The trail texture's texels as the map made them (k → RGBA packed), where a stroke has painted. */
  private readonly trailBase = new Map<number, number>()
  /** Which claim's strokes have been laid (their count) — a stroke added is laid on top; one gone, all relaid. */
  private readonly laid = new Map<string, number>()
  private readonly ponds = new Map<string, { p: Pond; t: number; floor: number }>()
  private cacheT = -1
  private worldId = ''
  private readonly off: () => void
  /** A claim's ground has settled (Claims rebuilds its flag and bounds on it). */
  onSettle: ((x0: number, z0: number, x1: number, z1: number) => void) | null = null

  constructor(private readonly session: Session, private readonly world: () => World, private readonly physics: OthPhysics) {
    this.off = session.on((e) => this.event(e))
  }

  dispose(): void { this.off() }

  private map(): MapData | null {
    const w = this.world()
    return w.id === this.session.world.map ? w.map : null
  }

  private event(e: Ev): void {
    if (!this.map()) return
    switch (e.t) {
      case 'cells': this.heights(e.claim, true); break
      case 'pave': this.paint(e.claim); break
      case 'pond': this.pond(e.pond, true); break
      case 'pond_gone': this.dropPond(e.id); break
      case 'claim_gone': this.forget(e.id); break
    }
  }

  /** Everything the session holds, at once (a new world entered, or the first frame). */
  private all(): void {
    const map = this.map()
    if (!map) return
    for (const id of this.session.cells.keys()) this.heights(id, false)
    this.flush(map)
    this.settle(map)
    for (const id of this.session.paint.keys()) this.paint(id)
    for (const p of this.session.ponds.values()) this.pond(p, false)
  }

  // ================================================================================================ the heights
  /** Claim `id`'s cells: each to its new height — eased (an event) or at once (the welcome). */
  private heights(id: string, ease: boolean): void {
    const map = this.map(), cells = this.session.cells.get(id)
    if (!map || !cells) return
    const g = map.inner, n = g.n, base = map.baseH
    for (const [key, d] of cells) {
      const i = Math.floor(key / 4096), j = key % 4096
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue
      const k = j * n + i
      if (!base.has(k)) base.set(k, g.h[k])
      this.cell(map, k, base.get(k)! + d / 100, ease)
    }
    // (cells set back to the map's own: the server sends d 0 and they're dropped from the session's list)
    for (const k of [...base.keys()]) {
      const i = k % n, j = Math.floor(k / n)
      if (!cells.has(i * 4096 + j) && this.owner(map, i, j) === id) this.cell(map, k, base.get(k)!, ease)
    }
  }

  /** The claim whose land holds grid vertex (i, j). */
  private owner(map: MapData, i: number, j: number): string | null {
    const g = map.inner, x = g.origin + i * g.step, z = g.origin + j * g.step
    for (const c of this.session.claims.values()) if ((c.x - x) ** 2 + (c.z - z) ** 2 <= (c.r + g.step) ** 2) return c.id
    return null
  }

  private cell(map: MapData, k: number, to: number, ease: boolean): void {
    const h = map.inner.h
    if (!this.settled.has(k)) this.settled.set(k, h[k])
    if (ease && Math.abs(h[k] - to) > 0.004) this.anims.set(k, { from: h[k], to, t: 0 })
    else { this.anims.delete(k); h[k] = to }
    this.touch(map, k, to)
  }

  private touch(map: MapData, k: number, y: number): void {
    const n = map.inner.n, i = k % n, j = Math.floor(k / n), b = this.box
    b[0] = Math.min(b[0], i); b[1] = Math.min(b[1], j); b[2] = Math.max(b[2], i); b[3] = Math.max(b[3], j)
    this.lo = Math.min(this.lo, y, map.inner.h[k]); this.hi = Math.max(this.hi, y, map.inner.h[k])
  }

  /** The heights touched since the last flush onto the GPU: the R16UI heights and the normals over their rows. */
  private flush(map: MapData): void {
    const b = this.box
    if (b[0] > b[2]) return
    const g = map.inner, n = g.n, h = g.h, raw = g.tex.image.data as Uint16Array, nb = g.normalTex.image.data as Uint8Array
    const meta = map.meta.inner, k16 = 65535 / meta.range, s2 = 2 * g.step
    const i0 = Math.max(0, b[0] - 1), j0 = Math.max(0, b[1] - 1), i1 = Math.min(n - 1, b[2] + 1), j1 = Math.min(n - 1, b[3] + 1)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i
      raw[k] = Math.max(0, Math.min(65535, Math.round((h[k] - meta.min) * k16)))
      // (the normal: central differences, as mapPrep.ts normalsOf)
      const dx = (h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)]) / s2
      const dz = (h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i]) / s2
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      nb[k * 2] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      nb[k * 2 + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255)
    }
    g.tex.updateRows(j0, j1)
    g.normalTex.updateRows(j0, j1)
    this.dirty = [Math.min(this.dirty[0], i0), Math.min(this.dirty[1], j0), Math.max(this.dirty[2], i1), Math.max(this.dirty[3], j1)]
    this.box = [Infinity, Infinity, -Infinity, -Infinity]
  }
  /** The box (grid indices) changed since the last settle. */
  private dirty = [Infinity, Infinity, -Infinity, -Infinity]

  /** Everything standing on the ground that moved: the physics, the trees, the grass, the baked surface, the flag. */
  private settle(map: MapData): void {
    const d = this.dirty
    if (d[0] > d[2]) return
    const w = this.world(), g = map.inner, n = g.n
    const x0 = g.origin + d[0] * g.step, z0 = g.origin + d[1] * g.step, x1 = g.origin + d[2] * g.step, z1 = g.origin + d[3] * g.step
    w.terrain.widen(x0, z0, x1, z1, this.lo - 0.5, this.hi + 0.5)
    this.physics.regroundTiles(x0, z0, x1, z1)
    // (each tree up / down by how far the ground under it moved: bilinear over its cell's corners)
    const moved = (k: number) => g.h[k] - (this.settled.get(k) ?? g.h[k])
    const dy = (x: number, z: number) => {
      const fx = (x - g.origin) / g.step, fz = (z - g.origin) / g.step, i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * n + i
      const a = moved(k) + (moved(k + 1) - moved(k)) * tx, b = moved(k + n) + (moved(k + n + 1) - moved(k + n)) * tx
      return a + (b - a) * tz
    }
    const trees = w.trees.reground(x0, z0, x1, z1, dy)
    if (trees.length) { for (const t of trees) this.physics.dropTrunk(t); this.physics.trunksDirty() }
    const rocks = w.rocks.reground(x0, z0, x1, z1, dy)
    if (rocks.length) this.physics.dropRocks(rocks)
    this.settled.clear()
    this.dirty = [Infinity, Infinity, -Infinity, -Infinity]
    this.lo = Infinity; this.hi = -Infinity
    w.grass.refresh()
    this.cacheT = 0.25
    this.onSettle?.(x0, z0, x1, z1)
  }

  // ================================================================================================ the paving
  /** Claim `id`'s strokes laid: the new ones on top (or, if there are fewer than were laid, all of them again). */
  private paint(id: string): void {
    const map = this.map(), list = this.session.paint.get(id) ?? []
    if (!map) return
    let from = this.laid.get(id) ?? 0
    if (list.length < from) { this.unpaint(map, id); from = 0 }
    if (from >= list.length) return
    const rows = [Infinity, -Infinity]
    for (let s = from; s < list.length; s++) this.stroke(map, list[s], rows)
    this.laid.set(id, list.length)
    map.trailTex.updateRows(rows[0], rows[1])
    this.framePaving(map)
    this.world().grass.refresh()
    this.cacheT = Math.max(this.cacheT, 0.05)
  }

  private stroke(map: MapData, s: Stroke, rows: number[]): void {
    const g = map.inner, n = g.n, T = map.trailTex.image.data as Uint8Array, hw = map.meta.trails.hw
    const R = s.r + RIM, i0 = Math.max(0, Math.floor((s.x - R - g.origin) / g.step)), i1 = Math.min(n - 1, Math.ceil((s.x + R - g.origin) / g.step))
    const j0 = Math.max(0, Math.floor((s.z - R - g.origin) / g.step)), j1 = Math.min(n - 1, Math.ceil((s.z + R - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * g.step, z = g.origin + j * g.step
      // (the rim pushed in and out ±35 cm by a hash noise — a stroke reads as worked ground, not a circle)
      const d = Math.hypot(x - s.x, z - s.z) + (noise(x * 0.61, z * 0.61) - 0.5) * 0.7
      if (d > R) continue
      const k = j * n + i, o = k * 4
      if (!this.trailBase.has(k)) this.trailBase.set(k, (T[o] | (T[o + 1] << 8) | (T[o + 2] << 16) | (T[o + 3] << 24)) >>> 0)
      const w = Math.max(0, Math.min(1, (R - d) / (2 * RIM)))
      switch (s.mat) {
        case 'stone': case 'planks': T[o + 1] = Math.max(T[o + 1], Math.round(255 * w)); break
        case 'gravel': T[o] = Math.min(T[o], Math.round((Math.max(0, d - s.r + hw) / 8) * 255)); break
        case 'dirt': T[o + 2] = Math.max(T[o + 2], Math.round(235 * w)); break
        case 'erase': {
          if (w < 0.5) break
          const b = this.trailBase.get(k)!
          T[o] = b & 255; T[o + 1] = (b >>> 8) & 255; T[o + 2] = (b >>> 16) & 255; T[o + 3] = b >>> 24
        }
      }
      rows[0] = Math.min(rows[0], j); rows[1] = Math.max(rows[1], j)
    }
  }

  /** The claim's paving gone (its land given up): the map's own ground back where its strokes were. */
  private unpaint(map: MapData, id: string): void {
    const c = this.session.claims.get(id), T = map.trailTex.image.data as Uint8Array, g = map.inner, n = g.n
    let r0 = Infinity, r1 = -Infinity
    for (const [k, b] of this.trailBase) {
      if (c) { const x = g.origin + (k % n) * g.step, z = g.origin + Math.floor(k / n) * g.step; if ((x - c.x) ** 2 + (z - c.z) ** 2 > (c.r + 8) ** 2) continue }
      const o = k * 4
      T[o] = b & 255; T[o + 1] = (b >>> 8) & 255; T[o + 2] = (b >>> 16) & 255; T[o + 3] = b >>> 24
      this.trailBase.delete(k)
      const j = Math.floor(k / n); r0 = Math.min(r0, j); r1 = Math.max(r1, j)
    }
    this.laid.delete(id)
    if (r1 >= r0) map.trailTex.updateRows(r0, r1)
  }

  /** The claims with stone paving are paved frames (the terrain lays the flagstones square to each). */
  private framePaving(map: MapData): void {
    const w = this.world(), list = [...w.landmarks.paved]
    for (const [id, strokes] of this.session.paint) {
      const c = this.session.claims.get(id)
      if (c && strokes.some((s) => s.mat === 'stone' || s.mat === 'planks')) list.push(c.x, c.z, 0, c.r + 4)
    }
    void map
    w.terrain.setPaved(list)
  }

  // ================================================================================================ the ponds
  private pond(p: Pond, fill: boolean): void {
    const map = this.map()
    if (!map || this.ponds.has(p.id)) return
    // (its floor: the bowl's lowest — the water rises from there)
    let floor = p.level
    for (let a = 0; a < 8; a++) for (const f of [0, 0.3, 0.6]) floor = Math.min(floor, map.height(p.x + Math.cos(a) * p.r * f, p.z + Math.sin(a) * p.r * f))
    this.ponds.set(p.id, { p, t: fill ? 0 : FILL_S, floor })
    this.world().water.addDug(p.id, p.x, p.z, p.r, fill ? floor : p.level)
    map.dug.set(p.id, { x: p.x, z: p.z, r: p.r, level: fill ? floor : p.level })
    // (its ground — and the depth under it, which keeps the grass off its floor — once the dig has settled)
    if (this.anims.size) this.owning.add(p.id)
    else { this.own(map, p, true); this.world().grass.refresh() }
  }
  /** Ponds whose ground is written once the ground under them has settled. */
  private readonly owning = new Set<string>()

  /** The 4 m cells the pond's water may draw on (MapData.waterTex R; G its depth: no grass under it). */
  private own(map: MapData, p: Pond, on: boolean): void {
    const g = map.meta.mask, n = g.n, W = map.waterTex.image.data as Uint8Array
    const R = p.r + g.step * 1.5
    const i0 = Math.max(0, Math.floor((p.x - R - g.origin) / g.step)), i1 = Math.min(n - 1, Math.ceil((p.x + R - g.origin) / g.step))
    const j0 = Math.max(0, Math.floor((p.z - R - g.origin) / g.step)), j1 = Math.min(n - 1, Math.ceil((p.z + R - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * g.step, z = g.origin + j * g.step, d = Math.hypot(x - p.x, z - p.z), o = (j * n + i) * 4
      if (d > R) continue
      if (on) {
        W[o] = 255
        W[o + 1] = Math.max(0, Math.min(255, Math.round(128 + (p.level - map.height(x, z)) * 64)))
        W[o + 2] = Math.max(W[o + 2], Math.round(255 * Math.max(0, 1 - Math.max(0, d - p.r) / 24)))
      } else { W[o] = 0; W[o + 1] = 0 }
    }
    map.waterTex.updateRows(j0, j1)
  }

  private dropPond(id: string): void {
    const P = this.ponds.get(id), map = this.map()
    if (!P || !map) return
    this.ponds.delete(id)
    map.dug.delete(id)
    this.world().water.removeDug(id)
    this.own(map, P.p, false)
  }

  /** A claim given up: its ground, paving and ponds back to the map's. */
  private forget(id: string): void {
    const map = this.map()
    if (!map) return
    for (const [pid, P] of [...this.ponds]) if (P.p.claim === id) this.dropPond(pid)
    this.unpaint(map, id)
    // (its cells: each back to the map's own, eased)
    const g = map.inner, n = g.n
    for (const [k, b] of [...map.baseH]) {
      const i = k % n, j = Math.floor(k / n)
      if (this.owner(map, i, j) === null) { this.cell(map, k, b, true); map.baseH.delete(k) }
    }
    this.framePaving(map)
  }

  // ================================================================================================ each frame
  update(dt: number): void {
    const w = this.world(), map = this.map()
    if (!map) { this.worldId = ''; return }
    if (this.worldId !== w.id) {
      // (a world entered — or the valley loaded again after a crossing: its map fresh, nothing of ours on it yet)
      this.worldId = w.id
      this.anims.clear(); this.settled.clear(); this.trailBase.clear(); this.laid.clear(); this.ponds.clear(); this.owning.clear()
      this.all()
    }
    if (this.anims.size) {
      for (const [k, a] of this.anims) {
        a.t += dt
        const u = Math.min(1, a.t / EASE_S), e = 1 - (1 - u) ** 3
        map.inner.h[k] = a.from + (a.to - a.from) * e
        this.touch(map, k, a.to)
        if (u >= 1) this.anims.delete(k)
      }
      this.flush(map)
      if (!this.anims.size) {
        this.settle(map)
        for (const id of this.owning) { const P = this.ponds.get(id); if (P) this.own(map, P.p, true) }
        this.owning.clear()
      }
    }
    // the ponds filling (the level eased up: fast at first, slowing as it nears the brim)
    for (const [id, P] of this.ponds) {
      if (P.t >= FILL_S) continue
      P.t = Math.min(FILL_S, P.t + dt)
      const u = P.t / FILL_S, y = P.floor + (P.p.level - P.floor) * (1 - (1 - u) ** 2)
      w.water.setDugLevel(id, y)
      const d = map.dug.get(id)
      if (d) d.level = y
    }
    if (this.cacheT >= 0) { this.cacheT -= dt; if (this.cacheT < 0) w.terrain.cache?.invalidateNear() }
  }

  /** Is anything still easing (the harness waits for it). */
  get busy(): boolean { return this.anims.size > 0 || [...this.ponds.values()].some((P) => P.t < FILL_S) }
}

/** A value noise (0 … 1) on a unit lattice: the paving's rim. */
function noise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j
  const s = (a: number) => a * a * (3 - 2 * a)
  const h = (a: number, b: number) => { let q = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296 }
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * s(u), b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * s(u)
  return a + (b - a) * s(v)
}
