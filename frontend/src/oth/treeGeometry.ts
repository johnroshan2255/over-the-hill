import * as GFX from './gfx'

/**
 * SPRUCE geometry (unit height, the trunk at the origin, up = +Y) — the Over-the-Hill conifer, redesigned after the
 * user's two references (a realistic spruce: whorls of drooping, feathery branches, light new growth at their tips, a
 * slender top; a stylized pine: distinct drooping tiers with fingered hanging ends, the warm trunk between them):
 * a warm brown TRUNK, and up it TIERS of BRANCH FRONDS — each a long card bent out and down from the trunk (the lower
 * tiers droop most, the top ones point up), folded along its stem like a roof, showing a frond of the FROND TEXTURE
 * (leafTexture.ts: a stem with needle-covered sprigs, fingers at its end; cut out round the needles in the shader) —
 * and inside every tier a dark solid COLLAR (the crown's shaded inside: no sky through its middle).
 *
 * Attributes: position, normal (soft: outward + up), color.r = AO (a frond's base 0.25 … its tip 1, the collars
 * dark), color.g = 1 foliage / 0 trunk (a snag hides its foliage), color.b = height in the tree (sway),
 * leaf = (s along the frond 0…1, across −1…1, −(1 + texture tile + tint × 0.9)) on a frond, (0, 0, 0) elsewhere.
 * Front faces point up (a back face is an underside, the shader darkens it).
 *
 * LODs: 0 = 13 tiers, two rings of folded fronds — 2 024 vertices, 2 011 triangles; 1 = 8 tiers, one ring — 476
 * vertices, 422 triangles. Beyond them the trees are impostors baked from LOD 0 (Trees.ts).
 */
interface Lod { tiers: number; rows: number; fold: boolean; maxFronds: number; inner: boolean; collar: number; trunkSides: number }
const LODS: Lod[] = [
  { tiers: 16, rows: 4, fold: true, maxFronds: 11, inner: true, collar: 7, trunkSides: 6 },
  { tiers: 10, rows: 3, fold: true, maxFronds: 8, inner: false, collar: 6, trunkSides: 3 },
]
/** Crown radius at the bottom as a share of the height (OTH spruce ≈ 3 : 1 … the references' broad skirts). */
export const CROWN = 0.2
/** Where the crown starts (share of the height): the bare trunk below. */
const CROWN_BASE = 0.1
/** Trunk radius at the foot (share of the height) — the same as the physics' trunk collider. */
const TRUNK_R = 0.022

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
}

const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }
/** The crown radius at height share y (the cone, a little convex). */
const crownR = (y: number) => CROWN * Math.pow(Math.max(0, (1 - y) / (1 - CROWN_BASE)), 0.9)

export function spruceGeometry(lod: number, seed = 7): GFX.BufferGeometry {
  const L = LODS[Math.min(lod, LODS.length - 1)], rnd = rng(seed + lod * 101)
  const pos: number[] = [], nor: number[] = [], col: number[] = [], leaf: number[] = [], idx: number[] = []
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number, ao: number, fol: number, ls = 0, lc = 0, lz = 0): number => {
    const l = Math.hypot(nx, ny, nz) || 1
    pos.push(x, y, z); nor.push(nx / l, ny / l, nz / l); col.push(ao, fol, Math.max(0, Math.min(1, y))); leaf.push(ls, lc, lz)
    return pos.length / 3 - 1
  }
  const P = (i: number) => new GFX.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
  const _a = new GFX.Vector3(), _b = new GFX.Vector3()
  /** A triangle, its winding chosen so the front face points up. */
  const tri = (a: number, b: number, c: number) => {
    const pa = P(a)
    _a.subVectors(P(b), pa); _b.subVectors(P(c), pa)
    if (_a.cross(_b).y >= 0) idx.push(a, b, c)
    else idx.push(a, c, b)
  }

  // TRUNK: a tapered prism, warm brown, to the top — stout below the crown, thinning fast inside it (a glimpse
  // between the tiers, not a pole up the tree)
  if (L.trunkSides) {
    const s = L.trunkSides, base = pos.length / 3, rings: [number, number, number][] = [[-0.02, TRUNK_R, 0.6], [0.3, TRUNK_R * 0.45, 0.65], [0.97, 0.0015, 0.75]]
    for (let k = 0; k < s; k++) {
      const a = (k / s) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a)
      for (const [y, r, ao] of rings) v(cx * r, y, sz * r, cx, 0, sz, ao, 0)
    }
    const nr = rings.length
    for (let k = 0; k < s; k++) for (let j = 0; j < nr - 1; j++) {
      const a = base + k * nr + j, b = base + ((k + 1) % s) * nr + j
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  /**
   * One BRANCH FROND from the trunk at height y0, out along angle a: its stem rises `up` and droops `droop` over its
   * reach `len` (y = y0 + up·s − droop·s²), `W` its half width at the widest; folded (LOD 0) its sides hang below the
   * stem like a roof. AO from its base (dark, by the trunk) to its tip, × the tier's shade.
   */
  const frond = (y0: number, a: number, len: number, up: number, droop: number, W: number, shade: number) => {
    // (each plate rolled a little about its stem: its own light, the faceted look of the references)
    const ox = Math.cos(a), oz = Math.sin(a), roll = (rnd() - 0.5) * 0.6, sx = -oz * Math.cos(roll), sz = ox * Math.cos(roll), sy = Math.sin(roll)
    const cols = L.fold ? [-1, 0, 1] : [-1, 1]
    const lz = -(1 + Math.floor(rnd() * 4) + rnd() * 0.9)
    const rows: number[][] = []
    for (let r = 0; r < L.rows; r++) {
      const s = r / (L.rows - 1)
      const reach = TRUNK_R * 0.5 + len * s, y = y0 + up * s - droop * s * s
      const hw = W * (0.75 + 0.25 * smooth01(s / 0.4))
      const ao = (0.25 + 0.75 * Math.pow(s, 0.7)) * shade
      const out = 0.35 + 0.35 * s
      rows.push(cols.map((c) => v(
        ox * reach + sx * c * hw, y + sy * c * hw - (L.fold ? Math.abs(c) * 0.35 * hw : 0), oz * reach + sz * c * hw,
        ox * out + sx * c * 0.3, 0.9 + sy * c * 0.3, oz * out + sz * c * 0.3, ao * (c === 0 ? 1 : 0.92), 1, s, c, lz,
      )))
    }
    for (let r = 0; r < L.rows - 1; r++) for (let c = 0; c < cols.length - 1; c++) {
      const a0 = rows[r][c], a1 = rows[r][c + 1], b0 = rows[r + 1][c], b1 = rows[r + 1][c + 1]
      tri(a0, a1, b1); tri(a0, b1, b0)
    }
  }

  // TIERS, bottom (t 0) to top (t 1): a ring of fronds (bigger tiers more of them), on LOD 0 a second, shorter ring
  // between them a little higher, and the dark collar inside
  const T = L.tiers
  for (let i = 0; i < T; i++) {
    const t = i / (T - 1)
    const y0 = CROWN_BASE + 0.04 + (0.92 - CROWN_BASE - 0.04) * Math.pow(t, 0.95)
    const R = crownR(y0) * (0.92 + 0.16 * rnd()) + 0.012
    const n = Math.max(3, Math.min(L.maxFronds, Math.round(3 + (R / CROWN) * (L.maxFronds - 3) + rnd() * 0.8)))
    const shade = 0.72 + 0.28 * Math.pow(t, 0.7) // (lower tiers a little darker)
    const phase = i * 2.39996 + rnd() * 0.5
    // (every tier's fronds DROOP — the stylized reference's hanging skirts, the realistic one's drooping branches —
    //  the lower ones most; only the top two or three point up: the slender top of both)
    const upK = 0.12 + 0.9 * Math.pow(t, 4), droopK = 0.85 - 0.35 * t
    let droopSum = 0
    for (let k = 0; k < n; k++) {
      const a = phase + ((k + (rnd() - 0.5) * 0.35) / n) * Math.PI * 2
      // (irregular: lengths and droops vary, now and then a long branch reaching out — the realistic outline)
      const len = R * (0.8 + 0.35 * rnd()) * (rnd() < 0.15 ? 1.18 : 1), droop = len * droopK * (0.75 + 0.5 * rnd())
      droopSum += droop
      frond(y0, a, len, len * upK, droop, len * (0.36 + 0.06 * t), shade)
    }
    if (L.inner) {
      const n2 = Math.max(2, Math.round(n * 0.7)), yi = y0 + 0.018 * (1 - t)
      for (let k = 0; k < n2; k++) {
        const a = phase + ((k + 0.5 + (rnd() - 0.5) * 0.4) / n2) * Math.PI * 2
        const len = R * (0.55 + 0.15 * rnd())
        frond(yi, a, len, len * (upK + 0.1), len * droopK * 0.7, len * 0.38, shade * 0.85)
      }
    }
    // the collar: a low dark cone inside the tier, half its reach
    const C = L.collar, yc = y0 - (droopSum / n) * 0.45
    const apex = v(0, y0 + 0.012, 0, 0, 1, 0, 0.14 * shade, 1)
    const ring: number[] = []
    for (let k = 0; k < C; k++) {
      const a = phase + (k / C) * Math.PI * 2, c = Math.cos(a), z = Math.sin(a)
      ring.push(v(c * R * 0.62, yc, z * R * 0.62, c * 0.5, 0.85, z * 0.5, 0.2 * shade, 1))
    }
    for (let k = 0; k < C; k++) tri(apex, ring[k], ring[(k + 1) % C])
  }
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new GFX.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new GFX.Float32BufferAttribute(col, 3))
  g.setAttribute('leaf', new GFX.Float32BufferAttribute(leaf, 3))
  g.setIndex(idx)
  return g
}

/**
 * BROADLEAF geometry (unit height) — OTH's aspens and birches (their crowns up close: ss2, tr18, the user's sunset
 * grove): a WHITE trunk that FORKS into 2–3 rising branches with a few side limbs, and a broad oval crown of LEAF
 * CLUMPS, each a bunch of LEAF CARDS — quads showing a cluster of ~110 tiny separate leaves from the leaf texture
 * (leafTexture.ts), cut out round their gaps in the shader — facing every way round the clump (some up, some out,
 * the lower ones hanging), a few bigger, darker cards through the middle so the crown has a core. Many small leaves,
 * the sky between them, a ragged leafy outline — under 1 000 vertices.
 * Attributes as the spruce's + `leaf`: (u, v ∈ −1…1 on a card, 1 + texture tile + tint × 0.9); (0, 0, 0) on the bark.
 * LOD 0 = 13 clumps × 10 cards + 5 core cards (~1 150 vertices: each card an octagon); LOD 1 = 7 clumps × 5 bigger
 * cards (~300). The crown
 * starts at HALF the height; per tree the vertex shader raises its base a little more (up to 0.62) and widens or
 * narrows it (×0.85–1.15) — every tree its own outline.
 */
/** A leaf card's octagon: its corners' radius (its edges at 0.96 of the card's half-width). */
const OCT_R = 0.96 / Math.cos(Math.PI / 8)

export function broadleafGeometry(lod: number, seed = 11): GFX.BufferGeometry {
  const rnd = rng(seed + lod * 53)
  const pos: number[] = [], nor: number[] = [], col: number[] = [], leaf: number[] = [], idx: number[] = []
  const vert = (p: GFX.Vector3, n: GFX.Vector3, ao: number, fol: number, lu = 0, lv = 0, lz = 0) => {
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(ao, fol, Math.max(0, Math.min(1, p.y))); leaf.push(lu, lv, lz)
    return pos.length / 3 - 1
  }
  /** A tapered limb a → b (radii ra, rb), `sides` sided. */
  const limb = (a: GFX.Vector3, b: GFX.Vector3, ra: number, rb: number, sides: number) => {
    const axis = new GFX.Vector3().subVectors(b, a).normalize()
    const u = new GFX.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? new GFX.Vector3(0, 1, 0) : new GFX.Vector3(1, 0, 0)).normalize()
    const w = new GFX.Vector3().crossVectors(axis, u)
    const base = pos.length / 3
    for (let k = 0; k < sides; k++) {
      const t = (k / sides) * Math.PI * 2, d = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t))
      vert(a.clone().addScaledVector(d, ra), d, 0.8, 0)
      vert(b.clone().addScaledVector(d, rb), d, 0.85, 0)
    }
    for (let k = 0; k < sides; k++) {
      const i0 = base + k * 2, i1 = base + ((k + 1) % sides) * 2
      idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1)
    }
  }
  // TRUNK + FORK + side limbs (they show through the gaps between the leaves)
  const sides = lod === 0 ? 5 : 3
  const forkY = 0.3 + 0.06 * rnd() // (low: the crown fills the top 70 % of the tree, the bare trunk 30 % — the user)
  const top = new GFX.Vector3(0, forkY, 0)
  // (2026-11-06, the user: "it doesn't match our valley" — a thin white stick read as a lollipop: a trunk with some
  //  weight, its limbs too)
  limb(new GFX.Vector3(0, -0.02, 0), top, 0.026, 0.016, sides)
  const nb = 2 + (rnd() < 0.5 ? 1 : 0)
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * Math.PI * 2 + rnd() * 0.8, lean = 0.07 + 0.05 * rnd()
    limb(top, new GFX.Vector3(Math.cos(a) * lean, 0.9 + 0.06 * rnd(), Math.sin(a) * lean), 0.014, 0.005, Math.max(3, sides - 1))
  }
  if (lod === 0) for (let b = 0; b < 5; b++) {
    const a = rnd() * Math.PI * 2, y = 0.33 + 0.11 * b + 0.04 * rnd(), l = 0.1 + 0.05 * rnd()
    limb(new GFX.Vector3(0, y, 0), new GFX.Vector3(Math.cos(a) * l, y + 0.07, Math.sin(a) * l), 0.007, 0.003, 3)
  }
  // the CROWN: leaf clumps in a tall oval — one on top, rings below it — from 30 % of the tree's height up (the user:
  // "70 % of the tree is leaves, only 30 % the trunk")
  const centre = new GFX.Vector3(0, 0.64, 0)
  const clumps: { c: GFX.Vector3; r: number; t: number }[] = []
  const rings = lod === 0 ? 4 : 2, perRing = lod === 0 ? 4 : 3, nC = rings * perRing + 1
  for (let cI = 0; cI < nC; cI++) {
    // (4 rings of 4 + one on top on LOD 0, 2 of 3 + 1 on LOD 1 — the crown broad and full, an oval)
    const t = cI === nC - 1 ? 1 : (cI % perRing) / perRing * 0.16 + Math.floor(cI / perRing) * (0.86 / rings) + 0.04
    const y = 0.38 + 0.56 * Math.min(1, t)
    const ring = cI === nC - 1 ? 0.02 : 0.15 * Math.sin(Math.PI * (0.18 + 0.72 * Math.min(1, t)))
    const a = cI * 1.618 * Math.PI + rnd() * 0.6
    const r = (lod === 0 ? 0.088 : 0.12) * (0.85 + 0.3 * rnd())
    clumps.push({ c: new GFX.Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring), r, t: Math.min(1, t) })
  }
  const tmp = new GFX.Vector3(), nrm = new GFX.Vector3(), uu = new GFX.Vector3(), vv = new GFX.Vector3(), out = new GFX.Vector3()
  /** One card: centre c, facing n (rotated by `spin` in its plane), half size h. */
  const card = (c: GFX.Vector3, n: GFX.Vector3, spin: number, h: number, ao: number) => {
    // (never flat: a horizontal card is seen edge-on from the ground — a dark streak against the sky)
    if (Math.abs(n.y) > 0.62) { n.y = Math.sign(n.y) * 0.62; const l = Math.hypot(n.x, n.z) || 1; const k = Math.sqrt(1 - 0.62 * 0.62) / l; n.x *= k; n.z *= k; if (l < 1e-3) n.x = Math.sqrt(1 - 0.62 * 0.62) }
    uu.crossVectors(n, Math.abs(n.y) < 0.95 ? new GFX.Vector3(0, 1, 0) : new GFX.Vector3(1, 0, 0)).normalize()
    vv.crossVectors(n, uu)
    const cu = Math.cos(spin), su = Math.sin(spin)
    const a1 = uu.clone().multiplyScalar(cu).addScaledVector(vv, su), a2 = uu.clone().multiplyScalar(-su).addScaledVector(vv, cu)
    out.subVectors(c, centre).normalize()
    // (lit as the crown's VOLUME — a lit side and a shaded side, as the spruce's tiers: mostly the crown's outward
    //  normal; the card's own facing a little, or every card its own random light and the crown reads flat)
    //  (tilted UP: the crown's side faces the high sun too, only its very bottom faces down — from the true centre half
    //  the crown faced away from it, a dark brown lower half under a gold top)
    out.y += 0.45
    const sn = out.normalize().multiplyScalar(0.9).addScaledVector(n, 0.1).normalize()
    const lz = 1 + Math.floor(rnd() * 4) + rnd() * 0.9
    // an OCTAGON round the leaf cluster, not the square (2026-11-06, docs/PERF.md): the cluster reaches ~0.95 of the
    // card's half-width (leafTexture.ts: its outline 0.44 × ≤ 1.02 of the tile, + half a leaf), so its edges at 0.96
    // cut off only the empty corners — a quarter of the card's pixels, each a texture read and a discard in the depth
    // pre-pass (and a shaded pixel, one pass, on LOW) — what paid for the bigger crowns
    const base = pos.length / 3
    for (let k = 0; k < 8; k++) {
      const an = (k + 0.5) * (Math.PI / 4), ua = Math.cos(an) * OCT_R, vb = Math.sin(an) * OCT_R
      tmp.copy(c).addScaledVector(a1, ua * h).addScaledVector(a2, vb * h)
      vert(tmp, sn, ao, 1, ua, vb, lz)
    }
    for (let k = 1; k < 7; k++) idx.push(base, base + k, base + k + 1)
  }
  const perClump = lod === 0 ? 10 : 5 // (fewer: gaps between the leaves — the user)
  for (const cl of clumps) {
    for (let k = 0; k < perClump; k++) {
      // spread over the clump's sphere (golden spiral), biased outward from the crown; lower ones droop
      const zz = 1 - (2 * (k + 0.5)) / perClump, rr = Math.sqrt(1 - zz * zz), ph = k * 2.39996 + rnd()
      const d = new GFX.Vector3(Math.cos(ph) * rr, zz, Math.sin(ph) * rr)
      out.set(cl.c.x, 0.15, cl.c.z).normalize()
      if (d.dot(out) < -0.2) d.addScaledVector(out, 0.9).normalize()
      const c = cl.c.clone().addScaledVector(d, cl.r * (0.45 + 0.25 * rnd()))
      nrm.copy(d).add(new GFX.Vector3(rnd() - 0.5, rnd() - 0.5 + (d.y < -0.3 ? -0.3 : 0.2), rnd() - 0.5).multiplyScalar(0.8)).normalize()
      out.subVectors(c, centre).normalize()
      const ao = Math.min(1.1, (0.6 + 0.4 * Math.max(0, d.dot(out))) * (0.78 + 0.32 * cl.t) * (0.9 + 0.2 * rnd()))
      card(c, nrm, rnd() * Math.PI * 2, cl.r * (lod === 0 ? 0.95 : 1.1) * (0.85 + 0.3 * rnd()), ao)
    }
  }
  // the core: a few bigger, darker cards crossing the crown's middle (no hollow shell)
  if (lod === 0) for (let k = 0; k < 5; k++) {
    const c = new GFX.Vector3((rnd() - 0.5) * 0.06, 0.45 + 0.4 * (k / 4), (rnd() - 0.5) * 0.06)
    card(c, new GFX.Vector3(rnd() - 0.5, rnd() * 0.6, rnd() - 0.5).normalize(), rnd() * 6.28, 0.085, 0.45) // (inside the crown)
  }
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new GFX.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new GFX.Float32BufferAttribute(col, 3))
  g.setAttribute('leaf', new GFX.Float32BufferAttribute(leaf, 3))
  g.setIndex(idx)
  return g
}

/**
 * A DATE PALM (the desert's oasis — Over the Hill's Algeria, 2026-11-02): unit height, a slender TRUNK leaning and
 * curving up (ringed: its segments alternate a little in tone), a CROWN of long FRONDS at the top — each a card along a
 * drooping arc, folded along its stem, showing the frond texture (leafTexture.ts: a stem with leaflets, fingered at its
 * end — the conifer's frond read as a palm's). The same attributes as the spruce: leaf = (s, across, −(1 + tile +
 * tint × 0.9)) on a frond. Trees.ts draws it in the broadleaf family's place in the desert (its impostor baked the same).
 * LOD 0: 13 fronds × 5 segments; LOD 1: 7 × 3.
 */
export function palmGeometry(lod: number, seed = 23): GFX.BufferGeometry {
  const rnd = rng(seed + lod * 71)
  const pos: number[] = [], nor: number[] = [], col: number[] = [], leaf: number[] = [], idx: number[] = []
  const vert = (p: GFX.Vector3, n: GFX.Vector3, ao: number, fol: number, lu = 0, lv = 0, lz = 0) => {
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(ao, fol, Math.max(0, Math.min(1, p.y))); leaf.push(lu, lv, lz)
    return pos.length / 3 - 1
  }
  // the TRUNK: a gentle lean and curve, tapering a little, ringed
  const segs = lod === 0 ? 7 : 4, sides = lod === 0 ? 6 : 4, crownY = 0.86
  const lean = new GFX.Vector3(0.09, 0, 0.03)
  const at = (t: number) => new GFX.Vector3(lean.x * t * t, t * crownY, lean.z * t * t)
  const ringBase: number[] = []
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, c = at(t), r = 0.026 - 0.008 * t
    ringBase.push(pos.length / 3)
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2, d = new GFX.Vector3(Math.cos(a), 0, Math.sin(a))
      vert(c.clone().addScaledVector(d, r * (s % 2 ? 0.92 : 1)), d, s % 2 ? 0.72 : 0.9, 0)
    }
  }
  for (let s = 0; s < segs; s++) for (let k = 0; k < sides; k++) {
    const a = ringBase[s] + k, b = ringBase[s] + ((k + 1) % sides), c = ringBase[s + 1] + k, d = ringBase[s + 1] + ((k + 1) % sides)
    idx.push(a, b, c, b, d, c)
  }
  // the CROWN: fronds out from the top, rising then drooping, folded along their stems
  const top = at(1)
  const nF = lod === 0 ? 13 : 7, nS = lod === 0 ? 5 : 3
  for (let f = 0; f < nF; f++) {
    const az = (f / nF) * Math.PI * 2 + rnd() * 0.4
    const up = 0.55 - 0.9 * (f % 3) / 3 - 0.2 * rnd()  // (some reach up, most arch out and droop)
    const len = 0.36 + 0.08 * rnd(), w = 0.07
    const dir = new GFX.Vector3(Math.cos(az), 0, Math.sin(az))
    const side = new GFX.Vector3(-dir.z, 0, dir.x)
    const lz = -(1 + Math.floor(rnd() * 4) + rnd() * 0.9)
    const base = pos.length / 3
    for (let s = 0; s <= nS; s++) {
      const t = s / nS
      // along the arc: out, up at first, then down (gravity), the frond's tip hanging
      const c = top.clone().addScaledVector(dir, len * t).add(new GFX.Vector3(0, len * (up * t - 0.75 * t * t), 0))
      const fold = 0.25 * w * (1 - t * 0.5) // (folded along its stem like a roof)
      const nUp = new GFX.Vector3(0, 1, 0).addScaledVector(dir, 0.3).normalize()
      for (const k of [-1, 0, 1]) {
        const p = c.clone().addScaledVector(side, k * w * (1 - 0.55 * t)).add(new GFX.Vector3(0, k === 0 ? fold : 0, 0))
        vert(p, nUp, 0.6 + 0.4 * t, 1, t, k, lz)
      }
    }
    for (let s = 0; s < nS; s++) for (let k = 0; k < 2; k++) {
      const a = base + s * 3 + k, b = a + 1, c = a + 3, d = a + 4
      idx.push(a, b, d, a, d, c)
    }
  }
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new GFX.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new GFX.Float32BufferAttribute(col, 3))
  g.setAttribute('leaf', new GFX.Float32BufferAttribute(leaf, 3))
  g.setIndex(idx)
  return g
}
