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
    uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid } },
    defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}) },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
}

/** Collects boxes, logs, quads and triangles (flat normals, a colour each, a night glow) into one geometry. */
/** The surfaces a Builder's pieces can take (setSurf): the props' / landmarks' one material shades each its own way. */
export const SURF = { wood: 0, stone: 1, metal: 2, fabric: 3, plain: 4, lamp: 5, eerie: 6, turf: 7, cliff: 8 } as const

export class Builder {
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
  return mix(rk, mix(GREEN, GREEN_DEEP, f.r) * (1.1 / ROCK_VALUE), moss * 0.85);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${ROCK_RELIEF_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
${PAINT_GLSL}
${ROCK_PAINT}
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in float vGlow;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
#ifdef OTH_ROCK_RELIEF
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld); // (the rock's relief: taken here, outside any branch)
#endif
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
    rough = 0.92; wrap = 0.3;
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
  } else if (surf > 7.5) {
    // CLIFF — a cave's rock (Locations.rockMesh: flat facets, chunks and ledges; vCol its tint, darker in the hollows)
    albedo = rockPaint(vWorld, N, 1.0) * vCol * ROCK_VALUE;
#ifdef OTH_ROCK_RELIEF
    float cav;
    N = rockRelief(vWorld, N, 1.0, dpx, dpy, cav); // (the terrain's own crumpled creases: HIGH / ULTRA)
    ao = cav; // (their shade, as the terrain's)
#endif
    rough = 0.62; wrap = 0.45; fillK = 1.0;
  } else if (surf > 6.5) {
    // TURF (the tunnel's hill, its grass): the field's own paint (grassPaint — the terrain's and the grass's), from the
    // vertex: x the dryness (the mask's, where it stands), y the forest floor, z bare earth / rock (its steep faces)
    Paint p = paintNoise(vWorld.xz);
    vec3 gcol = grassPaint(vCol.x, p) * (0.9 + 0.2 * p.fine.g + (p.mid.r - 0.5) * 0.12 + (p.grain.r - 0.5) * 0.1);
    gcol = mix(gcol, FOREST * (0.8 + 0.4 * p.grain.g), vCol.y * 0.8);
    // (bare where it's steep: the caves' own rock — one rock, the face's and the hill's the same)
    fillK = smoothstep(0.45, 0.55, vCol.z + (p.fine.g - 0.5) * 0.5);
    albedo = gcol;
    if (fillK > 0.0) {
      albedo = mix(gcol, rockPaint(vWorld, N, 0.0) * ROCK_VALUE, fillK);
#ifdef OTH_ROCK_RELIEF
      float cav;
      N = rockRelief(vWorld, N, fillK, dpx, dpy, cav);
      ao = cav; // (fades with fillK)
#endif
    }
    albedo *= 1.0 + 0.45 * clamp(-vCol.z, 0.0, 1.0); // (the grass tufts' blades: lighter to their tips)
    rough = mix(0.95, 0.62, fillK); wrap = mix(0.35, 0.45, fillK);
  }
  float sun = sunVisibility(vWorld.xz), ck = caveK(vWorld);
  vec3 c = shade(albedo, N, V, rough, 0.03, ao, sun * (1.0 - ck), wrap);
  c += rockFill(albedo, N) * fillK * (1.0 - 0.6 * ck); // (the rock's sky fill: as the terrain's rock reads)
  c *= 1.0 - 0.75 * ck; // (in a cave: Sites.ts)
  c += albedo * uAmbSky * 0.35 * ck * fillK; // (a cave's walls: dim, never pitch black)
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
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
