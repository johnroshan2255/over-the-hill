import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { PAINT_GLSL } from './paint'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import type { Horizon } from './Horizon'
import { type Bridge, deckY, type MapData } from './MapData'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * BRIDGES — Over-the-Hill plank bridges where the tracks cross the river (scripts/oth/terrain.py places them, the
 * track ramps up to each deck): weathered PLANKS laid across three long STRINGERS, each plank its own length, tone and
 * a slight skew; log POSTS standing in the water every ~6 m with a cap beam across, a low CURB log along each edge and
 * a log RAIL on the posts. A mesh per bridge (~10 k vertices in all, one material: drawn only when in view and not
 * behind the hills — `cull`), flat-shaded wood in this world's light (the terrain's baked sun shadow, the headlights).
 * The physics (Physics.ts) gives each a deck, curbs and rails to drive on.
 * A ROPE BRIDGE (the desert's gorge, 2026-11-02 — Over the Hill's Algeria): planks on two cables hanging in a sag, a
 * rope handrail each side tied down to the deck edge every couple of metres, A-frame log towers at both ends, the cables
 * anchored back into the ground behind them.
 */
export class Bridges {
  readonly group = new GFX.Group()
  /** The hills' occlusion (main.ts). */
  horizon: Horizon | null = null
  private parts: CullPart[] = []

  constructor(map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4) {
    const list = map.meta.bridges ?? []
    if (!list.length) return
    const b = new Builder(0x1b0a7d), ranges: [number, number][] = []
    for (const br of list) { const from = b.count; if (br.kind === 'rope') b.ropeBridge(br, map); else b.bridge(br, map); ranges.push([from, b.count]) }
    this.parts = splitMeshes(b, ranges, woodMaterial(atmos, shadow, tier, farGrid), this.group)
  }

  /** Skip the bridges the hills hide (once a frame; the view culls the rest). */
  cull(): void { cullHidden(this.parts, this.horizon) }
}

/** The wood's (and the landmarks') material: vertex colours, a stretched grain, this world's light; `glow` (a vertex
 *  attribute) burns warm at night — a cabin's window, a lantern. */
export function woodMaterial(atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4): GFX.ShaderMaterial {
  return new GFX.ShaderMaterial({
    glslVersion: GFX.GLSL3,
    uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid },
      // (the cave world's hill paints from the land's MASK, as the terrain does — CaveWorld sets these; x 0: off)
      uMask: { value: new GFX.DataTexture(new Uint8Array(4), 1, 1, GFX.RGBAFormat, GFX.UnsignedByteType) }, uMaskGrid: { value: new GFX.Vector4(0, 0, 0, 0) },
      // (the Wardens' REGIONS — Wardens.ts sets them on ITS material: x, z, radius, on; all off here)
      uRegion0: { value: new GFX.Vector4(0, 0, 1, 0) }, uRegion1: { value: new GFX.Vector4(0, 0, 1, 0) }, uRegion2: { value: new GFX.Vector4(0, 0, 1, 0) }, uRegion3: { value: new GFX.Vector4(0, 0, 1, 0) } },
    defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}) },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
}

/** Collects boxes, logs, quads and triangles (flat normals, a colour each, a night glow) into one geometry. */
/** The surfaces a Builder's pieces can take (setSurf): the props' / landmarks' one material shades each its own way. */
export const SURF = { wood: 0, stone: 1, metal: 2, fabric: 3, plain: 4, lamp: 5, eerie: 6, turf: 7, cliff: 8, masonry: 9, megalith: 10 } as const

/** A MODELLED thing offered in place of what a Kit function would build (Landmarks — Buildings.ts / places.py): its
 *  model's name, where (the builder's frame), turned rot; tint its BODY paint, tilt (about its own x, z), scale. True:
 *  taken (it's drawn as the model — build nothing). */
export type ModelSink = (name: string, x: number, y: number, z: number, rot: number, o?: { tint?: readonly number[]; tiltX?: number; tiltZ?: number; scale?: [number, number, number] }) => boolean

export class Builder {
  /** Where modelled props go (Landmarks sets it while it builds a place with models; null: built here). */
  sink: ModelSink | null = null
  private readonly pos: number[] = []
  private readonly nor: number[] = []
  private readonly col: number[] = []
  private readonly glw: number[] = []
  private readonly idx: number[] = []
  private glowNow = 0
  private surfNow = 0
  /** The glow of what's added from now on (0: none; 1: a lit window at night). */
  setGlow(v: number): void {
    while (this.glw.length < this.count) this.glw.push(this.glowNow + 2 * this.surfNow)
    this.glowNow = v
  }
  /** THE SURFACE of what's added from now on (2026-11-06, the user: "materials … not flat colours"): SURF.wood (the
   *  default: the grain), stone, metal (painted, rusting at its edges), fabric (a soft weave), plain (paint, glass,
   *  rubber: no grain). Packed with the glow in one attribute (glow + 2 × surface): no new vertex data. */
  setSurf(k: number): void {
    this.setGlow(this.glowNow)
    this.surfNow = k
  }
  private s: number

  constructor(seed: number) { this.s = seed >>> 0 }

  rnd(): number {
    this.s = (Math.imul(this.s ^ (this.s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0
    return this.s / 4294967296
  }

  /** Weathered wood: warm brown, a few planks a little greyer, every piece its own tone. (2026-11-04 — the user:
   *  "bridges must look wooden": a pale, half-grey wood read near white in the desert's light — a deeper, warmer brown,
   *  hardly any grey; the same draws, so no plank moves) */
  wood(dark = 1): [number, number, number] {
    const k = (0.8 + 0.4 * this.rnd()) * dark, grey = this.rnd() * 0.2
    const r = 0.155 * (1 - grey) + 0.15 * grey, g = 0.08 * (1 - grey) + 0.11 * grey, b = 0.038 * (1 - grey) + 0.08 * grey
    return [r * k, g * k, b * k]
  }

  /** A box: centre c, unit axes u (half size hu), v (hv), w (hw). */
  box(c: GFX.Vector3, u: GFX.Vector3, v: GFX.Vector3, w: GFX.Vector3, hu: number, hv: number, hw: number, color: [number, number, number]): void {
    const faces: [GFX.Vector3, GFX.Vector3, GFX.Vector3, number, number, number][] = [
      [u, v, w, hu, hv, hw], [u.clone().negate(), w, v, hu, hw, hv],
      [v, w, u, hv, hw, hu], [v.clone().negate(), u, w, hv, hu, hw],
      [w, u, v, hw, hu, hv], [w.clone().negate(), v, u, hw, hv, hu],
    ]
    for (const [n, a, bb, hn, ha, hb] of faces) {
      const base = this.pos.length / 3
      const fc = c.clone().addScaledVector(n, hn)
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = fc.clone().addScaledVector(a, sa * ha).addScaledVector(bb, sb * hb)
        this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(...color)
      }
      // (wound to face n: a × b = n for the first face; the rest are built the same way)
      const cross = new GFX.Vector3().crossVectors(a, bb).dot(n) > 0
      if (cross) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    }
  }

  /** A log from a to b, radius r, 6 sides, flat-shaded, capped. */
  log(a: GFX.Vector3, b: GFX.Vector3, r: number, color: [number, number, number]): void {
    const axis = new GFX.Vector3().subVectors(b, a).normalize()
    const u = new GFX.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? new GFX.Vector3(0, 1, 0) : new GFX.Vector3(1, 0, 0)).normalize()
    const w = new GFX.Vector3().crossVectors(axis, u)
    const S = 6
    const ring = (c: GFX.Vector3, k: number) => {
      const t = ((k % S) / S) * Math.PI * 2 + 0.3
      return c.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(w, Math.sin(t) * r)
    }
    for (let k = 0; k < S; k++) {
      const p0 = ring(a, k), p1 = ring(a, k + 1), p2 = ring(b, k + 1), p3 = ring(b, k)
      const n = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p3, p0)).normalize()
      const base = this.pos.length / 3
      const shade = 0.92 + 0.12 * this.rnd()
      for (const p of [p0, p1, p2, p3]) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(color[0] * shade, color[1] * shade, color[2] * shade) }
      // (outward: flip if the normal points at the axis)
      const mid = new GFX.Vector3().addVectors(p0, p2).multiplyScalar(0.5)
      const toAxis = new GFX.Vector3().subVectors(a, mid).addScaledVector(axis, -new GFX.Vector3().subVectors(a, mid).dot(axis))
      if (n.dot(toAxis) > 0) { for (let q = 0; q < 4; q++) { const o = (base + q) * 3; this.nor[o] *= -1; this.nor[o + 1] *= -1; this.nor[o + 2] *= -1 } this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2) }
      else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    // end caps (a lighter cut face)
    for (const [c, s] of [[a, -1], [b, 1]] as const) {
      const n = axis.clone().multiplyScalar(s), base = this.pos.length / 3
      this.pos.push(c.x, c.y, c.z); this.nor.push(n.x, n.y, n.z); this.col.push(color[0] * 1.35, color[1] * 1.3, color[2] * 1.2)
      for (let k = 0; k < S; k++) { const p = ring(c, k); this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(color[0] * 1.35, color[1] * 1.3, color[2] * 1.2) }
      for (let k = 0; k < S; k++) {
        const i1 = base + 1 + k, i2 = base + 1 + ((k + 1) % S)
        if (s > 0) this.idx.push(base, i1, i2); else this.idx.push(base, i2, i1)
      }
    }
  }

  bridge(br: Bridge, map: MapData): void {
    // (the deck slopes from y0 to y1 with its road: planks square to it, posts and the ground plumb)
    const a = new GFX.Vector3(br.x0, br.y0, br.z0), b = new GFX.Vector3(br.x1, br.y1, br.z1)
    const L = a.distanceTo(b), along = new GFX.Vector3().subVectors(b, a).normalize()
    const up = new GFX.Vector3(0, 1, 0), across = new GFX.Vector3().crossVectors(up, along).normalize()
    const deckUp = new GFX.Vector3().crossVectors(along, across).normalize()
    const half = br.w / 2
    // PLANKS: across the bridge, ~0.26 m wide with a thin gap, each a little longer / shorter, skewed, its own tone
    const P = 0.29, n = Math.floor((L + 0.6) / P)
    for (let i = 0; i < n; i++) {
      const t = -0.3 + (i + 0.5) * ((L + 0.6) / n)
      const skew = (this.rnd() - 0.5) * 0.05
      const ax = across.clone().applyAxisAngle(deckUp, skew), al = along.clone().applyAxisAngle(deckUp, skew)
      const c = a.clone().addScaledVector(along, t).addScaledVector(across, (this.rnd() - 0.5) * 0.14)
      c.addScaledVector(deckUp, -0.055 + (this.rnd() - 0.5) * 0.025)
      this.box(c, ax, deckUp, al, half + (this.rnd() - 0.5) * 0.22, 0.055, 0.125, this.wood())
    }
    // STRINGERS under the planks
    for (const o of [-half + 0.45, 0, half - 0.45]) {
      const c = a.clone().addScaledVector(along, L / 2).addScaledVector(across, o).addScaledVector(deckUp, -0.25)
      this.box(c, across, deckUp, along, 0.13, 0.14, L / 2 + 0.4, this.wood(0.75))
    }
    // POSTS every ~6 m (and at both ends), a cap beam across each pair; the RAIL logs on top, a CURB log each edge
    const k = Math.max(2, Math.round(L / 6) + 1)
    for (let i = 0; i < k; i++) {
      const t = (i / (k - 1)) * L
      const c = a.clone().addScaledVector(along, t)
      for (const sd of [-1, 1]) {
        const p = c.clone().addScaledVector(across, sd * (half + 0.18))
        const ground = map.height(p.x, p.z)
        this.log(new GFX.Vector3(p.x, Math.min(ground, c.y - 1) - 0.6, p.z), new GFX.Vector3(p.x, c.y + 0.95, p.z), 0.15, this.wood(0.8))
      }
      const cap = c.clone().addScaledVector(deckUp, -0.52)
      this.box(cap, across, deckUp, along, half + 0.35, 0.13, 0.16, this.wood(0.7))
    }
    for (const sd of [-1, 1]) {
      const e0 = a.clone().addScaledVector(across, sd * (half + 0.18)), e1 = b.clone().addScaledVector(across, sd * (half + 0.18))
      this.log(e0.setY(e0.y + 0.82), e1.setY(e1.y + 0.82), 0.1, this.wood(0.9))
      const c0 = a.clone().addScaledVector(across, sd * (half - 0.14)).addScaledVector(along, -0.2), c1 = b.clone().addScaledVector(across, sd * (half - 0.14)).addScaledVector(along, 0.2)
      this.log(c0.setY(c0.y + 0.1), c1.setY(c1.y + 0.1), 0.12, this.wood(0.85))
    }
  }

  /** A ROPE BRIDGE: br's deck hanging br.sag m at its middle (deckY) — planks on two cables, the handrails, towers. */
  ropeBridge(br: Bridge, map: MapData): void {
    const a = new GFX.Vector3(br.x0, br.y0, br.z0), b = new GFX.Vector3(br.x1, br.y1, br.z1)
    const Lh = Math.hypot(br.x1 - br.x0, br.z1 - br.z0)
    const along = new GFX.Vector3(br.x1 - br.x0, 0, br.z1 - br.z0).normalize()
    const up = new GFX.Vector3(0, 1, 0), across = new GFX.Vector3().crossVectors(up, along).normalize()
    const half = br.w / 2
    const at = (t: number, side: number, dy: number) => new GFX.Vector3(br.x0 + (br.x1 - br.x0) * t, deckY(br, t) + dy, br.z0 + (br.z1 - br.z0) * t).addScaledVector(across, side)
    // PLANKS: across, square to the deck's slope where they lie; a few missing or loose-looking, each its own tone
    const P = 0.31, n = Math.floor(Lh / P)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, e = 1e-3
      const slope = (deckY(br, t + e) - deckY(br, t - e)) / (2 * e * Lh)
      const al = along.clone().addScaledVector(up, slope).normalize(), dUp = new GFX.Vector3().crossVectors(al, across).normalize()
      const skew = (this.rnd() - 0.5) * 0.06
      const c = at(t, (this.rnd() - 0.5) * 0.12, -0.06 + (this.rnd() - 0.5) * 0.03)
      this.box(c, across.clone().applyAxisAngle(dUp, skew), dUp, al.clone().applyAxisAngle(dUp, skew), half + (this.rnd() - 0.5) * 0.2, 0.05, 0.13, this.wood(this.rnd() < 0.06 ? 0.6 : 1))
    }
    // the two CABLES under the planks' ends and the HANDRAILS (thick ropes) above, as short straight pieces of the curve
    const rope: [number, number, number] = [0.42, 0.34, 0.22]
    const S = Math.max(8, Math.round(Lh / 4))
    for (const sd of [-1, 1]) for (let i = 0; i < S; i++) {
      const t0 = i / S, t1 = (i + 1) / S
      this.log(at(t0, sd * (half - 0.25), -0.2), at(t1, sd * (half - 0.25), -0.2), 0.07, rope)
      // (the handrail hangs a little deeper than the deck between the towers)
      const r0 = at(t0, sd * (half + 0.12), 1.05 + 0.25 * 4 * t0 * (1 - t0)), r1 = at(t1, sd * (half + 0.12), 1.05 + 0.25 * 4 * t1 * (1 - t1))
      this.log(r0, r1, 0.05, rope)
    }
    // SUSPENDERS: from the handrail down to the deck's edge every ~2.2 m
    const k = Math.round(Lh / 2.2)
    for (let i = 1; i < k; i++) for (const sd of [-1, 1]) {
      const t = i / k
      this.log(at(t, sd * (half + 0.1), 1.05 + 0.25 * 4 * t * (1 - t)), at(t, sd * (half - 0.05), -0.05), 0.022, rope)
    }
    // TOWERS: an A-frame of logs at each end (two posts leaning in, a cross beam), the cables anchored behind
    for (const [t, dir] of [[0, -1], [1, 1]] as const) {
      const base = t === 0 ? a : b
      for (const sd of [-1, 1]) {
        const foot = base.clone().addScaledVector(across, sd * (half + 0.7)).addScaledVector(along, dir * 0.6)
        foot.y = map.height(foot.x, foot.z) - 0.8
        const top = base.clone().addScaledVector(across, sd * (half + 0.15)).addScaledVector(along, dir * 0.6).setY(base.y + 3.6)
        this.log(foot, top, 0.2, this.wood(0.8))
        const anchor = base.clone().addScaledVector(across, sd * (half + 1.4)).addScaledVector(along, dir * 7)
        anchor.y = map.height(anchor.x, anchor.z) + 0.3
        this.log(top.clone().setY(top.y - 0.3), anchor, 0.06, rope)
        this.box(anchor.clone().setY(anchor.y + 0.1), across, up, along, 0.35, 0.45, 0.35, this.wood(0.6)) // (the stake)
      }
      const cb = base.clone().addScaledVector(along, dir * 0.6).setY(base.y + 3.35)
      this.log(cb.clone().addScaledVector(across, -(half + 0.5)), cb.clone().addScaledVector(across, half + 0.5), 0.16, this.wood(0.75))
    }
  }

  /** A flat quad p0 → p1 → p2 → p3 (counter-clockwise seen from its front), its normal from the winding. */
  quad(p0: GFX.Vector3, p1: GFX.Vector3, p2: GFX.Vector3, p3: GFX.Vector3, color: [number, number, number]): void {
    const n = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p2, p0)).normalize(), base = this.pos.length / 3
    for (const p of [p0, p1, p2, p3]) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(...color) }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** A flat triangle (counter-clockwise from its front). */
  tri(p0: GFX.Vector3, p1: GFX.Vector3, p2: GFX.Vector3, color: [number, number, number]): void {
    const n = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p2, p0)).normalize(), base = this.pos.length / 3
    for (const p of [p0, p1, p2]) { this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(...color) }
    this.idx.push(base, base + 1, base + 2)
  }

  /** Vertices as given (their own normals — a smooth surface: the tunnel's hill, Locations.ts): positions, normals,
   *  colours (xyz each), triangles indexing into these. */
  raw(pos: number[], nor: number[], col: number[], idx: number[]): void {
    const base = this.pos.length / 3
    for (let i = 0; i < pos.length; i++) { this.pos.push(pos[i]); this.nor.push(nor[i]); this.col.push(col[i]) }
    for (const i of idx) this.idx.push(base + i)
  }

  /** Vertices added so far (a landmark transforms its own range into place). */
  get count(): number { return this.pos.length / 3 }

  /** Move vertices [from, count) by m (positions and normals). */
  transform(from: number, m: GFX.Matrix4): void {
    const v = new GFX.Vector3(), n3 = new GFX.Matrix3().getNormalMatrix(m)
    for (let i = from; i < this.count; i++) {
      v.fromArray(this.pos, i * 3).applyMatrix4(m).toArray(this.pos, i * 3)
      v.fromArray(this.nor, i * 3).applyMatrix3(n3).normalize().toArray(this.nor, i * 3)
    }
  }

  /** The geometry of vertices [from, to) — everything by default; a range is one bridge / landmark (its own mesh). */
  geometry(from = 0, to = this.count): GFX.BufferGeometry {
    this.setSurf(0)
    this.setGlow(0)
    const idx: number[] = []
    for (let i = 0; i < this.idx.length; i += 3) {
      if (this.idx[i] >= from && this.idx[i] < to) idx.push(this.idx[i] - from, this.idx[i + 1] - from, this.idx[i + 2] - from)
    }
    const g = new GFX.BufferGeometry()
    g.setAttribute('glow', new GFX.Float32BufferAttribute(this.glw.slice(from, to), 1))
    g.setAttribute('position', new GFX.Float32BufferAttribute(this.pos.slice(from * 3, to * 3), 3))
    g.setAttribute('normal', new GFX.Float32BufferAttribute(this.nor.slice(from * 3, to * 3), 3))
    g.setAttribute('color', new GFX.Float32BufferAttribute(this.col.slice(from * 3, to * 3), 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

/** A part culled whole: by the view (three, its bounding sphere) and behind the hills (`cullHidden`, its box). */
/** (hid / hidAt: the hills' answer for its box, and the horizon it was asked of — cullHidden) */
export interface CullPart { obj: GFX.Object3D; box: GFX.Box3; hid?: boolean; hidAt?: number }

/** One mesh per vertex range of b (a bridge, a landmark — 2026-11-02: one merged mesh over the whole map was in view
 *  from everywhere, ~0.1–0.2 ms a frame with none of them on screen), added to group. */
export function splitMeshes(b: Builder, ranges: [number, number][], mat: GFX.Material, group: GFX.Group): CullPart[] {
  return ranges.map(([from, to]) => {
    const g = b.geometry(from, to)
    const mesh = new GFX.Mesh(g, mat)
    group.add(mesh)
    return { obj: mesh, box: g.boundingBox! }
  })
}

/** Hide the parts the hills hide (once a frame). A part's box doesn't move and the answer depends only on the horizon in
 *  use — so it's asked again only when a new horizon is swapped in (Horizon.builds; 2026-11-07, docs/PERF.md). */
export function cullHidden(parts: CullPart[], horizon: Horizon | null): void {
  const at = horizon && horizon.enabled ? horizon.builds : -1
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.hidAt !== at) { p.hidAt = at; p.hid = !!horizon?.hiddenBox(p.box) }
    p.obj.visible = !p.hid
  }
}

const VERT = /* glsl */ `
in vec3 color;
in float glow;
out vec3 vWorld;
out vec3 vN;
out vec3 vCol;
out float vGlow;
void main() {
  vGlow = glow;
  mat4 M = modelMatrix;
#ifdef USE_INSTANCING
  M = modelMatrix * instanceMatrix; // (the valley's props: one draw per kind — Props.ts)
#endif
  vec4 w = M * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(M) * normal);
  vCol = color;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

// THE CAVES' ROCK (SURF.cliff, and a cave's hill where it's bare and steep — 2026-11-06, round 2, the user: "now it's
// like a cement building … the outside and top where we used the normal terrain was really good"; "like in Genshin
// Impact"): the terrain's own rock (paint.ts: the valley's slab grey in broad tones, darker hollows and faint cracks, a
// little lichen; Terrain's soft streaks down the walls) and MOSS on what faces up — the ledges the rock's shape makes
// (Locations.rockField). No beds drawn on it: evenly spaced, they read as a building's courses. A facet (`facet` 1:
// flat, its own normal Ng) reads the paint on its own plane — across a wall, from above on a ledge — so nothing
// smears; a smooth hill (0) reads it from above, as the terrain's rock does.
const ROCK_PAINT = /* glsl */ `
const float ROCK_VALUE = 1.55;
vec3 rockPaint(vec3 p, vec3 Ng, float facet) {
  float wallK = smoothstep(0.4, 0.7, 1.0 - abs(Ng.y)) * facet;
  float across = abs(Ng.x) > abs(Ng.z) ? p.z : p.x;
  vec2 q = wallK > 0.5 ? vec2(across, p.y) : p.xz;
  vec4 f = texture(uNoise, q * (1.0 / 13.0) + vec2(0.71, 0.13));
  vec4 gr = texture(uNoise, q * (1.0 / 3.7) + vec2(0.23, 0.91));
  vec3 rk = mix(SLAB_DEEP, SLAB, 0.78 + (f.g - 0.5) * 0.35 + (gr.r - 0.5) * 0.14 - (1.0 - abs(Ng.y)) * 0.2);
  rk = mix(rk, rk * vec3(0.92, 1.0, 0.86), smoothstep(0.6, 0.78, f.b) * 0.5);
  rk *= (1.0 - 0.12 * smoothstep(0.66, 0.8, gr.a)) * (0.88 + 0.2 * f.a);
  if (wallK > 0.01) rk *= 1.0 - 0.16 * wallK * smoothstep(0.5, 0.82, texture(uNoise, vec2(across / 9.0, p.y / 70.0 + 0.6)).g);
  float moss = smoothstep(0.5, 0.75, Ng.y + (gr.g - 0.5) * 0.35);
  return mix(rk, mix(GREEN, GREEN_DEEP, f.r) * (1.1 / ROCK_VALUE), moss * 0.3); // (2026-11-07: the cave hill's bare patches — rock, a little moss)
}
// INSIDE A CAVE (SURF.cliff — 2026-11-07, the user: "inside don't show any patterns, just the rock texture and the rock
// shader"): the same slab paint, read TRIPLANAR (each wall from across it, the roof and floor from below / above — no
// smearing, no seam) on the cave's smooth shell; no moss, no streaks, no facets' tones. rockRelief adds the creases.
vec3 caveRockPaint(vec3 p, vec3 N) {
  vec3 w = pow(abs(N), vec3(4.0)); w /= w.x + w.y + w.z;
  vec4 f = texture(uNoise, p.zy * (1.0 / 13.0) + vec2(0.71, 0.13)) * w.x + texture(uNoise, p.xz * (1.0 / 13.0) + vec2(0.71, 0.13)) * w.y + texture(uNoise, p.xy * (1.0 / 13.0) + vec2(0.71, 0.13)) * w.z;
  vec4 gr = texture(uNoise, p.zy * (1.0 / 3.7) + vec2(0.23, 0.91)) * w.x + texture(uNoise, p.xz * (1.0 / 3.7) + vec2(0.23, 0.91)) * w.y + texture(uNoise, p.xy * (1.0 / 3.7) + vec2(0.23, 0.91)) * w.z;
  // (the terrain's slab: a wall's grey a step deeper than a ledge's — paint.ts: - steep · 0.35)
  vec3 rk = mix(SLAB_DEEP, SLAB, 0.74 + (f.g - 0.5) * 0.35 + (gr.r - 0.5) * 0.14 - (1.0 - abs(N.y)) * 0.3);
  return rk * (1.0 - 0.1 * smoothstep(0.66, 0.8, gr.a)) * (0.9 + 0.16 * f.a);
}
// THE MASONRY (SURF.masonry — 2026-11-13, the user's painted frames: the forts' and ruins' walls "flat grey slabs" →
// laid stone): in the face's own plane (a wall: along it and up; a top: from above) COURSES ~0.46 m high, each its own
// block length and offset, so the joints never line up; a joint of dark mortar between blocks whose edges are chipped
// (the noise pushes them in and out), each block BEVELLED (the normal turns over at its edges — the sun picks out every
// one) and its own tone. Then the weather: MOSS on what faces up and in patches down the joints, IVY in hanging
// curtains, rain GRIME streaking down. The pattern fades out as a block shrinks toward a pixel (no shimmer far off).
// albedo / N in-out; returns the joints' occlusion.
float mhash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float masonry(vec3 p, vec3 Ng, float px, inout vec3 albedo, inout vec3 N, out float leafy) {
  bool wall = abs(Ng.y) < 0.6;
  vec3 T = wall ? normalize(vec3(-Ng.z, 0.0, Ng.x) + vec3(1e-4, 0.0, 0.0)) : vec3(1.0, 0.0, 0.0);
  vec3 B = wall ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec2 q = vec2(dot(p, T), dot(p, B));
  // FAR WALLS ARE SIMPLER (PERF, 2026-11-13 — the user: "simpler stonework on far ruins"; a town filling the view cost
  // 0.42 ms): past a pixel of ~7 … 11 cm of wall (~70 … 110 m off) a block is under a pixel and its joints, bevels,
  // chips and grime were already faded out — but all computed. There: the stone's tone, the moss and the ivy's
  // curtains only — two reads (one on the phones) for five, none of the blocks' hashing. The same tone at the hand-over.
  float farK = smoothstep(0.07, 0.11, px);
  vec4 n2 = texture(uNoise, q * 0.19 + vec2(0.13, 0.71));
  vec4 n1 = vec4(0.5, 0.5, 0.5, n2.a);
  float joint = 0.0, by = 0.0;
  // (round 5 — 0.5, was 0.56 (0.45 tried: the lakes' dark slate region went near black): sunlit, the laid stone sat near white beside the frames' warm mid grey)
  vec3 c = albedo * 0.5 * (0.86 + 0.07 + 0.14 * (n2.r - 0.5));
  if (farK < 1.0) {
    const float CH = 0.46;
    float row = floor(q.y / CH);
    float L = 0.75 + 0.55 * mhash(vec2(row, 7.1));
    float u = q.x / L + mhash(vec2(row, 3.7));
    float cl = floor(u);
    vec2 sz = vec2(L, CH), f = vec2(fract(u) * L, fract(q.y / CH) * CH), e2 = min(f, sz - f);
    float id = mhash(vec2(cl, row) + 0.37);
    float show = 1.0 - smoothstep(0.025, 0.07, px);
    n1 = texture(uNoise, q * 0.83 + id * 3.1);
    // the joint: ~4 cm, its edge chipped
    float e = min(e2.x, e2.y) + (n1.r - 0.5) * 0.05;
    float aa = max(px, 0.003);
    joint = (1.0 - smoothstep(0.02 - aa, 0.02 + aa, e)) * show;
    // the bevel: the last ~8 cm of a block turning down to the joint
    float bx = (f.x < sz.x * 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.08, e2.x + (n1.g - 0.5) * 0.03));
    by = (f.y < sz.y * 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.08, e2.y + (n1.g - 0.5) * 0.03));
    N = normalize(N + (T * bx + B * by) * 0.6 * show * (1.0 - joint));
    // each block its own tone (some warmer, some cooler), a little mottled; darker toward its edges
    vec3 cn = albedo * 0.5 * (0.8 + 0.32 * id) * mix(vec3(1.0), mhash(vec2(row, cl) + 1.3) > 0.5 ? vec3(1.05, 1.0, 0.92) : vec3(0.95, 0.98, 1.03), 0.8);
    cn *= 0.9 + 0.18 * n1.b;
    cn = mix(albedo * 0.5 * (0.86 + 0.14 * n1.b), cn, show);
    cn = mix(cn, albedo * 0.31, joint);   // (round 5: the mortar a dark grey, not black — close to, the joints read as inked lines)
    // GRIME: darker streaks run down the walls from the rain
#ifdef OTH_ROCK_RELIEF
    // (HIGH / ULTRA only, as the relief: the grime's and the ivy's three reads — the phones keep the blocks and the moss)
    if (wall) cn *= 1.0 - 0.22 * smoothstep(0.45, 0.85, texture(uNoise, vec2(q.x * 0.31, q.y * 0.021) + 0.5).b);
#endif
    c = mix(cn, c, farK);
  }
  // MOSS: the tops thick with it in soft patches; down the walls in the joints and on the blocks' upper edges
  float mossK = wall ? smoothstep(0.7, 0.86, n2.g + 0.2 * joint + 0.1 * max(by, 0.0)) * 0.6 : smoothstep(0.45, 0.7, n2.g + (n1.b - 0.5) * 0.3) * 0.85;
  vec3 moss = mix(vec3(0.09, 0.11, 0.03), vec3(0.17, 0.18, 0.055), n1.a) * (0.85 + 0.3 * n2.r);
  c = mix(c, moss, mossK);
  // IVY: hanging curtains on the walls (a slow noise stretched down), its leaves broken up finely, lit unevenly
  leafy = 0.0;
#ifdef OTH_ROCK_RELIEF
  if (wall) {
    float cur = texture(uNoise, vec2(q.x * 0.07, q.y * 0.018) + vec2(0.31, 0.17)).g + (n2.b - 0.5) * 0.25;
    vec4 lf = vec4(0.5);
    if (farK < 1.0) lf = mix(texture(uNoise, q * 2.6 + 0.4), lf, farK);   // (the leaves' breakup: near only)
    leafy = smoothstep(0.74, 0.8, cur + (lf.r - 0.5) * 0.16);
    c = mix(c, mix(vec3(0.05, 0.08, 0.02), vec3(0.13, 0.16, 0.04), lf.g), leafy);
    N = normalize(N + (T * (lf.b - 0.5) + B * (lf.a - 0.5)) * 1.2 * leafy);
  }
#endif
  albedo = c;
  return (1.0 - 0.5 * joint) * (1.0 - 0.15 * leafy);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${ROCK_RELIEF_GLSL}
uniform vec4 uFarGrid;
uniform sampler2D uMask;
uniform vec4 uMaskGrid;
${SHADOW_GLSL}
${PAINT_GLSL}
${ROCK_PAINT}
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in float vGlow;
// THE WARDENS' REGIONS (Wardens.ts, 2026-11-12 — "every region the same stone"): the stone's tone by where it stands —
// 0 the Frozen Court under the white peaks (pale, blue-white), 1 the World Tree's country (warm, mossed green),
// 2 the canyon's (ochre sandstone), 3 the lakes' (dark, damp slate); each fades out over the last 45 % of its radius.
// Four vec4s (the gfx layer drops uniform arrays); off (w 0) on every other material.
uniform vec4 uRegion0;
uniform vec4 uRegion1;
uniform vec4 uRegion2;
uniform vec4 uRegion3;
vec3 regionTint(vec2 p) {
  vec3 t = vec3(1.0);
  t = mix(t, vec3(1.14, 1.17, 1.27), uRegion0.w * (1.0 - smoothstep(0.55, 1.0, distance(p, uRegion0.xy) / uRegion0.z)));
  t = mix(t, vec3(0.86, 0.98, 0.72), uRegion1.w * (1.0 - smoothstep(0.55, 1.0, distance(p, uRegion1.xy) / uRegion1.z)));
  t = mix(t, vec3(1.16, 0.93, 0.7), uRegion2.w * (1.0 - smoothstep(0.55, 1.0, distance(p, uRegion2.xy) / uRegion2.z)));
  t = mix(t, vec3(0.74, 0.82, 0.9), uRegion3.w * (1.0 - smoothstep(0.55, 1.0, distance(p, uRegion3.xy) / uRegion3.z)));
  return t;
}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld); // (the rock's relief, the masonry's fade: taken here, outside any branch)
  // THE SURFACE (Builder.setSurf, packed with the glow: glow + 2 × surface) — 0 wood, 1 stone, 2 metal, 3 fabric, 4 plain
  float surf = floor(vGlow * 0.5 + 0.01), glow = vGlow - surf * 2.0;
  vec3 albedo = vCol;
  float rough = 0.85, wrap = 0.2, fillK = 0.0, ao = 1.0;
  if (surf < 0.5) {
    // the grain: soft streaks along the wood (the paint noise, stretched)
    float grain = texture(uNoise, vec2(dot(vWorld.xz, vec2(0.7, 0.7)) * 0.9, vWorld.y * 0.6 + dot(vWorld.xz, vec2(-0.7, 0.7)) * 0.08)).b;
    albedo *= 0.7 + 0.6 * grain; // (the grain strong: it reads as wood)
  } else if (surf < 1.5) {
    // STONE: blotches at two scales (no streaks), a cooler grey in the hollows, lichen on what faces up
    vec2 q = vWorld.xz + vWorld.y * vec2(0.61, -0.43);
    float b1 = texture(uNoise, q * 0.31).g, b2 = texture(uNoise, q * 1.7 + 0.3).r;
    albedo *= 0.74 + 0.36 * b1 + 0.16 * (b2 - 0.5);
    albedo = mix(albedo, vec3(0.2, 0.23, 0.12) * 0.55, smoothstep(0.62, 0.8, b2) * smoothstep(0.55, 0.95, N.y) * 0.6);
    albedo *= regionTint(vWorld.xz);
    rough = 0.92; wrap = 0.3;
    // (round 4 — the roads' audit: stone's faces turned from the sun went near black beside its white lit tops — the
    //  dry walls read as rows of black-and-white boxes; the rock's sky fill on stone too, as on the masonry)
    fillK = 0.6;
  } else if (surf < 2.5) {
    // PAINTED METAL: smooth, a little sheen, RUST bleeding in where a slow noise says (its edges and low down most)
    vec2 q = vWorld.xz * 0.9 + vWorld.y * vec2(0.37, 0.71);
    float r = texture(uNoise, q * 0.55).g * 0.7 + texture(uNoise, q * 2.3).b * 0.3;
    float rust = smoothstep(0.5, 0.75, r + (0.6 - fract(vWorld.y * 0.13)) * 0.05);
    albedo = mix(albedo, vec3(0.2, 0.075, 0.03) * (0.8 + 0.4 * r), rust * 0.85);
    rough = mix(0.5, 0.9, rust);
  } else if (surf < 3.5) {
    // FABRIC: a fine weave and soft fading where the sun has bleached it; the light wraps through it a little
    float wv = texture(uNoise, vWorld.xz * 2.1 + vWorld.y * 1.3).b;
    albedo *= 0.88 + 0.2 * wv;
    albedo = mix(albedo, albedo * 1.25 + 0.03, smoothstep(0.5, 0.95, N.y) * 0.25);
    rough = 0.95; wrap = 0.5;
  } else if (surf > 9.5) {
    // MEGALITH (the look, round 5 — the user's Moth Stones frame: the standing stones "chalk-white dominoes" → old
    // weathered rock): one great stone, a deep grey, rain-streaked down its faces, pale lichen in blotches, moss thick
    // on its top and in patches down it; on HIGH / ULTRA the rock's crumpled relief
    vec2 q = vWorld.xz + vWorld.y * vec2(0.61, -0.43);
    float b1 = texture(uNoise, q * 0.31).g, b2 = texture(uNoise, q * 1.7 + 0.3).r;
    vec4 n2 = texture(uNoise, q * 0.19 + vec2(0.13, 0.71));
    albedo *= vec3(0.41, 0.39, 0.36) * (0.72 + 0.4 * b1 + 0.2 * (b2 - 0.5));
    albedo *= 1.0 - 0.34 * smoothstep(0.42, 0.72, texture(uNoise, vec2(dot(vWorld.xz, vec2(0.7, 0.7)) * 0.33, vWorld.y * 0.028) + 0.5).g) * (1.0 - smoothstep(0.5, 0.8, N.y));
    albedo = mix(albedo, vec3(0.3, 0.29, 0.2) * (0.8 + 0.4 * b1), smoothstep(0.66, 0.8, b2 + 0.25 * n2.r) * 0.45);
    float mossK = max(smoothstep(0.45, 0.85, N.y) * 0.9, smoothstep(0.62, 0.78, n2.g + (b2 - 0.5) * 0.25) * 0.7);
    albedo = mix(albedo, mix(vec3(0.07, 0.095, 0.025), vec3(0.15, 0.17, 0.05), b2) * (0.85 + 0.3 * n2.r), mossK);
    albedo *= regionTint(vWorld.xz);
#ifdef OTH_ROCK_RELIEF
    float cav;
    N = rockRelief(vWorld, N, 0.9 * (1.0 - 0.6 * mossK), dpx, dpy, cav);
    ao *= cav;
#endif
    rough = 0.92; wrap = 0.3; fillK = 0.8;
  } else if (surf > 8.5) {
    // MASONRY — the ruins' laid stone (ROCK_PAINT masonry), the region's tone, and on HIGH / ULTRA the rock's crumpled
    // relief over the blocks' faces (the user: "the rock 3D shader on the ruins") — not on the ivy
    float leafy;
    ao = masonry(vWorld, N, max(length(dpx), length(dpy)), albedo, N, leafy);
    albedo *= regionTint(vWorld.xz);
#ifdef OTH_ROCK_RELIEF
    float cav;
    // (PERF, 2026-11-13: near only — a pixel under 3 … 10 cm of wall (~30 … 100 m): the blocks' own bevels carry the
    //  walls farther off; a town filling the view paid 0.4 ms for creases smaller than its pixels)
    N = rockRelief(vWorld, N, 0.75 * (1.0 - leafy) * (1.0 - smoothstep(0.03, 0.1, max(length(dpx), length(dpy)))), dpx, dpy, cav);
    ao *= cav;
#endif
    // (2026-11-13, the day's lighting checked hour by hour: a fort's walls in their own shade at noon were near black
    //  beside the sunlit grass — the sky's fill on the laid stone as on the terrain's rock: 0.8, was 0.35)
    rough = 0.9; wrap = 0.3; fillK = 0.8 * (1.0 - leafy);
  } else if (surf > 7.5) {
    // CLIFF — the cave world's rock (CaveWorld.ts; vCol its tint): the terrain's slab, a little darker in there
    albedo = caveRockPaint(vWorld, N) * vCol;
#ifdef OTH_ROCK_RELIEF
    float cav;
    N = rockRelief(vWorld, N, 1.0, dpx, dpy, cav); // (the terrain's own crumpled creases: HIGH / ULTRA)
    ao = cav; // (their shade, as the terrain's)
#endif
    rough = 0.62; wrap = 0.45; fillK = 1.0;
  } else if (surf > 6.5) {
    // TURF — the cave world's hill and its inside (CaveWorld.ts). vCol: x the dryness, y −1 inside, z the rock's floor
    // (a steep face reads the paint across itself, not from above: no stripes down it — and BLENDED between the two
    //  over the bend, both read: a switch there drew a hard, stepped line through every transition, 2026-11-07)
    // (the hill outside reads it from above only, as the terrain does — its slopes are never walls, and the second read
    //  over the bend cost ~0.5 ms on the taller hill seen from the air; inside and the arch, across the walls)
    float wallT = vCol.y < -0.5 || vCol.z > 0.5 ? smoothstep(0.8, 0.4, abs(N.y)) : 0.0;
    vec2 acrossQ = vec2(abs(N.x) > abs(N.z) ? vWorld.z : vWorld.x, vWorld.y);
    Paint p = paintNoise(wallT > 0.5 ? acrossQ : vWorld.xz);
    if (wallT > 0.02 && wallT < 0.98) {
      Paint p2 = paintNoise(wallT > 0.5 ? vWorld.xz : acrossQ);
      float k = wallT > 0.5 ? 1.0 - wallT : wallT;
      p.micro = mix(p.micro, p2.micro, k); p.grain = mix(p.grain, p2.grain, k); p.fine = mix(p.fine, p2.fine, k);
      p.mid = mix(p.mid, p2.mid, k); p.big = mix(p.big, p2.big, k);
    }
    // (the edge between grass and rock RAGGED at a metre or two, never a clean outline — the "sticker")
    float edge = (p.fine.g - 0.5) * 0.3 + (p.grain.r - 0.5) * 0.22 + (p.micro.b - 0.5) * 0.08;
    float dry = vCol.x, rz = vCol.z + edge + (p.mid.b - 0.5) * 0.12, moss = 0.0;
    // (vCol.y: 0 outside … −1 inside, eased through the mouth's first metres — the two paints MIXED there, never a line)
    float inK = clamp(-vCol.y, 0.0, 1.0);
    bool outside = uMaskGrid.x > 0.5 && vCol.z > -0.05 && inK < 0.999;
    if (outside) {
      // THE HILL PAINTED AS THE TERRAIN (2026-11-07, the user: "on top, like the normal terrain — rock won't have grass,
      // green has green grass, yellow has yellow grass; a gradual, smooth transition, not a sticker"): from the land's
      // MASK where it stands — G its dryness, R its rock (CaveWorld.grassOn writes the hill's into it, smooth) — the
      // field's blades read the same mask, so they agree. (vCol.z: the arch and its foot.)
      vec4 m = texture(uMask, ((vWorld.xz - uMaskGrid.z) / uMaskGrid.y + 0.5) / uMaskGrid.x);
      // (green into gold in interlocking clumps a few metres across — the terrain's meadows' edge, never a line)
      dry = m.g + (p.fine.r - 0.5) * 0.3 + (p.grain.g - 0.5) * 0.18;
      // (on the TERRAIN's threshold — paint.ts g.rock, smoothstep(0.42, 0.58) of R — so the cave's turf by an opening
      //  and the ground beside it agree: no soil band or specks where the ground shows grass, 2026-11-07)
      rz = max(m.r * 1.6 - 0.45 + (p.mid.b - 0.5) * 0.3, vCol.z) + edge * 0.5;
    }
    if (inK > 0.001) {
      // INSIDE (the user: "most of it green; a proper, smooth transition to the rock"): per pixel, from how the surface
      // faces — what faces up grows grass (the floor, the ledges' tops), the walls and the roof rock, MOSS on the rock
      // in soft patches where it leans out; the part's own cap (vCol.z: the garden 0, the floor 0.3, the walls 1.3).
      // The grass in broad patches of green and gold.
      // (2026-11-07, the user: "don't need the black random lines — the real rock": no moss on the walls, and a ledge's
      //  top the floor's grass, not a dark green strip along the rock)
      float up = smoothstep(0.3, 0.85, N.y + (p.mid.b - 0.5) * 0.25);
      // (vCol.z: the part's cap — ≥ 2 rock whichever way it faces; on the floor 0.3 far from a wall, rising toward one:
      //  rock by it, the soil band and the gravel over the last metres — gradual, the user: "so sudden")
      float rzI = max(min(1.05 - up, max(vCol.z, 0.3)), max(vCol.z - 1.0, vCol.z * 1.2 - 0.45)) + edge;
      float dryI = clamp(0.5 + (p.mid.g - 0.5) * 1.8 + (p.big.r - 0.5) * 0.6, 0.05, 0.95);
      if (outside) { dry = mix(dry, dryI, inK); rz = mix(rz, rzI, inK); } else { dry = dryI; rz = rzI; }
    }
    fillK = smoothstep(0.34, 0.8, rz);
    // (each paint only where it shows — the rock's triplanar is six fetches, and most of the hill is grass, most of the
    //  inside rock: 2026-11-07, abq caveHall / caveAbove)
    float thin = smoothstep(0.1, 0.55, rz) * (1.0 - fillK);
    float speck = smoothstep(0.52, 0.68, p.grain.r + (p.fine.b - 0.5) * 0.4 + thin * 0.25);
    vec3 rockC = fillK > 0.001 ? caveRockPaint(vWorld, N) : vec3(0.0);
    // (the specks in the band: the slab grey from the paint already read — not the rock's six fetches)
    vec3 stoneG = mix(SLAB_DEEP, SLAB, 0.66 + 0.3 * p.fine.g);
    if (fillK < 0.999) {
      vec3 gcol = grassPaint(dry, p) * (0.9 + 0.2 * p.fine.g + (p.mid.r - 0.5) * 0.12 + (p.grain.r - 0.5) * 0.1);
      // (between grass and rock, a wide band: the grass thins over darker, browner soil and the rock's own grey breaks
      //  through it in specks — then the rock with a few tufts left on it)
      gcol = mix(gcol, gcol * vec3(0.66, 0.6, 0.54), thin * 0.65);
      gcol = mix(gcol, stoneG, thin * speck * 0.75);
      albedo = mix(gcol, rockC, fillK);
    } else albedo = rockC;
    // (moss: the rock tinted green in soft patches, never the grass's yellow)
    albedo = mix(albedo, mix(GREEN_DEEP, GREEN, 0.35 + 0.4 * p.fine.r) * 0.9, moss * fillK * 0.5);
#ifdef OTH_ROCK_RELIEF
    if (fillK > 0.0) {
      float cav;
      // (deeper inside, where the light is low and from one side: the creases must still read — the terrain's rock
      //  has the sun for it)
      N = rockRelief(vWorld, N, fillK * (1.0 + 0.8 * inK), dpx, dpy, cav);
      ao = cav; // (fades with fillK)
    }
#endif
    albedo *= 1.0 + 0.45 * clamp(-vCol.z, 0.0, 1.0); // (the grass tufts' blades: lighter to their tips)
    // (GRASS ON A STEEP BANK is lit through its blades, which stand up — not as the bare slope under them: the shading
    //  normal bent toward the sky, so a cave's grassy face reads as the field round it, never a dark olive sheet;
    //  eased out over the rock's edge — a switch there drew a line)
    // (the hill's turf by an opening: bent as the ground beside it is lit — its eased normals — not a blade field's)
    float bend = inK < 0.5 && vCol.z > -0.05 && uMaskGrid.x > 0.5 ? 0.7 : 1.6;
    N = normalize(N + vec3(0.0, bend * (1.0 - smoothstep(0.15, 0.75, fillK)), 0.0));
    rough = mix(0.95, 0.62, fillK); wrap = mix(0.35, 0.45, fillK);
  }
  // (a cave's dark never on TURF — it's always the outside: the hill over a cave, its mouth's face — 2026-11-07: the
  //  dark's cylinder reached up through the hill and darkened the grass over it brown)
  float sun = sunVisibility(vWorld.xz), ck = caveK(vWorld);
  if (surf > 6.5 && surf < 7.5) ck *= clamp(-vCol.y, 0.0, 1.0);
  vec3 c = shade(albedo, N, V, rough, 0.03, ao, sun * (1.0 - ck), wrap);
  c += rockFill(albedo, N) * fillK * (1.0 - 0.6 * ck); // (the rock's sky fill: as the terrain's rock reads)
  c *= 1.0 - 0.75 * ck; // (in a cave: Sites.ts)
  if (ck > 0.001) {
    // (a cave's walls: dim, never pitch black — and lit FROM somewhere: its openings — so the rock's relief and shapes
    //  read in there as under the sun; Atmosphere caveLit)
    float dl = caveLit(vWorld, N);
    // (2026-11-07, round 2 — the user: "remove that black thing from the rock": the ledges' undersides went black at a
    //  12 % fill; the terrain's rock is never near black in its shade — rockFill — so neither is the cave's)
    c += albedo * uAmbSky * ck * (0.42 + 0.7 * dl);
    c += albedo * (uSunColor * 0.3 + uAmbSky * 0.3) * caveBounce(vWorld) * ck * smoothstep(-0.05, 0.25, uSunDir.y) * (0.3 + 0.95 * dl); // (the skylight's daylight about it)
  }
  // LAMPS that burn day and night (a cave's crystals and lanterns): their own colour, bright, a slow breath
  if (surf > 4.5 && surf < 5.5) c = vCol * (2.2 + 0.4 * sin(uTime * 1.3 + dot(vWorld, vec3(0.7, 0.3, 0.5))));
  // the GHOST HOUSE's window (dusk to dawn): a cold pale light that gutters — out, back, a stutter — never steady
  if (surf > 5.5 && surf < 6.5) {
    // (its flicker from the paint noise scrolled by the clock — a sin() hash of a large argument came out ~0 on the GPU)
    float n1 = texture(uNoise, vec2(uTime * 0.031, vWorld.x * 0.013)).r, n2 = texture(uNoise, vec2(uTime * 0.23 + 0.5, vWorld.z * 0.011)).g;
    float f = smoothstep(0.3, 0.45, n1) * (0.55 + 0.45 * smoothstep(0.25, 0.75, n2));
    c = mix(c, vec3(0.45, 0.75, 0.7) * 1.8 * f, uLamps);
  }
  c += headlight(albedo, N, vWorld);
  // a lit window / a lantern / embers: OFF by day, on from dusk (uLamps), above white at night (the bloom takes it)
  c += vec3(1.0, 0.62, 0.28) * glow * 2.6 * uLamps;
  vec3 hz = applyAtmos(c, vWorld);
  // (a LAMP burning is a light, not a lit thing: the haze dims it less — a Warden beacon's crystal is a spark on its
  //  ridge from two kilometres, by day and at night; up close nothing changes)
  if (surf > 4.5 && surf < 5.5) hz = mix(hz, c, 0.6);
  gl_FragColor = vec4(hz, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
