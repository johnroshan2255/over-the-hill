import * as GFX from './gfx'
import { type Atmosphere, LOOK } from './Atmosphere'
import { Builder, SURF, woodMaterial } from './Bridges'
import { campKit, FIRE_LOCAL } from './Landmarks'
import type { Horizon } from './Horizon'
import { type Landmark, lakeOff, type MapData } from './MapData'
import type { PropCollider } from './Props'
import type { Tier } from './quality'
import { cellSeed, type Rocks } from './Rocks'
import type { TerrainShadow } from './TerrainShadow'
import { gameParams } from '../settings'

/**
 * THE WARDENS' COUNTRY (2026-11-12, the user: "only the centre part of the valley has those explorable things — we need
 * statues, old writings, secret places, paths … imagine Genshin Impact … just travelling around is enough to make users
 * happy"): the outland is what's left of the WARDENS — the people who kept the World Tree, carved their guardians out of
 * the hills and lit beacons along the ridges. Their country lies in the grass: towers on the crests, temples on the
 * benches, rings of standing stones, colonnades, statue gardens, GIANTS (standing, kneeling, fallen), gates over the
 * roads, shrines and lanterns by the way, stone paths from the roads to the ruins, and their WRITING on the stones
 * (read it: stop by one — main.ts).
 *
 * THE RULE (docs/NEXT.md §10): from anywhere out there something on the skyline (a tower, a giant — seen to ~3 km), a
 * site within reach (every 500 m of the land has one within ~650 m) and small things on the way.
 *
 * Cheap by construction (Props.ts's way): a KIT of ~16 stone pieces, ONE InstancedMesh each (the landmarks' material:
 * stone, lichen on the tops, the lanterns lit at dusk, the beacons' crystals burning), every piece a matrix computed
 * once; per 256 m cell culled by the view and the hills, each piece drawn out to a reach that grows with its size (a
 * paving slab 160 m, a tower 2.6 km × the tier's) and not under ~2 px. The lists are rebuilt when the camera has moved
 * 8 m or turned. Colliders: boxes, streamed round the car by the physics with the props' (a platform, a stair, a
 * giant's plinth GROUND — the wheels climb them).
 *
 * Placed once, seeded per cell (`planWardens`): clear of the roads (a gate stands OVER one), the lakes, the crags, the
 * wilds' places, the box. The named sites join the landmarks — found, on the map, on the signposts, round them the GPS.
 * ?wardens=0: none (the A/B).
 */

type RGB = [number, number, number]
type V3 = GFX.Vector3
const V = (x: number, y: number, z: number) => new GFX.Vector3(x, y, z)
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1)

// the Wardens' stone: a pale warm grey (a little cooler on the statues), the dark of a carving
const STONE: RGB = [0.55, 0.53, 0.48], STONE_D: RGB = [0.42, 0.41, 0.38], STATUE: RGB = [0.56, 0.56, 0.53], CARVE: RGB = [0.13, 0.13, 0.13]
const AMBER: RGB = [0.95, 0.58, 0.16], LAMP: RGB = [0.9, 0.78, 0.55]

/** The kit's pieces (an InstancedMesh each). */
const KINDS = ['block', 'column', 'stump', 'arch', 'statue', 'kneel', 'head', 'lantern', 'obelisk', 'stone', 'tower', 'stair', 'roof', 'crystal', 'capital', 'dome', 'crystalDark', 'door', 'keystone', 'paving', 'hand', 'wallwin', 'walldoor', 'wallbrk',
  // (the look's DRESSING, 2026-11-13 — at real size, placed at scale ~1: Wardens `dress`)
  'rubble', 'bricks', 'timber', 'crate', 'barrel', 'camp', 'watch',
  // (round 3: the roads' low walls laid stone by stone and broken; the CREEPERS hanging over the walls)
  'drywall', 'drywall2', 'creeper'] as const
/** The walls' surface: laid stone with the look (Bridges.ts masonry), the plain stone without (?look=0). */
const MASON = LOOK ? SURF.masonry : SURF.stone
/** The dressing's kinds: thinned on the weaker tiers (detailKeep). */
const DETAIL = new Set<string>(['rubble', 'bricks', 'timber', 'crate', 'barrel', 'creeper'])
/** How much of the small DETAIL a tier draws (the dressing here, the ground's clutter — Clutter.ts): 1 on ULTRA / HIGH,
  0.6 MEDIUM, 0.35 LOW and a weak GPU (the phones). */
export function detailKeep(tier: Tier): number { return tier.weakGpu || tier.name === 'low' ? 0.35 : tier.name === 'medium' ? 0.6 : 1 }
type Kind = (typeof KINDS)[number]

// ------------------------------------------------------------------------------------------------------------ the kit
/** A hexahedron from its 8 corners (bottom 0–3 then top 4–7, each ring counter-clockwise from above). */
function hexa(b: Builder, p: V3[], col: RGB): void {
  const c = p.reduce((a, q) => a.add(q), V(0, 0, 0)).multiplyScalar(1 / 8)
  const face = (i: number, j: number, k: number, l: number, cc: RGB) => {
    const n = new GFX.Vector3().subVectors(p[j], p[i]).cross(new GFX.Vector3().subVectors(p[l], p[i]))
    if (n.dot(new GFX.Vector3().subVectors(p[i], c)) >= 0) b.quad(p[i], p[j], p[k], p[l], cc)
    else b.quad(p[i], p[l], p[k], p[j], cc)
  }
  face(0, 1, 2, 3, col); face(4, 5, 6, 7, col)
  for (let s = 0; s < 4; s++) { const t = (s + 1) % 4; face(s, t, t + 4, s + 4, col) }
}
/** A prism of `n` sides: radius r0 at y0 → r1 at y1 (each side's top at its own height if `tops`), capped. */
function prism(b: Builder, n: number, r0: number, r1: number, y0: number, y1: number, col: (i: number) => RGB, tops?: number[], cap = true): void {
  const ring = (r: number, y: number, i: number) => V(Math.cos((i / n) * Math.PI * 2) * r, y, Math.sin((i / n) * Math.PI * 2) * r)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ya = tops ? tops[i] : y1, yb = tops ? tops[j] : y1
    const ka = (ya - y0) / (y1 - y0), kb = (yb - y0) / (y1 - y0)
    const a0 = ring(r0, y0, i), b0 = ring(r0, y0, j), a1 = ring(r0 + (r1 - r0) * ka, ya, i), b1 = ring(r0 + (r1 - r0) * kb, yb, j)
    b.quad(a0, b0, b1, a1, col(i))
  }
  if (!cap) return
  const yc = tops ? tops.reduce((a, t) => a + t, 0) / n - (y1 - y0) * 0.04 : y1
  const top = V(0, yc, 0)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ya = tops ? tops[i] : y1, yb = tops ? tops[j] : y1
    b.tri(ring(r0 + (r1 - r0) * ((ya - y0) / (y1 - y0)), ya, i), top, ring(r0 + (r1 - r0) * ((yb - y0) / (y1 - y0)), yb, j), col(i))
  }
}
/** A faceted ball (lat-long, `la` × `lo`): centre c, radii (rx, ry, rz). */
function ball(b: Builder, c: V3, rx: number, ry: number, rz: number, la: number, lo: number, col: RGB): void {
  const P = (i: number, j: number) => { const t = (i / la) * Math.PI, f = (j / lo) * Math.PI * 2; return V(c.x + Math.sin(t) * Math.cos(f) * rx, c.y + Math.cos(t) * ry, c.z + Math.sin(t) * Math.sin(f) * rz) }
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
    const a = P(i, j), bb = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1)
    if (i === 0) b.tri(a, cc, bb, col)
    else if (i === la - 1) b.tri(a, d, bb, col)
    else b.quad(a, d, cc, bb, col)
  }
}
const box = (b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: RGB) => b.box(V(cx, cy, cz), X, Y, Z, hx, hy, hz, c)
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
/** A broken dry-stone wall (unit: ±0.5 along x, y 0 … 1, ±0.5 thick): four courses of rough single stones; its top
 *  RAGGED — the courses fall away into two breaks (at c1, c2 along it), a stone missing here and there; leaning a hair;
 *  the fallen stones at its foot, out on both sides. */
/** A ROUGH STONE: a hexahedron round (cx, cy, cz), half sizes h*, turned yaw — every corner pushed in or out (±25 %),
 *  its top a little smaller than its foot: a field stone, not a cut block. */
function roughStone(b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, col: RGB): void {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), j = () => 0.75 + b.rnd() * 0.5
  const P = (x: number, y: number, z: number) => V(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs)
  hexa(b, [P(-hx * j(), -hy, -hz * j()), P(hx * j(), -hy, -hz * j()), P(hx * j(), -hy, hz * j()), P(-hx * j(), -hy, hz * j()),
    P(-hx * 0.8 * j(), hy * j(), -hz * 0.8 * j()), P(hx * 0.8 * j(), hy * j(), -hz * 0.8 * j()), P(hx * 0.8 * j(), hy * j(), hz * 0.8 * j()), P(-hx * 0.8 * j(), hy * j(), hz * 0.8 * j())], col)
}
/** The dry walls' stone: a weathered grey-brown, darker than the Wardens' dressed stone. */
const FIELD: RGB = [0.23, 0.22, 0.195], MOSSY: RGB = [0.11, 0.13, 0.04]
function dryWall(b: Builder, c1: number, c2: number): void {
  b.setSurf(SURF.stone)
  const top = (x: number) => 1 - 0.62 * Math.exp(-(((x - c1) / 0.13) ** 2)) - 0.45 * Math.exp(-(((x - c2) / 0.09) ** 2)) - 0.12 * Math.abs(Math.sin(x * 23.0))
  // (round 4: the piece is scaled ~8 m along and ~0.8 m deep — a stone 0.03–0.065 of it is 0.25–0.55 m: field stones;
  //  at 0.07–0.15 they stretched into metre-long slabs and the wall read as a row of boxes)
  const C = 5, ch = 1 / C
  for (let k = 0; k < C; k++) {
    let x = -0.5 + (k % 2) * 0.05
    while (x < 0.5) {
      const w = 0.03 + b.rnd() * 0.035, cx = Math.min(x + w / 2, 0.5 - 0.01), y = (k + 0.5) * ch
      x += w + 0.003
      if (y > top(cx) || (k === C - 1 && b.rnd() < 0.3) || (k > 0 && b.rnd() < 0.06)) continue
      const lean = 0.03 * (y - 0.5)   // (the wall leaning a little out of true)
      roughStone(b, cx, y, lean + (b.rnd() - 0.5) * 0.06, w * 0.5, ch * (0.42 + b.rnd() * 0.1), 0.42 + b.rnd() * 0.06, (b.rnd() - 0.5) * 0.12, shade(FIELD, 0.6 + b.rnd() * 0.55))
      // (moss on the top course's stones and on the broken ends: a flat cushion over the stone)
      if (y + ch > top(cx) - 0.02 && b.rnd() < 0.55) { b.setSurf(SURF.plain); roughStone(b, cx, y + ch * 0.42, lean, w * 0.42, ch * 0.08, 0.36, b.rnd() * 0.3, shade(MOSSY, 0.8 + b.rnd() * 0.5)); b.setSurf(SURF.stone) }
    }
  }
  // (the fallen ones, at its foot — more under the breaks)
  for (let i = 0; i < 14; i++) {
    const x = i < 8 ? (i % 2 ? c1 : c2) + (b.rnd() - 0.5) * 0.25 : (b.rnd() - 0.5) * 0.95, side = b.rnd() < 0.5 ? -1 : 1
    roughStone(b, x, 0.04, side * (0.6 + b.rnd() * 0.5), 0.04 + b.rnd() * 0.03, 0.06 + b.rnd() * 0.04, 0.2 + b.rnd() * 0.15, b.rnd() * 6.28, shade(FIELD, 0.5 + b.rnd() * 0.45))
  }
}
/** A box turned (yaw about y, then tilted): the dressing's tumbled stones, bricks, splinters. */
const _rq = new GFX.Quaternion(), _re = new GFX.Euler()
const rbox = (b: Builder, cx: number, cy: number, cz: number, yaw: number, tilt: number, hx: number, hy: number, hz: number, c: RGB) => {
  _rq.setFromEuler(_re.set(tilt, yaw, tilt * 0.6, 'YXZ'))
  b.box(V(cx, cy, cz), X.clone().applyQuaternion(_rq), Y.clone().applyQuaternion(_rq), Z.clone().applyQuaternion(_rq), hx, hy, hz, c)
}
/** A LIMB: `n` sides from a (radius ra) to c (radius rc), its section flattened `flat` across the axis `wide` lies
 *  along (1: round); capped; every face turned outward whatever the winding. */
function limb(b: Builder, a: V3, c: V3, ra: number, rc: number, n: number, col: RGB, flat = 1, wide: V3 = X): void {
  const ax = new GFX.Vector3().subVectors(c, a).normalize()
  const u = wide.clone().addScaledVector(ax, -wide.dot(ax))
  if (u.lengthSq() < 1e-6) u.set(0, 0, 1).addScaledVector(ax, -ax.z)
  u.normalize()
  const w = new GFX.Vector3().crossVectors(ax, u)
  const ring = (o: V3, r: number, k: number) => { const t = (k / n) * Math.PI * 2 + 0.26; return o.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(w, Math.sin(t) * r * flat) }
  const out = (p0: V3, p1: V3, p2: V3, p3: V3 | null, from: V3, cc: RGB) => {
    const nn = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p2, p0))
    const mid = p3 ? new GFX.Vector3().addVectors(p0, p2).multiplyScalar(0.5) : new GFX.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3)
    const good = nn.dot(mid.sub(from)) >= 0
    if (p3) { if (good) b.quad(p0, p1, p2, p3, cc); else b.quad(p0, p3, p2, p1, cc) }
    else if (good) b.tri(p0, p1, p2, cc); else b.tri(p0, p2, p1, cc)
  }
  const m = new GFX.Vector3().addVectors(a, c).multiplyScalar(0.5)
  for (let k = 0; k < n; k++) {
    out(ring(a, ra, k), ring(a, ra, k + 1), ring(c, rc, k + 1), ring(c, rc, k), m, shade(col, k % 2 ? 0.95 : 1.03))
    out(a, ring(a, ra, k), ring(a, ra, k + 1), null, m, col)
    out(c, ring(c, rc, k), ring(c, rc, k + 1), null, m, col)
  }
}

/** Each piece, unit sized (on the ground at y 0, facing +z), and what it collides as (local box: centre y, half sizes —
 *  null: drive through / over it). */
const KIT: Record<Kind, { build: (b: Builder) => void; col: [number, number, number, number] | null; ground?: boolean }> = {
  // a dressed block (walls, platforms, plinths, lintels, the paths' slabs): ±0.5, y 0 … 1
  block: { build: (b) => { b.setSurf(MASON); box(b, 0, 0.5, 0, 0.5, 0.5, 0.5, STONE) }, col: [0.5, 0.5, 0.5, 0.5], ground: true },
  // a column's shaft: 12 sides, fluted (the sides in two tones), tapering a little — ⌀ 1, y 0 … 1
  column: { build: (b) => { b.setSurf(SURF.stone); prism(b, 12, 0.5, 0.44, 0, 1, (i) => shade(STONE, i % 2 ? 0.9 : 1.04)) }, col: [0.5, 0.4, 0.5, 0.4] },
  // a broken shaft: its top a jagged break
  stump: { build: (b) => { b.setSurf(SURF.stone); const tops = [1, 0.8, 0.92, 0.66, 0.74, 0.97, 0.85, 0.6, 0.7, 0.9, 0.78, 0.95]; prism(b, 12, 0.5, 0.46, 0, 1, (i) => shade(STONE, i % 2 ? 0.9 : 1.04), tops) }, col: [0.4, 0.4, 0.4, 0.4] },
  // an ARCH (a gate, a colonnade's span): ±0.5 across, y 0 … 1, ±0.5 deep — its opening 0.6 wide, to 0.86 high
  arch: {
    build: (b) => {
      b.setSurf(MASON)
      box(b, -0.4, 0.3, 0, 0.1, 0.3, 0.5, STONE); box(b, 0.4, 0.3, 0, 0.1, 0.3, 0.5, STONE)
      box(b, -0.4, 0.03, 0, 0.12, 0.03, 0.52, STONE_D); box(b, 0.4, 0.03, 0, 0.12, 0.03, 0.52, STONE_D)
      const n = 9, ri = 0.3, ro = 0.5, yc = 0.6
      for (let k = 0; k < n; k++) {
        const a0 = Math.PI - (k / n) * Math.PI, a1 = Math.PI - ((k + 1) / n) * Math.PI, g = 0.006
        const P = (a: number, r: number, z: number) => V(Math.cos(a) * r, yc + Math.sin(a) * r * 0.86, z)
        const c = k === Math.floor(n / 2) ? shade(STONE, 1.08) : shade(STONE, k % 2 ? 0.95 : 1.02)
        hexa(b, [P(a0 - g, ri, -0.5), P(a1 + g, ri, -0.5), P(a1 + g, ri, 0.5), P(a0 - g, ri, 0.5), P(a0 - g, ro, -0.5), P(a1 + g, ro, -0.5), P(a1 + g, ro, 0.5), P(a0 - g, ro, 0.5)].map((q, i) => i < 4 ? q : q) as V3[], c)
      }
      // (the spandrels: the square over the haunches, so the arch reads as a gate's wall)
      for (const s of [-1, 1]) hexa(b, [V(s * 0.5, 0.6, -0.5), V(s * 0.3, 0.6, -0.5), V(s * 0.3, 0.6, 0.5), V(s * 0.5, 0.6, 0.5), V(s * 0.5, 1, -0.5), V(s * 0.18, 1, -0.5), V(s * 0.18, 1, 0.5), V(s * 0.5, 1, 0.5)], shade(STONE, 0.96))
      box(b, 0, 1.02, 0, 0.54, 0.03, 0.54, STONE_D)
    },
    col: null,
  },
  // A WARDEN: a robed figure, hooded, its hands on a sword's pommel, the blade down in front — unit tall
  statue: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE, d = shade(STATUE, 0.84), lt = shade(STATUE, 1.06)
      // (2026-11-12: read as a PERSON at 40 m tall from a kilometre — the head, the shoulders, the arms and the sword
      //  clear of the body; a cape behind; the robe falling straight, not a cone)
      prism(b, 10, 0.135, 0.115, 0, 0.5, (i) => shade(c, i % 2 ? 0.93 : 1.02))         // the robe
      prism(b, 10, 0.115, 0.125, 0.5, 0.72, (i) => shade(c, i % 2 ? 0.97 : 1.03))      // the body
      box(b, 0, 0.5, 0.0, 0.125, 0.02, 0.125, d)                                         // the belt
      box(b, 0, 0.735, 0, 0.2, 0.03, 0.085, lt)                                          // the shoulders
      for (const s2 of [-1, 1]) ball(b, V(s2 * 0.19, 0.735, 0), 0.055, 0.05, 0.06, 3, 8, lt) // the pauldrons
      prism(b, 6, 0.032, 0.03, 0.76, 0.8, () => c, undefined, false)                     // the neck
      ball(b, V(0, 0.85, 0.005), 0.052, 0.068, 0.058, 4, 8, c)                           // the head
      prism(b, 8, 0.06, 0.012, 0.86, 0.97, () => d)                                      // the helm's crest
      box(b, 0, 0.87, 0.05, 0.035, 0.008, 0.012, CARVE)                                  // the eyes' shade
      // the cape: from the shoulders down the back to the ground, a little wider below
      hexa(b, [V(-0.21, 0.02, -0.15), V(0.21, 0.02, -0.15), V(0.21, 0.02, -0.11), V(-0.21, 0.02, -0.11), V(-0.18, 0.74, -0.09), V(0.18, 0.74, -0.09), V(0.18, 0.74, -0.05), V(-0.18, 0.74, -0.05)], d)
      for (const s2 of [-1, 1]) {
        b.log(V(s2 * 0.19, 0.72, 0), V(s2 * 0.17, 0.56, 0.06), 0.033, c)               // the upper arms
        b.log(V(s2 * 0.17, 0.56, 0.06), V(s2 * 0.03, 0.54, 0.16), 0.03, c)              // the forearms
      }
      box(b, 0, 0.54, 0.165, 0.045, 0.03, 0.03, lt)                                      // the hands on the pommel
      box(b, 0, 0.27, 0.17, 0.03, 0.24, 0.008, lt)                                       // the blade (flat), its point in the ground
      box(b, 0, 0.505, 0.17, 0.1, 0.012, 0.018, d)                                       // the guard
      ball(b, V(0, 0.585, 0.165), 0.022, 0.022, 0.022, 2, 6, d)                          // the pommel
    },
    col: [0.4, 0.17, 0.4, 0.17],
  },
  // A KNEELING WARDEN, holding a stone sun up over her head — unit tall (the sun's top at 1), facing +z.
  // (2026-11-12, round 2 — "box legs, a ball on two sticks": a FIGURE now. Down on her left knee, the shin and the foot
  //  lying back; the right knee up, its foot flat in front; the body leaning back under the weight, the head thrown
  //  back to look at what she holds; the arms out and up, bent at the elbow, the palms under the sun; a hood and a
  //  cape as the Sword-Bearer's; the sun a faceted ball in a ring of rays. ~560 triangles.)
  kneel: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE, d = shade(STATUE, 0.84), lt = shade(STATUE, 1.06)
      const hipL = V(-0.075, 0.25, -0.02), hipR = V(0.075, 0.25, -0.02), kneeL = V(-0.085, 0.045, 0.13), kneeR = V(0.095, 0.3, 0.2)
      // the left leg: the thigh down to the knee on the ground, the shin lying back, the foot on its toes
      limb(b, hipL, kneeL, 0.062, 0.05, 6, c)
      limb(b, kneeL, V(-0.085, 0.04, -0.17), 0.045, 0.034, 6, c)
      box(b, -0.085, 0.045, -0.2, 0.03, 0.045, 0.022, d)
      // the right leg: the thigh level, forward; the shin down; the foot flat
      limb(b, hipR, kneeR, 0.062, 0.052, 6, c)
      limb(b, kneeR, V(0.095, 0.04, 0.235), 0.047, 0.034, 6, c)
      box(b, 0.095, 0.02, 0.265, 0.032, 0.02, 0.055, d)
      // the hips, the body (leaning back a little, wider at the shoulders), the belt
      hexa(b, [V(-0.115, 0.2, -0.085), V(0.115, 0.2, -0.085), V(0.115, 0.2, 0.045), V(-0.115, 0.2, 0.045), V(-0.1, 0.3, -0.085), V(0.1, 0.3, -0.085), V(0.1, 0.3, 0.05), V(-0.1, 0.3, 0.05)], d)
      hexa(b, [V(-0.1, 0.29, -0.08), V(0.1, 0.29, -0.08), V(0.1, 0.29, 0.05), V(-0.1, 0.29, 0.05), V(-0.15, 0.55, -0.105), V(0.15, 0.55, -0.105), V(0.15, 0.55, 0.035), V(-0.15, 0.55, 0.035)], c)
      box(b, 0, 0.3, -0.015, 0.108, 0.014, 0.074, d)
      // the cape: from the shoulders down her back to the ground, wider below
      hexa(b, [V(-0.2, 0.01, -0.25), V(0.2, 0.01, -0.25), V(0.2, 0.01, -0.21), V(-0.2, 0.01, -0.21), V(-0.15, 0.55, -0.135), V(0.15, 0.55, -0.135), V(0.15, 0.55, -0.1), V(-0.15, 0.55, -0.1)], d)
      // the shoulders, the pauldrons
      box(b, 0, 0.555, -0.035, 0.185, 0.026, 0.075, lt)
      for (const s2 of [-1, 1]) ball(b, V(s2 * 0.185, 0.565, -0.035), 0.052, 0.046, 0.058, 3, 8, lt)
      // the neck and the head (thrown back: she looks up), its hood, the eyes' shade
      limb(b, V(0, 0.57, -0.035), V(0, 0.615, -0.045), 0.03, 0.028, 6, c)
      ball(b, V(0, 0.655, -0.05), 0.05, 0.062, 0.056, 4, 8, c)
      hexa(b, [V(-0.058, 0.6, -0.12), V(0.058, 0.6, -0.12), V(0.058, 0.63, -0.055), V(-0.058, 0.63, -0.055), V(-0.05, 0.71, -0.115), V(0.05, 0.71, -0.115), V(0.045, 0.725, -0.04), V(-0.045, 0.725, -0.04)], d)
      box(b, 0, 0.672, -0.002, 0.034, 0.008, 0.01, CARVE)
      // the arms: out and up to the elbows, in and up to the palms under the sun
      for (const s2 of [-1, 1]) {
        const sh = V(s2 * 0.185, 0.56, -0.035), el = V(s2 * 0.25, 0.685, -0.01), ha = V(s2 * 0.105, 0.79, -0.02)
        limb(b, sh, el, 0.036, 0.03, 6, c)
        limb(b, el, ha, 0.03, 0.025, 6, c)
        box(b, s2 * 0.09, 0.797, -0.02, 0.034, 0.011, 0.03, lt)
      }
      // THE STONE SUN: a faceted ball, a band round it, eight rays in the plane she faces
      const sy = 0.895, sz = -0.02
      ball(b, V(0, sy, sz), 0.088, 0.088, 0.088, 5, 10, shade(c, 1.1))
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2 + 0.39, ca = Math.cos(a0), sa = Math.sin(a0), w = 0.024
        const base = [V(ca * 0.082 - sa * w, sy + sa * 0.082 + ca * w, sz - 0.02), V(ca * 0.082 + sa * w, sy + sa * 0.082 - ca * w, sz - 0.02), V(ca * 0.082 + sa * w, sy + sa * 0.082 - ca * w, sz + 0.02), V(ca * 0.082 - sa * w, sy + sa * 0.082 + ca * w, sz + 0.02)]
        const tip = V(ca * 0.142, Math.min(1, sy + sa * 0.142), sz), mid = V(ca * 0.05, sy + sa * 0.05, sz)
        for (let q = 0; q < 4; q++) {
          const p0 = base[q], p1 = base[(q + 1) % 4]
          const nn = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(tip, p0))
          const fc = new GFX.Vector3().add(p0).add(p1).add(tip).multiplyScalar(1 / 3).sub(mid)
          if (nn.dot(fc) >= 0) b.tri(p0, p1, tip, lt); else b.tri(p0, tip, p1, lt)
        }
      }
    },
    col: [0.35, 0.2, 0.35, 0.25],
  },
  // A GIANT'S HEAD (fallen — lying on its cheek or sunk to the chin): unit, its face toward +z.
  // (2026-11-12, round 2 — a face that reads at 200 m: a HELM over the skull to the brow, a ridge along its crown, a
  //  nasal bar down the nose and cheek plates; deep eye sockets under a heavy brow; a long BEARD in strands; the neck's
  //  broken stump. ~420 triangles.)
  head: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE, d = shade(STATUE, 0.8), lt = shade(STATUE, 1.06), dk = shade(STATUE, 0.62)
      ball(b, V(0, 0.52, 0), 0.36, 0.42, 0.4, 6, 12, c)                                   // the skull and the face
      // the helm: a cap over the top half (a little proud of the skull), its rim a band, a ridge along the crown
      const HL = 5, HO = 12
      const Hp = (i: number, j: number) => { const t = (i / HL) * (Math.PI * 0.5), f = (j / HO) * Math.PI * 2; return V(Math.sin(t) * Math.cos(f) * 0.39, 0.6 + Math.cos(t) * 0.385, Math.sin(t) * Math.sin(f) * 0.43) }
      for (let i = 0; i < HL; i++) for (let j = 0; j < HO; j++) {
        const p0 = Hp(i, j), p1 = Hp(i + 1, j), p2 = Hp(i + 1, j + 1), p3 = Hp(i, j + 1), cc = shade(d, (i + j) % 2 ? 0.96 : 1.04)
        if (i === 0) b.tri(p0, p2, p1, cc); else b.quad(p0, p3, p2, p1, cc)
      }
      prism(b, 12, 0.4, 0.4, 0.555, 0.615, () => dk, undefined, false)                    // the rim
      for (const [z0, z1, y0, y1] of [[-0.4, -0.2, 0.78, 0.93], [-0.2, 0.05, 0.93, 1.0], [0.05, 0.3, 1.0, 0.9]]) hexa(b, [V(-0.03, y0 - 0.12, z0), V(0.03, y0 - 0.12, z0), V(0.03, y1 - 0.12, z1), V(-0.03, y1 - 0.12, z1), V(-0.012, y0, z0), V(0.012, y0, z0), V(0.012, y1, z1), V(-0.012, y1, z1)], dk)
      // the brow (heavy, jutting), the nasal bar down to the nose's tip, the nose behind it
      hexa(b, [V(-0.31, 0.585, 0.3), V(0.31, 0.585, 0.3), V(0.27, 0.57, 0.47), V(-0.27, 0.57, 0.47), V(-0.3, 0.66, 0.28), V(0.3, 0.66, 0.28), V(0.26, 0.66, 0.44), V(-0.26, 0.66, 0.44)], d)
      hexa(b, [V(-0.05, 0.36, 0.42), V(0.05, 0.36, 0.42), V(0.035, 0.36, 0.52), V(-0.035, 0.36, 0.52), V(-0.045, 0.6, 0.4), V(0.045, 0.6, 0.4), V(0.03, 0.6, 0.47), V(-0.03, 0.6, 0.47)], lt)
      // the eye sockets: deep, dark, under the brow (wide: they must read from far)
      for (const s2 of [-1, 1]) hexa(b, [V(s2 * 0.07, 0.47, 0.36), V(s2 * 0.26, 0.485, 0.3), V(s2 * 0.25, 0.485, 0.345), V(s2 * 0.07, 0.47, 0.405), V(s2 * 0.07, 0.575, 0.36), V(s2 * 0.27, 0.575, 0.29), V(s2 * 0.26, 0.575, 0.335), V(s2 * 0.07, 0.575, 0.4)], CARVE)
      // the cheek plates of the helm, down the sides of the face
      for (const s2 of [-1, 1]) hexa(b, [V(s2 * 0.3, 0.3, 0.1), V(s2 * 0.36, 0.3, 0.1), V(s2 * 0.31, 0.3, 0.31), V(s2 * 0.25, 0.3, 0.31), V(s2 * 0.33, 0.58, 0.05), V(s2 * 0.4, 0.58, 0.05), V(s2 * 0.34, 0.58, 0.33), V(s2 * 0.28, 0.58, 0.33)], d)
      // the mouth (a dark line) over the BEARD: five strands, falling from the cheeks and the lip past the chin
      box(b, 0, 0.315, 0.405, 0.1, 0.012, 0.02, CARVE)
      for (let k = -2; k <= 2; k++) {
        const x0 = k * 0.085, wdt = 0.04, top = 0.3 - Math.abs(k) * 0.012, bot = -0.02 + Math.abs(k) * 0.07, zt = 0.4 - Math.abs(k) * 0.045, zb = 0.33 - Math.abs(k) * 0.05
        hexa(b, [V(x0 - wdt * 0.6, bot, zb - 0.08), V(x0 + wdt * 0.6, bot, zb - 0.08), V(x0 + wdt * 0.6, bot, zb), V(x0 - wdt * 0.6, bot, zb), V(x0 - wdt, top, zt - 0.14), V(x0 + wdt, top, zt - 0.14), V(x0 + wdt, top, zt + 0.02), V(x0 - wdt, top, zt + 0.02)], shade(c, k % 2 ? 0.9 : 1.02))
      }
      // the neck: a broken stump
      prism(b, 8, 0.2, 0.17, -0.02, 0.2, (i) => shade(d, i % 2 ? 0.92 : 1.02), [0.2, 0.12, 0.17, 0.08, 0.15, 0.2, 0.1, 0.16])
    },
    col: [0.5, 0.4, 0.5, 0.42],
  },
  // a STONE LANTERN: its light-box lit from dusk — unit tall
  lantern: {
    build: (b) => {
      b.setSurf(SURF.stone)
      box(b, 0, 0.06, 0, 0.16, 0.06, 0.16, STONE_D)
      prism(b, 6, 0.06, 0.05, 0.12, 0.6, () => STONE)
      box(b, 0, 0.63, 0, 0.15, 0.03, 0.15, STONE)
      b.setGlow(1); box(b, 0, 0.75, 0, 0.1, 0.09, 0.1, LAMP); b.setGlow(0)
      hexa(b, [V(-0.2, 0.84, -0.2), V(0.2, 0.84, -0.2), V(0.2, 0.84, 0.2), V(-0.2, 0.84, 0.2), V(-0.02, 1, -0.02), V(0.02, 1, -0.02), V(0.02, 1, 0.02), V(-0.02, 1, 0.02)], STONE_D)
    },
    col: [0.4, 0.12, 0.4, 0.12],
  },
  // an OBELISK: a tapering square needle (base ±0.5), its point at 1, a band of carving near its foot
  obelisk: {
    build: (b) => {
      b.setSurf(SURF.stone)
      hexa(b, [V(-0.5, 0, -0.5), V(0.5, 0, -0.5), V(0.5, 0, 0.5), V(-0.5, 0, 0.5), V(-0.33, 0.9, -0.33), V(0.33, 0.9, -0.33), V(0.33, 0.9, 0.33), V(-0.33, 0.9, 0.33)], STONE)
      const tip = V(0, 1, 0), q = [V(-0.33, 0.9, -0.33), V(0.33, 0.9, -0.33), V(0.33, 0.9, 0.33), V(-0.33, 0.9, 0.33)]
      for (let i = 0; i < 4; i++) b.tri(q[i], tip, q[(i + 1) % 4], shade(STONE, 1.08))
      for (let k = 0; k < 4; k++) box(b, 0, 0.2 + k * 0.06, 0.475, 0.3 - k * 0.02, 0.008, 0.01, CARVE)
    },
    col: [0.5, 0.5, 0.5, 0.5],
  },
  // a STANDING STONE (a ring's, a writing's): a rough slab, its writing cut in its face
  stone: {
    build: (b) => {
      b.setSurf(SURF.stone)
      hexa(b, [V(-0.5, 0, -0.2), V(0.5, 0, -0.18), V(0.48, 0, 0.2), V(-0.46, 0, 0.18), V(-0.4, 1, -0.13), V(0.32, 0.88, -0.14), V(0.36, 0.86, 0.14), V(-0.36, 0.98, 0.13)], STONE)
      for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) if ((k * 7 + j * 3) % 5 !== 1) box(b, -0.2 + j * 0.2, 0.3 + k * 0.1, 0.19, 0.05, 0.022, 0.012, CARVE)
    },
    col: [0.5, 0.45, 0.5, 0.18],
  },
  // a ROUND TOWER, its top broken: 14 sides, ⌀ 1, a string-course half way, slits, a floor under the break
  tower: {
    build: (b) => {
      b.setSurf(MASON)
      const tops = Array.from({ length: 14 }, (_, i) => 1 - (i >= 5 && i <= 8 ? 0.06 + 0.05 * Math.sin(i * 2.1) : (i % 2) * 0.035))
      prism(b, 14, 0.5, 0.45, 0, 1, (i) => shade(STONE, i % 2 ? 0.94 : 1.02), tops)
      prism(b, 14, 0.52, 0.52, 0.42, 0.46, () => STONE_D, undefined, false)
      prism(b, 14, 0.53, 0.5, 0, 0.08, () => STONE_D, undefined, false)
      for (const [a, y] of [[0.3, 0.3], [2.2, 0.55], [4.1, 0.72], [1.2, 0.86], [5.3, 0.4]]) {
        const cx = Math.cos(a), cz = Math.sin(a), r = 0.505 - (y - 0) * 0.05
        b.quad(V(cx * r - cz * 0.025, y - 0.05, cz * r + cx * 0.025), V(cx * r + cz * 0.025, y - 0.05, cz * r - cx * 0.025), V(cx * r + cz * 0.025, y + 0.05, cz * r - cx * 0.025), V(cx * r - cz * 0.025, y + 0.05, cz * r + cx * 0.025), CARVE)
      }
    },
    col: [0.5, 0.42, 0.5, 0.42],
  },
  // a FLIGHT OF STEPS: six, climbing toward −z — unit
  stair: {
    build: (b) => { b.setSurf(SURF.stone); for (let k = 0; k < 6; k++) box(b, 0, (k + 1) / 12, 0.5 - (k + 0.5) / 12 - k / 12, 0.5, (k + 1) / 12, 0.5 / 6 + 0.001, shade(STONE, k % 2 ? 0.96 : 1.03)) },
    col: null,
  },
  // a GABLE (a temple's roof, its pediment): across x ±0.5, the ridge at 1, along z ±0.5
  roof: {
    build: (b) => {
      b.setSurf(SURF.stone)
      hexa(b, [V(-0.5, 0, -0.5), V(0.5, 0, -0.5), V(0.5, 0, 0.5), V(-0.5, 0, 0.5), V(-0.02, 1, -0.5), V(0.02, 1, -0.5), V(0.02, 1, 0.5), V(-0.02, 1, 0.5)], shade(STONE, 0.98))
    },
    col: null,
  },
  // a BEACON's CRYSTAL: amber, burning day and night (SURF.lamp) — an elongated octahedron, unit tall
  crystal: {
    build: (b) => {
      b.setSurf(SURF.lamp)
      const m = [V(0.3, 0.42, 0), V(0, 0.42, 0.3), V(-0.3, 0.42, 0), V(0, 0.42, -0.3)], top = V(0, 1, 0), bot = V(0, 0, 0)
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; b.tri(m[i], top, m[j], AMBER); b.tri(m[j], bot, m[i], shade(AMBER, 0.8)) }
    },
    col: null,
  },
  // … and the same crystal ASLEEP (a beacon not reached yet — Wardens.light): dull smoked amber, no light of its own
  crystalDark: {
    build: (b) => {
      b.setSurf(SURF.plain)
      const m = [V(0.3, 0.42, 0), V(0, 0.42, 0.3), V(-0.3, 0.42, 0), V(0, 0.42, -0.3)], top = V(0, 1, 0), bot = V(0, 0, 0), dull: RGB = [0.2, 0.15, 0.1]
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; b.tri(m[i], top, m[j], shade(dull, i % 2 ? 1.15 : 0.9)); b.tri(m[j], bot, m[i], shade(dull, 0.7)) }
    },
    col: null,
  },
  // A HOUSE'S WALL (±0.5 across, y 0 … 1, ±0.5 thick — scaled to a panel ~3.3 m × 3.5 m × 0.55 m): with a WINDOW …
  wallwin: {
    build: (b) => {
      b.setSurf(MASON)
      box(b, -0.36, 0.5, 0, 0.14, 0.5, 0.5, STONE); box(b, 0.36, 0.5, 0, 0.14, 0.5, 0.5, shade(STONE, 0.97))
      box(b, 0, 0.19, 0, 0.22, 0.19, 0.5, shade(STONE, 0.95)); box(b, 0, 0.86, 0, 0.22, 0.14, 0.5, shade(STONE, 1.03))
      box(b, 0, 0.395, 0, 0.27, 0.02, 0.62, STONE_D)                                       // the sill
    },
    col: null,
  },
  // … with a DOORWAY …
  walldoor: {
    build: (b) => {
      b.setSurf(MASON)
      box(b, -0.36, 0.5, 0, 0.14, 0.5, 0.5, STONE); box(b, 0.36, 0.5, 0, 0.14, 0.5, 0.5, shade(STONE, 0.97))
      box(b, 0, 0.87, 0, 0.22, 0.13, 0.5, shade(STONE, 1.03))
      box(b, 0, 0.72, 0, 0.26, 0.025, 0.6, STONE_D)                                        // the lintel
    },
    col: null,
  },
  // … and BROKEN OFF: four courses of different heights, the break ragged
  wallbrk: {
    build: (b) => {
      b.setSurf(MASON)
      const hs = [0.92, 0.58, 0.74, 0.3, 0.46]
      hs.forEach((hh, i) => box(b, -0.4 + i * 0.2, hh / 2, 0, 0.1, hh / 2, 0.5, shade(STONE, i % 2 ? 0.94 : 1.03)))
      box(b, 0.12, 0.07, 0.62, 0.16, 0.07, 0.14, STONE_D); box(b, -0.3, 0.05, -0.66, 0.12, 0.05, 0.12, STONE_D)   // fallen stones at its foot
    },
    col: null,
  },
  // A GIANT'S HAND, up out of a lake (the wrist at y 0, the fingertips at 1, the palm toward +z): the fingers a little
  // curled, the thumb out — unit tall
  hand: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE, d = shade(STATUE, 0.86)
      prism(b, 8, 0.15, 0.13, 0, 0.34, (i) => shade(c, i % 2 ? 0.93 : 1.02))
      prism(b, 8, 0.165, 0.165, 0.2, 0.25, () => d, undefined, false)                       // a bracer's band
      hexa(b, [V(-0.16, 0.32, -0.07), V(0.16, 0.32, -0.07), V(0.16, 0.32, 0.06), V(-0.16, 0.32, 0.06), V(-0.21, 0.64, -0.06), V(0.2, 0.64, -0.06), V(0.2, 0.64, 0.07), V(-0.21, 0.64, 0.07)], c)
      const len = [0.25, 0.33, 0.36, 0.3]
      for (let i = 0; i < 4; i++) {
        const x = -0.165 + i * 0.108, Lf = len[i], k0 = V(x, 0.63, 0.005), k1 = V(x * 1.06, 0.63 + Lf * 0.55, 0.035), k2 = V(x * 1.1, 0.63 + Lf, 0.125)
        limb(b, k0, k1, 0.047, 0.041, 5, c); limb(b, k1, k2, 0.041, 0.031, 5, c)
      }
      limb(b, V(0.17, 0.4, 0.02), V(0.3, 0.55, 0.075), 0.055, 0.045, 5, c); limb(b, V(0.3, 0.55, 0.075), V(0.335, 0.7, 0.12), 0.045, 0.034, 5, c)
      for (const y of [0.42, 0.5]) box(b, -0.02, y, 0.072, 0.13, 0.006, 0.006, CARVE)       // the palm's lines
    },
    col: [0.3, 0.2, 0.32, 0.14],
  },
  // PAVING: a slab (±0.5, y 0 … 1) whose top is 8 × 8 flags, each its own tone — a court's floor, the top of its ring
  // (one piece a floor: a plain block that wide read as a sheet of white)
  paving: {
    build: (b) => {
      b.setSurf(SURF.stone)
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = V(nx, 0, nz), t = V(-nz, 0, nx); b.quad(V(0, 0, 0).addScaledVector(n, 0.5).addScaledVector(t, 0.5), V(0, 0, 0).addScaledVector(n, 0.5).addScaledVector(t, -0.5), V(0, 1, 0).addScaledVector(n, 0.5).addScaledVector(t, -0.5), V(0, 1, 0).addScaledVector(n, 0.5).addScaledVector(t, 0.5), shade(STONE, 0.92)) }
      const N = 8
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x0 = -0.5 + i / N, x1 = x0 + 1 / N, z0 = -0.5 + j / N, z1 = z0 + 1 / N, tone = 0.6 + 0.24 * b.rnd() + ((i + j) % 2) * 0.05
        b.quad(V(x0, 1, z0), V(x0, 1, z1), V(x1, 1, z1), V(x1, 1, z0), shade(STONE_D, tone))
      }
    },
    col: [0.5, 0.5, 0.5, 0.5], ground: true,
  },
  // A VAULT'S DOOR: one slab (±0.5 across, y 0 … 1, ±0.5 thick), its face (+z) carved — a sun in a ring, a seam down
  // the middle, a border
  door: {
    build: (b) => {
      b.setSurf(SURF.stone)
      box(b, 0, 0.5, 0, 0.5, 0.5, 0.5, STONE_D)
      const z = 0.51
      for (const [cx, cy, hx, hy] of [[0, 0.06, 0.44, 0.012], [0, 0.94, 0.44, 0.012], [-0.44, 0.5, 0.012, 0.44], [0.44, 0.5, 0.012, 0.44]]) box(b, cx, cy, z, hx, hy, 0.012, CARVE)
      box(b, 0, 0.2, z, 0.006, 0.12, 0.012, CARVE); box(b, 0, 0.85, z, 0.006, 0.07, 0.012, CARVE)
      for (let k = 0; k < 12; k++) { const a0 = (k / 12) * Math.PI * 2; box(b, Math.cos(a0) * 0.2, 0.55 + Math.sin(a0) * 0.2 * 0.9, z, 0.03, 0.016, 0.012, CARVE) }
      for (let k = 0; k < 8; k++) { const a0 = (k / 8) * Math.PI * 2 + 0.39, c = Math.cos(a0), sn = Math.sin(a0); b.box(V(c * 0.3, 0.55 + sn * 0.3 * 0.9, z), V(c, sn, 0), V(-sn, c, 0), Z, 0.045, 0.01, 0.012, CARVE) }
    },
    col: [0.5, 0.5, 0.5, 0.5],
  },
  // … and its KEYSTONE: a wedge of paler stone proud of the door, an iron ring through it — what the winch takes
  keystone: {
    build: (b) => {
      b.setSurf(SURF.stone)
      hexa(b, [V(-0.36, 0, -0.5), V(0.36, 0, -0.5), V(0.3, 0, 0.3), V(-0.3, 0, 0.3), V(-0.5, 1, -0.5), V(0.5, 1, -0.5), V(0.42, 1, 0.3), V(-0.42, 1, 0.3)], shade(STONE, 1.1))
      b.setSurf(SURF.metal)
      const iron: RGB = [0.1, 0.09, 0.085]
      for (let k = 0; k < 8; k++) { const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2; b.log(V(Math.cos(a0) * 0.3, 0.42 + Math.sin(a0) * 0.3, 0.42), V(Math.cos(a1) * 0.3, 0.42 + Math.sin(a1) * 0.3, 0.42), 0.05, iron) }
    },
    col: null,
  },
  // ---- THE DRESSING (2026-11-13, the user's painted frames: "too empty — something needs to be there"): what a ruin
  // gathers — at real size, local frame on the ground
  // a RUBBLE MOUND (~3.4 m across, ~1 m high): chunks of the walls' dressed stone heaped and tumbled, a few out on the
  // grass round it
  rubble: {
    build: (b) => {
      b.setSurf(SURF.stone)
      for (let i = 0; i < 26; i++) {
        const a = b.rnd() * 6.283, r = Math.sqrt(b.rnd()) * (i < 20 ? 1.5 : 2.6), s = (i < 20 ? 0.18 + b.rnd() * 0.26 : 0.1 + b.rnd() * 0.12)
        const y = Math.max(0, (1 - r / 1.7)) * 0.75 + s * 0.4
        rbox(b, Math.cos(a) * r, y, Math.sin(a) * r, b.rnd() * 6.28, (b.rnd() - 0.5) * 0.7, s * (1.1 + b.rnd() * 0.8), s * (0.6 + b.rnd() * 0.4), s * (0.8 + b.rnd() * 0.5), shade(STONE, 0.62 + b.rnd() * 0.3))
      }
      // (its core: a low mound the chunks lie on, earth-dark)
      hexa(b, [V(-1.3, 0, -1.1), V(1.2, 0, -1.3), V(1.4, 0, 1.0), V(-1.1, 0, 1.3), V(-0.5, 0.62, -0.4), V(0.45, 0.66, -0.5), V(0.5, 0.58, 0.4), V(-0.4, 0.6, 0.5)], [0.2, 0.17, 0.13])
    },
    col: null,
  },
  // a heap of red-brown BRICKS (~2 m across): a fallen chimney's, a few strewn about it
  bricks: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const BRICK: RGB = [0.34, 0.12, 0.06]
      for (let i = 0; i < 46; i++) {
        const a = b.rnd() * 6.283, r = Math.sqrt(b.rnd()) * (i < 36 ? 0.9 : 1.9), y = Math.max(0, 1 - r / 1.0) * 0.45 + 0.04
        rbox(b, Math.cos(a) * r, y, Math.sin(a) * r, b.rnd() * 6.28, (b.rnd() - 0.5) * 0.9, 0.11, 0.035, 0.055, shade(BRICK, 0.7 + b.rnd() * 0.5))
      }
      hexa(b, [V(-0.8, 0, -0.7), V(0.8, 0, -0.75), V(0.85, 0, 0.7), V(-0.75, 0, 0.8), V(-0.3, 0.32, -0.25), V(0.3, 0.34, -0.3), V(0.3, 0.3, 0.3), V(-0.25, 0.32, 0.3)], [0.22, 0.1, 0.06])
    },
    col: null,
  },
  // CHARRED TIMBERS (a roof that burned and fell in): beams lying crossed and one propped against its stub of a post,
  // burnt black at their ends
  timber: {
    build: (b) => {
      b.setSurf(SURF.wood)
      const char: RGB = [0.035, 0.03, 0.027]
      const beam = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) => {
        const A = V(ax, ay, az), B = V(bx, by, bz), m1 = A.clone().lerp(B, 0.3), m2 = A.clone().lerp(B, 0.7)
        b.log(A, m1, r, char); b.log(m1, m2, r, shade(b.wood(0.6), 0.7)); b.log(m2, B, r, shade(char, 1.3))
      }
      beam(-1.8, 0.14, -0.3, 1.9, 0.16, 0.4, 0.13)
      beam(-1.2, 0.2, 0.9, 1.3, 0.38, -0.8, 0.12)
      beam(0.6, 0.12, 1.2, 0.9, 0.14, -1.6, 0.1)
      b.log(V(-1.4, 0, -1.2), V(-1.4, 1.5, -1.2), 0.14, char)                            // a post's burnt stub
      beam(-1.4, 1.35, -1.2, 0.6, 0.08, 0.2, 0.11)                                         // a rafter fallen from it
      for (let i = 0; i < 7; i++) { const a = b.rnd() * 6.28, r = b.rnd() * 1.8; rbox(b, Math.cos(a) * r, 0.04, Math.sin(a) * r, b.rnd() * 6.28, 0, 0.18 + b.rnd() * 0.2, 0.03, 0.06, char) }
    },
    col: null,
  },
  // a wooden CRATE (0.8 m): its planks and the battens across them
  crate: {
    build: (b) => {
      b.setSurf(SURF.wood)
      const w = b.wood(1.15)
      box(b, 0, 0.4, 0, 0.4, 0.4, 0.4, w)
      for (const s of [-1, 1]) {
        box(b, s * 0.41, 0.4, 0, 0.02, 0.38, 0.06, shade(w, 0.8)); box(b, 0, 0.4, s * 0.41, 0.06, 0.38, 0.02, shade(w, 0.8))
        box(b, s * 0.41, 0.4, 0, 0.02, 0.06, 0.38, shade(w, 0.85)); box(b, 0, 0.4, s * 0.41, 0.38, 0.06, 0.02, shade(w, 0.85))
      }
      box(b, 0, 0.81, 0, 0.38, 0.015, 0.06, shade(w, 0.8))
    },
    col: [0.4, 0.4, 0.4, 0.4],
  },
  // a BARREL (⌀ 0.62, 0.9 m): staves bulging at the middle, two iron hoops
  barrel: {
    build: (b) => {
      b.setSurf(SURF.wood)
      const w = b.wood(1.0)
      prism(b, 12, 0.27, 0.32, 0, 0.45, (i) => shade(w, i % 2 ? 0.9 : 1.05), undefined, false)
      prism(b, 12, 0.32, 0.27, 0.45, 0.9, (i) => shade(w, i % 2 ? 0.9 : 1.05))
      b.setSurf(SURF.metal)
      for (const y of [0.16, 0.74]) prism(b, 12, 0.305, 0.305, y - 0.03, y + 0.03, () => [0.07, 0.065, 0.06], undefined, false)
    },
    col: [0.45, 0.3, 0.45, 0.3],
  },
  // A CAMP in the ruin: the camps' own kit (Landmarks.campKit — the tent, the fire ring, the seats, the lantern; its
  // fire burns in Props: Wardens' `fires`)
  camp: { build: (b) => campKit(b), col: null },
  // a TIMBER WATCHTOWER (≈ 7.5 m): four log legs leaning in, braced, a plank deck at 5 m with a rail, a sloping
  // plank roof on posts, a ladder up one side
  watch: {
    build: (b) => {
      b.setSurf(SURF.wood)
      const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      const foot = (i: number) => V(legs[i][0] * 1.45, 0, legs[i][1] * 1.45), top = (i: number) => V(legs[i][0] * 1.1, 5.1, legs[i][1] * 1.1)
      for (let i = 0; i < 4; i++) b.log(foot(i).setY(-0.3), V(legs[i][0] * 1.06, 7.2, legs[i][1] * 1.06), 0.13, b.wood(0.85))
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        b.log(foot(i).clone().setY(0.4), top(j).clone().setY(4.9).lerp(foot(j), 0.08), 0.07, b.wood(0.8))   // the cross braces
        b.log(foot(i).clone().lerp(top(i), 0.45), foot(j).clone().lerp(top(j), 0.45), 0.07, b.wood(0.8))
      }
      // the deck: planks across, a rail round three sides
      for (let k = 0; k < 11; k++) box(b, -1.3 + k * 0.26, 5.12, 0, 0.12, 0.04, 1.42, b.wood(1.05))
      for (const [ax, az, bx, bz] of [[-1.35, -1.35, 1.35, -1.35], [1.35, -1.35, 1.35, 1.35], [-1.35, 1.35, -1.35, -1.35]]) {
        b.log(V(ax, 6.05, az), V(bx, 6.05, bz), 0.05, b.wood(0.9)); b.log(V(ax, 5.6, az), V(bx, 5.6, bz), 0.04, b.wood(0.9))
      }
      // the roof: a lean of planks over the posts' tops
      for (let k = 0; k < 9; k++) b.box(V(-1.5 + k * 0.375, 7.38 - 0.0, 0), X, V(0, 1, 0), Z, 0.19, 0.035, 1.7, shade(b.wood(0.75), 0.9 + 0.2 * (k % 2)))
      // the ladder up the open side (+z)
      for (const s of [-0.3, 0.3]) b.log(V(s, 0, 2.3), V(s, 5.15, 1.25), 0.045, b.wood(0.9))
      for (let k = 1; k < 13; k++) { const t = k / 13; b.log(V(-0.3, t * 5.15, 2.3 - t * 1.05), V(0.3, t * 5.15, 2.3 - t * 1.05), 0.03, b.wood(1.0)) }
      // a pennant on a pole above the roof
      b.log(V(1.1, 7.2, -1.1), V(1.1, 9.0, -1.1), 0.035, b.wood(0.8))
      b.setSurf(SURF.fabric)
      b.tri(V(1.12, 8.95, -1.1), V(1.12, 8.45, -1.1), V(2.0, 8.75, -1.0), [0.18, 0.2, 0.12]); b.tri(V(1.12, 8.95, -1.1), V(2.0, 8.75, -1.0), V(1.12, 8.45, -1.1), [0.15, 0.17, 0.1])
    },
    col: [2.6, 1.3, 2.6, 1.3],
  },
  // A DRY-STONE WALL, OLD AND BROKEN (round 3 — the user: "the stones beside the path look like boxes; they must look
  // broken and old"): unit (±0.5 along x, y 0 … 1, ±0.5 thick) — scaled to a ~6 m stretch, ~1 m high: four courses of
  // single rough stones, each its own size, tone and a little turned; the top RAGGED — whole stretches of the upper
  // courses gone, a stone missing here and there — the wall leaning a hair, the fallen stones lying at its foot
  drywall: { build: (b) => dryWall(b, 0.3, -0.25), col: [0.4, 0.45, 0.4, 0.45] },
  drywall2: { build: (b) => dryWall(b, -0.2, 0.32), col: [0.4, 0.45, 0.4, 0.45] },
  // A CREEPER's drape (round 3 — "we still don't have climbers or creepers"): unit (±0.5 across, hanging from y 1 to
  // 0, set on a wall's face at z 0, its leaves out to ~0.15 m — z is metres: placed at sz 1): six to nine vines down
  // the face, each its own length, leaves thick along them (more at the top), some over the wall's top; most green, a
  // few gone red and orange with the autumn
  creeper: {
    build: (b) => {
      b.setSurf(SURF.plain)
      const leaf = (cx: number, cy: number, cz: number, s: number, col: RGB, flat = false) => {
        const a = b.rnd() * 6.28, ux = Math.cos(a) * s, uy = Math.sin(a) * s
        const p0 = flat ? V(cx - ux, cy, cz - uy) : V(cx - ux * 0.6, cy - uy, cz)
        const p2 = flat ? V(cx + ux, cy + 0.01, cz + uy) : V(cx + ux * 0.6, cy + uy, cz + 0.04)
        const p1 = flat ? V(cx - uy * 0.6, cy + 0.02, cz + ux * 0.6) : V(cx - uy * 0.7, cy + ux * 0.5, cz + 0.06 + b.rnd() * 0.05)
        const p3 = flat ? V(cx + uy * 0.6, cy + 0.02, cz - ux * 0.6) : V(cx + uy * 0.7, cy - ux * 0.5, cz + 0.06 + b.rnd() * 0.05)
        b.quad(p0, p1, p2, p3, col); b.quad(p0, p3, p2, p1, shade(col, 0.75))
      }
      const colour = (): RGB => { const r = b.rnd(); return r < 0.1 ? [0.28, 0.07, 0.03] : r < 0.17 ? [0.32, 0.15, 0.03] : shade([0.045 + b.rnd() * 0.04, 0.085 + b.rnd() * 0.05, 0.022], 0.85 + b.rnd() * 0.4) }
      const n = 8 + Math.floor(b.rnd() * 4)
      for (let k = 0; k < n; k++) {
        const x0 = -0.45 + (k + b.rnd() * 0.8) * (0.9 / n), len = 0.35 + b.rnd() * 0.65
        let x = x0
        for (let y = 1.0; y > 1 - len; y -= 0.022 + b.rnd() * 0.014) {
          x = x0 + Math.sin(y * 9 + k) * 0.025
          const thin = (1 - y) / len   // (sparser toward the vine's end)
          if (b.rnd() < thin * 0.5) continue
          leaf(x + (b.rnd() - 0.5) * 0.08, y, 0.02 + b.rnd() * 0.06, 0.05 + b.rnd() * 0.04, colour())
        }
        // (over the top: a few leaves lying on the wall's head)
        for (let q = 0; q < 4; q++) leaf(x0 + (b.rnd() - 0.5) * 0.12, 1.01, -0.05 - b.rnd() * 0.3, 0.05 + b.rnd() * 0.03, colour(), true)
      }
    },
    col: null,
  },
  // a COLUMN's CAPITAL: a slab over a narrower one (⌀ 1 column → 1.3 wide)
  capital: { build: (b) => { b.setSurf(SURF.stone); box(b, 0, 0.3, 0, 0.42, 0.3, 0.42, STONE_D); box(b, 0, 0.8, 0, 0.65, 0.2, 0.65, STONE) }, col: null },
  // a DOME (a shrine's): a half ball, ⌀ 1, y 0 … 0.5
  dome: { build: (b) => { b.setSurf(SURF.stone); ball(b, V(0, 0, 0), 0.5, 0.5, 0.5, 3, 12, STONE); }, col: null },
}

// ------------------------------------------------------------------------------------------------------------ the plan
/** A piece placed: kind, where (its foot), turned rot (about y), tilted (about its own x, then z), scaled. */
export interface Piece { k: Kind; x: number; y: number; z: number; rot: number; sx: number; sy: number; sz: number; tx?: number; tz?: number
  /** (a beacon's crystal) the site it burns for — dark until that site is found; seen as far as a thing `far` m big */
  site?: number; far?: number }
export interface WardenText { id: number; x: number; z: number; place: string; title: string; text: string }
/** A SEALED VAULT: its site, the door's and the keystone's pieces (indices), the door's two boxes (standing; fallen),
 *  where the winch takes the keystone, the way it faces and its floor. */
export interface Vault { site: number; name: string; door: number; key: number; standing: PropCollider; fallen: PropCollider; ax: number; ay: number; az: number
  /** (the door fallen: its tilt — past flat where the ground in front is lower: a RAMP up to the floor — and how far it sinks, so its top meets the floor) */
  fallTx: number; sink: number }
export interface WardenPlan { sites: Landmark[]; pieces: Piece[]; cols: PropCollider[]; keep: [number, number, number][]; texts: WardenText[]; vaults: Vault[]; mapId: string
  /** The stone FLOORS (x, z, half sizes, rot): the grass keeps off them (Grass.setFloors). */
  floors: [number, number, number, number, number][]
  /** THE REGIONS (x, z, radius — 0 the Frozen Court, 1 the World Tree's, 2 the canyon's, 3 the lakes'; radius 0: none):
   *  the stone's tone there (Bridges.ts regionTint), and what stands there (below). */
  regions: [number, number, number][]
  /** THE RUINS' CAMPS' FIRES (2026-11-13, the look): a landmark-shaped spot each for Props (its flames, smoke, lantern
   *  and light) — not a site (not on the map). */
  fires: Landmark[] }
/** The styles of site that are SECRET: not on the map, the compass or a signpost until found. */
export const SECRET = new Set(['court', 'vault', 'vale'])

const PLANS = new WeakMap<MapData, WardenPlan>()

/** The Wardens' writing: what their stones say (the player reads them stopped beside one). */
const WRITINGS: [string, string][] = [
  ['A stone by the road', 'We were the keepers of the Tree. We kept its roots from the frost and its name from the careless. Walk softly; the road remembers feet.'],
  ['Cut deep, then worn', 'Seven beacons from the Tree to the white peaks. When one burns, all burn. When all burn, the valley wakes.'],
  ['A builder\'s mark', 'Set this stone myself. Took three days. The overseer says it leans. It does not lean. — Orrin'],
  ['On a lintel', 'Here the Wardens of the Long Dawn ate bread and argued about the stars. The stars won.'],
  ['A warning', 'Do not climb the Kneeling One. She holds the sun up for us. Be grateful, and go round.'],
  ['Half buried', 'The Grey came from the north in the year the lakes froze through. We carved the guardians taller, so they could see it coming.'],
  ['A child\'s scratching', 'Mira was here. Mira is the fastest runner in the whole valley. Ask anyone.'],
  ['Above a doorway', 'Leave your sword at the stair. Leave your anger at the gate. Leave your name at the Tree.'],
  ['A list', 'Lamp oil — nine jars. Bread — enough. Rope — never enough. Patience — less than yesterday.'],
  ['On a plinth', 'This one we called the Watcher. He never blinked. We blinked for him.'],
  ['Weathered smooth', 'The Tree is older than the hills. The hills are older than us. We are older than our sorrow, and it passes.'],
  ['A road-stone', 'To the Tree: follow the lanterns. To the peaks: follow the beacons. To home: follow your feet; they know.'],
  ['Beside a ring', 'Stand in the ring at first light and the shadow of the tall stone points to the spring. We drank there before the drought.'],
  ['A lover\'s stone', 'For Ilse, who laughed at the thunder. I carved this where you used to sit. The thunder still comes. I still listen.'],
  ['On a fallen column', 'Built in a summer, fell in a winter, still here in the spring. Not bad, for a column.'],
  ['A prayer', 'Wind, carry our lamps\' light over the ridges. Rain, fill the bowls of the stone suns. Earth, hold the giants still.'],
  ['Cut over and over', 'Count the towers from the gate: one for each Warden who walked into the Grey and came back.'],
  ['Near the giants', 'The giants were not made. They were found asleep in the hills, and we only uncovered their faces.'],
  ['A last line', 'We are leaving the valley to the grass. Whoever reads this: it is yours now. Keep it as we did — gently.'],
  ['A mason\'s complaint', 'Who decided every temple needs ninety steps? Not the people carrying the stones.'],
  ['By a beacon', 'Keep the crystal clean and it burns a hundred years. Keep the Warden clean and he lasts about three days.'],
  ['On a lantern', 'Lit for the travellers who never came. Lit anyway.'],
  ['A riddle', 'I have a face but no eyes that open; a crown but no head to wear it; I lie in the grass and watch the sky. What am I?'],
  ['Carved small', 'The Wardens counted the stars from this hill: four thousand and twelve. Then it got cloudy.'],
  ['A boundary stone', 'Here ends the Garden of the Quiet Hours. Speak again if you like.'],
  ['A record', 'In the third year of the frost, the Tree put out one new leaf. We held a feast for it. It was a very good leaf.'],
  ['An oath', 'By root and by stone: I will keep the road open, the lamp lit, the stranger fed.'],
  ['On the Sword-Bearer', 'He rests his hands on the blade because the fight is over. Do not wake him to start another.'],
  ['A star map, in words', 'The Plough over the Tree; the Hunter over the Gate; the Lantern, low in the south, over the white peaks.'],
  ['A gate\'s inscription', 'Whoever passes under me: go on. The road was made for going on.'],
  ['Found under moss', 'If the beacons ever burn again, it means someone has come home. Welcome home.'],
  ['On a stair', 'Ninety steps. Yes, we counted. Twice.'],
  ['A weather note', 'Rain from the west means rain. Rain from the east means the Grey. Rain from above means you forgot your hood.'],
  ['On a statue\'s foot', 'Carved in the likeness of Warden Halde, who held this pass alone for a night and a day. She said it was mostly waiting.'],
  ['A short one', 'Rest here.'],
  ['On the Sleeper\'s plinth', 'Do not be afraid of the sleeping ones. Be afraid of the day they are needed.'],
  // (2026-11-12, round 2 — 62 more, so the 538 stones repeat far less: the Tree, the Grey, the beacons, the giants, the
  //  leaving; and the small ones — builders, children, lovers, lists. Our own words.)
  // — the Tree
  ['The first law', 'No axe within sight of the Tree. No fire within its shade. No lie within its hearing.'],
  ['A gardener\'s note', 'Watered the east roots. Talked to it a while. It did not answer, but the wind picked up, which I take as yes.'],
  ['Under a root', 'The Tree drinks from four rivers and gives back one cloud. We thought that a fair trade.'],
  ['A measure', 'Round the trunk: three hundred paces. Round the shade at noon: a day\'s walk. Round its age: do not try.'],
  ['A lesson for children', 'What does the Tree teach? To stay. To reach. To let go of every leaf, every year, and not grieve.'],
  ['Carved with care', 'When the first Warden came here there was only the Tree and the weather. She asked which of them was in charge. It rained.'],
  ['On a root arch', 'Pass under and be counted. The Tree has counted everyone who ever came. It has not told us the number.'],
  ['A seed-keeper\'s stone', 'Nine seeds kept in the dry vault, against the day the Tree falls. May the vault never be opened.'],
  // — the Grey
  ['A watchman\'s tally', 'Grey on the north ridge at dawn. Gone by noon. Back at dusk, closer. Lit the beacon. Waited.'],
  ['Scratched in haste', 'It is not fog. Fog does not turn round when you call out.'],
  ['A field order', 'When the Grey comes down: lamps lit, doors open, nobody alone. It does not like company.'],
  ['After the long winter', 'The Grey took the high farms and the names of the people in them. We cut the names here so something would keep them.'],
  ['A scholar\'s line', 'I have decided the Grey is only weather that has forgotten how to stop. This comforts me a little, at night.'],
  ['On a north-facing stone', 'Stand here and look north. If you can see the white peaks, all is well. If you cannot, go home quickly.'],
  ['A truce', 'In the ninth year the Grey stopped at the stone rings and came no further. We do not know why. We have not asked.'],
  // — the beacons
  ['A keeper\'s rule', 'The beacon is lit by standing under it and meaning it. Nothing else has ever worked.'],
  ['A signal book, in stone', 'One flame: all is well. Two: come. Three: come armed. None: come anyway; we may be asleep.'],
  ['A tower\'s first stone', 'Raised in the year of the two comets by forty hands and one stubborn mule called Duty.'],
  ['On a tower door', 'Whoever keeps this beacon keeps the next one too, for a flame nobody sees is only a fire.'],
  ['A keeper\'s diary', 'Day two hundred. Saw the far beacon blink twice. Blinked back. Best conversation this month.'],
  ['Low on a wall', 'I was the last keeper of this light. I left it burning. If it is dark now, forgive me; I did try.'],
  ['A count', 'Seven on the east ridges. Seven on the west. Seven to the snow. Seven to the Tree. The rest we lost count of, gladly.'],
  // — the giants
  ['At a giant\'s foot', 'We asked the giants what they dreamed of. The ground shook a little. We stopped asking.'],
  ['A carver\'s confession', 'I was told to free the face from the hill. I swear the nose was already there.'],
  ['A lullaby', 'Sleep, tall one, under the grass. The sun is held. The road is kept. Sleep, and let the small folk pass.'],
  ['On a broken plinth', 'This one fell in the night without a sound. In the morning the birds were already nesting in his ear.'],
  ['A warning to carvers', 'Do not carve the eyes open. We did that once.'],
  ['The Kneeling One\'s verse', 'She does not kneel to anyone. She kneels to get under the weight. There is a difference; remember it.'],
  ['Twin stones', 'Two guardians face each other so that neither ever has to watch alone.'],
  ['A measure of giants', 'From heel to helm: forty men. From shoulder to shoulder: a house. From then to now: nobody knows.'],
  // — the leaving
  ['A farewell', 'The wells are capped, the lamps are trimmed, the gates are left open. We did not lock anything. It was never ours to lock.'],
  ['The last overseer', 'I counted everyone out through the west gate. Then I counted the giants. All present. Then I went too.'],
  ['On a threshold', 'We took the songs and the seed-corn. We left the stones, because stones are better at waiting.'],
  ['A promise', 'One of us will come back each spring to sweep the temple steps. If the steps are dusty, spring is late.'],
  ['Carved by many hands', 'Everyone who left cut one letter of this line. That is why it wanders. So did we.'],
  ['A map, of a kind', 'We went west, then we went on. If you are following us: you are kind, and you are late.'],
  // — builders and masons
  ['A quarry mark', 'Cut from the Harrow face. Dragged eleven miles. Dropped once. Do not tell the overseer where the chip is.'],
  ['A mason\'s boast', 'Not one drop of mortar in this wall. It stands on fit and spite.'],
  ['An apprentice\'s line', 'My first straight edge. Master says the second will be straighter. Master says a lot of things.'],
  ['On an unfinished block', 'Left for tomorrow.'],
  ['The overseer\'s reply', 'It leans, Orrin.'],
  ['A work song', 'Lift on the word. Set on the breath. Stone goes up, sun goes down, and supper is at the bottom.'],
  ['A column\'s number', 'Nineteenth of forty. The other thirty-nine are someone else\'s problem.'],
  // — children
  ['Scratched low', 'Tam can jump from this stone to that one. Mira says she can too. She cannot.'],
  ['A game\'s rules', 'Touch the lantern, run to the ring, hide behind the Watcher. Whoever the Watcher sees is out. He sees everyone.'],
  ['A wobbly line', 'This is my stone. I found it. Go and find your own.'],
  ['A lesson, copied badly', 'The beecons are lit by standing under them and meening it. Teacher says I spelled it rong.'],
  ['Mira again', 'Mira was here AGAIN. Still the fastest.'],
  // — lovers and letters
  ['Two hands', 'Meet me at the Needles when the second lantern is lit. — I was there. Where were you? — At the wrong Needles.'],
  ['A bench-stone', 'Sat here forty years with the same woman, watching the same hill. Never once got bored of either.'],
  ['For someone gone', 'You said the valley would still be green when I was old. It is gold, love. But you were close.'],
  ['A reply, cut later', 'Ilse heard you. She says the thunder was never as loud as your carving.'],
  // — lists, records, small things
  ['A weather stone', 'Frost early. Larches gold by the ninth moon. Geese gone south and complaining about it.'],
  ['A recipe', 'Barley, salt, the small blue berries from the snow line. Boil until someone asks what the smell is.'],
  ['A toll', 'To pass this gate: one true thing, said aloud. The gate keeps them. It has heard some strange ones.'],
  ['A traveller\'s tally', 'Days walked: thirty. Boots: two pairs. Blisters: do not ask. Views worth it: all of them.'],
  ['A lost-and-found', 'Found by the spring: one glove, one flute, one very patient goat. Ask at the temple.'],
  ['A rule of the road', 'Uphill gives way to downhill. Carts give way to children. Everyone gives way to the goat.'],
  ['A star-watcher\'s note', 'Counted again: four thousand and thirteen. Either a new star or I blinked last time.'],
  ['On a well-head', 'Sweet water, forty spans down. Lower the bucket slowly; the well does not like to be surprised.'],
  ['A blessing for wheels', 'May your axle hold, your road run dry, and the hill ahead be smaller than it looks.'],
  ['A last small one', 'If you have read this far, you have learned our letters. Then you are one of us. Keep the lamp lit.'],
]

/** Names (our own words), each kind its own pattern. */
const WORDS = ['Ash', 'Ember', 'Hollow', 'Long Dawn', 'Quiet Hours', 'Last Light', 'Salt', 'Thorn', 'Seven Winds', 'Lanterns', 'Sleeping Sun', 'Wren', 'Heath', 'Cinder', 'Gale', 'Amber', 'Willow', 'Briar', 'Harrow', 'Linden', 'First Frost', 'Open Hand', 'Low Moon', 'Kestrel', 'Bracken', 'Morrow', 'Still Water', 'High Grass', 'Old Roots', 'Grey Rain', 'Far Bells', 'Dusk', 'Nine Wells', 'Red Leaf', 'Moth', 'Barley', 'Tallow', 'Swallow', 'Fernhollow', 'Sedge', 'Rowan', 'Hearth', 'Sorrel', 'Tinder', 'Larkspur', 'Oriel', 'Wicken', 'Hazel', 'Sparrow', 'Lantern Hill', 'Cold Spring', 'Owl', 'Mallow', 'Gorse', 'Yarrow', 'Cloudberry', 'Elder', 'Starling', 'Long Shadow']

/** THE PLAN — seeded, made once a map (cached): where every site, piece, collider and writing goes. */
export function planWardens(map: MapData, rocks: Rocks): WardenPlan {
  const hit = PLANS.get(map)
  if (hit) return hit
  const plan: WardenPlan = { sites: [], pieces: [], cols: [], keep: [], texts: [], vaults: [], mapId: map.meta.id, floors: [], regions: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], fires: [] }
  PLANS.set(map, plan)
  if (map.desert || map.play <= map.half + 100 || gameParams().get('wardens') === '0') return plan
  const hb = map.half + 90, ho = map.play - 130
  // THE REGIONS' CHARACTER (docs/NEXT_outland.md §1 — "every region gets the same mix and the same stone"): four
  // countries round the outland, each its own stone (the material's tint) and its own leaning —
  //  0 THE FROZEN COURT (the early snow, under Whitecrown): pale stone; the beacons stand closer, more giants' heads
  //  1 THE TREE'S COUNTRY (round the World Tree): mossed green stone; gardens and lanterns, hardly an obelisk
  //  2 THE SCRIBES' (round Skyfall Canyon): ochre stone; standing stones with writing by every road, needles
  //  3 THE DROWNED SHRINES (the eastern lakes): dark damp slate; the ruins in the lakes themselves (above)
  {
    const O = map.meta.outland, pl = (k: string) => O?.places?.find((q) => q.kind === k), still = O?.lakes?.find((q) => q.name === 'Stillwater') ?? O?.lakes?.[0]
    const sn = O?.snow, wt = pl('worldtree'), cy = pl('canyon')
    if (sn) plan.regions[0] = [sn.x, sn.z, Math.min(2600, sn.r * 1.1)]
    if (wt) plan.regions[1] = [wt.x, wt.z, 2300]
    if (cy) plan.regions[2] = [cy.x, cy.z, 2100]
    if (still) plan.regions[3] = [still.x - 400, still.z + 700, 1900]
  }
  /** The region (0–3) that holds (x, z) — inside 80 % of its radius — or −1. */
  const region = (x: number, z: number): number => { for (let k = 0; k < 4; k++) { const [rx, rz, rr] = plan.regions[k]; if (rr > 0 && (x - rx) ** 2 + (z - rz) ** 2 < (rr * 0.8) ** 2) return k } return -1 }
  const H = (x: number, z: number) => map.height(x, z)
  const slopeAt = (x: number, z: number, d = 5) => Math.hypot(H(x + d, z) - H(x - d, z), H(x, z + d) - H(x, z - d)) / (2 * d)
  /** THE DRESSING'S own seed per site (2026-11-13): the plan's rnd untouched — every site's shape and name as before. */
  const dressRnd = (x: number, z: number, k: number) => { let s = cellSeed(Math.round(x), Math.round(z), 300 + k); return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296) }
  const keepOff: [number, number, number][] = [
    ...(map.meta.bridges ?? []).flatMap((b) => [[b.x0, b.z0, 40], [b.x1, b.z1, 40]] as [number, number, number][]),
    ...(map.meta.outland?.places ?? []).map((q) => [q.x, q.z, q.kind === 'worldtree' ? 1.5 * (q.h ?? 150) : q.kind === 'lake' ? 30 : Math.max(60, q.r * 0.9)] as [number, number, number]),
    ...(map.meta.landmarks ?? []).filter((l) => Math.abs(l.x) > map.half || Math.abs(l.z) > map.half).map((l) => [l.x, l.z, l.r + 40] as [number, number, number]),
    ...(map.meta.outland?.zones ?? []).map((Z) => [Z.x, Z.z, Z.r + 20] as [number, number, number]),
  ]
  // the sites taken so far (a hash of 200 m cells, each tagged with its kind): a kind keeps its own spacing (near with
  // that kind), and every site keeps ~110 m from any other (busy)
  const taken = new Map<number, [number, number, number, string][]>()
  const tk = (x: number, z: number) => Math.floor(x / 200) * 4096 + Math.floor(z / 200)
  const near = (x: number, z: number, r: number, kind?: string) => {
    const ci = Math.floor(x / 200), cj = Math.floor(z / 200), m = Math.ceil((r + 60) / 200)
    for (let i = ci - m; i <= ci + m; i++) for (let j = cj - m; j <= cj + m; j++) for (const [px, pz, pr, pk] of taken.get(i * 4096 + j) ?? []) {
      const d2 = (px - x) ** 2 + (pz - z) ** 2
      if (kind ? pk === kind && d2 < r * r : d2 < (r + pr) ** 2) return true
    }
    return false
  }
  let kindNow = ''
  const take = (x: number, z: number, r: number) => { const k = tk(x, z); const l = taken.get(k); const e: [number, number, number, string] = [x, z, r, kindNow]; if (l) l.push(e); else taken.set(k, [e]) }
  const busy = (x: number, z: number) => near(x, z, 110)
  // (a name used once: another word, or two)
  const used = new Set<string>()
  const word = (rnd: () => number, pattern: (w: string) => string) => {
    for (let t = 0; t < 12; t++) { const n = pattern(WORDS[Math.floor(rnd() * WORDS.length)]); if (!used.has(n)) { used.add(n); return n } }
    const n = pattern(`${WORDS[Math.floor(rnd() * WORDS.length)]} and ${WORDS[Math.floor(rnd() * WORDS.length)]}`); used.add(n); return n
  }
  const inLand = (x: number, z: number, r: number) => {
    const ax = Math.abs(x), az = Math.abs(z)
    return ax < ho - r && az < ho - r && (ax > hb + r || az > hb + r)
  }
  /** Ground for a site of radius r at (x, z): in the land, off the roads (8 m past r), the lakes, the crags, the places;
   *  its ground's spread over 9 points (null: no). */
  const ground = (x: number, z: number, r: number, maxSpread: number, road = true): { lo: number; hi: number } | null => {
    if (!inLand(x, z, r) || keepOff.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < (kr + r) ** 2)) return null
    let lo = Infinity, hi = -Infinity
    for (const [a, d] of [[0, 0], [0, 1], [1.57, 1], [3.14, 1], [4.71, 1], [0.78, 0.6], [2.36, 0.6], [3.93, 0.6], [5.5, 0.6]]) {
      const px = x + Math.cos(a) * r * d, pz = z + Math.sin(a) * r * d, h = H(px, pz)
      if ((road && map.roadEdge(px, pz) < 7.9) || map.lakeShore(px, pz, h, 1) || rocks.onCrag(px, pz, 2)) return null
      lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    return hi - lo > maxSpread ? null : { lo, hi }
  }
  // A site's ID is WHERE IT STANDS (2026-11-12 — it was its order in the plan, 900000 + n: any change to the plan
  // re-numbered every site, and a save's found set, lit beacons, read stones and opened vaults pointed at others): its
  // 4 m cell, 1 000 000 up (two sites never share one: they stand tens of metres apart); a writing's its 2 m cell.
  const idAt = (x: number, z: number) => 1000000 + (Math.round(x / 4) + 2048) * 4096 + Math.round(z / 4) + 2048
  const usedIds = new Set<number>()
  const P = (k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, tx = 0, tz = 0) => plan.pieces.push({ k, x, y, z, rot, sx, sy, sz, tx, tz })
  /** A collider box (world centre, half sizes, turned rot; ground: the wheels climb it). */
  const C = (x: number, y: number, z: number, rot: number, hx: number, hy: number, hz: number, ground = false, q?: GFX.Quaternion) => plan.cols.push({ x, y, z, rot, hx, hy, hz, ...(ground ? { ground: true } : {}), ...(q ? { q: [q.x, q.y, q.z, q.w] as [number, number, number, number] } : {}) })
  const eul = new GFX.Euler()
  /** A piece with its KIT collider (scaled) — turned and TILTED with the piece (2026-11-12, round 2: a leaning stone, a
   *  fallen column, the toppled giant were driven through, or stood in for by a box square to the world); a STAIR is a
   *  ramp along its steps, GROUND to the wheels (the car drove through every flight). */
  const PC = (k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, tx = 0, tz = 0, ground = !!KIT[k].ground) => {
    P(k, x, y, z, rot, sx, sy, sz, tx, tz)
    if (k === 'stair' && !tx && !tz) {
      // (the steps climb toward the piece's −z, from y 0 at z +½ to y 1 at z −½: a slab `t` thick under that line)
      const t = 0.7, L = Math.hypot(sy, sz), q = new GFX.Quaternion().setFromEuler(eul.set(Math.atan2(sy, sz), rot, 0, 'YXZ'))
      const o = V(0, -t / 2, 0).applyQuaternion(q)
      C(x + o.x, y + sy / 2 + o.y, z + o.z, rot, sx / 2, t / 2, L / 2, true, q)
      return
    }
    const c = KIT[k].col
    if (!c) return
    if (!tx && !tz) { C(x, y + c[0] * sy, z, rot, c[1] * sx, c[2] * sy, c[3] * sz, ground); return }
    const q = new GFX.Quaternion().setFromEuler(eul.set(tx, rot, tz, 'YXZ')), o = V(0, c[0] * sy, 0).applyQuaternion(q)
    C(x + o.x, y + o.y, z + o.z, rot, c[1] * sx, c[2] * sy, c[3] * sz, ground, q)
  }
  const site = (name: string, style: string, x: number, z: number, r: number, note?: [string, string], face = 0) => {
    let id = idAt(x, z)
    while (usedIds.has(id)) id += 1   // (never: a guard)
    usedIds.add(id)
    const l: Landmark = { id, kind: 'warden', name, x, z, y: H(x, z), rot: 0, r, style, face, ...(note ? { note: { title: note[0], text: note[1] } } : {}) }
    plan.sites.push(l)
    plan.keep.push([x, z, r + 4])
    take(x, z, r)
    return l
  }
  /** A dressing piece on the ground at (x, z) — not on a road, in a lake or on a steep bank; sunk a little. */
  const D = (k: Kind, x: number, z: number, rot: number, s = 1, sink = 0.12, steep = 0.35): boolean => {
    if (!LOOK || map.roadEdge(x, z) < 3 || map.lakeShore(x, z, H(x, z), 0.6) || slopeAt(x, z, 2) > steep) return false   // (?look=0: no dressing — the A/B)
    PC(k, x, H(x, z) - sink * s, z, rot, s, s, s)
    return true
  }
  /** A RUIN DRESSED (the look — the user's painted frames): n rubble mounds and brick heaps, charred timbers, scattered
   *  over a ring r0 … r1 of the local frame L round a site. */
  const strew = (L: (lx: number, lz: number) => [number, number], r: () => number, n: number, r0: number, r1: number, timber: number) => {
    for (let k = 0; k < n; k++) {
      const an = r() * 6.28, rr = r0 + (r1 - r0) * Math.sqrt(r()), [x, z] = L(Math.sin(an) * rr, Math.cos(an) * rr), q = r()
      D(k < timber ? 'timber' : q < 0.68 ? 'rubble' : 'bricks', x, z, r() * 6.28, 0.75 + r() * 0.6)
    }
  }
  let wi = 0
  const writing = (x: number, z: number, place: string, own?: [string, string]) => { const [title, text] = own ?? WRITINGS[wi++ % WRITINGS.length]; plan.texts.push({ id: (Math.round(x / 2) + 4096) * 8192 + Math.round(z / 2) + 4096, x, z, place, title, text }) }
  /** (a local point's world (x, z), its height y → the piece's (x, y, z). 2026-11-12, round 2: nine calls spread
   *  `...L(…)` straight into (x, y, z) — the z landed in y: every temple's steps and statue, the giants' steps and
   *  lanterns, the toppled Warden were drawn kilometres up, or under the ground. They stand where they were meant now.) */
  const up = (p: [number, number], y: number): [number, number, number] => [p[0], y, p[1]]
  /** A stone floor here (the grass keeps off it): centre, full sizes, turned rot. */
  const F = (x: number, z: number, w: number, d: number, rot: number) => plan.floors.push([x, z, w / 2 + 0.25, d / 2 + 0.25, rot])
  /** Local → world for a site at (x, z) turned a. */
  const at = (x: number, z: number, a: number) => (lx: number, lz: number): [number, number] => [x + lx * Math.cos(a) + lz * Math.sin(a), z - lx * Math.sin(a) + lz * Math.cos(a)]

  // ---- THE HIDDEN VALES (secret — mapPrep.carveVales cut each: a hollow in a hill, a bent ravine into it): in its
  // middle a ring of tall stones round a flagged dais where five crystals burn; against the far wall a Kneeling Warden
  // on her plinth, facing the way in; two lanterns just inside the mouth. Nothing outside says it's there.
  const VALE_TEXTS: [string, string][] = [
    ['On the tallest stone', 'The hill kept this place for itself for ten thousand years. We only asked to borrow it. Be a good guest.'],
    ['Cut where the ring opens', 'No road comes here on purpose. If you found the way in, the hill let you. Say thank you on the way out.'],
  ]
  map.vales.forEach((v, vi) => {
    kindNow = 'vale'
    let s = cellSeed(Math.round(v.x), Math.round(v.z), 147)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const a = Math.atan2(v.ex - v.x, v.ez - v.z), L = at(v.x, v.z, a), f = v.floor
    // (the way in kept CLEAR: no tree, bush, rock, crag or ruin in the ravine or across the hollow's mouth — a crag on
    //  the ravine's floor stopped the autopilot's car three times)
    for (const [px, pz] of v.path) { plan.keep.push([px, pz, 11]); keepOff.push([px, pz, 16]) }
    for (let d = 0; d <= v.r; d += 10) { const q = L(0, d); plan.keep.push([q[0], q[1], 9]) }
    keepOff.push([v.x, v.z, v.r + 6])
    PC('paving', v.x, f - 0.4, v.z, a + 0.785, 7.5, 1.1, 7.5)
    F(v.x, v.z, 7.5, 7.5, a + 0.785)
    for (const [lx, lz, sc, tx, tz] of [[0, 0, 1, 0, 0], [-1.7, 0.6, 0.62, 0.28, 0.22], [1.5, -0.9, 0.55, -0.24, -0.3], [0.5, 1.9, 0.4, 0.35, 0.1], [-0.9, -1.8, 0.45, -0.3, 0.2]]) { const q = L(lx, lz); P('crystal', ...up(q, f + 0.65), rnd() * 6.28, 2 * sc, 7 * sc, 2 * sc, tx, tz) }
    const n = 9, a0 = rnd() * 6.28
    for (let k = 0; k < n; k++) {
      // (the ring opens toward the way in: the stone that would stand there left out)
      const ang = a0 + (k / n) * 6.28, px = v.x + Math.cos(ang) * 15, pz = v.z + Math.sin(ang) * 15
      if (Math.cos(ang) * Math.sin(a) + Math.sin(ang) * Math.cos(a) > 0.9) continue
      PC('stone', px, H(px, pz) - 0.7, pz, -ang + 1.571, 2.4 + rnd() * 0.8, 5 + rnd() * 2.6, 2.4, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.12)
    }
    const [kx, kz] = L(0, -40), ky = H(kx, kz)
    PC('block', kx, ky - 0.8, kz, a, 9, 2.6, 9)
    F(kx, kz, 9, 9, a)
    PC('kneel', kx, ky + 1.8, kz, a, 13, 13, 13)
    for (const sd of [-1, 1]) { const q = L(sd * 7, 47); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.7, 2.1, 1.7) }
    for (const sd of [-1, 1]) { const q = L(sd * 6.5, -31); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.5, 1.8, 1.5) }
    const nm = word(rnd, (w) => `The Hidden Vale of ${w}`)
    site(nm, 'vale', v.x, v.z, 26, ['In the hollow', 'A round meadow inside the hill, walled by its own rock. Nine stones, five lights, and one who kneels at the far end holding up a sun nobody outside can see.'], a)
    writing(...L(4.6, 4.6), nm, VALE_TEXTS[vi % VALE_TEXTS.length])
  })
  // ---- THE SUNKEN COURTS (secret — mapPrep.sinkCourts cut the ground for each: a 16 m floor 5 m down): a ring of
  // stone round the pit (its top the rim: the one cell of slope round the floor is inside it), a stair down the side
  // that faces the road, columns at the corners; in it a dais with three crystals burning, four Wardens in the corners
  // looking at them, a stone with the court's own words. Not on the map or the compass until found; no path leads here.
  const COURT_TEXTS: [string, string][] = [
    ['Cut into the back wall', 'We dug down because the wind could not follow. Here we kept what must not blow away: seeds, names, the small fire.'],
    ['Under the stair', 'If you found this place you were not looking at the road. Good. Neither were we.'],
    ['Round the dais', 'Three lights for three promises: to stay, to watch, to leave gently. We kept two.'],
    ['On the floor, worn', 'Stand in the middle at midsummer noon and you have no shadow. That is when we judged disputes: nobody could hide behind theirs.'],
    ['Scratched by the corner', 'Quiet down here, isn\'t it? We came for that too.'],
    ['Above the crystals', 'These burn without oil. Do not ask us how. We found them burning and built the court round them.'],
  ]
  map.courts.forEach((ct, ci) => {
    kindNow = 'court'
    const a = (ct.side * Math.PI) / 2, L = at(ct.x, ct.z, a), f = ct.floor, top = ct.rim + 0.25, y0 = f - 0.6, hb = top - y0
    let s = cellSeed(Math.round(ct.x), Math.round(ct.z), 141)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    // (the ring in tiles of ~8 m, each 8 × 8 flags; the floor one slab of flags 0.3 m proud of the ground)
    for (const [lx, lz, w, d] of [[-12.375, -12.25, 8.25, 8.5], [-4.125, -12.25, 8.25, 8.5], [4.125, -12.25, 8.25, 8.5], [12.375, -12.25, 8.25, 8.5], [-12.25, -4, 8.5, 8], [-12.25, 4, 8.5, 8], [12.25, -4, 8.5, 8], [12.25, 4, 8.5, 8], [-13.125, 12.25, 6.75, 8.5], [-6.375, 12.25, 6.75, 8.5], [6.375, 12.25, 6.75, 8.5], [13.125, 12.25, 6.75, 8.5]]) PC('paving', ...up(L(lx, lz), y0), a, w, hb, d)
    PC('paving', ...up(L(0, 0), y0), a, 16, 0.9, 16)
    F(ct.x, ct.z, 33.4, 33.4, a)
    // (the stair's head at the GROUND outside it, not at the ring's top — the ring stands a little proud where the land
    //  falls away, and a stair up to its top ended in a ledge the car hit)
    PC('stair', ...up(L(0, 12.25), f + 0.3), a + Math.PI, 6, Math.min(top, H(...L(0, 16.6)) + 0.12) - f - 0.3, 8.5)
    // (a coping along the pit's edge, darker; columns at its corners — some broken)
    for (const [lx, lz, w, d] of [[0, -8.35, 18, 0.7], [-8.35, 0, 0.7, 16], [8.35, 0, 0.7, 16], [-5.85, 8.35, 5.7, 0.7], [5.85, 8.35, 5.7, 0.7]]) P('capital', ...up(L(lx, lz), top - 0.05), a, w / 1.3, 0.45, d / 1.3)
    for (const [lx, lz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      const q = L(lx, lz)
      if (rnd() < 0.6) { PC('column', ...up(q, top), 0, 1.3, 5.5, 1.3); P('capital', ...up(q, top + 5.5), 0, 1.3, 1, 1.3) } else PC('stump', ...up(q, top), 0, 1.3, 1.2 + rnd() * 2.6, 1.3)
    }
    for (const sd of [-1, 1]) { const q = L(sd * 4.4, 18.2); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.5, 1.8, 1.5) }
    // in the pit
    PC('block', ...up(L(0, 0), f + 0.2), a + 0.785, 4.6, 0.9, 4.6)
    P('crystal', ...up(L(0, 0), f + 1.1), a, 1.5, 3.4, 1.5)
    P('crystal', ...up(L(-1.2, 0.5), f + 1.05), a + 1, 0.9, 2, 0.9, 0.3, 0.25)
    P('crystal', ...up(L(1.1, -0.7), f + 1.05), a + 2, 0.8, 1.7, 0.8, -0.25, -0.3)
    for (const [lx, lz] of [[-5.9, -5.9], [5.9, -5.9], [-5.9, 5.9], [5.9, 5.9]]) {
      const q = L(lx, lz)
      PC('block', ...up(q, f + 0.2), a, 1.7, 0.8, 1.7)
      P(rnd() < 0.5 ? 'statue' : 'kneel', ...up(q, f + 1.0), a + Math.atan2(-lx, -lz), 3.3, 3.3, 3.3)
    }
    PC('stone', ...up(L(0, -6.9), f + 0.1), a, 2.6, 3.4, 2.2)
    // (two broken shafts by the stone — nothing lying across the floor: a fallen column at the stair's foot beached the car)
    for (const sd of [-1, 1]) PC('stump', ...up(L(sd * 3.6, -6.5), f + 0.3), 0, 1.1, 1.2 + rnd() * 2.2, 1.1)
    const nm = word(rnd, (w) => `The Sunken Court of ${w}`)
    site(nm, 'court', ct.x, ct.z, 21, ['In the court', 'A square pit, walled in dressed stone, hidden until you stand on its edge. Three crystals burn on the dais. Nobody has swept the stair in a very long time.'], a)
    writing(...L(0, -5), nm, COURT_TEXTS[ci % COURT_TEXTS.length])
  })
  // ---- THE DROWNED PLACES (docs/NEXT_outland.md "sites near water"): each real lake of the outland has one ruin IN it —
  // THE HAND (a giant's, up out of the water, its palm to the shore), a DROWNED TEMPLE (two rows of columns standing
  // in the shallows, steps going down into the water, a Warden on her plinth at the far end), or an ISLAND SHRINE (a
  // platform out in the lake, stepping stones to it from the shore). From the shore nearest a road, into the lake.
  ;(map.meta.outland?.lakes ?? []).filter((Lk) => Lk.x1 === undefined && Lk.r > 60).forEach((Lk, li) => {
    kindNow = 'water'
    let s = cellSeed(Math.round(Lk.x), Math.round(Lk.z), 143)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    // the shores: out from the middle along 32 bearings, where the bed comes up through the water
    let bestS: { x: number; z: number; ux: number; uz: number; sc: number } | null = null
    for (let k = 0; k < 32; k++) {
      const dx = Math.cos(k * 0.19635), dz = Math.sin(k * 0.19635)
      for (let d = 8; d < Lk.r; d += 3) {
        const x = Lk.x + dx * d, z = Lk.z + dz * d
        if (lakeOff(Lk, x, z) === Infinity) break
        if (H(x, z) < Lk.level) continue
        // (deep enough 30 m in from this shore, the land behind it gentle, and near a road if any is)
        const dIn = Lk.level - H(x - dx * 30, z - dz * 30), back = H(x + dx * 14, z + dz * 14) - Lk.level
        if (d < 45 || dIn < 1.6 || back > 6 || back < 0.2) break
        const sc = -Math.min(160, Math.max(0, map.roadEdge(x + dx * 10, z + dz * 10))) + rnd() * 30
        if (!bestS || sc > bestS.sc) bestS = { x, z, ux: -dx, uz: -dz, sc }
        break
      }
    }
    if (!bestS) return
    const { x: sx0, z: sz0, ux, uz } = bestS, a = Math.atan2(ux, uz), L = at(sx0, sz0, a), lv = Lk.level
    const bed = (lx: number, lz: number) => H(...L(lx, lz))
    const kind = li % 3
    if (kind === 0) {
      // THE HAND: where the water is ~3 m deep, 25–45 m out
      let d = 26
      while (d < 46 && lv - bed(0, d) < Math.min(3, Lk.depth * 0.6)) d += 3
      const S = 15 + rnd() * 4, [hx, hz] = L(0, d)
      PC('hand', hx, bed(0, d) - 1.2, hz, a + Math.PI, S, S, S, 0.1, (rnd() - 0.5) * 0.24)
      for (let k = 0; k < 4; k++) { const q = L((rnd() - 0.5) * 16, d * (0.2 + rnd() * 0.5)); P('block', ...up(q, H(...q) - 0.5), rnd() * 6.28, 2 + rnd() * 2.5, 1.4 + rnd() * 1.6, 1.6 + rnd() * 2, (rnd() - 0.5) * 0.5) }
      for (const sd of [-1, 1]) { const q = L(sd * 3.2, -5); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.6, 1.9, 1.6) }
      const nm = `The Hand in ${Lk.name}`
      site(nm, 'giant', hx, hz, 12, ['Carved on the shore', 'She went down with the valley\'s water in her arms and never let go of it. The lake is what she still holds.'], a + Math.PI)
      writing(...L(3.2, -3), nm, ['By the water', 'When the lake is low you can see her shoulder. When it is very low, you should leave.'])
    } else if (kind === 1) {
      // THE DROWNED TEMPLE: columns from 6 m out to 30 m, 5 m either side of the line; steps down from the shore
      const n = 6
      PC('stair', ...up(L(0, 2.5), lv - 2.2), a + Math.PI, 7, Math.max(1.2, H(...L(0, -1.5)) - lv + 2.3), 8)
      for (const sd of [-1, 1]) for (let k = 0; k < n; k++) {
        const lz = 7 + k * 4.6, [px, pz] = L(sd * 5, lz), by = bed(sd * 5, lz) - 0.6, r = rnd()
        if (r < 0.6) { PC('column', px, by, pz, 0, 1.4, lv - by + 5.5, 1.4); P('capital', px, lv + 5.5, pz, 0, 1.4, 1.1, 1.4) }
        else if (r < 0.85) PC('stump', px, by, pz, 0, 1.4, lv - by + 0.6 + rnd() * 2.4, 1.4)
        else PC('stump', px, by, pz, 0, 1.4, Math.max(0.5, lv - by - 0.4), 1.4)   // (broken off under the water)
      }
      for (let k = 0; k + 1 < n; k += 2) { const lz = 7 + (k + 0.5) * 4.6, sd = k % 4 ? 1 : -1, [px, pz] = L(sd * 5, lz); if (rnd() < 0.6) P('block', px, lv + 6.6, pz, a, 1.6, 0.9, 5.6) }
      const [ex, ez] = L(0, 7 + n * 4.6 + 1), eb = bed(0, 7 + n * 4.6 + 1) - 0.6
      PC('block', ex, eb, ez, a, 3, lv - eb + 0.5, 3)
      P('kneel', ex, lv + 0.5, ez, a + Math.PI, 5, 5, 5)
      for (const sd of [-1, 1]) { const q = L(sd * 4.6, -3.5); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.6, 1.9, 1.6) }
      const nm = word(rnd, (w) => `The Drowned Temple of ${w}`), [cx, cz] = L(0, 14)
      site(nm, 'temple', cx, cz, 18, ['On the top step', 'The lake rose a hand\'s breadth a year, and we moved the lamps up one step each spring. Then there were no more steps.'], a + Math.PI)
      writing(...L(4.4, -2), nm, ['Under the water line', 'If you can read this, the lake is low. Go and tell someone: it has not been this low since we left.'])
    } else {
      // THE ISLAND SHRINE: stepping stones (their tops just clear of the water) out to a platform 30 m from the shore
      const D = 30
      for (let d = 1.5, k = 0; d < D - 5; d += 3.3, k++) { const lx = Math.sin(k * 1.3) * 0.9, [px, pz] = L(lx, d), by = Math.min(bed(lx, d), lv) - 0.6; PC('block', px, by, pz, a + (rnd() - 0.5) * 0.5, 2.3 + rnd() * 0.5, lv - by + 0.22, 2.2 + rnd() * 0.4) }
      const [ix, iz] = L(0, D), ib = bed(0, D) - 0.8, top = lv + 0.55
      PC('paving', ix, ib, iz, a, 10, top - ib, 10)
      for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]) { const q = L(lx, D + lz); PC('column', ...up(q, top), 0, 0.5, 3.4, 0.5) }
      P('block', ix, top + 3.4, iz, a, 4.2, 0.4, 4.2); P('dome', ix, top + 3.8, iz, a, 3.8, 2.8, 3.8)
      P('statue', ix, top, iz, a + Math.PI, 2.4, 2.4, 2.4)
      for (const [lx, lz, sc] of [[-3.6, 3.4, 1], [3.5, 3.2, 0.8], [3.8, -3.4, 0.6]]) { const q = L(lx, D + lz); P('crystal', ...up(q, top), rnd() * 6.28, 0.9 * sc, 2.2 * sc, 0.9 * sc, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4) }
      for (const sd of [-1, 1]) { const q = L(sd * 4.2, D - 4.2); PC('lantern', ...up(q, top), a, 1.3, 1.6, 1.3) }
      for (const sd of [-1, 1]) { const q = L(sd * 3, -4); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.6, 1.9, 1.6) }
      const nm = word(rnd, (w) => `The Island Shrine of ${w}`)
      site(nm, 'shrine', ix, iz, 9, ['On the island', 'Walk out on the stones. Do not hurry; the lake has swallowed everyone who hurried.'], a + Math.PI)
      writing(...L(2.4, D + 1), nm, ['Round the dome', 'We built it out here so that coming to pray took a little courage. It was a small test, and nearly everyone passed.'])
    }
  })
  // ---- candidates: a jittered 70 m grid, each its own seed; what the ground there is like
  type Cand = { x: number; z: number; y: number; sl: number; prom: number; rnd: () => number }
  const cands: Cand[] = []
  for (let gz = -ho; gz < ho; gz += 70) for (let gx = -ho; gx < ho; gx += 70) {
    if (Math.abs(gx) < hb && Math.abs(gz) < hb) continue
    let s = cellSeed(Math.round(gx), Math.round(gz), 131)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const x = gx + rnd() * 70, z = gz + rnd() * 70
    if (!inLand(x, z, 10)) continue
    const y = H(x, z)
    let ring = 0
    for (let k = 0; k < 8; k++) ring += H(x + Math.cos(k * 0.785) * 140, z + Math.sin(k * 0.785) * 140)
    cands.push({ x, z, y, sl: slopeAt(x, z), prom: y - ring / 8, rnd })
  }
  // (a site's own random stream: from its candidate's)
  const byScore = (f: (c: Cand) => number) => cands.map((c) => ({ c, s: f(c) })).filter((o) => o.s > 0).sort((a, b) => b.s - a.s).map((o) => o.c)

  // ---- THE SEALED VAULTS (secret): a stone chamber built against the foot of a steep face — a carved frame, a great
  // door slab in it, a KEYSTONE with an iron ring proud of the door. The WINCH takes the ring (Winch.ts `extra`): hold
  // the car against the cable and the keystone comes out, the door falls flat (Wardens.openVault) — inside, a Warden,
  // crystals burning, the vault's own words. ~2.4 km apart, ten at most; not on the map or the compass until found.
  const VAULT_TEXTS: [string, string][] = [
    ['Inside the door', 'Sealed in the last autumn. Inside: the seed-corn of nine harvests, the names of the keepers, and one very good cheese. If the cheese is gone, we forgive you.'],
    ['On the back wall', 'We shut this door from the outside and walked away. It was the hardest thing we built: a door meant for someone else.'],
    ['Under the crystals', 'Whoever pulled the stone: you had help, or a strong beast, or one of those wagons that growl. We wondered what you would bring.'],
    ['A keeper\'s last line', 'The keystone is cut to come out, not to stay in. Nothing we made was meant to be shut for ever.'],
    ['Low, by the floor', 'I hid in here once as a girl, for a whole afternoon. Nobody found me. I have been a little proud of it ever since.'],
  ]
  {
    let nv = 0
    for (const c of byScore((c) => {
      if (c.sl > 0.22) return 0
      let best = 0
      for (let k = 0; k < 8; k++) best = Math.max(best, H(c.x + Math.cos(k * 0.785) * 19, c.z + Math.sin(k * 0.785) * 19) - c.y)
      return best >= 7 ? best + c.rnd() * 4 : 0
    })) {
      kindNow = 'vault'
      if (nv >= 10) break
      if (near(c.x, c.z, 2400, 'vault') || busy(c.x, c.z)) continue
      const g = ground(c.x, c.z, 9, 3.2)
      if (!g) continue
      // (its back to the hill: the way the ground rises most, 19 m out)
      let hx = 0, hz = 0, rise = 0
      for (let k = 0; k < 16; k++) { const dx = Math.cos(k * 0.3927), dz = Math.sin(k * 0.3927), r = H(c.x + dx * 19, c.z + dz * 19) - c.y; if (r > rise) { rise = r; hx = dx; hz = dz } }
      if (rise < 7) continue
      // (… and open in front: the car has to stand there, square to the door, within the winch's reach)
      if (H(c.x - hx * 16, c.z - hz * 16) - c.y > 2.5 || map.roadEdge(c.x - hx * 14, c.z - hz * 14) < 2) continue
      nv++
      const a = Math.atan2(-hx, -hz), L = at(c.x, c.z, a), y0 = g.lo - 0.6, fl = g.hi + 0.2
      PC('block', ...up(L(0, -4), y0), a, 10, fl - y0, 9.8)                                // the podium (its floor)
      F(...L(0, -1.2), 10.6, 15.4, a)                                                      // (… and where its door falls)
      for (const sd of [-1, 1]) PC('block', ...up(L(sd * 4.1, -4.1), fl), a, 1.6, 5, 8)    // the side walls
      PC('block', ...up(L(0, -8.3), fl), a, 9.8, 5, 1.4)                                   // the back wall (in the hill)
      for (const sd of [-1, 1]) PC('block', ...up(L(sd * 3.6, 0.2), fl), a, 1.8, 5, 1.4)   // the front piers: a 5.4 m opening (a car's width and a metre a side)
      PC('block', ...up(L(0, -4), fl + 5), a, 10.6, 1, 10.2)                               // the roof slab
      P('roof', ...up(L(0, -4), fl + 6), a, 10.6, 2.3, 10.2)
      P('arch', ...up(L(0, 1.25), fl - 0.3), a, 9.1, 6.2, 0.9)                             // the carved frame
      const door = plan.pieces.length
      P('door', ...up(L(0, 0.25), fl), a, 5.4, 4.9, 0.6)
      const [dx0, dz0] = L(0, 0.25)
      const qd = new GFX.Quaternion().setFromEuler(eul.set(0, a, 0, 'YXZ'))
      const standing: PropCollider = { x: dx0, y: fl + 2.45, z: dz0, rot: a, hx: 2.7, hy: 2.45, hz: 0.3, q: [qd.x, qd.y, qd.z, qd.w] }
      // (fallen: flat on level ground; where the ground in front is lower than the floor, on down to it — the slab is
      //  the ramp up into the vault. Sunk 0.3 m as it goes, so its top face meets the floor's edge.)
      const [ex, ez] = L(0, 0.25 + 4.9), fallTx = Math.PI / 2 + Math.asin(Math.max(-0.12, Math.min(0.62, (fl - 0.1 - H(ex, ez)) / 4.9)))
      const qf = new GFX.Quaternion().setFromEuler(eul.set(fallTx, a, 0, 'YXZ')), of = V(0, 2.45, 0).applyQuaternion(qf)
      const fallen: PropCollider = { x: dx0 + of.x, y: fl - 0.3 + of.y, z: dz0 + of.z, rot: a, hx: 2.7, hy: 2.45, hz: 0.3, q: [qf.x, qf.y, qf.z, qf.w], ground: true, off: true }
      plan.cols.push(standing, fallen)
      const key = plan.pieces.length, [kx, kz] = L(0, 0.78)
      P('keystone', kx, fl + 2.1, kz, a, 1.0, 1.0, 0.7)
      // inside: a Warden at the back, crystals at her feet, the floor's flags
      PC('block', ...up(L(0, -6.6), fl), a, 2, 0.7, 2)
      P('statue', ...up(L(0, -6.6), fl + 0.7), a, 3.6, 3.6, 3.6)
      P('crystal', ...up(L(-2.1, -6.4), fl), a + 0.4, 1.0, 2.4, 1.0, 0.12, 0.2)
      P('crystal', ...up(L(2.0, -6.2), fl), a + 1.3, 1.1, 2.7, 1.1, -0.1, -0.22)
      P('crystal', ...up(L(2.6, -5.2), fl), a + 2.1, 0.6, 1.3, 0.6, 0.3, 0.1)
      for (const sd of [-1, 1]) { const q = L(sd * 5.6, 3.4); PC('lantern', ...up(q, H(...q) - 0.1), a, 1.5, 1.8, 1.5) }
      for (let k = 0; k < 5; k++) { const q = L((c.rnd() - 0.5) * 9, 4 + c.rnd() * 7); P('block', ...up(q, H(...q) - 0.35), c.rnd() * 6.28, 1 + c.rnd() * 1.4, 0.7, 0.9 + c.rnd(), (c.rnd() - 0.5) * 0.4) }
      const nm = word(c.rnd, (w) => `The Sealed Vault of ${w}`)
      plan.vaults.push({ site: idAt(c.x, c.z), name: nm, door, key, standing, fallen, ax: kx, ay: fl + 2.5, az: kz, fallTx, sink: 0.3 })
      site(nm, 'vault', c.x, c.z, 12, ['On the door', 'A slab of stone in a carved frame, a wedge with an iron ring set proud of it. The ring is worn bright on one side — by rope, or by chain.'], a)
      writing(...L(0, -3.2), nm, VAULT_TEXTS[(nv - 1) % VAULT_TEXTS.length])
    }
  }
  // ==== THE BUILT COUNTRY (2026-11-12, the user after playing it: "all the outside part of the map is huge and nothing
  // placed on it — we need buildings, broken places, like Genshin … make it CONGESTED, not a big plain place"): the
  // Wardens LIVED here. So, before the monuments take their ground:
  //   RUINED TOWNS    ~1 a km of road country: a street (or a cross of two) of roofless stone houses — walls with
  //                   windows and doorways, some two storeys, some under half a roof, some fallen in — a square with a
  //                   well, an obelisk or a statue, lanterns down the street, stretches of a town wall and a gate where
  //                   the street leaves; the bigger ones a tower or a small temple. 12–40 houses each.
  //   FARMSTEADS      between them, every ~380 m: a house or three inside a yard of low dry-stone walls, a well.
  //   FORTS           on the gentle hilltops: a square curtain wall, a round tower at each corner, a gate, a keep.
  //   FIELD WALLS     low dry-stone walls along the roads' verges in runs — the road is a LANE between them.
  // All of the kit's pieces (three new: a wall with a window, with a doorway, broken off), one instanced draw a kind.
  const rdLines = map.meta.outland?.trails?.lines ?? [], rhw = map.roadHW
  const rdHash = new Map<number, [number, number][]>()
  for (const Ln of rdLines) for (const q of Ln) { const k = Math.floor(q[0] / 128) * 4096 + Math.floor(q[1] / 128); const l = rdHash.get(k); if (l) l.push(q); else rdHash.set(k, [q]) }
  const roadPt = (x: number, z: number, r: number): [number, number] | null => {
    const ci = Math.floor(x / 128), cj = Math.floor(z / 128), m = Math.ceil(r / 128)
    let best: [number, number] | null = null, bd = r * r
    for (let i = ci - m; i <= ci + m; i++) for (let j = cj - m; j <= cj + m; j++) for (const q of rdHash.get(i * 4096 + j) ?? []) { const d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; best = q } }
    return best
  }
  /** CREEPERS on a wall (round 3, the look): on each face, by chance, a drape hanging from the top — its own width and
   *  drop; a seed of the wall's own (nothing else moves). (x, y, z) the wall's foot, `top` its top's share of sy. */
  const creep = (x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, chance: number, top = 1) => {
    if (!LOOK) return
    let s = cellSeed(Math.round(x * 4), Math.round(z * 4), 401)
    const r = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const L = at(x, z, rot)
    for (const side of [1, -1]) {
      for (let k = 0; k < (sx > 5 ? 2 : 1); k++) {
        if (r() > chance) continue
        const w = Math.min(sx * 0.8, 1.2 + r() * 2.4), lx = (r() - 0.5) * Math.max(0, sx - w), drop = sy * top * (0.35 + r() * 0.55)
        const [cx, cz] = L(lx, side * (sz / 2 + 0.02))
        plan.pieces.push({ k: 'creeper', x: cx, y: y + sy * top - drop, z: cz, rot: side > 0 ? rot : rot + Math.PI, sx: w, sy: drop, sz: 1, far: 2 })
      }
    }
  }
  /** A wall panel's piece: seen as far as a thing 9 m big (a town reads from ~800 m, not 400). */
  const WP = (k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number) => {
    plan.pieces.push({ k, x, y, z, rot, sx, sy, sz, far: 9 })
    if (k === 'block' || k === 'wallbrk' || k === 'wallwin') creep(x, y, z, rot, sx, sy, sz, 0.45, k === 'wallbrk' ? 0.55 : 1)
    if (k === 'walldoor') { for (const sd of [-1, 1]) C(x + Math.cos(rot) * sd * sx * 0.36, y + sy / 2, z - Math.sin(rot) * sd * sx * 0.36, rot, sx * 0.14, sy / 2, sz / 2) }
    else C(x, y + sy * (k === 'wallbrk' ? 0.3 : 0.5), z, rot, sx / 2, sy * (k === 'wallbrk' ? 0.3 : 0.5), sz / 2)
  }
  /** A RUINED HOUSE: w × d, its front (the door) toward local +z of `a`; false if the ground won't take it. */
  const house = (x: number, z: number, a: number, w: number, d: number, rnd: () => number, tall = false): boolean => {
    const g = ground(x, z, Math.hypot(w, d) / 2 + 1, 2.6)
    if (!g) return false
    const L = at(x, z, a), y0 = g.lo - 0.5, h = 3.3 + rnd() * 1.1, T = 0.55, two = tall || rnd() < 0.42, ruin = rnd()
    // (the four sides: [the side's middle (local), its length, the way its panels face])
    for (const [mx, mz, len, ra, front] of [[0, d / 2, w, 0, 1], [0, -d / 2, w, Math.PI, 0], [w / 2, 0, d, Math.PI / 2, 0], [-w / 2, 0, d, -Math.PI / 2, 0]] as [number, number, number, number, number][]) {
      const n = Math.max(2, Math.round(len / 3.3)), pw = len / n
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5, lx = mx + (ra === 0 || ra === Math.PI ? t * len * (ra === 0 ? 1 : -1) : 0), lz = mz + (ra === 0 || ra === Math.PI ? 0 : t * len * (ra > 0 ? -1 : 1))
        const [px, pz] = L(lx, lz), r = rnd(), door = front && i === Math.floor(n / 2)
        const k: Kind | null = door ? 'walldoor' : r < 0.36 ? 'wallwin' : r < 0.62 ? 'block' : r < 0.86 + ruin * 0.1 ? 'wallbrk' : null
        if (k) WP(k, px, y0, pz, a + ra, pw + 0.04, h + (g.hi - g.lo) * 0.5, T)
        else P('block', px + (rnd() - 0.5) * 2, H(px, pz) - 0.4, pz + (rnd() - 0.5) * 2, rnd() * 6.28, 1.4 + rnd(), 0.8 + rnd() * 0.6, 1 + rnd(), (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5)
        // the upper storey: more of it gone
        if (two && k && rnd() < 0.62) WP(rnd() < 0.45 ? 'wallwin' : rnd() < 0.5 ? 'wallbrk' : 'block', px, y0 + h + (g.hi - g.lo) * 0.5, pz, a + ra, pw + 0.04, h * 0.86, T)
      }
    }
    // half a roof on some; a fallen beam's worth of rubble in the others
    if (ruin < 0.26) { const [rx, rz] = L(0, -d * 0.22); P('roof', rx, y0 + (two ? h * 1.86 : h) + (g.hi - g.lo) * 0.5, rz, a, w + 0.7, w * 0.36, d * 0.56) }
    for (let q = 0; q < 2; q++) { const [bx, bz] = L((rnd() - 0.5) * (w - 2), (rnd() - 0.5) * (d - 2)); P('block', bx, H(bx, bz) - 0.3, bz, rnd() * 6.28, 1 + rnd() * 1.2, 0.6 + rnd() * 0.5, 0.8 + rnd(), (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.4) }
    plan.keep.push([x, z, Math.hypot(w, d) / 2 + 1.5])
    return true
  }
  /** A stretch of low dry-stone wall from (ax, az) to (bx, bz): 6 m pieces, a gap now and then, lower where it's fallen. */
  const lowWall = (ax: number, az: number, bx: number, bz: number, rnd: () => number, hgt = 1.15) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 6)), rot = Math.atan2(bx - ax, bz - az) + Math.PI / 2
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.16 || (LOOK && ((i * 7 + Math.round(ax)) % 5 === 2 || (i * 3 + Math.round(az)) % 7 === 4))) continue   // (the look: gaps more often — an old wall, half gone)
      const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = H(x, z)
      if (map.roadEdge(x, z) < 1.2 || map.lakeShore(x, z, y, 0.6) || rocks.onCrag(x, z, 1) || slopeAt(x, z, 3) > 0.55) continue
      // (… nor a piece with an END on a road: a verge's wall ran across the mouth of the road that joins there)
      { const hx = ((bx - ax) / len) * (len / n) * 0.5, hz = ((bz - az) / len) * (len / n) * 0.5; let on = false; for (let q = -1; q <= 1 && !on; q += 0.5) on = map.roadEdge(x + hx * q, z + hz * q) < 1; if (on || map.mudAt(x, z) > 0.15) continue }   // (… nor in a mire's mud)
      // (the look: laid dry stone, broken — two variants, by turns; mossed, a creeper over it now and then)
      const wl = len / n + 0.3, wh = (hgt + 0.35) * (rnd() < 0.2 ? 0.55 : 0.9 + rnd() * 0.25)
      PC(LOOK ? ((Math.round(x * 0.37) + Math.round(z * 0.53)) % 2 ? 'drywall' : 'drywall2') : 'block', x, y - 0.35, z, rot, wl, wh, 0.75, 0, (rnd() - 0.5) * 0.05)
      creep(x, y - 0.35, z, rot, wl, wh, 0.75, 0.3, 0.8)
    }
  }
  const well = (x: number, z: number, rnd: () => number) => {
    const y = H(x, z)
    PC('stump', x, y - 0.3, z, 0, 2.6, 1.3, 2.6)
    for (const sd of [-1, 1]) PC('column', x + sd * 1.5, y - 0.2, z, 0, 0.3, 2.9, 0.3)
    P('block', x, y + 2.6, z, rnd() * 0.3, 3.6, 0.28, 0.4)
  }
  // ---- THE TOWNS: gentle ground 30–260 m from a road, ~750 m apart
  const townWords = ['Old', 'Lower', 'Upper', 'Lost', 'Grey', 'Far', 'High', 'Broken']
  let nTown = 0
  for (const c of byScore((c) => (c.sl < 0.15 && c.y < 520 && roadPt(c.x, c.z, 260) ? 30 - c.sl * 80 + c.rnd() * 20 : 0))) {
    kindNow = 'town'
    if (near(c.x, c.z, 750, 'town') || busy(c.x, c.z)) continue
    const rp = roadPt(c.x, c.z, 260)!
    if (Math.hypot(rp[0] - c.x, rp[1] - c.z) < 34 || !ground(c.x, c.z, 30, 9)) continue
    const big = c.rnd() < 0.4, R = big ? 78 + c.rnd() * 26 : 46 + c.rnd() * 22
    // (its street points at the road it stands by; a cross street in the bigger ones)
    const a = Math.atan2(rp[0] - c.x, rp[1] - c.z), L = at(c.x, c.z, a)
    let built = 0
    // (two rows a side: the houses on the street, and a back row behind them across a lane — a town is CROWDED)
    for (const [axis, len] of big ? [[0, R], [1, R * 0.72]] : [[0, R]]) for (const side of [-1, 1]) for (const row of [0, 1]) {
      for (let sd = -len * (row ? 0.8 : 1); sd < len * (row ? 0.8 : 1); ) {
        const w = 6 + c.rnd() * 5, d = 5 + c.rnd() * 3.6, mid = sd + w / 2, off = side * (5.2 + d / 2 + c.rnd() * 1.6 + row * 13.5)
        sd += w + 1 + c.rnd() * (c.rnd() < (row ? 0.4 : 0.15) ? 9 : 2.2)
        if (Math.abs(mid) < (row ? 30 : 15)) continue                             // (the square; the cross street's own rows)
        const [hx, hz] = axis ? L(mid, off) : L(off, mid)
        // (a house's front faces its street)
        const ha = a + (axis ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2)
        if (axis && Math.abs(off) < 0 ) continue
        if (near(hx, hz, 4.5 + Math.max(w, d) * 0.5)) continue
        kindNow = 'house'
        if (house(hx, hz, ha, w, d, c.rnd, c.rnd() < 0.08)) { built++; take(hx, hz, Math.max(w, d) * 0.5) }
        kindNow = 'town'
      }
    }
    if (built < 6) continue
    nTown++
    // the streets' flags and lanterns
    for (const [axis, len] of big ? [[0, R], [1, R * 0.72]] : [[0, R]]) for (let sd = -len, k = 0; sd < len; sd += 2.7, k++) {
      const [px, pz] = axis ? L(sd, (c.rnd() - 0.5) * 1.6) : L((c.rnd() - 0.5) * 1.6, sd)
      if (map.roadEdge(px, pz) < 1 || slopeAt(px, pz, 2) > 0.5) continue
      if (c.rnd() < 0.8) P('block', px, H(px, pz) - 0.13, pz, a + (axis ? 1.571 : 0) + (c.rnd() - 0.5) * 0.4, 1.5 + c.rnd() * 0.7, 0.3, 1.2 + c.rnd() * 0.6, (c.rnd() - 0.5) * 0.07, (c.rnd() - 0.5) * 0.07)
      if (k % 7 === 3) { const [qx, qz] = axis ? L(sd, 3.4 * (k % 14 === 3 ? 1 : -1)) : L(3.4 * (k % 14 === 3 ? 1 : -1), sd); PC('lantern', qx, H(qx, qz) - 0.1, qz, a, 1.4, 1.75, 1.4) }
    }
    // the square: a well, an obelisk or a Warden
    const sq = c.rnd()
    if (sq < 0.4) well(c.x, c.z, c.rnd)
    else if (sq < 0.7) PC('obelisk', c.x, H(c.x, c.z) - 0.4, c.z, c.rnd() * 6.28, 1.4, 11 + c.rnd() * 5, 1.4)
    else { PC('block', c.x, H(c.x, c.z) - 0.4, c.z, a, 3, 1.6, 3); P(c.rnd() < 0.6 ? 'statue' : 'kneel', c.x, H(c.x, c.z) + 1.2, c.z, a, 5.5, 5.5, 5.5) }
    // the town's wall: stretches of it round the edge, a gate where the street goes out toward the road
    const RW = (big ? R : R * 0.9) + 9, nW = Math.round((6.28 * RW) / 9)
    for (let k = 0; k < nW; k++) {
      const an = (k / nW) * 6.28, lx = Math.sin(an) * RW, lz = Math.cos(an) * RW, [px, pz] = L(lx, lz)
      if (Math.abs(lx) < 7 && lz > 0) continue                                    // (the gate's gap)
      if (c.rnd() < 0.42 || map.roadEdge(px, pz) < 6 || slopeAt(px, pz, 4) > 0.45 || map.lakeShore(px, pz, H(px, pz), 0.6) || rocks.onCrag(px, pz, 1)) continue
      WP(c.rnd() < 0.55 ? 'block' : 'wallbrk', px, H(px, pz) - 0.6, pz, a + an + Math.PI / 2 + Math.PI / 2, 9.4, 3.4 + c.rnd() * 1.6, 1.1)
    }
    { const [gx, gz] = L(0, RW); if (map.roadEdge(gx, gz) > 6 && slopeAt(gx, gz, 4) < 0.4) { P('arch', gx, H(gx, gz) - 0.5, gz, a, 9, 8, 2.2); for (const sd of [-1, 1]) { const q = L(sd * 3.6, RW); C(q[0], H(gx, gz) + 2.5, q[1], a, 0.9, 3, 1.1) } } }
    // the bigger ones: a tower at one end, or a small temple
    if (big) {
      const [tx, tz] = L((c.rnd() < 0.5 ? -1 : 1) * (R * 0.72 + 9), -8), tg = ground(tx, tz, 7, 5)
      if (tg) { const Hh = 13 + c.rnd() * 9; PC('tower', tx, tg.lo - 1, tz, c.rnd() * 6.28, 9, Hh, 9); take(tx, tz, 7) }
    }
    const nm = word(c.rnd, (w) => (c.rnd() < 0.5 ? `${townWords[Math.floor(c.rnd() * townWords.length)]} ${w}` : `Ruins of ${w}`))
    site(nm, 'town', c.x, c.z, Math.min(40, R * 0.45), undefined, a)
    writing(...L(3.5, 3.5), nm)
    // (the look: the town's fallen stone, its burned roofs — round the square, along the wall)
    strew(L, dressRnd(c.x, c.z, 2), big ? 16 : 10, 6, RW + 4, big ? 3 : 2)
  }
  // ---- THE FORTS: gentle hilltops, ~2.2 km apart, a dozen at most
  let nFort = 0
  for (const c of byScore((c) => (c.prom > 14 && c.sl < 0.2 && c.y < 620 ? c.prom + c.rnd() * 10 : 0))) {
    kindNow = 'fort'
    if (nFort >= 12) break
    if (near(c.x, c.z, 2200, 'fort') || busy(c.x, c.z)) continue
    const S = 21 + c.rnd() * 6, g = ground(c.x, c.z, S * 1.35, 8.5)
    if (!g) continue
    nFort++
    const a = c.rnd() * 6.28, L = at(c.x, c.z, a), wh = 6.5 + c.rnd() * 2
    for (const [mx, mz, ra] of [[0, S, 0], [0, -S, Math.PI], [S, 0, Math.PI / 2], [-S, 0, -Math.PI / 2]] as [number, number, number][]) {
      const n = Math.round((2 * S) / 7.4), pw = (2 * S) / n
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5, lx = mx + (mz !== 0 ? t * 2 * S : 0), lz = mz + (mx !== 0 ? t * 2 * S : 0), [px, pz] = L(lx, lz)
        if (mz > 0 && Math.abs(lx) < 4.5) { P('arch', px, H(px, pz) - 0.6, pz, a, pw + 1.2, wh + 1.2, 2.4); for (const sd of [-1, 1]) { const q = L(lx + sd * pw * 0.42, lz); C(q[0], H(px, pz) + wh / 2, q[1], a, pw * 0.1, wh / 2, 1.2) } continue }
        const r = c.rnd()
        if (r < 0.1) continue
        WP(r < 0.36 ? 'wallbrk' : 'block', px, H(px, pz) - 0.8, pz, a + ra, pw + 0.1, (r < 0.36 ? wh * 0.75 : wh) + 0.8, 1.6)
      }
    }
    for (const [lx, lz] of [[S, S], [-S, S], [S, -S], [-S, -S]]) { const [px, pz] = L(lx, lz); PC('tower', px, H(px, pz) - 1.2, pz, c.rnd() * 6.28, 7.4, wh + 3.5 + c.rnd() * 5, 7.4) }
    kindNow = 'house'
    house(...L(0, -S * 0.35), a, 13, 10, c.rnd, true)
    house(...L(-S * 0.52, S * 0.3), a + Math.PI / 2, 8, 6, c.rnd)
    kindNow = 'fort'
    well(...L(S * 0.4, S * 0.25), c.rnd)
    const nm = word(c.rnd, (w) => `Fort ${w}`)
    site(nm, 'fort', c.x, c.z, S * 1.2, ['Over the gate', 'Held for as long as there was anyone to hold it for.'], a)
    writing(...L(3, S + 4), nm)
    // THE LOOK'S DRESSING (2026-11-13, the user's painted fort): rubble heaped along the inside of the walls and fallen
    // out past them, the houses burned (charred timbers in them, a brick heap), a CAMP inside the gate — its fire
    // burning, crates and barrels by it — and timber WATCHTOWERS in two corners
    {
      const r = dressRnd(c.x, c.z, 1)
      for (let k = 0; k < 10; k++) {
        const side = Math.floor(r() * 4), t = (r() - 0.5) * 1.7 * S, inn = S - 2.4 - r() * 2.6
        const [lx, lz] = side === 0 ? [t, inn] : side === 1 ? [t, -inn] : side === 2 ? [inn, t] : [-inn, t]
        if (side === 0 && Math.abs(lx) < 6) continue   // (the gate's way in kept clear)
        D(r() < 0.72 ? 'rubble' : 'bricks', ...L(lx, lz), r() * 6.28, 0.8 + r() * 0.6)
      }
      strew(L, r, 7, S + 3, S + 9, 0)
      D('timber', ...L(0, -S * 0.35), a + r(), 1.15); D('timber', ...L(-S * 0.52, S * 0.3), a + r() * 3, 0.9)
      D('bricks', ...L(S * 0.14, -S * 0.12), r() * 6.28, 1.1)
      const [fx, fz] = L(-S * 0.08, S * 0.56), fr = a + Math.PI
      if (D('camp', fx, fz, fr, 1, 0.04, 0.22)) {
        F(fx - 0.8 * Math.cos(fr), fz + 0.8 * Math.sin(fr), 11, 8, fr)   // (the camp's ground trodden bare: no tall grass over its tent and fire)
        plan.fires.push({ id: -1, kind: 'camp', name: '', x: fx, z: fz, y: H(fx, fz) - 0.04, rot: fr, r: 0, fire: [FIRE_LOCAL.x, FIRE_LOCAL.z], lights: [[FIRE_LOCAL.x - 3.6, 1.72, FIRE_LOCAL.z + 0.4]], smoke: [FIRE_LOCAL.x, 0.6, FIRE_LOCAL.z] } as Landmark)
        // (its stores: crates stacked, barrels — beside the tent, in the camp's own frame)
        const CL = at(fx, fz, fr)
        D('crate', ...CL(-5.6, -2.4), fr + 0.1); D('crate', ...CL(-5.5, -1.5), fr - 0.2, 0.9); D('crate', ...CL(-6.4, -1.9), fr + 0.4, 1.05)
        D('barrel', ...CL(-4.6, -3.0), r() * 6.28); D('barrel', ...CL(-4.0, -3.3), r() * 6.28); D('barrel', ...CL(3.6, -2.6), r() * 6.28)
      }
      for (const sd of [1, -1]) { const [wx, wz] = L(sd * (S - 5.6), sd * (S - 5.6)); D('watch', wx, wz, a + (r() - 0.5) * 0.3, 1, 0.25, 0.25) }
    }
  }
  // ---- THE FARMSTEADS: every ~380 m of the gentle land that has nothing — a house or three in a walled yard
  for (let gz = -ho + 190; gz < ho; gz += 380) for (let gx = -ho + 190; gx < ho; gx += 380) {
    if (Math.abs(gx) < hb + 120 && Math.abs(gz) < hb + 120) continue
    let s = cellSeed(gx, gz, 151)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    for (let t = 0; t < 8; t++) {
      const x = gx + (rnd() - 0.5) * 300, z = gz + (rnd() - 0.5) * 300
      kindNow = 'farm'
      if (H(x, z) > 560 || slopeAt(x, z, 8) > 0.2 || near(x, z, 90) || !ground(x, z, 20, 5)) continue
      const a = rnd() * 6.28, L = at(x, z, a), yw = 15 + rnd() * 9, yd = 12 + rnd() * 8
      kindNow = 'house'
      let nb = 0
      if (house(...L(-yw * 0.35, -yd * 0.3), a, 6.5 + rnd() * 3, 5 + rnd() * 2, rnd)) nb++
      if (rnd() < 0.55 && house(...L(yw * 0.38, yd * 0.1), a - Math.PI / 2, 5.5 + rnd() * 2.5, 4.6 + rnd() * 1.6, rnd)) nb++
      if (rnd() < 0.25 && house(...L(-yw * 0.2, yd * 0.5), a + Math.PI, 5 + rnd() * 2, 4.4 + rnd(), rnd)) nb++
      kindNow = 'farm'
      if (!nb) continue
      const cr: [number, number][] = [[-yw, -yd], [yw, -yd], [yw, yd], [-yw, yd]]
      for (let k = 0; k < 4; k++) { const p0 = L(...cr[k]), p1 = L(...cr[(k + 1) % 4]); if (k === 2) { const m0 = L(cr[2][0] * 0.25, yd), m1 = L(cr[3][0] * 0.25, yd); lowWall(p0[0], p0[1], m0[0], m0[1], rnd); lowWall(m1[0], m1[1], p1[0], p1[1], rnd) } else lowWall(p0[0], p0[1], p1[0], p1[1], rnd) }
      if (rnd() < 0.5) well(...L(yw * 0.1, -yd * 0.1), rnd)
      take(x, z, Math.max(yw, yd))
      break
    }
  }
  // ---- THE FIELD WALLS along the roads: runs of 50–180 m on one verge or both, a gap of as much between
  {
    let run = 0, gap = 0, both = false, sideNow = 1
    for (const Ln of rdLines) for (let k = 1; k + 1 < Ln.length; k++) {
      const [x, z] = Ln[k], [x0, z0] = Ln[k - 1], [x1, z1] = Ln[k + 1], seg = Math.hypot(x1 - x, z1 - z)
      if (run <= 0 && gap <= 0) {
        let s = cellSeed(Math.round(x), Math.round(z), 153)
        const r1 = ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296), r2 = ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
        run = 50 + r1 * 130; gap = 40 + r2 * 150; both = r1 > 0.45; sideNow = r2 < 0.5 ? -1 : 1
      }
      if (run > 0) {
        run -= seg
        // (not at a road's ends: where it meets another, their verges' walls crossed the junction)
        if (k < 6 || k > Ln.length - 7 || !inLand(x, z, 10) || H(x, z) > 600) continue
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l
        let s = cellSeed(Math.round(x), Math.round(z), 155)
        const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
        for (const sd of both ? [-1, 1] : [sideNow]) {
          const o = rhw + 3.4, ax = x + nx * o * sd, az = z + nz * o * sd, bx = x1 + nx * o * sd, bz = z1 + nz * o * sd
          if (near(ax, az, 3) || keepOff.some(([kx, kz, kr]) => (ax - kx) ** 2 + (az - kz) ** 2 < kr * kr)) continue
          lowWall(ax, az, bx, bz, rnd, 1.05)
        }
      } else gap -= seg
    }
  }
  // ---- THE BEACON TOWERS: on the crests (the most prominent, gentle enough to stand on), ~1.4 km apart
  for (const c of byScore((c) => (c.prom > 22 && c.sl < 0.5 ? c.prom : 0))) {
    kindNow = 'tower'
    if (near(c.x, c.z, region(c.x, c.z) === 0 ? 800 : 1250, 'tower') || busy(c.x, c.z)) continue
    const R = 5 + c.rnd() * 3, g = ground(c.x, c.z, R + 3, 7)
    if (!g) continue
    const Hh = 16 + c.rnd() * 16, foot = g.lo - 1.5
    c.rnd()   // (was: lit or not, at random — the stream kept, so no tower moved)
    PC('tower', c.x, foot, c.z, c.rnd() * 6.28, R * 2, Hh + 1.5, R * 2)
    // EVERY beacon has its crystal (2026-11-12, round 2 — "light the chain"): ASLEEP until the player reaches the tower
    // (Wardens.light, from the landmarks' found set), burning for good after; seen as far as its tower
    plan.pieces.push({ k: 'crystal', x: c.x, y: foot + Hh + 1.2, z: c.z, rot: 0, sx: 3.4, sy: 6.6, sz: 3.4, site: idAt(c.x, c.z), far: Hh + 6 })
    P('block', c.x, foot + Hh + 0.6, c.z, 0.4, 3, 0.8, 3)
    for (let k = 0; k < 7; k++) { const a = c.rnd() * 6.28, d = R + 2 + c.rnd() * 9, s = 0.8 + c.rnd() * 1.6; const px = c.x + Math.cos(a) * d, pz = c.z + Math.sin(a) * d; P('block', px, H(px, pz) - s * 0.3, pz, c.rnd() * 6.28, s * 1.3, s, s, (c.rnd() - 0.5) * 0.4, (c.rnd() - 0.5) * 0.4) }
    const nm = word(c.rnd, (w) => `${w} Beacon`)
    site(nm, 'tower', c.x, c.z, R + 6, ['The beacon\'s plaque', 'One of the seven-times-seven beacons. Its crystal sleeps until someone stands under it — then it burns, and the next tower along the ridge can see it.'])
    writing(c.x + R + 4, c.z, nm)
  }
  // ---- THE GIANTS: on open ground seen from far (prominent or wide floors), ~2 km apart
  const giantKinds = ['sword', 'kneel', 'head', 'fallen', 'sword', 'twin']
  let gk = 0
  for (const c of byScore((c) => (c.sl < 0.3 ? 30 + c.prom * 0.6 + c.rnd() * 20 : 0))) {
    kindNow = 'giant'
    if (near(c.x, c.z, 1500, 'giant') || busy(c.x, c.z)) continue
    const kind = giantKinds[gk % giantKinds.length], R = kind === 'twin' ? 34 : 22
    const g = ground(c.x, c.z, R, kind === 'fallen' ? 12 : kind === 'head' ? 9 : 7)
    if (!g) continue
    gk++
    const a = c.rnd() * 6.28, L = at(c.x, c.z, a), foot = g.lo - 1
    if (kind === 'sword' || kind === 'kneel') {
      const S = kind === 'sword' ? 34 + c.rnd() * 14 : 26 + c.rnd() * 8
      PC('block', c.x, foot, c.z, a, 16, 4 + (g.hi - g.lo), 16)                    // the plinth (ground: drive up onto it… if you can)
      F(...L(0, 2.5), 16, 21, a)
      PC('stair', ...up(L(0, 10.5), foot), a, 8, 4 + (g.hi - g.lo) * 0.5, 5)
      PC(kind === 'sword' ? 'statue' : 'kneel', c.x, foot + 4 + (g.hi - g.lo), c.z, a, S, S, S)
      const nm = kind === 'sword' ? word(c.rnd, (w) => `The Sword-Bearer of ${w}`) : word(c.rnd, (w) => `The Kneeling Warden of ${w}`)
      site(nm, 'giant', c.x, c.z, 16, ['On the plinth', kind === 'sword' ? 'He rests his hands on the blade because the fight is over. Do not wake him to start another.' : 'She holds the sun up for us. Be grateful, and go round.'], a)
      for (const s of [-1, 1]) PC('lantern', ...up(L(s * 6, 14), H(...L(s * 6, 14)) - 0.1), a, 2.2, 2.6, 2.2)
    } else if (kind === 'head') {
      const S = 14 + c.rnd() * 8
      P('head', c.x, H(c.x, c.z) - S * 0.07, c.z, a, S, S, S, 0, (0.45 + c.rnd() * 0.35) * (c.rnd() < 0.5 ? -1 : 1))   // on its cheek, sunk a little (its face clear of the grass)
      C(c.x, H(c.x, c.z) + S * 0.25, c.z, a, S * 0.42, S * 0.3, S * 0.45, true)
      for (let k = 0; k < 6; k++) { const q = L((c.rnd() - 0.5) * S * 2.4, (c.rnd() - 0.5) * S * 2.4); P('block', q[0], H(...q) - 0.6, q[1], c.rnd() * 6.28, 2 + c.rnd() * 3, 1.5 + c.rnd() * 2, 2 + c.rnd() * 2, (c.rnd() - 0.5) * 0.5) }
      site(word(c.rnd, (w) => `The Fallen Head of ${w}`), 'giant', c.x, c.z, S * 0.8, ['Near the giants', 'The giants were not made. They were found asleep in the hills, and we only uncovered their faces.'], a)
    } else if (kind === 'fallen') {
      // a toppled Warden in three pieces lying in the grass, its sword beside it
      const S = 30 + c.rnd() * 10
      PC('statue', ...up(L(-S * 0.1, 0), foot + S * 0.12), a + 1.571, S * 0.9, S * 0.55, S * 0.9, 1.571, 0, true)
      P('head', ...up(L(S * 0.45, 4), foot - S * 0.05), a, S * 0.2, S * 0.2, S * 0.2, 0.2, 1.2)
      site(word(c.rnd, (w) => `The Fallen Warden of ${w}`), 'giant', c.x, c.z, S * 0.45, ['On a fallen column', 'Built in a summer, fell in a winter, still here in the spring. Not bad, for a column.'], a)
    } else {
      // THE TWIN GUARDIANS: two Sword-Bearers facing each other across a gap
      const S = 26 + c.rnd() * 8
      for (const s of [-1, 1]) {
        const [px, pz] = L(s * 22, 0), fy = H(px, pz) - 1
        PC('block', px, fy, pz, a, 10, 4, 10)
        F(px, pz, 10, 10, a)
        PC('statue', px, fy + 4, pz, a + (s > 0 ? -1.571 : 1.571), S, S, S)
      }
      site(word(c.rnd, (w) => `The Twin Guardians of ${w}`), 'giant', c.x, c.z, 30, ['Between them', 'Count the towers from the gate: one for each Warden who walked into the Grey and came back.'], a)
    }
  }
  // ---- THE TEMPLES: on benches (flat, a little raised), ~900 m apart
  for (const c of byScore((c) => (c.sl < 0.16 ? 20 + c.prom * 0.3 + c.rnd() * 25 : 0))) {
    kindNow = 'temple'
    if (near(c.x, c.z, 850, 'temple') || busy(c.x, c.z)) continue
    const W = 12 + c.rnd() * 6, D = W * (1.4 + c.rnd() * 0.3), R = Math.hypot(W, D) / 2 + 4
    const g = ground(c.x, c.z, R, 3.5)
    if (!g) continue
    const a = c.rnd() * 6.28, L = at(c.x, c.z, a), top = g.hi + 0.9, base = g.lo - 1
    PC('block', c.x, base, c.z, a, W, top - base, D)                                   // the platform (ground)
    F(...L(0, 2.2), W, D + 4.4, a)                                                     // (… with its steps)
    PC('stair', ...up(L(0, D / 2 + 2), base), a, W * 0.5, top - base, 4)                    // the steps up, at its front
    const nC = 4 + Math.floor(c.rnd() * 3), roofed = c.rnd() < 0.45
    for (const s of [-1, 1]) for (let k = 0; k < nC; k++) {
      const lz = -D / 2 + 1.6 + (k / (nC - 1)) * (D - 3.2), [px, pz] = L(s * (W / 2 - 1.5), lz), r = c.rnd()
      if (r < 0.62 || roofed) { PC('column', px, top, pz, 0, 1.4, 8, 1.4); P('capital', px, top + 8, pz, 0, 1.4, 1.1, 1.4) }
      else if (r < 0.85) PC('stump', px, top, pz, 0, 1.4, 2 + c.rnd() * 4, 1.4)
      else { const [fx, fz] = L(s * (W / 2 + 4 + c.rnd() * 3), lz + (c.rnd() - 0.5) * 4); PC('column', fx, H(fx, fz) + 0.5, fz, a + (c.rnd() - 0.5) * 0.6, 1.4, 7, 1.4, 1.571, 0) }
    }
    if (roofed) {
      for (const s of [-1, 1]) for (let k = 0; k < nC - 1; k++) { const lz = -D / 2 + 1.6 + ((k + 0.5) / (nC - 1)) * (D - 3.2), [px, pz] = L(s * (W / 2 - 1.5), lz); P('block', px, top + 9.1, pz, a, 1.6, 0.9, (D - 3.2) / (nC - 1) + 0.2) }
      P('roof', c.x, top + 10, c.z, a, W, 3.4, D - 1)
    }
    PC('statue', ...up(L(0, -D / 2 + 3.5), top), a, 4.2, 4.2, 4.2)
    PC('block', ...up(L(0, -D / 2 + 3.5), top - 0.2), a, 2, 0.8, 2)
    for (const s of [-1, 1]) PC('lantern', ...up(L(s * (W * 0.25 + 1), D / 2 + 5), H(...L(s * (W * 0.25 + 1), D / 2 + 5)) - 0.1), a, 1.6, 1.9, 1.6)
    const nm = word(c.rnd, (w) => `Temple of the ${w}`)
    site(nm, 'temple', c.x, c.z, R)
    writing(...L(W * 0.3 + 3, D / 2 + 6), nm)
  }
  // ---- THE RINGS of standing stones: open gentle ground, ~700 m apart
  for (const c of byScore((c) => (c.sl < 0.22 ? 10 + c.rnd() * 30 : 0))) {
    kindNow = 'ring'
    if (near(c.x, c.z, 700, 'ring') || busy(c.x, c.z)) continue
    const R = 8 + c.rnd() * 6, g = ground(c.x, c.z, R + 2, 4)
    if (!g) continue
    const n = 9 + Math.floor(c.rnd() * 5), a0 = c.rnd() * 6.28, lintels = c.rnd() < 0.4
    const tall: [number, number, number][] = []
    for (let k = 0; k < n; k++) {
      if (c.rnd() < 0.12) continue
      const a = a0 + (k / n) * 6.28, px = c.x + Math.cos(a) * R, pz = c.z + Math.sin(a) * R, h = 3.2 + c.rnd() * 2.4
      PC('stone', px, H(px, pz) - 0.6, pz, -a + 1.571, 2 + c.rnd() * 0.8, h + 0.6, 2.2, (c.rnd() - 0.5) * 0.1, (c.rnd() - 0.5) * 0.12)
      tall.push([px, pz, h])
    }
    if (lintels) for (let k = 0; k + 1 < tall.length; k += 2) {
      const [ax, az, ah] = tall[k], [bx, bz, bh] = tall[k + 1]
      if (Math.hypot(bx - ax, bz - az) > 8) continue
      P('block', (ax + bx) / 2, H((ax + bx) / 2, (az + bz) / 2) - 0.6 + Math.min(ah, bh) + 0.5, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), Math.hypot(bx - ax, bz - az) + 1.6, 0.9, 1.4)
    }
    PC('block', c.x, H(c.x, c.z) - 0.4, c.z, a0, 2.6, 1.3, 1.6)                       // the altar
    const nm = word(c.rnd, (w) => `The ${w} Stones`)
    site(nm, 'ring', c.x, c.z, R + 2)
    writing(c.x + 1.8, c.z + 1.8, nm)
  }
  // ---- THE COLONNADES and the STATUE GARDENS and the OBELISKS: between the rest, ~650 m apart
  let mix = 0
  for (const c of byScore((c) => (c.sl < 0.2 ? 5 + c.rnd() * 30 : 0))) {
    kindNow = 'mix'
    if (near(c.x, c.z, 620, 'mix') || busy(c.x, c.z)) continue
    // (its kind: in turn — but the Tree's country grows GARDENS, the Scribes' raises NEEDLES)
    const rg = region(c.x, c.z), kind = rg === 1 && mix % 3 !== 1 && c.rnd() < 0.7 ? 1 : rg === 2 && mix % 3 !== 2 && c.rnd() < 0.6 ? 2 : mix % 3
    const R = kind === 0 ? 30 : kind === 1 ? 14 : 16
    const g = ground(c.x, c.z, R, kind === 0 ? 6 : 3.5)
    if (!g) continue
    mix++
    const a = c.rnd() * 6.28, L = at(c.x, c.z, a)
    if (kind === 0) {
      const n = 8 + Math.floor(c.rnd() * 5)
      for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
        const [px, pz] = L(s * 4.5, -R + (k / (n - 1)) * R * 2), r = c.rnd(), y = H(px, pz) - 0.3
        if (r < 0.55) { PC('column', px, y, pz, 0, 1.1, 6.5, 1.1); P('capital', px, y + 6.5, pz, 0, 1.1, 0.9, 1.1) }
        else if (r < 0.85) PC('stump', px, y, pz, 0, 1.1, 1.5 + c.rnd() * 3.5, 1.1)
        else { const fy = H(px, pz); PC('column', px + 3 * s, fy + 0.45, pz, a + (c.rnd() - 0.5), 1.1, 6, 1.1, 1.571, 0) }
      }
      for (let k = 0; k < Math.floor(R / 2.4); k++) { const [px, pz] = L((c.rnd() - 0.5) * 2, -R + k * 4.8 + c.rnd()); P('block', px, H(px, pz) - 0.08, pz, a + (c.rnd() - 0.5) * 0.3, 2.2, 0.26, 1.8) }
      const nm = word(c.rnd, (w) => `The ${w} Walk`)
      site(nm, 'colonnade', c.x, c.z, R)
      writing(...L(7, 0), nm)
    } else if (kind === 1) {
      // a STATUE GARDEN: a low wall round a square, Wardens on plinths, lanterns
      const S = 11
      for (let k = -2; k <= 2; k++) for (const [lx, lz, rr] of [[k * 4.4, -S, 0], [k * 4.4, S, 0], [-S, k * 4.4, 1.571], [S, k * 4.4, 1.571]] as [number, number, number][]) {
        if (lz === S && k === 0) continue   // (its gate)
        const [px, pz] = L(lx, lz)
        if (c.rnd() < 0.18) continue
        PC('block', px, H(px, pz) - 0.5, pz, a + rr, 4.4, 1.1 + c.rnd() * 0.6, 0.8)
      }
      for (const [lx, lz] of [[-6, -6], [6, -6], [-6, 4], [6, 4], [0, -8]]) {
        if (c.rnd() < 0.2) continue
        const [px, pz] = L(lx, lz), y = H(px, pz)
        PC('block', px, y - 0.4, pz, a, 1.8, 1.4, 1.8)
        P(c.rnd() < 0.7 ? 'statue' : 'kneel', px, y + 1, pz, a + Math.atan2(-lx, -lz), 3.2, 3.2, 3.2)
      }
      for (const s of [-1, 1]) PC('lantern', ...up(L(s * 2.4, S + 1.5), H(...L(s * 2.4, S + 1.5)) - 0.1), a, 1.5, 1.8, 1.5)
      const nm = word(c.rnd, (w) => `Garden of the ${w}`)
      site(nm, 'garden', c.x, c.z, 14)
      writing(...L(0, S + 3), nm)
    } else {
      const n = 4 + Math.floor(c.rnd() * 4)
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * 6.28 + c.rnd() * 0.5, d = k === 0 ? 0 : 6 + c.rnd() * 8, [px, pz] = L(Math.cos(ang) * d, Math.sin(ang) * d)
        const h = k === 0 ? 18 + c.rnd() * 6 : 7 + c.rnd() * 9, w = h / 8
        PC('obelisk', px, H(px, pz) - 0.4, pz, c.rnd() * 6.28, w, h, w, c.rnd() < 0.2 ? 0.12 : 0, 0)
      }
      const nm = word(c.rnd, (w) => `The Needles of ${w}`)
      site(nm, 'obelisks', c.x, c.z, 15)
      writing(c.x + 3, c.z + 3, nm)
    }
  }
  // ---- THE GATES over the roads: every ~1.6 km along each outland road, square across it
  const roads = map.meta.outland?.trails?.lines ?? []
  const hw = map.roadHW
  let along = 0
  for (const line of roads) {
    for (let k = 1; k + 1 < line.length; k++) {
      const [x0, z0] = line[k - 1], [x1, z1] = line[k + 1], [x, z] = line[k]
      along += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1])
      kindNow = 'gate'
      if (along < 1600 || !inLand(x, z, 20) || busy(x, z)) continue
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz)
      if (l < 1) continue
      const tx = dx / l, tz = dz / l, span = 2 * hw + 7, Hh = span * 0.95
      // (straight here, and the ground across it level enough for its two piers)
      const ya = H(x - tz * span * 0.45, z + tx * span * 0.45), yb = H(x + tz * span * 0.45, z - tx * span * 0.45)
      if (Math.abs(ya - yb) > 2.5 || keepOff.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < kr * kr)) continue
      along = 0
      const rot = Math.atan2(tx, tz) + Math.PI / 2, foot = Math.min(ya, yb, H(x, z)) - 0.6
      P('arch', x, foot, z, rot, span, Hh + 0.6, 3)
      for (const s of [-1, 1]) {
        const px = x - tz * s * span * 0.4, pz = z + tx * s * span * 0.4
        C(px, foot + Hh * 0.35, pz, rot, span * 0.1, Hh * 0.35, 1.5)
        const qx = x - tz * s * (span * 0.5 + 2) + tx * 3, qz = z + tx * s * (span * 0.5 + 2) + tz * 3
        PC('lantern', qx, H(qx, qz) - 0.1, qz, rot, 1.6, 2, 1.6)
      }
      plan.keep.push([x, z, span * 0.6])
      take(x, z, 20)
      writing(x - tz * (span * 0.5 + 3) - tx * 3, z + tx * (span * 0.5 + 3) - tz * 3, 'A Warden gate')
    }
  }
  // ---- THE SHRINES and the WRITINGS by the roads: every ~450 m of road, a small thing at its verge
  along = 0
  for (const line of roads) {
    for (let k = 1; k + 1 < line.length; k++) {
      const [x, z] = line[k], [x0, z0] = line[k - 1], [x1, z1] = line[k + 1]
      along += Math.hypot(x - x0, z - z0)
      const rg = region(x, z)
      if (along < (rg === 2 || rg === 1 ? 260 : 450) || !inLand(x, z, 12)) continue
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz)
      if (l < 1) continue
      let s = cellSeed(Math.round(x), Math.round(z), 133)
      const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
      const side = rnd() < 0.5 ? -1 : 1, off = hw + 6 + rnd() * 4, px = x - (dz / l) * off * side, pz = z + (dx / l) * off * side
      kindNow = 'shrine'
      if (!ground(px, pz, 3.5, 2.5) || near(px, pz, 60)) continue
      along = 0
      const face = Math.atan2(-(px - x), -(pz - z)), r0 = rnd(), y = H(px, pz)
      // (the Scribes' country: a written stone nearly every time; the Tree's: lanterns)
      const r = rg === 2 ? 0.4 + r0 * 0.4 : rg === 1 ? (r0 < 0.3 ? r0 : 0.76 + r0 * 0.2) : r0
      if (r < 0.4) {
        // a SHRINE: a plinth, a small Warden under a dome on four posts, two lanterns
        PC('block', px, y - 0.4, pz, face, 3.2, 0.7, 3.2)
        F(px, pz, 3.2, 3.2, face)
        for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) { const [qx, qz] = at(px, pz, face)(lx, lz); PC('column', qx, y + 0.3, qz, 0, 0.35, 2.6, 0.35) }
        P('block', px, y + 2.9, pz, face, 3, 0.35, 3); P('dome', px, y + 3.25, pz, face, 2.6, 2, 2.6)
        P('statue', px, y + 0.3, pz, face, 1.7, 1.7, 1.7)
        for (const t of [-1, 1]) { const [qx, qz] = at(px, pz, face)(t * 2.4, 2.2); PC('lantern', qx, H(qx, qz) - 0.1, qz, face, 1.1, 1.3, 1.1) }
      } else if (r < 0.75) {
        PC('stone', px, y - 0.4, pz, face, 1.6, 2.6, 1.8, 0, (rnd() - 0.5) * 0.1)
        writing(px, pz, 'A Warden stone')
      } else {
        PC('lantern', px, y - 0.1, pz, face, 1.4, 1.7, 1.4)
        for (let q = 0; q < 3; q++) { const qx = px + (rnd() - 0.5) * 6, qz = pz + (rnd() - 0.5) * 6; PC('stump', qx, H(qx, qz) - 0.2, qz, 0, 0.9, 0.6 + rnd() * 1.4, 0.9) }
      }
      take(px, pz, 4)
    }
  }
  // ---- COVERAGE: every 500 m of the land within ~650 m of a site — a small ruin where it isn't (a broken wall and a
  // stump or two, a standing stone, a lone Warden on her plinth)
  for (let gz = -ho + 250; gz < ho; gz += 500) for (let gx = -ho + 250; gx < ho; gx += 500) {
    if (Math.abs(gx) < hb + 200 && Math.abs(gz) < hb + 200) continue
    kindNow = 'fill'
    if (near(gx, gz, 650)) continue
    let s = cellSeed(gx, gz, 137)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    for (let t = 0; t < 14; t++) {
      const x = gx + (rnd() - 0.5) * 420, z = gz + (rnd() - 0.5) * 420
      const g = ground(x, z, 7, 3)
      if (!g) continue
      const a = rnd() * 6.28, L = at(x, z, a), r = rnd()
      if (r < 0.4) {
        for (let k = 0; k < 4; k++) { const [px, pz] = L(-6 + k * 4, 0); if (rnd() < 0.8) PC('block', px, H(px, pz) - 0.4, pz, a, 4, 0.8 + rnd() * 2, 0.9) }
        for (let k = 0; k < 2; k++) { const [px, pz] = L((rnd() - 0.5) * 10, 3 + rnd() * 3); PC('stump', px, H(px, pz) - 0.2, pz, 0, 1, 1 + rnd() * 3, 1) }
        site(word(rnd, (w) => `Ruin of ${w}`), 'ruin', x, z, 8)
      } else if (r < 0.7) {
        PC('block', x, g.lo - 0.4, z, a, 2, 1.4, 2)
        PC(rnd() < 0.6 ? 'statue' : 'kneel', x, g.lo + 1, z, a, 4, 4, 4)
        site(word(rnd, (w) => `Warden of the ${w}`), 'statue', x, z, 6)
      } else {
        PC('stone', x, H(x, z) - 0.5, z, a, 2.2, 3.4, 2.2)
        for (let k = 0; k < 3; k++) { const [px, pz] = L((rnd() - 0.5) * 8, (rnd() - 0.5) * 8); P('block', px, H(px, pz) - 0.3, pz, rnd() * 6.28, 1 + rnd(), 0.7, 0.8 + rnd(), (rnd() - 0.5) * 0.4) }
        take(x, z, 6)
      }
      writing(x + 3, z + 3, 'A Warden stone')
      break
    }
  }
  // ---- THE PATHS: from each named site within 260 m of a road, flagstones to the road's verge, a lantern now and then
  const roadPts: [number, number][] = []
  for (const line of roads) for (const p of line) if (inLand(p[0], p[1], 0)) roadPts.push(p)
  const rh = new Map<number, [number, number][]>()
  for (const p of roadPts) { const k = Math.floor(p[0] / 100) * 4096 + Math.floor(p[1] / 100); const l = rh.get(k); if (l) l.push(p); else rh.set(k, [p]) }
  for (const l of plan.sites) {
    if (SECRET.has(l.style ?? '')) continue   // (no path gives a secret away)
    let best: [number, number] | null = null, bd = 260
    const ci = Math.floor(l.x / 100), cj = Math.floor(l.z / 100)
    for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) for (const p of rh.get(i * 4096 + j) ?? []) { const d = Math.hypot(p[0] - l.x, p[1] - l.z); if (d < bd) { bd = d; best = p } }
    if (!best || bd < l.r + 14) continue
    const ux = (best[0] - l.x) / bd, uz = (best[1] - l.z) / bd
    let s = cellSeed(Math.round(l.x), Math.round(l.z), 139)
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const side = rnd() < 0.5 ? -1 : 1
    for (let d = l.r + 2, k = 0; d < bd; d += 2.5 + rnd() * 0.5, k++) {
      // (a gentle wander: the path bends a little, never straight as a rule)
      const w = Math.sin(d / 37 + l.x * 0.01) * Math.min(6, (d - l.r) * 0.15, (bd - d) * 0.15)
      const px = l.x + ux * d - uz * w, pz = l.z + uz * d + ux * w
      if (map.roadEdge(px, pz) < 1.5) break
      if (map.lakeShore(px, pz, H(px, pz), 0.3) || rocks.onCrag(px, pz, 0.5)) continue
      if (slopeAt(px, pz, 2) > 0.5) continue
      if (rnd() < 0.88) P('block', px, H(px, pz) - 0.12, pz, Math.atan2(ux, uz) + (rnd() - 0.5) * 0.5, 1.3 + rnd() * 0.6, 0.3, 1.1 + rnd() * 0.5, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08)
      if (k % 14 === 7) { const qx = px - uz * 2.2 * side, qz = pz + ux * 2.2 * side; PC('lantern', qx, H(qx, qz) - 0.1, qz, 0, 1.2, 1.5, 1.2) }
    }
  }
  // (?wkit=<size>: THE KIT ON PARADE — every piece `size` m tall in a row by the first temple, facing ?wkitrot (rad), for
  //  the harness to look each over: scripts/harness/wardens.mjs "x=@<x>:<z>,…"; the row's start is logged)
  const kitS = Number(gameParams().get('wkit') ?? 0)
  if (kitS > 0) {
    const t = plan.sites.find((l) => l.style === 'temple') ?? plan.sites[0], rot = Number(gameParams().get('wkitrot') ?? 0)
    KINDS.forEach((k, i) => { const x = t.x + 60 + i * kitS * 1.6, z = t.z; P(k, x, Math.max(H(x, z), H(x - kitS / 2, z), H(x + kitS / 2, z)) + 0.2, z, rot, kitS, kitS, kitS, Number(gameParams().get('wkittx') ?? 0), Number(gameParams().get('wkittz') ?? 0)) })
    console.log(`wkit: ${KINDS.map((k, i) => `${k} @${(t.x + 60 + i * kitS * 1.6).toFixed(0)}:${t.z.toFixed(0)}`).join('  ')}`)
  }
  // EVERY PIECE ON THE GROUND (2026-11-13, round 4 — the roads' audit, scripts/harness/audit.mjs: ~1 000 pieces had a
  // corner over half a metre in the air — a wall, a column, a low wall along a road set at its middle's ground on a
  // slope): a piece that stands on the ground (not tilted, its foot within 2.5 m of the ground, not in a lake) is let
  // down to the lowest ground under its footprint less a hand; a wall, a block, a column or a tower GROWS by as much
  // (its top where it was); the dressing just sinks. Its collider is left: it reaches the ground already. ?wsettle=0: off.
  if (LOOK && gameParams().get('wsettle') !== '0') {
    const GROW = new Set(['block', 'wallwin', 'walldoor', 'wallbrk', 'tower', 'column', 'stump', 'drywall', 'drywall2', 'obelisk', 'arch', 'stone'])
    const SINK = new Set(['rubble', 'bricks', 'timber', 'crate', 'barrel', 'lantern', 'watch'])
    for (const q of plan.pieces) {
      if ((!GROW.has(q.k) && !SINK.has(q.k)) || Math.abs(q.tx ?? 0) > 0.3 || Math.abs(q.tz ?? 0) > 0.3) continue
      const g = H(q.x, q.z)
      if (q.y - g > 2.5 || q.y - g < -6 || map.lakeShore(q.x, q.z, g, 0.3)) continue
      const round = q.k === 'tower' || q.k === 'column' || q.k === 'stump'
      const hx = round ? q.sx * 0.45 : q.k === 'watch' ? 1.45 : q.sx / 2, hz = round ? q.sz * 0.45 : q.k === 'watch' ? 1.45 : q.sz / 2
      const c = Math.cos(q.rot), s = Math.sin(q.rot)
      let lo = 1e9
      for (const a of [-1, 0, 1]) for (const d of [-1, 0, 1]) lo = Math.min(lo, H(q.x + (a * hx * c + d * hz * s), q.z + (-a * hx * s + d * hz * c)))
      const drop = q.y - (lo - 0.12)
      if (drop <= 0.05) continue
      q.y -= drop
      if (GROW.has(q.k)) q.sy += drop
    }
  }
  return plan
}

// ------------------------------------------------------------------------------------------------------------ drawing
const CELL = 256

export class Wardens {
  readonly group = new GFX.Group()
  horizon: Horizon | null = null
  private readonly meshes: GFX.InstancedMesh[] = []
  private readonly mats: Float32Array
  private readonly size: Float32Array
  private readonly kindOf: Uint8Array
  private readonly cells = new Map<number, { idx: number[]; y0: number; y1: number; big: number }>()
  private readonly reachK: number
  private readonly lastPos = new GFX.Vector3(Number.NaN, 0, 0)
  private readonly lastDir = new GFX.Vector3()
  private readonly dir = new GFX.Vector3()
  private readonly frustum = new GFX.Frustum()
  private readonly pv = new GFX.Matrix4()
  private readonly cellBox = new GFX.Box3()
  /** (the beacons) each crystal's site (−1: not one), the sites lit, the two crystal kinds' meshes */
  private readonly siteOf: Int32Array
  private readonly lit = new Set<number>()
  private readonly allLit = gameParams().get('beacons') === 'lit'
  private readonly kCrystal = KINDS.indexOf('crystal')
  private readonly kDark = KINDS.indexOf('crystalDark')
  /** THE SEALED VAULTS: each one's pieces and boxes (the plan's), open or not, its door falling (seconds in; −1: still) */
  private readonly vaults: (Vault & { open: boolean; t: number })[]
  private readonly pieces: Piece[]
  private readonly mapId: string
  /** A vault's boxes changed (World: the physics re-streams the props'). */
  onColliders: (() => void) | null = null
  private readonly texts: WardenText[]
  private readonly textHash = new Map<number, WardenText[]>()

  constructor(plan: WardenPlan, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4) {
    const P = plan.pieces
    this.pieces = P
    this.mapId = plan.mapId
    this.vaults = plan.vaults.map((v) => ({ ...v, open: false, t: -1 }))
    this.texts = plan.texts
    for (const t of plan.texts) { const k = this.key(Math.floor(t.x / 64), Math.floor(t.z / 64)); const l = this.textHash.get(k); if (l) l.push(t); else this.textHash.set(k, [t]) }
    this.reachK = (tier.rockReach / 900) * (tier.weakGpu ? 0.7 : 1)   // (a weak GPU — the phones: nearer)
    const mat = woodMaterial(atmos, shadow, tier, farGrid)
    if (gameParams().get('wregions') !== '0') plan.regions.forEach(([x, z, r], k) => { if (r > 0) (mat.uniforms[`uRegion${k}`].value as GFX.Vector4).set(x, z, r, 1) })   // (?wregions=0: one stone everywhere — the A/B)
    KINDS.forEach((k, ki) => {
      const n = P.filter((p) => p.k === (k === 'crystalDark' ? 'crystal' : k)).length
      const b = new Builder(0x3a7d + ki * 977)
      KIT[k].build(b)
      const mesh = new GFX.InstancedMesh(b.geometry(), mat, Math.max(1, n))
      mesh.count = 0; mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
      this.meshes.push(mesh)
      this.group.add(mesh)
    })
    this.mats = new Float32Array(P.length * 16)
    this.size = new Float32Array(P.length)
    this.kindOf = new Uint8Array(P.length)
    this.siteOf = new Int32Array(P.length).fill(-1)
    P.forEach((p, i) => {
      this.place(i)
      this.size[i] = p.far ?? Math.max(p.sx, p.sy, p.sz)
      // (the DRESSING thinned on the weaker tiers — the user: "in PC good details, in phones reduce it": ULTRA / HIGH all of
      //  it, MEDIUM ~60 %, LOW and the phones ~35 %; a dropped piece is never drawn (size 0: under the small-feature cut))
      if (DETAIL.has(p.k) && ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) >= detailKeep(tier)) this.size[i] = 0
      if (p.site !== undefined) this.siteOf[i] = p.site
      this.kindOf[i] = KINDS.indexOf(p.k)
      const k = this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))
      let c = this.cells.get(k)
      if (!c) this.cells.set(k, (c = { idx: [], y0: Infinity, y1: -Infinity, big: 0 }))
      c.idx.push(i)
      c.big = Math.max(c.big, this.size[i])
      c.y0 = Math.min(c.y0, p.y - 2)
      c.y1 = Math.max(c.y1, p.y + Math.max(p.sy, p.sx) + 2)
    })
  }

  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096) }

  private readonly m4 = new GFX.Matrix4()
  private readonly q4 = new GFX.Quaternion()
  private readonly e4 = new GFX.Euler()
  /** Piece i's matrix from its plan entry (as built; a vault's door as it falls). */
  private place(i: number): void {
    const p = this.pieces[i]
    this.q4.setFromEuler(this.e4.set(p.tx ?? 0, p.rot, p.tz ?? 0, 'YXZ'))
    this.m4.compose(V(p.x, p.y, p.z), this.q4, V(p.sx, p.sy, p.sz)).toArray(this.mats, i * 16)
  }

  // ------------------------------------------------------------------------------------------------ the sealed vaults
  /** The vaults opened so far on this map (localStorage `oth.wvaults.<map>`: their sites' ids) — fallen at once. */
  restoreVaults(): void {
    let ids: number[] = []
    try { ids = JSON.parse(localStorage.getItem(`oth.wvaults.${this.mapId}`) ?? '[]') as number[] } catch { /* (nothing kept) */ }
    for (const v of this.vaults) if (ids.includes(v.site)) this.openVault(v.site, true)
  }
  /** What the WINCH can take (Winch.extra): each sealed vault's keystone — its ring, the vault's site. */
  keystones(): { x: number; y: number; z: number; site: number; name: string }[] {
    return this.vaults.filter((v) => !v.open).map((v) => ({ x: v.ax, y: v.ay, z: v.az, site: v.site, name: v.name }))
  }
  get vaultCount(): [number, number] { return [this.vaults.filter((v) => v.open).length, this.vaults.length] }
  /** THE KEYSTONE OUT: the vault's door falls flat in front of it (1.1 s; `instant`: already down — a vault opened
   *  before). Its standing box goes, the fallen slab's comes (ground: drive in over it). False: no such vault, or open. */
  openVault(site: number, instant = false): boolean {
    const v = this.vaults.find((q) => q.site === site)
    if (!v || v.open) return false
    v.open = true
    v.t = instant ? 1e9 : 0
    v.standing.off = true
    this.pieces[v.key].y -= 1e4   // (the keystone: gone — on the winch's hook)
    this.place(v.key)
    if (instant) { this.pieces[v.door].tx = v.fallTx; this.pieces[v.door].y -= v.sink; this.place(v.door); v.fallen.off = false; v.t = -1 }
    else try { localStorage.setItem(`oth.wvaults.${this.mapId}`, JSON.stringify(this.vaults.filter((q) => q.open).map((q) => q.site))) } catch { /* (not kept) */ }
    this.onColliders?.()
    this.lastPos.x = Number.NaN
    return true
  }
  /** A door falling: its tilt eased (a slab going over: slow, then fast, a small bounce). */
  private fall(dt: number): void {
    for (const v of this.vaults) {
      if (v.t < 0) continue
      v.t += dt
      const k = Math.min(1, v.t / 1.1), e = k * k * k, bounce = k >= 1 ? 0 : Math.max(0, Math.sin((k - 0.86) * 22)) * 0.04 * (k > 0.86 ? 1 : 0)
      const p = this.pieces[v.door], was = p.tx ?? 0
      p.tx = v.fallTx * Math.min(1, e / 0.64) - bounce
      p.y -= v.sink * (Math.min(1, p.tx / v.fallTx) - Math.min(1, was / v.fallTx))
      this.place(v.door)
      this.lastPos.x = Number.NaN
      if (k >= 1) { v.t = -1; p.y -= v.sink * (1 - Math.min(1, p.tx / v.fallTx)); p.tx = v.fallTx; this.place(v.door); v.fallen.off = false; this.onColliders?.() }
    }
  }

  /** The writing within 9 m of (x, z) — stopped by it, the game shows it (main.ts). */
  textNear(x: number, z: number): WardenText | null {
    const ci = Math.floor(x / 64), cj = Math.floor(z / 64)
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const t of this.textHash.get(this.key(i, j)) ?? []) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 81) return t
    return null
  }
  get textCount(): number { return this.texts.length }

  /** THE BEACONS: these sites' crystals burn from now on (World: the landmarks found so far; main.ts: one just found). */
  light(sites: Iterable<number>): void {
    for (const id of sites) this.lit.add(id)
    this.lastPos.x = Number.NaN   // (re-picked at the next update)
  }
  /** How many beacons burn, of how many. */
  beacons(): [number, number] {
    let n = 0, lit = 0
    for (let i = 0; i < this.siteOf.length; i++) if (this.siteOf[i] >= 0) { n++; if (this.allLit || this.lit.has(this.siteOf[i])) lit++ }
    return [lit, n]
  }

  /** Re-pick what's drawn when the camera has moved 8 m or turned. */
  update(camera: GFX.PerspectiveCamera, dt = 0): void {
    if (dt > 0) this.fall(dt)
    camera.getWorldDirection(this.dir)
    if (camera.position.distanceToSquared(this.lastPos) < 64 && this.dir.dot(this.lastDir) > 0.9985) return
    this.lastPos.copy(camera.position); this.lastDir.copy(this.dir)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    const cx = camera.position.x, cz = camera.position.z, R = 3000 * this.reachK
    const pxPerRad = (innerHeight * Math.min(devicePixelRatio, 2)) / (2 * Math.tan((camera.fov * Math.PI) / 360)), minRatio = 2.5 / pxPerRad
    for (const mesh of this.meshes) mesh.count = 0
    const i0 = Math.floor((cx - R) / CELL), i1 = Math.floor((cx + R) / CELL), j0 = Math.floor((cz - R) / CELL), j1 = Math.floor((cz + R) / CELL)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.cells.get(this.key(i, j))
      if (!c) continue
      const x0 = i * CELL, z0 = j * CELL
      const nx = Math.max(x0 - cx, 0, cx - x0 - CELL), nz = Math.max(z0 - cz, 0, cz - z0 - CELL)
      if (nx * nx + nz * nz > R * R) continue
      // (a cell of small things — a town's houses: past the reach of its BIGGEST piece nothing in it is drawn — not walked)
      { const cr = (120 + c.big * 75) * this.reachK; if (nx * nx + nz * nz > cr * cr) continue }
      this.cellBox.min.set(x0 - 30, c.y0, z0 - 30)
      this.cellBox.max.set(x0 + CELL + 30, c.y1, z0 + CELL + 30)
      if (!this.frustum.intersectsBox(this.cellBox)) continue
      if (this.horizon?.hiddenBox(this.cellBox)) continue
      for (const k of c.idx) {
        const o = k * 16, dx = this.mats[o + 12] - cx, dz = this.mats[o + 14] - cz, d2 = dx * dx + dz * dz, s = this.size[k]
        // (each piece's reach grows with its size: a slab ~160 m, a lantern ~250, a column ~600, a tower or a giant 2.6 km+)
        const reach = Math.min(R, (120 + s * 75) * this.reachK)
        if (d2 > reach * reach || s * s < minRatio * minRatio * d2) continue
        let ki = this.kindOf[k]
        if (ki === this.kCrystal && this.siteOf[k] >= 0 && !this.allLit && !this.lit.has(this.siteOf[k])) ki = this.kDark   // (a crystal of no beacon — a court's, a vault's — always burns)
        const mesh = this.meshes[ki]
        const A = mesh.instanceMatrix.array as Float32Array, t = mesh.count * 16
        A.set(this.mats.subarray(o, o + 16), t)
        // (a BURNING crystal never looks smaller than it does from 380 m: a spark on its ridge from two kilometres —
        //  grown about its foot as the camera backs away, so it's the same few pixels of light)
        if (ki === this.kCrystal && d2 > 380 * 380) { const g = Math.sqrt(d2) / 380; for (let e = 0; e < 11; e++) if (e % 4 !== 3) A[t + e] *= g }
        mesh.count++
      }
    }
    for (const mesh of this.meshes) {
      // (an empty kind not drawn at all: an instanced draw of none still costs its submission — ~10 µs each)
      mesh.visible = mesh.count > 0
      const im = mesh.instanceMatrix
      im.clearUpdateRanges()
      if (mesh.count) im.addUpdateRange(0, mesh.count * 16)
      im.needsUpdate = mesh.count > 0
    }
  }
}
