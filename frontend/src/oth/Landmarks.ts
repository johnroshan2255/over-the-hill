import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Builder, type CullPart, cullHidden, splitMeshes, woodMaterial } from './Bridges'
import type { Horizon } from './Horizon'
import type { Landmark, MapData } from './MapData'
import type { Tier } from './quality'
import type { TerrainShadow } from './TerrainShadow'
import { tentA as kitTentA } from './Kit'
import {
  type CaveStyle, cavern, type Ctx, cabin, cabinYard, camp as campOf, type CampStyle, FIRE_AT, fishingHut, garage, ghostHouse, hamlet,
  houseRuin, mineSite, PAINTS, pondDock, rangerStation, researchCamp, riverShelter, tunnel, wreck,
} from './Locations'
import { C as KC } from './Kit'

/**
 * LANDMARKS (2026-10-27, the user: "add those" — OTH's Canada: fire-watch towers above the forests, remote cabins,
 * fishing shacks, forgotten sawmills and mining tunnels, scenic viewpoints, fallen meteorites): the places
 * scripts/oth/scenery.mjs picked and levelled (`meta.landmarks`), built here from the bridges' kit — weathered logs and
 * planks, dark shingle roofs, field-stone, all flat-shaded in this world's light; a FIRE LOOKOUT's red roof stands out
 * from kilometres away (the haze leaves the far land readable); windows and lanterns GLOW warm at night. A mesh each
 * (~20 k vertices for all of them, one material), drawn only when in view and not behind the hills (`cull`; one
 * merged mesh over the whole map was drawn from everywhere). Each has its COLLIDERS (Physics.ts: boxes; a dock's deck is ground),
 * and is DISCOVERED when the car comes within ~40 m of its pad — saved in this browser (localStorage), shown on the
 * map and the compass (MapView.ts).
 */
export interface LandmarkCollider { c: GFX.Vector3; h: GFX.Vector3; q: GFX.Quaternion; ground: boolean }

const KEY = (id: string) => `oth.found.${id}`

export class Landmarks {
  readonly group = new GFX.Group()
  readonly list: Landmark[]
  readonly colliders: LandmarkCollider[] = []
  readonly found = new Set<number>()
  /** Called when a landmark is first reached (main.ts: a toast, the map). */
  onDiscover: ((l: Landmark, found: number, total: number) => void) | null = null
  /** The hills' occlusion (main.ts). */
  horizon: Horizon | null = null
  private checkT = 0
  private parts: CullPart[] = []

  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, footprint?: GFX.DataTexture) {
    this.list = map.meta.landmarks ?? []
    try { for (const id of JSON.parse(localStorage.getItem(KEY(map.meta.id)) ?? '[]') as number[]) this.found.add(id) } catch { /* (private window: nothing kept) */ }
    if (!this.list.length) return
    const b = new Builder(0x51a3c7), ranges: [number, number][] = []
    const fp = footprint?.image.data as Uint8Array | undefined, gi = map.inner
    this.reach = tier.rockReach + 100
    for (const l of this.list) {
      const from = b.count, cols: [GFX.Vector3, GFX.Vector3, boolean][] = []
      const col = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ground = false) => cols.push([new GFX.Vector3(cx, cy, cz), new GFX.Vector3(hx, hy, hz), ground])
      const S = SCALE[l.kind] ?? 1, cr = Math.cos(l.rot), sr = Math.sin(l.rot)
      const wx = (lx: number, lz: number) => l.x + (lx * cr + lz * sr) * S, wz = (lx: number, lz: number) => l.z + (-lx * sr + lz * cr) * S
      // THE GROUND under a local point (2026-11-06: what stands round a place reaches the real ground — Kit.ts)
      const g = (lx: number, lz: number) => (map.height(wx(lx, lz), wz(lx, lz)) - l.y) / S
      // the grass kept off a local box (floors, decks, yards): stamped into the rocks' footprint (Grass.ts reads it)
      const clear = (cx: number, cz: number, hx: number, hz: number, rot = 0) => {
        if (!fp) return
        const x0 = wx(cx, cz), z0 = wz(cx, cz), a = l.rot + rot, ca = Math.cos(a), sa = Math.sin(a), R = Math.hypot(hx, hz) * S + 1
        const i0 = Math.max(0, Math.floor((x0 - R - gi.origin) / gi.step)), i1 = Math.min(gi.n - 1, Math.ceil((x0 + R - gi.origin) / gi.step))
        const j0 = Math.max(0, Math.floor((z0 - R - gi.origin) / gi.step)), j1 = Math.min(gi.n - 1, Math.ceil((z0 + R - gi.origin) / gi.step))
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const dx = gi.origin + i * gi.step - x0, dz = gi.origin + j * gi.step - z0
          const u = Math.abs(dx * ca - dz * sa) / S - hx, v = Math.abs(dx * sa + dz * ca) / S - hz
          const v8 = Math.round(255 * Math.min(1, Math.max(0, 1 - Math.max(u, v) / 0.8)))
          if (v8 > fp[j * gi.n + i]) fp[j * gi.n + i] = v8
        }
      }
      const ctx: Ctx = { b, g, col, clear, seed: (l.id * 7919 + 13) >>> 0 }
      if (PLACES[l.kind]) PLACES[l.kind]!(ctx, l, map)
      else KINDS[l.kind]?.(b, l, col, map) // (the desert's kinds: their shapes are Blender's — formations.glb)
      const m = new GFX.Matrix4().compose(new GFX.Vector3(l.x, l.y, l.z), new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(0, 1, 0), l.rot), new GFX.Vector3(S, S, S))
      b.transform(from, m)
      const q = new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(0, 1, 0), l.rot)
      for (const [c, h, ground] of cols) this.colliders.push({ c: c.applyMatrix4(m), h: h.multiplyScalar(S), q, ground })
      ranges.push([from, b.count])
    }
    this.parts = splitMeshes(b, ranges, woodMaterial(atmos, shadow, tier, farGrid), this.group)
    if (footprint) footprint.needsUpdate = true
  }

  /** Skip the landmarks the hills hide and (2026-11-06) the places past the tier's reach — the rocks' (900 m ULTRA …
   *  600 LOW): a cabin's shingles 1 km off are a few pixels; the fire lookouts and their red roofs are seen from
   *  anywhere (once a frame; the view culls the rest). */
  cull(cam?: GFX.Vector3): void {
    cullHidden(this.parts, this.horizon)
    if (!cam) return
    const R2 = this.reach * this.reach
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i], l = this.list[i]
      if (!p.obj.visible || l?.kind === 'tower') continue
      const dx = (p.box.min.x + p.box.max.x) / 2 - cam.x, dz = (p.box.min.z + p.box.max.z) / 2 - cam.z
      if (dx * dx + dz * dz > R2) p.obj.visible = false
    }
  }
  private reach = 900

  /** Discover what the car (x, z) has reached (checked twice a second). */
  update(dt: number, x: number, z: number): void {
    if ((this.checkT -= dt) > 0) return
    this.checkT = 0.5
    for (const l of this.list) {
      if (this.found.has(l.id) || (l.x - x) ** 2 + (l.z - z) ** 2 > (l.r + 40) ** 2) continue
      this.found.add(l.id)
      try { localStorage.setItem(KEY(this.map.meta.id), JSON.stringify([...this.found])) } catch { /* (not kept) */ }
      this.onDiscover?.(l, this.found.size, this.list.length)
    }
  }
}

// ---------------------------------------------------------------------------------------------------- the base camp
/** THE BASE CAMP (2026-11-04 — the user, a gameplay frame: "camps must look like this — big, the style, the size"):
 *  at full vehicle scale behind the tent — an EXPEDITION CAMPER (a 4×4 truck, a box body, the roof rack's spare wheels
 *  and cargo box, a ladder, an awning on poles, a roll-up rear door and its loading ramp), a car-hauler TRAILER with a
 *  tarped load, two ground TARPS, a TOOL CHEST on castors, JACK STANDS, stacked TYRES, JERRYCANS, a folding TABLE and
 *  CHAIRS, STRING LIGHTS that glow from dusk. Our own colours. Local frame: the camp faces +z; colliders by `col`. */
const PAINT: RGB = [0.42, 0.33, 0.16], PAINT_DARK: RGB = [0.27, 0.21, 0.1], BODY: RGB = [0.62, 0.58, 0.48]
const RUBBER: RGB = [0.045, 0.045, 0.05], HUB: RGB = [0.32, 0.32, 0.34], STEEL: RGB = [0.22, 0.22, 0.24]
const TARP: RGB = [0.14, 0.22, 0.2], TARP2: RGB = [0.3, 0.22, 0.12], AWNING: RGB = [0.55, 0.52, 0.45], CHEST: RGB = [0.08, 0.2, 0.26]
/** A wheel: a tyre (a short fat cylinder) and its hub, its axle along `ax` (unit), centre c. */
function wheel(b: Builder, c: GFX.Vector3, ax: GFX.Vector3, r: number, w: number) {
  b.log(c.clone().addScaledVector(ax, -w / 2), c.clone().addScaledVector(ax, w / 2), r, RUBBER)
  b.log(c.clone().addScaledVector(ax, -w / 2 - 0.01), c.clone().addScaledVector(ax, w / 2 + 0.01), r * 0.55, HUB)
}
export function baseCamp(b: Builder, col?: Col): void {
  // THE CAMPER: along x behind the tent, its side (windows, awning, ladder) facing the camp (+z)
  const cx = -1.2, cz = -7.4, wy = 0.62
  box(b, cx - 0.4, 0.98, cz, 3.9, 0.16, 0.8, STEEL)                                   // the chassis rails
  for (const x of [cx - 2.6, cx + 2.2]) for (const s of [-1, 1]) wheel(b, V(x, wy, cz + s * 1.08), Z, wy, 0.42)
  for (const x of [cx - 2.6, cx + 2.2]) for (const s of [-1, 1]) box(b, x, 1.32, cz + s * 1.12, 0.78, 0.06, 0.24, RUBBER) // mudguards
  // the cab: forward (+x), its windscreen and side windows
  const kx = cx + 2.75
  box(b, kx, 1.95, cz, 0.85, 0.82, 1.18, PAINT)
  box(b, kx + 0.5, 1.5, cz, 0.4, 0.38, 1.16, PAINT_DARK)                              // the bonnet's nose
  b.quad(V(kx + 0.86, 2.15, cz - 1.0), V(kx + 0.86, 2.15, cz + 1.0), V(kx + 0.86, 2.7, cz + 0.98), V(kx + 0.86, 2.7, cz - 0.98), GLASS)
  for (const s of [-1, 1]) box(b, kx + 0.15, 2.38, cz + s * 1.19, 0.5, 0.26, 0.005, GLASS)
  box(b, kx + 1.0, 1.05, cz, 0.12, 0.14, 1.22, STEEL)                                 // the bumper
  b.setGlow(0.5); for (const s of [-1, 1]) box(b, kx + 0.92, 1.42, cz + s * 0.82, 0.04, 0.09, 0.14, [0.5, 0.48, 0.4]); b.setGlow(0)
  // the box body: its roof a touch lighter, a band low along it, two windows and a door on the camp's side
  const bx = cx - 1.05, bl = 2.95
  box(b, bx, 2.42, cz, bl, 1.3, 1.26, BODY)
  box(b, bx, 3.76, cz, bl - 0.06, 0.05, 1.22, shade(BODY, 1.08))
  box(b, bx, 1.33, cz + 1.27, bl, 0.08, 0.005, PAINT_DARK)
  for (const x of [bx - 1.6, bx + 0.6]) { box(b, x, 2.75, cz + 1.27, 0.55, 0.36, 0.006, GLASS); box(b, x, 2.75, cz + 1.268, 0.62, 0.42, 0.004, shade(BODY, 0.7)) }
  box(b, bx + 1.85, 2.3, cz + 1.27, 0.42, 0.95, 0.006, shade(BODY, 0.82))           // the side door
  col?.(cx - 0.3, 2.0, cz, 4.0, 1.9, 1.3)
  // the ROLL-UP DOOR at the back (−x), up: its slats, and the LOADING RAMP down from the floor
  const rx = bx - bl
  for (let k = 0; k < 6; k++) box(b, rx - 0.01, 1.55 + k * 0.33, cz, 0.012, 0.13, 1.12, shade(BODY, k % 2 ? 0.9 : 0.78))
  for (const s of [-0.55, 0.55]) {
    const t0 = V(rx - 0.05, 1.3, cz + s), t1 = V(rx - 3.3, 0.02, cz + s), w = 0.32
    b.quad(t0.clone().add(V(0, 0, -w)), t0.clone().add(V(0, 0, w)), t1.clone().add(V(0, 0, w)), t1.clone().add(V(0, 0, -w)), s < 0 ? shade(BODY, 0.85) : DARK)
  }
  // the ROOF RACK: rails, two spare wheels laid flat, a black cargo box, a long kayak
  for (const s of [-1, 1]) b.log(V(bx - bl + 0.2, 3.98, cz + s * 1.05), V(bx + bl - 0.2, 3.98, cz + s * 1.05), 0.035, STEEL)
  for (const x of [bx - 1.9, bx - 0.6]) wheel(b, V(x, 4.05, cz - 0.35), Y, 0.5, 0.36)
  box(b, bx + 1.4, 4.12, cz - 0.1, 0.75, 0.3, 0.6, [0.05, 0.05, 0.055])
  b.box(V(bx + 0.2, 4.1, cz + 0.72), X, Y, Z, 2.6, 0.13, 0.3, [0.5, 0.36, 0.12])     // the kayak
  // the LADDER up the side, by the back
  for (const s of [-0.24, 0.24]) b.log(V(rx + 0.55 + s, 0.05, cz + 1.4), V(rx + 0.55 + s, 3.95, cz + 1.3), 0.025, STEEL)
  for (let k = 1; k < 12; k++) { const y = k * 0.33; b.log(V(rx + 0.31, y, cz + 1.4 - y * 0.026), V(rx + 0.79, y, cz + 1.4 - y * 0.026), 0.018, STEEL) }
  // the AWNING: off the body's top edge, out over the camp on two poles
  const a0 = V(bx - 2.4, 3.55, cz + 1.3), a1 = V(bx + 2.2, 3.55, cz + 1.3), a2 = V(bx + 2.2, 2.75, cz + 4.4), a3 = V(bx - 2.4, 2.75, cz + 4.4)
  b.quad(a0, a1, a2, a3, AWNING); b.quad(a3, a2, a1, a0, shade(AWNING, 0.8))
  for (const x of [bx - 2.4, bx + 2.2]) b.log(V(x, 0, cz + 4.4), V(x, 2.78, cz + 4.4), 0.03, STEEL)
  // THE TRAILER: a car-hauler deck on two wheels, its A-frame to the camper's hitch side, a tarped load on it
  const tx = 9.6, tz = -6.6
  box(b, tx, 0.78, tz, 2.6, 0.08, 1.1, STEEL)
  for (const s of [-1, 1]) wheel(b, V(tx - 0.2, 0.36, tz + s * 1.2), Z, 0.36, 0.24)
  b.log(V(tx - 2.6, 0.7, tz - 0.8), V(tx - 3.9, 0.55, tz), 0.04, STEEL); b.log(V(tx - 2.6, 0.7, tz + 0.8), V(tx - 3.9, 0.55, tz), 0.04, STEEL)
  box(b, tx, 1.35, tz, 2.1, 0.5, 0.95, [0.6, 0.6, 0.58])                               // the tarped load
  box(b, tx + 0.2, 2.0, tz, 1.2, 0.2, 0.85, [0.56, 0.56, 0.54])
  col?.(tx, 1.2, tz, 2.6, 1.0, 1.2)
  // TWO TARPS on the ground: the workshop's, the table's
  box(b, 3.6, 0.025, -1.6, 3.2, 0.02, 2.4, TARP)
  box(b, -5.6, 0.025, -2.6, 2.2, 0.02, 1.8, TARP2)
  // the TOOL CHEST on castors, its drawers
  const ch = V(-6.7, 0, -2.2)
  box(b, ch.x, 0.62, ch.z, 0.55, 0.5, 0.32, CHEST)
  for (let k = 0; k < 5; k++) box(b, ch.x, 0.3 + k * 0.17, ch.z + 0.33, 0.5, 0.06, 0.01, shade(CHEST, 1.5))
  box(b, ch.x, 1.16, ch.z, 0.57, 0.04, 0.34, [0.12, 0.12, 0.13])
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.24, 0.24]) b.log(V(ch.x + sx, 0, ch.z + sz), V(ch.x + sx, 0.12, ch.z + sz), 0.05, RUBBER)
  col?.(ch.x, 0.6, ch.z, 0.6, 0.6, 0.35)
  // JACK STANDS on the workshop tarp, three pyramids of rods and a saddle
  for (const [jx, jz] of [[2.2, -2.6], [4.9, -2.4], [3.5, -0.4]]) {
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; b.log(V(jx + Math.cos(a) * 0.26, 0.04, jz + Math.sin(a) * 0.26), V(jx, 0.5, jz), 0.025, [0.5, 0.36, 0.06]) }
    b.log(V(jx, 0.45, jz), V(jx, 0.66, jz), 0.03, STEEL)
  }
  // TYRES: a stack of three, a pair leaning, one lying by the trailer
  for (let k = 0; k < 3; k++) wheel(b, V(6.4, 0.16 + k * 0.32, -3.3), Y, 0.48, 0.3)
  for (const [x, z, a] of [[1.0, -3.4, 0.25], [1.5, -3.5, 0.1]] as const) wheel(b, V(x, 0.46, z), V(Math.cos(a), 0, Math.sin(a)).applyAxisAngle(Y, 0), 0.46, 0.3)
  wheel(b, V(11.8, 0.15, -4.4), Y, 0.4, 0.26)
  // JERRYCANS by the camper's cab
  for (let k = 0; k < 3; k++) box(b, cx + 3.9 + k * 0.4, 0.26, cz + 1.8, 0.17, 0.26, 0.09, k === 1 ? [0.38, 0.06, 0.04] : [0.12, 0.2, 0.08])
  // a folding TABLE and two CHAIRS on the table's tarp
  const tb = V(-5.4, 0, -2.8)
  box(b, tb.x, 0.74, tb.z, 0.6, 0.025, 0.4, [0.75, 0.72, 0.64])
  for (const sx of [-0.52, 0.52]) for (const sz of [-0.32, 0.32]) b.log(V(tb.x + sx, 0, tb.z + sz), V(tb.x + sx, 0.73, tb.z + sz), 0.015, STEEL)
  for (const [x, z, a] of [[-4.5, -1.8, 0.4], [-6.2, -1.7, -0.5]] as const) {
    const u = V(Math.cos(a), 0, Math.sin(a)), w = V(-Math.sin(a), 0, Math.cos(a))
    b.box(V(x, 0.42, z), u, Y, w, 0.24, 0.02, 0.24, [0.15, 0.24, 0.22])
    b.box(V(x, 0.7, z).addScaledVector(w, -0.25), u, Y, w, 0.24, 0.26, 0.02, [0.15, 0.24, 0.22])
    for (const su of [-0.22, 0.22]) b.log(V(x, 0, z).addScaledVector(u, su).addScaledVector(w, 0.2), V(x, 0.42, z).addScaledVector(u, su).addScaledVector(w, -0.2), 0.012, STEEL)
  }
  // STRING LIGHTS: from the awning's front corner out to a pole by the fire, sagging; the bulbs glow from dusk
  const p0 = V(bx + 2.2, 2.75, cz + 4.4), pole = V(4.6, 0, 2.6), p1 = pole.clone().setY(2.6)
  b.log(pole, p1, 0.035, STEEL)
  const n = 14
  for (let k = 0; k <= n; k++) {
    const t = k / n, q = p0.clone().lerp(p1, t); q.y -= Math.sin(Math.PI * t) * 0.55
    if (k < n) { const r = p0.clone().lerp(p1, (k + 1) / n); r.y -= Math.sin((Math.PI * (k + 1)) / n) * 0.55; b.log(q, r, 0.006, DARK) }
    b.setGlow(0.8); box(b, q.x, q.y - 0.05, q.z, 0.035, 0.045, 0.035, [0.55, 0.45, 0.25]); b.setGlow(0)
  }
}

// ---------------------------------------------------------------------------------------------------- the kit
type Col = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ground?: boolean) => void
type RGB = [number, number, number]
/** REAL SIZES (2026-11-02, the user: "the car is almost as big as some buildings — keep the size ratio"): the cars are
 *  real (the G500 4×4² 4.7 m long, 1.9 m tall); a trapper's cabin is ~7 × 5.5 m with ~3 m log walls, a sawmill's shed
 *  ~15 × 7.5 m — the kit's cabin (5.2 × 4.2, walls 2.4) and shed (12 × 6) drawn ×1.3 / ×1.25 (they still fit their
 *  levelled pads). The lookout (13 m), the shack (its dock sits at the lake's level), the mine's adit and the camps
 *  are real as built. */
const SCALE: Partial<Record<Landmark['kind'], number>> = { sawmill: 1.25 } // (the cabins: real size in Locations.ts since 2026-11-06)
const V = (x: number, y: number, z: number) => new GFX.Vector3(x, y, z)
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1)
const ROOF: RGB = [0.13, 0.095, 0.075], RED_ROOF: RGB = [0.46, 0.13, 0.08], TIN: RGB = [0.4, 0.27, 0.18]
const STONE: RGB = [0.4, 0.4, 0.41], DARK: RGB = [0.035, 0.03, 0.028], GLASS: RGB = [0.06, 0.065, 0.075]
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
/** An axis-aligned box in the landmark's own frame. */
const box = (b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: RGB) => b.box(V(cx, cy, cz), X, Y, Z, hx, hy, hz, c)
/** A gable ROOF over a w × d footprint, its ridge along z, eaves at y0, the ridge h higher, an overhang; slabs (both
 *  sides drawn) and the two gable ends' triangles down to the walls' top (wallY). */
function gable(b: Builder, w: number, d: number, y0: number, h: number, over: number, c: RGB, gableC: RGB, wallY = y0) {
  const W = w / 2 + over, D = d / 2 + over, Ls = Math.hypot(W, h)
  for (const sx of [-1, 1]) {
    const u = V(-sx * W, h, 0).normalize(), n = V(sx * h, W, 0).normalize()
    b.box(V((sx * W) / 2, y0 + h / 2, 0), u, n, Z, Ls / 2, 0.07, D, shade(c, sx > 0 ? 1 : 0.92))
  }
  const hi = y0 + h * ((W - over) / W)
  for (const sz of [-1, 1]) {
    const z = (sz * d) / 2, a = V(-w / 2, wallY, z), c2 = V(w / 2, wallY, z), t = V(0, hi, z)
    if (sz > 0) { b.tri(a, c2, t, gableC); b.tri(c2, a, t, shade(gableC, 0.7)) } else { b.tri(c2, a, t, gableC); b.tri(a, c2, t, shade(gableC, 0.7)) }
  }
}
/** A pyramid (hip) roof over a square of half size s at y0, apex h above. */
function hip(b: Builder, s: number, y0: number, h: number, c: RGB) {
  const ap = V(0, y0 + h, 0), cs = [V(-s, y0, -s), V(s, y0, -s), V(s, y0, s), V(-s, y0, s)]
  for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4]; b.tri(q, p, ap, shade(c, 0.85 + 0.15 * (i % 2))); b.tri(p, q, ap, shade(c, 0.6)) }
}
/** A window: a dark frame proud of the wall, glass that glows at night (normal along `out`). */
function windowAt(b: Builder, c: GFX.Vector3, out: GFX.Vector3, along: GFX.Vector3, hw: number, hh: number) {
  b.box(c, along, Y, out, hw + 0.08, hh + 0.08, 0.05, b.wood(0.6))
  b.setGlow(1)
  b.box(c.clone().addScaledVector(out, 0.04), along, Y, out, hw, hh, 0.03, GLASS)
  b.setGlow(0)
}

const KINDS: Partial<Record<Landmark['kind'], (b: Builder, l: Landmark, col: Col, map: MapData) => void>> = {
  /** FIRE LOOKOUT: four splayed log legs 13 m up, X-braced, a ladder; on top a catwalk with a rail round the cab (lit
   *  windows all round), its RED hip roof seen from afar. */
  tower(b, _l, col) {
    const H = 13, base = 2.4, top = 1.7
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.log(V(sx * base, -0.8, sz * base), V(sx * top, H, sz * top), 0.17, b.wood(0.85))
      col(sx * (base + top) / 2, H / 2, sz * (base + top) / 2, 0.3, H / 2, 0.3)
    }
    // X braces on each side at three levels
    for (let lv = 0; lv < 3; lv++) {
      const y0 = 0.6 + lv * 4.1, y1 = y0 + 4.1, k0 = base + (top - base) * (y0 / H), k1 = base + (top - base) * (y1 / H)
      for (let s = 0; s < 4; s++) {
        const a = (s * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a), t = (k: number, side: number) => V(ca * k - sa * k * side, 0, sa * k + ca * k * side)
        const p0 = t(k0, -1).setY(y0), p1 = t(k1, 1).setY(y1), p2 = t(k0, 1).setY(y0), p3 = t(k1, -1).setY(y1)
        b.log(p0, p1, 0.07, b.wood(0.75)); b.log(p2, p3, 0.07, b.wood(0.75))
      }
    }
    // the ladder up the front face
    const lz = base + 0.25
    for (const sx of [-0.35, 0.35]) b.log(V(sx, 0, lz), V(sx, H, top + 0.25), 0.05, b.wood(0.8))
    for (let r = 0; r < 26; r++) { const t = r / 26, y = t * H, z = lz + (top + 0.25 - lz) * t; b.log(V(-0.35, y, z), V(0.35, y, z), 0.035, b.wood(0.8)) }
    // the catwalk floor, its rail, the cab with windows, the red roof
    box(b, 0, H + 0.12, 0, 2.6, 0.12, 2.6, b.wood(0.9))
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a)
      const p = (u: number, v: number) => V(ca * u - sa * v, 0, sa * u + ca * v)
      b.log(p(-2.55, 2.55).setY(H + 1.2), p(2.55, 2.55).setY(H + 1.2), 0.05, b.wood(0.85))
      b.log(p(2.55, 2.55).setY(H + 0.24), p(2.55, 2.55).setY(H + 1.25), 0.05, b.wood(0.85))
    }
    box(b, 0, H + 0.24 + 0.5, 0, 1.6, 0.5, 1.6, b.wood(1.05))
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2, out = V(Math.sin(a), 0, Math.cos(a)), along = V(Math.cos(a), 0, -Math.sin(a))
      windowAt(b, out.clone().multiplyScalar(1.6).setY(H + 1.65), out, along, 1.25, 0.42)
    }
    box(b, 0, H + 2.15, 0, 1.62, 0.08, 1.62, b.wood(0.7))
    hip(b, 2.1, H + 2.2, 1.4, RED_ROOF)
  },

  /** VIEWPOINT: a stone cairn, a bench looking out over the drop, a signpost and a short log rail at the edge. */
  view(b, _l, col) {
    for (let i = 0; i < 4; i++) box(b, -2.2 + (i % 2) * 0.1, 0.22 + i * 0.36, -1.2, 0.62 - i * 0.12, 0.18, 0.55 - i * 0.1, shade(STONE, 0.85 + 0.1 * (i % 2)))
    col(-2.2, 0.75, -1.2, 0.65, 0.75, 0.6)
    box(b, 0, 0.45, 0.6, 1.0, 0.05, 0.22, b.wood())
    box(b, 0, 0.75, 0.42, 1.0, 0.18, 0.03, b.wood())
    for (const sx of [-0.85, 0.85]) box(b, sx, 0.22, 0.6, 0.05, 0.22, 0.18, b.wood(0.7))
    col(0, 0.45, 0.6, 1.05, 0.45, 0.3)
    b.log(V(2.2, -0.3, -0.6), V(2.2, 2.3, -0.6), 0.08, b.wood(0.8))
    box(b, 2.2, 2.0, -0.5, 0.55, 0.16, 0.03, b.wood(1.1))
    col(2.2, 1.1, -0.6, 0.15, 1.1, 0.15)
    for (const sx of [-2.6, 0, 2.6]) b.log(V(sx, -0.3, 2.6), V(sx, 0.9, 2.6), 0.08, b.wood(0.8))
    b.log(V(-2.9, 0.8, 2.6), V(2.9, 0.8, 2.6), 0.07, b.wood(0.85))
    col(0, 0.5, 2.6, 3.0, 0.5, 0.15)
  },

  /** SAWMILL: an open shed on posts under a long rusty-tin gable roof, the saw bench in it, stacked LOG PILES in the
   *  yard, a sawdust heap and a little office hut. */
  sawmill(b, _l, col) {
    const L = 12, W = 6, Hh = 3.6
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
      const z = -L / 2 + (i * L) / 3
      b.log(V((sx * W) / 2, -0.3, z), V((sx * W) / 2, Hh, z), 0.13, b.wood(0.8))
      col((sx * W) / 2, Hh / 2, z, 0.18, Hh / 2, 0.18)
    }
    for (const sx of [-1, 1]) b.log(V((sx * W) / 2, Hh, -L / 2 - 0.3), V((sx * W) / 2, Hh, L / 2 + 0.3), 0.12, b.wood(0.75))
    gable(b, W, L, Hh + 0.1, 1.6, 0.5, TIN, b.wood(0.8))
    // the saw bench, a log on it, the blade
    box(b, 0, 0.45, 0, 0.6, 0.45, 4.2, b.wood(0.7))
    b.log(V(0, 1.15, -3.8), V(0, 1.15, 1.0), 0.3, b.wood(1.15))
    b.box(V(0, 1.2, 2.0), Y, Z, X, 0.55, 0.55, 0.02, [0.55, 0.56, 0.58])
    col(0, 0.6, 0, 0.7, 0.6, 4.2)
    // log piles in the yard: pyramids of long logs
    for (const [px, pz] of [[W / 2 + 3.5, -3.5], [W / 2 + 3.5, 2.5], [-W / 2 - 3.8, 4]] as const) {
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - r; i++) {
        const x = px - 0.95 + i * 0.62 + r * 0.31, y = 0.3 + r * 0.53
        b.log(V(x, y, pz - 2.6), V(x, y, pz + 2.6), 0.3, b.wood(1.1))
      }
      col(px, 1.0, pz, 1.4, 1.0, 2.7)
    }
    // the sawdust heap
    const sd: RGB = [0.62, 0.48, 0.3], hc = V(-W / 2 - 2.6, 0, -3.5), ring: GFX.Vector3[] = []
    for (let a = 0; a < 8; a++) ring.push(V(hc.x + Math.cos((a / 8) * 6.283) * 2.0, -0.1, hc.z + Math.sin((a / 8) * 6.283) * 1.6))
    for (let a = 0; a < 8; a++) b.tri(ring[(a + 1) % 8], ring[a], V(hc.x, 1.1, hc.z), shade(sd, 0.9 + 0.1 * (a % 2)))
    // the office hut
    box(b, -W / 2 - 3.2, 1.2, 1.2 - 4, 1.4, 1.2, 1.2, b.wood(0.95))
    windowAt(b, V(-W / 2 - 3.2 + 1.42, 1.4, -2.8), X, Z, 0.35, 0.3)
    gable(b, 2.8, 2.4, 2.4, 0.9, 0.25, ROOF, b.wood(0.85))
    col(-W / 2 - 3.2, 1.2, -2.8, 1.5, 1.2, 1.3)
  },

  /** METEORITE: a dark scorched boulder in its crater, cracks glowing ember-orange at night, chips scattered round. */
  /** The HIDDEN PLACES (terrain.py builds them — the basin, its fall and pool, the flowers): nothing to add. */
  falls() {},
  meadow() {},
  meteorite(b, _l, col) {
    const ico = new GFX.IcosahedronGeometry(1, 1), pos = ico.getAttribute('position')
    const pts: GFX.Vector3[] = []
    for (let i = 0; i < pos.count; i++) {
      const p = V(pos.getX(i), pos.getY(i), pos.getZ(i))
      const k = 1.5 + 0.35 * Math.sin(p.x * 5.1 + p.y * 3.3) * Math.cos(p.z * 4.7)
      pts.push(p.multiply(V(k * 1.15, k * 0.8, k)).add(V(0, 0.9, 0)))
    }
    for (let i = 0; i < pts.length; i += 3) {
      const glow = (i / 3) % 7 === 3
      if (glow) b.setGlow(0.7)
      b.tri(pts[i], pts[i + 1], pts[i + 2], glow ? [0.35, 0.12, 0.04] : shade([0.1, 0.09, 0.085], 0.8 + b.rnd() * 0.4))
      if (glow) b.setGlow(0)
    }
    col(0, 0.9, 0, 1.6, 1.0, 1.6)
    for (let i = 0; i < 9; i++) {
      const a = b.rnd() * 6.283, r = 3 + b.rnd() * 5, s = 0.15 + b.rnd() * 0.25
      b.box(V(Math.cos(a) * r, s * 0.6, Math.sin(a) * r), X, Y, Z, s, s * 0.7, s * 1.2, shade([0.12, 0.11, 0.1], 0.8 + b.rnd() * 0.5))
    }
  },
}

/** Where a camp's fire burns (local: the flames and the fire's light — Props.ts): Locations' FIRE_AT. */
export const FIRE_LOCAL = FIRE_AT

/** THE PLACES COMPOSED (Locations.ts — 2026-11-06): the cabins each their own story, the mine's whole site, the fishing
 *  hut, the camps in their styles, and the new places (Sites.ts). Each sets what lights up at night and where a fire
 *  burns (Props.ts reads them). */
const LIT = 2.25 // (a window's centre: floor 0.5 + 1.75)
const PLACES: Partial<Record<Landmark['kind'], (c: Ctx, l: Landmark, map: MapData) => void>> = {
  cabin(c, l) {
    const story = l.style ?? (l.name.startsWith('Trapper') ? 'trapper' : l.name.startsWith('Pond') ? 'pond' : l.name.startsWith('Birch') ? 'birch' : l.name.startsWith('Old') ? 'ruin' : ['trapper', 'pond', 'birch', 'ruin'][l.id % 4])
    if (story === 'trapper') cabin(c, { walls: 'log', roof: KC.shingle, state: 'lived', chimney: 'stone' })
    else if (story === 'pond') cabin(c, { walls: 'clap', paint: PAINTS.red, trim: KC.trim, roof: KC.shingleGrey, state: 'lived', shutters: PAINTS.green, chimney: 'pipe' })
    else if (story === 'birch') cabin(c, { walls: 'batten', paint: PAINTS.slate, trim: PAINTS.white, roof: KC.greenRoof, tin: true, state: 'lived', chimney: 'stone', shutters: PAINTS.mustard })
    else cabin(c, { walls: 'clap', paint: PAINTS.mustard, trim: KC.trim, roof: KC.shingleGrey, state: 'ruin', chimney: 'stone' })
    cabinYard(c, story as 'trapper' | 'pond' | 'birch' | 'ruin')
    if (story !== 'ruin') l.lights = [[-2.2, LIT, 3.6], [4.6, LIT, -0.6], [-4.6, LIT, -0.6]]
    // (their chimneys smoke: the stone one's top, the pond cabin's stovepipe)
    if (story === 'trapper' || story === 'birch') l.smoke = [-4.7, 7.3, -0.8]
    if (story === 'pond') l.smoke = [-1.8, 6.5, -1.0]
  },
  shack(c, l, map) { fishingHut(c, map.meta.water.lake.level - l.y); l.lights = [[-1.1, 1.9, 2.1]]; l.smoke = [-1.4, 4.7, -0.8] },
  mine(c) { mineSite(c) },
  camp(c, l) {
    const water = /Lake|Loon|Driftwood|River|Gravel|Alder|Still|Reed|Lily/.test(l.name)
    const st = (l.style as CampStyle | undefined) ?? (['expedition', 'hikers', 'fishers', 'abandoned'] as const)[l.id % 4]
    const style: CampStyle = st === 'fishers' && !water ? 'hikers' : st === 'expedition' && water && l.id % 8 < 4 ? 'fishers' : st
    l.style = style
    if (style === 'expedition') { campKit(c.b, c.col); baseCamp(c.b, c.col); c.clear(0, -2, 8, 6) } else campOf(c, style)
    if (style !== 'abandoned') { l.fire = [FIRE_AT.x, FIRE_AT.z]; l.lights = [[FIRE_AT.x - 3.6, 1.72, FIRE_AT.z + 0.4]] }
    if (style === 'hikers' || style === 'expedition') l.smoke = [FIRE_AT.x, 0.6, FIRE_AT.z]
  },
  tunnel(c, l, map) {
    // (the hill's turf takes the land's own dryness and forest floor where it stands)
    const cr = Math.cos(l.rot), sr = Math.sin(l.rot), mk: [number, number, number, number] = [0, 0, 0, 0]
    tunnel(c, l.dark ? l.dark.z1 - l.dark.z0 - 2 : 30, (x, z) => { const m = map.maskAt(l.x + x * cr + z * sr, l.z - x * sr + z * cr, mk); return [m[1], m[3]] })
    l.fire = [3.9, 3]
  },
  grotto(c, l, map) {
    // (a one-way cave in its own hill — Locations.cavern: its style the place's; the turf the land's own paint)
    const cr = Math.cos(l.rot), sr = Math.sin(l.rot), mk: [number, number, number, number] = [0, 0, 0, 0]
    const fire = cavern(c, (l.style ?? 'hall') as CaveStyle, (x, z) => { const m = map.maskAt(l.x + x * cr + z * sr, l.z - x * sr + z * cr, mk); return [m[1], m[3]] })
    if (fire) l.fire = fire
  },
  ghost(c) { ghostHouse(c) },
  ruin(c, l) { houseRuin(c, l.id % 2 === 0) },
  ranger(c, l) { rangerStation(c); l.lights = [[-2.2, LIT, 3.6]] },
  garage(c) { garage(c) },
  shelter(c, l) { riverShelter(c); l.fire = [0, 3.6]; if (l.id % 2) l.smoke = [0, 0.6, 3.6] },
  hamlet(c) { hamlet(c) },
  research(c, l) { researchCamp(c); l.lights = [[0.2, 0.9, -0.3]] },
  dock(c, l) { pondDock(c, Number(l.style ?? 0) - l.y, l.id) },
  wreck(c, l) { wreck(c, Number(l.style ?? 0) - l.y) },
}
const CANVAS: RGB = [0.62, 0.22, 0.05]

/** A CAMP: an orange A-frame canvas tent (its door open, dark inside), a ring of stones round crossed logs (the
 *  embers glow from dusk), two log seats, a lantern on a pole, a red cooler. ~1.4 k vertices. Local frame: the camp
 *  faces +z (the view); `col` takes its colliders (the player's camp: none). */
export function campKit(b: Builder, col?: Col): void {
  // the tent (2026-11-06: a big canvas wall tent — the user: "tents too small beside our vehicles and people"): Kit's
  // A-frame, its ridge sagging between the poles, guy lines, the door's flaps tied back
  const tx = -2.6, tz = -0.8, L = 1.8, W = 1.5, H = 2.0
  kitTentA(b, tx, tz, 0, () => 0, CANVAS, L, W, H)
  col?.(tx, H / 2, tz, W, H / 2, L)
  // the fire ring, its logs and embers
  const f = FIRE_LOCAL
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2
    box(b, f.x + Math.cos(a) * 0.62, 0.1, f.z + Math.sin(a) * 0.62, 0.13, 0.11, 0.11, shade(STONE, 0.75 + 0.1 * (k % 3)))
  }
  b.log(V(f.x - 0.42, 0.12, f.z - 0.2), V(f.x + 0.42, 0.22, f.z + 0.18), 0.07, b.wood(0.55))
  b.log(V(f.x - 0.3, 0.22, f.z + 0.36), V(f.x + 0.32, 0.12, f.z - 0.36), 0.07, b.wood(0.5))
  b.setGlow(1)
  box(b, f.x, 0.06, f.z, 0.26, 0.05, 0.26, [0.35, 0.12, 0.04])
  b.setGlow(0)
  col?.(f.x, 0.15, f.z, 0.75, 0.15, 0.75)
  // two log seats round the fire
  b.log(V(f.x - 1.0, 0.2, f.z + 1.35), V(f.x + 1.0, 0.2, f.z + 1.45), 0.2, b.wood(0.9))
  b.log(V(f.x + 1.45, 0.2, f.z - 0.9), V(f.x + 1.5, 0.2, f.z + 0.9), 0.2, b.wood(0.95))
  col?.(f.x, 0.2, f.z + 1.4, 1.0, 0.2, 0.22)
  col?.(f.x + 1.47, 0.2, f.z, 0.22, 0.2, 0.9)
  // a lantern on a pole by the tent's door
  b.log(V(-0.6, 0, 1.3), V(-0.6, 1.9, 1.3), 0.04, b.wood(0.7))
  b.setGlow(1)
  box(b, -0.6, 1.72, 1.42, 0.09, 0.12, 0.09, [0.5, 0.35, 0.15])
  b.setGlow(0)
  // a red cooler by the tent
  box(b, tx + 1.4, 0.22, tz - 0.9, 0.36, 0.22, 0.24, [0.42, 0.06, 0.04])
  box(b, tx + 1.4, 0.45, tz - 0.9, 0.38, 0.03, 0.26, [0.6, 0.6, 0.6])
  // FIREWOOD stacked beside the tent, a chopping STUMP with the axe in it
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
    const z = tz - 0.75 + i * 0.19 + r * 0.095, y = 0.09 + r * 0.16
    b.log(V(tx - W - 0.95, y, z), V(tx - W - 0.25, y, z), 0.08, b.wood(1.12 - 0.04 * i))
  }
  b.log(V(f.x + 2.3, 0, f.z - 1.7), V(f.x + 2.3, 0.44, f.z - 1.7), 0.23, b.wood(0.9))
  b.log(V(f.x + 2.3, 0.44, f.z - 1.7), V(f.x + 2.62, 0.92, f.z - 1.55), 0.024, b.wood(1.25))
  box(b, f.x + 2.32, 0.47, f.z - 1.7, 0.1, 0.05, 0.02, [0.32, 0.32, 0.34])
  // a few stones about the camp
  for (const [sx, sz, sr] of [[2.6, 2.4, 0.22], [-3.6, 1.8, 0.3], [0.2, -2.6, 0.18], [3.4, -0.4, 0.26]]) box(b, sx, sr * 0.55, sz, sr, sr * 0.6, sr * 0.8, shade(STONE, 0.7))
}
