import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Builder, SURF, woodMaterial } from './Bridges'
import type { Horizon } from './Horizon'
import type { Landmark, MapData } from './MapData'
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
const KINDS = ['block', 'column', 'stump', 'arch', 'statue', 'kneel', 'head', 'lantern', 'obelisk', 'stone', 'tower', 'stair', 'roof', 'crystal', 'capital', 'dome'] as const
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

/** Each piece, unit sized (on the ground at y 0, facing +z), and what it collides as (local box: centre y, half sizes —
 *  null: drive through / over it). */
const KIT: Record<Kind, { build: (b: Builder) => void; col: [number, number, number, number] | null; ground?: boolean }> = {
  // a dressed block (walls, platforms, plinths, lintels, the paths' slabs): ±0.5, y 0 … 1
  block: { build: (b) => { b.setSurf(SURF.stone); box(b, 0, 0.5, 0, 0.5, 0.5, 0.5, STONE) }, col: [0.5, 0.5, 0.5, 0.5], ground: true },
  // a column's shaft: 12 sides, fluted (the sides in two tones), tapering a little — ⌀ 1, y 0 … 1
  column: { build: (b) => { b.setSurf(SURF.stone); prism(b, 12, 0.5, 0.44, 0, 1, (i) => shade(STONE, i % 2 ? 0.9 : 1.04)) }, col: [0.5, 0.4, 0.5, 0.4] },
  // a broken shaft: its top a jagged break
  stump: { build: (b) => { b.setSurf(SURF.stone); const tops = [1, 0.8, 0.92, 0.66, 0.74, 0.97, 0.85, 0.6, 0.7, 0.9, 0.78, 0.95]; prism(b, 12, 0.5, 0.46, 0, 1, (i) => shade(STONE, i % 2 ? 0.9 : 1.04), tops) }, col: [0.4, 0.4, 0.4, 0.4] },
  // an ARCH (a gate, a colonnade's span): ±0.5 across, y 0 … 1, ±0.5 deep — its opening 0.6 wide, to 0.86 high
  arch: {
    build: (b) => {
      b.setSurf(SURF.stone)
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
  // A KNEELING WARDEN, holding a stone sun up over its head — unit tall
  kneel: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE
      box(b, 0, 0.09, -0.04, 0.17, 0.09, 0.2, c)                                         // the folded legs
      box(b, 0.08, 0.2, 0.12, 0.06, 0.2, 0.06, shade(c, 0.94))                           // the raised knee
      prism(b, 8, 0.13, 0.15, 0.16, 0.55, (i) => shade(c, i % 2 ? 0.93 : 1.02))           // the body
      ball(b, V(0, 0.62, 0), 0.06, 0.07, 0.065, 4, 8, c)                                  // the head
      box(b, 0, 0.52, 0, 0.17, 0.03, 0.08, shade(c, 1.04))                               // the shoulders
      for (const s of [-1, 1]) { b.log(V(s * 0.16, 0.52, 0), V(s * 0.2, 0.7, 0.02), 0.034, c); b.log(V(s * 0.2, 0.7, 0.02), V(s * 0.12, 0.86, 0.02), 0.03, c) } // the arms, up to the sun
      ball(b, V(0, 0.89, 0.02), 0.12, 0.11, 0.12, 5, 10, shade(c, 1.08))                  // the stone sun
      prism(b, 12, 0.135, 0.135, 0.875, 0.905, () => shade(c, 0.85), undefined, false)  // its band
    },
    col: [0.35, 0.2, 0.35, 0.25],
  },
  // A GIANT'S HEAD (fallen — lying on its cheek or sunk to the chin): unit, its face toward +z
  head: {
    build: (b) => {
      b.setSurf(SURF.stone)
      const c = STATUE
      ball(b, V(0, 0.5, 0), 0.4, 0.5, 0.42, 6, 12, c)
      box(b, 0, 0.66, 0.36, 0.3, 0.05, 0.07, shade(c, 1.04))                              // the brow
      hexa(b, [V(-0.06, 0.4, 0.38), V(0.06, 0.4, 0.38), V(0.04, 0.4, 0.5), V(-0.04, 0.4, 0.5), V(-0.03, 0.62, 0.4), V(0.03, 0.62, 0.4), V(0.02, 0.62, 0.43), V(-0.02, 0.62, 0.43)], shade(c, 1.03)) // the nose
      for (const s of [-1, 1]) box(b, s * 0.15, 0.56, 0.37, 0.07, 0.035, 0.03, CARVE)      // the eyes (shut)
      box(b, 0, 0.29, 0.37, 0.1, 0.012, 0.03, CARVE)                                      // the mouth
      prism(b, 12, 0.43, 0.4, 0.78, 0.88, () => shade(c, 0.9))                            // the circlet
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
      b.setSurf(SURF.stone)
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
  // a COLUMN's CAPITAL: a slab over a narrower one (⌀ 1 column → 1.3 wide)
  capital: { build: (b) => { b.setSurf(SURF.stone); box(b, 0, 0.3, 0, 0.42, 0.3, 0.42, STONE_D); box(b, 0, 0.8, 0, 0.65, 0.2, 0.65, STONE) }, col: null },
  // a DOME (a shrine's): a half ball, ⌀ 1, y 0 … 0.5
  dome: { build: (b) => { b.setSurf(SURF.stone); ball(b, V(0, 0, 0), 0.5, 0.5, 0.5, 3, 12, STONE); }, col: null },
}

// ------------------------------------------------------------------------------------------------------------ the plan
/** A piece placed: kind, where (its foot), turned rot (about y), tilted (about its own x, then z), scaled. */
export interface Piece { k: Kind; x: number; y: number; z: number; rot: number; sx: number; sy: number; sz: number; tx?: number; tz?: number }
export interface WardenText { id: number; x: number; z: number; place: string; title: string; text: string }
export interface WardenPlan { sites: Landmark[]; pieces: Piece[]; cols: PropCollider[]; keep: [number, number, number][]; texts: WardenText[] }

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
]

/** Names (our own words), each kind its own pattern. */
const WORDS = ['Ash', 'Ember', 'Hollow', 'Long Dawn', 'Quiet Hours', 'Last Light', 'Salt', 'Thorn', 'Seven Winds', 'Lanterns', 'Sleeping Sun', 'Wren', 'Heath', 'Cinder', 'Gale', 'Amber', 'Willow', 'Briar', 'Harrow', 'Linden', 'First Frost', 'Open Hand', 'Low Moon', 'Kestrel', 'Bracken', 'Morrow', 'Still Water', 'High Grass', 'Old Roots', 'Grey Rain', 'Far Bells', 'Dusk', 'Nine Wells', 'Red Leaf', 'Moth', 'Barley', 'Tallow', 'Swallow', 'Fernhollow', 'Sedge', 'Rowan', 'Hearth', 'Sorrel', 'Tinder', 'Larkspur', 'Oriel', 'Wicken', 'Hazel', 'Sparrow', 'Lantern Hill', 'Cold Spring', 'Owl', 'Mallow', 'Gorse', 'Yarrow', 'Cloudberry', 'Elder', 'Starling', 'Long Shadow']

/** THE PLAN — seeded, made once a map (cached): where every site, piece, collider and writing goes. */
export function planWardens(map: MapData, rocks: Rocks): WardenPlan {
  const hit = PLANS.get(map)
  if (hit) return hit
  const plan: WardenPlan = { sites: [], pieces: [], cols: [], keep: [], texts: [] }
  PLANS.set(map, plan)
  if (map.desert || map.play <= map.half + 100 || gameParams().get('wardens') === '0') return plan
  const hb = map.half + 90, ho = map.play - 130
  const H = (x: number, z: number) => map.height(x, z)
  const slopeAt = (x: number, z: number, d = 5) => Math.hypot(H(x + d, z) - H(x - d, z), H(x, z + d) - H(x, z - d)) / (2 * d)
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
  let sid = 900000, tid = 0
  const P = (k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, tx = 0, tz = 0) => plan.pieces.push({ k, x, y, z, rot, sx, sy, sz, tx, tz })
  /** A collider box (world centre, half sizes, turned rot; ground: the wheels climb it). */
  const C = (x: number, y: number, z: number, rot: number, hx: number, hy: number, hz: number, ground = false) => plan.cols.push({ x, y, z, rot, hx, hy, hz, ...(ground ? { ground: true } : {}) })
  /** A piece with its KIT collider (scaled). */
  const PC = (k: Kind, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, tx = 0, tz = 0) => {
    P(k, x, y, z, rot, sx, sy, sz, tx, tz)
    const c = KIT[k].col
    if (c && !tx && !tz) C(x, y + c[0] * sy, z, rot, c[1] * sx, c[2] * sy, c[3] * sz, !!KIT[k].ground)
  }
  const site = (name: string, style: string, x: number, z: number, r: number, note?: [string, string]) => {
    const l: Landmark = { id: sid++, kind: 'warden', name, x, z, y: H(x, z), rot: 0, r, style, ...(note ? { note: { title: note[0], text: note[1] } } : {}) }
    plan.sites.push(l)
    plan.keep.push([x, z, r + 4])
    take(x, z, r)
    return l
  }
  let wi = 0
  const writing = (x: number, z: number, place: string) => { const [title, text] = WRITINGS[wi++ % WRITINGS.length]; plan.texts.push({ id: tid++, x, z, place, title, text }) }
  /** Local → world for a site at (x, z) turned a. */
  const at = (x: number, z: number, a: number) => (lx: number, lz: number): [number, number] => [x + lx * Math.cos(a) + lz * Math.sin(a), z - lx * Math.sin(a) + lz * Math.cos(a)]

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

  // ---- THE BEACON TOWERS: on the crests (the most prominent, gentle enough to stand on), ~1.4 km apart
  for (const c of byScore((c) => (c.prom > 22 && c.sl < 0.5 ? c.prom : 0))) {
    kindNow = 'tower'
    if (near(c.x, c.z, 1250, 'tower') || busy(c.x, c.z)) continue
    const R = 5 + c.rnd() * 3, g = ground(c.x, c.z, R + 3, 7)
    if (!g) continue
    const Hh = 16 + c.rnd() * 16, lit = c.rnd() < 0.7, foot = g.lo - 1.5
    PC('tower', c.x, foot, c.z, c.rnd() * 6.28, R * 2, Hh + 1.5, R * 2)
    if (lit) { P('crystal', c.x, foot + Hh + 1.2, c.z, 0, 2.4, 4.2, 2.4); P('block', c.x, foot + Hh + 0.6, c.z, 0.4, 3, 0.8, 3) }
    for (let k = 0; k < 7; k++) { const a = c.rnd() * 6.28, d = R + 2 + c.rnd() * 9, s = 0.8 + c.rnd() * 1.6; const px = c.x + Math.cos(a) * d, pz = c.z + Math.sin(a) * d; P('block', px, H(px, pz) - s * 0.3, pz, c.rnd() * 6.28, s * 1.3, s, s, (c.rnd() - 0.5) * 0.4, (c.rnd() - 0.5) * 0.4) }
    const nm = word(c.rnd, (w) => `${w} Beacon`)
    site(nm, 'tower', c.x, c.z, R + 6, lit ? ['The beacon\'s plaque', 'One of the seven-times-seven beacons. Its crystal still burns — someone has been keeping it clean.'] : undefined)
    writing(c.x + R + 4, c.z, nm)
  }
  // ---- THE GIANTS: on open ground seen from far (prominent or wide floors), ~2 km apart
  const giantKinds = ['sword', 'kneel', 'head', 'fallen', 'sword', 'twin']
  let gk = 0
  for (const c of byScore((c) => (c.sl < 0.3 ? 30 + c.prom * 0.6 + c.rnd() * 20 : 0))) {
    kindNow = 'giant'
    if (near(c.x, c.z, 1500, 'giant') || busy(c.x, c.z)) continue
    const kind = giantKinds[gk % giantKinds.length], R = kind === 'twin' ? 34 : 22
    const g = ground(c.x, c.z, R, kind === 'head' || kind === 'fallen' ? 12 : 7)
    if (!g) continue
    gk++
    const a = c.rnd() * 6.28, L = at(c.x, c.z, a), foot = g.lo - 1
    if (kind === 'sword' || kind === 'kneel') {
      const S = kind === 'sword' ? 34 + c.rnd() * 14 : 26 + c.rnd() * 8
      PC('block', c.x, foot, c.z, a, 16, 4 + (g.hi - g.lo), 16)                    // the plinth (ground: drive up onto it… if you can)
      PC('stair', ...L(0, 10.5), foot, a, 8, 4 + (g.hi - g.lo) * 0.5, 5)
      PC(kind === 'sword' ? 'statue' : 'kneel', c.x, foot + 4 + (g.hi - g.lo), c.z, a, S, S, S)
      const nm = kind === 'sword' ? word(c.rnd, (w) => `The Sword-Bearer of ${w}`) : word(c.rnd, (w) => `The Kneeling Warden of ${w}`)
      site(nm, 'giant', c.x, c.z, 16, ['On the plinth', kind === 'sword' ? 'He rests his hands on the blade because the fight is over. Do not wake him to start another.' : 'She holds the sun up for us. Be grateful, and go round.'])
      for (const s of [-1, 1]) PC('lantern', ...L(s * 6, 14), H(...L(s * 6, 14)) - 0.1, a, 2.2, 2.6, 2.2)
    } else if (kind === 'head') {
      const S = 14 + c.rnd() * 8
      P('head', c.x, foot - S * 0.25, c.z, a, S, S, S, 0, 0.5 + c.rnd() * 0.5)     // on its cheek, half sunk
      C(c.x, foot + S * 0.18, c.z, a, S * 0.42, S * 0.3, S * 0.45, true)
      for (let k = 0; k < 6; k++) { const q = L((c.rnd() - 0.5) * S * 2.4, (c.rnd() - 0.5) * S * 2.4); P('block', q[0], H(...q) - 0.6, q[1], c.rnd() * 6.28, 2 + c.rnd() * 3, 1.5 + c.rnd() * 2, 2 + c.rnd() * 2, (c.rnd() - 0.5) * 0.5) }
      site(word(c.rnd, (w) => `The Fallen Head of ${w}`), 'giant', c.x, c.z, S * 0.8, ['Near the giants', 'The giants were not made. They were found asleep in the hills, and we only uncovered their faces.'])
    } else if (kind === 'fallen') {
      // a toppled Warden in three pieces lying in the grass, its sword beside it
      const S = 30 + c.rnd() * 10
      P('statue', ...L(-S * 0.1, 0), foot + S * 0.12, a + 1.571, S * 0.9, S * 0.55, S * 0.9, 1.571, 0)
      const [bx, bz] = L(0, 0)
      C(bx, foot + S * 0.12, bz, a, S * 0.3, S * 0.13, S * 0.1, true)
      P('head', ...L(S * 0.45, 4), foot - S * 0.05, a, S * 0.2, S * 0.2, S * 0.2, 0.2, 1.2)
      site(word(c.rnd, (w) => `The Fallen Warden of ${w}`), 'giant', c.x, c.z, S * 0.45, ['On a fallen column', 'Built in a summer, fell in a winter, still here in the spring. Not bad, for a column.'])
    } else {
      // THE TWIN GUARDIANS: two Sword-Bearers facing each other across a gap
      const S = 26 + c.rnd() * 8
      for (const s of [-1, 1]) {
        const [px, pz] = L(s * 22, 0), fy = H(px, pz) - 1
        PC('block', px, fy, pz, a, 10, 4, 10)
        PC('statue', px, fy + 4, pz, a + (s > 0 ? -1.571 : 1.571), S, S, S)
      }
      site(word(c.rnd, (w) => `The Twin Guardians of ${w}`), 'giant', c.x, c.z, 30, ['Between them', 'Count the towers from the gate: one for each Warden who walked into the Grey and came back.'])
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
    PC('stair', ...L(0, D / 2 + 2), base, a, W * 0.5, top - base, 4)                    // the steps up, at its front
    const nC = 4 + Math.floor(c.rnd() * 3), roofed = c.rnd() < 0.45
    for (const s of [-1, 1]) for (let k = 0; k < nC; k++) {
      const lz = -D / 2 + 1.6 + (k / (nC - 1)) * (D - 3.2), [px, pz] = L(s * (W / 2 - 1.5), lz), r = c.rnd()
      if (r < 0.62 || roofed) { PC('column', px, top, pz, 0, 1.4, 8, 1.4); P('capital', px, top + 8, pz, 0, 1.4, 1.1, 1.4) }
      else if (r < 0.85) PC('stump', px, top, pz, 0, 1.4, 2 + c.rnd() * 4, 1.4)
      else { const [fx, fz] = L(s * (W / 2 + 4 + c.rnd() * 3), lz + (c.rnd() - 0.5) * 4); P('column', fx, H(fx, fz) + 0.5, fz, a + (c.rnd() - 0.5) * 0.6, 1.4, 7, 1.4, 1.571, 0); C(fx, H(fx, fz) + 0.7, fz, a, 0.75, 0.7, 3.5) }
    }
    if (roofed) {
      for (const s of [-1, 1]) for (let k = 0; k < nC - 1; k++) { const lz = -D / 2 + 1.6 + ((k + 0.5) / (nC - 1)) * (D - 3.2), [px, pz] = L(s * (W / 2 - 1.5), lz); P('block', px, top + 9.1, pz, a, 1.6, 0.9, (D - 3.2) / (nC - 1) + 0.2) }
      P('roof', c.x, top + 10, c.z, a, W, 3.4, D - 1)
    }
    PC('statue', ...L(0, -D / 2 + 3.5), top, a, 4.2, 4.2, 4.2)
    PC('block', ...L(0, -D / 2 + 3.5), top - 0.2, a, 2, 0.8, 2)
    for (const s of [-1, 1]) PC('lantern', ...L(s * (W * 0.25 + 1), D / 2 + 5), H(...L(s * (W * 0.25 + 1), D / 2 + 5)) - 0.1, a, 1.6, 1.9, 1.6)
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
    const kind = mix % 3
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
        else { const fy = H(px, pz); P('column', px + 3 * s, fy + 0.45, pz, a + (c.rnd() - 0.5), 1.1, 6, 1.1, 1.571, 0) }
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
      for (const s of [-1, 1]) PC('lantern', ...L(s * 2.4, S + 1.5), H(...L(s * 2.4, S + 1.5)) - 0.1, a, 1.5, 1.8, 1.5)
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
      if (along < 450 || !inLand(x, z, 12)) continue
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz)
      if (l < 1) continue
      let s = cellSeed(Math.round(x), Math.round(z), 133)
      const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
      const side = rnd() < 0.5 ? -1 : 1, off = hw + 6 + rnd() * 4, px = x - (dz / l) * off * side, pz = z + (dx / l) * off * side
      kindNow = 'shrine'
      if (!ground(px, pz, 3.5, 2.5) || near(px, pz, 60)) continue
      along = 0
      const face = Math.atan2(-(px - x), -(pz - z)), r = rnd(), y = H(px, pz)
      if (r < 0.4) {
        // a SHRINE: a plinth, a small Warden under a dome on four posts, two lanterns
        PC('block', px, y - 0.4, pz, face, 3.2, 0.7, 3.2)
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
  private readonly cells = new Map<number, { idx: number[]; y0: number; y1: number }>()
  private readonly reachK: number
  private readonly lastPos = new GFX.Vector3(Number.NaN, 0, 0)
  private readonly lastDir = new GFX.Vector3()
  private readonly dir = new GFX.Vector3()
  private readonly frustum = new GFX.Frustum()
  private readonly pv = new GFX.Matrix4()
  private readonly cellBox = new GFX.Box3()
  private readonly texts: WardenText[]
  private readonly textHash = new Map<number, WardenText[]>()

  constructor(plan: WardenPlan, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4) {
    const P = plan.pieces
    this.texts = plan.texts
    for (const t of plan.texts) { const k = this.key(Math.floor(t.x / 64), Math.floor(t.z / 64)); const l = this.textHash.get(k); if (l) l.push(t); else this.textHash.set(k, [t]) }
    this.reachK = (tier.rockReach / 900) * (tier.weakGpu ? 0.7 : 1)   // (a weak GPU — the phones: nearer)
    const mat = woodMaterial(atmos, shadow, tier, farGrid)
    KINDS.forEach((k, ki) => {
      const n = P.filter((p) => p.k === k).length
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
    const m = new GFX.Matrix4(), q = new GFX.Quaternion(), e = new GFX.Euler()
    P.forEach((p, i) => {
      q.setFromEuler(e.set(p.tx ?? 0, p.rot, p.tz ?? 0, 'YXZ'))
      m.compose(V(p.x, p.y, p.z), q, V(p.sx, p.sy, p.sz)).toArray(this.mats, i * 16)
      this.size[i] = Math.max(p.sx, p.sy, p.sz)
      this.kindOf[i] = KINDS.indexOf(p.k)
      const k = this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))
      let c = this.cells.get(k)
      if (!c) this.cells.set(k, (c = { idx: [], y0: Infinity, y1: -Infinity }))
      c.idx.push(i)
      c.y0 = Math.min(c.y0, p.y - 2)
      c.y1 = Math.max(c.y1, p.y + Math.max(p.sy, p.sx) + 2)
    })
  }

  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096) }

  /** The writing within 9 m of (x, z) — stopped by it, the game shows it (main.ts). */
  textNear(x: number, z: number): WardenText | null {
    const ci = Math.floor(x / 64), cj = Math.floor(z / 64)
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const t of this.textHash.get(this.key(i, j)) ?? []) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 81) return t
    return null
  }
  get textCount(): number { return this.texts.length }

  /** Re-pick what's drawn when the camera has moved 8 m or turned. */
  update(camera: GFX.PerspectiveCamera): void {
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
      this.cellBox.min.set(x0 - 30, c.y0, z0 - 30)
      this.cellBox.max.set(x0 + CELL + 30, c.y1, z0 + CELL + 30)
      if (!this.frustum.intersectsBox(this.cellBox)) continue
      if (this.horizon?.hiddenBox(this.cellBox)) continue
      for (const k of c.idx) {
        const o = k * 16, dx = this.mats[o + 12] - cx, dz = this.mats[o + 14] - cz, d2 = dx * dx + dz * dz, s = this.size[k]
        // (each piece's reach grows with its size: a slab ~160 m, a lantern ~250, a column ~600, a tower or a giant 2.6 km+)
        const reach = Math.min(R, (120 + s * 75) * this.reachK)
        if (d2 > reach * reach || s * s < minRatio * minRatio * d2) continue
        const mesh = this.meshes[this.kindOf[k]]
        ;(mesh.instanceMatrix.array as Float32Array).set(this.mats.subarray(o, o + 16), mesh.count * 16)
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
